import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { runner as migrate } from 'node-pg-migrate';
import { Client } from 'pg';
import { OBJECT_STORAGE, buildMockExternalToken, createApp, type ApiConfig } from '@une/api';
import { MockLegacyT3qPlanAdapter } from '@une/provider-adapters';
import {
  ContentJobRunner,
  ExportJobRunner,
  OutboxRelayRunner,
  SopJobRunner,
  TocJobRunner,
  WorkerDatabase,
  loadWorkerConfig,
} from '@une/worker';
import {
  MemoryObjectStorage,
  MockUniSopAdapter,
  createChannelRegistry,
} from '@une/provider-adapters';

/**
 * 슬라이스 E2E 하네스 (CC-170).
 *
 * API와 워커를 **한 프로세스에서** 돌린다. 두 프로세스로 띄우면 테스트가
 * 프로세스 감독까지 하게 되고, 실패했을 때 "무엇이 죽었나"가 먼저 문제가 된다.
 * 여기서 증명할 것은 프로세스 배치가 아니라 **경로가 이어진다**는 것이다.
 *
 * 저장소는 인메모리다. 실 MinIO에서의 서명·체크섬은 provider-adapters의 통합
 * 테스트가 증명하며, 여기서는 업로드 티켓이 API 전송 라우트를 가리키므로
 * 브라우저 없이 전 구간을 태울 수 있다.
 */

export const ADMIN_URL = process.env.DATABASE_URL;
export const REPO_ROOT = resolve(process.cwd(), '..', '..');
export const TEMPLATE_DIR = resolve(REPO_ROOT, 'templete');
export const SECRET = 'cc170-e2e-secret-cc170-e2e-secret!!';

export interface Fixtures {
  tenantA: string;
  tenantB: string;
  adminA: string;
  readerA: string;
  userB: string;
  /**
   * SOP 권한만 가진 사용자 (CC-240).
   *
   * 잡 엔드포인트는 `generation_job` 하나를 공유하므로, 유형 검사가 없으면
   * 이 사용자가 계획서 잡의 이벤트를 `PLAN_READ` 없이 읽는다. 그 경계를
   * 시험하려면 권한이 겹치지 않는 사용자가 하나 있어야 한다.
   */
  sopOnlyA: string;
  /**
   * 현장 담당자 둘 (CC-280).
   *
   * `TASK_ASSIGNEE` 권한은 **둘 다** 갖는다 — 그것만으로 남의 임무를 만질 수
   * 없다는 것이 이 항목의 핵심 방어이고, 그것을 시험하려면 권한은 같고
   * 배정만 다른 사용자가 둘 있어야 한다.
   */
  fieldA: string;
  fieldA2: string;
}

export interface Harness {
  dbName: string;
  dbUrl: string;
  app: INestApplication;
  base: string;
  fixtures: Fixtures;
  workerDb: WorkerDatabase;
  toc: TocJobRunner;
  content: ContentJobRunner;
  exports: ExportJobRunner;
  /** CC-240: SOP 생성 러너. UNI는 mock이다 — 실 UNI 지원이 아니다. */
  sop: SopJobRunner;
  /** CC-270: Outbox 릴레이. 채널은 SYSTEM만 진짜이고 나머지는 시뮬레이션이다. */
  outbox: OutboxRelayRunner;
  storage: MemoryObjectStorage;
  close(): Promise<void>;
}

export async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * 권한이 갈린 세 사용자를 만든다.
 *
 *   adminA  — 슬라이스 전 구간(업로드·계획·문서·Export)
 *   readerA — 읽기만. 권한 경로가 실제로 막히는지 보려면 필요하다.
 *   userB   — 다른 기관. 테넌트 격리의 반대편.
 */
export async function insertFixtures(c: Client): Promise<Fixtures> {
  const tenant = async (code: string): Promise<string> =>
    (
      await c.query(
        `INSERT INTO tenant (tenant_code, tenant_name, status) VALUES ($1, $1, 'ACTIVE')
         RETURNING tenant_id`,
        [code],
      )
    ).rows[0].tenant_id as string;
  const tenantA = await tenant('cc170-a');
  const tenantB = await tenant('cc170-b');

  const user = async (tenantId: string, login: string): Promise<string> =>
    (
      await c.query(
        `INSERT INTO app_user (tenant_id, login_id, display_name, status)
         VALUES ($1, $2, $2, 'ACTIVE') RETURNING user_id`,
        [tenantId, login],
      )
    ).rows[0].user_id as string;
  const adminA = await user(tenantA, 'admin-a');
  const readerA = await user(tenantA, 'reader-a');
  const userB = await user(tenantB, 'user-b');
  const sopOnlyA = await user(tenantA, 'sop-only-a');
  const fieldA = await user(tenantA, 'field-a');
  const fieldA2 = await user(tenantA, 'field-a2');

  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT r.role_id, p.permission_id
     FROM role r JOIN permission p
       ON p.permission_code IN ('PLAN_CREATE','PLAN_READ','PLAN_EDIT','PLAN_GENERATE',
                                'FILE_UPLOAD','DOC_READ','DOC_EDIT','DOC_EXPORT',
                                'SOP_GENERATE','SOP_READ','SOP_EDIT','SOP_APPROVE',
                                'SOP_RUN','SOP_RUN_CONTROL',
                                'TASK_DISPATCH','TASK_READ','TASK_SUPERVISE',
                                'DASHBOARD_READ','EXECUTION_READ','EXECUTION_CORRECT')
     WHERE r.tenant_id IS NULL AND r.role_code = 'INSTITUTION_ADMIN'
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
  );
  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT r.role_id, p.permission_id
     FROM role r JOIN permission p ON p.permission_code IN ('DOC_READ','PLAN_READ')
     WHERE r.tenant_id IS NULL AND r.role_code = 'VIEWER'
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
  await c.query(
    `INSERT INTO user_role (user_id, role_id, granted_by)
     SELECT u.user_id, r.role_id, u.user_id
     FROM app_user u, role r
     WHERE r.tenant_id IS NULL AND r.role_code = 'VIEWER' AND u.user_id = $1`,
    [readerA],
  );
  // SOP 권한만 — PLAN_*은 하나도 주지 않는다.
  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT r.role_id, p.permission_id
     FROM role r JOIN permission p ON p.permission_code IN ('SOP_GENERATE','SOP_READ')
     WHERE r.tenant_id IS NULL AND r.role_code = 'SOP_EDITOR'
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
  );
  await c.query(
    `INSERT INTO user_role (user_id, role_id, granted_by)
     SELECT u.user_id, r.role_id, u.user_id
     FROM app_user u, role r
     WHERE r.tenant_id IS NULL AND r.role_code = 'SOP_EDITOR' AND u.user_id = $1`,
    [sopOnlyA],
  );
  // 현장 담당자 — 임무 조회와 수행만. 감독 권한은 없다.
  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT r.role_id, p.permission_id
     FROM role r JOIN permission p ON p.permission_code IN ('TASK_READ','TASK_ASSIGNEE')
     WHERE r.tenant_id IS NULL AND r.role_code = 'TASK_ASSIGNEE'
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
  );
  await c.query(
    `INSERT INTO user_role (user_id, role_id, granted_by)
     SELECT u.user_id, r.role_id, u.user_id
     FROM app_user u, role r
     WHERE r.tenant_id IS NULL AND r.role_code = 'TASK_ASSIGNEE'
       AND u.user_id = ANY($1::uuid[])`,
    [[fieldA, fieldA2]],
  );
  return { tenantA, tenantB, adminA, readerA, userB, sopOnlyA, fieldA, fieldA2 };
}

export async function startHarness(label: string): Promise<Harness> {
  if (!ADMIN_URL) throw new Error('DATABASE_URL이 필요하다');
  const adminUrl = new URL(ADMIN_URL);
  const dbName = `${label}_${randomUUID().slice(0, 8)}`;
  await withClient(ADMIN_URL, (c) => c.query(`CREATE DATABASE ${dbName}`));
  adminUrl.pathname = `/${dbName}`;
  const dbUrl = adminUrl.toString();

  await migrate({
    databaseUrl: dbUrl,
    dir: resolve(REPO_ROOT, 'database', 'migrations'),
    migrationsTable: 'pgmigrations',
    ignorePattern: '\\..*|README\\.md',
    direction: 'up',
    logger: { info: () => {}, warn: () => {}, error: console.error, debug: () => {} },
  });
  const fixtures = await withClient(dbUrl, insertFixtures);

  // 운영 배선을 그대로 탄다: 팩토리가 드라이버를 고르고 앱이 그것을 주입한다.
  process.env.OBJECT_STORAGE_DRIVER = 'memory';
  const config: ApiConfig = {
    port: 0,
    authMode: 'mock',
    jwtSecret: SECRET,
    accessTtlSec: 900,
    refreshTtlSec: 3600,
    databaseUrl: dbUrl,
    runtimeRole: 'une_app',
    publicBaseUrl: 'http://127.0.0.1:0',
    uploadMaxBytes: 50 * 1024 * 1024,
    jsonMaxBytes: 1024 * 1024,
    uploadTicketTtlSec: 900,
    // CC-220 지식문서 정책. 운영 기본값과 같게 둔다 — 특히 검사 미완료 완화는
    // 꺼진 상태여야 도메인이 막으려는 경로가 테스트에서 살아 있다(ADR-36 D6).
    knowledgeMaxFileBytes: 50 * 1024 * 1024,
    knowledgeAllowedMimeTypes: new Set(['application/pdf', 'text/plain']),
    knowledgeAllowScanPending: false,
    knowledgeMaxUploadAttempts: 3,
    corsAllowedOrigins: [],
    // CC-200: 이 슬라이스는 상황 수집을 지나지 않지만 ApiConfig는 전 필드를
    // 요구한다. 목업 시나리오 훅은 운영 기본값 그대로 끈 채로 둔다(ADR-33 D19).
    situationMockScenarios: false,
    situationProviderTimeoutMs: 10_000,
  };
  const app = await createApp(config);
  await app.listen(0);
  const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');

  // 워커는 API가 쓰는 것과 **같은** 저장소 인스턴스를 봐야 한다. 인메모리
  // 어댑터는 프로세스 안의 Map이므로, 새로 만들면 워커가 원본을 못 찾는다.
  const storage = app.get<MemoryObjectStorage>(OBJECT_STORAGE);

  const workerConfig = loadWorkerConfig({
    DATABASE_URL: dbUrl,
    UNE_DB_RUNTIME_ROLE: 'une_worker',
  });
  const workerDb = new WorkerDatabase(workerConfig);
  const adapter = new MockLegacyT3qPlanAdapter();

  return {
    dbName,
    dbUrl,
    app,
    base,
    fixtures,
    workerDb,
    storage,
    toc: new TocJobRunner(workerDb, adapter, workerConfig),
    content: new ContentJobRunner(workerDb, adapter, workerConfig),
    exports: new ExportJobRunner(workerDb, storage, workerConfig),
    // 시나리오 훅을 켠다 — 잘린 스트림·깨진 노드를 e2e에서 태울 수 있어야 한다.
    sop: new SopJobRunner(
      workerDb,
      new MockUniSopAdapter({ scenariosEnabled: true }),
      workerConfig,
    ),
    // 시나리오 훅을 켠다 — 재시도·dead letter가 실제로 도는지 보려면 실패가
    // 필요하다.
    outbox: new OutboxRelayRunner(
      workerDb,
      createChannelRegistry({ UNE_CHANNEL_SCENARIOS: 'true' }),
      workerConfig,
    ),
    async close(): Promise<void> {
      await workerDb.close();
      await app.close();
      await withClient(ADMIN_URL as string, (c) =>
        c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`),
      );
    },
  };
}

/** HTTP 호출 도우미. 본문은 **한 번만** 읽는다. */
export function apiFor(harness: Harness) {
  const call = async (
    method: string,
    path: string,
    token: string | null,
    options: { body?: unknown; idempotencyKey?: string; correlationId?: string } = {},
  ): Promise<Response> =>
    fetch(`${harness.base}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
        ...(options.correlationId ? { 'x-correlation-id': options.correlationId } : {}),
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

  const json = async <T>(res: Response, expected: number): Promise<T> => {
    const text = await res.text();
    if (res.status !== expected) {
      throw new Error(`기대 ${expected}, 실제 ${res.status}: ${text.slice(0, 500)}`);
    }
    return JSON.parse(text) as T;
  };

  const login = async (tenantId: string, loginId: string): Promise<string> => {
    const res = await call('POST', '/api/v1/auth/sso/exchange', null, {
      body: { externalToken: buildMockExternalToken({ tenantId, loginId }) },
    });
    return (await json<{ data: { accessToken: string } }>(res, 200)).data.accessToken;
  };

  return { call, json, login };
}

export function idem(label: string): string {
  return `${label}-${randomUUID()}`;
}
