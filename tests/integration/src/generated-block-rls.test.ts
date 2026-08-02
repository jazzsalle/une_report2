import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  ADMIN_URL,
  createTestDb,
  dropTestDb,
  insertFixture,
  migrate,
  withClient,
  type Fixture,
} from './db-helpers';

/** CC-130 / migration 0017: `generated_block` (UNE-PLAN-016 본문 생성 산출물).
 *
 * 설계 10 §3.3/§7과 OpenAPI x-db-tables에 이름이 확정돼 있으나 §6.2 DDL 표에서
 * 빠져 있던 ADR-21 유형 기준선 결함을 ADR-27이 해소한 결과의 60번째 테이블.
 * 여기서 증명하는 것은 세 가지다:
 *   1) 테넌트 격리가 0016과 같은 EXISTS(plan) 정책으로 DB에서 닫힌다,
 *   2) 보호 블록(USER_LOCKED/SYSTEM_LOCKED)과 생성 이력이 워커 롤에 대해
 *      기제(트리거 + 권한)로 지켜진다 — 애플리케이션 약속이 아니라,
 *   3) 현재 블록 조회가 부분 유니크 인덱스 경로를 유지한다. */

const TABLE = 'generated_block';
/** EXPLAIN 케이스의 부피: 20 계획서 x 200 노드 x 2 세대(구/현재) = 8,000행.
 * 대상 계획서(픽스처 A)의 현재 블록은 2행뿐이라, 순차 스캔이 인덱스보다
 * 실제로 비싸야 단언이 의미를 가진다. */
const BULK_PLANS = 20;
const BULK_NODES_PER_PLAN = 200;

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

interface BlockFixture extends Fixture {
  planId: string;
  snapshotId: string;
  jobId: string;
  tocVersionId: string;
  /** protection_state = 'NONE' 인 현재 블록 (node_key = 'node-open') */
  openBlockId: string;
  /** protection_state = 'USER_LOCKED' 인 현재 블록 (node_key = 'node-locked') */
  lockedBlockId: string;
}

async function asRole<T>(
  url: string,
  role: 'une_app' | 'une_worker',
  tenantId: string | null,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  return withClient(url, async (c) => {
    await c.query(`SET ROLE ${role}`);
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    return fn(c);
  });
}

/** 워커 트랜잭션. `SET LOCAL ROLE une_worker` 뒤 current_user가 실제로
 * une_worker인지 **먼저 단언**한다: 0017의 보호 트리거는 current_user로
 * 발동하므로, 롤 설정이 조용히 실패하면 아래의 "거부되어야 한다" 단언들이
 * 전부 무의미해진다(거부가 아니라 애초에 트리거가 안 도는 것). 전제가 깨지면
 * 테스트는 통과가 아니라 즉시 실패해야 한다.
 * 각 호출은 자기 트랜잭션에서 끝나고 ROLLBACK되므로, 실패 단언이 남긴 abort
 * 상태가 다음 케이스로 새지 않는다. */
async function inWorkerTx<T>(
  url: string,
  tenantId: string | null,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  return withClient(url, async (c) => {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE une_worker');
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const who = await c.query('SELECT current_user AS u, session_user AS s');
    if (who.rows[0].u !== 'une_worker') {
      throw new Error(
        `trigger precondition violated: current_user=${who.rows[0].u} (session ${who.rows[0].s}); ` +
          'une_generated_block_protect() only fires for une_worker',
      );
    }
    try {
      return await fn(c);
    } finally {
      await c.query('ROLLBACK');
    }
  });
}

async function insertBlock(
  c: Client,
  fx: { planId: string; tocVersionId: string; jobId: string; userId: string },
  overrides: {
    nodeKey: string;
    generationNo?: number;
    protectionState?: string;
    citations?: unknown[];
    hash?: string;
  },
): Promise<string> {
  const res = await c.query(
    `INSERT INTO generated_block
       (plan_id, toc_version_id, node_key, generation_no, source_job_id, outline_level,
        sort_order, title, text_content, content_hash, citations_json, status,
        protection_state, created_by)
     VALUES ($1, $2, $3, $4, $5, 1, 1, $6, $7, $8, $9::jsonb, 'GENERATED', $10, $11)
     RETURNING block_id`,
    [
      fx.planId,
      fx.tocVersionId,
      overrides.nodeKey,
      overrides.generationNo ?? 1,
      fx.jobId,
      `${overrides.nodeKey} 제목`,
      `${overrides.nodeKey} 본문`,
      overrides.hash ?? HASH_A,
      JSON.stringify(overrides.citations ?? [{ sourceId: 'doc-1', score: 0.9 }]),
      overrides.protectionState ?? 'NONE',
      fx.userId,
    ],
  );
  return res.rows[0].block_id as string;
}

/** 한 테넌트의 계획 애그리거트 + 현재 블록 2개(비보호/보호). 관리 주체
 * (superuser)로 쓰므로 픽스처 자체가 정책·트리거에 의존하지 않는다. */
async function insertBlockFixture(c: Client, tenantCode: string): Promise<BlockFixture> {
  const base = await insertFixture(c, tenantCode);
  const plan = await c.query(
    `INSERT INTO plan (tenant_id, title, hazard_type, management_phase, status, owner_id)
     VALUES ($1, 'CC-130 fixture plan', '호우', '대비', 'DRAFT', $2) RETURNING plan_id`,
    [base.tenantId, base.userId],
  );
  const planId = plan.rows[0].plan_id as string;
  const snapshot = await c.query(
    `INSERT INTO plan_context_snapshot (plan_id, version_no, context_json, content_hash, confirmed_by)
     VALUES ($1, 1, '{"subject":"CC-130"}', $2, $3) RETURNING context_snapshot_id`,
    [planId, HASH_A, base.userId],
  );
  const snapshotId = snapshot.rows[0].context_snapshot_id as string;
  const version = await c.query(
    `INSERT INTO toc_version
       (plan_id, version_no, source_type, base_snapshot_id, status, content_hash, created_by)
     VALUES ($1, 1, 'AI', $2, 'CONFIRMED', $3, $4) RETURNING toc_version_id`,
    [planId, snapshotId, HASH_B, base.userId],
  );
  const tocVersionId = version.rows[0].toc_version_id as string;
  const job = await c.query(
    `INSERT INTO generation_job
       (tenant_id, job_type, aggregate_type, aggregate_id, provider_code, request_json,
        status, progress_pct, idempotency_key, correlation_id)
     VALUES ($1, 'CONTENT', 'PLAN', $2, 'T3Q', '{}', 'RUNNING', 10, $3, $4) RETURNING job_id`,
    [base.tenantId, planId, `idem-${randomUUID()}`, `corr-${randomUUID()}`],
  );
  const jobId = job.rows[0].job_id as string;
  const seed = { planId, tocVersionId, jobId, userId: base.userId };
  const openBlockId = await insertBlock(c, seed, { nodeKey: 'node-open' });
  const lockedBlockId = await insertBlock(c, seed, {
    nodeKey: 'node-locked',
    protectionState: 'USER_LOCKED',
  });
  return { ...base, planId, snapshotId, jobId, tocVersionId, openBlockId, lockedBlockId };
}

describe.skipIf(!ADMIN_URL)(
  'generated_block tenant RLS and protection (CC-130, migration 0017)',
  () => {
    let db: { name: string; url: string };
    let fxA: BlockFixture;
    let fxB: BlockFixture;

    beforeAll(async () => {
      db = await createTestDb('cc130_generated_block');
      await migrate(db.url);
      await withClient(db.url, async (c) => {
        fxA = await insertBlockFixture(c, 'cc130-a');
        fxB = await insertBlockFixture(c, 'cc130-b');

        // EXPLAIN 케이스용 부피. 세대 1은 대체 완료(이력), 세대 2가 현재 블록 —
        // 부분 유니크 인덱스가 이력 위에서도 성립하는 형상 그대로 만든다.
        // toc_version은 픽스처 A의 것을 재사용한다(FK는 존재만 요구하며,
        // 이 케이스가 재는 것은 plan_id 접근 경로다).
        const bulkPlans = await c.query(
          `INSERT INTO plan (tenant_id, title, hazard_type, management_phase, status, owner_id)
         SELECT $1, 'CC-130 bulk plan ' || g, '호우', '대비', 'DRAFT', $2
         FROM generate_series(1, $3::int) g
         RETURNING plan_id`,
          [fxA.tenantId, fxA.userId, BULK_PLANS],
        );
        const bulkPlanIds = bulkPlans.rows.map((r) => r.plan_id as string);
        await c.query(
          `INSERT INTO generated_block
           (plan_id, toc_version_id, node_key, generation_no, source_job_id, outline_level,
            sort_order, title, text_content, content_hash, citations_json, status,
            created_by, superseded_at)
         SELECT p, $2, 'bulk-' || s, gen, $3, 1, s, 'bulk ' || s, 'bulk body ' || s,
                md5(p::text || s || gen) || md5(s::text || gen), '[]'::jsonb, 'GENERATED',
                $4, CASE WHEN gen = 1 THEN now() ELSE NULL END
         FROM unnest($1::uuid[]) p,
              generate_series(1, $5::int) s,
              generate_series(1, 2) gen`,
          [bulkPlanIds, fxA.tocVersionId, fxA.jobId, fxA.userId, BULK_NODES_PER_PLAN],
        );
        await c.query('ANALYZE generated_block');
        await c.query('ANALYZE plan');
      });
    }, 180_000);

    afterAll(async () => {
      if (db) await dropTestDb(db.name);
    });

    it('enables and forces RLS with one tenant policy and both triggers', async () => {
      const state = await withClient(db.url, (c) =>
        c.query(
          `SELECT c.relrowsecurity, c.relforcerowsecurity,
                (SELECT array_agg(p.policyname::text ORDER BY p.policyname)
                 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = $1) AS policies,
                (SELECT array_agg(t.tgname::text ORDER BY t.tgname)
                 FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS triggers
         FROM pg_class c WHERE c.relname = $1 AND c.relkind = 'r'`,
          [TABLE],
        ),
      );
      expect(state.rows).toHaveLength(1);
      expect(state.rows[0].relrowsecurity).toBe(true);
      expect(state.rows[0].relforcerowsecurity).toBe(true);
      expect(state.rows[0].policies).toEqual(['p_generated_block_tenant']);
      expect(state.rows[0].triggers).toEqual([
        'trg_generated_block_protect',
        'trg_generated_block_updated_at',
      ]);
    });

    it('shows a tenant only its own blocks and hides the other tenant (une_app)', async () => {
      const visible = await asRole(db.url, 'une_app', fxA.tenantId, (c) =>
        c.query(`SELECT block_id FROM generated_block WHERE block_id = ANY($1) ORDER BY node_key`, [
          [fxA.openBlockId, fxA.lockedBlockId, fxB.openBlockId, fxB.lockedBlockId],
        ]),
      );
      expect(visible.rows.map((r) => r.block_id).sort()).toEqual(
        [fxA.lockedBlockId, fxA.openBlockId].sort(),
      );

      // 직접 id 조회로도 타 테넌트의 본문/인용은 보이지 않는다.
      const leaked = await asRole(db.url, 'une_app', fxA.tenantId, (c) =>
        c.query(`SELECT text_content, citations_json FROM generated_block WHERE block_id = $1`, [
          fxB.openBlockId,
        ]),
      );
      expect(leaked.rows).toHaveLength(0);
    });

    it('rejects a cross-tenant INSERT through WITH CHECK (une_app)', async () => {
      await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
        await expect(
          c.query(
            `INSERT INTO generated_block
             (plan_id, toc_version_id, node_key, generation_no, outline_level, title,
              text_content, content_hash, status, created_by)
           VALUES ($1, $2, 'cross-tenant', 1, 1, '타 테넌트 블록', '본문', $3, 'GENERATED', $4)`,
            [fxB.planId, fxB.tocVersionId, HASH_B, fxA.userId],
          ),
        ).rejects.toThrow(/row-level security/);
      });
    });

    it('returns no blocks in the dispatch scope where app.tenant_id is unset', async () => {
      // 0016과 같은 의도된 결과: 워커의 블록 적재는 테넌트 스코프 트랜잭션에서만
      // 일어나고, 디스패치 스코프(테넌트 미설정)는 generation_job만 다룬다.
      for (const role of ['une_app', 'une_worker'] as const) {
        const counts = await asRole(db.url, role, null, (c) =>
          c.query(`SELECT count(*)::int AS n FROM generated_block`),
        );
        expect(counts.rows[0].n, `${role} dispatch scope`).toBe(0);
      }
    });

    it('blocks une_worker from superseding a protected (USER_LOCKED) block', async () => {
      // 도메인 규칙: "사용자가 편집한 블록은 재생성으로부터 보호된다".
      // 요청 파라미터(protectedBlocks) 필터가 아니라 DB 트리거가 최종 방어선이다.
      await inWorkerTx(db.url, fxA.tenantId, async (c) => {
        await expect(
          c.query(
            `UPDATE generated_block SET superseded_at = now(), superseded_by_block_id = NULL
           WHERE block_id = $1`,
            [fxA.lockedBlockId],
          ),
        ).rejects.toThrow(/protected block \(protection_state=USER_LOCKED\)/);
      });
    });

    it('lets une_worker supersede an unprotected block (supersede columns only)', async () => {
      const successorId = randomUUID();
      const after = await inWorkerTx(db.url, fxA.tenantId, async (c) => {
        // 세대 전환의 정본 순서: ① 직전 현재 행을 대체 표시하고 ② 새 세대 행을
        // INSERT한다. uk_generated_block_current는 즉시(non-deferrable) 검사되므로
        // 순서가 뒤바뀌면 23505다 — 두 개의 현재 행은 어느 순간에도 존재할 수 없다.
        // superseded_by_block_id는 아직 없는 행을 가리키지만 FK가 DEFERRABLE이라
        // 트랜잭션 안에서 성립한다.
        const updated = await c.query(
          `UPDATE generated_block
            SET superseded_at = now(), superseded_by_block_id = $2
          WHERE block_id = $1
          RETURNING text_content, title, status, protection_state, generation_no,
                    superseded_by_block_id, superseded_at, updated_at > created_at AS touched`,
          [fxA.openBlockId, successorId],
        );
        await c.query(
          `INSERT INTO generated_block
           (block_id, plan_id, toc_version_id, node_key, generation_no, source_job_id,
            outline_level, title, text_content, content_hash, citations_json, status, created_by)
         VALUES ($1, $2, $3, 'node-open', 2, $4, 1, '재생성 제목', '재생성 본문', $5,
                 '[{"sourceId":"doc-2"}]'::jsonb, 'GENERATED', $6)`,
          [successorId, fxA.planId, fxA.tocVersionId, fxA.jobId, HASH_B, fxA.userId],
        );
        // 지연된 FK를 롤백 전에 실제로 검증한다(커밋 시점의 검사를 앞당김).
        await c.query('SET CONSTRAINTS ALL IMMEDIATE');
        const current = await c.query(
          `SELECT count(*)::int AS n FROM generated_block
          WHERE plan_id = $1 AND node_key = 'node-open' AND superseded_at IS NULL`,
          [fxA.planId],
        );
        expect(current.rows[0].n).toBe(1);
        return updated.rows[0];
      });
      expect(after.superseded_at).not.toBeNull();
      expect(after.superseded_by_block_id).toBe(successorId);
      expect(after.text_content).toBe('node-open 본문');
      expect(after.title).toBe('node-open 제목');
      expect(after.status).toBe('GENERATED');
      expect(after.protection_state).toBe('NONE');
      expect(after.generation_no).toBe(1);
      // updated_at 트리거는 보호 트리거와 함께 정상 동작한다.
      expect(after.touched).toBe(true);
    });

    it('blocks une_worker from editing block content in place (regeneration must be a new row)', async () => {
      await inWorkerTx(db.url, fxA.tenantId, async (c) => {
        await expect(
          c.query(
            `UPDATE generated_block SET text_content = '워커가 덮어쓴 본문' WHERE block_id = $1`,
            [fxA.openBlockId],
          ),
        ).rejects.toThrow(/may only set superseded_at\/superseded_by_block_id/);
      });
      // 인용 근거 교체도 마찬가지다. citation_count(생성 컬럼)는 BEFORE 트리거
      // 시점에 NULL이라 비교에서 빠지지만, 파생 원본인 citations_json이 비교
      // 대상이므로 보장은 그대로다(0017 §7 citation_count 예외 주석).
      await inWorkerTx(db.url, fxA.tenantId, async (c) => {
        await expect(
          c.query(`UPDATE generated_block SET citations_json = '[]'::jsonb WHERE block_id = $1`, [
            fxA.openBlockId,
          ]),
        ).rejects.toThrow(/may only set superseded_at\/superseded_by_block_id/);
      });
      // 보호 상태 자체를 워커가 푸는 경로도 같은 규칙으로 닫힌다.
      await inWorkerTx(db.url, fxA.tenantId, async (c) => {
        await expect(
          c.query(`UPDATE generated_block SET protection_state = 'NONE' WHERE block_id = $1`, [
            fxA.lockedBlockId,
          ]),
        ).rejects.toThrow(/protected block/);
      });
    });

    it('leaves the protection trigger dormant outside une_worker (precondition evidence)', async () => {
      // 위 두 케이스의 거부가 "롤 때문"임을 증명한다. 같은 UPDATE를 관리 주체로
      // 실행하면 통과한다 — 즉 거부는 트리거의 current_user 판정에서 나왔다.
      // (사용자의 잠금 해제·운영 정정 경로를 트리거로 막지 않는다는 0017 §7의
      // 의도이기도 하다. 그 층의 통제는 RBAC과 감사 로그다.)
      await withClient(db.url, async (c) => {
        const who = await c.query('SELECT current_user AS u');
        expect(who.rows[0].u).not.toBe('une_worker');
        await c.query('BEGIN');
        try {
          const res = await c.query(
            `UPDATE generated_block SET text_content = '관리자 정정' WHERE block_id = $1
           RETURNING text_content`,
            [fxA.lockedBlockId],
          );
          expect(res.rows[0].text_content).toBe('관리자 정정');
        } finally {
          await c.query('ROLLBACK');
        }
      });
    });

    it('denies DELETE on generation history to both runtime roles', async () => {
      const privs = await withClient(db.url, (c) =>
        c.query(
          `SELECT grantee, privilege_type FROM information_schema.role_table_grants
         WHERE table_name = $1 AND privilege_type = 'DELETE'
           AND grantee IN ('une_app', 'une_worker')`,
          [TABLE],
        ),
      );
      expect(privs.rows).toHaveLength(0);

      await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
        await expect(
          c.query(`DELETE FROM generated_block WHERE block_id = $1`, [fxA.openBlockId]),
        ).rejects.toThrow(/permission denied for table generated_block/);
      });
      await inWorkerTx(db.url, fxA.tenantId, async (c) => {
        await expect(
          c.query(`DELETE FROM generated_block WHERE block_id = $1`, [fxA.openBlockId]),
        ).rejects.toThrow(/permission denied for table generated_block/);
      });
    });

    it('allows exactly one current block per (plan_id, node_key) and one row per generation', async () => {
      await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
        // 같은 노드의 현재 행 2개 → 부분 유니크 위반(23505).
        await expect(
          c.query(
            `INSERT INTO generated_block
             (plan_id, toc_version_id, node_key, generation_no, outline_level, title,
              text_content, content_hash, status, created_by)
           VALUES ($1, $2, 'node-open', 7, 1, '두 번째 현재 블록', '본문', $3, 'GENERATED', $4)`,
            [fxA.planId, fxA.tocVersionId, HASH_B, fxA.userId],
          ),
        ).rejects.toMatchObject({ code: '23505', constraint: 'uk_generated_block_current' });
      });
      await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
        // 세대 번호 재사용도 거부된다(재전송 멱등성).
        await expect(
          c.query(
            `INSERT INTO generated_block
             (plan_id, toc_version_id, node_key, generation_no, outline_level, title,
              text_content, content_hash, status, created_by, superseded_at)
           VALUES ($1, $2, 'node-open', 1, 1, '세대 중복', '본문', $3, 'GENERATED', $4, now())`,
            [fxA.planId, fxA.tocVersionId, HASH_B, fxA.userId],
          ),
        ).rejects.toMatchObject({ code: '23505', constraint: 'uk_generated_block_generation' });
      });
    });

    it('enforces the documented CHECK constraints (level, hash, status, generation_no, supersede)', async () => {
      interface CheckCase {
        constraint: string;
        key: string;
        level?: number;
        hash?: string;
        status?: string;
        generationNo?: number;
        supersededBy?: string | null;
      }
      const cases: CheckCase[] = [
        { constraint: 'ck_generated_block_outline_level', key: 'ck-level', level: 9 },
        { constraint: 'ck_generated_block_content_hash', key: 'ck-hash', hash: 'Z'.repeat(64) },
        { constraint: 'ck_generated_block_status', key: 'ck-status', status: 'DONE' },
        { constraint: 'ck_generated_block_generation_no', key: 'ck-gen', generationNo: 0 },
        // 대체 블록만 있고 대체 시각이 없는 행은 이력 해석을 깨뜨린다.
        { constraint: 'ck_generated_block_supersede', key: 'ck-sup', supersededBy: null },
      ];
      for (const tc of cases) {
        await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
          await expect(
            c.query(
              `INSERT INTO generated_block
               (plan_id, toc_version_id, node_key, generation_no, outline_level, title,
                text_content, content_hash, citations_json, status, created_by,
                superseded_by_block_id)
             VALUES ($1, $2, $3, $4, $5, '제약 검증', '본문', $6, '[]'::jsonb, $7, $8, $9)`,
              [
                fxA.planId,
                fxA.tocVersionId,
                tc.key,
                tc.generationNo ?? 1,
                tc.level ?? 1,
                tc.hash ?? HASH_A,
                tc.status ?? 'GENERATED',
                fxA.userId,
                tc.constraint === 'ck_generated_block_supersede' ? fxA.lockedBlockId : null,
              ],
            ),
            tc.constraint,
          ).rejects.toMatchObject({ code: '23514', constraint: tc.constraint });
        });
      }
    });

    it('rejects a non-array citations_json before it can be stored', async () => {
      // 관측된 사실(0017 §2 주석): STORED 생성 컬럼은 CHECK보다 먼저 계산되므로
      // 배열이 아닌 값은 ck_generated_block_citations_array(23514)가 아니라
      // jsonb_array_length의 22023으로 거부된다. 두 통제 모두 남겨 둔다 —
      // 카탈로그의 CHECK는 불변식의 선언이고, 실제 차단은 생성 컬럼이 한다.
      const declared = await withClient(db.url, (c) =>
        c.query(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'generated_block'::regclass
            AND conname = 'ck_generated_block_citations_array'`,
        ),
      );
      expect(declared.rows[0].def).toContain(`jsonb_typeof(citations_json) = 'array'`);

      await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
        await expect(
          c.query(
            `INSERT INTO generated_block
             (plan_id, toc_version_id, node_key, generation_no, outline_level, title,
              text_content, content_hash, citations_json, status, created_by)
           VALUES ($1, $2, 'ck-citations', 1, 1, '제약 검증', '본문', $3,
                   '{"notAnArray":true}'::jsonb, 'GENERATED', $4)`,
            [fxA.planId, fxA.tocVersionId, HASH_A, fxA.userId],
          ),
        ).rejects.toMatchObject({ code: '22023' });
      });
    });

    it('derives citation_count and indexes evidence-less current blocks', async () => {
      // 인용 없는 블록은 "LLM 출력은 권위 있는 사실 원천이 아니다"의 감사 대상이다.
      const rows = await asRole(db.url, 'une_app', fxA.tenantId, (c) =>
        c.query(
          `SELECT node_key, citation_count FROM generated_block
          WHERE plan_id = $1 ORDER BY node_key`,
          [fxA.planId],
        ),
      );
      expect(rows.rows).toEqual([
        { node_key: 'node-locked', citation_count: 1 },
        { node_key: 'node-open', citation_count: 1 },
      ]);

      const explain = await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
        const res = await c.query(
          `EXPLAIN SELECT block_id FROM generated_block
          WHERE plan_id = $1 AND superseded_at IS NULL AND citation_count = 0`,
          [fxA.planId],
        );
        return res.rows.map((r) => r['QUERY PLAN'] as string).join('\n');
      });
      expect(explain, explain).toContain('ix_generated_block_no_evidence');
    });

    it('keeps the current-block lookup on uk_generated_block_current under RLS (EXPLAIN)', async () => {
      // UNE-PLAN-016 이후의 기본 조회: 계획서의 현재 블록 집합. 부분 유니크
      // 인덱스가 이력 세대를 걸러내므로, 세대가 쌓여도 스캔량이 늘지 않아야 한다.
      const explain = await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
        const res = await c.query(
          `EXPLAIN SELECT block_id, node_key, sort_order FROM generated_block
          WHERE plan_id = $1 AND superseded_at IS NULL
          ORDER BY sort_order`,
          [fxA.planId],
        );
        return res.rows.map((r) => r['QUERY PLAN'] as string).join('\n');
      });
      expect(explain, explain).toMatch(
        /(Bitmap )?Index (Only )?Scan[^\n]*uk_generated_block_current/,
      );
      expect(explain, explain).not.toMatch(/Seq Scan on generated_block/);
    });
  },
);
