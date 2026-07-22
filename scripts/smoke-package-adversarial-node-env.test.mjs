import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  EXPECTED_ADVERSARIAL_NODE_ENV_CHECK_CODES,
  PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
  buildAdversarialNodeEnvEvidence,
  injectAdversarialNodeEnv,
  parseAdversarialNodeEnvArgs,
  rendererPathIdentity,
  runAdversarialNodeEnvSmoke,
  summarizeRuntimeProbe,
  validateAdversarialNodeEnvBundleSummaryContract,
  validateAdversarialNodeEnvEvidence,
  validateAdversarialNodeEnvManifestEntryContract,
  validateAdversarialNodeEnvSelectionContract,
} = require('./smoke-package-adversarial-node-env.js');

const HASH_A = 'A'.repeat(64);
const HASH_B = 'B'.repeat(64);
const HASH_C = 'C'.repeat(64);
const USER_DATA_DIR = 'D:\\Temp\\amazon-ai-ops-adversarial-node-env\\unit';
const APP_CONTENT_PATH = 'D:\\fixture\\release\\win-unpacked\\resources\\app';
const EXECUTABLE_PATH = 'D:\\fixture\\release\\win-unpacked\\AmazonAIOpsAgent.exe';
const RENDERER_ENTRY_PATH = `${APP_CONTENT_PATH}\\dist\\renderer\\index.html`;
const RENDERER_ENTRY_SHA256 = rendererPathIdentity(RENDERER_ENTRY_PATH);

function passingRuntime() {
  return {
    allDevToolsClosed: true,
    evidenceMode: 'package-launch-smoke',
    isPackaged: true,
    isolatedUserData: true,
    localhostDetected: false,
    nodeEnv: 'development',
    rendererEntrySha256: RENDERER_ENTRY_SHA256,
    rendererExact: true,
    rendererScheme: 'file:',
    windowCount: 1,
  };
}

function passingEvidence(overrides = {}) {
  const identity = {
    appContentSha256: HASH_B,
    executableSha256: HASH_A,
    mainBundleSha256: HASH_C,
    rendererEntrySha256: RENDERER_ENTRY_SHA256,
  };
  return buildAdversarialNodeEnvEvidence({
    generatedAt: '2026-07-17T00:00:00.000Z',
    identityAfter: overrides.identityAfter || identity,
    identityBefore: overrides.identityBefore || identity,
    expected: overrides.expected || identity,
    processCleanup: overrides.processCleanup || {
      afterMatchingCount: 0,
      attempts: 1,
      beforeMatchingCount: 0,
      passed: true,
    },
    runtime: overrides.runtime || passingRuntime(),
  });
}

describe('adversarial NODE_ENV packaged smoke contract', () => {
  it('requires all three approved package hashes and rejects unknown CLI arguments', () => {
    const parsed = parseAdversarialNodeEnvArgs([
      'node',
      'script',
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--expected-main-bundle-sha256', HASH_C,
      '--out', 'evidence.json',
    ]);
    expect(parsed).toMatchObject({
      expectedAppContentSha256: HASH_B,
      expectedExeSha256: HASH_A,
      expectedMainBundleSha256: HASH_C,
    });
    expect(parsed.userDataDir).toMatch(/^D:\\Temp\\amazon-ai-ops-adversarial-node-env\\\d+$/i);
    expect(() => parseAdversarialNodeEnvArgs([
      'node', 'script', '--expected-exe-sha256', HASH_A, '--out', 'evidence.json',
    ])).toThrow(/expected-app-content-sha256/);
    expect(() => parseAdversarialNodeEnvArgs([
      'node', 'script', '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--expected-main-bundle-sha256', HASH_C,
      '--out', 'evidence.json', '--unknown', 'x',
    ])).toThrow(/Unexpected argument/);
  });

  it('overrides an inherited production environment with the explicit hostile value', () => {
    expect(injectAdversarialNodeEnv({ NODE_ENV: 'production', SAFE: 'kept' })).toEqual({
      NODE_ENV: 'development',
      SAFE: 'kept',
    });
  });

  it('requires the exact current contract version across manifest, selection, and bundle summary', () => {
    const manifestEntry = {
      contractVersion: PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
      requiredForAppReady: true,
    };
    const selection = {
      contractVersion: PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
      present: true,
      evidencePath: 'D:\\evidence.json',
      selectedBy: 'explicit-arg',
      requiredForDeliverySafety: true,
      passed: true,
      evidenceSha256: HASH_A,
      package: {
        executableSha256: HASH_A,
        appContentSha256: HASH_B,
        mainBundleSha256: HASH_C,
      },
    };
    const bundleSummary = {
      contractVersion: PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
      present: true,
      requiredByFinalReadiness: true,
      sourcePath: 'D:\\evidence.json',
      bundlePath: 'evidence/package-adversarial-node-env.json',
      sha256: HASH_A,
    };

    expect(validateAdversarialNodeEnvManifestEntryContract(manifestEntry).passed).toBe(true);
    expect(validateAdversarialNodeEnvSelectionContract(selection).passed).toBe(true);
    expect(validateAdversarialNodeEnvBundleSummaryContract(bundleSummary).passed).toBe(true);
    expect(validateAdversarialNodeEnvManifestEntryContract({ ...manifestEntry, contractVersion: 'legacy/v0' }).passed)
      .toBe(false);
    expect(validateAdversarialNodeEnvSelectionContract({ ...selection, contractVersion: undefined }).passed)
      .toBe(false);
    expect(validateAdversarialNodeEnvBundleSummaryContract({ ...bundleSummary, contractVersion: 2 }).passed)
      .toBe(false);
  });

  it('emits and validates an exact path-free, secret-free passing schema', () => {
    const evidence = passingEvidence();
    expect(evidence.passed).toBe(true);
    expect(evidence.checks.map((check) => check.code)).toEqual(EXPECTED_ADVERSARIAL_NODE_ENV_CHECK_CODES);
    expect(validateAdversarialNodeEnvEvidence(evidence, {
      appContentSha256: HASH_B,
      executableSha256: HASH_A,
      mainBundleSha256: HASH_C,
      rendererEntrySha256: RENDERER_ENTRY_SHA256,
    })).toEqual({ passed: true, violations: [] });

    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain('D:\\');
    expect(serialized).not.toMatch(/"(?:path|url|username|password|credential|sourcePath|bundlePath)"\s*:/i);
    expect(validateAdversarialNodeEnvEvidence({ ...evidence, rendererUrl: 'http://localhost:5173' }).violations)
      .toContain('unexpected top-level evidence fields');
    expect(validateAdversarialNodeEnvEvidence(evidence, { mainBundleSha256: HASH_A }).violations)
      .toContain('package mainBundleSha256 mismatch');
    const wrongMode = {
      ...evidence,
      runtime: { ...evidence.runtime, evidenceMode: 'package-ui' },
    };
    expect(validateAdversarialNodeEnvEvidence(wrongMode).violations)
      .toContain('unexpected runtime evidence mode');
  });

  it('fails closed for development-mode downgrade signals without copying raw URLs', () => {
    const raw = {
      actualUserDataDir: USER_DATA_DIR,
      evidenceMode: 'package-launch-smoke',
      isPackaged: false,
      nodeEnv: 'development',
      windows: [{ devToolsOpened: true, url: 'http://localhost:5173/' }],
    };
    const runtime = summarizeRuntimeProbe(raw, {
      expectedRendererEntryPath: RENDERER_ENTRY_PATH,
      expectedUserDataDir: USER_DATA_DIR,
    });
    const evidence = passingEvidence({ runtime });

    expect(runtime).toMatchObject({
      allDevToolsClosed: false,
      isPackaged: false,
      localhostDetected: true,
      rendererExact: false,
    });
    expect(evidence.passed).toBe(false);
    expect(evidence.checks).toEqual(expect.arrayContaining([
      { code: 'RUNTIME_IS_PACKAGED', passed: false },
      { code: 'RENDERER_EXACT_PACKAGED_FILE', passed: false },
      { code: 'DEVTOOLS_CLOSED', passed: false },
      { code: 'LOCALHOST_RENDERER_ABSENT', passed: false },
    ]));
    expect(JSON.stringify(evidence)).not.toContain('localhost:5173');
  });

  it('launches with NODE_ENV=development, observes packaged runtime, closes Electron and attests cleanup', async () => {
    const identity = {
      appContentSha256: HASH_B,
      executableSha256: HASH_A,
      mainBundleSha256: HASH_C,
      rendererEntrySha256: RENDERER_ENTRY_SHA256,
    };
    let launchedWith;
    const close = vi.fn(async () => undefined);
    const evidence = await runAdversarialNodeEnvSmoke({
      appContentPath: APP_CONTENT_PATH,
      executablePath: EXECUTABLE_PATH,
      expectedAppContentSha256: HASH_B,
      expectedExeSha256: HASH_A,
      expectedMainBundleSha256: HASH_C,
      userDataDir: USER_DATA_DIR,
    }, {
      buildLaunchEnvironment: (baseEnv) => injectAdversarialNodeEnv(baseEnv),
      collectElectronRuntime: async () => ({
        actualUserDataDir: USER_DATA_DIR,
        evidenceMode: 'package-launch-smoke',
        isPackaged: true,
        nodeEnv: 'development',
        windows: [{
          devToolsOpened: false,
          url: 'file:///D:/fixture/release/win-unpacked/resources/app/dist/renderer/index.html',
        }],
      }),
      collectPackageIdentity: () => identity,
      collectPackageProcesses: () => ({
        error: null,
        matching: [],
        matchingCount: 0,
        observedCount: 0,
        passed: true,
        unresolved: [],
        unresolvedCount: 0,
      }),
      launchElectron: async (options) => {
        launchedWith = options;
        return { close };
      },
      waitForPackageCleanup: async () => ({
        attempts: 2,
        error: null,
        matching: [],
        matchingCount: 0,
        observedCount: 0,
        passed: true,
        unresolved: [],
        unresolvedCount: 0,
      }),
    });

    expect(launchedWith.env.NODE_ENV).toBe('development');
    expect(launchedWith.executablePath).toBe(EXECUTABLE_PATH);
    expect(close).toHaveBeenCalledOnce();
    expect(evidence.passed).toBe(true);
    expect(evidence.processCleanup).toEqual({
      afterMatchingCount: 0,
      attempts: 2,
      beforeMatchingCount: 0,
      passed: true,
    });
  });
});
