import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  normalizeBusinessDate,
  normalizeBrowserProfileId,
  normalizeStoreId,
  type StoreContextEnvelope,
  type StoreDailyStatusProjection,
  type StoreRecord,
} from '@amazon-ai-ops/shared-types';
import {
  StoreScopeSwitcher,
  buildFixedUsStoreInput,
  validateStoreScopeCreateName,
} from './store-scope-switcher';

const storeOne: StoreRecord = {
  storeId: normalizeStoreId('store-one'),
  browserProfileId: normalizeBrowserProfileId('profile-one'),
  displayName: 'Northstar Home',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  status: 'active',
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};

const storeTwo: StoreRecord = {
  ...storeOne,
  storeId: normalizeStoreId('store-two'),
  browserProfileId: normalizeBrowserProfileId('profile-two'),
  displayName: 'Harbor Living',
};

const context: StoreContextEnvelope = {
  ...storeOne,
  businessDate: normalizeBusinessDate('2026-08-04'),
  sessionGeneration: 4,
};

function status(
  store: StoreRecord,
  overrides: Partial<StoreDailyStatusProjection> = {},
): StoreDailyStatusProjection {
  return {
    schemaVersion: 1,
    key: {
      storeId: store.storeId,
      marketplace: 'US',
      businessDate: normalizeBusinessDate('2026-08-04'),
    },
    displayName: store.displayName,
    storeStatus: store.status,
    currency: 'USD',
    selected: store.storeId === storeOne.storeId,
    eligibleForCollection: true,
    providers: {
      lingxing: {
        provider: 'lingxing',
        bindingState: 'ready',
        connectionStatus: 'ready',
        sessionStatus: 'ready',
      },
      amazonAds: {
        provider: 'amazon_ads',
        bindingState: 'ready',
        connectionStatus: 'ready',
        sessionStatus: 'ready',
      },
    },
    collection: {
      state: 'succeeded',
      requiredReportCount: 8,
      downloadedReportCount: 8,
    },
    import: { state: 'succeeded', importedReportCount: 8 },
    metrics: {
      freshness: 'fresh',
      expectedMetricDate: '2026-08-03',
      latestMetricDate: '2026-08-03',
    },
    overall: 'ready',
    blockers: [],
    generatedAt: '2026-08-04T09:00:00.000Z',
    ...overrides,
  };
}

const handlers = {
  onCreate: vi.fn(async () => storeTwo),
  onManage: vi.fn(),
  onRetry: vi.fn(),
  onSwitch: vi.fn(),
};

describe('StoreScopeSwitcher', () => {
  it('keeps one-store and collapsed authority legible without a singleton shortcut', () => {
    const markup = renderToStaticMarkup(
      <StoreScopeSwitcher
        {...handlers}
        activeStore={storeOne}
        authoritativeContext={context}
        collapsed
        dailyStatuses={[status(storeOne)]}
        phase="ready"
        stores={[storeOne]}
      />,
    );

    expect(markup).toContain('data-collapsed="true"');
    expect(markup).toContain('店铺与站点：Northstar Home，Amazon 美国站，美元');
    expect(markup).toContain('Amazon US · USD');
  });

  it('renders multi-store daily health and keeps UNKNOWN explicit', () => {
    const unknown = status(storeTwo, {
      overall: 'unknown',
      eligibleForCollection: false,
      collection: { state: 'unknown', requiredReportCount: 8 },
      import: { state: 'unknown' },
      metrics: { freshness: 'unknown', expectedMetricDate: '2026-08-03' },
      blockers: [{
        code: 'COLLECTION_AUTHORITY_UNKNOWN',
        severity: 'unknown',
        detail: '无法确认当前采集 authority。',
      }],
    });
    const markup = renderToStaticMarkup(
      <StoreScopeSwitcher
        {...handlers}
        activeStore={storeOne}
        authoritativeContext={context}
        dailyStatuses={[status(storeOne), unknown]}
        initiallyExpanded
        phase="ready"
        stores={[storeOne, storeTwo]}
      />,
    );

    expect(markup).toContain('role="listbox"');
    expect(markup).toContain('data-store-scope-id="store-one"');
    expect(markup).toContain('data-store-scope-id="store-two"');
    expect(markup).toContain('Northstar Home');
    expect(markup).toContain('Harbor Living');
    expect(markup).toContain('下载 8 / 8');
    expect(markup).toContain('下载 ? / 8');
    expect(markup).toContain('指标 UNKNOWN');
    expect(markup).toContain('无法确认当前采集 authority。');
  });

  it('covers loading, error/retry, empty and group-disabled switching states', () => {
    const loading = renderToStaticMarkup(
      <StoreScopeSwitcher {...handlers} dailyStatusPhase="loading" initiallyExpanded phase="loading" stores={[]} />,
    );
    const error = renderToStaticMarkup(
      <StoreScopeSwitcher {...handlers} dailyStatusError="读取失败" dailyStatusPhase="error" initiallyExpanded phase="error" stores={[]} />,
    );
    const empty = renderToStaticMarkup(
      <StoreScopeSwitcher {...handlers} initiallyExpanded phase="needs-selection" stores={[]} />,
    );
    const switching = renderToStaticMarkup(
      <StoreScopeSwitcher {...handlers} initiallyExpanded phase="switching" stores={[storeOne, storeTwo]} />,
    );

    expect(loading).toContain('正在读取今日状态');
    expect(error).toContain('读取失败');
    expect(error).toContain('重试');
    expect(empty).toContain('尚无可用店铺');
    expect(switching).toContain('aria-busy="true"');
    expect(switching).toContain('disabled=""');
  });

  it('fixes new stores to US/USD/Los Angeles and never couples create to switch', () => {
    expect(validateStoreScopeCreateName('')).toBe('请输入店铺名称。');
    expect(validateStoreScopeCreateName('x'.repeat(121))).toContain('120');
    expect(buildFixedUsStoreInput('  New Store  ')).toEqual({
      displayName: 'New Store',
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
    });

    const source = readFileSync(new URL('./store-scope-switcher.tsx', import.meta.url), 'utf8');
    const createStart = source.indexOf('async function submitCreate');
    const createBlock = source.slice(createStart, source.indexOf('\n  return (', createStart));
    expect(createBlock).toContain('await onCreate(buildFixedUsStoreInput(displayName))');
    expect(createBlock).not.toContain('requestSwitch');
    expect(source).toContain('切换店铺');
    expect(source).not.toContain('切换并登录');
    expect(source).toContain('if (initiallyExpanded && !previousInitiallyExpanded.current) setExpanded(true)');
    expect(source).toContain('useOverlayFocusScope');
    expect(source).toContain("document.addEventListener('mousedown'");
  });
});
