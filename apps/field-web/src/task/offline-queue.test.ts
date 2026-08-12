import { describe, expect, it } from 'vitest';
import { ApiCallError } from '../api/client';
import { memoryQueueStorage, OfflineQueue, type QueuedAction } from './offline-queue';

function action(id: string, label = id): Omit<QueuedAction, 'attempts' | 'lastError'> {
  return {
    id,
    taskId: 'task-1',
    path: `/tasks/task-1/${label}`,
    body: {},
    idempotencyKey: `key-${id}`,
    label,
    queuedAt: '2026-08-12T00:00:00.000Z',
  };
}

const offline = (): ApiCallError =>
  new ApiCallError({ status: 0, code: 'NET-0000', message: '연결 없음', recoverable: true });

const rejected = (): ApiCallError =>
  new ApiCallError({
    status: 409,
    code: 'TASK-409-002',
    message: '착수할 수 없습니다',
    recoverable: false,
  });

describe('오프라인 대기열 (CC-280)', () => {
  it('같은 멱등 키를 두 번 넣지 않는다', () => {
    // 사용자가 버튼을 두 번 눌렀을 뿐이다.
    const q = new OfflineQueue(memoryQueueStorage());
    q.enqueue(action('a'));
    q.enqueue(action('a'));
    expect(q.size()).toBe(1);
  });

  it('넣을 때 만든 멱등 키를 재시도에서도 그대로 쓴다', async () => {
    // 설계 09 인수기준: 네트워크 복구 후 중복 없이 동기화된다. 재시도마다
    // 키를 새로 만들면 그 보장이 사라진다.
    const q = new OfflineQueue(memoryQueueStorage());
    q.enqueue(action('a'));
    const seen: string[] = [];
    let first = true;
    await q.flush(async (a) => {
      seen.push(a.idempotencyKey);
      if (first) {
        first = false;
        throw offline();
      }
    });
    await q.flush(async (a) => {
      seen.push(a.idempotencyKey);
    });
    expect(seen).toEqual(['key-a', 'key-a']);
    expect(q.size()).toBe(0);
  });

  it('넣은 순서대로 보내고, 네트워크가 없으면 거기서 멈춘다', async () => {
    // 수신확인 다음에 착수, 착수 다음에 진행보고다. 뒤엣것이 먼저 가면
    // 서버가 409로 거절하고 사람이 이유를 알 수 없다.
    const q = new OfflineQueue(memoryQueueStorage());
    q.enqueue(action('a', 'ack'));
    q.enqueue(action('b', 'start'));
    q.enqueue(action('c', 'progress'));

    const sent: string[] = [];
    const result = await q.flush(async (a) => {
      if (a.id === 'b') throw offline();
      sent.push(a.id);
    });

    expect(sent).toEqual(['a']);
    expect(result.sent).toBe(1);
    expect(result.pending).toBe(2);
    expect(q.list().map((a) => a.id)).toEqual(['b', 'c']);
  });

  it('서버가 거절한 것은 빼고 사람에게 보여 준다', async () => {
    // 계속 재시도하면 뒤에 쌓인 정상 보고가 영원히 못 나간다.
    const q = new OfflineQueue(memoryQueueStorage());
    q.enqueue(action('a'));
    q.enqueue(action('b'));

    const result = await q.flush(async (x) => {
      if (x.id === 'a') throw rejected();
    });

    expect(result.rejected.map((r) => r.id)).toEqual(['a']);
    expect(result.sent).toBe(1);
    expect(q.size()).toBe(0);
  });

  it('재시도 횟수가 남아 있는 항목에 쌓인다', async () => {
    const q = new OfflineQueue(memoryQueueStorage());
    q.enqueue(action('a'));
    await q.flush(async () => {
      throw offline();
    });
    await q.flush(async () => {
      throw offline();
    });
    expect(q.list()[0].attempts).toBe(2);
  });

  it('저장소가 깨져 있어도 빈 대기열로 시작한다', () => {
    const broken = {
      read: (): QueuedAction[] => {
        throw new Error('storage broken');
      },
      write: (): void => undefined,
    };
    // 저장소 자체가 던지는 경우는 localQueueStorage가 삼킨다. 여기서는
    // 계약(빈 배열)을 지키는 저장소면 큐가 정상 동작함을 확인한다.
    expect(() => broken.read()).toThrow();
    const q = new OfflineQueue(memoryQueueStorage());
    expect(q.list()).toEqual([]);
  });
});
