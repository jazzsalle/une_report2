import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { isJournalSection, JOURNAL_SECTIONS } from '@une/domain';
import { ApiError, type ErrorViolation } from '../common/api-error';
import { requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { ExportService, type ExportJobResource } from '../document/export.service';
import { journalErrors } from './journal-errors';
import {
  JournalService,
  type JournalDetailResource,
  type NarrativeProposalResource,
} from './journal.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NARRATIVE = 8000;
const MAX_REVIEWERS = 20;
const MAX_COMMENT = 2000;
/** 일지 기간 상한. 넘으면 재생이 상황 전체를 끌어온다. */
const MAX_PERIOD_DAYS = 90;

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function isoDate(v: unknown, field: string, violations: ErrorViolation[]): Date | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') {
    violations.push({ field, reason: 'ISO-8601 문자열이어야 합니다.' });
    return null;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    violations.push({ field, reason: '읽을 수 없는 시각입니다.' });
    return null;
  }
  return d;
}

function badRequest(violations: ErrorViolation[]): ApiError {
  return new ApiError(400, 'JOURNAL-400-001', '요청을 확인하십시오.', {
    recoverable: true,
    violations,
  });
}

/** UNE-JNL-005 — 상황 단위 생성. */
@Controller('situations')
export class SituationJournalController {
  constructor(@Inject(JournalService) private readonly journals: JournalService) {}

  @Post(':id/journal-projections')
  @RequirePermission('JOURNAL_CREATE')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async project(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<JournalDetailResource>> {
    const auth = requireAuth(req);
    const situationId = uuidParam('id', id);
    const b = rec(body);
    const violations: ErrorViolation[] = [];

    const from = isoDate(b.from, 'from', violations);
    const to = isoDate(b.to, 'to', violations);
    if (!from) violations.push({ field: 'from', reason: '기간 시작이 필요합니다.' });
    if (!to) violations.push({ field: 'to', reason: '기간 끝이 필요합니다.' });
    if (from && to) {
      if (from.getTime() >= to.getTime()) {
        violations.push({ field: 'from', reason: '시작이 끝보다 빨라야 합니다.' });
      } else if (to.getTime() - from.getTime() > MAX_PERIOD_DAYS * 86_400_000) {
        violations.push({ field: 'to', reason: `기간은 ${MAX_PERIOD_DAYS}일 이하여야 합니다.` });
      }
    }
    let snapshotId: string | null = null;
    if (b.snapshotId !== undefined && b.snapshotId !== null) {
      if (typeof b.snapshotId !== 'string' || !UUID.test(b.snapshotId)) {
        violations.push({ field: 'snapshotId', reason: 'UUID여야 합니다.' });
      } else snapshotId = b.snapshotId;
    }
    const eventTypes = Array.isArray(b.eventTypes) ? b.eventTypes : [];
    if (eventTypes.some((t) => typeof t !== 'string' || t.length > 50)) {
      violations.push({ field: 'eventTypes', reason: '이벤트 종류 문자열 목록이어야 합니다.' });
    }
    // **양식은 선택이 아니다.** 설계 06 US-SIT-030 3단계가 양식 선택을 사용자
    // 행위로 규정하고, US-SIT-034 4단계가 "원본 Template Prototype 상속"을
    // 완료 조건으로 둔다. 원본 패키지가 없으면 CC-160의 보존 Export가 성립하지
    // 않으므로, 양식 없는 일지는 내보낼 수 없는 문서가 된다.
    let templateFileId = '';
    if (typeof b.templateFileId !== 'string' || !UUID.test(b.templateFileId)) {
      violations.push({ field: 'templateFileId', reason: '검증된 HWPX 양식 파일이 필요합니다.' });
    } else templateFileId = b.templateFileId;
    if (violations.length > 0) throw journalErrors.invalidPeriod(violations);

    return ok(
      req,
      await this.journals.createProjection(
        auth,
        situationId,
        {
          snapshotId,
          from: from as Date,
          to: to as Date,
          templateFileId,
          eventTypes: eventTypes as string[],
        },
        requestMeta(req),
      ),
    );
  }
}

/** UNE-JNL-006~011 — 일지 단위. */
@Controller('journals')
export class JournalController {
  constructor(
    @Inject(JournalService) private readonly journals: JournalService,
    @Inject(ExportService) private readonly exports: ExportService,
  ) {}

  @Get(':journalId')
  @RequirePermission('JOURNAL_READ')
  async detail(
    @Req() req: ApiRequest,
    @Param('journalId') journalId: string,
  ): Promise<SuccessEnvelope<JournalDetailResource>> {
    const auth = requireAuth(req);
    return ok(req, await this.journals.getJournal(auth, uuidParam('journalId', journalId)));
  }

  /**
   * UNE-JNL-007 — AI 서술 제안.
   *
   * 제안이 사실을 반박하면 반영하지 않는다. 응답이 **시뮬레이션 여부**를
   * 함께 낸다 — 지금 붙은 어댑터는 규칙 기반이고 실 T3Q 지원이 아니다(OB-01).
   */
  @Post(':journalId/ai-draft-jobs')
  @RequirePermission('JOURNAL_AI_EDIT')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async aiDraft(
    @Req() req: ApiRequest,
    @Param('journalId') journalId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<NarrativeProposalResource[]>> {
    const auth = requireAuth(req);
    const id = uuidParam('journalId', journalId);
    const b = rec(body);
    const violations: ErrorViolation[] = [];

    const sections = Array.isArray(b.sections) ? b.sections : [];
    if (sections.some((s) => !isJournalSection(s))) {
      violations.push({
        field: 'sections',
        reason: `${JOURNAL_SECTIONS.join('/')} 중에서 고르십시오.`,
      });
    }
    if (violations.length > 0) throw badRequest(violations);

    return ok(
      req,
      await this.journals.proposeNarratives(
        auth,
        id,
        { sections: sections as string[], styleRules: rec(b.styleRules) },
        requestMeta(req),
      ),
    );
  }

  /**
   * UNE-JNL-008 — 서술 편집.
   *
   * 사실칸을 건드리는 요청은 거절한다. 서술이 사실을 반박하면 응답의
   * `contradictions`에 실리되 막지는 않는다 — 사람은 자기가 무엇을 쓰는지
   * 알고 쓸 수 있어야 한다.
   */
  @Post(':journalId/changesets')
  @RequirePermission('JOURNAL_EDIT')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async edit(
    @Req() req: ApiRequest,
    @Param('journalId') journalId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<JournalDetailResource>> {
    const auth = requireAuth(req);
    const id = uuidParam('journalId', journalId);
    const b = rec(body);
    const violations: ErrorViolation[] = [];

    const rawOps = Array.isArray(b.operations) ? b.operations : [];
    if (rawOps.length === 0)
      violations.push({ field: 'operations', reason: '바꿀 것이 없습니다.' });
    let baseRevisionId: string | null = null;
    if (b.baseRevisionId !== undefined && b.baseRevisionId !== null) {
      if (typeof b.baseRevisionId !== 'string' || !UUID.test(b.baseRevisionId)) {
        violations.push({ field: 'baseRevisionId', reason: 'UUID여야 합니다.' });
      } else baseRevisionId = b.baseRevisionId;
    }
    const operations: Array<{
      sectionKey: string;
      narrativeText: string;
      requestedFields: string[];
    }> = [];
    for (const raw of rawOps) {
      const op = rec(raw);
      if (!isJournalSection(op.sectionKey)) {
        violations.push({ field: 'operations.sectionKey', reason: '알 수 없는 섹션입니다.' });
        continue;
      }
      if (typeof op.narrativeText !== 'string' || op.narrativeText.length > MAX_NARRATIVE) {
        violations.push({
          field: 'operations.narrativeText',
          reason: `${MAX_NARRATIVE}자 이하의 문자열이어야 합니다.`,
        });
        continue;
      }
      // **요청이 실제로 실어 보낸 키**를 함께 넘긴다. 여기서 재구성한 객체의
      // 키만 보면 사실칸 침범 검사가 구조적으로 공회전한다(이중검토 M-1).
      operations.push({
        sectionKey: op.sectionKey,
        narrativeText: op.narrativeText,
        requestedFields: Object.keys(op),
      });
    }
    if (violations.length > 0) throw badRequest(violations);

    return ok(
      req,
      await this.journals.editNarratives(
        auth,
        id,
        { operations, baseRevisionId },
        requestMeta(req),
      ),
    );
  }

  /** 사실 갱신 — 드리프트를 사람이 눌러 반영한다(자동으로 돌지 않는다). */
  @Post(':journalId/fact-refresh')
  @RequirePermission('JOURNAL_EDIT')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async refresh(
    @Req() req: ApiRequest,
    @Param('journalId') journalId: string,
  ): Promise<SuccessEnvelope<JournalDetailResource>> {
    const auth = requireAuth(req);
    return ok(
      req,
      await this.journals.refreshFacts(auth, uuidParam('journalId', journalId), requestMeta(req)),
    );
  }

  /** UNE-JNL-009 — 검토요청. */
  @Post(':journalId/submit-review')
  @RequirePermission('JOURNAL_EDIT')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async submitReview(
    @Req() req: ApiRequest,
    @Param('journalId') journalId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<JournalDetailResource>> {
    const auth = requireAuth(req);
    const id = uuidParam('journalId', journalId);
    const b = rec(body);
    const violations: ErrorViolation[] = [];

    const reviewers = Array.isArray(b.reviewers) ? b.reviewers : [];
    if (reviewers.length === 0) {
      violations.push({ field: 'reviewers', reason: '검토자가 하나 이상이어야 합니다.' });
    }
    if (reviewers.length > MAX_REVIEWERS) {
      violations.push({ field: 'reviewers', reason: `${MAX_REVIEWERS}명 이하여야 합니다.` });
    }
    if (reviewers.some((r) => typeof r !== 'string' || !UUID.test(r))) {
      violations.push({ field: 'reviewers', reason: 'UUID 목록이어야 합니다.' });
    }
    const message = typeof b.message === 'string' ? b.message.slice(0, MAX_COMMENT) : null;
    if (violations.length > 0) throw badRequest(violations);

    return ok(
      req,
      await this.journals.submitReview(
        auth,
        id,
        { reviewerIds: reviewers as string[], message },
        requestMeta(req),
      ),
    );
  }

  /**
   * UNE-JNL-010 — 승인·반려.
   *
   * 설계 10은 승인 하나를 적지만 검토는 반려로도 끝난다(설계 09 Journal 상태표의
   * `CHANGES_REQUESTED`). 엔드포인트를 늘리지 않고 `decision`이 가른다.
   */
  @Post(':journalId/approve')
  @RequirePermission('JOURNAL_APPROVE')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async approve(
    @Req() req: ApiRequest,
    @Param('journalId') journalId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<JournalDetailResource>> {
    const auth = requireAuth(req);
    const id = uuidParam('journalId', journalId);
    const b = rec(body);

    const decision = b.decision === undefined ? 'APPROVED' : b.decision;
    if (decision !== 'APPROVED' && decision !== 'CHANGES_REQUESTED') {
      throw badRequest([
        { field: 'decision', reason: 'APPROVED 또는 CHANGES_REQUESTED여야 합니다.' },
      ]);
    }
    const comment = typeof b.comment === 'string' ? b.comment.slice(0, MAX_COMMENT) : null;
    if (decision === 'CHANGES_REQUESTED' && !comment) {
      // 사유 없는 반려는 작성자가 무엇을 고쳐야 하는지 모른다.
      throw badRequest([{ field: 'comment', reason: '반려 사유를 입력하십시오.' }]);
    }

    return ok(req, await this.journals.decide(auth, id, { decision, comment }, requestMeta(req)));
  }

  /**
   * UNE-JNL-011 — Export.
   *
   * **CC-160 경로에 위임한다.** HWPX 보존 직렬화와 Track A 검증이 거기 있고,
   * 일지만의 두 번째 Export 경로를 만들면 그 검증을 우회할 수 있게 된다.
   * 여기서 더하는 것은 선행조건 하나 — 드리프트한 일지를 내보내지 않는다.
   */
  @Post(':journalId/exports')
  @RequirePermission('JOURNAL_EXPORT')
  @Idempotent({ required: true, successStatus: 202 })
  @HttpCode(202)
  async export(
    @Req() req: ApiRequest,
    @Param('journalId') journalId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<ExportJobResource>> {
    const auth = requireAuth(req);
    const id = uuidParam('journalId', journalId);
    const b = rec(body);

    const format = b.format === undefined ? 'HWPX' : b.format;
    if (typeof format !== 'string') {
      throw badRequest([{ field: 'format', reason: '형식을 지정하십시오.' }]);
    }

    // **판을 클라이언트가 고르지 않는다.** 고르게 하면 승인 전 판이나 투영
    // 이전의 빈 양식을 "승인된 일지"로 내보낼 수 있고, 선행조건 검사가
    // 무력해진다(이중검토 M-3).
    const target = await this.journals.exportPrecondition(auth, id);
    return ok(
      req,
      await this.exports.requestExport(
        auth,
        target.documentId,
        { format, revisionId: target.revisionId },
        requestMeta(req),
      ),
    );
  }
}
