// 按职责复用原有严格校验，公共入口继续保持兼容。
const fs = require('node:fs');
const { startupGateArtifactBinding } = require('./s7-launch-operator-bindings.js');
const { EXCLUSIVE_WINDOW_PROTOCOL, MAX_PROTOCOL_CLOCK_SKEW_MS, STARTUP_GATE_ADMISSION_KIND, STARTUP_GATE_ADMISSION_SCHEMA, STARTUP_GATE_BOUND_KIND, STARTUP_GATE_BOUND_SCHEMA, STARTUP_GATE_CLOSED_KIND, STARTUP_GATE_CLOSED_SCHEMA, SUPPORTED_SOURCE_VERSIONS, fail, normalizeSha, sameArtifact, samePath, stableJson } = require('./s7-launch-operator-contracts.js');
const { startupGateFileArtifact } = require('./s7-launch-operator-filesystem.js');

function validateProtocolTimestamp(value, label, context, minimumMs = null) {
    const parsed = Date.parse(value || '');
    const current = context.now();
    if (!(current instanceof Date) || !Number.isFinite(current.valueOf())) {
        fail('Clock returned an invalid date.');
    }
    if (!Number.isFinite(parsed)
        || parsed > current.valueOf() + MAX_PROTOCOL_CLOCK_SKEW_MS
        || (Number.isFinite(minimumMs) && parsed < minimumMs)) {
        fail(`${label} is invalid, out of order, or future-dated.`);
    }
    return {
        milliseconds: parsed,
        iso: new Date(parsed).toISOString(),
    };
}

function validateLaunchExclusiveReady(windowHandle, db, context) {
    const proof = windowHandle?.proof;
    const helperPid = Number(windowHandle?.helperPid);
    const openedAt = validateProtocolTimestamp(proof?.openedAt, 'Exclusive-window READY timestamp', context);
    if (proof?.protocol !== EXCLUSIVE_WINDOW_PROTOCOL
        || proof?.status !== 'READY'
        || !Number.isInteger(helperPid)
        || helperPid < 1
        || Number(proof?.helperPid) !== helperPid
        || !samePath(proof?.path, db.realPath)
        || normalizeSha(proof?.sha256, 'Exclusive-window database SHA') !== db.sha256
        || Number(proof?.sizeBytes) !== db.sizeBytes
        || proof?.databaseHandleExclusive !== true) {
        fail('Launch-exclusive FileShare.None helper did not bind the approved live DB.');
    }
    return {
        protocol: EXCLUSIVE_WINDOW_PROTOCOL,
        status: 'READY',
        helperPid,
        path: db.realPath,
        sha256: db.sha256,
        sizeBytes: db.sizeBytes,
        databaseHandleExclusive: true,
        openedAt: openedAt.iso,
    };
}

function validateStartupGateProtocolArtifact(proof, prefix, expectedPath, label, context) {
    const artifact = startupGateFileArtifact(expectedPath, label);
    const security = context.inspectWindowsPathSecurity(artifact.realPath, {
        label,
        type: 'file',
        requireProtected: true,
    });
    if (security?.passed !== true
        || !samePath(proof?.[`${prefix}Path`], artifact.realPath)
        || normalizeSha(proof?.[`${prefix}Sha256`], `${label} proof SHA-256`) !== artifact.sha256
        || String(proof?.[`${prefix}DeviceId`] || '') !== artifact.identity.deviceId
        || String(proof?.[`${prefix}FileId`] || '') !== artifact.identity.fileId) {
        fail(`${label} helper proof does not match the strict file identity.`);
    }
    return { ...artifact, windowsSecurity: security };
}

function validateSuspendedPackageProof(proof, ready, executablePath, startupGatePlan, context) {
    const createdAt = validateProtocolTimestamp(proof?.createdAt, 'Exclusive-window SPAWNED timestamp', context, Date.parse(ready.openedAt));
    if (proof?.protocol !== EXCLUSIVE_WINDOW_PROTOCOL
        || proof?.status !== 'SPAWNED'
        || Number(proof?.helperPid) !== ready.helperPid
        || !Number.isInteger(Number(proof?.pid))
        || Number(proof.pid) < 1
        || !Number.isInteger(Number(proof?.threadId))
        || Number(proof.threadId) < 1
        || !samePath(proof?.executablePath, executablePath)
        || !samePath(proof?.queriedExecutablePath, executablePath)
        || proof?.processImageQueryPassed !== true
        || proof?.createdSuspended !== true
        || proof?.databaseHandleExclusive !== true
        || proof?.startupGateWindowsSecurityPassed !== true
        || proof?.startupGateId !== startupGatePlan?.gateId
        || proof?.startupGateInvocationId !== startupGatePlan?.invocationId
        || !samePath(proof?.startupGateHandoffReadyPath, startupGatePlan?.handoffReadyPath)
        || !samePath(proof?.startupGateHandoffReleasedPath, startupGatePlan?.handoffReleasedPath)
        || !samePath(proof?.startupGateAdmissionPath, startupGatePlan?.admissionPath)
        || !samePath(proof?.startupGateClosedPath, startupGatePlan?.closedPath)
        || !samePath(proof?.startupGateFinalizedPath, startupGatePlan?.finalizedPath)
        || !samePath(proof?.trustedShellPath, startupGatePlan?.activeDocument?.bindings?.shell?.realPath)
        || normalizeSha(proof?.trustedShellSha256, 'SPAWNED trusted shell SHA-256')
            !== startupGatePlan?.activeDocument?.bindings?.shell?.sha256
        || String(proof?.trustedShellDeviceId || '')
            !== startupGatePlan?.activeDocument?.bindings?.shell?.identity?.deviceId
        || String(proof?.trustedShellFileId || '')
            !== startupGatePlan?.activeDocument?.bindings?.shell?.identity?.fileId
        || Number(proof?.trustedShellHardLinkCount)
            !== startupGatePlan?.activeDocument?.bindings?.shell?.identity?.hardLinkCount) {
        fail('Exclusive-window helper did not create the approved package suspended under the DB lock.');
    }
    const activeGate = validateStartupGateProtocolArtifact(proof, 'startupGateActive', startupGatePlan.activePath, 'S7 ACTIVE startup gate', context);
    const boundGate = validateStartupGateProtocolArtifact(proof, 'startupGateBound', startupGatePlan.boundPath, 'S7 BOUND startup gate', context);
    let activeDocument;
    let boundDocument;
    try {
        activeDocument = JSON.parse(fs.readFileSync(activeGate.realPath, 'utf8'));
        boundDocument = JSON.parse(fs.readFileSync(boundGate.realPath, 'utf8'));
    }
    catch {
        fail('S7 startup gate documents were not valid JSON after suspended binding.');
    }
    if (stableJson(activeDocument) !== stableJson(startupGatePlan.activeDocument)
        || boundDocument?.kind !== STARTUP_GATE_BOUND_KIND
        || boundDocument?.schemaVersion !== STARTUP_GATE_BOUND_SCHEMA
        || boundDocument?.status !== 'BOUND_SUSPENDED'
        || boundDocument?.gateId !== startupGatePlan.gateId
        || boundDocument?.invocationId !== startupGatePlan.invocationId
        || Number(boundDocument?.pid) !== Number(proof.pid)
        || Number(boundDocument?.threadId) !== Number(proof.threadId)
        || stableJson(boundDocument?.activeGate) !== stableJson(startupGateArtifactBinding(activeGate, 'S7 ACTIVE startup gate'))
        || stableJson(boundDocument?.bindings) !== stableJson(startupGatePlan.activeDocument.bindings)) {
        fail('S7 startup gate ACTIVE/BOUND documents do not bind the suspended child.');
    }
    return {
        protocol: EXCLUSIVE_WINDOW_PROTOCOL,
        status: 'SPAWNED',
        helperPid: ready.helperPid,
        pid: Number(proof.pid),
        threadId: Number(proof.threadId),
        executablePath,
        queriedExecutablePath: executablePath,
        processImageQueryPassed: true,
        createdSuspended: true,
        databaseHandleExclusive: true,
        createdAt: createdAt.iso,
        startupGate: {
            gateId: startupGatePlan.gateId,
            invocationId: startupGatePlan.invocationId,
            active: activeGate,
            bound: boundGate,
            handoffReadyPath: startupGatePlan.handoffReadyPath,
            handoffReleasedPath: startupGatePlan.handoffReleasedPath,
            admissionPath: startupGatePlan.admissionPath,
            closedPath: startupGatePlan.closedPath,
            finalizedPath: startupGatePlan.finalizedPath,
            shell: startupGatePlan.activeDocument.bindings.shell,
            windowsSecurityPassed: true,
        },
    };
}

function validateLaunchExclusiveReleased(proof, ready, suspended, context) {
    const finalInventoryAt = validateProtocolTimestamp(proof?.finalSameNameInventoryAt, 'Exclusive-window final same-name inventory timestamp', context, Date.parse(suspended.createdAt));
    const resumedAt = validateProtocolTimestamp(proof?.resumedAt, 'Exclusive-window RESUMED timestamp', context, finalInventoryAt.milliseconds);
    const releasedAt = validateProtocolTimestamp(proof?.releasedAt, 'Exclusive-window DB release timestamp', context, resumedAt.milliseconds);
    if (proof?.protocol !== EXCLUSIVE_WINDOW_PROTOCOL
        || proof?.status !== 'RESUMED'
        || Number(proof?.helperPid) !== ready.helperPid
        || Number(proof?.pid) !== suspended.pid
        || proof?.databaseHandleExclusive !== false
        || proof?.finalSameNameInventoryPassed !== true
        || Number(proof?.finalSameNameProcessCount) !== 1
        || proof?.finalProcessImageQueryPassed !== true
        || !samePath(proof?.finalQueriedExecutablePath, suspended.executablePath)
        || !Number.isInteger(Number(proof?.resumeResult))
        || Number(proof.resumeResult) !== 1
        || proof?.startupGateId !== suspended.startupGate.gateId
        || proof?.startupGateInvocationId !== suspended.startupGate.invocationId
        || normalizeSha(proof?.startupGateActiveSha256, 'RESUMED ACTIVE gate SHA-256') !== suspended.startupGate.active.sha256
        || normalizeSha(proof?.startupGateBoundSha256, 'RESUMED BOUND gate SHA-256') !== suspended.startupGate.bound.sha256
        || normalizeSha(proof?.trustedShellSha256, 'RESUMED trusted shell SHA-256')
            !== suspended.startupGate.shell.sha256) {
        fail('Launch-exclusive helper did not prove resume-under-lock followed by DB handoff.');
    }
    const handoffReady = validateStartupGateProtocolArtifact(proof, 'startupGateHandoffReady', suspended.startupGate.handoffReadyPath, 'S7 HANDOFF_READY receipt', context);
    const handoffReleased = validateStartupGateProtocolArtifact(proof, 'startupGateHandoffReleased', suspended.startupGate.handoffReleasedPath, 'S7 HANDOFF_RELEASED receipt', context);
    return {
        protocol: EXCLUSIVE_WINDOW_PROTOCOL,
        status: 'RESUMED',
        helperPid: ready.helperPid,
        pid: suspended.pid,
        finalSameNameInventoryPassed: true,
        finalSameNameProcessCount: 1,
        finalSameNameInventoryAt: finalInventoryAt.iso,
        finalQueriedExecutablePath: suspended.executablePath,
        finalProcessImageQueryPassed: true,
        releasedAt: releasedAt.iso,
        resumedAt: resumedAt.iso,
        databaseHandleExclusive: false,
        resumeResult: Number(proof.resumeResult),
        startupGate: {
            ...suspended.startupGate,
            handoffReady,
            handoffReleased,
        },
    };
}

function validateControlledCloseProof(result, ready, suspended, resumed, context) {
    const closedAt = validateProtocolTimestamp(result?.proof?.closedAt, 'Exclusive-window CLOSED timestamp', context, Date.parse(resumed.resumedAt));
    if (result?.proof?.protocol !== EXCLUSIVE_WINDOW_PROTOCOL
        || result?.proof?.status !== 'CLOSED'
        || Number(result?.proof?.helperPid) !== ready.helperPid
        || Number(result?.proof?.pid) !== suspended.pid
        || result?.proof?.databaseHandleExclusive !== false
        || result?.proof?.startupGateAdmissionVerified !== true
        || result?.proof?.startupGateWindowsSecurityPassed !== true
        || result?.proof?.startupGateId !== suspended.startupGate.gateId
        || result?.proof?.startupGateInvocationId !== suspended.startupGate.invocationId) {
        fail('Controlled launch close proof was invalid after evidence collection.');
    }
    const activeGate = validateStartupGateProtocolArtifact(result.proof, 'startupGateActive', suspended.startupGate.active.realPath, 'CLOSED S7 ACTIVE startup gate', context);
    const boundGate = validateStartupGateProtocolArtifact(result.proof, 'startupGateBound', suspended.startupGate.bound.realPath, 'CLOSED S7 BOUND startup gate', context);
    const handoffReady = validateStartupGateProtocolArtifact(result.proof, 'startupGateHandoffReady', suspended.startupGate.handoffReadyPath, 'CLOSED S7 HANDOFF_READY receipt', context);
    const handoffReleased = validateStartupGateProtocolArtifact(result.proof, 'startupGateHandoffReleased', suspended.startupGate.handoffReleasedPath, 'CLOSED S7 HANDOFF_RELEASED receipt', context);
    const admission = validateStartupGateProtocolArtifact(result.proof, 'startupGateAdmission', suspended.startupGate.admissionPath, 'S7 Main admission receipt', context);
    const closed = validateStartupGateProtocolArtifact(result.proof, 'startupGateClosed', suspended.startupGate.closedPath, 'S7 helper CLOSED receipt', context);
    if (!sameArtifact(activeGate, suspended.startupGate.active)
        || !sameArtifact(boundGate, suspended.startupGate.bound)) {
        fail('S7 ACTIVE/BOUND startup gate drifted before CLOSED proof.');
    }
    let admissionDocument;
    let closedDocument;
    try {
        admissionDocument = JSON.parse(fs.readFileSync(admission.realPath, 'utf8'));
        closedDocument = JSON.parse(fs.readFileSync(closed.realPath, 'utf8'));
    }
    catch {
        fail('S7 admission/CLOSED receipt was not valid JSON.');
    }
    const expectedActiveBinding = startupGateArtifactBinding(activeGate, 'CLOSED ACTIVE gate');
    const expectedBoundBinding = startupGateArtifactBinding(boundGate, 'CLOSED BOUND gate');
    const expectedReadyBinding = startupGateArtifactBinding(handoffReady, 'CLOSED HANDOFF_READY');
    const expectedReleasedBinding = startupGateArtifactBinding(handoffReleased, 'CLOSED HANDOFF_RELEASED');
    const expectedAdmissionBinding = startupGateArtifactBinding(admission, 'CLOSED admission');
    const expectedDatabaseAfterClose = startupGateArtifactBinding(closedDocument?.databaseAfterClose, 'CLOSED database-after-close');
    const databaseAfterClose = startupGateFileArtifact(expectedDatabaseAfterClose.realPath, 'CLOSED database-after-close');
    const databaseAfterCloseSecurity = context.inspectWindowsPathSecurity(databaseAfterClose.realPath, {
        label: 'CLOSED database-after-close',
        type: 'file',
        requireProtected: true,
    });
    for (const [label, actual, expected] of [
        ['admission-active', admissionDocument?.activeGate, expectedActiveBinding],
        ['admission-bound', admissionDocument?.boundGate, expectedBoundBinding],
        ['admission-ready', admissionDocument?.handoffReady, expectedReadyBinding],
        ['admission-released', admissionDocument?.handoffReleased, expectedReleasedBinding],
        ['closed-active', closedDocument?.activeGate, expectedActiveBinding],
        ['closed-bound', closedDocument?.boundGate, expectedBoundBinding],
        ['closed-ready', closedDocument?.handoffReady, expectedReadyBinding],
        ['closed-released', closedDocument?.handoffReleased, expectedReleasedBinding],
        ['closed-admission', closedDocument?.admission, expectedAdmissionBinding],
    ]) {
        if (stableJson(actual) !== stableJson(expected)) {
            fail(`S7 CLOSED chain ${label} binding differs.`);
        }
    }
    if (admissionDocument?.kind !== STARTUP_GATE_ADMISSION_KIND
        || admissionDocument?.schemaVersion !== STARTUP_GATE_ADMISSION_SCHEMA
        || admissionDocument?.status !== 'ADMITTED_UNDER_EXCLUSIVE_SQLITE_LOCK'
        || Number(admissionDocument?.pid) !== suspended.pid
        || admissionDocument?.gateId !== suspended.startupGate.gateId
        || admissionDocument?.invocationId !== suspended.startupGate.invocationId
        || admissionDocument?.singleInstanceLockAcquired !== true
        || admissionDocument?.sqliteTakeover?.fileMustExist !== true
        || admissionDocument?.sqliteTakeover?.lockingMode !== 'exclusive'
        || admissionDocument?.sqliteTakeover?.beginMode !== 'exclusive'
        || admissionDocument?.sqliteTakeover?.transactionActive !== true
        || admissionDocument?.sqliteTakeover?.sameConnectionRequiredForMigration !== true
        || !SUPPORTED_SOURCE_VERSIONS.includes(Number(admissionDocument?.sqliteTakeover?.schemaVersionBefore))
        || closedDocument?.kind !== STARTUP_GATE_CLOSED_KIND
        || closedDocument?.schemaVersion !== STARTUP_GATE_CLOSED_SCHEMA
        || closedDocument?.status !== 'CLOSED_AFTER_GUARDED_MIGRATION'
        || closedDocument?.gateId !== suspended.startupGate.gateId
        || closedDocument?.invocationId !== suspended.startupGate.invocationId
        || Number(closedDocument?.helperPid) !== ready.helperPid
        || Number(closedDocument?.pid) !== suspended.pid
        || Number(closedDocument?.exitCode) !== 0
        || stableJson(startupGateArtifactBinding(databaseAfterClose, 'Measured CLOSED database-after-close')) !== stableJson(expectedDatabaseAfterClose)
        || databaseAfterCloseSecurity?.passed !== true
        || normalizeSha(result?.proof?.databaseAfterCloseSha256, 'CLOSED database-after-close proof') !== databaseAfterClose.sha256
        || normalizeSha(result?.proof?.trustedShellSha256, 'CLOSED trusted shell proof')
            !== suspended.startupGate.shell.sha256) {
        fail('S7 helper CLOSED receipt did not bind exact ACTIVE/BOUND/ADMISSION identities.');
    }
    return {
        closedAt: closedAt.iso,
        startupGate: {
            ...suspended.startupGate,
            active: activeGate,
            bound: boundGate,
            handoffReady,
            handoffReleased,
            admission,
            closed,
            databaseAfterClose: {
                ...databaseAfterClose,
                windowsSecurity: databaseAfterCloseSecurity,
            },
            admissionVerified: true,
            windowsSecurityPassed: true,
        },
    };
}

module.exports = { validateProtocolTimestamp, validateLaunchExclusiveReady, validateStartupGateProtocolArtifact, validateSuspendedPackageProof, validateLaunchExclusiveReleased, validateControlledCloseProof };
