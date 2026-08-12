import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import {
  isSopNodeType,
  SOP_NODE_KEY_PATTERN,
  SOP_TITLE_MAX_LENGTH,
  type SopEdgeDraft,
  type SopMappingWarning,
} from '@une/domain';
import type { ErrorViolation } from '../common/api-error';
import { requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { sopCanvasErrors } from './sop-canvas-errors';
import type { SopNodeRow } from './sop.repository';
import {
  SopService,
  type SopGraphResource,
  type SopResource,
  type SopVersionResource,
} from './sop.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE = 2000;
const MAX_NODES = 500;

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * 캔버스 본문 파싱 (UNE-SOP-006).
 *
 * **여기서 거부하는 것은 "그래프가 스스로 성립하지 않는" 경우뿐이다.**
 * 시작 노드가 없다거나 순환한다거나 하는 것은 400이 아니라 검증 보고의 몫이다
 * — 고치는 중에는 깨진 그래프를 저장할 수 있어야 한다(CC-240 D4와 같은 규칙).
 */
export function parseGraphBody(body: unknown): {
  baseVersionId: string;
  nodes: SopNodeRow[];
  edges: SopEdgeDraft[];
} {
  const b = rec(body);
  const violations: ErrorViolation[] = [];

  const baseVersionId = b.baseVersionId;
  if (typeof baseVersionId !== 'string' || !UUID.test(baseVersionId)) {
    violations.push({ field: 'baseVersionId', reason: 'UUID여야 합니다.' });
  }
  if (!Array.isArray(b.nodes) || b.nodes.length === 0) {
    violations.push({ field: 'nodes', reason: '노드가 하나 이상이어야 합니다.' });
  } else if (b.nodes.length > MAX_NODES) {
    violations.push({ field: 'nodes', reason: `노드는 ${MAX_NODES}개 이하여야 합니다.` });
  }
  if (b.edges !== undefined && !Array.isArray(b.edges)) {
    violations.push({ field: 'edges', reason: '배열이어야 합니다.' });
  }
  if (violations.length > 0) throw sopCanvasErrors.invalidRequest(violations);

  const nodes: SopNodeRow[] = [];
  const keys = new Set<string>();
  for (const [index, raw] of (b.nodes as unknown[]).entries()) {
    const n = rec(raw);
    const nodeKey = n.nodeKey;
    if (typeof nodeKey !== 'string' || !SOP_NODE_KEY_PATTERN.test(nodeKey)) {
      violations.push({
        field: `nodes[${index}].nodeKey`,
        reason: `${SOP_NODE_KEY_PATTERN.source} 형식이어야 합니다.`,
      });
      continue;
    }
    if (keys.has(nodeKey)) {
      // 중복 키는 저장 자체가 불가능하다(uk_sop_node_key). 검증 보고로
      // 미루면 저장이 23505로 죽고 사용자는 이유를 모른다.
      violations.push({ field: `nodes[${index}].nodeKey`, reason: '노드 키가 중복됩니다.' });
      continue;
    }
    keys.add(nodeKey);

    if (!isSopNodeType(n.nodeType)) {
      violations.push({ field: `nodes[${index}].nodeType`, reason: '알 수 없는 노드 유형입니다.' });
      continue;
    }
    const title = typeof n.title === 'string' ? n.title.trim() : '';
    if (title.length === 0 || title.length > SOP_TITLE_MAX_LENGTH) {
      violations.push({
        field: `nodes[${index}].title`,
        reason: `1~${SOP_TITLE_MAX_LENGTH}자여야 합니다.`,
      });
      continue;
    }

    const tasks = Array.isArray(n.tasks)
      ? n.tasks.map((t) => {
          const task = rec(t);
          return {
            instruction: typeof task.instruction === 'string' ? task.instruction : '',
            assigneeHint: typeof task.assigneeHint === 'string' ? task.assigneeHint : null,
          };
        })
      : [];
    const position = rec(n.position);
    nodes.push({
      nodeKey,
      providerNodeKey: typeof n.providerNodeKey === 'string' ? n.providerNodeKey : nodeKey,
      type: n.nodeType,
      title,
      sequence: index + 1,
      tasks: tasks.filter((t) => t.instruction.length > 0),
      decisionExpression:
        typeof n.decisionExpression === 'string' && n.decisionExpression.trim().length > 0
          ? n.decisionExpression.trim()
          : null,
      sourceRefs: Array.isArray(n.sourceRefs)
        ? n.sourceRefs.filter((x): x is string => typeof x === 'string' && UUID.test(x))
        : [],
      // 매핑 경고는 provider 산출물의 것이다. 사람이 저장할 때는 다시 계산하지
      // 않고 클라이언트가 되돌려 준 값을 믿지도 않는다 — 편집본은 비운다.
      warnings: [] as SopMappingWarning[],
      position:
        typeof position.x === 'number' && typeof position.y === 'number'
          ? { x: position.x, y: position.y }
          : null,
    });
  }

  const edges: SopEdgeDraft[] = [];
  for (const [index, raw] of ((b.edges as unknown[]) ?? []).entries()) {
    const e = rec(raw);
    const from = e.fromNodeKey;
    const to = e.toNodeKey;
    if (typeof from !== 'string' || typeof to !== 'string') {
      violations.push({ field: `edges[${index}]`, reason: 'fromNodeKey/toNodeKey가 필요합니다.' });
      continue;
    }
    // 없는 노드를 가리키는 간선은 **저장할 수 없다** — DB가 노드 id로 잇기
    // 때문이다. 검증 보고의 DANGLING_EDGE는 저장된 그래프를 두고 하는 말이다.
    if (!keys.has(from) || !keys.has(to)) {
      violations.push({
        field: `edges[${index}]`,
        reason: '본문에 없는 노드를 가리킵니다.',
      });
      continue;
    }
    if (from === to) {
      violations.push({ field: `edges[${index}]`, reason: '자기 자신을 가리킬 수 없습니다.' });
      continue;
    }
    edges.push({
      fromNodeKey: from,
      toNodeKey: to,
      conditionExpr: typeof e.conditionExpr === 'string' ? e.conditionExpr : null,
      label: typeof e.label === 'string' ? e.label : null,
      priority:
        Number.isInteger(e.priority) && (e.priority as number) >= 0 ? (e.priority as number) : 0,
    });
  }

  if (violations.length > 0) throw sopCanvasErrors.invalidGraph(violations);
  return { baseVersionId: baseVersionId as string, nodes, edges };
}

function parseOptionalMessage(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > MAX_MESSAGE) {
    throw sopCanvasErrors.invalidRequest([
      { field, reason: `${MAX_MESSAGE}자 이하의 문자열이어야 합니다.` },
    ]);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** UNE-SOP-003~009. */
@Controller('sops')
export class SopController {
  constructor(@Inject(SopService) private readonly sops: SopService) {}

  /** UNE-SOP-003 */
  @Post()
  @RequirePermission('SOP_EDIT')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async create(
    @Req() req: ApiRequest,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<SopResource>> {
    const b = rec(body);
    const violations: ErrorViolation[] = [];
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (title.length === 0 || title.length > SOP_TITLE_MAX_LENGTH) {
      violations.push({ field: 'title', reason: `1~${SOP_TITLE_MAX_LENGTH}자여야 합니다.` });
    }
    const hazardType = typeof b.hazardType === 'string' ? b.hazardType.trim() : '';
    if (hazardType.length === 0) violations.push({ field: 'hazardType', reason: '필수입니다.' });
    const situationId = b.situationId;
    if (situationId !== undefined && situationId !== null && typeof situationId !== 'string') {
      violations.push({ field: 'situationId', reason: 'UUID여야 합니다.' });
    }
    if (typeof situationId === 'string' && !UUID.test(situationId)) {
      violations.push({ field: 'situationId', reason: 'UUID여야 합니다.' });
    }
    if (violations.length > 0) throw sopCanvasErrors.invalidRequest(violations);

    return ok(
      req,
      await this.sops.createSop(
        requireAuth(req),
        {
          situationId: typeof situationId === 'string' ? situationId : null,
          title,
          hazardType,
        },
        requestMeta(req),
      ),
    );
  }

  /** UNE-SOP-004 */
  @Get()
  @RequirePermission('SOP_READ')
  async list(
    @Req() req: ApiRequest,
    @Query('status') status?: string,
    @Query('hazardType') hazardType?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ): Promise<SuccessEnvelope<Awaited<ReturnType<SopService['listSops']>>>> {
    const violations: ErrorViolation[] = [];
    const pageNo = page === undefined ? 0 : Number(page);
    const pageSize = size === undefined ? 20 : Number(size);
    if (!Number.isInteger(pageNo) || pageNo < 0) {
      violations.push({ field: 'page', reason: '0 이상의 정수여야 합니다.' });
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      violations.push({ field: 'size', reason: '1~100 사이의 정수여야 합니다.' });
    }
    if (violations.length > 0) throw sopCanvasErrors.invalidQuery(violations);

    return ok(
      req,
      await this.sops.listSops(requireAuth(req), {
        ...(status ? { status } : {}),
        ...(hazardType ? { hazardType } : {}),
        page: pageNo,
        size: pageSize,
      }),
    );
  }

  /** UNE-SOP-005 */
  @Get(':sopId')
  @RequirePermission('SOP_READ')
  async getGraph(
    @Req() req: ApiRequest,
    @Param('sopId') sopId: string,
    @Query('versionId') versionId?: string,
  ): Promise<SuccessEnvelope<SopGraphResource>> {
    if (versionId !== undefined && !UUID.test(versionId)) {
      throw sopCanvasErrors.invalidQuery([{ field: 'versionId', reason: 'UUID여야 합니다.' }]);
    }
    return ok(
      req,
      await this.sops.getGraph(requireAuth(req), uuidParam('sopId', sopId), versionId ?? null),
    );
  }

  /** UNE-SOP-006 */
  @Post(':sopId/versions')
  @RequirePermission('SOP_EDIT')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async saveVersion(
    @Req() req: ApiRequest,
    @Param('sopId') sopId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<SopVersionResource>> {
    return ok(
      req,
      await this.sops.saveDraftVersion(
        requireAuth(req),
        uuidParam('sopId', sopId),
        parseGraphBody(body),
        requestMeta(req),
      ),
    );
  }

  /** UNE-SOP-007 */
  @Post(':sopId/validate')
  @RequirePermission('SOP_EDIT')
  @HttpCode(200)
  async validate(
    @Req() req: ApiRequest,
    @Param('sopId') sopId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<Awaited<ReturnType<SopService['validate']>>>> {
    const versionId = rec(body).versionId;
    if (versionId !== undefined && versionId !== null) {
      if (typeof versionId !== 'string' || !UUID.test(versionId)) {
        throw sopCanvasErrors.invalidRequest([{ field: 'versionId', reason: 'UUID여야 합니다.' }]);
      }
    }
    return ok(
      req,
      await this.sops.validate(
        requireAuth(req),
        uuidParam('sopId', sopId),
        typeof versionId === 'string' ? versionId : null,
      ),
    );
  }

  /** UNE-SOP-008 */
  @Post(':sopId/submit-review')
  @RequirePermission('SOP_EDIT')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async submitReview(
    @Req() req: ApiRequest,
    @Param('sopId') sopId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<Awaited<ReturnType<SopService['submitReview']>>>> {
    const b = rec(body);
    const violations: ErrorViolation[] = [];
    const versionId = b.versionId;
    if (typeof versionId !== 'string' || !UUID.test(versionId)) {
      violations.push({ field: 'versionId', reason: 'UUID여야 합니다.' });
    }
    const reviewers = Array.isArray(b.reviewers) ? b.reviewers : [];
    if (reviewers.length === 0) {
      // 검토자가 없는 검토 요청은 아무에게도 가지 않는다.
      violations.push({ field: 'reviewers', reason: '한 명 이상이어야 합니다.' });
    }
    if (reviewers.some((r) => typeof r !== 'string' || !UUID.test(r))) {
      violations.push({ field: 'reviewers', reason: 'UUID 목록이어야 합니다.' });
    }
    if (violations.length > 0) throw sopCanvasErrors.invalidRequest(violations);

    return ok(
      req,
      await this.sops.submitReview(
        requireAuth(req),
        uuidParam('sopId', sopId),
        {
          versionId: versionId as string,
          reviewers: [...new Set(reviewers as string[])],
          message: parseOptionalMessage(b.message, 'message'),
        },
        requestMeta(req),
      ),
    );
  }

  /** UNE-SOP-009 */
  @Post(':sopId/approve')
  @RequirePermission('SOP_APPROVE')
  @Idempotent({ required: true, successStatus: 200 })
  @HttpCode(200)
  async approve(
    @Req() req: ApiRequest,
    @Param('sopId') sopId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<SopVersionResource>> {
    const b = rec(body);
    const versionId = b.versionId;
    if (typeof versionId !== 'string' || !UUID.test(versionId)) {
      throw sopCanvasErrors.invalidRequest([{ field: 'versionId', reason: 'UUID여야 합니다.' }]);
    }
    return ok(
      req,
      await this.sops.approve(
        requireAuth(req),
        uuidParam('sopId', sopId),
        { versionId, comment: parseOptionalMessage(b.comment, 'comment') },
        requestMeta(req),
      ),
    );
  }
}
