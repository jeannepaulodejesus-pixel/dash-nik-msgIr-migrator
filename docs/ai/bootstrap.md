# AI Bootstrap

This repository migrates Nike Messaging operational reporting from an Excel-dependent workflow to a standalone Apps Script control plane with Google Sheets-native calculation and reporting. Work is organized into CXP packets; CXP-14 is the active release-hardening packet.

## Start safely

Follow the exact startup order in [`AGENTS.md`](../../AGENTS.md). The startup set is deliberately small. After reading it, inspect `git status --short` before opening implementation files or archives.

The working tree currently contains user-owned CXP-14 changes. Preserve them. Do not reset, revert, reformat, or overwrite unrelated paths. Production deployment, production Script Property changes, and cutover remain outside standing authorization.

## Retrieve, do not preload

Use [`context-index.md`](context-index.md) to select the smallest authoritative source section for the task. `CODEX_HANDOFF.md`, `docs/packet-status.md`, and `docs/decision-log.md` are archives larger than 32 KiB: search headings or phrases with `rg`, then read only the matching section. A full archive read requires an explicit task need.

When recovering after compaction, treat [`checkpoints/current.md`](checkpoints/current.md) as a pointer to state and evidence. Confirm volatile facts against Git and the linked source before acting.

## Stable project boundaries

- Preserve the reporting-system migration architecture, staging/validation/commit/rollback behavior, duplicate blocking, hourly replacement, weekly active workbook, and parity validation.
- Keep secrets and environment-specific IDs out of source control.
- Do not invent formulas, metric meanings, or production evidence.
- Use focused verification proportional to the change; record observed results separately from pending hosted evidence.

## Keeping continuity current

At a durable milestone or before voluntary context rollover, refresh the current checkpoint rather than expanding the startup set. Record only decision-grade facts, links, the dirty-work fingerprint, and the next safe action. Move long-lived detail to an indexed source document, not the checkpoint. The current Windows host rejected the project compaction-scope setting, so recovery presently relies on this bounded workflow rather than active `.codex` overrides.
