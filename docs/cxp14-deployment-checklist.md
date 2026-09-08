# CXP-14 Production Deployment Checklist

Every item is required unless marked not applicable with owner approval. This checklist does not itself authorize production.

## Release candidate

- [ ] Immutable commit/version recorded; working tree and clasp source match it.
- [ ] `npm run test:cxp14`, affected predecessor suites, `npm run verify`, and `git diff --check` pass.
- [ ] Hosted UAT Step 08 returns `pass: true`, `missing: []`, `promotionReady: true`.
- [ ] Performance, UAT, final parity, delivery validation, and business validation reports are signed.
- [ ] No new feature or metric-definition change is included.

## Environment and access

- [ ] PROD target, control, Inbox, master template, parity folder, and domain keys are available through the approved operator boundary.
- [ ] Exactly one ACTIVE registry row matches the target property.
- [ ] Restricted sharing, protections, execution identity, and least-privilege matrix are verified.
- [ ] Trigger inventory contains maintenance kinds only before cutover; no stray CXP continuation remains.
- [ ] Support owner, rollback operator, stop authority, and escalation channel are active for the cutover window.

## Rollback readiness

- [ ] Previous immutable deployment version recorded.
- [ ] Exact prior PROD configuration values stored securely outside the repository.
- [ ] Rollback operator has read-tested the secure backup.
- [ ] Last-known-good ACTIVE workbook and restoration procedure identified.
- [ ] UAT rollback rehearsal restored version/configuration and passed health/parity smoke checks.

## Cutover

- [ ] New intake held; no active nonterminal run.
- [ ] Explicit production deployment authorization recorded.
- [ ] Exact release candidate pushed; no source edits during promotion.
- [ ] Read-only config/registry/health/protection/effective-identity checks pass.
- [ ] Next approved real production bundle selected as canary; no synthetic data targets the live ACTIVE workbook.
- [ ] Canary reaches SUCCESS with reconciled RUN_LOG/FILE_LEDGER/status/health evidence.
- [ ] Intake reopened; first two hourly cycles healthy.
- [ ] Heightened monitoring and rollback authority retained for 24 hours.

