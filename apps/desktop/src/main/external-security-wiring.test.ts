import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

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
    expect(source).toContain('if (!credentialPolicy.sessionIdentityVerified)');
    expect(source).toContain('assertProviderIdentity(connections.lingxing');
    expect(source).toContain('assertProviderIdentity(connections.amazon_ads');
    expect(source.match(/assertBrowserLoginAttempt\(attemptId, loginContext\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('credentialPersistence: credentialPolicy.credentialPersistence');
    expect(source).toContain('sessionIdentityVerified: credentialPolicy.sessionIdentityVerified');
  });

  it('binds browser controllers to one store context and two provider-specific profiles', () => {
    expect(source).toContain('interface StoreBrowserRuntime');
    expect(source).toContain('context: StoreContextEnvelope;');
    expect(source).toContain('userDataDir: capsule.lingxingProfileDir');
    expect(source).toContain('userDataDir: capsule.amazonAdsProfileDir');
    expect(source).toContain("browserRuntimeController('amazon_ads')");
    expect(source).not.toContain("path.join(STORAGE_DIR, 'browser-data')");
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
