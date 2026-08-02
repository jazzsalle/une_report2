#!/usr/bin/env node
// CC-140 (ADR-29 D1) third-party source intake gate for third_party/rhwp.
//
// This gate does NOT import rhwp. It is the mechanism that makes a future
// import (CC-145, after explicit human approval) impossible to do sloppily:
// today's state — status NOT_IMPORTED with an empty upstream/ — must PASS
// (R11), and the moment anyone drops source into third_party/rhwp/upstream/
// the remaining rules bite.
//
// Rules
//   R1  source without a record         upstream/ has files (beyond .gitkeep)
//                                       but PROVENANCE.yaml is missing or does
//                                       not satisfy PROVENANCE.schema.json.
//   R2  status <-> source mismatch      BOTH directions, because either one alone
//                                       leaves a hole:
//                                         (a) status: IMPORTED while upstream/ is empty;
//                                         (b) upstream/ holds files while status is
//                                             neither IMPORTED nor SUPERSEDED. Source
//                                             that sits in the tree ships in the
//                                             distribution, so it must be declared —
//                                             otherwise R8 happily green-lights a
//                                             notices row that says "NOT_IMPORTED"
//                                             about source we are actually shipping
//                                             (ADR v1.1 §8.3 배포물 고지, §8.5).
//   R3  field format / OPEN residue     PROVENANCE.yaml violates the schema, or
//                                       any leaf value is still the literal OPEN.
//                                       Also: PROVENANCE_TEMPLATE.yaml must keep
//                                       every key the schema requires (drift).
//   R4  floating ref                    tag/commit is main/master/HEAD/latest.
//   R5  tree integrity                  measured upstream/ tree digest != tree_digest,
//                                       or license_file missing / hash mismatch,
//                                       or a symlink exists under upstream/.
//   R6  submodule bypass                .gitmodules or a nested .git under
//                                       third_party/rhwp (or a root .gitmodules
//                                       entry pointing at it).
//   R7  ungrounded patch                patches/PATCHES.yaml entry with a duplicate
//                                       or empty id, or an empty reason /
//                                       upstream_issue / files[] / tests[], or a
//                                       files[] path that does not exist.
//   R8  notices drift                   the rhwp row of third_party/THIRD_PARTY_NOTICES.md
//                                       disagrees with PROVENANCE.yaml
//                                       (commit / archive sha256 / license / status).
//   R9  SBOM                            sbom_file missing, unparsable, wrong format,
//                                       or missing an rhwp component.
//   R10 hidden dependency               services|packages|apps source imports
//                                       third_party/rhwp while status != IMPORTED.
//   R11 today's green                   status NOT_IMPORTED (or no record at all)
//                                       with an empty upstream/ => PASS.
//   R12 POC Gate on IMPORTED            status: IMPORTED requires poc_gate G15-1
//                                       (analysis) and G15-6 (license) to be PASS;
//                                       G15-2..G15-5 may be PASS or PENDING but never
//                                       FAIL. See the R12 block for the reasoning.
//
// tree_digest definition (must be reproducible by whoever performs the intake)
// ---------------------------------------------------------------------------
//   1. Collect every REGULAR file under third_party/rhwp/upstream/, recursively,
//      excluding any entry named `.gitkeep`. Symlinks are never followed and are
//      a hard failure.
//   2. For each file take its path relative to upstream/, with '/' separators
//      (POSIX form, no leading './').
//   3. Sort the paths ascending by their raw UTF-8 byte sequence.
//   4. Build a manifest by concatenating, per file in that order:
//         <sha256-hex of file bytes> + "  " + <relative path> + "\n"
//      (two spaces, i.e. the `sha256sum` output shape).
//   5. tree_digest = sha256 hex of the UTF-8 bytes of that manifest.
//   An empty tree yields sha256("") =
//   e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
//
//   Canonical reproduction:  node scripts/validate-source-intake.mjs --print-tree-digest
//   POSIX shell equivalent (run inside third_party/rhwp/upstream):
//     find . -type f ! -name .gitkeep -printf '%P\0' | LC_ALL=C sort -z \
//       | while IFS= read -r -d '' p; do \
//           printf '%s  %s\n' "$(sha256sum "$p" | cut -d' ' -f1)" "$p"; done \
//       | sha256sum
//
// Usage
//   node scripts/validate-source-intake.mjs [--root <dir>] [--print-tree-digest]
//   The root defaults to the repository root; `--root` (or UNE_INTAKE_ROOT) lets
//   tests point the gate at a fixture tree without touching the real one.
//
// Exit code is non-zero on any failure so CI can gate on it.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

// --- CLI ------------------------------------------------------------------
const argv = process.argv.slice(2);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let rootArg = process.env.UNE_INTAKE_ROOT ?? '';
let printDigestOnly = false;
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--print-tree-digest') printDigestOnly = true;
  else if (arg === '--root') {
    rootArg = argv[i + 1] ?? '';
    i += 1;
  } else if (arg.startsWith('--root=')) rootArg = arg.slice('--root='.length);
  else {
    console.error(`unknown argument: ${arg}`);
    process.exit(2);
  }
}
const root = rootArg ? resolve(rootArg) : repoRoot;

const thirdPartyDir = join(root, 'third_party');
const rhwpDir = join(thirdPartyDir, 'rhwp');
const upstreamDir = join(rhwpDir, 'upstream');
const sbomDir = join(rhwpDir, 'sbom');
const provenanceFile = join(rhwpDir, 'PROVENANCE.yaml');
const templateFile = join(rhwpDir, 'PROVENANCE_TEMPLATE.yaml');
const schemaFile = join(rhwpDir, 'PROVENANCE.schema.json');
const patchesFile = join(rhwpDir, 'patches', 'PATCHES.yaml');
const noticesFile = join(thirdPartyDir, 'THIRD_PARTY_NOTICES.md');

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL ${msg}`);
};
const ok = (msg) => console.log(`OK   ${msg}`);

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const EMPTY_TREE_DIGEST = sha256('');

// --- upstream/ file tree ---------------------------------------------------
/** Regular files under upstream/, excluding `.gitkeep`. Symlinks are reported
 * separately: they can point outside the tree, so they must never be digested. */
function scanUpstream(dir, prefix = '') {
  const files = [];
  const symlinks = [];
  if (!existsSync(dir)) return { files, symlinks };
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      symlinks.push(rel);
      continue;
    }
    if (entry.isDirectory()) {
      const nested = scanUpstream(full, rel);
      files.push(...nested.files);
      symlinks.push(...nested.symlinks);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name === '.gitkeep') continue;
    files.push(rel);
  }
  return { files, symlinks };
}

/** See the tree_digest definition in the header comment. */
function computeTreeDigest(relPaths) {
  const sorted = [...relPaths].sort((a, b) =>
    // Byte-wise UTF-8 ordering; Buffer.compare is stable across locales, unlike
    // String#localeCompare.
    Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')),
  );
  const manifest = sorted
    .map((rel) => `${sha256(readFileSync(join(upstreamDir, rel)))}  ${rel}\n`)
    .join('');
  return sha256(Buffer.from(manifest, 'utf8'));
}

const upstreamScan = scanUpstream(upstreamDir);
const upstreamEmpty = upstreamScan.files.length === 0;

if (printDigestOnly) {
  if (upstreamScan.symlinks.length > 0) {
    console.error(`refusing to digest: symlink under upstream/: ${upstreamScan.symlinks[0]}`);
    process.exit(2);
  }
  console.log(computeTreeDigest(upstreamScan.files));
  process.exit(0);
}

// --- structural anchors (anti-vacuity) -------------------------------------
// Every rule below keys off these paths. If one disappears the gate would go
// quietly green, so their absence is itself a failure.
for (const [label, path] of [
  ['third_party/rhwp/PROVENANCE.schema.json', schemaFile],
  ['third_party/rhwp/PROVENANCE_TEMPLATE.yaml', templateFile],
  ['third_party/rhwp/patches/PATCHES.yaml', patchesFile],
  ['third_party/THIRD_PARTY_NOTICES.md', noticesFile],
]) {
  if (!existsSync(path)) fail(`layout: required file missing: ${label}`);
}
for (const [label, path] of [
  ['third_party/rhwp/upstream/', upstreamDir],
  ['third_party/rhwp/sbom/', sbomDir],
]) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    fail(`layout: required intake directory missing: ${label} (R1/R2/R11 anchor)`);
  }
}

// --- load the schema and the record ---------------------------------------
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
let validateProvenance = null;
let schemaDoc = null;
if (existsSync(schemaFile)) {
  try {
    schemaDoc = JSON.parse(readFileSync(schemaFile, 'utf8'));
    validateProvenance = ajv.compile(schemaDoc);
  } catch (err) {
    fail(`layout: PROVENANCE.schema.json did not compile: ${err.message}`);
  }
}

const provenanceExists = existsSync(provenanceFile);
let provenance = null;
let provenanceParsed = false;
if (provenanceExists) {
  try {
    provenance = parseYaml(readFileSync(provenanceFile, 'utf8'));
    provenanceParsed = provenance !== null && typeof provenance === 'object';
    if (!provenanceParsed) fail('R3 PROVENANCE.yaml did not parse into a mapping');
  } catch (err) {
    fail(`R3 PROVENANCE.yaml is not valid YAML: ${err.message}`);
  }
}
// No record at all means nothing was imported. R1 turns that into a failure the
// moment upstream/ is non-empty.
const status = provenanceParsed ? provenance.status : 'NOT_IMPORTED';

// --- R1: source present => a schema-valid record must exist ----------------
if (!upstreamEmpty && !provenanceExists) {
  fail(
    `R1 third_party/rhwp/upstream/ holds ${upstreamScan.files.length} file(s) but ` +
      'PROVENANCE.yaml is missing (source without provenance is never allowed)',
  );
} else if (!upstreamEmpty) {
  ok(`R1 upstream/ has ${upstreamScan.files.length} file(s) and PROVENANCE.yaml exists`);
} else {
  ok('R1 upstream/ is empty (nothing imported), so no PROVENANCE.yaml is required');
}

// --- R2: status and upstream/ must agree, in BOTH directions ---------------
// (a) IMPORTED must be backed by real files, and
// (b) real files must be declared as imported.
//
// (b) is the one that carries the distribution-notice duty. Source that sits in
// third_party/rhwp/upstream/ is in the tree, hence in every artifact built from
// it, so ADR v1.1 §8.3/§8.5 require the LICENSE/THIRD_PARTY notice to cover it.
// R8 only checks that the notices row *agrees* with the record, so without (b) a
// record saying NOT_IMPORTED plus a notices row saying NOT_IMPORTED would be a
// green build that ships undisclosed third-party source.
//
// SUPERSEDED is accepted for a non-empty upstream/ because it still declares the
// source (an older import kept in place while a newer one is prepared); R10 keeps
// code from depending on it, since only IMPORTED unlocks imports.
const DECLARED_STATUSES = new Set(['IMPORTED', 'SUPERSEDED']);
let r2Problems = 0;
if (status === 'IMPORTED' && upstreamEmpty) {
  r2Problems += 1;
  fail('R2 PROVENANCE.yaml says status: IMPORTED but third_party/rhwp/upstream/ is empty');
}
if (!upstreamEmpty && !DECLARED_STATUSES.has(status) && provenanceExists) {
  r2Problems += 1;
  fail(
    `R2 third_party/rhwp/upstream/ holds ${upstreamScan.files.length} file(s) but ` +
      `PROVENANCE.yaml says status: ${status} — source that is in the tree ships in the ` +
      'distribution and must be declared as IMPORTED (or SUPERSEDED) so the ' +
      'THIRD_PARTY_NOTICES.md row declares it too (ADR v1.1 §8.3 배포물 고지, §8.5)',
  );
}
// upstream/ non-empty with no record at all is R1's case, so R2 stays quiet there
// and only reports its own verdict.
if (r2Problems === 0) {
  ok(
    `R2 status (${status}) is consistent with upstream/ being ${upstreamEmpty ? '' : 'non-'}empty`,
  );
}

// --- R3: schema conformance, OPEN residue, template key drift --------------
/** Walks leaf values of a parsed YAML mapping. */
function* leaves(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, v] of node.entries()) yield* leaves(v, `${path}[${i}]`);
  } else if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) yield* leaves(v, path ? `${path}.${k}` : k);
  } else {
    yield [path, node];
  }
}

if (provenanceParsed && validateProvenance) {
  if (!validateProvenance(provenance)) {
    const detail = (validateProvenance.errors ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message}`)
      .join('; ');
    fail(`R3 PROVENANCE.yaml violates PROVENANCE.schema.json: ${detail.slice(0, 1200)}`);
  } else {
    ok('R3 PROVENANCE.yaml satisfies PROVENANCE.schema.json');
  }
  for (const [path, value] of leaves(provenance)) {
    if (typeof value === 'string' && value.trim() === 'OPEN') {
      fail(`R3 PROVENANCE.yaml still carries the placeholder OPEN at ${path}`);
    }
  }
}

// Template drift: the template is the only thing an operator copies, so a schema
// field it never mentions would silently be forgotten.
if (schemaDoc && existsSync(templateFile)) {
  try {
    const template = parseYaml(readFileSync(templateFile, 'utf8')) ?? {};
    const missing = (schemaDoc.required ?? []).filter((key) => !(key in template));
    if (missing.length > 0) {
      fail(`R3 PROVENANCE_TEMPLATE.yaml is missing schema-required key(s): ${missing.join(', ')}`);
    } else {
      ok(
        `R3 PROVENANCE_TEMPLATE.yaml covers all ${(schemaDoc.required ?? []).length} required keys`,
      );
    }
    const gateKeys = Object.keys(schemaDoc.properties?.poc_gate?.properties ?? {});
    const templateGate = template.poc_gate ?? {};
    const missingGates = gateKeys.filter((key) => !(key in templateGate));
    if (missingGates.length > 0) {
      fail(`R3 PROVENANCE_TEMPLATE.yaml poc_gate is missing: ${missingGates.join(', ')}`);
    }
  } catch (err) {
    fail(`R3 PROVENANCE_TEMPLATE.yaml is not valid YAML: ${err.message}`);
  }
}

// --- R4: no floating refs --------------------------------------------------
const FLOATING = new Set(['main', 'master', 'head', 'latest', 'trunk', 'develop', 'dev']);
if (provenanceParsed) {
  let floatingSeen = false;
  for (const field of ['tag', 'commit']) {
    const value = provenance[field];
    if (typeof value !== 'string' || value === '') continue;
    if (FLOATING.has(value.trim().toLowerCase())) {
      floatingSeen = true;
      fail(
        `R4 PROVENANCE.yaml ${field}: "${value}" is a floating ref — ` +
          'ADR v1.1 §8.3 requires an immutable tag/commit',
      );
    }
  }
  if (!floatingSeen) ok('R4 tag/commit are not floating refs');
}

// --- R5: tree integrity ----------------------------------------------------
// Once source is in, upstream/ is pristine: any local change must arrive as a
// patch under patches/, never as an edit in place.
for (const link of upstreamScan.symlinks) {
  fail(`R5 symlink under third_party/rhwp/upstream/: ${link} (pristine trees hold regular files)`);
}
if (provenanceParsed && typeof provenance.tree_digest === 'string') {
  if (upstreamScan.symlinks.length === 0) {
    const measured = computeTreeDigest(upstreamScan.files);
    if (measured !== provenance.tree_digest) {
      fail(
        `R5 upstream/ tree digest ${measured} != recorded tree_digest ${provenance.tree_digest} ` +
          '(upstream/ was edited in place — record patches under patches/PATCHES.yaml instead)',
      );
    } else if (measured === EMPTY_TREE_DIGEST && status === 'IMPORTED') {
      // Belt and braces with R2: the empty-tree digest must not be used to
      // "prove" an import.
      fail('R5 tree_digest is the empty-tree digest while status is IMPORTED');
    } else {
      ok(`R5 upstream/ tree digest matches tree_digest (${measured.slice(0, 12)}…)`);
    }
  }
  // license_file must exist and hash as recorded (§8.5 license bundle rule).
  // Only once source is actually placed: license_file always points under
  // upstream/, so with an empty upstream/ there is nothing to measure yet. That
  // is the PROVENANCE_RECORDED interim state (ref and hashes decided, POC Gate
  // running outside the repo). Nothing is lost — the moment a file appears under
  // upstream/, R2(b) forces IMPORTED/SUPERSEDED and this check runs.
  const licenseRel = provenance.license_file;
  if (!upstreamEmpty && typeof licenseRel === 'string' && licenseRel !== '') {
    const licensePath = join(rhwpDir, licenseRel);
    if (!existsSync(licensePath) || !lstatSync(licensePath).isFile()) {
      fail(`R5 license_file not found: third_party/rhwp/${licenseRel}`);
    } else {
      const measured = sha256(readFileSync(licensePath));
      if (measured !== provenance.license_file_sha256) {
        fail(
          `R5 license_file sha256 ${measured} != recorded license_file_sha256 ` +
            `${provenance.license_file_sha256}`,
        );
      } else {
        ok('R5 license_file exists and matches license_file_sha256');
      }
    }
  }
}

// --- R6: no submodule / nested repo bypass ---------------------------------
function findGitArtifacts(dir, prefix = 'third_party/rhwp') {
  const hits = [];
  if (!existsSync(dir)) return hits;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.name === '.gitmodules' || entry.name === '.git') {
      hits.push(rel);
      continue;
    }
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      hits.push(...findGitArtifacts(join(dir, entry.name), rel));
    }
  }
  return hits;
}
const gitArtifacts = findGitArtifacts(rhwpDir);
const rootGitmodules = join(root, '.gitmodules');
if (
  existsSync(rootGitmodules) &&
  readFileSync(rootGitmodules, 'utf8').includes('third_party/rhwp')
) {
  gitArtifacts.push('.gitmodules (root, references third_party/rhwp)');
}
if (gitArtifacts.length > 0) {
  for (const hit of gitArtifacts) {
    fail(
      `R6 git submodule/nested repo artifact under the intake area: ${hit} — ` +
        'the source must be committed as plain files with a provenance record',
    );
  }
} else {
  ok('R6 no .gitmodules / nested .git under third_party/rhwp');
}

// --- R7: every patch is grounded -------------------------------------------
if (existsSync(patchesFile)) {
  let patchesDoc = null;
  try {
    patchesDoc = parseYaml(readFileSync(patchesFile, 'utf8'));
  } catch (err) {
    fail(`R7 patches/PATCHES.yaml is not valid YAML: ${err.message}`);
  }
  if (patchesDoc !== null) {
    const entries = patchesDoc.patches;
    if (!Array.isArray(entries)) {
      fail('R7 patches/PATCHES.yaml must define a `patches` array');
    } else {
      const seenIds = new Set();
      let patchProblems = 0;
      const patchFail = (msg) => {
        patchProblems += 1;
        fail(msg);
      };
      entries.forEach((entry, index) => {
        const where = `patches[${index}]`;
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
          patchFail(`R7 ${where} must be a mapping`);
          return;
        }
        const id = typeof entry.id === 'string' ? entry.id.trim() : '';
        if (id === '') patchFail(`R7 ${where} has no id`);
        else if (seenIds.has(id)) patchFail(`R7 duplicate patch id: ${id}`);
        else seenIds.add(id);
        const label = id === '' ? where : id;
        for (const field of ['reason', 'upstream_issue']) {
          const value = entry[field];
          if (typeof value !== 'string' || value.trim() === '') {
            patchFail(`R7 patch ${label} has an empty ${field} (unjustified patches are rejected)`);
          }
        }
        for (const field of ['files', 'tests']) {
          const value = entry[field];
          if (!Array.isArray(value) || value.length === 0) {
            patchFail(`R7 patch ${label} has an empty ${field}[]`);
          }
        }
        // files[] paths are declared relative to third_party/rhwp/upstream/
        // because a patch by definition changes pristine upstream source.
        if (Array.isArray(entry.files)) {
          for (const file of entry.files) {
            if (typeof file !== 'string' || file.trim() === '') {
              patchFail(`R7 patch ${label} has an empty files[] entry`);
              continue;
            }
            if (!existsSync(join(upstreamDir, file))) {
              patchFail(
                `R7 patch ${label} lists files[] entry "${file}" which does not exist under ` +
                  'third_party/rhwp/upstream/',
              );
            }
          }
        }
      });
      if (patchProblems === 0)
        ok(`R7 patches/PATCHES.yaml: ${entries.length} patch entry(ies) grounded`);
    }
  }
}

// --- R8: THIRD_PARTY_NOTICES.md must not drift from the record -------------
// Table shape: | Component | Upstream | Version/commit | License | Archive SHA-256 | Status |
if (existsSync(noticesFile)) {
  const rows = readFileSync(noticesFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim()),
    );
  const row = rows.find((cells) => cells[0] === 'rhwp');
  if (!row) {
    fail(
      'R8 third_party/THIRD_PARTY_NOTICES.md has no `rhwp` row (notices drift gate went vacuous)',
    );
  } else if (row.length < 6) {
    fail(`R8 THIRD_PARTY_NOTICES.md rhwp row has ${row.length} columns, expected 6`);
  } else {
    const [, nUpstream, nVersion, nLicense, nSha, nStatus] = row;
    let drift = 0;
    const driftFail = (msg) => {
      drift += 1;
      fail(`R8 ${msg}`);
    };
    if (provenanceParsed) {
      if (nUpstream !== provenance.upstream_url) {
        driftFail(`notices Upstream "${nUpstream}" != PROVENANCE.yaml upstream_url`);
      }
      if (typeof provenance.commit === 'string' && !nVersion.includes(provenance.commit)) {
        driftFail(
          `notices Version/commit "${nVersion}" does not contain commit ${provenance.commit}`,
        );
      }
      if (
        provenance.ref_type === 'tag' &&
        typeof provenance.tag === 'string' &&
        provenance.tag !== '' &&
        !nVersion.includes(provenance.tag)
      ) {
        driftFail(`notices Version/commit "${nVersion}" does not contain tag ${provenance.tag}`);
      }
      if (nLicense !== provenance.license) {
        driftFail(
          `notices License "${nLicense}" != PROVENANCE.yaml license "${provenance.license}"`,
        );
      }
      if (
        typeof provenance.archive_sha256 === 'string' &&
        !nSha.includes(provenance.archive_sha256)
      ) {
        driftFail(`notices Archive SHA-256 "${nSha}" does not contain the recorded archive_sha256`);
      }
      if (nStatus !== provenance.status) {
        driftFail(`notices Status "${nStatus}" != PROVENANCE.yaml status "${provenance.status}"`);
      }
    } else {
      // No record => the notices row must still say so. Without this the drift
      // gate would only exist after an import.
      if (nStatus !== 'NOT_IMPORTED') {
        driftFail(
          `notices Status "${nStatus}" but there is no PROVENANCE.yaml (expected NOT_IMPORTED)`,
        );
      }
      for (const [label, cell] of [
        ['Version/commit', nVersion],
        ['Archive SHA-256', nSha],
      ]) {
        if (cell !== 'OPEN') {
          driftFail(`notices ${label} "${cell}" but there is no PROVENANCE.yaml (expected OPEN)`);
        }
      }
    }
    if (drift === 0) ok('R8 THIRD_PARTY_NOTICES.md rhwp row agrees with the provenance record');
  }
}

// --- R9: SBOM present, parsable, and about rhwp ----------------------------
if (provenanceParsed && typeof provenance.sbom_file === 'string' && provenance.sbom_file !== '') {
  const sbomPath = join(rhwpDir, provenance.sbom_file);
  if (!existsSync(sbomPath) || !lstatSync(sbomPath).isFile()) {
    fail(`R9 sbom_file not found: third_party/rhwp/${provenance.sbom_file}`);
  } else {
    let sbom = null;
    try {
      sbom = JSON.parse(readFileSync(sbomPath, 'utf8'));
    } catch (err) {
      fail(`R9 sbom_file is not valid JSON: ${err.message}`);
    }
    if (sbom) {
      const format = provenance.sbom_format;
      let names = [];
      if (format === 'spdx-json') {
        if (typeof sbom.spdxVersion !== 'string') {
          fail('R9 sbom_format is spdx-json but the document has no spdxVersion');
        }
        names = (Array.isArray(sbom.packages) ? sbom.packages : []).map((p) =>
          String(p?.name ?? ''),
        );
      } else if (format === 'cyclonedx-json') {
        if (sbom.bomFormat !== 'CycloneDX') {
          fail('R9 sbom_format is cyclonedx-json but bomFormat is not "CycloneDX"');
        }
        names = (Array.isArray(sbom.components) ? sbom.components : []).map((c) =>
          String(c?.name ?? ''),
        );
      }
      if (!names.some((name) => /rhwp/i.test(name))) {
        fail(`R9 sbom_file lists no rhwp component (${names.length} component(s) found)`);
      } else {
        ok(`R9 SBOM (${format}) parses and lists an rhwp component`);
      }
    }
  }
}

// --- R10: no source may depend on an unimported third_party/rhwp -----------
const SCAN_ROOTS = ['services', 'packages', 'apps'];
const SCAN_EXTENSIONS = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|py|rs)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', 'generated']);
const IMPORT_PATTERNS = [
  /\bfrom\s*['"][^'"]*third_party\/rhwp/,
  /\brequire\(\s*['"][^'"]*third_party\/rhwp/,
  /\bimport\s*\(\s*['"][^'"]*third_party\/rhwp/,
  /\bimport\s+['"][^'"]*third_party\/rhwp/,
  /^\s*(?:from|import)\s+third_party\.rhwp\b/m,
];
function walkSources(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...walkSources(join(dir, entry.name)));
    } else if (entry.isFile() && SCAN_EXTENSIONS.test(entry.name)) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}
const importers = [];
for (const scanRoot of SCAN_ROOTS) {
  for (const file of walkSources(join(root, scanRoot))) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('third_party/rhwp') && !source.includes('third_party.rhwp')) continue;
    if (IMPORT_PATTERNS.some((re) => re.test(source))) {
      importers.push(
        file
          .slice(root.length + 1)
          .split('\\')
          .join('/'),
      );
    }
  }
}
if (importers.length > 0 && status !== 'IMPORTED') {
  for (const file of importers) {
    fail(
      `R10 ${file} imports third_party/rhwp but the intake status is ${status} — ` +
        'code may not depend on source that has not been imported',
    );
  }
} else if (importers.length > 0) {
  ok(`R10 ${importers.length} file(s) import third_party/rhwp and status is IMPORTED`);
} else {
  ok('R10 no services/packages/apps source imports third_party/rhwp');
}

// --- R12: IMPORTED requires the POC Gate minimum set ------------------------
// ADR v1.1 §8.3 is literal: "**POC Gate를 통과한** 특정 Tag 또는 Commit의 소스
// 아카이브를 … third_party/rhwp 영역에 반입한다". ADR-29 D1 reread that as a
// promotion condition for the operational build, but its support came from the
// WBS ordering, and SOURCE_OF_TRUTH puts ADR v1.1 above the WBS. So the literal
// reading wins, with one refinement that keeps day-to-day work possible:
//
//   * the practical sequence is download -> test -> import, and G15-2..G15-5
//     exercise UNE-owned layers (prototype registry, ChangeSet executor,
//     preserving serializer, performance) that do not exist at intake time.
//     Demanding all six would make IMPORTED unreachable, which pushes people
//     into exactly the undeclared-source state R2(b) now forbids.
//   * "record the ref first, place the files later" is expressed by
//     PROVENANCE_RECORDED (record present, upstream/ still empty), so nothing
//     forces a premature IMPORTED. INTAKE_PROCEDURE.md documents that order.
//
// Minimum set:
//   G15-6 라이선스 — its §8.6 acceptance criteria (MIT/Third-party 고지, 금지 폰트
//     미포함, SBOM 생성) is triggered by the intake itself: the moment the source
//     is in the tree it is redistributed. Nothing later in the build can repair
//     an intake that shipped a prohibited font or an unnotified license.
//   G15-1 분석 — the reason a *specific* tag/commit is pinned at all is that this
//     ref actually parses our HWPX corpus (AUTO/CONFIRM/LIMITED/REJECT 판정 재현).
//     It is also the only gate runnable against the extracted archive alone,
//     before any UNE layer exists, so requiring it costs nothing but a test run.
// The rest may stay PENDING, but never FAIL: an IMPORTED ref with a known failing
// gate is a decision that needs an ADR, not a silent record.
const POC_GATE_REQUIRED_PASS = ['G15-1', 'G15-6'];
const POC_GATE_ALL = ['G15-1', 'G15-2', 'G15-3', 'G15-4', 'G15-5', 'G15-6'];
const POC_GATE_LABELS = {
  'G15-1': '분석 (analysis)',
  'G15-2': '양식상속 (template inheritance)',
  'G15-3': '편집 (editing)',
  'G15-4': '저장 (save round-trip)',
  'G15-5': '성능 (performance)',
  'G15-6': '라이선스 (license/SBOM)',
};
if (provenanceParsed && status === 'IMPORTED') {
  const pocGate = provenance.poc_gate;
  let gateProblems = 0;
  if (pocGate === null || typeof pocGate !== 'object' || Array.isArray(pocGate)) {
    gateProblems += 1;
    fail('R12 status is IMPORTED but PROVENANCE.yaml has no poc_gate mapping');
  } else {
    for (const gate of POC_GATE_REQUIRED_PASS) {
      const state = pocGate[gate]?.state;
      if (state !== 'PASS') {
        gateProblems += 1;
        fail(
          `R12 status is IMPORTED but poc_gate ${gate} ${POC_GATE_LABELS[gate]} is ` +
            `${state ?? 'missing'} — ADR v1.1 §8.3 imports a tag/commit that has PASSED the ` +
            'POC Gate; G15-1 and G15-6 are the minimum set (G15-6 because the intake itself ' +
            'redistributes the source, G15-1 because it is what makes this ref the right one). ' +
            'Use status: PROVENANCE_RECORDED with an empty upstream/ while the gates are still ' +
            'running (third_party/rhwp/INTAKE_PROCEDURE.md)',
        );
      }
    }
    for (const gate of POC_GATE_ALL) {
      if (POC_GATE_REQUIRED_PASS.includes(gate)) continue;
      const state = pocGate[gate]?.state;
      if (state === 'FAIL') {
        gateProblems += 1;
        fail(
          `R12 status is IMPORTED but poc_gate ${gate} ${POC_GATE_LABELS[gate]} is FAIL — ` +
            'PENDING (not yet run) is allowed for G15-2..G15-5, a recorded failure is not; ' +
            'raise an ADR or fix the ref',
        );
      }
    }
  }
  if (gateProblems === 0) {
    ok(`R12 poc_gate ${POC_GATE_REQUIRED_PASS.join(' + ')} are PASS and no other gate is FAIL`);
  }
}

// --- R11: today's state is the green state ---------------------------------
if (status === 'NOT_IMPORTED' && upstreamEmpty) {
  ok('R11 NOT_IMPORTED with an empty upstream/ — the pre-intake state is green (ADR-29 D1)');
}

// ---------------------------------------------------------------------------
if (failures > 0) {
  console.error(`SOURCE INTAKE VALIDATION: FAIL (${failures} problem${failures > 1 ? 's' : ''})`);
  process.exit(1);
}
console.log('SOURCE INTAKE VALIDATION: PASS');
