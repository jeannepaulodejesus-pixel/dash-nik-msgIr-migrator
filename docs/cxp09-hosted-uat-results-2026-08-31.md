# CXP-09 Hosted DEV UAT Results — 2026-08-31

## Outcome

**Pass.** The aggregation topology and parity passed, the authoritative CXP-09 installer state reached `COMPLETE` at 23/23, and `CXP09UatStep08` returned `pass: true` with `installComplete: true`.

- **Target:** `DEV_TARGET_WORKBOOK` (`1loVw2V1H_WDhPa9dhgIsTKDFGkch9xLrR3XMvoc6mMg`)
- **Environment:** `DEV`
- **Installer state:** `COMPLETE`, `nextStep: 23`, `stepCount: 23`
- **Completed UTC:** `2026-08-30T20:04:54.953Z`
- **Last completed step:** `Allocation:FORMULA:2`
- **Promotion result:** `pass: true`, `installComplete: true`
- **Parity:** Operator-reported `true`; the attached 03:52 promotion log does not serialize the Step 04 parity object

## Verified topology evidence

- `_AGG_INTERVAL`: present, 18/18 headers, all 11 required formula anchors present, row capacity through 51.
- `_AGG_FORECAST`: present, 5/5 headers, no CXP-09-owned formula anchor required, three populated rows. CXP-10 remains the sole owner of its bridge formula under DEC-050.
- `_AGG_ALLOCATION`: present, 6/6 headers, both required formula anchors present, row capacity through 51.
- No missing aggregation formula anchors or header differences were reported.
- Downstream CXP-10 hosted parity previously consumed these tables with zero differences, providing additional integration evidence but not replacing the CXP-09 state gate.

## Acceptance

CXP-09 DEV promotion acceptance is complete. The earlier `IDLE` result remains useful negative evidence that healthy sheet topology cannot substitute for the persisted install-complete gate. The final rerun proves the state-backed 23-step installation and promotion path. UAT/PROD environment promotion remains separate.
