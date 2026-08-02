import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HwpxEngine, isInStaticRegion } from '@une/hwpx-engine';
import type { BlockIR, DocumentIR } from '@une/domain';
import { createApp } from '../app.factory';
import { buildMockExternalToken } from '../auth/mock-sso';
import type { ApiConfig } from '../config/api-config';
import { DocumentImportService } from '../document/document-import.service';

/**
 * CC-150 UNE-DOC-005~009 e2e.
 *
 * 실제 PostgreSQL과 실제 HWPX 원본(`templete/`)을 쓴다. 편집 층의 계약은
 * "동시에 두 요청이 오면 무슨 일이 일어나는가"가 절반이라, mock DB로는
 * 증명할 수 없다(.claude/rules/testing.md concurrency).
 */

const ADMIN_URL = process.env.DATABASE_URL;
const SECRET = 'e2e-signing-secret-e2e-signing-secret!!';
const REPO_ROOT = resolve(process.cwd(), '..', '..');
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'database', 'migrations');
const TEMPLATE = resolve(REPO_ROOT, 'templete', '간략 보고 양식.hwpx');

interface Fixtures {
  tenantA: string;
  tenantB: string;
  adminA: string;
  plainA: string;
  userB: string;
}

interface DocFixture {
  documentId: string;
  revisionId: string;
  /** 정적영역 밖에 있고 본문이 있는 문단 — 편집 대상. */
  editableParagraphId: string;
  editableTextLength: number;
  sectionId: string;
}

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function insertFixtures(c: Client): Promise<Fixtures> {
  const tenant = async (code: string): Promise<string> =>
    (
      await c.query(
        `INSERT INTO tenant (tenant_code, tenant_name, status) VALUES ($1, $1, 'ACTIVE')
         RETURNING tenant_id`,
        [code],
      )
    ).rows[0].tenant_id as string;
  const tenantA = await tenant('doc-a');
  const tenantB = await tenant('doc-b');
  const user = async (tenantId: string, login: string): Promise<string> =>
    (
      await c.query(
        `INSERT INTO app_user (tenant_id, login_id, display_name, status)
         VALUES ($1, $2, $2, 'ACTIVE') RETURNING user_id`,
        [tenantId, login],
      )
    ).rows[0].user_id as string;
  const adminA = await user(tenantA, 'admin-a');
  const plainA = await user(tenantA, 'plain-a');
  const userB = await user(tenantB, 'user-b');
  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT r.role_id, p.permission_id
     FROM role r JOIN permission p
       ON p.permission_code IN ('DOC_READ','DOC_EDIT','PLAN_CREATE','PLAN_READ','PLAN_EDIT')
     WHERE r.tenant_id IS NULL AND r.role_code = 'INSTITUTION_ADMIN'
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
  );
  await c.query(
    `INSERT INTO user_role (user_id, role_id, granted_by)
     SELECT u.user_id, r.role_id, u.user_id
     FROM app_user u, role r
     WHERE r.tenant_id IS NULL AND r.role_code = 'INSTITUTION_ADMIN'
       AND u.user_id = ANY($1::uuid[])`,
    [[adminA, userB]],
  );
  return { tenantA, tenantB, adminA, plainA, userB };
}

/** 픽스처 HWPX에서 편집 가능한 문단을 고른다: 정적영역 밖 + 본문 존재.
 * 정적영역(결재란 등)을 골라 버리면 편집이 STATIC_REGION으로 거부되고,
 * 그러면 테스트가 검증하려는 ETag/동시성 경로에 도달하지 못한다. */
function pickEditableParagraph(): { paragraphId: string; textLength: number; sectionId: string } {
  const engine = new HwpxEngine();
  const analysis = engine.analyzeDocument({
    bytes: new Uint8Array(readFileSync(TEMPLATE)),
    fileName: TEMPLATE,
  });
  const anchors = analysis.profile.staticRegions.map((region) => region.locator);
  const section = analysis.ir.sections[0];
  for (const block of section.blocks) {
    if (block.kind !== 'PARAGRAPH') continue;
    const text = block.runs.map((run) => run.text).join('');
    if (text.length <= 5 || block.editState.locked) continue;
    // AUTHORED 노드에는 앵커가 없다(NodeProvenance 판별 유니온). 가져온 직후이므로
    // 실제로는 전부 SOURCE지만, 타입이 그 사실을 알지 못하므로 명시적으로 좁힌다.
    if (isInStaticRegion(block.rawXmlAnchor ?? null, anchors)) continue;
    return {
      paragraphId: block.paragraphId,
      textLength: text.length,
      sectionId: section.sectionId,
    };
  }
  throw new Error('픽스처에 편집 가능한 문단이 없습니다');
}

function paragraphText(ir: DocumentIR, paragraphId: string): string | null {
  const walk = (blocks: readonly BlockIR[]): string | null => {
    for (const block of blocks) {
      if (block.kind === 'PARAGRAPH' && block.paragraphId === paragraphId) {
        return block.runs.map((run) => run.text).join('');
      }
      if (block.kind === 'TABLE') {
        for (const row of block.rows) {
          for (const cell of row.cells) {
            const found = walk(cell.blocks);
            if (found !== null) return found;
          }
        }
      }
    }
    return null;
  };
  for (const section of ir.sections) {
    const found = walk(section.blocks);
    if (found !== null) return found;
  }
  return null;
}

describe.skipIf(!ADMIN_URL || !existsSync(TEMPLATE))(
  'CC-150 문서 편집 e2e (UNE-DOC-005~009)',
  () => {
    let dbName: string;
    let app: INestApplication;
    let base: string;
    let dbUrl: string;
    let fx: Fixtures;
    let tokenA: string;
    let tokenB: string;
    let tokenPlain: string;
    let importer: DocumentImportService;
    let editable: ReturnType<typeof pickEditableParagraph>;

    const login = async (tenantId: string, loginId: string): Promise<string> => {
      const res = await fetch(`${base}/api/v1/auth/sso/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ externalToken: buildMockExternalToken({ tenantId, loginId }) }),
      });
      expect(res.status).toBe(200);
      return ((await res.json()) as { data: { accessToken: string } }).data.accessToken;
    };

    const call = async (
      method: string,
      path: string,
      token: string,
      options: { body?: unknown; ifMatch?: string } = {},
    ): Promise<Response> =>
      fetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...(options.ifMatch === undefined ? {} : { 'if-match': options.ifMatch }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });

    /** 테넌트 A에 새 문서 하나(revision 1 = IMPORT). */
    const importDocument = async (
      tenantId = fx.tenantA,
      userId = fx.adminA,
    ): Promise<DocFixture> => {
      const result = await importer.importFromFile(
        { tenantId, userId, sessionId: randomUUID() },
        TEMPLATE,
        { title: '편집 e2e 문서' },
        { correlationId: `corr_${randomUUID().replace(/-/g, '').slice(0, 16)}` },
      );
      return {
        documentId: result.documentId,
        revisionId: result.revisionId,
        editableParagraphId: editable.paragraphId,
        editableTextLength: editable.textLength,
        sectionId: editable.sectionId,
      };
    };

    const replaceOp = (doc: DocFixture, revisionId: string, text: string): unknown => ({
      type: 'REPLACE_RANGE',
      order: 0,
      selection: {
        kind: 'TEXT_RANGE',
        baseRevisionId: revisionId,
        start: { paragraphId: doc.editableParagraphId, offset: 0 },
        end: { paragraphId: doc.editableParagraphId, offset: 3 },
      },
      payload: { text },
    });

    beforeAll(async () => {
      if (!existsSync(MIGRATIONS_DIR))
        throw new Error(`migrations dir not found: ${MIGRATIONS_DIR}`);
      editable = pickEditableParagraph();
      const adminUrl = new URL(ADMIN_URL as string);
      dbName = `cc150_e2e_${randomUUID().slice(0, 8)}`;
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
      await runner({
        databaseUrl: dbUrl,
        dir: MIGRATIONS_DIR,
        migrationsTable: 'pgmigrations',
        ignorePattern: '\\..*|README\\.md',
        direction: 'up',
        logger: { info: () => {}, warn: () => {}, error: console.error, debug: () => {} },
      });
      fx = await withClient(dbUrl, insertFixtures);

      const config: ApiConfig = {
        port: 0,
        authMode: 'mock',
        jwtSecret: SECRET,
        accessTtlSec: 900,
        refreshTtlSec: 3600,
        databaseUrl: dbUrl,
        runtimeRole: 'une_app',
      };
      app = await createApp(config);
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
      importer = app.get(DocumentImportService);
      tokenA = await login(fx.tenantA, 'admin-a');
      tokenB = await login(fx.tenantB, 'user-b');
      tokenPlain = await login(fx.tenantA, 'plain-a');
    }, 240_000);

    afterEach(() => {
      vi.restoreAllMocks();
    });

    afterAll(async () => {
      if (app) await app.close();
      if (dbName) {
        await withClient(ADMIN_URL as string, (c) =>
          c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`),
        );
      }
    });

    // ── UNE-DOC-005 ───────────────────────────────────────────────────────

    it('IR을 head/특정 revision으로 조회하고 ETag를 함께 낸다', async () => {
      const doc = await importDocument();
      const res = await call('GET', `/api/v1/documents/${doc.documentId}/ir`, tokenA);
      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toBe('"1"');
      const data = (
        (await res.json()) as {
          data: {
            revisionId: string;
            revisionNo: number;
            origin: string;
            checkpointLabel: string;
            headRevisionNo: number;
            irVersion: string;
            liftedFromV1: boolean;
            ir: DocumentIR;
          };
        }
      ).data;
      expect(data.revisionId).toBe(doc.revisionId);
      expect(data.revisionNo).toBe(1);
      expect(data.origin).toBe('IMPORT');
      expect(data.checkpointLabel).toBe('생성전');
      expect(data.headRevisionNo).toBe(1);
      expect(data.irVersion).toBe('2');
      expect(data.liftedFromV1).toBe(false);
      expect(data.ir.documentId).toBe(doc.documentId);
      expect(paragraphText(data.ir, doc.editableParagraphId)).not.toBeNull();

      // 명시 revisionId도 같은 결과.
      const pinned = await call(
        'GET',
        `/api/v1/documents/${doc.documentId}/ir?revisionId=${doc.revisionId}`,
        tokenA,
      );
      expect(pinned.status).toBe(200);
      expect(pinned.headers.get('etag')).toBe('"1"');
    });

    it('v1로 적힌 ir_json은 읽기 시 v2로 승격된다(liftV1, ADR-30 D3)', async () => {
      const doc = await importDocument();
      // 저장된 행을 v1로 되돌린다(origin 제거 + irVersion 강등) — 구버전 코드가 쓴
      // 행을 재현하는 유일한 방법이다.
      await withClient(dbUrl, (c) =>
        c.query(
          `UPDATE document_revision
         SET ir_json = jsonb_set(
               (ir_json #- '{sections,0,blocks,0,origin}'),
               '{irVersion}', '"1"')
         WHERE revision_id = $1`,
          [doc.revisionId],
        ),
      );
      const res = await call('GET', `/api/v1/documents/${doc.documentId}/ir`, tokenA);
      expect(res.status).toBe(200);
      const data = (
        (await res.json()) as { data: { irVersion: string; liftedFromV1: boolean; ir: DocumentIR } }
      ).data;
      expect(data.liftedFromV1).toBe(true);
      expect(data.irVersion).toBe('2');
      // 승격이 하는 일은 origin 주입뿐이다.
      expect(data.ir.sections[0].blocks[0].origin).toBe('SOURCE');
    });

    it('없는 문서는 DOC-404-002, 없는 revision은 DOC-404-001, 타 테넌트도 404다', async () => {
      const doc = await importDocument();
      const missingDoc = await call('GET', `/api/v1/documents/${randomUUID()}/ir`, tokenA);
      expect(missingDoc.status).toBe(404);
      expect(((await missingDoc.json()) as { error: { code: string } }).error.code).toBe(
        'DOC-404-002',
      );

      const missingRev = await call(
        'GET',
        `/api/v1/documents/${doc.documentId}/ir?revisionId=${randomUUID()}`,
        tokenA,
      );
      expect(missingRev.status).toBe(404);
      expect(((await missingRev.json()) as { error: { code: string } }).error.code).toBe(
        'DOC-404-001',
      );

      const crossTenant = await call('GET', `/api/v1/documents/${doc.documentId}/ir`, tokenB);
      expect(crossTenant.status).toBe(404);
    });

    // ── UNE-DOC-006 ETag 매트릭스 ─────────────────────────────────────────

    it('ETag 매트릭스: 부재 428 / 형식오류 400 / 불일치 409(+헤더·meta) / 성공 시 새 ETag', async () => {
      const doc = await importDocument();
      const body = {
        baseRevisionId: doc.revisionId,
        origin: 'USER',
        clientMutationId: `m-${randomUUID().slice(0, 8)}`,
        operations: [replaceOp(doc, doc.revisionId, '수정')],
      };

      const missing = await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        body,
      });
      expect(missing.status).toBe(428);
      expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('COM-0428');

      const malformed = await call(
        'POST',
        `/api/v1/documents/${doc.documentId}/changesets`,
        tokenA,
        {
          body,
          ifMatch: 'W/"1"',
        },
      );
      expect(malformed.status).toBe(400);
      expect(((await malformed.json()) as { error: { code: string } }).error.code).toBe('COM-0400');

      // 성공 → 새 ETag.
      const applied = await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        body,
        ifMatch: '"1"',
      });
      expect(applied.status).toBe(200);
      expect(applied.headers.get('etag')).toBe('"2"');
      const result = (
        (await applied.json()) as {
          data: {
            applied: boolean;
            newRevisionId: string;
            newRevisionNo: number;
            diff: unknown[];
            changeSetId: string;
          };
        }
      ).data;
      expect(result.applied).toBe(true);
      expect(result.newRevisionNo).toBe(2);
      expect(result.diff.length).toBeGreaterThan(0);

      // 낡은 ETag로 다시 → 409 + 헤더 + meta.conflict.
      const stale = await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        body: { ...body, clientMutationId: `m-${randomUUID().slice(0, 8)}` },
        ifMatch: '"1"',
      });
      expect(stale.status).toBe(409);
      expect(stale.headers.get('etag')).toBe('"2"');
      const conflict = (await stale.json()) as {
        error: { code: string; recoverable: boolean };
        meta: {
          conflict: { currentRevisionNo: number; currentRevisionId: string; headIrHash: string };
        };
      };
      expect(conflict.error.code).toBe('DOC-409-001');
      expect(conflict.error.recoverable).toBe(true);
      expect(conflict.meta.conflict.currentRevisionNo).toBe(2);
      expect(conflict.meta.conflict.currentRevisionId).toBe(result.newRevisionId);
      expect(conflict.meta.conflict.headIrHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('baseRevisionId와 If-Match가 어긋나면 422 DOC-422-004다(자기모순 요청)', async () => {
      const doc = await importDocument();
      // revision 2를 만들어 두 개의 서로 다른 리비전을 확보한다.
      const first = await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        ifMatch: '"1"',
        body: {
          baseRevisionId: doc.revisionId,
          origin: 'USER',
          clientMutationId: `m-${randomUUID().slice(0, 8)}`,
          operations: [replaceOp(doc, doc.revisionId, '가')],
        },
      });
      expect(first.status).toBe(200);

      // If-Match는 head(2)를 가리키는데 baseRevisionId는 revision 1이다.
      const contradiction = await call(
        'POST',
        `/api/v1/documents/${doc.documentId}/changesets`,
        tokenA,
        {
          ifMatch: '"2"',
          body: {
            baseRevisionId: doc.revisionId,
            origin: 'USER',
            clientMutationId: `m-${randomUUID().slice(0, 8)}`,
            operations: [replaceOp(doc, doc.revisionId, '나')],
          },
        },
      );
      expect(contradiction.status).toBe(422);
      const error = (await contradiction.json()) as {
        error: { code: string; violations: { field: string; reason: string }[] };
      };
      expect(error.error.code).toBe('DOC-422-004');
      expect(error.error.violations[0].field).toBe('baseRevisionId');
      expect(error.error.violations[0].reason).toContain('If-Match');
    });

    it('동시성: 같은 baseRevisionId로 두 건을 동시에 보내면 정확히 1성공 1×409다', async () => {
      const doc = await importDocument();
      const request = (text: string): Promise<Response> =>
        call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
          ifMatch: '"1"',
          body: {
            baseRevisionId: doc.revisionId,
            origin: 'USER',
            clientMutationId: `m-${randomUUID().slice(0, 8)}`,
            operations: [replaceOp(doc, doc.revisionId, text)],
          },
        });
      const [a, b] = await Promise.all([request('동시가'), request('동시나')]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);

      const loser = a.status === 409 ? a : b;
      expect(loser.headers.get('etag')).toBe('"2"');
      expect(((await loser.json()) as { error: { code: string } }).error.code).toBe('DOC-409-001');

      // 리비전은 정확히 두 개(IMPORT + 승자 하나)여야 한다.
      const rows = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int AS n FROM document_revision WHERE document_id = $1`, [
          doc.documentId,
        ]),
      );
      expect(rows.rows[0].n).toBe(2);
    });

    it('멱등: 같은 clientMutationId 재전송은 같은 결과, 다른 payload는 409 COM-0409다', async () => {
      const doc = await importDocument();
      const mutationId = `m-${randomUUID().slice(0, 8)}`;
      const body = {
        baseRevisionId: doc.revisionId,
        origin: 'USER',
        clientMutationId: mutationId,
        operations: [replaceOp(doc, doc.revisionId, '멱등')],
      };
      const first = await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        ifMatch: '"1"',
        body,
      });
      expect(first.status).toBe(200);
      const firstData = (
        (await first.json()) as { data: { changeSetId: string; newRevisionId: string } }
      ).data;

      // 재전송: head는 이미 2지만 멱등 판정이 낙관잠금보다 먼저다 — 재전송은
      // 새 편집이 아니므로 If-Match가 낡았다는 이유로 실패해선 안 된다.
      const replay = await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        ifMatch: '"1"',
        body,
      });
      expect(replay.status).toBe(200);
      const replayData = (
        (await replay.json()) as {
          data: { changeSetId: string; newRevisionId: string; replayed: boolean };
        }
      ).data;
      expect(replayData.replayed).toBe(true);
      expect(replayData.changeSetId).toBe(firstData.changeSetId);
      expect(replayData.newRevisionId).toBe(firstData.newRevisionId);

      const mismatch = await call(
        'POST',
        `/api/v1/documents/${doc.documentId}/changesets`,
        tokenA,
        {
          ifMatch: '"2"',
          body: { ...body, operations: [replaceOp(doc, doc.revisionId, '다른내용')] },
        },
      );
      expect(mismatch.status).toBe(409);
      expect(((await mismatch.json()) as { error: { code: string } }).error.code).toBe('COM-0409');

      // 재전송으로 리비전이 늘지 않았다.
      const rows = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int AS n FROM document_revision WHERE document_id = $1`, [
          doc.documentId,
        ]),
      );
      expect(rows.rows[0].n).toBe(2);
    });

    it('dryRun은 Diff만 만들고 리비전·ChangeSet·연산 행을 하나도 쓰지 않는다', async () => {
      const doc = await importDocument();
      const res = await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        ifMatch: '"1"',
        body: {
          baseRevisionId: doc.revisionId,
          origin: 'AI',
          clientMutationId: `m-${randomUUID().slice(0, 8)}`,
          dryRun: true,
          operations: [replaceOp(doc, doc.revisionId, '미리보기')],
        },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toBe('"1"');
      const data = (
        (await res.json()) as {
          data: { dryRun: boolean; applied: boolean; changeSetId: null; diff: unknown[] };
        }
      ).data;
      expect(data.dryRun).toBe(true);
      expect(data.applied).toBe(false);
      expect(data.changeSetId).toBeNull();
      expect(data.diff.length).toBeGreaterThan(0);

      const counts = await withClient(dbUrl, async (c) => ({
        revisions: (
          await c.query(`SELECT count(*)::int AS n FROM document_revision WHERE document_id=$1`, [
            doc.documentId,
          ])
        ).rows[0].n as number,
        changeSets: (
          await c.query(`SELECT count(*)::int AS n FROM change_set WHERE document_id=$1`, [
            doc.documentId,
          ])
        ).rows[0].n as number,
      }));
      expect(counts).toEqual({ revisions: 1, changeSets: 0 });
    });

    it('적용 불가 편집은 422 DOC-422-004이고 거절 기록이 남는다(문서는 불변)', async () => {
      const doc = await importDocument();
      const res = await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        ifMatch: '"1"',
        body: {
          baseRevisionId: doc.revisionId,
          origin: 'USER',
          clientMutationId: `m-${randomUUID().slice(0, 8)}`,
          operations: [
            {
              type: 'DELETE_RANGE',
              order: 0,
              selection: {
                kind: 'BLOCK',
                baseRevisionId: doc.revisionId,
                blockIds: ['P-DOES-NOT-EXIST'],
              },
            },
          ],
        },
      });
      expect(res.status).toBe(422);
      const error = (await res.json()) as {
        error: { code: string; violations: { field: string; reason: string }[] };
      };
      expect(error.error.code).toBe('DOC-422-004');
      expect(error.error.violations[0].reason).toContain('NODE_NOT_FOUND');

      const state = await withClient(dbUrl, async (c) => ({
        revisions: (
          await c.query(`SELECT count(*)::int AS n FROM document_revision WHERE document_id=$1`, [
            doc.documentId,
          ])
        ).rows[0].n as number,
        rejected: (
          await c.query(
            `SELECT count(*)::int AS n FROM change_set WHERE document_id=$1 AND status='REJECTED'`,
            [doc.documentId],
          )
        ).rows[0].n as number,
        audits: (
          await c.query(
            `SELECT count(*)::int AS n FROM audit_log
           WHERE resource_id=$1 AND action='CHANGESET_REJECTED'`,
            [doc.documentId],
          )
        ).rows[0].n as number,
      }));
      expect(state).toEqual({ revisions: 1, rejected: 1, audits: 1 });
    });

    it('구조가 틀린 요청은 엔진에 닿기 전에 400이다(400과 422의 경계)', async () => {
      const doc = await importDocument();
      const res = await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        ifMatch: '"1"',
        body: {
          baseRevisionId: doc.revisionId,
          origin: 'USER',
          clientMutationId: `m-${randomUUID().slice(0, 8)}`,
          operations: [
            {
              type: 'REPLACE_RANGE',
              order: 0,
              // 화면좌표는 계약에 존재하지 않는다(§1.8-4).
              selection: {
                kind: 'BLOCK',
                baseRevisionId: doc.revisionId,
                blockIds: ['P-1'],
                x: 12,
              },
            },
          ],
        },
      });
      expect(res.status).toBe(400);
      const error = (await res.json()) as {
        error: { code: string; violations: { field: string }[] };
      };
      expect(error.error.code).toBe('COM-0400');
      expect(error.error.violations.map((v) => v.field)).toContain('operations[0].selection.x');
    });

    // ── UNE-DOC-007 / 008 ─────────────────────────────────────────────────

    it('Revision 목록은 최신순 페이지에 origin/checkpointLabel/isHead를 싣는다', async () => {
      const doc = await importDocument();
      await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        ifMatch: '"1"',
        body: {
          baseRevisionId: doc.revisionId,
          origin: 'USER',
          clientMutationId: `m-${randomUUID().slice(0, 8)}`,
          checkpointLabel: '초안완료',
          changeSummary: '개요 문단 수정',
          operations: [replaceOp(doc, doc.revisionId, '이력')],
        },
      });

      const res = await call('GET', `/api/v1/documents/${doc.documentId}/revisions`, tokenA);
      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toBe('"2"');
      const page = (
        (await res.json()) as {
          data: {
            items: {
              revisionNo: number;
              origin: string;
              checkpointLabel: string | null;
              isHead: boolean;
              changeSummary: string | null;
            }[];
            totalElements: number;
            headRevisionNo: number;
          };
        }
      ).data;
      expect(page.totalElements).toBe(2);
      expect(page.headRevisionNo).toBe(2);
      expect(page.items[0]).toMatchObject({
        revisionNo: 2,
        origin: 'CHANGESET',
        checkpointLabel: '초안완료',
        isHead: true,
        changeSummary: '개요 문단 수정',
      });
      expect(page.items[1]).toMatchObject({ revisionNo: 1, origin: 'IMPORT', isHead: false });
      // 목록은 본문을 싣지 않는다.
      expect(page.items[0]).not.toHaveProperty('ir');

      const paged = await call(
        'GET',
        `/api/v1/documents/${doc.documentId}/revisions?page=2&size=1`,
        tokenA,
      );
      const second = ((await paged.json()) as { data: { items: { revisionNo: number }[] } }).data;
      expect(second.items).toHaveLength(1);
      expect(second.items[0].revisionNo).toBe(1);

      const badPage = await call(
        'GET',
        `/api/v1/documents/${doc.documentId}/revisions?size=0`,
        tokenA,
      );
      expect(badPage.status).toBe(400);
    });

    it('복원은 과거 revision을 건드리지 않고 새 head를 만든다(US-PLAN-020 AC-01)', async () => {
      const doc = await importDocument();
      const originalText = await (async () => {
        const res = await call('GET', `/api/v1/documents/${doc.documentId}/ir`, tokenA);
        return paragraphText(
          ((await res.json()) as { data: { ir: DocumentIR } }).data.ir,
          doc.editableParagraphId,
        );
      })();

      await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        ifMatch: '"1"',
        body: {
          baseRevisionId: doc.revisionId,
          origin: 'USER',
          clientMutationId: `m-${randomUUID().slice(0, 8)}`,
          operations: [replaceOp(doc, doc.revisionId, '덮어씀')],
        },
      });

      const before = await withClient(dbUrl, (c) =>
        c.query(`SELECT ir_hash, ir_json FROM document_revision WHERE revision_id=$1`, [
          doc.revisionId,
        ]),
      );

      const missingIfMatch = await call(
        'POST',
        `/api/v1/documents/${doc.documentId}/revisions/${doc.revisionId}/restore`,
        tokenA,
        { body: { reason: '되돌리기' } },
      );
      expect(missingIfMatch.status).toBe(428);

      const staleIfMatch = await call(
        'POST',
        `/api/v1/documents/${doc.documentId}/revisions/${doc.revisionId}/restore`,
        tokenA,
        { ifMatch: '"1"', body: { reason: '되돌리기' } },
      );
      expect(staleIfMatch.status).toBe(409);
      expect(staleIfMatch.headers.get('etag')).toBe('"2"');
      expect(((await staleIfMatch.json()) as { error: { code: string } }).error.code).toBe(
        'DOC-409-002',
      );

      const restored = await call(
        'POST',
        `/api/v1/documents/${doc.documentId}/revisions/${doc.revisionId}/restore`,
        tokenA,
        { ifMatch: '"2"', body: { reason: '승인 전 초안으로 되돌림' } },
      );
      expect(restored.status).toBe(200);
      expect(restored.headers.get('etag')).toBe('"3"');
      const data = (
        (await restored.json()) as {
          data: {
            revision: { revisionNo: number; origin: string; parentRevisionId: string };
            restoredFromRevisionNo: number;
            changeSetId: string;
          };
        }
      ).data;
      expect(data.revision.revisionNo).toBe(3);
      expect(data.revision.origin).toBe('RESTORE');
      expect(data.restoredFromRevisionNo).toBe(1);

      // 과거 revision은 한 바이트도 변하지 않았다.
      const after = await withClient(dbUrl, (c) =>
        c.query(`SELECT ir_hash, ir_json FROM document_revision WHERE revision_id=$1`, [
          doc.revisionId,
        ]),
      );
      expect(after.rows[0].ir_hash).toBe(before.rows[0].ir_hash);
      expect(after.rows[0].ir_json).toEqual(before.rows[0].ir_json);

      // 새 head의 본문이 원본과 같다.
      const head = await call('GET', `/api/v1/documents/${doc.documentId}/ir`, tokenA);
      const headIr = ((await head.json()) as { data: { ir: DocumentIR } }).data.ir;
      expect(paragraphText(headIr, doc.editableParagraphId)).toBe(originalText);

      // 복원은 ChangeSet을 남기되 연산 행은 만들지 않는다.
      const rows = await withClient(dbUrl, async (c) => ({
        origin: (
          await c.query(`SELECT origin FROM change_set WHERE change_set_id=$1`, [data.changeSetId])
        ).rows[0].origin as string,
        operations: (
          await c.query(`SELECT count(*)::int AS n FROM change_operation WHERE change_set_id=$1`, [
            data.changeSetId,
          ])
        ).rows[0].n as number,
        audits: (
          await c.query(
            `SELECT action FROM audit_log WHERE resource_id=$1 AND action IN ('REVISION_RESTORED','REVISION_SAVED') ORDER BY action`,
            [doc.documentId],
          )
        ).rows.map((row: { action: string }) => row.action),
      }));
      expect(rows.origin).toBe('RESTORE');
      expect(rows.operations).toBe(0);
      expect(rows.audits).toContain('REVISION_RESTORED');
    });

    it('head를 자기 자신으로 복원하는 요청은 422다', async () => {
      const doc = await importDocument();
      const res = await call(
        'POST',
        `/api/v1/documents/${doc.documentId}/revisions/${doc.revisionId}/restore`,
        tokenA,
        { ifMatch: '"1"' },
      );
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('DOC-422-004');
    });

    // ── UNE-DOC-009 ───────────────────────────────────────────────────────

    it('자동저장: batch 1건 = 저널 1행 + ChangeSet 1건 + revision 1건', async () => {
      const doc = await importDocument();
      const mutationId = `a-${randomUUID().slice(0, 8)}`;
      const body = {
        baseRevisionId: doc.revisionId,
        clientMutationId: mutationId,
        seq: 1,
        delta: { operations: [replaceOp(doc, doc.revisionId, '자동')] },
      };
      const res = await call('POST', `/api/v1/documents/${doc.documentId}/autosaves`, tokenA, {
        ifMatch: '"1"',
        body,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toBe('"2"');
      const receipt = (
        (await res.json()) as {
          data: {
            status: string;
            seq: string;
            resultRevisionNo: number;
            irHash: string;
            replayed: boolean;
          };
        }
      ).data;
      expect(receipt.status).toBe('ACCEPTED');
      expect(receipt.seq).toBe('1');
      expect(receipt.resultRevisionNo).toBe(2);
      expect(receipt.irHash).toMatch(/^[0-9a-f]{64}$/);

      const counts = await withClient(dbUrl, async (c) => ({
        autosaves: (
          await c.query(`SELECT count(*)::int AS n FROM document_autosave WHERE document_id=$1`, [
            doc.documentId,
          ])
        ).rows[0].n as number,
        changeSets: (
          await c.query(
            `SELECT count(*)::int AS n FROM change_set WHERE document_id=$1 AND origin='AUTOSAVE'`,
            [doc.documentId],
          )
        ).rows[0].n as number,
        revisions: (
          await c.query(
            `SELECT count(*)::int AS n FROM document_revision WHERE document_id=$1 AND origin='AUTOSAVE'`,
            [doc.documentId],
          )
        ).rows[0].n as number,
        audit: (
          await c.query(
            `SELECT count(*)::int AS n FROM audit_log WHERE resource_id=$1 AND action='AUTOSAVE_SUCCESS'`,
            [doc.documentId],
          )
        ).rows[0].n as number,
      }));
      expect(counts).toEqual({ autosaves: 1, changeSets: 1, revisions: 1, audit: 1 });

      // 재전송 → 같은 receipt.
      const replay = await call('POST', `/api/v1/documents/${doc.documentId}/autosaves`, tokenA, {
        ifMatch: '"2"',
        body,
      });
      expect(replay.status).toBe(200);
      const replayed = (
        (await replay.json()) as { data: { autosaveId: string; replayed: boolean; status: string } }
      ).data;
      expect(replayed.replayed).toBe(true);
      expect(replayed.status).toBe('ACCEPTED');

      // 같은 키 + 다른 delta → 409 COM-0409.
      const mismatch = await call('POST', `/api/v1/documents/${doc.documentId}/autosaves`, tokenA, {
        ifMatch: '"2"',
        body: { ...body, delta: { operations: [replaceOp(doc, doc.revisionId, '다름')] } },
      });
      expect(mismatch.status).toBe(409);
      expect(((await mismatch.json()) as { error: { code: string } }).error.code).toBe('COM-0409');
    });

    it('자동저장 충돌은 409 DOC-409-003이고 판정 자체가 저널에 남는다(US-PLAN-020 AC-02)', async () => {
      const doc = await importDocument();
      await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        ifMatch: '"1"',
        body: {
          baseRevisionId: doc.revisionId,
          origin: 'USER',
          clientMutationId: `m-${randomUUID().slice(0, 8)}`,
          operations: [replaceOp(doc, doc.revisionId, '선행')],
        },
      });

      const res = await call('POST', `/api/v1/documents/${doc.documentId}/autosaves`, tokenA, {
        ifMatch: '"1"',
        body: {
          baseRevisionId: doc.revisionId,
          clientMutationId: `a-${randomUUID().slice(0, 8)}`,
          seq: 5,
          delta: { operations: [replaceOp(doc, doc.revisionId, '늦은저장')] },
        },
      });
      expect(res.status).toBe(409);
      expect(res.headers.get('etag')).toBe('"2"');
      const conflict = (await res.json()) as {
        error: { code: string };
        meta: { conflict: { currentRevisionNo: number } };
      };
      expect(conflict.error.code).toBe('DOC-409-003');
      expect(conflict.meta.conflict.currentRevisionNo).toBe(2);

      // 409로 끝났지만 CONFLICT 판정과 감사 기록은 커밋되어 있다.
      const journal = await withClient(dbUrl, async (c) => ({
        conflicts: (
          await c.query(
            `SELECT count(*)::int AS n FROM document_autosave WHERE document_id=$1 AND status='CONFLICT'`,
            [doc.documentId],
          )
        ).rows[0].n as number,
        audits: (
          await c.query(
            `SELECT count(*)::int AS n FROM audit_log WHERE resource_id=$1 AND action='AUTOSAVE_FAIL'`,
            [doc.documentId],
          )
        ).rows[0].n as number,
      }));
      expect(journal).toEqual({ conflicts: 1, audits: 1 });
    });

    it('늦게 도착한 batch는 SUPERSEDED로 무해하게 폐기된다(A-01 재동기화)', async () => {
      const doc = await importDocument();
      const accepted = await call('POST', `/api/v1/documents/${doc.documentId}/autosaves`, tokenA, {
        ifMatch: '"1"',
        body: {
          baseRevisionId: doc.revisionId,
          clientMutationId: `a-${randomUUID().slice(0, 8)}`,
          seq: 10,
          delta: { operations: [replaceOp(doc, doc.revisionId, '최신')] },
        },
      });
      expect(accepted.status).toBe(200);

      // 순번 3은 이미 반영된 10보다 앞이다 — 실패가 아니라 폐기다.
      const late = await call('POST', `/api/v1/documents/${doc.documentId}/autosaves`, tokenA, {
        ifMatch: '"1"',
        body: {
          baseRevisionId: doc.revisionId,
          clientMutationId: `a-${randomUUID().slice(0, 8)}`,
          seq: 3,
          delta: { operations: [replaceOp(doc, doc.revisionId, '늦음')] },
        },
      });
      expect(late.status).toBe(200);
      const receipt = (
        (await late.json()) as { data: { status: string; resultRevisionId: string | null } }
      ).data;
      expect(receipt.status).toBe('SUPERSEDED');
      expect(receipt.resultRevisionId).toBeNull();

      const revisions = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int AS n FROM document_revision WHERE document_id=$1`, [
          doc.documentId,
        ]),
      );
      expect(revisions.rows[0].n).toBe(2);
    });

    // ── 권한 · 감사 · 로그 ────────────────────────────────────────────────

    it('DOC_READ/DOC_EDIT 없는 사용자는 403이고 ACCESS_DENIED 감사가 남는다', async () => {
      const doc = await importDocument();
      const read = await call('GET', `/api/v1/documents/${doc.documentId}/ir`, tokenPlain);
      expect(read.status).toBe(403);
      const write = await call(
        'POST',
        `/api/v1/documents/${doc.documentId}/changesets`,
        tokenPlain,
        {
          ifMatch: '"1"',
          body: {
            baseRevisionId: doc.revisionId,
            origin: 'USER',
            clientMutationId: `m-${randomUUID().slice(0, 8)}`,
            operations: [replaceOp(doc, doc.revisionId, 'x')],
          },
        },
      );
      expect(write.status).toBe(403);
      const denied = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT count(*)::int AS n FROM audit_log
         WHERE tenant_id=$1 AND actor_id=$2 AND action='ACCESS_DENIED'`,
          [fx.tenantA, fx.plainA],
        ),
      );
      expect(denied.rows[0].n).toBeGreaterThanOrEqual(2);
    });

    it('적용은 CHANGESET_APPLIED와 REVISION_SAVED를 남기고 UNDO는 UNDO로 기록된다', async () => {
      const doc = await importDocument();
      const applied = await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        ifMatch: '"1"',
        body: {
          baseRevisionId: doc.revisionId,
          origin: 'USER',
          clientMutationId: `m-${randomUUID().slice(0, 8)}`,
          operations: [replaceOp(doc, doc.revisionId, '감사')],
        },
      });
      const first = (
        (await applied.json()) as { data: { changeSetId: string; newRevisionId: string } }
      ).data;

      const undone = await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        ifMatch: '"2"',
        body: {
          baseRevisionId: first.newRevisionId,
          origin: 'UNDO',
          undoesChangeSetId: first.changeSetId,
          clientMutationId: `m-${randomUUID().slice(0, 8)}`,
          operations: [replaceOp(doc, first.newRevisionId, '되돌림')],
        },
      });
      expect(undone.status).toBe(200);

      const rows = await withClient(dbUrl, async (c) => ({
        actions: (
          await c.query(
            `SELECT action, count(*)::int AS n FROM audit_log
           WHERE resource_id=$1 GROUP BY action ORDER BY action`,
            [doc.documentId],
          )
        ).rows as { action: string; n: number }[],
        lineage: (
          await c.query(
            `SELECT undoes_change_set_id FROM change_set
           WHERE document_id=$1 AND origin='UNDO'`,
            [doc.documentId],
          )
        ).rows[0].undoes_change_set_id as string,
        revisionOrigins: (
          await c.query(
            `SELECT origin FROM document_revision WHERE document_id=$1 ORDER BY revision_no`,
            [doc.documentId],
          )
        ).rows.map((row: { origin: string }) => row.origin),
      }));
      const names = rows.actions.map((row) => row.action);
      expect(names).toContain('CHANGESET_APPLIED');
      expect(names).toContain('REVISION_SAVED');
      expect(names).toContain('UNDO');
      expect(names).toContain('DOCUMENT_IMPORTED');
      expect(rows.lineage).toBe(first.changeSetId);
      expect(rows.revisionOrigins).toEqual(['IMPORT', 'CHANGESET', 'UNDO']);
    });

    it('문서 본문은 INFO 로그와 감사 detail 어디에도 실리지 않는다', async () => {
      const doc = await importDocument();
      const secret = `기밀본문-${randomUUID().slice(0, 8)}`;
      const logs: string[] = [];
      for (const level of ['log', 'info', 'warn', 'debug'] as const) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          logs.push(args.map((a) => String(a)).join(' '));
        });
      }

      const res = await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        ifMatch: '"1"',
        body: {
          baseRevisionId: doc.revisionId,
          origin: 'USER',
          clientMutationId: `m-${randomUUID().slice(0, 8)}`,
          operations: [replaceOp(doc, doc.revisionId, secret)],
        },
      });
      expect(res.status).toBe(200);
      expect(logs.join('\n')).not.toContain(secret);

      // change_operation에는 본문이 남는다(명령 저널, US-PLAN-020 AC-03)…
      const stored = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT count(*)::int AS n FROM change_operation co
         JOIN change_set cs ON cs.change_set_id = co.change_set_id
         WHERE cs.document_id=$1 AND co.target_json::text LIKE $2`,
          [doc.documentId, `%${secret}%`],
        ),
      );
      expect(stored.rows[0].n).toBe(1);

      // …그러나 감사 로그에는 남지 않는다(사유 코드와 식별자만).
      const audits = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT count(*)::int AS n FROM audit_log
         WHERE resource_id=$1 AND (coalesce(after_json::text,'') LIKE $2
                                OR coalesce(before_json::text,'') LIKE $2)`,
          [doc.documentId, `%${secret}%`],
        ),
      );
      expect(audits.rows[0].n).toBe(0);
    });

    // ── materialize (ADR-27 D4 3중 방어) ──────────────────────────────────

    /** 문서에 계획서·목차버전·생성블록을 붙인다. 계획서/목차 API를 통째로 태우면
     * 이 시험이 CC-120/130의 회귀시험이 되어 버리므로, 여기서는 materialize가
     * 읽는 상태만 직접 만든다. */
    const attachPlanWithBlocks = async (
      documentId: string,
      blocks: { nodeKey: string; text: string; protectionState: string; status: string }[],
    ): Promise<{ planId: string; currentTocVersionId: string; staleTocVersionId: string }> =>
      withClient(dbUrl, async (c) => {
        const planId = (
          await c.query(
            `INSERT INTO plan (tenant_id, title, hazard_type, management_phase, status,
                             document_id, owner_id, start_mode)
           VALUES ($1, 'materialize 대상', '폭염', '대비', 'EDITING', $2, $3, 'BLANK')
           RETURNING plan_id`,
            [fx.tenantA, documentId, fx.adminA],
          )
        ).rows[0].plan_id as string;
        const snapshot = (
          await c.query(
            `INSERT INTO plan_context_snapshot (plan_id, version_no, context_json, content_hash, confirmed_by)
           VALUES ($1, 1, '{}'::jsonb, $2, $3) RETURNING context_snapshot_id`,
            [planId, 'a'.repeat(64), fx.adminA],
          )
        ).rows[0].context_snapshot_id as string;
        const tocVersion = async (no: number): Promise<string> =>
          (
            await c.query(
              `INSERT INTO toc_version (plan_id, version_no, source_type, base_snapshot_id,
                                      status, content_hash, created_by)
             VALUES ($1, $2, 'USER', $3, 'CONFIRMED', $4, $5) RETURNING toc_version_id`,
              [planId, no, snapshot, String(no).repeat(64).slice(0, 64), fx.adminA],
            )
          ).rows[0].toc_version_id as string;
        const staleTocVersionId = await tocVersion(1);
        const currentTocVersionId = await tocVersion(2);
        await c.query(`UPDATE plan SET current_toc_version_id = $2 WHERE plan_id = $1`, [
          planId,
          currentTocVersionId,
        ]);
        for (const [index, block] of blocks.entries()) {
          await c.query(
            `INSERT INTO generated_block
             (plan_id, toc_version_id, node_key, generation_no, outline_level, sort_order,
              title, text_content, content_hash, status, protection_state, created_by)
           VALUES ($1, $2, $3, 1, 1, $4, $5, $6, $7, $8, $9, $10)`,
            [
              planId,
              currentTocVersionId,
              block.nodeKey,
              index,
              block.nodeKey,
              block.text,
              'b'.repeat(64),
              block.status,
              block.protectionState,
              fx.adminA,
            ],
          );
        }
        // 이전 세대(superseded)는 절대 읽히면 안 된다.
        await c.query(
          `INSERT INTO generated_block
           (plan_id, toc_version_id, node_key, generation_no, outline_level, sort_order,
            title, text_content, content_hash, status, protection_state, created_by, superseded_at)
         VALUES ($1, $2, 'n-old', 1, 1, 99, 'n-old', '이전 세대 본문', $3, 'GENERATED', 'NONE', $4, now())`,
          [planId, currentTocVersionId, 'c'.repeat(64), fx.adminA],
        );
        return { planId, currentTocVersionId, staleTocVersionId };
      });

    it('materialize: 현세대·비보호 블록만 넣고 제외 사유를 결과에 싣는다', async () => {
      const doc = await importDocument();
      const plan = await attachPlanWithBlocks(doc.documentId, [
        { nodeKey: 'n-1', text: '실체화 본문 1', protectionState: 'NONE', status: 'GENERATED' },
        {
          nodeKey: 'n-2',
          text: '보호된 본문',
          protectionState: 'USER_LOCKED',
          status: 'GENERATED',
        },
        { nodeKey: 'n-3', text: '실패 블록', protectionState: 'NONE', status: 'FAILED' },
      ]);

      const res = await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        ifMatch: '"1"',
        body: {
          baseRevisionId: doc.revisionId,
          origin: 'MATERIALIZE',
          clientMutationId: `mat-${randomUUID().slice(0, 8)}`,
          checkpointLabel: '초안완료',
          operations: [
            {
              type: 'INSERT_BLOCKS',
              order: 0,
              anchor: { relation: 'LAST_CHILD', ref: doc.sectionId },
              source: {
                kind: 'GENERATED_BLOCKS',
                planId: plan.planId,
                tocVersionId: plan.currentTocVersionId,
              },
            },
          ],
        },
      });
      expect(res.status).toBe(200);
      const data = (
        (await res.json()) as {
          data: {
            applied: boolean;
            newRevisionNo: number;
            warnings: string[];
            materialize: {
              candidateBlocks: number;
              insertedBlocks: number;
              excluded: { nodeKey: string; reason: string }[];
            };
          };
        }
      ).data;
      expect(data.applied).toBe(true);
      expect(data.newRevisionNo).toBe(2);
      // superseded 행은 후보에도 들지 않는다.
      expect(data.materialize.candidateBlocks).toBe(3);
      expect(data.materialize.insertedBlocks).toBe(1);
      expect(data.materialize.excluded).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ nodeKey: 'n-2', reason: 'PROTECTED_BLOCK(USER_LOCKED)' }),
          expect.objectContaining({ nodeKey: 'n-3', reason: 'NOT_GENERATED(FAILED)' }),
        ]),
      );
      expect(data.warnings.join(' ')).toContain('제외');

      const head = await call('GET', `/api/v1/documents/${doc.documentId}/ir`, tokenA);
      const ir = ((await head.json()) as { data: { ir: DocumentIR } }).data.ir;
      const text = JSON.stringify(ir);
      expect(text).toContain('실체화 본문 1');
      expect(text).not.toContain('보호된 본문');
      expect(text).not.toContain('이전 세대 본문');

      const origin = await withClient(dbUrl, (c) =>
        c.query(`SELECT origin FROM document_revision WHERE document_id=$1 AND revision_no=2`, [
          doc.documentId,
        ]),
      );
      expect(origin.rows[0].origin).toBe('MATERIALIZE');
    });

    it('materialize: 현재가 아닌 목차버전은 fail-closed 422다', async () => {
      const doc = await importDocument();
      const plan = await attachPlanWithBlocks(doc.documentId, [
        { nodeKey: 'n-1', text: '본문', protectionState: 'NONE', status: 'GENERATED' },
      ]);
      const res = await call('POST', `/api/v1/documents/${doc.documentId}/changesets`, tokenA, {
        ifMatch: '"1"',
        body: {
          baseRevisionId: doc.revisionId,
          origin: 'MATERIALIZE',
          clientMutationId: `mat-${randomUUID().slice(0, 8)}`,
          operations: [
            {
              type: 'INSERT_BLOCKS',
              order: 0,
              anchor: { relation: 'LAST_CHILD', ref: doc.sectionId },
              source: {
                kind: 'GENERATED_BLOCKS',
                planId: plan.planId,
                tocVersionId: plan.staleTocVersionId,
              },
            },
          ],
        },
      });
      expect(res.status).toBe(422);
      const error = (await res.json()) as {
        error: { code: string; violations: { reason: string }[] };
      };
      expect(error.error.code).toBe('DOC-422-004');
      expect(error.error.violations[0].reason).toContain('현재 목차버전이 아닙니다');

      const revisions = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int AS n FROM document_revision WHERE document_id=$1`, [
          doc.documentId,
        ]),
      );
      expect(revisions.rows[0].n).toBe(1);
    });

    it('가져오기가 template_profile과 style_prototype을 함께 만든다(UNE-DOC-004의 실제 테이블)', async () => {
      const doc = await importDocument();
      const rows = await withClient(dbUrl, async (c) => ({
        profiles: (
          await c.query(
            `SELECT template_profile_id, analysis_hash FROM template_profile WHERE document_id=$1`,
            [doc.documentId],
          )
        ).rows as { template_profile_id: string; analysis_hash: string }[],
        prototypes: (
          await c.query(
            `SELECT count(*)::int AS n FROM style_prototype sp
           JOIN template_profile tp ON tp.template_profile_id = sp.template_profile_id
           WHERE tp.document_id=$1`,
            [doc.documentId],
          )
        ).rows[0].n as number,
      }));
      expect(rows.profiles).toHaveLength(1);
      expect(rows.profiles[0].analysis_hash.trim()).toMatch(/^[0-9a-f]{64}$/);
      expect(rows.prototypes).toBeGreaterThan(0);
    });
  },
);
