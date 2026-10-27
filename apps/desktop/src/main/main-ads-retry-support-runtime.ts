import type { Page } from 'playwright';
import { BrowserController } from '@amazon-ai-ops/browser-worker';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { runtimeLog } from './runtime-log-adapter';
import { recoverLingxingEnrollmentSession } from './lingxing-enrollment-session-recovery';
import { getLingxingSessionNavigationPlan } from './lingxing-session-flow';
import { ensureLingxingErpAuthenticated, isTransientLingxingAdsNavigationError, openLingxingAdsFromErp } from './lingxing-ads-sso';
import { StoreMutationLaneError } from './visible-browser-runtime-registry';
import { getControllerPageOrThrow } from './main-download-automation-runtime';
import { sameExactStoreContext } from './main-browser-session-runtime';
import { hasPackageUiFreshTypedProof } from './main-store-access-runtime';
import { getMainRuntimeContext } from './main-runtime-access';

export function isRecoverableAmazonAdsEntryFailure(error: unknown): boolean {
  return /可见浏览器|可信 ERP 页面|SSO|restartLogin|尚未登录|已关闭|没有检测到可见 Ads|限定时间内未出现/u
    .test(error instanceof Error ? error.message : String(error));
}

export function isExpectedLingxingSessionResetNavigation(error: unknown): boolean {
  return isTransientLingxingAdsNavigationError(error);
}

export async function resetConfiguredLingxingSessionIfAuthorized(input: Readonly<{
  configured: boolean;
  sessionReused: boolean;
  authorized: boolean;
  port: Parameters<typeof recoverLingxingEnrollmentSession>[0]['port'];
}>): Promise<boolean> {
  if (!input.configured || !input.sessionReused || !input.authorized) return false;

  await input.port.bringToFront();
  await input.port.clearStoreSession();
  await input.port.navigateToLogin();
  if (!await input.port.isLoginFormReady()) {
    throw new Error('当前店铺领星会话已重置，但未进入可见登录页；请重试，身份确认继续阻断。');
  }
  return true;
}

export async function reopenAmazonAdsControllerForRetry(input: Readonly<{
  controller: BrowserController;
  runtimeId: string;
  username: string;
  password: string;
}>): Promise<Page> {
  const mainRuntimeContext = getMainRuntimeContext();
  mainRuntimeContext.expectedVisibleRuntimeCloseIds.add(input.runtimeId);
  try {
    await input.controller.close();
  } finally {
    mainRuntimeContext.expectedVisibleRuntimeCloseIds.delete(input.runtimeId);
  }
  const navigationPlan = getLingxingSessionNavigationPlan();
  await input.controller.launch();
  await input.controller.navigate(navigationPlan.initialUrl);
  await input.controller.waitForTimeout(1_000);
  const erpPage = getControllerPageOrThrow(input.controller);
  await ensureLingxingErpAuthenticated(erpPage, {
    username: input.username,
    password: input.password,
  });
  return openLingxingAdsFromErp(input.controller);
}

export async function withPackageUiVisibleLoginContinuationMutation<Result>(
  operation: string,
  context: StoreContextEnvelope,
  work: () => Promise<Result>,
): Promise<Result> {
  const mainRuntimeContext = getMainRuntimeContext();
  if (operation !== 'browser:retry-ads'
    && operation !== 'browser:confirm-ads-identity') {
    throw new Error('正式验收登录后的连接动作不在允许范围内，操作已阻断。');
  }
  const mainRuntime = mainRuntimeContext.state.storeCollectionMainRuntime;
  const visibleRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  const activeContext = mainRuntimeContext.state.storeCoordinator?.assertActiveStoreContext(context);
  const runtimeStatus = mainRuntime?.readStatus();
  const packageUiSchedulerSnapshot = mainRuntimeContext.packageUiSchedulerAudit.snapshot();
  const packageUiSuppressedStartupSafe = Boolean(
    runtimeStatus
    && runtimeStatus.packageUiReadOnly === true
    && runtimeStatus.startupRecoveryConfirmed === false
    && runtimeStatus.lifecycle === 'startup_unknown'
    && runtimeStatus.automationStarted === false
    && runtimeStatus.drainProven === false
    && runtimeStatus.registryClosed === false
    && packageUiSchedulerSnapshot.guards.startupReconcileSuppressed
    && packageUiSchedulerSnapshot.guards.readOnlyInvariantPassed
    && !packageUiSchedulerSnapshot.guards.localSchedulerStarted
    && !packageUiSchedulerSnapshot.guards.storeCollectionSchedulerStarted
  );
  const expectedAdsStatus = 'pending';
  if (!mainRuntimeContext.packageUiReadOnlyRuntime
    || !mainRuntime
    || !runtimeStatus
    || !packageUiSuppressedStartupSafe
    || runtimeStatus.orchestratorTransitionLocked
    || runtimeStatus.mutationLane.held
    || runtimeStatus.mutationLane.stickyUnknown
    || !activeContext
    || !visibleRuntime
    || visibleRuntime.purpose !== 'operator_full'
    || visibleRuntime.providerIdentityStatus.lingxing !== 'verified'
    || visibleRuntime.providerIdentityStatus.amazonAds !== expectedAdsStatus
    || !sameExactStoreContext(visibleRuntime.context, context)
    || !mainRuntimeContext.state.isLoggedIn
    || mainRuntimeContext.state.loginSession?.erpSessionReady !== true
    || !hasPackageUiFreshTypedProof(
      context.storeId,
      mainRuntimeContext.packageUiFreshTypedProof?.username,
    )) {
    throw new Error('正式验收登录后的当前店铺、浏览器或新鲜凭证证明已变化，操作已阻断。');
  }

  const owner = `package-ui-visible-login:${operation}`;
  const capability = Object.freeze({});
  mainRuntimeContext.storeMutationLane.registerAuthority({ kind: 'user', owner, capability });
  let claim;
  try {
    claim = mainRuntimeContext.storeMutationLane.claim({ kind: 'user', owner, capability });
  } catch (error) {
    if (!(error instanceof StoreMutationLaneError && error.code === 'LANE_HELD')) {
      mainRuntimeContext.storeMutationLane.markSafetyStateUnknown();
    }
    throw error;
  }

  let result: Result | undefined;
  let workFailure: unknown;
  try {
    result = await work();
  } catch (error) {
    workFailure = error;
  }
  try {
    const receipt = mainRuntimeContext.storeMutationLane.release(claim);
    if (!receipt.released
      || receipt.claimCapability !== claim.claimCapability
      || receipt.sequence !== claim.sequence) {
      throw new Error('正式验收登录后动作的共享变更通道未能精确释放。');
    }
  } catch (releaseError) {
    mainRuntimeContext.storeMutationLane.markSafetyStateUnknown();
    throw new AggregateError(
      workFailure === undefined ? [releaseError] : [workFailure, releaseError],
      '正式验收登录后动作未能证明共享变更通道已安全释放。',
    );
  }
  if (workFailure !== undefined) {
    mainRuntimeContext.storeMutationLane.markSafetyStateUnknown();
    throw workFailure;
  }
  return result as Result;
}

export async function resumePolicyGrantDispatchesAfterVerifiedAdsSession(
  context: StoreContextEnvelope,
  failureLog: string,
): Promise<void> {
  const mainRuntimeContext = getMainRuntimeContext();
  await mainRuntimeContext.state.executionAuthorityService!.resumePolicyGrantDispatches(
    context,
    'session_ready',
  ).catch(() => {
    runtimeLog.error(failureLog);
  });
}

export function withAdmittedVisibleBrowserOperation<Result>(
  owner: string,
  work: () => Promise<Result> | Result,
): Promise<Result> {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.executionAuthorityService) {
    throw new Error('浏览器操作安全门尚未初始化。');
  }
  return mainRuntimeContext.state.executionAuthorityService.withAdmittedBrowserOperation(owner, work);
}
