const API = process.env.API_URL || "http://localhost:3000";
const USERS = Number(process.env.USERS || 200);

async function main() {
  const resetRes = await fetch(`${API}/api/reset`, { method: "POST" });
  if (!resetRes.ok) {
    throw new Error(`Reset failed: ${resetRes.status}. Is the API running?`);
  }

  const started = Date.now();
  const responses = await Promise.all(
    Array.from({ length: USERS }, (_, i) =>
      fetch(`${API}/api/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: `user-${i}` }),
      }).then((res) => res.json())
    )
  );
  const ms = Date.now() - started;

  const wins = responses.filter((r) => r.won === true).length;
  const losses = responses.filter((r) => r.won === false).length;
  const errors = responses.filter((r) => r.won !== true && r.won !== false).length;
  const status = await fetch(`${API}/api/status`).then((res) => res.json());

  console.log({
    users: USERS,
    wins,
    losses,
    errors,
    remaining: status.remaining,
    ms,
  });

  const ok = wins === 10 && status.remaining === 0 && wins + losses === USERS;
  if (ok) {
    console.log(
      "ATOMIC OK: 10 winners, remaining 0. Redis Lua did not oversell."
    );
  } else {
    console.log(
      "UNEXPECTED: with 10 tickets, wins must be 10 and remaining 0."
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
