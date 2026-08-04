import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initGuardedExistingSqlite } from '@amazon-ai-ops/local-db/src/sqlite/db';
import {
  STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION,
  STORE_PROVIDER_IDENTITY_UNIQUE_INDEX,
} from '@amazon-ai-ops/local-db/src/sqlite/migrations';
import {
  S7_STARTUP_GATE_ACTIVE_FILE,
  S7_STARTUP_GATE_ACTIVE_KIND,
  S7_STARTUP_GATE_ACTIVE_SCHEMA,
  S7_STARTUP_GATE_ADMISSION_FILE,
  S7_STARTUP_GATE_BOUND_FILE,
  S7_STARTUP_GATE_BOUND_KIND,
  S7_STARTUP_GATE_BOUND_SCHEMA,
  S7_STARTUP_GATE_CLOSED_FILE,
  S7_STARTUP_GATE_DIRECTORY,
  S7_STARTUP_GATE_ENV,
  S7_STARTUP_GATE_FINALIZED_FILE,
  S7_STARTUP_GATE_HANDOFF_READY_FILE,
  S7_STARTUP_GATE_HANDOFF_RELEASED_FILE,
  S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE,
  S7_STARTUP_GATE_TESTING,
  completeS7MainStartupAdmission,
  enforceS7MainStartupGate,
  type S7StableFileArtifact,
} from './s7-migration-startup-gate';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function write(filePath: string, contents: string | object): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`,
  );
}

function publicArtifact(
  artifact: ReturnType<typeof S7_STARTUP_GATE_TESTING.defaultReadStableFile>,
) {
  return {
    realPath: artifact.realPath,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    identity: { ...artifact.identity },
  };
}

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
    inspectWindowsPathSecurity: vi.fn((
      filePath: string,
      type: 'file' | 'directory',
      _label?: string,
      _trustedShell?: typeof shell,
    ) => ({
      passed: true,
      path: path.resolve(filePath),
      type,
      ownerSid: 'S-1-5-21-synthetic',
      currentUserSid: 'S-1-5-21-synthetic',
      inheritanceProtected: true,
      unauthorizedRules: [],
    })),
    protectWindowsPath: vi.fn(),
    inspectTrustedPowerShell: vi.fn(() => shell),
    shell,
  };
}

function setupApprovedGate() {
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
  const intentPath = path.join(
    canonicalUserDataDir,
    '.s7-live-migration-launch-intents',
    'approved.intent.json',
  );
  write(executablePath, 'synthetic-executable');
  write(mainModulePath, 'synthetic-main');
  fs.mkdirSync(canonicalUserDataDir, { recursive: true });
  const legacy = new Database(databasePath);
  legacy.exec('CREATE TABLE legacy_probe (id INTEGER PRIMARY KEY, value TEXT)');
  legacy.close();
  write(intentPath, '{"approved":true}\n');
  fs.mkdirSync(gateDirectory);

  const executable = S7_STARTUP_GATE_TESTING.defaultReadStableFile(
    executablePath,
    'synthetic executable',
  );
  const main = S7_STARTUP_GATE_TESTING.defaultReadStableFile(mainModulePath, 'synthetic Main');
  const database = S7_STARTUP_GATE_TESTING.defaultReadStableFile(
    databasePath,
    'synthetic database',
  );
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
        if (released || !fs.existsSync(fixture.handoffReadyPath)) return;
        const activeDocument = JSON.parse(fs.readFileSync(fixture.activePath, 'utf8'));
        const active = S7_STARTUP_GATE_TESTING.defaultReadStableFile(
          fixture.activePath,
          'synthetic ACTIVE',
        );
        const bound = S7_STARTUP_GATE_TESTING.defaultReadStableFile(
          fixture.boundPath,
          'synthetic BOUND',
        );
        const ready = S7_STARTUP_GATE_TESTING.defaultReadStableFile(
          fixture.handoffReadyPath,
          'synthetic HANDOFF_READY',
        );
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
  const initialized = initGuardedExistingSqlite(
    fixture.databasePath,
    ({ database, resolvedPath }) => completeS7MainStartupAdmission({
      startup,
      database,
      resolvedDatabasePath: resolvedPath,
      executablePath: fixture.executablePath,
      mainModulePath: fixture.mainModulePath,
      now: () => new Date('2026-07-30T01:00:04.000Z'),
      io: migrationOptions.io,
    }),
  );
  initialized.database.pragma('wal_checkpoint(TRUNCATE)');
  initialized.database.pragma('journal_mode = DELETE');
  initialized.database.close();

  const activeDocument = JSON.parse(fs.readFileSync(fixture.activePath, 'utf8'));
  const active = S7_STARTUP_GATE_TESTING.defaultReadStableFile(
    fixture.activePath,
    'finalized fixture ACTIVE',
  );
  const bound = S7_STARTUP_GATE_TESTING.defaultReadStableFile(
    fixture.boundPath,
    'finalized fixture BOUND',
  );
  const handoffReady = S7_STARTUP_GATE_TESTING.defaultReadStableFile(
    fixture.handoffReadyPath,
    'finalized fixture READY',
  );
  const handoffReleased = S7_STARTUP_GATE_TESTING.defaultReadStableFile(
    fixture.handoffReleasedPath,
    'finalized fixture RELEASED',
  );
  const admission = S7_STARTUP_GATE_TESTING.defaultReadStableFile(
    fixture.admissionPath,
    'finalized fixture ADMISSION',
  );
  const database = S7_STARTUP_GATE_TESTING.defaultReadStableFile(
    fixture.databasePath,
    'finalized fixture database',
  );
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
  const closed = S7_STARTUP_GATE_TESTING.defaultReadStableFile(
    fixture.closedPath,
    'finalized fixture CLOSED',
  );

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
  const external = Object.fromEntries(
    Object.entries(externalPaths).map(([name, filePath]) => [
      name,
      publicArtifact(S7_STARTUP_GATE_TESTING.defaultReadStableFile(
        filePath,
        `finalized fixture ${name}`,
      )),
    ]),
  ) as Record<keyof typeof externalPaths, ReturnType<typeof publicArtifact>>;
  const authority = S7_STARTUP_GATE_TESTING.defaultInspectPostMigrationAuthority(
    fixture.databasePath,
  );
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
    finalizationPayloadSha256: S7_STARTUP_GATE_TESTING.sha256(
      S7_STARTUP_GATE_TESTING.stableJson(finalizedBase),
    ),
  });

  const completionPath = path.join(
    fixture.gateDirectory,
    S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE,
  );
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
      inspectPostMigrationAuthority:
        S7_STARTUP_GATE_TESTING.defaultInspectPostMigrationAuthority,
      writeProtectedExclusiveJson: (filePath: string, value: unknown) => write(
        filePath,
        value as object,
      ),
    },
  });
  return {
    fixture,
    completionPath,
    authority,
    normalOptions,
  };
}

describe('S7 packaged Main startup exclusivity gate', () => {
  it('streams large package/DB artifacts while keeping JSON capture bounded', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-main-gate-large-artifact-'));
    roots.push(root);
    const largeFile = path.join(root, 'large-artifact.bin');
    fs.writeFileSync(largeFile, Buffer.alloc(2 * 1024 * 1024, 0x5a));

    expect(S7_STARTUP_GATE_TESTING.defaultReadStableFile(
      largeFile,
      'large package artifact',
    )).toMatchObject({
      sizeBytes: 2 * 1024 * 1024,
      sha256: expect.stringMatching(/^[A-F0-9]{64}$/),
      contents: undefined,
    });
    expect(() => S7_STARTUP_GATE_TESTING.defaultReadStableFile(
      largeFile,
      'oversized gate JSON',
      { captureContents: true, maxBytes: 1024 * 1024 },
    )).toThrow(/bounded JSON contract/);
  });

  it.runIf(process.platform === 'win32')(
    'creates and verifies the protected Windows ACL used by the real startup gate',
    () => {
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

      expect(S7_STARTUP_GATE_TESTING.defaultInspectWindowsPathSecurity(
        gateDirectory,
        'directory',
        'synthetic gate directory',
      )).toMatchObject({
        passed: true,
        path: path.resolve(gateDirectory),
        type: 'directory',
        inheritanceProtected: true,
      });
      expect(S7_STARTUP_GATE_TESTING.defaultInspectWindowsPathSecurity(
        activePath,
        'file',
        'synthetic ACTIVE receipt',
      )).toMatchObject({
        passed: true,
        path: path.resolve(activePath),
        type: 'file',
        inheritanceProtected: true,
      });
    },
  );

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
    if (result.mode !== 'S7_APPROVED_CHILD') throw new Error('synthetic S7 gate was not admitted');
    fixture.safeIo.inspectTrustedPowerShell.mockClear();
    fixture.safeIo.inspectWindowsPathSecurity.mockClear();
    const initialized = initGuardedExistingSqlite(
      fixture.databasePath,
      ({ database, resolvedPath }) => completeS7MainStartupAdmission({
        startup: result,
        database,
        resolvedDatabasePath: resolvedPath,
        executablePath: fixture.executablePath,
        mainModulePath: fixture.mainModulePath,
        now: () => new Date('2026-07-30T01:00:04.000Z'),
        io: options.io,
      }),
    );
    initialized.database.close();
    expect(options.app.requestSingleInstanceLock).toHaveBeenCalledOnce();
    expect(fixture.safeIo.inspectTrustedPowerShell).toHaveBeenCalledOnce();
    expect(
      fixture.safeIo.inspectWindowsPathSecurity.mock.calls.map((call) => call[2]),
    ).toEqual([
      'Authority database under SQLite exclusive lock',
      'ACTIVE gate',
      'BOUND gate',
      'HANDOFF_READY',
      'HANDOFF_RELEASED',
      'Admission launch intent',
      'S7 Main admission receipt',
    ]);
    expect(
      fixture.safeIo.inspectWindowsPathSecurity.mock.calls.every(
        (call) => S7_STARTUP_GATE_TESTING.stableJson(call[3])
          === S7_STARTUP_GATE_TESTING.stableJson(fixture.safeIo.shell),
      ),
    ).toBe(true);
    expect(fixture.safeIo.protectWindowsPath).toHaveBeenCalledWith(
      fixture.admissionPath,
      'file',
    );
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
      intent: publicArtifact(
        S7_STARTUP_GATE_TESTING.defaultReadStableFile(fixture.intentPath, 'intent'),
      ),
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
    if (startup.mode !== 'S7_APPROVED_CHILD') throw new Error('synthetic S7 gate was not admitted');
    const databaseBefore = publicArtifact(
      S7_STARTUP_GATE_TESTING.defaultReadStableFile(
        fixture.databasePath,
        'authority database before shell drift',
      ),
    );
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
      const initialized = initGuardedExistingSqlite(
        fixture.databasePath,
        ({ database, resolvedPath }) => completeS7MainStartupAdmission({
          startup,
          database,
          resolvedDatabasePath: resolvedPath,
          executablePath: fixture.executablePath,
          mainModulePath: fixture.mainModulePath,
          io: {
            ...options.io,
            inspectTrustedPowerShell: () => driftedShell,
          },
        }),
      );
      opened = initialized.database;
    } catch (error) {
      failure = error;
    } finally {
      opened?.close();
    }

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toMatch(/S7_STARTUP_GATE_SHELL_UNTRUSTED|trusted shell.*drift/i);
    expect(fs.existsSync(fixture.admissionPath)).toBe(false);
    const databaseAfter = publicArtifact(
      S7_STARTUP_GATE_TESTING.defaultReadStableFile(
        fixture.databasePath,
        'authority database after blocked shell drift',
      ),
    );
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
    } finally {
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
    const inspectWindowsPathSecurity = vi.fn(
      state.fixture.safeIo.inspectWindowsPathSecurity,
    );
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
    expect(
      inspectWindowsPathSecurity.mock.calls.every(
        (call) => JSON.stringify(call[3]) === JSON.stringify(servicedShell),
      ),
    ).toBe(true);
    expect(buildAppContentManifest).not.toHaveBeenCalled();
    const readonly = new Database(state.fixture.databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      expect(readonly.prepare(`
        SELECT value FROM app_settings WHERE key = ?
      `).get('post-migration-business-row')).toEqual({ value: '{"enabled":true}' });
    } finally {
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
          throw new Error(
            'S7_STARTUP_GATE_SHELL_UNTRUSTED: current PowerShell ACL is unsafe',
          );
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
    expect(() => enforceS7MainStartupGate(databaseDrift.normalOptions())).toThrow(
      /exact accepted database snapshot|BINDING_MISMATCH/i,
    );
    expect(fs.existsSync(databaseDrift.completionPath)).toBe(false);

    const packageDrift = setupFinalizedGate();
    fs.writeFileSync(packageDrift.fixture.mainModulePath, 'drift-before-first-admission');
    expect(() => enforceS7MainStartupGate(packageDrift.normalOptions())).toThrow(
      /package differs from the migration package|BINDING_MISMATCH/i,
    );
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
    expect(() => enforceS7MainStartupGate(replaced.normalOptions())).toThrow(
      /database.*identity|volume\/file identity|S7_STARTUP_GATE_BINDING_MISMATCH/i,
    );

    const aclDrift = setupFinalizedGate();
    enforceS7MainStartupGate(aclDrift.normalOptions());
    const aclOptions = aclDrift.normalOptions();
    const safeInspector = aclDrift.fixture.safeIo.inspectWindowsPathSecurity;
    expect(() => enforceS7MainStartupGate({
      ...aclOptions,
      io: {
        ...aclOptions.io,
        inspectWindowsPathSecurity: (
          filePath: string,
          type: 'file' | 'directory',
          label?: string,
        ) => {
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
      expect(() => enforceS7MainStartupGate(ledgerDrift.normalOptions())).toThrow(
        /AUTHORITY_DRIFT|migration ledger|authority schema/i,
      );
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
      expect(() => enforceS7MainStartupGate(schemaDrift.normalOptions())).toThrow(
        /AUTHORITY_DRIFT|exact schema contract|authority schema/i,
      );
    }
  });

  it('holds on completion half-write/tamper and validates the entire immutable chain', () => {
    const halfWrite = setupFinalizedGate();
    enforceS7MainStartupGate(halfWrite.normalOptions());
    fs.writeFileSync(halfWrite.completionPath, '{"kind":');
    expect(() => enforceS7MainStartupGate(halfWrite.normalOptions())).toThrow(
      /valid JSON|completion/i,
    );

    const tampered = setupFinalizedGate();
    enforceS7MainStartupGate(tampered.normalOptions());
    const marker = JSON.parse(fs.readFileSync(tampered.completionPath, 'utf8'));
    marker.unexpected = true;
    write(tampered.completionPath, marker);
    expect(() => enforceS7MainStartupGate(tampered.normalOptions())).toThrow(
      /completion marker shape|COMPLETION_UNTRUSTED/i,
    );

    const aliased = setupFinalizedGate();
    enforceS7MainStartupGate(aliased.normalOptions());
    fs.linkSync(
      aliased.completionPath,
      path.join(aliased.fixture.gateDirectory, 'completion-alias.json'),
    );
    expect(() => enforceS7MainStartupGate(aliased.normalOptions())).toThrow(
      /exactly one filesystem link|PATH_UNSAFE/i,
    );

    const chainDrift = setupFinalizedGate();
    fs.appendFileSync(chainDrift.fixture.closedPath, '\n');
    expect(() => enforceS7MainStartupGate(chainDrift.normalOptions())).toThrow(
      /FINALIZED CLOSED binding drifted|binding/i,
    );

    const externalUnknown = setupFinalizedGate();
    const finalized = JSON.parse(
      fs.readFileSync(externalUnknown.fixture.finalizedPath, 'utf8'),
    );
    fs.rmSync(finalized.acceptanceReceipt.realPath);
    expect(() => enforceS7MainStartupGate(externalUnknown.normalOptions())).toThrow();
    expect(fs.existsSync(externalUnknown.completionPath)).toBe(false);

    const sidecarUnknown = setupFinalizedGate();
    fs.writeFileSync(`${sidecarUnknown.fixture.databasePath}-wal`, 'untrusted-wal');
    expect(() => enforceS7MainStartupGate(sidecarUnknown.normalOptions())).toThrow(
      /sidecar-free accepted database|BINDING_MISMATCH/i,
    );
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
    expect(enforceS7MainStartupGate(beforeWrite.normalOptions()).mode).toBe(
      'NORMAL_POST_MIGRATION',
    );

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
    const completionPath = path.join(
      fixture.gateDirectory,
      S7_STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE,
    );
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
    expect(() => enforceS7MainStartupGate(approvedOptions(executableCase))).toThrow(
      /executable no longer matches/i,
    );

    const intentCase = setupApprovedGate();
    fs.writeFileSync(intentCase.intentPath, '{"approved":false}\n');
    expect(() => enforceS7MainStartupGate(approvedOptions(intentCase))).toThrow(
      /intent no longer matches/i,
    );

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
    expect(readStableFile).not.toHaveBeenCalledWith(
      fixture.databasePath,
      expect.any(String),
    );
  });

  it('keeps the gate ACL safe but rejects an unsafe authority DB under SQLite takeover', () => {
    const fixture = setupApprovedGate();
    const options = approvedOptions(fixture);
    const startup = enforceS7MainStartupGate(options);
    if (startup.mode !== 'S7_APPROVED_CHILD') throw new Error('synthetic S7 gate was not admitted');
    const safeInspector = fixture.safeIo.inspectWindowsPathSecurity;
    const inspectWindowsPathSecurity = vi.fn((
      filePath: string,
      type: 'file' | 'directory',
      label: string,
    ) => {
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

    expect(() => initGuardedExistingSqlite(
      fixture.databasePath,
      ({ database, resolvedPath }) => completeS7MainStartupAdmission({
        startup,
        database,
        resolvedDatabasePath: resolvedPath,
        executablePath: fixture.executablePath,
        mainModulePath: fixture.mainModulePath,
        io: { ...options.io, inspectWindowsPathSecurity },
      }),
    )).toThrow(/Authority database.*ACL\/owner proof failed/);

    const unchanged = new Database(fixture.databasePath, { readonly: true, fileMustExist: true });
    try {
      expect(unchanged.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name = 'schema_migrations'
      `).get()).toEqual({ count: 0 });
    } finally {
      unchanged.close();
    }
  });

  it('blocks replay when the one-time admission receipt already exists', () => {
    const fixture = setupApprovedGate();
    enforceS7MainStartupGate(approvedOptions(fixture));
    expect(() => enforceS7MainStartupGate(approvedOptions(fixture))).toThrow(
      /S7_STARTUP_GATE_REPLAY_BLOCKED/,
    );
  });

  it('rechecks the ACTIVE gate after acquiring the single-instance lock', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-normal-race-'));
    roots.push(root);
    const canonicalUserDataDir = path.join(root, 'Roaming', '@amazon-ai-ops', 'desktop');
    const activePath = path.join(
      canonicalUserDataDir,
      S7_STARTUP_GATE_DIRECTORY,
      S7_STARTUP_GATE_ACTIVE_FILE,
    );
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
    const readStableFile = vi.fn((
      filePath: string,
      label: string,
      options?: { captureContents?: boolean; maxBytes?: number },
    ) => {
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
    } finally {
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
    const before = S7_STARTUP_GATE_TESTING.defaultReadStableFile(
      databasePath,
      'fake v9 authority before startup',
    );
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
    const after = S7_STARTUP_GATE_TESTING.defaultReadStableFile(
      databasePath,
      'fake v9 authority after blocked startup',
    );
    expect(publicArtifact(after)).toEqual(publicArtifact(before));
  });

  it('admits a complete no-ACTIVE v11 authority only after matching full proofs before and after lock', () => {
    const state = setupFinalizedGate();
    fs.rmSync(state.fixture.gateDirectory, { recursive: true, force: true });
    const inspectPostMigrationAuthority = vi.fn(
      S7_STARTUP_GATE_TESTING.defaultInspectPostMigrationAuthority,
    );
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

  it('keeps the Main integration gate before initSqlite, browser runtime, and window creation', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const gateCall = source.indexOf('enforceS7MainStartupGate(');
    const initSqliteCall = source.indexOf('state.db = initSqlite(');
    const createWindowCall = source.indexOf('createWindow();', initSqliteCall);
    expect(gateCall).toBeGreaterThan(0);
    expect(gateCall).toBeLessThan(initSqliteCall);
    expect(gateCall).toBeLessThan(createWindowCall);
    expect(source).toContain('app.requestSingleInstanceLock');
    expect(source).toContain("app.on('second-instance'");
  });
});
