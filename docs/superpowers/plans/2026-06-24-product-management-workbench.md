# Product Management Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows desktop product management workbench that lets operators select a real product instead of a naked ASIN, then see linked advertising data, product/global operation events, AI quantification entry points, keyword opportunities, and Listing actions.

**Architecture:** Add a focused renderer model layer for product summaries and product event timelines, then wire it into a new `ProductManagementPage`. Keep current SQLite and IPC contracts, but adjust the business-data pipeline event selection so scoped product views include global events. Reuse existing `scope.asin`, product config, product history ledger, ad quant product grouping, and route navigation.

**Tech Stack:** React, TypeScript, Zustand `scope-store`, Electron IPC/preload, local SQLite repositories, Vitest, existing CSS tokens, existing business UI smoke scripts.

---

## Scope Check

The spec touches navigation, product page UI, operation-event semantics, scope display, and smoke evidence, but all pieces serve one coherent product-centered workflow. Keep this as one implementation plan because every task is needed for the same user-visible end state: selecting a product drives advertising data, operation timelines, AI quantification, keywords, and Listing context.

## File Structure

- Create `apps/desktop/src/renderer/product-management.ts`: pure renderer model helpers for product summaries, event classification, product timelines, and scope product labels.
- Create `apps/desktop/src/renderer/product-management.test.ts`: TDD coverage for product summary, global/product/ad-object event classification, timeline sorting, and scope product label formatting.
- Create `apps/desktop/src/main/operation-event-scope.ts`: pure main-process helper to filter all current-scope events into product-aware event sets without changing repository behavior.
- Create `apps/desktop/src/main/operation-event-scope.test.ts`: TDD coverage proving product-scoped business data includes global events and excludes other product events.
- Create `apps/desktop/src/renderer/pages/product-management-page.tsx`: new route page that composes product list, product identity, ad summary, event timeline, AI entry points, keyword/Listing actions, and cost/target entry actions.
- Create `apps/desktop/src/renderer/pages/product-management-page.test.tsx`: renderer tests for page view-model output, labels, navigation routes, event tags, and empty states.
- Modify `apps/desktop/src/renderer/types.ts`: add `product-management` to `AppRoute`.
- Modify `apps/desktop/src/renderer/components/app-shell.tsx`: add `产品管理` under `运营总览` and remove `产品 ACOS 配置` from `数据与量化`.
- Modify `apps/desktop/src/renderer/components/app-shell.test.tsx`: update nav labels and group numbering expectations.
- Modify `apps/desktop/src/renderer/App.tsx`: import and route `ProductManagementPage`.
- Modify `apps/desktop/src/renderer/components/scope-bar.tsx`: show product title plus ASIN when the selected ASIN matches product config.
- Modify `apps/desktop/src/renderer/pages/operation-events-page.tsx`: add global/product/all event views and event scope selection for new events.
- Modify `apps/desktop/src/renderer/pages/ad-quant-page.tsx`: promote product selection to `scope.asin` instead of keeping only local selected-product state.
- Modify `apps/desktop/src/main/index.ts`: use `operation-event-scope.ts` when building business data pipeline events and product history ledgers.
- Modify `scripts/smoke-business-ui-shell.js` and `scripts/smoke-business-ui-data-pipeline.js`: include product management navigation and product timeline assertions.
- Modify docs after implementation: `README.md`, `docs/USER_GUIDE_v1_5.md`, `docs/V1_5_ACCEPTANCE_MATRIX.md`, `docs/V1_5_PROGRESS_REPORT.md`, and `docs/V1_5_ORCHESTRATOR_CLOSEOUT.md` if delivery status, package hashes, or user-visible workflow evidence changes.

## Task 1: Product Management Renderer Model

**Files:**
- Create: `apps/desktop/src/renderer/product-management.ts`
- Test: `apps/desktop/src/renderer/product-management.test.ts`

- [ ] **Step 1: Write the failing product summary and timeline tests**

Create `apps/desktop/src/renderer/product-management.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildProductManagementSummaries,
  buildProductTimeline,
  classifyOperationEventScope,
  formatScopeProductLabel,
} from './product-management';
import type {
  BusinessQuantDiagnostic,
  OperationEventView,
  ProductHistoryLedgerView,
  ProductStrategyContextView,
} from './types';

describe('product management renderer model', () => {
  it('combines product identity, ad metrics, ledgers, and event counts by ASIN', () => {
    const products: ProductStrategyContextView[] = [
      { asin: 'B001', title: 'D6 Smart Lock', sku: 'D6-SKU', productStage: 'keyword_exploration', status: 'active', cost: { targetAcos: 0.35 } },
    ];
    const diagnostics: BusinessQuantDiagnostic[] = [
      diagnostic({ asin: 'B001', spend: 12, sales: 30, orders: 1, clicks: 10, severity: 'high' }),
      diagnostic({ asin: 'B002', spend: 8, sales: 0, orders: 0, clicks: 6 }),
    ];
    const ledgers: ProductHistoryLedgerView[] = [
      ledger({ asin: 'B001', cost: 80, sales: 160, orders: 4, clicks: 40, inferredStage: 'keyword_exploration' }),
    ];
    const events = [
      event({ id: 1, eventDate: '2026-06-10', asin: 'B001', title: 'D6 Coupon' }),
      event({ id: 2, eventDate: '2026-06-09', asin: undefined, title: 'Prime event' }),
      event({ id: 3, eventDate: '2026-06-08', asin: 'B002', title: 'Other product coupon' }),
    ];

    const result = buildProductManagementSummaries({ products, diagnostics, ledgers, events });

    expect(result.map((item) => item.asin)).toEqual(['B001', 'B002']);
    expect(result[0]).toMatchObject({
      asin: 'B001',
      title: 'D6 Smart Lock',
      skuLine: 'D6-SKU',
      stage: 'keyword_exploration',
      status: 'active',
      cost: 80,
      sales: 160,
      orders: 4,
      clicks: 40,
      highRiskCount: 1,
      productEventCount: 1,
      globalEventCount: 1,
      eventCount: 2,
      configured: true,
    });
    expect(result[1]).toMatchObject({
      asin: 'B002',
      title: 'B002',
      configured: false,
      productEventCount: 1,
      globalEventCount: 1,
    });
  });

  it('classifies global, product, and ad object events for the selected ASIN', () => {
    expect(classifyOperationEventScope(event({ asin: undefined, campaignName: undefined, adGroupName: undefined }), 'B001')).toBe('global');
    expect(classifyOperationEventScope(event({ asin: 'b001', campaignName: undefined, adGroupName: undefined }), 'B001')).toBe('product');
    expect(classifyOperationEventScope(event({ asin: 'B001', campaignName: 'SP exact', adGroupName: 'Main' }), 'B001')).toBe('ad_object');
    expect(classifyOperationEventScope(event({ asin: 'B002', campaignName: undefined, adGroupName: undefined }), 'B001')).toBe('other_product');
  });

  it('builds a product timeline with selected product events and global events sorted by date', () => {
    const timeline = buildProductTimeline({
      selectedAsin: 'B001',
      events: [
        event({ id: 1, eventDate: '2026-06-01', asin: 'B001', title: 'Listing changed' }),
        event({ id: 2, eventDate: '2026-06-03', asin: undefined, title: 'Prime event' }),
        event({ id: 3, eventDate: '2026-06-02', asin: 'B002', title: 'Other product event' }),
        event({ id: 4, eventDate: '2026-06-03', asin: 'B001', campaignName: 'SP exact', title: 'Campaign bid changed' }),
      ],
    });

    expect(timeline.map((item) => `${item.event.eventDate}:${item.scope}:${item.event.title}`)).toEqual([
      '2026-06-03:ad_object:Campaign bid changed',
      '2026-06-03:global:Prime event',
      '2026-06-01:product:Listing changed',
    ]);
  });

  it('formats scope product labels with title plus ASIN', () => {
    expect(formatScopeProductLabel('B001', [{ asin: 'B001', title: 'D6 Smart Lock' }])).toBe('D6 Smart Lock / B001');
    expect(formatScopeProductLabel('B002', [{ asin: 'B001', title: 'D6 Smart Lock' }])).toBe('B002');
    expect(formatScopeProductLabel(undefined, [{ asin: 'B001', title: 'D6 Smart Lock' }])).toBe('全部产品');
  });
});

function diagnostic(patch: Partial<BusinessQuantDiagnostic>): BusinessQuantDiagnostic {
  return {
    portfolioName: '',
    campaignName: '',
    adGroupName: '',
    asin: 'B001',
    objectType: 'search_term',
    objectName: 'smart lock',
    spend: 0,
    sales: 0,
    orders: 0,
    clicks: 0,
    acos: 0,
    cvr: 0,
    cpc: 0,
    diagnosis: '观察',
    suggestedDirection: '复核',
    ...patch,
  };
}

function ledger(patch: Partial<ProductHistoryLedgerView> & { asin: string; cost?: number; sales?: number; orders?: number; clicks?: number }): ProductHistoryLedgerView {
  return {
    asin: patch.asin,
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    dateFrom: '2026-06-01',
    dateTo: '2026-06-12',
    activeDays: 2,
    inferredStage: patch.inferredStage || 'unknown',
    stageReasons: [],
    daily: [],
    totals: {
      impressions: 100,
      clicks: patch.clicks || 0,
      cost: patch.cost || 0,
      orders: patch.orders || 0,
      sales: patch.sales || 0,
      acos: patch.sales ? (patch.cost || 0) / patch.sales : 0,
      cpc: patch.clicks ? (patch.cost || 0) / patch.clicks : 0,
      cvr: patch.clicks ? (patch.orders || 0) / patch.clicks : 0,
      currency: 'USD',
    },
    events: [],
    ...patch,
  };
}

function event(patch: Partial<OperationEventView>): OperationEventView {
  return {
    id: patch.id || 1,
    eventDate: patch.eventDate || '2026-06-01',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: patch.asin,
    campaignName: patch.campaignName,
    adGroupName: patch.adGroupName,
    eventType: patch.eventType || 'coupon',
    title: patch.title || 'Event',
    impactExpectation: patch.impactExpectation || 'unknown',
    notes: patch.notes,
    evidencePath: patch.evidencePath,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `pnpm exec vitest run apps\desktop\src\renderer\product-management.test.ts --reporter=dot`

Expected: FAIL because `apps/desktop/src/renderer/product-management.ts` does not exist.

- [ ] **Step 3: Implement the renderer model helpers**

Create `apps/desktop/src/renderer/product-management.ts`:

```ts
import type {
  BusinessQuantDiagnostic,
  OperationEventView,
  ProductHistoryLedgerView,
  ProductStrategyContextView,
} from './types';

export type ProductEventScope = 'global' | 'product' | 'ad_object' | 'other_product';

export interface ProductManagementSummary {
  productKey: string;
  asin: string;
  title: string;
  skuLine: string;
  stage?: string;
  status?: string;
  cost: number;
  sales: number;
  orders: number;
  clicks: number;
  acos: number;
  cvr: number;
  cpc: number;
  diagnosticCount: number;
  highRiskCount: number;
  productEventCount: number;
  globalEventCount: number;
  eventCount: number;
  configured: boolean;
}

export interface ProductTimelineItem {
  event: OperationEventView;
  scope: Exclude<ProductEventScope, 'other_product'>;
}

export function buildProductManagementSummaries(input: {
  products: ProductStrategyContextView[];
  diagnostics: BusinessQuantDiagnostic[];
  ledgers: ProductHistoryLedgerView[];
  events: OperationEventView[];
}): ProductManagementSummary[] {
  const summaries = new Map<string, ProductManagementSummary>();
  const ensure = (asinValue: string, configured = false): ProductManagementSummary => {
    const asin = normalizeAsin(asinValue);
    const existing = summaries.get(asin);
    if (existing) {
      existing.configured = existing.configured || configured;
      return existing;
    }
    const created: ProductManagementSummary = {
      productKey: asin,
      asin,
      title: asin,
      skuLine: '-',
      cost: 0,
      sales: 0,
      orders: 0,
      clicks: 0,
      acos: 0,
      cvr: 0,
      cpc: 0,
      diagnosticCount: 0,
      highRiskCount: 0,
      productEventCount: 0,
      globalEventCount: countGlobalEvents(input.events),
      eventCount: countGlobalEvents(input.events),
      configured,
    };
    summaries.set(asin, created);
    return created;
  };

  for (const product of input.products || []) {
    const asin = normalizeAsin(product.asin);
    if (!asin) continue;
    const summary = ensure(asin, true);
    summary.title = product.title?.trim() || asin;
    summary.skuLine = [product.msku, product.sku].map((item) => item?.trim()).filter(Boolean).join(' / ') || '-';
    summary.stage = product.productStage;
    summary.status = product.status;
  }

  for (const diagnostic of input.diagnostics || []) {
    const asin = normalizeAsin(diagnostic.asin);
    if (!asin) continue;
    const summary = ensure(asin);
    summary.cost += numberValue(diagnostic.spend);
    summary.sales += numberValue(diagnostic.sales);
    summary.orders += numberValue(diagnostic.orders);
    summary.clicks += numberValue(diagnostic.clicks);
    summary.diagnosticCount += 1;
    if (diagnostic.severity === 'high' || diagnostic.quantStatus === 'waste') summary.highRiskCount += 1;
  }

  for (const ledger of input.ledgers || []) {
    const asin = normalizeAsin(ledger.asin);
    if (!asin) continue;
    const summary = ensure(asin);
    summary.cost = Math.max(summary.cost, numberValue(ledger.totals.cost));
    summary.sales = Math.max(summary.sales, numberValue(ledger.totals.sales));
    summary.orders = Math.max(summary.orders, numberValue(ledger.totals.orders));
    summary.clicks = Math.max(summary.clicks, numberValue(ledger.totals.clicks));
    summary.stage = summary.stage || ledger.inferredStage;
  }

  for (const event of input.events || []) {
    const asin = normalizeAsin(event.asin);
    if (!asin) continue;
    const summary = ensure(asin);
    summary.productEventCount += 1;
    summary.eventCount = summary.productEventCount + summary.globalEventCount;
  }

  return [...summaries.values()]
    .map((summary) => ({
      ...summary,
      cost: roundMoney(summary.cost),
      sales: roundMoney(summary.sales),
      acos: summary.sales > 0 ? summary.cost / summary.sales : 0,
      cpc: summary.clicks > 0 ? summary.cost / summary.clicks : 0,
      cvr: summary.clicks > 0 ? summary.orders / summary.clicks : 0,
    }))
    .sort((left, right) => right.cost - left.cost
      || right.highRiskCount - left.highRiskCount
      || right.eventCount - left.eventCount
      || left.title.localeCompare(right.title)
      || left.asin.localeCompare(right.asin));
}

export function buildProductTimeline(input: {
  selectedAsin: string;
  events: OperationEventView[];
}): ProductTimelineItem[] {
  const selectedAsin = normalizeAsin(input.selectedAsin);
  return (input.events || [])
    .map((event) => ({ event, scope: classifyOperationEventScope(event, selectedAsin) }))
    .filter((item): item is ProductTimelineItem => item.scope === 'global' || item.scope === 'product' || item.scope === 'ad_object')
    .sort((left, right) => right.event.eventDate.localeCompare(left.event.eventDate)
      || scopePriority(left.scope) - scopePriority(right.scope)
      || right.event.id - left.event.id);
}

export function classifyOperationEventScope(event: OperationEventView, selectedAsin?: string): ProductEventScope {
  const eventAsin = normalizeAsin(event.asin);
  const scopeAsin = normalizeAsin(selectedAsin);
  const hasAdObject = Boolean(clean(event.campaignName) || clean(event.adGroupName));
  if (!eventAsin && !hasAdObject) return 'global';
  if (scopeAsin && eventAsin === scopeAsin && hasAdObject) return 'ad_object';
  if (scopeAsin && eventAsin === scopeAsin) return 'product';
  return 'other_product';
}

export function formatScopeProductLabel(scopeAsin: string | undefined, products: ProductStrategyContextView[]): string {
  const asin = normalizeAsin(scopeAsin);
  if (!asin) return '全部产品';
  const product = (products || []).find((item) => normalizeAsin(item.asin) === asin);
  const title = product?.title?.trim();
  return title ? `${title} / ${asin}` : asin;
}

function countGlobalEvents(events: OperationEventView[]): number {
  return (events || []).filter((event) => classifyOperationEventScope(event) === 'global').length;
}

function scopePriority(scope: Exclude<ProductEventScope, 'other_product'>): number {
  if (scope === 'product') return 1;
  if (scope === 'ad_object') return 2;
  return 3;
}

function normalizeAsin(value?: string): string {
  return String(value || '').trim().toUpperCase();
}

function clean(value?: string): string {
  return String(value || '').trim();
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(4));
}
```

- [ ] **Step 4: Run the renderer model test to verify it passes**

Run: `pnpm exec vitest run apps\desktop\src\renderer\product-management.test.ts --reporter=dot`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit Task 1**

```powershell
git add apps\desktop\src\renderer\product-management.ts apps\desktop\src\renderer\product-management.test.ts
git commit -m "feat: add product management view model"
```

## Task 2: Product-Aware Operation Event Semantics

**Files:**
- Create: `apps/desktop/src/main/operation-event-scope.ts`
- Test: `apps/desktop/src/main/operation-event-scope.test.ts`
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Write the failing main-process event-scope tests**

Create `apps/desktop/src/main/operation-event-scope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { filterBusinessPipelineOperationEvents, operationEventIsGlobal, operationEventMatchesProduct } from './operation-event-scope';
import type { OperationEvent } from '@amazon-ai-ops/shared-types';

describe('operation event scope helpers', () => {
  it('identifies global events without product or ad-object binding', () => {
    expect(operationEventIsGlobal(event({ asin: undefined, campaignName: undefined, adGroupName: undefined }))).toBe(true);
    expect(operationEventIsGlobal(event({ asin: 'B001' }))).toBe(false);
    expect(operationEventIsGlobal(event({ campaignName: 'SP exact' }))).toBe(false);
  });

  it('matches product events case-insensitively and excludes other products', () => {
    expect(operationEventMatchesProduct(event({ asin: 'b001' }), 'B001')).toBe(true);
    expect(operationEventMatchesProduct(event({ asin: 'B002' }), 'B001')).toBe(false);
    expect(operationEventMatchesProduct(event({ asin: undefined }), 'B001')).toBe(false);
  });

  it('keeps selected product events plus global events for product-scoped business data', () => {
    const result = filterBusinessPipelineOperationEvents({
      scopeAsin: 'B001',
      events: [
        event({ id: 1, asin: 'B001', title: 'Product coupon' }),
        event({ id: 2, asin: undefined, title: 'Prime event' }),
        event({ id: 3, asin: 'B002', title: 'Other product coupon' }),
      ],
    });

    expect(result.map((item) => item.title)).toEqual(['Product coupon', 'Prime event']);
  });

  it('keeps all events when no product is selected', () => {
    const result = filterBusinessPipelineOperationEvents({
      scopeAsin: undefined,
      events: [
        event({ id: 1, asin: 'B001', title: 'Product coupon' }),
        event({ id: 2, asin: undefined, title: 'Prime event' }),
      ],
    });

    expect(result.map((item) => item.title)).toEqual(['Product coupon', 'Prime event']);
  });
});

function event(patch: Partial<OperationEvent>): OperationEvent {
  return {
    id: patch.id || 1,
    eventDate: '2026-06-01',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: patch.asin,
    campaignName: patch.campaignName,
    adGroupName: patch.adGroupName,
    eventType: 'coupon',
    title: patch.title || 'Event',
    impactExpectation: 'unknown',
    notes: undefined,
    evidencePath: undefined,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}
```

- [ ] **Step 2: Run the new main-process test to verify it fails**

Run: `pnpm exec vitest run apps\desktop\src\main\operation-event-scope.test.ts --reporter=dot`

Expected: FAIL because `apps/desktop/src/main/operation-event-scope.ts` does not exist.

- [ ] **Step 3: Implement the event-scope helper**

Create `apps/desktop/src/main/operation-event-scope.ts`:

```ts
import type { OperationEvent } from '@amazon-ai-ops/shared-types';

export function filterBusinessPipelineOperationEvents(input: {
  scopeAsin?: string;
  events: OperationEvent[];
}): OperationEvent[] {
  const scopeAsin = normalizeAsin(input.scopeAsin);
  if (!scopeAsin) return input.events || [];
  return (input.events || []).filter((event) => operationEventIsGlobal(event) || operationEventMatchesProduct(event, scopeAsin));
}

export function operationEventIsGlobal(event: Pick<OperationEvent, 'asin' | 'campaignName' | 'adGroupName'>): boolean {
  return !normalizeAsin(event.asin) && !clean(event.campaignName) && !clean(event.adGroupName);
}

export function operationEventMatchesProduct(event: Pick<OperationEvent, 'asin'>, asin?: string): boolean {
  const eventAsin = normalizeAsin(event.asin);
  const scopeAsin = normalizeAsin(asin);
  return Boolean(eventAsin && scopeAsin && eventAsin === scopeAsin);
}

function normalizeAsin(value?: string): string {
  return String(value || '').trim().toUpperCase();
}

function clean(value?: string): string {
  return String(value || '').trim();
}
```

- [ ] **Step 4: Run the event-scope helper test to verify it passes**

Run: `pnpm exec vitest run apps\desktop\src\main\operation-event-scope.test.ts --reporter=dot`

Expected: PASS, 4 tests.

- [ ] **Step 5: Wire product-aware events into the business data pipeline**

Modify `apps/desktop/src/main/index.ts`:

1. Add the import near existing main imports:

```ts
import { filterBusinessPipelineOperationEvents } from './operation-event-scope';
```

2. In `getBusinessUiDataPipeline` where `operationEvents` are loaded, replace the ASIN-filtered repository call with a base range query plus helper filtering:

```ts
  const operationEventsInRange = state.operationEventRepo?.findByScope({
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    limit: 300,
  }) || [];
  const operationEvents = filterBusinessPipelineOperationEvents({
    scopeAsin: scope.asin,
    events: operationEventsInRange,
  });
```

Keep the existing `operationEvents` variable name for the product history ledger and returned `operations.events`.

- [ ] **Step 6: Run focused tests for event semantics**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\main\operation-event-scope.test.ts apps\desktop\src\main\ad-product-history-ledger.test.ts packages\local-db\src\sqlite\repositories\operation-event-repo.test.ts --reporter=dot
```

Expected: PASS. This proves the new helper is isolated, the existing repository behavior stays stable, and product ledgers still accept global events after the main process passes them in.

- [ ] **Step 7: Commit Task 2**

```powershell
git add apps\desktop\src\main\operation-event-scope.ts apps\desktop\src\main\operation-event-scope.test.ts apps\desktop\src\main\index.ts
git commit -m "feat: include global events in product context"
```

## Task 3: Navigation and Product Management Route

**Files:**
- Modify: `apps/desktop/src/renderer/types.ts`
- Modify: `apps/desktop/src/renderer/components/app-shell.tsx`
- Modify: `apps/desktop/src/renderer/components/app-shell.test.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Create: `apps/desktop/src/renderer/pages/product-management-page.tsx`

- [ ] **Step 1: Write the failing navigation test**

Modify `apps/desktop/src/renderer/components/app-shell.test.tsx`:

```ts
  it('renders product management as a top-level operations entry', () => {
    const tree = Sidebar({ activeRoute: 'product-management', onNavigate: () => undefined }) as ReactElement;
    const navText = collectText(tree);

    expect(navText).toContain('今日看板');
    expect(navText).toContain('产品管理');
    expect(navText).not.toContain('产品 ACOS 配置');
    expect(navGroups[0].items.map((item) => item.id)).toEqual(['dashboard', 'product-management']);
  });
```

Update the existing group-numbering expectation in the same file to:

```ts
    expect(navGroups.map((group) => group.items.map((_, index) => navItemOrdinal(index)))).toEqual([
      ['01', '02'],
      ['01', '02', '03', '04', '05'],
      ['01', '02', '03'],
      ['01', '02'],
      ['01', '02', '03'],
    ]);
```

- [ ] **Step 2: Run the navigation test to verify it fails**

Run: `pnpm exec vitest run apps\desktop\src\renderer\components\app-shell.test.tsx --reporter=dot`

Expected: FAIL because `product-management` is not a route and nav still contains `产品 ACOS 配置`.

- [ ] **Step 3: Add the route type and navigation item**

Modify `apps/desktop/src/renderer/types.ts` so `AppRoute` includes:

```ts
  | 'product-management'
```

Modify `apps/desktop/src/renderer/components/app-shell.tsx`:

```tsx
export const navGroups: NavGroup[] = [
  {
    label: '运营总览',
    items: [
      { id: 'dashboard', label: '今日看板' },
      { id: 'product-management', label: '产品管理' },
    ],
  },
  {
    label: '数据与量化',
    items: [
      { id: 'operation-scope', label: '工作范围' },
      { id: 'data-collection', label: '批量数据采集' },
      { id: 'data-import-validation', label: '指标核验入库' },
      { id: 'operation-events', label: '运营事件' },
      { id: 'ad-quant', label: '量化诊断中心' },
    ],
  },
```

- [ ] **Step 4: Create a minimal ProductManagementPage route shell**

Create `apps/desktop/src/renderer/pages/product-management-page.tsx`:

```tsx
import React from 'react';
import { PageHeader, Panel } from '../components/ui';

export function ProductManagementPage() {
  return (
    <div>
      <PageHeader
        eyebrow="运营总览"
        title="产品管理"
        description="先选择产品，再关联广告数据、运营事件、AI 量化、关键词和 Listing。"
        primaryTask="按产品管理运营上下文"
        nextAction="选择产品"
      />
      <div className="business-stack">
        <Panel title="产品工作台">
          <p className="muted-line">正在读取当前范围的产品、广告数据和运营事件。</p>
        </Panel>
      </div>
    </div>
  );
}
```

Modify `apps/desktop/src/renderer/App.tsx`:

```tsx
import { ProductManagementPage } from './pages/product-management-page';
```

Add the route branch in `BusinessRoutePage`:

```tsx
  if (route === 'product-management') return <ProductManagementPage />;
```

- [ ] **Step 5: Run navigation and app route tests**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\components\app-shell.test.tsx apps\desktop\src\renderer\app-readiness-status.test.ts --reporter=dot
```

Expected: PASS for app-shell tests. If TypeScript reports route type errors, fix route unions and imports before moving on.

- [ ] **Step 6: Commit Task 3**

```powershell
git add apps\desktop\src\renderer\types.ts apps\desktop\src\renderer\components\app-shell.tsx apps\desktop\src\renderer\components\app-shell.test.tsx apps\desktop\src\renderer\App.tsx apps\desktop\src\renderer\pages\product-management-page.tsx
git commit -m "feat: add product management route"
```

## Task 4: Product Management Page View Model and UI

**Files:**
- Modify: `apps/desktop/src/renderer/pages/product-management-page.tsx`
- Test: `apps/desktop/src/renderer/pages/product-management-page.test.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Write the failing page view-model test**

Create `apps/desktop/src/renderer/pages/product-management-page.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import {
  buildProductManagementPageModel,
  productManagementActionRoutes,
  productTimelineScopeLabel,
} from './product-management-page';
import type { BusinessDataPipeline } from '../types';

describe('ProductManagementPage model', () => {
  it('selects the scoped product and exposes product identity, ad summary, and timeline tags', () => {
    const model = buildProductManagementPageModel({
      data: pipeline(),
      scopeAsin: 'B001',
    });

    expect(model.selectedProduct?.title).toBe('D6 Smart Lock');
    expect(model.selectedProduct?.asin).toBe('B001');
    expect(model.selectedProduct?.cost).toBe(80);
    expect(model.timeline.map((item) => productTimelineScopeLabel(item.scope))).toEqual(['全局', '产品']);
    expect(model.emptyReason).toBe('');
  });

  it('uses clear empty copy when no products or ASIN metrics exist', () => {
    const model = buildProductManagementPageModel({
      data: { ...pipeline(), productContext: { products: [], productCount: 0, notes: [] }, productHistory: { ledgers: [], ledgerCount: 0, notes: [] }, quant: { ...pipeline().quant, diagnostics: [] }, operations: { events: [], eventCount: 0, notes: [] } },
      scopeAsin: '',
    });

    expect(model.products).toHaveLength(0);
    expect(model.emptyReason).toBe('当前范围还没有产品配置或可识别 ASIN 的广告数据。');
  });

  it('defines product-context action routes', () => {
    expect(productManagementActionRoutes()).toEqual({
      adQuant: 'ad-quant',
      recommendations: 'recommendations',
      keywordOpportunities: 'keyword-opportunities',
      listingOptimization: 'listing-optimization',
      operationEvents: 'operation-events',
    });
  });
});

function pipeline(): BusinessDataPipeline {
  return {
    scope: {
      dateFrom: '2026-06-01',
      dateTo: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B001',
      currency: 'USD',
    },
    generatedAt: '2026-06-12T00:00:00.000Z',
    collection: {} as BusinessDataPipeline['collection'],
    quant: {
      hasImportedMetrics: true,
      importedRows: 10,
      totalSpend: 80,
      totalSales: 160,
      totalOrders: 4,
      totalClicks: 40,
      totalImpressions: 1000,
      acos: 0.5,
      cvr: 0.1,
      cpc: 2,
      wastedSpend: 0,
      highRiskCount: 1,
      blockers: [],
      diagnostics: [{
        asin: 'B001',
        spend: 20,
        sales: 40,
        orders: 1,
        clicks: 10,
        acos: 0.5,
        cvr: 0.1,
        cpc: 2,
        severity: 'high',
        diagnosis: '高 ACOS',
        suggestedDirection: '复核',
      }],
      adObjectTimelines: [],
    },
    operations: {
      events: [
        event({ id: 1, eventDate: '2026-06-10', asin: 'B001', title: 'Coupon started' }),
        event({ id: 2, eventDate: '2026-06-11', asin: undefined, title: 'Prime event' }),
      ],
      eventCount: 2,
      notes: [],
    },
    productContext: {
      products: [{ asin: 'B001', title: 'D6 Smart Lock', sku: 'D6-SKU', productStage: 'keyword_exploration', status: 'active' }],
      productCount: 1,
      notes: [],
    },
    productHistory: {
      ledgers: [{
        asin: 'B001',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        activeDays: 2,
        inferredStage: 'keyword_exploration',
        stageReasons: [],
        daily: [],
        totals: {
          impressions: 1000,
          clicks: 40,
          cost: 80,
          orders: 4,
          sales: 160,
          acos: 0.5,
          cpc: 2,
          cvr: 0.1,
          currency: 'USD',
        },
        events: [],
      }],
      ledgerCount: 1,
      notes: [],
    },
  };
}

function event(patch: any) {
  return {
    id: patch.id,
    eventDate: patch.eventDate,
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: patch.asin,
    campaignName: patch.campaignName,
    adGroupName: patch.adGroupName,
    eventType: 'coupon',
    title: patch.title,
    impactExpectation: 'unknown',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}
```

- [ ] **Step 2: Run the page model test to verify it fails**

Run: `pnpm exec vitest run apps\desktop\src\renderer\pages\product-management-page.test.tsx --reporter=dot`

Expected: FAIL because exported helpers do not exist.

- [ ] **Step 3: Add page model exports and full page UI**

Modify `apps/desktop/src/renderer/pages/product-management-page.tsx` to include these exports and use them in the component:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { ScopeText, useBusinessDataPipeline } from '../components/business-data';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { formatPercent, formatUsd } from '../formatters';
import { useScopeStore } from '../scope-store';
import {
  ProductTimelineItem,
  buildProductManagementSummaries,
  buildProductTimeline,
} from '../product-management';
import type { AppRoute, BusinessDataPipeline, OperationScope } from '../types';

export function productManagementActionRoutes(): Record<string, AppRoute> {
  return {
    adQuant: 'ad-quant',
    recommendations: 'recommendations',
    keywordOpportunities: 'keyword-opportunities',
    listingOptimization: 'listing-optimization',
    operationEvents: 'operation-events',
  };
}

export function productTimelineScopeLabel(scope: ProductTimelineItem['scope']): string {
  if (scope === 'global') return '全局';
  if (scope === 'ad_object') return '广告对象';
  return '产品';
}

export function productTimelineScopeTone(scope: ProductTimelineItem['scope']): 'ready' | 'pending' | 'warning' {
  if (scope === 'global') return 'pending';
  if (scope === 'ad_object') return 'warning';
  return 'ready';
}

export function buildProductManagementPageModel(input: {
  data: BusinessDataPipeline | null | undefined;
  scopeAsin?: string;
}) {
  const products = buildProductManagementSummaries({
    products: input.data?.productContext?.products || [],
    diagnostics: input.data?.quant?.diagnostics || [],
    ledgers: input.data?.productHistory?.ledgers || [],
    events: input.data?.operations?.events || [],
  });
  const selectedProduct = products.find((item) => item.asin === String(input.scopeAsin || '').trim().toUpperCase()) || products[0];
  const timeline = selectedProduct
    ? buildProductTimeline({ selectedAsin: selectedProduct.asin, events: input.data?.operations?.events || [] })
    : [];
  return {
    products,
    selectedProduct,
    timeline,
    emptyReason: products.length ? '' : '当前范围还没有产品配置或可识别 ASIN 的广告数据。',
  };
}

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

function stageLabel(stage?: string): string {
  const labels: Record<string, string> = {
    cold_start: '冷启动',
    keyword_exploration: '测词',
    stable_conversion: '稳定转化',
    scaling: '放量',
    profit_harvesting: '利润收割',
    declining_repair: '异常修复',
    unknown: '阶段待判定',
  };
  return labels[stage || 'unknown'] || stage || '阶段待判定';
}

export function ProductManagementPage() {
  const { data, loading, error, scope } = useBusinessDataPipeline();
  const { setScope } = useScopeStore();
  const [selectedAsin, setSelectedAsin] = useState(scope.asin || '');
  const model = useMemo(() => buildProductManagementPageModel({ data, scopeAsin: selectedAsin || scope.asin }), [data, scope.asin, selectedAsin]);
  const routes = productManagementActionRoutes();

  useEffect(() => {
    if (!selectedAsin && scope.asin) setSelectedAsin(scope.asin);
  }, [scope.asin, selectedAsin]);

  function selectProduct(asin: string) {
    setSelectedAsin(asin);
    setScope({ asin, currency: 'USD' });
  }

  function clearProduct() {
    setSelectedAsin('');
    setScope({ asin: undefined, currency: 'USD' });
  }

  const selected = model.selectedProduct;

  return (
    <div>
      <PageHeader
        eyebrow="运营总览"
        title="产品管理"
        description="先选择产品，再关联广告数据、运营事件、AI 量化、关键词和 Listing。"
        primaryTask="按产品管理运营上下文"
        nextAction={selected ? '查看产品详情' : '补齐产品配置'}
      />

      <div className="business-stack">
        <Panel title="当前产品范围" tone={selected ? 'success' : 'warning'}>
          <div className="business-split">
            <div>
              <div className="business-scope-line"><ScopeText scope={scope} /></div>
              <p className="muted-line">选中产品后会同步当前 ASIN，广告量化、优化建议、运营事件、关键词机会和 Listing 会沿用该产品上下文。</p>
            </div>
            <div className="business-pill-row business-pill-row-right">
              <StatusPill tone={selected ? 'ready' : 'warning'}>{selected ? `${selected.title} / ${selected.asin}` : '全部产品'}</StatusPill>
              {selected && <button className="secondary-button compact-button" onClick={clearProduct} type="button">查看全部产品</button>}
            </div>
          </div>
          {loading && <p className="muted-line">正在读取产品、广告数据和运营事件...</p>}
          {error && <p className="blocked-line">{error}</p>}
        </Panel>

        <Panel title="产品列表" tone={model.products.length ? 'default' : 'warning'}>
          {model.products.length ? (
            <div className="product-management-grid">
              {model.products.map((product) => (
                <button
                  className={`product-management-option ${selected?.asin === product.asin ? 'product-management-option-active' : ''}`}
                  key={product.asin}
                  onClick={() => selectProduct(product.asin)}
                  type="button"
                >
                  <strong>{product.title}</strong>
                  <span>{product.asin} / {product.skuLine}</span>
                  <span>{stageLabel(product.stage)} / {product.status || '状态未配置'} / 事件 {product.eventCount}</span>
                  <span>花费 {formatUsd(product.cost)} / 销售 {formatUsd(product.sales)} / 订单 {product.orders} / ACOS {formatPercent(product.acos * 100)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted-line">{model.emptyReason}</p>
          )}
        </Panel>

        {selected && (
          <>
            <Panel title="产品详情" tone="success">
              <div className="context-summary-grid">
                <div><span>产品</span><strong>{selected.title}</strong><p>{selected.asin} / {selected.skuLine}</p></div>
                <div><span>阶段</span><strong>{stageLabel(selected.stage)}</strong><p>{selected.status || '状态未配置'}</p></div>
                <div><span>广告表现</span><strong>{formatUsd(selected.cost)} / {selected.orders} 单</strong><p>销售 {formatUsd(selected.sales)} / ACOS {formatPercent(selected.acos * 100)}</p></div>
                <div><span>风险</span><strong>{selected.highRiskCount} 个高风险对象</strong><p>诊断 {selected.diagnosticCount} / 事件 {selected.eventCount}</p></div>
              </div>
              <div className="action-row">
                <button className="secondary-button" onClick={() => navigate(routes.operationEvents)} type="button">维护运营事件</button>
                <button className="secondary-button" onClick={() => navigate(routes.keywordOpportunities)} type="button">关键词机会</button>
                <button className="secondary-button" onClick={() => navigate(routes.listingOptimization)} type="button">Listing 优化</button>
                <button className="primary-button" onClick={() => navigate(routes.adQuant)} type="button">进入 AI 量化</button>
              </div>
            </Panel>

            <Panel title="产品运营时间线" tone={model.timeline.length ? 'success' : 'warning'}>
              {model.timeline.length ? (
                <div className="event-timeline">
                  {model.timeline.map((item) => (
                    <article className="event-card product-management-event" key={`${item.event.id}-${item.scope}`}>
                      <div className="event-card-title">
                        <strong>{item.event.eventDate} / {item.event.title}</strong>
                        <StatusPill tone={productTimelineScopeTone(item.scope)}>{productTimelineScopeLabel(item.scope)}</StatusPill>
                      </div>
                      <p>{item.event.eventType} / {item.event.impactExpectation || '影响待观察'}</p>
                      {item.event.notes && <p className="muted-line">{item.event.notes}</p>}
                      {item.event.evidencePath && <p className="mono-line">{item.event.evidencePath}</p>}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted-line">当前产品还没有产品事件或全局事件。记录 Coupon、BD、调价、Listing 或库存变化后，AI 量化会使用这些背景。</p>
              )}
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add focused styles**

Append to `apps/desktop/src/renderer/styles.css` near existing product selector styles:

```css
.product-management-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 10px;
}

.product-management-option {
  display: grid;
  gap: 6px;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: #fff;
  color: var(--text);
  padding: 12px;
  text-align: left;
  cursor: pointer;
}

.product-management-option:hover {
  border-color: #93c5fd;
  background: #f8fbff;
}

.product-management-option-active {
  border-color: var(--primary);
  background: #eff6ff;
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.14);
}

.product-management-option strong,
.product-management-option span {
  overflow-wrap: anywhere;
}

.product-management-option strong {
  font-size: 14px;
  line-height: 1.35;
}

.product-management-option span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.35;
}

.product-management-event {
  min-height: 0;
}
```

- [ ] **Step 5: Run page model and renderer model tests**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\product-management.test.ts apps\desktop\src\renderer\pages\product-management-page.test.tsx --reporter=dot
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```powershell
git add apps\desktop\src\renderer\pages\product-management-page.tsx apps\desktop\src\renderer\pages\product-management-page.test.tsx apps\desktop\src\renderer\styles.css
git commit -m "feat: build product management workspace"
```

## Task 5: ScopeBar Product Label

**Files:**
- Modify: `apps/desktop/src/renderer/components/scope-bar.tsx`
- Test: `apps/desktop/src/renderer/components/scope-bar.test.tsx`

- [ ] **Step 1: Write the failing scope summary test**

Create or update `apps/desktop/src/renderer/components/scope-bar.test.tsx` with:

```tsx
import { describe, expect, it } from 'vitest';
import { buildScopeSummaryFacts } from './scope-bar';

describe('ScopeBar summary facts', () => {
  it('shows product title plus ASIN when product label is available', () => {
    const facts = buildScopeSummaryFacts({
      batchId: 'batch_1',
      batchModeLabel: '手动指定已校验批次',
      reportCoverage: '8/8 类真实报表',
      importedRows: '2416 行',
      asin: 'B001',
      productLabel: 'D6 Smart Lock / B001',
    });

    expect(facts.find((item) => item.label === '产品')?.value).toBe('D6 Smart Lock / B001');
  });

  it('falls back to all products when no ASIN is selected', () => {
    const facts = buildScopeSummaryFacts({
      batchModeLabel: '自动匹配当前范围',
      reportCoverage: '暂无匹配批次',
      importedRows: '0 行',
    });

    expect(facts.find((item) => item.label === '产品')?.value).toBe('全部产品');
  });
});
```

- [ ] **Step 2: Run the scope-bar test to verify it fails**

Run: `pnpm exec vitest run apps\desktop\src\renderer\components\scope-bar.test.tsx --reporter=dot`

Expected: FAIL because `buildScopeSummaryFacts` still uses `ASIN` and has no `productLabel`.

- [ ] **Step 3: Update scope summary facts and product label loading**

Modify the exported type in `apps/desktop/src/renderer/components/scope-bar.tsx`:

```ts
export function buildScopeSummaryFacts(input: {
  batchId?: string;
  batchModeLabel: string;
  reportCoverage: string;
  importedRows: string;
  asin?: string;
  productLabel?: string;
}): ScopeSummaryFact[] {
  return [
    {
      label: '批次',
      value: input.batchId || '自动匹配',
      title: input.batchModeLabel,
    },
    { label: '报表', value: input.reportCoverage },
    { label: '指标', value: input.importedRows },
    { label: '产品', value: input.productLabel || input.asin?.trim() || '全部产品' },
  ];
}
```

Inside `ScopeBar`, add state and product loading:

```ts
  const [products, setProducts] = useState<any[]>([]);
```

Add an effect:

```ts
  useEffect(() => {
    let cancelled = false;
    async function loadProducts() {
      try {
        const rows = await (window as any).electronAPI?.getProducts?.();
        if (!cancelled) setProducts(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setProducts([]);
      }
    }
    loadProducts();
    window.addEventListener('business-ui:data-updated', loadProducts);
    return () => {
      cancelled = true;
      window.removeEventListener('business-ui:data-updated', loadProducts);
    };
  }, []);
```

Before `summaryFacts`, derive:

```ts
  const activeProduct = products.find((product) =>
    String(product.asin || '').trim().toUpperCase() === String(scope.asin || '').trim().toUpperCase()
    && (!product.store_name || product.store_name === scope.storeName)
    && (!product.marketplace_code || product.marketplace_code === scope.marketplaceCode)
  );
  const productLabel = scope.asin
    ? [activeProduct?.title, scope.asin].filter(Boolean).join(' / ') || scope.asin
    : '全部产品';
```

Pass `productLabel` into `buildScopeSummaryFacts`.

- [ ] **Step 4: Run scope and product model tests**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\components\scope-bar.test.tsx apps\desktop\src\renderer\product-management.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```powershell
git add apps\desktop\src\renderer\components\scope-bar.tsx apps\desktop\src\renderer\components\scope-bar.test.tsx
git commit -m "feat: show selected product in scope bar"
```

## Task 6: Operation Events Page Views and Event Scope Creation

**Files:**
- Modify: `apps/desktop/src/renderer/pages/operation-events-page.tsx`
- Test: `apps/desktop/src/renderer/pages/operation-events-page.test.tsx`

- [ ] **Step 1: Write failing event-view tests**

Create `apps/desktop/src/renderer/pages/operation-events-page.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import {
  buildOperationEventDraftForScope,
  filterOperationEventsForView,
  operationEventScopeLabel,
} from './operation-events-page';
import type { OperationEventView, OperationScope } from '../types';

describe('operation events page product/global views', () => {
  const scope: OperationScope = {
    dateFrom: '2026-06-01',
    dateTo: '2026-06-12',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    currency: 'USD',
  };

  it('filters global view to global events only', () => {
    const rows = filterOperationEventsForView([
      event({ id: 1, asin: undefined, title: 'Prime event' }),
      event({ id: 2, asin: 'B001', title: 'Product coupon' }),
    ], 'global', scope.asin);

    expect(rows.map((item) => item.title)).toEqual(['Prime event']);
  });

  it('filters product view to selected product events plus global events', () => {
    const rows = filterOperationEventsForView([
      event({ id: 1, asin: undefined, title: 'Prime event' }),
      event({ id: 2, asin: 'B001', title: 'Product coupon' }),
      event({ id: 3, asin: 'B002', title: 'Other product coupon' }),
    ], 'product', scope.asin);

    expect(rows.map((item) => item.title)).toEqual(['Prime event', 'Product coupon']);
  });

  it('defaults new event drafts to current product scope when ASIN is selected', () => {
    expect(buildOperationEventDraftForScope(scope, 'product')).toMatchObject({
      asin: 'B001',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
    });
    expect(buildOperationEventDraftForScope(scope, 'global')).toMatchObject({
      asin: '',
      campaignName: '',
      adGroupName: '',
    });
  });

  it('labels event scopes for operator UI', () => {
    expect(operationEventScopeLabel(event({ asin: undefined }), 'B001')).toBe('全局');
    expect(operationEventScopeLabel(event({ asin: 'B001' }), 'B001')).toBe('产品');
    expect(operationEventScopeLabel(event({ asin: 'B001', campaignName: 'SP exact' }), 'B001')).toBe('广告对象');
  });
});

function event(patch: Partial<OperationEventView>): OperationEventView {
  return {
    id: patch.id || 1,
    eventDate: '2026-06-01',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: patch.asin,
    campaignName: patch.campaignName,
    adGroupName: patch.adGroupName,
    eventType: 'coupon',
    title: patch.title || 'Event',
    impactExpectation: 'unknown',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}
```

- [ ] **Step 2: Run the event page test to verify it fails**

Run: `pnpm exec vitest run apps\desktop\src\renderer\pages\operation-events-page.test.tsx --reporter=dot`

Expected: FAIL because the exported helpers do not exist.

- [ ] **Step 3: Add event-view helpers**

Modify `apps/desktop/src/renderer/pages/operation-events-page.tsx`:

```tsx
export type OperationEventViewMode = 'product' | 'global' | 'all';

export function filterOperationEventsForView(
  events: OperationEventView[],
  mode: OperationEventViewMode,
  selectedAsin?: string,
): OperationEventView[] {
  const asin = normalizeAsin(selectedAsin);
  return (events || []).filter((event) => {
    const eventAsin = normalizeAsin(event.asin);
    const hasAdObject = Boolean(event.campaignName || event.adGroupName);
    const isGlobal = !eventAsin && !hasAdObject;
    if (mode === 'global') return isGlobal;
    if (mode === 'product') return isGlobal || (asin && eventAsin === asin);
    return true;
  });
}

export function buildOperationEventDraftForScope(
  scope: ReturnType<typeof useScopeStore.getState>['scope'],
  mode: OperationEventViewMode,
) {
  return {
    eventDate: scope.dateTo || scope.dateFrom,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: mode === 'product' ? scope.asin || '' : '',
    campaignName: '',
    adGroupName: '',
    eventType: 'coupon',
    impactExpectation: 'unknown',
    title: '',
    notes: '',
    evidencePath: '',
  };
}

export function operationEventScopeLabel(event: OperationEventView, selectedAsin?: string): string {
  const eventAsin = normalizeAsin(event.asin);
  const hasAdObject = Boolean(event.campaignName || event.adGroupName);
  if (!eventAsin && !hasAdObject) return '全局';
  if (hasAdObject) return '广告对象';
  if (eventAsin && eventAsin === normalizeAsin(selectedAsin)) return '产品';
  return '其他产品';
}

function normalizeAsin(value?: string): string {
  return String(value || '').trim().toUpperCase();
}
```

- [ ] **Step 4: Wire view controls and draft scope into the page**

Inside `OperationEventsPage`:

1. Add state:

```tsx
  const [viewMode, setViewMode] = useState<OperationEventViewMode>(scope.asin ? 'product' : 'global');
```

2. Replace draft initialization and scope effect with `buildOperationEventDraftForScope(scope, viewMode)`.

3. Derive visible events before `eventsByDate`:

```tsx
  const visibleEvents = useMemo(() => filterOperationEventsForView(events, viewMode, scope.asin), [events, scope.asin, viewMode]);
```

4. Build `eventsByDate` from `visibleEvents`.

5. Add a segmented control near the current coverage panel:

```tsx
          <div className="business-pill-row">
            <button className={`secondary-button compact-button ${viewMode === 'product' ? 'button-active' : ''}`} disabled={!scope.asin} onClick={() => { setViewMode('product'); setDraft(buildOperationEventDraftForScope(scope, 'product')); }} type="button">当前产品</button>
            <button className={`secondary-button compact-button ${viewMode === 'global' ? 'button-active' : ''}`} onClick={() => { setViewMode('global'); setDraft(buildOperationEventDraftForScope(scope, 'global')); }} type="button">全局事件</button>
            <button className={`secondary-button compact-button ${viewMode === 'all' ? 'button-active' : ''}`} onClick={() => setViewMode('all')} type="button">全部事件</button>
          </div>
```

6. In event cards, show scope label:

```tsx
<StatusPill tone={operationEventScopeLabel(event, scope.asin) === '全局' ? 'pending' : 'ready'}>
  {operationEventScopeLabel(event, scope.asin)}
</StatusPill>
```

- [ ] **Step 5: Add active button style**

Append to `apps/desktop/src/renderer/styles.css`:

```css
.button-active {
  border-color: var(--primary);
  background: #eff6ff;
  color: var(--primary);
}
```

- [ ] **Step 6: Run operation events tests**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\pages\operation-events-page.test.tsx apps\desktop\src\renderer\product-management.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```powershell
git add apps\desktop\src\renderer\pages\operation-events-page.tsx apps\desktop\src\renderer\pages\operation-events-page.test.tsx apps\desktop\src\renderer\styles.css
git commit -m "feat: split global and product operation timelines"
```

## Task 7: Ad Quant Product Selection Sync

**Files:**
- Modify: `apps/desktop/src/renderer/ad-quant-product-groups.ts`
- Test: `apps/desktop/src/renderer/ad-quant-product-groups.test.ts`
- Modify: `apps/desktop/src/renderer/pages/ad-quant-page.tsx`

- [ ] **Step 1: Write a failing product scope patch test**

Modify `apps/desktop/src/renderer/ad-quant-product-groups.test.ts`:

```ts
import { productGroupScopePatch } from './ad-quant-product-groups';

  it('creates a scope patch when selecting a product group', () => {
    expect(productGroupScopePatch('B001')).toEqual({ asin: 'B001', currency: 'USD' });
    expect(productGroupScopePatch(UNBOUND_PRODUCT_KEY)).toEqual({ asin: undefined, currency: 'USD' });
    expect(productGroupScopePatch('')).toEqual({ asin: undefined, currency: 'USD' });
  });
```

- [ ] **Step 2: Run the product group test to verify it fails**

Run: `pnpm exec vitest run apps\desktop\src\renderer\ad-quant-product-groups.test.ts --reporter=dot`

Expected: FAIL because `productGroupScopePatch` is missing.

- [ ] **Step 3: Implement product group scope patch helper**

Modify `apps/desktop/src/renderer/ad-quant-product-groups.ts`:

```ts
export function productGroupScopePatch(productKey: string): { asin?: string; currency: 'USD' } {
  if (!productKey || productKey === UNBOUND_PRODUCT_KEY) return { asin: undefined, currency: 'USD' };
  return { asin: productKey, currency: 'USD' };
}
```

- [ ] **Step 4: Wire AdQuantPage product clicks to global scope**

Modify imports in `apps/desktop/src/renderer/pages/ad-quant-page.tsx`:

```ts
import { buildAdQuantProductGroups, filterAdQuantByProduct, productGroupScopePatch } from '../ad-quant-product-groups';
import { useScopeStore } from '../scope-store';
```

Inside `AdQuantPage`, add:

```ts
  const setScope = useScopeStore((state) => state.setScope);
```

Replace the product option `onClick` handler:

```tsx
onClick={() => {
  setSelectedProductKey(group.productKey);
  setScope(productGroupScopePatch(group.productKey));
}}
```

Add an action button inside the `按产品查看` panel:

```tsx
<button
  className="secondary-button compact-button"
  onClick={() => {
    setSelectedProductKey('');
    setScope(productGroupScopePatch(''));
  }}
  type="button"
>
  查看全部产品
</button>
```

- [ ] **Step 5: Run ad quant focused tests**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\ad-quant-product-groups.test.ts apps\desktop\src\renderer\pages\ad-quant-page.test.tsx --reporter=dot
```

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```powershell
git add apps\desktop\src\renderer\ad-quant-product-groups.ts apps\desktop\src\renderer\ad-quant-product-groups.test.ts apps\desktop\src\renderer\pages\ad-quant-page.tsx
git commit -m "feat: sync ad quant product selection"
```

## Task 8: Smoke Scripts and Docs

**Files:**
- Modify: `scripts/smoke-business-ui-shell.js`
- Modify: `scripts/smoke-business-ui-data-pipeline.js`
- Modify: `README.md`
- Modify: `docs/USER_GUIDE_v1_5.md`
- Modify: `docs/V1_5_ACCEPTANCE_MATRIX.md`
- Modify: `docs/V1_5_PROGRESS_REPORT.md`
- Modify: `docs/V1_5_ORCHESTRATOR_CLOSEOUT.md`

- [ ] **Step 1: Update shell smoke navigation assertions**

Modify `scripts/smoke-business-ui-shell.js` where navigation page checks are defined. Add product management near dashboard:

```js
{ nav: /产品管理/, heading: /产品管理/, label: '产品管理', key: 'product-management' },
```

Remove any assertion that expects `产品 ACOS 配置` as a navigation item.

- [ ] **Step 2: Update data pipeline smoke product workflow**

Modify `scripts/smoke-business-ui-data-pipeline.js` to include a product management page visit:

```js
{ nav: /产品管理/, heading: /产品管理/, label: '产品管理', key: 'product-management' },
```

After opening product management, assert page text includes:

```js
await expect(page.getByText(/先选择产品，再关联广告数据、运营事件、AI 量化/)).toBeVisible();
await expect(page.getByText(/当前产品范围|产品列表/)).toBeVisible();
```

Capture screenshot:

```js
const productManagementScreenshotPath = path.join(evidenceDir, `business-ui-data-pipeline-product-management-${runId}.png`);
await page.screenshot({ path: productManagementScreenshotPath, fullPage: true });
evidence.screenshots.push(productManagementScreenshotPath);
```

- [ ] **Step 3: Update user-facing docs**

Update docs with these exact content changes:

- `README.md`: add `产品管理` to current workflow summary and mention product-centered event timelines.
- `docs/USER_GUIDE_v1_5.md`: add a short section `产品管理` explaining product selection, `scope.asin`, product/global events, and AI quantification entry.
- `docs/V1_5_ACCEPTANCE_MATRIX.md`: add or update product readiness row to include product management navigation, product timeline, and scope ASIN propagation.
- `docs/V1_5_PROGRESS_REPORT.md`: add a latest increment bullet summarizing implementation and verification commands.
- `docs/V1_5_ORCHESTRATOR_CLOSEOUT.md`: mention that product-centered context is now the intended operator entry for ASIN-specific analysis.

- [ ] **Step 4: Run smoke script syntax and focused shell tests**

Run:

```powershell
node --check scripts\smoke-business-ui-shell.js
node --check scripts\smoke-business-ui-data-pipeline.js
pnpm exec vitest run apps\desktop\src\renderer\components\app-shell.test.tsx --reporter=dot
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit Task 8**

```powershell
git add scripts\smoke-business-ui-shell.js scripts\smoke-business-ui-data-pipeline.js README.md docs\USER_GUIDE_v1_5.md docs\V1_5_ACCEPTANCE_MATRIX.md docs\V1_5_PROGRESS_REPORT.md docs\V1_5_ORCHESTRATOR_CLOSEOUT.md
git commit -m "docs: document product management workflow"
```

## Task 9: Final Verification and Package Refresh

**Files:**
- No planned source edits. This task runs verification and records new delivery evidence.

- [ ] **Step 1: Run focused unit and renderer tests**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\product-management.test.ts apps\desktop\src\renderer\pages\product-management-page.test.tsx apps\desktop\src\renderer\pages\operation-events-page.test.tsx apps\desktop\src\renderer\ad-quant-product-groups.test.ts apps\desktop\src\renderer\components\scope-bar.test.tsx apps\desktop\src\renderer\components\app-shell.test.tsx apps\desktop\src\main\operation-event-scope.test.ts apps\desktop\src\main\ad-product-history-ledger.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 2: Run desktop typecheck and renderer build**

Run:

```powershell
pnpm --filter @amazon-ai-ops/desktop run typecheck
pnpm --filter @amazon-ai-ops/desktop run build:renderer
```

Expected: both commands exit 0.

- [ ] **Step 3: Run product-relevant business UI smoke**

Run:

```powershell
pnpm run smoke:business-ui-current
```

Expected: PASS and new `output\codex-evidence\current-business-ui-smoke-*.json` evidence.

- [ ] **Step 4: Rebuild Windows packages**

Run:

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:win
```

Expected: installer and portable EXE exist under `apps\desktop\release`.

- [ ] **Step 5: Run package launch smoke**

Run:

```powershell
pnpm run smoke:package-launch
```

Expected: PASS and new `output\codex-evidence\package-launch-smoke-*.json` evidence.

- [ ] **Step 6: Refresh final readiness and READY bundle**

Run this PowerShell block from the repo root. It creates a fresh timestamp and uses the latest package launch smoke JSON produced by Step 5:

```powershell
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$packageSmoke = Get-ChildItem output\codex-evidence\package-launch-smoke-*.json |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $packageSmoke) { throw 'No package launch smoke evidence found.' }
$manifest = "output\codex-evidence\v15-final-readiness-evidence-manifest-$stamp.json"
$finalReadiness = "output\codex-evidence\final-readiness-$stamp.json"
$bundle = "output\delivery-bundles\v15-delivery-bundle-$stamp-ready"
pnpm run write:v15-evidence-manifest -- --ad-readback output\codex-evidence\real-ad-execution-readback-candidate-rec-4-current-pass.json --out $manifest
pnpm run verify:v15-final-readiness -- --evidence-manifest $manifest --package-launch-smoke $packageSmoke.FullName --out $finalReadiness
pnpm run export:v15-delivery-bundle -- --final-readiness $finalReadiness --data-reconciliation output\codex-evidence\real-lingxing-reconciliation-batch_20260612020905629_gkchz1.json --data-reconciliation-md output\codex-evidence\real-lingxing-reconciliation-batch_20260612020905629_gkchz1.md --out $bundle
pnpm run verify:v15-ready-safety -- --final-readiness $finalReadiness --bundle-manifest "$bundle\delivery-bundle-manifest.json"
```

Expected: final readiness is `APP_READY`; READY safety passes.

- [ ] **Step 7: Update package hash docs if hashes changed**

If Step 4 produced new installer or portable hashes, update:

- `README.md`
- `AGENTS.md`
- `docs/USER_GUIDE_v1_5.md`
- `docs/V1_5_ACCEPTANCE_MATRIX.md`
- `docs/V1_5_PROGRESS_REPORT.md`
- `docs/V1_5_ORCHESTRATOR_CLOSEOUT.md`

Use the exact final-readiness, package-launch smoke, READY bundle, installer hash, and portable hash generated in this task.

- [ ] **Step 8: Run final worktree checks**

Run:

```powershell
git diff --check
git status --short --branch
```

Expected: no whitespace errors. Confirm only intended source, test, script, and docs changes are staged or committed; release EXE binaries, `output/`, `storage/`, AppData, and raw reports stay uncommitted.

- [ ] **Step 9: Commit final docs/evidence path updates**

If Step 7 changed docs:

```powershell
git add AGENTS.md README.md docs\USER_GUIDE_v1_5.md docs\V1_5_ACCEPTANCE_MATRIX.md docs\V1_5_PROGRESS_REPORT.md docs\V1_5_ORCHESTRATOR_CLOSEOUT.md
git commit -m "docs: refresh product management ready evidence"
```

## Self-Review

Spec coverage:

- Product-centered entry and navigation: Task 3.
- Product title plus ASIN identity: Tasks 1, 4, and 5.
- Product event timeline with global events inserted: Tasks 1, 2, 4, and 6.
- Global event view only shows global events: Task 6.
- Product selection updates `scope.asin`: Tasks 4, 5, and 7.
- Ad quant, recommendations, keyword, and Listing follow current product: Tasks 4 and 7 rely on existing route consumers of `scope.asin`.
- Fail-closed ad execution boundary: Task 9 verification and docs preserve the current boundary; no task adds ad writes.
- Windows package refresh when UI changes: Task 9.

Concrete instruction scan:

- The implementation tasks contain concrete paths, commands, and code snippets.
- The final readiness refresh uses PowerShell variables for generated timestamps and latest package smoke discovery, so the commands are directly runnable after Step 5.

Type consistency:

- `AppRoute` uses `product-management`.
- Product timeline scopes use `global`, `product`, `ad_object`, and `other_product`.
- Renderer product summaries use existing `ProductStrategyContextView`, `BusinessQuantDiagnostic`, `ProductHistoryLedgerView`, and `OperationEventView`.
- Main event helper uses shared `OperationEvent`.
