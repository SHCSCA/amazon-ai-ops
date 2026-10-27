const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { readBound, insist } = require('./v16-performance-artifacts');
const { creationTicks } = require('./v16-performance-process-binding');

const samePath = (left, right) => typeof left === 'string' && typeof right === 'string'
  && path.isAbsolute(left) && path.isAbsolute(right) && path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
const pid = value => Number.isSafeInteger(value) && value > 0;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const birth = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/.test(value);

function readOriginal(record, run) {
  insist(record && Number.isSafeInteger(record.sizeBytes) && record.sizeBytes > 0, 'PACKAGE_UI_NATIVE_ORIGINAL_REQUIRED');
  const bound = readBound(record);
  insist(bound.bytes.length === record.sizeBytes, 'PACKAGE_UI_NATIVE_ORIGINAL_SIZE_MISMATCH');
  const root = run.attemptArtifacts?.rootPath;
  if (root) {
    const relative = path.relative(root, bound.path);
    insist(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep),
      'PACKAGE_UI_NATIVE_ORIGINAL_OUTSIDE_ATTEMPT');
  }
  return bound.json();
}

function validatePackageUiNativeEvidence(run, { requireReader = false, artifacts } = {}) {
  const violations = [];
  try {
    const native = readOriginal(run.nativeLaunch, run), cleanup = readOriginal(run.nativeCleanup, run);
    const identity = native.identity, binding = native.processBinding, main = binding?.main;
    const held = native.verification?.mainExitObserver, window = identity?.windows?.[0];
    const direct = binding?.method === 'windows-direct';
    insist(native.kind === 'v16-package-ui-native-launch' && native.schemaVersion === 1
      && ['windows-shell', 'windows-direct'].includes(binding?.method) && identity?.packaged === true
      && identity.evidenceMode === 'package-ui' && pid(identity.pid) && pid(binding.collectorPid)
      && main?.pid === identity.pid && pid(main.parentPid) && birth(main.creationTimeUtc)
      && samePath(main.executablePath, identity.executablePath) && identity.windows?.length === 1
      && pid(window.id) && pid(window.rendererPid) && window.rendererPid !== identity.pid && window.visible === true
      && Number.isFinite(window.creationTime) && window.creationTime > 0
      && window.preferences?.contextIsolation === true && window.preferences.nodeIntegration === false,
    'PACKAGE_UI_NATIVE_LAUNCH_INVALID');
    const mainTicks = creationTicks(main.creationTimeUtc);
    insist(Number.isFinite(identity.creationTime) && Number.isSafeInteger(Math.round(identity.creationTime * 1000))
      && BigInt(Math.round(identity.creationTime * 1000)) === (mainTicks + 5n) / 10n
      && mainTicks >= BigInt(Date.parse(native.startedAt)) * 10_000n
      && mainTicks < BigInt(Date.parse(binding.observedAt) + 1) * 10_000n,
    'PACKAGE_UI_NATIVE_BIRTH_INVALID');
    const rawRows = JSON.parse(binding.query.rawStdout);
    const rows = Array.isArray(rawRows) ? rawRows : [rawRows];
    insist(rows.length === (direct ? 1 : 2) && rows.some(row => isDeepStrictEqual(row, main))
      && binding.query.status === 0 && binding.query.signal === null
      && (direct ? main.parentPid === binding.collectorPid && isDeepStrictEqual(binding.launcher, main)
        : binding.launcher?.pid === main.parentPid && binding.launcher.parentPid === binding.collectorPid
          && rows.some(row => isDeepStrictEqual(row, binding.launcher))
          && isDeepStrictEqual(binding.launcherObservation?.launcher, binding.launcher)
          && binding.launcherObservation.collectorPid === binding.collectorPid),
    'PACKAGE_UI_NATIVE_PARENT_CHAIN_INVALID');
    insist(held?.kind === 'v16-main-exit-ready' && held.schemaVersion === 1 && held.pid === main.pid
      && held.parentPid === main.parentPid && samePath(held.executablePath, main.executablePath)
      && held.handleAcquired === true && pid(held.watcherPid) && held.watcherPid !== main.pid
      && uuid(held.ownerToken) && held.creationTimeUtc === main.creationTimeUtc && birth(held.handleCreationTimeUtc)
      && held.creationTimeUtc.slice(0, 26) === held.handleCreationTimeUtc.slice(0, 26)
      && held.creationPrecision === 'cim-microsecond+handle-100ns', 'PACKAGE_UI_NATIVE_HELD_HANDLE_INVALID');
    insist(isDeepStrictEqual(Object.keys(native.packageIdentity || {}).sort(), ['appContentSha256', 'executableSha256', 'mainBundleSha256'])
      && isDeepStrictEqual(native.packageIdentity, run.packageIdentity)
      && samePath(identity.executablePath, run.actualIdentity?.actualExecutablePath)
      && samePath(identity.appRoot, run.actualIdentity?.appPath) && samePath(identity.userDataDir, run.actualIdentity?.actualUserDataDir)
      && run.actualIdentity?.evidenceMode === 'package-ui' && window.url === run.actualIdentity?.rendererUrl
      && run.schedulerReadOnlyRuntime?.main?.pid === main.pid
      && samePath(run.schedulerReadOnlyRuntime.main.userDataDir, identity.userDataDir),
    'PACKAGE_UI_NATIVE_RUN_IDENTITY_MISMATCH');
    if (artifacts) {
      const bundles = artifacts.appContent?.files?.filter(file => file.path === 'dist/main/index.js');
      insist(bundles?.length === 1 && isDeepStrictEqual(native.packageIdentity, {
        executableSha256: artifacts.exe?.sha256, appContentSha256: artifacts.appContent.sha256, mainBundleSha256: bundles[0].sha256,
      }), 'PACKAGE_UI_NATIVE_CURRENT_PACKAGE_MISMATCH');
    }
    const exit = cleanup.mainExit;
    insist(cleanup.kind === 'v16-package-ui-native-cleanup' && cleanup.schemaVersion === 1
      && isDeepStrictEqual(cleanup.nativeLaunch, run.nativeLaunch) && cleanup.exitCodeSource === 'native-main-process-handle'
      && exit?.kind === 'v16-main-exit-proof' && exit.schemaVersion === 1 && exit.pid === main.pid
      && exit.parentPid === main.parentPid && samePath(exit.executablePath, main.executablePath)
      && exit.creationTimeUtc === main.creationTimeUtc && exit.creationPrecision === held.creationPrecision
      && exit.handleCreationTimeUtc === held.handleCreationTimeUtc && exit.ownerToken === held.ownerToken
      && exit.watcherPid === held.watcherPid && exit.exited === true && exit.exitCode === 0 && exit.signalCode === null
      && cleanup.launcher?.pid === binding.launcher.pid && cleanup.launcher.exitCode === 0 && cleanup.launcher.signalCode === null,
    'PACKAGE_UI_NATIVE_EXIT_PROOF_INVALID');
    if (requireReader || run.readerLaunch) {
      const reader = readOriginal(run.readerLaunch, run), readerCleanup = readOriginal(run.readerCleanup, run);
      const packagedSource = readOriginal(native.packageBuildState, run);
      insist(packagedSource.schemaVersion === 'v16.build-state/1' && packagedSource.status === 'CURRENT'
        && isDeepStrictEqual(packagedSource.identity, native.sourceIdentity) && isDeepStrictEqual(native.sourceIdentity, run.sourceIdentity),
      'PACKAGE_UI_READER_PACKAGED_SOURCE_ORIGINAL_INVALID');
      const { validateProviderBinding, validateProviderReady } = require('./v16-nvda-provider-binding');
      validateProviderBinding(reader.binding, native, { nativeLaunchKind: 'v16-package-ui-native-launch',
        nativeLaunchRef: run.nativeLaunch, pid: main.pid, packageIdentity: native.packageIdentity });
      validateProviderReady(reader.ready, reader.binding, readerCleanup.pid);
      insist(reader.kind === 'v16-nvda-observer-launch' && reader.schemaVersion === 1
        && isDeepStrictEqual(reader.nativeLaunch, run.nativeLaunch) && reader.runtimeSnapshot?.pid === main.pid
        && reader.runtimeSnapshot.creationTime === identity.creationTime && reader.runtimeSnapshot.window?.id === window.id
        && reader.runtimeSnapshot.window.url === window.url && reader.runtimeSnapshot.renderer?.pid === window.rendererPid
        && reader.runtimeSnapshot.renderer.creationTime === window.creationTime && readerCleanup.exited === true
        && readerCleanup.closed === true && readerCleanup.forced === false && readerCleanup.stopRequested === true
        && readerCleanup.earlyExit === false && readerCleanup.exitCode === 0 && readerCleanup.signalCode === null
        && readerCleanup.exitEvent?.code === 0 && readerCleanup.exitEvent.signal === null
        && readerCleanup.closeEvent?.code === 0 && readerCleanup.closeEvent.signal === null,
      'PACKAGE_UI_NATIVE_READER_LAUNCH_OR_CLEANUP_INVALID');
      const stop = readerCleanup.stopRequest, ack = readerCleanup.stopAck;
      const originals = run.nativeRuntimeArtifacts || [];
      const stopOriginal = originals.find(item => samePath(item.path, path.join(reader.configDirectory, 'collector-stop.json')));
      const ackOriginal = originals.find(item => samePath(item.path, path.join(reader.configDirectory, 'collector-stop-ack.json')));
      insist(isDeepStrictEqual(readOriginal(stopOriginal, run), stop) && isDeepStrictEqual(readOriginal(ackOriginal, run), ack)
        && stop?.command === 'stop' && stop.runToken === reader.binding.runToken && uuid(stop.nonce) && stop.pid === reader.ready.pid
        && ack?.kind === 'nvda-observer-stop-ack' && ack.schemaVersion === 1 && ack.pid === stop.pid
        && ack.runToken === stop.runToken && ack.nonce === stop.nonce
        && Number.isFinite(Date.parse(ack.timestamp)) && Date.parse(ack.timestamp) >= Date.parse(stop.requestedAt)
        && Date.parse(ack.timestamp) - Date.parse(stop.requestedAt) <= 15_000,
      'PACKAGE_UI_NATIVE_READER_STOP_ORIGINAL_INVALID');
      const rawOriginal = originals.find(item => samePath(item.path, path.join(reader.configDirectory, 'actual-speech.jsonl')));
      insist(rawOriginal && samePath(rawOriginal.path, readerCleanup.raw?.path)
        && rawOriginal.sha256.toUpperCase() === readerCleanup.raw.sha256.toUpperCase()
        && rawOriginal.sizeBytes === readerCleanup.raw.sizeBytes, 'PACKAGE_UI_NATIVE_READER_RAW_OUTSIDE_ATTEMPT');
      const speech = readBound(readerCleanup.raw);
      insist(speech.bytes.length === readerCleanup.raw.sizeBytes, 'PACKAGE_UI_NATIVE_READER_RAW_SIZE_MISMATCH');
      const rows = speech.bytes.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
      const governance = readOriginal(run.governance, run);
      insist(isDeepStrictEqual(rows[0], reader.ready) && rows.some(row => row.kind === 'nvda-synth-speech')
        && governance.kind === 'v16-software-ui-governance' && governance.schemaVersion === 1
        && governance.issues?.length === 0 && governance.deltas?.length === 10
        && governance.deltas.every(delta => Object.keys(delta.observations || {}).length === 3),
      'PACKAGE_UI_NATIVE_READER_GOVERNANCE_ORIGINAL_REQUIRED');
    }
  } catch (error) {
    violations.push({ code: 'PACKAGE_UI_NATIVE_RUNTIME_INVALID', message: error.message });
  }
  return { passed: violations.length === 0, violations };
}

module.exports = { validatePackageUiNativeEvidence };
