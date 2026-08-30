/**
 * CXP-10 hosted UAT helpers for docs/cxp10-uat-runbook.md.
 *
 * Editor entrypoints (parameterless):
 *   CXP10UatStep01Install
 *   CXP10UatStep02InspectTopology
 *   CXP10UatStep03LoadParityFixture
 *   CXP10UatStep03RunParity
 *   CXP10UatStep04RecordParityOutputs
 *   CXP10UatStep05WeeklyRollover
 *   CXP10UatStep06SecondBundleRefresh
 *   CXP10UatStep07ReinstallTopology
 *   CXP10UatStep08PromotionGate
 */

var Cxp10ParityUat = (function () {
  'use strict';

  // Mirror of tests/fixtures/cxp10/report-parity.json (embedded for Apps Script).
  var FIXTURE = Object.freeze({
    businessDay: '2026-08-18',
    weekStart: '2026-08-17',
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
        Interval: '04:00',
        Site: 'LAS',
        Type: 'Required',
        Value: 5,
      }),
    ]),
    expected: Object.freeze({
      intervalView: Object.freeze([
        Object.freeze({
          Date: '2026-08-17',
          Interval: '23:30',
          Forecast: 10,
          Offered: 1,
          Handled: 1,
          'Chats in SL': 1,
          Abandoned: 0,
          'SL % Total': 1,
          'SL (Time To Connect)': 1,
          '% of Forecast Offered': 0.1,
          '% of Forecast Handled': 0.1,
          Allocation: 1,
          'Cumulative Allocation': 1,
          'AHT (Session)': 4.761904761904762,
          AHT: 150,
          ACW: 35,
          'ASA in Seconds': 75,
          Concurrency: 1.25,
          Scheduled: '',
          Required: '',
          'Actual (SO)': '',
          'Actual vs Required': '',
          'Scheduled Hours': '',
          'Required Hours': '',
          Actual: '',
          'Actual to Required': '',
          'Scheduled to Required': '',
        }),
        Object.freeze({
          Date: '2026-08-18',
          Interval: '04:00',
          Forecast: 0,
          Offered: 1,
          Handled: 0,
          'Chats in SL': 0,
          Abandoned: 1,
          'SL % Total': 0,
          'SL (Time To Connect)': 0,
          '% of Forecast Offered': 1,
          '% of Forecast Handled': ' ',
          Allocation: 1,
          'Cumulative Allocation': 1,
          'AHT (Session)': 1.4285714285714286,
          AHT: 90,
          ACW: 15,
          'ASA in Seconds': 105,
          Concurrency: 1.5,
          Scheduled: '',
          Required: 5,
          'Actual (SO)': '',
          'Actual vs Required': -5,
          'Scheduled Hours': '',
          'Required Hours': 0.10416666666666667,
          Actual: '',
          'Actual to Required': '',
          'Scheduled to Required': 0,
        }),
      ]),
    }),
  });

  function uatLog(tag, payload) {
    var line = 'CXP10_UAT ' + tag + ' ' + JSON.stringify(payload || {});
    if (typeof console !== 'undefined' && typeof console.log === 'function') {
      console.log(line);
    }
    if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
      Logger.log(line);
    }
  }

  function resolveCatalog() {
    if (typeof ReportingSurfaceFormulaCatalog !== 'undefined') {
      return ReportingSurfaceFormulaCatalog;
    }
    throw new Error('ReportingSurfaceFormulaCatalog is required.');
  }

  function resolveBusinessContextService() {
    if (typeof BusinessContextService !== 'undefined') {
      return BusinessContextService;
    }
    return require('../services/BusinessContextService.js');
  }

  function resolveMetricOrder() {
    if (typeof ReportingSurfaceReferenceModel !== 'undefined') {
      return ReportingSurfaceReferenceModel.METRIC_ORDER;
    }
    return resolveCatalog().METRIC_HEADERS.slice();
  }

  function resolveCxp09ParityUat() {
    if (typeof Cxp09ParityUat !== 'undefined') {
      return Cxp09ParityUat;
    }
    throw new Error('Cxp09ParityUat is required to seed aggregation inputs.');
  }

  function openTarget(spreadsheetId) {
    var id = spreadsheetId;
    if (!id || typeof id !== 'string') {
      id = Config.load().targetSpreadsheetId;
    }
    if (!id) {
      throw new Error('Configured CXP-10 target spreadsheet ID is required.');
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

  function addDaysToIsoDate(isoDate, days) {
    var parts = String(isoDate).slice(0, 10).split('-').map(Number);
    var utc = Date.UTC(parts[0], parts[1] - 1, parts[2] + days);
    var date = new Date(utc);
    return date.getUTCFullYear() +
      '-' + String(date.getUTCMonth() + 1).padStart(2, '0') +
      '-' + String(date.getUTCDate()).padStart(2, '0');
  }

  function daysBetweenIsoDates(startIso, endIso) {
    var startParts = String(startIso).slice(0, 10).split('-').map(Number);
    var endParts = String(endIso).slice(0, 10).split('-').map(Number);
    var startUtc = Date.UTC(startParts[0], startParts[1] - 1, startParts[2]);
    var endUtc = Date.UTC(endParts[0], endParts[1] - 1, endParts[2]);
    return Math.round((endUtc - startUtc) / 86400000);
  }

  function intervalLabelToMomRow(intervalLabel) {
    var catalog = resolveCatalog();
    var text = String(intervalLabel || '').trim();
    var match = text.match(/^(\d{1,2}):(\d{2})/);
    if (!match) {
      throw new Error('MOM calendar write requires HH:MM interval labels.');
    }
    var hours = Number(match[1]);
    var minutes = Number(match[2]);
    var slot = (hours * 60 + minutes) / 30;
    if (!Number.isInteger(slot) || slot < 0 || slot >= catalog.MOM_TIME_COUNT) {
      throw new Error('MOM calendar interval is outside 00:00–23:30: ' + text);
    }
    return catalog.MOM_FIRST_TIME_ROW + slot;
  }

  function findMomInputBlock(site, type) {
    var blocks = resolveCatalog().momSpec().inputBlocks;
    var index;
    for (index = 0; index < blocks.length; index += 1) {
      if (blocks[index].site === site && blocks[index].type === type) {
        return blocks[index];
      }
    }
    return null;
  }

  function clearMomInputGrids(sheet, mom) {
    mom.inputBlocks.forEach(function (block) {
      sheet.getRange(
        mom.firstTimeRow,
        block.valueStartColumn,
        mom.timeCount,
        7,
      ).clearContent();
    });
  }

  function writeMomCalendarInputs(spreadsheetId, forecastInputs, weekStartIso) {
    var catalog = resolveCatalog();
    var mom = catalog.momSpec();
    var ss = openTarget(spreadsheetId);
    var sheet = requireSheet(ss, 'MOM');
    var inputs = forecastInputs || FIXTURE.forecastInputs;
    var weekStart = weekStartIso || FIXTURE.weekStart;
    clearMomInputGrids(sheet, mom);
    if (!inputs || inputs.length === 0) {
      uatLog('CXP10UatStep03.mom.write.done', { cells: 0, rows: 0 });
      return Object.freeze({ cells: 0, rows: 0 });
    }
    var written = 0;
    inputs.forEach(function (row) {
      var block = findMomInputBlock(row.Site, row.Type);
      if (!block) {
        throw new Error(
          'MOM calendar has no input block for Site=' + row.Site + ' Type=' + row.Type + '.',
        );
      }
      var dayOffset = daysBetweenIsoDates(weekStart, row.Date);
      if (dayOffset < 0 || dayOffset > 6) {
        throw new Error(
          'MOM calendar input date is outside the week starting ' + weekStart + ': ' + row.Date,
        );
      }
      var targetRow = intervalLabelToMomRow(row.Interval);
      var targetColumn = block.valueStartColumn + dayOffset;
      sheet.getRange(targetRow, targetColumn).setValue(row.Value);
      written += 1;
    });
    uatLog('CXP10UatStep03.mom.write.done', { cells: written, rows: written });
    return Object.freeze({ cells: written, rows: written });
  }

  // Alias kept for older UAT call sites / tests.
  function writeMomStaging(spreadsheetId, forecastInputs) {
    return writeMomCalendarInputs(spreadsheetId, forecastInputs, FIXTURE.weekStart);
  }

  function setReportAnchors(spreadsheetId, businessDayIso, weekStartIso) {
    var ss = openTarget(spreadsheetId);
    var service = resolveBusinessContextService();
    var resolved = service.resolve({ businessDay: businessDayIso });
    if (weekStartIso !== undefined && weekStartIso !== resolved.weekStart) {
      var mismatch = new Error('weekStart must equal the Monday derived from businessDay.');
      mismatch.code = service.ERROR_CODES.invalid;
      throw mismatch;
    }
    var result = service.write(ss, { businessDay: businessDayIso });
    uatLog('CXP10UatStep03.anchors', result);
    return result;
  }

  function loadParityFixture(spreadsheetId) {
    var prefix = 'CXP10UatStep03';
    uatLog(prefix + '.start', { businessDay: FIXTURE.businessDay });
    var aggregation = resolveCxp09ParityUat().loadParityFixture(spreadsheetId);
    var mom = writeMomCalendarInputs(
      spreadsheetId,
      FIXTURE.forecastInputs,
      FIXTURE.weekStart,
    );
    var anchors = setReportAnchors(
      spreadsheetId,
      FIXTURE.businessDay,
      FIXTURE.weekStart,
    );
    SpreadsheetApp.flush();
    var result = Object.freeze({
      aggregation: aggregation,
      anchors: anchors,
      momRows: mom.rows,
      businessDay: FIXTURE.businessDay,
      weekStart: FIXTURE.weekStart,
    });
    uatLog(prefix + '.done', {
      momRows: mom.rows,
      handledRows: aggregation.handledRows,
      offeredRows: aggregation.offeredRows,
      weekStart: anchors.weekStart,
      businessDay: anchors.businessDay,
    });
    return result;
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
      // Prefer serial/UTC calendar math over formatDate — Sheets date-only values
      // as Date objects can shift a day under Etc/GMT+8.
      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        var fromSerial = sheetsSerialToDateParts(rawValue);
        if (fromSerial) {
          return fromSerial.yyyyMmDd;
        }
      }
      if (isDateObject(rawValue)) {
        return rawValue.getFullYear() +
          '-' + pad2(rawValue.getMonth() + 1) +
          '-' + pad2(rawValue.getDate());
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
      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        var minutes = Math.round(((rawValue % 1) + 1) % 1 * 24 * 60);
        return pad2(Math.floor(minutes / 60) % 24) + ':' + pad2(minutes % 60);
      }
      if (isDateObject(rawValue)) {
        return pad2(rawValue.getHours()) + ':' + pad2(rawValue.getMinutes());
      }
      var display = String(displayValue || '').trim();
      var timeMatch = display.match(/(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        return pad2(timeMatch[1]) + ':' + timeMatch[2];
      }
      return display;
    }
    if (
      (header === 'Scheduled Hours' || header === 'Required Hours' || header === 'Actual') &&
      isDateObject(rawValue)
    ) {
      var durationText = String(displayValue || '').trim();
      var durationMatch = durationText.match(/^(-)?(\d+):([0-5]\d)(?::([0-5]\d(?:\.\d+)?))?$/);
      if (durationMatch) {
        var durationSeconds = Number(durationMatch[2]) * 3600 +
          Number(durationMatch[3]) * 60 + Number(durationMatch[4] || 0);
        return (durationMatch[1] ? -1 : 1) * durationSeconds / 86400;
      }
    }
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return rawValue;
    }
    if (displayValue === ' ') {
      return ' ';
    }
    var asText = String(displayValue === undefined || displayValue === null
      ? (rawValue || '')
      : displayValue).trim();
    if (asText !== '' && /^-?\d+(\.\d+)?$/.test(asText)) {
      return Number(asText);
    }
    return asText;
  }

  function readIntervalViewBlock(sheet, catalog, metricOrder, businessDayIso) {
    var firstRow = catalog.FIRST_DATA_ROW;
    var rowCount = catalog.LAST_DATA_ROW - firstRow + 1;
    var columnCount = catalog.METRIC_COLUMNS['Scheduled to Required'];
    var range = sheet.getRange(firstRow, 3, rowCount, columnCount - 2);
    var displayValues = range.getDisplayValues();
    var rawValues = range.getValues();
    return displayValues.map(function (row, rowIndex) {
      var pstRaw = rawValues[rowIndex][0];
      var pstDisplay = row[0];
      var intervalRaw = pstRaw;
      var out = {
        Date: businessDayIso,
        Interval: normalizeField('Interval', intervalRaw, pstDisplay),
      };
      metricOrder.forEach(function (header, index) {
        var columnIndex = 1 + index;
        out[header] = normalizeField(
          header,
          rawValues[rowIndex][columnIndex],
          row[columnIndex],
        );
      });
      return out;
    }).filter(function (row) {
      return row.Interval !== '' && row.Interval !== null && row.Interval !== undefined;
    });
  }

  function grainKey(row) {
    return String(row.Date) + '\u001d' + String(row.Interval);
  }

  // Control axis: 38 half-hours from 04:00 through 22:30.
  function buildAxisGrainKeys(businessDayIso) {
    var catalog = resolveCatalog();
    var keys = [];
    var index;
    var startMinutes = catalog.AXIS_START_HOUR * 60;
    for (index = 0; index < catalog.INTERVAL_COUNT; index += 1) {
      var totalMinutes = startMinutes + index * 30;
      var dayAdd = Math.floor(totalMinutes / 1440);
      var minuteOfDay = totalMinutes % 1440;
      keys.push(
        addDaysToIsoDate(businessDayIso, dayAdd) +
          '\u001d' +
          pad2(Math.floor(minuteOfDay / 60)) +
          ':' +
          pad2(minuteOfDay % 60),
      );
    }
    return Object.freeze(keys);
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
    var prefix = 'CXP10UatStep04';
    var catalog = resolveCatalog();
    var metricOrder = resolveMetricOrder();
    var compareHeaders = ['Date', 'Interval'].concat(metricOrder.slice());
    var ss = openTarget(spreadsheetId);
    SpreadsheetApp.flush();
    var actualRows = readIntervalViewBlock(
      requireSheet(ss, 'Interval View'),
      catalog,
      metricOrder,
      FIXTURE.businessDay,
    );
    // Fixture prior-day 23:30 is off this page; business-day 04:00 is on-axis.
    var axisKeySet = Object.create(null);
    buildAxisGrainKeys(FIXTURE.businessDay).forEach(function (key) {
      axisKeySet[key] = true;
    });
    var expectedOnAxis = FIXTURE.expected.intervalView.filter(function (row) {
      return axisKeySet[grainKey(row)] === true;
    });
    var diffs = compareKeyedRows(
      actualRows,
      expectedOnAxis,
      compareHeaders,
      grainKey,
    );
    var sampleActualKeys = actualRows.slice(0, 5).map(grainKey);
    var axisComplete = actualRows.length === catalog.INTERVAL_COUNT;
    var report = Object.freeze({
      pass: diffs.length === 0 && expectedOnAxis.length > 0 && axisComplete,
      diffCount: diffs.length,
      diffs: diffs.slice(0, 15),
      expectedOnAxisCount: expectedOnAxis.length,
      rowsRead: actualRows.length,
      sampleActualKeys: sampleActualKeys,
      contractNotes: Object.freeze({
        handledZeroBlank: 'rows ' + catalog.HANDLED_BLANK_FROM_ROW +
          '-' + catalog.LAST_DATA_ROW + ' blank Handled on zero',
        ahtSessionDivisor: 'interval /63 vs summary /60',
        scheduledToRequiredSummary: 'AB151 uses IFERROR guard',
        axisWindow: 'Interval View AA2 date + 38 half-hours from 04:00 through 22:30',
      }),
    });
    uatLog(prefix + '.result', {
      pass: report.pass,
      diffCount: report.diffCount,
      diffs: report.diffs,
      expectedOnAxisCount: report.expectedOnAxisCount,
      rowsRead: report.rowsRead,
      sampleActualKeys: report.sampleActualKeys,
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

  function weeklyRollover(spreadsheetId) {
    var prefix = 'CXP10UatStep05';
    var ss = openTarget(spreadsheetId);
    var service = resolveBusinessContextService();
    var before = service.read(ss);
    if (!before.pass) {
      var invalid = new Error('Business context anchors are invalid.');
      invalid.code = service.ERROR_CODES.anchorInvalid;
      invalid.details = { invalidAnchors: before.invalidAnchors };
      throw invalid;
    }
    var after = service.write(ss, {
      businessDay: service.addDays(before.context.businessDay, 7),
      staffDay: service.addDays(before.context.staffDay, 7),
    });
    SpreadsheetApp.flush();
    var report = Object.freeze({
      intervalView: Object.freeze({
        after: after.businessDay,
        before: before.context.businessDay,
      }),
      mom: Object.freeze({
        after: after.weekStart,
        before: before.context.weekStart,
      }),
      staff: Object.freeze({
        after: after.staffDay,
        before: before.context.staffDay,
      }),
    });
    uatLog(prefix + '.result', report);
    return report;
  }

  function secondBundleRefresh(spreadsheetId) {
    var prefix = 'CXP10UatStep06';
    var refresh = resolveCxp09ParityUat().secondBundleRefresh(spreadsheetId);
    SpreadsheetApp.flush();
    uatLog(prefix + '.done', refresh);
    return Object.freeze({ refresh: refresh });
  }

  function reinstallTopology(spreadsheetId) {
    uatLog('CXP10UatStep07.start', {});
    if (typeof initializeCxp10ReportingSurfaces !== 'function') {
      throw new Error('initializeCxp10ReportingSurfaces is not available.');
    }
    var result = initializeCxp10ReportingSurfaces();
    uatLog('CXP10UatStep07.done', {
      status: result.status,
      nextStep: result.nextStep,
      stepCount: result.stepCount,
    });
    return result;
  }

  function promotionGate(spreadsheetId) {
    var status = typeof getCxp10ReportingSurfaceStatus === 'function'
      ? getCxp10ReportingSurfaceStatus()
      : Cxp10Setup.getStatus();
    var topology = typeof diagnoseCxp10RunbookChecks === 'function'
      ? diagnoseCxp10RunbookChecks(spreadsheetId)
      : { intervalView: {}, mom: {}, forecastBridge: {} };
    var parity;
    var actualContext = topology.businessContext && topology.businessContext.context;
    var fixtureContextMatches = actualContext &&
      actualContext.businessDay === FIXTURE.businessDay &&
      actualContext.weekStart === FIXTURE.weekStart &&
      actualContext.staffDay === FIXTURE.businessDay;
    if (topology.rootError) {
      parity = Object.freeze({
        pass: false,
        skipped: true,
        reason: 'INVALID_BUSINESS_CONTEXT',
      });
    } else if (!fixtureContextMatches) {
      parity = Object.freeze({
        pass: false,
        skipped: true,
        reason: 'FIXTURE_CONTEXT_MISMATCH',
        expectedContext: Object.freeze({
          businessDay: FIXTURE.businessDay,
          weekStart: FIXTURE.weekStart,
          staffDay: FIXTURE.businessDay,
        }),
        actualContext: actualContext || null,
      });
    } else {
      try {
        parity = recordParityOutputs(spreadsheetId);
      } catch (parityError) {
        parity = Object.freeze({
          error: parityError && parityError.message ? parityError.message : String(parityError),
          pass: false,
        });
      }
    }
    var intervalReady = topology.intervalView &&
      topology.intervalView.present === true &&
      topology.intervalView.headerCountOk === true &&
      topology.intervalView.metricAnchorCountOk === true &&
      topology.intervalView.pstHeaderOk === true &&
      topology.intervalView.remarksHeaderOk === true &&
      topology.intervalView.timeAxisFormulaOk === true &&
      topology.intervalView.axisComplete === true &&
      topology.intervalView.layoutContractOk === true &&
      topology.intervalView.totalFormulasComplete === true &&
      topology.intervalView.formulaErrorCount === 0 &&
      topology.intervalView.legacyBackendReferenceDetected !== true;
    var momReady = topology.mom &&
      topology.mom.present === true &&
      topology.mom.titleMnlOk === true &&
      topology.mom.sectionLabelOk === true &&
      topology.mom.timeAxisFormulaOk === true;
    var forecastBridgeReady = topology.forecastBridge &&
      topology.forecastBridge.present === true &&
      topology.forecastBridge.bridgeFormulaPresent === true &&
      topology.forecastBridge.momReferenceDetected === true;
    var installComplete = status.status === 'COMPLETE' && status.nextStep === status.stepCount;
    return Object.freeze({
      forecastBridgeReady: forecastBridgeReady,
      installComplete: installComplete,
      intervalViewReady: intervalReady,
      momReady: momReady,
      parity: parity,
      rootError: topology.rootError || null,
      promotionReady: installComplete && intervalReady && momReady &&
        forecastBridgeReady && parity.pass === true,
      status: status,
      topology: topology,
    });
  }

  return Object.freeze({
    FIXTURE: FIXTURE,
    loadParityFixture: loadParityFixture,
    promotionGate: promotionGate,
    recordParityOutputs: recordParityOutputs,
    reinstallTopology: reinstallTopology,
    runParityStep: runParityStep,
    secondBundleRefresh: secondBundleRefresh,
    setReportAnchors: setReportAnchors,
    weeklyRollover: weeklyRollover,
    writeMomCalendarInputs: writeMomCalendarInputs,
    writeMomStaging: writeMomStaging,
  });
})();

function CXP10UatStep01Install() {
  return initializeCxp10ReportingSurfaces();
}

function CXP10UatStep02InspectTopology() {
  return diagnoseCxp10RunbookChecks();
}

function CXP10UatStep03LoadParityFixture() {
  return Cxp10ParityUat.loadParityFixture();
}

function CXP10UatStep03RunParity() {
  return Cxp10ParityUat.runParityStep();
}

function CXP10UatStep04RecordParityOutputs() {
  return Cxp10ParityUat.recordParityOutputs();
}

function CXP10UatStep05WeeklyRollover() {
  return Cxp10ParityUat.weeklyRollover();
}

function CXP10UatStep06SecondBundleRefresh() {
  return Cxp10ParityUat.secondBundleRefresh();
}

function CXP10UatStep07ReinstallTopology() {
  return Cxp10ParityUat.reinstallTopology();
}

function CXP10UatStep08PromotionGate() {
  return Cxp10ParityUat.promotionGate();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Cxp10ParityUat;
}
