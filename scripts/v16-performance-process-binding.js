const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { digest, directPath, insist } = require('./v16-performance-artifacts');
const evidence = require('./evidence-user-data');
const { currentMarkerIdentity, processCreationBelongsToRun } = require('./package-launch-processes');
const { PACKAGE_LAUNCH_WINDOW_READY_MARKER } = require('./package-launch-contracts');
const { validatePackageLaunchWindowReadyMarker } = require('./package-launch-validation');
const { minimalWindowsRuntimeEnvironment, resolveTrustedWindowsPowerShell } = require('./s7-launch-operator-security');

const normalized = value => typeof value === 'string' && path.win32.isAbsolute(value)
  ? path.win32.normalize(value).toLowerCase() : '';
const validPid = value => Number.isInteger(value) && value > 0;

function creationTicks(value) {
  const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{7})Z$/.exec(value);
  insist(match, 'NFR_RUNTIME_IDENTITY_MISMATCH');
  const seconds = Date.parse(match[1] + 'Z');
  insist(Number.isFinite(seconds) && new Date(seconds).toISOString().startsWith(match[1]), 'NFR_RUNTIME_IDENTITY_MISMATCH');
  return BigInt(seconds) * 10_000n + BigInt(match[2]);
}

function currentBirth(value, startedAt, observedAt) {
  const ticks = creationTicks(value), start = Date.parse(startedAt), finish = Date.parse(observedAt);
  insist(Number.isFinite(start) && Number.isFinite(finish) && finish >= start
    && processCreationBelongsToRun(value, start) && ticks >= BigInt(start) * 10_000n
    && ticks < BigInt(finish + 1) * 10_000n, 'NFR_RUNTIME_IDENTITY_MISMATCH');
  return ticks;
}

function snapshotProfileMarker(profile, name = evidence.EVIDENCE_USER_DATA_RUNTIME_MARKER) {
  const markerPath = path.join(profile, name);
  let file;
  try { file = directPath(markerPath); }
  catch (error) { if (error.code === 'ENOENT') return { exists: false, markerPath }; throw error; }
  const bytes = fs.readFileSync(file.path);
  return { exists: true, markerPath: file.path, sha256: digest(bytes), bytes };
}

function snapshotNativeMarkers(profile) {
  return { runtime: snapshotProfileMarker(profile), window: snapshotProfileMarker(profile, PACKAGE_LAUNCH_WINDOW_READY_MARKER) };
}

function isNativeShellLauncher(child) {
  return path.win32.basename(String(child?.spawnfile ?? '')).toLowerCase() === 'cmd.exe';
}

function remaining(deadline) {
  const timeout = Math.floor(deadline - performance.now());
  insist(timeout > 0, 'NFR_RUNTIME_PROCESS_QUERY_TIMEOUT');
  return timeout;
}

function queryProcesses(ids, timeoutMs) {
  insist(Number.isInteger(timeoutMs) && timeoutMs > 0 && ids.every(validPid), 'NFR_RUNTIME_PROCESS_QUERY_INVALID');
  const started = performance.now(), deadline = started + timeoutMs;
  const env = minimalWindowsRuntimeEnvironment(process.env);
  const trusted = resolveTrustedWindowsPowerShell(process.env, { spawnSync: (executable, args, options = {}) => {
    const left = remaining(deadline); return spawnSync(executable, args, { ...options, timeout: Math.min(options.timeout ?? left, left) });
  } });
  const filter = [...new Set(ids)].map(pid => 'ProcessId=' + pid).join(' OR ');
  const script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); "
    + "$rows=@(Get-CimInstance -ClassName Win32_Process -Filter '" + filter + "'); "
    + "@($rows | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; "
    + "executablePath=$_.ExecutablePath; creationTimeUtc=$_.CreationDate.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress";
  const result = spawnSync(trusted.realPath, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env, encoding: 'utf8', shell: false, windowsHide: true, timeout: remaining(deadline), killSignal: 'SIGKILL', maxBuffer: 128 * 1024,
  });
  if (result.error || result.status !== 0 || result.signal) throw new Error('NFR_RUNTIME_PROCESS_QUERY_FAILED', { cause: result.error });
  remaining(deadline);
  const rawStdout = String(result.stdout ?? '').trim();
  let rows;
  try { const parsed = JSON.parse(rawStdout); rows = Array.isArray(parsed) ? parsed : [parsed]; }
  catch (error) { throw new Error('NFR_RUNTIME_PROCESS_QUERY_FAILED', { cause: error }); }
  const observedAt = new Date().toISOString();
  insist(rows.length === ids.length && new Set(rows.map(row => row?.pid)).size === ids.length
    && rows.every(row => validPid(row?.pid) && ids.includes(row.pid)), 'NFR_RUNTIME_IDENTITY_MISMATCH');
  return { rows, observedAt, elapsedMs: performance.now() - started,
    query: { powershell: trusted, script, status: result.status, signal: result.signal ?? null, rawStdout,
      stderr: String(result.stderr ?? ''), observedAt } };
}

function captureNativeLauncher({ child, startedAt, timeoutMs }) {
  const shellPath = normalized(child?.spawnfile);
  if (!shellPath || path.win32.basename(shellPath) !== 'cmd.exe') return null;
  const expected = normalized(minimalWindowsRuntimeEnvironment(process.env).COMSPEC);
  insist(validPid(child.pid) && shellPath === expected, 'NFR_RUNTIME_IDENTITY_MISMATCH');
  const observation = queryProcesses([child.pid], timeoutMs), launcher = observation.rows[0];
  insist(launcher.pid === child.pid && launcher.parentPid === process.pid
    && normalized(launcher.executablePath) === expected, 'NFR_RUNTIME_IDENTITY_MISMATCH');
  currentBirth(launcher.creationTimeUtc, startedAt, observation.observedAt);
  return { launcher, collectorPid: process.pid, observedAt: observation.observedAt,
    elapsedMs: observation.elapsedMs, query: observation.query };
}

function bindNativeMainProcess({ child, identity, current, userDataDir, startedAt, initialMarkers, launcherObservation, timeoutMs }) {
  if (identity.pid === child.pid) {
    insist(!isNativeShellLauncher(child), 'NFR_RUNTIME_IDENTITY_MISMATCH');
    return { method: 'direct-pid', main: { pid: identity.pid }, launcher: { pid: child.pid } };
  }
  insist(validPid(identity.pid) && launcherObservation?.collectorPid === process.pid, 'NFR_RUNTIME_IDENTITY_MISMATCH');
  const observation = queryProcesses([child.pid, identity.pid], timeoutMs);
  const launcher = observation.rows.find(row => row.pid === child.pid), main = observation.rows.find(row => row.pid === identity.pid);
  const pinned = launcherObservation.launcher;
  insist(launcher && main && launcher.pid === pinned.pid && launcher.parentPid === process.pid
    && pinned.parentPid === process.pid && normalized(launcher.executablePath) === normalized(pinned.executablePath)
    && normalized(launcher.executablePath) === normalized(child.spawnfile)
    && creationTicks(launcher.creationTimeUtc) === creationTicks(pinned.creationTimeUtc)
    && main.parentPid === launcher.pid && normalized(main.executablePath) === normalized(current.executablePath),
  'NFR_RUNTIME_IDENTITY_MISMATCH');
  const launcherBirth = currentBirth(launcher.creationTimeUtc, startedAt, observation.observedAt);
  const mainBirth = currentBirth(main.creationTimeUtc, startedAt, observation.observedAt);
  const metricMicroseconds = Math.round(identity.creationTime * 1000);
  // CIM 保留七位原件，按其微秒精度与 Electron 指标比较，避免 Date.parse 丢失亚毫秒部分。
  insist(mainBirth >= launcherBirth && Number.isFinite(identity.creationTime) && Number.isSafeInteger(metricMicroseconds)
    && BigInt(metricMicroseconds) === (mainBirth + 5n) / 10n, 'NFR_RUNTIME_IDENTITY_MISMATCH');
  const marker = snapshotProfileMarker(userDataDir);
  insist(marker.exists && (!initialMarkers.runtime?.exists || marker.sha256 !== initialMarkers.runtime.sha256), 'NFR_RUNTIME_IDENTITY_MISMATCH');
  let value;
  try { value = JSON.parse(marker.bytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch (error) { throw new Error('NFR_RUNTIME_IDENTITY_MISMATCH', { cause: error }); }
  const validated = evidence.validateEvidenceUserDataIdentity({ actualUserDataDir: value.userDataDir,
    evidenceMode: value.mode, expectedMode: evidence.PACKAGE_LAUNCH_SMOKE_MODE, expectedUserDataDir: userDataDir });
  const generatedAt = Date.parse(value.generatedAt), start = Date.parse(startedAt), finish = Date.parse(observation.observedAt);
  insist(validated.passed && value.overridden === true && value.pid === identity.pid
    && currentMarkerIdentity({ passed: validated.passed, marker: value }, start)
    && generatedAt >= start && generatedAt >= Number(mainBirth / 10_000n) && generatedAt <= finish,
  'NFR_RUNTIME_IDENTITY_MISMATCH');
  const windowMarker = snapshotProfileMarker(userDataDir, PACKAGE_LAUNCH_WINDOW_READY_MARKER);
  insist(windowMarker.exists && (!initialMarkers.window?.exists || windowMarker.sha256 !== initialMarkers.window.sha256),
    'NFR_RUNTIME_IDENTITY_MISMATCH');
  let windowValue;
  try { windowValue = JSON.parse(windowMarker.bytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch (error) { throw new Error('NFR_RUNTIME_IDENTITY_MISMATCH', { cause: error }); }
  const windowValidation = validatePackageLaunchWindowReadyMarker(windowValue, { expectedPid: identity.pid,
    expectedRendererPath: path.join(current.appRoot, 'dist/renderer/index.html'), expectedUserDataDir: userDataDir,
    notBeforeMs: start, runtimeMarkerGeneratedAt: value.generatedAt });
  const windowGeneratedAt = Date.parse(windowValue.generatedAt);
  insist(windowValidation.passed && identity.windows?.length === 1
    && windowValue.browserWindowId === identity.windows[0].id && windowValue.rendererUrl === identity.windows[0].url
    && windowGeneratedAt >= start && windowGeneratedAt >= generatedAt && windowGeneratedAt <= finish,
  'NFR_RUNTIME_IDENTITY_MISMATCH');
  return { method: 'windows-shell', collectorPid: process.pid, launcher, main,
    creationPrecision: 'cim-microsecond+electron-microsecond', marker: { ...value, sha256: marker.sha256,
      previousSha256: initialMarkers.runtime?.sha256 ?? null, replacedPrevious: initialMarkers.runtime?.exists === true },
    windowReady: { ...windowValue, sha256: windowMarker.sha256, previousSha256: initialMarkers.window?.sha256 ?? null,
      replacedPrevious: initialMarkers.window?.exists === true },
    launcherObservation, observation, verifiedAt: new Date().toISOString() };
}

module.exports = { snapshotNativeMarkers, isNativeShellLauncher, captureNativeLauncher, bindNativeMainProcess, creationTicks, queryProcesses, currentBirth };
