#!/usr/bin/env node
// CC-170 화면 증거 캡처.
//
// 설계 09의 필수증거에는 **화면 캡처**가 있다. API 응답만으로는 "사용자가 이
// 경로를 실제로 걸을 수 있는가"에 답하지 못한다. 이 스크립트는 API·워커·웹을
// 띄우고 브라우저로 여섯 화면을 걸으며 PNG를 남긴다.
//
// **CI 게이트가 아니다.** 브라우저 바이너리를 받아야 하므로(약 120MB) CI에서
// 돌리지 않는다. 그래서 UI 로직은 vitest가, 경로는 API E2E가 덮고 캡처는
// 증거로만 쓴다 — 이 분담을 증거 문서에 적는다.
//
// 실행:
//   DATABASE_URL=postgres://une:...@127.0.0.1:5432/une \
//   pnpm --filter @une/e2e screens
//
// 사전 준비(1회): pnpm --filter @une/e2e exec playwright install chromium

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const OUT_DIR = resolve(REPO_ROOT, 'docs', 'evidence', 'CC-170', 'screens');
const TEMPLATE = resolve(REPO_ROOT, 'templete', '간략 보고 양식.hwpx');

const API_PORT = Number(process.env.CC170_API_PORT ?? 3399);
const WEB_PORT = Number(process.env.CC170_WEB_PORT ?? 4399);
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const WEB_BASE = `http://127.0.0.1:${WEB_PORT}`;
const SECRET = 'cc170-screens-secret-cc170-screens!!';

const ADMIN_URL = process.env.DATABASE_URL;
if (!ADMIN_URL) {
  console.error('DATABASE_URL(superuser)이 필요하다.');
  process.exit(1);
}

const { Client } = await import('pg');
const { runner: migrate } = await import('node-pg-migrate');
const { createApp } = await import('@une/api');
const { MockLegacyT3qPlanAdapter } = await import('@une/provider-adapters');
const { ContentJobRunner, ExportJobRunner, TocJobRunner, WorkerDatabase, loadWorkerConfig } =
  await import('@une/worker');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    'playwright를 찾지 못했다. 먼저 실행: pnpm --filter @une/e2e exec playwright install chromium',
  );
  process.exit(1);
}

async function withClient(url, fn) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** 캡처용 데이터베이스와 사용자를 만든다. 끝나면 지운다. */
async function setupDatabase() {
  const dbName = `cc170_screens_${randomUUID().slice(0, 8)}`;
  await withClient(ADMIN_URL, (c) => c.query(`CREATE DATABASE ${dbName}`));
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  const dbUrl = url.toString();
  await migrate({
    databaseUrl: dbUrl,
    dir: resolve(REPO_ROOT, 'database', 'migrations'),
    migrationsTable: 'pgmigrations',
    ignorePattern: '\\..*|README\\.md',
    direction: 'up',
    logger: { info: () => {}, warn: () => {}, error: console.error, debug: () => {} },
  });
  const fixtures = await withClient(dbUrl, async (c) => {
    const tenant = await c.query(
      `INSERT INTO tenant (tenant_code, tenant_name, status)
       VALUES ('une-demo', 'UNE 시연기관', 'ACTIVE') RETURNING tenant_id`,
    );
    const tenantId = tenant.rows[0].tenant_id;
    const user = await c.query(
      `INSERT INTO app_user (tenant_id, login_id, display_name, status)
       VALUES ($1, 'demo-admin', '재난안전 담당자', 'ACTIVE') RETURNING user_id`,
      [tenantId],
    );
    await c.query(
      `INSERT INTO role_permission (role_id, permission_id)
       SELECT r.role_id, p.permission_id FROM role r JOIN permission p
         ON p.permission_code IN ('PLAN_CREATE','PLAN_READ','PLAN_EDIT','PLAN_GENERATE',
                                  'FILE_UPLOAD','DOC_READ','DOC_EDIT','DOC_EXPORT')
       WHERE r.tenant_id IS NULL AND r.role_code = 'INSTITUTION_ADMIN'
       ON CONFLICT DO NOTHING`,
    );
    await c.query(
      `INSERT INTO user_role (user_id, role_id, granted_by)
       SELECT $1, r.role_id, $1 FROM role r
       WHERE r.tenant_id IS NULL AND r.role_code = 'INSTITUTION_ADMIN'`,
      [user.rows[0].user_id],
    );
    return { tenantId, userId: user.rows[0].user_id };
  });
  return { dbName, dbUrl, fixtures };
}

/** 워커 루프. 화면이 폴링하는 동안 Job이 실제로 처리돼야 한다. */
function startWorkers(dbUrl, storage) {
  const config = loadWorkerConfig({ DATABASE_URL: dbUrl, UNE_DB_RUNTIME_ROLE: 'une_worker' });
  const db = new WorkerDatabase(config);
  const adapter = new MockLegacyT3qPlanAdapter();
  const runners = [
    new TocJobRunner(db, adapter, config),
    new ContentJobRunner(db, adapter, config),
    new ExportJobRunner(db, storage, config),
  ];
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      for (const runner of runners) {
        try {
          await runner.runOnce();
        } catch (error) {
          console.error('[worker]', error.message);
        }
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  };
  const done = loop();
  return {
    async stop() {
      stopped = true;
      await done;
      await db.close();
    },
  };
}

async function waitForHttp(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      // 아직 안 떴다
    }
    if (Date.now() > deadline) throw new Error(`시간 초과: ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const { dbName, dbUrl, fixtures } = await setupDatabase();
  process.env.OBJECT_STORAGE_DRIVER = 'memory';

  const app = await createApp({
    port: API_PORT,
    authMode: 'mock',
    jwtSecret: SECRET,
    accessTtlSec: 900,
    refreshTtlSec: 3600,
    databaseUrl: dbUrl,
    runtimeRole: 'une_app',
    publicBaseUrl: API_BASE,
    uploadMaxBytes: 50 * 1024 * 1024,
    uploadTicketTtlSec: 900,
    // 브라우저가 다른 출처(웹 미리보기)에서 API를 부른다 — CORS가 필요하다.
    corsAllowedOrigins: [WEB_BASE],
  });
  await app.listen(API_PORT);
  const { OBJECT_STORAGE } = await import('@une/api');
  const workers = startWorkers(dbUrl, app.get(OBJECT_STORAGE));

  // 웹은 빌드 후 미리보기로 띄운다. dev 서버는 HMR 오버레이가 캡처에 끼어든다.
  const webEnv = { ...process.env, VITE_API_BASE_URL: `${API_BASE}/api/v1` };
  await new Promise((resolveBuild, rejectBuild) => {
    const build = spawn('pnpm', ['--filter', '@une/web', 'build'], {
      cwd: REPO_ROOT,
      env: webEnv,
      stdio: 'inherit',
      shell: true,
    });
    build.on('exit', (code) => (code === 0 ? resolveBuild() : rejectBuild(new Error('웹 빌드 실패'))));
  });
  const preview = spawn(
    'pnpm',
    [
      '--filter',
      '@une/web',
      'exec',
      'vite',
      'preview',
      '--port',
      String(WEB_PORT),
      '--strictPort',
      // 기본 바인딩은 localhost(IPv6 [::1])다. 127.0.0.1로 기다리면 영원히
      // 못 붙으므로 주소를 명시한다.
      '--host',
      '127.0.0.1',
    ],
    { cwd: REPO_ROOT, env: webEnv, stdio: 'inherit', shell: true },
  );
  await waitForHttp(WEB_BASE);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
  });
  const page = await context.newPage();
  const shots = [];
  const shot = async (name) => {
    const file = resolve(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    shots.push(`${name}.png`);
    console.log(`  캡처 ${name}.png`);
  };

  try {
    await page.goto(WEB_BASE);

    // 1. 로그인
    await page.getByTestId('tenant-id').fill(fixtures.tenantId);
    await page.getByTestId('login-id').fill('demo-admin');
    await shot('01-login');
    await page.getByTestId('login').click();
    await page.waitForTimeout(1200);
    await shot('02-logged-in');

    // 2. 계획서
    await page.getByTestId('create-plan').click();
    await page.waitForTimeout(1200);
    await shot('03-plan');

    // 3. 기준정보 — 계약 스키마를 만족하는 값으로 바꾼다.
    await page.getByTestId('step-context').click();
    await page.getByTestId('context-json').fill(
      JSON.stringify(
        {
          subject: '2026년 폭염 대비 안전관리 계획',
          backgroundInfo: { disasterType: '폭염', controlPhase: '대비' },
          contentInstruction: { essentialFactors: ['무더위쉼터 운영', '취약계층 보호 대책'] },
          purposeOfDocument: {
            goalOfBusiness: '폭염 피해 최소화',
            role: '재난안전 담당자',
            targetAudiences: ['중앙정부'],
          },
        },
        null,
        2,
      ),
    );
    await shot('04-context');
    await page.getByTestId('confirm-snapshot').click();
    await page.waitForTimeout(1200);
    await shot('05-snapshot-confirmed');

    // 4. HWPX 반입
    await page.getByTestId('step-upload').click();
    await page.getByTestId('hwpx-file').setInputFiles(TEMPLATE);
    await shot('06-upload-selected');
    await page.getByTestId('upload-hwpx').click();
    await page.waitForTimeout(4000);
    await shot('07-import-analysis');

    // 5. 목차·본문 생성
    await page.getByTestId('step-generate').click();
    await page.getByTestId('generate-toc').click();
    await page.waitForTimeout(5000);
    await shot('08-toc-job');
    const confirmToc = page.getByTestId('confirm-toc');
    if (await confirmToc.isVisible().catch(() => false)) {
      await confirmToc.click();
      await page.waitForTimeout(2000);
    }
    await page.getByTestId('generate-content').click();
    await page.waitForTimeout(6000);
    await shot('09-content-job');

    // 5-3. 본문 실체화 — 이 단계를 건너뛰면 내려받는 HWPX는 원본 그대로다.
    await page.getByTestId('materialize').click();
    await page.waitForTimeout(4000);
    await shot('10-materialized');

    // 6. Export·다운로드
    await page.getByTestId('step-export').click();
    await page.getByTestId('request-export').click();
    await page.waitForTimeout(6000);
    await shot('11-export-validation');
    const download = page.waitForEvent('download', { timeout: 20_000 }).catch(() => null);
    await page.getByTestId('download-export').click();
    const downloaded = await download;
    await page.waitForTimeout(1500);
    await shot('12-downloaded');

    if (downloaded) {
      const path = await downloaded.path();
      if (path) {
        const bytes = await readFile(path);
        console.log(
          `  내려받은 파일 ${downloaded.suggestedFilename()} ${bytes.length}바이트 sha256=${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}…`,
        );
      }
    }

    await writeFile(
      resolve(OUT_DIR, 'INDEX.md'),
      [
        '# CC-170 화면 증거',
        '',
        '`pnpm --filter @une/e2e screens`로 생성한다. CI 게이트가 아니다 —',
        '브라우저 바이너리가 필요하므로 로컬에서만 돈다.',
        '',
        ...shots.map((name) => `- ![${name}](${name})`),
        '',
        '편집기 화면은 없다 — rhwp 미반입(OB-12).',
      ].join('\n'),
      'utf8',
    );
  } finally {
    await browser.close();
    preview.kill();
    await workers.stop();
    await app.close();
    await withClient(ADMIN_URL, (c) => c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`));
  }
  console.log(`\n캡처 ${shots.length}장 → ${OUT_DIR}`);
}

await main();
