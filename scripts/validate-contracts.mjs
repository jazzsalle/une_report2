#!/usr/bin/env node
// CC-003 contract validation gate.
// 1. Every contracts/openapi/*.yaml must be a structurally valid OpenAPI 3.x document.
// 2. Every contracts/schemas/*.json must compile as JSON Schema draft 2020-12
//    (cross-file $refs resolve via the https://schemas.une.local/ $id base).
// 3. Every mock-server route must exist in the platform contract (mock contract sync).
// Exit code is non-zero on any failure so CI can gate on it.

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Validator } from '@seriousme/openapi-schema-validator';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const openapiDir = join(root, 'contracts', 'openapi');
const schemasDir = join(root, 'contracts', 'schemas');
const mockApp = join(root, 'mock-server', 'app.py');
const platformContract = join(openapiDir, 'une-platform-api-v1.yaml');

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL ${msg}`);
};
const ok = (msg) => console.log(`OK   ${msg}`);

// --- 1. OpenAPI documents -------------------------------------------------
const openapiFiles = (await readdir(openapiDir)).filter((f) => f.endsWith('.yaml')).sort();
if (openapiFiles.length === 0) fail('openapi: no *.yaml found in contracts/openapi (moved?)');
for (const name of openapiFiles) {
  const validator = new Validator();
  const res = await validator.validate(join(openapiDir, name));
  if (res.valid) {
    ok(`openapi ${name} (${validator.version})`);
  } else {
    fail(`openapi ${name}: ${JSON.stringify(res.errors).slice(0, 2000)}`);
  }
}

// --- 2. JSON Schemas (draft 2020-12, cross-file $ref by $id) ---------------
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const schemaFiles = (await readdir(schemasDir)).filter((f) => f.endsWith('.json')).sort();
if (schemaFiles.length === 0) fail('schema: no *.json found in contracts/schemas (moved?)');
const docs = new Map();
for (const name of schemaFiles) {
  try {
    const doc = JSON.parse(await readFile(join(schemasDir, name), 'utf8'));
    docs.set(name, doc);
    ajv.addSchema(doc);
  } catch (err) {
    fail(`schema ${name}: ${err.message}`);
  }
}
for (const [name, doc] of docs) {
  try {
    const compiled = ajv.getSchema(doc.$id) ?? ajv.compile(doc);
    if (!compiled) throw new Error('schema did not compile');
    ok(`schema ${name}`);
  } catch (err) {
    fail(`schema ${name}: ${err.message}`);
  }
}

// --- 3. Mock server route sync against the platform contract ---------------
// Params are normalized ({planId} vs {plan_id} both become {}) because the
// mock uses snake_case path params while the contract uses camelCase.
const normalize = (p) => p.replace(/\{[^}]+\}/g, '{}').replace(/\/+$/, '');
const contractDoc = parseYaml(await readFile(platformContract, 'utf8'));
const contractPaths = new Set(Object.keys(contractDoc.paths ?? {}).map(normalize));
const mockSource = await readFile(mockApp, 'utf8');
// Covers @app.<method>(...) and @app.api_route(...). Other registration styles
// (APIRouter, include_router, add_api_route) are not parsed, so their presence
// must fail the gate until this script learns to read them.
for (const pattern of ['APIRouter', 'include_router', 'add_api_route']) {
  if (mockSource.includes(pattern)) {
    fail(`mock sync: mock-server/app.py uses ${pattern}, which this check cannot parse yet`);
  }
}
const routeRe = /@app\.(?:get|post|put|patch|delete|api_route)\(\s*"([^"]+)"/g;
// Documented exceptions (ADR-20): /health is the out-of-contract ops endpoint;
// the generic catch-all returns a fallback envelope for not-yet-mocked paths.
const allowedOutOfContract = new Set(['/health', '/api/v1/{path:path}']);
let mockChecked = 0;
for (const [, route] of mockSource.matchAll(routeRe)) {
  if (allowedOutOfContract.has(route)) continue;
  if (!route.startsWith('/api/v1/')) {
    fail(`mock route ${route}: outside /api/v1 prefix and not a known ops endpoint`);
    continue;
  }
  mockChecked += 1;
  const contractPath = normalize(route.slice('/api/v1'.length));
  if (!contractPaths.has(contractPath)) {
    fail(`mock route ${route}: no matching path in une-platform-api-v1.yaml`);
  }
}
if (mockChecked === 0) {
  fail('mock sync: no /api/v1 routes found in mock-server/app.py (regex drift?)');
} else if (failures === 0) {
  ok(`mock sync: ${mockChecked} mock routes all present in platform contract`);
}

// ---------------------------------------------------------------------------
if (failures > 0) {
  console.error(`CONTRACT VALIDATION: FAIL (${failures} problem${failures > 1 ? 's' : ''})`);
  process.exit(1);
}
console.log('CONTRACT VALIDATION: PASS');
