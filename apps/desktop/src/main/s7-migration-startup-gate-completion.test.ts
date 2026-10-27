// 按证据职责拆分共享夹具与验收断言，保留原有断言名称。
import { Database, S7_STARTUP_GATE_ACTIVE_FILE, S7_STARTUP_GATE_DIRECTORY, S7_STARTUP_GATE_TESTING, completeS7MainStartupAdmission, describe, enforceS7MainStartupGate, expect, fs, initGuardedExistingSqlite, it, os, path, protectFreshS7AuthorityPath, roots, vi } from './s7-startup-gate-test-environment';
import { approvedOptions, safeIo, setupApprovedGate, setupFinalizedGate } from './s7-startup-gate-test-fixture';
import { publicArtifact } from './s7-startup-gate-test-artifacts';
describe('S7 packaged Main startup exclusivity gate', () => {
it('keeps the gate ACL safe but rejects an unsafe authority DB under SQLite takeover', () => {
    const fixture = setupApprovedGate();
    const options = approvedOptions(fixture);
    const startup = enforceS7MainStartupGate(options);
    if (startup.mode !== 'S7_APPROVED_CHILD')
        throw new Error('synthetic S7 gate was not admitted');
    const safeInspector = fixture.safeIo.inspectWindowsPathSecurity;
    const inspectWindowsPathSecurity = vi.fn((filePath: string, type: 'file' | 'directory', label: string) => {
        if (path.resolve(filePath) === path.resolve(fixture.databasePath)) {
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
    });
    expect(() => initGuardedExistingSqlite(fixture.databasePath, ({ database, resolvedPath }) => completeS7MainStartupAdmission({
        startup,
        database,
        resolvedDatabasePath: resolvedPath,
        executablePath: fixture.executablePath,
        mainModulePath: fixture.mainModulePath,
        io: { ...options.io, inspectWindowsPathSecurity },
    }))).toThrow(/Authority database.*ACL\/owner proof failed/);
    const unchanged = new Database(fixture.databasePath, { readonly: true, fileMustExist: true });
    try {
        expect(unchanged.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name = 'schema_migrations'
      `).get()).toEqual({ count: 0 });
    }
    finally {
        unchanged.close();
    }
});

it('blocks replay when the one-time admission receipt already exists', () => {
    const fixture = setupApprovedGate();
    enforceS7MainStartupGate(approvedOptions(fixture));
    expect(() => enforceS7MainStartupGate(approvedOptions(fixture))).toThrow(/S7_STARTUP_GATE_REPLAY_BLOCKED/);
});

it('rechecks the ACTIVE gate after acquiring the single-instance lock', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-normal-race-'));
    roots.push(root);
    const canonicalUserDataDir = path.join(root, 'Roaming', '@amazon-ai-ops', 'desktop');
    const activePath = path.join(canonicalUserDataDir, S7_STARTUP_GATE_DIRECTORY, S7_STARTUP_GATE_ACTIVE_FILE);
    let active = false;
    expect(() => enforceS7MainStartupGate({
        app: {
            requestSingleInstanceLock: () => {
                active = true;
                return true;
            },
        },
        currentUserDataDir: canonicalUserDataDir,
        canonicalUserDataDir,
        evidenceUserDataIdentity: { mode: null, overridden: false, userDataDir: null },
        isPackaged: true,
        executablePath: path.join(root, 'package.exe'),
        mainModulePath: path.join(root, 'index.js'),
        platform: 'win32',
        env: {},
        io: {
            existsSync: (filePath) => filePath === activePath && active,
        },
    })).toThrow(/S7_STARTUP_GATE_RACE_BLOCKED/);
});

it('rechecks all gate and authority identities after acquiring the lock', () => {
    const fixture = setupApprovedGate();
    const original = S7_STARTUP_GATE_TESTING.defaultReadStableFile;
    let activeReads = 0;
    const readStableFile = vi.fn((filePath: string, label: string, options?: {
        captureContents?: boolean;
        maxBytes?: number;
    }) => {
        const result = original(filePath, label, options);
        if (path.resolve(filePath) === path.resolve(fixture.activePath)) {
            activeReads += 1;
            if (activeReads === 2) {
                return { ...result, sha256: 'F'.repeat(64) };
            }
        }
        return result;
    });
    expect(() => enforceS7MainStartupGate({
        ...approvedOptions(fixture),
        io: { ...fixture.safeIo, readStableFile },
    })).toThrow(/ACTIVE gate file identity differs|changed while/);
});

it('admits an ordinary no-gate instance only after taking the Electron lock', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-normal-'));
    roots.push(root);
    const canonicalUserDataDir = path.join(root, 'Roaming', '@amazon-ai-ops', 'desktop');
    const requestSingleInstanceLock = vi.fn(() => true);
    const result = enforceS7MainStartupGate({
        app: { requestSingleInstanceLock },
        currentUserDataDir: canonicalUserDataDir,
        canonicalUserDataDir,
        evidenceUserDataIdentity: { mode: null, overridden: false, userDataDir: null },
        isPackaged: true,
        executablePath: path.join(root, 'package.exe'),
        mainModulePath: path.join(root, 'index.js'),
        platform: 'win32',
        env: {},
    });
    expect(result).toEqual({
        mode: 'NORMAL',
        admitted: true,
        singleInstanceLockAcquired: true,
        canonicalUserDataDir: path.resolve(canonicalUserDataDir),
    });
    expect(requestSingleInstanceLock).toHaveBeenCalledOnce();
});

it('protects and verifies each fresh authority path before it is trusted', () => {
    const io = safeIo();
    const target = path.join('C:\\authority', 'amazon-ai-ops.db');
    protectFreshS7AuthorityPath(target, 'file', 'Fresh authority database', io);
    expect(io.protectWindowsPath).toHaveBeenCalledWith(path.resolve(target), 'file');
    expect(io.inspectWindowsPathSecurity).toHaveBeenCalledWith(path.resolve(target), 'file', 'Fresh authority database');
});

it('fails closed when a fresh authority path remains inherited', () => {
    const io = safeIo();
    io.inspectWindowsPathSecurity.mockReturnValue({
        passed: false,
        path: path.resolve('C:\\authority', 'amazon-ai-ops.db'),
        type: 'file',
        ownerSid: 'S-1-5-21-synthetic',
        currentUserSid: 'S-1-5-21-synthetic',
        inheritanceProtected: false,
        unauthorizedRules: ['S-1-5-21-synthetic:Allow:2032127:True'],
    });
    expect(() => protectFreshS7AuthorityPath(path.join('C:\\authority', 'amazon-ai-ops.db'), 'file', 'Fresh authority database', io)).toThrow(/S7_STARTUP_GATE_ACL_UNTRUSTED/);
});

it('blocks an existing no-ACTIVE v0 database before ordinary startup can auto-migrate it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-normal-legacy-'));
    roots.push(root);
    const canonicalUserDataDir = path.join(root, 'Roaming', '@amazon-ai-ops', 'desktop');
    fs.mkdirSync(canonicalUserDataDir, { recursive: true });
    const databasePath = path.join(canonicalUserDataDir, 'amazon-ai-ops.db');
    const legacy = new Database(databasePath);
    legacy.exec('CREATE TABLE legacy_probe (id INTEGER PRIMARY KEY)');
    legacy.close();
    const requestSingleInstanceLock = vi.fn(() => true);
    expect(() => enforceS7MainStartupGate({
        app: { requestSingleInstanceLock },
        currentUserDataDir: canonicalUserDataDir,
        canonicalUserDataDir,
        evidenceUserDataIdentity: { mode: null, overridden: false, userDataDir: null },
        isPackaged: true,
        executablePath: path.join(root, 'package.exe'),
        mainModulePath: path.join(root, 'index.js'),
        platform: 'win32',
        env: {},
        io: safeIo(),
    })).toThrow(/S7_STARTUP_GATE_LEGACY_DATABASE_BLOCKED/);
    expect(requestSingleInstanceLock).not.toHaveBeenCalled();
    const unchanged = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
        expect(unchanged.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name = 'schema_migrations'
      `).get()).toEqual({ count: 0 });
    }
    finally {
        unchanged.close();
    }
});

it('blocks a stale fake no-ACTIVE database whose only migration row claims version 9', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-normal-fake-v9-'));
    roots.push(root);
    const canonicalUserDataDir = path.join(root, 'Roaming', '@amazon-ai-ops', 'desktop');
    fs.mkdirSync(canonicalUserDataDir, { recursive: true });
    const databasePath = path.join(canonicalUserDataDir, 'amazon-ai-ops.db');
    const fake = new Database(databasePath);
    fake.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        status TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, checksum, status)
      VALUES (9, 'fake-v9', '${'F'.repeat(64)}', 'applied');
    `);
    fake.close();
    const before = S7_STARTUP_GATE_TESTING.defaultReadStableFile(databasePath, 'fake v9 authority before startup');
    const requestSingleInstanceLock = vi.fn(() => true);
    expect(() => enforceS7MainStartupGate({
        app: { requestSingleInstanceLock },
        currentUserDataDir: canonicalUserDataDir,
        canonicalUserDataDir,
        evidenceUserDataIdentity: { mode: null, overridden: false, userDataDir: null },
        isPackaged: true,
        executablePath: path.join(root, 'package.exe'),
        mainModulePath: path.join(root, 'index.js'),
        platform: 'win32',
        env: {},
        io: safeIo(),
    })).toThrow(/S7_STARTUP_GATE_LEGACY_DATABASE_BLOCKED/);
    expect(requestSingleInstanceLock).not.toHaveBeenCalled();
    const after = S7_STARTUP_GATE_TESTING.defaultReadStableFile(databasePath, 'fake v9 authority after blocked startup');
    expect(publicArtifact(after)).toEqual(publicArtifact(before));
});

it('admits a complete no-ACTIVE v11 authority only after matching full proofs before and after lock', () => {
    const state = setupFinalizedGate();
    fs.rmSync(state.fixture.gateDirectory, { recursive: true, force: true });
    const inspectPostMigrationAuthority = vi.fn(S7_STARTUP_GATE_TESTING.defaultInspectPostMigrationAuthority);
    const readAuthoritySchemaVersion = vi.fn(() => {
        throw new Error('MAX(version) shortcut must not be used');
    });
    const requestSingleInstanceLock = vi.fn(() => true);
    const result = enforceS7MainStartupGate({
        ...state.normalOptions(),
        app: { requestSingleInstanceLock },
        env: {},
        io: {
            ...state.fixture.safeIo,
            inspectPostMigrationAuthority,
            readAuthoritySchemaVersion,
        },
    });
    expect(result.mode).toBe('NORMAL');
    expect(requestSingleInstanceLock).toHaveBeenCalledOnce();
    expect(inspectPostMigrationAuthority).toHaveBeenCalledTimes(2);
    expect(readAuthoritySchemaVersion).not.toHaveBeenCalled();
});

it('fails before initialization when the Electron single-instance lock is unavailable', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-lock-denied-'));
    roots.push(root);
    const canonicalUserDataDir = path.join(root, 'Roaming', '@amazon-ai-ops', 'desktop');
    expect(() => enforceS7MainStartupGate({
        app: { requestSingleInstanceLock: () => false },
        currentUserDataDir: canonicalUserDataDir,
        canonicalUserDataDir,
        evidenceUserDataIdentity: { mode: null, overridden: false, userDataDir: null },
        isPackaged: true,
        executablePath: path.join(root, 'package.exe'),
        mainModulePath: path.join(root, 'index.js'),
        platform: 'win32',
        env: {},
    })).toThrow(/S7_SINGLE_INSTANCE_LOCK_DENIED/);
});

it('allows only isolated evidence userData without reading canonical gate or DB', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-evidence-'));
    roots.push(root);
    const canonicalUserDataDir = path.join(root, 'Roaming', '@amazon-ai-ops', 'desktop');
    const evidenceUserDataDir = path.join(root, 'D-Temp', 'amazon-ai-ops-package-ui', 'run-1');
    fs.mkdirSync(evidenceUserDataDir, { recursive: true });
    const existsSync = vi.fn(() => {
        throw new Error('canonical gate must not be inspected by evidence mode');
    });
    const readStableFile = vi.fn(() => {
        throw new Error('canonical DB must not be read by evidence mode');
    });
    const result = enforceS7MainStartupGate({
        app: { requestSingleInstanceLock: () => true },
        currentUserDataDir: evidenceUserDataDir,
        canonicalUserDataDir,
        evidenceUserDataIdentity: {
            mode: 'package-ui',
            overridden: true,
            userDataDir: evidenceUserDataDir,
        },
        isPackaged: true,
        executablePath: path.join(root, 'package.exe'),
        mainModulePath: path.join(root, 'index.js'),
        platform: 'win32',
        env: {},
        io: { existsSync, readStableFile },
    });
    expect(result).toMatchObject({
        mode: 'EVIDENCE_ISOLATED',
        evidenceUserDataDir: path.resolve(evidenceUserDataDir),
    });
    expect(existsSync).not.toHaveBeenCalled();
    expect(readStableFile).not.toHaveBeenCalled();
});

it('rejects evidence mode pointed at canonical userData or carrying gate authority', () => {
    const fixture = setupApprovedGate();
    expect(() => enforceS7MainStartupGate({
        ...approvedOptions(fixture),
        evidenceUserDataIdentity: {
            mode: 'package-ui',
            overridden: true,
            userDataDir: fixture.canonicalUserDataDir,
        },
    })).toThrow(/S7_EVIDENCE_USER_DATA_NOT_ISOLATED/);
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 's7-evidence-gate-env-'));
    roots.push(isolated);
    expect(() => enforceS7MainStartupGate({
        ...approvedOptions(fixture),
        currentUserDataDir: isolated,
        evidenceUserDataIdentity: {
            mode: 'package-ui',
            overridden: true,
            userDataDir: isolated,
        },
    })).toThrow(/S7_EVIDENCE_USER_DATA_NOT_ISOLATED/);
});
});
