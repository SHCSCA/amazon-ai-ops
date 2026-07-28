const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { fileURLToPath } = require('url');
const {
  PACKAGE_LAUNCH_SMOKE_MODE,
  buildEvidenceUserDataEnv,
  inspectPackagedUserDataOverrideContract,
  readEvidenceUserDataRuntimeMarker,
  validateEvidenceUserDataIdentity,
  validateEvidenceUserDataPath,
} = require('./evidence-user-data');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'apps', 'desktop', 'release');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'desktop', 'package.json'), 'utf8'));
const runId = Date.now();
const isolatedUserDataRoot = path.join('D:\\Temp', 'amazon-ai-ops-package-launch-smoke', String(runId));
const PORTABLE_START_TIMEOUT_MS = 300000;
const UNPACKED_START_TIMEOUT_MS = 60000;
const WINDOWS_PROCESS_COMMAND_TIMEOUT_MS = 10000;
const TASKKILL_COMMAND_TIMEOUT_MS = 10000;
const PROCESS_CLEANUP_ATTEMPTS = 20;
const PROCESS_CLEANUP_INTERVAL_MS = 250;
const PROCESS_TREE_POLL_INTERVAL_MS = 2000;
const PORTABLE_APP_PROCESS_NAME = 'AmazonAIOpsAgent.exe';
const POWERSHELL_EXECUTABLE = process.env.AMAZON_AI_OPS_POWERSHELL_EXE || 'pwsh.exe';
const PACKAGE_LAUNCH_WINDOW_READY_MARKER = 'package-launch-window-ready.json';
const PACKAGE_LAUNCH_WINDOW_READY_MAX_BYTES = 64 * 1024;

function fail(message, details) {
  throw new Error(details ? `${message}: ${details}` : message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prepareIsolatedUserData(kind) {
  const userDataDir = path.join(isolatedUserDataRoot, kind);
  fs.mkdirSync(userDataDir, { recursive: true });
  return validateEvidenceUserDataPath(userDataDir);
}

function collectUserDataEvidence(userDataDir) {
  const runtime = readEvidenceUserDataRuntimeMarker(userDataDir);
  const identity = validateEvidenceUserDataIdentity({
    actualUserDataDir: runtime.marker?.userDataDir,
    evidenceMode: runtime.marker?.mode,
    expectedMode: PACKAGE_LAUNCH_SMOKE_MODE,
    expectedUserDataDir: userDataDir,
  });
  return {
    ...identity,
    marker: runtime.marker,
    markerError: runtime.error || null,
    markerPath: runtime.markerPath,
  };
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex').toUpperCase();
}

function fileInfo(filePath) {
  if (!fs.existsSync(filePath)) fail('Package artifact is missing', filePath);
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    sizeBytes: stat.size,
    sha256: sha256(filePath),
    mtime: stat.mtime.toISOString(),
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function readStableRegularFile(filePath) {
  try {
    if (!path.win32.isAbsolute(String(filePath || ''))) return null;
    const linkStat = fs.lstatSync(filePath);
    if (linkStat.isSymbolicLink() || !linkStat.isFile()) return null;
    const before = fs.statSync(filePath);
    const bytes = fs.readFileSync(filePath);
    const after = fs.statSync(filePath);
    if (
      before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || bytes.length !== after.size
    ) {
      return null;
    }
    return { bytes, stat: after };
  } catch {
    return null;
  }
}

function currentArtifactMatches(artifact) {
  const current = readStableRegularFile(artifact?.path);
  if (!current) return false;
  return Number(artifact?.sizeBytes) === current.stat.size
    && String(artifact?.sha256 || '').toUpperCase()
      === crypto.createHash('sha256').update(current.bytes).digest('hex').toUpperCase()
    && String(artifact?.mtime || '') === current.stat.mtime.toISOString();
}

function currentJsonMarkerMatches(filePath, expectedMarker, artifact = null) {
  const current = readStableRegularFile(filePath);
  if (!current || current.bytes.length < 2 || current.bytes.length > PACKAGE_LAUNCH_WINDOW_READY_MAX_BYTES) {
    return false;
  }
  if (
    artifact
    && (
      Number(artifact.sizeBytes) !== current.stat.size
      || String(artifact.sha256 || '').toUpperCase()
        !== crypto.createHash('sha256').update(current.bytes).digest('hex').toUpperCase()
      || String(artifact.mtime || '') !== current.stat.mtime.toISOString()
    )
  ) {
    return false;
  }
  try {
    return stableJson(JSON.parse(current.bytes.toString('utf8'))) === stableJson(expectedMarker);
  } catch {
    return false;
  }
}

function validatePackageLaunchSmokeEvidence(evidence) {
  const violations = [];
  const reject = (code, pathName) => violations.push({ code, path: pathName });
  const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const validTimestamp = (value) => Number.isFinite(Date.parse(value || ''));
  const validArtifact = (artifact) => isRecord(artifact)
    && path.win32.isAbsolute(String(artifact.path || ''))
    && Number.isInteger(artifact.sizeBytes)
    && artifact.sizeBytes > 0
    && /^[A-F0-9]{64}$/.test(String(artifact.sha256 || ''))
    && validTimestamp(artifact.mtime)
    && currentArtifactMatches(artifact);
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    reject('PACKAGE_LAUNCH_EVIDENCE_INVALID', '$');
    return { passed: false, violations };
  }
  if (evidence.kind !== 'package-launch-smoke') {
    reject('PACKAGE_LAUNCH_KIND_INVALID', 'kind');
  }
  if (evidence.evidenceMode !== PACKAGE_LAUNCH_SMOKE_MODE) {
    reject('PACKAGE_LAUNCH_MODE_INVALID', 'evidenceMode');
  }
  if (!validTimestamp(evidence.generatedAt)) {
    reject('PACKAGE_LAUNCH_GENERATED_AT_INVALID', 'generatedAt');
  }
  if (!path.win32.isAbsolute(String(evidence.releaseDir || ''))) {
    reject('PACKAGE_LAUNCH_RELEASE_DIR_INVALID', 'releaseDir');
  }
  if (evidence.passed !== true) {
    reject('PACKAGE_LAUNCH_NOT_PASSED', 'passed');
  }
  const isolatedUserData = evidence.isolatedUserData;
  if (
    !isRecord(isolatedUserData)
    || !path.win32.isAbsolute(String(isolatedUserData.unpacked || ''))
    || !path.win32.isAbsolute(String(isolatedUserData.portable || ''))
    || normalizedExecutablePath(isolatedUserData.unpacked)
      === normalizedExecutablePath(isolatedUserData.portable)
  ) {
    reject('PACKAGE_LAUNCH_ISOLATED_USER_DATA_INVALID', 'isolatedUserData');
  }
  if (
    !isRecord(evidence.userDataOverrideBundleContract)
    || evidence.userDataOverrideBundleContract.passed !== true
    || !Array.isArray(evidence.userDataOverrideBundleContract.violations)
    || evidence.userDataOverrideBundleContract.violations.length !== 0
  ) {
    reject(
      'PACKAGE_LAUNCH_USER_DATA_OVERRIDE_CONTRACT_INVALID',
      'userDataOverrideBundleContract',
    );
  }
  for (const kind of ['unpacked', 'portable']) {
    if (!validArtifact(evidence.artifacts?.[kind])) {
      reject('PACKAGE_LAUNCH_ARTIFACT_INVALID', `artifacts.${kind}`);
    }
  }
  const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
  const checkKinds = checks.map((check) => check?.kind).sort();
  if (
    checks.length !== 2
    || new Set(checkKinds).size !== 2
    || checkKinds[0] !== 'portable'
    || checkKinds[1] !== 'win-unpacked'
  ) {
    reject('PACKAGE_LAUNCH_CHECK_SET_INVALID', 'checks');
  }
  for (const [index, check] of checks.entries()) {
    const checkPath = `checks.${check?.kind || index}`;
    if (!isRecord(check) || check.ok !== true || check.launchError !== null) {
      reject('PACKAGE_LAUNCH_CHECK_RESULT_INVALID', checkPath);
    }
    const runtime = check?.runtimeProcess;
    const createdAt = Date.parse(runtime?.creationDate || '');
    const notBeforeMs = Number(runtime?.notBeforeMs);
    if (
      !isRecord(runtime)
      || !Number.isInteger(runtime.processId)
      || runtime.processId < 1
      || String(runtime.name || '').toLowerCase() !== PORTABLE_APP_PROCESS_NAME.toLowerCase()
      || !path.win32.isAbsolute(String(runtime.executablePath || ''))
      || !Number.isFinite(createdAt)
      || !Number.isFinite(notBeforeMs)
      || createdAt < notBeforeMs - 2000
      || createdAt > Date.now() + 10000
      || !Number.isInteger(runtime.parentProcessId)
      || runtime.parentProcessId < 0
      || runtime.mainWindowHandle <= 0
      || !String(runtime.mainWindowTitle || '').trim()
      || runtime.windowVisible !== true
      || runtime.proof !== 'isolated-runtime-marker'
    ) {
      reject('PACKAGE_LAUNCH_RUNTIME_PROCESS_INVALID', `${checkPath}.runtimeProcess`);
    }
    const expectedUserDataDir = check?.kind === 'win-unpacked'
      ? evidence.isolatedUserData?.unpacked
      : evidence.isolatedUserData?.portable;
    if (
      check?.kind === 'win-unpacked'
      && (
        check.marker !== '[App] window-created'
        || check.pid !== runtime?.processId
        || normalizedExecutablePath(runtime?.executablePath)
          !== normalizedExecutablePath(evidence.artifacts?.unpacked?.path)
      )
    ) {
      reject('PACKAGE_LAUNCH_UNPACKED_IDENTITY_INVALID', checkPath);
    }
    if (
      check?.kind === 'portable'
      && (
        !Number.isInteger(check.launcherPid)
        || check.launcherPid < 1
        || !Number.isInteger(check.observedProcessCount)
        || check.observedProcessCount < 1
        || runtime?.parentProcessId !== check.launcherPid
        || !readStableRegularFile(runtime?.executablePath)
        || sha256(runtime.executablePath)
          !== String(evidence.artifacts?.unpacked?.sha256 || '').toUpperCase()
      )
    ) {
      reject('PACKAGE_LAUNCH_PORTABLE_LINEAGE_INVALID', checkPath);
    }
    const userData = check?.userDataEvidence;
    const runtimeMarkerAt = Date.parse(userData?.marker?.generatedAt || '');
    if (
      !isRecord(userData)
      || userData.passed !== true
      || !Array.isArray(userData.violations)
      || userData.violations.length !== 0
      || userData.markerError !== null
      || normalizedExecutablePath(userData.actualUserDataDir)
        !== normalizedExecutablePath(expectedUserDataDir)
      || normalizedExecutablePath(userData.expectedUserDataDir)
        !== normalizedExecutablePath(expectedUserDataDir)
      || !isRecord(userData.marker)
      || userData.marker.mode !== PACKAGE_LAUNCH_SMOKE_MODE
      || userData.marker.overridden !== true
      || normalizedExecutablePath(userData.marker.userDataDir)
        !== normalizedExecutablePath(expectedUserDataDir)
      || userData.marker.pid !== runtime?.processId
      || !Number.isFinite(runtimeMarkerAt)
      || runtimeMarkerAt < notBeforeMs - 2000
      || runtimeMarkerAt > Date.now() + 10000
      || !path.win32.isAbsolute(String(userData.markerPath || ''))
      || normalizedExecutablePath(userData.markerPath)
        !== normalizedExecutablePath(path.win32.join(
          String(expectedUserDataDir || ''),
          'evidence-user-data-runtime.json',
        ))
      || !currentJsonMarkerMatches(userData.markerPath, userData.marker)
    ) {
      reject('PACKAGE_LAUNCH_USER_DATA_EVIDENCE_INVALID', `${checkPath}.userDataEvidence`);
    }
    const windowReady = check?.windowReadyEvidence;
    const markerValidation = validatePackageLaunchWindowReadyMarker(windowReady?.marker, {
      expectedPid: runtime?.processId,
      expectedRendererPath: packagedRendererPathForExecutable(runtime?.executablePath),
      expectedUserDataDir,
      notBeforeMs,
      runtimeMarkerGeneratedAt: check?.userDataEvidence?.marker?.generatedAt,
    });
    if (
      !isRecord(windowReady)
      || windowReady.passed !== true
      || windowReady.state !== 'valid'
      || !Array.isArray(windowReady.violations)
      || windowReady.violations.length !== 0
      || markerValidation.passed !== true
      || !isRecord(windowReady.artifact)
      || !path.win32.isAbsolute(String(windowReady.artifact.path || ''))
      || normalizedExecutablePath(windowReady.artifact.path)
        !== normalizedExecutablePath(windowReady.markerPath)
      || normalizedExecutablePath(windowReady.markerPath)
        !== normalizedExecutablePath(path.win32.join(
          String(expectedUserDataDir || ''),
          PACKAGE_LAUNCH_WINDOW_READY_MARKER,
        ))
      || Number(windowReady.artifact.sizeBytes) <= 0
      || !/^[A-F0-9]{64}$/.test(String(windowReady.artifact.sha256 || ''))
      || !Number.isFinite(Date.parse(windowReady.artifact.mtime || ''))
      || !currentJsonMarkerMatches(
        windowReady.markerPath,
        windowReady.marker,
        windowReady.artifact,
      )
      || normalizedExecutablePath(windowReady.rendererPath)
        !== normalizedExecutablePath(markerValidation.rendererPath)
      || !readStableRegularFile(windowReady.rendererPath)
    ) {
      reject('PACKAGE_LAUNCH_WINDOW_READY_INVALID', `${checkPath}.windowReadyEvidence`);
    }
    const cleanup = check?.processCleanup;
    if (
      !isRecord(cleanup)
      || cleanup.passed !== true
      || !Number.isInteger(cleanup.attempts)
      || cleanup.attempts < 1
      || cleanup.remainingCount !== 0
      || !Array.isArray(cleanup.remaining)
      || cleanup.remaining.length !== 0
      || !Array.isArray(cleanup.identityViolations)
      || cleanup.identityViolations.length !== 0
      || !Array.isArray(cleanup.killAttempts)
      || !Array.isArray(cleanup.reusedPids)
      || cleanup.reusedPids.length !== 0
      || cleanup.snapshotError !== null
      || !Array.isArray(cleanup.treeErrors)
      || cleanup.treeErrors.length !== 0
      || !Array.isArray(cleanup.unresolved)
      || cleanup.unresolved.length !== 0
    ) {
      reject('PACKAGE_LAUNCH_PROCESS_CLEANUP_INVALID', `${checkPath}.processCleanup`);
    }
    if (!Array.isArray(check?.observationErrors) || check.observationErrors.length !== 0) {
      reject('PACKAGE_LAUNCH_OBSERVATION_ERRORS_PRESENT', `${checkPath}.observationErrors`);
    }
    if (
      !path.win32.isAbsolute(String(check?.stdoutPath || ''))
      || !path.win32.isAbsolute(String(check?.stderrPath || ''))
      || !readStableRegularFile(check.stdoutPath)
      || !readStableRegularFile(check.stderrPath)
    ) {
      reject('PACKAGE_LAUNCH_LOG_PATH_INVALID', checkPath);
    }
  }
  return {
    passed: violations.length === 0,
    violations,
  };
}

function writeLog(filePath, chunks) {
  fs.writeFileSync(filePath, chunks.join(''), 'utf8');
}

function commandFailure(result, label) {
  if (result?.error) {
    return `${label}: ${result.error.message || String(result.error)}`;
  }
  if (result?.status !== 0) {
    return String(result?.stderr || result?.stdout || `${label} exited ${result?.status}`).trim();
  }
  return null;
}

function terminateTimedOutHelper(result) {
  if (result?.error?.code !== 'ETIMEDOUT' || !Number.isInteger(Number(result.pid))) return;
  try {
    process.kill(Number(result.pid), 'SIGKILL');
  } catch {
    // The helper may already have exited after the hard timeout fired.
  }
}

function runPowerShell(script) {
  const result = spawnSync(POWERSHELL_EXECUTABLE, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: WINDOWS_PROCESS_COMMAND_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
  });
  terminateTimedOutHelper(result);
  return result;
}

function killTree(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) {
    return { passed: false, error: 'invalid PID', processId: Number(pid) || null };
  }
  const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: TASKKILL_COMMAND_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  terminateTimedOutHelper(result);
  const error = commandFailure(result, 'taskkill');
  return {
    passed: !error,
    error,
    processId: Number(pid),
    status: result.status,
  };
}

function parseWindowsProcessSnapshot(result, label = 'powershell') {
  const error = commandFailure(result, label);
  if (error) {
    return { error, processes: [] };
  }
  const text = String(result.stdout || '').trim();
  if (!text) return { processes: [] };
  try {
    const parsed = JSON.parse(text);
    return { processes: Array.isArray(parsed) ? parsed : [parsed] };
  } catch (parseError) {
    return { error: parseError.message, raw: text, processes: [] };
  }
}

function windowsDescendants(pid) {
  const script = `
$rootPid = ${Number(pid)}
$records = foreach ($item in @(Get-Process -ErrorAction SilentlyContinue)) {
  $parentPid = 0
  $executablePath = $null
  $startedAt = $null
  try { if ($null -ne $item.Parent) { $parentPid = [int]$item.Parent.Id } } catch {}
  try { $executablePath = $item.Path } catch {}
  try { $startedAt = $item.StartTime.ToUniversalTime().ToString('o') } catch {}
  [pscustomobject]@{
    ProcessId = [int]$item.Id
    ParentProcessId = $parentPid
    Name = "$($item.ProcessName).exe"
    ExecutablePath = $executablePath
    CreationDate = $startedAt
  }
}
$seen = @{}
$seen[$rootPid] = $true
$queue = [System.Collections.Generic.Queue[int]]::new()
$queue.Enqueue($rootPid)
$all = @()
while ($queue.Count -gt 0) {
  $parentPid = $queue.Dequeue()
  $children = @($records | Where-Object { $_.ParentProcessId -eq $parentPid })
  foreach ($item in $children) {
    $childPid = [int]$item.ProcessId
    if (-not $seen.ContainsKey($childPid)) {
      $seen[$childPid] = $true
      $queue.Enqueue($childPid)
      $all += $item
    }
  }
}
@($all) |
  Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CreationDate |
  ConvertTo-Json -Compress
`;
  return parseWindowsProcessSnapshot(runPowerShell(script), 'descendant process query');
}

function windowsProcessesByIds(pids) {
  const ids = [...new Set((pids || []).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0))];
  if (ids.length === 0) return { processes: [] };
  const script = `
$targetPids = @(${ids.join(',')})
$records = foreach ($item in @(Get-Process -Id $targetPids -ErrorAction SilentlyContinue)) {
  $parentPid = 0
  $executablePath = $null
  $startedAt = $null
  try { if ($null -ne $item.Parent) { $parentPid = [int]$item.Parent.Id } } catch {}
  try { $executablePath = $item.Path } catch {}
  try { $startedAt = $item.StartTime.ToUniversalTime().ToString('o') } catch {}
  [pscustomobject]@{
    ProcessId = [int]$item.Id
    ParentProcessId = $parentPid
    Name = "$($item.ProcessName).exe"
    ExecutablePath = $executablePath
    CreationDate = $startedAt
  }
}
@($records) | ConvertTo-Json -Compress
`;
  return parseWindowsProcessSnapshot(runPowerShell(script), 'PID process query');
}

function windowsRuntimeWindowById(pid) {
  const script = `
$process = Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue
if ($null -eq $process) {
  return
}
$executablePath = $null
$startedAt = $null
$parentPid = 0
try { if ($null -ne $process.Parent) { $parentPid = [int]$process.Parent.Id } } catch {}
try { $executablePath = $process.Path } catch {}
try { $startedAt = $process.StartTime.ToUniversalTime().ToString('o') } catch {}
$windowHandle = [long]$process.MainWindowHandle
$windowVisible = $false
if ($windowHandle -gt 0) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace AmazonAiOpsSmoke {
  public static class NativeWindow {
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);
  }
}
'@ -ErrorAction Stop
  $windowVisible = [AmazonAiOpsSmoke.NativeWindow]::IsWindowVisible([IntPtr]$windowHandle)
}
[pscustomobject]@{
  ProcessId = [int]$process.Id
  ParentProcessId = $parentPid
  Name = "$($process.ProcessName).exe"
  ExecutablePath = $executablePath
  CreationDate = $startedAt
  MainWindowHandle = $windowHandle
  MainWindowTitle = $process.MainWindowTitle
  WindowVisible = [bool]$windowVisible
} | ConvertTo-Json -Compress
`;
  return parseWindowsProcessSnapshot(runPowerShell(script), 'visible-window process query');
}

function normalizedExecutablePath(filePath) {
  const value = String(filePath || '');
  return value ? path.win32.normalize(value).toLowerCase() : '';
}

function processRecord(item, proof, extra = {}) {
  return {
    processId: Number(item.ProcessId ?? item.processId),
    parentProcessId: Number(item.ParentProcessId ?? item.parentProcessId ?? 0),
    name: String(item.Name ?? item.name ?? ''),
    executablePath: String(item.ExecutablePath ?? item.executablePath ?? ''),
    creationDate: item.CreationDate ?? item.creationDate ?? null,
    mainWindowHandle: Number(item.MainWindowHandle ?? item.mainWindowHandle ?? 0),
    mainWindowTitle: String(item.MainWindowTitle ?? item.mainWindowTitle ?? ''),
    windowVisible: Boolean(item.WindowVisible ?? item.windowVisible),
    proof,
    ...extra,
  };
}

function currentMarkerIdentity(userDataEvidence, notBeforeMs) {
  const markerPid = Number(userDataEvidence?.marker?.pid);
  const generatedAt = Date.parse(userDataEvidence?.marker?.generatedAt || '');
  return userDataEvidence?.passed === true
    && Number.isInteger(markerPid)
    && markerPid > 0
    && Number.isFinite(generatedAt)
    && generatedAt >= notBeforeMs - 2000
    && generatedAt <= Date.now() + 10000;
}

function processCreationBelongsToRun(value, notBeforeMs) {
  const createdAt = Date.parse(value || '');
  return Number.isFinite(createdAt)
    && createdAt >= notBeforeMs - 2000
    && createdAt <= Date.now() + 10000;
}

function packagedRendererPathForExecutable(executablePath) {
  const normalized = normalizedExecutablePath(executablePath);
  if (!normalized) return '';
  return path.win32.normalize(path.win32.join(
    path.win32.dirname(executablePath),
    'resources',
    'app',
    'dist',
    'renderer',
    'index.html',
  ));
}

function validatePackageLaunchWindowReadyMarker(marker, {
  expectedPid,
  expectedRendererPath,
  expectedUserDataDir,
  notBeforeMs,
  runtimeMarkerGeneratedAt,
}) {
  const violations = [];
  const generatedAt = Date.parse(marker?.generatedAt || '');
  const runtimeMarkerAt = Date.parse(runtimeMarkerGeneratedAt || '');
  if (marker?.kind !== 'package-launch-window-ready') {
    violations.push({ code: 'WINDOW_READY_KIND_INVALID', actual: marker?.kind ?? null });
  }
  if (marker?.schemaVersion !== 1) {
    violations.push({ code: 'WINDOW_READY_SCHEMA_INVALID', actual: marker?.schemaVersion ?? null });
  }
  if (!Number.isInteger(marker?.pid) || marker.pid < 1 || marker.pid !== Number(expectedPid)) {
    violations.push({
      code: 'WINDOW_READY_PID_MISMATCH',
      actual: marker?.pid ?? null,
      expected: Number(expectedPid) || null,
    });
  }
  if (!Number.isInteger(marker?.browserWindowId) || marker.browserWindowId < 1) {
    violations.push({
      code: 'WINDOW_READY_BROWSER_WINDOW_ID_INVALID',
      actual: marker?.browserWindowId ?? null,
    });
  }
  if (marker?.evidenceMode !== PACKAGE_LAUNCH_SMOKE_MODE) {
    violations.push({
      code: 'WINDOW_READY_EVIDENCE_MODE_MISMATCH',
      actual: marker?.evidenceMode ?? null,
      expected: PACKAGE_LAUNCH_SMOKE_MODE,
    });
  }
  if (
    normalizedExecutablePath(marker?.userDataDir)
    !== normalizedExecutablePath(expectedUserDataDir)
  ) {
    violations.push({
      code: 'WINDOW_READY_USER_DATA_MISMATCH',
      actual: marker?.userDataDir ?? null,
      expected: expectedUserDataDir,
    });
  }
  if (
    !Number.isFinite(generatedAt)
    || generatedAt < notBeforeMs - 2000
    || generatedAt > Date.now() + 10000
  ) {
    violations.push({
      code: 'WINDOW_READY_GENERATED_AT_OUTSIDE_RUN',
      actual: marker?.generatedAt ?? null,
    });
  }
  if (!Number.isFinite(runtimeMarkerAt) || !Number.isFinite(generatedAt) || generatedAt < runtimeMarkerAt) {
    violations.push({
      code: 'WINDOW_READY_PRECEDES_RUNTIME_MARKER',
      actual: marker?.generatedAt ?? null,
      runtimeMarkerGeneratedAt: runtimeMarkerGeneratedAt ?? null,
    });
  }

  let rendererPath = '';
  try {
    const rendererUrl = new URL(String(marker?.rendererUrl || ''));
    if (
      rendererUrl.protocol !== 'file:'
      || rendererUrl.hostname
      || rendererUrl.username
      || rendererUrl.password
    ) {
      violations.push({
        code: 'WINDOW_READY_RENDERER_URL_NOT_PACKAGED_FILE',
        actual: marker?.rendererUrl ?? null,
      });
    } else {
      rendererPath = path.win32.normalize(fileURLToPath(rendererUrl));
    }
  } catch (error) {
    violations.push({
      code: 'WINDOW_READY_RENDERER_URL_INVALID',
      actual: marker?.rendererUrl ?? null,
      error: String(error?.message || error),
    });
  }
  if (
    !rendererPath
    || normalizedExecutablePath(rendererPath) !== normalizedExecutablePath(expectedRendererPath)
  ) {
    violations.push({
      code: 'WINDOW_READY_RENDERER_PATH_MISMATCH',
      actual: rendererPath || marker?.rendererUrl || null,
      expected: expectedRendererPath || null,
    });
  }
  return {
    marker: marker || null,
    passed: violations.length === 0,
    rendererPath: rendererPath || null,
    violations,
  };
}

function readPackageLaunchWindowReadyEvidence(userDataDir, options) {
  const validatedUserDataDir = validateEvidenceUserDataPath(userDataDir);
  const markerPath = path.join(validatedUserDataDir, PACKAGE_LAUNCH_WINDOW_READY_MARKER);
  if (!fs.existsSync(markerPath)) {
    return {
      artifact: null,
      marker: null,
      markerPath,
      passed: false,
      state: 'missing',
      violations: [{ code: 'WINDOW_READY_MARKER_MISSING' }],
    };
  }

  const violations = [];
  let marker = null;
  let bytes = null;
  let before = null;
  let after = null;
  try {
    const linkStat = fs.lstatSync(markerPath);
    if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
      violations.push({ code: 'WINDOW_READY_MARKER_NOT_REGULAR_FILE' });
    }
    before = fs.statSync(markerPath);
    if (before.size < 2 || before.size > PACKAGE_LAUNCH_WINDOW_READY_MAX_BYTES) {
      violations.push({
        code: 'WINDOW_READY_MARKER_SIZE_INVALID',
        sizeBytes: before.size,
      });
    }
    bytes = fs.readFileSync(markerPath);
    after = fs.statSync(markerPath);
    if (
      before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || bytes.length !== after.size
    ) {
      violations.push({ code: 'WINDOW_READY_MARKER_CHANGED_DURING_READ' });
    }
    if (after.mtimeMs < options.notBeforeMs - 2000 || after.mtimeMs > Date.now() + 10000) {
      violations.push({
        code: 'WINDOW_READY_MARKER_MTIME_OUTSIDE_RUN',
        mtime: after.mtime.toISOString(),
      });
    }
    marker = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    violations.push({
      code: 'WINDOW_READY_MARKER_READ_FAILED',
      error: String(error?.message || error),
    });
  }

  const validation = validatePackageLaunchWindowReadyMarker(marker, options);
  violations.push(...validation.violations);
  if (options.expectedRendererPath && !fs.existsSync(options.expectedRendererPath)) {
    violations.push({
      code: 'WINDOW_READY_EXPECTED_RENDERER_FILE_MISSING',
      expected: options.expectedRendererPath,
    });
  }
  return {
    artifact: bytes && after
      ? {
          mtime: after.mtime.toISOString(),
          path: markerPath,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
          sizeBytes: after.size,
        }
      : null,
    marker,
    markerPath,
    passed: violations.length === 0,
    rendererPath: validation.rendererPath,
    state: violations.length === 0 ? 'valid' : 'invalid',
    violations,
  };
}

function selectVerifiedPortableRuntimeProcess(userDataEvidence, processSnapshot, options = {}) {
  const markerPid = Number(userDataEvidence?.marker?.pid);
  const notBeforeMs = Number(options.notBeforeMs || 0);
  if (!currentMarkerIdentity(userDataEvidence, notBeforeMs) || processSnapshot?.error) return null;
  if (options.expectedPid && markerPid !== Number(options.expectedPid)) return null;
  const expectedExecutablePath = normalizedExecutablePath(options.expectedExecutablePath);
  if (!expectedExecutablePath) return null;
  const allowedProcessIds = options.allowedProcessIds instanceof Set
    ? options.allowedProcessIds
    : new Set(options.allowedProcessIds || []);
  if (!options.expectedPid && !allowedProcessIds.has(markerPid)) return null;
  const match = (processSnapshot?.processes || []).find((item) => {
    const executablePath = normalizedExecutablePath(item.ExecutablePath);
    return Number(item.ProcessId) === markerPid
      && String(item.Name || '').toLowerCase() === PORTABLE_APP_PROCESS_NAME.toLowerCase()
      && executablePath
      && executablePath === expectedExecutablePath
      && processCreationBelongsToRun(item.CreationDate, notBeforeMs);
  });
  if (!match) return null;
  if (options.expectedCreationDate) {
    const actualCreatedAt = Date.parse(match.CreationDate || '');
    const expectedCreatedAt = Date.parse(options.expectedCreationDate || '');
    if (
      !Number.isFinite(actualCreatedAt)
      || !Number.isFinite(expectedCreatedAt)
      || Math.abs(actualCreatedAt - expectedCreatedAt) > 2000
    ) {
      return null;
    }
  }
  const record = processRecord(match, 'isolated-runtime-marker', { notBeforeMs });
  if (record.mainWindowHandle <= 0 || record.windowVisible !== true) return null;
  return record;
}

function creationTimestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function sameTrackedProcess(actual, expected) {
  if (Number(actual.processId) !== Number(expected.processId)) return false;
  const actualPath = normalizedExecutablePath(actual.executablePath);
  const expectedPath = normalizedExecutablePath(expected.executablePath);
  if (!actualPath || !expectedPath || actualPath !== expectedPath) return false;
  if (
    expected.name
    && actual.name
    && String(actual.name).toLowerCase() !== String(expected.name).toLowerCase()
  ) {
    return false;
  }
  const actualCreatedAt = creationTimestamp(actual.creationDate);
  const expectedCreatedAt = creationTimestamp(expected.creationDate);
  if (actualCreatedAt !== null && expectedCreatedAt !== null && Math.abs(actualCreatedAt - expectedCreatedAt) > 2000) {
    return false;
  }
  if (
    actualCreatedAt !== null
    && Number.isFinite(expected.notBeforeMs)
    && actualCreatedAt < expected.notBeforeMs - 2000
  ) {
    return false;
  }
  return true;
}

function addTrackedProcess(tracked, input, proof, extra = {}) {
  const record = processRecord(input, proof, extra);
  if (!Number.isInteger(record.processId) || record.processId <= 0) return null;
  const existing = tracked.get(record.processId);
  if (!existing || (!existing.executablePath && record.executablePath)) {
    tracked.set(record.processId, record);
  }
  return tracked.get(record.processId);
}

async function cleanupVerifiedProcessTrees({
  rootProcesses,
  observedProcesses = [],
  observationErrors = [],
  requiredRuntimeIdentity,
  collectByIds = windowsProcessesByIds,
  collectDescendants = windowsDescendants,
  kill = killTree,
  attempts = PROCESS_CLEANUP_ATTEMPTS,
  intervalMs = PROCESS_CLEANUP_INTERVAL_MS,
}) {
  const tracked = new Map();
  const rootIds = new Set();
  const identityViolations = [];
  const treeErrors = (observationErrors || []).map((error) => (
    error && typeof error === 'object'
      ? { ...error, proof: 'launch-observation-error' }
      : { error: String(error), proof: 'launch-observation-error' }
  ));
  const reusedPids = [];
  const killAttempts = [];

  for (const input of rootProcesses || []) {
    const record = addTrackedProcess(tracked, input, input.proof || 'verified-root', {
      notBeforeMs: input.notBeforeMs,
    });
    if (record) {
      rootIds.add(record.processId);
      if (!record.executablePath) {
        identityViolations.push({
          code: 'ROOT_EXECUTABLE_PATH_UNRESOLVED',
          processId: record.processId,
        });
      }
    }
  }
  for (const input of observedProcesses || []) {
    const record = addTrackedProcess(tracked, input, input.proof || 'observed-descendant', {
      notBeforeMs: input.notBeforeMs,
    });
    if (record && !record.executablePath) {
      identityViolations.push({
        code: 'OBSERVED_EXECUTABLE_PATH_UNRESOLVED',
        processId: record.processId,
      });
    }
  }
  if (!requiredRuntimeIdentity) {
    identityViolations.push({
      code: 'RUNTIME_MARKER_IDENTITY_MISSING',
      message: 'The current isolated runtime marker never resolved to this launch.',
    });
  }
  if (tracked.size === 0) {
    identityViolations.push({
      code: 'NO_TRACKED_PROCESS_IDENTITY',
      message: 'No exact root or descendant PID identity was available for cleanup.',
    });
  }

  let lastSnapshot = { processes: [] };
  let remaining = [];
  let unresolved = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastSnapshot = collectByIds([...tracked.keys()]);
    if (lastSnapshot?.error) {
      return {
        attempts: attempt,
        identityViolations,
        killAttempts,
        passed: false,
        remaining,
        remainingCount: remaining.length,
        reusedPids,
        snapshotError: lastSnapshot.error,
        treeErrors,
        unresolved,
      };
    }

    const actualByPid = new Map(
      (lastSnapshot?.processes || [])
        .map((item) => processRecord(item, 'current-process-snapshot'))
        .filter((item) => Number.isInteger(item.processId) && item.processId > 0)
        .map((item) => [item.processId, item]),
    );
    remaining = [];
    unresolved = [];
    for (const [processId, expected] of [...tracked.entries()]) {
      const actual = actualByPid.get(processId);
      if (!actual) {
        tracked.delete(processId);
        continue;
      }
      if (!actual.executablePath) {
        unresolved.push({
          ...actual,
          code: 'EXECUTABLE_PATH_UNRESOLVED',
          expectedExecutablePath: expected.executablePath || null,
        });
        continue;
      }
      if (!sameTrackedProcess(actual, expected)) {
        reusedPids.push({
          processId,
          actualExecutablePath: actual.executablePath,
          expectedExecutablePath: expected.executablePath || null,
          proof: 'pid-reused-or-identity-mismatch',
        });
        tracked.delete(processId);
        rootIds.delete(processId);
        continue;
      }
      remaining.push({ ...actual, proof: expected.proof });
    }

    if (remaining.length === 0 && unresolved.length === 0) {
      return {
        attempts: attempt,
        identityViolations,
        killAttempts,
        passed: identityViolations.length === 0 && treeErrors.length === 0,
        remaining: [],
        remainingCount: 0,
        reusedPids,
        snapshotError: null,
        treeErrors,
        unresolved: [],
      };
    }

    for (const rootProcess of remaining.filter((item) => rootIds.has(item.processId))) {
      const descendants = collectDescendants(rootProcess.processId);
      if (descendants?.error) {
        treeErrors.push({
          processId: rootProcess.processId,
          error: descendants.error,
        });
        continue;
      }
      for (const descendant of descendants.processes || []) {
        const record = addTrackedProcess(
          tracked,
          descendant,
          `descendant-of:${rootProcess.processId}`,
          { notBeforeMs: rootProcesses.find((item) => Number(item.processId) === rootProcess.processId)?.notBeforeMs },
        );
        if (record && !record.executablePath) {
          identityViolations.push({
            code: 'DESCENDANT_EXECUTABLE_PATH_UNRESOLVED',
            processId: record.processId,
            rootProcessId: rootProcess.processId,
          });
        }
      }
    }

    const remainingIds = new Set(remaining.map((item) => item.processId));
    const killRoots = remaining.filter((item) => !remainingIds.has(item.parentProcessId));
    for (const target of killRoots) {
      const result = kill(target.processId);
      killAttempts.push({
        processId: target.processId,
        executablePath: target.executablePath,
        proof: target.proof,
        result: result || null,
      });
    }
    if (attempt < attempts) await sleep(intervalMs);
  }

  return {
    attempts,
    identityViolations,
    killAttempts,
    passed: false,
    remaining,
    remainingCount: remaining.length,
    reusedPids,
    snapshotError: lastSnapshot?.error || null,
    treeErrors,
    unresolved,
  };
}

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`process spawn did not complete within ${WINDOWS_PROCESS_COMMAND_TIMEOUT_MS}ms`));
    }, WINDOWS_PROCESS_COMMAND_TIMEOUT_MS);
    const finish = (callback) => (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    child.once('spawn', finish(() => resolve()));
    child.once('error', finish((error) => reject(error)));
  });
}

function recordObservationError(errors, error) {
  const key = JSON.stringify(error);
  if (!errors.some((item) => JSON.stringify(item) === key)) {
    errors.push(error);
  }
}

function observeDescendants(target, snapshot, proof, notBeforeMs) {
  if (snapshot?.error) {
    recordObservationError(target.errors, snapshot.error);
    return;
  }
  for (const item of snapshot.processes || []) {
    const record = processRecord(item, proof, { notBeforeMs });
    if (!Number.isInteger(record.processId) || record.processId <= 0) {
      recordObservationError(target.errors, {
        code: 'DESCENDANT_PID_INVALID',
        processId: record.processId || null,
      });
      continue;
    }
    if (!record.executablePath) {
      recordObservationError(target.errors, {
        code: 'DESCENDANT_EXECUTABLE_PATH_UNRESOLVED',
        processId: record.processId,
      });
      target.processes.set(record.processId, record);
      continue;
    }
    if (!processCreationBelongsToRun(record.creationDate, notBeforeMs)) {
      recordObservationError(target.errors, {
        code: 'DESCENDANT_CREATION_DATE_OUTSIDE_RUN',
        creationDate: record.creationDate,
        processId: record.processId,
      });
      continue;
    }
    target.processes.set(record.processId, record);
  }
}

async function launchUnpacked(exePath, userDataDir) {
  const stdout = [];
  const stderr = [];
  const stdoutPath = path.join(evidenceDir, `package-launch-unpacked-${runId}.stdout.log`);
  const stderrPath = path.join(evidenceDir, `package-launch-unpacked-${runId}.stderr.log`);
  const launchStartedAt = Date.now();
  const child = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    env: {
      ...buildEvidenceUserDataEnv(process.env, PACKAGE_LAUNCH_SMOKE_MODE, userDataDir),
      ELECTRON_ENABLE_LOGGING: '1',
      ELECTRON_ENABLE_STACK_DUMPING: '1',
    },
    // The unpacked runtime itself owns the BrowserWindow. Starting that GUI
    // process with SW_HIDE can leave Electron's window hidden at the native
    // layer even after BrowserWindow.show(), which makes a false-positive
    // "window ready" marker possible. Keep the GUI launch visible so the
    // native IsWindowVisible proof and the renderer marker describe the same
    // window.
    windowsHide: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => stdout.push(chunk.toString()));
  child.stderr?.on('data', (chunk) => stderr.push(chunk.toString()));

  let directRoot = null;
  let marker = '';
  let runtimeProcess = null;
  let runtimeCandidate = null;
  let windowReadyEvidence = null;
  let processCleanup = null;
  let launchError = null;
  const observationErrors = [];
  try {
    await waitForSpawn(child);
    directRoot = processRecord({
      ProcessId: child.pid,
      ParentProcessId: 0,
      Name: PORTABLE_APP_PROCESS_NAME,
      ExecutablePath: exePath,
    }, 'direct-spawn-pid-and-path', { notBeforeMs: launchStartedAt });
    const deadline = Date.now() + UNPACKED_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const text = stdout.join('');
      const userDataEvidence = collectUserDataEvidence(userDataDir);
      if (currentMarkerIdentity(userDataEvidence, launchStartedAt)) {
        const runtimeSnapshot = windowsRuntimeWindowById(userDataEvidence.marker.pid);
        if (runtimeSnapshot.error) {
          recordObservationError(observationErrors, {
            code: 'RUNTIME_WINDOW_QUERY_FAILED',
            error: runtimeSnapshot.error,
            processId: Number(userDataEvidence.marker.pid),
          });
          await sleep(300);
          continue;
        }
        const candidate = runtimeSnapshot.processes?.[0];
        if (!candidate) {
          recordObservationError(observationErrors, {
            code: 'RUNTIME_MARKER_PID_NOT_OBSERVED',
            processId: Number(userDataEvidence.marker.pid),
          });
          await sleep(300);
          continue;
        }
        const candidateMatchesDirectLaunch = Boolean(
          candidate?.ExecutablePath
          && Number(userDataEvidence.marker.pid) === Number(child.pid)
          && normalizedExecutablePath(candidate.ExecutablePath) === normalizedExecutablePath(exePath)
          && processCreationBelongsToRun(candidate.CreationDate, launchStartedAt)
        );
        if (candidateMatchesDirectLaunch) {
          runtimeCandidate = processRecord(candidate, 'isolated-runtime-marker-candidate', {
            notBeforeMs: launchStartedAt,
          });
        } else {
          recordObservationError(observationErrors, {
            code: 'RUNTIME_DIRECT_IDENTITY_MISMATCH',
            executablePath: candidate.ExecutablePath || null,
            processId: Number(candidate.ProcessId) || null,
          });
        }
        const verified = selectVerifiedPortableRuntimeProcess(userDataEvidence, runtimeSnapshot, {
          expectedExecutablePath: exePath,
          expectedPid: child.pid,
          notBeforeMs: launchStartedAt,
        });
        if (verified && text.includes('[App] window-created')) {
          const candidateWindowReadyEvidence = readPackageLaunchWindowReadyEvidence(userDataDir, {
            expectedPid: verified.processId,
            expectedRendererPath: packagedRendererPathForExecutable(verified.executablePath),
            expectedUserDataDir: userDataDir,
            notBeforeMs: launchStartedAt,
            runtimeMarkerGeneratedAt: userDataEvidence.marker.generatedAt,
          });
          if (candidateWindowReadyEvidence.passed) {
            marker = '[App] window-created';
            runtimeProcess = verified;
            windowReadyEvidence = candidateWindowReadyEvidence;
            break;
          }
          if (candidateWindowReadyEvidence.state !== 'missing') {
            recordObservationError(observationErrors, {
              code: 'WINDOW_READY_MARKER_INVALID',
              violations: candidateWindowReadyEvidence.violations,
            });
          }
        }
      }
      if (child.exitCode !== null) break;
      await sleep(300);
    }
  } catch (error) {
    launchError = String(error?.message || error);
  } finally {
    const finalUserDataEvidence = collectUserDataEvidence(userDataDir);
    if (!windowReadyEvidence) {
      recordObservationError(observationErrors, {
        code: 'WINDOW_READY_MARKER_NOT_VERIFIED',
      });
    }
    if (!directRoot && Number.isInteger(Number(child.pid)) && Number(child.pid) > 0) {
      directRoot = processRecord({
        ProcessId: child.pid,
        ParentProcessId: 0,
        Name: PORTABLE_APP_PROCESS_NAME,
        ExecutablePath: exePath,
      }, 'direct-spawn-pid-and-path', { notBeforeMs: launchStartedAt });
    }
    processCleanup = await cleanupVerifiedProcessTrees({
      observationErrors,
      rootProcesses: [runtimeCandidate || directRoot].filter(Boolean),
      requiredRuntimeIdentity: currentMarkerIdentity(finalUserDataEvidence, launchStartedAt)
        && Boolean(runtimeCandidate),
    });
    child.stdout?.destroy();
    child.stderr?.destroy();
    writeLog(stdoutPath, stdout);
    writeLog(stderrPath, stderr);
  }

  const stdoutText = stdout.join('');
  const stderrText = stderr.join('');
  const userDataEvidence = collectUserDataEvidence(userDataDir);
  return {
    kind: 'win-unpacked',
    ok: Boolean(marker)
      && runtimeProcess?.windowVisible === true
      && windowReadyEvidence?.passed === true
      && userDataEvidence.passed
      && processCleanup.passed
      && observationErrors.length === 0
      && !launchError,
    launchError,
    marker,
    pid: child.pid,
    exitCode: child.exitCode,
    runtimeProcess,
    windowReadyEvidence,
    processCleanup,
    observationErrors,
    stdoutPath,
    stderrPath,
    stdoutTail: stdoutText.slice(-2000),
    stderrTail: stderrText.slice(-2000),
    userDataEvidence,
  };
}

async function launchPortable(exePath, userDataDir) {
  const stdout = [];
  const stderr = [];
  const stdoutPath = path.join(evidenceDir, `package-launch-portable-${runId}.stdout.log`);
  const stderrPath = path.join(evidenceDir, `package-launch-portable-${runId}.stderr.log`);
  const launchStartedAt = Date.now();
  const portableEnv = {
    ...buildEvidenceUserDataEnv(process.env, PACKAGE_LAUNCH_SMOKE_MODE, userDataDir),
    ELECTRON_ENABLE_LOGGING: '1',
    ELECTRON_ENABLE_STACK_DUMPING: '1',
  };
  const child = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    detached: true,
    env: portableEnv,
    windowsHide: true,
    stdio: 'ignore',
  });
  const launcherPid = child.pid;
  let launcherRoot = null;
  const observed = {
    errors: [],
    processes: new Map(),
  };

  let runtimeProcess = null;
  let runtimeCandidate = null;
  let windowReadyEvidence = null;
  let processCleanup = null;
  let launchError = null;
  let nextTreePollAt = 0;
  try {
    child.unref();
    await waitForSpawn(child);
    launcherRoot = processRecord({
      ProcessId: launcherPid,
      ParentProcessId: 0,
      Name: path.basename(exePath),
      ExecutablePath: exePath,
    }, 'direct-portable-launcher-pid-and-path', { notBeforeMs: launchStartedAt });
    const deadline = Date.now() + PORTABLE_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (Date.now() >= nextTreePollAt) {
        observeDescendants(
          observed,
          windowsDescendants(launcherPid),
          `descendant-of:${launcherPid}`,
          launchStartedAt,
        );
        nextTreePollAt = Date.now() + PROCESS_TREE_POLL_INTERVAL_MS;
      }
      const userDataEvidence = collectUserDataEvidence(userDataDir);
      if (currentMarkerIdentity(userDataEvidence, launchStartedAt)) {
        const runtimeSnapshot = windowsRuntimeWindowById(userDataEvidence.marker.pid);
        if (runtimeSnapshot.error) {
          recordObservationError(observed.errors, {
            code: 'RUNTIME_WINDOW_QUERY_FAILED',
            error: runtimeSnapshot.error,
            processId: Number(userDataEvidence.marker.pid),
          });
          await sleep(500);
          continue;
        }
        const candidate = runtimeSnapshot.processes?.[0];
        if (!candidate) {
          recordObservationError(observed.errors, {
            code: 'RUNTIME_MARKER_PID_NOT_OBSERVED',
            processId: Number(userDataEvidence.marker.pid),
          });
          await sleep(500);
          continue;
        }
        const lineageRecord = observed.processes.get(Number(userDataEvidence.marker.pid));
        const candidateMatchesLineage = Boolean(
          lineageRecord
          && candidate?.ExecutablePath
          && normalizedExecutablePath(candidate.ExecutablePath)
            === normalizedExecutablePath(lineageRecord.executablePath)
          && processCreationBelongsToRun(candidate.CreationDate, launchStartedAt)
          && Math.abs(
            Date.parse(candidate.CreationDate || '') - Date.parse(lineageRecord.creationDate || ''),
          ) <= 2000,
        );
        if (candidateMatchesLineage) {
          runtimeCandidate = processRecord(candidate, 'isolated-runtime-marker-candidate', {
            notBeforeMs: launchStartedAt,
          });
        } else if (lineageRecord) {
          recordObservationError(observed.errors, {
            code: 'RUNTIME_LINEAGE_IDENTITY_MISMATCH',
            executablePath: candidate.ExecutablePath || null,
            expectedExecutablePath: lineageRecord.executablePath || null,
            processId: Number(candidate.ProcessId) || null,
          });
        }
        const verified = selectVerifiedPortableRuntimeProcess(userDataEvidence, runtimeSnapshot, {
          allowedProcessIds: new Set(observed.processes.keys()),
          expectedCreationDate: lineageRecord?.creationDate,
          expectedExecutablePath: lineageRecord?.executablePath,
          notBeforeMs: launchStartedAt,
        });
        if (verified) {
          const candidateWindowReadyEvidence = readPackageLaunchWindowReadyEvidence(userDataDir, {
            expectedPid: verified.processId,
            expectedRendererPath: packagedRendererPathForExecutable(verified.executablePath),
            expectedUserDataDir: userDataDir,
            notBeforeMs: launchStartedAt,
            runtimeMarkerGeneratedAt: userDataEvidence.marker.generatedAt,
          });
          if (candidateWindowReadyEvidence.passed) {
            runtimeProcess = verified;
            windowReadyEvidence = candidateWindowReadyEvidence;
            break;
          }
          if (candidateWindowReadyEvidence.state !== 'missing') {
            recordObservationError(observed.errors, {
              code: 'WINDOW_READY_MARKER_INVALID',
              violations: candidateWindowReadyEvidence.violations,
            });
          }
        }
      }
      await sleep(500);
    }
  } catch (error) {
    launchError = String(error?.message || error);
  } finally {
    const finalUserDataEvidence = collectUserDataEvidence(userDataDir);
    if (!windowReadyEvidence) {
      recordObservationError(observed.errors, {
        code: 'WINDOW_READY_MARKER_NOT_VERIFIED',
      });
    }
    if (!launcherRoot && Number.isInteger(Number(launcherPid)) && Number(launcherPid) > 0) {
      launcherRoot = processRecord({
        ProcessId: launcherPid,
        ParentProcessId: 0,
        Name: path.basename(exePath),
        ExecutablePath: exePath,
      }, 'direct-portable-launcher-pid-and-path', { notBeforeMs: launchStartedAt });
    }
    processCleanup = await cleanupVerifiedProcessTrees({
      observationErrors: observed.errors,
      observedProcesses: [...observed.processes.values()],
      rootProcesses: [launcherRoot, runtimeCandidate].filter(Boolean),
      requiredRuntimeIdentity: currentMarkerIdentity(finalUserDataEvidence, launchStartedAt)
        && Boolean(runtimeCandidate),
    });
    writeLog(stdoutPath, stdout);
    writeLog(stderrPath, stderr);
  }

  const userDataEvidence = collectUserDataEvidence(userDataDir);
  return {
    kind: 'portable',
    ok: runtimeProcess?.windowVisible === true
      && windowReadyEvidence?.passed === true
      && userDataEvidence.passed
      && processCleanup.passed
      && observed.errors.length === 0
      && !launchError,
    launchError,
    launcherPid,
    launcherExitCode: child.exitCode,
    runtimeProcess,
    windowReadyEvidence,
    observedProcessCount: observed.processes.size,
    observationErrors: observed.errors,
    processCleanup,
    stdoutPath,
    stderrPath,
    stdoutTail: stdout.join('').slice(-2000),
    stderrTail: stderr.join('').slice(-2000),
    userDataEvidence,
  };
}

async function main() {
  if (process.platform !== 'win32') {
    fail('Package launch smoke currently supports Windows only', process.platform);
  }
  fs.mkdirSync(evidenceDir, { recursive: true });
  const unpackedExe = path.join(releaseDir, 'win-unpacked', 'AmazonAIOpsAgent.exe');
  const portableExe = path.join(releaseDir, `AmazonAIOpsAgent-${desktopPackage.version}-portable.exe`);
  const userDataOverrideBundleContract = inspectPackagedUserDataOverrideContract(
    path.join(releaseDir, 'win-unpacked', 'resources', 'app', 'dist', 'main', 'index.js'),
  );
  const isolatedUserData = {
    unpacked: prepareIsolatedUserData('win-unpacked'),
    portable: prepareIsolatedUserData('portable'),
  };
  const evidence = {
    kind: 'package-launch-smoke',
    generatedAt: new Date().toISOString(),
    releaseDir,
    evidenceMode: PACKAGE_LAUNCH_SMOKE_MODE,
    isolatedUserData,
    userDataOverrideBundleContract,
    artifacts: {
      unpacked: fileInfo(unpackedExe),
      portable: fileInfo(portableExe),
    },
    checks: [],
    passed: false,
  };

  if (!userDataOverrideBundleContract.passed) {
    fail('Package launch smoke refused to start a package without the userData override contract', JSON.stringify(
      userDataOverrideBundleContract.violations,
    ));
  }

  evidence.checks.push(await launchUnpacked(unpackedExe, isolatedUserData.unpacked));
  evidence.checks.push(await launchPortable(portableExe, isolatedUserData.portable));
  evidence.passed = evidence.checks.every((check) => check.ok);
  evidence.contractValidation = validatePackageLaunchSmokeEvidence(evidence);
  if (!evidence.contractValidation.passed) {
    evidence.passed = false;
  }

  const evidencePath = path.join(evidenceDir, `package-launch-smoke-${runId}.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (!evidence.passed) {
    fail('Package launch smoke failed', evidencePath);
  }
  console.log(`[PASS] package launch smoke evidence: ${evidencePath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[FAIL] ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  PORTABLE_START_TIMEOUT_MS,
  PROCESS_CLEANUP_ATTEMPTS,
  TASKKILL_COMMAND_TIMEOUT_MS,
  WINDOWS_PROCESS_COMMAND_TIMEOUT_MS,
  cleanupVerifiedProcessTrees,
  normalizedExecutablePath,
  packagedRendererPathForExecutable,
  readPackageLaunchWindowReadyEvidence,
  selectVerifiedPortableRuntimeProcess,
  validatePackageLaunchSmokeEvidence,
  validatePackageLaunchWindowReadyMarker,
  windowsDescendants,
  windowsProcessesByIds,
  windowsRuntimeWindowById,
};
