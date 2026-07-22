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

  it('exposes authoritative Lingxing collection progress and recovery without leaking ipcRenderer', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).toContain('AuthoritativeLingxingCollectionRange');
    expect(source).toContain('requestId: string');
    expect(source).toContain('storeContext: StoreContextEnvelope');
    expect(source).toContain("ipcRenderer.on('lingxing-collection:progress', handler)");
    expect(source).toContain("ipcRenderer.removeListener('lingxing-collection:progress', handler)");
    expect(source).toContain("ipcRenderer.invoke('v1_5:reports:list-lingxing-collection-jobs', input)");
    expect(source).toContain("ipcRenderer.invoke('v1_5:reports:resume-lingxing-collection', input)");
    expect(source).toContain("ipcRenderer.invoke('v1_5:reports:cancel-lingxing-collection', input)");
    expect(source).toContain('type LingxingCollectionCancelInput = {');
    expect(source).toContain('jobId: string');
    expect(source).toContain('requestId: string');
  });

  it('requires full StoreContext authority for both business report import mutations', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).toContain('type AuthoritativeBusinessImportScope = BusinessUiScope & {');
    expect(source).toContain('storeContext: StoreContextEnvelope');
    expect(source).toContain('importCurrentBusinessReports: (scope: AuthoritativeBusinessImportScope) =>');
    expect(source).toContain('importLocalBusinessReportFiles: (scope: AuthoritativeBusinessImportScope) =>');
    expect(source).toContain("ipcRenderer.invoke('v1_5:business-ui:import-current-reports', scope)");
    expect(source).toContain("ipcRenderer.invoke('v1_5:business-ui:import-local-report-files', scope)");
  });

  it('requires StoreContext authority for operation-scope reads and writes', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).toContain('getOperationScope: (storeContext: StoreContextEnvelope) =>');
    expect(source).toContain("ipcRenderer.invoke('settings:get-operation-scope', storeContext)");
    expect(source).toContain('saveOperationScope: (storeContext: StoreContextEnvelope, scope: any) =>');
    expect(source).toContain("ipcRenderer.invoke('settings:save-operation-scope', { storeContext, scope })");
    expect(source).not.toContain("ipcRenderer.invoke('settings:get-operation-scope')");
  });

  it('opens collection and import artifacts by opaque id under the current StoreContext', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const reportsStart = source.indexOf('// Reports');
    const reportsEnd = source.indexOf('// v1.5 Product Config', reportsStart);
    const reportsBridge = source.slice(reportsStart, reportsEnd);

    expect(reportsBridge).toContain('openReportArtifact: (artifactId: string, storeContext: StoreContextEnvelope) =>');
    expect(reportsBridge).toContain("ipcRenderer.invoke('v1_5:reports:open-artifact', { artifactId, storeContext })");
    expect(reportsBridge).not.toContain('openReportPath');
    expect(reportsBridge).not.toContain("ipcRenderer.invoke('v1_5:reports:open-path'");
    expect(reportsBridge).not.toContain('selectReportFile');
    expect(reportsBridge).not.toContain('parseReport:');
    expect(reportsBridge).not.toContain('downloadReport:');
    expect(reportsBridge).toContain('exportDataReconciliationArtifacts:');
    expect(reportsBridge).toContain("ipcRenderer.invoke('v1_5:business-ui:export-data-reconciliation-artifacts', scope)");
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

  it('exposes only context-authorized product, event, ad-fact, and Listing object operations', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const objectsStart = source.indexOf('// Main-authorized product and operation-event objects');
    const settingsStart = source.indexOf('// Settings', objectsStart);
    const objectsBridge = source.slice(objectsStart, settingsStart);

    expect(objectsBridge).toContain('storeContext: StoreContextEnvelope');
    expect(objectsBridge).toContain("ipcRenderer.invoke('store-objects:products:list', { storeContext, input })");
    expect(objectsBridge).toContain("ipcRenderer.invoke('store-objects:products:create', { storeContext, input })");
    expect(objectsBridge).toContain("ipcRenderer.invoke('store-objects:products:update', { storeContext, input })");
    expect(objectsBridge).toContain("ipcRenderer.invoke('store-objects:products:archive', { storeContext, input })");
    expect(objectsBridge).toContain("ipcRenderer.invoke('store-objects:operation-events:list', { storeContext, input })");
    expect(objectsBridge).toContain("ipcRenderer.invoke('store-objects:operation-events:create', { storeContext, input })");
    expect(objectsBridge).toContain("ipcRenderer.invoke('store-objects:operation-events:update', { storeContext, input })");
    expect(objectsBridge).toContain("ipcRenderer.invoke('store-objects:operation-events:delete', { storeContext, input })");
    expect(objectsBridge).toContain("ipcRenderer.invoke('store-ad-listing:ad-objects:list', { storeContext, input })");
    expect(objectsBridge).toContain("ipcRenderer.invoke('store-ad-listing:keyword-facts:list', { storeContext, input })");
    expect(objectsBridge).toContain("ipcRenderer.invoke('store-ad-listing:listing:create', { storeContext, input })");
    expect(objectsBridge).toContain("ipcRenderer.invoke('store-ad-listing:listing:update', { storeContext, input })");
    expect(objectsBridge).toContain("ipcRenderer.invoke('store-ad-listing:listing:delete', { storeContext, input })");
    expect(objectsBridge).toContain("ipcRenderer.invoke('store-ad-listing:listing-versions:list', { storeContext, input })");
    expect(objectsBridge).toContain('StoreProductUpdateInput');
    expect(objectsBridge).toContain('StoreOperationEventUpdateInput');
    expect(objectsBridge).toContain('StoreListingContentUpdateInput');
    expect(objectsBridge).not.toContain("ipcRenderer.invoke('products:get'");
    expect(objectsBridge).not.toContain("ipcRenderer.invoke('operation-events:list'");
    expect(objectsBridge).not.toMatch(/sourceFile|screenshotPath|browserProfile|cookie|password|token/);
  });

  it('does not expose retired unscoped object or path-bearing keyword bridges', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    for (const channel of [
      'products:get',
      'products:add',
      'products:save-config',
      'products:bulk-update-target-acos',
      'operation-events:list',
      'operation-events:create',
      'operation-events:update',
      'operation-events:delete',
      'v1_5:business-ui:keyword-opportunities',
    ]) {
      expect(source).not.toContain(`ipcRenderer.invoke('${channel}'`);
    }
  });
});
