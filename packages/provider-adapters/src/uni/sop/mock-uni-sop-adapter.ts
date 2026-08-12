import type {
  UniSopCallContext,
  UniSopEvent,
  UniSopProvider,
  UniSopRequest,
  UniSopResult,
} from './uni-sop-port';
import { extractDataLines, parseUniSopLine } from './uni-sop-sse.assumed';

/**
 * UNI SOP 생성 mock 어댑터 (CC-240).
 *
 * **이것은 UNI 지원이 아니다.** capability는 OB-04에 묶여 있고 어떤 로그도
 * 이것을 실 연동으로 보고하지 않는다.
 *
 * mock이 **가짜 SSE 본문을 만들어 실제 파서에 통과시킨다.** 이벤트 객체를
 * 곧장 돌려주면 `.assumed` 프레이밍 가정이 한 번도 실행되지 않아, 그 가정이
 * 틀렸을 때 실 연동 시점까지 드러나지 않는다. T3Q mock이 같은 형태다.
 *
 * 시나리오(설정으로 켤 때만):
 *   `.sop-error.`      __error__를 보낸다 — 부분 결과가 이미 쌓인 뒤다
 *   `.sop-truncated.`  __done__ 없이 끊긴다 (종결 규칙 검증)
 *   `.sop-malformed.`  깨진 노드를 섞는다 (매퍼 거부 경로)
 *   `.sop-after-end.`  END 뒤에 노드를 더 보낸다 (전체 검증 경로)
 *   `.sop-dup-key.`    같은 키로 접히는 compnSn 둘 (유니크 제약 경로)
 *   `.sop-out-of-scope.` 요청 범위 밖 문서를 근거로 든다 (범위 이탈 검출)
 */

let instanceSeq = 0;

export class MockUniSopAdapter implements UniSopProvider {
  readonly adapterId = 'mock-uni-sop';
  readonly mappingVersion = 'mock-1';
  readonly isMock = true;

  private readonly scenariosEnabled: boolean;
  private readonly prefix: string;

  constructor(opts: { scenariosEnabled?: boolean } = {}) {
    instanceSeq += 1;
    this.prefix = `N${instanceSeq}`;
    this.scenariosEnabled = opts.scenariosEnabled === true;
  }

  private scenario(prompt: string, token: string): boolean {
    return this.scenariosEnabled && prompt.includes(token);
  }

  /** 설계 08 §1.11의 순서를 그대로 재현한 SSE 본문. */
  private buildStream(input: UniSopRequest): string {
    const n = (k: string): string => `${this.prefix}-${k}`;
    // **요청한 범위 안에서 인용한다.** 고정 id를 돌려주면 호출부가 범위
    // 이탈 검출을 시험할 수 없고, 정상 경로가 전부 '범위 밖'으로 보인다
    // (워커 e2e를 쓰다가 실제로 그렇게 나왔다).
    const doc = input.documentIds[0] ?? 'uni-doc-1';
    const lines: string[] = [
      `data: {"__status__":"searching"}`,
      `data: {"__status__":"reranking"}`,
      `data: {"__thinking__":"근거를 정리하는 중"}`,
      `data: {"__status__":"generating"}`,
      `data: {"__sources__":[{"doc_id":"${doc}","chunk_id":"c1"}]}`,
      `data: {"__compn__":{"compnSn":"${n('s')}","type":"START","name":"상황 접수","source":["${doc}"]}}`,
    ];

    if (this.scenario(input.prompt, '.sop-malformed.')) {
      // 노드 키가 없다 — 매퍼가 거부해야 한다. 스트림은 계속된다.
      lines.push(`data: {"__compn__":{"type":"ACTION","name":"키 없는 노드"}}`);
    }

    if (this.scenario(input.prompt, '.sop-dup-key.')) {
      // `"3"`과 `"#3"`은 정규화하면 둘 다 `n3`가 된다. 해소하지 않으면
      // `uk_sop_node_key`가 23505를 던져 **트랜잭션 전체가** 되돌아간다.
      lines.push(
        `data: {"__compn__":{"compnSn":"3","type":"ACTION","name":"첫째","task":["ㄱ"],"source":["${doc}"]}}`,
      );
      lines.push(
        `data: {"__compn__":{"compnSn":"#3","type":"ACTION","name":"둘째","task":["ㄴ"],"source":["${doc}"]}}`,
      );
    }

    if (this.scenario(input.prompt, '.sop-out-of-scope.')) {
      // 요청 범위(doc_ids)에 없는 문서를 근거로 든다 — UNI가 범위를 무시한
      // 경우다. 거부하지 않고 표시해야 한다.
      lines.push(
        `data: {"__compn__":{"compnSn":"${n('x')}","type":"ACTION","name":"범위 밖 근거",` +
          `"task":["무언가"],"source":["uni-doc-없는것"]}}`,
      );
    }

    lines.push(
      `data: {"__compn__":{"compnSn":"${n('a')}","type":"ACTION","name":"대피 안내 방송",` +
        `"task":["방송 송출","수신 확인"],"source":["${doc}"]}}`,
    );

    if (this.scenario(input.prompt, '.sop-error.')) {
      lines.push(`data: {"__error__":"mock: 생성 실패 시나리오"}`);
      lines.push(`data: ${'[DONE]'}`);
      return lines.join('\n');
    }

    lines.push(
      `data: {"__compn__":{"compnSn":"${n('e')}","type":"END","name":"종료","source":["${doc}"]}}`,
    );

    if (this.scenario(input.prompt, '.sop-after-end.')) {
      // END 뒤에 노드가 하나 더 온다. 순차 연결이 END를 통과해 버리는데,
      // DAG는 성립하므로 CYCLE·NO_END에 걸리지 않는다 — EDGE_FROM_END가 잡는다.
      lines.push(
        `data: {"__compn__":{"compnSn":"${n('loop')}","type":"ACTION","name":"되돌아감",` +
          `"task":["다시"],"source":["${doc}"]}}`,
      );
    }

    if (this.scenario(input.prompt, '.sop-truncated.')) {
      // __done__ 없이 끝난다. 종결 규칙이 이것을 오류로 봐야 한다.
      return lines.join('\n');
    }

    lines.push(`data: {"__done__":{"node_count":3}}`);
    lines.push(`data: ${'[DONE]'}`);
    return lines.join('\n');
  }

  async generateSop(input: UniSopRequest, ctx: UniSopCallContext): Promise<UniSopResult> {
    const body = this.buildStream(input);
    const raw = {
      requestSummary: {
        snapshotId: input.snapshotId,
        evidenceSetId: input.evidenceSetId,
        schemaVersion: input.schemaVersion,
        documentIds: input.documentIds,
        promptLength: input.prompt.length,
        correlationId: ctx.correlationId,
      },
      frames: [] as unknown[],
    };

    const events: UniSopEvent[] = [];
    let terminated = false;
    let providerError: string | null = null;
    let sawDone = false;

    for (const line of extractDataLines(body)) {
      const frame = parseUniSopLine(line);
      raw.frames.push(frame.raw);
      if (frame.providerError !== null) {
        providerError = frame.providerError;
        continue;
      }
      if (frame.terminated) {
        terminated = true;
        break;
      }
      if (frame.event) {
        if (frame.event.kind === 'done') sawDone = true;
        events.push(frame.event);
      }
    }

    const compnCount = events.filter((e) => e.kind === 'compn').length;
    const meta = {
      adapterId: this.adapterId,
      mappingVersion: this.mappingVersion,
      latencyMs: 0,
      eventCount: events.length,
    };

    if (providerError !== null) {
      return {
        ok: false,
        error: {
          code: 'UNI_SOP_PROVIDER_REPORTED',
          message: providerError,
          retryable: true,
          partialNodeCount: compnCount,
        },
        meta,
        raw,
      };
    }

    // 종결 규칙: `__done__` 없이 끝난 스트림은 부분 결과가 아니라 오류다.
    if (!sawDone || !terminated) {
      return {
        ok: false,
        error: {
          code: 'UNI_SOP_UNTERMINATED',
          message: '__done__ 없이 스트림이 끝났다',
          retryable: true,
          partialNodeCount: compnCount,
        },
        meta,
        raw,
      };
    }

    return { ok: true, events, meta, raw };
  }
}
