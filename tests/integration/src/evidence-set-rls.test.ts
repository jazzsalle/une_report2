import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  ADMIN_URL,
  createTestDb,
  dropTestDb,
  insertFixture,
  migrate,
  withClient,
} from './db-helpers';

/**
 * 마이그레이션 0031 (CC-230): EvidenceSet 테넌트 격리와 동결 불변성.
 *
 * 착수 시점 실측으로 `evidence_set`·`evidence_item`은 **정책이 한 번도 없었다.**
 * 0011이 `une_app`에 전 테이블 DML을 일괄 부여하므로 정책 없는 테이블은
 * 전 테넌트 공개이고, CC-230이 첫 쓰기 경로를 여는 순간 규칙이 깨지는
 * 상태였다 — 0023이 상황 계열에서 발견한 것과 같다.
 *
 * 네 갈래를 단언한다.
 *   (1) 읽기 격리 — 남의 기관 EvidenceSet이 보이지 않는다.
 *   (2) 쓰기 격리 — 남의 상황에 EvidenceSet을 만들 수 없다(WITH CHECK).
 *   (3) 동결 불변 — FROZEN 이후 집합도 항목도 바뀌지 않는다.
 *   (4) 근거는 우리가 올린 문서만 가리킨다(E-02의 마지막 방어선).
 */

interface EvFixture {
  tenantId: string;
  situationId: string;
  userId: string;
  snapshotId: string;
  documentId: string;
  setId: string;
  itemId: string;
}

async function asApp<T>(
  url: string,
  tenantId: string | null,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  return withClient(url, async (c) => {
    await c.query(`SET ROLE une_app`);
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    return fn(c);
  });
}

async function errCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'NO_ERROR';
  } catch (err) {
    return (err as { code?: string }).code ?? 'UNKNOWN';
  }
}

/** 정책을 검증하는 데이터가 정책에 의존하면 안 되므로 admin으로 넣는다. */
async function insertEvFixture(c: Client, code: string): Promise<EvFixture> {
  const base = await insertFixture(c, code);

  const snapshotId = (
    await c.query(
      `INSERT INTO situation_snapshot
         (situation_id, version_no, facts_json, content_hash, effective_at, confirmed_by)
       VALUES ($1, 1, $2::jsonb, $3, now(), $4) RETURNING snapshot_id`,
      [base.situationId, JSON.stringify([{ k: code }]), 'a'.repeat(64), base.userId],
    )
  ).rows[0].snapshot_id as string;

  const fileId = (
    await c.query(
      `INSERT INTO file_object
         (tenant_id, original_name, mime_type, size_bytes, sha256, storage_key,
          scan_status, upload_state, verified_at, created_by)
       VALUES ($1, 'm.pdf', 'application/pdf', 10, $2, $3, 'CLEAN', 'VERIFIED', now(), $4)
       RETURNING file_id`,
      [base.tenantId, 'b'.repeat(64), `k/${code}`, base.userId],
    )
  ).rows[0].file_id as string;

  const documentId = (
    await c.query(
      `INSERT INTO knowledge_document
         (tenant_id, situation_id, file_id, document_type, status, retention_scope,
          source_sha256, metadata_json, created_by, provider_document_id,
          uni_status, uni_observed_at)
       VALUES ($1, $2, $3, 'MANUAL', 'REGISTERED', 'THIS_INCIDENT', $4, '{}'::jsonb, $5,
               $6, 'READY', now())
       RETURNING knowledge_document_id`,
      [base.tenantId, base.situationId, fileId, 'b'.repeat(64), base.userId, `uni-${code}`],
    )
  ).rows[0].knowledge_document_id as string;

  const setId = (
    await c.query(
      `INSERT INTO evidence_set
         (situation_id, snapshot_id, query_text, filters_json, top_k, status,
          content_hash, created_by)
       VALUES ($1, $2, '대피 절차', '{}'::jsonb, 8, 'DRAFT', $3, $4)
       RETURNING evidence_set_id`,
      [base.situationId, snapshotId, 'c'.repeat(64), base.userId],
    )
  ).rows[0].evidence_set_id as string;

  const itemId = (
    await c.query(
      `INSERT INTO evidence_item
         (evidence_set_id, knowledge_document_id, provider_chunk_id, rank_no, score,
          quote_text, source_locator_json, citation_key)
       VALUES ($1, $2, 'chunk-1', 1, 0.9, '대피는 3단계다', '{"page":1}'::jsonb, 'C1')
       RETURNING evidence_item_id`,
      [setId, documentId],
    )
  ).rows[0].evidence_item_id as string;

  return {
    tenantId: base.tenantId,
    situationId: base.situationId,
    userId: base.userId,
    snapshotId,
    documentId,
    setId,
    itemId,
  };
}

describe.skipIf(!ADMIN_URL)('0031: EvidenceSet 격리와 동결 불변 (CC-230)', () => {
  let dbName: string;
  let url: string;
  let a: EvFixture;
  let b: EvFixture;

  beforeAll(async () => {
    const db = await createTestDb('cc230_rls');
    dbName = db.name;
    url = db.url;
    await migrate(url);
    await withClient(url, async (c) => {
      a = await insertEvFixture(c, 'ev-a');
      b = await insertEvFixture(c, 'ev-b');
    });
  }, 180_000);

  afterAll(async () => {
    if (dbName) await dropTestDb(dbName);
  });

  it('두 테이블 모두 RLS가 켜져 있고 FORCE다', async () => {
    const rows = await withClient(url, (c) =>
      c.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
          WHERE relname IN ('evidence_set','evidence_item') ORDER BY relname`,
      ),
    );
    expect(rows.rowCount).toBe(2);
    for (const r of rows.rows) {
      expect(`${r.relname}:${r.relrowsecurity}:${r.relforcerowsecurity}`).toBe(
        `${r.relname}:true:true`,
      );
    }
  });

  it('남의 기관 EvidenceSet과 근거는 보이지 않는다', async () => {
    const seen = await asApp(url, a.tenantId, async (c) => ({
      sets: (
        await c.query(`SELECT count(*)::int n FROM evidence_set WHERE evidence_set_id = $1`, [
          b.setId,
        ])
      ).rows[0].n,
      items: (
        await c.query(`SELECT count(*)::int n FROM evidence_item WHERE evidence_item_id = $1`, [
          b.itemId,
        ])
      ).rows[0].n,
    }));
    expect(seen).toEqual({ sets: 0, items: 0 });
  });

  it('자기 기관 것은 보인다 (정책이 과하게 막지 않는다)', async () => {
    const seen = await asApp(
      url,
      a.tenantId,
      async (c) =>
        (
          await c.query(`SELECT count(*)::int n FROM evidence_item WHERE evidence_item_id = $1`, [
            a.itemId,
          ])
        ).rows[0].n,
    );
    expect(seen).toBe(1);
  });

  it('남의 상황에 EvidenceSet을 만들 수 없다 (WITH CHECK)', async () => {
    await expect(
      asApp(url, a.tenantId, (c) =>
        c.query(
          `INSERT INTO evidence_set
             (situation_id, snapshot_id, query_text, filters_json, top_k, status,
              content_hash, created_by)
           VALUES ($1, $2, 'x', '{}'::jsonb, 8, 'DRAFT', $3, $4)`,
          [b.situationId, b.snapshotId, 'd'.repeat(64), a.userId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('남의 EvidenceSet에 근거를 붙일 수 없다', async () => {
    // 거부하는 것은 RLS의 WITH CHECK가 아니라 **fail-closed 가드**다. BEFORE
    // INSERT 트리거가 먼저 돌고, 남의 집합은 이 테넌트에게 보이지 않으므로
    // 부모 조회가 0행이 된다. 그 자리에서 막는 것이 옳다 — 처음에는 부모가
    // NULL이면 통과시켰고, 그것이 BLOCKER 2-2의 fail-open이었다.
    expect(
      await errCode(() =>
        asApp(url, a.tenantId, (c) =>
          c.query(
            `INSERT INTO evidence_item
               (evidence_set_id, knowledge_document_id, rank_no, quote_text,
                source_locator_json, citation_key)
             VALUES ($1, $2, 9, 'x', '{}'::jsonb, 'C9')`,
            [b.setId, a.documentId],
          ),
        ),
      ),
    ).toBe('42501');

    const leaked = await withClient(url, (c) =>
      c.query(`SELECT count(*)::int n FROM evidence_item WHERE evidence_set_id = $1`, [b.setId]),
    );
    expect(leaked.rows[0].n).toBe(1);
  });

  it('우리가 올린 적 없는 문서는 근거가 될 수 없다 (E-02 마지막 방어선)', async () => {
    // 애플리케이션 검사가 뚫려도 FK가 거부한다. UNI가 모르는 doc_id를
    // 돌려줬을 때 그것이 EvidenceSet에 들어가지 않는다는 보장이다.
    expect(
      await errCode(() =>
        withClient(url, (c) =>
          c.query(
            `INSERT INTO evidence_item
               (evidence_set_id, knowledge_document_id, rank_no, quote_text,
                source_locator_json, citation_key)
             VALUES ($1, gen_random_uuid(), 8, 'x', '{}'::jsonb, 'C8')`,
            [a.setId],
          ),
        ),
      ),
    ).toBe('23503');
  });

  describe('동결 불변', () => {
    const freeze = async (setId: string, userId: string): Promise<void> => {
      await withClient(url, (c) =>
        c.query(
          `UPDATE evidence_set SET status = 'FROZEN', frozen_at = now(), frozen_by = $2
            WHERE evidence_set_id = $1`,
          [setId, userId],
        ),
      );
    };

    it('동결에는 누가 언제가 함께 있어야 한다', async () => {
      expect(
        await errCode(() =>
          withClient(url, (c) =>
            c.query(`UPDATE evidence_set SET status = 'FROZEN' WHERE evidence_set_id = $1`, [
              b.setId,
            ]),
          ),
        ),
      ).toBe('23514');
    });

    it('동결 뒤에는 집합도 항목도 바뀌지 않는다', async () => {
      await freeze(a.setId, a.userId);

      // 집합 수정
      expect(
        await errCode(() =>
          withClient(url, (c) =>
            c.query(`UPDATE evidence_set SET query_text = '바꿈' WHERE evidence_set_id = $1`, [
              a.setId,
            ]),
          ),
        ),
      ).toBe('42501');

      // 항목 수정·삭제·추가 — "그때 무엇을 근거로 만들었는가"가 사라지면 안 된다.
      expect(
        await errCode(() =>
          withClient(url, (c) =>
            c.query(
              `UPDATE evidence_item SET is_selected = false, excluded_reason = 'x'
                      WHERE evidence_item_id = $1`,
              [a.itemId],
            ),
          ),
        ),
      ).toBe('42501');
      expect(
        await errCode(() =>
          withClient(url, (c) =>
            c.query(`DELETE FROM evidence_item WHERE evidence_item_id = $1`, [a.itemId]),
          ),
        ),
      ).toBe('42501');
      expect(
        await errCode(() =>
          withClient(url, (c) =>
            c.query(
              `INSERT INTO evidence_item
                 (evidence_set_id, knowledge_document_id, rank_no, quote_text,
                  source_locator_json, citation_key)
               VALUES ($1, $2, 7, 'x', '{}'::jsonb, 'C7')`,
              [a.setId, a.documentId],
            ),
          ),
        ),
      ).toBe('42501');
    });

    it('동결된 집합을 통째로 지울 수 없다 (cascade로 근거가 사라진다)', async () => {
      // 아키텍처 검토 BLOCKER 2-2. `evidence_set`에 DELETE 가드가 없으면
      // 부모를 지우는 것으로 cascade가 자식을 데려간다. 그때 자식 가드는
      // 부모가 이미 사라져 `parent_status = NULL`을 읽고 **열린 채 통과**한다.
      // 0011:33-36이 "evidence_set의 불변은 CC-230까지 애플리케이션 계층"
      // 이라고 적어 둔 숙제가 UPDATE만 닫고 DELETE를 열어 둔 상태였다.
      const target = await withClient(url, (c) => insertEvFixture(c, 'ev-del'));
      await withClient(url, (c) =>
        c.query(
          `UPDATE evidence_set SET status='FROZEN', frozen_at=now(), frozen_by=$2
            WHERE evidence_set_id = $1`,
          [target.setId, target.userId],
        ),
      );

      expect(
        await errCode(() =>
          asApp(url, target.tenantId, (c) =>
            c.query(`DELETE FROM evidence_set WHERE evidence_set_id = $1`, [target.setId]),
          ),
        ),
      ).toBe('42501');

      const still = await withClient(url, (c) =>
        c.query(`SELECT count(*)::int n FROM evidence_item WHERE evidence_set_id = $1`, [
          target.setId,
        ]),
      );
      expect(still.rows[0].n).toBe(1);
    });

    it('une_app으로도 동결된 집합·근거를 바꿀 수 없다', async () => {
      // 검토 지적 2-4: 동결 불변 시험이 superuser로만 돌고 있었다. 정작
      // 위험한 주체는 RLS·GRANT를 실제로 받는 `une_app`이다.
      const target = await withClient(url, (c) => insertEvFixture(c, 'ev-app'));
      await withClient(url, (c) =>
        c.query(
          `UPDATE evidence_set SET status='FROZEN', frozen_at=now(), frozen_by=$2
            WHERE evidence_set_id = $1`,
          [target.setId, target.userId],
        ),
      );
      for (const sql of [
        `UPDATE evidence_set SET query_text='바꿈' WHERE evidence_set_id = $1`,
        `DELETE FROM evidence_item WHERE evidence_set_id = $1`,
      ]) {
        expect(
          await errCode(() => asApp(url, target.tenantId, (c) => c.query(sql, [target.setId]))),
          sql,
        ).toBe('42501');
      }
    });

    it('DRAFT는 여전히 고칠 수 있다 (불변이 너무 일찍 걸리지 않는다)', async () => {
      const n = await withClient(url, async (c) => {
        const r = await c.query(
          `UPDATE evidence_item SET is_selected = false, excluded_reason = '공식 매뉴얼과 충돌'
            WHERE evidence_item_id = $1`,
          [b.itemId],
        );
        return r.rowCount;
      });
      expect(n).toBe(1);
    });

    it('제외에는 사유가 있어야 한다', async () => {
      expect(
        await errCode(() =>
          withClient(url, (c) =>
            c.query(
              `UPDATE evidence_item SET is_selected = false, excluded_reason = NULL
                      WHERE evidence_item_id = $1`,
              [b.itemId],
            ),
          ),
        ),
      ).toBe('23514');
    });
  });
});
