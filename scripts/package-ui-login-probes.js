// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    performance,
  } = dependencies;
  const selectSidebarEntry = (...args) => dependencies.selectSidebarEntry(...args);
  const violation = (...args) => dependencies.violation(...args);

function isRetryableLoginNavigationError(value) {
  return /execution context was destroyed|most likely because of a navigation/i.test(String(value || ''));
}

function isWorkspaceProbeAbsenceError(error) {
  return error?.name === 'TimeoutError'
    || /locator\.waitFor:\s*Timeout\s+\d+ms\s+exceeded/i.test(String(error?.message || error || ''))
    || isRetryableLoginNavigationError(error?.message || error);
}

async function hasAuthenticatedWorkspace(page, timeoutMs = 0) {
  const workspace = page.locator('nav[aria-label="主业务导航"]');
  try {
    if (timeoutMs > 0) {
      await workspace.waitFor({ state: 'visible', timeout: timeoutMs });
    } else if (!await workspace.isVisible()) {
      return false;
    }
    const attestation = await collectLoginSessionAttestation(page);
    return validateLoginSessionAttestation(
      attestation,
      'existing-authenticated-session',
    ).passed;
  } catch (error) {
    if (isWorkspaceProbeAbsenceError(error)) return false;
    throw error;
  }
}

async function openStoreScopedConnectionWorkbench(page) {
  const status = page.locator('[data-login-connection-status]');
  if (await status.isVisible().catch(() => false)) {
    return {
      navigated: false,
      surface: 'store-scoped-connection-workbench',
    };
  }
  await page.locator('nav[aria-label="主业务导航"]').waitFor({
    state: 'visible',
    timeout: 10_000,
  });
  await selectSidebarEntry(page, { workspace: 'settings', subview: 'ai-and-local' });
  await status.waitFor({ state: 'visible', timeout: 15_000 });
  return {
    navigated: true,
    surface: 'store-scoped-connection-workbench',
  };
}

function validateLoginSessionAttestation(attestation, mode) {
  const violations = [];
  const allowedKeys = new Set([
    'adsSessionReady',
    'credentialPersistence',
    'credentialSource',
    'erpSessionReady',
    'erpSessionReused',
    'ok',
    'sessionIdentityVerified',
  ]);
  const unexpectedKeys = attestation && typeof attestation === 'object'
    ? Object.keys(attestation).filter((key) => !allowedKeys.has(key))
    : [];
  if (unexpectedKeys.length > 0) {
    violations.push(violation(
      'LOGIN_SESSION_ATTESTATION_UNBOUNDED',
      'The login-session attestation may retain only the fixed non-secret projection.',
      { unexpectedKeys },
    ));
  }
  const commonReady = attestation?.ok === true
    && attestation?.erpSessionReady === true
    && attestation?.adsSessionReady === true
    && typeof attestation?.erpSessionReused === 'boolean'
    && typeof attestation?.sessionIdentityVerified === 'boolean'
    && ['saved', 'typed'].includes(attestation?.credentialSource)
    && ['saved', 'cleared', 'main_managed', 'not_saved_unverified_session']
      .includes(attestation?.credentialPersistence);
  if (!commonReady) {
    violations.push(violation(
      'LOGIN_SESSION_ATTESTATION_NOT_READY',
      'The bounded Main login-session projection must prove both ERP and Ads ready without account, URL, title, or secret fields.',
      attestation ?? null,
    ));
  }

  const verifiedTypedSave = attestation?.credentialSource === 'typed'
    && attestation?.credentialPersistence === 'saved'
    && attestation?.erpSessionReused === false
    && attestation?.sessionIdentityVerified === true;
  const verifiedSavedLogin = attestation?.credentialSource === 'saved'
    && attestation?.credentialPersistence === 'main_managed'
    && attestation?.erpSessionReused === false
    && attestation?.sessionIdentityVerified === true;
  const packageUiSavedReuse = attestation?.credentialSource === 'saved'
    && attestation?.credentialPersistence === 'main_managed'
    && attestation?.erpSessionReused === true
    && attestation?.sessionIdentityVerified === false;
  const validModeProjection = mode === 'interactive-operator-login'
    ? verifiedTypedSave || verifiedSavedLogin || packageUiSavedReuse
    : mode === 'saved-credentials-login'
      ? verifiedSavedLogin || packageUiSavedReuse
      : ['existing-authenticated-session', 'authenticated-during-credential-observation'].includes(mode)
        ? verifiedTypedSave || verifiedSavedLogin || packageUiSavedReuse
        : false;
  if (!validModeProjection) {
    violations.push(violation(
      'LOGIN_SESSION_ATTESTATION_MODE_MISMATCH',
      'The bounded credential source, persistence, session reuse, and identity verification fields contradict the evidence login mode.',
      { attestation: attestation ?? null, mode: mode || null },
    ));
  }
  return {
    attestation,
    mode,
    passed: violations.length === 0,
    violations,
  };
}

async function collectLoginSessionAttestation(page) {
  return page.evaluate(async () => {
    const runtimeState = await window.electronAPI?.getState?.();
    const loginSession = runtimeState?.loginSession;
    return {
      adsSessionReady: loginSession?.adsSessionReady === true,
      credentialPersistence: loginSession?.credentialPersistence ?? null,
      credentialSource: loginSession?.credentialSource ?? null,
      erpSessionReady: loginSession?.erpSessionReady === true,
      erpSessionReused: loginSession?.erpSessionReused === true,
      ok: loginSession?.ok === true && runtimeState?.isLoggedIn === true,
      sessionIdentityVerified: loginSession?.sessionIdentityVerified === true,
    };
  });
}

function isInteractiveOperatorWindowClosedError(page, error) {
  if (page?.isClosed?.() === true) return true;
  return /target (?:page|context|browser).*closed|page, context or browser has been closed/i
    .test(String(error?.message || error || ''));
}

function throwInteractiveOperatorWindowError(page, error) {
  if (!isInteractiveOperatorWindowClosedError(page, error)) throw error;
  const classified = new Error(
    'PACKAGE_UI_OPERATOR_WINDOW_CLOSED: The packaged Electron window closed before the visible login handoff completed.',
  );
  classified.cause = error;
  throw classified;
}

async function runBoundedHandoffProbe(probe, deadlineMs, monotonicNow) {
  const remainingMs = deadlineMs - monotonicNow();
  if (remainingMs <= 0) return { timedOut: true, value: null };
  let timeoutId;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(probe)
        .then((value) => ({ timedOut: false, value })),
      new Promise((resolve) => {
        timeoutId = setTimeout(
          () => resolve({ timedOut: true, value: null }),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function waitForInteractiveAuthenticatedWorkspace(page, timeoutMs, progress = {}) {
  const wallNow = typeof progress.now === 'function' ? progress.now : Date.now;
  const monotonicNow = typeof progress.monotonicNow === 'function'
    ? progress.monotonicNow
    : () => performance.now();
  const phaseTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
  const handoffStartedAt = wallNow();
  const handoffStartedTick = monotonicNow();
  const hardDeadline = handoffStartedTick + (phaseTimeoutMs * 2);
  let phase = 'preparation';
  let phaseDeadline = handoffStartedTick + phaseTimeoutMs;
  let nextProgressAt = 0;
  let consumedLoginAttemptSequence = 0;

  const probeLoginAttemptSequence = async () => {
    const locator = page.locator('[data-login-connection-status]');
    if (typeof locator.getAttribute !== 'function') {
      return { timedOut: false, value: 0 };
    }
    const probe = await runBoundedHandoffProbe(
      () => locator.getAttribute('data-login-attempt-sequence'),
      phaseDeadline,
      monotonicNow,
    );
    if (probe.timedOut) return probe;
    const sequence = Number(probe.value);
    return {
      timedOut: false,
      value: Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 0,
    };
  };

  const probeLoginAttemptActivity = async () => {
    const locator = page.locator('[data-login-connection-status]');
    if (typeof locator.getAttribute !== 'function') {
      return { timedOut: false, value: null };
    }
    const probe = await runBoundedHandoffProbe(
      () => locator.getAttribute('data-login-attempt-active'),
      phaseDeadline,
      monotonicNow,
    );
    if (probe.timedOut) return probe;
    return {
      timedOut: false,
      value: probe.value === 'true' ? true : probe.value === 'false' ? false : null,
    };
  };

  const transitionTo = (nextPhase, startedTick = monotonicNow()) => {
    if (phase === nextPhase) return;
    phase = nextPhase;
    phaseDeadline = Math.min(hardDeadline, startedTick + phaseTimeoutMs);
    nextProgressAt = 0;
    if (typeof progress.onPhaseChange === 'function') {
      progress.onPhaseChange({
        elapsedMs: Math.max(0, startedTick - handoffStartedTick),
        phase,
        startedAt: new Date(wallNow()).toISOString(),
        timeoutMs: phaseTimeoutMs,
      });
    }
  };

  if (typeof progress.onPhaseChange === 'function') {
    progress.onPhaseChange({
      elapsedMs: 0,
      phase,
      startedAt: new Date(handoffStartedAt).toISOString(),
      timeoutMs: phaseTimeoutMs,
    });
  }

  do {
    let observedAt = monotonicNow();
    try {
      const surfaceProbe = await runBoundedHandoffProbe(
        () => Promise.all([
          page.locator('nav[aria-label="主业务导航"]').isVisible(),
          page.locator('[data-login-connection-status]').isVisible(),
        ]),
        phaseDeadline,
        monotonicNow,
      );
      if (surfaceProbe.timedOut) return null;
      const [workspaceVisible, loginVisible] = surfaceProbe.value;
      if (workspaceVisible && !loginVisible && phase === 'preparation') {
        transitionTo('authorization');
      }
      if (workspaceVisible && loginVisible && phase === 'preparation') {
        const attestationProbe = await runBoundedHandoffProbe(
          () => collectLoginSessionAttestation(page),
          phaseDeadline,
          monotonicNow,
        );
        if (attestationProbe.timedOut) return null;
        if (validateLoginSessionAttestation(
          attestationProbe.value,
          'interactive-operator-login',
        ).passed) {
          transitionTo('authorization');
        }
      }
      if (workspaceVisible && phase === 'authorization') {
        const attestationProbe = await runBoundedHandoffProbe(
          () => collectLoginSessionAttestation(page),
          phaseDeadline,
          monotonicNow,
        );
        if (attestationProbe.timedOut) return null;
        const loginSessionAttestation = attestationProbe.value;
        const attestedAt = monotonicNow();
        if (validateLoginSessionAttestation(
          loginSessionAttestation,
          'interactive-operator-login',
        ).passed && attestedAt <= phaseDeadline && attestedAt <= hardDeadline) {
          if (typeof progress.onCompleted === 'function') {
            progress.onCompleted({
              completedAt: new Date(wallNow()).toISOString(),
              elapsedMs: Math.max(0, attestedAt - handoffStartedTick),
              phase,
            });
          }
          return loginSessionAttestation;
        }
        if (loginVisible) {
          const retryableSubmitProbe = await runBoundedHandoffProbe(
            () => page
              .locator('.login-submit-button:not([aria-busy="true"]):not([disabled])')
              .isVisible(),
            phaseDeadline,
            monotonicNow,
          );
          if (retryableSubmitProbe.timedOut) return null;
          if (retryableSubmitProbe.value) {
            const [sequenceProbe, activityProbe] = await Promise.all([
              probeLoginAttemptSequence(),
              probeLoginAttemptActivity(),
            ]);
            if (sequenceProbe.timedOut) return null;
            if (activityProbe.timedOut) return null;
            consumedLoginAttemptSequence = Math.max(
              consumedLoginAttemptSequence,
              sequenceProbe.value,
            );
            if (activityProbe.value === false) transitionTo('preparation');
          }
        }
      }
      if (phase === 'preparation') {
        const [submitProbe, sequenceProbe] = await Promise.all([
          runBoundedHandoffProbe(
            () => page.locator('.login-submit-button[aria-busy="true"]').isVisible(),
            phaseDeadline,
            monotonicNow,
          ),
          probeLoginAttemptSequence(),
        ]);
        if (submitProbe.timedOut) return null;
        if (sequenceProbe.timedOut) return null;
        const sequenceAdvanced = sequenceProbe.value > consumedLoginAttemptSequence;
        const authorizationStarted = submitProbe.value || sequenceAdvanced;
        if (authorizationStarted) {
          consumedLoginAttemptSequence = Math.max(
            consumedLoginAttemptSequence,
            sequenceProbe.value,
          );
          transitionTo('authorization');
        }
      }
    } catch (error) {
      if (isInteractiveOperatorWindowClosedError(page, error)) {
        throwInteractiveOperatorWindowError(page, error);
      }
      if (!isWorkspaceProbeAbsenceError(error)) throw error;
    }

    observedAt = monotonicNow();
    if (typeof progress.onProgress === 'function' && observedAt >= nextProgressAt) {
      progress.onProgress({
        phase,
        remainingMs: Math.max(0, phaseDeadline - observedAt),
        totalRemainingMs: Math.max(0, hardDeadline - observedAt),
      });
      nextProgressAt = observedAt + 15_000;
    }
    const remainingMs = phaseDeadline - observedAt;
    if (remainingMs <= 0) return null;
    try {
      const waitProbe = await runBoundedHandoffProbe(
        () => page.waitForTimeout(Math.min(500, remainingMs)),
        phaseDeadline,
        monotonicNow,
      );
      if (waitProbe.timedOut) return null;
    } catch (error) {
      throwInteractiveOperatorWindowError(page, error);
    }
  } while (true);
}

function beginLoginDiagnostics(diagnostics) {
  const login = diagnostics?.login;
  if (!login) return null;
  if (!login.startedAt) login.startedAt = new Date().toISOString();
  login.outcome = 'in-progress';
  return login;
}

function completeLoginDiagnostics(login, outcome, extra = {}) {
  if (!login) return;
  login.completedAt = new Date().toISOString();
  login.outcome = outcome;
  Object.assign(login, extra);
}

function beginStoreGateDiagnostics(diagnostics) {
  const storeGate = diagnostics?.storeGate;
  if (!storeGate) return null;
  if (!storeGate.startedAt) storeGate.startedAt = new Date().toISOString();
  storeGate.outcome = 'in-progress';
  return storeGate;
}

function completeStoreGateDiagnostics(storeGate, outcome, extra = {}) {
  if (!storeGate) return;
  storeGate.completedAt = new Date().toISOString();
  storeGate.outcome = outcome;
  Object.assign(storeGate, extra);
}

  return {
    isRetryableLoginNavigationError,
    isWorkspaceProbeAbsenceError,
    hasAuthenticatedWorkspace,
    openStoreScopedConnectionWorkbench,
    validateLoginSessionAttestation,
    collectLoginSessionAttestation,
    isInteractiveOperatorWindowClosedError,
    throwInteractiveOperatorWindowError,
    runBoundedHandoffProbe,
    waitForInteractiveAuthenticatedWorkspace,
    beginLoginDiagnostics,
    completeLoginDiagnostics,
    beginStoreGateDiagnostics,
    completeStoreGateDiagnostics,
  };
};
