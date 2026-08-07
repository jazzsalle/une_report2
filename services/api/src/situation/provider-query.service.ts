import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  canCollectFacts,
  canonicalHash,
  nextStatusOnFactRegistered,
  normalizeFacts,
  type InvalidFact,
  type NormalizedFact,
} from '@une/domain';
import {
  providerFailure,
  type CollectSituationQuery,
  type SituationProviderFactory,
  type ProviderCollectResult,
  type QueryableProvider,
  type SituationProviderFlags,
} from '@une/provider-adapters';
import { AuditRepository } from '../common/audit.repository';
import type { RequestMetaLike } from '../common/controller-utils';
import type { AuthContext } from '../common/request-context';
import { API_CONFIG, type ApiConfig } from '../config/api-config';
import { DatabaseService } from '../db/database.service';
import { providerErrors, situationErrors } from './situation-errors';
import { SITUATION_PROVIDERS } from './situation-provider.provider';
import { SituationRepository } from './situation.repository';
import { SituationService } from './situation.service';
import {
  toFactValueEnvelope,
  toProviderJobResource,
  type ProviderJobResource,
} from './situation.resources';

export interface ProviderQueryInput {
  providers: QueryableProvider[];
  query: Record<string, unknown>;
  categories: string[];
  featureFlags: SituationProviderFlags;
  requestReason: string | null;
  from: string | null;
  to: string | null;
}

export interface ProviderQueryJobResource {
  batchId: string;
  situationId: string;
  jobs: ProviderJobResource[];
  factsCreated: number;
}

/** 한 Provider의 호출 결과를 DB에 쓸 형태로 접은 것. */
interface CollectedOutcome {
  provider: QueryableProvider;
  result: ProviderCollectResult;
  normalized: NormalizedFact[];
  rejected: InvalidFact[];
}

/**
 * UNE-SIT-005 / UNE-SIT-015 (CC-200).
 *
 * **동기 수집이다**(ADR-33 D2). 승인된 결정이며 이유는 이렇다: 지금 어댑터가
 * 전부 목업이므로 비동기로 만들면 큐·리스·폴링이 실제로는 아무것도 기다리지
 * 않는 장치가 된다. 실 Provider가 붙어 응답이 느려지는 것은 수용 한계로
 * 남기고 그때 비동기로 옮긴다.
 *
 * 트랜잭션 경계가 이 파일의 핵심이다.
 *
 *   1) 짧은 읽기 트랜잭션 — 상황이 있고 열려 있는지 확인한다.
 *   2) **트랜잭션 밖** — Provider를 병렬로 부른다. 외부 호출은 긴 트랜잭션
 *      안에서 돌지 않는다(.claude/rules/backend.md). Provider 하나가 느리면
 *      DB 커넥션과 잠금을 그동안 붙잡고 있게 된다.
 *   3) 한 쓰기 트랜잭션 — Job·원문·출처·Fact·상태전이·감사를 함께 기록한다.
 *      부분 실패가 절반만 남는 상태를 만들지 않는다.
 *
 * 부분 장애는 200이다. 설계 06 US-SIT-005의 요구가 "부분장애가 전체 흐름을
 * 막지 않게 한다"이고 E-01(모든 Provider 실패)조차 "사용자 입력만으로 계속
 * 가능"이다. 그래서 전멸해도 500/503이 아니라 200 + FAILED Job들이다.
 */
@Injectable()
export class ProviderQueryService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SituationRepository) private readonly repo: SituationRepository,
    @Inject(SituationService) private readonly situations: SituationService,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
    // 구체 팩토리가 아니라 주입받은 함수를 쓴다(ADR-33 D19).
    @Inject(SITUATION_PROVIDERS) private readonly providerFor: SituationProviderFactory,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  /** 한 Provider의 수집에 제한시간을 건다.
   *
   * 동기 수집이라 제한시간이 없으면 느린 Provider 하나가 HTTP 요청을 무기한
   * 붙잡는다. 초과는 그 Provider의 `TIMEOUT` 실패이며 배치는 계속 간다 —
   * D11(부분 장애는 200)과 같은 취급이다. 타이머는 어느 쪽이 이기든 정리한다
   * (요청이 끝난 뒤 프로세스를 붙잡고 있지 않도록).
   *
   * 여기서 하지 않는 것: 재시도·백오프·서킷브레이커. 그것은 실 어댑터의
   * 몫이고 지금 만들면 목업 앞에서 아무것도 하지 않는 장치가 된다
   * (ADR-33 D2와 같은 이유, 수용 한계 2). */
  private async withTimeout(
    provider: QueryableProvider,
    pending: Promise<ProviderCollectResult>,
  ): Promise<ProviderCollectResult> {
    const limitMs = this.config.situationProviderTimeoutMs;
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<ProviderCollectResult>((resolve) => {
          timer = setTimeout(
            () =>
              resolve(
                providerFailure(provider, 'TIMEOUT', `${limitMs}ms 안에 응답하지 않았습니다.`, {
                  elapsedMs: limitMs,
                }),
              ),
            limitMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async collect(
    auth: AuthContext,
    situationId: string,
    input: ProviderQueryInput,
    meta: RequestMetaLike,
  ): Promise<ProviderQueryJobResource> {
    // (1) 선행조건 — 짧은 읽기.
    const situation = await this.db.withTenant(auth.tenantId, (c) =>
      this.situations.requireOpenSituation(c, auth.tenantId, situationId),
    );

    const asOf = new Date().toISOString();
    const query: CollectSituationQuery = {
      situationId,
      hazardType: situation.hazardType,
      location: {
        adminCode: typeof input.query.adminCode === 'string' ? input.query.adminCode : null,
        text: situation.locationText,
      },
      timeWindow: { from: input.from, to: input.to, asOf },
      categories: input.categories,
      requestReason: input.requestReason,
      requestedBy: auth.userId,
      correlationId: meta.correlationId,
      providerQuery: input.query,
    };

    // (2) 외부 호출 — 트랜잭션 밖, 병렬.
    //
    // 한 Provider가 **던지면** 배치 전체가 무너진다: `Promise.all`이 즉시
    // 실패해 (3)에 도달하지 못하고, 이미 응답을 받은 다른 Provider의 원문과
    // 후보가 통째로 버려지며 `provider_job` 행이 하나도 남지 않는다. 그러면
    // D10("어느 갈래든 행을 남긴다")과 D11("전부 실패해도 200")이 동시에
    // 깨진다. 지금 목업이 던지지 않아 드러나지 않을 뿐이므로 **경계에서
    // 봉인한다** — 포트 계약 위반도 그 Provider 하나의 실패로 접는다
    // (아키텍처 리뷰 M-2).
    const outcomes = await Promise.all(
      input.providers.map(async (provider): Promise<CollectedOutcome> => {
        try {
          const adapter = this.providerFor(provider, { flags: input.featureFlags });
          const result = await this.withTimeout(provider, adapter.collect(query));
          if (!result.ok) return { provider, result, normalized: [], rejected: [] };
          const batch = normalizeFacts(result.items);
          return {
            provider,
            result,
            normalized: batch.normalized,
            rejected: batch.invalid,
          };
        } catch (err) {
          return {
            provider,
            result: providerFailure(
              provider,
              'UPSTREAM_ERROR',
              err instanceof Error ? err.message : '어댑터가 예외를 던졌습니다.',
            ),
            normalized: [],
            rejected: [],
          };
        }
      }),
    );

    // (3) 기록 — 한 트랜잭션.
    const batchId = randomUUID();
    return this.db.withTenant(auth.tenantId, async (c) => {
      // (1)의 확인과 여기 사이에 상황이 종결될 수 있다 — Provider 호출이
      // 트랜잭션 밖에 있는 대가다. 종결된 상황에 후보를 심으면 도메인 규칙
      // (canCollectFacts)이 깨지므로 **행을 잠그고 다시 확인한다.** 여기서
      // 412가 나면 트랜잭션 전체가 롤백되어 부분 기록이 남지 않는다.
      const fresh = await this.repo.findSituation(c, auth.tenantId, situationId, {
        forUpdate: true,
      });
      if (!fresh) throw situationErrors.notFound();
      if (!canCollectFacts(fresh.status)) throw situationErrors.closed(fresh.status);

      const jobs: ProviderJobResource[] = [];
      let factsCreated = 0;

      for (const outcome of outcomes) {
        const written = await this.recordOutcome(
          c,
          auth,
          situationId,
          batchId,
          asOf,
          input,
          outcome,
          meta,
        );
        jobs.push(written.job);
        factsCreated += written.factsCreated;
      }

      if (factsCreated > 0) {
        // 전이 판단은 (1)에서 읽은 낡은 상태가 아니라 방금 잠근 상태로 한다.
        const next = nextStatusOnFactRegistered(fresh.status);
        if (next !== fresh.status) {
          const moved = await this.repo.advanceStatus(
            c,
            auth.tenantId,
            situationId,
            fresh.status,
            next,
          );
          if (moved) {
            await this.audit.insertAudit(c, {
              tenantId: auth.tenantId,
              actorId: auth.userId,
              action: 'INCIDENT_REGISTERED',
              resourceType: 'SITUATION',
              resourceId: situationId,
              correlationId: meta.correlationId,
              ip: meta.ip,
              userAgent: meta.userAgent,
              before: { status: fresh.status },
              detail: { status: next },
            });
          }
        }
      }

      return { batchId, situationId, jobs, factsCreated };
    });
  }

  /** 한 Provider의 결과를 Job 한 행 + 원문 + 후보 Fact로 기록한다.
   *
   * 상태 판정은 0023 §4의 `ck_provider_job_outcome_shape`와 정확히 짝을
   * 이뤄야 한다 — 어긋나면 INSERT가 23514로 떨어진다. 그 상관식을 코드에서
   * 다시 표현하지 않고 **여기 한 곳에서만** 만든다. */
  private async recordOutcome(
    client: PoolClient,
    auth: AuthContext,
    situationId: string,
    batchId: string,
    asOf: string,
    input: ProviderQueryInput,
    outcome: CollectedOutcome,
    meta: RequestMetaLike,
  ): Promise<{ job: ProviderJobResource; factsCreated: number }> {
    const { provider, result } = outcome;
    const requestJson = {
      providers: input.providers,
      query: input.query,
      categories: input.categories,
      featureFlags: input.featureFlags,
      from: input.from,
      to: input.to,
      asOf,
    };

    let status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
    let errorJson: Record<string, unknown> | null;
    const resultCount = outcome.normalized.length;

    if (!result.ok) {
      status = 'FAILED';
      errorJson = {
        kind: result.kind,
        message: result.message,
        retriable: result.retriable,
        rejectedCount: 0,
      };
    } else if (resultCount === 0) {
      // 응답은 왔지만 남는 것이 없다. 0023 §4가 "통과 항목이 0이면 FAILED"로
      // 정했고 상관식이 그것을 강제한다.
      status = 'FAILED';
      errorJson = {
        kind: outcome.rejected.length > 0 ? 'NORMALIZATION_REJECTED' : 'NO_DATA',
        message:
          outcome.rejected.length > 0
            ? '수신 항목이 모두 정규화에서 탈락했습니다.'
            : 'Provider가 해당 조건의 항목을 주지 않았습니다.',
        retriable: false,
        rejectedCount: outcome.rejected.length,
      };
    } else if (outcome.rejected.length > 0) {
      status = 'PARTIAL';
      errorJson = {
        kind: 'NORMALIZATION_REJECTED',
        message: '일부 항목이 정규화에서 탈락했습니다.',
        retriable: false,
        rejectedCount: outcome.rejected.length,
        // 사유만 남긴다. 탈락 항목의 원문은 provider_result에 통째로 있다.
        reasons: [...new Set(outcome.rejected.flatMap((r) => r.notes.map((n) => n.reason)))],
      };
    } else {
      status = 'SUCCEEDED';
      errorJson = null;
    }

    const job = await this.repo.insertProviderJob(client, auth.tenantId, {
      batchId,
      situationId,
      providerCode: provider,
      requestJson,
      status,
      resultCount,
      errorJson,
      correlationId: meta.correlationId,
    });

    // 원문 보존은 CLAUDE.md 비협상 규칙이다. 성공했을 때는 물론이고 파서가
    // 바뀌어 실패했을 때도 원문이 있으면 남긴다 — 진단이 그것으로 이뤄진다.
    const rawPayload = result.rawPayload;
    if (rawPayload !== undefined) {
      await this.repo.insertProviderResult(client, job.providerJobId, {
        seq: 1,
        rawPayload,
        payloadSha256: canonicalHash(rawPayload),
        itemCount: result.ok ? result.itemCount : 0,
      });
    }

    let factsCreated = 0;
    if (result.ok && resultCount > 0) {
      const source = await this.repo.insertFactSource(client, auth.tenantId, {
        providerCode: provider,
        sourceType: 'API',
        sourceName: result.sourceName,
        sourceUri: result.sourceUri,
        retrievedAt: result.retrievedAt,
      });
      for (const fact of outcome.normalized) {
        await this.repo.insertFact(client, situationId, {
          factType: fact.factType,
          factKey: fact.factKey,
          valueJson: toFactValueEnvelope(fact),
          sourceId: source.sourceId,
          observedAt: fact.observedAt,
          collectedAt: result.retrievedAt,
          // 신뢰도는 자동으로 매기지 않는다. 설계 06 US-SIT-005 #3이
          // "점수 자동확정에 사용 금지"라고 못박았다.
          confidence: null,
        });
        factsCreated += 1;
      }
    }

    await this.audit.insertAudit(client, {
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action: status === 'FAILED' ? 'PROVIDER_QUERY_FAILED' : 'PROVIDER_QUERY_COMPLETED',
      resourceType: 'PROVIDER_JOB',
      resourceId: job.providerJobId,
      correlationId: meta.correlationId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: {
        situationId,
        batchId,
        providerCode: provider,
        status,
        resultCount,
        rejectedCount: outcome.rejected.length,
        elapsedMs: result.elapsedMs,
        ...(result.ok ? { parserVersion: result.parserVersion } : { failureKind: result.kind }),
      },
    });

    return { job: toProviderJobResource(job), factsCreated };
  }

  /** UNE-SIT-015. SSE(SIT-006)의 폴링 대체다. */
  async job(auth: AuthContext, providerJobId: string): Promise<ProviderJobResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const row = await this.repo.findProviderJob(c, auth.tenantId, providerJobId);
      if (!row) throw providerErrors.jobNotFound();
      return toProviderJobResource(row);
    });
  }
}
