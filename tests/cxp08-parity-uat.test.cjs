const assert = require('node:assert/strict');
const test = require('node:test');

const Cxp08ParityUat = require('../src/main/Cxp08UatEntrypoints.js');

test('CXP-08 parity normalizes Sheets date and interval display values', () => {
  const normalize = Cxp08ParityUat.normalizeField;

  assert.equal(normalize('Date', '', '8/17/2026'), '2026-08-17');
  assert.equal(normalize('Date', '', '2026-08-17'), '2026-08-17');
  assert.equal(normalize('Interval', '', '11:30 PM'), '23:30');
  assert.equal(normalize('Interval', '', '23:30'), '23:30');
  assert.equal(normalize('Request Interval', '', '11:30 PM'), '23:30');
  assert.equal(normalize('Count', 1, '1'), 1);
  assert.equal(normalize('CC', 1.25, '1.25'), 1.25);
});

test('CXP-08 parity fixture expected rows stay internally consistent', () => {
  assert.equal(Cxp08ParityUat.FIXTURE.expected.aht.length, 3);
  assert.equal(Cxp08ParityUat.FIXTURE.expected.auxes.length, 2);
  assert.equal(Cxp08ParityUat.FIXTURE.expected.staff.length, 2);
  assert.equal(Cxp08ParityUat.FIXTURE.expected.staffSummary.length, 4);
});

test('CXP-08 promotion bounds a refresh-bundle mismatch before parity comparison', () => {
  const originalSetup = global.Cxp08Setup;
  const originalDiagnose = global.diagnoseCxp08RunbookChecks;
  global.Cxp08Setup = {
    getStatus() {
      return { status: 'COMPLETE', nextStep: 74, stepCount: 74 };
    },
  };
  global.diagnoseCxp08RunbookChecks = () => ({
    rawSchema: {
      _RAW_AHT: { dataRowsApprox: 1 },
      _RAW_AUXES: { dataRowsApprox: 1 },
      _RAW_STAFF: { dataRowsApprox: 1 },
    },
    calc: {
      _CALC_AHT: { present: true },
      _CALC_AUXES: { present: true },
      _CALC_STAFF: { present: true },
    },
    businessContext: { pass: true },
  });

  try {
    const report = Cxp08ParityUat.promotionGate('target-id');
    assert.equal(report.pass, false);
    assert.equal(report.fixtureStateMatches, false);
    assert.equal(report.parity.skipped, true);
    assert.equal(report.parity.reason, 'FIXTURE_STATE_MISMATCH');
    assert.deepEqual(report.parity.expectedRawRows, {
      _RAW_AHT: 3,
      _RAW_AUXES: 2,
      _RAW_STAFF: 2,
    });
  } finally {
    global.Cxp08Setup = originalSetup;
    global.diagnoseCxp08RunbookChecks = originalDiagnose;
  }
});
