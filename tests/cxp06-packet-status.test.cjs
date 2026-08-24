const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const packetStatusPath = path.join(__dirname, '..', 'docs', 'packet-status.md');
const harnessPath = path.join(__dirname, '..', 'docs', 'cxp06-uat-harness.md');
const runbookPath = path.join(__dirname, '..', 'docs', 'cxp06-uat-runbook.md');

// Defect caught: CXP-06 has a completion handoff while its register row and merge metadata remain stale.
test('CXP-06 register and handoff describe the merged local delivery consistently', () => {
  const packetStatus = fs.readFileSync(packetStatusPath, 'utf8');
  const handoff = packetStatus
    .split('## CXP-06 completion handoff')[1]
    ?.split(/^## /m)[0] || '';

  assert.match(
    packetStatus,
    /^\| CXP-06 — Staging, Two-Phase Commit, Rollback, and Raw Replacement \| Complete \| Delivery `CXP-06-v1` \|$/m,
  );
  assert.match(handoff, /- \*\*Delivery version:\*\* `CXP-06-v1`/);
  assert.match(handoff, /- \*\*Branch:\*\* `main`/);
  assert.match(handoff, /- \*\*Commit:\*\* `d0e7da7`/);
  assert.match(handoff, /- \*\*Hosted UAT:\*\*.*remains pending/i);
  assert.doesNotMatch(handoff, /Not created in this task|cxp-02-workbook-initializers/);
});

// Defect caught: operators run formerly blocked topology cases against dirty
// workbooks or run the evidence-retaining ambiguous case before other UAT.
test('CXP-06 documents controlled topology seeding and safe hosted ordering', () => {
  const packetStatus = fs.readFileSync(packetStatusPath, 'utf8');
  const harness = fs.readFileSync(harnessPath, 'utf8');
  const runbook = fs.readFileSync(runbookPath, 'utf8');

  assert.match(harness, /refuses to seed when any `_CXP06_BAK_\*` sheet already exists/i);
  assert.match(harness, /immediately before production reconciliation/i);
  assert.doesNotMatch(harness, /Blocked until controlled backup-topology seeding is implemented/i);

  assert.match(runbook, /`CASE5_INCOMPLETE_BACKUP`.*delete.*without restore/is);
  assert.match(runbook, /`CASE5_COMPLETE_UNSUCCESSFUL_BACKUP`.*restore.*verify.*delete/is);
  assert.match(runbook, /`CASE5_SUCCESSFUL_LEFTOVER_BACKUP`.*keep current raw.*delete/is);
  assert.match(runbook, /`CASE5_TWO_COMPLETE_UNSUCCESSFUL_BACKUPS`.*MIGRATION_RECOVERY_FAILED/is);
  assert.match(runbook, /run.*last.*manual cleanup/is);

  assert.match(packetStatus, /controlled Case 05 backup-topology seeder/i);
  assert.match(packetStatus, /Hosted topology evidence remains pending/i);
});
