# CXP-08 V2 Hosted DEV UAT Results — 2026-08-31

## Outcome

**Pass.** CXP-08 V2 completed its 74-step hosted reinstall, preserved the validated business context, and passed AHT, Auxes, Staff overlap, and Staff summary parity with zero differences.

- **Target:** `DEV_TARGET_WORKBOOK` (`1loVw2V1H_WDhPa9dhgIsTKDFGkch9xLrR3XMvoc6mMg`)
- **Environment:** `DEV`
- **Installer state:** `COMPLETE`, `nextStep: 74`, `stepCount: 74`
- **Completed UTC:** `2026-08-30T19:46:35.486Z`
- **Hosted promotion:** `pass: true`, `installComplete: true`
- **Repository verification:** `npm run verify` — 198 tests passed, 0 failed; syntax and repository guardrails passed

## Final hosted evidence

- All three raw schemas matched CXP-03 exactly.
- Fixture row counts were AHT 3, Auxes 2, and Staff 2.
- `_CALC_AHT` had 34 expected headers, eight spill anchors, no missing anchors, and no fill-down.
- `_CALC_AUXES` had 28 expected headers, five spill anchors, no missing anchors, and no fill-down.
- `_CALC_STAFF` had 53 expected table headers, all 48 overlap anchors, the summary formulas, no missing anchors, and no fill-down.
- Business context passed with `businessDay: 2026-08-18`, `weekStart: 2026-08-17`, and `staffDay: 2026-08-18`.
- `CXP08UatStep04` reported `pass: true` with AHT, Auxes, Staff, and Staff-summary difference counts all zero.
- `CXP08UatStep08` reported `pass: true`, `installComplete: true`, and no parity failure reason.

## Corrective findings closed

1. The Staff anchor at `_CALC_STAFF!BE1` is owned by the validated business-context boundary and survives reinstall.
2. Staff routing is generated from the versioned CNX/INT contract and the fixture covers early `CNX-CR1` plus late `INT-LAS` intervals.
3. Promotion detects a Step 06 refresh bundle through bounded row-count evidence and returns `FIXTURE_STATE_MISMATCH` instead of enumerating propagated differences.
4. Staff overlap formulas use element-wise interval clipping. The prior `MIN()`/`MAX()` expressions collapsed arrays to scalars in Google Sheets and produced zero overlap rows.

## Acceptance and limitations

CXP-08 V2 DEV promotion acceptance is complete. Step 05 peak timing remains optional follow-up evidence for production-volume performance claims; it does not block the verified functional packet contract. UAT/PROD environment promotion remains separate.
