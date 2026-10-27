import { packageUiFunctionSource } from './package-ui-test-sources.mjs';
import {
  EXPECTED_PACKAGE_UI_SCALES,
  describe,
  expect,
  hasAuthenticatedWorkspace,
  isWorkspaceProbeAbsenceError,
  it,
  openStoreScopedConnectionWorkbench,
  packageUiAttemptDiagnosticsSnapshotMatches,
  readFileSync,
  selectDeterministicEvidenceStoreCandidate,
  validRunDiagnostics,
  validateIsolatedProfileBootstrapEvidence,
  waitForInteractiveAuthenticatedWorkspace,
} from './package-ui-test-context.mjs';
import {
  validDiagnostics,
  validRun,
  validSavedLoginRun,
  validSession,
} from './package-ui-test-fixtures.mjs';

describe('workspace authentication probe', () => {
  it('treats a bounded locator timeout as an unauthenticated result without masking the login error', () => {
    expect(isWorkspaceProbeAbsenceError({
      name: 'TimeoutError',
      message: 'locator.waitFor: Timeout 2000ms exceeded.',
    })).toBe(true);
    expect(isWorkspaceProbeAbsenceError(new Error('execution context was destroyed'))).toBe(true);
    expect(isWorkspaceProbeAbsenceError(new Error('renderer crashed'))).toBe(false);
  });

  it('requires a visible workspace with a ready Main session even while the store connection workbench remains visible', async () => {
    const readyAttestation = {
      adsSessionReady: true,
      credentialPersistence: 'saved',
      credentialSource: 'typed',
      erpSessionReady: true,
      erpSessionReused: false,
      ok: true,
      sessionIdentityVerified: true,
    };
    const page = (visibility, attestation) => ({
      evaluate: async () => attestation,
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
      [loginSelector]: true,
    }, readyAttestation))).resolves.toBe(true);
    await expect(hasAuthenticatedWorkspace(page({
      [workspaceSelector]: false,
      [loginSelector]: false,
    }, readyAttestation))).resolves.toBe(false);
    await expect(hasAuthenticatedWorkspace(page({
      [workspaceSelector]: true,
      [loginSelector]: true,
    }, { ...readyAttestation, adsSessionReady: false }))).resolves.toBe(false);
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

  it('accepts a newly attested login while the store-scoped connection workbench remains visible', async () => {
    let tick = 0;
    const attestation = {
      adsSessionReady: true,
      credentialPersistence: 'saved',
      credentialSource: 'typed',
      erpSessionReady: true,
      erpSessionReused: false,
      ok: true,
      sessionIdentityVerified: true,
    };
    const page = {
      evaluate: async () => attestation,
      isClosed: () => false,
      locator: (selector) => ({
        isVisible: async () => (
          selector === 'nav[aria-label="主业务导航"]'
          || selector === '[data-login-connection-status]'
          || selector === '.login-submit-button[aria-busy="true"]'
        ),
      }),
      waitForTimeout: async (duration) => {
        tick += Math.max(1, Math.floor(duration / 2));
      },
    };

    await expect(waitForInteractiveAuthenticatedWorkspace(page, 10, {
      monotonicNow: () => tick,
      now: () => Date.parse('2026-08-05T09:00:00.000Z'),
    })).resolves.toEqual(attestation);
  });

  it.each([false, true])('opens the exact connection entry through the six-module sidebar (collapsed=%s)', async (initiallyCollapsed) => {
    let collapsed = initiallyCollapsed;
    let expanded = false;
    let workbenchVisible = false;
    const clicks = [];
    const page = {
      waitForFunction: async () => undefined,
      getByRole: (_role, { name }) => {
        expect(name).toBe('展开主导航');
        return { isVisible: async () => collapsed, click: async () => { collapsed = false; clicks.push('expand'); } };
      },
      locator: (selector) => {
        if (selector === '[data-login-connection-status]') return {
          isVisible: async () => workbenchVisible,
          waitFor: async () => { expect(workbenchVisible).toBe(true); },
        };
        if (selector === 'nav[aria-label="主业务导航"]') return { waitFor: async () => undefined };
        if (selector === '.app-sidebar [data-operator-module="system-settings"]') return {
          count: async () => 1,
          getAttribute: async () => expanded ? 'true' : 'false',
          click: async () => { expanded = true; clicks.push('system-settings'); },
        };
        if (selector === '.app-sidebar [data-operator-entry="settings/ai-and-local"]') return {
          count: async () => expanded && !collapsed ? 1 : 0,
          getAttribute: async () => null,
          click: async () => { workbenchVisible = true; clicks.push('settings/ai-and-local'); },
        };
        throw new Error(`unexpected selector: ${selector}`);
      },
    };
    await expect(openStoreScopedConnectionWorkbench(page)).resolves.toEqual({
      navigated: true, surface: 'store-scoped-connection-workbench',
    });
    expect(clicks).toEqual([...(initiallyCollapsed ? ['expand'] : []), 'system-settings', 'settings/ai-and-local']);
    await expect(openStoreScopedConnectionWorkbench(page)).resolves.toEqual({
      navigated: false, surface: 'store-scoped-connection-workbench',
    });
    expect(clicks).toHaveLength(initiallyCollapsed ? 3 : 2);
  });
  it('selects the first explicit active Store Gate option deterministically without retaining an unbounded label', () => {
    expect(selectDeterministicEvidenceStoreCandidate([
      { label: '请选择店铺', value: '' },
      { disabled: true, label: '已停用店铺', value: 'store-disabled' },
      { label: '  SHC001\u0000 · US · USD  ', value: ' store-us-001 ' },
      { label: 'SHC002 · US · USD', value: 'store-us-002' },
    ])).toEqual({
      label: '  SHC001 · US · USD  ',
      value: 'store-us-001',
    });
    expect(selectDeterministicEvidenceStoreCandidate(null)).toBeNull();
    expect(selectDeterministicEvidenceStoreCandidate([{ label: '请选择店铺', value: '' }])).toBeNull();
  });

  it('keeps the explicitly selected store when an isolated profile contains multiple active stores', () => {
    expect(selectDeterministicEvidenceStoreCandidate([
      { label: 'Store A', selected: false, value: 'store-a' },
      { label: 'Store B', selected: true, value: 'store-b' },
    ])).toEqual({
      label: 'Store B',
      value: 'store-b',
    });
  });

  it('handles the first-run Store Gate through visible controls before probing saved login', () => {
    const connectionBody = packageUiFunctionSource('package-ui-store-bootstrap.js', 'ensureEvidenceLingxingConnection');
    const storeGateBody = packageUiFunctionSource('package-ui-store-bootstrap.js', 'ensureEvidenceStoreContext');
    const authenticationBody = packageUiFunctionSource('package-ui-authentication.js', 'ensureAuthenticatedWorkspace');

    expect(storeGateBody).toContain("getByRole('dialog', { name: '新增美国站店铺' })");
    expect(storeGateBody).toContain("getByRole('button', { name: '创建店铺', exact: true })");
    expect(storeGateBody).toContain(".store-scope-switcher__option[data-store-scope-id]");
    expect(storeGateBody).toContain("hasText: '切换到新店铺'");
    expect(storeGateBody).toContain('created-and-selected-isolated-evidence-store');
    expect(storeGateBody).toContain('selected-existing-store');
    expect(storeGateBody).not.toMatch(/window\.(?:api|electron|electronAPI)|ipcRenderer|stores:create/);
    expect(connectionBody).toContain('[data-login-connection-status]');
    expect(connectionBody).toContain('[data-package-ui-evidence-action="bind-lingxing-connection"]');
    expect(connectionBody).toContain('bound-isolated-evidence-lingxing-connection');
    expect(connectionBody).not.toMatch(/window\.(?:api|electron|electronAPI)|ipcRenderer|stores:connections:create/);
    expect(authenticationBody).toContain("['store-gate', 'workspace'].includes(entrySurface?.kind)");
    expect(authenticationBody.indexOf('ensureEvidenceStoreContext(page, options.diagnostics)'))
      .toBeLessThan(authenticationBody.indexOf('hasAuthenticatedWorkspace(page)'));
    expect(authenticationBody.indexOf('openStoreScopedConnectionWorkbench(page)'))
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

  it('accepts the unique Electron app-close callback after a clean process exit', () => {
    const run = validRun(EXPECTED_PACKAGE_UI_SCALES[0]);
    const events = run.diagnostics.lifecycle.events;
    const appClosedIndex = events.findIndex((event) => event.kind === 'electron-app-closed');
    const processExitIndex = events.findIndex((event) => event.kind === 'electron-process-exit');
    const appClosed = events[appClosedIndex];
    const processExit = events[processExitIndex];

    processExit.at = '2026-07-17T06:00:00.850Z';
    run.diagnostics.lifecycle.processExit.at = processExit.at;
    appClosed.at = '2026-07-17T06:00:00.900Z';
    events.splice(appClosedIndex, 2, processExit, appClosed);

    expect(validRunDiagnostics(run.diagnostics, run)).toBe(true);
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
    ['missing app-close callback', (run) => {
      const events = run.diagnostics.lifecycle.events;
      const appClosedIndex = events.findIndex(
        (event) => event.kind === 'electron-app-closed',
      );
      events.splice(appClosedIndex, 1);
    }],
    ['duplicate app-close callback', (run) => {
      const events = run.diagnostics.lifecycle.events;
      const appClosedIndex = events.findIndex(
        (event) => event.kind === 'electron-app-closed',
      );
      events.splice(appClosedIndex, 0, { ...events[appClosedIndex] });
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
