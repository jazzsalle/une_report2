#!/usr/bin/env node
/**
 * 백업·복구 훈련 (CC-430).
 *
 * "백업이 있다"와 "복구할 수 있다"는 다른 말이다. 후자는 **해 봐야** 알 수 있고,
 * 해 보지 않은 백업은 장애가 났을 때 처음 시험된다. 그래서 이 스크립트는
 * 덤프를 뜨고, 빈 데이터베이스에 되돌리고, **되돌린 것이 원본과 같은지 대조**한
 * 뒤 걸린 시간을 적는다.
 *
 * 대조하는 것은 행 수만이 아니다. 스키마의 안전장치가 함께 살아 돌아왔는지를
 * 본다 — RLS가 켜진 테이블 수, 정책 수, 트리거 수, 마이그레이션 수. 행만 세면
 * "데이터는 있는데 아무도 못 막는" 복구본을 통과시킨다.
 *
 * 롤은 클러스터 수준이라 덤프에 들어가지 않는다. 그래서 이 훈련은 **같은
 * 클러스터 안에서** 돈다. 다른 서버로 옮기는 절차는 롤 프로비저닝(initdb +
 * 마이그레이션 0050)이 먼저 서야 하며, 그 사실을 보고서에 적는다.
 *
 * 사용법:
 *   node scripts/backup-restore-drill.mjs
 *   node scripts/backup-restore-drill.mjs --keep      복구본을 남긴다
 *   node scripts/backup-restore-drill.mjs --out drill.json
 *
 *   # 서버와 같은 버전의 도구가 PATH에 없을 때 — 컨테이너 것을 쓴다
 *   node scripts/backup-restore-drill.mjs --docker une-postgres
 *   node scripts/backup-restore-drill.mjs --docker une-postgres --wsl Ubuntu
 *
 * 전제: DATABASE_URL, 그리고 서버와 **같은 계열**의 pg_dump/pg_restore.
 *
 * 버전이 어긋나면 이 스크립트는 시작 전에 멈춘다. 실제로 걸렸던 자리다 —
 * pg_dump 18이 만든 덤프에는 `SET transaction_timeout`이 들어가고 서버 16은
 * 그 설정을 모른다. 복구는 첫 줄에서 죽는데, 대조를 하지 않으면 "덤프는
 * 떴다"로 끝난다. 백업 훈련이 잡아야 하는 것이 정확히 이런 것이다.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL이 필요하다.');
  process.exit(2);
}

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const outPath = flag('--out');
/** 덤프·복구 도구를 컨테이너 안에서 돌린다 — 서버와 버전이 같은 것이 거기 있다. */
const dockerContainer = flag('--docker');
const wslDistro = flag('--wsl');

/**
 * 컨테이너 안에서 볼 때의 접속 문자열.
 *
 * 밖에서는 `localhost:15432`여도 안에서는 `localhost:5432`다. 추측하지 않고
 * 필요할 때만 설정으로 받는다.
 */
const innerUrlRaw = process.env.UNE_PG_INNER_URL ?? null;

/** pg_dump/pg_restore를 어떻게 부를지. 컨테이너 경유면 앞에 래퍼가 붙는다. */
function pgTool(tool) {
  if (!dockerContainer) return { cmd: tool, prefix: [] };
  const docker = wslDistro
    ? { cmd: 'wsl', prefix: ['-d', wslDistro, '--', 'docker', 'exec', '-i', dockerContainer] }
    : { cmd: 'docker', prefix: ['exec', '-i', dockerContainer] };
  return { cmd: docker.cmd, prefix: [...docker.prefix, tool] };
}

const source = new URL(DATABASE_URL);
const sourceDb = source.pathname.replace(/^\//, '');
const stamp = new Date()
  .toISOString()
  .replace(/[^0-9]/g, '')
  .slice(0, 14);
const targetDb = `${sourceDb}_drill_${stamp}`;

/** 관리 접속 — 데이터베이스를 만들고 지우려면 원본이 아닌 곳에 붙어야 한다. */
const adminUrl = new URL(DATABASE_URL);
adminUrl.pathname = '/postgres';

const targetUrl = new URL(DATABASE_URL);
targetUrl.pathname = `/${targetDb}`;

function psql(url, sql) {
  return execFileSync('psql', [url.toString(), '-tAc', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** 컨테이너 경유일 때 도구가 볼 접속 문자열. */
function toolUrl(url) {
  if (!dockerContainer) return url.toString();
  if (!innerUrlRaw) {
    console.error(
      '--docker를 쓰려면 UNE_PG_INNER_URL이 필요하다 — 컨테이너 안에서 본 접속 문자열은\n' +
        '밖에서 본 것과 포트가 다르고, 그것을 추측하지 않는다.\n' +
        '예: UNE_PG_INNER_URL=postgres://une:<pw>@localhost:5432/une',
    );
    process.exit(2);
  }
  const inner = new URL(innerUrlRaw);
  inner.pathname = url.pathname;
  return inner.toString();
}

/**
 * 도구와 서버의 주버전이 맞는가.
 *
 * 어긋나면 여기서 멈춘다. 지나가면 복구가 첫 줄에서 죽고, 그때는 "덤프는
 * 떴다"만 남는다.
 */
function assertVersionMatch() {
  const serverNum = Number(psql(source, 'SHOW server_version_num'));
  const serverMajor = Math.floor(serverNum / 10000);
  const tool = pgTool('pg_dump');
  const raw = execFileSync(tool.cmd, [...tool.prefix, '--version'], { encoding: 'utf8' });
  const clientMajor = Number(/(\d+)\./.exec(raw.replace(/^\D+/, ''))?.[1] ?? 0);
  if (!clientMajor) throw new Error(`pg_dump 버전을 읽지 못했다: ${raw.trim()}`);
  if (clientMajor > serverMajor) {
    console.error(
      `pg_dump ${clientMajor}로 서버 ${serverMajor}를 덤프할 수 없다 — 새 클라이언트가\n` +
        `서버가 모르는 설정을 덤프에 넣고(예: transaction_timeout) 복구가 첫 줄에서 죽는다.\n` +
        `서버와 같은 계열의 도구를 쓰십시오. 컨테이너 것을 쓰려면:\n` +
        `  node scripts/backup-restore-drill.mjs --docker une-postgres --wsl Ubuntu`,
    );
    process.exit(2);
  }
  return { serverMajor, clientMajor };
}

/**
 * 복구본이 원본과 같은지 묻는 질문들.
 *
 * 하나씩 셀 수 있고, 하나라도 다르면 복구가 온전하지 않다. 행 수만 보지
 * 않는 이유는 위 주석에 적었다.
 */
const CHECKS = {
  migrations: `SELECT count(*) FROM pgmigrations`,
  tables: `SELECT count(*) FROM information_schema.tables
             WHERE table_schema='public' AND table_type='BASE TABLE'`,
  columns: `SELECT count(*) FROM information_schema.columns WHERE table_schema='public'`,
  rlsEnabled: `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity`,
  rlsForced: `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND c.relkind='r' AND c.relforcerowsecurity`,
  policies: `SELECT count(*) FROM pg_policies WHERE schemaname='public'`,
  triggers: `SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
               JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='public' AND NOT t.tgisinternal`,
  indexes: `SELECT count(*) FROM pg_indexes WHERE schemaname='public'`,
  checkConstraints: `SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                       WHERE n.nspname='public' AND c.contype='c'`,
  foreignKeys: `SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                  WHERE n.nspname='public' AND c.contype='f'`,
};

/** 전 테이블 행 수 — 한 줄 지문으로 접는다. */
const ROW_FINGERPRINT = `
  SELECT coalesce(string_agg(t || '=' || n, ',' ORDER BY t), '(none)')
  FROM (
    SELECT c.relname AS t,
           (xpath('/row/c/text()',
                  query_to_xml(format('SELECT count(*) AS c FROM public.%I', c.relname),
                               false, true, '')))[1]::text::bigint AS n
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r'
  ) s`;

function collect(url) {
  const out = {};
  for (const [name, sql] of Object.entries(CHECKS)) out[name] = Number(psql(url, sql));
  out.rowFingerprint = psql(url, ROW_FINGERPRINT);
  return out;
}

const workDir = mkdtempSync(join(tmpdir(), 'une-drill-'));
const dumpFile = join(workDir, `${sourceDb}.dump`);
const report = { startedAt: new Date().toISOString(), sourceDb, targetDb };
let failed = false;

try {
  const versions = assertVersionMatch();
  report.versions = versions;
  console.log(
    `[0/5] 도구 pg_dump ${versions.clientMajor} · 서버 ${versions.serverMajor}` +
      (dockerContainer ? ` (컨테이너 ${dockerContainer} 경유)` : ''),
  );

  console.log(`[1/5] 원본 상태를 잰다 (${sourceDb})`);
  const before = collect(source);
  report.source = before;
  console.log(
    `      마이그레이션 ${before.migrations} · 테이블 ${before.tables} · 정책 ${before.policies} · 트리거 ${before.triggers}`,
  );

  console.log('[2/5] 덤프');
  const dumpStart = Date.now();
  // 덤프는 **stdout으로** 받는다. 컨테이너 경유일 때 파일 경로를 공유할 수
  // 없기 때문이고, 직접 실행일 때도 결과는 같다.
  const dumpTool = pgTool('pg_dump');
  const dumped = execFileSync(
    dumpTool.cmd,
    [...dumpTool.prefix, '-Fc', '--no-owner', toolUrl(source)],
    { maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  writeFileSync(dumpFile, dumped);
  report.dumpSeconds = Number(((Date.now() - dumpStart) / 1000).toFixed(2));
  report.dumpBytes = statSync(dumpFile).size;
  console.log(`      ${report.dumpBytes} bytes · ${report.dumpSeconds}s`);

  console.log(`[3/5] 빈 데이터베이스에 복구 (${targetDb})`);
  psql(adminUrl, `CREATE DATABASE ${targetDb}`);
  const restoreStart = Date.now();
  // pg_restore는 확장·소유자 관련 경고를 낼 수 있다. 종료 코드가 아니라
  // **대조 결과**로 판정한다 — 경고 하나로 훈련을 실패시키면 다음 사람이
  // 경고를 끄게 된다.
  const restoreTool = pgTool('pg_restore');
  try {
    execFileSync(
      restoreTool.cmd,
      [...restoreTool.prefix, '--no-owner', '--exit-on-error', '-d', toolUrl(targetUrl)],
      {
        input: readFileSync(dumpFile),
        maxBuffer: 1024 * 1024 * 1024,
        stdio: ['pipe', 'inherit', 'inherit'],
      },
    );
  } catch (err) {
    report.restoreWarning = String(err.message ?? err).slice(0, 500);
    console.warn('      pg_restore가 0이 아닌 코드를 냈다. 대조로 판정한다.');
  }
  report.restoreSeconds = Number(((Date.now() - restoreStart) / 1000).toFixed(2));
  report.rtoSeconds = Number((report.dumpSeconds + report.restoreSeconds).toFixed(2));
  console.log(`      ${report.restoreSeconds}s (RTO 합계 ${report.rtoSeconds}s)`);

  console.log('[4/5] 원본과 대조');
  const after = collect(targetUrl);
  report.restored = after;

  const diffs = [];
  for (const key of Object.keys(CHECKS)) {
    if (before[key] !== after[key]) diffs.push(`${key}: 원본 ${before[key]} → 복구 ${after[key]}`);
  }
  if (before.rowFingerprint !== after.rowFingerprint) {
    diffs.push('rowFingerprint: 테이블별 행 수가 다르다');
    report.rowDiff = { source: before.rowFingerprint, restored: after.rowFingerprint };
  }
  report.diffs = diffs;

  if (diffs.length > 0) {
    failed = true;
    console.error('\nDRILL FAILED — 복구본이 원본과 다르다:');
    for (const d of diffs) console.error(`  - ${d}`);
  } else {
    console.log('      스키마·정책·트리거·행 수 전부 일치');
  }

  console.log('[5/5] 정리');
} finally {
  if (!keep) {
    try {
      psql(adminUrl, `DROP DATABASE IF EXISTS ${targetDb} WITH (FORCE)`);
    } catch {
      console.warn(`      복구본 ${targetDb}를 지우지 못했다. 수동으로 지우십시오.`);
    }
  } else {
    console.log(`      복구본을 남긴다: ${targetDb}`);
  }
  rmSync(workDir, { recursive: true, force: true });
}

report.finishedAt = new Date().toISOString();
report.verdict = failed ? 'FAIL' : 'PASS';

if (outPath) {
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`보고서: ${outPath}`);
}

console.log(`\nBACKUP/RESTORE DRILL: ${report.verdict}`);
console.log(
  `RTO ${report.rtoSeconds ?? '-'}s (덤프 ${report.dumpSeconds ?? '-'}s + 복구 ${report.restoreSeconds ?? '-'}s)`,
);
console.log(
  '주의: 롤은 클러스터 수준이라 덤프에 없다. 다른 서버로 옮길 때는 initdb 스크립트와 마이그레이션 0050이 먼저 서야 한다.',
);

process.exit(failed ? 1 : 0);
