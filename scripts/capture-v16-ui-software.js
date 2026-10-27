const path = require('node:path');
const { fileRecord } = require('./v16-performance-artifacts');
const { collectSoftwareUi } = require('./v16-ui-software-collector');

function parseArguments(argv) {
  const accepted = new Set(['--fixture', '--out-dir', '--user-data-dir', '--screen-reader-executable']);
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index], value = argv[++index];
    if (!accepted.has(flag) || flag in result || !value || value.startsWith('--') || value.trim() !== value
      || value.includes('\0') || value.includes('://')) throw new Error('UI_SOFTWARE_ARGUMENT_INVALID:' + flag);
    result[flag] = path.resolve(value);
  }
  if (!result['--fixture'] || !result['--out-dir'] || !result['--user-data-dir']) throw new Error('UI_SOFTWARE_FIXTURE_OUTPUT_PROFILE_REQUIRED');
  return { fixtureRecord: fileRecord(result['--fixture']), output: result['--out-dir'], profile: result['--user-data-dir'], screenReaderExecutable: result['--screen-reader-executable'] };
}
async function main(argv) {
  const result = await collectSoftwareUi(parseArguments(argv));
  process.stdout.write(JSON.stringify({ artifact: result.artifact, softwarePassed: result.report.passed, formalCredit: false, status: 'NON_READY', issues: result.report.issues }) + '\n');
  if (!result.report.passed) process.exitCode = 1;
}
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
  process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'v16.ui_software_cli_failed', { error })) + '\n'); process.exitCode = 1;
});
module.exports = { parseArguments, main };
