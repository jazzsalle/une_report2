import { describe, expect, it } from 'vitest';
import { validateTocTree } from '@une/domain';
import { MockTargetV2Transport } from './mock-target-v2-transport';
import { TargetV2T3qPlanAdapter } from './target-v2-t3q-plan-adapter';
import {
  TargetV2MappingError,
  fromOutlineSections,
  toTocGenerationRequest,
  type TargetV2RequestContext,
} from './target-v2-toc-mapper';

const planContext = {
  subject: '2026년 폭염 대비 안전관리 계획',
  backgroundInfo: { disasterType: '폭염', controlPhase: '대비', location: null },
  contentInstruction: { essentialFactors: ['무더위쉼터 운영', '취약계층 보호 대책'] },
  expressionRule: { tone: '개조식' },
  purposeOfDocument: { goalOfBusiness: '피해 최소화', role: '담당자', targetAudiences: ['정부'] },
};

const requestContext: TargetV2RequestContext = {
  requestId: 'a2f1e6c0-8a45-4c47-9e3d-1f2a3b4c5d6e',
  correlationId: 'corr_v2_test',
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

const ctx = { correlationId: requestContext.correlationId };

describe('toTocGenerationRequest', () => {
  it('fills every PlanRequestBase binding with constants injected per the gap matrix', () => {
    const request = toTocGenerationRequest(planContext, requestContext);
    expect(request.schemaVersion).toBe('2.0');
    expect(request.expressionRule.scope).toBe('body_only');
    expect(request.expressionRule.tone).toBe('개조식');
    expect(request.clientContext).toEqual({
      tenantId: requestContext.tenantId,
      userId: requestContext.userId,
      locale: 'ko-KR',
      timezone: 'Asia/Seoul',
    });
    // null values are omitted from open objects.
    expect('location' in request.backgroundInfo).toBe(false);
    // The legacy systemPrompt full text is never sent in v2.
    expect('systemPrompt' in request).toBe(false);
    expect('systemPromptVersion' in request).toBe(false);
  });

  it('fail-closed on missing bindings — nothing is invented', () => {
    expect(() =>
      toTocGenerationRequest(planContext, { ...requestContext, documentId: '' }),
    ).toThrow(TargetV2MappingError);
    expect(() => toTocGenerationRequest({ ...planContext, subject: ' ' }, requestContext)).toThrow(
      /subject/,
    );
  });
});

describe('fromOutlineSections', () => {
  it('rebuilds the tree from parentSectionId/order and keeps sectionId as nodeKey', () => {
    const tree = fromOutlineSections([
      {
        sectionId: 's-2',
        parentSectionId: null,
        outlineLevel: 1,
        order: 2,
        title: 'B',
        semanticRole: 'ACTION_PLAN',
        generationPolicy: 'GENERATE',
        required: false,
      },
      {
        sectionId: 's-1',
        parentSectionId: null,
        outlineLevel: 1,
        order: 1,
        title: 'A',
        semanticRole: 'BACKGROUND',
        generationPolicy: 'GENERATE',
        required: true,
      },
      {
        sectionId: 's-1-1',
        parentSectionId: 's-1',
        outlineLevel: 2,
        order: 3,
        title: 'A1',
        semanticRole: 'BACKGROUND',
        generationPolicy: 'PRESERVE',
        required: false,
      },
    ]);
    expect(tree.map((n) => n.nodeKey)).toEqual(['s-1', 's-2']);
    expect(tree[0].children?.[0]).toMatchObject({ nodeKey: 's-1-1', title: 'A1' });
    expect(tree[0].children?.[0].generationPolicy).toMatchObject({ generationPolicy: 'PRESERVE' });
  });

  it('rejects duplicate and dangling section ids', () => {
    const base = {
      parentSectionId: null,
      outlineLevel: 1,
      order: 1,
      title: 'x',
      semanticRole: 'BACKGROUND',
      generationPolicy: 'GENERATE' as const,
      required: false,
    };
    expect(() =>
      fromOutlineSections([
        { ...base, sectionId: 's-1' },
        { ...base, sectionId: 's-1', order: 2 },
      ]),
    ).toThrow(/duplicate/);
    expect(() =>
      fromOutlineSections([{ ...base, sectionId: 's-1', parentSectionId: 'ghost' }]),
    ).toThrow(/unknown parentSectionId/);
  });
});

describe('TargetV2T3qPlanAdapter (202 → poll → COMPLETED against the in-process mock)', () => {
  const makeAdapter = (): TargetV2T3qPlanAdapter =>
    new TargetV2T3qPlanAdapter({ transport: new MockTargetV2Transport(), sleep: async () => {} });

  it('completes the async job flow and returns a canonical tree', async () => {
    const result = await makeAdapter().generateToc({ planContext, trace }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(validateTocTree(result.data.tree)).toEqual([]);
      expect(result.data.tree.every((node) => node.nodeKey?.startsWith('s-'))).toBe(true);
      expect(result.mappingVersion).toBe('v2-1.0.1-request@1');
      // Raw trace carries the full job round trip (accepted + final status).
      expect(result.rawResponse).toMatchObject({
        accepted: { status: 'QUEUED' },
        status: { status: 'COMPLETED', progress: 100 },
      });
    }
  });

  it('is deterministic across adapters (3 runs, fresh transports)', async () => {
    const runs = await Promise.all(
      [1, 2, 3].map(() => makeAdapter().generateToc({ planContext, trace }, ctx)),
    );
    expect(runs.every((r) => r.ok)).toBe(true);
    if (runs[0].ok && runs[1].ok && runs[2].ok) {
      expect(runs[1].data.tree).toEqual(runs[0].data.tree);
      expect(runs[2].data.tree).toEqual(runs[0].data.tree);
    }
  });

  it('produces a tree structurally equivalent to the legacy mock for the same PlanContext', async () => {
    const { MockLegacyT3qPlanAdapter } = await import('./mock-legacy-t3q-plan-adapter');
    const v2 = await makeAdapter().generateToc({ planContext, trace }, ctx);
    const legacy = await new MockLegacyT3qPlanAdapter().generateToc({ planContext }, ctx);
    expect(v2.ok && legacy.ok).toBe(true);
    if (v2.ok && legacy.ok) {
      const shape = (nodes: readonly { title: string; children?: unknown[] }[]): unknown =>
        nodes.map((n) => ({ title: n.title, children: shape((n.children ?? []) as never) }));
      expect(shape(v2.data.tree)).toEqual(shape(legacy.data.tree));
    }
  });

  it('missing bindings become a T3Q_REQUEST_REJECTED result, not a throw', async () => {
    const result = await makeAdapter().generateToc({ planContext }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('T3Q_REQUEST_REJECTED');
      expect(result.error.retryable).toBe(false);
    }
  });

  it('poll exhaustion returns T3Q_TIMEOUT with the last raw status', async () => {
    const adapter = new TargetV2T3qPlanAdapter({
      transport: new MockTargetV2Transport(99),
      sleep: async () => {},
      maxPolls: 2,
    });
    const result = await adapter.generateToc({ planContext, trace }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('T3Q_TIMEOUT');
      expect(result.error.retryable).toBe(true);
      expect(result.rawResponse).toMatchObject({ status: { status: 'RUNNING' } });
    }
  });

  it('supports toc only; capability stays MOCK_ONLY (OB-10 unaccepted contract)', () => {
    const adapter = makeAdapter();
    expect(adapter.supports('toc')).toBe(true);
    expect(adapter.supports('content')).toBe(false);
    expect(adapter.supports('semanticEdit')).toBe(false);
    expect(adapter.capabilityFor('toc')?.state).toBe('MOCK_ONLY');
    expect(adapter.runtimeMode).toBe('mock');
  });

  it('a LIVE transport rejects une-mock: placeholders fail-closed (review M2)', async () => {
    // Not the mock transport → runtimeMode 'live'. The placeholder must be
    // stopped by a MECHANISM, not by the absence of a real transport.
    const liveTransport = {
      submitToc: async (): Promise<unknown> => {
        throw new Error('must never be called with placeholders');
      },
      getStatus: async (): Promise<unknown> => {
        throw new Error('unreachable');
      },
    };
    const adapter = new TargetV2T3qPlanAdapter({ transport: liveTransport, sleep: async () => {} });
    expect(adapter.runtimeMode).toBe('live');
    const result = await adapter.generateToc({ planContext, trace }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('T3Q_REQUEST_REJECTED');
      expect(result.error.message).toContain('une-mock:');
    }
  });

  it('a LIVE transport without placeholders still fail-closes on the missing bindings', async () => {
    const liveTransport = {
      submitToc: async (): Promise<unknown> => {
        throw new Error('must not reach the wire without real bindings');
      },
      getStatus: async (): Promise<unknown> => {
        throw new Error('unreachable');
      },
    };
    const adapter = new TargetV2T3qPlanAdapter({ transport: liveTransport, sleep: async () => {} });
    const { documentId: _d, baseRevisionId: _b, ...withoutPlaceholders } = trace;
    const result = await adapter.generateToc({ planContext, trace: withoutPlaceholders }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('T3Q_REQUEST_REJECTED');
  });
});
