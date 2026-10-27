import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MissionControlCapabilityProjection } from '@amazon-ai-ops/shared-types';
import { buildMissionControlTodayProjection } from '../../../main/mission-control-today-projection';
import { context, completedJob } from '../../../main/mission-control-today.test-fixtures';
import { TodayWorkspace } from './today-workspace';

describe('Today production blocker recovery contract', () => {
  it.each(['missing-products-and-reports', 'failed-import', 'unknown-execution'] as const)('renders a Chinese reason and its own exact recovery destination for every %s blocker', scenario => {
    const projection = buildMissionControlTodayProjection({ context,
      products: scenario === 'missing-products-and-reports' ? [] : [{ status: 'active', cost: { currentPrice: 20, purchaseCost: 5, targetAcos: 0.2 } }],
      collectionJobs: scenario === 'failed-import' ? [completedJob('failed')] : [],
      reportImportProofs: [], importedMetricRows: 0, operationEventsToday: 0, browserSessionReady: false,
      executionBatches: scenario === 'unknown-execution' ? [{ storeId: context.storeId, marketplace: 'US', currency: 'USD', status: 'unknown' }] : [],
    });
    expect(projection.blockerActions).toHaveLength(projection.blockers.length);
    const expected = scenario === 'missing-products-and-reports' ? ['objects/products', 'collection/reports']
      : scenario === 'failed-import' ? ['collection/reports'] : ['execution/live', 'collection/reports'];
    expect(projection.blockerActions!.map(blocker => blocker.targetView)).toEqual(expected);
    const capabilities: MissionControlCapabilityProjection[] = projection.blockerActions!.map(blocker => ({ capabilityId: blocker.requiredCapabilityId,
      workspace: blocker.targetView.split('/')[0] as MissionControlCapabilityProjection['workspace'], view: blocker.targetView,
      action: 'view', state: 'PRODUCTION_NATIVE', detail: '当前恢复入口已实现。' }));
    const markup = renderToStaticMarkup(<TodayWorkspace projection={projection} storeContext={context}
      loading={false} onNavigate={() => undefined} capabilities={capabilities} />);
    for (const blocker of projection.blockerActions!) {
      expect(blocker.reason).toMatch(/[\u4e00-\u9fff]/);
      expect(blocker.recoveryLabel).toMatch(/[\u4e00-\u9fff]/);
      expect(blocker.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(markup).toContain(`data-recovery-intent="${blocker.targetView}"`);
      expect(markup).toContain(blocker.reason);
      expect(markup).toContain(blocker.recoveryLabel);
    }
    expect((markup.match(/data-action-priority="primary"/g) ?? [])).toHaveLength(1);
  });

  it('explains a disabled recovery destination without granting its missing capability', () => {
    const projection = buildMissionControlTodayProjection({ context, products: [], collectionJobs: [], reportImportProofs: [],
      importedMetricRows: 0, operationEventsToday: 0, browserSessionReady: false, executionBatches: [] });
    const markup = renderToStaticMarkup(<TodayWorkspace projection={projection} storeContext={context}
      loading={false} onNavigate={() => undefined} capabilities={[]} />);
    expect(markup).toContain('当前恢复入口尚未接入，请先刷新应用连接。');
    expect(markup).toMatch(/data-recovery-intent="objects\/products"[^>]*disabled=""/);
    expect(markup).toMatch(/data-recovery-intent="collection\/reports"[^>]*disabled=""/);
  });
});
