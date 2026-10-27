// 按职责复用原有严格校验，公共入口继续保持兼容。
const crypto = require('node:crypto');
const path = require('node:path');
const { STARTUP_GATE_ACTIVE_FILE, STARTUP_GATE_ACTIVE_KIND, STARTUP_GATE_ACTIVE_SCHEMA, STARTUP_GATE_ADMISSION_FILE, STARTUP_GATE_BOUND_FILE, STARTUP_GATE_CLOSED_FILE, STARTUP_GATE_FINALIZED_FILE, STARTUP_GATE_HANDOFF_READY_FILE, STARTUP_GATE_HANDOFF_RELEASED_FILE, TRUSTED_POWERSHELL_MAX_HARDLINKS, TRUSTED_POWERSHELL_MAX_HARDLINK_PATH_CHARACTERS, TRUSTED_POWERSHELL_SIGNATURE_SUBJECT, cleanAbsolute, fail, normalizeSha, nowIso, publicArtifact } = require('./s7-launch-operator-contracts.js');
const { fileArtifact, writeDurableBlockingIntent } = require('./s7-launch-operator-filesystem.js');

function createLaunchIntent(packetRead, packetIdentity, bindings, output, context) {
    const intentDirectory = context.ensureIntentDirectory(bindings.canonical.userDataDir, context.inspectWindowsPathSecurity, context.protectWindowsDirectory);
    const intentPath = path.join(intentDirectory, `${packetIdentity.hash}.intent.json`);
    writeDurableBlockingIntent(intentPath, {
        kind: 's7-live-migration-launch-intent',
        schemaVersion: 's7-live-migration-launch-intent/v1',
        generatedAt: nowIso(context.now),
        status: 'CONSUMED_BEFORE_SPAWN',
        packet: publicArtifact(packetRead.artifact),
        approvalPayloadSha256: packetIdentity.hash,
        database: bindings.db,
        package: bindings.package,
        requestedReceiptPath: output,
        processKillInvoked: false,
        automaticRetryInvoked: false,
        rollbackInvoked: false,
    });
    context.protectWindowsFile(intentPath);
    const artifact = publicArtifact(fileArtifact(intentPath, 'Live migration launch intent'));
    const windowsSecurity = context.inspectWindowsPathSecurity(intentPath, {
        label: 'Live migration launch intent',
        type: 'file',
        requireProtected: true,
    });
    if (windowsSecurity?.passed !== true) {
        fail('Live migration launch intent Windows ACL proof failed.');
    }
    return { ...artifact, windowsSecurity };
}

function startupGateArtifactBinding(value, label) {
    const identityValue = value?.identity;
    const deviceId = identityValue?.deviceId ?? identityValue?.dev;
    const fileId = identityValue?.fileId ?? identityValue?.ino;
    const hardLinkCount = identityValue?.hardLinkCount ?? identityValue?.nlink;
    const binding = {
        realPath: cleanAbsolute(value?.realPath, `${label} real path`),
        sha256: normalizeSha(value?.sha256, `${label} SHA-256`),
        sizeBytes: Number(value?.sizeBytes),
        identity: {
            deviceId: String(deviceId ?? ''),
            fileId: String(fileId ?? ''),
            hardLinkCount: Number(hardLinkCount),
        },
    };
    if (!Number.isInteger(binding.sizeBytes)
        || binding.sizeBytes < 1
        || !binding.identity.deviceId
        || !binding.identity.fileId
        || binding.identity.hardLinkCount !== 1) {
        fail(`${label} does not have a strict single-file startup-gate identity.`);
    }
    return binding;
}

function startupGatePackageBinding(value) {
    const appContent = value?.appContent;
    if (!appContent
        || !Number.isInteger(Number(appContent.fileCount))
        || Number(appContent.fileCount) < 1
        || !Number.isInteger(Number(appContent.sizeBytes))
        || Number(appContent.sizeBytes) < 1) {
        fail('Approved package app-content identity is invalid for the startup gate.');
    }
    return {
        exe: startupGateArtifactBinding(value.exe, 'Approved package executable'),
        appContent: {
            realPath: cleanAbsolute(appContent.realPath, 'Approved package app-content path'),
            sha256: normalizeSha(appContent.sha256, 'Approved package app-content SHA-256'),
            fileCount: Number(appContent.fileCount),
            sizeBytes: Number(appContent.sizeBytes),
        },
        main: startupGateArtifactBinding(value.main, 'Approved package Main'),
    };
}

function startupGateTrustedShellBinding(value) {
    const binding = {
        realPath: cleanAbsolute(value?.realPath, 'Trusted PowerShell real path'),
        sha256: normalizeSha(value?.sha256, 'Trusted PowerShell SHA-256'),
        sizeBytes: Number(value?.sizeBytes),
        identity: {
            deviceId: String(value?.identity?.deviceId ?? value?.identity?.dev ?? ''),
            fileId: String(value?.identity?.fileId ?? value?.identity?.ino ?? ''),
            hardLinkCount: Number(value?.identity?.hardLinkCount ?? value?.identity?.nlink),
        },
        hardlinkPaths: Array.isArray(value?.hardlinkPaths)
            ? value.hardlinkPaths.map((item) => cleanAbsolute(item, 'Trusted PowerShell hard link'))
            : [],
        signature: {
            status: String(value?.signature?.status || ''),
            subject: String(value?.signature?.subject || ''),
            thumbprint: String(value?.signature?.thumbprint || '').toUpperCase(),
        },
        version: {
            companyName: String(value?.version?.companyName || ''),
            fileVersion: String(value?.version?.fileVersion || ''),
            originalFilename: String(value?.version?.originalFilename || ''),
            productName: String(value?.version?.productName || ''),
        },
    };
    if (!Number.isInteger(binding.sizeBytes)
        || binding.sizeBytes < 1
        || !binding.identity.deviceId
        || !binding.identity.fileId
        || !Number.isInteger(binding.identity.hardLinkCount)
        || binding.identity.hardLinkCount < 1
        || binding.identity.hardLinkCount > TRUSTED_POWERSHELL_MAX_HARDLINKS
        || binding.hardlinkPaths.length !== binding.identity.hardLinkCount
        || binding.hardlinkPaths.reduce((total, item) => total + item.length, 0)
            > TRUSTED_POWERSHELL_MAX_HARDLINK_PATH_CHARACTERS
        || binding.signature.status !== 'Valid'
        || !TRUSTED_POWERSHELL_SIGNATURE_SUBJECT.test(binding.signature.subject)
        || !binding.signature.thumbprint
        || !/^Microsoft/i.test(binding.version.companyName)
        || !binding.version.fileVersion
        || !binding.version.originalFilename.toLowerCase().includes('powershell')) {
        fail('Trusted PowerShell identity is invalid for the startup gate.');
    }
    return binding;
}

function createStartupGatePlan(bindings, launchIntent, context) {
    const gateDirectory = context.ensureStartupGateDirectory(bindings.canonical.userDataDir, context.inspectWindowsPathSecurity, context.protectWindowsDirectory);
    const activePath = path.join(gateDirectory, STARTUP_GATE_ACTIVE_FILE);
    const boundPath = path.join(gateDirectory, STARTUP_GATE_BOUND_FILE);
    const handoffReadyPath = path.join(gateDirectory, STARTUP_GATE_HANDOFF_READY_FILE);
    const handoffReleasedPath = path.join(gateDirectory, STARTUP_GATE_HANDOFF_RELEASED_FILE);
    const admissionPath = path.join(gateDirectory, STARTUP_GATE_ADMISSION_FILE);
    const closedPath = path.join(gateDirectory, STARTUP_GATE_CLOSED_FILE);
    const finalizedPath = path.join(gateDirectory, STARTUP_GATE_FINALIZED_FILE);
    const gateId = `gate-${crypto.randomUUID()}`;
    const invocationId = `invocation-${crypto.randomUUID()}`;
    const packageBinding = startupGatePackageBinding(bindings.package);
    const executableBinding = startupGateArtifactBinding(bindings.package.exe, 'Approved executable');
    const shellBinding = startupGateTrustedShellBinding(context.trustedPowerShellIdentity());
    const activeDocument = {
        kind: STARTUP_GATE_ACTIVE_KIND,
        schemaVersion: STARTUP_GATE_ACTIVE_SCHEMA,
        status: 'ACTIVE_AWAITING_BOUND_CHILD',
        gateId,
        invocationId,
        createdAt: nowIso(context.now),
        canonicalUserDataDir: bindings.canonical.userDataDir,
        paths: {
            active: activePath,
            bound: boundPath,
            handoffReady: handoffReadyPath,
            handoffReleased: handoffReleasedPath,
            admission: admissionPath,
            closed: closedPath,
            finalized: finalizedPath,
        },
        bindings: {
            executable: executableBinding,
            package: packageBinding,
            database: startupGateArtifactBinding(bindings.db, 'Authority database'),
            intent: startupGateArtifactBinding(launchIntent, 'Launch intent'),
            shell: shellBinding,
        },
    };
    return {
        gateDirectory,
        activePath,
        boundPath,
        handoffReadyPath,
        handoffReleasedPath,
        admissionPath,
        closedPath,
        finalizedPath,
        gateId,
        invocationId,
        activeDocument,
    };
}

function receiptPackageIdentity(value) {
    return {
        exe: {
            ...value.exe,
            identity: value.exe.identity ? { ...value.exe.identity } : null,
        },
        appContent: { ...value.appContent },
        main: {
            ...value.main,
            identity: value.main.identity ? { ...value.main.identity } : null,
        },
    };
}

function receiptProcessState(value) {
    return {
        passed: value?.passed === true,
        matching: Array.isArray(value?.matching)
            ? value.matching.map((item) => ({
                pid: Number.isInteger(Number(item?.pid)) ? Number(item.pid) : null,
                parentPid: Number.isInteger(Number(item?.parentPid))
                    ? Number(item.parentPid)
                    : null,
                executablePath: typeof item?.executablePath === 'string'
                    ? item.executablePath
                    : null,
            }))
            : [],
        unresolved: Array.isArray(value?.unresolved)
            ? value.unresolved.map((item) => String(item).slice(0, 120))
            : ['process-state-shape-invalid'],
    };
}

module.exports = { createLaunchIntent, startupGateArtifactBinding, startupGatePackageBinding, startupGateTrustedShellBinding, createStartupGatePlan, receiptPackageIdentity, receiptProcessState };
