import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  buildSopJobRequest,
  canStartSopJob,
  isSopGraphSchemaVersion,
  jobIdempotencyKey,
  type SopGraphSchemaVersion,
} from '@une/domain';
import { AuditRepository } from '../common/audit.repository';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { EvidenceRepository } from '../knowledge/evidence.repository';
import { GenerationJobRepository, type JobRow } from '../plan/generation-job.repository';
import { JobEventRepository } from '../plan/job-event.repository';
import { toJobResource, type JobResource } from '../plan/toc-job.service';
import type { RequestMeta } from '../plan/plan.service';
import { SituationRepository } from '../situation/situation.repository';
import { sopErrors } from './sop-errors';

const SOP_JOB_ENDPOINT_TEMPLATE = 'POST /situations/{id}/sop-generation-jobs';

export interface SopGenerationRequestBody {
  snapshotId: string;
  evidenceSetId: string;
  graphSchemaVersion: SopGraphSchemaVersion;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/**
 * 계약 `SopGenerationRequest`를 읽는다.
 *
 * 계약 필드명은 `schemaVersion`이고 내부 이름은 `graphSchemaVersion`이다 —
 * `UniSopMapper` 버전과 헷갈리지 않기 위해서다(도메인 `SopJobRequest` 주석).
 * 경계에서 한 번 옮기고 안에서는 헷갈릴 수 없는 이름만 쓴다.
 */
export function parseSopGenerationBody(body: unknown): SopGenerationRequestBody {
  const rec = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const violations: Array<{ field: string; reason: string }> = [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const snapshotId = rec.snapshotId;
  if (typeof snapshotId !== 'string' || !uuid.test(snapshotId)) {
    violations.push({ field: 'snapshotId', reason: 'UUID여야 합니다.' });
  }
  const evidenceSetId = rec.evidenceSetId;
  if (typeof evidenceSetId !== 'string' || !uuid.test(evidenceSetId)) {
    violations.push({ field: 'evidenceSetId', reason: 'UUID여야 합니다.' });
  }
  const schemaVersion = rec.schemaVersion;
  if (!isSopGraphSchemaVersion(schemaVersion)) {
    violations.push({ field: 'schemaVersion', reason: "'1.0'만 지원합니다." });
  }
  if (violations.length > 0) throw sopErrors.invalidRequest(violations);

  return {
    snapshotId: snapshotId as string,
    evidenceSetId: evidenceSetId as string,
    graphSchemaVersion: schemaVersion as SopGraphSchemaVersion,
  };
}

/**
 * UNE-SOP-001 / 002 (CC-240).
 *
 * API는 큐에 넣기만 한다. UNI 호출도, RUNNING도, 종료 상태도 워커의 것이다 —
 * 외부 호출이 트랜잭션 안에서 돌지 않는다는 규칙이 여기서도 그대로다.
 */
@Injectable()
export class SopJobService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SituationRepository) private readonly situations: SituationRepository,
    @Inject(EvidenceRepository) private readonly evidence: EvidenceRepository,
    @Inject(GenerationJobRepository) private readonly jobs: GenerationJobRepository,
    @Inject(JobEventRepository) private readonly jobEvents: JobEventRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  /** UNE-SOP-001. 한 트랜잭션: 상황 잠금 → 선행조건 → 잡 삽입 → job.queued → 감사. */
  async requestSopJob(
    auth: AuthContext,
    situationId: string,
    body: SopGenerationRequestBody,
    clientIdempotencyKey: string | undefined,
    meta: RequestMeta,
  ): Promise<JobResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const situation = await this.situations.findSituation(c, auth.tenantId, situationId, {
        forUpdate: true,
      });
      if (!situation) throw sopErrors.situationNotFound();
      if (!canStartSopJob(situation.status)) throw sopErrors.notStartable(situation.status);

      // 확정 판이 없으면 위 상태 검사에서 이미 걸리지만, 상태와 포인터가
      // 어긋난 행이 있을 수 있다 — 그 경우도 생성을 막는다.
      if (!situation.currentSnapshotId) throw sopErrors.notStartable(situation.status);
      if (body.snapshotId !== situation.currentSnapshotId) {
        throw sopErrors.snapshotNotCurrent(situation.currentSnapshotId);
      }

      const set = await this.evidence.findSet(c, auth.tenantId, body.evidenceSetId);
      // 다른 상황의 근거집합이면 **찾을 수 없다고 답한다** — 존재 여부가
      // 새어나가지 않게 한다(테넌트 격리와 같은 축).
      if (!set || set.situationId !== situationId) throw sopErrors.evidenceNotFrozen();
      if (set.status !== 'FROZEN') throw sopErrors.evidenceNotFrozen();
      // 동결 근거가 낡은 판 위에서 모아졌으면 SOP의 사실과 근거가 어긋난다.
      if (set.snapshotId !== body.snapshotId) {
        throw sopErrors.snapshotNotCurrent(situation.currentSnapshotId);
      }

      const active = await this.jobs.findActiveSopJob(c, auth.tenantId, situationId);
      if (active) throw sopErrors.jobInProgress(active.jobId);

      const requestJson = buildSopJobRequest({
        snapshotId: body.snapshotId,
        evidenceSetId: body.evidenceSetId,
        graphSchemaVersion: body.graphSchemaVersion,
        requestedBy: auth.userId,
      });
      const idempotencyKey = jobIdempotencyKey(
        'SOP',
        SOP_JOB_ENDPOINT_TEMPLATE,
        situationId,
        clientIdempotencyKey ?? randomUUID(),
      );

      // api_idempotency 뒤의 두 번째 그물(TOC 잡과 같은 형태). SAVEPOINT가
      // 있어야 23505 후에도 바깥 트랜잭션을 계속 쓸 수 있다.
      await c.query('SAVEPOINT une_sop_job_insert');
      let job: JobRow;
      try {
        job = await this.jobs.insertJob(c, {
          tenantId: auth.tenantId,
          jobType: 'SOP',
          aggregateType: 'SITUATION',
          aggregateId: situationId,
          providerCode: 'UNI',
          requestJson,
          idempotencyKey,
          correlationId: meta.correlationId,
        });
        await c.query('RELEASE SAVEPOINT une_sop_job_insert');
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        await c.query('ROLLBACK TO SAVEPOINT une_sop_job_insert');
        const existing = await this.jobs.findJobByIdempotencyKey(c, auth.tenantId, idempotencyKey);
        if (!existing) throw err;
        if (existing.aggregateId !== situationId || existing.jobType !== 'SOP') {
          // 키가 이미 상황+유형을 묶고 있으므로 여기 오면 해시 범위 버그다.
          throw sopErrors.invalidRequest([
            { field: 'Idempotency-Key', reason: '다른 대상의 요청에 사용된 키입니다.' },
          ]);
        }
        return toJobResource(existing);
      }

      await this.jobEvents.append(c, job.jobId, 'job.queued', {
        situationId,
        snapshotId: body.snapshotId,
        evidenceSetId: body.evidenceSetId,
        graphSchemaVersion: body.graphSchemaVersion,
      });
      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'SOP_GENERATION_REQUESTED',
        resourceType: 'SITUATION',
        resourceId: situationId,
        correlationId: meta.correlationId,
        ...(meta.ip ? { ip: meta.ip } : {}),
        ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
        detail: {
          jobId: job.jobId,
          snapshotId: body.snapshotId,
          evidenceSetId: body.evidenceSetId,
        },
      });
      return toJobResource(job);
    });
  }
}
