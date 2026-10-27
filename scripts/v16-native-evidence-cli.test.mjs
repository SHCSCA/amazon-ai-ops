import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import cli from './v16-native-evidence-cli.js';
import verifier from './verify-v16-required-test-manifest.js';
import { nativeFixture } from './v16-native-test-fixture.mjs';
const fixtures = [];
afterEach(() => fixtures.splice(0).forEach(f => f.cleanup()));
function fixture() {
  const f = nativeFixture(); fixtures.push(f);
  f.write('.gitignore', 'output/\napps/desktop/release/\n');
  execFileSync('git', ['init', '-q'], { cwd: f.root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'verifier fixture'], { cwd: f.root, stdio: 'ignore' });
  f.json('docs/v16_required_test_manifest.json', { schemaVersion: 'v16.manifest/1', requiredTests: [f.test] });
  f.raw.sourceSha256 = cli.collectIdentity(f.root).sourceSha256;
  f.json('output/native.json', f.raw);
  f.options = { root: f.root, testId: f.test.testId, packet: 'output/native.json', ...f.execution, out: 'output/native-envelope.json' };
  return f;
}
describe('原生证据封套命令', () => {
  it('封套生成后可被公共verifier重新核验，包含传递原件清单', () => {
    const f = fixture(), result = cli.createNativeEnvelope(f.options);
    expect(result.success).toBe(true);
    expect(result.envelope.inputArtifacts.length).toBeGreaterThan(10);
    expect(verifier.verifyEvidence({ ...f.test, evidencePath: result.out }, result.envelope.identity, f.root)).toMatchObject({ success: true, caseIds: f.test.requiredChecks });
  });
  it('原件缺失时写失败封套，不能被后续验证当作PASS', () => {
    const f = fixture(); fs.unlinkSync(f.originals[0].path);
    const result = cli.createNativeEnvelope(f.options);
    expect(result.success).toBe(false);
    expect(result.envelope.execution.exitCode).toBe(1);
    expect(result.envelope.result.success).toBe(false);
  });
  it('要求明确的原始包、起止时间和新输出路径', () => {
    expect(cli.parseArgs(['--test-id', 'V16-T-L5-ARTIFACTS', '--packet', 'native.json', '--started-at', '2026-10-16T00:00:00.000Z', '--finished-at', '2026-10-16T00:01:00.000Z', '--out', 'output/native.json'])).toMatchObject({ testId: 'V16-T-L5-ARTIFACTS', packet: 'native.json', out: 'output/native.json' });
  });
  it.each([[], ['--unknown', 'x'], ['--test-id', 'x', '--test-id', 'x'], ['--packet']].map(args => [args]))('缺失、重复或未知参数失败且保留结构日志', args => {
    const result = spawnSync(process.execPath, ['scripts/v16-native-evidence-cli.js', ...args], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr.trim())).toMatchObject({ level: 'error', event: 'v16.native_envelope_failed', context: { error: { message: expect.any(String) } } });
  });
});
