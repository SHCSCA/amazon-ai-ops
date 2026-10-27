// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    PACKAGE_UI_PROFILE_SEQUENCE,
  } = dependencies;
  const beginLoginDiagnostics = (...args) => dependencies.beginLoginDiagnostics(...args);
  const collectLoginSessionAttestation = (...args) => dependencies.collectLoginSessionAttestation(...args);
  const completeLoginDiagnostics = (...args) => dependencies.completeLoginDiagnostics(...args);
  const completeStoreGateDiagnostics = (...args) => dependencies.completeStoreGateDiagnostics(...args);
  const ensureEvidenceLingxingConnection = (...args) => dependencies.ensureEvidenceLingxingConnection(...args);
  const ensureEvidenceStoreContext = (...args) => dependencies.ensureEvidenceStoreContext(...args);
  const fail = (...args) => dependencies.fail(...args);
  const hasAuthenticatedWorkspace = (...args) => dependencies.hasAuthenticatedWorkspace(...args);
  const isRetryableLoginNavigationError = (...args) => dependencies.isRetryableLoginNavigationError(...args);
  const openStoreScopedConnectionWorkbench = (...args) => dependencies.openStoreScopedConnectionWorkbench(...args);
  const sanitizeDiagnosticText = (...args) => dependencies.sanitizeDiagnosticText(...args);
  const setRunDiagnosticPhase = (...args) => dependencies.setRunDiagnosticPhase(...args);
  const validateLoginSessionAttestation = (...args) => dependencies.validateLoginSessionAttestation(...args);
  const waitForInteractiveAuthenticatedWorkspace = (...args) => dependencies.waitForInteractiveAuthenticatedWorkspace(...args);
  const waitForPackageEntrySurface = (...args) => dependencies.waitForPackageEntrySurface(...args);

async function ensureAuthenticatedWorkspace(page, options) {
  let entrySurface = await waitForPackageEntrySurface(page);
  if (entrySurface?.kind === 'store-gate-error') {
    fail(
      'Package opened on a failed Store Gate',
      sanitizeDiagnosticText(entrySurface.message || 'unknown store authority failure', 500),
    );
  }
  let storeGate = {
    createdEvidenceStore: false,
    currency: 'USD',
    marketplace: 'US',
    outcome: 'not-required',
    selectedStore: null,
  };
  if (['store-gate', 'workspace'].includes(entrySurface?.kind)) {
    setRunDiagnosticPhase(options.diagnostics, 'store-gate');
    storeGate = await ensureEvidenceStoreContext(page, options.diagnostics);
    entrySurface = await waitForPackageEntrySurface(page, 15_000);
  } else {
    completeStoreGateDiagnostics(options.diagnostics?.storeGate, 'not-required');
  }
  if (entrySurface?.kind === 'store-gate-error') {
    fail(
      'Store Gate failed after explicit evidence-profile selection',
      sanitizeDiagnosticText(entrySurface.message || 'unknown store authority failure', 500),
    );
  }
  if (entrySurface?.kind !== 'workspace' && entrySurface?.kind !== 'login') {
    fail(
      'Package did not reach a login or workspace surface after Store Gate handling',
      sanitizeDiagnosticText(entrySurface?.kind || 'unknown entry surface', 160),
    );
  }
  if (entrySurface?.kind === 'workspace') {
    await openStoreScopedConnectionWorkbench(page);
  }

  setRunDiagnosticPhase(options.diagnostics, 'login');
  const loginDiagnostics = beginLoginDiagnostics(options.diagnostics);
  if (await hasAuthenticatedWorkspace(page)) {
    if (options.allowInteractiveLogin) {
      completeLoginDiagnostics(loginDiagnostics, 'interactive-login-surface-missing');
      fail(
        'Schema v9 interactive evidence must begin from the visible login surface',
        'The packaged workspace was already authenticated before the operator handoff.',
      );
    }
    const loginSessionAttestation = await collectLoginSessionAttestation(page);
    const attestationContract = validateLoginSessionAttestation(
      loginSessionAttestation,
      'existing-authenticated-session',
    );
    if (!attestationContract.passed) {
      fail(
        'Existing authenticated workspace did not expose a valid bounded Main session attestation',
        JSON.stringify(attestationContract.violations),
      );
    }
    const connectionStartedAt = new Date().toISOString();
    const connectionBootstrap = {
      completedAt: new Date().toISOString(),
      outcome: 'not-required-authenticated-workspace',
      startedAt: connectionStartedAt,
    };
    if (loginDiagnostics) loginDiagnostics.connectionBootstrap = connectionBootstrap;
    completeLoginDiagnostics(loginDiagnostics, 'existing-authenticated-session');
    return {
      connectionBootstrap,
      loginSessionAttestation,
      mode: 'existing-authenticated-session',
      savedCredentialsLoginUsed: false,
      storeGate,
    };
  }
  if (options.allowInteractiveLogin) {
    await page.locator('[data-login-connection-status]').waitFor({
      state: 'visible',
      timeout: 10_000,
    });
    const operatorHandoff = {
      automationReadSecrets: false,
      automationTypedSecrets: false,
      completedAt: null,
      durationClock: 'performance.now',
      elapsedMs: null,
      finalPhase: 'preparation',
      kind: 'visible-user-handoff',
      maximumTotalTimeoutMs: options.interactiveLoginTimeoutMs * 2,
      outcome: 'waiting-for-user',
      phaseTimeoutMs: options.interactiveLoginTimeoutMs,
      phaseTransitions: [],
      startedAt: new Date().toISOString(),
    };
    if (loginDiagnostics) loginDiagnostics.operatorHandoff = operatorHandoff;
    const stage = options.profileStage || {
      current: null,
      profileId: options.profileId || null,
      total: PACKAGE_UI_PROFILE_SEQUENCE.length,
    };
    let activeHandoffPhase = 'preparation';
    let handoffCompletedAt = null;
    const recordHandoffPhase = ({ elapsedMs, phase, startedAt }) => {
      activeHandoffPhase = phase;
      operatorHandoff.finalPhase = phase;
      if (phase === 'preparation' && operatorHandoff.phaseTransitions.length === 0) {
        operatorHandoff.startedAt = startedAt;
      }
      const previous = operatorHandoff.phaseTransitions.at(-1);
      if (previous?.phase !== phase) {
        operatorHandoff.phaseTransitions.push({ elapsedMs, phase, startedAt });
      }
    };
    const recordHandoffCompletion = ({ completedAt, elapsedMs, phase }) => {
      handoffCompletedAt = completedAt;
      activeHandoffPhase = phase;
      operatorHandoff.elapsedMs = elapsedMs;
      operatorHandoff.finalPhase = phase;
    };
    const reportProgress = ({ phase, remainingMs, totalRemainingMs }) => {
      const stageLabel = Number.isInteger(stage.current)
        ? `${stage.current}/${stage.total}`
        : `?/${stage.total}`;
      const phaseLabel = phase === 'authorization'
        ? 'browser authorization'
        : 'operator preparation';
      console.error(
        `[HANDOFF ${stageLabel}] ${stage.profileId || 'package-ui'} ${phaseLabel}; `
        + `${Math.ceil(Math.max(0, remainingMs) / 1000)}s remain in this phase, `
        + `${Math.ceil(Math.max(0, totalRemainingMs) / 1000)}s hard-bound total; `
        + `${options.requireFreshTypedProof ? 'fresh typed-and-saved identity proof required' : 'saved-session continuation allowed after the run-group fresh proof'}.`,
      );
    };
    console.error(
      `[HANDOFF] Packaged UI allows up to ${options.interactiveLoginTimeoutMs} ms for visible operator preparation, `
      + `then a fresh ${options.interactiveLoginTimeoutMs} ms after the login submit enters browser authorization `
      + `(hard maximum ${options.interactiveLoginTimeoutMs * 2} ms). `
      + 'The evidence runner will not read, type, click, or retain credentials.',
    );
    const loginSessionAttestation = await waitForInteractiveAuthenticatedWorkspace(
      page,
      options.interactiveLoginTimeoutMs,
      {
        onCompleted: recordHandoffCompletion,
        onPhaseChange: recordHandoffPhase,
        onProgress: reportProgress,
      },
    );
    operatorHandoff.completedAt = handoffCompletedAt || new Date().toISOString();
    operatorHandoff.finalPhase = activeHandoffPhase;
    if (!loginSessionAttestation) {
      operatorHandoff.outcome = 'timeout';
      completeLoginDiagnostics(loginDiagnostics, 'interactive-timeout', {
        operatorHandoff,
      });
      fail(
        `Interactive operator login did not prove both ERP and Ads ready before the bounded ${activeHandoffPhase} phase timeout`,
        `${options.interactiveLoginTimeoutMs} ms per phase; ${options.interactiveLoginTimeoutMs * 2} ms hard maximum`,
      );
    }
    const attestationContract = validateLoginSessionAttestation(
      loginSessionAttestation,
      'interactive-operator-login',
    );
    if (!attestationContract.passed) {
      operatorHandoff.outcome = 'invalid-session-attestation';
      completeLoginDiagnostics(loginDiagnostics, 'interactive-session-invalid', {
        operatorHandoff,
      });
      fail(
        'Interactive operator login reached the workspace without a valid bounded Main session attestation',
        JSON.stringify(attestationContract.violations),
      );
    }
    if (
      options.requireFreshTypedProof
      && !firstInteractiveLoginAttestationPassed(loginSessionAttestation)
    ) {
      operatorHandoff.outcome = 'fresh-typed-proof-missing';
      completeLoginDiagnostics(loginDiagnostics, 'interactive-session-invalid', {
        operatorHandoff,
      });
      fail(
        'The first package UI profile did not establish the required fresh typed-and-saved identity proof immediately after login',
        JSON.stringify(loginSessionAttestation),
      );
    }
    const connectionBootstrap = {
      completedAt: operatorHandoff.completedAt,
      outcome: 'operator-established-lingxing-connection-and-session',
      startedAt: operatorHandoff.startedAt,
    };
    if (loginDiagnostics) loginDiagnostics.connectionBootstrap = connectionBootstrap;
    operatorHandoff.outcome = 'workspace-reached';
    completeLoginDiagnostics(loginDiagnostics, 'interactive-operator-login', {
      operatorHandoff,
    });
    return {
      connectionBootstrap,
      loginSessionAttestation,
      mode: 'interactive-operator-login',
      operatorHandoff,
      savedCredentialsLoginUsed: false,
      storeGate,
    };
  }
  if (!options.allowSavedLogin) {
    completeLoginDiagnostics(loginDiagnostics, 'blocked-login-screen');
    fail(
      'Package opened on the login screen. Re-run with --allow-saved-login for valid saved credentials '
      + 'or --allow-interactive-login for a visible operator handoff.',
    );
  }

  const username = page.locator('input[placeholder="领星用户名"]');
  const password = page.locator('input[placeholder="领星密码"]');
  await username.waitFor({ state: 'visible', timeout: 10_000 });
  await password.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(() => {
    const account = document.querySelector('input[placeholder="领星用户名"]');
    const secret = document.querySelector('input[placeholder="领星密码"]');
    const status = document.querySelector('.login-status-line');
    return Boolean(
      account?.value
      && secret?.getAttribute('data-credential-source') === 'saved'
      && !secret?.value
      && status?.textContent?.includes('本机安全区托管'),
    );
  }, undefined, { timeout: 10_000 }).catch(() => undefined);
  let savedCredentialState;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      savedCredentialState = await page.evaluate(() => ({
        usernameAvailable: Boolean(document.querySelector('input[placeholder="领星用户名"]')?.value),
        passwordInputEmpty: !document.querySelector('input[placeholder="领星密码"]')?.value,
        passwordManagedByMain:
          document.querySelector('input[placeholder="领星密码"]')?.getAttribute('data-credential-source') === 'saved',
        rememberPassword: Boolean(document.querySelector('input[type="checkbox"]')?.checked),
        statusConfirmsMainOnly: Boolean(document.querySelector('.login-status-line')?.textContent?.includes('本机安全区托管')),
      }));
      break;
    } catch (error) {
      if (!isRetryableLoginNavigationError(error?.message || error)) throw error;
      if (await hasAuthenticatedWorkspace(page, 2_000)) {
        const loginSessionAttestation = await collectLoginSessionAttestation(page);
        const attestationContract = validateLoginSessionAttestation(
          loginSessionAttestation,
          'authenticated-during-credential-observation',
        );
        if (!attestationContract.passed) {
          fail(
            'Authenticated workspace reached during credential observation without a valid bounded Main session attestation',
            JSON.stringify(attestationContract.violations),
          );
        }
        const connectionStartedAt = new Date().toISOString();
        const connectionBootstrap = {
          completedAt: new Date().toISOString(),
          outcome: 'not-required-workspace-authenticated-during-observation',
          startedAt: connectionStartedAt,
        };
        if (loginDiagnostics) loginDiagnostics.connectionBootstrap = connectionBootstrap;
        completeLoginDiagnostics(loginDiagnostics, 'authenticated-during-credential-observation', {
          savedCredentials: savedCredentialState || null,
        });
        return {
          connectionBootstrap,
          loginSessionAttestation,
          mode: 'authenticated-during-credential-observation',
          savedCredentialsLoginUsed: false,
          savedCredentialState: savedCredentialState || null,
          storeGate,
        };
      }
      if (attempt === 3) throw error;
      await page.waitForTimeout(500);
    }
  }
  if (
    !savedCredentialState.usernameAvailable
    || !savedCredentialState.passwordInputEmpty
    || !savedCredentialState.passwordManagedByMain
    || !savedCredentialState.rememberPassword
    || !savedCredentialState.statusConfirmsMainOnly
  ) {
    completeLoginDiagnostics(loginDiagnostics, 'saved-credentials-incomplete', {
      savedCredentials: savedCredentialState,
    });
    fail('Saved credential status is incomplete; package UI evidence requires Main-managed login and refuses to read or type secrets.');
  }
  if (loginDiagnostics) loginDiagnostics.savedCredentials = savedCredentialState;
  const connectionBootstrap = await ensureEvidenceLingxingConnection(page, loginDiagnostics);

  const loginButton = page.getByRole('button', { name: '登录并进入 Ads', exact: true });
  let lastLoginError = 'no visible login error';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const attemptEvidence = {
      attempt,
      completedAt: null,
      message: null,
      outcome: 'in-progress',
      retryable: false,
      startedAt: new Date().toISOString(),
    };
    loginDiagnostics?.attempts.push(attemptEvidence);
    await loginButton.waitFor({ state: 'visible', timeout: 10_000 });
    await loginButton.click();
    await page.waitForTimeout(250);
    try {
      const outcome = await page.waitForFunction(() => {
        if (document.querySelector('nav[aria-label="主业务导航"]')) return { kind: 'workspace' };
        const bodyText = document.body?.innerText || '';
        if (/execution context was destroyed|most likely because of a navigation/i.test(bodyText)) {
          return { kind: 'retryable-navigation' };
        }
        return null;
      }, undefined, { timeout: options.loginTimeoutMs });
      const value = await outcome.jsonValue();
      if (value?.kind === 'workspace') {
        attemptEvidence.outcome = 'workspace-reached';
        attemptEvidence.completedAt = new Date().toISOString();
        break;
      }
      lastLoginError = 'saved-session browser navigation replaced its execution context';
      attemptEvidence.outcome = 'retryable-navigation';
      attemptEvidence.retryable = true;
      attemptEvidence.message = sanitizeDiagnosticText(lastLoginError, 500);
      attemptEvidence.completedAt = new Date().toISOString();
      if (attempt < 2) {
        await page.waitForTimeout(1_000);
        continue;
      }
    } catch (error) {
      if (await hasAuthenticatedWorkspace(page, 2_000)) {
        attemptEvidence.outcome = 'workspace-reached-after-navigation';
        attemptEvidence.completedAt = new Date().toISOString();
        break;
      }
      lastLoginError = await page.locator('[role="alert"]').first().innerText().catch(() => String(error?.message || error));
      attemptEvidence.message = sanitizeDiagnosticText(lastLoginError, 500);
      attemptEvidence.retryable = isRetryableLoginNavigationError(lastLoginError);
      attemptEvidence.outcome = attemptEvidence.retryable ? 'retryable-navigation' : 'failed';
      attemptEvidence.completedAt = new Date().toISOString();
      if (attempt < 2 && isRetryableLoginNavigationError(lastLoginError)) {
        await page.waitForTimeout(1_000);
        continue;
      }
    }
    completeLoginDiagnostics(loginDiagnostics, 'failed', {
      failureMessage: sanitizeDiagnosticText(lastLoginError, 500),
    });
    fail('Saved-credential session establishment did not reach the workspace shell', lastLoginError.slice(0, 500));
  }
  if (!await hasAuthenticatedWorkspace(page)) {
    completeLoginDiagnostics(loginDiagnostics, 'failed', {
      failureMessage: sanitizeDiagnosticText(lastLoginError, 500),
    });
    fail('Saved-credential session establishment did not reach the workspace shell', lastLoginError.slice(0, 500));
  }
  const loginSessionAttestation = await collectLoginSessionAttestation(page);
  const attestationContract = validateLoginSessionAttestation(
    loginSessionAttestation,
    'saved-credentials-login',
  );
  if (!attestationContract.passed) {
    completeLoginDiagnostics(loginDiagnostics, 'failed', {
      failureMessage: 'bounded Main session attestation did not match saved-login mode',
    });
    fail(
      'Saved-credential session reached the workspace without a valid bounded Main session attestation',
      JSON.stringify(attestationContract.violations),
    );
  }
  completeLoginDiagnostics(loginDiagnostics, 'saved-credentials-login');
  return {
    loginSessionAttestation,
    mode: 'saved-credentials-login',
    savedCredentialsLoginUsed: true,
    savedCredentialState,
    storeGate,
    connectionBootstrap,
  };
}

function firstInteractiveLoginAttestationPassed(attestation) {
  return attestation?.ok === true
    && attestation?.erpSessionReady === true
    && attestation?.adsSessionReady === true
    && attestation?.credentialSource === 'typed'
    && attestation?.credentialPersistence === 'saved'
    && attestation?.erpSessionReused === false
    && attestation?.sessionIdentityVerified === true;
}

  return {
    ensureAuthenticatedWorkspace,
    firstInteractiveLoginAttestationPassed,
  };
};
