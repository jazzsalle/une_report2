import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_URL, apiFor, idem, startHarness, withClient, type Harness } from './harness';

/**
 * SOP 캔버스·검증·검토·승인 슬라이스 E2E (CC-250, UNE-SOP-003~009).
 *
 * 증명해야 하는 것.
 *   (1) 정의 생성 → 캔버스 저장 → 검증 → 검토 요청 → 승인이 한 흐름으로 이어진다.
 *   (2) 저장은 덮어쓰지 않고 **새 버전**이다.
 *   (3) 낙관적 동시성 — 그 사이 누가 저장했으면 409이고 자동 덮어쓰기가 없다.
 *   (4) 검토 중과 승인 후에는 못 고친다.
 *   (5) 검증에 실패한 버전은 승인되지 않는다.
 *   (6) **승인된 버전은 DB 수준에서 불변이다** — 그래프까지.
 *   (7) 권한·테넌트 경계.
 */

interface Created {
  sopId: string;
  versionId: string;
}

const START = { nodeKey: 'start', nodeType: 'START', title: '상황 접수' };
const ACTION = {
  nodeKey: 'act',
  nodeType: 'ACTION',
  title: '대피 방송',
  tasks: [{ instruction: '방송 송출', assigneeHint: '상황실' }],
};
const END = { nodeKey: 'fin', nodeType: 'END', title: '종료' };
const EDGES = [
  { fromNodeKey: 'start', toNodeKey: 'act', priority: 0 },
  { fromNodeKey: 'act', toNodeKey: 'fin', priority: 0 },
];

describe.skipIf(!ADMIN_URL)('SOP 캔버스 슬라이스 (CC-250)', () => {
  let h: Harness;
  let api: ReturnType<typeof apiFor>;
  let adminToken: string;
  let readerToken: string;
  let otherToken: string;

  const errorCode = async (res: Response): Promise<string> => {
    const parsed = (await res.json()) as { error?: { code?: string } };
    return parsed.error?.code ?? 'NO_CODE';
  };

  /** 정의 생성 + 첫 캔버스 저장까지. */
  const seedSop = async (
    title: string,
    nodes: unknown[] = [START, ACTION, END],
  ): Promise<Created> => {
    const created = await api.json<{ data: { sopId: string } }>(
      await api.call('POST', '/api/v1/sops', adminToken, {
        body: { title, hazardType: 'FLOOD' },
        idempotencyKey: idem('sop-create'),
      }),
      201,
    );
    // 첫 저장은 base가 없다 — SOP에 버전이 없으므로 `baseVersionId`를 무엇으로
    // 주든 404다. 그래서 씨앗 버전은 SQL로 넣는다(CC-240 워커가 하는 일이다).
    const versionId = await withClient(h.dbUrl, async (c) => {
      const v = await c.query(
        `INSERT INTO sop_version
           (sop_id, version_no, status, graph_hash, schema_version, created_by)
         VALUES ($1, 1, 'DRAFT', $2, 'uni-sop-1', $3) RETURNING sop_version_id`,
        [created.data.sopId, 'a'.repeat(64), h.fixtures.adminA],
      );
      const id = v.rows[0].sop_version_id as string;
      for (const [i, n] of (
        nodes as Array<{ nodeKey: string; nodeType: string; title: string }>
      ).entries()) {
        await c.query(
          `INSERT INTO sop_node (sop_version_id, node_key, node_type, title, config_json, sort_order)
           VALUES ($1,$2,$3,$4,'{}'::jsonb,$5)`,
          [id, n.nodeKey, n.nodeType, n.title, i + 1],
        );
      }
      await c.query(`UPDATE sop SET current_version_id = $2 WHERE sop_id = $1`, [
        created.data.sopId,
        id,
      ]);
      return id;
    });
    return { sopId: created.data.sopId, versionId };
  };

  const save = async (
    s: Created,
    body: Record<string, unknown>,
    token = adminToken,
  ): Promise<Response> =>
    api.call('POST', `/api/v1/sops/${s.sopId}/versions`, token, {
      body,
      idempotencyKey: idem('sop-save'),
    });

  const validate = async (s: Created, versionId?: string): Promise<Response> =>
    api.call('POST', `/api/v1/sops/${s.sopId}/validate`, adminToken, {
      body: versionId ? { versionId } : {},
    });

  beforeAll(async () => {
    h = await startHarness('cc250_e2e');
    api = apiFor(h);
    adminToken = await api.login(h.fixtures.tenantA, 'admin-a');
    readerToken = await api.login(h.fixtures.tenantA, 'reader-a');
    otherToken = await api.login(h.fixtures.tenantB, 'user-b');
  }, 180_000);

  afterAll(async () => {
    if (h) await h.close();
  });

  it('(1) 생성 → 저장 → 검증 → 검토 → 승인이 이어진다', async () => {
    const s = await seedSop('태풍 대응');

    const saved = await api.json<{ data: { sopVersionId: string; versionNo: number } }>(
      await save(s, { baseVersionId: s.versionId, nodes: [START, ACTION, END], edges: EDGES }),
      201,
    );
    expect(saved.data.versionNo).toBe(2);

    const report = await api.json<{ data: { status: string; errors: unknown[] } }>(
      await validate(s, saved.data.sopVersionId),
      200,
    );
    expect(report.data.status).toBe('PASS');
    expect(report.data.errors).toEqual([]);

    const review = await api.json<{ data: { reviewRequestId: string; status: string } }>(
      await api.call('POST', `/api/v1/sops/${s.sopId}/submit-review`, adminToken, {
        body: { versionId: saved.data.sopVersionId, reviewers: [h.fixtures.readerA] },
        idempotencyKey: idem('sop-review'),
      }),
      201,
    );
    expect(review.data.status).toBe('REQUESTED');

    const approved = await api.json<{ data: { status: string; approvedAt: string } }>(
      await api.call('POST', `/api/v1/sops/${s.sopId}/approve`, adminToken, {
        body: { versionId: saved.data.sopVersionId, comment: '확인함' },
        idempotencyKey: idem('sop-approve'),
      }),
      200,
    );
    expect(approved.data.status).toBe('LOCKED');
    expect(approved.data.approvedAt).not.toBeNull();

    const after = await withClient(h.dbUrl, async (c) => ({
      sop: (
        await c.query(`SELECT status, current_version_id FROM sop WHERE sop_id = $1`, [s.sopId])
      ).rows[0],
      approval: (
        await c.query(`SELECT graph_hash, review_request_id FROM sop_approval WHERE sop_id = $1`, [
          s.sopId,
        ])
      ).rows[0],
      review: (
        await c.query(`SELECT status, resolved_at FROM sop_review_request WHERE sop_id = $1`, [
          s.sopId,
        ])
      ).rows[0],
    }));
    expect(after.sop.status).toBe('APPROVED');
    expect(after.sop.current_version_id).toBe(saved.data.sopVersionId);
    // 승인 시점 해시를 감사 행에 동결한다 — 나중에 소급 보강할 방법이 없다.
    expect(after.approval.graph_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(after.approval.review_request_id).toBe(review.data.reviewRequestId);
    expect(after.review.status).toBe('APPROVED');
    expect(after.review.resolved_at).not.toBeNull();
  }, 120_000);

  it('(2) 저장은 덮어쓰지 않고 새 버전이다', async () => {
    const s = await seedSop('버전 누적');
    await api.json(
      await save(s, { baseVersionId: s.versionId, nodes: [START, END], edges: [] }),
      201,
    );

    const versions = await withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT count(*)::int n FROM sop_version WHERE sop_id = $1`, [s.sopId]))
          .rows[0].n,
    );
    expect(versions).toBe(2);

    // 이전 버전의 그래프가 그대로 남아 있다 — "무엇이 바뀌었는가"에 답할 수 있다.
    const old = await api.json<{ data: { nodes: unknown[] } }>(
      await api.call('GET', `/api/v1/sops/${s.sopId}?versionId=${s.versionId}`, adminToken),
      200,
    );
    expect(old.data.nodes).toHaveLength(3);
  }, 120_000);

  it('(3) 낡은 base로 저장하면 409이고 덮어쓰지 않는다', async () => {
    const s = await seedSop('동시 저장');
    const first = await api.json<{ data: { sopVersionId: string } }>(
      await save(s, { baseVersionId: s.versionId, nodes: [START, END], edges: [] }),
      201,
    );

    // 두 번째 사용자가 여전히 옛 base를 들고 저장한다.
    const stale = await save(s, { baseVersionId: s.versionId, nodes: [START], edges: [] });
    expect(stale.status).toBe(409);
    expect(await errorCode(stale)).toBe('SOP-409-001');

    const current = await withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT current_version_id FROM sop WHERE sop_id = $1`, [s.sopId])).rows[0]
          .current_version_id,
    );
    expect(current).toBe(first.data.sopVersionId);
  }, 120_000);

  it('(4) 검토 중과 승인 후에는 못 고친다', async () => {
    const s = await seedSop('편집 잠금');
    const v = await api.json<{ data: { sopVersionId: string } }>(
      await save(s, { baseVersionId: s.versionId, nodes: [START, ACTION, END], edges: EDGES }),
      201,
    );
    await api.json(await validate(s, v.data.sopVersionId), 200);
    await api.json(
      await api.call('POST', `/api/v1/sops/${s.sopId}/submit-review`, adminToken, {
        body: { versionId: v.data.sopVersionId, reviewers: [h.fixtures.readerA] },
        idempotencyKey: idem('sop-review'),
      }),
      201,
    );

    // 검토자가 보는 그래프가 발밑에서 바뀌면 무엇을 검토한 것인지 말할 수 없다.
    const duringReview = await save(s, {
      baseVersionId: v.data.sopVersionId,
      nodes: [START, END],
      edges: [],
    });
    expect(duringReview.status).toBe(412);
    expect(await errorCode(duringReview)).toBe('SOP-412-003');

    await api.json(
      await api.call('POST', `/api/v1/sops/${s.sopId}/approve`, adminToken, {
        body: { versionId: v.data.sopVersionId },
        idempotencyKey: idem('sop-approve'),
      }),
      200,
    );
    const afterApproval = await save(s, {
      baseVersionId: v.data.sopVersionId,
      nodes: [START, END],
      edges: [],
    });
    expect(afterApproval.status).toBe(412);
  }, 120_000);

  it('(5) 검증하지 않았거나 실패한 버전은 승인되지 않는다', async () => {
    const s = await seedSop('승인 게이트');
    // 시작만 있는 그래프 — 종료가 없어 실행할 수 없다.
    const broken = await api.json<{ data: { sopVersionId: string } }>(
      await save(s, { baseVersionId: s.versionId, nodes: [START], edges: [] }),
      201,
    );

    await api.json(
      await api.call('POST', `/api/v1/sops/${s.sopId}/submit-review`, adminToken, {
        body: { versionId: broken.data.sopVersionId, reviewers: [h.fixtures.readerA] },
        idempotencyKey: idem('sop-review'),
      }),
      201,
    );

    const notValidated = await api.call('POST', `/api/v1/sops/${s.sopId}/approve`, adminToken, {
      body: { versionId: broken.data.sopVersionId },
      idempotencyKey: idem('sop-approve'),
    });
    expect(notValidated.status).toBe(412);
    expect(await errorCode(notValidated)).toBe('SOP-412-002');

    const report = await api.json<{ data: { status: string; errors: Array<{ code: string }> } }>(
      await validate(s, broken.data.sopVersionId),
      200,
    );
    expect(report.data.status).toBe('FAIL');
    expect(report.data.errors.map((e) => e.code)).toContain('NO_END');

    const failed = await api.call('POST', `/api/v1/sops/${s.sopId}/approve`, adminToken, {
      body: { versionId: broken.data.sopVersionId },
      idempotencyKey: idem('sop-approve'),
    });
    expect(failed.status).toBe(412);

    // 실행할 수 없는 절차가 "승인됨"으로 남지 않았다.
    const status = await withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT status FROM sop WHERE sop_id = $1`, [s.sopId])).rows[0].status,
    );
    expect(status).toBe('IN_REVIEW');
  }, 120_000);

  it('(6) 승인된 버전은 DB에서도 불변이다 (그래프까지)', async () => {
    const s = await seedSop('불변');
    const v = await api.json<{ data: { sopVersionId: string } }>(
      await save(s, { baseVersionId: s.versionId, nodes: [START, ACTION, END], edges: EDGES }),
      201,
    );
    await api.json(await validate(s, v.data.sopVersionId), 200);
    await api.json(
      await api.call('POST', `/api/v1/sops/${s.sopId}/submit-review`, adminToken, {
        body: { versionId: v.data.sopVersionId, reviewers: [h.fixtures.readerA] },
        idempotencyKey: idem('sop-review'),
      }),
      201,
    );
    await api.json(
      await api.call('POST', `/api/v1/sops/${s.sopId}/approve`, adminToken, {
        body: { versionId: v.data.sopVersionId },
        idempotencyKey: idem('sop-approve'),
      }),
      200,
    );

    const codes = await withClient(h.dbUrl, async (c) => {
      const attempt = async (sql: string, params: unknown[]): Promise<string> => {
        try {
          await c.query('BEGIN');
          await c.query(sql, params);
          await c.query('ROLLBACK');
          return 'NO_ERROR';
        } catch (err) {
          await c.query('ROLLBACK');
          return (err as { code?: string }).code ?? 'UNKNOWN';
        }
      };
      return {
        version: await attempt(`UPDATE sop_version SET graph_hash = $2 WHERE sop_version_id = $1`, [
          v.data.sopVersionId,
          'f'.repeat(64),
        ]),
        node: await attempt(`UPDATE sop_node SET title = '조작' WHERE sop_version_id = $1`, [
          v.data.sopVersionId,
        ]),
        nodeDelete: await attempt(`DELETE FROM sop_node WHERE sop_version_id = $1`, [
          v.data.sopVersionId,
        ]),
        edge: await attempt(`DELETE FROM sop_edge WHERE sop_version_id = $1`, [
          v.data.sopVersionId,
        ]),
        approval: await attempt(`UPDATE sop_approval SET comment = '조작' WHERE sop_id = $1`, [
          s.sopId,
        ]),
      };
    });
    // 버전 행만 막으면 그래프 내용은 바뀌는데 해시는 그대로여서 **승인한 것과
    // 저장된 것이 달라진다.**
    expect(codes).toEqual({
      version: '42501',
      node: '42501',
      nodeDelete: '42501',
      edge: '42501',
      approval: '42501',
    });
  }, 120_000);

  it('(7) 권한과 테넌트 경계', async () => {
    const s = await seedSop('경계');

    // SOP_EDIT 없이 저장할 수 없다(VIEWER는 읽기만).
    const forbidden = await save(
      s,
      { baseVersionId: s.versionId, nodes: [START], edges: [] },
      readerToken,
    );
    expect(forbidden.status).toBe(403);

    // 다른 기관에는 존재 자체가 보이지 않는다.
    const foreign = await api.call('GET', `/api/v1/sops/${s.sopId}`, otherToken);
    expect(foreign.status).toBe(404);
    expect(await errorCode(foreign)).toBe('SOP-404-001');

    // 목록도 기관 안에서만 보인다.
    const mine = await api.json<{ data: { totalElements: number } }>(
      await api.call('GET', '/api/v1/sops?page=0&size=100', adminToken),
      200,
    );
    const theirs = await api.json<{ data: { totalElements: number } }>(
      await api.call('GET', '/api/v1/sops?page=0&size=100', otherToken),
      200,
    );
    expect(mine.data.totalElements).toBeGreaterThan(0);
    expect(theirs.data.totalElements).toBe(0);
  }, 120_000);

  it('(8) 저장할 수 없는 그래프는 400으로 막는다 (23505로 죽지 않는다)', async () => {
    const s = await seedSop('본문 검증');

    const duplicate = await save(s, {
      baseVersionId: s.versionId,
      nodes: [START, { ...START, title: '중복' }],
      edges: [],
    });
    expect(duplicate.status).toBe(400);
    expect(await errorCode(duplicate)).toBe('SOP-400-002');

    const dangling = await save(s, {
      baseVersionId: s.versionId,
      nodes: [START],
      edges: [{ fromNodeKey: 'start', toNodeKey: '없는노드', priority: 0 }],
    });
    expect(dangling.status).toBe(400);
  }, 120_000);

  it('(9) 검토 요청은 검토자가 있어야 하고 두 번 열리지 않는다', async () => {
    const s = await seedSop('검토 규칙');
    const v = await api.json<{ data: { sopVersionId: string } }>(
      await save(s, { baseVersionId: s.versionId, nodes: [START, ACTION, END], edges: EDGES }),
      201,
    );

    const noReviewer = await api.call('POST', `/api/v1/sops/${s.sopId}/submit-review`, adminToken, {
      body: { versionId: v.data.sopVersionId, reviewers: [] },
      idempotencyKey: idem('sop-review'),
    });
    expect(noReviewer.status).toBe(400);

    await api.json(
      await api.call('POST', `/api/v1/sops/${s.sopId}/submit-review`, adminToken, {
        body: { versionId: v.data.sopVersionId, reviewers: [h.fixtures.readerA] },
        idempotencyKey: idem('sop-review'),
      }),
      201,
    );
    // 두 번째는 상태 전이가 막는다(DRAFT에서만 올린다).
    const twice = await api.call('POST', `/api/v1/sops/${s.sopId}/submit-review`, adminToken, {
      body: { versionId: v.data.sopVersionId, reviewers: [h.fixtures.readerA] },
      idempotencyKey: idem('sop-review'),
    });
    expect(twice.status).toBe(412);
    expect(await errorCode(twice)).toBe('SOP-412-001');
  }, 120_000);
});
