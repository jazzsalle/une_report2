import type { TocNodeDraft } from '@une/domain';
import type { components } from '../../generated/t3q-plan-api-v2';

/**
 * PlanContext ↔ target-v2 TocGenerationRequest/OutlineSection mapping
 * (CC-125, ADR-26 D5). The requested contract 1.0.1-request is NOT
 * T3Q-accepted (OB-10): this mapper feeds the in-process mock only and the
 * capability tocV2 stays MOCK_ONLY (CR-T3Q-* governance invariant).
 *
 * Constant injections fixed by the gap matrix:
 * - schemaVersion: '2.0'
 * - expressionRule.scope: 'body_only'
 * The mapper output is machine-validated against the contract schema in
 * @une/contract-tests (v2 has unevaluatedProperties:false, so typo fields
 * actually fail — the detection the legacy transcript cannot give).
 */

export const TARGET_V2_TOC_MAPPING_VERSION = 'v2-1.0.1-request@1';

export type TocGenerationRequestV2 = components['schemas']['TocGenerationRequest'];
export type OutlineSectionV2 = components['schemas']['OutlineSection'];
export type GenerationAcceptedV2 = components['schemas']['GenerationAccepted'];
export type GenerationStatusV2 = components['schemas']['GenerationStatus'];

/** Aggregate bindings PlanRequestBase requires. All values come from the
 * CALLER (job context) — the mapper invents nothing. documentId and
 * baseRevisionId do not exist in the UNE plan flow until CC-150; the worker
 * passes explicit mock-only placeholders that governance keeps out of any
 * promoted path (ADR-26 D5). */
export interface TargetV2RequestContext {
  requestId: string;
  correlationId: string;
  tenantId: string;
  userId: string;
  planId: string;
  documentId: string;
  baseRevisionId: string;
  planContextSnapshotId: string;
  contextHash: string;
  /** ISO-8601 with explicit offset. */
  requestedAt: string;
  /** UNE-owned client context defaults (contract: timezone default
   * Asia/Seoul; locale은 UNE 운영 언어). */
  locale?: string;
  timezone?: string;
}

export class TargetV2MappingError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
    this.name = 'TargetV2MappingError';
  }
}

const CONTEXT_FIELDS: readonly (keyof TargetV2RequestContext)[] = [
  'requestId',
  'correlationId',
  'tenantId',
  'userId',
  'planId',
  'documentId',
  'baseRevisionId',
  'planContextSnapshotId',
  'contextHash',
  'requestedAt',
];

/** Shared PlanRequestBase construction for every v2 request mapper (CC-135
 * extracted from the toc mapper — one binding-validation path). */
export function toPlanRequestBase(
  planContext: Record<string, unknown>,
  context: TargetV2RequestContext,
): Omit<TocGenerationRequestV2, 'existingOutline' | 'generationOption'> {
  for (const field of CONTEXT_FIELDS) {
    if (typeof context[field] !== 'string' || context[field].length === 0) {
      throw new TargetV2MappingError(field, 'required PlanRequestBase binding is missing');
    }
  }
  const subject = planContext.subject;
  if (typeof subject !== 'string' || subject.trim().length === 0) {
    throw new TargetV2MappingError('subject', 'planContext.subject must be a non-empty string');
  }
  return {
    schemaVersion: '2.0',
    requestId: context.requestId,
    correlationId: context.correlationId,
    clientContext: {
      tenantId: context.tenantId,
      userId: context.userId,
      locale: context.locale ?? 'ko-KR',
      timezone: context.timezone ?? 'Asia/Seoul',
    },
    planId: context.planId,
    documentId: context.documentId,
    baseRevisionId: context.baseRevisionId,
    planContextSnapshotId: context.planContextSnapshotId,
    contextHash: context.contextHash,
    subject,
    backgroundInfo: asOpenObject(planContext.backgroundInfo),
    contentInstruction: asOpenObject(planContext.contentInstruction),
    expressionRule: { ...asOpenObject(planContext.expressionRule), scope: 'body_only' },
    purposeOfDocument: asOpenObject(planContext.purposeOfDocument),
    requestedAt: context.requestedAt,
    // systemPromptVersion intentionally absent: v2 replaces the legacy
    // systemPrompt full text and UNE has no version registry yet (gap matrix).
  };
}

export function toTocGenerationRequest(
  planContext: Record<string, unknown>,
  context: TargetV2RequestContext,
): TocGenerationRequestV2 {
  return toPlanRequestBase(planContext, context);
}

function asOpenObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined) continue;
    out[key] = entry;
  }
  return out;
}

/**
 * OutlineSection[] → canonical TOC tree. v2 sections carry stable ids
 * (CR-T3Q-001's reason to exist): sectionId becomes the nodeKey verbatim,
 * tree shape is rebuilt from parentSectionId + order.
 */
export function fromOutlineSections(sections: readonly OutlineSectionV2[]): TocNodeDraft[] {
  const nodes = new Map<string, TocNodeDraft & { children: TocNodeDraft[] }>();
  for (const section of sections) {
    if (nodes.has(section.sectionId)) {
      throw new TargetV2MappingError('sectionId', `duplicate sectionId: ${section.sectionId}`);
    }
    nodes.set(section.sectionId, {
      nodeKey: section.sectionId,
      title: section.title,
      generationPolicy: {
        semanticRole: section.semanticRole,
        generationPolicy: section.generationPolicy,
        required: section.required,
        ...(section.instruction ? { instruction: section.instruction } : {}),
      },
      children: [],
    });
  }
  const ordered = [...sections].sort((a, b) => a.order - b.order);
  const roots: TocNodeDraft[] = [];
  for (const section of ordered) {
    const node = nodes.get(section.sectionId) as TocNodeDraft & { children: TocNodeDraft[] };
    if (section.parentSectionId === null || section.parentSectionId === undefined) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(section.parentSectionId);
    if (!parent) {
      throw new TargetV2MappingError(
        'parentSectionId',
        `unknown parentSectionId: ${section.parentSectionId}`,
      );
    }
    parent.children.push(node);
  }
  if (roots.length === 0 && sections.length > 0) {
    throw new TargetV2MappingError('outline', 'no root sections (parent cycle?)');
  }
  return roots;
}
