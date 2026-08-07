import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  ADMIN_URL,
  createTestDb,
  dropTestDb,
  insertFixture,
  migrate,
  withClient,
  type Fixture,
} from './db-helpers';

/**
 * CC-200 / migration 0023·0024: 상황 계열 테이블의 테넌트 격리.
 *
 * 0023 §5의 주석이 **이 파일명을 이미 참조하고 있었다.** 착수 시점 실측으로
 * `situation`만 RLS가 켜져 있었고 나머지 여섯(`fact_source`,`situation_fact`,
 * `provider_job`,`fact_conflict`,`conflict_resolution`,`situation_snapshot`)은
 * 정책이 한 번도 없었다. 0011이 `une_app`에 전 테이블 DML을 일괄 부여하므로
 * **정책 없는 테이블 = 전 테넌트 공개**였고, CC-200이 첫 쓰기 경로를 여는
 * 순간 규칙이 깨지는 상태였다.
 *
 * 검증하는 것은 세 갈래다.
 *   (1) 읽기 격리 — 다른 테넌트의 행이 보이지 않는다.
 *   (2) 쓰기 격리 — 다른 테넌트의 행을 만들 수 없다(WITH CHECK).
 *   (3) 권한 — `une_worker`는 이 테이블들에 42501로 막힌다. CC-200의 수집은
 *       동기 경로이고 워커는 여기 닿지 않는다(ADR-33 D2).
 */

/** tenant_id를 직접 세운 두 테이블(0023 §2/§4)과 부모 경유 다섯. */
const DIRECT_TENANT_TABLES = ['fact_source', 'provider_job'] as const;
const PARENT_SCOPED_TABLES = [
  'situation_fact',
  'provider_result',
  'fact_conflict',
  'conflict_resolution',
  'situation_snapshot',
] as const;
const ALL_SITUATION_TABLES = [
  'situation',
  ...DIRECT_TENANT_TABLES,
  ...PARENT_SCOPED_TABLES,
] as const;

interface SitFixture extends Fixture {
  sourceId: string;
  factId: string;
  providerJobId: string;
  providerResultId: string;
  conflictId: string;
  resolutionId: string;
  snapshotId: string;
}

async function asRole<T>(
  url: string,
  role: 'une_app' | 'une_worker',
  tenantId: string | null,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  return withClient(url, async (c) => {
    await c.query(`SET ROLE ${role}`);
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    return fn(c);
  });
}

/** 정책을 검증하는 데이터가 정책에 의존하면 안 되므로 admin으로 넣는다. */
async function insertSitFixture(c: Client, tenantCode: string): Promise<SitFixture> {
  const base = await insertFixture(c, tenantCode);

  const source = await c.query(
    `INSERT INTO fact_source (tenant_id, provider_code, source_type, source_name, retrieved_at)
     VALUES ($1, 'KMA', 'API', $2, now()) RETURNING source_id`,
    [base.tenantId, `${tenantCode} 출처`],
  );
  const sourceId = source.rows[0].source_id as string;

  const fact = await c.query(
    `INSERT INTO situation_fact
       (situation_id, fact_type, fact_key, value_json, source_id, collected_at, status)
     VALUES ($1, 'WEATHER_OBSERVATION', 'temperature', $2, $3, now(), 'CANDIDATE')
     RETURNING fact_id`,
    [base.situationId, JSON.stringify({ value: 25, unit: 'degC' }), sourceId],
  );
  const factId = fact.rows[0].fact_id as string;

  const job = await c.query(
    `INSERT INTO provider_job
       (tenant_id, batch_id, situation_id, provider_code, request_json, status,
        result_count, correlation_id, finished_at)
     VALUES ($1, gen_random_uuid(), $2, 'KMA', '{}'::jsonb, 'SUCCEEDED', 1, $3, now())
     RETURNING provider_job_id`,
    [base.tenantId, base.situationId, `corr-${tenantCode}`],
  );
  const providerJobId = job.rows[0].provider_job_id as string;

  const result = await c.query(
    `INSERT INTO provider_result
       (provider_job_id, seq, raw_payload_json, payload_sha256, item_count)
     VALUES ($1, 1, $2, $3, 1) RETURNING provider_result_id`,
    [providerJobId, JSON.stringify({ tenant: tenantCode }), 'b'.repeat(64)],
  );
  const providerResultId = result.rows[0].provider_result_id as string;

  // CC-210이 쓸 세 테이블. CC-200에는 쓰기 경로가 없지만 0023 §6이 격리를
  // 미리 닫았으므로 정책이 실제로 도는지는 지금 확인해 둔다.
  const conflict = await c.query(
    `INSERT INTO fact_conflict
       (situation_id, fact_key, candidate_fact_ids, conflict_type, status, detected_at)
     VALUES ($1, 'temperature', $2::uuid[], 'VALUE', 'OPEN', now()) RETURNING conflict_id`,
    [base.situationId, [factId]],
  );
  const conflictId = conflict.rows[0].conflict_id as string;

  const resolution = await c.query(
    `INSERT INTO conflict_resolution (conflict_id, selected_fact_id, reason, resolved_by)
     VALUES ($1, $2, $3, $4) RETURNING resolution_id`,
    [conflictId, factId, `${tenantCode} 픽스처`, base.userId],
  );
  const resolutionId = resolution.rows[0].resolution_id as string;

  const snapshot = await c.query(
    `INSERT INTO situation_snapshot
       (situation_id, version_no, facts_json, content_hash, effective_at, confirmed_by)
     VALUES ($1, 1, $2, $3, now(), $4) RETURNING snapshot_id`,
    [base.situationId, JSON.stringify({ tenant: tenantCode }), 'c'.repeat(64), base.userId],
  );

  return {
    ...base,
    sourceId,
    factId,
    providerJobId,
    providerResultId,
    conflictId,
    resolutionId,
    snapshotId: snapshot.rows[0].snapshot_id as string,
  };
}

describe.skipIf(!ADMIN_URL)('CC-200 / 0023: 상황 계열 테넌트 격리', () => {
  let dbName: string;
  let url: string;
  let a: SitFixture;
  let b: SitFixture;

  beforeAll(async () => {
    const db = await createTestDb('cc200_rls');
    dbName = db.name;
    url = db.url;
    await migrate(url);
    await withClient(url, async (c) => {
      a = await insertSitFixture(c, 'sit-rls-a');
      b = await insertSitFixture(c, 'sit-rls-b');
    });
  }, 180_000);

  afterAll(async () => {
    if (dbName) await dropTestDb(dbName);
  });

  it('일곱 테이블 모두 RLS가 켜져 있고 FORCE다', async () => {
    const rows = await withClient(url, (c) =>
      c.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname`,
        [[...ALL_SITUATION_TABLES]],
      ),
    );
    expect(rows.rowCount).toBe(ALL_SITUATION_TABLES.length);
    for (const row of rows.rows) {
      expect(`${row.relname}:rls=${row.relrowsecurity}`).toBe(`${row.relname}:rls=true`);
      // FORCE가 없으면 테이블 소유자에게는 정책이 적용되지 않는다.
      expect(`${row.relname}:force=${row.relforcerowsecurity}`).toBe(`${row.relname}:force=true`);
    }
  });

  it('테이블마다 정책이 하나 이상 있다 (정책 없는 RLS는 전면 차단이거나 무의미)', async () => {
    const rows = await withClient(url, (c) =>
      c.query(
        `SELECT tablename, count(*)::int AS n FROM pg_policies
         WHERE tablename = ANY($1::text[]) GROUP BY tablename ORDER BY tablename`,
        [[...ALL_SITUATION_TABLES]],
      ),
    );
    expect(rows.rows.map((r) => r.tablename)).toEqual([...ALL_SITUATION_TABLES].sort());
  });

  describe('읽기 격리', () => {
    it('다른 기관의 행은 보이지 않는다', async () => {
      const counts = await asRole(url, 'une_app', a.tenantId, async (c) => ({
        situation: (
          await c.query(`SELECT count(*)::int n FROM situation WHERE situation_id = $1`, [
            b.situationId,
          ])
        ).rows[0].n,
        factSource: (
          await c.query(`SELECT count(*)::int n FROM fact_source WHERE source_id = $1`, [
            b.sourceId,
          ])
        ).rows[0].n,
        fact: (
          await c.query(`SELECT count(*)::int n FROM situation_fact WHERE fact_id = $1`, [b.factId])
        ).rows[0].n,
        providerJob: (
          await c.query(`SELECT count(*)::int n FROM provider_job WHERE provider_job_id = $1`, [
            b.providerJobId,
          ])
        ).rows[0].n,
        providerResult: (
          await c.query(
            `SELECT count(*)::int n FROM provider_result WHERE provider_result_id = $1`,
            [b.providerResultId],
          )
        ).rows[0].n,
        conflict: (
          await c.query(`SELECT count(*)::int n FROM fact_conflict WHERE conflict_id = $1`, [
            b.conflictId,
          ])
        ).rows[0].n,
        resolution: (
          await c.query(
            `SELECT count(*)::int n FROM conflict_resolution WHERE resolution_id = $1`,
            [b.resolutionId],
          )
        ).rows[0].n,
        snapshot: (
          await c.query(`SELECT count(*)::int n FROM situation_snapshot WHERE snapshot_id = $1`, [
            b.snapshotId,
          ])
        ).rows[0].n,
      }));
      expect(counts).toEqual({
        situation: 0,
        factSource: 0,
        fact: 0,
        providerJob: 0,
        providerResult: 0,
        conflict: 0,
        resolution: 0,
        snapshot: 0,
      });
    });

    it('자기 기관의 행은 보인다 (정책이 vacuous하게 전부 막지 않는다)', async () => {
      const counts = await asRole(url, 'une_app', a.tenantId, async (c) => ({
        factSource: (
          await c.query(`SELECT count(*)::int n FROM fact_source WHERE source_id = $1`, [
            a.sourceId,
          ])
        ).rows[0].n,
        fact: (
          await c.query(`SELECT count(*)::int n FROM situation_fact WHERE fact_id = $1`, [a.factId])
        ).rows[0].n,
        providerResult: (
          await c.query(
            `SELECT count(*)::int n FROM provider_result WHERE provider_result_id = $1`,
            [a.providerResultId],
          )
        ).rows[0].n,
        snapshot: (
          await c.query(`SELECT count(*)::int n FROM situation_snapshot WHERE snapshot_id = $1`, [
            a.snapshotId,
          ])
        ).rows[0].n,
      }));
      expect(counts).toEqual({ factSource: 1, fact: 1, providerResult: 1, snapshot: 1 });
    });

    it('테넌트 스코프가 없으면 아무것도 보이지 않는다', async () => {
      const n = await asRole(url, 'une_app', null, async (c) => {
        const r = await c.query(`SELECT count(*)::int n FROM fact_source`);
        return r.rows[0].n as number;
      });
      expect(n).toBe(0);
    });
  });

  describe('쓰기 격리 (WITH CHECK)', () => {
    it('다른 기관의 tenant_id로 출처를 만들 수 없다', async () => {
      await expect(
        asRole(url, 'une_app', a.tenantId, (c) =>
          c.query(
            `INSERT INTO fact_source (tenant_id, provider_code, source_type, source_name, retrieved_at)
             VALUES ($1, 'KMA', 'API', '침입', now())`,
            [b.tenantId],
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('다른 기관의 상황에 Fact를 심을 수 없다', async () => {
      await expect(
        asRole(url, 'une_app', a.tenantId, (c) =>
          c.query(
            `INSERT INTO situation_fact
               (situation_id, fact_type, fact_key, value_json, source_id, collected_at, status)
             VALUES ($1, 'FIELD_REPORT', 'reporter', '"침입"'::jsonb, $2, now(), 'CANDIDATE')`,
            [b.situationId, a.sourceId],
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('다른 기관의 Job에 원문을 붙일 수 없다', async () => {
      await expect(
        asRole(url, 'une_app', a.tenantId, (c) =>
          c.query(
            `INSERT INTO provider_result
               (provider_job_id, seq, raw_payload_json, payload_sha256, item_count)
             VALUES ($1, 2, '{}'::jsonb, $2, 0)`,
            [b.providerJobId, 'd'.repeat(64)],
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe('불변·추가전용 권한', () => {
    it('une_app은 provider_job/provider_result를 고치거나 지울 수 없다', async () => {
      for (const [table, sql] of [
        ['provider_job', `UPDATE provider_job SET result_count = 99`],
        ['provider_job', `DELETE FROM provider_job`],
        ['provider_result', `UPDATE provider_result SET item_count = 99`],
        ['provider_result', `DELETE FROM provider_result`],
      ] as const) {
        await expect(
          asRole(url, 'une_app', a.tenantId, (c) => c.query(sql)),
          `${table}: ${sql}`,
        ).rejects.toThrow(/permission denied/i);
      }
    });

    it('une_app은 situation_fact를 지울 수 없다 (거부는 REJECTED이지 삭제가 아니다)', async () => {
      await expect(
        asRole(url, 'une_app', a.tenantId, (c) => c.query(`DELETE FROM situation_fact`)),
      ).rejects.toThrow(/permission denied/i);
    });

    it('une_app은 situation_fact를 UPDATE할 수 있다 (UNE-SIT-008 보정)', async () => {
      const updated = await asRole(url, 'une_app', a.tenantId, async (c) => {
        const r = await c.query(`UPDATE situation_fact SET confidence = 0.5 WHERE fact_id = $1`, [
          a.factId,
        ]);
        return r.rowCount;
      });
      expect(updated).toBe(1);
    });
  });

  describe('워커 권한 (ADR-33 D2: 수집은 동기 경로이며 워커는 닿지 않는다)', () => {
    it('une_worker는 상황 계열 테이블에 42501로 막힌다', async () => {
      for (const table of ALL_SITUATION_TABLES) {
        await expect(
          asRole(url, 'une_worker', a.tenantId, (c) => c.query(`SELECT 1 FROM ${table} LIMIT 1`)),
          `SELECT ${table}`,
        ).rejects.toThrow(/permission denied/i);
      }
    });

    it('une_worker는 후보 Fact를 만들 수도 없다', async () => {
      await expect(
        asRole(url, 'une_worker', a.tenantId, (c) =>
          c.query(
            `INSERT INTO situation_fact
               (situation_id, fact_type, fact_key, value_json, source_id, collected_at, status)
             VALUES ($1, 'FIELD_REPORT', 'reporter', '"워커"'::jsonb, $2, now(), 'CANDIDATE')`,
            [a.situationId, a.sourceId],
          ),
        ),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  describe('0024: updated_at 트리거', () => {
    it('situation / situation_fact UPDATE가 updated_at을 움직인다', async () => {
      const moved = await withClient(url, async (c) => {
        const before = await c.query(
          `SELECT (SELECT updated_at FROM situation WHERE situation_id = $1) AS s,
                  (SELECT updated_at FROM situation_fact WHERE fact_id = $2) AS f`,
          [a.situationId, a.factId],
        );
        await c.query(`UPDATE situation SET title = title || '.' WHERE situation_id = $1`, [
          a.situationId,
        ]);
        await c.query(`UPDATE situation_fact SET confidence = 0.9 WHERE fact_id = $1`, [a.factId]);
        const after = await c.query(
          `SELECT (SELECT updated_at FROM situation WHERE situation_id = $1) AS s,
                  (SELECT updated_at FROM situation_fact WHERE fact_id = $2) AS f`,
          [a.situationId, a.factId],
        );
        return {
          situation: after.rows[0].s.getTime() > before.rows[0].s.getTime(),
          fact: after.rows[0].f.getTime() > before.rows[0].f.getTime(),
        };
      });
      expect(moved).toEqual({ situation: true, fact: true });
    });
  });
});
