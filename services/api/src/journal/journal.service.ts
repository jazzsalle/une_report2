import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  acceptProposal,
  canTransitionJournal,
  documentIrHash,
  factLines,
  factParagraphText,
  findFactContradictions,
  isJournalEditable,
  JOURNAL_SECTION_TITLES,
  projectJournal,
  projectionHash,
  touchesLockedFacts,
  type DocumentIR,
  type FactContradiction,
  type JournalSection,
  type ProjectedItem,
  type SectionIR,
} from '@une/domain';
import { JOURNAL_NARRATIVE_PROVIDER, type JournalNarrativeProvider } from '@une/provider-adapters';
import { AuditRepository } from '../common/audit.repository';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { DocumentImportService } from '../document/document-import.service';
import { DocumentRepository } from '../document/document.repository';
import { GenerationJobRepository } from '../plan/generation-job.repository';
import type { RequestMeta } from '../plan/plan.service';
import { journalErrors } from './journal-errors';
import { JournalRepository, type JournalRow, type ProjectionItemRow } from './journal.repository';

/**
 * 상황일지 (CC-300, UNE-JNL-005~011).
 *
 * **일지는 문서다.** 리비전·변경집합·Export는 CC-150/CC-160의 것을 그대로
 * 쓴다(0042 §2). 여기가 더하는 것은 셋이다:
 *
 *   1. 확정된 판과 사실원장을 접어 **사실칸**을 만든다.
 *   2. 그 사실칸을 **어떤 편집 경로로도 바꿀 수 없게** 한다.
 *   3. 서술이 사실을 **반박하지 않는지 대조한다** — AI에는 거절, 사람에는 경고.
 */

export interface JournalFactCell {
  sectionKey: string;
  title: string;
  sortOrder: number;
  factPayload: Record<string, unknown>;
  /** 사람이 읽을 표시행. 문서 문단과 같은 표현이다. */
  factRows: Array<{ label: string; value: string }>;
  lockedFields: string[];
  sourceEventIds: string[];
  narrativeText: string | null;
  narrativeSource: string;
  narrativeUpdatedAt: string | null;
  narrativeUpdatedBy: string | null;
  /** 지금 서술이 사실을 반박하는가. 사람 편집에는 경고로만 쓴다. */
  contradictions: FactContradiction[];
}

export interface JournalResource {
  journalId: string;
  situationId: string;
  snapshotId: string;
  documentId: string;
  currentRevisionId: string | null;
  periodStart: string;
  periodEnd: string;
  status: string;
  projectionHash: string;
  createdBy: string;
  createdAt: string;
  /**
   * 만든 뒤 바깥의 사실이 움직였는가.
   *
   * **자동으로 갱신하지 않는다.** 검토·승인 중인 문서가 소리 없이 변하면
   * "검토자가 본 것"과 "승인된 것"이 갈라진다(ADR-44 D4).
   */
  drifted: boolean;
  currentProjectionHash: string;
}

export interface JournalDetailResource {
  journal: JournalResource;
  cells: JournalFactCell[];
  approvals: Array<{
    journalApprovalId: string;
    revisionId: string;
    decision: string;
    decidedBy: string;
    decidedAt: string;
    comment: string | null;
    projectionHash: string;
  }>;
  openReview: {
    journalReviewRequestId: string;
    revisionId: string;
    requestedBy: string;
    requestedAt: string;
    message: string | null;
    reviewerIds: string[];
  } | null;
}

export interface NarrativeProposalResource {
  journalId: string;
  sectionKey: string;
  currentNarrative: string;
  proposedNarrative: string;
  /** **시뮬레이션이라는 사실을 숨기지 않는다** — 실 T3Q 지원이 아니다(OB-03). */
  simulated: boolean;
  adapterId: string;
  /** 대조 결과. 비어 있지 않으면 수락할 수 없다. */
  contradictions: FactContradiction[];
  accepted: boolean;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

@Injectable()
export class JournalService {
  constructor(
    @Inject(JOURNAL_NARRATIVE_PROVIDER)
    private readonly narrative: JournalNarrativeProvider,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(JournalRepository) private readonly repo: JournalRepository,
    @Inject(DocumentRepository) private readonly documents: DocumentRepository,
    @Inject(DocumentImportService) private readonly imports: DocumentImportService,
    @Inject(GenerationJobRepository) private readonly jobs: GenerationJobRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  /**
   * UNE-JNL-005 — Projection 생성.
   *
   * **투영 자체는 동기다.** 이 저장소 안의 데이터를 읽어 접는 계산이라 바깥을
   * 기다리지 않는다(SOP·계획서 생성이 잡인 것은 T3Q·UNI를 기다리기 때문이다).
   *
   * 다만 **양식 반입이 앞에 선다.** 상황일지는 맨바닥에서 생기지 않는다 —
   * US-SIT-030 3단계가 양식 선택을 사용자 행위로, US-SIT-034 4단계가
   * "원본 Template Prototype을 상속해 HWPX를 저장한다"를 완료 조건으로
   * 규정한다. 그리고 CC-160의 Export는 **보존 되쓰기 전용**이라 원본 패키지가
   * 없는 문서는 애초에 내보낼 수 없다. 원본 없이 일지를 만들면 화면에서만
   * 사는 문서가 되고, 그것은 "상황일지를 만들었다"가 아니다.
   *
   * 반입은 저장소 I/O와 HWPX 분석을 포함하므로 **투영 트랜잭션 밖**에서
   * 끝낸다(.claude/rules/backend.md).
   */
  async createProjection(
    auth: AuthContext,
    situationId: string,
    input: {
      snapshotId: string | null;
      from: Date;
      to: Date;
      templateFileId: string;
      eventTypes: string[];
    },
    meta: RequestMeta,
  ): Promise<JournalDetailResource> {
    // 상황과 확정 판을 먼저 본다. 실패할 요청이면 양식을 반입하지 않는다 —
    // 저장소 객체와 문서 번호를 낭비할 이유가 없다.
    const precheck = await this.db.withTenant(auth.tenantId, async (c) => {
      const situation = await this.repo.findSituation(c, auth.tenantId, situationId);
      if (!situation) throw journalErrors.situationNotFound();
      const snapshot = await this.repo.findSnapshot(
        c,
        auth.tenantId,
        situationId,
        input.snapshotId,
      );
      if (!snapshot) throw journalErrors.snapshotRequired();
      return { situation, snapshot };
    });

    // 양식 사본을 만든다 — revision 1은 **양식 그 자체**다. 미지원 객체와
    // 표·스타일이 여기서 보존된다(반입 게이트가 REJECT를 이미 걸러낸다).
    const imported = await this.imports.importFromFileObject(
      auth,
      {
        fileId: input.templateFileId,
        title: `${precheck.situation.title} 상황일지`,
        documentType: 'JOURNAL',
      },
      meta,
    );

    return this.db.withTenant(auth.tenantId, async (c) => {
      const { situation, snapshot } = precheck;
      const items = await this.buildProjection(c, auth, situationId, situation, snapshot, input);
      const hash = projectionHash(items);

      const templateRevision = await this.documents.findRevision(
        c,
        imported.documentId,
        imported.revisionId,
        { withIr: true },
      );
      const templateIr =
        templateRevision && 'irJson' in templateRevision ? templateRevision.irJson : null;
      if (!templateIr) throw journalErrors.templateUnusable();

      const ir = projectIntoTemplate(templateIr, items);
      const revision = await this.documents.insertRevision(c, {
        documentId: imported.documentId,
        revisionNo: imported.revisionNo + 1,
        parentRevisionId: imported.revisionId,
        ir,
        irHash: documentIrHash(ir),
        changeSummary: '상황일지 투영',
        origin: 'PROJECTION',
        checkpointLabel: null,
        createdBy: auth.userId,
      });
      await this.documents.setCurrentRevision(
        c,
        auth.tenantId,
        imported.documentId,
        revision.revisionId,
      );

      const journal = await this.repo.insertJournal(c, {
        situationId,
        snapshotId: snapshot.snapshotId,
        documentId: imported.documentId,
        periodStart: input.from,
        periodEnd: input.to,
        projectionHash: hash,
        eventTypes: input.eventTypes,
        createdBy: auth.userId,
      });
      for (const item of items) {
        await this.repo.insertProjectionItem(c, {
          journalId: journal.journalId,
          sectionKey: item.sectionKey,
          sourceEventIds: item.sourceEventIds,
          factPayload: item.factPayload,
          narrativeText: item.narrativeText,
          sortOrder: item.sortOrder,
          lockedFields: item.lockedFields,
        });
      }

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'JOURNAL_PROJECTED',
        resourceType: 'JOURNAL',
        resourceId: journal.journalId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: {
          situationId,
          snapshotId: snapshot.snapshotId,
          sectionCount: items.length,
          projectionHash: hash,
        },
      });

      return this.assemble(c, journal, revision.revisionId, hash);
    });
  }

  /** UNE-JNL-006 — 상세. 드리프트도 여기서 드러난다. */
  async getJournal(auth: AuthContext, journalId: string): Promise<JournalDetailResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const journal = await this.repo.findJournal(c, auth.tenantId, journalId);
      if (!journal) throw journalErrors.notFound();
      const document = await this.documents.findDocument(c, auth.tenantId, journal.documentId);
      const current = await this.recomputeHash(c, auth, journal);
      return this.assemble(c, journal, document?.currentRevisionId ?? null, current);
    });
  }

  /**
   * UNE-JNL-007 — AI 서술 제안.
   *
   * **AI에는 fail-closed다.** 제안이 사실을 반박하면 수락하지 않는다 — 거절
   * 비용은 "운영자가 그 문장을 직접 쓴다"뿐이고, 통과 비용은 틀린 숫자가
   * 승인된 일지에 남는 것이다.
   *
   * 지금 붙은 어댑터는 규칙 기반 시뮬레이션 하나다(T3Q 계약에 일지 서술 연산이
   * 없다, OB-03). 그 사실이 응답에 실린다.
   */
  async proposeNarratives(
    auth: AuthContext,
    journalId: string,
    input: { sections: string[]; styleRules: Record<string, unknown> },
    meta: RequestMeta,
  ): Promise<NarrativeProposalResource[]> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const journal = await this.repo.findJournal(c, auth.tenantId, journalId);
      if (!journal) throw journalErrors.notFound();
      if (!isJournalEditable(journal.status)) throw journalErrors.notEditable(journal.status);

      const cells = await this.repo.listProjectionItems(c, journalId);
      const wanted = input.sections.length > 0 ? new Set(input.sections) : null;
      const targets = cells.filter((cell) => !wanted || wanted.has(cell.sectionKey));
      for (const section of input.sections) {
        if (!cells.some((cell) => cell.sectionKey === section)) {
          throw journalErrors.sectionNotFound(section);
        }
      }

      const out: NarrativeProposalResource[] = [];
      /** 어댑터 원문. "그때 무엇이 왔는가"를 나중에 물을 수 있어야 한다. */
      const raws: Array<{ sectionKey: string; adapterId: string; raw: Record<string, unknown> }> =
        [];
      for (const cell of targets) {
        const proposal = await this.narrative.propose({
          sectionKey: cell.sectionKey,
          currentNarrative: cell.narrativeText ?? '',
          factPayload: cell.factPayload,
          styleRules: input.styleRules,
        });
        const contradictions = findFactContradictions(cell.factPayload, proposal.proposedNarrative);

        // 규칙은 도메인이 갖고 있다 — 지금 어댑터로는 이 분기가 발동하지
        // 않으므로(반박이 구조적으로 없다) 규칙 자체를 이름 붙여 시험한다.
        const accepted = acceptProposal({
          contradictions,
          narrativeSource: cell.narrativeSource,
        });
        if (accepted) {
          await this.repo.updateNarrative(c, {
            journalId,
            sectionKey: cell.sectionKey,
            narrativeText: proposal.proposedNarrative,
            source: 'AI',
            actorId: auth.userId,
          });
        }
        raws.push({
          sectionKey: cell.sectionKey,
          adapterId: proposal.adapterId,
          raw: proposal.raw,
        });
        out.push({
          journalId,
          sectionKey: cell.sectionKey,
          currentNarrative: cell.narrativeText ?? '',
          proposedNarrative: proposal.proposedNarrative,
          simulated: proposal.simulated,
          adapterId: proposal.adapterId,
          contradictions,
          accepted,
        });
      }

      const rejected = out.filter((p) => p.contradictions.length > 0);
      const acceptedCount = out.filter((p) => p.accepted).length;

      // **제안 요청을 남긴다.** `ai_edit_proposal` 테이블을 만들지 않은 근거가
      // "generation_job이 이미 그 일을 한다"인데, 실제로 쓰지 않으면 그 근거가
      // 무너지고 제안 이력이 아무 데도 남지 않는다(이중검토 M-6).
      await this.jobs.insertJob(c, {
        tenantId: auth.tenantId,
        jobType: 'AI_EDIT',
        aggregateType: 'DOCUMENT',
        aggregateId: journal.documentId,
        providerCode: 'UNE',
        requestJson: {
          journalId,
          sections: targets.map((t) => t.sectionKey),
          styleRules: input.styleRules,
          adapterId: this.narrative.adapterId,
          simulated: this.narrative.isSimulated,
        },
        idempotencyKey: `jnl-ai-${journalId}-${meta.correlationId}`,
        correlationId: meta.correlationId,
      });

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'JOURNAL_AI_DRAFT',
        resourceType: 'JOURNAL',
        resourceId: journalId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: {
          sections: targets.map((t) => t.sectionKey),
          accepted: acceptedCount,
          rejected: rejected.length,
          simulated: this.narrative.isSimulated,
          adapterId: this.narrative.adapterId,
          // 어댑터 원문 보존(provider-adapters.md "Keep raw request/response").
          raw: raws,
        },
      });

      // 반영된 문장이 있으면 **판을 만든다** — 없으면 종이에는 옛 문장이 간다.
      if (acceptedCount > 0) {
        await this.writeJournalRevision(
          c,
          auth,
          journal,
          'CHANGESET',
          `상황일지 AI 문안 반영 (${out
            .filter((p) => p.accepted)
            .map((p) => p.sectionKey)
            .join(', ')})`,
        );
      }

      if (rejected.length > 0 && out.every((p) => !p.accepted)) {
        // 하나도 못 받아들였으면 실패로 답한다 — 200으로 주면 화면이 반영된
        // 줄 안다.
        throw journalErrors.proposalRejected(
          rejected.flatMap((p) =>
            p.contradictions.map((cd) => ({
              field: `${p.sectionKey}.${cd.field}`,
              reason: `사실 ${cd.factValue}인데 서술이 ${cd.narrativeValue}라고 적었습니다 (${cd.excerpt}).`,
            })),
          ),
        );
      }
      return out;
    });
  }

  /**
   * UNE-JNL-008 — 서술 편집.
   *
   * 사실칸을 건드리는 요청은 거절하고, 서술이 사실을 반박하면 **경고를 달되
   * 막지 않는다** — 사람은 자기가 무엇을 쓰는지 알고 쓸 수 있어야 하고,
   * 오탐으로 편집을 막으면 사람이 우회로를 찾는다.
   */
  async editNarratives(
    auth: AuthContext,
    journalId: string,
    input: {
      operations: Array<{
        sectionKey: string;
        narrativeText: string;
        /** 요청이 실제로 실어 보낸 키. 사실칸을 건드리려는 시도를 여기서 본다. */
        requestedFields: string[];
      }>;
      baseRevisionId: string | null;
    },
    meta: RequestMeta,
  ): Promise<JournalDetailResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const journal = await this.repo.findJournal(c, auth.tenantId, journalId);
      if (!journal) throw journalErrors.notFound();
      if (!isJournalEditable(journal.status)) throw journalErrors.notEditable(journal.status);
      await this.assertBaseRevision(c, auth, journal, input.baseRevisionId);

      for (const op of input.operations) {
        const cell = await this.repo.findProjectionItem(c, journalId, op.sectionKey);
        if (!cell) throw journalErrors.sectionNotFound(op.sectionKey);
        // 구조적 분리가 하드 불변식이고, 이 검사는 그 위의 두 번째 겹이다.
        // **원본 요청의 키**를 본다 — 컨트롤러가 재구성한 객체를 보면 교집합이
        // 구조적으로 공집합이라 검사가 공회전한다(이중검토 M-1).
        const locked = touchesLockedFacts(cell.lockedFields, op.requestedFields);
        if (locked.length > 0) throw journalErrors.factLocked(locked);

        await this.repo.updateNarrative(c, {
          journalId,
          sectionKey: op.sectionKey,
          narrativeText: op.narrativeText,
          source: 'USER',
          actorId: auth.userId,
        });
      }

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'JOURNAL_EDITED',
        resourceType: 'JOURNAL',
        resourceId: journalId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { sections: input.operations.map((o) => o.sectionKey) },
      });

      const revisionId = await this.writeJournalRevision(
        c,
        auth,
        journal,
        'CHANGESET',
        `상황일지 서술 편집 (${input.operations.map((o) => o.sectionKey).join(', ')})`,
      );
      return this.assemble(c, journal, revisionId, await this.recomputeHash(c, auth, journal));
    });
  }

  /**
   * 사실 갱신 — 드리프트를 사람이 눌러 반영한다.
   *
   * **사람이 손댄 칸은 덮지 않는다.** 그리고 자동으로 돌지 않는다: 검토·승인
   * 중인 문서가 소리 없이 변하면 승인자가 본 것과 승인된 것이 갈라진다.
   */
  async refreshFacts(
    auth: AuthContext,
    journalId: string,
    meta: RequestMeta,
  ): Promise<JournalDetailResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const journal = await this.repo.findJournal(c, auth.tenantId, journalId);
      if (!journal) throw journalErrors.notFound();
      if (!isJournalEditable(journal.status)) throw journalErrors.notEditable(journal.status);

      const situation = await this.repo.findSituation(c, auth.tenantId, journal.situationId);
      if (!situation) throw journalErrors.situationNotFound();
      const snapshot = await this.repo.findSnapshot(
        c,
        auth.tenantId,
        journal.situationId,
        journal.snapshotId,
      );
      if (!snapshot) throw journalErrors.snapshotRequired();

      const items = await this.buildProjection(c, auth, journal.situationId, situation, snapshot, {
        from: journal.periodStart,
        to: journal.periodEnd,
        // **만들 때 고른 범위 그대로** 다시 접는다. 무필터로 접으면 사용자가
        // 고른 범위가 말없이 전체로 넓어진다(이중검토 C-3).
        eventTypes: journal.eventTypes,
      });
      let kept = 0;
      for (const item of items) {
        const result = await this.repo.refreshProjectionItem(c, {
          journalId,
          sectionKey: item.sectionKey,
          sourceEventIds: item.sourceEventIds,
          factPayload: item.factPayload,
          narrativeText: item.narrativeText,
          lockedFields: item.lockedFields,
        });
        if (result.narrativeKept) kept += 1;
      }
      const hash = projectionHash(items);
      await this.repo.setProjectionHash(c, journalId, hash);

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'JOURNAL_FACTS_REFRESHED',
        resourceType: 'JOURNAL',
        resourceId: journalId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { projectionHash: hash, userNarrativesKept: kept },
      });

      const revisionId = await this.writeJournalRevision(
        c,
        auth,
        journal,
        'PROJECTION',
        '상황일지 사실 갱신',
      );
      return this.assemble(c, { ...journal, projectionHash: hash }, revisionId, hash);
    });
  }

  /** UNE-JNL-009 — 검토요청. */
  async submitReview(
    auth: AuthContext,
    journalId: string,
    input: { reviewerIds: string[]; message: string | null },
    meta: RequestMeta,
  ): Promise<JournalDetailResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const journal = await this.repo.findJournal(c, auth.tenantId, journalId);
      if (!journal) throw journalErrors.notFound();
      if (!canTransitionJournal(journal.status, 'REVIEW')) {
        throw journalErrors.cannotSubmitReview(journal.status);
      }
      const document = await this.documents.findDocument(c, auth.tenantId, journal.documentId);
      const revisionId = document?.currentRevisionId;
      if (!revisionId) throw journalErrors.notFound();

      // **드리프트한 채로 검토에 넣지 않는다.** 여기가 고칠 수 있는 마지막
      // 지점이다 — 검토 중에는 사실 갱신이 막히므로(초안·반려에서만 편집),
      // 낡은 채 들어가면 반려하고 되돌아오는 것 말고 길이 없다.
      const current = await this.recomputeHash(c, auth, journal);
      if (current !== journal.projectionHash) throw journalErrors.driftedForReview();

      const moved = await this.repo.setJournalStatus(
        c,
        auth.tenantId,
        journalId,
        journal.status,
        'REVIEW',
      );
      if (!moved) throw journalErrors.cannotSubmitReview(journal.status);

      // 문서도 함께 잠근다. 일지 테이블만 옮기면 CC-150 편집 표면이
      // `document.status === 'EDITING'`만 보고 본문을 계속 받아 준다.
      await this.documents.setDocumentStatus(c, auth.tenantId, journal.documentId, 'REVIEW');

      await this.repo.insertReviewRequest(c, {
        journalId,
        revisionId,
        requestedBy: auth.userId,
        message: input.message,
        reviewerIds: input.reviewerIds,
      });
      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'JOURNAL_REVIEW_REQUESTED',
        resourceType: 'JOURNAL',
        resourceId: journalId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { revisionId, reviewerCount: input.reviewerIds.length },
      });

      return this.assemble(c, { ...journal, status: 'REVIEW' }, revisionId, current);
    });
  }

  /**
   * UNE-JNL-010 — 승인·반려.
   *
   * 승인 기록에 **그 순간의 투영 해시**를 함께 남긴다. 그 뒤 사실이 바뀌면
   * "승인된 것"과 "지금 사실"이 다르다는 것이 그 값으로 드러난다.
   */
  async decide(
    auth: AuthContext,
    journalId: string,
    input: { decision: 'APPROVED' | 'CHANGES_REQUESTED'; comment: string | null },
    meta: RequestMeta,
  ): Promise<JournalDetailResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const journal = await this.repo.findJournal(c, auth.tenantId, journalId);
      if (!journal) throw journalErrors.notFound();
      if (!canTransitionJournal(journal.status, input.decision)) {
        throw journalErrors.cannotDecide(journal.status);
      }

      const review = await this.repo.findOpenReviewRequest(c, journalId);
      const document = await this.documents.findDocument(c, auth.tenantId, journal.documentId);
      const revisionId = document?.currentRevisionId;
      if (!revisionId) throw journalErrors.notFound();

      // 검토받은 판이 아니면 승인하지 않는다 — 승인자가 본 것과 승인되는 것이
      // 다르면 승인이 무엇을 뜻하는지 알 수 없다.
      if (review && review.revisionId !== revisionId) {
        throw journalErrors.revisionMoved(review.revisionId);
      }

      const moved = await this.repo.setJournalStatus(
        c,
        auth.tenantId,
        journalId,
        journal.status,
        input.decision,
      );
      if (!moved) throw journalErrors.cannotDecide(journal.status);

      // **문서를 함께 옮긴다** — 이것이 없으면 승인된 일지의 본문을
      // `/documents/{id}/changesets`·autosave·Undo로 계속 고칠 수 있고,
      // 승인된 적 없는 판이 승인된 일지로 나간다(이중검토 C-2).
      await this.documents.setDocumentStatus(
        c,
        auth.tenantId,
        journal.documentId,
        input.decision === 'APPROVED' ? 'APPROVED' : 'EDITING',
      );

      if (review)
        await this.repo.closeReviewRequest(c, review.journalReviewRequestId, input.decision);
      await this.repo.insertApproval(c, {
        journalId,
        revisionId,
        reviewRequestId: review?.journalReviewRequestId ?? null,
        decision: input.decision,
        decidedBy: auth.userId,
        comment: input.comment,
        projectionHash: journal.projectionHash,
      });
      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: input.decision === 'APPROVED' ? 'JOURNAL_APPROVED' : 'JOURNAL_CHANGES_REQUESTED',
        resourceType: 'JOURNAL',
        resourceId: journalId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { revisionId, projectionHash: journal.projectionHash },
      });

      return this.assemble(
        c,
        { ...journal, status: input.decision },
        revisionId,
        await this.recomputeHash(c, auth, journal),
      );
    });
  }

  /** Export 선행조건. 실제 Export는 CC-160 경로가 한다. */
  async exportPrecondition(
    auth: AuthContext,
    journalId: string,
  ): Promise<{ documentId: string; revisionId: string }> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const journal = await this.repo.findJournal(c, auth.tenantId, journalId);
      if (!journal) throw journalErrors.notFound();

      // **승인된 것만 나간다**(설계 06 US-SIT-034: 승인 → 직렬화 → 검증).
      // 초안이 종이가 되면 그것을 초안으로 읽어 줄 사람이 없다.
      if (journal.status !== 'APPROVED') {
        throw journalErrors.exportBeforeApproval(journal.status);
      }

      // **승인된 판을 내보낸다** — 문서의 현재 판이 아니다. 두 값이 다르면
      // 승인 이후에 본문이 움직였다는 뜻이고, 그것은 내보낼 것이 아니다.
      const approvedRevisionId = await this.repo.findApprovedRevisionId(c, journalId);
      if (!approvedRevisionId) throw journalErrors.exportBeforeApproval(journal.status);
      const document = await this.documents.findDocument(c, auth.tenantId, journal.documentId);
      if (document?.currentRevisionId !== approvedRevisionId) {
        throw journalErrors.exportRejected([
          {
            field: 'revisionId',
            reason: '승인된 판과 문서의 현재 판이 다릅니다.',
          },
        ]);
      }

      // **드리프트는 여기서 막지 않는다.** 승인된 일지는 그 시점의 기록이고,
      // 살아 있는 상황에서는 승인 직후부터 바깥의 사실이 계속 움직인다.
      // 여기서 막으면 승인된 일지를 영영 내보낼 수 없다. 낡음을 막을 자리는
      // 검토요청(고칠 수 있는 마지막 지점)이다.
      return { documentId: journal.documentId, revisionId: approvedRevisionId };
    });
  }

  // -------------------------------------------------------------------------
  // 내부
  // -------------------------------------------------------------------------

  private async buildProjection(
    c: PoolClient,
    auth: AuthContext,
    situationId: string,
    situation: { title: string; mode: string },
    snapshot: {
      snapshotId: string;
      versionNo: number;
      effectiveAt: Date;
      facts: Array<Record<string, unknown>>;
    },
    input: { from: Date; to: Date; eventTypes: string[] },
  ): Promise<ProjectedItem[]> {
    const events = await this.repo.listEvents(c, auth.tenantId, situationId, input.from, input.to);
    const tasks = await this.repo.listSituationTasks(c, auth.tenantId, situationId, input.to);
    return projectJournal({
      situationTitle: situation.title,
      mode: situation.mode,
      periodStart: input.from,
      periodEnd: input.to,
      snapshot,
      // **정정된 원본은 담지 않는다** — 정정 이벤트가 유효값을 들고 있다
      // (CC-290 D4의 star 구조). 원본까지 담으면 같은 사실이 두 번 세어진다.
      events: events.filter((e) => !events.some((other) => other.correctsEventId === e.eventId)),
      tasks,
      eventTypes: input.eventTypes,
    });
  }

  /**
   * 낙관적 잠금 (이중검토 M-5).
   *
   * 계약이 `baseRevisionId`를 광고하면서 구현이 읽지 않으면, 두 사람이 같은
   * 절을 저장할 때 나중 것이 조용히 이긴다 — 그리고 계약은 있지도 않은
   * 방어를 약속한 것이 된다.
   */
  private async assertBaseRevision(
    c: PoolClient,
    auth: AuthContext,
    journal: JournalRow,
    baseRevisionId: string | null,
  ): Promise<void> {
    if (!baseRevisionId) return;
    const document = await this.documents.findDocument(c, auth.tenantId, journal.documentId);
    if (document?.currentRevisionId !== baseRevisionId) {
      throw journalErrors.revisionMoved(document?.currentRevisionId ?? null);
    }
  }

  /**
   * 바뀐 칸을 **문서 판에 반영한다** (CC-300 이중검토 C-1).
   *
   * 이것이 없으면 화면과 DB는 새 문장을 보여 주는데 종이에는 투영 당시의
   * 문장이 나간다 — 그리고 그 어긋남을 아무도 볼 수 없다. Export는
   * `document_revision.ir_json`에서만 렌더하기 때문이다.
   *
   * 판을 하나 더 만드는 것이지 두 번째 리비전 체계를 만드는 것이 아니다
   * (ADR-44 D1). 계보는 `document_revision` 하나다.
   */
  private async writeJournalRevision(
    c: PoolClient,
    auth: AuthContext,
    journal: JournalRow,
    origin: 'CHANGESET' | 'PROJECTION',
    summary: string,
  ): Promise<string> {
    const head = await this.documents.findHeadRevision(c, journal.documentId, { withIr: true });
    const headIr = head && 'irJson' in head ? head.irJson : null;
    if (!head || !headIr) throw journalErrors.notFound();

    const cells = await this.repo.listProjectionItems(c, journal.journalId);
    const ir = applyCellsToIr(headIr, cells);
    const revision = await this.documents.insertRevision(c, {
      documentId: journal.documentId,
      revisionNo: head.revisionNo + 1,
      parentRevisionId: head.revisionId,
      ir,
      irHash: documentIrHash(ir),
      changeSummary: summary,
      origin,
      checkpointLabel: null,
      createdBy: auth.userId,
    });
    await this.documents.setCurrentRevision(
      c,
      auth.tenantId,
      journal.documentId,
      revision.revisionId,
    );
    return revision.revisionId;
  }

  /** 지금 사실로 다시 접으면 해시가 무엇인가. 드리프트 판단의 전부다. */
  private async recomputeHash(
    c: PoolClient,
    auth: AuthContext,
    journal: JournalRow,
  ): Promise<string> {
    const situation = await this.repo.findSituation(c, auth.tenantId, journal.situationId);
    const snapshot = await this.repo.findSnapshot(
      c,
      auth.tenantId,
      journal.situationId,
      journal.snapshotId,
    );
    if (!situation || !snapshot) return journal.projectionHash;
    const items = await this.buildProjection(c, auth, journal.situationId, situation, snapshot, {
      from: journal.periodStart,
      to: journal.periodEnd,
      eventTypes: journal.eventTypes,
    });
    return projectionHash(items);
  }

  private async assemble(
    c: PoolClient,
    journal: JournalRow,
    currentRevisionId: string | null,
    currentHash: string,
  ): Promise<JournalDetailResource> {
    const [items, approvals, openReview] = await Promise.all([
      this.repo.listProjectionItems(c, journal.journalId),
      this.repo.listApprovals(c, journal.journalId),
      this.repo.findOpenReviewRequest(c, journal.journalId),
    ]);
    return {
      journal: {
        journalId: journal.journalId,
        situationId: journal.situationId,
        snapshotId: journal.snapshotId,
        documentId: journal.documentId,
        currentRevisionId,
        periodStart: iso(journal.periodStart) as string,
        periodEnd: iso(journal.periodEnd) as string,
        status: journal.status,
        projectionHash: journal.projectionHash,
        createdBy: journal.createdBy,
        createdAt: iso(journal.createdAt) as string,
        drifted: currentHash !== journal.projectionHash,
        currentProjectionHash: currentHash,
      },
      cells: items.map(toCell),
      approvals: approvals.map((a) => ({
        journalApprovalId: a.journalApprovalId,
        revisionId: a.revisionId,
        decision: a.decision,
        decidedBy: a.decidedBy,
        decidedAt: iso(a.decidedAt) as string,
        comment: a.comment,
        projectionHash: a.projectionHash,
      })),
      openReview: openReview
        ? {
            journalReviewRequestId: openReview.journalReviewRequestId,
            revisionId: openReview.revisionId,
            requestedBy: openReview.requestedBy,
            requestedAt: iso(openReview.requestedAt) as string,
            message: openReview.message,
            reviewerIds: openReview.reviewerIds,
          }
        : null,
    };
  }
}

function toCell(row: ProjectionItemRow): JournalFactCell {
  return {
    sectionKey: row.sectionKey,
    title: JOURNAL_SECTION_TITLES[row.sectionKey as JournalSection] ?? row.sectionKey,
    sortOrder: row.sortOrder,
    factPayload: row.factPayload,
    // 사람이 읽을 표시행. **문서 문단과 같은 함수에서 나온다** — 화면이 자기
    // 라벨 표를 따로 들면 종이와 화면이 갈라진다(이중검토 M-2).
    factRows: factLines(row.factPayload).map(([label, value]) => ({ label, value })),
    lockedFields: row.lockedFields,
    sourceEventIds: row.sourceEventIds,
    narrativeText: row.narrativeText,
    narrativeSource: row.narrativeSource,
    narrativeUpdatedAt: iso(row.narrativeUpdatedAt),
    narrativeUpdatedBy: row.narrativeUpdatedBy,
    // 사람 편집에는 경고로만 쓴다 — 막지 않는다.
    contradictions: row.narrativeText
      ? findFactContradictions(row.factPayload, row.narrativeText)
      : [],
  };
}

/**
 * 바뀐 칸을 판의 IR에 되쓴다 (CC-300 이중검토 C-1).
 *
 * 투영이 심어 둔 문단 ID(`{sectionKey}::FACT` / `::NARRATIVE`)를 찾아 글자만
 * 바꾼다. 문단을 새로 만들지 않으므로 양식의 구조·스타일·미지원 객체는
 * 그대로다. 문단을 찾지 못하면 **조용히 넘어가지 않는다** — 그 절은 종이에
 * 나가지 않는다는 뜻이고, 그것을 모르는 채 승인하면 안 된다.
 */
function applyCellsToIr(
  ir: DocumentIR,
  cells: readonly {
    sectionKey: string;
    factPayload: Record<string, unknown>;
    narrativeText: string | null;
  }[],
): DocumentIR {
  const wanted = new Map<string, string>();
  for (const cell of cells) {
    wanted.set(`${cell.sectionKey}::FACT`, factParagraphText(cell.sectionKey, cell.factPayload));
    wanted.set(`${cell.sectionKey}::NARRATIVE`, cell.narrativeText ?? '');
  }

  const seen = new Set<string>();
  const sections = ir.sections.map((section) => ({
    ...section,
    blocks: section.blocks.map((block) => {
      if (block.kind !== 'PARAGRAPH') return block;
      const text = wanted.get(block.paragraphId);
      if (text === undefined) return block;
      seen.add(block.paragraphId);
      return {
        ...block,
        runs: [{ ...block.runs[0], runId: `${block.paragraphId}::r0`, text }],
      };
    }),
  }));

  const missing = [...wanted.keys()].filter((id) => !seen.has(id));
  if (missing.length > 0) throw journalErrors.documentOutOfSync(missing);

  return { ...ir, sections };
}

/**
 * 되쓸 수 있는 앵커의 자리를 고른다 — **원본에서 온, 글자가 있는 최상위 문단**.
 *
 * `from`에서 뒤로 훑고 없으면 앞으로 훑는다. 조건 셋.
 *   * 최상위 블록일 것 — 표 셀 안 문단은 되쓰기 범위가 아니다(ADR-31).
 *   * `origin === 'SOURCE'` — 우리가 넣은 문단은 원본이 아니다.
 *   * **글자가 있을 것** — 빈 문단은 복제 원본이 못 된다(`classifyRun`이
 *     EMPTY로 보고, 복제기가 "복제 가능한 문단이 없다"로 죽는다).
 */
function findAnchorIndex(blocks: SectionIR['blocks'], from: number): number {
  const usable = (b: SectionIR['blocks'][number]): boolean =>
    b.kind === 'PARAGRAPH' &&
    b.origin === 'SOURCE' &&
    b.runs.some((run) => run.text.trim().length > 0 && run.controls.length === 0) &&
    b.runs.every((run) => run.controls.length === 0);
  for (let i = Math.min(from, blocks.length - 1); i >= 0; i -= 1) {
    if (usable(blocks[i])) return i;
  }
  for (let i = Math.max(from + 1, 0); i < blocks.length; i += 1) {
    if (usable(blocks[i])) return i;
  }
  return -1;
}

/** 문단 하나의 글자를 잇는다. 표제 대조용이라 서식은 보지 않는다. */
function paragraphText(block: SectionIR['blocks'][number]): string {
  if (block.kind !== 'PARAGRAPH') return '';
  return block.runs.map((r) => r.text).join('');
}

/**
 * 투영을 **양식 위에** 얹는다 (CC-300, ADR-44 D9).
 *
 * 무엇을 하는가.
 *   반입된 양식 IR을 그대로 두고, 절마다 문단 두 개(사실칸·서술칸)를 넣는다.
 *   양식에 그 절의 표제가 있으면 **그 뒤에** 넣고, 없으면 문서 끝에 붙인다.
 *   문단 서식은 앵커가 된 문단에서 물려받는다 — 이것이 US-SIT-034 4단계
 *   "원본 Template Prototype 상속"의 문단 수준 이행이다.
 *
 * **무엇을 하지 않는가 — 표 칸을 채우지 않는다.** 실제 상황일지 양식은
 * 표의 지정 칸을 채우는 물건이지만, CC-160의 되쓰기 범위가 텍스트 교체·문단
 * 삽입·삭제뿐이라(ADR-31) 행 복제가 필요한 칸 채움은 성립하지 않는다. 지금
 * 산출물은 "양식이 채워진 상황일지"가 아니라 **"양식 사본에 절별로 부기된
 * 상황일지"**다(ADR-44 수용 한계 2). 이 문장을 완화해 적으면 안 된다.
 *
 * **사실칸은 잠근 채로 넣는다**(`editState.locked`). CC-150의 변경집합
 * 검증기가 이미 `LOCKED_BLOCK`을 거절하므로, 문서 편집 경로로 사실을
 * 바꾸려는 시도도 그 자리에서 막힌다 — 방어가 두 겹이 된다.
 */
function projectIntoTemplate(template: DocumentIR, items: readonly ProjectedItem[]): DocumentIR {
  const sections = template.sections.map((s) => ({ ...s, blocks: [...s.blocks] }));
  if (sections.length === 0) {
    throw journalErrors.templateUnusable();
  }
  const tail = sections[sections.length - 1];
  /** 이 함수가 넣은 문단. 다음 절의 앵커 탐색에서 제외한다. */
  const inserted = new Set<string>();

  for (const item of items) {
    const title = JOURNAL_SECTION_TITLES[item.sectionKey] ?? item.sectionKey;
    // 절 표제를 찾는다. 짧은 문단만 본다 — 본문 한가운데에 절 이름이 스치듯
    // 나오는 문장 뒤에 끼워 넣으면 양식이 망가진다.
    let target = tail;
    let at = tail.blocks.length;
    for (const section of sections) {
      const idx = section.blocks.findIndex((b) => {
        // **이미 넣은 문단은 앵커가 아니다.** 앞 절의 서술이 짧고 다음 절
        // 이름을 담고 있으면 그 뒤에 끼워 넣게 된다.
        if (b.kind === 'PARAGRAPH' && inserted.has(b.paragraphId)) return false;
        const text = paragraphText(b).trim();
        return text.length > 0 && text.length <= 40 && text.includes(title);
      });
      if (idx >= 0) {
        target = section;
        at = idx + 1;
        break;
      }
    }

    // **앵커는 되쓸 수 있는 원본 문단이어야 한다.**
    //
    // 보존 되쓰기는 두 가지를 요구한다: 앵커 사슬이 `rawXmlAnchor`를 가진
    // 원본 문단에 닿을 것(절이나 표를 가리키면 사슬이 끊긴다), 그리고 그
    // 문단이 **복제 가능한 모양**일 것(글자가 있는 단순 run — 빈 문단은
    // 복제 원본이 못 된다). 둘 중 하나만 어긋나도 접수는 202로 성공하고
    // 워커에서 조용히 실패한다. 사람은 나갔다고 믿는다.
    //
    // 삽입 위치도 앵커 바로 뒤로 맞춘다 — IR 순서와 XML 순서가 갈라지면
    // 다음 편집이 엉뚱한 자리를 고친다.
    const anchorIndex = findAnchorIndex(target.blocks, at - 1);
    if (anchorIndex < 0) throw journalErrors.templateUnusable();
    const anchor = target.blocks[anchorIndex] as SectionIR['blocks'][number] & {
      kind: 'PARAGRAPH';
    };
    at = anchorIndex + 1;
    const styleRef = { ...anchor.styleRef };

    const factId = `${item.sectionKey}::FACT`;
    const narrativeId = `${item.sectionKey}::NARRATIVE`;
    inserted.add(factId);
    inserted.add(narrativeId);
    target.blocks.splice(
      at,
      0,
      {
        kind: 'PARAGRAPH',
        paragraphId: factId,
        runs: [
          {
            runId: `${factId}::r0`,
            text: factParagraphText(item.sectionKey, item.factPayload),
            charPrId: styleRef.charPrId,
            controls: [],
          },
        ],
        styleRef,
        // 투영된 사실이다. 사람도 AI도 여기를 통과할 수 없다.
        editState: { editedByUser: false, locked: true },
        origin: 'AUTHORED',
        anchorHint: { relation: 'AFTER', ref: anchor.paragraphId },
      },
      {
        kind: 'PARAGRAPH',
        paragraphId: narrativeId,
        runs: [
          {
            runId: `${narrativeId}::r0`,
            text: item.narrativeText,
            charPrId: styleRef.charPrId,
            controls: [],
          },
        ],
        styleRef: { ...styleRef },
        editState: { editedByUser: false, locked: false },
        origin: 'AUTHORED',
        anchorHint: { relation: 'AFTER', ref: factId },
      },
    );
  }

  return { ...template, sections };
}
