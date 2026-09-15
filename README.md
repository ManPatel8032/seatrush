# SeatRush (High-Throughput Flash-Sale Ticketing Engine)

A high-concurrency ticket reservation engine simulating the **IRCTC Tatkal** flash-sale rush, built to handle extreme traffic spikes, zero overselling, and race-condition elimination using Redis Lua scripting, two-phase distributed locks, and ACID persistence.

---

## 🏗️ Architecture Overview

- **Frontend (`/frontend`)**: React 19 + Vite dashboard for live seat booking, status polling, and stress-testing visualization.
- **Backend (`/backend`)**: Node.js + Express REST API backed by Redis in-memory atomic locks and MySQL relational persistence.
- **Atomic Engine**: Evaluates inventory decrement inside Redis Lua scripts to eliminate race conditions under concurrent network storms.

---

## 🚀 Quick Start

### 1. Backend Setup
```bash
cd backend
npm install
cp .env.example .env
npm start
```

### 2. Frontend Setup
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

### 3. Concurrency Stress Test
```bash
node backend/load-test.js
```
