import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { EVALUATION_REPORT_FORMATS, isImprovementTargetType, type ScoreInput } from '@une/domain';
import { ApiError, type ErrorViolation } from '../common/api-error';
import { requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { evaluationErrors } from './evaluation-errors';
import {
  EvaluationService,
  type ClosurePreviewResource,
  type EvaluationReportResource,
  type EvaluationResource,
  type SituationClosedResource,
} from './evaluation.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SUMMARY = 4000;
const MAX_ACTION_TEXT = 2000;
const MAX_SCORES = 100;
const MAX_ACTIONS = 100;
const MAX_EVIDENCE = 50;

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function badRequest(violations: ErrorViolation[]): ApiError {
  return new ApiError(400, 'EVAL-400-001', '요청을 확인하십시오.', {
    recoverable: true,
    violations,
  });
}

function optionalText(
  v: unknown,
  max: number,
  field: string,
  out: ErrorViolation[],
): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > max) {
    out.push({ field, reason: `${max}자 이하의 문자열이어야 합니다.` });
    return null;
  }
  return v;
}

/** UNE-JNL-012~013 — 상황 단위. */
@Controller('situations')
export class SituationCloseController {
  constructor(@Inject(EvaluationService) private readonly evaluations: EvaluationService) {}

  /**
   * 종료 미리보기.
   *
   * 설계 10의 API 표에는 없다. US-SIT-035 1단계("시스템이 미결항목을
   * 요약한다")를 화면이 그리려면 닫아 보기 전에 목록을 읽을 경로가 있어야
   * 하고, 412 본문으로만 알 수 있게 하면 사용자가 실패를 눌러 배우게 된다.
   */
  @Get(':id/close-preview')
  @RequirePermission('SITUATION_CLOSE')
  async preview(
    @Req() req: ApiRequest,
    @Param('id') id: string,
  ): Promise<SuccessEnvelope<ClosurePreviewResource>> {
    const auth = requireAuth(req);
    return ok(req, await this.evaluations.closePreview(auth, uuidParam('id', id)));
  }

  @Post(':id/close')
  @RequirePermission('SITUATION_CLOSE')
  @Idempotent({ required: true, successStatus: 200 })
  @HttpCode(200)
  async close(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<SituationClosedResource>> {
    const auth = requireAuth(req);
    const b = rec(body);
    const violations: ErrorViolation[] = [];
    const resultSummary = optionalText(b.resultSummary, MAX_SUMMARY, 'resultSummary', violations);

    const raw = Array.isArray(b.dispositions) ? b.dispositions : [];
    const dispositions: Array<{ refId: string; disposition: string; reason: string }> = [];
    for (const [index, item] of raw.entries()) {
      const d = rec(item);
      if (typeof d.refId !== 'string' || !UUID.test(d.refId)) {
        violations.push({ field: `dispositions[${index}].refId`, reason: 'UUID여야 합니다.' });
        continue;
      }
      if (typeof d.disposition !== 'string') {
        violations.push({
          field: `dispositions[${index}].disposition`,
          reason: '처분이 필요합니다.',
        });
        continue;
      }
      dispositions.push({
        refId: d.refId,
        disposition: d.disposition,
        reason: typeof d.reason === 'string' ? d.reason : '',
      });
    }
    if (violations.length > 0) throw badRequest(violations);

    return ok(
      req,
      await this.evaluations.close(
        auth,
        uuidParam('id', id),
        { resultSummary, dispositions },
        requestMeta(req),
      ),
    );
  }

  @Post(':id/evaluations')
  @RequirePermission('EVALUATION_EDIT')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async createEvaluation(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<EvaluationResource>> {
    const auth = requireAuth(req);
    const b = rec(body);
    const violations: ErrorViolation[] = [];
    const summary = optionalText(b.summary, MAX_SUMMARY, 'summary', violations);

    const raw = Array.isArray(b.scores) ? b.scores : [];
    if (raw.length === 0)
      violations.push({ field: 'scores', reason: '지표가 하나는 있어야 합니다.' });
    if (raw.length > MAX_SCORES) {
      violations.push({ field: 'scores', reason: `${MAX_SCORES}개 이하여야 합니다.` });
    }
    const scores: ScoreInput[] = [];
    for (const [index, item] of raw.slice(0, MAX_SCORES).entries()) {
      const s = rec(item);
      if (typeof s.criterionCode !== 'string') {
        violations.push({
          field: `scores[${index}].criterionCode`,
          reason: '지표 코드가 필요합니다.',
        });
        continue;
      }
      if (typeof s.scoreValue !== 'number' || typeof s.weightValue !== 'number') {
        violations.push({ field: `scores[${index}]`, reason: '점수와 가중치는 수여야 합니다.' });
        continue;
      }
      const evidence = Array.isArray(s.evidenceEventIds) ? s.evidenceEventIds : [];
      if (evidence.length > MAX_EVIDENCE) {
        violations.push({
          field: `scores[${index}].evidenceEventIds`,
          reason: `${MAX_EVIDENCE}개 이하여야 합니다.`,
        });
        continue;
      }
      if (evidence.some((e) => typeof e !== 'string' || !UUID.test(e))) {
        violations.push({
          field: `scores[${index}].evidenceEventIds`,
          reason: 'UUID 목록이어야 합니다.',
        });
        continue;
      }
      scores.push({
        criterionCode: s.criterionCode,
        scoreValue: s.scoreValue,
        weightValue: s.weightValue,
        comment: typeof s.comment === 'string' ? s.comment : null,
        evidenceEventIds: evidence as string[],
      });
    }
    if (violations.length > 0) throw badRequest(violations);

    return ok(
      req,
      await this.evaluations.createEvaluation(
        auth,
        uuidParam('id', id),
        { summary, scores },
        requestMeta(req),
      ),
    );
  }
}

/** UNE-JNL-014~015 — 평가 단위. */
@Controller('evaluations')
export class EvaluationController {
  constructor(@Inject(EvaluationService) private readonly evaluations: EvaluationService) {}

  @Get(':evaluationId')
  @RequirePermission('EVALUATION_READ')
  async detail(
    @Req() req: ApiRequest,
    @Param('evaluationId') evaluationId: string,
  ): Promise<SuccessEnvelope<EvaluationResource>> {
    const auth = requireAuth(req);
    return ok(
      req,
      await this.evaluations.getEvaluation(auth, uuidParam('evaluationId', evaluationId)),
    );
  }

  @Post(':evaluationId/improvements')
  @RequirePermission('EVALUATION_EDIT')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async improvements(
    @Req() req: ApiRequest,
    @Param('evaluationId') evaluationId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<EvaluationResource>> {
    const auth = requireAuth(req);
    const b = rec(body);
    const violations: ErrorViolation[] = [];
    const raw = Array.isArray(b.actions) ? b.actions : [];
    if (raw.length === 0)
      violations.push({ field: 'actions', reason: '조치가 하나는 있어야 합니다.' });
    if (raw.length > MAX_ACTIONS) {
      violations.push({ field: 'actions', reason: `${MAX_ACTIONS}개 이하여야 합니다.` });
    }

    const actions: Array<{
      actionText: string;
      ownerUserId: string | null;
      dueAt: Date | null;
      targetType: string | null;
      targetId: string | null;
    }> = [];
    for (const [index, item] of raw.slice(0, MAX_ACTIONS).entries()) {
      const a = rec(item);
      if (typeof a.actionText !== 'string' || a.actionText.trim().length === 0) {
        violations.push({
          field: `actions[${index}].actionText`,
          reason: '조치 내용이 필요합니다.',
        });
        continue;
      }
      if (a.actionText.length > MAX_ACTION_TEXT) {
        violations.push({
          field: `actions[${index}].actionText`,
          reason: `${MAX_ACTION_TEXT}자 이하여야 합니다.`,
        });
        continue;
      }
      let ownerUserId: string | null = null;
      if (a.ownerUserId !== undefined && a.ownerUserId !== null) {
        if (typeof a.ownerUserId !== 'string' || !UUID.test(a.ownerUserId)) {
          violations.push({ field: `actions[${index}].ownerUserId`, reason: 'UUID여야 합니다.' });
          continue;
        }
        ownerUserId = a.ownerUserId;
      }
      let dueAt: Date | null = null;
      if (a.dueAt !== undefined && a.dueAt !== null && a.dueAt !== '') {
        const parsed = new Date(String(a.dueAt));
        if (Number.isNaN(parsed.getTime())) {
          violations.push({ field: `actions[${index}].dueAt`, reason: 'ISO-8601이어야 합니다.' });
          continue;
        }
        dueAt = parsed;
      }
      let targetType: string | null = null;
      let targetId: string | null = null;
      if (a.targetType !== undefined && a.targetType !== null) {
        if (!isImprovementTargetType(a.targetType)) {
          violations.push({
            field: `actions[${index}].targetType`,
            reason: 'PLAN/SOP/SYSTEM 중 하나여야 합니다.',
          });
          continue;
        }
        targetType = a.targetType;
        if (a.targetId !== undefined && a.targetId !== null) {
          if (typeof a.targetId !== 'string' || !UUID.test(a.targetId)) {
            violations.push({ field: `actions[${index}].targetId`, reason: 'UUID여야 합니다.' });
            continue;
          }
          targetId = a.targetId;
        }
        // SYSTEM은 가리킬 행이 없다. 실수로 실어 보낸 id는 조용히 버리지 않는다.
        if (targetType === 'SYSTEM' && targetId !== null) {
          violations.push({
            field: `actions[${index}].targetId`,
            reason: 'SYSTEM 환류에는 대상 id가 없습니다.',
          });
          continue;
        }
      }
      actions.push({ actionText: a.actionText, ownerUserId, dueAt, targetType, targetId });
    }
    if (violations.length > 0) throw badRequest(violations);

    return ok(
      req,
      await this.evaluations.addImprovements(
        auth,
        uuidParam('evaluationId', evaluationId),
        { actions },
        requestMeta(req),
      ),
    );
  }

  /** 확정 — 이 뒤로 점수·개선조치는 DB가 얼린다. */
  @Post(':evaluationId/confirm')
  @RequirePermission('EVALUATION_EDIT')
  @Idempotent({ required: true, successStatus: 200 })
  @HttpCode(200)
  async confirm(
    @Req() req: ApiRequest,
    @Param('evaluationId') evaluationId: string,
  ): Promise<SuccessEnvelope<EvaluationResource>> {
    const auth = requireAuth(req);
    return ok(
      req,
      await this.evaluations.confirmEvaluation(
        auth,
        uuidParam('evaluationId', evaluationId),
        requestMeta(req),
      ),
    );
  }

  @Get(':evaluationId/report')
  @RequirePermission('EVALUATION_READ')
  async report(
    @Req() req: ApiRequest,
    @Param('evaluationId') evaluationId: string,
    @Query('format') format?: string,
  ): Promise<SuccessEnvelope<EvaluationReportResource>> {
    const auth = requireAuth(req);
    // **없는 형식을 약속하지 않는다.** HWPX·PDF 평가보고서는 이 항목에 없다.
    const wanted = (format ?? 'JSON').toUpperCase();
    if (!(EVALUATION_REPORT_FORMATS as readonly string[]).includes(wanted)) {
      throw evaluationErrors.unsupportedFormat(wanted);
    }
    return ok(req, await this.evaluations.report(auth, uuidParam('evaluationId', evaluationId)));
  }
}
