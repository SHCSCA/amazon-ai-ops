import * as crypto from 'crypto';
import { BrowserController } from '@amazon-ai-ops/browser-worker';
import type { StoreConnection, StoreConnectionProvider, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { normalizeStoreCapabilityId } from '@amazon-ai-ops/shared-types';
import type { StoreScopedSavedLoginCredentialStatus } from '../shared/login-contract';
import { runtimeLog } from './runtime-log-adapter';
import { runUserVisibleBrowserTransition, type UserVisibleBrowserTransitionFinalState } from './user-visible-browser-transition';
import { createStoreScopedLoginCredentialStore, readSavedLoginCredentialStatus, type SavedLoginCredentialStatus } from './login-credentials';
import { readLingxingAdsPageStateAfterNavigation } from './lingxing-ads-sso';
import { type VisibleBrowserRuntime } from './visible-browser-runtime-registry';
import { hasPackageUiFreshTypedProof } from './main-store-access-runtime';
import { publishStoreContextChanged } from './main-store-context-runtime';
import type { AdsSessionResult, BrowserLoginTransitionOutcome } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export function emptySavedLoginCredentialStatus(): SavedLoginCredentialStatus {
  return {
    username: '',
    rememberPassword: false,
    passwordAvailable: false,
    credentialState: 'none',
  };
}

export function handleGetSavedLoginCredentialStatus(): StoreScopedSavedLoginCredentialStatus {
  const mainRuntimeContext = getMainRuntimeContext();
  const activeContext = mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext() ?? null;
  const capturedContext = activeContext && mainRuntimeContext.state.storeCoordinator
    ? mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(activeContext)
    : null;
  const credentialStatus = mainRuntimeContext.state.configurationBus && capturedContext
    ? readSavedLoginCredentialStatus(
        createStoreScopedLoginCredentialStore(mainRuntimeContext.state.configurationBus, capturedContext.storeId),
        mainRuntimeContext.electronLoginCredentialCipher,
      )
    : emptySavedLoginCredentialStatus();
  return {
    ...credentialStatus,
    storeId: capturedContext?.storeId ?? null,
    packageUiEvidenceMode: mainRuntimeContext.packageUiReadOnlyRuntime,
    freshTypedProofRequired: mainRuntimeContext.packageUiFreshTypedProofRequired
      && !hasPackageUiFreshTypedProof(capturedContext?.storeId, credentialStatus.username),
  };
}

export async function readLingxingPageState(page: NonNullable<ReturnType<BrowserController['getPage']>>) {
  const state = await readLingxingAdsPageStateAfterNavigation(page);
  return {
    ...state,
    hasAccountInput: state.hasAccountInput === true,
  };
}

export function adsSessionResultFromPageState(pageState: { url: string; title?: string }): AdsSessionResult {
  return {
    entryMode: 'erp_ads_entry',
    adsUrl: pageState.url,
    adsTitle: pageState.title || pageState.url,
  };
}

export function persistClosedBrowserLoginFailure(expectedStoreId: string): void {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db || !mainRuntimeContext.state.storeCoordinator || !mainRuntimeContext.state.storeRepo) return;
  const activeContext = mainRuntimeContext.state.storeCoordinator.getActiveStoreContext();
  if (!activeContext || String(activeContext.storeId) !== expectedStoreId) return;
  const observedAt = new Date().toISOString();
  mainRuntimeContext.state.db.transaction(() => {
    mainRuntimeContext.state.storeRepo!.saveSessionMetadata({
      storeId: activeContext.storeId,
      browserProfileId: activeContext.browserProfileId,
      provider: 'lingxing',
      status: 'blocked',
      sessionGeneration: activeContext.sessionGeneration,
      observedAt,
      failureCode: 'LOGIN_FAILED',
    });
    mainRuntimeContext.state.storeRepo!.saveSessionMetadata({
      storeId: activeContext.storeId,
      browserProfileId: activeContext.browserProfileId,
      provider: 'amazon_ads',
      status: 'blocked',
      sessionGeneration: activeContext.sessionGeneration,
      observedAt,
      failureCode: 'LOGIN_FAILED',
    });
  })();
}

export function clearBrowserLoginState(): void {
  const mainRuntimeContext = getMainRuntimeContext();
  mainRuntimeContext.pendingAmazonAdsIdentityConfirmation = null;
  mainRuntimeContext.pendingAmazonAdsIdentityRetry = null;
  mainRuntimeContext.state.isLoggedIn = false;
  try {
    const activeContext = mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext();
    mainRuntimeContext.state.currentStore = activeContext && mainRuntimeContext.state.storeRepo
      ? mainRuntimeContext.state.storeRepo.getStore(activeContext.storeId)?.displayName ?? ''
      : '';
  } catch {
    mainRuntimeContext.state.currentStore = '';
  }
  mainRuntimeContext.state.loginSession = null;
}

export async function degradeVisibleLoginProvider(
  provider: 'lingxing' | 'amazon_ads',
  runtimeId: string,
  context: StoreContextEnvelope,
  reason: string,
): Promise<void> {
  const mainRuntimeContext = getMainRuntimeContext();
  if (mainRuntimeContext.expectedVisibleRuntimeCloseIds.has(runtimeId)) return;
  const runtime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  if (!runtime
    || runtime.runtimeId !== runtimeId
    || !sameExactStoreContext(runtime.context, context)) return;
  const observedAt = new Date().toISOString();
  try {
    if (provider === 'lingxing') {
      await closeVisibleBrowserRegistryStrictly();
      mainRuntimeContext.state.db?.transaction(() => {
        for (const blockedProvider of ['lingxing', 'amazon_ads'] as const) {
          mainRuntimeContext.state.storeRepo?.saveSessionMetadata({
            storeId: context.storeId,
            browserProfileId: context.browserProfileId,
            provider: blockedProvider,
            status: 'blocked',
            sessionGeneration: context.sessionGeneration,
            observedAt,
            failureCode: 'VISIBLE_BROWSER_CLOSED',
          });
        }
      })();
      clearBrowserLoginState();
    } else {
      const confirmationClaim = mainRuntimeContext.pendingAmazonAdsIdentityConfirmation
        && mainRuntimeContext.pendingAmazonAdsIdentityConfirmation.runtimeId === runtime.runtimeId
        ? mainRuntimeContext.pendingAmazonAdsIdentityConfirmation.claim
        : null;
      const retryClaim = mainRuntimeContext.pendingAmazonAdsIdentityRetry
        && mainRuntimeContext.pendingAmazonAdsIdentityRetry.runtimeId === runtime.runtimeId
        ? mainRuntimeContext.pendingAmazonAdsIdentityRetry.claim
        : null;
      const pendingClaim = confirmationClaim ?? retryClaim;
      mainRuntimeContext.pendingAmazonAdsIdentityConfirmation = null;
      mainRuntimeContext.pendingAmazonAdsIdentityRetry = null;
      if (runtime.providerIdentityStatus.amazonAds !== 'blocked') {
        const claim = pendingClaim ?? mainRuntimeContext.visibleBrowserRuntimeRegistry.claimAmazonAdsIdentity({
            runtimeId: runtime.runtimeId,
            epoch: runtime.epoch,
            context: runtime.context,
          });
        mainRuntimeContext.visibleBrowserRuntimeRegistry.blockAmazonAdsIdentity(claim);
      }
      const connection = mainRuntimeContext.state.storeRepo?.listConnections(context.storeId)
        .find((candidate) => candidate.provider === 'amazon_ads');
      mainRuntimeContext.state.db?.transaction(() => {
        if (connection) {
          mainRuntimeContext.state.storeRepo?.updateConnection({
            id: connection.id,
            storeId: context.storeId,
            status: 'attention_required',
            lastFailureCode: 'VISIBLE_BROWSER_CLOSED',
            expectedUpdatedAt: connection.updatedAt,
          });
        }
        mainRuntimeContext.state.storeRepo?.saveSessionMetadata({
          storeId: context.storeId,
          browserProfileId: context.browserProfileId,
          provider: 'amazon_ads',
          status: 'blocked',
          sessionGeneration: context.sessionGeneration,
          observedAt,
          failureCode: 'VISIBLE_BROWSER_CLOSED',
        });
      })();
      if (mainRuntimeContext.state.loginSession?.erpSessionReady) {
        const {
          adsIdentityCandidate: _staleCandidate,
          ...sessionWithoutCandidate
        } = mainRuntimeContext.state.loginSession;
        mainRuntimeContext.state.loginSession = {
          ...sessionWithoutCandidate,
          adsSessionReady: false,
          adsEntryMode: undefined,
          adsUrl: undefined,
          adsTitle: undefined,
          adsUnavailableReason: `Ads ${reason}ERP 已连接，可继续只读采集；请重新连接 ERP 与 Ads，真实广告执行保持阻断。`,
        };
      }
    }
    rereadAndPublishActiveStoreAuthority(String(context.storeId));
    mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
  } catch (error) {
    runtimeLog.error('[StoreSession] failed to downgrade closed visible browser', error);
  }
}

export function ensureAmazonAdsEnrollmentConnection(
  context: StoreContextEnvelope,
  connection: StoreConnection | undefined,
): StoreConnection {
  const mainRuntimeContext = getMainRuntimeContext();
  if (connection) return connection;
  if (!mainRuntimeContext.state.storeRepo) throw new Error('店铺连接仓储尚未初始化。');
  const created = mainRuntimeContext.state.storeRepo.createConnection({
    id: normalizeStoreCapabilityId(crypto.randomUUID()),
    storeId: context.storeId,
    provider: 'amazon_ads',
    status: 'not_configured',
    accountLabel: '等待可见浏览器自动识别',
  });
  const view = mainRuntimeContext.state.storeCoordinator?.getActiveStoreWorkspaceView();
  if (view) publishStoreContextChanged(view);
  return created;
}

export function browserRuntimeController(provider: StoreConnectionProvider): BrowserController | null {
  const mainRuntimeContext = getMainRuntimeContext();
  const runtime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  if (!runtime || !mainRuntimeContext.state.storeCoordinator) return null;
  try {
    mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(runtime.context);
    if (runtime.purpose !== 'operator_full') {
      clearBrowserLoginState();
      return null;
    }
    if (runtime.providerIdentityStatus.lingxing !== 'verified') return null;
    if (provider === 'amazon_ads'
      && runtime.providerIdentityStatus.amazonAds !== 'verified') return null;
    return browserControllerFromVisibleRuntime(runtime, provider);
  } catch {
    return null;
  }
}

export function browserControllerFromVisibleRuntime(
  runtime: VisibleBrowserRuntime,
  provider: StoreConnectionProvider,
): BrowserController | null {
  const controller = provider === 'lingxing'
    ? runtime.controllers.lingxing
    : runtime.controllers.amazonAds;
  return controller instanceof BrowserController ? controller : null;
}

export function sameExactStoreContext(
  left: StoreContextEnvelope,
  right: StoreContextEnvelope,
): boolean {
  return left.storeId === right.storeId
    && left.browserProfileId === right.browserProfileId
    && left.marketplace === right.marketplace
    && left.currency === right.currency
    && left.businessTimezone === right.businessTimezone
    && left.businessDate === right.businessDate
    && left.sessionGeneration === right.sessionGeneration;
}

export function isProviderBrowserSessionReady(
  context: StoreContextEnvelope,
  provider: StoreConnectionProvider,
): boolean {
  const mainRuntimeContext = getMainRuntimeContext();
  const runtime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  const session = mainRuntimeContext.state.storeRepo?.getSessionMetadata(context.storeId, provider);
  return Boolean(
    mainRuntimeContext.state.isLoggedIn
    && runtime
    && runtime.purpose === 'operator_full'
    && sameExactStoreContext(runtime.context, context)
    && runtime.providerIdentityStatus.lingxing === 'verified'
    && (provider !== 'amazon_ads'
      || (runtime.purpose === 'operator_full'
        && runtime.providerIdentityStatus.amazonAds === 'verified'))
    && browserControllerFromVisibleRuntime(runtime, provider)?.getPage()
    && session
    && session.status === 'ready'
    && session.browserProfileId === context.browserProfileId
    && session.sessionGeneration === context.sessionGeneration,
  );
}

export async function closeBrowserControllers(controllers: Iterable<BrowserController>): Promise<void> {
  const mainRuntimeContext = getMainRuntimeContext();
  mainRuntimeContext.pendingBrowserControllerCleanup.retain(controllers);
  await mainRuntimeContext.pendingBrowserControllerCleanup.closeRetained();
}

export async function closeVisibleBrowserRegistryStrictly(storeId?: string): Promise<void> {
  const mainRuntimeContext = getMainRuntimeContext();
  const runtime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  if (runtime && storeId && runtime.context.storeId !== storeId) return;
  const proof = runtime
    ? await mainRuntimeContext.visibleBrowserRuntimeRegistry.strictCloseCurrent(runtime.context)
    : mainRuntimeContext.visibleBrowserRuntimeRegistry.proveEmpty();
  mainRuntimeContext.visibleBrowserRuntimeRegistry.consumeEmptyProof(proof);
}

export function assertUserVisibleBrowserRuntimeClosed(): void {
  const mainRuntimeContext = getMainRuntimeContext();
  if (mainRuntimeContext.visibleBrowserRuntimeRegistry.read() !== null
    || mainRuntimeContext.pendingBrowserLogin !== null
    || mainRuntimeContext.pendingBrowserControllerCleanup.hasRetainedControllers()
    || mainRuntimeContext.state.isLoggedIn
    || mainRuntimeContext.state.loginSession !== null) {
    throw new Error('USER_VISIBLE_BROWSER_RUNTIME_NOT_EXACTLY_CLOSED');
  }
}

export async function closeUserVisibleBrowserRuntimeForTransition(): Promise<void> {
  const mainRuntimeContext = getMainRuntimeContext();
  const pendingControllers = invalidatePendingBrowserLogin();
  const runtimeId = mainRuntimeContext.visibleBrowserRuntimeRegistry.read()?.runtimeId;
  if (runtimeId) mainRuntimeContext.expectedVisibleRuntimeCloseIds.add(runtimeId);
  try {
    await Promise.all([
      closeVisibleBrowserRegistryStrictly(),
      closeBrowserControllers(pendingControllers),
    ]);
  } finally {
    if (runtimeId) mainRuntimeContext.expectedVisibleRuntimeCloseIds.delete(runtimeId);
  }
  clearBrowserLoginState();
  assertUserVisibleBrowserRuntimeClosed();
}

export function readEmptyUserVisibleBrowserTransitionState(): UserVisibleBrowserTransitionFinalState {
  assertUserVisibleBrowserRuntimeClosed();
  return Object.freeze({ state: 'empty' });
}

export function readOperatorLoginTransitionState(
  outcome: BrowserLoginTransitionOutcome,
): UserVisibleBrowserTransitionFinalState {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!outcome.ok) return readEmptyUserVisibleBrowserTransitionState();
  const runtime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  const active = mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext() ?? null;
  if (!runtime
    || !active
    || runtime.purpose !== 'operator_full'
    || runtime.providerIdentityStatus.lingxing !== 'verified'
    || !runtime.controllers.lingxing
    || !runtime.controllers.amazonAds
    || !sameExactStoreContext(runtime.context, active)
    || !mainRuntimeContext.state.isLoggedIn
    || mainRuntimeContext.state.loginSession === null) {
    throw new Error('OPERATOR_VISIBLE_BROWSER_FINAL_IDENTITY_UNPROVEN');
  }
  return Object.freeze({
    state: 'runtime_started',
    runtimeId: runtime.runtimeId,
    epoch: runtime.epoch,
  });
}

export function reconcileBrowserLoginProjectionWithVisibleRuntime(): void {
  const mainRuntimeContext = getMainRuntimeContext();
  const runtime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  if (!runtime
    || runtime.purpose !== 'operator_full'
    || runtime.providerIdentityStatus.lingxing !== 'verified') {
    clearBrowserLoginState();
  }
}

export function rereadAndPublishActiveStoreAuthority(expectedStoreId: string): StoreContextEnvelope {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.storeCoordinator) {
    throw new Error('active Store authority coordinator is unavailable');
  }
  const active = mainRuntimeContext.state.storeCoordinator.getActiveStoreContext();
  if (!active || String(active.storeId) !== expectedStoreId) {
    throw new Error('active Store authority reread did not retain the expected store');
  }
  const authorized = mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(active);
  const view = mainRuntimeContext.state.storeCoordinator.getActiveStoreWorkspaceView();
  if (!view || !sameExactStoreContext(view.context, authorized)) {
    throw new Error('active Store workspace reread did not bind the exact authority');
  }
  publishStoreContextChanged(view);
  return authorized;
}

export function invalidatePendingBrowserLogin(storeId?: string): BrowserController[] {
  const mainRuntimeContext = getMainRuntimeContext();
  if (storeId && mainRuntimeContext.pendingBrowserLogin?.context.storeId !== storeId) return [];
  mainRuntimeContext.browserLoginAttempt += 1;
  mainRuntimeContext.pendingAmazonAdsIdentityConfirmation = null;
  mainRuntimeContext.pendingAmazonAdsIdentityRetry = null;
  const controllers = mainRuntimeContext.pendingBrowserLogin ? [...mainRuntimeContext.pendingBrowserLogin.controllers] : [];
  mainRuntimeContext.pendingBrowserLogin = null;
  return controllers;
}

export function assertBrowserLoginAttempt(attemptId: number, context: StoreContextEnvelope): void {
  const mainRuntimeContext = getMainRuntimeContext();
  if (mainRuntimeContext.browserLoginAttempt !== attemptId || mainRuntimeContext.pendingBrowserLogin?.attemptId !== attemptId) {
    throw new Error('登录目标店铺已变化，本次浏览器登录已取消。');
  }
  if (!mainRuntimeContext.state.storeCoordinator) {
    throw new Error('店铺会话协调器尚未就绪。');
  }
  mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(context);
}

export async function handleBrowserLogout(): Promise<void> {
  const mainRuntimeContext = getMainRuntimeContext();
  if (mainRuntimeContext.packageUiReadOnlyRuntime) {
    throw new Error(
      'PACKAGE_UI_EVIDENCE_READ_ONLY: package UI evidence cannot mutate a real account session.',
    );
  }
  const activeContext = mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext() ?? null;
  if (activeContext) mainRuntimeContext.state.executionAuthorityService?.assertStoreMutationAllowed(activeContext);
  const runtime = mainRuntimeContext.state.storeCollectionMainRuntime;
  if (!runtime) throw new Error('店铺会话运行时尚未初始化。');
  const outcome = await runtime.withUserStoreMutation(
    {
      operation: 'browser:logout',
      ...(activeContext ? { targetStoreId: String(activeContext.storeId) } : {}),
    },
    () => runUserVisibleBrowserTransition({
      leases: mainRuntimeContext.browserOperationLeases,
      owner: 'browser-logout',
      closeRuntime: closeUserVisibleBrowserRuntimeForTransition,
      assertRuntimeClosed: assertUserVisibleBrowserRuntimeClosed,
      work: async () => {
        try {
          if (activeContext && mainRuntimeContext.state.storeCoordinator && mainRuntimeContext.state.storeRepo) {
            const current = mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(activeContext);
            mainRuntimeContext.state.executionAuthorityService?.assertStoreMutationAllowed(current);
            const invalidated = mainRuntimeContext.state.storeCoordinator.invalidateStoreSession(current.storeId);
            const observedAt = new Date().toISOString();
            mainRuntimeContext.state.db!.transaction(() => {
              for (const provider of ['lingxing', 'amazon_ads'] as const) {
                mainRuntimeContext.state.storeRepo!.saveSessionMetadata({
                  storeId: invalidated.storeId,
                  browserProfileId: invalidated.browserProfileId,
                  provider,
                  status: 'signed_out',
                  sessionGeneration: invalidated.sessionGeneration,
                  observedAt,
                  failureCode: 'operator_session_reset_requested',
                });
              }
            })();
            const published = rereadAndPublishActiveStoreAuthority(String(invalidated.storeId));
            if (published.sessionGeneration !== invalidated.sessionGeneration) {
              throw new Error('logout authority publication did not retain the invalidated generation');
            }
            mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
          }
          clearBrowserLoginState();
          return { ok: true as const };
        } catch (error) {
          const pendingControllers = invalidatePendingBrowserLogin();
          const cleanup = await Promise.allSettled([
            closeVisibleBrowserRegistryStrictly(),
            closeBrowserControllers(pendingControllers),
          ]);
          const cleanupFailures = cleanup
            .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
            .map((result) => result.reason);
          clearBrowserLoginState();
          try {
            const current = mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext() ?? null;
            if (activeContext && (!current || current.storeId !== activeContext.storeId)) {
              throw new Error('logout failure cleanup lost the active Store authority');
            }
            if (activeContext) {
              rereadAndPublishActiveStoreAuthority(String(activeContext.storeId));
              mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
            } else if (current) {
              mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(current);
            }
          } catch (authorityError) {
            cleanupFailures.push(authorityError);
          }
          if (cleanupFailures.length > 0) {
            throw new AggregateError(
              [error, ...cleanupFailures],
              'logout failure cleanup did not prove an empty visible-browser authority',
            );
          }
          return { ok: false as const, error };
        }
      },
      readFinalState: readEmptyUserVisibleBrowserTransitionState,
    }),
  );
  if (!outcome.ok) throw outcome.error;
}
