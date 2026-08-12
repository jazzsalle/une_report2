import type { components } from '../generated/une-platform-api';
import { ApiClient, newIdempotencyKey } from '../api/client';

/**
 * 상황일지가 부르는 연산 (CC-300, UNE-JNL-005~011).
 *
 * 타입은 계약에서 생성된 것을 쓴다 — 화면이 응답 모양을 손으로 적으면 어휘가
 * 넓어질 때 화면만 낡은 채 남는다(CC-290 board-api와 같은 이유).
 */

type Schemas = components['schemas'];

export type JournalDetail = Schemas['JournalDetail'];
export type JournalResource = Schemas['JournalResource'];
export type JournalFactCell = Schemas['JournalFactCell'];
export type NarrativeProposal = Schemas['NarrativeProposal'];
export type ExportJobResource = Schemas['ExportJobResource'];

export class JournalApi {
  constructor(private readonly client: ApiClient) {}

  /** UNE-JNL-005. 양식은 선택이 아니다 — 원본이 없으면 내보낼 수 없다. */
  async project(
    situationId: string,
    body: {
      templateFileId: string;
      from: string;
      to: string;
      snapshotId?: string;
      eventTypes?: string[];
    },
  ): Promise<JournalDetail> {
    const { data } = await this.client.call<JournalDetail>(
      `/situations/${situationId}/journal-projections`,
      { method: 'POST', body, idempotencyKey: newIdempotencyKey('journal-project') },
    );
    return data;
  }

  async detail(journalId: string): Promise<JournalDetail> {
    const { data } = await this.client.call<JournalDetail>(`/journals/${journalId}`);
    return data;
  }

  /** UNE-JNL-007. 제안일 뿐이다 — 사실을 반박하면 서버가 반영하지 않는다. */
  async proposeNarratives(journalId: string, sections: string[]): Promise<NarrativeProposal[]> {
    const { data } = await this.client.call<NarrativeProposal[]>(
      `/journals/${journalId}/ai-draft-jobs`,
      { method: 'POST', body: { sections }, idempotencyKey: newIdempotencyKey('journal-ai') },
    );
    return data;
  }

  /** UNE-JNL-008. 서술만 바뀐다 — 사실칸은 어떤 연산으로도 닿지 않는다. */
  async edit(
    journalId: string,
    operations: Array<{ sectionKey: string; narrativeText: string }>,
  ): Promise<JournalDetail> {
    const { data } = await this.client.call<JournalDetail>(`/journals/${journalId}/changesets`, {
      method: 'POST',
      body: { operations },
      idempotencyKey: newIdempotencyKey('journal-edit'),
    });
    return data;
  }

  /** 사람이 눌러야 사실이 갱신된다. 자동 갱신은 하지 않는다. */
  async refreshFacts(journalId: string): Promise<JournalDetail> {
    const { data } = await this.client.call<JournalDetail>(`/journals/${journalId}/fact-refresh`, {
      method: 'POST',
      body: {},
      idempotencyKey: newIdempotencyKey('journal-refresh'),
    });
    return data;
  }

  async submitReview(
    journalId: string,
    reviewers: string[],
    message?: string,
  ): Promise<JournalDetail> {
    const { data } = await this.client.call<JournalDetail>(`/journals/${journalId}/submit-review`, {
      method: 'POST',
      body: { reviewers, message },
      idempotencyKey: newIdempotencyKey('journal-review'),
    });
    return data;
  }

  async decide(
    journalId: string,
    decision: 'APPROVED' | 'CHANGES_REQUESTED',
    comment?: string,
  ): Promise<JournalDetail> {
    const { data } = await this.client.call<JournalDetail>(`/journals/${journalId}/approve`, {
      method: 'POST',
      body: { decision, comment },
      idempotencyKey: newIdempotencyKey('journal-decide'),
    });
    return data;
  }

  /** UNE-JNL-011 — CC-160의 Export 경로를 그대로 탄다. */
  async export(journalId: string, format = 'HWPX'): Promise<ExportJobResource> {
    const { data } = await this.client.call<ExportJobResource>(`/journals/${journalId}/exports`, {
      method: 'POST',
      body: { format },
      idempotencyKey: newIdempotencyKey('journal-export'),
    });
    return data;
  }
}
