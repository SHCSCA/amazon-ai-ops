import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  configuredSessionResetActionVisible,
  configuredSessionResetRequiredFromError,
  connectionOperatorCopy,
  loginStatusMessage,
  selectFreshBrowserLoginStoreContext,
} from '../renderer/App';

describe('browser login staged ERP and Ads status contract', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
  const ssoSource = fs.readFileSync(path.join(__dirname, 'lingxing-ads-sso.ts'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(__dirname, '../renderer/App.tsx'), 'utf8');
  const login = mainSource.slice(
    mainSource.indexOf('async function performBrowserLoginInUserLane'),
    mainSource.indexOf('async function handleBrowserLogout'),
  );
  const collectionRuntime = mainSource.slice(
    mainSource.indexOf('function initializeStoreCollectionProductionRuntime'),
    mainSource.indexOf('function assertVisibleLingxingCollectionSession'),
  );
  const collectionCoordinatorWiring = mainSource.slice(
    mainSource.indexOf('function initializeLingxingCollectionCoordinator'),
    mainSource.indexOf('function initializeStoreCollectionProductionRuntime'),
  );
  const collectionAction = mainSource.slice(
    mainSource.indexOf('async function handleCollectLingxingReports'),
    mainSource.indexOf('function handleImportCurrentBusinessReports'),
  );
  const collectionResumeAction = mainSource.slice(
    mainSource.indexOf('async function handleResumeLingxingCollection'),
    mainSource.indexOf('const DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS'),
  );

  it('keeps dynamic connection diagnostics out of the ordinary operator message', () => {
    const fallback = '连接状态异常，请刷新当前店铺后重试；真实广告执行继续阻断。';

    expect(connectionOperatorCopy('Main StoreContext Authority Profile Renderer UNKNOWN', fallback))
      .toBe(fallback);
    expect(connectionOperatorCopy('Ads 页面已打开，请确认当前店铺后重试。', fallback))
      .toBe('Ads 页面已打开，请确认当前店铺后重试。');
  });

  it('keeps the configured-session recovery action when error copy is sanitized', () => {
    const raw = new Error([
      "Error invoking remote method 'browser:login':",
      '当前领星会话身份未经本次凭证验证；请在应用中使用“重置当前店铺会话（保留本机密码）”，再重新连接。',
      'Call log: playwright chromium',
    ].join(' '));

    expect(configuredSessionResetRequiredFromError(raw)).toBe(true);
    expect(configuredSessionResetRequiredFromError(
      new Error('领星 Ads 页面在限定时间内未出现。'),
    )).toBe(false);
  });

  it('keeps the configured-session recovery action visible after the workbench remounts', () => {
    const sanitized = new Error(
      '当前领星会话身份未经本次凭证验证；请在应用中使用“重置当前店铺会话（保留本机密码）”，再重新连接。',
    );

    expect(configuredSessionResetActionVisible(sanitized, false)).toBe(true);
    expect(configuredSessionResetActionVisible(new Error('普通连接失败'), false)).toBe(false);
    expect(configuredSessionResetActionVisible(null, true)).toBe(true);
  });

  it('does not render a technical credential notice in the ordinary login status line', () => {
    expect(loginStatusMessage({
      credentialNotice: 'Renderer StoreContext revision mismatch',
      loading: false,
      rememberPassword: true,
    })).toBe('凭证状态异常，请重新输入密码后重试。');
  });

  it('explains a refreshed store mismatch without naming the internal process', () => {
    const expected = {
      browserProfileId: 'profile-current',
      businessTimezone: 'America/Los_Angeles',
      currency: 'USD',
      marketplace: 'US',
      storeId: 'store-current',
    } as any;
    const mismatched = {
      context: { ...expected, storeId: 'store-other' },
      store: { ...expected, storeId: 'store-other' },
    } as any;

    expect(() => selectFreshBrowserLoginStoreContext(expected, mismatched))
      .toThrow('本机读取的当前店铺身份与正在操作的店铺不一致，请刷新店铺后重新连接；本次操作已阻断。');
  });

  it('routes connection errors, Ads reasons, and sync warnings through operator copy', () => {
    const workbench = rendererSource.slice(
      rendererSource.indexOf('function StoreConnectionWorkbench'),
      rendererSource.indexOf('function MissionControlRuntime'),
    );

    expect(workbench).toContain('const visibleAdsUnavailableReason = connectionOperatorCopy(');
    expect(workbench).toContain('const visibleConnectionError = connectionOperatorCopy(');
    expect(workbench).toContain('const visibleSyncWarning = connectionOperatorCopy(');
    expect(workbench).toContain('{visibleSyncWarning}');
    expect(workbench).toContain('{visibleConnectionError}');
    expect(workbench).not.toContain('{store.postCommitSyncWarning}');
    expect(workbench).not.toContain('{error && <div role="alert" style={loginStyles.error}>{error}</div>}');
  });

  it('commits the verified ERP stage before Ads SSO or profile recognition can fail', () => {
    const erpStageCommit = login.indexOf('const stagedLingxingConnection = state.db!.transaction');
    const adsEntry = login.indexOf('await openLingxingAdsFromErp(lingxingController)');
    expect(erpStageCommit).toBeGreaterThan(-1);
    expect(adsEntry).toBeGreaterThan(erpStageCommit);
    expect(login.slice(erpStageCommit, adsEntry)).toContain("provider: 'lingxing'");
    expect(login.slice(erpStageCommit, adsEntry)).toContain("status: 'ready'");
  });

  it('persists a verified bound-store credential before Ads recognition can fail', () => {
    const erpStageCommit = login.indexOf('const stagedLingxingConnection = state.db!.transaction');
    const adsEntry = login.indexOf('await openLingxingAdsFromErp(lingxingController)');
    const earlyCredentialPersistence = login.slice(erpStageCommit, adsEntry);

    expect(earlyCredentialPersistence).toContain(
      "connections.lingxingIdentityReadiness === 'configured'",
    );
    expect(earlyCredentialPersistence).toContain(
      "credentialAction === 'save' || credentialAction === 'clear'",
    );
    expect(earlyCredentialPersistence).toContain('saveLoginCredentials(');
    expect(earlyCredentialPersistence).toContain(
      'createStoreScopedLoginCredentialStore(state.settingsRepo, loginContext.storeId)',
    );
    expect(earlyCredentialPersistence).toContain('credentialPersistenceCommitted = true;');
  });

  it('verifies the collection-only Lingxing session through the exact Ads store before scheduling reports', () => {
    const inspector = collectionRuntime.indexOf('inspectLingxingIdentity: async');
    const adsEntry = collectionRuntime.indexOf('await openLingxingAdsFromErp(', inspector);
    const profileEvidence = collectionRuntime.indexOf(
      'await readLingxingAdsProfileEvidence(',
      adsEntry,
    );
    const stableIdentity = collectionRuntime.indexOf(
      'resolveLingxingStableIdentityFromAdsProfile({',
      profileEvidence,
    );
    const downloadCenter = collectionRuntime.indexOf(
      'await navigateToLingxingDownloadCenter(',
      stableIdentity,
    );
    const ready = collectionRuntime.indexOf("status: 'ready'", downloadCenter);

    expect(inspector).toBeGreaterThan(-1);
    expect(adsEntry).toBeGreaterThan(inspector);
    expect(profileEvidence).toBeGreaterThan(adsEntry);
    expect(stableIdentity).toBeGreaterThan(profileEvidence);
    expect(downloadCenter).toBeGreaterThan(stableIdentity);
    expect(ready).toBeGreaterThan(downloadCenter);
    expect(collectionRuntime.slice(inspector, ready)).toContain(
      'connection.collectionStoreName',
    );
    expect(collectionRuntime.slice(inspector, ready)).toContain(
      'configuredExternalAccountId: connection.externalAccountId',
    );
  });

  it('persists same-window download-center evidence before collection identity becomes ready', () => {
    const inspector = collectionRuntime.indexOf('inspectLingxingIdentity: async');
    const downloadCenter = collectionRuntime.indexOf(
      'await navigateToLingxingDownloadCenter(',
      inspector,
    );
    const ready = collectionRuntime.indexOf("status: 'ready'", downloadCenter);
    const slice = collectionRuntime.slice(downloadCenter, ready);

    expect(downloadCenter).toBeGreaterThan(-1);
    expect(ready).toBeGreaterThan(downloadCenter);
    expect(slice).toContain('deriveStoreCollectionWindow(');
    expect(slice).toContain('persistCollectionOnlyDownloadCenterDiagnostic(');
    expect(slice).toContain('dateStart');
    expect(slice).toContain('dateEnd');
  });

  it('marks the exact operator runtime close as expected while collection takes ownership', () => {
    const runtimeRead = collectionAction.indexOf('visibleBrowserRuntimeRegistry.read()');
    const exactContext = collectionAction.indexOf('sameExactStoreContext(', runtimeRead);
    const expectedClose = collectionAction.indexOf(
      'expectedVisibleRuntimeCloseIds.add(expectedClosedRuntimeId)',
      exactContext,
    );
    const runNow = collectionAction.indexOf(
      'state.storeCollectionSchedulerReadModel.runNow(context)',
      expectedClose,
    );
    const releaseExpectedClose = collectionAction.indexOf(
      'expectedVisibleRuntimeCloseIds.delete(expectedClosedRuntimeId)',
      runNow,
    );

    expect(runtimeRead).toBeGreaterThan(-1);
    expect(exactContext).toBeGreaterThan(runtimeRead);
    expect(expectedClose).toBeGreaterThan(exactContext);
    expect(runNow).toBeGreaterThan(expectedClose);
    expect(releaseExpectedClose).toBeGreaterThan(runNow);
    expect(collectionAction.slice(runtimeRead, expectedClose)).toContain(
      "currentRuntime.purpose === 'operator_full'",
    );
  });

  it('marks the exact operator runtime close as expected while full8 resume takes ownership', () => {
    const runtimeRead = collectionResumeAction.indexOf('visibleBrowserRuntimeRegistry.read()');
    const exactContext = collectionResumeAction.indexOf('sameExactStoreContext(', runtimeRead);
    const expectedClose = collectionResumeAction.indexOf(
      'expectedVisibleRuntimeCloseIds.add(expectedClosedRuntimeId)',
      exactContext,
    );
    const resumeJob = collectionResumeAction.indexOf(
      'state.storeCollectionSchedulerReadModel.resumeJob(',
      expectedClose,
    );
    const releaseExpectedClose = collectionResumeAction.indexOf(
      'expectedVisibleRuntimeCloseIds.delete(expectedClosedRuntimeId)',
      resumeJob,
    );

    expect(runtimeRead).toBeGreaterThan(-1);
    expect(exactContext).toBeGreaterThan(runtimeRead);
    expect(expectedClose).toBeGreaterThan(exactContext);
    expect(resumeJob).toBeGreaterThan(expectedClose);
    expect(releaseExpectedClose).toBeGreaterThan(resumeJob);
    expect(collectionResumeAction.slice(runtimeRead, expectedClose)).toContain(
      "currentRuntime.purpose === 'operator_full'",
    );
  });

  it('protects the full8 checkpoint reconciliation navigation before resume admission', () => {
    const expectedClose = collectionResumeAction.indexOf(
      'expectedVisibleRuntimeCloseIds.add(expectedReconciliationRuntimeCloseId)',
    );
    const reconcile = collectionResumeAction.indexOf(
      'reconcileLingxingCreateUnknownCheckpoint(',
      expectedClose,
    );
    const releaseExpectedClose = collectionResumeAction.indexOf(
      'expectedVisibleRuntimeCloseIds.delete(expectedReconciliationRuntimeCloseId)',
      reconcile,
    );
    const resumeJob = collectionResumeAction.indexOf(
      'state.storeCollectionSchedulerReadModel.resumeJob(',
      releaseExpectedClose,
    );

    expect(expectedClose).toBeGreaterThan(-1);
    expect(reconcile).toBeGreaterThan(expectedClose);
    expect(releaseExpectedClose).toBeGreaterThan(reconcile);
    expect(resumeJob).toBeGreaterThan(releaseExpectedClose);
    expect(collectionResumeAction.slice(0, expectedClose)).toContain(
      'isExactLingxingFull8ReportSet(job.request.reportTypes)',
    );
  });

  it('wires every durable same-job resume persistence port into the production coordinator', () => {
    const requiredResumePorts = [
      'acquireCollectionResumeClaimForStore',
      'commitCollectionResumeProgressForStore',
      'commitCollectionResumeRunnerResultForStore',
      'advanceCollectionResumeClaimAfterImportForStore',
      'finalizeCollectionResumeAttemptForStore',
      'interruptCollectionResumeClaimForStore',
    ];

    for (const port of requiredResumePorts) {
      expect(collectionCoordinatorWiring).toContain(`${port}(storeId, input)`);
      expect(collectionCoordinatorWiring).toContain(
        `state.lingxingImportRepo!.${port}(storeId, input)`,
      );
    }
  });

  it('reads back encrypted storage before committing fresh typed proof ahead of Ads recognition', () => {
    const erpStageCommit = login.indexOf('const stagedLingxingConnection = state.db!.transaction');
    const adsEntry = login.indexOf('await openLingxingAdsFromErp(lingxingController)');
    const earlyCredentialPersistence = login.slice(erpStageCommit, adsEntry);
    const credentialSave = earlyCredentialPersistence.indexOf('saveLoginCredentials(');
    const credentialReadback = earlyCredentialPersistence.indexOf(
      'readSavedLoginCredentialStatus(',
      credentialSave,
    );
    const encryptedReadyGate = earlyCredentialPersistence.indexOf(
      "credentialState !== 'encrypted_ready'",
      credentialReadback,
    );
    const proofCommit = earlyCredentialPersistence.indexOf(
      'packageUiFreshTypedProof = Object.freeze({',
      credentialReadback,
    );

    expect(credentialSave).toBeGreaterThan(-1);
    expect(credentialReadback).toBeGreaterThan(credentialSave);
    expect(encryptedReadyGate).toBeGreaterThan(credentialReadback);
    expect(proofCommit).toBeGreaterThan(encryptedReadyGate);
    expect(earlyCredentialPersistence.slice(proofCommit)).toContain(
      'storeId: String(loginContext.storeId)',
    );
    expect(earlyCredentialPersistence.slice(proofCommit)).toContain(
      'username: username.trim()',
    );
  });

  it('records Ads recognition failure without overwriting the verified ERP provider', () => {
    expect(login).toContain('adsRecognitionFailure');
    expect(login).toContain("failureCode: 'ADS_SESSION_NOT_READY'");
    expect(login).toContain("provider: 'amazon_ads'");
    expect(login).toContain('erpStageCommitted');
    expect(login).toContain("if (!erpStageCommitted)");
  });

  it('restores the verified ERP tab when Ads or download-center recognition fails after the ERP stage', () => {
    const adsEntry = login.indexOf('await openLingxingAdsFromErp(lingxingController)');
    const downloadCenter = login.indexOf('await navigateToLingxingDownloadCenter(', adsEntry);
    const restoreErp = login.indexOf('await restoreAuthenticatedLingxingErpPage(lingxingController)', adsEntry);
    const credentialSave = login.indexOf('saveLoginCredentials(', adsEntry);

    expect(adsEntry).toBeGreaterThan(-1);
    expect(downloadCenter).toBeGreaterThan(adsEntry);
    expect(restoreErp).toBeGreaterThan(downloadCenter);
    expect(restoreErp).toBeLessThan(credentialSave);
    expect(login.slice(adsEntry, credentialSave)).toContain('if (adsRecognitionFailure)');
    expect(login.slice(adsEntry, credentialSave)).toContain('throw new Error(adsRecognitionFailure);');
  });

  it('renders explicit phased states and separate Ads retry and full reconnect actions', () => {
    expect(rendererSource).toContain('ERP 已连接');
    expect(rendererSource).toContain('Ads 待识别');
    expect(rendererSource).toContain('Ads 待用户确认');
    expect(rendererSource).toContain('Ads 已连接');
    expect(rendererSource).toContain('Ads 连接失败');
    expect(rendererSource).toContain('data-login-action="retry-ads"');
    expect(rendererSource).toContain('重试 Ads');
    expect(rendererSource).toContain('data-login-action="reconnect-all"');
    expect(rendererSource).toContain('重新连接 ERP 与 Ads');
  });

  it('preserves authenticated Ads page evidence without treating it as verified store identity', () => {
    const visibleEvidence = login.indexOf('adsVisibleSession = adsSessionResultFromPageState(');
    const profileEvidence = login.indexOf('await readLingxingAdsProfileEvidence(', visibleEvidence);
    expect(visibleEvidence).toBeGreaterThan(-1);
    expect(profileEvidence).toBeGreaterThan(visibleEvidence);
    expect(login).toContain('const adsPageEvidence = adsSession ?? adsVisibleSession;');
    expect(login).toContain('adsSessionReady: Boolean(adsSession)');
    expect(login).toContain('adsUrl: adsPageEvidence.adsUrl');
  });

  it('labels a visible but unverified Ads page as waiting for store recognition', () => {
    expect(rendererSource).toContain("| 'opened' | 'detected'");
    expect(rendererSource).toContain(
      'const adsPageVisible = Boolean(loginSession?.adsUrl || loginSession?.adsTitle);',
    );
    expect(rendererSource).toContain("? 'opened'");
    expect(rendererSource).toContain('Ads 页面已打开，当前店铺身份尚未确认');
    expect(rendererSource).toContain('ERP 已连接，Ads 已打开待识别');
    expect(rendererSource).toContain("? 'Ads 待识别'");
  });

  it('makes confirmation the only next action after an exact Ads store candidate is detected', () => {
    const readiness = rendererSource.slice(
      rendererSource.indexOf('const amazonAdsReadinessDetail ='),
      rendererSource.indexOf('const overallConnectionState ='),
    );
    expect(readiness.indexOf('adsIdentityCandidate')).toBeGreaterThan(-1);
    expect(readiness.indexOf('adsIdentityCandidate')).toBeLessThan(readiness.indexOf('adsPageVisible'));
    expect(readiness).toContain('确认当前店铺并完成连接');

    const overallLabel = rendererSource.slice(
      rendererSource.indexOf('const overallConnectionLabel ='),
      rendererSource.indexOf('const currentConnectionStep ='),
    );
    expect(overallLabel).toContain("? 'ERP 已连接，Ads 待确认'");

    const actionArea = rendererSource.slice(
      rendererSource.indexOf('data-login-action="reconnect-all"') - 1_200,
      rendererSource.indexOf('主动作保持禁用时'),
    );
    expect(actionArea).toContain('data-login-action="confirm-ads-identity"');
    expect(actionArea).toContain('data-package-ui-evidence-action="confirm-amazon-ads-identity"');
    expect(actionArea).toContain('确认绑定到当前店铺');
    expect(actionArea).toContain('并完成连接');
    expect(actionArea).toContain('!adsIdentityCandidate');
    expect(rendererSource.match(/data-package-ui-evidence-action="confirm-amazon-ads-identity"/g)).toHaveLength(1);
  });

  it('keeps Ads retry available through a Main-managed credential without reopening the ERP stage', () => {
    expect(rendererSource).toContain('const retryAdsReady = erpSessionConnected');
    expect(rendererSource).toContain('savedPasswordAvailable');
    expect(rendererSource).toContain("const retryingAds = action === 'retry-ads';");
    expect(rendererSource).toContain("credentialSource: retryingAds ? 'saved' : credentialSource");
    const retryButton = rendererSource.slice(
      rendererSource.indexOf('data-login-action="retry-ads"') - 500,
      rendererSource.indexOf('data-login-action="retry-ads"') + 500,
    );
    expect(retryButton).toContain('disabled={loading || !retryAdsReady}');

    const handler = mainSource.slice(
      mainSource.indexOf('async function handleBrowserLogin('),
      mainSource.indexOf('async function performBrowserLoginInUserLane('),
    );
    expect(handler).toContain('isCurrentAmazonAdsRetryContinuation(');
    expect(handler).toContain('retryCurrentAmazonAdsSession(');
    expect(handler.indexOf('retryCurrentAmazonAdsSession('))
      .toBeLessThan(handler.indexOf('runUserVisibleBrowserTransition({'));
  });

  it('preserves the original ERP credential proof while an Ads-only retry completes the same login', () => {
    const retry = mainSource.slice(
      mainSource.indexOf('async function retryCurrentAmazonAdsSession('),
      mainSource.indexOf('async function handleBrowserLogin('),
    );

    // The sole saved-source literal belongs to the stable Lingxing enrollment
    // continuation. Retry result projections must retain the already verified
    // ERP proof from sessionBase instead of inventing a saved/reused session.
    expect(retry.match(/credentialSource: 'saved'/g)).toHaveLength(1);
    expect(retry).not.toContain('erpSessionReused: true,');
    expect(retry).not.toContain('sessionIdentityVerified: true,');
    expect(retry).not.toContain("credentialPersistence: 'main_managed',");
    expect(retry.match(/\.\.\.sessionBase,/g)).toHaveLength(3);
  });

  it('keeps Ads retry available when first profile enrollment is pending and enrolls only from the verified continuation', () => {
    const retryReadiness = rendererSource.slice(
      rendererSource.indexOf('const retryAdsReady = erpSessionConnected'),
      rendererSource.indexOf('const loginButtonView =', rendererSource.indexOf('const retryAdsReady = erpSessionConnected')),
    );
    expect(retryReadiness).not.toContain('!lingxingEnrollmentPending');

    const retry = mainSource.slice(
      mainSource.indexOf('async function retryCurrentAmazonAdsSession('),
      mainSource.indexOf('async function handleBrowserLogin('),
    );
    const profileEvidence = retry.indexOf('await readLingxingAdsProfileEvidence(');
    const continuationIdentity = retry.indexOf('resolveLingxingStableIdentityFromVerifiedContinuation({');
    const enrollment = retry.indexOf('state.storeRepo!.enrollLingxingStableExternalAccount({');
    expect(profileEvidence).toBeGreaterThan(-1);
    expect(continuationIdentity).toBeGreaterThan(profileEvidence);
    expect(enrollment).toBeGreaterThan(continuationIdentity);
    expect(retry.slice(continuationIdentity, enrollment)).toContain("credentialSource: 'saved'");
    expect(retry.slice(continuationIdentity, enrollment)).toContain('sessionIdentityVerified: currentSession.sessionIdentityVerified');
  });

  it('admits only Ads retry and confirmation through the exact post-login Package UI continuation lane', () => {
    expect(mainSource).toContain('async function withPackageUiVisibleLoginContinuationMutation');
    const continuation = mainSource.slice(
      mainSource.indexOf('async function withPackageUiVisibleLoginContinuationMutation'),
      mainSource.indexOf('async function retryCurrentAmazonAdsSession('),
    );
    expect(continuation).toContain("operation !== 'browser:retry-ads'");
    expect(continuation).toContain("operation !== 'browser:confirm-ads-identity'");
    expect(continuation).toContain('hasPackageUiFreshTypedProof(');
    expect(continuation).toContain("visibleRuntime.purpose !== 'operator_full'");
    expect(continuation).toContain('sameExactStoreContext(visibleRuntime.context, context)');
    expect(continuation).toContain('storeMutationLane.registerAuthority({');
    expect(continuation).toContain('storeMutationLane.claim({');
    expect(continuation).toContain('storeMutationLane.release(claim)');
    expect(continuation).toContain("const expectedAdsStatus = 'pending';");

    const retryHandler = mainSource.slice(
      mainSource.indexOf('if (isCurrentAmazonAdsRetryContinuation('),
      mainSource.indexOf('if (preflightConnections.lingxingIdentityReadiness',
        mainSource.indexOf('if (isCurrentAmazonAdsRetryContinuation(')),
    );
    expect(retryHandler).toContain('withPackageUiVisibleLoginContinuationMutation(');
    const confirmHandler = mainSource.slice(
      mainSource.indexOf('async function handleConfirmBrowserLoginAdsIdentity('),
      mainSource.indexOf('async function handleBrowserLogout()'),
    );
    expect(confirmHandler).toContain('withPackageUiVisibleLoginContinuationMutation(');
  });

  it('accepts the explicitly audited Package UI suppressed-startup state before Ads continuation', () => {
    const continuation = mainSource.slice(
      mainSource.indexOf('async function withPackageUiVisibleLoginContinuationMutation'),
      mainSource.indexOf('async function retryCurrentAmazonAdsSession('),
    );
    expect(continuation).toContain('const packageUiSchedulerSnapshot = packageUiSchedulerAudit.snapshot();');
    expect(continuation).toContain('const packageUiSuppressedStartupSafe = Boolean(');
    expect(continuation).toContain('runtimeStatus.startupRecoveryConfirmed === false');
    expect(continuation).toContain("runtimeStatus.lifecycle === 'startup_unknown'");
    expect(continuation).toContain('runtimeStatus.automationStarted === false');
    expect(continuation).toContain('runtimeStatus.drainProven === false');
    expect(continuation).toContain('runtimeStatus.registryClosed === false');
    expect(continuation).toContain('packageUiSchedulerSnapshot.guards.startupReconcileSuppressed');
    expect(continuation).toContain('packageUiSchedulerSnapshot.guards.readOnlyInvariantPassed');
    expect(continuation).toContain('!packageUiSuppressedStartupSafe');
    expect(continuation).not.toContain('runtimeStatus.startupRecoveryConfirmed !== true');
  });

  it('retains the unconsumed pending Ads identity claim for retry instead of attempting a forbidden blocked-to-verified transition', () => {
    expect(mainSource).toContain('let pendingAmazonAdsIdentityRetry:');
    const initialAdsFailure = login.slice(
      login.indexOf('} catch (caught) {', login.indexOf('const adsIdentityClaim =')),
      login.indexOf('const adsPageEvidence =',
        login.indexOf('} catch (caught) {', login.indexOf('const adsIdentityClaim ='))),
    );
    expect(initialAdsFailure).toContain('pendingAmazonAdsIdentityRetry = {');
    expect(initialAdsFailure).not.toContain('blockAmazonAdsIdentity(adsIdentityClaim)');

    const retryAdmission = mainSource.slice(
      mainSource.indexOf('function isCurrentAmazonAdsRetryContinuation('),
      mainSource.indexOf('function assertCurrentAmazonAdsRetryAuthority('),
    );
    expect(retryAdmission).toContain("runtime.providerIdentityStatus.amazonAds !== 'pending'");
    expect(retryAdmission).toContain('pendingAmazonAdsIdentityRetry');

    const retry = mainSource.slice(
      mainSource.indexOf('async function retryCurrentAmazonAdsSession('),
      mainSource.indexOf('async function handleBrowserLogin('),
    );
    expect(retry).toContain('const retainedIdentity = pendingAmazonAdsIdentityRetry;');
    expect(retry).not.toContain('visibleBrowserRuntimeRegistry.claimAmazonAdsIdentity({');
    const retryFailure = retry.slice(retry.indexOf('} catch (caught) {'));
    expect(retryFailure).toContain('pendingAmazonAdsIdentityRetry = {');
    expect(retryFailure).not.toContain('blockAmazonAdsIdentity(identityClaim)');
  });

  it('requires a full reconnect after the visible Ads page closes or changes identity', () => {
    expect(rendererSource).toContain("amazonAdsConnection?.session?.failureCode === 'VISIBLE_BROWSER_CLOSED'");
    expect(rendererSource).toContain('Ads 可见窗口已关闭或身份已变化，请重新连接 ERP 与 Ads');
    const retryReadiness = rendererSource.slice(
      rendererSource.indexOf('const retryAdsReady = erpSessionConnected'),
      rendererSource.indexOf('const loginButtonView =', rendererSource.indexOf('const retryAdsReady = erpSessionConnected')),
    );
    expect(retryReadiness).toContain('!adsRetryRequiresFullReconnect');
    const downgrade = mainSource.slice(
      mainSource.indexOf('async function degradeVisibleLoginProvider('),
      mainSource.indexOf('function ensureAmazonAdsEnrollmentConnection('),
    );
    expect(downgrade).toContain('adsIdentityCandidate: _staleCandidate');
    expect(downgrade).toContain('...sessionWithoutCandidate');
  });

  it('does not downgrade an Ads runtime when a closing page has a trusted replacement in the same isolated context', () => {
    const liveness = mainSource.slice(
      mainSource.indexOf('function bindCompletedLoginPageLiveness('),
      mainSource.indexOf('async function degradeVisibleLoginProvider('),
    );
    expect(liveness).toContain('findTrustedLingxingProviderReplacementPage(');
    expect(liveness).toContain('controller.setActivePage?.(replacementPage);');
    expect(liveness).toContain('watchPage(provider, controller, replacementPage);');
    expect(liveness).toContain("recoverPendingAdsOrDegrade('可见浏览器已关闭。')");
  });

  it('does not bind pending Ads liveness to the controller ERP page before a trusted Ads document exists', () => {
    const liveness = mainSource.slice(
      mainSource.indexOf('function bindCompletedLoginPageLiveness('),
      mainSource.indexOf('async function degradeVisibleLoginProvider('),
    );
    const watch = liveness.slice(
      liveness.indexOf('const watch = ('),
      liveness.indexOf("watch('lingxing'"),
    );

    expect(watch).toContain('!isTrustedLingxingProviderUrl(provider, page.url())');
    expect(watch).toContain('return;');
  });

  it('keeps pending Ads writes blocked while briefly resolving a navigation replacement before downgrade', () => {
    const liveness = mainSource.slice(
      mainSource.indexOf('function bindCompletedLoginPageLiveness('),
      mainSource.indexOf('async function degradeVisibleLoginProvider('),
    );
    expect(liveness).toContain("provider !== 'amazon_ads'");
    expect(liveness).toContain("currentRuntime.providerIdentityStatus.amazonAds !== 'pending'");
    expect(liveness).toContain('await findTrustedLingxingProviderPageAfterPendingNavigation(');
    expect(liveness).toContain('controller.setActivePage?.(recoveredPage);');
    expect(liveness).toContain('watchPage(provider, controller, recoveredPage);');
    expect(liveness).toContain('if (adoptTrustedReplacement()) return;');
  });

  it('routes every staged and retry Ads page snapshot through the navigation-safe reader', () => {
    const reader = mainSource.slice(
      mainSource.indexOf('async function readLingxingPageState'),
      mainSource.indexOf('function adsSessionResultFromPageState'),
    );
    expect(reader).toContain('const state = await readLingxingAdsPageStateAfterNavigation(page);');
    expect(reader).not.toContain('page.evaluate(');
  });

  it('retries download-center readback only when navigation destroys the prior execution context', () => {
    const navigation = mainSource.slice(
      mainSource.indexOf('async function waitForDownloadCenterListPage('),
      mainSource.indexOf('async function finalizeLingxingDownloadCenterPage('),
    );
    expect(navigation).toContain('const state = await readLingxingAdsPageStateAfterNavigation(page);');

    const recovery = ssoSource.slice(
      ssoSource.indexOf('export async function readLingxingAdsPageStateAfterNavigation('),
      ssoSource.indexOf('export async function dismissLingxingAdsChangeAnnouncements('),
    );
    expect(recovery).toContain('isTransientLingxingAdsNavigationError(error)');
    expect(recovery).toContain("await page.waitForLoadState('domcontentloaded'");
    expect(recovery).toContain('throw error;');
  });

  it('freezes connection unbind after Package UI visible login and gives a Chinese next step', () => {
    expect(rendererSource).toContain('packageUiEvidenceMode && erpSessionConnected');
    expect(rendererSource).toContain('本轮正式验收登录已开始，连接映射已冻结；无需解绑，请继续重试或确认 Ads');
  });

  it('keeps the Main-managed saved credential available after a partial ERP-only login', () => {
    const persistenceStart = rendererSource.indexOf('setCredentialTone(session.adsSessionReady');
    const sessionPersistence = rendererSource.slice(
      persistenceStart,
      rendererSource.indexOf('setCredentialDraft((current)', persistenceStart),
    );
    expect(sessionPersistence).toContain("session.credentialPersistence === 'main_managed'");
    expect(sessionPersistence).toContain('setSavedPasswordAvailable(true)');
  });

  it('restores Ads-only retry from the same verified Main session after the workbench remounts', () => {
    expect(rendererSource).toContain('export function resolveAdsRetryCredentialAvailability(');
    const resolver = rendererSource.slice(
      rendererSource.indexOf('export function resolveAdsRetryCredentialAvailability('),
      rendererSource.indexOf('export function selectFreshBrowserLoginStoreContext('),
    );
    expect(resolver).toContain('input.loginSession?.erpSessionReady === true');
    expect(resolver).toContain('input.loginSession?.sessionIdentityVerified === true');
    expect(resolver).toContain("input.loginSession?.credentialPersistence === 'saved'");
    expect(resolver).toContain("input.loginSession?.credentialPersistence === 'main_managed'");
    expect(resolver).toContain('input.connectionUsername.trim()');

    const handler = rendererSource.slice(
      rendererSource.indexOf("async function handleLogin(action:"),
      rendererSource.indexOf('async function handleBindLingxingConnection()',
        rendererSource.indexOf("async function handleLogin(action:")),
    );
    expect(rendererSource).toContain('const adsRetryCredential = resolveAdsRetryCredentialAvailability({');
    expect(handler).toContain('savedCredentialUsername: effectiveSavedCredentialUsername');
    expect(handler).toContain('savedPasswordAvailable: effectiveSavedPasswordAvailable');
  });

  it('prevents a stale pre-login credential-status read from disabling Ads retry after Main saves the password', () => {
    expect(rendererSource).toContain('const credentialStatusRequestSequence = useRef(0);');
    expect(rendererSource).toContain('const statusRequestSequence = ++credentialStatusRequestSequence.current;');
    expect(rendererSource).toContain('statusRequestSequence !== credentialStatusRequestSequence.current');
    const sessionStart = rendererSource.indexOf('const session = await api.browserLogin(request) as BrowserLoginResult;');
    const successfulLogin = rendererSource.slice(
      sessionStart,
      rendererSource.indexOf('setLoginState(true, session.currentStore, session);', sessionStart),
    );
    expect(successfulLogin).toContain('credentialStatusRequestSequence.current += 1;');
  });

  it('refreshes the Main-managed credential after a rejected partial login without asking for the password again', () => {
    const refreshStart = rendererSource.indexOf('const refreshSavedCredentialStatus = useCallback(');
    const refresh = rendererSource.slice(
      refreshStart,
      rendererSource.indexOf('useEffect(() => {', refreshStart),
    );
    expect(refreshStart).toBeGreaterThan(-1);
    expect(refresh).toContain('await api.getSavedLoginCredentialStatus()');
    expect(refresh).toContain("saved.credentialState === 'encrypted_ready'");
    expect(refresh).toContain('setSavedPasswordAvailable(passwordAvailable)');
    expect(refresh).toContain("credentialSource: 'saved'");
    expect(refresh).toContain("password: ''");

    const handlerStart = rendererSource.indexOf("async function handleLogin(action:");
    const handler = rendererSource.slice(
      handlerStart,
      rendererSource.indexOf('async function handleBindLingxingConnection()', handlerStart),
    );
    const rejected = handler.slice(
      handler.indexOf('} catch (caught) {'),
      handler.indexOf('} finally {'),
    );
    expect(rejected).toContain('await refreshSavedCredentialStatus({ force: true });');
  });

  it('refreshes the current Main store authority before every browser reconnect without accepting another store', () => {
    const handler = rendererSource.slice(
      rendererSource.indexOf("async function handleLogin(action:"),
      rendererSource.indexOf('async function handleBindLingxingConnection()',
        rendererSource.indexOf("async function handleLogin(action:")),
    );
    const apiRead = handler.indexOf('await api.getActiveStoreWorkspaceView()');
    const requestBuild = handler.indexOf('const request = buildBrowserLoginRequest({');
    expect(apiRead).toBeGreaterThan(-1);
    expect(apiRead).toBeLessThan(requestBuild);
    expect(handler).toContain('selectFreshBrowserLoginStoreContext(');

    const selector = rendererSource.slice(
      rendererSource.indexOf('export function selectFreshBrowserLoginStoreContext('),
      rendererSource.indexOf('function formatConnectionSuccessTime('),
    );
    expect(selector).toContain('candidate.storeId !== expected.storeId');
    expect(selector).toContain('candidate.browserProfileId !== expected.browserProfileId');
    expect(selector).toContain('candidate.marketplace !== expected.marketplace');
    expect(selector).toContain('candidate.currency !== expected.currency');
    expect(selector).toContain('candidate.businessTimezone !== expected.businessTimezone');
    expect(selector).toContain('return candidate;');
  });

  it('records completed Package UI fresh typed proof for only the verified store and username before publishing the staged result', () => {
    expect(mainSource).toContain('let packageUiFreshTypedProof:');
    expect(mainSource).toContain('function hasPackageUiFreshTypedProof(');
    const statusReader = mainSource.slice(
      mainSource.indexOf('function handleGetSavedLoginCredentialStatus()'),
      mainSource.indexOf('async function readLingxingPageState'),
    );
    expect(statusReader).toContain('!hasPackageUiFreshTypedProof(');

    const credentialSave = login.indexOf('saveLoginCredentials(');
    const proofCommit = login.indexOf('packageUiFreshTypedProof = Object.freeze({', credentialSave);
    const stagedResult = login.indexOf('const loginResult: BrowserLoginResult = {');
    expect(credentialSave).toBeGreaterThan(-1);
    expect(proofCommit).toBeGreaterThan(credentialSave);
    expect(proofCommit).toBeLessThan(stagedResult);
    expect(login.slice(proofCommit, stagedResult)).toContain('storeId: String(loginContext.storeId)');
    expect(login.slice(proofCommit, stagedResult)).toContain('username: username.trim()');
  });

  it('translates the Package UI post-login connection-mutation block into an actionable Chinese reason', () => {
    expect(rendererSource).toContain('正式验收登录开始后不允许修改连接映射');
    expect(rendererSource).toContain('请保持当前绑定并完成 Ads 确认');
  });

  it('selects and reads back the configured store after the download-center page becomes ready', () => {
    const navigation = mainSource.slice(
      mainSource.indexOf('async function waitForDownloadCenterListPage('),
      mainSource.indexOf('async function waitForCreateReportPage('),
    );
    expect(navigation).toContain('async function finalizeLingxingDownloadCenterPage(');
    expect(navigation).toContain('await selectOnlyLingxingAdsStore(page, storeName);');
    expect(navigation).toContain('storeName: string');
    expect(login).toContain('lingxingStoreAlias,\n    );');
  });

  it('enters Ads through ERP before navigating to the download center', () => {
    const navigation = mainSource.slice(
      mainSource.indexOf('async function navigateToLingxingDownloadCenter('),
      mainSource.indexOf('async function waitForCreateReportPage('),
    );
    const adsOriginGuard = navigation.indexOf("new URL(page.url()).origin !== 'https://ads.lingxing.com'");
    const erpAdsEntry = navigation.indexOf('page = await openLingxingAdsFromErp(controller);');
    const downloadCenterGoto = navigation.indexOf('await page.goto(model.candidateUrls[0]');

    expect(adsOriginGuard).toBeGreaterThan(-1);
    expect(erpAdsEntry).toBeGreaterThan(adsOriginGuard);
    expect(downloadCenterGoto).toBeGreaterThan(erpAdsEntry);
  });

  it('navigates initial Ads recognition to the download center before selecting the configured store', () => {
    const initialRecognition = login.slice(
      login.indexOf('let lingxingStableExternalAccountId'),
      login.indexOf('assertBrowserLoginAttempt(attemptId, loginContext);', login.indexOf('let lingxingStableExternalAccountId')),
    );
    const profileEvidence = initialRecognition.indexOf('await readLingxingAdsProfileEvidence(');
    const downloadCenter = initialRecognition.indexOf('await navigateVerifiedLingxingDownloadCenter();');
    const stableIdentity = initialRecognition.indexOf('resolveLingxingStableIdentityFromAdsProfile({');

    expect(profileEvidence).toBeGreaterThan(-1);
    expect(downloadCenter).toBeGreaterThan(profileEvidence);
    expect(downloadCenter).toBeLessThan(stableIdentity);
    expect(initialRecognition.slice(profileEvidence, stableIdentity))
      .not.toContain('await selectOnlyLingxingAdsStore(lingxingAdsPage');
  });

  it('navigates Ads-only retry to the download center before accepting its store evidence', () => {
    const retry = mainSource.slice(
      mainSource.indexOf('async function retryCurrentAmazonAdsSession('),
      mainSource.indexOf('async function handleBrowserLogin('),
    );
    const profileEvidence = retry.indexOf('await readLingxingAdsProfileEvidence(');
    const downloadCenter = retry.indexOf('await navigateToLingxingDownloadCenter(');
    const continuationIdentity = retry.indexOf('resolveLingxingStableIdentityFromVerifiedContinuation({');

    expect(profileEvidence).toBeGreaterThan(-1);
    expect(downloadCenter).toBeGreaterThan(profileEvidence);
    expect(downloadCenter).toBeLessThan(continuationIdentity);
    expect(retry.slice(profileEvidence, continuationIdentity))
      .not.toContain('await selectOnlyLingxingAdsStore(adsPage, storeAlias);');
  });

  it('revalidates an Ads confirmation on the download center before accepting the candidate', () => {
    const confirmation = mainSource.slice(
      mainSource.indexOf('async function handleConfirmBrowserLoginAdsIdentity('),
      mainSource.indexOf('async function handleBrowserLogout('),
    );
    const controller = confirmation.indexOf("browserControllerFromVisibleRuntime(runtime, 'amazon_ads')");
    const downloadCenter = confirmation.indexOf('await navigateToLingxingDownloadCenter(');
    const observed = confirmation.indexOf('await readLingxingAdsProfileEvidence(');

    expect(controller).toBeGreaterThan(-1);
    expect(downloadCenter).toBeGreaterThan(controller);
    expect(observed).toBeGreaterThan(downloadCenter);
    expect(confirmation.slice(controller, observed))
      .not.toContain('await selectOnlyLingxingAdsStore(');
  });

  it('refreshes profile identity from the exact SSO-observed Ads page before confirmation readback', () => {
    const pendingType = mainSource.slice(
      mainSource.indexOf('let pendingAmazonAdsIdentityConfirmation:'),
      mainSource.indexOf('let pendingAmazonAdsIdentityRetry:'),
    );
    expect(pendingType).toContain('profileEvidenceUrl: string;');

    const pendingCandidate = login.slice(
      login.indexOf('pendingAmazonAdsIdentityConfirmation = {'),
      login.indexOf('pendingAmazonAdsIdentityRetry = null;',
        login.indexOf('pendingAmazonAdsIdentityConfirmation = {')),
    );
    expect(pendingCandidate).toContain('profileEvidenceUrl: visibleAdsState.url,');

    const confirmation = mainSource.slice(
      mainSource.indexOf('async function handleConfirmBrowserLoginAdsIdentity('),
      mainSource.indexOf('async function handleBrowserLogout('),
    );
    const boundUrl = confirmation.indexOf('const profileEvidenceUrl = new URL(pending.profileEvidenceUrl);');
    const refresh = confirmation.indexOf('await adsController.navigate(profileEvidenceUrl.href);');
    const downloadCenter = confirmation.indexOf('await navigateToLingxingDownloadCenter(');
    const observed = confirmation.indexOf('await readLingxingAdsProfileEvidence(');
    expect(boundUrl).toBeGreaterThan(-1);
    expect(refresh).toBeGreaterThan(boundUrl);
    expect(downloadCenter).toBeGreaterThan(refresh);
    expect(observed).toBeGreaterThan(downloadCenter);
    expect(confirmation.slice(boundUrl, refresh)).toContain("profileEvidenceUrl.origin !== 'https://ads.lingxing.com'");
    expect(confirmation.slice(boundUrl, refresh)).toContain('/\\/restartLogin(?:\\/|$)/i.test(profileEvidenceUrl.pathname)');
  });

  it('binds an Ads-only retry candidate to the profile page observed before download-center navigation', () => {
    const retry = mainSource.slice(
      mainSource.indexOf('async function retryCurrentAmazonAdsSession('),
      mainSource.indexOf('async function handleBrowserLogin('),
    );
    const observedPage = retry.indexOf('const visibleState = await readLingxingPageState(adsPage);');
    const profileReadback = retry.indexOf('const detected = await readLingxingAdsProfileEvidence(adsPage, storeAlias);');
    const downloadCenter = retry.indexOf('await navigateToLingxingDownloadCenter(');
    const pendingCandidate = retry.indexOf('pendingAmazonAdsIdentityConfirmation = {');
    expect(observedPage).toBeGreaterThan(-1);
    expect(profileReadback).toBeGreaterThan(observedPage);
    expect(downloadCenter).toBeGreaterThan(profileReadback);
    expect(pendingCandidate).toBeGreaterThan(downloadCenter);
    expect(retry.slice(pendingCandidate, retry.indexOf('pendingAmazonAdsIdentityRetry = null;', pendingCandidate)))
      .toContain('profileEvidenceUrl: visibleState.url,');
  });

  it('enrolls the first confirmed Ads identity without treating it as a post-binding identity change', () => {
    const confirmation = mainSource.slice(
      mainSource.indexOf('async function handleConfirmBrowserLoginAdsIdentity('),
      mainSource.indexOf('async function handleBrowserLogout('),
    );
    expect(confirmation).toContain('enrollConfirmedAmazonAdsConnection({');
    expect(confirmation).not.toContain('state.storeRepo!.updateConnection({');

    const enrollment = mainSource.slice(
      mainSource.indexOf('function enrollConfirmedAmazonAdsConnection('),
      mainSource.indexOf('async function handleConfirmBrowserLoginAdsIdentity('),
    );
    expect(enrollment).toContain("provider = 'amazon_ads'");
    expect(enrollment).toContain('external_account_id IS NULL');
    expect(enrollment).toContain('normalized_external_account_id IS NULL');
    expect(enrollment).toContain('updated_at = @expectedUpdatedAt');
    expect(enrollment).toContain("normalizeProviderExternalAccountId('amazon_ads', input.externalAccountId)");
    expect(enrollment).toContain('if (updated.changes !== 1)');
    expect(enrollment).not.toContain('connection_identity_changed');
  });

  it('keeps copied profile-bound scheduler history fail-closed in Package UI read-only mode', () => {
    const readOnlyProjection = mainSource.slice(
      mainSource.indexOf('function readPackageUiStoreCollectionSchedule('),
      mainSource.indexOf('function authorizePackageUiDatabaseCheckpoint('),
    );
    expect(readOnlyProjection).toContain('state.storeCoordinator.assertActiveStoreContext(contextInput)');
    expect(readOnlyProjection).toContain('state.storeRuntimeConfigService.get(context).current');
    expect(readOnlyProjection).toContain("state: 'failed'");
    expect(readOnlyProjection).toContain('enabled: false');
    expect(readOnlyProjection).toContain('受保护的采集历史不能跨隔离环境解密');
    expect(readOnlyProjection).toContain('真实采集和广告执行保持阻断');
    expect(readOnlyProjection).not.toContain('storeCollectionSchedulerReadModel');

    const schedulerRegistration = mainSource.slice(
      mainSource.indexOf('  registerStoreCollectionSchedulerIpcHandlers('),
      mainSource.indexOf('  registerStoreScopedObjectsIpcHandlers('),
    );
    expect(schedulerRegistration).toContain(
      'get: (context) => readPackageUiStoreCollectionSchedule(context)',
    );
    expect(schedulerRegistration).toContain(': state.storeCollectionSchedulerReadModel');
  });
});
