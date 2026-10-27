const fs = require('node:fs');
const path = require('node:path');
const { sourceIdentity, readJson, sha256 } = require('./verify-v16-required-test-manifest');
const { verifyNativeEvidence } = require('./v16-native-evidence');
const { within, insist, structuredFailure } = require('./v16-native-artifacts');

function collectIdentity(root) {
  const identity = sourceIdentity(root), release = path.join(root, 'apps/desktop/release');
  const app = path.join(release, 'win-unpacked/resources/app');
  const files = { installer: `AmazonAIOpsAgent-${identity.packageVersion}.exe`, portable: `AmazonAIOpsAgent-${identity.packageVersion}-portable.exe`, zip: `AmazonAIOpsAgent-${identity.packageVersion}.zip`, mainBundle: 'win-unpacked/resources/app/dist/main/index.js' };
  identity.packageHashes = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, sha256(fs.readFileSync(path.join(release, file)))]));
  identity.packageHashes.appContent = require('./package-ui-evidence').buildAppContentManifest(app).sha256.toLowerCase();
  return identity;
}
function createNativeEnvelope(options) {
  const root = path.resolve(options.root ?? process.cwd()), out = path.resolve(root, options.out);
  insist(within(path.join(root, 'output'), out) && !fs.existsSync(out), 'NATIVE_OUTPUT_MUST_BE_NEW_OWNED_FILE');
  const definition = readJson(path.join(root, 'docs/v16_required_test_manifest.json'));
  const test = definition.requiredTests.find(test => test.testId === options.testId);
  insist(test && ['L4', 'L5', 'L6', 'L7'].includes(test.layer), 'UNKNOWN_NATIVE_TEST_ID');
  const packetPath = path.resolve(root, options.packet), bytes = fs.readFileSync(packetPath), raw = JSON.parse(bytes);
  const identity = collectIdentity(root);
  const execution = { startedAt: options.startedAt, finishedAt: options.finishedAt, exitCode: 0 };
  const start = Date.parse(execution.startedAt), end = Date.parse(execution.finishedAt);
  insist(Number.isFinite(start) && Number.isFinite(end) && end >= start && end <= Date.now() + 1000, 'INVALID_EXECUTION_TIME');
  const verified = verifyNativeEvidence(raw, test, identity, root, execution);
  execution.exitCode = verified.success ? 0 : 1;
  const result = Object.fromEntries(['success', 'total', 'passed', 'failed', 'skipped'].map(key => [key, verified[key]]));
  const envelope = { schemaVersion: 'v16.evidence/1', testId: test.testId, layer: test.layer, identity, execution,
    artifact: { format: 'checks-json', path: packetPath, sha256: sha256(bytes) }, result,
    diagnostics: verified.diagnostics, issues: verified.issues, inputArtifacts: verified.inputArtifacts,
  };
  insist(sha256(fs.readFileSync(packetPath)) === envelope.artifact.sha256, 'NATIVE_PACKET_CHANGED_DURING_VERIFICATION');
  insist(sourceIdentity(root).sourceSha256 === identity.sourceSha256, 'NATIVE_SOURCE_CHANGED_DURING_VERIFICATION');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(envelope, null, 2) + '\n', { flag: 'wx' });
  return { success: verified.success, envelope, out };
}
function parseArgs(argv) {
  const allowed = new Set(['repo-root', 'test-id', 'packet', 'started-at', 'finished-at', 'out']), values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]?.replace(/^--/, '');
    insist(argv[i]?.startsWith('--') && allowed.has(name) && !Object.hasOwn(values, name) && argv[i + 1] && !argv[i + 1].startsWith('--'), 'INVALID_NATIVE_CLI_ARGUMENT:' + argv[i]);
    values[name] = argv[i + 1];
  }
  for (const key of ['test-id', 'packet', 'started-at', 'finished-at', 'out']) insist(values[key], 'MISSING_NATIVE_CLI_ARGUMENT:' + key);
  return { root: values['repo-root'], testId: values['test-id'], packet: values.packet, startedAt: values['started-at'], finishedAt: values['finished-at'], out: values.out };
}
if (require.main === module) {
  try {
    const result = createNativeEnvelope(parseArgs(process.argv.slice(2)));
    process.stdout.write(JSON.stringify({ timestamp: new Date().toISOString(), level: result.success ? 'info' : 'error', event: 'v16.native_envelope_created', context: { success: result.success, path: result.out } }) + '\n');
    process.exitCode = result.success ? 0 : 1;
  } catch (error) { process.stderr.write(JSON.stringify(structuredFailure('v16.native_envelope_failed', error)) + '\n'); process.exitCode = 1; }
}
module.exports = { collectIdentity, createNativeEnvelope, parseArgs };
