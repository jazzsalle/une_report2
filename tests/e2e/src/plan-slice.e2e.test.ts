import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HwpxEngine, isInStaticRegion } from '@une/hwpx-engine';
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
 * CC-170 Plan 수직 슬라이스 E2E — SSO mock부터 HWPX 다운로드까지.
 *
 * 기준 시나리오는 `tests/baseline/e2e-test-scenarios.md`의 **E2E-PLAN-001**이다:
 * HWPX 업로드 → Template Profile → 기준정보 Snapshot → T3Q RPT-001/002 →
 * (편집) → HWPX Export. 편집 단계는 사람이 하는 편집기가 아니라 **materialize**
 * (생성 블록 실체화)로 대신한다 — rhwp가 없어 편집기가 없기 때문이고, 그것이
 * 지금 문서를 실제로 바꾸는 유일한 경로다(ADR-32).
 *
 * 필수 증거(설계 09): Request/Response · DB Query · Correlation ID ·
 * ValidationReport. 화면 캡처는 이 파일이 아니라 `scripts/capture-screens.mjs`가
 * 남긴다(브라우저가 필요하므로 CI 게이트가 아니다).
 */

const TEMPLATE = resolve(TEMPLATE_DIR, '간략 보고 양식.hwpx');

/** 기준정보 정본 스키마(contracts/schemas/plan-context.schema.json)를 만족하는 값.
 * Snapshot 확정은 **엄격 검증**이므로 임의 필드는 422로 거부된다. */
const validContext = {
  subject: '2026년 폭염 대비 안전관리 계획',
  backgroundInfo: { disasterType: '폭염', controlPhase: '대비' },
  contentInstruction: { essentialFactors: ['무더위쉼터 운영', '취약계층 보호 대책'] },
  purposeOfDocument: {
    goalOfBusiness: '폭염 피해 최소화',
    role: '재난안전 담당자',
    targetAudiences: ['중앙정부'],
  },
};

/**
 * 실체화한 블록을 놓을 자리를 고른다.
 *
 * 아무 데나 놓을 수 없다. 이 실문서에는 두 가지 제약이 있고 둘 다 **의도된
 * 거절**이다:
 *   1. 정적영역(결재란·머리글)의 문단 뒤에는 놓을 수 없다 — 서식이 고정된
 *      자리를 생성물이 밀어내면 양식이 깨진다(DOC-422-004 STATIC_REGION).
 *   2. 섹션의 마지막 자식이 표다. 표 뒤에 새 문단을 놓는 되쓰기는 아직 열려
 *      있지 않아 Export가 HWPX-1103으로 바이트를 폐기한다(CC-160 수용 한계).
 * 그래서 **정적영역 밖의 마지막 문단 뒤**에 놓는다. 이 제약은 ADR-32 수용
 * 한계에 등재했다 — 화면이 "여기에는 넣을 수 없다"를 말해야 할 자리다.
 */
function pickAnchorParagraph(templatePath: string): string {
  const analysis = new HwpxEngine().analyzeDocument({
    bytes: new Uint8Array(readFileSync(templatePath)),
    fileName: templatePath,
  });
  const staticAnchors = analysis.profile.staticRegions.map((region) => region.locator);
  const section = analysis.ir.sections[0];
  let chosen: string | null = null;
  for (const block of section.blocks) {
    if (block.kind !== 'PARAGRAPH') continue;
    if (block.editState.locked) continue;
    if (isInStaticRegion(block.rawXmlAnchor ?? null, staticAnchors)) continue;
    const text = block.runs.map((run) => run.text).join('');
    if (text.trim().length === 0) continue;
    chosen = block.paragraphId;
  }
  if (!chosen) throw new Error('실체화 앵커로 쓸 문단이 없다');
  return chosen;
}

/** 목차 노드를 저장 요청 형태로 되돌린다. UNE-PLAN-014는 트리를 **다시 실어야**
 * 한다 — 확정은 "이 트리를 확정한다"이지 "그 버전을 확정한다"가 아니다. */
interface TocNode {
  nodeKey: string;
  title: string;
  generationPolicy?: string | null;
  children?: TocNode[];
}

function toTocTree(nodes: TocNode[]): unknown[] {
  return nodes.map((node) => ({
    nodeKey: node.nodeKey,
    title: node.title,
    ...(node.children && node.children.length > 0 ? { children: toTocTree(node.children) } : {}),
  }));
}

interface Envelope<T> {
  success: boolean;
  data: T;
  meta: { correlationId: string; requestId: string };
}

describe.skipIf(!ADMIN_URL || !existsSync(TEMPLATE))('CC-170 계획서 수직 슬라이스', () => {
  let h: Harness;
  let api: ReturnType<typeof apiFor>;
  let tokenAdmin: string;
  let tokenReader: string;
  let tokenOther: string;

  const bytes = new Uint8Array(existsSync(TEMPLATE) ? readFileSync(TEMPLATE) : Buffer.alloc(0));
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  beforeAll(async () => {
    h = await startHarness('cc170_slice');
    api = apiFor(h);
    tokenAdmin = await api.login(h.fixtures.tenantA, 'admin-a');
    tokenReader = await api.login(h.fixtures.tenantA, 'reader-a');
    tokenOther = await api.login(h.fixtures.tenantB, 'user-b');
  }, 300_000);

  afterAll(async () => {
    await h?.close();
  });

  it('정상 경로: 로그인 → 계획서 → Snapshot → 반입 → 목차 → 본문 → materialize → Export → 다운로드', async () => {
    // 사용자의 한 시도 = 하나의 상관관계 ID. 전 구간에서 이 값이 감사에 남아야
    // 한다(설계 09 필수증거).
    const correlationId = `corr_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const trace = { correlationId };

    // ── 1. 로그인 (UNE-AUTH-002) ─────────────────────────────────────────
    const me = await api.json<Envelope<{ userId: string; tenantId: string }>>(
      await api.call('GET', '/api/v1/auth/me', tokenAdmin, trace),
      200,
    );
    expect(me.data.tenantId).toBe(h.fixtures.tenantA);

    // ── 2. 계획서 (UNE-PLAN-001) ─────────────────────────────────────────
    const plan = await api.json<Envelope<{ planId: string; status: string }>>(
      await api.call('POST', '/api/v1/plans', tokenAdmin, {
        ...trace,
        body: {
          title: '2026 폭염 대응 계획서',
          startMode: 'UPLOAD_HWPX',
          hazardType: '폭염',
          managementPhase: '대비',
        },
        idempotencyKey: idem('plan'),
      }),
      201,
    );
    const planId = plan.data.planId;

    // ── 3. 기준정보 Snapshot (UNE-PLAN-007) ──────────────────────────────
    const snapshot = await api.json<Envelope<{ contextSnapshotId: string }>>(
      await api.call('POST', `/api/v1/plans/${planId}/context-snapshots`, tokenAdmin, {
        ...trace,
        body: validContext,
        idempotencyKey: idem('snap'),
      }),
      201,
    );
    const contextSnapshotId = snapshot.data.contextSnapshotId;

    // ── 4. 업로드 3단 + 반입 (UNE-DOC-001~004) ───────────────────────────
    const registration = await api.json<
      Envelope<{
        file: { fileId: string; uploadState: string };
        upload: { url: string; method: string; headers: Record<string, string>; driver: string };
      }>
    >(
      await api.call('POST', '/api/v1/files', tokenAdmin, {
        ...trace,
        body: {
          fileName: '간략 보고 양식.hwpx',
          sizeBytes: bytes.length,
          mimeType: 'application/hwp+zip',
          sha256,
          purpose: 'HWPX_IMPORT',
        },
        idempotencyKey: idem('file'),
      }),
      201,
    );
    const fileId = registration.data.file.fileId;
    const ticketToken = new URL(registration.data.upload.url).searchParams.get('token');

    const sent = await fetch(
      `${h.base}/api/v1/files/${fileId}/content?token=${encodeURIComponent(ticketToken ?? '')}`,
      { method: 'PUT', headers: registration.data.upload.headers, body: bytes },
    );
    expect(sent.status).toBe(204);

    const verified = await api.json<Envelope<{ uploadState: string; scanStatus: string }>>(
      await api.call('POST', `/api/v1/files/${fileId}/complete`, tokenAdmin, {
        ...trace,
        body: { etag: '"slice"' },
        idempotencyKey: idem('complete'),
      }),
      200,
    );
    expect(verified.data.uploadState).toBe('VERIFIED');
    // AV 스캐너는 없다 — 검증을 통과해도 "검사되지 않음"이 사실이다(OB-15).
    expect(verified.data.scanStatus).toBe('PENDING');

    const imported = await api.json<
      Envelope<{
        documentId: string;
        revisionId: string;
        planId: string;
        analysis: { verdict: string; templateProfileId: string };
      }>
    >(
      await api.call('POST', '/api/v1/documents/import-hwpx', tokenAdmin, {
        ...trace,
        body: { fileId, planId, title: '2026 폭염 대응 계획서' },
        idempotencyKey: idem('import'),
      }),
      201,
    );
    const documentId = imported.data.documentId;
    expect(imported.data.planId).toBe(planId);

    const analysis = await api.json<Envelope<{ profile: { sourceHash: string } }>>(
      await api.call('GET', `/api/v1/documents/${documentId}/analysis`, tokenAdmin, trace),
      200,
    );
    // 반입된 것이 우리가 올린 바로 그 바이트다.
    expect(analysis.data.profile.sourceHash).toBe(sha256);

    // ── 5. 목차 생성 (UNE-PLAN-009 + 워커) ───────────────────────────────
    const tocJob = await api.json<Envelope<{ jobId: string; status: string }>>(
      await api.call('POST', `/api/v1/plans/${planId}/toc-jobs`, tokenAdmin, {
        ...trace,
        body: { contextSnapshotId },
        idempotencyKey: idem('toc'),
      }),
      202,
    );
    expect(tocJob.data.status).toBe('QUEUED');

    expect((await h.toc.runOnce()).completed).toBeGreaterThanOrEqual(1);

    const tocDone = await api.json<Envelope<{ status: string; result: { tocVersionId: string } }>>(
      await api.call('GET', `/api/v1/plan-jobs/${tocJob.data.jobId}`, tokenAdmin, trace),
      200,
    );
    expect(tocDone.data.status).toBe('COMPLETED');
    const aiTocVersionId = tocDone.data.result.tocVersionId;

    // 목차 확정 — 본문 생성은 확정된 목차 위에서만 돈다. 트리를 다시 실어야
    // 한다(UNE-PLAN-014): 확정은 "이 트리를 확정한다"이지 "그 버전을 확정한다"가
    // 아니므로, 사용자가 화면에서 고친 결과가 그대로 저장된다.
    const aiVersion = await api.json<Envelope<{ nodes: TocNode[] }>>(
      await api.call(
        'GET',
        `/api/v1/plans/${planId}/toc-versions/${aiTocVersionId}`,
        tokenAdmin,
        trace,
      ),
      200,
    );
    const confirmed = await api.json<Envelope<{ tocVersionId: string; status: string }>>(
      await api.call('POST', `/api/v1/plans/${planId}/toc-versions`, tokenAdmin, {
        ...trace,
        body: {
          baseVersionId: aiTocVersionId,
          tocTree: toTocTree(aiVersion.data.nodes),
          confirm: true,
        },
        idempotencyKey: idem('toc-confirm'),
      }),
      201,
    );
    expect(confirmed.data.status).toBe('CONFIRMED');
    const tocVersionId = confirmed.data.tocVersionId;

    // ── 6. 본문 생성 (UNE-PLAN-016 + 워커) ───────────────────────────────
    const contentJob = await api.json<Envelope<{ jobId: string }>>(
      await api.call('POST', `/api/v1/plans/${planId}/content-jobs`, tokenAdmin, {
        ...trace,
        body: { contextSnapshotId, tocVersionId },
        idempotencyKey: idem('content'),
      }),
      202,
    );
    expect((await h.content.runOnce()).completed).toBeGreaterThanOrEqual(1);
    const contentDone = await api.json<Envelope<{ status: string }>>(
      await api.call('GET', `/api/v1/plan-jobs/${contentJob.data.jobId}`, tokenAdmin, trace),
      200,
    );
    expect(contentDone.data.status).toBe('COMPLETED');

    const blocks = await withClient(h.dbUrl, (c) =>
      c.query(`SELECT count(*)::int AS n FROM generated_block WHERE plan_id = $1`, [planId]),
    );
    expect(blocks.rows[0].n).toBeGreaterThan(0);

    // ── 7. materialize — 생성 블록을 실제 문서에 넣는다 (UNE-DOC-005/006) ─
    const ir = await api.call('GET', `/api/v1/documents/${documentId}/ir`, tokenAdmin, trace);
    const etag = ir.headers.get('ETag');
    const irBody = await api.json<Envelope<{ revisionId: string }>>(ir, 200);
    const anchorRef = pickAnchorParagraph(TEMPLATE);

    const changeSet = await fetch(`${h.base}/api/v1/documents/${documentId}/changesets`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenAdmin}`,
        'content-type': 'application/json',
        'x-correlation-id': correlationId,
        'if-match': etag ?? '',
      },
      body: JSON.stringify({
        baseRevisionId: irBody.data.revisionId,
        origin: 'MATERIALIZE',
        clientMutationId: `materialize-${randomUUID()}`,
        operations: [
          {
            type: 'INSERT_BLOCKS',
            order: 0,
            anchor: { relation: 'AFTER', ref: anchorRef },
            source: { kind: 'GENERATED_BLOCKS', planId, tocVersionId },
          },
        ],
      }),
    });
    const materialized = await api.json<
      Envelope<{
        applied: boolean;
        newRevisionId: string;
        materialize: { candidateBlocks: number; insertedBlocks: number; excluded: unknown[] };
      }>
    >(changeSet, 200);
    expect(materialized.data.applied).toBe(true);
    // 후보 중 실제로 들어간 수. 보호 블록·구세대 블록은 제외 사유와 함께 남는다.
    expect(materialized.data.materialize.insertedBlocks).toBeGreaterThan(0);
    expect(materialized.data.materialize.candidateBlocks).toBeGreaterThanOrEqual(
      materialized.data.materialize.insertedBlocks,
    );
    const editedRevisionId = materialized.data.newRevisionId;

    // ── 8. Export (UNE-DOC-012 + 워커) ───────────────────────────────────
    const exportJob = await api.json<Envelope<{ exportId: string; status: string }>>(
      await api.call('POST', `/api/v1/documents/${documentId}/exports`, tokenAdmin, {
        ...trace,
        body: { format: 'HWPX', revisionId: editedRevisionId },
        idempotencyKey: idem('export'),
      }),
      202,
    );
    const exportId = exportJob.data.exportId;
    // 워커는 배치로 돈다 — 이전 테스트가 남긴 QUEUED가 함께 끝날 수 있으므로
    // "이 Job이 끝났는가"로 판단한다. 배치 수를 세면 테스트 순서에 묶인다.
    expect((await h.exports.runOnce()).completed).toBeGreaterThanOrEqual(1);

    const exportDone = await api.json<
      Envelope<{
        status: string;
        outputFileId: string;
        validation: {
          status: string;
          checks: { code: string; outcome: string }[];
          notRunLayers: { layer: string; reason: string }[];
          outputSha256: string;
          sourceSha256: string;
        };
      }>
    >(await api.call('GET', `/api/v1/exports/${exportId}`, tokenAdmin, trace), 200);
    expect(exportDone.data.status).toBe('COMPLETED');

    // ValidationReport — Track A 4계층과 **실행하지 않은 3계층의 사유**.
    //
    // LIMITED를 허용한다. FAIL이면 바이트가 폐기되지만(ADR-31 D6) WARN은
    // "나갔고, 이런 점은 알아 두라"는 뜻이다. 실제로 문단을 넣으면 뒤쪽 문단의
    // 개요 수준 서수가 밀려 RTA-STY-002가 WARN을 낸다 — 손상이 아니라 편집의
    // 정상적 결과이므로 통과 조건에서 제외하지 않고 **경고로 남는 것**이 옳다.
    const validation = exportDone.data.validation;
    expect(['PASS', 'LIMITED']).toContain(validation.status);
    expect(validation.checks.length).toBeGreaterThanOrEqual(16);
    expect(validation.checks.every((check) => check.outcome !== 'FAIL')).toBe(true);
    // 경고가 있다면 무엇인지 증거에 남긴다.
    const warned = validation.checks.filter((check) => check.outcome === 'WARN');
    if (warned.length > 0) {
      console.log('[CC-170] Track A 경고:', warned.map((check) => check.code).join(', '));
    }
    expect(validation.notRunLayers.map((l) => l.layer).sort()).toEqual([
      'EDIT',
      'HANCOM',
      'VISUAL',
    ]);
    for (const layer of validation.notRunLayers) expect(layer.reason.length).toBeGreaterThan(0);
    // 편집이 반영됐으므로 산출물은 원본과 바이트가 다르다.
    expect(validation.outputSha256).not.toBe(validation.sourceSha256);
    expect(validation.sourceSha256).toBe(sha256);

    // ── 9. 다운로드 (UNE-DOC-014) ────────────────────────────────────────
    const download = await fetch(`${h.base}/api/v1/exports/${exportId}/download`, {
      headers: { authorization: `Bearer ${tokenAdmin}`, 'x-correlation-id': correlationId },
    });
    expect(download.status).toBe(200);
    const received = new Uint8Array(await download.arrayBuffer());
    const receivedSha = createHash('sha256').update(received).digest('hex');
    // 받은 바이트가 검증받은 그 바이트다.
    expect(receivedSha).toBe(validation.outputSha256);
    expect(download.headers.get('X-Content-Sha256')).toBe(receivedSha);
    // 산출물은 여전히 ZIP(HWPX 패키지)이다.
    expect(Array.from(received.slice(0, 2))).toEqual([0x50, 0x4b]);

    // ── 10. 증거: DB에 남은 것 ───────────────────────────────────────────
    const dbState = await withClient(h.dbUrl, (c) =>
      c.query(
        `SELECT
           (SELECT document_id FROM plan WHERE plan_id = $1) AS plan_document,
           (SELECT upload_state FROM file_object WHERE file_id = $2) AS upload_state,
           (SELECT status FROM export_job WHERE export_id = $3) AS export_status,
           (SELECT count(*)::int FROM document_revision WHERE document_id = $4) AS revisions,
           (SELECT count(*)::int FROM audit_log WHERE correlation_id = $5) AS audited`,
        [planId, fileId, exportId, documentId, correlationId],
      ),
    );
    expect(dbState.rows[0].plan_document).toBe(documentId);
    expect(dbState.rows[0].upload_state).toBe('VERIFIED');
    expect(dbState.rows[0].export_status).toBe('COMPLETED');
    // 반입(#1) + materialize(#2).
    expect(dbState.rows[0].revisions).toBe(2);
    // 상관관계 ID가 전 구간의 감사 기록을 하나로 묶는다.
    expect(dbState.rows[0].audited).toBeGreaterThanOrEqual(6);

    const actions = await withClient(h.dbUrl, (c) =>
      c.query(`SELECT DISTINCT action FROM audit_log WHERE correlation_id = $1 ORDER BY action`, [
        correlationId,
      ]),
    );
    const audited = actions.rows.map((r) => r.action as string);
    for (const action of ['FILE_REGISTERED', 'FILE_UPLOAD_VERIFIED', 'DOCUMENT_IMPORTED']) {
      expect(audited, `감사 기록 누락: ${action}`).toContain(action);
    }
  }, 300_000);

  // ── 대안·오류 경로 ─────────────────────────────────────────────────────

  it('권한이 없으면 각 단계가 403이다 (읽기 전용 사용자)', async () => {
    const upload = await api.call('POST', '/api/v1/files', tokenReader, {
      body: {
        fileName: 'x.hwpx',
        sizeBytes: bytes.length,
        mimeType: 'application/hwp+zip',
        sha256,
      },
      idempotencyKey: idem('perm'),
    });
    expect(upload.status).toBe(403);

    const plan = await api.call('POST', '/api/v1/plans', tokenReader, {
      body: { title: 'x', startMode: 'BLANK', hazardType: '폭염', managementPhase: '대비' },
      idempotencyKey: idem('perm'),
    });
    expect(plan.status).toBe(403);
  }, 120_000);

  it('다른 기관은 문서도 Export도 볼 수 없다', async () => {
    const { documentId, exportId } = await completeSliceForTenantA();
    expect((await api.call('GET', `/api/v1/documents/${documentId}/ir`, tokenOther)).status).toBe(
      404,
    );
    expect((await api.call('GET', `/api/v1/exports/${exportId}`, tokenOther)).status).toBe(404);
    expect((await api.call('GET', `/api/v1/exports/${exportId}/download`, tokenOther)).status).toBe(
      404,
    );
  }, 300_000);

  it('완료되지 않은 Export는 409이고, 존재하지 않는 Export는 404다', async () => {
    const documentId = await importedDocument();
    const job = await api.json<Envelope<{ exportId: string }>>(
      await api.call('POST', `/api/v1/documents/${documentId}/exports`, tokenAdmin, {
        body: { format: 'HWPX' },
        idempotencyKey: idem('export'),
      }),
      202,
    );
    // 워커를 돌리지 않았으므로 QUEUED다.
    const early = await api.call(
      'GET',
      `/api/v1/exports/${job.data.exportId}/download`,
      tokenAdmin,
    );
    expect(early.status).toBe(409);
    expect((await api.call('GET', `/api/v1/exports/${randomUUID()}`, tokenAdmin)).status).toBe(404);
  }, 300_000);

  it('PDF/DOCX Export는 422다 (어휘에는 있으나 변환기가 없다)', async () => {
    const documentId = await importedDocument();
    for (const format of ['PDF', 'DOCX']) {
      const res = await api.call('POST', `/api/v1/documents/${documentId}/exports`, tokenAdmin, {
        body: { format },
        idempotencyKey: idem('export'),
      });
      expect(res.status, format).toBe(422);
    }
  }, 300_000);

  it('무편집 Export는 원본과 바이트가 동일하다 (AC1을 제품 경로에서 재확인)', async () => {
    const documentId = await importedDocument();
    const job = await api.json<Envelope<{ exportId: string }>>(
      await api.call('POST', `/api/v1/documents/${documentId}/exports`, tokenAdmin, {
        body: { format: 'HWPX' },
        idempotencyKey: idem('export'),
      }),
      202,
    );
    expect((await h.exports.runOnce()).completed).toBeGreaterThanOrEqual(1);
    const done = await api.json<
      Envelope<{ validation: { outputSha256: string; sourceSha256: string } }>
    >(await api.call('GET', `/api/v1/exports/${job.data.exportId}`, tokenAdmin), 200);
    expect(done.data.validation.outputSha256).toBe(done.data.validation.sourceSha256);
    expect(done.data.validation.outputSha256).toBe(sha256);

    const download = await fetch(`${h.base}/api/v1/exports/${job.data.exportId}/download`, {
      headers: { authorization: `Bearer ${tokenAdmin}` },
    });
    const received = new Uint8Array(await download.arrayBuffer());
    expect(Buffer.compare(Buffer.from(received), Buffer.from(bytes))).toBe(0);
  }, 300_000);

  it('본문 생성을 중지하면 부분 결과가 남고 재시도가 새 Job이 된다', async () => {
    const { planId, contextSnapshotId, tocVersionId } = await planWithConfirmedToc();
    const job = await api.json<Envelope<{ jobId: string }>>(
      await api.call('POST', `/api/v1/plans/${planId}/content-jobs`, tokenAdmin, {
        body: { contextSnapshotId, tocVersionId },
        idempotencyKey: idem('content'),
      }),
      202,
    );
    // 중지는 접수(202)다 — 실행 중인 워커가 있으면 즉시 끝나지 않기 때문이다.
    const cancelled = await api.json<Envelope<{ status: string }>>(
      await api.call('POST', `/api/v1/plan-jobs/${job.data.jobId}/cancel`, tokenAdmin, {
        body: { reason: 'e2e 중지' },
        idempotencyKey: idem('cancel'),
      }),
      202,
    );
    expect(['CANCEL_REQUESTED', 'CANCELLED']).toContain(cancelled.data.status);

    // 워커가 중지 요청을 회수한다.
    await h.content.runOnce();
    const after = await api.json<Envelope<{ status: string }>>(
      await api.call('GET', `/api/v1/plan-jobs/${job.data.jobId}`, tokenAdmin),
      200,
    );
    expect(after.data.status).toBe('CANCELLED');

    // 중지 후에는 새 Job을 낼 수 있다(활성 Job 불변식이 풀렸다).
    const again = await api.call('POST', `/api/v1/plans/${planId}/content-jobs`, tokenAdmin, {
      body: { contextSnapshotId, tocVersionId },
      idempotencyKey: idem('content'),
    });
    expect(again.status).toBe(202);
  }, 300_000);

  it('같은 Idempotency-Key 재전송은 같은 Export를 돌려준다', async () => {
    const documentId = await importedDocument();
    const key = idem('export');
    const first = await api.json<Envelope<{ exportId: string }>>(
      await api.call('POST', `/api/v1/documents/${documentId}/exports`, tokenAdmin, {
        body: { format: 'HWPX' },
        idempotencyKey: key,
      }),
      202,
    );
    const second = await api.json<Envelope<{ exportId: string }>>(
      await api.call('POST', `/api/v1/documents/${documentId}/exports`, tokenAdmin, {
        body: { format: 'HWPX' },
        idempotencyKey: key,
      }),
      202,
    );
    expect(second.data.exportId).toBe(first.data.exportId);
  }, 300_000);

  // ── 보조: 슬라이스 일부를 반복해서 만드는 도우미 ───────────────────────

  async function verifiedFile(): Promise<string> {
    const registration = await api.json<
      Envelope<{
        file: { fileId: string };
        upload: { url: string; headers: Record<string, string> };
      }>
    >(
      await api.call('POST', '/api/v1/files', tokenAdmin, {
        body: {
          fileName: '간략 보고 양식.hwpx',
          sizeBytes: bytes.length,
          mimeType: 'application/hwp+zip',
          sha256,
        },
        idempotencyKey: idem('file'),
      }),
      201,
    );
    const fileId = registration.data.file.fileId;
    const token = new URL(registration.data.upload.url).searchParams.get('token') ?? '';
    await fetch(`${h.base}/api/v1/files/${fileId}/content?token=${encodeURIComponent(token)}`, {
      method: 'PUT',
      headers: registration.data.upload.headers,
      body: bytes,
    });
    await api.call('POST', `/api/v1/files/${fileId}/complete`, tokenAdmin, {
      body: {},
      idempotencyKey: idem('complete'),
    });
    return fileId;
  }

  async function importedDocument(planId?: string): Promise<string> {
    const fileId = await verifiedFile();
    const imported = await api.json<Envelope<{ documentId: string }>>(
      await api.call('POST', '/api/v1/documents/import-hwpx', tokenAdmin, {
        body: { fileId, ...(planId ? { planId } : {}) },
        idempotencyKey: idem('import'),
      }),
      201,
    );
    return imported.data.documentId;
  }

  async function newPlan(title: string): Promise<{ planId: string; contextSnapshotId: string }> {
    const plan = await api.json<Envelope<{ planId: string }>>(
      await api.call('POST', '/api/v1/plans', tokenAdmin, {
        body: { title, startMode: 'UPLOAD_HWPX', hazardType: '폭염', managementPhase: '대비' },
        idempotencyKey: idem('plan'),
      }),
      201,
    );
    const snapshot = await api.json<Envelope<{ contextSnapshotId: string }>>(
      await api.call('POST', `/api/v1/plans/${plan.data.planId}/context-snapshots`, tokenAdmin, {
        body: { ...validContext, subject: title },
        idempotencyKey: idem('snap'),
      }),
      201,
    );
    return { planId: plan.data.planId, contextSnapshotId: snapshot.data.contextSnapshotId };
  }

  async function planWithConfirmedToc(): Promise<{
    planId: string;
    contextSnapshotId: string;
    tocVersionId: string;
  }> {
    const { planId, contextSnapshotId } = await newPlan(`목차 확정 ${randomUUID().slice(0, 6)}`);
    const job = await api.json<Envelope<{ jobId: string }>>(
      await api.call('POST', `/api/v1/plans/${planId}/toc-jobs`, tokenAdmin, {
        body: { contextSnapshotId },
        idempotencyKey: idem('toc'),
      }),
      202,
    );
    await h.toc.runOnce();
    const done = await api.json<Envelope<{ result: { tocVersionId: string } }>>(
      await api.call('GET', `/api/v1/plan-jobs/${job.data.jobId}`, tokenAdmin),
      200,
    );
    const aiVersion = await api.json<Envelope<{ nodes: TocNode[] }>>(
      await api.call(
        'GET',
        `/api/v1/plans/${planId}/toc-versions/${done.data.result.tocVersionId}`,
        tokenAdmin,
      ),
      200,
    );
    const confirmed = await api.json<Envelope<{ tocVersionId: string }>>(
      await api.call('POST', `/api/v1/plans/${planId}/toc-versions`, tokenAdmin, {
        body: {
          baseVersionId: done.data.result.tocVersionId,
          tocTree: toTocTree(aiVersion.data.nodes),
          confirm: true,
        },
        idempotencyKey: idem('toc-confirm'),
      }),
      201,
    );
    return { planId, contextSnapshotId, tocVersionId: confirmed.data.tocVersionId };
  }

  async function completeSliceForTenantA(): Promise<{ documentId: string; exportId: string }> {
    const documentId = await importedDocument();
    const job = await api.json<Envelope<{ exportId: string }>>(
      await api.call('POST', `/api/v1/documents/${documentId}/exports`, tokenAdmin, {
        body: { format: 'HWPX' },
        idempotencyKey: idem('export'),
      }),
      202,
    );
    await h.exports.runOnce();
    return { documentId, exportId: job.data.exportId };
  }
});
