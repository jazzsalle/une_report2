#!/usr/bin/env node
// CC-003 contract type generation (ADR-20).
// Generates TypeScript types from the OpenAPI contracts with openapi-typescript.
// Types only — no runtime client is generated; thin hand-written clients live
// behind adapter ports (packages/provider-adapters) per architecture rules.
// Generated files are committed; CI regenerates and fails on drift.

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  {
    contract: 'contracts/openapi/une-platform-api-v1.yaml',
    output: 'services/api/src/generated/une-platform-api.ts',
  },
  {
    contract: 'contracts/openapi/t3q-report-adapter-v0.8.5-une1.yaml',
    output: 'packages/provider-adapters/src/generated/t3q-report-adapter.ts',
  },
  {
    contract: 'contracts/openapi/t3q-plan-api-change-request-v1.yaml',
    output: 'packages/provider-adapters/src/generated/t3q-plan-api-v2.ts',
    note: 'Source is a REQUESTED contract (1.0.0-request), NOT T3Q-accepted. Mock-only capability until OB-10 closes; never report as actual T3Q support.',
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
  const outPath = join(root, output);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, headerFor(note) + astToString(ast), 'utf8');
  console.log(`generated ${output} <- ${contract}`);
}
