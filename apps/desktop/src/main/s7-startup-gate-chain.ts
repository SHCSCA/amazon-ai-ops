// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import * as path from 'path';
import { type S7StartupGateIo, type GateTrustedShellBinding, type S7StableFileArtifact, MAX_GATE_FILE_BYTES, fail, publicArtifact, type ActiveGateDocument, S7_STARTUP_GATE_HANDOFF_READY_KIND, S7_STARTUP_GATE_HANDOFF_READY_SCHEMA, samePath, sameArtifact, stableJson, requireFiniteTimestamp, S7_STARTUP_GATE_ADMISSION_KIND, S7_STARTUP_GATE_ADMISSION_SCHEMA, SUPPORTED_MIGRATION_SOURCE_VERSIONS, type GateArtifactBinding, S7_STARTUP_GATE_CLOSED_KIND, S7_STARTUP_GATE_CLOSED_SCHEMA, requireSafeIdentifier, S7_STARTUP_GATE_DIRECTORY, S7_STARTUP_GATE_ACTIVE_FILE, type CompletedS7Chain, sha256, type PostMigrationAdmissionDocument, exactKeys, S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_KIND, S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_SCHEMA, normalizeSha, type GatePackageBinding } from './s7-startup-gate-contracts';
import { requireSecurePath, parseJsonFile, requireArtifactBinding, requirePackageBinding, requireTrustedShellBinding, requireActiveGate, requireBoundGate, requireHandoffReleased, requireStrictTrustedShellBinding, requireFinalizedGate, requireStrictArtifactBinding, requireFinalizedMachine, requireStrictPackageBinding } from './s7-startup-gate-bindings';
import { DEFAULT_IO } from './s7-startup-gate-runtime';

export function readSecureGateJson(io: S7StartupGateIo, filePath: string, label: string, trustedShell?: GateTrustedShellBinding): {
    artifact: S7StableFileArtifact;
    value: Record<string, unknown>;
} {
    const artifact = io.readStableFile(filePath, label, { captureContents: true, maxBytes: MAX_GATE_FILE_BYTES });
    requireSecurePath(io, artifact.realPath, 'file', label, trustedShell);
    if (artifact.identity.hardLinkCount !== 1) {
        fail('S7_STARTUP_GATE_PATH_UNSAFE', `${label} must have exactly one filesystem link.`);
    }
    return {
        artifact: publicArtifact(artifact),
        value: parseJsonFile<Record<string, unknown>>(artifact, label),
    };
}

export function requireHandoffReadyDocument(record: Record<string, unknown>, active: ActiveGateDocument, activeArtifact: S7StableFileArtifact, boundArtifact: S7StableFileArtifact, pid: number): void {
    if (record.kind !== S7_STARTUP_GATE_HANDOFF_READY_KIND
        || record.schemaVersion !== S7_STARTUP_GATE_HANDOFF_READY_SCHEMA
        || record.status !== 'READY_FOR_DB_HANDOFF'
        || Number(record.pid) !== pid
        || record.gateId !== active.gateId
        || record.invocationId !== active.invocationId
        || record.singleInstanceLockAcquired !== true
        || !samePath(record.canonicalUserDataDir, active.canonicalUserDataDir)
        || !sameArtifact(requireArtifactBinding(record.activeGate, 'READY ACTIVE'), activeArtifact)
        || !sameArtifact(requireArtifactBinding(record.boundGate, 'READY BOUND'), boundArtifact)
        || stableJson(requireArtifactBinding(record.executable, 'READY executable'))
            !== stableJson(active.bindings.executable)
        || stableJson(requireArtifactBinding(record.main, 'READY Main'))
            !== stableJson(active.bindings.package.main)
        || stableJson(requireArtifactBinding(record.intent, 'READY intent'))
            !== stableJson(active.bindings.intent)
        || stableJson(requirePackageBinding(record.package)) !== stableJson(active.bindings.package)
        || stableJson(requireTrustedShellBinding(record.shell)) !== stableJson(active.bindings.shell)) {
        fail('S7_STARTUP_GATE_HANDOFF_UNTRUSTED', 'HANDOFF_READY binding is invalid.');
    }
    requireFiniteTimestamp(record.readyAt, 'HANDOFF_READY');
}

export function requireAdmissionDocument(record: Record<string, unknown>, active: ActiveGateDocument, artifacts: {
    active: S7StableFileArtifact;
    bound: S7StableFileArtifact;
    ready: S7StableFileArtifact;
    released: S7StableFileArtifact;
}, pid: number): void {
    const sqlite = record.sqliteTakeover as Record<string, unknown> | undefined;
    if (record.kind !== S7_STARTUP_GATE_ADMISSION_KIND
        || record.schemaVersion !== S7_STARTUP_GATE_ADMISSION_SCHEMA
        || record.status !== 'ADMITTED_UNDER_EXCLUSIVE_SQLITE_LOCK'
        || Number(record.pid) !== pid
        || record.gateId !== active.gateId
        || record.invocationId !== active.invocationId
        || record.singleInstanceLockAcquired !== true
        || !samePath(record.canonicalUserDataDir, active.canonicalUserDataDir)
        || !sameArtifact(requireArtifactBinding(record.activeGate, 'ADMISSION ACTIVE'), artifacts.active)
        || !sameArtifact(requireArtifactBinding(record.boundGate, 'ADMISSION BOUND'), artifacts.bound)
        || !sameArtifact(requireArtifactBinding(record.handoffReady, 'ADMISSION READY'), artifacts.ready)
        || !sameArtifact(requireArtifactBinding(record.handoffReleased, 'ADMISSION RELEASED'), artifacts.released)
        || stableJson(requireArtifactBinding(record.executable, 'ADMISSION executable'))
            !== stableJson(active.bindings.executable)
        || stableJson(requireArtifactBinding(record.main, 'ADMISSION Main'))
            !== stableJson(active.bindings.package.main)
        || stableJson(requireArtifactBinding(record.database, 'ADMISSION database'))
            !== stableJson(active.bindings.database)
        || stableJson(requireArtifactBinding(record.intent, 'ADMISSION intent'))
            !== stableJson(active.bindings.intent)
        || stableJson(requirePackageBinding(record.package)) !== stableJson(active.bindings.package)
        || stableJson(requireTrustedShellBinding(record.shell)) !== stableJson(active.bindings.shell)
        || !sqlite
        || !samePath(sqlite.connectionPath, active.bindings.database.realPath)
        || sqlite.fileMustExist !== true
        || Number(sqlite.busyTimeoutMs) !== 0
        || sqlite.lockingMode !== 'exclusive'
        || sqlite.beginMode !== 'exclusive'
        || sqlite.transactionActive !== true
        || sqlite.sameConnectionRequiredForMigration !== true
        || !SUPPORTED_MIGRATION_SOURCE_VERSIONS.includes(Number(sqlite.schemaVersionBefore))) {
        fail('S7_STARTUP_GATE_ADMISSION_UNTRUSTED', 'ADMISSION binding is invalid.');
    }
    requireFiniteTimestamp(record.admittedAt, 'ADMISSION');
}

export function requireClosedDocument(record: Record<string, unknown>, active: ActiveGateDocument, artifacts: {
    active: S7StableFileArtifact;
    bound: S7StableFileArtifact;
    ready: S7StableFileArtifact;
    released: S7StableFileArtifact;
    admission: S7StableFileArtifact;
}, pid: number, helperPid: number): GateArtifactBinding {
    if (record.kind !== S7_STARTUP_GATE_CLOSED_KIND
        || record.schemaVersion !== S7_STARTUP_GATE_CLOSED_SCHEMA
        || record.status !== 'CLOSED_AFTER_GUARDED_MIGRATION'
        || Number(record.pid) !== pid
        || Number(record.helperPid) !== helperPid
        || Number(record.exitCode) !== 0
        || record.gateId !== active.gateId
        || record.invocationId !== active.invocationId
        || !sameArtifact(requireArtifactBinding(record.activeGate, 'CLOSED ACTIVE'), artifacts.active)
        || !sameArtifact(requireArtifactBinding(record.boundGate, 'CLOSED BOUND'), artifacts.bound)
        || !sameArtifact(requireArtifactBinding(record.handoffReady, 'CLOSED READY'), artifacts.ready)
        || !sameArtifact(requireArtifactBinding(record.handoffReleased, 'CLOSED RELEASED'), artifacts.released)
        || !sameArtifact(requireArtifactBinding(record.admission, 'CLOSED ADMISSION'), artifacts.admission)
        || stableJson(requireTrustedShellBinding(record.shell)) !== stableJson(active.bindings.shell)) {
        fail('S7_STARTUP_GATE_CLOSED_UNTRUSTED', 'CLOSED binding is invalid.');
    }
    requireFiniteTimestamp(record.closedAt, 'CLOSED');
    return requireArtifactBinding(record.databaseAfterClose, 'CLOSED database after migration');
}

export function assertExternalArtifactBinding(io: S7StartupGateIo, binding: GateArtifactBinding, label: string): void {
    const artifact = io.readStableFile(binding.realPath, label);
    if (!sameArtifact(artifact, binding)) {
        fail('S7_STARTUP_GATE_BINDING_MISMATCH', `${label} drifted after finalization.`);
    }
}

export function inspectAdmittedS7Chain(io: S7StartupGateIo, canonicalUserDataDir: string, activePath: string, trustedShell: GateTrustedShellBinding) {
    const activeRead = readSecureGateJson(io, activePath, 'Post-migration ACTIVE gate', trustedShell);
    const activeRecord = activeRead.value;
    const gateId = requireSafeIdentifier(activeRecord.gateId, 'Post-migration gate ID');
    const invocationId = requireSafeIdentifier(activeRecord.invocationId, 'Post-migration invocation ID');
    const active = requireActiveGate(activeRecord, {
        canonicalUserDataDir,
        activePath,
        gateId,
        invocationId,
    });
    const boundRead = readSecureGateJson(io, active.paths.bound, 'Post-migration BOUND gate', trustedShell);
    const pid = Number(boundRead.value.pid);
    if (!Number.isInteger(pid) || pid < 1) {
        fail('S7_STARTUP_GATE_INVALID', 'Post-migration BOUND PID is invalid.');
    }
    requireBoundGate(boundRead.value, active, activeRead.artifact, pid);
    const readyRead = readSecureGateJson(io, active.paths.handoffReady, 'Post-migration HANDOFF_READY', trustedShell);
    requireHandoffReadyDocument(readyRead.value, active, activeRead.artifact, boundRead.artifact, pid);
    const releasedRead = readSecureGateJson(io, active.paths.handoffReleased, 'Post-migration HANDOFF_RELEASED', trustedShell);
    const released = requireHandoffReleased(releasedRead.value, active, activeRead.artifact, boundRead.artifact, readyRead.artifact, pid);
    const admissionRead = readSecureGateJson(io, active.paths.admission, 'Post-migration ADMISSION', trustedShell);
    requireAdmissionDocument(admissionRead.value, active, {
        active: activeRead.artifact,
        bound: boundRead.artifact,
        ready: readyRead.artifact,
        released: releasedRead.artifact,
    }, pid);
    return { active, activeRead, boundRead, readyRead, releasedRead, admissionRead,
        pid, helperPid: released.helperPid };
}

export function inspectS7AdmittedRecoveryChain(options: {
    canonicalUserDataDir: string;
    io?: Partial<S7StartupGateIo>;
}) {
    const io = { ...DEFAULT_IO, ...options.io };
    const trustedShell = requireStrictTrustedShellBinding(io.inspectTrustedPowerShell());
    return inspectAdmittedS7Chain(io, options.canonicalUserDataDir, path.join(options.canonicalUserDataDir, S7_STARTUP_GATE_DIRECTORY, S7_STARTUP_GATE_ACTIVE_FILE), trustedShell);
}

export function requireS7PostWriteHold(value: unknown, chain: ReturnType<typeof inspectAdmittedS7Chain>, approvalPayloadSha256: string): number | null {
    const hold = value as Record<string, any> | null;
    const proof = hold?.launch?.result?.errorProof;
    if (hold?.kind !== 's7-live-migration-launch-operator'
        || hold?.schemaVersion !== 's7-live-migration-launch-operator/v2'
        || hold?.status !== 'HOLD' || hold?.passed !== false || hold?.formalAcceptance !== false
        || hold?.packageLaunched !== 'CONFIRMED_LAUNCHED'
        || hold?.approvalPayloadSha256 !== approvalPayloadSha256
        || hold?.startupGate?.gateId !== chain.active.gateId
        || hold?.startupGate?.invocationId !== chain.active.invocationId
        || stableJson(hold?.startupGate?.activeDocument) !== stableJson(chain.activeRead.value)
        || proof?.status !== 'ERROR' || proof?.protocol !== 's7-live-migration-exclusive-window/v1'
        || proof?.phase !== 'child-exit-failed-before-closed-receipt'
        || proof?.pid !== chain.pid || proof?.helperPid !== chain.helperPid
        || proof?.processCreated !== true || proof?.processResumed !== true
        || proof?.databaseHandleAcquired !== true || proof?.databaseHandleReleased !== true
        || proof?.databaseHandleExclusive !== false || proof?.releaseState !== 'RELEASED'
        || (proof.exitCode != null && (!Number.isInteger(proof.exitCode)
            || proof.exitCode < 1 || proof.exitCode > 0xffffffff))) {
        fail('S7_STARTUP_GATE_RECOVERY_UNTRUSTED', 'Recovery requires the exact post-write nonzero-exit HOLD.');
    }
    return proof.exitCode ?? null;
}

export function inspectCompletedS7Chain(io: S7StartupGateIo, canonicalUserDataDir: string, activePath: string, trustedShell: GateTrustedShellBinding): CompletedS7Chain {
    const admitted = inspectAdmittedS7Chain(io, canonicalUserDataDir, activePath, trustedShell);
    const { active, activeRead, boundRead, readyRead, releasedRead, admissionRead, pid, helperPid } = admitted;
    const finalizedRead = readSecureGateJson(io, active.paths.finalized, 'Post-migration FINALIZED', trustedShell);
    const recovering = finalizedRead.value.schemaVersion === 's7-main-startup-gate-finalized/v2';
    if (recovering && io.existsSync(active.paths.closed)) {
        fail('S7_STARTUP_GATE_RECOVERY_UNTRUSTED', 'Recovery cannot replace an existing CLOSED receipt.');
    }
    const closedRead = recovering ? null : readSecureGateJson(io, active.paths.closed, 'Post-migration CLOSED', trustedShell);
    const databaseAfterClose = closedRead ? requireClosedDocument(closedRead.value, active, {
        active: activeRead.artifact, bound: boundRead.artifact, ready: readyRead.artifact,
        released: releasedRead.artifact, admission: admissionRead.artifact,
    }, pid, helperPid) : null;
    const finalized = requireFinalizedGate(finalizedRead.value, active, {
        active: activeRead.artifact,
        bound: boundRead.artifact,
        handoffReady: readyRead.artifact,
        handoffReleased: releasedRead.artifact,
        admission: admissionRead.artifact,
        closed: closedRead?.artifact ?? null,
    });
    if ((!recovering && stableJson(databaseAfterClose) !== stableJson(finalized.databaseAfterMigration))
        || !samePath(finalized.databaseAfterMigration.realPath, active.bindings.database.realPath)) {
        fail('S7_STARTUP_GATE_BINDING_MISMATCH', 'FINALIZED database does not match the helper CLOSED receipt.');
    }
    if (finalized.recovery) {
        const hold = readSecureGateJson(io, finalized.launchReceipt.realPath, 'Recovery original HOLD', trustedShell);
        const exitCode = requireS7PostWriteHold(hold.value, admitted, finalized.approvalPayloadSha256);
        if (!sameArtifact(hold.artifact, finalized.launchReceipt) || exitCode !== finalized.recovery.exitCode) {
            fail('S7_STARTUP_GATE_RECOVERY_UNTRUSTED', 'Recovery HOLD or observed exit code drifted.');
        }
        assertExternalArtifactBinding(io, finalized.recovery.backup, 'Recovery WAL-safe backup');
        assertExternalArtifactBinding(io, finalized.recovery.intent, 'Recovery consumed intent');
    }
    for (const [label, binding] of [
        ['S7 approval packet', finalized.approvalPacket],
        ['S7 launch receipt', finalized.launchReceipt],
        ['S7 readonly acceptance receipt', finalized.acceptanceReceipt],
        ['S7 finalization packet', finalized.finalizationPacket],
    ] as const) {
        assertExternalArtifactBinding(io, binding, label);
    }
    return {
        active,
        activeArtifact: activeRead.artifact,
        boundArtifact: boundRead.artifact,
        handoffReadyArtifact: readyRead.artifact,
        handoffReleasedArtifact: releasedRead.artifact,
        admissionArtifact: admissionRead.artifact,
        closedArtifact: closedRead?.artifact ?? null,
        finalized,
        finalizedArtifact: finalizedRead.artifact,
    };
}

export function completionPayloadHash(record: Record<string, unknown>): string {
    const payload = { ...record };
    delete payload.completionPayloadSha256;
    return sha256(stableJson(payload));
}

export function requirePostMigrationAdmission(value: unknown, chain: CompletedS7Chain): PostMigrationAdmissionDocument {
    const record = value as Record<string, unknown> | null;
    if (!exactKeys(record, [
        'kind',
        'schemaVersion',
        'status',
        'admittedAt',
        'gateId',
        'invocationId',
        'canonicalUserDataDir',
        'finalized',
        'activeGate',
        'closed',
        'acceptanceReceipt',
        'databaseAtFirstAdmission',
        'databaseIdentity',
        'machine',
        'authorityContractSha256',
        'migrationPackage',
        'migrationShell',
        'completionPayloadSha256',
    ])
        || record?.kind !== S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_KIND
        || record?.schemaVersion !== S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_SCHEMA
        || record?.status !== 'POST_MIGRATION_ADMITTED'
        || record?.gateId !== chain.active.gateId
        || record?.invocationId !== chain.active.invocationId
        || !samePath(record?.canonicalUserDataDir, chain.active.canonicalUserDataDir)) {
        fail('S7_STARTUP_GATE_COMPLETION_UNTRUSTED', 'Completion marker shape is invalid.');
    }
    requireFiniteTimestamp(record.admittedAt, 'Post-migration admission');
    const finalized = requireStrictArtifactBinding(record.finalized, 'Completion FINALIZED');
    const activeGate = requireStrictArtifactBinding(record.activeGate, 'Completion ACTIVE');
    const closed = chain.finalized.recovery ? null : requireStrictArtifactBinding(record.closed, 'Completion CLOSED');
    const acceptanceReceipt = requireStrictArtifactBinding(record.acceptanceReceipt, 'Completion acceptance receipt');
    const databaseAtFirstAdmission = requireStrictArtifactBinding(record.databaseAtFirstAdmission, 'Completion initial database');
    if (!sameArtifact(finalized, chain.finalizedArtifact)
        || !sameArtifact(activeGate, chain.activeArtifact)
        || (closed === null ? record.closed !== null || chain.closedArtifact !== null
            : !chain.closedArtifact || !sameArtifact(closed, chain.closedArtifact))
        || stableJson(acceptanceReceipt) !== stableJson(chain.finalized.acceptanceReceipt)
        || stableJson(databaseAtFirstAdmission) !== stableJson(chain.finalized.databaseAfterMigration)) {
        fail('S7_STARTUP_GATE_COMPLETION_UNTRUSTED', 'Completion receipt-chain binding drifted.');
    }
    const identity = record.databaseIdentity as Record<string, unknown> | null;
    if (!exactKeys(identity, ['realPath', 'deviceId', 'fileId', 'hardLinkCount'])
        || !samePath(identity?.realPath, chain.finalized.databaseAfterMigration.realPath)
        || String(identity?.deviceId || '') !== chain.finalized.databaseAfterMigration.identity.deviceId
        || String(identity?.fileId || '') !== chain.finalized.databaseAfterMigration.identity.fileId
        || Number(identity?.hardLinkCount) !== 1) {
        fail('S7_STARTUP_GATE_COMPLETION_UNTRUSTED', 'Completion database identity is invalid.');
    }
    const machine = requireFinalizedMachine(record.machine, chain.finalized.databaseAfterMigration);
    const migrationPackage = requireStrictPackageBinding(record.migrationPackage);
    const migrationShell = requireStrictTrustedShellBinding(record.migrationShell);
    const authorityContractSha256 = normalizeSha(record.authorityContractSha256, 'Completion authority contract');
    const completionPayloadSha256 = normalizeSha(record.completionPayloadSha256, 'Completion payload');
    if (stableJson(machine) !== stableJson(chain.finalized.machine)
        || stableJson(migrationPackage) !== stableJson(chain.finalized.packageAtMigration)
        || stableJson(migrationShell) !== stableJson(chain.finalized.shellAtMigration)
        || authorityContractSha256 !== chain.finalized.authority.contractSha256
        || completionPayloadSha256 !== completionPayloadHash(record)) {
        fail('S7_STARTUP_GATE_COMPLETION_UNTRUSTED', 'Completion payload integrity is invalid.');
    }
    return {
        kind: S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_KIND,
        schemaVersion: S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_SCHEMA,
        status: 'POST_MIGRATION_ADMITTED',
        admittedAt: String(record.admittedAt),
        gateId: chain.active.gateId,
        invocationId: chain.active.invocationId,
        canonicalUserDataDir: chain.active.canonicalUserDataDir,
        finalized,
        activeGate,
        closed,
        acceptanceReceipt,
        databaseAtFirstAdmission,
        databaseIdentity: {
            realPath: String(identity?.realPath),
            deviceId: String(identity?.deviceId),
            fileId: String(identity?.fileId),
            hardLinkCount: 1,
        },
        machine,
        authorityContractSha256,
        migrationPackage,
        migrationShell,
        completionPayloadSha256,
    };
}

export function assertPackageBinding(actual: GatePackageBinding, expected: GatePackageBinding, label: string): void {
    if (stableJson(actual) !== stableJson(expected)) {
        fail('S7_STARTUP_GATE_BINDING_MISMATCH', `${label} no longer matches the approved identity.`);
    }
}

export function assertArtifactBound(actual: S7StableFileArtifact, binding: GateArtifactBinding, label: string): void {
    if (!sameArtifact(actual, binding)) {
        fail('S7_STARTUP_GATE_BINDING_MISMATCH', `${label} no longer matches the approved identity.`);
    }
}
