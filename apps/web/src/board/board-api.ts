import type { components } from '../generated/une-platform-api';
import { ApiClient, newIdempotencyKey } from '../api/client';

/**
 * 전자상황판이 부르는 연산 (CC-290, UNE-JNL-001~004).
 *
 * 타입은 계약에서 생성된 것을 쓴다 — 화면이 응답 모양을 손으로 적으면 어휘가
 * 넓어질 때(CC-260·270·280에서 세 번 있었다) 화면만 낡은 채 남는다.
 */

type Schemas = components['schemas'];

export type DashboardView = Schemas['DashboardView'];
export type DashboardTask = Schemas['DashboardTask'];
export type ExecutionEventPage = Schemas['ExecutionEventPage'];
export type ExecutionEventDetail = Schemas['ExecutionEventDetail'];
export type ExecutionEvent = Schemas['ExecutionEvent'];

export interface EventFilter {
  from?: string;
  to?: string;
  type?: string;
  actor?: string;
  aggregateType?: string;
  page?: number;
  size?: number;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s.length > 0 ? `?${s}` : '';
}

export class BoardApi {
  constructor(private readonly client: ApiClient) {}

  /** `at`을 주면 그 시점의 판이 온다. */
  async dashboard(situationId: string, at?: string, runId?: string): Promise<DashboardView> {
    const { data } = await this.client.call<DashboardView>(
      `/situations/${situationId}/dashboard${query({ at, runId })}`,
    );
    return data;
  }

  async events(situationId: string, filter: EventFilter = {}): Promise<ExecutionEventPage> {
    const { data } = await this.client.call<ExecutionEventPage>(
      `/situations/${situationId}/execution-events${query({ ...filter })}`,
    );
    return data;
  }

  async event(eventId: string): Promise<ExecutionEventDetail> {
    const { data } = await this.client.call<ExecutionEventDetail>(`/execution-events/${eventId}`);
    return data;
  }

  /** 원본을 고치지 않는다 — 정정 이벤트를 더한다. */
  async correct(
    eventId: string,
    body: { reason: string; replacementFields: Record<string, unknown> },
  ): Promise<ExecutionEvent> {
    const { data } = await this.client.call<ExecutionEvent>(
      `/execution-events/${eventId}/corrections`,
      { method: 'POST', body, idempotencyKey: newIdempotencyKey('correct') },
    );
    return data;
  }
}
