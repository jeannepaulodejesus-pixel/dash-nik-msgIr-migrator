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
});
