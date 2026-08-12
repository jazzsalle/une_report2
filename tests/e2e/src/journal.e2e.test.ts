import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertMatchesSchema } from './contract-conformance';
import {
  ADMIN_URL,
  TEMPLATE_DIR,
  apiFor,
  idem,
  startHarness,
  withClient,
  type Harness,
} from './harness';

/**
 * 상황일지 슬라이스 E2E (CC-300, UNE-JNL-005~011).
 *
 * 증명해야 하는 것.
 *   (1) 사실칸이 **확정 판과 사실원장에서** 온다.
 *   (2) **사실칸에 닿는 경로가 없다** — 편집도 AI도.
 *   (3) AI 제안이 사실을 반박하면 **반영되지 않는다**(fail-closed).
 *   (4) 사람이 쓴 문장은 재투영이 덮지 않는다.
 *   (5) 드리프트를 드러내고 자동으로 갱신하지 않는다.
 *   (6) 검토→승인, 승인된 일지는 얼어붙는다.
 *   (7) Export는 CC-160 경로를 타고, 드리프트한 일지는 못 내보낸다.
 *   (8) 테넌트 경계.
 *
 * 일지는 **반입된 HWPX 양식 사본 위에서** 시작한다(US-SIT-030 3단계,
 * US-SIT-034 4단계). 그래서 이 파일은 실제 양식 파일을 올려 쓴다 — 원본이
 * 없으면 CC-160 보존 Export가 성립하지 않으므로, 양식 없는 일지는 애초에
 * 만들 수 없다.
 */

const TEMPLATE = resolve(TEMPLATE_DIR, '간략 보고 양식.hwpx');

interface Ready {
  situationId: string;
  snapshotId: string;
  runId: string;
  taskIds: string[];
  spareNodeIds: string[];
}

describe.skipIf(!ADMIN_URL)('상황일지 슬라이스 (CC-300)', () => {
  let h: Harness;
  let api: ReturnType<typeof apiFor>;
  let adminToken: string;
  let otherToken: string;
  /** 테넌트별 양식 파일. 반입은 한 번만 해도 되지만 파일은 테넌트마다 다르다. */
  const templateFiles = new Map<string, string>();

  const errorCode = async (res: Response): Promise<string> => {
    const parsed = (await res.json()) as { error?: { code?: string } };
    return parsed.error?.code ?? 'NO_CODE';
  };

  const seed = async (code: string): Promise<Ready> =>
    withClient(h.dbUrl, async (c) => {
      const situationId = (
        await c.query(
          `INSERT INTO situation (tenant_id, mode, title, hazard_type, status, created_by)
           VALUES ($1,'LIVE',$2,'FLOOD','RUNNING',$3) RETURNING situation_id`,
          [h.fixtures.tenantA, `상황 ${code}`, h.fixtures.adminA],
        )
      ).rows[0].situation_id as string;
      const snapshotId = (
        await c.query(
          `INSERT INTO situation_snapshot
             (situation_id, version_no, facts_json, content_hash, effective_at, confirmed_by)
           VALUES ($1,1,'[{"factType":"DAMAGE","value":"침수"},{"factType":"CONTROL","value":"통제"}]'::jsonb,
                   $2, now(), $3)
           RETURNING snapshot_id`,
          [situationId, 'e'.repeat(64), h.fixtures.adminA],
        )
      ).rows[0].snapshot_id as string;
      const sopId = (
        await c.query(
          `INSERT INTO sop (tenant_id, situation_id, title, hazard_type, status, created_by)
           VALUES ($1,$2,$3,'FLOOD','APPROVED',$4) RETURNING sop_id`,
          [h.fixtures.tenantA, situationId, `SOP ${code}`, h.fixtures.adminA],
        )
      ).rows[0].sop_id as string;
      const versionId = (
        await c.query(
          `INSERT INTO sop_version (sop_id, version_no, status, graph_hash, schema_version, created_by)
           VALUES ($1,1,'DRAFT',$2,'sop-editor-1',$3) RETURNING sop_version_id`,
          [sopId, 'f'.repeat(64), h.fixtures.adminA],
        )
      ).rows[0].sop_version_id as string;
      const nodeId = (
        await c.query(
          `INSERT INTO sop_node (sop_version_id, node_key, node_type, title, config_json, sort_order)
           VALUES ($1,'a0','ACTION','대피 방송','{}'::jsonb,1) RETURNING node_id`,
          [versionId],
        )
      ).rows[0].node_id as string;
      // 두 번째 노드는 **잠그기 전에** 만들어 둔다. 승인된 판의 그래프는 못
      // 바꾸고(0035), 임무는 (run, node)마다 하나뿐이다(uk_task_run_node) —
      // 나중에 사실을 움직이려면 빈 노드가 미리 있어야 한다.
      const spareNodeIds: string[] = [];
      for (const key of ['a1', 'a2']) {
        spareNodeIds.push(
          (
            await c.query(
              `INSERT INTO sop_node (sop_version_id, node_key, node_type, title, config_json, sort_order)
               VALUES ($1,$2,'ACTION','추가 조치','{}'::jsonb,2) RETURNING node_id`,
              [versionId, key],
            )
          ).rows[0].node_id as string,
        );
      }
      await c.query(
        `UPDATE sop_version SET status='LOCKED', approved_by=$2, approved_at=now()
          WHERE sop_version_id=$1`,
        [versionId, h.fixtures.adminA],
      );
      const runId = (
        await c.query(
          `INSERT INTO sop_run
             (sop_version_id, situation_id, snapshot_id, mode, status, started_by, correlation_id)
           VALUES ($1,$2,$3,'LIVE','RUNNING',$4,$5) RETURNING run_id`,
          [versionId, situationId, snapshotId, h.fixtures.adminA, `corr-${code}`],
        )
      ).rows[0].run_id as string;
      const taskId = (
        await c.query(
          `INSERT INTO task
             (run_id, node_id, title, status, assignee_user_id, completion_policy_json,
              progress_pct, activated_at)
           VALUES ($1,$2,'대피 방송','SENT',$3,'{"instructions":["방송"]}'::jsonb,0,now())
           RETURNING task_id`,
          [runId, nodeId, h.fixtures.fieldA],
        )
      ).rows[0].task_id as string;
      await c.query(
        `INSERT INTO execution_event
           (tenant_id, situation_id, aggregate_type, aggregate_id, event_type,
            actor_id, payload_json, correlation_id, event_hash)
         VALUES ($1,$2,'TASK',$3,'TASK_CREATED',$4,$5::jsonb,$6,$7)`,
        [
          h.fixtures.tenantA,
          situationId,
          taskId,
          h.fixtures.adminA,
          JSON.stringify({ status: 'SENT', runId }),
          `corr-${code}`,
          '2'.repeat(64),
        ],
      );
      return { situationId, snapshotId, runId, taskIds: [taskId], spareNodeIds };
    });

  /** 바깥의 사실을 움직인다 — 미리 만들어 둔 빈 노드에 임무를 하나 건다. */
  const addTask = async (r: Ready, title: string, slot = 0): Promise<void> => {
    await withClient(h.dbUrl, async (c) => {
      await c.query(
        `INSERT INTO task (run_id, node_id, title, status, completion_policy_json, progress_pct)
         VALUES ($1,$2,$3,'CREATED','{}'::jsonb,0)`,
        [r.runId, r.spareNodeIds[slot], title],
      );
    });
  };

  /** UNE-DOC-001~002 — 양식 바이트를 올려 VERIFIED 파일 하나를 얻는다. */
  const uploadTemplate = async (token: string): Promise<string> => {
    const cached = templateFiles.get(token);
    if (cached) return cached;
    const bytes = readFileSync(TEMPLATE);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const registration = (await (
      await api.call('POST', '/api/v1/files', token, {
        body: {
          fileName: '간략 보고 양식.hwpx',
          sizeBytes: bytes.length,
          mimeType: 'application/hwp+zip',
          sha256,
          purpose: 'HWPX_IMPORT',
        },
        idempotencyKey: idem('file'),
      })
    ).json()) as {
      data: { file: { fileId: string }; upload: { url: string; headers: Record<string, string> } };
    };
    const fileId = registration.data.file.fileId;
    const ticket = new URL(registration.data.upload.url).searchParams.get('token') ?? '';
    const sent = await fetch(
      `${h.base}/api/v1/files/${fileId}/content?token=${encodeURIComponent(ticket)}`,
      { method: 'PUT', headers: registration.data.upload.headers, body: bytes },
    );
    expect(sent.status).toBe(204);
    const completed = await api.call('POST', `/api/v1/files/${fileId}/complete`, token, {
      body: { etag: '"journal"' },
      idempotencyKey: idem('complete'),
    });
    expect(completed.status).toBe(200);
    templateFiles.set(token, fileId);
    return fileId;
  };

  const project = async (r: Ready, token = adminToken): Promise<Response> =>
    api.call('POST', `/api/v1/situations/${r.situationId}/journal-projections`, token, {
      body: {
        snapshotId: r.snapshotId,
        templateFileId: await uploadTemplate(token),
        from: new Date(Date.now() - 3_600_000).toISOString(),
        to: new Date(Date.now() + 3_600_000).toISOString(),
      },
      idempotencyKey: idem('project'),
    });

  const post = async (
    journalId: string,
    action: string,
    body: Record<string, unknown>,
    token = adminToken,
  ): Promise<Response> =>
    api.call('POST', `/api/v1/journals/${journalId}/${action}`, token, {
      body,
      idempotencyKey: idem(action),
    });

  const detail = async (journalId: string, token = adminToken): Promise<Response> =>
    api.call('GET', `/api/v1/journals/${journalId}`, token);

  const journalOf = async (r: Ready): Promise<string> => {
    const res = await project(r);
    const body = (await res.json()) as { data: { journal: { journalId: string } } };
    return body.data.journal.journalId;
  };

  beforeAll(async () => {
    h = await startHarness('cc300_e2e');
    api = apiFor(h);
    adminToken = await api.login(h.fixtures.tenantA, 'admin-a');
    otherToken = await api.login(h.fixtures.tenantB, 'user-b');
  }, 180_000);

  afterAll(async () => {
    await h?.close();
  });

  it('확정 판과 사실원장에서 사실칸을 접는다', async () => {
    const r = await seed('project');
    const res = await project(r);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: {
        journal: { snapshotId: string; documentId: string; status: string; drifted: boolean };
        cells: Array<{
          sectionKey: string;
          factPayload: Record<string, unknown>;
          lockedFields: string[];
        }>;
      };
    };
    assertMatchesSchema('JournalDetail', body.data);

    expect(body.data.journal.snapshotId).toBe(r.snapshotId);
    expect(body.data.journal.status).toBe('DRAFT');
    expect(body.data.journal.drifted).toBe(false);
    expect(body.data.cells.map((c) => c.sectionKey)).toEqual([
      'OVERVIEW',
      'SITUATION_FACTS',
      'RESPONSE_TIMELINE',
      'TASK_SUMMARY',
      'UNRESOLVED',
    ]);
    const facts = body.data.cells.find((c) => c.sectionKey === 'SITUATION_FACTS');
    expect(facts?.factPayload.factCount).toBe(2);
    // 사실칸의 모든 키가 잠긴다.
    expect(facts?.lockedFields).toContain('factCount');

    // 일지는 문서다 — 몸이 실재하고, **원본 양식 패키지를 갖는다**.
    // 이것이 없으면 CC-160 보존 Export가 성립하지 않는다.
    const document = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT document_type, current_revision_id, source_file_id
             FROM document WHERE document_id=$1`,
            [body.data.journal.documentId],
          )
        ).rows[0],
    );
    expect(document.document_type).toBe('JOURNAL');
    expect(document.current_revision_id).not.toBeNull();
    expect(document.source_file_id).not.toBeNull();

    // revision 1은 양식 그 자체이고, 투영은 그 위에 얹힌 revision 2다.
    const revisions = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT revision_no, origin FROM document_revision
            WHERE document_id=$1 ORDER BY revision_no`,
            [body.data.journal.documentId],
          )
        ).rows,
    );
    expect(revisions.map((r) => [r.revision_no, r.origin])).toEqual([
      [1, 'IMPORT'],
      [2, 'PROJECTION'],
    ]);
  });

  it('확정 판이 없으면 일지를 만들지 않는다', async () => {
    // 미확정 후보로 일지를 만들면 사람이 그것을 확정된 사실로 읽는다.
    const situationId = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `INSERT INTO situation (tenant_id, mode, title, hazard_type, status, created_by)
             VALUES ($1,'LIVE','판 없음','FLOOD','REGISTERED',$2) RETURNING situation_id`,
            [h.fixtures.tenantA, h.fixtures.adminA],
          )
        ).rows[0].situation_id as string,
    );
    const res = await api.call(
      'POST',
      `/api/v1/situations/${situationId}/journal-projections`,
      adminToken,
      {
        body: {
          templateFileId: await uploadTemplate(adminToken),
          from: new Date(Date.now() - 1000).toISOString(),
          to: new Date().toISOString(),
        },
        idempotencyKey: idem('nosnap'),
      },
    );
    expect(res.status).toBe(412);
    expect(await errorCode(res)).toBe('JOURNAL-412-001');
  });

  it('양식 없이는 일지를 만들지 않는다', async () => {
    // 원본 패키지가 없는 문서는 내보낼 수 없다(CC-160 보존 되쓰기). 화면에서만
    // 사는 일지를 만들어 두면 승인 뒤에야 그 사실이 드러난다.
    const r = await seed('no-template');
    const res = await api.call(
      'POST',
      `/api/v1/situations/${r.situationId}/journal-projections`,
      adminToken,
      {
        body: {
          snapshotId: r.snapshotId,
          from: new Date(Date.now() - 1000).toISOString(),
          to: new Date().toISOString(),
        },
        idempotencyKey: idem('no-template'),
      },
    );
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe('JOURNAL-422-001');
  });

  it('사실칸은 어떤 편집 경로로도 바뀌지 않는다', async () => {
    const r = await seed('locked');
    const journalId = await journalOf(r);

    // 서술은 바뀐다.
    const ok = await post(journalId, 'changesets', {
      operations: [{ sectionKey: 'OVERVIEW', narrativeText: '사람이 쓴 개요.' }],
    });
    expect(ok.status).toBe(201);

    // 사실칸은 그대로다.
    const after = (await (await detail(journalId)).json()) as {
      data: {
        cells: Array<{
          sectionKey: string;
          narrativeText: string;
          narrativeSource: string;
          factPayload: Record<string, unknown>;
        }>;
      };
    };
    const overview = after.data.cells.find((c) => c.sectionKey === 'OVERVIEW');
    expect(overview?.narrativeText).toBe('사람이 쓴 개요.');
    expect(overview?.narrativeSource).toBe('USER');
    expect(overview?.factPayload.snapshotId).toBe(r.snapshotId);

    // DB에서 직접 봐도 사실이 그대로다.
    const stored = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT fact_payload_json FROM journal_projection_item
            WHERE journal_id=$1 AND section_key='OVERVIEW'`,
            [journalId],
          )
        ).rows[0],
    );
    expect((stored.fact_payload_json as { snapshotId: string }).snapshotId).toBe(r.snapshotId);
  });

  it('AI 제안은 시뮬레이션임을 밝히고 사실과 함께 대조된다', async () => {
    // **이 시험은 fail-closed를 증명하지 않는다.** 지금 붙은 어댑터는 사실에서만
    // 문장을 만들어 반박이 구조적으로 없기 때문이다(OB-03). 거절 규칙 자체는
    // 도메인에서 시험한다(`acceptProposal`). 여기서 보는 것은 제안이 실제로
    // 왕복하고, 시뮬레이션이라는 사실이 숨겨지지 않으며, 대조가 함께 돈다는 것.
    const r = await seed('ai');
    const journalId = await journalOf(r);

    const res = await post(journalId, 'ai-draft-jobs', { sections: ['TASK_SUMMARY'] });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: Array<{
        sectionKey: string;
        simulated: boolean;
        accepted: boolean;
        contradictions: unknown[];
      }>;
    };
    for (const proposal of body.data) assertMatchesSchema('NarrativeProposal', proposal);
    expect(body.data[0].sectionKey).toBe('TASK_SUMMARY');
    // **시뮬레이션임을 숨기지 않는다.**
    expect(body.data[0].simulated).toBe(true);
    expect(body.data[0].accepted).toBe(true);
    expect(body.data[0].contradictions).toEqual([]);

    const after = (await (await detail(journalId)).json()) as {
      data: { cells: Array<{ sectionKey: string; narrativeSource: string }> };
    };
    expect(after.data.cells.find((c) => c.sectionKey === 'TASK_SUMMARY')?.narrativeSource).toBe(
      'AI',
    );
  });

  it('사람이 쓴 문장을 AI가 덮지 않는다', async () => {
    const r = await seed('ai-protect');
    const journalId = await journalOf(r);
    await post(journalId, 'changesets', {
      operations: [{ sectionKey: 'TASK_SUMMARY', narrativeText: '사람이 정리한 임무 요약.' }],
    });

    const res = await post(journalId, 'ai-draft-jobs', { sections: ['TASK_SUMMARY'] });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: Array<{ accepted: boolean }> };
    expect(body.data[0].accepted).toBe(false);

    const after = (await (await detail(journalId)).json()) as {
      data: {
        cells: Array<{ sectionKey: string; narrativeText: string; narrativeSource: string }>;
      };
    };
    const cell = after.data.cells.find((c) => c.sectionKey === 'TASK_SUMMARY');
    expect(cell?.narrativeText).toBe('사람이 정리한 임무 요약.');
    expect(cell?.narrativeSource).toBe('USER');
  });

  it('사람 편집은 막지 않되 사실 모순을 경고로 단다', async () => {
    const r = await seed('warn');
    const journalId = await journalOf(r);

    // 임무는 1건인데 5건이라고 쓴다.
    const res = await post(journalId, 'changesets', {
      operations: [{ sectionKey: 'TASK_SUMMARY', narrativeText: '임무 5건을 수행했다.' }],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: {
        cells: Array<{
          sectionKey: string;
          contradictions: Array<{ field: string; factValue: number; narrativeValue: number }>;
        }>;
      };
    };
    const cell = body.data.cells.find((c) => c.sectionKey === 'TASK_SUMMARY');
    expect(cell?.contradictions).toHaveLength(1);
    expect(cell?.contradictions[0]).toMatchObject({
      field: 'taskCount',
      factValue: 1,
      narrativeValue: 5,
    });
  });

  it('사실이 바뀌면 드러내되 자동으로 갱신하지 않는다', async () => {
    const r = await seed('drift');
    const journalId = await journalOf(r);
    await post(journalId, 'changesets', {
      operations: [{ sectionKey: 'OVERVIEW', narrativeText: '사람이 쓴 개요.' }],
    });

    // 임무를 하나 더 만든다 — 바깥의 사실이 움직였다. 노드는 승인된 판의
    // 것을 그대로 쓴다(승인된 SOP 판의 그래프는 못 바꾼다, 0035).
    await addTask(r, '추가 임무');

    const drifted = (await (await detail(journalId)).json()) as {
      data: {
        journal: { drifted: boolean; projectionHash: string; currentProjectionHash: string };
      };
    };
    expect(drifted.data.journal.drifted).toBe(true);
    expect(drifted.data.journal.currentProjectionHash).not.toBe(
      drifted.data.journal.projectionHash,
    );

    // 사람이 눌러야 반영된다. 그리고 **사람이 쓴 문장은 살아남는다.**
    const refreshed = await post(journalId, 'fact-refresh', {});
    expect(refreshed.status).toBe(201);
    const after = (await refreshed.json()) as {
      data: {
        journal: { drifted: boolean };
        cells: Array<{
          sectionKey: string;
          narrativeText: string;
          narrativeSource: string;
          factPayload: Record<string, unknown>;
        }>;
      };
    };
    expect(after.data.journal.drifted).toBe(false);
    const overview = after.data.cells.find((c) => c.sectionKey === 'OVERVIEW');
    expect(overview?.narrativeText).toBe('사람이 쓴 개요.');
    expect(overview?.narrativeSource).toBe('USER');
    // 사실은 갱신됐다.
    expect(
      after.data.cells.find((c) => c.sectionKey === 'TASK_SUMMARY')?.factPayload.taskCount,
    ).toBe(2);
  });

  it('검토 → 승인이 한 줄로 흐르고 승인 기록에 사실 해시가 남는다', async () => {
    const r = await seed('approve');
    const journalId = await journalOf(r);

    const review = await post(journalId, 'submit-review', { reviewers: [h.fixtures.adminA] });
    expect(review.status).toBe(201);
    const inReview = (await review.json()) as {
      data: { journal: { status: string }; openReview: { reviewerIds: string[] } | null };
    };
    expect(inReview.data.journal.status).toBe('REVIEW');
    expect(inReview.data.openReview?.reviewerIds).toEqual([h.fixtures.adminA]);

    // 검토 중에는 고치지 않는다 — 검토자가 본 것과 승인된 것이 갈라진다.
    const blocked = await post(journalId, 'changesets', {
      operations: [{ sectionKey: 'OVERVIEW', narrativeText: 'x' }],
    });
    expect(blocked.status).toBe(409);
    expect(await errorCode(blocked)).toBe('JOURNAL-409-001');

    const approved = await post(journalId, 'approve', { comment: '확인' });
    expect(approved.status).toBe(201);
    const body = (await approved.json()) as {
      data: {
        journal: { status: string; projectionHash: string };
        approvals: Array<{ decision: string; projectionHash: string }>;
      };
    };
    expect(body.data.journal.status).toBe('APPROVED');
    expect(body.data.approvals).toHaveLength(1);
    expect(body.data.approvals[0].projectionHash).toBe(body.data.journal.projectionHash);
  });

  it('반려는 사유가 필요하고 다시 고칠 수 있다', async () => {
    const r = await seed('reject');
    const journalId = await journalOf(r);
    await post(journalId, 'submit-review', { reviewers: [h.fixtures.adminA] });

    const noReason = await post(journalId, 'approve', { decision: 'CHANGES_REQUESTED' });
    expect(noReason.status).toBe(400);

    const rejected = await post(journalId, 'approve', {
      decision: 'CHANGES_REQUESTED',
      comment: '경과가 부족합니다.',
    });
    expect(rejected.status).toBe(201);
    const body = (await rejected.json()) as { data: { journal: { status: string } } };
    expect(body.data.journal.status).toBe('CHANGES_REQUESTED');

    // 반려된 일지는 다시 고칠 수 있다.
    const edit = await post(journalId, 'changesets', {
      operations: [{ sectionKey: 'RESPONSE_TIMELINE', narrativeText: '보완했다.' }],
    });
    expect(edit.status).toBe(201);
  });

  it('승인된 일지는 얼어붙는다 — DB도 막는다', async () => {
    const r = await seed('frozen');
    const journalId = await journalOf(r);
    await post(journalId, 'submit-review', { reviewers: [h.fixtures.adminA] });
    await post(journalId, 'approve', {});

    const edit = await post(journalId, 'changesets', {
      operations: [{ sectionKey: 'OVERVIEW', narrativeText: 'x' }],
    });
    expect(edit.status).toBe(409);

    await expect(
      withClient(h.dbUrl, (c) =>
        c.query(`UPDATE journal SET status='DRAFT' WHERE journal_id=$1`, [journalId]),
      ),
    ).rejects.toThrow(/승인된 상황일지는 바꿀 수 없다/);

    await expect(
      withClient(h.dbUrl, (c) =>
        c.query(`UPDATE journal_projection_item SET narrative_text='x' WHERE journal_id=$1`, [
          journalId,
        ]),
      ),
    ).rejects.toThrow(/승인된 상황일지의 사실칸은 바꿀 수 없다/);
  });

  it('승인 기록은 고칠 수 없다', async () => {
    const r = await seed('approval-append');
    const journalId = await journalOf(r);
    await post(journalId, 'submit-review', { reviewers: [h.fixtures.adminA] });
    await post(journalId, 'approve', {});
    await expect(
      withClient(h.dbUrl, (c) =>
        c.query(`UPDATE journal_approval SET comment='x' WHERE journal_id=$1`, [journalId]),
      ),
    ).rejects.toThrow(/승인 기록은 수정·삭제할 수 없다/);
  });

  it('Export는 CC-160 경로를 타고 실제 HWPX가 나온다', async () => {
    const r = await seed('export');
    const journalId = await journalOf(r);
    // 승인 전에는 초안이 밖으로 나간다 — 승인까지 마치고 내보낸다.
    await post(journalId, 'submit-review', { reviewers: [h.fixtures.adminA] });
    await post(journalId, 'approve', {});

    const res = await post(journalId, 'exports', { format: 'HWPX' });
    expect(res.status, await res.clone().text()).toBe(202);
    const body = (await res.json()) as { data: { exportId: string; format: string } };
    expect(body.data.format).toBe('HWPX');
    const exportId = body.data.exportId;

    // 별도 경로가 아니라 export_job 한 곳이다.
    const job = await withClient(
      h.dbUrl,
      async (c) =>
        (await c.query(`SELECT document_id, format FROM export_job WHERE export_id=$1`, [exportId]))
          .rows[0],
    );
    expect(job.format).toBe('HWPX');

    // **접수만으로는 증거가 아니다.** 워커를 돌려 바이트가 실제로 나오는지,
    // Track A 자동검증을 통과하는지까지 본다(CC-170이 계획서에서 하는 것과 같다).
    const ran = await h.exports.runOnce();
    if (ran.completed < 1) {
      const failure = await withClient(
        h.dbUrl,
        async (c) =>
          (
            await c.query(
              `SELECT j.status, v.status AS v_status, v.checks_json
               FROM export_job j
               LEFT JOIN validation_report v
                 ON v.target_type = 'EXPORT' AND v.target_id = j.export_id
              WHERE j.export_id = $1`,
              [exportId],
            )
          ).rows[0],
      );
      throw new Error(`Export 실패: ${JSON.stringify(failure)}`);
    }
    const done = (await (
      await api.call('GET', `/api/v1/exports/${exportId}`, adminToken)
    ).json()) as {
      data: {
        status: string;
        validation: {
          status: string;
          checks: Array<{ code: string; outcome: string }>;
          outputSha256: string;
          sourceSha256: string;
        };
      };
    };
    expect(done.data.status).toBe('COMPLETED');
    expect(['PASS', 'LIMITED']).toContain(done.data.validation.status);
    expect(done.data.validation.checks.every((c) => c.outcome !== 'FAIL')).toBe(true);
    // 투영 문단이 들어갔으므로 산출물은 양식 원본과 바이트가 다르다.
    expect(done.data.validation.outputSha256).not.toBe(done.data.validation.sourceSha256);

    const download = await fetch(`${h.base}/api/v1/exports/${exportId}/download`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(download.status).toBe(200);
    const bytes = new Uint8Array(await download.arrayBuffer());
    // HWPX는 ZIP이다 — 받은 것이 실제 패키지인지 매직 바이트로 확인한다.
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('승인 전에는 내보내지 않는다', async () => {
    // 초안이 종이가 되면 그것을 초안으로 읽어 줄 사람이 없다(US-SIT-034).
    const r = await seed('export-draft');
    const journalId = await journalOf(r);
    const res = await post(journalId, 'exports', { format: 'HWPX' });
    expect(res.status).toBe(412);
    expect(await errorCode(res)).toBe('JOURNAL-412-004');
  });

  it('낡은 채로 검토에 넣지 않는다 — 그러나 승인 뒤에는 내보낼 수 있다', async () => {
    // 드리프트를 막을 자리는 **고칠 수 있는 마지막 지점**인 검토요청이다.
    // Export에서 막으면 살아 있는 상황의 승인된 일지는 영영 나가지 못한다.
    const r = await seed('export-drift');
    const journalId = await journalOf(r);
    await addTask(r, '추가');

    const blocked = await post(journalId, 'submit-review', { reviewers: [h.fixtures.adminA] });
    expect(blocked.status).toBe(412);
    expect(await errorCode(blocked)).toBe('JOURNAL-412-002');

    // 갱신하면 들어간다.
    expect((await post(journalId, 'fact-refresh', {})).status).toBe(201);
    expect(
      (await post(journalId, 'submit-review', { reviewers: [h.fixtures.adminA] })).status,
    ).toBe(201);
    expect((await post(journalId, 'approve', {})).status).toBe(201);

    // 승인 뒤에 상황이 더 진행돼도 승인된 판은 나간다.
    await addTask(r, '승인 뒤 추가', 1);
    const after = (await (await detail(journalId)).json()) as {
      data: { journal: { drifted: boolean } };
    };
    expect(after.data.journal.drifted).toBe(true);
    const exported = await post(journalId, 'exports', { format: 'HWPX' });
    expect(exported.status, await exported.clone().text()).toBe(202);
  });

  it('없는 섹션을 고칠 수 없다', async () => {
    const r = await seed('section');
    const journalId = await journalOf(r);
    const res = await post(journalId, 'changesets', {
      operations: [{ sectionKey: 'NOPE', narrativeText: 'x' }],
    });
    expect(res.status).toBe(400);
  });

  it('권한 없는 사용자는 어느 연산도 하지 못한다', async () => {
    // `reader-a`는 일지 권한이 하나도 없다(0012 카탈로그에 VIEWER 롤 자체가
    // 없어 이 사용자는 권한 0개다 — 그래서 읽기까지 막히는 것이 옳다).
    const r = await seed('perm');
    const journalId = await journalOf(r);
    const reader = await api.login(h.fixtures.tenantA, 'reader-a');

    expect((await detail(journalId, reader)).status).toBe(403);
    for (const action of [
      'changesets',
      'ai-draft-jobs',
      'fact-refresh',
      'submit-review',
      'approve',
      'exports',
    ]) {
      const res = await post(journalId, action, {}, reader);
      expect(res.status, `${action}: ${await res.clone().text()}`).toBe(403);
    }
    const create = await api.call(
      'POST',
      `/api/v1/situations/${r.situationId}/journal-projections`,
      reader,
      {
        body: {
          snapshotId: r.snapshotId,
          templateFileId: await uploadTemplate(adminToken),
          from: new Date(Date.now() - 1000).toISOString(),
          to: new Date().toISOString(),
        },
        idempotencyKey: idem('perm-create'),
      },
    );
    expect(create.status).toBe(403);
  });

  it('상태가 허락하지 않는 연산은 상태를 이유로 거절한다', async () => {
    const r = await seed('state');
    const journalId = await journalOf(r);

    const early = await post(journalId, 'approve', {});
    expect(early.status).toBe(412);
    expect(await errorCode(early)).toBe('JOURNAL-412-003');

    await post(journalId, 'submit-review', { reviewers: [h.fixtures.adminA] });

    expect(
      (await post(journalId, 'submit-review', { reviewers: [h.fixtures.adminA] })).status,
    ).toBe(412);
    const refresh = await post(journalId, 'fact-refresh', {});
    expect(refresh.status).toBe(409);
    expect(await errorCode(refresh)).toBe('JOURNAL-409-001');
  });

  it('같은 멱등 키 재요청은 같은 일지를 돌려준다', async () => {
    const r = await seed('idem');
    const key = idem('project-once');
    const body = {
      snapshotId: r.snapshotId,
      templateFileId: await uploadTemplate(adminToken),
      from: new Date(Date.now() - 3_600_000).toISOString(),
      to: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const call = async (): Promise<string> => {
      const res = await api.call(
        'POST',
        `/api/v1/situations/${r.situationId}/journal-projections`,
        adminToken,
        { body, idempotencyKey: key },
      );
      expect(res.status).toBe(201);
      return ((await res.json()) as { data: { journal: { journalId: string } } }).data.journal
        .journalId;
    };
    const first = await call();
    expect(await call()).toBe(first);

    // 재요청이 일지도 양식 사본도 하나 더 만들지 않는다.
    const rows = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT (SELECT count(*) FROM journal WHERE situation_id = $1) AS journals,
                  (SELECT count(*) FROM document WHERE tenant_id = $2 AND document_type = 'JOURNAL'
                     AND title LIKE '%' || $3 || '%') AS docs`,
            [r.situationId, h.fixtures.tenantA, '상황 idem'],
          )
        ).rows[0],
    );
    expect(Number(rows.journals)).toBe(1);
    expect(Number(rows.docs)).toBe(1);
  });

  it('모든 연산이 감사 기록을 남긴다', async () => {
    const r = await seed('audit');
    const journalId = await journalOf(r);
    await post(journalId, 'changesets', {
      operations: [{ sectionKey: 'OVERVIEW', narrativeText: '감사용 문장.' }],
    });
    await post(journalId, 'submit-review', { reviewers: [h.fixtures.adminA] });
    await post(journalId, 'approve', {});

    const actions = await withClient(h.dbUrl, async (c) =>
      (
        await c.query(
          `SELECT action FROM audit_log
            WHERE resource_type = 'JOURNAL' AND resource_id = $1
            ORDER BY occurred_at, audit_id`,
          [journalId],
        )
      ).rows.map((row) => row.action as string),
    );
    expect(actions).toEqual([
      'JOURNAL_PROJECTED',
      'JOURNAL_EDITED',
      'JOURNAL_REVIEW_REQUESTED',
      'JOURNAL_APPROVED',
    ]);
  });

  it('편집은 보고 있던 판 위에서만 저장된다', async () => {
    const r = await seed('optimistic');
    const journalId = await journalOf(r);
    const before = (await (await detail(journalId)).json()) as {
      data: { journal: { currentRevisionId: string } };
    };

    await post(journalId, 'changesets', {
      operations: [{ sectionKey: 'OVERVIEW', narrativeText: '먼저 저장한 문장.' }],
    });

    // 낡은 판을 들고 저장하면 거절한다 — 나중 것이 조용히 이기지 않는다.
    const stale = await post(journalId, 'changesets', {
      baseRevisionId: before.data.journal.currentRevisionId,
      operations: [{ sectionKey: 'OVERVIEW', narrativeText: '뒤늦은 문장.' }],
    });
    expect(stale.status).toBe(409);
    expect(await errorCode(stale)).toBe('JOURNAL-409-002');
  });

  it('편집이 문서 판에 반영된다 — 종이에 옛 문장이 가지 않는다', async () => {
    const r = await seed('revision');
    const journalId = await journalOf(r);
    await post(journalId, 'changesets', {
      operations: [{ sectionKey: 'OVERVIEW', narrativeText: '종이에 나가야 하는 문장.' }],
    });

    const ir = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT r.ir_json FROM document d
             JOIN document_revision r ON r.revision_id = d.current_revision_id
             JOIN journal j ON j.document_id = d.document_id
            WHERE j.journal_id = $1`,
            [journalId],
          )
        ).rows[0].ir_json,
    );
    const texts = (ir as { sections: Array<{ blocks: Array<Record<string, unknown>> }> }).sections
      .flatMap((section) => section.blocks)
      .filter((b) => b.paragraphId === 'OVERVIEW::NARRATIVE')
      .flatMap((b) => (b.runs as Array<{ text: string }>).map((run) => run.text));
    expect(texts).toEqual(['종이에 나가야 하는 문장.']);
  });

  it('승인된 일지의 본문은 문서 편집 경로로도 못 고친다', async () => {
    // 일지 테이블만 얼리면 종이가 되는 몸통은 계속 편집된다.
    const r = await seed('frozen-doc');
    const journalId = await journalOf(r);
    await post(journalId, 'submit-review', { reviewers: [h.fixtures.adminA] });
    await post(journalId, 'approve', {});

    const document = await withClient(
      h.dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT d.document_id, d.status, r.revision_id, r.revision_no
             FROM document d
             JOIN document_revision r ON r.revision_id = d.current_revision_id
            WHERE d.document_id = (SELECT document_id FROM journal WHERE journal_id = $1)`,
            [journalId],
          )
        ).rows[0],
    );
    // 일지가 승인되면 **문서도** 편집 불가 상태로 옮겨진다.
    expect(document.status).toBe('APPROVED');

    // 올바른 If-Match와 baseRevisionId를 실어 상태 가드까지 도달시킨다 —
    // 428로 걸리면 얼렸는지 아닌지를 증명하지 못한다.
    const res = await api.call(
      'POST',
      `/api/v1/documents/${document.document_id}/changesets`,
      adminToken,
      {
        ifMatch: `"${document.revision_no}"`,
        body: {
          baseRevisionId: document.revision_id,
          origin: 'USER',
          clientMutationId: 'jnl-frozen-1',
          operations: [
            {
              type: 'REPLACE_RANGE',
              order: 0,
              selection: {
                kind: 'BLOCK',
                baseRevisionId: document.revision_id,
                blockIds: ['OVERVIEW::NARRATIVE'],
              },
              payload: { text: '몰래 바꾼 문장' },
            },
          ],
        },
        idempotencyKey: idem('frozen-doc'),
      },
    );
    expect([409, 422], await res.clone().text()).toContain(res.status);
  });

  it('다른 기관의 일지는 보이지 않는다', async () => {
    const r = await seed('tenant');
    const journalId = await journalOf(r);
    const res = await detail(journalId, otherToken);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('JOURNAL-404-001');

    const foreign = await project(r, otherToken);
    expect(foreign.status).toBe(404);
    expect(await errorCode(foreign)).toBe('SIT-404-001');
  });
});
