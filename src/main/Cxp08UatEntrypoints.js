/**
 * CXP-08 hosted UAT helpers for docs/cxp08-uat-runbook.md.
 *
 * Editor entrypoints (parameterless):
 *   CXP08UatStep01Install
 *   CXP08UatStep02InspectTopology
 *   CXP08UatStep03LoadParityFixture
 *   CXP08UatStep03RunParity
 *
 * Dataset policy: operators never manually preload _RAW_* / _STG_* rows.
 * Small data = embedded parity/refresh fixtures (Steps 03–04, 06).
 * Peak data = backend-provided source files via CXP-06 ingest (Step 05).
 *   CXP08UatStep05PeakFlushTiming
 *   CXP08UatStep06SecondBundleRefresh
 *   CXP08UatStep07ReinstallTopology
 *   CXP08UatStep08PromotionGate
 */

var Cxp08ParityUat = (function () {
  'use strict';

  var BUSINESS_DAY_ISO = '2026-08-18';
  var AHT_CALC_HEADERS = Object.freeze([
    'Date',
    'Interval',
    'Count',
    'Service Level',
    'ASA Total',
    'CC',
    'Request Interval',
  ]);
  var AUXES_CALC_HEADERS = Object.freeze([
    'Date',
    'Interval',
    'Available Messaging in Hours',
    'Concluding in Hours',
  ]);

  // Mirror of tests/fixtures/cxp08/aht-auxes-staff-parity.json (embedded for Apps Script).
  var FIXTURE = Object.freeze({
    businessDay: BUSINESS_DAY_ISO,
    inputs: Object.freeze({
      ahtRows: Object.freeze([
        Object.freeze({
          'Agent Work ID': 'AW-1',
          'Work Item: Name': 'SESSION-100',
          'Athlete Site': 'CNX-Que',
          'Request Date': '2026-08-18T07:40:00.000Z',
          'Accept Date': '2026-08-18T07:45:00.000Z',
          'Handle Time': 120,
          'Active Time': 100,
          'Speed To Answer': 50,
          'Time To First Response': 20,
        }),
        Object.freeze({
          'Agent Work ID': 'AW-2',
          'Work Item: Name': 'SESSION-100',
          'Athlete Site': 'CNX-Que',
          'Request Date': '2026-08-18T07:48:00.000Z',
          'Accept Date': '2026-08-18T07:50:00.000Z',
          'Handle Time': 180,
          'Active Time': 140,
          'Speed To Answer': 55,
          'Time To First Response': 25,
        }),
        Object.freeze({
          'Agent Work ID': 'AW-3',
          'Work Item: Name': 'SESSION-200',
          'Athlete Site': 'INT-LAS',
          'Request Date': '2026-08-18T08:00:00.000Z',
          'Accept Date': '2026-08-18T08:05:00.000Z',
          'Handle Time': 90,
          'Active Time': 60,
          'Speed To Answer': 100,
          'Time To First Response': 5,
        }),
      ]),
      auxesRows: Object.freeze([
        Object.freeze({
          Name: 'P1',
          'User Presence ID': 'UP-1',
          'Status Start Date': '2026-08-18T07:45:00.000Z',
          'Service Presence Status: Status Name': 'Available - Messaging',
          'Sign On Time (hours)': 1.5,
        }),
        Object.freeze({
          Name: 'P2',
          'User Presence ID': 'UP-2',
          'Status Start Date': '2026-08-18T08:05:00.000Z',
          'Service Presence Status: Status Name': 'Concluding',
          'Sign On Time (hours)': 0.25,
        }),
      ]),
      staffRows: Object.freeze([
        Object.freeze({
          'Status Start Date': '2026-08-18T08:00:00.000Z',
          'Status End Date': '2026-08-18T09:00:00.000Z',
          'Athlete Display Name': 'Agent A',
          'Athlete Site': 'INT-LAS',
          'Athlete Profile': 'Messaging',
        }),
      ]),
    }),
    expected: Object.freeze({
      aht: Object.freeze([
        Object.freeze({
          Date: '2026-08-17',
          Interval: '23:30',
          Count: 1,
          'Service Level': 1,
          'ASA Total': 70,
          CC: 1.25,
          'Request Interval': '23:30',
        }),
        Object.freeze({
          Date: '2026-08-17',
          Interval: '23:30',
          Count: 1,
          'Service Level': 1,
          'ASA Total': 80,
          CC: 1.25,
          'Request Interval': '23:30',
        }),
        Object.freeze({
          Date: '2026-08-18',
          Interval: '00:00',
          Count: 1,
          'Service Level': 0,
          'ASA Total': 105,
          CC: 1.5,
          'Request Interval': '00:00',
        }),
      ]),
      auxes: Object.freeze([
        Object.freeze({
          Date: '2026-08-17',
          Interval: '23:30',
          'Available Messaging in Hours': 1.5,
          'Concluding in Hours': 0,
        }),
        Object.freeze({
          Date: '2026-08-18',
          Interval: '00:00',
          'Available Messaging in Hours': 0,
          'Concluding in Hours': 0.25,
        }),
      ]),
    }),
  });

  function uatLog(tag, payload) {
    var line = 'CXP08_UAT ' + tag + ' ' + JSON.stringify(payload || {});
    if (typeof console !== 'undefined' && typeof console.log === 'function') {
      console.log(line);
    }
    if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
      Logger.log(line);
    }
  }

  function resolveSchemaRegistry() {
    if (typeof SchemaRegistry !== 'undefined') {
      return SchemaRegistry;
    }
    throw new Error('SchemaRegistry is required.');
  }

  function openTarget(spreadsheetId) {
    var id = spreadsheetId;
    if (!id || typeof id !== 'string') {
      id = Config.load().targetSpreadsheetId;
    }
    if (!id) {
      throw new Error('Configured CXP-08 target spreadsheet ID is required.');
    }
    return SpreadsheetApp.openById(id);
  }

  function requireSheet(ss, name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      throw new Error('Required sheet missing: ' + name);
    }
    return sheet;
  }

  function mergeRow(headers, partial) {
    return headers.map(function (header) {
      return Object.prototype.hasOwnProperty.call(partial, header)
        ? partial[header]
        : '';
    });
  }

  function excelSerialFromIsoDateOnly(isoDate) {
    var parts = String(isoDate).slice(0, 10).split('-').map(Number);
    var utc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    return (utc - Date.UTC(1899, 11, 30)) / 86400000;
  }

  function writeDataset(sheet, headers, rows, prefix) {
    uatLog(prefix + '.write.start', { sheet: sheet.getName(), rows: rows.length });
    sheet.clearContents();
    var values = [headers].concat(rows);
    sheet.getRange(1, 1, values.length, headers.length).setValues(values);
    uatLog(prefix + '.write.done', { sheet: sheet.getName(), rows: rows.length });
  }

  function buildAhtMatrix(partials) {
    var schema = resolveSchemaRegistry().getSchema('AHT - Raw');
    var headers = schema.requiredHeaders;
    var rows = partials.map(function (partial) {
      return mergeRow(headers, partial);
    });
    return { headers: headers, rows: rows };
  }

  function buildAuxesMatrix(partials) {
    var schema = resolveSchemaRegistry().getSchema('Auxes - Raw');
    var headers = schema.requiredHeaders;
    var rows = partials.map(function (partial) {
      return mergeRow(headers, partial);
    });
    return { headers: headers, rows: rows };
  }

  function buildStaffMatrix(partials) {
    var schema = resolveSchemaRegistry().getSchema('Staff');
    var headers = schema.requiredHeaders;
    var rows = partials.map(function (partial) {
      return mergeRow(headers, partial);
    });
    return { headers: headers, rows: rows };
  }

  function loadParityFixture(spreadsheetId) {
    var prefix = 'CXP08UatStep03';
    var ss = openTarget(spreadsheetId);
    var aht = buildAhtMatrix(FIXTURE.inputs.ahtRows);
    var auxes = buildAuxesMatrix(FIXTURE.inputs.auxesRows);
    var staff = buildStaffMatrix(FIXTURE.inputs.staffRows);
    writeDataset(requireSheet(ss, '_RAW_AHT'), aht.headers, aht.rows, prefix + '.aht');
    writeDataset(requireSheet(ss, '_RAW_AUXES'), auxes.headers, auxes.rows, prefix + '.auxes');
    writeDataset(requireSheet(ss, '_RAW_STAFF'), staff.headers, staff.rows, prefix + '.staff');
    requireSheet(ss, '_CALC_STAFF').getRange(1, 57).setValue(
      excelSerialFromIsoDateOnly(FIXTURE.businessDay),
    );
    SpreadsheetApp.flush();
    return Object.freeze({
      ahtRows: aht.rows.length,
      auxesRows: auxes.rows.length,
      staffRows: staff.rows.length,
      businessDay: FIXTURE.businessDay,
    });
  }

  function runParityStep(spreadsheetId) {
    var load = loadParityFixture(spreadsheetId);
    if (typeof Utilities !== 'undefined' && typeof Utilities.sleep === 'function') {
      Utilities.sleep(2000);
    }
    SpreadsheetApp.flush();
    var compare = recordParityOutputs(spreadsheetId);
    return Object.freeze({
      load: load,
      compare: compare,
      pass: compare.pass,
    });
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function isDateObject(value) {
    return Object.prototype.toString.call(value) === '[object Date]' &&
      !Number.isNaN(value.getTime());
  }

  function sheetsSerialToDateParts(serial) {
    if (typeof serial !== 'number' || !Number.isFinite(serial)) {
      return null;
    }
    var utcMs = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
    var date = new Date(utcMs);
    return {
      yyyyMmDd:
        date.getUTCFullYear() +
        '-' + pad2(date.getUTCMonth() + 1) +
        '-' + pad2(date.getUTCDate()),
    };
  }

  function normalizeField(header, rawValue, displayValue) {
    if (header === 'Date') {
      if (isDateObject(rawValue) && typeof Utilities !== 'undefined') {
        return Utilities.formatDate(rawValue, 'Etc/GMT+8', 'yyyy-MM-dd');
      }
      if (isDateObject(rawValue)) {
        return (
          rawValue.getFullYear() +
          '-' + pad2(rawValue.getMonth() + 1) +
          '-' + pad2(rawValue.getDate())
        );
      }
      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        var fromSerial = sheetsSerialToDateParts(rawValue);
        if (fromSerial) {
          return fromSerial.yyyyMmDd;
        }
      }
      var text = String(displayValue || rawValue || '').trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
        return text.slice(0, 10);
      }
      var mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (mdy) {
        return mdy[3] + '-' + pad2(mdy[1]) + '-' + pad2(mdy[2]);
      }
      if (/^\d{5}(\.\d+)?$/.test(text)) {
        var serialParts = sheetsSerialToDateParts(Number(text));
        if (serialParts) {
          return serialParts.yyyyMmDd;
        }
      }
      return text;
    }

    if (header === 'Interval' || header === 'Request Interval') {
      if (isDateObject(rawValue) && typeof Utilities !== 'undefined') {
        return Utilities.formatDate(rawValue, 'Etc/GMT+8', 'HH:mm');
      }
      if (isDateObject(rawValue)) {
        return pad2(rawValue.getHours()) + ':' + pad2(rawValue.getMinutes());
      }
      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        var minutes = Math.round(((rawValue % 1) + 1) % 1 * 24 * 60);
        return pad2(Math.floor(minutes / 60) % 24) + ':' + pad2(minutes % 60);
      }
      var display = String(displayValue || '').trim();
      var ampm = display.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (ampm) {
        var hour = Number(ampm[1]) % 12;
        if (ampm[3].toUpperCase() === 'PM') {
          hour += 12;
        }
        return pad2(hour) + ':' + ampm[2];
      }
      var timeMatch = display.match(/(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        return pad2(timeMatch[1]) + ':' + timeMatch[2];
      }
      return display;
    }

    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return rawValue;
    }
    var asText = String(displayValue === undefined || displayValue === null
      ? (rawValue || '')
      : displayValue).trim();
    if (asText !== '' && /^-?\d+(\.\d+)?$/.test(asText)) {
      return Number(asText);
    }
    return asText;
  }

  function readCalcBlock(sheet, headers, maxRows) {
    var lastRow = Math.min(sheet.getLastRow(), maxRows);
    if (lastRow < 2) {
      return [];
    }
    var range = sheet.getRange(2, 1, lastRow, headers.length);
    var displayValues = range.getDisplayValues();
    var rawValues = range.getValues();
    return displayValues.map(function (row, rowIndex) {
      var out = {};
      headers.forEach(function (header, index) {
        out[header] = normalizeField(
          header,
          rawValues[rowIndex][index],
          row[index],
        );
      });
      return out;
    }).filter(function (row) {
      return Object.keys(row).some(function (key) {
        var value = row[key];
        return value !== '' && value !== null && value !== undefined;
      });
    });
  }

  function compareRows(actualRows, expectedRows, headers) {
    var diffs = [];
    expectedRows.forEach(function (expected, index) {
      var actual = actualRows[index] || {};
      headers.forEach(function (header) {
        var left = actual[header] === undefined ? '' : actual[header];
        var right = expected[header] === undefined ? '' : expected[header];
        if (left !== right) {
          diffs.push({
            row: index + 1,
            field: header,
            actual: left,
            expected: right,
          });
        }
      });
    });
    return diffs;
  }

  function recordParityOutputs(spreadsheetId) {
    var prefix = 'CXP08UatStep04';
    var ss = openTarget(spreadsheetId);
    SpreadsheetApp.flush();
    var ahtActual = readCalcBlock(requireSheet(ss, '_CALC_AHT'), AHT_CALC_HEADERS, 20);
    var auxesActual = readCalcBlock(requireSheet(ss, '_CALC_AUXES'), AUXES_CALC_HEADERS, 20);
    var ahtDiffs = compareRows(ahtActual, FIXTURE.expected.aht, AHT_CALC_HEADERS);
    var auxesDiffs = compareRows(auxesActual, FIXTURE.expected.auxes, AUXES_CALC_HEADERS);
    var report = {
      pass: ahtDiffs.length === 0 && auxesDiffs.length === 0,
      ahtDiffCount: ahtDiffs.length,
      auxesDiffCount: auxesDiffs.length,
      ahtDiffs: ahtDiffs,
      auxesDiffs: auxesDiffs,
      timezoneCheck: {
        aht0: 'UTC 07:45 -> prior fixed-PST date 2026-08-17 @ 23:30',
        aht2: 'UTC 08:05 -> same UTC date 2026-08-18 @ 00:00',
      },
    };
    uatLog(prefix + '.result', {
      pass: report.pass,
      ahtDiffCount: report.ahtDiffCount,
      auxesDiffCount: report.auxesDiffCount,
      ahtDiffs: ahtDiffs.slice(0, 5),
      auxesDiffs: auxesDiffs.slice(0, 5),
    });
    return report;
  }

  function inspectTopology(spreadsheetId) {
    return diagnoseCxp08RunbookChecks(spreadsheetId);
  }

  function peakFlushTiming(spreadsheetId) {
    var ss = openTarget(spreadsheetId);
    var started = Date.now();
    SpreadsheetApp.flush();
    var elapsedMs = Date.now() - started;
    var report = {
      elapsedMs: elapsedMs,
      ahtLastRow: requireSheet(ss, '_CALC_AHT').getLastRow(),
      auxesLastRow: requireSheet(ss, '_CALC_AUXES').getLastRow(),
      staffLastRow: requireSheet(ss, '_CALC_STAFF').getLastRow(),
    };
    uatLog('CXP08UatStep05.result', report);
    return report;
  }

  function secondBundleRefresh(spreadsheetId) {
    var prefix = 'CXP08UatStep06';
    var ss = openTarget(spreadsheetId);
    var aht = buildAhtMatrix([
      Object.assign({}, FIXTURE.inputs.ahtRows[2], {
        'Agent Work ID': 'AW-REFRESH-1',
        'Work Item: Name': 'SESSION-REFRESH',
        'Handle Time': 40,
        'Active Time': 20,
      }),
    ]);
    var auxes = buildAuxesMatrix([FIXTURE.inputs.auxesRows[1]]);
    var staff = buildStaffMatrix([FIXTURE.inputs.staffRows[0]]);
    writeDataset(requireSheet(ss, '_RAW_AHT'), aht.headers, aht.rows, prefix + '.aht');
    writeDataset(requireSheet(ss, '_RAW_AUXES'), auxes.headers, auxes.rows, prefix + '.auxes');
    writeDataset(requireSheet(ss, '_RAW_STAFF'), staff.headers, staff.rows, prefix + '.staff');
    SpreadsheetApp.flush();
    return Object.freeze({
      ahtRows: aht.rows.length,
      auxesRows: auxes.rows.length,
      staffRows: staff.rows.length,
    });
  }

  function promotionGate(spreadsheetId) {
    var status = Cxp08Setup.getStatus();
    var topology = inspectTopology(spreadsheetId);
    var report = {
      installComplete: status && status.status === 'COMPLETE',
      nextStep: status ? status.nextStep : null,
      stepCount: status ? status.stepCount : null,
      ahtPresent: !!(topology.calc && topology.calc._CALC_AHT && topology.calc._CALC_AHT.present),
      auxesPresent: !!(topology.calc && topology.calc._CALC_AUXES && topology.calc._CALC_AUXES.present),
      staffPresent: !!(topology.calc && topology.calc._CALC_STAFF && topology.calc._CALC_STAFF.present),
    };
    report.pass = report.installComplete &&
      report.ahtPresent &&
      report.auxesPresent &&
      report.staffPresent;
    uatLog('CXP08UatStep08.result', {
      pass: report.pass,
      installComplete: report.installComplete,
    });
    return report;
  }

  return Object.freeze({
    FIXTURE: FIXTURE,
    inspectTopology: inspectTopology,
    loadParityFixture: loadParityFixture,
    normalizeField: normalizeField,
    peakFlushTiming: peakFlushTiming,
    promotionGate: promotionGate,
    recordParityOutputs: recordParityOutputs,
    runParityStep: runParityStep,
    secondBundleRefresh: secondBundleRefresh,
  });
})();

function CXP08UatStep01Install() {
  return initializeCxp08AhtAuxesStaffTransformations();
}

function CXP08UatStep02InspectTopology() {
  return Cxp08ParityUat.inspectTopology();
}

function CXP08UatStep03LoadParityFixture() {
  return Cxp08ParityUat.loadParityFixture();
}

function CXP08UatStep04RecordParityOutputs() {
  return Cxp08ParityUat.recordParityOutputs();
}

function CXP08UatStep03RunParity() {
  return Cxp08ParityUat.runParityStep();
}

function CXP08UatStep05PeakFlushTiming() {
  return Cxp08ParityUat.peakFlushTiming();
}

function CXP08UatStep06SecondBundleRefresh() {
  return Cxp08ParityUat.secondBundleRefresh();
}

function CXP08UatStep07ReinstallTopology() {
  return initializeCxp08AhtAuxesStaffTransformations();
}

function CXP08UatStep08PromotionGate() {
  return Cxp08ParityUat.promotionGate();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp08ParityUat;
}
