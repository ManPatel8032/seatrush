require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Redis = require("ioredis");
const pool = require("./db");
const { createRateLimiter } = require("./gateway");
const WaitingRoomQueue = require("./queue");

const PORT = process.env.PORT || 3000;
const ALL_CLASSES = ["1A", "2A", "3A", "SL"];
const SEATS_PER_CLASS = 80; // 80 tickets * 4 classes = 320 total tickets
const TOTAL_INITIAL_TICKETS = 320;
const CLASS_KEY_PREFIX = "tickets:remaining:";
const TICKETS_KEY = "tickets:remaining";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CLIENT_URL = process.env.CLIENT_URL;

const BOOK_LUA = `
local remaining = tonumber(redis.call("GET", KEYS[1]) or "0")
if remaining > 0 then
  redis.call("DECR", KEYS[1])
  return 1
end
return 0
`;

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
const app = express();

app.use(
  cors({
    origin: CLIENT_URL ? [CLIENT_URL, "http://localhost:5173"] : "*",
  })
);
app.use(express.json());

// Helper: Fetch live inventory across all 4 tiers from Redis
async function getLiveInventory() {
  const keys = ALL_CLASSES.map((c) => `${CLASS_KEY_PREFIX}${c}`);
  const values = await redis.mget(...keys);
  const classes = {};
  let total = 0;
  ALL_CLASSES.forEach((c, i) => {
    const count = Number(values[i] ?? 0);
    classes[c] = count;
    total += count;
  });
  return { classes, totalRemaining: total };
}

// Helper: Initialize / Reset Redis inventory to 80 seats per class (320 total)
async function resetAllInventory() {
  const pipeline = redis.pipeline();
  ALL_CLASSES.forEach((c) => {
    pipeline.set(`${CLASS_KEY_PREFIX}${c}`, SEATS_PER_CLASS);
  });
  pipeline.set(TICKETS_KEY, TOTAL_INITIAL_TICKETS);
  await pipeline.exec();
}

// --- API GATEWAY LAYER ---

// 1. Global Surge Shield: Absorbs 2,500+ Tatkal clicks into the queue
const globalBookingLimiter = createRateLimiter(redis, {
  capacity: 2500,        // Allows massive burst of users into the waiting room
  refillRatePerSec: 500, // Steady flow
  prefix: "rl:global:book",
  keyGenerator: () => "global",
});

// 2. Per-User Bot Limiter: Stops a single script from hogging multiple spots
const userBookingLimiter = createRateLimiter(redis, {
  capacity: 5,
  refillRatePerSec: 2,
  prefix: "rl:user:book",
});

// Initialize Virtual Waiting Room Queue
const waitingQueue = new WaitingRoomQueue(redis, BOOK_LUA, TICKETS_KEY);

// General limiter for browsing & search (Burst capacity of 50, refills 10 tokens/sec)
const generalRateLimiter = createRateLimiter(redis, {
  capacity: 50,
  refillRatePerSec: 10,
  prefix: "rl:general",
});

// Protect all search & station routes
app.use("/api/trains", generalRateLimiter);
app.use("/api/stations", generalRateLimiter);


// 1. Fetch All Stations Registry from MySQL
app.get("/api/stations", async (_req, res) => {
  try {
    const [stations] = await pool.query(
      "SELECT code, name, city, state FROM stations ORDER BY name ASC"
    );
    res.json({ stations });
  } catch (err) {
    res.json({
      stations: [
        { code: "NDLS", name: "New Delhi", city: "New Delhi", state: "Delhi" },
        { code: "MMCT", name: "Mumbai Central", city: "Mumbai", state: "Maharashtra" },
        { code: "HWH", name: "Howrah Jn", city: "Kolkata", state: "West Bengal" },
        { code: "MAS", name: "MGR Chennai Central", city: "Chennai", state: "Tamil Nadu" },
        { code: "SBC", name: "KSR Bengaluru", city: "Bengaluru", state: "Karnataka" },
        { code: "ADI", name: "Ahmedabad Jn", city: "Ahmedabad", state: "Gujarat" },
        { code: "KOTA", name: "Kota Jn", city: "Kota", state: "Rajasthan" },
        { code: "CNB", name: "Kanpur Central", city: "Kanpur", state: "Uttar Pradesh" },
      ],
    });
  }
});

// 2. Search Trains & Live Inventory between Stations
app.get("/api/trains/search", async (req, res) => {
  try {
    const { from, to, date, quota } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: "from and to station codes are required" });
    }

    const query = `
      SELECT 
        t.id AS train_id,
        t.train_number,
        t.train_name,
        t.train_type,
        t.runs_on,
        DATE_FORMAT(s1.departure_time, '%H:%i') AS origin_departure,
        DATE_FORMAT(s2.arrival_time, '%H:%i') AS dest_arrival,
        (s2.distance_from_origin_km - s1.distance_from_origin_km) AS journey_km,
        (s2.day_offset - s1.day_offset) AS day_diff
      FROM trains t
      JOIN train_schedules s1 ON t.id = s1.train_id AND s1.station_code = ?
      JOIN train_schedules s2 ON t.id = s2.train_id AND s2.station_code = ?
      WHERE s1.stop_sequence < s2.stop_sequence
    `;

    const [trains] = await pool.query(query, [from, to]);

    const journeyDate = date || new Date().toISOString().split("T")[0];
    const quotaCode = quota || "TQ";

    const [classes] = await pool.query(
      "SELECT code, name, base_fare FROM travel_classes ORDER BY base_fare DESC"
    );

    const results = await Promise.all(
      trains.map(async (train) => {
        const [inventoryRows] = await pool.query(
          "SELECT class_code, available_seats, total_seats, waitlist_count FROM inventory_quotas WHERE train_id = ? AND journey_date = ? AND quota_code = ?",
          [train.train_id, journeyDate, quotaCode]
        );

        const inventoryMap = {};
        inventoryRows.forEach((r) => {
          inventoryMap[r.class_code] = r;
        });

        const durationHours = Math.max(1, Math.round((train.journey_km || 1000) / 85));
        const durationStr = `${durationHours}h ${Math.floor(Math.random() * 40) + 15}m`;

        const inv = await getLiveInventory();

        const classesWithInventory = classes.map((cls) => ({
          id: cls.code,
          name: cls.name,
          fare: `₹ ${Number(cls.base_fare).toLocaleString("en-IN")}`,
          availableSeats: inv.classes[cls.code] ?? inventoryMap[cls.code]?.available_seats ?? SEATS_PER_CLASS,
          waitlistCount: inventoryMap[cls.code]?.waitlist_count ?? 0,
        }));

        return {
          ...train,
          duration: durationStr,
          classes: classesWithInventory,
        };
      })
    );

    res.json({ trains: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/status", async (_req, res) => {
  try {
    const inv = await getLiveInventory();
    res.json({
      remaining: inv.totalRemaining,
      totalRemaining: inv.totalRemaining,
      classes: inv.classes,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1. Enqueue booking request into Virtual Waiting Room (Returns HTTP 202 Accepted in ~2ms)
app.post(
  "/api/book",
  globalBookingLimiter,
  userBookingLimiter,
  async (req, res) => {
    try {
      const { userId, classCode = "3A" } = req.body || {};
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const queueResult = await waitingQueue.enqueue(userId, classCode);
      res.status(202).json({ ...queueResult, classCode });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// 2. Poll live queue position & booking confirmation
app.get("/api/book/status/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const status = await waitingQueue.getStatus(jobId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- MULTI-CLASS TATKAL CONCURRENCY RUSH SIMULATOR ---
class RushSimulator {
  constructor(queue, redisClient) {
    this.queue = queue;
    this.redis = redisClient;
    this.active = false;
    this.totalUsers = 1400;
    this.durationSec = 40;
    this.startTime = null;
    this.enqueuedUsers = 0;
    this.botWins = 0;
    this.humanWins = 0;
    this.losses = 0;
    this.classWins = { "1A": 0, "2A": 0, "3A": 0, "SL": 0 };
    this.timers = [];

    // Register callback with waiting queue worker
    this.queue.onBookingProcessed((event) => {
      if (!this.active && this.timers.length === 0) return;
      const cls = event.classCode || "3A";
      if (event.won) {
        this.classWins[cls] = (this.classWins[cls] || 0) + 1;
        if (event.userId && event.userId.startsWith("sim_bot_")) {
          this.botWins++;
        } else {
          this.humanWins++;
        }
      } else {
        this.losses++;
      }
    });
  }

  async start({ users = 1400, durationSec = 40 } = {}) {
    this.stop();

    await resetAllInventory();
    await this.queue.clear();

    this.active = true;
    this.totalUsers = users;
    this.durationSec = durationSec;
    this.startTime = Date.now();
    this.enqueuedUsers = 0;
    this.botWins = 0;
    this.humanWins = 0;
    this.losses = 0;
    this.classWins = { "1A": 0, "2A": 0, "3A": 0, "SL": 0 };
    this.timers = [];

    const durationMs = durationSec * 1000;

    // Stagger 1,400 requests across durationMs (40s) with random tier selection
    for (let i = 1; i <= users; i++) {
      const delay = Math.floor(Math.random() * durationMs);
      // Randomly assign one class: 1A, 2A, 3A, or SL
      const chosenClass = ALL_CLASSES[Math.floor(Math.random() * ALL_CLASSES.length)];

      const timer = setTimeout(async () => {
        if (!this.active) return;
        const botId = `sim_bot_${i}_${Date.now()}`;
        try {
          await this.queue.enqueue(botId, chosenClass);
          this.enqueuedUsers++;
        } catch (err) {
          console.error("[Rush Simulation Error]:", err.message);
        }
      }, delay);

      this.timers.push(timer);
    }

    // Auto-complete timer after duration + grace period
    const completionTimer = setTimeout(() => {
      this.active = false;
    }, durationMs + 2500);
    this.timers.push(completionTimer);

    return this.getStatus();
  }

  stop() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.active = false;
  }

  async getStatus() {
    const inv = await getLiveInventory();
    const queueLength = await this.redis.zcard("tatkal:queue:booking");
    const elapsedSec = this.startTime
      ? Math.min(this.durationSec, Math.round((Date.now() - this.startTime) / 1000))
      : 0;

    const totalWins = this.botWins + this.humanWins;

    return {
      active: this.active,
      totalUsers: this.totalUsers,
      durationSec: this.durationSec,
      elapsedSec,
      enqueuedUsers: this.enqueuedUsers,
      queueLength,
      botWins: this.botWins,
      humanWins: this.humanWins,
      totalWins,
      losses: this.losses,
      remaining: inv.totalRemaining,
      totalRemaining: inv.totalRemaining,
      classesRemaining: inv.classes,
      classWins: this.classWins,
      ok: totalWins <= TOTAL_INITIAL_TICKETS && inv.totalRemaining >= 0,
    };
  }
}

const rushSimulator = new RushSimulator(waitingQueue, redis);

app.post("/api/reset", async (_req, res) => {
  try {
    rushSimulator.stop();
    await resetAllInventory();
    await waitingQueue.clear();
    const inv = await getLiveInventory();
    res.json({
      remaining: inv.totalRemaining,
      totalRemaining: inv.totalRemaining,
      classes: inv.classes,
      queue: "cleared",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Staggered / Randomized Rush Simulation (1,400 Users across all tiers)
app.post("/api/storm", async (req, res) => {
  try {
    const { users = 1400, durationSec = 40, instant = false } = req.body || {};

    if (instant) {
      await resetAllInventory();
      const results = await Promise.all(
        Array.from({ length: users }, () => {
          const cls = ALL_CLASSES[Math.floor(Math.random() * ALL_CLASSES.length)];
          return redis.eval(BOOK_LUA, 1, `${CLASS_KEY_PREFIX}${cls}`);
        })
      );
      const wins = results.filter((value) => Number(value) === 1).length;
      const inv = await getLiveInventory();

      return res.json({
        users,
        wins,
        losses: users - wins,
        remaining: inv.totalRemaining,
        classesRemaining: inv.classes,
        ok: wins <= TOTAL_INITIAL_TICKETS && inv.totalRemaining >= 0,
        mode: "instant",
      });
    }

    const status = await rushSimulator.start({
      users: Number(users) || 1400,
      durationSec: Number(durationSec) || 40,
    });

    res.json({
      status: "STARTED",
      message: `Multi-Class Tatkal Rush started with ${users} users arriving randomly over ${durationSec}s across all classes (80 seats in each class: 1A, 2A, 3A, SL - 320 seats total). Real users can now book concurrently!`,
      ...status,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Live Rush Status Polling
app.get("/api/storm/status", async (_req, res) => {
  try {
    const status = await rushSimulator.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stop Rush Simulation
app.post("/api/storm/stop", async (_req, res) => {
  try {
    rushSimulator.stop();
    const status = await rushSimulator.getStatus();
    res.json({ message: "Simulation stopped", ...status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function start() {
  await resetAllInventory();
  await waitingQueue.clear();
  waitingQueue.startWorker(25, 50); // Process 25 bookings every 50ms (500/sec)

  const server = app.listen(PORT, "0.0.0.0", 4096, () => {
    console.log(`API listening on http://localhost:${PORT}`);
    console.log(`Redis ${REDIS_URL}; Initial Tickets: ${TOTAL_INITIAL_TICKETS} (80 seats in each class: 1A, 2A, 3A, SL)`);
  });
  server.maxConnections = 50000;
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
