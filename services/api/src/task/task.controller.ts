import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  isEscalationLevel,
  isFieldTaskStatus,
  isTaskAttachmentCategory,
  isUnableReasonCode,
  normalizeProgress,
  type EscalationLevel,
  type UnableReasonCode,
} from '@une/domain';
import { ApiError, type ErrorViolation } from '../common/api-error';
import { requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { taskErrors } from './task-errors';
import {
  TaskService,
  type TaskAttachmentResource,
  type TaskDetailResource,
  type TaskEventResource,
  type TaskPageResource,
} from './task.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 위치 소수점 자리. 5자리면 약 1m다 — 그보다 정밀할 이유가 현장 보고에 없다. */
const GEO_PRECISION = 5;
const MAX_NOTE = 2000;
const MAX_RESULT = 4000;
const MAX_TARGETS = 20;
const MAX_PAGE_SIZE = 100;

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

/** ISO-8601만 받는다. 못 읽는 값을 지금 시각으로 대체하면 이력이 조용히 틀린다. */
function isoDate(v: unknown, field: string, violations: ErrorViolation[]): Date | null {
  if (v === undefined || v === null) return null;
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

/**
 * 위치.
 *
 * **임의 JSON을 그대로 받지 않는다.** 개인 위치정보이므로 형태를 좁히고
 * 정밀도를 깎는다 — 받은 것을 그대로 저장하면 어디까지 수집하는지 아무도
 * 말할 수 없고, `deviceInfo`에 들인 최소화 원칙과도 어긋난다(ADR-42 D2 계열).
 */
function parseGeo(v: unknown, violations: ErrorViolation[]): { lat: number; lon: number } | null {
  if (v === undefined || v === null) return null;
  const g = rec(v);
  const lat = typeof g.lat === 'number' ? g.lat : Number.NaN;
  const lon = typeof g.lon === 'number' ? g.lon : Number.NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    violations.push({ field: 'geo', reason: '{ lat, lon } 숫자여야 합니다.' });
    return null;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    violations.push({ field: 'geo', reason: '좌표 범위를 벗어났습니다.' });
    return null;
  }
  const round = (n: number): number => Number(n.toFixed(GEO_PRECISION));
  return { lat: round(lat), lon: round(lon) };
}

function badRequest(violations: ErrorViolation[]): ApiError {
  return new ApiError(400, 'TASK-400-001', '요청을 확인하십시오.', {
    recoverable: true,
    violations,
  });
}

/**
 * 현장 임무 (CC-280).
 *
 * 설계 09 SCR-TASK-001이 `/task/:signedToken`을 적지만 **서명링크 인증을 만들지
 * 않았다** — 지금 그 링크를 배달할 채널이 없다(OB-06, 0038 §6). 그래서 여기는
 * 일반 인증 + 권한 + **담당자 본인 확인**으로 연다.
 */
@Controller('tasks')
export class TaskController {
  constructor(@Inject(TaskService) private readonly tasks: TaskService) {}

  /** UNE-TASK-001 — 임무 목록. */
  @Get()
  @RequirePermission('TASK_READ')
  async list(
    @Req() req: ApiRequest,
    @Query('assignee') assignee?: string,
    @Query('status') status?: string,
    @Query('situationId') situationId?: string,
    @Query('due') due?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ): Promise<SuccessEnvelope<TaskPageResource>> {
    const auth = requireAuth(req);
    const violations: ErrorViolation[] = [];

    // `assignee=me`는 현장 앱의 첫 화면이다. 사용자 id를 클라이언트가 실어
    // 보내게 하면 남의 임무 목록을 요청할 수 있는지 매번 따져야 한다.
    let assigneeUserId: string | null = null;
    if (assignee === 'me') assigneeUserId = auth.userId;
    else if (assignee !== undefined && assignee !== '') {
      if (!UUID.test(assignee)) violations.push({ field: 'assignee', reason: 'me 또는 UUID.' });
      else assigneeUserId = assignee;
    }
    if (status !== undefined && status !== '' && !isFieldTaskStatus(status)) {
      violations.push({ field: 'status', reason: '알 수 없는 임무 상태입니다.' });
    }
    if (situationId !== undefined && situationId !== '' && !UUID.test(situationId)) {
      violations.push({ field: 'situationId', reason: 'UUID여야 합니다.' });
    }
    const dueBefore = isoDate(due === '' ? null : due, 'due', violations);
    const pageNo = page ? Number(page) : 1;
    const pageSize = size ? Number(size) : 20;
    if (!Number.isInteger(pageNo) || pageNo < 1) {
      violations.push({ field: 'page', reason: '1 이상의 정수여야 합니다.' });
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      violations.push({ field: 'size', reason: `1~${MAX_PAGE_SIZE} 사이여야 합니다.` });
    }
    if (violations.length > 0) throw badRequest(violations);

    const result = await this.tasks.listTasks(auth, {
      assigneeUserId,
      status: status && status !== '' ? status : null,
      situationId: situationId && situationId !== '' ? situationId : null,
      dueBefore,
      page: pageNo,
      size: pageSize,
    });
    return ok(req, result);
  }

  /** UNE-TASK-002 — 임무 상세. */
  @Get(':taskId')
  @RequirePermission('TASK_READ')
  async detail(
    @Req() req: ApiRequest,
    @Param('taskId') taskId: string,
  ): Promise<SuccessEnvelope<TaskDetailResource>> {
    const auth = requireAuth(req);
    const id = uuidParam('taskId', taskId);
    return ok(req, await this.tasks.getTask(auth, id));
  }

  /** UNE-TASK-004 — 수신확인. */
  @Post(':taskId/acknowledge')
  @RequirePermission('TASK_ASSIGNEE')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async acknowledge(
    @Req() req: ApiRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<TaskEventResource>> {
    const auth = requireAuth(req);
    const id = uuidParam('taskId', taskId);
    const b = rec(body);
    const violations: ErrorViolation[] = [];
    const receivedAt = isoDate(b.receivedAt, 'receivedAt', violations);
    if (violations.length > 0) throw badRequest(violations);

    // 기기 정보는 **모델·OS 수준까지만** 남긴다. 식별자를 받으면 개인 위치추적
    // 자료가 되고 그것을 요구한 근거가 없다.
    const device = rec(b.deviceInfo);
    const deviceInfo =
      Object.keys(device).length > 0
        ? {
            platform: str(device.platform, 40),
            osVersion: str(device.osVersion, 40),
            appVersion: str(device.appVersion, 40),
          }
        : null;

    const event = await this.tasks.acknowledge(
      auth,
      id,
      { receivedAt, deviceInfo },
      requestMeta(req),
    );
    return ok(req, event);
  }

  /** UNE-TASK-005 — 착수. */
  @Post(':taskId/start')
  @RequirePermission('TASK_ASSIGNEE')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async start(
    @Req() req: ApiRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<TaskEventResource>> {
    const auth = requireAuth(req);
    const id = uuidParam('taskId', taskId);
    const b = rec(body);
    const violations: ErrorViolation[] = [];
    const startedAt = isoDate(b.startedAt, 'startedAt', violations);
    if (violations.length > 0) throw badRequest(violations);

    const event = await this.tasks.start(
      auth,
      id,
      { startedAt, note: str(b.note, MAX_NOTE) },
      requestMeta(req),
    );
    return ok(req, event);
  }

  /** UNE-TASK-006 — 진행보고. */
  @Post(':taskId/progress')
  @RequirePermission('TASK_ASSIGNEE')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async progress(
    @Req() req: ApiRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<TaskEventResource>> {
    const auth = requireAuth(req);
    const id = uuidParam('taskId', taskId);
    const b = rec(body);
    const violations: ErrorViolation[] = [];

    const progress = normalizeProgress(b.progress);
    if (progress === null) {
      violations.push({ field: 'progress', reason: '0~100 사이의 숫자여야 합니다.' });
    }
    const attachmentIds = Array.isArray(b.attachmentIds) ? b.attachmentIds : [];
    if (attachmentIds.some((x) => typeof x !== 'string' || !UUID.test(x))) {
      violations.push({ field: 'attachmentIds', reason: 'UUID 목록이어야 합니다.' });
    }
    if (violations.length > 0) throw taskErrors.invalidProgress(violations);

    const event = await this.tasks.reportProgress(
      auth,
      id,
      {
        progressPct: progress as number,
        note: str(b.note, MAX_NOTE),
        attachmentIds: attachmentIds as string[],
      },
      requestMeta(req),
    );
    return ok(req, event);
  }

  /**
   * UNE-TASK-007 — 완료 보고.
   *
   * `outcome`이 `UNABLE`이면 수행불가 보고다(설계 09 SCR-TASK-003의 두 번째
   * 버튼). 엔드포인트를 늘리지 않고 결과를 가른다.
   */
  @Post(':taskId/complete')
  @RequirePermission('TASK_ASSIGNEE')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async complete(
    @Req() req: ApiRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<TaskEventResource>> {
    const auth = requireAuth(req);
    const id = uuidParam('taskId', taskId);
    const b = rec(body);
    const violations: ErrorViolation[] = [];

    const outcome = b.outcome === undefined ? 'DONE' : b.outcome;
    if (outcome !== 'DONE' && outcome !== 'UNABLE') {
      violations.push({ field: 'outcome', reason: 'DONE 또는 UNABLE이어야 합니다.' });
    }
    const completedAt = isoDate(b.completedAt, 'completedAt', violations);
    const checklist = Array.isArray(b.checklist) ? b.checklist : [];
    if (checklist.some((x) => typeof x !== 'string')) {
      violations.push({ field: 'checklist', reason: '충족한 항목 key 목록이어야 합니다.' });
    }
    let unableReasonCode: UnableReasonCode | null = null;
    if (b.unableReasonCode !== undefined && b.unableReasonCode !== null) {
      if (!isUnableReasonCode(b.unableReasonCode)) {
        violations.push({
          field: 'unableReasonCode',
          reason: 'SAFETY/RESOURCE/ACCESS/UNCLEAR/OTHER 중에서 고르십시오.',
        });
      } else unableReasonCode = b.unableReasonCode;
    }
    if (violations.length > 0) throw badRequest(violations);

    const event = await this.tasks.submitCompletion(
      auth,
      id,
      {
        outcome: outcome as 'DONE' | 'UNABLE',
        completedAt,
        result: typeof b.result === 'string' ? b.result.slice(0, MAX_RESULT) : '',
        checklist: checklist as string[],
        unableReasonCode,
      },
      requestMeta(req),
    );
    return ok(req, event);
  }

  /** UNE-TASK-008 — 완료 승인. */
  @Post(':taskId/approve-completion')
  @RequirePermission('TASK_SUPERVISE')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async approve(
    @Req() req: ApiRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<TaskEventResource>> {
    const auth = requireAuth(req);
    const id = uuidParam('taskId', taskId);
    const b = rec(body);
    const event = await this.tasks.approveCompletion(
      auth,
      id,
      { comment: str(b.comment, MAX_NOTE) },
      requestMeta(req),
    );
    return ok(req, event);
  }

  /** UNE-TASK-009 — 완료 반려. */
  @Post(':taskId/reject-completion')
  @RequirePermission('TASK_SUPERVISE')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async reject(
    @Req() req: ApiRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<TaskEventResource>> {
    const auth = requireAuth(req);
    const id = uuidParam('taskId', taskId);
    const b = rec(body);
    // 반려는 사유 없이 하면 담당자가 무엇을 고쳐야 하는지 모른다.
    const reason = str(b.reason, MAX_NOTE);
    if (!reason) throw badRequest([{ field: 'reason', reason: '반려 사유를 입력하십시오.' }]);

    const event = await this.tasks.rejectCompletion(auth, id, { reason }, requestMeta(req));
    return ok(req, event);
  }

  /** UNE-TASK-010 — 재배정. */
  @Post(':taskId/reassign')
  @RequirePermission('TASK_SUPERVISE')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async reassign(
    @Req() req: ApiRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<TaskEventResource>> {
    const auth = requireAuth(req);
    const id = uuidParam('taskId', taskId);
    const b = rec(body);
    const violations: ErrorViolation[] = [];

    let assigneeUserId: string | null = null;
    if (b.assigneeId !== undefined && b.assigneeId !== null) {
      if (typeof b.assigneeId !== 'string' || !UUID.test(b.assigneeId)) {
        violations.push({ field: 'assigneeId', reason: 'UUID여야 합니다.' });
      } else assigneeUserId = b.assigneeId;
    }
    let assigneeOrgId: string | null = null;
    if (b.assigneeOrgId !== undefined && b.assigneeOrgId !== null) {
      if (typeof b.assigneeOrgId !== 'string' || !UUID.test(b.assigneeOrgId)) {
        violations.push({ field: 'assigneeOrgId', reason: 'UUID여야 합니다.' });
      } else assigneeOrgId = b.assigneeOrgId;
    }
    const reason = str(b.reason, MAX_NOTE);
    if (!reason) violations.push({ field: 'reason', reason: '재배정 사유를 입력하십시오.' });
    if (violations.length > 0) throw badRequest(violations);

    const event = await this.tasks.reassign(
      auth,
      id,
      { assigneeUserId, assigneeOrgId, reason: reason as string },
      requestMeta(req),
    );
    return ok(req, event);
  }

  /** UNE-TASK-011 — Escalation. */
  @Post(':taskId/escalate')
  @RequirePermission('TASK_SUPERVISE')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async escalate(
    @Req() req: ApiRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<TaskEventResource>> {
    const auth = requireAuth(req);
    const id = uuidParam('taskId', taskId);
    const b = rec(body);
    const violations: ErrorViolation[] = [];

    let level: EscalationLevel = 'L1';
    if (b.level !== undefined) {
      if (!isEscalationLevel(b.level)) {
        violations.push({ field: 'level', reason: 'L1/L2/L3 중에서 고르십시오.' });
      } else level = b.level;
    }
    const targets = Array.isArray(b.targetIds) ? b.targetIds : [];
    if (targets.length === 0) {
      violations.push({ field: 'targetIds', reason: '대상이 하나 이상이어야 합니다.' });
    }
    if (targets.length > MAX_TARGETS) {
      violations.push({ field: 'targetIds', reason: `${MAX_TARGETS}명 이하여야 합니다.` });
    }
    if (targets.some((x) => typeof x !== 'string' || !UUID.test(x))) {
      violations.push({ field: 'targetIds', reason: 'UUID 목록이어야 합니다.' });
    }
    const reason = str(b.reason, MAX_NOTE);
    if (!reason) violations.push({ field: 'reason', reason: 'Escalation 사유를 입력하십시오.' });
    if (violations.length > 0) throw badRequest(violations);

    const event = await this.tasks.escalate(
      auth,
      id,
      { level, reason: reason as string, targetUserIds: targets as string[] },
      requestMeta(req),
    );
    return ok(req, event);
  }

  /** UNE-TASK-012 — 현장 파일 등록. */
  @Post(':taskId/attachments')
  @RequirePermission('TASK_ASSIGNEE')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async attach(
    @Req() req: ApiRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<TaskAttachmentResource>> {
    const auth = requireAuth(req);
    const id = uuidParam('taskId', taskId);
    const b = rec(body);
    const violations: ErrorViolation[] = [];

    if (typeof b.fileId !== 'string' || !UUID.test(b.fileId)) {
      violations.push({ field: 'fileId', reason: '업로드된 파일 id가 필요합니다.' });
    }
    const category = b.category === undefined ? 'PHOTO' : b.category;
    if (!isTaskAttachmentCategory(category)) {
      violations.push({ field: 'category', reason: 'PHOTO/DOC/VIDEO/OTHER 중에서 고르십시오.' });
    }
    const geo = parseGeo(b.geo, violations);
    const capturedAt = isoDate(b.capturedAt, 'capturedAt', violations);
    if (capturedAt && capturedAt.getTime() > Date.now() + 60_000) {
      // 설계 09 `TASK-5205` 관측시각 미래값.
      violations.push({ field: 'capturedAt', reason: '미래 시각은 기록할 수 없습니다.' });
    }
    if (violations.length > 0) throw taskErrors.attachmentRejected(violations);

    const attachment = await this.tasks.addAttachment(
      auth,
      id,
      {
        fileId: b.fileId as string,
        category: category as string,
        caption: str(b.caption, 500),
        geo,
        capturedAt,
      },
      requestMeta(req),
    );
    return ok(req, attachment);
  }
}
