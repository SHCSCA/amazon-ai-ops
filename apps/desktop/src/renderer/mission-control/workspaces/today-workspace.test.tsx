import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { missionControlContextKey, normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { MissionControlTodayProjection } from '@amazon-ai-ops/shared-types';
import { TodayWorkspace, todayOperatorCopy } from './today-workspace';

function ordinaryText(markup: string): string {
  return markup
    .replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  it('redacts credentials and diagnostic paths before rendering ordinary projection copy', () => {
    const secret = 'sk-' + 'privatecredential'.repeat(3);
    const text = todayOperatorCopy(`请重试 C:\\Private Folder\\report.xlsx token=${secret}`, '请刷新后重试。');
    expect(text).not.toContain('Private Folder');
    expect(text).not.toContain('report.xlsx');
    expect(text).not.toContain(secret);
    expect(text).toContain('请重试');
    const markup = renderToStaticMarkup(<TodayWorkspace loading={false} onNavigate={() => undefined}
      projection={{ ...projection, blockers: [`请重试 C:\\Private Folder\\report.xlsx token=${secret}`] }} storeContext={context} />);
    expect(ordinaryText(markup)).not.toContain(secret);
    expect(ordinaryText(markup)).not.toContain('Private Folder');
  });
  it.each([
    { proposalCount: 0, blocked: false, secondaryLabel: '运行分析' },
    { proposalCount: 2, blocked: false, secondaryLabel: '查看建议' },
    { proposalCount: 2, blocked: true, secondaryLabel: '查看建议' },
  ])('keeps one primary action with $proposalCount proposals and blocked=$blocked', ({ proposalCount, blocked, secondaryLabel }) => {
    const value: MissionControlTodayProjection = {
      ...projection,
      blockers: blocked ? ['当前条件未满足，请先核对数据。'] : [],
      nextAction: { ...projection.nextAction, available: !blocked },
      analysis: {
        activeMissionId: 'mission-today',
        evidencePackageCount: 1,
        proposalCount,
        humanEligibleCount: proposalCount,
        policyEligibleCount: 0,
      },
    };
    const markup = renderToStaticMarkup(
      <TodayWorkspace
        capabilities={productionCapabilities}
        loading={false}
        onNavigate={() => undefined}
        projection={value}
        storeContext={context}
      />,
    );
    const buttons = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const primaryButtons = buttons.filter(button => /\bworkspace-button--primary\b/.test(button));
    expect(primaryButtons).toHaveLength(1);
    expect(primaryButtons[0]).toContain('data-action-priority="primary"');
    expect(primaryButtons[0]).toContain('data-action-id="review-ad-facts"');
    const secondary = buttons.find(button => button.includes(`>${secondaryLabel}</button>`));
    expect(secondary).toContain('workspace-button--secondary');
    expect(secondary).toContain('data-action-priority="secondary"');
    expect(primaryButtons[0].includes('disabled=""')).toBe(blocked);
  });

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
    expect(markup).toContain('今日数据与当前店铺范围不一致');
    expect(markup).not.toContain('StoreContext');
    expect(markup).not.toContain('data-production-today-projection');
  });

  it('keeps projection implementation terms inside diagnostics instead of ordinary copy', () => {
    const technicalProjection = {
      ...projection,
      readiness: projection.readiness.map((item, index) => index === 0
        ? { ...item, detail: 'Renderer sequence UNKNOWN' }
        : item),
      blockers: ['Main StoreContext Authority fingerprint'],
      attentionItems: ['append-only correction READBACK EFFECT'],
      nextAction: {
        ...projection.nextAction,
        detail: '生产下一动作必须由 Main 的店铺 Authority 投影给出。',
      },
    };
    const markup = renderToStaticMarkup(
      <TodayWorkspace
        capabilities={productionCapabilities}
        loading={false}
        onNavigate={() => undefined}
        projection={technicalProjection}
        storeContext={context}
      />,
    );
    expect(ordinaryText(markup)).not.toMatch(/Main|StoreContext|Authority|Renderer|UNKNOWN|fingerprint|sequence|append-only|correction|READBACK|EFFECT/i);
    expect(markup).toContain('诊断详情');
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
