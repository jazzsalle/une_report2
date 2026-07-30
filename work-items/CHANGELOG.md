# Implementation Changelog

## Unreleased

- CC-002 (2026-07-30): local infrastructure compose verified at runtime.
  PostgreSQL 16.9-bookworm (glibc for managed-Postgres demo parity; ICU ko-KR
  + data-checksums initdb) + MinIO + one-shot idempotent minio-init (bucket,
  bucket-scoped policy une-app, least-privilege service account). Runtime on
  WSL2 Ubuntu 24.04 + Docker Engine CE 29.6.2 (free path per profile):
  healthy healthchecks, pg_isready/mc ready, host access via WSL localhost
  forwarding, named volumes survive container recreation and WSL VM restart.
  Security: 127.0.0.1 default bind (UNE_BIND_ADDRESS), non-superuser app role
  une_app (NOSUPERUSER/NOBYPASSRLS, created on first initdb) for runtime
  DATABASE_URL, MinIO root reserved for human ops, no secrets committed
  (${VAR:?} guards). CI gains docker compose config --quiet gate. Evidence:
  docs/evidence/CC-002-runtime-verification.md. Review: architecture-guardian
  CONDITIONAL PASS + qa-gate-reviewer PASS WITH CONDITIONS (acceptance
  criteria independently reproduced); mandatory findings fixed same day -
  image parity (M-4), loopback bind (M-2), storage least privilege (M-1/C3),
  RLS-safe app role (C2), status-docs sync + evidence commit (M-3/C1), WSL
  idle-shutdown and scope-deferral notes in infrastructure/README.md (C4).
  Deferred with record: AV-scan stub to CC-140/CC-220, PgBouncer and bucket
  versioning re-evaluated later, FORCE RLS + une_app testing added to CC-004
  acceptance criteria. Also: OB-14 demo backend host closed as Railway by
  user decision (2026-07-30); final delivery environment stays OPEN
  (OPEN_BINDINGS/TECHNOLOGY_PROFILE/00_DECISIONS_TO_CONFIRM/
  IMPLEMENTATION_BASELINE synced).

- CC-003 (2026-07-30): contract validation gate and type generation (ADR-20).
  pnpm validate:contracts (scripts/validate-contracts.mjs): OpenAPI 4 files
  structural validation (@seriousme/openapi-schema-validator, 3.1), JSON
  Schema 7 files Ajv 2020-12 compile incl. cross-file $ref via
  https://schemas.une.local/ $id, mock-server route sync (13 routes vs
  une-platform-api-v1; explicit exceptions: /health ops endpoint,
  /api/v1/{path:path} catch-all; unparseable registration styles fail the
  gate; zero-file counts fail). pnpm generate:contract-types
  (openapi-typescript, types-only): une-platform-api -> services/api/src/
  generated, T3Q legacy + target-v2 + UNI -> packages/provider-adapters/src/
  generated (target-v2 header carries NOT-T3Q-accepted/OB-10 warning);
  outputs committed, CI regenerates and blocks drift (git add -N + git diff
  --exit-code). /health confirmed out-of-contract (deferred from CC-001).
  provider-adapters exports field blocks generated-type deep imports;
  packages/domain has no generated-type dependency. Generated dirs excluded
  from ESLint/Prettier, still typechecked. Negative tests: broken openapi
  version + broken schema $ref -> exit 1, restored; fake mock route detected.
  Review (architecture-guardian CONDITIONAL PASS, qa-gate-reviewer PASS WITH
  CONDITIONS run as general-purpose agents with project agent definitions):
  all mandatory findings fixed same day - CI untracked-file drift blind spot,
  api_route fallback allowlist + APIRouter/include_router/add_api_route
  guard, target-v2 warning header, exports subpath block, zero-file guards,
  MASTER_WORK_ITEMS evidence. Deferred: example-level contract tests to
  tests/ wiring (CC-115/CC-400 with redocly style lint re-evaluation).
  Also: .gitattributes eol=lf extended to source files (company-PC
  core.autocrlf=true made prettier fail on all checked-out files); CI fix
  e429891 (pnpm/action-setup version input vs packageManager conflict)
  landed on main earlier the same day.

- CC-001 (2026-07-30): pnpm monorepo bootstrap. Workspaces: apps/web,
  apps/field-web (React 19 + Vite 7), services/api (NestJS 11, /health),
  services/worker (NestJS standalone heartbeat), services/hwpx-engine
  (contract stub only - rhwp intake gated by ADR-15/CC-140), packages/domain
  (branded IDs, IdempotencyKey), packages/provider-adapters (boundary stub).
  Root: pnpm-workspace.yaml, shared tsconfig/ESLint flat/Prettier, README.
  Non-secret .env.example per service/app. scripts/validate_handoff.py now
  skips node_modules/.git/dist. database/migrations README corrected: V001-V010
  are the design-baseline schema, applied at CC-004. Gates: build/typecheck/
  test (10)/lint/validate_handoff all pass.
  Review fixes (architecture-guardian CONDITIONAL PASS, qa-gate-reviewer PASS
  WITH CONDITIONS; all Medium items closed same day): /api/v1 global prefix
  with /health excluded as out-of-contract ops endpoint (OpenAPI local server
  synced to :3001 in the same change); packages/domain switched to
  platform-neutral globalThis.crypto (browser-shareable per ADR-19); test
  sources now typechecked via per-package tsconfig.test.json; GitHub Actions
  CI added (.github/workflows/ci.yml - install/build/typecheck/test/lint/
  format:check/validate); prettier format + format:check scripts; Windows-safe
  watch scripts replace POSIX '&' pattern; unused @une/domain deps removed
  from provider-adapters/hwpx-engine; Node floor 22.12+ documented in
  TECHNOLOGY_PROFILE (Vite 7 requirement). Bootstrap exception: CC-000/CC-001
  committed directly to main; feature/CC-<id> branch policy applies from
  CC-002.

- CC-000 (2026-07-30): implementation profile approved. Backend NestJS
  (Node/TS) per ADR-19 (supersedes ASP.NET Core 8 recommendation), pnpm,
  MinIO/S3-compatible storage, GitHub Actions CI, Chrome+Edge latest,
  Windows 11 QA. Deployment: local Docker Compose (free path); demos need
  public URLs (no fixed IPs) → frontend Vercel + cloud container backend,
  host OPEN as OB-14. Hancom Track B version stays OPEN as OB-08.
  Reviewed by architecture-guardian and qa-gate-reviewer (parallel);
  all High/Medium findings fixed same day: IMPLEMENTATION_BASELINE §6 synced
  to approved profile, session handoff updated, demo access-control and
  mock-jwt constraints added, branch policy recorded, ADR register created,
  ADR-19 citation/supersede-scope corrected (rhwp stays Rust/WASM per ADR-15).
  Files: work-items/00_DECISIONS_TO_CONFIRM.yaml,
  docs/adr/ADR-19-backend-profile-nestjs.md, docs/adr/README.md,
  docs/handoff/TECHNOLOGY_PROFILE.md, docs/handoff/IMPLEMENTATION_BASELINE.md,
  docs/handoff/OPEN_BINDINGS.md, docs/handoff/SOURCE_OF_TRUTH.md,
  docs/handoff/SESSION_HANDOFF.md, CLAUDE.md,
  work-items/MASTER_WORK_ITEMS.yaml, work-items/IMPLEMENTATION_STATUS.md.
