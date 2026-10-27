import * as crypto from 'crypto';
import type { Page } from 'playwright';
import { BrowserController, type BrowserLease } from '@amazon-ai-ops/browser-worker';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { BrowserLoginRequest, BrowserLoginResult } from '../shared/login-contract';
import { runtimeLog } from './runtime-log-adapter';
import { requireBrowserLoginProviderConnections } from './browser-login-provider-connections';
import { createStoreScopedLoginCredentialStore, resolveSavedLoginPassword } from './login-credentials';
import { bindPendingLingxingAdsNewPageAdoption, bindPendingLingxingAdsPageCloseOnlyLiveness, findTrustedLingxingProviderPageAfterPendingNavigation, findTrustedLingxingProviderReplacementPage, isLingxingProviderExplicitlyLoggedOutPage, isTrustedLingxingProviderUrl, openLingxingAdsFromErp, readLingxingAdsProfileEvidence, resolveLingxingStableIdentityFromVerifiedContinuation } from './lingxing-ads-sso';
import { type VisibleBrowserRuntime } from './visible-browser-runtime-registry';
import { adsSessionResultFromPageState, browserControllerFromVisibleRuntime, degradeVisibleLoginProvider, ensureAmazonAdsEnrollmentConnection, readLingxingPageState, sameExactStoreContext } from './main-browser-session-runtime';
import { publishStoreContextChanged } from './main-store-context-runtime';
import { isRecoverableAmazonAdsEntryFailure, reopenAmazonAdsControllerForRetry, resumePolicyGrantDispatchesAfterVerifiedAdsSession, withAdmittedVisibleBrowserOperation, withPackageUiVisibleLoginContinuationMutation } from './main-ads-retry-support-runtime';
import { navigateToLingxingDownloadCenter } from './main-download-navigation-runtime';
import { readDownloadCenterPageModel } from './main-download-page-model-runtime';
import { getControllerPageOrThrow } from './main-download-automation-runtime';
import type { AdsSessionResult, CurrentAmazonAdsRetryConnections } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export async function continuePendingAmazonAdsIdentityRecognition(
  runtimeId: string,
  context: StoreContextEnvelope,
): Promise<void> {
  const mainRuntimeContext = getMainRuntimeContext();
  if (mainRuntimeContext.pendingAmazonAdsIdentityRecognitionContinuations.has(runtimeId)) return;
  mainRuntimeContext.pendingAmazonAdsIdentityRecognitionContinuations.add(runtimeId);
  try {
    const runtime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
    const retainedIdentity = mainRuntimeContext.pendingAmazonAdsIdentityRetry;
    if (!runtime
      || runtime.runtimeId !== runtimeId
      || runtime.providerIdentityStatus.lingxing !== 'verified'
      || runtime.providerIdentityStatus.amazonAds !== 'pending'
      || !sameExactStoreContext(runtime.context, context)
      || !retainedIdentity
      || retainedIdentity.runtimeId !== runtimeId
      || retainedIdentity.runtimeEpoch !== runtime.epoch
      || !sameExactStoreContext(retainedIdentity.context, context)
      || !mainRuntimeContext.state.configurationBus
      || !mainRuntimeContext.state.storeRepo
      || !mainRuntimeContext.state.storeCoordinator
      || !mainRuntimeContext.state.executionAuthorityService
      || !mainRuntimeContext.state.storeCollectionMainRuntime) return;
    const activeContext = mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(context);
    mainRuntimeContext.state.executionAuthorityService.assertStoreMutationAllowed(activeContext);
    const connections = requireBrowserLoginProviderConnections(
      mainRuntimeContext.state.storeRepo.listConnections(activeContext.storeId),
    );
    if (!connections.lingxing.accountLabel?.trim()) return;
    const request: BrowserLoginRequest = {
      storeContext: context,
      username: connections.lingxing.accountLabel,
      credentialSource: 'saved',
      rememberPassword: true,
    };
    if (!isCurrentAmazonAdsRetryContinuation(request, activeContext)) return;
    await executeCurrentAmazonAdsRetryContinuation(
      request,
      activeContext,
      {
        ...connections,
        amazon_ads: ensureAmazonAdsEnrollmentConnection(activeContext, connections.amazon_ads),
      },
    );
  } catch (error) {
    const latestRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
    if (latestRuntime
      && latestRuntime.runtimeId === runtimeId
      && latestRuntime.providerIdentityStatus.amazonAds === 'pending'
      && sameExactStoreContext(latestRuntime.context, context)) {
      runtimeLog.warn('[StoreSession] adopted pending Ads page still requires operator retry',
        error instanceof Error ? error.message : String(error));
      mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
    }
  } finally {
    mainRuntimeContext.pendingAmazonAdsIdentityRecognitionContinuations.delete(runtimeId);
  }
}

export function bindCompletedLoginPageLiveness(runtimeId: string, context: StoreContextEnvelope): void {
  const mainRuntimeContext = getMainRuntimeContext();
  const runtime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  if (!runtime || runtime.runtimeId !== runtimeId || !sameExactStoreContext(runtime.context, context)) return;
  type LivenessController = Readonly<{
    getPage(): unknown;
    getContext(): unknown;
    setActivePage?: (page: Page) => void;
  }>;
  const replacementCandidates = (controller: LivenessController): Page[] => {
    const activePage = controller.getPage() as Page | null | undefined;
    let contextPages: Page[] = [];
    try {
      const browserContext = controller.getContext() as { pages?: () => unknown[] } | null | undefined;
      contextPages = (browserContext?.pages?.() ?? []) as Page[];
    } catch {
      contextPages = [];
    }
    return activePage ? [activePage, ...contextPages] : contextPages;
  };
  const watchPage = (
    provider: 'lingxing' | 'amazon_ads',
    controller: LivenessController,
    page: Page,
  ): void => {
    const bindingKey = `${runtimeId}:${provider}`;
    const bindings = mainRuntimeContext.completedLoginLivenessBindings.get(page) ?? new Set<string>();
    if (bindings.has(bindingKey)) return;
    bindings.add(bindingKey);
    mainRuntimeContext.completedLoginLivenessBindings.set(page, bindings);
    const adoptTrustedReplacement = (): boolean => {
      const replacementPage = findTrustedLingxingProviderReplacementPage(
        provider,
        page,
        replacementCandidates(controller),
      );
      if (!replacementPage) return false;
      controller.setActivePage?.(replacementPage);
      watchPage(provider, controller, replacementPage);
      return true;
    };
    let pendingNavigationRecoveryStarted = false;
    const recoverPendingAdsOrDegrade = (reason: string): void => {
      const currentRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
      if (provider !== 'amazon_ads'
        || !currentRuntime
        || currentRuntime.runtimeId !== runtimeId
        || !sameExactStoreContext(currentRuntime.context, context)
        || currentRuntime.providerIdentityStatus.amazonAds !== 'pending') {
        void degradeVisibleLoginProvider(provider, runtimeId, context, reason);
        return;
      }
      if (pendingNavigationRecoveryStarted) return;
      pendingNavigationRecoveryStarted = true;
      void (async () => {
        const recoveredPage = await findTrustedLingxingProviderPageAfterPendingNavigation(
          provider,
          page,
          () => replacementCandidates(controller),
        );
        const latestRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
        if (!latestRuntime
          || latestRuntime.runtimeId !== runtimeId
          || !sameExactStoreContext(latestRuntime.context, context)
          || latestRuntime.providerIdentityStatus.amazonAds !== 'pending') return;
        if (recoveredPage) {
          pendingNavigationRecoveryStarted = false;
          controller.setActivePage?.(recoveredPage);
          watchPage(provider, controller, recoveredPage);
          return;
        }
        await degradeVisibleLoginProvider(provider, runtimeId, context, reason);
      })();
    };
    let providerStateInspectionRunning = false;
    let providerStateInspectionPending = false;
    const inspectProviderState = (): void => {
      if (page.isClosed()) return;
      if (providerStateInspectionRunning) {
        providerStateInspectionPending = true;
        return;
      }
      providerStateInspectionRunning = true;
      void readLingxingPageState(page)
        .then((pageState) => {
          if (isLingxingProviderExplicitlyLoggedOutPage(provider, pageState)) {
            void degradeVisibleLoginProvider(provider, runtimeId, context, '页面已退回登录状态。');
          }
        })
        .catch(() => {
          void degradeVisibleLoginProvider(provider, runtimeId, context, '页面登录状态无法回读。');
        })
        .finally(() => {
          providerStateInspectionRunning = false;
          if (providerStateInspectionPending) {
            providerStateInspectionPending = false;
            inspectProviderState();
          }
        });
    };
    page.once('close', () => {
      if (adoptTrustedReplacement()) return;
      recoverPendingAdsOrDegrade('可见浏览器已关闭。');
    });
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      if (!isTrustedLingxingProviderUrl(provider, frame.url())) {
        if (isLingxingProviderExplicitlyLoggedOutPage(provider, { url: frame.url() })) {
          void degradeVisibleLoginProvider(provider, runtimeId, context, '页面已退回登录状态。');
          return;
        }
        if (adoptTrustedReplacement()) return;
        recoverPendingAdsOrDegrade('页面身份已变化。');
        return;
      }
      inspectProviderState();
    });
    page.on('domcontentloaded', inspectProviderState);
    inspectProviderState();
  };
  const watch = (
    provider: 'lingxing' | 'amazon_ads',
    controller?: LivenessController,
  ): void => {
    const page = controller?.getPage() as Page | null | undefined;
    if (!controller || !page) return;
    
    
    
    
    
    if (!isTrustedLingxingProviderUrl(provider, page.url())) {
      if (provider === 'amazon_ads'
        && runtime.providerIdentityStatus.amazonAds === 'pending') {
        const closeOnlyBindingKey = `${runtimeId}:${provider}:close-only`;
        const bindings = mainRuntimeContext.completedLoginLivenessBindings.get(page) ?? new Set<string>();
        if (!bindings.has(closeOnlyBindingKey)) {
          bindings.add(closeOnlyBindingKey);
          mainRuntimeContext.completedLoginLivenessBindings.set(page, bindings);
          const pendingAdsBrowserContext = controller.getContext() as Readonly<{
            on?: (event: 'page', listener: (page: Page) => void) => unknown;
            off?: (event: 'page', listener: (page: Page) => void) => unknown;
          }> | null | undefined;
          if (pendingAdsBrowserContext
            && typeof pendingAdsBrowserContext.on === 'function'
            && typeof pendingAdsBrowserContext.off === 'function') {
            bindPendingLingxingAdsNewPageAdoption({
              observedPage: page,
              context: pendingAdsBrowserContext as never,
              readCandidates: () => replacementCandidates(controller),
              onTrustedPage: async (replacementPage) => {
                const latestRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
                if (!latestRuntime
                  || latestRuntime.runtimeId !== runtimeId
                  || !sameExactStoreContext(latestRuntime.context, context)
                  || latestRuntime.providerIdentityStatus.amazonAds !== 'pending') return;
                try {
                  const adoptedPageState = await readLingxingPageState(replacementPage);
                  if (isLingxingProviderExplicitlyLoggedOutPage(provider, adoptedPageState)) {
                    await degradeVisibleLoginProvider(
                      provider,
                      runtimeId,
                      context,
                      '页面已退回登录状态。',
                    );
                    return;
                  }
                } catch {
                  await degradeVisibleLoginProvider(
                    provider,
                    runtimeId,
                    context,
                    '页面登录状态无法回读。',
                  );
                  return;
                }
                controller.setActivePage?.(replacementPage);
                watchPage(provider, controller, replacementPage);
                await continuePendingAmazonAdsIdentityRecognition(runtimeId, context);
              },
              onUnsafeCandidates: (reason) => degradeVisibleLoginProvider(
                provider,
                runtimeId,
                context,
                reason,
              ),
            });
          }
          bindPendingLingxingAdsPageCloseOnlyLiveness({
            page,
            readCandidates: () => replacementCandidates(controller),
            onTrustedReplacement: (replacementPage) => {
              const latestRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
              if (!latestRuntime
                || latestRuntime.runtimeId !== runtimeId
                || !sameExactStoreContext(latestRuntime.context, context)
                || latestRuntime.providerIdentityStatus.amazonAds !== 'pending') return;
              controller.setActivePage?.(replacementPage);
              watchPage(provider, controller, replacementPage);
            },
            onClosed: (reason) => degradeVisibleLoginProvider(
              provider,
              runtimeId,
              context,
              reason,
            ),
          });
        }
      }
      return;
    }
    watchPage(provider, controller, page);
  };
  watch('lingxing', runtime.controllers.lingxing);
  watch('amazon_ads', runtime.controllers.amazonAds);
}

export function isCurrentAmazonAdsRetryContinuation(
  request: BrowserLoginRequest,
  context: StoreContextEnvelope,
): boolean {
  const mainRuntimeContext = getMainRuntimeContext();
  if (request.credentialSource !== 'saved'
    || request.rememberPassword !== true
    || !mainRuntimeContext.state.storeRepo
    || !mainRuntimeContext.state.isLoggedIn
    || mainRuntimeContext.state.loginSession?.erpSessionReady !== true
    || mainRuntimeContext.state.loginSession.adsSessionReady === true
    || mainRuntimeContext.state.loginSession.sessionIdentityVerified !== true
    || mainRuntimeContext.pendingAmazonAdsIdentityConfirmation !== null) {
    return false;
  }
  const runtime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  const retainedIdentity = mainRuntimeContext.pendingAmazonAdsIdentityRetry;
  const lingxingSession = mainRuntimeContext.state.storeRepo.getSessionMetadata(context.storeId, 'lingxing');
  if (!runtime
    || runtime.purpose !== 'operator_full'
    || runtime.providerIdentityStatus.lingxing !== 'verified'
    || runtime.providerIdentityStatus.amazonAds !== 'pending'
    || !runtime.controllers.amazonAds
    || !retainedIdentity
    || retainedIdentity.runtimeId !== runtime.runtimeId
    || retainedIdentity.runtimeEpoch !== runtime.epoch
    || !sameExactStoreContext(retainedIdentity.context, context)
    || !sameExactStoreContext(runtime.context, context)
    || !lingxingSession
    || lingxingSession.status !== 'ready'
    || lingxingSession.browserProfileId !== context.browserProfileId
    || lingxingSession.sessionGeneration !== context.sessionGeneration
    || !lingxingSession.accountLabel?.trim()
    || lingxingSession.accountLabel.normalize('NFKC').trim().toLocaleLowerCase()
      !== request.username.normalize('NFKC').trim().toLocaleLowerCase()) {
    return false;
  }
  return true;
}

export function assertCurrentAmazonAdsRetryAuthority(
  runtimeId: string,
  runtimeEpoch: number,
  context: StoreContextEnvelope,
  controller: BrowserController,
  lease: BrowserLease,
): VisibleBrowserRuntime {
  const mainRuntimeContext = getMainRuntimeContext();
  mainRuntimeContext.browserOperationLeases.assertCurrent(lease);
  const active = mainRuntimeContext.state.storeCoordinator?.assertActiveStoreContext(context);
  const runtime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  if (!active
    || !runtime
    || runtime.runtimeId !== runtimeId
    || runtime.epoch !== runtimeEpoch
    || runtime.purpose !== 'operator_full'
    || runtime.providerIdentityStatus.lingxing !== 'verified'
    || runtime.providerIdentityStatus.amazonAds !== 'pending'
    || !sameExactStoreContext(runtime.context, active)
    || browserControllerFromVisibleRuntime(runtime, 'amazon_ads') !== controller
    || mainRuntimeContext.state.loginSession?.erpSessionReady !== true
    || mainRuntimeContext.state.loginSession.adsSessionReady === true) {
    throw new Error('Ads 重试期间当前店铺或浏览器身份已变化，操作已阻断。');
  }
  return runtime;
}

export function publishAmazonAdsRetryResult(
  context: StoreContextEnvelope,
  runtimeId: string,
  result: BrowserLoginResult,
): BrowserLoginResult {
  const mainRuntimeContext = getMainRuntimeContext();
  mainRuntimeContext.state.isLoggedIn = true;
  mainRuntimeContext.state.currentStore = result.currentStore;
  mainRuntimeContext.state.loginSession = result;
  const view = mainRuntimeContext.state.storeCoordinator?.getActiveStoreWorkspaceView();
  if (!view || !sameExactStoreContext(view.context, context)) {
    throw new Error('Ads 重试完成后的店铺 Authority 回读不一致，操作已阻断。');
  }
  publishStoreContextChanged(view);
  bindCompletedLoginPageLiveness(runtimeId, context);
  mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
  return result;
}

export async function retryCurrentAmazonAdsSession(
  request: BrowserLoginRequest,
  context: StoreContextEnvelope,
  connections: CurrentAmazonAdsRetryConnections,
  lease: BrowserLease,
): Promise<BrowserLoginResult> {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.configurationBus || !mainRuntimeContext.state.storeRepo || !mainRuntimeContext.state.db || !mainRuntimeContext.state.storeCoordinator) {
    throw new Error('Ads 重试所需的本机仓储尚未就绪。');
  }
  const initialRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  const controller = initialRuntime
    ? browserControllerFromVisibleRuntime(initialRuntime, 'amazon_ads')
    : null;
  if (!initialRuntime || !controller) {
    throw new Error('当前店铺的 Ads 可见浏览器不存在，请重新连接 ERP 与 Ads。');
  }
  const retainedIdentity = mainRuntimeContext.pendingAmazonAdsIdentityRetry;
  if (!retainedIdentity
    || retainedIdentity.runtimeId !== initialRuntime.runtimeId
    || retainedIdentity.runtimeEpoch !== initialRuntime.epoch
    || !sameExactStoreContext(retainedIdentity.context, context)) {
    throw new Error('当前 Ads 重试身份已失效，请重新连接 ERP 与 Ads。');
  }
  assertCurrentAmazonAdsRetryAuthority(
    initialRuntime.runtimeId,
    initialRuntime.epoch,
    context,
    controller,
    lease,
  );
  const currentSession = mainRuntimeContext.state.loginSession!;
  const storeAlias = connections.lingxing.collectionStoreName;
  if (!storeAlias || !connections.lingxing.accountLabel) {
    throw new Error('当前领星连接缺少登录账号或美国站店铺映射，Ads 重试已阻断。');
  }
  let adsVisibleSession: AdsSessionResult | null = currentSession.adsUrl
    ? {
        entryMode: 'erp_ads_entry',
        adsUrl: currentSession.adsUrl,
        adsTitle: currentSession.adsTitle || currentSession.adsUrl,
      }
    : null;
  const identityClaim = retainedIdentity.claim;
  let identityClaimSettled = false;

  try {
    let adsPage: Page;
    try {
      adsPage = await openLingxingAdsFromErp(controller);
    } catch (entryError) {
      if (!isRecoverableAmazonAdsEntryFailure(entryError)) throw entryError;
      const password = resolveSavedLoginPassword(
        createStoreScopedLoginCredentialStore(mainRuntimeContext.state.configurationBus, context.storeId),
        mainRuntimeContext.electronLoginCredentialCipher,
        request.username,
      );
      adsPage = await reopenAmazonAdsControllerForRetry({
        controller,
        runtimeId: initialRuntime.runtimeId,
        username: request.username,
        password,
      });
    }
    const visibleState = await readLingxingPageState(adsPage);
    adsVisibleSession = adsSessionResultFromPageState(visibleState);
    assertCurrentAmazonAdsRetryAuthority(
      initialRuntime.runtimeId,
      initialRuntime.epoch,
      context,
      controller,
      lease,
    );
    const detected = await readLingxingAdsProfileEvidence(adsPage, storeAlias);
    await navigateToLingxingDownloadCenter(
      controller,
      readDownloadCenterPageModel(),
      storeAlias,
    );
    adsPage = getControllerPageOrThrow(controller);
    const detectedAdsSession = adsSessionResultFromPageState(await readLingxingPageState(adsPage));
    assertCurrentAmazonAdsRetryAuthority(
      initialRuntime.runtimeId,
      initialRuntime.epoch,
      context,
      controller,
      lease,
    );

    if (connections.lingxingIdentityReadiness === 'enrollment_pending') {
      const stableExternalAccountId = resolveLingxingStableIdentityFromVerifiedContinuation({
        accountLabel: connections.lingxing.accountLabel,
        collectionStoreName: storeAlias,
        evidence: detected,
        continuation: {
          credentialSource: 'saved',
          credentialPersistence: currentSession.credentialPersistence,
          sessionIdentityVerified: currentSession.sessionIdentityVerified,
          username: request.username,
        },
      });
      const observedAt = new Date().toISOString();
      mainRuntimeContext.state.db.transaction(() => {
        const connection = mainRuntimeContext.state.storeRepo!.enrollLingxingStableExternalAccount({
          id: connections.lingxing.id,
          storeId: context.storeId,
          provider: 'lingxing',
          externalAccountId: stableExternalAccountId,
          expectedUpdatedAt: connections.lingxing.updatedAt,
        });
        mainRuntimeContext.state.storeRepo!.saveSessionMetadata({
          storeId: context.storeId,
          browserProfileId: context.browserProfileId,
          provider: 'lingxing',
          status: 'ready',
          sessionGeneration: context.sessionGeneration,
          observedAt,
          accountLabel: connection.accountLabel,
          externalAccountId: connection.externalAccountId,
          verifiedAt: observedAt,
        });
      })();
      assertCurrentAmazonAdsRetryAuthority(
        initialRuntime.runtimeId,
        initialRuntime.epoch,
        context,
        controller,
        lease,
      );
    }

    if (connections.amazonAdsIdentityReadiness === 'configured') {
      if (connections.amazon_ads.normalizedExternalAccountId !== detected.externalAccountId) {
        throw new Error('领星 Ads 美国站店铺身份与当前店铺绑定不一致，真实广告执行已阻断。');
      }
      const observedAt = new Date().toISOString();
      const readyConnection = mainRuntimeContext.state.db.transaction(() => {
        const connection = mainRuntimeContext.state.storeRepo!.updateConnection({
          id: connections.amazon_ads.id,
          storeId: context.storeId,
          status: 'ready',
          lastVerifiedAt: observedAt,
          lastFailureCode: '',
          expectedUpdatedAt: connections.amazon_ads.updatedAt,
        });
        mainRuntimeContext.state.storeRepo!.saveSessionMetadata({
          storeId: context.storeId,
          browserProfileId: context.browserProfileId,
          provider: 'amazon_ads',
          status: 'ready',
          sessionGeneration: context.sessionGeneration,
          observedAt,
          accountLabel: connection.accountLabel,
          externalAccountId: connection.externalAccountId,
          verifiedAt: observedAt,
        });
        return connection;
      })();
      mainRuntimeContext.visibleBrowserRuntimeRegistry.verifyAmazonAdsIdentity(identityClaim, readyConnection);
      identityClaimSettled = true;
      mainRuntimeContext.pendingAmazonAdsIdentityRetry = null;
      const {
        adsIdentityCandidate: _candidate,
        adsUnavailableReason: _reason,
        adsEntryMode: _entryMode,
        adsUrl: _adsUrl,
        adsTitle: _adsTitle,
        ...sessionBase
      } = currentSession;
      return publishAmazonAdsRetryResult(context, initialRuntime.runtimeId, {
        ...sessionBase,
        ok: true,
        currentStore: mainRuntimeContext.state.currentStore,
        erpSessionReady: true,
        adsSessionReady: true,
        adsEntryMode: detectedAdsSession.entryMode,
        adsUrl: detectedAdsSession.adsUrl,
        adsTitle: detectedAdsSession.adsTitle,
      });
    }

    const token = crypto.randomUUID();
    mainRuntimeContext.pendingAmazonAdsIdentityConfirmation = {
      token,
      context: Object.freeze({ ...context }),
      runtimeId: initialRuntime.runtimeId,
      runtimeEpoch: initialRuntime.epoch,
      claim: identityClaim,
      connection: connections.amazon_ads,
      detectedExternalAccountId: detected.externalAccountId,
      detectedAccountLabel: detected.alias,
      expectedStoreAlias: storeAlias,
      profileEvidenceUrl: visibleState.url,
      adsSession: detectedAdsSession,
    };
    mainRuntimeContext.pendingAmazonAdsIdentityRetry = null;
    identityClaimSettled = true;
    mainRuntimeContext.state.storeRepo.saveSessionMetadata({
      storeId: context.storeId,
      browserProfileId: context.browserProfileId,
      provider: 'amazon_ads',
      status: 'blocked',
      sessionGeneration: context.sessionGeneration,
      observedAt: new Date().toISOString(),
      failureCode: 'ADS_IDENTITY_CONFIRMATION_REQUIRED',
    });
    const {
      adsIdentityCandidate: _oldCandidate,
      adsUnavailableReason: _oldReason,
      adsEntryMode: _oldEntryMode,
      adsUrl: _oldAdsUrl,
      adsTitle: _oldAdsTitle,
      ...sessionBase
    } = currentSession;
    return publishAmazonAdsRetryResult(context, initialRuntime.runtimeId, {
      ...sessionBase,
      ok: true,
      currentStore: mainRuntimeContext.state.currentStore,
      erpSessionReady: true,
      adsSessionReady: false,
      adsEntryMode: detectedAdsSession.entryMode,
      adsUrl: detectedAdsSession.adsUrl,
      adsTitle: detectedAdsSession.adsTitle,
      adsUnavailableReason: '已从领星 Ads 的美国站店铺列表识别当前店铺；人工确认绑定前，真实广告执行保持阻断。',
      adsIdentityCandidate: {
        confirmationToken: token,
        detectedExternalAccountId: detected.externalAccountId,
        detectedAccountLabel: detected.alias,
      },
    });
  } catch (caught) {
    mainRuntimeContext.browserOperationLeases.assertCurrent(lease);
    mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(context);
    mainRuntimeContext.pendingAmazonAdsIdentityConfirmation = null;
    const retryRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
    if (!identityClaimSettled
      && retryRuntime
      && retryRuntime.runtimeId === initialRuntime.runtimeId
      && retryRuntime.epoch === initialRuntime.epoch
      && retryRuntime.providerIdentityStatus.amazonAds === 'pending'
      && sameExactStoreContext(retryRuntime.context, context)) {
      mainRuntimeContext.pendingAmazonAdsIdentityRetry = {
        context: Object.freeze({ ...context }),
        runtimeId: retryRuntime.runtimeId,
        runtimeEpoch: retryRuntime.epoch,
        claim: identityClaim,
      };
    } else if (!identityClaimSettled) {
      mainRuntimeContext.pendingAmazonAdsIdentityRetry = null;
    }
    const message = caught instanceof Error ? caught.message : String(caught);
    const observedAt = new Date().toISOString();
    const currentConnection = mainRuntimeContext.state.storeRepo.listConnections(context.storeId)
      .find((connection) => connection.provider === 'amazon_ads');
    mainRuntimeContext.state.db.transaction(() => {
      if (currentConnection) {
        mainRuntimeContext.state.storeRepo!.updateConnection({
          id: currentConnection.id,
          storeId: context.storeId,
          status: 'attention_required',
          lastFailureCode: 'ADS_SESSION_NOT_READY',
          expectedUpdatedAt: currentConnection.updatedAt,
        });
      }
      mainRuntimeContext.state.storeRepo!.saveSessionMetadata({
        storeId: context.storeId,
        browserProfileId: context.browserProfileId,
        provider: 'amazon_ads',
        status: 'blocked',
        sessionGeneration: context.sessionGeneration,
        observedAt,
        failureCode: 'ADS_SESSION_NOT_READY',
      });
    })();
    const {
      adsIdentityCandidate: _oldCandidate,
      adsUnavailableReason: _oldReason,
      adsEntryMode: _oldEntryMode,
      adsUrl: _oldAdsUrl,
      adsTitle: _oldAdsTitle,
      ...sessionBase
    } = currentSession;
    return publishAmazonAdsRetryResult(context, initialRuntime.runtimeId, {
      ...sessionBase,
      ok: true,
      currentStore: mainRuntimeContext.state.currentStore,
      erpSessionReady: true,
      adsSessionReady: false,
      ...(adsVisibleSession ? {
        adsEntryMode: adsVisibleSession.entryMode,
        adsUrl: adsVisibleSession.adsUrl,
        adsTitle: adsVisibleSession.adsTitle,
      } : {}),
      adsUnavailableReason: `领星广告会话尚未就绪：${message.slice(0, 240)} ERP 已连接，可继续只读采集；请再次点击“重试 Ads”，真实广告执行保持阻断。`,
    });
  }
}

export async function executeCurrentAmazonAdsRetryContinuation(
  request: BrowserLoginRequest,
  context: StoreContextEnvelope,
  connections: CurrentAmazonAdsRetryConnections,
): Promise<BrowserLoginResult> {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.storeCollectionMainRuntime) {
    throw new Error('Ads 重试所需的店铺变更通道尚未初始化。');
  }
  const retryCurrent = async (): Promise<BrowserLoginResult> => (
    withAdmittedVisibleBrowserOperation(
      'browser-login-ads-retry',
      async () => {
        const lease = mainRuntimeContext.browserOperationLeases.acquire({
          storeId: context.storeId,
          purpose: 'external_write',
          owner: 'browser-login-ads-retry',
          ttlMs: 10 * 60 * 1_000,
        });
        try {
          return await retryCurrentAmazonAdsSession(
            request,
            context,
            connections,
            lease,
          );
        } finally {
          mainRuntimeContext.browserOperationLeases.release(lease);
        }
      },
    )
  );
  const result = mainRuntimeContext.packageUiReadOnlyRuntime
    ? await withPackageUiVisibleLoginContinuationMutation(
        'browser:retry-ads',
        context,
        retryCurrent,
      )
    : await mainRuntimeContext.state.storeCollectionMainRuntime.withUserStoreMutation(
        {
          operation: 'browser:retry-ads',
          targetStoreId: String(context.storeId),
        },
        retryCurrent,
      );
  if (result.adsSessionReady) {
    await resumePolicyGrantDispatchesAfterVerifiedAdsSession(
      context,
      '[Execution] persisted policy-grant recovery failed after Ads retry readiness',
    );
  }
  return result;
}
