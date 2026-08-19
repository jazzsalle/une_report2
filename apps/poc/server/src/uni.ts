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

const BASE = (process.env.UNI_BASE_URL ?? 'http://10.20.10.101:8088').replace(/\/+$/, '');
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
export async function chatJson(query: string, opts: { topK?: number } = {}): Promise<unknown[]> {
  if (FORCE_MOCK) return mockJson();
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
        items.push(JSON.parse(payload));
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

export async function search(query: string, topK = 5) {
  if (FORCE_MOCK) return { results: [] };
  const r = await authed('/search/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, top_k: topK }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`UNI search HTTP ${r.status}`);
  return (await r.json()) as { results: { filename: string; score: number; text: string; doc_id: string }[] };
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

function mockJson(): unknown[] {
  const raw = mockFile('sop.json');
  if (raw) return JSON.parse(raw) as unknown[];
  return [];
}
