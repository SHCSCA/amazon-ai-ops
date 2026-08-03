import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
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

describe('Electron external-distribution security wiring', () => {
  it('installs navigation, redirect, and external-open guards before loading the renderer', () => {
    const navigationIndex = source.indexOf("webContents.on('will-navigate'");
    const redirectIndex = source.indexOf("webContents.on('will-redirect'");
    const windowOpenIndex = source.indexOf('setWindowOpenHandler(createSecureWindowOpenHandler');
    const loadUrlIndex = source.indexOf("loadURL('http://localhost:5173')");
    const loadFileIndex = source.indexOf('loadFile(rendererFilePath)');

    expect(navigationIndex).toBeGreaterThan(0);
    expect(redirectIndex).toBeGreaterThan(navigationIndex);
    expect(windowOpenIndex).toBeGreaterThan(redirectIndex);
    expect(loadUrlIndex).toBeGreaterThan(windowOpenIndex);
    expect(loadFileIndex).toBeGreaterThan(windowOpenIndex);
    expect(source).toContain("const development = !app.isPackaged && process.env.NODE_ENV === 'development'");
    expect(source).not.toContain('setWindowOpenHandler(({ url })');
    expect(source).not.toContain('shell.openExternal(url);');
  });

  it('wires the deny-all external-open policy without exposing a shell opener', () => {
    expect(source).toContain('EXTERNAL_OPEN_POLICY_MARKER');
    expect(source).toContain('externalOpenPolicy: EXTERNAL_OPEN_POLICY_MARKER');
    expect(source).not.toContain('shell.openExternal');
    expect(source).not.toContain('openExternal: (url) =>');
  });

  it('exposes saved-credential status only and resolves saved passwords inside Main', () => {
    expect(source).toContain("registerTrackedIpcHandler('browser:get-saved-credential-status'");
    expect(source).toContain('resolveSavedLoginPassword(state.settingsRepo, electronLoginCredentialCipher, username)');
    expect(source).toContain('handleBrowserLogin(normalizeBrowserLoginRequest(input))');
    expect(browserLoginRequestSource).toContain("typeof candidate.rememberPassword !== 'boolean'");
    expect(source).toContain('normalizeBrowserLoginRequest(input)');
    expect(source).toContain('state.storeCoordinator.assertActiveStoreContext(request.storeContext)');
    expect(source).toContain('request.amazonAdsProfileId');
    expect(source).not.toContain("registerTrackedIpcHandler('browser:get-saved-credentials'");
    expect(source).not.toContain('password: saved');
  });

  it('requires the Windows safeStorage envelope before decrypting a saved credential', () => {
    expect(source).toContain("if (!value.startsWith('safe:'))");
    expect(source).toContain("const payload = value.slice(5)");
    expect(source).not.toContain("value.startsWith('safe:') ? value.slice(5) : value");
  });

  it('applies the session credential policy before persisting or trusting a login identity', () => {
    expect(source).toContain('decideLoginSessionCredentialPolicy({');
    expect(source).toContain('credentialAction === \'save\' || credentialAction === \'clear\'');
    expect(source).toContain('isPackageUiSavedSessionContinuationAllowed({');
    expect(source).toContain('packageUiReadOnlyRuntime,');
    expect(source).toContain(
      '&& !packageUiSavedSessionContinuationAllowed',
    );
    expect(source).toContain('await assertProviderPageActiveIdentity({');
    expect(source).toContain('connection: connections.lingxing,');
    expect(source).toContain('connection: adsConnection,');
    expect(source).toContain(
      "credentialSubmission: request.credentialSource === 'typed' && needsLogin",
    );
    expect(source).toContain('credentialsSubmitted: true,');
    expect(source).not.toContain('assertProviderIdentity(');
    expect(source).not.toMatch(
      /assertProviderPageActiveIdentity\(\{[\s\S]*?(?:bodyText|title):\s*erpLoginState\./,
    );
    expect(source.match(/assertBrowserLoginAttempt\(attemptId, loginContext\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('credentialPersistence: credentialPolicy.credentialPersistence');
    expect(source).toContain('credentialSource: request.credentialSource');
    expect(source).toContain('sessionIdentityVerified: credentialPolicy.sessionIdentityVerified');
    expect(source).not.toContain('sessionIdentityVerified: true,');
  });

  it('keeps active identity evidence Main-only and exact-match bounded', () => {
    expect(source).toContain('PROVIDER_ACTIVE_IDENTITY_DOM_PROBES.map');
    expect(source).toContain("element.closest('[hidden], [aria-hidden=\"true\"], [inert]')");
    expect(source).toContain('.slice(0, 2)');
    expect(providerActiveIdentitySource).toContain("origin: 'https://erp.lingxing.com'");
    expect(providerActiveIdentitySource).toContain("queryParameters: ['account_id', 'seller_id', 'store_id']");
    expect(providerActiveIdentitySource).toContain("origin: 'https://ads.lingxing.com'");
    expect(providerActiveIdentitySource).toContain("queryParameters: ['profile_id']");
    expect(providerActiveIdentitySource).toContain('candidates.every((candidate) => expectedSet.has(candidate))');
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
    expect(source).not.toContain('interface StoreBrowserRuntime');
    expect(source).not.toContain('state.browserRuntime');
    expect(source).toContain('const visibleBrowserRuntimeRegistry = new VisibleBrowserRuntimeRegistry()');
    expect(source).toContain('userDataDir: capsule.lingxingProfileDir');
    expect(source).toContain('userDataDir: capsule.amazonAdsProfileDir');
    expect(source).toContain("purpose: 'operator_full'");
    expect(source).toContain('amazonAds: amazonAdsController');
    expect(source).toContain('amazonAds: capsule.amazonAdsProfileDir');
    expect(source).toContain('legacy-amazon-ads-screenshot:${label}');
    expect(source).toContain("runtime.purpose !== 'operator_full'");
    expect(source).not.toContain("path.join(STORAGE_DIR, 'browser-data')");
  });

  it('requires both provider identity mappings at the Main login boundary while keeping an unavailable Ads session blocked', () => {
    const connectionContract = browserLoginProviderConnectionSource;
    expect(connectionContract).toContain('if (!lingxing)');
    expect(connectionContract).toContain('if (!amazonAds)');
    expect(connectionContract).toContain('if (!amazonAds.externalAccountId?.trim())');
    expect(connectionContract).toContain('必须先配置 Amazon Ads Profile 连接');
    expect(connectionContract).toContain('Amazon Ads 连接缺少 Profile ID');
    expect(connectionContract).toContain('return { lingxing, amazon_ads: amazonAds }');

    const loginStart = source.indexOf('async function handleBrowserLogin');
    const loginEnd = source.indexOf('async function handleBrowserLogout', loginStart);
    const login = source.slice(loginStart, loginEnd);
    expect(login).toContain('requireBrowserLoginProviderConnections');
    expect(login).toContain('request.amazonAdsProfileId');
    expect(login).toContain('waitForLingxingAdsSessionReady');
    expect(login).toContain('AMAZON_ADS_AUTHORIZATION_TIMEOUT_MS');
    expect(login).toContain('adsSessionReady: Boolean(adsSession)');
    const packageLogin = source.slice(
      source.indexOf('async function handleBrowserLogin'),
      source.indexOf('async function performBrowserLoginInUserLane'),
    );
    expect(packageLogin).toContain('PACKAGE_UI_EVIDENCE_READ_ONLY');
    expect(packageLogin).toContain('package UI evidence cannot start a real account login');
  });

  it('captures screenshots inside the active store capsule and closes through exact registry proof', () => {
    expect(source).toContain('storeCapsuleFor(store).screenshotsDir');
    expect(source).toContain('controller.screenshotToPath(screenshotPath, label)');
    expect(source).toContain('visibleBrowserRuntimeRegistry.strictCloseCurrent(runtime.context)');
    expect(source).toContain('visibleBrowserRuntimeRegistry.consumeEmptyProof(proof)');
    expect(source).not.toContain('state.browserRuntime');
    expect(source).not.toContain('state.currentStore === store.displayName');
  });

  it('keeps the non-secret login session across renderer refresh and clears it on safe exits', () => {
    expect(source).toContain('loginSession: BrowserLoginResult | null;');
    expect(source).toContain('state.loginSession = loginResult;');
    expect(source).toContain('loginSession: state.loginSession,');
    expect(source).toContain('function clearBrowserLoginState(): void');
    expect(source.match(/clearBrowserLoginState\(\);/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
