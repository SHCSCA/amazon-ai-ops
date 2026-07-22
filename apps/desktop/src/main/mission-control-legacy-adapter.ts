import type {
  MissionControlBootstrapProjection,
  MissionControlCapabilityProjection,
  MissionControlCommandRequest,
  MissionControlCommandStatus,
  MissionControlQueryRequest,
  MissionControlSetAutonomyModeCommandResponse,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';

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

const UNSCOPED_LEGACY_BLOCKER = 'STORE_SCOPED_LEGACY_ADAPTER_NOT_IMPLEMENTED';

/**
 * Stage 2 exposes the new shell without pretending that the old unscoped
 * handlers are store-safe. Every legacy-backed row stays blocked until its
 * backend accepts and verifies a Main-authorized StoreContextEnvelope.
 */
export const MISSION_CONTROL_CAPABILITIES: readonly MissionControlCapabilityProjection[] = [
  blocked('today.overview.view', 'today', 'today/overview', 'dashboard', '今日总览仍依赖未按店铺隔离的旧查询。'),
  blocked('today.events.view', 'today', 'today/events', 'operation-events', '运营事件仍依赖未按店铺隔离的旧查询。'),
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
  blocked('objects.products.view', 'objects', 'objects/products', 'product-management', '产品对象仍依赖未按店铺隔离的旧查询。'),
  native('objects.store.view', 'objects', 'objects/products', 'view', 'Stage 1 店铺列表由 Main StoreCoordinator 提供。'),
  native('objects.store.create', 'objects', 'objects/products', 'create', 'Stage 1 店铺创建由 Main StoreCoordinator 分配逻辑身份。'),
  native('objects.store.update', 'objects', 'objects/products', 'update', 'Stage 1 店铺更新由 Main StoreCoordinator 校验并持久化。'),
  native('objects.store.archive', 'objects', 'objects/products', 'archive', 'Stage 1 删除语义为 Main 授权的可恢复归档。'),
  native('objects.store.restore', 'objects', 'objects/products', 'restore', 'Stage 1 店铺恢复由 Main StoreCoordinator 授权。'),
  native('objects.store.switch', 'objects', 'objects/products', 'switch', 'Stage 1 店铺切换发布新的 Main authority context。'),
  blocked('objects.targets.view', 'objects', 'objects/targets', 'product-config', '目标配置仍依赖未按店铺隔离的旧查询。'),
  blocked('objects.keywords.view', 'objects', 'objects/keywords', 'keyword-opportunities', '关键词对象仍依赖未按店铺隔离的旧查询。'),
  blocked('objects.listing.view', 'objects', 'objects/listing', 'listing-optimization', 'Listing 对象仍依赖未按店铺隔离的旧查询。'),
  blocked('collection.scope.view', 'collection', 'collection/scope', 'operation-scope', '采集范围仍依赖未按店铺隔离的旧配置。'),
  blocked('collection.reports.view', 'collection', 'collection/reports', 'data-collection', '报表采集仍依赖未按店铺隔离的旧任务。'),
  blocked('collection.import-check.view', 'collection', 'collection/import-check', 'data-import-validation', '导入校验仍依赖未按店铺隔离的旧查询。'),
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

export function createMissionControlLegacyAdapter(): MissionControlAdapter {
  return {
    query(request) {
      if (request.query !== 'workspace-bootstrap') {
        throw new TypeError('unsupported Mission Control query');
      }
      return {
        query: 'workspace-bootstrap',
        data: {
          capabilities: MISSION_CONTROL_CAPABILITIES.map((capability) => ({ ...capability })),
          autonomy: {
            currentMode: 'manual_approval',
            manualApprovalAvailable: true,
            policyAutoAvailable: false,
            policyAutoBlockerCode: 'POLICY_AUTO_AUTHORITY_NOT_IMPLEMENTED',
            policyAutoBlockerDetail: '全自动模式尚未实现 Main 授权、逐动作策略校验与真实回读闭环。',
          },
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
