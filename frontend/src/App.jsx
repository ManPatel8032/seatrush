import { useEffect, useState } from "react";
import "./App.css";

const API = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/$/, "");

function App() {
  const [userId, setUserId] = useState("");
  const [remaining, setRemaining] = useState(null);
  const [result, setResult] = useState("");

  async function loadStatus() {
    try {
      const response = await fetch(`${API}/api/status`);
      if (!response.ok) {
        throw new Error(`Status ${response.status}`);
      }
      const data = await response.json();
      setRemaining(data.remaining);
    } catch {
      setRemaining(null);
      setResult(
        "Cannot reach API. Start Redis, then in /server run npm start."
      );
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function handleBook() {
    if (!userId.trim()) {
      setResult("Enter a userId first.");
      return;
    }

    const response = await fetch(`${API}/api/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: userId.trim() }),
    });
    const data = await response.json();

    if (!response.ok) {
      setResult(data.error || "Booking failed.");
      return;
    }

    setResult(data.won ? "won: true" : "won: false");
    await loadStatus();
  }

  async function handleReset() {
    const response = await fetch(`${API}/api/reset`, { method: "POST" });
    const data = await response.json();

    if (!response.ok) {
      setResult(data.error || "Reset failed.");
      return;
    }

    setRemaining(data.remaining);
    setResult("Reset to 10");
  }

  async function handleStorm() {
    setResult("Running 200 concurrent Redis bookings…");
    const response = await fetch(`${API}/api/storm`, { method: "POST" });
    const data = await response.json();

    if (!response.ok) {
      setResult(data.error || "Storm failed.");
      return;
    }

    setRemaining(data.remaining);
    setResult(
      data.ok
        ? `200 concurrent: ${data.wins} won, ${data.losses} lost, remaining ${data.remaining}. Atomic OK.`
        : `UNEXPECTED: 200 concurrent: ${data.wins} won, remaining ${data.remaining}.`
    );
  }

  return (
    <div className="app">
      <h1>Tatkal Ticket Rush</h1>
      <p>Tickets Remaining: {remaining === null ? "…" : remaining}</p>
      <input
        type="text"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        placeholder="userId"
      />
      <button type="button" onClick={handleBook}>
        Book Now
      </button>
      <button type="button" onClick={handleReset}>
        Reset
      </button>
      <button type="button" onClick={handleStorm}>
        200 concurrent
      </button>
      {result ? <p>{result}</p> : null}
    </div>
  );
}

export default App;
