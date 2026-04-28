import fs from "fs";
import path from "path";
import { Pool } from "mysql2/promise";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../db/migrations");

const ensureMigrationsTable = async (pool: Pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id        INT AUTO_INCREMENT PRIMARY KEY,
      filename  VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
};

const getApplied = async (pool: Pool): Promise<Set<string>> => {
  const [rows]: any = await pool.query(
    "SELECT filename FROM schema_migrations ORDER BY filename ASC"
  );
  return new Set((rows as any[]).map((r: any) => r.filename));
};

export const runMigrations = async (pool: Pool): Promise<void> => {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
    console.log("[migrate] migrations directory created — no migrations to run yet.");
    return;
  }

  await ensureMigrationsTable(pool);
  const applied = await getApplied(pool);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    console.log("[migrate] all migrations up to date.");
    return;
  }

  for (const file of pending) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(filePath, "utf8").trim();
    if (!sql) {
      console.warn(`[migrate] skipping empty file: ${file}`);
      continue;
    }

    console.log(`[migrate] applying ${file}...`);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Split on semicolons to support multi-statement migration files.
      const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        await conn.query(stmt);
      }
      await conn.query(
        "INSERT INTO schema_migrations (filename) VALUES (?)",
        [file]
      );
      await conn.commit();
      console.log(`[migrate] applied ${file}`);
    } catch (err: any) {
      await conn.rollback();
      console.error(`[migrate] FAILED on ${file}: ${err?.message || err}`);
      throw err;
    } finally {
      conn.release();
    }
  }
};
