import * as path from 'path';
import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import type { StoreConnectionProvider, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { canonicalizeAmazonAsin } from '@amazon-ai-ops/shared-types';
import { runtimeLog } from './runtime-log-adapter';
import { type RecommendationBidObservation } from './recommendation-live-bid';
import { discoverLingxingAdsKeywordTarget, navigateToLingxingAdsCampaignKeywordTarget } from './lingxing-ads-sso';
import { browserControllerFromVisibleRuntime, browserRuntimeController, sameExactStoreContext } from './main-browser-session-runtime';
import { storeCapsuleFor } from './main-store-access-runtime';
import type { DiscoverRecommendationTargetRequest, LegacyOperatorBrowserAccess } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export function withLegacyOperatorBrowserLease<Result>(
  provider: StoreConnectionProvider,
  owner: string,
  work: (access: LegacyOperatorBrowserAccess) => Promise<Result> | Result,
): Promise<Result> {
  const mainRuntimeContext = getMainRuntimeContext();
  const runtime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  const controller = browserRuntimeController(provider);
  if (!runtime
    || runtime.purpose !== 'operator_full'
     || !controller
     || !mainRuntimeContext.state.storeCoordinator
     || !mainRuntimeContext.state.executionAuthorityService
     || !mainRuntimeContext.state.isLoggedIn
     || mainRuntimeContext.state.loginSession === null) {
    throw new Error('OPERATOR_FULL_VISIBLE_BROWSER_REQUIRED');
  }
  const context = mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(runtime.context);
  return mainRuntimeContext.state.executionAuthorityService.withAdmittedBrowserOperation(
    `legacy:${owner}`,
    () => {
      
      
      
      const lease = mainRuntimeContext.browserOperationLeases.acquire({
        storeId: context.storeId,
        purpose: 'external_write',
        owner,
      });
      return performLegacyOperatorBrowserWork(
        { provider, runtime, context, controller, lease },
        work,
      );
    },
  );
}

export async function performLegacyOperatorBrowserWork<Result>(
  access: LegacyOperatorBrowserAccess,
  work: (access: LegacyOperatorBrowserAccess) => Promise<Result> | Result,
): Promise<Result> {
  const mainRuntimeContext = getMainRuntimeContext();
  try {
    assertLegacyOperatorBrowserAccessCurrent(access);
    const result = await work(access);
    assertLegacyOperatorBrowserAccessCurrent(access);
    return result;
  } finally {
    mainRuntimeContext.browserOperationLeases.release(access.lease);
  }
}

export function assertLegacyOperatorBrowserAccessCurrent(access: LegacyOperatorBrowserAccess): void {
  const mainRuntimeContext = getMainRuntimeContext();
  mainRuntimeContext.browserOperationLeases.assertCurrent(access.lease);
  const current = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  if (!current
    || current.runtimeId !== access.runtime.runtimeId
    || current.epoch !== access.runtime.epoch
    || current.purpose !== 'operator_full'
    || current.providerIdentityStatus.lingxing !== 'verified'
    || (access.provider === 'amazon_ads'
      && current.providerIdentityStatus.amazonAds !== 'verified')
    || !sameExactStoreContext(current.context, access.context)
    || !mainRuntimeContext.state.isLoggedIn
    || mainRuntimeContext.state.loginSession === null
    || browserControllerFromVisibleRuntime(current, access.provider) !== access.controller
    || !access.controller.getPage()) {
    throw new Error('OPERATOR_VISIBLE_BROWSER_AUTHORITY_CHANGED');
  }
}

export async function captureOperatorScreenshotCore(
  access: LegacyOperatorBrowserAccess,
  label: 'before' | 'after' | 'error',
): Promise<string> {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.storeRepo) throw new Error('Store repository not initialized');
  const { context, controller } = access;
  const store = mainRuntimeContext.state.storeRepo.getStore(context.storeId);
  if (!store) throw new Error('Active store not found');
  const screenshotPath = path.join(
    storeCapsuleFor(store).screenshotsDir,
    `${label}_${Date.now()}.png`,
  );
  const screenshot = await controller.screenshotToPath(screenshotPath, label);
  return screenshot.path;
}

export function handleScreenshot(label: 'before' | 'after' | 'error'): Promise<string> {
  return withLegacyOperatorBrowserLease(
    'lingxing',
    `legacy-lingxing-screenshot:${label}`,
    (access) => captureOperatorScreenshotCore(access, label),
  );
}

export async function handleDiscoverRecommendationTarget(input: DiscoverRecommendationTargetRequest) {
  const mainRuntimeContext = getMainRuntimeContext();
  const recommendationId = Number(input?.recommendationId);
  if (!Number.isInteger(recommendationId) || recommendationId <= 0) {
    throw new Error('Ads 对象识别被阻断：缺少有效建议。');
  }
  if (!mainRuntimeContext.state.storeCoordinator || !mainRuntimeContext.state.recommendationRepo) {
    throw new Error('Ads 对象识别被阻断：当前店铺权威尚未就绪。');
  }
  const context = mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(input.context);
  return withLegacyOperatorBrowserLease(
    'amazon_ads',
    `discover-recommendation-target:${recommendationId}`,
    async (access) => {
      if (!sameExactStoreContext(access.context, context)) {
        throw new Error('Ads 对象识别被阻断：可见页面不属于当前店铺会话。');
      }
      if (!mainRuntimeContext.state.recommendationRepo) {
        throw new Error('Ads 对象识别被阻断：建议仓储已停止。');
      }
      const recommendation = mainRuntimeContext.state.recommendationRepo.findByIdForStore(context.storeId, recommendationId);
      if (!recommendation || recommendation.status !== 'pending') {
        throw new Error('Ads 对象识别被阻断：建议不存在或已不是待处理状态。');
      }
      if (recommendation.evidence?.writableTarget || recommendation.evidence?.writableTargetBinding) {
        throw new Error('Ads 对象识别被阻断：建议已有可写对象，禁止自动覆盖。');
      }
      const evidence = recommendation.evidence;
      const campaignName = String(evidence?.campaignName ?? '').trim();
      const adGroupName = String(evidence?.adGroupName ?? '').trim();
      const entityName = String(recommendation.entityName ?? evidence?.targeting ?? '').trim();
      let recommendationAsin: string;
      try {
        recommendationAsin = canonicalizeAmazonAsin(recommendation.asin);
      } catch {
        throw new Error('Ads 对象识别被阻断：权威建议缺少有效 ASIN，禁止从当前界面范围猜测产品。');
      }
      const recommendationMatchType = String(evidence?.matchType ?? '').normalize('NFKC').trim();
      const reportType = String(evidence?.reportType ?? '').trim().toLowerCase();
      const sourceFile = String(evidence?.sourceFile ?? '').trim();
      const sourceRow = Number(evidence?.sourceRow);
      const currentBidCents = Math.round(Number(recommendation.currentValue) * 100);
      if (reportType !== 'keyword'
        || !campaignName
        || !adGroupName
        || !entityName
        || !recommendationMatchType
        || !sourceFile
        || !Number.isInteger(sourceRow)
        || sourceRow <= 0
        || !Number.isSafeInteger(currentBidCents)
        || currentBidCents < 0) {
        throw new Error('Ads 对象识别被阻断：建议缺少产品、活动、广告组、关键词、匹配方式或当前竞价证据。');
      }
      const externalAccountId = access.runtime.connections?.amazonAds?.externalAccountId?.trim();
      const expectedStoreAlias = (
        access.runtime.connections?.lingxing?.collectionStoreName
        || access.runtime.connections?.amazonAds?.accountLabel
        || ''
      ).trim();
      const page = access.controller.getPage();
      if (!externalAccountId || !expectedStoreAlias || !page) {
        throw new Error('Ads 对象识别被阻断：当前店铺 Ads 页面或稳定身份不可用。');
      }
      let pageIdentity;
      try {
        await navigateToLingxingAdsCampaignKeywordTarget(page, {
          externalAccountId,
          campaignName,
          expectedStoreAlias,
        });
        pageIdentity = await discoverLingxingAdsKeywordTarget(page, {
          externalAccountId,
          campaignName,
          adGroupName,
          entityName,
          matchType: recommendationMatchType,
          currentBidCents,
        });
      } catch (error) {
        const diagnosticPath = await captureOperatorScreenshotCore(access, 'error').catch(() => undefined);
        const message = error instanceof Error ? error.message : '领星 Ads 页面识别失败，操作已阻断。';
        throw new Error(diagnosticPath ? `${message} 诊断截图：${diagnosticPath}` : message);
      }
      assertLegacyOperatorBrowserAccessCurrent(access);
      const identityProofPath = await captureOperatorScreenshotCore(access, 'before');
      assertLegacyOperatorBrowserAccessCurrent(access);
      return {
        recommendationId,
        recommendationRevision: recommendation.revision,
        recommendationAsin,
        recommendationMatchType,
        pageIdentity,
        writableTarget: {
          entityType: 'keyword' as const,
          entityId: pageIdentity.keywordId,
          sourceFile,
          sourceRow,
          identitySource: 'ads_ui' as const,
          identityProofPath,
          verificationNote: `当前店铺 Ads 页面已唯一匹配 ${campaignName} > ${adGroupName} > ${entityName}（${recommendationMatchType}），当前竞价 $${(currentBidCents / 100).toFixed(2)}。`,
        },
      };
    },
  );
}

export function createRecommendationBidReader(context: StoreContextEnvelope) {
  const mainRuntimeContext = getMainRuntimeContext();
  const observations = new Map<string, RecommendationBidObservation>();
  return async (recommendation: ActionRecommendation): Promise<RecommendationBidObservation> => {
    const campaignName = String(recommendation.evidence.campaignName || '').trim();
    const adGroupName = String(recommendation.evidence.adGroupName || '').trim();
    const entityName = recommendation.entityName.trim();
    const matchType = String(recommendation.evidence.matchType || '').trim();
    const asin = canonicalizeAmazonAsin(recommendation.asin);
    const key = JSON.stringify([asin, campaignName, adGroupName, entityName, matchType]);
    mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(context);
    const cached = observations.get(key);
    if (cached) return cached;
    const observation = await withLegacyOperatorBrowserLease('amazon_ads', 'analysis-current-keyword-bid', async (access) => {
      if (!sameExactStoreContext(access.context, context)) throw new Error('读取竞价时店铺会话已变化，请重新分析。');
      const externalAccountId = access.runtime.connections?.amazonAds?.externalAccountId?.trim();
      const expectedStoreAlias = access.runtime.connections?.lingxing?.collectionStoreName?.trim();
      const page = access.controller.getPage();
      if (!page || !externalAccountId || !expectedStoreAlias) throw new Error('请连接当前店铺 Ads 后再分析真实竞价；历史 CPC 不能作为竞价。');
      await navigateToLingxingAdsCampaignKeywordTarget(page, { externalAccountId, campaignName, expectedStoreAlias });
      const input = { externalAccountId, campaignName, adGroupName, entityName, matchType, currentBidCents: 'read_current' as const };
      const identity = await discoverLingxingAdsKeywordTarget(page, input);
      assertLegacyOperatorBrowserAccessCurrent(access);
      const identityProofPath = await captureOperatorScreenshotCore(access, 'before');
      const confirmed = await discoverLingxingAdsKeywordTarget(page, { ...input, currentBidCents: identity.bidCents });
      assertLegacyOperatorBrowserAccessCurrent(access);
      if (JSON.stringify(confirmed) !== JSON.stringify(identity)) throw new Error('读取竞价期间 Ads 对象变化，未生成建议。');
      return { ...identity, storeContext: context, observedAt: new Date().toISOString(), identityProofPath };
    });
    observations.set(key, observation);
    return observation;
  };
}

export function normalizeScreenshotLabel(value: unknown): 'before' | 'after' | 'error' {
  if (value !== 'before' && value !== 'after' && value !== 'error') {
    throw new TypeError('unsupported screenshot label');
  }
  return value;
}

export async function tryCaptureExecutionScreenshot(label: 'before' | 'after'): Promise<string | undefined> {
  try {
    return await withLegacyOperatorBrowserLease(
      'amazon_ads',
      `legacy-amazon-ads-screenshot:${label}`,
      (access) => captureOperatorScreenshotCore(access, label),
    );
  } catch (error) {
    runtimeLog.warn(`[AdExecution] ${label} screenshot unavailable; writing fail-closed audit without screenshot`, error);
    return undefined;
  }
}
