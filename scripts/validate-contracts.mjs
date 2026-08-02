#!/usr/bin/env node
// CC-003 contract validation gate.
// 1. Every contracts/openapi/*.yaml must be a structurally valid OpenAPI 3.x document.
// 2. Every contracts/schemas/*.json must compile as JSON Schema draft 2020-12
//    (cross-file $refs resolve via the https://schemas.une.local/ $id base).
// 3. Every mock-server route must exist in the platform contract (mock contract sync).
// 4. Every media-type example in contracts/openapi/*.yaml must validate against
//    its own schema; contracts in EXAMPLE_REQUIRED_FILES must carry an example
//    on every operation minus documented exemptions, and pinned transcripts
//    must not drift (CC-115/ADR-24).
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

// --- 4. Media-type examples vs their schema --------------------------------
// Example coverage is required for EVERY operation of the listed contracts,
// minus an explicit exemption list with reasons (review M3: an allowlist of
// required ids could silently go vacuous; the inverted form cannot). GET
// operations are checked on the response side (2xx only), everything else on
// the requestBody side.
const EXAMPLE_REQUIRED_FILES = {
  // operationId -> reason it is exempt from the example requirement.
  // An EMPTY object still enables the coverage check for the file: the lookup
  // below is `if (EXAMPLE_REQUIRED_FILES[name])`, and `{}` is truthy, so every
  // operation stays required while nothing is exempt. Do not replace it with
  // null/undefined — that silently drops the file from the coverage gate.
  //
  // CC-135 closed both former exemptions:
  //  - streamGenerationEvents: satisfied by an SSE transcript string example
  //    (the schema is an opaque string, so the transcript is the example).
  //  - registerPlanReferenceDocument: satisfied by a multipart/form-data example
  //    whose binary `file` part is a placeholder string (CR-T3Q-007 stays
  //    CONDITIONAL and unmocked; the example is request-specification only).
  't3q-plan-api-change-request-v1.yaml': {},
};

// Transcript integrity pin (review N1 / ADR-24 D3): the legacy contract is a
// faithful transcription of T3Q v0.8.5 (+UNE annotations) and must not drift
// silently. Update the pin only together with a provider-truth review.
const TRANSCRIPT_PINS = {
  't3q-report-adapter-v0.8.5-une1.yaml':
    'fd82f44c2afd02686e049ea63c666cb88114f1994a2a7b00f7a3250928bb4e6c',
};
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

// Rewrites only $ref *string values*; component schemas are mounted as $defs so
// the document root never has to be handed to Ajv (its Parameter objects use
// `required: true`, which is not valid under the JSON Schema meta-schema).
const toDefsRefs = (node) => {
  if (Array.isArray(node)) return node.map(toDefsRefs);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] =
        k === '$ref' && typeof v === 'string'
          ? v.replace(/^#\/components\/schemas\//, '#/$defs/')
          : toDefsRefs(v);
    }
    return out;
  }
  return node;
};

// Local pointer resolution by full path. Name-only lookup is wrong here:
// components.responses.GenerationAccepted and components.schemas.GenerationAccepted
// are different objects in the target-v2 contract.
const resolvePointer = (doc, ref) => {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  let cur = doc;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
};
const deref = (doc, node) => (node && node.$ref ? resolvePointer(doc, node.$ref) : node);

for (const name of openapiFiles) {
  const failuresBefore = failures;
  const raw = await readFile(join(openapiDir, name), 'utf8');
  if (TRANSCRIPT_PINS[name]) {
    const { createHash } = await import('node:crypto');
    const digest = createHash('sha256').update(raw, 'utf8').digest('hex');
    if (digest !== TRANSCRIPT_PINS[name]) {
      fail(
        `transcript pin ${name}: sha256 ${digest} != pinned ${TRANSCRIPT_PINS[name]} ` +
          '(faithful-transcription rule, ADR-24 D3 — update the pin only with a provider-truth review)',
      );
    }
  }
  const doc = parseYaml(raw);
  const defs = toDefsRefs(doc.components?.schemas ?? {});
  const exAjv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(exAjv);
  // Keyed on the media-type object itself so a shared components.responses entry
  // referenced by several operations is validated once, while every referencing
  // operation is still credited for REQUIRED_EXAMPLES.
  const seen = new Map();
  const checks = [];
  const withExample = { request: new Set(), response: new Set() };

  const collect = (content, where, opId, side) => {
    for (const [mediaType, mto] of Object.entries(content ?? {})) {
      if (!mto || typeof mto !== 'object') continue;
      const found = [];
      if (mto.example !== undefined) found.push(['example', mto.example]);
      for (const [exName, ex] of Object.entries(mto.examples ?? {})) {
        // externalValue examples carry no inline value to check.
        if (ex && typeof ex === 'object' && 'value' in ex)
          found.push([`examples.${exName}`, ex.value]);
      }
      if (found.length === 0) continue;
      if (opId) withExample[side].add(opId);
      if (!seen.has(mto)) seen.set(mto, new Set());
      const done = seen.get(mto);
      for (const [label, value] of found) {
        if (done.has(label)) continue;
        done.add(label);
        checks.push({ key: `${where} ${mediaType} ${label}`, schema: mto.schema, value });
      }
    }
  };

  for (const [p, item] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = item?.[method];
      if (!op) continue;
      const opId = op.operationId;
      const body = deref(doc, op.requestBody);
      collect(body?.content, `${method.toUpperCase()} ${p} request`, opId, 'request');
      for (const [status, res] of Object.entries(op.responses ?? {})) {
        const resolved = deref(doc, res);
        // Only success responses credit the coverage requirement — a shared
        // 4xx error example must not satisfy it (review M3).
        const creditedOp = /^2\d\d$/.test(status) ? opId : undefined;
        collect(
          resolved?.content,
          `${method.toUpperCase()} ${p} ${status}`,
          creditedOp,
          'response',
        );
      }
    }
  }
  for (const [rName, res] of Object.entries(doc.components?.responses ?? {})) {
    collect(res?.content, `components.responses.${rName}`);
  }
  for (const [bName, body] of Object.entries(doc.components?.requestBodies ?? {})) {
    collect(body?.content, `components.requestBodies.${bName}`);
  }

  let checked = 0;
  for (const { key, schema, value } of checks) {
    if (!schema) {
      fail(`examples ${name}: ${key} has an example but no schema to check it against`);
      continue;
    }
    let validate;
    try {
      validate = exAjv.compile({ $defs: defs, ...toDefsRefs(schema) });
    } catch (err) {
      fail(`examples ${name}: ${key} schema did not compile: ${err.message}`);
      continue;
    }
    checked += 1;
    if (!validate(value)) {
      const detail = (validate.errors ?? [])
        .map((e) => `${e.instancePath || '/'} ${e.message}`)
        .join('; ');
      fail(`examples ${name}: ${key} does not match its schema: ${detail.slice(0, 800)}`);
    }
  }

  const exempt = EXAMPLE_REQUIRED_FILES[name];
  if (exempt) {
    const operations = [];
    for (const item of Object.values(doc.paths ?? {})) {
      for (const m of HTTP_METHODS) {
        if (item?.[m]?.operationId) operations.push({ opId: item[m].operationId, method: m });
      }
    }
    if (operations.length === 0) fail(`examples ${name}: no operations found (parser drift?)`);
    for (const exemptId of Object.keys(exempt)) {
      if (!operations.some((o) => o.opId === exemptId)) {
        fail(`examples ${name}: exemption lists unknown operationId ${exemptId}`);
      }
    }
    for (const { opId, method } of operations) {
      if (exempt[opId]) continue;
      const side = method === 'get' ? 'response' : 'request';
      if (!withExample[side].has(opId)) {
        fail(
          `examples ${name}: ${opId} must ship a ${side} example (every operation, minus documented exemptions)`,
        );
      }
    }
  }

  if (failures === failuresBefore)
    ok(`examples ${name}: ${checked} media-type example(s) match their schema`);
}

// ---------------------------------------------------------------------------
if (failures > 0) {
  console.error(`CONTRACT VALIDATION: FAIL (${failures} problem${failures > 1 ? 's' : ''})`);
  process.exit(1);
}
console.log('CONTRACT VALIDATION: PASS');
