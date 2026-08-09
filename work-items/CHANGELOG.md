# Implementation Changelog

## Unreleased

- CC-210 follow-up (2026-08-09): the two acceptance limits the user chose to
  close, on one branch. **(1) Snapshot confirmation now needs the baseline it was
  taken from** (`expectedSnapshotId`, required — a 409 `SIT-409-004` when it does
  not match the current one). Without it two operators looking at the same screen
  both succeed: the second one changes the authoritative situation without ever
  seeing the first confirmation, and the first believes their snapshot is still
  the baseline. Row locking orders those writes, it does not tell either of them
  the other happened. First confirmation passes `null`; omitting the field is a
  400 so the guard cannot be skipped by leaving it out (ADR-34 D17).
  **(2) Provider payload retention — OB-16 closes.** User decision: after one
  month, blank the payload and keep the row. `payload_sha256`, `item_count`,
  received/created timestamps and status all survive, so the question an audit
  actually asks — what do you claim you received — still has an answer; deleting
  the row would take that with it. `provider_job.request_json` is in scope for
  the same reason as the response: `query` is a free-form object and a user can
  put an address or a name in it, and 0023 revoked UPDATE/DELETE from `une_app`,
  so nothing in the system could mask it afterwards. Migration 0026 adds
  `redacted_at` to both tables (without it, "was always empty" and "was cleared
  on schedule" are indistinguishable) plus a CHECK pairing the marker with the
  blanked payload. **The sweep runs as a new role, not as the worker.** Granting
  `une_worker` the UPDATE would have silently reversed ADR-33 D2, whose corollary
  — the worker never touches the situation tables — is pinned as a 42501
  regression. `une_retention` holds SELECT on the two tables and UPDATE on four
  columns; no INSERT, no DELETE, and `payload_sha256` is 42501 even for it. It
  reads every tenant through an explicit role-targeted policy rather than
  BYPASSRLS, so "why does it see everything" is visible in `pg_policies`. The
  period is configuration (`UNE_PAYLOAD_RETENTION_DAYS`, default 30), not a
  constant in the migration, and the worker refuses to start if the retention
  role equals the worker role.
  **A pre-existing defect surfaced and is not fixed here**: `une_app` cannot
  `SET ROLE une_worker` or `une_retention` — no migration, initdb script, compose
  file or CI step ever grants the membership, so a worker booted the way its
  `.env.example` documents dies with 42501 on its first transaction. It has been
  latent since 0015/CC-120 because every test connects as superuser and steps
  down. Both fixes touch deployment provisioning, and the cheap one
  (`GRANT une_retention TO une_app`) would hand the API runtime the ability to
  blank every tenant's payloads — exactly what the dedicated role avoids.
  Recorded in `docs/evidence/OB-16-payload-retention.md` §6 and now registered as
  **OB-17**, and the OB-16 Closed row says the sweep does not yet run — the means
  exist, the schedule does not.
  **Post-review additions (dual review, same day).** Migration **0027** closes a
  hole the column GRANTs could not: 0026's CHECK is one-directional, so
  `SET raw_payload_json = '{"forged":1}'` (marker left NULL) and
  `SET redacted_at = NULL` on an already-blanked row both succeeded — measured,
  not theorised. The first breaks the payload immutability 0023 established, the
  second erases the very distinction `redacted_at` exists to make. A `BEFORE
  UPDATE` trigger now permits exactly one transition and no reversal; it applies
  to the table owner too, because exempting the owner would make "append-only"
  half true. The retention decision is also registered as **ADR-35** — it narrows
  two CLAUDE.md non-negotiables (raw payloads retained for traceability, never
  overwrite audit history) and the only record was an evidence file, which is not
  in the source-of-truth order. ADR-33's D2 corollary is amended to say it is a
  *role* boundary and not a *process* boundary; ADR-34's acceptance limits 7 and
  10 are marked closed by D17 instead of still claiming the concurrent-confirm
  hole is open. `withRole(role)` became `withRetentionScope()` so a caller cannot
  route around the startup guard, and the SQL moved into
  `retention/retention.repository.ts` like the other four worker pipelines
  (ADR-27 D1). The sweep now logs every run including zero-count ones, so "nothing
  to blank" and "never ran" stop looking identical. The sweep also gained
  `FOR UPDATE SKIP LOCKED` — it was the only one of the five worker pipelines
  without it, and `main.ts` sweeps once at startup, so two replicas collided on
  every boot. Before 0027 the later transaction overwrote the earlier
  `redacted_at`, destroying the very fact the column exists to record; after
  0027 the trigger caught it but rolled the whole batch back with a 42501 that
  is indistinguishable from OB-17's. Verified by removing SKIP LOCKED and
  watching the new concurrency test fail. Sweep results now also report the
  remaining expired backlog, since 500 rows per 6 hours silently falls behind a
  heavier intake. Tables stay at 63; migrations 25 → 27.
  Tests: worker retention e2e 7 (+2), retention grants integration 13 (+2),
  worker config +5, domain snapshot guard +4, api resolution e2e +5 (concurrent
  confirm; non-UUID baseline → 400).

- CC-210 (2026-08-08): duplicate grouping, conflict resolution and the immutable
  SituationSnapshot (ADR-34). This closes the three decisions CC-200 deliberately
  left open and one place where the implementation disagreed with the design.
  `fact_duplicate_group` is created — the second contract pointing at a table
  that existed in no migration, and the same answer as `provider_result`: design
  06 US-SIT-006 asks for grouping explicitly, so the name gets a table rather
  than the contract getting an edit. The **duplicate unique key is deliberately
  not created**: a duplicate is a judgement, not a constraint. Two providers
  sending the same fact is normal, and a unique key would make the second one
  fail with 23505 — that does not prevent duplication, it prevents collection.
  **UNE-SIT-008 changed meaning.** Corrections now create a derived fact and mark
  the original SUPERSEDED instead of updating in place. Design 06 US-SIT-007 #3,
  §7.1 and CLAUDE.md's "never overwrite audit history" all say the same thing,
  and ADR-33 acceptance limit 12 had recorded the disagreement. The practical
  gain is that a confirmed snapshot's evidence can no longer change underneath
  it. The derived fact does **not** inherit the original's source — it gets a
  fresh MANUAL/USER one, because a number a user corrected must not appear as
  something the meteorological agency reported. `reason` became required, and
  the database enforces it: the derivation columns are all-or-nothing.
  Conflicts are detected when UNE-SIT-009 is called, not during collection —
  design 10 put `strategy,threshold` on that endpoint, which means grouping is a
  calculation the user chooses. **Same value and same time is a duplicate, not a
  conflict** (US-SIT-006 #3); two agencies agreeing is evidence, not disagreement.
  Resolution never touches the sources: the candidates that were not chosen stay
  CANDIDATE, because A-01 allows several facts to coexist and what goes into a
  snapshot is UNE-SIT-012's decision.
  Confirmation **blocks on unresolved conflicts** and never picks one itself, and
  the six blocking reasons are kept apart so a screen can say what to do. The
  snapshot stores **copies** of the facts: references alone would follow the
  sources, which is exactly what design 06 A-02 forbids — that plus the derived
  facts are two independent defences. The hash covers the facts and
  `effectiveAt` and excludes confirmer, time, version and reason, so it can still
  answer "is this the same content"; the diff is keyed by **standard key**, since
  comparing by factId would report a delete plus an add every time a different
  provider's evidence is chosen.
  Two defects surfaced by running it. A resolved conflict **came back to life on
  recalculation** — the partial unique index only covers OPEN, so the resolution
  row survived while the decision it recorded was undone and confirmation was
  blocked again; the fix checks for a prior conflict over the same candidate set,
  and still opens a new one when the candidates change. That fix then returned
  500 with `inconsistent types deduced for parameter`, because the same parameter
  appeared in both the INSERT target list and the NOT EXISTS comparison.
  Migration 0025: 62 → 63 tables, derivation lineage plus SUPERSEDED, vocabulary
  CHECKs and immutability on conflicts and resolutions, snapshot version
  uniqueness, hash format and non-empty facts, and the FK on
  `situation.current_snapshot_id` that had been missing since 0003.

- CC-200 (2026-08-08): Situation and candidate SituationFact ingestion (ADR-33).
  Two things were broken before a line was written. Migration 0023 (previous
  session) already **cited "ADR-33 D2" and "ADR-33 수용 한계" in its comments
  while no such file existed** — the constraints were enforced but their reasons
  were unreadable. And `Situation` was an `additionalProperties: true`
  placeholder, so the example gate (ADR-24) validated nothing; SIT-002 pointed at
  a single `Situation` where the design says `Page<Situation>`, and SIT-004/007/
  008 took `GenericRequest`, which accepts anything.
  **Provider collection is synchronous** (user decision). Every adapter is a mock
  today, so an asynchronous design would build a queue, a lease and a poller that
  wait for nothing. `provider_job` therefore has three states — SUCCEEDED /
  PARTIAL / FAILED — and no QUEUED/RUNNING, and `finished_at` is NOT NULL: rows
  are born already finished. The transaction boundary carries the weight: a short
  read to check the situation, **provider calls outside any transaction**, then
  one write transaction for jobs, raw payloads, sources, facts, the state
  transition and the audit. The write transaction re-locks the situation and
  re-checks it, because it can be closed while the providers are being called;
  on 412 nothing partial is left behind.
  Partial failure is a 200. Design 06 US-SIT-005 requires that a partial outage
  not block the flow, and E-01 (every provider down) still expects "사용자
  입력만으로 계속 가능" — so even total failure answers 200 with FAILED jobs, and
  a manual fact can still be registered afterwards. Failures are split eight ways
  so the screen can say what to do: `DISABLED` (flag off — SafeKorea/Naver,
  pending legal approval, OB-05) is not `NOT_CONTRACTED` (nothing to call at all —
  T3Q situation API, OB-02) is not a timeout. **Turning a flag on does not create
  a capability**: SafeKorea/Naver still answer `NOT_CONTRACTED` because the web
  collector is a separate component (design 01 §20.3), and disabled providers
  still write a FAILED row rather than being skipped silently.
  Normalization is a three-way discriminated union taken straight from design 06
  US-SIT-006 — `NORMALIZED`, `ORIGINAL_KEPT` (A-01: unit unconvertible, original
  value kept), `INVALID` (E-01/E-02: quarantined). The raw item rides on all
  three; nothing is ever discarded. Manual entry and corrections go through the
  **same** normalizer as provider collection, so a `3 cm` correction is stored as
  `30 mm` regardless of which door it came in. Timestamps demand an explicit
  offset: a naive `2026-08-08T09:00:00` is quarantined rather than guessed,
  because either guess writes a fact that is nine hours wrong.
  Three defects found by running the code. `new Date('2026-02-30T00:00:00Z')`
  **rolls over to March 2** instead of being NaN — a calendar date that does not
  exist was being stored silently, so the normalizer now validates month, day,
  time and offset range from the regex captures. Migration 0023 added
  `updated_at` to `situation` and `situation_fact` but **not** the repository's
  customary `trg_<table>_updated_at` triggers (verified against the dev database:
  `plan` has one, these two did not), which froze both columns at insert time and
  made their own comments false — closed by forward migration **0024**, never by
  editing 0023. And SIT-005 was answering 201 because NestJS defaults POST that
  way, where the contract says 200.
  A contract test now reads **the 0023 SQL itself** and compares the migration
  CHECKs, the domain constants and the contract enums in one place, because the
  same vocabulary lives in three files and fixing two of them either breaks
  INSERT with 23514 or promises values the database cannot store. Tenant
  isolation gets the regression file 0023's own comment already named:
  `situation` was the only table with RLS on, the other six had never had a
  policy, and 0011 grants `une_app` DML on every table — so "no policy" meant
  "visible to every tenant". `une_worker` is asserted to be blocked with 42501 on
  all seven, since collection is synchronous and the worker never touches them.
  Two contract gaps closed: **UNE-SIT-014** (candidate fact list — without it
  there is no way to obtain the `factId` that SIT-008 requires, so the candidate
  review screen cannot exist) and **UNE-SIT-015** (provider job status, the
  polling substitute for the SSE endpoint, following the CC-170 precedent).
  SSE itself stays in the contract for the asynchronous move. `SituationSnapshot`
  stays a placeholder **on purpose** — guessing its shape would pre-empt CC-210,
  which owns confirmation — and a test pins that it was left deliberately.
  New OPEN binding **OB-16**: `provider_result` and `provider_job.request_json`
  have no retention/TTL policy and both may contain personal data.
  The parallel dual review (architecture + QA, opus) opened 1 BLOCKER / 6 MAJOR /
  8 MINOR and PASS WITH CONDITIONS, and **both reviews independently named the
  same two things**: response schemas had no `additionalProperties` at all, so
  the contract test's `.not.toBe(true)` blocked nothing; and error codes carried
  meanings the design had assigned elsewhere. All applied the same day.
  The substantive ones were each reproducible. The controller held a **second
  copy** of the timestamp rule and that copy had no calendar check, so
  `occurredAt: 2026-02-30` was stored as March 2 — `observedAt` survived only
  because the domain filtered it later; the copy is gone and one domain function
  remains. `Promise.all` called adapters unguarded: a single throwing adapter
  would discard the raw payloads and candidates already collected from every
  other provider and leave **no `provider_job` row at all**, breaking both "always
  leave a row" and "total failure is still 200". `query.mockScenario` was read
  unconditionally on the production request path and the contract documented it;
  it now lives behind an injected `SITUATION_PROVIDERS` factory with
  `scenariosEnabled` defaulting off. Unit-less numeric values were **guessed**
  into the canonical unit and reported as `NORMALIZED`, which showed a user who
  typed Fahrenheit 77 "normalized, 77 degC" with no review signal — the exact
  inverse of the timestamp rule, and it rated *less* information higher than
  more. `findFactKeySpec` ignored `factType`, so `FIELD_REPORT.text` inherited
  `DISASTER_MESSAGE.text`'s string constraint. And there was **no timeout of any
  kind**: on a synchronous path one slow provider holds the HTTP request forever.
  The renaming of `PROV-503-001` to `PROV-400-001` passed with **zero test
  failures**, because nothing asserted the SIT-family 400 codes — so a gate now
  extracts codes from `situation-errors.ts` and compares them against
  `x-error-codes`, requiring `COM-0400` on every implemented path-parameter API
  and `COM-0409` on every idempotent one. Response schemas are closed, three
  response examples now run through the example gate, and six empty testing-rule
  axes were filled — including proof that the idempotency key the acceptance
  limits lean on actually prevents a second batch of candidates.

- CC-170 (2026-08-05): Plan vertical slice E2E — **SSO mock to HWPX download**
  (ADR-32). The item turned out to be an implementation item, not an integration
  one: the path the acceptance criteria describe **could not be walked over
  HTTP**. `UNE-DOC-001~004` sat in the contract as `GenericRequest/
  GenericResponse` placeholders with no controllers (ADR-31 D1 pushed them out of
  CC-160 and no item picked them up), `DocumentImportService` was only reachable
  from tests, and `apps/web` was a four-file shell — and with no screen there is
  no "screen capture" evidence either.
  Uploads are now the designed three steps (pre-register → direct transfer →
  complete) with **exactly one verification point**: UNE-DOC-002 reads the stored
  bytes, recomputes size and SHA-256, and decides "is this HWPX?" from the ZIP
  structure and the `mimetype` entry — never from the extension or Content-Type.
  A mismatch ends the row at `ABORTED`, permanently. The presigned PUT carries the
  declared hash **inside the signature** (`x-amz-checksum-sha256`), so the store
  itself rejects different bytes and unverified content never reaches its place;
  verified against real MinIO. An adapter that cannot presign answers `null`
  rather than throwing, and the API substitutes its own signed single-use ticket
  route — no Bearer token, exactly like a presigned URL, with the tenant read
  from the signed claim so RLS still scopes the lookup.
  Migration 0022 separates **upload verification from malware scanning**:
  `upload_state`/`verified_at` are a new axis and `scan_status` stays PENDING,
  because there is no AV scanner (OB-15) and promoting it to CLEAN would record a
  check that never happened. `document.plan_id` was **not** created — `plan.
  document_id` has existed since 0003 with an FK since 0007 and the plan
  repository already reads it; only the writer was missing. Instead 0022 adds the
  guarantee that was absent: one document cannot be claimed by two plans.
  `malware_scan` was a contract pointing at a table that exists in no migration;
  the table was not created, the contract was corrected, and a gate now checks
  **every `x-db-tables` entry of every implemented API** against the data
  dictionary (implemented-ness is derived from controller annotations, because a
  hand-kept list goes stale).
  The slice UI is six steps with zero new runtime dependencies, types generated
  from the contract, and CORS as an explicit env allowlist (wildcards fail at
  startup). There is no editor screen — rhwp is still not imported (OB-12).
  A defect that had been dormant since CC-001 surfaced: `OBJECT_STORAGE_PUBLIC_
  ENDPOINT` was documented as "the endpoint embedded in presigned URLs" but
  nothing read it, so on any deployment where the API and the browser see the
  store at different addresses the signed URL would not even connect. SigV4 signs
  the Host, so presigning now uses a client bound to the browser-facing address.
  The new `@une/e2e` workspace runs API and worker in one process and walks the
  whole path; the edit step is **materialize**, since there is no editor. That
  walk exposed three rewrite defects, all fixed in the engine with corpus
  regressions: (1) when one ChangeSet inserts several paragraphs, the second
  onward anchor at the previously inserted AUTHORED paragraph, which has no raw
  XML anchor — so **a materialized document could never be exported at all**, and
  CC-160 had only ever tested inserting one; (2) the writer cloned the anchor's
  neighbour, discarding the prototype style the executor chose, which made Track
  A's RTA-STY-001 fail on re-analysis — position decides where, **the IR decides
  the style**; (3) the real OUTLINE_1 prototype has four runs and the last one is
  empty, which the single-run cloner refused.
  Performance baseline on a synthetic 50-page document (2,000 paragraphs, built
  deterministically at test time from a real document so its pathologies survive;
  40 paragraphs = 1 page is an assumption because we do not render): analysis p95
  256ms against the 5,000ms target, upload+import p95 613ms, ChangeSet apply p95
  162ms against the 300ms target, Export rewrite + Track A p95 352ms and download
  p95 8ms registered as baselines. Development-PC numbers, 3–5 samples, and the
  performance test is deliberately **not a gate** — making it one invites the next
  person to lower the target.
  Screen capture is a local script, not a CI gate (browser binary), and it earned
  its place immediately by catching two UI defects the API tests could not see:
  UNE-PLAN-007 takes the context at the body root (not wrapped), and UNE-PLAN-014
  requires the outline tree to be resent on confirm.
  Tests: hwpx-engine 426, api 283, provider-adapters 137, db-integration 127,
  contract 195, e2e 13 (new), web 24, worker 44, domain 62, baseline pytest 14.
  22 migrations, 61 tables unchanged, data dictionary 61/574.

- CC-160 (2026-08-03): HWPX preservation export, Track A validation, object
  storage port, Export API and worker (ADR-31). The engine now writes: rewriting
  is **byte-range splicing over the original XML**, never re-serialization of a
  parsed tree, so untouched characters are preserved by definition (§1.10-3);
  and ZIP entries that were not replaced are copied as their **stored bytes**,
  never recompressed, so "what we did not touch equals the original" does not
  become a zlib-version question. With no edits the output is byte-identical to
  the input — proven on all six real corpus documents and again end-to-end
  through the worker. Where a rewrite target is not unique the engine refuses
  (HWPX-1103) instead of guessing: a real document turned out to carry
  `[hp:t, hp:ctrl, hp:ctrl, hp:t]` runs where a form field splits the text in
  two, and a wrong HWPX simply opens, so the user would learn about the damage
  much later. Track A defines 16 `RTA-*` checks across four layers (design had
  an intake code table but none for saving) and reports the three layers it does
  NOT run with reasons — silence would read as "checked and passed". A FAIL
  discards the bytes rather than shipping them with a flag. Migration 0020 gives
  `export_job` the `tenant_id` that `generation_job` always had (without it the
  tenant-less dispatch transaction can neither see the row nor know which tenant
  to settle in), closes the export/validation vocabularies, makes
  `validation_report` append-only, and settles the two constraints ADR-30
  deferred. A new object-storage port with S3/MinIO and in-memory adapters keeps
  the SDK behind the adapter boundary. Three defects surfaced by first real use:
  the MinIO service account had **never** had its policy attached (the CC-002
  init guard matched `une-app` against the access key name, which is literally
  `une-app-<random>`, so every request was 403); `DocumentImportService` never
  registered the source bytes, leaving `source_file_id` NULL and preservation
  export structurally impossible; and existing fixtures were writing values the
  real write paths never produce. Tests: hwpx-engine 410, api 257, db-integration
  120, provider-adapters 128, worker 38, contract 188, domain 62 — all gates
  green, real MinIO exercised in CI db-verify.

- CC-150 (2026-08-02): document Revision/ChangeSet/Selection/Autosave server core
  (ADR-30). **Server side only** — the editing UI needs rhwp, which is still not
  imported (OB-12), and HWPX save/export is CC-160. Design 07 §1.8-4 ("visual
  coordinates never enter the contract") is what made that split safe.
  Migrations: 0018 puts FORCE RLS on the eight document child tables (closing the
  blocking prerequisite ADR-29 D9 registered) and 0019 adds `document_autosave`
  as the 61st table — the same class of baseline defect as `generated_block`
  (ADR-27 D2): design 10 §3.4, the §7 trace table and the OpenAPI `x-db-tables`
  all name it, but the physical DDL table never defined it. Domain gets the
  selection three-layer split, the 8-op ChangeSet vocabulary, and Document IR v2
  whose `NodeProvenance` discriminated union makes "a node with neither anchor
  nor hint" fail to compile. The engine gets SelectionResolver, ChangeSetExecutor,
  inverse-op derivation and prototype resolve; atomicity is a property of the data
  structure rather than of rollback, because the failure result type has no `ir`
  field for a caller to persist. The API gets UNE-DOC-005~009 with the ETag +
  baseRevisionId double guard (self-contradicting requests are 422, a moved head
  is 409 with the authoritative ETag header and `meta.conflict`), idempotency on
  `clientMutationId`, and materialize carrying ADR-27 D4's triple defence.
  Measurement caught three defects during implementation: CC-140's stable ids were
  derived from raw XML anchors and therefore collapse the moment a paragraph is
  inserted (ids are now frozen and authored ids derived separately); the §1.9
  inverse table is simply wrong for character deletion and SPLIT — all six corpus
  documents mismatched by hash until the inverse became a run-level restore; and
  RLS turned an unindexed child scan 30x slower (173ms -> 1.2ms once 0019 pinned
  the uniqueness key). The parallel dual review then opened arch 2 BLOCKER/6
  MAJOR/7 MINOR and a QA FAIL, with both reviewers independently finding the same
  three: the request surface accepted `{restore: ...}` IR fragments (letting a
  DOC_EDIT holder plant SOURCE-origin nodes with forged anchors, permanently
  locked blocks, or trigger a 500); Undo could not actually execute because the
  returned inverse operations carry a sentinel `baseRevisionId` that the validator
  and the contract both reject — the 200 response violated its own schema; and
  materialize validated only the first GENERATED_BLOCKS source. All applied the
  same day (ADR-30 D16): Undo now names the ChangeSet to reverse and carries no
  operations at all, UNDO_CONFLICT is implemented from `touchedNodeIds` lineage,
  aliases are no longer followed for nodes that still exist (which is what made
  post-restore edits land on the wrong paragraph), `checkEditInvariants` runs
  before commit, autosave dedupes on `ir_hash`, REJECTED replays answer 422 again
  instead of a silent 200, and `document.status` is enforced. Verified by a single
  `pnpm test` (exit 0, DATABASE_URL set so nothing skips): domain 62,
  hwpx-engine 353, contract-tests 188, api 242, db-integration 107,
  provider-adapters 108, worker 33, baseline 10; contracts/intake/handoff PASS;
  build/typecheck/lint/format PASS; contract-type regeneration diff 0.
  Evidence: docs/evidence/CC-150-document-edit-verification.md.

- CC-140 (2026-08-02): HWPX intake gate, package analysis, Document IR, and
  compatibility classification (ADR-29). **rhwp is still not imported** — this
  item builds the gate that makes intake enforceable (OB-12):
  `scripts/validate-source-intake.mjs` R1..R11 in CI verify — provenance schema
  (20 fields + G15 poc_gate), floating-ref ban (main/master/HEAD/latest),
  tree_digest that blocks in-place upstream edits (patches must go through
  PATCHES.yaml), submodule-bypass detection, THIRD_PARTY_NOTICES drift, SBOM
  presence, and a ban on importing source that has not been intaken. The gate is
  green in the pre-intake state (R11) and 40 negative fixtures prove each rule
  actually fails. Engine in TypeScript (ADR-29 D3) with **zero new runtime
  dependencies** — own central-directory ZIP reader (local headers distrusted;
  zip-slip, bomb, duplicate paths, CRC32) and own pull XML parser (DOCTYPE
  refused by a leading byte scan, so XXE is unrepresentable rather than
  switched off). Package analysis cross-checks mimetype/version.xml/
  container.xml/content.hpf and records a SourcePreservationMap plus
  `unmanifestedParts`; the real corpus showed content.hpf's manifest omits
  BinData/Scripts/Preview/META-INF, so non-manifested parts carry the
  losslessness burden. Document IR keeps canonical nodes beside
  `partPath#el[n]` anchors (ADR-29 D6; deterministic hash ids, not ULIDs, so
  I1/I7 can hold). Type ownership is split (D4): IR, the two compatibility
  vocabularies, the roll-up and the §1.5 confidence weights live in
  @une/domain; the engine consumes them; JSON Schemas in contracts/schemas
  carry a schema↔union drift guard. Losslessness is proven three ways (D7):
  coverage (known ∪ unknown == every ZIP entry), byte preservation, and
  in-memory no-edit reconstruction equivalence — RT-A data sufficiency
  established before the Package Writer exists. Corpus = 6 REAL forms in
  templete/ resolved by sha256 + 9 synthetic negatives. Two defects were found
  and fixed by measurement rather than review: the AUTO verdict was
  structurally unreachable (package parts that every HWPX carries were capping
  the verdict, and hp:colPr/hp:fwSpace/hp:lineBreak were being treated as
  unsupported objects) — roll-up rule 3 now applies to ELEMENT scope only,
  benign layout/whitespace constructs became explicit rules, catch-all hits are
  pinned at 0, cap CAUSES rather than labels are frozen in the golden table,
  and AUTO reachability is proven by a synthetic A/B pair at identical
  confidence; and outline-level inference was inverted because hc:intent is a
  negative hanging indent, so leading whitespace is the real level signal
  (§1.6-3). Migrations: 0 — D9 also registers the document child-table RLS gap
  (document_revision/document_block/change_set/template_profile… have never had
  RLS while une_app holds ALL TABLES DML) as a blocking prerequisite for
  CC-150. Dual review found and fixed a BLOCKER of exactly the kind this item
  is meant to prevent: filling measured values into CORPUS.yaml added keys the
  loader deliberately rejects, which killed the 94-case corpus regression at
  collection time — the earlier "196 passed" had therefore never run. Fixed by
  teaching the loader the keys AND cross-pinning the manifest against the golden
  table, so fixing only one side can no longer make it pass. Other review fixes:
  the grade axis was separated from the cap axis (capsVerdict) because promoting
  layout/whitespace to NATIVE_EDIT would have handed un-parsed XML to CC-160's
  "minimal re-save"; unmatched elements are carried out as data instead of
  dropped (the old "catch-all is zero" guard could not tell a hole from a
  complete table); §1.6-3 whitespace (fwSpace/tab/nbSpace) now reaches the text
  stream that feeds outline-level ordering; the intake gate became symmetric
  (source in the tree with status NOT_IMPORTED used to ship with a "not
  imported" notice) and R12 now enforces §8.3's POC-Gate wording, retracting an
  ADR reinterpretation that had leaned on a lower-priority document; and
  template-profile.schema.json was rewritten against the real analyzer output
  with a contract test that validates all six corpus documents — that test
  immediately caught the new schema repeating the allOf +
  additionalProperties:false trap ADR-24 D4 had already documented. Gates
  (single `pnpm test`): domain 62, hwpx-engine 238, contract-tests 152,
  db-integration 68, provider-adapters 108, api 193, worker 33,
  validate:intake(R1~R12)/validate:contracts/validate:handoff PASS, baseline 10.
  Evidence: docs/evidence/CC-140-hwpx-ir-verification.md.

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
