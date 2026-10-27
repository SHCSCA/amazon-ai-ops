// 按职责复用原有严格校验，公共入口继续保持兼容。
const { spawn, spawnSync } = require('child_process');
const { PORTABLE_APP_PROCESS_NAME, POWERSHELL_EXECUTABLE, PROCESS_CLEANUP_ATTEMPTS, PROCESS_CLEANUP_INTERVAL_MS, TASKKILL_COMMAND_TIMEOUT_MS, WINDOWS_PROCESS_COMMAND_ATTEMPTS, WINDOWS_PROCESS_COMMAND_TIMEOUT_MS, normalizedExecutablePath, recordObservationError, sameTrackedProcess, sleep } = require('./package-launch-contracts.js');

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
    if (result?.error?.code !== 'ETIMEDOUT' || !Number.isInteger(Number(result.pid)))
        return;
    try {
        process.kill(Number(result.pid), 'SIGKILL');
    }
    catch {
    }
}

function runPowerShell(script) {
    let result;
    for (let attempt = 1; attempt <= WINDOWS_PROCESS_COMMAND_ATTEMPTS; attempt += 1) {
        result = spawnSync(POWERSHELL_EXECUTABLE, ['-NoProfile', '-NonInteractive', '-Command', script], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: WINDOWS_PROCESS_COMMAND_TIMEOUT_MS,
            killSignal: 'SIGKILL',
            maxBuffer: 1024 * 1024,
        });
        terminateTimedOutHelper(result);
        if (result?.error?.code !== 'ETIMEDOUT')
            return result;
    }
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
    if (!text)
        return { processes: [] };
    try {
        const parsed = JSON.parse(text);
        return { processes: Array.isArray(parsed) ? parsed : [parsed] };
    }
    catch (parseError) {
        return { error: parseError.message, raw: text, processes: [] };
    }
}

function windowsDescendants(pid) {
    const script = `
$rootPid = ${Number(pid)}
$records = foreach ($item in @(Get-Process -Name 'AmazonAIOpsAgent*' -ErrorAction SilentlyContinue)) {
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
    if (ids.length === 0)
        return { processes: [] };
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

function selectVerifiedPortableRuntimeProcess(userDataEvidence, processSnapshot, options = {}) {
    const markerPid = Number(userDataEvidence?.marker?.pid);
    const notBeforeMs = Number(options.notBeforeMs || 0);
    if (!currentMarkerIdentity(userDataEvidence, notBeforeMs) || processSnapshot?.error)
        return null;
    if (options.expectedPid && markerPid !== Number(options.expectedPid))
        return null;
    const expectedExecutablePath = normalizedExecutablePath(options.expectedExecutablePath);
    if (!expectedExecutablePath)
        return null;
    const allowedProcessIds = options.allowedProcessIds instanceof Set
        ? options.allowedProcessIds
        : new Set(options.allowedProcessIds || []);
    if (!options.expectedPid && !allowedProcessIds.has(markerPid))
        return null;
    const match = (processSnapshot?.processes || []).find((item) => {
        const executablePath = normalizedExecutablePath(item.ExecutablePath);
        return Number(item.ProcessId) === markerPid
            && String(item.Name || '').toLowerCase() === PORTABLE_APP_PROCESS_NAME.toLowerCase()
            && executablePath
            && executablePath === expectedExecutablePath
            && processCreationBelongsToRun(item.CreationDate, notBeforeMs);
    });
    if (!match)
        return null;
    if (options.expectedCreationDate) {
        const actualCreatedAt = Date.parse(match.CreationDate || '');
        const expectedCreatedAt = Date.parse(options.expectedCreationDate || '');
        if (!Number.isFinite(actualCreatedAt)
            || !Number.isFinite(expectedCreatedAt)
            || Math.abs(actualCreatedAt - expectedCreatedAt) > 2000) {
            return null;
        }
    }
    const record = processRecord(match, 'isolated-runtime-marker', { notBeforeMs });
    if (record.mainWindowHandle <= 0 || record.windowVisible !== true)
        return null;
    return record;
}

function addTrackedProcess(tracked, input, proof, extra = {}) {
    const record = processRecord(input, proof, extra);
    if (!Number.isInteger(record.processId) || record.processId <= 0)
        return null;
    const existing = tracked.get(record.processId);
    if (!existing || (!existing.executablePath && record.executablePath)) {
        tracked.set(record.processId, record);
    }
    return tracked.get(record.processId);
}

async function cleanupVerifiedProcessTrees({ rootProcesses, observedProcesses = [], observationErrors = [], requiredRuntimeIdentity, collectByIds = windowsProcessesByIds, collectDescendants = windowsDescendants, kill = killTree, attempts = PROCESS_CLEANUP_ATTEMPTS, intervalMs = PROCESS_CLEANUP_INTERVAL_MS, }) {
    const tracked = new Map();
    const rootIds = new Set();
    const identityViolations = [];
    const treeErrors = (observationErrors || []).map((error) => (error && typeof error === 'object'
        ? { ...error, proof: 'launch-observation-error' }
        : { error: String(error), proof: 'launch-observation-error' }));
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
        const actualByPid = new Map((lastSnapshot?.processes || [])
            .map((item) => processRecord(item, 'current-process-snapshot'))
            .filter((item) => Number.isInteger(item.processId) && item.processId > 0)
            .map((item) => [item.processId, item]));
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
                const record = addTrackedProcess(tracked, descendant, `descendant-of:${rootProcess.processId}`, { notBeforeMs: rootProcesses.find((item) => Number(item.processId) === rootProcess.processId)?.notBeforeMs });
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
        if (attempt < attempts)
            await sleep(intervalMs);
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
            if (settled)
                return;
            settled = true;
            reject(new Error(`process spawn did not complete within ${WINDOWS_PROCESS_COMMAND_TIMEOUT_MS}ms`));
        }, WINDOWS_PROCESS_COMMAND_TIMEOUT_MS);
        const finish = (callback) => (value) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            callback(value);
        };
        child.once('spawn', finish(() => resolve()));
        child.once('error', finish((error) => reject(error)));
    });
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

module.exports = { commandFailure, terminateTimedOutHelper, runPowerShell, killTree, parseWindowsProcessSnapshot, windowsDescendants, windowsProcessesByIds, windowsRuntimeWindowById, processRecord, currentMarkerIdentity, processCreationBelongsToRun, selectVerifiedPortableRuntimeProcess, addTrackedProcess, cleanupVerifiedProcessTrees, waitForSpawn, observeDescendants };
