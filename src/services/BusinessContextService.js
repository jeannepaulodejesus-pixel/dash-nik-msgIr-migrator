var BusinessContextService = (function () {
  'use strict';

  var ERROR_CODES = Object.freeze({
    invalid: 'BUSINESS_CONTEXT_INVALID',
    anchorInvalid: 'BUSINESS_CONTEXT_ANCHOR_INVALID',
    writeFailed: 'BUSINESS_CONTEXT_WRITE_FAILED',
  });
  var SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);
  var DAY_MS = 86400000;
  var ANCHORS = Object.freeze({
    businessDay: Object.freeze({ sheetName: 'Interval View', row: 2, column: 27, cell: 'AA2' }),
    weekStart: Object.freeze({ sheetName: 'MOM', row: 3, column: 2, cell: 'B3' }),
    staffDay: Object.freeze({ sheetName: '_CALC_STAFF', row: 1, column: 57, cell: 'BE1' }),
  });

  function createError(code, message, details) {
    var error = new Error(message);
    error.code = code;
    error.details = details || null;
    return error;
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function parseIsoDateOnly(value, fieldName) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw createError(
        ERROR_CODES.invalid,
        fieldName + ' must be a valid YYYY-MM-DD date.',
        { field: fieldName },
      );
    }
    var parts = value.split('-').map(Number);
    var utc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    var date = new Date(utc);
    if (
      date.getUTCFullYear() !== parts[0] ||
      date.getUTCMonth() !== parts[1] - 1 ||
      date.getUTCDate() !== parts[2]
    ) {
      throw createError(
        ERROR_CODES.invalid,
        fieldName + ' must be a valid YYYY-MM-DD date.',
        { field: fieldName },
      );
    }
    return Object.freeze({ iso: value, utc: utc });
  }

  function isoFromUtc(utc) {
    var date = new Date(utc);
    return date.getUTCFullYear() + '-' +
      pad2(date.getUTCMonth() + 1) + '-' +
      pad2(date.getUTCDate());
  }

  function addDays(isoDate, days) {
    var parsed = parseIsoDateOnly(isoDate, 'date');
    if (!Number.isInteger(days)) {
      throw createError(
        ERROR_CODES.invalid,
        'days must be an integer.',
        { field: 'days' },
      );
    }
    return isoFromUtc(parsed.utc + days * DAY_MS);
  }

  function mondayFor(parsedBusinessDay) {
    var dayOfWeek = new Date(parsedBusinessDay.utc).getUTCDay();
    var daysSinceMonday = (dayOfWeek + 6) % 7;
    return isoFromUtc(parsedBusinessDay.utc - daysSinceMonday * DAY_MS);
  }

  function resolve(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw createError(
        ERROR_CODES.invalid,
        'Business context input is required.',
        { field: 'businessDay' },
      );
    }
    var business = parseIsoDateOnly(input.businessDay, 'businessDay');
    var staff = parseIsoDateOnly(
      input.staffDay === undefined || input.staffDay === null
        ? business.iso
        : input.staffDay,
      'staffDay',
    );
    return Object.freeze({
      businessDay: business.iso,
      weekStart: mondayFor(business),
      staffDay: staff.iso,
    });
  }

  function serialFromIsoDateOnly(isoDate) {
    var parsed = parseIsoDateOnly(isoDate, 'date');
    return (parsed.utc - SHEETS_EPOCH_UTC) / DAY_MS;
  }

  function isoFromAnchorValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return isoFromUtc(SHEETS_EPOCH_UTC + Math.floor(value) * DAY_MS);
    }
    if (
      Object.prototype.toString.call(value) === '[object Date]' &&
      Number.isFinite(value.getTime())
    ) {
      return isoFromUtc(Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
      ));
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      try {
        return parseIsoDateOnly(value, 'anchor').iso;
      } catch (_error) {
        return null;
      }
    }
    return null;
  }

  function inspectAnchorRanges(spreadsheet) {
    var ranges = {};
    var invalidAnchors = [];
    if (!spreadsheet || typeof spreadsheet.getSheetByName !== 'function') {
      Object.keys(ANCHORS).forEach(function (name) {
        invalidAnchors.push(Object.freeze({ anchor: name, reason: 'SPREADSHEET_UNAVAILABLE' }));
      });
      return { ranges: ranges, invalidAnchors: invalidAnchors };
    }
    Object.keys(ANCHORS).forEach(function (name) {
      var definition = ANCHORS[name];
      var sheet = spreadsheet.getSheetByName(definition.sheetName);
      if (!sheet || typeof sheet.getRange !== 'function') {
        invalidAnchors.push(Object.freeze({
          anchor: name,
          cell: definition.cell,
          sheet: definition.sheetName,
          reason: 'SHEET_UNAVAILABLE',
        }));
        return;
      }
      ranges[name] = sheet.getRange(definition.row, definition.column);
    });
    return { ranges: ranges, invalidAnchors: invalidAnchors };
  }

  function read(spreadsheet) {
    var inspected = inspectAnchorRanges(spreadsheet);
    var values = {};
    Object.keys(inspected.ranges).forEach(function (name) {
      var iso = isoFromAnchorValue(inspected.ranges[name].getValue());
      if (!iso) {
        var definition = ANCHORS[name];
        inspected.invalidAnchors.push(Object.freeze({
          anchor: name,
          cell: definition.cell,
          sheet: definition.sheetName,
          reason: 'INVALID_DATE',
        }));
      } else {
        values[name] = iso;
      }
    });
    if (values.businessDay && values.weekStart) {
      var expectedWeekStart = resolve({ businessDay: values.businessDay }).weekStart;
      if (values.weekStart !== expectedWeekStart) {
        inspected.invalidAnchors.push(Object.freeze({
          anchor: 'weekStart',
          cell: ANCHORS.weekStart.cell,
          sheet: ANCHORS.weekStart.sheetName,
          reason: 'NOT_BUSINESS_WEEK_MONDAY',
        }));
      }
    }
    var invalidAnchors = Object.freeze(inspected.invalidAnchors.slice());
    if (invalidAnchors.length) {
      return Object.freeze({
        pass: false,
        context: null,
        errorCode: ERROR_CODES.anchorInvalid,
        invalidAnchors: invalidAnchors,
      });
    }
    return Object.freeze({
      pass: true,
      context: Object.freeze({
        businessDay: values.businessDay,
        weekStart: values.weekStart,
        staffDay: values.staffDay,
      }),
      errorCode: null,
      invalidAnchors: invalidAnchors,
    });
  }

  function write(spreadsheet, input) {
    var context = resolve(input);
    var inspected = inspectAnchorRanges(spreadsheet);
    if (inspected.invalidAnchors.length) {
      throw createError(
        ERROR_CODES.anchorInvalid,
        'Business context anchor cells are unavailable.',
        { invalidAnchors: inspected.invalidAnchors.slice() },
      );
    }
    var names = Object.keys(ANCHORS);
    var previous = {};
    names.forEach(function (name) {
      previous[name] = inspected.ranges[name].getValue();
    });
    try {
      inspected.ranges.businessDay.setValue(serialFromIsoDateOnly(context.businessDay));
      inspected.ranges.weekStart.setValue(serialFromIsoDateOnly(context.weekStart));
      inspected.ranges.staffDay.setValue(serialFromIsoDateOnly(context.staffDay));
    } catch (writeError) {
      var rollbackComplete = true;
      names.forEach(function (name) {
        try {
          inspected.ranges[name].setValue(previous[name]);
        } catch (_rollbackError) {
          rollbackComplete = false;
        }
      });
      throw createError(
        ERROR_CODES.writeFailed,
        'Business context could not be written.',
        { rollbackComplete: rollbackComplete },
      );
    }
    return context;
  }

  return Object.freeze({
    ANCHORS: ANCHORS,
    ERROR_CODES: ERROR_CODES,
    addDays: addDays,
    read: read,
    resolve: resolve,
    serialFromIsoDateOnly: serialFromIsoDateOnly,
    write: write,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BusinessContextService;
}
