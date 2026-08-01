import type { FlatTocNode } from '@une/domain';
import { describe, expect, it, vi } from 'vitest';
import type { AuditEntry, AuditRepository } from '../common/audit.repository';
import type { AuthContext } from '../common/request-context';
import type { DatabaseService } from '../db/database.service';
import type { GenerationJobRepository } from './generation-job.repository';
import type { PlanRepository, PlanRow } from './plan.repository';
import type { RequestMeta } from './plan.service';
import type {
  TocNodeRow,
  TocVersionInsert,
  TocVersionRepository,
  TocVersionRow,
} from './toc-version.repository';
import { assembleTocTree, TocVersionService, type TocTreeNodeInput } from './toc-version.service';

const TENANT_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_ID = '44444444-4444-4444-4444-444444444444';
const SNAPSHOT_ID = '55555555-5555-5555-5555-555555555555';
const BASE_VERSION_ID = '77777777-7777-7777-7777-777777777777';
const NEW_VERSION_ID = '88888888-8888-8888-8888-888888888888';

const auth: AuthContext = { userId: USER_ID, tenantId: TENANT_ID, sessionId: USER_ID };
const meta: RequestMeta = { correlationId: 'corr_test' };

function planRow(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    planId: PLAN_ID,
    tenantId: TENANT_ID,
    title: '계획서',
    hazardType: '호우',
    managementPhase: '예방',
    status: 'OUTLINE_REVIEW',
    startMode: 'BLANK',
    documentId: null,
    currentContextSnapshotId: SNAPSHOT_ID,
    currentTocVersionId: BASE_VERSION_ID,
    ownerId: USER_ID,
    versionNo: 3,
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

function versionRow(overrides: Partial<TocVersionRow> = {}): TocVersionRow {
  return {
    tocVersionId: NEW_VERSION_ID,
    planId: PLAN_ID,
    versionNo: 2,
    sourceType: 'USER',
    baseSnapshotId: SNAPSHOT_ID,
    status: 'DRAFT',
    contentHash: 'b'.repeat(64),
    createdBy: USER_ID,
    createdAt: new Date('2026-08-01T01:00:00Z'),
    ...overrides,
  };
}

function harness(overrides: { plan?: PlanRow | null; version?: TocVersionRow | null } = {}) {
  const client = { query: vi.fn(async () => ({ rows: [] })) };
  const db = {
    withTenant: async <T>(_tenantId: string, fn: (c: unknown) => Promise<T>): Promise<T> =>
      fn(client),
  };
  const plans = {
    findPlan: vi.fn(async (..._args: unknown[]) =>
      'plan' in overrides ? overrides.plan : planRow(),
    ),
    setCurrentTocVersion: vi.fn(async (..._args: unknown[]) => planRow()),
  };
  const versions = {
    findVersionMeta: vi.fn(async (..._args: unknown[]) => ({
      tocVersionId: BASE_VERSION_ID,
      planId: PLAN_ID,
      baseSnapshotId: SNAPSHOT_ID,
    })),
    nextVersionNo: vi.fn(async (..._args: unknown[]) => 2),
    insertVersion: vi.fn(async (_c: unknown, input: TocVersionInsert) =>
      versionRow({ status: input.status, contentHash: input.contentHash }),
    ),
    insertNodes: vi.fn(
      async (_c: unknown, _versionId: string, _rows: readonly FlatTocNode[]) =>
        new Map<string, string>(),
    ),
    listNodes: vi.fn(async (..._args: unknown[]): Promise<TocNodeRow[]> => []),
    findVersion: vi.fn(async (..._args: unknown[]) =>
      'version' in overrides ? overrides.version : versionRow(),
    ),
  };
  const audit = {
    insertAudit: vi.fn(async (_c: unknown, _entry: AuditEntry) => undefined),
  };
  const jobs = {
    // No active TOC job by default; the user-edit protection test overrides.
    findActiveTocJob: vi.fn(async () => null as { jobId: string } | null),
  };
  const service = new TocVersionService(
    db as unknown as DatabaseService,
    plans as unknown as PlanRepository,
    versions as unknown as TocVersionRepository,
    jobs as unknown as GenerationJobRepository,
    audit as unknown as AuditRepository,
  );
  return { service, plans, versions, jobs, audit };
}

const TREE = [{ title: '1. 총칙', children: [{ title: '1.1 목적' }] }, { title: '2. 대응' }];

describe('TocVersionService.saveVersion', () => {
  it('creates a DRAFT version, keeps OUTLINE_REVIEW and audits (no confirm)', async () => {
    const h = harness();
    const result = await h.service.saveVersion(
      auth,
      PLAN_ID,
      { baseVersionId: BASE_VERSION_ID, tocTree: TREE, confirm: false },
      meta,
    );
    expect(result).toMatchObject({ tocVersionId: NEW_VERSION_ID, status: 'DRAFT' });
    const insert = h.versions.insertVersion.mock.calls[0][1];
    expect(insert).toMatchObject({
      sourceType: 'USER',
      status: 'DRAFT',
      versionNo: 2,
      // A user edit inherits the base version's snapshot anchor.
      baseSnapshotId: SNAPSHOT_ID,
      createdBy: USER_ID,
    });
    expect(insert.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // Parents precede children so parent_node_id can always be resolved.
    const flat = h.versions.insertNodes.mock.calls[0][2];
    expect(flat.map((row) => [row.title, row.level])).toEqual([
      ['1. 총칙', 1],
      ['1.1 목적', 2],
      ['2. 대응', 1],
    ]);
    // Server-issued keys for user additions live in their own namespace.
    expect(flat.every((row) => row.nodeKey.startsWith('u-'))).toBe(true);
    expect(h.plans.setCurrentTocVersion.mock.calls[0][4]).toBe('OUTLINE_REVIEW');
    expect(h.audit.insertAudit.mock.calls[0][1]).toMatchObject({
      action: 'TOC_VERSION_CREATED',
      resourceType: 'PLAN',
      resourceId: PLAN_ID,
    });
  });

  it('confirms the outline: CONFIRMED version and OUTLINE_CONFIRMED plan', async () => {
    const h = harness();
    const result = await h.service.saveVersion(
      auth,
      PLAN_ID,
      { baseVersionId: BASE_VERSION_ID, tocTree: TREE, confirm: true },
      meta,
    );
    expect(result.status).toBe('CONFIRMED');
    expect(h.plans.setCurrentTocVersion.mock.calls[0][4]).toBe('OUTLINE_CONFIRMED');
    expect(h.audit.insertAudit.mock.calls[0][1].detail).toMatchObject({ confirmed: true });
  });

  it('preserves client-supplied node keys (CC-130 protected-block anchoring)', async () => {
    const h = harness();
    await h.service.saveVersion(
      auth,
      PLAN_ID,
      {
        baseVersionId: BASE_VERSION_ID,
        tocTree: [{ nodeKey: 'n-1', title: '1. 총칙', children: [{ title: '1.1 목적' }] }],
        confirm: false,
      },
      meta,
    );
    const flat = h.versions.insertNodes.mock.calls[0][2];
    expect(flat[0].nodeKey).toBe('n-1');
    expect(flat[1].parentKey).toBe('n-1');
  });

  it.each([
    ['빈 트리', [], 'EMPTY_TREE'],
    ['빈 제목', [{ title: '  ' }], 'EMPTY_TITLE'],
    [
      '중복 nodeKey',
      [
        { nodeKey: 'n-1', title: 'a' },
        { nodeKey: 'n-1', title: 'b' },
      ],
      'DUPLICATE_NODE_KEY',
    ],
  ])('rejects %s with 422 PLAN-422-002', async (_label, tocTree, code) => {
    const h = harness();
    await expect(
      h.service.saveVersion(
        auth,
        PLAN_ID,
        { baseVersionId: BASE_VERSION_ID, tocTree, confirm: false },
        meta,
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: 'PLAN-422-002',
      violations: [expect.objectContaining({ reason: code })],
    });
    expect(h.plans.findPlan).not.toHaveBeenCalled();
  });

  it('rejects a nesting deeper than 6 levels with 422 PLAN-422-002', async () => {
    const h = harness();
    let node: TocTreeNodeInput = { title: 'L7' };
    for (let level = 6; level >= 1; level -= 1) node = { title: `L${level}`, children: [node] };
    await expect(
      h.service.saveVersion(
        auth,
        PLAN_ID,
        { baseVersionId: BASE_VERSION_ID, tocTree: [node], confirm: false },
        meta,
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: 'PLAN-422-002',
      violations: [expect.objectContaining({ reason: 'DEPTH_EXCEEDED' })],
    });
  });

  it('rejects a stale baseVersionId with 409 TOC-409-001 naming the current version', async () => {
    const h = harness();
    await expect(
      h.service.saveVersion(
        auth,
        PLAN_ID,
        { baseVersionId: NEW_VERSION_ID, tocTree: TREE, confirm: false },
        meta,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: 'TOC-409-001',
      recoverable: true,
      userAction: expect.stringContaining(BASE_VERSION_ID),
    });
    expect(h.versions.insertVersion).not.toHaveBeenCalled();
  });

  it('blocks trashed and approval-locked plans with 412 PLAN-412-002', async () => {
    const trashed = harness({ plan: planRow({ deletedAt: new Date() }) });
    await expect(
      trashed.service.saveVersion(
        auth,
        PLAN_ID,
        { baseVersionId: BASE_VERSION_ID, tocTree: TREE, confirm: false },
        meta,
      ),
    ).rejects.toMatchObject({ status: 412, code: 'PLAN-412-002' });
    const approved = harness({ plan: planRow({ status: 'FINAL' }) });
    await expect(
      approved.service.saveVersion(
        auth,
        PLAN_ID,
        { baseVersionId: BASE_VERSION_ID, tocTree: TREE, confirm: false },
        meta,
      ),
    ).rejects.toMatchObject({ status: 412, code: 'PLAN-412-002' });
  });

  it('returns 404 PLAN-4003 for an unknown plan', async () => {
    const h = harness({ plan: null });
    await expect(
      h.service.saveVersion(
        auth,
        PLAN_ID,
        { baseVersionId: BASE_VERSION_ID, tocTree: TREE, confirm: false },
        meta,
      ),
    ).rejects.toMatchObject({ status: 404, code: 'PLAN-4003' });
  });
});

describe('TocVersionService.getVersion', () => {
  it('returns 404 TOC-404-001 for an unknown version', async () => {
    const h = harness({ version: null });
    await expect(h.service.getVersion(auth, PLAN_ID, NEW_VERSION_ID)).rejects.toMatchObject({
      status: 404,
      code: 'TOC-404-001',
    });
  });

  it('rebuilds the nested tree from the flat toc_node rows', async () => {
    const h = harness();
    h.versions.listNodes.mockResolvedValueOnce([
      node('a', null, 'n-2', '2. 대응', 1, 1),
      node('b', null, 'n-1', '1. 총칙', 1, 0),
      node('c', 'b', 'n-1-1', '1.1 목적', 2, 0),
    ]);
    const result = await h.service.getVersion(auth, PLAN_ID, NEW_VERSION_ID);
    expect(result.nodes.map((n) => n.nodeKey)).toEqual(['n-1', 'n-2']);
    expect(result.nodes[0].children.map((n) => n.nodeKey)).toEqual(['n-1-1']);
    expect(result.createdAt).toBe('2026-08-01T01:00:00.000Z');
  });
});

describe('assembleTocTree', () => {
  it('sorts siblings by sort_order at every level', () => {
    const tree = assembleTocTree([
      node('a', null, 'k-b', 'B', 1, 1),
      node('b', null, 'k-a', 'A', 1, 0),
      node('c', 'b', 'k-a-2', 'A2', 2, 1),
      node('d', 'b', 'k-a-1', 'A1', 2, 0),
    ]);
    expect(tree.map((n) => n.nodeKey)).toEqual(['k-a', 'k-b']);
    expect(tree[0].children.map((n) => n.nodeKey)).toEqual(['k-a-1', 'k-a-2']);
  });
});

function node(
  id: string,
  parentId: string | null,
  nodeKey: string,
  title: string,
  level: number,
  sortOrder: number,
): TocNodeRow {
  return {
    tocNodeId: id,
    parentNodeId: parentId,
    nodeKey,
    title,
    level,
    sortOrder,
    generationPolicy: {},
  };
}
