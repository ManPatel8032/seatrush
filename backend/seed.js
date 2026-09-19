const dns = require("dns");
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}
const path = require("path");
// 1. Explicitly load backend/.env
require("dotenv").config({ path: path.join(__dirname, ".env") });
const fs = require("fs");
const pool = require("./db");

async function seed() {
    console.log("Reading schema and seed data from schema.sql...");
    const sqlFilePath = path.join(__dirname, "schema.sql");
    const sql = fs.readFileSync(sqlFilePath, "utf8");

    let connection;
    try {
    console.log("Connecting to TiDB Cloud MySQL and executing schema...");
    connection = await pool.getConnection();

    // Execute all tables and sample seeds
    await connection.query(sql);

    console.log("✅ Database schema and seed data created successfully!");
    console.log("   - Tables created (stations, trains, schedules, inventory, etc.)");
    console.log("   - 3 Trains and physical coach rakes initialized");
    console.log("   - Multi-stop intermediate station schedules inserted");
    console.log("   - Next 7 days of live Tatkal & General inventory seeded");
    } catch (err) {
    console.error("❌ Failed to seed database:", err.message || err);
    } finally {
    if (connection) connection.release();
    await pool.end();
    }
}

seed();