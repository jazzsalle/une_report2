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
 * 마이그레이션 0032 (CC-240): SOP 그래프 테넌트 격리.
 *
 * 착수 시점 실측으로 `sop_version`·`sop_node`·`sop_edge`에 **정책이 한 번도
 * 없었다.** 0008은 `sop`에만 걸었고, 0011이 `une_app`에 전 테이블 DML을
 * 일괄 부여하므로 정책 없는 자식 셋은 전 테넌트 공개였다.
 *
 * **이것이 세 번째다** — 0023(상황 계열 여섯), 0031(근거 둘), 그리고 여기.
 * 매번 "그 항목이 첫 쓰기 경로를 여는 순간" 발견됐다. 아직 쓰이지 않은
 * 테이블에 같은 상태가 더 남아 있다고 보는 편이 안전하다.
 */

interface SopFixture {
  tenantId: string;
  situationId: string;
  userId: string;
  sopId: string;
  versionId: string;
  nodeA: string;
  nodeB: string;
  edgeId: string;
}

async function asApp<T>(
  url: string,
  tenantId: string | null,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  return withClient(url, async (c) => {
    await c.query(`SET ROLE une_app`);
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

async function insertSopFixture(c: Client, code: string): Promise<SopFixture> {
  const base = await insertFixture(c, code);

  const sopId = (
    await c.query(
      `INSERT INTO sop (tenant_id, situation_id, title, hazard_type, status, created_by)
       VALUES ($1, $2, $3, 'FLOOD', 'DRAFT', $4) RETURNING sop_id`,
      [base.tenantId, base.situationId, `SOP ${code}`, base.userId],
    )
  ).rows[0].sop_id as string;

  const versionId = (
    await c.query(
      `INSERT INTO sop_version
         (sop_id, version_no, status, graph_hash, schema_version, created_by)
       VALUES ($1, 1, 'DRAFT', $2, 'uni-sop-1', $3) RETURNING sop_version_id`,
      [sopId, 'a'.repeat(64), base.userId],
    )
  ).rows[0].sop_version_id as string;

  const mkNode = async (key: string, type: string): Promise<string> =>
    (
      await c.query(
        `INSERT INTO sop_node (sop_version_id, node_key, node_type, title, config_json)
         VALUES ($1, $2, $3, $2, '{}'::jsonb) RETURNING node_id`,
        [versionId, key, type],
      )
    ).rows[0].node_id as string;
  const nodeA = await mkNode('s', 'START');
  const nodeB = await mkNode('e', 'END');

  const edgeId = (
    await c.query(
      `INSERT INTO sop_edge (sop_version_id, from_node_id, to_node_id, priority)
       VALUES ($1, $2, $3, 0) RETURNING edge_id`,
      [versionId, nodeA, nodeB],
    )
  ).rows[0].edge_id as string;

  return {
    tenantId: base.tenantId,
    situationId: base.situationId,
    userId: base.userId,
    sopId,
    versionId,
    nodeA,
    nodeB,
    edgeId,
  };
}

describe.skipIf(!ADMIN_URL)('0032: SOP 그래프 격리 (CC-240)', () => {
  let dbName: string;
  let url: string;
  let a: SopFixture;
  let b: SopFixture;

  beforeAll(async () => {
    const db = await createTestDb('cc240_rls');
    dbName = db.name;
    url = db.url;
    await migrate(url);
    await withClient(url, async (c) => {
      a = await insertSopFixture(c, 'sop-a');
      b = await insertSopFixture(c, 'sop-b');
    });
  }, 180_000);

  afterAll(async () => {
    if (dbName) await dropTestDb(dbName);
  });

  it('자식 세 테이블 모두 RLS가 켜져 있고 FORCE다', async () => {
    const rows = await withClient(url, (c) =>
      c.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
          WHERE relname IN ('sop_version','sop_node','sop_edge') ORDER BY relname`,
      ),
    );
    expect(rows.rowCount).toBe(3);
    for (const r of rows.rows) {
      expect(`${r.relname}:${r.relrowsecurity}:${r.relforcerowsecurity}`).toBe(
        `${r.relname}:true:true`,
      );
    }
  });

  it('남의 기관 SOP 그래프는 보이지 않는다', async () => {
    const seen = await asApp(url, a.tenantId, async (c) => ({
      versions: (
        await c.query(`SELECT count(*)::int n FROM sop_version WHERE sop_version_id = $1`, [
          b.versionId,
        ])
      ).rows[0].n,
      nodes: (await c.query(`SELECT count(*)::int n FROM sop_node WHERE node_id = $1`, [b.nodeA]))
        .rows[0].n,
      edges: (await c.query(`SELECT count(*)::int n FROM sop_edge WHERE edge_id = $1`, [b.edgeId]))
        .rows[0].n,
    }));
    expect(seen).toEqual({ versions: 0, nodes: 0, edges: 0 });
  });

  it('자기 기관 것은 보인다 (정책이 과하게 막지 않는다)', async () => {
    const seen = await asApp(
      url,
      a.tenantId,
      async (c) =>
        (
          await c.query(`SELECT count(*)::int n FROM sop_node WHERE sop_version_id = $1`, [
            a.versionId,
          ])
        ).rows[0].n,
    );
    expect(seen).toBe(2);
  });

  it('남의 SOP에 버전을 붙일 수 없다 (WITH CHECK)', async () => {
    await expect(
      asApp(url, a.tenantId, (c) =>
        c.query(
          `INSERT INTO sop_version (sop_id, version_no, status, graph_hash, schema_version)
           VALUES ($1, 9, 'DRAFT', $2, 'uni-sop-1')`,
          [b.sopId, 'b'.repeat(64)],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('남의 버전에 노드를 붙일 수 없다', async () => {
    // 0035가 LOCKED 불변 트리거를 붙이면서 **거절 주체가 바뀌었다.** BEFORE
    // INSERT 트리거가 RLS 정책보다 먼저 돌고, 트리거 안의 `sop_version` 조회도
    // 같은 정책을 받으므로 남의 버전은 "없는 것"으로 보인다. 결과적으로 삽입은
    // 여전히 막히고, 오히려 남의 테넌트에 그 버전이 있는지조차 흘리지 않는다.
    await expect(
      asApp(url, a.tenantId, (c) =>
        c.query(
          `INSERT INTO sop_node (sop_version_id, node_key, node_type, title, config_json)
           VALUES ($1, 'x', 'ACTION', 'x', '{}'::jsonb)`,
          [b.versionId],
        ),
      ),
    ).rejects.toThrow(/존재하지 않는 SOP 버전|row-level security/i);
  });

  describe('어휘와 상관식', () => {
    it('어휘는 CC-250이 예고대로 넓혔다 — 그래도 모르는 값은 막는다', async () => {
      // CC-240 시점에는 `('DRAFT')` 하나였고 이 테스트가 LOCKED/APPROVED를
      // 거부하는 것을 확인했다. 0035가 승인 경로와 **함께** 넓혔다 — 0022 §1의
      // "도달 가능한 상태만"은 값을 영원히 막으라는 뜻이 아니라 그 값을 만드는
      // 코드와 같이 오라는 뜻이다(0023 §4 → CC-220과 같은 형태).
      expect(
        await errCode(() =>
          withClient(url, (c) =>
            c.query(`UPDATE sop_version SET status = 'RETIRED' WHERE sop_version_id = $1`, [
              a.versionId,
            ]),
          ),
        ),
      ).toBe('23514');
      expect(
        await errCode(() =>
          withClient(url, (c) =>
            c.query(`UPDATE sop SET status = 'RETIRED' WHERE sop_id = $1`, [a.sopId]),
          ),
        ),
      ).toBe('23514');
    });

    it('모르는 노드 유형을 넣을 수 없다', async () => {
      expect(
        await errCode(() =>
          withClient(url, (c) =>
            c.query(
              `INSERT INTO sop_node (sop_version_id, node_key, node_type, title, config_json)
               VALUES ($1, 'z', 'TELEPORT', 'z', '{}'::jsonb)`,
              [a.versionId],
            ),
          ),
        ),
      ).toBe('23514');
    });

    it('자기 자신으로 가는 간선을 만들 수 없다', async () => {
      expect(
        await errCode(() =>
          withClient(url, (c) =>
            c.query(
              `INSERT INTO sop_edge (sop_version_id, from_node_id, to_node_id, priority)
               VALUES ($1, $2, $2, 0)`,
              [a.versionId, a.nodeA],
            ),
          ),
        ),
      ).toBe('23514');
    });

    it('한 버전 안에서 노드 키는 유일하다', async () => {
      expect(
        await errCode(() =>
          withClient(url, (c) =>
            c.query(
              `INSERT INTO sop_node (sop_version_id, node_key, node_type, title, config_json)
               VALUES ($1, 's', 'ACTION', 'dup', '{}'::jsonb)`,
              [a.versionId],
            ),
          ),
        ),
      ).toBe('23505');
    });

    it('승인하지 않은 버전에 승인자만 있을 수 없다', async () => {
      expect(
        await errCode(() =>
          withClient(url, (c) =>
            c.query(`UPDATE sop_version SET approved_by = $2 WHERE sop_version_id = $1`, [
              a.versionId,
              a.userId,
            ]),
          ),
        ),
      ).toBe('23514');
    });
  });

  it('워커는 SOP 그래프를 지울 수도 고칠 수도 없다', async () => {
    // 0031에서 배운 것 — 삭제 경로가 없는데 권한이 있으면 그것이 곧 구멍이다.
    const privs = await withClient(url, (c) =>
      c.query(
        `SELECT privilege_type FROM information_schema.table_privileges
          WHERE grantee = 'une_worker' AND table_name = 'sop_version'
          ORDER BY privilege_type`,
      ),
    );
    // 0032가 준 UPDATE는 **쓰는 코드가 없었다** — 그 권한으로 워커가 기존
    // 버전의 graph_hash·출처를 감사 없이 갈아치울 수 있었다. 0034가 회수했다.
    expect(privs.rows.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT']);
  });

  describe('0033: 워커 최소권한 (CC-240)', () => {
    // SOP 생성 러너를 실제로 돌리자 `permission denied for table situation`으로
    // 잡이 RUNNING에 멈췄다 — 상황 계열을 읽는 첫 워커 경로가 CC-240이다.
    // 권한을 열되 **어디까지** 열었는지를 여기서 고정한다.
    const asWorker = async <T>(
      tenantId: string | null,
      fn: (c: Client) => Promise<T>,
    ): Promise<T> =>
      withClient(url, async (c) => {
        await c.query(`SET ROLE une_worker`);
        if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
        return fn(c);
      });

    it('근거 입력을 읽을 수 있다', async () => {
      const seen = await asWorker(a.tenantId, async (c) => ({
        situations: (
          await c.query(`SELECT count(*)::int n FROM situation WHERE situation_id = $1`, [
            a.situationId,
          ])
        ).rows[0].n,
        snapshots: (await c.query(`SELECT count(*)::int n FROM situation_snapshot`)).rows[0].n,
        sets: (await c.query(`SELECT count(*)::int n FROM evidence_set`)).rows[0].n,
        items: (await c.query(`SELECT count(*)::int n FROM evidence_item`)).rows[0].n,
      }));
      expect(seen.situations).toBe(1);
      expect(seen.snapshots).toBeGreaterThanOrEqual(0);
      expect(seen.sets).toBeGreaterThanOrEqual(0);
      expect(seen.items).toBeGreaterThanOrEqual(0);
    });

    it('남의 기관 상황은 워커에게도 보이지 않는다', async () => {
      const seen = await asWorker(
        a.tenantId,
        async (c) =>
          (
            await c.query(`SELECT count(*)::int n FROM situation WHERE situation_id = $1`, [
              b.situationId,
            ])
          ).rows[0].n,
      );
      expect(seen).toBe(0);
    });

    it('상황 제목을 바꿀 수 없다 (열 권한이 status뿐이다)', async () => {
      expect(
        await errCode(() =>
          asWorker(a.tenantId, (c) =>
            c.query(`UPDATE situation SET title = '조작됨' WHERE situation_id = $1`, [
              a.situationId,
            ]),
          ),
        ),
      ).toBe('42501');
    });

    it('확정 판 포인터를 갈아치울 수 없다', async () => {
      // 이것이 열려 있으면 감사 기록 없이 "확정된 사실"이 바뀐다.
      expect(
        await errCode(() =>
          asWorker(a.tenantId, (c) =>
            c.query(`UPDATE situation SET current_snapshot_id = NULL WHERE situation_id = $1`, [
              a.situationId,
            ]),
          ),
        ),
      ).toBe('42501');
    });

    it('CONTEXT_CONFIRMED → SOP_READY 한 칸만 쓴다', async () => {
      await withClient(url, (c) =>
        c.query(`UPDATE situation SET status = 'CONTEXT_CONFIRMED' WHERE situation_id = $1`, [
          a.situationId,
        ]),
      );

      // 다른 목적지는 RESTRICTIVE 정책의 WITH CHECK에 걸린다.
      expect(
        await errCode(() =>
          asWorker(a.tenantId, (c) =>
            c.query(`UPDATE situation SET status = 'CLOSED' WHERE situation_id = $1`, [
              a.situationId,
            ]),
          ),
        ),
      ).toBe('42501');

      const moved = await asWorker(
        a.tenantId,
        async (c) =>
          (
            await c.query(
              `UPDATE situation SET status = 'SOP_READY' WHERE situation_id = $1 RETURNING status`,
              [a.situationId],
            )
          ).rows[0]?.status,
      );
      expect(moved).toBe('SOP_READY');

      // 이미 SOP_READY인 행은 USING에 걸려 0행이다 — 오류가 아니라 무영향이다.
      const again = await asWorker(
        a.tenantId,
        async (c) =>
          (
            await c.query(
              `UPDATE situation SET status = 'SOP_READY' WHERE situation_id = $1 RETURNING status`,
              [a.situationId],
            )
          ).rowCount,
      );
      expect(again).toBe(0);
    });

    it('근거를 쓸 수 없다 (읽기 전용이다)', async () => {
      expect(
        await errCode(() =>
          asWorker(a.tenantId, (c) =>
            c.query(`UPDATE evidence_set SET query_text = 'x' WHERE situation_id = $1`, [
              a.situationId,
            ]),
          ),
        ),
      ).toBe('42501');
      expect(
        await errCode(() =>
          asWorker(a.tenantId, (c) =>
            c.query(
              `INSERT INTO situation_snapshot
                 (situation_id, version_no, facts_json, content_hash, effective_at, confirmed_by)
               VALUES ($1, 99, '[{"a":1}]'::jsonb, $2, now(), $3)`,
              [a.situationId, 'c'.repeat(64), a.userId],
            ),
          ),
        ),
      ).toBe('42501');
    });

    it('SOP 현재 버전 포인터만 옮길 수 있다', async () => {
      const moved = await asWorker(
        a.tenantId,
        async (c) =>
          (
            await c.query(
              `UPDATE sop SET current_version_id = $2 WHERE sop_id = $1 RETURNING current_version_id`,
              [a.sopId, a.versionId],
            )
          ).rows[0]?.current_version_id,
      );
      expect(moved).toBe(a.versionId);

      expect(
        await errCode(() =>
          asWorker(a.tenantId, (c) =>
            c.query(`UPDATE sop SET title = '조작됨' WHERE sop_id = $1`, [a.sopId]),
          ),
        ),
      ).toBe('42501');
    });
  });
});
