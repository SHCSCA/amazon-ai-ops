// 按职责复用原有严格校验，公共入口继续保持兼容。

const { receiptProcessState } = require('./s7-launch-operator-bindings.js');
const { fail, parsePowerShellJson } = require('./s7-launch-operator-contracts.js');
const { minimalWindowsRuntimeEnvironment, spawnTrustedWindowsPowerShell } = require('./s7-launch-operator-security.js');

function defaultListProcesses() {
    const result = spawnTrustedWindowsPowerShell([
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `@(Get-CimInstance Win32_Process -Filter "Name='AmazonAIOpsAgent.exe'" | Select-Object ProcessId,ParentProcessId,ExecutablePath) | ConvertTo-Json -Compress`,
    ], {
        encoding: 'utf8',
        env: minimalWindowsRuntimeEnvironment(process.env),
        windowsHide: true,
        timeout: 20000,
    });
    const parsed = parsePowerShellJson(result, 'process');
    const unresolved = [...parsed.unresolved];
    const matching = [];
    for (const row of parsed.rows) {
        if (!Number.isInteger(Number(row?.ProcessId)) || !String(row?.ExecutablePath || '').trim()) {
            unresolved.push('process-identity-unresolved');
        }
        else {
            matching.push({
                pid: Number(row.ProcessId),
                parentPid: Number.isInteger(Number(row.ParentProcessId))
                    ? Number(row.ParentProcessId)
                    : null,
                executablePath: String(row.ExecutablePath),
            });
        }
    }
    return { passed: parsed.passed, matching, unresolved };
}

function defaultListSuspendedSameNameProcesses() {
    const result = spawnTrustedWindowsPowerShell([
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `@(Get-CimInstance Win32_Process -Filter "Name='AmazonAIOpsAgent.exe'" | Select-Object ProcessId,ParentProcessId) | ConvertTo-Json -Compress`,
    ], {
        encoding: 'utf8',
        env: minimalWindowsRuntimeEnvironment(process.env),
        windowsHide: true,
        timeout: 20000,
    });
    const parsed = parsePowerShellJson(result, 'suspended-process');
    const unresolved = [...parsed.unresolved];
    const matching = [];
    for (const row of parsed.rows) {
        if (!Number.isInteger(Number(row?.ProcessId)) || Number(row.ProcessId) < 1) {
            unresolved.push('suspended-process-id-unresolved');
        }
        else {
            matching.push({
                pid: Number(row.ProcessId),
                parentPid: Number.isInteger(Number(row.ParentProcessId))
                    ? Number(row.ParentProcessId)
                    : null,
                executablePath: null,
            });
        }
    }
    return { passed: parsed.passed, matching, unresolved };
}

function validateProcessState(state, label) {
    if (!state
        || state.passed !== true
        || !Array.isArray(state.matching)
        || !Array.isArray(state.unresolved)
        || state.matching.length !== 0
        || state.unresolved.length !== 0) {
        fail(`${label} has an existing or unresolved AmazonAIOpsAgent process.`);
    }
}

function validateSpawnProcessState(state, rootPid) {
    if (!state
        || state.passed !== true
        || !Array.isArray(state.matching)
        || !Array.isArray(state.unresolved)
        || state.unresolved.length !== 0) {
        fail('Spawn-window AmazonAIOpsAgent process inventory was unresolved.');
    }
    const byPid = new Map();
    for (const item of state.matching) {
        const pid = Number(item?.pid);
        if (!Number.isInteger(pid)
            || pid < 1
            || byPid.has(pid)) {
            fail('Spawn-window process inventory contained an invalid same-name process ID.');
        }
        byPid.set(pid, item);
    }
    if (!byPid.has(rootPid)) {
        fail('Spawn-window process inventory did not contain the confirmed root PID.');
    }
    const allowed = new Set([rootPid]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const item of byPid.values()) {
            if (!allowed.has(item.pid) && allowed.has(Number(item.parentPid))) {
                allowed.add(item.pid);
                changed = true;
            }
        }
    }
    if (allowed.size !== byPid.size) {
        fail('Spawn-window process inventory contained an unrelated same-name process.');
    }
    return receiptProcessState(state);
}

module.exports = { defaultListProcesses, defaultListSuspendedSameNameProcesses, validateProcessState, validateSpawnProcessState };
