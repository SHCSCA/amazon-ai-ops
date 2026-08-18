import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Main Lingxing stable-identity enrollment wiring', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(__dirname, '../renderer/App.tsx'), 'utf8');

  it('rejects saved enrollment before entering the visible-browser transition', () => {
    const login = source.slice(
      source.indexOf('async function handleBrowserLogin'),
      source.indexOf('async function performBrowserLoginInUserLane'),
    );
    const pendingGuard = login.indexOf("lingxingIdentityReadiness === 'enrollment_pending'");
    const transition = login.indexOf('runUserVisibleBrowserTransition({');
    expect(pendingGuard).toBeGreaterThan(-1);
    expect(pendingGuard).toBeLessThan(transition);
    expect(login.slice(pendingGuard, transition)).toContain("request.credentialSource !== 'typed'");
  });

  it('enrolls from Main-only evidence before committing ready session metadata', () => {
    const login = source.slice(
      source.indexOf('async function performBrowserLoginInUserLane'),
      source.indexOf('async function handleBrowserLogout'),
    );
    const reusedGuard = login.indexOf("connections.lingxingIdentityReadiness === 'enrollment_pending'");
    const downloadCenter = login.indexOf('await navigateToLingxingDownloadCenter(');
    const enroll = login.indexOf('state.storeRepo.enrollLingxingStableExternalAccount({');
    const readyCommit = login.indexOf('const readyLingxingConnection = state.db!.transaction');
    const sessionReady = login.indexOf('state.storeRepo!.saveSessionMetadata({', readyCommit);
    expect(reusedGuard).toBeGreaterThan(-1);
    expect(login.slice(reusedGuard, enroll)).toContain('erpSessionReused');
    expect(downloadCenter).toBeGreaterThan(reusedGuard);
    expect(downloadCenter).toBeLessThan(enroll);
    expect(enroll).toBeGreaterThan(reusedGuard);
    expect(readyCommit).toBeGreaterThan(enroll);
    expect(sessionReady).toBeGreaterThan(readyCommit);
    expect(login.slice(enroll, readyCommit)).toContain('expectedUpdatedAt: connections.lingxing.updatedAt');
  });

  it('enters Ads through the visible ERP menu and reads the authenticated US profile before collection', () => {
    const login = source.slice(
      source.indexOf('async function performBrowserLoginInUserLane'),
      source.indexOf('async function handleBrowserLogout'),
    );
    const erpAdsEntry = login.indexOf('await openLingxingAdsFromErp(lingxingController)');
    const profileEvidence = login.indexOf('await readLingxingAdsProfileEvidence(', erpAdsEntry);
    const singleStoreScope = login.indexOf('await selectOnlyLingxingAdsStore(', profileEvidence);
    const downloadCenter = login.indexOf('await navigateToLingxingDownloadCenter(', singleStoreScope);

    expect(erpAdsEntry).toBeGreaterThan(-1);
    expect(profileEvidence).toBeGreaterThan(erpAdsEntry);
    expect(singleStoreScope).toBeGreaterThan(profileEvidence);
    expect(downloadCenter).toBeGreaterThan(singleStoreScope);
    expect(login).not.toContain("amazonAdsController.navigate('https://ads.lingxing.com/');");
  });

  it('requires explicit typed authority before resetting only the active store Lingxing session', () => {
    const login = source.slice(
      source.indexOf('async function performBrowserLoginInUserLane'),
      source.indexOf('async function handleBrowserLogout'),
    );
    const recovery = login.indexOf('await recoverLingxingEnrollmentSession({');
    const clearCookies = login.indexOf('await browserContext.clearCookies()', recovery);
    const enroll = login.indexOf('state.storeRepo.enrollLingxingStableExternalAccount({');
    expect(recovery).toBeGreaterThan(-1);
    expect(login.slice(recovery, clearCookies)).toContain(
      "request.resetLingxingSessionForEnrollment === true",
    );
    expect(login.slice(recovery, clearCookies)).toContain('window.localStorage.clear()');
    expect(login.slice(recovery, clearCookies)).toContain('window.sessionStorage.clear()');
    expect(clearCookies).toBeGreaterThan(recovery);
    expect(enroll).toBeGreaterThan(clearCookies);
    expect(login.slice(recovery, enroll)).not.toMatch(/rmSync|removeSync|delete.*Profile/i);
  });

  it('continues the same visible enrollment attempt when storage clearing triggers a trusted navigation', () => {
    expect(source).toContain('function isExpectedLingxingSessionResetNavigation(');
    const login = source.slice(
      source.indexOf('async function performBrowserLoginInUserLane'),
      source.indexOf('async function handleBrowserLogout'),
    );
    const storageClear = login.indexOf('await page.evaluate(async () => {');
    const clearCookies = login.indexOf('await browserContext.clearCookies()', storageClear);
    const navigateToLogin = login.indexOf('navigateToLogin: async () => {', clearCookies);
    expect(storageClear).toBeGreaterThan(-1);
    expect(clearCookies).toBeGreaterThan(storageClear);
    expect(navigateToLogin).toBeGreaterThan(clearCookies);
    expect(login.slice(storageClear, clearCookies)).toContain(
      'if (!isExpectedLingxingSessionResetNavigation(error)) throw error;',
    );
    expect(login.slice(storageClear, clearCookies)).toContain(
      "await page.waitForLoadState('domcontentloaded'",
    );
  });

  it('uses only collectionStoreName as the Lingxing collection selector', () => {
    const target = source.slice(
      source.indexOf('function authorizedLingxingCollectionTarget'),
      source.indexOf('function projectBusinessReportFileForRenderer'),
    );
    expect(target).toContain('connection.collectionStoreName?.trim()');
    expect(target).not.toContain('connection.externalAccountId?.trim()');
  });

  it('blocks first enrollment until the user explicitly authorizes the store-scoped session reset', () => {
    expect(rendererSource).toContain(
      'const enrollmentResetConsentReady = !lingxingEnrollmentPending',
    );
    expect(rendererSource).toContain('|| resetLingxingSessionForEnrollment;');
    const readiness = rendererSource.slice(
      rendererSource.indexOf('const loginWorkbenchReady ='),
      rendererSource.indexOf('const loginButtonView ='),
    );
    expect(readiness).toContain('&& enrollmentResetConsentReady');
    expect(rendererSource).toContain('请先勾选“允许重置当前店铺领星会话”');
  });

  it('allows a non-destructive connection check without pre-authorizing session reset', () => {
    expect(rendererSource).toContain('const loginLaunchReady = lingxingConnectionReady');
    const button = rendererSource.slice(
      rendererSource.indexOf('data-login-action="reconnect-all"') - 300,
      rendererSource.indexOf('data-login-action="reconnect-all"') + 400,
    );
    expect(rendererSource).toContain('const loginWorkbenchReady = loginLaunchReady;');
    expect(rendererSource).toContain('const loginResetAuthorizationReady = loginLaunchReady');
    expect(button).toContain('disabled={loading || !loginWorkbenchReady}');

    const handler = rendererSource.slice(
      rendererSource.indexOf("async function handleLogin(action:"),
      rendererSource.indexOf('async function handleBindLingxingConnection()',
        rendererSource.indexOf("async function handleLogin(action:")),
    );
    expect(handler).toContain('系统会先检查当前会话，不会在未授权时清理登录数据');
    expect(handler).not.toContain('setError(\'请先勾选“允许重置当前店铺领星会话”，再启动首次身份登记。\');\n      return;');
  });

  it('re-verifies a configured store reused session with the exact Main-managed saved credential', () => {
    const login = source.slice(
      source.indexOf('async function performBrowserLoginInUserLane'),
      source.indexOf('async function handleBrowserLogout'),
    );
    const savedRecoveryAuthority = login.indexOf('const configuredSavedSessionRecoveryAuthorized =');
    const recovery = login.indexOf('const configuredSessionRecovered = await resetConfiguredLingxingSessionIfAuthorized({');
    const credentialPolicy = login.indexOf('const credentialPolicy = decideLoginSessionCredentialPolicy({');

    expect(savedRecoveryAuthority).toBeGreaterThan(-1);
    expect(login.slice(savedRecoveryAuthority, recovery)).toContain(
      "connections.lingxingIdentityReadiness === 'configured'",
    );
    expect(login.slice(savedRecoveryAuthority, recovery)).toContain(
      "request.credentialSource === 'saved'",
    );
    expect(login.slice(savedRecoveryAuthority, recovery)).toContain(
      "connections.lingxing.session?.status === 'signed_out'",
    );
    expect(login.slice(savedRecoveryAuthority, recovery)).toContain(
      "connections.lingxing.session?.failureCode === 'operator_session_reset_requested'",
    );
    expect(login.slice(savedRecoveryAuthority, recovery)).toContain(
      'connections.lingxing.session.sessionGeneration === loginContext.sessionGeneration - 1',
    );
    expect(recovery).toBeGreaterThan(savedRecoveryAuthority);
    expect(recovery).toBeLessThan(credentialPolicy);
    expect(login.slice(recovery, credentialPolicy)).toContain('erpSessionReused');
    expect(login.slice(recovery, credentialPolicy)).toContain('needsLogin = true;');
    expect(login.slice(recovery, credentialPolicy)).toContain('erpSessionReused = false;');
    expect(login.slice(recovery, credentialPolicy)).toContain('await accountInput.fill(username);');
    expect(login.slice(recovery, credentialPolicy)).toContain('await passwordInput.fill(password);');
  });

  it('offers configured stores an explicit typed reset while saved reconnect needs no password re-entry', () => {
    expect(rendererSource).toContain(
      'const lingxingSessionResetAvailable = lingxingConnectionReady && credentialSource === \'typed\';',
    );
    expect(rendererSource).toContain('{lingxingSessionResetAvailable && (');
    expect(rendererSource).toContain(
      "!retryingAds && credentialSource === 'typed' && resetLingxingSessionForEnrollment",
    );
    expect(rendererSource).not.toContain(
      '!retryingAds && lingxingEnrollmentPending && resetLingxingSessionForEnrollment',
    );
    expect(rendererSource).toContain(
      '使用本机安全区托管的密码重新连接时，若检测到旧会话，只会重置当前店铺会话并重新验证；无需再次输入密码。',
    );
    const resetHandler = rendererSource.slice(
      rendererSource.indexOf('async function handleResetConfiguredLingxingSession()'),
      rendererSource.indexOf('async function handleBindLingxingConnection()',
        rendererSource.indexOf('async function handleResetConfiguredLingxingSession()')),
    );
    expect(resetHandler).toContain('await api.browserLogout();');
    expect(resetHandler).not.toContain('password');
    expect(rendererSource).toContain('data-login-action="reset-lingxing-session"');
    expect(source).toContain("failureCode: 'operator_session_reset_requested'");
  });
});
