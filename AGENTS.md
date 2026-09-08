# Repository Agent Contract

This repository uses bounded startup context and a durable checkpoint so work can resume safely after compaction or handoff.

## Required startup sequence

Read, in order:

1. `AGENTS.md`
2. `docs/ai/bootstrap.md`
3. `docs/ai/context-index.md`
4. `docs/ai/checkpoints/current.md`
5. `git status --short`

Do not preload other project records. Files larger than 32 KiB are archives: retrieve only the heading or phrase needed with `rg` and read the smallest matching section. Read an archive completely only when the task explicitly requires a full review.

## Retrieval and continuity

- Use `docs/ai/context-index.md` to locate authoritative details; do not rely on memory when a source is named.
- Treat `docs/ai/checkpoints/current.md` as a recovery aid, not a replacement for source documents.
- At a durable milestone or before a voluntary rollover, update the checkpoint with the active goal, scope and non-goals, authorization, plan state, source-anchored decisions, evidence, HEAD, dirty inventory/fingerprint, user-owned paths, blockers/risks, next safe action, and UTC timestamp.
- Keep checkpoint claims factual and concise. Never copy large logs or entire source sections into it.

## Safety boundaries

- Preserve existing dirty and untracked work. It is user-owned unless the active task proves otherwise. Never reset, revert, reformat, or overwrite unrelated changes.
- Inspect a target before editing it and keep diffs limited to the authorized scope. Stop and report an overlap that cannot be resolved safely.
- Never commit secrets, identifiers, tokens, or production configuration. Production deployment and Script Property changes require explicit authorization.
- Do not invent metric formulas or alter accepted business semantics. The source-grounded migration contracts and decision log remain authoritative.
- Prefer bounded reads, focused tests, `git diff --check`, and an owned-file diff review before handoff.

## Context configuration

This host currently rejects the documented project compaction-scope key during sandbox setup, so no active `.codex/config.toml` is committed. Keep continuity through this contract and the checkpoint. Re-test project-scoped compaction settings only through `docs/ai/context-canary-runbook.md`; never enable numeric overrides or an experimental prompt file without passing that canary.
