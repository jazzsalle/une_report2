# Claude Code Session Protocol

## Start

1. Confirm repository root and branch.
2. Read `CLAUDE.md`, implementation baseline, current Work Item, and previous session handoff.
3. Run `git status` and the lightweight validation command.
4. State the task, affected components, contracts, migration impact, tests, and risks.
5. Use plan mode for multi-file or architectural changes.

## During work

- Keep changes within one Work Item.
- Update contracts with implementation.
- Preserve unrelated user changes.
- Record external unknowns instead of guessing.
- Run focused tests continuously.

## Completion

1. Run the full Work Item gate.
2. Review with architecture and QA agents.
3. Update implementation status and change log.
4. Write session handoff with exact next action.
5. Do not claim completion if any mandatory test or external evidence is missing.
