import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { isNormalized, nextStatusOnFactRegistered, normalizeFact } from '@une/domain';
import type { ErrorViolation } from '../common/api-error';
import { AuditRepository } from '../common/audit.repository';
import type { RequestMetaLike } from '../common/controller-utils';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { factErrors } from './situation-errors';
import { SituationRepository, type FactSearchQuery } from './situation.repository';
import { SituationService } from './situation.service';
import {
  toFactResource,
  toFactValueEnvelope,
  toPage,
  type Page,
  type SituationFactResource,
} from './situation.resources';

export interface ManualFactInput {
  factType: string;
  factKey: string;
  value: unknown;
  unit: string | null;
  observedAt: string | null;
  confidence: number | null;
  sourceName: string | null;
  sourceUrl: string | null;
}

export interface FactPatchInput {
  value?: unknown;
  unit?: string | null;
  observedAt?: string | null;
  confidence?: number | null;
  /** **필수다.** 파생 Fact는 사유 없이 만들 수 없다 — 설계 06 US-SIT-007
   * 완료조건("모든 선택에 actor/time/source 추적")이고 0025 §2의
   * `ck_situation_fact_derivation_shape`가 DB에서도 강제한다. */
  reason: string;
}

/** UNE-SIT-007 / 008 / 014 (CC-200).
 *
 * 수동 입력도 Provider 수집과 **같은 정규화기를 지난다**. 사용자가 넣은
 * 값이라고 해서 단위가 canonical이라는 보장이 없고, 두 경로가 다른 규칙을
 * 쓰면 같은 사실이 출처에 따라 다른 값으로 저장된다.
 */
@Injectable()
export class FactService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SituationRepository) private readonly repo: SituationRepository,
    @Inject(SituationService) private readonly situations: SituationService,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  private async insertFactAudit(
    client: PoolClient,
    auth: AuthContext,
    meta: RequestMetaLike,
    action: string,
    factId: string,
    detail: Record<string, unknown>,
    before?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.insertAudit(client, {
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action,
      resourceType: 'SITUATION_FACT',
      resourceId: factId,
      correlationId: meta.correlationId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      ...(before ? { before } : {}),
      detail,
    });
  }

  /** UNE-SIT-007. */
  async createManual(
    auth: AuthContext,
    situationId: string,
    input: ManualFactInput,
    meta: RequestMetaLike,
  ): Promise<SituationFactResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const situation = await this.situations.requireOpenSituation(c, auth.tenantId, situationId);

      const normalized = normalizeFact({
        factType: input.factType,
        factKey: input.factKey,
        value: input.value,
        unit: input.unit,
        observedAt: input.observedAt,
        raw: {
          value: input.value,
          unit: input.unit,
          observedAt: input.observedAt,
          enteredBy: auth.userId,
        },
      });
      if (!isNormalized(normalized)) {
        throw factErrors.invalid(
          normalized.notes.map<ErrorViolation>((n) => ({ field: n.reason, reason: n.detail })),
        );
      }

      const collectedAt = new Date().toISOString();
      // 사용자 입력의 출처는 MANUAL/USER로 고정한다. 요청이 providerCode를
      // 고를 수 있으면 사용자가 기상청을 사칭한 사실을 만들 수 있다.
      const source = await this.repo.insertFactSource(c, auth.tenantId, {
        providerCode: 'MANUAL',
        sourceType: 'USER',
        sourceName: input.sourceName ?? '사용자 직접 입력',
        sourceUri: input.sourceUrl,
        retrievedAt: collectedAt,
      });

      const { factId } = await this.repo.insertFact(c, situationId, {
        factType: normalized.factType,
        factKey: normalized.factKey,
        valueJson: toFactValueEnvelope(normalized),
        sourceId: source.sourceId,
        observedAt: normalized.observedAt,
        collectedAt,
        confidence: input.confidence,
      });

      await this.advanceOnFirstFact(c, auth, meta, situation.status, situationId);

      await this.insertFactAudit(c, auth, meta, 'FACT_CREATED', factId, {
        situationId,
        factType: normalized.factType,
        factKey: normalized.factKey,
        providerCode: 'MANUAL',
        normalizationOutcome: normalized.outcome,
      });

      const row = await this.repo.findFact(c, auth.tenantId, situationId, factId);
      if (!row) throw factErrors.notFound();
      return toFactResource(row);
    });
  }

  /** 첫 후보 Fact가 DRAFT를 REGISTERED로 올린다(설계 06 US-SIT-003 상태전이). */
  async advanceOnFirstFact(
    client: PoolClient,
    auth: AuthContext,
    meta: RequestMetaLike,
    currentStatus: string,
    situationId: string,
  ): Promise<void> {
    const next = nextStatusOnFactRegistered(currentStatus);
    if (next === currentStatus) return;
    const moved = await this.repo.advanceStatus(
      client,
      auth.tenantId,
      situationId,
      currentStatus,
      next,
    );
    // 경합으로 다른 요청이 먼저 올렸으면 rowCount 0이다. 그때 감사에 두 번
    // 남기지 않는다 — 상태는 한 번만 바뀌었다.
    if (!moved) return;
    await this.audit.insertAudit(client, {
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action: 'INCIDENT_REGISTERED',
      resourceType: 'SITUATION',
      resourceId: situationId,
      correlationId: meta.correlationId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      before: { status: currentStatus },
      detail: { status: next },
    });
  }

  /**
   * UNE-SIT-008 후보 Fact 보정 — **파생 Fact를 만든다.**
   *
   * CC-200은 이 자리를 제자리 UPDATE로 구현했고 ADR-33 수용 한계 12가 그것이
   * 설계와 어긋난다고 기록했다. 사용자 결정(2026-08-08)으로 설계 쪽에 맞춘다.
   *
   * 근거는 세 곳이 같은 말을 한다.
   *   - 설계 06 US-SIT-007 #3: "수정 시 derived Fact를 생성한다.
   *     originalFactId·actor·reason 기록", 완료조건 "원천 불변"
   *   - 설계 06 §7.1 주요 데이터: "원천 Fact 불변. 수정 시 파생 Fact 생성"
   *   - CLAUDE.md 비협상 규칙: "Corrections are new versions or correction
   *     events; never overwrite audit history"
   *
   * 실질적 이득이 하나 더 있다: 확정된 Snapshot이 가리키는 근거의 값이 사후에
   * 바뀌지 않는다. 제자리 UPDATE에서는 바뀔 수 있었다.
   *
   * 출처는 **새로 만든다**(MANUAL/USER). 같은 source_id를 물려주면 사용자가
   * 고친 숫자가 기상청이 준 값으로 보인다 — 원본의 출처는 `original_fact_id`를
   * 따라가면 그대로 있다.
   */
  async patch(
    auth: AuthContext,
    situationId: string,
    factId: string,
    expectedVersion: number,
    patch: FactPatchInput,
    meta: RequestMetaLike,
  ): Promise<SituationFactResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      await this.situations.requireOpenSituation(c, auth.tenantId, situationId);
      const current = await this.repo.findFact(c, auth.tenantId, situationId, factId);
      if (!current) throw factErrors.notFound();
      if (current.status !== 'CANDIDATE') throw factErrors.notCandidate(current.status);
      if (current.versionNo !== expectedVersion) {
        throw factErrors.versionConflict(current.versionNo);
      }

      const before = toFactResource(current);
      const nextValue = Object.prototype.hasOwnProperty.call(patch, 'value')
        ? patch.value
        : before.value;
      const nextUnit = Object.prototype.hasOwnProperty.call(patch, 'unit')
        ? (patch.unit ?? null)
        : before.unit;
      const nextObservedAt = Object.prototype.hasOwnProperty.call(patch, 'observedAt')
        ? (patch.observedAt ?? null)
        : before.observedAt;

      const normalized = normalizeFact({
        factType: current.factType,
        factKey: current.factKey,
        value: nextValue,
        unit: nextUnit,
        observedAt: nextObservedAt,
        raw: {
          value: nextValue,
          unit: nextUnit,
          observedAt: nextObservedAt,
          correctedBy: auth.userId,
          derivedFrom: factId,
          reason: patch.reason,
        },
      });
      if (!isNormalized(normalized)) {
        throw factErrors.invalid(
          normalized.notes.map<ErrorViolation>((n) => ({ field: n.reason, reason: n.detail })),
        );
      }

      // 원본을 먼저 내린다. 여기서 0행이면 다른 요청이 앞섰다는 뜻이고,
      // 그 경우 파생을 만들지 않는다 — 같은 원본에서 파생이 둘 생기면
      // 어느 쪽이 최신인지 답할 수 없다.
      const superseded = await this.repo.markFactSuperseded(
        c,
        auth.tenantId,
        situationId,
        factId,
        expectedVersion,
      );
      if (!superseded) throw factErrors.versionConflict(current.versionNo);

      const collectedAt = new Date().toISOString();
      const source = await this.repo.insertFactSource(c, auth.tenantId, {
        providerCode: 'MANUAL',
        sourceType: 'USER',
        sourceName: '사용자 보정',
        sourceUri: null,
        retrievedAt: collectedAt,
      });

      const created = await this.repo.insertFact(c, situationId, {
        factType: current.factType,
        factKey: current.factKey,
        valueJson: toFactValueEnvelope(normalized),
        sourceId: source.sourceId,
        observedAt: normalized.observedAt,
        collectedAt,
        confidence: Object.prototype.hasOwnProperty.call(patch, 'confidence')
          ? (patch.confidence ?? null)
          : (before.confidence ?? null),
        originalFactId: factId,
        derivedBy: auth.userId,
        derivedReason: patch.reason,
      });

      await this.insertFactAudit(
        c,
        auth,
        meta,
        // 설계 06 US-SIT-007 감사 이벤트: FACT_SELECTED/EXCLUDED/**CORRECTED**.
        'FACT_CORRECTED',
        created.factId,
        {
          situationId,
          originalFactId: factId,
          changed: Object.keys(patch),
          normalizationOutcome: normalized.outcome,
          reason: patch.reason,
        },
        { factId, value: before.value, unit: before.unit, observedAt: before.observedAt },
      );

      const row = await this.repo.findFact(c, auth.tenantId, situationId, created.factId);
      if (!row) throw factErrors.notFound();
      return toFactResource(row);
    });
  }

  /** UNE-SIT-014. */
  async list(
    auth: AuthContext,
    situationId: string,
    query: FactSearchQuery,
  ): Promise<Page<SituationFactResource>> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const situation = await this.repo.findSituation(c, auth.tenantId, situationId);
      // 상황이 없으면 빈 목록이 아니라 404다 — 없는 상황의 Fact가 0건이라고
      // 답하면 다른 테넌트의 id를 넣어 존재 여부를 떠볼 수 있다.
      if (!situation) throw factErrors.notFound();
      const { items, totalElements } = await this.repo.searchFacts(
        c,
        auth.tenantId,
        situationId,
        query,
      );
      return toPage(items.map(toFactResource), query.page, query.size, totalElements);
    });
  }
}
