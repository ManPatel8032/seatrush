/**
 * Virtual Waiting Room Queue Engine (IRCTC Tatkal Style)
 * 
 * Uses Redis Sorted Sets (ZSET) to track queue order by timestamp.
 * - ZADD: Enqueues users by millisecond timestamp (O(log N))
 * - ZRANK: Instantly returns live queue position (O(log N))
 * - ZPOPMIN: Worker batches the earliest users first (O(log N))
 */

const crypto = require("crypto");

const QUEUE_KEY = "tatkal:queue:booking";
const JOB_PREFIX = "tatkal:job:";
const JOB_TTL_SEC = 300; // 5 minutes retention

class WaitingRoomQueue {
  constructor(redisClient, bookLuaScript, ticketsKey) {
    this.redis = redisClient;
    this.bookLua = bookLuaScript;
    this.ticketsKey = ticketsKey;
    this.workerRunning = false;
    this.callbacks = [];
  }

  /**
   * Enqueue a user's booking attempt in the waiting room for a specific class
   */
  async enqueue(userId, classCode = "3A", metadata = {}) {
    const jobId = crypto.randomUUID();
    const now = Date.now();
    const jobKey = `${JOB_PREFIX}${jobId}`;

    const jobData = {
      jobId,
      userId,
      classCode,
      status: "QUEUED",
      createdAt: now,
    };

    if (metadata.trainId) jobData.trainId = String(metadata.trainId);
    if (metadata.journeyDate) jobData.journeyDate = String(metadata.journeyDate);
    if (metadata.fromStation) jobData.fromStation = String(metadata.fromStation);
    if (metadata.toStation) jobData.toStation = String(metadata.toStation);
    if (metadata.quotaCode) jobData.quotaCode = String(metadata.quotaCode);
    if (metadata.passengers) {
      jobData.passengers = typeof metadata.passengers === "string" 
        ? metadata.passengers 
        : JSON.stringify(metadata.passengers);
    }

    // Atomic pipeline: store job info + add to Sorted Set + get initial position
    const pipeline = this.redis.pipeline();
    pipeline.hset(jobKey, jobData);
    pipeline.expire(jobKey, JOB_TTL_SEC);
    pipeline.zadd(QUEUE_KEY, now, jobId);
    pipeline.zrank(QUEUE_KEY, jobId);

    const results = await pipeline.exec();
    // ZRANK is 0-indexed, so add 1 for human position (1st, 2nd, ...)
    const rank = results[3][1];
    const position = rank !== null ? rank + 1 : 1;

    return {
      status: "QUEUED",
      jobId,
      classCode,
      position,
      estimatedWaitSeconds: Math.ceil(position / 100),
    };
  }

  /**
   * Check status and live queue position of a job
   */
  async getStatus(jobId) {
    const jobKey = `${JOB_PREFIX}${jobId}`;
    const jobData = await this.redis.hgetall(jobKey);

    if (!jobData || !jobData.jobId) {
      return { status: "NOT_FOUND", error: "Session expired or not found" };
    }

    if (jobData.status === "COMPLETED") {
      // Guard: If won is true but PNR has not yet attached, treat as QUEUED position 1
      if (jobData.won === "true" && !jobData.pnr) {
        return {
          status: "QUEUED",
          jobId,
          classCode: jobData.classCode || "3A",
          position: 1,
          estimatedWaitSeconds: 1,
        };
      }

      let passengers = null;
      if (jobData.passengers) {
        try {
          passengers = JSON.parse(jobData.passengers);
        } catch (_) {}
      }

      return {
        status: "COMPLETED",
        won: jobData.won === "true",
        classCode: jobData.classCode || "3A",
        processedAt: Number(jobData.processedAt),
        pnr: jobData.pnr || null,
        coach: jobData.coach || null,
        berthNumber: jobData.berthNumber ? Number(jobData.berthNumber) : null,
        berthType: jobData.berthType || null,
        passengers,
        totalFare: jobData.totalFare ? Number(jobData.totalFare) : null,
      };
    }

    // Still in queue: get fresh live position
    const rank = await this.redis.zrank(QUEUE_KEY, jobId);
    const position = rank !== null ? rank + 1 : 1;

    return {
      status: "QUEUED",
      jobId,
      classCode: jobData.classCode || "3A",
      position,
      estimatedWaitSeconds: Math.ceil(position / 100),
    };
  }

  /**
   * Background Worker: Drains the queue in batches and runs booking transactions
   */
  startWorker(batchSize = 25, intervalMs = 50) {
    if (this.workerRunning) return;
    this.workerRunning = true;

    const processBatch = async () => {
      try {
        // Pop the oldest N jobs from the sorted set (first-come, first-served)
        const popped = await this.redis.zpopmin(QUEUE_KEY, batchSize);

        if (popped && popped.length > 0) {
          // popped is [jobId1, score1, jobId2, score2, ...]
          for (let i = 0; i < popped.length; i += 2) {
            const jobId = popped[i];
            const jobKey = `${JOB_PREFIX}${jobId}`;

            // Check if job exists
            const job = await this.redis.hgetall(jobKey);
            if (!job || !job.userId) continue;

            // Target the specific class inventory key in Redis (e.g. tickets:remaining:3A)
            const classCode = job.classCode || "3A";
            const targetKey = `tickets:remaining:${classCode}`;

            // Execute atomic inventory allocation for the chosen class
            const result = await this.redis.eval(this.bookLua, 1, targetKey);
            const won = Number(result) === 1;

            // Parse passengers if provided in job
            let parsedPassengers = null;
            if (job.passengers) {
              try {
                parsedPassengers = JSON.parse(job.passengers);
              } catch (_) {}
            }

            const eventData = {
              jobId,
              userId: job.userId,
              classCode,
              won,
              trainId: job.trainId ? Number(job.trainId) : 1,
              journeyDate: job.journeyDate || null,
              fromStation: job.fromStation || "NDLS",
              toStation: job.toStation || "MMCT",
              quotaCode: job.quotaCode || "TQ",
              passengers: parsedPassengers,
              processedAt: Date.now(),
            };

            // Notify process listeners (persistence pipeline sets PNR and berths)
            if (this.callbacks && this.callbacks.length > 0) {
              for (const cb of this.callbacks) {
                try {
                  await Promise.resolve(cb(eventData)).catch((cbErr) => {
                    console.error("[Queue Callback Error]:", cbErr.message);
                  });
                } catch (cbErr) {
                  console.error("[Queue Callback Error]:", cbErr.message);
                }
              }
            }

            // Mark job outcome in Redis AFTER listeners have enriched the job with PNR/berths
            await this.redis.hset(jobKey, {
              status: "COMPLETED",
              won: won ? "true" : "false",
              processedAt: Date.now(),
            });
            await this.redis.expire(jobKey, JOB_TTL_SEC);
          }
        }
      } catch (err) {
        console.error("[Queue Worker Error]:", err.message);
      } finally {
        if (this.workerRunning) {
          setTimeout(processBatch, intervalMs);
        }
      }
    };

    processBatch();
    console.log(`[Queue Worker] Active (Batch: ${batchSize}, Interval: ${intervalMs}ms)`);
  }

  /**
   * Register a listener for each processed booking job
   */
  onBookingProcessed(callback) {
    if (!this.callbacks) this.callbacks = [];
    this.callbacks.push(callback);
  }

  /**
   * Reset the queue state (used for testing and resets)
   */
  async clear() {
    await this.redis.del(QUEUE_KEY);
  }
}

module.exports = WaitingRoomQueue;
