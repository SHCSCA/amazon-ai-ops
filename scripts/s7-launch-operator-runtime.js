// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const path = require('node:path');
const { collectFixedPackageHashes, evaluatePackageUiEvidenceCompleteness, } = require('./package-ui-evidence');
const { verifyS7MigrationBackupRestore, } = require('./verify-s7-migration-backup-restore');
const { captureAuthoritySnapshotCurrentness } = require('./sqlite-authority-currentness');
const { defaultExclusiveDbPreflight, defaultInspectAuthority, defaultInspectPostMigrationAuthority, defaultPackageIdentity, defaultReadSchema, defaultResolveRoamingAppData, defaultResolveUserProfile } = require('./s7-launch-operator-authority.js');
const { INTENT_DIRECTORY_NAME, STARTUP_GATE_ACTIVE_FILE, STARTUP_GATE_ADMISSION_FILE, STARTUP_GATE_BOUND_FILE, STARTUP_GATE_CLOSED_FILE, STARTUP_GATE_DIRECTORY_NAME, STARTUP_GATE_FINALIZED_FILE, STARTUP_GATE_HANDOFF_READY_FILE, STARTUP_GATE_HANDOFF_RELEASED_FILE, STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE, exists, fail } = require('./s7-launch-operator-contracts.js');
const { directPath } = require('./s7-launch-operator-filesystem.js');
const { defaultListProcesses, defaultListSuspendedSameNameProcesses } = require('./s7-launch-operator-processes.js');
const { defaultAbortUnlaunchedExclusiveWindow, defaultAcquireLaunchExclusiveWindow, defaultCreateSuspendedPackage, defaultDetachManagedLaunch, defaultReleaseAndResumePackage, defaultWaitForManagedPackageClose } = require('./s7-launch-operator-protocol.js');
const { defaultInspectWindowsPathSecurity, defaultProtectWindowsDirectory, defaultProtectWindowsFile, minimalWindowsRuntimeEnvironment, resolveTrustedWindowsPowerShell } = require('./s7-launch-operator-security.js');

function defaultEnsureIntentDirectory(userDataDir, inspectWindowsPathSecurity = defaultInspectWindowsPathSecurity, protectWindowsDirectory = defaultProtectWindowsDirectory) {
    const root = directPath(userDataDir, 'Canonical packaged userData', 'directory');
    const intentDir = path.join(root.realPath, INTENT_DIRECTORY_NAME);
    if (!exists(intentDir)) {
        fs.mkdirSync(intentDir, { recursive: false });
        protectWindowsDirectory(intentDir);
    }
    const resolved = directPath(intentDir, 'Live migration launch-intent directory', 'directory').realPath;
    const security = inspectWindowsPathSecurity(resolved, {
        label: 'Live migration launch-intent directory',
        type: 'directory',
        requireProtected: true,
    });
    if (security?.passed !== true) {
        fail('Live migration launch-intent directory Windows ACL proof failed.');
    }
    return resolved;
}

function defaultEnsureStartupGateDirectory(userDataDir, inspectWindowsPathSecurity = defaultInspectWindowsPathSecurity, protectWindowsDirectory = defaultProtectWindowsDirectory) {
    const root = directPath(userDataDir, 'Canonical packaged userData', 'directory');
    const gateDirectory = path.join(root.realPath, STARTUP_GATE_DIRECTORY_NAME);
    if (!exists(gateDirectory)) {
        fs.mkdirSync(gateDirectory, { recursive: false });
        protectWindowsDirectory(gateDirectory);
    }
    const resolved = directPath(gateDirectory, 'S7 packaged Main startup gate directory', 'directory').realPath;
    const security = inspectWindowsPathSecurity(resolved, {
        label: 'S7 packaged Main startup gate directory',
        type: 'directory',
        requireProtected: true,
    });
    if (security?.passed !== true) {
        fail('S7 packaged Main startup gate directory Windows ACL proof failed.');
    }
    for (const name of [
        STARTUP_GATE_ACTIVE_FILE,
        STARTUP_GATE_BOUND_FILE,
        STARTUP_GATE_HANDOFF_READY_FILE,
        STARTUP_GATE_HANDOFF_RELEASED_FILE,
        STARTUP_GATE_ADMISSION_FILE,
        STARTUP_GATE_CLOSED_FILE,
        STARTUP_GATE_FINALIZED_FILE,
        STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE,
    ]) {
        if (exists(path.join(resolved, name))) {
            fail(`S7 packaged Main startup gate already contains ${name}; preserve ACTIVE/HOLD and do not retry.`);
        }
    }
    return resolved;
}

function childEnvironment(env, canonical) {
    const result = minimalWindowsRuntimeEnvironment(env);
    result.APPDATA = canonical.roamingAppData;
    result.USERPROFILE = canonical.userProfile;
    return result;
}

function defaultContext(injected = {}) {
    return {
        env: process.env,
        platform: process.platform,
        now: () => new Date(),
        packageIdentity: defaultPackageIdentity,
        trustedPowerShellIdentity: () => resolveTrustedWindowsPowerShell(process.env),
        listProcesses: defaultListProcesses,
        listSuspendedProcesses: defaultListSuspendedSameNameProcesses,
        readSchemaVersion: defaultReadSchema,
        inspectPostMigrationAuthority: defaultInspectPostMigrationAuthority,
        captureAuthorityCurrentness: captureAuthoritySnapshotCurrentness,
        assertProcessAbsent: (pid) => {
            if (!Number.isInteger(pid) || pid < 1)
                fail('Recovery process identity is invalid.');
            try {
                process.kill(pid, 0);
            }
            catch (error) {
                if (error.code === 'ESRCH')
                    return;
                fail('Recovery cannot establish that the original process exited.');
            }
            fail('Recovery requires the original Main and helper processes to have exited.');
        },
        resolveRoamingAppData: defaultResolveRoamingAppData,
        resolveUserProfile: defaultResolveUserProfile,
        inspectAuthority: defaultInspectAuthority,
        verifyMigration: verifyS7MigrationBackupRestore,
        evaluatePackageUiEvidence: evaluatePackageUiEvidenceCompleteness,
        exclusiveDbPreflight: defaultExclusiveDbPreflight,
        acquireLaunchExclusiveWindow: defaultAcquireLaunchExclusiveWindow,
        createSuspendedPackage: defaultCreateSuspendedPackage,
        releaseAndResumePackage: defaultReleaseAndResumePackage,
        waitForManagedPackageClose: defaultWaitForManagedPackageClose,
        detachManagedLaunch: defaultDetachManagedLaunch,
        abortUnlaunchedExclusiveWindow: defaultAbortUnlaunchedExclusiveWindow,
        ensureIntentDirectory: defaultEnsureIntentDirectory,
        ensureStartupGateDirectory: defaultEnsureStartupGateDirectory,
        inspectWindowsPathSecurity: defaultInspectWindowsPathSecurity,
        protectWindowsDirectory: defaultProtectWindowsDirectory,
        protectWindowsFile: defaultProtectWindowsFile,
        writeStdout: process.stdout.write.bind(process.stdout),
        ...injected,
    };
}

function validateContext(context) {
    for (const key of [
        'now',
        'packageIdentity',
        'trustedPowerShellIdentity',
        'listProcesses',
        'listSuspendedProcesses',
        'readSchemaVersion',
        'inspectPostMigrationAuthority',
        'resolveRoamingAppData',
        'resolveUserProfile',
        'inspectAuthority',
        'verifyMigration',
        'evaluatePackageUiEvidence',
        'exclusiveDbPreflight',
        'acquireLaunchExclusiveWindow',
        'createSuspendedPackage',
        'releaseAndResumePackage',
        'waitForManagedPackageClose',
        'detachManagedLaunch',
        'abortUnlaunchedExclusiveWindow',
        'ensureIntentDirectory',
        'ensureStartupGateDirectory',
        'inspectWindowsPathSecurity',
        'protectWindowsDirectory',
        'protectWindowsFile',
        'writeStdout',
    ]) {
        if (typeof context[key] !== 'function')
            fail(`Launch operator ${key} dependency is invalid.`);
    }
    if (!context.env || typeof context.env !== 'object') {
        fail('Launch operator env dependency is invalid.');
    }
}

function assertWindows(context) {
    if (context.platform !== 'win32') {
        fail('Live authority migration launch is supported only on Windows.');
    }
}

module.exports = { defaultEnsureIntentDirectory, defaultEnsureStartupGateDirectory, childEnvironment, defaultContext, validateContext, assertWindows };
