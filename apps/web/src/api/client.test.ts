import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, fileNameFromDisposition, newIdempotencyKey } from './client';
import { ApiCallError, nextActionFor } from './errors';

/**
 * CC-170 API 클라이언트.
 *
 * 화면이 status 숫자를 해석하지 않는다는 것이 이 층의 계약이다. 그래서 검사할
 * 것은 "성공을 잘 벗기는가"보다 **오류를 어떻게 정규화하는가**다.
 */

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const OK_META = {
  requestId: 'req_1',
  correlationId: 'corr_1',
  timestamp: '2026-08-05T00:00:00Z',
  schemaVersion: '1.0',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApiClient.call', () => {
  it('봉투를 벗겨 data만 돌려주고 correlationId를 함께 준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(200, { success: true, data: { planId: 'p1' }, meta: OK_META }),
        ),
    );
    const client = new ApiClient('http://api.test/api/v1');
    const result = await client.call<{ planId: string }>('/plans');
    expect(result.data).toEqual({ planId: 'p1' });
    expect(result.correlationId).toBe('corr_1');
  });

  it('상관관계 ID와 멱등 키를 헤더로 보낸다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { success: true, data: {}, meta: OK_META }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('http://api.test/api/v1');
    client.setToken('token-abc');
    await client.call('/plans', { method: 'POST', body: { a: 1 }, idempotencyKey: 'k-1' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Idempotency-Key']).toBe('k-1');
    expect(init.headers.Authorization).toBe('Bearer token-abc');
    expect(init.headers['X-Correlation-Id']).toMatch(/^corr_/);
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('오류 본문을 ApiCallError로 정규화한다 (violations 포함)', async () => {
    // 호출마다 새 Response를 만든다 — 같은 인스턴스를 두 번 읽으면 본문이
    // 이미 소비돼 있어 테스트가 클라이언트가 아니라 자기 자신을 검사하게 된다.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(422, {
            success: false,
            error: {
              code: 'FILE-422-002',
              message: '업로드된 파일이 사전등록 정보와 일치하지 않습니다.',
              recoverable: false,
              violations: [{ field: 'sha256', reason: '사전등록한 해시와 다릅니다.' }],
            },
            meta: OK_META,
          }),
        ),
      ),
    );
    const client = new ApiClient('http://api.test/api/v1');
    await expect(client.call('/files/x/complete', { method: 'POST' })).rejects.toBeInstanceOf(
      ApiCallError,
    );
    try {
      await client.call('/files/x/complete', { method: 'POST' });
    } catch (error) {
      const failure = (error as ApiCallError).failure;
      expect(failure.code).toBe('FILE-422-002');
      expect(failure.violations?.[0].field).toBe('sha256');
      expect(failure.correlationId).toBe('corr_1');
      // 코드표에 다음 행동이 있다.
      expect(nextActionFor(failure)).toContain('다시 업로드');
    }
  });

  it('네트워크 실패는 서버 오류와 구분한다 (지어낸 코드임을 코드로 표시)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const client = new ApiClient('http://api.test/api/v1');
    try {
      await client.call('/plans');
      throw new Error('실패했어야 한다');
    } catch (error) {
      const failure = (error as ApiCallError).failure;
      expect(failure.status).toBe(0);
      expect(failure.code).toBe('NET-0000');
      expect(failure.recoverable).toBe(true);
    }
  });

  it('봉투가 아닌 200 응답은 성공으로 취급하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { anything: true })));
    const client = new ApiClient('http://api.test/api/v1');
    await expect(client.call('/plans')).rejects.toThrowError(/계약과 다릅니다/);
  });

  it('204는 본문 없이 통과한다 (업로드 전송)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const client = new ApiClient('http://api.test/api/v1');
    const result = await client.call('/files/x/content', { method: 'PUT' });
    expect(result.data).toBeUndefined();
  });
});

describe('ApiClient.uploadBytes', () => {
  it('티켓의 헤더를 그대로 쓰고 Authorization을 더하지 않는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient('http://api.test/api/v1');
    client.setToken('token-abc');
    await client.uploadBytes(
      {
        url: 'http://storage.test/bucket/key?sig=1',
        method: 'PUT',
        headers: { 'Content-Type': 'application/hwp+zip', 'x-amz-checksum-sha256': 'abc=' },
      },
      new Uint8Array([1, 2, 3]),
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://storage.test/bucket/key?sig=1');
    // presign URL에서는 헤더가 서명 대상이다 — 하나만 더해도 서명이 깨진다.
    expect(Object.keys(init.headers)).toEqual(['Content-Type', 'x-amz-checksum-sha256']);
  });

  it('403은 티켓 문제로 매핑한다 (재시도 불가)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('denied', { status: 403 })));
    const client = new ApiClient('http://api.test/api/v1');
    try {
      await client.uploadBytes(
        { url: 'http://s/k', method: 'PUT', headers: {} },
        new Uint8Array([1]),
      );
      throw new Error('실패했어야 한다');
    } catch (error) {
      const failure = (error as ApiCallError).failure;
      expect(failure.code).toBe('FILE-403-001');
      expect(failure.recoverable).toBe(false);
    }
  });
});

describe('fileNameFromDisposition', () => {
  it('RFC 5987 값에서 한글 파일명을 복원한다', () => {
    const header = `attachment; filename="export.hwpx"; filename*=UTF-8''${encodeURIComponent('간략 보고 양식.hwpx')}`;
    expect(fileNameFromDisposition(header)).toBe('간략 보고 양식.hwpx');
  });

  it('인코딩이 깨졌으면 ASCII 대체값으로 내려간다', () => {
    expect(
      fileNameFromDisposition(`attachment; filename="fallback.hwpx"; filename*=UTF-8''%E0%A4%A`),
    ).toBe('fallback.hwpx');
  });

  it('헤더가 없으면 기본 이름을 쓴다', () => {
    expect(fileNameFromDisposition(null)).toBe('export.hwpx');
  });
});

describe('newIdempotencyKey', () => {
  it('같은 라벨이어도 값이 겹치지 않는다', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey('plan')));
    expect(keys.size).toBe(50);
  });
});
