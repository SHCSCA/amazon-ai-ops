const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function sourceIdentity(root = process.cwd()) {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    .split('\0').filter(p => /^(apps|packages|scripts)\//.test(p) || /^(package.json|pnpm-lock.yaml|pnpm-workspace.yaml|vitest.config.ts|tsconfig[^/]*|docs\/amazon_ai_ops_agent_prd_v1_6_0.md|docs\/v16_[^/]+)$/.test(p));
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    hash.update(file + '\0');
    const absolute = path.join(root, file);
    hash.update(fs.existsSync(absolute) ? fs.readFileSync(absolute) : '[DELETED]');
    hash.update('\0');
  }
  return {
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceSha256: hash.digest('hex'),
    packageVersion: readJson(path.join(root, 'apps/desktop/package.json')).version,
  };
}
function parseMustRequirements(text) {
  let section = '';
  return text.split(/\r?\n/).flatMap((line, i) => {
    if (/^#{1,6} /.test(line)) section = line.replace(/^#+ /, '');
    const match = line.match(/^\|\s*(V16-[A-Z0-9-]+)\s*\|\s*MUST\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/);
    return match ? [{ id: match[1], title: match[2], priority: 'MUST', section, line: i + 1, acceptanceIds: match[3].match(/AC-[A-Z0-9-]+/g) ?? [] }] : [];
  });
}
const unique = list => Array.isArray(list) && list.length > 0 && new Set(list).size === list.length;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const absoluteFile = (root, file) => path.resolve(root, file).replaceAll('\\', '/');

function summarizeVitest(report, testFiles, root = process.cwd()) {
  const issues = [];
  const files = report?.testResults;
  if (!unique(testFiles) || !Array.isArray(files) || !files.length) return { success: false, total: 0, passed: 0, failed: 0, skipped: 0, issues: ['EMPTY_OR_MISSING_TESTS'] };
  const actual = files.map(file => absoluteFile(root, file.name ?? ''));
  const expected = testFiles.map(file => absoluteFile(root, file));
  if (!unique(actual) || !same([...actual].sort(), [...expected].sort())) issues.push('REQUIRED_FILES_NOT_EXECUTED');
  const assertions = files.flatMap(file => Array.isArray(file.assertionResults) ? file.assertionResults : []);
  const result = {
    total: assertions.length,
    passed: assertions.filter(test => test.status === 'passed').length,
    failed: assertions.filter(test => test.status === 'failed').length,
    skipped: assertions.filter(test => !['passed', 'failed'].includes(test.status)).length,
  };
  if (files.some(file => file.status !== 'passed' || !file.assertionResults?.length)) issues.push('EMPTY_OR_FAILED_SUITE');
  if (!result.total || result.failed || result.skipped || result.passed !== result.total || report.success !== true) issues.push('RUNNER_NOT_PASSED');
  if (report.numTotalTests !== result.total || report.numPassedTests !== result.passed || report.numFailedTests !== result.failed || report.numPendingTests !== result.skipped) issues.push('RUNNER_COUNT_MISMATCH');
  return { success: !issues.length, ...result, issues };
}

function verifyEvidence(test, identity, root = process.cwd()) {
  const issues = [];
  try {
    const evidence = readJson(path.resolve(root, test.evidencePath));
    if (evidence.schemaVersion !== 'v16.evidence/1' || evidence.testId !== test.testId || evidence.layer !== test.layer) issues.push('EVIDENCE_CONTRACT_MISMATCH');
    for (const key of ['sourceRevision', 'sourceSha256', 'packageVersion']) if (!identity?.[key] || evidence.identity?.[key] !== identity[key]) issues.push('STALE_IDENTITY:' + key);
    if (['L4', 'L5', 'L6', 'L7'].includes(test.layer)) {
      for (const key of ['installer', 'portable', 'zip', 'appContent', 'mainBundle']) {
        if (!/^[a-f0-9]{64}$/i.test(identity?.packageHashes?.[key] ?? '') || evidence.identity?.packageHashes?.[key] !== identity.packageHashes[key]) issues.push('PACKAGE_IDENTITY_MISMATCH:' + key);
      }
    }
    if (evidence.execution?.exitCode !== 0) issues.push('RUNNER_EXIT_FAILED');
    const start = Date.parse(evidence.execution?.startedAt), end = Date.parse(evidence.execution?.finishedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end > Date.now() + 1000) issues.push('INVALID_EXECUTION_TIME');
    if (evidence.artifact?.format !== test.format) issues.push('RUNNER_FORMAT_MISMATCH');
    const bytes = fs.readFileSync(path.resolve(root, evidence.artifact.path));
    if (sha256(bytes) !== evidence.artifact.sha256) issues.push('RUNNER_HASH_MISMATCH');
    const raw = JSON.parse(bytes.toString('utf8'));
    let result;
    let caseIds = [];
    if (test.format === 'vitest-json') {
      result = summarizeVitest(raw, test.testFiles, root);
      caseIds = (raw.testResults ?? []).flatMap(file => (file.assertionResults ?? [])
        .filter(assertion => assertion.status === 'passed')
        .map(assertion => `${path.relative(root, absoluteFile(root, file.name)).replaceAll('\\', '/')}::${String(assertion.fullName).trim()}`));
      issues.push(...result.issues);
      if (raw.startTime < start || raw.startTime > end || !Number.isFinite(raw.startTime)) issues.push('STALE_RUNNER_TIME');
    } else if (test.format === 'checks-json') {
      // Runtime/business acceptance needs a schema-specific verifier of native artifacts.
      // A producer's boolean summary cannot establish UI, package, store or Ads truth.
      if (['L4','L5','L6','L7'].includes(test.layer)) issues.push('NATIVE_ARTIFACT_VERIFICATION_REQUIRED');
      const checks = raw.checks;
      if (test.layer === 'L2') caseIds = (checks ?? []).filter(check => check.passed).map(check => check.id);
      if (!unique(test.requiredChecks) || !Array.isArray(checks) || !unique(checks.map(check => check.id)) || !same(checks.map(c => c.id).sort(), [...test.requiredChecks].sort())) issues.push('REQUIRED_CHECKS_NOT_EXECUTED');
      result = { success: raw.success === true, total: checks?.length ?? 0, passed: checks?.filter(c => c.passed === true).length ?? 0, failed: checks?.filter(c => c.passed !== true).length ?? 0, skipped: 0 };
      if (!result.success || !result.total || result.failed) issues.push('CHECKS_FAILED');
      if (raw.sourceSha256 !== identity.sourceSha256 || raw.testId !== test.testId) issues.push('CHECKS_IDENTITY_MISMATCH');
      if (test.layer === 'L2') {
        for (const check of checks ?? []) {
          if (!Array.isArray(check.commands) || check.commands.length !== (check.id === 'main-preload-build' ? 2 : 1)) {
            issues.push('MISSING_COMMAND_RECEIPTS:' + check.id);
            continue;
          }
          for (const command of check.commands) {
            if (command.exitCode !== 0 || !command.executable || !command.args?.length
              || Date.parse(command.startedAt) < start || Date.parse(command.finishedAt) > end
              || !(Date.parse(command.finishedAt) >= Date.parse(command.startedAt))) issues.push('FAILED_COMMAND:' + check.id);
            if (!command.log?.sha256 || sha256(fs.readFileSync(path.resolve(root, command.log.path))) !== command.log.sha256) issues.push('COMMAND_LOG_MISMATCH:' + check.id);
          }
          if (check.id === 'package-script-contracts') {
            const runner = fs.readFileSync(path.resolve(root, check.runner.path));
            if (sha256(runner) !== check.runner.sha256 || !summarizeVitest(JSON.parse(runner), ['scripts/package-scripts.test.mjs', 'scripts/build-windows-package.test.mjs'], root).success) issues.push('PACKAGE_SCRIPT_RUNNER_FAILED');
          }
        }
      }
    } else { issues.push('UNSUPPORTED_RUNNER'); result = { total: 0, passed: 0, failed: 0, skipped: 0 }; }
    for (const key of ['total', 'passed', 'failed', 'skipped']) if (evidence.result?.[key] !== result[key]) issues.push('EVIDENCE_COUNT_MISMATCH:' + key);
    if (evidence.result?.success !== true) issues.push('EVIDENCE_NOT_PASSED');
    return { testId: test.testId, layer: test.layer, ...result, caseIds, success: !issues.length, issues };
  } catch (error) {
    return { testId: test.testId, layer: test.layer, success: false, total: 0, passed: 0, failed: 0, skipped: 0, issues: ['MISSING_OR_INVALID_EVIDENCE: ' + error.message] };
  }
}

function verifyManifest(manifest, root = process.cwd(), current = sourceIdentity(root)) {
  const issues = [];
  const tests = manifest?.requiredTests;
  if (manifest?.schemaVersion !== 'v16.manifest/1') issues.push('MANIFEST_VERSION_MISMATCH');
  if (!Array.isArray(tests) || !unique(tests.map(test => test.testId))) issues.push('EMPTY_OR_DUPLICATE_REQUIRED_TESTS');
  try {
    const definition = readJson(path.join(root, 'docs/v16_required_test_manifest.json'));
    const contract = test => ({ testId: test.testId, layer: test.layer, format: test.format, testFiles: test.testFiles, requiredChecks: test.requiredChecks, requirementIds: test.requirementIds });
    if (!same(definition.requiredTests.map(contract), (tests ?? []).map(contract))) issues.push('REQUIRED_MANIFEST_CONTRACT_CHANGED');
    const all = definition.requiredTests.find(test => test.testId === 'V16-T-L1-ALL');
    if (all) {
      const inventory = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
        .split('\0').filter(file => /^(apps|packages|scripts)\/.+\.(test|spec)\.[cm]?[jt]sx?$/.test(file) && fs.existsSync(path.join(root, file)));
      if (!same([...new Set(inventory)].sort(), [...all.testFiles].sort())) issues.push('TEST_INVENTORY_INCOMPLETE');
    }
  } catch (error) { issues.push('REQUIRED_MANIFEST_UNAVAILABLE:' + error.message); }
  for (const key of ['sourceRevision', 'sourceSha256', 'packageVersion']) if (manifest?.identity?.[key] !== current[key]) issues.push('STALE_MANIFEST:' + key);
  if (manifest?.identity?.packageHashes) {
    try {
      const release = path.join(root, 'apps/desktop/release');
      const version = current.packageVersion;
      const files = { installer: `AmazonAIOpsAgent-${version}.exe`, portable: `AmazonAIOpsAgent-${version}-portable.exe`, zip: `AmazonAIOpsAgent-${version}.zip`, mainBundle: 'win-unpacked/resources/app/dist/main/index.js' };
      for (const [key, file] of Object.entries(files)) {
        if (sha256(fs.readFileSync(path.join(release, file))).toLowerCase() !== String(manifest.identity.packageHashes[key]).toLowerCase()) issues.push('CURRENT_PACKAGE_FILE_MISMATCH:' + key);
      }
      const appContent = require('./package-ui-evidence').buildAppContentManifest(path.join(release, 'win-unpacked/resources/app'));
      if (appContent.sha256.toLowerCase() !== String(manifest.identity.packageHashes.appContent).toLowerCase()) issues.push('CURRENT_PACKAGE_CONTENT_MISMATCH');
    } catch (error) { issues.push('CURRENT_PACKAGE_UNAVAILABLE:' + error.message); }
  }
  const details = (Array.isArray(tests) ? tests : []).map(test => verifyEvidence(test, { ...current, packageHashes: manifest.identity?.packageHashes }, root));
  if (details.some(test => !LAYERS.includes(test.layer))) issues.push('INVALID_TEST_LAYER');
  return { schemaVersion: 'v16.manifest-verification/1', verifiedAt: new Date().toISOString(), identity: current, success: issues.length === 0 && details.length > 0 && details.every(d => d.success), issues, details };
}
function cliArg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? fallback : process.argv[i + 1];
}
function main() {
  const manifestPath = cliArg('manifest');
  if (!manifestPath) throw new Error('Missing --manifest');
  const root = path.resolve(cliArg('repo-root', process.cwd()));
  const result = verifyManifest(readJson(manifestPath), root);
  const out = cliArg('out', path.join(root, 'output/v16-evidence/manifest-verification.json'));
  writeJson(out, result);
  console.log(`V1.6 required evidence: ${result.success ? 'PASS' : 'FAIL'}; ${result.details.filter(d => d.success).length}/${result.details.length} suites; ${out}`);
  process.exitCode = result.success ? 0 : 1;
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { LAYERS, sha256, readJson, writeJson, sourceIdentity, parseMustRequirements, summarizeVitest, verifyEvidence, verifyManifest, cliArg, main };
