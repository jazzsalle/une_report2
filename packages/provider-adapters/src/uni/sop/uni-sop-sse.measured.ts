import type { UniSopEvent, UniSopStatus } from './uni-sop-port';
import { UNI_SOP_STATUSES } from './uni-sop-port';

/**
 * UNI `/chat/json` SSE 프레이밍 — **실측 확인됨** (CC-240 가정 → CC-410 확인).
 *
 * CC-240에서는 이것이 전부 UNE 가정이었다(`uni-sop-sse.assumed.ts`). 설계 08
 * §1.11이 정한 것은 이벤트 **이름뿐**이었고, 그 이름들이 어떤 프레임에 담겨
 * 오는지는 어디에도 없었다 — OB-04 ①이 "이것이 틀리면 어댑터는 한 줄도 읽지
 * 못한다"고 적은 가장 앞선 차단이었다.
 *
 * **2026-08-14, 실 UNI 3표본으로 확인했다. 가정이 맞았다.** 그래서 파일 이름의
 * `.assumed` 표식을 뗀다(T3Q `target-v2-sse.assumed.ts`는 아직 가정이므로 그대로
 * 둔다 — 표식은 검증 상태를 말하는 것이지 장식이 아니다).
 *
 *   - `data:` 한 줄에 JSON 객체 하나                          ← 확인
 *   - 그 객체의 **키**가 이벤트 이름이다 (`{"__compn__": {...}}`) ← 확인
 *   - `[DONE]`은 `data: [DONE]` 리터럴로 스트림을 닫는다        ← 확인
 *   - `event:` 필드를 쓰지 않는다 (실측 0줄)                    ← 확인
 *   - `content-type: text/event-stream; charset=utf-8`         ← 확인
 *
 * 실측 이벤트 분포(표본 1): `__status__`×4, `__compn__`×6, `__sources__`×1,
 * `__done__`×1, `[DONE]`×1. 라이브 스펙의 `/chat/json` 설명문도 같은 형태를
 * 문서화하고 있다.
 *
 * **`id:`도 `retry:`도 하트비트도 없다(실측 0줄).** Last-Event-ID로 이어받을
 * 수단이 provider에 없다는 뜻이다 — 재접속은 전체 재생성뿐이다(ADR-50 수용 한계).
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
    // **실측 필드명은 `count`다 (CC-410).** `node_count`는 CC-240의 가정이었다.
    // 둘 다 받는다 — UNI가 이름을 되돌릴 이유는 없지만, 이 값은 "몇 개 보냈다고
    // 주장하는가"라서 못 읽으면 잘린 스트림을 잡을 수단이 사라진다.
    const count =
      done && typeof done.count === 'number'
        ? done.count
        : done && typeof done.node_count === 'number'
          ? done.node_count
          : null;
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
