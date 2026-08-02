import { sha256Hex } from '@une/domain';
import { buildMockOutline, type MockOutlineNode } from './mock-plan-outline';
import type { TocGenerationRequestV2 } from './target-v2-toc-mapper';

/**
 * Deterministic in-process transport for the target-v2 mock adapter
 * (CC-125, ADR-26 D5). Faithful to the requested contract's ASYNC shape:
 * POST → 202 GenerationAccepted(QUEUED) → status polls RUNNING → COMPLETED
 * with a full OutlineSection[] — because the 202+Job flow is exactly what
 * CR-T3Q-003 requests. SSE/cancel/partial retry fidelity is CC-135.
 *
 * Determinism: generationId derives from requestId (same submit → same id),
 * timestamps echo requestedAt, and the outline derives from the SAME
 * PlanContext rules as the legacy mock so both variants produce
 * structurally equivalent canonical trees (port contract test).
 *
 * This transport returns RAW unknown values on purpose — the adapter must
 * run its response guards against it like any provider payload. It is
 * in-process only; the FastAPI mock-server is not extended (ADR-24 한계).
 */

export interface TargetV2Transport {
  submitToc(request: TocGenerationRequestV2): Promise<unknown>;
  getStatus(generationId: string): Promise<unknown>;
}

interface MockGeneration {
  request: TocGenerationRequestV2;
  polls: number;
}

export class MockTargetV2Transport implements TargetV2Transport {
  private readonly generations = new Map<string, MockGeneration>();

  /** Status polls needed before COMPLETED (>=1 RUNNING poll keeps the
   * adapter's polling loop honest in tests). */
  constructor(private readonly runningPolls = 1) {}

  async submitToc(request: TocGenerationRequestV2): Promise<unknown> {
    const generationId = `gen-${sha256Hex(request.requestId).slice(0, 16)}`;
    if (!this.generations.has(generationId)) {
      this.generations.set(generationId, { request, polls: 0 });
    }
    return {
      generationId,
      status: 'QUEUED',
      statusUrl: `/model-api/une-mock/v2/generation-jobs/${generationId}`,
      eventStreamUrl: `/model-api/une-mock/v2/generation-jobs/${generationId}/events`,
      acceptedAt: request.requestedAt,
      requestId: request.requestId,
      correlationId: request.correlationId,
    };
  }

  async getStatus(generationId: string): Promise<unknown> {
    const generation = this.generations.get(generationId);
    if (!generation) {
      return {
        generationId,
        status: 'FAILED',
        progress: 0,
        completedTargetIds: [],
        failedTargetIds: [],
        error: {
          code: 'GENERATION_NOT_FOUND',
          message: `unknown generationId: ${generationId}`,
          retryable: false,
        },
      };
    }
    generation.polls += 1;
    if (generation.polls <= this.runningPolls) {
      return {
        generationId,
        status: 'RUNNING',
        progress: Math.min(90, Math.round((generation.polls / (this.runningPolls + 1)) * 100)),
        completedTargetIds: [],
        failedTargetIds: [],
        updatedAt: generation.request.requestedAt,
      };
    }
    const outline = buildOutlineSections(generation.request);
    return {
      generationId,
      status: 'COMPLETED',
      progress: 100,
      completedTargetIds: outline.map((section) => section.sectionId as string),
      failedTargetIds: [],
      outline,
      warnings: [],
      error: null,
      updatedAt: generation.request.requestedAt,
    };
  }
}

const SEMANTIC_ROLES = ['BACKGROUND', 'ACTION_PLAN', 'APPENDIX'] as const;

function buildOutlineSections(request: TocGenerationRequestV2): Record<string, unknown>[] {
  const outline = buildMockOutline({
    subject: request.subject,
    backgroundInfo: request.backgroundInfo,
    contentInstruction: request.contentInstruction,
  });
  const sections: Record<string, unknown>[] = [];
  let order = 0;
  const walk = (
    nodes: readonly MockOutlineNode[],
    parentSectionId: string | null,
    level: number,
    prefix: string,
    roleIndex: number,
  ): void => {
    nodes.forEach((node, index) => {
      const sectionId = `${prefix}-${index + 1}`;
      order += 1;
      sections.push({
        sectionId,
        parentSectionId,
        outlineLevel: level,
        order,
        title: node.name,
        semanticRole:
          level === 1
            ? SEMANTIC_ROLES[Math.min(index, SEMANTIC_ROLES.length - 1)]
            : SEMANTIC_ROLES[Math.min(roleIndex, SEMANTIC_ROLES.length - 1)],
        generationPolicy: 'GENERATE',
        required: false,
      });
      walk(node.children, sectionId, level + 1, sectionId, level === 1 ? index : roleIndex);
    });
  };
  walk(outline.sections, null, 1, 's', 0);
  return sections;
}
