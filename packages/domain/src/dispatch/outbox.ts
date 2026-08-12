import { sha256Hex } from '../canonical-json';

/**
 * Transactional Outbox와 전파 (CC-270).
 *
 * 설계 09 "Propagation Message" 상태표, 설계 10 UNE-TASK-003/013/014.
 *
 * **비협상 규칙**: 상태변경·Execution Event·Outbox insert는 하나의 트랜잭션이다.
 * 그래서 API는 "보낸다"가 아니라 "보내기로 했다"를 커밋하고, 실제 발송은 워커가
 * 그 줄을 읽어서 한다 — 외부 호출이 트랜잭션 안에서 돌지 않는다.
 */

/**
 * 채널.
 *
 * `SYSTEM`은 화면 안 알림이라 시뮬레이션이 아니라 진짜다. 나머지 셋은 실제
 * 계약이 없어(OB-06) 시뮬레이션으로 동작한다 — **보냈다고 기록하지만 실제로는
 * 아무 데도 가지 않는다.**
 */
export const DISPATCH_CHANNELS = ['SYSTEM', 'SMS', 'EMAIL', 'PUSH'] as const;
export type DispatchChannel = (typeof DISPATCH_CHANNELS)[number];

export function isDispatchChannel(v: unknown): v is DispatchChannel {
  return (DISPATCH_CHANNELS as readonly unknown[]).includes(v);
}

/** 실제로 바깥으로 나가는 채널인가. 지금은 SYSTEM뿐이다. */
export function isRealChannel(channel: DispatchChannel): boolean {
  return channel === 'SYSTEM';
}

/**
 * Outbox 한 줄의 상태.
 *
 * `CANCELLED`는 전파 취소 경로가 생길 때 온다(0022 §1).
 */
export const OUTBOX_STATUSES = ['PENDING', 'SENDING', 'SENT', 'FAILED', 'DEAD_LETTER'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

const OUTBOX_TRANSITIONS: Record<OutboxStatus, readonly OutboxStatus[]> = {
  PENDING: ['SENDING'],
  // 크래시하면 리스가 만료돼 다시 집힌다 — SENDING → SENDING이 아니라
  // 클레임이 다시 일어나는 것이다.
  SENDING: ['SENT', 'FAILED', 'DEAD_LETTER'],
  FAILED: ['SENDING'],
  SENT: [],
  DEAD_LETTER: [],
};

export function canTransitionOutbox(from: string, to: string): boolean {
  return (OUTBOX_TRANSITIONS[from as OutboxStatus] ?? []).includes(to as OutboxStatus);
}

export function isOutboxSettled(status: string): boolean {
  return status === 'SENT' || status === 'DEAD_LETTER';
}

/** 발송 시도 하나의 결과. */
export const OUTBOX_ATTEMPT_RESULTS = ['SUCCESS', 'RETRY', 'FAIL'] as const;
export type OutboxAttemptResult = (typeof OUTBOX_ATTEMPT_RESULTS)[number];

/**
 * 재시도 정책.
 *
 * 지수 백오프에 상한을 둔다. 상한이 없으면 한 번 막힌 채널이 몇 시간 뒤에나
 * 다시 시도되고, 그 사이 재난 상황이 끝난다.
 *
 * **지터를 넣는다.** 같은 순간 실패한 수백 건이 같은 순간 다시 몰리면 채널이
 * 두 번째로 무너진다. 결정적 지터를 쓰는 이유는 테스트가 예측 가능해야 하기
 * 때문이다 — Outbox id로 흩는다.
 */
export const OUTBOX_MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;
const JITTER_RATIO = 0.2;

export function nextAttemptDelayMs(attemptNo: number, seed: string): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attemptNo - 1), MAX_DELAY_MS);
  // seed 한 글자에서 0..1을 뽑는다. 정확한 분포가 목적이 아니라 몰림을 푸는
  // 것이 목적이다.
  const bucket = Number.parseInt(sha256Hex(seed).slice(0, 4), 16) / 0xffff;
  const jitter = exponential * JITTER_RATIO * (bucket - 0.5) * 2;
  return Math.max(BASE_DELAY_MS, Math.round(exponential + jitter));
}

/** 시도를 다 썼는가 — 그러면 사람이 봐야 한다(dead letter). */
export function isExhausted(attemptNo: number): boolean {
  return attemptNo >= OUTBOX_MAX_ATTEMPTS;
}

/**
 * 발송 결과 → 다음 상태.
 *
 * 재시도해도 같은 답이 오는 실패(주소 형식 오류 등)를 다시 던지는 것은 채널
 * 부하만 만든다. 그래서 어댑터가 `retryable`을 말하고 여기서 판단한다.
 */
export function nextOutboxState(input: { attemptNo: number; ok: boolean; retryable: boolean }): {
  status: OutboxStatus;
  result: OutboxAttemptResult;
  scheduleRetry: boolean;
} {
  if (input.ok) return { status: 'SENT', result: 'SUCCESS', scheduleRetry: false };
  if (!input.retryable) return { status: 'DEAD_LETTER', result: 'FAIL', scheduleRetry: false };
  if (isExhausted(input.attemptNo)) {
    return { status: 'DEAD_LETTER', result: 'FAIL', scheduleRetry: false };
  }
  return { status: 'FAILED', result: 'RETRY', scheduleRetry: true };
}

/**
 * 전파 전체 상태 = 수신자 상태의 합.
 *
 * 부분 실패를 `FAILED`로 뭉개지 않는다 — 절반이 받았는데 "실패"로 보이면
 * 운영자가 전부 다시 보내고, 받은 사람은 같은 지시를 두 번 받는다.
 */
export const DISPATCH_STATUSES = ['PENDING', 'SENDING', 'SENT', 'PARTIAL', 'FAILED'] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export const RECIPIENT_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export function rollUpDispatchStatus(recipients: readonly RecipientStatus[]): DispatchStatus {
  if (recipients.length === 0) return 'PENDING';
  const sent = recipients.filter((r) => r === 'SENT').length;
  const failed = recipients.filter((r) => r === 'FAILED').length;
  const pending = recipients.length - sent - failed;

  if (pending === recipients.length) return 'PENDING';
  if (sent === recipients.length) return 'SENT';
  if (failed === recipients.length) return 'FAILED';
  // 아직 진행 중인 것이 남았으면 결론을 내지 않는다 — 지금 PARTIAL이라고
  // 말하면 남은 것이 성공했을 때 그 말이 틀린 것이 된다.
  if (pending > 0) return 'SENDING';
  return 'PARTIAL';
}

/**
 * 중복 억제 키.
 *
 * 같은 전파를 두 번 접수해도 채널당 한 줄만 남는다. 키에 **수신자와 채널**을
 * 넣는 이유: 한 전파가 여러 수신자·채널로 갈라지므로, 전파 단위 키로는 두
 * 번째 수신자가 첫 번째와 충돌한다.
 */
export function outboxIdempotencyKey(input: {
  dispatchId: string;
  recipientId: string;
  channel: DispatchChannel;
}): string {
  return sha256Hex(`${input.dispatchId}|${input.recipientId}|${input.channel}`);
}

/**
 * 전파 종류 (설계 10).
 *
 * `TASK`와 `TASK_NOTICE`를 나눈 이유가 있다. 릴레이는 전파가 성공하면 그
 * 전파가 가리키는 임무를 `SENT`로 올리는데(`markTaskSent`), 그것은 **임무
 * 지시가 나갔다**는 뜻일 때만 참이다. 수행 알림(수행불가·반려·재배정)이 같은
 * 종류를 쓰면 지시가 한 번도 나가지 않은 임무가 "전파됨"으로 보인다 — 게다가
 * 그 전이는 상태기계를 거치지 않아 이벤트도 남기지 않는다(0039 §1).
 */
export const DISPATCH_MESSAGE_TYPES = ['SITUATION', 'TASK', 'TASK_NOTICE', 'ESCALATION'] as const;
export type DispatchMessageType = (typeof DISPATCH_MESSAGE_TYPES)[number];

export function isDispatchMessageType(v: unknown): v is DispatchMessageType {
  return (DISPATCH_MESSAGE_TYPES as readonly unknown[]).includes(v);
}

/**
 * 이 전파가 나가면 임무가 "전파됨"이 되는가.
 *
 * 임무 지시(UNE-TASK-003)뿐이다. 알림과 Escalation은 같은 임무를 가리키지만
 * 임무 상태를 움직이지 않는다.
 */
export function advancesTaskToSent(messageType: string): boolean {
  return messageType === 'TASK';
}
