import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  buildSopValidationReport,
  canApproveSopVersion,
  canEditSopGraph,
  canTransitionSop,
  sopGraphHashInput,
  SOP_VALIDATOR_VERSION,
  type SopEdgeDraft,
  type SopValidationReport,
} from '@une/domain';
import { AuditRepository } from '../common/audit.repository';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import type { RequestMeta } from '../plan/plan.service';
import { SituationRepository } from '../situation/situation.repository';
import { sopCanvasErrors } from './sop-canvas-errors';
import { SopRepository, type SopNodeRow, type SopRow, type SopVersionRow } from './sop.repository';

/**
 * UNE-SOP-003~009 (CC-250).
 *
 * 캔버스 편집·검증·검토·승인. 외부 provider를 부르지 않는다 — CC-240이 만든
 * DRAFT를 **사람이** 고치고 확정하는 흐름이다.
 *
 * 편집 버전의 `schema_version`은 매퍼 버전이 아니라 **편집기 버전**이다.
 * 사람이 고친 그래프에 "UNI 응답을 어느 규칙으로 옮겼는가"를 적으면 거짓이 된다.
 */
export const SOP_EDITOR_VERSION = 'sop-editor-1';

export interface SopResource {
  sopId: string;
  situationId: string | null;
  title: string;
  hazardType: string;
  status: string;
  currentVersionId: string | null;
  currentVersionNo: number | null;
  createdBy: string | null;
  createdAt: string;
}

export interface SopVersionResource {
  sopVersionId: string;
  sopId: string;
  versionNo: number;
  status: string;
  graphHash: string;
  schemaVersion: string;
  sourceSnapshotId: string | null;
  sourceEvidenceSetId: string | null;
  graphViolations: string[] | null;
  adapterId: string | null;
  generatedByMock: boolean | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface SopGraphResource {
  sop: SopResource;
  version: SopVersionResource;
  nodes: Array<{
    nodeKey: string;
    nodeType: string;
    title: string;
    tasks: Array<{ instruction: string; assigneeHint: string | null }>;
    decisionExpression: string | null;
    sourceRefs: string[];
    providerNodeKey: string | null;
    mappingWarnings: string[] | null;
    position: { x: number; y: number } | null;
  }>;
  edges: SopEdgeDraft[];
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toSopResource(row: SopRow, currentVersionNo: number | null): SopResource {
  return {
    sopId: row.sopId,
    situationId: row.situationId,
    title: row.title,
    hazardType: row.hazardType,
    status: row.status,
    currentVersionId: row.currentVersionId,
    currentVersionNo,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt) as string,
  };
}

function toVersionResource(row: SopVersionRow): SopVersionResource {
  return {
    sopVersionId: row.sopVersionId,
    sopId: row.sopId,
    versionNo: row.versionNo,
    status: row.status,
    graphHash: row.graphHash,
    schemaVersion: row.schemaVersion,
    sourceSnapshotId: row.sourceSnapshotId,
    sourceEvidenceSetId: row.sourceEvidenceSetId,
    graphViolations: row.graphViolations,
    adapterId: row.adapterId,
    generatedByMock: row.generatedByMock,
    approvedBy: row.approvedBy,
    approvedAt: iso(row.approvedAt),
    createdAt: iso(row.createdAt) as string,
  };
}

@Injectable()
export class SopService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SopRepository) private readonly repo: SopRepository,
    @Inject(SituationRepository) private readonly situations: SituationRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  /** UNE-SOP-003 */
  async createSop(
    auth: AuthContext,
    input: { situationId: string | null; title: string; hazardType: string },
    meta: RequestMeta,
  ): Promise<SopResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      if (input.situationId) {
        // 남의 기관 상황에 SOP를 붙일 수 없다. FK만으로는 테넌트를 막지 못한다.
        const situation = await this.situations.findSituation(c, auth.tenantId, input.situationId);
        if (!situation) throw sopCanvasErrors.situationNotFound();
      }
      const sop = await this.repo.insertSop(c, {
        tenantId: auth.tenantId,
        situationId: input.situationId,
        title: input.title,
        hazardType: input.hazardType,
        createdBy: auth.userId,
      });
      await this.writeAudit(c, auth, meta, 'SOP_CREATED', sop.sopId, {
        title: sop.title,
        hazardType: sop.hazardType,
        situationId: sop.situationId,
      });
      return toSopResource(sop, null);
    });
  }

  /** UNE-SOP-004 */
  async listSops(
    auth: AuthContext,
    query: { status?: string; hazardType?: string; page: number; size: number },
  ): Promise<{ items: SopResource[]; page: number; size: number; totalElements: number }> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const found = await this.repo.searchSops(c, auth.tenantId, query);
      // 목록에서 버전 번호까지 세지 않는다 — N+1이 되고, 목록 화면이 요구하는
      // 것은 "어느 SOP가 있는가"다. 번호가 필요하면 UNE-SOP-005가 준다.
      return {
        items: found.items.map((row) => toSopResource(row, null)),
        page: query.page,
        size: query.size,
        totalElements: found.totalElements,
      };
    });
  }

  /** UNE-SOP-005 */
  async getGraph(
    auth: AuthContext,
    sopId: string,
    versionId: string | null,
  ): Promise<SopGraphResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const sop = await this.repo.findSop(c, auth.tenantId, sopId);
      if (!sop) throw sopCanvasErrors.notFound();

      const targetId = versionId ?? sop.currentVersionId;
      // 버전이 하나도 없는 SOP는 만들어질 수 있다(UNE-SOP-003이 껍데기만 만든다).
      if (!targetId) throw sopCanvasErrors.versionNotFound();
      const version = await this.repo.findVersion(c, sopId, targetId);
      if (!version) throw sopCanvasErrors.versionNotFound();

      const graph = await this.repo.findGraph(c, version.sopVersionId);
      return {
        sop: toSopResource(sop, version.versionNo),
        version: toVersionResource(version),
        nodes: graph.nodes.map((n) => ({
          nodeKey: n.nodeKey,
          nodeType: n.type,
          title: n.title,
          tasks: n.tasks,
          decisionExpression: n.decisionExpression,
          sourceRefs: n.sourceRefs,
          providerNodeKey: n.providerNodeKey,
          mappingWarnings: n.warnings,
          position: n.position,
        })),
        edges: graph.edges,
      };
    });
  }

  /**
   * UNE-SOP-006 — Draft 버전 저장.
   *
   * **덮어쓰지 않고 새 버전을 만든다.** 편집이 기존 행을 고치면 "무엇이
   * 바뀌었는가"에 답할 수 없고, 승인된 버전을 실수로 건드릴 길이 생긴다.
   *
   * 동시성은 `baseVersionId`로 본다(설계 09 ALT-02). SOP 행을 잠그고 현재
   * 버전과 대조하므로, 같은 순간 둘이 저장하면 한쪽만 통과한다.
   */
  async saveDraftVersion(
    auth: AuthContext,
    sopId: string,
    input: { baseVersionId: string; nodes: SopNodeRow[]; edges: SopEdgeDraft[] },
    meta: RequestMeta,
  ): Promise<SopVersionResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const sop = await this.repo.findSop(c, auth.tenantId, sopId, { forUpdate: true });
      if (!sop) throw sopCanvasErrors.notFound();
      if (!canEditSopGraph(sop.status)) throw sopCanvasErrors.notEditable(sop.status);

      const base = await this.repo.findVersion(c, sopId, input.baseVersionId);
      if (!base) throw sopCanvasErrors.versionNotFound();
      if (sop.currentVersionId !== input.baseVersionId) {
        throw sopCanvasErrors.versionConflict(sop.currentVersionId ?? '(없음)');
      }

      const graph = { nodes: input.nodes, edges: input.edges };
      const graphHash = createHash('sha256')
        .update(sopGraphHashInput(graph, SOP_EDITOR_VERSION))
        .digest('hex');

      // 검증은 저장을 막지 않는다(CC-240 D4와 같은 규칙) — 고치는 중에는
      // 깨진 그래프를 저장할 수 있어야 한다. 위반은 버전에 남는다.
      const report = buildSopValidationReport(
        graph,
        input.nodes.map((n) => ({ nodeKey: n.nodeKey, warnings: n.warnings })),
      );

      const versionNo = await this.repo.nextVersionNo(c, sopId);
      const version = await this.repo.insertVersion(c, {
        sopId,
        versionNo,
        graphHash,
        schemaVersion: SOP_EDITOR_VERSION,
        // 편집본도 출처를 이어받는다 — 어느 확정 판·동결 근거에서 나온
        // 절차인지가 편집 한 번에 사라지면 안 된다.
        sourceSnapshotId: base.sourceSnapshotId,
        sourceEvidenceSetId: base.sourceEvidenceSetId,
        violations: report.errors.map((e) => e.code),
        createdBy: auth.userId,
      });
      await this.repo.insertGraph(c, version.sopVersionId, input.nodes, input.edges);
      await this.repo.pointAtVersion(c, sopId, version.sopVersionId);

      await this.writeAudit(c, auth, meta, 'SOP_VERSION_SAVED', sopId, {
        sopVersionId: version.sopVersionId,
        versionNo,
        baseVersionId: input.baseVersionId,
        nodeCount: input.nodes.length,
        edgeCount: input.edges.length,
        validationStatus: report.status,
      });
      return toVersionResource(version);
    });
  }

  /** UNE-SOP-007 — 검증 결과를 **남긴다**(승인 게이트가 그것을 본다). */
  async validate(
    auth: AuthContext,
    sopId: string,
    versionId: string | null,
  ): Promise<SopValidationReport & { sopVersionId: string; validatedAt: string }> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const sop = await this.repo.findSop(c, auth.tenantId, sopId);
      if (!sop) throw sopCanvasErrors.notFound();
      const targetId = versionId ?? sop.currentVersionId;
      if (!targetId) throw sopCanvasErrors.versionNotFound();
      const version = await this.repo.findVersion(c, sopId, targetId);
      if (!version) throw sopCanvasErrors.versionNotFound();

      const graph = await this.repo.findGraph(c, version.sopVersionId);
      const report = buildSopValidationReport(
        graph,
        graph.nodes.map((n) => ({ nodeKey: n.nodeKey, warnings: n.warnings })),
      );
      const saved = await this.repo.insertValidation(c, {
        sopVersionId: version.sopVersionId,
        status: report.status,
        errors: report.errors,
        warnings: report.warnings,
        validatorVersion: report.validatorVersion,
        validatedBy: auth.userId,
      });
      return {
        ...report,
        sopVersionId: version.sopVersionId,
        validatedAt: saved.validatedAt.toISOString(),
      };
    });
  }

  /** UNE-SOP-008 — 검토 요청. SOP를 IN_REVIEW로 옮겨 편집을 잠근다. */
  async submitReview(
    auth: AuthContext,
    sopId: string,
    input: { versionId: string; reviewers: string[]; message: string | null },
    meta: RequestMeta,
  ): Promise<{
    reviewRequestId: string;
    sopId: string;
    sopVersionId: string;
    status: string;
    reviewers: string[];
    message: string | null;
    requestedBy: string;
    requestedAt: string;
    resolvedAt: string | null;
  }> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const sop = await this.repo.findSop(c, auth.tenantId, sopId, { forUpdate: true });
      if (!sop) throw sopCanvasErrors.notFound();
      if (!canTransitionSop(sop.status, 'IN_REVIEW')) {
        throw sopCanvasErrors.notSubmittable(sop.status);
      }
      const version = await this.repo.findVersion(c, sopId, input.versionId);
      if (!version) throw sopCanvasErrors.versionNotFound();

      const open = await this.repo.findOpenReview(c, version.sopVersionId);
      if (open) throw sopCanvasErrors.reviewAlreadyOpen(open.reviewRequestId);

      const created = await this.repo.insertReviewRequest(c, {
        sopId,
        sopVersionId: version.sopVersionId,
        reviewers: input.reviewers,
        message: input.message,
        requestedBy: auth.userId,
      });
      await this.repo.updateSopStatus(c, auth.tenantId, sopId, 'IN_REVIEW');
      await this.writeAudit(c, auth, meta, 'SOP_REVIEW_REQUESTED', sopId, {
        reviewRequestId: created.reviewRequestId,
        sopVersionId: version.sopVersionId,
        reviewerCount: input.reviewers.length,
      });
      return {
        reviewRequestId: created.reviewRequestId,
        sopId,
        sopVersionId: version.sopVersionId,
        status: 'REQUESTED',
        reviewers: input.reviewers,
        message: input.message,
        requestedBy: auth.userId,
        requestedAt: created.requestedAt.toISOString(),
        resolvedAt: null,
      };
    });
  }

  /**
   * UNE-SOP-009 — 승인·버전 고정.
   *
   * 한 트랜잭션: 선행조건 → 버전 LOCKED → 검토 요청 해소 → 승인 기록 →
   * SOP APPROVED → 감사. 승인 기록에 **그때의 그래프 해시를 동결**한다 —
   * "무엇을 승인했는가"는 나중에 소급 보강할 방법이 없다.
   */
  async approve(
    auth: AuthContext,
    sopId: string,
    input: { versionId: string; comment: string | null },
    meta: RequestMeta,
  ): Promise<SopVersionResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const sop = await this.repo.findSop(c, auth.tenantId, sopId, { forUpdate: true });
      if (!sop) throw sopCanvasErrors.notFound();
      const version = await this.repo.findVersion(c, sopId, input.versionId, { forUpdate: true });
      if (!version) throw sopCanvasErrors.versionNotFound();

      const latest = await this.repo.findLatestValidation(c, version.sopVersionId);
      const gate = canApproveSopVersion({
        sopStatus: sop.status,
        versionStatus: version.status,
        latestValidation: (latest?.status as 'PASS' | 'FAIL' | undefined) ?? null,
      });
      if (!gate.ok) throw sopCanvasErrors.notApprovable(gate.reason);

      const locked = await this.repo.lockVersion(c, version.sopVersionId, auth.userId);
      // DRAFT 조건이 빗나갔다면 그 사이 누군가 승인했다는 뜻이다.
      if (!locked) throw sopCanvasErrors.notApprovable('ALREADY_LOCKED');

      const reviewRequestId = await this.repo.resolveReviewRequest(c, version.sopVersionId);
      const approvalId = await this.repo.insertApproval(c, {
        sopId,
        sopVersionId: version.sopVersionId,
        reviewRequestId,
        approvedBy: auth.userId,
        comment: input.comment,
        graphHash: locked.graphHash,
      });
      await this.repo.updateSopStatus(c, auth.tenantId, sopId, 'APPROVED');
      await this.repo.pointAtVersion(c, sopId, locked.sopVersionId);
      await this.writeAudit(c, auth, meta, 'SOP_VERSION_APPROVED', sopId, {
        approvalId,
        sopVersionId: locked.sopVersionId,
        versionNo: locked.versionNo,
        graphHash: locked.graphHash,
        reviewRequestId,
        validatorVersion: latest?.validatorVersion ?? SOP_VALIDATOR_VERSION,
      });
      return toVersionResource(locked);
    });
  }

  private async writeAudit(
    c: PoolClient,
    auth: AuthContext,
    meta: RequestMeta,
    action: string,
    sopId: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.insertAudit(c, {
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action,
      resourceType: 'SOP',
      resourceId: sopId,
      correlationId: meta.correlationId,
      ...(meta.ip ? { ip: meta.ip } : {}),
      ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
      detail,
    });
  }
}
