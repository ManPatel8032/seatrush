const path = require("path");
const dns = require("dns");

// Force IPv4 first to prevent NAT64 / IPv6 connection timeouts on Windows
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}

require("dotenv").config({ path: path.join(__dirname, ".env") });
const mysql = require("mysql2/promise");

// 2. If DATABASE_URL is provided, let the URL handle its own SSL settings
const dbConfig = process.env.DATABASE_URL
  ? {
      uri: process.env.DATABASE_URL,
      waitForConnections: true,
      connectionLimit: 10,
      maxIdle: 10,
      idleTimeout: 60000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      queueLimit: 0,
      multipleStatements: true,
    }
  : {
      host: process.env.MYSQL_HOST || "localhost",
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "seatrush",
      port: Number(process.env.MYSQL_PORT || 3306),
      waitForConnections: true,
      connectionLimit: 10,
      maxIdle: 10,
      idleTimeout: 60000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      queueLimit: 0,
      multipleStatements: true,
    };

const pool = mysql.createPool(dbConfig);

// Handle idle connection drop gracefully (common in cloud databases like TiDB Serverless / AWS)
pool.on("error", (err) => {
  if (err.code === "PROTOCOL_CONNECTION_LOST" || err.code === "ECONNRESET") {
    // Expected when cloud database server terminates an idle socket
    return;
  }
  console.warn("[MySQL Pool Notice]:", err.message);
});

module.exports = pool;