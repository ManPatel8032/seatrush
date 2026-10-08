# Feature Specification: Asynchronous MySQL/TiDB Persistence Pipeline with 15-Minute Auto-Expiration

- **Feature Name**: Asynchronous MySQL/TiDB Booking Persistence & TTL Auto-Expiry Pipeline
- **Target File / Location**: `.agents/specs/async-mysql-persistence-pipeline.md`
- **Status**: Approved & Implementation-Ready
- **Author**: Antigravity Assistant & Engineering Team
- **Created Date**: October 2026
- **Target Systems**: Node.js API (`backend`), Redis Streams (In-Memory Buffer), MySQL 8.0 / TiDB Serverless (`backend/db.js`), React Frontend (`frontend/src/App.jsx`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Context
In SeatRush, ticket bookings are processed in under ~2ms via an atomic Redis Lua script (`BOOK_LUA`) and a Sorted-Set Waiting Room queue (`WaitingRoomQueue`). While this completely prevents overselling and protects server CPU during flash spikes (e.g., Tatkal rush), confirmed tickets currently remain volatile in Redis memory (`tatkal:job:<jobId>` with 300s TTL).

### 1.2 Core Decisions & Approved Specifications
1. **Redis Streams Ingestion Buffer**:
   - Confirmed bookings are emitted to a Redis Stream (`tatkal:stream:persistence`) using `XADD`.
   - A dedicated Consumer Group (`persistence-group`) processes entries via `XREADGROUP` and acknowledges completions with `XACK`.
2. **15-Minute Expiration Baseline**:
   - The 15-minute TTL timer **starts precisely when the background worker writes the row to MySQL/TiDB** (`booked_at = NOW()`, with `expires_at = NOW() + INTERVAL 15 MINUTE`).
3. **Universal Persistence Scope**:
   - **All winning bookings** (both real human users and simulated bot winners from `/api/storm`) are enqueued into the stream and persisted into MySQL/TiDB in micro-batches.
   - For simulated bot bookings, **passenger counts are randomized between 1 and 4 passengers** per booking with realistic passenger profiles and berth allocations.
4. **Clean Reset (`POST /api/reset`)**:
   - Clears Redis queues/streams and inventory, and executes `DELETE FROM bookings` in MySQL/TiDB (which cascades to `passengers` via `ON DELETE CASCADE`), ensuring test cycles start clean.
5. **Interactive PNR Status Tab in Frontend**:
   - A dedicated **PNR Status Tab** in [`frontend/src/App.jsx`](file:///C:/Users/MAN%20PATEL/OneDrive/Desktop/test/frontend/src/App.jsx) allows users to search any 10-digit PNR, view live passenger berth allocations, track a real-time countdown timer before expiry, and observe the ticket vanish upon expiration.
6. **TiDB Serverless & MySQL 8.0 Dual Parity**:
   - TiDB Serverless does not support the standard MySQL `CREATE EVENT` scheduler syntax. Expiration is enforced through a dual-layer strategy: real-time query filtering + background chunked sweeper.

---

## 2. Goals & Non-Goals

### 2.1 Goals
- **Zero-Latency Edge Response**: The client booking intake path (`POST /api/book` -> Waiting Room -> `BOOK_LUA`) completes immediately and responds via polling without blocking on database transactions.
- **Reliable Redis Stream Buffer**:
  - Confirmed wins are appended to Redis Stream `tatkal:stream:persistence` via `XADD`.
  - Consumer group `persistence-group` reads batches (25–50 items) via `XREADGROUP`.
  - Failures remain in the Pending Entries List (PEL) for automatic retry, preventing data loss.
- **Micro-Batch Persistence**:
  - The worker performs bulk `INSERT` statements into `bookings` and `passengers` inside a single MySQL transaction (`pool.getConnection()`).
- **Authentic Indian Railways 10-Digit PNR**:
  - Generates realistic 10-digit numeric PNRs with zone codes (e.g., `284-XXXXXXX`, `425-XXXXXXX`).
- **Strict 15-Minute Automatic Vanishing**:
  - Timestamp `booked_at` records the exact MySQL insertion time.
  - Queries filter out rows where `booked_at < NOW() - INTERVAL 15 MINUTE`.
  - Sweeper job deletes expired rows in chunks (`DELETE FROM bookings WHERE booked_at < NOW() - INTERVAL 15 MINUTE LIMIT 200`), cascading automatically to `passengers` via `ON DELETE CASCADE`.
- **PNR Status UI & API**:
  - API: `GET /api/pnr/:pnrNumber` returning booking, passenger, and `ttlRemainingSeconds`.
  - UI: "PNR Status" navigation tab in `App.jsx` with input field, live countdown badge, train details, and passenger berth card.

### 2.2 Non-Goals
- Permanent archival of mock flash-sale data (by design, data is ephemeral and vanishes after 15 minutes).
- Payment gateway integration.
- Dynamic berth optimization algorithms.

---

## 3. High-Level Architecture & Flow

```
[ Client Browser / Storm Simulator ]
                │  POST /api/book (HTTP 202)
                ▼
[ Virtual Waiting Room Worker ]
                │  Runs BOOK_LUA (Atomic inventory decrement)
                ├──────────────────────────────────────┐
                │ If WON (Seats > 0)                   │ If LOST
                ▼                                      ▼
[ Redis Stream: tatkal:stream:persistence ]   [ Mark Job Failed ]
  XADD (JobId, UserId, Class, PNR, Manifest)    tatkal:job:<jobId>
                │
                │ XREADGROUP (Consumer Group: persistence-group)
                │ Batch Size: 25-50 | Block: 100ms
                ▼
[ Persistence Worker (Node.js) ]
                │
                ├── 1. Generates 10-Digit PRS PNR & Berth Allocations
                ├── 2. Generates Passenger Manifest (1-4 passengers for bots)
                ├── 3. Begins MySQL Transaction (pool.getConnection())
                ├── 4. Bulk INSERT into `bookings` (booked_at = NOW())
                ├── 5. Bulk INSERT into `passengers`
                ├── 6. Commits Transaction
                └── 7. XACK stream message
                │
                ▼
┌───────────────────────────────────────────────────────────────┐
│               MySQL / TiDB Relational Persistence            │
│                                                               │
│   [ bookings ] (Master table with booked_at / expires_at)     │
│       │                                                       │
│       └── ON DELETE CASCADE                                   │
│               ▼                                               │
│   [ passengers ] (Child table containing allocated berths)    │
└───────────────────────────────────────────────────────────────┘
                ▲
                │ Periodic Chunked Sweep (Every 30 seconds)
[ DB TTL Cleaner Worker ]
  Executes: DELETE FROM bookings WHERE booked_at < NOW() - INTERVAL 15 MINUTE LIMIT 200
  (Cascades to passengers automatically; works on both MySQL 8 and TiDB)
```

---

## 4. Detailed Component Design

### 4.1 Redis Stream Architecture
- **Stream Key**: `tatkal:stream:persistence`
- **Consumer Group**: `persistence-group`
- **Consumer Name**: `worker-persistence-1`
- **Producer Hook**: When `WaitingRoomQueue` worker confirms a win via `BOOK_LUA`, it issues:
  ```javascript
  await redis.xadd(
    "tatkal:stream:persistence",
    "*",
    "jobId", jobId,
    "userId", userId,
    "classCode", classCode,
    "pnr", generatedPnr,
    "payload", JSON.stringify(bookingDetails)
  );
  ```
- **Consumer Loop**:
  - `XREADGROUP GROUP persistence-group worker-persistence-1 COUNT 50 BLOCK 100 STREAMS tatkal:stream:persistence >`
  - Upon successful DB transaction commit, invokes `XACK tatkal:stream:persistence persistence-group <id>`.
  - At startup or on timer, checks for stale messages using `XPENDING` / `XCLAIM` to handle any crashed worker tasks.

### 4.2 10-Digit Authentic PNR & Berth Generator
- Standard Indian Railways PNR format: 3-digit PRS zone code prefix + 7-digit sequential/random digits (e.g. `284-XXXXXXX`, `425-XXXXXXX`).
- Format: `^\d{10}$` (exact 10 digits).
- Collision avoidance: Generated with high-entropy crypto random numbers and protected by `UNIQUE KEY (pnr_number)` in MySQL.
- Berth allocation: Assigns realistic coach (e.g., `B1`-`B6` for 3A, `A1`-`A3` for 2A, `H1` for 1A, `S1`-`S8` for SL), berth numbers 1-72, and berth types (`Lower`, `Middle`, `Upper`, `Side Lower`, `Side Upper`).
- Bot booking manifests: Randomly assigns 1 to 4 passengers with realistic ages, genders, and preferences.

### 4.3 Database Schema Adjustments (`schema.sql`)
The existing schema already includes `bookings` and `passengers` with `ON DELETE CASCADE`. We add indexing to ensure high-performance lookups and cleanups:

```sql
-- Enhancements to bookings table
ALTER TABLE bookings 
  ADD COLUMN idempotency_key VARCHAR(64) NULL UNIQUE;

-- Dedicated index for TTL purging and active-window queries
CREATE INDEX idx_bookings_booked_at ON bookings (booked_at);
CREATE INDEX idx_bookings_pnr_active ON bookings (pnr_number, booked_at);
```

### 4.4 15-Minute Vanishing (Auto-Expiry) Engine

The 15-minute TTL timer starts at the exact timestamp when the record is written to MySQL (`booked_at = NOW()`).

#### Dual-Layer Expiration Strategy:
1. **Layer 1: Real-Time Query Filter (Zero Latency Boundary)**:
   Any lookup (`GET /api/pnr/:pnrNumber`) applies:
   ```sql
   SELECT 
     b.id, b.pnr_number, b.train_id, b.journey_date, 
     b.from_station_code, b.to_station_code, b.class_code, 
     b.quota_code, b.total_fare, b.booking_status, b.booked_at,
     TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(b.booked_at, INTERVAL 15 MINUTE)) AS ttl_remaining_seconds
   FROM bookings b
   WHERE b.pnr_number = ?
     AND b.booked_at >= NOW() - INTERVAL 15 MINUTE;
   ```
   If a record is 15 minutes and 1 millisecond old, it immediately returns `404 Not Found` even if the background sweeper has not executed yet.

2. **Layer 2: Background Chunked Purge Sweeper**:
   A lightweight interval job running every 30 seconds:
   ```sql
   DELETE FROM bookings 
   WHERE booked_at < NOW() - INTERVAL 15 MINUTE 
   LIMIT 200;
   ```
   - Running with `LIMIT 200` prevents table locks and buffer pool pressure.
   - Deletions loop until zero rows affected.
   - Cascades automatically to `passengers` rows via `FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE`.

---

## 5. API Specifications

### 5.1 Query Booking & E-Ticket by PNR
- **Endpoint**: `GET /api/pnr/:pnrNumber`
- **Description**: Retrieves live booking details and passenger allocation, including countdown until record vanishes.
- **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "pnr": "2849102842",
    "train": {
      "number": "12952",
      "name": "New Delhi Mumbai Central Tejas Rajdhani Express",
      "from": "NDLS",
      "to": "MMCT",
      "journeyDate": "2026-10-08"
    },
    "bookingStatus": "CONFIRMED",
    "classCode": "3A",
    "quotaCode": "TQ",
    "totalFare": 1740.00,
    "bookedAt": "2026-10-07T15:30:00.000Z",
    "expiresAt": "2026-10-07T15:45:00.000Z",
    "ttlRemainingSeconds": 540,
    "passengers": [
      {
        "id": 1042,
        "name": "Man Patel",
        "age": 28,
        "gender": "M",
        "coach": "B4",
        "berthNumber": 21,
        "berthType": "LOWER",
        "status": "CNF"
      }
    ]
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: `{ "error": "Invalid 10-digit PNR format" }`
  - `404 Not Found`: `{ "error": "PNR not found or ticket record expired (15-min TTL exceeded)" }`

### 5.2 Persistence Pipeline Telemetry
- **Endpoint**: `GET /api/persistence/telemetry`
- **Description**: Real-time health metrics of the async database pipeline.
- **Success Response (`200 OK`)**:
  ```json
  {
    "streamLength": 0,
    "pendingCount": 0,
    "totalPersisted": 320,
    "totalPurgedExpired": 180,
    "activeRecordsInDb": 140,
    "lastBatchDurationMs": 14,
    "lastPurgeTimestamp": "2026-10-07T15:44:30.000Z",
    "workerStatus": "HEALTHY"
  }
  ```

### 5.3 Reset Database & Inventory
- **Endpoint**: `POST /api/reset`
- **Description**: Clears Redis waitlist queues, resets seat counters to 80 per tier (320 total), purges Redis Stream `tatkal:stream:persistence`, and executes `DELETE FROM bookings` in MySQL/TiDB.

---

## 6. Frontend User Interface (`frontend/src/App.jsx`)

### 6.1 Navigation View State
- The top IRCTC navigation bar supports three main tabs:
  1. **Book Ticket / Home** (`home`)
  2. **Search Results** (`results`)
  3. **PNR Status** (`pnr`)

### 6.2 PNR Status Tab Components
1. **Search Card**:
   - 10-digit numeric input with live format validation (`^\d{10}$`).
   - "Get PNR Status" button with loading spinner.
   - Quick-fill pill for the most recently confirmed ticket in the user's active session.
2. **Status Card / Live Countdown HUD**:
   - Prominent badge displaying `TTL Remaining: mm:ss` with color transitions:
     - Green: > 5 minutes
     - Amber: 1 – 5 minutes
     - Red Flashing: < 1 minute
   - Real-time tick update every second.
3. **Confirmed E-Ticket Details Card**:
   - Train number & name, departure/arrival stations, journey date, class & quota.
   - Passenger table showing Name, Age, Gender, Allocated Coach (e.g. `B4`), Berth Number (`21`), Berth Type (`LOWER`), and Status (`CNF`).
4. **Vanished State (404 View)**:
   - When the 15-minute countdown hits 0 or the backend returns 404, the UI smoothly transitions to:
     - Warning banner: *"PNR 2849102842 has expired and automatically vanished from the database as per 15-minute simulation policy."*

---

## 7. Edge Cases & Resilience Strategies

| Scenario | Risk | Mitigation |
| :--- | :--- | :--- |
| **Tatkal Flash Burst (1,400+ users)** | MySQL connection pool exhaustion | Bookings are buffered in Redis Streams; persistence worker writes in micro-batches (50 bookings per multi-row `INSERT`). |
| **Worker Crash during Batch Insert** | Lost or duplicate bookings | Redis messages remain in Consumer Group Pending Entries List (PEL) until `XACK` is sent after `COMMIT`. |
| **PNR Collision** | MySQL `UNIQUE KEY` violation | High-entropy generation; DB error code `ER_DUP_ENTRY` (1062) triggers regeneration before retry. |
| **MySQL / TiDB Disconnection** | Persistence pipeline halt | Connection pool auto-reconnects with exponential backoff; Redis stream buffers up to 100,000 items in RAM without dropping data. |
| **Large Purge Lock Contention** | Table locks during 15-min sweep | Sweeper uses `DELETE ... LIMIT 200` with indexed `booked_at`, preventing row or table lock escalation. |
| **Read Race at 14m 59s** | Inconsistent read during deletion | Read query filters `booked_at >= NOW() - INTERVAL 15 MINUTE` atomically at SQL level. |

---

## 8. Acceptance Criteria

- [ ] **AC-1**: All tickets confirmed via `WaitingRoomQueue` in Redis (humans and bots) are appended to Redis Stream `tatkal:stream:persistence` via `XADD`.
- [ ] **AC-2**: Background persistence worker successfully reads batches via `XREADGROUP` and inserts both `bookings` and associated `passengers` records into MySQL/TiDB in a single transaction before calling `XACK`.
- [ ] **AC-3**: Each persisted booking has an authentic 10-digit numeric PNR (`^\d{10}$`).
- [ ] **AC-4**: Querying `GET /api/pnr/:pnrNumber` within 15 minutes of booking returns full booking details and allocated berths.
- [ ] **AC-5**: At exactly 15 minutes post-write, `GET /api/pnr/:pnrNumber` returns `404 Not Found`.
- [ ] **AC-6**: Purge sweeper deletes expired `bookings` rows, and foreign key `ON DELETE CASCADE` removes all associated `passengers` rows from MySQL/TiDB.
- [ ] **AC-7**: High-concurrency rush simulator (`/api/storm`) completes with all 320 winning seats persisted to MySQL and subsequent cleanup verified after 15 minutes.
- [ ] **AC-8**: Dedicated "PNR Status" tab in `App.jsx` enables PNR lookup, shows live countdown timer, and handles expired ticket transition.
- [ ] **AC-9**: `POST /api/reset` cleanly wipes both Redis queues/inventory and MySQL `bookings`/`passengers` records.
- [ ] **AC-10**: Code operates seamlessly on both local MySQL 8.0 and TiDB Serverless.
