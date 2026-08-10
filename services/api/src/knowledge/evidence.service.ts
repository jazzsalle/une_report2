import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  isSituationClosed,
  checkEvidenceFreezable,
  checkEvidenceItem,
  checkEvidenceSearchable,
  DEFAULT_TOP_K,
  evidenceContentHashInput,
  minimizePii,
  type EvidenceSetStatus,
} from '@une/domain';
import { UNI_KNOWLEDGE } from './uni-knowledge.provider';
import type { UniKnowledgeProvider } from '@une/provider-adapters';
import { AuditRepository } from '../common/audit.repository';
import type { RequestMetaLike } from '../common/controller-utils';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { SituationRepository } from '../situation/situation.repository';
import { evidenceErrors } from './evidence-errors';
import {
  EvidenceRepository,
  type EvidenceItemRow,
  type EvidenceSetRow,
} from './evidence.repository';

/**
 * 근거 검색과 EvidenceSet (CC-230, UNE-KNOW-004~007).
 *
 * **검색은 동기다**(ADR-37 D2). 사용자가 결과를 보고 고르는 대화형 흐름이고
 * 설계 08 §1.14가 30초·1회를 잡았다. CC-220의 업로드(60초 + 비동기 처리)와
 * 갈리는 지점이며 CC-200의 상황 수집과 같은 판단이다.
 *
 * **UNI 호출은 트랜잭션 밖이다**(`.claude/rules/backend.md`). 세 구간이다:
 * 읽기 → 호출 → 쓰기.
 */

export interface EvidenceItemResource {
  evidenceItemId: string;
  knowledgeDocumentId: string;
  providerChunkId: string | null;
  rankNo: number;
  score: number | null;
  quote: string;
  sourceLocator: unknown;
  citationKey: string;
  isSelected: boolean;
  excludedReason: string | null;
}

export interface EvidenceSetResource {
  evidenceSetId: string;
  situationId: string;
  snapshotId: string;
  query: string;
  filters: unknown;
  topK: number;
  status: EvidenceSetStatus;
  contentHash: string;
  frozenAt: string | null;
  frozenBy: string | null;
  freezeReason: string | null;
  /** UNI가 돌려줬으나 우리 문서가 아니어서 버린 청크 수 (US-SIT-011 E-02). */
  rejectedChunkCount: number;
  items: EvidenceItemResource[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourceLocatorResource {
  evidenceItemId: string;
  knowledgeDocumentId: string;
  providerDocumentId: string;
  fileName: string;
  providerChunkId: string | null;
  citationKey: string;
  quote: string;
  locator: unknown;
}

function toItem(row: EvidenceItemRow): EvidenceItemResource {
  return {
    evidenceItemId: row.evidenceItemId,
    knowledgeDocumentId: row.knowledgeDocumentId,
    providerChunkId: row.providerChunkId,
    rankNo: row.rankNo,
    score: row.score === null ? null : Number(row.score),
    quote: row.quoteText,
    sourceLocator: row.sourceLocatorJson,
    citationKey: row.citationKey,
    isSelected: row.isSelected,
    excludedReason: row.excludedReason,
  };
}

function toResource(
  set: EvidenceSetRow,
  items: EvidenceItemRow[],
  rejectedChunkCount = 0,
): EvidenceSetResource {
  return {
    evidenceSetId: set.evidenceSetId,
    situationId: set.situationId,
    snapshotId: set.snapshotId,
    query: set.queryText,
    filters: set.filtersJson,
    topK: set.topK,
    status: set.status as EvidenceSetStatus,
    contentHash: set.contentHash,
    frozenAt: set.frozenAt ? set.frozenAt.toISOString() : null,
    frozenBy: set.frozenBy,
    freezeReason: set.freezeReason,
    rejectedChunkCount,
    items: items.map(toItem),
    createdBy: set.createdBy,
    createdAt: set.createdAt.toISOString(),
    updatedAt: set.updatedAt.toISOString(),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class EvidenceService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(EvidenceRepository) private readonly evidence: EvidenceRepository,
    @Inject(SituationRepository) private readonly situations: SituationRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
    @Inject(UNI_KNOWLEDGE) private readonly uni: UniKnowledgeProvider,
  ) {}

  /** UNE-KNOW-004. 근거를 검색해 DRAFT EvidenceSet을 만든다. */
  async search(
    auth: AuthContext,
    meta: RequestMetaLike,
    situationId: string,
    input: { snapshotId: string; query: string; topK?: number; filters?: Record<string, unknown> },
  ): Promise<EvidenceSetResource> {
    const topK = input.topK ?? DEFAULT_TOP_K;

    // ── 1구간: 읽기 ──
    const prepared = await this.db.withTenant(auth.tenantId, async (c) => {
      const situation = await this.situations.findSituation(c, auth.tenantId, situationId);
      if (!situation) throw evidenceErrors.situationNotFound();
      // 종료된 상황에는 근거를 새로 모으지 않는다 — 상황 계열의 다른 모든
      // 쓰기 경로가 같은 가드를 쓴다(fact/provider-query/resolution/snapshot).
      // 근거는 SOP의 출처가 되고 EvidenceSet은 동결되므로, 끝난 상황 위에
      // 새 근거를 굳히면 되돌릴 방법이 없다.
      if (isSituationClosed(situation.status))
        throw evidenceErrors.situationClosed(situation.status);
      const docs = await this.evidence.findEligibleDocuments(c, auth.tenantId, situationId);
      return { currentSnapshotId: situation.currentSnapshotId, docs };
    });

    const blocker = checkEvidenceSearchable({
      currentSnapshotId: prepared.currentSnapshotId,
      requestedSnapshotId: input.snapshotId,
      eligibleDocumentCount: prepared.docs.length,
      topK,
    });
    if (blocker === 'SNAPSHOT_REQUIRED') throw evidenceErrors.snapshotRequired();
    if (blocker === 'SNAPSHOT_NOT_CURRENT') {
      throw evidenceErrors.snapshotNotCurrent(prepared.currentSnapshotId ?? 'null');
    }
    if (blocker === 'TOP_K_OUT_OF_RANGE') {
      throw evidenceErrors.invalidRequest([
        { field: 'topK', reason: '1 이상 50 이하여야 합니다.' },
      ]);
    }
    // NO_ELIGIBLE_DOCUMENT는 오류가 아니다 — US-SIT-011 A-01이 정상 분기로
    // 정의한 상태다. UNI를 부르지 않고 빈 EvidenceSet을 만든다.

    // 질의에서 개인정보를 줄인다(US-SIT-011 1단계). **완벽한 익명화가 아니며**
    // 그 한계는 ADR-37에 수용 한계로 적었다.
    const query = minimizePii(input.query.trim());

    // ── 2구간: 트랜잭션 밖에서 UNI 호출 ──
    const byProviderId = new Map(prepared.docs.map((d) => [d.providerDocumentId, d]));
    let chunks: {
      documentId: string;
      chunkId: string | null;
      score: number | null;
      text: string;
    }[] = [];
    let rawTrace: unknown = null;
    let searchError: { code: string; message: string } | null = null;

    if (prepared.docs.length > 0) {
      const result = await this.uni.searchEvidence(
        {
          query,
          topK,
          documentIds: prepared.docs.map((d) => d.providerDocumentId),
          filters: input.filters ?? {},
        },
        { correlationId: meta.correlationId },
      );
      rawTrace = { request: result.raw.requestSummary, response: result.raw.responseBody };
      if (result.ok) {
        chunks = result.value.chunks;
      } else {
        searchError = { code: result.error.code, message: result.error.message };
      }
    }

    // ── 3구간: 쓰기 ──
    //
    // 검색이 실패해도 **잡과 원문은 커밋해야 한다** — 실패한 호출의 추적이
    // 사라지면 "왜 실패했는가"에 답할 수 없다. 그래서 트랜잭션 안에서 던지지
    // 않고(던지면 롤백된다) 결과로 들고 나와 밖에서 던진다. CC-220의 거부
    // 감사가 롤백과 함께 사라졌던 것과 같은 함정이다.
    const outcome = await this.db.withTenant(auth.tenantId, async (c) => {
      // **기준선을 다시 확인한다.** 1구간의 검사와 여기 사이에 UNI 호출이
      // 최대 30초 열려 있고, 그동안 다른 통제관이 확정하면 낡은 판 위의
      // EvidenceSet이 만들어져 **그대로 동결된다** — D3이 막겠다고 한 상황이
      // 정확히 그 창으로 들어온다. ADR-34 D17이 확정에서 한 것과 같이 상황
      // 행을 잠그고 잠근 뒤에 본다(잠금은 순서만 정하지 사실을 알려주지 않는다).
      const fresh = await this.situations.findSituation(c, auth.tenantId, situationId, {
        forUpdate: true,
      });
      const staleBaseline =
        fresh !== null && fresh.currentSnapshotId !== input.snapshotId
          ? (fresh.currentSnapshotId ?? 'null')
          : null;

      const jobId = await this.evidence.insertSearchJob(c, {
        tenantId: auth.tenantId,
        situationId,
        queryText: query,
        topK,
        documentCount: prepared.docs.length,
        correlationId: meta.correlationId,
        ok: searchError === null,
        resultCount: chunks.length,
        error: searchError,
      });
      if (rawTrace !== null) {
        await this.evidence.insertProviderResult(
          c,
          jobId,
          rawTrace,
          sha256(JSON.stringify(rawTrace)),
          chunks.length,
        );
      }

      if (searchError) {
        await this.audit.insertAudit(c, {
          tenantId: auth.tenantId,
          actorId: auth.userId,
          action: 'EVIDENCE_SEARCH_FAILED',
          resourceType: 'EVIDENCE_SET',
          correlationId: meta.correlationId,
          ip: meta.ip,
          userAgent: meta.userAgent,
          detail: { situationId, providerJobId: jobId, code: searchError.code },
        });
        return { failed: searchError.message, stale: null, resource: undefined } as const;
      }

      if (staleBaseline !== null) {
        // 잡과 원문은 이미 커밋 대상이다 — 실제로 UNI를 불렀으므로 그 사실은
        // 남아야 한다. EvidenceSet만 만들지 않고 밖에서 409를 던진다.
        return { failed: null, stale: staleBaseline, resource: undefined } as const;
      }

      // **UNI가 돌려준 문서를 다시 대조한다**(US-SIT-011 E-02). 요청에만 필터를
      // 걸고 응답을 믿으면 저쪽 필터가 틀렸을 때 알 방법이 없다.
      const known = new Map(
        prepared.docs.map((d) => [
          d.providerDocumentId,
          { status: 'REGISTERED' as const, uniStatus: 'READY' as const },
        ]),
      );
      const accepted: typeof chunks = [];
      let rejected = 0;
      for (const chunk of chunks) {
        if (checkEvidenceItem({ documentId: chunk.documentId, quote: chunk.text }, known)) {
          rejected += 1;
          continue;
        }
        accepted.push(chunk);
      }

      const items = accepted.map((chunk, i) => {
        const doc = byProviderId.get(chunk.documentId);
        return {
          knowledgeDocumentId: doc?.knowledgeDocumentId ?? '',
          providerChunkId: chunk.chunkId,
          rankNo: i + 1,
          score: chunk.score,
          quoteText: chunk.text,
          sourceLocator: {
            fileName: doc?.originalName ?? null,
            providerDocumentId: chunk.documentId,
            providerChunkId: chunk.chunkId,
          },
          citationKey: `E${i + 1}`,
        };
      });

      const contentHash = sha256(
        evidenceContentHashInput({
          snapshotId: input.snapshotId,
          queryText: query,
          items: items.map((i) => ({
            knowledgeDocumentId: i.knowledgeDocumentId,
            providerChunkId: i.providerChunkId,
            rankNo: i.rankNo,
            quoteText: i.quoteText,
          })),
        }),
      );

      const set = await this.evidence.insertSet(c, {
        situationId,
        snapshotId: input.snapshotId,
        queryText: query,
        filters: input.filters ?? {},
        topK,
        contentHash,
        providerJobId: jobId,
        createdBy: auth.userId,
      });
      await this.evidence.insertItems(c, set.evidenceSetId, items);

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'EVIDENCE_SEARCHED',
        resourceType: 'EVIDENCE_SET',
        resourceId: set.evidenceSetId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: {
          situationId,
          snapshotId: input.snapshotId,
          providerJobId: jobId,
          accepted: items.length,
          rejected,
        },
      });

      const stored = await this.evidence.listItems(c, set.evidenceSetId);
      return { failed: null, stale: null, resource: toResource(set, stored, rejected) } as const;
    });

    if (outcome.failed !== null && outcome.failed !== undefined) {
      throw evidenceErrors.searchFailed(outcome.failed);
    }
    if (outcome.stale !== null && outcome.stale !== undefined) {
      throw evidenceErrors.snapshotNotCurrent(outcome.stale);
    }
    return outcome.resource;
  }

  /** UNE-KNOW-005 */
  async get(auth: AuthContext, id: string): Promise<EvidenceSetResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const set = await this.evidence.findSet(c, auth.tenantId, id);
      if (!set) throw evidenceErrors.notFound();
      return toResource(set, await this.evidence.listItems(c, set.evidenceSetId));
    });
  }

  /** UNE-KNOW-006. 동결한다 — 이후 집합도 항목도 바뀌지 않는다(0031 트리거). */
  async freeze(
    auth: AuthContext,
    meta: RequestMetaLike,
    id: string,
    reason: string,
  ): Promise<EvidenceSetResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const set = await this.evidence.findSet(c, auth.tenantId, id, { forUpdate: true });
      if (!set) throw evidenceErrors.notFound();
      const items = await this.evidence.listItems(c, set.evidenceSetId);
      const selected = items.filter((i) => i.isSelected);

      const blocker = checkEvidenceFreezable(set.status as EvidenceSetStatus, selected.length);
      if (blocker === 'ALREADY_FROZEN') throw evidenceErrors.alreadyFrozen();
      if (blocker === 'EMPTY_SELECTION') throw evidenceErrors.emptySelection();

      // 동결 해시는 **선택된 근거만** 담는다 — 제외한 후보는 행으로 남지만
      // "무엇을 근거로 만들었는가"에는 들어가지 않는다.
      const contentHash = sha256(
        evidenceContentHashInput({
          snapshotId: set.snapshotId,
          queryText: set.queryText,
          items: selected.map((i) => ({
            knowledgeDocumentId: i.knowledgeDocumentId,
            providerChunkId: i.providerChunkId,
            rankNo: i.rankNo,
            quoteText: i.quoteText,
          })),
        }),
      );

      const frozen = await this.evidence.freeze(
        c,
        set.evidenceSetId,
        auth.userId,
        reason,
        contentHash,
      );

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'EVIDENCE_SET_FROZEN',
        resourceType: 'EVIDENCE_SET',
        resourceId: set.evidenceSetId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        before: { status: set.status, contentHash: set.contentHash },
        detail: { reason, selectedCount: selected.length, contentHash },
      });

      return toResource(frozen, items);
    });
  }

  /** UNE-KNOW-007 */
  async sourceLocator(auth: AuthContext, itemId: string): Promise<SourceLocatorResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const found = await this.evidence.findItemWithDocument(c, auth.tenantId, itemId);
      if (!found) throw evidenceErrors.itemNotFound();
      return {
        evidenceItemId: found.item.evidenceItemId,
        knowledgeDocumentId: found.item.knowledgeDocumentId,
        providerDocumentId: found.providerDocumentId,
        fileName: found.fileName,
        providerChunkId: found.item.providerChunkId,
        citationKey: found.item.citationKey,
        quote: found.item.quoteText,
        locator: found.item.sourceLocatorJson,
      };
    });
  }
}
