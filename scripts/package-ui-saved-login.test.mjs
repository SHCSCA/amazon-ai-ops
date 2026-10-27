import {
  EXPECTED_PACKAGE_UI_SCALES,
  INTERACTIVE_LOGIN_CONTRACT,
  describe,
  expect,
  isRetryableLoginNavigationError,
  it,
  readFileSync,
  validRunDiagnostics,
  validateLoginSessionAttestation,
  waitForInteractiveAuthenticatedWorkspace,
} from './package-ui-test-context.mjs';
import {
  applyInteractiveOperatorHandoff,
  validRun,
} from './package-ui-test-fixtures.mjs';

describe('saved-login navigation retry contract', () => {
  it('retries only explicit browser navigation context replacement errors', () => {
    expect(isRetryableLoginNavigationError('Execution context was destroyed, most likely because of a navigation.')).toBe(true);
    expect(isRetryableLoginNavigationError('Most likely because of a navigation')).toBe(true);
    expect(isRetryableLoginNavigationError('用户名或密码错误')).toBe(false);
    expect(isRetryableLoginNavigationError('Timeout 120000ms exceeded')).toBe(false);
  });

  it('proves saved-login readiness from non-secret Main-managed status instead of a populated password input', () => {
    const source = readFileSync('scripts/package-ui-authentication.js', 'utf8');

    expect(source).toContain("getAttribute('data-credential-source') === 'saved'");
    expect(source).toContain('passwordManagedByMain');
    expect(source).toContain('passwordInputEmpty');
    expect(source).toContain('statusConfirmsMainOnly');
    expect(source).not.toContain('passwordAvailable: Boolean(document.querySelector(\'input[placeholder="领星密码"]\')?.value)');
    expect(source).not.toMatch(/authenticated-during-credential-observation[\s\S]{0,500}passwordInputEmpty:\s*true/);
    expect(source).not.toMatch(/authenticated-during-credential-observation[\s\S]{0,500}passwordManagedByMain:\s*true/);
  });

  it('keeps an explicit interactive operator login handoff separate from saved-login automation and secret inspection', () => {
    const source = readFileSync('scripts/package-ui-authentication.js', 'utf8');
    const authenticationBody = source.slice(
      source.indexOf('async function ensureAuthenticatedWorkspace'),
      source.indexOf('function firstInteractiveLoginAttestationPassed'),
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
      durationClock: 'performance.now',
      elapsedMs: 190,
      finalPhase: 'authorization',
      kind: 'visible-user-handoff',
      maximumTotalTimeoutMs: 1_200_000,
      outcome: 'workspace-reached',
      phaseTimeoutMs: 600_000,
      phaseTransitions: [
        { elapsedMs: 0, phase: 'preparation', startedAt: '2026-07-17T06:00:00.210Z' },
        { elapsedMs: 90, phase: 'authorization', startedAt: '2026-07-17T06:00:00.300Z' },
      ],
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

    const overlongPreparation = structuredClone(operatorHandoff);
    overlongPreparation.phaseTransitions[1].elapsedMs = 600_001;
    run.session.operatorHandoff = overlongPreparation;
    run.diagnostics.login.operatorHandoff = structuredClone(overlongPreparation);
    expect(validRunDiagnostics(run.diagnostics, run)).toBe(false);

    const overlongAuthorization = structuredClone(operatorHandoff);
    overlongAuthorization.elapsedMs = 600_091;
    run.session.operatorHandoff = overlongAuthorization;
    run.diagnostics.login.operatorHandoff = structuredClone(overlongAuthorization);
    expect(validRunDiagnostics(run.diagnostics, run)).toBe(false);

    const overlongTotal = structuredClone(operatorHandoff);
    overlongTotal.elapsedMs = 1_200_001;
    run.session.operatorHandoff = overlongTotal;
    run.diagnostics.login.operatorHandoff = structuredClone(overlongTotal);
    expect(validRunDiagnostics(run.diagnostics, run)).toBe(false);
  });

  it('accepts a bounded retry handoff only when preparation and authorization phases strictly alternate', () => {
    const run = validRun(EXPECTED_PACKAGE_UI_SCALES[0]);
    applyInteractiveOperatorHandoff(run);
    const retryTransitions = [
      { elapsedMs: 0, phase: 'preparation', startedAt: '2026-07-17T06:00:00.210Z' },
      { elapsedMs: 90, phase: 'authorization', startedAt: '2026-07-17T06:00:00.300Z' },
      { elapsedMs: 120, phase: 'preparation', startedAt: '2026-07-17T06:00:00.330Z' },
      { elapsedMs: 150, phase: 'authorization', startedAt: '2026-07-17T06:00:00.360Z' },
    ];
    run.session.operatorHandoff.phaseTransitions = structuredClone(retryTransitions);
    run.diagnostics.login.operatorHandoff.phaseTransitions = structuredClone(retryTransitions);

    expect(validRunDiagnostics(run.diagnostics, run)).toBe(true);

    const repeatedPhase = structuredClone(run);
    repeatedPhase.session.operatorHandoff.phaseTransitions[2].phase = 'authorization';
    repeatedPhase.diagnostics.login.operatorHandoff.phaseTransitions[2].phase = 'authorization';
    expect(validRunDiagnostics(repeatedPhase.diagnostics, repeatedPhase)).toBe(false);

    const overlongRetryPhase = structuredClone(run);
    overlongRetryPhase.session.operatorHandoff.phaseTransitions[2].elapsedMs = 600_091;
    overlongRetryPhase.diagnostics.login.operatorHandoff.phaseTransitions[2].elapsedMs = 600_091;
    expect(validRunDiagnostics(overlongRetryPhase.diagnostics, overlongRetryPhase)).toBe(false);
  });

  it('requires typed-and-saved identity proof for the first handoff and a bounded saved-session continuation afterwards', () => {
    expect(INTERACTIVE_LOGIN_CONTRACT).toEqual(expect.objectContaining({
      authorizationStartSignal: 'durable-login-attempt-sequence-or-visible-login-submit-aria-busy-or-authenticated-workspace',
      deadlineClock: 'monotonic-performance-now',
      durationEvidence: 'monotonic-elapsed-ms',
      firstRunFreshTypedIdentityProof: true,
      maximumTotalTimeoutMultiplier: 2,
      mode: 'visible-operator-each-run',
      phaseModel: 'operator-preparation-then-browser-authorization',
      phaseTimeoutAppliedSeparately: true,
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

  it('waits on bounded phases for a ready Main projection and returns null on timeout', async () => {
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

  it('starts a fresh bounded authorization phase after the visible submit enters busy state', async () => {
    let currentTime = Date.parse('2026-07-17T06:00:00.000Z');
    const phaseTransitions = [];
    const ready = await waitForInteractiveAuthenticatedWorkspace({
      evaluate: async () => ({
        adsSessionReady: true,
        credentialPersistence: 'saved',
        credentialSource: 'typed',
        erpSessionReady: true,
        erpSessionReused: false,
        ok: true,
        sessionIdentityVerified: true,
      }),
      locator: (selector) => ({
        isVisible: async () => {
          const elapsed = currentTime - Date.parse('2026-07-17T06:00:00.000Z');
          if (selector === 'nav[aria-label="主业务导航"]') return elapsed >= 1_500;
          if (selector === '[data-login-connection-status]') return elapsed < 1_500;
          if (selector === '.login-submit-button[aria-busy="true"]') return elapsed >= 1_000;
          return false;
        },
      }),
      waitForTimeout: async (waitMs) => {
        currentTime += waitMs;
      },
    }, 1_100, {
      monotonicNow: () => currentTime,
      now: () => currentTime,
      onPhaseChange: (transition) => phaseTransitions.push(transition),
    });

    expect(phaseTransitions.map(({ phase }) => phase)).toEqual([
      'preparation',
      'authorization',
    ]);
    expect(ready).toEqual(expect.objectContaining({
      adsSessionReady: true,
      erpSessionReady: true,
      ok: true,
    }));
  });

  it('starts authorization from a durable submit sequence when the aria-busy pulse was missed', async () => {
    const loginWorkbenchSource = readFileSync(
      new URL('../apps/desktop/src/renderer/app-store-connection-view.tsx', import.meta.url),
      'utf8',
    );
    const controllerSource = readFileSync(new URL('../apps/desktop/src/renderer/app-store-connection-controller.tsx', import.meta.url), 'utf8');
    let monotonicTime = 0;
    const phaseTransitions = [];
    const ready = await waitForInteractiveAuthenticatedWorkspace({
      evaluate: async () => ({
        adsSessionReady: monotonicTime >= 1_000,
        credentialPersistence: monotonicTime >= 1_000 ? 'saved' : null,
        credentialSource: monotonicTime >= 1_000 ? 'typed' : null,
        erpSessionReady: monotonicTime >= 1_000,
        erpSessionReused: false,
        ok: monotonicTime >= 1_000,
        sessionIdentityVerified: monotonicTime >= 1_000,
      }),
      locator: (selector) => ({
        getAttribute: async (attribute) => {
          if (selector !== '[data-login-connection-status]') return null;
          if (attribute !== 'data-login-attempt-sequence') return null;
          return monotonicTime >= 500 ? '1' : '0';
        },
        isVisible: async () => {
          if (selector === 'nav[aria-label="主业务导航"]') return true;
          if (selector === '[data-login-connection-status]') return true;
          if (selector === '.login-submit-button[aria-busy="true"]') return false;
          return false;
        },
      }),
      waitForTimeout: async (waitMs) => {
        monotonicTime += waitMs;
      },
    }, 1_100, {
      monotonicNow: () => monotonicTime,
      now: () => Date.parse('2026-08-07T05:00:00.000Z') + monotonicTime,
      onPhaseChange: (transition) => phaseTransitions.push(transition),
    });

    expect(phaseTransitions.map(({ phase }) => phase)).toEqual([
      'preparation',
      'authorization',
    ]);
    expect(loginWorkbenchSource).toContain('data-login-attempt-sequence={loginAttemptSequence}');
    expect(controllerSource).toContain('setLoginAttemptSequence((current) => current + 1);');
    expect(controllerSource.indexOf('setLoginAttemptSequence((current) => current + 1);'))
      .toBeLessThan(controllerSource.indexOf('setLoading(true);'));
    expect(ready).toEqual(expect.objectContaining({
      adsSessionReady: true,
      credentialPersistence: 'saved',
      credentialSource: 'typed',
      erpSessionReady: true,
      ok: true,
    }));
  });

  it('recognizes a ready workspace when the connection workbench status remains visible', async () => {
    let monotonicTime = 0;
    const phaseTransitions = [];
    const ready = await waitForInteractiveAuthenticatedWorkspace({
      evaluate: async () => ({
        adsSessionReady: true,
        credentialPersistence: 'saved',
        credentialSource: 'typed',
        erpSessionReady: true,
        erpSessionReused: false,
        ok: true,
        sessionIdentityVerified: true,
      }),
      locator: (selector) => ({
        getAttribute: async () => '0',
        isVisible: async () => (
          selector === 'nav[aria-label="主业务导航"]'
          || selector === '[data-login-connection-status]'
        ),
      }),
      waitForTimeout: async (waitMs) => {
        monotonicTime += waitMs;
      },
    }, 1_100, {
      monotonicNow: () => monotonicTime,
      now: () => Date.parse('2026-08-25T08:05:00.000Z') + monotonicTime,
      onPhaseChange: (transition) => phaseTransitions.push(transition),
    });

    expect(phaseTransitions.map(({ phase }) => phase)).toEqual([
      'preparation',
      'authorization',
    ]);
    expect(ready).toEqual(expect.objectContaining({
      adsSessionReady: true,
      credentialSource: 'typed',
      erpSessionReady: true,
      ok: true,
    }));
  });

  it('keeps authorization active when an authority remount drops the local busy button', async () => {
    let monotonicTime = 0;
    const phaseTransitions = [];
    const ready = await waitForInteractiveAuthenticatedWorkspace({
      evaluate: async () => ({
        adsSessionReady: monotonicTime >= 1_500,
        credentialPersistence: monotonicTime >= 1_500 ? 'saved' : null,
        credentialSource: monotonicTime >= 1_500 ? 'typed' : null,
        erpSessionReady: monotonicTime >= 1_500,
        erpSessionReused: false,
        ok: monotonicTime >= 1_500,
        sessionIdentityVerified: monotonicTime >= 1_500,
      }),
      locator: (selector) => ({
        getAttribute: async (attribute) => {
          if (selector !== '[data-login-connection-status]') return null;
          if (attribute === 'data-login-attempt-sequence') {
            return monotonicTime >= 500 ? '1' : '0';
          }
          if (attribute === 'data-login-attempt-active') {
            return monotonicTime >= 500 && monotonicTime < 1_500 ? 'true' : 'false';
          }
          return null;
        },
        isVisible: async () => {
          if (selector === 'nav[aria-label="主业务导航"]') return true;
          if (selector === '[data-login-connection-status]') return true;
          if (selector === '.login-submit-button[aria-busy="true"]') {
            return monotonicTime >= 500 && monotonicTime < 600;
          }
          if (selector === '.login-submit-button:not([aria-busy="true"]):not([disabled])') {
            return monotonicTime >= 600;
          }
          return false;
        },
      }),
      waitForTimeout: async (waitMs) => {
        monotonicTime += waitMs;
      },
    }, 1_100, {
      monotonicNow: () => monotonicTime,
      now: () => Date.parse('2026-08-07T09:00:00.000Z') + monotonicTime,
      onPhaseChange: (transition) => phaseTransitions.push(transition),
    });

    expect(phaseTransitions.map(({ phase }) => phase)).toEqual([
      'preparation',
      'authorization',
    ]);
    expect(ready).toEqual(expect.objectContaining({
      adsSessionReady: true,
      erpSessionReady: true,
      ok: true,
    }));
  });

  it('keeps the store-scoped submit sequence above authority-keyed workspace remounts', () => {
    const loginWorkbenchSource = readFileSync(
      new URL('../apps/desktop/src/renderer/app-store-connection-view.tsx', import.meta.url),
      'utf8',
    );
    const controllerSource = readFileSync(
      new URL('../apps/desktop/src/renderer/app-store-connection-controller.tsx', import.meta.url), 'utf8',
    );
    const runtimeSource = readFileSync(
      new URL('../apps/desktop/src/renderer/app-runtime.tsx', import.meta.url), 'utf8',
    );
    const authorityKeyedWorkspaceIndex = runtimeSource.indexOf('<div key={store.authorityKey}');
    const durableAttemptStateIndex = runtimeSource.indexOf('const [storeLoginAttemptEvidence');

    expect(authorityKeyedWorkspaceIndex).toBeGreaterThan(-1);
    expect(durableAttemptStateIndex).toBeGreaterThan(-1);
    expect(durableAttemptStateIndex).toBeLessThan(authorityKeyedWorkspaceIndex);
    expect(loginWorkbenchSource).not.toContain('const [loginAttemptSequence, setLoginAttemptSequence] = useState(0);');
    expect(controllerSource).not.toContain('const [loginAttemptSequence, setLoginAttemptSequence] = useState(0);');
    expect(controllerSource).toContain('loginAttemptSequence: number;');
    expect(controllerSource).toContain('setLoginAttemptSequence: React.Dispatch<React.SetStateAction<number>>;');
    expect(controllerSource.indexOf('setLoginAttemptSequence((current) => current + 1);')).toBeGreaterThan(-1);
    expect(controllerSource.indexOf('setLoginAttemptSequence((current) => current + 1);'))
      .toBeLessThan(controllerSource.indexOf('setLoading(true);'));
    expect(runtimeSource).toContain('storeId: credentialDraftStoreId');
    expect(runtimeSource).toContain('const currentSequence = current.storeId === credentialDraftStoreId');
    expect(runtimeSource).toContain('loginAttemptSequence={scopedLoginAttemptSequence}');
    expect(runtimeSource).toContain('setLoginAttemptSequence={setScopedLoginAttemptSequence}');
    expect(loginWorkbenchSource).toContain('data-login-attempt-active={loading}');
    expect(loginWorkbenchSource).not.toContain('const [loading, setLoading] = useState(false);');
    expect(controllerSource).not.toContain('const [loading, setLoading] = useState(false);');
    expect(runtimeSource).toContain('loginAttemptPending={scopedLoginAttemptEvidence.pending}');
    expect(runtimeSource).toContain('setLoginAttemptPending={setScopedLoginAttemptPending}');
  });

  it('returns to operator preparation after a failed login attempt becomes visibly retryable', async () => {
    let monotonicTime = 0;
    const phaseTransitions = [];
    const ready = await waitForInteractiveAuthenticatedWorkspace({
      evaluate: async () => ({
        adsSessionReady: monotonicTime >= 2_000,
        credentialPersistence: monotonicTime >= 2_000 ? 'saved' : null,
        credentialSource: monotonicTime >= 2_000 ? 'typed' : null,
        erpSessionReady: monotonicTime >= 2_000,
        erpSessionReused: false,
        ok: monotonicTime >= 2_000,
        sessionIdentityVerified: monotonicTime >= 2_000,
      }),
      locator: (selector) => ({
        getAttribute: async (attribute) => {
          if (selector !== '[data-login-connection-status]') return null;
          if (attribute === 'data-login-attempt-sequence') {
            return monotonicTime >= 1_500 ? '2' : monotonicTime >= 500 ? '1' : '0';
          }
          if (attribute === 'data-login-attempt-active') {
            return ((monotonicTime >= 500 && monotonicTime < 1_000)
              || (monotonicTime >= 1_500 && monotonicTime < 2_000)) ? 'true' : 'false';
          }
          return null;
        },
        isVisible: async () => {
          if (selector === 'nav[aria-label="主业务导航"]') return true;
          if (selector === '[data-login-connection-status]') return true;
          if (selector === '.login-submit-button[aria-busy="true"]') {
            return (monotonicTime >= 500 && monotonicTime < 1_000)
              || (monotonicTime >= 1_500 && monotonicTime < 2_000);
          }
          if (selector === '.login-submit-button:not([aria-busy="true"]):not([disabled])') {
            return monotonicTime >= 1_000 && monotonicTime < 1_500;
          }
          return false;
        },
      }),
      waitForTimeout: async (waitMs) => {
        monotonicTime += waitMs;
      },
    }, 1_100, {
      monotonicNow: () => monotonicTime,
      now: () => Date.parse('2026-08-06T01:00:00.000Z') + monotonicTime,
      onPhaseChange: (transition) => phaseTransitions.push(transition),
    });

    expect(phaseTransitions.map(({ phase }) => phase)).toEqual([
      'preparation',
      'authorization',
      'preparation',
      'authorization',
    ]);
    expect(ready).toEqual(expect.objectContaining({
      adsSessionReady: true,
      erpSessionReady: true,
      ok: true,
    }));
  });

  it('uses a monotonic deadline even when the wall clock jumps forward', async () => {
    let wallTime = Date.parse('2026-07-17T06:00:00.000Z');
    let monotonicTime = 0;
    const ready = await waitForInteractiveAuthenticatedWorkspace({
      evaluate: async () => ({
        adsSessionReady: monotonicTime >= 1_500,
        credentialPersistence: monotonicTime >= 1_500 ? 'saved' : null,
        credentialSource: monotonicTime >= 1_500 ? 'typed' : null,
        erpSessionReady: monotonicTime >= 1_500,
        erpSessionReused: false,
        ok: monotonicTime >= 1_500,
        sessionIdentityVerified: monotonicTime >= 1_500,
      }),
      locator: (selector) => ({
        isVisible: async () => {
          if (selector === 'nav[aria-label="主业务导航"]') return monotonicTime >= 1_500;
          if (selector === '[data-login-connection-status]') return monotonicTime < 1_500;
          if (selector === '.login-submit-button[aria-busy="true"]') return monotonicTime >= 1_000;
          return false;
        },
      }),
      waitForTimeout: async (waitMs) => {
        monotonicTime += waitMs;
        wallTime += waitMs + 86_400_000;
      },
    }, 1_100, {
      monotonicNow: () => monotonicTime,
      now: () => wallTime,
    });

    expect(ready).toEqual(expect.objectContaining({
      adsSessionReady: true,
      erpSessionReady: true,
      ok: true,
    }));
  });

  it('rejects a Main attestation that resolves after the monotonic authorization deadline', async () => {
    let monotonicTime = 0;
    const late = await waitForInteractiveAuthenticatedWorkspace({
      evaluate: async () => {
        monotonicTime = 1_001;
        return {
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
      waitForTimeout: async () => undefined,
    }, 1_000, {
      monotonicNow: () => monotonicTime,
      now: () => Date.parse('2026-07-17T06:00:00.000Z'),
    });

    expect(late).toBeNull();
  });

  it('bounds a hanging locator probe with the monotonic phase deadline', async () => {
    const startedAt = performance.now();
    const unresolved = await waitForInteractiveAuthenticatedWorkspace({
      evaluate: async () => null,
      locator: () => ({
        isVisible: () => new Promise(() => undefined),
      }),
      waitForTimeout: async () => undefined,
    }, 20);

    expect(unresolved).toBeNull();
    expect(performance.now() - startedAt).toBeLessThan(500);
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
