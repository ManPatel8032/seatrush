require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Redis = require("ioredis");
const pool = require("./db");

const PORT = process.env.PORT || 3000;
const TICKETS_KEY = "tickets:remaining";
const INITIAL_TICKETS = 10;
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

        const classesWithInventory = classes.map((cls) => ({
          id: cls.code,
          name: cls.name,
          fare: `₹ ${Number(cls.base_fare).toLocaleString("en-IN")}`,
          availableSeats: inventoryMap[cls.code]?.available_seats ?? 10,
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
    const value = await redis.get(TICKETS_KEY);
    res.json({ remaining: Number(value ?? 0) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/book", async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const result = await redis.eval(BOOK_LUA, 1, TICKETS_KEY);
    res.json({ won: Number(result) === 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/reset", async (_req, res) => {
  try {
    await redis.set(TICKETS_KEY, INITIAL_TICKETS);
    res.json({ remaining: INITIAL_TICKETS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/storm", async (_req, res) => {
  try {
    const users = 200;
    await redis.set(TICKETS_KEY, INITIAL_TICKETS);

    const results = await Promise.all(
      Array.from({ length: users }, () => redis.eval(BOOK_LUA, 1, TICKETS_KEY))
    );

    const wins = results.filter((value) => Number(value) === 1).length;
    const remaining = Number(await redis.get(TICKETS_KEY) ?? 0);

    res.json({
      users,
      wins,
      losses: users - wins,
      remaining,
      ok: wins === INITIAL_TICKETS && remaining === 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function start() {
  await redis.set(TICKETS_KEY, INITIAL_TICKETS);
  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
    console.log(`Redis ${REDIS_URL}; ${TICKETS_KEY}=${INITIAL_TICKETS}`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
