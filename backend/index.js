const express = require("express");
const cors = require("cors");
const Redis = require("ioredis");

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
