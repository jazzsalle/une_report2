import type { components } from '../generated/une-platform-api';
import { ApiClient, newIdempotencyKey } from '../api/client';

/**
 * 종료·평가가 부르는 연산 (CC-310, UNE-JNL-012~015).
 *
 * 타입은 계약에서 생성된 것을 쓴다 — 화면이 응답 모양을 손으로 적으면 어휘가
 * 넓어질 때 화면만 낡은 채 남는다.
 */

type Schemas = components['schemas'];

export type ClosurePreview = Schemas['ClosurePreview'];
export type CloseBlocker = Schemas['CloseBlocker'];
export type SituationClosed = Schemas['SituationClosed'];
export type Evaluation = Schemas['Evaluation'];
export type EvaluationReport = Schemas['EvaluationReport'];

export class EvaluationApi {
  constructor(private readonly client: ApiClient) {}

  async closePreview(situationId: string): Promise<ClosurePreview> {
    const { data } = await this.client.call<ClosurePreview>(
      `/situations/${situationId}/close-preview`,
    );
    return data;
  }

  /** 미결에는 **사유 있는 처분**이 붙어야 닫힌다. */
  async close(
    situationId: string,
    body: {
      resultSummary?: string;
      dispositions: Array<{ refId: string; disposition: 'WAIVED'; reason: string }>;
    },
  ): Promise<SituationClosed> {
    const { data } = await this.client.call<SituationClosed>(`/situations/${situationId}/close`, {
      method: 'POST',
      body,
      idempotencyKey: newIdempotencyKey('close'),
    });
    return data;
  }

  async createEvaluation(
    situationId: string,
    body: {
      summary?: string;
      scores: Array<{
        criterionCode: string;
        scoreValue: number;
        weightValue: number;
        comment?: string;
        evidenceEventIds?: string[];
      }>;
    },
  ): Promise<Evaluation> {
    const { data } = await this.client.call<Evaluation>(`/situations/${situationId}/evaluations`, {
      method: 'POST',
      body,
      idempotencyKey: newIdempotencyKey('evaluation'),
    });
    return data;
  }

  async detail(evaluationId: string): Promise<Evaluation> {
    const { data } = await this.client.call<Evaluation>(`/evaluations/${evaluationId}`);
    return data;
  }

  async addImprovements(
    evaluationId: string,
    actions: Array<{
      actionText: string;
      ownerUserId?: string;
      dueAt?: string;
      targetType?: 'PLAN' | 'SOP' | 'SYSTEM';
      targetId?: string;
    }>,
  ): Promise<Evaluation> {
    const { data } = await this.client.call<Evaluation>(
      `/evaluations/${evaluationId}/improvements`,
      { method: 'POST', body: { actions }, idempotencyKey: newIdempotencyKey('improvement') },
    );
    return data;
  }

  /** 확정. 이 뒤로 점수·개선조치가 얼어붙는다. */
  async confirm(evaluationId: string): Promise<Evaluation> {
    const { data } = await this.client.call<Evaluation>(`/evaluations/${evaluationId}/confirm`, {
      method: 'POST',
      body: {},
      idempotencyKey: newIdempotencyKey('confirm'),
    });
    return data;
  }

  async report(evaluationId: string): Promise<EvaluationReport> {
    const { data } = await this.client.call<EvaluationReport>(
      `/evaluations/${evaluationId}/report`,
    );
    return data;
  }
}
