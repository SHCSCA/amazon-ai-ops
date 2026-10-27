import type { StoreConnection, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { normalizeLingxingCollectionStoreName, normalizeProviderExternalAccountId } from '@amazon-ai-ops/shared-types';
import type { BrowserLoginResult, ConfirmBrowserLoginAdsIdentityRequest } from '../shared/login-contract';
import { runtimeLog } from './runtime-log-adapter';
import { readLingxingAdsProfileEvidence } from './lingxing-ads-sso';
import { browserControllerFromVisibleRuntime, sameExactStoreContext } from './main-browser-session-runtime';
import { navigateToLingxingDownloadCenter } from './main-download-navigation-runtime';
import { readDownloadCenterPageModel } from './main-download-page-model-runtime';
import { getControllerPageOrThrow } from './main-download-automation-runtime';
import { publishStoreContextChanged } from './main-store-context-runtime';
import { withPackageUiVisibleLoginContinuationMutation } from './main-ads-retry-support-runtime';
import { getMainRuntimeContext } from './main-runtime-access';

export function enrollConfirmedAmazonAdsConnection(input: Readonly<{
  context: StoreContextEnvelope;
  connection: StoreConnection;
  accountLabel: string;
  externalAccountId: string;
  expectedStoreAlias: string;
  observedAt: string;
}>): StoreConnection {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db || !mainRuntimeContext.state.storeRepo) {
    throw new Error('Amazon Ads 首次身份登记所需的本机仓储尚未就绪。');
  }
  if (input.connection.provider !== 'amazon_ads') {
    throw new Error('Amazon Ads 首次身份登记不能写入其他连接。');
  }
  const current = mainRuntimeContext.state.storeRepo.getConnection(input.context.storeId, 'amazon_ads');
  if (!current
    || current.id !== input.connection.id
    || current.updatedAt !== input.connection.updatedAt
    || current.externalAccountId !== undefined
    || current.normalizedExternalAccountId !== undefined) {
    throw new Error('Amazon Ads 首次身份登记条件已变化，请重新启动当前店铺连接。');
  }
  const normalizedExternalAccountId = normalizeProviderExternalAccountId('amazon_ads', input.externalAccountId);
  const normalizedExpectedAlias = normalizeLingxingCollectionStoreName(input.expectedStoreAlias);
  const normalizedObservedAlias = normalizeLingxingCollectionStoreName(input.accountLabel);
  if (!normalizedExternalAccountId
    || !normalizedExpectedAlias
    || normalizedObservedAlias !== normalizedExpectedAlias) {
    throw new Error('Amazon Ads 首次身份登记证据无效，请重新启动当前店铺连接。');
  }
  const previousRevisionMs = Date.parse(current.updatedAt);
  const observedAtMs = Date.parse(input.observedAt);
  if (!Number.isFinite(previousRevisionMs) || !Number.isFinite(observedAtMs)) {
    throw new Error('Amazon Ads 首次身份登记时间证据无效，请重新启动当前店铺连接。');
  }
  const updatedAt = new Date(Math.max(observedAtMs, previousRevisionMs + 1)).toISOString();
  try {
    const updated = mainRuntimeContext.state.db.prepare(`
      UPDATE store_connections
      SET status = 'ready',
          account_label = @accountLabel,
          external_account_id = @externalAccountId,
          normalized_external_account_id = @normalizedExternalAccountId,
          last_verified_at = @observedAt,
          last_failure_code = NULL,
          updated_at = @updatedAt
      WHERE id = @id
        AND store_id = @storeId
        AND provider = 'amazon_ads'
        AND updated_at = @expectedUpdatedAt
        AND external_account_id IS NULL
        AND normalized_external_account_id IS NULL
    `).run({
      id: current.id,
      storeId: input.context.storeId,
      accountLabel: input.accountLabel,
      externalAccountId: input.externalAccountId,
      normalizedExternalAccountId,
      observedAt: input.observedAt,
      updatedAt,
      expectedUpdatedAt: current.updatedAt,
    });
    if (updated.changes !== 1) {
      throw new Error('Amazon Ads 首次身份登记条件已变化，请重新启动当前店铺连接。');
    }
  } catch (error) {
    if (/UNIQUE constraint failed: store_connections\.provider, store_connections\.normalized_external_account_id/i
      .test(error instanceof Error ? error.message : String(error))) {
      throw new Error('该 Amazon Ads 账户已绑定到其他店铺，当前店铺连接已阻断。');
    }
    throw error;
  }
  const enrolled = mainRuntimeContext.state.storeRepo.getConnection(input.context.storeId, 'amazon_ads');
  if (!enrolled
    || enrolled.id !== current.id
    || enrolled.status !== 'ready'
    || enrolled.normalizedExternalAccountId !== normalizedExternalAccountId) {
    throw new Error('Amazon Ads 首次身份登记回读不一致，请重新启动当前店铺连接。');
  }
  return enrolled;
}

export async function handleConfirmBrowserLoginAdsIdentity(
  request: ConfirmBrowserLoginAdsIdentityRequest,
): Promise<BrowserLoginResult> {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.storeCoordinator || !mainRuntimeContext.state.storeRepo || !mainRuntimeContext.state.storeCollectionMainRuntime
    || !mainRuntimeContext.state.executionAuthorityService || !mainRuntimeContext.state.db) {
    throw new Error('店铺会话运行时尚未初始化。');
  }
  const context = mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(request.storeContext);
  mainRuntimeContext.state.executionAuthorityService.assertStoreMutationAllowed(context);
  const mutationScope = {
    operation: 'browser:confirm-ads-identity',
    targetStoreId: String(context.storeId),
  };
  const confirm = async (): Promise<BrowserLoginResult> => {
    const pending = mainRuntimeContext.pendingAmazonAdsIdentityConfirmation;
    const runtime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
    if (!pending
      || pending.token !== request.confirmationToken
      || !sameExactStoreContext(pending.context, context)
      || !runtime
      || runtime.runtimeId !== pending.runtimeId
      || runtime.epoch !== pending.runtimeEpoch
      || !sameExactStoreContext(runtime.context, context)
      || runtime.providerIdentityStatus.lingxing !== 'verified'
      || runtime.providerIdentityStatus.amazonAds !== 'pending') {
      throw new Error('Amazon Ads 自动识别确认已失效，请重新启动当前店铺连接。');
    }
    const adsController = browserControllerFromVisibleRuntime(runtime, 'amazon_ads');
    const adsPage = adsController?.getPage();
    if (!adsController || !adsPage) {
      throw new Error('Amazon Ads 可见浏览器已关闭，请重新启动当前店铺连接。');
    }
    try {
      new URL(pending.profileEvidenceUrl);
    } catch {
      throw new Error('Amazon Ads 首次身份页面地址无效，请重新启动当前店铺连接。');
    }
    const profileEvidenceUrl = new URL(pending.profileEvidenceUrl);
    if (profileEvidenceUrl.origin !== 'https://ads.lingxing.com'
      || /\/restartLogin(?:\/|$)/i.test(profileEvidenceUrl.pathname)) {
      throw new Error('Amazon Ads 首次身份页面已失效，请重新启动当前店铺连接。');
    }
    await adsController.navigate(profileEvidenceUrl.href);
    await adsController.waitForTimeout(1_000);
    await navigateToLingxingDownloadCenter(
      adsController,
      readDownloadCenterPageModel(),
      pending.expectedStoreAlias,
    );
    const verifiedAdsPage = getControllerPageOrThrow(adsController);
    const observed = await readLingxingAdsProfileEvidence(
      verifiedAdsPage,
      pending.expectedStoreAlias,
    );
    if (observed.externalAccountId !== pending.detectedExternalAccountId) {
      throw new Error('可见 Ads 窗口已切换到其他广告账户，本次店铺绑定已停止。');
    }
    const observedAt = new Date().toISOString();
    const readyConnection = mainRuntimeContext.state.db!.transaction(() => {
      const connection = enrollConfirmedAmazonAdsConnection({
        context,
        connection: pending.connection,
        accountLabel: observed.alias
          || pending.detectedAccountLabel
          || pending.connection.accountLabel
          || pending.expectedStoreAlias,
        externalAccountId: pending.detectedExternalAccountId,
        expectedStoreAlias: pending.expectedStoreAlias,
        observedAt,
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
    mainRuntimeContext.visibleBrowserRuntimeRegistry.verifyAmazonAdsIdentity(pending.claim, readyConnection);
    const currentSession = mainRuntimeContext.state.loginSession;
    if (!currentSession) {
      throw new Error('当前领星会话投影已失效，请重新启动当前店铺连接。');
    }
    const { adsIdentityCandidate: _candidate, adsUnavailableReason: _reason, ...sessionBase } = currentSession;
    const loginResult: BrowserLoginResult = {
      ...sessionBase,
      adsSessionReady: true,
      adsEntryMode: pending.adsSession.entryMode,
      adsUrl: pending.adsSession.adsUrl,
      adsTitle: pending.adsSession.adsTitle,
    };
    mainRuntimeContext.pendingAmazonAdsIdentityConfirmation = null;
    mainRuntimeContext.pendingAmazonAdsIdentityRetry = null;
    mainRuntimeContext.state.isLoggedIn = true;
    mainRuntimeContext.state.loginSession = loginResult;
    const view = mainRuntimeContext.state.storeCoordinator!.getActiveStoreWorkspaceView();
    if (view) publishStoreContextChanged(view);
    await mainRuntimeContext.state.executionAuthorityService!.resumePolicyGrantDispatches(
      context,
      'session_ready',
    ).catch(() => {
      runtimeLog.error('[Execution] persisted policy-grant recovery failed after confirmed Ads identity');
    });
    return loginResult;
  };
  return mainRuntimeContext.packageUiReadOnlyRuntime
    ? withPackageUiVisibleLoginContinuationMutation(
        'browser:confirm-ads-identity',
        context,
        confirm,
      )
    : mainRuntimeContext.state.storeCollectionMainRuntime.withUserStoreMutation(mutationScope, confirm);
}
