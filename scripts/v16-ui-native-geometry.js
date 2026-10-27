const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { creationTicks } = require('./v16-performance-process-binding');
const { within } = require('./v16-performance-artifacts');
const { minimalWindowsRuntimeEnvironment, resolveTrustedWindowsPowerShell } = require('./s7-launch-operator-security');
const { PACKAGE_UI_NATIVE_GEOMETRY_LIMITS: limits } = require('./package-ui-viewport-contract.cjs');
const { validateMotionOwner, readMotionMain, sameMotionMain, logMotionNativeFailure } = require('./v16-ui-motion-main');
const STAT_KEYS = ['ino', 'size', 'mtimeMs', 'ctimeMs', 'birthtimeMs', 'mode', 'nlink'];
const stat = value => Object.fromEntries(STAT_KEYS.map(key => [key, value[key]]));
const insist = (condition, code) => { if (!condition) throw new Error(code); };
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string'
  && path.win32.isAbsolute(a) && path.win32.isAbsolute(b) && path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
function readArtifact(file, expected) {
  const absolute = path.resolve(file), before = fs.lstatSync(absolute);
  insist(before.isFile() && !before.isSymbolicLink() && before.nlink === 1
    && fs.realpathSync.native(absolute).toLowerCase() === absolute.toLowerCase(), 'UI_NATIVE_GEOMETRY_DIRECT_FILE_REQUIRED');
  insist(before.size > 0 && before.size <= limits.maxOutputBytes, 'UI_NATIVE_GEOMETRY_FILE_LIMIT');
  let fd, failure;
  try {
    fd = fs.openSync(absolute, 'r');
    insist(isDeepStrictEqual(stat(fs.fstatSync(fd)), stat(before)), 'UI_NATIVE_GEOMETRY_FILE_CHANGED');
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
    insist(bytes.length === before.size && isDeepStrictEqual(stat(after), stat(before))
      && isDeepStrictEqual(stat(fs.lstatSync(absolute)), stat(before)), 'UI_NATIVE_GEOMETRY_FILE_CHANGED');
    const record = { path: absolute, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length, stat: stat(before) };
    if (expected) {
      insist(record.sha256 === expected.sha256?.toLowerCase() && (expected.sizeBytes === undefined || record.sizeBytes === expected.sizeBytes),
        'UI_NATIVE_GEOMETRY_ARTIFACT_MISMATCH');
      if (expected.stat) insist(isDeepStrictEqual(record.stat, expected.stat), 'UI_NATIVE_GEOMETRY_ARTIFACT_STAT_CHANGED');
    }
    return { record, bytes };
  } catch (error) { failure = error; throw error; }
  finally {
    if (fd !== undefined) try { fs.closeSync(fd); }
    catch (error) { if (!failure) throw error; logMotionNativeFailure(null, 'v16.ui_native_geometry_read_close_failed', error, { originalError: failure }); }
  }
}
function runtimeOwner(runtime) {
  const identity = runtime?.identity, window = identity?.windows?.[0];
  insist(identity?.packaged === true && identity.windows.length === 1 && window?.visible === true, 'UI_NATIVE_GEOMETRY_PACKAGED_RUNTIME_REQUIRED');
  return validateMotionOwner({ mainPid: identity.pid, mainCreationTime: identity.creationTime, windowId: window.id,
    rendererPid: window.rendererPid, rendererCreationTime: window.creationTime, url: window.url, electronVersion: identity.electronVersion });
}
function validateLaunch(launch, runtime, owner) {
  insist(['v16-package-ui-native-launch', 'v16-nfr-native-launch'].includes(launch?.kind) && launch.schemaVersion === 1,
    'UI_NATIVE_GEOMETRY_NATIVE_LAUNCH_REQUIRED');
  const identity = launch.identity, window = identity?.windows?.[0], main = launch.processBinding?.main, held = launch.verification?.mainExitObserver;
  insist(identity?.packaged === true && identity.windows.length === 1
    && identity.pid === owner.mainPid && identity.creationTime === owner.mainCreationTime && identity.electronVersion === owner.electronVersion
    && window.id === owner.windowId && window.rendererPid === owner.rendererPid && window.creationTime === owner.rendererCreationTime
    && window.url === owner.url && window.visible === true && samePath(identity.executablePath, runtime.identity.executablePath)
    && samePath(identity.appRoot, runtime.identity.appRoot) && samePath(identity.userDataDir, runtime.identity.userDataDir)
    && window.preferences?.contextIsolation === true && window.preferences.nodeIntegration === false,
  'UI_NATIVE_GEOMETRY_LAUNCH_OWNER_CHANGED');
  insist(main?.pid === owner.mainPid && held?.pid === owner.mainPid && held.handleAcquired === true
    && held.creationPrecision === 'cim-microsecond+handle-100ns'
    && samePath(main.executablePath, identity.executablePath) && samePath(held.executablePath, identity.executablePath),
  'UI_NATIVE_GEOMETRY_TRUSTED_MAIN_HANDLE_REQUIRED');
  const ticks = creationTicks(held.handleCreationTimeUtc);
  insist(ticks / 10n === BigInt(Math.round(owner.mainCreationTime * 1000)), 'UI_NATIVE_GEOMETRY_MAIN_BIRTH_MISMATCH');
  return { birthUtc: held.handleCreationTimeUtc, ticks: (ticks + 621355968000000000n).toString(), executablePath: identity.executablePath };
}
function createNativeGeometryObserver(runtime, writer, { dependencies = {} } = {}) {
  try {
    insist(writer && typeof writer.root === 'string' && path.isAbsolute(writer.root)
      && typeof writer.json === 'function' && typeof writer.track === 'function', 'UI_NATIVE_GEOMETRY_WRITER_REQUIRED');
    const owner = runtimeOwner(runtime), launchRef = runtime.launch?.receipt;
    insist(launchRef && path.isAbsolute(launchRef.path) && within(writer.root, launchRef.path), 'UI_NATIVE_GEOMETRY_BOUND_LAUNCH_REQUIRED');
    const launchInput = readArtifact(launchRef.path, launchRef), launch = JSON.parse(launchInput.bytes.toString('utf8'));
    const trustedMain = validateLaunch(launch, runtime, owner);
    const helper = readArtifact(path.join(__dirname, 'v16-ui-native-geometry.ps1')).record;
    const ports = { spawn, resolveTrustedWindowsPowerShell, minimalWindowsRuntimeEnvironment, readMotionMain,
      now: () => new Date().toISOString(), setTimeout, clearTimeout, ...dependencies };
    let busy = false;
    async function snapshot(expectedOwner, label) {
      let primary, observation, entered = false;
      const log = (event, error, context) => logMotionNativeFailure(writer, event, error, context);
      const fail = (error, event, receipt) => {
        if (!primary) primary = error;
        else if (receipt) (receipt.secondaryErrors ||= []).push({ event, name: error.name, message: error.message });
        log(event, error);
      };
      try {
        insist(!busy, 'UI_NATIVE_GEOMETRY_SNAPSHOT_ALREADY_RUNNING');
        validateMotionOwner(expectedOwner);
        insist(isDeepStrictEqual(expectedOwner, owner) && isDeepStrictEqual(runtimeOwner(runtime), owner), 'UI_NATIVE_GEOMETRY_OWNER_CHANGED');
        insist(typeof label === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,159}$/.test(label)
          && !label.includes('//'), 'UI_NATIVE_GEOMETRY_LABEL_INVALID');
        busy = true; entered = true;
        const currentLaunch = readArtifact(launchInput.record.path, launchInput.record);
        insist(isDeepStrictEqual(validateLaunch(JSON.parse(currentLaunch.bytes.toString('utf8')), runtime, owner), trustedMain),
          'UI_NATIVE_GEOMETRY_LAUNCH_CHANGED');
        readArtifact(helper.path, helper);
        const beforeMain = await ports.readMotionMain(runtime.app, owner, { writer }), nonce = randomUUID();
        const base = path.resolve(writer.root, label, nonce);
        insist(within(writer.root, base) && base !== writer.root && !fs.existsSync(base), 'UI_NATIVE_GEOMETRY_NEW_OUTPUT_REQUIRED');
        const powershell = ports.resolveTrustedWindowsPowerShell(process.env);
        const args = ['-NoProfile', '-NonInteractive', '-File', helper.path, '-MainPid', String(owner.mainPid),
          '-MainCreationTimeUtcTicks', trustedMain.ticks, '-MainExecutablePath', trustedMain.executablePath,
          '-Hwnd', beforeMain.hwnd, '-ExpectedRendererPid', String(owner.rendererPid), '-RequestNonce', nonce,
          '-HelperTimeoutMs', String(limits.helperTimeoutMs), '-WmQueryTimeoutMs', String(limits.wmQueryTimeoutMs),
          '-MaxOutputBytes', String(limits.maxOutputBytes), '-MaxChildren', String(limits.maxChildren)];
        fs.mkdirSync(base, { recursive: true });
        const stdoutPath = path.join(base, 'stdout.log'), stderrPath = path.join(base, 'stderr.log');
        const receipt = { kind: 'v16-native-physical-helper-invocation/1', diagnosticOnly: true, formalCredit: false,
          nonce, startedAt: ports.now(), beforeMain, tool: helper,
          command: { executable: powershell.realPath, args, shell: false, windowsHide: true }, events: [], timedOut: false };
        let stdout, stderr, timer, total = 0;
        try {
          stdout = fs.openSync(stdoutPath, 'wx'); stderr = fs.openSync(stderrPath, 'wx');
          await new Promise(resolve => {
            const child = ports.spawn(powershell.realPath, args, { cwd: path.resolve(__dirname, '..'), shell: false,
              windowsHide: true, env: ports.minimalWindowsRuntimeEnvironment(process.env), stdio: ['ignore', 'pipe', 'pipe'] });
            const childFailure = error => {
              const first = !primary; fail(error, 'v16.ui_native_geometry_helper_failed', receipt);
              // 超时只签发失败和恢复待完成记录，仍等待真实 close 与辅助线程 finally。
              if (first) {
                receipt.recoveryPending = { status: 'RECOVERY_PENDING', pid: child.pid, observedAt: ports.now(),
                  reason: error.message, helperExitObserved: false, helperCloseObserved: false };
                try { writer.json(path.relative(writer.root, path.join(base, 'RECOVERY_PENDING.json')), receipt.recoveryPending); }
                catch (error) { fail(error, 'v16.ui_native_geometry_recovery_record_failed', receipt); }
              }
            };
            const bytes = (fd, value) => {
              try {
                insist(Buffer.isBuffer(value), 'UI_NATIVE_GEOMETRY_RAW_BYTES_REQUIRED');
                const remaining = Math.max(0, limits.maxOutputBytes - total), accepted = value.subarray(0, remaining);
                total += value.length;
                let cursor = 0;
                while (cursor < accepted.length) {
                  const count = fs.writeSync(fd, accepted, cursor, accepted.length - cursor);
                  insist(count > 0, 'UI_NATIVE_GEOMETRY_STREAM_WRITE_FAILED'); cursor += count;
                }
                insist(total <= limits.maxOutputBytes, 'UI_NATIVE_GEOMETRY_OUTPUT_LIMIT');
              } catch (error) { childFailure(error); }
            };
            child.stdout?.on('data', value => bytes(stdout, value)); child.stderr?.on('data', value => bytes(stderr, value));
            for (const stream of [child.stdout, child.stderr]) stream?.on('error', childFailure);
            if (!child.stdout || !child.stderr) childFailure(new Error('UI_NATIVE_GEOMETRY_STDIO_REQUIRED'));
            child.once('spawn', () => receipt.events.push({ event: 'spawn', pid: child.pid, at: ports.now() }));
            child.once('error', error => { receipt.events.push({ event: 'error', at: ports.now() }); childFailure(error); });
            child.once('exit', (code, signal) => receipt.events.push({ event: 'exit', code, signal, at: ports.now() }));
            child.once('close', (code, signal) => {
              receipt.events.push({ event: 'close', code, signal, at: ports.now() });
              if (receipt.recoveryPending) receipt.recoveryFinished = { observedAt: ports.now(),
                helperExitObserved: receipt.events.some(row => row.event === 'exit'), helperCloseObserved: true, remainsFailed: true };
              ports.clearTimeout(timer); resolve();
            });
            timer = ports.setTimeout(() => { receipt.timedOut = true; childFailure(new Error('UI_NATIVE_GEOMETRY_HELPER_TIMEOUT')); }, limits.helperTimeoutMs);
          });
          if (primary) throw primary;
          insist(isDeepStrictEqual(receipt.events.map(row => row.event), ['spawn', 'exit', 'close']), 'UI_NATIVE_GEOMETRY_HELPER_LIFECYCLE_REQUIRED');
          for (const event of receipt.events.slice(1)) insist(event.code === 0 && event.signal === null, 'UI_NATIVE_GEOMETRY_HELPER_NORMAL_EXIT_REQUIRED');
        } catch (error) { if (error !== primary) fail(error, 'v16.ui_native_geometry_helper_invocation_failed', receipt); }
        finally {
          ports.clearTimeout(timer);
          for (const fd of [stdout, stderr]) if (fd !== undefined) try { fs.closeSync(fd); }
          catch (error) { fail(error, 'v16.ui_native_geometry_stream_close_failed', receipt); }
          receipt.finishedAt = ports.now();
          for (const [key, file] of [['stdout', stdoutPath], ['stderr', stderrPath]]) {
            try {
              const data = fs.readFileSync(file);
              receipt[key] = writer.track({ path: file, sha256: createHash('sha256').update(data).digest('hex'), sizeBytes: data.length });
            } catch (error) { fail(error, 'v16.ui_native_geometry_stream_artifact_failed', receipt); }
          }
          receipt.error = primary ? { name: primary.name, message: primary.message, stack: primary.stack } : null;
          try { writer.json(path.relative(writer.root, path.join(base, 'invocation.json')), receipt); }
          catch (error) { fail(error, 'v16.ui_native_geometry_invocation_record_failed', receipt); }
        }
        if (primary) throw primary;
        const raw = JSON.parse(readArtifact(receipt.stdout.path, receipt.stdout).bytes.toString('utf8').trim());
        insist(raw.schemaVersion === 'v16.native-physical-geometry/2' && raw.passed === true && raw.diagnosticOnly === true
          && raw.formalCredit === false && isDeepStrictEqual(raw.limits, limits), 'UI_NATIVE_GEOMETRY_HELPER_RESULT_INVALID');
        insist(isDeepStrictEqual(raw.ownerRequest, { mainPid: owner.mainPid, mainCreationTimeUtcTicks: trustedMain.ticks,
          mainExecutablePath: trustedMain.executablePath, hwnd: beforeMain.hwnd, requestNonce: nonce, expectedRendererPid: owner.rendererPid }),
        'UI_NATIVE_GEOMETRY_HELPER_OWNER_MISMATCH');
        insist(isDeepStrictEqual(raw.ownerBefore, raw.ownerAfter) && isDeepStrictEqual(raw.rendererBefore, raw.rendererAfter),
          'UI_NATIVE_GEOMETRY_HELPER_OWNER_CHANGED');
        insist(raw.ownerBefore.pid === owner.mainPid && raw.ownerBefore.creationTimeUtcTicks === trustedMain.ticks
          && raw.ownerBefore.hwnd === beforeMain.hwnd && raw.ownerBefore.windowPid === owner.mainPid
          && Number.isSafeInteger(raw.ownerBefore.windowThreadId) && raw.ownerBefore.windowThreadId > 0
          && samePath(raw.ownerBefore.executablePath, trustedMain.executablePath)
          && raw.rendererBefore.pid === owner.rendererPid && samePath(raw.rendererBefore.executablePath, trustedMain.executablePath),
        'UI_NATIVE_GEOMETRY_HELPER_PROCESS_MISMATCH');
        const rendererTicks = BigInt(raw.rendererBefore.creationTimeUtcTicks) - 621355968000000000n;
        insist(rendererTicks / 10n === BigInt(Math.round(owner.rendererCreationTime * 1000)), 'UI_NATIVE_GEOMETRY_RENDERER_BIRTH_MISMATCH');
        insist(raw.contextRestore?.confirmed === true && raw.native?.pmv2Verified === true, 'UI_NATIVE_GEOMETRY_CONTEXT_REQUIRED');
        const inventory = raw.native.childInventoryVerdict, children = raw.native.children;
        insist(Array.isArray(children) && children.length <= limits.maxChildren && inventory?.accepted === true
          && inventory.completed === true && inventory.rawChildCount === children.length, 'UI_NATIVE_GEOMETRY_COMPLETE_INVENTORY_REQUIRED');
        const widgets = children.filter(child => child.isVisibleRenderWidgetCandidate === true);
        insist(widgets.length === 1 && inventory.visibleRenderWidgetCandidateCount === 1
          && isDeepStrictEqual(inventory.visibleRenderWidgetCandidateHwnds, [widgets[0].hwnd])
          && inventory.selectedWidgetHwnd === widgets[0].hwnd && inventory.selectedWidgetOwnerAdmission === 'ADMITTED_MAIN'
          && widgets[0].ownerAdmission === 'ADMITTED_MAIN' && widgets[0].complete === true,
        'UI_NATIVE_GEOMETRY_UNIQUE_MAIN_WIDGET_REQUIRED');
        const noTime = value => { const { observedAt, ...rest } = value; return rest; };
        insist(isDeepStrictEqual(noTime(raw.native.primaryBefore), noTime(raw.native.primaryAfter)), 'UI_NATIVE_GEOMETRY_WINDOW_CHANGED');
        const afterMain = await ports.readMotionMain(runtime.app, owner, { writer }); sameMotionMain(beforeMain, afterMain);
        readArtifact(helper.path, helper); readArtifact(launchInput.record.path, launchInput.record);
        insist(isDeepStrictEqual(runtimeOwner(runtime), owner), 'UI_NATIVE_GEOMETRY_OWNER_CHANGED');
        observation = { beforeMain, native: raw, afterMain, invocation: receipt };
        writer.json(path.relative(writer.root, path.join(base, 'observation.json')), observation);
        return observation;
      } catch (error) { log('v16.ui_native_geometry_snapshot_failed', error); throw primary || error; }
      finally { if (entered) busy = false; }
    }
    return Object.freeze({ snapshot });
  } catch (error) { logMotionNativeFailure(writer, 'v16.ui_native_geometry_observer_failed', error); throw error; }
}
module.exports = { createNativeGeometryObserver };

