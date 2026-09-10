const path = require('node:path');
const { LAYERS, cliArg, readJson, verifyManifest, writeJson } = require('./verify-v16-required-test-manifest.js');
const { verifyTraceClosure } = require('./verify-v16-trace-closure.js');

const TITLES = ['单元与合同', '静态工程', '业务集成', '实包体验', '包体与安全', '正式数据与双店连续运行', '人工与策略独立真实执行'];
function aggregateReadiness(manifest, requirements, root = process.cwd()) {
  const verification = verifyManifest(manifest, root);
  const trace = verifyTraceClosure(requirements, manifest, root, verification);
  const gates = LAYERS.map((layer, i) => {
    const tests = verification.details.filter(test => test.layer === layer);
    return { layer, title: TITLES[i], passed: !verification.issues.length && tests.length > 0 && tests.every(test => test.success), tests };
  });
  gates.push({ layer: 'L8', title: '完整 MUST 追踪与交付', passed: trace.success && gates.every(g => g.passed), trace });
  return { schemaVersion: 'v16.readiness/1', timestamp: new Date().toISOString(), identity: verification.identity, overallStatus: gates.every(g => g.passed) ? 'APP_READY' : 'APP_NEEDS_WORK', gates, issues: verification.issues };
}
function main() {
  const root = path.resolve(cliArg('repo-root', process.cwd()));
  const manifestPath = cliArg('manifest');
  if (!manifestPath) throw new Error('Missing --manifest pointing to a current run manifest');
  const report = aggregateReadiness(readJson(path.resolve(root, manifestPath)), readJson(path.resolve(root, cliArg('requirements', 'docs/v16_requirements_index.json'))), root);
  const out = cliArg('out', path.join(root, 'output/v16-evidence/v16_l8_readiness.json'));
  writeJson(out, report);
  console.log(`${report.overallStatus}: ${report.gates.filter(g => g.passed).length}/8; ${out}`);
  process.exitCode = report.overallStatus === 'APP_READY' ? 0 : 1;
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { aggregateReadiness, main };
