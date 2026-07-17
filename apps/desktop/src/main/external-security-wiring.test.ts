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
});
