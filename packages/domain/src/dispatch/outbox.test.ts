import { describe, expect, it } from 'vitest';
import {
  canTransitionOutbox,
  DISPATCH_CHANNELS,
  isExhausted,
  isOutboxSettled,
  isRealChannel,
  nextAttemptDelayMs,
  nextOutboxState,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_STATUSES,
  outboxIdempotencyKey,
  RECIPIENT_STATUSES,
  rollUpDispatchStatus,
  type RecipientStatus,
} from './outbox';

describe('채널', () => {
  it('넷이다', () => {
    expect([...DISPATCH_CHANNELS]).toEqual(['SYSTEM', 'SMS', 'EMAIL', 'PUSH']);
  });

  it('실제로 나가는 것은 SYSTEM뿐이다 (나머지는 계약이 없다 — OB-06)', () => {
    expect(isRealChannel('SYSTEM')).toBe(true);
    for (const channel of ['SMS', 'EMAIL', 'PUSH'] as const) {
      expect(isRealChannel(channel), channel).toBe(false);
    }
  });
});

describe('Outbox 상태 전이', () => {
  it('CANCELLED는 아직 없다 (취소 경로가 없다)', () => {
    expect([...OUTBOX_STATUSES]).toEqual(['PENDING', 'SENDING', 'SENT', 'FAILED', 'DEAD_LETTER']);
  });

  it('PENDING → SENDING → SENT', () => {
    expect(canTransitionOutbox('PENDING', 'SENDING')).toBe(true);
    expect(canTransitionOutbox('SENDING', 'SENT')).toBe(true);
  });

  it('실패는 다시 집힌다', () => {
    expect(canTransitionOutbox('SENDING', 'FAILED')).toBe(true);
    expect(canTransitionOutbox('FAILED', 'SENDING')).toBe(true);
  });

  it('끝난 줄은 되돌아가지 않는다', () => {
    for (const to of OUTBOX_STATUSES) {
      expect(canTransitionOutbox('SENT', to), `SENT->${to}`).toBe(false);
      expect(canTransitionOutbox('DEAD_LETTER', to), `DEAD->${to}`).toBe(false);
    }
    expect(isOutboxSettled('SENT')).toBe(true);
    expect(isOutboxSettled('DEAD_LETTER')).toBe(true);
    expect(isOutboxSettled('FAILED')).toBe(false);
  });

  it('보내기도 전에 성공할 수 없다', () => {
    expect(canTransitionOutbox('PENDING', 'SENT')).toBe(false);
  });
});

describe('재시도 판단', () => {
  it('성공하면 끝이다', () => {
    expect(nextOutboxState({ attemptNo: 1, ok: true, retryable: false })).toEqual({
      status: 'SENT',
      result: 'SUCCESS',
      scheduleRetry: false,
    });
  });

  it('재시도해도 같은 실패는 바로 dead letter다', () => {
    // 주소 형식 오류 같은 것을 다시 던지는 것은 채널 부하만 만든다.
    expect(nextOutboxState({ attemptNo: 1, ok: false, retryable: false })).toEqual({
      status: 'DEAD_LETTER',
      result: 'FAIL',
      scheduleRetry: false,
    });
  });

  it('일시 실패는 다시 예약한다', () => {
    expect(nextOutboxState({ attemptNo: 2, ok: false, retryable: true })).toEqual({
      status: 'FAILED',
      result: 'RETRY',
      scheduleRetry: true,
    });
  });

  it('시도를 다 쓰면 사람이 봐야 한다', () => {
    expect(isExhausted(OUTBOX_MAX_ATTEMPTS)).toBe(true);
    expect(nextOutboxState({ attemptNo: OUTBOX_MAX_ATTEMPTS, ok: false, retryable: true })).toEqual(
      { status: 'DEAD_LETTER', result: 'FAIL', scheduleRetry: false },
    );
  });
});

describe('백오프', () => {
  it('시도가 늘수록 길어진다', () => {
    const a = nextAttemptDelayMs(1, 'x');
    const b = nextAttemptDelayMs(3, 'x');
    expect(b).toBeGreaterThan(a);
  });

  it('상한이 있다 (막힌 채널을 몇 시간 뒤에 다시 보지 않는다)', () => {
    // 상한이 없으면 그 사이 재난 상황이 끝난다.
    expect(nextAttemptDelayMs(20, 'x')).toBeLessThanOrEqual(6 * 60_000);
  });

  it('같은 순간 실패한 것들이 같은 순간 몰리지 않는다', () => {
    // 지터가 없으면 채널이 두 번째로 무너진다.
    const delays = new Set(['a', 'b', 'c', 'd', 'e'].map((seed) => nextAttemptDelayMs(3, seed)));
    expect(delays.size).toBeGreaterThan(1);
  });

  it('같은 줄은 늘 같은 값이다 (테스트가 예측 가능해야 한다)', () => {
    expect(nextAttemptDelayMs(3, 'same')).toBe(nextAttemptDelayMs(3, 'same'));
  });
});

describe('전파 상태 = 수신자 상태의 합', () => {
  const roll = (...statuses: RecipientStatus[]) => rollUpDispatchStatus(statuses);

  it('수신자 어휘에 DELIVERED가 없다 (수신영수증이 없다 — OB-06)', () => {
    expect([...RECIPIENT_STATUSES]).toEqual(['PENDING', 'SENT', 'FAILED']);
  });

  it('전부 성공이면 SENT', () => {
    expect(roll('SENT', 'SENT')).toBe('SENT');
  });

  it('전부 실패면 FAILED', () => {
    expect(roll('FAILED', 'FAILED')).toBe('FAILED');
  });

  it('끝난 것들이 갈리면 PARTIAL', () => {
    // 절반이 받았는데 "실패"로 보이면 운영자가 전부 다시 보내고, 받은 사람은
    // 같은 지시를 두 번 받는다.
    expect(roll('SENT', 'FAILED')).toBe('PARTIAL');
  });

  it('아직 남았으면 결론을 내지 않는다', () => {
    // 지금 PARTIAL이라고 말하면 남은 것이 성공했을 때 그 말이 틀린 것이 된다.
    expect(roll('SENT', 'FAILED', 'PENDING')).toBe('SENDING');
    expect(roll('SENT', 'PENDING')).toBe('SENDING');
  });

  it('아무도 시작하지 않았으면 PENDING', () => {
    expect(roll('PENDING', 'PENDING')).toBe('PENDING');
    expect(rollUpDispatchStatus([])).toBe('PENDING');
  });
});

describe('중복 억제 키', () => {
  it('수신자와 채널이 다르면 다른 키다', () => {
    const base = { dispatchId: 'd1', recipientId: 'r1', channel: 'SMS' } as const;
    expect(outboxIdempotencyKey(base)).not.toBe(
      outboxIdempotencyKey({ ...base, recipientId: 'r2' }),
    );
    expect(outboxIdempotencyKey(base)).not.toBe(
      outboxIdempotencyKey({ ...base, channel: 'EMAIL' }),
    );
  });

  it('같은 전파·수신자·채널이면 같은 키다', () => {
    const key = { dispatchId: 'd1', recipientId: 'r1', channel: 'SMS' } as const;
    expect(outboxIdempotencyKey(key)).toBe(outboxIdempotencyKey(key));
  });
});
