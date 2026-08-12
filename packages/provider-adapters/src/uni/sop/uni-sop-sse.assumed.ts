import type { UniSopEvent, UniSopStatus } from './uni-sop-port';
import { UNI_SOP_STATUSES } from './uni-sop-port';

/**
 * UNI `/chat/json` SSE 프레이밍 — **UNE 가정** (CC-240, OB-04).
 *
 * 설계 08 §1.11이 정한 것은 **이벤트 이름뿐**이다: `__status__`, `__thinking__`,
 * `__compn__`, `__sources__`, `__done__`, `__error__`, `[DONE]`. 그 이름들이
 * 어떤 프레임에 담겨 오는지는 **어디에도 없다** — 번들 스냅샷의 `/chat/json`도
 * 요청·응답이 `additionalProperties: true`다.
 *
 * 아래의 모든 것이 **UNE가 요청하는 형태**다. T3Q의 `.assumed` 규약을 그대로
 * 따른다(`legacy-sse.ts`, `target-v2-sse.assumed.ts`):
 *
 *   - `data:` 한 줄에 JSON 객체 하나
 *   - 그 객체의 **키**가 이벤트 이름이다 (`{"__compn__": {...}}`)
 *   - `[DONE]`은 `data: [DONE]` 리터럴로 스트림을 닫는다
 *
 * UNI가 답하면(CC-410) 이 파일이 provider 진실에 맞춰 재검증되지, 그 반대가
 * 아니다.
 *
 * **종결 규칙** — 레거시 `[DONE]` 규칙과 같은 원리다. `__done__` 없이 끝난
 * 스트림은 **부분 결과가 아니라 오류다**. 파서는 프레이밍만 강제하고 종결
 * 판정은 어댑터가 한다.
 */

export const UNI_SOP_EVENT_KEYS = [
  '__status__',
  '__thinking__',
  '__compn__',
  '__sources__',
  '__done__',
  '__error__',
] as const;

export const UNI_SOP_STREAM_TERMINATOR = '[DONE]';

export class UniSopSseError extends Error {
  constructor(
    readonly reason: string,
    readonly rawLine: string,
  ) {
    super(`UNI SOP SSE: ${reason}`);
    this.name = 'UniSopSseError';
  }
}

export interface UniSopParsedFrame {
  /** 원문 그대로 — 보존 대상이다. */
  raw: unknown;
  /** 매핑된 이벤트. `__thinking__`·`__error__`는 여기서 걸러진다. */
  event: UniSopEvent | null;
  /** `__error__`를 받았을 때의 사유. */
  providerError: string | null;
  terminated: boolean;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * `data:` 한 줄을 프레임으로 옮긴다.
 *
 * 모르는 이벤트 키는 **버리되 원문은 남긴다** — UNI가 새 이벤트를 추가했을 때
 * 파서가 죽으면 그때까지 받은 노드까지 잃는다. 스트리밍에서는 그 대가가
 * 너무 크다(설계 08 §1.11이 부분 결과를 화면에 즉시 쌓으라고 정했다).
 */
export function parseUniSopLine(line: string): UniSopParsedFrame {
  const trimmed = line.trim();
  if (trimmed === UNI_SOP_STREAM_TERMINATOR) {
    return { raw: trimmed, event: null, providerError: null, terminated: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new UniSopSseError('data 줄이 JSON이 아니다', line);
  }
  const rec = asRecord(parsed);
  if (!rec) throw new UniSopSseError('data 줄이 JSON 객체가 아니다', line);

  if ('__error__' in rec) {
    const detail = rec.__error__;
    return {
      raw: parsed,
      event: null,
      providerError: typeof detail === 'string' ? detail : JSON.stringify(detail),
      terminated: false,
    };
  }

  if ('__status__' in rec) {
    const s = String(rec.__status__);
    if (!(UNI_SOP_STATUSES as readonly string[]).includes(s)) {
      // 모르는 상태는 무시한다 — 진행 표시일 뿐 그래프에 영향이 없다.
      return { raw: parsed, event: null, providerError: null, terminated: false };
    }
    return {
      raw: parsed,
      event: { kind: 'status', status: s as UniSopStatus },
      providerError: null,
      terminated: false,
    };
  }

  if ('__thinking__' in rec) {
    // 사용자 화면에 표시하지 않는다(설계 08 §1.11). 원문에는 남는다.
    return {
      raw: parsed,
      event: { kind: 'thinking', text: String(rec.__thinking__ ?? '') },
      providerError: null,
      terminated: false,
    };
  }

  if ('__compn__' in rec) {
    const compn = asRecord(rec.__compn__);
    if (!compn) throw new UniSopSseError('__compn__이 객체가 아니다', line);
    return {
      raw: parsed,
      event: { kind: 'compn', raw: compn },
      providerError: null,
      terminated: false,
    };
  }

  if ('__sources__' in rec) {
    const list = Array.isArray(rec.__sources__) ? rec.__sources__ : [];
    const sources = list
      .map(asRecord)
      .filter((s): s is Record<string, unknown> => s !== null)
      .map((s) => ({
        documentId: String(s.doc_id ?? s.documentId ?? ''),
        chunkId:
          typeof s.chunk_id === 'string'
            ? s.chunk_id
            : typeof s.chunkId === 'string'
              ? s.chunkId
              : null,
      }))
      .filter((s) => s.documentId.length > 0);
    return {
      raw: parsed,
      event: { kind: 'sources', sources },
      providerError: null,
      terminated: false,
    };
  }

  if ('__done__' in rec) {
    const done = asRecord(rec.__done__);
    const count = done && typeof done.node_count === 'number' ? done.node_count : null;
    return {
      raw: parsed,
      event: { kind: 'done', nodeCount: count },
      providerError: null,
      terminated: false,
    };
  }

  // 모르는 키. 버리되 원문은 남는다.
  return { raw: parsed, event: null, providerError: null, terminated: false };
}

/** SSE 본문에서 `data:` 줄만 뽑는다. 주석(`:`)은 heartbeat로 보고 버린다. */
export function extractDataLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice('data:'.length).trim())
    .filter((l) => l.length > 0);
}
