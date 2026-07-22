import type {
  MissionControlBootstrapProjection,
  MissionControlCapabilityProjection,
  MissionControlCommandRequest,
  MissionControlCommandStatus,
  MissionControlQueryRequest,
  MissionControlSetAutonomyModeCommandResponse,
  MissionControlTodayProjection,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { missionControlContextKey } from '@amazon-ai-ops/shared-types';

export interface MissionControlBootstrapBody {
  query: 'workspace-bootstrap';
  data: MissionControlBootstrapProjection;
}

export interface MissionControlCommandBody {
  command: 'set-autonomy-mode';
  status: MissionControlCommandStatus;
  currentMode: MissionControlSetAutonomyModeCommandResponse['currentMode'];
  blockerCode?: string;
  detail: string;
}

export interface MissionControlAdapter {
  query(
    request: MissionControlQueryRequest,
    authoritativeContext: StoreContextEnvelope,
  ): Promise<MissionControlBootstrapBody> | MissionControlBootstrapBody;
  command(
    request: MissionControlCommandRequest,
    authoritativeContext: StoreContextEnvelope,
  ): Promise<MissionControlCommandBody> | MissionControlCommandBody;
}

export interface MissionControlAdapterOptions {
  buildTodayProjection?(context: StoreContextEnvelope): MissionControlTodayProjection;
}

const UNSCOPED_LEGACY_BLOCKER = 'STORE_SCOPED_LEGACY_ADAPTER_NOT_IMPLEMENTED';

/**
 * Stage 2 exposes the new shell without pretending that the old unscoped
 * handlers are store-safe. Every legacy-backed row stays blocked until its
 * backend accepts and verifies a Main-authorized StoreContextEnvelope.
 */
export const MISSION_CONTROL_CAPABILITIES: readonly MissionControlCapabilityProjection[] = [
  serviceBlocked('today.overview.view', 'today', 'today/overview', 'view', '今日真实投影提供器尚未接入 Main。'),
  native('today.events.view', 'today', 'today/events', 'view', '运营事件由 Main 当前店铺对象服务按 store_id 查询。'),
  native('today.events.create', 'today', 'today/events', 'create', '运营事件创建绑定当前店铺、美国站业务日与 USD 范围。'),
  native('today.events.update', 'today', 'today/events', 'update', '运营事件更新验证当前 StoreContext 与 expectedRevision。'),
  native('today.events.archive', 'today', 'today/events', 'archive', '运营事件采用可恢复归档并验证 expectedRevision。'),
  native('today.events.restore', 'today', 'today/events', 'restore', '已归档运营事件可在当前店铺数据域内恢复。'),
  serviceBlocked('missions.mission.view', 'missions', 'missions/overview', 'view', '任务服务尚未接入 Main。'),
  serviceBlocked('missions.mission.create', 'missions', 'missions/overview', 'create', '任务创建服务尚未接入 Main。'),
  serviceBlocked('missions.mission.update', 'missions', 'missions/overview', 'update', '任务更新服务尚未接入 Main。'),
  serviceBlocked('missions.mission.pause', 'missions', 'missions/overview', 'pause', '任务暂停服务尚未接入 Main。'),
  serviceBlocked('missions.mission.resume', 'missions', 'missions/overview', 'resume', '任务恢复服务尚未接入 Main。'),
  serviceBlocked('missions.mission.archive', 'missions', 'missions/overview', 'archive', '任务归档服务尚未接入 Main。'),
  serviceBlocked('missions.mission.delete', 'missions', 'missions/overview', 'delete', '任务删除服务尚未接入 Main。'),
  serviceBlocked('missions.mission.facts.view', 'missions', 'missions/facts', 'view', '任务事实服务尚未接入 Main。'),
  blocked('decisions.recommendations.view', 'decisions', 'decisions/recommendations', 'recommendations', '建议列表尚未接入按店铺授权的后端。'),
  blocked('decisions.approval.view', 'decisions', 'decisions/approval', 'approval', '审批队列尚未接入按店铺授权的后端。'),
  blocked('decisions.decided.view', 'decisions', 'decisions/decided', 'approval', '已决策记录尚未接入按店铺授权的后端。'),
  serviceBlocked('experiments.experiment.view', 'experiments', 'experiments/ledger', 'view', '实验服务尚未接入 Main。'),
  serviceBlocked('experiments.experiment.create', 'experiments', 'experiments/ledger', 'create', '实验创建服务尚未接入 Main。'),
  serviceBlocked('experiments.experiment.update', 'experiments', 'experiments/ledger', 'update', '实验更新服务尚未接入 Main。'),
  serviceBlocked('experiments.experiment.pause', 'experiments', 'experiments/ledger', 'pause', '实验暂停服务尚未接入 Main。'),
  serviceBlocked('experiments.experiment.resume', 'experiments', 'experiments/ledger', 'resume', '实验恢复服务尚未接入 Main。'),
  serviceBlocked('experiments.experiment.archive', 'experiments', 'experiments/ledger', 'archive', '实验归档服务尚未接入 Main。'),
  serviceBlocked('experiments.experiment.delete', 'experiments', 'experiments/ledger', 'delete', '实验删除服务尚未接入 Main。'),
  serviceBlocked('execution.queue.view', 'execution', 'execution/live', 'view', '真实执行队列尚未接入 Main。'),
  serviceBlocked('execution.queue.start', 'execution', 'execution/live', 'start', '真实执行启动服务尚未接入 Main。'),
  serviceBlocked('execution.queue.takeover', 'execution', 'execution/live', 'takeover', '执行接管服务尚未接入 Main。'),
  serviceBlocked('execution.queue.reconcile-unknown', 'execution', 'execution/live', 'reconcile-unknown', 'UNKNOWN 对账服务尚未接入 Main。'),
  serviceBlocked('execution.queue.skip', 'execution', 'execution/live', 'skip', '执行跳过服务尚未接入 Main。'),
  serviceBlocked('execution.queue.kill-switch', 'execution', 'execution/live', 'kill-switch', '执行急停服务尚未接入 Main。'),
  blocked('execution.evidence.view', 'execution', 'execution/evidence', 'readback', '执行证据仍依赖未按店铺隔离的旧回读查询。'),
  serviceBlocked('memory.timeline.view', 'memory', 'memory/timeline', 'view', '因果记忆服务尚未接入 Main。'),
  serviceBlocked('memory.timeline.export', 'memory', 'memory/timeline', 'export', '记忆导出服务尚未接入 Main。'),
  serviceBlocked('memory.timeline.rebuild-index', 'memory', 'memory/timeline', 'rebuild-index', '记忆索引重建服务尚未接入 Main。'),
  native('objects.products.view', 'objects', 'objects/products', 'view', '产品与运营事件由 Main 当前店铺对象服务投影。'),
  native('objects.products.create', 'objects', 'objects/products', 'create', '产品创建使用当前 StoreContext 与 US/USD 边界。'),
  native('objects.products.update', 'objects', 'objects/products', 'update', '产品和 USD 成本目标更新使用 expectedRevision。'),
  native('objects.products.archive', 'objects', 'objects/products', 'archive', '产品采用可恢复归档并验证 expectedRevision。'),
  native('objects.events.view', 'objects', 'objects/products', 'view', '运营事件按当前 store_id 查询。'),
  native('objects.events.create', 'objects', 'objects/products', 'create', '运营事件创建绑定当前店铺与美国业务日期。'),
  native('objects.events.update', 'objects', 'objects/products', 'update', '运营事件更新验证 expectedRevision。'),
  native('objects.events.delete', 'objects', 'objects/products', 'delete', '运营事件删除验证 expectedRevision。'),
  native('objects.store.view', 'objects', 'objects/products', 'view', 'Stage 1 店铺列表由 Main StoreCoordinator 提供。'),
  native('objects.store.create', 'objects', 'objects/products', 'create', 'Stage 1 店铺创建由 Main StoreCoordinator 分配逻辑身份。'),
  native('objects.store.update', 'objects', 'objects/products', 'update', 'Stage 1 店铺更新由 Main StoreCoordinator 校验并持久化。'),
  native('objects.store.archive', 'objects', 'objects/products', 'archive', 'Stage 1 删除语义为 Main 授权的可恢复归档。'),
  native('objects.store.restore', 'objects', 'objects/products', 'restore', 'Stage 1 店铺恢复由 Main StoreCoordinator 授权。'),
  native('objects.store.switch', 'objects', 'objects/products', 'switch', 'Stage 1 店铺切换发布新的 Main authority context。'),
  native('objects.targets.view', 'objects', 'objects/targets', 'view', '广告对象从当前 store_id 的真实广告指标聚合读取。'),
  native('objects.keywords.view', 'objects', 'objects/keywords', 'view', '关键词指标与机会按当前 store_id 合并读取。'),
  native('objects.listing.view', 'objects', 'objects/listing', 'view', 'Listing 内容由当前店铺本地内容服务读取。'),
  native('objects.listing.create', 'objects', 'objects/listing', 'create', 'Listing 创建绑定当前 StoreContext 与 Amazon US。'),
  native('objects.listing.update', 'objects', 'objects/listing', 'update', 'Listing 更新强制验证 expectedRevision。'),
  native('objects.listing.delete', 'objects', 'objects/listing', 'delete', 'Listing 删除强制验证 expectedRevision 并保留版本历史。'),
  adapted('collection.scope.view', 'collection', 'collection/scope', 'operation-scope', '采集范围按 store_id 持久化，并由 Main 复核完整 StoreContext。'),
  adaptedAction('collection.scope.update', 'collection', 'collection/scope', 'update', 'operation-scope', '范围保存绑定当前美国站店铺、USD 与当前 session generation。'),
  adapted('collection.reports.view', 'collection', 'collection/reports', 'data-collection', '可见领星采集页已绑定 Main StoreContext、独立 Profile、持久化任务与导入生命周期。'),
  adaptedAction('collection.reports.start', 'collection', 'collection/reports', 'start', 'data-collection', '创建及重新创建真实领星任务前由 Main 重新授权当前店铺。'),
  adaptedAction('collection.reports.resume', 'collection', 'collection/reports', 'resume', 'data-collection', '恢复任务只允许使用当前店铺的持久化 lineage。'),
  adaptedAction('collection.reports.cancel', 'collection', 'collection/reports', 'pause', 'data-collection', '取消任务必须匹配当前店铺、job 与 request。'),
  adaptedAction('collection.reports.import', 'collection', 'collection/reports', 'import', 'data-collection', '导入只接受当前店铺与当前采集 lineage 的真实文件。'),
  adaptedAction('collection.reports.open-artifact', 'collection', 'collection/reports', 'view', 'data-collection', '采集产物通过 Main 受控句柄打开，不接受 Renderer 任意路径。'),
  adapted('collection.import-check.view', 'collection', 'collection/import-check', 'data-import-validation', '导入检查复用按 store_id、批次与当前范围隔离的生产数据管线。'),
  adaptedAction('collection.import-check.import', 'collection', 'collection/import-check', 'import', 'data-import-validation', '当前批次和本地文件导入均由 Main 重新校验当前店铺。'),
  adaptedAction('collection.import-check.export', 'collection', 'collection/import-check', 'export', 'data-import-validation', '对账导出只包含当前店铺与当前范围。'),
  adaptedAction('collection.import-check.open-artifact', 'collection', 'collection/import-check', 'view', 'data-import-validation', '对账产物通过 Main 受控句柄打开。'),
  serviceBlocked('policy.version.view', 'policy', 'policy/rules', 'view', '版本化策略服务尚未接入 Main。'),
  serviceBlocked('policy.version.create', 'policy', 'policy/rules', 'create', '策略版本创建服务尚未接入 Main。'),
  serviceBlocked('policy.version.update', 'policy', 'policy/rules', 'update', '策略版本更新服务尚未接入 Main。'),
  serviceBlocked('policy.version.enable', 'policy', 'policy/rules', 'enable', '策略启用服务尚未接入 Main。'),
  serviceBlocked('policy.version.disable', 'policy', 'policy/rules', 'disable', '策略停用服务尚未接入 Main。'),
  serviceBlocked('policy.version.publish', 'policy', 'policy/rules', 'publish', '策略发布服务尚未接入 Main。'),
  serviceBlocked('policy.kill-switch.enable', 'policy', 'policy/rules', 'enable', '全局策略急停服务尚未接入 Main。'),
  blocked('settings.ai-and-local.view', 'settings', 'settings/ai-and-local', 'settings', 'AI 与本地设置尚未接入按店铺授权的配置。'),
  serviceBlocked('settings.store-config.create', 'settings', 'settings/ai-and-local', 'create', '店铺级设置创建服务尚未接入 Main。'),
  serviceBlocked('settings.store-config.update', 'settings', 'settings/ai-and-local', 'update', '店铺级设置更新服务尚未接入 Main。'),
  serviceBlocked('settings.store-config.archive', 'settings', 'settings/ai-and-local', 'archive', '店铺级设置归档服务尚未接入 Main。'),
  blocked('settings.scheduler.view', 'settings', 'settings/scheduler', 'scheduler', '定时任务尚未接入按店铺授权的配置。'),
  blocked('settings.delivery.view', 'settings', 'settings/delivery', 'delivery', '交付状态尚未接入按店铺授权的查询。'),
] as const;

export function createMissionControlLegacyAdapter(
  options: MissionControlAdapterOptions = {},
): MissionControlAdapter {
  return {
    query(request, authoritativeContext) {
      if (request.query !== 'workspace-bootstrap') {
        throw new TypeError('unsupported Mission Control query');
      }
      const capabilities = MISSION_CONTROL_CAPABILITIES.map((capability) => (
        options.buildTodayProjection && capability.capabilityId === 'today.overview.view'
          ? native(
              capability.capabilityId,
              capability.workspace,
              capability.view,
              capability.action,
              '当前店铺今日准备度由 Main 从真实采集 lineage、导入、产品和浏览器状态投影。',
            )
          : { ...capability }
      ));
      const projectedToday = options.buildTodayProjection?.(authoritativeContext)
        ?? unavailableTodayProjection(authoritativeContext);
      return {
        query: 'workspace-bootstrap',
        data: {
          capabilities,
          autonomy: {
            currentMode: 'manual_approval',
            manualApprovalAvailable: true,
            policyAutoAvailable: false,
            policyAutoBlockerCode: 'POLICY_AUTO_AUTHORITY_NOT_IMPLEMENTED',
            policyAutoBlockerDetail: '全自动模式尚未实现 Main 授权、逐动作策略校验与真实回读闭环。',
          },
          today: authorizeTodayNextAction(projectedToday, capabilities),
        },
      };
    },
    command(request) {
      if (request.command !== 'set-autonomy-mode') {
        throw new TypeError('unsupported Mission Control command');
      }
      if (request.payload.mode === 'policy_auto') {
        return {
          command: 'set-autonomy-mode',
          status: 'BLOCKED',
          currentMode: 'manual_approval',
          blockerCode: 'POLICY_AUTO_AUTHORITY_NOT_IMPLEMENTED',
          detail: '全自动模式未获得 Main 授权；系统继续保持人工审批。',
        };
      }
      return {
        command: 'set-autonomy-mode',
        status: 'NOOP',
        currentMode: 'manual_approval',
        detail: '系统已处于人工审批模式。',
      };
    },
  };
}

function authorizeTodayNextAction(
  projection: MissionControlTodayProjection,
  capabilities: readonly MissionControlCapabilityProjection[],
): MissionControlTodayProjection {
  const capability = capabilities.find((candidate) => (
    candidate.capabilityId === projection.nextAction.requiredCapabilityId
    && candidate.view === projection.nextAction.targetView
    && candidate.action === 'view'
  ));
  const available = capability?.state === 'PRODUCTION_NATIVE'
    || capability?.state === 'LEGACY_ADAPTER';
  return {
    ...projection,
    nextAction: {
      ...projection.nextAction,
      available,
      ...(available
        ? { blockerCode: undefined }
        : { blockerCode: capability?.blockerCode ?? 'TARGET_CAPABILITY_NOT_AUTHORIZED' }),
    },
  };
}

function unavailableTodayProjection(
  context: StoreContextEnvelope,
): MissionControlTodayProjection {
  return {
    storeId: context.storeId,
    authorityKey: missionControlContextKey(context),
    businessDate: context.businessDate,
    marketplace: 'US',
    currency: 'USD',
    generatedAt: new Date().toISOString(),
    facts: {
      productCount: 0,
      configuredProductCount: 0,
      collectionJobCount: 0,
      importedMetricRows: 0,
      operationEventsToday: 0,
      browserSessionReady: false,
    },
    readiness: [
      {
        id: 'collection',
        label: '领星八报表',
        state: 'blocked',
        detail: '今日真实采集投影提供器尚未接入。',
        targetView: 'collection/reports',
      },
      {
        id: 'import',
        label: '广告事实入库',
        state: 'blocked',
        detail: '尚无可验证导入状态。',
        targetView: 'collection/import-check',
      },
      {
        id: 'products',
        label: '产品与经营目标',
        state: 'blocked',
        detail: '尚无当前店铺产品投影。',
        targetView: 'objects/products',
      },
      {
        id: 'browser',
        label: '可见浏览器会话',
        state: 'blocked',
        detail: '当前店铺浏览器会话未确认。',
        targetView: 'collection/reports',
      },
    ],
    blockers: ['今日真实投影提供器尚未接入 Main。'],
    attentionItems: [],
    nextAction: {
      id: 'open-collection',
      label: '打开数据采集',
      detail: '先为当前店铺建立真实领星采集与导入事实。',
      targetView: 'collection/reports',
      requiredCapabilityId: 'collection.reports.view',
      available: false,
      blockerCode: 'TARGET_CAPABILITY_NOT_AUTHORIZED',
    },
  };
}

function blocked(
  capabilityId: string,
  workspace: MissionControlCapabilityProjection['workspace'],
  view: MissionControlCapabilityProjection['view'],
  legacyRoute: NonNullable<MissionControlCapabilityProjection['legacyRoute']>,
  detail: string,
): MissionControlCapabilityProjection {
  return {
    capabilityId,
    workspace,
    view,
    action: 'view',
    state: 'BLOCKED',
    legacyRoute,
    blockerCode: UNSCOPED_LEGACY_BLOCKER,
    detail,
  };
}

function native(
  capabilityId: string,
  workspace: MissionControlCapabilityProjection['workspace'],
  view: MissionControlCapabilityProjection['view'],
  action: MissionControlCapabilityProjection['action'],
  detail: string,
): MissionControlCapabilityProjection {
  return {
    capabilityId,
    workspace,
    view,
    action,
    state: 'PRODUCTION_NATIVE',
    detail,
  };
}

function adapted(
  capabilityId: string,
  workspace: MissionControlCapabilityProjection['workspace'],
  view: MissionControlCapabilityProjection['view'],
  legacyRoute: NonNullable<MissionControlCapabilityProjection['legacyRoute']>,
  detail: string,
): MissionControlCapabilityProjection {
  return adaptedAction(capabilityId, workspace, view, 'view', legacyRoute, detail);
}

function adaptedAction(
  capabilityId: string,
  workspace: MissionControlCapabilityProjection['workspace'],
  view: MissionControlCapabilityProjection['view'],
  action: MissionControlCapabilityProjection['action'],
  legacyRoute: NonNullable<MissionControlCapabilityProjection['legacyRoute']>,
  detail: string,
): MissionControlCapabilityProjection {
  return {
    capabilityId,
    workspace,
    view,
    action,
    state: 'LEGACY_ADAPTER',
    legacyRoute,
    detail,
  };
}

function serviceBlocked(
  capabilityId: string,
  workspace: MissionControlCapabilityProjection['workspace'],
  view: MissionControlCapabilityProjection['view'],
  action: MissionControlCapabilityProjection['action'],
  detail: string,
): MissionControlCapabilityProjection {
  return {
    capabilityId,
    workspace,
    view,
    action,
    state: 'BLOCKED',
    blockerCode: 'MISSION_CONTROL_SERVICE_NOT_IMPLEMENTED',
    detail,
  };
}
