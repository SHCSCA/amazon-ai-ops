const path = require('node:path');
const { cliArg, readJson } = require('./verify-v16-required-test-manifest.js');
const { publishRelease, downgradeReadme, publicationPaths } = require('./v16-publication-closure.js');
const { invalidatePublicationRun } = require('./v16-publication-state.js');
const { replacePublicationJson } = require('./v16-publication-files.js');
const { aggregateReadiness } = require('./verify-v16-readiness-aggregation.js');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');

function main() {
  const root = path.resolve(cliArg('repo-root', process.cwd()));
  const manifestPath = cliArg('manifest', 'output/v16-evidence/current/manifest.json');
  const requirementsPath = cliArg('requirements', 'docs/v16_requirements_index.json');
  const output = path.resolve(root, cliArg('out', 'output/v16-evidence/v16_l8_readiness.json'));
  const options = {
    manifestPath, requirementsPath,
    closurePath: cliArg('publication', 'output/v16-evidence/current/publication-closure.json'),
    readinessPath: output,
    ...(cliArg('bundle') ? { bundleDirectory: cliArg('bundle') } : {}),
  };
  try {
    const published = publishRelease(manifestPath, requirementsPath, root, options);
    const report = aggregateReadiness(readJson(path.resolve(root, manifestPath)), readJson(path.resolve(root, requirementsPath)), root, options);
    if (report.overallStatus !== 'APP_READY') downgradeReadme(root);
    replacePublicationJson(output, report);
    console.log(JSON.stringify(createRuntimeLogRecord('info', 'v16.publication_completed', { status: report.overallStatus, closure: published.closurePath, bundle: published.bundleDirectory, output })));
    process.exitCode = report.overallStatus === 'APP_READY' ? 0 : 1;
  } catch (error) {
    try { invalidatePublicationRun(publicationPaths(root, options), error); }
    catch (invalidationError) { throw new AggregateError([error, invalidationError], 'PUBLICATION_CLI_INVALIDATION_FAILED', { cause: error }); }
    throw error;
  }
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(JSON.stringify(createRuntimeLogRecord('error', 'v16.publication_failed', { error }))); process.exitCode = 1; }
}
module.exports = { main };
