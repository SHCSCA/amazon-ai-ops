import React from 'react';
import { CanonicalWorkspace } from './canonical-workspace';
import { LegacyWorkspace } from './legacy-workspace';
import { MissionControlWorkspaceTabs } from './mission-control-workspace-tabs';
import { subviewDefinitionForIntent } from './registry';
import type { MissionControlWorkspaceViewProps } from './types';
import { capabilityForAction } from '../components';
import { TodayWorkspace } from './today-workspace';
import { ObjectsWorkspace } from './objects-workspace';
import { ReadbackPage } from '../../pages/readback-page';

const CANONICAL_KIND_BY_VIEW = {
  'today/overview': 'today',
  'missions/overview': 'missions',
  'missions/facts': 'missions',
  'decisions/recommendations': 'decisions',
  'decisions/approval': 'decisions',
  'decisions/decided': 'decisions',
  'experiments/ledger': 'experiments',
  'execution/live': 'execution',
  'memory/timeline': 'memory',
  'policy/rules': 'policy',
} as const;

export function MissionControlWorkspaceView({
  intent,
  storeContext,
  capabilities,
  autonomy,
  today,
  bridgePhase,
  bridgeError,
  previewMode,
  onRefreshAuthority,
  onNavigate,
  legacySlot,
  storeCrudSlot,
  settingsCrudSlot,
}: MissionControlWorkspaceViewProps) {
  const definition = subviewDefinitionForIntent(intent);
  const kind = CANONICAL_KIND_BY_VIEW[definition.view as keyof typeof CANONICAL_KIND_BY_VIEW];
  const viewCapability = capabilityForAction(capabilities, definition.view, 'view');
  const legacyAuthorityReady = viewCapability?.state === 'LEGACY_ADAPTER';
  const useCanonicalSurface = definition.kind === 'canonical'
    || (Boolean(kind) && !legacyAuthorityReady);
  let content: React.ReactNode;
  if (definition.view === 'execution/evidence' && viewCapability?.state === 'PRODUCTION_NATIVE') {
    content = (
      <div
        className="mission-control-workspace-root"
        data-canonical-view="execution/evidence"
        data-workspace="execution"
      >
        <ReadbackPage />
      </div>
    );
  } else if (definition.view === 'today/overview' && viewCapability?.state !== 'LEGACY_ADAPTER') {
    const expectedState = previewMode ? 'PROTOTYPE_ONLY' : 'PRODUCTION_NATIVE';
    const capabilityReady = viewCapability?.state === expectedState;
    const capabilityError = capabilities === undefined
      ? null
      : capabilityReady
        ? null
        : !previewMode && viewCapability?.state === 'PROTOTYPE_ONLY'
          ? '当前不是显式开发预览，今日页面已安全暂停，请返回正式入口或刷新后重试。'
          : viewCapability?.state === 'BLOCKED'
            ? '今日控制面已失败关闭：今日数据暂不可用，请刷新当前店铺后重试。'
            : '今日页面状态不一致，已安全暂停；请刷新当前店铺后重试。';
    content = (
      <TodayWorkspace
        capabilities={capabilities}
        error={capabilityError || bridgeError || (capabilityReady && !today && bridgePhase === 'ready'
          ? '当前店铺的今日数据尚未返回，请刷新后重试。'
          : null)}
        loading={bridgePhase === 'loading' || bridgePhase === 'idle' || capabilities === undefined}
        onNavigate={onNavigate}
        previewMode={previewMode}
        projection={capabilityReady ? today ?? null : null}
        storeContext={storeContext}
      />
    );
  } else if (definition.view === 'today/events') {
    content = (
      <ObjectsWorkspace
        activeSubview="events"
        capabilities={capabilities}
        previewMode={previewMode}
        storeContext={storeContext}
      />
    );
  } else if (useCanonicalSurface) {
    if (!kind) {
      throw new Error(`Canonical Mission Control view ${definition.view} has no renderer`);
    }
    content = (
      <>
        <CanonicalWorkspace
          autonomy={autonomy}
          capabilities={capabilities}
          kind={kind}
          onRefreshAuthority={onRefreshAuthority}
          previewMode={previewMode}
          storeContext={storeContext}
          view={definition.view}
        />
        {viewCapability?.detail && (
          <details className="mission-control-capability-diagnostics">
            <summary>诊断详情</summary>
            {viewCapability.state === 'PROTOTYPE_ONLY' && <span>开发预览数据 · </span>}
            <code>{viewCapability.detail}</code>
          </details>
        )}
      </>
    );
  } else {
    if (!definition.legacyRoute) {
      throw new Error(`Legacy Mission Control view ${definition.view} has no route adapter`);
    }
    content = (
      <LegacyWorkspace
        capabilities={capabilities}
        description={definition.description}
        intent={intent}
        legacySlot={legacySlot}
        previewMode={previewMode}
        route={definition.legacyRoute}
        settingsCrudSlot={settingsCrudSlot}
        storeContext={storeContext}
        storeCrudSlot={storeCrudSlot}
        title={definition.label}
        view={definition.view}
      />
    );
  }

  return (
    <MissionControlWorkspaceTabs
      capabilities={capabilities}
      intent={intent}
      onNavigate={onNavigate}
    >
      {content}
    </MissionControlWorkspaceTabs>
  );
}
