# rhwp Source Intake

Upstream: https://github.com/edwardkim/rhwp

## Intake gate
1. Select a tag or immutable commit after POC review.
2. Download a source archive; do not track floating `main`.
3. Record URL, tag, commit, archive SHA-256, license, build toolchain, and SBOM.
4. Store pristine upstream under `third_party/rhwp/upstream/`.
5. Implement UNE logic under `services/hwpx-engine/` and `packages/hwpx-adapter/`.
6. Put unavoidable patches under `third_party/rhwp/patches/` with a Patch ID, rationale, changed files, upstream issue, and regression tests.

## Required POC corpus
- no-op open/save/reopen of the supplied COVID plan
- paragraph insertion and replacement
- outline Enter, Tab, Shift+Tab behavior
- prototype paragraph/style clone
- table edit and preservation
- image, header, footer, footnote/reference preservation
- unsupported-object grading
- package/XML/reference validation
- Hancom open-save-reopen and rhwp reopen

## Result classes
NATIVE_EDIT, PRESERVE_ONLY, FLATTEN_EXPORT_ONLY, REJECT.
