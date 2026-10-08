/**
 * backend/persistence.js
 * 
 * Asynchronous MySQL / TiDB Persistence Pipeline with 15-Minute Auto-Expiry
 * 
 * Architectural Highlights:
 * 1. Redis Streams Ingestion: Confirmed tickets are added to 'tatkal:stream:persistence' via XADD.
 * 2. Micro-Batch Worker: Reads batches via XREADGROUP (persistence-group), generates authentic
 *    10-digit Indian Railways PNRs, coach/berth allocations, and executes bulk ACID inserts.
 * 3. 15-Minute Auto-Vanishing:
 *    - Query Layer: Instant SQL filter ensures any booking older than 15 minutes returns 404 immediately.
 *    - Sweeper Layer: Periodic background worker (every 30s) deletes expired bookings with LIMIT 200,
 *      automatically cascading to passenger records via FOREIGN KEY ON DELETE CASCADE.
 *    - Compatible with both MySQL 8.0 and TiDB Serverless.
 */

const crypto = require("crypto");
const pool = require("./db");

const STREAM_KEY = "tatkal:stream:persistence";
const GROUP_NAME = "persistence-group";
const CONSUMER_NAME = `worker-persistence-${process.pid || 1}`;
const JOB_PREFIX = "tatkal:job:";

// PRS Zone Prefixes for authentic Indian Railways 10-digit PNRs
const PRS_ZONE_PREFIXES = ["284", "425", "632", "814", "239", "456"];

// Base fares per class
const CLASS_FARES = {
  "1A": 4120.0,
  "2A": 2490.0,
  "3A": 1740.0,
  "SL": 685.0,
};

// Coaches available per class
const CLASS_COACHES = {
  "1A": ["H1"],
  "2A": ["A1", "A2"],
  "3A": ["B1", "B2", "B3", "B4", "B5"],
  "SL": ["S1", "S2", "S3", "S4"],
};

// Berth types per class
const BERTH_TYPES_AC = ["LOWER", "MIDDLE", "UPPER", "SIDE_LOWER", "SIDE_UPPER"];
const BERTH_TYPES_1A = ["CABIN", "COUPE"];

// Sample realistic names for simulated bot manifests
const FIRST_NAMES = [
  "Aarav", "Priya", "Rahul", "Neha", "Vikram", "Ananya", "Rohan", "Sneha",
  "Aditya", "Pooja", "Arjun", "Kavita", "Siddharth", "Deepika", "Karan"
];
const LAST_NAMES = [
  "Sharma", "Patel", "Verma", "Singh", "Joshi", "Iyer", "Gupta", "Deshmukh",
  "Reddy", "Mehta", "Chopra", "Nair", "Bose", "Das", "Malhotra"
];

function generate10DigitPnr() {
  const prefix = PRS_ZONE_PREFIXES[Math.floor(Math.random() * PRS_ZONE_PREFIXES.length)];
  const randomSuffix = Math.floor(1000000 + Math.random() * 9000000); // 7 random digits
  return `${prefix}${randomSuffix}`;
}

function getRandomBerth(classCode) {
  const coaches = CLASS_COACHES[classCode] || ["B1"];
  const coach = coaches[Math.floor(Math.random() * coaches.length)];
  const maxBerth = classCode === "1A" ? 24 : classCode === "2A" ? 54 : 72;
  const berthNumber = Math.floor(1 + Math.random() * maxBerth);

  let berthType = "LOWER";
  if (classCode === "1A") {
    berthType = BERTH_TYPES_1A[Math.floor(Math.random() * BERTH_TYPES_1A.length)];
  } else {
    berthType = BERTH_TYPES_AC[Math.floor(Math.random() * BERTH_TYPES_AC.length)];
  }

  return { coach, berthNumber, berthType };
}

function generateRandomPassengerManifest(primaryName, classCode) {
  // Random count between 1 and 4 passengers for simulated bots; humans get exactly 1 passenger
  const isBot = !primaryName || primaryName.startsWith("sim_bot_");
  const count = isBot ? Math.floor(1 + Math.random() * 4) : 1;
  const passengers = [];

  for (let i = 0; i < count; i++) {
    const isPrimary = i === 0 && !isBot && primaryName;
    const name = isPrimary
      ? primaryName
      : `${FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]} ${
          LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]
        }`;
    const age = isPrimary ? 28 : Math.floor(20 + Math.random() * 45);
    const gender = isPrimary ? "M" : Math.random() > 0.4 ? "M" : "F";
    const { coach, berthNumber, berthType } = getRandomBerth(classCode);

    passengers.push({
      name,
      age,
      gender,
      berthPreference: berthType,
      allocatedCoach: coach,
      allocatedBerthNumber: berthNumber,
      allocatedBerthType: berthType,
      currentStatus: "CNF",
    });
  }

  return passengers;
}

class PersistencePipeline {
  constructor(redisClient) {
    this.redis = redisClient;
    this.workerRunning = false;
    this.sweeperRunning = false;
    this.sweeperTimer = null;
    this.totalPersisted = 0;
    this.totalPurgedExpired = 0;
    this.lastBatchDurationMs = 0;
    this.lastPurgeTimestamp = null;
  }

  /**
   * Initialize Consumer Group on Redis Stream if not already present
   */
  async initStreamGroup() {
    try {
      await this.redis.xgroup("CREATE", STREAM_KEY, GROUP_NAME, "0", "MKSTREAM");
      console.log(`[Persistence Stream] Initialized consumer group '${GROUP_NAME}' on '${STREAM_KEY}'`);
    } catch (err) {
      if (err.message && err.message.includes("BUSYGROUP")) {
        // Group already exists, safe to ignore
      } else {
        console.warn("[Persistence Stream Init Warning]:", err.message);
      }
    }
  }

  /**
   * Enqueue a confirmed ticket allocation into Redis Stream
   */
  async enqueueBooking(bookingData) {
    try {
      const {
        jobId,
        userId,
        classCode = "3A",
        trainId = 1,
        journeyDate,
        fromStation = "NDLS",
        toStation = "MMCT",
        quotaCode = "TQ",
        passengers,
      } = bookingData;

      const pnr = generate10DigitPnr();
      const manifest =
        Array.isArray(passengers) && passengers.length > 0
          ? passengers.map((p) => {
              const { coach, berthNumber, berthType } = getRandomBerth(classCode);
              return {
                name: p.name || userId,
                age: p.age || 28,
                gender: p.gender || "M",
                berthPreference: p.berthPreference || berthType,
                allocatedCoach: p.allocatedCoach || coach,
                allocatedBerthNumber: p.allocatedBerthNumber || berthNumber,
                allocatedBerthType: p.allocatedBerthType || berthType,
                currentStatus: "CNF",
              };
            })
          : generateRandomPassengerManifest(userId, classCode);

      const payloadJson = JSON.stringify({
        jobId,
        userId,
        classCode,
        trainId,
        journeyDate: journeyDate || new Date(Date.now() + 86400000).toISOString().split("T")[0],
        fromStation,
        toStation,
        quotaCode,
        pnr,
        passengers: manifest,
        enqueuedAt: Date.now(),
      });

      await this.redis.xadd(
        STREAM_KEY,
        "*",
        "jobId",
        jobId,
        "pnr",
        pnr,
        "payload",
        payloadJson
      );

      // Store in-flight cache in Redis with 15-minute TTL (900 seconds)
      // This ensures immediate sub-millisecond PNR query availability even before MySQL transaction commits
      await this.redis.setex(`tatkal:pnr:${pnr}`, 900, payloadJson);

      // Pre-set real PNR and allocated berths on Redis job hash immediately for client polling
      const primaryPassenger = manifest[0] || {};
      const baseFare = CLASS_FARES[classCode] || 1740.0;
      const totalFare = baseFare * (manifest.length || 1);
      await this.redis.hset(`${JOB_PREFIX}${jobId}`, {
        pnr,
        coach: primaryPassenger.allocatedCoach || "B1",
        berthNumber: String(primaryPassenger.allocatedBerthNumber || 1),
        berthType: primaryPassenger.allocatedBerthType || "LOWER",
        passengers: JSON.stringify(manifest),
        totalFare: String(totalFare),
      });

      return { pnr, passengers: manifest };
    } catch (err) {
      console.error("[Persistence Enqueue Error]:", err.message);
      throw err;
    }
  }

  /**
   * Background Worker: Pulls micro-batches via XREADGROUP and persists into MySQL
   */
  startWorker(batchSize = 50, intervalMs = 100) {
    if (this.workerRunning) return;
    this.workerRunning = true;

    const processBatch = async () => {
      try {
        // 1. Recover any unacknowledged / stuck messages from crashed workers or transient DB hiccups (older than 3s)
        try {
          const claimResult = await this.redis.xautoclaim(
            STREAM_KEY,
            GROUP_NAME,
            CONSUMER_NAME,
            3000,
            "0-0",
            "COUNT",
            batchSize
          );
          if (claimResult && claimResult[1] && claimResult[1].length > 0) {
            await this._persistBatch(claimResult[1]);
          }
        } catch (_) {}

        // 2. Read new incoming messages
        const streamResults = await this.redis.xreadgroup(
          "GROUP",
          GROUP_NAME,
          CONSUMER_NAME,
          "COUNT",
          batchSize,
          "BLOCK",
          100,
          "STREAMS",
          STREAM_KEY,
          ">"
        );

        if (streamResults && streamResults.length > 0) {
          const startTime = Date.now();
          const [streamData] = streamResults;
          const messages = streamData[1]; // [[id, [field, val, ...]], ...]

          if (messages && messages.length > 0) {
            await this._persistBatch(messages);
            this.lastBatchDurationMs = Date.now() - startTime;
          }
        }
      } catch (err) {
        if (err.message && err.message.includes("NOGROUP")) {
          await this.initStreamGroup();
        } else if (!err.message || !err.message.includes("Connection is closed")) {
          console.error("[Persistence Worker Error]:", err.message);
        }
      } finally {
        if (this.workerRunning) {
          setTimeout(processBatch, intervalMs);
        }
      }
    };

    processBatch();
    console.log(`[Persistence Worker] Active (Batch: ${batchSize}, Interval: ${intervalMs}ms)`);
  }

  /**
   * Internal: Insert a batch of bookings and passengers in a single MySQL transaction
   */
  async _persistBatch(messages) {
    let conn = null;
    const ackIds = [];

    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();

      for (const [msgId, fields] of messages) {
        let payloadObj = null;
        for (let i = 0; i < fields.length; i += 2) {
          if (fields[i] === "payload") {
            try {
              payloadObj = JSON.parse(fields[i + 1]);
            } catch (_) {}
          }
        }

        if (!payloadObj) {
          ackIds.push(msgId);
          continue;
        }

        const {
          jobId,
          userId,
          classCode,
          trainId = 1,
          journeyDate,
          fromStation = "NDLS",
          toStation = "MMCT",
          quotaCode = "TQ",
          pnr,
          passengers,
        } = payloadObj;

        const baseFare = CLASS_FARES[classCode] || 1740.0;
        const totalFare = baseFare * (passengers.length || 1);

        // Check idempotency (avoid duplicate key error if batch was re-delivered)
        const [existing] = await conn.query(
          "SELECT id FROM bookings WHERE pnr_number = ?",
          [pnr]
        );

        let bookingId;
        if (existing.length > 0) {
          bookingId = existing[0].id;
        } else {
          // 1. Insert Master Booking (booked_at = NOW() starts the 15-minute TTL)
          const [bookingInsert] = await conn.query(
            `INSERT INTO bookings 
             (pnr_number, train_id, journey_date, from_station_code, to_station_code, 
              class_code, quota_code, contact_email, contact_phone, total_passengers, 
              total_fare, booking_status, booked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', NOW())`,
            [
              pnr,
              trainId,
              journeyDate,
              fromStation,
              toStation,
              classCode,
              quotaCode,
              `${(userId || "passenger").toLowerCase().replace(/[^a-z0-9]/g, "") || "passenger"}@tatkal.in`,
              "9876543210",
              passengers.length,
              totalFare,
            ]
          );

          bookingId = bookingInsert.insertId;

          // 2. Insert Passengers
          if (passengers && passengers.length > 0) {
            const passengerValues = passengers.map((p) => [
              bookingId,
              p.name,
              p.age,
              p.gender,
              p.berthPreference || "NO_PREF",
              p.allocatedCoach,
              p.allocatedBerthNumber,
              p.allocatedBerthType,
              p.currentStatus || "CNF",
            ]);

            await conn.query(
              `INSERT INTO passengers 
               (booking_id, passenger_name, age, gender, berth_preference, 
                allocated_coach, allocated_berth_number, allocated_berth_type, current_status)
               VALUES ?`,
              [passengerValues]
            );
          }
        }

        // 3. Update Redis job hash with real PNR and berths for instant polling response
        const primaryPassenger = (passengers && passengers[0]) || {};
        await this.redis.hset(`${JOB_PREFIX}${jobId}`, {
          pnr,
          coach: primaryPassenger.allocatedCoach || "B1",
          berthNumber: String(primaryPassenger.allocatedBerthNumber || 1),
          berthType: primaryPassenger.allocatedBerthType || "LOWER",
          passengers: JSON.stringify(passengers),
          totalFare: String(totalFare),
        });

        ackIds.push(msgId);
        this.totalPersisted++;
      }

      await conn.commit();

      // Acknowledge successfully committed messages in Redis Stream
      if (ackIds.length > 0) {
        await this.redis.xack(STREAM_KEY, GROUP_NAME, ...ackIds);
      }
    } catch (dbErr) {
      if (conn) {
        try {
          await conn.rollback();
        } catch (_) {}
      }
      console.error("[Persistence Batch DB Error]:", dbErr.message);
      // Wait briefly before retrying so transient network hiccup clears
      await new Promise((r) => setTimeout(r, 1000));
    } finally {
      if (conn) {
        conn.release();
      }
    }
  }

  /**
   * 15-Minute Auto-Purge Sweeper:
   * Periodically deletes bookings older than 15 minutes in chunks of 200 rows.
   * Cascades automatically to child passengers table.
   */
  startSweeper(intervalMs = 30000) {
    if (this.sweeperRunning) return;
    this.sweeperRunning = true;
    let lastErrorLog = 0;

    const runSweep = async () => {
      try {
        let totalDeletedThisCycle = 0;
        let keepSweeping = true;

        while (keepSweeping) {
          const [result] = await pool.query(
            "DELETE FROM bookings WHERE booked_at < NOW() - INTERVAL 15 MINUTE LIMIT 200"
          );
          const affected = result.affectedRows || 0;
          totalDeletedThisCycle += affected;

          if (affected < 200) {
            keepSweeping = false;
          }
        }

        if (totalDeletedThisCycle > 0) {
          this.totalPurgedExpired += totalDeletedThisCycle;
          this.lastPurgeTimestamp = new Date().toISOString();
          console.log(
            `[TTL Sweeper] Purged ${totalDeletedThisCycle} expired bookings (>15 min old). Total purged: ${this.totalPurgedExpired}`
          );
        }
      } catch (err) {
        // Suppress repeated log spam for transient cloud connection resets
        const now = Date.now();
        if (now - lastErrorLog > 300000) {
          console.warn("[TTL Sweeper Notice]:", err.message);
          lastErrorLog = now;
        }
      } finally {
        if (this.sweeperRunning) {
          this.sweeperTimer = setTimeout(runSweep, intervalMs);
        }
      }
    };

    this.sweeperTimer = setTimeout(runSweep, intervalMs);
    console.log(`[TTL Sweeper] Active (Interval: ${intervalMs}ms, Max Age: 15 mins)`);
  }

  /**
   * Query single booking by PNR enforcing 15-minute real-time boundary
   */
  async getBookingByPnr(pnr) {
    try {
      // 1. Fetch booking within active 15-minute window from MySQL
      const [bookingRows] = await pool.query(
        `SELECT 
           b.id, b.pnr_number, b.train_id, b.journey_date, 
           b.from_station_code, b.to_station_code, b.class_code, 
           b.quota_code, b.total_passengers, b.total_fare, 
           b.booking_status, b.booked_at,
           t.train_number, t.train_name,
           s1.name AS from_station_name,
           s2.name AS to_station_name,
           TIMESTAMPDIFF(SECOND, b.booked_at, NOW()) AS age_seconds,
           (900 - TIMESTAMPDIFF(SECOND, b.booked_at, NOW())) AS ttl_remaining_seconds
         FROM bookings b
         JOIN trains t ON b.train_id = t.id
         LEFT JOIN stations s1 ON b.from_station_code = s1.code
         LEFT JOIN stations s2 ON b.to_station_code = s2.code
         WHERE b.pnr_number = ?
           AND b.booked_at >= NOW() - INTERVAL 15 MINUTE`,
        [pnr]
      );

      if (bookingRows && bookingRows.length > 0) {
        const booking = bookingRows[0];

        // Fetch associated passengers
        const [passengerRows] = await pool.query(
          `SELECT 
             id, passenger_name, age, gender, berth_preference,
             allocated_coach, allocated_berth_number, allocated_berth_type, current_status
           FROM passengers
           WHERE booking_id = ?
           ORDER BY id ASC`,
          [booking.id]
        );

        const ttlRemaining = Math.max(0, Number(booking.ttl_remaining_seconds || 0));

        return {
          pnr: booking.pnr_number,
          bookingStatus: booking.booking_status,
          classCode: booking.class_code,
          quotaCode: booking.quota_code,
          totalFare: Number(booking.total_fare),
          totalPassengers: booking.total_passengers,
          bookedAt: booking.booked_at,
          expiresAt: new Date(new Date(booking.booked_at).getTime() + 15 * 60 * 1000).toISOString(),
          ttlRemainingSeconds: ttlRemaining,
          train: {
            id: booking.train_id,
            number: booking.train_number,
            name: booking.train_name,
            from: booking.from_station_code,
            fromName: booking.from_station_name,
            to: booking.to_station_code,
            toName: booking.to_station_name,
            journeyDate: booking.journey_date,
          },
          passengers: passengerRows.map((p) => ({
            id: p.id,
            name: p.passenger_name,
            age: p.age,
            gender: p.gender,
            berthPreference: p.berth_preference,
            coach: p.allocated_coach,
            berthNumber: p.allocated_berth_number,
            berthType: p.allocated_berth_type,
            status: p.current_status,
          })),
        };
      }
    } catch (dbErr) {
      console.warn("[PNR Query DB Warning]:", dbErr.message);
    }

    // 2. In-Flight Fallback: Check Redis in-flight cache (e.g. while micro-batch is persisting or if DB was reconnecting)
    try {
      const cached = await this.redis.get(`tatkal:pnr:${pnr}`);
      if (cached) {
        const payload = JSON.parse(cached);
        const ageSec = Math.floor((Date.now() - (payload.enqueuedAt || Date.now())) / 1000);
        const ttlRemaining = Math.max(0, 900 - ageSec);
        if (ttlRemaining > 0) {
          const baseFare = CLASS_FARES[payload.classCode] || 1740.0;
          const passengers = payload.passengers || [];
          return {
            pnr: payload.pnr,
            bookingStatus: "CONFIRMED",
            classCode: payload.classCode,
            quotaCode: payload.quotaCode,
            totalFare: Number(baseFare * (passengers.length || 1)),
            totalPassengers: passengers.length,
            bookedAt: new Date(payload.enqueuedAt).toISOString(),
            expiresAt: new Date(payload.enqueuedAt + 15 * 60 * 1000).toISOString(),
            ttlRemainingSeconds: ttlRemaining,
            train: {
              id: payload.trainId || 1,
              number: "12952",
              name: "TEJAS RAJ EXPRESS",
              from: payload.fromStation || "NDLS",
              fromName: "New Delhi",
              to: payload.toStation || "MMCT",
              toName: "Mumbai Central",
              journeyDate: payload.journeyDate,
            },
            passengers: passengers.map((p, idx) => ({
              id: idx + 1,
              name: p.name,
              age: p.age,
              gender: p.gender,
              berthPreference: p.berthPreference,
              coach: p.allocatedCoach,
              berthNumber: p.allocatedBerthNumber,
              berthType: p.allocatedBerthType,
              status: p.currentStatus || "CNF",
            })),
          };
        }
      }
    } catch (_) {}

    return null;
  }

  /**
   * Telemetry stats for pipeline health monitoring
   */
  async getTelemetry() {
    let streamLength = 0;
    try {
      streamLength = await this.redis.xlen(STREAM_KEY);
    } catch (_) {}

    let activeInDb = 0;
    try {
      const [rows] = await pool.query(
        "SELECT COUNT(*) AS cnt FROM bookings WHERE booked_at >= NOW() - INTERVAL 15 MINUTE"
      );
      activeInDb = rows[0]?.cnt || 0;
    } catch (_) {}

    return {
      streamKey: STREAM_KEY,
      streamLength,
      totalPersisted: this.totalPersisted,
      totalPurgedExpired: this.totalPurgedExpired,
      activeRecordsInDb: activeInDb,
      lastBatchDurationMs: this.lastBatchDurationMs,
      lastPurgeTimestamp: this.lastPurgeTimestamp,
      workerRunning: this.workerRunning,
      sweeperRunning: this.sweeperRunning,
    };
  }

  /**
   * Reset database and Redis stream (used by /api/reset)
   */
  async reset() {
    try {
      await this.redis.del(STREAM_KEY);
      await this.initStreamGroup();
      // Clean up in-flight PNR keys
      try {
        const pnrKeys = await this.redis.keys("tatkal:pnr:*");
        if (pnrKeys && pnrKeys.length > 0) {
          await this.redis.del(pnrKeys);
        }
      } catch (_) {}
      await pool.query("DELETE FROM bookings");
      this.totalPersisted = 0;
      this.totalPurgedExpired = 0;
      this.lastBatchDurationMs = 0;
      this.lastPurgeTimestamp = null;
      console.log("[Persistence Pipeline] Reset: Redis stream and MySQL bookings purged.");
    } catch (err) {
      console.error("[Persistence Pipeline Reset Error]:", err.message);
      throw err;
    }
  }

  stop() {
    this.workerRunning = false;
    this.sweeperRunning = false;
    if (this.sweeperTimer) clearTimeout(this.sweeperTimer);
  }
}

module.exports = PersistencePipeline;
