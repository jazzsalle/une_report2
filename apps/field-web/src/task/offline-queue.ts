import { isOffline, isUnauthenticated } from '../api/client';

/**
 * 오프라인 대기열 (CC-280, 설계 09 SCR-TASK-001 "오프라인 임시저장").
 *
 * 현장은 신호가 끊긴다. 그때 누른 수신확인·착수·보고가 사라지면 사람이 같은
 * 것을 다시 입력하고, 그 사이 지휘소는 아무 소식도 못 듣는다.
 *
 * **멱등 키를 넣을 때 한 번 만들고 끝까지 그것을 쓴다.** 재시도마다 새로
 * 만들면 복구 뒤 같은 보고가 여러 건 들어간다 — 설계 09의 인수기준이
 * "네트워크 복구 후 중복 없이 동기화된다"이고, 그 보장의 전부가 이 한 줄이다.
 *
 * 저장은 하되 **본문에 개인정보를 넣지 않는 것은 화면의 책임이다.** 여기서는
 * 받은 것을 그대로 담는다 — 걸러 주는 척하면 어디서 걸러졌는지 아무도 모른다.
 */

export interface QueuedAction {
  id: string;
  taskId: string;
  path: string;
  body: unknown;
  idempotencyKey: string;
  /** 화면에 "무엇이 밀려 있는지" 보여주기 위한 이름. */
  label: string;
  queuedAt: string;
  attempts: number;
  /** 마지막 실패 사유. 서버가 거절한 경우에만 채워진다. */
  lastError: string | null;
}

export interface QueueStorage {
  read(): QueuedAction[];
  write(actions: QueuedAction[]): void;
}

const STORAGE_KEY = 'une.field.queue.v1';

/**
 * localStorage 저장소.
 *
 * 토큰은 여기 넣지 않는다(메모리에만 둔다). 대기열에는 임무 보고 본문이
 * 들어가므로 **로그아웃 시 지우는 것**이 화면의 책임이다.
 */
export function localQueueStorage(): QueueStorage {
  return {
    read(): QueuedAction[] {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as QueuedAction[]) : [];
      } catch {
        return [];
      }
    },
    write(actions: QueuedAction[]): void {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
      } catch {
        // 저장이 안 되면 대기열은 이번 세션에서만 산다. 그 사실을 삼키지 않도록
        // 화면이 남은 건수를 항상 보여 준다.
      }
    },
  };
}

export function memoryQueueStorage(initial: QueuedAction[] = []): QueueStorage {
  let actions = [...initial];
  return {
    read: () => [...actions],
    write: (next) => {
      actions = [...next];
    },
  };
}

export type SendFn = (action: QueuedAction) => Promise<void>;

export interface FlushResult {
  sent: number;
  /** 아직 네트워크가 없어 그대로 남은 건수. */
  pending: number;
  /** 서버가 거절해 사람이 봐야 하는 건수. */
  rejected: QueuedAction[];
}

export class OfflineQueue {
  constructor(private readonly storage: QueueStorage) {}

  list(): QueuedAction[] {
    return this.storage.read();
  }

  size(): number {
    return this.storage.read().length;
  }

  /**
   * 아직 못 보낸 같은 행위가 있는가.
   *
   * 화면이 새 요청을 만들기 **전에** 이것을 묻고, 있으면 그 항목의 멱등 키를
   * 재사용한다. 그러지 않으면 오프라인에서 버튼을 두 번 누른 사람의 보고가
   * 서로 다른 키로 둘 쌓이고, 복구 시 둘 다 나간다 — 상태를 바꾸는 것은
   * 상태기계가 409로 흡수하지만 **진행보고는 상태를 바꾸지 않아 그대로 중복
   * 기록된다.**
   */
  findPending(taskId: string, label: string): QueuedAction | null {
    return this.storage.read().find((a) => a.taskId === taskId && a.label === label) ?? null;
  }

  enqueue(action: Omit<QueuedAction, 'attempts' | 'lastError'>): void {
    const actions = this.storage.read();
    // 같은 멱등 키가 이미 있으면 더하지 않는다 — 사용자가 버튼을 두 번 눌렀을
    // 뿐이다. `findPending`으로 키를 재사용해 오면 여기서 걸린다.
    if (actions.some((a) => a.idempotencyKey === action.idempotencyKey)) return;
    actions.push({ ...action, attempts: 0, lastError: null });
    this.storage.write(actions);
  }

  remove(id: string): void {
    this.storage.write(this.storage.read().filter((a) => a.id !== id));
  }

  clear(): void {
    this.storage.write([]);
  }

  /**
   * 쌓인 것을 **넣은 순서대로** 보낸다.
   *
   * 순서가 중요하다: 수신확인 다음에 착수, 착수 다음에 진행보고다. 뒤엣것이
   * 먼저 가면 서버가 409로 거절하고 사람이 이유를 알 수 없다. 그래서 하나가
   * 네트워크 때문에 실패하면 **거기서 멈춘다.**
   *
   * 서버가 거절한 것(4xx)은 다시 보내도 같은 답이므로 대기열에서 빼고 사람에게
   * 보여 준다. 그것을 계속 재시도하면 뒤에 쌓인 정상 보고가 영원히 못 나간다.
   */
  async flush(send: SendFn): Promise<FlushResult> {
    const actions = this.storage.read();
    const rejected: QueuedAction[] = [];
    let sent = 0;
    let index = 0;

    for (; index < actions.length; index += 1) {
      const action = actions[index];
      try {
        await send(action);
        sent += 1;
      } catch (error) {
        // 연결이 없거나(0) **세션이 끊겼으면(401)** 남긴다. 401을 거절로 다루면
        // 토큰 만료 상태로 앱을 연 순간 밀려 있던 현장 보고가 통째로 버려진다.
        if (isOffline(error) || isUnauthenticated(error)) break;
        rejected.push({
          ...action,
          attempts: action.attempts + 1,
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const remaining = actions.slice(index).map((a) => ({ ...a, attempts: a.attempts + 1 }));
    this.storage.write(remaining);
    return { sent, pending: remaining.length, rejected };
  }
}
