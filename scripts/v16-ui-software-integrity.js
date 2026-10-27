const { digest } = require('./v16-performance-artifacts');

function inspectFinalIdentity(report, before, readers, writer) {
  const checks = [
    ['sourceUnchanged', 'UI_SOFTWARE_SOURCE_CHANGED_DURING_RUN', before.source, readers.source],
    ['packageUnchanged', 'UI_SOFTWARE_PACKAGE_CHANGED_DURING_RUN', before.packageIdentity, readers.packageIdentity],
    ['canonicalDataUnchanged', 'UI_SOFTWARE_CANONICAL_STATE_CHANGED', before.canonical, readers.canonical],
  ];
  for (const [field, code, expected, read] of checks) {
    try {
      report[field] = JSON.stringify(expected) === JSON.stringify(read());
      if (!report[field]) report.issues.push({ code });
    } catch (error) {
      report[field] = false;
      writer.log('v16.ui_software_final_identity_failed', error, { field });
      report.issues.push({ code, diagnostic: error.message });
    }
  }
}

function failureRecord(record) {
  const containsError = value => value && typeof value === 'object' && (value.level === 'error' || Object.entries(value)
    .some(([key, item]) => key === 'error' ? item != null && item !== '' : containsError(item)));
  return Boolean(record.level === 'error' || containsError(record.context) || containsError(record.diagnostic));
}
function inspectRuntimeLogFailures(records, expectedRecords = []) {
  const expected = new Map(expectedRecords.map(record => [digest(Buffer.from(JSON.stringify(record))), 0]));
  const unexpected = [];
  for (const record of records.filter(failureRecord)) {
    const key = digest(Buffer.from(JSON.stringify(record)));
    if (expected.has(key)) expected.set(key, expected.get(key) + 1);
    else unexpected.push(record);
  }
  return { unexpected, missingOrRepeatedExpected: [...expected].filter(([, count]) => count !== 1)
    .map(([sha256, count]) => ({ sha256, count })) };
}
module.exports = { inspectFinalIdentity, failureRecord, inspectRuntimeLogFailures };
