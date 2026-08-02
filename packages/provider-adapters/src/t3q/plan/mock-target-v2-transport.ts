import { buildMockOutline, type MockOutlineNode } from './mock-plan-outline';
import {
  MockTargetV2JobStore,
  TargetV2TransportError,
  type MockTargetV2ScenarioOptions,
} from './mock-target-v2-job-store';
import {
  MOCK_TARGET_V2_CAPABILITIES,
  buildMockChangeProposal,
  buildMockErrorResponse,
  buildMockEvidenceItems,
  buildMockValidationReport,
  type ContentGenerationRequestV2,
  type EvidenceSearchRequestV2,
  type OutlineSectionV2,
  type SemanticEditRequestV2,
  type ValidationRequestV2,
} from './mock-target-v2-payloads';
import { serializeTargetV2Sse } from './target-v2-sse.assumed';
import type { TocGenerationRequestV2 } from './target-v2-toc-mapper';

/**
 * Deterministic in-process transport for the target-v2 mock adapter
 * (CC-125 toc; CC-135 full lifecycle — content, SSE, cancel, partial retry,
 * semantic edit, evidence, validation, capabilities). Faithful to the
 * requested contract's ASYNC shape because the 202+Job flow is exactly what
 * CR-T3Q-003 requests.
 *
 * Error semantics: non-2xx responses are thrown as TargetV2TransportError
 * {httpStatus, body(ErrorResponse)} — the seam a live transport (CC-400)
 * reproduces, so the adapter's 409→T3Q_CONFLICT mapping survives the swap.
 *
 * This transport returns RAW unknown values on purpose — the adapter must
 * run its response guards against it like any provider payload. It is
 * in-process only; the FastAPI mock-server is not extended (ADR-24 한계).
 */

export interface TargetV2Transport {
  submitToc(request: TocGenerationRequestV2): Promise<unknown>;
  submitContent(request: ContentGenerationRequestV2): Promise<unknown>;
  getStatus(generationId: string): Promise<unknown>;
  /** Raw SSE transcript (string). Framing is a UNE assumption (OB-10). */
  streamEvents(
    generationId: string,
    lastEventId: number | undefined,
    correlationId: string,
  ): Promise<unknown>;
  cancelJob(
    generationId: string,
    reason: string | undefined,
    correlationId: string,
  ): Promise<unknown>;
  retryJobTargets(
    generationId: string,
    request: { targetType: 'SECTION' | 'BLOCK'; targetIds: string[]; instructionOverride?: string },
    correlationId: string,
  ): Promise<unknown>;
  requestSemanticEdit(request: SemanticEditRequestV2): Promise<unknown>;
  searchEvidence(request: EvidenceSearchRequestV2): Promise<unknown>;
  validateContent(request: ValidationRequestV2): Promise<unknown>;
  getCapabilities(): Promise<unknown>;
}

export class MockTargetV2Transport implements TargetV2Transport {
  private readonly store: MockTargetV2JobStore;
  private readonly options: MockTargetV2ScenarioOptions;

  /** Back-compat: a bare number is the CC-125 `runningPolls` form. */
  constructor(options: MockTargetV2ScenarioOptions | number = {}) {
    this.options = typeof options === 'number' ? { runningPolls: options } : options;
    this.store = new MockTargetV2JobStore(this.options);
  }

  async submitToc(request: TocGenerationRequestV2): Promise<unknown> {
    const job = this.store.submitToc(request, buildOutlineSections);
    return this.store.acceptedBody(job);
  }

  async submitContent(request: ContentGenerationRequestV2): Promise<unknown> {
    const job = this.store.submitContent(request);
    return this.store.acceptedBody(job);
  }

  async getStatus(generationId: string): Promise<unknown> {
    return this.store.pollStatus(generationId);
  }

  async streamEvents(
    generationId: string,
    lastEventId: number | undefined,
    correlationId: string,
  ): Promise<unknown> {
    const frames = this.store.frames(generationId, correlationId);
    const replay = lastEventId === undefined ? frames : frames.filter((f) => f.id > lastEventId);
    return serializeTargetV2Sse(replay);
  }

  async cancelJob(
    generationId: string,
    reason: string | undefined,
    correlationId: string,
  ): Promise<unknown> {
    return this.store.cancel(generationId, reason, correlationId);
  }

  async retryJobTargets(
    generationId: string,
    request: { targetType: 'SECTION' | 'BLOCK'; targetIds: string[]; instructionOverride?: string },
    correlationId: string,
  ): Promise<unknown> {
    const child = this.store.retry(generationId, request, correlationId);
    return this.store.acceptedBody(child);
  }

  async requestSemanticEdit(request: SemanticEditRequestV2): Promise<unknown> {
    if ((this.options.editConflictBaseRevisionIds ?? []).includes(request.baseRevisionId)) {
      throw new TargetV2TransportError(
        409,
        buildMockErrorResponse(
          'PLAN-V2-409-001',
          `baseRevisionId ${request.baseRevisionId} is stale`,
          request.correlationId,
        ),
      );
    }
    return buildMockChangeProposal(request);
  }

  async searchEvidence(request: EvidenceSearchRequestV2): Promise<unknown> {
    return { requestId: request.requestId, items: buildMockEvidenceItems(request) };
  }

  async validateContent(request: ValidationRequestV2): Promise<unknown> {
    return buildMockValidationReport(request);
  }

  async getCapabilities(): Promise<unknown> {
    // structuredClone: callers must not be able to mutate the canonical value
    return structuredClone(MOCK_TARGET_V2_CAPABILITIES);
  }
}

export {
  TargetV2TransportError,
  type MockTargetV2ScenarioOptions,
} from './mock-target-v2-job-store';

const SEMANTIC_ROLES = ['BACKGROUND', 'ACTION_PLAN', 'APPENDIX'] as const;

function buildOutlineSections(request: TocGenerationRequestV2): OutlineSectionV2[] {
  const outline = buildMockOutline({
    subject: request.subject,
    backgroundInfo: request.backgroundInfo,
    contentInstruction: request.contentInstruction,
  });
  const sections: OutlineSectionV2[] = [];
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
