const { ACCEPTANCE_CONTRACT_VERSION, AUTHORITY_SNAPSHOT_KIND, AUTHORITY_SNAPSHOT_SCHEMA_VERSION, BUSINESS_TIMEZONE, EXPECTED_REPORT_TYPES, SCHEMA_VERSION, US_BUSINESS_CALENDAR_VERSION } = require('./s7-continuous-contracts.js');
const { buildEvidenceManifest, evaluateContinuousOperationSnapshot } = require('./s7-continuous-evaluation.js');
const { inclusiveDates, recentCompletedUsBusinessDates, usFederalBusinessDates, usFederalHolidayDates, usWeekdayBusinessDates } = require('./s7-continuous-calendar.js');
const { loadAuthoritySnapshotManifest } = require('./s7-continuous-authority.js');
const { parseArgs, run } = require('./s7-continuous-publication.js');
const { readContinuousOperationSnapshot } = require('./s7-continuous-snapshot.js');

if (require.main === module) {
  try { process.exitCode = run(); }
  catch (error) { process.stderr.write(JSON.stringify(require('../packages/shared-types/src/runtime-log-format.cjs').createRuntimeLogRecord('error', 's7.continuous_operation_failed', { error })) + '\n'); process.exitCode = 1; }
}

module.exports = { ACCEPTANCE_CONTRACT_VERSION, AUTHORITY_SNAPSHOT_KIND, AUTHORITY_SNAPSHOT_SCHEMA_VERSION, BUSINESS_TIMEZONE, EXPECTED_REPORT_TYPES, SCHEMA_VERSION, US_BUSINESS_CALENDAR_VERSION, buildEvidenceManifest, evaluateContinuousOperationSnapshot, inclusiveDates, loadAuthoritySnapshotManifest, parseArgs, recentCompletedUsBusinessDates, readContinuousOperationSnapshot, run, usFederalBusinessDates, usFederalHolidayDates, usWeekdayBusinessDates };
