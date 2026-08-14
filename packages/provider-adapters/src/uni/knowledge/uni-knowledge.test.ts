import { describe, expect, it } from 'vitest';
import { MockUniKnowledgeAdapter } from './mock-uni-knowledge-adapter';
import {
  DEFAULT_UNI_FIELD_NAMES,
  guardUniReference,
  guardUniSearch,
  guardUniStatus,
  guardUniUpload,
} from './uni-knowledge-response.guard';
import { isRetryableUniError, uniErrorFromStatus } from './uni-knowledge-port';

const CTX = { correlationId: 'corr-test' };

const upload = (fileName: string) => ({
  fileName,
  mimeType: 'application/pdf',
  content: new Uint8Array([1, 2, 3]),
  uploader: 'tester',
  force: false,
});

describe('UNI 업로드 응답 가드', () => {
  it('설계 08 §1.9의 모양을 통과시킨다', () => {
    const r = guardUniUpload({ message: 'ok', filename: 'a.pdf', doc_id: 'd-1' });
    expect(r).toEqual({
      ok: true,
      value: { documentId: 'd-1', fileName: 'a.pdf', message: 'ok' },
    });
  });

  it('문서 식별자가 없으면 거부한다 (다시 가리킬 수 없는 문서를 등록됐다고 적을 수 없다)', () => {
    const r = guardUniUpload({ message: 'ok', filename: 'a.pdf' });
    expect(r.ok).toBe(false);
  });

  it('message/filename이 없어도 통과한다 (그것으로 판단하는 것이 없다)', () => {
    const r = guardUniUpload({ doc_id: 'd-1' });
    expect(r).toEqual({ ok: true, value: { documentId: 'd-1', fileName: null, message: null } });
  });

  it('객체가 아닌 본문은 거부한다', () => {
    for (const body of ['ok', 42, null, [1, 2], undefined]) {
      expect(guardUniUpload(body).ok, JSON.stringify(body) ?? 'undefined').toBe(false);
    }
  });

  it('필드 이름을 설정으로 바꿀 수 있다 (OB-13이 닫히면 코드 변경 없이 맞춘다)', () => {
    const r = guardUniUpload(
      { documentId: 'd-9', name: 'b.pdf' },
      { ...DEFAULT_UNI_FIELD_NAMES, documentId: 'documentId', fileName: 'name' },
    );
    expect(r).toEqual({
      ok: true,
      value: { documentId: 'd-9', fileName: 'b.pdf', message: null },
    });
  });
});

describe('UNI 상태 응답 가드', () => {
  it('설계 08 §1.9 어휘를 통과시키고 대소문자만 정규화한다', () => {
    const r = guardUniStatus({ doc_id: 'd-1', status: 'indexing' }, 'd-1');
    expect(r).toEqual({ ok: true, value: { documentId: 'd-1', status: 'INDEXING' } });
  });

  it('모르는 상태는 추측하지 않고 거부한다', () => {
    const r = guardUniStatus({ doc_id: 'd-1', status: 'ALMOST_DONE' }, 'd-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('ALMOST_DONE');
  });

  it('상태가 없으면 거부한다', () => {
    expect(guardUniStatus({ doc_id: 'd-1' }, 'd-1').ok).toBe(false);
  });

  it('응답에 문서 id가 없으면 우리가 물어본 id를 쓴다', () => {
    const r = guardUniStatus({ status: 'READY' }, 'fallback-id');
    expect(r.ok && r.value.documentId).toBe('fallback-id');
  });
});

describe('UNI 참조요약 가드', () => {
  it('202는 "아직 생성 중"이고 오류가 아니다', () => {
    expect(guardUniReference(202, null, 'd-1')).toEqual({
      ok: true,
      value: { documentId: 'd-1', ready: false, reference: null },
    });
  });

  it('200이면 본문을 참조요약으로 받는다', () => {
    const r = guardUniReference(200, { summary: 's' }, 'd-1');
    expect(r).toEqual({
      ok: true,
      value: { documentId: 'd-1', ready: true, reference: { summary: 's' } },
    });
  });

  it('준비 여부의 근거는 본문이 아니라 상태코드다', () => {
    // 본문이 그럴듯해도 202면 준비된 것이 아니다.
    const r = guardUniReference(202, { summary: 's' }, 'd-1');
    expect(r.ok && r.value.ready).toBe(false);
  });

  it('200/202가 아니면 거부한다', () => {
    expect(guardUniReference(500, null, 'd-1').ok).toBe(false);
  });
});

describe('오류 매핑', () => {
  it('HTTP 상태를 포트 어휘로 옮긴다', () => {
    expect(uniErrorFromStatus(401)).toBe('UNI_AUTH_ERROR');
    expect(uniErrorFromStatus(403)).toBe('UNI_AUTH_ERROR');
    expect(uniErrorFromStatus(404)).toBe('UNI_ENDPOINT_NOT_FOUND');
    expect(uniErrorFromStatus(422)).toBe('UNI_REQUEST_REJECTED');
    expect(uniErrorFromStatus(429)).toBe('UNI_RATE_LIMITED');
    expect(uniErrorFromStatus(503)).toBe('UNI_PROVIDER_ERROR');
  });

  it('설정 결함은 재시도 대상이 아니다', () => {
    expect(isRetryableUniError('UNI_AUTH_ERROR')).toBe(false);
    expect(isRetryableUniError('UNI_REQUEST_REJECTED')).toBe(false);
    expect(isRetryableUniError('UNI_RESPONSE_CONTRACT_VIOLATION')).toBe(false);
  });

  it('일시 장애는 재시도 대상이다', () => {
    expect(isRetryableUniError('UNI_CONNECTION_ERROR')).toBe(true);
    expect(isRetryableUniError('UNI_TIMEOUT')).toBe(true);
    expect(isRetryableUniError('UNI_PROVIDER_ERROR')).toBe(true);
  });
});

describe('mock 어댑터 — 설계 08 §1.9 수명주기', () => {
  it('한 번에 READY가 되지 않는다 (폴링 결함이 드러나야 한다)', async () => {
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const up = await uni.uploadDocument(upload('plan.pdf'), CTX);
    expect(up.ok).toBe(true);
    if (!up.ok) return;

    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const s = await uni.getDocumentStatus(up.value.documentId, CTX);
      if (s.ok) seen.push(s.value.status);
    }
    expect(seen).toEqual(['QUEUED', 'PARSING', 'INDEXING', 'REFERENCE_GENERATING', 'READY']);
  });

  it('성공 결과에도 원문이 실린다 (추적은 성공한 호출에도 필요하다)', async () => {
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const up = await uni.uploadDocument(upload('plan.pdf'), CTX);
    expect(up.raw.responseBody).toMatchObject({ doc_id: expect.any(String) });
    // 파일 바이트는 남기지 않는다 — 재현에 필요한 최소 정보만.
    expect(up.raw.requestSummary).toMatchObject({ fileName: 'plan.pdf', sizeBytes: 3 });
    expect(JSON.stringify(up.raw.requestSummary)).not.toContain('content');
  });

  it('업로드 실패는 예외가 아니라 결과값이고 원문이 함께 온다', async () => {
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const up = await uni.uploadDocument(upload('bad.upload-fail.pdf'), CTX);
    expect(up.ok).toBe(false);
    if (up.ok) return;
    expect(up.error.retryable).toBe(true);
    expect(up.raw.requestSummary).toMatchObject({ fileName: 'bad.upload-fail.pdf' });
  });

  it('계약 위반 응답은 부작용 불확실로 표시된다 (문서가 저쪽에 생겼을 수 있다)', async () => {
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const up = await uni.uploadDocument(upload('x.malformed.pdf'), CTX);
    expect(up.ok).toBe(false);
    if (up.ok) return;
    expect(up.error.code).toBe('UNI_RESPONSE_CONTRACT_VIOLATION');
    expect(up.error.sideEffectUncertain).toBe(true);
    expect(up.error.retryable).toBe(false);
    // 거부하더라도 원문은 남는다.
    expect(up.raw.responseBody).toMatchObject({ filename: 'x.malformed.pdf' });
  });

  it('UNI 처리 실패 시나리오는 등록 뒤 ERROR로 끝난다', async () => {
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const up = await uni.uploadDocument(upload('x.uni-error.pdf'), CTX);
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    let last = '';
    for (let i = 0; i < 5; i += 1) {
      const s = await uni.getDocumentStatus(up.value.documentId, CTX);
      if (s.ok) last = s.value.status;
    }
    expect(last).toBe('ERROR');
  });

  it('참조요약은 색인이 끝나기 전에는 202다', async () => {
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const up = await uni.uploadDocument(upload('plan.pdf'), CTX);
    if (!up.ok) return;
    const early = await uni.getReference(up.value.documentId, CTX);
    expect(early.ok && early.value.ready).toBe(false);

    for (let i = 0; i < 5; i += 1) await uni.getDocumentStatus(up.value.documentId, CTX);
    const late = await uni.getReference(up.value.documentId, CTX);
    expect(late.ok && late.value.ready).toBe(true);
  });

  it('모르는 문서를 물으면 404다', async () => {
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const s = await uni.getDocumentStatus('nope', CTX);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error.code).toBe('UNI_ENDPOINT_NOT_FOUND');
  });

  it('자신이 mock임을 숨기지 않는다', () => {
    expect(new MockUniKnowledgeAdapter({ scenariosEnabled: true }).isMock).toBe(true);
  });
});

describe('UNI 검색 응답 가드 (CC-230)', () => {
  const chunk = {
    doc_id: 'd-1',
    chunk_id: 'c-1',
    filename: 'a.pdf',
    score: 0.87,
    text: '대피 절차',
  };

  it('감싸진 배열과 최상위 배열을 모두 받는다', () => {
    const wrapped = guardUniSearch({ results: [chunk] });
    const bare = guardUniSearch([chunk]);
    expect(wrapped.ok && wrapped.value.chunks).toHaveLength(1);
    expect(bare.ok && bare.value.chunks).toEqual(wrapped.ok ? wrapped.value.chunks : null);
  });

  it('실 UNI가 주는 네 필드를 매핑하고, 없는 chunk id는 null로 둔다 (CC-410)', () => {
    const r = guardUniSearch({ results: [chunk] });
    expect(r.ok && r.value.chunks[0]).toEqual({
      documentId: 'd-1',
      // **UNI에는 chunk id가 없다** — 실응답 항목 키는 filename/score/text/doc_id
      // 넷뿐이다(2026-08-14 실측). 기본 필드명을 빈 문자열로 두어 "찾지 않는다"를
      // 뜻하게 했다. 있지도 않은 이름을 두면 "UNI가 안 줬다"인지 "우리가 딴
      // 이름을 봤다"인지 구분되지 않는다.
      chunkId: null,
      fileName: 'a.pdf',
      score: 0.87,
      text: '대피 절차',
    });
  });

  it('UNI가 chunk id를 열면 설정만으로 집는다', () => {
    const r = guardUniSearch(
      { results: [chunk] },
      { ...DEFAULT_UNI_FIELD_NAMES, chunkId: 'chunk_id' },
    );
    expect(r.ok && r.value.chunks[0].chunkId).toBe('c-1');
  });

  it('결과 0건은 오류가 아니다 (A-01은 정상 분기다)', () => {
    const r = guardUniSearch({ results: [] });
    expect(r).toEqual({ ok: true, value: { chunks: [] } });
  });

  it('문서 식별자가 없는 청크가 하나라도 있으면 응답 전체를 거부한다', () => {
    // 부분 수용을 하지 않는다 — 근거는 동결되므로 "왜 이게 빠졌는가"에
    // 나중에 답할 수 없다.
    const r = guardUniSearch({ results: [chunk, { text: 'x' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('1번');
  });

  it('인용문이 없는 청크도 응답 전체를 거부한다', () => {
    expect(guardUniSearch({ results: [{ doc_id: 'd-1' }] }).ok).toBe(false);
  });

  it('점수는 없거나 숫자가 아니면 null이다 (척도가 미확인이라 강제하지 않는다)', () => {
    const r = guardUniSearch({ results: [{ doc_id: 'd-1', text: 't', score: 'high' }] });
    expect(r.ok && r.value.chunks[0].score).toBeNull();
  });

  it('결과 배열이 없거나 배열이 아니면 거부한다', () => {
    expect(guardUniSearch({ items: [] }).ok).toBe(false);
    expect(guardUniSearch({ results: 'none' }).ok).toBe(false);
    expect(guardUniSearch(null).ok).toBe(false);
  });

  it('필드 이름을 설정으로 바꿀 수 있다 (CR-UNI-008이 닫히면 값만 바꾼다)', () => {
    const r = guardUniSearch(
      { hits: [{ documentId: 'd-9', passage: '내용', relevance: 0.5 }] },
      {
        ...DEFAULT_UNI_FIELD_NAMES,
        searchResults: 'hits',
        documentId: 'documentId',
        text: 'passage',
        score: 'relevance',
      },
    );
    expect(r.ok && r.value.chunks[0]).toMatchObject({
      documentId: 'd-9',
      text: '내용',
      score: 0.5,
    });
  });
});

describe('mock 검색 (CC-230)', () => {
  const ready = async (uni: MockUniKnowledgeAdapter, name: string): Promise<string> => {
    const up = await uni.uploadDocument(upload(name), CTX);
    if (!up.ok) throw new Error('업로드 실패');
    for (let i = 0; i < 5; i += 1) await uni.getDocumentStatus(up.value.documentId, CTX);
    return up.value.documentId;
  };

  it('받은 문서 목록을 그대로 쓴다 (자격 판정은 호출부의 일이다)', async () => {
    // 포트가 목록을 다시 거르면 mock을 통해 업로드하지 않은 테스트에서
    // 항상 0건이 되고, 무엇보다 자격 판정이 두 곳에 생긴다.
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const r = await uni.searchEvidence(
      { query: '대피', topK: 8, documentIds: ['uni-a', 'uni-b'], filters: {} },
      CTX,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.chunks.map((c) => c.documentId)).toEqual(['uni-a', 'uni-b']);
  });

  it('topK를 넘지 않는다', async () => {
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const ids = ['u1', 'u2', 'u3'];
    const r = await uni.searchEvidence({ query: 'q', topK: 2, documentIds: ids, filters: {} }, CTX);
    expect(r.ok && r.value.chunks).toHaveLength(2);
  });

  it('결과 없음 시나리오 (A-01)', async () => {
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const r = await uni.searchEvidence(
      { query: '.no-results. 없는 것', topK: 8, documentIds: ['u1'], filters: {} },
      CTX,
    );
    expect(r.ok && r.value.chunks).toEqual([]);
  });

  it('외부 문서 혼입 시나리오 — 어댑터는 거르지 않는다 (호출부의 일이다)', async () => {
    // 포트는 UNI가 무엇을 줬는지 그대로 전한다. 걸러 내는 것은 도메인
    // `checkEvidenceItem`이며, 그래야 "무엇이 왔고 무엇을 뺐는가"가 남는다.
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const r = await uni.searchEvidence(
      { query: '.foreign. 침입', topK: 8, documentIds: ['u1'], filters: {} },
      CTX,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.chunks.map((c) => c.documentId)).toContain('foreign-doc-0001');
  });

  it('요청 원문에 질의와 문서 수가 남는다', async () => {
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const id = await ready(uni, 'a.pdf');
    const r = await uni.searchEvidence(
      { query: '대피', topK: 8, documentIds: [id], filters: {} },
      CTX,
    );
    expect(r.raw.requestSummary).toMatchObject({ query: '대피', topK: 8, documentCount: 1 });
  });
});
