const assert = require('node:assert/strict');
const test = require('node:test');

const BusinessContextService = require('../src/services/BusinessContextService.js');
const StaffSummaryRoutingConfig = require('../src/config/StaffSummaryRoutingConfig.js');

class FakeRange {
  constructor(sheet, row, column) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
  }

  getValue() {
    return this.sheet.value;
  }

  setValue(value) {
    this.sheet.writeAttempts += 1;
    if (this.sheet.failNextWrite) {
      this.sheet.failNextWrite = false;
      throw new Error('synthetic write failure');
    }
    this.sheet.value = value;
    return this;
  }
}

class FakeSheet {
  constructor(value) {
    this.value = value;
    this.writeAttempts = 0;
    this.failNextWrite = false;
  }

  getRange(row, column) {
    return new FakeRange(this, row, column);
  }
}

function serial(iso) {
  return BusinessContextService.serialFromIsoDateOnly(iso);
}

function workbook(values = {}) {
  const sheets = new Map([
    ['Interval View', new FakeSheet(values.businessDay ?? serial('2026-08-18'))],
    ['MOM', new FakeSheet(values.weekStart ?? serial('2026-08-17'))],
    ['_CALC_STAFF', new FakeSheet(values.staffDay ?? serial('2026-08-18'))],
  ]);
  return {
    sheets,
    getSheetByName(name) {
      return sheets.get(name) || null;
    },
  };
}

test('business context derives Monday week start and defaults staff day', () => {
  assert.deepEqual(BusinessContextService.resolve({ businessDay: '2026-08-18' }), {
    businessDay: '2026-08-18',
    weekStart: '2026-08-17',
    staffDay: '2026-08-18',
  });
  assert.deepEqual(
    BusinessContextService.resolve({
      businessDay: '2026-01-01',
      staffDay: '2025-12-31',
    }),
    {
      businessDay: '2026-01-01',
      weekStart: '2025-12-29',
      staffDay: '2025-12-31',
    },
  );
  assert.equal(
    BusinessContextService.resolve({ businessDay: '2024-02-29' }).weekStart,
    '2024-02-26',
  );
});

test('business context rejects blank, timestamp, and impossible dates', () => {
  for (const value of ['', undefined, '2026-08-18T00:00:00Z', '2026-02-30']) {
    assert.throws(
      () => BusinessContextService.resolve({ businessDay: value }),
      (error) => error.code === 'BUSINESS_CONTEXT_INVALID',
    );
  }
});

test('business context write preflights every anchor before mutation', () => {
  const target = workbook();
  target.sheets.delete('MOM');

  assert.throws(
    () => BusinessContextService.write(target, { businessDay: '2026-08-25' }),
    (error) => error.code === 'BUSINESS_CONTEXT_ANCHOR_INVALID',
  );
  assert.equal(target.sheets.get('Interval View').writeAttempts, 0);
  assert.equal(target.sheets.get('_CALC_STAFF').writeAttempts, 0);
});

test('business context write restores prior anchors after a partial failure', () => {
  const target = workbook();
  const before = [...target.sheets.values()].map((sheet) => sheet.value);
  target.sheets.get('MOM').failNextWrite = true;

  assert.throws(
    () => BusinessContextService.write(target, { businessDay: '2026-08-25' }),
    (error) => error.code === 'BUSINESS_CONTEXT_WRITE_FAILED' &&
      error.details.rollbackComplete === true,
  );
  assert.deepEqual([...target.sheets.values()].map((sheet) => sheet.value), before);
});

test('business context read reports invalid anchors without exposing cascaded values', () => {
  const target = workbook({ businessDay: '#NUM!', weekStart: '#NUM!' });
  const result = BusinessContextService.read(target);

  assert.equal(result.pass, false);
  assert.equal(result.errorCode, 'BUSINESS_CONTEXT_ANCHOR_INVALID');
  assert.deepEqual(result.invalidAnchors.map((entry) => entry.anchor), [
    'businessDay',
    'weekStart',
  ]);
});

test('staff routing preserves the control split and validates complete coverage', () => {
  assert.equal(StaffSummaryRoutingConfig.forBucket(0).lasSite, 'CNX-CR1');
  assert.equal(StaffSummaryRoutingConfig.forBucket(7).queSite, 'CNX-Que');
  assert.equal(StaffSummaryRoutingConfig.forBucket(8).lasSite, 'INT-LAS');
  assert.equal(StaffSummaryRoutingConfig.forBucket(47).queSite, 'INT-Que');

  const invalidConfigs = [
    { version: 1, totalBuckets: 48, rules: [] },
    {
      version: 1,
      totalBuckets: 48,
      rules: [{ startBucket: 1, endBucketExclusive: 48, queSite: 'Q', lasSite: 'L' }],
    },
    {
      version: 1,
      totalBuckets: 48,
      rules: [
        { startBucket: 0, endBucketExclusive: 10, queSite: 'Q', lasSite: 'L' },
        { startBucket: 8, endBucketExclusive: 48, queSite: 'Q2', lasSite: 'L2' },
      ],
    },
    {
      version: 1,
      totalBuckets: 48,
      rules: [{ startBucket: 0, endBucketExclusive: 48, queSite: '', lasSite: 'L' }],
    },
  ];
  invalidConfigs.forEach((config) => assert.throws(
    () => StaffSummaryRoutingConfig.validate(config),
  ));
});
