import { Inject, Injectable } from '@nestjs/common';
import {
  checkSnapshotConfirmable,
  diffSnapshots,
  isSnapshotBaselineCurrent,
  nextSnapshotVersion,
  nextStatusOnSnapshotConfirmed,
  snapshotContentHash,
  type SnapshotDiff,
  type SnapshotFact,
} from '@une/domain';
import type { ErrorViolation } from '../common/api-error';
import { AuditRepository } from '../common/audit.repository';
import type { RequestMetaLike } from '../common/controller-utils';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { ResolutionRepository } from './resolution.repository';
import { snapshotErrors } from './situation-errors';
import { SituationRepository } from './situation.repository';
import { SituationService } from './situation.service';
import {
  toFactResource,
  toSnapshotFact,
  toSnapshotResource,
  type SnapshotResource,
} from './situation.resources';

export interface SnapshotConfirmInput {
  factIds: string[];
  effectiveAt: string;
  reason: string | null;
  /** 요청자가 보고 있던 직전 확정 판. 첫 확정이면 null이다.
   * 생략할 수 없다 — 생략을 허용하면 가드가 우회된다. */
  expectedSnapshotId: string | null;
}

export interface SnapshotListResult {
  items: SnapshotResource[];
  diff: (SnapshotDiff & { fromSnapshotId: string; toSnapshotId: string }) | null;
}

/**
 * UNE-SIT-012 / 013 (CC-210).
 *
 * 설계 06 US-SIT-008의 인수기준이 둘이다 — **"확정 후 변경 0건"**과
 * **"재확정은 새 snapshotId"**. 이 서비스는 그 둘을 만들고, 지키는 것은
 * DB다: `situation_snapshot`은 0011 §3이 UPDATE/DELETE를 회수했고 0025 §6이
 * 버전 유니크·해시 형식·빈 사실 금지를 건다.
 *
 * Snapshot은 **Fact의 사본을 갖는다**(`facts_json`). 참조만 두면 확정 후에
 * 원천이 바뀔 때 Snapshot이 따라 움직이고, 그것이 설계 06 A-02가 금지하는
 * "기존 Snapshot 자동변경"이다. CC-210이 파생 Fact를 도입해 원천을 덮지 않게
 * 했지만(0025 §2) 사본은 그것과 별개의 두 번째 방어다.
 */
@Injectable()
export class SnapshotService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ResolutionRepository) private readonly repo: ResolutionRepository,
    @Inject(SituationRepository) private readonly facts: SituationRepository,
    @Inject(SituationService) private readonly situations: SituationService,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  /** UNE-SIT-012. */
  async confirm(
    auth: AuthContext,
    situationId: string,
    input: SnapshotConfirmInput,
    meta: RequestMetaLike,
  ): Promise<SnapshotResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      // 확정은 상황 행을 잠근다 — 두 요청이 같은 버전을 만들면 0025 §6의
      // 유니크가 하나를 23505로 떨어뜨리지만, 잠그면 애초에 겹치지 않는다.
      const situation = await this.facts.findSituation(c, auth.tenantId, situationId, {
        forUpdate: true,
      });
      if (!situation) throw snapshotErrors.notFound();
      await this.situations.requireOpenSituation(c, auth.tenantId, situationId);

      // 잠근 뒤 **가장 먼저** 확인한다. 그 사이에 다른 확정이 있었다면
      // 요청자는 그것을 보지 못한 것이고, 그대로 진행하면 기준 상황이 조용히
      // 교체된다(ADR-34 D17). 잠금은 순서만 정하지 이 사실을 알려주지 않는다.
      if (!isSnapshotBaselineCurrent(input.expectedSnapshotId, situation.currentSnapshotId)) {
        throw snapshotErrors.staleBaseline(situation.currentSnapshotId);
      }

      // 확정 대상을 실제 행으로 읽는다. 요청의 id를 믿고 해시를 계산하면
      // 존재하지 않는 사실이 확정될 수 있다.
      //
      // **요청된 id만** 읽는다. 전수를 `page 1 / size 1000`으로 읽으면 1000건을
      // 넘는 상황에서 뒤쪽 Fact가 "이 상황의 Fact가 아닙니다"로 412가 나고
      // 사용자는 원인을 알 수 없다(아키텍처 리뷰 M-10).
      const allFacts = await this.facts.findFactsByIds(
        c,
        auth.tenantId,
        situationId,
        input.factIds,
      );
      const openConflictCount = await this.repo.countOpenConflicts(c, auth.tenantId, situationId);

      const blockers = checkSnapshotConfirmable({
        requestedFactIds: input.factIds,
        facts: allFacts.map((f) => ({
          factId: f.factId,
          factType: f.factType,
          factKey: f.factKey,
          status: f.status,
          // 출처는 조인으로 항상 온다. 그래도 형태를 도메인에 넘겨 판정은
          // 한 곳에서 하게 한다(설계 10 SIT-422-006).
          hasSource: Boolean(f.source.sourceId),
        })),
        openConflictCount,
      });
      if (blockers.length > 0) {
        const violations = blockers.map<ErrorViolation>((b) => ({
          field: b.reason,
          reason: b.detail,
        }));
        // 출처 누락만인 경우는 설계 10이 별도 코드를 준다(SIT-422-006).
        const onlySourceIssue = blockers.every((b) => b.reason === 'FACT_WITHOUT_SOURCE');
        throw onlySourceIssue
          ? snapshotErrors.factWithoutSource(violations)
          : snapshotErrors.blocked(violations);
      }

      const selected = new Map(allFacts.map((f) => [f.factId, f]));
      const snapshotFacts: SnapshotFact[] = input.factIds.map((id) => {
        const row = selected.get(id);
        // 위 blockers가 FACT_NOT_IN_SITUATION으로 이미 걸렀으므로 여기서
        // undefined가 나올 수 없다. 그래도 캐스트로 덮지 않는다.
        if (!row) throw snapshotErrors.notFound();
        return toSnapshotFact(toFactResource(row));
      });

      const contentHash = snapshotContentHash(snapshotFacts, input.effectiveAt);
      const previous = await this.repo.latestSnapshotVersion(c, auth.tenantId, situationId);
      const versionNo = nextSnapshotVersion(previous?.versionNo ?? null);

      const snapshot = await this.repo.insertSnapshot(c, situationId, {
        versionNo,
        factsJson: snapshotFacts,
        contentHash,
        effectiveAt: input.effectiveAt,
        // 재확정은 새 snapshotId이고 이전을 가리킨다(기존은 보존된다).
        supersedesId: previous?.snapshotId ?? null,
        confirmedBy: auth.userId,
      });

      // 동시 보정이 먼저 커밋했으면 후보였던 것이 SUPERSEDED가 되어 0행이
      // 갱신된다. 조용히 넘기면 Snapshot 사본·원천·파생이 서로 다른 말을 한다
      // (아키텍처 리뷰 M-6). 이미 CONFIRMED였던 것(재확정)은 세지 않는다.
      const expectedPromotions = allFacts.filter((f) => f.status === 'CANDIDATE').length;
      const promoted = await this.repo.markFactsConfirmed(
        c,
        auth.tenantId,
        situationId,
        input.factIds,
      );
      if (promoted !== expectedPromotions) throw snapshotErrors.raced();

      const nextStatus = nextStatusOnSnapshotConfirmed(situation.status);
      await this.repo.setCurrentSnapshot(
        c,
        auth.tenantId,
        situationId,
        snapshot.snapshotId,
        nextStatus,
      );

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        // 설계 06 US-SIT-008 감사 이벤트: SNAPSHOT_CONFIRMED/SUPERSEDED.
        action: 'SNAPSHOT_CONFIRMED',
        resourceType: 'SITUATION_SNAPSHOT',
        resourceId: snapshot.snapshotId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        ...(previous
          ? { before: { snapshotId: previous.snapshotId, versionNo: previous.versionNo } }
          : {}),
        detail: {
          situationId,
          versionNo,
          contentHash,
          factCount: snapshotFacts.length,
          effectiveAt: input.effectiveAt,
          situationStatus: nextStatus,
          ...(input.reason === null ? {} : { reason: input.reason }),
        },
      });

      return toSnapshotResource(snapshot);
    });
  }

  /**
   * UNE-SIT-013. 목록과 Diff.
   *
   * `compareTo`가 없으면 목록만 준다. 있으면 **최신(또는 지정한) Snapshot과
   * 비교**해 무엇이 달라졌는지 준다(인수기준 "change comparison").
   */
  async list(
    auth: AuthContext,
    situationId: string,
    compareTo?: string,
  ): Promise<SnapshotListResult> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const situation = await this.facts.findSituation(c, auth.tenantId, situationId);
      if (!situation) throw snapshotErrors.notFound();

      const rows = await this.repo.listSnapshots(c, auth.tenantId, situationId);
      const items = rows.map(toSnapshotResource);
      if (compareTo === undefined) return { items, diff: null };

      const from = rows.find((r) => r.snapshotId === compareTo);
      if (!from) throw snapshotErrors.notFound();
      // 비교 상대는 최신이다. 목록이 version_no DESC이므로 rows[0]가 최신이며,
      // compareTo가 최신 자신이면 차이가 없는 Diff가 나온다(오류가 아니다).
      const to = rows[0];

      const asFacts = (row: (typeof rows)[number]): SnapshotFact[] =>
        Array.isArray(row.factsJson) ? (row.factsJson as SnapshotFact[]) : [];

      return {
        items,
        diff: {
          ...diffSnapshots(asFacts(from), asFacts(to)),
          fromSnapshotId: from.snapshotId,
          toSnapshotId: to.snapshotId,
        },
      };
    });
  }
}
