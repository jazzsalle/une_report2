import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  FACT_STATUSES,
  FACT_TYPES,
  SITUATION_MODES,
  SITUATION_STATUSES,
  isFactKey,
  normalizeTimestamp,
} from '@une/domain';
import { QUERYABLE_PROVIDERS, isQueryableProvider } from '@une/provider-adapters';
import { ApiError, type ErrorViolation } from '../common/api-error';
import { requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { HAZARD_TYPES } from '../plan/plan-context.validator';
import { FactService, type FactPatchInput, type ManualFactInput } from './fact.service';
import { ProviderQueryService, type ProviderQueryJobResource } from './provider-query.service';
import { factErrors, providerErrors, situationErrors } from './situation-errors';
import { SituationService } from './situation.service';
import type {
  Page,
  SituationDetailResource,
  SituationFactResource,
  SituationResource,
} from './situation.resources';

/** If-Match는 version_no를 담은 강한 ETag다: `"3"`. 약한 태그(`W/"3"`)는
 * 거부한다 — RFC 7232는 If-Match에 강한 비교만 허용한다. 헤더가 없으면 428.
 * (plan.controller와 같은 규칙을 그대로 쓴다.) */
function parseIfMatch(header: string | undefined): number {
  if (!header || !header.trim()) throw situationErrors.ifMatchRequired();
  const match = /^\s*"?(\d+)"?\s*$/.exec(header);
  if (!match) {
    throw new ApiError(400, 'COM-0400', 'If-Match 헤더가 올바르지 않습니다.', {
      violations: [{ field: 'If-Match', reason: '강한 ETag(버전 번호 "3" 형식)만 허용됩니다.' }],
    });
  }
  return Number(match[1]);
}

function setEtag(res: Response, versionNo: number): void {
  res.setHeader('ETag', `"${versionNo}"`);
}

/** 시각 판정은 **도메인 함수 하나만** 쓴다.
 *
 * 처음에는 여기에 자체 정규식 + `Date.parse`를 뒀는데, 그것이 규칙의 두 번째
 * 사본이었고 그 사본에는 달력 검사가 없었다. `Date.parse('2026-02-30T00:00:00Z')`
 * 는 NaN이 아니라 **3월 2일로 굴러간다** — `observedAt`은 뒤에서 `normalizeFact`
 * 가 다시 걸러 무사했지만 `occurredAt`은 도메인 정규화를 지나는 경로가 없어
 * 존재하지 않는 발생시각이 그대로 저장됐다(아키텍처 리뷰 M-1).
 *
 * 사본을 지우는 것이 시정의 핵심이다. 값도 도메인이 돌려준 UTC 정규형을 쓴다. */
function checkTimestamp(
  field: string,
  value: unknown,
  violations: ErrorViolation[],
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    violations.push({ field, reason: '문자열이어야 합니다.' });
    return undefined;
  }
  const parsed = normalizeTimestamp(value);
  if (!parsed.ok) {
    violations.push({
      field,
      reason:
        parsed.reason === 'TIME_OFFSET_MISSING'
          ? '시간대 오프셋(+09:00 또는 Z)이 필요합니다.'
          : '읽을 수 있는 ISO-8601 시각이 아닙니다.',
    });
    return undefined;
  }
  return parsed.value;
}

/** 계약의 `additionalProperties: false`를 런타임에서도 지킨다. 계약만 닫고
 * 구현이 열려 있으면 클라이언트는 무시되는 필드를 보내고 조용히 성공한다. */
function rejectUnknownKeys(
  body: Record<string, unknown>,
  allowed: readonly string[],
  violations: ErrorViolation[],
): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      violations.push({ field: key, reason: '허용되지 않는 항목입니다.' });
    }
  }
}

function parsePaging(
  page: string | undefined,
  size: string | undefined,
  defaultSize: number,
  maxSize: number,
  violations: ErrorViolation[],
): { page: number; size: number } {
  const parsedPage = page === undefined ? 1 : Number(page);
  const parsedSize = size === undefined ? defaultSize : Number(size);
  if (!Number.isInteger(parsedPage) || parsedPage < 1) {
    violations.push({ field: 'page', reason: '1 이상의 정수여야 합니다.' });
  }
  if (!Number.isInteger(parsedSize) || parsedSize < 1 || parsedSize > maxSize) {
    violations.push({ field: 'size', reason: `1 이상 ${maxSize} 이하의 정수여야 합니다.` });
  }
  return { page: parsedPage, size: parsedSize };
}

interface CreateBody {
  mode?: unknown;
  title?: unknown;
  hazardType?: unknown;
  occurredAt?: unknown;
  location?: unknown;
  locationText?: unknown;
}

@Controller('situations')
export class SituationController {
  constructor(
    @Inject(SituationService) private readonly situations: SituationService,
    @Inject(FactService) private readonly facts: FactService,
    @Inject(ProviderQueryService) private readonly providers: ProviderQueryService,
  ) {}

  /** UNE-SIT-001 */
  @Post()
  @RequirePermission('SITUATION_CREATE')
  @Idempotent({ required: true, successStatus: 201 })
  async create(
    @Req() req: ApiRequest,
    @Body() body: CreateBody | undefined,
  ): Promise<SuccessEnvelope<SituationResource>> {
    const violations: ErrorViolation[] = [];
    const raw = (body ?? {}) as Record<string, unknown>;
    rejectUnknownKeys(
      raw,
      ['mode', 'title', 'hazardType', 'occurredAt', 'location', 'locationText'],
      violations,
    );

    if (!(SITUATION_MODES as readonly string[]).includes(String(raw.mode))) {
      violations.push({ field: 'mode', reason: `허용 값: ${SITUATION_MODES.join(', ')}` });
    }
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title) violations.push({ field: 'title', reason: '필수 항목입니다.' });
    else if (title.length > 300)
      violations.push({ field: 'title', reason: '300자 이하여야 합니다.' });

    if (typeof raw.hazardType !== 'string' || !HAZARD_TYPES.includes(raw.hazardType)) {
      violations.push({ field: 'hazardType', reason: '재난유형 10종 중 하나여야 합니다.' });
    }
    const occurredAt = checkTimestamp('occurredAt', raw.occurredAt, violations);

    // 계약은 locationText를 쓰고 설계 10의 요청 요약은 `location`이라 적었다.
    // 둘 다 받되 저장 컬럼은 하나(location_text)다.
    const locationRaw = raw.locationText !== undefined ? raw.locationText : raw.location;
    let locationText: string | null = null;
    if (locationRaw !== undefined && locationRaw !== null) {
      if (typeof locationRaw !== 'string') {
        violations.push({ field: 'locationText', reason: '문자열이어야 합니다.' });
      } else if (locationRaw.length > 500) {
        violations.push({ field: 'locationText', reason: '500자 이하여야 합니다.' });
      } else {
        locationText = locationRaw;
      }
    }

    if (violations.length > 0) throw situationErrors.invalidRequest(violations);

    return ok(
      req,
      await this.situations.create(
        requireAuth(req),
        {
          mode: raw.mode as string,
          title,
          hazardType: raw.hazardType as string,
          occurredAt: occurredAt ?? null,
          locationText,
        },
        requestMeta(req),
      ),
    );
  }

  /** UNE-SIT-002 */
  @Get()
  @RequirePermission('SITUATION_READ')
  async search(
    @Req() req: ApiRequest,
    @Query('keyword') keyword?: string,
    @Query('mode') mode?: string,
    @Query('status') status?: string,
    @Query('hazardType') hazardType?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ): Promise<SuccessEnvelope<Page<SituationResource>>> {
    const violations: ErrorViolation[] = [];
    if (mode !== undefined && !(SITUATION_MODES as readonly string[]).includes(mode)) {
      violations.push({ field: 'mode', reason: `허용 값: ${SITUATION_MODES.join(', ')}` });
    }
    if (status !== undefined && !(SITUATION_STATUSES as readonly string[]).includes(status)) {
      violations.push({ field: 'status', reason: '알 수 없는 상태입니다.' });
    }
    const paging = parsePaging(page, size, 20, 100, violations);
    if (violations.length > 0) throw situationErrors.invalidQuery(violations);

    return ok(
      req,
      await this.situations.search(requireAuth(req), {
        ...(keyword ? { keyword } : {}),
        ...(mode ? { mode } : {}),
        ...(status ? { status } : {}),
        ...(hazardType ? { hazardType } : {}),
        ...paging,
      }),
    );
  }

  /** UNE-SIT-003 */
  @Get(':id')
  @RequirePermission('SITUATION_READ')
  async detail(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SuccessEnvelope<SituationDetailResource>> {
    const detail = await this.situations.detail(requireAuth(req), uuidParam('id', id));
    setEtag(res, detail.versionNo);
    return ok(req, detail);
  }

  /** UNE-SIT-004 */
  @Patch(':id')
  @RequirePermission('SITUATION_EDIT')
  @Idempotent({ required: false, successStatus: 200 })
  async patch(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: Record<string, unknown> | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SuccessEnvelope<SituationResource>> {
    const situationId = uuidParam('id', id);
    const expectedVersion = parseIfMatch(ifMatch);
    const raw = body ?? {};
    const violations: ErrorViolation[] = [];
    rejectUnknownKeys(raw, ['title', 'hazardType', 'occurredAt', 'locationText'], violations);
    if (Object.keys(raw).length === 0) {
      violations.push({ field: 'body', reason: '수정할 항목이 하나 이상 필요합니다.' });
    }

    const patch: {
      title?: string;
      hazardType?: string;
      occurredAt?: string | null;
      locationText?: string | null;
    } = {};

    if (raw.title !== undefined) {
      const title = typeof raw.title === 'string' ? raw.title.trim() : '';
      if (!title || title.length > 300) {
        violations.push({ field: 'title', reason: '1자 이상 300자 이하여야 합니다.' });
      } else patch.title = title;
    }
    if (raw.hazardType !== undefined) {
      if (typeof raw.hazardType !== 'string' || !HAZARD_TYPES.includes(raw.hazardType)) {
        violations.push({ field: 'hazardType', reason: '재난유형 10종 중 하나여야 합니다.' });
      } else patch.hazardType = raw.hazardType;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'occurredAt')) {
      const value = checkTimestamp('occurredAt', raw.occurredAt, violations);
      if (value !== undefined) patch.occurredAt = value;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'locationText')) {
      if (raw.locationText === null) patch.locationText = null;
      else if (typeof raw.locationText !== 'string' || raw.locationText.length > 500) {
        violations.push({ field: 'locationText', reason: '500자 이하 문자열이어야 합니다.' });
      } else patch.locationText = raw.locationText;
    }

    if (violations.length > 0) throw situationErrors.invalidRequest(violations);

    const updated = await this.situations.patchMeta(
      requireAuth(req),
      situationId,
      expectedVersion,
      patch,
      requestMeta(req),
    );
    setEtag(res, updated.versionNo);
    return ok(req, updated);
  }

  /** UNE-SIT-005 */
  @Post(':id/provider-queries')
  @RequirePermission('SITUATION_FACT_COLLECT')
  // 계약은 200이다(자원 생성이 아니라 수집 결과 보고). NestJS의 POST 기본값은
  // 201이므로 명시하지 않으면 계약과 어긋난다.
  @HttpCode(200)
  @Idempotent({ required: true, successStatus: 200 })
  async collect(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown> | undefined,
  ): Promise<SuccessEnvelope<ProviderQueryJobResource>> {
    const situationId = uuidParam('id', id);
    const raw = body ?? {};
    const violations: ErrorViolation[] = [];
    // 다른 네 경로와 달리 여기만 알 수 없는 키를 흘려보내고 있었다
    // (아키텍처 리뷰 m-4). 계약도 함께 닫았다.
    rejectUnknownKeys(
      raw,
      ['providers', 'query', 'categories', 'featureFlags', 'requestReason', 'from', 'to'],
      violations,
    );

    const providers = Array.isArray(raw.providers) ? raw.providers : [];
    if (providers.length === 0) {
      violations.push({ field: 'providers', reason: '하나 이상 선택해야 합니다.' });
    }
    for (const p of providers) {
      if (!isQueryableProvider(p)) {
        violations.push({
          field: 'providers',
          reason: `허용 값: ${QUERYABLE_PROVIDERS.join(', ')}`,
        });
        break;
      }
    }
    if (new Set(providers).size !== providers.length) {
      // 같은 Provider를 두 번 넣으면 같은 사실이 두 벌 저장된다.
      violations.push({ field: 'providers', reason: '중복된 Provider가 있습니다.' });
    }
    // 계약이 `required: [providers, query]`이므로 여기서도 필수다.
    if (typeof raw.query !== 'object' || raw.query === null || Array.isArray(raw.query)) {
      violations.push({ field: 'query', reason: '객체여야 합니다(필수).' });
    }

    const categories: string[] = [];
    if (raw.categories !== undefined) {
      if (!Array.isArray(raw.categories)) {
        violations.push({ field: 'categories', reason: '배열이어야 합니다.' });
      } else {
        for (const c of raw.categories) {
          if (!(FACT_TYPES as readonly string[]).includes(String(c))) {
            violations.push({ field: 'categories', reason: `허용 값: ${FACT_TYPES.join(', ')}` });
            break;
          }
          categories.push(String(c));
        }
      }
    }

    const flagsRaw = (raw.featureFlags ?? {}) as Record<string, unknown>;
    if (typeof flagsRaw !== 'object' || flagsRaw === null || Array.isArray(flagsRaw)) {
      violations.push({ field: 'featureFlags', reason: '객체여야 합니다.' });
    }
    const from = checkTimestamp('from', raw.from, violations);
    const to = checkTimestamp('to', raw.to, violations);
    if (from && to && Date.parse(from) > Date.parse(to)) {
      violations.push({ field: 'to', reason: 'from 이후여야 합니다.' });
    }
    if (
      raw.requestReason !== undefined &&
      raw.requestReason !== null &&
      (typeof raw.requestReason !== 'string' || raw.requestReason.length > 500)
    ) {
      violations.push({ field: 'requestReason', reason: '500자 이하 문자열이어야 합니다.' });
    }

    if (violations.length > 0) throw providerErrors.invalidRequest(violations);

    return ok(
      req,
      await this.providers.collect(
        requireAuth(req),
        situationId,
        {
          providers: providers as never,
          query: (raw.query as Record<string, unknown>) ?? {},
          categories,
          featureFlags: {
            safekorea: flagsRaw.safekorea === true,
            naver: flagsRaw.naver === true,
            t3q: flagsRaw.t3q === true,
          },
          requestReason: (raw.requestReason as string | null | undefined) ?? null,
          from: from ?? null,
          to: to ?? null,
        },
        requestMeta(req),
      ),
    );
  }

  /** UNE-SIT-007 */
  @Post(':id/facts')
  @RequirePermission('SITUATION_FACT_EDIT')
  @Idempotent({ required: true, successStatus: 201 })
  async createFact(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Body() body: Record<string, unknown> | undefined,
  ): Promise<SuccessEnvelope<SituationFactResource>> {
    const situationId = uuidParam('id', id);
    const raw = body ?? {};
    const violations: ErrorViolation[] = [];
    rejectUnknownKeys(
      raw,
      ['factType', 'factKey', 'value', 'unit', 'observedAt', 'confidence', 'source'],
      violations,
    );

    if (!(FACT_TYPES as readonly string[]).includes(String(raw.factType))) {
      violations.push({ field: 'factType', reason: `허용 값: ${FACT_TYPES.join(', ')}` });
    }
    if (!isFactKey(raw.factKey)) {
      violations.push({
        field: 'factKey',
        reason: '소문자로 시작하는 표준 Key여야 합니다(^[a-z][a-z0-9_.-]{1,99}$).',
      });
    }
    if (raw.value === undefined || raw.value === null) {
      violations.push({ field: 'value', reason: '필수 항목입니다.' });
    }
    if (
      raw.unit !== undefined &&
      raw.unit !== null &&
      (typeof raw.unit !== 'string' || raw.unit.length > 30)
    ) {
      violations.push({ field: 'unit', reason: '30자 이하 문자열이어야 합니다.' });
    }
    const observedAt = checkTimestamp('observedAt', raw.observedAt, violations);
    let confidence: number | null = null;
    if (raw.confidence !== undefined && raw.confidence !== null) {
      if (typeof raw.confidence !== 'number' || raw.confidence < 0 || raw.confidence > 1) {
        violations.push({ field: 'confidence', reason: '0 이상 1 이하의 수여야 합니다.' });
      } else confidence = raw.confidence;
    }

    const source = (raw.source ?? {}) as Record<string, unknown>;
    if (typeof source !== 'object' || source === null || Array.isArray(source)) {
      violations.push({ field: 'source', reason: '객체여야 합니다.' });
    }
    // providerCode는 받지 않는다 — 서버가 MANUAL로 고정한다.
    if ('providerCode' in source || 'sourceType' in source) {
      violations.push({
        field: 'source',
        reason: '출처 종류는 지정할 수 없습니다(사용자 입력은 MANUAL/USER로 기록됩니다).',
      });
    }
    const sourceName =
      typeof source.sourceName === 'string' && source.sourceName.trim()
        ? source.sourceName.trim().slice(0, 300)
        : null;
    const sourceUrl = typeof source.sourceUrl === 'string' ? source.sourceUrl : null;

    if (violations.length > 0) throw factErrors.invalidRequest(violations);

    const input: ManualFactInput = {
      factType: raw.factType as string,
      factKey: raw.factKey as string,
      value: raw.value,
      unit: (raw.unit as string | null | undefined) ?? null,
      observedAt: observedAt ?? null,
      confidence,
      sourceName,
      sourceUrl,
    };
    return ok(
      req,
      await this.facts.createManual(requireAuth(req), situationId, input, requestMeta(req)),
    );
  }

  /** UNE-SIT-014 */
  @Get(':id/facts')
  @RequirePermission('SITUATION_READ')
  async listFacts(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('factType') factType?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ): Promise<SuccessEnvelope<Page<SituationFactResource>>> {
    const situationId = uuidParam('id', id);
    const violations: ErrorViolation[] = [];
    if (status !== undefined && !(FACT_STATUSES as readonly string[]).includes(status)) {
      violations.push({ field: 'status', reason: `허용 값: ${FACT_STATUSES.join(', ')}` });
    }
    if (factType !== undefined && !(FACT_TYPES as readonly string[]).includes(factType)) {
      violations.push({ field: 'factType', reason: `허용 값: ${FACT_TYPES.join(', ')}` });
    }
    const paging = parsePaging(page, size, 50, 200, violations);
    if (violations.length > 0) throw situationErrors.invalidFactQuery(violations);

    return ok(
      req,
      await this.facts.list(requireAuth(req), situationId, {
        ...(status ? { status } : {}),
        ...(factType ? { factType } : {}),
        ...paging,
      }),
    );
  }

  /** UNE-SIT-008 */
  @Patch(':id/facts/:factId')
  @RequirePermission('SITUATION_FACT_EDIT')
  @Idempotent({ required: false, successStatus: 200 })
  async patchFact(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Param('factId') factId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: Record<string, unknown> | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SuccessEnvelope<SituationFactResource>> {
    const situationId = uuidParam('id', id);
    const targetFactId = uuidParam('factId', factId);
    const expectedVersion = parseIfMatch(ifMatch);
    const raw = body ?? {};
    const violations: ErrorViolation[] = [];
    rejectUnknownKeys(raw, ['value', 'unit', 'observedAt', 'confidence', 'reason'], violations);
    if (Object.keys(raw).length === 0) {
      violations.push({ field: 'body', reason: '보정할 항목이 하나 이상 필요합니다.' });
    }

    const patch: FactPatchInput = {};
    if (Object.prototype.hasOwnProperty.call(raw, 'value')) {
      if (raw.value === null) violations.push({ field: 'value', reason: 'null일 수 없습니다.' });
      else patch.value = raw.value;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'unit')) {
      if (raw.unit !== null && (typeof raw.unit !== 'string' || raw.unit.length > 30)) {
        violations.push({ field: 'unit', reason: '30자 이하 문자열이어야 합니다.' });
      } else patch.unit = (raw.unit as string | null) ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'observedAt')) {
      const value = checkTimestamp('observedAt', raw.observedAt, violations);
      if (value !== undefined) patch.observedAt = value;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'confidence')) {
      if (raw.confidence === null) patch.confidence = null;
      else if (typeof raw.confidence !== 'number' || raw.confidence < 0 || raw.confidence > 1) {
        violations.push({ field: 'confidence', reason: '0 이상 1 이하의 수여야 합니다.' });
      } else patch.confidence = raw.confidence;
    }
    if (raw.reason !== undefined) {
      if (typeof raw.reason !== 'string' || raw.reason.length > 500) {
        violations.push({ field: 'reason', reason: '500자 이하 문자열이어야 합니다.' });
      } else patch.reason = raw.reason;
    }

    if (violations.length > 0) throw factErrors.invalidRequest(violations);

    const updated = await this.facts.patch(
      requireAuth(req),
      situationId,
      targetFactId,
      expectedVersion,
      patch,
      requestMeta(req),
    );
    setEtag(res, updated.versionNo);
    return ok(req, updated);
  }
}

/** UNE-SIT-015. 경로 뿌리가 달라 컨트롤러를 나눈다. */
@Controller('provider-jobs')
export class ProviderJobController {
  constructor(@Inject(ProviderQueryService) private readonly providers: ProviderQueryService) {}

  @Get(':jobId')
  @RequirePermission('SITUATION_READ')
  async job(
    @Req() req: ApiRequest,
    @Param('jobId') jobId: string,
  ): Promise<SuccessEnvelope<Awaited<ReturnType<ProviderQueryService['job']>>>> {
    return ok(req, await this.providers.job(requireAuth(req), uuidParam('jobId', jobId)));
  }
}
