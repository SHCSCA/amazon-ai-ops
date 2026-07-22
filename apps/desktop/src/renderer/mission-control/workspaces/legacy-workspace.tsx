import React from 'react';
import type {
  MissionControlCapabilityProjection,
  MissionControlViewId,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { PageFrame, SummaryStrip, TaskBanner, WorkspaceState } from '../../components/workspace';
import type { NavigationIntent } from '../../navigation';
import type { AppRoute } from '../../types';
import {
  CapabilityStateBadge,
  NativeCrudSlot,
  capabilityForAction,
  summarizeViewCapability,
} from '../components';
import type { LegacyWorkspaceSlot, LegacyWorkspaceSlotInput } from './types';
import { ObjectsWorkspace, type ObjectsWorkspaceSubview } from './objects-workspace';

export type LegacyWorkspaceProps = {
  intent: NavigationIntent;
  route: AppRoute;
  view: MissionControlViewId;
  title: string;
  description: string;
  storeContext: StoreContextEnvelope | null;
  capabilities?: readonly MissionControlCapabilityProjection[];
  previewMode?: boolean;
  legacySlot?: LegacyWorkspaceSlot;
  storeCrudSlot?: React.ReactNode;
  settingsCrudSlot?: React.ReactNode;
};

function renderLegacySlot(
  slot: LegacyWorkspaceSlot,
  input: LegacyWorkspaceSlotInput,
): React.ReactNode {
  return typeof slot === 'function' ? slot(input) : slot;
}

function LegacyBlockedState({
  capabilities,
  description,
  storeContext,
  title,
  view,
}: Pick<LegacyWorkspaceProps, 'capabilities' | 'description' | 'storeContext' | 'title' | 'view'>) {
  const summary = summarizeViewCapability(capabilities, view);
  const loading = capabilities === undefined;
  return (
    <PageFrame
      className="mission-control-legacy-blocked-page"
      description={description}
      pageId={`blocked-${view.replace('/', '-')}`}
      summary={(
        <SummaryStrip
          items={[
            { id: 'store', label: '店铺数据域', value: storeContext ? String(storeContext.storeId) : '等待 Main' },
            { id: 'market', label: '站点 / 币种', value: storeContext ? `${storeContext.marketplace} / ${storeContext.currency}` : '等待 Main' },
            { id: 'route', label: '生产适配视图', value: view },
            { id: 'state', label: '接入状态', value: summary?.label ?? '读取中', tone: summary?.state === 'BLOCKED' ? 'blocked' : 'attention' },
          ]}
        />
      )}
      task={(
        <TaskBanner
          description={summary?.detail ?? '正在从 Main 读取当前店铺的能力投影。'}
          status={<CapabilityStateBadge summary={summary} />}
          title={loading ? '正在确认生产适配边界' : '旧页面已按安全边界阻断'}
          tone={loading ? 'attention' : 'blocked'}
        />
      )}
      title={title}
    >
      <WorkspaceState
        description={loading ? '请等待 Main 返回权威 StoreContext 与能力投影。' : '仅当 view 动作被标记为 PRODUCTION_NATIVE 或 LEGACY_ADAPTER 时，旧页面才会挂载。'}
        details={loading ? undefined : summary?.detail}
        kind={loading ? 'loading' : 'blocked'}
      />
    </PageFrame>
  );
}

export function LegacyWorkspace({
  intent,
  route,
  view,
  title,
  description,
  storeContext,
  capabilities,
  previewMode = false,
  legacySlot,
  storeCrudSlot,
  settingsCrudSlot,
}: LegacyWorkspaceProps) {
  const viewCapability = capabilityForAction(capabilities, view, 'view');
  const canMount = viewCapability?.state === 'PRODUCTION_NATIVE'
    || viewCapability?.state === 'LEGACY_ADAPTER'
    // The inner LegacyAdapterBoundary still requires an explicit DEV preview
    // bootstrap before it will render a PROTOTYPE_ONLY route.
    || viewCapability?.state === 'PROTOTYPE_ONLY';
  const viewCapabilities = capabilities?.filter((capability) => capability.view === view) ?? [];
  const legacyContent = canMount && legacySlot
    ? renderLegacySlot(legacySlot, { route, intent, capabilities: viewCapabilities })
    : undefined;

  if (intent.workspace === 'objects') {
    return (
      <div className="mission-control-workspace-root" data-legacy-route={route} data-workspace={intent.workspace}>
        <ObjectsWorkspace
          activeSubview={intent.subview as ObjectsWorkspaceSubview}
          capabilities={capabilities}
          legacyContent={legacyContent}
          previewMode={previewMode}
          storeContext={storeContext}
          storeCrudSlot={storeCrudSlot}
        />
      </div>
    );
  }

  const nativeSlot = intent.workspace === 'settings' && intent.subview === 'ai-and-local'
      ? (
        <NativeCrudSlot
          blockedReason="等待 Main Settings Authority 提供店铺级读写处理器。"
          capabilities={capabilities}
          capabilityView={view}
          createLabel="新建店铺设置"
          capabilityIds={{
            create: 'settings.store-config.create',
            update: 'settings.store-config.update',
            archive: 'settings.store-config.archive',
          }}
          description="店铺级 AI、本地任务和运行参数必须与当前 StoreContext 绑定。"
          previewMode={previewMode}
          slotId="settings-crud"
          title="店铺级设置"
        >
          {settingsCrudSlot}
        </NativeCrudSlot>
      )
      : null;

  return (
    <div className="mission-control-workspace-root" data-legacy-route={route} data-workspace={intent.workspace}>
      {nativeSlot}
      {legacyContent ? (
        <section
          aria-label={`${title}生产适配内容`}
          className="mission-control-legacy-adapter"
          data-capability-state={viewCapability?.state ?? 'BLOCKED'}
          data-legacy-route={route}
        >
          <div className="mission-control-legacy-adapter__context" role="note">
            <span>生产适配</span>
            <strong>{storeContext ? String(storeContext.storeId) : '等待店铺'}</strong>
            <span>{storeContext ? `${storeContext.marketplace} / ${storeContext.currency}` : 'US / USD'}</span>
            <small>{viewCapability?.detail ?? '当前视图缺少 Main 能力投影，已按受阻处理。'}</small>
          </div>
          {legacyContent}
        </section>
      ) : (
        <LegacyBlockedState
          capabilities={capabilities}
          description={description}
          storeContext={storeContext}
          title={title}
          view={view}
        />
      )}
    </div>
  );
}
