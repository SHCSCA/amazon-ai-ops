const fs = require('node:fs');
const path = require('node:path');
const { collectIdentity } = require('./v16-native-evidence-cli');
const { currentBuild } = require('./v16-ui-software-collector');
const { createNativeSoftwareFixture } = require('./v16-native-software-fixture');
const { insist } = require('./v16-performance-artifacts');

function parseArguments(argv) {
  const values = {}, allowed = new Set(['--fixture', '--out-dir']);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    insist(allowed.has(flag) && !(flag in values) && typeof value === 'string' && value.trim() === value
      && value && !value.includes('\0') && !value.includes('://') && !value.startsWith('--'), 'SOFTWARE_FIXTURE_CLI_ARGUMENT_INVALID');
    values[flag] = value;
  }
  insist(['typical', 'maximum'].includes(values['--fixture']) && values['--out-dir'], 'SOFTWARE_FIXTURE_CLI_OUTPUT_KIND_REQUIRED');
  return { fixture: values['--fixture'], directory: path.resolve(values['--out-dir']) };
}
async function main(argv, root = process.cwd()) {
  const options = parseArguments(argv), identity = collectIdentity(root);
  currentBuild(root, identity);
  const fixture = await createNativeSoftwareFixture({ ...options, identity, repositoryRoot: root });
  try {
    const after = collectIdentity(root);
    currentBuild(root, after);
    insist(JSON.stringify(identity) === JSON.stringify(after), 'SOFTWARE_FIXTURE_SOURCE_OR_PACKAGE_CHANGED');
  } catch (error) {
    fixture.generationState = 'STALE'; fixture.generationFailure = error.message;
    fs.writeFileSync(path.join(options.directory, 'fixture.json'), JSON.stringify(fixture, null, 2) + '\n');
    throw error;
  }
  process.stdout.write(JSON.stringify({ fixturePath: path.join(options.directory, 'fixture.json'), fixture: fixture.fixture,
    classification: fixture.classification, formalCredit: false, minimumImportedRows: fixture.volume.minimumImportedRows,
    status: 'PREPARED_ISOLATED_SOFTWARE' }) + '\n');
  return fixture;
}
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
  process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'v16.software_fixture_cli_failed', { error })) + '\n'); process.exitCode = 1;
});
module.exports = { parseArguments, main };
