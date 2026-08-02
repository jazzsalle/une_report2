import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { REPO_ROOT, repoPath } from './contract-loader';

/**
 * CC-140 (ADR-29 D1) — third_party/rhwp intake gate.
 *
 * The gate exists so that a FUTURE import cannot skip provenance. Two things
 * must therefore be proven:
 *  1. today's real repository state (NOT_IMPORTED + empty upstream/) is green — R11;
 *  2. every rule R1..R10 and R12 actually fires on a violating tree.
 *
 * (2) is exercised against throwaway fixture roots under os.tmpdir(); the real
 * third_party/ is never mutated. The gate takes `--root` for exactly this.
 */

const SCRIPT = repoPath('scripts', 'validate-source-intake.mjs');
const UPSTREAM_URL = 'https://github.com/edwardkim/rhwp';
const COMMIT = '1a2b3c4d5e6f7081920a1b2c3d4e5f6071829304';
const TAG = 'v0.4.2';
const ARCHIVE_SHA = 'a'.repeat(64);
const LICENSE_TEXT = 'MIT License\n\nCopyright (c) rhwp authors\n';
const LICENSE_SHA = createHash('sha256').update(LICENSE_TEXT).digest('hex');

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * Creating a symlink on Windows needs Developer Mode or elevation, so the R5
 * symlink case cannot be reproduced on every developer machine. A capability
 * probe rather than a bare `process.platform === 'win32'` check: it always runs
 * on the Linux CI runner, it also runs on a Windows box that happens to allow
 * symlinks, and it only skips where the OS refuses.
 */
const CAN_SYMLINK = ((): boolean => {
  const probe = mkdtempSync(join(tmpdir(), 'une-symlink-probe-'));
  try {
    writeFileSync(join(probe, 'real.txt'), 'x', 'utf8');
    symlinkSync('real.txt', join(probe, 'link.txt'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

interface GateResult {
  code: number;
  output: string;
}

function runGate(root?: string, extraArgs: string[] = []): GateResult {
  const args = [SCRIPT, ...(root ? ['--root', root] : []), ...extraArgs];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { code: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function treeDigest(root: string): string {
  const result = runGate(root, ['--print-tree-digest']);
  expect(result.code, result.output).toBe(0);
  return result.output.trim();
}

function write(root: string, relPath: string, body: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

type NoticesRow = [string, string, string, string, string];

interface FixtureOptions {
  /** Files placed under third_party/rhwp/upstream/ (path -> content). */
  upstream?: Record<string, string>;
  /** PROVENANCE.yaml content; omit/undefined => the file is not created. */
  provenance?: Record<string, unknown>;
  /** patches/PATCHES.yaml `patches` array. */
  patches?: unknown[];
  /** THIRD_PARTY_NOTICES.md rhwp row: upstream, version/commit, license, sha, status. */
  notices?: NoticesRow;
  /** Extra files relative to the fixture root (e.g. a fake importer). */
  extra?: Record<string, string>;
}

const NOT_IMPORTED_ROW: NoticesRow = [UPSTREAM_URL, 'OPEN', 'OPEN', 'OPEN', 'NOT_IMPORTED'];
const IMPORTED_ROW: NoticesRow = [
  UPSTREAM_URL,
  `${TAG} (${COMMIT})`,
  'MIT',
  ARCHIVE_SHA,
  'IMPORTED',
];

/** Builds a fixture repo root that mirrors the real intake layout. */
function makeFixture(options: FixtureOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'une-intake-'));
  roots.push(root);
  const rhwp = join(root, 'third_party', 'rhwp');
  mkdirSync(join(rhwp, 'upstream'), { recursive: true });
  mkdirSync(join(rhwp, 'sbom'), { recursive: true });
  writeFileSync(join(rhwp, 'upstream', '.gitkeep'), '', 'utf8');
  writeFileSync(join(rhwp, 'sbom', '.gitkeep'), '', 'utf8');
  // Schema and template are copied, not re-authored: the fixtures must judge the
  // real artifacts, otherwise a schema change would not reach these tests.
  copyFileSync(
    repoPath('third_party', 'rhwp', 'PROVENANCE.schema.json'),
    join(rhwp, 'PROVENANCE.schema.json'),
  );
  copyFileSync(
    repoPath('third_party', 'rhwp', 'PROVENANCE_TEMPLATE.yaml'),
    join(rhwp, 'PROVENANCE_TEMPLATE.yaml'),
  );

  for (const [rel, body] of Object.entries(options.upstream ?? {})) {
    write(root, join('third_party', 'rhwp', 'upstream', rel), body);
  }
  write(
    root,
    join('third_party', 'rhwp', 'patches', 'PATCHES.yaml'),
    stringify({ version: 1, patches: options.patches ?? [] }),
  );
  const row = options.notices ?? NOT_IMPORTED_ROW;
  write(
    root,
    join('third_party', 'THIRD_PARTY_NOTICES.md'),
    [
      '# Third-party Notices',
      '',
      '| Component | Upstream | Version/commit | License | Archive SHA-256 | Status |',
      '|---|---|---|---|---|---|',
      `| rhwp | ${row.join(' | ')} |`,
      '',
    ].join('\n'),
  );
  if (options.provenance) {
    write(root, join('third_party', 'rhwp', 'PROVENANCE.yaml'), stringify(options.provenance));
  }
  for (const [rel, body] of Object.entries(options.extra ?? {})) write(root, rel, body);
  return root;
}

const SPDX_SBOM = JSON.stringify({
  spdxVersion: 'SPDX-2.3',
  name: 'rhwp-sbom',
  packages: [{ name: 'rhwp', versionInfo: TAG }],
});

const UPSTREAM_FILES: Record<string, string> = {
  LICENSE: LICENSE_TEXT,
  'Cargo.toml': '[package]\nname = "rhwp"\n',
  'src/lib.rs': 'pub fn parse() {}\n',
};

const PENDING_GATE = { state: 'PENDING', evidence: '' };
/**
 * R12 minimum set: G15-1 (analysis) and G15-6 (license) must be PASS before a
 * ref may be recorded as IMPORTED — ADR v1.1 §8.3 imports a tag/commit that has
 * passed the POC Gate. G15-2..G15-5 need UNE-owned layers that do not exist at
 * intake time, so they stay PENDING here.
 */
const passGate = (evidence: string) => ({ state: 'PASS', evidence });
const MINIMUM_POC_GATE = {
  'G15-1': passGate('docs/evidence/cc-145/g15-1-analysis.md'),
  'G15-2': PENDING_GATE,
  'G15-3': PENDING_GATE,
  'G15-4': PENDING_GATE,
  'G15-5': PENDING_GATE,
  'G15-6': passGate('docs/evidence/cc-145/g15-6-license-sbom.md'),
};

/** A schema-valid, fully consistent IMPORTED record for the given fixture root. */
function importedProvenance(root: string, overrides: Record<string, unknown> = {}) {
  return {
    upstream_url: UPSTREAM_URL,
    ref_type: 'tag',
    tag: TAG,
    commit: COMMIT,
    archive_url: `${UPSTREAM_URL}/archive/refs/tags/${TAG}.tar.gz`,
    archive_filename: `rhwp-${TAG}.tar.gz`,
    archive_sha256: ARCHIVE_SHA,
    license: 'MIT',
    license_file: 'upstream/LICENSE',
    license_file_sha256: LICENSE_SHA,
    sbom_file: 'sbom/rhwp.spdx.json',
    sbom_format: 'spdx-json',
    patch_manifest: 'patches/PATCHES.yaml',
    tree_digest: treeDigest(root),
    imported_at: '2026-08-02T09:30:00+09:00',
    imported_by: 'une-hwpx-eng',
    approved_by: 'une-architecture-lead',
    approval_evidence: 'docs/handoff/CHANGE_LOG.md#cc-145',
    status: 'IMPORTED',
    poc_gate: MINIMUM_POC_GATE,
    ...overrides,
  };
}

/**
 * Builds a fixture that is fully IMPORTED and passes every rule, then lets a
 * caller corrupt exactly one thing. Two-phase because tree_digest can only be
 * measured after the upstream files exist.
 */
function makeImportedFixture(
  options: {
    provenanceOverrides?: Record<string, unknown>;
    notices?: NoticesRow;
    patches?: unknown[];
    upstream?: Record<string, string>;
    sbomBody?: string | null;
    extra?: Record<string, string>;
  } = {},
): string {
  const upstream = options.upstream ?? UPSTREAM_FILES;
  const root = makeFixture({
    upstream,
    patches: options.patches,
    notices: options.notices ?? IMPORTED_ROW,
    extra: options.extra,
  });
  if (options.sbomBody !== null) {
    write(
      root,
      join('third_party', 'rhwp', 'sbom', 'rhwp.spdx.json'),
      options.sbomBody ?? SPDX_SBOM,
    );
  }
  write(
    root,
    join('third_party', 'rhwp', 'PROVENANCE.yaml'),
    stringify(importedProvenance(root, options.provenanceOverrides ?? {})),
  );
  return root;
}

describe('CC-140 source intake gate — real repository state', () => {
  it('R11: NOT_IMPORTED with an empty upstream/ passes on the real repo', () => {
    const result = runGate();
    expect(result.output).toContain('R11');
    expect(result.output).toContain('SOURCE INTAKE VALIDATION: PASS');
    expect(result.code, result.output).toBe(0);
  });

  it('R11: the real repo has no PROVENANCE.yaml and an empty upstream/ (nothing was imported)', () => {
    const result = runGate(REPO_ROOT);
    expect(result.output).toContain('R1 upstream/ is empty');
    expect(result.output).toContain('R2 status (NOT_IMPORTED)');
    expect(result.code, result.output).toBe(0);
  });

  it('the empty upstream/ tree digest is sha256 of the empty manifest', () => {
    expect(treeDigest(REPO_ROOT)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('CC-140 source intake gate — positive control', () => {
  // Without this, a negative test could pass for the wrong reason (e.g. every
  // fixture failing on some unrelated layout problem).
  it('a fully consistent IMPORTED fixture passes every rule', () => {
    const result = runGate(makeImportedFixture());
    expect(result.output).toContain('SOURCE INTAKE VALIDATION: PASS');
    expect(result.code, result.output).toBe(0);
  });

  it('a grounded patch entry passes R7', () => {
    const result = runGate(
      makeImportedFixture({
        patches: [
          {
            id: 'RHWP-PATCH-001',
            reason: 'HWPX section0 dangling ref crash',
            upstream_issue: 'https://github.com/edwardkim/rhwp/issues/1',
            files: ['src/lib.rs'],
            tests: ['tests/hwpx/dangling-ref.test.ts'],
          },
        ],
      }),
    );
    expect(result.output).toContain('R7 patches/PATCHES.yaml: 1 patch entry(ies) grounded');
    expect(result.code, result.output).toBe(0);
  });
});

describe('CC-140 source intake gate — negative reproduction R1..R10', () => {
  it('R1: source in upstream/ without a PROVENANCE.yaml fails', () => {
    const result = runGate(makeFixture({ upstream: UPSTREAM_FILES }));
    expect(result.output).toContain('R1 third_party/rhwp/upstream/ holds 3 file(s)');
    expect(result.code).not.toBe(0);
  });

  it('R2: status IMPORTED with an empty upstream/ fails', () => {
    const root = makeFixture({ notices: IMPORTED_ROW });
    write(root, join('third_party', 'rhwp', 'sbom', 'rhwp.spdx.json'), SPDX_SBOM);
    write(
      root,
      join('third_party', 'rhwp', 'PROVENANCE.yaml'),
      stringify(importedProvenance(root)),
    );
    const result = runGate(root);
    expect(result.output).toContain('R2 PROVENANCE.yaml says status: IMPORTED');
    expect(result.code).not.toBe(0);
  });

  // The other direction of R2. Without it the gate is asymmetric and the
  // distribution-notice duty can be dodged: drop the source into the tree, leave
  // the record at NOT_IMPORTED, and R8 only checks that the notices row *agrees*
  // with that record — so "우리는 rhwp를 반입하지 않았다"라고 적힌 배포물이 실제로는
  // rhwp 소스를 담은 채 그린이 된다 (ADR v1.1 §8.3·§8.5).
  it.each(['NOT_IMPORTED', 'PROVENANCE_RECORDED'])(
    'R2: source present in upstream/ while the record says %s fails',
    (undeclared) => {
      const result = runGate(
        makeImportedFixture({
          provenanceOverrides: { status: undeclared },
          notices: [UPSTREAM_URL, `${TAG} (${COMMIT})`, 'MIT', ARCHIVE_SHA, undeclared],
        }),
      );
      expect(result.output).toContain('R2 third_party/rhwp/upstream/ holds 3 file(s)');
      expect(result.output).toContain(`PROVENANCE.yaml says status: ${undeclared}`);
      expect(result.output).toContain('must be declared as IMPORTED (or SUPERSEDED)');
      // R8 is happy — the notices row matches the record — which is exactly why
      // R2 has to carry this.
      expect(result.output).not.toContain('R8 notices Status');
      expect(result.code).not.toBe(0);
    },
  );

  it('R2: SUPERSEDED keeps a non-empty upstream/ declared, so it passes', () => {
    const result = runGate(
      makeImportedFixture({
        provenanceOverrides: { status: 'SUPERSEDED' },
        notices: [UPSTREAM_URL, `${TAG} (${COMMIT})`, 'MIT', ARCHIVE_SHA, 'SUPERSEDED'],
      }),
    );
    expect(result.output).toContain('R2 status (SUPERSEDED) is consistent');
    expect(result.code, result.output).toBe(0);
  });

  it('R3: a malformed field (short commit) fails the schema', () => {
    const result = runGate(makeImportedFixture({ provenanceOverrides: { commit: 'deadbeef' } }));
    expect(result.output).toContain('R3 PROVENANCE.yaml violates PROVENANCE.schema.json');
    expect(result.code).not.toBe(0);
  });

  it('R3: an unknown extra field fails (additionalProperties: false)', () => {
    const result = runGate(makeImportedFixture({ provenanceOverrides: { note: 'whatever' } }));
    expect(result.output).toContain('R3 PROVENANCE.yaml violates PROVENANCE.schema.json');
    expect(result.code).not.toBe(0);
  });

  it('R3: a leftover OPEN placeholder fails even where the schema allows a string', () => {
    const result = runGate(makeImportedFixture({ provenanceOverrides: { imported_by: 'OPEN' } }));
    expect(result.output).toContain('R3 PROVENANCE.yaml still carries the placeholder OPEN');
    expect(result.code).not.toBe(0);
  });

  it('R3: renaming the template to PROVENANCE.yaml does not pass', () => {
    const root = makeFixture({ upstream: UPSTREAM_FILES });
    copyFileSync(
      repoPath('third_party', 'rhwp', 'PROVENANCE_TEMPLATE.yaml'),
      join(root, 'third_party', 'rhwp', 'PROVENANCE.yaml'),
    );
    const result = runGate(root);
    expect(result.output).toContain('R3 PROVENANCE.yaml still carries the placeholder OPEN');
    expect(result.code).not.toBe(0);
  });

  it('R3: a template that drops a schema-required key fails (drift)', () => {
    const root = makeFixture();
    write(
      root,
      join('third_party', 'rhwp', 'PROVENANCE_TEMPLATE.yaml'),
      stringify({ upstream_url: UPSTREAM_URL }),
    );
    const result = runGate(root);
    expect(result.output).toContain(
      'R3 PROVENANCE_TEMPLATE.yaml is missing schema-required key(s)',
    );
    expect(result.code).not.toBe(0);
  });

  it('R4: a floating tag (main) is rejected', () => {
    const result = runGate(
      makeImportedFixture({
        provenanceOverrides: { tag: 'main' },
        notices: [UPSTREAM_URL, `main (${COMMIT})`, 'MIT', ARCHIVE_SHA, 'IMPORTED'],
      }),
    );
    expect(result.output).toContain('R4 PROVENANCE.yaml tag: "main" is a floating ref');
    expect(result.code).not.toBe(0);
  });

  it.each(['master', 'HEAD', 'latest'])('R4: floating tag %s is rejected', (floating) => {
    const result = runGate(
      makeImportedFixture({
        provenanceOverrides: { tag: floating },
        notices: [UPSTREAM_URL, `${floating} (${COMMIT})`, 'MIT', ARCHIVE_SHA, 'IMPORTED'],
      }),
    );
    expect(result.output).toContain('R4 PROVENANCE.yaml tag');
    expect(result.code).not.toBe(0);
  });

  it('R5: editing upstream/ in place breaks the recorded tree_digest', () => {
    const root = makeImportedFixture();
    // Simulate "just a tiny fix in upstream" — the exact thing patches/ exists for.
    write(
      root,
      join('third_party', 'rhwp', 'upstream', 'src', 'lib.rs'),
      'pub fn parse() { /* une hack */ }\n',
    );
    const result = runGate(root);
    expect(result.output).toContain('R5 upstream/ tree digest');
    expect(result.output).toContain('!= recorded tree_digest');
    expect(result.code).not.toBe(0);
  });

  it('R5: a missing license_file fails', () => {
    const result = runGate(
      makeImportedFixture({ provenanceOverrides: { license_file: 'upstream/COPYING' } }),
    );
    expect(result.output).toContain('R5 license_file not found');
    expect(result.code).not.toBe(0);
  });

  it('R5: a license_file hash that does not match the file fails', () => {
    const result = runGate(
      makeImportedFixture({ provenanceOverrides: { license_file_sha256: 'b'.repeat(64) } }),
    );
    expect(result.output).toContain('R5 license_file sha256');
    expect(result.code).not.toBe(0);
  });

  // Skipped only where the OS refuses to create symlinks (see CAN_SYMLINK). The
  // gate itself is platform-independent: readdir(withFileTypes) reports the link.
  it.skipIf(!CAN_SYMLINK)(
    'R5: a symlink under upstream/ is rejected instead of being digested',
    () => {
      const root = makeImportedFixture();
      // A link that escapes the tree entirely — the reason symlinks may never be
      // hashed as if they were pristine upstream content.
      symlinkSync('../../../../../etc/passwd', join(root, 'third_party/rhwp/upstream/secrets'));
      const result = runGate(root);
      expect(result.output).toContain('R5 symlink under third_party/rhwp/upstream/: secrets');
      expect(result.code).not.toBe(0);

      // And the digest helper refuses rather than silently digesting the rest,
      // which would let an operator record a "matching" tree_digest.
      const digest = runGate(root, ['--print-tree-digest']);
      expect(digest.output).toContain('refusing to digest: symlink under upstream/');
      expect(digest.code).toBe(2);
    },
  );

  it('R6: a .gitmodules under third_party/rhwp fails', () => {
    const root = makeImportedFixture();
    write(
      root,
      join('third_party', 'rhwp', '.gitmodules'),
      '[submodule "upstream"]\n\tpath = upstream\n\turl = https://github.com/edwardkim/rhwp\n',
    );
    const result = runGate(root);
    expect(result.output).toContain('R6 git submodule/nested repo artifact');
    expect(result.code).not.toBe(0);
  });

  it('R6: a nested .git inside upstream/ fails', () => {
    const root = makeImportedFixture();
    mkdirSync(join(root, 'third_party', 'rhwp', 'upstream', '.git'), { recursive: true });
    const result = runGate(root);
    expect(result.output).toContain('R6 git submodule/nested repo artifact');
    expect(result.code).not.toBe(0);
  });

  it('R6: a root .gitmodules pointing at third_party/rhwp fails', () => {
    const root = makeImportedFixture();
    write(root, '.gitmodules', '[submodule "rhwp"]\n\tpath = third_party/rhwp/upstream\n');
    const result = runGate(root);
    expect(result.output).toContain('R6 git submodule/nested repo artifact');
    expect(result.code).not.toBe(0);
  });

  it('R7: a patch with an empty reason fails', () => {
    const result = runGate(
      makeImportedFixture({
        patches: [
          {
            id: 'RHWP-PATCH-001',
            reason: '',
            upstream_issue: 'https://github.com/edwardkim/rhwp/issues/1',
            files: ['src/lib.rs'],
            tests: ['tests/hwpx/x.test.ts'],
          },
        ],
      }),
    );
    expect(result.output).toContain('R7 patch RHWP-PATCH-001 has an empty reason');
    expect(result.code).not.toBe(0);
  });

  it('R7: a patch with no upstream_issue / files / tests fails', () => {
    const result = runGate(
      makeImportedFixture({
        patches: [{ id: 'RHWP-PATCH-001', reason: 'because', files: [], tests: [] }],
      }),
    );
    expect(result.output).toContain('has an empty upstream_issue');
    expect(result.output).toContain('has an empty files[]');
    expect(result.output).toContain('has an empty tests[]');
    expect(result.code).not.toBe(0);
  });

  it('R7: duplicate patch ids fail', () => {
    const entry = {
      id: 'RHWP-PATCH-001',
      reason: 'r',
      upstream_issue: 'i',
      files: ['src/lib.rs'],
      tests: ['t'],
    };
    const result = runGate(makeImportedFixture({ patches: [entry, { ...entry }] }));
    expect(result.output).toContain('R7 duplicate patch id: RHWP-PATCH-001');
    expect(result.code).not.toBe(0);
  });

  it('R7: a patch listing a file that does not exist in upstream/ fails', () => {
    const result = runGate(
      makeImportedFixture({
        patches: [
          {
            id: 'RHWP-PATCH-001',
            reason: 'r',
            upstream_issue: 'i',
            files: ['src/ghost.rs'],
            tests: ['t'],
          },
        ],
      }),
    );
    expect(result.output).toContain('lists files[] entry "src/ghost.rs" which does not exist');
    expect(result.code).not.toBe(0);
  });

  it('R8: notices Status drifting from the record fails', () => {
    const result = runGate(
      makeImportedFixture({
        notices: [UPSTREAM_URL, `${TAG} (${COMMIT})`, 'MIT', ARCHIVE_SHA, 'NOT_IMPORTED'],
      }),
    );
    expect(result.output).toContain('R8 notices Status "NOT_IMPORTED"');
    expect(result.code).not.toBe(0);
  });

  it('R8: notices missing the commit / license / archive hash fails', () => {
    const result = runGate(
      makeImportedFixture({
        notices: [UPSTREAM_URL, TAG, 'Apache-2.0', 'OPEN', 'IMPORTED'],
      }),
    );
    expect(result.output).toContain('does not contain commit');
    expect(result.output).toContain('R8 notices License "Apache-2.0"');
    expect(result.output).toContain('does not contain the recorded archive_sha256');
    expect(result.code).not.toBe(0);
  });

  it('R8: claiming IMPORTED in the notices without any record fails', () => {
    const result = runGate(
      makeFixture({ notices: [UPSTREAM_URL, TAG, 'MIT', ARCHIVE_SHA, 'IMPORTED'] }),
    );
    expect(result.output).toContain('but there is no PROVENANCE.yaml (expected NOT_IMPORTED)');
    expect(result.code).not.toBe(0);
  });

  it('R8: a removed rhwp row fails instead of going vacuous', () => {
    const root = makeFixture();
    write(
      root,
      join('third_party', 'THIRD_PARTY_NOTICES.md'),
      '# Third-party Notices\n\n| Component | Upstream | Version/commit | License | Archive SHA-256 | Status |\n|---|---|---|---|---|---|\n',
    );
    const result = runGate(root);
    expect(result.output).toContain('has no `rhwp` row');
    expect(result.code).not.toBe(0);
  });

  it('R9: a missing SBOM file fails', () => {
    const result = runGate(makeImportedFixture({ sbomBody: null }));
    expect(result.output).toContain('R9 sbom_file not found');
    expect(result.code).not.toBe(0);
  });

  it('R9: an SBOM without an rhwp component fails', () => {
    const result = runGate(
      makeImportedFixture({
        sbomBody: JSON.stringify({ spdxVersion: 'SPDX-2.3', packages: [{ name: 'serde' }] }),
      }),
    );
    expect(result.output).toContain('R9 sbom_file lists no rhwp component');
    expect(result.code).not.toBe(0);
  });

  it('R9: an SBOM whose format does not match sbom_format fails', () => {
    const result = runGate(
      makeImportedFixture({
        provenanceOverrides: { sbom_format: 'cyclonedx-json' },
        sbomBody: SPDX_SBOM,
      }),
    );
    expect(result.output).toContain('bomFormat is not "CycloneDX"');
    expect(result.code).not.toBe(0);
  });

  it('R10: importing third_party/rhwp while nothing is imported fails', () => {
    const result = runGate(
      makeFixture({
        extra: {
          [join('packages', 'hwpx-adapter', 'src', 'core.ts')]:
            "import { parse } from '../../../third_party/rhwp/upstream/pkg/rhwp.js';\nexport const p = parse;\n",
        },
      }),
    );
    expect(result.output).toContain(
      'R10 packages/hwpx-adapter/src/core.ts imports third_party/rhwp',
    );
    expect(result.output).toContain('the intake status is NOT_IMPORTED');
    expect(result.code).not.toBe(0);
  });

  it.each([
    ['services', 'const rhwp = require("../../third_party/rhwp/upstream/pkg");\n', 'engine.js'],
    ['apps', "await import('../third_party/rhwp/upstream/pkg/rhwp.js');\n", 'boot.mts'],
  ])('R10: %s source importing an unimported rhwp fails', (scanRoot, body, filename) => {
    const result = runGate(
      makeFixture({ extra: { [join(scanRoot, 'x', 'src', filename)]: body } }),
    );
    expect(result.output).toContain('imports third_party/rhwp');
    expect(result.code).not.toBe(0);
  });

  it('R10: the same import is allowed once status is IMPORTED', () => {
    const result = runGate(
      makeImportedFixture({
        extra: {
          [join('packages', 'hwpx-adapter', 'src', 'core.ts')]:
            "import { parse } from '../../../third_party/rhwp/upstream/pkg/rhwp.js';\nexport const p = parse;\n",
        },
      }),
    );
    expect(result.output).toContain('import third_party/rhwp and status is IMPORTED');
    expect(result.code, result.output).toBe(0);
  });

  it('R10: merely mentioning the path in a comment is not an import', () => {
    const result = runGate(
      makeFixture({
        extra: {
          [join('packages', 'domain', 'src', 'note.ts')]:
            '// rhwp lands in third_party/rhwp/upstream once CC-145 runs.\nexport const x = 1;\n',
        },
      }),
    );
    expect(result.output).toContain(
      'R10 no services/packages/apps source imports third_party/rhwp',
    );
    expect(result.code, result.output).toBe(0);
  });
});

describe('CC-140 source intake gate — R12 POC Gate minimum set', () => {
  // ADR v1.1 §8.3: "POC Gate를 통과한 특정 Tag 또는 Commit의 소스 아카이브를 …
  // 반입한다". SOURCE_OF_TRUTH puts ADR v1.1 above the WBS, so IMPORTED cannot
  // mean "downloaded, gates never run".
  it.each([
    ['G15-6', '라이선스 (license/SBOM)'],
    ['G15-1', '분석 (analysis)'],
  ])('R12: IMPORTED with %s still PENDING fails', (gate, label) => {
    const result = runGate(
      makeImportedFixture({
        provenanceOverrides: {
          poc_gate: { ...MINIMUM_POC_GATE, [gate]: PENDING_GATE },
        },
      }),
    );
    expect(result.output).toContain(
      `R12 status is IMPORTED but poc_gate ${gate} ${label} is PENDING`,
    );
    expect(result.output).toContain('PROVENANCE_RECORDED');
    expect(result.code).not.toBe(0);
  });

  it('R12: IMPORTED with every gate PENDING names both missing gates', () => {
    const allPending = Object.fromEntries(
      Object.keys(MINIMUM_POC_GATE).map((gate) => [gate, PENDING_GATE]),
    );
    const result = runGate(makeImportedFixture({ provenanceOverrides: { poc_gate: allPending } }));
    expect(result.output).toContain('R12 status is IMPORTED but poc_gate G15-1');
    expect(result.output).toContain('R12 status is IMPORTED but poc_gate G15-6');
    expect(result.code).not.toBe(0);
  });

  it('R12: a recorded FAIL on an otherwise optional gate blocks IMPORTED', () => {
    const result = runGate(
      makeImportedFixture({
        provenanceOverrides: {
          poc_gate: {
            ...MINIMUM_POC_GATE,
            'G15-4': { state: 'FAIL', evidence: 'docs/evidence/cc-145/g15-4-roundtrip.md' },
          },
        },
      }),
    );
    expect(result.output).toContain('poc_gate G15-4 저장 (save round-trip) is FAIL');
    expect(result.code).not.toBe(0);
  });

  it('R12: G15-2..G15-5 may stay PENDING (UNE layers do not exist at intake time)', () => {
    const result = runGate(makeImportedFixture());
    expect(result.output).toContain(
      'R12 poc_gate G15-1 + G15-6 are PASS and no other gate is FAIL',
    );
    expect(result.code, result.output).toBe(0);
  });

  // The escape hatch R12 relies on: if it did not pass, R12 would force either a
  // false IMPORTED or the undeclared-source state that R2 now rejects.
  it('R12/R2: PROVENANCE_RECORDED with an empty upstream/ is the legal interim state', () => {
    const root = makeFixture({
      notices: [UPSTREAM_URL, `${TAG} (${COMMIT})`, 'MIT', ARCHIVE_SHA, 'PROVENANCE_RECORDED'],
    });
    write(root, join('third_party', 'rhwp', 'sbom', 'rhwp.spdx.json'), SPDX_SBOM);
    write(
      root,
      join('third_party', 'rhwp', 'PROVENANCE.yaml'),
      stringify(
        importedProvenance(root, {
          status: 'PROVENANCE_RECORDED',
          // Ref, hashes and SBOM are settled; the source itself is still in a
          // scratch directory outside the repo while G15-1/G15-6 run, so
          // tree_digest is the empty-tree digest (importedProvenance measures it).
          poc_gate: Object.fromEntries(
            Object.keys(MINIMUM_POC_GATE).map((gate) => [gate, PENDING_GATE]),
          ),
        }),
      ),
    );
    const result = runGate(root);
    expect(result.output).toContain('R2 status (PROVENANCE_RECORDED) is consistent');
    expect(result.output).not.toContain('R12');
    expect(result.code, result.output).toBe(0);
  });
});

describe('CC-140 source intake gate — anti-vacuity', () => {
  it('a missing upstream/ anchor directory fails instead of silently passing', () => {
    const root = makeFixture();
    rmSync(join(root, 'third_party', 'rhwp', 'upstream'), { recursive: true, force: true });
    const result = runGate(root);
    expect(result.output).toContain(
      'required intake directory missing: third_party/rhwp/upstream/',
    );
    expect(result.code).not.toBe(0);
  });

  it('a missing PROVENANCE.schema.json fails', () => {
    const root = makeFixture();
    rmSync(join(root, 'third_party', 'rhwp', 'PROVENANCE.schema.json'), { force: true });
    const result = runGate(root);
    expect(result.output).toContain(
      'required file missing: third_party/rhwp/PROVENANCE.schema.json',
    );
    expect(result.code).not.toBe(0);
  });
});
