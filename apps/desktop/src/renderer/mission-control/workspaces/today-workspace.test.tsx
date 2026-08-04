import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { missionControlContextKey, normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { TodayWorkspace } from './today-workspace';

const productionCapabilities = [{
  capabilityId: 'missions.mission.facts.view',
  workspace: 'missions' as const,
  view: 'missions/facts' as const,
  action: 'view' as const,
  state: 'PRODUCTION_NATIVE' as const,
  detail: '真实广告事实已接入。',
}];

const context = normalizeStoreContextEnvelope({
  storeId: 'store-today',
  browserProfileId: 'profile-today',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 1,
});

const projection = {
  storeId: 'store-today',
  authorityKey: missionControlContextKey(context),
  businessDate: '2026-07-22',
  marketplace: 'US' as const,
  currency: 'USD' as const,
  generatedAt: '2026-07-22T09:00:00.000Z',
  facts: {
    productCount: 1,
    configuredProductCount: 1,
    collectionJobCount: 1,
    importedMetricRows: 6827,
    latestMetricDate: '2026-07-21',
    operationEventsToday: 2,
    browserSessionReady: true,
  },
  readiness: [
    { id: 'products' as const, label: '产品与经营目标', state: 'ready' as const, detail: '1/1 已配置', targetView: 'objects/products' as const },
    { id: 'collection' as const, label: '领星八报表', state: 'ready' as const, detail: '8/8 已下载', targetView: 'collection/reports' as const },
    { id: 'import' as const, label: '广告事实入库', state: 'ready' as const, detail: '6827 行已入库', targetView: 'collection/import-check' as const },
    { id: 'browser' as const, label: '可见浏览器会话', state: 'ready' as const, detail: '会话已确认', targetView: 'collection/reports' as const },
  ],
  blockers: [],
  attentionItems: [],
  nextAction: {
    id: 'review-ad-facts',
    label: '进入广告事实分析',
    detail: '数据已就绪',
    targetView: 'missions/facts' as const,
    requiredCapabilityId: 'missions.mission.facts.view',
    available: true,
  },
};

describe('TodayWorkspace', () => {
  it('renders the authoritative US/USD projection and its real next action', () => {
    const reached: string[] = [];
    const markup = renderToStaticMarkup(
      <TodayWorkspace
        capabilities={productionCapabilities}
        loading={false}
        onNavigate={(intent) => reached.push(`${intent.workspace}/${intent.subview}`)}
        projection={projection}
        storeContext={context}
      />,
    );
    expect(markup).toContain('data-production-today-projection="store-today"');
    expect(markup).toContain('Amazon US / USD');
    expect(markup).toContain('6827 行');
    expect(markup).toContain('进入广告事实分析');
    expect(markup).not.toContain('仅开发预览示例');
    expect(reached).toEqual([]);
  });

  it('disables a projected action when the live capability is blocked', () => {
    const markup = renderToStaticMarkup(
      <TodayWorkspace
        capabilities={[{ ...productionCapabilities[0], state: 'BLOCKED', blockerCode: 'NOT_READY' }]}
        loading={false}
        onNavigate={() => undefined}
        projection={projection}
        storeContext={context}
      />,
    );
    expect(markup).toContain('能力未接入');
    expect(markup).toContain('disabled=""');
  });

  it('labels the browser fixture as preview and never emits the production evidence attribute', () => {
    const markup = renderToStaticMarkup(
      <TodayWorkspace
        capabilities={[{ ...productionCapabilities[0], state: 'PROTOTYPE_ONLY' }]}
        loading={false}
        onNavigate={() => undefined}
        previewMode
        projection={{ ...projection, nextAction: { ...projection.nextAction, available: false } }}
        storeContext={context}
      />,
    );
    expect(markup).toContain('data-preview-today-projection="store-today"');
    expect(markup).toContain('开发预览');
    expect(markup).not.toContain('data-production-today-projection');
  });

  it('fails closed when the projection belongs to another store', () => {
    const markup = renderToStaticMarkup(
      <TodayWorkspace
        loading={false}
        onNavigate={() => undefined}
        projection={{ ...projection, storeId: 'other-store' }}
        storeContext={context}
      />,
    );
    expect(markup).toContain('今日投影不可用');
    expect(markup).toContain('StoreContext 不一致');
    expect(markup).not.toContain('data-production-today-projection');
  });

  it('fails closed when the same store advances to another browser session generation', () => {
    const advancedContext = normalizeStoreContextEnvelope({ ...context, sessionGeneration: 2 });
    const markup = renderToStaticMarkup(
      <TodayWorkspace
        loading={false}
        onNavigate={() => undefined}
        projection={projection}
        storeContext={advancedContext}
      />,
    );
    expect(markup).toContain('今日投影不可用');
    expect(markup).not.toContain('data-production-today-projection');
  });
});
