# Implementation Status

Last updated: 2026-07-30

| ID | Title | Status | Branch/PR | Evidence | Next action |
|---|---|---|---|---|---|
| CC-000 | Confirm implementation profile and external assumptions | DONE | main | 00_DECISIONS_TO_CONFIRM.yaml APPROVED 2026-07-30; ADR-19; TECHNOLOGY_PROFILE.md; OB-09 closed, OB-14 added | Proceed to CC-001 (NestJS monorepo bootstrap) |
| CC-001 | Bootstrap monorepo and shared tooling | DONE | main | pnpm build/typecheck/test/lint all pass (10 tests); validate_handoff PASS 254 files; env examples + README | Proceed to CC-002 (compose: PostgreSQL+MinIO) |
| CC-002 | Bootstrap PostgreSQL, object storage, and local compose | DONE | main (PR #2 merged, CI green) | Runtime verified on WSL2 Ubuntu + Docker CE 29.6.2 (b5e0e27 + review fixes): healthy/pg_isready/mc ready; volumes survive down/up + WSL restart; 127.0.0.1 bind; une_app role (NOSUPERUSER/NOBYPASSRLS); bucket-scoped MinIO service account; no secrets; docs/evidence/CC-002-runtime-verification.md; dual review mandatory findings fixed same day | Proceed to CC-004 |
| CC-003 | Import and validate OpenAPI and JSON Schemas | DONE | main (PR #1 merged, CI green) | validate:contracts PASS (4 OpenAPI + 7 schemas + mock sync 13 routes); negative tests exit 1; 4 generated types-only files + CI drift gate; ADR-20; dual review conditions fixed | Proceed to CC-004 (needs CC-002 runtime) |
| CC-004 | Apply initial database migrations and seed | DONE | feature/CC-004 | node-pg-migrate v9 (ADR-21); 0001~0011 apply to empty DB (57 tables, FORCE RLS 17, une_app grants); baseline defects fixed pre-application (uuid[]/jsonb, plan timestamps, 74 random defaults, uk_outbox_idem, global-row policies, preflight guard); @une/db-integration 17/17 (outbox atomicity, RLS as une_app, idempotency dup rejected); data dictionary 57/512 + CI db-verify drift gate; docs/evidence/CC-004-migration-verification.md; dual review mandatory findings fixed same day | Create PR and merge; then CC-100 (needs CC-003+CC-004) |
| CC-100 | Implement mock authentication, tenant, and RBAC | DONE | feature/CC-100 | UNE-AUTH-001~007 (mock JWT AUTH_MODE=mock + env secret, tenant forgery blocked on 5 paths, RBAC from DB via role_permission, audit LOGIN/LOGOUT/REFRESH/ACCESS_DENIED); migrations 0012 (role_permission + 54-permission/15-role catalog, ADR-22) + 0013 (catalog read-only, refresh_hash unique); @une/api 55/55 (e2e 15 as SET LOCAL ROLE une_app), @une/db-integration 25/25; contract TokenResponse envelope + /auth/refresh PUBLIC_REFRESH updated with impl; dual review mandatory findings (correlation-id width 500, refresh rotation conflict, suspended tenant, permission catalog writable) fixed same day; docs/evidence/CC-100-auth-rbac-verification.md | Create PR and merge; then CC-110/CC-200 (G2 items) |
| CC-110 | Implement Plan and immutable PlanContextSnapshot | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-115 | Baseline current T3Q RPT-001/002 and target-v2 change request contracts | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-120 | Implement T3Q RPT-001 TOC job using mock adapter | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-125 | Implement dual Legacy and Target-v2 T3Q Plan adapters with mocks | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-130 | Implement T3Q RPT-002 content job and protected blocks | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-135 | Implement target-v2 plan job, semantic edit, evidence, and validation mocks | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-140 | Implement HWPX import, provenance, IR, and prototype analysis shell | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-150 | Implement document Revision, ChangeSet, autosave, diff, and conflict | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-160 | Implement HWPX preservation export and Track A validation | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-170 | Complete Plan vertical slice E2E | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-200 | Implement Situation and candidate SituationFact ingestion | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-210 | Implement duplicate/conflict resolution and SituationSnapshot | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-220 | Implement knowledge document upload and UNI mock adapter | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-230 | Implement evidence search and immutable EvidenceSet | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-240 | Implement UNI SOP generation and versioned UniSopMapper | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-250 | Implement SOP canvas model, validation, review, and approval | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-260 | Implement SopRun, Task, and explicit state machine | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-270 | Implement Transactional Outbox and simulation channels | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-280 | Implement field task acknowledge/start/progress/complete/reject/reassign | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-290 | Implement Execution Log and dashboard projections | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-300 | Implement Journal Projection, locked facts, editing, and export | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-310 | Implement exercise close, evaluation, and improvement feedback | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-320 | Complete Situation-SOP-Journal vertical slice E2E | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-400 | Bind actual T3Q contracts and run contract/E2E tests | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-410 | Bind actual UNI contracts and finalize mapping | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-420 | Run Hancom Track B round-trip gate | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-430 | Security, performance, observability, backup and recovery | NOT_STARTED | - | - | Confirm dependencies and plan |
| CC-440 | Release candidate, acceptance package, and deployment runbook | NOT_STARTED | - | - | Confirm dependencies and plan |
