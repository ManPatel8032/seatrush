
const path = require("path");
const dns = require("dns");

if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}

require("dotenv").config({ path: path.join(__dirname, ".env") });
const pool = require("./db");

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--list") {
      parsed.list = true;
    } else if (arg === "--code" && i + 1 < args.length) {
      parsed.code = args[++i];
    } else if (arg === "--name" && i + 1 < args.length) {
      parsed.name = args[++i];
    } else if (arg === "--city" && i + 1 < args.length) {
      parsed.city = args[++i];
    } else if (arg === "--state" && i + 1 < args.length) {
      parsed.state = args[++i];
    } else if (!arg.startsWith("--")) {
      // Positional arguments fallback: code name city state
      if (!parsed.code) parsed.code = arg;
      else if (!parsed.name) parsed.name = arg;
      else if (!parsed.city) parsed.city = arg;
      else if (!parsed.state) parsed.state = arg;
    }
  }

  return parsed;
}

async function listStations() {
  const [rows] = await pool.query(
    "SELECT code, name, city, state, created_at FROM stations ORDER BY code ASC"
  );
  console.log(`\nFound ${rows.length} stations in database:\n`);
  console.table(rows);
}

async function seedStation(station) {
  const code = (station.code || "").trim().toUpperCase();
  const name = (station.name || "").trim();
  const city = (station.city || "").trim();
  const state = (station.state || "").trim();

  if (!code || code.length < 2 || code.length > 10) {
    throw new Error("Invalid station code. Must be 2-10 characters (e.g., 'PNBE', 'PUNE').");
  }
  if (!name || name.length > 100) {
    throw new Error("Invalid station name. Must be 1-100 characters.");
  }
  if (!city || city.length > 50) {
    throw new Error("Invalid station city. Must be 1-50 characters.");
  }
  if (!state || state.length > 50) {
    throw new Error("Invalid station state. Must be 1-50 characters.");
  }

  console.log(`\nSeeding station into database...`);
  console.log(`Code  : ${code}`);
  console.log(`Name  : ${name}`);
  console.log(`City  : ${city}`);
  console.log(`State : ${state}`);

  const insertSql = `
    INSERT INTO stations (code, name, city, state)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      city = VALUES(city),
      state = VALUES(state)
  `;

  await pool.query(insertSql, [code, name, city, state]);

  // Fetch the record to confirm
  const [rows] = await pool.query(
    "SELECT code, name, city, state, created_at FROM stations WHERE code = ?",
    [code]
  );

  return rows[0];
}

async function main() {
  const args = parseArgs();

  try {
    if (args.list) {
      await listStations();
      return;
    }

    if (!args.code || !args.name || !args.city || !args.state) {
      console.log("Usage: node backend/seed-station.js --code <code> --name <name> --city <city> --state <state>");
      console.log("   or: node backend/seed-station.js <code> <name> <city> <state>");
      console.log("   or: node backend/seed-station.js --list");
      console.log("\nExample:\n  node backend/seed-station.js PNBE \"Patna Jn\" \"Patna\" \"Bihar\"\n");
      process.exit(1);
    }

    const station = await seedStation(args);
    console.log("\n✅ Station successfully saved in database:");
    console.table([station]);
  } catch (err) {
    console.error("\n❌ Error seeding station:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { seedStation, listStations };
