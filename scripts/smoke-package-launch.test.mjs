import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  PORTABLE_START_TIMEOUT_MS,
  TASKKILL_COMMAND_TIMEOUT_MS,
  WINDOWS_PROCESS_COMMAND_TIMEOUT_MS,
  cleanupVerifiedProcessTrees,
  packagedRendererPathForExecutable,
  readPackageLaunchWindowReadyEvidence,
  selectVerifiedPortableRuntimeProcess,
  validatePackageLaunchSmokeEvidence,
  validatePackageLaunchWindowReadyMarker,
} = require('./smoke-package-launch.js');

const generatedAt = new Date().toISOString();
const launchContractFixtureRoot = mkdtempSync(join(
  process.env.TEMP || 'D:\\Temp',
  'amazon-ai-ops-launch-contract-',
));
afterAll(() => rmSync(launchContractFixtureRoot, { force: true, recursive: true }));

function currentEvidence(overrides = {}) {
  return {
    passed: true,
    marker: {
      generatedAt,
      mode: 'package-launch-smoke',
      pid: 42,
      userDataDir: 'D:\\Temp\\amazon-ai-ops-test',
      ...overrides,
    },
  };
}

function processItem(overrides = {}) {
  return {
    CreationDate: generatedAt,
    ExecutablePath: 'C:\\Temp\\verified\\AmazonAIOpsAgent.exe',
    MainWindowHandle: 100,
    MainWindowTitle: 'Amazon AI Ops',
    Name: 'AmazonAIOpsAgent.exe',
    ParentProcessId: 1,
    ProcessId: 42,
    WindowVisible: true,
    ...overrides,
  };
}

function passingPackageLaunchEvidence() {
  const releaseDir = join(launchContractFixtureRoot, 'release');
  const unpackedUserData = join(launchContractFixtureRoot, 'user-data', 'win-unpacked');
  const portableUserData = join(launchContractFixtureRoot, 'user-data', 'portable');
  const unpackedExe = join(releaseDir, 'win-unpacked', 'AmazonAIOpsAgent.exe');
  const portableExe = join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
  const portableRuntimeExe = join(
    launchContractFixtureRoot,
    'portable-runtime',
    'AmazonAIOpsAgent.exe',
  );
  const writeCurrentFile = (filePath, content) => {
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, content);
    return filePath;
  };
  const currentArtifact = (filePath) => {
    const bytes = readFileSync(filePath);
    const stat = statSync(filePath);
    return {
      path: filePath,
      sizeBytes: stat.size,
      sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
      mtime: stat.mtime.toISOString(),
    };
  };
  const runtimeBytes = Buffer.from('verified packaged runtime fixture\n', 'utf8');
  writeCurrentFile(unpackedExe, runtimeBytes);
  writeCurrentFile(portableRuntimeExe, runtimeBytes);
  writeCurrentFile(portableExe, 'portable wrapper fixture\n');
  for (const executablePath of [unpackedExe, portableRuntimeExe]) {
    writeCurrentFile(packagedRendererPathForExecutable(executablePath), '<!doctype html>');
  }
  const buildCheck = ({
    kind,
    pid,
    userDataDir,
    executablePath,
    extra = {},
  }) => {
    const runtimeProcess = {
      processId: pid,
      parentProcessId: kind === 'portable' ? 900 : 0,
      name: 'AmazonAIOpsAgent.exe',
      executablePath,
      creationDate: generatedAt,
      mainWindowHandle: 100 + pid,
      mainWindowTitle: 'Amazon AI Ops Agent',
      windowVisible: true,
      proof: 'isolated-runtime-marker',
      notBeforeMs: Date.parse(generatedAt) - 1000,
    };
    const userDataMarker = {
      mode: 'package-launch-smoke',
      overridden: true,
      userDataDir,
      generatedAt,
      pid,
    };
    const userDataMarkerPath = writeCurrentFile(
      join(userDataDir, 'evidence-user-data-runtime.json'),
      `${JSON.stringify(userDataMarker, null, 2)}\n`,
    );
    const windowReadyMarker = {
      kind: 'package-launch-window-ready',
      schemaVersion: 1,
      pid,
      browserWindowId: 1,
      evidenceMode: 'package-launch-smoke',
      userDataDir,
      rendererUrl: pathToFileURL(packagedRendererPathForExecutable(executablePath)).href,
      generatedAt,
    };
    const windowReadyMarkerPath = writeCurrentFile(
      join(userDataDir, 'package-launch-window-ready.json'),
      `${JSON.stringify(windowReadyMarker, null, 2)}\n`,
    );
    const stdoutPath = writeCurrentFile(join(userDataDir, `${kind}.stdout.log`), '');
    const stderrPath = writeCurrentFile(join(userDataDir, `${kind}.stderr.log`), '');
    return {
      kind,
      ok: true,
      launchError: null,
      runtimeProcess,
      windowReadyEvidence: {
        artifact: currentArtifact(windowReadyMarkerPath),
        marker: windowReadyMarker,
        markerPath: windowReadyMarkerPath,
        passed: true,
        rendererPath: packagedRendererPathForExecutable(executablePath),
        state: 'valid',
        violations: [],
      },
      observationErrors: [],
      stdoutPath,
      stderrPath,
      processCleanup: {
        attempts: 1,
        identityViolations: [],
        killAttempts: [],
        passed: true,
        remaining: [],
        remainingCount: 0,
        reusedPids: [],
        snapshotError: null,
        treeErrors: [],
        unresolved: [],
      },
      userDataEvidence: {
        actualUserDataDir: userDataDir,
        expectedUserDataDir: userDataDir,
        passed: true,
        violations: [],
        marker: userDataMarker,
        markerError: null,
        markerPath: userDataMarkerPath,
      },
      ...extra,
    };
  };
  return {
    kind: 'package-launch-smoke',
    generatedAt,
    releaseDir,
    evidenceMode: 'package-launch-smoke',
    isolatedUserData: {
      unpacked: unpackedUserData,
      portable: portableUserData,
    },
    userDataOverrideBundleContract: { passed: true, violations: [] },
    artifacts: {
      unpacked: currentArtifact(unpackedExe),
      portable: currentArtifact(portableExe),
    },
    checks: [
      buildCheck({
        kind: 'win-unpacked',
        pid: 42,
        userDataDir: unpackedUserData,
        executablePath: unpackedExe,
        extra: {
          marker: '[App] window-created',
          pid: 42,
        },
      }),
      buildCheck({
        kind: 'portable',
        pid: 84,
        userDataDir: portableUserData,
        executablePath: portableRuntimeExe,
        extra: {
          launcherPid: 900,
          observedProcessCount: 1,
        },
      }),
    ],
    passed: true,
  };
}

describe('package launch smoke isolated runtime contract', () => {
  it('accepts a complete passing package-launch runtime proof', () => {
    expect(validatePackageLaunchSmokeEvidence(passingPackageLaunchEvidence())).toEqual({
      passed: true,
      violations: [],
    });
  });

  it('rejects a check that omits the native runtime process proof', () => {
    const evidence = passingPackageLaunchEvidence();
    delete evidence.checks[0].runtimeProcess;

    expect(validatePackageLaunchSmokeEvidence(evidence)).toMatchObject({
      passed: false,
      violations: expect.arrayContaining([
        expect.objectContaining({
          code: 'PACKAGE_LAUNCH_RUNTIME_PROCESS_INVALID',
          path: 'checks.win-unpacked.runtimeProcess',
        }),
      ]),
    });
  });

  it('rejects a check that omits the second-stage window-ready proof', () => {
    const evidence = passingPackageLaunchEvidence();
    delete evidence.checks[1].windowReadyEvidence;

    expect(validatePackageLaunchSmokeEvidence(evidence)).toMatchObject({
      passed: false,
      violations: expect.arrayContaining([
        expect.objectContaining({
          code: 'PACKAGE_LAUNCH_WINDOW_READY_INVALID',
          path: 'checks.portable.windowReadyEvidence',
        }),
      ]),
    });
  });

  it('rejects a check whose exact process tree was not cleaned', () => {
    const evidence = passingPackageLaunchEvidence();
    evidence.checks[0].processCleanup.passed = false;

    expect(validatePackageLaunchSmokeEvidence(evidence)).toMatchObject({
      passed: false,
      violations: expect.arrayContaining([
        expect.objectContaining({
          code: 'PACKAGE_LAUNCH_PROCESS_CLEANUP_INVALID',
          path: 'checks.win-unpacked.processCleanup',
        }),
      ]),
    });
  });

  it('rejects a check that recorded any launch observation error', () => {
    const evidence = passingPackageLaunchEvidence();
    evidence.checks[1].observationErrors.push({ code: 'RUNTIME_WINDOW_QUERY_FAILED' });

    expect(validatePackageLaunchSmokeEvidence(evidence)).toMatchObject({
      passed: false,
      violations: expect.arrayContaining([
        expect.objectContaining({
          code: 'PACKAGE_LAUNCH_OBSERVATION_ERRORS_PRESENT',
          path: 'checks.portable.observationErrors',
        }),
      ]),
    });
  });

  it('rejects a check whose isolated userData marker is missing', () => {
    const evidence = passingPackageLaunchEvidence();
    delete evidence.checks[0].userDataEvidence.marker;

    expect(validatePackageLaunchSmokeEvidence(evidence)).toMatchObject({
      passed: false,
      violations: expect.arrayContaining([
        expect.objectContaining({
          code: 'PACKAGE_LAUNCH_USER_DATA_EVIDENCE_INVALID',
          path: 'checks.win-unpacked.userDataEvidence',
        }),
      ]),
    });
  });

  it('rejects missing top-level provenance and packaged override proof', () => {
    const evidence = passingPackageLaunchEvidence();
    delete evidence.generatedAt;
    delete evidence.userDataOverrideBundleContract;

    expect(validatePackageLaunchSmokeEvidence(evidence)).toMatchObject({
      passed: false,
      violations: expect.arrayContaining([
        expect.objectContaining({ code: 'PACKAGE_LAUNCH_GENERATED_AT_INVALID' }),
        expect.objectContaining({ code: 'PACKAGE_LAUNCH_USER_DATA_OVERRIDE_CONTRACT_INVALID' }),
      ]),
    });
  });

  it('rejects a self-declared passing check whose check result is missing', () => {
    const evidence = passingPackageLaunchEvidence();
    delete evidence.checks[1].ok;

    expect(validatePackageLaunchSmokeEvidence(evidence)).toMatchObject({
      passed: false,
      violations: expect.arrayContaining([
        expect.objectContaining({
          code: 'PACKAGE_LAUNCH_CHECK_RESULT_INVALID',
          path: 'checks.portable',
        }),
      ]),
    });
  });

  it('rejects artifact metadata tampering and a runtime PID that diverges from its marker', () => {
    const evidence = passingPackageLaunchEvidence();
    evidence.artifacts.portable.sha256 = 'not-a-sha256';
    evidence.checks[0].runtimeProcess.processId += 1;

    expect(validatePackageLaunchSmokeEvidence(evidence)).toMatchObject({
      passed: false,
      violations: expect.arrayContaining([
        expect.objectContaining({
          code: 'PACKAGE_LAUNCH_ARTIFACT_INVALID',
          path: 'artifacts.portable',
        }),
        expect.objectContaining({
          code: 'PACKAGE_LAUNCH_USER_DATA_EVIDENCE_INVALID',
          path: 'checks.win-unpacked.userDataEvidence',
        }),
        expect.objectContaining({
          code: 'PACKAGE_LAUNCH_WINDOW_READY_INVALID',
          path: 'checks.win-unpacked.windowReadyEvidence',
        }),
      ]),
    });
  });

  it('rejects a package artifact whose current bytes changed after evidence capture', () => {
    const evidence = passingPackageLaunchEvidence();
    writeFileSync(evidence.artifacts.portable.path, 'tampered portable wrapper\n');

    expect(validatePackageLaunchSmokeEvidence(evidence)).toMatchObject({
      passed: false,
      violations: expect.arrayContaining([
        expect.objectContaining({
          code: 'PACKAGE_LAUNCH_ARTIFACT_INVALID',
          path: 'artifacts.portable',
        }),
      ]),
    });
  });

  it('rejects deletion or current-byte tampering of either marker artifact', () => {
    const missingWindowMarker = passingPackageLaunchEvidence();
    rmSync(missingWindowMarker.checks[0].windowReadyEvidence.markerPath);

    expect(validatePackageLaunchSmokeEvidence(missingWindowMarker)).toMatchObject({
      passed: false,
      violations: expect.arrayContaining([
        expect.objectContaining({
          code: 'PACKAGE_LAUNCH_WINDOW_READY_INVALID',
          path: 'checks.win-unpacked.windowReadyEvidence',
        }),
      ]),
    });

    const tamperedUserDataMarker = passingPackageLaunchEvidence();
    writeFileSync(
      tamperedUserDataMarker.checks[1].userDataEvidence.markerPath,
      '{"mode":"package-launch-smoke","pid":999999}\n',
    );

    expect(validatePackageLaunchSmokeEvidence(tamperedUserDataMarker)).toMatchObject({
      passed: false,
      violations: expect.arrayContaining([
        expect.objectContaining({
          code: 'PACKAGE_LAUNCH_USER_DATA_EVIDENCE_INVALID',
          path: 'checks.portable.userDataEvidence',
        }),
      ]),
    });
  });

  it('rejects a portable runtime outside the observed launcher lineage', () => {
    const evidence = passingPackageLaunchEvidence();
    evidence.checks[1].runtimeProcess.parentProcessId = evidence.checks[1].launcherPid + 1;

    expect(validatePackageLaunchSmokeEvidence(evidence)).toMatchObject({
      passed: false,
      violations: expect.arrayContaining([
        expect.objectContaining({
          code: 'PACKAGE_LAUNCH_PORTABLE_LINEAGE_INVALID',
          path: 'checks.portable',
        }),
      ]),
    });
  });

  it('rejects portable extracted runtime bytes that do not match the unpacked package executable', () => {
    const evidence = passingPackageLaunchEvidence();
    writeFileSync(evidence.checks[1].runtimeProcess.executablePath, 'tampered runtime bytes\n');

    expect(validatePackageLaunchSmokeEvidence(evidence)).toMatchObject({
      passed: false,
      violations: expect.arrayContaining([
        expect.objectContaining({
          code: 'PACKAGE_LAUNCH_PORTABLE_LINEAGE_INVALID',
          path: 'checks.portable',
        }),
      ]),
    });
  });

  it('creates disjoint D-drive profiles and launches the portable wrapper detached without PowerShell pipes', () => {
    const source = readFileSync('scripts/smoke-package-launch.js', 'utf8');
    expect(source).toContain("path.join('D:\\\\Temp', 'amazon-ai-ops-package-launch-smoke', String(runId))");
    expect(source).toContain("unpacked: prepareIsolatedUserData('win-unpacked')");
    expect(source).toContain("portable: prepareIsolatedUserData('portable')");
    expect(source).toContain('launchUnpacked(unpackedExe, isolatedUserData.unpacked)');
    expect(source).toContain('launchPortable(portableExe, isolatedUserData.portable)');
    expect(source.match(/buildEvidenceUserDataEnv\(process\.env, PACKAGE_LAUNCH_SMOKE_MODE, userDataDir\)/g)).toHaveLength(2);
    expect(source).toMatch(
      /function launchUnpacked[\s\S]*?spawn\(exePath, \[\],[\s\S]*?windowsHide: false,[\s\S]*?stdio: \['ignore', 'pipe', 'pipe'\]/,
    );
    expect(source).toContain('detached: true');
    expect(source).toContain("stdio: 'ignore'");
    expect(source).not.toContain('Start-Process');
    expect(PORTABLE_START_TIMEOUT_MS).toBe(300_000);
  });

  it('uses bounded PowerShell process inspection without CIM and bounds taskkill too', () => {
    const source = readFileSync('scripts/smoke-package-launch.js', 'utf8');
    expect(WINDOWS_PROCESS_COMMAND_TIMEOUT_MS).toBeGreaterThan(0);
    expect(TASKKILL_COMMAND_TIMEOUT_MS).toBeGreaterThan(0);
    expect(source.match(/spawnSync\(POWERSHELL_EXECUTABLE/g)).toHaveLength(1);
    expect(source).toContain('timeout: WINDOWS_PROCESS_COMMAND_TIMEOUT_MS');
    expect(source).toContain('terminateTimedOutHelper(result)');
    expect(source).not.toContain('Get-CimInstance');
    expect(source.match(/spawnSync\('taskkill\.exe'/g)).toHaveLength(1);
    expect(source).toContain('timeout: TASKKILL_COMMAND_TIMEOUT_MS');
  });

  it('accepts the exact current marker PID only after its native window is created and visible', () => {
    const evidence = currentEvidence();
    const verified = selectVerifiedPortableRuntimeProcess(evidence, {
      processes: [
        processItem({ ProcessId: 41 }),
        processItem(),
      ],
    }, {
      allowedProcessIds: new Set([42]),
      expectedExecutablePath: 'C:\\Temp\\verified\\AmazonAIOpsAgent.exe',
      notBeforeMs: Date.parse(generatedAt) - 10,
    });

    expect(verified).toMatchObject({
      executablePath: 'C:\\Temp\\verified\\AmazonAIOpsAgent.exe',
      mainWindowHandle: 100,
      processId: 42,
      proof: 'isolated-runtime-marker',
      windowVisible: true,
    });
    expect(selectVerifiedPortableRuntimeProcess(evidence, {
      processes: [processItem({ MainWindowHandle: 0, WindowVisible: false })],
    }, {
      allowedProcessIds: new Set([42]),
      expectedExecutablePath: 'C:\\Temp\\verified\\AmazonAIOpsAgent.exe',
      notBeforeMs: Date.parse(generatedAt) - 10,
    })).toBeNull();
    expect(selectVerifiedPortableRuntimeProcess(evidence, {
      processes: [processItem({ WindowVisible: false })],
    }, {
      allowedProcessIds: new Set([42]),
      expectedExecutablePath: 'C:\\Temp\\verified\\AmazonAIOpsAgent.exe',
      notBeforeMs: Date.parse(generatedAt) - 10,
    })).toBeNull();
    expect(selectVerifiedPortableRuntimeProcess(currentEvidence({ generatedAt: null }), {
      processes: [processItem()],
    }, {
      allowedProcessIds: new Set([42]),
      expectedExecutablePath: 'C:\\Temp\\verified\\AmazonAIOpsAgent.exe',
    })).toBeNull();
  });

  it('rejects a stale process, a wrong executable path, or a marker PID outside the launched lineage', () => {
    const notBeforeMs = Date.parse(generatedAt) - 10;
    const evidence = currentEvidence();
    const expectedPath = 'C:\\Temp\\verified\\AmazonAIOpsAgent.exe';

    expect(selectVerifiedPortableRuntimeProcess(evidence, {
      processes: [processItem({ CreationDate: new Date(notBeforeMs - 60_000).toISOString() })],
    }, {
      allowedProcessIds: new Set([42]),
      expectedExecutablePath: expectedPath,
      notBeforeMs,
    })).toBeNull();
    expect(selectVerifiedPortableRuntimeProcess(evidence, {
      processes: [processItem({ ExecutablePath: 'C:\\Other\\AmazonAIOpsAgent.exe' })],
    }, {
      allowedProcessIds: new Set([42]),
      expectedExecutablePath: expectedPath,
      notBeforeMs,
    })).toBeNull();
    expect(selectVerifiedPortableRuntimeProcess(evidence, {
      processes: [processItem()],
    }, {
      allowedProcessIds: new Set([41]),
      expectedExecutablePath: expectedPath,
      notBeforeMs,
    })).toBeNull();
  });

  it('accepts only a current second-stage marker for the exact runtime PID, userData, and packaged renderer file', () => {
    const expectedExecutablePath = 'D:\\Temp\\portable-runtime\\AmazonAIOpsAgent.exe';
    const expectedRendererPath = packagedRendererPathForExecutable(expectedExecutablePath);
    const notBeforeMs = Date.parse(generatedAt) - 1000;
    const runtimeMarkerGeneratedAt = new Date(notBeforeMs + 100).toISOString();
    const marker = {
      kind: 'package-launch-window-ready',
      schemaVersion: 1,
      pid: 42,
      browserWindowId: 7,
      evidenceMode: 'package-launch-smoke',
      userDataDir: 'D:\\Temp\\amazon-ai-ops-test',
      rendererUrl: pathToFileURL(expectedRendererPath).href,
      generatedAt,
    };
    const options = {
      expectedPid: 42,
      expectedRendererPath,
      expectedUserDataDir: 'D:\\Temp\\amazon-ai-ops-test',
      notBeforeMs,
      runtimeMarkerGeneratedAt,
    };

    expect(validatePackageLaunchWindowReadyMarker(marker, options)).toMatchObject({
      passed: true,
      rendererPath: expectedRendererPath,
      violations: [],
    });
    expect(validatePackageLaunchWindowReadyMarker({
      ...marker,
      pid: 41,
    }, options).passed).toBe(false);
    expect(validatePackageLaunchWindowReadyMarker({
      ...marker,
      userDataDir: 'D:\\Temp\\amazon-ai-ops-other',
    }, options).passed).toBe(false);
    expect(validatePackageLaunchWindowReadyMarker({
      ...marker,
      rendererUrl: 'http://localhost:5173/',
    }, options).passed).toBe(false);
    expect(validatePackageLaunchWindowReadyMarker({
      ...marker,
      rendererUrl: pathToFileURL('D:\\Other\\renderer\\index.html').href,
    }, options).passed).toBe(false);
    expect(validatePackageLaunchWindowReadyMarker({
      ...marker,
      generatedAt: new Date(notBeforeMs - 60_000).toISOString(),
    }, options).passed).toBe(false);
  });

  it('reads a stable current marker file and binds the evidence artifact bytes', () => {
    const userDataDir = mkdtempSync('D:\\Temp\\amazon-ai-ops-smoke-marker-test-');
    try {
      const expectedExecutablePath = join(userDataDir, 'runtime', 'AmazonAIOpsAgent.exe');
      const expectedRendererPath = packagedRendererPathForExecutable(expectedExecutablePath);
      mkdirSync(join(expectedRendererPath, '..'), { recursive: true });
      writeFileSync(expectedRendererPath, '<!doctype html>', 'utf8');
      const notBeforeMs = Date.now() - 1000;
      const runtimeMarkerGeneratedAt = new Date(notBeforeMs + 100).toISOString();
      const markerOptions = {
        expectedPid: 42,
        expectedRendererPath,
        expectedUserDataDir: userDataDir,
        notBeforeMs,
        runtimeMarkerGeneratedAt,
      };
      expect(readPackageLaunchWindowReadyEvidence(userDataDir, markerOptions)).toMatchObject({
        passed: false,
        state: 'missing',
        violations: [{ code: 'WINDOW_READY_MARKER_MISSING' }],
      });
      const marker = {
        kind: 'package-launch-window-ready',
        schemaVersion: 1,
        pid: 42,
        browserWindowId: 7,
        evidenceMode: 'package-launch-smoke',
        userDataDir,
        rendererUrl: pathToFileURL(expectedRendererPath).href,
        generatedAt: new Date().toISOString(),
      };
      writeFileSync(
        join(userDataDir, 'package-launch-window-ready.json'),
        `${JSON.stringify(marker, null, 2)}\n`,
        'utf8',
      );

      const evidence = readPackageLaunchWindowReadyEvidence(userDataDir, markerOptions);

      expect(evidence).toMatchObject({
        marker,
        passed: true,
        state: 'valid',
        violations: [],
      });
      expect(evidence.artifact).toMatchObject({
        path: join(userDataDir, 'package-launch-window-ready.json'),
        sizeBytes: expect.any(Number),
        sha256: expect.stringMatching(/^[A-F0-9]{64}$/),
      });
    } finally {
      rmSync(userDataDir, { force: true, recursive: true });
    }
  });

  it('requires the win-unpacked stdout marker and native visible-window proof in the final pass contract', () => {
    const source = readFileSync('scripts/smoke-package-launch.js', 'utf8');
    expect(source).toContain("text.includes('[App] window-created')");
    expect(source).not.toContain("marker = '[App] ipc-ready'");
    expect(source).toContain('runtimeProcess?.windowVisible === true');
    expect(source).toContain('processCleanup.passed');
    expect(source).toContain('windowReadyEvidence?.passed === true');
    expect(source).toContain('readPackageLaunchWindowReadyEvidence(userDataDir');
    expect(source).toContain('allowedProcessIds: new Set(observed.processes.keys())');
    expect(source).toContain('expectedExecutablePath: lineageRecord?.executablePath');
    expect(source).toContain('observationErrors: observed.errors');
    expect(source).toContain('observed.errors.length === 0');
  });

  it('cleans only the exact launched root and ignores an unrelated same-path root', async () => {
    const fixedExe = 'D:\\Release\\win-unpacked\\AmazonAIOpsAgent.exe';
    const snapshots = [
      {
        processes: [
          processItem({
            CreationDate: generatedAt,
            ExecutablePath: fixedExe,
            ParentProcessId: 1,
            ProcessId: 100,
          }),
          processItem({
            CreationDate: generatedAt,
            ExecutablePath: fixedExe,
            ParentProcessId: 1,
            ProcessId: 200,
          }),
        ],
      },
      {
        processes: [
          processItem({
            CreationDate: generatedAt,
            ExecutablePath: fixedExe,
            ParentProcessId: 1,
            ProcessId: 200,
          }),
        ],
      },
    ];
    const killed = [];
    const result = await cleanupVerifiedProcessTrees({
      collectByIds: () => snapshots.shift(),
      collectDescendants: () => ({ processes: [] }),
      intervalMs: 0,
      kill: (pid) => {
        killed.push(pid);
        return { passed: true, processId: pid };
      },
      attempts: 2,
      requiredRuntimeIdentity: true,
      rootProcesses: [{
        creationDate: generatedAt,
        executablePath: fixedExe,
        name: 'AmazonAIOpsAgent.exe',
        parentProcessId: 1,
        processId: 100,
        proof: 'direct-spawn-pid-and-path',
      }],
    });

    expect(killed).toEqual([100]);
    expect(result.passed).toBe(true);
    expect(result.remainingCount).toBe(0);
  });

  it('tracks and cleans only descendants proven from the launched root', async () => {
    const fixedExe = 'D:\\Release\\win-unpacked\\AmazonAIOpsAgent.exe';
    const snapshots = [
      {
        processes: [
          processItem({
            CreationDate: generatedAt,
            ExecutablePath: fixedExe,
            ParentProcessId: 1,
            ProcessId: 100,
          }),
        ],
      },
      { processes: [] },
    ];
    const killed = [];
    const result = await cleanupVerifiedProcessTrees({
      collectByIds: () => snapshots.shift(),
      collectDescendants: () => ({
        processes: [
          processItem({
            CreationDate: generatedAt,
            ExecutablePath: fixedExe,
            ParentProcessId: 100,
            ProcessId: 101,
          }),
        ],
      }),
      intervalMs: 0,
      kill: (pid) => {
        killed.push(pid);
        return { passed: true, processId: pid };
      },
      attempts: 2,
      requiredRuntimeIdentity: true,
      rootProcesses: [{
        creationDate: generatedAt,
        executablePath: fixedExe,
        name: 'AmazonAIOpsAgent.exe',
        parentProcessId: 1,
        processId: 100,
        proof: 'direct-spawn-pid-and-path',
      }],
    });

    expect(killed).toEqual([100]);
    expect(result.passed).toBe(true);
  });

  it('fails closed when the current runtime marker identity is missing even if no process remains', async () => {
    const result = await cleanupVerifiedProcessTrees({
      collectByIds: () => ({ processes: [] }),
      collectDescendants: () => ({ processes: [] }),
      intervalMs: 0,
      kill: () => ({ passed: true }),
      attempts: 1,
      requiredRuntimeIdentity: false,
      rootProcesses: [{
        executablePath: 'D:\\Release\\AmazonAIOpsAgent.exe',
        name: 'AmazonAIOpsAgent.exe',
        processId: 10,
        proof: 'direct-spawn-pid-and-path',
      }],
    });

    expect(result.passed).toBe(false);
    expect(result.identityViolations).toContainEqual(expect.objectContaining({
      code: 'RUNTIME_MARKER_IDENTITY_MISSING',
    }));
  });

  it('fails cleanup when any descendant/process/window observation failed even after tracked PIDs exited', async () => {
    const result = await cleanupVerifiedProcessTrees({
      collectByIds: () => ({ processes: [] }),
      collectDescendants: () => ({ processes: [] }),
      intervalMs: 0,
      kill: () => ({ passed: true }),
      attempts: 1,
      observationErrors: [{
        code: 'RUNTIME_WINDOW_QUERY_FAILED',
        error: 'bounded process query failed',
        processId: 10,
      }],
      requiredRuntimeIdentity: true,
      rootProcesses: [{
        executablePath: 'D:\\Release\\AmazonAIOpsAgent.exe',
        name: 'AmazonAIOpsAgent.exe',
        processId: 10,
        proof: 'direct-spawn-pid-and-path',
      }],
    });

    expect(result.passed).toBe(false);
    expect(result.treeErrors).toContainEqual(expect.objectContaining({
      code: 'RUNTIME_WINDOW_QUERY_FAILED',
      proof: 'launch-observation-error',
    }));
  });

  it('never treats an empty known-PID set as successful cleanup', async () => {
    const result = await cleanupVerifiedProcessTrees({
      collectByIds: () => ({ processes: [] }),
      collectDescendants: () => ({ processes: [] }),
      intervalMs: 0,
      kill: () => ({ passed: true }),
      attempts: 1,
      requiredRuntimeIdentity: true,
      rootProcesses: [],
    });

    expect(result.passed).toBe(false);
    expect(result.identityViolations).toContainEqual(expect.objectContaining({
      code: 'NO_TRACKED_PROCESS_IDENTITY',
    }));
  });

  it('fails closed and does not kill when a tracked PID has an unreadable executable path', async () => {
    const killed = [];
    const result = await cleanupVerifiedProcessTrees({
      collectByIds: () => ({
        processes: [
          processItem({
            ExecutablePath: null,
            ProcessId: 20,
          }),
        ],
      }),
      collectDescendants: () => ({ processes: [] }),
      intervalMs: 0,
      kill: (pid) => killed.push(pid),
      attempts: 1,
      requiredRuntimeIdentity: true,
      rootProcesses: [{
        creationDate: generatedAt,
        executablePath: 'C:\\Temp\\verified\\AmazonAIOpsAgent.exe',
        name: 'AmazonAIOpsAgent.exe',
        processId: 20,
        proof: 'isolated-runtime-marker',
      }],
    });

    expect(killed).toEqual([]);
    expect(result.passed).toBe(false);
    expect(result.unresolved).toContainEqual(expect.objectContaining({
      code: 'EXECUTABLE_PATH_UNRESOLVED',
      processId: 20,
    }));
  });

  it('reports an exact tracked residual after bounded retries instead of claiming cleanup success', async () => {
    const stubborn = {
      processes: [
        processItem({
          ProcessId: 20,
        }),
      ],
    };
    const result = await cleanupVerifiedProcessTrees({
      collectByIds: () => stubborn,
      collectDescendants: () => ({ processes: [] }),
      intervalMs: 0,
      kill: () => ({ passed: false, error: 'still running' }),
      attempts: 2,
      requiredRuntimeIdentity: true,
      rootProcesses: [{
        creationDate: generatedAt,
        executablePath: 'C:\\Temp\\verified\\AmazonAIOpsAgent.exe',
        name: 'AmazonAIOpsAgent.exe',
        processId: 20,
        proof: 'isolated-runtime-marker',
      }],
    });

    expect(result.passed).toBe(false);
    expect(result.remainingCount).toBe(1);
    expect(result.remaining[0].processId).toBe(20);
    expect(result.killAttempts).toHaveLength(2);
  });
});
