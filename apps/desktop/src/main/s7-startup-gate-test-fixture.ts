// 按证据职责拆分共享夹具与验收断言，保留原有断言名称。
import { Database, S7_STARTUP_GATE_ACTIVE_FILE, S7_STARTUP_GATE_ACTIVE_KIND, S7_STARTUP_GATE_ACTIVE_SCHEMA, S7_STARTUP_GATE_ADMISSION_FILE, S7_STARTUP_GATE_BOUND_FILE, S7_STARTUP_GATE_BOUND_KIND, S7_STARTUP_GATE_BOUND_SCHEMA, S7_STARTUP_GATE_CLOSED_FILE, S7_STARTUP_GATE_DIRECTORY, S7_STARTUP_GATE_ENV, S7_STARTUP_GATE_FINALIZED_FILE, S7_STARTUP_GATE_HANDOFF_READY_FILE, S7_STARTUP_GATE_HANDOFF_RELEASED_FILE, S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE, S7_STARTUP_GATE_TESTING, completeS7MainStartupAdmission, enforceS7MainStartupGate, fs, initGuardedExistingSqlite, path, roots, vi } from './s7-startup-gate-test-environment';
import { publicArtifact, write } from './s7-startup-gate-test-artifacts';
function safeIo() {
    const shellPath = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const shell = {
        realPath: path.resolve(shellPath),
        sha256: S7_STARTUP_GATE_TESTING.sha256('synthetic-powershell'),
        sizeBytes: 42,
        identity: {
            deviceId: 'synthetic-shell-volume',
            fileId: 'synthetic-shell-file',
            hardLinkCount: 1,
        },
        hardlinkPaths: [path.resolve(shellPath)],
        signature: {
            status: 'Valid' as const,
            subject: 'CN=Microsoft Windows',
            thumbprint: S7_STARTUP_GATE_TESTING.sha256('synthetic-thumbprint'),
        },
        version: {
            companyName: 'Microsoft Corporation',
            fileVersion: '10.0.0.0',
            originalFilename: 'PowerShell.EXE',
            productName: 'Microsoft Windows',
        },
    };
    return {
        inspectWindowsPathSecurity: vi.fn((filePath: string, type: 'file' | 'directory', _label?: string, _trustedShell?: typeof shell) => ({
            passed: true,
            path: path.resolve(filePath),
            type,
            ownerSid: 'S-1-5-21-synthetic',
            currentUserSid: 'S-1-5-21-synthetic',
            inheritanceProtected: true,
            unauthorizedRules: [] as string[],
        })),
        protectWindowsPath: vi.fn(),
        inspectTrustedPowerShell: vi.fn(() => shell),
        shell,
    };
}

function setupApprovedGate(sourceRows?: Array<{
    version: number;
    name: string;
    checksum: string;
}>) {
    const root = fs.mkdtempSync(path.join(process.cwd(), '.tmp-s7-main-gate-'));
    roots.push(root);
    const canonicalUserDataDir = path.join(root, 'Roaming', '@amazon-ai-ops', 'desktop');
    const gateDirectory = path.join(canonicalUserDataDir, S7_STARTUP_GATE_DIRECTORY);
    const activePath = path.join(gateDirectory, S7_STARTUP_GATE_ACTIVE_FILE);
    const boundPath = path.join(gateDirectory, S7_STARTUP_GATE_BOUND_FILE);
    const handoffReadyPath = path.join(gateDirectory, S7_STARTUP_GATE_HANDOFF_READY_FILE);
    const handoffReleasedPath = path.join(gateDirectory, S7_STARTUP_GATE_HANDOFF_RELEASED_FILE);
    const admissionPath = path.join(gateDirectory, S7_STARTUP_GATE_ADMISSION_FILE);
    const closedPath = path.join(gateDirectory, S7_STARTUP_GATE_CLOSED_FILE);
    const finalizedPath = path.join(gateDirectory, S7_STARTUP_GATE_FINALIZED_FILE);
    const executablePath = path.join(root, 'package', 'AmazonAIOpsAgent.exe');
    const mainModulePath = path.join(root, 'package', 'resources', 'app', 'dist', 'main', 'index.js');
    const appContentPath = path.join(root, 'package', 'resources', 'app');
    const databasePath = path.join(canonicalUserDataDir, 'amazon-ai-ops.db');
    const intentPath = path.join(canonicalUserDataDir, '.s7-live-migration-launch-intents', 'approved.intent.json');
    write(executablePath, 'synthetic-executable');
    write(mainModulePath, 'synthetic-main');
    fs.mkdirSync(canonicalUserDataDir, { recursive: true });
    const legacy = new Database(databasePath);
    legacy.exec('CREATE TABLE legacy_probe (id INTEGER PRIMARY KEY, value TEXT)');
    if (sourceRows) {
        legacy.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, checksum TEXT, status TEXT)');
        for (const row of sourceRows) {
            legacy.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?, 'applied')").run(row.version, row.name, row.checksum);
        }
    }
    legacy.close();
    write(intentPath, '{"approved":true}\n');
    fs.mkdirSync(gateDirectory);
    const executable = S7_STARTUP_GATE_TESTING.defaultReadStableFile(executablePath, 'synthetic executable');
    const main = S7_STARTUP_GATE_TESTING.defaultReadStableFile(mainModulePath, 'synthetic Main');
    const database = S7_STARTUP_GATE_TESTING.defaultReadStableFile(databasePath, 'synthetic database');
    const intent = S7_STARTUP_GATE_TESTING.defaultReadStableFile(intentPath, 'synthetic intent');
    const gateId = 'gate-20260730-synthetic';
    const invocationId = 'invocation-20260730-synthetic';
    const safe = safeIo();
    const bindings = {
        executable: publicArtifact(executable),
        package: {
            exe: publicArtifact(executable),
            appContent: {
                ...S7_STARTUP_GATE_TESTING.defaultBuildAppContentManifest(appContentPath),
            },
            main: publicArtifact(main),
        },
        database: publicArtifact(database),
        intent: publicArtifact(intent),
        shell: safe.shell,
    };
    write(activePath, {
        kind: S7_STARTUP_GATE_ACTIVE_KIND,
        schemaVersion: S7_STARTUP_GATE_ACTIVE_SCHEMA,
        status: 'ACTIVE_AWAITING_BOUND_CHILD',
        gateId,
        invocationId,
        createdAt: '2026-07-30T01:00:00.000Z',
        canonicalUserDataDir,
        paths: {
            active: activePath,
            bound: boundPath,
            handoffReady: handoffReadyPath,
            handoffReleased: handoffReleasedPath,
            admission: admissionPath,
            closed: closedPath,
            finalized: finalizedPath,
        },
        bindings,
    });
    const active = S7_STARTUP_GATE_TESTING.defaultReadStableFile(activePath, 'synthetic ACTIVE');
    const pid = 8123;
    write(boundPath, {
        kind: S7_STARTUP_GATE_BOUND_KIND,
        schemaVersion: S7_STARTUP_GATE_BOUND_SCHEMA,
        status: 'BOUND_SUSPENDED',
        gateId,
        invocationId,
        boundAt: '2026-07-30T01:00:01.000Z',
        pid,
        threadId: 9001,
        activeGate: publicArtifact(active),
        bindings,
    });
    const env = {
        [S7_STARTUP_GATE_ENV.activePathB64]: Buffer.from(activePath, 'utf8').toString('base64'),
        [S7_STARTUP_GATE_ENV.activeSha256]: active.sha256,
        [S7_STARTUP_GATE_ENV.activeDeviceId]: active.identity.deviceId,
        [S7_STARTUP_GATE_ENV.activeFileId]: active.identity.fileId,
        [S7_STARTUP_GATE_ENV.gateId]: gateId,
        [S7_STARTUP_GATE_ENV.invocationId]: invocationId,
    };
    return {
        root,
        canonicalUserDataDir,
        gateDirectory,
        activePath,
        boundPath,
        handoffReadyPath,
        handoffReleasedPath,
        admissionPath,
        closedPath,
        finalizedPath,
        executablePath,
        mainModulePath,
        databasePath,
        intentPath,
        pid,
        gateId,
        invocationId,
        env,
        safeIo: safe,
    };
}

function approvedOptions(fixture: ReturnType<typeof setupApprovedGate>) {
    let released = false;
    return {
        app: { requestSingleInstanceLock: vi.fn(() => true) },
        currentUserDataDir: fixture.canonicalUserDataDir,
        canonicalUserDataDir: fixture.canonicalUserDataDir,
        evidenceUserDataIdentity: { mode: null, overridden: false, userDataDir: null },
        isPackaged: true,
        executablePath: fixture.executablePath,
        mainModulePath: fixture.mainModulePath,
        pid: fixture.pid,
        platform: 'win32' as const,
        env: { ...fixture.env },
        now: () => new Date('2026-07-30T01:00:02.000Z'),
        io: {
            ...fixture.safeIo,
            sleep: vi.fn(() => {
                if (released || !fs.existsSync(fixture.handoffReadyPath))
                    return;
                const activeDocument = JSON.parse(fs.readFileSync(fixture.activePath, 'utf8'));
                const active = S7_STARTUP_GATE_TESTING.defaultReadStableFile(fixture.activePath, 'synthetic ACTIVE');
                const bound = S7_STARTUP_GATE_TESTING.defaultReadStableFile(fixture.boundPath, 'synthetic BOUND');
                const ready = S7_STARTUP_GATE_TESTING.defaultReadStableFile(fixture.handoffReadyPath, 'synthetic HANDOFF_READY');
                write(fixture.handoffReleasedPath, {
                    kind: 's7-main-startup-handoff-released',
                    schemaVersion: 's7-main-startup-handoff-released/v1',
                    status: 'DB_HANDLE_RELEASED',
                    releasedAt: '2026-07-30T01:00:03.000Z',
                    helperPid: 7001,
                    pid: fixture.pid,
                    gateId: fixture.gateId,
                    invocationId: fixture.invocationId,
                    activeGate: publicArtifact(active),
                    boundGate: publicArtifact(bound),
                    handoffReady: publicArtifact(ready),
                    database: activeDocument.bindings.database,
                    shell: activeDocument.bindings.shell,
                });
                released = true;
            }),
        },
    };
}

function setupFinalizedGate() {
    const fixture = setupApprovedGate();
    const migrationOptions = approvedOptions(fixture);
    const startup = enforceS7MainStartupGate(migrationOptions);
    if (startup.mode !== 'S7_APPROVED_CHILD') {
        throw new Error('synthetic S7 migration child was not admitted');
    }
    const initialized = initGuardedExistingSqlite(fixture.databasePath, ({ database, resolvedPath }) => completeS7MainStartupAdmission({
        startup,
        database,
        resolvedDatabasePath: resolvedPath,
        executablePath: fixture.executablePath,
        mainModulePath: fixture.mainModulePath,
        now: () => new Date('2026-07-30T01:00:04.000Z'),
        io: migrationOptions.io,
    }));
    initialized.database.pragma('wal_checkpoint(TRUNCATE)');
    initialized.database.pragma('journal_mode = DELETE');
    initialized.database.close();
    const activeDocument = JSON.parse(fs.readFileSync(fixture.activePath, 'utf8'));
    const active = S7_STARTUP_GATE_TESTING.defaultReadStableFile(fixture.activePath, 'finalized fixture ACTIVE');
    const bound = S7_STARTUP_GATE_TESTING.defaultReadStableFile(fixture.boundPath, 'finalized fixture BOUND');
    const handoffReady = S7_STARTUP_GATE_TESTING.defaultReadStableFile(fixture.handoffReadyPath, 'finalized fixture READY');
    const handoffReleased = S7_STARTUP_GATE_TESTING.defaultReadStableFile(fixture.handoffReleasedPath, 'finalized fixture RELEASED');
    const admission = S7_STARTUP_GATE_TESTING.defaultReadStableFile(fixture.admissionPath, 'finalized fixture ADMISSION');
    const database = S7_STARTUP_GATE_TESTING.defaultReadStableFile(fixture.databasePath, 'finalized fixture database');
    write(fixture.closedPath, {
        kind: 's7-main-startup-gate-closed',
        schemaVersion: 's7-main-startup-gate-closed/v2',
        status: 'CLOSED_AFTER_GUARDED_MIGRATION',
        closedAt: '2026-07-30T01:00:05.000Z',
        helperPid: 7001,
        pid: fixture.pid,
        exitCode: 0,
        gateId: fixture.gateId,
        invocationId: fixture.invocationId,
        activeGate: publicArtifact(active),
        boundGate: publicArtifact(bound),
        handoffReady: publicArtifact(handoffReady),
        handoffReleased: publicArtifact(handoffReleased),
        admission: publicArtifact(admission),
        databaseAfterClose: publicArtifact(database),
        shell: activeDocument.bindings.shell,
    });
    const closed = S7_STARTUP_GATE_TESTING.defaultReadStableFile(fixture.closedPath, 'finalized fixture CLOSED');
    const evidenceRoot = path.join(fixture.root, 'finalization-evidence');
    const externalPaths = {
        approvalPacket: path.join(evidenceRoot, 'approval.json'),
        launchReceipt: path.join(evidenceRoot, 'launch.json'),
        acceptanceReceipt: path.join(evidenceRoot, 'acceptance.json'),
        finalizationPacket: path.join(evidenceRoot, 'finalization.json'),
    };
    for (const [name, filePath] of Object.entries(externalPaths)) {
        write(filePath, { kind: `synthetic-${name}`, passed: true });
    }
    const external = Object.fromEntries(Object.entries(externalPaths).map(([name, filePath]) => [
        name,
        publicArtifact(S7_STARTUP_GATE_TESTING.defaultReadStableFile(filePath, `finalized fixture ${name}`)),
    ])) as Record<keyof typeof externalPaths, ReturnType<typeof publicArtifact>>;
    const authority = S7_STARTUP_GATE_TESTING.defaultInspectPostMigrationAuthority(fixture.databasePath);
    const databaseBinding = publicArtifact(database);
    const finalizedBase = {
        kind: 's7-main-startup-gate-finalized',
        schemaVersion: 's7-main-startup-gate-finalized/v1',
        status: 'FINALIZED_FOR_POST_MIGRATION_STARTUP',
        finalizedAt: '2026-07-30T01:10:00.000Z',
        gateId: fixture.gateId,
        invocationId: fixture.invocationId,
        canonicalUserDataDir: fixture.canonicalUserDataDir,
        approvalPayloadSha256: S7_STARTUP_GATE_TESTING.sha256('synthetic-approval'),
        approvalPacket: external.approvalPacket,
        launchReceipt: external.launchReceipt,
        acceptanceReceipt: external.acceptanceReceipt,
        finalizationPacket: external.finalizationPacket,
        activeGate: publicArtifact(active),
        boundGate: publicArtifact(bound),
        handoffReady: publicArtifact(handoffReady),
        handoffReleased: publicArtifact(handoffReleased),
        admission: publicArtifact(admission),
        closed: publicArtifact(closed),
        databaseAfterMigration: databaseBinding,
        packageAtMigration: activeDocument.bindings.package,
        shellAtMigration: activeDocument.bindings.shell,
        machine: {
            computerName: 'SYNTHETIC-S7-HOST',
            currentUserSid: 'S-1-5-21-synthetic',
            databaseDeviceId: databaseBinding.identity.deviceId,
            databaseFileId: databaseBinding.identity.fileId,
        },
        authority,
        formalAppReadiness: false,
        adsExecutionAuthorized: false,
    };
    write(fixture.finalizedPath, {
        ...finalizedBase,
        finalizationPayloadSha256: S7_STARTUP_GATE_TESTING.sha256(S7_STARTUP_GATE_TESTING.stableJson(finalizedBase)),
    });
    const completionPath = path.join(fixture.gateDirectory, S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE);
    const normalOptions = () => ({
        app: { requestSingleInstanceLock: vi.fn(() => true) },
        currentUserDataDir: fixture.canonicalUserDataDir,
        canonicalUserDataDir: fixture.canonicalUserDataDir,
        evidenceUserDataIdentity: { mode: null, overridden: false, userDataDir: null },
        isPackaged: true,
        executablePath: fixture.executablePath,
        mainModulePath: fixture.mainModulePath,
        pid: fixture.pid + 1,
        platform: 'win32' as const,
        env: { COMPUTERNAME: 'SYNTHETIC-S7-HOST' },
        now: () => new Date('2026-07-30T01:15:00.000Z'),
        io: {
            ...fixture.safeIo,
            inspectPostMigrationAuthority: S7_STARTUP_GATE_TESTING.defaultInspectPostMigrationAuthority,
            writeProtectedExclusiveJson: (filePath: string, value: unknown) => write(filePath, value as object),
        },
    });
    return {
        fixture,
        completionPath,
        authority,
        normalOptions,
    };
}
export { safeIo, setupApprovedGate, approvedOptions, setupFinalizedGate };
