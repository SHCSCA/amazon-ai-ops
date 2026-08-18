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

function CapabilityDiagnosticDetails({ detail }: { detail?: string | null }) {
  if (!detail) return null;
  return (
    <details>
      <summary>诊断详情</summary>
      <code>{detail}</code>
    </details>
  );
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
  const ordinaryDetail = loading
    ? '正在确认当前页面可用状态，请稍候。'
    : '当前页面暂不可用，请刷新后重试；仍失败时查看诊断详情。';
  return (
    <PageFrame
      className="mission-control-legacy-blocked-page"
      description={description}
      pageId={`blocked-${view.replace('/', '-')}`}
      summary={(
        <SummaryStrip
          items={[
            { id: 'store', label: '当前店铺', value: storeContext ? '已选择' : '等待选择' },
            { id: 'market', label: '站点 / 币种', value: storeContext ? `${storeContext.marketplace} / ${storeContext.currency}` : '等待店铺' },
            { id: 'route', label: '页面范围', value: '当前页面' },
            { id: 'state', label: '接入状态', value: summary?.label ?? '读取中', tone: summary?.state === 'BLOCKED' ? 'blocked' : 'attention' },
          ]}
        />
      )}
      task={(
        <TaskBanner
          description={ordinaryDetail}
          status={<CapabilityStateBadge summary={summary} />}
          title={loading ? '正在确认生产适配边界' : '旧页面已按安全边界阻断'}
          tone={loading ? 'attention' : 'blocked'}
        />
      )}
      title={title}
    >
      <WorkspaceState
        description={loading
          ? '请稍候；确认当前店铺和页面状态后即可继续。'
          : '当前页面未通过安全校验，相关操作已暂停。请刷新后重试。'}
        details={<CapabilityDiagnosticDetails detail={summary?.detail} />}
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
        />
      </div>
    );
  }

  const nativeSlot = intent.workspace === 'settings' && intent.subview === 'ai-and-local'
      ? (
        <NativeCrudSlot
          blockedReason="等待当前店铺设置操作通过安全校验。"
          capabilities={capabilities}
          capabilityView={view}
          createLabel="新建店铺设置"
          capabilityIds={{
            create: 'settings.store-config.create',
            update: 'settings.store-config.update',
            archive: 'settings.store-config.archive',
            restore: 'settings.store-config.restore',
          }}
          description="店铺级 AI、本地任务和运行参数必须与当前店铺绑定。"
          previewMode={previewMode}
          slotId="settings-crud"
          title="店铺级设置"
        >
          {settingsCrudSlot}
        </NativeCrudSlot>
      )
      : null;

  if (intent.workspace === 'settings' && intent.subview === 'ai-and-local') {
    const summary = summarizeViewCapability(capabilities, view);
    return (
      <div className="mission-control-workspace-root" data-legacy-route={route} data-workspace={intent.workspace}>
        <PageFrame
          className="mission-control-settings-page"
          description="在这里管理店铺、领星与 Amazon Ads 连接，再维护运行参数和系统级 AI 连接。站点固定为 US，币种固定为 USD。"
          pageId="settings-ai-and-local"
          task={(
            <TaskBanner
              compact
              description="先核对当前店铺的 ERP 与 Ads 分阶段状态；未确认的广告身份仍保持真实执行阻断。"
              primaryAction={{
                actionId: 'settings.connection.inspect',
                label: '检查店铺连接',
                onClick: () => document.querySelector('[data-login-connection-status]')?.scrollIntoView({ block: 'start' }),
              }}
              title="确认当前店铺连接状态"
              tone="attention"
            />
          )}
          title="店铺与运行设置"
        >
          {nativeSlot}
          {legacyContent ? (
            <section
              aria-label={`${title}生产适配内容`}
              className="mission-control-legacy-adapter"
              data-capability-state={viewCapability?.state ?? 'BLOCKED'}
              data-legacy-route={route}
            >
              <div className="mission-control-legacy-adapter__context" role="note">
                <span>系统级连接</span>
                <strong>{storeContext ? '当前店铺' : '等待店铺'}</strong>
                <span>{storeContext ? `${storeContext.marketplace} / ${storeContext.currency}` : 'US / USD'}</span>
                <small>{viewCapability
                  ? '当前页面已通过安全校验。'
                  : '当前页面可用状态尚未确认，已安全暂停。'}</small>
                <CapabilityDiagnosticDetails detail={viewCapability?.detail} />
              </div>
              {legacyContent}
            </section>
          ) : (
            <WorkspaceState
              description={capabilities === undefined
                ? '正在确认系统连接能力，请稍候。'
                : '系统连接暂不可用，请刷新后重试；仍失败时查看诊断详情。'}
              details={(
                <>
                  {storeContext ? `${storeContext.marketplace} / ${storeContext.currency} · 当前店铺` : null}
                  <CapabilityDiagnosticDetails detail={summary?.detail} />
                </>
              )}
              kind={capabilities === undefined ? 'loading' : 'blocked'}
              title={capabilities === undefined ? '正在确认设置边界' : '系统级连接尚未接入'}
            />
          )}
        </PageFrame>
      </div>
    );
  }

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
            <strong>{storeContext ? '当前店铺' : '等待店铺'}</strong>
            <span>{storeContext ? `${storeContext.marketplace} / ${storeContext.currency}` : 'US / USD'}</span>
            <small>{viewCapability
              ? '当前页面已通过安全校验。'
              : '当前页面可用状态尚未确认，已安全暂停。'}</small>
            <CapabilityDiagnosticDetails detail={viewCapability?.detail} />
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
