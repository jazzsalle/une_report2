import type {
  UniSopCallContext,
  UniSopError,
  UniSopEvent,
  UniSopProvider,
  UniSopRequest,
  UniSopResult,
  UniSopResultMeta,
} from './uni-sop-port';
import { parseUniSopLine, UniSopSseError } from './uni-sop-sse.assumed';

/**
 * UNI `/chat/json` SOP 생성 HTTP 어댑터 (CC-240).
 *
 * **provider 미검증이다.** 경로(`/chat/json`)와 이벤트 이름은 설계 08 §1.8/§1.11이
 * 적었지만 **프레이밍은 UNE 가정**이고(OB-04) 요청 본문 스키마는
 * `additionalProperties: true`뿐이다. capability는 `UNE_ADAPTER_READY`에
 * 머문다(레지스트리·ADR-38 D17이 정본이다) — 어댑터가 있다는 것과 UNI가
 * 지원한다는 것은 다른 말이고, 실 UNI에 대고 한 번도 성공한 적이 없다.
 *
 * 설계 08 §1.8이 `/chat/json`을 "인증 없음 B2B, 외부노출 금지"로 적었으므로
 * 토큰을 붙이지 않는다. 그 대신 **이 어댑터는 워커에서만 산다** — API가 직접
 * 부르면 인증 없는 엔드포인트가 사용자 요청 경로에 노출된다.
 */

export interface HttpUniSopConfig {
  baseUrl: string;
  /** 설계 08 §1.14: 첫 이벤트 30초. */
  firstEventTimeoutMs: number;
  /** 설계 08 §1.14: 전체 5분. */
  totalTimeoutMs: number;
  /** 요청 본문의 질의 필드명. 계약이 없으므로 설정으로 연다(OB-04). */
  queryField: string;
  /** 요청 본문의 문서범위 필드명. */
  documentIdsField: string;
}

export const DEFAULT_UNI_SOP_FIELDS = {
  queryField: 'query',
  documentIdsField: 'doc_ids',
} as const;

interface StreamOutcome {
  events: UniSopEvent[];
  frames: unknown[];
  providerError: string | null;
  sawDone: boolean;
  terminated: boolean;
}

function compnCount(events: UniSopEvent[]): number {
  return events.filter((e) => e.kind === 'compn').length;
}

/** 지식문서 어댑터와 같은 형태 — 테스트가 전역 fetch를 갈아끼우지 않는다. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpUniSopAdapter implements UniSopProvider {
  readonly adapterId = 'http-uni-sop';
  readonly mappingVersion = 'uni-sop-1';
  readonly isMock = false;

  constructor(
    private readonly config: HttpUniSopConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
  ) {}

  async generateSop(input: UniSopRequest, ctx: UniSopCallContext): Promise<UniSopResult> {
    const startedAt = Date.now();
    const raw = {
      requestSummary: {
        // 프롬프트 본문은 남기지 않는다 — 상황 사실(개인정보 포함 가능)이다.
        promptLength: input.prompt.length,
        snapshotId: input.snapshotId,
        evidenceSetId: input.evidenceSetId,
        schemaVersion: input.schemaVersion,
        documentIds: input.documentIds,
        correlationId: ctx.correlationId,
        endpoint: `${this.config.baseUrl}/chat/json`,
      },
      frames: [] as unknown[],
    };
    const meta = (eventCount: number): UniSopResultMeta => ({
      adapterId: this.adapterId,
      mappingVersion: this.mappingVersion,
      latencyMs: Date.now() - startedAt,
      eventCount,
    });
    const fail = (error: UniSopError, eventCount: number): UniSopResult => ({
      ok: false,
      error,
      meta: meta(eventCount),
      raw,
    });

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}/chat/json`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({
          [this.config.queryField]: input.prompt,
          [this.config.documentIdsField]: input.documentIds,
        }),
        // 전체 상한만 신호로 건다. 첫 이벤트 지연은 스트림을 읽으면서 잰다 —
        // 하나의 AbortSignal로는 그 둘을 구분할 수 없다.
        signal: AbortSignal.timeout(this.config.totalTimeoutMs),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const timedOut = /timeout|abort/i.test(message);
      return fail(
        {
          code: timedOut ? 'UNI_SOP_TIMEOUT' : 'UNI_SOP_CONNECTION_ERROR',
          message,
          retryable: true,
          partialNodeCount: 0,
        },
        0,
      );
    }

    if (!response.ok) {
      return fail(
        {
          code: response.status >= 500 ? 'UNI_SOP_PROVIDER_ERROR' : 'UNI_SOP_REQUEST_REJECTED',
          message: `UNI /chat/json ${response.status}`,
          // 4xx를 재시도해도 같은 답이 온다.
          retryable: response.status >= 500,
          partialNodeCount: 0,
        },
        0,
      );
    }
    if (!response.body) {
      return fail(
        {
          code: 'UNI_SOP_MALFORMED_STREAM',
          message: '응답 본문이 없습니다.',
          retryable: false,
          partialNodeCount: 0,
        },
        0,
      );
    }

    let outcome: StreamOutcome;
    try {
      outcome = await this.readStream(response.body, raw.frames, startedAt);
    } catch (err) {
      if (err instanceof UniSopSseError) {
        return fail(
          {
            code: 'UNI_SOP_MALFORMED_STREAM',
            message: err.message,
            retryable: false,
            // 프레이밍이 깨지기 전까지 받은 프레임은 raw에 남아 있다.
            partialNodeCount: 0,
          },
          0,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      return fail(
        {
          code: /timeout|abort/i.test(message) ? 'UNI_SOP_TIMEOUT' : 'UNI_SOP_CONNECTION_ERROR',
          message,
          retryable: true,
          partialNodeCount: 0,
        },
        0,
      );
    }

    const count = compnCount(outcome.events);
    if (outcome.providerError !== null) {
      return fail(
        {
          code: 'UNI_SOP_PROVIDER_REPORTED',
          message: outcome.providerError,
          retryable: true,
          partialNodeCount: count,
        },
        outcome.events.length,
      );
    }
    // 종결 규칙: `__done__` 없이 끝난 스트림은 부분 결과가 아니라 오류다.
    if (!outcome.sawDone || !outcome.terminated) {
      return fail(
        {
          code: 'UNI_SOP_UNTERMINATED',
          message: '__done__ 없이 스트림이 끝났습니다.',
          retryable: true,
          partialNodeCount: count,
        },
        outcome.events.length,
      );
    }

    return { ok: true, events: outcome.events, meta: meta(outcome.events.length), raw };
  }

  /**
   * SSE 본문을 읽는다.
   *
   * 본문 전체를 모은 뒤 자르지 않고 줄 단위로 흘린다 — 첫 이벤트 지연을 재려면
   * "언제 첫 줄이 왔는가"를 알아야 하고, 그것은 다 받은 뒤에는 알 수 없다.
   */
  private async readStream(
    body: ReadableStream<Uint8Array>,
    frames: unknown[],
    startedAt: number,
  ): Promise<StreamOutcome> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const events: UniSopEvent[] = [];
    let buffer = '';
    let providerError: string | null = null;
    let sawDone = false;
    let terminated = false;
    let sawAnyEvent = false;

    /**
     * 첫 프레임을 기다리는 동안에만 거는 데드라인.
     *
     * 처음에는 루프 **끝**에서 경과 시간을 재는 형태였는데, UNI가 200 헤더만
     * 열고 한 바이트도 보내지 않으면 `reader.read()`가 그대로 블록되어 그
     * 검사가 **한 번도 실행되지 않았다** — 실제 상한이 전체 예산(5분)이 되어
     * 설계 08 §1.14가 정한 30초의 10배 동안 워커 슬롯과 잡 리스가 묶인다.
     * 이제 read와 타이머를 경주시킨다.
     */
    const readWithFirstEventDeadline = async (): Promise<{ done: boolean; value?: Uint8Array }> => {
      if (sawAnyEvent) return reader.read();
      const remaining = this.config.firstEventTimeoutMs - (Date.now() - startedAt);
      if (remaining <= 0)
        throw new Error(`첫 이벤트 timeout (${this.config.firstEventTimeoutMs}ms)`);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`첫 이벤트 timeout (${this.config.firstEventTimeoutMs}ms)`)),
              remaining,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    /** 한 줄을 처리한다. 스트림이 닫혔으면 true. */
    const consume = (line: string): boolean => {
      if (!line.startsWith('data:')) return false;
      const payload = line.slice('data:'.length).trim();
      if (payload.length === 0) return false;

      const frame = parseUniSopLine(payload);
      frames.push(frame.raw);
      sawAnyEvent = true;
      if (frame.providerError !== null) {
        providerError = frame.providerError;
        return false;
      }
      if (frame.terminated) {
        terminated = true;
        return true;
      }
      if (frame.event) {
        if (frame.event.kind === 'done') sawDone = true;
        events.push(frame.event);
      }
      return false;
    };

    try {
      for (;;) {
        const { done, value } = await readWithFirstEventDeadline();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trimEnd();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
          if (consume(line)) return { events, frames, providerError, sawDone, terminated };
        }
      }
      // **남은 버퍼를 흘려보낸다.** 마지막 줄에 개행이 없으면
      // (`data: [DONE]`으로 끝나는 스트림이 흔하다) 여기서 처리하지 않는 한
      // 정상 종료가 `UNI_SOP_UNTERMINATED`로 뒤집힌다. mock은 줄 단위로
      // 잘라 넣으므로 이 층을 통과하지 않아 드러나지 않았다.
      const tail = buffer.trimEnd();
      if (tail.length > 0) consume(tail);
    } finally {
      await reader.cancel().catch(() => undefined);
    }

    return { events, frames, providerError, sawDone, terminated };
  }
}
