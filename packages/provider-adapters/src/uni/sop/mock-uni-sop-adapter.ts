import type {
  UniSopCallContext,
  UniSopEvent,
  UniSopProvider,
  UniSopRequest,
  UniSopResult,
} from './uni-sop-port';
import { extractDataLines, parseUniSopLine } from './uni-sop-sse.measured';

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
 *   `.sop-unknown-type.` 표에 없는 유형 코드 (거부하지 않고 ACTION으로 세운다)
 *
 * **`.sop-out-of-scope.`는 없앴다 (CC-410).** 실 UNI는 노드에 출처를 붙이지
 * 않고(`__sources__`가 스트림 전체에 한 번, 그나마 doc_id가 없다) 요청에
 * `doc_ids` 같은 범위 지정 필드 자체가 없다. 범위 이탈을 만들어 낼 수도, 검출할
 * 수도 없다 — 시나리오를 남겨 두면 **하지 못하는 검사를 하는 것처럼 보인다**.
 * 러너의 범위 대조 코드는 남겨 둔다(UNI가 출처를 붙이면 그날 살아난다).
 */

let instanceSeq = 0;

export class MockUniSopAdapter implements UniSopProvider {
  readonly adapterId = 'mock-uni-sop';
  readonly mappingVersion = 'mock-1';
  readonly isMock = true;

  private readonly scenariosEnabled: boolean;
  /**
   * 이 인스턴스의 `compnSn` 대역.
   *
   * **인스턴스에 고정한다.** 모듈 카운터를 생성 시점에 읽지 않고 스트림을 만들
   * 때 읽으면, mock을 둘 만든 뒤 먼저 만든 것을 쓸 때 뒤에 만든 것의 대역이
   * 나온다 — 두 mock이 같은 노드 키를 내고 `uk_sop_node_key`가 터진다.
   */
  private readonly snBase: number;

  constructor(opts: { scenariosEnabled?: boolean } = {}) {
    instanceSeq += 1;
    this.snBase = instanceSeq * 1000;
    this.scenariosEnabled = opts.scenariosEnabled === true;
  }

  private scenario(prompt: string, token: string): boolean {
    return this.scenariosEnabled && prompt.includes(token);
  }

  /**
   * 실 UNI 응답 모양을 그대로 재현한 SSE 본문 (CC-410에서 다시 씀).
   *
   * **CC-240의 mock은 설계 08 §1.11이 적은 필드명**(`type`/`name`/`task`/
   * `source`)**을 뿜었다.** 그 모양으로 매퍼 시험이 전부 통과했는데도 실 UNI에서는
   * 한 노드도 매핑되지 않았다 — mock이 실측과 다르면 e2e는 허구를 검증한다.
   * 아래는 2026-08-14 실측 3표본의 모양이다(`__fixtures__/uni-chat-json-sample*.sse`).
   *
   * 노드는 `compnSn` 음수 정수, 유형은 `compnTyCode`, 제목은 `compnSj`,
   * 임무는 `compnAttrbSaveParamsList`, 간선은 `endCompns`가 들고 온다.
   * 좌표·크기·색까지 싣는다 — 매퍼가 그것을 조용히 버리는지 보려면 있어야 한다.
   */
  private buildStream(input: UniSopRequest): string {
    // 실 UNI는 음수 임시 일련번호를 쓴다. 인스턴스마다 다른 대역을 써서
    // 여러 mock이 같은 키를 내지 않게 한다.
    const sn = (i: number): number => -(this.snBase + i);
    const layout = (x: number, y: number) =>
      `"compnCrdnt":{"x":${x},"y":${y}},"width":280,"hg":80,` +
      `"atmcProgrsYn":"N","charstSort":"","fontSize":0,"color":"","compnGroupSn":null`;
    const task = (i: number, sj: string, cn: string) =>
      `"compnAttrbSaveParamsList":[{"attrbSn":${sn(i)},"attrbSj":"${sj}","attrbCn":"${cn}",` +
      `"attrbRm":null,"dffTyCode":"000000","sortOrdr":1,"receiveOrgnztSns":[],"receiveUserSns":[]}]`;
    const edge = (to: number) =>
      `"endCompns":[{"compnSn":${sn(to)},"arrwCn":null,"beginArrwDrc":"bottom","endArrwDrc":"top"}]`;

    // **실 UNI의 `__sources__`에는 doc_id도 chunk_id도 없다** — `{filename,
    // score, text}` 셋뿐이다(실측). 그래서 노드↔근거를 이을 수 없고, 매퍼가
    // 전 노드에 `NO_SOURCE_REFS`를 세운다. mock이 doc_id를 넣어 주면 그
    // 사실이 가려진다.
    const lines: string[] = [
      `data: {"__status__":"searching"}`,
      `data: {"__status__":"reranking"}`,
      `data: {"__thinking__":"근거를 정리하는 중"}`,
      `data: {"__status__":"generating"}`,
      `data: {"__sources__":[{"filename":"mock-source.pdf","score":0.91,"text":"mock 근거 발췌"}]}`,
      `data: {"__compn__":{"compnSn":${sn(1)},${edge(2)},"compnTyCode":"104001",` +
        `"compnSj":"상황 접수",${layout(180, 40)},"compnAttrbSaveParamsList":[]}}`,
    ];

    if (this.scenario(input.prompt, '.sop-malformed.')) {
      // 노드 키가 없다 — 매퍼가 거부해야 한다. 스트림은 계속된다.
      lines.push(
        `data: {"__compn__":{"compnTyCode":"104003","compnSj":"키 없는 노드","endCompns":[]}}`,
      );
    }

    if (this.scenario(input.prompt, '.sop-dup-key.')) {
      // `3`과 `-3`은 정규화하면 둘 다 `n3`가 된다. 해소하지 않으면
      // `uk_sop_node_key`가 23505를 던져 **트랜잭션 전체가** 되돌아간다.
      lines.push(
        `data: {"__compn__":{"compnSn":3,"endCompns":[],"compnTyCode":"104003",` +
          `"compnSj":"첫째",${layout(180, 140)},${task(90, '첫째', 'ㄱ')}}}`,
      );
      lines.push(
        `data: {"__compn__":{"compnSn":-3,"endCompns":[],"compnTyCode":"104003",` +
          `"compnSj":"둘째",${layout(180, 240)},${task(91, '둘째', 'ㄴ')}}}`,
      );
    }

    if (this.scenario(input.prompt, '.sop-unknown-type.')) {
      // 표에 없는 유형 코드. 거부하지 않고 ACTION으로 세운 뒤 알려야 한다 —
      // UNI 유형 코드 표를 우리가 받지 못했으므로 처음 보는 코드가 정상이다.
      lines.push(
        `data: {"__compn__":{"compnSn":${sn(7)},"endCompns":[],"compnTyCode":"999999",` +
          `"compnSj":"모르는 유형",${layout(480, 140)},${task(92, '무언가', '수행')}}}`,
      );
    }

    lines.push(
      `data: {"__compn__":{"compnSn":${sn(2)},${edge(3)},"compnTyCode":"104003",` +
        `"compnSj":"대피 안내 방송",${layout(180, 140)},` +
        `${task(50, '대피 안내 방송', '방송을 송출하고 수신을 확인한다')}}}`,
    );

    if (this.scenario(input.prompt, '.sop-error.')) {
      lines.push(`data: {"__error__":"mock: 생성 실패 시나리오"}`);
      lines.push(`data: ${'[DONE]'}`);
      return lines.join('\n');
    }

    // **마지막 노드가 오지 않는 종료 노드를 가리킨다** — 실 UNI가 3표본 모두
    // 그랬다. 매퍼가 END를 세우고 `END_SYNTHESIZED`를 붙이는 경로가 여기다.
    lines.push(
      `data: {"__compn__":{"compnSn":${sn(3)},${edge(99)},"compnTyCode":"104003",` +
        `"compnSj":"사후 조치",${layout(180, 240)},` +
        `${task(51, '사후 조치', '피해를 확인하고 복구한다')}}}`,
    );

    if (this.scenario(input.prompt, '.sop-truncated.')) {
      // __done__ 없이 끝난다. 종결 규칙이 이것을 오류로 봐야 한다.
      return lines.join('\n');
    }

    // 실 UNI의 종료 이벤트는 `{filename, count}`다(`node_count`가 아니다).
    const emitted = lines.filter((l) => l.includes('__compn__')).length;
    lines.push(`data: {"__done__":{"filename":"mock_SOP.json","count":${emitted}}}`);
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
