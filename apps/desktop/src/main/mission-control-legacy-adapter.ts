import type {
  MissionControlBootstrapProjection,
  MissionControlAutonomyMode,
  MissionControlAutonomyProjection,
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
  /**
   * Set only when the closed analysis authority IPC surface is registered.
   * This keeps the capability projection aligned with the actual composition
   * root instead of upgrading grant issuance merely because Mission CRUD exists.
   */
  analysisAuthorityReady?: boolean;
  /** Closed Main execution queue, evidence projection and takeover IPC are registered. */
  executionAuthorityReady?: boolean;
  /** Main-authorized, store-keyed operating configuration CRUD is registered. */
  storeRuntimeConfigReady?: boolean;
  /**
   * Main-only StoreContext scheduler plus retention dry-run preview are
   * registered. The view remains behind the legacy route compatibility
   * boundary while both operations are projected as exact native actions.
   */
  storeAutomationReady?: boolean;
  missionDomain?: {
    getAutonomyProjection(context: StoreContextEnvelope): {
      mode: MissionControlAutonomyMode;
      killSwitch: boolean;
      circuitBreakerState: 'closed' | 'open' | 'half_open';
      activePolicyVersionId?: string;
      revision: number;
      canAutoExecute: boolean;
    };
    setAutonomyMode(
      context: StoreContextEnvelope,
      input: { expectedRevision: number; mode: MissionControlAutonomyMode; reason?: string },
    ): {
      mode: MissionControlAutonomyMode;
      killSwitch: boolean;
      circuitBreakerState: 'closed' | 'open' | 'half_open';
      activePolicyVersionId?: string;
      revision: number;
      canAutoExecute: boolean;
    };
  };
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
  serviceBlocked('missions.mission.restore', 'missions', 'missions/overview', 'restore', '任务恢复归档服务尚未接入 Main。'),
  serviceBlocked('missions.mission.delete', 'missions', 'missions/overview', 'delete', '任务删除服务尚未接入 Main。'),
  serviceBlocked('missions.mission.facts.view', 'missions', 'missions/facts', 'view', '任务事实服务尚未接入 Main。'),
  serviceBlocked('missions.checkpoint.create', 'missions', 'missions/facts', 'create', '任务事实检查点追加服务尚未接入 Main。'),
  blocked('decisions.recommendations.view', 'decisions', 'decisions/recommendations', 'recommendations', '建议列表尚未接入按店铺授权的后端。'),
  serviceBlocked('decisions.recommendations.create', 'decisions', 'decisions/recommendations', 'create', '建议创建服务尚未接入 Main。'),
  serviceBlocked('decisions.recommendations.update', 'decisions', 'decisions/recommendations', 'update', '建议修订服务尚未接入 Main。'),
  blocked('decisions.approval.view', 'decisions', 'decisions/approval', 'approval', '审批队列尚未接入按店铺授权的后端。'),
  serviceBlocked('decisions.approval.approve', 'decisions', 'decisions/approval', 'approve', '人工批准服务尚未接入 Main。'),
  serviceBlocked('decisions.approval.reject', 'decisions', 'decisions/approval', 'reject', '人工拒绝与阻断服务尚未接入 Main。'),
  dependencyBlocked('decisions.grants.issue', 'decisions', 'decisions/decided', 'approve', 'AD_ENTITY_REGISTRY_NOT_IMPLEMENTED', 'MissionGrant 合同已就绪，但真实广告实体稳定身份注册表将在 Stage 6 接入。'),
  serviceBlocked('decisions.grants.revoke', 'decisions', 'decisions/decided', 'reject', '人工撤销 MissionGrant 服务尚未接入 Main。'),
  blocked('decisions.decided.view', 'decisions', 'decisions/decided', 'approval', '已决策记录尚未接入按店铺授权的后端。'),
  serviceBlocked('experiments.experiment.view', 'experiments', 'experiments/ledger', 'view', '实验服务尚未接入 Main。'),
  serviceBlocked('experiments.experiment.create', 'experiments', 'experiments/ledger', 'create', '实验创建服务尚未接入 Main。'),
  serviceBlocked('experiments.experiment.update', 'experiments', 'experiments/ledger', 'update', '实验更新服务尚未接入 Main。'),
  serviceBlocked('experiments.experiment.start', 'experiments', 'experiments/ledger', 'start', '实验启动服务尚未接入 Main。'),
  serviceBlocked('experiments.experiment.pause', 'experiments', 'experiments/ledger', 'pause', '实验暂停服务尚未接入 Main。'),
  serviceBlocked('experiments.experiment.resume', 'experiments', 'experiments/ledger', 'resume', '实验恢复服务尚未接入 Main。'),
  serviceBlocked('experiments.experiment.complete', 'experiments', 'experiments/ledger', 'complete', '实验完成服务尚未接入 Main。'),
  serviceBlocked('experiments.experiment.archive', 'experiments', 'experiments/ledger', 'archive', '实验归档服务尚未接入 Main。'),
  serviceBlocked('experiments.experiment.restore', 'experiments', 'experiments/ledger', 'restore', '实验恢复服务尚未接入 Main。'),
  serviceBlocked('experiments.observation.create', 'experiments', 'experiments/ledger', 'create', '实验观察追加服务尚未接入 Main。'),
  serviceBlocked('experiments.experiment.delete', 'experiments', 'experiments/ledger', 'delete', '实验删除服务尚未接入 Main。'),
  serviceBlocked('execution.queue.view', 'execution', 'execution/live', 'view', '真实执行队列尚未接入 Main。'),
  serviceBlocked('execution.queue.start', 'execution', 'execution/live', 'start', '真实执行启动服务尚未接入 Main。'),
  serviceBlocked('execution.queue.takeover', 'execution', 'execution/live', 'takeover', '执行接管服务尚未接入 Main。'),
  serviceBlocked('execution.queue.reconcile-unknown', 'execution', 'execution/live', 'reconcile-unknown', 'UNKNOWN 对账服务尚未接入 Main。'),
  serviceBlocked('execution.queue.skip', 'execution', 'execution/live', 'skip', '执行跳过服务尚未接入 Main。'),
  serviceBlocked('execution.queue.kill-switch', 'execution', 'execution/live', 'kill-switch', '执行急停服务尚未接入 Main。'),
  blocked('execution.evidence.view', 'execution', 'execution/evidence', 'readback', '执行证据仍依赖未按店铺隔离的旧回读查询。'),
  serviceBlocked('memory.timeline.view', 'memory', 'memory/timeline', 'view', '因果记忆服务尚未接入 Main。'),
  serviceBlocked('memory.timeline.create', 'memory', 'memory/timeline', 'create', '人工事实与分析追加服务尚未接入 Main。'),
  serviceBlocked('memory.timeline.correct', 'memory', 'memory/timeline', 'update', '因果记忆修正服务尚未接入 Main。'),
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
  serviceBlocked('policy.policy.create', 'policy', 'policy/rules', 'create', '策略创建服务尚未接入 Main。'),
  serviceBlocked('policy.policy.update', 'policy', 'policy/rules', 'update', '策略编辑服务尚未接入 Main。'),
  serviceBlocked('policy.policy.archive', 'policy', 'policy/rules', 'archive', '策略归档服务尚未接入 Main。'),
  serviceBlocked('policy.policy.restore', 'policy', 'policy/rules', 'restore', '策略恢复服务尚未接入 Main。'),
  serviceBlocked('policy.version.create', 'policy', 'policy/rules', 'create', '策略版本创建服务尚未接入 Main。'),
  serviceBlocked('policy.version.update', 'policy', 'policy/rules', 'update', '策略版本更新服务尚未接入 Main。'),
  serviceBlocked('policy.version.enable', 'policy', 'policy/rules', 'enable', '策略启用服务尚未接入 Main。'),
  serviceBlocked('policy.version.disable', 'policy', 'policy/rules', 'disable', '策略停用服务尚未接入 Main。'),
  serviceBlocked('policy.version.publish', 'policy', 'policy/rules', 'publish', '策略发布服务尚未接入 Main。'),
  serviceBlocked('policy.runtime.mode.set', 'policy', 'policy/rules', 'update', '店铺自治模式切换尚未接入 Main。'),
  serviceBlocked('policy.kill-switch.enable', 'policy', 'policy/rules', 'enable', '全局策略急停服务尚未接入 Main。'),
  serviceBlocked('policy.kill-switch.clear', 'policy', 'policy/rules', 'disable', '全局策略急停解除服务尚未接入 Main。'),
  blocked('settings.ai-and-local.view', 'settings', 'settings/ai-and-local', 'settings', 'AI 与本地设置尚未接入按店铺授权的配置。'),
  serviceBlocked('settings.store-config.create', 'settings', 'settings/ai-and-local', 'create', '店铺级设置创建服务尚未接入 Main。'),
  serviceBlocked('settings.store-config.update', 'settings', 'settings/ai-and-local', 'update', '店铺级设置更新服务尚未接入 Main。'),
  serviceBlocked('settings.store-config.archive', 'settings', 'settings/ai-and-local', 'archive', '店铺级设置归档服务尚未接入 Main。'),
  serviceBlocked('settings.store-config.restore', 'settings', 'settings/ai-and-local', 'restore', '店铺级设置恢复服务尚未接入 Main。'),
  blocked('settings.scheduler.view', 'settings', 'settings/scheduler', 'scheduler', '定时任务尚未接入按店铺授权的配置。'),
  serviceBlocked('settings.scheduler.run-now', 'settings', 'settings/scheduler', 'start', '当前店铺立即采集尚未接入 Main StoreContext 调度器。'),
  serviceBlocked('settings.scheduler.retention-preview', 'settings', 'settings/scheduler', 'view', '当前店铺证据保留 dry-run 尚未接入 Main。'),
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
      const capabilities = MISSION_CONTROL_CAPABILITIES.map((capability) => {
        if (options.buildTodayProjection && capability.capabilityId === 'today.overview.view') {
          return native(
            capability.capabilityId,
            capability.workspace,
            capability.view,
            capability.action,
            '当前店铺今日准备度由 Main 从真实采集 lineage、导入、产品和浏览器状态投影。',
          );
        }
        if (options.analysisAuthorityReady && capability.capabilityId === 'decisions.grants.issue') {
          return native(
            capability.capabilityId,
            capability.workspace,
            capability.view,
            capability.action,
            '整批授权只接受 Main 封存的同一分析 action batch，并复核 Evidence、Decision、策略与稳定 Ads 实体版本。',
          );
        }
        if (options.executionAuthorityReady && [
          'execution.queue.view',
          'execution.queue.start',
          'execution.queue.takeover',
          'execution.evidence.view',
        ].includes(capability.capabilityId)) {
          return native(
            capability.capabilityId,
            capability.workspace,
            capability.view,
            capability.action,
            '真实执行由 Main 从不可变授权重建命令，串行写入并保留 before / after / reload 证据；Renderer 不能提交竞价、Ads ID 或本地路径。',
          );
        }
        if (options.storeRuntimeConfigReady && capability.capabilityId === 'settings.ai-and-local.view') {
          return adapted(
            capability.capabilityId,
            capability.workspace,
            capability.view,
            'settings',
            '系统级 AI 连接沿用受控生产适配；店铺运行参数由同页 Main 原生 CRUD 按 store_id 独立维护。',
          );
        }
        if (options.storeRuntimeConfigReady && [
          'settings.store-config.create',
          'settings.store-config.update',
          'settings.store-config.archive',
          'settings.store-config.restore',
        ].includes(capability.capabilityId)) {
          return native(
            capability.capabilityId,
            capability.workspace,
            capability.view,
            capability.action,
            '店铺运行配置由 Main 复核完整 StoreContext，以独立 store_id 持久化并使用 expectedRevision、可恢复归档和版本历史。',
          );
        }
        if (options.storeAutomationReady && capability.capabilityId === 'settings.scheduler.view') {
          return adapted(
            capability.capabilityId,
            capability.workspace,
            capability.view,
            'scheduler',
            '当前店铺自动化页面通过兼容路由装载，但只调用 Main 的 StoreContext-only 调度与只读证据保留接口。',
          );
        }
        if (options.storeAutomationReady && capability.capabilityId === 'settings.scheduler.run-now') {
          return native(
            capability.capabilityId,
            capability.workspace,
            capability.view,
            capability.action,
            '立即采集只接受当前 Main StoreContext；二次确认后仍按店铺、业务日与采集口径幂等认领，同一 fingerprint 失败不重试。',
          );
        }
        if (options.storeAutomationReady && capability.capabilityId === 'settings.scheduler.retention-preview') {
          return native(
            capability.capabilityId,
            capability.workspace,
            capability.view,
            capability.action,
            '证据保留仅返回当前店铺 dry-run 汇总，固定 deletionSupported=false，不暴露删除或应用入口。',
          );
        }
        const missionDomainDetail = options.missionDomain
          ? MISSION_DOMAIN_CAPABILITY_DETAILS[capability.capabilityId]
          : undefined;
        return missionDomainDetail
          ? native(
              capability.capabilityId,
              capability.workspace,
              capability.view,
              capability.action,
              missionDomainDetail,
            )
          : { ...capability };
      });
      const projectedToday = options.buildTodayProjection?.(authoritativeContext)
        ?? unavailableTodayProjection(authoritativeContext);
      const autonomy = options.missionDomain
        ? projectAutonomy(options.missionDomain.getAutonomyProjection(authoritativeContext))
        : unavailableAutonomy();
      return {
        query: 'workspace-bootstrap',
        data: {
          capabilities,
          autonomy,
          today: authorizeTodayNextAction(projectedToday, capabilities),
        },
      };
    },
    command(request, authoritativeContext) {
      if (request.command !== 'set-autonomy-mode') {
        throw new TypeError('unsupported Mission Control command');
      }
      if (!options.missionDomain) {
        return {
          command: 'set-autonomy-mode',
          status: request.payload.mode === 'policy_auto' ? 'BLOCKED' : 'NOOP',
          currentMode: 'manual_approval',
          ...(request.payload.mode === 'policy_auto'
            ? { blockerCode: 'POLICY_AUTO_AUTHORITY_NOT_IMPLEMENTED' }
            : {}),
          detail: request.payload.mode === 'policy_auto'
            ? '全自动模式未获得 Main 授权；系统继续保持人工审批。'
            : '系统已处于人工审批模式。',
        };
      }
      const current = options.missionDomain.getAutonomyProjection(authoritativeContext);
      if (request.payload.mode === current.mode) {
        return {
          command: 'set-autonomy-mode',
          status: 'NOOP',
          currentMode: current.mode,
          detail: current.mode === 'policy_auto'
            ? '系统已处于策略全自动模式。'
            : '系统已处于人工审批模式。',
        };
      }
      if (request.payload.mode === 'policy_auto' && !current.canAutoExecute) {
        const unavailable = projectAutonomy(current);
        return {
          command: 'set-autonomy-mode',
          status: 'BLOCKED',
          currentMode: current.mode,
          blockerCode: unavailable.policyAutoBlockerCode,
          detail: unavailable.policyAutoBlockerDetail ?? '策略全自动模式尚未满足安全条件。',
        };
      }
      const updated = options.missionDomain.setAutonomyMode(authoritativeContext, {
        expectedRevision: current.revision,
        mode: request.payload.mode,
        reason: `mission_control_shell_set_${request.payload.mode}`,
      });
      return {
        command: 'set-autonomy-mode',
        status: 'APPLIED',
        currentMode: updated.mode,
        detail: updated.mode === 'policy_auto'
          ? '已切换为策略全自动；真实动作仍逐项受 MissionGrant、限额、急停与回读门约束。'
          : '已切换为人工审批；后续动作必须由人工签发授权。',
      };
    },
  };
}

const MISSION_DOMAIN_CAPABILITY_DETAILS: Readonly<Record<string, string>> = Object.freeze({
  'missions.mission.view': '任务由 Main 按当前店铺查询，并绑定数据批次与策略版本。',
  'missions.mission.create': '任务创建由 Main 验证 StoreContext、数据批次和策略版本。',
  'missions.mission.update': '任务编辑使用 expectedRevision，拒绝过期写入。',
  'missions.mission.pause': '任务暂停通过 Main 状态机与 CAS 完成。',
  'missions.mission.resume': '任务恢复通过 Main 状态机与 CAS 完成。',
  'missions.mission.archive': '任务只允许可恢复归档，不硬删除受引用历史。',
  'missions.mission.restore': '已归档任务可由 Main 以 CAS 恢复，并继续保留完整历史。',
  'missions.mission.facts.view': '任务事实页读取 Main 持久化检查点与完整关联链。',
  'missions.checkpoint.create': '人工事实或分析检查点由 Main 追加写入，历史记录不可改写。',
  'decisions.recommendations.view': '建议与决策由 Main 按当前店铺和任务查询。',
  'decisions.recommendations.create': '结构化建议创建绑定 Mission、数据批次、策略版本与动作 revision。',
  'decisions.recommendations.update': '建议修订使用 expectedRevision，并保留不可改写历史。',
  'decisions.approval.view': '人工审批由 Main 状态机、CAS 与 MissionGrant 授权约束。',
  'decisions.approval.approve': '人工批准由 Main CAS 写入并保留完整决策历史。',
  'decisions.approval.reject': '人工拒绝、阻断或替代由 Main 状态机写入不可改写历史。',
  'decisions.grants.revoke': '人工可撤销当前店铺已签发的 MissionGrant；消费与过期仍只由 Main 写入。',
  'decisions.decided.view': '已决策记录和不可改写历史由 Main 持久化读取。',
  'experiments.experiment.view': '实验及观察窗由 Main 按当前店铺隔离查询。',
  'experiments.experiment.create': '实验创建绑定任务、指标、守护栏与观察窗。',
  'experiments.experiment.update': '实验编辑使用 expectedRevision，拒绝过期写入。',
  'experiments.experiment.start': '实验从草稿启动通过 Main 状态机与 CAS 完成。',
  'experiments.experiment.pause': '实验暂停通过 Main 状态机与 CAS 完成。',
  'experiments.experiment.resume': '实验恢复通过 Main 状态机与 CAS 完成。',
  'experiments.experiment.complete': '实验结论与完成状态通过 Main 状态机、CAS 和因果账本持久化。',
  'experiments.experiment.archive': '实验采用可恢复归档并保留引用历史。',
  'experiments.experiment.restore': '已归档实验可在当前店铺恢复为暂停状态。',
  'experiments.observation.create': '人工观察以追加记录写入，修正必须引用原记录。',
  'memory.timeline.view': '因果时间线由 Main 追加式账本按当前店铺读取。',
  'memory.timeline.create': '人工只能追加 FACT 或 ANALYSIS；动作、回读和效果由 Main 权威流程写入。',
  'memory.timeline.correct': '修正记录由 Main 校验同任务、同实体、同阶段后追加，原事件保持不变。',
  'policy.version.view': '策略、不可变版本与运行时状态由 Main 按店铺读取。',
  'policy.policy.create': '策略创建绑定当前店铺并记录审计事件。',
  'policy.policy.update': '策略元数据编辑使用 expectedRevision，拒绝过期写入。',
  'policy.policy.archive': '停用后的策略采用可恢复归档，不删除版本历史。',
  'policy.policy.restore': '已归档策略可恢复为停用状态并保留全部版本。',
  'policy.version.create': '策略及草稿版本创建绑定当前店铺与 US/USD 边界。',
  'policy.version.update': '仅草稿策略版本可通过 Main 和 expectedRevision 修改。',
  'policy.version.enable': '策略版本启用后内容不可修改，并成为运行时授权快照。',
  'policy.version.disable': '策略停用由 Main CAS、审计与安全状态机控制。',
  'policy.version.publish': '策略发布由 Main 启用不可变版本并写入审计账本。',
  'policy.runtime.mode.set': '人工审批与策略内自动由 Main 持久化运行时、CAS 与安全前置条件控制。',
  'policy.kill-switch.enable': '店铺级急停、熔断和自治模式由 Main 持久化控制。',
  'policy.kill-switch.clear': '解除店铺级急停要求独立授权、明确原因与 Main 持久化审计。',
});

function unavailableAutonomy(): MissionControlAutonomyProjection {
  return {
    currentMode: 'manual_approval',
    manualApprovalAvailable: true,
    policyAutoAvailable: false,
    policyAutoBlockerCode: 'POLICY_AUTO_AUTHORITY_NOT_IMPLEMENTED',
    policyAutoBlockerDetail: '全自动模式尚未实现 Main 授权、逐动作策略校验与真实回读闭环。',
  };
}

function projectAutonomy(input: {
  mode: MissionControlAutonomyMode;
  killSwitch: boolean;
  circuitBreakerState: 'closed' | 'open' | 'half_open';
  activePolicyVersionId?: string;
  canAutoExecute: boolean;
}): MissionControlAutonomyProjection {
  if (input.canAutoExecute) {
    return {
      currentMode: input.mode,
      manualApprovalAvailable: true,
      policyAutoAvailable: true,
    };
  }
  const blocked = input.killSwitch
    ? {
        code: 'POLICY_KILL_SWITCH_ACTIVE',
        detail: '店铺级策略急停已开启；关闭急停前不能选择策略全自动。',
      }
    : input.circuitBreakerState !== 'closed'
      ? {
          code: 'POLICY_CIRCUIT_BREAKER_NOT_CLOSED',
          detail: '策略熔断器未关闭；完成复核前不能选择策略全自动。',
        }
      : {
          code: 'ACTIVE_POLICY_VERSION_REQUIRED',
          detail: '当前店铺尚未启用策略版本；先发布并启用一个不可变策略版本。',
        };
  return {
    currentMode: input.mode,
    manualApprovalAvailable: true,
    policyAutoAvailable: false,
    policyAutoBlockerCode: blocked.code,
    policyAutoBlockerDetail: blocked.detail,
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

function dependencyBlocked(
  capabilityId: string,
  workspace: MissionControlCapabilityProjection['workspace'],
  view: MissionControlCapabilityProjection['view'],
  action: MissionControlCapabilityProjection['action'],
  blockerCode: string,
  detail: string,
): MissionControlCapabilityProjection {
  return {
    capabilityId,
    workspace,
    view,
    action,
    state: 'BLOCKED',
    blockerCode,
    detail,
  };
}
