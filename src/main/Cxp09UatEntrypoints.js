/**
 * CXP-09 hosted UAT helpers for docs/cxp09-uat-runbook.md.
 *
 * Editor entrypoints (parameterless):
 *   CXP09UatStep00VerifyPrerequisites
 *   CXP09UatStep01Install
 *   CXP09UatStep02InspectTopology
 *   CXP09UatStep03LoadParityFixture
 *   CXP09UatStep03RunParity
 *   CXP09UatStep04RecordParityOutputs
 *   CXP09UatStep05PeakFlushTiming
 *   CXP09UatStep06SecondBundleRefresh
 *   CXP09UatStep07ReinstallTopology
 *   CXP09UatStep08PromotionGate
 */

var Cxp09ParityUat = (function () {
  'use strict';

  var BUSINESS_DAY_ISO = '2026-08-18';
  var INTERVAL_HEADERS = Object.freeze([
    'Date',
    'Interval',
    'Site',
    'Offered',
    'Handled',
    'Chats in SL',
    'SL TTC',
    'AHT (Session)',
    'AHT',
    'ACW',
    'ASA',
    'Concurrency',
  ]);
  var ALLOCATION_HEADERS = Object.freeze([
    'Date',
    'Interval',
    'Site',
    'BPO',
    'Offered Count',
    'Allocation Share',
  ]);
  var FORECAST_HEADERS = Object.freeze([
    'Date',
    'Interval',
    'Site',
    'Type',
    'Value',
  ]);

  // Mirror of tests/fixtures/cxp09/aggregation-parity.json (embedded for Apps Script).
  var FIXTURE = Object.freeze({
    businessDay: BUSINESS_DAY_ISO,
    inputs: Object.freeze({
      handledRows: Object.freeze([
        Object.freeze({
          'Case: Case Number': 'C-100',
          'Messaging Session Name': 'SESSION-100',
          'Initial Athlete CS Owner': 'NA',
          'Speed to Answer': 42,
          'Initial Athlete Site': 'PH',
          Language: 'English',
        }),
        Object.freeze({
          'Case: Case Number': 'C-200',
          'Messaging Session Name': 'SESSION-200',
          'Initial Athlete CS Owner': 'NA',
          'Speed to Answer': 95,
          'Initial Athlete Site': 'LAS',
          Language: 'Spanish',
        }),
      ]),
      offeredRows: Object.freeze([
        Object.freeze({
          'Case: Case Number': 'C-100',
          'Messaging Session Name': 'SESSION-100',
          Language: 'English',
          'Initial Athlete CS Owner': 'NA',
          'Contact Fragment Count': null,
          'Initial Athlete BPO': 'BPO-A',
        }),
        Object.freeze({
          'Case: Case Number': 'C-200',
          'Messaging Session Name': 'SESSION-200',
          Language: 'English',
          'Initial Athlete CS Owner': 'NA',
          'Contact Fragment Count': 2,
          'Initial Athlete BPO': 'BPO-B',
        }),
      ]),
      ahtRows: Object.freeze([
        Object.freeze({
          'Work Item: Name': 'SESSION-100',
          'Accept Date': '2026-08-18T07:45:00.000Z',
          'Handle Time': 120,
          'Active Time': 100,
          'Speed To Answer': 50,
          'Time To First Response': 20,
          'Athlete Site': 'PH',
          'After Conversation Work Actual Time': 30,
        }),
        Object.freeze({
          'Work Item: Name': 'SESSION-100',
          'Accept Date': '2026-08-18T07:50:00.000Z',
          'Handle Time': 180,
          'Active Time': 140,
          'Speed To Answer': 55,
          'Time To First Response': 25,
          'Athlete Site': 'PH',
          'After Conversation Work Actual Time': 40,
        }),
        Object.freeze({
          'Work Item: Name': 'SESSION-200',
          'Accept Date': '2026-08-18T08:05:00.000Z',
          'Handle Time': 90,
          'Active Time': 60,
          'Speed To Answer': 100,
          'Time To First Response': 5,
          'Athlete Site': 'LAS',
          'After Conversation Work Actual Time': 15,
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
      forecastInputs: Object.freeze([
        Object.freeze({
          Date: '2026-08-17',
          Interval: '23:30',
          Site: 'PH',
          Type: 'Forecast',
          Value: 10,
        }),
        Object.freeze({
          Date: '2026-08-18',
          Interval: '00:00',
          Site: 'LAS',
          Type: 'Required',
          Value: 5,
        }),
      ]),
    }),
    expected: Object.freeze({
      aggInterval: Object.freeze([
        Object.freeze({
          Date: '2026-08-17',
          Interval: '23:30',
          Site: 'PH',
          Offered: 1,
          Handled: 1,
          'Chats in SL': 1,
          'SL TTC': 1,
          'AHT (Session)': 300,
          AHT: 150,
          ACW: 35,
          ASA: 75,
          Concurrency: 1.25,
        }),
        Object.freeze({
          Date: '2026-08-18',
          Interval: '00:00',
          Site: 'LAS',
          Offered: 1,
          Handled: 0,
          'Chats in SL': 0,
          'SL TTC': 0,
          'AHT (Session)': 90,
          AHT: 90,
          ACW: 15,
          ASA: 105,
          Concurrency: 1.5,
        }),
      ]),
      aggAllocation: Object.freeze([
        Object.freeze({
          Date: '2026-08-17',
          Interval: '23:30',
          Site: 'PH',
          BPO: 'BPO-A',
          'Offered Count': 1,
          'Allocation Share': 1,
        }),
        Object.freeze({
          Date: '2026-08-18',
          Interval: '00:00',
          Site: 'LAS',
          BPO: 'BPO-B',
          'Offered Count': 1,
          'Allocation Share': 1,
        }),
      ]),
    }),
  });

  function uatLog(tag, payload) {
    var line = 'CXP09_UAT ' + tag + ' ' + JSON.stringify(payload || {});
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
      throw new Error('Configured CXP-09 target spreadsheet ID is required.');
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

  function buildMatrix(datasetName, partials) {
    var schema = resolveSchemaRegistry().getSchema(datasetName);
    var headers = schema.requiredHeaders;
    var rows = partials.map(function (partial) {
      return mergeRow(headers, partial);
    });
    return { headers: headers, rows: rows };
  }

  function writeDataset(sheet, headers, rows, prefix) {
    uatLog(prefix + '.write.start', { sheet: sheet.getName(), rows: rows.length });
    sheet.clearContents();
    var values = [headers].concat(rows);
    sheet.getRange(1, 1, values.length, headers.length).setValues(values);
    uatLog(prefix + '.write.done', { sheet: sheet.getName(), rows: rows.length });
  }

  function calcTopologyReady(report, sheetName, expectedHeaders, minAnchors) {
    var entry = report.calc && report.calc[sheetName];
    if (!entry || !entry.present) {
      return false;
    }
    return entry.headerCountOk === true &&
      entry.formulaAnchorCountOk === true &&
      entry.formulaAnchorsPresent &&
      entry.formulaAnchorsPresent.length >= minAnchors;
  }

  function summarizeCalcTopology(report, sheetName) {
    var entry = report && report.calc && report.calc[sheetName];
    if (!entry) {
      return { present: false };
    }
    return {
      formulaAnchorCountOk: entry.formulaAnchorCountOk === true,
      formulaAnchorsMissing: entry.formulaAnchorsMissing || [],
      headerCountOk: entry.headerCountOk === true,
      present: entry.present === true,
    };
  }

  function verifyPrerequisites(spreadsheetId, options) {
    var throwOnFail = !options || options.throwOnFail !== false;
    var cxp07 = typeof Cxp07Setup !== 'undefined'
      ? Cxp07Setup.getStatus()
      : { status: 'UNKNOWN', nextStep: 0, stepCount: 27 };
    var cxp08 = typeof Cxp08Setup !== 'undefined'
      ? Cxp08Setup.getStatus()
      : { status: 'UNKNOWN', nextStep: 0, stepCount: 74 };
    var cxp07StateComplete =
      cxp07.status === 'COMPLETE' && cxp07.nextStep === cxp07.stepCount;
    var cxp08StateComplete =
      cxp08.status === 'COMPLETE' && cxp08.nextStep === cxp08.stepCount;

    var cxp07Topology = null;
    var cxp07TopologyReady = false;
    var cxp08TopologyReady = false;
    if (typeof diagnoseCxp07RunbookChecks === 'function') {
      cxp07Topology = diagnoseCxp07RunbookChecks(spreadsheetId);
      cxp07TopologyReady =
        calcTopologyReady(cxp07Topology, '_CALC_HANDLED', 30, 4) &&
        calcTopologyReady(cxp07Topology, '_CALC_OFFERED', 42, 16);
    }
    if (typeof diagnoseCxp08RunbookChecks === 'function') {
      var cxp08Topology = diagnoseCxp08RunbookChecks(spreadsheetId);
      var calc = cxp08Topology.calc || {};
      cxp08TopologyReady =
        calc._CALC_AHT && calc._CALC_AHT.present && calc._CALC_AHT.formulaAnchorCountOk &&
        calc._CALC_AUXES && calc._CALC_AUXES.present && calc._CALC_AUXES.formulaAnchorCountOk &&
        calc._CALC_STAFF && calc._CALC_STAFF.present && calc._CALC_STAFF.formulaAnchorCountOk;
    }

    var report = {
      cxp07Calc: {
        handled: summarizeCalcTopology(cxp07Topology, '_CALC_HANDLED'),
        offered: summarizeCalcTopology(cxp07Topology, '_CALC_OFFERED'),
      },
      cxp07Complete: cxp07StateComplete || cxp07TopologyReady,
      cxp07StateComplete: cxp07StateComplete,
      cxp07TopologyReady: cxp07TopologyReady,
      cxp07Status: cxp07.status,
      cxp07NextStep: cxp07.nextStep,
      cxp07StepCount: cxp07.stepCount,
      cxp08Complete: cxp08StateComplete || cxp08TopologyReady,
      cxp08StateComplete: cxp08StateComplete,
      cxp08TopologyReady: cxp08TopologyReady,
      cxp08Status: cxp08.status,
      cxp08NextStep: cxp08.nextStep,
      cxp08StepCount: cxp08.stepCount,
      environment: Config.load().environment,
      nextAction: null,
    };
    report.pass = report.cxp07Complete && report.cxp08Complete;
    if (!report.cxp07Complete) {
      report.nextAction = 'CXP09UatStep00InstallCxp07';
    } else if (!report.cxp08Complete) {
      report.nextAction = 'initializeCxp08AhtAuxesStaffTransformations';
    }
    uatLog('CXP09UatStep00.result', {
      pass: report.pass,
      cxp07Complete: report.cxp07Complete,
      cxp07StateComplete: report.cxp07StateComplete,
      cxp07TopologyReady: report.cxp07TopologyReady,
      cxp07Calc: report.cxp07Calc,
      cxp08Complete: report.cxp08Complete,
      cxp08StateComplete: report.cxp08StateComplete,
      cxp08TopologyReady: report.cxp08TopologyReady,
      nextAction: report.nextAction,
    });
    if (!report.pass && throwOnFail) {
      var hints = [];
      if (!report.cxp07Complete) {
        hints.push('run CXP09UatStep00InstallCxp07 (or initializeCxp07HandledOfferedTransformations until 27/27)');
      }
      if (!report.cxp08Complete) {
        hints.push('run initializeCxp08AhtAuxesStaffTransformations until 74/74');
      }
      throw new Error(
        'CXP-09 prerequisites not met. ' + hints.join('; ') + '.',
      );
    }
    return report;
  }

  function installCxp07Prerequisite() {
    uatLog('CXP09UatStep00.installCxp07.start', {});
    if (typeof initializeCxp07HandledOfferedTransformations !== 'function') {
      throw new Error('initializeCxp07HandledOfferedTransformations is not available.');
    }
    var result = initializeCxp07HandledOfferedTransformations();
    uatLog('CXP09UatStep00.installCxp07.done', {
      continuationScheduled: result.continuationScheduled,
      lastCompletedStep: result.lastCompletedStep || null,
      nextStep: result.nextStep,
      status: result.status,
      stepCount: result.stepCount,
    });
    return Object.freeze({
      install: result,
      verify: verifyPrerequisites(null, { throwOnFail: false }),
    });
  }

  // Convert fixture ISO dates to Google Sheets serial numbers (1899-12-30 epoch)
  // so _AGG_FORECAST Date cells match how operator .xlsx sources display in Sheets.
  function excelSerialFromIsoDateOnly(isoDate) {
    var parts = String(isoDate).slice(0, 10).split('-').map(Number);
    var utc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    return (utc - Date.UTC(1899, 11, 30)) / 86400000;
  }

  // Seeds _AGG_FORECAST manual-input rows from the embedded parity fixture.
  // Not a public editor entrypoint — invoked only by loadParityFixture / RunParity.
  // Clears A2:E{capacity}, then writes Date (serial), Interval, Site, Type, Value.
  function writeForecastInputs(spreadsheetId, forecastInputs) {
    var prefix = 'CXP09UatStep03.forecast';
    var ss = openTarget(spreadsheetId);
    var sheet = requireSheet(ss, '_AGG_FORECAST');
    var inputs = forecastInputs || FIXTURE.inputs.forecastInputs;
    var rowCapacity = typeof StableAggregationFormulaCatalog !== 'undefined'
      ? StableAggregationFormulaCatalog.ROW_CAPACITY
      : 50;
    sheet.getRange(2, 1, rowCapacity, FORECAST_HEADERS.length).clearContent();
    if (!inputs || inputs.length === 0) {
      uatLog(prefix + '.write.done', { rows: 0 });
      return Object.freeze({ rows: 0 });
    }
    var rows = inputs.map(function (row) {
      return [
        excelSerialFromIsoDateOnly(row.Date),
        row.Interval,
        row.Site,
        row.Type,
        row.Value,
      ];
    });
    sheet.getRange(2, 1, rows.length, FORECAST_HEADERS.length).setValues(rows);
    uatLog(prefix + '.write.done', { rows: rows.length });
    return Object.freeze({ rows: rows.length });
  }

  function loadParityFixture(spreadsheetId) {
    var prefix = 'CXP09UatStep03';
    var ss = openTarget(spreadsheetId);
    var handled = buildMatrix('Handled', FIXTURE.inputs.handledRows);
    var offered = buildMatrix('Offered', FIXTURE.inputs.offeredRows);
    var aht = buildMatrix('AHT - Raw', FIXTURE.inputs.ahtRows);
    var auxes = buildMatrix('Auxes - Raw', FIXTURE.inputs.auxesRows);
    var staff = buildMatrix('Staff', FIXTURE.inputs.staffRows);
    writeDataset(requireSheet(ss, '_RAW_HANDLED'), handled.headers, handled.rows, prefix + '.handled');
    writeDataset(requireSheet(ss, '_RAW_OFFERED'), offered.headers, offered.rows, prefix + '.offered');
    writeDataset(requireSheet(ss, '_RAW_AHT'), aht.headers, aht.rows, prefix + '.aht');
    writeDataset(requireSheet(ss, '_RAW_AUXES'), auxes.headers, auxes.rows, prefix + '.auxes');
    writeDataset(requireSheet(ss, '_RAW_STAFF'), staff.headers, staff.rows, prefix + '.staff');
    requireSheet(ss, '_CALC_STAFF').getRange(1, 57).setValue(
      excelSerialFromIsoDateOnly(FIXTURE.businessDay),
    );
    // Forecast inputs are part of the parity bundle, not a separate UAT step.
    writeForecastInputs(spreadsheetId, FIXTURE.inputs.forecastInputs);
    SpreadsheetApp.flush();
    return Object.freeze({
      ahtRows: aht.rows.length,
      auxesRows: auxes.rows.length,
      handledRows: handled.rows.length,
      offeredRows: offered.rows.length,
      staffRows: staff.rows.length,
      businessDay: FIXTURE.businessDay,
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
      return text;
    }
    if (header === 'Interval') {
      if (isDateObject(rawValue) && typeof Utilities !== 'undefined') {
        return Utilities.formatDate(rawValue, 'Etc/GMT+8', 'HH:mm');
      }
      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        var minutes = Math.round(((rawValue % 1) + 1) % 1 * 24 * 60);
        return pad2(Math.floor(minutes / 60) % 24) + ':' + pad2(minutes % 60);
      }
      var display = String(displayValue || '').trim();
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

  function readAggBlock(sheet, headers, maxRows) {
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
      return row.Date !== '' && row.Date !== null && row.Date !== undefined;
    });
  }

  function grainKey(row) {
    return String(row.Date) + '\u001d' + String(row.Interval) + '\u001d' + String(row.Site);
  }

  function allocationKey(row) {
    return grainKey(row) + '\u001d' + String(row.BPO);
  }

  function compareKeyedRows(actualRows, expectedRows, headers, keyFn) {
    var actualByKey = Object.create(null);
    actualRows.forEach(function (row) {
      actualByKey[keyFn(row)] = row;
    });
    var diffs = [];
    expectedRows.forEach(function (expected) {
      var key = keyFn(expected);
      var actual = actualByKey[key] || {};
      headers.forEach(function (header) {
        var left = actual[header] === undefined ? '' : actual[header];
        var right = expected[header] === undefined ? '' : expected[header];
        if (left !== right) {
          diffs.push({
            key: key,
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
    var prefix = 'CXP09UatStep04';
    var ss = openTarget(spreadsheetId);
    SpreadsheetApp.flush();
    var intervalActual = readAggBlock(
      requireSheet(ss, '_AGG_INTERVAL'),
      INTERVAL_HEADERS,
      20,
    );
    var allocationActual = readAggBlock(
      requireSheet(ss, '_AGG_ALLOCATION'),
      ALLOCATION_HEADERS,
      20,
    );
    var intervalDiffs = compareKeyedRows(
      intervalActual,
      FIXTURE.expected.aggInterval,
      INTERVAL_HEADERS,
      grainKey,
    );
    var allocationDiffs = compareKeyedRows(
      allocationActual,
      FIXTURE.expected.aggAllocation,
      ALLOCATION_HEADERS,
      allocationKey,
    );
    var report = {
      pass: intervalDiffs.length === 0 && allocationDiffs.length === 0,
      intervalDiffCount: intervalDiffs.length,
      allocationDiffCount: allocationDiffs.length,
      intervalDiffs: intervalDiffs.slice(0, 10),
      allocationDiffs: allocationDiffs.slice(0, 10),
      timezoneCheck: {
        row0: 'UTC 07:45 -> prior fixed-PST date 2026-08-17 @ 23:30 (PH)',
        row1: 'UTC 08:05 -> same UTC date 2026-08-18 @ 00:00 (LAS)',
      },
    };
    uatLog(prefix + '.result', {
      pass: report.pass,
      intervalDiffCount: report.intervalDiffCount,
      allocationDiffCount: report.allocationDiffCount,
      intervalDiffs: report.intervalDiffs,
      allocationDiffs: report.allocationDiffs,
    });
    return report;
  }

  function runParityStep(spreadsheetId) {
    var load = loadParityFixture(spreadsheetId);
    if (typeof Utilities !== 'undefined' && typeof Utilities.sleep === 'function') {
      Utilities.sleep(3000);
    }
    SpreadsheetApp.flush();
    var compare = recordParityOutputs(spreadsheetId);
    return Object.freeze({
      load: load,
      compare: compare,
      pass: compare.pass,
    });
  }

  function inspectTopology(spreadsheetId) {
    return diagnoseCxp09RunbookChecks(spreadsheetId);
  }

  // Baselines from CXP-08 hosted peak sign-off (target B, 2026-08-28).
  var CXP08_PEAK_BASELINE = Object.freeze({
    ahtLastRow: 15001,
    auxesLastRow: 7501,
    staffLastRow: 1997,
    elapsedMsClass: 67,
  });

  function peakFlushTiming(spreadsheetId) {
    var ss = openTarget(spreadsheetId);
    var started = Date.now();
    SpreadsheetApp.flush();
    var elapsedMs = Date.now() - started;
    var report = {
      cxp08PeakBaseline: CXP08_PEAK_BASELINE,
      elapsedMs: elapsedMs,
      intervalLastRow: requireSheet(ss, '_AGG_INTERVAL').getLastRow(),
      forecastLastRow: requireSheet(ss, '_AGG_FORECAST').getLastRow(),
      allocationLastRow: requireSheet(ss, '_AGG_ALLOCATION').getLastRow(),
      calcOfferedLastRow: requireSheet(ss, '_CALC_OFFERED').getLastRow(),
      calcAhtLastRow: requireSheet(ss, '_CALC_AHT').getLastRow(),
      calcAuxesLastRow: requireSheet(ss, '_CALC_AUXES').getLastRow(),
      calcStaffLastRow: requireSheet(ss, '_CALC_STAFF').getLastRow(),
      executionOutcome: 'SUCCESS',
      peakTargetMatch:
        requireSheet(ss, '_CALC_AHT').getLastRow() >= CXP08_PEAK_BASELINE.ahtLastRow - 1,
    };
    uatLog('CXP09UatStep05.result', report);
    return report;
  }

  function secondBundleRefresh(spreadsheetId) {
    var prefix = 'CXP09UatStep06';
    var ss = openTarget(spreadsheetId);
    var handled = buildMatrix('Handled', [
      Object.assign({}, FIXTURE.inputs.handledRows[0], {
        'Case: Case Number': 'C-REFRESH',
        'Messaging Session Name': 'SESSION-REFRESH',
      }),
    ]);
    var offered = buildMatrix('Offered', [
      Object.assign({}, FIXTURE.inputs.offeredRows[0], {
        'Case: Case Number': 'C-REFRESH',
        'Messaging Session Name': 'SESSION-REFRESH',
        'Initial Athlete BPO': 'BPO-REFRESH',
      }),
    ]);
    var aht = buildMatrix('AHT - Raw', [
      Object.assign({}, FIXTURE.inputs.ahtRows[0], {
        'Work Item: Name': 'SESSION-REFRESH',
        'Handle Time': 40,
        'Active Time': 20,
      }),
    ]);
    writeDataset(requireSheet(ss, '_RAW_HANDLED'), handled.headers, handled.rows, prefix + '.handled');
    writeDataset(requireSheet(ss, '_RAW_OFFERED'), offered.headers, offered.rows, prefix + '.offered');
    writeDataset(requireSheet(ss, '_RAW_AHT'), aht.headers, aht.rows, prefix + '.aht');
    SpreadsheetApp.flush();
    return Object.freeze({
      ahtRows: aht.rows.length,
      handledRows: handled.rows.length,
      offeredRows: offered.rows.length,
    });
  }

  function promotionGate(spreadsheetId) {
    var status = Cxp09Setup.getStatus();
    var topology = inspectTopology(spreadsheetId);
    var aggSheets = ['_AGG_INTERVAL', '_AGG_FORECAST', '_AGG_ALLOCATION'];
    var checks = aggSheets.map(function (sheetName) {
      var entry = topology.aggregation[sheetName] || { present: false };
      return {
        sheetName: sheetName,
        present: entry.present === true,
        headerCountOk: entry.headerCountOk === true,
        formulaAnchorCountOk: entry.formulaAnchorCountOk === true,
      };
    });
    var report = {
      checks: checks,
      installComplete: status.status === 'COMPLETE' && status.nextStep === status.stepCount,
      promotionReady: status.status === 'COMPLETE' &&
        checks.every(function (check) {
          return check.present && check.headerCountOk && check.formulaAnchorCountOk;
        }),
      status: status,
    };
    uatLog('CXP09UatStep08.result', {
      pass: report.promotionReady,
      installComplete: report.installComplete,
    });
    return report;
  }

  return Object.freeze({
    FIXTURE: FIXTURE,
    installCxp07Prerequisite: installCxp07Prerequisite,
    inspectTopology: inspectTopology,
    loadParityFixture: loadParityFixture,
    peakFlushTiming: peakFlushTiming,
    promotionGate: promotionGate,
    recordParityOutputs: recordParityOutputs,
    runParityStep: runParityStep,
    secondBundleRefresh: secondBundleRefresh,
    verifyPrerequisites: verifyPrerequisites,
  });
})();

function CXP09UatStep00VerifyPrerequisites() {
  return Cxp09ParityUat.verifyPrerequisites();
}

function CXP09UatStep00InstallCxp07() {
  return Cxp09ParityUat.installCxp07Prerequisite();
}

function CXP09UatStep01Install() {
  return initializeCxp09StableAggregationModel();
}

function CXP09UatStep02InspectTopology() {
  return Cxp09ParityUat.inspectTopology();
}

function CXP09UatStep03LoadParityFixture() {
  return Cxp09ParityUat.loadParityFixture();
}

function CXP09UatStep03RunParity() {
  return Cxp09ParityUat.runParityStep();
}

function CXP09UatStep04RecordParityOutputs() {
  return Cxp09ParityUat.recordParityOutputs();
}

function CXP09UatStep05PeakFlushTiming() {
  return Cxp09ParityUat.peakFlushTiming();
}

function CXP09UatStep06SecondBundleRefresh() {
  return Cxp09ParityUat.secondBundleRefresh();
}

function CXP09UatStep07ReinstallTopology() {
  return initializeCxp09StableAggregationModel();
}

function CXP09UatStep08PromotionGate() {
  return Cxp09ParityUat.promotionGate();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp09ParityUat;
}
