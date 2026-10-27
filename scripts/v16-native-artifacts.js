const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hashEqual = (a, b) => /^[a-f0-9]{64}$/i.test(a ?? '') && String(a).toLowerCase() === String(b).toLowerCase();
const artifactLedgers = [];
function withArtifactLedger(ledger, callback, artifactRoots = []) {
  artifactLedgers.push({ ledger, artifactRoots });
  try { return callback(); } finally { artifactLedgers.pop(); }
}
function insist(condition, code) { if (!condition) throw new Error(code); }
function absolute(root, value) {
  insist(typeof value === 'string' && value.trim() === value && value && !value.includes('\0'), 'INVALID_ARTIFACT_PATH');
  return path.resolve(root, value);
}
function within(root, value) {
  const relative = path.relative(path.resolve(root), path.resolve(value));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
function readArtifact(root, record, ownerRoot = root) {
  insist(record && hashEqual(record.sha256, record.sha256), 'ARTIFACT_DIGEST_REQUIRED');
  const file = absolute(root, record.path);
  const scope = artifactLedgers.at(-1);
  const allowed = within(ownerRoot, file) || (ownerRoot === root && scope?.artifactRoots.some(directory => within(directory, file)));
  insist(allowed, 'ARTIFACT_OUTSIDE_OWNER:' + file);
  const stat = fs.lstatSync(file), real = fs.realpathSync.native(file);
  insist(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && path.resolve(real).toLowerCase() === file.toLowerCase(), 'ARTIFACT_NOT_UNIQUE_REGULAR:' + file);
  const bytes = fs.readFileSync(file);
  insist(hashEqual(digest(bytes), record.sha256) && (record.sizeBytes == null || record.sizeBytes === bytes.length), 'ARTIFACT_BYTES_CHANGED:' + file);
  const after = fs.statSync(file);
  insist(after.size === stat.size && after.mtimeMs === stat.mtimeMs, 'ARTIFACT_CHANGED_DURING_READ:' + file);
  scope?.ledger.set(file.toLowerCase(), { path: file, sha256: digest(bytes), sizeBytes: bytes.length });
  return { file, bytes, stat, json: () => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) };
}
function timeWithin(value, execution, label) {
  const n = Date.parse(value), start = Date.parse(execution.startedAt), end = Date.parse(execution.finishedAt);
  insist(Number.isFinite(n) && n >= start && n <= end && end <= Date.now() + 1000, 'NATIVE_TIME_OUTSIDE_EXECUTION:' + label);
  return n;
}
function currentPackage(root, identity) {
  const release = path.join(root, 'apps/desktop/release');
  const appRoot = path.join(release, 'win-unpacked/resources/app');
  const paths = { installer: path.join(release, `AmazonAIOpsAgent-${identity.packageVersion}.exe`), portable: path.join(release, `AmazonAIOpsAgent-${identity.packageVersion}-portable.exe`), zip: path.join(release, `AmazonAIOpsAgent-${identity.packageVersion}.zip`), mainBundle: path.join(appRoot, 'dist/main/index.js') };
  for (const [key, file] of Object.entries(paths)) readArtifact(root, { path: file, sha256: identity.packageHashes?.[key] });
  const ui = require('./package-ui-evidence');
  const app = ui.buildAppContentManifest(appRoot);
  insist(hashEqual(app.sha256, identity.packageHashes?.appContent), 'NATIVE_CURRENT_APP_CONTENT_MISMATCH');
  const executablePath = path.join(release, 'win-unpacked/AmazonAIOpsAgent.exe');
  const exe = fs.readFileSync(executablePath);
  readArtifact(root, { path: executablePath, sha256: digest(exe) });
  for (const record of app.files) readArtifact(root, { ...record, path: path.join(appRoot, record.path) });
  return { release, appRoot, paths, executablePath, packageIdentity: { executableSha256: digest(exe).toUpperCase(), appContentSha256: app.sha256.toUpperCase(), mainBundleSha256: identity.packageHashes.mainBundle.toUpperCase() } };
}
function structuredFailure(event, error, context = {}) {
  return { timestamp: new Date().toISOString(), level: 'error', event, context: { ...context, error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) } } };
}
module.exports = { digest, same, hashEqual, insist, absolute, within, readArtifact, timeWithin, currentPackage, structuredFailure, withArtifactLedger };
