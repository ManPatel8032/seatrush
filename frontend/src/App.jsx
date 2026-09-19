import { useEffect, useState } from "react";
import "./App.css";

const API = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/$/, "");

const DEFAULT_STATIONS = [
  { code: "NDLS", name: "New Delhi" },
  { code: "MMCT", name: "Mumbai Central" },
  { code: "KOTA", name: "Kota Jn" },
  { code: "BRC",  name: "Vadodara Jn" },
  { code: "ST",   name: "Surat" },
  { code: "HWH",  name: "Howrah Jn" },
  { code: "CNB",  name: "Kanpur Central" },
  { code: "PRYJ", name: "Prayagraj Jn" },
  { code: "DDU",  name: "Pt Deen Dayal Upadhyaya" },
  { code: "GAYA", name: "Gaya Jn" },
  { code: "MAS",  name: "MGR Chennai Central" },
  { code: "AGC",  name: "Agra Cantt" },
  { code: "GWL",  name: "Gwalior Jn" },
  { code: "BPL",  name: "Bhopal Jn" },
  { code: "NGP",  name: "Nagpur Jn" },
  { code: "BZA",  name: "Vijayawada Jn" },
  { code: "SBC",  name: "KSR Bengaluru" },
  { code: "ADI",  name: "Ahmedabad Jn" },
];

const QUOTAS = [
  { id: "GN", label: "GENERAL" },
  { id: "TQ", label: "TATKAL" },
  { id: "PT", label: "PREMIUM TATKAL" },
  { id: "LD", label: "LADIES" },
];

const CLASSES = [
  { id: "ALL", name: "All Classes" },
  { id: "3A", name: "AC 3 Tier (3A)", fare: "₹ 1,740" },
  { id: "2A", name: "AC 2 Tier (2A)", fare: "₹ 2,490" },
  { id: "1A", name: "AC First Class (1A)", fare: "₹ 4,120" },
  { id: "SL", name: "Sleeper (SL)", fare: "₹ 685" },
];

function formatLiveTime(date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = String(date.getDate()).padStart(2, "0");
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const time = date.toTimeString().split(" ")[0];
  return `${day}-${month}-${year} [${time}]`;
}

function App() {
  // Navigation View State: 'home' | 'results'
  const [currentView, setCurrentView] = useState("home");

  // Live IRCTC Clock
  const [clockString, setClockString] = useState(() => formatLiveTime(new Date()));

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
  const [stations, setStations] = useState(DEFAULT_STATIONS);

  // Checkbox states
  const [disabilityConcession, setDisabilityConcession] = useState(false);
  const [flexibleDate, setFlexibleDate] = useState(true);
  const [passConcession, setPassConcession] = useState(false);

  // Search Results
  const [trainsList, setTrainsList] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  // Backend Engine & Redis State
  const [remaining, setRemaining] = useState(null);
  const [backendOnline, setBackendOnline] = useState(true);
  const [passengerName, setPassengerName] = useState("");
  const [isBooking, setIsBooking] = useState(false);
  const [bookingResult, setBookingResult] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Storm Simulation Telemetry
  const [isStorming, setIsStorming] = useState(false);
  const [stormStats, setStormStats] = useState(null);

  // 1. Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setClockString(formatLiveTime(new Date()));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 2. Fetch stations from backend MySQL
  useEffect(() => {
    async function loadStations() {
      try {
        const res = await fetch(`${API}/api/stations`);
        if (res.ok) {
          const data = await res.json();
          if (data.stations && data.stations.length > 0) {
            setStations(data.stations);
          }
        }
      } catch {
        // Keeps DEFAULT_STATIONS fallback
      }
    }
    loadStations();
  }, []);

  // 3. Fetch Live Inventory from Redis Backend
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

  // Swap Stations
  function handleSwapStations() {
    const temp = source;
    setSource(destination);
    setDestination(temp);
  }

  // Dynamic Search Trains Execution
  async function handleSearchTrains(e) {
    if (e) e.preventDefault();
    setIsSearching(true);
    setSearchError("");

    try {
      const res = await fetch(
        `${API}/api/trains/search?from=${source}&to=${destination}&date=${journeyDate}&quota=${quota}`
      );
      if (!res.ok) throw new Error("Failed to search trains");
      const data = await res.json();

      if (data.trains && data.trains.length > 0) {
        setTrainsList(data.trains);
      } else {
        // Fallback demo train if search route has no direct schedule in test DB
        setTrainsList([
          {
            train_id: 1,
            train_number: "12952",
            train_name: "TEJAS RAJ EXPRESS",
            train_type: "RAJDHANI SUPERFAST",
            runs_on: "M T W T F S S",
            origin_departure: "16:55",
            dest_arrival: "08:35",
            journey_km: 1384,
            duration: "15h 40m",
            classes: [
              { id: "3A", name: "AC 3 Tier (3A)", fare: "₹ 1,740", availableSeats: remaining ?? 10 },
              { id: "2A", name: "AC 2 Tier (2A)", fare: "₹ 2,490", availableSeats: 6 },
              { id: "1A", name: "AC First Class (1A)", fare: "₹ 4,120", availableSeats: 4 },
              { id: "SL", name: "Sleeper (SL)", fare: "₹ 685", availableSeats: 42 },
            ],
          },
        ]);
      }
      setCurrentView("results");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setSearchError("Could not reach backend train search engine.");
      // Still show fallback to allow testing
      setTrainsList([
        {
          train_id: 1,
          train_number: "12952",
          train_name: "TEJAS RAJ EXPRESS",
          train_type: "RAJDHANI SUPERFAST",
          runs_on: "M T W T F S S",
          origin_departure: "16:55",
          dest_arrival: "08:35",
          journey_km: 1384,
          duration: "15h 40m",
          classes: [
            { id: "3A", name: "AC 3 Tier (3A)", fare: "₹ 1,740", availableSeats: remaining ?? 10 },
            { id: "2A", name: "AC 2 Tier (2A)", fare: "₹ 2,490", availableSeats: 6 },
            { id: "1A", name: "AC First Class (1A)", fare: "₹ 4,120", availableSeats: 4 },
            { id: "SL", name: "Sleeper (SL)", fare: "₹ 685", availableSeats: 42 },
          ],
        },
      ]);
      setCurrentView("results");
    } finally {
      setIsSearching(false);
    }
  }

  // Book Tatkal Ticket Handler
  async function handleBookTicket(train) {
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
          train: `${train.train_number} / ${train.train_name}`,
        });
      } else {
        setBookingResult({
          success: false,
          message: "REGRET / TATKAL QUOTA EXHAUSTED: Zero seats remaining.",
        });
      }

      await fetchStatus();
    } catch {
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
    } catch {
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
      {/* 1. Official Authentic IRCTC Header */}
      <header className="irctc-top-header">
        {/* Top Info Bar */}
        <div className="top-utility-bar">
          <div className="utility-container">
            <span className="live-clock font-mono">{clockString}</span>
            <div className="accessibility-links">
              <button type="button">A-</button>
              <span>|</span>
              <button type="button">A</button>
              <span>|</span>
              <button type="button">A+</button>
              <span>|</span>
              <button type="button" className="lang-btn">हिंदी</button>
            </div>
          </div>
        </div>

        {/* Main Navbar */}
        <div className="main-navbar-container">
          <div className="nav-left-brand">
            <div className="railways-emblem-badge" title="Ministry of Railways">
              <svg viewBox="0 0 100 100" width="46" height="46" fill="#0f2b5c">
                <circle cx="50" cy="50" r="46" stroke="#0f2b5c" strokeWidth="4" fill="#ffffff" />
                <path d="M50 16 L53 26 L63 26 L55 32 L58 42 L50 36 L42 42 L45 32 L37 26 L47 26 Z" fill="#0f2b5c" />
                <circle cx="50" cy="58" r="18" fill="none" stroke="#0f2b5c" strokeWidth="3" />
                <circle cx="50" cy="58" r="4" fill="#0f2b5c" />
                <text x="50" y="86" fontSize="9" fontWeight="bold" textAnchor="middle" fill="#0f2b5c">
                  BHARATIYA RAIL
                </text>
              </svg>
            </div>
          </div>

          <nav className="nav-center-menu">
            <button type="button" className="nav-home-icon" onClick={() => setCurrentView("home")} title="Home">
              🏠
            </button>
            <button type="button" className="nav-login-btn">
              LOGIN / REGISTER
            </button>
            <button
              type="button"
              className={`nav-link-item ${currentView === "results" ? "active" : ""}`}
              onClick={() => setCurrentView("results")}
            >
              TRAINS
            </button>
            <span className="nav-link-item">MEALS</span>
            <span className="nav-loyalty-badge">LOYALTY</span>
            <span className="nav-link-item">E-WALLET</span>
            <span className="nav-link-item">ALERTS</span>
            <span className="nav-link-item">OTHER SERVICES</span>
            <span className="nav-link-item">CONTACT US</span>
          </nav>

          <div className="nav-right-logo">
            <div className="irctc-circular-logo" title="IRCTC Official">
              <span className="logo-letter font-mono">IRCTC</span>
            </div>
          </div>
        </div>
      </header>

      {/* 2. VIEW A: HOMEPAGE HERO (Matching Screenshot exactly) */}
      {currentView === "home" && (
        <main className="irctc-hero-section">
          {/* Hero Banner with Vande Bharat train styling */}
          <div className="hero-background-wrapper">
            <div className="hero-content-container">
              {/* Left Floating Card: BOOK TICKET */}
              <div className="booking-card-floating">
                {/* Header Tabs */}
                <div className="card-top-tabs">
                  <button type="button" className="tab-item active">
                    <span className="tab-icon">🎫</span> PNR STATUS
                  </button>
                  <button type="button" className="tab-item">
                    <span className="tab-icon">📋</span> CHARTS / VACANCY
                  </button>
                </div>

                <div className="card-body-form">
                  <h2 className="card-main-heading">BOOK TICKET</h2>

                  <form onSubmit={handleSearchTrains} className="form-fields-stack">
                    {/* From Station with Navigation Icon */}
                    <div className="input-with-icon">
                      <span className="field-icon">➔</span>
                      <div className="field-content">
                        <label className="input-floating-label">From</label>
                        <select
                          className="irctc-select"
                          value={source}
                          onChange={(e) => setSource(e.target.value)}
                        >
                          {stations.map((s) => (
                            <option key={s.code} value={s.code} disabled={s.code === destination}>
                              {s.code} - {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Swap Button */}
                    <div className="swap-button-row">
                      <button
                        type="button"
                        className="swap-circle-btn"
                        onClick={handleSwapStations}
                        title="Swap Origin & Destination"
                      >
                        ⇄
                      </button>
                    </div>

                    {/* To Station with Location Pin */}
                    <div className="input-with-icon">
                      <span className="field-icon">📍</span>
                      <div className="field-content">
                        <label className="input-floating-label">To</label>
                        <select
                          className="irctc-select"
                          value={destination}
                          onChange={(e) => setDestination(e.target.value)}
                        >
                          {stations.map((s) => (
                            <option key={s.code} value={s.code} disabled={s.code === source}>
                              {s.code} - {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Date Picker */}
                    <div className="input-with-icon">
                      <span className="field-icon">📅</span>
                      <div className="field-content">
                        <label className="input-floating-label">DD/MM/YYYY *</label>
                        <input
                          type="date"
                          className="irctc-date-input"
                          value={journeyDate}
                          min={new Date().toISOString().split("T")[0]}
                          onChange={(e) => setJourneyDate(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Classes Dropdown with Briefcase */}
                    <div className="input-with-icon">
                      <span className="field-icon">💼</span>
                      <div className="field-content">
                        <label className="input-floating-label">Class</label>
                        <select
                          className="irctc-select"
                          value={selectedClass}
                          onChange={(e) => setSelectedClass(e.target.value)}
                        >
                          {CLASSES.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Quota Dropdown with Grid */}
                    <div className="input-with-icon">
                      <span className="field-icon">⊞</span>
                      <div className="field-content">
                        <label className="input-floating-label">Quota</label>
                        <select
                          className="irctc-select font-mono"
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
                    </div>

                    {/* Concession Checkboxes */}
                    <div className="concession-checkboxes">
                      <label className="concession-item">
                        <input
                          type="checkbox"
                          checked={disabilityConcession}
                          onChange={(e) => setDisabilityConcession(e.target.checked)}
                        />
                        <span>Person With Disability Concession</span>
                      </label>
                      <label className="concession-item">
                        <input
                          type="checkbox"
                          checked={flexibleDate}
                          onChange={(e) => setFlexibleDate(e.target.checked)}
                        />
                        <span>Flexible With Date</span>
                      </label>
                      <label className="concession-item">
                        <input
                          type="checkbox"
                          checked={passConcession}
                          onChange={(e) => setPassConcession(e.target.checked)}
                        />
                        <span>Railway Pass Concession</span>
                      </label>
                    </div>

                    {/* Big Orange Search Button */}
                    <button type="submit" className="irctc-search-btn" disabled={isSearching}>
                      {isSearching ? "Searching Trains…" : "Search Trains"}
                    </button>
                  </form>
                </div>
              </div>

              {/* Right Hero Branding */}
              <div className="hero-railway-branding">
                <h1 className="hero-ir-title">INDIAN RAILWAYS</h1>
                <div className="hero-motto">
                  <span>Safety</span>
                  <span className="motto-pipe">|</span>
                  <span>Security</span>
                  <span className="motto-pipe">|</span>
                  <span>Punctuality</span>
                </div>
              </div>
            </div>
          </div>
        </main>
      )}

      {/* 3. VIEW B: SEARCH RESULTS PAGE (Dynamic Trains List) */}
      {currentView === "results" && (
        <main className="results-container">
          {/* Top Search Filter Summary Bar */}
          <div className="results-filter-bar">
            <button
              type="button"
              className="modify-search-btn"
              onClick={() => setCurrentView("home")}
            >
              ← Modify Search
            </button>

            <div className="route-summary-pill">
              <span className="pill-station">{source}</span>
              <span className="pill-arrow">➔</span>
              <span className="pill-station">{destination}</span>
              <span className="pill-pipe">|</span>
              <span className="pill-date">{journeyDate}</span>
              <span className="pill-pipe">|</span>
              <span className="pill-quota">Quota: {quota}</span>
              <span className="pill-pipe">|</span>
              <span className="pill-class">Class: {selectedClass}</span>
            </div>

            <div className="trains-found-tag">
              {trainsList.length} {trainsList.length === 1 ? "Train" : "Trains"} Available
            </div>
          </div>

          {searchError && <div className="search-warning-banner">{searchError}</div>}

          {/* Dynamic Train Cards */}
          <div className="train-cards-stack">
            {trainsList.map((train) => (
              <div key={train.train_id} className="train-card">
                {/* Train Header */}
                <div className="train-card-header">
                  <div className="train-title-box">
                    <span className="train-name">
                      {train.train_number} / {train.train_name}
                    </span>
                    <span className="train-type-tag">{train.train_type || "SUPERFAST SPECIAL"}</span>
                  </div>
                  <div className="train-days">Runs On: {train.runs_on || "M T W T F S S"}</div>
                </div>

                {/* Schedule Grid */}
                <div className="train-schedule-grid">
                  <div className="schedule-point left">
                    <div className="station-time">{train.origin_departure || "16:55"}</div>
                    <div className="station-code">{source}</div>
                    <div className="station-name">Departure Terminal</div>
                  </div>

                  <div className="duration-box">
                    <span className="duration-text">{train.duration || "15h 40m"}</span>
                    <div className="duration-line" />
                    <span style={{ fontSize: "11px", color: "#64748b" }}>
                      {train.journey_km ? `${train.journey_km} km` : "High Priority"}
                    </span>
                  </div>

                  <div className="schedule-point right">
                    <div className="station-time">{train.dest_arrival || "08:35"}</div>
                    <div className="station-code">{destination}</div>
                    <div className="station-name">Arrival Terminal</div>
                  </div>
                </div>

                {/* Classes with Real-time Redis Seat Counter */}
                <div className="train-classes-container">
                  <div className="classes-grid">
                    {CLASSES.filter((c) => c.id !== "ALL").map((cls) => {
                      const isLiveClass = cls.id === "3A";
                      const availableCount = isLiveClass
                        ? (remaining ?? 10)
                        : (train.classes?.find((c) => c.id === cls.id)?.availableSeats ?? 42);

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
                                <span className="status-available">CURR_AVL - 00{remaining}</span>
                              ) : (
                                <span className="status-soldout">REGRET / WL</span>
                              )
                            ) : (
                              <span className="status-available">AVAILABLE - {availableCount}</span>
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
                      style={{ width: "220px" }}
                    />
                    <button
                      type="button"
                      className="book-tatkal-btn"
                      onClick={() => handleBookTicket(train)}
                      disabled={isBooking || remaining === 0 || !backendOnline}
                    >
                      {isBooking ? "Reserving…" : "Book Tatkal Now"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 4. Concurrency Stress-Test Dashboard right below the Train Card */}
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
              Guarantees zero overselling under extreme race conditions.
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
      )}

      {/* 5. Booking Confirmation Modal (Clean IRCTC e-Ticket) */}
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
