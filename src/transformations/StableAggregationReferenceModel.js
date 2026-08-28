var StableAggregationReferenceModel = (function () {
  'use strict';

  function resolveHandledOffered() {
    if (typeof HandledOfferedReferenceModel !== 'undefined') {
      return HandledOfferedReferenceModel;
    }
    return require('./HandledOfferedReferenceModel.js');
  }

  function resolveAhtAuxesStaff() {
    if (typeof AhtAuxesStaffReferenceModel !== 'undefined') {
      return AhtAuxesStaffReferenceModel;
    }
    return require('./AhtAuxesStaffReferenceModel.js');
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

  function grainKey(date, interval, site) {
    return String(date) + '\u001d' + String(interval) + '\u001d' + String(site);
  }

  function ensureBucket(buckets, key) {
    if (!buckets[key]) {
      buckets[key] = {
        Date: '',
        Interval: '',
        Site: '',
        Offered: 0,
        Handled: 0,
        'Chats in SL': 0,
        'SL TTC': { sum: 0, count: 0 },
        'AHT (Session)': { sum: 0, count: 0 },
        AHT: { sum: 0, count: 0 },
        ACW: { sum: 0, count: 0 },
        ASA: { sum: 0, count: 0 },
        Concurrency: { sum: 0, count: 0 },
      };
    }
    return buckets[key];
  }

  function averageField(field) {
    if (!field.count) {
      return '';
    }
    return field.sum / field.count;
  }

  function aggregateInterval(offeredRows, ahtRows) {
    var buckets = Object.create(null);
    offeredRows.forEach(function (row) {
      var key = grainKey(row['Accept Date'], row['Interval View'], row['Athlete Site']);
      var bucket = ensureBucket(buckets, key);
      bucket.Date = row['Accept Date'];
      bucket.Interval = row['Interval View'];
      bucket.Site = row['Athlete Site'];
      bucket.Offered += numeric(row.Count);
      bucket.Handled += numeric(row.Handled);
      bucket['Chats in SL'] += numeric(row['SL Total']);
      if (row.SL !== '' && row.SL !== null) {
        bucket['SL TTC'].sum += numeric(row.SL);
        bucket['SL TTC'].count += 1;
      }
      if (row['AHT Session'] !== '' && row['AHT Session'] !== null) {
        bucket['AHT (Session)'].sum += numeric(row['AHT Session']);
        bucket['AHT (Session)'].count += 1;
      }
    });

    ahtRows.forEach(function (row, index) {
      var site = row.Site || '';
      var key = grainKey(row.Date, row.Interval, site);
      var bucket = ensureBucket(buckets, key);
      if (!bucket.Date) {
        bucket.Date = row.Date;
        bucket.Interval = row.Interval;
        bucket.Site = site;
      }
      if (row['Handle Time'] !== '' && row['Handle Time'] !== null) {
        bucket.AHT.sum += numeric(row['Handle Time']);
        bucket.AHT.count += 1;
      }
      if (row.ACW !== '' && row.ACW !== null) {
        bucket.ACW.sum += numeric(row.ACW);
        bucket.ACW.count += 1;
      }
      if (row['ASA Total'] !== '' && row['ASA Total'] !== null) {
        bucket.ASA.sum += numeric(row['ASA Total']);
        bucket.ASA.count += 1;
      }
      if (row.CC !== '' && row.CC !== null) {
        bucket.Concurrency.sum += numeric(row.CC);
        bucket.Concurrency.count += 1;
      }
      if (index === 0 && !row.Site) {
        return;
      }
    });

    return Object.keys(buckets).sort().map(function (key) {
      var bucket = buckets[key];
      return {
        Date: bucket.Date,
        Interval: bucket.Interval,
        Site: bucket.Site,
        Offered: bucket.Offered,
        Handled: bucket.Handled,
        'Chats in SL': bucket['Chats in SL'],
        'SL TTC': averageField(bucket['SL TTC']),
        'AHT (Session)': averageField(bucket['AHT (Session)']),
        AHT: averageField(bucket.AHT),
        ACW: averageField(bucket.ACW),
        ASA: averageField(bucket.ASA),
        Concurrency: averageField(bucket.Concurrency),
      };
    });
  }

  function aggregateForecast(forecastInputs) {
    if (!forecastInputs || !Array.isArray(forecastInputs)) {
      return [];
    }
    return forecastInputs.map(function (row) {
      return {
        Date: row.Date,
        Interval: row.Interval,
        Site: row.Site,
        Type: row.Type,
        Value: row.Value,
      };
    });
  }

  function aggregateAllocation(offeredRows, offeredRawRows) {
    var bpoBySession = Object.create(null);
    offeredRawRows.forEach(function (row) {
      if (row['Messaging Session Name']) {
        bpoBySession[row['Messaging Session Name']] = row['Initial Athlete BPO'] || '';
      }
    });
    var buckets = Object.create(null);
    var intervalTotals = Object.create(null);
    offeredRows.forEach(function (row, index) {
      var session = offeredRawRows[index]
        ? offeredRawRows[index]['Messaging Session Name']
        : '';
      var bpo = bpoBySession[session] || '';
      var intervalKey = grainKey(row['Accept Date'], row['Interval View'], row['Athlete Site']);
      var key = intervalKey + '\u001d' + bpo;
      if (!buckets[key]) {
        buckets[key] = {
          Date: row['Accept Date'],
          Interval: row['Interval View'],
          Site: row['Athlete Site'],
          BPO: bpo,
          'Offered Count': 0,
        };
      }
      buckets[key]['Offered Count'] += numeric(row.Count);
      intervalTotals[intervalKey] = (intervalTotals[intervalKey] || 0) + numeric(row.Count);
    });

    return Object.keys(buckets).sort().map(function (key) {
      var bucket = buckets[key];
      var intervalKey = grainKey(bucket.Date, bucket.Interval, bucket.Site);
      var total = intervalTotals[intervalKey] || 0;
      return {
        Date: bucket.Date,
        Interval: bucket.Interval,
        Site: bucket.Site,
        BPO: bucket.BPO,
        'Offered Count': bucket['Offered Count'],
        'Allocation Share': total ? bucket['Offered Count'] / total : '',
      };
    });
  }

  function transform(input) {
    var handledRows = requireRows(input, 'handledRows');
    var offeredRows = requireRows(input, 'offeredRows');
    var ahtRows = requireRows(input, 'ahtRows');
    var calc = resolveHandledOffered().transform({
      handledRows: handledRows,
      offeredRows: offeredRows,
      ahtRows: ahtRows,
    });
    var ahtCalc = resolveAhtAuxesStaff().transform({
      ahtRows: ahtRows,
      auxesRows: input.auxesRows || [],
      staffRows: input.staffRows || [],
      businessDay: input.businessDay,
    });
    var ahtWithRaw = ahtRows.map(function (row, index) {
      return Object.assign({}, ahtCalc.aht[index], {
        Site: row['Athlete Site'] || '',
        'Handle Time': row['Handle Time'],
        ACW: row['After Conversation Work Actual Time'],
      });
    });
    return {
      aggAllocation: aggregateAllocation(calc.offered, offeredRows),
      aggForecast: aggregateForecast(input.forecastInputs),
      aggInterval: aggregateInterval(calc.offered, ahtWithRaw),
    };
  }

  return Object.freeze({
    transform: transform,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StableAggregationReferenceModel;
}
