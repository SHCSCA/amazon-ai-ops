import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import evidenceModule from './package-ui-evidence.js';
import runnerModule from './run-package-ui-evidence.js';

const HASH_A = 'A'.repeat(64);
const HASH_B = 'B'.repeat(64);
const USER_DATA_DIR = 'D:\\Temp\\amazon-ai-ops-package-ui\\profile-copy';
const PROTECTED_DB_PATH = 'C:\\Users\\wz\\AppData\\Roaming\\@amazon-ai-ops\\desktop\\amazon-ai-ops.db';

const {
  EXPECTED_OVERLAY_CHECK_IDS,
  EXPECTED_PACKAGE_UI_SCALES,
  EXPECTED_PACKAGE_UI_WORKSPACES,
  PACKAGE_UI_WIDE_PROFILE,
  READ_ONLY_INTERACTION_PLAN,
  buildAppContentManifest,
  buildProcessIsolationEvidence,
  buildProtectedFileEvidence,
  buildProductionBuildContentManifest,
  appendRendererDiagnostic,
  captureViewportScreenshot,
  collectElectronIdentity,
  collectMatchingPackageProcesses,
  collectMatchingProfileBrowserProcesses,
  decisionsTabAccessibleNamePattern,
  evaluatePackageViewportContract,
  evaluatePackageUiEvidenceCompleteness,
  evaluateProfileDatabaseProvenance,
  executeEvidenceRunWithIsolation,
  extractProfileUserDataDirectories,
  isWorkspaceProbeAbsenceError,
  isRetryableLoginNavigationError,
  latestProductionSourceWatermark,
  parsePackageUiEvidenceArgs,
  sanitizeDiagnosticText,
  validateOverlayKeyboardEvidence,
  validateOverlayTriggerContract,
  validatePackageIdentity,
  validatePackageFreshness,
  validateReadOnlyInteractionPlan,
  validateObjectWorkspaceExperienceEvidence,
  validateObjectInspectorEvidence,
  validateWorkspaceRuntimeMetrics,
  validRunDiagnostics,
  waitForPackageProcessCleanup,
  waitForProfileBrowserProcessCleanup,
  waitForRendererComposite,
  waitForWorkspaceSettled,
} = evidenceModule;
const { main: runPackageUiEvidenceCli } = runnerModule;

describe('workspace authentication probe', () => {
  it('treats a bounded locator timeout as an unauthenticated result without masking the login error', () => {
    expect(isWorkspaceProbeAbsenceError({
      name: 'TimeoutError',
      message: 'locator.waitFor: Timeout 2000ms exceeded.',
    })).toBe(true);
    expect(isWorkspaceProbeAbsenceError(new Error('execution context was destroyed'))).toBe(true);
    expect(isWorkspaceProbeAbsenceError(new Error('renderer crashed'))).toBe(false);
  });
});

function withValidAppContent(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-'));
  const files = {
    'dist/main/index.js': 'main-entry',
    'dist/preload/index.js': 'preload-entry',
    'dist/renderer/assets/index.js': 'renderer-bundle',
    'dist/renderer/index.html': '<main>renderer</main>',
    'node_modules/runtime/index.js': 'runtime-dependency',
    'package.json': JSON.stringify({ main: 'dist/main/index.js', name: '@amazon-ai-ops/desktop', version: '1.5.0' }),
  };
  for (const [relativePath, content] of Object.entries(files).reverse()) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  try {
    return run(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function withProductionBuildPayload(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-production-build-'));
  const files = {
    'main/index.cjs': 'main-runtime',
    'main/index.js': 'main-runtime',
    'main/index.d.ts': 'stale-types',
    'main/index.cjs.map': 'source-map',
    'preload/index.cjs': 'preload-runtime',
    'preload/index.js': 'preload-runtime',
    'preload/index.d.ts': 'stale-types',
    'preload/index.cjs.map': 'source-map',
    'renderer/assets/index.css': 'renderer-style',
    'renderer/assets/index.js': 'renderer-runtime',
    'renderer/index.html': '<main>renderer</main>',
    'win-unpacked/historical.exe': 'old-package',
    'linux-unpacked/historical': 'old-package',
    'main-test.js': 'old-test-output',
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  const oldTime = new Date('2025-01-01T00:00:00.000Z');
  utimesSync(path.join(root, 'main/index.d.ts'), oldTime, oldTime);
  utimesSync(path.join(root, 'win-unpacked/historical.exe'), oldTime, oldTime);
  try {
    return run(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function validIdentity(overrides = {}) {
  const executablePath = path.resolve('apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe');
  const appContentPath = path.resolve('apps/desktop/release/win-unpacked/resources/app');
  return {
    actualAppContentSha256: HASH_B,
    actualExeSha256: HASH_A,
    actualExecutablePath: executablePath,
    actualUserDataDir: USER_DATA_DIR,
    appPath: appContentPath,
    appVersion: '1.5.0',
    expectedAppContentSha256: HASH_B,
    expectedExeSha256: HASH_A,
    expectedExecutablePath: executablePath,
    expectedEvidenceMode: 'package-ui',
    expectedUserDataDir: USER_DATA_DIR,
    expectedVersion: '1.5.0',
    evidenceMode: 'package-ui',
    isPackaged: true,
    rendererUrl: 'file:///D:/Desktop/py/amazon-ai-ops/apps/desktop/release/win-unpacked/resources/app/dist/renderer/index.html',
    ...overrides,
  };
}

describe('collectElectronIdentity', () => {
  it('passes evidence environment keys into the isolated Electron main-process evaluation', async () => {
    let receivedKeys = null;
    const electronApp = {
      evaluate: async (callback, envKeys) => {
        receivedKeys = envKeys;
        expect(String(callback)).not.toContain('EVIDENCE_MODE_ENV');
        expect(String(callback)).not.toContain('EVIDENCE_USER_DATA_DIR_ENV');
        return {
          actualExecutablePath: 'D:\\app\\AmazonAIOpsAgent.exe',
          actualUserDataDir: USER_DATA_DIR,
          appName: 'Amazon AI Ops Agent',
          appPath: 'D:\\app\\resources\\app',
          appVersion: '1.5.0',
          evidenceMode: 'package-ui',
          isPackaged: true,
          requestedUserDataDir: USER_DATA_DIR,
          resourcesPath: 'D:\\app\\resources',
        };
      },
    };
    const page = {
      title: async () => 'Amazon AI Ops Agent',
      url: () => 'file:///D:/app/resources/app/dist/renderer/index.html',
    };

    const identity = await collectElectronIdentity(electronApp, page);

    expect(receivedKeys).toEqual({
      evidenceMode: 'AMAZON_AI_OPS_EVIDENCE_MODE',
      userDataDir: 'AMAZON_AI_OPS_USER_DATA_DIR',
    });
    expect(identity).toMatchObject({
      actualUserDataDir: USER_DATA_DIR,
      evidenceMode: 'package-ui',
      rendererTitle: 'Amazon AI Ops Agent',
      rendererUrl: 'file:///D:/app/resources/app/dist/renderer/index.html',
      requestedUserDataDir: USER_DATA_DIR,
    });
  });
});

describe('captureViewportScreenshot', () => {
  it('captures the verified packaged BrowserWindow through Electron webContents', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-screenshot-'));
    const screenshotPath = path.join(root, 'electron-window.png');
    const payload = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const electronApp = {
      evaluate: async (callback) => {
        expect(String(callback)).toContain('webContents.capturePage()');
        return {
          data: payload.toString('base64'),
          empty: false,
          nativeSize: { height: 1, width: 1 },
        };
      },
    };

    try {
      const result = await captureViewportScreenshot(electronApp, screenshotPath);

      expect(result).toEqual({
        dimensions: { height: 1, width: 1 },
        method: 'electron-webcontents-capture-page',
        nativeSize: { height: 1, width: 1 },
      });
      expect(readFileSync(screenshotPath)).toEqual(payload);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe('packaged renderer settle contract', () => {
  it('waits for stable non-busy workspace text across four samples', async () => {
    const waits = [];
    const page = {
      evaluate: async () => ({
        busyCount: 0,
        busyLabels: [],
        navigationBusy: false,
        rootVisible: true,
        routeHandoffVisible: false,
        text: '稳定业务内容',
      }),
      waitForTimeout: async (ms) => { waits.push(ms); },
    };

    const result = await waitForWorkspaceSettled(page, '[data-workspace="diagnosis"]', 800);

    expect(result).toEqual(expect.objectContaining({
      minimumWaitMs: 2500,
      passed: true,
      sampleCount: 4,
      stableSamples: 3,
    }));
    expect(waits[0]).toBe(2500);
    expect(waits.slice(1)).toEqual([400, 400, 400]);
  });

  it('forces an Electron repaint between double animation frames and retains the required surface', async () => {
    let rendererFrames = 0;
    let invalidations = 0;
    const page = {
      evaluate: async (callback) => {
        expect(String(callback)).toContain('requestAnimationFrame');
        rendererFrames += 1;
      },
      waitForTimeout: async (ms) => { expect(ms).toBe(180); },
    };
    const electronApp = {
      evaluate: async (callback) => {
        expect(String(callback)).toContain('webContents.invalidate');
        invalidations += 1;
      },
    };
    const locator = {
      isVisible: async () => true,
      waitFor: async (options) => { expect(options.state).toBe('visible'); },
    };

    await expect(waitForRendererComposite(page, electronApp, locator)).resolves.toEqual({
      passed: true,
      requiredVisible: true,
    });
    expect(rendererFrames).toBe(2);
    expect(invalidations).toBe(1);
  });
});

describe('durable protected-state evidence', () => {
  it('requires the protected database path, hash, size, and mtime to remain identical', () => {
    const before = {
      path: PROTECTED_DB_PATH,
      sha256: HASH_A,
      sizeBytes: 42,
      mtimeMs: 1234,
    };
    expect(buildProtectedFileEvidence(before, { ...before })).toEqual({
      before,
      after: before,
      passed: true,
      unchanged: true,
    });
    expect(buildProtectedFileEvidence(before, { ...before, sha256: HASH_B })).toEqual(expect.objectContaining({
      passed: false,
      unchanged: false,
    }));
  });

  it('records matching package processes and waits until every matching executable exits', async () => {
    const executablePath = path.resolve('apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe');
    const running = collectMatchingPackageProcesses(executablePath, () => ({
      status: 0,
      stdout: JSON.stringify([{
        ExecutablePath: executablePath,
        Name: 'AmazonAIOpsAgent.exe',
        ParentProcessId: 10,
        ProcessId: 11,
      }]),
      stderr: '',
    }));
    expect(running).toEqual(expect.objectContaining({ matchingCount: 1, observedCount: 1, passed: true }));
    expect(running.unresolved).toEqual([]);

    const unresolved = collectMatchingPackageProcesses(executablePath, () => ({
      status: 0,
      stdout: JSON.stringify([{
        ExecutablePath: null,
        Name: 'AmazonAIOpsAgent.exe',
        ParentProcessId: 12,
        ProcessId: 13,
      }]),
      stderr: '',
    }));
    expect(unresolved).toEqual(expect.objectContaining({
      matching: [],
      matchingCount: 0,
      observedCount: 1,
      passed: false,
      unresolvedCount: 1,
    }));
    expect(unresolved.unresolved[0]).toEqual({
      executablePath: null,
      name: 'AmazonAIOpsAgent.exe',
      parentProcessId: 12,
      processId: 13,
    });

    let calls = 0;
    const cleanup = await waitForPackageProcessCleanup(executablePath, {
      attempts: 2,
      intervalMs: 0,
      collect: () => {
        calls += 1;
        return calls === 1
          ? { matchingCount: 1, passed: true }
          : { error: null, matching: [], matchingCount: 0, observedCount: 0, passed: true, unresolved: [], unresolvedCount: 0 };
      },
    });
    expect(cleanup).toEqual(expect.objectContaining({ attempts: 2, matchingCount: 0, passed: true }));
  });

  it('matches only Chrome, Chromium, or Edge processes bound to the exact isolated profile without persisting command lines', async () => {
    const profilePath = path.join(USER_DATA_DIR, 'storage', 'browser-data');
    expect(extractProfileUserDataDirectories(
      `"C:\\browser\\chrome.exe" --user-data-dir="${profilePath}" --type=browser`,
    )).toContain(profilePath);
    expect(extractProfileUserDataDirectories(
      `"C:\\browser\\chromium.exe" "--user-data-dir=${profilePath}" --type=renderer`,
    )).toContain(profilePath);

    const snapshot = collectMatchingProfileBrowserProcesses(profilePath, () => ({
      status: 0,
      stdout: JSON.stringify([
        {
          CommandLine: `"C:\\browser\\chrome.exe" --user-data-dir="${profilePath}" --type=browser`,
          ExecutablePath: 'C:\\browser\\chrome.exe',
          Name: 'chrome.exe',
          ParentProcessId: 10,
          ProcessId: 11,
        },
        {
          CommandLine: '"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe" --user-data-dir="D:\\Other\\edge-profile"',
          ExecutablePath: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          Name: 'msedge.exe',
          ParentProcessId: 20,
          ProcessId: 21,
        },
      ]),
      stderr: '',
    }));

    expect(snapshot).toEqual(expect.objectContaining({ matchingCount: 1, observedCount: 2, passed: true }));
    expect(snapshot.matching[0]).toEqual({
      executablePath: 'C:\\browser\\chrome.exe',
      name: 'chrome.exe',
      parentProcessId: 10,
      processId: 11,
      profileMatched: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain('CommandLine');
    expect(JSON.stringify(snapshot)).not.toContain('--user-data-dir');

    let calls = 0;
    const cleanup = await waitForProfileBrowserProcessCleanup(profilePath, {
      attempts: 2,
      intervalMs: 0,
      collect: () => {
        calls += 1;
        return calls === 1
          ? { matchingCount: 1, passed: true }
          : validProcessSnapshot();
      },
    });
    expect(cleanup).toEqual(expect.objectContaining({ attempts: 2, matchingCount: 0, passed: true }));
  });

  it('fails closed when any candidate profile browser command line cannot be read', () => {
    const profilePath = path.join(USER_DATA_DIR, 'storage', 'browser-data');
    const snapshot = collectMatchingProfileBrowserProcesses(profilePath, () => ({
      status: 0,
      stdout: JSON.stringify([{
        CommandLine: null,
        ExecutablePath: 'C:\\browser\\chrome.exe',
        Name: 'chrome.exe',
        ParentProcessId: 10,
        ProcessId: 11,
      }]),
      stderr: '',
    }));
    expect(snapshot).toEqual(expect.objectContaining({
      matchingCount: 0,
      passed: false,
      unresolvedCount: 1,
    }));
    expect(snapshot.unresolved[0]).toEqual(expect.objectContaining({
      name: 'chrome.exe',
      processId: 11,
      profileMatched: false,
    }));
  });

  it('returns a bounded structured failed run with sanitized diagnostics and both isolation attestations', async () => {
    const zero = validProcessSnapshot();
    const result = await executeEvidenceRunWithIsolation({
      baseEvidence: { scalePercent: 100, screenshots: [], workspaceChecks: [] },
      options: { executablePath: 'D:\\App\\AmazonAIOpsAgent.exe', userDataDir: USER_DATA_DIR },
      processApi: {
        collectPackage: () => zero,
        collectProfile: () => zero,
        waitPackage: async () => ({ ...zero, attempts: 1 }),
        waitProfile: async () => ({ ...zero, attempts: 1 }),
      },
      profileId: '100-compact',
      run: async (diagnostics) => {
        diagnostics.phase = 'viewport';
        diagnostics.timeline.push({ at: new Date().toISOString(), phase: 'viewport' });
        try {
          throw new Error([
            '--username operator@example.com --password hunter2',
            'Authorization: Bearer abcdef123456',
            'Cookie: sid=cookie-secret; session_token=session-secret',
            'api_key=sk-secretvalue',
            'x'.repeat(5_000),
          ].join('\n'));
        } finally {
          diagnostics.phase = 'electron-close';
          diagnostics.timeline.push({ at: new Date().toISOString(), phase: 'electron-close' });
        }
      },
    });

    expect(result.passed).toBe(false);
    expect(result.packageProcessIsolation.passed).toBe(true);
    expect(result.profileProcessIsolation.passed).toBe(true);
    expect(result.diagnostics).toEqual(expect.objectContaining({
      completedAt: expect.any(String),
      failure: expect.objectContaining({ phase: 'viewport' }),
      login: expect.objectContaining({ attempts: [], outcome: 'not-reached' }),
      phase: 'failed',
      startedAt: expect.any(String),
    }));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('operator@example.com');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('abcdef123456');
    expect(serialized).not.toContain('cookie-secret');
    expect(serialized).not.toContain('session-secret');
    expect(serialized).not.toContain('sk-secretvalue');
    expect(result.failure.message.length).toBeLessThanOrEqual(2_000);
    expect(sanitizeDiagnosticText('password=hunter2 token=abc123')).toBe('password=[REDACTED] token=[REDACTED]');
    expect(sanitizeDiagnosticText('--password hunter2 --username operator@example.com')).toBe('--password [REDACTED] --username [REDACTED]');
    expect(sanitizeDiagnosticText('Authorization: Bearer abcdef123456')).toBe('Authorization: [REDACTED]');
    expect(sanitizeDiagnosticText('Cookie: sid=cookie-secret; session_token=session-secret')).toBe('Cookie: [REDACTED]');
    expect(sanitizeDiagnosticText('session_token=session-secret')).toBe('session_token=[REDACTED]');
    expect(validRunDiagnostics(result.diagnostics, result)).toBe(false);
  });

  it('caps renderer diagnostics and records dropped entries without growing the manifest arrays', async () => {
    const zero = validProcessSnapshot();
    const result = await executeEvidenceRunWithIsolation({
      baseEvidence: { scalePercent: 100 },
      options: { executablePath: 'D:\\App\\AmazonAIOpsAgent.exe', userDataDir: USER_DATA_DIR },
      processApi: {
        collectPackage: () => zero,
        collectProfile: () => zero,
        waitPackage: async () => ({ ...zero, attempts: 1 }),
        waitProfile: async () => ({ ...zero, attempts: 1 }),
      },
      profileId: '100-compact',
      run: async (diagnostics) => {
        for (let index = 0; index < 105; index += 1) {
          appendRendererDiagnostic(diagnostics, 'consoleErrors', { message: `error-${index}` });
        }
        return { passed: true };
      },
    });

    expect(result.diagnostics.renderer.consoleErrors).toHaveLength(100);
    expect(result.diagnostics.renderer.droppedCount).toEqual({ consoleErrors: 5, pageErrors: 0 });
    expect(result.diagnostics.renderer.limits).toEqual({ consoleErrors: 100, pageErrors: 100 });
    expect(validRunDiagnostics(result.diagnostics, result)).toBe(false);
  });
});

describe('saved-login navigation retry contract', () => {
  it('retries only explicit browser navigation context replacement errors', () => {
    expect(isRetryableLoginNavigationError('Execution context was destroyed, most likely because of a navigation.')).toBe(true);
    expect(isRetryableLoginNavigationError('Most likely because of a navigation')).toBe(true);
    expect(isRetryableLoginNavigationError('用户名或密码错误')).toBe(false);
    expect(isRetryableLoginNavigationError('Timeout 120000ms exceeded')).toBe(false);
  });

  it('proves saved-login readiness from non-secret Main-managed status instead of a populated password input', () => {
    const source = readFileSync('scripts/package-ui-evidence.js', 'utf8');

    expect(source).toContain("getAttribute('data-credential-source') === 'saved'");
    expect(source).toContain('passwordManagedByMain');
    expect(source).toContain('passwordInputEmpty');
    expect(source).toContain('statusConfirmsMainOnly');
    expect(source).not.toContain('passwordAvailable: Boolean(document.querySelector(\'input[placeholder="领星密码"]\')?.value)');
    expect(source).not.toMatch(/authenticated-during-credential-observation[\s\S]{0,500}passwordInputEmpty:\s*true/);
    expect(source).not.toMatch(/authenticated-during-credential-observation[\s\S]{0,500}passwordManagedByMain:\s*true/);
  });
});

function validMetrics(expected, overrides = {}) {
  return {
    activeNavigation: { count: 1, label: expected.label },
    aria: { brokenReferences: [], duplicateIds: [] },
    h1: { count: 1, labels: [expected.heading] },
    horizontalOverflow: { violations: [] },
    primaryAction: { count: 1, labels: ['继续'] },
    previewMarkers: [],
    rendererUrl: 'file:///D:/resources/app/dist/renderer/index.html',
    root: { count: 1, subview: expected.subview, workspace: expected.workspace },
    scrollOwnership: {
      defaultOwner: { declared: true, matchCount: 1, scrollTop: 0 },
      unlabelledActiveOwners: [],
    },
    viewport: { height: 700, width: 1200 },
    ...overrides,
  };
}

function validProcessSnapshot(overrides = {}) {
  return {
    error: null,
    matching: [],
    matchingCount: 0,
    observedCount: 0,
    passed: true,
    unresolved: [],
    unresolvedCount: 0,
    ...overrides,
  };
}

function validProcessIsolation() {
  return buildProcessIsolationEvidence(validProcessSnapshot(), validProcessSnapshot({ attempts: 1 }));
}

function validDiagnostics(profileId) {
  return {
    cleanupErrors: [],
    completedAt: '2026-07-17T06:00:01.000Z',
    failure: null,
    login: {
      attempts: [],
      completedAt: '2026-07-17T06:00:00.500Z',
      outcome: 'existing-authenticated-session',
      savedCredentials: null,
      startedAt: '2026-07-17T06:00:00.100Z',
    },
    phase: 'completed',
    profileId,
    renderer: {
      consoleErrors: [],
      droppedCount: { consoleErrors: 0, pageErrors: 0 },
      limits: { consoleErrors: 100, pageErrors: 100 },
      pageErrors: [],
    },
    schemaVersion: 'package-ui-run-diagnostics/v1',
    startedAt: '2026-07-17T06:00:00.000Z',
    timeline: [
      { at: '2026-07-17T06:00:00.000Z', phase: 'created' },
      { at: '2026-07-17T06:00:01.000Z', phase: 'completed' },
    ],
  };
}

function validRun(scale) {
  return {
    actualDeviceScaleFactor: scale.deviceScaleFactor,
    consoleErrors: [],
    diagnostics: validDiagnostics(`${scale.scalePercent}-compact`),
    identity: { passed: true },
    overlayChecks: EXPECTED_OVERLAY_CHECK_IDS.map((id) => ({
      compositeEvidence: { passed: true },
      id,
      overlayVisibleAfterCapture: true,
      overlayVisibleBeforeCapture: true,
      passed: true,
      screenshot: { path: `${id}-${scale.scalePercent}.png`, sha256: HASH_B },
    })),
    pageErrors: [],
    packageProcessIsolation: validProcessIsolation(),
    scalePercent: scale.scalePercent,
    screenshots: EXPECTED_PACKAGE_UI_WORKSPACES.map((workspace) => ({
      path: `${workspace.workspace}-${scale.scalePercent}.png`,
      sha256: HASH_A,
      workspace: workspace.workspace,
    })),
    viewport: { height: 700, width: 1200 },
    profileProcessIsolation: validProcessIsolation(),
    workspaceChecks: EXPECTED_PACKAGE_UI_WORKSPACES.map((workspace) => {
      const objectWorkspace = workspace.workspace === 'product' || workspace.workspace === 'diagnosis';
      return {
        compositeEvidence: { passed: true },
        experienceEvidence: objectWorkspace ? { passed: true } : null,
        inspectorEvidence: objectWorkspace ? {
          inspector: { ariaModal: 'true', mode: 'drawer' },
          passed: true,
          screenshot: { path: `${workspace.workspace}-inspector-${scale.scalePercent}.png`, sha256: HASH_B },
        } : null,
        passed: true,
        settleEvidence: { passed: true },
        workspace: workspace.workspace,
      };
    }),
  };
}

function validWideRun() {
  return {
    actualDeviceScaleFactor: 1,
    consoleErrors: [],
    diagnostics: validDiagnostics(PACKAGE_UI_WIDE_PROFILE.id),
    identity: { passed: true },
    pageErrors: [],
    packageProcessIsolation: validProcessIsolation(),
    profileId: PACKAGE_UI_WIDE_PROFILE.id,
    screenshots: ['product', 'diagnosis'].map((workspace) => ({
      path: `${workspace}-wide.png`,
      sha256: HASH_A,
      workspace,
    })),
    profileProcessIsolation: validProcessIsolation(),
    viewport: { height: 900, width: 1400 },
    workspaceChecks: ['product', 'diagnosis'].map((workspace) => ({
      experienceEvidence: { passed: true },
      inspectorEvidence: {
        inspector: { ariaModal: null, mode: 'inline' },
        passed: true,
        screenshot: { path: `${workspace}-wide-inspector.png`, sha256: HASH_B },
      },
      passed: true,
      workspace,
    })),
  };
}

describe('package UI evidence CLI contract', () => {
  it('requires immutable EXE and unpacked app-content hashes and keeps both paths fixed to win-unpacked', () => {
    expect(() => parsePackageUiEvidenceArgs([])).toThrow(/--expected-exe-sha256/);
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
    ])).toThrow(/--expected-app-content-sha256/);
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', 'not-a-hash',
      '--expected-app-content-sha256', HASH_B,
    ])).toThrow(/64-character SHA-256/);

    const parsed = parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A.toLowerCase(),
      '--expected-app-content-sha256', HASH_B.toLowerCase(),
      '--allow-saved-login',
      '--user-data-dir', USER_DATA_DIR,
      '--protected-db', PROTECTED_DB_PATH,
      '--output', 'output/custom-package-ui',
      '--settle-ms', '900',
    ]);

    expect(parsed.expectedExeSha256).toBe(HASH_A);
    expect(parsed.expectedAppContentSha256).toBe(HASH_B);
    expect(parsed.allowSavedLogin).toBe(true);
    expect(parsed.outputDir).toBe('output/custom-package-ui');
    expect(parsed.settleMs).toBe(900);
    expect(parsed.userDataDir).toBe(USER_DATA_DIR);
    expect(parsed.protectedDatabasePath).toBe(path.resolve(PROTECTED_DB_PATH));
    expect(parsed.executablePath).toBe(path.resolve('apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe'));
    expect(parsed.appContentPath).toBe(path.resolve('apps/desktop/release/win-unpacked/resources/app'));
  });

  it('requires a scoped explicit D-drive userData copy and rejects the real AppData profile', () => {
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
    ])).toThrow(/--user-data-dir is required/);
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--user-data-dir', 'C:\\Users\\wz\\AppData\\Roaming\\@amazon-ai-ops\\desktop',
    ])).toThrow(/D: drive/);
  });

  it('requires an explicit protected AppData database for durable before/after evidence', () => {
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--user-data-dir', USER_DATA_DIR,
    ])).toThrow(/--protected-db is required/);
  });

  it('exposes a root package command without a URL or preview escape hatch', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(packageJson.scripts['evidence:package-ui']).toBe('node scripts/run-package-ui-evidence.js');
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--url', 'http://127.0.0.1:4174/?preview=1',
    ])).toThrow(/Unknown argument: --url/);
  });

  it('prints help without launching Electron or requiring package hashes', () => {
    const result = spawnSync(process.execPath, ['scripts/run-package-ui-evidence.js', '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('real packaged Electron application');
    expect(result.stdout).toContain('--expected-app-content-sha256');
    expect(result.stdout).toContain('--print-package-hashes');
    expect(result.stdout).toContain('--user-data-dir');
    expect(result.stdout).toContain('--protected-db');
    expect(result.stdout).toContain("app.setPath('userData')");
    expect(result.stdout).toContain('win-unpacked/resources/app');
    expect(result.stdout).toContain('accepts no');
  });

  it('prints fixed package hashes without launching the Electron evidence runtime', async () => {
    const output = [];
    let launches = 0;
    await runPackageUiEvidenceCli(['--print-package-hashes'], {
      collectFixedPackageHashes: () => ({
        appContentFileCount: 42,
        appContentPath: path.resolve('apps/desktop/release/win-unpacked/resources/app'),
        appContentSha256: HASH_B,
        executablePath: path.resolve('apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe'),
        exeSha256: HASH_A,
        kind: 'package-ui-hash-preflight',
      }),
      print: (value) => output.push(value),
      runPackageUiEvidence: async () => { launches += 1; },
    });

    expect(launches).toBe(0);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toEqual(expect.objectContaining({
      appContentSha256: HASH_B,
      exeSha256: HASH_A,
      kind: 'package-ui-hash-preflight',
    }));
  });

  it('rejects path overrides or other arguments in fixed hash-preflight mode', async () => {
    await expect(runPackageUiEvidenceCli([
      '--print-package-hashes',
      '--output',
      'output/alternate',
    ], {
      collectFixedPackageHashes: () => ({ exeSha256: HASH_A, appContentSha256: HASH_B }),
      print: () => undefined,
    })).rejects.toThrow(/cannot be combined.*path overrides/i);
  });
});

describe('isolated profile database provenance', () => {
  it('accepts only a distinct isolated database with the protected database SHA-256 and size', () => {
    const protectedDatabase = {
      path: PROTECTED_DB_PATH,
      sha256: HASH_A,
      sizeBytes: 18_448_384,
    };
    const profileDatabase = {
      path: path.join(USER_DATA_DIR, 'amazon-ai-ops.db'),
      sha256: HASH_A,
      sizeBytes: 18_448_384,
    };

    expect(evaluateProfileDatabaseProvenance({ profileDatabase, protectedDatabase })).toEqual({
      hashMatches: true,
      passed: true,
      pathsDistinct: true,
      profileDatabase,
      protectedDatabase,
      sizeMatches: true,
      violations: [],
    });
  });

  it.each([
    ['hash drift', { sha256: HASH_B }, 'PROFILE_DATABASE_HASH_MISMATCH'],
    ['size drift', { sizeBytes: 18_448_385 }, 'PROFILE_DATABASE_SIZE_MISMATCH'],
    ['protected path reuse', { path: PROTECTED_DB_PATH }, 'PROFILE_DATABASE_NOT_ISOLATED'],
  ])('fails closed for %s', (_label, override, code) => {
    const result = evaluateProfileDatabaseProvenance({
      protectedDatabase: { path: PROTECTED_DB_PATH, sha256: HASH_A, sizeBytes: 18_448_384 },
      profileDatabase: {
        path: path.join(USER_DATA_DIR, 'amazon-ai-ops.db'),
        sha256: HASH_A,
        sizeBytes: 18_448_384,
        ...override,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });
});

describe('package identity fail-closed contract', () => {
  it('accepts only the expected packaged executable, unpacked app content, version and file renderer', () => {
    expect(validatePackageIdentity(validIdentity())).toEqual({ passed: true, violations: [] });
  });

  it.each([
    ['wrong executable hash', { actualExeSha256: HASH_B }, 'EXE_HASH_MISMATCH'],
    ['wrong unpacked app-content hash', { actualAppContentSha256: HASH_A }, 'APP_CONTENT_HASH_MISMATCH'],
    ['wrong executable', { actualExecutablePath: path.resolve('AmazonAIOpsAgent.exe') }, 'EXECUTABLE_PATH_MISMATCH'],
    ['unpackaged runtime', { isPackaged: false }, 'RUNTIME_NOT_PACKAGED'],
    ['preview renderer', { rendererUrl: 'file:///D:/resources/app/index.html?preview=1&scenario=diagnosis-ready' }, 'PREVIEW_RENDERER_FORBIDDEN'],
    ['web renderer', { rendererUrl: 'http://127.0.0.1:4174/' }, 'RENDERER_NOT_FILE_URL'],
    ['file renderer outside app content', { rendererUrl: 'file:///D:/outside/index.html' }, 'RENDERER_OUTSIDE_APP_CONTENT'],
    ['wrong renderer entry inside app content', {
      rendererUrl: 'file:///D:/Desktop/py/amazon-ai-ops/apps/desktop/release/win-unpacked/resources/app/dist/renderer/alternate.html',
    }, 'RENDERER_ENTRY_MISMATCH'],
    ['wrong app version', { appVersion: '1.4.0' }, 'APP_VERSION_MISMATCH'],
    ['wrong app path', { appPath: path.resolve('apps/desktop/dist') }, 'APP_CONTENT_PATH_MISMATCH'],
    ['real AppData userData', { actualUserDataDir: 'C:\\Users\\wz\\AppData\\Roaming\\@amazon-ai-ops\\desktop' }, 'ACTUAL_USER_DATA_UNSAFE'],
    ['different D-drive userData', { actualUserDataDir: 'D:\\Temp\\amazon-ai-ops-package-ui\\other-copy' }, 'USER_DATA_PATH_MISMATCH'],
    ['wrong evidence mode', { evidenceMode: 'package-launch-smoke' }, 'EVIDENCE_MODE_MISMATCH'],
  ])('rejects %s', (_label, overrides, code) => {
    const result = validatePackageIdentity(validIdentity(overrides));
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code }),
    ]));
  });
});

describe('unpacked app-content manifest', () => {
  it('hashes a deterministic sorted manifest with relative paths, per-file SHA-256 and sizes', () => {
    withValidAppContent((root) => {
      const first = buildAppContentManifest(root);
      const second = buildAppContentManifest(root);

      expect(second).toEqual(first);
      expect(first.kind).toBe('unpacked-app-content-manifest');
      expect(first.sha256).toMatch(/^[A-F0-9]{64}$/);
      expect(first.fileCount).toBe(6);
      expect(first.files.map((file) => file.path)).toEqual([
        'dist/main/index.js',
        'dist/preload/index.js',
        'dist/renderer/assets/index.js',
        'dist/renderer/index.html',
        'node_modules/runtime/index.js',
        'package.json',
      ]);
      expect(first.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'dist/main/index.js', sha256: expect.stringMatching(/^[A-F0-9]{64}$/), sizeBytes: 10 }),
      ]));
    });
  });

  it('fails closed when a required unpacked runtime entry is missing', () => {
    withValidAppContent((root) => {
      rmSync(path.join(root, 'dist/renderer/index.html'));
      expect(() => buildAppContentManifest(root)).toThrow(/required packaged runtime entry is missing.*dist\/renderer\/index\.html/i);
    });
  });

  it('rejects a package.json main entry that traverses outside resources/app', () => {
    withValidAppContent((root) => {
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({
        main: '../../outside.js',
        name: '@amazon-ai-ops/desktop',
        version: '1.5.0',
      }), 'utf8');
      expect(() => buildAppContentManifest(root)).toThrow(/package\.json main must be a safe relative path/i);
    });
  });

  it('rejects an app-content path whose ancestor symlink or junction escapes the fixed path', () => {
    withValidAppContent((root) => {
      const aliasBase = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-alias-'));
      const aliasParent = path.join(aliasBase, 'reparse-parent');
      try {
        symlinkSync(path.dirname(root), aliasParent, process.platform === 'win32' ? 'junction' : 'dir');
        const escapedRoot = path.join(aliasParent, path.basename(root));
        expect(() => buildAppContentManifest(escapedRoot)).toThrow(/app-content path resolves through a symbolic link or junction/i);
      } finally {
        rmSync(aliasBase, { force: true, recursive: true });
      }
    });
  });

  it('rejects a nested symlink or junction before hashing its target', () => {
    withValidAppContent((root) => {
      const outside = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-outside-'));
      try {
        writeFileSync(path.join(outside, 'escape.js'), 'outside', 'utf8');
        symlinkSync(outside, path.join(root, 'node_modules/escape'), process.platform === 'win32' ? 'junction' : 'dir');
        expect(() => buildAppContentManifest(root)).toThrow(/may not contain symbolic links or junctions/i);
      } finally {
        rmSync(outside, { force: true, recursive: true });
      }
    });
  });

  it('changes the tree hash when any runtime file content changes', () => {
    withValidAppContent((root) => {
      const before = buildAppContentManifest(root);
      writeFileSync(path.join(root, 'dist/renderer/assets/index.js'), 'changed-renderer-bundle', 'utf8');
      const after = buildAppContentManifest(root);
      expect(after.sha256).not.toBe(before.sha256);
    });
  });

  it('rejects package metadata that does not identify the expected desktop app', () => {
    withValidAppContent((root) => {
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({
        main: 'dist/main/index.js',
        name: '@amazon-ai-ops/desktop',
        version: '9.9.9',
      }), 'utf8');
      expect(() => buildAppContentManifest(root)).toThrow(/package\.json metadata does not match the expected desktop package/i);
    });
  });
});

describe('unpacked package freshness', () => {
  it('accepts a current build that is newer than source and byte-identical to packaged dist', () => {
    const result = validatePackageFreshness({
      buildContent: { oldestMtimeMs: 2_000, sha256: HASH_A },
      packagedDistContent: { sha256: HASH_A },
      sourceWatermark: { mtimeMs: 1_000, path: 'apps/desktop/src/renderer/app.tsx' },
    });
    expect(result).toEqual({ passed: true, violations: [] });
  });

  it('hashes only current main, preload and renderer production outputs, ignoring historical package residue', () => {
    withProductionBuildPayload((root) => {
      const manifest = buildProductionBuildContentManifest(root);
      expect(manifest.files.map((file) => file.path)).toEqual([
        'main/index.cjs',
        'main/index.js',
        'preload/index.cjs',
        'preload/index.js',
        'renderer/assets/index.css',
        'renderer/assets/index.js',
        'renderer/index.html',
      ]);
      expect(manifest.files.some((file) => /win-unpacked|linux-unpacked|\.d\.ts|\.map|main-test/.test(file.path))).toBe(false);
      expect(manifest.oldestMtimeMs).toBeGreaterThan(new Date('2025-01-01T00:00:00.000Z').getTime());
    });
  });

  it('compares current and packaged production payloads independently of different historical residue', () => {
    withProductionBuildPayload((currentRoot) => {
      withProductionBuildPayload((packagedRoot) => {
        writeFileSync(path.join(currentRoot, 'win-unpacked/historical.exe'), 'current-old-package', 'utf8');
        writeFileSync(path.join(packagedRoot, 'win-unpacked/historical.exe'), 'different-old-package', 'utf8');
        writeFileSync(path.join(currentRoot, 'main/index.d.ts'), 'current-old-types', 'utf8');
        writeFileSync(path.join(packagedRoot, 'main/index.d.ts'), 'different-old-types', 'utf8');

        const current = buildProductionBuildContentManifest(currentRoot);
        const packaged = buildProductionBuildContentManifest(packagedRoot);
        expect(packaged.sha256).toBe(current.sha256);
        expect(packaged.files).toEqual(current.files);
      });
    });
  });

  it('fails closed when a required production-build runtime entry is absent', () => {
    withProductionBuildPayload((root) => {
      rmSync(path.join(root, 'main/index.cjs'));
      expect(() => buildProductionBuildContentManifest(root)).toThrow(/required desktop production-build entry is missing.*main\/index\.cjs/i);
    });
  });

  it('ignores test files and historical build directories when finding the latest production source', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-production-source-'));
    try {
      const productionSource = path.join(root, 'src/app.tsx');
      const productionStyle = path.join(root, 'src/style.css');
      const testSource = path.join(root, 'src/app.test.tsx');
      const nestedTestSource = path.join(root, 'src/__tests__/newer.ts');
      const historicalBuild = path.join(root, 'release/win-unpacked/old.js');
      for (const filePath of [productionSource, productionStyle, testSource, nestedTestSource, historicalBuild]) {
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, filePath, 'utf8');
      }
      utimesSync(productionSource, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
      utimesSync(productionStyle, new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z'));
      utimesSync(testSource, new Date('2026-02-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));
      utimesSync(nestedTestSource, new Date('2026-03-01T00:00:00Z'), new Date('2026-03-01T00:00:00Z'));
      utimesSync(historicalBuild, new Date('2026-04-01T00:00:00Z'), new Date('2026-04-01T00:00:00Z'));

      const watermark = latestProductionSourceWatermark([root]);
      expect(path.normalize(watermark.path)).toBe(path.normalize(productionStyle));
      expect(watermark.mtimeMs).toBe(new Date('2026-01-02T00:00:00Z').getTime());
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.each([
    [
      'source newer than the oldest current build artifact',
      {
        buildContent: { oldestMtimeMs: 1_000, sha256: HASH_A },
        packagedDistContent: { sha256: HASH_A },
        sourceWatermark: { mtimeMs: 5_000, path: 'apps/desktop/src/renderer/app.tsx' },
      },
      'CURRENT_BUILD_STALE',
    ],
    [
      'packaged dist differing from the current build',
      {
        buildContent: { oldestMtimeMs: 5_000, sha256: HASH_A },
        packagedDistContent: { sha256: HASH_B },
        sourceWatermark: { mtimeMs: 1_000, path: 'apps/desktop/src/renderer/app.tsx' },
      },
      'PACKAGED_DIST_MISMATCH',
    ],
  ])('rejects %s', (_label, input, code) => {
    const result = validatePackageFreshness(input);
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });
});

describe('package workspace runtime contract', () => {
  it('matches Decisions tabs by their dynamic loaded-count accessible names', () => {
    expect(decisionsTabAccessibleNamePattern('已决策').test('已决策（已载入 12）')).toBe(true);
    expect(decisionsTabAccessibleNamePattern('待判断').test('待判断（已载入 0）')).toBe(true);
    expect(decisionsTabAccessibleNamePattern('已决策').test('已决策')).toBe(false);
  });

  it('locks the exact eight task-first workspace identities', () => {
    expect(EXPECTED_PACKAGE_UI_WORKSPACES).toEqual([
      { workspace: 'today', subview: 'overview', label: '今日任务', heading: '今日任务' },
      { workspace: 'product', subview: 'products', label: '产品工作台', heading: '产品工作台' },
      { workspace: 'data-preparation', subview: 'scope', label: '数据准备', heading: '工作范围' },
      { workspace: 'diagnosis', subview: 'analysis', label: '广告诊断', heading: '广告诊断' },
      { workspace: 'decisions', subview: 'decided', tabLabel: '已决策', label: '建议与审批', heading: '建议与审批' },
      { workspace: 'readback', subview: 'evidence', label: '结果核对', heading: '结果核对' },
      { workspace: 'growth', subview: 'keywords', label: '关键词与 Listing', heading: '关键词机会' },
      { workspace: 'system', subview: 'settings', label: '系统与交付', heading: 'AI 与规则' },
    ]);
  });

  it('accepts unique semantics, one primary action and page-owned scrolling', () => {
    const expected = EXPECTED_PACKAGE_UI_WORKSPACES[0];
    expect(validateWorkspaceRuntimeMetrics(validMetrics(expected), expected)).toEqual({ passed: true, violations: [] });
  });

  it.each([
    ['100% exact viewport', { height: 700, width: 1200 }, 1, true],
    ['125% Windows height rounding by +2 CSS px', { height: 702, width: 1200 }, 1.25, true],
    ['layout drift beyond +2 CSS px', { height: 703, width: 1200 }, 1.25, false],
  ])('%s has the strict nominal viewport tolerance', (_label, actual, actualDeviceScaleFactor, passed) => {
    const result = evaluatePackageViewportContract({
      actual,
      actualDeviceScaleFactor,
      expectedDeviceScaleFactor: actualDeviceScaleFactor === 1 ? 1 : 1.25,
      requested: { height: 700, width: 1200 },
    });
    expect(result.passed).toBe(passed);
    expect(result).toEqual(expect.objectContaining({
      actual: { ...actual, deviceScaleFactor: actualDeviceScaleFactor },
      delta: {
        deviceScaleFactor: 0,
        height: actual.height - 700,
        width: actual.width - 1200,
      },
      requested: { deviceScaleFactor: actualDeviceScaleFactor === 1 ? 1 : 1.25, height: 700, width: 1200 },
      tolerance: { deviceScaleFactor: 0.02, height: 2, width: 2 },
    }));
  });

  it('rejects device scale factor drift beyond 0.02', () => {
    const result = evaluatePackageViewportContract({
      actual: { height: 700, width: 1200 },
      actualDeviceScaleFactor: 1.271,
      expectedDeviceScaleFactor: 1.25,
    });
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DEVICE_SCALE_FACTOR_DELTA' }),
    ]));
  });

  it.each([
    ['workspace identity', { root: { count: 1, workspace: 'product', subview: 'products' } }, 'WORKSPACE_IDENTITY_MISMATCH'],
    ['heading', { h1: { count: 2, labels: ['今日任务', '重复标题'] } }, 'H1_CONTRACT'],
    ['primary action', { primaryAction: { count: 0, labels: [] } }, 'PRIMARY_ACTION_CONTRACT'],
    ['horizontal overflow', { horizontalOverflow: { violations: [{ selector: '.app-content', overflowPx: 4 }] } }, 'PAGE_HORIZONTAL_OVERFLOW'],
    ['duplicate ids', { aria: { duplicateIds: ['duplicate'], brokenReferences: [] } }, 'DUPLICATE_DOM_ID'],
    ['broken aria refs', { aria: { duplicateIds: [], brokenReferences: [{ attribute: 'aria-labelledby', token: 'missing' }] } }, 'BROKEN_ARIA_REFERENCE'],
    ['nested scroll', { scrollOwnership: { defaultOwner: { declared: true, matchCount: 1 }, unlabelledActiveOwners: [{ selector: '.table-wrap' }] } }, 'UNLABELLED_SCROLL_OWNER'],
    ['workspace retained scroll position', { scrollOwnership: { defaultOwner: { declared: true, matchCount: 1, scrollTop: 120 }, unlabelledActiveOwners: [] } }, 'WORKSPACE_NOT_AT_TOP'],
    ['preview marker', { previewMarkers: ['仅开发预览'] }, 'PREVIEW_MARKER_PRESENT'],
  ])('rejects %s', (_label, overrides, code) => {
    const expected = EXPECTED_PACKAGE_UI_WORKSPACES[0];
    const result = validateWorkspaceRuntimeMetrics(validMetrics(expected, overrides), expected);
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });
});

describe('package object-workspace experience contract', () => {
  function validObjectMetrics(minFullyVisibleRows = 5) {
    return {
      contract: { passed: true, violations: [] },
      experience: {
        contract: { maxRenderedRows: 30, minAriaRowCount: 1, minFullyVisibleRows },
        enabled: true,
        initial: {
          ariaRowCount: 100,
          fullyVisibleRowCount: minFullyVisibleRows,
          renderedRowCount: 18,
          rowIndexes: Array.from({ length: 18 }, (_, index) => index),
          rowKeysUnique: true,
        },
        probe: {
          pageScrollLeakPx: 0,
          renderedRowCount: 19,
          restoredScrollTop: 0,
          rowKeysUnique: true,
          virtualWindowAdvanced: true,
        },
      },
    };
  }

  it('accepts the shared queue experience evidence only after the virtual window is restored and AI state is recorded', () => {
    const aiRunState = {
      ariaBusy: false,
      observed: true,
      statusLabel: '最近成功',
      text: 'AI 阶段分析已完成 · 使用真实广告数据 最近成功',
      tone: 'confirmed',
    };
    expect(validateObjectWorkspaceExperienceEvidence({
      aiRunState,
      capacity: { allRowsFit: false, ariaRowCount: 100, scrollable: true, visibleRowCapacity: 5 },
      metrics: validObjectMetrics(),
      requiredVisibleCapacity: 5,
      workspace: 'diagnosis',
    })).toEqual({
      aiRunState,
      capacity: { allRowsFit: false, ariaRowCount: 100, scrollable: true, visibleRowCapacity: 5 },
      contract: { maxRenderedRows: 30, minAriaRowCount: 1, minFullyVisibleRows: 5 },
      metrics: validObjectMetrics(),
      passed: true,
      probeApplicability: { applicable: true, passed: true, reason: 'scrollable-dataset' },
      requiredVisibleCapacity: 5,
      restored: true,
      rowCountCredible: true,
      violations: [],
      workspace: 'diagnosis',
    });
  });

  it('accepts a three-row product queue when the viewport proves five-row capacity and marks scroll probes not applicable', () => {
    const metrics = validObjectMetrics(3);
    metrics.contract = {
      passed: false,
      violations: [
        { code: 'QUEUE_VIRTUAL_WINDOW_STALE' },
        { code: 'QUEUE_SCROLL_OWNER' },
        { code: 'QUEUE_STICKY_HEADER' },
        { code: 'QUEUE_SCROLL_LEAK' },
      ],
    };
    metrics.experience.initial = {
      ariaRowCount: 3,
      fullyVisibleRowCount: 3,
      renderedRowCount: 3,
      rowIndexes: [0, 1, 2],
      rowKeysUnique: true,
    };
    metrics.experience.probe = {
      pageScrollLeakPx: 0,
      renderedRowCount: 3,
      restoredScrollTop: 0,
      rowKeysUnique: true,
      virtualWindowAdvanced: false,
    };
    const result = validateObjectWorkspaceExperienceEvidence({
      aiRunState: { observed: false, text: '' },
      capacity: { allRowsFit: true, ariaRowCount: 3, scrollable: false, visibleRowCapacity: 5 },
      metrics,
      requiredVisibleCapacity: 5,
      workspace: 'product',
    });
    expect(result.passed).toBe(true);
    expect(result.probeApplicability).toEqual({ applicable: false, passed: true, reason: 'short-dataset' });
    expect(result.restored).toBe(null);
    expect(result.rowCountCredible).toBe(true);
  });

  it.each([
    ['shared collector failure', { metrics: { ...validObjectMetrics(), contract: { passed: false, violations: [{ code: 'QUEUE_STICKY_HEADER' }] } } }, 'OBJECT_WORKSPACE_EXPERIENCE_CONTRACT'],
    ['scroll restoration failure', { metrics: { ...validObjectMetrics(), experience: { ...validObjectMetrics().experience, probe: { ...validObjectMetrics().experience.probe, restoredScrollTop: 42 } } } }, 'OBJECT_WORKSPACE_SCROLL_NOT_RESTORED'],
    ['missing diagnosis AI state', { aiRunState: { observed: false, text: '' } }, 'DIAGNOSIS_AI_STATE_MISSING'],
  ])('fails closed for %s', (_label, override, code) => {
    const result = validateObjectWorkspaceExperienceEvidence({
      aiRunState: { observed: true, text: '当前 AI 状态' },
      capacity: { allRowsFit: false, ariaRowCount: 100, scrollable: true, visibleRowCapacity: 5 },
      metrics: validObjectMetrics(),
      requiredVisibleCapacity: 5,
      workspace: 'diagnosis',
      ...override,
    });
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });

  it('rejects a short queue whose measured row viewport cannot hold the required compact capacity', () => {
    const metrics = validObjectMetrics(3);
    metrics.experience.initial.ariaRowCount = 3;
    metrics.experience.initial.renderedRowCount = 3;
    metrics.experience.initial.rowIndexes = [0, 1, 2];
    const result = validateObjectWorkspaceExperienceEvidence({
      aiRunState: { observed: false, text: '' },
      capacity: { allRowsFit: false, ariaRowCount: 3, scrollable: false, visibleRowCapacity: 4 },
      metrics,
      requiredVisibleCapacity: 5,
      workspace: 'product',
    });
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'QUEUE_CAPACITY_INSUFFICIENT' }),
    ]));
  });
});

describe('read-only object inspector evidence', () => {
  function validInspectorEvidence(overrides = {}) {
    return {
      escape: { closed: true, focusRestored: true, focusedRowKey: 'row-1' },
      expectedMode: 'drawer',
      inspector: {
        ariaModal: 'true',
        description: 'B0TEST / SKU-1 · 当前仅查看',
        mode: 'drawer',
        role: 'dialog',
        title: '测试产品',
        visible: true,
      },
      operationScope: {
        after: { asin: 'B0LOCKED', batchId: 'batch-1', marketplaceCode: 'US', storeName: 'demo' },
        before: { asin: 'B0LOCKED', batchId: 'batch-1', marketplaceCode: 'US', storeName: 'demo' },
      },
      row: {
        ariaLabel: '测试产品，ASIN B0TEST；按 Enter 或空格查看详情',
        key: 'row-1',
        selectedAfterClick: true,
        title: '测试产品',
      },
      screenshot: { path: 'product-row-inspector.png', sha256: HASH_A },
      workspace: 'product',
      ...overrides,
    };
  }

  it('accepts a drawer only when selection is read-only, identity-bound, captured, dismissed and focus-restored', () => {
    const input = validInspectorEvidence();
    expect(validateObjectInspectorEvidence(input)).toEqual({
      ...input,
      identityMatched: true,
      modeMatched: true,
      operationScopeUnchanged: true,
      passed: true,
      violations: [],
    });
  });

  it('accepts a wide inline inspector only when it is non-modal', () => {
    const result = validateObjectInspectorEvidence(validInspectorEvidence({
      expectedMode: 'inline',
      inspector: {
        ariaModal: null,
        description: 'Campaign / Ad group / B0TEST',
        mode: 'inline',
        role: 'complementary',
        title: 'keyword-one',
        visible: true,
      },
      operationScope: undefined,
      row: {
        ariaLabel: '复核 keyword-one，高 ACOS，ACOS 61%',
        key: 'diagnosis-row-1',
        selectedAfterClick: true,
        title: 'keyword-one',
      },
      escape: { closed: true, focusRestored: true, focusedRowKey: 'diagnosis-row-1' },
      workspace: 'diagnosis',
    }));
    expect(result.passed).toBe(true);
    expect(result.modeMatched).toBe(true);
  });

  it.each([
    ['row/inspector identity drift', { inspector: { ...validInspectorEvidence().inspector, title: '其他产品' } }, 'OBJECT_INSPECTOR_IDENTITY_MISMATCH'],
    ['product scope mutation', { operationScope: { before: { asin: 'B0LOCKED' }, after: { asin: 'B0TEST' } } }, 'PRODUCT_VIEW_MUTATED_OPERATION_SCOPE'],
    ['modal wide inspector', { expectedMode: 'inline', inspector: { ...validInspectorEvidence().inspector, mode: 'inline', role: 'complementary', ariaModal: 'true' } }, 'OBJECT_INSPECTOR_MODALITY_MISMATCH'],
    ['lost focus after Escape', { escape: { closed: true, focusRestored: false, focusedRowKey: null } }, 'OBJECT_INSPECTOR_FOCUS_NOT_RESTORED'],
  ])('fails closed for %s', (_label, override, code) => {
    const result = validateObjectInspectorEvidence(validInspectorEvidence(override));
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });
});

describe('read-only interactions and evidence completeness', () => {
  it('uses the same native summary-aware focus boundary as the renderer', () => {
    const source = readFileSync('scripts/package-ui-evidence.js', 'utf8');
    expect(source).toContain("  'summary',");
  });

  it('limits automation to navigation, three non-writing overlays and two read-only row inspectors', () => {
    const result = validateReadOnlyInteractionPlan();
    expect(result).toEqual({ passed: true, violations: [] });
    expect(EXPECTED_OVERLAY_CHECK_IDS).toEqual([
      'report-selector-dialog',
      'decisions-controlled-review-inspector',
      'readback-technical-drawer',
    ]);
    expect(READ_ONLY_INTERACTION_PLAN.filter((item) => item.kind === 'row-selection').map((item) => item.id)).toEqual([
      'product-read-only-row-inspector',
      'diagnosis-read-only-row-inspector',
    ]);
    const source = readFileSync('scripts/package-ui-evidence.js', 'utf8');
    expect(source.match(/electronApp: runOptions\.electronApp/g)).toHaveLength(3);
    expect(source).toContain('const api = window.electronAPI;');
    expect(source).not.toContain('window.desktopApi');
  });

  it('accepts only the stable enabled controlled-review trigger before the evidence runner clicks', () => {
    expect(validateOverlayTriggerContract({
      actionId: 'open-controlled-review-inspector',
      ariaDisabled: null,
      disabled: false,
      expectedActionId: 'open-controlled-review-inspector',
      rendered: true,
      tagName: 'button',
      triggerCount: 1,
    })).toEqual({ passed: true, violations: [] });
  });

  it('fails closed before clicking when the controlled-review row is absent or the primary action is mutating', () => {
    const absent = validateOverlayTriggerContract({
      expectedActionId: 'open-controlled-review-inspector',
      triggerCount: 0,
    });
    expect(absent.passed).toBe(false);
    expect(absent.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OVERLAY_TRIGGER_COUNT_MISMATCH' }),
    ]));

    const mutating = validateOverlayTriggerContract({
      actionId: 'generate-recommendations',
      ariaDisabled: null,
      disabled: false,
      expectedActionId: 'open-controlled-review-inspector',
      rendered: true,
      tagName: 'button',
      triggerCount: 1,
    });
    expect(mutating.passed).toBe(false);
    expect(mutating.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OVERLAY_TRIGGER_ACTION_MISMATCH' }),
    ]));
  });

  it('fails closed before clicking a hidden or disabled controlled-review trigger', () => {
    const result = validateOverlayTriggerContract({
      actionId: 'open-controlled-review-inspector',
      ariaDisabled: 'true',
      disabled: true,
      expectedActionId: 'open-controlled-review-inspector',
      rendered: false,
      tagName: 'button',
      triggerCount: 1,
    });
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OVERLAY_TRIGGER_DISABLED' }),
      expect.objectContaining({ code: 'OVERLAY_TRIGGER_NOT_RENDERED' }),
    ]));
  });

  it('accepts a one-control dialog only when Shift+Tab and Tab both retain that unique control inside the dialog', () => {
    const uniqueControl = { evidenceBoundary: 'single', id: 'close-drawer', insideDialog: true, tag: 'button' };
    const result = validateOverlayKeyboardEvidence({
      backwardFocus: uniqueControl,
      focusableCount: 1,
      forwardFocus: uniqueControl,
    });

    expect(result).toEqual({
      mode: 'single-control',
      passed: true,
      singleControlEvidence: {
        shiftTabRetained: true,
        tabRetained: true,
        uniqueBoundary: 'single',
      },
      violations: [],
    });
  });

  it('fails closed for zero controls and when either single-control keypress escapes the dialog', () => {
    const noControls = validateOverlayKeyboardEvidence({ focusableCount: 0 });
    expect(noControls.passed).toBe(false);
    expect(noControls.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OVERLAY_FOCUSABLE_CONTROL_MISSING' }),
    ]));

    const escaped = validateOverlayKeyboardEvidence({
      backwardFocus: { evidenceBoundary: null, insideDialog: false },
      focusableCount: 1,
      forwardFocus: { evidenceBoundary: 'single', insideDialog: true },
    });
    expect(escaped.passed).toBe(false);
    expect(escaped.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SINGLE_CONTROL_SHIFT_TAB_ESCAPED' }),
    ]));
  });

  it('preserves first/last bidirectional wrapping evidence when a dialog has multiple controls', () => {
    const result = validateOverlayKeyboardEvidence({
      backwardFocus: { evidenceBoundary: 'last', insideDialog: true },
      focusableCount: 2,
      forwardFocus: { evidenceBoundary: 'first', insideDialog: true },
    });
    expect(result).toEqual({
      mode: 'multi-control-wrap',
      multiControlEvidence: { backwardWrapped: true, forwardWrapped: true },
      passed: true,
      violations: [],
    });
  });

  it('requires protected state, process cleanup, 100% and 125%, eight workspaces, three overlay checks and hashed screenshots', () => {
    const valid = {
      artifactHashesStable: true,
      schemaVersion: 5,
      packageProcessIsolation: validProcessIsolation(),
      profileDatabaseProvenance: { passed: true },
      profileProcessIsolation: validProcessIsolation(),
      protectedDatabase: { passed: true },
      runs: EXPECTED_PACKAGE_UI_SCALES.map(validRun),
      wideProfile: validWideRun(),
    };
    expect(evaluatePackageUiEvidenceCompleteness(valid)).toEqual({ passed: true, violations: [] });

    const legacySchema = evaluatePackageUiEvidenceCompleteness({ ...valid, schemaVersion: 4 });
    expect(legacySchema.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PACKAGE_UI_SCHEMA_V5_REQUIRED' }),
    ]));

    const missingTopLevelProfileIsolation = structuredClone(valid);
    delete missingTopLevelProfileIsolation.profileProcessIsolation;
    expect(evaluatePackageUiEvidenceCompleteness(missingTopLevelProfileIsolation).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROFILE_PROCESS_CLEANUP_FAILED' }),
    ]));

    const incompleteTopLevelProcessSnapshot = structuredClone(valid);
    incompleteTopLevelProcessSnapshot.packageProcessIsolation.before = {
      error: null,
      matchingCount: 0,
      passed: true,
      unresolvedCount: 0,
    };
    expect(evaluatePackageUiEvidenceCompleteness(incompleteTopLevelProcessSnapshot).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PACKAGE_PROCESS_CLEANUP_FAILED' }),
    ]));

    const leakedScaleProfile = structuredClone(valid);
    leakedScaleProfile.runs[0].profileProcessIsolation.after.matchingCount = 1;
    leakedScaleProfile.runs[0].profileProcessIsolation.passed = false;
    expect(evaluatePackageUiEvidenceCompleteness(leakedScaleProfile).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_PROFILE_PROCESS_ISOLATION_FAILED' }),
    ]));

    const missingScaleDiagnostics = structuredClone(valid);
    delete missingScaleDiagnostics.runs[0].diagnostics;
    expect(evaluatePackageUiEvidenceCompleteness(missingScaleDiagnostics).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_DIAGNOSTICS_MISSING_OR_FAILED' }),
    ]));

    const droppedScaleDiagnostics = structuredClone(valid);
    droppedScaleDiagnostics.runs[0].diagnostics.renderer.droppedCount.consoleErrors = 1;
    expect(evaluatePackageUiEvidenceCompleteness(droppedScaleDiagnostics).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_DIAGNOSTICS_MISSING_OR_FAILED' }),
    ]));

    const leakedWideProduct = structuredClone(valid);
    leakedWideProduct.wideProfile.packageProcessIsolation.after.matchingCount = 1;
    leakedWideProduct.wideProfile.packageProcessIsolation.passed = false;
    expect(evaluatePackageUiEvidenceCompleteness(leakedWideProduct).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WIDE_PACKAGE_PROCESS_ISOLATION_FAILED' }),
    ]));

    const missingScale = evaluatePackageUiEvidenceCompleteness({
      artifactHashesStable: true,
      runs: [validRun(EXPECTED_PACKAGE_UI_SCALES[0])],
    });
    expect(missingScale.passed).toBe(false);
    expect(missingScale.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_RUN_MISSING' }),
    ]));

    const unstable = evaluatePackageUiEvidenceCompleteness({ ...valid, artifactHashesStable: false });
    expect(unstable.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ARTIFACT_CHANGED_DURING_RUN' }),
    ]));

    const changedDatabase = evaluatePackageUiEvidenceCompleteness({
      ...valid,
      protectedDatabase: { passed: false },
    });
    expect(changedDatabase.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROTECTED_DATABASE_CHANGED_DURING_RUN' }),
    ]));

    const unrelatedProfileDatabase = evaluatePackageUiEvidenceCompleteness({
      ...valid,
      profileDatabaseProvenance: { passed: false },
    });
    expect(unrelatedProfileDatabase.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROFILE_DATABASE_PROVENANCE_FAILED' }),
    ]));

    const leakedProcess = evaluatePackageUiEvidenceCompleteness({
      ...valid,
      packageProcessIsolation: {
        ...validProcessIsolation(),
        after: validProcessSnapshot({ matching: [{ processId: 1 }], matchingCount: 1 }),
        passed: false,
      },
    });
    expect(leakedProcess.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PACKAGE_PROCESS_CLEANUP_FAILED' }),
    ]));

    const unsettledWorkspace = structuredClone(valid);
    unsettledWorkspace.runs[0].workspaceChecks[0].settleEvidence.passed = false;
    expect(evaluatePackageUiEvidenceCompleteness(unsettledWorkspace).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WORKSPACE_NOT_SETTLED_FOR_CAPTURE' }),
    ]));

    const staleOverlayFrame = structuredClone(valid);
    staleOverlayFrame.runs[0].overlayChecks[0].overlayVisibleAfterCapture = false;
    expect(evaluatePackageUiEvidenceCompleteness(staleOverlayFrame).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OVERLAY_NOT_STABLE_FOR_CAPTURE' }),
    ]));

    const missingOverlayScreenshot = structuredClone(valid);
    delete missingOverlayScreenshot.runs[0].overlayChecks[0].screenshot;
    const missingOverlayScreenshotResult = evaluatePackageUiEvidenceCompleteness(missingOverlayScreenshot);
    expect(missingOverlayScreenshotResult.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OVERLAY_SCREENSHOT_MISSING_OR_UNHASHED' }),
    ]));

    const consoleFailure = structuredClone(valid);
    consoleFailure.runs[0].consoleErrors.push('renderer failed');
    expect(evaluatePackageUiEvidenceCompleteness(consoleFailure).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'RENDERER_CONSOLE_ERROR' }),
    ]));

    const rounded125 = structuredClone(valid);
    rounded125.runs.find((run) => run.scalePercent === 125).viewport.height = 702;
    expect(evaluatePackageUiEvidenceCompleteness(rounded125)).toEqual({ passed: true, violations: [] });

    const drifted125 = structuredClone(valid);
    drifted125.runs.find((run) => run.scalePercent === 125).viewport.height = 703;
    expect(evaluatePackageUiEvidenceCompleteness(drifted125).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_VIEWPORT_MISMATCH' }),
    ]));

    const missingWideProfile = structuredClone(valid);
    delete missingWideProfile.wideProfile;
    expect(evaluatePackageUiEvidenceCompleteness(missingWideProfile).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WIDE_PROFILE_MISSING' }),
    ]));
  });
});
