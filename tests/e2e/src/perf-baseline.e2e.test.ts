import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HwpxEngine } from '@une/hwpx-engine';
import { ADMIN_URL, TEMPLATE_DIR, apiFor, idem, startHarness, type Harness } from './harness';
import { buildSyntheticDocument, percentiles, type SyntheticDocument } from './synthetic-corpus';

/**
 * CC-170 성능 기준선 — ADR v1.1 G15-5.
 *
 * 목표치는 둘이다: **일반 50쪽 분석 P95 5초**, **편집 적용 P95 300ms(LLM 제외)**.
 * Export·다운로드는 설계에 목표치가 없으므로 여기서 **실측을 기준선으로 등록**한다.
 *
 * 측정 환경이 수치의 절반이다. 이 테스트는 개발 PC(WSL2 Docker의 PostgreSQL,
 * 인메모리 저장소)에서 돈다 — 운영 환경의 수치가 아니다. 증거 문서에 환경을
 * 함께 적고, 목표 미달이면 수치를 조정하지 않고 원인을 적는다.
 *
 * 쪽 수 환산은 가정이다(문단 40개 = 1쪽). 우리는 렌더하지 않으므로 실제 쪽 수는
 * 한/글이 정한다.
 */

const TEMPLATE = resolve(TEMPLATE_DIR, '간략 보고 양식.hwpx');
const TARGET_PAGES = 50;
const ANALYSIS_TARGET_MS = 5_000;
const EDIT_TARGET_MS = 300;
const RUNS = 5;

interface Envelope<T> {
  success: boolean;
  data: T;
}

interface Measured {
  label: string;
  target: string;
  p50: number;
  p95: number;
  max: number;
  verdict: 'PASS' | 'FAIL' | 'BASELINE';
}

describe.skipIf(!ADMIN_URL || !existsSync(TEMPLATE))('CC-170 성능 기준선 (G15-5)', () => {
  let h: Harness;
  let api: ReturnType<typeof apiFor>;
  let token: string;
  let synthetic: SyntheticDocument;
  const results: Measured[] = [];

  beforeAll(async () => {
    synthetic = buildSyntheticDocument(TEMPLATE, TARGET_PAGES);
    h = await startHarness('cc170_perf');
    api = apiFor(h);
    token = await api.login(h.fixtures.tenantA, 'admin-a');
  }, 600_000);

  afterAll(async () => {
    await h?.close();
    if (results.length > 0) {
      console.log(
        '\n[CC-170] 성능 기준선 (문단 %d / 약 %d쪽, %d KB)',
        synthetic.paragraphCount,
        synthetic.estimatedPages,
        Math.round(synthetic.bytes.length / 1024),
      );
      for (const r of results) {
        console.log(
          `  ${r.label}: p50=${r.p50}ms p95=${r.p95}ms max=${r.max}ms · 목표 ${r.target} → ${r.verdict}`,
        );
      }
    }
  });

  it('합성 문서가 목표 분량에 도달하고 다시 읽힌다', () => {
    expect(synthetic.estimatedPages).toBeGreaterThanOrEqual(TARGET_PAGES);
    expect(synthetic.bytes.length).toBeGreaterThan(0);
    // 늘린 문서가 우리 리더로 다시 읽혀야 측정이 의미를 갖는다.
    const reread = new HwpxEngine().analyzeDocument({ bytes: synthetic.bytes });
    expect(reread.ir.sections.length).toBeGreaterThan(0);
    console.log(
      `[CC-170] 합성 문서 생성 ${synthetic.elapsedMs}ms (원본 ${synthetic.sourceParagraphCount}문단 → ${synthetic.paragraphCount}문단)`,
    );
  }, 600_000);

  it('50쪽 분석 P95가 5초 목표와 어떻게 되는지 측정한다', () => {
    const engine = new HwpxEngine();
    const samples: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const started = performance.now();
      engine.analyzeDocument({ bytes: synthetic.bytes, fileName: 'synthetic.hwpx' });
      samples.push(Math.round(performance.now() - started));
    }
    const stats = percentiles(samples);
    const verdict = stats.p95 <= ANALYSIS_TARGET_MS ? 'PASS' : 'FAIL';
    results.push({
      label: '분석 (엔진, 50쪽)',
      target: `P95 ${ANALYSIS_TARGET_MS}ms`,
      ...stats,
      verdict,
    });
    // 목표를 못 넘겨도 테스트를 실패시키지 않는다 — 이것은 게이트가 아니라
    // **기준선**이고, 실패로 만들면 다음 사람이 목표치를 낮춰 통과시킨다.
    // 판정은 증거 문서와 리뷰가 한다.
    expect(samples).toHaveLength(RUNS);
  }, 600_000);

  it('업로드·반입 전 구간(50쪽)을 측정한다', async () => {
    const sha256 = createHash('sha256').update(synthetic.bytes).digest('hex');
    const samples: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const started = performance.now();
      const registration = await api.json<
        Envelope<{
          file: { fileId: string };
          upload: { url: string; headers: Record<string, string> };
        }>
      >(
        await api.call('POST', '/api/v1/files', token, {
          body: {
            fileName: 'synthetic-50p.hwpx',
            sizeBytes: synthetic.bytes.length,
            mimeType: 'application/hwp+zip',
            sha256,
          },
          idempotencyKey: idem('perf-file'),
        }),
        201,
      );
      const fileId = registration.data.file.fileId;
      const ticket = new URL(registration.data.upload.url).searchParams.get('token') ?? '';
      await fetch(`${h.base}/api/v1/files/${fileId}/content?token=${encodeURIComponent(ticket)}`, {
        method: 'PUT',
        headers: registration.data.upload.headers,
        body: synthetic.bytes,
      });
      await api.call('POST', `/api/v1/files/${fileId}/complete`, token, {
        body: {},
        idempotencyKey: idem('perf-complete'),
      });
      await api.json<Envelope<{ documentId: string }>>(
        await api.call('POST', '/api/v1/documents/import-hwpx', token, {
          body: { fileId },
          idempotencyKey: idem('perf-import'),
        }),
        201,
      );
      samples.push(Math.round(performance.now() - started));
    }
    const stats = percentiles(samples);
    results.push({
      label: '업로드 3단 + 반입 (API, 50쪽)',
      target: `P95 ${ANALYSIS_TARGET_MS}ms (분석 목표 준용)`,
      ...stats,
      verdict: stats.p95 <= ANALYSIS_TARGET_MS ? 'PASS' : 'FAIL',
    });
    expect(samples).toHaveLength(3);
  }, 600_000);

  it('편집 적용(ChangeSet) P95가 300ms 목표와 어떻게 되는지 측정한다', async () => {
    const documentId = await importSynthetic();
    const samples: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const ir = await api.call('GET', `/api/v1/documents/${documentId}/ir`, token);
      const etag = ir.headers.get('ETag');
      const body = await api.json<
        Envelope<{
          revisionId: string;
          ir: {
            sections: {
              blocks: { kind: string; paragraphId?: string; runs?: { text: string }[] }[];
            }[];
          };
        }>
      >(ir, 200);
      // 합성으로 넣은 본문 문단을 고른다. 원본의 첫 문단은 정적영역(결재란)일
      // 수 있고, 그러면 편집이 거절돼 측정 대상이 되지 못한다.
      const target = body.data.ir.sections[0].blocks.find(
        (block) =>
          block.kind === 'PARAGRAPH' &&
          (block.runs ?? [])
            .map((run) => run.text)
            .join('')
            .includes('합성 본문 문단입니다'),
      );
      expect(target?.paragraphId, '합성 본문 문단을 찾지 못했다').toBeTruthy();
      const paragraphId = target?.paragraphId as string;
      const length = (target?.runs ?? []).map((run) => run.text).join('').length;

      const started = performance.now();
      const res = await fetch(`${h.base}/api/v1/documents/${documentId}/changesets`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'if-match': etag ?? '',
        },
        body: JSON.stringify({
          baseRevisionId: body.data.revisionId,
          origin: 'USER',
          clientMutationId: `perf-${randomUUID()}`,
          operations: [
            {
              type: 'REPLACE_RANGE',
              order: 0,
              selection: {
                kind: 'TEXT_RANGE',
                baseRevisionId: body.data.revisionId,
                start: { paragraphId, offset: 0 },
                end: { paragraphId, offset: Math.min(4, length) },
              },
              payload: { text: `편집${i}` },
            },
          ],
        }),
      });
      const elapsed = Math.round(performance.now() - started);
      // 편집이 거절되면(정적영역 등) 측정 대상이 아니다 — 표본에서 뺀다.
      if (res.status === 200) samples.push(elapsed);
      else await res.text();
    }
    expect(samples.length, '측정 가능한 편집이 하나도 없었다').toBeGreaterThan(0);
    const stats = percentiles(samples);
    results.push({
      label: '편집 적용 (ChangeSet, 50쪽 문서)',
      target: `P95 ${EDIT_TARGET_MS}ms`,
      ...stats,
      verdict: stats.p95 <= EDIT_TARGET_MS ? 'PASS' : 'FAIL',
    });
  }, 600_000);

  it('Export(되쓰기 + Track A)와 다운로드를 기준선으로 등록한다', async () => {
    const documentId = await importSynthetic();
    const exportSamples: number[] = [];
    const downloadSamples: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const job = await api.json<Envelope<{ exportId: string }>>(
        await api.call('POST', `/api/v1/documents/${documentId}/exports`, token, {
          body: { format: 'HWPX' },
          idempotencyKey: idem('perf-export'),
        }),
        202,
      );
      const started = performance.now();
      await h.exports.runOnce();
      exportSamples.push(Math.round(performance.now() - started));

      const downloadStarted = performance.now();
      const download = await fetch(`${h.base}/api/v1/exports/${job.data.exportId}/download`, {
        headers: { authorization: `Bearer ${token}` },
      });
      await download.arrayBuffer();
      downloadSamples.push(Math.round(performance.now() - downloadStarted));
      expect(download.status).toBe(200);
    }
    results.push({
      label: 'Export 되쓰기 + Track A (워커, 50쪽)',
      target: '설계 목표 없음 — 기준선 등록',
      ...percentiles(exportSamples),
      verdict: 'BASELINE',
    });
    results.push({
      label: '다운로드 (API, 50쪽)',
      target: '설계 목표 없음 — 기준선 등록',
      ...percentiles(downloadSamples),
      verdict: 'BASELINE',
    });
  }, 600_000);

  async function importSynthetic(): Promise<string> {
    const sha256 = createHash('sha256').update(synthetic.bytes).digest('hex');
    const registration = await api.json<
      Envelope<{
        file: { fileId: string };
        upload: { url: string; headers: Record<string, string> };
      }>
    >(
      await api.call('POST', '/api/v1/files', token, {
        body: {
          fileName: 'synthetic-50p.hwpx',
          sizeBytes: synthetic.bytes.length,
          mimeType: 'application/hwp+zip',
          sha256,
        },
        idempotencyKey: idem('perf-file'),
      }),
      201,
    );
    const fileId = registration.data.file.fileId;
    const ticket = new URL(registration.data.upload.url).searchParams.get('token') ?? '';
    await fetch(`${h.base}/api/v1/files/${fileId}/content?token=${encodeURIComponent(ticket)}`, {
      method: 'PUT',
      headers: registration.data.upload.headers,
      body: synthetic.bytes,
    });
    await api.call('POST', `/api/v1/files/${fileId}/complete`, token, {
      body: {},
      idempotencyKey: idem('perf-complete'),
    });
    const imported = await api.json<Envelope<{ documentId: string }>>(
      await api.call('POST', '/api/v1/documents/import-hwpx', token, {
        body: { fileId },
        idempotencyKey: idem('perf-import'),
      }),
      201,
    );
    return imported.data.documentId;
  }
});
