var InboxBundleRepository = (function () {
  'use strict';

  var MAX_INBOX_FILES = 200;
  var DATASETS = Object.freeze([
    Object.freeze({ datasetName: 'Handled', slug: 'handled' }),
    Object.freeze({ datasetName: 'Offered', slug: 'offered' }),
    Object.freeze({ datasetName: 'AHT - Raw', slug: 'aht' }),
    Object.freeze({ datasetName: 'Auxes - Raw', slug: 'auxes' }),
    Object.freeze({ datasetName: 'Staff', slug: 'staff' }),
  ]);
  var TOKEN = '(\\d{8}T\\d{6}Z)';
  var BUNDLE_PATTERN = new RegExp('^' + TOKEN + '__bundle\\.xlsx$', 'i');
  var MEMBER_PATTERN = new RegExp('^' + TOKEN + '__(handled|offered|aht|auxes|staff)\\.(xls|xlsx)$', 'i');

  function resolveErrors() {
    if (typeof ErrorCodes !== 'undefined') return ErrorCodes;
    return require('../monitoring/ErrorCodes.js');
  }
  function fail(code, details, cause) {
    throw resolveErrors().create(code, { cause: cause, details: details || {} });
  }
  function validToken(token) {
    var match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(token || '');
    if (!match) return false;
    var date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]));
    return date.toISOString().replace(/[-:]/g, '').replace('.000', '') === token;
  }
  function descriptor(file) {
    return Object.freeze({
      id: String(file.getId()),
      name: String(file.getName()),
      updatedAtUtc: file.getLastUpdated().toISOString(),
    });
  }
  function listFiles(folder, limit) {
    var iterator = folder.getFiles();
    var files = [];
    while (iterator.hasNext()) {
      if (files.length >= limit) fail('SOURCE_INBOX_TOO_LARGE', { maxFiles: limit });
      files.push(descriptor(iterator.next()));
    }
    return files;
  }
  function classify(files) {
    var groups = Object.create(null);
    (files || []).forEach(function (file) {
      var bundle = BUNDLE_PATTERN.exec(file.name);
      var member = MEMBER_PATTERN.exec(file.name);
      if (!bundle && !member) return;
      var token = (bundle || member)[1].toUpperCase();
      if (!validToken(token)) return;
      if (!groups[token]) groups[token] = { bundle: [], members: Object.create(null), token: token };
      if (bundle) groups[token].bundle.push(file);
      else {
        var slug = member[2].toLowerCase();
        if (!groups[token].members[slug]) groups[token].members[slug] = [];
        groups[token].members[slug].push(file);
      }
    });
    return groups;
  }
  function selectLatest(files) {
    var groups = classify(files);
    var tokens = Object.keys(groups).sort().reverse();
    if (!tokens.length) return Object.freeze({ candidate: null, status: 'IDLE' });
    var group = groups[tokens[0]];
    var memberSlugs = Object.keys(group.members);
    var duplicates = memberSlugs.some(function (slug) { return group.members[slug].length !== 1; });
    var complete = DATASETS.every(function (entry) {
      return group.members[entry.slug] && group.members[entry.slug].length === 1;
    });
    if (group.bundle.length > 1 || duplicates || (group.bundle.length && memberSlugs.length)) {
      fail('SOURCE_INBOX_BUNDLE_AMBIGUOUS', { batchToken: group.token });
    }
    if (group.bundle.length === 1) {
      return Object.freeze({
        candidate: Object.freeze({
          batchToken: group.token,
          datasetNames: Object.freeze(DATASETS.map(function (entry) { return entry.datasetName; })),
          packagingKind: 'multi_sheet_workbook',
          sources: Object.freeze([group.bundle[0]]),
        }),
        status: 'READY',
      });
    }
    if (!complete || memberSlugs.length !== DATASETS.length) {
      fail('SOURCE_INBOX_BUNDLE_INCOMPLETE', { batchToken: group.token, presentDatasets: memberSlugs.slice().sort() });
    }
    return Object.freeze({
      candidate: Object.freeze({
        batchToken: group.token,
        datasetNames: Object.freeze(DATASETS.map(function (entry) { return entry.datasetName; })),
        packagingKind: 'single_dataset',
        sources: Object.freeze(DATASETS.map(function (entry) {
          return Object.freeze(Object.assign({ datasetName: entry.datasetName }, group.members[entry.slug][0]));
        })),
      }),
      status: 'READY',
    });
  }
  function create(driveApp, folderId, options) {
    var limit = options && options.maxFiles ? options.maxFiles : MAX_INBOX_FILES;
    if (!folderId) fail('SOURCE_INBOX_NOT_CONFIGURED');
    if (!driveApp || typeof driveApp.getFolderById !== 'function') fail('SOURCE_INBOX_UNAVAILABLE');
    var folder;
    try { folder = driveApp.getFolderById(folderId); } catch (error) { fail('SOURCE_INBOX_UNAVAILABLE', {}, error); }
    return Object.freeze({ getLatest: function () { return selectLatest(listFiles(folder, limit)); } });
  }
  return Object.freeze({ DATASETS: DATASETS, MAX_INBOX_FILES: MAX_INBOX_FILES, classify: classify, create: create, selectLatest: selectLatest, validToken: validToken });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = InboxBundleRepository;
