// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import * as path from 'path';
import { type CompleteS7MainStartupAdmissionOptions, type S7StableFileArtifact, type S7StartupGateIo, stableJson, fail, samePath, SUPPORTED_MIGRATION_SOURCE_VERSIONS, sameArtifact, publicArtifact, S7_STARTUP_GATE_ADMISSION_KIND, S7_STARTUP_GATE_ADMISSION_SCHEMA, MAX_GATE_FILE_BYTES } from './s7-startup-gate-contracts';
import { DEFAULT_IO } from './s7-startup-gate-runtime';
import { requireStrictTrustedShellBinding, requireSecurePath, requireArtifactBinding, parseJsonFile } from './s7-startup-gate-bindings';
import { schemaVersionOnConnection } from './s7-startup-gate-authority';
import { assertArtifactBound, assertPackageBinding } from './s7-startup-gate-chain';

export function completeS7MainStartupAdmission(options: CompleteS7MainStartupAdmissionOptions): S7StableFileArtifact {
    const io: S7StartupGateIo = { ...DEFAULT_IO, ...options.io };
    const { startup, database } = options;
    const expectedTrustedShell = requireStrictTrustedShellBinding(startup.expectedTrustedShell);
    const trustedShell = requireStrictTrustedShellBinding(io.inspectTrustedPowerShell());
    if (stableJson(trustedShell) !== stableJson(expectedTrustedShell)) {
        fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'Trusted Windows PowerShell identity drifted between handoff and SQLite takeover.');
    }
    const resolvedDatabasePath = path.resolve(options.resolvedDatabasePath);
    if (!database.inTransaction
        || String(database.pragma('locking_mode', { simple: true })).toLowerCase() !== 'exclusive') {
        fail('S7_STARTUP_GATE_SQLITE_TAKEOVER_UNTRUSTED', 'Admission requires the guarded connection inside BEGIN EXCLUSIVE.');
    }
    const databaseRows = database.pragma('database_list') as Array<{
        name: string;
        file: string;
    }>;
    const mainDatabase = databaseRows.find((row) => row.name === 'main');
    if (!mainDatabase
        || !samePath(mainDatabase.file, resolvedDatabasePath)
        || !samePath(resolvedDatabasePath, startup.expectedDatabase.realPath)) {
        fail('S7_STARTUP_GATE_SQLITE_TAKEOVER_UNTRUSTED', 'Guarded SQLite connection is not the approved authority database.');
    }
    const schemaVersionBefore = schemaVersionOnConnection(database);
    if (!SUPPORTED_MIGRATION_SOURCE_VERSIONS.includes(schemaVersionBefore)) {
        fail('S7_STARTUP_GATE_SQLITE_TAKEOVER_UNTRUSTED', `Approved migration source must still be schema v0 or v11, observed v${schemaVersionBefore}.`);
    }
    const databaseArtifact = io.readStableFile(resolvedDatabasePath, 'Authority database under SQLite exclusive lock');
    requireSecurePath(io, resolvedDatabasePath, 'file', 'Authority database under SQLite exclusive lock', trustedShell);
    assertArtifactBound(databaseArtifact, startup.expectedDatabase, 'Authority database');
    const activeArtifact = io.readStableFile(startup.activeGate.realPath, 'Admission ACTIVE gate');
    const boundArtifact = io.readStableFile(startup.boundGate.realPath, 'Admission BOUND gate');
    const readyArtifact = io.readStableFile(startup.handoffReady.realPath, 'Admission HANDOFF_READY');
    const releasedArtifact = io.readStableFile(startup.handoffReleased.realPath, 'Admission HANDOFF_RELEASED');
    for (const [label, expected, actual] of [
        ['ACTIVE gate', startup.activeGate, activeArtifact],
        ['BOUND gate', startup.boundGate, boundArtifact],
        ['HANDOFF_READY', startup.handoffReady, readyArtifact],
        ['HANDOFF_RELEASED', startup.handoffReleased, releasedArtifact],
    ] as const) {
        requireSecurePath(io, actual.realPath, 'file', label, trustedShell);
        if (!sameArtifact(expected, actual)) {
            fail('S7_STARTUP_GATE_RACE_BLOCKED', `${label} drifted before SQLite takeover.`);
        }
    }
    const executable = io.readStableFile(options.executablePath, 'Admission packaged executable');
    const main = io.readStableFile(options.mainModulePath, 'Admission packaged Main');
    const appContent = io.buildAppContentManifest(startup.expectedPackage.appContent.realPath);
    assertPackageBinding({
        exe: requireArtifactBinding(publicArtifact(executable), 'Admission package executable'),
        appContent,
        main: requireArtifactBinding(publicArtifact(main), 'Admission package Main'),
    }, startup.expectedPackage, 'Admission package');
    const intent = io.readStableFile(startup.expectedIntent.realPath, 'Admission launch intent');
    requireSecurePath(io, intent.realPath, 'file', 'Admission launch intent', trustedShell);
    assertArtifactBound(intent, startup.expectedIntent, 'Admission launch intent');
    const admittedAt = (options.now ?? (() => new Date()))();
    if (!(admittedAt instanceof Date) || !Number.isFinite(admittedAt.valueOf())) {
        fail('S7_STARTUP_GATE_INVALID', 'Admission clock is invalid.');
    }
    const admission = {
        kind: S7_STARTUP_GATE_ADMISSION_KIND,
        schemaVersion: S7_STARTUP_GATE_ADMISSION_SCHEMA,
        status: 'ADMITTED_UNDER_EXCLUSIVE_SQLITE_LOCK',
        admittedAt: admittedAt.toISOString(),
        pid: startup.pid,
        gateId: startup.gateId,
        invocationId: startup.invocationId,
        singleInstanceLockAcquired: true,
        canonicalUserDataDir: startup.canonicalUserDataDir,
        activeGate: requireArtifactBinding(publicArtifact(activeArtifact), 'Admission ACTIVE gate'),
        boundGate: requireArtifactBinding(publicArtifact(boundArtifact), 'Admission BOUND gate'),
        handoffReady: requireArtifactBinding(publicArtifact(readyArtifact), 'Admission HANDOFF_READY'),
        handoffReleased: requireArtifactBinding(publicArtifact(releasedArtifact), 'Admission HANDOFF_RELEASED'),
        executable: requireArtifactBinding(publicArtifact(executable), 'Admission executable'),
        main: requireArtifactBinding(publicArtifact(main), 'Admission Main'),
        database: requireArtifactBinding(publicArtifact(databaseArtifact), 'Admission database'),
        intent: requireArtifactBinding(publicArtifact(intent), 'Admission intent'),
        package: startup.expectedPackage,
        shell: trustedShell,
        sqliteTakeover: {
            connectionPath: resolvedDatabasePath,
            fileMustExist: true,
            busyTimeoutMs: 0,
            lockingMode: 'exclusive',
            beginMode: 'exclusive',
            transactionActive: true,
            sameConnectionRequiredForMigration: true,
            schemaVersionBefore,
        },
    };
    io.writeExclusiveJson(startup.admissionPath, admission);
    io.protectWindowsPath(startup.admissionPath, 'file');
    const artifact = io.readStableFile(startup.admissionPath, 'S7 Main admission receipt', { captureContents: true, maxBytes: MAX_GATE_FILE_BYTES });
    requireSecurePath(io, artifact.realPath, 'file', 'S7 Main admission receipt', trustedShell);
    const persisted = parseJsonFile<Record<string, unknown>>(artifact, 'S7 Main admission receipt');
    if (stableJson(persisted) !== stableJson(admission)) {
        fail('S7_STARTUP_GATE_ADMISSION_UNTRUSTED', 'Persisted admission differs from Main state.');
    }
    return publicArtifact(artifact);
}
