import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { initializeDesktopBootstrap } from './desktop-bootstrap';
import { EVIDENCE_MODE_ENV, EVIDENCE_USER_DATA_DIR_ENV } from './evidence-user-data-path';
import {
  enforceS7MainStartupGate,
  S7_STARTUP_GATE_ENV,
  type EnforceS7MainStartupGateOptions,
} from './s7-migration-startup-gate';

function harness() {
  const calls: string[] = [];
  const userDataDir = 'G:\\Temp\\amazon-ai-ops-bootstrap-test\\run-1';
  const environment: NodeJS.ProcessEnv = {
    APPDATA: 'C:\\Users\\operator\\AppData\\Roaming', NODE_ENV: 'development',
    [EVIDENCE_MODE_ENV]: 'package-launch-smoke', [EVIDENCE_USER_DATA_DIR_ENV]: userDataDir,
    PRIVATE_TEST_SECRET: 'must-not-cross-bootstrap',
  };
  const app = {
    isPackaged: false,
    getPath: vi.fn(() => { calls.push('get-user-data'); return userDataDir; }),
    setPath: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => { calls.push('lock'); return true; }),
    exit: vi.fn(() => { calls.push('exit'); }),
  };
  const admission = {
    mode: 'EVIDENCE_ISOLATED' as const, admitted: true as const,
    singleInstanceLockAcquired: true as const,
    canonicalUserDataDir: 'C:\\Users\\operator\\AppData\\Roaming\\@amazon-ai-ops\\desktop',
    evidenceUserDataDir: userDataDir,
  };
  const dependencies = {
    configureEvidencePath: vi.fn((_app: unknown, _environment?: NodeJS.ProcessEnv): {
      mode: string | null; overridden: boolean; userDataDir: string | null;
    } => {
      calls.push('configure-evidence');
      return { mode: 'package-launch-smoke', overridden: true, userDataDir };
    }),
    resolveCanonicalPath: vi.fn((_environment?: NodeJS.ProcessEnv) => {
      calls.push('resolve-canonical'); return admission.canonicalUserDataDir;
    }),
    enforceStartupGate: vi.fn((options: EnforceS7MainStartupGateOptions) => {
      calls.push('gate');
      options.app.requestSingleInstanceLock();
      return admission;
    }),
    removeReadyMarker: vi.fn(() => { calls.push('remove-stale-marker'); }),
    logger: {
      setOutputDirectory: vi.fn(() => { calls.push('log-directory'); }),
      info: vi.fn(() => { calls.push('admitted-log'); }), error: vi.fn(),
    },
  };
  const options = {
    environment, repositoryRoot: 'G:\\AI\\amazon-ai-ops',
    mainModulePath: 'G:\\AI\\amazon-ai-ops\\apps\\desktop\\dist\\main\\index.js',
    executablePath: 'G:\\Runtime\\electron.exe',
  };
  return { app, dependencies, options, environment, admission, userDataDir, calls };
}

describe('desktop bootstrap boundary', () => {
  it('uses one environment snapshot and admits the exact profile before removing stale readiness', () => {
    const input = harness();
    const { configuration, admission } = initializeDesktopBootstrap(input.app, input.options, input.dependencies);
    expect(input.calls).toEqual([
      'configure-evidence', 'get-user-data', 'log-directory', 'resolve-canonical',
      'gate', 'lock', 'admitted-log', 'remove-stale-marker',
    ]);
    const configuredEnvironment = input.dependencies.configureEvidencePath.mock.calls[0][1];
    const gate = input.dependencies.enforceStartupGate.mock.calls[0][0];
    expect(gate.env).not.toBe(configuredEnvironment);
    expect(gate.env).toEqual(configuredEnvironment);
    expect(Object.isFrozen(gate.env)).toBe(false);
    expect(input.dependencies.resolveCanonicalPath).toHaveBeenCalledWith(configuredEnvironment);
    expect(configuredEnvironment).not.toHaveProperty('PRIVATE_TEST_SECRET');
    expect(Object.isFrozen(configuredEnvironment)).toBe(true);
    expect(gate.currentUserDataDir).toBe(input.userDataDir);
    expect(gate.evidenceUserDataIdentity).toBe(configuration.evidenceIdentity);
    expect(gate.mainModulePath).toBe(input.options.mainModulePath);
    expect(gate.executablePath).toBe(input.options.executablePath);
    expect(input.dependencies.logger.setOutputDirectory).toHaveBeenCalledWith(path.join(input.userDataDir, 'logs'), configuration.runtimeLogRetention);
    expect(input.dependencies.removeReadyMarker).toHaveBeenCalledWith(path.join(input.userDataDir, 'package-launch-window-ready.json'));
    expect(admission).toBe(input.admission);
    expect(input.app.exit).not.toHaveBeenCalled();
  });

  it('ignores environment mutations after the snapshot is captured', () => {
    const input = harness();
    input.dependencies.configureEvidencePath.mockImplementation(() => {
      input.environment.NODE_ENV = 'production';
      input.environment.APPDATA = 'F:\\Changed';
      return { mode: 'package-launch-smoke', overridden: true, userDataDir: input.userDataDir };
    });
    const result = initializeDesktopBootstrap(input.app, input.options, input.dependencies);
    expect(result.configuration.development).toBe(true);
    const gateEnvironment = input.dependencies.enforceStartupGate.mock.calls[0][0].env;
    expect(gateEnvironment?.APPDATA).toBe('C:\\Users\\operator\\AppData\\Roaming');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('consumes one-time gate bindings without mutating the frozen configuration snapshot', () => {
    const input = harness();
    for (const name of Object.values(S7_STARTUP_GATE_ENV)) input.environment[name] = `bound-${name}`;
    input.dependencies.enforceStartupGate.mockImplementation((options) => {
      for (const name of Object.values(S7_STARTUP_GATE_ENV)) delete options.env![name];
      return input.admission;
    });
    initializeDesktopBootstrap(input.app, input.options, input.dependencies);
    const snapshot = input.dependencies.configureEvidencePath.mock.calls[0][1];
    for (const name of Object.values(S7_STARTUP_GATE_ENV)) {
      expect(snapshot?.[name]).toBe(`bound-${name}`);
      expect(input.environment).not.toHaveProperty(name);
    }
    expect(input.environment.NODE_ENV).toBe('development');
    expect(input.environment.PRIVATE_TEST_SECRET).toBe('must-not-cross-bootstrap');
  });

  it('preserves the real S7 error and its binding cleanup when no canonical ACTIVE gate exists', () => {
    const input = harness();
    input.environment[S7_STARTUP_GATE_ENV.gateId] = 'one-time-binding';
    delete input.environment[EVIDENCE_MODE_ENV];
    delete input.environment[EVIDENCE_USER_DATA_DIR_ENV];
    input.app.getPath.mockReturnValue(input.admission.canonicalUserDataDir);
    input.dependencies.configureEvidencePath.mockReturnValue({ mode: null, overridden: false, userDataDir: null });
    input.dependencies.enforceStartupGate.mockImplementation((options) => enforceS7MainStartupGate({
      ...options, platform: 'win32', io: { existsSync: () => false },
    }) as typeof input.admission);
    expect(() => initializeDesktopBootstrap(input.app, input.options, input.dependencies)).toThrow(/S7_STARTUP_GATE_ENV_INVALID/);
    expect(input.environment).not.toHaveProperty(S7_STARTUP_GATE_ENV.gateId);
    const snapshot = input.dependencies.configureEvidencePath.mock.calls[0][1];
    expect(snapshot?.[S7_STARTUP_GATE_ENV.gateId]).toBe('one-time-binding');
    expect(input.app.exit).toHaveBeenCalledWith(78);
    expect(input.app.requestSingleInstanceLock).not.toHaveBeenCalled();
    expect(input.dependencies.removeReadyMarker).not.toHaveBeenCalled();
  });

  it.each(['path', 'canonical', 'gate', 'marker'] as const)('logs and terminates bootstrap on a %s failure', (phase) => {
    const input = harness();
    const error = new Error(`BOOTSTRAP_${phase.toUpperCase()}_FAILED`);
    const fail = () => { throw error; };
    if (phase === 'path') input.dependencies.configureEvidencePath.mockImplementation(fail);
    if (phase === 'canonical') input.dependencies.resolveCanonicalPath.mockImplementation(fail);
    if (phase === 'gate') input.dependencies.enforceStartupGate.mockImplementation(fail);
    if (phase === 'marker') input.dependencies.removeReadyMarker.mockImplementation(fail);
    expect(() => initializeDesktopBootstrap(input.app, input.options, input.dependencies)).toThrow(error);
    expect(input.dependencies.logger.error).toHaveBeenCalledWith('desktop.startup_blocked', { error });
    expect(input.app.exit).toHaveBeenCalledTimes(1);
    expect(input.app.exit).toHaveBeenCalledWith(78);
    if (phase !== 'marker') expect(input.dependencies.removeReadyMarker).not.toHaveBeenCalled();
    if (phase === 'path' || phase === 'canonical') expect(input.dependencies.enforceStartupGate).not.toHaveBeenCalled();
  });

  it('preserves the original bootstrap error when exit also fails', () => {
    const input = harness();
    const failure = new Error('ADMISSION_FAILED');
    const exitFailure = new Error('EXIT_FAILED');
    input.dependencies.enforceStartupGate.mockImplementation(() => { throw failure; });
    input.app.exit.mockImplementation(() => { throw exitFailure; });
    expect(() => initializeDesktopBootstrap(input.app, input.options, input.dependencies)).toThrow(failure);
    expect(input.dependencies.logger.error).toHaveBeenCalledWith('desktop.startup_exit_failed', { error: exitFailure });
  });

  it.each(['package-ui', null])('does not clear a launch marker in mode %s', (mode) => {
    const input = harness();
    input.dependencies.configureEvidencePath.mockReturnValue({ mode, overridden: Boolean(mode), userDataDir: input.userDataDir });
    const result = initializeDesktopBootstrap(input.app, input.options, input.dependencies);
    expect(result.configuration.packageLaunchSmoke).toBe(false);
    expect(input.dependencies.removeReadyMarker).not.toHaveBeenCalled();
  });
});
