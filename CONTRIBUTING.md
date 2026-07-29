# Contributing

## Branches

Use `feature/<work-item-id>-<short-name>`, `fix/<work-item-id>-<short-name>`, or `chore/<short-name>`.

## Commits

Format: `<type>(<domain>): <work-item-id> <summary>`

Example: `feat(plan): CC-110 persist immutable plan context snapshot`

## Pull request evidence

Include:

- Work Item and related ADR/API/Screen/Sequence IDs
- changed contracts and migrations
- commands run and test results
- screenshots for UI changes
- HWPX validation report for document engine changes
- OPEN Binding or deviation records

## Prohibited

- mixed unrelated Work Items
- generated binaries and caches
- plaintext secrets
- schema changes without migration
- API changes without OpenAPI update
- completion claims without evidence
