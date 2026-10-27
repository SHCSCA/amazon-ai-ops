const fs = require('node:fs');
const path = require('node:path');
const { releaseCoreFingerprint } = require('./v16-release-core.js');
const { hashRegularFile, writeNewJson, replacePublicationJson, replacePublicationFile } = require('./v16-publication-files.js');

const PAYLOAD_NAMES = Object.freeze(['release-core.json', 'evidence-inputs.json', 'README.snapshot.md']);
const MANIFEST_NAME = 'delivery-bundle-manifest.json';

function readDeliveryStatus(readme) {
  const claims = readme.split(/\r?\n/).filter(line => /^\*\*DELIVERY:/.test(line));
  if (claims.length !== 1) throw new Error('README_DELIVERY_CLAIM_INVALID');
  const match = claims[0].match(/^\*\*DELIVERY: (APP_READY|APP_NEEDS_WORK) — (READY|INTERNAL NON_READY)\.\*\*/);
  if (!match || (match[1] === 'APP_READY') !== (match[2] === 'READY')) throw new Error('README_DELIVERY_CLAIM_INVALID');
  return match[1];
}

function desiredReadme(readme, core) {
  readDeliveryStatus(readme);
  const version = core.identity.packageVersion;
  const line = core.eligible
    ? `**DELIVERY: APP_READY — READY.** 当前版本 \`${version}\` 的完整 L1–L8 和发布闭包已通过；状态仅对该闭包输入有效。`
    : `**DELIVERY: APP_NEEDS_WORK — INTERNAL NON_READY.** 当前开发版本为 \`${version}\`，完整 L1–L8 或发布闭包尚未通过，不能作为生产就绪交付。`;
  return readme.replace(/^\*\*DELIVERY:[^\r\n]*/m, line);
}

function bundleStatus(core) { return core.eligible ? 'READY' : 'NON_READY'; }
function bundleManifestStatus(core) { return core.eligible ? 'READY_CANDIDATE' : 'NON_READY'; }

function writePublicationBundle(directory, core, readme, inputs, phase = 'PUBLISHED') {
  if (readDeliveryStatus(readme) !== (core.eligible ? 'APP_READY' : 'APP_NEEDS_WORK')) throw new Error('BUNDLE_README_STATE_MISMATCH');
  fs.mkdirSync(directory, { recursive: false });
  writeNewJson(path.join(directory, 'release-core.json'), core);
  writeNewJson(path.join(directory, 'evidence-inputs.json'), { schemaVersion: 'v16.bundle-inputs/1', inputs });
  fs.writeFileSync(path.join(directory, 'README.snapshot.md'), readme, { encoding: 'utf8', flag: 'wx' });
  const files = PAYLOAD_NAMES.map(name => ({ name, sha256: hashRegularFile(path.join(directory, name)) }));
  writeNewJson(path.join(directory, MANIFEST_NAME), {
    schemaVersion: 'v16.delivery-bundle/1', status: phase === 'PUBLISHED' ? bundleManifestStatus(core) : 'NON_READY', phase,
    requiresCurrentPublicationClosure: true, identity: core.identity,
    coreSha256: releaseCoreFingerprint(core),
    note: '本地验收证据引用包；原件按 evidence-inputs.json 独立重验，未复制正式库、密钥或运行会话。', files,
  });
  return path.join(directory, MANIFEST_NAME);
}

function verifyPublicationBundle(directory, core, readme, inputs, expectedPhase = 'PUBLISHED') {
  const issues = [];
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('BUNDLE_DIRECTORY_UNSAFE');
    const names = fs.readdirSync(directory).sort();
    const expected = [...PAYLOAD_NAMES, MANIFEST_NAME].sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) issues.push('BUNDLE_FILE_SET_MISMATCH');
    const manifestPath = path.join(directory, MANIFEST_NAME);
    hashRegularFile(manifestPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.schemaVersion !== 'v16.delivery-bundle/1' || manifest.phase !== expectedPhase
      || manifest.status !== (expectedPhase === 'PUBLISHED' ? bundleManifestStatus(core) : 'NON_READY')
      || manifest.requiresCurrentPublicationClosure !== true
      || manifest.coreSha256 !== releaseCoreFingerprint(core) || JSON.stringify(manifest.identity) !== JSON.stringify(core.identity)) issues.push('BUNDLE_CURRENT_RESULT_MISMATCH');
    const files = manifest.files;
    if (!Array.isArray(files) || JSON.stringify(files.map(file => file.name).sort()) !== JSON.stringify([...PAYLOAD_NAMES].sort())) issues.push('BUNDLE_INVENTORY_INVALID');
    for (const name of PAYLOAD_NAMES) {
      const hash = hashRegularFile(path.join(directory, name));
      if (files?.find(file => file.name === name)?.sha256 !== hash) issues.push('BUNDLE_PAYLOAD_HASH_MISMATCH:' + name);
    }
    if (fs.readFileSync(path.join(directory, 'README.snapshot.md'), 'utf8') !== readme
      || readDeliveryStatus(readme) !== (core.eligible ? 'APP_READY' : 'APP_NEEDS_WORK')) issues.push('BUNDLE_README_MISMATCH');
    if (releaseCoreFingerprint(JSON.parse(fs.readFileSync(path.join(directory, 'release-core.json'), 'utf8'))) !== releaseCoreFingerprint(core)) issues.push('BUNDLE_CORE_MISMATCH');
    const inputSnapshot = JSON.parse(fs.readFileSync(path.join(directory, 'evidence-inputs.json'), 'utf8'));
    if (inputSnapshot.schemaVersion !== 'v16.bundle-inputs/1' || JSON.stringify(inputSnapshot.inputs) !== JSON.stringify(inputs)) issues.push('BUNDLE_INPUT_SET_MISMATCH');
  } catch (error) { issues.push('BUNDLE_INVALID:' + error.message); }
  return { schemaVersion: 'v16.bundle-safety/1', success: issues.length === 0, status: bundleStatus(core), issues };
}

function changePublicationBundlePhase(directory, core, phase, failure) {
  const file = path.join(directory, MANIFEST_NAME);
  hashRegularFile(file);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.schemaVersion !== 'v16.delivery-bundle/1' || manifest.coreSha256 !== releaseCoreFingerprint(core)) throw new Error('BUNDLE_PHASE_TARGET_MISMATCH');
  manifest.phase = phase;
  manifest.status = phase === 'PUBLISHED' ? bundleManifestStatus(core) : 'NON_READY';
  if (phase === 'ABORTED') {
    manifest.failure = { code: 'PUBLICATION_ABORTED', message: String(failure?.message ?? failure) };
    const readmePath = path.join(directory, 'README.snapshot.md');
    replacePublicationFile(readmePath, desiredReadme(fs.readFileSync(readmePath, 'utf8'), { ...core, eligible: false }));
    manifest.files = PAYLOAD_NAMES.map(name => ({ name, sha256: hashRegularFile(path.join(directory, name)) }));
  }
  replacePublicationJson(file, manifest);
}

module.exports = { readDeliveryStatus, desiredReadme, writePublicationBundle, verifyPublicationBundle, changePublicationBundlePhase };
