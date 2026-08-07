import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { canEditSituation, isSituationClosed } from '@une/domain';
import { AuditRepository } from '../common/audit.repository';
import type { RequestMetaLike } from '../common/controller-utils';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { situationErrors } from './situation-errors';
import {
  SituationRepository,
  type SituationMetaPatch,
  type SituationRow,
  type SituationSearchQuery,
} from './situation.repository';
import {
  toPage,
  toSituationDetailResource,
  toSituationResource,
  type Page,
  type SituationDetailResource,
  type SituationResource,
} from './situation.resources';

/** UNE-SIT-001~004 (CC-200). plan.service가 본이다 — 같은 순서로 검사한다:
 * 요청 스키마 → 테넌트 → 애그리거트 존재 → 상태 → 버전(If-Match)
 * (.claude/rules/backend.md). */
@Injectable()
export class SituationService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SituationRepository) private readonly repo: SituationRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  private async insertAudit(
    client: PoolClient,
    auth: AuthContext,
    meta: RequestMetaLike,
    action: string,
    situationId: string,
    detail: Record<string, unknown>,
    before?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.insertAudit(client, {
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action,
      resourceType: 'SITUATION',
      resourceId: situationId,
      correlationId: meta.correlationId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      ...(before ? { before } : {}),
      detail,
    });
  }

  /** UNE-SIT-001. */
  async create(
    auth: AuthContext,
    input: {
      mode: string;
      title: string;
      hazardType: string;
      occurredAt: string | null;
      locationText: string | null;
    },
    meta: RequestMetaLike,
  ): Promise<SituationResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const row = await this.repo.insertSituation(c, auth.tenantId, {
        ...input,
        createdBy: auth.userId,
      });
      await this.insertAudit(c, auth, meta, 'SITUATION_CREATED', row.situationId, {
        mode: row.mode,
        title: row.title,
        hazardType: row.hazardType,
      });
      return toSituationResource(row);
    });
  }

  /** UNE-SIT-002. */
  async search(auth: AuthContext, query: SituationSearchQuery): Promise<Page<SituationResource>> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const { items, totalElements } = await this.repo.searchSituations(c, auth.tenantId, query);
      return toPage(items.map(toSituationResource), query.page, query.size, totalElements);
    });
  }

  /** UNE-SIT-003. contextState는 저장값이 아니라 이 자리에서 계산한다. */
  async detail(auth: AuthContext, situationId: string): Promise<SituationDetailResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const row = await this.repo.findSituation(c, auth.tenantId, situationId);
      if (!row) throw situationErrors.notFound();
      const candidateFactCount = await this.repo.countCandidateFacts(c, auth.tenantId, situationId);
      // 충돌 계산은 CC-210이 연다. 지금 0을 넣는 것은 "충돌이 없다"가 아니라
      // "충돌을 계산하는 경로가 아직 없다"이며, 그 사실이 ADR-33 수용 한계다.
      return toSituationDetailResource(row, { candidateFactCount, openConflictCount: 0 });
    });
  }

  /** UNE-SIT-004. */
  async patchMeta(
    auth: AuthContext,
    situationId: string,
    expectedVersion: number,
    patch: SituationMetaPatch,
    meta: RequestMetaLike,
  ): Promise<SituationResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const current = await this.repo.findSituation(c, auth.tenantId, situationId, {
        forUpdate: true,
      });
      if (!current) throw situationErrors.notFound();
      if (!canEditSituation(current.status)) throw situationErrors.closed(current.status);
      if (current.versionNo !== expectedVersion) {
        throw situationErrors.versionConflict(current.versionNo);
      }

      const updated = await this.repo.updateSituationMeta(
        c,
        auth.tenantId,
        situationId,
        expectedVersion,
        patch,
      );
      // FOR UPDATE로 잠근 뒤 같은 트랜잭션에서 쓰므로 여기서 0행이 나올 수는
      // 없다. 그래도 조용히 성공으로 넘기지 않는다.
      if (!updated) throw situationErrors.versionConflict(current.versionNo);

      await this.insertAudit(
        c,
        auth,
        meta,
        'SITUATION_UPDATED',
        situationId,
        { versionNo: updated.versionNo, changed: Object.keys(patch) },
        {
          title: current.title,
          hazardType: current.hazardType,
          occurredAt: current.occurredAt ? current.occurredAt.toISOString() : null,
          locationText: current.locationText,
        },
      );
      return toSituationResource(updated);
    });
  }

  /** Fact 경로가 공유하는 선행조건 검사. 상황이 없으면 404, 종결이면 412다. */
  async requireOpenSituation(
    client: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<SituationRow> {
    const row = await this.repo.findSituation(client, tenantId, situationId);
    if (!row) throw situationErrors.notFound();
    if (isSituationClosed(row.status)) throw situationErrors.closed(row.status);
    return row;
  }
}
