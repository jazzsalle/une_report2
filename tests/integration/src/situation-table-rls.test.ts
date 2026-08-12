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
  // 0025 (CC-210). 상황 계열에서 **유일하게 une_app에 DELETE가 열려 있는 곳**
  // 이므로(재계산이 지우고 다시 넣는다) 정책이 잘못되면 남의 계산 결과를 지울
  // 수 있다. 신설 테이블만 회귀 단언 밖에 있었다(아키텍처 리뷰 M-11).
  'fact_duplicate_group',
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

  // 충돌은 둘 이상이어야 충돌이다(0025 §4 ck_fact_conflict_candidates).
  const second = await c.query(
    `INSERT INTO situation_fact
       (situation_id, fact_type, fact_key, value_json, source_id, collected_at, status)
     VALUES ($1, 'WEATHER_OBSERVATION', 'temperature', $2, $3, now(), 'CANDIDATE')
     RETURNING fact_id`,
    [base.situationId, JSON.stringify({ value: 27, unit: 'degC' }), sourceId],
  );
  const secondFactId = second.rows[0].fact_id as string;

  const conflict = await c.query(
    `INSERT INTO fact_conflict
       (situation_id, fact_key, candidate_fact_ids, conflict_type, status, detected_at)
     VALUES ($1, 'temperature', $2::uuid[], 'VALUE', 'OPEN', now()) RETURNING conflict_id`,
    [base.situationId, [factId, secondFactId]],
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
    // 확정된 Snapshot은 사실을 하나 이상 담는다(0025 §6).
    [base.situationId, JSON.stringify([{ tenant: tenantCode }]), 'c'.repeat(64), base.userId],
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

  it('여덟 테이블 모두 RLS가 켜져 있고 FORCE다', async () => {
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
    // 0028(CC-220)이 `provider_job`에만 워커 권한을 열었다 — 설계 10 §7.23
    // 7단계가 UNI 호출자를 워커로 정했기 때문이다. 나머지는 그대로 42501이며
    // **`provider_result`의 SELECT가 없다는 것이 특히 중요하다**: 원문을 남기는
    // 데 읽기는 필요 없고, 읽기까지 열면 정책 결함 하나가 전 테넌트의 Provider
    // 원문을 노출한다. 그래서 워커에게는 INSERT만 있다.
    //
    // 0033(CC-240)이 둘을 더 열었다 — `situation`과 `situation_snapshot`.
    // SOP 생성 러너가 확정 사실을 읽어야 하기 때문이고, **읽기뿐이다**
    // (쓰기는 `situation.status` 한 열 + `CONTEXT_CONFIRMED → SOP_READY` 한
    // 전이로 제한한다, ADR-38 D14). 이 목록이 "워커가 상황 계열에서 볼 수 있는
    // 것의 전부"이며, 늘어날 때마다 그 이유가 마이그레이션에 적혀야 한다.
    const WORKER_READABLE: readonly string[] = ['provider_job', 'situation', 'situation_snapshot'];
    const STILL_DENIED = ALL_SITUATION_TABLES.filter((t) => !WORKER_READABLE.includes(t));

    it('워커가 읽을 수 있는 상황 계열은 셋뿐이다 (0028 + 0033)', () => {
      // 목록 자체를 고정한다. 새 항목이 권한을 열면 이 단언이 먼저 깨져,
      // "왜 열었는가"를 적지 않고는 통과할 수 없다.
      expect([...WORKER_READABLE].sort()).toEqual([
        'provider_job',
        'situation',
        'situation_snapshot',
      ]);
    });

    it('워커는 상황과 확정 판을 읽되 자기 테넌트 것만 본다 (0033)', async () => {
      const mine = await asRole(url, 'une_worker', a.tenantId, (c) =>
        c.query(`SELECT situation_id FROM situation WHERE situation_id = $1`, [a.situationId]),
      );
      expect(mine.rows).toHaveLength(1);

      const theirs = await asRole(url, 'une_worker', a.tenantId, (c) =>
        c.query(`SELECT situation_id FROM situation WHERE situation_id = $1`, [b.situationId]),
      );
      expect(theirs.rows).toEqual([]);

      // 확정 판은 부모 경유 정책이므로 같은 결론이 자식에도 적용된다.
      const snapshots = await asRole(url, 'une_worker', a.tenantId, (c) =>
        c.query(`SELECT snapshot_id FROM situation_snapshot WHERE snapshot_id = $1`, [
          b.snapshotId,
        ]),
      );
      expect(snapshots.rows).toEqual([]);
    });

    it('워커는 상황을 만들거나 지울 수 없다 (0033은 읽기와 상태 한 칸뿐이다)', async () => {
      await expect(
        asRole(url, 'une_worker', a.tenantId, (c) =>
          c.query(`DELETE FROM situation WHERE situation_id = $1`, [a.situationId]),
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        asRole(url, 'une_worker', a.tenantId, (c) =>
          c.query(
            `INSERT INTO situation (tenant_id, mode, title, hazard_type, status, created_by)
             VALUES ($1,'LIVE','워커가 만든 상황','FLOOD','DRAFT',$2)`,
            [a.tenantId, a.userId],
          ),
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('une_worker는 나머지 상황 계열 테이블에 42501로 막힌다', async () => {
      for (const table of STILL_DENIED) {
        await expect(
          asRole(url, 'une_worker', a.tenantId, (c) => c.query(`SELECT 1 FROM ${table} LIMIT 1`)),
          `SELECT ${table}`,
        ).rejects.toThrow(/permission denied/i);
      }
    });

    it('une_worker는 provider_result를 읽을 수 없다 (INSERT만 있다 — 0028)', async () => {
      // 권한 부재는 정책 결함으로 뚫리지 않는다. 이 단언이 무너지면 워커
      // 프로세스의 결함 하나가 전 테넌트 원문 노출로 이어진다.
      await expect(
        asRole(url, 'une_worker', null, (c) => c.query(`SELECT 1 FROM provider_result LIMIT 1`)),
      ).rejects.toThrow(/permission denied/i);
      const privs = await withClient(url, (c) =>
        c.query(
          `SELECT privilege_type FROM information_schema.table_privileges
           WHERE grantee = 'une_worker' AND table_name = 'provider_result'
           ORDER BY privilege_type`,
        ),
      );
      expect(privs.rows.map((r) => r.privilege_type)).toEqual(['INSERT']);
    });

    it('provider_job에 권한이 생겼어도 상황 수집 행은 어떤 경로로도 보이지 않는다', async () => {
      // 0028은 42501을 "권한은 있으나 0행"으로 바꿨다. 그 대체가 실제로 같은
      // 것을 지키는지가 여기서 갈린다. 워커가 **테넌트를 세운** 트랜잭션이
      // 위험한 경로다 — 기존 테넌트 정책은 TO PUBLIC이라 permissive OR로
      // 합쳐지고, 제한 정책이 없으면 그 순간 KMA 행이 보인다.
      const withTenant = await asRole(url, 'une_worker', a.tenantId, (c) =>
        c.query(`SELECT provider_job_id FROM provider_job`),
      );
      expect(withTenant.rows).toEqual([]);

      const withoutTenant = await asRole(url, 'une_worker', null, (c) =>
        c.query(`SELECT provider_job_id FROM provider_job`),
      );
      expect(withoutTenant.rows).toEqual([]);

      // 제한 정책이 그 근거이며 pg_policies에 드러난다.
      const restrictive = await withClient(url, (c) =>
        c.query(
          `SELECT permissive, roles::text AS roles, qual FROM pg_policies
           WHERE tablename = 'provider_job' AND policyname = 'p_provider_job_worker_only_uni'`,
        ),
      );
      expect(restrictive.rows).toHaveLength(1);
      expect(restrictive.rows[0].permissive).toBe('RESTRICTIVE');
      expect(restrictive.rows[0].roles).toBe('{une_worker}');
      expect(restrictive.rows[0].qual).toContain('UNI');
    });

    it('une_worker는 UNI 잡의 요청조건을 비울 수 없다 (0030 — 컬럼 단위 권한)', async () => {
      // 아키텍처 검토 M1. 0028이 테이블 단위 UPDATE를 주면 워커가
      // `request_json`/`redacted_at`을 쓸 수 있다 — 0026이 전용 롤 뒤로 격리한
      // 바로 그 두 컬럼이고, 0029의 트리거는 마스킹 전이를 롤과 무관하게
      // 허용하므로 트리거도 막지 못한다.
      const uniJob = await withClient(url, async (c) => {
        const r = await c.query(
          `INSERT INTO provider_job
             (tenant_id, batch_id, situation_id, provider_code, request_json, status,
              result_count, correlation_id)
           VALUES ($1, gen_random_uuid(), $2, 'UNI', '{"q":1}'::jsonb, 'QUEUED', 0, 'uni-m1')
           RETURNING provider_job_id`,
          [a.tenantId, a.situationId],
        );
        return r.rows[0].provider_job_id as string;
      });

      await expect(
        asRole(url, 'une_worker', a.tenantId, (c) =>
          c.query(
            `UPDATE provider_job
                SET request_json = '{"redacted": true}'::jsonb, redacted_at = now()
              WHERE provider_job_id = $1`,
            [uniJob],
          ),
        ),
      ).rejects.toThrow(/permission denied/i);

      // 보존 마스킹은 여전히 전용 롤만의 일이다.
      const still = await withClient(url, (c) =>
        c.query(`SELECT redacted_at FROM provider_job WHERE provider_job_id = $1`, [uniJob]),
      );
      expect(still.rows[0].redacted_at).toBeNull();
    });

    it('une_worker는 종결된 UNI 잡을 되돌릴 수 없다 (0030 — 제한 정책)', async () => {
      // 아키텍처 검토 M2. 테넌트를 세운 트랜잭션에서는 permissive 테넌트 정책이
      // OR로 통과하므로, 미종결 조건이 permissive 쪽에만 있으면 종결된 잡도
      // 잡힌다. 0029의 주석이 "지금은 도달 경로가 없다"고 적었던 바로 그 경로다.
      const settled = await withClient(url, async (c) => {
        const r = await c.query(
          `INSERT INTO provider_job
             (tenant_id, batch_id, situation_id, provider_code, request_json, status,
              result_count, correlation_id, finished_at)
           VALUES ($1, gen_random_uuid(), $2, 'UNI', '{"q":1}'::jsonb, 'SUCCEEDED', 1,
                   'uni-m2', now())
           RETURNING provider_job_id`,
          [a.tenantId, a.situationId],
        );
        return r.rows[0].provider_job_id as string;
      });

      const updated = await asRole(url, 'une_worker', a.tenantId, async (c) => {
        const r = await c.query(
          `UPDATE provider_job
              SET status = 'QUEUED', result_count = 0, finished_at = NULL, error_json = NULL
            WHERE provider_job_id = $1`,
          [settled],
        );
        return r.rowCount;
      });
      expect(updated).toBe(0);

      const after = await withClient(url, (c) =>
        c.query(`SELECT status FROM provider_job WHERE provider_job_id = $1`, [settled]),
      );
      expect(after.rows[0].status).toBe('SUCCEEDED');
    });

    it('une_worker는 상황 수집 잡을 고칠 수 없다 (제한 정책이 쓰기도 막는다)', async () => {
      // 대상은 **상황 수집(KMA) 잡**이다. WHERE 없이 전체를 치면 같은 DB에
      // 있는 UNI 픽스처까지 걸려 이 단언이 무엇을 증명하는지 흐려진다.
      const updated = await asRole(url, 'une_worker', a.tenantId, async (c) => {
        const r = await c.query(
          `UPDATE provider_job SET result_count = 99 WHERE provider_job_id = $1`,
          [a.providerJobId],
        );
        return r.rowCount;
      });
      expect(updated).toBe(0);
      const still = await withClient(url, (c) =>
        c.query(`SELECT result_count FROM provider_job WHERE provider_job_id = $1`, [
          a.providerJobId,
        ]),
      );
      expect(still.rows[0].result_count).not.toBe(99);
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
