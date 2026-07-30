// CC-004: generates docs/db/DATA_DICTIONARY.md from the actually-applied
// schema so the dictionary can never drift from the migrations (G-DB gate
// evidence). Creates a scratch database, applies database/migrations via
// node-pg-migrate, introspects catalogs, then drops the scratch database.
//
// Usage: DATABASE_URL=postgres://<superuser>@host:5432/<db> pnpm db:data-dictionary
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runner } from 'node-pg-migrate';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = resolve(ROOT, 'docs', 'db', 'DATA_DICTIONARY.md');
const MIGRATIONS_DIR = resolve(ROOT, 'database', 'migrations');

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) {
  console.error('DATABASE_URL (superuser) is required');
  process.exit(1);
}

async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

await withClient(adminUrl, async (c) => {
  const who = await c.query('SELECT current_user AS u');
  if (who.rows[0].u === 'une_app') {
    console.error('DATABASE_URL must be the admin/superuser role, not une_app');
    process.exit(1);
  }
});

const dbName = `cc004_dict_${randomUUID().slice(0, 8)}`;
await withClient(adminUrl, (c) => c.query(`CREATE DATABASE ${dbName}`));
const dictUrl = new URL(adminUrl);
dictUrl.pathname = `/${dbName}`;

try {
  await runner({
    databaseUrl: dictUrl.toString(),
    dir: MIGRATIONS_DIR,
    migrationsTable: 'pgmigrations',
    ignorePattern: '\\..*|README\\.md',
    direction: 'up',
    logger: { info: () => {}, warn: () => {}, error: console.error, debug: () => {} },
  });

  const dict = await withClient(dictUrl.toString(), async (c) => {
    const migrations = await c.query('SELECT name FROM pgmigrations ORDER BY id');
    const tables = await c.query(`
      SELECT c.relname AS table_name,
             obj_description(c.oid) AS table_comment,
             c.relrowsecurity AS rls,
             c.relforcerowsecurity AS rls_forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'pgmigrations'
      ORDER BY c.relname`);
    const columns = await c.query(`
      SELECT c.relname AS table_name, a.attname AS column_name,
             format_type(a.atttypid, a.atttypmod) AS data_type,
             a.attnotnull AS not_null,
             pg_get_expr(d.adbin, d.adrelid) AS default_expr,
             col_description(c.oid, a.attnum) AS comment
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'pgmigrations'
      ORDER BY c.relname, a.attnum`);
    const constraints = await c.query(`
      SELECT conrelid::regclass::text AS table_name, conname, contype,
             pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
      ORDER BY conrelid::regclass::text, conname`);
    const indexes = await c.query(`
      SELECT tablename AS table_name, indexname
      FROM pg_indexes WHERE schemaname = 'public' AND tablename <> 'pgmigrations'
      ORDER BY tablename, indexname`);
    return { migrations, tables, columns, constraints, indexes };
  });

  const byTable = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.table_name)) m.set(r.table_name, []);
      m.get(r.table_name).push(r);
    }
    return m;
  };
  const colsByTable = byTable(dict.columns.rows);
  const consByTable = byTable(dict.constraints.rows);
  const idxByTable = byTable(dict.indexes.rows);

  const esc = (s) => (s ?? '').replaceAll('|', '\\|');
  const lines = [];
  lines.push('# DB Data Dictionary');
  lines.push('');
  lines.push('<!-- GENERATED FILE - do not edit. Regenerate with: pnpm db:data-dictionary -->');
  lines.push('');
  lines.push(
    '적용된 마이그레이션에서 자동 생성된 데이터 사전이다 (G-DB 게이트 증거).',
    '스키마 변경 시 `pnpm db:data-dictionary`로 재생성해 커밋한다 (CI가 drift를 차단).',
  );
  lines.push('');
  lines.push(`- 테이블 수: ${dict.tables.rows.length}`);
  lines.push(`- 적용 마이그레이션: ${dict.migrations.rows.map((r) => r.name).join(', ')}`);
  lines.push('');
  for (const t of dict.tables.rows) {
    const rls = t.rls ? (t.rls_forced ? 'RLS enforced (FORCE)' : 'RLS enabled') : 'RLS 없음';
    lines.push(`## ${t.table_name}`);
    lines.push('');
    if (t.table_comment) lines.push(`${esc(t.table_comment)}`);
    lines.push(`- 격리: ${rls}`);
    const cons = consByTable.get(t.table_name) ?? [];
    for (const con of cons) lines.push(`- ${con.conname}: ${esc(con.def)}`);
    const idx = (idxByTable.get(t.table_name) ?? []).map((i) => i.indexname);
    if (idx.length) lines.push(`- 인덱스: ${idx.join(', ')}`);
    lines.push('');
    lines.push('| 컬럼 | 타입 | NULL | 기본값 | 설명 |');
    lines.push('|---|---|---|---|---|');
    for (const col of colsByTable.get(t.table_name) ?? []) {
      lines.push(
        `| ${col.column_name} | ${esc(col.data_type)} | ${col.not_null ? 'NN' : '-'} | ${esc(
          col.default_expr,
        )} | ${esc(col.comment)} |`,
      );
    }
    lines.push('');
  }

  writeFileSync(OUT_FILE, lines.join('\n'));
  console.log(
    `data dictionary written: ${OUT_FILE} (${dict.tables.rows.length} tables, ${dict.columns.rows.length} columns)`,
  );
} finally {
  await withClient(adminUrl, (c) => c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`));
}
