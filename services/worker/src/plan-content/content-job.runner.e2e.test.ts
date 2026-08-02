import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { runner as migrate } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildContentJobRequest,
  canonicalHash,
  flattenTocTree,
  jobIdempotencyKey,
  tocTreeContentHash,
  type TocNodeDraft,
} from '@une/domain';
import {
  MockLegacyT3qPlanAdapter,
  MockTargetV2Transport,
  TargetV2T3qPlanAdapter,
} from '@une/provider-adapters';
import { loadWorkerConfig, type WorkerConfig } from '../config/worker-config';
import { WorkerDatabase } from '../db/worker-database.service';
import { TocJobRunner } from '../plan-toc/toc-job.runner';
import { ContentJobRunner } from './content-job.runner';

/**
 * CC-130 CONTENT job acceptance evidence: full journey, protected blocks,
 * outline-move discard, generation supersede, per-type cancel sweep —
 * against a real migrated scratch database (0017 included). Skipped without
 * DATABASE_URL.
 */
const ADMIN_URL = process.env.DATABASE_URL;
const MIGRATIONS_DIR = resolve(process.cwd(), '..', '..', 'database', 'migrations');

const CONTEXT = {
  subject: '2026년 폭염 대비 안전관리 계획',
  backgroundInfo: { disasterType: '폭염', controlPhase: '대비' },
  contentInstruction: { essentialFactors: ['무더위쉼터 운영'] },
  purposeOfDocument: {
    goalOfBusiness: '폭염 피해 최소화',
    role: '재난안전 담당자',
    targetAudiences: ['중앙정부'],
  },
};

const TREE: TocNodeDraft[] = [
  {
    nodeKey: 'n-1',
    title: 'Ⅰ. 개요',
    children: [{ nodeKey: 'n-1-1', title: '1. 추진 배경', children: [] }],
  },
  { nodeKey: 'n-2', title: 'Ⅱ. 대비 대책', children: [] },
];

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

interface Fixture {
  tenantId: string;
  userId: string;
  planId: string;
  snapshotId: string;
  tocVersionId: string;
}

describe.skipIf(!ADMIN_URL)('CC-130 CONTENT job runner e2e', () => {
  let dbName: string;
  let dbUrl: string;
  let config: WorkerConfig;
  let db: WorkerDatabase;

  const newRunner = (
    adapter: ConstructorParameters<typeof ContentJobRunner>[1] = new MockLegacyT3qPlanAdapter(),
  ): ContentJobRunner => new ContentJobRunner(db, adapter, config);

  const insertFixture = async (c: Client, code: string): Promise<Fixture> => {
    const tenantId = (
      await c.query(
        `INSERT INTO tenant (tenant_code, tenant_name, status) VALUES ($1, $1, 'ACTIVE') RETURNING tenant_id`,
        [code],
      )
    ).rows[0].tenant_id as string;
    const userId = (
      await c.query(
        `INSERT INTO app_user (tenant_id, login_id, display_name, status)
         VALUES ($1, $2, $2, 'ACTIVE') RETURNING user_id`,
        [tenantId, `content-${code}`],
      )
    ).rows[0].user_id as string;
    const planId = (
      await c.query(
        `INSERT INTO plan (tenant_id, title, hazard_type, management_phase, status, owner_id)
         VALUES ($1, $2, '폭염', '대비', 'OUTLINE_CONFIRMED', $3) RETURNING plan_id`,
        [tenantId, `content plan ${code}`, userId],
      )
    ).rows[0].plan_id as string;
    const snapshotId = (
      await c.query(
        `INSERT INTO plan_context_snapshot (plan_id, version_no, context_json, content_hash, confirmed_by)
         VALUES ($1, 1, $2, $3, $4) RETURNING context_snapshot_id`,
        [planId, JSON.stringify(CONTEXT), canonicalHash(CONTEXT), userId],
      )
    ).rows[0].context_snapshot_id as string;
    const tocVersionId = (
      await c.query(
        `INSERT INTO toc_version (plan_id, version_no, source_type, base_snapshot_id, status, content_hash, created_by)
         VALUES ($1, 1, 'AI', $2, 'CONFIRMED', $3, $4) RETURNING toc_version_id`,
        [planId, snapshotId, tocTreeContentHash(TREE), userId],
      )
    ).rows[0].toc_version_id as string;
    const idsByKey = new Map<string, string>();
    for (const node of flattenTocTree(TREE)) {
      const parentId = node.parentKey ? idsByKey.get(node.parentKey) : null;
      const inserted = await c.query(
        `INSERT INTO toc_node (toc_version_id, parent_node_id, node_key, title, level, sort_order, generation_policy)
         VALUES ($1, $2, $3, $4, $5, $6, '{}') RETURNING toc_node_id`,
        [tocVersionId, parentId ?? null, node.nodeKey, node.title, node.level, node.sortOrder],
      );
      idsByKey.set(node.nodeKey, inserted.rows[0].toc_node_id as string);
    }
    await c.query(
      `UPDATE plan SET current_context_snapshot_id = $2, current_toc_version_id = $3,
        status = 'CONTENT_GENERATING' WHERE plan_id = $1`,
      [planId, snapshotId, tocVersionId],
    );
    return { tenantId, userId, planId, snapshotId, tocVersionId };
  };

  const enqueueJob = async (
    c: Client,
    fx: Fixture,
    overrides: { targetNodeKeys?: string[] } = {},
  ): Promise<string> => {
    const request = buildContentJobRequest({
      snapshotId: fx.snapshotId,
      contextHash: canonicalHash(CONTEXT),
      tocVersionId: fx.tocVersionId,
      tocContentHash: tocTreeContentHash(TREE),
      requestedBy: fx.userId,
      targetNodeKeys: overrides.targetNodeKeys,
    });
    const jobId = (
      await c.query(
        `INSERT INTO generation_job
           (tenant_id, job_type, aggregate_type, aggregate_id, provider_code, request_json,
            status, progress_pct, idempotency_key, correlation_id)
         VALUES ($1, 'CONTENT', 'PLAN', $2, 'T3Q', $3, 'QUEUED', 0, $4, $5)
         RETURNING job_id`,
        [
          fx.tenantId,
          fx.planId,
          JSON.stringify(request),
          jobIdempotencyKey(
            'CONTENT',
            'POST /plans/{planId}/content-jobs',
            fx.planId,
            randomUUID(),
          ),
          `corr_${randomUUID().slice(0, 8)}`,
        ],
      )
    ).rows[0].job_id as string;
    await c.query(
      `INSERT INTO job_event (job_id, sequence_no, event_type, payload_json)
       VALUES ($1, 1, 'job.queued', '{}')`,
      [jobId],
    );
    return jobId;
  };

  beforeAll(async () => {
    const adminUrl = new URL(ADMIN_URL as string);
    dbName = `cc130_wrk_${randomUUID().slice(0, 8)}`;
    for (let attempt = 1; ; attempt += 1) {
      try {
        await withClient(ADMIN_URL as string, (c) => c.query(`CREATE DATABASE ${dbName}`));
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    adminUrl.pathname = `/${dbName}`;
    dbUrl = adminUrl.toString();
    await migrate({
      databaseUrl: dbUrl,
      dir: MIGRATIONS_DIR,
      migrationsTable: 'pgmigrations',
      ignorePattern: '\\..*|README\\.md',
      direction: 'up',
      logger: { info: () => {}, warn: () => {}, error: console.error, debug: () => {} },
    });
    config = loadWorkerConfig({
      DATABASE_URL: dbUrl,
      UNE_DB_RUNTIME_ROLE: 'une_worker',
      UNE_WORKER_MAX_ATTEMPTS: '2',
      UNE_WORKER_LEASE_TIMEOUT_MS: '60000',
    });
    db = new WorkerDatabase(config);
  }, 240_000);

  afterAll(async () => {
    if (db) await db.close();
    if (dbName) {
      await withClient(ADMIN_URL as string, (c) =>
        c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`),
      );
    }
  });

  it('full journey: blocks per node, leaf citations, block/progress events, plan → EDITING', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'ok'));
    const jobId = await withClient(dbUrl, (c) => enqueueJob(c, fx));

    const summary = await newRunner().runOnce();
    expect(summary).toMatchObject({ claimed: 1, completed: 1, failed: 0 });

    await withClient(dbUrl, async (c) => {
      const job = (
        await c.query(`SELECT status, progress_pct FROM generation_job WHERE job_id=$1`, [jobId])
      ).rows[0];
      expect(job.status).toBe('COMPLETED');
      expect(Number(job.progress_pct)).toBe(100);

      const blocks = (
        await c.query(
          `SELECT node_key, title, text_content, citation_count, generation_no, status
           FROM generated_block WHERE plan_id=$1 AND superseded_at IS NULL ORDER BY sort_order`,
          [fx.planId],
        )
      ).rows;
      expect(blocks.map((b) => b.node_key)).toEqual(['n-1', 'n-1-1', 'n-2']);
      expect(blocks.every((b) => b.status === 'GENERATED' && b.generation_no === 1)).toBe(true);
      // Leaves carry citations (evidence mapping); containers do not.
      expect(blocks[0].citation_count).toBe(0);
      expect(blocks[1].citation_count).toBe(1);
      expect(blocks[2].citation_count).toBe(1);
      expect(blocks[1].text_content).toContain('□');

      const events = (
        await c.query(
          `SELECT event_type, payload_json FROM job_event WHERE job_id=$1 ORDER BY sequence_no`,
          [jobId],
        )
      ).rows;
      const blockEvents = events.filter((e) => e.event_type === 'content.block');
      expect(blockEvents).toHaveLength(3);
      expect(blockEvents.every((e) => e.payload_json.outcome === 'GENERATED')).toBe(true);
      const completed = events.find((e) => e.event_type === 'job.completed');
      expect(completed.payload_json).toMatchObject({
        generated: 3,
        preserved: 0,
        failed: 0,
        blocksWithoutEvidence: 1, // the container node n-1
        tocVersionId: fx.tocVersionId,
      });
      const requested = events.find((e) => e.event_type === 'provider.requested');
      expect(requested.payload_json).toMatchObject({ operation: 'content', phase: 'intent' });

      const plan = (await c.query(`SELECT status FROM plan WHERE plan_id=$1`, [fx.planId])).rows[0];
      expect(plan.status).toBe('EDITING');
    });
  });

  it('protected blocks are PRESERVED: no new row, old row stays current (CLAUDE.md invariant)', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'prot'));
    // A user-locked block from an earlier round on n-2.
    const protectedBlockId = await withClient(dbUrl, (c) =>
      c
        .query(
          `INSERT INTO generated_block
             (plan_id, toc_version_id, node_key, generation_no, outline_level, sort_order,
              title, text_content, content_hash, status, protection_state, created_by)
           VALUES ($1, $2, 'n-2', 1, 1, 3, 'Ⅱ. 대비 대책', '사용자가 직접 쓴 본문', $3,
                   'GENERATED', 'USER_LOCKED', $4)
           RETURNING block_id`,
          [fx.planId, fx.tocVersionId, 'a'.repeat(64), fx.userId],
        )
        .then((r) => r.rows[0].block_id as string),
    );
    const jobId = await withClient(dbUrl, (c) => enqueueJob(c, fx));

    const summary = await newRunner().runOnce();
    expect(summary.completed).toBe(1);

    await withClient(dbUrl, async (c) => {
      const n2 = (
        await c.query(
          `SELECT block_id, text_content, protection_state FROM generated_block
           WHERE plan_id=$1 AND node_key='n-2' AND superseded_at IS NULL`,
          [fx.planId],
        )
      ).rows;
      expect(n2).toHaveLength(1);
      expect(n2[0].block_id).toBe(protectedBlockId);
      expect(n2[0].text_content).toBe('사용자가 직접 쓴 본문');

      const completed = (
        await c.query(
          `SELECT payload_json FROM job_event WHERE job_id=$1 AND event_type='job.completed'`,
          [jobId],
        )
      ).rows[0];
      expect(completed.payload_json).toMatchObject({ generated: 2, preserved: 1 });
      const preservedEvent = (
        await c.query(
          `SELECT payload_json FROM job_event WHERE job_id=$1 AND event_type='content.block'
             AND payload_json->>'outcome'='PRESERVED'`,
          [jobId],
        )
      ).rows[0];
      // PRESERVED carries the EXISTING block's identity — never null like
      // FAILED would be (review M-4/F3).
      expect(preservedEvent.payload_json).toMatchObject({
        nodeKey: 'n-2',
        reason: 'USER_LOCKED',
        blockId: protectedBlockId,
        contentHash: 'a'.repeat(64),
        citationCount: 0,
      });
    });
  });

  it('regeneration supersedes previous generations (immutable rows, new generation_no)', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'regen'));
    await withClient(dbUrl, (c) => enqueueJob(c, fx));
    await newRunner().runOnce();
    // Second round (plan status must allow re-dispatch; simulate re-request).
    await withClient(dbUrl, (c) =>
      c.query(`UPDATE plan SET status='CONTENT_GENERATING' WHERE plan_id=$1`, [fx.planId]),
    );
    await withClient(dbUrl, (c) => enqueueJob(c, fx));
    await newRunner().runOnce();

    await withClient(dbUrl, async (c) => {
      const rows = (
        await c.query(
          `SELECT node_key, generation_no, superseded_at IS NULL AS current, superseded_by_block_id
           FROM generated_block WHERE plan_id=$1 ORDER BY node_key, generation_no`,
          [fx.planId],
        )
      ).rows;
      expect(rows).toHaveLength(6); // 3 nodes × 2 generations
      for (const nodeKey of ['n-1', 'n-1-1', 'n-2']) {
        const generations = rows.filter((r) => r.node_key === nodeKey);
        expect(generations.map((r) => [r.generation_no, r.current])).toEqual([
          [1, false],
          [2, true],
        ]);
        expect(generations[0].superseded_by_block_id).not.toBeNull();
      }
    });
  });

  it('outline moved mid-flight: result discarded whole, no blocks written', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'moved'));
    const jobId = await withClient(dbUrl, (c) => enqueueJob(c, fx));
    // The manifest pins the old toc version; move the plan pointer AFTER
    // enqueue (B0 pre-check) is bypassed by moving it between B0 and B1 —
    // simplest deterministic simulation: point the plan at a NEW version
    // before the run; the B0 pre-check must fail closed.
    const otherVersion = await withClient(dbUrl, (c) =>
      c
        .query(
          `INSERT INTO toc_version (plan_id, version_no, source_type, base_snapshot_id, status, content_hash, created_by)
           VALUES ($1, 2, 'USER', $2, 'CONFIRMED', $3, $4) RETURNING toc_version_id`,
          [fx.planId, fx.snapshotId, 'b'.repeat(64), fx.userId],
        )
        .then((r) => r.rows[0].toc_version_id as string),
    );
    await withClient(dbUrl, (c) =>
      c.query(`UPDATE plan SET current_toc_version_id=$2 WHERE plan_id=$1`, [
        fx.planId,
        otherVersion,
      ]),
    );

    const summary = await newRunner().runOnce();
    expect(summary.failed).toBe(1);

    await withClient(dbUrl, async (c) => {
      const job = (
        await c.query(`SELECT status, error_json FROM generation_job WHERE job_id=$1`, [jobId])
      ).rows[0];
      expect(job.status).toBe('FAILED');
      expect(job.error_json.reason).toBe('OUTLINE_CHANGED');
      const blocks = (
        await c.query(`SELECT count(*)::int AS n FROM generated_block WHERE plan_id=$1`, [
          fx.planId,
        ])
      ).rows[0];
      expect(blocks.n).toBe(0);
    });
  });

  it('scoped regeneration keeps FULL-outline coordinates — deep and tail nodes (review B-1/F2)', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'scope'));
    // Round 1: the level-2 node alone. Without full-outline coordinates
    // this persisted as outline_level=1 / sort_order=1 (data corruption).
    await withClient(dbUrl, (c) => enqueueJob(c, fx, { targetNodeKeys: ['n-1-1'] }));
    expect((await newRunner().runOnce()).completed).toBe(1);

    // Round 2: the tail top-level node (full-outline sort_order 3).
    await withClient(dbUrl, (c) =>
      c.query(`UPDATE plan SET status='CONTENT_GENERATING' WHERE plan_id=$1`, [fx.planId]),
    );
    await withClient(dbUrl, (c) => enqueueJob(c, fx, { targetNodeKeys: ['n-2'] }));
    expect((await newRunner().runOnce()).completed).toBe(1);

    await withClient(dbUrl, async (c) => {
      const rows = (
        await c.query(
          `SELECT node_key, outline_level, sort_order FROM generated_block
           WHERE plan_id=$1 AND superseded_at IS NULL ORDER BY sort_order`,
          [fx.planId],
        )
      ).rows;
      // n-1 was never targeted — untouched.
      expect(rows.map((r) => [r.node_key, r.outline_level, r.sort_order])).toEqual([
        ['n-1-1', 2, 2],
        ['n-2', 1, 3],
      ]);
    });
  });

  it('outline moved BETWEEN B0 and B1: whole result discarded, plan NOT stuck (review M-1/G1)', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'b1move'));
    const jobId = await withClient(dbUrl, (c) => enqueueJob(c, fx));

    // Adapter hook: move the plan pointer while the provider "runs" —
    // i.e. after tx B0 committed and before tx B1 starts.
    const inner = new MockLegacyT3qPlanAdapter();
    const hooked = new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === 'generateContent') {
          return async (...args: Parameters<typeof inner.generateContent>) => {
            await withClient(dbUrl, async (c) => {
              const moved = await c.query(
                `INSERT INTO toc_version (plan_id, version_no, source_type, base_snapshot_id, status, content_hash, created_by)
                 VALUES ($1, 2, 'USER', $2, 'CONFIRMED', $3, $4) RETURNING toc_version_id`,
                [fx.planId, fx.snapshotId, 'c'.repeat(64), fx.userId],
              );
              await c.query(`UPDATE plan SET current_toc_version_id=$2 WHERE plan_id=$1`, [
                fx.planId,
                moved.rows[0].toc_version_id,
              ]);
            });
            return inner.generateContent(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const summary = await newRunner(hooked).runOnce();
    expect(summary.completed).toBe(1); // discarded counts as completed

    await withClient(dbUrl, async (c) => {
      const completed = (
        await c.query(
          `SELECT payload_json FROM job_event WHERE job_id=$1 AND event_type='job.completed'`,
          [jobId],
        )
      ).rows[0];
      expect(completed.payload_json).toMatchObject({
        supersededByOutlineChange: true,
        discardedBlocks: 3,
      });
      const blocks = (
        await c.query(`SELECT count(*)::int AS n FROM generated_block WHERE plan_id=$1`, [
          fx.planId,
        ])
      ).rows[0];
      expect(blocks.n).toBe(0);
      // The plan must NOT stay CONTENT_GENERATING (unrecoverable) — abort
      // semantics: no blocks → back to OUTLINE_CONFIRMED.
      const plan = (await c.query(`SELECT status FROM plan WHERE plan_id=$1`, [fx.planId])).rows[0];
      expect(plan.status).toBe('OUTLINE_CONFIRMED');
    });
  });

  it('cancel sweeps are per job type: a TOC runner never settles a CONTENT job', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'sweep'));
    const jobId = await withClient(dbUrl, (c) => enqueueJob(c, fx));
    await withClient(dbUrl, (c) =>
      c.query(`UPDATE generation_job SET status='CANCEL_REQUESTED' WHERE job_id=$1`, [jobId]),
    );

    const tocSummary = await new TocJobRunner(db, new MockLegacyT3qPlanAdapter(), config).runOnce();
    expect(tocSummary.cancelled).toBe(0);
    await withClient(dbUrl, async (c) => {
      const status = (await c.query(`SELECT status FROM generation_job WHERE job_id=$1`, [jobId]))
        .rows[0].status;
      expect(status).toBe('CANCEL_REQUESTED'); // untouched by the TOC runner
    });

    const contentSummary = await newRunner().runOnce();
    expect(contentSummary.cancelled).toBe(1);
    await withClient(dbUrl, async (c) => {
      const job = (await c.query(`SELECT status FROM generation_job WHERE job_id=$1`, [jobId]))
        .rows[0];
      expect(job.status).toBe('CANCELLED');
      const plan = (await c.query(`SELECT status FROM plan WHERE plan_id=$1`, [fx.planId])).rows[0];
      expect(plan.status).toBe('OUTLINE_CONFIRMED'); // no blocks yet → back to confirmed
    });
  });

  it('mock-target-v2 partial failure (review M-1): failed node writes NO row, previous generation stays current, audit counts failed', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'v2fail'));
    // An earlier-generation UNPROTECTED block on n-2 — the failed round must
    // neither supersede nor replace it.
    const priorBlockId = await withClient(dbUrl, (c) =>
      c
        .query(
          `INSERT INTO generated_block
             (plan_id, toc_version_id, node_key, generation_no, outline_level, sort_order,
              title, text_content, content_hash, status, protection_state, created_by)
           VALUES ($1, $2, 'n-2', 1, 1, 3, 'Ⅱ. 대비 대책', '이전 세대 본문', $3,
                   'GENERATED', 'NONE', $4)
           RETURNING block_id`,
          [fx.planId, fx.tocVersionId, 'b'.repeat(64), fx.userId],
        )
        .then((r) => r.rows[0].block_id as string),
    );
    const jobId = await withClient(dbUrl, (c) => enqueueJob(c, fx));

    const adapter = new TargetV2T3qPlanAdapter({
      transport: new MockTargetV2Transport({ failSectionIds: ['n-2'] }),
      sleep: async () => {},
    });
    const summary = await newRunner(adapter).runOnce();
    expect(summary).toMatchObject({ claimed: 1, completed: 1, failed: 0 });

    await withClient(dbUrl, async (c) => {
      const prior = (
        await c.query(`SELECT superseded_at, text_content FROM generated_block WHERE block_id=$1`, [
          priorBlockId,
        ])
      ).rows[0];
      expect(prior.superseded_at).toBeNull(); // previous generation untouched
      expect(prior.text_content).toBe('이전 세대 본문');
      const n2Rows = (
        await c.query(
          `SELECT count(*)::int AS n FROM generated_block WHERE plan_id=$1 AND node_key='n-2'`,
          [fx.planId],
        )
      ).rows[0];
      expect(n2Rows.n).toBe(1); // NO new row for the failed node

      const events = (
        await c.query(
          `SELECT event_type, payload_json FROM job_event WHERE job_id=$1 ORDER BY sequence_no`,
          [jobId],
        )
      ).rows;
      const failedEvent = events.find(
        (e) => e.event_type === 'content.block' && e.payload_json.outcome === 'FAILED',
      );
      expect(failedEvent.payload_json).toMatchObject({
        nodeKey: 'n-2',
        reason: 'PROVIDER_TARGET_FAILED',
      });
      const completed = events.find((e) => e.event_type === 'job.completed');
      expect(completed.payload_json).toMatchObject({ generated: 2, preserved: 0, failed: 1 });
      const plan = (await c.query(`SELECT status FROM plan WHERE plan_id=$1`, [fx.planId])).rows[0];
      expect(plan.status).toBe('EDITING');
    });
  });

  it('mock-target-v2 CONTENT journey (CC-135): v2 trace bindings recorded, provenance persisted to citations_json, plan → EDITING', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'v2'));
    const jobId = await withClient(dbUrl, (c) => enqueueJob(c, fx));

    const adapter = new TargetV2T3qPlanAdapter({ sleep: async () => {} });
    const summary = await newRunner(adapter).runOnce();
    expect(summary).toMatchObject({ claimed: 1, completed: 1, failed: 0 });

    await withClient(dbUrl, async (c) => {
      const job = (
        await c.query(`SELECT status, progress_pct FROM generation_job WHERE job_id=$1`, [jobId])
      ).rows[0];
      expect(job.status).toBe('COMPLETED');
      expect(Number(job.progress_pct)).toBe(100);

      // v2 trace bindings survive in provider.responded.rawRequest — the
      // CC-130 review m-10 seam, now closed (ADR-28). Mock placeholders are
      // visibly mock-only values, never real aggregates.
      const events = (
        await c.query(
          `SELECT event_type, payload_json FROM job_event WHERE job_id=$1 ORDER BY sequence_no`,
          [jobId],
        )
      ).rows;
      const responded = events.find((e) => e.event_type === 'provider.responded');
      expect(responded.payload_json).toMatchObject({
        adapterId: 'mock-target-v2-1.0.1',
        operation: 'content',
      });
      expect(responded.payload_json.rawRequest).toMatchObject({
        schemaVersion: '2.0',
        planId: fx.planId,
        planContextSnapshotId: fx.snapshotId,
        requestId: `${jobId}#1`,
        documentId: 'une-mock:document:pending-cc150',
        baseRevisionId: 'une-mock:revision:pending-cc150',
        generationScope: 'ALL',
      });
      const requested = events.find((e) => e.event_type === 'provider.requested');
      expect(requested.payload_json).toMatchObject({
        variant: 'target-v2',
        runtimeMode: 'mock', // AC "mock-only status visible" on the job trace
      });
      expect(events.filter((e) => e.event_type === 'content.block')).toHaveLength(3);

      // v2 Citation provenance lands in citations_json (ADR-26 D4 slots;
      // 0017 needs no migration — db-integration pins the catalog).
      const blocks = (
        await c.query(
          `SELECT node_key, citation_count, citations_json, text_content
           FROM generated_block WHERE plan_id=$1 AND superseded_at IS NULL ORDER BY sort_order`,
          [fx.planId],
        )
      ).rows;
      expect(blocks.map((b) => b.node_key)).toEqual(['n-1', 'n-1-1', 'n-2']);
      // level-1 sections join two v2 blocks into one canonical text (ADR-28 D7)
      expect(blocks[0].text_content).toContain('\n');
      expect(blocks[0].citation_count).toBe(1);
      expect(blocks[1].citation_count).toBe(1);
      expect(blocks[2].citation_count).toBe(0); // deterministic no-evidence tail
      const citation = blocks[0].citations_json[0];
      expect(citation.sourceId).toMatch(/^src-/);
      expect(citation.documentId).toBeTruthy();
      expect(citation.chunkId).toMatch(/^chunk-\d{4}-\d{2}$/);
      expect(typeof citation.score).toBe('number');
      expect(citation.retrievedAt).toBeTruthy();

      const completed = events.find((e) => e.event_type === 'job.completed');
      expect(completed.payload_json).toMatchObject({
        generated: 3,
        preserved: 0,
        failed: 0,
        blocksWithoutEvidence: 1,
      });
      const plan = (await c.query(`SELECT status FROM plan WHERE plan_id=$1`, [fx.planId])).rows[0];
      expect(plan.status).toBe('EDITING');
    });
  });
});
