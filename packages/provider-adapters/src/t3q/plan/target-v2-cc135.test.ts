import { describe, expect, it } from 'vitest';
import type { TocNodeDraft } from '@une/domain';
import {
  MOCK_TARGET_V2_CAPABILITIES,
  MOCK_TARGET_V2_PROVIDER_BUILD,
  buildMockChangeProposal,
  type SemanticEditRequestV2,
} from './mock-target-v2-payloads';
import { MockTargetV2Transport } from './mock-target-v2-transport';
import { toContentGenerationRequest } from './target-v2-content-mapper';
import { TargetV2T3qPlanAdapter } from './target-v2-t3q-plan-adapter';
import { toSemanticEditRequest } from './target-v2-edit-mapper';
import type { TargetV2RequestContext } from './target-v2-toc-mapper';
import type {
  ProviderCallContext,
  T3qSemanticEditRequest,
  T3qValidationRequest,
} from './t3q-plan-port';

/**
 * CC-135 target-v2 mock lifecycle: content job, cancel/retry, SSE replay,
 * semantic edit, evidence, validation, capabilities discovery. Everything
 * here runs against the in-process mock — MOCK_ONLY governance is asserted
 * separately in tests/contract/src/capability-governance.test.ts.
 */

const planContext = {
  subject: '2026년 폭염 대비 안전관리 계획',
  backgroundInfo: { disasterType: '폭염', controlPhase: '대비' },
  contentInstruction: { essentialFactors: ['무더위쉼터 운영', '취약계층 보호 대책'] },
  expressionRule: { tone: '개조식' },
  purposeOfDocument: { goalOfBusiness: '피해 최소화', role: '담당자', targetAudiences: ['정부'] },
};

const requestContext: TargetV2RequestContext = {
  requestId: 'a2f1e6c0-8a45-4c47-9e3d-1f2a3b4c5d6e',
  correlationId: 'corr_cc135_test',
  tenantId: 'b3e2f7d1-9b56-4d58-8f4e-2a3b4c5d6e7f',
  userId: 'c4f3a8e2-ac67-4e69-9a5f-3b4c5d6e7f8a',
  planId: 'd5a4b9f3-bd78-4f7a-ab6a-4c5d6e7f8a9b',
  documentId: 'une-mock:document:pending-cc150',
  baseRevisionId: 'une-mock:revision:pending-cc150',
  planContextSnapshotId: 'e6b5caa4-ce89-4a8b-bc7b-5d6e7f8a9b0c',
  contextHash: 'a'.repeat(64),
  requestedAt: '2026-08-02T09:00:00+09:00',
};

const trace = {
  requestId: requestContext.requestId,
  tenantId: requestContext.tenantId,
  userId: requestContext.userId,
  planId: requestContext.planId,
  documentId: requestContext.documentId,
  baseRevisionId: requestContext.baseRevisionId,
  planContextSnapshotId: requestContext.planContextSnapshotId,
  contextHash: requestContext.contextHash,
  requestedAt: requestContext.requestedAt,
};

const ctx: ProviderCallContext = { correlationId: requestContext.correlationId };

const outline: TocNodeDraft[] = [
  {
    nodeKey: 'n-1',
    title: '1. 추진 배경',
    children: [{ nodeKey: 'n-1-1', title: '1-1. 현황', children: [] }],
  },
  { nodeKey: 'n-2', title: '2. 세부 추진계획', children: [] },
];

function makeAdapter(transport = new MockTargetV2Transport()): TargetV2T3qPlanAdapter {
  return new TargetV2T3qPlanAdapter({ transport, sleep: async () => {} });
}

describe('contentV2 (CR-T3Q-002)', () => {
  it('completes 202→poll→COMPLETED and maps blocks onto a tree parallel to the outline', async () => {
    const adapter = makeAdapter();
    const result = await adapter.generateContent({ planContext, outline, trace }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operation).toBe('content');
    expect(result.data.failedNodeKeys).toEqual([]);
    const [first, second] = result.data.sections;
    expect(first.nodeKey).toBe('n-1');
    expect(first.children[0]?.nodeKey).toBe('n-1-1');
    expect(second.nodeKey).toBe('n-2');
    // level-1 sections join two blocks (PARAGRAPH+BULLET) — ADR-28 D7
    expect(first.text.split('\n')).toHaveLength(2);
    // v2 provenance slots are FILLED (ADR-26 D4)
    const citation = first.citations[0];
    expect(citation).toBeDefined();
    expect(citation.sourceId).toMatch(/^src-/);
    expect(citation.documentId).toBeTruthy();
    expect(citation.chunkId).toMatch(/^chunk-\d{4}-\d{2}$/);
    expect(citation.score).toBeGreaterThan(0);
    expect(citation.retrievedAt).toBe(requestContext.requestedAt);
    // last targeted section deterministically carries no evidence
    expect(second.citations).toEqual([]);
    // raw payloads travel with the result (traceability rule)
    expect(result.rawRequest).toMatchObject({ generationScope: 'ALL' });
    expect(result.rawResponse).toMatchObject({ status: { status: 'COMPLETED' } });
  });

  it('is idempotent per requestId: resubmission joins the same generation (AT-T3Q-001)', async () => {
    const transport = new MockTargetV2Transport();
    const adapter = makeAdapter(transport);
    const first = await adapter.generateContent({ planContext, outline, trace }, ctx);
    const second = await adapter.generateContent({ planContext, outline, trace }, ctx);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const firstId = (first.rawResponse as { accepted: { generationId: string } }).accepted;
    const secondId = (second.rawResponse as { accepted: { generationId: string } }).accepted;
    expect(secondId.generationId).toBe(firstId.generationId);
    expect(first.data.sections).toEqual(second.data.sections); // deterministic bytes
  });

  it('scoped regeneration sends generationScope SECTIONS and only fabricates the targets', async () => {
    const adapter = makeAdapter();
    const result = await adapter.generateContent(
      { planContext, outline, targetNodeKeys: ['n-2'], protectedBlockKeys: ['une-blk-1'], trace },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rawRequest).toMatchObject({
      generationScope: 'SECTIONS',
      targetSectionIds: ['n-2'],
      protectedBlockIds: ['une-blk-1'],
    });
    const [first, second] = result.data.sections;
    expect(first.text).toBe(''); // untargeted nodes stay empty in the parallel tree
    expect(second.text).not.toBe('');
  });

  it('unknown targetNodeKeys fail as a UNE request defect before the wire', async () => {
    const adapter = makeAdapter();
    const result = await adapter.generateContent(
      { planContext, outline, targetNodeKeys: ['ghost'], trace },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('T3Q_REQUEST_REJECTED');
  });

  it('passes through PARTIAL (non-terminal, ADR-28 D4) and surfaces failedNodeKeys on COMPLETED', async () => {
    const transport = new MockTargetV2Transport({ failSectionIds: ['n-2'] });
    const adapter = makeAdapter(transport);
    const result = await adapter.generateContent({ planContext, outline, trace }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.failedNodeKeys).toEqual(['n-2']);
    const failedSection = result.data.sections[1];
    expect(failedSection.nodeKey).toBe('n-2');
    expect(failedSection.text).toBe('');
    expect(result.rawResponse).toMatchObject({
      status: { status: 'COMPLETED', failedTargetIds: ['n-2'] },
    });
  });

  it('fails as T3Q_PROVIDER_ERROR when every target fails', async () => {
    const transport = new MockTargetV2Transport({ failSectionIds: ['n-1', 'n-1-1', 'n-2'] });
    const adapter = makeAdapter(transport);
    const result = await adapter.generateContent({ planContext, outline, trace }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('T3Q_PROVIDER_ERROR');
      expect(result.error.retryable).toBe(true);
    }
  });
});

describe('job lifecycle (CR-T3Q-003) — cancel/retry/SSE/status under the jobStatus op', () => {
  async function completedContentJob(transport: MockTargetV2Transport) {
    const adapter = makeAdapter(transport);
    const result = await adapter.generateContent({ planContext, outline, trace }, ctx);
    expect(result.ok).toBe(true);
    const accepted = (result as { rawResponse: { accepted: { generationId: string } } }).rawResponse
      .accepted;
    return { adapter, jobRef: accepted.generationId };
  }

  it('cancels a non-terminal job, freezing progress (AT-T3Q-006)', async () => {
    const transport = new MockTargetV2Transport({ runningPolls: 5 });
    const adapter = makeAdapter(transport);
    // submit directly so the job is still RUNNING when cancel arrives
    const raw = toContentGenerationRequest(planContext, outline, requestContext);
    const accepted = (await transport.submitContent(raw)) as { generationId: string };
    await adapter.getJobStatus(accepted.generationId, ctx); // one RUNNING poll
    const cancelled = await adapter.cancelJob(accepted.generationId, '범위 변경', ctx);
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) {
      expect(cancelled.data.status).toBe('CANCELLED');
      expect(cancelled.operation).toBe('jobStatus');
    }
    // cancel is not repeatable — the second attempt is a 409 conflict
    const again = await adapter.cancelJob(accepted.generationId, undefined, ctx);
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.error.code).toBe('T3Q_CONFLICT');
      expect(again.error.httpStatus).toBe(409);
    }
  });

  it('rejects cancel on a terminal job with T3Q_CONFLICT', async () => {
    const { adapter, jobRef } = await completedContentJob(new MockTargetV2Transport());
    const result = await adapter.cancelJob(jobRef, undefined, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('T3Q_CONFLICT');
  });

  it('partial-retries ONLY failed targets as a NEW generation (AT-T3Q-003/007)', async () => {
    const transport = new MockTargetV2Transport({ failSectionIds: ['n-2'] });
    const { adapter, jobRef } = await completedContentJob(transport);
    const retried = await adapter.retryJobTargets(
      jobRef,
      { targetType: 'SECTION', targetIds: ['n-2'] },
      ctx,
    );
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.data.jobRef).not.toBe(jobRef); // new generationId
    // the retried job succeeds and produces ONLY the retried section
    let status = await adapter.getJobStatus(retried.data.jobRef, ctx);
    for (let i = 0; i < 5 && status.ok && status.data.status !== 'COMPLETED'; i += 1) {
      status = await adapter.getJobStatus(retried.data.jobRef, ctx);
    }
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.data.status).toBe('COMPLETED');
      expect(status.data.completedTargetIds).toEqual(['n-2']);
      expect(status.data.failedTargetIds).toEqual([]);
    }
  });

  it('rejects retry of targets that did NOT fail (silent regeneration ban)', async () => {
    const transport = new MockTargetV2Transport({ failSectionIds: ['n-2'] });
    const { adapter, jobRef } = await completedContentJob(transport);
    const result = await adapter.retryJobTargets(
      jobRef,
      { targetType: 'SECTION', targetIds: ['n-1'] },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('T3Q_CONFLICT');
  });

  it('streams frames job.started→content.block×N→job.completed and resumes via Last-Event-ID without loss or duplication (AT-T3Q-005)', async () => {
    const { adapter, jobRef } = await completedContentJob(new MockTargetV2Transport());
    const full = await adapter.streamJobEvents(jobRef, {}, ctx);
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    const events = full.data.frames.map((frame) => frame.event);
    expect(events[0]).toBe('job.started');
    expect(events[events.length - 1]).toBe('job.completed');
    expect(events.filter((event) => event === 'content.block')).toHaveLength(5);
    const resumeFrom = full.data.frames[2].id;
    const resumed = await adapter.streamJobEvents(jobRef, { lastEventId: resumeFrom }, ctx);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    const expected = full.data.frames.filter((frame) => frame.id > resumeFrom);
    expect(resumed.data.frames).toEqual(expected);
  });

  it('a stream that ends without a terminal event is MALFORMED, not a partial result', async () => {
    const transport = new MockTargetV2Transport();
    const { jobRef } = await completedContentJob(transport);
    const truncating: typeof transport.streamEvents = async (...args) => {
      const raw = (await transport.streamEvents(...args)) as string;
      return raw.slice(0, raw.lastIndexOf('id:')); // drop the terminal record
    };
    const patched = makeAdapter(
      new Proxy(transport, {
        get: (target, prop, receiver) =>
          prop === 'streamEvents' ? truncating : Reflect.get(target, prop, receiver),
      }),
    );
    const result = await patched.streamJobEvents(jobRef, {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('T3Q_MALFORMED_RESPONSE');
  });

  it('emits job.warning and terminal failedTargetIds for partial failure streams', async () => {
    const transport = new MockTargetV2Transport({ failSectionIds: ['n-2'] });
    const { adapter, jobRef } = await completedContentJob(transport);
    const result = await adapter.streamJobEvents(jobRef, {}, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.data.frames.find((frame) => frame.event === 'job.warning');
    expect(warning?.data.failedTargetIds).toEqual(['n-2']);
    const terminal = result.data.frames[result.data.frames.length - 1];
    expect(terminal.event).toBe('job.completed');
    expect(terminal.data.failedTargetIds).toEqual(['n-2']);
  });
});

describe('semantic edit (CR-T3Q-004)', () => {
  const baseEdit: T3qSemanticEditRequest = {
    planContext,
    target: { targetType: 'BLOCK', nodeKey: 'n-2', blockKey: 'blk-target-1' },
    instruction: '문장을 개조식으로 다듬을 것',
    selectedText: '무더위쉼터를 확대 운영한다.',
    preserveCitationIds: ['cit-keep-1'],
    protectedBlockKeys: ['blk-protected-9'],
    trace,
  };

  it('returns a deterministic proposal per targetType with all four operation kinds reachable', async () => {
    const adapter = makeAdapter();
    const block = await adapter.requestSemanticEdit(baseEdit, ctx);
    expect(block.ok).toBe(true);
    if (block.ok) {
      expect(block.operation).toBe('semanticEdit');
      expect(block.data.operations.map((operation) => operation.operationType)).toEqual([
        'REPLACE_BLOCK',
      ]);
      expect(block.data.baseRevisionKey).toBe(requestContext.baseRevisionId);
      // preserved citations survive into the proposal (mapper carries them)
      expect(block.data.citations.map((citation) => citation.sourceRef)).toContain('cit-keep-1');
    }
    const range = await adapter.requestSemanticEdit(
      {
        ...baseEdit,
        target: { targetType: 'RANGE', blockKey: 'blk-target-1', range: { start: 0, end: 12 } },
      },
      ctx,
    );
    expect(range.ok).toBe(true);
    if (range.ok) {
      expect(range.data.operations[0].operationType).toBe('REPLACE_RANGE');
    }
    const section = await adapter.requestSemanticEdit(
      { ...baseEdit, target: { targetType: 'SECTION', nodeKey: 'n-2' } },
      ctx,
    );
    expect(section.ok).toBe(true);
    if (section.ok) {
      expect(section.data.operations.map((operation) => operation.operationType)).toEqual([
        'REPLACE_BLOCK',
        'INSERT_BLOCK',
        'DELETE_BLOCK',
      ]);
      expect(section.data.proposedBlocks.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('rejects editing a protected block BEFORE anything leaves the port', async () => {
    const adapter = makeAdapter();
    const result = await adapter.requestSemanticEdit(
      { ...baseEdit, target: { targetType: 'BLOCK', blockKey: 'blk-protected-9' } },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('T3Q_REQUEST_REJECTED');
      expect(result.error.message).toContain('protected');
    }
  });

  it('quarantines a response whose proposal touches a protected block (ADR-28 D8 mechanism)', async () => {
    const transport = new MockTargetV2Transport();
    const violating: typeof transport.requestSemanticEdit = async (request) => {
      const proposal = buildMockChangeProposal(request as SemanticEditRequestV2);
      proposal.operations[0] = {
        operationType: 'REPLACE_BLOCK',
        targetId: 'blk-protected-9',
        payload: { text: '보호 블록 무단 수정' },
      };
      return proposal;
    };
    const adapter = makeAdapter(
      new Proxy(transport, {
        get: (target, prop, receiver) =>
          prop === 'requestSemanticEdit' ? violating : Reflect.get(target, prop, receiver),
      }),
    );
    const result = await adapter.requestSemanticEdit(baseEdit, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('T3Q_RESPONSE_CONTRACT_VIOLATION');
      expect(result.error.message).toContain('blk-protected-9');
      expect(result.rawResponse).toBeDefined(); // raw preserved for the trace
    }
  });

  it('maps a stale baseRevision scenario to T3Q_CONFLICT (AT-T3Q-008 준비)', async () => {
    const transport = new MockTargetV2Transport({
      editConflictBaseRevisionIds: [requestContext.baseRevisionId],
    });
    const adapter = makeAdapter(transport);
    const result = await adapter.requestSemanticEdit(baseEdit, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('T3Q_CONFLICT');
      expect(result.error.httpStatus).toBe(409);
    }
  });

  it('RANGE targets require a well-formed range (start < end)', () => {
    expect(() =>
      toSemanticEditRequest(
        {
          ...baseEdit,
          target: { targetType: 'RANGE', blockKey: 'b', range: { start: 5, end: 5 } },
        },
        requestContext,
      ),
    ).toThrowError(/start < end/);
  });
});

describe('evidence search (CR-T3Q-005)', () => {
  it('fills every provenance slot with strictly descending scores, capped by topK', async () => {
    const adapter = makeAdapter();
    const result = await adapter.searchEvidence(
      {
        planContext,
        query: '무더위쉼터 운영 기준',
        topK: 3,
        supportsBlockKeys: ['blk-target-1'],
        trace,
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operation).toBe('evidenceSearch');
    expect(result.data.items).toHaveLength(3);
    let previous = 1;
    for (const item of result.data.items) {
      expect(item.sourceId).toBeTruthy();
      expect(item.documentId).toBeTruthy();
      expect(item.chunkId).toMatch(/^chunk-/);
      expect(item.retrievedAt).toBe(requestContext.requestedAt);
      expect(item.supportsBlockKeys).toEqual(['blk-target-1']);
      expect(item.score).toBeLessThan(previous);
      previous = item.score as number;
    }
  });

  it('rejects a requestId echo mismatch as a contract violation', async () => {
    const transport = new MockTargetV2Transport();
    const lying: typeof transport.searchEvidence = async (request) => {
      const raw = (await transport.searchEvidence(request)) as { items: unknown[] };
      return { requestId: 'someone-else', items: raw.items };
    };
    const adapter = makeAdapter(
      new Proxy(transport, {
        get: (target, prop, receiver) =>
          prop === 'searchEvidence' ? lying : Reflect.get(target, prop, receiver),
      }),
    );
    const result = await adapter.searchEvidence({ planContext, query: 'q', topK: 1, trace }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('T3Q_RESPONSE_CONTRACT_VIOLATION');
  });
});

describe('validation (CR-T3Q-006 — MOCK_ONLY verdict, ADR-28 D9)', () => {
  const provenancedCitation = {
    sourceRef: 'cit-1',
    fileName: 'ref.pdf',
    page: '12',
    excerpt: '발췌',
    sourceId: 'src-1',
    documentId: 'doc-1',
    chunkId: 'chunk-0012-01',
    score: 0.9,
    retrievedAt: requestContext.requestedAt,
  };

  const validationRequest: T3qValidationRequest = {
    planContext,
    validationTypes: ['SCHEMA', 'CITATION_COVERAGE', 'MISSING_REQUIRED_SECTION'],
    outline: [
      {
        nodeKey: 'n-1',
        title: '1. 추진 배경',
        generationPolicy: { required: true },
        children: [],
      },
      {
        nodeKey: 'n-2',
        title: '2. 세부 추진계획',
        generationPolicy: { required: true },
        children: [],
      },
    ],
    blocks: [
      {
        blockKey: 'blk-1',
        nodeKey: 'n-1',
        order: 0,
        text: '무더위쉼터 1,240개소를 운영한다.',
        citations: [provenancedCitation],
      },
      { blockKey: 'blk-2', nodeKey: 'n-1', order: 1, text: '인용 없는 블록.', citations: [] },
    ],
    trace,
  };

  it('reports deterministic issues sorted by (type, section, block); ERROR flips valid=false', async () => {
    const adapter = makeAdapter();
    const first = await adapter.validateContent(validationRequest, ctx);
    const second = await adapter.validateContent(validationRequest, ctx);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.data).toEqual(second.data); // 결정성
    expect(first.data.valid).toBe(false); // n-2 required section has no blocks
    const kinds = first.data.issues.map((issue) => `${issue.severity}:${issue.type}`);
    expect(kinds).toContain('ERROR:MISSING_REQUIRED_SECTION');
    expect(kinds).toContain('WARNING:CITATION_COVERAGE');
    const sorted = [...first.data.issues].sort((a, b) => a.type.localeCompare(b.type));
    expect(first.data.issues.map((issue) => issue.type)).toEqual(sorted.map((issue) => issue.type));
    for (const issue of first.data.issues) expect(issue.issueKey).toMatch(/^iss-/);
  });

  it('blockType pass-through makes the bullet-symbol EXPRESSION_RULE check reachable via the adapter (contract-test finding)', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validateContent(
      {
        planContext: { ...planContext, expressionRule: { tone: '개조식', paragraphSymbol: '□' } },
        validationTypes: ['EXPRESSION_RULE'],
        outline: [{ nodeKey: 'n-1', title: '1. 추진 배경', children: [] }],
        blocks: [
          {
            blockKey: 'blk-bullet',
            nodeKey: 'n-1',
            order: 0,
            text: '기호 없이 시작하는 개조식 문장',
            citations: [],
            blockType: 'BULLET',
          },
        ],
        trace,
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.data.issues.some(
          (issue) => issue.type === 'EXPRESSION_RULE' && issue.message.includes('□'),
        ),
      ).toBe(true);
    }
  });

  it('fail-closes on citations without v2 provenance (legacy citations cannot ride v2 — OB-11)', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validateContent(
      {
        ...validationRequest,
        blocks: [
          {
            blockKey: 'blk-legacy',
            nodeKey: 'n-1',
            order: 0,
            text: 'legacy 인용 블록',
            citations: [{ sourceRef: 'r1', fileName: 'f.pdf', page: null }],
          },
        ],
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('T3Q_REQUEST_REJECTED');
      expect(result.error.message).toContain('provenance');
    }
  });
});

describe('review regressions (CC-135 dual review)', () => {
  it('M-2: observed block omissions survive a lying COMPLETED+failedTargetIds:[] self-report', async () => {
    const transport = new MockTargetV2Transport();
    const lying: typeof transport.getStatus = async (generationId) => {
      const raw = (await transport.getStatus(generationId)) as Record<string, unknown>;
      if (raw.status !== 'COMPLETED') return raw;
      const blocks = (raw.blocks as { sectionId: string }[]).filter(
        (block) => block.sectionId !== 'n-2',
      );
      return { ...raw, blocks, failedTargetIds: [] }; // self-report hides the omission
    };
    const adapter = makeAdapter(
      new Proxy(transport, {
        get: (target, prop, receiver) =>
          prop === 'getStatus' ? lying : Reflect.get(target, prop, receiver),
      }),
    );
    const result = await adapter.generateContent({ planContext, outline, trace }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.failedNodeKeys).toEqual(['n-2']);
  });

  it('F-3: resume past the terminal event is an EMPTY-FRAMES SUCCESS, never a retryable error', async () => {
    const transport = new MockTargetV2Transport();
    const adapter = makeAdapter(transport);
    const done = await adapter.generateContent({ planContext, outline, trace }, ctx);
    expect(done.ok).toBe(true);
    const jobRef = (done as { rawResponse: { accepted: { generationId: string } } }).rawResponse
      .accepted.generationId;
    const full = await adapter.streamJobEvents(jobRef, {}, ctx);
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    const terminalId = full.data.frames[full.data.frames.length - 1].id;
    for (const lastEventId of [terminalId, terminalId + 99]) {
      const resumed = await adapter.streamJobEvents(jobRef, { lastEventId }, ctx);
      expect(resumed.ok).toBe(true);
      if (resumed.ok) expect(resumed.data.frames).toEqual([]);
    }
  });

  it('F-3: a stream empty WITHOUT a resume point is malformed and NOT retryable', async () => {
    const transport = new MockTargetV2Transport();
    const { jobRef } = await (async () => {
      const adapter = makeAdapter(transport);
      const done = await adapter.generateContent({ planContext, outline, trace }, ctx);
      return {
        jobRef: (done as { rawResponse: { accepted: { generationId: string } } }).rawResponse
          .accepted.generationId,
      };
    })();
    const empty: typeof transport.streamEvents = async () => '';
    const adapter = makeAdapter(
      new Proxy(transport, {
        get: (target, prop, receiver) =>
          prop === 'streamEvents' ? empty : Reflect.get(target, prop, receiver),
      }),
    );
    const result = await adapter.streamJobEvents(jobRef, {}, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('T3Q_MALFORMED_RESPONSE');
      expect(result.error.retryable).toBe(false);
    }
  });

  it('G-1: getJobStatus after cancel stays frozen across repeated polls', async () => {
    const transport = new MockTargetV2Transport({ runningPolls: 5 });
    const adapter = makeAdapter(transport);
    const raw = toContentGenerationRequest(planContext, outline, requestContext);
    const accepted = (await transport.submitContent(raw)) as { generationId: string };
    await adapter.getJobStatus(accepted.generationId, ctx);
    const cancelled = await adapter.cancelJob(accepted.generationId, undefined, ctx);
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    for (let i = 0; i < 3; i += 1) {
      const status = await adapter.getJobStatus(accepted.generationId, ctx);
      expect(status.ok).toBe(true);
      if (status.ok) {
        expect(status.data.status).toBe('CANCELLED');
        expect(status.data.progress).toBe(cancelled.data.progress);
        expect(status.data.completedTargetIds).toEqual(cancelled.data.completedTargetIds);
      }
    }
  });

  it('G-2: retrying the same jobRef+targetIds is idempotent (same child generation)', async () => {
    const transport = new MockTargetV2Transport({ failSectionIds: ['n-2'] });
    const adapter = makeAdapter(transport);
    const done = await adapter.generateContent({ planContext, outline, trace }, ctx);
    expect(done.ok).toBe(true);
    const jobRef = (done as { rawResponse: { accepted: { generationId: string } } }).rawResponse
      .accepted.generationId;
    const first = await adapter.retryJobTargets(
      jobRef,
      { targetType: 'SECTION', targetIds: ['n-2'] },
      ctx,
    );
    const second = await adapter.retryJobTargets(
      jobRef,
      { targetType: 'SECTION', targetIds: ['n-2'] },
      ctx,
    );
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.data.jobRef).toBe(first.data.jobRef);
  });

  it('G-8: empty retry targetIds are rejected at the port, before the wire', async () => {
    const adapter = makeAdapter();
    const result = await adapter.retryJobTargets(
      'gen-anything',
      { targetType: 'SECTION', targetIds: [] },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('T3Q_REQUEST_REJECTED');
  });

  it('m-1: BLOCK-grained retry is honestly 422 not-mocked, not a disguised conflict', async () => {
    const transport = new MockTargetV2Transport({ failSectionIds: ['n-2'] });
    const adapter = makeAdapter(transport);
    const done = await adapter.generateContent({ planContext, outline, trace }, ctx);
    const jobRef = (done as { rawResponse: { accepted: { generationId: string } } }).rawResponse
      .accepted.generationId;
    const result = await adapter.retryJobTargets(
      jobRef,
      { targetType: 'BLOCK', targetIds: ['blk-x'] },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('T3Q_REQUEST_REJECTED');
      expect(result.error.httpStatus).toBe(422);
      expect(result.error.message).toContain('not mocked');
    }
  });

  it('m-5: a protected id hidden in an operation payload still quarantines the proposal', async () => {
    const transport = new MockTargetV2Transport();
    const hiding: typeof transport.requestSemanticEdit = async (request) => {
      const proposal = buildMockChangeProposal(request as SemanticEditRequestV2);
      proposal.operations.push({
        operationType: 'INSERT_BLOCK',
        targetId: null,
        payload: { afterBlockId: 'blk-protected-9', text: '보호 블록 뒤 삽입' },
      });
      return proposal;
    };
    const adapter = makeAdapter(
      new Proxy(transport, {
        get: (target, prop, receiver) =>
          prop === 'requestSemanticEdit' ? hiding : Reflect.get(target, prop, receiver),
      }),
    );
    const result = await adapter.requestSemanticEdit(
      {
        planContext,
        target: { targetType: 'BLOCK', blockKey: 'blk-target-1' },
        instruction: '다듬기',
        protectedBlockKeys: ['blk-protected-9'],
        trace,
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('T3Q_RESPONSE_CONTRACT_VIOLATION');
      expect(result.error.message).toContain('blk-protected-9');
    }
  });

  it('m-6: reusing a requestId with a different payload is a 409, not a silent join', async () => {
    const adapter = makeAdapter();
    const first = await adapter.generateContent({ planContext, outline, trace }, ctx);
    expect(first.ok).toBe(true);
    const mutated = await adapter.generateContent(
      { planContext: { ...planContext, subject: '다른 주제' }, outline, trace },
      ctx,
    );
    expect(mutated.ok).toBe(false);
    if (!mutated.ok) {
      expect(mutated.error.code).toBe('T3Q_CONFLICT');
      expect(mutated.error.message).toContain('멱등키');
    }
  });

  it('m-8/F-4: a live transport is refused at construction without explicit opt-in', () => {
    const live = { submitToc: async () => ({}) } as unknown as MockTargetV2Transport;
    expect(() => new TargetV2T3qPlanAdapter({ transport: live })).toThrowError(
      /allowLiveTransport/,
    );
  });

  it('G-3: every trace-carrying op fail-closes on une-mock: placeholders over a live transport', async () => {
    const reject = async (): Promise<unknown> => {
      throw new Error('LIVE WIRE REACHED');
    };
    const liveTransport = {
      submitToc: reject,
      submitContent: reject,
      getStatus: reject,
      streamEvents: reject,
      cancelJob: reject,
      retryJobTargets: reject,
      requestSemanticEdit: reject,
      searchEvidence: reject,
      validateContent: reject,
      getCapabilities: reject,
    };
    const adapter = new TargetV2T3qPlanAdapter({
      transport: liveTransport,
      allowLiveTransport: true,
      sleep: async () => {},
    });
    const calls: Promise<{ ok: boolean; error?: { code: string; message: string } }>[] = [
      adapter.generateContent({ planContext, outline, trace }, ctx),
      adapter.requestSemanticEdit(
        { planContext, target: { targetType: 'BLOCK', blockKey: 'b' }, instruction: 'x', trace },
        ctx,
      ),
      adapter.searchEvidence({ planContext, query: 'q', topK: 1, trace }, ctx),
      adapter.validateContent(
        { planContext, validationTypes: ['SCHEMA'], outline, blocks: [], trace },
        ctx,
      ),
    ];
    for (const result of await Promise.all(calls)) {
      expect(result.ok).toBe(false);
      if (!result.ok && result.error) {
        expect(result.error.code).toBe('T3Q_REQUEST_REJECTED');
        expect(result.error.message).toContain('une-mock:');
      }
    }
  });
});

describe('capabilities discovery (CR-T3Q-009)', () => {
  it('returns the canonical UNE mock build — never mistakable for a T3Q build (ADR-28 D11)', async () => {
    const adapter = makeAdapter();
    const result = await adapter.discoverCapabilities(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.providerBuild).toBe(MOCK_TARGET_V2_PROVIDER_BUILD);
    expect(result.data.providerBuild.startsWith('une-mock-')).toBe(true);
    expect(result.data.features).toEqual(MOCK_TARGET_V2_CAPABILITIES.features);
    expect(result.data.features.referenceUpload).toBe(false); // CR-T3Q-007 CONDITIONAL, no mock
    expect(result.data.contractVersions).toEqual(['2.0']);
  });
});
