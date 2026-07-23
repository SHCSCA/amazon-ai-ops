import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('desktop scheduler scope contract', () => {
  it('runs scheduled recommendation generation with the persisted operation scope', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const registration = source.match(/name: 'daily_recommendation_generate',[\s\S]*?\n\s*\}\);/)?.[0] || '';

    expect(registration).toContain('runRecommendationGeneration(handleGetOperationScope())');
    expect(registration).not.toContain('runRecommendationGeneration();');
  });

  it('keeps legacy unscoped scheduler mutations fail-closed and registers the StoreContext scheduler IPC', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(source).toContain('registerStoreCollectionSchedulerIpcHandlers(ipcMain, state.storeCollectionScheduler)');
    expect(source).toContain('LEGACY_SCHEDULER_IPC_DISABLED');
    const legacyStart = source.indexOf("ipcMain.handle('scheduler:set-task-enabled'");
    const legacyEnd = source.indexOf('// Logs', legacyStart);
    const legacyHandlers = source.slice(legacyStart, legacyEnd);
    expect(legacyHandlers).not.toContain('setTaskEnabled(');
    expect(legacyHandlers).not.toContain('runNow(');
  });

  it('binds collection scheduling to the visible Lingxing profile/session without requiring Ads readiness', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const targetStart = source.indexOf('function authorizedLingxingCollectionTarget');
    const targetEnd = source.indexOf('function projectBusinessReportFileForRenderer', targetStart);
    const targetAuthority = source.slice(targetStart, targetEnd);
    const start = source.indexOf('function assertVisibleLingxingCollectionSession');
    const end = source.indexOf('function buildAuthoritativeMissionControlTodayProjection', start);
    const authority = source.slice(start, end);
    const coordinatorStart = source.indexOf('function initializeLingxingCollectionCoordinator');
    const coordinatorEnd = source.indexOf('function initializeStoreCollectionScheduler', coordinatorStart);
    const coordinator = source.slice(coordinatorStart, coordinatorEnd);

    expect(targetAuthority).toContain("getConnection(context.storeId, 'lingxing')");
    expect(targetAuthority).toContain('connection.externalAccountId?.trim()');
    expect(targetAuthority).not.toContain("'amazon_ads'");
    expect(targetAuthority).not.toContain('Amazon Ads');
    expect(authority).toContain("getSessionMetadata(authorized.storeId, 'lingxing')");
    expect(authority).toContain('runtime.controllers.lingxing.getPage()');
    expect(authority).not.toContain("getSessionMetadata(authorized.storeId, 'amazon_ads')");
    expect(authority).not.toContain('controllers.amazon_ads.getPage()');
    expect(coordinator).toContain('browserRuntime.controllers.lingxing');
    expect(coordinator).not.toContain('browserRuntime.controllers.amazon_ads');

    const navigationStart = source.indexOf('async function navigateToLingxingDownloadCenter');
    const navigationEnd = source.indexOf('async function waitForCreateReportPage', navigationStart);
    const navigation = source.slice(navigationStart, navigationEnd);
    expect(navigation).toContain('page.goto(model.candidateUrls[0]');
    expect(navigation).not.toContain('ensureLingxingAdsSession');
    expect(source).not.toContain('async function ensureLingxingAdsSession');
  });

  it('publishes a Lingxing-ready runtime before the independent Ads probe and keeps Ads writes fail-closed', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const loginStart = source.indexOf('async function handleBrowserLogin');
    const loginEnd = source.indexOf('async function handleBrowserLogout', loginStart);
    const login = source.slice(loginStart, loginEnd);
    const lingxingReady = login.indexOf("provider: 'lingxing'");
    const runtimePublished = login.indexOf('state.browserRuntime = {');
    const adsProbe = login.indexOf('await amazonAdsController.launch()');

    expect(lingxingReady).toBeGreaterThan(0);
    expect(runtimePublished).toBeGreaterThan(lingxingReady);
    expect(adsProbe).toBeGreaterThan(runtimePublished);
    expect(login).toContain("provider: 'amazon_ads'");
    expect(login).toContain("status: 'blocked'");
    expect(login).toContain("failureCode: 'ADS_SESSION_NOT_READY'");
    expect(login).toContain('erpSessionReady: true');
    expect(login).toContain('adsSessionReady: Boolean(adsSession)');
    expect(login).toContain('state.storeCollectionScheduler?.reconcile(loginContext)');

    const executionStart = source.indexOf('resolveBrowserRuntime: (context) => {');
    const executionEnd = source.indexOf('emitProgress:', executionStart);
    const execution = source.slice(executionStart, executionEnd);
    expect(execution).toContain("getSessionMetadata(context.storeId, 'amazon_ads')");
    expect(execution).toContain("adsSession.status !== 'ready'");
    expect(execution).toContain('adsSession.browserProfileId !== context.browserProfileId');
    expect(execution).toContain('adsSession.sessionGeneration !== context.sessionGeneration');
  });

  it('only publishes store automation readiness when both scheduler and retention services exist', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const registrationStart = source.indexOf('createMissionControlLegacyAdapter({');
    const registrationEnd = source.indexOf('registerMissionDomainIpcHandlers', registrationStart);
    const registration = source.slice(registrationStart, registrationEnd);

    expect(registration).toContain('storeAutomationReady: Boolean(');
    expect(registration).toContain(
      'state.storeCollectionScheduler && state.storeEvidenceRetentionService',
    );
  });

  it('drains durable collection claims before browser and database shutdown', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const schedulerStart = source.indexOf('function initializeStoreCollectionScheduler');
    const schedulerEnd = source.indexOf('function assertVisibleLingxingCollectionSession', schedulerStart);
    const schedulerWiring = source.slice(schedulerStart, schedulerEnd);
    expect(schedulerWiring).toContain('cancelActiveCollection({ requestId, storeId })');
    expect(schedulerWiring).toContain('cancelledLingxingCollectionRequests.add(key)');

    const shutdownStart = source.indexOf('const handleBeforeQuit = createBeforeQuitCoordinator');
    const shutdown = source.slice(shutdownStart, source.indexOf("app.on('before-quit'", shutdownStart));
    const drain = shutdown.indexOf('await storeCollectionScheduler?.stopAndDrain()');
    const resourceCleanup = shutdown.indexOf('await cleanupAppResources');

    expect(resourceCleanup).toBeGreaterThan(0);
    expect(drain).toBeGreaterThan(resourceCleanup);
    expect(shutdown).toContain('browserController: runtime || pendingControllers.length > 0');
    expect(shutdown).toContain('db,');
  });

  it('fails the daily report task when no artifact can be produced and propagates generation failures', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const start = source.indexOf('async function runDailyReportGeneration');
    const body = source.slice(start, source.indexOf('// IPC Handlers', start));

    expect(body).toContain("if (!settings.aiApiKey)");
    expect(body).toContain("throw new Error('AI Key 未配置，无法生成每日运营报告。')");
    expect(body).toMatch(/catch \(err\) \{[\s\S]*?throw err;/);
  });
});
