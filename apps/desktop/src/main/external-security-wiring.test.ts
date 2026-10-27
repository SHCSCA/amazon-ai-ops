import { mainRuntimeModuleContracts, mainRuntimeModuleContract, mainRuntimeFunctionContract, mainRuntimeVariableContract, mainRuntimeSectionContract } from './main-runtime-source.test-support';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const source = mainRuntimeModuleContract('main-runtime-context.ts');
const windowSource = fs.readFileSync(path.join(__dirname, 'desktop-window.ts'), 'utf8');
const bootstrapConfigurationSource = fs.readFileSync(path.join(__dirname, 'bootstrap-configuration.ts'), 'utf8');
const providerActiveIdentitySource = fs.readFileSync(
  path.join(__dirname, 'provider-active-identity.ts'),
  'utf8',
);
const browserLoginProviderConnectionSource = fs.readFileSync(
  path.join(__dirname, 'browser-login-provider-connections.ts'),
  'utf8',
);
const browserLoginRequestSource = fs.readFileSync(
  path.join(__dirname, 'browser-login-request.ts'),
  'utf8',
);
const lingxingAdsResponsesSource = fs.readFileSync(path.join(__dirname, 'lingxing-ads-responses.ts'), 'utf8');
const lingxingAdsIdentitySource = fs.readFileSync(path.join(__dirname, 'lingxing-ads-identity.ts'), 'utf8');

describe('Electron external-distribution security wiring', () => {
  it('installs navigation, redirect, and external-open guards before loading the renderer', () => {
    const navigationIndex = windowSource.indexOf("webContents.on('will-navigate'");
    const redirectIndex = windowSource.indexOf("webContents.on('will-redirect'");
    const windowOpenIndex = windowSource.indexOf('setWindowOpenHandler(createSecureWindowOpenHandler');
    const loadUrlIndex = windowSource.indexOf("loadURL('http://localhost:5173')");
    const loadFileIndex = windowSource.indexOf('loadFile(rendererFilePath)');

    expect(navigationIndex).toBeGreaterThan(0);
    expect(redirectIndex).toBeGreaterThan(navigationIndex);
    expect(windowOpenIndex).toBeGreaterThan(redirectIndex);
    expect(loadUrlIndex).toBeGreaterThan(windowOpenIndex);
    expect(loadFileIndex).toBeGreaterThan(windowOpenIndex);
    expect(bootstrapConfigurationSource).toContain("development: !input.isPackaged && input.environment.NODE_ENV === 'development'");
    expect(mainRuntimeModuleContract('main-runtime-context.ts')).toContain('development: bootstrapConfiguration.development');
    expect(mainRuntimeModuleContract('main-runtime-context.ts')).toContain('const createWindow = createDesktopWindowFactory({');
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('setWindowOpenHandler(({ url })'); }
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('shell.openExternal(url);'); }
  });

  it('wires the deny-all external-open policy without exposing a shell opener', () => {
    expect(windowSource).toContain('EXTERNAL_OPEN_POLICY_MARKER');
    expect(windowSource).toContain('externalOpenPolicy: EXTERNAL_OPEN_POLICY_MARKER');
    expect(windowSource).not.toContain('shell.openExternal');
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('shell.openExternal'); }
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('openExternal: (url) =>'); }
  });

  it('exposes saved-credential status only and resolves saved passwords inside Main', () => {
    const source = mainRuntimeFunctionContract('handleBrowserLogin');
    expect(mainRuntimeModuleContract('main-ipc-registration-runtime.ts')).toContain("registerTrackedIpcHandler('browser:get-saved-credential-status'");
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain('createStoreScopedLoginCredentialStore(state.configurationBus, initialContext.storeId)');
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain('createStoreScopedLoginCredentialStore(state.configurationBus, loginContext.storeId)');
    expect(mainRuntimeModuleContract('main-browser-session-runtime.ts')).toContain('createStoreScopedLoginCredentialStore(state.configurationBus, capturedContext.storeId)');
    expect(mainRuntimeModuleContract('main-browser-session-runtime.ts')).toContain('storeId: capturedContext?.storeId ?? null');
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('resolveSavedLoginPassword(state.configurationBus, electronLoginCredentialCipher, username)'); }
    expect(mainRuntimeModuleContract('main-ipc-registration-runtime.ts')).toContain('handleBrowserLogin(normalizeBrowserLoginRequest(input))');
    expect(browserLoginRequestSource).toContain("typeof candidate.rememberPassword !== 'boolean'");
    expect(mainRuntimeModuleContract('main-ipc-registration-runtime.ts')).toContain('normalizeBrowserLoginRequest(input)');
    expect(source).toContain('state.storeCoordinator.assertActiveStoreContext(request.storeContext)');
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('request.amazonAdsProfileId'); }
    expect(browserLoginRequestSource).toContain("hasOwnProperty.call(candidate, 'amazonAdsProfileId')");
    expect(browserLoginRequestSource).toContain('由 Main 从可见页面自动识别');
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain("registerTrackedIpcHandler('browser:get-saved-credentials'"); }
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('password: saved'); }
  });

  it('requires the Windows safeStorage envelope before decrypting a saved credential', () => {
    expect(mainRuntimeModuleContract('main-runtime-context.ts')).toContain("if (!value.startsWith('safe:'))");
    expect(mainRuntimeModuleContract('main-runtime-context.ts')).toContain("const payload = value.slice(5)");
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain("value.startsWith('safe:') ? value.slice(5) : value"); }
  });

  it('applies the session credential policy before persisting or trusting a login identity', () => {
    const source = mainRuntimeFunctionContract('performBrowserLoginInUserLane');
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain('decideLoginSessionCredentialPolicy({');
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain('credentialAction === \'save\' || credentialAction === \'clear\'');
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain('isPackageUiSavedSessionContinuationAllowed({');
    expect(source).toContain('packageUiReadOnlyRuntime,');
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain(
      '&& !packageUiSavedSessionContinuationAllowed',
    );
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain('await openLingxingAdsFromErp(lingxingController)');
    expect(source).toContain('await readLingxingAdsProfileEvidence(');
    expect(source).toContain('resolveLingxingStableIdentityFromAdsProfile({');
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain('configuredExternalAccountId: connections.lingxing.externalAccountId');
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain(
      "credentialSubmission: request.credentialSource === 'typed' && needsLogin",
    );
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain('credentialsSubmitted: true,');
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('assertProviderIdentity('); }
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain("amazonAdsController.navigate('https://ads.lingxing.com/');"); }
    expect(source.match(/assertBrowserLoginAttempt\(attemptId, loginContext\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain('credentialPersistence: credentialPolicy.credentialPersistence');
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain('credentialSource: request.credentialSource');
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain('sessionIdentityVerified: credentialPolicy.sessionIdentityVerified');
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('sessionIdentityVerified: true,'); }
  });

  it('keeps active identity evidence Main-only and exact-match bounded', () => {
    const source = mainRuntimeFunctionContract('performBrowserLoginInUserLane');
    expect(lingxingAdsResponsesSource).toContain("responseUrl.origin === 'https://ads.lingxing.com'");
    expect(lingxingAdsResponsesSource).toContain("responseUrl.pathname === ADS_PROFILE_LIST_PATH");
    expect(lingxingAdsResponsesSource).toContain("response.request().method() === 'POST'");
    expect(lingxingAdsIdentitySource).toContain("record.country !== 'US'");
    expect(lingxingAdsIdentitySource).toContain('normalizeProviderExternalAccountId(\'amazon_ads\', record.profile_id)');
    expect(lingxingAdsIdentitySource).toContain('if (unique.length !== 1)');
    expect(providerActiveIdentitySource).not.toContain('bodyText');
    expect(providerActiveIdentitySource).not.toContain('document.title');
    expect(providerActiveIdentitySource).not.toContain('innerText');

    const loginResultStart = source.indexOf('const loginResult: BrowserLoginResult');
    const loginResultEnd = source.indexOf('state.loginSession = loginResult', loginResultStart);
    const rendererLoginResult = source.slice(loginResultStart, loginResultEnd);
    expect(rendererLoginResult).not.toContain('domObservations');
    expect(rendererLoginResult).not.toContain('activeIdentity');
    expect(rendererLoginResult).not.toContain('identityCandidates');
  });

  it('binds browser controllers to one registry candidate and two provider-specific profiles', () => {
    const source = mainRuntimeFunctionContract('browserRuntimeController');
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('interface StoreBrowserRuntime'); }
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('state.browserRuntime'); }
    expect(mainRuntimeModuleContract('main-runtime-context.ts')).toContain('const visibleBrowserRuntimeRegistry = new VisibleBrowserRuntimeRegistry()');
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain('userDataDir: capsule.lingxingProfileDir');
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain('userDataDir: capsule.amazonAdsProfileDir');
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain("purpose: 'operator_full'");
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain('amazonAds: amazonAdsController');
    expect(mainRuntimeModuleContract('main-browser-login-runtime.ts')).toContain('amazonAds: capsule.amazonAdsProfileDir');
    expect(mainRuntimeModuleContract('main-operator-browser-runtime.ts')).toContain('legacy-amazon-ads-screenshot:${label}');
    expect(source).toContain("runtime.purpose !== 'operator_full'");
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain("path.join(STORAGE_DIR, 'browser-data')"); }
  });

  it('opens enrollment with only the Lingxing selector and confirms auto-detected Ads identity in Main', () => {
    const connectionContract = browserLoginProviderConnectionSource;
    expect(connectionContract).toContain('if (!lingxing)');
    expect(connectionContract).toContain("amazon_ads: StoreConnection | undefined");
    expect(connectionContract).toContain("amazonAdsIdentityReadiness = 'enrollment_pending'");
    expect(connectionContract).not.toContain('必须先配置 Amazon Ads Profile 连接');

    const login = mainRuntimeFunctionContract('performBrowserLoginInUserLane');
    const confirmation = mainRuntimeFunctionContract('handleConfirmBrowserLoginAdsIdentity');
    expect(login).toContain('requireBrowserLoginProviderConnections');
    expect(login).not.toContain('request.amazonAdsProfileId');
    expect(login).toContain('ensureAmazonAdsEnrollmentConnection');
    expect(login).toContain('ensureLingxingErpAuthenticated(adsErpPage, { username, password })');
    expect(login).toContain('openLingxingAdsFromErp(amazonAdsController)');
    expect(login).toContain('readLingxingAdsProfileEvidence(adsPage, lingxingStoreAlias)');
    expect(login).toContain('pendingAmazonAdsIdentityConfirmation');
    expect(mainRuntimeModuleContract('main-ads-enrollment-runtime.ts')).toContain('handleConfirmBrowserLoginAdsIdentity');
    expect(confirmation).toContain('verifyAmazonAdsIdentity(pending.claim, readyConnection)');
    expect(login).not.toContain("amazonAdsController.navigate('https://ads.lingxing.com/');");
    expect(login).toContain('adsSessionReady: Boolean(adsSession)');
    const packageLogin = mainRuntimeSectionContract('async function handleBrowserLogin', 'async function performBrowserLoginInUserLane');
    expect(packageLogin).toContain('withPackageUiSetupMutation');
    expect(packageLogin).not.toContain('package UI evidence cannot start a real account login');
  });

  it('captures screenshots inside the active store capsule and closes through exact registry proof', () => {
    expect(mainRuntimeModuleContract('main-operator-browser-runtime.ts')).toContain('storeCapsuleFor(store).screenshotsDir');
    expect(mainRuntimeModuleContract('main-operator-browser-runtime.ts')).toContain('controller.screenshotToPath(screenshotPath, label)');
    expect(mainRuntimeModuleContract('main-browser-session-runtime.ts')).toContain('visibleBrowserRuntimeRegistry.strictCloseCurrent(runtime.context)');
    expect(mainRuntimeModuleContract('main-browser-session-runtime.ts')).toContain('visibleBrowserRuntimeRegistry.consumeEmptyProof(proof)');
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('state.browserRuntime'); }
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('state.currentStore === store.displayName'); }
  });

  it('keeps the non-secret login session across renderer refresh and clears it on safe exits', () => {
    const source = mainRuntimeModuleContract('main-browser-login-runtime.ts');
    expect(mainRuntimeModuleContract('main-runtime-contracts.ts')).toContain('loginSession: BrowserLoginResult | null;');
    expect(source).toContain('state.loginSession = loginResult;');
    expect(mainRuntimeModuleContract('main-ipc-registration-runtime.ts')).toContain('loginSession: state.loginSession,');
    expect(mainRuntimeModuleContract('main-browser-session-runtime.ts')).toContain('function clearBrowserLoginState(): void');
    expect(mainRuntimeModuleContracts().reduce((count, module) => count + (module.source.match(/clearBrowserLoginState\(\);/g)?.length ?? 0), 0)).toBeGreaterThanOrEqual(3);
  });
});
