import { describe, expect, it } from 'vitest';
import { HttpUniKnowledgeAdapter } from './http-uni-knowledge-adapter';
import { createUniKnowledgeProvider } from './uni-knowledge-factory';
import { DEFAULT_UNI_FIELD_NAMES } from './uni-knowledge-response.guard';

const CTX = { correlationId: 'corr-test' };

const upload = (fileName: string) => ({
  fileName,
  mimeType: 'application/pdf',
  content: new Uint8Array([1, 2, 3]),
  uploader: 'tester',
  force: false,
});

interface StubCall {
  url: string;
  init: RequestInit;
}

function stubFetch(handlers: ((call: StubCall) => Response | null)[]): {
  fetch: typeof globalThis.fetch;
  calls: StubCall[];
} {
  const calls: StubCall[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    for (const h of handlers) {
      const r = h(call);
      if (r) return r;
    }
    return new Response('unmatched', { status: 599 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch: fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const HTTP_CONFIG = {
  baseUrl: 'http://uni.example',
  username: 'svc',
  password: 'pw',
  uploadFileField: 'file',
  tokenField: 'access_token',
  uploadTimeoutMs: 60_000,
  requestTimeoutMs: 30_000,
  searchTimeoutMs: 30_000,
  fieldNames: DEFAULT_UNI_FIELD_NAMES,
};

const loginOk = (c: StubCall) =>
  c.url.endsWith('/auth/login') ? json({ access_token: 'tok-1' }) : null;

describe('실 HTTP 어댑터 — 추측하지 않는다', () => {
  it('설계 08 §1.9의 경로와 질의 파라미터를 그대로 쓴다', async () => {
    const { fetch, calls } = stubFetch([
      loginOk,
      (c) => (c.url.includes('/documents/upload') ? json({ doc_id: 'd-1' }) : null),
    ]);
    const uni = new HttpUniKnowledgeAdapter(HTTP_CONFIG, fetch);
    const r = await uni.uploadDocument({ ...upload('a.pdf'), uploader: 'kim', force: true }, CTX);

    expect(r.ok).toBe(true);
    const uploadCall = calls.find((c) => c.url.includes('/documents/upload'));
    expect(uploadCall?.url).toContain('uploader=kim');
    expect(uploadCall?.url).toContain('force=true');
  });

  it('로그인 응답의 토큰 필드명이 다르면 다른 필드를 뒤지지 않고 실패한다', async () => {
    // 추측해서 아무 문자열이나 토큰으로 쓰면 그것이 틀렸을 때 401의 원인이 숨는다.
    const { fetch } = stubFetch([
      (c) => (c.url.endsWith('/auth/login') ? json({ jwt: 'tok-1' }) : null),
    ]);
    const uni = new HttpUniKnowledgeAdapter(HTTP_CONFIG, fetch);
    const r = await uni.uploadDocument(upload('a.pdf'), CTX);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain('access_token');
    expect(r.error.message).toContain('OB-13');
  });

  it('설정된 multipart 필드 이름을 그대로 쓴다 (OB-13이 닫히면 값만 바꾼다)', async () => {
    let seenField: string | null = null;
    const { fetch } = stubFetch([
      loginOk,
      (c) => {
        if (!c.url.includes('/documents/upload')) return null;
        const form = c.init.body as FormData;
        seenField = [...form.keys()][0] ?? null;
        return json({ doc_id: 'd-1' });
      },
    ]);
    const uni = new HttpUniKnowledgeAdapter(
      { ...HTTP_CONFIG, uploadFileField: 'source_file' },
      fetch,
    );
    await uni.uploadDocument(upload('a.pdf'), CTX);
    expect(seenField).toBe('source_file');
  });

  it('401을 만나면 한 번 다시 로그인하고 재시도한다', async () => {
    let uploads = 0;
    const { fetch, calls } = stubFetch([
      loginOk,
      (c) => {
        if (!c.url.includes('/documents/upload')) return null;
        uploads += 1;
        return uploads === 1 ? json({ detail: 'expired' }, 401) : json({ doc_id: 'd-2' });
      },
    ]);
    const uni = new HttpUniKnowledgeAdapter(HTTP_CONFIG, fetch);
    const r = await uni.uploadDocument(upload('a.pdf'), CTX);
    expect(r.ok).toBe(true);
    expect(calls.filter((c) => c.url.endsWith('/auth/login'))).toHaveLength(2);
    expect(uploads).toBe(2);
  });

  it('계약 위반 응답은 매핑하지 않고 원문을 남긴다', async () => {
    const { fetch } = stubFetch([
      loginOk,
      (c) => (c.url.includes('/documents/upload') ? json({ message: 'ok' }) : null),
    ]);
    const uni = new HttpUniKnowledgeAdapter(HTTP_CONFIG, fetch);
    const r = await uni.uploadDocument(upload('a.pdf'), CTX);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNI_RESPONSE_CONTRACT_VIOLATION');
    // 업로드는 부작용이 불확실하다 — UNI에 문서가 생겼을 수 있다.
    expect(r.error.sideEffectUncertain).toBe(true);
    expect(r.raw.responseBody).toEqual({ message: 'ok' });
  });

  it('업로드 요청 원문에 파일 바이트를 남기지 않는다', async () => {
    const { fetch } = stubFetch([
      loginOk,
      (c) => (c.url.includes('/documents/upload') ? json({ doc_id: 'd-1' }) : null),
    ]);
    const uni = new HttpUniKnowledgeAdapter(HTTP_CONFIG, fetch);
    const r = await uni.uploadDocument(upload('a.pdf'), CTX);
    // 재현에 필요한 최소 정보만 — 개인정보가 든 파일 내용을 감사기록에 복사하지 않는다.
    expect(r.raw.requestSummary).toMatchObject({ fileName: 'a.pdf', sizeBytes: 3 });
    expect(JSON.stringify(r.raw.requestSummary)).not.toContain('1,2,3');
  });

  it('조회는 부작용이 불확실하지 않다 (다시 물어도 아무것도 바뀌지 않는다)', async () => {
    const { fetch } = stubFetch([
      loginOk,
      (c) => (c.url.includes('/documents/') ? json({ detail: 'boom' }, 503) : null),
    ]);
    const uni = new HttpUniKnowledgeAdapter(HTTP_CONFIG, fetch);
    const r = await uni.getDocumentStatus('d-1', CTX);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNI_PROVIDER_ERROR');
    expect(r.error.retryable).toBe(true);
    expect(r.error.sideEffectUncertain).toBe(false);
  });

  it('참조요약의 202는 실패가 아니다', async () => {
    const { fetch } = stubFetch([
      loginOk,
      (c) => (c.url.includes('/reference') ? new Response(null, { status: 202 }) : null),
    ]);
    const uni = new HttpUniKnowledgeAdapter(HTTP_CONFIG, fetch);
    const r = await uni.getReference('d-1', CTX);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.ready).toBe(false);
  });

  it('자신이 mock이 아님을 밝힌다', () => {
    expect(new HttpUniKnowledgeAdapter(HTTP_CONFIG, stubFetch([]).fetch).isMock).toBe(false);
  });
});

describe('어댑터 선택 (factory)', () => {
  it('기본은 mock이다', () => {
    expect(createUniKnowledgeProvider({}).isMock).toBe(true);
  });

  it('production에서 mock은 명시적 승인 없이 기동하지 않는다', () => {
    expect(() => createUniKnowledgeProvider({ NODE_ENV: 'production' })).toThrow(/mock/i);
    expect(
      createUniKnowledgeProvider({ NODE_ENV: 'production', UNE_ALLOW_MOCK_PROVIDER: 'true' })
        .isMock,
    ).toBe(true);
  });

  it('실 어댑터는 미확인 값이 하나라도 없으면 기동하지 않는다', () => {
    const full = {
      UNE_UNI_KNOWLEDGE_ADAPTER: 'http',
      UNE_UNI_BASE_URL: 'http://uni.example',
      UNE_UNI_USERNAME: 'svc',
      UNE_UNI_PASSWORD: 'pw',
      UNE_UNI_UPLOAD_FILE_FIELD: 'file',
      UNE_UNI_TOKEN_FIELD: 'access_token',
    };
    expect(createUniKnowledgeProvider(full).isMock).toBe(false);

    for (const key of [
      'UNE_UNI_BASE_URL',
      'UNE_UNI_USERNAME',
      'UNE_UNI_PASSWORD',
      'UNE_UNI_UPLOAD_FILE_FIELD',
      'UNE_UNI_TOKEN_FIELD',
    ] as const) {
      const partial = { ...full, [key]: '' };
      expect(() => createUniKnowledgeProvider(partial), key).toThrow(new RegExp(key));
    }
  });

  it('base URL이 http(s)가 아니면 거부한다', () => {
    expect(() =>
      createUniKnowledgeProvider({
        UNE_UNI_KNOWLEDGE_ADAPTER: 'http',
        UNE_UNI_BASE_URL: 'uni.example',
        UNE_UNI_USERNAME: 'svc',
        UNE_UNI_PASSWORD: 'pw',
        UNE_UNI_UPLOAD_FILE_FIELD: 'file',
        UNE_UNI_TOKEN_FIELD: 'access_token',
      }),
    ).toThrow(/http/i);
  });
});

describe('실 HTTP 검색 (CC-230)', () => {
  const searchBody = (calls: StubCall[]): Record<string, unknown> =>
    JSON.parse(
      String((calls.find((c) => c.url.endsWith('/search/'))?.init.body ?? '{}') as string),
    );

  it('요청 본문에 질의·topK·문서 범위를 담는다', async () => {
    const { fetch, calls } = stubFetch([
      loginOk,
      (c) => (c.url.endsWith('/search/') ? json({ results: [] }) : null),
    ]);
    const uni = new HttpUniKnowledgeAdapter(HTTP_CONFIG, fetch);
    await uni.searchEvidence(
      { query: '대피', topK: 5, documentIds: ['d-1', 'd-2'], filters: {} },
      CTX,
    );
    expect(searchBody(calls)).toMatchObject({
      query: '대피',
      top_k: 5,
      doc_ids: ['d-1', 'd-2'],
    });
  });

  it('클라이언트 filters가 문서 범위를 덮어쓸 수 없다', async () => {
    // 아키텍처 검토 BLOCKER 4-4. `...filters`가 마지막에 펼쳐져 doc_ids·top_k·
    // query를 전부 덮었다 — 사용자가 filters로 범위를 비우면 UNE가 UNI에
    // **범위 제한 없는 임의 질의**를 대신 던지고, 그 응답 원문(남의 기관 문서
    // 본문)이 요청자 테넌트의 provider_result에 영구히 적재된다.
    const { fetch, calls } = stubFetch([
      loginOk,
      (c) => (c.url.endsWith('/search/') ? json({ results: [] }) : null),
    ]);
    const uni = new HttpUniKnowledgeAdapter(HTTP_CONFIG, fetch);
    await uni.searchEvidence(
      {
        query: '정상 질의',
        topK: 8,
        documentIds: ['d-1'],
        filters: { doc_ids: [], top_k: 500, query: '타 기관 내부 문건' },
      },
      CTX,
    );
    const body = searchBody(calls);
    expect(body.doc_ids).toEqual(['d-1']);
    expect(body.top_k).toBe(8);
    expect(body.query).toBe('정상 질의');
  });

  it('계약에 없는 filters를 provider에 보내지 않는다', async () => {
    // CR-UNI-008의 SearchRequest에 `filters`가 없다. 계약에 없는 필드를
    // provider에 보내는 것은 추측이다(.claude/rules/provider-adapters.md).
    // 값은 evidence_set.filters_json에 보관만 한다.
    const { fetch, calls } = stubFetch([
      loginOk,
      (c) => (c.url.endsWith('/search/') ? json({ results: [] }) : null),
    ]);
    const uni = new HttpUniKnowledgeAdapter(HTTP_CONFIG, fetch);
    await uni.searchEvidence(
      { query: 'q', topK: 8, documentIds: ['d-1'], filters: { sourceType: 'MANUAL' } },
      CTX,
    );
    expect(Object.keys(searchBody(calls)).sort()).toEqual(['doc_ids', 'query', 'top_k']);
  });

  it('설계 08 §1.14의 검색 제한시간을 쓰고 재시도하지 않는다', async () => {
    let attempts = 0;
    const { fetch } = stubFetch([
      loginOk,
      (c) => {
        if (!c.url.endsWith('/search/')) return null;
        attempts += 1;
        return json({ detail: 'boom' }, 503);
      },
    ]);
    const uni = new HttpUniKnowledgeAdapter(HTTP_CONFIG, fetch);
    const r = await uni.searchEvidence(
      { query: 'q', topK: 8, documentIds: ['d'], filters: {} },
      CTX,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNI_PROVIDER_ERROR');
    // 재시도 여부는 사용자가 고른다(US-SIT-011 E-01).
    expect(attempts).toBe(1);
    expect(r.error.sideEffectUncertain).toBe(false);
  });

  it('계약 위반 응답은 매핑하지 않고 원문을 남긴다', async () => {
    const { fetch } = stubFetch([
      loginOk,
      (c) => (c.url.endsWith('/search/') ? json({ results: [{ text: '문서 없음' }] }) : null),
    ]);
    const uni = new HttpUniKnowledgeAdapter(HTTP_CONFIG, fetch);
    const r = await uni.searchEvidence(
      { query: 'q', topK: 8, documentIds: ['d'], filters: {} },
      CTX,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNI_RESPONSE_CONTRACT_VIOLATION');
    expect(r.raw.responseBody).toMatchObject({ results: [{ text: '문서 없음' }] });
  });
});
