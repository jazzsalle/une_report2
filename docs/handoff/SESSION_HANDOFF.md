# Session Handoff

- Date/time: 2026-07-30
- Branch: main
- Current Work Item: CC-001
- Status: DONE

## Completed this session

- CC-000 DONE (commit b78c5b8): implementation profile approved (NestJS/Node-TS
  per ADR-19, pnpm, MinIO/S3-compatible, GitHub Actions, Chrome+Edge,
  Windows 11, trunk-based branch policy).
- CC-001 DONE (commit b1dc50e): see below.
- CC-001 DONE: pnpm monorepo bootstrap — apps/web + apps/field-web
  (React 19/Vite 7), services/api (NestJS 11, /api/v1 prefix, ops /health at
  root), services/worker (standalone heartbeat), services/hwpx-engine
  (contract stub; rhwp NOT imported, ADR-15 gate), packages/domain
  (platform-neutral branded IDs), packages/provider-adapters (stub),
  GitHub Actions CI, shared tsconfig/ESLint/Prettier, non-secret env examples.
- Both work items passed architecture-guardian + qa-gate-reviewer parallel
  review; every Medium/condition finding fixed same day.

## Tests and evidence

- pnpm build (7 projects) / typecheck (incl. tests) / test (10) / lint /
  format:check all exit 0; validate_handoff.py PASS.
- Runtime smoke: GET http://localhost:3001/health -> 200; /api/v1 prefix
  active (excluded /health returns 404 under prefix as designed).
- Full details in work-items/MASTER_WORK_ITEMS.yaml evidence and CHANGELOG.md.

## Decisions and OPEN bindings

- OB-14 (demo backend host + delivery env, before first G2 demo), OB-08
  (Hancom Track B version, before G4) remain OPEN.
- Migration tool (node-pg-migrate vs Prisma) decided at CC-004.
- /health formal OpenAPI inclusion decided at CC-003 (currently documented as
  out-of-contract ops endpoint in the contract header note).
- Node floor is 22.12+ (Vite 7), recorded in TECHNOLOGY_PROFILE.md.
- Bootstrap exception: CC-000/CC-001 direct to main; feature/CC-<id> branches
  from CC-002 onward.

## Risks/blockers

- manifest/SHA256SUMS.txt hashes are stale for files edited after package
  install (validation script does not check hashes; informational).
- Root .env.example (pre-existing) contains UNI_VERIFY_TLS=false — POC-local
  only; must never reach production config.
- tests/{unit,contract,integration,e2e} and tests/baseline pytest suite are
  intentionally unwired at G0.

## Exact next action

- Start CC-002 on branch feature/CC-002: Docker Compose for PostgreSQL 16 +
  MinIO with health checks, persistent volumes, no secrets in repo
  (bootstrap-repository skill). Local runtime on this PC needs a free Docker
  path (WSL2 Docker Engine CE / Rancher Desktop / Podman) — verify
  availability first.

## Notes

- `templete/` holds 6 real HWPX templates (보고 양식, 상황보고 등) — use as
  actual import/analysis/round-trip inputs for CC-140/CC-160/hwpx-roundtrip.
- pnpm installed globally via npm user prefix (corepack needs admin on this
  PC). pnpm 10.34.5 / Node 22.14.0.

## Company-PC quick start (tomorrow)

1. `git clone https://github.com/jazzsalle/une_report2` (or `git pull` if cloned)
2. Install Node >= 22.12, then `npm install -g pnpm@10`
3. `pnpm install` at repo root; verify with `pnpm build && pnpm test`
4. Open Claude Code in the repo — the SessionStart hook auto-loads this file
5. First check the GitHub Actions run for commits b78c5b8/b1dc50e (first CI
   run happens on push), then say "CC-002 진행하자" — it needs a Docker
   runtime (WSL2 Docker Engine CE / Rancher Desktop / Podman); if none is
   installed, installation guidance comes first.
