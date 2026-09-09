# Context Index

Use this map after the required startup sequence. Open only sources relevant to the active task. For any file over 32 KiB, use `rg -n` for the named heading or phrase and read the smallest matching section; do not load the whole file unless explicitly required.

## Active state and recovery

| Need | Source | Retrieve |
|---|---|---|
| Current resumable state | [`checkpoints/current.md`](checkpoints/current.md) | Whole file; bounded checkpoint |
| CXP-14 execution plan | [`../plans/2026-09-07-cxp14-performance-hardening-uat-cutover.md`](../plans/2026-09-07-cxp14-performance-hardening-uat-cutover.md) | `Goal`, `Non-negotiable execution boundary`, `Verification sequence`, `Packet acceptance`, `Rollback point and stop condition` |
| Hosted UAT sequence | [`../cxp14-uat-runbook.md`](../cxp14-uat-runbook.md) | Relevant numbered step only |
| Release gates | [`../cxp14-release-contract.md`](../cxp14-release-contract.md) | `Timing and boundary rules`, `Required UAT predicates`, `Performance gates`, `Cutover and rollback` |
| Production procedure | [`../cxp14-production-runbook.md`](../cxp14-production-runbook.md) | Relevant operation only; PROD actions require explicit authorization |

## Architecture and decisions

| Need | Source | Retrieve |
|---|---|---|
| Approved architecture or packet contract | [`../../CODEX_HANDOFF.md`](../../CODEX_HANDOFF.md) | Search `Approved Architecture Decisions`, the active `CXP-*` heading, or `Cross-Cutting Technical Requirements` |
| Architecture decision index | [`../architecture-decisions.md`](../architecture-decisions.md) | Relevant ADR entry |
| Accepted implementation decision | [`../decision-log.md`](../decision-log.md) | Search exact `DEC-*` or packet heading; archive, no startup full read |
| Packet completion/evidence | [`../packet-status.md`](../packet-status.md) | Search exact `CXP-*` handoff/status heading; archive, no startup full read |
| Configuration contract | [`../configuration.md`](../configuration.md) | Relevant key group and `Promotion boundary` |

## Development and verification

| Need | Source | Retrieve |
|---|---|---|
| Contribution workflow | [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) | Relevant convention |
| Test commands and hosted boundaries | [`../testing.md`](../testing.md) | Relevant command/packet section |
| Context canary (not startup context) | [`context-canary-runbook.md`](context-canary-runbook.md) | Only when running or reviewing the guarded canary |

## Retrieval examples

```powershell
rg -n "^## CXP-14|^### DEC-06[5-9]|^### DEC-070" docs/packet-status.md docs/decision-log.md
rg -n "^## (Required UAT predicates|Performance gates|Cutover and rollback)" docs/cxp14-release-contract.md
```

If a source conflicts with a checkpoint summary, the source wins. Update the checkpoint once the conflict is resolved.
