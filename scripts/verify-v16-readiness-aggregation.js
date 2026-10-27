const path = require('node:path');
const { cliArg, readJson, writeJson } = require('./verify-v16-required-test-manifest.js');
const { evaluateReleaseCore, readinessFromCore } = require('./v16-release-core.js');
const { verifyPublicationClosure, downgradeReadme } = require('./v16-publication-closure.js');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');

function aggregateReadiness(manifest, requirements, root = process.cwd(), options = {}) {
  try {
    const core = evaluateReleaseCore(manifest, requirements, root, options.trustedRuntime);
    const publication = verifyPublicationClosure(manifest, core, root, options);
    return readinessFromCore(core, publication);
  } catch (error) { return failedReadiness(error, manifest?.identity); }
}

function failedReadiness(error, identity) {
  return {
    schemaVersion: 'v16.readiness/1', timestamp: new Date().toISOString(), identity: identity ?? null,
    overallStatus: 'APP_NEEDS_WORK',
    gates: Array.from({ length: 8 }, (_, index) => ({ layer: `L${index + 1}`, title: '验收输入无法复验', passed: false })),
    issues: ['READINESS_INPUT_INVALID:' + (error instanceof Error ? error.message : String(error))],
  };
}
function main() {
  const root = path.resolve(cliArg('repo-root', process.cwd()));
  const manifestPath = cliArg('manifest');
  if (!manifestPath) throw new Error('Missing --manifest pointing to a current run manifest');
  const requirementsPath = cliArg('requirements', 'docs/v16_requirements_index.json');
  let report;
  try {
    report = aggregateReadiness(readJson(path.resolve(root, manifestPath)), readJson(path.resolve(root, requirementsPath)), root, {
      manifestPath, requirementsPath, closurePath: cliArg('publication', 'output/v16-evidence/current/publication-closure.json'),
    });
  } catch (error) { report = failedReadiness(error); }
  if (report.overallStatus !== 'APP_READY') {
    try { downgradeReadme(root, { identity: report.identity ?? { packageVersion: readJson(path.join(root, 'apps/desktop/package.json')).version } }); }
    catch (error) { report.issues.push('README_INVALIDATION_FAILED:' + error.message); }
  }
  const out = cliArg('out', path.join(root, 'output/v16-evidence/v16_l8_readiness.json'));
  writeJson(out, report);
  console.log(JSON.stringify(createRuntimeLogRecord('info', 'v16.readiness_recomputed', { status: report.overallStatus, passedGates: report.gates.filter(g => g.passed).length, output: out })));
  process.exitCode = report.overallStatus === 'APP_READY' ? 0 : 1;
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(JSON.stringify(createRuntimeLogRecord('error', 'v16.readiness_failed', { error }))); process.exitCode = 1; }
}

module.exports = { aggregateReadiness, failedReadiness, main };
