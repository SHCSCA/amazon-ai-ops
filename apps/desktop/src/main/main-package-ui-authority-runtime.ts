import type { StoreCollectionScheduleProjection, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { sameExactStoreContext } from './main-browser-session-runtime';
import { getMainRuntimeContext } from './main-runtime-access';

export function readPackageUiStoreCollectionSchedule(
  contextInput: StoreContextEnvelope,
): StoreCollectionScheduleProjection {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.packageUiReadOnlyRuntime) {
    throw new Error('PACKAGE_UI_SCHEDULER_PROJECTION_DISABLED');
  }
  if (!mainRuntimeContext.state.storeCoordinator || !mainRuntimeContext.state.storeRuntimeConfigService) {
    throw new Error('正式验收的店铺计划只读服务尚未就绪。');
  }
  const context = mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(contextInput);
  if (
    context.marketplace !== 'US'
    || context.currency !== 'USD'
    || context.businessTimezone !== 'America/Los_Angeles'
  ) {
    throw new Error('正式验收只允许读取当前 Amazon 美国站 / USD 店铺计划。');
  }
  const config = mainRuntimeContext.state.storeRuntimeConfigService.get(context).current;
  if (!config) {
    return {
      storeId: context.storeId,
      businessDate: context.businessDate,
      enabled: false,
      state: 'not_configured',
      detail: '当前店铺尚未配置采集计划。',
    };
  }
  if (
    config.storeId !== context.storeId
    || config.marketplace !== context.marketplace
    || config.currency !== context.currency
    || config.businessTimezone !== context.businessTimezone
  ) {
    throw new Error('正式验收的店铺计划配置与当前 StoreContext 不一致。');
  }
  if (config.status === 'archived') {
    return {
      storeId: context.storeId,
      businessDate: context.businessDate,
      enabled: false,
      state: 'archived',
      detail: '当前店铺采集配置已归档。',
      scheduleLocalTime: config.values.collectionScheduleLocalTime,
      configRevision: config.revision,
    };
  }
  return {
    storeId: context.storeId,
    businessDate: context.businessDate,
    enabled: false,
    state: 'failed',
    detail: '正式验收使用独立 Windows Profile，受保护的采集历史不能跨隔离环境解密；真实采集和广告执行保持阻断。',
    scheduleLocalTime: config.values.collectionScheduleLocalTime,
    configRevision: config.revision,
  };
}

export function authorizePackageUiDatabaseCheckpoint(): StoreContextEnvelope {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.packageUiReadOnlyRuntime) {
    throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_DISABLED');
  }
  if (!mainRuntimeContext.state.db) {
    throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_UNAVAILABLE');
  }
  const coordinator = mainRuntimeContext.state.storeCoordinator;
  const activeContext = coordinator?.getActiveStoreContext();
  if (!coordinator || !activeContext) {
    throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_CONTEXT_UNAVAILABLE');
  }
  const authorized = coordinator.assertActiveStoreContext(activeContext);
  if (authorized.marketplace !== 'US' || authorized.currency !== 'USD') {
    throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_USD_CONTEXT_REQUIRED');
  }
  if (authorized.businessTimezone !== 'America/Los_Angeles') {
    throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_TIMEZONE_REQUIRED');
  }
  const visibleRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  const sessionStatePresent = Boolean(visibleRuntime || mainRuntimeContext.state.isLoggedIn || mainRuntimeContext.state.loginSession);
  if (sessionStatePresent && (
    !visibleRuntime
    || visibleRuntime.purpose !== 'operator_full'
    || !sameExactStoreContext(visibleRuntime.context, authorized)
    || visibleRuntime.providerIdentityStatus.lingxing !== 'verified'
    || visibleRuntime.providerIdentityStatus.amazonAds !== 'verified'
    || mainRuntimeContext.state.isLoggedIn !== true
    || mainRuntimeContext.state.loginSession?.ok !== true
    || mainRuntimeContext.state.loginSession?.erpSessionReady !== true
    || mainRuntimeContext.state.loginSession?.adsSessionReady !== true
  )) {
    throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_SESSION_NOT_VERIFIED');
  }
  return authorized;
}
