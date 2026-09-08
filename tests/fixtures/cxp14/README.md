# CXP-14 UAT workload fixtures

Synthetic, non-personal source bundles for [`docs/cxp14-uat-runbook.md`](../../../docs/cxp14-uat-runbook.md) precondition 6.

```powershell
npm run generate:cxp14-fixtures
```

Writes `outputs/cxp14-uat-fixtures-<UTC-token>/` with:

| Folder | Profile | Rows | Use |
|---|---|---:|---|
| `expected-peak-01` … `03` | `EXPECTED_PEAK` | 20,300 each | Three distinct CXP-13 Inbox drops |
| `declared-maximum` | `DECLARED_MAXIMUM` | 44,500 | One stress drop |
| `negatives/*` | failure matrix | small | Header, empty, duplicate, incomplete, formula, mixed packaging |
| `parity/source` | accepted source | compact | Ingest first so FILE_LEDGER stores the fingerprint |
| `parity/export` | CXP-11 eight-file package | compact | `sourceBundleFingerprint` equals `parity/source` |

Unit-scale generation (`--scale unit`) is what `npm run test:cxp14` uses. Full peak/maximum files stay out of git.

Drop one subdirectory into its own UAT Inbox folder. After `configureCxp14UatFixtureFolders()`, CXP-14 retargets the active Inbox per step. Never mix `incomplete-newest` with a successful bundle in the same folder. The parity export is an operator-recalculated **contract package** from the same synthetic bytes, not a production weekly Excel dump. A real weekly run must ingest that real bundle and copy the successful FILE_LEDGER fingerprint into the live manifest; never use the CXP-11 placeholder fingerprint.
