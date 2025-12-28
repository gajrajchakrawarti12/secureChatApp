const mysql = require("mysql2/promise");
const { logError } = require("../logging/logger");
const { runMigrations } = require("./migrations/runMigrations");

const {
  DB_HOST = "localhost",
  DB_USER = "root",
  DB_PASSWORD = "",
  DB_NAME = "secure_chat",
} = process.env;

let pool = null; // MySQL pool

async function initDb() {
  try {
    // MySQL path
    const conn = await mysql.createConnection({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
    });
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
    await conn.end();

    pool = mysql.createPool({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    // Apply idempotent SQL migrations (replaces runtime DDL).
    await runMigrations(pool);
  } catch (err) {
    logError(err);
    throw err;
  }
}

function getPool() {
  if (!pool) throw new Error("Pool not initialized - call initDb() first");
  return pool;
}

module.exports = { initDb, getPool };
