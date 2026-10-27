// 按职责复用原有严格校验，公共入口继续保持兼容。
const path = require('path');
const { resolvePackageEvidencePaths } = require('./package-evidence-paths');


const root = path.resolve(__dirname, '..');

const releaseDir = path.join(root, 'apps', 'desktop', 'release');

const evidenceDir = path.join(root, 'output', 'codex-evidence');

const runId = Date.now();

const isolatedUserDataRoot = resolvePackageEvidencePaths(root, runId).packageLaunchUserDataRoot;

const PORTABLE_START_TIMEOUT_MS = 300000;

const UNPACKED_START_TIMEOUT_MS = 60000;

const WINDOWS_PROCESS_COMMAND_TIMEOUT_MS = 60000;

const WINDOWS_PROCESS_COMMAND_ATTEMPTS = 3;

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

function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function normalizedExecutablePath(filePath) {
    const value = String(filePath || '');
    return value ? path.win32.normalize(value).toLowerCase() : '';
}

function creationTimestamp(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : null;
}

function sameTrackedProcess(actual, expected) {
    if (Number(actual.processId) !== Number(expected.processId))
        return false;
    const actualPath = normalizedExecutablePath(actual.executablePath);
    const expectedPath = normalizedExecutablePath(expected.executablePath);
    if (!actualPath || !expectedPath || actualPath !== expectedPath)
        return false;
    if (expected.name
        && actual.name
        && String(actual.name).toLowerCase() !== String(expected.name).toLowerCase()) {
        return false;
    }
    const actualCreatedAt = creationTimestamp(actual.creationDate);
    const expectedCreatedAt = creationTimestamp(expected.creationDate);
    if (actualCreatedAt !== null && expectedCreatedAt !== null && Math.abs(actualCreatedAt - expectedCreatedAt) > 2000) {
        return false;
    }
    if (actualCreatedAt !== null
        && Number.isFinite(expected.notBeforeMs)
        && actualCreatedAt < expected.notBeforeMs - 2000) {
        return false;
    }
    return true;
}

function recordObservationError(errors, error) {
    const key = JSON.stringify(error);
    if (!errors.some((item) => JSON.stringify(item) === key)) {
        errors.push(error);
    }
}

module.exports = { fail, sleep, stableJson, normalizedExecutablePath, creationTimestamp, sameTrackedProcess, recordObservationError, root, releaseDir, evidenceDir, runId, isolatedUserDataRoot, PORTABLE_START_TIMEOUT_MS, UNPACKED_START_TIMEOUT_MS, WINDOWS_PROCESS_COMMAND_TIMEOUT_MS, WINDOWS_PROCESS_COMMAND_ATTEMPTS, TASKKILL_COMMAND_TIMEOUT_MS, PROCESS_CLEANUP_ATTEMPTS, PROCESS_CLEANUP_INTERVAL_MS, PROCESS_TREE_POLL_INTERVAL_MS, PORTABLE_APP_PROCESS_NAME, POWERSHELL_EXECUTABLE, PACKAGE_LAUNCH_WINDOW_READY_MARKER, PACKAGE_LAUNCH_WINDOW_READY_MAX_BYTES };
