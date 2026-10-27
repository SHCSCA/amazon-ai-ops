import * as crypto from 'crypto';
import { BrowserController, type StoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import type { StoreConnection, StoreContextEnvelope, StoreRecord } from '@amazon-ai-ops/shared-types';
import type { BrowserLoginRequest, BrowserLoginResult } from '../shared/login-contract';
import { runtimeLog } from './runtime-log-adapter';
import { recordCredentialFailure } from './credential-error-diagnostics';
import { runUserVisibleBrowserTransition } from './user-visible-browser-transition';
import { requireBrowserLoginProviderConnections } from './browser-login-provider-connections';
import { recoverLingxingEnrollmentSession } from './lingxing-enrollment-session-recovery';
import { getLingxingSessionNavigationPlan } from './lingxing-session-flow';
import { createStoreScopedLoginCredentialStore, readSavedLoginCredentialStatus, resolveSavedLoginPassword, saveLoginCredentials } from './login-credentials';
import { decideLoginSessionCredentialPolicy, isPackageUiSavedSessionContinuationAllowed } from './login-session-credential-policy';
import { ensureLingxingErpAuthenticated, openLingxingAdsFromErp, readLingxingAdsProfileEvidence, restoreAuthenticatedLingxingErpPage, resolveLingxingStableIdentityFromAdsProfile, selectOnlyLingxingAdsStore } from './lingxing-ads-sso';
import { type AmazonAdsVisibleIdentityClaim } from './visible-browser-runtime-registry';
import { bindCompletedLoginPageLiveness, isCurrentAmazonAdsRetryContinuation, retryCurrentAmazonAdsSession } from './main-ads-retry-runtime';
import { adsSessionResultFromPageState, assertBrowserLoginAttempt, assertUserVisibleBrowserRuntimeClosed, clearBrowserLoginState, closeBrowserControllers, closeUserVisibleBrowserRuntimeForTransition, closeVisibleBrowserRegistryStrictly, ensureAmazonAdsEnrollmentConnection, invalidatePendingBrowserLogin, persistClosedBrowserLoginFailure, readLingxingPageState, readOperatorLoginTransitionState, rereadAndPublishActiveStoreAuthority, sameExactStoreContext } from './main-browser-session-runtime';
import { isExpectedLingxingSessionResetNavigation, resetConfiguredLingxingSessionIfAuthorized, resumePolicyGrantDispatchesAfterVerifiedAdsSession, withAdmittedVisibleBrowserOperation, withPackageUiVisibleLoginContinuationMutation } from './main-ads-retry-support-runtime';
import { hasPackageUiFreshTypedProof, storeCapsuleFor } from './main-store-access-runtime';
import { publishStoreContextChanged } from './main-store-context-runtime';
import { getControllerPageOrThrow } from './main-download-automation-runtime';
import { navigateToLingxingDownloadCenter } from './main-download-navigation-runtime';
import { readDownloadCenterPageModel } from './main-download-page-model-runtime';
import type { AdsSessionResult, BrowserLoginTransitionOutcome, CurrentAmazonAdsRetryConnections } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export async function handleBrowserLogin(request: BrowserLoginRequest): Promise<BrowserLoginResult> {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.storeCoordinator || !mainRuntimeContext.state.executionAuthorityService
    || !mainRuntimeContext.state.storeCollectionMainRuntime) {
    throw new Error('店铺会话运行时尚未初始化。');
  }
  const preflightContext = mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(request.storeContext);
  mainRuntimeContext.state.executionAuthorityService.assertStoreMutationAllowed(preflightContext);
  if (!mainRuntimeContext.state.storeRepo) throw new Error('店铺连接仓储尚未初始化。');
  const preflightConnections = requireBrowserLoginProviderConnections(
    mainRuntimeContext.state.storeRepo.listConnections(preflightContext.storeId),
  );
  if (isCurrentAmazonAdsRetryContinuation(request, preflightContext)) {
    const amazonAdsConnection = ensureAmazonAdsEnrollmentConnection(
      preflightContext,
      preflightConnections.amazon_ads,
    );
    const retryConnections: CurrentAmazonAdsRetryConnections = {
      ...preflightConnections,
      amazon_ads: amazonAdsConnection,
    };
    const retryCurrent = async (): Promise<BrowserLoginResult> => (
      withAdmittedVisibleBrowserOperation(
        'browser-login-ads-retry',
        async () => {
          const lease = mainRuntimeContext.browserOperationLeases.acquire({
            storeId: preflightContext.storeId,
            purpose: 'external_write',
            owner: 'browser-login-ads-retry',
            ttlMs: 10 * 60 * 1_000,
          });
          try {
            return await retryCurrentAmazonAdsSession(
              request,
              preflightContext,
              retryConnections,
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
          preflightContext,
          retryCurrent,
        )
      : await mainRuntimeContext.state.storeCollectionMainRuntime.withUserStoreMutation(
          {
            operation: 'browser:retry-ads',
            targetStoreId: String(preflightContext.storeId),
          },
          retryCurrent,
        );
    if (result.adsSessionReady) {
      await resumePolicyGrantDispatchesAfterVerifiedAdsSession(
        preflightContext,
        '[Execution] persisted policy-grant recovery failed after Ads retry readiness',
      );
    }
    return result;
  }
  if (preflightConnections.lingxingIdentityReadiness === 'enrollment_pending'
    && request.credentialSource !== 'typed') {
    throw new Error('领星稳定身份尚未建立，请手动输入本次凭证完成首次绑定。');
  }
  const loginMutationScope = {
    operation: 'browser:login',
    targetStoreId: String(preflightContext.storeId),
  };
  const loginMutationWork = () => runUserVisibleBrowserTransition({
    leases: mainRuntimeContext.browserOperationLeases,
    owner: 'browser-login',
    closeRuntime: closeUserVisibleBrowserRuntimeForTransition,
    assertRuntimeClosed: assertUserVisibleBrowserRuntimeClosed,
    work: async () => {
      try {
        return { ok: true as const, value: await performBrowserLoginInUserLane(request) };
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
          persistClosedBrowserLoginFailure(String(preflightContext.storeId));
        } catch (sessionError) {
          cleanupFailures.push(sessionError);
        }
        try {
          rereadAndPublishActiveStoreAuthority(String(preflightContext.storeId));
        } catch (authorityError) {
          cleanupFailures.push(authorityError);
        }
        if (cleanupFailures.length > 0) {
          throw new AggregateError(
            [error, ...cleanupFailures],
            'login failure cleanup did not prove an empty visible-browser authority',
          );
        }
        return { ok: false as const, error };
      }
    },
    readFinalState: readOperatorLoginTransitionState,
  });
  const outcome: BrowserLoginTransitionOutcome = mainRuntimeContext.packageUiReadOnlyRuntime
    ? await mainRuntimeContext.state.storeCollectionMainRuntime.withPackageUiSetupMutation(
        loginMutationScope,
        loginMutationWork,
      )
    : await mainRuntimeContext.state.storeCollectionMainRuntime.withUserStoreMutation(
        loginMutationScope,
        loginMutationWork,
      );
  if (!outcome.ok) throw outcome.error;
  const runtime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  if (outcome.value.adsSessionReady && runtime?.purpose === 'operator_full') {
    await mainRuntimeContext.state.executionAuthorityService.resumePolicyGrantDispatches(
      runtime.context,
      'session_ready',
    ).catch(() => {
      runtimeLog.error('[Execution] persisted policy-grant recovery failed after Ads session readiness');
    });
  }
  return outcome.value;
}

export async function performBrowserLoginInUserLane(
  request: BrowserLoginRequest,
): Promise<BrowserLoginResult> {
  const mainRuntimeContext = getMainRuntimeContext();
  if (mainRuntimeContext.packageUiFreshTypedProofRequired
    && !hasPackageUiFreshTypedProof(request.storeContext.storeId, request.username)
    && (request.credentialSource !== 'typed'
      || request.rememberPassword !== true
      || typeof request.password !== 'string'
      || request.password.length === 0)) {
    throw new Error('正式 Package UI 首轮登录必须手动输入凭证并勾选记住密码。');
  }
  const username = request.username;
  const rememberPassword = request.rememberPassword;
  if (!mainRuntimeContext.state.storeCoordinator || !mainRuntimeContext.state.storeRepo) {
    throw new Error('店铺会话尚未初始化。');
  }
  const initialContext = mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(request.storeContext);
  mainRuntimeContext.state.executionAuthorityService?.assertStoreMutationAllowed(initialContext);

  const password = request.credentialSource === 'saved'
    ? (() => {
        if (!mainRuntimeContext.state.configurationBus) {
          throw new Error('本机凭证存储尚未就绪，请重新输入密码。');
        }
        return resolveSavedLoginPassword(
          createStoreScopedLoginCredentialStore(mainRuntimeContext.state.configurationBus, initialContext.storeId),
          mainRuntimeContext.electronLoginCredentialCipher,
          username,
        );
      })()
    : request.password;

  const attemptId = mainRuntimeContext.browserLoginAttempt + 1;
  mainRuntimeContext.browserLoginAttempt = attemptId;
  mainRuntimeContext.pendingBrowserLogin = { attemptId, context: initialContext, controllers: new Set() };
  clearBrowserLoginState();
  if (mainRuntimeContext.browserLoginAttempt !== attemptId || mainRuntimeContext.pendingBrowserLogin?.attemptId !== attemptId) {
    throw new Error('登录目标店铺已变化，本次浏览器登录已取消。');
  }

  let loginSetup: {
    loginContext: StoreContextEnvelope;
    store: StoreRecord;
    capsule: StoreCapsulePaths;
    connections: {
      lingxing: StoreConnection;
      amazon_ads: StoreConnection;
      lingxingIdentityReadiness: 'configured' | 'enrollment_pending';
      amazonAdsIdentityReadiness: 'configured' | 'enrollment_pending';
    };
  };
  try {
    const view = mainRuntimeContext.state.storeCoordinator.reconnectStore(initialContext.storeId);
    const loginContext = view.context;
    if (mainRuntimeContext.pendingBrowserLogin?.attemptId === attemptId) {
      mainRuntimeContext.pendingBrowserLogin.context = loginContext;
    }
    publishStoreContextChanged(view);
    const store = mainRuntimeContext.state.storeRepo.getStore(loginContext.storeId);
    if (!store) throw new Error('当前店铺授权记录不存在。');
    const connections = requireBrowserLoginProviderConnections(
      mainRuntimeContext.state.storeRepo.listConnections(loginContext.storeId),
    );
    const amazonAdsConnection = ensureAmazonAdsEnrollmentConnection(
      loginContext,
      connections.amazon_ads,
    );
    loginSetup = {
      loginContext,
      store,
      capsule: storeCapsuleFor(store),
      connections: {
        ...connections,
        amazon_ads: amazonAdsConnection,
      },
    };
  } catch (error) {
    if (mainRuntimeContext.pendingBrowserLogin?.attemptId === attemptId) mainRuntimeContext.pendingBrowserLogin = null;
    if (mainRuntimeContext.browserLoginAttempt === attemptId) clearBrowserLoginState();
    throw error;
  }
  const { loginContext, store, capsule, connections } = loginSetup;
  const navigationPlan = getLingxingSessionNavigationPlan();
  const lingxingController = new BrowserController({
    headless: false,
    userDataDir: capsule.lingxingProfileDir,
  });
  const amazonAdsController = new BrowserController({
    headless: false,
    userDataDir: capsule.amazonAdsProfileDir,
  });
  mainRuntimeContext.pendingBrowserLogin.controllers.add(lingxingController);
  mainRuntimeContext.pendingBrowserLogin.controllers.add(amazonAdsController);
  let erpStageCommitted = false;
  let claimedAmazonAdsIdentity: AmazonAdsVisibleIdentityClaim | null = null;
  const blockFailedAmazonAdsIdentity = (
    adsIdentityClaim: AmazonAdsVisibleIdentityClaim,
  ): void => {
    mainRuntimeContext.visibleBrowserRuntimeRegistry.blockAmazonAdsIdentity(adsIdentityClaim);
  };

  try {
    await lingxingController.launch();
    await lingxingController.navigate(navigationPlan.initialUrl);
    await lingxingController.waitForTimeout(3000);

    const page = getControllerPageOrThrow(lingxingController);
    const accountInput = page.locator('input[name="account"], input[placeholder*="用户名"], input[placeholder*="手机号"]').first();
    const passwordInput = page.locator('input[name="pwd"], input[type="password"]').first();
    let needsLogin = await accountInput.isVisible({ timeout: 5000 }).catch(() => false);
    let erpSessionReused = !needsLogin;

    let sessionResetPort: Parameters<typeof recoverLingxingEnrollmentSession>[0]['port'];
    const explicitTypedSessionResetAuthorized = request.credentialSource === 'typed'
      && request.resetLingxingSessionForEnrollment === true;
    const enrollmentSessionRecovered = await recoverLingxingEnrollmentSession({
      enrollmentPending: connections.lingxingIdentityReadiness === 'enrollment_pending',
      sessionReused: erpSessionReused,
      resetConfirmed: request.credentialSource === 'typed'
        && request.resetLingxingSessionForEnrollment === true,
      port: sessionResetPort = {
        bringToFront: () => lingxingController.bringToFront(),
        clearStoreSession: async () => {
          const browserContext = lingxingController.getContext();
          if (!browserContext) throw new Error('该店铺领星浏览器会话不存在，无法执行已确认的重置。');
          try {
            await page.evaluate(async () => {
              window.localStorage.clear();
              window.sessionStorage.clear();
              if ('caches' in window) {
                const keys = await window.caches.keys();
                await Promise.all(keys.map((key) => window.caches.delete(key)));
              }
            });
          } catch (error) {
            if (!isExpectedLingxingSessionResetNavigation(error)) throw error;
            await page.waitForLoadState('domcontentloaded', { timeout: 5_000 })
              .catch(() => undefined);
          }
          await browserContext.clearCookies();
        },
        navigateToLogin: async () => {
          await lingxingController.navigate(navigationPlan.initialUrl);
          await lingxingController.waitForTimeout(1000);
        },
        isLoginFormReady: async () => (
          await accountInput.isVisible({ timeout: 5000 }).catch(() => false)
          && await passwordInput.isVisible({ timeout: 5000 }).catch(() => false)
        ),
      },
    });
    const configuredSavedSessionRecoveryAuthorized =
      connections.lingxingIdentityReadiness === 'configured'
      && request.credentialSource === 'saved'
      && connections.lingxing.session?.status === 'signed_out'
      && connections.lingxing.session?.failureCode === 'operator_session_reset_requested'
      && connections.lingxing.session.sessionGeneration === loginContext.sessionGeneration - 1;
    const configuredSessionRecovered = await resetConfiguredLingxingSessionIfAuthorized({
      configured: connections.lingxingIdentityReadiness === 'configured',
      sessionReused: erpSessionReused,
      authorized: configuredSavedSessionRecoveryAuthorized || explicitTypedSessionResetAuthorized,
      port: sessionResetPort,
    });
    if (enrollmentSessionRecovered || configuredSessionRecovered) {
      needsLogin = true;
      erpSessionReused = false;
    }

    if (connections.lingxingIdentityReadiness === 'enrollment_pending'
      && (request.credentialSource !== 'typed' || erpSessionReused)) {
      throw new Error('领星稳定身份首次绑定必须使用本次手动输入凭证完成可见登录。');
    }

    if (needsLogin) {
      await accountInput.fill(username);
      await passwordInput.fill(password);
      await Promise.all([
        page.waitForURL(/\/erp\/home|\/erp\/index|dashboard|home|index/, { timeout: 30000 }).catch(() => undefined),
        page.locator('button.loginBtn, button:has-text("登录")').first().click(),
      ]);
      await lingxingController.waitForTimeout(3000);
    }

    const erpLoginState = await readLingxingPageState(page);
    if (erpLoginState.hasAccountInput && erpLoginState.bodyText.includes('账号登录')) {
      throw new Error('领星 ERP 登录未完成：仍停留在账号登录页，请检查账号、密码或验证码要求');
    }

    const credentialPolicy = decideLoginSessionCredentialPolicy({
      credentialSource: request.credentialSource,
      erpSessionReused,
      rememberPassword,
    });
    const packageUiSavedSessionContinuationAllowed =
      isPackageUiSavedSessionContinuationAllowed({
        credentialSource: request.credentialSource,
        erpSessionReused,
        packageUiReadOnlyRuntime: mainRuntimeContext.packageUiReadOnlyRuntime,
        policy: credentialPolicy,
      });
    if (
      !credentialPolicy.sessionIdentityVerified
      && !packageUiSavedSessionContinuationAllowed
    ) {
      throw new Error('当前领星会话身份未经本次凭证验证；请在应用中使用“重置当前店铺会话（保留本机密码）”，再重新连接。');
    }
    const { credentialAction } = credentialPolicy;
    const lingxingStoreAlias = connections.lingxing.collectionStoreName;
    if (!lingxingStoreAlias || !connections.lingxing.accountLabel) {
      throw new Error('领星连接缺少登录账号或美国站店铺映射，登录已阻断。');
    }
    const erpObservedAt = new Date().toISOString();
    const stagedLingxingConnection = mainRuntimeContext.state.db!.transaction(() => {
      mainRuntimeContext.state.storeRepo!.saveSessionMetadata({
        storeId: loginContext.storeId,
        browserProfileId: loginContext.browserProfileId,
        provider: 'lingxing',
        status: 'ready',
        sessionGeneration: loginContext.sessionGeneration,
        observedAt: erpObservedAt,
        accountLabel: connections.lingxing.accountLabel,
        externalAccountId: connections.lingxing.externalAccountId,
        verifiedAt: erpObservedAt,
      });
      return connections.lingxing;
    })();
    erpStageCommitted = true;

    let credentialPersistenceCommitted = false;
    if (
      connections.lingxingIdentityReadiness === 'configured'
      && request.credentialSource === 'typed'
      && (credentialAction === 'save' || credentialAction === 'clear')
    ) {
      if (!mainRuntimeContext.state.configurationBus) {
        throw new Error('本机凭证存储尚未就绪，本次登录未完成。');
      }
      try {
        const credentialStore = createStoreScopedLoginCredentialStore(mainRuntimeContext.state.configurationBus, loginContext.storeId);
        saveLoginCredentials(
          credentialStore,
          { username, password, rememberPassword },
          mainRuntimeContext.electronLoginCredentialCipher,
        );
        const savedCredentialStatus = readSavedLoginCredentialStatus(
          credentialStore,
          mainRuntimeContext.electronLoginCredentialCipher,
        );
        if (rememberPassword
          ? savedCredentialStatus.credentialState !== 'encrypted_ready'
            || !savedCredentialStatus.passwordAvailable
            || !savedCredentialStatus.rememberPassword
            || savedCredentialStatus.username.trim() !== username.trim()
          : savedCredentialStatus.passwordAvailable
            || savedCredentialStatus.rememberPassword
            || savedCredentialStatus.credentialState !== 'none') {
          throw new Error('本机安全区凭证回读不一致。');
        }
        credentialPersistenceCommitted = true;
        if (mainRuntimeContext.packageUiFreshTypedProofRequired
          && request.credentialSource === 'typed'
          && rememberPassword
          && credentialPolicy.sessionIdentityVerified) {
          mainRuntimeContext.packageUiFreshTypedProof = Object.freeze({
            storeId: String(loginContext.storeId),
            username: username.trim(),
          });
        }
      } catch (error) {
        recordCredentialFailure('login_save_confirmed', error);
        throw new Error(rememberPassword
          ? '登录已确认，但密码未能安全保存；本次会话已关闭，请取消“记住密码”后重试。'
          : '登录已确认，但旧凭证未能安全清除；本次会话已关闭，请重试。');
      }
    }

    let lingxingStableExternalAccountId = stagedLingxingConnection.externalAccountId;
    let adsRecognitionFailure: string | undefined;
    let adsVisibleSession: AdsSessionResult | null = null;
    try {
      const lingxingAdsPage = await openLingxingAdsFromErp(lingxingController);
      const lingxingAdsState = await readLingxingPageState(lingxingAdsPage);
      adsVisibleSession = adsSessionResultFromPageState(lingxingAdsState);
      const lingxingAdsProfile = await readLingxingAdsProfileEvidence(
        lingxingAdsPage,
        lingxingStoreAlias,
      );
      const navigateVerifiedLingxingDownloadCenter = async () => {
        await navigateToLingxingDownloadCenter(
          lingxingController,
          readDownloadCenterPageModel(),
          lingxingStoreAlias,
        );
      };
      await navigateVerifiedLingxingDownloadCenter();
      const scopedLingxingAdsPage = getControllerPageOrThrow(lingxingController);
      lingxingStableExternalAccountId = resolveLingxingStableIdentityFromAdsProfile({
        accountLabel: connections.lingxing.accountLabel,
        collectionStoreName: lingxingStoreAlias,
        configuredExternalAccountId: connections.lingxing.externalAccountId,
        evidence: lingxingAdsProfile,
        credentialSubmission: request.credentialSource === 'typed' && needsLogin
          ? {
              credentialSource: 'typed',
              credentialsSubmitted: true,
              username,
            }
          : undefined,
      });
      await selectOnlyLingxingAdsStore(scopedLingxingAdsPage, lingxingStoreAlias);
    } catch (error) {
      adsRecognitionFailure = error instanceof Error ? error.message : String(error);
    }
    if (!adsRecognitionFailure) {
      try {
        await navigateToLingxingDownloadCenter(
          lingxingController,
          readDownloadCenterPageModel(),
          lingxingStoreAlias,
    );
      } catch (error) {
        adsRecognitionFailure = error instanceof Error ? error.message : String(error);
      }
    }
    if (adsRecognitionFailure) {
      const erpRestored = await restoreAuthenticatedLingxingErpPage(lingxingController);
      if (!erpRestored) throw new Error(adsRecognitionFailure);
    }
    assertBrowserLoginAttempt(attemptId, loginContext);

    let lingxingConnection = connections.lingxing;
    if (connections.lingxingIdentityReadiness === 'enrollment_pending'
      && lingxingStableExternalAccountId) {
      lingxingConnection = mainRuntimeContext.state.storeRepo.enrollLingxingStableExternalAccount({
        id: connections.lingxing.id,
        storeId: loginContext.storeId,
        provider: 'lingxing',
        externalAccountId: lingxingStableExternalAccountId,
        expectedUpdatedAt: connections.lingxing.updatedAt,
      });
      assertBrowserLoginAttempt(attemptId, loginContext);
    }

    if (
      !credentialPersistenceCommitted
      && request.credentialSource === 'typed'
      && (credentialAction === 'save' || credentialAction === 'clear')
    ) {
      if (!mainRuntimeContext.state.configurationBus) {
        throw new Error('本机凭证存储尚未就绪，本次登录未完成。');
      }
      try {
        saveLoginCredentials(
          createStoreScopedLoginCredentialStore(mainRuntimeContext.state.configurationBus, loginContext.storeId),
          { username, password, rememberPassword },
          mainRuntimeContext.electronLoginCredentialCipher,
        );
        credentialPersistenceCommitted = true;
      } catch (error) {
        recordCredentialFailure('login_save_pending', error);
        throw new Error(rememberPassword
          ? '登录已确认，但密码未能安全保存；本次会话已关闭，请取消“记住密码”后重试。'
          : '登录已确认，但旧凭证未能安全清除；本次会话已关闭，请重试。');
      }
    }
    assertBrowserLoginAttempt(attemptId, loginContext);
    if (mainRuntimeContext.packageUiFreshTypedProofRequired
      && request.credentialSource === 'typed'
      && rememberPassword
      && credentialPolicy.sessionIdentityVerified) {
      mainRuntimeContext.packageUiFreshTypedProof = Object.freeze({
        storeId: String(loginContext.storeId),
        username: username.trim(),
      });
    }

    const lingxingObservedAt = new Date().toISOString();
    const readyLingxingConnection = mainRuntimeContext.state.db!.transaction(() => {
      const connection = mainRuntimeContext.state.storeRepo!.updateConnection({
        id: lingxingConnection.id,
        storeId: loginContext.storeId,
        status: 'ready',
        lastVerifiedAt: lingxingObservedAt,
        lastFailureCode: '',
        expectedUpdatedAt: lingxingConnection.updatedAt,
      });
      mainRuntimeContext.state.storeRepo!.saveSessionMetadata({
        storeId: loginContext.storeId,
        browserProfileId: loginContext.browserProfileId,
        provider: 'lingxing',
        status: 'ready',
        sessionGeneration: loginContext.sessionGeneration,
        observedAt: lingxingObservedAt,
        accountLabel: lingxingConnection.accountLabel,
        externalAccountId: lingxingConnection.externalAccountId,
        verifiedAt: lingxingObservedAt,
      });
      return connection;
    })();
    assertBrowserLoginAttempt(attemptId, loginContext);

    
    
    
    const candidateClaim = mainRuntimeContext.visibleBrowserRuntimeRegistry.publishCandidate({
      purpose: 'operator_full',
      context: loginContext,
      controllers: {
        lingxing: lingxingController,
        amazonAds: amazonAdsController,
      },
      profileDirs: {
        lingxing: capsule.lingxingProfileDir,
        amazonAds: capsule.amazonAdsProfileDir,
      },
      connections: {
        lingxing: readyLingxingConnection,
        amazonAds: connections.amazon_ads,
      },
      attempt: {
        kind: 'manual',
        attemptId: `browser-login:${attemptId}`,
        attemptEpoch: attemptId,
      },
      amazonAdsIdentityStatus: 'pending',
    });
    mainRuntimeContext.pendingBrowserLogin.controllers.delete(lingxingController);
    mainRuntimeContext.pendingBrowserLogin.controllers.delete(amazonAdsController);
    const lingxingVerifiedClaim = mainRuntimeContext.visibleBrowserRuntimeRegistry
      .verifyLingxingCandidate(candidateClaim);
    const lingxingVerifiedRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry
      .assertClaimCurrent(lingxingVerifiedClaim);
    mainRuntimeContext.state.isLoggedIn = true;
    mainRuntimeContext.state.currentStore = store.displayName;

    let adsSession: AdsSessionResult | null = null;
    let adsUnavailableReason: string | undefined;
    let adsIdentityCandidate: BrowserLoginResult['adsIdentityCandidate'];
    let adsConnection = connections.amazon_ads;
    const adsIdentityClaim = mainRuntimeContext.visibleBrowserRuntimeRegistry.claimAmazonAdsIdentity({
      runtimeId: lingxingVerifiedRuntime.runtimeId,
      epoch: lingxingVerifiedRuntime.epoch,
      context: lingxingVerifiedRuntime.context,
    });
    claimedAmazonAdsIdentity = adsIdentityClaim;
    try {
      if (adsRecognitionFailure) throw new Error(adsRecognitionFailure);
      await amazonAdsController.launch();
      await amazonAdsController.navigate(navigationPlan.initialUrl);
      await amazonAdsController.waitForTimeout(1_000);
      const adsErpPage = getControllerPageOrThrow(amazonAdsController);
      await ensureLingxingErpAuthenticated(adsErpPage, { username, password });
      assertBrowserLoginAttempt(attemptId, loginContext);
      const adsPage = await openLingxingAdsFromErp(amazonAdsController);
      const visibleAdsState = await readLingxingPageState(adsPage);
      adsVisibleSession = adsSessionResultFromPageState(visibleAdsState);
      const detected = await readLingxingAdsProfileEvidence(adsPage, lingxingStoreAlias);
      await navigateToLingxingDownloadCenter(
        amazonAdsController,
        readDownloadCenterPageModel(),
        lingxingStoreAlias,
      );
      const verifiedAdsPage = getControllerPageOrThrow(amazonAdsController);
      const amazonAdsState = await readLingxingPageState(verifiedAdsPage);
      const detectedAdsSession = adsSessionResultFromPageState(amazonAdsState);
      assertBrowserLoginAttempt(attemptId, loginContext);
      if (connections.amazonAdsIdentityReadiness === 'configured') {
        if (adsConnection.normalizedExternalAccountId !== detected.externalAccountId) {
          throw new Error('领星 Ads 美国站店铺身份与当前店铺绑定不一致，真实广告执行已阻断。');
        }
        adsSession = detectedAdsSession;
        const adsObservedAt = new Date().toISOString();
        adsConnection = mainRuntimeContext.state.db!.transaction(() => {
          const connection = mainRuntimeContext.state.storeRepo!.updateConnection({
            id: adsConnection.id,
            storeId: loginContext.storeId,
            status: 'ready',
            lastVerifiedAt: adsObservedAt,
            lastFailureCode: '',
            expectedUpdatedAt: adsConnection.updatedAt,
          });
          mainRuntimeContext.state.storeRepo!.saveSessionMetadata({
            storeId: loginContext.storeId,
            browserProfileId: loginContext.browserProfileId,
            provider: 'amazon_ads',
            status: 'ready',
            sessionGeneration: loginContext.sessionGeneration,
            observedAt: adsObservedAt,
            accountLabel: adsConnection.accountLabel,
            externalAccountId: adsConnection.externalAccountId,
            verifiedAt: adsObservedAt,
          });
          return connection;
        })();
        mainRuntimeContext.visibleBrowserRuntimeRegistry.verifyAmazonAdsIdentity(adsIdentityClaim, adsConnection);
        mainRuntimeContext.pendingAmazonAdsIdentityRetry = null;
      } else {
        const token = crypto.randomUUID();
        mainRuntimeContext.pendingAmazonAdsIdentityConfirmation = {
          token,
          context: Object.freeze({ ...loginContext }),
          runtimeId: lingxingVerifiedRuntime.runtimeId,
          runtimeEpoch: lingxingVerifiedRuntime.epoch,
          claim: adsIdentityClaim,
          connection: adsConnection,
          detectedExternalAccountId: detected.externalAccountId,
          detectedAccountLabel: detected.alias,
          expectedStoreAlias: lingxingStoreAlias,
          profileEvidenceUrl: visibleAdsState.url,
          adsSession: detectedAdsSession,
        };
        mainRuntimeContext.pendingAmazonAdsIdentityRetry = null;
        adsIdentityCandidate = {
          confirmationToken: token,
          detectedExternalAccountId: detected.externalAccountId,
          detectedAccountLabel: detected.alias,
        };
        adsUnavailableReason = '已从领星 Ads 的美国站店铺列表识别当前店铺；人工确认绑定前，真实广告执行保持阻断。';
        mainRuntimeContext.state.storeRepo!.saveSessionMetadata({
          storeId: loginContext.storeId,
          browserProfileId: loginContext.browserProfileId,
          provider: 'amazon_ads',
          status: 'blocked',
          sessionGeneration: loginContext.sessionGeneration,
          observedAt: new Date().toISOString(),
          failureCode: 'ADS_IDENTITY_CONFIRMATION_REQUIRED',
        });
      }
    } catch (caught) {
      
      assertBrowserLoginAttempt(attemptId, loginContext);
      mainRuntimeContext.pendingAmazonAdsIdentityConfirmation = null;
      mainRuntimeContext.pendingAmazonAdsIdentityRetry = {
        context: Object.freeze({ ...loginContext }),
        runtimeId: lingxingVerifiedRuntime.runtimeId,
        runtimeEpoch: lingxingVerifiedRuntime.epoch,
        claim: adsIdentityClaim,
      };
      adsSession = null;
      const caughtMessage = caught instanceof Error ? caught.message : String(caught);
      adsUnavailableReason = `领星广告会话尚未就绪：${caughtMessage.slice(0, 240)} 请点击“重试 Ads”；真实广告执行保持阻断。`;
      const adsObservedAt = new Date().toISOString();
      mainRuntimeContext.state.db!.transaction(() => {
        mainRuntimeContext.state.storeRepo!.updateConnection({
          id: adsConnection.id,
          storeId: loginContext.storeId,
          status: 'attention_required',
          lastFailureCode: 'ADS_SESSION_NOT_READY',
          expectedUpdatedAt: adsConnection.updatedAt,
        });
        mainRuntimeContext.state.storeRepo!.saveSessionMetadata({
          storeId: loginContext.storeId,
          browserProfileId: loginContext.browserProfileId,
          provider: 'amazon_ads',
          status: 'blocked',
          sessionGeneration: loginContext.sessionGeneration,
          observedAt: adsObservedAt,
          failureCode: 'ADS_SESSION_NOT_READY',
        });
      })();
    }
    assertBrowserLoginAttempt(attemptId, loginContext);

    const adsPageEvidence = adsSession ?? adsVisibleSession;
    const loginResult: BrowserLoginResult = {
      ok: true,
      credentialSource: request.credentialSource,
      currentStore: mainRuntimeContext.state.currentStore,
      erpSessionReady: true,
      erpSessionReused,
      sessionIdentityVerified: credentialPolicy.sessionIdentityVerified,
      adsSessionReady: Boolean(adsSession),
      ...(adsPageEvidence ? {
        adsEntryMode: adsPageEvidence.entryMode,
        adsUrl: adsPageEvidence.adsUrl,
        adsTitle: adsPageEvidence.adsTitle,
      } : {}),
      ...(!adsSession ? {
        adsUnavailableReason,
        ...(adsIdentityCandidate ? { adsIdentityCandidate } : {}),
      } : {}),
      credentialPersistence: credentialPolicy.credentialPersistence,
    };
    mainRuntimeContext.state.loginSession = loginResult;
    rereadAndPublishActiveStoreAuthority(String(loginContext.storeId));
    bindCompletedLoginPageLiveness(
      mainRuntimeContext.visibleBrowserRuntimeRegistry.read()?.runtimeId ?? lingxingVerifiedRuntime.runtimeId,
      loginContext,
    );
    if (mainRuntimeContext.pendingBrowserLogin?.attemptId === attemptId) {
      mainRuntimeContext.pendingBrowserLogin = null;
    }
    return loginResult;
  } catch (error) {
    const failedRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
    if (claimedAmazonAdsIdentity
      && failedRuntime
      && failedRuntime.providerIdentityStatus.amazonAds === 'pending'
      && sameExactStoreContext(failedRuntime.context, loginContext)) {
      blockFailedAmazonAdsIdentity(claimedAmazonAdsIdentity);
      mainRuntimeContext.pendingAmazonAdsIdentityConfirmation = null;
      mainRuntimeContext.pendingAmazonAdsIdentityRetry = null;
    }
    if (mainRuntimeContext.state.storeCoordinator && mainRuntimeContext.state.storeRepo) {
      const observedAt = new Date().toISOString();
      try {
        mainRuntimeContext.state.storeCoordinator.assertStoreContext(loginContext);
        if (!erpStageCommitted) {
          mainRuntimeContext.state.storeRepo.saveSessionMetadata({
            storeId: loginContext.storeId,
            browserProfileId: loginContext.browserProfileId,
            provider: 'lingxing',
            status: 'blocked',
            sessionGeneration: loginContext.sessionGeneration,
            observedAt,
            failureCode: 'LOGIN_FAILED',
          });
        }
        mainRuntimeContext.state.storeRepo.saveSessionMetadata({
          storeId: loginContext.storeId,
          browserProfileId: loginContext.browserProfileId,
          provider: 'amazon_ads',
          status: 'blocked',
          sessionGeneration: loginContext.sessionGeneration,
          observedAt,
          failureCode: 'LOGIN_FAILED',
        });
      } catch (metadataError) {
        runtimeLog.error('[StoreSession] failed to persist blocked login state', metadataError);
      }
    }
    throw error;
  }
}
