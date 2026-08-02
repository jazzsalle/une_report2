# Third-party source intake

Do not place floating clones here. Every source intake requires immutable provenance, license, hash, SBOM, patch manifest, and acceptance tests. ProcessGPT remains evaluation-only until ADR approval. rhwp is the first planned source intake candidate.

## Enforcement

`pnpm validate:intake` (`scripts/validate-source-intake.mjs`, CI verify job) enforces
rules R1~R12 on `third_party/rhwp/`: source may not exist without a schema-valid
`PROVENANCE.yaml`, status and source must agree in both directions (`IMPORTED`
without source is rejected, and source present while the record says
`NOT_IMPORTED`/`PROVENANCE_RECORDED` is rejected too — source in the tree ships in
the distribution and must be declared), floating refs
(`main`/`master`/`HEAD`/`latest`) are rejected, `upstream/` may not be edited in
place (tree digest) and may not contain symlinks, git submodules are blocked,
every patch must be grounded, `THIRD_PARTY_NOTICES.md` may not drift from the
record, the SBOM must parse and name the component, no `services|packages|apps`
code may import an unimported tree, and `status: IMPORTED` requires the POC Gate
minimum set G15-1 (analysis) + G15-6 (license) to be `PASS` with no other gate in
`FAIL` (ADR v1.1 §8.3).

Nothing is imported yet — `NOT_IMPORTED` with an empty `upstream/` is the current
green state (ADR-29 D1, OB-12). See `rhwp/INTAKE_PROCEDURE.md` for the approved
execution and rollback procedure, and `rhwp/UPSTREAM.md` for the file map.
