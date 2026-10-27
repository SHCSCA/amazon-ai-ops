// 按职责复用原有严格校验，公共入口继续保持兼容。

const { resolveCanonicalPaths } = require('./s7-launch-operator-authority.js');
const { startupGateArtifactBinding } = require('./s7-launch-operator-bindings.js');
const { STARTUP_GATE_FINALIZED_KIND, STARTUP_GATE_FINALIZED_SCHEMA, exists, fail, nowIso, sameArtifact, sha256, stableJson } = require('./s7-launch-operator-contracts.js');
const { isolatedRecoveryOutput, readJsonStable, writeProtectedAtomicJson } = require('./s7-launch-operator-filesystem.js');
const { collectFinalizationEvidence, createFinalizationPacket, validateFinalizationPacket } = require('./s7-launch-operator-packet.js');

function prepareFinalization(values, context) {
    const canonical = resolveCanonicalPaths(context);
    const packageIdentity = context.packageIdentity();
    const boundary = isolatedRecoveryOutput(values.out, values['recovery-root'], canonical, packageIdentity, [
        values['approval-packet'],
        values['launch-receipt'],
        values['acceptance-receipt'],
        ...(values['recovery-snapshot'] ? [values['recovery-snapshot']] : []),
    ], context.inspectWindowsPathSecurity);
    const packet = createFinalizationPacket({
        approvalPacket: values['approval-packet'],
        launchReceipt: values['launch-receipt'],
        acceptanceReceipt: values['acceptance-receipt'],
        recoverySnapshot: values['recovery-snapshot'],
    }, context);
    const written = writeProtectedAtomicJson(boundary.output, packet, context, 'S7 finalization packet');
    return {
        exitCode: 0,
        outputPath: written.path,
        receipt: packet,
    };
}

function finalizeApproved(values, context) {
    const packetRead = readJsonStable(values['finalization-packet'], 'S7 finalization packet');
    const packetSecurity = context.inspectWindowsPathSecurity(packetRead.artifact.realPath, {
        label: 'S7 finalization packet',
        type: 'file',
        requireProtected: true,
    });
    if (packetSecurity?.passed !== true) {
        fail('S7 finalization packet protected Windows ACL proof failed.');
    }
    validateFinalizationPacket(packetRead.value, values['confirm-finalization']);
    const generatedAt = Date.parse(packetRead.value.generatedAt || '');
    if (!Number.isFinite(generatedAt) || generatedAt > context.now().valueOf() + 60000) {
        fail('S7 finalization packet timestamp is invalid or future-dated.');
    }
    const saved = packetRead.value.bindings;
    const current = collectFinalizationEvidence({
        approvalPacket: saved?.approvalPacket?.realPath,
        launchReceipt: saved?.launchReceipt?.realPath,
        acceptanceReceipt: saved?.acceptanceReceipt?.realPath,
        recoverySnapshot: saved?.recovery?.backup?.realPath,
    }, context);
    if (stableJson(current) !== stableJson(saved)) {
        fail('S7 finalization bindings drifted after explicit packet creation.');
    }
    const finalizationPacket = startupGateArtifactBinding(packetRead.artifact, 'S7 finalization packet');
    const finalizedBase = {
        kind: STARTUP_GATE_FINALIZED_KIND,
        schemaVersion: current.recovery ? 's7-main-startup-gate-finalized/v2' : STARTUP_GATE_FINALIZED_SCHEMA,
        status: current.recovery ? 'RECOVERED_AFTER_FAILED_MIGRATION_PROCESS' : 'FINALIZED_FOR_POST_MIGRATION_STARTUP',
        finalizedAt: nowIso(context.now),
        gateId: current.gate.gateId,
        invocationId: current.gate.invocationId,
        canonicalUserDataDir: current.canonical.userDataDir,
        approvalPayloadSha256: current.approvalPayloadSha256,
        approvalPacket: current.approvalPacket,
        launchReceipt: current.launchReceipt,
        acceptanceReceipt: current.acceptanceReceipt,
        finalizationPacket,
        activeGate: current.gate.active,
        boundGate: current.gate.bound,
        handoffReady: current.gate.handoffReady,
        handoffReleased: current.gate.handoffReleased,
        admission: current.gate.admission,
        closed: current.gate.closed,
        databaseAfterMigration: current.databaseAfterMigration,
        packageAtMigration: current.packageAtMigration,
        shellAtMigration: current.shellAtMigration,
        machine: current.machine,
        authority: current.authority,
        formalAppReadiness: false,
        adsExecutionAuthorized: false,
        ...(current.recovery ? { recovery: current.recovery } : {}),
    };
    const finalized = {
        ...finalizedBase,
        finalizationPayloadSha256: sha256(stableJson(finalizedBase)),
    };
    if (exists(current.canonical.finalizedPath)
        || exists(current.canonical.completionPath)) {
        fail('FINALIZED or POST_MIGRATION_ADMITTED already exists; replay is blocked.');
    }
    const written = writeProtectedAtomicJson(current.canonical.finalizedPath, finalized, context, 'S7 FINALIZED receipt');
    const persisted = readJsonStable(written.path, 'Persisted S7 FINALIZED receipt');
    if (stableJson(persisted.value) !== stableJson(finalized)
        || !sameArtifact(persisted.artifact, written.artifact)) {
        fail('Persisted S7 FINALIZED receipt differs after atomic publication.');
    }
    return {
        exitCode: 0,
        outputPath: written.path,
        receipt: finalized,
    };
}

module.exports = { prepareFinalization, finalizeApproved };
