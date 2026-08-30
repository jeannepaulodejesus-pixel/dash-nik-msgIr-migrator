var SchemaRegistry = (function () {
  'use strict';

  var ACTIVE_SCHEMA_VERSION = '1.0.0';
  var DATA_TYPES = Object.freeze({
    DATE: 'date',
    DATE_TIME: 'date_time',
    NUMBER: 'number',
    TEXT: 'text',
  });
  var EMPTY_VALUE_POLICY = Object.freeze({
    blankNormalization: 'trim_then_null',
    coalescedErrorTokens: Object.freeze([
      '#N/A',
      '#REF!',
      '#DIV/0!',
      '#VALUE!',
      '#NAME?',
      '#NUM!',
      '#NULL!',
      '#ERROR!',
    ]),
    errorTokenComparison: 'case_insensitive_exact_token',
    errorTokenFallback: null,
    keyFieldsMustBeNonblank: true,
    // Backward-compatible alias for callers that inspect the validator guard.
    rejectedErrorTokenPattern: '^#',
    unrecognizedErrorTokenPattern: '^#',
    synthesizeDefaults: false,
    treatNaAsNull: false,
  });
  var PACKAGING_CONTRACTS = Object.freeze({
    MULTI_SHEET_WORKBOOK: Object.freeze({
      datasetLocator: 'sheetName',
      kind: 'multi_sheet_workbook',
      payloadCardinality: 'one_per_mapped_sheet',
    }),
    SINGLE_DATASET: Object.freeze({
      datasetLocator: 'datasetName',
      kind: 'single_dataset',
      payloadCardinality: 'exactly_one',
    }),
  });
  var REGISTRY_RECORD_HEADERS = Object.freeze([
    'Schema Version',
    'Dataset Name',
    'Status',
    'Required Headers JSON',
    'Optional Headers JSON',
    'Key Fields JSON',
    'Minimum Rows',
    'Maximum Rows',
  ]);

  function freezeCopy(values) {
    return Object.freeze(values.slice());
  }

  function makeColumns(headers, dateTimeHeaders, dateHeaders, numberHeaders) {
    var dateTimeLookup = Object.create(null);
    var dateLookup = Object.create(null);
    var numberLookup = Object.create(null);

    dateTimeHeaders.forEach(function (header) {
      dateTimeLookup[header] = true;
    });
    dateHeaders.forEach(function (header) {
      dateLookup[header] = true;
    });
    numberHeaders.forEach(function (header) {
      numberLookup[header] = true;
    });

    return Object.freeze(
      headers.map(function (header) {
        var type = DATA_TYPES.TEXT;
        if (dateTimeLookup[header]) {
          type = DATA_TYPES.DATE_TIME;
        } else if (dateLookup[header]) {
          type = DATA_TYPES.DATE;
        } else if (numberLookup[header]) {
          type = DATA_TYPES.NUMBER;
        }
        return Object.freeze({ name: header, required: true, type: type });
      }),
    );
  }

  function makeSchema(options) {
    var requiredHeaders = freezeCopy(options.headers);
    return Object.freeze({
      aliases: Object.freeze(Object.assign({}, options.aliases || {})),
      allowUnexpectedHeaders: false,
      columns: makeColumns(
        requiredHeaders,
        options.dateTimeHeaders || [],
        options.dateHeaders || [],
        options.numberHeaders || [],
      ),
      emptyValuePolicy: EMPTY_VALUE_POLICY,
      keyFields: freezeCopy(options.keyFields || []),
      name: options.name,
      optionalHeaders: Object.freeze([]),
      requiredHeaders: requiredHeaders,
      rowVolume: Object.freeze({
        maximum: options.maximumRows,
        minimum: 1,
      }),
      technicalDedupeKey: options.technicalDedupeKey || null,
      version: ACTIVE_SCHEMA_VERSION,
    });
  }

  var schemas = Object.freeze([
    makeSchema({
      name: 'Handled',
      headers: [
        'Case: Case Number',
        'Messaging Session Name',
        'Initial Queue',
        'Start Time',
        'End Time',
        'Wait Time',
        'Total Resolution Time (minutes)',
        'Service Level Met',
        'Initial Queue Level',
        'Initial Queue CS Owner',
        'Initial Queue LOB',
        'Case Business Unit',
        'Initial Athlete CS Owner',
        'Related Case Resolution',
        'Related Case Purpose',
        'Consumer Email',
        'Speed to Answer',
        'Case Language',
        'Is Internal',
        'Status',
        'Case: BU',
        'Request Time',
        'Country',
        'Messaging Channel: Channel Name',
        'Initial Athlete Site',
        'Created Date',
        'Language',
      ],
      dateTimeHeaders: ['Start Time', 'End Time', 'Request Time'],
      dateHeaders: ['Created Date'],
      numberHeaders: [
        'Wait Time',
        'Total Resolution Time (minutes)',
        'Speed to Answer',
      ],
      keyFields: ['Messaging Session Name'],
      maximumRows: 10000,
    }),
    makeSchema({
      name: 'Offered',
      headers: [
        'Case: Case Number',
        'Messaging Session Name',
        'Initial Queue',
        'Start Time',
        'End Time',
        'Wait Time',
        'Total Resolution Time (minutes)',
        'Initial Queue CS Owner',
        'Initial Queue LOB',
        'Initial Queue Level',
        'Country',
        'Language',
        'Case Business Unit',
        'Initial Athlete CS Owner',
        'Consumer Email',
        'Related Case Purpose',
        'Related Case Resolution',
        'Contact Fragment Count',
        'Case: Athlete CS Owner',
        'Handled Count',
        'Chat Bot Transferred to Athlete',
        'Case: Queue CS Owner',
        'Initial Athlete BPO',
        'Initial Athlete Site',
        'Messaging Channel: Channel Name',
        'Created Date',
        'Service Level Met',
      ],
      dateTimeHeaders: ['Start Time', 'End Time'],
      dateHeaders: ['Created Date'],
      numberHeaders: [
        'Wait Time',
        'Total Resolution Time (minutes)',
        'Contact Fragment Count',
        'Handled Count',
      ],
      keyFields: ['Messaging Session Name'],
      maximumRows: 10000,
    }),
    makeSchema({
      name: 'AHT - Raw',
      headers: [
        'Agent Work ID',
        'Work Item: Name',
        'Athlete Site',
        'Request Date',
        'Assign Date',
        'Accept Date',
        'Close Date',
        'Chat Exit Time',
        'Handle Time - Total',
        'Handle Time',
        'After Conversation Work Actual Time',
        'Work Time',
        'Speed To Answer',
        'Speed to Answer',
        'Chat Time',
        'Wrap Time',
        'Active Time',
        'Status',
        'Is Transfer',
        'Units of Capacity',
        'Time To First Response',
        'Language',
        'Queue',
        'Country',
        'Created Date',
        'Queue: Name',
        'User: Full Name',
      ],
      aliases: { 'Speed to Answer2': 'Speed to Answer' },
      dateTimeHeaders: [
        'Request Date',
        'Assign Date',
        'Accept Date',
        'Close Date',
        'Chat Exit Time',
      ],
      dateHeaders: ['Created Date'],
      numberHeaders: [
        'Handle Time - Total',
        'Handle Time',
        'After Conversation Work Actual Time',
        'Work Time',
        'Speed To Answer',
        'Speed to Answer',
        'Chat Time',
        'Wrap Time',
        'Active Time',
        'Units of Capacity',
        'Time To First Response',
      ],
      keyFields: ['Agent Work ID'],
      maximumRows: 15000,
    }),
    makeSchema({
      name: 'Auxes - Raw',
      headers: [
        'Name',
        'User Presence ID',
        'Status Start Date',
        'Status End Date',
        'Productive Time Duration (minutes)',
        'Available Time Duration (minutes)',
        'Is Away',
        'Engaged Duration (minutes)',
        'Idle Duration',
        'Idle Status Duration (minutes)',
        'Status Duration',
        'Status Duration (minutes)',
        'Occupancy',
        'Configured Capacity',
        'Is My BPO',
        'Athlete Display Name',
        'Average Capacity',
        'At Capacity Duration',
        'Athlete CS Owner',
        'Sign On Time',
        'Sign On Time (hours)',
        'Athlete Site',
        'Created Date',
        'Service Presence Status: Status Name',
      ],
      dateTimeHeaders: ['Status Start Date', 'Status End Date'],
      dateHeaders: ['Created Date'],
      numberHeaders: [
        'Productive Time Duration (minutes)',
        'Available Time Duration (minutes)',
        'Engaged Duration (minutes)',
        'Idle Duration',
        'Idle Status Duration (minutes)',
        'Status Duration',
        'Status Duration (minutes)',
        'Occupancy',
        'Configured Capacity',
        'Average Capacity',
        'At Capacity Duration',
        'Sign On Time',
        'Sign On Time (hours)',
      ],
      keyFields: ['User Presence ID'],
      maximumRows: 7500,
    }),
    makeSchema({
      name: 'Staff',
      headers: [
        'Status Start Date',
        'Status End Date',
        'Athlete Display Name',
        'Athlete Site',
        'Athlete Profile',
      ],
      dateTimeHeaders: ['Status Start Date', 'Status End Date'],
      keyFields: [],
      maximumRows: 2000,
      technicalDedupeKey: 'canonical_full_row_hash',
    }),
  ]);
  var schemaByName = Object.create(null);
  schemas.forEach(function (schema) {
    schemaByName[schema.name] = schema;
  });

  function getSchema(name, version) {
    if (version && version !== ACTIVE_SCHEMA_VERSION) {
      return null;
    }
    return typeof name === 'string' ? schemaByName[name] || null : null;
  }

  function listSchemas() {
    return schemas.slice();
  }

  return Object.freeze({
    ACTIVE_SCHEMA_VERSION: ACTIVE_SCHEMA_VERSION,
    DATA_TYPES: DATA_TYPES,
    EMPTY_VALUE_POLICY: EMPTY_VALUE_POLICY,
    PACKAGING_CONTRACTS: PACKAGING_CONTRACTS,
    REGISTRY_RECORD_HEADERS: REGISTRY_RECORD_HEADERS,
    getSchema: getSchema,
    listSchemas: listSchemas,
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SchemaRegistry;
}
