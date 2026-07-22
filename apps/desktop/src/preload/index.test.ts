import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('preload business update bridge', () => {
  it('forwards main-process business-ui:data-updated IPC events to renderer DOM listeners', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).toContain("ipcRenderer.on('business-ui:data-updated'");
    expect(source).toContain("window.dispatchEvent(new Event('business-ui:data-updated'))");
  });

  it('exposes only remembered-login status and a discriminated login request', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const loginContractSource = fs.readFileSync(path.join(__dirname, '../shared/login-contract.ts'), 'utf8');

    expect(source).toContain("getSavedLoginCredentialStatus: () => ipcRenderer.invoke('browser:get-saved-credential-status')");
    expect(source).toContain('BrowserLoginRequest');
    expect(loginContractSource).toContain("credentialSource: 'saved'");
    expect(loginContractSource).toContain("credentialSource: 'typed'");
    expect(loginContractSource).toContain('rememberPassword');
    expect(source).not.toContain('getSavedLoginCredentials');
    expect(source).not.toContain("ipcRenderer.invoke('browser:get-saved-credentials')");
  });

  it('uses the shared non-secret login result contract across the IPC bridge', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).toContain("import type { BrowserLoginRequest, BrowserLoginResult } from '../shared/login-contract'");
    expect(source).toContain('browserLogin: (request: BrowserLoginRequest): Promise<BrowserLoginResult> =>');
    expect(source).toContain("ipcRenderer.invoke('browser:login', request) as Promise<BrowserLoginResult>");
  });

  it('exposes readback screenshot capture IPC without exposing ipcRenderer', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).toContain('saveReadbackCapture');
    expect(source).toContain("ipcRenderer.invoke('recommendations:save-readback-capture'");
  });

  it('requires the displayed recommendation revision in structured decision IPC', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).toContain('{ id: number; expectedRevision: number; decision?: any }');
    expect(source).toContain("ipcRenderer.invoke('recommendations:approve', input)");
    expect(source).toContain("ipcRenderer.invoke('recommendations:reject', input)");
  });

  it('exposes the controlled review resolution IPC through the shared request and result contract', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).toContain('ResolveRecommendationReviewRequest');
    expect(source).toContain('ResolveRecommendationReviewResult');
    expect(source).toContain('resolveRecommendationReview: (input: ResolveRecommendationReviewRequest)');
    expect(source).toContain("ipcRenderer.invoke('recommendations:resolve-review', input)");
  });

  it('exposes pending writable-target binding through its shared request and result contract', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).toContain('BindRecommendationWritableTargetRequest');
    expect(source).toContain('BindRecommendationWritableTargetResult');
    expect(source).toContain('bindRecommendationWritableTarget: (input: BindRecommendationWritableTargetRequest)');
    expect(source).toContain("ipcRenderer.invoke('recommendations:bind-writable-target', input)");
  });

  it('exposes the readback export through the shared authority request instead of an untyped renderer payload', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).toContain('ExportAdReadbackEvidenceRequest');
    expect(source).toContain("from '@amazon-ai-ops/shared-types'");
    expect(source).toContain('exportAdReadbackEvidence: (input: ExportAdReadbackEvidenceRequest) =>');
    expect(source).not.toContain('exportAdReadbackEvidence: (input: any)');
  });

  it('exposes typed logical store CRUD and switching without profile paths or secrets', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).toContain('ListStoresInput');
    expect(source).toContain('StoreWorkspaceView');
    expect(source).toContain("ipcRenderer.invoke('stores:create', input)");
    expect(source).toContain("ipcRenderer.invoke('stores:connections:create', input)");
    expect(source).toContain("ipcRenderer.invoke('stores:switch', { storeId })");
    expect(source).toContain("ipcRenderer.invoke('stores:get-active-context')");
    expect(source).toContain("ipcRenderer.on('store-context:changed', handler)");
    const storeBridgeStart = source.indexOf('listStores:');
    const settingsStart = source.indexOf('// Settings', storeBridgeStart);
    const storeBridge = source.slice(storeBridgeStart, settingsStart);
    expect(storeBridge).not.toMatch(/profilePath|userDataDir|cookie|password|token/i);
  });
});
