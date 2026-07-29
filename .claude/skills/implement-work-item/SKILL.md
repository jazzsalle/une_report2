---
description: Implements one approved Work Item from MASTER_WORK_ITEMS.yaml with design traceability, tests, and evidence. Use whenever the user asks to proceed with a specific CC task.
---

1. Read the Work Item, dependencies, acceptance criteria, and referenced design files.
2. Inspect git status and current implementation; do not overwrite unrelated work.
3. Produce a plan listing files, APIs, migrations, tests, risks, and OPEN bindings.
4. Implement only that Work Item.
5. Run relevant tests, then its full completion gate.
6. Launch `architecture-guardian` and `qa-gate-reviewer` as subagents **in parallel — both Task calls in a single message** (this review is mandatory, not optional). Give each the Work Item ID, the list of changed files, and the acceptance criteria. Address every violation they report before proceeding.
7. Update `IMPLEMENTATION_STATUS.md`, `CHANGELOG.md`, and contract/design files changed.
8. Report what is complete, evidence, and remaining conditions.
