var ReportingSurfaceReferenceModel = (function () {
  'use strict';

  var METRIC_ORDER = Object.freeze([
    'Forecast',
    'Offered',
    'Handled',
    'Chats in SL',
    'Abandoned',
    'SL % Total',
    'SL (Time To Connect)',
    '% of Forecast Offered',
    '% of Forecast Handled',
    'Allocation',
    'Cumulative Allocation',
    'AHT (Session)',
    'AHT',
    'ACW',
    'ASA in Seconds',
    'Concurrency',
    'Scheduled',
    'Required',
    'Actual (SO)',
    'Actual vs Required',
    'Scheduled Hours',
    'Required Hours',
    'Actual',
    'Actual to Required',
    'Scheduled to Required',
  ]);

  function resolveAggregationModel() {
    if (typeof StableAggregationReferenceModel !== 'undefined') {
      return StableAggregationReferenceModel;
    }
    return require('./StableAggregationReferenceModel.js');
  }

  function requireRows(input, name) {
    if (!input || !Array.isArray(input[name])) {
      throw new Error(name + ' must be an array.');
    }
    return input[name];
  }

  function numeric(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  function grainKey(date, interval) {
    return String(date) + '\u001d' + String(interval);
  }

  function sumIntervalMetric(rows, date, interval, field) {
    return rows.reduce(function (total, row) {
      if (row.Date === date && row.Interval === interval) {
        return total + numeric(row[field]);
      }
      return total;
    }, 0);
  }

  function avgIntervalMetric(rows, date, interval, field) {
    var sum = 0;
    var count = 0;
    rows.forEach(function (row) {
      if (row.Date === date && row.Interval === interval && row[field] !== '' && row[field] != null) {
        sum += numeric(row[field]);
        count += 1;
      }
    });
    return count ? sum / count : '';
  }

  function sumForecastType(rows, date, interval, typeName) {
    return rows.reduce(function (total, row) {
      if (row.Date === date && row.Interval === interval && row.Type === typeName) {
        return total + numeric(row.Value);
      }
      return total;
    }, 0);
  }

  function sumAllocation(rows, date, interval, field) {
    return rows.reduce(function (total, row) {
      if (row.Date === date && row.Interval === interval) {
        return total + numeric(row[field]);
      }
      return total;
    }, 0);
  }

  function blankIfZero(value, rowIndex, metricName) {
    if (metricName === 'Handled' && rowIndex >= 10 && value === 0) {
      return '';
    }
    if (metricName === 'Offered' && value === 0) {
      return '';
    }
    return value;
  }

  function buildRow(date, interval, aggInterval, aggForecast, aggAllocation, rowIndex) {
    var offered = sumIntervalMetric(aggInterval, date, interval, 'Offered');
    var handled = sumIntervalMetric(aggInterval, date, interval, 'Handled');
    var chatsInSl = sumIntervalMetric(aggInterval, date, interval, 'Chats in SL');
    var forecast = sumForecastType(aggForecast, date, interval, 'Forecast');
    var required = sumForecastType(aggForecast, date, interval, 'Required');
    var scheduled = sumForecastType(aggForecast, date, interval, 'Scheduled');
    var actualSo = sumForecastType(aggForecast, date, interval, 'Actual (SO)');
    var slTtc = avgIntervalMetric(aggInterval, date, interval, 'SL TTC');
    var ahtSessionRaw = avgIntervalMetric(aggInterval, date, interval, 'AHT (Session)');
    var ahtSession = ahtSessionRaw === '' ? '' : ahtSessionRaw / 63;
    var aht = avgIntervalMetric(aggInterval, date, interval, 'AHT');
    var acw = avgIntervalMetric(aggInterval, date, interval, 'ACW');
    var asa = avgIntervalMetric(aggInterval, date, interval, 'ASA');
    var concurrency = avgIntervalMetric(aggInterval, date, interval, 'Concurrency');
    var allocation = sumAllocation(aggAllocation, date, interval, 'Offered Count');
    var cumulativeAllocation = sumAllocation(aggAllocation, date, interval, 'Allocation Share');
    var abandoned = offered - handled;
    var scheduledHours = scheduled === 0 ? '' : (scheduled * 30) / 1440;
    var requiredHours = required === 0 ? '' : (required * 30) / 1440;
    var actualHours = actualSo === 0 ? '' : (actualSo * 30) / 1440;

    var metrics = {
      Forecast: forecast,
      Offered: blankIfZero(offered, rowIndex, 'Offered'),
      Handled: blankIfZero(handled, rowIndex, 'Handled'),
      'Chats in SL': chatsInSl,
      Abandoned: offered === 0 && handled === 0 ? '' : abandoned,
      'SL % Total': offered ? chatsInSl / offered : '',
      'SL (Time To Connect)': slTtc,
      '% of Forecast Offered': offered === 0 ? ' ' : offered / (forecast || 1),
      '% of Forecast Handled': handled === 0 ? ' ' : handled / (forecast || 1),
      Allocation: allocation,
      'Cumulative Allocation': cumulativeAllocation,
      'AHT (Session)': ahtSession,
      AHT: aht,
      ACW: acw,
      'ASA in Seconds': asa,
      Concurrency: concurrency,
      Scheduled: scheduled === 0 ? '' : scheduled,
      Required: required === 0 ? '' : required,
      'Actual (SO)': actualSo === 0 ? '' : actualSo,
      'Actual vs Required': actualSo === 0 && required === 0 ? '' : actualSo - required,
      'Scheduled Hours': scheduledHours,
      'Required Hours': requiredHours,
      Actual: actualHours,
      'Actual to Required': requiredHours && actualHours ? actualHours / requiredHours : '',
      'Scheduled to Required': required ? scheduled / required : '',
    };

    return Object.assign({ Date: date, Interval: interval }, metrics);
  }

  function transform(input) {
    requireRows(input, 'handledRows');
    requireRows(input, 'offeredRows');
    requireRows(input, 'ahtRows');
    var aggregation = resolveAggregationModel().transform(input);
    var aggInterval = aggregation.aggInterval;
    var aggForecast = aggregation.aggForecast;
    var aggAllocation = aggregation.aggAllocation;

    var keys = Object.create(null);
    aggInterval.forEach(function (row) {
      keys[grainKey(row.Date, row.Interval)] = { Date: row.Date, Interval: row.Interval };
    });
    aggForecast.forEach(function (row) {
      keys[grainKey(row.Date, row.Interval)] = { Date: row.Date, Interval: row.Interval };
    });
    aggAllocation.forEach(function (row) {
      keys[grainKey(row.Date, row.Interval)] = { Date: row.Date, Interval: row.Interval };
    });

    var intervalView = Object.keys(keys).sort().map(function (key, index) {
      var entry = keys[key];
      return buildRow(
        entry.Date,
        entry.Interval,
        aggInterval,
        aggForecast,
        aggAllocation,
        index,
      );
    });

    return {
      intervalView: intervalView,
      metricOrder: METRIC_ORDER.slice(),
    };
  }

  return Object.freeze({
    METRIC_ORDER: METRIC_ORDER,
    transform: transform,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReportingSurfaceReferenceModel;
}
