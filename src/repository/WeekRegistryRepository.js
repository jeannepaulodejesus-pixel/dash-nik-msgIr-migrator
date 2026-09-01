var WeekRegistryRepository = (function () {
  'use strict';

  var SHEET_NAME = 'WEEK_REGISTRY';
  var CONTRACT_VERSION = '1.0.0';
  var STATUSES = Object.freeze({
    ACTIVE: 'ACTIVE',
    ARCHIVED: 'ARCHIVED',
    FAILED: 'FAILED',
    SUPERSEDED: 'SUPERSEDED',
  });
  var HEADERS = Object.freeze([
    'Week Key',
    'Target Spreadsheet ID',
    'Master Template Spreadsheet ID',
    'Registered At UTC',
    'Activated At UTC',
    'Status',
    'Notes',
  ]);

  function resolveErrorCodes() {
    if (typeof ErrorCodes !== 'undefined') {
      return ErrorCodes;
    }
    return require('../monitoring/ErrorCodes.js');
  }

  function arraysEqual(left, right) {
    return left.length === right.length && left.every(function (value, index) {
      return value === right[index];
    });
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function normalizeWeekKey(value) {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return value.getUTCFullYear() + '-' +
        pad2(value.getUTCMonth() + 1) + '-' +
        pad2(value.getUTCDate());
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      // Sheets serial date → UTC calendar day from the Sheets epoch.
      var utc = Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000;
      var date = new Date(utc);
      return date.getUTCFullYear() + '-' +
        pad2(date.getUTCMonth() + 1) + '-' +
        pad2(date.getUTCDate());
    }
    return String(value).trim();
  }

  function normalizeStatus(value) {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    return String(value).trim().toUpperCase();
  }

  function requireSheet(spreadsheet) {
    if (!spreadsheet || typeof spreadsheet.getSheetByName !== 'function') {
      throw resolveErrorCodes().create('LIFECYCLE_CONTROL_UNAVAILABLE', {
        details: { reason: 'control_spreadsheet_unavailable' },
      });
    }
    var sheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet) {
      throw resolveErrorCodes().create('LIFECYCLE_CONTROL_UNAVAILABLE', {
        details: { sheetName: SHEET_NAME },
      });
    }
    return sheet;
  }

  function ensureHeaders(sheet) {
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS.slice()]);
      return;
    }
    var actual = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    if (!arraysEqual(actual, HEADERS)) {
      throw resolveErrorCodes().create('LIFECYCLE_REGISTRY_SCHEMA_MISMATCH', {
        details: { actualHeaders: actual, expectedHeaders: HEADERS, sheetName: SHEET_NAME },
      });
    }
  }

  function installHeaders(sheet) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS.slice()]);
  }

  function toRow(record) {
    return [
      normalizeWeekKey(record.weekKey),
      record.targetSpreadsheetId == null ? '' : String(record.targetSpreadsheetId),
      record.masterTemplateSpreadsheetId == null ? '' : String(record.masterTemplateSpreadsheetId),
      record.registeredAtUtc || '',
      record.activatedAtUtc || '',
      normalizeStatus(record.status),
      record.notes || '',
    ];
  }

  function fromRow(row) {
    return Object.freeze({
      activatedAtUtc: row[4] ? String(row[4]) : null,
      masterTemplateSpreadsheetId: row[2] == null || row[2] === '' ? '' : String(row[2]),
      notes: row[6] ? String(row[6]) : '',
      registeredAtUtc: row[3] ? String(row[3]) : '',
      status: normalizeStatus(row[5]),
      targetSpreadsheetId: row[1] == null || row[1] === '' ? '' : String(row[1]),
      weekKey: normalizeWeekKey(row[0]),
    });
  }

  function readAll(sheet) {
    ensureHeaders(sheet);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return [];
    }
    var rowCount = lastRow - 1;
    return sheet.getRange(2, 1, rowCount, HEADERS.length).getValues().map(fromRow).filter(
      function (record) {
        return record.weekKey !== '';
      },
    );
  }

  function findRowIndex(sheet, weekKey) {
    var normalized = normalizeWeekKey(weekKey);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return -1;
    }
    var rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    for (var index = 0; index < rows.length; index += 1) {
      if (normalizeWeekKey(rows[index][0]) === normalized) {
        return index + 2;
      }
    }
    return -1;
  }

  function writeRow(sheet, rowIndex, record) {
    var row = toRow(record);
    var range = sheet.getRange(rowIndex, 1, 1, HEADERS.length);
    // Keep Week Key as plain text so Sheets does not coerce YYYY-MM-DD to Date.
    if (typeof range.setNumberFormats === 'function') {
      range.setNumberFormats([['@', '@', '@', '@', '@', '@', '@']]);
    } else if (typeof sheet.getRange(rowIndex, 1).setNumberFormat === 'function') {
      sheet.getRange(rowIndex, 1).setNumberFormat('@');
    }
    range.setValues([row]);
  }

  function create(spreadsheet) {
    var sheet = requireSheet(spreadsheet);

    function list() {
      try {
        return Object.freeze(readAll(sheet).slice());
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'LIFECYCLE_CONTROL_UNAVAILABLE');
      }
    }

    function findActive() {
      var rows = list();
      var active = null;
      for (var index = 0; index < rows.length; index += 1) {
        if (rows[index].status === STATUSES.ACTIVE && rows[index].weekKey) {
          if (active) {
            throw resolveErrorCodes().create('LIFECYCLE_REGISTRY_SCHEMA_MISMATCH', {
              details: { reason: 'multiple_active_rows' },
            });
          }
          active = rows[index];
        }
      }
      return active;
    }

    function findByWeekKey(weekKey) {
      var normalized = normalizeWeekKey(weekKey);
      if (!normalized) {
        return null;
      }
      var rows = list();
      for (var index = 0; index < rows.length; index += 1) {
        if (rows[index].weekKey === normalized) {
          return rows[index];
        }
      }
      return null;
    }

    function upsert(record) {
      try {
        ensureHeaders(sheet);
        var normalizedRecord = {
          activatedAtUtc: record.activatedAtUtc || '',
          masterTemplateSpreadsheetId: record.masterTemplateSpreadsheetId,
          notes: record.notes || '',
          registeredAtUtc: record.registeredAtUtc,
          status: normalizeStatus(record.status),
          targetSpreadsheetId: record.targetSpreadsheetId,
          weekKey: normalizeWeekKey(record.weekKey),
        };
        if (!normalizedRecord.weekKey) {
          throw resolveErrorCodes().create('LIFECYCLE_WEEK_KEY_INVALID', {
            details: { reason: 'blank_week_key' },
          });
        }
        var existingIndex = findRowIndex(sheet, normalizedRecord.weekKey);
        if (existingIndex === -1) {
          writeRow(sheet, sheet.getLastRow() + 1, normalizedRecord);
        } else {
          writeRow(sheet, existingIndex, normalizedRecord);
        }
        return findByWeekKey(normalizedRecord.weekKey);
      } catch (error) {
        throw resolveErrorCodes().normalize(error, 'LIFECYCLE_CONTROL_UNAVAILABLE');
      }
    }

    function setStatus(weekKey, status, notes, activatedAtUtc) {
      var existing = findByWeekKey(weekKey);
      if (!existing) {
        throw resolveErrorCodes().create('LIFECYCLE_CONTROL_UNAVAILABLE', {
          details: {
            reason: 'week_key_not_found',
            weekKey: normalizeWeekKey(weekKey),
          },
        });
      }
      return upsert({
        activatedAtUtc: activatedAtUtc !== undefined ? activatedAtUtc : existing.activatedAtUtc,
        masterTemplateSpreadsheetId: existing.masterTemplateSpreadsheetId,
        notes: notes !== undefined ? notes : existing.notes,
        registeredAtUtc: existing.registeredAtUtc,
        status: status,
        targetSpreadsheetId: existing.targetSpreadsheetId,
        weekKey: existing.weekKey,
      });
    }

    function archiveActive(exceptWeekKey, archivedAtNote) {
      var active = findActive();
      if (!active) {
        return null;
      }
      var exceptKey = normalizeWeekKey(exceptWeekKey);
      if (exceptKey && active.weekKey === exceptKey) {
        return active;
      }
      // Upsert from the already-loaded row — do not re-resolve by identity-sensitive keys.
      return upsert({
        activatedAtUtc: active.activatedAtUtc,
        masterTemplateSpreadsheetId: active.masterTemplateSpreadsheetId,
        notes: archivedAtNote || active.notes,
        registeredAtUtc: active.registeredAtUtc,
        status: STATUSES.ARCHIVED,
        targetSpreadsheetId: active.targetSpreadsheetId,
        weekKey: active.weekKey,
      });
    }

    function headersMatch() {
      try {
        if (sheet.getLastRow() === 0) {
          return false;
        }
        var actual = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
        return arraysEqual(actual, HEADERS);
      } catch (error) {
        return false;
      }
    }

    return Object.freeze({
      archiveActive: archiveActive,
      findActive: findActive,
      findByWeekKey: findByWeekKey,
      headersMatch: headersMatch,
      installHeaders: function () { installHeaders(sheet); },
      list: list,
      setStatus: setStatus,
      upsert: upsert,
    });
  }

  return Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    HEADERS: HEADERS,
    SHEET_NAME: SHEET_NAME,
    STATUSES: STATUSES,
    create: create,
    installHeaders: installHeaders,
    normalizeWeekKey: normalizeWeekKey,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WeekRegistryRepository;
}
