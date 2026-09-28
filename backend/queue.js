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
  }

  /**
   * Enqueue a user's booking attempt in the waiting room for a specific class
   */
  async enqueue(userId, classCode = "3A") {
    const jobId = crypto.randomUUID();
    const now = Date.now();
    const jobKey = `${JOB_PREFIX}${jobId}`;

    // Atomic pipeline: store job info + add to Sorted Set + get initial position
    const pipeline = this.redis.pipeline();
    pipeline.hset(jobKey, {
      jobId,
      userId,
      classCode,
      status: "QUEUED",
      createdAt: now,
    });
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
      return {
        status: "COMPLETED",
        won: jobData.won === "true",
        classCode: jobData.classCode || "3A",
        processedAt: Number(jobData.processedAt),
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

            // Update job outcome in Redis
            await this.redis.hset(jobKey, {
              status: "COMPLETED",
              won: won ? "true" : "false",
              processedAt: Date.now(),
            });
            await this.redis.expire(jobKey, JOB_TTL_SEC);

            // Notify process listeners (for simulation tracking & metrics)
            if (this.processCallback) {
              try {
                this.processCallback({
                  jobId,
                  userId: job.userId,
                  classCode,
                  won,
                  processedAt: Date.now(),
                });
              } catch (cbErr) {
                console.error("[Queue Callback Error]:", cbErr.message);
              }
            }
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
    this.processCallback = callback;
  }

  /**
   * Reset the queue state (used for testing and resets)
   */
  async clear() {
    await this.redis.del(QUEUE_KEY);
  }
}

module.exports = WaitingRoomQueue;
