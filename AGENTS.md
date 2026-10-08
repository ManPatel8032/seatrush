# AGENTS.md — SeatRush Project Context & Engineering Guide

## 1. Project Overview & Mission
**SeatRush** is a high-concurrency ticket reservation engine and distributed systems simulation modeled after the **IRCTC Tatkal flash sale**. During peak Tatkal windows (10:00 AM AC / 11:00 AM Non-AC), hundreds of thousands of users attempt to reserve limited inventory at the exact same millisecond.

The mission of SeatRush is to solve the classic flash-sale trilemma:
1. **Mathematical Zero Overselling**: Guarantee that not a single ticket beyond available inventory is ever allocated under concurrency bursts.
2. **Sub-Millisecond Response Times**: Absorb massive request spikes at the edge without database connection exhaustion or disk I/O bottlenecks.
3. **Bot & Race-Condition Mitigation**: Shield the system from automated scripts using token-bucket rate limiting and an asynchronous virtual waiting room.

---

## 2. Architecture & Technology Stack
- **Frontend**: React 19, Vite, custom SVG icon system (`frontend/src/components/Icons.jsx`), authentic Indian Railways design system, responsive Vanilla CSS.
- **Backend API**: Node.js, Express, `ioredis` (connection pool & Lua scripting), `mysql2/promise` (connection pooling with TiDB/MySQL support).
- **In-Memory & Cache Layer**: Redis (Atomic Lua script execution, Token-Bucket Rate Limiter, Sorted-Set Virtual Waiting Room).
- **Relational Persistence**: MySQL 8.0 / TiDB Serverless (Normalized 3NF relational schema with 9 tables, foreign keys, and indexes).
- **Stress & Load Testing**: k6 distributed load testing (`loadtest.js`) and built-in staggered Rush Simulator (`RushSimulator`).

```
[ Client Browser / k6 Virtual Users ]
                   │
                   ▼
[ 1. API Gateway Layer: backend/gateway.js ]
   ├── Global Surge Shield (Capacity: 2,500 tokens, Refill: 500/s)
   └── Per-User Bot Limiter (Capacity: 5 tokens, Refill: 2/s)
                   │ (HTTP 202 Accepted in ~2ms)
                   ▼
[ 2. Virtual Waiting Room: backend/queue.js ]
   ├── Redis Sorted Set: tatkal:queue:booking (Score: Timestamp)
   └── Position Lookup: ZRANK (Instant live queue position)
                   │
                   ▼ (Background Worker: 25 jobs every 50ms)
[ 3. Atomic Inventory Engine: Redis Lua in backend/index.js ]
   ├── Key: tickets:remaining:<class> (1A, 2A, 3A, SL)
   └── BOOK_LUA script: atomic check-and-decrement (Zero Race Conditions)
                   │
                   ▼ (Asynchronous Persistence Pipeline)
[ 4. ACID Relational Database: MySQL / TiDB via backend/db.js ]
   └── bookings, passengers, inventory_quotas, train_schedules
```

---

## 3. Directory Structure & Key Files
- `backend/index.js`: Express application bootstrap, API routing, Redis connection, and multi-class rush simulator controller.
- `backend/gateway.js`: API Gateway with Redis Lua-backed Token-Bucket rate limiting middleware (`createRateLimiter`).
- `backend/queue.js`: `WaitingRoomQueue` engine utilizing Redis Sorted Sets (`ZSET`) and an asynchronous batch worker.
- `backend/db.js`: MySQL / TiDB connection pool configured with IPv4-first DNS resolution and SSL support.
- `backend/schema.sql`: 3NF relational schema (stations, trains, coaches, schedules, inventory_quotas, bookings, passengers).
- `backend/seed.js`: Database seeding script populating stations, trains, intermediate stops, and inventory quotas.
- `backend/load-test.js`: Local Node.js concurrency script firing 200 simultaneous booking requests via native `fetch`.
- `frontend/src/App.jsx`: Full IRCTC portal containing Home view, Search, Live Results, Waiting Room modal, and Telemetry HUD.
- `frontend/src/App.css`: Design rules for IRCTC navigation, search hero, train cards, class chips, modals, and telemetry grids.
- `frontend/src/index.css`: Global design tokens, color palette, typography definitions, and CSS reset.
- `frontend/src/components/Icons.jsx`: Handcrafted, dependency-free SVG icon library tailored for Indian Railways UI.
- `loadtest.js`: k6 stress-test script simulating 2,000 iterations across 100 VUs with HTTP 202 polling.
- `results.json`: Output metrics from k6 load testing proving zero overselling under heavy concurrency.

---

## 4. Core Concurrency & Distributed Systems Mechanisms

### A. Atomic Inventory Decoupling (Redis Lua Script)
- Inventory check-and-decrement runs inside Redis using an atomic Lua script (`BOOK_LUA`).
- Because Redis executes Lua scripts as a single atomic unit on its main thread, no other read or write can interleave.
- Eliminates Time-of-Check to Time-of-Use (TOCTOU) race conditions completely.
- Inventory is segmented into 4 classes: `1A`, `2A`, `3A`, and `SL` (80 seats each = 320 seats total per train run).

### B. Two-Tier API Gateway Shield (`gateway.js`)
- **Global Surge Shield**: Capacity of 2,500 tokens, refills at 500/sec. Absorbs massive booking spikes without server crashes.
- **Per-User Bot Limiter**: Capacity of 5 tokens, refills at 2/sec per IP/userId. Stops automated scripts from hoarding seats.
- Attaches standard RFC headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`) and returns HTTP 429 when exhausted.

### C. Virtual Waiting Room Queue (`queue.js`)
- Users entering a flash sale are enqueued into a Redis Sorted Set (`tatkal:queue:booking`) with timestamp scores.
- Clients immediately receive `HTTP 202 Accepted` with a `jobId`, initial queue rank (`position`), and estimated wait time in ~2ms.
- A background worker drains 25 jobs every 50ms (up to 500 bookings/sec), runs the Lua script, and sets status to `COMPLETED`.
- Clients poll `GET /api/book/status/:jobId` to monitor live progress and receive their booking outcome.

### D. Multi-Class Rush Simulator (`RushSimulator` in `backend/index.js`)
- In-memory test engine simulating 1,400 concurrent users arriving over a configurable duration (default 40s).
- Users are randomly assigned across classes (`1A`, `2A`, `3A`, `SL`). Real human users can compete against bots in real time.

---

## 5. End-to-End Booking Data Flow
1. **User Request**: Client sends `POST /api/book` with `{ userId, classCode }`.
2. **Gateway Check**: Rate limiter checks token bucket via Redis Lua (`TOKEN_BUCKET_LUA`). If tokens < 1, returns `HTTP 429`.
3. **Queue Ingestion**: Request enqueued via `ZADD tatkal:queue:booking <timestamp> <jobId>` and metadata stored in Hash `tatkal:job:<jobId>`.
4. **Instant Acknowledgment**: Server returns `HTTP 202 Accepted` with initial rank within 2ms.
5. **Worker Execution**: Background worker pops batch (`ZPOPMIN 25`), runs atomic `BOOK_LUA` against `tickets:remaining:<classCode>`.
6. **Result Polling**: Frontend polls `GET /api/book/status/:jobId`. Once `status === 'COMPLETED'`, returns `won: true/false`.
7. **Confirmation**: If won, frontend displays IRCTC E-Ticket with PNR, coach (`B4`), and berth allocation (`Lower (LB)`).

---

## 6. Database Schema & Data Models (`schema.sql`)
The relational persistence layer is normalized to 3NF:
1. `stations`: Code (PK: `NDLS`, `MMCT`, etc.), name, city, state.
2. `travel_classes`: Code (`1A`, `2A`, `3A`, `SL`), name, base fare.
3. `quotas`: Code (`GN`, `TQ`, `PT`, `LD`), quota description.
4. `trains`: Train number, name, type (`SUPERFAST`, `RAJDHANI`), source/dest stations, operating days.
5. `train_coaches`: Physical rake layout mapping trains to coaches and berth capacities.
6. `train_schedules`: Multi-stop route definitions with arrival/departure times, distance (km), and day offset.
7. `inventory_quotas`: Relational seat balance and waitlist counts per train, journey date, class, and quota.
8. `bookings`: Master ticket records with unique 10-digit PNR, contact details, total fare, and status (`CONFIRMED`, `WAITLISTED`).
9. `passengers`: Individual traveler records with age, gender, berth preference, and allocated coach/berth.

---

## 7. API Endpoints Reference
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/stations` | Returns list of railway stations from MySQL (fallback to default array). |
| `GET` | `/api/trains/search?from=&to=&date=&quota=` | Multi-stop schedule search calculating duration, km, and live class availability. |
| `GET` | `/api/status` | Returns total remaining seats and per-tier counts (`1A`, `2A`, `3A`, `SL`). |
| `POST` | `/api/book` | Rate-limited booking intake. Enqueues request into Waiting Room (`HTTP 202 Accepted`). |
| `GET` | `/api/book/status/:jobId` | Polls current queue position or final booking outcome (`won: true/false`). |
| `POST` | `/api/reset` | Clears waiting queue and resets all Redis seat tiers to 80 (320 total). |
| `POST` | `/api/storm` | Launches 1,400-user multi-class rush simulation across a 40-second window. |
| `GET` | `/api/storm/status` | Real-time telemetry: enqueued users, bot wins, human wins, remaining seats, zero-oversell flag. |
| `POST` | `/api/storm/stop` | Halts the active simulation and clears remaining timers. |

---

## 8. Frontend User Experience (`App.jsx`)
- **Navigation Views**: Toggles between `home` view (hero train banner, search card, services) and `results` view (train list & telemetry).
- **Search Engine**: Station dropdowns with `⇄` Swap button, dynamic date picker, class/quota selectors, and intermediate stop resolution.
- **Live Class Chips**: Real-time inventory cards (`AVAILABLE - 0080` vs `REGRET / WL`) synchronized with Redis.
- **Waiting Room Modal**: Visual progress bar indicating live queue rank and estimated wait time before displaying confirmation.
- **E-Ticket Generator**: Generates realistic IRCTC E-Ticket modal with PNR, coach (`B4`), and berth allocation (`Lower (LB)`).
- **Telemetry HUD**: Live dashboard showing real-time concurrency metrics, win/loss breakdowns, and zero-oversell checks.

---

## 9. Common Commands & Workflows
```bash
# Backend Development
cd backend
npm install
npm start               # Starts Express on http://localhost:3000

# Frontend Development
cd frontend
npm install
npm run dev             # Starts Vite on http://localhost:5173

# Database Seeding
cd backend
node seed.js            # Seeds MySQL / TiDB schema with railway routes

# Concurrency Verification
node backend/load-test.js # Node-based 200-user parallel test
k6 run loadtest.js      # k6 2,000-iteration distributed stress test
```

---

## 10. Conventions & Critical Guidelines for AI Agents
1. **Preserve Atomicity**: Never replace Redis Lua inventory checks with database queries during high-concurrency booking paths.
2. **Asynchronous Persistence**: All database writes from high-volume operations must be decoupled via queue workers or background batches.
3. **Windows IPv4 DNS Setting**: Always preserve `dns.setDefaultResultOrder("ipv4first")` in `db.js` to avoid Windows NAT64 lookup timeouts.
4. **Design System Consistency**: Maintain Indian Railways color tokens (`--irctc-blue: #0f2b5c`, `--irctc-orange: #fb641b`) and use icons from `frontend/src/components/Icons.jsx`.
5. **Environment Configuration**:
   - `PORT`: Server port (default 3000).
   - `REDIS_URL`: Redis connection string (local or cloud).
   - `DATABASE_URL`: MySQL / TiDB connection string with SSL parameters.
   - `CLIENT_URL` / `VITE_API_URL`: Cross-Origin communication between Vite and Express.
6. **No Breaking Changes**: When adding features (e.g. user authentication or PNR status check), ensure existing stress-test endpoints (`/api/storm`, `/api/book`) remain functional.
