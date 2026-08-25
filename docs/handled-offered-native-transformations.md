# CXP-07 Handled and Offered Native Transformations

## Runtime contract

`initializeCxp07HandledOfferedTransformations()` opens only the configured target spreadsheet and starts or resumes a checkpointed installation. Run CXP-02 first so `_RAW_HANDLED`, `_RAW_OFFERED`, `_RAW_AHT`, `_CALC_HANDLED`, and `_CALC_OFFERED` exist. CXP-07 validates the exact active CXP-03 Handled, Offered, and AHT raw headers before either calculation sheet is cleared.

The hosted runner divides installation into 27 retry-safe steps: one schema preflight, then capacity, clear, header, individual formula-anchor, and raw-copy operations for each calculation sheet. It saves the next step in the `CXP07_HANDLED_OFFERED_INSTALL_STATE` Script Property after every successful operation and stops normal work after four minutes. A one-second time-driven continuation resumes the saved cursor. A seven-minute safety trigger is created before work begins so an unexpected hard cutoff does not strand the installation; normal completion or checkpointing removes that safety trigger. A script lock prevents overlapping runners.

`getCxp07HandledOfferedTransformationStatus()` reads the persisted progress without opening the spreadsheet and writes a sanitized `CXP07_STATUS` JSON record to the execution log. Expected states are `IDLE`, `RUNNING`, `COMPLETE`, and `FAILED`; `nextStep` equals `stepCount` (27) when complete. Re-running the initializer while `RUNNING` or `FAILED` resumes the saved step. Re-running it after `COMPLETE` deliberately starts a clean reinstall. This design works within Apps Script's execution limit; it does not increase or disable the platform quota. An individual spreadsheet operation must still finish within one Apps Script execution.

The calculation sheets are bounded at 10,001 rows including headers. `_CALC_HANDLED` has 30 columns (3 calculated plus the 27 raw Handled columns); `_CALC_OFFERED` has 42 columns (15 calculated plus the 27 raw Offered columns). Twenty formula anchors populate the model: 18 calculated-column spills and two raw-block spills. Direct local installation uses two header writes and four grouped formula writes. The hosted checkpointed path writes the same 20 anchors individually so each mutation is independently retryable. Both write shapes are constant regardless of populated row count; neither uses a fill-down loop.

The formulas read raw values after CXP-06 replacement. Normal Sheets dependency recalculation plus the existing CXP-06 `flush()` step refreshes results; formulas are not rewritten for every ingestion run. Re-run the installer only after workbook initialization or an approved model/schema change.

## Business-rule lineage and parity

WB0817 formula families in `config/formula-family-catalog.json` and metric chains in `config/metric-lineage-contract.json` are the only business-rule authority. `tests/fixtures/cxp07/handled-offered-parity.json` is a synthetic, hand-checked control fixture; `HandledOfferedReferenceModel` evaluates the same rules without Google services.

| Output | Excel lineage | Sheets-native pattern | Local parity |
|---|---|---|---|
| Handled Accept Date | Handled `[Accept Date]` XLOOKUP to AHT_Raw `[Accept Date]` | Bounded `ARRAYFORMULA` + `LET` + `XLOOKUP`; parse UTC ISO and subtract 8 hours before date truncation | Pass; approved timezone correction |
| Handled Interval | Handled `[Interval]` 30-minute floor after exact-or-next-greater XLOOKUP, forward first and reverse on a zero result | Bounded spill preserving match mode `1` and search modes `1`/`-1`, then fixed-PST 48-bucket floor | Pass; approved timezone correction only |
| Handled AHT | Handled `[AHT]` SUMIFS by session and date | One `QUERY` aggregation keyed by session and fixed-PST business date, then vector lookup | Pass |
| Offered Accept Date | Offered `[Accept Date]` XLOOKUP to AHT_Raw | Same fixed-PST bounded lookup as Handled | Pass; approved timezone correction |
| Offered Interval View | Offered `[Interval View]` VLOOKUP then 30-minute floor | Same fixed-PST bounded interval spill | Pass; approved timezone correction |
| Athlete Site | Offered `[Athlete Site]` VLOOKUP to Handled | Vector lookup from normalized Handled output | Pass |
| SL | Offered `[SL]`: ASA under 91 seconds | Vector comparison | Pass |
| ASA | Offered `[ASA]` XLOOKUP to AHT_Raw `[Speed To Answer]` | Bounded vector lookup | Pass |
| Handled SL | Offered `[Handled SL]`: handled ASA under 91 seconds | Vector comparison; missing handled case errors remain visible | Pass for representative matched cases |
| Handled ASA | Offered `[Handled ASA]` case-number VLOOKUP to Handled speed-to-answer | Bounded vector lookup without missing-value suppression | Pass |
| Count | Offered `[Count]`: owner equals `NA` | Vector boolean-to-number conversion | Pass |
| Handled | Offered `[Handled]` COUNTIFS on session, English, and `NA` owner | One `QUERY` count aggregation plus vector lookup | Pass |
| Handled Fragments | Offered `[Handled Fragments]` English/`NA`; blank fragment defaults to 1 | Nested vector `IF` | Pass |
| Response | Offered `[Response]` XLOOKUP to AHT_Raw first response | Bounded vector lookup | Pass |
| SL Total | Offered `[SL Total]`: ASA plus response under 91 | Vector arithmetic/comparison | Pass |
| SL Total (Session) | Blank when handled fragments are zero, otherwise SL Total | Vector conditional | Pass |
| AHT Session | SUMIFS AHT_Raw handle time by session and date | Shared query-and-lookup aggregation pattern | Pass |
| Active Time | SUMIFS AHT_Raw active time by session and date | Shared query-and-lookup aggregation pattern | Pass |

The formula catalog intentionally preserves the legacy 91-second threshold, `NA`/English filters, blank-fragment default, each family's exact/approximate search mode, and missing handled-case error visibility. It does not reproduce the Excel table's `#This Row` fill-down architecture. The sole approved rule correction is DEC-025: UTC timestamps are shifted by −480 minutes before business date and interval derivation.

Current official Google Sheets documentation defines the formula contracts used here: [XLOOKUP match/search modes](https://support.google.com/docs/answer/12405947?hl=en), [ARRAYFORMULA spills](https://support.google.com/docs/answer/3093275?hl=en), [LET bindings](https://support.google.com/docs/answer/13190535?hl=en), and [QUERY aggregation](https://support.google.com/docs/answer/3093343?hl=en). The frozen evidence and independent verdict are in `docs/cxp07-google-formula-research.md`. Documentation confirms syntax availability; only hosted UAT can confirm this workbook's actual formula parsing and performance.

## Verification boundary

`npm run test:cxp07` proves fixture outputs, formula anchors/range bounds, constant write shape, the 27-step retry-safe plan, checkpoint/resume behavior, pre-work safety-trigger creation, progress reporting, configuration isolation, schema-drift rejection before mutation, and repeat installation. Node cannot execute Google Sheets formulas or prove hosted trigger timing. Follow `docs/cxp07-uat-runbook.md` to record hosted continuation, formula parsing, spill results, representative parity, error inspection, and approximately 5k+5k recalculation timing before deployment promotion.
