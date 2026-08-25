# CXP-07 Google Sheets formula contract research

## Frozen plan

- **Question:** Does current official Google Sheets documentation support the XLOOKUP match/search modes and the bounded LET/ARRAYFORMULA/QUERY constructs used by the CXP-07 native model?
- **H1:** XLOOKUP supports `match_mode = 1` (exact or next greater) and `search_mode = 1` / `-1` (first-to-last / last-to-first). **Prediction:** official syntax and parameter definitions list these values. **Falsifier:** the current official page omits or assigns different meanings to any value.
- **H2:** Google Sheets documents LET, ARRAYFORMULA, and QUERY as available spreadsheet functions with the argument shapes used by CXP-07. **Prediction:** current official pages define each function and its core syntax. **Falsifier:** an official page marks a function unavailable or defines an incompatible core syntax.
- **Local version boundary:** This repository has no version-pinned Google Sheets formula engine. `package.json` pins only local Node/clasp tooling; therefore the matching authority is the current Google Docs Editors web documentation retrieved on 2026-08-25.
- **Methods:** R1 (confirmatory): retrieve official XLOOKUP documentation. R2 (confirmatory): retrieve official LET, ARRAYFORMULA, and QUERY documentation. R3 (confirmatory): compare documented syntax to the generated catalog formulas and the WB0817 formula family.
- **Stopping rule:** Stop after the official pages answer both hypotheses and an independent reviewer returns confirmed, partially-confirmed, or rejected. Hosted execution remains a separate UAT gate and is not part of this research claim.

## Evidence log

- **E1 / R1 / confirmatory / official XLOOKUP documentation:** https://support.google.com/docs/answer/12405947?hl=en, retrieved 2026-08-25. Decisive text: `match_mode` value `1` means exact match or next greater; `search_mode` value `1` searches first-to-last and `-1` searches last-to-first. Supports H1. The page distinguishes BigQuery, where search mode is unavailable, from the Google Sheets syntax with all six arguments; CXP-07 targets Sheets, not BigQuery.
- **E2 / R2 / confirmatory / official ARRAYFORMULA documentation:** https://support.google.com/docs/answer/3093275?hl=en, retrieved 2026-08-25. Decisive text: `ARRAYFORMULA(array_formula)` displays array results across multiple rows/columns. Supports the spill architecture portion of H2.
- **E3 / R2 / confirmatory / official LET documentation:** https://support.google.com/docs/answer/13190535?hl=en, retrieved 2026-08-25. Decisive text: `LET(name1, value_expression1, ..., formula_expression)` assigns named expressions evaluated once and usable by later expressions. Supports the CXP-07 LET binding shape in H2.
- **E4 / R2 / confirmatory / official QUERY documentation:** https://support.google.com/docs/answer/3093343?hl=en, retrieved 2026-08-25. Decisive text: `QUERY(data, query, [headers])` runs Google Visualization API Query Language and documents `group by` aggregation. Supports the aggregation portion of H2.

- **E5 / R3 / confirmatory / local comparison:** Command compared the WB0817 Handled column-B family with the generated Handled interval formula; exit code `1`. Decisive lines: `legacyModes true true` and `cxp07Modes false false`. The current implementation flattened the legacy approximate forward/reverse lookup to an exact lookup. This rejects current formula parity for that rule while leaving H1/H2 confirmed.
- **Pivot P1:** Add a focused regression for both documented match/search mode combinations, update only the Handled interval formula, then rerun R3. Reason: E5 identifies a specific locally observable contract mismatch; no new business rule is introduced.

- **E6 / R3 rerun / confirmatory / local comparison:** After P1, the same comparison command exited `0`. Decisive lines: `legacyModes true true` and `cxp07Modes true true`. The focused CXP-07 suite separately exited `0` with 7/7, including the new Handled-vs-Offered lookup-mode regression.
- **Experiment status:** R1 complete; R2 complete; R3 complete. No planned experiment remains open. Hosted formula execution is deliberately outside this research question and remains in the UAT runbook.

## Preliminary claims for independent review

- **C1:** Current official Google Sheets documentation supports XLOOKUP match mode `1` and search modes `1`/`-1` with the meanings required by WB0817 (E1).
- **C2:** Current official documentation supports the LET/ARRAYFORMULA/QUERY core syntax used by the bounded formula architecture (E2–E4).
- **C3:** The corrected generated Handled interval formula retains both WB0817 mode combinations while the focused regression keeps Offered exact-match (E5–E6).

## Independent verdict

- **Verdict:** `confirmed`.
- **Reviewer rationale:** Official XLOOKUP, LET, ARRAYFORMULA, and QUERY documentation supports C1–C2. Independent local comparison confirms WB0817 and the generated Handled interval formula contain `,,1,1)` and `,,1,-1)`, while Offered contains neither; `npm run test:cxp07` passed 7/7.
- **Caveat:** The evidence verifies documented syntax, generated formula structure, and local harness behavior—not execution in hosted Google Sheets. Hosted parsing and recalculation remain the UAT gate.
