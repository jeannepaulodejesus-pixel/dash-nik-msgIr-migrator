# Contributing

## Packet workflow

1. Read `CODEX_HANDOFF.md`, `docs/packet-status.md`, `docs/decision-log.md`, and all dependency-packet completion notes.
2. Implement one CXP packet per branch or pull request. Do not begin a packet whose dependencies are incomplete.
3. Record architecture ambiguity in `docs/decision-needed.md` instead of inventing a business rule.
4. Add deterministic tests or verification evidence for every packet-owned behavior.
5. Run `npm run verify` and `git diff --check` before committing.
6. Update `docs/packet-status.md` and `docs/decision-log.md` with the packet handoff.

## JavaScript conventions

- Keep Google API calls behind explicit adapters; keep transformations pure where practical.
- Prefer bulk array reads/writes. Do not introduce row-by-row `getValue()` or `setValue()` loops in critical data paths.
- Do not reproduce Excel formulas or pivot-cell coordinates. CXP-01 is the sole authority for later business logic.
- Apps Script runtime files must stay compatible with V8. Local-only Node tools belong under `scripts/`, not `src/`.
- Public interfaces must validate their own environment or configuration boundary and fail with actionable errors.

## Test convention

For behavior changes, add the smallest focused test first and observe it fail for the intended reason. Implement the minimum behavior, rerun the focused test, then run `npm run verify`. Test names describe the production defect or contract they protect; tests should exercise real code and mock only Google-hosted boundaries.

## Configuration and secrets

- Never commit `.clasp.json`, `.clasprc.json`, `.env*`, service-account files, script IDs, spreadsheet IDs, Drive folder IDs, OAuth tokens, or API keys.
- Use the Script Properties keys in `docs/configuration.md`.
- Do not put production values in tests, examples, fixtures, CI variables, screenshots, or logs.
- If a secret is committed, stop, revoke/rotate it, and remove it from history through the repository owner's incident process.

## Packet completion record

Each completed packet entry must include status, delivery version or commit, files changed, commands and results, acceptance-criteria evidence, assumptions, limitations, blockers, and next-packet inputs. Decision-log entries include an ID, date, packet, status, decision, rationale, and consequences.
