# Source of Truth and Conflict Resolution

| Priority | Source | Use |
|---|---|---|
| 1 | ADR v1.1 | binding architectural decisions and closed OPEN items |
| 2 | approved change/ADR records (`docs/adr/*`, e.g. ADR-19) | later amendments |
| 3 | API/DB/Sequence v1.0 | implementation-level behavior |
| 4 | OpenAPI, JSON Schema, migrations | machine-verifiable contracts |
| 5 | screen and user scenario designs | user flow, states, permissions, errors |
| 6 | HWPX and Situation/UNI specifications | domain-specific rules |
| 7 | master design v0.9 | overall architecture and context |
| 8 | original requirements/reference files | source intent and historical background |

## Conflict procedure

1. Quote both conflicting requirements.
2. Apply the priority order and specificity/version rules.
3. Check whether the higher-priority source explicitly supersedes the lower one.
4. If unresolved, do not code. Add a proposed ADR/change request and mark the Work Item BLOCKED.
5. After approval, update affected design, contract, migration, tests, and traceability.
