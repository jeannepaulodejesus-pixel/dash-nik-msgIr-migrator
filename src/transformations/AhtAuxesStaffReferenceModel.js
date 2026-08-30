var AhtAuxesStaffReferenceModel = (function () {
  'use strict';

  function resolveSheetNames() {
    if (typeof SheetNames !== 'undefined') {
      return SheetNames;
    }
    return require('../config/SheetNames.js');
  }

  function resolveCatalog() {
    if (typeof AhtAuxesStaffFormulaCatalog !== 'undefined') {
      return AhtAuxesStaffFormulaCatalog;
    }
    return require('./AhtAuxesStaffFormulaCatalog.js');
  }

  function requireRows(input, name) {
    if (!input || !Array.isArray(input[name])) {
      throw new Error(name + ' must be an array.');
    }
    return input[name];
  }

  function businessDateTime(isoValue) {
    var timestamp = new Date(isoValue).getTime();
    if (!Number.isFinite(timestamp)) {
      return null;
    }
    return new Date(
      timestamp + resolveSheetNames().SOURCE_TO_BUSINESS_OFFSET_MINUTES * 60000,
    );
  }

  function dateKey(date) {
    return date ? date.toISOString().slice(0, 10) : '';
  }

  function intervalKey(date) {
    if (!date) {
      return '';
    }
    var hour = String(date.getUTCHours()).padStart(2, '0');
    var minute = date.getUTCMinutes() < 30 ? '00' : '30';
    return hour + ':' + minute;
  }

  function numeric(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  function transformAht(rows) {
    var totalsByIntervalSite = Object.create(null);
    rows.forEach(function (row) {
      var accept = businessDateTime(row['Accept Date']);
      if (!accept) {
        return;
      }
      var key = intervalKey(accept) + '\u001d' + (row['Athlete Site'] || '');
      var totals = totalsByIntervalSite[key] || { activeTime: 0, handleTime: 0 };
      totals.activeTime += numeric(row['Active Time']);
      totals.handleTime += numeric(row['Handle Time']);
      totalsByIntervalSite[key] = totals;
    });

    return rows.map(function (row) {
      var accept = businessDateTime(row['Accept Date']);
      var request = businessDateTime(row['Request Date']);
      var interval = intervalKey(accept);
      var site = row['Athlete Site'] || '';
      var totals = totalsByIntervalSite[interval + '\u001d' + site] || {
        activeTime: 0,
        handleTime: 0,
      };
      var cc = '';
      if (totals.activeTime !== 0) {
        cc = totals.handleTime / totals.activeTime;
      }
      return {
        Date: dateKey(accept),
        Interval: interval,
        Count: row['Request Date'] ? 1 : 0,
        'Service Level': numeric(row['Speed To Answer']) < 91 ? 1 : 0,
        'ASA Total': numeric(row['Speed To Answer']) + numeric(row['Time To First Response']),
        CC: cc,
        'Request Interval': intervalKey(request),
      };
    });
  }

  function transformAuxes(rows) {
    return rows.map(function (row) {
      var start = businessDateTime(row['Status Start Date']);
      var status = row['Service Presence Status: Status Name'];
      var hours = numeric(row['Sign On Time (hours)']);
      return {
        Date: dateKey(start),
        Interval: intervalKey(start),
        'Available Messaging in Hours': status === 'Available - Messaging' ? hours : 0,
        'Concluding in Hours': status === 'Concluding' ? hours : 0,
      };
    });
  }

  function excelSerialFromIsoDateOnly(isoDate) {
    // Days since 1899-12-30 UTC, matching Sheets/Excel serial for date-only values.
    var parts = String(isoDate).slice(0, 10).split('-').map(Number);
    var utc = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    return (utc - Date.UTC(1899, 11, 30)) / 86400000;
  }

  function transformStaff(rows, businessDayIso) {
    var headers = resolveCatalog().halfHourHeaders();
    var daySerial = excelSerialFromIsoDateOnly(businessDayIso);
    var excelEpochMs = Date.UTC(1899, 11, 30);
    return rows.map(function (row) {
      var start = businessDateTime(row['Status Start Date']);
      var end = businessDateTime(row['Status End Date']);
      var result = {};
      var startDay = start ? (start.getTime() - excelEpochMs) / 86400000 : null;
      var endDay = end ? (end.getTime() - excelEpochMs) / 86400000 : null;
      headers.forEach(function (header, bucketIndex) {
        if (startDay === null || endDay === null) {
          result[header] = 0;
          return;
        }
        var bucketStart = daySerial + bucketIndex / 48;
        var bucketEnd = daySerial + (bucketIndex + 1) / 48;
        var overlap = Math.max(
          0,
          Math.min(endDay, bucketEnd) - Math.max(startDay, bucketStart),
        );
        result[header] = Math.round(overlap * 1e12) / 1e12;
      });
      return result;
    });
  }

  function resolveRoutingConfig() {
    if (typeof StaffSummaryRoutingConfig !== 'undefined') {
      return StaffSummaryRoutingConfig;
    }
    return require('../config/StaffSummaryRoutingConfig.js');
  }

  function staffSummary(rows, transformedRows) {
    var headers = resolveCatalog().halfHourHeaders();
    var routing = resolveRoutingConfig();
    return headers.map(function (_header, bucketIndex) {
      var route = routing.forBucket(bucketIndex);
      var que = 0;
      var las = 0;
      rows.forEach(function (row, rowIndex) {
        var fte = transformedRows[rowIndex][headers[bucketIndex]] * 48;
        if (row['Athlete Site'] === route.queSite) que += fte;
        if (row['Athlete Site'] === route.lasSite) las += fte;
      });
      return {
        Interval: String(Math.floor(bucketIndex / 2)).padStart(2, '0') + ':' +
          (bucketIndex % 2 ? '30' : '00'),
        'Que Summary': Math.round(que * 1e9) / 1e9,
        'LAS Summary': Math.round(las * 1e9) / 1e9,
      };
    }).filter(function (row) {
      return row['Que Summary'] !== 0 || row['LAS Summary'] !== 0;
    });
  }

  function transform(input) {
    var ahtRows = requireRows(input, 'ahtRows');
    var auxesRows = requireRows(input, 'auxesRows');
    var staffRows = requireRows(input, 'staffRows');
    var businessDay = input.businessDay || '2026-08-18';
    var transformedStaff = transformStaff(staffRows, businessDay);
    return {
      aht: transformAht(ahtRows),
      auxes: transformAuxes(auxesRows),
      staff: transformedStaff,
      staffSummary: staffSummary(staffRows, transformedStaff),
    };
  }

  return Object.freeze({
    transform: transform,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AhtAuxesStaffReferenceModel;
}
