const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { digest, same, hashEqual, insist, within, readArtifact, timeWithin } = require('./v16-native-artifacts');

function verifyPackageUi(raw, descriptor, context) {
  const { validatePackageUi } = require('./verify-mission-control-production-readiness');
  const result = validatePackageUi(raw, { packageUiContract: context.current?.packageUiContract });
  insist(result.ok, 'PACKAGE_UI_CONTRACT:' + result.reason);
  for (const key of ['executableSha256', 'appContentSha256']) insist(hashEqual(result.packageIdentity[key], context.current.packageIdentity[key]), 'PACKAGE_UI_CURRENT_PACKAGE:' + key);
  insist(raw.runGroup?.runGroupId === descriptor.runId, 'PACKAGE_UI_RUN_ID_MISMATCH');
  // 专用校验器验证全部截图、不可变运行收据与店铺隔离，桥接只增加当前执行归属。
  const runs = [...raw.runs, raw.wideProfile];
  for (const run of runs) {
    const diagnostics = run.diagnostics;
    if (diagnostics?.startedAt) timeWithin(diagnostics.startedAt, context.execution, 'profile-start');
    if (diagnostics?.completedAt) timeWithin(diagnostics.completedAt, context.execution, 'profile-end');
  }
  return true;
}
function verifyRuntime(raw, descriptor, context) {
  insist(raw.kind === 'isolated-packaged-desktop-runtime' && raw.schemaVersion === 1, 'RUNTIME_SCHEMA_MISMATCH');
  insist(typeof raw.profile === 'string' && path.basename(raw.profile) === descriptor.runId, 'RUNTIME_RUN_ID_MISMATCH');
  insist(path.isAbsolute(raw.profile) && path.basename(path.dirname(raw.profile)) === 'amazon-ai-ops-runtime-validation', 'RUNTIME_PROFILE_NOT_ISOLATED');
  insist(raw.passed === true && raw.rendererErrors?.length === 0 && raw.consoleErrors?.length === 0, 'RUNTIME_DIAGNOSTICS_FAILED');
  insist(raw.target?.packaged === true && ['directory', 'installed', 'portable', 'folder-zip'].includes(raw.target.deliveryKind), 'RUNTIME_TARGET_MISMATCH');
  const expected = raw.target.deliveryKind === 'portable' ? context.identity.packageHashes.portable : context.current.packageIdentity.executableSha256;
  insist(hashEqual(raw.target.executableSha256, expected), 'RUNTIME_CURRENT_EXE_MISMATCH');
  if (raw.target.deliveryKind === 'portable') readArtifact(context.root, { path: raw.target.executablePath, sha256: expected });
  const bundleRoot = path.join(context.current.appRoot, 'dist');
  insist(raw.bundleHashes && Object.keys(raw.bundleHashes).length >= 4 && same(raw.bundleHashes, raw.expectedSourceBundleHashes), 'RUNTIME_BUNDLE_COLLECTION_MISMATCH');
  for (const [file, hash] of Object.entries(raw.bundleHashes)) {
    insist(within(bundleRoot, path.resolve(bundleRoot, file)), 'RUNTIME_BUNDLE_PATH_ESCAPE');
    readArtifact(context.root, { path: path.join(bundleRoot, file), sha256: hash });
  }
  insist(hashEqual(raw.bundleHashes['main/index.js'], context.identity.packageHashes.mainBundle), 'RUNTIME_MAIN_MISMATCH');
  insist(raw.nativeProbe?.platform === 'win32' && raw.nativeProbe.sqliteValue === 1 && raw.nativeProbe.duckdbValue === 1, 'RUNTIME_NATIVE_PROBE_FAILED');
  const sqliteRoot = path.join(context.current.appRoot, 'node_modules/better-sqlite3');
  const sqlite = fs.existsSync(path.join(sqliteRoot, 'prebuilds/win32-x64.node')) ? path.join(sqliteRoot, 'prebuilds/win32-x64.node') : path.join(sqliteRoot, 'build/Release/better_sqlite3.node');
  insist(same(raw.nativeBindings?.before, raw.nativeBindings?.after) && raw.nativeBindings?.before, 'RUNTIME_NATIVE_BINDINGS_CHANGED');
  for (const [name, file] of [['sqlite', sqlite], ['duckdb', path.join(context.current.appRoot, 'node_modules/duckdb/lib/binding/duckdb.node')]]) readArtifact(context.root, { path: file, sha256: raw.nativeBindings.before[name] });
  verifyRuntimeOriginals(descriptor, context, raw);
  insist(Array.isArray(raw.launches) && raw.launches.length === 2 && new Set(raw.launches.map(x => x.pid)).size === 2, 'RUNTIME_RESTART_NOT_INDEPENDENT');
  for (const launch of raw.launches) {
    insist(Number.isSafeInteger(launch.pid) && launch.pid > 0 && launch.userDataDir === raw.profile && launch.packaged === true, 'RUNTIME_PROFILE_PID_MISMATCH');
    const ready = launch.ready;
    insist(ready?.kind === 'package-launch-window-ready' && ready.schemaVersion === 1 && ready.evidenceMode === 'package-launch-smoke' && ready.pid === launch.pid && ready.userDataDir === raw.profile, 'RUNTIME_READY_IDENTITY_MISMATCH');
    timeWithin(ready.generatedAt, context.execution, 'window-ready');
    insist(launch.windows?.length === 1, 'RUNTIME_WINDOW_CARDINALITY');
    const win = launch.windows[0];
    insist(win.visible === true && win.destroyed === false && win.url === ready.rendererUrl && win.id === ready.browserWindowId && win.preferences?.contextIsolation === true && win.preferences.nodeIntegration === false, 'RUNTIME_WINDOW_SECURITY_MISMATCH');
    const renderer = new URL(win.url);
    insist(renderer.protocol === 'file:' && !renderer.host && !renderer.username && !renderer.password && fileURLToPath(renderer).replaceAll('\\', '/').endsWith('/resources/app/dist/renderer/index.html'), 'RUNTIME_RENDERER_NOT_PACKAGED');
  }
  insist(same(raw.canonicalBefore, raw.canonicalAfter), 'RUNTIME_CANONICAL_STATE_CHANGED');
  if (raw.target.deliveryKind === 'portable') {
    insist(raw.portableRuns?.length === 2, 'PORTABLE_NATIVE_RUNS_MISSING');
    for (const run of raw.portableRuns) {
      insist(run.identity?.processId === raw.launches.find(x => x.label === run.label)?.pid && hashEqual(run.identity.launcherSha256, expected) && hashEqual(run.identity.executableSha256, context.current.packageIdentity.executableSha256), 'PORTABLE_PROCESS_LINEAGE_MISMATCH');
      insist(run.cleanup?.extractionRemoved === true || run.extractionRemoved === true, 'PORTABLE_EXTRACTION_NOT_REMOVED');
    }
  }
  return true;
}
function verifyRuntimeOriginals(descriptor, context, raw) {
  const originals = descriptor.originals ?? [];
  const owner = path.dirname(path.resolve(context.root, descriptor.path));
  for (const role of ['first-initial', 'restart-initial', 'settings-saved', 'rules-saved', 'settings-restart', 'runtime-log']) {
    const records = originals.filter(x => x.role === role);
    insist(records.length > 0 && (role === 'runtime-log' || records.length === 1), 'RUNTIME_ORIGINAL_REQUIRED:' + role);
    for (const record of records) {
      const artifact = readArtifact(context.root, record, owner);
      if (role !== 'runtime-log') require('./canary-png-evidence').inspectPngEvidenceBytes(artifact.bytes);
    }
  }
  const logs = originals.filter(x => x.role === 'runtime-log').flatMap(record => readArtifact(context.root, record, owner).bytes.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line)));
  insist(logs.length === raw.logs?.recordCount, 'RUNTIME_LOG_COUNT_MISMATCH');
  for (const record of logs) { timeWithin(record.timestamp, context.execution, 'runtime-log'); insist(['info', 'warn', 'error'].includes(record.level) && record.event && record.context, 'RUNTIME_LOG_CONTRACT_INVALID'); }
  const errors = logs.filter(x => x.level === 'error');
  insist(errors.length === 1 && errors[0].event === 'ipc.handler_failed' && errors[0].context.channel === 'settings:save-rule-config', 'RUNTIME_LOG_UNEXPECTED_ERROR');
  insist(logs.filter(x => x.context?.message === '[StoreContextTracker] cleared during shutdown').length === 2, 'RUNTIME_LOG_SHUTDOWN_MISSING');
}
function verifyInstalled(raw, descriptor, context) {
  insist(raw.kind === 'installed-package-smoke' && raw.schemaVersion === 1 && raw.runId === descriptor.runId && raw.failures?.length === 0, 'INSTALLED_SCHEMA_OR_RUN_MISMATCH');
  readArtifact(context.root, raw.installer);
  insist(hashEqual(raw.installer.sha256, context.identity.packageHashes.installer) && hashEqual(raw.currentExe?.sha256, context.current.packageIdentity.executableSha256), 'INSTALLED_PACKAGE_IDENTITY_MISMATCH');
  const events = raw.events ?? [];
  for (const stage of ['install', 'uninstall']) {
    const start = events.filter(e => e.event === `package.${stage}.started`), end = events.filter(e => e.event === `package.${stage}.finished`);
    insist(start.length === 1 && end.length === 1 && start[0].context.pid === end[0].context.pid && end[0].context.exitCode === 0, 'INSTALLED_PROCESS_RECEIPT:' + stage);
    insist(timeWithin(end[0].timestamp, context.execution, stage) >= timeWithin(start[0].timestamp, context.execution, stage), 'INSTALLED_PROCESS_TIME:' + stage);
  }
  const final = raw.restoration?.finalSnapshot;
  insist(final && final.installationExists === false && final.registry?.length === 8 && final.registry.every(x => x.exists === false) && final.shortcuts?.length === 4 && final.shortcuts.every(x => x.exists === false) && final.processes?.length === 0, 'INSTALLED_RESTORATION_INCOMPLETE');
  insist(same(raw.canonicalBefore, raw.canonicalAfter), 'INSTALLED_CANONICAL_CHANGED');
  const runtime = context.load(descriptor.runtimeArtifactId, 'desktop-runtime');
  insist(runtime.target.deliveryKind === 'installed' && path.resolve(runtime.target.executablePath) === path.resolve(raw.paths?.installRoot ?? '', 'AmazonAIOpsAgent.exe'), 'INSTALLED_RUNTIME_OWNER_MISMATCH');
  return true;
}
function verifyZip(raw, descriptor, context) {
  insist(raw.kind === 'folder-zip-launch-smoke' && raw.schemaVersion === 1 && raw.temporaryFilesRemoved === true, 'ZIP_SCHEMA_OR_CLEANUP_MISMATCH');
  readArtifact(context.root, raw.zip);
  insist(hashEqual(raw.zip.sha256, context.identity.packageHashes.zip) && hashEqual(raw.extractedExecutable?.sha256, context.current.packageIdentity.executableSha256), 'ZIP_PACKAGE_IDENTITY_MISMATCH');
  insist(Number.isSafeInteger(raw.runtime?.processId) && raw.runtime.processId > 0 && raw.runtime.mainWindowHandle > 0 && raw.stoppedProcessIds?.includes(raw.runtime.processId), 'ZIP_PROCESS_CLEANUP_MISMATCH');
  timeWithin(raw.runtime.windowReadyGeneratedAt, context.execution, 'zip-window-ready');
  const runtime = context.load(descriptor.runtimeArtifactId, 'desktop-runtime');
  insist(runtime.target.deliveryKind === 'folder-zip' && runtime.target.executablePath === raw.extractedExecutable.path, 'ZIP_RUNTIME_OWNER_MISMATCH');
  return true;
}
function verifySecurity(raw, descriptor, context) {
  const security = require('./smoke-package-security-boundaries');
  const verified = security.validatePackageSecurityEvidence(raw, context.current.packageIdentity);
  insist(verified.passed, 'PACKAGE_SECURITY_CONTRACT:' + verified.violations.join(','));
  const sources = require('./v16-trusted-runtime').trustedSecuritySources(context);
  const recomputed = security.collectPackageSecurityBoundaries({
    packageHashes: { exeSha256: context.current.packageIdentity.executableSha256, appContentSha256: context.current.packageIdentity.appContentSha256 },
    expectedExeSha256: context.current.packageIdentity.executableSha256, expectedAppContentSha256: context.current.packageIdentity.appContentSha256,
    mainBundlePath: context.current.paths.mainBundle, ...sources,
  });
  insist(recomputed.passed && same(recomputed.checks, raw.checks), 'PACKAGE_SECURITY_SOURCE_RECHECK_FAILED');
  return true;
}
module.exports = { verifyPackageUi, verifyRuntime, verifyInstalled, verifyZip, verifySecurity };
