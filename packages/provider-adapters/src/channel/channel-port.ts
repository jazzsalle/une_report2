import type { DispatchChannel } from '@une/domain';

/**
 * 전파 채널 포트 (CC-270).
 *
 * 설계 10 UNE-TASK-003, 마스터 §22.
 *
 * **실제 채널 계약이 없다**(OB-06: SMS·이메일·메신저·방송의 법적·운영 승인).
 * 그래서 `SYSTEM`(화면 안 알림)만 진짜이고 나머지는 시뮬레이션이다 — 보냈다고
 * 기록하지만 **아무 데도 가지 않는다.** 그 사실이 로그·capability·발송 결과에
 * 모두 드러나야 한다: 시뮬레이션 성공을 실제 도달로 보고하지 않는다.
 *
 * T3Q·UNI 포트와 같은 규약이다 — 실패는 예외가 아니라 결과값이고, 원문이
 * 실패와 함께 이동한다.
 */

export const CHANNEL_ERROR_CODES = [
  'CHANNEL_UNAVAILABLE', // 채널 자체가 응답하지 않는다
  'CHANNEL_TIMEOUT',
  'CHANNEL_REJECTED', // 채널이 거절했다(형식·정책) — 다시 보내도 같다
  'RECIPIENT_INVALID', // 주소가 잘못됐다 — 다시 보내도 같다
  'CHANNEL_NOT_CONFIGURED', // 실제 계약이 없다(OB-06)
  'SIMULATED_FAILURE', // 시뮬레이션 시나리오
] as const;
export type ChannelErrorCode = (typeof CHANNEL_ERROR_CODES)[number];

/**
 * 다시 보내면 달라질 수 있는가.
 *
 * 형식·주소 문제를 재시도하는 것은 채널 부하만 만들고 dead letter를 늦춘다.
 */
export function isRetryableChannelError(code: ChannelErrorCode): boolean {
  return code === 'CHANNEL_UNAVAILABLE' || code === 'CHANNEL_TIMEOUT';
}

export interface ChannelSendInput {
  channel: DispatchChannel;
  /** 수신자 식별자. **주소가 아니다** — 주소 저장은 OB-06 전까지 하지 않는다. */
  recipientRef: string;
  subject: string | null;
  body: string;
  /** 같은 메시지를 두 번 보내지 않기 위한 키. 채널이 지원하면 넘긴다. */
  idempotencyKey: string;
}

export interface ChannelSendContext {
  correlationId: string;
}

export interface ChannelSendResult {
  ok: boolean;
  /** 채널이 준 식별자. 시뮬레이션은 자기가 만든 값을 준다. */
  providerMessageId: string | null;
  error: { code: ChannelErrorCode; message: string; retryable: boolean } | null;
  /** 원문 응답. 실패에도 남는다 — 무엇을 받았기에 실패했는지의 유일한 단서다. */
  raw: Record<string, unknown>;
  latencyMs: number;
}

export interface ChannelProvider {
  readonly channel: DispatchChannel;
  readonly adapterId: string;
  /**
   * 이 채널이 시뮬레이션인가.
   *
   * **결과에 반드시 드러나야 한다.** 시뮬레이션 성공을 "전파했다"로 읽으면
   * 아무도 받지 않은 지시를 받았다고 여긴다.
   */
  readonly isSimulated: boolean;

  send(input: ChannelSendInput, ctx: ChannelSendContext): Promise<ChannelSendResult>;
}
