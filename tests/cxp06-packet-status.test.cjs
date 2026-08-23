const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const packetStatusPath = path.join(__dirname, '..', 'docs', 'packet-status.md');

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
  assert.match(handoff, /- \*\*Hosted UAT:\*\* Pending\./);
  assert.doesNotMatch(handoff, /Not created in this task|cxp-02-workbook-initializers/);
});
