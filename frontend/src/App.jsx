import { useEffect, useState } from "react";
import "./App.css";

const API = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/$/, "");

const STATIONS = [
  { code: "NDLS", name: "New Delhi" },
  { code: "MMCT", name: "Mumbai Central" },
  { code: "HWH", name: "Howrah Jn" },
  { code: "MAS", name: "Chennai Central" },
  { code: "SBC", name: "KSR Bengaluru" },
  { code: "ADI", name: "Ahmedabad Jn" },
];

const QUOTAS = [
  { id: "TQ", label: "TATKAL" },
  { id: "GN", label: "GENERAL" },
  { id: "PT", label: "PREMIUM TATKAL" },
  { id: "LD", label: "LADIES" },
];

const CLASSES = [
  { id: "3A", name: "AC 3 Tier (3A)", fare: "₹ 1,740" },
  { id: "2A", name: "AC 2 Tier (2A)", fare: "₹ 2,490" },
  { id: "1A", name: "AC First Class (1A)", fare: "₹ 4,120" },
  { id: "SL", name: "Sleeper (SL)", fare: "₹ 685" },
];

function App() {
  // Search Form State
  const [source, setSource] = useState("NDLS");
  const [destination, setDestination] = useState("MMCT");
  const [journeyDate, setJourneyDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split("T")[0];
  });
  const [quota, setQuota] = useState("TQ");
  const [selectedClass, setSelectedClass] = useState("3A");

  // Backend Engine State
  const [remaining, setRemaining] = useState(null);
  const [backendOnline, setBackendOnline] = useState(true);
  const [passengerName, setPassengerName] = useState("");
  const [isBooking, setIsBooking] = useState(false);
  const [bookingResult, setBookingResult] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Storm Simulation Telemetry
  const [isStorming, setIsStorming] = useState(false);
  const [stormStats, setStormStats] = useState(null);

  // Fetch Live Inventory from Redis Backend
  async function fetchStatus() {
    try {
      const res = await fetch(`${API}/api/status`);
      if (!res.ok) throw new Error("Backend offline");
      const data = await res.json();
      setRemaining(data.remaining);
      setBackendOnline(true);
    } catch {
      setBackendOnline(false);
      setRemaining(null);
    }
  }

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // Station Swap Handler
  function handleSwapStations() {
    const temp = source;
    setSource(destination);
    setDestination(temp);
  }

  // Book Tatkal Ticket Handler
  async function handleBookTicket() {
    if (!passengerName.trim()) {
      alert("Please enter Passenger Name / User ID to reserve Tatkal seat.");
      return;
    }

    setIsBooking(true);
    setBookingResult(null);

    try {
      const res = await fetch(`${API}/api/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: passengerName.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setBookingResult({ success: false, message: data.error || "Booking failed." });
      } else if (data.won) {
        // Generate pseudo-realistic IRCTC PNR and Seat details
        const randomPnr = Math.floor(2000000000 + Math.random() * 9000000000);
        const coaches = ["B1", "B2", "B3", "B4", "B5"];
        const berthTypes = ["Lower (LB)", "Middle (MB)", "Upper (UB)", "Side Lower (SL)"];
        const randomCoach = coaches[Math.floor(Math.random() * coaches.length)];
        const randomBerthNo = Math.floor(Math.random() * 64) + 1;
        const randomBerthType = berthTypes[Math.floor(Math.random() * berthTypes.length)];

        setBookingResult({
          success: true,
          pnr: randomPnr,
          passenger: passengerName.trim(),
          coach: `${randomCoach} - ${randomBerthNo}`,
          berthType: randomBerthType,
          classType: selectedClass,
          quota,
          train: "12952 / TEJAS RAJ EXPRESS",
        });
      } else {
        setBookingResult({
          success: false,
          message: "REGRET / TATKAL QUOTA EXHAUSTED: Zero seats remaining.",
        });
      }

      await fetchStatus();
    } catch (err) {
      setBookingResult({ success: false, message: "Network error contacting SeatRush backend." });
    } finally {
      setIsBooking(false);
      setIsModalOpen(true);
    }
  }

  // Storm Simulation Handler (200 Concurrent Bookings)
  async function handleRunStorm() {
    setIsStorming(true);
    setStormStats(null);
    try {
      const startTime = performance.now();
      const res = await fetch(`${API}/api/storm`, { method: "POST" });
      const data = await res.json();
      const durationMs = Math.round(performance.now() - startTime);

      setStormStats({
        ...data,
        latencyMs: durationMs,
      });
      setRemaining(data.remaining);
    } catch (err) {
      alert("Failed to execute storm test. Ensure backend is running.");
    } finally {
      setIsStorming(false);
    }
  }

  // Inventory Reset Handler
  async function handleResetInventory() {
    try {
      const res = await fetch(`${API}/api/reset`, { method: "POST" });
      const data = await res.json();
      setRemaining(data.remaining);
      setStormStats(null);
      alert("Redis Tatkal Inventory reset to 10 tickets.");
    } catch {
      alert("Could not reset inventory.");
    }
  }

  return (
    <div className="irctc-layout">
      {/* 1. IRCTC Header */}
      <header className="irctc-header">
        <div className="header-container">
          <div className="brand-section">
            <div className="brand-logo-badge">IR</div>
            <div>
              <div className="brand-title">
                INDIAN RAILWAYS <span>SeatRush</span>
              </div>
              <small style={{ color: "#94a3b8", fontSize: "11px" }}>
                High-Concurrency Flash-Sale Ticketing Simulator
              </small>
            </div>
          </div>

        </div>
      </header>

      {/* 2. Main Body */}
      <main className="main-content">
        {/* Search Hero Card */}
        <section className="search-card">
          <div className="search-card-header">
            <div className="search-title">
              <span>🚆</span> BOOK TRAIN TICKET
            </div>
            <div className="tatkal-timer-banner">
              ⚡ TATKAL WINDOW OPEN: 10:00 AM (AC) / 11:00 AM (NON-AC)
            </div>
          </div>

          <div className="search-form-grid">
            {/* From Station */}
            <div className="form-group">
              <label className="form-label">From</label>
              <select
                className="form-control"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                {STATIONS.map((s) => (
                  <option key={s.code} value={s.code} disabled={s.code === destination}>
                    {s.code} - {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Swap Button */}
            <button
              type="button"
              className="swap-btn"
              onClick={handleSwapStations}
              title="Swap Stations"
            >
              ⇄
            </button>

            {/* To Station */}
            <div className="form-group">
              <label className="form-label">To</label>
              <select
                className="form-control"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                {STATIONS.map((s) => (
                  <option key={s.code} value={s.code} disabled={s.code === source}>
                    {s.code} - {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Picker */}
            <div className="form-group">
              <label className="form-label">Date of Journey</label>
              <input
                type="date"
                className="form-control"
                value={journeyDate}
                min={new Date().toISOString().split("T")[0]}
                onChange={(e) => setJourneyDate(e.target.value)}
              />
            </div>

            {/* Quota Picker */}
            <div className="form-group">
              <label className="form-label">Quota</label>
              <select
                className="form-control font-mono"
                value={quota}
                onChange={(e) => setQuota(e.target.value)}
              >
                {QUOTAS.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Search Submit */}
            <button type="button" className="search-submit-btn">
              Search Trains
            </button>
          </div>

          {/* Quick Filter Checkboxes */}
          <div className="quick-options">
            <label className="checkbox-label">
              <input type="checkbox" defaultChecked /> Person With Disability Concession
            </label>
            <label className="checkbox-label">
              <input type="checkbox" defaultChecked /> Flexible With Date
            </label>
            <label className="checkbox-label">
              <input type="checkbox" defaultChecked /> Train with Available Berth
            </label>
          </div>
        </section>

        {/* Train Results Section */}
        <section>
          <div className="trains-section-header">
            <h3>Available Trains ({source} ➔ {destination})</h3>
            <span className="train-count-badge">Quota: {quota}</span>
          </div>

          {/* Train Card 1: 12952 Tejas Rajdhani (Connected to Live Redis Inventory) */}
          <div className="train-card">
            <div className="train-card-header">
              <div className="train-title-box">
                <span className="train-name">12952 / TEJAS RAJ EXPRESS</span>
                <span className="train-type-tag">SUPERFAST SPECIAL</span>
              </div>
              <div className="train-days">Runs On: M T W T F S S</div>
            </div>

            <div className="train-schedule-grid">
              <div className="schedule-point left">
                <div className="station-time">16:55</div>
                <div className="station-code">{source}</div>
                <div className="station-name">Origin Terminal</div>
              </div>

              <div className="duration-box">
                <span className="duration-text">15h 40m</span>
                <div className="duration-line" />
                <span style={{ fontSize: "11px", color: "#64748b" }}>Non-Stop Priority</span>
              </div>

              <div className="schedule-point right">
                <div className="station-time">08:35</div>
                <div className="station-code">{destination}</div>
                <div className="station-name">Next Day Arrival</div>
              </div>
            </div>

            {/* Classes with Real-time Redis Seat Counter */}
            <div className="train-classes-container">
              <div className="classes-grid">
                {CLASSES.map((cls) => {
                  const isLiveClass = cls.id === "3A";
                  const isAvailable = isLiveClass
                    ? remaining !== null && remaining > 0
                    : true;

                  return (
                    <div
                      key={cls.id}
                      className={`class-chip ${selectedClass === cls.id ? "selected" : ""}`}
                      onClick={() => setSelectedClass(cls.id)}
                    >
                      <div className="chip-header">
                        <span className="chip-tier">{cls.name}</span>
                        <span className="chip-fare">{cls.fare}</span>
                      </div>
                      <div className="chip-status">
                        {isLiveClass ? (
                          remaining === null ? (
                            <span style={{ color: "#94a3b8" }}>Connecting…</span>
                          ) : remaining > 0 ? (
                            <span className="status-available">
                              CURR_AVL - 00{remaining}
                            </span>
                          ) : (
                            <span className="status-soldout">REGRET / WL</span>
                          )
                        ) : (
                          <span className="status-available">AVAILABLE - 42</span>
                        )}
                        {isLiveClass && (
                          <span className="live-sync-indicator font-mono">REDIS LIVE</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Actions Bar */}
            <div className="train-actions-bar">
              <div className="selected-quota-summary">
                Selected Class: <strong>{selectedClass}</strong> | Quota: <strong>{quota}</strong> |{" "}
                Live Tatkal Berth Balance:{" "}
                <strong style={{ color: remaining > 0 ? "#15803d" : "#dc2626" }}>
                  {remaining ?? "…"}
                </strong>
              </div>

              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Passenger Name / ID"
                  value={passengerName}
                  onChange={(e) => setPassengerName(e.target.value)}
                  className="form-control"
                  style={{ width: "200px" }}
                />
                <button
                  type="button"
                  className="book-tatkal-btn"
                  onClick={handleBookTicket}
                  disabled={isBooking || remaining === 0 || !backendOnline}
                >
                  {isBooking ? "Reserving…" : "Book Tatkal Now"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Concurrency Stress-Test Dashboard */}
        <section className="simulator-panel">
          <div className="simulator-header">
            <div className="sim-title">
              <span>⚡</span> Tatkal Concurrency Stress Simulator (Tatkal Rush Engine)
            </div>
            <div className="sim-controls">
              <button
                type="button"
                className="sim-btn"
                onClick={handleRunStorm}
                disabled={isStorming || !backendOnline}
              >
                {isStorming ? "Simulating Network Storm…" : "Simulate 200 Tatkal Rush Users"}
              </button>
              <button
                type="button"
                className="sim-btn sim-btn-danger"
                onClick={handleResetInventory}
              >
                Reset Inventory (10 Seats)
              </button>
            </div>
          </div>

          <p style={{ fontSize: "13px", color: "#cbd5e1", lineHeight: "1.5" }}>
            Fires 200 concurrent HTTP reservations against the Redis Lua atomic engine in parallel.
            Guarantees zero overselling under race conditions.
          </p>

          {stormStats && (
            <div className="telemetry-grid">
              <div className="telemetry-card">
                <div className="telemetry-label">Concurrent Users</div>
                <div className="telemetry-value font-mono">{stormStats.users}</div>
              </div>
              <div className="telemetry-card">
                <div className="telemetry-label">Confirmed Bookings</div>
                <div className="telemetry-value font-mono" style={{ color: "#4ade80" }}>
                  {stormStats.wins}
                </div>
              </div>
              <div className="telemetry-card">
                <div className="telemetry-label">Quota Exhausted (Lost)</div>
                <div className="telemetry-value font-mono" style={{ color: "#f87171" }}>
                  {stormStats.losses}
                </div>
              </div>
              <div className="telemetry-card">
                <div className="telemetry-label">Zero Oversell Check</div>
                <div
                  className="telemetry-value font-mono"
                  style={{ color: stormStats.ok ? "#4ade80" : "#ef4444" }}
                >
                  {stormStats.ok ? "PASSED (0 OVERSELL)" : "FAILED"}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* 4. Booking Modal / E-Ticket Dialog */}
      {isModalOpen && bookingResult && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                {bookingResult.success ? "🎉 Tatkal Ticket Confirmed!" : "Booking Status"}
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setIsModalOpen(false)}
              >
                &times;
              </button>
            </div>

            {bookingResult.success ? (
              <div className="ticket-receipt">
                <div className="ticket-pnr-row">
                  <div>
                    <div style={{ fontSize: "11px", color: "#166534", fontWeight: 700 }}>
                      PNR NUMBER
                    </div>
                    <div className="pnr-number font-mono">{bookingResult.pnr}</div>
                  </div>
                  <span className="ticket-badge-confirmed">CONFIRMED (CNF)</span>
                </div>

                <div className="ticket-detail-grid">
                  <div>
                    <strong>Passenger:</strong> {bookingResult.passenger}
                  </div>
                  <div>
                    <strong>Train:</strong> {bookingResult.train}
                  </div>
                  <div>
                    <strong>Coach / Berth:</strong> {bookingResult.coach}
                  </div>
                  <div>
                    <strong>Berth Type:</strong> {bookingResult.berthType}
                  </div>
                  <div>
                    <strong>Class:</strong> {bookingResult.classType}
                  </div>
                  <div>
                    <strong>Quota:</strong> {bookingResult.quota}
                  </div>
                </div>
              </div>
            ) : (
              <div className="ticket-error">
                <p style={{ fontWeight: 700, marginBottom: "6px" }}>Reservation Failed</p>
                <p style={{ fontSize: "13px" }}>{bookingResult.message}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
