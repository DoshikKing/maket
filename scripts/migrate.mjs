import 'dotenv/config';
import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Apply reviewed SQL migrations atomically. Independent of Prisma's native engine downloads.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query('SELECT pg_advisory_lock(718219401)');
  await client.query(
    'CREATE TABLE IF NOT EXISTS "_maket_migrations" (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
  );
  const dirs = (
    await readdir(new URL('../prisma/migrations/', import.meta.url), { withFileTypes: true })
  )
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const name of dirs) {
    const sql = await readFile(
      new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
      'utf8',
    );
    const checksum = createHash('sha256').update(sql).digest('hex');
    const { rows } = await client.query('SELECT checksum FROM "_maket_migrations" WHERE name=$1', [
      name,
    ]);
    if (rows.length) {
      if (rows[0].checksum !== checksum) throw new Error(`Applied migration modified: ${name}`);
      console.log(`Already applied: ${name}`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO "_maket_migrations" (name,checksum) VALUES ($1,$2)', [
        name,
        checksum,
      ]);
      await client.query('COMMIT');
      console.log(`Applied: ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
