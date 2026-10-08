# Implementation Plan: Asynchronous MySQL/TiDB Persistence Pipeline with 15-Minute Auto-Expiration

Persist confirmed Redis bookings and passenger records into MySQL/TiDB asynchronously via Redis Streams with authentic 10-digit PNRs, enforce a strict 15-minute auto-vanishing lifecycle, and provide an interactive PNR status inquiry tab in the frontend.

---

## User Review Required

> [!IMPORTANT]
> - **Zero-Latency Critical Path**: The high-throughput booking path (`POST /api/book` -> `WaitingRoomQueue` -> `BOOK_LUA`) remains 100% in-memory with sub-2ms latency. No database I/O is performed in the synchronous request cycle.
> - **Redis Streams**: Bookings are emitted to Redis Stream `tatkal:stream:persistence` via `XADD`. A worker group `persistence-group` reads batches via `XREADGROUP` and commits MySQL transactions before issuing `XACK`.
> - **15-Minute Countdown Starting Point**: The 15-minute TTL starts at MySQL insert time (`booked_at = NOW()`). Records older than 15 minutes are instantly excluded at the SQL query level and physically purged by a background sweeper running every 30 seconds.
> - **Clean Purge on Reset**: `POST /api/reset` clears Redis queues/inventory and truncates/deletes active MySQL `bookings` (cascading to `passengers`).

---

## Proposed Changes

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PROPOSED SYSTEM TOPOLOGY                        │
└────────────────────────────────────────────────────────────────────────┘

 [ Client / Rush Simulator ]
             │ POST /api/book
             ▼
 [ Virtual Waiting Room (queue.js) ]
             │ Atomic BOOK_LUA (tickets:remaining:<class>)
             ├───────────────────────────────────────────┐
             │ WON (Seats > 0)                           │ LOST
             ▼                                           ▼
 [ Redis Stream: tatkal:stream:persistence ]     [ Mark LOST in Hash ]
             │
             │ XREADGROUP (Batch: 50, Block: 100ms)
             ▼
 [ Persistence Worker: backend/persistence.js ]
             │
             ├── 1. Generate Authentic 10-Digit PRS PNR (e.g. 284-XXXXXXX)
             ├── 2. Generate Passenger Manifest (1-4 passengers for bots)
             ├── 3. Open MySQL Transaction (pool.getConnection())
             ├── 4. Bulk INSERT `bookings` (booked_at = NOW())
             ├── 5. Bulk INSERT `passengers` (ON DELETE CASCADE)
             ├── 6. COMMIT & XACK
             └── 7. Update Redis Hash with real PNR & berths
             │
             ▼
 ┌───────────────────────────────────────────────────────────────┐
 │                  MySQL / TiDB Relational Layer                │
 │  bookings (Master) ──ON DELETE CASCADE──► passengers (Child)  │
 └───────────────────────────────────────────────────────────────┘
             ▲
             │ Background Sweeper (Every 30s)
 [ Sweeper: DELETE FROM bookings WHERE booked_at < NOW() - INTERVAL 15 MINUTE LIMIT 200 ]
```

---

### Database Layer

#### [MODIFY] [backend/schema.sql](file:///C:/Users/MAN%20PATEL/OneDrive/Desktop/test/backend/schema.sql)
- Add indexing on `bookings(booked_at)` and composite index `(pnr_number, booked_at)` for high-performance 15-minute TTL queries and chunked background deletions.
- Ensure compatibility with both MySQL 8.0 and TiDB Serverless.

```sql
-- Indexes for 15-Minute TTL and Active-Window Lookups
CREATE INDEX idx_bookings_booked_at ON bookings (booked_at);
CREATE INDEX idx_bookings_pnr_active ON bookings (pnr_number, booked_at);
```

---

### Backend Persistence Engine

#### [NEW] [backend/persistence.js](file:///C:/Users/MAN%20PATEL/OneDrive/Desktop/test/backend/persistence.js)
Create a self-contained persistence pipeline module featuring:
1. **Redis Stream Consumer**:
   - Stream: `tatkal:stream:persistence`
   - Group: `persistence-group`
   - Consumer: `worker-persistence-1`
   - Consumer initialization with `XGROUP CREATE ... MKSTREAM` (safely catching `BUSYGROUP`).
   - Message consumption via `XREADGROUP GROUP persistence-group worker-persistence-1 COUNT 50 BLOCK 100 STREAMS tatkal:stream:persistence >`.
   - Pending entries recovery via `XPENDING` / `XCLAIM` on startup to prevent lost jobs on server crash.
2. **Authentic PNR & Berth Generator**:
   - Generates 10-digit Indian Railways PRS PNRs (e.g., zone prefixes `284`, `425`, `632`, `814` + 7 random numeric digits).
   - Generates realistic coach allocations (e.g. `B1`-`B5` for 3A, `A1`-`A2` for 2A, `H1` for 1A, `S1`-`S4` for SL) and berth numbers (1-72) with berth types (`Lower`, `Middle`, `Upper`, `Side Lower`, `Side Upper`).
   - For bot bookings without manifests, generates randomized passenger counts (1 to 4 passengers) with realistic names, ages, and genders.
3. **Micro-Batch MySQL Transaction Pipeline**:
   - Acquires a connection from `pool`.
   - Executes multi-row `INSERT INTO bookings` and multi-row `INSERT INTO passengers` within `START TRANSACTION ... COMMIT`.
   - On commit, calls `XACK` for processed stream IDs.
   - Updates the client-facing Redis job hash (`tatkal:job:<jobId>`) with the real PNR and berths so live polling receives the exact database-backed ticket.
4. **15-Minute Auto-Purge Sweeper**:
   - Runs on a 30-second interval timer.
   - Executes `DELETE FROM bookings WHERE booked_at < NOW() - INTERVAL 15 MINUTE LIMIT 200`.
   - Loops until 0 rows affected to cleanly drain large batches without locking MySQL tables.
   - Purged rows automatically cascade to `passengers` via `FOREIGN KEY ... ON DELETE CASCADE`.
5. **Clean Reset Method**:
   - Purges Redis stream: `redis.del('tatkal:stream:persistence')`.
   - Executes `DELETE FROM bookings` in MySQL/TiDB.

---

### Backend API & Worker Orchestration

#### [MODIFY] [backend/queue.js](file:///C:/Users/MAN%20PATEL/OneDrive/Desktop/test/backend/queue.js)
- When a booking wins (`won === true`), trigger the persistence callback with the job metadata so it can be appended to Redis Stream `tatkal:stream:persistence`.
- In `getStatus(jobId)`, return persisted metadata (PNR, coach, berth, passengers) if available on the Redis hash.

#### [MODIFY] [backend/index.js](file:///C:/Users/MAN%20PATEL/OneDrive/Desktop/test/backend/index.js)
- Instantiate and start `PersistencePipeline`.
- Attach persistence stream publisher to `waitingQueue.onBookingProcessed(...)`.
- Add **`GET /api/pnr/:pnrNumber`**:
  - Validates 10-digit format (`/^\d{10}$/`).
  - Queries `bookings` joined with `passengers` and `trains`, filtering `b.booked_at >= NOW() - INTERVAL 15 MINUTE`.
  - Calculates `ttlRemainingSeconds = 900 - TIMESTAMPDIFF(SECOND, booked_at, NOW())`.
  - Returns `404` if not found or if the 15-minute TTL has elapsed.
- Add **`GET /api/persistence/telemetry`**:
  - Exposes stream length, total persisted, total purged, active database count, and sweeper health.
- Update **`POST /api/reset`**:
  - Invokes `persistencePipeline.reset()` to wipe both Redis stream and MySQL `bookings`/`passengers` tables.
- Update **`RushSimulator`**:
  - All 320 winning bot bookings are streamed to `PersistencePipeline`, writing full randomized passenger manifests to MySQL.

---

### Frontend PNR Status Tab & UX

#### [MODIFY] [frontend/src/App.jsx](file:///C:/Users/MAN%20PATEL/OneDrive/Desktop/test/frontend/src/App.jsx)
- **Top Navigation**: Add active view toggle for `pnr` tab (`currentView === 'pnr'`) alongside `HOME` and `TRAINS & BOOKING`.
- **Card Header Tab Integration**: Clicking `PNR STATUS` on the hero floating card opens the PNR Enquiry tab.
- **PNR Status View Component**:
  - Search Card: 10-digit input field with live validation, "GET PNR STATUS" button, and quick-fill button for the user's latest confirmed ticket.
  - Live Countdown HUD: Visual badge showing `TTL Remaining: MM:SS` that ticks down in real time every second. Changes color (Green -> Amber -> Red).
  - Confirmed E-Ticket Card: Displays Train name/number, Route, Date, Class, Quota, Total Fare, and the passenger manifest table with Coach, Berth Number, and Berth Type.
  - Vanished Ticket Alert: When the timer expires or API returns 404, smoothly transitions to an alert: *"PNR has expired and vanished from the database as per 15-minute simulation policy."*
- **Booking Confirmation Modal**: When a user wins a booking, show the real generated PNR and provide a "Track PNR Status" button that navigates directly to the PNR tab.

#### [MODIFY] [frontend/src/App.css](file:///C:/Users/MAN%20PATEL/OneDrive/Desktop/test/frontend/src/App.css)
- Add styles for the PNR enquiry container, search bar, live countdown badge, passenger manifest table, and expiration banner matching the IRCTC design system.

---

## Verification Plan

### Automated Tests
Create an automated test script [`backend/test-persistence.js`](file:///C:/Users/MAN%20PATEL/OneDrive/Desktop/test/backend/test-persistence.js):
1. **PNR Uniqueness Test**: Generate 1,000 PNRs and assert 0 collisions and strict 10-digit compliance.
2. **Pipeline End-to-End Test**:
   - Enqueue a test booking into Redis stream.
   - Wait for worker batch cycle.
   - Assert record exists in MySQL `bookings` and `passengers`.
   - Assert `GET /api/pnr/:pnrNumber` returns `200 OK` with valid `ttlRemainingSeconds <= 900`.
3. **15-Minute Expiration Verification**:
   - Manually insert a test booking with `booked_at = NOW() - INTERVAL 16 MINUTE`.
   - Assert `GET /api/pnr/:pnrNumber` returns `404 Not Found`.
   - Run sweeper iteration; assert row is physically purged from MySQL `bookings` and cascaded from `passengers`.
4. **Rush Simulator Concurrency & Purge Test**:
   - Reset via `POST /api/reset`.
   - Run `/api/storm` with 1,400 virtual users.
   - Assert all 320 winning seats persist to MySQL with valid PNRs and passenger counts.
   - Assert zero overselling (`remaining === 0` and total wins `=== 320`).

Run with:
```bash
node backend/test-persistence.js
```

### Manual Verification
1. **Human Booking Flow**:
   - Open frontend at `http://localhost:5173`.
   - Search trains and book a Tatkal ticket.
   - Observe real 10-digit PNR in confirmation modal.
   - Click "Track PNR Status" or open "PNR STATUS" tab.
   - Verify ticket details, passenger berth allocation, and live countdown timer.
2. **Vanishing Verification**:
   - Observe countdown timer reaching zero, or simulate expiration by updating `booked_at`.
   - Verify UI transitions to the expired/vanished notification.
