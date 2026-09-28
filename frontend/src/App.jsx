import { useEffect, useState } from "react";
import "./App.css";
import {
  IconHome,
  IconTrain,
  IconZap,
  IconActivity,
  IconTicket,
  IconFileText,
  IconArrowRight,
  IconArrowLeft,
  IconSwap,
  IconCalendar,
  IconBriefcase,
  IconGrid,
  IconClock,
  IconUsers,
  IconPlay,
  IconSquare,
  IconRefresh,
  IconAward,
  IconShield,
  IconCheckCircle,
  IconAlertTriangle,
  IconSearch,
  IconX,
  IconMapPin,
  IconUser,
  IconPrinter,
  IconCheck,
  IconFilter,
} from "./components/Icons";

const API = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/$/, "");

const DEFAULT_STATIONS = [
  { code: "NDLS", name: "New Delhi" },
  { code: "MMCT", name: "Mumbai Central" },
  { code: "KOTA", name: "Kota Jn" },
  { code: "BRC", name: "Vadodara Jn" },
  { code: "ST", name: "Surat" },
  { code: "HWH", name: "Howrah Jn" },
  { code: "CNB", name: "Kanpur Central" },
  { code: "PRYJ", name: "Prayagraj Jn" },
  { code: "DDU", name: "Pt Deen Dayal Upadhyaya" },
  { code: "GAYA", name: "Gaya Jn" },
  { code: "MAS", name: "MGR Chennai Central" },
  { code: "AGC", name: "Agra Cantt" },
  { code: "GWL", name: "Gwalior Jn" },
  { code: "BPL", name: "Bhopal Jn" },
  { code: "NGP", name: "Nagpur Jn" },
  { code: "BZA", name: "Vijayawada Jn" },
  { code: "SBC", name: "KSR Bengaluru" },
  { code: "ADI", name: "Ahmedabad Jn" },
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
  const [remaining, setRemaining] = useState(320);
  const [classRemaining, setClassRemaining] = useState({ "1A": 80, "2A": 80, "3A": 80, "SL": 80 });
  const [backendOnline, setBackendOnline] = useState(true);
  const [passengerName, setPassengerName] = useState("");
  const [isBooking, setIsBooking] = useState(false);
  const [bookingResult, setBookingResult] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Tatkal Rush Simulator State (1,400 Users across 40s)
  const [isStorming, setIsStorming] = useState(false);
  const [stormStats, setStormStats] = useState(null);
  const [rushDuration, setRushDuration] = useState(40);
  const [stormPollingInterval, setStormPollingInterval] = useState(null);

  // Virtual Waiting Room & Gateway Cooldown State
  const [waitingQueueStatus, setWaitingQueueStatus] = useState(null);
  const [rateLimitCooldown, setRateLimitCooldown] = useState(0);

  // Rate-limit countdown timer
  useEffect(() => {
    if (rateLimitCooldown <= 0) return;
    const timer = setInterval(() => {
      setRateLimitCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [rateLimitCooldown]);

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
      setRemaining(data.totalRemaining ?? data.remaining ?? 320);
      if (data.classes) {
        setClassRemaining(data.classes);
      }
      setBackendOnline(true);
    } catch {
      setBackendOnline(false);
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

  // Helper to generate confirmed e-Ticket
  function generateConfirmedTicket(train, passenger) {
    const randomPnr = Math.floor(2000000000 + Math.random() * 9000000000);
    const coaches = ["B1", "B2", "B3", "B4", "B5"];
    const berthTypes = ["Lower (LB)", "Middle (MB)", "Upper (UB)", "Side Lower (SL)"];
    const randomCoach = coaches[Math.floor(Math.random() * coaches.length)];
    const randomBerthNo = Math.floor(Math.random() * 64) + 1;
    const randomBerthType = berthTypes[Math.floor(Math.random() * berthTypes.length)];

    return {
      success: true,
      pnr: randomPnr,
      passenger,
      coach: `${randomCoach} - ${randomBerthNo}`,
      berthType: randomBerthType,
      classType: selectedClass,
      quota,
      train: `${train.train_number} / ${train.train_name}`,
    };
  }

  // Book Tatkal Ticket Handler (Virtual Waiting Room Integration)
  async function handleBookTicket(train) {
    if (rateLimitCooldown > 0) {
      alert(`API Gateway Cooldown active. Please wait ${rateLimitCooldown}s.`);
      return;
    }

    const trimmedPassenger =
      passengerName.trim() || `User_${Math.floor(1000 + Math.random() * 9000)}`;
    if (!passengerName.trim()) {
      setPassengerName(trimmedPassenger);
    }

    setIsBooking(true);
    setBookingResult(null);

    // 1. Open waiting room modal immediately
    setWaitingQueueStatus({
      inQueue: true,
      position: "Entering...",
      estimatedWaitSeconds: 1,
      train,
    });
    setIsModalOpen(true);

    try {
      const res = await fetch(`${API}/api/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: trimmedPassenger, classCode: selectedClass }),
      });

      const data = await res.json();

      // Case A: 429 Too Many Requests (Gateway Rate Limiter Throttled)
      if (res.status === 429) {
        const retrySec = Number(data.retryAfterSeconds || res.headers.get("Retry-After") || 2);
        setRateLimitCooldown(retrySec);
        setWaitingQueueStatus(null);
        setIsBooking(false);
        setBookingResult({
          success: false,
          isRateLimited: true,
          retryAfter: retrySec,
          message: data.message || "Gateway rate limit exceeded. Please wait before retrying.",
        });
        return;
      }

      // Case B: 202 Accepted (Enqueued into Virtual Waiting Room)
      if (res.status === 202) {
        const jobId = data.jobId;
        setWaitingQueueStatus({
          inQueue: true,
          jobId,
          position: data.position || 1,
          estimatedWaitSeconds: data.estimatedWaitSeconds || 1,
          train,
        });

        // Start active polling of /api/book/status/:jobId every 350ms
        let attempts = 0;
        const maxAttempts = 35; // ~12 seconds maximum poll timeout
        const pollInterval = setInterval(async () => {
          attempts++;
          try {
            const statusRes = await fetch(`${API}/api/book/status/${jobId}`);
            if (!statusRes.ok) throw new Error("Status check failed");
            const statusData = await statusRes.json();

            if (statusData.status === "COMPLETED") {
              clearInterval(pollInterval);
              setWaitingQueueStatus(null);
              setIsBooking(false);

              if (statusData.won) {
                setBookingResult(generateConfirmedTicket(train, trimmedPassenger));
              } else {
                setBookingResult({
                  success: false,
                  message: "REGRET / TATKAL QUOTA EXHAUSTED: Zero seats remaining.",
                });
              }
              await fetchStatus();
            } else if (statusData.status === "QUEUED") {
              // Update live position as queue drains
              setWaitingQueueStatus((prev) => ({
                ...prev,
                position: statusData.position,
                estimatedWaitSeconds: statusData.estimatedWaitSeconds || 1,
              }));
            }

            if (attempts >= maxAttempts) {
              clearInterval(pollInterval);
              setWaitingQueueStatus(null);
              setIsBooking(false);
              setBookingResult({
                success: false,
                message: "Waiting room session timed out. Please try again.",
              });
            }
          } catch {
            clearInterval(pollInterval);
            setWaitingQueueStatus(null);
            setIsBooking(false);
            setBookingResult({
              success: false,
              message: "Network interrupted while checking queue status.",
            });
          }
        }, 350);

        return;
      }

      // Case C: Direct Error
      setWaitingQueueStatus(null);
      setIsBooking(false);
      setBookingResult({
        success: false,
        message: data.error || "Reservation failed.",
      });
    } catch {
      setWaitingQueueStatus(null);
      setIsBooking(false);
      setBookingResult({
        success: false,
        message: "Network error contacting SeatRush backend.",
      });
    }
  }

  // Storm Simulation Handler (1,400 Users Staggered Across All Classes)
  async function handleRunStorm() {
    setIsStorming(true);
    setStormStats(null);
    try {
      const res = await fetch(`${API}/api/storm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ users: 1400, durationSec: rushDuration || 40 }),
      });
      const data = await res.json();
      setStormStats(data);
      if (typeof data.remaining === "number") setRemaining(data.remaining);
      if (data.classesRemaining) setClassRemaining(data.classesRemaining);

      // Poll live rush status every 400ms while simulation is running
      const interval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API}/api/storm/status`);
          const statusData = await statusRes.json();
          setStormStats(statusData);
          if (typeof statusData.remaining === "number") {
            setRemaining(statusData.remaining);
          }
          if (statusData.classesRemaining) {
            setClassRemaining(statusData.classesRemaining);
          }

          // If simulation finished, stop polling
          if (!statusData.active && statusData.elapsedSec >= statusData.durationSec) {
            clearInterval(interval);
            setStormPollingInterval(null);
            setIsStorming(false);
          }
        } catch {
          // ignore transient poll error
        }
      }, 400);

      setStormPollingInterval(interval);
    } catch {
      alert("Failed to start Tatkal rush simulation. Ensure backend is running.");
      setIsStorming(false);
    }
  }

  // Stop Active Rush Simulation
  async function handleStopStorm() {
    if (stormPollingInterval) {
      clearInterval(stormPollingInterval);
      setStormPollingInterval(null);
    }
    try {
      const res = await fetch(`${API}/api/storm/stop`, { method: "POST" });
      const data = await res.json();
      setStormStats(data);
      if (typeof data.remaining === "number") setRemaining(data.remaining);
      if (data.classesRemaining) setClassRemaining(data.classesRemaining);
    } catch {
      // ignore
    } finally {
      setIsStorming(false);
    }
  }

  // Inventory Reset Handler
  async function handleResetInventory() {
    if (stormPollingInterval) {
      clearInterval(stormPollingInterval);
      setStormPollingInterval(null);
    }
    try {
      const res = await fetch(`${API}/api/reset`, { method: "POST" });
      const data = await res.json();
      setRemaining(data.totalRemaining ?? data.remaining ?? 320);
      if (data.classes) setClassRemaining(data.classes);
      setStormStats(null);
      setIsStorming(false);
      alert("Redis Tatkal Inventory reset to 320 tickets (80 seats in each class: 1A, 2A, 3A, SL).");
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
            <span className="live-clock font-mono">
              <IconClock size={13} />
              <span>{clockString}</span>
            </span>
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
            <div className="seatrush-brand-logo" onClick={() => setCurrentView("home")} title="SeatRush Home">
              <div className="brand-logo-icon">
                <IconZap size={20} color="#ffffff" />
              </div>
              <div className="brand-text">
                <span className="brand-main">SEAT</span><span className="brand-accent">RUSH</span>
                <span className="brand-sub">Flash-Sale Engine</span>
              </div>
            </div>
          </div>

          <nav className="nav-center-menu">
            <button
              type="button"
              className={`nav-link-btn ${currentView === "home" ? "active" : ""}`}
              onClick={() => setCurrentView("home")}
            >
              <IconHome size={15} /> <span>HOME</span>
            </button>
            <button
              type="button"
              className={`nav-link-btn ${currentView === "results" ? "active" : ""}`}
              onClick={() => {
                if (trainsList.length === 0) {
                  handleSearchTrains();
                } else {
                  setCurrentView("results");
                }
              }}
            >
              <IconTrain size={15} /> <span>TRAINS &amp; BOOKING</span>
            </button>
            <button
              type="button"
              className="nav-link-btn"
              onClick={() => {
                if (currentView !== "results") {
                  if (trainsList.length === 0) handleSearchTrains();
                  else setCurrentView("results");
                }
                setTimeout(() => {
                  const el = document.querySelector(".simulator-panel");
                  if (el) el.scrollIntoView({ behavior: "smooth" });
                }, 100);
              }}
            >
              <IconActivity size={15} /> <span>STRESS SIMULATOR</span>
            </button>
          </nav>

          <div className="nav-right-actions">
            <div className={`status-pill ${backendOnline ? "online" : "offline"}`}>
              <span className="status-dot" />
              <span>{backendOnline ? "REDIS LIVE" : "BACKEND OFFLINE"}</span>
            </div>
            <button type="button" className="nav-login-btn">
              <IconUser size={14} />
              <span>LOGIN</span>
            </button>
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
                    <IconTicket size={15} /> <span>PNR STATUS</span>
                  </button>
                  <button type="button" className="tab-item">
                    <IconFileText size={15} /> <span>CHARTS / VACANCY</span>
                  </button>
                </div>

                <div className="card-body-form">
                  <h2 className="card-main-heading">BOOK TICKET</h2>

                  <form onSubmit={handleSearchTrains} className="form-fields-stack">
                    {/* From Station with MapPin Icon */}
                    <div className="input-with-icon">
                      <span className="field-icon"><IconMapPin size={17} /></span>
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
                        <IconSwap size={15} />
                      </button>
                    </div>

                    {/* To Station with Location Pin */}
                    <div className="input-with-icon">
                      <span className="field-icon"><IconMapPin size={17} /></span>
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
                      <span className="field-icon"><IconCalendar size={17} /></span>
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
                      <span className="field-icon"><IconBriefcase size={17} /></span>
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
                      <span className="field-icon"><IconGrid size={17} /></span>
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
                      <IconSearch size={18} />
                      <span>{isSearching ? "Searching Trains…" : "Search Trains"}</span>
                    </button>
                  </form>
                </div>
              </div>

              {/* Right Hero Branding */}
              <div className="hero-railway-branding">
                <h1 className="hero-ir-title">SEATRUSH</h1>
                <div className="hero-motto">
                  <span>Speed</span>
                  <span className="motto-pipe">|</span>
                  <span>Scale</span>
                  <span className="motto-pipe">|</span>
                  <span>Zero Overselling</span>
                </div>
                <p className="hero-subtext">High-Throughput Flash-Sale Ticketing Engine</p>
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
              <IconArrowLeft size={15} />
              <span>Modify Search</span>
            </button>

            <div className="route-summary-pill">
              <span className="pill-station">{source}</span>
              <IconArrowRight size={13} className="pill-arrow" />
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

          {/* Active Tatkal Rush Live Alert Banner */}
          {isStorming && (
            <div className="rush-active-callout">
              <span className="live-indicator-dot"></span>
              <div className="rush-callout-text">
                <div className="rush-callout-badge">
                  <IconActivity size={13} />
                  <span>MULTI-CLASS CONCURRENCY WAVE ACTIVE</span>
                </div>
                <div className="rush-callout-desc">
                  1,400 concurrent simulated requests are arriving randomly across {rushDuration}s (80 seats in 1A, 2A, 3A, SL &mdash; 320 seats total).
                </div>
                <div className="rush-subtext">
                  Total Remaining: <strong>{remaining ?? 320} / 320</strong> (1A: {classRemaining["1A"] ?? 80} | 2A: {classRemaining["2A"] ?? 80} | 3A: {classRemaining["3A"] ?? 80} | SL: {classRemaining["SL"] ?? 80}) &bull; Pick any class and click <strong>&quot;Book Tatkal&quot;</strong> to compete!
                </div>
              </div>
            </div>
          )}

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
                    <span className="train-type-tag">
                      <IconTrain size={12} />
                      <span>{train.train_type || "SUPERFAST SPECIAL"}</span>
                    </span>
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

                {/* Classes with Real-time Redis Seat Counters for ALL tiers */}
                <div className="train-classes-container">
                  <div className="classes-grid">
                    {CLASSES.filter((c) => c.id !== "ALL").map((cls) => {
                      const count = classRemaining[cls.id] ?? 80;

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
                            {count > 0 ? (
                              <span className="status-available">CURR_AVL - 00{count}</span>
                            ) : (
                              <span className="status-soldout">REGRET / WL</span>
                            )}
                            <span className="live-sync-indicator font-mono">
                              <IconZap size={10} /> REDIS LIVE
                            </span>
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
                    <strong style={{ color: (classRemaining[selectedClass] ?? 0) > 0 ? "#15803d" : "#dc2626" }}>
                      {classRemaining[selectedClass] !== undefined ? `${classRemaining[selectedClass]} / 80 Seats` : "…"}
                    </strong>
                    {" "}(Total 320 across all Tiers: <strong>{remaining ?? 320}</strong> left)
                  </div>

                  <div className="passenger-booking-group">
                    <div className="passenger-input-wrapper">
                      <IconUser size={15} className="passenger-input-icon" />
                      <input
                        type="text"
                        placeholder="Passenger Name / ID"
                        value={passengerName}
                        onChange={(e) => setPassengerName(e.target.value)}
                        className="passenger-input-box"
                      />
                    </div>
                    <button
                      type="button"
                      className="book-tatkal-btn"
                      onClick={() => handleBookTicket(train)}
                      disabled={isBooking || (classRemaining[selectedClass] ?? 0) === 0 || !backendOnline || rateLimitCooldown > 0}
                    >
                      <IconTicket size={15} />
                      <span>
                        {rateLimitCooldown > 0
                          ? `Cooldown (${rateLimitCooldown}s)`
                          : isBooking
                            ? "Entering Waiting Room…"
                            : (classRemaining[selectedClass] ?? 0) === 0
                              ? `${selectedClass} Sold Out`
                              : `Book ${selectedClass} Tatkal`}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 4. Concurrency Stress-Test Dashboard (1,400 Users across All Classes) */}
          <section className="simulator-panel">
            <div className="simulator-header">
              <div className="sim-title">
                <IconActivity size={18} />
                <span>Multi-Class Tatkal Stress Simulator (1,400 Requests across 320 Seats)</span>
              </div>
              <div className="sim-controls">
                <div className="rush-duration-select">
                  <label>Duration:</label>
                  <select
                    value={rushDuration}
                    onChange={(e) => setRushDuration(Number(e.target.value))}
                    disabled={isStorming}
                    className="rush-select"
                  >
                    <option value={20}>20s (Fast Wave)</option>
                    <option value={40}>40s (Target: 1,400 Users over 40s)</option>
                    <option value={60}>60s (Extended Wave)</option>
                  </select>
                </div>

                {!isStorming ? (
                  <button
                    type="button"
                    className="sim-btn sim-btn-rush"
                    onClick={handleRunStorm}
                    disabled={!backendOnline}
                  >
                    <IconPlay size={13} />
                    <span>Start 1,400-User Multi-Class Rush</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="sim-btn sim-btn-stop"
                    onClick={handleStopStorm}
                  >
                    <IconSquare size={13} />
                    <span>Stop Simulation ({stormStats?.elapsedSec || 0}s / {rushDuration}s)</span>
                  </button>
                )}

                <button
                  type="button"
                  className="sim-btn sim-btn-danger"
                  onClick={handleResetInventory}
                >
                  <IconRefresh size={13} />
                  <span>Reset Inventory (80 Each / 320 Total)</span>
                </button>
              </div>
            </div>

            {isStorming && (
              <div className="rush-active-callout">
                <span className="live-indicator-dot"></span>
                <div className="rush-callout-text">
                  <div className="rush-callout-badge">
                    <IconActivity size={13} />
                    <span>MULTI-CLASS TATKAL RUSH IN PROGRESS</span>
                  </div>
                  <div className="rush-callout-desc">
                    1,400 virtual bot passengers are entering the waiting room randomly over {rushDuration}s across all 4 tiers (1A, 2A, 3A, SL)!
                  </div>
                  <div className="rush-subtext">
                    Total 320 seats (80 per tier: 1A, 2A, 3A, SL). Pick any class above and click <strong>&quot;Book Tatkal Now&quot;</strong> to compete against the bots!
                  </div>
                </div>
              </div>
            )}

            <p style={{ fontSize: "13px", color: "#cbd5e1", lineHeight: "1.5" }}>
              Simulates 1,400 concurrent requests arriving randomly over {rushDuration} seconds across all 4 travel classes (1A, 2A, 3A, SL).
              Each request targets exactly 1 ticket in a randomly selected class. Zero overselling is guaranteed independently per class (80 seats each).
            </p>

            {stormStats && (
              <div className="telemetry-grid">
                <div className="telemetry-card">
                  <div className="telemetry-label">
                    <IconUsers size={14} /> Requests Dispatched
                  </div>
                  <div className="telemetry-value font-mono">
                    {stormStats.enqueuedUsers ?? stormStats.users ?? 0} / {stormStats.totalUsers || 1400}
                  </div>
                  <div className="telemetry-sub">{stormStats.queueLength || 0} currently in waiting room</div>
                </div>
                <div className="telemetry-card">
                  <div className="telemetry-label">
                    <IconTicket size={14} /> Total Seats Remaining
                  </div>
                  <div
                    className="telemetry-value font-mono"
                    style={{
                      color:
                        (stormStats.remaining ?? remaining) > 0
                          ? "#4ade80"
                          : "#f87171",
                    }}
                  >
                    {stormStats.remaining ?? remaining ?? 0} / 320
                  </div>
                  <div className="telemetry-sub">
                    1A: {classRemaining["1A"] ?? 0} | 2A: {classRemaining["2A"] ?? 0} | 3A: {classRemaining["3A"] ?? 0} | SL: {classRemaining["SL"] ?? 0}
                  </div>
                </div>
                <div className="telemetry-card">
                  <div className="telemetry-label">
                    <IconZap size={14} /> Bot Confirmed Bookings
                  </div>
                  <div className="telemetry-value font-mono" style={{ color: "#38bdf8" }}>
                    {stormStats.botWins ?? stormStats.wins ?? 0}
                  </div>
                  <div className="telemetry-sub">
                    {stormStats.classWins
                      ? `1A: ${stormStats.classWins["1A"] || 0}, 2A: ${stormStats.classWins["2A"] || 0}, 3A: ${stormStats.classWins["3A"] || 0}, SL: ${stormStats.classWins["SL"] || 0}`
                      : "Across all 4 classes"}
                  </div>
                </div>
                <div className="telemetry-card highlight-card">
                  <div className="telemetry-label">
                    <IconAward size={14} /> Human Bookings (You!)
                  </div>
                  <div
                    className="telemetry-value font-mono"
                    style={{
                      color: (stormStats.humanWins || 0) > 0 ? "#4ade80" : "#fbbf24",
                    }}
                  >
                    <span>{stormStats.humanWins || 0}</span>
                    {stormStats.humanWins > 0 && (
                      <span className="human-win-badge">
                        <IconCheckCircle size={12} /> SECURED
                      </span>
                    )}
                  </div>
                  <div className="telemetry-sub">
                    {stormStats.humanWins > 0
                      ? "You beat the bots in your tier!"
                      : "Book any tier above to join queue"}
                  </div>
                </div>
              </div>
            )}
          </section>
        </main>
      )}

      {/* 5. Booking / Waiting Room Modal */}
      {isModalOpen && (
        <div
          className="modal-overlay"
          onClick={() => !waitingQueueStatus?.inQueue && setIsModalOpen(false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                {waitingQueueStatus?.inQueue ? (
                  <>
                    <IconClock size={19} color="#2563eb" />
                    <span>Tatkal Virtual Waiting Room</span>
                  </>
                ) : bookingResult?.success ? (
                  <>
                    <IconCheckCircle size={19} color="#16a34a" />
                    <span>Tatkal Ticket Confirmed</span>
                  </>
                ) : (
                  <>
                    <IconAlertTriangle size={19} color="#dc2626" />
                    <span>Booking Status</span>
                  </>
                )}
              </div>
              {!waitingQueueStatus?.inQueue && (
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setIsModalOpen(false)}
                >
                  <IconX size={18} />
                </button>
              )}
            </div>

            {/* View A: Live Virtual Waiting Room */}
            {waitingQueueStatus?.inQueue ? (
              <div className="waiting-room-container">
                <div className="waiting-pulse-header">
                  <span className="pulse-indicator"></span>
                  <span className="pulse-text">HIGH-CONCURRENCY TATKAL FLASH SALE</span>
                </div>

                <div className="queue-box">
                  <div className="queue-label">YOUR LIVE POSITION IN LINE</div>
                  <div className="queue-number font-mono">
                    #{waitingQueueStatus.position}
                  </div>
                  <div className="queue-bar-track">
                    <div
                      className="queue-bar-fill"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(10, 100 - (Number(waitingQueueStatus.position) || 1) * 3)
                        )}%`,
                      }}
                    ></div>
                  </div>
                </div>

                <div className="waiting-stats-grid">
                  <div className="waiting-stat-cell">
                    <span className="stat-name">Estimated Wait:</span>
                    <span className="stat-val font-mono">~{waitingQueueStatus.estimatedWaitSeconds}s</span>
                  </div>
                  <div className="waiting-stat-cell">
                    <span className="stat-name">Queue Engine:</span>
                    <span className="stat-val">Redis ZSET (FIFO)</span>
                  </div>
                  <div className="waiting-stat-cell">
                    <span className="stat-name">Train:</span>
                    <span className="stat-val">{waitingQueueStatus.train?.train_number}</span>
                  </div>
                  <div className="waiting-stat-cell">
                    <span className="stat-name">Passenger:</span>
                    <span className="stat-val">{passengerName}</span>
                  </div>
                </div>

                <div className="waiting-footer-note">
                  <div className="spinner-dots">
                    <span></span><span></span><span></span>
                  </div>
                  <p>
                    Please hold on. Your booking request is being evaluated atomically by Redis background workers.
                  </p>
                </div>
              </div>
            ) : bookingResult?.success ? (
              <div className="ticket-receipt">
                <div className="ticket-pnr-row">
                  <div>
                    <div style={{ fontSize: "11px", color: "#166534", fontWeight: 700 }}>
                      PNR NUMBER
                    </div>
                    <div className="pnr-number font-mono">{bookingResult.pnr}</div>
                  </div>
                  <span className="ticket-badge-confirmed">
                    <IconCheckCircle size={13} /> CONFIRMED (CNF)
                  </span>
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

                <div className="ticket-receipt-actions">
                  <button
                    type="button"
                    className="ticket-action-btn print-btn"
                    onClick={() => window.print()}
                  >
                    <IconPrinter size={14} />
                    <span>Print e-Ticket</span>
                  </button>
                  <button
                    type="button"
                    className="ticket-action-btn close-btn"
                    onClick={() => setIsModalOpen(false)}
                  >
                    <span>Done</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="ticket-error">
                {bookingResult?.isRateLimited ? (
                  <div className="rate-limit-card">
                    <div className="rate-limit-title">
                      <IconShield size={16} /> Gateway Rate Limit Active
                    </div>
                    <p className="rate-limit-desc">{bookingResult.message}</p>
                    <div className="rate-limit-badge font-mono">
                      Cooldown: {rateLimitCooldown}s
                    </div>
                  </div>
                ) : (
                  <>
                    <p style={{ fontWeight: 700, marginBottom: "6px" }}>Reservation Failed</p>
                    <p style={{ fontSize: "13px" }}>{bookingResult?.message}</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
