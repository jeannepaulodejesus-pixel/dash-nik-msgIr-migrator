var HandledOfferedReferenceModel = (function () {
  'use strict';

  function resolveSheetNames() {
    if (typeof SheetNames !== 'undefined') {
      return SheetNames;
    }
    return require('../config/SheetNames.js');
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

  function buildAhtFacts(ahtRows) {
    var firstBySession = Object.create(null);
    var totalsBySessionDate = Object.create(null);
    ahtRows.forEach(function (row) {
      var session = row['Work Item: Name'];
      var businessDate = businessDateTime(row['Accept Date']);
      if (!session || !businessDate) {
        return;
      }
      if (!firstBySession[session]) {
        firstBySession[session] = Object.freeze({
          acceptDateTime: businessDate,
          response: row['Time To First Response'],
          speedToAnswer: row['Speed To Answer'],
        });
      }
      var totalKey = session + '\u001d' + dateKey(businessDate);
      var totals = totalsBySessionDate[totalKey] || { activeTime: 0, handleTime: 0 };
      totals.activeTime += numeric(row['Active Time']);
      totals.handleTime += numeric(row['Handle Time']);
      totalsBySessionDate[totalKey] = totals;
    });
    return { firstBySession: firstBySession, totalsBySessionDate: totalsBySessionDate };
  }

  function factsForSession(ahtFacts, session) {
    var first = ahtFacts.firstBySession[session];
    var businessDate = first ? dateKey(first.acceptDateTime) : '';
    var totals = ahtFacts.totalsBySessionDate[session + '\u001d' + businessDate] || {
      activeTime: 0,
      handleTime: 0,
    };
    return {
      activeTime: totals.activeTime,
      businessDate: businessDate,
      handleTime: totals.handleTime,
      interval: first ? intervalKey(first.acceptDateTime) : '',
      response: first ? first.response : '',
      speedToAnswer: first ? first.speedToAnswer : '',
    };
  }

  function buildHandledFacts(handledRows) {
    var firstByCase = Object.create(null);
    var firstBySession = Object.create(null);
    var eligibleCountBySession = Object.create(null);
    handledRows.forEach(function (row) {
      var caseNumber = row['Case: Case Number'];
      var session = row['Messaging Session Name'];
      if (caseNumber && !firstByCase[caseNumber]) {
        firstByCase[caseNumber] = row;
      }
      if (session && !firstBySession[session]) {
        firstBySession[session] = row;
      }
      if (
        session &&
        row.Language === 'English' &&
        row['Initial Athlete CS Owner'] === 'NA'
      ) {
        eligibleCountBySession[session] = (eligibleCountBySession[session] || 0) + 1;
      }
    });
    return {
      eligibleCountBySession: eligibleCountBySession,
      firstByCase: firstByCase,
      firstBySession: firstBySession,
    };
  }

  function transformHandled(rows, ahtFacts) {
    return rows.map(function (row) {
      var facts = factsForSession(ahtFacts, row['Messaging Session Name']);
      return {
        'Accept Date': facts.businessDate,
        Interval: facts.interval,
        AHT: facts.handleTime,
      };
    });
  }

  function transformOffered(rows, ahtFacts, handledFacts) {
    return rows.map(function (row) {
      var session = row['Messaging Session Name'];
      var facts = factsForSession(ahtFacts, session);
      var handledByCase = handledFacts.firstByCase[row['Case: Case Number']] || {};
      var handledBySession = handledFacts.firstBySession[session] || {};
      var asa = facts.speedToAnswer;
      var handledAsa = handledByCase['Speed to Answer'];
      var response = facts.response;
      var handledFragments = 0;
      if (row.Language === 'English' && row['Initial Athlete CS Owner'] === 'NA') {
        handledFragments = row['Contact Fragment Count'];
        if (handledFragments === null || handledFragments === '') {
          handledFragments = 1;
        }
      }
      var slTotal = numeric(asa) + numeric(response) < 91 ? 1 : 0;
      return {
        'Accept Date': facts.businessDate,
        'Interval View': facts.interval,
        'Athlete Site': handledBySession['Initial Athlete Site'] || '',
        SL: numeric(asa) < 91 ? 1 : 0,
        ASA: asa,
        'Handled SL': numeric(handledAsa) < 91 ? 1 : 0,
        'Handled ASA': handledAsa,
        Count: row['Initial Athlete CS Owner'] === 'NA' ? 1 : 0,
        Handled: handledFacts.eligibleCountBySession[session] || 0,
        'Handled Fragments': handledFragments,
        Response: response,
        'SL Total': slTotal,
        'SL Total (Session)': handledFragments === 0 ? '' : slTotal,
        'AHT Session': facts.handleTime,
        'Active Time': facts.activeTime,
      };
    });
  }

  function transform(input) {
    var handledRows = requireRows(input, 'handledRows');
    var offeredRows = requireRows(input, 'offeredRows');
    var ahtRows = requireRows(input, 'ahtRows');
    var ahtFacts = buildAhtFacts(ahtRows);
    var handledFacts = buildHandledFacts(handledRows);
    return {
      handled: transformHandled(handledRows, ahtFacts),
      offered: transformOffered(offeredRows, ahtFacts, handledFacts),
    };
  }

  return Object.freeze({ transform: transform });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HandledOfferedReferenceModel;
}
