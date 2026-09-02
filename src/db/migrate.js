import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "./pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../../migrations");

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations() {
  const result = await pool.query(`
    SELECT filename
    FROM schema_migrations
    ORDER BY filename;
  `);

  return new Set(result.rows.map((row) => row.filename));
}

async function runMigrations() {
  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();

  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const filename of files) {
    if (applied.has(filename)) {
      console.log(`SKIP ${filename}`);
      continue;
    }

    const filePath = path.join(migrationsDir, filename);
    const sql = await fs.readFile(filePath, "utf8");

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(sql);

      await client.query(
        `
          INSERT INTO schema_migrations (filename)
          VALUES ($1);
        `,
        [filename],
      );

      await client.query("COMMIT");

      console.log(`APPLIED ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

runMigrations()
  .then(async () => {
    console.log("Database migrations complete.");
    await pool.end();
  })
  .catch(async (error) => {
    console.error("Migration failed:", error);
    await pool.end();
    process.exit(1);
  });