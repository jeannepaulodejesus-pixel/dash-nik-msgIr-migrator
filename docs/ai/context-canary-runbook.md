# Guarded Context Canary Runbook

This runbook validates optional project-scoped context settings. It is not startup context. No `.codex/config.toml` should be present until every compatibility and performance gate below passes.

## Current host result

On 2026-09-08, a scope-only canary containing `model_auto_compact_token_limit_scope = "body_after_prefix"` caused every sandbox command to fail with `windows sandbox failed: helper_unknown_error: setup refresh had errors`. Removing the file and empty `.codex` directory restored execution. The compact prompt and numeric settings were not attempted. Treat this host/version as rejected and retain the bounded `AGENTS.md` workflow until a later host version passes a fresh canary.

## Candidate values

- Context window: `544000` tokens (`model_context_window`).
- Automatic compaction threshold: `408000` tokens (`model_auto_compact_token_limit`).
- Durable checkpoint target: `326400` tokens (60% of the candidate window).
- Voluntary rollover target: `380800` tokens (70% of the candidate window).
- Candidate scope: `model_auto_compact_token_limit_scope = "body_after_prefix"`.
- Candidate compact prompt: preserve goal, scope/non-goals, authorization, plan state, source-anchored decisions, evidence/tests, HEAD, dirty fingerprint and user-owned paths, blockers/risks, and next action; resume through `AGENTS.md` and indexed retrieval.

## Preconditions

1. Use a Codex host version newer than the rejected 2026-09-08 Windows host, start a fresh task in this repository, and confirm it is trusted so project-scoped `.codex/config.toml` is actually loaded.
2. Inspect fresh-task runtime status and record the selected model, reported context capacity, active project config, timestamp, host/app version, and baseline latency. Do not infer acceptance from the file alone.
3. Freeze three representative fixtures: a bounded implementation task, a test/diagnostic task, and a compaction-recovery task with user-owned dirty work. Use the same prompts, inputs, model, reasoning effort, and tool permissions for baseline and candidate.

## Measurement

Run the baseline with no project config. Test the scope key by itself first; stop and roll back on any setup failure. Only after that passes, add the preservation prompt and then the numeric keys:

```toml
model_context_window = 544000
model_auto_compact_token_limit = 408000
```

Run all three fixtures and collect at least 10 measured turns total for each condition. Record per-turn latency, median, p95, failures, checkpoint creation, compaction/rollover point, recovery accuracy, diff scope, and test outcome. Exclude warm-up only by a rule declared before measurement.

## Acceptance gates

- Runtime: the fresh trusted task reports/behaves consistently with both candidate numeric settings; no unknown-key, fallback, or silent-ignore signal.
- Latency: candidate median and p95 are each no more than 20% slower than baseline.
- Quality: all fixture acceptance criteria and focused tests pass with no material regression or invented evidence.
- Recovery: after compaction or voluntary rollover, goal, scope/non-goals, authorization, plan, source decisions, evidence, HEAD, dirty fingerprint, user-owned paths, blockers/risks, and next action are preserved and source-verified.
- Safety: no lost/overwritten dirty work, out-of-scope diff, context-limit failure, tool failure attributable to the settings, or unrecoverable task state.

Any failed or ambiguous gate rejects the numeric candidate.

## Rollback

On a numeric-only performance regression, remove `model_context_window` and `model_auto_compact_token_limit`, then start a fresh trusted task and confirm runtime status has returned to defaults. On any setup or tool failure, remove the entire project config and empty `.codex` directory, then confirm a normal command starts successfully. Do not create an experimental prompt file. Preserve the canary measurements as evidence and record the rejection reason in the checkpoint or relevant decision record.
