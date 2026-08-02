import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LEGACY_CONTENT_PATH,
  LEGACY_TOC_PATH,
  LegacyT3qPlanAdapter,
} from './legacy-t3q-plan-adapter';

/**
 * Legacy HTTP adapter verification WITHOUT a real provider (OB-01 open):
 * a local node:http fixture server serves the CC-115 transcript fixtures and
 * defect scenarios. A real socket (not a mocked dispatcher) is used on
 * purpose — timeout, refused-connection, and SSE paths are only meaningful
 * against real transport behavior (same reasoning as the api e2e pattern).
 */

const FIXTURE_DIR = resolve(
  process.cwd(),
  '..',
  '..',
  'tests',
  'contract',
  'fixtures',
  't3q-legacy',
);
const TOC_RESPONSE = readFileSync(resolve(FIXTURE_DIR, 'rpt-001.response.valid.json'), 'utf8');
const CONTENT_RESPONSE = readFileSync(resolve(FIXTURE_DIR, 'rpt-002.response.valid.json'), 'utf8');
const SSE_TRANSCRIPT = readFileSync(resolve(FIXTURE_DIR, 'rpt-002.stream.assumed.sse.txt'), 'utf8');

const planContext = {
  subject: '2026년 폭염 대비 안전관리 계획',
  backgroundInfo: { disasterType: '폭염', controlPhase: '대비' },
  purposeOfDocument: { goalOfBusiness: '피해 최소화', role: '담당자', targetAudiences: ['정부'] },
};
const outline = [{ nodeKey: 'n-1', title: 'Ⅰ. 개요' }];
const ctx = { correlationId: 'corr_http_test' };
const TEST_TOKEN = 'test-secret-token-cc125';

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

interface Fixture {
  url: string;
  requests: {
    path: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }[];
  close: () => Promise<void>;
}

const servers: Server[] = [];

async function startServer(handler: Handler): Promise<Fixture> {
  const requests: Fixture['requests'] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => {
      requests.push({ path: req.url ?? '', headers: { ...req.headers }, body });
      handler(req, res, body);
    });
  });
  servers.push(server);
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolvePromise) => server.close(() => resolvePromise())),
  };
}

function makeAdapter(
  baseUrl: string,
  extra: Partial<ConstructorParameters<typeof LegacyT3qPlanAdapter>[0]> = {},
): LegacyT3qPlanAdapter {
  return new LegacyT3qPlanAdapter({
    baseUrl,
    authMode: 'header',
    authHeaderName: 'X-T3Q-Key',
    authToken: TEST_TOKEN,
    sleep: async () => {},
    ...extra,
  });
}

function json(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe('LegacyT3qPlanAdapter over a fixture server', () => {
  it('RPT-001 happy path: maps the transcript fixture, keeps raw + meta', async () => {
    const fx = await startServer((_req, res) => json(res, 200, TOC_RESPONSE));
    const result = await makeAdapter(fx.url).generateToc({ planContext }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tree[0].title).toBe('Ⅰ. 개요');
      expect(result.data.tree[0].nodeKey).toBe('n-1');
      expect(result.httpStatus).toBe(200);
      expect(result.adapterId).toBe('legacy-http-v0.8.5');
      expect(result.mappingVersion).toBe('legacy-v0.8.5-une1@1');
      expect(result.rawResponse).toEqual(JSON.parse(TOC_RESPONSE));
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    }
    expect(fx.requests[0].path).toBe(LEGACY_TOC_PATH);
    expect(fx.requests[0].headers['x-t3q-key']).toBe(TEST_TOKEN);
    expect(JSON.parse(fx.requests[0].body)).toMatchObject({
      data: { subject: planContext.subject },
    });
  });

  it('RPT-002 JSON path maps ContentDrafts', async () => {
    const fx = await startServer((_req, res) => json(res, 200, CONTENT_RESPONSE));
    const result = await makeAdapter(fx.url).generateContent(
      { planContext, outline, stream: false },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sections[0].children[0].citations[0].sourceRef).toBe('ref-001');
      expect(result.operation).toBe('content');
    }
    expect(fx.requests[0].path).toBe(LEGACY_CONTENT_PATH);
    expect(JSON.parse(fx.requests[0].body).data.stream).toBe(false);
  });

  it('RPT-002 SSE path parses the assumed transcript framing', async () => {
    const fx = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(SSE_TRANSCRIPT);
    });
    const result = await makeAdapter(fx.url).generateContent({ planContext, outline }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sections.map((s) => s.title)).toEqual([
        '1. 추진 배경',
        '1. 무더위쉼터 운영',
      ]);
      expect(result.rawResponse).toBe(SSE_TRANSCRIPT);
    }
  });

  it('truncated SSE (no [DONE]) fails with the raw transcript preserved', async () => {
    const fx = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: {"name":"1. 추진 배경","content":"x","references":[],"children":[]}\n\n');
    });
    const result = await makeAdapter(fx.url).generateContent({ planContext, outline }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('T3Q_RESPONSE_CONTRACT_VIOLATION');
      expect(String(result.rawResponse)).toContain('추진 배경');
    }
  });

  it.each([
    [400, 'T3Q_REQUEST_REJECTED', false],
    [401, 'T3Q_AUTH_ERROR', false],
    [403, 'T3Q_AUTH_ERROR', false],
    [404, 'T3Q_ENDPOINT_NOT_FOUND', false],
    [422, 'T3Q_REQUEST_REJECTED', false],
    [500, 'T3Q_PROVIDER_ERROR', true],
  ] as const)('HTTP %d normalizes to %s', async (status, code, retryable) => {
    const fx = await startServer((_req, res) => json(res, status, '{"detail":"x"}'));
    const result = await makeAdapter(fx.url).generateToc({ planContext }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ code, retryable, httpStatus: status });
      expect(result.rawRequest).toBeDefined();
    }
  });

  it('post-response 500 is NOT resent (no idempotency key in the legacy contract)', async () => {
    const fx = await startServer((_req, res) => json(res, 500, '{}'));
    await makeAdapter(fx.url).generateToc({ planContext }, ctx);
    expect(fx.requests).toHaveLength(1);
  });

  it('429 honors Retry-After once, then succeeds', async () => {
    let calls = 0;
    const delays: number[] = [];
    const fx = await startServer((_req, res) => {
      calls += 1;
      if (calls === 1) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '2' });
        res.end('{}');
        return;
      }
      json(res, 200, TOC_RESPONSE);
    });
    const adapter = makeAdapter(fx.url, {
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    const result = await adapter.generateToc({ planContext }, ctx);
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    expect(delays).toEqual([2000]);
  });

  it('503 is the ONE 5xx that resends (Retry-After honored), unlike plain 500', async () => {
    // Pin the 503 branch of mayResend explicitly (QA R3): a regression here
    // would silently break the no-resend-after-response rule in one
    // direction or the other.
    let calls = 0;
    const delays: number[] = [];
    const fx = await startServer((_req, res) => {
      calls += 1;
      if (calls === 1) {
        res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '30' });
        res.end('{}');
        return;
      }
      json(res, 200, TOC_RESPONSE);
    });
    const adapter = makeAdapter(fx.url, {
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    const result = await adapter.generateToc({ planContext }, ctx);
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    expect(delays).toEqual([10_000]); // Retry-After 30s capped to 10s
  });

  it('connection refused retries once, then fails as T3Q_CONNECTION_ERROR', async () => {
    // Bind then close to get a port that refuses connections.
    const fx = await startServer(() => {});
    await fx.close();
    const result = await makeAdapter(fx.url).generateToc({ planContext }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('T3Q_CONNECTION_ERROR');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('response timeout maps to T3Q_TIMEOUT and is NOT resent', async () => {
    let calls = 0;
    const fx = await startServer((_req, res) => {
      calls += 1;
      // Never respond; the client headersTimeout fires.
      void res;
    });
    const adapter = makeAdapter(fx.url, { connectTimeoutMs: 1000, responseTimeoutMs: 300 });
    const result = await adapter.generateToc({ planContext }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('T3Q_TIMEOUT');
      expect(result.error.retryable).toBe(true);
    }
    expect(calls).toBe(1);
  }, 15_000);

  it('non-JSON and broken-JSON responses map to T3Q_MALFORMED_RESPONSE', async () => {
    const fxHtml = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>gateway</html>');
    });
    const htmlResult = await makeAdapter(fxHtml.url).generateToc({ planContext }, ctx);
    expect(!htmlResult.ok && htmlResult.error.code).toBe('T3Q_MALFORMED_RESPONSE');

    const fxBroken = await startServer((_req, res) =>
      json(res, 200, '{"title": "x", "sections": ['),
    );
    const brokenResult = await makeAdapter(fxBroken.url).generateToc({ planContext }, ctx);
    expect(!brokenResult.ok && brokenResult.error.code).toBe('T3Q_MALFORMED_RESPONSE');
  });

  it('guard violation preserves BOTH raw request and raw response (CC-120 defect fix)', async () => {
    const fx = await startServer((_req, res) => json(res, 200, '{"title":"x","sections":"nope"}'));
    const result = await makeAdapter(fx.url).generateToc({ planContext }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('T3Q_RESPONSE_CONTRACT_VIOLATION');
      expect(result.error.retryable).toBe(false);
      expect(result.rawRequest).toMatchObject({ data: { subject: planContext.subject } });
      expect(result.rawResponse).toEqual({ title: 'x', sections: 'nope' });
    }
  });

  it('circuit opens after consecutive failures, rejects instantly, recovers half-open', async () => {
    let failing = true;
    const fx = await startServer((_req, res) =>
      failing ? json(res, 500, '{}') : json(res, 200, TOC_RESPONSE),
    );
    let t = 0;
    const adapter = makeAdapter(fx.url, {
      breakerFailureThreshold: 2,
      breakerOpenMs: 30_000,
      now: () => t,
    });
    await adapter.generateToc({ planContext }, ctx);
    await adapter.generateToc({ planContext }, ctx);
    expect(adapter.circuitState('toc')).toBe('open');

    const rejected = await adapter.generateToc({ planContext }, ctx);
    expect(!rejected.ok && rejected.error.code).toBe('T3Q_CIRCUIT_OPEN');
    expect(fx.requests).toHaveLength(2); // the open circuit made no HTTP call

    t += 30_000;
    failing = false;
    const probe = await adapter.generateToc({ planContext }, ctx);
    expect(probe.ok).toBe(true);
    expect(adapter.circuitState('toc')).toBe('closed');
  });

  it('breakers are per-operation: an open toc circuit does not block content', async () => {
    const fx = await startServer((req, res) =>
      req.url === LEGACY_TOC_PATH ? json(res, 500, '{}') : json(res, 200, CONTENT_RESPONSE),
    );
    const adapter = makeAdapter(fx.url, { breakerFailureThreshold: 1, breakerOpenMs: 60_000 });
    await adapter.generateToc({ planContext }, ctx);
    expect(adapter.circuitState('toc')).toBe('open');
    const content = await adapter.generateContent({ planContext, outline, stream: false }, ctx);
    expect(content.ok).toBe(true);
  });

  it('hygiene: the auth token never appears in any result artifact', async () => {
    const fx = await startServer((_req, res) => json(res, 401, '{"detail":"denied"}'));
    const failure = await makeAdapter(fx.url).generateToc({ planContext }, ctx);
    expect(JSON.stringify(failure)).not.toContain(TEST_TOKEN);

    const fxOk = await startServer((_req, res) => json(res, 200, TOC_RESPONSE));
    const success = await makeAdapter(fxOk.url).generateToc({ planContext }, ctx);
    const serialized = JSON.stringify(success);
    expect(serialized).not.toContain(TEST_TOKEN);
    expect(serialized.toLowerCase()).not.toContain('x-t3q-key');
  });
});

describe('LegacyT3qPlanAdapter fail-closed construction (OB-01)', () => {
  it('rejects a missing base URL', () => {
    expect(() => makeAdapter('')).toThrow(/baseUrl/);
  });

  it('rejects header auth without name/token', () => {
    expect(
      () => new LegacyT3qPlanAdapter({ baseUrl: 'http://127.0.0.1:1', authMode: 'header' }),
    ).toThrow(/authHeaderName and authToken/);
  });
});
