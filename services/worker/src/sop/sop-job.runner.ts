import { createHash } from 'node:crypto';
import {
  deriveSequentialEdges,
  fitTitle,
  parseSopJobRequest,
  sopGraphHashInput,
  validateSopGraph,
  type SopGraphViolation,
  type SopJobRequest,
  type SopMappingWarning,
  type SopNodeDraft,
} from '@une/domain';
import {
  mapUniCompn,
  UNI_SOP_MAPPER_VERSION,
  type UniSopProvider,
  type UniSopResult,
} from '@une/provider-adapters';
import type { WorkerConfig } from '../config/worker-config';
import type { WorkerDatabase } from '../db/worker-database.service';
import {
  appendJobEvent,
  claimJobs,
  findJobForUpdate,
  insertAudit,
  setJobStatus,
  sweepCancelRequested,
  type ClaimedJob,
} from '../plan-jobs/job-dispatch.repository';
import {
  ensureSop,
  findEvidenceScope,
  findSopSources,
  insertSopGraph,
  insertSopVersion,
  markSituationSopReady,
  nextSopVersionNo,
  pointSopAtVersion,
  type EvidenceScope,
  type SopSourceRefs,
} from './sop-repositories';

export interface SopRunSummary {
  claimed: number;
  completed: number;
  failed: number;
  cancelled: number;
  skipped: number;
}

interface SopFailure {
  code: 'UNI-503-003' | 'UNI-422-003';
  reason: string;
  message: string;
  retryable: boolean;
  providerCode?: string;
  /** 이미 받은 노드 수 — 폐기 여부는 사용자 결정이다(설계 08 §1.11). */
  partialNodeCount?: number;
  /**
   * provider가 만든 원문 문자열. **공개 이벤트에 싣지 않는다.**
   *
   * `job.failed`는 공개 어휘라 SSE로 사용자에게 그대로 간다. UNI `__error__`의
   * 내용은 우리가 통제하지 못하는 임의 문자열이고(내부 경로·식별자가 섞일 수
   * 있다), 어휘를 UNE의 것으로 투영한다는 원칙(ADR-38 D11)은 이름만이 아니라
   * 값에도 적용된다. 원문은 `provider.failed`(내부 이벤트)에만 남는다.
   */
  providerMessage?: string;
}

/** 원문 프레임 상한. TOC 잡과 같은 이유이고 같은 값이다(ADR-26 D8). */
const RAW_PAYLOAD_CAP = 200_000;

function cap(value: unknown): unknown {
  const text = JSON.stringify(value ?? null);
  return text.length <= RAW_PAYLOAD_CAP ? value : { truncated: true, length: text.length };
}

/**
 * 프레임 배열을 상한 안에서 **가능한 만큼** 남긴다.
 *
 * 통짜 `cap()`은 상한을 넘으면 배열 전체를 `{truncated}`로 갈아치운다 — 긴
 * 스트림일수록 "UNI가 무엇을 보냈는가"에 답할 수 없게 되는데, 원문을 남기는
 * 이유가 정확히 그 질문이다(CC-240 QA F13). 앞에서부터 담고 몇 개를 버렸는지
 * 적는다.
 */
function capFrames(frames: unknown[]): unknown {
  const kept: unknown[] = [];
  let size = 2;
  for (const frame of frames) {
    const text = JSON.stringify(frame ?? null);
    if (size + text.length + 1 > RAW_PAYLOAD_CAP) break;
    kept.push(frame);
    size += text.length + 1;
  }
  return kept.length === frames.length
    ? frames
    : { truncated: true, keptFrames: kept.length, totalFrames: frames.length, frames: kept };
}

/**
 * SOP 생성 잡 (UNE-SOP-001/002, 설계 08 §1.11).
 *
 *   tx A  (디스패치 스코프): QUEUED·유실 리스 확보
 *   tx B0 (테넌트): 근거 검증, job.started, provider.requested(intent)
 *   ——  UNI 호출은 어떤 트랜잭션 밖에서  ——
 *   tx B1 (테넌트): 취소 체크포인트 → 그래프 적재 → COMPLETED
 *
 * TOC 잡과 같은 골격이다. 다른 것은 셋이다:
 *   1. provider가 UNI이고 응답이 **스트림**이다 — 이벤트를 `job_event`에 남긴다.
 *   2. **검증 위반이 실패가 아니다.** 위반이 있어도 DRAFT로 저장한다
 *      (설계 08 §1.11: 사용자가 Canvas에서 고치는 것이 다음 단계다).
 *   3. 매핑 거부는 노드 단위다 — 하나가 깨져도 나머지는 살린다.
 */
export class SopJobRunner {
  constructor(
    private readonly db: WorkerDatabase,
    private readonly uni: UniSopProvider,
    private readonly config: WorkerConfig,
  ) {}

  async runOnce(): Promise<SopRunSummary> {
    const summary: SopRunSummary = {
      claimed: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      skipped: 0,
    };

    const cancelTargets = await this.db.withDispatchScope((client) =>
      sweepCancelRequested(client, 'SOP', this.config.batchSize, this.config.leaseTimeoutMs),
    );
    for (const target of cancelTargets) {
      const outcome = await this.finalizeCancelled({
        jobId: target.jobId,
        tenantId: target.tenantId,
        aggregateId: target.aggregateId,
        correlationId: target.correlationId,
        requestJson: null,
        attemptNo: 0,
      });
      if (outcome === 'cancelled') summary.cancelled += 1;
    }

    const claimed = await this.db.withDispatchScope((client) =>
      claimJobs(client, 'SOP', this.config.batchSize, this.config.leaseTimeoutMs),
    );
    summary.claimed = claimed.length;
    for (const job of claimed) {
      try {
        summary[await this.processJob(job)] += 1;
      } catch (err) {
        summary.failed += 1;
        console.error(
          `[une-worker] sop job ${job.jobId} crashed corr=${job.correlationId}: ` +
            `${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return summary;
  }

  private async processJob(
    job: ClaimedJob,
  ): Promise<'completed' | 'failed' | 'cancelled' | 'skipped'> {
    const prepared = await this.db.withTenant(job.tenantId, async (client) => {
      const current = await findJobForUpdate(client, job.tenantId, job.jobId);
      if (!current) return { kind: 'skip' as const };
      if (current.status === 'CANCEL_REQUESTED') return { kind: 'cancel' as const };
      if (current.status !== 'RUNNING') return { kind: 'skip' as const };

      if (job.attemptNo > this.config.maxAttempts) {
        return {
          kind: 'fail' as const,
          failure: {
            code: 'UNI-503-003' as const,
            reason: 'MAX_ATTEMPTS_EXCEEDED',
            message: `최대 시도 횟수(${this.config.maxAttempts})를 초과했습니다.`,
            retryable: false,
          },
        };
      }

      let request: SopJobRequest;
      try {
        request = parseSopJobRequest(job.requestJson);
      } catch (err) {
        return {
          kind: 'fail' as const,
          failure: {
            code: 'UNI-422-003' as const,
            reason: 'INVALID_JOB_REQUEST',
            message: err instanceof Error ? err.message : 'request_json 파싱 실패',
            retryable: false,
          },
        };
      }

      // API가 큐에 넣을 때 확인한 것을 여기서 **다시** 본다. 그 사이에 근거집합이
      // 다른 상황으로 옮겨가지는 않지만, 스냅샷이 교체됐을 수는 있다.
      const sources = await findSopSources(
        client,
        job.tenantId,
        job.aggregateId,
        request.snapshotId,
        request.evidenceSetId,
      );
      if (!sources) {
        return {
          kind: 'fail' as const,
          failure: {
            code: 'UNI-422-003' as const,
            reason: 'SOURCES_NOT_FOUND',
            message: '확정 Snapshot 또는 동결 EvidenceSet을 찾을 수 없습니다.',
            retryable: false,
          },
        };
      }

      const scope = await findEvidenceScope(client, request.evidenceSetId);
      if (scope.providerDocumentIds.length === 0) {
        // 범위 없는 생성은 LLM이 무엇을 근거로 삼았는지 말할 수 없게 만든다.
        return {
          kind: 'fail' as const,
          failure: {
            code: 'UNI-422-003' as const,
            reason: 'NO_REGISTERED_EVIDENCE_DOCUMENT',
            message: 'UNI에 등록된 근거 문서가 없어 생성 범위를 지정할 수 없습니다.',
            retryable: false,
          },
        };
      }

      await appendJobEvent(client, job.jobId, 'job.started', { attemptNo: job.attemptNo });
      // 호출 의도를 남긴다(TOC 잡과 같은 규약). 신원과 범위만 — 프롬프트 본문은
      // 상황 사실을 담고 있으므로 여기에 적지 않는다.
      await appendJobEvent(client, job.jobId, 'provider.requested', {
        phase: 'intent',
        adapterId: this.uni.adapterId,
        mappingVersion: this.uni.mappingVersion,
        isMock: this.uni.isMock,
        operation: 'sop.generate',
        documentCount: scope.providerDocumentIds.length,
      });
      await setJobStatus(client, job.tenantId, job.jobId, { status: 'RUNNING', progressPct: 10 });
      return { kind: 'run' as const, request, sources, scope };
    });

    if (prepared.kind === 'skip') return 'skipped';
    if (prepared.kind === 'cancel') return this.finalizeCancelled(job);
    if (prepared.kind === 'fail') return this.finalizeFailed(job, prepared.failure, undefined);

    let result: UniSopResult;
    try {
      result = await this.uni.generateSop(
        {
          prompt: buildPrompt(prepared.sources, prepared.scope.providerDocumentIds),
          documentIds: prepared.scope.providerDocumentIds,
          snapshotId: prepared.request.snapshotId,
          evidenceSetId: prepared.request.evidenceSetId,
          schemaVersion: UNI_SOP_MAPPER_VERSION,
        },
        { correlationId: job.correlationId },
      );
    } catch (err) {
      return this.finalizeFailed(
        job,
        {
          code: 'UNI-503-003',
          reason: 'PROVIDER_CONTRACT_VIOLATION',
          message: err instanceof Error ? err.message : 'UNI 어댑터가 예외를 던졌습니다.',
          retryable: false,
        },
        undefined,
      );
    }

    if (!result.ok) {
      return this.finalizeFailed(
        job,
        {
          code: 'UNI-503-003',
          reason: 'PROVIDER_ERROR',
          // 사용자에게는 UNE 문장을 준다. provider 원문은 아래 providerMessage로
          // 내부 이벤트에만 간다.
          message: 'UNI SOP 생성에 실패했습니다.',
          retryable: result.error.retryable,
          providerCode: result.error.code,
          partialNodeCount: result.error.partialNodeCount,
          providerMessage: result.error.message,
        },
        result,
      );
    }

    return this.finalizeCompleted(job, prepared.request, prepared.sources, prepared.scope, result);
  }

  private async finalizeCompleted(
    job: ClaimedJob,
    request: SopJobRequest,
    sources: SopSourceRefs,
    scope: EvidenceScope,
    result: Extract<UniSopResult, { ok: true }>,
  ): Promise<'completed' | 'failed' | 'cancelled' | 'skipped'> {
    // 매핑은 DB 밖에서 끝낸다 — 트랜잭션 안에서 계산하면 실패 하나가 잡 전체를
    // 되돌린다.
    const nodes: Array<SopNodeDraft & { warnings: SopMappingWarning[] }> = [];
    const rejected: Array<{ reason: string; sequence: number }> = [];
    const sourceRefs: Array<{ documentId: string; chunkId: string | null }> = [];
    const usedKeys = new Set<string>();
    let sequence = 0;
    let outOfScopeNodes = 0;
    for (const event of result.events) {
      if (event.kind === 'sources') {
        sourceRefs.push(...event.sources);
        continue;
      }
      if (event.kind !== 'compn') continue;
      sequence += 1;
      const mapped = mapUniCompn(event.raw, sequence);
      if (!mapped.ok) {
        rejected.push({ reason: mapped.reason, sequence });
        continue;
      }
      const node = mapped.value.node;
      const warnings = [...mapped.value.warnings];

      // **키 충돌을 여기서 푼다.** 서로 다른 compnSn이 같은 키로 접힐 수 있고
      // (`"3"`와 `"#3"`이 둘 다 `n3`가 된다) UNI가 같은 키를 두 번 보낼 수도
      // 있다. 그대로 두면 `uk_sop_node_key`가 23505를 던져 **트랜잭션 전체가**
      // 되돌아가고, 잡은 RUNNING에 머물다 리스 만료 → 재클레임 → 같은 실패를
      // 반복한 끝에 `MAX_ATTEMPTS_EXCEEDED`라는 엉뚱한 사유로 끝난다.
      // 검증 위반으로 남기려면 먼저 **저장이 돼야 한다**(ADR-38 D4).
      if (usedKeys.has(node.nodeKey)) {
        node.nodeKey = `${node.nodeKey}-${sequence}`.slice(0, 80);
        if (!warnings.includes('NODE_KEY_NORMALIZED')) warnings.push('NODE_KEY_NORMALIZED');
      }
      usedKeys.add(node.nodeKey);

      // **근거 범위 이탈을 검출한다.** UNI가 `doc_ids`와 프롬프트를 둘 다
      // 무시하면 동결 근거 밖 절차가 만들어진다. 요청 범위와 응답 출처를 둘 다
      // 쥐고 있으므로 비교는 한 줄이다 — 잡지 못하는 것이 아니었다. 거부하지는
      // 않는다(스트리밍 원칙): 표시하고 사용자가 판단한다.
      const outOfScope = node.sourceRefs.filter((ref) => !scope.toKnowledgeDocumentId.has(ref));
      if (outOfScope.length > 0) {
        warnings.push('SOURCE_OUT_OF_SCOPE');
        outOfScopeNodes += 1;
      }
      // 저장·화면에는 UNE 문서 id를 쓴다. provider id는 원문 추적에만 남는다 —
      // 그래야 UNI가 id 체계를 바꿔도 저장된 근거 참조가 끊기지 않는다.
      node.sourceRefs = node.sourceRefs.map((ref) => scope.toKnowledgeDocumentId.get(ref) ?? ref);

      nodes.push({ ...node, warnings });
    }

    if (nodes.length === 0) {
      return this.finalizeFailed(
        job,
        {
          code: 'UNI-422-003',
          reason: 'NO_MAPPABLE_NODE',
          message: 'UNI 응답에서 사용할 수 있는 노드가 하나도 없습니다.',
          retryable: true,
          partialNodeCount: 0,
        },
        result,
      );
    }

    const edges = deriveSequentialEdges(nodes);
    const graph = { nodes, edges };
    const violations: SopGraphViolation[] = validateSopGraph(graph);
    const graphHash = createHash('sha256')
      .update(sopGraphHashInput(graph, UNI_SOP_MAPPER_VERSION))
      .digest('hex');

    return this.db.withTenant(job.tenantId, async (client) => {
      const current = await findJobForUpdate(client, job.tenantId, job.jobId);
      if (!current) return 'skipped';
      if (current.status === 'CANCEL_REQUESTED') {
        await this.applyCancelled(client, job, '결과 반영 전 취소 요청 확인 — 결과 폐기');
        return 'cancelled';
      }
      if (current.status !== 'RUNNING') return 'skipped';

      const sopId = await ensureSop(client, {
        tenantId: job.tenantId,
        situationId: job.aggregateId,
        // `situation.title`도 varchar(300)이라 접미사를 붙이면 넘칠 수 있다.
        title: fitTitle(`${sources.situationTitle} 대응 절차`).title,
        hazardType: sources.hazardType,
        createdBy: request.requestedBy,
      });
      const versionNo = await nextSopVersionNo(client, sopId);
      const sopVersionId = await insertSopVersion(client, {
        sopId,
        versionNo,
        graphHash,
        mapperVersion: UNI_SOP_MAPPER_VERSION,
        snapshotId: request.snapshotId,
        evidenceSetId: request.evidenceSetId,
        generationJobId: job.jobId,
        violations,
        createdBy: request.requestedBy,
        adapterId: result.meta.adapterId,
        generatedByMock: this.uni.isMock,
      });
      await insertSopGraph(client, sopVersionId, nodes, edges);
      await pointSopAtVersion(client, sopId, sopVersionId);

      await appendJobEvent(client, job.jobId, 'provider.responded', {
        adapterId: result.meta.adapterId,
        mappingVersion: result.meta.mappingVersion,
        latencyMs: result.meta.latencyMs,
        eventCount: result.meta.eventCount,
        rawRequest: cap(result.raw.requestSummary),
        rawResponse: capFrames(result.raw.frames),
      });
      if (sourceRefs.length > 0) {
        // provider id를 그대로 흘리면 클라이언트가 `knowledge_document`와
        // 대조할 수 없다(ADR-38 D11은 이름만이 아니라 값에도 적용된다).
        await appendJobEvent(client, job.jobId, 'sop.sources', {
          sources: sourceRefs.map((ref) => ({
            documentId: scope.toKnowledgeDocumentId.get(ref.documentId) ?? null,
            providerDocumentId: ref.documentId,
            chunkId: ref.chunkId,
            inScope: scope.toKnowledgeDocumentId.has(ref.documentId),
          })),
        });
      }
      for (const node of nodes) {
        // 화면용 투영이다 — UNI의 `__compn__`을 그대로 흘리지 않는다.
        await appendJobEvent(client, job.jobId, 'sop.node', {
          nodeKey: node.nodeKey,
          nodeType: node.type,
          title: node.title,
          taskCount: node.tasks.length,
          warnings: node.warnings,
        });
      }
      await setJobStatus(client, job.tenantId, job.jobId, {
        status: 'COMPLETED',
        progressPct: 100,
        finished: true,
      });
      await appendJobEvent(client, job.jobId, 'job.completed', {
        sopId,
        sopVersionId,
        sopVersionNo: versionNo,
        graphHash,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        // 위반과 거부는 **결과의 일부**다. 실패가 아니라 "고칠 것이 남았다"이고,
        // 화면이 그것을 보여줘야 사용자가 Canvas에서 고칠 수 있다.
        graphViolations: violations,
        rejectedNodeCount: rejected.length,
        outOfScopeNodeCount: outOfScopeNodes,
      });
      await markSituationSopReady(client, job.tenantId, job.aggregateId);
      await insertAudit(client, {
        tenantId: job.tenantId,
        actorId: request.requestedBy,
        action: 'SOP_VERSION_GENERATED',
        resourceType: 'SOP',
        resourceId: sopId,
        correlationId: job.correlationId,
        detail: {
          jobId: job.jobId,
          sopVersionId,
          versionNo,
          mapperVersion: UNI_SOP_MAPPER_VERSION,
          adapterId: result.meta.adapterId,
          isMock: this.uni.isMock,
          graphViolations: violations,
          rejectedNodeCount: rejected.length,
          outOfScopeNodeCount: outOfScopeNodes,
        },
      });
      return 'completed';
    });
  }

  private async finalizeFailed(
    job: ClaimedJob,
    failure: SopFailure,
    result: UniSopResult | undefined,
  ): Promise<'failed' | 'cancelled' | 'skipped'> {
    return this.db.withTenant(job.tenantId, async (client) => {
      const current = await findJobForUpdate(client, job.tenantId, job.jobId);
      if (!current) return 'skipped';
      if (current.status === 'CANCEL_REQUESTED') {
        await this.applyCancelled(client, job, '실패 반영 전 취소 요청 확인');
        return 'cancelled';
      }
      if (current.status !== 'RUNNING') return 'skipped';
      if (result) {
        // 실패해도 원문은 남는다 — 무엇을 받았기에 실패했는지가 유일한 단서다.
        await appendJobEvent(client, job.jobId, 'provider.failed', {
          // provider 원문 사유는 내부 이벤트에만 남는다(공개 어휘가 아니다).
          ...(failure.providerMessage ? { providerMessage: failure.providerMessage } : {}),
          adapterId: result.meta.adapterId,
          mappingVersion: result.meta.mappingVersion,
          latencyMs: result.meta.latencyMs,
          eventCount: result.meta.eventCount,
          rawRequest: cap(result.raw.requestSummary),
          rawResponse: capFrames(result.raw.frames),
        });
      }
      await this.applyFailed(client, job, failure);
      return 'failed';
    });
  }

  private async applyFailed(
    client: Parameters<typeof setJobStatus>[0],
    job: ClaimedJob,
    failure: SopFailure,
  ): Promise<void> {
    const errorJson: Record<string, unknown> = {
      code: failure.code,
      reason: failure.reason,
      message: failure.message,
      retryable: failure.retryable,
      ...(failure.providerCode ? { providerCode: failure.providerCode } : {}),
      ...(failure.partialNodeCount !== undefined
        ? { partialNodeCount: failure.partialNodeCount }
        : {}),
    };
    // providerMessage는 errorJson에 넣지 않는다 — `generation_job.error_json`은
    // UNE-PLAN-010 응답과 job.failed 이벤트로 둘 다 사용자에게 나간다.
    await setJobStatus(client, job.tenantId, job.jobId, {
      status: 'FAILED',
      errorJson,
      finished: true,
    });
    await appendJobEvent(client, job.jobId, 'job.failed', errorJson);
  }

  private async applyCancelled(
    client: Parameters<typeof setJobStatus>[0],
    job: ClaimedJob,
    reason: string,
  ): Promise<void> {
    await setJobStatus(client, job.tenantId, job.jobId, {
      status: 'CANCELLED',
      errorJson: null,
      finished: true,
    });
    await appendJobEvent(client, job.jobId, 'job.cancelled', { reason });
  }

  private async finalizeCancelled(job: ClaimedJob): Promise<'cancelled' | 'skipped'> {
    return this.db.withTenant(job.tenantId, async (client) => {
      const current = await findJobForUpdate(client, job.tenantId, job.jobId);
      if (!current) return 'skipped';
      if (current.status !== 'CANCEL_REQUESTED' && current.status !== 'RUNNING') return 'skipped';
      await this.applyCancelled(client, job, '취소 요청 처리');
      return 'cancelled';
    });
  }
}

/**
 * UNI에 보낼 프롬프트.
 *
 * **확정 사실과 동결 근거만 넣는다.** LLM이 사실을 만들어내지 않게 하려면
 * 무엇을 근거로 쓰라고 명시해야 하고, 그 범위는 EvidenceSet이 정한다
 * (도메인 규칙: LLM 출력은 권위 있는 사실 출처가 아니다).
 *
 * 개인정보는 스냅샷 단계에서 이미 최소화돼 있다고 가정하지 않는다 — 사실
 * 본문을 그대로 넣되 **`job_event`에는 남기지 않는다**(위 provider.requested가
 * 신원과 개수만 적는 이유다).
 */
export function buildPrompt(sources: SopSourceRefs, documentIds: string[]): string {
  return [
    '다음 확정 상황 사실과 동결 근거만을 사용하여 표준 대응 절차(SOP)를 생성한다.',
    `상황: ${sources.situationTitle} (재난유형 ${sources.hazardType})`,
    `근거 질의: ${sources.evidenceQuery}`,
    `근거 문서: ${documentIds.join(', ')}`,
    '확정 사실:',
    JSON.stringify(sources.factsJson),
    '근거에 없는 절차는 만들지 않는다. 각 노드에 근거 문서를 표시한다.',
  ].join('\n');
}
