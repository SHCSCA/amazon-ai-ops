import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyEvidence, verifyManifest, sha256, writeJson } from './verify-v16-required-test-manifest.js';
const directories = [];
afterEach(() => directories.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function fixture() {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'v16-verifier-fixture-')); directories.push(root);
  const identity = { sourceRevision: 'a'.repeat(40), sourceSha256: 'b'.repeat(64), packageVersion: '1.6.0' };
  const now = Date.now() - 100;
  const test = { testId: 'parser-contract', layer: 'L1', format: 'vitest-json', testFiles: ['sample.test.ts'], evidencePath: 'evidence.json' };
  const raw = { success: true, startTime: now, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0,
    testResults: [{ name: path.join(root, 'sample.test.ts'), status: 'passed', assertionResults: [{ fullName: 'real runner fixture', status: 'passed' }] }] };
  const evidence = { schemaVersion: 'v16.evidence/1', testId: test.testId, layer: test.layer, identity: { ...identity },
    execution: { startedAt: new Date(now - 1).toISOString(), finishedAt: new Date(now + 1).toISOString(), exitCode: 0 },
    artifact: { format: 'vitest-json', path: 'runner.json' }, result: { success: true, total: 1, passed: 1, failed: 0, skipped: 0 } };
  const manifest = { schemaVersion: 'v16.manifest/1', identity: { ...identity }, requiredTests: [test] };
  writeJson(path.join(root, 'docs/v16_required_test_manifest.json'), structuredClone(manifest));
  function write() { writeJson(path.join(root, 'runner.json'), raw); evidence.artifact.sha256 = sha256(fs.readFileSync(path.join(root, 'runner.json'))); writeJson(path.join(root, 'evidence.json'), evidence); }
  write(); return { root, identity, manifest, raw, evidence, write, verify: () => verifyManifest(manifest, root, identity) };
}
describe('mandatory runner evidence integrity', () => {
  it.each(['L4','L5','L6','L7'])('rejects self-declared passing runtime checks in %s', layer => {
    const f = fixture();
    const test = { testId: 'native-required', layer, format: 'checks-json', requiredChecks: ['real-run'], evidencePath: 'native-evidence.json' };
    const identity = { ...f.identity, packageHashes: Object.fromEntries(['installer','portable','zip','appContent','mainBundle'].map(key => [key,'c'.repeat(64)])) };
    const rawPath = path.join(f.root,'native-summary.json');
    writeJson(rawPath, { testId: test.testId, sourceSha256: identity.sourceSha256, success: true, checks: [{ id: 'real-run', passed: true }] });
    const time = new Date(Date.now()-100).toISOString();
    writeJson(path.join(f.root,test.evidencePath), { schemaVersion: 'v16.evidence/1', testId: test.testId, layer, identity,
      execution: { startedAt: time, finishedAt: time, exitCode: 0 },
      artifact: { format: 'checks-json', path: rawPath, sha256: sha256(fs.readFileSync(rawPath)) },
      result: { success: true, total: 1, passed: 1, failed: 0, skipped: 0 } });
    const result = verifyEvidence(test,identity,f.root);
    expect(result.success).toBe(false);
    expect(result.issues).toContain('NATIVE_ARTIFACT_VERIFICATION_REQUIRED');
  });
  it('accepts a complete same-identity runner result with matching actual counts', () => { expect(fixture().verify().success).toBe(true); });
  it.each([
    ['empty required manifest', f => { f.manifest.requiredTests = []; }, 'EMPTY_OR_DUPLICATE_REQUIRED_TESTS'],
    ['missing required file', f => { f.raw.testResults = []; }, 'EMPTY_OR_MISSING_TESTS'],
    ['zero executed tests', f => { f.raw.testResults[0].assertionResults = []; f.raw.numTotalTests = f.raw.numPassedTests = 0; }, 'EMPTY_OR_FAILED_SUITE'],
    ['skipped test', f => { f.raw.testResults[0].assertionResults[0].status = 'pending'; f.raw.numPassedTests = 0; f.raw.numPendingTests = 1; }, 'RUNNER_NOT_PASSED'],
    ['forged registration count', f => { f.raw.numTotalTests = 200; }, 'RUNNER_COUNT_MISMATCH'],
    ['forged evidence count', f => { f.evidence.result.passed = 200; }, 'EVIDENCE_COUNT_MISMATCH:passed'],
    ['wrong required file', f => { f.raw.testResults[0].name = 'another.test.ts'; }, 'REQUIRED_FILES_NOT_EXECUTED'],
    ['duplicate runner file', f => { f.raw.testResults.push(f.raw.testResults[0]); }, 'REQUIRED_FILES_NOT_EXECUTED'],
    ['failed runner process', f => { f.evidence.execution.exitCode = 1; }, 'RUNNER_EXIT_FAILED'],
    ['stale source', f => { f.evidence.identity.sourceSha256 = 'c'.repeat(64); }, 'STALE_IDENTITY:sourceSha256'],
    ['stale runner reused after failed spawn', f => { f.raw.startTime -= 86400000; }, 'STALE_RUNNER_TIME'],
    ['altered required manifest', f => { f.manifest.requiredTests[0].testFiles = []; }, 'REQUIRED_MANIFEST_CONTRACT_CHANGED'],
  ])('rejects %s without a schema mismatch masking the failure', (_label, mutate, code) => {
    const f = fixture(); mutate(f); f.write(); const result = f.verify();
    expect(result.success).toBe(false); expect([...result.issues, ...result.details.flatMap(test => test.issues)]).toContain(code);
  });
  it('rejects a report changed after its digest was captured', () => {
    const f = fixture(); fs.appendFileSync(path.join(f.root, 'runner.json'), ' ');
    expect(f.verify().details[0].issues).toContain('RUNNER_HASH_MISMATCH');
  });
});


describe('static evidence command integrity', () => {
  it('rejects claimed static PASS without any native command receipt', () => {
    const f = fixture();
    const test = { testId: 'static', layer: 'L2', format: 'checks-json', requiredChecks: ['typecheck'], evidencePath: 'static.json' };
    const raw = { testId: test.testId, sourceSha256: f.identity.sourceSha256, success: true, checks: [{ id: 'typecheck', passed: true }] };
    writeJson(path.join(f.root, 'static-runner.json'), raw);
    writeJson(path.join(f.root, 'static.json'), { ...f.evidence, testId: test.testId, layer: 'L2', artifact: { format: 'checks-json', path: 'static-runner.json', sha256: sha256(fs.readFileSync(path.join(f.root, 'static-runner.json'))) } });
    expect(verifyEvidence(test, f.identity, f.root).issues).toContain('MISSING_COMMAND_RECEIPTS:typecheck');
  });
});
