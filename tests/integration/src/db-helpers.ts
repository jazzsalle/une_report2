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
  // 0020 (CC-160): 검증 보고서는 산출물이 어떤 근거로 나갔는지를 말하는
  // 감사 증거다. 재검증은 새 보고서이지 과거 판정의 덮어쓰기가 아니다.
  'validation_report',
  // 0023 (CC-200): 수집 Job은 종결된 채로 태어나고(동기 수집), 원문 응답은
  // 증거다. situation_fact는 여기 없다 — UNE-SIT-008 보정이 UPDATE를 쓰므로
  // DELETE만 회수했다(거부는 status='REJECTED'이지 삭제가 아니다).
  'provider_job',
  'provider_result',
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
    // mode/status는 0023(CC-200)이 CHECK로 굳힌 어휘를 쓴다. 이 픽스처는
    // 'ACTUAL'/'OPEN'을 썼는데 설계 어디에도 없는 값이었다 — 0004의 컬럼
    // 주석은 LIVE/EXERCISE이고 상태기계 정본은 설계 06 §7.1이다. 제약이
    // 생기면서 드러났고, 픽스처 쪽을 설계에 맞춘다.
    `INSERT INTO situation (tenant_id, mode, title, hazard_type, status, created_by)
     VALUES ($1, 'LIVE', 'CC-004 fixture situation', 'FLOOD', 'DRAFT', $2)
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
