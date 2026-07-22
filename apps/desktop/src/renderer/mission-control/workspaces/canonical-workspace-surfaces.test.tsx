import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MissionControlViewId, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  CanonicalWorkspaceSurface,
  type CanonicalWorkspaceSurfaceKind,
} from './canonical-workspace-surfaces';

const shc001Context = {
  storeId: 'preview-store-shc001',
  browserProfileId: 'preview-profile-shc001',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 1,
} as StoreContextEnvelope;

const shc002Context = {
  storeId: 'preview-store-shc002',
  browserProfileId: 'preview-profile-shc002',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 1,
} as StoreContextEnvelope;

function renderSurface(
  kind: CanonicalWorkspaceSurfaceKind,
  storeContext: StoreContextEnvelope,
  view: MissionControlViewId,
): string {
  return renderToStaticMarkup(
    <CanonicalWorkspaceSurface
      blockedReason="预览没有写入 Authority"
      kind={kind}
      previewEnabled
      storeContext={storeContext}
      view={view}
    />,
  );
}

describe('canonical workspace store isolation', () => {
  it.each([
    ['today', 'today/overview', '稳定智能门锁核心搜索词花费并守住订单效率', '压低车库门开关高花费并守住转化', '推进度 64%', '推进度 41%'],
    ['missions', 'missions/overview', 'MISSION · US-SP-ACOS-001', 'MISSION · US-SP-TACOS-002', 'USD 120 / 日', 'USD 95 / 日'],
    ['decisions', 'decisions/recommendations', 'DEC-US-021', 'DEC-US-121', 'USD 68.40', 'USD 81.60'],
    ['decisions', 'decisions/approval', 'DEC-US-022', 'DEC-US-122', 'USD 1.20 → 1.08', 'USD 1.48 → 1.30'],
    ['decisions', 'decisions/decided', 'DEC-US-019', 'DEC-US-119', 'USD 36.00 / 日', 'USD 42.00 / 日'],
    ['experiments', 'experiments/ledger', 'EXPERIMENT · EXP-US-014', 'EXPERIMENT · EXP-US-022', 'ACOS 46.8%', 'ACOS 52.4%'],
    ['execution', 'execution/live', 'smart lock bedroom', 'garage door opener wifi', 'USD 1.08', 'USD 1.30'],
    ['memory', 'memory/timeline', '降低出价 10%', '降低出价 12%', 'US-SP-SHC001-Exact', 'US-SP-SHC002-Garage'],
    ['policy', 'policy/rules', 'POL-SHC001-US · v3', 'POL-SHC002-US · v2', '≤ 20%', '≤ 8%'],
  ] as const)(
    'keeps %s facts scoped to the active store',
    (kind, view, shc001Identity, shc002Identity, shc001Fact, shc002Fact) => {
      const shc001 = renderSurface(kind, shc001Context, view);
      const shc002 = renderSurface(kind, shc002Context, view);

      expect(shc001).toContain('data-preview-store-fixture="SHC001"');
      expect(shc001).toContain('B0GTTJFQTM');
      expect(shc001).toContain('BATCH-SHC001-0722');
      expect(shc001).toContain(shc001Identity);
      expect(shc001).toContain(shc001Fact);
      expect(shc001).not.toContain('B0SHC00201');
      expect(shc001).not.toContain('BATCH-SHC002-0722');
      expect(shc001).not.toContain(shc002Identity);
      expect(shc001).not.toContain(shc002Fact);

      expect(shc002).toContain('data-preview-store-fixture="SHC002"');
      expect(shc002).toContain('B0SHC00201');
      expect(shc002).toContain('BATCH-SHC002-0722');
      expect(shc002).toContain(shc002Identity);
      expect(shc002).toContain(shc002Fact);
      expect(shc002).not.toContain('B0GTTJFQTM');
      expect(shc002).not.toContain('BATCH-SHC001-0722');
      expect(shc002).not.toContain(shc001Identity);
      expect(shc002).not.toContain(shc001Fact);
    },
  );

  it('derives an isolated neutral fixture for an additional configured store', () => {
    const third = renderSurface('today', {
      ...shc001Context,
      storeId: 'preview-store-third',
      browserProfileId: 'preview-profile-third',
    } as StoreContextEnvelope, 'today/overview');

    expect(third).toContain('data-preview-store-fixture="STORE-');
    expect(third).toContain('preview-store-third · 独立预览');
    expect(third).not.toContain('B0GTTJFQTM');
    expect(third).not.toContain('B0SHC00201');
    expect(third).not.toContain('稳定智能门锁核心搜索词');
    expect(third).not.toContain('压低车库门开关高花费');
  });

  it.each([
    ['today', 'today/overview'],
    ['missions', 'missions/overview'],
    ['decisions', 'decisions/recommendations'],
    ['experiments', 'experiments/ledger'],
    ['execution', 'execution/live'],
    ['memory', 'memory/timeline'],
    ['policy', 'policy/rules'],
  ] as const)('does not leak %s preview facts into a production-blocked surface', (kind, view) => {
    const markup = renderToStaticMarkup(
      <CanonicalWorkspaceSurface
        blockedReason="生产 Authority 未接入"
        kind={kind}
        previewEnabled={false}
        storeContext={shc001Context}
        view={view}
      />,
    );

    expect(markup).not.toContain('data-preview-store-fixture');
    expect(markup).not.toContain('B0GTTJFQTM');
    expect(markup).not.toContain('BATCH-SHC001-0722');
    expect(markup).not.toContain('US-SP-ACOS-001');
  });
});

describe('canonical execution responsive containment', () => {
  it('switches the execution room to one column by content width and keeps the wide object table scrollable', () => {
    const css = readFileSync(new URL('./canonical-workspace-surfaces.css', import.meta.url), 'utf8');
    const markup = renderSurface('execution', shc001Context, 'execution/live');

    expect(css).toMatch(/container-name:\s*canonical-workspace/);
    expect(css).toMatch(/container-type:\s*inline-size/);
    expect(css).toMatch(/@container canonical-workspace \(max-width:\s*1040px\)[\s\S]*?\.canonical-execution-room\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.canonical-browser-table-scroll\s*\{[\s\S]*?overflow-x:\s*auto/);
    expect(css).toMatch(/\.canonical-browser-table\s*\{[\s\S]*?width:\s*max\(100%,\s*680px\)/);
    expect(markup).toContain('class="canonical-browser-table-scroll"');
    expect(markup).toContain('tabindex="0"');
  });
});
