import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  MissionControlCapabilityProjection,
  MissionControlTodayProjection,
  StoreContextEnvelope,
  StoreRecord,
} from '@amazon-ai-ops/shared-types';
import {
  MISSION_CONTROL_WORKSPACE_IDS,
  MISSION_CONTROL_VIEW_IDS,
  missionControlContextKey,
} from '@amazon-ai-ops/shared-types';
import {
  STORE_MANAGEMENT_CAPABILITY_IDS,
  StoreManagementPanel,
  buildArchiveStoreInput,
  buildCreateStoreInput,
  buildRestoreStoreInput,
  buildUpdateStoreInput,
  summarizeViewCapability,
  validateStoreDraft,
} from '../components';
import { MissionControlWorkspaceView } from './mission-control-workspace-view';
import {
  MISSION_CONTROL_WORKSPACE_REGISTRY,
  missionControlViewIdForIntent,
} from './registry';

const context = {
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 4,
} as StoreContextEnvelope;

const todayProjection: MissionControlTodayProjection = {
  storeId: String(context.storeId),
  authorityKey: missionControlContextKey(context),
  businessDate: context.businessDate,
  marketplace: 'US',
  currency: 'USD',
  generatedAt: '2026-07-22T09:00:00.000Z',
  facts: {
    productCount: 1,
    configuredProductCount: 1,
    collectionJobCount: 1,
    importedMetricRows: 24,
    latestMetricDate: '2026-07-21',
    operationEventsToday: 1,
    browserSessionReady: true,
  },
  readiness: [
    { id: 'products', label: '产品与经营目标', state: 'ready', detail: '1/1 已配置', targetView: 'objects/products' },
    { id: 'collection', label: '领星八报表', state: 'ready', detail: '8/8 已下载', targetView: 'collection/reports' },
    { id: 'import', label: '广告事实入库', state: 'ready', detail: '24 行已入库', targetView: 'collection/import-check' },
    { id: 'browser', label: '可见浏览器会话', state: 'ready', detail: '会话已确认', targetView: 'collection/reports' },
  ],
  blockers: [],
  attentionItems: [],
  nextAction: {
    id: 'review-ad-facts',
    label: '进入广告事实分析',
    detail: '数据已就绪',
    targetView: 'missions/facts',
    requiredCapabilityId: 'missions.mission.facts.view',
    available: true,
  },
};

function capability(
  view: MissionControlCapabilityProjection['view'],
  action: MissionControlCapabilityProjection['action'],
  state: MissionControlCapabilityProjection['state'],
  capabilityId = `${view}.${action}`,
): MissionControlCapabilityProjection {
  return {
    capabilityId,
    workspace: view.split('/')[0] as MissionControlCapabilityProjection['workspace'],
    view,
    action,
    state,
    detail: `${capabilityId} ${state}`,
  };
}

describe('Mission Control workspace registry', () => {
  it('registers the exact ten workspaces and every qualified view once', () => {
    expect(MISSION_CONTROL_WORKSPACE_REGISTRY.map((workspace) => workspace.id)).toEqual([
      ...MISSION_CONTROL_WORKSPACE_IDS,
    ]);
    const views = MISSION_CONTROL_WORKSPACE_REGISTRY.flatMap((workspace) => (
      workspace.subviews.map((subview) => subview.view)
    ));
    expect(views).toHaveLength(22);
    expect(new Set(views).size).toBe(22);
    expect(new Set(views)).toEqual(new Set(MISSION_CONTROL_VIEW_IDS));
  });

  it('resolves canonical views without converting them into fake legacy routes', () => {
    expect(missionControlViewIdForIntent({ workspace: 'missions', subview: 'overview' })).toBe('missions/overview');
    expect(missionControlViewIdForIntent({ workspace: 'execution', subview: 'live' })).toBe('execution/live');
    expect(missionControlViewIdForIntent({ workspace: 'policy', subview: 'rules' })).toBe('policy/rules');
    const todayEvents = MISSION_CONTROL_WORKSPACE_REGISTRY
      .find((workspace) => workspace.id === 'today')
      ?.subviews.find((subview) => subview.id === 'events');
    expect(todayEvents).toEqual(expect.objectContaining({
      kind: 'canonical',
      view: 'today/events',
    }));
    expect(todayEvents).not.toHaveProperty('legacyRoute');
    const missionFacts = MISSION_CONTROL_WORKSPACE_REGISTRY
      .find((workspace) => workspace.id === 'missions')
      ?.subviews.find((subview) => subview.id === 'facts');
    expect(missionFacts).toEqual(expect.objectContaining({
      kind: 'canonical',
      view: 'missions/facts',
    }));
    expect(missionFacts).not.toHaveProperty('legacyRoute');
  });
});

describe('action-level capability rendering', () => {
  it('uses a pessimistic badge summary while preserving exact action rows', () => {
    const capabilities = [
      capability('objects/products', 'view', 'LEGACY_ADAPTER'),
      capability('objects/products', 'update', 'BLOCKED'),
    ];
    const summary = summarizeViewCapability(capabilities, 'objects/products');
    expect(summary?.state).toBe('BLOCKED');
    expect(summary?.projection?.action).toBe('update');
  });

  it('renders the Mission CRUD shell but fails closed when the explicit preview adapter is absent', () => {
    const markup = renderToStaticMarkup(
      <MissionControlWorkspaceView
        autonomy={{ currentMode: 'manual_approval', manualApprovalAvailable: true, policyAutoAvailable: false }}
        capabilities={[
          capability('missions/overview', 'view', 'PROTOTYPE_ONLY', 'missions.mission.view'),
          capability('missions/overview', 'create', 'BLOCKED', 'missions.mission.create'),
        ]}
        intent={{ workspace: 'missions', subview: 'overview' }}
        onNavigate={vi.fn()}
        previewMode
        storeContext={context}
      />,
    );
    expect(markup).toContain('任务中心');
    expect(markup).toContain('仅开发预览');
    expect(markup).toContain('显式内存 adapter');
    expect(markup).toContain('Mission 队列');
    expect(markup).toContain('失败关闭');
    expect(markup).not.toContain('MISSION · US-SP-ACOS-001');
    expect(markup).toContain('查看接入边界');
    expect(markup).toContain('task-banner');
    expect(markup).toContain('summary-strip');
    expect(markup).toContain('workbench-panel');
    expect(markup).toMatch(/<button[^>]*data-action-id="missions\.mission\.create"[^>]*disabled=""/);
    expect(markup).not.toContain('执行成功');
  });

  it.each([
    [{ workspace: 'missions', subview: 'overview' }, 'missions/overview', '任务中心', 'missions.mission.create'],
    [{ workspace: 'experiments', subview: 'ledger' }, 'experiments/ledger', '经营实验', 'experiments.experiment.create'],
    [{ workspace: 'execution', subview: 'live' }, 'execution/live', '实时执行', 'execution.queue.start'],
    [{ workspace: 'memory', subview: 'timeline' }, 'memory/timeline', '因果记忆', 'memory.timeline.create'],
    [{ workspace: 'policy', subview: 'rules' }, 'policy/rules', '策略与风控', 'policy.policy.create'],
  ] as const)('renders %s with its exact fail-closed blocker', (intent, view, title, createCapabilityId) => {
    const markup = renderToStaticMarkup(
      <MissionControlWorkspaceView
        capabilities={[capability(view, 'view', 'BLOCKED', `${view}.view`)]}
        intent={intent}
        onNavigate={vi.fn()}
        previewMode={false}
        storeContext={context}
      />,
    );
    expect(markup).toContain(title);
    expect(markup).toContain(createCapabilityId);
    expect(markup).toContain('已阻断');
    expect(markup).toContain(`${view}.view BLOCKED`);
  });

  it('blocks an unauthorized legacy slot and mounts a production-authorized adapter', () => {
    const blocked = renderToStaticMarkup(
      <MissionControlWorkspaceView
        capabilities={[capability('today/overview', 'view', 'BLOCKED')]}
        intent={{ workspace: 'today', subview: 'overview' }}
        legacySlot={<div>LEGACY_DASHBOARD</div>}
        onNavigate={vi.fn()}
        previewMode={false}
        storeContext={context}
      />,
    );
    const allowed = renderToStaticMarkup(
      <MissionControlWorkspaceView
        capabilities={[capability('today/overview', 'view', 'LEGACY_ADAPTER')]}
        intent={{ workspace: 'today', subview: 'overview' }}
        legacySlot={<div>LEGACY_DASHBOARD</div>}
        onNavigate={vi.fn()}
        previewMode={false}
        storeContext={context}
      />,
    );
    expect(blocked).not.toContain('LEGACY_DASHBOARD');
    expect(blocked).toContain('今日控制面已失败关闭');
    expect(blocked).toContain('data-canonical-surface="today"');
    expect(allowed).toContain('LEGACY_DASHBOARD');
    expect(allowed).toContain('data-legacy-route="dashboard"');
  });

  it('uses the pure display surface for PROTOTYPE_ONLY without mounting a legacy fixture route', () => {
    const markup = renderToStaticMarkup(
      <MissionControlWorkspaceView
        capabilities={[capability('today/overview', 'view', 'PROTOTYPE_ONLY')]}
        intent={{ workspace: 'today', subview: 'overview' }}
        legacySlot={<div>INNER_DEV_BOUNDARY</div>}
        onNavigate={vi.fn()}
        previewMode
        storeContext={context}
        today={todayProjection}
      />,
    );
    expect(markup).not.toContain('INNER_DEV_BOUNDARY');
    expect(markup).toContain('data-canonical-surface="today"');
    expect(markup).toContain('仅开发预览示例');
    expect(markup).toContain('data-capability-state="PROTOTYPE_ONLY"');
    expect(markup).not.toContain('data-capability-state="LEGACY_ADAPTER"');
  });

  it('routes Today events to the production-native store event surface and never mounts the old event page', () => {
    const capabilities = [
      capability('today/events', 'view', 'PRODUCTION_NATIVE', 'today.events.view'),
      capability('today/events', 'create', 'PRODUCTION_NATIVE', 'today.events.create'),
      capability('today/events', 'update', 'PRODUCTION_NATIVE', 'today.events.update'),
      capability('today/events', 'archive', 'PRODUCTION_NATIVE', 'today.events.archive'),
      capability('today/events', 'restore', 'PRODUCTION_NATIVE', 'today.events.restore'),
    ];
    const markup = renderToStaticMarkup(
      <MissionControlWorkspaceView
        capabilities={capabilities}
        intent={{ workspace: 'today', subview: 'events' }}
        legacySlot={<div>OLD OPERATION EVENTS PAGE</div>}
        onNavigate={vi.fn()}
        previewMode={false}
        storeContext={context}
      />,
    );

    expect(markup).toContain('data-store-object-subview="events"');
    expect(markup).toContain('当前店铺运营事件');
    expect(markup).toContain('记录事件');
    expect(markup).not.toContain('新建产品');
    expect(markup).not.toContain('OLD OPERATION EVENTS PAGE');
    expect(markup).not.toContain('data-legacy-route="operation-events"');
  });

  it('fails Today events closed when any exact native event action is missing', () => {
    const capabilities = [
      capability('today/events', 'view', 'PRODUCTION_NATIVE', 'today.events.view'),
      capability('today/events', 'create', 'PRODUCTION_NATIVE', 'today.events.create'),
      capability('today/events', 'update', 'PRODUCTION_NATIVE', 'today.events.update'),
      capability('today/events', 'archive', 'PRODUCTION_NATIVE', 'today.events.archive'),
    ];
    const markup = renderToStaticMarkup(
      <MissionControlWorkspaceView
        capabilities={capabilities}
        intent={{ workspace: 'today', subview: 'events' }}
        legacySlot={<div>OLD OPERATION EVENTS PAGE</div>}
        onNavigate={vi.fn()}
        previewMode={false}
        storeContext={context}
      />,
    );

    expect(markup).toContain('当前对象视图未获授权');
    expect(markup).toContain('today.events.restore');
    expect(markup).not.toContain('记录事件');
    expect(markup).not.toContain('OLD OPERATION EVENTS PAGE');
  });

  it('fails closed when production receives a PROTOTYPE_ONLY projection', () => {
    const markup = renderToStaticMarkup(
      <MissionControlWorkspaceView
        capabilities={[capability('today/overview', 'view', 'PROTOTYPE_ONLY')]}
        intent={{ workspace: 'today', subview: 'overview' }}
        onNavigate={vi.fn()}
        previewMode={false}
        storeContext={context}
      />,
    );

    expect(markup).toContain('当前不是显式开发预览');
    expect(markup).toContain('data-capability-state="PROTOTYPE_ONLY"');
    expect(markup).toContain('workspace-state--blocked');
    expect(markup).not.toContain('data-preview-today-projection');
    expect(markup).not.toContain('仅开发预览示例');
    expect(markup).not.toContain('ACTIVE MISSION');
  });

  it('keeps the compact prototype surface direct while retaining the production safety wrapper', () => {
    const preview = renderToStaticMarkup(
      <MissionControlWorkspaceView
        capabilities={[capability('today/overview', 'view', 'PROTOTYPE_ONLY')]}
        intent={{ workspace: 'today', subview: 'overview' }}
        onNavigate={vi.fn()}
        previewMode
        storeContext={context}
        today={todayProjection}
      />,
    );
    const blocked = renderToStaticMarkup(
      <MissionControlWorkspaceView
        capabilities={[capability('today/overview', 'view', 'BLOCKED')]}
        intent={{ workspace: 'today', subview: 'overview' }}
        onNavigate={vi.fn()}
        previewMode={false}
        storeContext={context}
      />,
    );

    expect(preview).toContain('data-preview-today-projection="store-one"');
    expect(preview).toContain('ACTIVE STORE');
    expect(preview).toContain('data-mutations-disabled="true"');
    expect(preview).not.toContain('data-production-today-projection');

    expect(blocked).toContain('workspace-state--blocked');
    expect(blocked).toContain('今日控制面已失败关闭');
    expect(blocked).not.toContain('data-preview-today-projection');
  });
});

describe('prototype-aligned canonical first screens', () => {
  it.each([
    [{ workspace: 'today', subview: 'overview' }, 'today/overview', 'today', 'ACTIVE STORE'],
    [{ workspace: 'missions', subview: 'overview' }, 'missions/overview', 'missions', 'Mission 队列'],
    [{ workspace: 'missions', subview: 'facts' }, 'missions/facts', 'missions', 'Mission 事实链'],
    [{ workspace: 'decisions', subview: 'recommendations' }, 'decisions/recommendations', 'decisions', 'AI 建议'],
    [{ workspace: 'experiments', subview: 'ledger' }, 'experiments/ledger', 'experiments', '实验台账'],
    [{ workspace: 'execution', subview: 'live' }, 'execution/live', 'execution', 'Authority 未接入'],
    [{ workspace: 'memory', subview: 'timeline' }, 'memory/timeline', 'memory', 'FACT'],
    [{ workspace: 'policy', subview: 'rules' }, 'policy/rules', 'policy', '自动边界与审批策略'],
  ] as const)('gives %s an explicit, distinct US/USD preview surface', (intent, view, surface, copy) => {
    const markup = renderToStaticMarkup(
      <MissionControlWorkspaceView
        autonomy={{ currentMode: 'manual_approval', manualApprovalAvailable: true, policyAutoAvailable: false }}
        capabilities={[capability(
          view,
          'view',
          'PROTOTYPE_ONLY',
          view === 'missions/facts'
            ? 'missions.mission.facts.view'
            : view === 'decisions/recommendations'
            ? 'decisions.recommendations.view'
            : view === 'experiments/ledger'
              ? 'experiments.experiment.view'
              : view === 'memory/timeline'
                ? 'memory.timeline.view'
            : view === 'policy/rules'
              ? 'policy.version.view'
              : `${view}.view`,
        )]}
        intent={intent}
        legacySlot={<div>SHOULD_NOT_MOUNT</div>}
        onNavigate={vi.fn()}
        previewMode
        storeContext={context}
        today={view === 'today/overview' ? todayProjection : undefined}
      />,
    );
    expect(markup).toContain(`data-canonical-surface="${surface}"`);
    expect(markup).toContain(copy);
    expect(markup).toMatch(/(?:Amazon )?US [/.·] USD/);
    if (surface === 'missions' || surface === 'decisions' || surface === 'experiments' || surface === 'memory' || surface === 'policy') {
      expect(markup).toContain('内存 adapter');
      expect(markup).toContain('data-capability-state="PROTOTYPE_ONLY"');
      expect(markup).toContain('接入边界');
      expect(markup).not.toContain('data-mutations-disabled="true"');
    } else {
      expect(markup).toContain('仅开发预览示例');
      expect(markup).toContain('data-mutations-disabled="true"');
      if (surface !== 'today') expect(markup).toContain('canonical-preview-boundary-action');
    }
    expect(markup).not.toContain('SHOULD_NOT_MOUNT');
    expect(markup).not.toContain('执行成功');
  });

  it('keeps execution writes, takeover and reload visibly disabled in preview', () => {
    const markup = renderToStaticMarkup(
      <MissionControlWorkspaceView
        capabilities={[capability('execution/live', 'view', 'PROTOTYPE_ONLY')]}
        intent={{ workspace: 'execution', subview: 'live' }}
        onNavigate={vi.fn()}
        previewMode
        storeContext={context}
      />,
    );
    for (const label of ['开始可见执行', '人工接管', '紧急停止', '应用 USD 1.08', 'Reload 并验证']) {
      expect(markup).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</button>`));
    }
    expect(markup).toContain('未知结果');
    expect(markup).toContain('停止并人工对账');
    expect(markup).not.toContain('Reload 回读一致');
  });

  it('does not expose preview example facts when the production view is blocked', () => {
    const markup = renderToStaticMarkup(
      <MissionControlWorkspaceView
        capabilities={[capability('execution/live', 'view', 'BLOCKED')]}
        intent={{ workspace: 'execution', subview: 'live' }}
        onNavigate={vi.fn()}
        previewMode={false}
        storeContext={context}
      />,
    );
    expect(markup).toContain('暂无可授权执行项');
    expect(markup).not.toContain('USD 1.20');
    expect(markup).not.toContain('smart lock bedroom');
  });

  it('keeps canonical surfaces pure display with no Renderer persistence or simulated completion timer', () => {
    const source = readFileSync(
      new URL('./canonical-workspace-surfaces.tsx', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/localStorage|sessionStorage|usePrototypeModel|prototypeReducer/);
    expect(source).not.toMatch(/setTimeout|setInterval|APPLY_EXECUTION_ITEM|VERIFY_EXECUTION_ITEM/);
    expect(source).not.toMatch(/onClick=\{\(\) =>/);
  });
});

describe('StoreManagementPanel', () => {
  const store = {
    storeId: 'store-one',
    displayName: 'Northstar Home',
    browserProfileId: 'profile-one',
    marketplace: 'US',
    currency: 'USD',
    status: 'active',
    businessTimezone: 'America/Los_Angeles',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  } as StoreRecord;

  it('validates display name and IANA timezone before calling typed handlers', () => {
    expect(validateStoreDraft({ displayName: '', businessTimezone: 'not/a-zone', status: 'active' })).toEqual({
      displayName: '请输入店铺名称。',
      businessTimezone: '请输入有效的 IANA 时区。',
    });
    expect(validateStoreDraft({
      displayName: 'Northstar Home',
      businessTimezone: 'America/Los_Angeles',
      status: 'active',
    })).toEqual({});
  });

  it('builds typed create, update, archive and restore inputs without a delete path', () => {
    const createDraft = {
      displayName: '  New US Store  ',
      businessTimezone: 'America/New_York',
      status: 'active' as const,
    };
    expect(buildCreateStoreInput(createDraft)).toEqual({
      displayName: 'New US Store',
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/New_York',
    });
    expect(buildUpdateStoreInput(store, {
      displayName: 'Northstar Home Updated',
      businessTimezone: store.businessTimezone,
      status: 'inactive',
    })).toEqual({
      storeId: store.storeId,
      expectedUpdatedAt: store.updatedAt,
      patch: { displayName: 'Northstar Home Updated', status: 'inactive' },
    });
    expect(buildUpdateStoreInput(store, {
      displayName: store.displayName,
      businessTimezone: store.businessTimezone,
      status: 'active',
    })).toBeNull();
    expect(buildArchiveStoreInput(store)).toEqual({
      storeId: store.storeId,
      expectedUpdatedAt: store.updatedAt,
      reason: 'operator_archived_from_mission_control',
    });
    expect(buildRestoreStoreInput(store)).toEqual({
      storeId: store.storeId,
      expectedUpdatedAt: store.updatedAt,
    });
  });

  it('renders fixed US/USD identity and capability-bound CRUD without hard delete', () => {
    const archived = {
      ...store,
      storeId: 'store-archived',
      browserProfileId: 'profile-archived',
      displayName: 'Archived Store',
      status: 'archived',
      archivedAt: '2026-07-22T01:00:00.000Z',
    } as StoreRecord;
    const markup = renderToStaticMarkup(
      <div className="mission-control-workspace-root">
        <StoreManagementPanel
          activeStoreId={store.storeId}
          onArchive={vi.fn()}
          onCreate={vi.fn()}
          onRestore={vi.fn()}
          onSwitch={vi.fn()}
          onUpdate={vi.fn()}
          stores={[store, archived]}
        />
      </div>,
    );
    expect(markup).toContain('US / USD');
    expect(markup).toContain(STORE_MANAGEMENT_CAPABILITY_IDS.create);
    expect(markup).toContain(STORE_MANAGEMENT_CAPABILITY_IDS.update);
    expect(markup).toContain(STORE_MANAGEMENT_CAPABILITY_IDS.archive);
    expect(markup).toContain(STORE_MANAGEMENT_CAPABILITY_IDS.restore);
    expect(markup).toContain(STORE_MANAGEMENT_CAPABILITY_IDS.switch);
    expect(markup).not.toContain('永久删除');
    expect(markup).not.toContain('hard-delete');
  });
});

describe('Mission Control namespaced visual contract', () => {
  const stylesheet = readFileSync(
    new URL('../../styles/mission-control-shell.css', import.meta.url),
    'utf8',
  );

  it('restores the 216px sidebar and visible Phosphor icon rail', () => {
    expect(stylesheet).toContain('.mission-control-shell .app-sidebar');
    expect(stylesheet).toMatch(/\.mission-control-shell\s*\{[^}]*--mission-sidebar-width:\s*216px/s);
    expect(stylesheet).toMatch(/\.mission-control-shell \.app-sidebar\s*\{[^}]*width:\s*var\(--mission-sidebar-width\)/s);
    expect(stylesheet).toMatch(/\.mission-control-shell \.app-sidebar \.nav-item-index\s*\{[^}]*position:\s*static/s);
    expect(stylesheet).toMatch(/\.nav-item-index svg\s*\{[^}]*width:\s*1[89]px/s);
    expect(stylesheet).toContain('.mission-control-shell .app-sidebar .nav-group-governance');
  });

  it('keeps the new surface light, namespaced, and free of gradient or purple styling', () => {
    expect(stylesheet).not.toMatch(/linear-gradient|radial-gradient/i);
    expect(stylesheet).not.toMatch(/purple|#(?:7c3aed|8b5cf6|a855f7)/i);
    expect(stylesheet).toContain('.mission-control-workspace-root');
    expect(stylesheet).toContain('.mission-control-store-gate');
    expect(stylesheet).toContain('font-size: 12px');
  });
});
