const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { sha256 } = require('./verify-v16-required-test-manifest.js');
const { evaluateReleaseCore, releaseCoreFingerprint, readinessFromCore } = require('./v16-release-core.js');
const { hashRegularFile, capturePublicationInputs, snapshotInput, validateFrozenInputs, writeNewJson, replacePublicationFile, replacePublicationJson } = require('./v16-publication-files.js');
const { readDeliveryStatus, desiredReadme, writePublicationBundle, verifyPublicationBundle, changePublicationBundlePhase } = require('./v16-publication-bundle.js');
const { downgradeReadme, invalidatePublicationRun } = require('./v16-publication-state.js');

function publicationPaths(root, options = {}) {
  return {
    root: path.resolve(root),
    manifestPath: path.resolve(root, options.manifestPath ?? 'output/v16-evidence/current/manifest.json'),
    requirementsPath: path.resolve(root, options.requirementsPath ?? 'docs/v16_requirements_index.json'),
    readmePath: path.resolve(root, options.readmePath ?? 'README.md'),
    closurePath: path.resolve(root, options.closurePath ?? 'output/v16-evidence/current/publication-closure.json'),
    readinessPath: path.resolve(root, options.readinessPath ?? 'output/v16-evidence/v16_l8_readiness.json'),
  };
}

function requireCurrentIdentity(core) {
  if (!core.eligible) return;
  if (core.gates?.length !== 7 || !core.gates.every(gate => gate.passed) || !core.trace?.success) throw new Error('PUBLICATION_CORE_NOT_READY');
  for (const key of ['installer', 'portable', 'zip', 'appContent', 'mainBundle']) {
    if (!/^[a-f0-9]{64}$/i.test(core.identity.packageHashes?.[key] ?? '')) throw new Error('PUBLICATION_PACKAGE_IDENTITY_MISSING:' + key);
  }
}

function verifyPublicationClosure(manifest, core, root = process.cwd(), options = {}) {
  const paths = publicationPaths(root, options);
  const issues = [];
  let bundleSafety = null;
  try {
    requireCurrentIdentity(core);
    hashRegularFile(paths.closurePath);
    const closure = JSON.parse(fs.readFileSync(paths.closurePath, 'utf8'));
    if (closure.schemaVersion !== 'v16.publication-closure/1' || closure.phase !== 'PUBLISHED') issues.push('PUBLICATION_SCHEMA_MISMATCH');
    if (closure.coreSha256 !== releaseCoreFingerprint(core) || JSON.stringify(closure.identity) !== JSON.stringify(core.identity)) issues.push('PUBLICATION_CURRENT_RESULT_MISMATCH');
    if (closure.status !== (core.eligible ? 'APP_READY' : 'APP_NEEDS_WORK')) issues.push('PUBLICATION_STATUS_MISMATCH');
    const timestamp = Date.parse(closure.createdAt);
    if (!Number.isFinite(timestamp) || timestamp > Date.now() + 1000) issues.push('PUBLICATION_TIME_INVALID');
    const expected = capturePublicationInputs(paths.root, paths.manifestPath, paths.requirementsPath, manifest, core);
    if (JSON.stringify(expected) !== JSON.stringify(closure.inputs)) issues.push('PUBLICATION_INPUT_SET_MISMATCH');
    issues.push(...validateFrozenInputs(closure.inputs));
    const readme = fs.readFileSync(paths.readmePath, 'utf8');
    if (readDeliveryStatus(readme) !== closure.status || JSON.stringify(snapshotInput(paths.root, paths.readmePath)) !== JSON.stringify(closure.readme)) issues.push('PUBLICATION_README_CHANGED');
    const bundleDirectory = path.resolve(paths.root, closure.bundle?.directory ?? '');
    if (!closure.bundle?.directory || JSON.stringify(snapshotInput(paths.root, path.join(bundleDirectory, 'delivery-bundle-manifest.json'))) !== JSON.stringify(closure.bundle.manifest)) issues.push('PUBLICATION_BUNDLE_CHANGED');
    bundleSafety = verifyPublicationBundle(bundleDirectory, core, readme, expected);
    issues.push(...bundleSafety.issues);
  } catch (error) { issues.push('PUBLICATION_MISSING_OR_INVALID:' + error.message); }
  return { schemaVersion: 'v16.publication-verification/1', success: issues.length === 0, status: issues.length === 0 && core.eligible ? 'APP_READY' : 'APP_NEEDS_WORK', issues, bundleSafety };
}

function publishRelease(manifestPath, requirementsPath, root = process.cwd(), options = {}, evaluate = evaluateReleaseCore) {
  const paths = publicationPaths(root, { ...options, manifestPath, requirementsPath });
  let core;
  let ownedBundle = null;
  let ownedClosure = false;
  try {
    // 先撤销旧声明，再读输入和运行可能耗时或中断的验证。
    invalidatePublicationRun(paths);
    const manifest = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8'));
    const requirements = JSON.parse(fs.readFileSync(paths.requirementsPath, 'utf8'));
    core = evaluate(manifest, requirements, paths.root);
    requireCurrentIdentity(core);
    if (fs.existsSync(paths.closurePath)) throw new Error('PUBLICATION_ALREADY_EXISTS_USE_NEW_PATH');
    const inputs = capturePublicationInputs(paths.root, paths.manifestPath, paths.requirementsPath, manifest, core);
    const readme = desiredReadme(fs.readFileSync(paths.readmePath, 'utf8'), core);
    const bundleDirectory = path.resolve(paths.root, options.bundleDirectory ?? path.join(path.dirname(paths.closurePath), 'delivery-bundle'));
    if (fs.existsSync(bundleDirectory)) throw new Error('BUNDLE_ALREADY_EXISTS_USE_NEW_PATH');
    fs.mkdirSync(path.dirname(bundleDirectory), { recursive: true });
    const stagingDirectory = path.join(path.dirname(bundleDirectory), `.${path.basename(bundleDirectory)}.NON_READY-pending-${randomUUID()}`);
    ownedBundle = stagingDirectory;
    writePublicationBundle(stagingDirectory, core, readme, inputs, 'PREPARING');
    const bundleSafety = verifyPublicationBundle(stagingDirectory, core, readme, inputs, 'PREPARING');
    if (!bundleSafety.success) throw new Error(bundleSafety.issues.join(';'));
    const beforeCommit = evaluate(JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8')), JSON.parse(fs.readFileSync(paths.requirementsPath, 'utf8')), paths.root);
    if (releaseCoreFingerprint(core) !== releaseCoreFingerprint(beforeCommit) || validateFrozenInputs(inputs).length) throw new Error('PUBLICATION_INPUT_CHANGED_DURING_EXPORT');
    const finalCore = evaluate(JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8')), JSON.parse(fs.readFileSync(paths.requirementsPath, 'utf8')), paths.root);
    if (releaseCoreFingerprint(core) !== releaseCoreFingerprint(finalCore) || validateFrozenInputs(inputs).length) throw new Error('PUBLICATION_CURRENT_RESULT_MISMATCH');
    changePublicationBundlePhase(stagingDirectory, core, 'PUBLISHED');
    const finalBundleSafety = verifyPublicationBundle(stagingDirectory, finalCore, readme, inputs);
    if (!finalBundleSafety.success) throw new Error(finalBundleSafety.issues.join(';'));
    // 暂存与公开目录必须在同一父目录；仅移动本次创建、非链接且尚未公开的包。
    if (path.dirname(stagingDirectory) !== path.dirname(bundleDirectory)
      || fs.lstatSync(stagingDirectory).isSymbolicLink() || fs.existsSync(bundleDirectory)) throw new Error('BUNDLE_PROMOTION_TARGET_UNSAFE');
    fs.renameSync(stagingDirectory, bundleDirectory);
    ownedBundle = bundleDirectory;
    fs.mkdirSync(path.dirname(paths.closurePath), { recursive: true });
    writeNewJson(paths.closurePath, {
      schemaVersion: 'v16.publication-closure/1', phase: 'PUBLISHED', createdAt: new Date().toISOString(), identity: core.identity,
      coreSha256: releaseCoreFingerprint(core), status: core.eligible ? 'APP_READY' : 'APP_NEEDS_WORK', inputs,
      readme: { path: paths.readmePath, sha256: sha256(Buffer.from(readme)) },
      bundle: { directory: bundleDirectory, manifest: snapshotInput(paths.root, path.join(bundleDirectory, 'delivery-bundle-manifest.json')) },
    });
    ownedClosure = true;
    // 闭包和匹配包已落盘后才提交 README；所有读取端仍须按当前输入复验。
    replacePublicationFile(paths.readmePath, readme);
    const publication = verifyPublicationClosure(manifest, finalCore, paths.root, paths);
    if (!publication.success) throw new Error(publication.issues.join(';'));
    replacePublicationJson(paths.readinessPath, readinessFromCore(finalCore, publication));
    return { core, publication, closurePath: paths.closurePath, bundleDirectory };
  } catch (error) {
    const failures = [error];
    for (const invalidate of [
      () => invalidatePublicationRun(paths, error),
      () => { if (ownedBundle && fs.existsSync(path.join(ownedBundle, 'delivery-bundle-manifest.json'))) changePublicationBundlePhase(ownedBundle, core, 'ABORTED', error); },
      () => {
        if (!ownedClosure) return;
        const closure = JSON.parse(fs.readFileSync(paths.closurePath, 'utf8'));
        replacePublicationJson(paths.closurePath, { ...closure, phase: 'ABORTED', status: 'APP_NEEDS_WORK', issues: ['PUBLICATION_ABORTED:' + error.message] });
      },
    ]) {
      try { invalidate(); } catch (invalidationError) { failures.push(invalidationError); }
    }
    if (failures.length > 1) throw new AggregateError(failures, 'PUBLICATION_FAILED_AND_INVALIDATION_FAILED', { cause: error });
    throw error;
  }
}

module.exports = { publicationPaths, verifyPublicationClosure, publishRelease, downgradeReadme };
