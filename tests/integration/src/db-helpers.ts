import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { runner } from 'node-pg-migrate';

/** Superuser URL pointing at a maintenance DB (e.g. postgres://une:...@localhost:5432/une). */
export const ADMIN_URL = process.env.DATABASE_URL;

const SRC_DIR = fileURLToPath(new URL('.', import.meta.url));
export const MIGRATIONS_DIR = resolve(SRC_DIR, '..', '..', '..', 'database', 'migrations');
export const MIGRATIONS_TABLE = 'pgmigrations';
/** Same ignore rule as the root db:migrate script (dotfiles + README). */
export const IGNORE_PATTERN = '\\..*|README\\.md';

export function testDbUrl(dbName: string): string {
  const url = new URL(ADMIN_URL as string);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/** Append-only/immutable tables: une_app must never hold UPDATE/DELETE.
 * New event/snapshot tables must be added here AND revoked in their migration. */
export const APPEND_ONLY_TABLES = [
  'execution_event',
  'audit_log',
  'task_event',
  'plan_context_snapshot',
  'situation_snapshot',
  'job_event',
];

export async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Migrations/fixtures must run as the admin principal, never the runtime role. */
export async function assertAdminPrincipal(url: string): Promise<void> {
  await withClient(url, async (c) => {
    const who = await c.query('SELECT current_user AS u');
    if (who.rows[0].u === 'une_app') {
      throw new Error('DATABASE_URL must be the admin/superuser role, not une_app');
    }
  });
}

export async function createTestDb(prefix: string): Promise<{ name: string; url: string }> {
  await assertAdminPrincipal(ADMIN_URL as string);
  const name = `${prefix}_${randomUUID().slice(0, 8)}`;
  await withClient(ADMIN_URL as string, (c) => c.query(`CREATE DATABASE ${name}`));
  return { name, url: testDbUrl(name) };
}

export async function dropTestDb(name: string): Promise<void> {
  await withClient(ADMIN_URL as string, (c) =>
    c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`),
  );
}

const quietLogger = { info: () => {}, warn: () => {}, error: console.error, debug: () => {} };

/** Runs forward migrations; count limits how many pending migrations run. */
export async function migrate(databaseUrl: string, count?: number): Promise<void> {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    migrationsTable: MIGRATIONS_TABLE,
    ignorePattern: IGNORE_PATTERN,
    direction: 'up',
    ...(count === undefined ? {} : { count }),
    logger: quietLogger,
  });
}

/** Minimal valid fixture graph: tenant -> app_user -> situation -> dispatch. */
export interface Fixture {
  tenantId: string;
  userId: string;
  situationId: string;
  dispatchId: string;
}

export async function insertFixture(c: Client, tenantCode: string): Promise<Fixture> {
  const tenant = await c.query(
    `INSERT INTO tenant (tenant_code, tenant_name, status)
     VALUES ($1, $1, 'ACTIVE') RETURNING tenant_id`,
    [tenantCode],
  );
  const tenantId = tenant.rows[0].tenant_id as string;
  const user = await c.query(
    `INSERT INTO app_user (tenant_id, login_id, display_name, status)
     VALUES ($1, $2, 'CC-004 fixture', 'ACTIVE') RETURNING user_id`,
    [tenantId, `fixture-${tenantCode}`],
  );
  const userId = user.rows[0].user_id as string;
  const situation = await c.query(
    `INSERT INTO situation (tenant_id, mode, title, hazard_type, status, created_by)
     VALUES ($1, 'ACTUAL', 'CC-004 fixture situation', 'FLOOD', 'OPEN', $2)
     RETURNING situation_id`,
    [tenantId, userId],
  );
  const situationId = situation.rows[0].situation_id as string;
  const dispatch = await c.query(
    `INSERT INTO dispatch (situation_id, message_type, message_body, status, created_by)
     VALUES ($1, 'SITUATION', 'CC-004 fixture dispatch', 'PENDING', $2)
     RETURNING dispatch_id`,
    [situationId, userId],
  );
  return { tenantId, userId, situationId, dispatchId: dispatch.rows[0].dispatch_id as string };
}
