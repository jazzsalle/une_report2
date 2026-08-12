import { describe, expect, it } from 'vitest';
import { HttpUniSopAdapter, type HttpUniSopConfig } from './http-uni-sop-adapter';
import { createUniSopProvider } from './uni-sop-factory';

const CTX = { correlationId: 'corr-http-sop' };

const CONFIG: HttpUniSopConfig = {
  baseUrl: 'http://uni.example',
  firstEventTimeoutMs: 30_000,
  totalTimeoutMs: 300_000,
  queryField: 'query',
  documentIdsField: 'doc_ids',
};

const request = {
  prompt: '태풍 대응 절차를 만들어라',
  documentIds: ['uni-doc-1', 'uni-doc-2'],
  snapshotId: 'snap-1',
  evidenceSetId: 'ev-1',
  schemaVersion: 'uni-sop-1',
};

/** SSE 본문을 청크로 흘리는 응답. 프레이밍 파싱이 청크 경계에 걸려도 되는지 본다. */
function sseResponse(chunks: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

function stub(response: () => Response): {
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  return {
    fetchImpl: async (input, init) => {
      calls.push({ url: input, init: init ?? {} });
      return response();
    },
    calls,
  };
}

const OK_STREAM = [
  'data: {"__status__":"searching"}\n',
  'data: {"__sources__":[{"doc_id":"uni-doc-1","chunk_id":"c1"}]}\n',
  'data: {"__compn__":{"compnSn":"s","type":"START","name":"접수"}}\n',
  'data: {"__done__":{"node_count":1}}\n',
  'data: [DONE]\n',
];

describe('HttpUniSopAdapter — 요청', () => {
  it('/chat/json에 질의와 문서범위를 보낸다', async () => {
    const { fetchImpl, calls } = stub(() => sseResponse(OK_STREAM));
    const r = await new HttpUniSopAdapter(CONFIG, fetchImpl).generateSop(request, CTX);
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe('http://uni.example/chat/json');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({ query: request.prompt, doc_ids: ['uni-doc-1', 'uni-doc-2'] });
  });

  it('토큰을 붙이지 않는다 (설계 08 §1.8: 인증 없음 B2B)', async () => {
    const { fetchImpl, calls } = stub(() => sseResponse(OK_STREAM));
    await new HttpUniSopAdapter(CONFIG, fetchImpl).generateSop(request, CTX);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
  });

  it('원문 추적에 프롬프트 본문을 남기지 않는다', async () => {
    const { fetchImpl } = stub(() => sseResponse(OK_STREAM));
    const r = await new HttpUniSopAdapter(CONFIG, fetchImpl).generateSop(request, CTX);
    // 프롬프트는 확정 상황 사실을 담는다 — 추적에는 길이만 남긴다.
    const summary = JSON.stringify(r.raw.requestSummary);
    expect(summary).not.toContain('태풍');
    expect(r.raw.requestSummary).toMatchObject({ promptLength: request.prompt.length });
  });
});

describe('HttpUniSopAdapter — 스트림', () => {
  it('청크 경계가 줄 가운데를 잘라도 프레임을 복원한다', async () => {
    // 실 SSE에서 흔한 경우다. 버퍼링이 없으면 여기서 파서가 죽는다.
    const split = ['data: {"__compn__":{"compnSn":"s","typ', 'e":"START","name":"접수"}}\n'];
    const { fetchImpl } = stub(() =>
      sseResponse([
        'data: {"__status__":"searching"}\n',
        ...split,
        'data: {"__done__":{"node_count":1}}\n',
        'data: [DONE]\n',
      ]),
    );
    const r = await new HttpUniSopAdapter(CONFIG, fetchImpl).generateSop(request, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events.filter((e) => e.kind === 'compn')).toHaveLength(1);
  });

  it('받은 프레임을 순서대로 보존한다', async () => {
    const { fetchImpl } = stub(() => sseResponse(OK_STREAM));
    const r = await new HttpUniSopAdapter(CONFIG, fetchImpl).generateSop(request, CTX);
    expect(r.raw.frames[0]).toEqual({ __status__: 'searching' });
    expect(r.raw.frames).toHaveLength(5);
  });

  it('[DONE] 뒤의 줄은 읽지 않는다', async () => {
    const { fetchImpl } = stub(() =>
      sseResponse([...OK_STREAM, 'data: {"__compn__":{"compnSn":"late","type":"END"}}\n']),
    );
    const r = await new HttpUniSopAdapter(CONFIG, fetchImpl).generateSop(request, CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events.some((e) => e.kind === 'compn' && e.raw.compnSn === 'late')).toBe(false);
  });

  it('__done__ 없이 끝나면 부분 결과가 아니라 오류다', async () => {
    const { fetchImpl } = stub(() =>
      sseResponse([
        'data: {"__status__":"generating"}\n',
        'data: {"__compn__":{"compnSn":"s","type":"START"}}\n',
      ]),
    );
    const r = await new HttpUniSopAdapter(CONFIG, fetchImpl).generateSop(request, CTX);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNI_SOP_UNTERMINATED');
    expect(r.error.partialNodeCount).toBe(1);
    // 실패해도 원문은 남는다 — 무엇을 받았기에 실패했는지의 유일한 단서다.
    expect(r.raw.frames).toHaveLength(2);
  });

  it('__error__를 부분 노드 수와 함께 옮긴다', async () => {
    const { fetchImpl } = stub(() =>
      sseResponse([
        'data: {"__compn__":{"compnSn":"s","type":"START"}}\n',
        'data: {"__error__":"인덱스 오류"}\n',
        'data: [DONE]\n',
      ]),
    );
    const r = await new HttpUniSopAdapter(CONFIG, fetchImpl).generateSop(request, CTX);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNI_SOP_PROVIDER_REPORTED');
    expect(r.error.partialNodeCount).toBe(1);
  });

  it('프레이밍이 깨지면 재시도 불가 오류다', async () => {
    const { fetchImpl } = stub(() => sseResponse(['data: 이건 JSON이 아니다\n']));
    const r = await new HttpUniSopAdapter(CONFIG, fetchImpl).generateSop(request, CTX);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNI_SOP_MALFORMED_STREAM');
    // 같은 응답이 또 올 뿐이다. 재시도는 UNI 부하만 만든다.
    expect(r.error.retryable).toBe(false);
  });

  it('heartbeat 주석 줄은 무시한다', async () => {
    const { fetchImpl } = stub(() => sseResponse([': keep-alive\n', ...OK_STREAM]));
    const r = await new HttpUniSopAdapter(CONFIG, fetchImpl).generateSop(request, CTX);
    expect(r.ok).toBe(true);
  });
});

describe('HttpUniSopAdapter — 오류 분류', () => {
  it('4xx는 재시도하지 않고 5xx는 한다', async () => {
    const four = stub(() => new Response('bad', { status: 422 }));
    const r4 = await new HttpUniSopAdapter(CONFIG, four.fetchImpl).generateSop(request, CTX);
    expect(r4.ok).toBe(false);
    if (!r4.ok) {
      expect(r4.error.code).toBe('UNI_SOP_REQUEST_REJECTED');
      expect(r4.error.retryable).toBe(false);
    }

    const five = stub(() => new Response('boom', { status: 502 }));
    const r5 = await new HttpUniSopAdapter(CONFIG, five.fetchImpl).generateSop(request, CTX);
    expect(r5.ok).toBe(false);
    if (!r5.ok) {
      expect(r5.error.code).toBe('UNI_SOP_PROVIDER_ERROR');
      expect(r5.error.retryable).toBe(true);
    }
  });

  it('연결 실패는 재시도 대상이다', async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new Error('ECONNREFUSED');
    };
    const r = await new HttpUniSopAdapter(CONFIG, fetchImpl).generateSop(request, CTX);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNI_SOP_CONNECTION_ERROR');
    expect(r.error.retryable).toBe(true);
  });
});

describe('어댑터 선택', () => {
  it('기본은 mock이고 자신이 mock임을 밝힌다', () => {
    expect(createUniSopProvider({}).isMock).toBe(true);
  });

  it('운영에서 mock은 기동을 막는다', () => {
    expect(() => createUniSopProvider({ NODE_ENV: 'production' })).toThrow(/production/);
    expect(
      createUniSopProvider({ NODE_ENV: 'production', UNE_ALLOW_MOCK_PROVIDER: 'true' }).isMock,
    ).toBe(true);
  });

  it('http인데 base URL이 없으면 추측하지 않고 던진다', () => {
    expect(() => createUniSopProvider({ UNE_UNI_SOP_ADAPTER: 'http' })).toThrow(/UNE_UNI_BASE_URL/);
  });

  it('모르는 어댑터 이름은 거부한다', () => {
    expect(() => createUniSopProvider({ UNE_UNI_SOP_ADAPTER: 'real' })).toThrow(/mock\|http/);
  });

  it('http 어댑터는 mock이 아니라고 말한다', () => {
    const p = createUniSopProvider({
      UNE_UNI_SOP_ADAPTER: 'http',
      UNE_UNI_BASE_URL: 'http://uni.example/',
    });
    expect(p.isMock).toBe(false);
    expect(p.adapterId).toBe('http-uni-sop');
  });
});

describe('HttpUniSopAdapter — 시간 예산 (설계 08 §1.14)', () => {
  const FAST: HttpUniSopConfig = { ...CONFIG, firstEventTimeoutMs: 60, totalTimeoutMs: 5_000 };

  /** 헤더만 열고 아무것도 보내지 않는 스트림. */
  function silentResponse(): Response {
    const body = new ReadableStream<Uint8Array>({ start() {} });
    return new Response(body, { status: 200 });
  }

  it('첫 이벤트가 오지 않으면 첫-이벤트 예산에서 끊는다', async () => {
    // 데드라인이 루프 끝에 있으면 read()가 블록되어 **한 번도 검사되지 않고**
    // 실제 상한이 전체 예산(5분)이 된다 — 워커 슬롯과 잡 리스가 그만큼 묶인다.
    const { fetchImpl } = stub(silentResponse);
    const startedAt = Date.now();
    const r = await new HttpUniSopAdapter(FAST, fetchImpl).generateSop(request, CTX);
    const elapsed = Date.now() - startedAt;

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNI_SOP_TIMEOUT');
    expect(r.error.retryable).toBe(true);
    // 전체 예산(5초)까지 가지 않는다.
    expect(elapsed).toBeLessThan(2_000);
  });

  it('첫 이벤트가 온 뒤에는 첫-이벤트 예산을 다시 걸지 않는다', async () => {
    // 노드 사이 간격이 길어도(생성은 원래 느리다) 그것은 전체 예산의 몫이다.
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('data: {"__status__":"generating"}\n'));
        await new Promise((r) => setTimeout(r, 120));
        controller.enqueue(enc.encode('data: {"__done__":{"node_count":0}}\n'));
        controller.enqueue(enc.encode('data: [DONE]\n'));
        controller.close();
      },
    });
    const { fetchImpl } = stub(() => new Response(body, { status: 200 }));
    const r = await new HttpUniSopAdapter(FAST, fetchImpl).generateSop(request, CTX);
    expect(r.ok).toBe(true);
  });
});

describe('HttpUniSopAdapter — 버퍼 경계', () => {
  it('마지막 줄에 개행이 없어도 종결을 인식한다', async () => {
    // `data: [DONE]`으로 끝나면서 개행이 없는 스트림은 흔하다. 남은 버퍼를
    // 흘려보내지 않으면 정상 종료가 UNI_SOP_UNTERMINATED로 뒤집힌다.
    const { fetchImpl } = stub(() =>
      sseResponse([
        'data: {"__compn__":{"compnSn":"s","type":"START"}}\n',
        'data: {"__done__":{"node_count":1}}\n',
        'data: [DONE]',
      ]),
    );
    const r = await new HttpUniSopAdapter(CONFIG, fetchImpl).generateSop(request, CTX);
    expect(r.ok).toBe(true);
  });

  it('개행 없이 끝난 마지막 노드도 잃지 않는다', async () => {
    const { fetchImpl } = stub(() =>
      sseResponse([
        'data: {"__compn__":{"compnSn":"s","type":"START"}}\n',
        'data: {"__done__":{"node_count":1}}\n',
        'data: {"__compn__":{"compnSn":"e","type":"END"}}',
      ]),
    );
    const r = await new HttpUniSopAdapter(CONFIG, fetchImpl).generateSop(request, CTX);
    // __done__은 왔지만 [DONE]이 없다 — 종결 규칙상 오류이고, 그래도 마지막
    // 프레임은 원문에 남아야 한다.
    expect(r.raw.frames).toHaveLength(3);
  });
});
