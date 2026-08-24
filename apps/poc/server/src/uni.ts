/**
 * UNI RAG API 클라이언트 (T3Q 대체 겸용).
 *
 * - 토큰은 프로세스 메모리에 하나. 401이면 한 번 재로그인.
 * - UNI_MOCK=1 이거나 UNI에 닿지 못하면 녹화 응답으로 폴백한다 — 데모가 외부망 하나에 죽지 않게.
 * - 스트리밍(/chat/)은 SSE `data: "토큰"` 프레임. 마지막에 `data: {"__sources__":[...]}`.
 * - /chat/json 은 SOP 캔버스 JSON을 SSE로 흘려준다 (실측: uni-sop-2 매퍼가 아는 형식).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Agent } from 'undici';

// 실측 2026-08-24: 유니 :8088이 HTTPS로 전환(자체 인증서) — T3Q처럼 이 호스트에 한해 검증을 끈다(UNI_VERIFY_TLS=0). 운영은 켠다.
const BASE = (process.env.UNI_BASE_URL ?? 'https://10.20.10.101:8088').replace(/\/+$/, '');
const VERIFY = process.env.UNI_VERIFY_TLS !== '0' && process.env.UNI_VERIFY_TLS !== 'false';
const dispatcher = new Agent({ connect: { rejectUnauthorized: VERIFY } });
// Node 전역 fetch(undici)에 dispatcher만 끼워 넣는다 — 표준 타입엔 없지만 undici가 받는다. Response 타입은 DOM 그대로.
const fetch = (url: string, init?: RequestInit): Promise<Response> => globalThis.fetch(url, { ...(init ?? {}), dispatcher } as RequestInit);
// 실측 2026-08-24: REST /search/ 는 제거되고 검색은 MCP(search_knowledge, Bearer 토큰)로만 — 토큰은 infrastructure/.env UNI_MCP_TOKEN
const MCP_URL = (process.env.UNI_MCP_URL ?? 'http://10.20.10.101:3100/mcp').replace(/\/+$/, '');
const MCP_TOKEN = process.env.UNI_MCP_TOKEN ?? '';
const ACCOUNT = process.env.UNI_USERNAME ?? '';
const PASSWORD = process.env.UNI_PASSWORD ?? '';
const FORCE_MOCK = process.env.UNI_MOCK === '1';
export const DEFAULT_MODEL = process.env.UNI_MODEL ?? 'exaone-4.5';

let token: string | null = null;
let lastFailure: string | null = null;

export function uniStatus() {
  return { baseUrl: BASE, mock: FORCE_MOCK, loggedIn: !!token, lastFailure, model: DEFAULT_MODEL };
}

async function login(): Promise<string> {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: ACCOUNT, password: PASSWORD }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`UNI 로그인 실패 HTTP ${r.status}`);
  const j = (await r.json()) as { token?: string };
  if (!j.token) throw new Error('UNI 로그인 응답에 token 없음');
  token = j.token;
  return token;
}

async function authed(path: string, init: RequestInit, retry = true): Promise<Response> {
  const t = token ?? (await login());
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` },
  });
  if (r.status === 401 && retry) {
    token = null;
    return authed(path, init, false);
  }
  return r;
}

/** SSE `data:` 페이로드를 하나씩 뽑아 콜백. 문자열은 토큰, 객체는 메타. */
async function readSse(
  body: ReadableStream<Uint8Array>,
  onData: (payload: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split('\n')) {
        if (line.startsWith('data:')) onData(line.slice(5).trimStart());
      }
    }
  }
  if (buf.trim()) for (const line of buf.split('\n')) if (line.startsWith('data:')) onData(line.slice(5).trimStart());
}

export interface StreamHandlers {
  onToken: (text: string) => void;
  onSources?: (sources: unknown[]) => void;
  onDone?: () => void;
}

/**
 * 채팅 스트리밍. 텍스트 토큰을 그대로 흘리고 `__sources__`는 분리한다.
 * 반환값은 누적 전체 텍스트.
 */
export async function chatStream(
  query: string,
  h: StreamHandlers,
  opts: { topK?: number; model?: string; mockKey?: string } = {},
): Promise<string> {
  if (FORCE_MOCK) return mockStream(opts.mockKey ?? 'chat', h);
  let full = '';
  try {
    const r = await authed('/chat/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, stream: true, top_k: opts.topK ?? 3, model_key: opts.model ?? DEFAULT_MODEL }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!r.ok || !r.body) throw new Error(`UNI /chat/ HTTP ${r.status}`);
    await readSse(r.body, (payload) => {
      if (payload.startsWith('"')) {
        const text = JSON.parse(payload) as string;
        full += text;
        h.onToken(text);
      } else if (payload.startsWith('{')) {
        try {
          const meta = JSON.parse(payload) as { __sources__?: unknown[] };
          if (meta.__sources__) h.onSources?.(meta.__sources__);
        } catch {
          /* 메타가 아니면 무시 */
        }
      }
    });
    lastFailure = null;
    h.onDone?.();
    return full;
  } catch (e) {
    lastFailure = (e as Error).message;
    if (full) {
      h.onDone?.();
      return full; // 중간에 끊겼어도 받은 만큼은 살린다
    }
    return mockStream(opts.mockKey ?? 'chat', h);
  }
}

/** 비스트리밍 편의 함수 — 전체 텍스트만 필요할 때. */
export async function chatText(query: string, opts: { topK?: number; model?: string; mockKey?: string } = {}): Promise<string> {
  return chatStream(query, { onToken: () => {} }, opts);
}

/**
 * SOP JSON 생성. UNI /chat/json 은 SSE로 노드 객체들을 흘린다.
 * 모든 data 페이로드를 모아 배열로 돌려준다 (매핑은 sop.ts가 한다).
 */
export async function chatJson(query: string, opts: { topK?: number; onStatus?: (status: string) => void } = {}): Promise<unknown[]> {
  if (FORCE_MOCK) return mockJson(opts.onStatus);
  try {
    const r = await authed('/chat/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, top_k: opts.topK ?? 5 }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!r.ok || !r.body) throw new Error(`UNI /chat/json HTTP ${r.status}`);
    const items: unknown[] = [];
    await readSse(r.body, (payload) => {
      try {
        const j = JSON.parse(payload) as unknown;
        // {"__status__": "searching|reranking|generating"} 진행 프레임(실측 2026-08-19) — 화면에 흘릴 수 있게 알린다
        const st = j && typeof j === 'object' && typeof (j as { __status__?: unknown }).__status__ === 'string' ? (j as { __status__: string }).__status__ : null;
        if (st) opts.onStatus?.(st);
        items.push(j);
      } catch {
        /* 문자열 토큰 등은 무시 */
      }
    });
    lastFailure = null;
    if (!items.length) throw new Error('UNI /chat/json 응답이 비었다');
    return items;
  } catch (e) {
    lastFailure = (e as Error).message;
    return mockJson();
  }
}

/** 지식문서 업로드 (multipart 필드명 `file` — CC-410 실측). */
export async function uploadDocument(filename: string, bytes: Uint8Array, mime = 'application/octet-stream') {
  if (FORCE_MOCK) return { message: 'mock', filename, doc_id: `mock-${Date.now()}` };
  const fd = new FormData();
  fd.append('file', new Blob([bytes as BlobPart], { type: mime }), filename);
  const r = await authed('/documents/upload', { method: 'POST', body: fd, signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`UNI upload HTTP ${r.status}: ${await r.text()}`);
  return (await r.json()) as { message?: string; filename?: string; doc_id?: string };
}

export async function listDocuments(page = 1, pageSize = 20) {
  if (FORCE_MOCK) return { documents: [], total: 0 };
  const r = await authed(`/documents/?page=${page}&page_size=${pageSize}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`UNI documents HTTP ${r.status}`);
  return (await r.json()) as { documents: unknown[]; total: number };
}

// ── 검색: MCP search_knowledge (2026-08-24부터 REST /search/ 제거·MCP Bearer 인증 필수) ──────────
// MCP는 동시 호출 시 빈 오류를 낸다(실측 2026-08-22) → 큐로 순차화. initialize는 프로세스당 1회.
let mcpChain: Promise<unknown> = Promise.resolve();
let mcpInitialized = false;
async function mcpPost(body: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${MCP_TOKEN}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`UNI MCP HTTP ${r.status}${r.status === 404 ? ' — 토큰이 없거나 잘못됨(UNI_MCP_TOKEN)' : ''}`);
  const raw = await r.text();
  const frames = raw.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5).trim()) as Record<string, unknown>);
  if (frames.length) return frames[frames.length - 1];
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}
async function mcpCall(name: string, args: Record<string, unknown>): Promise<string> {
  if (!mcpInitialized) {
    await mcpPost({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'une-poc', version: '0' } } });
    try { await mcpPost({ jsonrpc: '2.0', method: 'notifications/initialized' }); } catch { /* 선택 */ }
    mcpInitialized = true;
  }
  const res = await mcpPost({ jsonrpc: '2.0', id: Date.now() % 1e9, method: 'tools/call', params: { name, arguments: args } });
  const result = (res.result ?? {}) as { structuredContent?: { result?: string }; content?: { text?: string }[]; isError?: boolean };
  const text = result.structuredContent?.result ?? (result.content ?? []).map((c) => c.text ?? '').join('');
  if ((result as { isError?: boolean }).isError) throw new Error(`UNI MCP 도구 오류: ${text.slice(0, 120)}`);
  return text;
}
/** MCP 응답의 `[출처: 문서 · 유사도 0.99]` 블록을 예전 REST /search/ 모양으로 되돌린다 — 소비처(manuals.ts 등) 무변경 */
export function parseMcpSearch(text: string): { filename: string; score: number; text: string; doc_id: string }[] {
  const out: { filename: string; score: number; text: string; doc_id: string }[] = [];
  const re = /\[출처:\s*(.+?)\s*·\s*유사도\s*([\d.]+)\]\n?([\s\S]*?)(?=\n\[출처:|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ filename: m[1].trim(), score: Number(m[2]), text: m[3].replace(/\n-{3,}\s*$/g, '').trim(), doc_id: '' });
  return out;
}
export async function search(query: string, topK = 5) {
  if (FORCE_MOCK) return { results: [] };
  if (!MCP_TOKEN) { lastFailure = 'UNI_MCP_TOKEN 없음 — 검색은 MCP 인증 필요(2026-08-24)'; throw new Error(lastFailure); }
  const run = async () => {
    const text = await mcpCall('search_knowledge', { query, top_k: Math.min(20, topK) });
    return { results: parseMcpSearch(text) };
  };
  const p = mcpChain.then(run, run); // 앞선 호출이 실패해도 큐는 이어간다
  mcpChain = p.catch(() => undefined);
  return p;
}

// ── MOCK 폴백 ─────────────────────────────────────────────────────────────

const MOCK_DIR = join(process.cwd(), 'src', 'mock');

function mockFile(name: string): string | null {
  const p = join(MOCK_DIR, name);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

async function mockStream(key: string, h: StreamHandlers): Promise<string> {
  const text =
    mockFile(`${key}.md`) ??
    `# (오프라인 목업)\n\nUNI(${BASE})에 닿지 못해 녹화된 응답을 대신 보여줍니다.\n\n- 원인: ${lastFailure ?? 'UNI_MOCK=1'}\n`;
  // 실제 스트림처럼 어절 단위로 흘린다
  for (const piece of text.split(/(?<=\s)/)) {
    h.onToken(piece);
    await new Promise((r) => setTimeout(r, 12));
  }
  h.onSources?.([{ filename: '(mock)', score: 0, text: '오프라인 목업', doc_id: 'mock' }]);
  h.onDone?.();
  return text;
}

function mockJson(onStatus?: (s: string) => void): unknown[] {
  const raw = mockFile('sop.json');
  if (raw) {
    const items = JSON.parse(raw) as unknown[];
    for (const j of items) { const st = j && typeof j === 'object' ? (j as { __status__?: unknown }).__status__ : null; if (typeof st === 'string') onStatus?.(st); }
    return items;
  }
  return [];
}
