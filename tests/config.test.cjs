const assert = require('node:assert/strict');
const test = require('node:test');

function loadConfigModule() {
  try {
    return require('../src/config/Config.js');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      return undefined;
    }
    throw error;
  }
}

function propertyAdapter(values) {
  return {
    getProperty(name) {
      return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : null;
    },
  };
}

test('loads DEV configuration from environment-prefixed PropertiesService keys', () => {
  const Config = loadConfigModule();
  assert.equal(typeof Config?.load, 'function', 'Config.load must be implemented');

  const config = Config.load(
    propertyAdapter({
      CXP_ENV: ' dev ',
      CXP_DEV_TARGET_SPREADSHEET_ID: 'dev-target',
      CXP_DEV_CONTROL_SPREADSHEET_ID: 'dev-control',
      CXP_DEV_DRIVE_INBOX_FOLDER_ID: 'dev-inbox',
      CXP_DEV_MASTER_TEMPLATE_SPREADSHEET_ID: 'dev-template',
      CXP_DEV_LEGACY_PARITY_EXPORT_FOLDER_ID: 'dev-parity-export',
      CXP_DEV_RTA_ALLOWED_DOMAIN: 'example.test',
    }),
  );

  assert.deepEqual(config, {
    environment: 'DEV',
    targetSpreadsheetId: 'dev-target',
    controlSpreadsheetId: 'dev-control',
    driveInboxFolderId: 'dev-inbox',
    masterTemplateSpreadsheetId: 'dev-template',
    legacyParityExportFolderId: 'dev-parity-export',
    rtaAllowedDomain: 'example.test',
    staleDataThresholdMinutes: null,
  });
  assert.equal(Object.isFrozen(config), true);
});

test('resolves the same contract for UAT and PROD without source edits', () => {
  const Config = loadConfigModule();
  assert.equal(typeof Config?.load, 'function', 'Config.load must be implemented');

  for (const environment of ['UAT', 'PROD']) {
    const config = Config.load(
      propertyAdapter({
        CXP_ENV: environment,
        [`CXP_${environment}_TARGET_SPREADSHEET_ID`]: `${environment}-target`,
      }),
    );

    assert.equal(config.environment, environment);
    assert.equal(config.targetSpreadsheetId, `${environment}-target`);
    assert.equal(config.controlSpreadsheetId, null);
  }
});

test('rejects missing or unsupported active environments', () => {
  const Config = loadConfigModule();
  assert.equal(typeof Config?.load, 'function', 'Config.load must be implemented');

  assert.throws(
    () => Config.load(propertyAdapter({})),
    /CXP_ENV must be one of DEV, UAT, PROD/,
  );
  assert.throws(
    () => Config.load(propertyAdapter({ CXP_ENV: 'STAGING' })),
    /CXP_ENV must be one of DEV, UAT, PROD/,
  );
});

test('derives property names deterministically and rejects invalid suffixes', () => {
  const Config = loadConfigModule();
  assert.equal(
    typeof Config?.propertyKey,
    'function',
    'Config.propertyKey must be implemented',
  );

  assert.equal(
    Config.propertyKey('uat', 'TARGET_SPREADSHEET_ID'),
    'CXP_UAT_TARGET_SPREADSHEET_ID',
  );
  assert.throws(() => Config.propertyKey('DEV', 'UNDECLARED_KEY'), /Unknown configuration key/);
});
