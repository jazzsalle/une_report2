import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  detectConflicts,
  groupDuplicates,
  isSelectableCandidate,
  type DuplicateStrategy,
  type FactForGrouping,
} from '@une/domain';
import { AuditRepository } from '../common/audit.repository';
import type { RequestMetaLike } from '../common/controller-utils';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { conflictErrors } from './situation-errors';
import { ResolutionRepository, type FactForGroupingRow } from './resolution.repository';
import { SituationRepository } from './situation.repository';
import { SituationService } from './situation.service';
import {
  toConflictResource,
  toDuplicateGroupResource,
  toResolutionResource,
  type ConflictResolutionResource,
  type ConflictResource,
  type DeduplicateResult,
} from './situation.resources';

export interface DeduplicateInput {
  strategy: DuplicateStrategy;
  timeWindowMinutes?: number;
  threshold: number | null;
}

/**
 * UNE-SIT-009 / 010 / 011 (CC-210).
 *
 * **충돌 탐지는 SIT-009 호출 시점이다**(사용자 결정 2026-08-08, ADR-34 D2).
 * 설계 06 US-SIT-006 #4가 정규화 단계에 붙어 있는 것처럼 읽히지만, 설계 10이
 * SIT-009에 `strategy,threshold`를 둔 것은 **그룹화가 사용자가 고르는 계산**
 * 이라는 뜻이다. 수집 시 자동으로 하면 전략이 고정되고, 후보가 하나 생길
 * 때마다 전체를 다시 묶어야 하며, 그만큼 수집 응답이 느려진다.
 *
 * 이 서비스는 값을 바꾸지 않는다. 그룹과 충돌은 "무엇이 무엇과 같은 자리에
 * 있는가"에 대한 판정이고, 어느 값이 사실인지는 사용자가 SIT-011로 정한다
 * (설계 06 US-SIT-006 #4 "자동 덮어쓰기 금지").
 */
@Injectable()
export class ResolutionService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ResolutionRepository) private readonly repo: ResolutionRepository,
    @Inject(SituationRepository) private readonly facts: SituationRepository,
    @Inject(SituationService) private readonly situations: SituationService,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  /** 저장 행 → 도메인 입력. `value_json`은 CC-200의 봉투 형태다. */
  private toGroupingInput(rows: readonly FactForGroupingRow[]): FactForGrouping[] {
    return rows.map((row) => {
      const envelope =
        typeof row.valueJson === 'object' && row.valueJson !== null
          ? (row.valueJson as Record<string, unknown>)
          : {};
      return {
        factId: row.factId,
        factKey: row.factKey,
        factType: row.factType,
        value: 'value' in envelope ? envelope.value : row.valueJson,
        unit: (envelope.unit as string | null) ?? null,
        observedAt: row.observedAt ? row.observedAt.toISOString() : null,
        collectedAt: row.collectedAt.toISOString(),
        providerCode: row.providerCode,
        sourceId: row.sourceId,
        status: row.status,
      };
    });
  }

  /** UNE-SIT-009. 중복군을 계산하고 그 결과에서 충돌을 판정한다. */
  async deduplicate(
    auth: AuthContext,
    situationId: string,
    input: DeduplicateInput,
    meta: RequestMetaLike,
  ): Promise<DeduplicateResult> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      // 확정(SIT-012)과 직렬화한다. 잠그지 않으면 확정이 OPEN 충돌 0을 읽은 뒤
      // 커밋 전에 재계산이 충돌을 커밋해 **미해결 충돌이 있는 채로 Snapshot이
      // 만들어진다**(아키텍처 리뷰 M-5).
      await this.situations.requireOpenSituation(c, auth.tenantId, situationId, {
        forUpdate: true,
      });

      const rows = await this.repo.listFactsForGrouping(c, auth.tenantId, situationId);
      const facts = this.toGroupingInput(rows);
      const groups = groupDuplicates(facts, {
        strategy: input.strategy,
        ...(input.timeWindowMinutes === undefined
          ? {}
          : { timeWindowMinutes: input.timeWindowMinutes }),
        threshold: input.threshold,
      });
      const conflicts = detectConflicts(facts, groups);

      // 재계산은 이전 그룹을 지우고 다시 넣는다(0025 §1). 그룹은 계산 결과다.
      await this.repo.deleteGroups(c, auth.tenantId, situationId);
      const storedGroups = [];
      for (const group of groups) {
        storedGroups.push(
          await this.repo.insertGroup(c, situationId, {
            factKey: group.factKey,
            groupKey: group.groupKey,
            strategy: group.strategy,
            threshold: group.threshold,
            memberFactIds: group.memberFactIds,
            computedBy: auth.userId,
          }),
        );
      }

      // 충돌은 **지우지 않는다.** 이미 해소된 결정을 재계산이 되돌리면
      // 사용자의 판단이 사라진다. OPEN 중복은 0025 §4의 부분 유니크가 막는다.
      let conflictsOpened = 0;
      for (const conflict of conflicts) {
        const created = await this.repo.insertConflictIfAbsent(c, situationId, {
          groupKey: conflict.groupKey,
          factKey: conflict.factKey,
          conflictType: conflict.conflictType,
          candidateFactIds: conflict.candidateFactIds,
        });
        if (created) conflictsOpened += 1;
      }

      // 이번 계산에 없는 OPEN 충돌은 **더 이상 존재하지 않는다** — 보정으로
      // 값이 같아졌거나 후보가 사라진 것이다. OPEN으로 두면 확정이 영구
      // 차단된다(아키텍처 리뷰 M-3).
      const obsoleted = await this.repo.markConflictsObsolete(
        c,
        auth.tenantId,
        situationId,
        conflicts.map((conflict) => conflict.groupKey),
      );

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'FACT_GROUPED',
        resourceType: 'SITUATION',
        resourceId: situationId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: {
          strategy: input.strategy,
          threshold: input.threshold,
          groupCount: storedGroups.length,
          conflictsDetected: conflicts.length,
          conflictsOpened,
          conflictsObsoleted: obsoleted.length,
        },
      });

      const openConflicts = await this.repo.listConflicts(c, auth.tenantId, situationId, 'OPEN');
      return {
        groups: storedGroups.map(toDuplicateGroupResource),
        conflicts: openConflicts.map(toConflictResource),
        conflictsOpened,
        conflictsObsoleted: obsoleted.length,
      };
    });
  }

  /** UNE-SIT-010. */
  async listConflicts(
    auth: AuthContext,
    situationId: string,
    status?: string,
  ): Promise<ConflictResource[]> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const situation = await this.facts.findSituation(c, auth.tenantId, situationId);
      // 없는 상황의 충돌이 빈 배열이면 다른 테넌트의 id로 존재 여부를 떠볼 수 있다.
      if (!situation) throw conflictErrors.situationNotFound();
      const rows = await this.repo.listConflicts(c, auth.tenantId, situationId, status);
      return rows.map(toConflictResource);
    });
  }

  /**
   * UNE-SIT-011 충돌 확정.
   *
   * 선택 대상은 **그 충돌의 후보 중 하나**여야 한다. 그룹 밖의 Fact를 고르는
   * 것은 해소가 아니라 다른 사실의 도입이고, 그것은 SIT-007(수동 등록)의 일이다.
   *
   * 원천은 손대지 않는다 — 선택되지 않은 후보를 REJECTED로 내리지 않는다.
   * 설계 06 US-SIT-007 A-01("복수 Fact 병존 필요 — 서로 다른 시각/범위로 모두
   * 선택")이 그것을 허용하고, 무엇을 확정에 넣을지는 SIT-012가 정한다.
   */
  async resolveConflict(
    auth: AuthContext,
    situationId: string,
    conflictId: string,
    input: { selectedFactId: string; reason: string },
    meta: RequestMetaLike,
  ): Promise<ConflictResolutionResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      await this.situations.requireOpenSituation(c, auth.tenantId, situationId, {
        forUpdate: true,
      });

      const conflict = await this.repo.findConflict(c, auth.tenantId, situationId, conflictId, {
        forUpdate: true,
      });
      if (!conflict) throw conflictErrors.notFound();
      // 이미 해소된 충돌을 다시 정하지 않는다. 설계 06 E-02(다른 사용자가
      // 선결정)가 요구하는 것이 이 응답이다 — 재조회 후 다시 판단하게 한다.
      if (conflict.status !== 'OPEN') throw conflictErrors.alreadyResolved();

      if (!isSelectableCandidate(conflict, input.selectedFactId)) {
        throw conflictErrors.selectionNotCandidate();
      }
      const selected = await this.facts.findFact(
        c,
        auth.tenantId,
        situationId,
        input.selectedFactId,
      );
      // 후보 배열에 들어 있다는 것만으로는 부족하다 — 충돌이 열린 뒤 보정으로
      // SUPERSEDED가 되었거나 거부됐을 수 있고, 해소는 불변이라 되돌릴 수 없다
      // (아키텍처 리뷰 M-9). 지금 후보인 것만 기준으로 삼을 수 있다.
      if (!selected || selected.status !== 'CANDIDATE') {
        throw conflictErrors.selectionNotCandidate();
      }

      const resolution = await this.repo.insertResolution(c, {
        conflictId,
        selectedFactId: input.selectedFactId,
        reason: input.reason,
        resolvedBy: auth.userId,
      });
      const moved = await this.repo.markConflictResolved(c, conflictId);
      // FOR UPDATE로 잠근 뒤이므로 0행이 나올 수 없다. 조용히 넘기지 않는다.
      if (!moved) throw conflictErrors.alreadyResolved();

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        // 설계 06 US-SIT-007 감사 이벤트: FACT_SELECTED/EXCLUDED/CORRECTED.
        action: 'FACT_SELECTED',
        resourceType: 'FACT_CONFLICT',
        resourceId: conflictId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        before: { status: 'OPEN', candidateFactIds: conflict.candidateFactIds },
        detail: {
          situationId,
          status: 'RESOLVED',
          selectedFactId: input.selectedFactId,
          factKey: conflict.factKey,
          conflictType: conflict.conflictType,
          reason: input.reason,
        },
      });

      return toResolutionResource(resolution, conflict.factKey);
    });
  }

  /** 확정 선행조건이 쓰는 값. Snapshot 서비스가 같은 트랜잭션에서 부른다. */
  async countOpenConflicts(
    client: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<number> {
    return this.repo.countOpenConflicts(client, tenantId, situationId);
  }
}
