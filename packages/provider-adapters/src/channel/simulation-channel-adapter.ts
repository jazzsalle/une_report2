import type { DispatchChannel } from '@une/domain';
import {
  isRetryableChannelError,
  type ChannelErrorCode,
  type ChannelProvider,
  type ChannelSendContext,
  type ChannelSendInput,
  type ChannelSendResult,
} from './channel-port';

/**
 * 시뮬레이션 채널 어댑터 (CC-270).
 *
 * **이것은 전파가 아니다.** 실제 SMS·이메일·푸시 계약이 OB-06으로 열려 있어
 * 아무 데도 보내지 않고 "보냈다"는 기록만 만든다. `isSimulated = true`가 그
 * 사실을 결과·로그·전파 상태에 실어 나른다.
 *
 * 시뮬레이션이 **성공만 하면 안 된다.** 재시도·백오프·dead letter가 실제로
 * 도는지 보려면 실패가 필요하고, 그 실패는 결정적이어야 테스트가 예측 가능하다.
 * 그래서 수신자 참조에 심는 시나리오 훅을 쓰되 **설정으로만 켠다**
 * (ADR-33 D19가 세운 규칙 — 운영자의 데이터가 실패를 지어내면 안 된다).
 *
 *   `.channel-down.`   일시 장애 → 재시도 대상
 *   `.channel-reject.` 채널 거절 → 재시도해도 같다(바로 dead letter)
 *   `.bad-address.`    주소 오류 → 재시도해도 같다
 */

let sequence = 0;

export interface SimulationChannelOptions {
  scenariosEnabled?: boolean;
  /** 발송 지연을 흉내 낸다. 테스트는 0을 쓴다. */
  latencyMs?: number;
}

export class SimulationChannelAdapter implements ChannelProvider {
  readonly adapterId: string;
  readonly isSimulated = true;

  private readonly scenariosEnabled: boolean;
  private readonly latencyMs: number;

  constructor(
    readonly channel: DispatchChannel,
    options: SimulationChannelOptions = {},
  ) {
    this.adapterId = `simulation-${channel.toLowerCase()}`;
    this.scenariosEnabled = options.scenariosEnabled === true;
    this.latencyMs = options.latencyMs ?? 0;
  }

  async send(input: ChannelSendInput, ctx: ChannelSendContext): Promise<ChannelSendResult> {
    const startedAt = Date.now();
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }

    const scenario = this.pickScenario(input.recipientRef);
    if (scenario) {
      return {
        ok: false,
        providerMessageId: null,
        error: {
          code: scenario,
          message: `시뮬레이션 실패 시나리오: ${scenario}`,
          retryable: isRetryableChannelError(scenario),
        },
        raw: {
          simulated: true,
          scenario,
          channel: this.channel,
          correlationId: ctx.correlationId,
        },
        latencyMs: Date.now() - startedAt,
      };
    }

    sequence += 1;
    return {
      ok: true,
      providerMessageId: `sim-${this.channel.toLowerCase()}-${sequence}`,
      error: null,
      raw: {
        // **성공 응답에도 시뮬레이션임을 적는다.** 나중에 이 줄을 보고
        // "전파됐다"고 읽으면 안 된다.
        simulated: true,
        channel: this.channel,
        idempotencyKey: input.idempotencyKey,
        // 본문은 남기지 않는다 — 상황 사실과 개인정보가 섞일 수 있다.
        bodyLength: input.body.length,
        correlationId: ctx.correlationId,
      },
      latencyMs: Date.now() - startedAt,
    };
  }

  private pickScenario(recipientRef: string): ChannelErrorCode | null {
    if (!this.scenariosEnabled) return null;
    if (recipientRef.includes('.channel-down.')) return 'CHANNEL_UNAVAILABLE';
    if (recipientRef.includes('.channel-reject.')) return 'CHANNEL_REJECTED';
    if (recipientRef.includes('.bad-address.')) return 'RECIPIENT_INVALID';
    return null;
  }
}

/**
 * 화면 안 알림 채널.
 *
 * **이것만 진짜다.** 바깥으로 나가지 않으므로 외부 계약이 필요 없다 — 수신자의
 * 알림함에 남기는 것이고, 그 저장은 호출부(워커)가 한다. 여기서는 "받았다"만
 * 답한다.
 */
export class SystemChannelAdapter implements ChannelProvider {
  readonly channel: DispatchChannel = 'SYSTEM';
  readonly adapterId = 'system-inapp';
  readonly isSimulated = false;

  async send(input: ChannelSendInput, ctx: ChannelSendContext): Promise<ChannelSendResult> {
    sequence += 1;
    return {
      ok: true,
      providerMessageId: `sys-${sequence}`,
      error: null,
      raw: {
        simulated: false,
        channel: 'SYSTEM',
        idempotencyKey: input.idempotencyKey,
        bodyLength: input.body.length,
        correlationId: ctx.correlationId,
      },
      latencyMs: 0,
    };
  }
}

export interface ChannelRegistryEnv {
  UNE_CHANNEL_SCENARIOS?: string;
  UNE_CHANNEL_LATENCY_MS?: string;
}

/**
 * 채널 묶음.
 *
 * 지금은 SYSTEM 하나만 진짜이고 셋은 시뮬레이션이다. 실제 계약이 오면
 * (OB-06) 여기서 어댑터만 갈아 끼운다 — 워커는 포트만 안다.
 */
export function createChannelRegistry(
  env: ChannelRegistryEnv,
): Map<DispatchChannel, ChannelProvider> {
  const scenariosEnabled = env.UNE_CHANNEL_SCENARIOS === 'true';
  const latencyMs = Number(env.UNE_CHANNEL_LATENCY_MS ?? '0');
  const options: SimulationChannelOptions = {
    scenariosEnabled,
    latencyMs: Number.isFinite(latencyMs) && latencyMs > 0 ? latencyMs : 0,
  };
  return new Map<DispatchChannel, ChannelProvider>([
    ['SYSTEM', new SystemChannelAdapter()],
    ['SMS', new SimulationChannelAdapter('SMS', options)],
    ['EMAIL', new SimulationChannelAdapter('EMAIL', options)],
    ['PUSH', new SimulationChannelAdapter('PUSH', options)],
  ]);
}
