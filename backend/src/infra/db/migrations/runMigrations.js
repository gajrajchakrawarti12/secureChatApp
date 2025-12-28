const fs = require('fs');
const path = require('path');

function shouldIgnoreMigrationError(e) {
  const code = e && e.code ? String(e.code) : '';
  // Idempotency / already-exists kinds of errors.
  return (
    code === 'ER_TABLE_EXISTS_ERROR' ||
    code === 'ER_DUP_FIELDNAME' ||
    code === 'ER_DUP_KEYNAME' ||
    code === 'ER_CANT_DROP_FIELD_OR_KEY' ||
    code === 'ER_KEY_NAME_DUPLICATE'
  );
}

function splitSqlStatements(sqlText) {
  // Assumes our migrations don't contain stored procedures/triggers.
  // Splits on semicolons at line ends.
  return sqlText
    .split(/;\s*(?:\r?\n|$)/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function ensureMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);
}

async function getAppliedMigrations(conn) {
  const [rows] = await conn.query('SELECT filename FROM schema_migrations');
  return new Set((rows || []).map((r) => String(r.filename)));
}

async function applyMigrationFile(conn, filename, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  const statements = splitSqlStatements(sql);

  await conn.beginTransaction();
  try {
    for (const stmt of statements) {
      try {
        await conn.query(stmt);
      } catch (e) {
        if (!shouldIgnoreMigrationError(e)) throw e;
      }
    }
    await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [filename]);
    await conn.commit();
  } catch (e) {
    try {
      await conn.rollback();
    } catch (_) {}
    throw e;
  }
}

async function runMigrations(pool, { migrationsDir } = {}) {
  const dir = migrationsDir || path.join(__dirname, 'sql');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) return;

  const conn = await pool.getConnection();
  try {
    await ensureMigrationsTable(conn);
    const applied = await getAppliedMigrations(conn);

    for (const filename of files) {
      if (applied.has(filename)) continue;
      const filePath = path.join(dir, filename);
      await applyMigrationFile(conn, filename, filePath);
    }
  } finally {
    try {
      conn.release();
    } catch (_) {}
  }
}

module.exports = { runMigrations };
