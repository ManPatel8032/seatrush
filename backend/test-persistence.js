/**
 * backend/test-persistence.js
 * 
 * Comprehensive automated verification script for:
 * 1. 10-digit Indian Railways PNR format & collision resilience
 * 2. Asynchronous Redis Streams ingestion & micro-batch MySQL persistence
 * 3. Real-time PNR query with coach/berth details and live TTL
 * 4. 15-Minute Expiration enforcement (instant query 404 & sweeper physical purge)
 * 5. Foreign key cascading deletion of passengers
 * 6. Clean reset functionality
 */

const dns = require("dns");
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const Redis = require("ioredis");
const pool = require("./db");
const PersistencePipeline = require("./persistence");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

async function runTests() {
  console.log("===============================================================");
  console.log("🚀 STARTING SEATRUSH ASYNC MYSQL PERSISTENCE VERIFICATION SUITE");
  console.log("===============================================================\n");

  const pipeline = new PersistencePipeline(redis);
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // Test 1: PNR Generation Format & Collision Resistance
    // -------------------------------------------------------------
    console.log("--- TEST 1: Authentic 10-Digit PNR Format & Uniqueness ---");
    const pnrSet = new Set();
    let formatValid = true;
    for (let i = 0; i < 1000; i++) {
      const { pnr } = await pipeline.enqueueBooking({
        jobId: `test-pnr-${i}`,
        userId: `user-${i}`,
        classCode: "3A",
      });
      if (!/^\d{10}$/.test(pnr)) {
        formatValid = false;
      }
      pnrSet.add(pnr);
    }
    assert(formatValid, "All 1,000 generated PNRs match strict 10-digit numeric format (/^\\d{10}$/)");
    assert(pnrSet.size === 1000, `Generated 1,000 unique PNRs with 0 collisions (Unique count: ${pnrSet.size})`);

    // Clean test stream entries created in Test 1
    await redis.del("tatkal:stream:persistence");

    // -------------------------------------------------------------
    // Test 2: End-to-End Stream Enqueue & Micro-Batch Persistence
    // -------------------------------------------------------------
    console.log("\n--- TEST 2: Redis Stream -> Micro-Batch MySQL Transaction ---");
    await pipeline.initStreamGroup();

    const testJobId = "job-verify-101";
    const testUser = "Man_Patel";
    const testClass = "3A";

    const enqueued = await pipeline.enqueueBooking({
      jobId: testJobId,
      userId: testUser,
      classCode: testClass,
      trainId: 1,
      fromStation: "NDLS",
      toStation: "MMCT",
      journeyDate: "2026-10-15",
      quotaCode: "TQ",
      passengers: [
        {
          name: "Man Patel",
          age: 28,
          gender: "M",
          berthPreference: "LOWER",
          allocatedCoach: "B4",
          allocatedBerthNumber: 21,
          allocatedBerthType: "LOWER",
          currentStatus: "CNF",
        },
      ],
    });

    const testPnr = enqueued.pnr;
    console.log(`  ℹ️ Enqueued booking into stream with PNR: ${testPnr}`);

    // Read and persist batch directly
    const streamResults = await redis.xreadgroup(
      "GROUP",
      "persistence-group",
      "test-worker",
      "COUNT",
      10,
      "STREAMS",
      "tatkal:stream:persistence",
      ">"
    );

    assert(streamResults && streamResults.length > 0, "Consumer group successfully read message from Redis Stream");
    const [streamData] = streamResults;
    const messages = streamData[1];
    await pipeline._persistBatch(messages);

    // Verify row in MySQL `bookings`
    const [bookingRows] = await pool.query(
      "SELECT * FROM bookings WHERE pnr_number = ?",
      [testPnr]
    );
    assert(bookingRows.length === 1, `Booking record for PNR ${testPnr} persisted to MySQL bookings table`);
    const savedBooking = bookingRows[0];
    assert(savedBooking.class_code === "3A" && savedBooking.from_station_code === "NDLS", "Saved booking matches class (3A) and source station (NDLS)");

    // Verify row in MySQL `passengers`
    const [passengerRows] = await pool.query(
      "SELECT * FROM passengers WHERE booking_id = ?",
      [savedBooking.id]
    );
    assert(passengerRows.length === 1, `Passenger manifest saved (Count: ${passengerRows.length})`);
    assert(passengerRows[0].passenger_name === "Man Patel" && passengerRows[0].allocated_coach === "B4", "Passenger name and allocated coach (B4) match manifest");

    // -------------------------------------------------------------
    // Test 2B: Live WaitingRoomQueue -> Persistence Integration
    // -------------------------------------------------------------
    console.log("\n--- TEST 2B: Live WaitingRoomQueue -> Worker -> MySQL Persist ---");
    const WaitingRoomQueue = require("./queue");
    const BOOK_LUA = `
    local remaining = tonumber(redis.call("GET", KEYS[1]) or "0")
    if remaining > 0 then
      redis.call("DECR", KEYS[1])
      return 1
    end
    return 0
    `;
    await redis.set("tickets:remaining:2A", 10);
    const liveQueue = new WaitingRoomQueue(redis, BOOK_LUA, "tickets:remaining");
    
    // Wire persistence hook
    liveQueue.onBookingProcessed(async (event) => {
      if (event.won) {
        try {
          await pipeline.enqueueBooking(event);
        } catch (cbErr) {
          console.error("Hook error:", cbErr);
        }
      }
    });

    // Start background workers
    pipeline.startWorker(10, 50);
    liveQueue.startWorker(10, 50);

    const liveEnqueue = await liveQueue.enqueue("Integration_Tester", "2A", {
      trainId: 1,
      fromStation: "NDLS",
      toStation: "MMCT",
      journeyDate: "2026-10-20",
      quotaCode: "TQ",
      passengers: [
        {
          name: "Integration Tester",
          age: 32,
          gender: "M",
          berthPreference: "LOWER",
          allocatedCoach: "A1",
          allocatedBerthNumber: 15,
          allocatedBerthType: "LOWER",
          currentStatus: "CNF",
        },
      ],
    });

    // Wait for queue worker to process and persistence worker to commit
    let liveStatus = null;
    for (let attempts = 0; attempts < 20; attempts++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      liveStatus = await liveQueue.getStatus(liveEnqueue.jobId);
      if (liveStatus.status === "COMPLETED" && liveStatus.pnr) {
        break;
      }
    }

    assert(liveStatus && liveStatus.won === true, "Live queue job successfully processed and won: true");
    assert(liveStatus && /^\d{10}$/.test(liveStatus.pnr), `Live status contains real 10-digit PNR (${liveStatus.pnr})`);

    // Give persistence worker 200ms to commit transaction to MySQL
    await new Promise((resolve) => setTimeout(resolve, 300));

    const [liveBookingRows] = await pool.query(
      "SELECT * FROM bookings WHERE pnr_number = ?",
      [liveStatus.pnr]
    );
    assert(liveBookingRows.length === 1, `Live booking successfully persisted to MySQL bookings table (PNR: ${liveStatus.pnr})`);

    const [livePassengerRows] = await pool.query(
      "SELECT * FROM passengers WHERE booking_id = ?",
      [liveBookingRows[0]?.id]
    );
    assert(livePassengerRows.length >= 1, `Live passenger manifest successfully persisted to MySQL passengers table (Count: ${livePassengerRows.length})`);

    // Verify PNR lookup for live booking
    const liveLookup = await pipeline.getBookingByPnr(liveStatus.pnr);
    assert(liveLookup !== null, "getBookingByPnr successfully retrieves live booking");
    assert(liveLookup.train.number === "12952", "Live booking train details resolved correctly (12952 Tejas Rajdhani)");

    liveQueue.workerRunning = false;

    // -------------------------------------------------------------
    // Test 3: Real-Time PNR Lookup API & Live TTL Countdown
    // -------------------------------------------------------------
    console.log("\n--- TEST 3: PNR Lookup API & Live TTL Verification ---");
    const lookupResult = await pipeline.getBookingByPnr(testPnr);
    assert(lookupResult !== null, "getBookingByPnr retrieved active ticket record successfully");
    assert(lookupResult.pnr === testPnr, "Retrieved PNR matches target");
    assert(
      lookupResult.ttlRemainingSeconds > 850 && lookupResult.ttlRemainingSeconds <= 900,
      `TTL remaining is within fresh 15-minute window (${lookupResult.ttlRemainingSeconds}s remaining)`
    );
    assert(lookupResult.passengers.length === 1, "Retrieved passenger manifest includes allocated traveler");

    // -------------------------------------------------------------
    // Test 4: 15-Minute Expiration Enforcement & Cascading Purge
    // -------------------------------------------------------------
    console.log("\n--- TEST 4: 15-Minute Expiration & Cascading Cleanup ---");
    // Synthetic expired booking (16 minutes old)
    const expiredPnr = "8149998888";
    const [expiredBookingInsert] = await pool.query(
      `INSERT INTO bookings 
       (pnr_number, train_id, journey_date, from_station_code, to_station_code, 
        class_code, quota_code, contact_email, contact_phone, total_passengers, 
        total_fare, booking_status, booked_at)
       VALUES (?, 1, '2026-10-15', 'NDLS', 'MMCT', '2A', 'TQ', 'expired@test.com', '1234567890', 1, 2490, 'CONFIRMED', NOW() - INTERVAL 16 MINUTE)`,
      [expiredPnr]
    );
    const expiredBookingId = expiredBookingInsert.insertId;

    await pool.query(
      `INSERT INTO passengers 
       (booking_id, passenger_name, age, gender, berth_preference, allocated_coach, allocated_berth_number, allocated_berth_type, current_status)
       VALUES (?, 'Expired Passenger', 45, 'M', 'LOWER', 'A1', 12, 'LOWER', 'CNF')`,
      [expiredBookingId]
    );

    // 4A: Real-time query boundary: Must return null / 404 immediately
    const expiredLookup = await pipeline.getBookingByPnr(expiredPnr);
    assert(
      expiredLookup === null,
      "Expired ticket (>15 minutes old) instantly returns null / 404 at SQL query layer"
    );

    // 4B: Run sweeper chunked delete
    const [purgeResult] = await pool.query(
      "DELETE FROM bookings WHERE booked_at < NOW() - INTERVAL 15 MINUTE LIMIT 200"
    );
    assert(purgeResult.affectedRows >= 1, `Sweeper deleted expired booking (Affected rows: ${purgeResult.affectedRows})`);

    // 4C: Verify cascading deletion in child `passengers` table
    const [orphanPassengers] = await pool.query(
      "SELECT * FROM passengers WHERE booking_id = ?",
      [expiredBookingId]
    );
    assert(
      orphanPassengers.length === 0,
      "Child passengers were automatically purged via ON DELETE CASCADE (Zero orphan records)"
    );

    // -------------------------------------------------------------
    // Test 5: Full Pipeline Reset
    // -------------------------------------------------------------
    console.log("\n--- TEST 5: Pipeline & Database Reset ---");
    await pipeline.reset();
    const [remainingBookings] = await pool.query("SELECT COUNT(*) as cnt FROM bookings");
    const [remainingPassengers] = await pool.query("SELECT COUNT(*) as cnt FROM passengers");
    assert(remainingBookings[0].cnt === 0, "All bookings cleared from MySQL on pipeline.reset()");
    assert(remainingPassengers[0].cnt === 0, "All passengers cleared from MySQL on pipeline.reset()");

    const streamLen = await redis.xlen("tatkal:stream:persistence");
    assert(streamLen === 0, "Redis Stream 'tatkal:stream:persistence' purged on reset");

    console.log("\n===============================================================");
    console.log(`🎯 TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
    console.log("===============================================================\n");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("❌ Unexpected test execution error:", err);
    process.exit(1);
  } finally {
    pipeline.stop();
    await redis.quit();
    await pool.end();
  }
}

runTests();
