import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureBootstrapEnvironment,
  createBootstrapConfiguration,
  type BootstrapConfigurationInput,
} from './bootstrap-configuration';
import {
  EVIDENCE_MODE_ENV,
  EVIDENCE_USER_DATA_DIR_ENV,
  PACKAGE_LAUNCH_SMOKE_MODE,
  PACKAGE_UI_EVIDENCE_MODE,
  PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV,
} from './evidence-user-data-path';
import { S7_STARTUP_GATE_ENV } from './s7-migration-startup-gate';

function configurationInput(
  overrides: Partial<BootstrapConfigurationInput> = {},
): BootstrapConfigurationInput {
  return {
    environment: captureBootstrapEnvironment({}),
    isPackaged: false,
    evidenceIdentity: { mode: null, overridden: false, userDataDir: null },
    userDataDir: path.join('runtime', 'user-data'),
    repositoryRoot: path.join('workspace', 'repository'),
    mainModulePath: path.join('application', 'dist', 'main', 'index.js'),
    executablePath: path.join('application', 'Amazon AI Ops.exe'),
    ...overrides,
  };
}

describe('bootstrap environment snapshot', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('copies only the explicit bootstrap environment whitelist', () => {
    const expected = {
      APPDATA: 'app-data',
      NODE_ENV: 'development',
      AMAZON_AI_OPS_FINAL_READINESS_PATH: 'configured-readiness.json',
      FINAL_READINESS_PATH: 'legacy-readiness.json',
      [EVIDENCE_MODE_ENV]: PACKAGE_UI_EVIDENCE_MODE,
      [EVIDENCE_USER_DATA_DIR_ENV]: 'evidence-user-data',
      [PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV]: '1',
      ...Object.fromEntries(Object.values(S7_STARTUP_GATE_ENV).map((key) => [key, key])),
    };
    const snapshot = captureBootstrapEnvironment({
      ...expected,
      OPENAI_API_KEY: 'excluded-secret',
      HTTP_PROXY: 'excluded-proxy',
      PATH: 'excluded-path',
    });
    expect(snapshot).toEqual(expected);
    expect(Object.keys(snapshot)).toHaveLength(13);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('excluded');
  });

  it('retains empty values but excludes absent, undefined and inherited values', () => {
    const environment = Object.assign(Object.create({ APPDATA: 'inherited' }), {
      NODE_ENV: '',
      [EVIDENCE_MODE_ENV]: undefined,
    });
    expect(captureBootstrapEnvironment(environment)).toEqual({ NODE_ENV: '' });
  });

  it('remains isolated from later source mutations', () => {
    const environment = { APPDATA: 'first-path', NODE_ENV: 'development' };
    const snapshot = captureBootstrapEnvironment(environment);
    environment.APPDATA = 'second-path';
    environment.NODE_ENV = 'production';
    expect(snapshot).toEqual({ APPDATA: 'first-path', NODE_ENV: 'development' });
    expect(Reflect.set(snapshot, 'APPDATA', 'third-path')).toBe(false);
  });

  it('captures the current process environment when the source is omitted', () => {
    vi.stubEnv('NODE_ENV', 'bootstrap-default-source');
    expect(captureBootstrapEnvironment().NODE_ENV).toBe('bootstrap-default-source');
  });
});

describe('bootstrap configuration', () => {
  it.each<[string | undefined, string | undefined, string | null]>([
    ['primary.json', 'legacy.json', 'primary.json'],
    [undefined, 'legacy.json', 'legacy.json'],
    ['', 'legacy.json', 'legacy.json'],
    ['   ', 'legacy.json', null],
    [undefined, '   ', null],
    [undefined, '', null],
    ['', undefined, null],
    [undefined, undefined, null],
    [' primary.json ', 'legacy.json', ' primary.json '],
  ])('preserves readiness precedence and blank handling for primary=%s and legacy=%s', (
    primary, legacy, expected,
  ) => {
    const input = configurationInput({
      environment: captureBootstrapEnvironment({
        AMAZON_AI_OPS_FINAL_READINESS_PATH: primary,
        FINAL_READINESS_PATH: legacy,
      }),
    });
    const configuration = createBootstrapConfiguration(input);
    expect(configuration.paths.finalReadinessPath).toBe(expected === null
      ? null
      : path.resolve(input.repositoryRoot, expected));
  });

  it('resolves relative readiness paths against the captured repository root', () => {
    const repositoryRoot = path.resolve('workspace', 'captured-repository');
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(path.resolve('other-workspace'));
    try {
      const configuration = createBootstrapConfiguration(configurationInput({
        repositoryRoot,
        environment: captureBootstrapEnvironment({ FINAL_READINESS_PATH: 'evidence/final.json' }),
      }));
      expect(configuration.paths.finalReadinessPath).toBe(path.join(repositoryRoot, 'evidence', 'final.json'));
    } finally {
      cwd.mockRestore();
    }
  });

  it('preserves an absolute readiness path independently of the repository root', () => {
    const absolutePath = path.resolve('external-evidence', 'final.json');
    const configuration = createBootstrapConfiguration(configurationInput({
      environment: captureBootstrapEnvironment({ FINAL_READINESS_PATH: absolutePath }),
    }));
    expect(configuration.paths.finalReadinessPath).toBe(absolutePath);
  });

  it('keeps the captured readiness path stable after environment and input changes', () => {
    const environment = { AMAZON_AI_OPS_FINAL_READINESS_PATH: 'first.json' };
    const input = configurationInput({ environment: captureBootstrapEnvironment(environment) });
    environment.AMAZON_AI_OPS_FINAL_READINESS_PATH = 'second.json';
    const configuration = createBootstrapConfiguration(input);
    const expected = path.resolve(input.repositoryRoot, 'first.json');
    expect(configuration.paths.finalReadinessPath).toBe(expected);
    environment.AMAZON_AI_OPS_FINAL_READINESS_PATH = 'third.json';
    expect(configuration.paths.finalReadinessPath).toBe(expected);
    expect(Reflect.set(configuration.paths, 'finalReadinessPath', 'replaced.json')).toBe(false);
  });

  it.each<[boolean, string | undefined, boolean]>([
    [false, 'development', true],
    [false, 'production', false],
    [false, 'Development', false],
    [false, ' development ', false],
    [false, undefined, false],
    [true, 'development', false],
    [true, 'production', false],
  ])('derives development for packaged=%s and NODE_ENV=%s', (isPackaged, nodeEnvironment, expected) => {
    const configuration = createBootstrapConfiguration(configurationInput({
      isPackaged,
      environment: captureBootstrapEnvironment({ NODE_ENV: nodeEnvironment }),
    }));
    expect(configuration.development).toBe(expected);
  });

  it.each<[string | null, string | undefined, boolean, boolean, boolean]>([
    [null, undefined, false, false, false],
    [null, '1', false, false, false],
    [PACKAGE_UI_EVIDENCE_MODE, undefined, true, false, false],
    [PACKAGE_UI_EVIDENCE_MODE, '1', true, true, false],
    [PACKAGE_UI_EVIDENCE_MODE, 'true', true, false, false],
    [PACKAGE_UI_EVIDENCE_MODE, ' 1 ', true, false, false],
    [PACKAGE_LAUNCH_SMOKE_MODE, '1', false, false, true],
    ['package-ui-other', '1', false, false, false],
  ])('derives paired evidence flags for mode=%s and fresh-proof=%s', (
    mode, freshProof, readOnly, proofRequired, launchSmoke,
  ) => {
    const configuration = createBootstrapConfiguration(configurationInput({
      environment: captureBootstrapEnvironment({ [PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV]: freshProof }),
      evidenceIdentity: { mode, overridden: mode !== null, userDataDir: mode ? 'isolated-data' : null },
    }));
    expect(configuration.packageUiReadOnly).toBe(readOnly);
    expect(configuration.packageUiFreshTypedProofRequired).toBe(proofRequired);
    expect(configuration.packageLaunchSmoke).toBe(launchSmoke);
  });

  it('freezes every published object and copies the evidence identity', () => {
    const evidenceIdentity = { mode: PACKAGE_UI_EVIDENCE_MODE, overridden: true, userDataDir: 'first' };
    const environment = { NODE_ENV: 'development' };
    const configuration = createBootstrapConfiguration(configurationInput({ evidenceIdentity, environment }));
    evidenceIdentity.mode = PACKAGE_LAUNCH_SMOKE_MODE;
    evidenceIdentity.overridden = false;
    evidenceIdentity.userDataDir = 'second';
    environment.NODE_ENV = 'production';
    expect(configuration.development).toBe(true);
    expect(configuration.evidenceIdentity).toEqual({ mode: PACKAGE_UI_EVIDENCE_MODE, overridden: true, userDataDir: 'first' });
    expect(configuration.evidenceIdentity).not.toBe(evidenceIdentity);
    for (const object of [configuration, configuration.paths, configuration.evidenceIdentity, configuration.runtimeLogRetention]) {
      expect(Object.isFrozen(object)).toBe(true);
      expect(Reflect.set(object, 'injected', 'rejected')).toBe(false);
    }
    expect(configuration).not.toHaveProperty('environment');
  });

  it('preserves all existing user-data, storage and bundle path relationships', () => {
    const input = configurationInput();
    const { userDataDir, repositoryRoot, mainModulePath, executablePath } = input;
    const storageDir = path.join(userDataDir, 'storage');
    const exportsDir = path.join(storageDir, 'exports');
    const configuration = createBootstrapConfiguration(input);
    expect(configuration.paths).toEqual({
      userDataDir,
      logsDir: path.join(userDataDir, 'logs'),
      storageDir,
      storesDir: path.join(userDataDir, 'stores'),
      screenshotsDir: path.join(storageDir, 'screenshots'),
      domSnapshotsDir: path.join(storageDir, 'dom-snapshots'),
      tracesDir: path.join(storageDir, 'traces'),
      reportsDir: path.join(storageDir, 'reports'),
      downloadsDir: path.join(storageDir, 'downloads'),
      exportsDir,
      deliveryBundlesDir: path.join(exportsDir, 'delivery-bundles'),
      repositoryRoot,
      codexEvidenceDir: path.join(repositoryRoot, 'output', 'codex-evidence'),
      pageModelsDir: path.join(storageDir, 'page-models'),
      databasePath: path.join(userDataDir, 'amazon-ai-ops.db'),
      preloadPath: path.join(path.dirname(mainModulePath), '../preload/index.cjs'),
      rendererFilePath: path.join(path.dirname(mainModulePath), '../renderer/index.html'),
      finalReadinessPath: null,
    });
    expect(configuration.mainModulePath).toBe(mainModulePath);
    expect(configuration.executablePath).toBe(executablePath);
  });
});
