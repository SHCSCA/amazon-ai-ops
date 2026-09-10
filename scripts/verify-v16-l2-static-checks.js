const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { cliArg, readJson, writeJson, sha256, sourceIdentity, summarizeVitest } = require('./verify-v16-required-test-manifest');

function runStaticChecks(root, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const definition = readJson(path.join(root, 'docs/v16_required_test_manifest.json'));
  const test = definition.requiredTests.find(test => test.testId === 'V16-T-L2-STATIC');
  const identity = sourceIdentity(root), startedAt = new Date().toISOString();
  const desktop = path.join(root, 'apps/desktop');
  const runnerPath = path.join(dir, 'L2-package-contracts.runner.json');
  const contracts = ['scripts/package-scripts.test.mjs', 'scripts/build-windows-package.test.mjs'];
  const commands = {
    typecheck: [{ executable: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args: ['-r', '--no-bail', 'run', 'typecheck'], cwd: root }],
    'renderer-build': [{ executable: process.execPath, args: [path.join(desktop, 'node_modules/vite/bin/vite.js'), 'build'], cwd: desktop }],
    'main-preload-build': ['main', 'preload'].map(part => ({ executable: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args: ['run', 'build:' + part], cwd: desktop })),
    'package-script-contracts': [{ executable: process.execPath, args: [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...contracts, '--reporter=json', '--outputFile=' + runnerPath], cwd: root }],
  };
  if (!test || JSON.stringify(test.requiredChecks) !== JSON.stringify(Object.keys(commands))) throw new Error('L2 required command inventory mismatch');
  if (fs.existsSync(runnerPath)) fs.unlinkSync(runnerPath);
  const checks = Object.entries(commands).map(([id, steps]) => {
    const receipts = steps.map((command, i) => {
      console.log('L2: ' + id + ' ' + (i + 1));
      const commandStart = new Date().toISOString();
      const run = spawnSync(command.executable, command.args, { cwd: command.cwd, shell: process.platform === 'win32' && command.executable.endsWith('.cmd'), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      const log = path.join(dir, id + '-' + i + '.log');
      fs.writeFileSync(log, (run.stdout ?? '') + (run.stderr ?? '') + (run.error?.message ?? ''));
      return { ...command, startedAt: commandStart, finishedAt: new Date().toISOString(), exitCode: run.status, log: { path: log, sha256: sha256(fs.readFileSync(log)) } };
    });
    const check = { id, commands: receipts, passed: receipts.every(receipt => receipt.exitCode === 0) };
    if (id === 'package-script-contracts') {
      check.runner = { path: runnerPath, sha256: fs.existsSync(runnerPath) ? sha256(fs.readFileSync(runnerPath)) : null, testFiles: contracts };
      check.passed = check.passed && fs.existsSync(runnerPath) && summarizeVitest(readJson(runnerPath), contracts, root).success;
    }
    return check;
  });
  const unchanged = JSON.stringify(identity) === JSON.stringify(sourceIdentity(root));
  const raw = { testId: test.testId, sourceSha256: identity.sourceSha256, success: unchanged && checks.every(check => check.passed), checks };
  const artifact = path.join(dir, test.testId + '.runner.json'); writeJson(artifact, raw);
  const result = { success: raw.success, total: checks.length, passed: checks.filter(check => check.passed).length, failed: checks.filter(check => !check.passed).length, skipped: 0 };
  writeJson(path.join(dir, test.testId + '.json'), { schemaVersion: 'v16.evidence/1', testId: test.testId, layer: test.layer, identity, execution: { startedAt, finishedAt: new Date().toISOString(), exitCode: raw.success ? 0 : 1 }, artifact: { format: 'checks-json', path: artifact, sha256: sha256(fs.readFileSync(artifact)) }, result });
  writeJson(path.join(dir, 'manifest.json'), { ...definition, identity, requiredTests: definition.requiredTests.map(test => ({ ...test, evidencePath: path.join(dir, test.testId + '.json') })) });
  return result;
}
if (require.main === module) {
  try {
    const root = path.resolve(cliArg('repo-root', process.cwd()));
    const result = runStaticChecks(root, path.resolve(root, cliArg('out-dir', 'output/v16-evidence/current')));
    console.log(JSON.stringify(result)); process.exitCode = result.success ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { runStaticChecks };
