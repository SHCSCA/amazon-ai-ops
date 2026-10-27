// 按证据职责拆分共享夹具与验收断言，保留原有断言名称。
import { Database, S7_STARTUP_GATE_ACTIVE_FILE, S7_STARTUP_GATE_DIRECTORY, S7_STARTUP_GATE_ENV, S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE, S7_STARTUP_GATE_TESTING, SQLITE_MIGRATION_CONTRACT, STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION, STORE_PROVIDER_IDENTITY_UNIQUE_INDEX, completeS7MainStartupAdmission, describe, enforceS7MainStartupGate, expect, fs, initGuardedExistingSqlite, it, os, path, roots, spawnSync, vi } from './s7-startup-gate-test-environment';
import { approvedOptions, setupApprovedGate, setupFinalizedGate } from './s7-startup-gate-test-fixture';
import { publicArtifact, write } from './s7-startup-gate-test-artifacts';
describe('S7 packaged Main startup exclusivity gate', () => {
it.runIf(process.platform === 'win32')('matches the approved fixed shell version and UTF-8 product name when localized FileVersion text differs', () => {
    const actual = S7_STARTUP_GATE_TESTING.defaultInspectTrustedPowerShell();
    const result = spawnSync(actual.realPath, ['-NoProfile', '-NonInteractive', '-Command', [
            "$ErrorActionPreference='Stop'",
            '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)',
            "$p=Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
            '$v=[Diagnostics.FileVersionInfo]::GetVersionInfo($p)',
            "[ordered]@{fixedVersion=[string]::Join('.',@($v.FileMajorPart,$v.FileMinorPart,$v.FileBuildPart,$v.FilePrivatePart));localizedVersion=$v.FileVersion;productName=$v.ProductName} | ConvertTo-Json -Compress",
        ].join('\n')], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const measured = JSON.parse(result.stdout.trim());
    expect(actual.version.fileVersion).toBe(measured.fixedVersion);
    expect(actual.version.fileVersion).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(actual.version.productName).toBe(measured.productName);
});

it('streams large package/DB artifacts while keeping JSON capture bounded', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-main-gate-large-artifact-'));
    roots.push(root);
    const largeFile = path.join(root, 'large-artifact.bin');
    fs.writeFileSync(largeFile, Buffer.alloc(2 * 1024 * 1024, 0x5a));
    expect(S7_STARTUP_GATE_TESTING.defaultReadStableFile(largeFile, 'large package artifact')).toMatchObject({
        sizeBytes: 2 * 1024 * 1024,
        sha256: expect.stringMatching(/^[A-F0-9]{64}$/),
        contents: undefined,
    });
    expect(() => S7_STARTUP_GATE_TESTING.defaultReadStableFile(largeFile, 'oversized gate JSON', { captureContents: true, maxBytes: 1024 * 1024 })).toThrow(/bounded JSON contract/);
});

it.runIf(process.platform === 'win32')('creates and verifies the protected Windows ACL used by the real startup gate', () => {
    const nativeWindowsTemp = process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Temp')
        : os.tmpdir();
    const root = fs.mkdtempSync(path.join(nativeWindowsTemp, 's7-main-gate-acl-'));
    roots.push(root);
    const gateDirectory = path.join(root, S7_STARTUP_GATE_DIRECTORY);
    const activePath = path.join(gateDirectory, S7_STARTUP_GATE_ACTIVE_FILE);
    fs.mkdirSync(gateDirectory);
    fs.writeFileSync(activePath, '{"synthetic":true}\n');
    S7_STARTUP_GATE_TESTING.defaultProtectWindowsPath(gateDirectory, 'directory');
    S7_STARTUP_GATE_TESTING.defaultProtectWindowsPath(activePath, 'file');
    expect(S7_STARTUP_GATE_TESTING.defaultInspectWindowsPathSecurity(gateDirectory, 'directory', 'synthetic gate directory')).toMatchObject({
        passed: true,
        path: path.resolve(gateDirectory),
        type: 'directory',
        inheritanceProtected: true,
    });
    expect(S7_STARTUP_GATE_TESTING.defaultInspectWindowsPathSecurity(activePath, 'file', 'synthetic ACTIVE receipt')).toMatchObject({
        passed: true,
        path: path.resolve(activePath),
        type: 'file',
        inheritanceProtected: true,
    });
});

it('admits the verified v11 prefix and rejects a tampered or incomplete prefix before admission', () => {
    const prefix = SQLITE_MIGRATION_CONTRACT.filter((row) => row.version <= 11).map((row) => ({ ...row }));
    for (const rows of [prefix, prefix.map((row) => row.version === 5 ? { ...row, checksum: 'tampered' } : row), prefix.filter((row) => row.version !== 5)]) {
        const fixture = setupApprovedGate(rows);
        const options = approvedOptions(fixture);
        const startup = enforceS7MainStartupGate(options);
        if (startup.mode !== 'S7_APPROVED_CHILD')
            throw new Error('Missing approved gate');
        const database = new Database(fixture.databasePath, { fileMustExist: true });
        try {
            database.pragma('locking_mode = EXCLUSIVE');
            database.exec('BEGIN EXCLUSIVE');
            const admit = () => completeS7MainStartupAdmission({
                startup, database, resolvedDatabasePath: fixture.databasePath,
                executablePath: fixture.executablePath, mainModulePath: fixture.mainModulePath,
                now: () => new Date('2026-07-30T01:00:04.000Z'), io: options.io,
            });
            if (rows === prefix) {
                admit();
                expect(JSON.parse(fs.readFileSync(fixture.admissionPath, 'utf8')).sqliteTakeover.schemaVersionBefore).toBe(11);
            }
            else {
                expect(admit).toThrow(/exact applied v1..v11 ledger prefix/);
                expect(fs.existsSync(fixture.admissionPath)).toBe(false);
            }
        }
        finally {
            if (database.inTransaction)
                database.exec('ROLLBACK');
            database.close();
        }
    }
});

it('hands off the DB and writes admission only inside the guarded SQLite connection', () => {
    const fixture = setupApprovedGate();
    const options = approvedOptions(fixture);
    const result = enforceS7MainStartupGate(options);
    expect(result).toMatchObject({
        mode: 'S7_APPROVED_CHILD',
        admitted: true,
        singleInstanceLockAcquired: true,
        gateId: fixture.gateId,
        invocationId: fixture.invocationId,
        activeGate: {
            realPath: fs.realpathSync.native(fixture.activePath),
            identity: { hardLinkCount: 1 },
        },
        boundGate: {
            realPath: fs.realpathSync.native(fixture.boundPath),
            identity: { hardLinkCount: 1 },
        },
        handoffReady: {
            realPath: fs.realpathSync.native(fixture.handoffReadyPath),
            identity: { hardLinkCount: 1 },
        },
        handoffReleased: {
            realPath: fs.realpathSync.native(fixture.handoffReleasedPath),
            identity: { hardLinkCount: 1 },
        },
        expectedTrustedShell: fixture.safeIo.shell,
    });
    expect(fs.existsSync(fixture.admissionPath)).toBe(false);
    if (result.mode !== 'S7_APPROVED_CHILD')
        throw new Error('synthetic S7 gate was not admitted');
    fixture.safeIo.inspectTrustedPowerShell.mockClear();
    fixture.safeIo.inspectWindowsPathSecurity.mockClear();
    const initialized = initGuardedExistingSqlite(fixture.databasePath, ({ database, resolvedPath }) => completeS7MainStartupAdmission({
        startup: result,
        database,
        resolvedDatabasePath: resolvedPath,
        executablePath: fixture.executablePath,
        mainModulePath: fixture.mainModulePath,
        now: () => new Date('2026-07-30T01:00:04.000Z'),
        io: options.io,
    }));
    initialized.database.close();
    expect(options.app.requestSingleInstanceLock).toHaveBeenCalledOnce();
    expect(fixture.safeIo.inspectTrustedPowerShell).toHaveBeenCalledOnce();
    expect(fixture.safeIo.inspectWindowsPathSecurity.mock.calls.map((call) => call[2])).toEqual([
        'Authority database under SQLite exclusive lock',
        'ACTIVE gate',
        'BOUND gate',
        'HANDOFF_READY',
        'HANDOFF_RELEASED',
        'Admission launch intent',
        'S7 Main admission receipt',
    ]);
    expect(fixture.safeIo.inspectWindowsPathSecurity.mock.calls.every((call) => S7_STARTUP_GATE_TESTING.stableJson(call[3])
        === S7_STARTUP_GATE_TESTING.stableJson(fixture.safeIo.shell))).toBe(true);
    expect(fixture.safeIo.protectWindowsPath).toHaveBeenCalledWith(fixture.admissionPath, 'file');
    const admission = JSON.parse(fs.readFileSync(fixture.admissionPath, 'utf8'));
    expect(admission).toMatchObject({
        kind: 's7-main-startup-admission',
        schemaVersion: 's7-main-startup-admission/v2',
        status: 'ADMITTED_UNDER_EXCLUSIVE_SQLITE_LOCK',
        pid: fixture.pid,
        gateId: fixture.gateId,
        invocationId: fixture.invocationId,
        singleInstanceLockAcquired: true,
        handoffReady: expect.objectContaining({
            realPath: fs.realpathSync.native(fixture.handoffReadyPath),
        }),
        handoffReleased: expect.objectContaining({
            realPath: fs.realpathSync.native(fixture.handoffReleasedPath),
        }),
        database: JSON.parse(fs.readFileSync(fixture.activePath, 'utf8')).bindings.database,
        intent: publicArtifact(S7_STARTUP_GATE_TESTING.defaultReadStableFile(fixture.intentPath, 'intent')),
        shell: fixture.safeIo.shell,
        sqliteTakeover: {
            connectionPath: path.resolve(fixture.databasePath),
            fileMustExist: true,
            busyTimeoutMs: 0,
            lockingMode: 'exclusive',
            beginMode: 'exclusive',
            transactionActive: true,
            sameConnectionRequiredForMigration: true,
            schemaVersionBefore: 0,
        },
    });
    for (const name of Object.values(S7_STARTUP_GATE_ENV)) {
        expect(options.env).not.toHaveProperty(name);
    }
});

it('blocks shell drift between handoff and SQLite takeover without changing authority state', () => {
    const fixture = setupApprovedGate();
    const options = approvedOptions(fixture);
    const startup = enforceS7MainStartupGate(options);
    if (startup.mode !== 'S7_APPROVED_CHILD')
        throw new Error('synthetic S7 gate was not admitted');
    const databaseBefore = publicArtifact(S7_STARTUP_GATE_TESTING.defaultReadStableFile(fixture.databasePath, 'authority database before shell drift'));
    const driftedShell = {
        ...fixture.safeIo.shell,
        sha256: S7_STARTUP_GATE_TESTING.sha256('drifted-takeover-powershell'),
        sizeBytes: fixture.safeIo.shell.sizeBytes + 1,
        identity: {
            ...fixture.safeIo.shell.identity,
            fileId: 'synthetic-drifted-shell-file',
        },
        version: {
            ...fixture.safeIo.shell.version,
            fileVersion: '10.0.0.1',
        },
    };
    let failure: unknown;
    let opened: Database.Database | undefined;
    try {
        const initialized = initGuardedExistingSqlite(fixture.databasePath, ({ database, resolvedPath }) => completeS7MainStartupAdmission({
            startup,
            database,
            resolvedDatabasePath: resolvedPath,
            executablePath: fixture.executablePath,
            mainModulePath: fixture.mainModulePath,
            io: {
                ...options.io,
                inspectTrustedPowerShell: () => driftedShell,
            },
        }));
        opened = initialized.database;
    }
    catch (error) {
        failure = error;
    }
    finally {
        opened?.close();
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toMatch(/S7_STARTUP_GATE_SHELL_UNTRUSTED|trusted shell.*drift/i);
    expect(fs.existsSync(fixture.admissionPath)).toBe(false);
    const databaseAfter = publicArtifact(S7_STARTUP_GATE_TESTING.defaultReadStableFile(fixture.databasePath, 'authority database after blocked shell drift'));
    expect(databaseAfter).toEqual(databaseBefore);
    const unchanged = new Database(fixture.databasePath, { readonly: true, fileMustExist: true });
    try {
        expect(unchanged.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name = 'schema_migrations'
      `).get()).toEqual({ count: 0 });
        expect(unchanged.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
      `).all()).toEqual([{ name: 'legacy_probe' }]);
    }
    finally {
        unchanged.close();
    }
});

it('blocks an ordinary process before acquiring the lock when ACTIVE exists', () => {
    const fixture = setupApprovedGate();
    const requestSingleInstanceLock = vi.fn(() => true);
    expect(() => enforceS7MainStartupGate({
        ...approvedOptions(fixture),
        app: { requestSingleInstanceLock },
        env: {},
    })).toThrow(/S7_STARTUP_GATE_UNAPPROVED_INSTANCE/);
    expect(requestSingleInstanceLock).not.toHaveBeenCalled();
    expect(fs.existsSync(fixture.admissionPath)).toBe(false);
});

it('consumes FINALIZED once, permits business writes, and authenticates a serviced shell', () => {
    const state = setupFinalizedGate();
    const firstOptions = state.normalOptions();
    const first = enforceS7MainStartupGate(firstOptions);
    expect(first).toMatchObject({
        mode: 'NORMAL_POST_MIGRATION',
        admitted: true,
        singleInstanceLockAcquired: true,
        canonicalUserDataDir: path.resolve(state.fixture.canonicalUserDataDir),
        finalizedReceipt: {
            realPath: fs.realpathSync.native(state.fixture.finalizedPath),
        },
        completionReceipt: {
            realPath: fs.realpathSync.native(state.completionPath),
        },
    });
    expect(fs.existsSync(state.completionPath)).toBe(true);
    const business = new Database(state.fixture.databasePath);
    business.prepare(`
      INSERT INTO app_settings (key, value)
      VALUES (?, ?)
    `).run('post-migration-business-row', '{"enabled":true}');
    business.close();
    fs.writeFileSync(state.fixture.executablePath, 'legitimate-serviced-executable');
    fs.writeFileSync(state.fixture.mainModulePath, 'legitimate-serviced-main');
    const secondOptions = state.normalOptions();
    const writeProtectedExclusiveJson = vi.fn(() => {
        throw new Error('valid completion must never be rewritten');
    });
    const servicedShell = {
        ...state.fixture.safeIo.shell,
        sha256: S7_STARTUP_GATE_TESTING.sha256('serviced-powershell'),
        sizeBytes: state.fixture.safeIo.shell.sizeBytes + 1,
        identity: {
            ...state.fixture.safeIo.shell.identity,
            fileId: 'synthetic-serviced-shell-file',
        },
        version: {
            ...state.fixture.safeIo.shell.version,
            fileVersion: '10.0.0.1',
        },
    };
    const inspectTrustedPowerShell = vi.fn(() => servicedShell);
    const inspectWindowsPathSecurity = vi.fn(state.fixture.safeIo.inspectWindowsPathSecurity);
    const buildAppContentManifest = vi.fn(() => {
        throw new Error('post-completion startup must not pin the old package');
    });
    const second = enforceS7MainStartupGate({
        ...secondOptions,
        io: {
            ...secondOptions.io,
            writeProtectedExclusiveJson,
            inspectTrustedPowerShell,
            inspectWindowsPathSecurity,
            buildAppContentManifest,
        },
    });
    expect(second.mode).toBe('NORMAL_POST_MIGRATION');
    expect(writeProtectedExclusiveJson).not.toHaveBeenCalled();
    expect(inspectTrustedPowerShell).toHaveBeenCalledOnce();
    expect(inspectWindowsPathSecurity).toHaveBeenCalled();
    expect(inspectWindowsPathSecurity.mock.calls.every((call) => JSON.stringify(call[3]) === JSON.stringify(servicedShell))).toBe(true);
    expect(buildAppContentManifest).not.toHaveBeenCalled();
    const readonly = new Database(state.fixture.databasePath, {
        readonly: true,
        fileMustExist: true,
    });
    try {
        expect(readonly.prepare(`
        SELECT value FROM app_settings WHERE key = ?
      `).get('post-migration-business-row')).toEqual({ value: '{"enabled":true}' });
    }
    finally {
        readonly.close();
    }
});

it('blocks completed startup when current PowerShell signature or ACL authentication fails', () => {
    const invalidSignature = setupFinalizedGate();
    enforceS7MainStartupGate(invalidSignature.normalOptions());
    const signatureOptions = invalidSignature.normalOptions();
    expect(() => enforceS7MainStartupGate({
        ...signatureOptions,
        io: {
            ...signatureOptions.io,
            inspectTrustedPowerShell: () => ({
                ...invalidSignature.fixture.safeIo.shell,
                signature: {
                    ...invalidSignature.fixture.safeIo.shell.signature,
                    status: 'NotSigned',
                },
            } as never),
        },
    })).toThrow(/SHELL_UNTRUSTED|trusted PowerShell/i);
    const invalidAcl = setupFinalizedGate();
    enforceS7MainStartupGate(invalidAcl.normalOptions());
    const aclOptions = invalidAcl.normalOptions();
    expect(() => enforceS7MainStartupGate({
        ...aclOptions,
        io: {
            ...aclOptions.io,
            inspectTrustedPowerShell: () => {
                throw new Error('S7_STARTUP_GATE_SHELL_UNTRUSTED: current PowerShell ACL is unsafe');
            },
        },
    })).toThrow(/SHELL_UNTRUSTED.*ACL/i);
});

it('requires the exact accepted DB, migration package, and shell on first consumption', () => {
    const databaseDrift = setupFinalizedGate();
    const database = new Database(databaseDrift.fixture.databasePath);
    database.prepare(`
      INSERT INTO app_settings (key, value)
      VALUES (?, ?)
    `).run('unauthorized-before-first-admission', 'true');
    database.close();
    expect(() => enforceS7MainStartupGate(databaseDrift.normalOptions())).toThrow(/exact accepted database snapshot|BINDING_MISMATCH/i);
    expect(fs.existsSync(databaseDrift.completionPath)).toBe(false);
    const packageDrift = setupFinalizedGate();
    fs.writeFileSync(packageDrift.fixture.mainModulePath, 'drift-before-first-admission');
    expect(() => enforceS7MainStartupGate(packageDrift.normalOptions())).toThrow(/package differs from the migration package|BINDING_MISMATCH/i);
    expect(fs.existsSync(packageDrift.completionPath)).toBe(false);
    const shellDrift = setupFinalizedGate();
    const shellOptions = shellDrift.normalOptions();
    expect(() => enforceS7MainStartupGate({
        ...shellOptions,
        io: {
            ...shellOptions.io,
            inspectTrustedPowerShell: () => ({
                ...shellDrift.fixture.safeIo.shell,
                sha256: 'F'.repeat(64),
            }),
        },
    })).toThrow(/shell differs from the migration shell|SHELL_UNTRUSTED/i);
    expect(fs.existsSync(shellDrift.completionPath)).toBe(false);
});

it('holds after completion on DB replacement, ACL drift, or authority schema drift', () => {
    const replaced = setupFinalizedGate();
    enforceS7MainStartupGate(replaced.normalOptions());
    const replacement = path.join(replaced.fixture.root, 'replacement.db');
    const displaced = path.join(replaced.fixture.root, 'displaced.db');
    fs.copyFileSync(replaced.fixture.databasePath, replacement);
    fs.renameSync(replaced.fixture.databasePath, displaced);
    fs.renameSync(replacement, replaced.fixture.databasePath);
    expect(() => enforceS7MainStartupGate(replaced.normalOptions())).toThrow(/database.*identity|volume\/file identity|S7_STARTUP_GATE_BINDING_MISMATCH/i);
    const aclDrift = setupFinalizedGate();
    enforceS7MainStartupGate(aclDrift.normalOptions());
    const aclOptions = aclDrift.normalOptions();
    const safeInspector = aclDrift.fixture.safeIo.inspectWindowsPathSecurity;
    expect(() => enforceS7MainStartupGate({
        ...aclOptions,
        io: {
            ...aclOptions.io,
            inspectWindowsPathSecurity: (filePath: string, type: 'file' | 'directory', label?: string) => {
                if (path.resolve(filePath) === path.resolve(aclDrift.fixture.databasePath)) {
                    return {
                        passed: false,
                        path: path.resolve(filePath),
                        type,
                        ownerSid: 'S-1-1-0',
                        currentUserSid: 'S-1-5-21-synthetic',
                        inheritanceProtected: false,
                        unauthorizedRules: ['S-1-1-0:Allow:write'],
                    };
                }
                return safeInspector(filePath, type, label);
            },
        },
    })).toThrow(/ACL\/owner proof failed/i);
    for (const sql of [
        `DELETE FROM schema_migrations WHERE version = ${STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION}`,
        `UPDATE schema_migrations SET checksum = '${'F'.repeat(64)}' WHERE version = ${STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION}`,
        `UPDATE schema_migrations SET status = 'started' WHERE version = ${STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION}`,
    ]) {
        const ledgerDrift = setupFinalizedGate();
        enforceS7MainStartupGate(ledgerDrift.normalOptions());
        const database = new Database(ledgerDrift.fixture.databasePath);
        database.exec(sql);
        database.close();
        expect(() => enforceS7MainStartupGate(ledgerDrift.normalOptions())).toThrow(/AUTHORITY_DRIFT|migration ledger|authority schema/i);
    }
    for (const sql of [
        'DROP TRIGGER trg_lingxing_collection_resume_event_attempt_insert',
        `DROP INDEX ${STORE_PROVIDER_IDENTITY_UNIQUE_INDEX}`,
    ]) {
        const schemaDrift = setupFinalizedGate();
        enforceS7MainStartupGate(schemaDrift.normalOptions());
        const database = new Database(schemaDrift.fixture.databasePath);
        database.exec(sql);
        database.close();
        expect(() => enforceS7MainStartupGate(schemaDrift.normalOptions())).toThrow(/AUTHORITY_DRIFT|exact schema contract|authority schema/i);
    }
});

it('holds on completion half-write/tamper and validates the entire immutable chain', () => {
    const halfWrite = setupFinalizedGate();
    enforceS7MainStartupGate(halfWrite.normalOptions());
    fs.writeFileSync(halfWrite.completionPath, '{"kind":');
    expect(() => enforceS7MainStartupGate(halfWrite.normalOptions())).toThrow(/valid JSON|completion/i);
    const tampered = setupFinalizedGate();
    enforceS7MainStartupGate(tampered.normalOptions());
    const marker = JSON.parse(fs.readFileSync(tampered.completionPath, 'utf8'));
    marker.unexpected = true;
    write(tampered.completionPath, marker);
    expect(() => enforceS7MainStartupGate(tampered.normalOptions())).toThrow(/completion marker shape|COMPLETION_UNTRUSTED/i);
    const aliased = setupFinalizedGate();
    enforceS7MainStartupGate(aliased.normalOptions());
    fs.linkSync(aliased.completionPath, path.join(aliased.fixture.gateDirectory, 'completion-alias.json'));
    expect(() => enforceS7MainStartupGate(aliased.normalOptions())).toThrow(/exactly one filesystem link|PATH_UNSAFE/i);
    const chainDrift = setupFinalizedGate();
    fs.appendFileSync(chainDrift.fixture.closedPath, '\n');
    expect(() => enforceS7MainStartupGate(chainDrift.normalOptions())).toThrow(/FINALIZED CLOSED binding drifted|binding/i);
    const externalUnknown = setupFinalizedGate();
    const finalized = JSON.parse(fs.readFileSync(externalUnknown.fixture.finalizedPath, 'utf8'));
    fs.rmSync(finalized.acceptanceReceipt.realPath);
    expect(() => enforceS7MainStartupGate(externalUnknown.normalOptions())).toThrow();
    expect(fs.existsSync(externalUnknown.completionPath)).toBe(false);
    const sidecarUnknown = setupFinalizedGate();
    fs.writeFileSync(`${sidecarUnknown.fixture.databasePath}-wal`, 'untrusted-wal');
    expect(() => enforceS7MainStartupGate(sidecarUnknown.normalOptions())).toThrow(/sidecar-free accepted database|BINDING_MISMATCH/i);
    expect(fs.existsSync(sidecarUnknown.completionPath)).toBe(false);
});

it('recovers fail-closed from crashes immediately before or after completion publication', () => {
    const beforeWrite = setupFinalizedGate();
    const beforeOptions = beforeWrite.normalOptions();
    expect(() => enforceS7MainStartupGate({
        ...beforeOptions,
        io: {
            ...beforeOptions.io,
            writeProtectedExclusiveJson: () => {
                throw new Error('synthetic crash before completion write');
            },
        },
    })).toThrow(/synthetic crash before/);
    expect(fs.existsSync(beforeWrite.completionPath)).toBe(false);
    expect(enforceS7MainStartupGate(beforeWrite.normalOptions()).mode).toBe('NORMAL_POST_MIGRATION');
    const afterWrite = setupFinalizedGate();
    const afterOptions = afterWrite.normalOptions();
    expect(() => enforceS7MainStartupGate({
        ...afterOptions,
        io: {
            ...afterOptions.io,
            writeProtectedExclusiveJson: (filePath: string, value: unknown) => {
                write(filePath, value as object);
                throw new Error('synthetic crash after completion write');
            },
        },
    })).toThrow(/synthetic crash after/);
    expect(fs.existsSync(afterWrite.completionPath)).toBe(true);
    const replayOptions = afterWrite.normalOptions();
    const replayWriter = vi.fn(() => {
        throw new Error('completion replay must not write');
    });
    expect(enforceS7MainStartupGate({
        ...replayOptions,
        io: {
            ...replayOptions.io,
            writeProtectedExclusiveJson: replayWriter,
        },
    }).mode).toBe('NORMAL_POST_MIGRATION');
    expect(replayWriter).not.toHaveBeenCalled();
});

it('blocks completion without FINALIZED before taking the Electron lock', () => {
    const fixture = setupApprovedGate();
    const completionPath = path.join(fixture.gateDirectory, S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE);
    write(completionPath, { status: 'POST_MIGRATION_ADMITTED' });
    const requestSingleInstanceLock = vi.fn(() => true);
    expect(() => enforceS7MainStartupGate({
        ...approvedOptions(fixture),
        app: { requestSingleInstanceLock },
        env: { COMPUTERNAME: 'SYNTHETIC-S7-HOST' },
    })).toThrow(/Completion marker exists without FINALIZED/i);
    expect(requestSingleInstanceLock).not.toHaveBeenCalled();
});

it('blocks PID, executable hash, intent identity, and ACTIVE environment drift', () => {
    const pidCase = setupApprovedGate();
    expect(() => enforceS7MainStartupGate({
        ...approvedOptions(pidCase),
        pid: pidCase.pid + 1,
    })).toThrow(/BOUND gate is not bound/);
    const executableCase = setupApprovedGate();
    fs.writeFileSync(executableCase.executablePath, 'drifted-executable');
    expect(() => enforceS7MainStartupGate(approvedOptions(executableCase))).toThrow(/executable no longer matches/i);
    const intentCase = setupApprovedGate();
    fs.writeFileSync(intentCase.intentPath, '{"approved":false}\n');
    expect(() => enforceS7MainStartupGate(approvedOptions(intentCase))).toThrow(/intent no longer matches/i);
    const environmentCase = setupApprovedGate();
    expect(() => enforceS7MainStartupGate({
        ...approvedOptions(environmentCase),
        env: {
            ...environmentCase.env,
            [S7_STARTUP_GATE_ENV.activeFileId]: '999999',
        },
    })).toThrow(/ACTIVE gate file identity differs/);
});

it('blocks unsafe ACL/owner proof before reading the authority DB', () => {
    const fixture = setupApprovedGate();
    const readStableFile = vi.fn(S7_STARTUP_GATE_TESTING.defaultReadStableFile);
    const unsafeSecurity = vi.fn((filePath: string, type: 'file' | 'directory') => ({
        passed: false,
        path: path.resolve(filePath),
        type,
        ownerSid: 'S-1-1-0',
        currentUserSid: 'S-1-5-21-synthetic',
        inheritanceProtected: false,
        unauthorizedRules: ['S-1-1-0:Allow'],
    }));
    expect(() => enforceS7MainStartupGate({
        ...approvedOptions(fixture),
        io: {
            ...fixture.safeIo,
            readStableFile,
            inspectWindowsPathSecurity: unsafeSecurity,
        },
    })).toThrow(/ACL\/owner proof failed/);
    expect(readStableFile).not.toHaveBeenCalledWith(fixture.databasePath, expect.any(String));
});
});
