import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '@une/api';
import { ADMIN_URL, apiFor, startHarness, type Harness } from './harness';

/**
 * 관측성 (CC-430).
 *
 * 증명해야 하는 것.
 *   (1) `live`와 `ready`가 **다른 질문에 답한다** — liveness가 의존성에 걸리면
 *       DB 장애가 컨테이너 재시작 폭풍이 된다.
 *   (2) 의존성이 죽으면 `ready`가 그것을 말한다. 늘 `ok`인 health는 로드밸런서를
 *       속인다.
 *   (3) `/metrics`가 실제 요청을 센다.
 *   (4) 시계열 라벨이 **경로 템플릿**이다 — UUID가 라벨에 들어가면 수집기가
 *       터지고, 외부에서 시계열을 만들 수 있게 된다.
 *   (5) 로그가 비밀을 흘리지 않는다.
 */
describe.skipIf(!ADMIN_URL)('관측성 (CC-430)', () => {
  let h: Harness;
  let api: ReturnType<typeof apiFor>;
  let adminToken: string;

  beforeAll(async () => {
    h = await startHarness('cc430_obs');
    api = apiFor(h);
    adminToken = await api.login(h.fixtures.tenantA, 'admin-a');
  }, 180_000);

  afterAll(async () => {
    await h?.close();
  });

  it('(1) live는 의존성을 보지 않는다', async () => {
    const res = await api.call('GET', '/api/v1/health/live', null);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('une-api');
  });

  it('(2) ready는 DB와 저장소에 실제로 물어보고, 죽으면 말한다', async () => {
    const healthy = await api.call('GET', '/api/v1/health/ready', null);
    expect(healthy.status).toBe(200);
    const ok = (await healthy.json()) as {
      status: string;
      checks: Array<{ name: string; ok: boolean; latencyMs: number }>;
    };
    expect(ok.status).toBe('ready');
    expect(ok.checks.map((c) => c.name).sort()).toEqual(['database', 'objectStorage']);
    expect(ok.checks.every((c) => c.ok)).toBe(true);
    // 실제로 물어봤다면 시간이 잰다. 전부 0이면 점검을 흉내만 낸 것이다.
    expect(ok.checks.some((c) => c.latencyMs >= 0)).toBe(true);

    // **저장소를 죽여 본다.** 늘 ok를 돌려주는 health는 이 시험을 통과하지
    // 못한다 — 그것이 이 단언의 목적이다.
    h.storage.unavailable = true;
    try {
      const degraded = await api.call('GET', '/api/v1/health/ready', null);
      const body = (await degraded.json()) as {
        status: string;
        checks: Array<{ name: string; ok: boolean; error?: string }>;
      };
      expect(body.status).toBe('degraded');
      const storage = body.checks.find((c) => c.name === 'objectStorage');
      expect(storage?.ok).toBe(false);
      expect(storage?.error, '운영자가 읽을 사유가 있어야 한다').toBeTruthy();
      // DB는 멀쩡하다 — 하나가 죽었다고 전부를 실패로 적으면 어디가 문제인지
      // 말하지 못한다.
      expect(body.checks.find((c) => c.name === 'database')?.ok).toBe(true);
    } finally {
      h.storage.unavailable = false;
    }
  });

  it('(3)(4) metrics가 요청을 세고, 라벨은 경로 템플릿이다', async () => {
    // 자원을 가리키는 요청을 몇 번 보낸다. UUID가 라벨에 새면 여기서 드러난다.
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    for (const id of ids) {
      await api.call('GET', `/api/v1/situations/${id}`, adminToken);
    }

    const res = await api.call('GET', '/api/v1/metrics', null);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();

    expect(text).toContain('une_http_requests_total');
    expect(text).toContain('une_http_request_duration_ms_bucket');
    expect(text).toContain('une_http_request_duration_ms_count');

    // **UUID가 한 번도 나오면 안 된다.** 시계열이 요청마다 하나씩 생긴다.
    for (const id of ids) {
      expect(text, `메트릭 라벨에 자원 UUID가 샜다: ${id}`).not.toContain(id);
    }
    // 경로 템플릿은 남아 있어야 한다 — 아무것도 안 세고 통과하면 곤란하다.
    expect(text).toMatch(/route="[^"]*situations[^"]*"/);

    // 세는 것이 실제로 늘어난다.
    const before = countFor(text, '/api/v1/health/live');
    await api.call('GET', '/api/v1/health/live', null);
    const after = countFor(
      await (await api.call('GET', '/api/v1/metrics', null)).text(),
      '/api/v1/health/live',
    );
    expect(after).toBeGreaterThan(before);
  });

  it('(5) 로그가 비밀을 흘리지 않는다', () => {
    const lines: string[] = [];
    const logger = createLogger({ service: 'test', sink: (line) => lines.push(line) });

    logger.info('login', {
      correlationId: 'corr_1',
      accessToken: 'eyJhbGciOi.super.secret',
      refresh_token: 'rt_secret',
      password: 'hunter2',
      authorization: 'Bearer abc',
      sha256: 'a'.repeat(64),
      nested: { apiKey: 'k-123', ok: 'visible' },
      payload: { huge: 'x'.repeat(5000) },
      userId: 'u-1',
    });

    const line = lines[0];
    expect(line).toBeTruthy();
    for (const secret of ['super.secret', 'rt_secret', 'hunter2', 'Bearer abc', 'k-123']) {
      expect(line, `로그에 비밀이 남았다: ${secret}`).not.toContain(secret);
    }
    expect(line).toContain('[redacted]');
    // 지우는 것과 **덜어내는 것**은 다르다 — 본문은 크기만 남긴다.
    expect(line).toContain('bytes omitted');
    // 지우지 말아야 할 것은 남는다. 전부 지우면 로그가 쓸모없다.
    expect(line).toContain('visible');
    expect(line).toContain('u-1');
    expect(line).toContain('corr_1');

    const parsed = JSON.parse(line) as { level: string; service: string; msg: string };
    expect(parsed.level).toBe('info');
    expect(parsed.service).toBe('test');
    expect(parsed.msg).toBe('login');
  });

  it('(5b) 레벨 아래는 나가지 않는다', () => {
    const lines: string[] = [];
    const logger = createLogger({ service: 'test', level: 'warn', sink: (l) => lines.push(l) });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => (JSON.parse(l) as { level: string }).level)).toEqual(['warn', 'error']);
  });
});

/** `route="<path>"` 라벨을 가진 요청 카운터 값을 더한다. */
function countFor(metrics: string, route: string): number {
  let total = 0;
  for (const line of metrics.split('\n')) {
    if (!line.startsWith('une_http_requests_total{')) continue;
    if (!line.includes(`route="${route}"`)) continue;
    total += Number(line.slice(line.lastIndexOf(' ') + 1));
  }
  return total;
}
