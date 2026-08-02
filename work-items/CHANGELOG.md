# Implementation Changelog

## Unreleased

- CC-135 (2026-08-02): target-v2 plan job / semantic edit / evidence /
  validation full in-process mock (ADR-28) — every v2 capability stays
  MOCK_ONLY; nothing here is T3Q support (contract 1.0.1-request NOT
  accepted, OB-10/11 open). Port: SemanticEditCapable / EvidenceSearchCapable
  / ValidationCapable / JobLifecycleCapable mixins under the UNCHANGED 6-op
  vocabulary (lifecycle reports as jobStatus — ADR-28 D2), T3Q_CONFLICT
  error code, describeRuntimeFeature for the finer featureIds (AC5).
  Canonical-lite provisional drafts (EditProposal/EvidenceItem/
  ValidationIssue) live in @une/domain so provider DTOs never leak (D3).
  Mock: MockTargetV2JobStore single ledger — polling, `.assumed` SSE frames
  (id==sequence, heartbeat comments, Last-Event-ID replay, terminal event
  required; resume-past-terminal = empty-frames SUCCESS per QA F-3), cancel
  (freezes progress; terminal cancel 409→T3Q_CONFLICT), partial retry
  (failed SECTION targets only — non-failed 409, BLOCK honestly 422
  not-mocked; new deterministic generationId), idempotent resubmit joins the
  same generation with payload-fingerprint 409 on mismatch, retained-job cap.
  PARTIAL read fail-closed as NON-terminal (D4); UNE job/plan vocabulary
  unchanged. contentV2 joins section blocks onto an outline-parallel
  ContentDraft tree (D7, lossy fields kept raw); evidence fills the ADR-26
  D4 provenance slots and round-trips to generated_block.citations_json
  (migration count 0 — catalog pinned by db-integration); validation = 6
  deterministic UNE heuristics whose verdict gates NOTHING (D9; ADR-27 D8
  corrected in place); capabilities discovery deep-equals the contract
  example (providerBuild une-mock-*), and negotiation can never promote the
  registry (D11). Worker: CC-130 m-10 v2 trace seam closed (placeholders
  mock-runtime only, per-attempt requestId), partial failure writes NO row
  and supersedes NOTHING while auditing failed counts (arch M-1), startup
  prints describeRuntimeFeature for all 8 v2 features. Adapter unions
  declared∪observed failures (arch M-2 fail-open fix), protected-block
  response re-check scans operation payloads recursively (m-5), live
  transports are refused at construction without explicit opt-in (QA F-4 /
  m-8 — no timeout/retry/CB policy exists before CC-400). Contract:
  response-side examples 12→22 (ADR-24 R2 closed), exemptions 2→0, OB-10
  caveats moved into rendered example summaries/descriptions, version kept
  at 1.0.1-request with generated-types diff 0 as the machine proof. Dual
  review (opus, parallel) same-day: architecture 0 BLOCKER / 2 MAJOR / 9
  MINOR; QA PASS WITH CONDITIONS F-1~F-4 + G-1~G-9 (numbers independently
  reproduced; G-6/G-7 accepted with rationale). Gates: domain 52,
  provider-adapters 108, contract-tests 60, db-integration 68, worker 33,
  api 193, baseline 10, validate:contracts/handoff PASS. Evidence:
  docs/evidence/CC-135-target-v2-mock-verification.md.

- CC-130 (2026-08-02): T3Q RPT-002 CONTENT job + protected blocks.
  UNE-PLAN-016 detailed to 009 parity (GenerationJobResponse 202, required
  idempotency, targetNodeKeys scoped regeneration, protectedBlockIds
  persisted as USER_LOCKED at request time, contentSummary on job result,
  content.block/job.progress public SSE vocabulary; mock-server 19 routes,
  baseline 10). Migration 0017 generated_block — 60th table justified as a
  §3.3/x-db-tables vs §6.2 baseline gap (ADR-27 D2): immutable rows with
  generation supersede (partial-unique current per plan+node_key, write
  order supersede→insert→link), protection_state reusing the 0003
  document_block vocabulary, citations_json + STORED citation_count +
  no-evidence partial index, EXISTS-plan FORCE RLS, and a BEFORE UPDATE
  trigger that blocks une_worker from touching protected rows or any
  column outside the supersede set (STORED columns excluded from the
  trigger diff — found by the DB agent: they are NULL in BEFORE triggers).
  Worker: shared plan-jobs dispatch primitives extracted from plan-toc
  (ADR-25 D12 settled — the duplication it targeted was worker-internal;
  api↔worker package deferred with explicit closure criteria),
  PlanJobPoller over both runners, ContentJobRunner with the same 3-tx
  shape: B0 fail-closed on snapshot/toc hash drift + outline moved, provider
  call outside transactions (sync JSON — assumed SSE framing stays off the
  operational path behind UNE_T3Q_CONTENT_STREAM), B1 anchors by
  position+normalized-title double match with WHOLE-response quarantine
  (US-PLAN-012 E-02), re-checks protection at write time, discards
  everything if the outline moved (supersededByOutlineChange), synthesizes
  content.block events per block and throttled job.progress (US-PLAN-012
  A-02 — timing honestly not real-time, ADR-27 D5). API: ContentJobService
  (preconditions incl. current-toc-version pin, unknown protected ids 422,
  2-layer idempotency), job-type-aware cancel/retry (plan revert +
  audit action per type), active-job invariant made job-type agnostic and
  TOC regeneration blocked while body blocks exist — new or retried
  (ADR-27 D9); partial retry stays a NEW job (blockIds 400). Capability:
  legacyContent → UNE_ADAPTER_READY (ADR-26 D7: 구현∧결선∧live spec).
  Self-found defects fixed in-flight: toc_node tree rebuild needed ORDER BY
  level (sort_order is sibling-scoped); supersede must precede insert
  (transient double-current forbidden by the partial unique). Dual review
  fixed same day (arch: BLOCKER scoped-regen coordinate corruption →
  full-outline coordinate injection, discard-path plan stuck, manual
  outline-save guard, 422 unification, PRESERVED hash payload, contract
  sync, 11 minors; QA: PASS WITH CONDITIONS, all numbers independently
  reproduced, F1~F5 + G1~G9 applied incl. CI pytest baseline). Suites:
  domain 52, provider-adapters 67, contract-tests 38, db-integration 65,
  worker 31, api 193, baseline 10. ADR-27;
  docs/evidence/CC-130-t3q-content-job-verification.md.

- CC-125 (2026-08-02): Dual Legacy/Target-v2 T3Q plan adapters behind one
  port. Unified T3qPlanProvider (t3q-plan-port.ts): complete operation
  vocabulary, TocCapable/ContentCapable mixins (semantic-edit family waits
  for CC-135 canonical types — ADR-24 D8 logic), T3qPlanResult<T> envelope
  with PER-CALL adapterId/mappingVersion/operation/httpStatus; T3qTocPort
  absorbed and deleted (ADR-25 D3 follow-through). LegacyT3qPlanAdapter:
  real HTTP over undici (split connect/response timeouts 5s/60s as UNE
  baseline — NOT provider-agreed, OB-01), fail-closed config (base URL/auth
  injected only, no transcript fallback, no default auth convention, TLS
  disable inexpressible + static hygiene test), retry ×1 only for
  pre-response failures + 429/503 Retry-After (capped), per-operation
  circuit breaker (5→open 30s→half-open probe), lease>call-budget startup
  validation; verified by 20 local node:http fixture-server cases (timeout/
  refused/SSE-truncation measured on real sockets). RPT-002 scope: transport
  + mapping + guard + SSE parser + canonical-lite ContentDraft in
  @une/domain (derived from ContentSection∩ContentBlock); content JOB
  pipeline stays CC-130. TargetV2T3qPlanAdapter: tocV2 only, faithful
  202→poll→COMPLETED against a deterministic in-process transport,
  request machine-validated against TocGenerationRequest
  (unevaluatedProperties:false catches typo fields — negative pinned),
  sectionId→nodeKey stable ids, mock-only documentId/baseRevisionId
  placeholders until CC-150. Selection: UNE_T3Q_PLAN_ADAPTER env
  (mock-legacy|legacy-http|mock-target-v2) via pure factory; retired
  UNE_T3Q_TOC_ADAPTER hard-fails; production+mock blocked without explicit
  opt-in; provider_config toggle deferred with reserved key t3q.planAdapter
  (ADR-26 D6). Traceability: guard-violation raw loss fixed (failures carry
  rawRequest+rawResponse; worker e2e regression), provider.requested
  emission (identity/budget only — no headers/tokens), provider.responded/
  failed enriched with operation/httpStatus/result-based mappingVersion;
  dedicated trace store declined (ADR-25 D10 closed). Migration 0016:
  EXISTS-parent FORCE RLS on job_event/toc_version/plan_context_snapshot/
  toc_node (ADR-25 D2 closed; dispatch-scope access now denied — known-limit
  pin reversed; EXPLAIN pins uk_job_event_seq index path; db-integration
  51/51). Capability: legacyToc→UNE_ADAPTER_READY (구현∧결선∧live spec),
  legacyContent/tocV2 stay MOCK_ONLY with implemented flags; new governance
  invariant pins every CR-T3Q-* feature to MOCK_ONLY while OB-10/11 open.
  Contracts: target-v2 examples-only +2 (version unchanged at
  1.0.1-request), example-gate exemptions 3→2, transcript pin untouched;
  port contract tests validate mapper outputs against both contracts.
  Dual review fixed same day (arch: M1 ContentDraft wording + provenance
  slots, M2 runtimeMode + live-placeholder fail-closed, M3 MOCK RUNTIME
  capability marking, 11 minors; QA: PASS WITH CONDITIONS, all numbers
  independently reproduced, 503/403 tests added). Suites: provider-adapters
  67, domain 35, contract-tests 38, worker 24 (3 new e2e journeys incl.
  legacy-http full journey), api 175, db-integration 51, baseline 6.
  ADR-26; docs/evidence/CC-125-t3q-dual-adapter-verification.md.
- CC-120 (2026-08-02): T3Q RPT-001 TOC job with mock adapter.
  UNE-PLAN-009~015: job create (2-layer idempotency — api_idempotency
  interceptor + uk_job_idempotency sha256(jobType|endpoint|planId|clientKey)),
  status polling with result projection, SSE (manual streaming after finding
  Nest @Sse does not await async handlers — 404 stays a JSON envelope;
  public/internal event split, Last-Event-ID resume, heartbeat repeats the
  cursor id), cancel (QUEUED settles, RUNNING via worker checkpoint + dispatch
  sweep), retry (FAILED only, full plan preconditions re-applied, attempt
  budget reset), user TOC version save/get (keys inherited, u-* namespace,
  confirm -> OUTLINE_CONFIRMED) with active-job guard protecting user edits
  from regeneration (review B1). Worker execution plane per design 10
  §4.2/§7.9: migration 0015 (generation_job created_at/updated_at/attempt_no
  + CHECKs + missing FKs + une_worker role with table-scoped grants +
  conditional dispatch RLS policies — terminal writes only in tenant scope,
  DB-enforced), 3-tx runner with provider call outside transactions,
  deterministic MockLegacyT3qTocAdapter behind narrow T3qTocPort (CC-115 gap
  matrix mapper, response guard, no production backdoor; explicit
  UNE_T3Q_TOC_ADAPTER flag + MOCK_ONLY startup warning). Domain plan module:
  job state machine, toc-tree validation/deterministic path node keys/
  flatten/content hash, platform-neutral SHA-256, TocJobRequest seam.
  plan-status/canonical-json moved from services/api to @une/domain. CI
  db-verify gains pnpm build (clean-runner fix) + worker job. Dual review
  (architecture-guardian 1 BLOCKER/6 MAJOR/10 MINOR; qa-gate-reviewer PASS
  WITH CONDITIONS, 필수 4) fixed same day. ADR-25;
  docs/evidence/CC-120-t3q-toc-job-verification.md.
- CC-115 (2026-08-02): T3Q contract baseline. target-v2 contract fixed
  editorially (1.0.1-request, user-approved): allOf+additionalProperties
  composition defect (4/5 request schemas structurally unsatisfiable, Toc on
  own-field use) corrected with unevaluatedProperties; the only example was
  missing required clientContext/requestedAt; 10 examples added with
  PlanContext vocabulary. Field-level request content unchanged (footnote in
  provider-requests + ADR-24 D1). validate-contracts.mjs section 4: media-type
  example<->schema gate (all-operations-minus-documented-exemptions coverage,
  2xx-only credit, legacy transcript SHA-256 pin). New workspace
  tests/contract (@une/contract-tests, CC-003 deferred wiring): legacy fixture
  tests 13 (UNE-authored, provider-unverified, SSE .assumed.), field gap
  matrix drift 5 (docs/handoff/T3Q_PLAN_FIELD_GAP_MATRIX.md path existence +
  3-way completeness + row correspondence), capability governance 6, no-UNI
  static guard 2 (AT-T3Q-011 static half). Capability registry
  (provider-adapters/src/capability, source-controlled, 14 features all
  MOCK_ONLY, promotions gated on evidence+bindings; vitest alias pins tests to
  source not dist). Generated-type banner reads contract version dynamically.
  No migration (feature_flags_json stays CC-125 runtime-toggle). redocly
  re-deferred to CC-400 (ADR-24 D5); T3qPlanProvider port left to CC-125
  (ADR-24 D8). Dual review (architecture-guardian 1 BLOCKER/3 MAJOR/10 MINOR;
  qa-gate-reviewer PASS WITH CONDITIONS, 2 mandatory) fixed same day.
- CC-110 (2026-08-01): plan CRUD + immutable PlanContextSnapshot
  (UNE-PLAN-001~008). If-Match/version_no optimistic locking (strong ETags,
  428/COM-0428), soft-delete trash (idempotent 204, APPROVED/FINAL blocked),
  draft relaxed AJV validation (required/minLength/minItems tolerated) with
  single-draft upsert, snapshot strict validation + canonical SHA-256 +
  per-plan version serialization (FOR UPDATE) + supersedes chain + same-hash
  dedupe + DRAFT->CONTEXT_READY via domain transition fn + approval lock 412
  PLAN-412-002 — all in one tx with audit (before_json on update/delete).
  Idempotency-Key common interceptor (ADR-22 D6 resolved) + migration 0014
  api_idempotency (59th table, ADR-23; concrete-path+principal replay
  identity after review B1) + uk_plan_context_draft_plan + plan.start_mode.
  Contract plan slice finalized (envelope schemas, query params, 412/428
  responses, IdempotencyKeyRequired) + mock-server plan sync. @une/api
  107/107 x5 consecutive (vitest fileParallelism:false fixes e2e DB race),
  db-integration 30/30. Dual review (1 BLOCKER/7 MAJOR + QA 6 mandatory)
  fixed same day. docs/evidence/CC-110-plan-context-snapshot-verification.md.
- CC-100 (2026-07-31): mock authentication, tenant scoping, and RBAC.
  UNE-AUTH-001~007 in services/api (NestJS): AUTH_MODE=mock issues HS256 UNE
  JWTs (UNE_AUTH_JWT_SECRET >=32 chars from env, no default; non-mock mode
  answers 503 AUTH-1004 — real T3Q SSO stays OB-01 OPEN). Tenant comes only
  from DB-confirmed/signature-verified claims; DatabaseService.withTenant sets
  tx-local app.tenant_id (+SET LOCAL ROLE une_app for admin-URL test runs) and
  repositories keep explicit predicates + parent-aggregate joins for child
  tables (ADR-21 compensating control). Forgery blocked on 5 paths, all
  e2e-verified. RBAC resolved from DB: migration 0012 adds role_permission
  (design internal-inconsistency fix, 58th table), 54-permission catalog (1:1
  contract x-permission), 15 system roles (1:1 design 09 s3), role_code
  partial uniques; role->permission matrix deliberately not seeded (dev seed
  database/seeds/dev-iam.sql + fixtures; ADR-22 D2). Audit LOGIN/LOGIN_FAILED
  (own tx)/SESSION_REFRESHED/LOGOUT/ACCESS_DENIED append-only. Refresh tokens
  opaque urs.<tenant>.<random>, SHA-256 stored, rotated with presented-hash
  guard (concurrent use: exactly one winner). Contract updated with impl:
  TokenResponse -> {success,data,meta} envelope (ADR-22 D4), /auth/refresh
  security []/x-permission PUBLIC_REFRESH (D3 addendum), Idempotency-Key
  replay store deferred explicitly (D6). Dual review (architecture-guardian
  1 BLOCKER/4 MAJOR/9 MINOR; qa-gate-reviewer 4 mandatory) fixed same day:
  correlation-id normalized ^[A-Za-z0-9._:-]{1,80}$ (varchar(80) mismatch
  made 81-100 char headers 500 logins/bypass audit), suspended tenant +
  inactive user blocked everywhere, 0013_iam_hardening (permission catalog
  runtime read-only, explicit catalog grants, uk_user_session_refresh_hash),
  missing-session logout 401 not 409, ACCESS_DENIED audit path w/o query
  string (PII). Tests: @une/api 55/55 (unit 40 + e2e 15 against a migrated
  scratch DB as une_app), @une/db-integration 25/25; CI db-verify now runs
  the api e2e; root pnpm test serialized (--workspace-concurrency=1).
  Evidence: docs/evidence/CC-100-auth-rbac-verification.md, ADR-22.

- CC-004 (2026-07-30): database migration baseline applied and verified.
  Tool finalized (ADR-19 deferral): node-pg-migrate v9, SQL-file migrations,
  pgmigrations tracking, superuser une runs migrations / runtime stays
  une_app. Files renamed V###__ -> 0###_ (v9 numeric-prefix requirement;
  never applied anywhere, so forward-only intact). Baseline defects found on
  first-ever application and fixed pre-application (ADR-21, user-approved):
  invalid uuid[]/jsonb notation x3 -> uuid[]; plan.created_at/updated_at +
  trigger (design self-contradiction: IX-plan_plan-STATUS referenced them);
  74 non-PK DEFAULT gen_random_uuid() removed (silent FK/tenant fabrication
  trap); BEGIN/COMMIT stripped (tool wraps transactions); design UK-outbox-
  idem (idempotency_key, channel) added as uk_outbox_idem; global rows
  (tenant_id IS NULL on role/provider_config/retention_policy) made readable
  but not writable under FORCE RLS; 0001 empty-schema preflight guard.
  0011 added: FORCE RLS on 17 tenant tables, une_app role ensured + idempotent
  ALTER ROLE NOSUPERUSER/NOBYPASSRLS, pgmigrations zero-priv for une_app,
  UPDATE/DELETE revoked on append-only/immutable tables (execution_event,
  audit_log, task_event, plan_context_snapshot, situation_snapshot;
  sop_version/evidence_set deferred to CC-250/CC-230 with app-layer
  enforcement). tests/integration (@une/db-integration) 17/17 on real
  PostgreSQL 16.9: empty-DB 57 tables, fixture upgrade, outbox 3-write
  atomicity (commit+rollback), duplicate idempotency key rejected, RLS
  isolation as SET ROLE une_app, global-row read-only, priv checks; all
  skipped without DATABASE_URL. Data dictionary generated from applied
  schema (docs/db/DATA_DICTIONARY.md, 57 tables/512 columns, deterministic);
  CI db-verify job (postgres service container) runs tests + dictionary
  drift gate (git add -N). Compensating control recorded: DB RLS covers only
  17 parent tables; child tables rely on service-layer joins (CC-100
  criterion added). Review: architecture-guardian CONDITIONAL PASS +
  qa-gate-reviewer PASS WITH CONDITIONS (8 acceptance criteria independently
  reproduced); all mandatory findings (M1-M4/C1-C6) fixed same day.
  Deferred with record: IX-*-TENANT 10 indexes to per-domain query-plan
  verification (README mapping table), partition-transition REVOKE
  checklist, sop_version/evidence immutability to CC-250/CC-230.

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
