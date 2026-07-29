import {
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import missionControlEvidenceContract from './mission-control-ui-evidence-contract.js';
import evidenceModule from './package-ui-evidence.js';
import runnerModule from './run-package-ui-evidence.js';

const HASH_A = 'A'.repeat(64);
const HASH_B = 'B'.repeat(64);
const USER_DATA_DIR = 'D:\\Temp\\amazon-ai-ops-package-ui\\profile-copy';
const PROTECTED_DB_PATH = 'C:\\Users\\wz\\AppData\\Roaming\\@amazon-ai-ops\\desktop\\amazon-ai-ops.db';
const CURRENT_ARTIFACT_ROOT = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-current-'));
const requireFromLocalDb = createRequire(
  path.resolve('packages', 'local-db', 'package.json'),
);
const Database = requireFromLocalDb('better-sqlite3');
const { MISSION_CONTROL_WORKSPACE_CONTRACT } = missionControlEvidenceContract;

afterAll(() => {
  rmSync(CURRENT_ARTIFACT_ROOT, { force: true, recursive: true });
});

const {
  EXPECTED_OVERLAY_CHECK_IDS,
  EXPECTED_PACKAGE_UI_SCALES,
  EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
  EXPECTED_PACKAGE_UI_WORKSPACES,
  INTERACTIVE_LOGIN_CONTRACT,
  ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
  PACKAGE_UI_WIDE_PROFILE,
  PACKAGE_UI_PROFILE_ATTEMPT_SCHEMA_VERSION,
  PACKAGE_UI_PROFILE_SEQUENCE,
  READ_ONLY_INTERACTION_PLAN,
  buildAppContentManifest,
  buildPackageUiAttemptArtifactManifest,
  buildPackageUiRunnerContract,
  assertPackageUiRuntimeLoginBoundary,
  buildProcessIsolationEvidence,
  buildProtectedFileEvidence,
  buildProductionBuildContentManifest,
  appendRendererDiagnostic,
  attachElectronLifecycleDiagnostics,
  captureViewportScreenshot,
  captureSqliteLogicalArtifact,
  chromiumLineageEvidencePassed,
  collectActiveBundledChromiumLineage,
  collectElectronIdentity,
  collectMatchingPackageProcesses,
  collectMatchingProfileBrowserProcesses,
  composePackageUiRunGroup,
  createRunDiagnostics,
  createPackageUiProfileAttemptContext,
  initializePackageUiRunGroup,
  decisionsTabAccessibleNamePattern,
  evaluatePackageViewportContract,
  evaluatePackageUiEvidenceCompleteness,
  evaluateProfileDatabaseFileIsolation,
  evaluateProfileDatabaseProvenance,
  executeEvidenceRunWithIsolation,
  extractProfileUserDataDirectories,
  hasAuthenticatedWorkspace,
  isWorkspaceProbeAbsenceError,
  isRetryableLoginNavigationError,
  latestProductionSourceWatermark,
  parsePackageUiEvidenceArgs,
  packageUiAttemptArtifactManifestMatches,
  packageUiAttemptCleanupPassed,
  packageUiAttemptDiagnosticsSnapshotMatches,
  profileLineageStateMatches,
  markRunnerElectronCloseRequested,
  recordPackageUiProfileAttempt,
  resolvePackageUiProfileCursor,
  sanitizeDiagnosticText,
  selectDeterministicEvidenceStoreCandidate,
  validateOverlayKeyboardEvidence,
  validateWorkspaceTabKeyboardEvidence,
  validateOverlayTriggerContract,
  validatePackageIdentity,
  validatePackageUiDatabaseCheckpointReceipts,
  validatePackageUiDatabaseMutationAudit,
  validatePackageUiReadOnlyRuntimeEvidence,
  validatePackageFreshness,
  validateReadOnlyInteractionPlan,
  validateIsolatedProfileBootstrapEvidence,
  validateLoginSessionAttestation,
  validateSchedulerSubviewEvidence,
  validateSchedulerSubviewRuntimeBinding,
  validateObjectWorkspaceExperienceEvidence,
  validateObjectInspectorEvidence,
  validateWorkspaceRuntimeMetrics,
  validRunDiagnostics,
  waitForPackageProcessCleanup,
  waitForProfileBrowserProcessCleanup,
  waitForInteractiveAuthenticatedWorkspace,
  waitForRendererComposite,
  waitForWorkspaceSettled,
  writeImmutableEnvelope,
  writePackageUiProfileCheckpoint,
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

  it('requires a visible workspace with the visible login surface gone', async () => {
    const page = (visibility) => ({
      locator: (selector) => ({
        isVisible: async () => visibility[selector] === true,
        waitFor: async () => {
          if (visibility[selector] !== true) {
            throw Object.assign(new Error('locator.waitFor: Timeout 2000ms exceeded.'), {
              name: 'TimeoutError',
            });
          }
        },
      }),
    });
    const workspaceSelector = 'nav[aria-label="主业务导航"]';
    const loginSelector = '[data-login-connection-status]';

    await expect(hasAuthenticatedWorkspace(page({
      [workspaceSelector]: true,
      [loginSelector]: false,
    }))).resolves.toBe(true);
    await expect(hasAuthenticatedWorkspace(page({
      [workspaceSelector]: false,
      [loginSelector]: false,
    }))).resolves.toBe(false);
    await expect(hasAuthenticatedWorkspace(page({
      [workspaceSelector]: true,
      [loginSelector]: true,
    }))).resolves.toBe(false);
  });

  it('classifies an operator-window close during the visible login handoff', async () => {
    const closedError = new Error('locator.isVisible: Target page, context or browser has been closed');
    const page = {
      isClosed: () => true,
      locator: () => ({
        isVisible: async () => {
          throw closedError;
        },
      }),
      waitForTimeout: async () => {
        throw closedError;
      },
    };

    await expect(waitForInteractiveAuthenticatedWorkspace(page, 1_000))
      .rejects.toThrow(/PACKAGE_UI_OPERATOR_WINDOW_CLOSED/);
  });

  it('selects the first explicit active Store Gate option deterministically without retaining an unbounded label', () => {
    expect(selectDeterministicEvidenceStoreCandidate([
      { label: '请选择店铺', value: '' },
      { label: '  SHC001\u0000 · US · USD  ', value: ' store-us-001 ' },
      { label: 'SHC002 · US · USD', value: 'store-us-002' },
    ])).toEqual({
      label: '  SHC001 · US · USD  ',
      value: 'store-us-001',
    });
    expect(selectDeterministicEvidenceStoreCandidate(null)).toBeNull();
    expect(selectDeterministicEvidenceStoreCandidate([{ label: '请选择店铺', value: '' }])).toBeNull();
  });

  it('handles the first-run Store Gate through visible controls before probing saved login', () => {
    const source = readFileSync('scripts/package-ui-evidence.js', 'utf8');
    const connectionBody = source.slice(
      source.indexOf('async function ensureEvidenceLingxingConnection'),
      source.indexOf('function selectDeterministicEvidenceStoreCandidate'),
    );
    const storeGateBody = source.slice(
      source.indexOf('async function ensureEvidenceStoreContext'),
      source.indexOf('async function ensureAuthenticatedWorkspace'),
    );
    const authenticationBody = source.slice(
      source.indexOf('async function ensureAuthenticatedWorkspace'),
      source.indexOf('async function elementDescriptor'),
    );

    expect(storeGateBody).toContain("page.locator('#mission-control-store-name')");
    expect(storeGateBody).toContain("page.getByRole('button', { name: '创建美国站店铺', exact: true })");
    expect(storeGateBody).toContain("page.locator('#mission-control-store-select')");
    expect(storeGateBody).toContain("page.getByRole('button', { name: '进入所选店铺', exact: true })");
    expect(storeGateBody).toContain('created-and-selected-isolated-evidence-store');
    expect(storeGateBody).toContain('selected-existing-store');
    expect(storeGateBody).not.toMatch(/window\.(?:api|electron|electronAPI)|ipcRenderer|stores:create/);
    expect(connectionBody).toContain('[data-login-connection-status]');
    expect(connectionBody).toContain('[data-package-ui-evidence-action="bind-lingxing-connection"]');
    expect(connectionBody).toContain('bound-isolated-evidence-lingxing-connection');
    expect(connectionBody).not.toMatch(/window\.(?:api|electron|electronAPI)|ipcRenderer|stores:connections:create/);
    expect(authenticationBody.indexOf("entrySurface?.kind === 'store-gate'")).toBeGreaterThan(-1);
    expect(authenticationBody.indexOf('ensureEvidenceStoreContext(page, options.diagnostics)'))
      .toBeLessThan(authenticationBody.indexOf('hasAuthenticatedWorkspace(page)'));
  });

  it('validates bounded Store Gate and Lingxing connection bootstrap without retaining an account label', () => {
    const diagnostics = validDiagnostics('100-compact');
    const session = validSession('100-compact');
    expect(validateIsolatedProfileBootstrapEvidence(session, diagnostics)).toEqual(
      expect.objectContaining({ passed: true, violations: [] }),
    );

    const leaked = structuredClone(session);
    leaked.storeGate.selectedStore.displayName = 'real-store-name';
    expect(validateIsolatedProfileBootstrapEvidence(leaked, diagnostics).violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ISOLATED_PROFILE_EXISTING_STORE_REFERENCE_UNBOUNDED' }),
      ]),
    );
  });

  it('rejects a completed run whose login outcome contradicts its authenticated session mode', () => {
    const run = validRun(EXPECTED_PACKAGE_UI_SCALES[0]);
    expect(validRunDiagnostics(run.diagnostics, run)).toBe(true);
    run.diagnostics.login.outcome = 'failed';
    expect(validRunDiagnostics(run.diagnostics, run)).toBe(false);
  });

  it.each([
    ['missing lifecycle', (run) => { delete run.diagnostics.lifecycle; }],
    ['unrequested close', (run) => { run.diagnostics.lifecycle.unexpectedCloseObserved = true; }],
    ['non-zero Electron exit', (run) => {
      run.diagnostics.lifecycle.processExit.code = 1;
      const exitEvent = run.diagnostics.lifecycle.events.find(
        (event) => event.kind === 'electron-process-exit',
      );
      exitEvent.code = 1;
    }],
    ['terminal event before runner close', (run) => {
      const closedEvent = run.diagnostics.lifecycle.events.find(
        (event) => event.kind === 'window-closed',
      );
      closedEvent.runnerCloseRequested = false;
    }],
    ['renderer crash', (run) => {
      run.diagnostics.lifecycle.events.push({
        at: '2026-07-17T06:00:00.775Z',
        kind: 'window-crashed',
        phase: 'electron-close',
        runnerCloseRequested: true,
        windowId: 1,
      });
    }],
    ['duplicate runner-close marker', (run) => {
      const marker = run.diagnostics.lifecycle.events.find(
        (event) => event.kind === 'runner-close-requested',
      );
      run.diagnostics.lifecycle.events.splice(2, 0, { ...marker });
    }],
    ['detached process-exit timestamp', (run) => {
      run.diagnostics.lifecycle.processExit.at = '2026-07-17T06:00:00.901Z';
    }],
    ['non-monotonic event order', (run) => {
      const events = run.diagnostics.lifecycle.events;
      [events[2], events[3]] = [events[3], events[2]];
    }],
    ['window attached only after runner close', (run) => {
      const events = run.diagnostics.lifecycle.events;
      const attached = events.shift();
      attached.at = '2026-07-17T06:00:00.725Z';
      attached.runnerCloseRequested = true;
      events.splice(1, 0, attached);
    }],
    ['event recorded after process exit', (run) => {
      run.diagnostics.lifecycle.events.push({
        at: '2026-07-17T06:00:00.950Z',
        kind: 'main-frame-navigated',
        phase: 'electron-close',
        runnerCloseRequested: true,
        windowId: 1,
      });
    }],
  ])('rejects completed evidence with %s', (_label, mutate) => {
    const run = validRun(EXPECTED_PACKAGE_UI_SCALES[0]);
    mutate(run);
    expect(validRunDiagnostics(run.diagnostics, run)).toBe(false);
  });

  it('binds durable attempt diagnostics to the exact profile receipt', () => {
    const diagnostics = validDiagnostics('100-compact');
    expect(packageUiAttemptDiagnosticsSnapshotMatches(diagnostics, '100-compact')).toBe(true);
    expect(packageUiAttemptDiagnosticsSnapshotMatches(diagnostics, '125-compact')).toBe(false);
  });

  it.each([
    'workspace-reached',
    'workspace-reached-after-navigation',
  ])('accepts a numbered, ordered saved-login retry sequence ending in %s', (finalOutcome) => {
    const run = validSavedLoginRun(EXPECTED_PACKAGE_UI_SCALES[0]);
    run.diagnostics.login.attempts[1].outcome = finalOutcome;
    expect(validRunDiagnostics(run.diagnostics, run)).toBe(true);
  });

  it.each([
    ['non-sequential attempt numbering', (run) => { run.diagnostics.login.attempts[1].attempt = 3; }],
    ['attempt start before the login window', (run) => {
      run.diagnostics.login.attempts[0].startedAt = '2026-07-17T06:00:00.050Z';
    }],
    ['attempt completion after the login window', (run) => {
      run.diagnostics.login.attempts[1].completedAt = '2026-07-17T06:00:00.600Z';
    }],
    ['attempt completion before its start', (run) => {
      run.diagnostics.login.attempts[1].completedAt = '2026-07-17T06:00:00.290Z';
    }],
    ['overlapping attempts', (run) => {
      run.diagnostics.login.attempts[1].startedAt = '2026-07-17T06:00:00.240Z';
    }],
    ['retry outcome without retryable=true', (run) => {
      run.diagnostics.login.attempts[0].retryable = false;
    }],
    ['success before the final attempt', (run) => {
      run.diagnostics.login.attempts[0].outcome = 'workspace-reached';
      run.diagnostics.login.attempts[0].retryable = false;
    }],
    ['final retry instead of success', (run) => {
      run.diagnostics.login.attempts[1].outcome = 'retryable-navigation';
      run.diagnostics.login.attempts[1].retryable = true;
    }],
    ['final success incorrectly marked retryable', (run) => {
      run.diagnostics.login.attempts[1].retryable = true;
    }],
  ])('rejects saved-login diagnostics with %s', (_label, mutate) => {
    const run = validSavedLoginRun(EXPECTED_PACKAGE_UI_SCALES[0]);
    mutate(run);
    expect(validRunDiagnostics(run.diagnostics, run)).toBe(false);
  });

  it('requires zero attempts when an existing session reaches the workspace without saved login', () => {
    const run = validRun(EXPECTED_PACKAGE_UI_SCALES[0]);
    expect(validRunDiagnostics(run.diagnostics, run)).toBe(true);
    run.diagnostics.login.attempts.push({
      attempt: 1,
      completedAt: '2026-07-17T06:00:00.450Z',
      outcome: 'workspace-reached',
      retryable: false,
      startedAt: '2026-07-17T06:00:00.300Z',
    });
    expect(validRunDiagnostics(run.diagnostics, run)).toBe(false);
  });

  it('rejects stripped Store Gate diagnostics even when the session retains a selected-store hash', () => {
    const run = validRun(EXPECTED_PACKAGE_UI_SCALES[0]);
    run.diagnostics.storeGate = {
      outcome: run.session.storeGate.outcome,
      selectedStore: {
        idSha256: run.session.storeGate.selectedStore.idSha256,
      },
    };
    expect(validRunDiagnostics(run.diagnostics, run)).toBe(false);
    expect(validateIsolatedProfileBootstrapEvidence(run.session, run.diagnostics).violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ISOLATED_PROFILE_STORE_DIAGNOSTICS_MISMATCH' }),
      ]),
    );
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
    'playwright-browsers/chrome-win64/chrome.exe': 'chromium-runtime',
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

  it('falls back from a failed package CIM query to an exact-name Get-Process snapshot with no matches', () => {
    const executablePath = path.resolve('apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe');
    const commands = [];
    const snapshot = collectMatchingPackageProcesses(executablePath, (_file, args) => {
      commands.push(String(args.at(-1)));
      return commands.length === 1
        ? { status: 1, stdout: '', stderr: 'HRESULT 0x80041006 WBEM resource limit' }
        : { status: 0, stdout: '[]', stderr: '' };
    });

    expect(snapshot).toEqual(expect.objectContaining({
      collectionMethod: 'get-process-fallback',
      error: null,
      matching: [],
      matchingCount: 0,
      observedCount: 0,
      passed: true,
      primaryError: expect.stringContaining('0x80041006'),
      unresolved: [],
      unresolvedCount: 0,
    }));
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain('Get-CimInstance Win32_Process');
    expect(commands[1]).toContain('Get-Process -ErrorAction Stop');
    expect(commands[1]).toContain('$expectedName');
  });

  it('detects the exact packaged executable through the Get-Process fallback and permits a null parent PID', () => {
    const executablePath = path.resolve('apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe');
    let calls = 0;
    const snapshot = collectMatchingPackageProcesses(executablePath, () => {
      calls += 1;
      return calls === 1
        ? { status: 1, stdout: '', stderr: 'CIM unavailable' }
        : {
            status: 0,
            stdout: JSON.stringify([{
              ExecutablePath: executablePath,
              Name: 'AmazonAIOpsAgent.exe',
              ParentProcessId: null,
              ProcessId: 4321,
            }]),
            stderr: '',
          };
    });

    expect(snapshot).toEqual(expect.objectContaining({
      collectionMethod: 'get-process-fallback',
      matchingCount: 1,
      observedCount: 1,
      passed: true,
      unresolvedCount: 0,
    }));
    expect(snapshot.matching[0]).toEqual({
      executablePath,
      name: 'AmazonAIOpsAgent.exe',
      parentProcessId: null,
      processId: 4321,
    });
  });

  it('keeps Get-Process fallback failures and unresolved executable paths fail-closed', () => {
    const executablePath = path.resolve('apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe');
    let calls = 0;
    const fallbackFailure = collectMatchingPackageProcesses(executablePath, () => {
      calls += 1;
      return calls === 1
        ? { status: 1, stdout: '', stderr: 'CIM unavailable' }
        : { status: 1, stdout: '', stderr: 'Get-Process denied' };
    });
    expect(fallbackFailure).toEqual(expect.objectContaining({
      collectionMethod: 'get-process-fallback',
      matchingCount: null,
      observedCount: null,
      passed: false,
      unresolvedCount: null,
    }));
    expect(fallbackFailure.error).toContain('fallback: Get-Process denied');

    calls = 0;
    const unresolved = collectMatchingPackageProcesses(executablePath, () => {
      calls += 1;
      return calls === 1
        ? { status: 1, stdout: '', stderr: 'CIM unavailable' }
        : {
            status: 0,
            stdout: JSON.stringify([{
              ExecutablePath: null,
              Name: 'AmazonAIOpsAgent.exe',
              ParentProcessId: null,
              ProcessId: 9876,
            }]),
            stderr: '',
          };
    });
    expect(unresolved).toEqual(expect.objectContaining({
      collectionMethod: 'get-process-fallback',
      matchingCount: 0,
      observedCount: 1,
      passed: false,
      unresolvedCount: 1,
    }));
    expect(unresolved.unresolved[0].parentProcessId).toBeNull();
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
      profilePathBindingSha256: expect.stringMatching(/^[A-F0-9]{64}$/),
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

  it('matches store-bound browser profiles nested under the isolated stores root', () => {
    const profileRoot = path.join(USER_DATA_DIR, 'stores');
    const storeProfilePath = path.join(
      profileRoot,
      'store-one',
      'browser',
      'profile-one',
      'lingxing',
    );
    const snapshot = collectMatchingProfileBrowserProcesses(profileRoot, () => ({
      status: 0,
      stdout: JSON.stringify([
        {
          CommandLine: `"C:\\browser\\chrome.exe" --user-data-dir="${storeProfilePath}" --type=browser`,
          ExecutablePath: 'C:\\browser\\chrome.exe',
          Name: 'chrome.exe',
          ParentProcessId: 30,
          ProcessId: 31,
        },
        {
          CommandLine: `"C:\\browser\\chrome.exe" --user-data-dir="${path.join(USER_DATA_DIR, 'storage', 'browser-data')}"`,
          ExecutablePath: 'C:\\browser\\chrome.exe',
          Name: 'chrome.exe',
          ParentProcessId: 40,
          ProcessId: 41,
        },
      ]),
      stderr: '',
    }));

    expect(snapshot).toEqual(expect.objectContaining({
      matchingCount: 1,
      observedCount: 2,
      passed: true,
      profilePath: path.resolve(profileRoot),
    }));
    expect(snapshot.matching[0]).toEqual(expect.objectContaining({ processId: 31, profileMatched: true }));
  });

  it('uses Get-Process plus targeted CIM as the profile fallback and still matches only the exact user-data-dir', () => {
    const profilePath = path.join(USER_DATA_DIR, 'storage', 'browser-data');
    const commands = [];
    const snapshot = collectMatchingProfileBrowserProcesses(profilePath, (_file, args) => {
      commands.push(String(args.at(-1)));
      return commands.length === 1
        ? { status: 1, stdout: '', stderr: 'HRESULT 0x800706be CIM unavailable' }
        : {
            status: 0,
            stdout: JSON.stringify([{
              CommandLine: `"C:\\browser\\chrome.exe" --user-data-dir="${profilePath}" --type=browser`,
              ExecutablePath: 'C:\\browser\\chrome.exe',
              Name: 'chrome.exe',
              ParentProcessId: 42,
              ProcessId: 43,
            }]),
            stderr: '',
          };
    });

    expect(snapshot).toEqual(expect.objectContaining({
      collectionMethod: 'get-process-targeted-cim-fallback',
      matchingCount: 1,
      observedCount: 1,
      passed: true,
      primaryError: expect.stringContaining('0x800706be'),
      unresolvedCount: 0,
    }));
    expect(commands[1]).toContain('Get-Process -ErrorAction Stop');
    expect(commands[1]).toContain('Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"');
    expect(JSON.stringify(snapshot)).not.toContain('--user-data-dir');
  });

  it('ignores unrelated unreadable daily browsers but fails closed for the target profile or bundled executable', () => {
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
      ignoredUnresolvedCount: 1,
      passed: true,
      unresolvedCount: 0,
    }));

    const newlyUnreadable = collectMatchingProfileBrowserProcesses(
      profilePath,
      { baselineProcessIds: [11] },
      () => ({
        status: 0,
        stdout: JSON.stringify([
          {
            CommandLine: null,
            ExecutablePath: 'C:\\browser\\chrome.exe',
            Name: 'chrome.exe',
            ParentProcessId: 10,
            ProcessId: 11,
          },
          {
            CommandLine: null,
            ExecutablePath: null,
            Name: 'chrome.exe',
            ParentProcessId: null,
            ProcessId: 14,
          },
        ]),
        stderr: '',
      }),
    );
    expect(newlyUnreadable).toEqual(expect.objectContaining({
      matchingCount: 0,
      passed: false,
      unresolvedCount: 1,
    }));
    expect(newlyUnreadable.unresolved[0].processId).toBe(14);

    const missingPath = collectMatchingProfileBrowserProcesses(profilePath, () => ({
      status: 0,
      stdout: JSON.stringify([{
        CommandLine: `"chrome.exe" --user-data-dir="${profilePath}"`,
        ExecutablePath: null,
        Name: 'chrome.exe',
        ParentProcessId: null,
        ProcessId: 12,
      }]),
      stderr: '',
    }));
    expect(missingPath).toEqual(expect.objectContaining({
      matchingCount: 0,
      passed: false,
      unresolvedCount: 1,
    }));

    const bundledPath = 'D:\\App\\resources\\app\\playwright-browsers\\chrome-win64\\chrome.exe';
    const unreadableBundled = collectMatchingProfileBrowserProcesses(
      profilePath,
      { expectedExecutablePath: bundledPath },
      () => ({
        status: 0,
        stdout: JSON.stringify([{
          CommandLine: null,
          ExecutablePath: bundledPath,
          Name: 'chrome.exe',
          ParentProcessId: 10,
          ProcessId: 13,
        }]),
        stderr: '',
      }),
    );
    expect(unreadableBundled).toEqual(expect.objectContaining({
      matchingCount: 0,
      mismatchedCount: 1,
      passed: false,
      unresolvedCount: 0,
    }));
  });

  it('binds the packaged Chromium hash, target root and descendants without retaining command lines', () => {
    const appContentPath = 'D:\\App\\resources\\app';
    const chromiumPath = path.join(
      appContentPath,
      'playwright-browsers',
      'chrome-win64',
      'chrome.exe',
    );
    const profilePath = path.join(USER_DATA_DIR, 'stores', 'store-one', 'browser', 'lingxing');
    const evidence = collectActiveBundledChromiumLineage({
      appContentPath,
      chromiumArtifact: { sha256: HASH_A, sizeBytes: 1234 },
      userDataDir: USER_DATA_DIR,
    }, () => ({
      status: 0,
      stdout: JSON.stringify([
        {
          CommandLine: `"${chromiumPath}" --user-data-dir="${profilePath}"`,
          ExecutablePath: chromiumPath,
          Name: 'chrome.exe',
          ParentProcessId: 900,
          ProcessId: 901,
        },
        {
          CommandLine: `"${chromiumPath}" --type=renderer`,
          ExecutablePath: chromiumPath,
          Name: 'chrome.exe',
          ParentProcessId: 901,
          ProcessId: 902,
        },
        {
          CommandLine: null,
          ExecutablePath: null,
          Name: 'msedge.exe',
          ParentProcessId: 50,
          ProcessId: 51,
        },
      ]),
      stderr: '',
    }));

    expect(evidence).toEqual(expect.objectContaining({
      descendantProcessIds: [902],
      expectedProfileRootSha256: expect.stringMatching(/^[A-F0-9]{64}$/),
      passed: true,
      profileBindingSha256: expect.stringMatching(/^[A-F0-9]{64}$/),
      profileBindingTokenCount: 1,
      rootProcessIds: [901],
    }));
    expect(evidence.chromium).toEqual(expect.objectContaining({
      sha256: HASH_A,
      sizeBytes: 1234,
    }));
    expect(chromiumLineageEvidencePassed(evidence)).toBe(true);
    expect(chromiumLineageEvidencePassed({
      ...evidence,
      profileBindingSha256: HASH_B,
      snapshot: {
        ...evidence.snapshot,
        profileBindingSha256: HASH_B,
      },
    })).toBe(false);
    expect(JSON.stringify(evidence)).not.toContain('--user-data-dir');
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
    expect(sanitizeDiagnosticText('登录 operator@example.com 失败')).toBe('登录 [REDACTED_ACCOUNT] 失败');
    expect(validRunDiagnostics(result.diagnostics, result)).toBe(false);
  });

  it('records whether Electron closed before or after the evidence runner requested shutdown', () => {
    const diagnostics = createRunDiagnostics('100-compact', new Date('2026-07-28T08:00:00.000Z'));
    const electronApp = new EventEmitter();
    const electronContext = new EventEmitter();
    const electronProcess = new EventEmitter();
    electronApp.context = () => electronContext;
    electronApp.process = () => electronProcess;
    const observer = attachElectronLifecycleDiagnostics(electronApp, diagnostics);
    const mainPage = new EventEmitter();
    const mainFrame = {};
    mainPage.mainFrame = () => mainFrame;

    observer.attachPage(mainPage);
    mainPage.emit('framenavigated', mainFrame);
    mainPage.emit('close');
    markRunnerElectronCloseRequested(diagnostics);
    electronContext.emit('close');
    electronApp.emit('close');
    electronProcess.emit('exit', 0, null);

    expect(diagnostics.lifecycle).toEqual(expect.objectContaining({
      droppedCount: 0,
      runnerCloseRequestedAt: expect.any(String),
      unexpectedCloseObserved: true,
    }));
    expect(diagnostics.lifecycle.events.map((event) => event.kind)).toEqual([
      'window-attached',
      'main-frame-navigated',
      'window-closed',
      'runner-close-requested',
      'electron-context-closed',
      'electron-app-closed',
      'electron-process-exit',
    ]);
    expect(diagnostics.lifecycle.events[2]).toEqual(expect.objectContaining({
      runnerCloseRequested: false,
      windowId: 1,
    }));
    expect(diagnostics.lifecycle.processExit).toEqual({
      at: expect.any(String),
      code: 0,
      runnerCloseRequested: true,
      signal: null,
    });
    expect(JSON.stringify(diagnostics.lifecycle)).not.toMatch(/url|title|username|password|cookie/i);

    const expectedDiagnostics = createRunDiagnostics(
      '125-compact',
      new Date('2026-07-28T08:01:00.000Z'),
    );
    const expectedApp = new EventEmitter();
    const expectedContext = new EventEmitter();
    const expectedProcess = new EventEmitter();
    expectedApp.context = () => expectedContext;
    expectedApp.process = () => expectedProcess;
    const expectedObserver = attachElectronLifecycleDiagnostics(expectedApp, expectedDiagnostics);
    const expectedPage = new EventEmitter();
    expectedObserver.attachPage(expectedPage);
    markRunnerElectronCloseRequested(expectedDiagnostics);
    expectedPage.emit('close');
    expectedContext.emit('close');
    expectedApp.emit('close');
    expectedProcess.emit('exit', 0, null);

    expect(expectedDiagnostics.lifecycle.unexpectedCloseObserved).toBe(false);
    expect(expectedDiagnostics.lifecycle.events.find((event) => event.kind === 'window-closed'))
      .toEqual(expect.objectContaining({ runnerCloseRequested: true, windowId: 1 }));
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

  it('keeps an explicit interactive operator login handoff separate from saved-login automation and secret inspection', () => {
    const source = readFileSync('scripts/package-ui-evidence.js', 'utf8');
    const authenticationBody = source.slice(
      source.indexOf('async function ensureAuthenticatedWorkspace'),
      source.indexOf('async function elementDescriptor'),
    );
    const preauthenticatedStart = authenticationBody.indexOf('if (await hasAuthenticatedWorkspace(page))');
    const preauthenticatedInteractiveStart = authenticationBody.indexOf(
      'if (options.allowInteractiveLogin)',
      preauthenticatedStart,
    );
    const interactiveStart = authenticationBody.indexOf(
      'if (options.allowInteractiveLogin)',
      preauthenticatedInteractiveStart + 1,
    );
    const savedLoginStart = authenticationBody.indexOf('if (!options.allowSavedLogin)');
    const interactiveBody = authenticationBody.slice(interactiveStart, savedLoginStart);
    const preauthenticatedBody = authenticationBody.slice(
      preauthenticatedStart,
      interactiveStart,
    );

    expect(interactiveStart).toBeGreaterThan(-1);
    expect(interactiveStart).toBeLessThan(savedLoginStart);
    expect(preauthenticatedBody).toContain('if (options.allowInteractiveLogin)');
    expect(preauthenticatedBody).toContain('interactive evidence must begin');
    expect(interactiveBody).toContain('options.interactiveLoginTimeoutMs');
    expect(interactiveBody).toContain('waitForInteractiveAuthenticatedWorkspace');
    expect(interactiveBody).toContain('options.requireFreshTypedProof');
    expect(interactiveBody.indexOf('options.requireFreshTypedProof'))
      .toBeLessThan(interactiveBody.indexOf('operatorHandoff.outcome = \'workspace-reached\''));
    expect(interactiveBody).toContain('interactive-operator-login');
    expect(interactiveBody).toContain('automationReadSecrets: false');
    expect(interactiveBody).not.toContain('ensureEvidenceLingxingConnection');
    expect(interactiveBody).not.toMatch(/领星密码|type=.password.|inputValue|\.fill\(|\.type\(|loginButton\.click\(|password.*value|username.*value/);
  });

  it('accepts only a bounded secret-blind interactive operator handoff in structured run diagnostics', () => {
    const run = validRun(EXPECTED_PACKAGE_UI_SCALES[0]);
    const operatorHandoff = {
      automationReadSecrets: false,
      automationTypedSecrets: false,
      completedAt: '2026-07-17T06:00:00.400Z',
      kind: 'visible-user-handoff',
      outcome: 'workspace-reached',
      startedAt: '2026-07-17T06:00:00.200Z',
    };
    run.session.mode = 'interactive-operator-login';
    run.session.savedCredentialsLoginUsed = false;
    run.session.operatorHandoff = { ...operatorHandoff };
    run.session.loginSessionAttestation = {
      adsSessionReady: true,
      credentialPersistence: 'saved',
      credentialSource: 'typed',
      erpSessionReady: true,
      erpSessionReused: false,
      ok: true,
      sessionIdentityVerified: true,
    };
    run.diagnostics.login.outcome = 'interactive-operator-login';
    run.diagnostics.login.operatorHandoff = { ...operatorHandoff };

    expect(validRunDiagnostics(run.diagnostics, run)).toBe(true);
    run.session.operatorHandoff.automationReadSecrets = true;
    expect(validRunDiagnostics(run.diagnostics, run)).toBe(false);
  });

  it('requires typed-and-saved identity proof for the first handoff and a bounded saved-session continuation afterwards', () => {
    expect(INTERACTIVE_LOGIN_CONTRACT).toEqual(expect.objectContaining({
      firstRunFreshTypedIdentityProof: true,
      mode: 'visible-operator-each-run',
      savedSessionContinuationRequiresFreshProof: true,
    }));
    expect(validateLoginSessionAttestation({
      adsSessionReady: true,
      credentialPersistence: 'saved',
      credentialSource: 'typed',
      erpSessionReady: true,
      erpSessionReused: false,
      ok: true,
      sessionIdentityVerified: true,
    }, 'interactive-operator-login')).toEqual(expect.objectContaining({
      passed: true,
      violations: [],
    }));
    expect(validateLoginSessionAttestation({
      adsSessionReady: true,
      credentialPersistence: 'main_managed',
      credentialSource: 'saved',
      erpSessionReady: true,
      erpSessionReused: true,
      ok: true,
      sessionIdentityVerified: false,
    }, 'interactive-operator-login')).toEqual(expect.objectContaining({
      passed: true,
      violations: [],
    }));
    expect(validateLoginSessionAttestation({
      adsSessionReady: false,
      credentialPersistence: 'saved',
      credentialSource: 'typed',
      erpSessionReady: true,
      erpSessionReused: false,
      ok: true,
      sessionIdentityVerified: true,
    }, 'interactive-operator-login').passed).toBe(false);
    expect(validateLoginSessionAttestation({
      adsSessionReady: true,
      credentialPersistence: 'main_managed',
      credentialSource: 'saved',
      erpSessionReady: true,
      erpSessionReused: true,
      ok: true,
      sessionIdentityVerified: true,
    }, 'interactive-operator-login').passed).toBe(false);
    expect(validateLoginSessionAttestation({
      adsSessionReady: true,
      credentialPersistence: 'saved',
      credentialSource: 'typed',
      erpSessionReady: true,
      erpSessionReused: false,
      ok: true,
      sessionIdentityVerified: true,
      username: 'must-not-be-retained',
    }, 'interactive-operator-login').violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'LOGIN_SESSION_ATTESTATION_UNBOUNDED' }),
    ]));
  });

  it('waits on one bounded deadline for a ready Main projection and returns null on timeout', async () => {
    const waits = [];
    let readinessReads = 0;
    const ready = await waitForInteractiveAuthenticatedWorkspace({
      evaluate: async () => {
        readinessReads += 1;
        return readinessReads === 1
          ? {
              adsSessionReady: false,
              credentialPersistence: null,
              credentialSource: null,
              erpSessionReady: false,
              erpSessionReused: false,
              ok: false,
              sessionIdentityVerified: false,
            }
          : {
              adsSessionReady: true,
              credentialPersistence: 'saved',
              credentialSource: 'typed',
              erpSessionReady: true,
              erpSessionReused: false,
              ok: true,
              sessionIdentityVerified: true,
            };
      },
      locator: (selector) => ({
        isVisible: async () => selector === 'nav[aria-label="主业务导航"]',
      }),
      waitForTimeout: async (timeoutMs) => {
        waits.push(timeoutMs);
      },
    }, 600_000);
    expect(readinessReads).toBe(2);
    expect(waits).toEqual([500]);
    expect(ready).toEqual(expect.objectContaining({
      adsSessionReady: true,
      erpSessionReady: true,
      ok: true,
    }));

    const timedOut = await waitForInteractiveAuthenticatedWorkspace({
      evaluate: async () => ({
        adsSessionReady: false,
        credentialPersistence: null,
        credentialSource: null,
        erpSessionReady: false,
        erpSessionReused: false,
        ok: false,
        sessionIdentityVerified: false,
      }),
      locator: (selector) => ({
        isVisible: async () => selector === 'nav[aria-label="主业务导航"]',
      }),
    }, 0);
    expect(timedOut).toBeNull();
  });

  it('never accepts an unresolved interactive Main projection when the bounded deadline has elapsed', async () => {
    const unresolved = await waitForInteractiveAuthenticatedWorkspace({
      evaluate: async () => ({
        adsSessionReady: false,
        credentialPersistence: null,
        credentialSource: null,
        erpSessionReady: false,
        erpSessionReused: false,
        ok: false,
        sessionIdentityVerified: false,
      }),
      locator: (selector) => ({
        isVisible: async () => selector === 'nav[aria-label="主业务导航"]',
      }),
    }, 0);

    expect(unresolved).toBeNull();
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

function validLogicalArtifact() {
  return {
    method: 'readonly-sqlite-online-backup',
    remainingPages: 0,
    schemaVersion: 'sqlite-authority-currentness-proof/v1',
    sha256: HASH_A,
    sizeBytes: 4096,
    totalPages: 1,
  };
}

function validProfileLineageState() {
  return {
    capturedAt: '2026-07-17T06:00:01.100Z',
    logicalDatabase: validLogicalArtifact(),
    profileContent: {
      fileCount: 10,
      sha256: HASH_B,
      sizeBytes: 8192,
    },
  };
}

function validAttemptArtifacts(label = 'fixture') {
  const root = mkdtempSync(path.join(CURRENT_ARTIFACT_ROOT, 'attempt-artifacts-'));
  writeFileSync(path.join(root, `${label}.txt`), `immutable-${label}`, 'utf8');
  return buildPackageUiAttemptArtifactManifest(root);
}

function canonicalJsonForTest(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonForTest).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJsonForTest(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function changedRunnerContract(contract) {
  const binding = {
    evidenceScript: {
      ...contract.evidenceScript,
      sha256: contract.evidenceScript.sha256 === HASH_A ? HASH_B : HASH_A,
    },
    semanticContractSha256: contract.semanticContractSha256,
  };
  return {
    ...binding,
    sha256: evidenceModule.sha256Buffer(
      Buffer.from(canonicalJsonForTest(binding), 'utf8'),
    ),
  };
}

function validCheckpointComposition(runGroupId, runnerContractSha256) {
  const root = mkdtempSync(path.join(CURRENT_ARTIFACT_ROOT, 'checkpoints-'));
  const checkpointRecords = PACKAGE_UI_PROFILE_SEQUENCE.map((profileId, index) => {
    const payload = {
      kind: 'package-ui-profile-checkpoint',
      profileId,
      runGroupId,
      runnerContractSha256,
      schemaVersion: 'package-ui-profile-checkpoint/v1',
      sequence: index + 1,
    };
    const file = writeImmutableEnvelope(
      path.join(root, `${profileId}.json`),
      payload,
    );
    const envelope = JSON.parse(readFileSync(file.path, 'utf8'));
    return {
      file,
      payloadSha256: envelope.payloadSha256,
      profileId,
    };
  });
  return {
    checkpointRecords,
    finalProfileState: validProfileLineageState(),
    packageLineage: { chromium: { sha256: HASH_A } },
    passed: true,
    runGroupId,
    runnerContractSha256,
  };
}

function validChromiumLineage() {
  const profilePathBindingSha256 = HASH_A;
  const profileBindingSha256 = evidenceModule.sha256Buffer(
    Buffer.from(canonicalJsonForTest([profilePathBindingSha256]), 'utf8'),
  );
  return {
    chromium: { sha256: HASH_A, sizeBytes: 1234 },
    cleanup: validProcessSnapshot({ attempts: 1 }),
    descendantProcessIds: [902],
    expectedProfileRootSha256: HASH_B,
    observedAt: '2026-07-17T06:00:00.600Z',
    passed: true,
    profileBindingSha256,
    profileBindingTokenCount: 1,
    rootProcessIds: [901],
    snapshot: validProcessSnapshot({
      expectedProfileRootSha256: HASH_B,
      matching: [
        {
          executablePath: 'D:\\App\\chrome.exe',
          name: 'chrome.exe',
          parentProcessId: 900,
          processId: 901,
          profileMatched: true,
          profilePathBindingSha256,
        },
        {
          executablePath: 'D:\\App\\chrome.exe',
          name: 'chrome.exe',
          parentProcessId: 901,
          processId: 902,
          profileMatched: false,
          profilePathBindingSha256: null,
        },
      ],
      matchingCount: 2,
      observedCount: 2,
      profileBindingSha256,
      profileBindingTokenCount: 1,
      rootProcessIds: [901],
    }),
  };
}

function validDiagnostics(profileId) {
  const connectionBootstrap = {
    completedAt: '2026-07-17T06:00:00.400Z',
    outcome: 'existing-lingxing-connection',
    startedAt: '2026-07-17T06:00:00.300Z',
  };
  const selectedStore = {
    displayName: null,
    idLength: 12,
    idSha256: HASH_A,
  };
  return {
    cleanupErrors: [],
    completedAt: '2026-07-17T06:00:01.000Z',
    failure: null,
    login: {
      attempts: [],
      completedAt: '2026-07-17T06:00:00.500Z',
      connectionBootstrap,
      outcome: 'existing-authenticated-session',
      savedCredentials: null,
      startedAt: '2026-07-17T06:00:00.100Z',
    },
    lifecycle: {
      droppedCount: 0,
      events: [
        { at: '2026-07-17T06:00:00.005Z', kind: 'window-attached', phase: 'electron-launch', runnerCloseRequested: false, windowId: 1 },
        { at: '2026-07-17T06:00:00.700Z', kind: 'runner-close-requested', phase: 'electron-close', runnerCloseRequested: true },
        { at: '2026-07-17T06:00:00.750Z', kind: 'window-closed', phase: 'electron-close', runnerCloseRequested: true, windowId: 1 },
        { at: '2026-07-17T06:00:00.800Z', kind: 'electron-context-closed', phase: 'electron-close', runnerCloseRequested: true },
        { at: '2026-07-17T06:00:00.850Z', kind: 'electron-app-closed', phase: 'electron-close', runnerCloseRequested: true },
        { at: '2026-07-17T06:00:00.900Z', code: 0, kind: 'electron-process-exit', phase: 'electron-close', runnerCloseRequested: true, signal: null },
      ],
      limit: 100,
      processExit: {
        at: '2026-07-17T06:00:00.900Z',
        code: 0,
        runnerCloseRequested: true,
        signal: null,
      },
      runnerCloseRequestedAt: '2026-07-17T06:00:00.700Z',
      unexpectedCloseObserved: false,
    },
    phase: 'completed',
    profileId,
    renderer: {
      consoleErrors: [],
      droppedCount: { consoleErrors: 0, pageErrors: 0 },
      limits: { consoleErrors: 100, pageErrors: 100 },
      pageErrors: [],
    },
    schemaVersion: 'package-ui-run-diagnostics/v2',
    startedAt: '2026-07-17T06:00:00.000Z',
    storeGate: {
      completedAt: '2026-07-17T06:00:00.050Z',
      createdEvidenceStore: false,
      currency: 'USD',
      marketplace: 'US',
      outcome: 'selected-existing-store',
      resultingSurface: 'login',
      selectedStore,
      startedAt: '2026-07-17T06:00:00.010Z',
    },
    timeline: [
      { at: '2026-07-17T06:00:00.000Z', phase: 'created' },
      { at: '2026-07-17T06:00:01.000Z', phase: 'completed' },
    ],
  };
}

function validSession(profileId) {
  const diagnostics = validDiagnostics(profileId);
  return {
    connectionBootstrap: { ...diagnostics.login.connectionBootstrap },
    loginSessionAttestation: {
      adsSessionReady: true,
      credentialPersistence: 'main_managed',
      credentialSource: 'saved',
      erpSessionReady: true,
      erpSessionReused: false,
      ok: true,
      sessionIdentityVerified: true,
    },
    mode: 'existing-authenticated-session',
    savedCredentialsLoginUsed: false,
    storeGate: {
      createdEvidenceStore: false,
      currency: 'USD',
      marketplace: 'US',
      outcome: 'selected-existing-store',
      selectedStore: { ...diagnostics.storeGate.selectedStore },
    },
    storeAuthorityReadback: {
      actualIdSha256: HASH_A,
      currency: 'USD',
      expectedIdSha256: HASH_A,
      marketplace: 'US',
      passed: true,
    },
  };
}

const SCHEDULER_CONTEXT = {
  storeId: 'store-us-001',
  browserProfileId: 'profile-us-001',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-23',
  sessionGeneration: 4,
};

const EMPTY_SCHEDULER_COUNTS = {
  workspaceQuery: 0,
  schedulerGet: 0,
  retentionPreview: 0,
  runNow: 0,
  runNowRejected: 0,
  localSchedulerStart: 0,
  storeSchedulerStart: 0,
  reconcile: 0,
  execute: 0,
};

function validDatabaseMutationAudit() {
  const metrics = {
    digestSha256: HASH_A,
    serializedBytes: 49_152,
    totalChanges: 8,
    dataVersion: 1,
    pageCount: 12,
    pageSize: 4096,
    schemaVersion: 9,
    userVersion: 9,
  };
  return {
    kind: 'package-ui-database-mutation-audit',
    schemaVersion: 1,
    requiredPhases: ['post-bootstrap', 'post-navigation', 'pre-close-terminal'],
    checkpoints: [
      {
        sequence: 1,
        phase: 'post-bootstrap',
        capturedAt: '2026-07-23T01:00:00.050Z',
        contextDigestSha256: HASH_B,
        metrics: { ...metrics },
      },
      {
        sequence: 2,
        phase: 'post-navigation',
        capturedAt: '2026-07-23T01:05:00.050Z',
        contextDigestSha256: HASH_B,
        metrics: { ...metrics },
      },
      {
        sequence: 3,
        phase: 'pre-close-terminal',
        capturedAt: '2026-07-23T01:05:01.050Z',
        contextDigestSha256: HASH_B,
        metrics: { ...metrics },
      },
    ],
    comparisons: {
      contextDigestMatched: true,
      digestMatched: true,
      serializedBytesMatched: true,
      totalChangesMatched: true,
      dataVersionMatched: true,
      pageCountMatched: true,
      pageSizeMatched: true,
      schemaVersionMatched: true,
      userVersionMatched: true,
    },
    passed: true,
  };
}

function databaseCheckpointReceipts(runtime) {
  const checkpoints = runtime.marker.databaseMutationAudit.checkpoints;
  return {
    postBootstrap: structuredClone(checkpoints[0]),
    postNavigation: structuredClone(checkpoints[1]),
  };
}

function schedulerAuditSnapshot({ counts = {}, events = [], pid = 321 } = {}) {
  const mergedCounts = { ...EMPTY_SCHEDULER_COUNTS, ...counts };
  const suppressed = {
    automaticReconcile: 0,
    localSchedulerStart: 1,
    startupReconcile: 1,
    storeSchedulerStart: 1,
  };
  return {
    kind: 'package-ui-scheduler-audit',
    schemaVersion: 1,
    generatedAt: '2026-07-23T01:00:00.000Z',
    pid,
    evidenceMode: 'package-ui',
    userDataDir: USER_DATA_DIR,
    policies: { runNow: 'reject' },
    counts: mergedCounts,
    suppressed,
    guards: {
      localSchedulerStarted: false,
      storeCollectionSchedulerStarted: false,
      runNowIpcDisabled: true,
      startupReconcileSuppressed: true,
      automaticReconcileSuppressed: true,
      readOnlyInvariantPassed: true,
    },
    databaseMutationAudit: validDatabaseMutationAudit(),
    events,
  };
}

function validSchedulerSubviewEvidence() {
  const expected = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0];
  const requestId = 'renderer-bootstrap-1784786120654-1';
  const events = [
    {
      sequence: 1,
      at: '2026-07-23T01:00:00.100Z',
      source: 'mission-control:query',
      outcome: 'succeeded',
      context: SCHEDULER_CONTEXT,
      request: {
        query: 'workspace-bootstrap',
        requestId,
        contextEpoch: 1,
        context: SCHEDULER_CONTEXT,
      },
      response: {
        query: 'workspace-bootstrap',
        requestId,
        contextEpoch: 1,
        authoritativeContext: SCHEDULER_CONTEXT,
        capabilities: expected.capabilities.map((capability) => ({
          ...capability,
          view: 'settings/scheduler',
          workspace: 'settings',
        })),
      },
      errorCode: null,
    },
    {
      sequence: 2,
      at: '2026-07-23T01:00:00.200Z',
      source: 'store-collection-scheduler:get',
      outcome: 'succeeded',
      context: SCHEDULER_CONTEXT,
      request: { storeContext: SCHEDULER_CONTEXT },
      response: {
        businessDate: SCHEDULER_CONTEXT.businessDate,
        detail: '等待当前店铺配置的采集时间。',
        enabled: true,
        state: 'waiting',
        storeId: SCHEDULER_CONTEXT.storeId,
      },
      errorCode: null,
    },
    {
      sequence: 3,
      at: '2026-07-23T01:00:00.300Z',
      source: 'store-evidence-retention:preview',
      outcome: 'succeeded',
      context: SCHEDULER_CONTEXT,
      request: { storeContext: SCHEDULER_CONTEXT },
      response: {
        applyable: false,
        blockerCount: 0,
        candidateCount: 0,
        currency: 'USD',
        deletionSupported: false,
        marketplace: 'US',
        mode: 'dry-run',
        profileId: SCHEDULER_CONTEXT.browserProfileId,
        schemaVersion: 1,
        storeId: SCHEDULER_CONTEXT.storeId,
      },
      errorCode: null,
    },
  ];
  return {
    dom: {
      alertDialogCount: 0,
      busyControlCount: 0,
      confirmRunDialogCount: 0,
      fixedScopeText: 'US USD',
      heading: expected.heading,
      headingCount: 1,
      legacyBoundaryCount: 1,
      legacyCapabilityState: 'LEGACY_ADAPTER',
      legacyRoute: 'scheduler',
      legacyStoreId: SCHEDULER_CONTEXT.storeId,
      pageCount: 1,
      previewMarkerCount: 0,
      loadingStateCount: 0,
      retentionPreviewCapabilityId: 'settings.scheduler.retention-preview',
      retentionPreviewControlCount: 1,
      retentionPreviewEnabledCount: 1,
      retentionBlockerCount: '0',
      retentionCandidateCount: '0',
      retentionCurrency: 'USD',
      retentionMarketplace: 'US',
      retentionProfileId: SCHEDULER_CONTEXT.browserProfileId,
      retentionStoreId: SCHEDULER_CONTEXT.storeId,
      retentionSummaryCount: 1,
      rootCount: 1,
      scheduleBusinessDate: SCHEDULER_CONTEXT.businessDate,
      scheduleCurrency: 'USD',
      scheduleEnabled: 'true',
      scheduleMarketplace: 'US',
      scheduleProjectionCount: 1,
      scheduleRefreshEnabledCount: 1,
      scheduleState: 'waiting',
      scheduleStoreId: SCHEDULER_CONTEXT.storeId,
      schedulerErrorCount: 0,
      selectedStoreId: SCHEDULER_CONTEXT.storeId,
      selectedTabCapabilityState: 'LEGACY_ADAPTER',
      selectedTabCount: 1,
      selectedTabId: expected.tabId,
      shellStoreId: SCHEDULER_CONTEXT.storeId,
      subview: expected.subview,
      workspace: expected.workspace,
    },
    ledgerBefore: schedulerAuditSnapshot(),
    ledgerAfter: schedulerAuditSnapshot({
      counts: { workspaceQuery: 1, schedulerGet: 1, retentionPreview: 1 },
      events,
    }),
  };
}

function validSubviewCheck(scale) {
  const expected = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0];
  const screenshotPath = path.join(
    CURRENT_ARTIFACT_ROOT,
    `${expected.workspace}-${expected.subview}-${scale.scalePercent}.png`,
  );
  writeFileSync(screenshotPath, Buffer.from(`scheduler-${scale.scalePercent}`));
  return {
    ...expected,
    compositeEvidence: { passed: true },
    identityCapabilityEvidence: validateSchedulerSubviewEvidence(validSchedulerSubviewEvidence(), expected),
    passed: true,
    screenshot: {
      path: screenshotPath,
      sha256: evidenceModule.sha256File(screenshotPath),
      sizeBytes: readFileSync(screenshotPath).byteLength,
      subview: expected.subview,
      workspace: expected.workspace,
    },
    settleEvidence: { passed: true },
    violations: [],
  };
}

function validReadOnlyRuntime(profileId) {
  const marker = validSchedulerSubviewEvidence().ledgerAfter;
  const artifactPath = path.join(
    CURRENT_ARTIFACT_ROOT,
    `${profileId}-package-ui-scheduler-audit.json`,
  );
  writeFileSync(artifactPath, JSON.stringify(marker), 'utf8');
  return validatePackageUiReadOnlyRuntimeEvidence({
    artifact: {
      path: artifactPath,
      sha256: evidenceModule.sha256File(artifactPath),
      sizeBytes: readFileSync(artifactPath).byteLength,
    },
    main: {
      evidenceMode: 'package-ui',
      pid: marker.pid,
      userDataDir: USER_DATA_DIR,
    },
    marker,
    processExitConfirmed: true,
  });
}

function validRun(scale) {
  const schedulerReadOnlyRuntime = validReadOnlyRuntime(`${scale.scalePercent}-compact`);
  const run = {
    actualDeviceScaleFactor: scale.deviceScaleFactor,
    attemptArtifacts: validAttemptArtifacts(`${scale.scalePercent}-compact`),
    chromiumProcessLineage: validChromiumLineage(),
    consoleErrors: [],
    databaseAuditCheckpoints: databaseCheckpointReceipts(schedulerReadOnlyRuntime),
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
      subview: workspace.subview,
      workspace: workspace.workspace,
    })),
    schedulerReadOnlyRuntime,
    session: validSession(`${scale.scalePercent}-compact`),
    subviewChecks: [validSubviewCheck(scale)],
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
        keyboardEvidence: { passed: true },
        subview: workspace.subview,
        workspace: workspace.workspace,
      };
    }),
  };
  return applyInteractiveOperatorHandoff(run, {
    firstRun: scale.scalePercent === EXPECTED_PACKAGE_UI_SCALES[0].scalePercent,
  });
}

function validSavedLoginRun(scale) {
  const run = validRun(scale);
  run.session.mode = 'saved-credentials-login';
  run.session.savedCredentialsLoginUsed = true;
  delete run.session.operatorHandoff;
  run.diagnostics.login.outcome = 'saved-credentials-login';
  delete run.diagnostics.login.operatorHandoff;
  run.diagnostics.login.attempts = [
    {
      attempt: 1,
      completedAt: '2026-07-17T06:00:00.250Z',
      message: 'saved-session browser navigation replaced its execution context',
      outcome: 'retryable-navigation',
      retryable: true,
      startedAt: '2026-07-17T06:00:00.200Z',
    },
    {
      attempt: 2,
      completedAt: '2026-07-17T06:00:00.450Z',
      message: null,
      outcome: 'workspace-reached',
      retryable: false,
      startedAt: '2026-07-17T06:00:00.300Z',
    },
  ];
  return run;
}

function applyInteractiveOperatorHandoff(run, { firstRun = false } = {}) {
  const operatorHandoff = {
    automationReadSecrets: false,
    automationTypedSecrets: false,
    completedAt: '2026-07-17T06:00:00.400Z',
    kind: 'visible-user-handoff',
    outcome: 'workspace-reached',
    startedAt: '2026-07-17T06:00:00.200Z',
  };
  const connectionBootstrap = {
    completedAt: operatorHandoff.completedAt,
    outcome: 'operator-established-lingxing-connection-and-session',
    startedAt: operatorHandoff.startedAt,
  };
  run.session.mode = 'interactive-operator-login';
  run.session.savedCredentialsLoginUsed = false;
  run.session.operatorHandoff = { ...operatorHandoff };
  run.session.connectionBootstrap = { ...connectionBootstrap };
  run.session.loginSessionAttestation = firstRun
    ? {
        adsSessionReady: true,
        credentialPersistence: 'saved',
        credentialSource: 'typed',
        erpSessionReady: true,
        erpSessionReused: false,
        ok: true,
        sessionIdentityVerified: true,
      }
    : {
        adsSessionReady: true,
        credentialPersistence: 'main_managed',
        credentialSource: 'saved',
        erpSessionReady: true,
        erpSessionReused: true,
        ok: true,
        sessionIdentityVerified: false,
      };
  run.diagnostics.login.outcome = 'interactive-operator-login';
  run.diagnostics.login.operatorHandoff = { ...operatorHandoff };
  run.diagnostics.login.connectionBootstrap = { ...connectionBootstrap };
  return run;
}

function validWideRun() {
  const schedulerReadOnlyRuntime = validReadOnlyRuntime(PACKAGE_UI_WIDE_PROFILE.id);
  const run = {
    actualDeviceScaleFactor: 1,
    attemptArtifacts: validAttemptArtifacts(PACKAGE_UI_WIDE_PROFILE.id),
    chromiumProcessLineage: validChromiumLineage(),
    consoleErrors: [],
    databaseAuditCheckpoints: databaseCheckpointReceipts(schedulerReadOnlyRuntime),
    diagnostics: validDiagnostics(PACKAGE_UI_WIDE_PROFILE.id),
    identity: { passed: true },
    pageErrors: [],
    packageProcessIsolation: validProcessIsolation(),
    profileId: PACKAGE_UI_WIDE_PROFILE.id,
    screenshots: PACKAGE_UI_WIDE_PROFILE.workspaces.map((workspace) => ({
      path: `${workspace.workspace}-wide.png`,
      sha256: HASH_A,
      subview: workspace.subview,
      workspace: workspace.workspace,
    })),
    schedulerReadOnlyRuntime,
    session: validSession(PACKAGE_UI_WIDE_PROFILE.id),
    profileProcessIsolation: validProcessIsolation(),
    viewport: { height: 900, width: 1400 },
    workspaceChecks: PACKAGE_UI_WIDE_PROFILE.workspaces.map((workspace) => ({
      compositeEvidence: { passed: true },
      experienceEvidence: null,
      inspectorEvidence: null,
      keyboardEvidence: { passed: true },
      passed: true,
      settleEvidence: { passed: true },
      subview: workspace.subview,
      workspace: workspace.workspace,
    })),
  };
  return applyInteractiveOperatorHandoff(run);
}

describe('package UI evidence CLI contract', () => {
  it('reasserts the schema-v7 secret-blind login boundary for direct runtime callers', () => {
    expect(assertPackageUiRuntimeLoginBoundary({
      allowInteractiveLogin: true,
      allowSavedLogin: false,
    })).toBe(true);
    expect(() => assertPackageUiRuntimeLoginBoundary({
      allowInteractiveLogin: false,
      allowSavedLogin: true,
    })).toThrow(/saved-login automation is forbidden/i);
    const source = readFileSync('scripts/package-ui-evidence.js', 'utf8');
    const runtimeStart = source.indexOf('async function runPackageUiEvidence(options)');
    const runtimeBody = source.slice(
      runtimeStart,
      source.indexOf('const runGroupId = packageUiRunGroupId(options)', runtimeStart),
    );
    expect(runtimeBody).toContain('assertPackageUiRuntimeLoginBoundary(options)');
  });

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
      '--allow-interactive-login',
      '--user-data-dir', USER_DATA_DIR,
      '--protected-db', PROTECTED_DB_PATH,
      '--run-group', 'operator-run-001',
      '--output', 'output/custom-package-ui',
      '--settle-ms', '900',
    ]);

    expect(parsed.expectedExeSha256).toBe(HASH_A);
    expect(parsed.expectedAppContentSha256).toBe(HASH_B);
    expect(parsed.allowInteractiveLogin).toBe(true);
    expect(parsed.allowSavedLogin).toBe(false);
    expect(parsed.outputDir).toBe('output/custom-package-ui');
    expect(parsed.settleMs).toBe(900);
    expect(parsed.userDataDir).toBe(USER_DATA_DIR);
    expect(parsed.protectedDatabasePath).toBe(path.resolve(PROTECTED_DB_PATH));
    expect(parsed.runGroupId).toBe('operator-run-001');
    expect(parsed.resumeRunGroupId).toBeNull();
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
    expect(result.stdout).toContain('all ten canonical Mission Control workspaces');
    expect(result.stdout).toContain('50,000-row production');
    expect(result.stdout).toContain('virtualizer contract');
    expect(result.stdout).toContain('--expected-app-content-sha256');
    expect(result.stdout).toContain('--print-package-hashes');
    expect(result.stdout).toContain('--user-data-dir');
    expect(result.stdout).toContain('--protected-db');
    expect(result.stdout).toContain('--resume-run-group');
    expect(result.stdout).toContain('fresh typed-and-saved identity proof');
    expect(result.stdout).not.toContain('--allow-saved-login');
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
  it('captures committed WAL state through the shared read-only SQLite online-backup helper', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-wal-'));
    const databasePath = path.join(root, 'authority.db');
    const database = new Database(databasePath);
    try {
      database.pragma('journal_mode = WAL');
      database.pragma('wal_autocheckpoint = 0');
      database.exec('CREATE TABLE authority_state (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)');
      database.prepare('INSERT INTO authority_state VALUES (?, ?)').run('grant-1', 1);
      const before = captureSqliteLogicalArtifact(databasePath, 'test-before');
      database.prepare('UPDATE authority_state SET revision = 2 WHERE id = ?').run('grant-1');
      const after = captureSqliteLogicalArtifact(databasePath, 'test-after');

      expect(before).toEqual(expect.objectContaining({
        method: 'readonly-sqlite-online-backup',
        remainingPages: 0,
        schemaVersion: 'sqlite-authority-currentness-proof/v1',
      }));
      expect(after.sha256).not.toBe(before.sha256);
      expect(after.totalPages).toBeGreaterThan(0);
    } finally {
      database.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('writes immutable ordered checkpoints and resumes only the same package/profile lineage', () => {
    const outputDir = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-checkpoint-'));
    const genesis = validProfileLineageState();
    const protectedDatabaseLogical = validLogicalArtifact();
    const runnerContract = buildPackageUiRunnerContract();
    const packageLineage = {
      appContentSha256: HASH_A,
      chromium: { relativePath: 'playwright-browsers/chrome-win64/chrome.exe', sha256: HASH_B, sizeBytes: 100 },
      executableSha256: HASH_B,
      profileBindingSha256: HASH_A,
      profileBrowserBindingSha256: HASH_B,
    };
    try {
      const manager = initializePackageUiRunGroup({
        genesisProfileState: genesis,
        options: { runGroupId: 'checkpoint-run-001' },
        outputDir,
        packageLineage,
        protectedDatabaseLogical,
      });
      for (let index = 0; index < PACKAGE_UI_PROFILE_SEQUENCE.length; index += 1) {
        const profileId = PACKAGE_UI_PROFILE_SEQUENCE[index];
        const cursor = resolvePackageUiProfileCursor(manager, profileId);
        const after = structuredClone(cursor.cursor);
        after.capturedAt = `2026-07-17T06:00:0${index + 2}.000Z`;
        after.profileContent.sha256 = String(index + 1).padStart(64, String(index + 1));
        const profileState = { before: cursor.cursor, after };
        const attemptContext = createPackageUiProfileAttemptContext(manager, profileId);
        writeFileSync(
          path.join(attemptContext.artifactDir, `${profileId}.txt`),
          `immutable-${profileId}`,
          'utf8',
        );
        const attemptArtifacts = buildPackageUiAttemptArtifactManifest(
          attemptContext.artifactDir,
        );
        const runEvidence = {
          attemptArtifacts,
          diagnostics: validDiagnostics(profileId),
          passed: true,
          profileId,
        };
        const attemptRecord = recordPackageUiProfileAttempt({
          attemptArtifacts,
          attemptContext,
          manager,
          profileId,
          profileState,
          resumable: true,
          runEvidence,
        });
        writePackageUiProfileCheckpoint({
          attemptRecord,
          lineageStart: cursor.lineageStart,
          manager,
          profileId,
          profileState,
          runEvidence,
        });
        expect(() => writePackageUiProfileCheckpoint({
          attemptRecord,
          lineageStart: cursor.lineageStart,
          manager,
          profileId,
          profileState,
          runEvidence,
        })).toThrow(/immutable/i);
      }

      const composed = composePackageUiRunGroup(manager);
      expect(composed.passed).toBe(true);
      expect(composed.checkpointRecords.map((item) => item.profileId))
        .toEqual(PACKAGE_UI_PROFILE_SEQUENCE);
      expect(composed.compactRuns).toHaveLength(2);
      expect(composed.wideProfile.profileId).toBe(PACKAGE_UI_WIDE_PROFILE.id);
      expect(profileLineageStateMatches(
        composed.finalProfileState,
        resolvePackageUiProfileCursor(manager, PACKAGE_UI_WIDE_PROFILE.id)
          .checkpoint.payload.profileState.after,
      )).toBe(true);

      expect(initializePackageUiRunGroup({
        genesisProfileState: structuredClone(composed.finalProfileState),
        options: { resumeRunGroupId: 'checkpoint-run-001' },
        outputDir,
        packageLineage,
        protectedDatabaseLogical,
      }).resumed).toBe(true);
      expect(() => initializePackageUiRunGroup({
        genesisProfileState: structuredClone(composed.finalProfileState),
        options: { resumeRunGroupId: 'checkpoint-run-001' },
        outputDir,
        packageLineage: { ...packageLineage, executableSha256: HASH_A },
        protectedDatabaseLogical,
      })).toThrow(/lineage changed/i);
      expect(() => initializePackageUiRunGroup({
        genesisProfileState: structuredClone(composed.finalProfileState),
        options: { resumeRunGroupId: 'checkpoint-run-001' },
        outputDir,
        packageLineage,
        protectedDatabaseLogical,
        runnerContract: changedRunnerContract(runnerContract),
      })).toThrow(/runner contract lineage changed/i);

      const sequenceDriftRunGroupId = 'checkpoint-sequence-drift';
      writeImmutableEnvelope(
        path.join(
          outputDir,
          'run-groups',
          sequenceDriftRunGroupId,
          'run-group.json',
        ),
        {
          ...manager.metadata,
          profileSequence: [...PACKAGE_UI_PROFILE_SEQUENCE].reverse(),
          runGroupId: sequenceDriftRunGroupId,
        },
      );
      expect(() => initializePackageUiRunGroup({
        genesisProfileState: genesis,
        options: { resumeRunGroupId: sequenceDriftRunGroupId },
        outputDir,
        packageLineage,
        protectedDatabaseLogical,
      })).toThrow(/profile sequence.*lineage changed/i);
    } finally {
      rmSync(outputDir, { force: true, recursive: true });
    }
  });

  it('keeps failed-attempt artifacts immutable and resumes from the cleanup-safe cursor before success', () => {
    const outputDir = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-retry-'));
    const genesis = validProfileLineageState();
    const packageLineage = {
      appContentSha256: HASH_A,
      chromium: { relativePath: 'playwright-browsers/chrome-win64/chrome.exe', sha256: HASH_B, sizeBytes: 100 },
      executableSha256: HASH_B,
      profileBindingSha256: HASH_A,
      profileBrowserBindingSha256: HASH_B,
    };
    const profileId = PACKAGE_UI_PROFILE_SEQUENCE[0];
    try {
      const manager = initializePackageUiRunGroup({
        genesisProfileState: genesis,
        options: { runGroupId: 'retry-run-001' },
        outputDir,
        packageLineage,
        protectedDatabaseLogical: validLogicalArtifact(),
      });
      const firstContext = createPackageUiProfileAttemptContext(manager, profileId);
      const firstArtifactPath = path.join(firstContext.artifactDir, 'first-failure.txt');
      writeFileSync(firstArtifactPath, 'first-failure-is-immutable', 'utf8');
      const firstArtifacts = buildPackageUiAttemptArtifactManifest(firstContext.artifactDir);
      const firstAfter = structuredClone(genesis);
      firstAfter.capturedAt = '2026-07-17T06:00:02.000Z';
      firstAfter.profileContent.sha256 = 'C'.repeat(64);
      const firstDiagnostics = createRunDiagnostics(
        profileId,
        new Date('2026-07-17T06:00:00.000Z'),
      );
      firstDiagnostics.login.failureMessage = 'username=operator@example.com password=hunter2';
      Object.assign(firstDiagnostics, {
        commandline: '--password bare-command-secret',
        password: 'bare-secret',
        passwordInputEmpty: true,
        session: 'bare-session',
        'set-cookie': 'sid=bare-cookie',
        token: 'bare-token',
      });
      const firstAttempt = recordPackageUiProfileAttempt({
        attemptArtifacts: firstArtifacts,
        attemptContext: firstContext,
        manager,
        profileId,
        profileState: { before: genesis, after: firstAfter },
        resumable: true,
        runEvidence: {
          attemptArtifacts: firstArtifacts,
          diagnostics: firstDiagnostics,
          failure: { message: 'renderer assertion failed after cleanup' },
          passed: false,
          profileId,
        },
      });
      expect(PACKAGE_UI_PROFILE_ATTEMPT_SCHEMA_VERSION).toBe('package-ui-profile-attempt/v2');
      const firstAttemptEnvelope = JSON.parse(readFileSync(firstAttempt.path, 'utf8'));
      expect(firstAttemptEnvelope.payload.diagnostics).toEqual(expect.objectContaining({
        login: expect.objectContaining({
          failureMessage: 'username=[REDACTED] password=[REDACTED]',
        }),
        commandline: '[REDACTED]',
        password: '[REDACTED]',
        passwordInputEmpty: true,
        schemaVersion: 'package-ui-run-diagnostics/v2',
        session: '[REDACTED]',
        'set-cookie': '[REDACTED]',
        token: '[REDACTED]',
      }));
      expect(JSON.stringify(firstAttemptEnvelope.payload)).not.toContain('operator@example.com');
      expect(JSON.stringify(firstAttemptEnvelope.payload)).not.toContain('hunter2');
      expect(JSON.stringify(firstAttemptEnvelope.payload)).not.toContain('bare-secret');
      expect(JSON.stringify(firstAttemptEnvelope.payload)).not.toContain('bare-token');
      expect(JSON.stringify(firstAttemptEnvelope.payload)).not.toContain('bare-command-secret');
      expect(JSON.stringify(firstAttemptEnvelope.payload)).not.toContain('bare-session');
      expect(JSON.stringify(firstAttemptEnvelope.payload)).not.toContain('bare-cookie');

      const retryCursor = resolvePackageUiProfileCursor(manager, profileId);
      expect(retryCursor.checkpoint).toBeNull();
      expect(retryCursor.receipts).toHaveLength(1);
      expect(profileLineageStateMatches(retryCursor.cursor, firstAfter)).toBe(true);

      const secondContext = createPackageUiProfileAttemptContext(manager, profileId);
      expect(secondContext.ordinal).toBe(2);
      expect(secondContext.artifactDir).not.toBe(firstContext.artifactDir);
      writeFileSync(
        path.join(secondContext.artifactDir, 'second-success.txt'),
        'second-success-is-separate',
        'utf8',
      );
      const secondArtifacts = buildPackageUiAttemptArtifactManifest(secondContext.artifactDir);
      const secondAfter = structuredClone(firstAfter);
      secondAfter.capturedAt = '2026-07-17T06:00:03.000Z';
      secondAfter.profileContent.sha256 = 'D'.repeat(64);
      const secondRun = {
        attemptArtifacts: secondArtifacts,
        diagnostics: validDiagnostics(profileId),
        passed: true,
        profileId,
      };
      const secondAttempt = recordPackageUiProfileAttempt({
        attemptArtifacts: secondArtifacts,
        attemptContext: secondContext,
        manager,
        profileId,
        profileState: { before: firstAfter, after: secondAfter },
        resumable: true,
        runEvidence: secondRun,
      });
      writePackageUiProfileCheckpoint({
        attemptRecord: secondAttempt,
        lineageStart: genesis,
        manager,
        profileId,
        profileState: { before: firstAfter, after: secondAfter },
        runEvidence: secondRun,
      });

      expect(readFileSync(firstArtifactPath, 'utf8')).toBe('first-failure-is-immutable');
      expect(packageUiAttemptArtifactManifestMatches(firstArtifacts)).toBe(true);
      expect(packageUiAttemptArtifactManifestMatches(secondArtifacts)).toBe(true);
      expect(
        profileLineageStateMatches(
          resolvePackageUiProfileCursor(manager, profileId).checkpoint.payload.profileState.after,
          secondAfter,
        ),
      ).toBe(true);
    } finally {
      rmSync(outputDir, { force: true, recursive: true });
    }
  });

  it('records cleanup failure without an after cursor and makes the run group explicitly non-resumable', () => {
    const outputDir = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-nonresumable-'));
    const genesis = validProfileLineageState();
    const profileId = PACKAGE_UI_PROFILE_SEQUENCE[0];
    const packageLineage = {
      appContentSha256: HASH_A,
      chromium: { relativePath: 'playwright-browsers/chrome-win64/chrome.exe', sha256: HASH_B, sizeBytes: 100 },
      executableSha256: HASH_B,
      profileBindingSha256: HASH_A,
      profileBrowserBindingSha256: HASH_B,
    };
    try {
      const manager = initializePackageUiRunGroup({
        genesisProfileState: genesis,
        options: { runGroupId: 'cleanup-failure-run-001' },
        outputDir,
        packageLineage,
        protectedDatabaseLogical: validLogicalArtifact(),
      });
      const attemptContext = createPackageUiProfileAttemptContext(manager, profileId);
      writeFileSync(path.join(attemptContext.artifactDir, 'cleanup-failure.txt'), 'failed', 'utf8');
      const attemptArtifacts = buildPackageUiAttemptArtifactManifest(
        attemptContext.artifactDir,
      );
      const cleanupSafeRun = {
        chromiumProcessLineage: null,
        packageProcessIsolation: validProcessIsolation(),
        profileProcessIsolation: validProcessIsolation(),
      };
      expect(packageUiAttemptCleanupPassed(cleanupSafeRun)).toBe(true);
      expect(packageUiAttemptCleanupPassed({
        ...cleanupSafeRun,
        chromiumProcessLineage: {
          cleanup: validProcessSnapshot({ attempts: 1 }),
          passed: false,
        },
      })).toBe(true);
      const cleanupFailedRun = {
        ...cleanupSafeRun,
        profileProcessIsolation: {
          ...validProcessIsolation(),
          passed: false,
        },
      };
      expect(packageUiAttemptCleanupPassed(cleanupFailedRun)).toBe(false);
      recordPackageUiProfileAttempt({
        attemptArtifacts,
        attemptContext,
        manager,
        profileId,
        profileState: { before: genesis, after: null },
        resumable: false,
        runEvidence: {
          ...cleanupFailedRun,
          attemptArtifacts,
          diagnostics: validDiagnostics(profileId),
          failure: { message: 'target Chromium cleanup unresolved' },
          passed: false,
          profileId,
        },
      });

      expect(() => resolvePackageUiProfileCursor(manager, profileId))
        .toThrow(/non-resumable.*fresh isolated profile\/run group/i);
    } finally {
      rmSync(outputDir, { force: true, recursive: true });
    }
  });

  it.runIf(process.platform === 'win32')('accepts a byte-for-byte copy with a distinct Windows file identity', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-copy-'));
    const protectedDatabasePath = path.join(root, 'protected.db');
    const profileDatabasePath = path.join(root, 'profile.db');
    try {
      writeFileSync(protectedDatabasePath, 'authority-db');
      copyFileSync(protectedDatabasePath, profileDatabasePath);

      expect(evaluateProfileDatabaseFileIsolation({
        profileDatabasePath,
        protectedDatabasePath,
      })).toEqual(expect.objectContaining({
        passed: true,
        sameFileIdentity: false,
        sharedHardLinkCount: 0,
        violations: [],
      }));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('accepts one path-safe resume run group and rejects ambiguous or traversal-like ids', () => {
    const base = [
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--allow-interactive-login',
      '--user-data-dir', USER_DATA_DIR,
      '--protected-db', PROTECTED_DB_PATH,
    ];
    expect(parsePackageUiEvidenceArgs([
      ...base,
      '--resume-run-group', 'operator-run-001',
    ]).resumeRunGroupId).toBe('operator-run-001');
    expect(() => parsePackageUiEvidenceArgs([
      ...base,
      '--run-group', 'operator-run-001',
      '--resume-run-group', 'operator-run-001',
    ])).toThrow(/cannot be combined/);
    expect(() => parsePackageUiEvidenceArgs([
      ...base,
      '--resume-run-group', '..\\escape',
    ])).toThrow(/path-safe identifier/);
  });

  it('allows a bounded interactive operator login handoff but never combines it with saved-login automation', () => {
    const parsed = parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--allow-interactive-login',
      '--interactive-login-timeout-ms', '600000',
      '--user-data-dir', USER_DATA_DIR,
      '--protected-db', PROTECTED_DB_PATH,
    ]);

    expect(parsed.allowInteractiveLogin).toBe(true);
    expect(parsed.allowSavedLogin).toBe(false);
    expect(parsed.interactiveLoginTimeoutMs).toBe(600_000);
    expect(parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--allow-interactive-login',
      '--user-data-dir', USER_DATA_DIR,
      '--protected-db', PROTECTED_DB_PATH,
    ]).interactiveLoginTimeoutMs).toBe(900_000);
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--allow-interactive-login',
      '--interactive-login-timeout-ms', '900001',
      '--user-data-dir', USER_DATA_DIR,
      '--protected-db', PROTECTED_DB_PATH,
    ])).toThrow(/must not exceed 900000/i);
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--allow-saved-login',
      '--user-data-dir', USER_DATA_DIR,
      '--protected-db', PROTECTED_DB_PATH,
    ])).toThrow(/schema v7.*--allow-interactive-login/i);
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--allow-saved-login',
      '--allow-interactive-login',
      '--user-data-dir', USER_DATA_DIR,
      '--protected-db', PROTECTED_DB_PATH,
    ])).toThrow(/cannot be combined/i);
  });

  it.runIf(process.platform === 'win32')('rejects a real hardlink alias before package UI may launch', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-hardlink-'));
    const protectedDatabasePath = path.join(root, 'protected.db');
    const profileDatabasePath = path.join(root, 'profile.db');
    try {
      writeFileSync(protectedDatabasePath, 'authority-db');
      linkSync(protectedDatabasePath, profileDatabasePath);

      const result = evaluateProfileDatabaseFileIsolation({
        profileDatabasePath,
        protectedDatabasePath,
      });

      expect(result.passed).toBe(false);
      expect(result.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'PROFILE_DATABASE_HARDLINK_ALIAS' }),
      ]));

      const source = readFileSync('scripts/package-ui-evidence.js', 'utf8');
      const runBody = source.slice(
        source.indexOf('async function runPackageUiEvidence(options)'),
        source.indexOf('module.exports = {'),
      );
      expect(runBody.indexOf('manifest.profileDatabaseFileIsolation = evaluateProfileDatabaseFileIsolation')).toBeGreaterThan(-1);
      expect(runBody.indexOf('manifest.profileDatabaseFileIsolation = evaluateProfileDatabaseFileIsolation'))
        .toBeLessThan(runBody.indexOf('for (let profileIndex = 0;'));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.runIf(process.platform === 'win32')('fails closed when bounded Windows hardlink enumeration times out', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-timeout-'));
    const protectedDatabasePath = path.join(root, 'protected.db');
    const profileDatabasePath = path.join(root, 'profile.db');
    const calls = [];
    try {
      writeFileSync(protectedDatabasePath, 'authority-db');
      copyFileSync(protectedDatabasePath, profileDatabasePath);

      const result = evaluateProfileDatabaseFileIsolation({
        profileDatabasePath,
        protectedDatabasePath,
        run: (command, args, options) => {
          calls.push({ args, command, options });
          return {
            error: Object.assign(new Error('operation timed out'), { code: 'ETIMEDOUT' }),
            signal: 'SIGTERM',
            status: null,
            stderr: '',
            stdout: '',
          };
        },
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(expect.objectContaining({
        args: ['hardlink', 'list', profileDatabasePath],
        options: expect.objectContaining({
          shell: false,
          timeout: expect.any(Number),
          windowsHide: true,
        }),
      }));
      expect(calls[0].command).toMatch(/[\\/]System32[\\/]fsutil\.exe$/i);
      expect(calls[0].options.timeout).toBeGreaterThan(0);
      expect(calls[0].options.timeout).toBeLessThanOrEqual(5_000);
      expect(result.passed).toBe(false);
      expect(result.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'PROFILE_DATABASE_FILE_IDENTITY_UNVERIFIED' }),
      ]));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.runIf(process.platform === 'win32')('retains fail-closed rejection for a database path traversing a junction', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-junction-'));
    const protectedDatabasePath = path.join(root, 'protected.db');
    const profileSource = path.join(root, 'profile-source');
    const profileAlias = path.join(root, 'profile-alias');
    try {
      mkdirSync(profileSource);
      writeFileSync(protectedDatabasePath, 'authority-db');
      copyFileSync(protectedDatabasePath, path.join(profileSource, 'amazon-ai-ops.db'));
      symlinkSync(profileSource, profileAlias, 'junction');

      const result = evaluateProfileDatabaseFileIsolation({
        profileDatabasePath: path.join(profileAlias, 'amazon-ai-ops.db'),
        protectedDatabasePath,
      });

      expect(result.passed).toBe(false);
      expect(result.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'PROFILE_DATABASE_FILE_IDENTITY_UNVERIFIED' }),
      ]));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

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
      expect(first.fileCount).toBe(7);
      expect(first.files.map((file) => file.path)).toEqual([
        'dist/main/index.js',
        'dist/preload/index.js',
        'dist/renderer/assets/index.js',
        'dist/renderer/index.html',
        'node_modules/runtime/index.js',
        'package.json',
        'playwright-browsers/chrome-win64/chrome.exe',
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

  it('fails closed when the packaged Playwright Chromium runtime is missing', () => {
    withValidAppContent((root) => {
      rmSync(path.join(root, 'playwright-browsers/chrome-win64/chrome.exe'));
      expect(() => buildAppContentManifest(root)).toThrow(
        /required packaged runtime entry is missing.*playwright-browsers\/chrome-win64\/chrome\.exe/i,
      );
    });
  });

  it('locks the exact ten canonical Mission Control workspace identities and registered tabs', () => {
    expect(EXPECTED_PACKAGE_UI_WORKSPACES).toEqual([
      { workspace: 'today', subview: 'overview', label: '今日任务', heading: '今日任务', tabs: ['overview', 'events'] },
      { workspace: 'missions', subview: 'overview', label: '任务中心', heading: '任务中心', tabs: ['overview', 'facts'] },
      { workspace: 'decisions', subview: 'recommendations', label: '决策与审批', heading: '建议与审批', tabs: ['recommendations', 'approval', 'decided'] },
      { workspace: 'experiments', subview: 'ledger', label: '经营实验', heading: '经营实验', tabs: ['ledger'] },
      { workspace: 'execution', subview: 'live', label: '实时执行', heading: '实时执行', tabs: ['live', 'evidence'] },
      { workspace: 'memory', subview: 'timeline', label: '因果记忆', heading: '因果记忆', tabs: ['timeline'] },
      { workspace: 'objects', subview: 'products', label: '店铺与广告对象', heading: '店铺与广告对象', tabs: ['products', 'targets', 'keywords', 'listing'] },
      { workspace: 'collection', subview: 'scope', label: '数据采集', heading: '工作范围', tabs: ['scope', 'reports', 'import-check'] },
      { workspace: 'policy', subview: 'rules', label: '策略与风控', heading: '策略与风控', tabs: ['rules'] },
      { workspace: 'settings', subview: 'ai-and-local', label: '系统设置', heading: '店铺与运行设置', tabs: ['ai-and-local', 'scheduler', 'delivery'] },
    ]);
  });

  it('keeps package headings and tabs exactly aligned with the source Stage7 evidence contract', () => {
    expect(EXPECTED_PACKAGE_UI_WORKSPACES.map(({ workspace, subview, heading, tabs }) => ({
      workspace,
      subview,
      heading,
      tabs,
    }))).toEqual(Object.entries(MISSION_CONTROL_WORKSPACE_CONTRACT).map(([workspace, contract]) => ({
      workspace,
      subview: contract.defaultIntent.subview,
      heading: contract.heading,
      tabs: [...contract.tabs],
    })));
  });

  it('locks the read-only production scheduler subview without duplicating the settings workspace matrix entry', () => {
    expect(EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS).toEqual([{
      workspace: 'settings',
      subview: 'scheduler',
      label: '系统设置',
      heading: '当前店铺自动化',
      tabId: 'settings-workspace-tab-scheduler',
      capabilities: [
        {
          action: 'view',
          capabilityId: 'settings.scheduler.view',
          legacyRoute: 'scheduler',
          state: 'LEGACY_ADAPTER',
        },
        {
          action: 'start',
          capabilityId: 'settings.scheduler.run-now',
          legacyRoute: null,
          state: 'PRODUCTION_NATIVE',
        },
        {
          action: 'view',
          capabilityId: 'settings.scheduler.retention-preview',
          legacyRoute: null,
          state: 'PRODUCTION_NATIVE',
        },
      ],
    }]);
    expect(EXPECTED_PACKAGE_UI_WORKSPACES.filter((workspace) => workspace.workspace === 'settings')).toHaveLength(1);
    expect(validateSchedulerSubviewEvidence(validSchedulerSubviewEvidence())).toEqual(expect.objectContaining({
      passed: true,
      violations: [],
    }));
  });

  it('binds the Main scheduler read-only attestation to the live PID, mode, guards and current artifact', () => {
    const input = validReadOnlyRuntime('runtime-attestation-valid');

    expect(validatePackageUiReadOnlyRuntimeEvidence(
      input,
      { requireSchedulerReads: true },
    )).toEqual(expect.objectContaining({
      passed: true,
      violations: [],
    }));

    const unsafe = structuredClone(input);
    unsafe.marker.guards.runNowIpcDisabled = false;
    expect(validatePackageUiReadOnlyRuntimeEvidence(unsafe).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PACKAGE_UI_READ_ONLY_RUNTIME_GUARDS_NOT_DERIVED' }),
      expect.objectContaining({ code: 'PACKAGE_UI_READ_ONLY_RUNTIME_ARTIFACT_MISMATCH' }),
    ]));
  });

  it('accepts only exact ordered Main-derived database checkpoints and receipt binding', () => {
    const runtime = validReadOnlyRuntime('database-audit-valid');
    expect(validatePackageUiDatabaseMutationAudit(
      runtime.marker.databaseMutationAudit,
    )).toEqual(expect.objectContaining({
      passed: true,
      violations: [],
    }));
    expect(validatePackageUiDatabaseCheckpointReceipts(
      databaseCheckpointReceipts(runtime),
      runtime,
    )).toEqual(expect.objectContaining({
      passed: true,
      terminalCheckpoint: expect.objectContaining({ phase: 'pre-close-terminal' }),
      violations: [],
    }));

    const forgedReceipt = databaseCheckpointReceipts(runtime);
    forgedReceipt.postBootstrap.metrics.totalChanges += 1;
    expect(validatePackageUiDatabaseCheckpointReceipts(
      forgedReceipt,
      runtime,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PACKAGE_UI_DATABASE_CHECKPOINT_RECEIPTS_NOT_BOUND' }),
    ]));

    const noConfirmedExit = structuredClone(runtime);
    noConfirmedExit.processExitConfirmed = false;
    expect(validatePackageUiReadOnlyRuntimeEvidence(noConfirmedExit).violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PACKAGE_UI_READ_ONLY_RUNTIME_PROCESS_EXIT_UNCONFIRMED',
        }),
      ]),
    );
  });

  it('retrieves Renderer receipts around navigation and copies terminal Main evidence only after close', () => {
    const source = readFileSync(new URL('./package-ui-evidence.js', import.meta.url), 'utf8');
    const compactStart = source.indexOf('async function runScaleEvidenceCore');
    const compactEnd = source.indexOf('async function runWideProfileEvidenceCore', compactStart);
    const compact = source.slice(compactStart, compactEnd);
    const wideStart = compactEnd;
    const wideEnd = source.indexOf('async function runScaleEvidence', wideStart);
    const wide = source.slice(wideStart, wideEnd);

    for (const runner of [compact, wide]) {
      const authorityReadback = runner.indexOf(
        'session.storeAuthorityReadback = await collectEvidenceStoreAuthorityReadback',
      );
      const baselineReceipt = runner.indexOf(
        "requestPackageUiDatabaseCheckpoint(page, 'post-bootstrap')",
      );
      const navigation = runner.indexOf('for (const workspace');
      const finalCheckpoint = runner.indexOf("'post-navigation'", navigation);
      const electronClose = runner.indexOf('await electronApp.close()', finalCheckpoint);
      const runtimeMarker = runner.indexOf('collectPackageUiReadOnlyRuntimeEvidence');
      expect(authorityReadback).toBeGreaterThan(0);
      expect(baselineReceipt).toBeGreaterThan(authorityReadback);
      expect(navigation).toBeGreaterThan(baselineReceipt);
      expect(finalCheckpoint).toBeGreaterThan(navigation);
      expect(electronClose).toBeGreaterThan(finalCheckpoint);
      expect(runtimeMarker).toBeGreaterThan(electronClose);
    }
  });

  it.each([
    ['reordered checkpoints', (audit) => audit.checkpoints.reverse()],
    ['duplicate checkpoint phase', (audit) => {
      audit.checkpoints[1].phase = 'post-bootstrap';
    }],
    ['missing Main terminal checkpoint', (audit) => {
      audit.checkpoints.pop();
    }],
    ['removed metric field', (audit) => {
      delete audit.checkpoints[1].metrics.dataVersion;
    }],
    ['changed same-connection total_changes', (audit) => {
      audit.checkpoints[1].metrics.totalChanges += 1;
    }],
    ['changed external data_version', (audit) => {
      audit.checkpoints[1].metrics.dataVersion += 1;
    }],
    ['changed terminal total_changes', (audit) => {
      audit.checkpoints[2].metrics.totalChanges += 1;
    }],
    ['changed StoreContext digest', (audit) => {
      audit.checkpoints[1].contextDigestSha256 = HASH_A;
    }],
    ['forged pass/comparison fields', (audit) => {
      audit.checkpoints[1].metrics.digestSha256 = HASH_B;
      audit.passed = true;
      audit.comparisons.digestMatched = true;
    }],
  ])('fails closed for database audit tamper: %s', (_label, mutate) => {
    const audit = validDatabaseMutationAudit();
    mutate(audit);
    const result = validatePackageUiDatabaseMutationAudit(audit);
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it.each([
    [
      'Main capability projection drift',
      (evidence) => {
        evidence.ledgerAfter.events[0].response.capabilities
          .find((item) => item.capabilityId === 'settings.scheduler.run-now').state = 'BLOCKED';
      },
      'SCHEDULER_CAPABILITY_PROJECTION_MISMATCH',
    ],
    [
      'StoreContext identity drift',
      (evidence) => {
        evidence.ledgerAfter.events[0].response.authoritativeContext = {
          ...evidence.ledgerAfter.events[0].response.authoritativeContext,
          storeId: 'other-store',
        };
      },
      'SCHEDULER_AUTHORITY_CONTEXT_MISMATCH',
    ],
    [
      'opened run-now confirmation',
      (evidence) => {
        evidence.dom.confirmRunDialogCount = 1;
        evidence.dom.alertDialogCount = 1;
      },
      'SCHEDULER_UNSAFE_CAPTURE_STATE',
    ],
  ])('fails closed for scheduler %s', (_label, mutate, code) => {
    const evidence = validSchedulerSubviewEvidence();
    mutate(evidence);
    const result = validateSchedulerSubviewEvidence(evidence);
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code }),
    ]));
  });

  it('rejects a reused bootstrap event and exact-scope token drift such as USDT', () => {
    const reused = validSchedulerSubviewEvidence();
    reused.ledgerBefore = structuredClone(reused.ledgerAfter);
    expect(validateSchedulerSubviewEvidence(reused).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCHEDULER_HANDLER_LEDGER_CONTRACT_FAILED' }),
      expect.objectContaining({ code: 'SCHEDULER_BOOTSTRAP_RESPONSE_MISMATCH' }),
    ]));

    const usdt = validSchedulerSubviewEvidence();
    usdt.dom.fixedScopeText = 'US USD USDT';
    expect(validateSchedulerSubviewEvidence(usdt).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCHEDULER_FIXED_SCOPE_MISSING' }),
    ]));
  });

  it('binds each scheduler subview ledger to the hash-proven Main runtime event prefix', () => {
    const subview = validSchedulerSubviewEvidence();
    const runtime = validReadOnlyRuntime('scheduler-binding');
    expect(validateSchedulerSubviewRuntimeBinding(subview, runtime)).toEqual(expect.objectContaining({
      passed: true,
      prefixMatched: true,
      violations: [],
    }));

    const detached = structuredClone(subview);
    detached.ledgerAfter.events[0].request.requestId = 'renderer-bootstrap-detached-1';
    detached.ledgerAfter.events[0].response.requestId = 'renderer-bootstrap-detached-1';
    expect(validateSchedulerSubviewEvidence(detached).passed).toBe(true);
    expect(validateSchedulerSubviewRuntimeBinding(detached, runtime).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCHEDULER_SUBVIEW_RUNTIME_LEDGER_NOT_BOUND' }),
    ]));
  });

  it('fails closed unless End and Home select and focus the registered canonical tabs', () => {
    const expected = EXPECTED_PACKAGE_UI_WORKSPACES.find((workspace) => workspace.workspace === 'objects');
    const snapshot = (activeSubview) => ({
      activeSubview,
      focusedSubview: activeSubview,
      selectedCount: 1,
      selectedSubview: activeSubview,
      tabCount: expected.tabs.length,
    });
    expect(validateWorkspaceTabKeyboardEvidence({
      initial: snapshot('products'),
      end: snapshot('listing'),
      restored: snapshot('products'),
    }, expected)).toEqual(expect.objectContaining({ passed: true, violations: [] }));

    const failed = validateWorkspaceTabKeyboardEvidence({
      initial: snapshot('products'),
      end: { ...snapshot('listing'), focusedSubview: 'products' },
      restored: snapshot('products'),
    }, expected);
    expect(failed.passed).toBe(false);
    expect(failed.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WORKSPACE_TAB_KEYBOARD_STATE_MISMATCH' }),
    ]));
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

  it('limits automation to navigation, canonical tab keyboard checks, read-only subviews and three non-writing overlays', () => {
    const result = validateReadOnlyInteractionPlan();
    expect(result).toEqual({ passed: true, violations: [] });
    expect(EXPECTED_OVERLAY_CHECK_IDS).toEqual([
      'report-selector-dialog',
      'decisions-controlled-review-inspector',
      'readback-technical-drawer',
    ]);
    expect(READ_ONLY_INTERACTION_PLAN.filter((item) => item.kind === 'keyboard-navigation').map((item) => item.id)).toEqual([
      'workspace-tab-keyboard-navigation',
    ]);
    expect(READ_ONLY_INTERACTION_PLAN.filter((item) => item.kind === 'subview').map((item) => item.id)).toEqual([
      'report-subview-navigation',
      'scheduler-subview-readonly',
    ]);
    expect(READ_ONLY_INTERACTION_PLAN.filter((item) => item.kind === 'row-selection')).toEqual([]);
    const source = readFileSync('scripts/package-ui-evidence.js', 'utf8');
    expect(source.match(/electronApp: runOptions\.electronApp/g)).toHaveLength(3);
    expect(source).toContain('const api = window.electronAPI;');
    expect(source).not.toContain('window.desktopApi');
    const schedulerCollector = source.slice(
      source.indexOf('async function collectSchedulerSubviewEvidence'),
      source.indexOf('function isRetryableLoginNavigationError'),
    );
    expect(schedulerCollector).toContain('ledgerBefore');
    expect(schedulerCollector).toContain('ledgerAfter');
    expect(schedulerCollector).toContain("getAttribute('data-schedule-state')");
    expect(schedulerCollector).not.toContain('window.electronAPI');
    expect(schedulerCollector).not.toContain('missionControl.query');
    expect(schedulerCollector).not.toContain('getStoreCollectionSchedule');
    expect(schedulerCollector).not.toContain('previewStoreEvidenceRetention');
    expect(schedulerCollector).not.toContain('missionControl.command');
    expect(schedulerCollector).not.toContain('runStoreCollectionScheduleNow');
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

  it('requires protected state, process cleanup, 100% and 125%, ten workspaces, keyboard evidence, three overlays and hashed screenshots', () => {
    const runGroupId = 'package-ui-test-run-group';
    const runnerContract = buildPackageUiRunnerContract();
    const checkpointComposition = validCheckpointComposition(
      runGroupId,
      runnerContract.sha256,
    );
    const valid = {
      artifactHashesStable: true,
      checkpointComposition,
      schemaVersion: 7,
      interactiveLoginContract: INTERACTIVE_LOGIN_CONTRACT,
      isolatedProfileBootstrapContract: ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
      packageProcessIsolation: validProcessIsolation(),
      profileDatabaseFileIsolation: { passed: true },
      profileDatabaseProvenance: { passed: true },
      profileProcessIsolation: validProcessIsolation(),
      profileLineage: {
        final: structuredClone(checkpointComposition.finalProfileState),
        passed: true,
      },
      protectedDatabase: { passed: true },
      protectedDatabaseLogical: {
        after: validLogicalArtifact(),
        before: validLogicalArtifact(),
        passed: true,
      },
      requested: {
        allowInteractiveLogin: true,
        allowSavedLogin: false,
        interactiveLoginTimeoutMs: 600_000,
        loginMode: 'interactive-operator-each-run',
        resumeRunGroupId: null,
        runGroupId,
      },
      runGroup: {
        profileSequence: PACKAGE_UI_PROFILE_SEQUENCE,
        runGroupId,
        runnerContractSha256: runnerContract.sha256,
      },
      runs: EXPECTED_PACKAGE_UI_SCALES.map(validRun),
      wideProfile: validWideRun(),
    };
    expect(evaluatePackageUiEvidenceCompleteness(valid)).toEqual({ passed: true, violations: [] });

    const missingLogicalProtection = structuredClone(valid);
    delete missingLogicalProtection.protectedDatabaseLogical;
    expect(evaluatePackageUiEvidenceCompleteness(
      missingLogicalProtection,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROTECTED_DATABASE_LOGICAL_STATE_CHANGED' }),
    ]));

    const missingCheckpointComposition = structuredClone(valid);
    delete missingCheckpointComposition.checkpointComposition;
    expect(evaluatePackageUiEvidenceCompleteness(
      missingCheckpointComposition,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROFILE_CHECKPOINT_COMPOSITION_MISSING_OR_FAILED' }),
      expect.objectContaining({ code: 'TERMINAL_PROFILE_LINEAGE_MISSING_OR_FAILED' }),
    ]));

    const missingChromiumLineage = structuredClone(valid);
    delete missingChromiumLineage.runs[0].chromiumProcessLineage;
    expect(evaluatePackageUiEvidenceCompleteness(
      missingChromiumLineage,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_CHROMIUM_LINEAGE_MISSING_OR_FAILED' }),
    ]));

    const missingAttemptArtifacts = structuredClone(valid);
    delete missingAttemptArtifacts.runs[0].attemptArtifacts;
    expect(evaluatePackageUiEvidenceCompleteness(
      missingAttemptArtifacts,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_ATTEMPT_ARTIFACTS_MISSING_OR_CHANGED' }),
    ]));

    const changedRunnerLineage = structuredClone(valid);
    changedRunnerLineage.runGroup.runnerContractSha256 = HASH_A;
    expect(evaluatePackageUiEvidenceCompleteness(
      changedRunnerLineage,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'RUNNER_CONTRACT_LINEAGE_MISSING_OR_CHANGED' }),
    ]));

    const emptyWideWorkspace = structuredClone(valid);
    emptyWideWorkspace.wideProfile.workspaceChecks = [];
    expect(evaluatePackageUiEvidenceCompleteness(
      emptyWideWorkspace,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WIDE_CANONICAL_WORKSPACE_MISSING_OR_FAILED' }),
    ]));

    const missingScaleDatabaseReceipts = structuredClone(valid);
    delete missingScaleDatabaseReceipts.runs[0].databaseAuditCheckpoints;
    expect(evaluatePackageUiEvidenceCompleteness(
      missingScaleDatabaseReceipts,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_DATABASE_AUDIT_CHECKPOINTS_MISSING_OR_FAILED' }),
    ]));

    const tamperedScaleDatabaseReceipt = structuredClone(valid);
    tamperedScaleDatabaseReceipt.runs[0]
      .databaseAuditCheckpoints
      .postNavigation
      .metrics
      .totalChanges += 1;
    expect(evaluatePackageUiEvidenceCompleteness(
      tamperedScaleDatabaseReceipt,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_DATABASE_AUDIT_CHECKPOINTS_MISSING_OR_FAILED' }),
    ]));

    const missingWideDatabaseReceipts = structuredClone(valid);
    delete missingWideDatabaseReceipts.wideProfile.databaseAuditCheckpoints;
    expect(evaluatePackageUiEvidenceCompleteness(
      missingWideDatabaseReceipts,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WIDE_DATABASE_AUDIT_CHECKPOINTS_MISSING_OR_FAILED' }),
    ]));

    const changedMainDatabaseAudit = structuredClone(valid);
    changedMainDatabaseAudit.runs[0]
      .schedulerReadOnlyRuntime
      .marker
      .databaseMutationAudit
      .checkpoints[1]
      .metrics
      .dataVersion += 1;
    expect(evaluatePackageUiEvidenceCompleteness(
      changedMainDatabaseAudit,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_SCHEDULER_READ_ONLY_RUNTIME_MISSING_OR_FAILED' }),
      expect.objectContaining({ code: 'SCALE_DATABASE_AUDIT_CHECKPOINTS_MISSING_OR_FAILED' }),
    ]));

    const missingBootstrapContract = structuredClone(valid);
    delete missingBootstrapContract.isolatedProfileBootstrapContract;
    expect(evaluatePackageUiEvidenceCompleteness(missingBootstrapContract).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ISOLATED_PROFILE_BOOTSTRAP_CONTRACT_MISSING_OR_CHANGED' }),
    ]));

    const missingInteractiveLoginContract = structuredClone(valid);
    delete missingInteractiveLoginContract.interactiveLoginContract;
    expect(evaluatePackageUiEvidenceCompleteness(
      missingInteractiveLoginContract,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INTERACTIVE_LOGIN_CONTRACT_MISSING_OR_CHANGED' }),
    ]));

    const savedOnlyV7 = structuredClone(valid);
    savedOnlyV7.requested.allowInteractiveLogin = false;
    savedOnlyV7.requested.allowSavedLogin = true;
    savedOnlyV7.requested.loginMode = 'app-owned-saved-login';
    expect(evaluatePackageUiEvidenceCompleteness(savedOnlyV7).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INTERACTIVE_LOGIN_REQUEST_CONTRACT_MISMATCH' }),
    ]));

    const firstRunReusedWithoutTypedProof = structuredClone(valid);
    firstRunReusedWithoutTypedProof.runs[0].session.loginSessionAttestation = {
      adsSessionReady: true,
      credentialPersistence: 'main_managed',
      credentialSource: 'saved',
      erpSessionReady: true,
      erpSessionReused: true,
      ok: true,
      sessionIdentityVerified: false,
    };
    expect(evaluatePackageUiEvidenceCompleteness(
      firstRunReusedWithoutTypedProof,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INTERACTIVE_LOGIN_FIRST_RUN_TYPED_PROOF_MISSING' }),
    ]));

    const nonInteractiveScale = structuredClone(valid);
    nonInteractiveScale.runs[1].session.mode = 'existing-authenticated-session';
    nonInteractiveScale.runs[1].diagnostics.login.outcome = 'existing-authenticated-session';
    delete nonInteractiveScale.runs[1].session.operatorHandoff;
    delete nonInteractiveScale.runs[1].diagnostics.login.operatorHandoff;
    expect(evaluatePackageUiEvidenceCompleteness(nonInteractiveScale).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_INTERACTIVE_LOGIN_HANDOFF_MISSING' }),
    ]));

    const nonInteractiveWide = structuredClone(valid);
    nonInteractiveWide.wideProfile.session.mode = 'saved-credentials-login';
    nonInteractiveWide.wideProfile.diagnostics.login.outcome = 'saved-credentials-login';
    delete nonInteractiveWide.wideProfile.session.operatorHandoff;
    delete nonInteractiveWide.wideProfile.diagnostics.login.operatorHandoff;
    expect(evaluatePackageUiEvidenceCompleteness(nonInteractiveWide).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WIDE_INTERACTIVE_LOGIN_HANDOFF_MISSING' }),
    ]));

    const missingScaleBootstrap = structuredClone(valid);
    delete missingScaleBootstrap.runs[0].session.connectionBootstrap;
    expect(evaluatePackageUiEvidenceCompleteness(missingScaleBootstrap).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_ISOLATED_PROFILE_BOOTSTRAP_MISSING_OR_FAILED' }),
    ]));

    const legacyV5 = structuredClone(valid);
    legacyV5.schemaVersion = 5;
    for (const run of legacyV5.runs) {
      delete run.schedulerReadOnlyRuntime;
      delete run.subviewChecks;
    }
    delete legacyV5.wideProfile.schedulerReadOnlyRuntime;
    expect(evaluatePackageUiEvidenceCompleteness(legacyV5)).toEqual({ passed: true, violations: [] });

    const legacyV6 = structuredClone(valid);
    legacyV6.schemaVersion = 6;
    delete legacyV6.interactiveLoginContract;
    expect(evaluatePackageUiEvidenceCompleteness(legacyV6)).toEqual({ passed: true, violations: [] });

    const unsupportedSchema = evaluatePackageUiEvidenceCompleteness({ ...valid, schemaVersion: 4 });
    expect(unsupportedSchema.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PACKAGE_UI_SCHEMA_UNSUPPORTED' }),
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

    const hardlinkedProfileDatabase = evaluatePackageUiEvidenceCompleteness({
      ...valid,
      profileDatabaseFileIsolation: { passed: false },
    });
    expect(hardlinkedProfileDatabase.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROFILE_DATABASE_FILE_ISOLATION_FAILED' }),
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

    const missingSchedulerSubview = structuredClone(valid);
    missingSchedulerSubview.runs[0].subviewChecks = [];
    expect(evaluatePackageUiEvidenceCompleteness(missingSchedulerSubview).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SUBVIEW_CHECK_MISSING_OR_FAILED' }),
    ]));

    const forgedSchedulerIdentity = structuredClone(valid);
    forgedSchedulerIdentity.runs[0].subviewChecks[0].identityCapabilityEvidence = { passed: true };
    expect(evaluatePackageUiEvidenceCompleteness(forgedSchedulerIdentity).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SUBVIEW_IDENTITY_CAPABILITY_MISSING_OR_FAILED' }),
    ]));

    const detachedSchedulerLedger = structuredClone(valid);
    const detachedSchedulerIdentity = detachedSchedulerLedger.runs[0]
      .subviewChecks[0]
      .identityCapabilityEvidence;
    detachedSchedulerIdentity.ledgerAfter.events[0].request.requestId = 'renderer-bootstrap-detached-2';
    detachedSchedulerIdentity.ledgerAfter.events[0].response.requestId = 'renderer-bootstrap-detached-2';
    expect(validateSchedulerSubviewEvidence(detachedSchedulerIdentity).passed).toBe(true);
    expect(evaluatePackageUiEvidenceCompleteness(detachedSchedulerLedger).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SUBVIEW_RUNTIME_ATTESTATION_BINDING_FAILED' }),
    ]));

    const missingSchedulerScreenshot = structuredClone(valid);
    delete missingSchedulerScreenshot.runs[0].subviewChecks[0].screenshot;
    expect(evaluatePackageUiEvidenceCompleteness(missingSchedulerScreenshot).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SUBVIEW_SCREENSHOT_MISSING_OR_STALE' }),
    ]));

    const staleSchedulerScreenshot = structuredClone(valid);
    staleSchedulerScreenshot.runs[0].subviewChecks[0].screenshot.sha256 = HASH_A;
    expect(evaluatePackageUiEvidenceCompleteness(staleSchedulerScreenshot).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SUBVIEW_SCREENSHOT_MISSING_OR_STALE' }),
    ]));

    const missingSchedulerRuntime = structuredClone(valid);
    delete missingSchedulerRuntime.runs[0].schedulerReadOnlyRuntime;
    expect(evaluatePackageUiEvidenceCompleteness(missingSchedulerRuntime).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_SCHEDULER_READ_ONLY_RUNTIME_MISSING_OR_FAILED' }),
    ]));

    const missingWideSchedulerRuntime = structuredClone(valid);
    delete missingWideSchedulerRuntime.wideProfile.schedulerReadOnlyRuntime;
    expect(evaluatePackageUiEvidenceCompleteness(missingWideSchedulerRuntime).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WIDE_SCHEDULER_READ_ONLY_RUNTIME_MISSING_OR_FAILED' }),
    ]));

    const workspaceSubviewCollision = structuredClone(valid);
    workspaceSubviewCollision.runs[0].screenshots.find((item) => item.workspace === 'settings').subview = 'scheduler';
    expect(evaluatePackageUiEvidenceCompleteness(workspaceSubviewCollision).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WORKSPACE_SCREENSHOT_MISSING_OR_UNHASHED' }),
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
