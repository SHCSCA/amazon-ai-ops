// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import * as path from 'path';
import { type EnforceS7MainStartupGateOptions, type S7MainStartupAdmission, fail, type S7StartupGateIo, S7_STARTUP_GATE_DIRECTORY, S7_STARTUP_GATE_ACTIVE_FILE, S7_STARTUP_GATE_FINALIZED_FILE, S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE, samePath, isPathWithin, S7_STARTUP_GATE_BOUND_FILE, S7_STARTUP_GATE_HANDOFF_READY_FILE, S7_STARTUP_GATE_HANDOFF_RELEASED_FILE, S7_STARTUP_GATE_ADMISSION_FILE, S7_STARTUP_GATE_CLOSED_FILE, type S7PostMigrationAuthorityState, sameArtifact, stableJson, type GateTrustedShellBinding, type PostMigrationAdmissionDocument, publicArtifact, S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_KIND, S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_SCHEMA, sha256, normalizeSha, S7_STARTUP_GATE_ENV, requireSafeIdentifier, MAX_GATE_FILE_BYTES, S7_STARTUP_GATE_HANDOFF_READY_KIND, S7_STARTUP_GATE_HANDOFF_READY_SCHEMA, DEFAULT_HANDOFF_TIMEOUT_MS, HANDOFF_POLL_MS } from './s7-startup-gate-contracts';
import { DEFAULT_IO, gateEnvironmentPresent, assertSingleInstanceLock, scrubGateEnvironment, decodeGatePath } from './s7-startup-gate-runtime';
import { requireSecurePath, requireStrictTrustedShellBinding, requireArtifactBinding, requireActiveGate, parseJsonFile, requireBoundGate, requireHandoffReleased } from './s7-startup-gate-bindings';
import { inspectCompletedS7Chain, readSecureGateJson, requirePostMigrationAdmission, assertArtifactBound, assertPackageBinding } from './s7-startup-gate-chain';

export function enforceS7MainStartupGate(options: EnforceS7MainStartupGateOptions): S7MainStartupAdmission {
    const platform = options.platform ?? process.platform;
    if (platform !== 'win32') {
        fail('S7_STARTUP_GATE_UNSUPPORTED_PLATFORM', 'The desktop startup gate is Windows-only.');
    }
    const env = options.env ?? process.env;
    const now = options.now ?? (() => new Date());
    const pid = options.pid ?? process.pid;
    const io: S7StartupGateIo = { ...DEFAULT_IO, ...options.io };
    const canonicalUserDataDir = path.resolve(options.canonicalUserDataDir);
    const currentUserDataDir = path.resolve(options.currentUserDataDir);
    const gateDirectory = path.join(canonicalUserDataDir, S7_STARTUP_GATE_DIRECTORY);
    const activePath = path.join(gateDirectory, S7_STARTUP_GATE_ACTIVE_FILE);
    const finalizedPath = path.join(gateDirectory, S7_STARTUP_GATE_FINALIZED_FILE);
    const completionPath = path.join(gateDirectory, S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE);
    if (options.evidenceUserDataIdentity.mode !== null) {
        if (options.evidenceUserDataIdentity.overridden !== true
            || !options.evidenceUserDataIdentity.userDataDir
            || !samePath(options.evidenceUserDataIdentity.userDataDir, currentUserDataDir)
            || samePath(currentUserDataDir, canonicalUserDataDir)
            || isPathWithin(canonicalUserDataDir, currentUserDataDir)
            || isPathWithin(currentUserDataDir, canonicalUserDataDir)
            || gateEnvironmentPresent(env)) {
            fail('S7_EVIDENCE_USER_DATA_NOT_ISOLATED', 'Evidence runtime must use one isolated userData and may not carry an S7 authority gate.');
        }
        const evidenceDirectory = io.inspectDirectory(currentUserDataDir, 'Evidence userData');
        if (!samePath(evidenceDirectory.realPath, currentUserDataDir)) {
            fail('S7_EVIDENCE_USER_DATA_NOT_ISOLATED', 'Evidence userData traverses a link or junction.');
        }
        assertSingleInstanceLock(options.app);
        return {
            mode: 'EVIDENCE_ISOLATED',
            admitted: true,
            singleInstanceLockAcquired: true,
            canonicalUserDataDir,
            evidenceUserDataDir: currentUserDataDir,
        };
    }
    if (!samePath(currentUserDataDir, canonicalUserDataDir)) {
        fail('S7_CANONICAL_USER_DATA_MISMATCH', 'Ordinary packaged runtime must use the canonical authority userData.');
    }
    if (!io.existsSync(activePath)) {
        for (const orphanedPath of [
            path.join(gateDirectory, S7_STARTUP_GATE_BOUND_FILE),
            path.join(gateDirectory, S7_STARTUP_GATE_HANDOFF_READY_FILE),
            path.join(gateDirectory, S7_STARTUP_GATE_HANDOFF_RELEASED_FILE),
            path.join(gateDirectory, S7_STARTUP_GATE_ADMISSION_FILE),
            path.join(gateDirectory, S7_STARTUP_GATE_CLOSED_FILE),
            finalizedPath,
            completionPath,
        ]) {
            if (io.existsSync(orphanedPath)) {
                fail('S7_STARTUP_GATE_ORPHANED_CHAIN_BLOCKED', 'An S7 receipt exists without the canonical ACTIVE gate.');
            }
        }
        if (gateEnvironmentPresent(env)) {
            scrubGateEnvironment(env);
            fail('S7_STARTUP_GATE_ENV_INVALID', 'Gate environment exists without the canonical ACTIVE gate.');
        }
        const databasePath = path.join(canonicalUserDataDir, 'amazon-ai-ops.db');
        const beforeDatabase = io.existsSync(databasePath)
            ? io.readStableFile(databasePath, 'Existing authority database')
            : null;
        let beforeAuthority: S7PostMigrationAuthorityState | null = null;
        if (beforeDatabase) {
            requireSecurePath(io, databasePath, 'file', 'Existing authority database');
            try {
                beforeAuthority = io.inspectPostMigrationAuthority(beforeDatabase.realPath);
            }
            catch {
                fail('S7_STARTUP_GATE_LEGACY_DATABASE_BLOCKED', 'Existing authority requires the approved migration operator to reach the current schema/ledger contract.');
            }
        }
        assertSingleInstanceLock(options.app);
        if (io.existsSync(activePath)) {
            fail('S7_STARTUP_GATE_RACE_BLOCKED', 'An S7 ACTIVE gate appeared while the ordinary instance acquired its lock.');
        }
        const afterDatabase = io.existsSync(databasePath)
            ? io.readStableFile(databasePath, 'Existing authority database after lock')
            : null;
        if (Boolean(beforeDatabase) !== Boolean(afterDatabase)
            || (beforeDatabase && afterDatabase && !sameArtifact(beforeDatabase, afterDatabase))) {
            fail('S7_STARTUP_GATE_RACE_BLOCKED', 'Authority database changed while the ordinary instance acquired its lock.');
        }
        if (afterDatabase) {
            requireSecurePath(io, databasePath, 'file', 'Existing authority database after lock');
            let afterAuthority: S7PostMigrationAuthorityState;
            try {
                afterAuthority = io.inspectPostMigrationAuthority(afterDatabase.realPath);
            }
            catch {
                fail('S7_STARTUP_GATE_RACE_BLOCKED', 'Authority schema/ledger/invariants became invalid while the ordinary instance acquired its lock.');
            }
            if (beforeAuthority === null
                || stableJson(afterAuthority) !== stableJson(beforeAuthority)) {
                fail('S7_STARTUP_GATE_RACE_BLOCKED', 'Authority schema/ledger/invariants changed while the ordinary instance acquired its lock.');
            }
        }
        return {
            mode: 'NORMAL',
            admitted: true,
            singleInstanceLockAcquired: true,
            canonicalUserDataDir,
        };
    }
    const finalizedExists = io.existsSync(finalizedPath);
    const completionExists = io.existsSync(completionPath);
    if (!gateEnvironmentPresent(env) && (finalizedExists || completionExists)) {
        if (!options.isPackaged) {
            fail('S7_STARTUP_GATE_REQUIRES_PACKAGED_MAIN', 'Post-migration admission requires packaged Main.');
        }
        if (!finalizedExists) {
            fail('S7_STARTUP_GATE_COMPLETION_UNTRUSTED', 'Completion marker exists without FINALIZED.');
        }
        const computerName = String(env.COMPUTERNAME || '').trim();
        if (!computerName || computerName.includes('\0')) {
            fail('S7_STARTUP_GATE_BINDING_MISMATCH', 'Current Windows machine name is unavailable.');
        }
        let currentTrustedShell: GateTrustedShellBinding;
        try {
            currentTrustedShell = requireStrictTrustedShellBinding(io.inspectTrustedPowerShell());
        }
        catch {
            fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'Current PowerShell signature, owner, ACL, hard-link, or file identity authentication failed.');
        }
        const inspectPostMigrationState = () => {
            const canonicalDirectory = io.inspectDirectory(canonicalUserDataDir, 'Post-migration canonical userData');
            const startupDirectory = io.inspectDirectory(gateDirectory, 'Post-migration startup gate directory');
            if (!samePath(canonicalDirectory.realPath, canonicalUserDataDir)
                || !samePath(startupDirectory.realPath, gateDirectory)) {
                fail('S7_STARTUP_GATE_PATH_UNSAFE', 'Post-migration startup gate path traverses a link or junction.');
            }
            requireSecurePath(io, gateDirectory, 'directory', 'Post-migration startup gate directory', currentTrustedShell);
            const chain = inspectCompletedS7Chain(io, canonicalUserDataDir, activePath, currentTrustedShell);
            const database = io.readStableFile(chain.finalized.databaseAfterMigration.realPath, 'Post-migration authority database');
            requireSecurePath(io, database.realPath, 'file', 'Post-migration authority database', currentTrustedShell);
            const databaseSecurity = io.inspectWindowsPathSecurity(database.realPath, 'file', 'Post-migration authority database machine binding', currentTrustedShell);
            if (!samePath(database.realPath, chain.finalized.databaseAfterMigration.realPath)
                || database.identity.deviceId !== chain.finalized.databaseAfterMigration.identity.deviceId
                || database.identity.fileId !== chain.finalized.databaseAfterMigration.identity.fileId
                || database.identity.hardLinkCount !== 1
                || databaseSecurity.currentUserSid !== chain.finalized.machine.currentUserSid
                || computerName.toLowerCase() !== chain.finalized.machine.computerName.toLowerCase()) {
                fail('S7_STARTUP_GATE_BINDING_MISMATCH', 'Post-migration database SID/machine/volume/file identity drifted.');
            }
            if (!io.existsSync(completionPath)) {
                for (const suffix of ['-wal', '-shm', '-journal']) {
                    if (io.existsSync(`${database.realPath}${suffix}`)) {
                        fail('S7_STARTUP_GATE_BINDING_MISMATCH', 'First post-migration admission requires a sidecar-free accepted database.');
                    }
                }
            }
            const authority = io.inspectPostMigrationAuthority(database.realPath);
            if (stableJson(authority) !== stableJson(chain.finalized.authority)) {
                fail('S7_STARTUP_GATE_AUTHORITY_DRIFT', 'Current authority schema/ledger/invariants differ from FINALIZED.');
            }
            let completionRead: ReturnType<typeof readSecureGateJson> | null = null;
            let completion: PostMigrationAdmissionDocument | null = null;
            if (io.existsSync(completionPath)) {
                completionRead = readSecureGateJson(io, completionPath, 'Post-migration completion marker', currentTrustedShell);
                completion = requirePostMigrationAdmission(completionRead.value, chain);
                if (!samePath(database.realPath, completion.databaseIdentity.realPath)
                    || database.identity.deviceId !== completion.databaseIdentity.deviceId
                    || database.identity.fileId !== completion.databaseIdentity.fileId
                    || database.identity.hardLinkCount !== completion.databaseIdentity.hardLinkCount) {
                    fail('S7_STARTUP_GATE_BINDING_MISMATCH', 'Current authority database identity differs from completion.');
                }
            }
            else {
                if (!sameArtifact(database, chain.finalized.databaseAfterMigration)) {
                    fail('S7_STARTUP_GATE_BINDING_MISMATCH', 'First post-migration admission requires the exact accepted database snapshot.');
                }
                const executable = io.readStableFile(options.executablePath, 'First post-migration packaged executable');
                const main = io.readStableFile(options.mainModulePath, 'First post-migration packaged Main');
                const currentPackage = {
                    exe: requireArtifactBinding(publicArtifact(executable), 'First post-migration executable'),
                    appContent: io.buildAppContentManifest((chain.finalized.recovery?.package ?? chain.finalized.packageAtMigration).appContent.realPath),
                    main: requireArtifactBinding(publicArtifact(main), 'First post-migration Main'),
                };
                if (stableJson(currentPackage) !== stableJson(chain.finalized.recovery?.package ?? chain.finalized.packageAtMigration)) {
                    fail('S7_STARTUP_GATE_BINDING_MISMATCH', 'First post-migration admission package differs from the migration package.');
                }
                if (stableJson(currentTrustedShell)
                    !== stableJson(chain.finalized.shellAtMigration)) {
                    fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'First post-migration admission shell differs from the migration shell.');
                }
            }
            return {
                chain,
                database,
                authority,
                completion,
                completionArtifact: completionRead?.artifact ?? null,
            };
        };
        const beforeLock = inspectPostMigrationState();
        assertSingleInstanceLock(options.app);
        const afterLock = inspectPostMigrationState();
        if (!sameArtifact(beforeLock.chain.finalizedArtifact, afterLock.chain.finalizedArtifact)
            || !sameArtifact(beforeLock.database, afterLock.database)
            || stableJson(beforeLock.authority) !== stableJson(afterLock.authority)
            || Boolean(beforeLock.completionArtifact) !== Boolean(afterLock.completionArtifact)
            || (beforeLock.completionArtifact
                && afterLock.completionArtifact
                && !sameArtifact(beforeLock.completionArtifact, afterLock.completionArtifact))) {
            fail('S7_STARTUP_GATE_RACE_BLOCKED', 'Post-migration chain or authority changed while the Electron lock was acquired.');
        }
        let completionArtifact = afterLock.completionArtifact;
        if (!completionArtifact) {
            const admittedAt = now();
            if (!(admittedAt instanceof Date) || !Number.isFinite(admittedAt.valueOf())) {
                fail('S7_STARTUP_GATE_INVALID', 'Post-migration admission clock is invalid.');
            }
            const completionBase = {
                kind: S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_KIND,
                schemaVersion: S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_SCHEMA,
                status: 'POST_MIGRATION_ADMITTED',
                admittedAt: admittedAt.toISOString(),
                gateId: afterLock.chain.active.gateId,
                invocationId: afterLock.chain.active.invocationId,
                canonicalUserDataDir,
                finalized: requireArtifactBinding(afterLock.chain.finalizedArtifact, 'Completion FINALIZED'),
                activeGate: requireArtifactBinding(afterLock.chain.activeArtifact, 'Completion ACTIVE'),
                closed: afterLock.chain.closedArtifact ? requireArtifactBinding(afterLock.chain.closedArtifact, 'Completion CLOSED') : null,
                acceptanceReceipt: afterLock.chain.finalized.acceptanceReceipt,
                databaseAtFirstAdmission: requireArtifactBinding(afterLock.database, 'Completion database'),
                databaseIdentity: {
                    realPath: afterLock.database.realPath,
                    deviceId: afterLock.database.identity.deviceId,
                    fileId: afterLock.database.identity.fileId,
                    hardLinkCount: 1 as const,
                },
                machine: afterLock.chain.finalized.machine,
                authorityContractSha256: afterLock.authority.contractSha256,
                migrationPackage: afterLock.chain.finalized.packageAtMigration,
                migrationShell: afterLock.chain.finalized.shellAtMigration,
            };
            const completion = {
                ...completionBase,
                completionPayloadSha256: sha256(stableJson(completionBase)),
            };
            io.writeProtectedExclusiveJson(completionPath, completion, currentTrustedShell);
            const persisted = readSecureGateJson(io, completionPath, 'Persisted post-migration completion marker', currentTrustedShell);
            requirePostMigrationAdmission(persisted.value, afterLock.chain);
            completionArtifact = persisted.artifact;
        }
        return {
            mode: 'NORMAL_POST_MIGRATION',
            admitted: true,
            singleInstanceLockAcquired: true,
            canonicalUserDataDir,
            finalizedReceipt: afterLock.chain.finalizedArtifact,
            completionReceipt: completionArtifact,
        };
    }
    if (!options.isPackaged) {
        scrubGateEnvironment(env);
        fail('S7_STARTUP_GATE_REQUIRES_PACKAGED_MAIN', 'An ACTIVE authority gate blocks development Main.');
    }
    if (!gateEnvironmentPresent(env)) {
        fail('S7_STARTUP_GATE_UNAPPROVED_INSTANCE', 'An ACTIVE authority gate exists and this process has no approved child binding.');
    }
    const expectedActivePath = decodeGatePath(env);
    const expectedActiveSha = normalizeSha(env[S7_STARTUP_GATE_ENV.activeSha256], 'Gate environment ACTIVE');
    const expectedDeviceId = String(env[S7_STARTUP_GATE_ENV.activeDeviceId] || '');
    const expectedFileId = String(env[S7_STARTUP_GATE_ENV.activeFileId] || '');
    const expectedGateId = requireSafeIdentifier(env[S7_STARTUP_GATE_ENV.gateId], 'Gate environment ID');
    const expectedInvocationId = requireSafeIdentifier(env[S7_STARTUP_GATE_ENV.invocationId], 'Gate environment invocation ID');
    scrubGateEnvironment(env);
    if (!samePath(expectedActivePath, activePath)
        || !expectedDeviceId
        || !expectedFileId) {
        fail('S7_STARTUP_GATE_ENV_INVALID', 'Gate environment does not bind the canonical ACTIVE path.');
    }
    const inspectApprovedState = () => {
        const trustedShell = requireStrictTrustedShellBinding(io.inspectTrustedPowerShell());
        const canonicalDirectory = io.inspectDirectory(canonicalUserDataDir, 'Canonical authority userData');
        const startupDirectory = io.inspectDirectory(gateDirectory, 'S7 startup gate directory');
        if (!samePath(canonicalDirectory.realPath, canonicalUserDataDir)
            || !samePath(startupDirectory.realPath, gateDirectory)) {
            fail('S7_STARTUP_GATE_PATH_UNSAFE', 'Canonical startup gate path traverses a link or junction.');
        }
        requireSecurePath(io, gateDirectory, 'directory', 'S7 startup gate directory', trustedShell);
        const activeArtifact = io.readStableFile(activePath, 'S7 ACTIVE gate', { captureContents: true, maxBytes: MAX_GATE_FILE_BYTES });
        requireSecurePath(io, activePath, 'file', 'S7 ACTIVE gate', trustedShell);
        if (activeArtifact.sha256 !== expectedActiveSha
            || activeArtifact.identity.deviceId !== expectedDeviceId
            || activeArtifact.identity.fileId !== expectedFileId) {
            fail('S7_STARTUP_GATE_BINDING_MISMATCH', 'ACTIVE gate file identity differs from child environment.');
        }
        const active = requireActiveGate(parseJsonFile<unknown>(activeArtifact, 'S7 ACTIVE gate'), {
            canonicalUserDataDir,
            activePath,
            gateId: expectedGateId,
            invocationId: expectedInvocationId,
        });
        const boundArtifact = io.readStableFile(active.paths.bound, 'S7 BOUND gate', { captureContents: true, maxBytes: MAX_GATE_FILE_BYTES });
        requireSecurePath(io, active.paths.bound, 'file', 'S7 BOUND gate', trustedShell);
        const bound = requireBoundGate(parseJsonFile<unknown>(boundArtifact, 'S7 BOUND gate'), active, activeArtifact, pid);
        const executable = io.readStableFile(options.executablePath, 'Current packaged executable');
        const main = io.readStableFile(options.mainModulePath, 'Current packaged Main');
        const packageContent = io.buildAppContentManifest(active.bindings.package.appContent.realPath);
        const intent = io.readStableFile(active.bindings.intent.realPath, 'S7 launch intent');
        requireSecurePath(io, intent.realPath, 'file', 'S7 launch intent', trustedShell);
        assertArtifactBound(executable, active.bindings.executable, 'Current packaged executable');
        assertArtifactBound(executable, active.bindings.package.exe, 'Package executable');
        assertArtifactBound(main, active.bindings.package.main, 'Packaged Main');
        assertPackageBinding({
            exe: requireArtifactBinding(publicArtifact(executable), 'Measured package executable'),
            appContent: packageContent,
            main: requireArtifactBinding(publicArtifact(main), 'Measured package Main'),
        }, active.bindings.package, 'Complete packaged app content');
        assertArtifactBound(intent, active.bindings.intent, 'S7 launch intent');
        if (stableJson(trustedShell) !== stableJson(active.bindings.shell)) {
            fail('S7_STARTUP_GATE_SHELL_UNTRUSTED', 'Trusted Windows PowerShell identity differs from the approved helper.');
        }
        if (!samePath(executable.realPath, options.executablePath)) {
            fail('S7_STARTUP_GATE_BINDING_MISMATCH', 'Current executable path is not canonical.');
        }
        return {
            active,
            bound,
            activeArtifact,
            boundArtifact,
            executable,
            main,
            packageContent,
            intent,
            trustedShell,
        };
    };
    const beforeLock = inspectApprovedState();
    for (const pendingPath of [
        beforeLock.active.paths.handoffReady,
        beforeLock.active.paths.handoffReleased,
        beforeLock.active.paths.admission,
        beforeLock.active.paths.closed,
        beforeLock.active.paths.finalized,
        completionPath,
    ]) {
        if (io.existsSync(pendingPath)) {
            fail('S7_STARTUP_GATE_REPLAY_BLOCKED', 'The one-time Main startup receipt chain already exists.');
        }
    }
    assertSingleInstanceLock(options.app);
    const afterLock = inspectApprovedState();
    for (const [label, before, after] of [
        ['ACTIVE gate', beforeLock.activeArtifact, afterLock.activeArtifact],
        ['BOUND gate', beforeLock.boundArtifact, afterLock.boundArtifact],
        ['executable', beforeLock.executable, afterLock.executable],
        ['Main', beforeLock.main, afterLock.main],
        ['intent', beforeLock.intent, afterLock.intent],
    ] as const) {
        if (!sameArtifact(before, after)) {
            fail('S7_STARTUP_GATE_RACE_BLOCKED', `${label} changed while the single-instance lock was acquired.`);
        }
    }
    if (stableJson(beforeLock.packageContent) !== stableJson(afterLock.packageContent)
        || stableJson(beforeLock.trustedShell) !== stableJson(afterLock.trustedShell)) {
        fail('S7_STARTUP_GATE_RACE_BLOCKED', 'Complete package content or trusted shell changed while the single-instance lock was acquired.');
    }
    const readyAt = now();
    if (!(readyAt instanceof Date) || !Number.isFinite(readyAt.valueOf())) {
        fail('S7_STARTUP_GATE_INVALID', 'Handoff clock is invalid.');
    }
    const handoffReady = {
        kind: S7_STARTUP_GATE_HANDOFF_READY_KIND,
        schemaVersion: S7_STARTUP_GATE_HANDOFF_READY_SCHEMA,
        status: 'READY_FOR_DB_HANDOFF',
        readyAt: readyAt.toISOString(),
        pid,
        gateId: afterLock.active.gateId,
        invocationId: afterLock.active.invocationId,
        singleInstanceLockAcquired: true,
        canonicalUserDataDir,
        activeGate: requireArtifactBinding(publicArtifact(afterLock.activeArtifact), 'Ready ACTIVE gate'),
        boundGate: requireArtifactBinding(publicArtifact(afterLock.boundArtifact), 'Ready BOUND gate'),
        executable: requireArtifactBinding(publicArtifact(afterLock.executable), 'Ready executable'),
        main: requireArtifactBinding(publicArtifact(afterLock.main), 'Ready Main'),
        intent: requireArtifactBinding(publicArtifact(afterLock.intent), 'Ready intent'),
        package: afterLock.active.bindings.package,
        shell: afterLock.trustedShell,
    };
    io.writeExclusiveJson(afterLock.active.paths.handoffReady, handoffReady);
    io.protectWindowsPath(afterLock.active.paths.handoffReady, 'file');
    const handoffReadyArtifact = io.readStableFile(afterLock.active.paths.handoffReady, 'S7 Main HANDOFF_READY receipt', { captureContents: true, maxBytes: MAX_GATE_FILE_BYTES });
    requireSecurePath(io, handoffReadyArtifact.realPath, 'file', 'S7 Main HANDOFF_READY receipt', afterLock.trustedShell);
    const persistedReady = parseJsonFile<Record<string, unknown>>(handoffReadyArtifact, 'S7 Main HANDOFF_READY receipt');
    if (stableJson(persistedReady) !== stableJson(handoffReady)) {
        fail('S7_STARTUP_GATE_HANDOFF_UNTRUSTED', 'Persisted HANDOFF_READY differs from Main state.');
    }
    const timeoutMs = options.handoffTimeoutMs ?? DEFAULT_HANDOFF_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
        fail('S7_STARTUP_GATE_INVALID', 'Handoff timeout is invalid.');
    }
    const deadline = Date.now() + timeoutMs;
    while (!io.existsSync(afterLock.active.paths.handoffReleased)) {
        if (Date.now() >= deadline) {
            fail('S7_STARTUP_GATE_HANDOFF_TIMEOUT', 'Helper did not release the authority database inside the bounded handoff window.');
        }
        io.sleep(Math.min(HANDOFF_POLL_MS, Math.max(1, deadline - Date.now())));
    }
    const handoffReleasedArtifact = io.readStableFile(afterLock.active.paths.handoffReleased, 'S7 helper HANDOFF_RELEASED receipt', { captureContents: true, maxBytes: MAX_GATE_FILE_BYTES });
    requireSecurePath(io, handoffReleasedArtifact.realPath, 'file', 'S7 helper HANDOFF_RELEASED receipt', afterLock.trustedShell);
    requireHandoffReleased(parseJsonFile<unknown>(handoffReleasedArtifact, 'S7 helper HANDOFF_RELEASED receipt'), afterLock.active, afterLock.activeArtifact, afterLock.boundArtifact, handoffReadyArtifact, pid);
    return {
        mode: 'S7_APPROVED_CHILD',
        admitted: true,
        singleInstanceLockAcquired: true,
        canonicalUserDataDir,
        gateId: afterLock.active.gateId,
        invocationId: afterLock.active.invocationId,
        pid,
        activeGate: publicArtifact(afterLock.activeArtifact),
        boundGate: publicArtifact(afterLock.boundArtifact),
        handoffReady: publicArtifact(handoffReadyArtifact),
        handoffReleased: publicArtifact(handoffReleasedArtifact),
        admissionPath: afterLock.active.paths.admission,
        expectedDatabase: afterLock.active.bindings.database,
        expectedPackage: afterLock.active.bindings.package,
        expectedIntent: afterLock.active.bindings.intent,
        expectedTrustedShell: afterLock.trustedShell,
    };
}
