/** UAT Inbox folder catalog in Script Properties. IDs never enter CXP-14 evidence. */
var Cxp14UatFixtureFolders = (function () {
  'use strict';

  var CATALOG_KEY = 'CXP14_UAT_FIXTURE_FOLDERS_V1';
  var OPERATOR_INBOX_KEY = 'CXP14_UAT_OPERATOR_INBOX_FOLDER_ID';
  var NEGATIVE_PROGRESS_KEY = 'CXP14_UAT_NEGATIVE_PROGRESS_V1';
  var PARITY_PHASE_KEY = 'CXP14_UAT_PARITY_PHASE_V1';
  var CATALOG_VERSION = 1;
  var FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;
  var PEAK_SLOTS = Object.freeze(['expectedPeak1', 'expectedPeak2', 'expectedPeak3']);
  var NEGATIVE_SLOTS = Object.freeze([
    'duplicate-different-name',
    'duplicate-key',
    'duplicate-same-name',
    'empty-dataset',
    'formula-xlsx',
    'incomplete-newest',
    'invalid-date',
    'invalid-interval',
    'invalid-queue',
    'invalid-site',
    'missing-dataset',
    'missing-header',
    'mixed-packaging',
    'reordered-headers',
    'unexpected-header',
  ]);
  var EXPECTED_OUTCOMES = Object.freeze({
    'duplicate-different-name': 'DUPLICATE',
    'duplicate-key': 'VALIDATION_FAILED',
    'duplicate-same-name': 'DUPLICATE',
    'empty-dataset': 'VALIDATION_FAILED',
    'formula-xlsx': 'VALIDATION_FAILED',
    'incomplete-newest': 'DISCOVERY_INCOMPLETE',
    'invalid-date': 'VALIDATION_FAILED',
    'invalid-interval': 'VALIDATION_FAILED',
    'invalid-queue': 'VALIDATION_FAILED',
    'invalid-site': 'VALIDATION_FAILED',
    'missing-dataset': 'DISCOVERY_INCOMPLETE',
    'missing-header': 'VALIDATION_FAILED',
    'mixed-packaging': 'DISCOVERY_AMBIGUOUS',
    'reordered-headers': 'SUCCESS',
    'unexpected-header': 'VALIDATION_FAILED',
  });
  var DEFAULT_NEGATIVES = Object.freeze({
    'duplicate-different-name': '1D6GXfC_T0yLrtRx5S9FKz8uXbCScoAuo',
    'duplicate-key': '1STtR3GhCpNFEvnc8Fbsy4buNNYRK4OQS',
    'duplicate-same-name': '1qtJzkzl9AkNdjP8tMH7hTnMDcip5XeaB',
    'empty-dataset': '1yrfv3VQXEko6IPXvWN03sDhrneHGZTaq',
    'formula-xlsx': '1VHzR9gBUcFSgn4GtNlIs9adRzPInIoZ1',
    'incomplete-newest': '1lnnVO7COMmd86Obo99F5o6fB-FXT3EEq',
    'invalid-date': '1RoORptWGFyZxdN1ZgoS1WVHFYbvQrxz-',
    'invalid-interval': '1mL2Lvsq1vxngQWUNcsMReA1AtHj-EzQE',
    'invalid-queue': '11f4r0aim66qOd1g0cWcochvbc3uyWjZW',
    'invalid-site': '1Prfxsr2DsFGg_o-yHboS6D4dCrYRoRyu',
    'missing-dataset': '18YkDza3mjCY0U-nTnqTjKxkzRh4WQr11',
    'missing-header': '1ppf2q-QYJfU0LmHO8mdiOI5InyK3JF9N',
    'mixed-packaging': '1yH9XA2jEiunkPlGgpcYomIoLCcVkZ_4u',
    'reordered-headers': '1OggVgqGUsw3RkEVLmHMc2Vu_CY3hNluG',
    'unexpected-header': '1Qk_iCLWYNyPAYgzhPt-rPKKzjK_OZhhV',
  });
  var DEFAULT_CATALOG = Object.freeze({
    declaredMaximum: '1jdyFoIwd3WfJYEl-JROTyHxP_nDawCiv',
    expectedPeak1: '1wq5rvrtf6GbzqsEm0YduSS18hnhZIDyQ',
    expectedPeak2: '1YpmMoBmqrceBEY7D8g3flHWmKUIv7-Xk',
    expectedPeak3: '15xhYhfBcQelcFoieOpPSrcgLkaqZ2MXn',
    negatives: DEFAULT_NEGATIVES,
    parityExport: '1HC33vbpBQbib8_Qoe3ZkUp_7SCUpAAIp',
    paritySource: '1ads3Ot_Tc_3T_Xk_cFgTzic98stGZX4u',
    version: CATALOG_VERSION,
  });

  function resolveConfig() {
    if (typeof Config !== 'undefined') return Config;
    if (typeof require === 'function') return require('../config/Config.js');
    return null;
  }
  function validFolderId(value) {
    return typeof value === 'string' && FOLDER_ID_PATTERN.test(value);
  }
  function copyNegatives(source) {
    var copied = {};
    NEGATIVE_SLOTS.forEach(function (slot) {
      copied[slot] = source && source[slot];
    });
    return copied;
  }
  function normalizeCatalog(value) {
    var source = value || {};
    var negatives = copyNegatives(source.negatives || source);
    var catalog = {
      declaredMaximum: source.declaredMaximum,
      expectedPeak1: source.expectedPeak1,
      expectedPeak2: source.expectedPeak2,
      expectedPeak3: source.expectedPeak3,
      negatives: negatives,
      parityExport: source.parityExport,
      paritySource: source.paritySource,
      version: CATALOG_VERSION,
    };
    if (!validFolderId(catalog.expectedPeak1) || !validFolderId(catalog.expectedPeak2) ||
      !validFolderId(catalog.expectedPeak3) || !validFolderId(catalog.declaredMaximum) ||
      !validFolderId(catalog.parityExport) || !validFolderId(catalog.paritySource)) {
      return null;
    }
    var valid = NEGATIVE_SLOTS.every(function (slot) { return validFolderId(catalog.negatives[slot]); });
    return valid ? catalog : null;
  }
  function defaultCatalog() {
    return normalizeCatalog(DEFAULT_CATALOG);
  }
  function folderIdFor(catalog, slot) {
    if (!catalog || !slot) return null;
    if (slot === 'declaredMaximum' || slot === 'expectedPeak1' || slot === 'expectedPeak2' ||
      slot === 'expectedPeak3' || slot === 'parityExport' || slot === 'paritySource') {
      return validFolderId(catalog[slot]) ? catalog[slot] : null;
    }
    return catalog.negatives && validFolderId(catalog.negatives[slot]) ? catalog.negatives[slot] : null;
  }
  function catalogContains(catalog, folderId) {
    if (!validFolderId(folderId) || !catalog) return false;
    if (folderIdFor(catalog, 'expectedPeak1') === folderId || folderIdFor(catalog, 'expectedPeak2') === folderId ||
      folderIdFor(catalog, 'expectedPeak3') === folderId || folderIdFor(catalog, 'declaredMaximum') === folderId ||
      folderIdFor(catalog, 'parityExport') === folderId || folderIdFor(catalog, 'paritySource') === folderId) {
      return true;
    }
    return NEGATIVE_SLOTS.some(function (slot) { return folderIdFor(catalog, slot) === folderId; });
  }
  function persistableCatalog(catalog) {
    return {
      declaredMaximum: catalog.declaredMaximum,
      expectedPeak1: catalog.expectedPeak1,
      expectedPeak2: catalog.expectedPeak2,
      expectedPeak3: catalog.expectedPeak3,
      negatives: copyNegatives(catalog.negatives),
      parityExport: catalog.parityExport,
      paritySource: catalog.paritySource,
      version: CATALOG_VERSION,
    };
  }
  function load(properties) {
    if (!properties || typeof properties.getProperty !== 'function') return null;
    var raw = properties.getProperty(CATALOG_KEY);
    if (!raw) return null;
    var parsed;
    try { parsed = JSON.parse(raw); } catch (_error) { return null; }
    return normalizeCatalog(parsed);
  }
  function envPropertyKey(environment, suffix) {
    var config = resolveConfig();
    if (!config || !environment) return null;
    try { return config.propertyKey(environment, suffix); } catch (_error) { return null; }
  }
  function rememberOperatorInbox(properties, environment, catalog) {
    if (properties.getProperty(OPERATOR_INBOX_KEY)) return;
    var key = envPropertyKey(environment, 'DRIVE_INBOX_FOLDER_ID');
    var current = key ? properties.getProperty(key) : null;
    if (validFolderId(current) && !catalogContains(catalog, current)) {
      properties.setProperty(OPERATOR_INBOX_KEY, current);
    }
  }
  function seedEnvFolder(properties, environment, suffix, folderId) {
    var key = envPropertyKey(environment, suffix);
    if (!key || !validFolderId(folderId)) return false;
    var current = properties.getProperty(key);
    if (current) return false;
    properties.setProperty(key, folderId);
    return true;
  }
  function retargetEnvFolder(properties, environment, suffix, folderId) {
    var key = envPropertyKey(environment, suffix);
    if (!key || !validFolderId(folderId) || !properties || typeof properties.setProperty !== 'function') {
      return false;
    }
    properties.setProperty(key, folderId);
    return true;
  }
  function install(properties, supplied, configuration) {
    if (!properties || typeof properties.setProperty !== 'function') {
      return Object.freeze({ configured: false, missing: Object.freeze(['properties']), pass: false });
    }
    var catalog = normalizeCatalog(supplied || defaultCatalog());
    if (!catalog) {
      return Object.freeze({ configured: false, missing: Object.freeze(['fixtureFolders']), pass: false });
    }
    var environment = configuration && configuration.environment ? configuration.environment : null;
    if (environment === 'PROD') {
      return Object.freeze({ configured: false, missing: Object.freeze(['environment']), pass: false });
    }
    properties.setProperty(CATALOG_KEY, JSON.stringify(persistableCatalog(catalog)));
    if (environment) {
      rememberOperatorInbox(properties, environment, catalog);
      seedEnvFolder(properties, environment, 'DRIVE_INBOX_FOLDER_ID', catalog.expectedPeak1);
      seedEnvFolder(properties, environment, 'LEGACY_PARITY_EXPORT_FOLDER_ID', catalog.parityExport);
    }
    return Object.freeze({
      configured: true,
      negativeCount: NEGATIVE_SLOTS.length,
      pass: true,
      slotCount: PEAK_SLOTS.length + 1 + NEGATIVE_SLOTS.length + 2,
    });
  }
  function selectPeakSlot(recordedRunCount) {
    var index = Number.isInteger(recordedRunCount) && recordedRunCount > 0 ? recordedRunCount : 0;
    if (index >= PEAK_SLOTS.length) return PEAK_SLOTS[PEAK_SLOTS.length - 1];
    return PEAK_SLOTS[index];
  }
  function selectNegativeSlot(observedCount) {
    var index = Number.isInteger(observedCount) && observedCount > 0 ? observedCount : 0;
    if (index >= NEGATIVE_SLOTS.length) return null;
    return NEGATIVE_SLOTS[index];
  }
  function expectedOutcome(slot) {
    return EXPECTED_OUTCOMES[slot] || null;
  }
  function loadNegativeProgress(properties) {
    if (!properties || typeof properties.getProperty !== 'function') {
      return Object.freeze({ observedCount: 0, lastOutcome: null, lastSlot: null, version: 1 });
    }
    var raw = properties.getProperty(NEGATIVE_PROGRESS_KEY);
    if (!raw) return Object.freeze({ observedCount: 0, lastOutcome: null, lastSlot: null, version: 1 });
    var parsed;
    try { parsed = JSON.parse(raw); } catch (_error) {
      return Object.freeze({ observedCount: 0, lastOutcome: null, lastSlot: null, version: 1 });
    }
    var observedCount = Number.isInteger(parsed.observedCount) ? parsed.observedCount : 0;
    if (observedCount < 0) observedCount = 0;
    if (observedCount > NEGATIVE_SLOTS.length) observedCount = NEGATIVE_SLOTS.length;
    var lastSlot = typeof parsed.lastSlot === 'string' && NEGATIVE_SLOTS.indexOf(parsed.lastSlot) !== -1 ? parsed.lastSlot : null;
    var lastOutcome = typeof parsed.lastOutcome === 'string' ? parsed.lastOutcome : null;
    return Object.freeze({
      lastOutcome: lastOutcome,
      lastSlot: lastSlot,
      observedCount: observedCount,
      version: 1,
    });
  }
  function saveNegativeProgress(properties, progress) {
    if (!properties || typeof properties.setProperty !== 'function') return loadNegativeProgress(properties);
    var next = {
      lastOutcome: progress && progress.lastOutcome ? String(progress.lastOutcome) : null,
      lastSlot: progress && progress.lastSlot ? String(progress.lastSlot) : null,
      observedCount: progress && Number.isInteger(progress.observedCount) ? progress.observedCount : 0,
      version: 1,
    };
    properties.setProperty(NEGATIVE_PROGRESS_KEY, JSON.stringify(next));
    return loadNegativeProgress(properties);
  }
  function loadParityPhase(properties) {
    var raw = properties && typeof properties.getProperty === 'function' ? properties.getProperty(PARITY_PHASE_KEY) : null;
    if (raw === 'EXPORT' || raw === 'COMPLETE') return raw;
    return 'SOURCE';
  }
  function saveParityPhase(properties, phase) {
    if (!properties || typeof properties.setProperty !== 'function') return loadParityPhase(properties);
    var next = phase === 'EXPORT' || phase === 'COMPLETE' ? phase : 'SOURCE';
    properties.setProperty(PARITY_PHASE_KEY, next);
    return next;
  }

  return Object.freeze({
    CATALOG_KEY: CATALOG_KEY,
    CATALOG_VERSION: CATALOG_VERSION,
    EXPECTED_OUTCOMES: EXPECTED_OUTCOMES,
    NEGATIVE_PROGRESS_KEY: NEGATIVE_PROGRESS_KEY,
    NEGATIVE_SLOTS: NEGATIVE_SLOTS,
    OPERATOR_INBOX_KEY: OPERATOR_INBOX_KEY,
    PARITY_PHASE_KEY: PARITY_PHASE_KEY,
    PEAK_SLOTS: PEAK_SLOTS,
    defaultCatalog: defaultCatalog,
    expectedOutcome: expectedOutcome,
    folderIdFor: folderIdFor,
    install: install,
    load: load,
    loadNegativeProgress: loadNegativeProgress,
    loadParityPhase: loadParityPhase,
    retargetInbox: function (properties, environment, folderId) {
      return retargetEnvFolder(properties, environment, 'DRIVE_INBOX_FOLDER_ID', folderId);
    },
    retargetParityExport: function (properties, environment, folderId) {
      return retargetEnvFolder(properties, environment, 'LEGACY_PARITY_EXPORT_FOLDER_ID', folderId);
    },
    saveNegativeProgress: saveNegativeProgress,
    saveParityPhase: saveParityPhase,
    selectNegativeSlot: selectNegativeSlot,
    selectPeakSlot: selectPeakSlot,
    validFolderId: validFolderId,
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Cxp14UatFixtureFolders;
