#!/usr/bin/env node
// CC-003 contract type generation (ADR-20).
// Generates TypeScript types from the OpenAPI contracts with openapi-typescript.
// Types only — no runtime client is generated; thin hand-written clients live
// behind adapter ports (packages/provider-adapters) per architecture rules.
// Generated files are committed; CI regenerates and fails on drift.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';
import { parse as parseYaml } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  {
    contract: 'contracts/openapi/une-platform-api-v1.yaml',
    output: 'services/api/src/generated/une-platform-api.ts',
  },
  {
    // CC-170: 운영 워크스페이스도 같은 계약에서 타입을 받는다. 화면이 응답 모양을
    // 손으로 다시 적으면 계약이 바뀔 때 조용히 갈라지고, 그 드리프트는 사용자
    // 화면에서만 드러난다. 같은 파일을 두 곳에 생성하는 것은 중복이지만,
    // apps/web이 services/api를 의존하는 것보다 낫다(경계는 HTTP다).
    contract: 'contracts/openapi/une-platform-api-v1.yaml',
    output: 'apps/web/src/generated/une-platform-api.ts',
  },
  {
    contract: 'contracts/openapi/t3q-report-adapter-v0.8.5-une1.yaml',
    output: 'packages/provider-adapters/src/generated/t3q-report-adapter.ts',
  },
  {
    contract: 'contracts/openapi/t3q-plan-api-change-request-v1.yaml',
    output: 'packages/provider-adapters/src/generated/t3q-plan-api-v2.ts',
    // {version} is read from the contract's info.version at generation time so
    // the banner can never assert a stale version (review M2 — the drift gate
    // then enforces it).
    note: 'Source is a REQUESTED contract ({version}), NOT T3Q-accepted. Mock-only capability until OB-10 closes; never report as actual T3Q support.',
  },
  {
    contract: 'contracts/openapi/uni-rag-adapter-v1.1.0-une1.yaml',
    output: 'packages/provider-adapters/src/generated/uni-rag-adapter.ts',
  },
];

const headerFor = (note) =>
  `// GENERATED FILE - DO NOT EDIT.
// Regenerate with: pnpm generate:contract-types (source of truth: contracts/openapi).
${note ? `// ${note}\n` : ''}/* eslint-disable */

`;

for (const { contract, output, note } of targets) {
  const ast = await openapiTS(pathToFileURL(join(root, contract)), {
    exportType: true,
  });
  let resolvedNote = note;
  if (note?.includes('{version}')) {
    const doc = parseYaml(await readFile(join(root, contract), 'utf8'));
    resolvedNote = note.replace('{version}', doc?.info?.version ?? 'unknown-version');
  }
  const outPath = join(root, output);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, headerFor(resolvedNote) + astToString(ast), 'utf8');
  console.log(`generated ${output} <- ${contract}`);
}

// Runtime JSON Schema modules (CC-110): services/api compiles with
// rootDir=src, so contracts/*.json cannot be imported directly; the schema is
// embedded as a generated TS module instead (same drift gate as the types).
const schemaTargets = [
  {
    schema: 'contracts/schemas/plan-context.schema.json',
    output: 'services/api/src/generated/plan-context.schema.ts',
    exportName: 'planContextSchema',
  },
];

for (const { schema, output, exportName } of schemaTargets) {
  const json = JSON.parse(await readFile(join(root, schema), 'utf8'));
  const body = `export const ${exportName} = ${JSON.stringify(json, null, 2)} as const;\n`;
  const outPath = join(root, output);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, headerFor(`Source of truth: ${schema}`) + body, 'utf8');
  console.log(`generated ${output} <- ${schema}`);
}
