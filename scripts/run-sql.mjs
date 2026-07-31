// Run a SQL file against DATABASE_URL as the admin principal (never une_app).
// Used for local dev seeds; each file must be idempotent.
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/run-sql.mjs <file.sql>');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = await readFile(file, 'utf8');
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const who = await client.query('SELECT current_user AS u');
  if (who.rows[0].u === 'une_app') {
    throw new Error('seed files must run as the admin principal, not une_app');
  }
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log(`applied ${file}`);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
