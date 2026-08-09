import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { runner as migrate } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadWorkerConfig, type WorkerConfig } from '../config/worker-config';
import { WorkerDatabase } from '../db/worker-database.service';
import { PayloadRetentionRunner } from './payload-retention.runner';

/**
 * 보존기간 정리 수용 증거 (OB-16 종결, 마이그레이션 0026).
 *
 * 증명해야 하는 것은 네 가지다.
 *   (1) 만료분만 비운다 — 기간 안의 행은 그대로다.
 *   (2) **증거는 남는다** — 해시·항목수·시각·상태는 손대지 않는다. 이것이
 *       "행을 지운다"와 "내용만 비운다"를 가르는 지점이다.
 *   (3) 테넌트를 가리지 않는다 — 전용 롤의 정책이 `USING (true)`다.
 *   (4) 다시 돌아도 `redacted_at`이 갱신되지 않는다. 갱신되면 "언제 비웠는가"가
 *       매 실행마다 오늘로 밀려 감사에서 무의미해진다.
 *
 * **이 e2e가 구조적으로 잡지 못하는 것.** 여기서는 superuser로 접속해
 * `SET LOCAL ROLE`로 강등하므로 그 전환이 항상 성공한다. 운영에서는 접속 롤이
 * 대상 롤의 멤버여야 하는데 저장소 어디에도 그 GRANT가 없다 — 지금 문서대로
 * 워커를 띄우면 이 스윕은 42501로 한 번도 돌지 않는다. 배포 전 항목 OB-17이며
 * 이 파일이 초록이라는 사실이 그것을 반증하지 않는다.
 */
const ADMIN_URL = process.env.DATABASE_URL;
const MIGRATIONS_DIR = resolve(process.cwd(), '..', '..', 'database', 'migrations');

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

interface Row {
  jobId: string;
  resultId: string;
}

describe.skipIf(!ADMIN_URL)('보존기간 정리 러너 e2e (OB-16)', () => {
  let dbName: string;
  let dbUrl: string;
  let config: WorkerConfig;
  let db: WorkerDatabase;

  /** ageDays일 전에 수집된 것처럼 넣는다. */
  const insertPair = async (c: Client, code: string, ageDays: number): Promise<Row> => {
    const tenantId = (
      await c.query(
        `INSERT INTO tenant (tenant_code, tenant_name, status) VALUES ($1, $1, 'ACTIVE')
         RETURNING tenant_id`,
        [code],
      )
    ).rows[0].tenant_id as string;
    const userId = (
      await c.query(
        `INSERT INTO app_user (tenant_id, login_id, display_name, status)
         VALUES ($1, $2, $2, 'ACTIVE') RETURNING user_id`,
        [tenantId, `ret-${code}`],
      )
    ).rows[0].user_id as string;
    const situationId = (
      await c.query(
        `INSERT INTO situation (tenant_id, mode, title, hazard_type, status, created_by)
         VALUES ($1, 'LIVE', $2, 'FLOOD', 'DRAFT', $3) RETURNING situation_id`,
        [tenantId, `보존 ${code}`, userId],
      )
    ).rows[0].situation_id as string;

    const jobId = (
      await c.query(
        `INSERT INTO provider_job
           (tenant_id, batch_id, situation_id, provider_code, request_json, status,
            result_count, correlation_id, created_at, finished_at)
         VALUES ($1, gen_random_uuid(), $2, 'KMA', $3::jsonb, 'SUCCEEDED', 1, $4,
                 now() - make_interval(days => $5::int), now() - make_interval(days => $5::int))
         RETURNING provider_job_id`,
        [
          tenantId,
          situationId,
          // 조회조건에 개인정보가 들어오는 경로가 이 필드다.
          JSON.stringify({ query: { 신고자: '홍길동', 주소: '서울시 ...' } }),
          `corr-${code}`,
          ageDays,
        ],
      )
    ).rows[0].provider_job_id as string;

    const resultId = (
      await c.query(
        `INSERT INTO provider_result
           (provider_job_id, seq, raw_payload_json, payload_sha256, item_count, received_at)
         VALUES ($1, 1, $2::jsonb, $3, 3, now() - make_interval(days => $4::int))
         RETURNING provider_result_id`,
        [jobId, JSON.stringify({ items: [{ 이름: '홍길동' }] }), code.padEnd(64, '0'), ageDays],
      )
    ).rows[0].provider_result_id as string;

    return { jobId, resultId };
  };

  beforeAll(async () => {
    const adminUrl = new URL(ADMIN_URL as string);
    dbName = `ob16_ret_${randomUUID().slice(0, 8)}`;
    await withClient(ADMIN_URL as string, (c) => c.query(`CREATE DATABASE ${dbName}`));
    adminUrl.pathname = `/${dbName}`;
    dbUrl = adminUrl.toString();
    await migrate({
      databaseUrl: dbUrl,
      dir: MIGRATIONS_DIR,
      migrationsTable: 'pgmigrations',
      ignorePattern: '\\..*|README\\.md',
      direction: 'up',
      logger: { info: () => {}, warn: () => {}, error: console.error, debug: () => {} },
    });
    config = loadWorkerConfig({
      DATABASE_URL: dbUrl,
      UNE_DB_RUNTIME_ROLE: 'une_worker',
      UNE_PAYLOAD_RETENTION_DAYS: '30',
    });
    db = new WorkerDatabase(config);
  }, 300_000);

  afterAll(async () => {
    if (db) await db.close();
    if (dbName) {
      await withClient(ADMIN_URL as string, (c) =>
        c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`),
      );
    }
  });

  it('만료분만 비우고 증거 컬럼은 그대로 남긴다', async () => {
    const old = await withClient(dbUrl, (c) => insertPair(c, 'ret-old', 40));
    const fresh = await withClient(dbUrl, (c) => insertPair(c, 'ret-fresh', 3));

    const swept = await new PayloadRetentionRunner(db, config).sweep();
    expect(swept.providerResults).toBe(1);
    expect(swept.providerJobs).toBe(1);

    await withClient(dbUrl, async (c) => {
      const oldRes = (
        await c.query(
          `SELECT raw_payload_json, redacted_at, payload_sha256, item_count, received_at
             FROM provider_result WHERE provider_result_id = $1`,
          [old.resultId],
        )
      ).rows[0];
      expect(oldRes.raw_payload_json).toEqual({ redacted: true });
      expect(oldRes.redacted_at).not.toBeNull();
      // 여기가 이 결정의 핵심이다 — 내용은 사라지고 "무엇을 받았다고
      // 주장하느냐"는 남는다.
      expect(oldRes.payload_sha256).toBe('ret-old'.padEnd(64, '0'));
      expect(oldRes.item_count).toBe(3);
      expect(oldRes.received_at).not.toBeNull();

      const oldJob = (
        await c.query(
          `SELECT request_json, redacted_at, status, result_count, correlation_id
             FROM provider_job WHERE provider_job_id = $1`,
          [old.jobId],
        )
      ).rows[0];
      expect(oldJob.request_json).toEqual({ redacted: true });
      expect(oldJob.redacted_at).not.toBeNull();
      expect(oldJob.status).toBe('SUCCEEDED');
      expect(oldJob.result_count).toBe(1);
      expect(oldJob.correlation_id).toBe('corr-ret-old');

      // 기간 안의 것은 손대지 않는다.
      const freshRes = (
        await c.query(
          `SELECT raw_payload_json, redacted_at FROM provider_result WHERE provider_result_id = $1`,
          [fresh.resultId],
        )
      ).rows[0];
      expect(freshRes.redacted_at).toBeNull();
      expect(freshRes.raw_payload_json).toEqual({ items: [{ 이름: '홍길동' }] });
    });
  });

  it('다시 돌아도 이미 비운 행의 redacted_at은 그대로다', async () => {
    const before = await withClient(dbUrl, (c) =>
      c.query(
        `SELECT provider_result_id, redacted_at FROM provider_result
         WHERE redacted_at IS NOT NULL ORDER BY received_at`,
      ),
    );
    expect(before.rowCount).toBeGreaterThan(0);

    const swept = await new PayloadRetentionRunner(db, config).sweep();
    expect(swept).toMatchObject({ providerResults: 0, providerJobs: 0 });

    const after = await withClient(dbUrl, (c) =>
      c.query(
        `SELECT provider_result_id, redacted_at FROM provider_result
         WHERE redacted_at IS NOT NULL ORDER BY received_at`,
      ),
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('테넌트를 가리지 않는다 (전용 롤 정책이 USING (true))', async () => {
    await withClient(dbUrl, (c) => insertPair(c, 'ret-t1', 45));
    await withClient(dbUrl, (c) => insertPair(c, 'ret-t2', 45));

    // 러너는 app.tenant_id를 세우지 않는다. 그런데도 두 테넌트가 모두 정리된다.
    const swept = await new PayloadRetentionRunner(db, config).sweep();
    expect(swept.providerResults).toBe(2);
    expect(swept.providerJobs).toBe(2);
  });

  it('한 번에 비우는 양이 배치 크기를 넘지 않는다', async () => {
    await withClient(dbUrl, (c) => insertPair(c, 'ret-b1', 60));
    await withClient(dbUrl, (c) => insertPair(c, 'ret-b2', 60));
    await withClient(dbUrl, (c) => insertPair(c, 'ret-b3', 60));

    const capped = loadWorkerConfig({
      DATABASE_URL: dbUrl,
      UNE_DB_RUNTIME_ROLE: 'une_worker',
      UNE_RETENTION_BATCH_SIZE: '2',
    });
    const first = await new PayloadRetentionRunner(db, capped).sweep();
    expect(first).toMatchObject({ providerResults: 2, providerJobs: 2 });

    const second = await new PayloadRetentionRunner(db, capped).sweep();
    expect(second).toMatchObject({ providerResults: 1, providerJobs: 1 });
  });

  it('두 러너가 동시에 돌아도 서로의 표식을 덮지 않는다', async () => {
    // 워커의 다른 파이프라인과 같은 축이다. `main.ts`가 기동 즉시 한 번
    // 스윕하므로 레플리카 둘이 같이 뜨면 **부팅마다** 같은 행 집합을 만난다.
    //
    // SKIP LOCKED가 없으면 두 트랜잭션이 각각 `redacted_at IS NULL`을 읽고
    // 순서대로 커밋해 나중 것이 앞의 `redacted_at`을 오늘로 덮거나(0027 이전),
    // 트리거에 걸려 **그 주기의 배치가 통째로 롤백**된다(0027 이후).
    const codes = ['ret-c1', 'ret-c2', 'ret-c3', 'ret-c4'];
    for (const code of codes) {
      await withClient(dbUrl, (c) => insertPair(c, code, 70));
    }
    const before = await withClient(dbUrl, (c) =>
      c.query(
        `SELECT count(*)::int AS n FROM provider_result
         WHERE redacted_at IS NULL AND received_at < now() - interval '30 days'`,
      ),
    );
    expect(before.rows[0].n).toBe(codes.length);

    const runner = new PayloadRetentionRunner(db, config);
    const [a, b] = await Promise.all([runner.sweep(), runner.sweep()]);

    // 둘 다 성공한다 — 한쪽이 42501로 죽지 않는다.
    // 합계는 정확히 만료분이고, 같은 행을 두 번 세지 않는다.
    expect(a.providerResults + b.providerResults).toBe(codes.length);
    expect(a.providerJobs + b.providerJobs).toBe(codes.length);

    const after = await withClient(dbUrl, (c) =>
      c.query(
        `SELECT count(*)::int AS n FROM provider_result
         WHERE redacted_at IS NULL AND received_at < now() - interval '30 days'`,
      ),
    );
    expect(after.rows[0].n).toBe(0);
  });

  it('스윕 결과가 남은 만료분을 함께 알려준다', async () => {
    // 건수만 찍으면 "이번에 몇 건 비웠나"만 보이고 백로그가 자라는 것은
    // 보이지 않는다. 배치 상한보다 유입이 많은 상황이 그것이다.
    await withClient(dbUrl, (c) => insertPair(c, 'ret-r1', 80));
    await withClient(dbUrl, (c) => insertPair(c, 'ret-r2', 80));
    await withClient(dbUrl, (c) => insertPair(c, 'ret-r3', 80));

    const capped = loadWorkerConfig({
      DATABASE_URL: dbUrl,
      UNE_DB_RUNTIME_ROLE: 'une_worker',
      UNE_RETENTION_BATCH_SIZE: '1',
    });
    const first = await new PayloadRetentionRunner(db, capped).sweep();
    expect(first.providerResults).toBe(1);
    expect(first.remainingResults).toBe(2);
    expect(first.remainingJobs).toBe(2);

    const second = await new PayloadRetentionRunner(db, capped).sweep();
    expect(second.remainingResults).toBe(1);
  });

  it('보존기간을 늘리면 아무것도 비우지 않는다 (기간은 운영 설정이다)', async () => {
    await withClient(dbUrl, (c) => insertPair(c, 'ret-long', 40));
    const longer = loadWorkerConfig({
      DATABASE_URL: dbUrl,
      UNE_DB_RUNTIME_ROLE: 'une_worker',
      UNE_PAYLOAD_RETENTION_DAYS: '365',
    });
    const swept = await new PayloadRetentionRunner(db, longer).sweep();
    expect(swept).toMatchObject({ providerResults: 0, providerJobs: 0 });
  });
});
