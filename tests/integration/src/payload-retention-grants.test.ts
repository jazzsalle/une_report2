import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  ADMIN_URL,
  createTestDb,
  dropTestDb,
  insertFixture,
  migrate,
  withClient,
} from './db-helpers';

/**
 * 마이그레이션 0026: 보존 정리 전용 롤의 권한 경계 (OB-16).
 *
 * 러너의 동작은 워커 e2e가 증명한다. 여기서 고정하는 것은 **권한 그 자체**다.
 * 0026이 만든 롤이 필요 이상을 갖게 되면 최소권한 규칙이 깨지고, 반대로
 * 기존 롤들이 이 권한을 나눠 갖게 되면 ADR-33 D2가 조용히 뒤집힌다.
 *
 * 다섯 갈래를 단언한다.
 *   (1) `une_retention`은 RLS를 우회하지 못한다(NOBYPASSRLS). 전 테넌트가
 *       보이는 이유는 롤 속성이 아니라 `pg_policies`에 드러나는 정책이다.
 *   (2) 두 컬럼 외에는 UPDATE가 없다 — 증거 컬럼은 여전히 불변이다.
 *   (3) INSERT/DELETE가 없다. 행이 사라지면 "그때 무엇을 물었는가"도 사라진다.
 *   (4) `une_app`은 여전히 이 테이블들을 수정할 수 없다(0023이 회수한 그대로).
 *   (5) `une_worker`는 여전히 42501이다(ADR-33 D2).
 */

const RETENTION_ROLE = 'une_retention';

async function asRole<T>(
  url: string,
  role: string,
  tenantId: string | null,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  return withClient(url, async (c) => {
    await c.query(`SET ROLE ${role}`);
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    return fn(c);
  });
}

async function errCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'NO_ERROR';
  } catch (err) {
    return (err as { code?: string }).code ?? 'UNKNOWN';
  }
}

describe.skipIf(!ADMIN_URL)('0026: 보존 정리 롤의 권한 경계 (OB-16)', () => {
  let dbName: string;
  let url: string;
  let tenantAId: string;
  let tenantBId: string;
  let jobAId: string;
  let resultAId: string;

  const seed = async (
    c: Client,
    code: string,
  ): Promise<{ tenantId: string; jobId: string; resultId: string }> => {
    const base = await insertFixture(c, code);
    const jobId = (
      await c.query(
        `INSERT INTO provider_job
           (tenant_id, batch_id, situation_id, provider_code, request_json, status,
            result_count, correlation_id, created_at, finished_at)
         VALUES ($1, gen_random_uuid(), $2, 'KMA', '{"query":{}}'::jsonb, 'SUCCEEDED', 1, $3,
                 now() - interval '90 days', now() - interval '90 days')
         RETURNING provider_job_id`,
        [base.tenantId, base.situationId, `ret-grant-${code}`],
      )
    ).rows[0].provider_job_id as string;
    const resultId = (
      await c.query(
        `INSERT INTO provider_result
           (provider_job_id, seq, raw_payload_json, payload_sha256, item_count, received_at)
         VALUES ($1, 1, '{"items":[]}'::jsonb, $2, 0, now() - interval '90 days')
         RETURNING provider_result_id`,
        [jobId, 'd'.repeat(64)],
      )
    ).rows[0].provider_result_id as string;
    return { tenantId: base.tenantId, jobId, resultId };
  };

  beforeAll(async () => {
    const db = await createTestDb('ob16_grants');
    dbName = db.name;
    url = db.url;
    await migrate(url);
    await withClient(url, async (c) => {
      const a = await seed(c, 'ret-a');
      const b = await seed(c, 'ret-b');
      tenantAId = a.tenantId;
      tenantBId = b.tenantId;
      jobAId = a.jobId;
      resultAId = a.resultId;
    });
  }, 180_000);

  afterAll(async () => {
    if (dbName) await dropTestDb(dbName);
  });

  it('롤은 로그인 불가·RLS 우회 불가다', async () => {
    const rows = await withClient(url, (c) =>
      c.query(
        `SELECT rolcanlogin, rolbypassrls, rolsuper, rolcreatedb, rolcreaterole
         FROM pg_roles WHERE rolname = $1`,
        [RETENTION_ROLE],
      ),
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toEqual({
      rolcanlogin: false,
      rolbypassrls: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
  });

  it('전 테넌트가 보이는 근거가 정책으로 드러난다', async () => {
    const rows = await withClient(url, (c) =>
      c.query(
        `SELECT tablename, policyname, roles::text AS roles, qual
         FROM pg_policies
         WHERE policyname IN ('p_provider_result_retention', 'p_provider_job_retention')
         ORDER BY tablename`,
      ),
    );
    expect(rows.rows.map((r) => r.tablename)).toEqual(['provider_job', 'provider_result']);
    for (const row of rows.rows) {
      expect(row.roles).toBe(`{${RETENTION_ROLE}}`);
      expect(row.qual).toBe('true');
    }
  });

  it('테이블 단위 권한은 SELECT뿐이다 (INSERT/DELETE/TRUNCATE 없음)', async () => {
    const rows = await withClient(url, (c) =>
      c.query(
        `SELECT table_name, privilege_type FROM information_schema.table_privileges
         WHERE grantee = $1 ORDER BY table_name, privilege_type`,
        [RETENTION_ROLE],
      ),
    );
    expect(rows.rows).toEqual([
      { table_name: 'provider_job', privilege_type: 'SELECT' },
      { table_name: 'provider_result', privilege_type: 'SELECT' },
    ]);
  });

  it('UPDATE는 페이로드와 표식 컬럼에만 있다', async () => {
    const rows = await withClient(url, (c) =>
      c.query(
        `SELECT table_name, column_name FROM information_schema.column_privileges
         WHERE grantee = $1 AND privilege_type = 'UPDATE'
         ORDER BY table_name, column_name`,
        [RETENTION_ROLE],
      ),
    );
    expect(rows.rows).toEqual([
      { table_name: 'provider_job', column_name: 'redacted_at' },
      { table_name: 'provider_job', column_name: 'request_json' },
      { table_name: 'provider_result', column_name: 'raw_payload_json' },
      { table_name: 'provider_result', column_name: 'redacted_at' },
    ]);
  });

  it('증거 컬럼은 전용 롤로도 바꿀 수 없다', async () => {
    // 이 단언이 무너지면 "해시는 남는다"는 이 결정의 전제가 사라진다.
    expect(
      await errCode(() =>
        asRole(url, RETENTION_ROLE, null, (c) =>
          c.query(`UPDATE provider_result SET payload_sha256 = $1 WHERE provider_result_id = $2`, [
            'e'.repeat(64),
            resultAId,
          ]),
        ),
      ),
    ).toBe('42501');

    expect(
      await errCode(() =>
        asRole(url, RETENTION_ROLE, null, (c) =>
          c.query(`UPDATE provider_job SET status = 'FAILED' WHERE provider_job_id = $1`, [jobAId]),
        ),
      ),
    ).toBe('42501');
  });

  it('행을 지울 수 없다', async () => {
    expect(
      await errCode(() =>
        asRole(url, RETENTION_ROLE, null, (c) =>
          c.query(`DELETE FROM provider_result WHERE provider_result_id = $1`, [resultAId]),
        ),
      ),
    ).toBe('42501');
    expect(
      await errCode(() =>
        asRole(url, RETENTION_ROLE, null, (c) =>
          c.query(`DELETE FROM provider_job WHERE provider_job_id = $1`, [jobAId]),
        ),
      ),
    ).toBe('42501');
  });

  it('표식만 세우고 내용을 남길 수 없다', async () => {
    // 0026만 있을 때는 CHECK가 23514로 막았다. 0027의 트리거는 BEFORE ROW라
    // 제약 검사보다 먼저 돌고, 이 UPDATE는 허용 전이가 아니므로 42501에서
    // 걸린다. 거부되는 사실은 같고 게이트가 하나 더 앞으로 왔다.
    //
    // CHECK는 그대로 둔다 — 트리거가 무력화되는 경로(session_replication_role
    // 등)에서도 "표식이 있는데 내용이 남은" 상태만은 DB가 끝까지 거부한다.
    expect(
      await errCode(() =>
        asRole(url, RETENTION_ROLE, null, (c) =>
          c.query(`UPDATE provider_result SET redacted_at = now() WHERE provider_result_id = $1`, [
            resultAId,
          ]),
        ),
      ),
    ).toBe('42501');
  });

  it('une_app은 여전히 원문을 고치거나 지울 수 없다', async () => {
    expect(
      await errCode(() =>
        asRole(url, 'une_app', tenantAId, (c) =>
          c.query(`UPDATE provider_result SET raw_payload_json = '{}'::jsonb`),
        ),
      ),
    ).toBe('42501');
    expect(
      await errCode(() =>
        asRole(url, 'une_app', tenantAId, (c) => c.query(`DELETE FROM provider_job`)),
      ),
    ).toBe('42501');
  });

  it('une_worker는 provider_result를 여전히 읽지 못한다 (ADR-36 D4)', async () => {
    // CC-220이 워커에게 provider_job을 열었지만 **provider_result의 SELECT는
    // 열지 않았다.** 원문을 남기는 데 읽기는 필요 없고, 읽기까지 주면 정책
    // 결함 하나가 전 테넌트의 Provider 원문을 노출한다. 권한 부재는 정책
    // 결함으로 뚫리지 않으므로 이 42501은 그대로 남는다.
    expect(
      await errCode(() =>
        asRole(url, 'une_worker', null, (c) => c.query(`SELECT 1 FROM provider_result LIMIT 1`)),
      ),
    ).toBe('42501');

    // provider_job은 권한이 생겼다. 대신 상황 수집 행은 제한 정책이 가려
    // **0행**이다 — situation-table-rls.test.ts가 그 경계를 단언한다.
    const rows = await asRole(url, 'une_worker', null, (c) =>
      c.query(`SELECT provider_job_id FROM provider_job`),
    );
    expect(rows.rows).toEqual([]);
  });

  it('전용 롤은 테넌트를 세우지 않아도 두 테넌트의 행을 모두 본다', async () => {
    const rows = await asRole(url, RETENTION_ROLE, null, (c) =>
      c.query(`SELECT DISTINCT tenant_id FROM provider_job ORDER BY tenant_id`),
    );
    expect(rows.rows.map((r) => r.tenant_id).sort()).toEqual([tenantAId, tenantBId].sort());
  });

  it('une_app에게는 여전히 자기 테넌트만 보인다 (전용 정책이 새지 않는다)', async () => {
    const rows = await asRole(url, 'une_app', tenantAId, (c) =>
      c.query(`SELECT DISTINCT tenant_id FROM provider_job`),
    );
    expect(rows.rows.map((r) => r.tenant_id)).toEqual([tenantAId]);
  });

  // ── 0027: 컬럼 GRANT만으로는 막히지 않는 두 갈래 ──
  //
  // 0026의 CHECK는 `redacted_at IS NULL OR 내용 = 마스킹값` 한 방향만 막는다.
  // 표식을 세우지 않은 채 내용을 **다른 값으로** 덮는 것과, 이미 비운 행의
  // 표식을 **지우는** 것은 그 술어를 그대로 통과한다. 전자는 0023이 지키던
  // 원문 불변성이 뚫리는 것이고 후자는 "원래 비어 있었다"와 "비웠다"를
  // 구분하려던 `redacted_at`의 목적이 그 자리에서 무효가 되는 것이다.
  // 0027의 트리거가 허용 전이를 한 갈래로 고정한다.

  it('원문을 임의 값으로 덮어쓸 수 없다 (마스킹 값만 허용)', async () => {
    expect(
      await errCode(() =>
        asRole(url, RETENTION_ROLE, null, (c) =>
          c.query(
            `UPDATE provider_result SET raw_payload_json = '{"forged":1}'::jsonb
             WHERE provider_result_id = $1`,
            [resultAId],
          ),
        ),
      ),
    ).toBe('42501');

    expect(
      await errCode(() =>
        asRole(url, RETENTION_ROLE, null, (c) =>
          c.query(
            `UPDATE provider_job SET request_json = '{"forged":1}'::jsonb
             WHERE provider_job_id = $1`,
            [jobAId],
          ),
        ),
      ),
    ).toBe('42501');
  });

  it('이미 비운 행은 표식을 지우거나 다시 쓸 수 없다', async () => {
    const target = await withClient(url, (c) => seed(c, 'ret-redo'));

    // 정상 경로로 한 번 비운다 — 이것은 통과해야 한다.
    await asRole(url, RETENTION_ROLE, null, (c) =>
      c.query(
        `UPDATE provider_result
         SET raw_payload_json = '{"redacted": true}'::jsonb, redacted_at = now()
         WHERE provider_result_id = $1`,
        [target.resultId],
      ),
    );

    // 표식 지우기 — "비운 적 없다"로 되돌리는 경로다.
    expect(
      await errCode(() =>
        asRole(url, RETENTION_ROLE, null, (c) =>
          c.query(`UPDATE provider_result SET redacted_at = NULL WHERE provider_result_id = $1`, [
            target.resultId,
          ]),
        ),
      ),
    ).toBe('42501');

    // 비운 행에 내용을 다시 써넣기 — 마스킹 값이어도 시각이 오늘로 밀린다.
    expect(
      await errCode(() =>
        asRole(url, RETENTION_ROLE, null, (c) =>
          c.query(
            `UPDATE provider_result
             SET raw_payload_json = '{"redacted": true}'::jsonb, redacted_at = now()
             WHERE provider_result_id = $1`,
            [target.resultId],
          ),
        ),
      ),
    ).toBe('42501');
  });
});
