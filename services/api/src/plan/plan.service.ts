import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ApiError, type ErrorViolation } from '../common/api-error';
import { AuditRepository } from '../common/audit.repository';

import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { validatePlanContext } from './plan-context.validator';
import { APPROVAL_LOCKED_STATUSES, canonicalHash, nextStatusOnContextConfirm } from '@une/domain';
import {
  PlanRepository,
  type ContextDraftRow,
  type PlanMetaPatch,
  type PlanRow,
  type PlanSearchQuery,
  type SnapshotRow,
} from './plan.repository';

/** Contract PlanResource (dates serialized ISO-8601 UTC per backend rules). */
export interface PlanResource {
  planId: string;
  tenantId: string;
  title: string;
  hazardType: string;
  managementPhase: string;
  status: string;
  startMode: string;
  documentId: string | null;
  currentContextSnapshotId: string | null;
  currentTocVersionId: string | null;
  ownerId: string;
  versionNo: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanDetailResource extends PlanResource {
  currentContextSnapshot: SnapshotResource | null;
}

export interface SnapshotResource {
  contextSnapshotId: string;
  planId: string;
  versionNo: number;
  contextJson: unknown;
  contentHash: string;
  supersedesId: string | null;
  confirmedBy: string;
  confirmedAt: string;
}

export interface ContextDraftResource {
  contextDraftId: string;
  planId: string;
  contextJson: unknown;
  schemaVersion: string;
  updatedBy: string;
  updatedAt: string;
}

export interface PlanPage {
  items: PlanResource[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface RequestMeta {
  correlationId: string;
  ip?: string;
  userAgent?: string;
}

export const planErrors = {
  invalidRequest: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'PLAN-4001', '계획서 요청이 올바르지 않습니다.', { violations }),
  invalidQuery: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'PLAN-4002', '계획서 목록 조건이 올바르지 않습니다.', { violations }),
  notFound: (): ApiError => new ApiError(404, 'PLAN-4003', '계획서를 찾을 수 없습니다.'),
  snapshotListNotFound: (): ApiError =>
    new ApiError(404, 'PLAN-404-002', '계획서를 찾을 수 없습니다.'),
  versionConflict: (currentVersion: number): ApiError =>
    new ApiError(409, 'PLAN-409-001', '계획서가 다른 사용자에 의해 변경되었습니다.', {
      recoverable: true,
      userAction: `최신 버전(${currentVersion})을 다시 조회한 뒤 수정하십시오.`,
    }),
  deleteBlocked: (status: string): ApiError =>
    new ApiError(403, 'PLAN-403-001', `현재 상태(${status})에서는 삭제할 수 없습니다.`),
  contextInvalid: (violations: ErrorViolation[]): ApiError =>
    new ApiError(422, 'PLAN-422-001', '기준정보가 스키마를 만족하지 않습니다.', { violations }),
  // PLAN-412-001 stays reserved for its design 8.3 meaning ("snapshot 미확정",
  // used by CC-120 toc-jobs); state preconditions get their own code (ADR-23 D5).
  preconditionFailed: (reason: string): ApiError =>
    new ApiError(412, 'PLAN-412-002', reason, {
      userAction: '계획서 상태를 확인한 뒤 다시 시도하십시오.',
    }),
  ifMatchRequired: (): ApiError =>
    new ApiError(428, 'COM-0428', 'If-Match 헤더가 필요합니다.', {
      userAction: '현재 버전을 조회하여 If-Match로 제시하십시오.',
    }),
};

const DEFAULT_CONTEXT_SCHEMA_VERSION = '1.0';

function iso(value: Date): string {
  return value.toISOString();
}

function toPlanResource(row: PlanRow): PlanResource {
  return {
    planId: row.planId,
    tenantId: row.tenantId,
    title: row.title,
    hazardType: row.hazardType,
    managementPhase: row.managementPhase,
    status: row.status,
    startMode: row.startMode,
    documentId: row.documentId,
    currentContextSnapshotId: row.currentContextSnapshotId,
    currentTocVersionId: row.currentTocVersionId,
    ownerId: row.ownerId,
    versionNo: row.versionNo,
    deletedAt: row.deletedAt ? iso(row.deletedAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toSnapshotResource(row: SnapshotRow): SnapshotResource {
  return {
    contextSnapshotId: row.contextSnapshotId,
    planId: row.planId,
    versionNo: row.versionNo,
    contextJson: row.contextJson,
    contentHash: row.contentHash,
    supersedesId: row.supersedesId,
    confirmedBy: row.confirmedBy,
    confirmedAt: iso(row.confirmedAt),
  };
}

function toDraftResource(row: ContextDraftRow): ContextDraftResource {
  return {
    contextDraftId: row.contextDraftId,
    planId: row.planId,
    contextJson: row.contextJson,
    schemaVersion: row.schemaVersion,
    updatedBy: row.updatedBy,
    updatedAt: iso(row.updatedAt),
  };
}

@Injectable()
export class PlanService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PlanRepository) private readonly repo: PlanRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  /** UNE-PLAN-001. */
  async create(
    auth: AuthContext,
    input: { title: string; hazardType: string; managementPhase: string; startMode: string },
    meta: RequestMeta,
  ): Promise<PlanResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const plan = await this.repo.insertPlan(c, auth.tenantId, {
        ...input,
        ownerId: auth.userId,
      });
      await this.insertPlanAudit(c, auth, meta, 'PLAN_CREATED', plan.planId, {
        title: plan.title,
        hazardType: plan.hazardType,
        managementPhase: plan.managementPhase,
        startMode: plan.startMode,
      });
      return toPlanResource(plan);
    });
  }

  /** UNE-PLAN-002. */
  async search(auth: AuthContext, query: PlanSearchQuery): Promise<PlanPage> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const { items, totalElements } = await this.repo.searchPlans(c, auth.tenantId, query);
      return {
        items: items.map(toPlanResource),
        page: query.page,
        size: query.size,
        totalElements,
        totalPages: Math.ceil(totalElements / query.size),
      };
    });
  }

  /** UNE-PLAN-003. Trashed plans stay readable (보관함 조회). */
  async detail(auth: AuthContext, planId: string): Promise<PlanDetailResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const plan = await this.repo.findPlan(c, auth.tenantId, planId);
      if (!plan) throw planErrors.notFound();
      const snapshot = plan.currentContextSnapshotId
        ? await this.repo.findSnapshot(c, auth.tenantId, plan.currentContextSnapshotId)
        : null;
      return {
        ...toPlanResource(plan),
        currentContextSnapshot: snapshot ? toSnapshotResource(snapshot) : null,
      };
    });
  }

  /** UNE-PLAN-004. If-Match carries the version_no; the row is locked first
   * (before_json audit needs pre-change values) and the expected version
   * still sits in the UPDATE's WHERE as a second guard. */
  async patchMeta(
    auth: AuthContext,
    planId: string,
    expectedVersion: number,
    patch: PlanMetaPatch,
    meta: RequestMeta,
  ): Promise<PlanResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const current = await this.repo.findPlan(c, auth.tenantId, planId, { forUpdate: true });
      if (!current) throw planErrors.notFound();
      if (current.deletedAt) {
        throw planErrors.preconditionFailed('휴지통의 계획서는 수정할 수 없습니다.');
      }
      if (current.versionNo !== expectedVersion) {
        throw planErrors.versionConflict(current.versionNo);
      }
      const updated = await this.repo.updatePlanMeta(
        c,
        auth.tenantId,
        planId,
        expectedVersion,
        patch,
      );
      if (!updated) throw planErrors.versionConflict(current.versionNo);
      await this.insertPlanAudit(
        c,
        auth,
        meta,
        'PLAN_UPDATED',
        planId,
        { patch: { ...patch }, versionNo: updated.versionNo },
        {
          title: current.title,
          hazardType: current.hazardType,
          managementPhase: current.managementPhase,
          versionNo: current.versionNo,
        },
      );
      return toPlanResource(updated);
    });
  }

  /** UNE-PLAN-005. Idempotent trash move (already-trashed → no-op). */
  async moveToTrash(
    auth: AuthContext,
    planId: string,
    reason: string | undefined,
    meta: RequestMeta,
  ): Promise<void> {
    await this.db.withTenant(auth.tenantId, async (c) => {
      const plan = await this.repo.findPlan(c, auth.tenantId, planId, { forUpdate: true });
      if (!plan) throw planErrors.notFound();
      if (plan.deletedAt) return;
      if (APPROVAL_LOCKED_STATUSES.has(plan.status)) throw planErrors.deleteBlocked(plan.status);
      await this.repo.softDeletePlan(c, auth.tenantId, planId);
      await this.insertPlanAudit(
        c,
        auth,
        meta,
        'PLAN_DELETED',
        planId,
        { reason: reason ?? null },
        { status: plan.status, deletedAt: null },
      );
    });
  }

  /** UNE-PLAN-006. Relaxed schema validation; single draft upsert (ADR-23 D2). */
  async saveDraft(
    auth: AuthContext,
    planId: string,
    context: unknown,
    schemaVersion: string | undefined,
    meta: RequestMeta,
  ): Promise<ContextDraftResource> {
    const violations = validatePlanContext(context, 'draft');
    if (violations.length > 0) throw planErrors.contextInvalid(violations);
    return this.db.withTenant(auth.tenantId, async (c) => {
      const plan = await this.repo.findPlan(c, auth.tenantId, planId);
      if (!plan) throw planErrors.notFound();
      if (plan.deletedAt) {
        throw planErrors.preconditionFailed('휴지통의 계획서에는 기준정보를 저장할 수 없습니다.');
      }
      if (APPROVAL_LOCKED_STATUSES.has(plan.status)) {
        throw planErrors.preconditionFailed(
          `현재 상태(${plan.status})에서는 기준정보를 저장할 수 없습니다.`,
        );
      }
      const draft = await this.repo.upsertDraft(
        c,
        planId,
        context,
        schemaVersion ?? DEFAULT_CONTEXT_SCHEMA_VERSION,
        auth.userId,
      );
      await this.insertPlanAudit(c, auth, meta, 'PLAN_CONTEXT_SAVED', planId, {
        schemaVersion: draft.schemaVersion,
      });
      return toDraftResource(draft);
    });
  }

  /** UNE-PLAN-007. Immutable snapshot confirm (ADR-23 D4): strict validation,
   * canonical SHA-256, per-plan version serialization via plan FOR UPDATE,
   * same-content dedupe, pointer/status update in the same transaction. */
  async confirmSnapshot(
    auth: AuthContext,
    planId: string,
    context: unknown,
    meta: RequestMeta,
  ): Promise<{ snapshot: SnapshotResource; created: boolean; planVersionNo: number }> {
    const violations = validatePlanContext(context, 'strict');
    if (violations.length > 0) throw planErrors.contextInvalid(violations);
    const contentHash = canonicalHash(context);
    return this.db.withTenant(auth.tenantId, async (c) => {
      const plan = await this.repo.findPlan(c, auth.tenantId, planId, { forUpdate: true });
      if (!plan) throw planErrors.notFound();
      if (plan.deletedAt) {
        throw planErrors.preconditionFailed('휴지통의 계획서는 기준정보를 확정할 수 없습니다.');
      }
      if (APPROVAL_LOCKED_STATUSES.has(plan.status)) {
        // The confirmed context of an approved/final plan is a record; its
        // revision belongs to the approval flow (CC-170+, ADR-23 D4).
        throw planErrors.preconditionFailed(
          `현재 상태(${plan.status})에서는 기준정보를 확정할 수 없습니다.`,
        );
      }
      if (plan.currentContextSnapshotId) {
        const current = await this.repo.findSnapshot(
          c,
          auth.tenantId,
          plan.currentContextSnapshotId,
        );
        if (current && current.contentHash === contentHash) {
          return {
            snapshot: toSnapshotResource(current),
            created: false,
            planVersionNo: plan.versionNo,
          };
        }
      }
      const versionNo = await this.repo.nextSnapshotVersion(c, planId);
      const snapshot = await this.repo.insertSnapshot(
        c,
        planId,
        versionNo,
        context,
        contentHash,
        plan.currentContextSnapshotId,
        auth.userId,
      );
      const updatedPlan = await this.repo.setCurrentSnapshot(
        c,
        auth.tenantId,
        planId,
        snapshot.contextSnapshotId,
        nextStatusOnContextConfirm(plan.status),
      );
      await this.insertPlanAudit(
        c,
        auth,
        meta,
        'CONTEXT_SNAPSHOT_CREATED',
        planId,
        { contextSnapshotId: snapshot.contextSnapshotId, versionNo, contentHash },
        { status: plan.status, currentContextSnapshotId: plan.currentContextSnapshotId },
      );
      return {
        snapshot: toSnapshotResource(snapshot),
        created: true,
        planVersionNo: updatedPlan.versionNo,
      };
    });
  }

  /** UNE-PLAN-008. */
  async listSnapshots(auth: AuthContext, planId: string): Promise<SnapshotResource[]> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const plan = await this.repo.findPlan(c, auth.tenantId, planId);
      if (!plan) throw planErrors.snapshotListNotFound();
      const rows = await this.repo.listSnapshots(c, auth.tenantId, planId);
      return rows.map(toSnapshotResource);
    });
  }

  private async insertPlanAudit(
    client: PoolClient,
    auth: AuthContext,
    meta: RequestMeta,
    action: string,
    planId: string,
    detail: Record<string, unknown>,
    before?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.insertAudit(client, {
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action,
      resourceType: 'PLAN',
      resourceId: planId,
      correlationId: meta.correlationId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      before,
      detail,
    });
  }
}
