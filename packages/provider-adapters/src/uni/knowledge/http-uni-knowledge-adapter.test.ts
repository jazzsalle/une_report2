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
