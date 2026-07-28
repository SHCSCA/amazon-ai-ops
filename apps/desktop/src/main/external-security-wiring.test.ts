import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
const providerActiveIdentitySource = fs.readFileSync(
  path.join(__dirname, 'provider-active-identity.ts'),
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
    expect(source).toContain("ipcMain.handle('browser:get-saved-credential-status'");
    expect(source).toContain('resolveSavedLoginPassword(state.settingsRepo, electronLoginCredentialCipher, username)');
    expect(source).toContain('handleBrowserLogin(normalizeBrowserLoginRequest(input))');
    expect(source).toContain("typeof candidate.rememberPassword !== 'boolean'");
    expect(source).not.toContain("ipcMain.handle('browser:get-saved-credentials'");
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

  it('binds browser controllers to one store context and two provider-specific profiles', () => {
    expect(source).toContain('interface StoreBrowserRuntime');
    expect(source).toContain('context: StoreContextEnvelope;');
    expect(source).toContain('userDataDir: capsule.lingxingProfileDir');
    expect(source).toContain('userDataDir: capsule.amazonAdsProfileDir');
    expect(source).toContain("browserRuntimeController('amazon_ads')");
    expect(source).not.toContain("path.join(STORAGE_DIR, 'browser-data')");
  });

  it('requires Lingxing for collection login while keeping a missing Ads connection explicitly blocked', () => {
    const connectionStart = source.indexOf('function requireProviderConnections');
    const connectionEnd = source.indexOf('async function handleBrowserLogin', connectionStart);
    const connectionContract = source.slice(connectionStart, connectionEnd);
    expect(connectionContract).toContain('if (!lingxing)');
    expect(connectionContract).not.toContain('if (!lingxing || !amazonAds)');
    expect(connectionContract).toContain('if (!amazonAds)');
    expect(connectionContract).toContain('Amazon Ads 连接缺少账号标识，广告执行保持阻断');
    expect(connectionContract).toContain('return { lingxing, amazon_ads: amazonAds }');

    const loginStart = source.indexOf('async function handleBrowserLogin');
    const loginEnd = source.indexOf('async function handleBrowserLogout', loginStart);
    const login = source.slice(loginStart, loginEnd);
    expect(login).toContain('if (!adsConnection || !amazonAdsController)');
    expect(login).toContain('adsUnavailableReason = connections.adsUnavailableReason');
    expect(login).toContain('adsSessionReady: Boolean(adsSession)');
  });

  it('captures screenshots inside the active store capsule and closes by store id', () => {
    expect(source).toContain('storeCapsuleFor(store).screenshotsDir');
    expect(source).toContain('controller.screenshotToPath(screenshotPath, label)');
    expect(source).toContain('state.browserRuntime?.context.storeId === store.storeId');
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
