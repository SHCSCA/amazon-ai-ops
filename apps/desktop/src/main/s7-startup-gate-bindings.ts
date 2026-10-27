// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import * as path from 'path';
import { type S7StartupGateIo, type GateTrustedShellBinding, fail, type S7StableFileArtifact, type GateArtifactBinding, normalizeSha, type GatePackageBinding, type ActiveGateDocument, S7_STARTUP_GATE_DIRECTORY, S7_STARTUP_GATE_BOUND_FILE, S7_STARTUP_GATE_HANDOFF_READY_FILE, S7_STARTUP_GATE_HANDOFF_RELEASED_FILE, S7_STARTUP_GATE_ADMISSION_FILE, S7_STARTUP_GATE_CLOSED_FILE, S7_STARTUP_GATE_FINALIZED_FILE, S7_STARTUP_GATE_ACTIVE_KIND, S7_STARTUP_GATE_ACTIVE_SCHEMA, requireSafeIdentifier, samePath, requireFiniteTimestamp, type BoundGateDocument, S7_STARTUP_GATE_BOUND_KIND, S7_STARTUP_GATE_BOUND_SCHEMA, sameArtifact, stableJson, S7_STARTUP_GATE_HANDOFF_RELEASED_KIND, S7_STARTUP_GATE_HANDOFF_RELEASED_SCHEMA, exactKeys, type S7PostMigrationAuthorityState, POST_MIGRATION_CONTRACT, POST_MIGRATION_TARGET_VERSION, POST_MIGRATION_REQUIRED_TABLES, type FinalizedGateDocument, sha256, S7_STARTUP_GATE_FINALIZED_KIND, S7_STARTUP_GATE_FINALIZED_SCHEMA, type S7PostWriteRecovery } from './s7-startup-gate-contracts';
import { postMigrationContractSha256 } from './s7-startup-gate-authority';

export function requireSecurePath(io: S7StartupGateIo, filePath: string, type: 'file' | 'directory', label: string, trustedShell?: GateTrustedShellBinding): void {
    const security = io.inspectWindowsPathSecurity(filePath, type, label, trustedShell);
    if (security.passed !== true
        || security.ownerSid !== security.currentUserSid
        || security.inheritanceProtected !== true
        || security.unauthorizedRules.length !== 0) {
        fail('S7_STARTUP_GATE_ACL_UNTRUSTED', `${label} ACL/owner proof failed.`);
    }
}

export function parseJsonFile<T>(artifact: S7StableFileArtifact & {
    contents?: Buffer;
}, label: string): T {
    if (!Buffer.isBuffer(artifact.contents)) {
        fail('S7_STARTUP_GATE_INVALID', `${label} contents were not captured.`);
    }
    try {
        return JSON.parse(artifact.contents.toString('utf8').replace(/^\uFEFF/, '')) as T;
    }
    catch {
        fail('S7_STARTUP_GATE_INVALID', `${label} is not valid JSON.`);
    }
}

export function requireArtifactBinding(value: unknown, label: string): GateArtifactBinding {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('S7_STARTUP_GATE_INVALID', `${label} binding is missing.`);
    }
    const record = value as Record<string, unknown>;
    const identity = record.identity as Record<string, unknown> | undefined;
    const realPath = String(record.realPath || '');
    const sizeBytes = Number(record.sizeBytes);
    const hardLinkCount = Number(identity?.hardLinkCount);
    if (!path.isAbsolute(realPath)
        || !Number.isInteger(sizeBytes)
        || sizeBytes < 1
        || !identity
        || !String(identity.deviceId || '')
        || !String(identity.fileId || '')
        || hardLinkCount !== 1) {
        fail('S7_STARTUP_GATE_INVALID', `${label} binding shape is invalid.`);
    }
    return {
        realPath,
        sha256: normalizeSha(record.sha256, label),
        sizeBytes,
        identity: {
            deviceId: String(identity.deviceId),
            fileId: String(identity.fileId),
            hardLinkCount,
        },
    };
}

export function requireTrustedShellBinding(value: unknown): GateTrustedShellBinding {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('S7_STARTUP_GATE_INVALID', 'Trusted PowerShell binding is missing.');
    }
    const record = value as Record<string, unknown>;
    const identity = record.identity as Record<string, unknown> | undefined;
    const hardlinkPaths = Array.isArray(record.hardlinkPaths)
        ? record.hardlinkPaths.map((item) => String(item))
        : [];
    const signature = record.signature as Record<string, unknown> | undefined;
    const version = record.version as Record<string, unknown> | undefined;
    const result: GateTrustedShellBinding = {
        realPath: String(record.realPath || ''),
        sha256: normalizeSha(record.sha256, 'Trusted PowerShell'),
        sizeBytes: Number(record.sizeBytes),
        identity: {
            deviceId: String(identity?.deviceId || ''),
            fileId: String(identity?.fileId || ''),
            hardLinkCount: Number(identity?.hardLinkCount),
        },
        hardlinkPaths,
        signature: {
            status: String(signature?.status || '') as 'Valid',
            subject: String(signature?.subject || ''),
            thumbprint: String(signature?.thumbprint || '').toUpperCase(),
        },
        version: {
            companyName: String(version?.companyName || ''),
            fileVersion: String(version?.fileVersion || ''),
            originalFilename: String(version?.originalFilename || ''),
            productName: String(version?.productName || ''),
        },
    };
    if (!path.isAbsolute(result.realPath)
        || !Number.isInteger(result.sizeBytes)
        || result.sizeBytes < 1
        || !result.identity.deviceId
        || !result.identity.fileId
        || !Number.isInteger(result.identity.hardLinkCount)
        || result.identity.hardLinkCount < 1
        || result.identity.hardLinkCount > 8
        || result.hardlinkPaths.length !== result.identity.hardLinkCount
        || result.hardlinkPaths.some((item) => !path.isAbsolute(item))
        || result.hardlinkPaths.reduce((total, item) => total + item.length, 0) > 8192
        || result.signature.status !== 'Valid'
        || !/Microsoft/i.test(result.signature.subject)
        || !result.signature.thumbprint
        || !/^Microsoft/i.test(result.version.companyName)
        || !result.version.fileVersion
        || !result.version.originalFilename.toLowerCase().includes('powershell')) {
        fail('S7_STARTUP_GATE_INVALID', 'Trusted PowerShell binding shape is invalid.');
    }
    return result;
}

export function requirePackageBinding(value: unknown): GatePackageBinding {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('S7_STARTUP_GATE_INVALID', 'Package binding is missing.');
    }
    const record = value as Record<string, unknown>;
    const appContent = record.appContent as Record<string, unknown> | undefined;
    if (!appContent
        || !path.isAbsolute(String(appContent.realPath || ''))
        || !Number.isInteger(Number(appContent.fileCount))
        || Number(appContent.fileCount) < 1
        || !Number.isInteger(Number(appContent.sizeBytes))
        || Number(appContent.sizeBytes) < 1) {
        fail('S7_STARTUP_GATE_INVALID', 'Package app-content binding is invalid.');
    }
    return {
        exe: requireArtifactBinding(record.exe, 'Package executable'),
        appContent: {
            realPath: String(appContent.realPath),
            sha256: normalizeSha(appContent.sha256, 'Package app content'),
            fileCount: Number(appContent.fileCount),
            sizeBytes: Number(appContent.sizeBytes),
        },
        main: requireArtifactBinding(record.main, 'Package Main'),
    };
}

export function requireActiveGate(value: unknown, expected: {
    canonicalUserDataDir: string;
    activePath: string;
    gateId: string;
    invocationId: string;
}): ActiveGateDocument {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('S7_STARTUP_GATE_INVALID', 'ACTIVE gate document is missing.');
    }
    const record = value as Record<string, unknown>;
    const paths = record.paths as Record<string, unknown> | undefined;
    const bindings = record.bindings as Record<string, unknown> | undefined;
    const gateDirectory = path.join(expected.canonicalUserDataDir, S7_STARTUP_GATE_DIRECTORY);
    const expectedBound = path.join(gateDirectory, S7_STARTUP_GATE_BOUND_FILE);
    const expectedHandoffReady = path.join(gateDirectory, S7_STARTUP_GATE_HANDOFF_READY_FILE);
    const expectedHandoffReleased = path.join(gateDirectory, S7_STARTUP_GATE_HANDOFF_RELEASED_FILE);
    const expectedAdmission = path.join(gateDirectory, S7_STARTUP_GATE_ADMISSION_FILE);
    const expectedClosed = path.join(gateDirectory, S7_STARTUP_GATE_CLOSED_FILE);
    const expectedFinalized = path.join(gateDirectory, S7_STARTUP_GATE_FINALIZED_FILE);
    if (record.kind !== S7_STARTUP_GATE_ACTIVE_KIND
        || record.schemaVersion !== S7_STARTUP_GATE_ACTIVE_SCHEMA
        || record.status !== 'ACTIVE_AWAITING_BOUND_CHILD'
        || requireSafeIdentifier(record.gateId, 'Gate ID') !== expected.gateId
        || requireSafeIdentifier(record.invocationId, 'Invocation ID') !== expected.invocationId
        || !samePath(record.canonicalUserDataDir, expected.canonicalUserDataDir)
        || !paths
        || !samePath(paths.active, expected.activePath)
        || !samePath(paths.bound, expectedBound)
        || !samePath(paths.handoffReady, expectedHandoffReady)
        || !samePath(paths.handoffReleased, expectedHandoffReleased)
        || !samePath(paths.admission, expectedAdmission)
        || !samePath(paths.closed, expectedClosed)
        || !samePath(paths.finalized, expectedFinalized)
        || !bindings) {
        fail('S7_STARTUP_GATE_INVALID', 'ACTIVE gate binding does not match the canonical launch.');
    }
    requireFiniteTimestamp(record.createdAt, 'ACTIVE gate creation');
    return {
        kind: S7_STARTUP_GATE_ACTIVE_KIND,
        schemaVersion: S7_STARTUP_GATE_ACTIVE_SCHEMA,
        status: 'ACTIVE_AWAITING_BOUND_CHILD',
        gateId: expected.gateId,
        invocationId: expected.invocationId,
        createdAt: String(record.createdAt),
        canonicalUserDataDir: expected.canonicalUserDataDir,
        paths: {
            active: expected.activePath,
            bound: expectedBound,
            handoffReady: expectedHandoffReady,
            handoffReleased: expectedHandoffReleased,
            admission: expectedAdmission,
            closed: expectedClosed,
            finalized: expectedFinalized,
        },
        bindings: {
            executable: requireArtifactBinding(bindings.executable, 'Approved executable'),
            package: requirePackageBinding(bindings.package),
            database: requireArtifactBinding(bindings.database, 'Authority database'),
            intent: requireArtifactBinding(bindings.intent, 'Launch intent'),
            shell: requireTrustedShellBinding(bindings.shell),
        },
    };
}

export function requireBoundGate(value: unknown, active: ActiveGateDocument, activeArtifact: S7StableFileArtifact, pid: number): BoundGateDocument {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('S7_STARTUP_GATE_INVALID', 'BOUND gate document is missing.');
    }
    const record = value as Record<string, unknown>;
    const bindings = record.bindings as Record<string, unknown> | undefined;
    if (record.kind !== S7_STARTUP_GATE_BOUND_KIND
        || record.schemaVersion !== S7_STARTUP_GATE_BOUND_SCHEMA
        || record.status !== 'BOUND_SUSPENDED'
        || record.gateId !== active.gateId
        || record.invocationId !== active.invocationId
        || Number(record.pid) !== pid
        || !Number.isInteger(Number(record.threadId))
        || Number(record.threadId) < 1
        || !bindings) {
        fail('S7_STARTUP_GATE_INVALID', 'BOUND gate is not bound to this approved process.');
    }
    requireFiniteTimestamp(record.boundAt, 'BOUND gate');
    const boundActive = requireArtifactBinding(record.activeGate, 'BOUND ACTIVE gate');
    if (!sameArtifact(boundActive, activeArtifact)) {
        fail('S7_STARTUP_GATE_INVALID', 'BOUND gate does not bind the stable ACTIVE gate identity.');
    }
    const normalizedBindings = {
        executable: requireArtifactBinding(bindings.executable, 'BOUND executable'),
        package: requirePackageBinding(bindings.package),
        database: requireArtifactBinding(bindings.database, 'BOUND database'),
        intent: requireArtifactBinding(bindings.intent, 'BOUND intent'),
        shell: requireTrustedShellBinding(bindings.shell),
    };
    if (stableJson(normalizedBindings) !== stableJson(active.bindings)) {
        fail('S7_STARTUP_GATE_INVALID', 'ACTIVE and BOUND launch bindings differ.');
    }
    return {
        kind: S7_STARTUP_GATE_BOUND_KIND,
        schemaVersion: S7_STARTUP_GATE_BOUND_SCHEMA,
        status: 'BOUND_SUSPENDED',
        gateId: active.gateId,
        invocationId: active.invocationId,
        boundAt: String(record.boundAt),
        pid,
        threadId: Number(record.threadId),
        activeGate: boundActive,
        bindings: normalizedBindings,
    };
}

export function requireHandoffReleased(value: unknown, active: ActiveGateDocument, activeArtifact: S7StableFileArtifact, boundArtifact: S7StableFileArtifact, readyArtifact: S7StableFileArtifact, pid: number): {
    helperPid: number;
    releasedAt: string;
} {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('S7_STARTUP_GATE_HANDOFF_UNTRUSTED', 'HANDOFF_RELEASED document is missing.');
    }
    const record = value as Record<string, unknown>;
    if (record.kind !== S7_STARTUP_GATE_HANDOFF_RELEASED_KIND
        || record.schemaVersion !== S7_STARTUP_GATE_HANDOFF_RELEASED_SCHEMA
        || record.status !== 'DB_HANDLE_RELEASED'
        || record.gateId !== active.gateId
        || record.invocationId !== active.invocationId
        || Number(record.pid) !== pid
        || !Number.isInteger(Number(record.helperPid))
        || Number(record.helperPid) < 1
        || !sameArtifact(requireArtifactBinding(record.activeGate, 'Released ACTIVE'), activeArtifact)
        || !sameArtifact(requireArtifactBinding(record.boundGate, 'Released BOUND'), boundArtifact)
        || !sameArtifact(requireArtifactBinding(record.handoffReady, 'Released READY'), readyArtifact)
        || stableJson(requireArtifactBinding(record.database, 'Released database'))
            !== stableJson(active.bindings.database)
        || stableJson(requireTrustedShellBinding(record.shell)) !== stableJson(active.bindings.shell)) {
        fail('S7_STARTUP_GATE_HANDOFF_UNTRUSTED', 'HANDOFF_RELEASED binding is invalid.');
    }
    return {
        helperPid: Number(record.helperPid),
        releasedAt: requireFiniteTimestamp(record.releasedAt, 'HANDOFF_RELEASED'),
    };
}

export function requireStrictArtifactBinding(value: unknown, label: string): GateArtifactBinding {
    const record = value as Record<string, unknown> | null;
    const identity = record?.identity as Record<string, unknown> | null;
    if (!exactKeys(record, ['realPath', 'sha256', 'sizeBytes', 'identity'])
        || !exactKeys(identity, ['deviceId', 'fileId', 'hardLinkCount'])) {
        fail('S7_STARTUP_GATE_INVALID', `${label} has extra or missing binding fields.`);
    }
    return requireArtifactBinding(value, label);
}

export function requireStrictPackageBinding(value: unknown): GatePackageBinding {
    const record = value as Record<string, unknown> | null;
    const appContent = record?.appContent as Record<string, unknown> | null;
    if (!exactKeys(record, ['exe', 'appContent', 'main'])
        || !exactKeys(appContent, ['realPath', 'sha256', 'fileCount', 'sizeBytes'])) {
        fail('S7_STARTUP_GATE_INVALID', 'Finalized package binding has extra or missing fields.');
    }
    requireStrictArtifactBinding(record?.exe, 'Finalized package executable');
    requireStrictArtifactBinding(record?.main, 'Finalized package Main');
    return requirePackageBinding(value);
}

export function requireStrictTrustedShellBinding(value: unknown): GateTrustedShellBinding {
    const record = value as Record<string, unknown> | null;
    if (!exactKeys(record, [
        'realPath',
        'sha256',
        'sizeBytes',
        'identity',
        'hardlinkPaths',
        'signature',
        'version',
    ])
        || !exactKeys(record?.identity, ['deviceId', 'fileId', 'hardLinkCount'])
        || !exactKeys(record?.signature, ['status', 'subject', 'thumbprint'])
        || !exactKeys(record?.version, [
            'companyName',
            'fileVersion',
            'originalFilename',
            'productName',
        ])) {
        fail('S7_STARTUP_GATE_INVALID', 'Finalized trusted shell has extra or missing fields.');
    }
    return requireTrustedShellBinding(value);
}

export function requirePostMigrationAuthorityState(value: unknown): S7PostMigrationAuthorityState {
    const record = value as Record<string, unknown> | null;
    if (!exactKeys(record, [
        'targetVersion',
        'integrityCheck',
        'foreignKeyViolationCount',
        'migrationRows',
        'requiredTables',
        'contractSha256',
    ])) {
        fail('S7_STARTUP_GATE_AUTHORITY_DRIFT', 'Finalized authority contract shape is invalid.');
    }
    const migrationRows = Array.isArray(record?.migrationRows)
        ? record.migrationRows.map((row) => {
            if (!exactKeys(row, ['version', 'name', 'checksum', 'status'])) {
                fail('S7_STARTUP_GATE_AUTHORITY_DRIFT', 'Finalized migration row shape is invalid.');
            }
            const item = row as Record<string, unknown>;
            return {
                version: Number(item.version),
                name: String(item.name),
                checksum: String(item.checksum),
                status: String(item.status),
            };
        })
        : [];
    const requiredTables = Array.isArray(record?.requiredTables)
        ? record.requiredTables.map((item) => String(item))
        : [];
    const expectedRows = POST_MIGRATION_CONTRACT.map((row) => ({
        ...row,
        status: 'applied',
    }));
    if (Number(record?.targetVersion) !== POST_MIGRATION_TARGET_VERSION
        || record?.integrityCheck !== 'ok'
        || Number(record?.foreignKeyViolationCount) !== 0
        || stableJson(migrationRows) !== stableJson(expectedRows)
        || stableJson(requiredTables) !== stableJson(POST_MIGRATION_REQUIRED_TABLES)
        || normalizeSha(record?.contractSha256, 'Finalized authority contract')
            !== postMigrationContractSha256()) {
        fail('S7_STARTUP_GATE_AUTHORITY_DRIFT', 'Finalized authority contract is not current.');
    }
    return {
        targetVersion: POST_MIGRATION_TARGET_VERSION,
        integrityCheck: 'ok',
        foreignKeyViolationCount: 0,
        migrationRows: expectedRows as S7PostMigrationAuthorityState['migrationRows'],
        requiredTables: [...POST_MIGRATION_REQUIRED_TABLES],
        contractSha256: postMigrationContractSha256(),
    };
}

export function requireFinalizedMachine(value: unknown, database: GateArtifactBinding): FinalizedGateDocument['machine'] {
    const record = value as Record<string, unknown> | null;
    if (!exactKeys(record, [
        'computerName',
        'currentUserSid',
        'databaseDeviceId',
        'databaseFileId',
    ])) {
        fail('S7_STARTUP_GATE_INVALID', 'Finalized machine binding shape is invalid.');
    }
    const result = {
        computerName: String(record?.computerName || ''),
        currentUserSid: String(record?.currentUserSid || ''),
        databaseDeviceId: String(record?.databaseDeviceId || ''),
        databaseFileId: String(record?.databaseFileId || ''),
    };
    if (!result.computerName
        || result.computerName.includes('\0')
        || !result.currentUserSid
        || result.databaseDeviceId !== database.identity.deviceId
        || result.databaseFileId !== database.identity.fileId) {
        fail('S7_STARTUP_GATE_BINDING_MISMATCH', 'Finalized machine/database identity is invalid.');
    }
    return result;
}

export function finalizedPayloadHash(record: Record<string, unknown>): string {
    const payload = { ...record };
    delete payload.finalizationPayloadSha256;
    return sha256(stableJson(payload));
}

export function requireFinalizedGate(value: unknown, active: ActiveGateDocument, artifacts: {
    active: S7StableFileArtifact;
    bound: S7StableFileArtifact;
    handoffReady: S7StableFileArtifact;
    handoffReleased: S7StableFileArtifact;
    admission: S7StableFileArtifact;
    closed: S7StableFileArtifact | null;
}): FinalizedGateDocument {
    const record = value as Record<string, unknown> | null;
    const recovering = record?.schemaVersion === 's7-main-startup-gate-finalized/v2';
    const keys = [
        'kind',
        'schemaVersion',
        'status',
        'finalizedAt',
        'gateId',
        'invocationId',
        'canonicalUserDataDir',
        'approvalPayloadSha256',
        'approvalPacket',
        'launchReceipt',
        'acceptanceReceipt',
        'finalizationPacket',
        'activeGate',
        'boundGate',
        'handoffReady',
        'handoffReleased',
        'admission',
        'closed',
        'databaseAfterMigration',
        'packageAtMigration',
        'shellAtMigration',
        'machine',
        'authority',
        'finalizationPayloadSha256',
        'formalAppReadiness',
        'adsExecutionAuthorized',
    ] as const;
    if (!exactKeys(record, recovering ? [...keys, 'recovery'] : keys)
        || record?.kind !== S7_STARTUP_GATE_FINALIZED_KIND
        || (!recovering && record?.schemaVersion !== S7_STARTUP_GATE_FINALIZED_SCHEMA)
        || record?.status !== (recovering
            ? 'RECOVERED_AFTER_FAILED_MIGRATION_PROCESS' : 'FINALIZED_FOR_POST_MIGRATION_STARTUP')
        || record?.gateId !== active.gateId
        || record?.invocationId !== active.invocationId
        || !samePath(record?.canonicalUserDataDir, active.canonicalUserDataDir)
        || record?.formalAppReadiness !== false
        || record?.adsExecutionAuthorized !== false) {
        fail('S7_STARTUP_GATE_INVALID', 'FINALIZED receipt shape or authority boundary is invalid.');
    }
    requireFiniteTimestamp(record.finalizedAt, 'FINALIZED receipt');
    const approvalPayloadSha256 = normalizeSha(record.approvalPayloadSha256, 'FINALIZED approval payload');
    const activeGate = requireStrictArtifactBinding(record.activeGate, 'FINALIZED ACTIVE');
    const boundGate = requireStrictArtifactBinding(record.boundGate, 'FINALIZED BOUND');
    const handoffReady = requireStrictArtifactBinding(record.handoffReady, 'FINALIZED READY');
    const handoffReleased = requireStrictArtifactBinding(record.handoffReleased, 'FINALIZED RELEASED');
    const admission = requireStrictArtifactBinding(record.admission, 'FINALIZED ADMISSION');
    const closed = recovering ? null : requireStrictArtifactBinding(record.closed, 'FINALIZED CLOSED');
    if (recovering && (record.closed !== null || artifacts.closed !== null)) {
        fail('S7_STARTUP_GATE_INVALID', 'Post-write recovery must preserve the missing CLOSED state.');
    }
    for (const [label, expected, actual] of [
        ['ACTIVE', artifacts.active, activeGate],
        ['BOUND', artifacts.bound, boundGate],
        ['HANDOFF_READY', artifacts.handoffReady, handoffReady],
        ['HANDOFF_RELEASED', artifacts.handoffReleased, handoffReleased],
        ['ADMISSION', artifacts.admission, admission],
        ['CLOSED', artifacts.closed, closed],
    ] as const) {
        if ((expected === null || actual === null) ? expected !== actual : !sameArtifact(expected, actual)) {
            fail('S7_STARTUP_GATE_BINDING_MISMATCH', `FINALIZED ${label} binding drifted.`);
        }
    }
    const databaseAfterMigration = requireStrictArtifactBinding(record.databaseAfterMigration, 'FINALIZED database after migration');
    const packageAtMigration = requireStrictPackageBinding(record.packageAtMigration);
    const shellAtMigration = requireStrictTrustedShellBinding(record.shellAtMigration);
    if (stableJson(packageAtMigration) !== stableJson(active.bindings.package)
        || stableJson(shellAtMigration) !== stableJson(active.bindings.shell)) {
        fail('S7_STARTUP_GATE_BINDING_MISMATCH', 'FINALIZED migration package or shell differs from ACTIVE.');
    }
    const machine = requireFinalizedMachine(record.machine, databaseAfterMigration);
    const authority = requirePostMigrationAuthorityState(record.authority);
    let recovery: S7PostWriteRecovery | undefined;
    if (recovering) {
        const value = record.recovery as Record<string, unknown> | null;
        if (!exactKeys(value, ['failurePhase', 'exitCode', 'backup', 'intent', 'package'])
            || value?.failurePhase !== 'child-exit-failed-before-closed-receipt'
            || (value.exitCode !== null && (!Number.isInteger(value.exitCode)
                || Number(value.exitCode) < 1 || Number(value.exitCode) > 0xffffffff))) {
            fail('S7_STARTUP_GATE_INVALID', 'Post-write recovery failure identity is invalid.');
        }
        recovery = {
            failurePhase: 'child-exit-failed-before-closed-receipt',
            exitCode: value.exitCode as number | null,
            backup: requireStrictArtifactBinding(value.backup, 'Recovery WAL-safe backup'),
            intent: requireStrictArtifactBinding(value.intent, 'Recovery original intent'),
            package: requireStrictPackageBinding(value.package),
        };
        if (stableJson(recovery.intent) !== stableJson(active.bindings.intent)) {
            fail('S7_STARTUP_GATE_BINDING_MISMATCH', 'Recovery original intent drifted.');
        }
    }
    const finalizationPayloadSha256 = normalizeSha(record.finalizationPayloadSha256, 'FINALIZED payload');
    if (finalizationPayloadSha256 !== finalizedPayloadHash(record)) {
        fail('S7_STARTUP_GATE_INVALID', 'FINALIZED payload integrity hash is invalid.');
    }
    return {
        kind: S7_STARTUP_GATE_FINALIZED_KIND,
        schemaVersion: recovering ? 's7-main-startup-gate-finalized/v2' : S7_STARTUP_GATE_FINALIZED_SCHEMA,
        status: recovering ? 'RECOVERED_AFTER_FAILED_MIGRATION_PROCESS' : 'FINALIZED_FOR_POST_MIGRATION_STARTUP',
        finalizedAt: String(record.finalizedAt),
        gateId: active.gateId,
        invocationId: active.invocationId,
        canonicalUserDataDir: active.canonicalUserDataDir,
        approvalPayloadSha256,
        approvalPacket: requireStrictArtifactBinding(record.approvalPacket, 'FINALIZED approval packet'),
        launchReceipt: requireStrictArtifactBinding(record.launchReceipt, 'FINALIZED launch receipt'),
        acceptanceReceipt: requireStrictArtifactBinding(record.acceptanceReceipt, 'FINALIZED acceptance receipt'),
        finalizationPacket: requireStrictArtifactBinding(record.finalizationPacket, 'FINALIZED finalization packet'),
        activeGate,
        boundGate,
        handoffReady,
        handoffReleased,
        admission,
        closed,
        ...(recovery ? { recovery } : {}),
        databaseAfterMigration,
        packageAtMigration,
        shellAtMigration,
        machine,
        authority,
        finalizationPayloadSha256,
        formalAppReadiness: false,
        adsExecutionAuthorized: false,
    };
}
