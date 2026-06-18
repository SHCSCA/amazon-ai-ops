# Amazon AI Ops Product UI, AI Stability, and Listing Manual Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the current operator-facing blockers by stabilizing AI structured output, reducing UI density, making ad quantification product-scoped, and replacing fragile Lingxing Listing extraction with a manual Listing version workflow.

**Architecture:** Keep the existing Electron + React + SQLite architecture. Add small typed helpers for product grouping and Listing manual persistence instead of adding another monolithic page. Use progressive disclosure in the renderer: each page should show conclusion, current task, and next action first; evidence, history, raw diagnostics, and long tables stay in expandable sections.

**Tech Stack:** Electron main/preload/renderer, React, TypeScript, SQLite via `packages/local-db`, Vitest, existing Playwright/smoke scripts, DeepSeek/OpenAI-compatible AI adapter.

---

## Current State To Preserve

- The working tree already contains partial AI JSON repair and UI density work:
  - `packages/ai-adapter/src/ad-strategy-diagnosis.ts`
  - `packages/ai-adapter/src/ad-strategy-diagnosis.test.ts`
  - `apps/desktop/src/renderer/ai-call-diagnostics.ts`
  - `apps/desktop/src/renderer/ai-call-diagnostics.test.ts`
  - `apps/desktop/src/renderer/App.tsx`
  - `apps/desktop/src/renderer/components/scope-bar.tsx`
  - `apps/desktop/src/renderer/pages/ad-quant-page.tsx`
  - `apps/desktop/src/renderer/pages/dashboard-page.tsx`
  - `apps/desktop/src/renderer/styles.css`
- Do not revert these edits. Continue from them.
- Run only incremental tests while implementing. Full typecheck, full test, and Windows build happen at the final delivery gate only.
- Keep all money display as USD or `$`. Do not show `¥`, RMB, or 人民币.

## Delivery Gates

The work is accepted only when all of these are true:

1. AI JSON parser errors no longer appear raw in the UI.
2. If AI output is malformed, the adapter performs one repair attempt, then falls back with a Chinese operator-facing reason.
3. 广告量化 page defaults to one product/ASIN view, with an explicit product selector.
4. Long evidence and diagnostic sections are collapsed by default.
5. Listing page supports manual input for title, five bullets, description/A+ content, image copy, and backend search terms.
6. Every Listing save records a version snapshot that can be reviewed later.
7. Lingxing Listing extraction is no longer the required primary path. It becomes optional auxiliary import.
8. Existing evidence-chain rules remain: AI insight without valid evidence cannot enter approval or execution.
9. Incremental tests pass for touched modules.
10. Final gate runs full typecheck, full tests, smoke scripts, and Windows build.

## File Structure

### AI structured output and diagnostics

- Modify `packages/ai-adapter/src/ad-strategy-diagnosis.ts`
  - Owns prompt, JSON extraction, JSON repair, Chinese fallback.
- Modify `packages/ai-adapter/src/ad-strategy-diagnosis.test.ts`
  - Covers malformed JSON repair and fallback.
- Modify `apps/desktop/src/renderer/ai-call-diagnostics.ts`
  - Converts raw AI/JSON errors into operator-facing messages.
- Modify `apps/desktop/src/renderer/ai-call-diagnostics.test.ts`
  - Ensures parser positions/line numbers do not leak into UI.
- Modify `apps/desktop/src/renderer/pages/ad-quant-page.tsx`
  - Uses sanitized AI diagnostic messages.
- Modify `apps/desktop/src/renderer/pages/dashboard-page.tsx`
  - Uses sanitized AI diagnostic messages.

### UI shell and page density

- Modify `apps/desktop/src/renderer/App.tsx`
  - Remove repeated global status blocks from every page.
  - Keep page routing and navigation only.
- Modify `apps/desktop/src/renderer/components/scope-bar.tsx`
  - Make current scope concise by default.
  - Move batch explanation into a collapsed details section.
- Modify `apps/desktop/src/renderer/components/scope-bar.test.ts`
  - Assert concise scope and collapsed explanation behavior.
- Modify `apps/desktop/src/renderer/styles.css`
  - Reduce base font size, page padding, card padding, header height, sidebar width.
  - Add compact product selector and collapsible evidence styles.

### Ad quantification product grouping

- Create `apps/desktop/src/renderer/ad-quant-product-groups.ts`
  - Builds product/ASIN groups from diagnostics, timelines, and product ledgers.
  - Selects default product deterministically.
  - Filters diagnostics/timelines/ledgers by selected product.
- Create `apps/desktop/src/renderer/ad-quant-product-groups.test.ts`
  - Unit coverage for ASIN grouping, unbound rows, default selection, and filtering.
- Modify `apps/desktop/src/renderer/pages/ad-quant-page.tsx`
  - Use product groups and selected product state.
  - Show only selected product details by default.
  - Collapse long evidence/history sections.
- Modify `apps/desktop/src/renderer/pages/ad-quant-page.test.tsx`
  - Assert product selector renders and diagnostics are filtered.

### Listing manual source and version history

- Modify `packages/shared-types/src/v1_5.ts`
  - Extend `ListingContent` with `source`, `description`, `sourceUrl`, `screenshotPath`, `versionLabel`, `changeSummary`.
  - Add `ListingContentVersion`.
- Modify `apps/desktop/src/renderer/types.ts`
  - Mirror Listing renderer view types.
- Modify `packages/local-db/src/sqlite/db.ts`
  - Add `listing_content.source`, `listing_content.description`, `listing_content.version_label`, `listing_content.change_summary`, `listing_content.created_at`.
  - Create `listing_content_versions`.
- Create `packages/local-db/src/sqlite/listing-content-version.test.ts`
  - Verifies schema migration and history inserts.
- Create `apps/desktop/src/main/listing-manual-content.ts`
  - Validates manual Listing input.
  - Normalizes bullets and backend terms.
  - Builds latest row payload and history snapshot.
- Create `apps/desktop/src/main/listing-manual-content.test.ts`
  - Covers validation, version payload, and change summary normalization.
- Modify `apps/desktop/src/main/index.ts`
  - Add IPC handlers for manual save and version listing.
  - Persist latest Listing content and append history version in one transaction.
- Modify `apps/desktop/src/preload/index.ts`
  - Expose manual Listing save and version list APIs.
- Modify `apps/desktop/src/renderer/pages/listing-optimization-page.tsx`
  - Add manual editor as the primary path.
  - Make Lingxing read secondary.
  - Show latest saved version and version history.
- Modify `apps/desktop/src/renderer/pages/listing-optimization-page.test.ts`
  - Assert manual save makes Listing ready and Lingxing read is not required.
- Modify `apps/desktop/src/renderer/listing-workflow-summary.ts`
  - Treat manual Listing source as valid input for suggestion/draft generation.
- Modify `apps/desktop/src/renderer/listing-workflow-summary.test.ts`
  - Assert manual Listing readiness.

### Page information architecture

- Modify `apps/desktop/src/renderer/pages/dashboard-page.tsx`
  - Dashboard should summarize current scope, data health, AI health, and next action in one viewport.
- Modify `apps/desktop/src/renderer/pages/recommendations-page.tsx`
  - Default to grouped recommendation cards/table by product/campaign.
  - Evidence remains in expandable details.
- Modify `apps/desktop/src/renderer/pages/approval-page.tsx`
  - Keep approval actions visible; collapse evidence and policy details.
- Modify `apps/desktop/src/renderer/pages/listing-optimization-page.tsx`
  - Use cards for source, editor, keyword coverage, AI draft, and history.
- Modify existing smoke scripts only if selectors changed:
  - `scripts/smoke-business-ui-ad-execution.js`
  - `scripts/smoke-business-ui-data-pipeline.js`
  - `scripts/smoke-business-ui-settings-delivery.js`

## Task 1: Stabilize AI JSON Output And Error Messaging

**Files:**
- Modify `packages/ai-adapter/src/ad-strategy-diagnosis.test.ts`
- Modify `packages/ai-adapter/src/ad-strategy-diagnosis.ts`
- Modify `apps/desktop/src/renderer/ai-call-diagnostics.test.ts`
- Modify `apps/desktop/src/renderer/ai-call-diagnostics.ts`
- Modify `apps/desktop/src/renderer/pages/ad-quant-page.tsx`
- Modify `apps/desktop/src/renderer/pages/dashboard-page.tsx`

- [ ] **Step 1: Add a failing AI adapter test for malformed JSON repair**

Add this test case to `packages/ai-adapter/src/ad-strategy-diagnosis.test.ts`:

```ts
it('repairs malformed JSON once before falling back', async () => {
  const provider = new FakeProvider([
    '{"schemaVersion":"ad_strategy_diagnosis_v1","lifecycleStage":"testing","summary":"bad",',
    JSON.stringify({
      schemaVersion: 'ad_strategy_diagnosis_v1',
      lifecycleStage: 'keyword_exploration',
      lifecycleStageReason: '引用真实指标证据判断为测词期。',
      lifecycleStageEvidenceRefs: ['metric:batch:keyword:2026-06-11:search_term:abc'],
      summary: '已修复为合法 JSON。',
      mainProblems: ['样本仍少'],
      thresholdSuggestions: {
        targetAcos: { value: 0.35, reason: '按产品目标 ACOS。', evidenceRefs: ['product:FT-US-US:US:B001'] },
        highAcosThreshold: { value: 0.5, reason: '高于目标留出波动。', evidenceRefs: ['metric:batch:keyword:2026-06-11:search_term:abc'] },
        noOrderClickThreshold: { value: 30, reason: '测词期点击门槛。', evidenceRefs: ['metric:batch:keyword:2026-06-11:search_term:abc'] },
        minSpend: { value: 10, reason: '最低样本花费。', evidenceRefs: ['metric:batch:keyword:2026-06-11:search_term:abc'] },
      },
      aiCandidates: [],
      insightOnlyCandidates: [],
      riskWarnings: [],
      source: 'ai',
    }),
  ]);

  const diagnosis = await diagnoseAdStrategy({
    provider,
    input: minimalDiagnosisInput(),
    ruleFallback: minimalRuleFallback(),
  });

  expect(provider.chatCount).toBe(2);
  expect(provider.optionsHistory[1]?.responseFormat).toBe('json_object');
  expect(diagnosis.summary).toBe('已修复为合法 JSON。');
  expect(diagnosis.aiFallbackReason).toBeUndefined();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
pnpm exec vitest run packages/ai-adapter/src/ad-strategy-diagnosis.test.ts
```

Expected before implementation: FAIL because malformed JSON is not repaired.

- [ ] **Step 3: Implement one repair attempt in the AI adapter**

In `packages/ai-adapter/src/ad-strategy-diagnosis.ts`, add:

```ts
const AI_JSON_FORMAT_FALLBACK_REASON = 'AI 输出格式未通过校验，当前使用规则引擎兜底。';

async function parseOrRepairJson(input: {
  rawText: string;
  provider: AiChatProvider;
  promptKey: string;
  requiredOutputSkeleton: unknown;
}): Promise<unknown> {
  try {
    return parseJsonObject(input.rawText);
  } catch (error) {
    if (!isJsonParseFailure(error)) throw error;
  }

  const repaired = await input.provider.chat([
    {
      role: 'system',
      content: '你是 JSON 修复器。只返回一个合法 JSON 对象，不要解释，不要 Markdown。',
    },
    {
      role: 'user',
      content: JSON.stringify({
        instruction: '修复下面的 JSON，使其符合 requiredOutputSkeleton。所有自然语言字段使用简体中文。',
        requiredOutputSkeleton: input.requiredOutputSkeleton,
        brokenJson: input.rawText,
      }),
    },
  ], {
    temperature: 0,
    responseFormat: 'json_object',
    promptKey: `${input.promptKey}:repair`,
  });

  return parseJsonObject(repaired.content);
}
```

Wire `diagnoseAdStrategy()` so it calls `parseOrRepairJson()` before schema normalization. On repair failure, return the existing rule fallback with:

```ts
aiFallbackReason: AI_JSON_FORMAT_FALLBACK_REASON
```

- [ ] **Step 4: Add renderer diagnostic sanitization test**

Add to `apps/desktop/src/renderer/ai-call-diagnostics.test.ts`:

```ts
it('hides raw JSON parser location from operator-facing AI error text', () => {
  const latest = latestAiCallDiagnostics([
    {
      model: 'deepseek-v4-flash',
      success: false,
      createdAt: '2026-06-18T00:55:28.000Z',
      errorMessage: "Expected ',' or ']' after array element in JSON at position 5052 (line 161 column 6)",
    },
  ]);

  expect(latest.detail).toContain('AI 输出格式未通过校验');
  expect(latest.detail).not.toContain('position 5052');
  expect(latest.detail).not.toContain('line 161');
});
```

- [ ] **Step 5: Implement operator-facing AI error sanitizer**

In `apps/desktop/src/renderer/ai-call-diagnostics.ts`, export:

```ts
export function operatorFacingAiError(message?: string | null): string {
  const text = String(message || '').trim();
  if (!text) return 'AI 调用失败，当前使用规则引擎兜底。';
  if (/JSON at position|line \d+ column \d+|Expected .+ after array element/i.test(text)) {
    return 'AI 输出格式未通过校验，当前使用规则引擎兜底。';
  }
  return text;
}
```

Use this helper in `ad-quant-page.tsx` and `dashboard-page.tsx` wherever failed AI call messages are rendered.

- [ ] **Step 6: Run incremental AI tests**

Run:

```powershell
pnpm exec vitest run packages/ai-adapter/src/ad-strategy-diagnosis.test.ts apps/desktop/src/renderer/ai-call-diagnostics.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit this task**

```powershell
git add packages/ai-adapter/src/ad-strategy-diagnosis.ts packages/ai-adapter/src/ad-strategy-diagnosis.test.ts apps/desktop/src/renderer/ai-call-diagnostics.ts apps/desktop/src/renderer/ai-call-diagnostics.test.ts apps/desktop/src/renderer/pages/ad-quant-page.tsx apps/desktop/src/renderer/pages/dashboard-page.tsx
git commit -m "fix: stabilize ai diagnosis json handling"
```

## Task 2: Reduce Global UI Density And Scope-Bar Noise

**Files:**
- Modify `apps/desktop/src/renderer/App.tsx`
- Modify `apps/desktop/src/renderer/components/scope-bar.tsx`
- Modify `apps/desktop/src/renderer/components/scope-bar.test.ts`
- Modify `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Add a scope-bar test for collapsed explanation**

Add to `apps/desktop/src/renderer/components/scope-bar.test.ts`:

```tsx
it('keeps scope explanation collapsed by default', () => {
  render(<ScopeBar />);

  expect(screen.getByText('范围说明与批次作用')).toBeInTheDocument();
  expect(screen.queryByText('数据采集、导入校验、广告量化、优化建议、审批回读、关键词机会和 Listing 草案都会按这里读取。')).not.toBeVisible();
});
```

- [ ] **Step 2: Run the scope-bar test and verify it fails**

Run:

```powershell
pnpm exec vitest run apps/desktop/src/renderer/components/scope-bar.test.ts
```

Expected before implementation: FAIL because the long explanation is always visible.

- [ ] **Step 3: Collapse batch/scope explanation in `ScopeBar`**

In `apps/desktop/src/renderer/components/scope-bar.tsx`, render long help text as:

```tsx
<details className="scope-details">
  <summary>范围说明与批次作用</summary>
  <p>数据采集、导入校验、广告量化、优化建议、审批回读、关键词机会和 Listing 草案都会按这里读取。</p>
  <p>当前数据批次只决定读取哪批真实报表和入库指标，不会自动重新下载。</p>
</details>
```

- [ ] **Step 4: Remove repeated global status chip from `App`**

In `apps/desktop/src/renderer/App.tsx`, remove global status chips that appear before every page. Keep status only in the topbar or page-specific summary.

- [ ] **Step 5: Apply compact CSS tokens**

In `apps/desktop/src/renderer/styles.css`, set compact defaults:

```css
body {
  font-size: 14px;
}

.topbar {
  min-height: 54px;
  padding: 0 22px;
}

.app-sidebar {
  width: 226px;
}

.app-content {
  padding: 18px 24px 28px;
}

.page-header h2 {
  font-size: 26px;
}

.panel,
.scope-bar,
.workflow-step {
  border-radius: 8px;
}

.panel {
  padding: 18px;
}

.primary-button,
.secondary-button {
  min-height: 34px;
  padding: 0 14px;
}
```

- [ ] **Step 6: Run incremental renderer tests**

Run:

```powershell
pnpm exec vitest run apps/desktop/src/renderer/components/scope-bar.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit this task**

```powershell
git add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/components/scope-bar.tsx apps/desktop/src/renderer/components/scope-bar.test.ts apps/desktop/src/renderer/styles.css
git commit -m "style: reduce app shell density"
```

## Task 3: Make Ad Quantification Product-Scoped

**Files:**
- Create `apps/desktop/src/renderer/ad-quant-product-groups.ts`
- Create `apps/desktop/src/renderer/ad-quant-product-groups.test.ts`
- Modify `apps/desktop/src/renderer/pages/ad-quant-page.tsx`
- Modify `apps/desktop/src/renderer/pages/ad-quant-page.test.tsx`
- Modify `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Add product grouping tests**

Create `apps/desktop/src/renderer/ad-quant-product-groups.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildAdQuantProductGroups, filterAdQuantByProduct, UNBOUND_PRODUCT_KEY } from './ad-quant-product-groups';

describe('ad quant product groups', () => {
  it('groups diagnostics by ASIN and selects scoped ASIN first', () => {
    const result = buildAdQuantProductGroups({
      scopeAsin: 'B002',
      diagnostics: [
        { asin: 'B001', cost: 10, sales: 20, orders: 1, clicks: 5, riskLevel: 'medium' },
        { asin: 'B002', cost: 40, sales: 80, orders: 2, clicks: 10, riskLevel: 'high' },
      ] as any[],
      timelines: [],
      ledgers: [],
    });

    expect(result.selectedProductKey).toBe('B002');
    expect(result.groups.map((item) => item.productKey)).toEqual(['B002', 'B001']);
    expect(result.groups[0]).toMatchObject({ asin: 'B002', cost: 40, orders: 2, highRiskCount: 1 });
  });

  it('selects highest-spend product when scope ASIN is empty', () => {
    const result = buildAdQuantProductGroups({
      diagnostics: [
        { asin: 'B001', cost: 10, sales: 0, orders: 0, clicks: 4, riskLevel: 'low' },
        { asin: 'B003', cost: 99, sales: 120, orders: 3, clicks: 20, riskLevel: 'medium' },
      ] as any[],
      timelines: [],
      ledgers: [],
    });

    expect(result.selectedProductKey).toBe('B003');
  });

  it('keeps rows without ASIN in an explicit unbound group', () => {
    const result = buildAdQuantProductGroups({
      diagnostics: [{ cost: 7, sales: 0, orders: 0, clicks: 3, riskLevel: 'high' }] as any[],
      timelines: [],
      ledgers: [],
    });

    expect(result.selectedProductKey).toBe(UNBOUND_PRODUCT_KEY);
    expect(result.groups[0].label).toBe('未绑定 ASIN');
  });

  it('filters diagnostics, timelines, and ledgers by selected product', () => {
    const filtered = filterAdQuantByProduct({
      productKey: 'B001',
      diagnostics: [{ asin: 'B001' }, { asin: 'B002' }] as any[],
      timelines: [{ asin: 'B001' }, { asin: 'B002' }] as any[],
      ledgers: [{ asin: 'B001' }, { asin: 'B002' }] as any[],
    });

    expect(filtered.diagnostics).toHaveLength(1);
    expect(filtered.timelines).toHaveLength(1);
    expect(filtered.ledgers).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run product grouping tests and verify they fail**

Run:

```powershell
pnpm exec vitest run apps/desktop/src/renderer/ad-quant-product-groups.test.ts
```

Expected before implementation: FAIL because the helper file does not exist.

- [ ] **Step 3: Implement product grouping helper**

Create `apps/desktop/src/renderer/ad-quant-product-groups.ts`:

```ts
export const UNBOUND_PRODUCT_KEY = '__unbound_product__';

type MetricLike = {
  asin?: string;
  cost?: number;
  sales?: number;
  orders?: number;
  clicks?: number;
  riskLevel?: string;
};

type TimelineLike = {
  asin?: string;
  cost?: number;
  sales?: number;
  orders?: number;
  clicks?: number;
};

type LedgerLike = {
  asin?: string;
  totalCost?: number;
  totalSales?: number;
  totalOrders?: number;
  totalClicks?: number;
  inferredStage?: string;
};

export interface AdQuantProductGroup {
  productKey: string;
  asin?: string;
  label: string;
  cost: number;
  sales: number;
  orders: number;
  clicks: number;
  acos: number;
  diagnosticCount: number;
  timelineCount: number;
  ledgerCount: number;
  highRiskCount: number;
  stage?: string;
}

export function buildAdQuantProductGroups(input: {
  scopeAsin?: string;
  diagnostics: MetricLike[];
  timelines: TimelineLike[];
  ledgers: LedgerLike[];
}): { groups: AdQuantProductGroup[]; selectedProductKey: string } {
  const groups = new Map<string, AdQuantProductGroup>();

  const ensureGroup = (asin?: string): AdQuantProductGroup => {
    const normalized = normalizeAsin(asin);
    const productKey = normalized || UNBOUND_PRODUCT_KEY;
    const existing = groups.get(productKey);
    if (existing) return existing;
    const created: AdQuantProductGroup = {
      productKey,
      asin: normalized || undefined,
      label: normalized || '未绑定 ASIN',
      cost: 0,
      sales: 0,
      orders: 0,
      clicks: 0,
      acos: 0,
      diagnosticCount: 0,
      timelineCount: 0,
      ledgerCount: 0,
      highRiskCount: 0,
    };
    groups.set(productKey, created);
    return created;
  };

  for (const row of input.diagnostics || []) {
    const group = ensureGroup(row.asin);
    group.cost += numberValue(row.cost);
    group.sales += numberValue(row.sales);
    group.orders += numberValue(row.orders);
    group.clicks += numberValue(row.clicks);
    group.diagnosticCount += 1;
    if (String(row.riskLevel || '').toLowerCase() === 'high') group.highRiskCount += 1;
  }

  for (const row of input.timelines || []) {
    const group = ensureGroup(row.asin);
    group.timelineCount += 1;
  }

  for (const row of input.ledgers || []) {
    const group = ensureGroup(row.asin);
    group.ledgerCount += 1;
    group.stage = group.stage || row.inferredStage;
    group.cost = Math.max(group.cost, numberValue(row.totalCost));
    group.sales = Math.max(group.sales, numberValue(row.totalSales));
    group.orders = Math.max(group.orders, numberValue(row.totalOrders));
    group.clicks = Math.max(group.clicks, numberValue(row.totalClicks));
  }

  const sorted = [...groups.values()].map((group) => ({
    ...group,
    acos: group.sales > 0 ? group.cost / group.sales : 0,
  })).sort((left, right) => {
    const scopeAsin = normalizeAsin(input.scopeAsin);
    if (scopeAsin && left.productKey === scopeAsin) return -1;
    if (scopeAsin && right.productKey === scopeAsin) return 1;
    return right.cost - left.cost || right.highRiskCount - left.highRiskCount || left.label.localeCompare(right.label);
  });

  return {
    groups: sorted,
    selectedProductKey: sorted[0]?.productKey || '',
  };
}

export function filterAdQuantByProduct<TDiagnostic extends { asin?: string }, TTimeline extends { asin?: string }, TLedger extends { asin?: string }>(input: {
  productKey: string;
  diagnostics: TDiagnostic[];
  timelines: TTimeline[];
  ledgers: TLedger[];
}): { diagnostics: TDiagnostic[]; timelines: TTimeline[]; ledgers: TLedger[] } {
  return {
    diagnostics: input.diagnostics.filter((item) => productMatches(item.asin, input.productKey)),
    timelines: input.timelines.filter((item) => productMatches(item.asin, input.productKey)),
    ledgers: input.ledgers.filter((item) => productMatches(item.asin, input.productKey)),
  };
}

function productMatches(asin: string | undefined, productKey: string): boolean {
  if (productKey === UNBOUND_PRODUCT_KEY) return !normalizeAsin(asin);
  return normalizeAsin(asin) === productKey;
}

function normalizeAsin(value?: string): string {
  return String(value || '').trim().toUpperCase();
}

function numberValue(value?: number): number {
  return Number.isFinite(value) ? Number(value) : 0;
}
```

- [ ] **Step 4: Use product grouping in `AdQuantPage`**

In `apps/desktop/src/renderer/pages/ad-quant-page.tsx`, import:

```ts
import { buildAdQuantProductGroups, filterAdQuantByProduct } from '../ad-quant-product-groups';
```

Replace direct `visibleDiagnostics`, `visibleTimelines`, and `productHistoryLedgers` usage with:

```ts
const allDiagnostics = canDiagnose ? quant?.diagnostics || [] : [];
const allTimelines = canDiagnose ? quant?.adObjectTimelines || [] : [];
const allLedgers = canDiagnose ? data?.productHistory?.ledgers || [] : [];

const productGrouping = useMemo(() => buildAdQuantProductGroups({
  scopeAsin: scope.asin,
  diagnostics: allDiagnostics,
  timelines: allTimelines,
  ledgers: allLedgers,
}), [scope.asin, allDiagnostics, allTimelines, allLedgers]);

const [selectedProductKey, setSelectedProductKey] = useState('');

useEffect(() => {
  setSelectedProductKey((current) => {
    if (current && productGrouping.groups.some((group) => group.productKey === current)) return current;
    return productGrouping.selectedProductKey;
  });
}, [productGrouping]);

const selectedProduct = selectedProductKey || productGrouping.selectedProductKey;
const productFiltered = filterAdQuantByProduct({
  productKey: selectedProduct,
  diagnostics: allDiagnostics,
  timelines: allTimelines,
  ledgers: allLedgers,
});

const visibleDiagnostics = productFiltered.diagnostics;
const visibleTimelines = productFiltered.timelines;
const productHistoryLedgers = productFiltered.ledgers;
```

- [ ] **Step 5: Add product selector UI near the top of ad quant page**

Render before detailed diagnostics:

```tsx
<section className="panel product-scope-panel">
  <div className="panel-title-row">
    <div>
      <span className="eyebrow">按产品查看</span>
      <h3>当前只展示一个 ASIN 的广告量化</h3>
      <p>先选产品，再看阶段、阈值、风险和建议，避免把多个产品混在一起判断。</p>
    </div>
  </div>
  <div className="product-selector-grid">
    {productGrouping.groups.map((group) => (
      <button
        type="button"
        key={group.productKey}
        className={`product-option-card ${selectedProduct === group.productKey ? 'product-option-card-active' : ''}`}
        onClick={() => setSelectedProductKey(group.productKey)}
      >
        <strong>{group.label}</strong>
        <span>花费 ${group.cost.toFixed(2)} / 订单 {group.orders} / 风险 {group.highRiskCount}</span>
        <span>{group.stage || '阶段待判定'}</span>
      </button>
    ))}
  </div>
</section>
```

- [ ] **Step 6: Collapse long ad quant evidence**

Wrap long evidence blocks in:

```tsx
<details className="evidence-disclosure">
  <summary>展开证据明细</summary>
  {/* existing evidence cards/table */}
</details>
```

Keep only these visible by default:

- product selector
- AI stage conclusion
- threshold summary
- top 3 priority objects
- next action

- [ ] **Step 7: Add product selector CSS**

In `apps/desktop/src/renderer/styles.css`:

```css
.product-selector-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.product-option-card {
  display: grid;
  gap: 6px;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  padding: 12px;
  color: var(--text);
  cursor: pointer;
}

.product-option-card span {
  color: var(--muted);
  font-size: 12px;
}

.product-option-card-active {
  border-color: var(--primary);
  background: #eff6ff;
}

.evidence-disclosure {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.evidence-disclosure summary {
  cursor: pointer;
  color: var(--primary);
  font-weight: 700;
}
```

- [ ] **Step 8: Run product grouping and ad quant tests**

Run:

```powershell
pnpm exec vitest run apps/desktop/src/renderer/ad-quant-product-groups.test.ts apps/desktop/src/renderer/pages/ad-quant-page.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit this task**

```powershell
git add apps/desktop/src/renderer/ad-quant-product-groups.ts apps/desktop/src/renderer/ad-quant-product-groups.test.ts apps/desktop/src/renderer/pages/ad-quant-page.tsx apps/desktop/src/renderer/pages/ad-quant-page.test.tsx apps/desktop/src/renderer/styles.css
git commit -m "feat: scope ad quantification by product"
```

## Task 4: Replace Lingxing Listing Read As Primary Path With Manual Listing Versions

**Files:**
- Modify `packages/shared-types/src/v1_5.ts`
- Modify `apps/desktop/src/renderer/types.ts`
- Modify `packages/local-db/src/sqlite/db.ts`
- Create `packages/local-db/src/sqlite/listing-content-version.test.ts`
- Create `apps/desktop/src/main/listing-manual-content.ts`
- Create `apps/desktop/src/main/listing-manual-content.test.ts`
- Modify `apps/desktop/src/main/index.ts`
- Modify `apps/desktop/src/preload/index.ts`
- Modify `apps/desktop/src/renderer/pages/listing-optimization-page.tsx`
- Modify `apps/desktop/src/renderer/pages/listing-optimization-page.test.ts`
- Modify `apps/desktop/src/renderer/listing-workflow-summary.ts`
- Modify `apps/desktop/src/renderer/listing-workflow-summary.test.ts`

- [ ] **Step 1: Add shared Listing version types**

In `packages/shared-types/src/v1_5.ts`, extend `ListingContent`:

```ts
export interface ListingContent {
  id?: number;
  asin: string;
  title: string;
  bullets: string[];
  description?: string;
  aPlus?: string;
  imageCopy?: string;
  backendTerms?: string;
  source?: 'manual' | 'lingxing_readonly' | 'imported_file';
  sourceUrl?: string;
  screenshotPath?: string;
  versionLabel?: string;
  changeSummary?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface ListingContentVersion extends ListingContent {
  versionId: number;
  listingContentId?: number;
}
```

- [ ] **Step 2: Add schema test for version table**

Create `packages/local-db/src/sqlite/listing-content-version.test.ts`:

```ts
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { initializeDatabase } from './db';

describe('listing content versions schema', () => {
  it('creates latest listing columns and version history table', () => {
    const db = new Database(':memory:');
    initializeDatabase(db);

    const listingColumns = db.prepare("PRAGMA table_info(listing_content)").all().map((row: any) => row.name);
    expect(listingColumns).toContain('source');
    expect(listingColumns).toContain('description');
    expect(listingColumns).toContain('version_label');
    expect(listingColumns).toContain('change_summary');
    expect(listingColumns).toContain('created_at');

    const versionColumns = db.prepare("PRAGMA table_info(listing_content_versions)").all().map((row: any) => row.name);
    expect(versionColumns).toEqual(expect.arrayContaining([
      'id',
      'listing_content_id',
      'asin',
      'store_name',
      'marketplace_code',
      'title',
      'bullets_json',
      'description',
      'a_plus',
      'image_copy',
      'backend_terms',
      'source',
      'version_label',
      'change_summary',
      'created_at',
    ]));
  });
});
```

- [ ] **Step 3: Run schema test and verify it fails**

Run:

```powershell
pnpm exec vitest run packages/local-db/src/sqlite/listing-content-version.test.ts
```

Expected before implementation: FAIL because the new columns/table do not exist.

- [ ] **Step 4: Add DB columns and version table**

In `packages/local-db/src/sqlite/db.ts`, add:

```ts
ensureColumn(database, 'listing_content', 'description', 'TEXT');
ensureColumn(database, 'listing_content', 'source', "TEXT DEFAULT 'manual'");
ensureColumn(database, 'listing_content', 'version_label', 'TEXT');
ensureColumn(database, 'listing_content', 'change_summary', 'TEXT');
ensureColumn(database, 'listing_content', 'created_at', "TEXT DEFAULT (datetime('now'))");

database.exec(`
  CREATE TABLE IF NOT EXISTS listing_content_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_content_id INTEGER,
    asin TEXT NOT NULL,
    store_name TEXT,
    marketplace_code TEXT,
    title TEXT DEFAULT '',
    bullets_json TEXT DEFAULT '[]',
    description TEXT,
    a_plus TEXT,
    image_copy TEXT,
    backend_terms TEXT,
    source TEXT DEFAULT 'manual',
    source_url TEXT,
    screenshot_path TEXT,
    version_label TEXT,
    change_summary TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);
```

- [ ] **Step 5: Add manual Listing validation helper test**

Create `apps/desktop/src/main/listing-manual-content.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildManualListingVersionSnapshot, validateManualListingInput } from './listing-manual-content';

describe('manual listing content', () => {
  it('requires ASIN and at least one meaningful listing field', () => {
    expect(() => validateManualListingInput({ asin: '', title: '', bullets: [], backendTerms: '' })).toThrow('ASIN 必填');
    expect(() => validateManualListingInput({ asin: 'B001', title: '', bullets: [], backendTerms: '' })).toThrow('至少填写标题、五点、详情或后台搜索词中的一项');
  });

  it('normalizes bullets and creates a version snapshot', () => {
    const snapshot = buildManualListingVersionSnapshot({
      listingContentId: 12,
      listing: {
        asin: ' b001 ',
        title: ' Smart Lock ',
        bullets: [' First bullet ', '', 'Second bullet'],
        description: ' Details ',
        backendTerms: 'lock, smart door',
        source: 'manual',
        versionLabel: '2026-06-18 手工录入',
        changeSummary: '补充标题和五点',
      },
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
    });

    expect(snapshot.asin).toBe('B001');
    expect(snapshot.bullets).toEqual(['First bullet', 'Second bullet']);
    expect(snapshot.source).toBe('manual');
    expect(snapshot.listingContentId).toBe(12);
  });
});
```

- [ ] **Step 6: Implement manual Listing helper**

Create `apps/desktop/src/main/listing-manual-content.ts`:

```ts
import type { ListingContent, ListingContentVersion } from '@amazon-ai-ops/shared-types';

export function validateManualListingInput(listing: Partial<ListingContent>): void {
  if (!String(listing.asin || '').trim()) {
    throw new Error('ASIN 必填');
  }
  const bullets = normalizeBullets(listing.bullets);
  const hasContent = [
    listing.title,
    listing.description,
    listing.aPlus,
    listing.imageCopy,
    listing.backendTerms,
    ...bullets,
  ].some((value) => String(value || '').trim().length > 0);
  if (!hasContent) {
    throw new Error('至少填写标题、五点、详情或后台搜索词中的一项');
  }
}

export function normalizeManualListingContent(listing: Partial<ListingContent>): ListingContent {
  validateManualListingInput(listing);
  return {
    asin: String(listing.asin || '').trim().toUpperCase(),
    title: String(listing.title || '').trim(),
    bullets: normalizeBullets(listing.bullets),
    description: String(listing.description || '').trim(),
    aPlus: String(listing.aPlus || '').trim(),
    imageCopy: String(listing.imageCopy || '').trim(),
    backendTerms: String(listing.backendTerms || '').trim(),
    source: listing.source || 'manual',
    sourceUrl: String(listing.sourceUrl || '').trim(),
    screenshotPath: String(listing.screenshotPath || '').trim(),
    versionLabel: String(listing.versionLabel || '').trim(),
    changeSummary: String(listing.changeSummary || '').trim(),
    updatedAt: listing.updatedAt,
    createdAt: listing.createdAt,
  };
}

export function buildManualListingVersionSnapshot(input: {
  listingContentId?: number;
  listing: Partial<ListingContent>;
  storeName?: string;
  marketplaceCode?: string;
}): ListingContentVersion {
  const normalized = normalizeManualListingContent(input.listing);
  return {
    ...normalized,
    versionId: 0,
    listingContentId: input.listingContentId,
  };
}

function normalizeBullets(input?: string[]): string[] {
  return (input || []).map((item) => String(item || '').trim()).filter(Boolean);
}
```

- [ ] **Step 7: Add IPC handlers**

In `apps/desktop/src/main/index.ts`, add handlers:

```ts
ipcMain.handle('v1_5:listing:save-manual-content', (_, input) =>
  handleSaveManualListingContent(input)
);

ipcMain.handle('v1_5:listing:list-content-versions', (_, input) =>
  handleListListingContentVersions(input)
);
```

The save handler must:

1. Normalize input with `normalizeManualListingContent()`.
2. Upsert latest `listing_content` by `asin + store_name + marketplace_code`.
3. Insert one row into `listing_content_versions`.
4. Return the saved latest content plus `versionId`.

- [ ] **Step 8: Expose preload APIs**

In `apps/desktop/src/preload/index.ts`, expose:

```ts
saveManualListingContent: (listing: any, scope?: { storeName?: string; marketplaceCode?: string }) =>
  ipcRenderer.invoke('v1_5:listing:save-manual-content', { listing, scope }),
listListingContentVersions: (input: { asin: string; storeName?: string; marketplaceCode?: string }) =>
  ipcRenderer.invoke('v1_5:listing:list-content-versions', input),
```

- [ ] **Step 9: Make manual Listing editor primary in renderer**

In `apps/desktop/src/renderer/pages/listing-optimization-page.tsx`, add local form state:

```tsx
const [manualListing, setManualListing] = useState<ListingContentView>({
  asin: scope.asin || '',
  title: '',
  bullets: ['', '', '', '', ''],
  aPlus: '',
  imageCopy: '',
  backendTerms: '',
  source: 'manual',
});
```

Render a primary card:

```tsx
<section className="panel listing-editor-panel">
  <div className="panel-title-row">
    <div>
      <span className="eyebrow">Listing 来源</span>
      <h3>手工录入当前 Listing</h3>
      <p>领星读取不完整时，直接录入标题、五点、详情和后台搜索词；每次保存都会记录版本。</p>
    </div>
    <span className="status-pill status-pill-info">主流程</span>
  </div>
  {/* ASIN, title, five bullets, description/A+, image copy, backend terms, version label, change summary inputs */}
  <button type="button" className="primary-button" onClick={handleSaveManualListing}>保存为新版本</button>
</section>
```

Move Lingxing read button into a secondary card:

```tsx
<section className="panel muted-panel">
  <h3>从领星辅助读取</h3>
  <p>只作为辅助填充，不再作为 Listing 优化的前置条件。</p>
  <button type="button" className="secondary-button" onClick={handleReadFromLingxing}>尝试读取并填入表单</button>
</section>
```

- [ ] **Step 10: Add renderer tests for manual Listing readiness**

In `apps/desktop/src/renderer/pages/listing-optimization-page.test.ts`, add:

```ts
it('allows manual listing content to become the source without Lingxing extraction', async () => {
  const api = createFakeApi({
    saveManualListingContent: vi.fn().mockResolvedValue({
      asin: 'B001',
      title: 'Smart lock',
      bullets: ['Easy install'],
      backendTerms: 'smart lock',
      source: 'manual',
      versionId: 1,
    }),
  });

  renderListingPage({ api, scope: { asin: 'B001', storeName: 'FT-US-US', marketplaceCode: 'US' } });

  await userEvent.type(screen.getByLabelText('标题'), 'Smart lock');
  await userEvent.type(screen.getByLabelText('五点 1'), 'Easy install');
  await userEvent.click(screen.getByRole('button', { name: '保存为新版本' }));

  expect(api.saveManualListingContent).toHaveBeenCalled();
  expect(await screen.findByText('已保存为 Listing 版本')).toBeInTheDocument();
});
```

- [ ] **Step 11: Run Listing incremental tests**

Run:

```powershell
pnpm exec vitest run packages/local-db/src/sqlite/listing-content-version.test.ts apps/desktop/src/main/listing-manual-content.test.ts apps/desktop/src/renderer/listing-workflow-summary.test.ts apps/desktop/src/renderer/pages/listing-optimization-page.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit this task**

```powershell
git add packages/shared-types/src/v1_5.ts apps/desktop/src/renderer/types.ts packages/local-db/src/sqlite/db.ts packages/local-db/src/sqlite/listing-content-version.test.ts apps/desktop/src/main/listing-manual-content.ts apps/desktop/src/main/listing-manual-content.test.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/pages/listing-optimization-page.tsx apps/desktop/src/renderer/pages/listing-optimization-page.test.ts apps/desktop/src/renderer/listing-workflow-summary.ts apps/desktop/src/renderer/listing-workflow-summary.test.ts
git commit -m "feat: add manual listing version workflow"
```

## Task 5: Rework Page Information Architecture Around Operator Tasks

**Files:**
- Modify `apps/desktop/src/renderer/pages/dashboard-page.tsx`
- Modify `apps/desktop/src/renderer/pages/ad-quant-page.tsx`
- Modify `apps/desktop/src/renderer/pages/recommendations-page.tsx`
- Modify `apps/desktop/src/renderer/pages/approval-page.tsx`
- Modify `apps/desktop/src/renderer/pages/listing-optimization-page.tsx`
- Modify `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Define per-page first-screen contract**

Each page must show these elements above the fold:

```text
1. 当前范围
2. 当前主任务
3. 是否可继续
4. 下一步动作
5. 最多 3 个核心指标或风险
```

Evidence, logs, raw batch IDs, history cards, and large tables must be below a collapsed section.

- [ ] **Step 2: Dashboard first screen**

In `dashboard-page.tsx`, make the first screen contain:

```tsx
<section className="operator-summary-grid">
  <article className="summary-card">数据健康</article>
  <article className="summary-card">AI 状态</article>
  <article className="summary-card">产品待处理</article>
  <article className="summary-card">下一步</article>
</section>
```

Remove long repeated explanation blocks from dashboard.

- [ ] **Step 3: Recommendations page first screen**

In `recommendations-page.tsx`, add a top summary:

```tsx
<section className="recommendation-summary-strip">
  <div>正式建议 {formalCount}</div>
  <div>AI 洞察 {insightOnlyCount}</div>
  <div>待审批 {pendingApprovalCount}</div>
  <div>当前产品 {selectedAsin || '全部'}</div>
</section>
```

Keep AI evidence and rule evidence in row details, not in the main row.

- [ ] **Step 4: Approval page first screen**

In `approval-page.tsx`, keep:

- pending approval count
- blocked count
- selected recommendation summary
- approval action buttons

Wrap policy details in:

```tsx
<details className="evidence-disclosure">
  <summary>查看审批依据和证据</summary>
  {/* evidence cards */}
</details>
```

- [ ] **Step 5: CSS for task cards and compact forms**

In `styles.css`, add:

```css
.operator-summary-grid,
.recommendation-summary-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.summary-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  padding: 14px;
}

.compact-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.compact-form-grid label {
  display: grid;
  gap: 6px;
  font-weight: 700;
  color: var(--muted);
}

.compact-form-grid input,
.compact-form-grid textarea,
.compact-form-grid select {
  min-height: 34px;
  border-radius: 8px;
}
```

- [ ] **Step 6: Run renderer targeted tests**

Run:

```powershell
pnpm exec vitest run apps/desktop/src/renderer/pages/dashboard-page.test.ts apps/desktop/src/renderer/pages/recommendations-page.test.ts apps/desktop/src/renderer/pages/approval-page.test.tsx apps/desktop/src/renderer/pages/ad-quant-page.test.tsx apps/desktop/src/renderer/pages/listing-optimization-page.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit this task**

```powershell
git add apps/desktop/src/renderer/pages/dashboard-page.tsx apps/desktop/src/renderer/pages/ad-quant-page.tsx apps/desktop/src/renderer/pages/recommendations-page.tsx apps/desktop/src/renderer/pages/approval-page.tsx apps/desktop/src/renderer/pages/listing-optimization-page.tsx apps/desktop/src/renderer/styles.css
git commit -m "refactor: clarify operator page task flow"
```

## Task 6: Incremental Verification, Smoke, And Final Build

**Files:**
- Modify tests only if selectors changed:
  - `scripts/smoke-business-ui-ad-execution.js`
  - `scripts/smoke-business-ui-data-pipeline.js`
  - `scripts/smoke-business-ui-settings-delivery.js`
- Update docs after final verification:
  - `project-docs/amazon-ai-ops-acceptance-checklist.md`
  - `project-docs/amazon-ai-ops-delivery-evidence-2026-05-26.md`
  - `project-tasks/amazon-ai-ops-deliverable-tasklist.md`

- [ ] **Step 1: Run AI and renderer incremental tests**

Run:

```powershell
pnpm exec vitest run packages/ai-adapter/src/ad-strategy-diagnosis.test.ts apps/desktop/src/renderer/ai-call-diagnostics.test.ts apps/desktop/src/renderer/ad-quant-product-groups.test.ts apps/desktop/src/renderer/pages/ad-quant-page.test.tsx apps/desktop/src/renderer/components/scope-bar.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run Listing and DB incremental tests**

Run:

```powershell
pnpm exec vitest run packages/local-db/src/sqlite/listing-content-version.test.ts apps/desktop/src/main/listing-manual-content.test.ts apps/desktop/src/renderer/listing-workflow-summary.test.ts apps/desktop/src/renderer/pages/listing-optimization-page.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run desktop typecheck**

Run:

```powershell
pnpm --filter @amazon-ai-ops/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Build renderer and run UI smoke**

Run:

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:renderer
node scripts/smoke-business-ui-ad-execution.js
node scripts/smoke-business-ui-data-pipeline.js
node scripts/smoke-business-ui-settings-delivery.js
```

Expected:

- AI parse error text does not contain raw `position` or `line column`.
- Ad quant page contains product selector text `按产品查看`.
- Listing page contains `手工录入当前 Listing` and `保存为新版本`.
- Long evidence blocks are behind `展开证据明细`.

- [ ] **Step 5: Manual visible UI verification**

Start the desktop app from the current build and verify:

```text
1. Sidebar does not duplicate menu groups while scrolling.
2. Text size fits a 1920x1080 viewport without oversized cards.
3. Dashboard first screen shows current scope, data health, AI health, and next action.
4. Ad quant page shows one selected product by default.
5. Product switch changes visible diagnostics.
6. Listing page can save a manual version without clicking Lingxing read.
7. Version history appears after saving.
8. No RMB symbol appears in the visible UI.
```

- [ ] **Step 6: Final full verification**

Run only at the final node:

```powershell
pnpm -r run typecheck
pnpm test
pnpm --filter @amazon-ai-ops/desktop run build:win
```

Expected: PASS.

- [ ] **Step 7: Record final artifact evidence**

Run:

```powershell
Get-FileHash apps/desktop/release/AmazonAIOpsAgent-1.2.0.exe -Algorithm SHA256
Get-Item apps/desktop/release/AmazonAIOpsAgent-1.2.0.exe | Select-Object FullName,Length,LastWriteTime
```

Record:

- installer path
- size
- SHA-256
- build time
- exact tests run
- remaining known risks, if any

- [ ] **Step 8: Update project docs**

Update:

```text
project-docs/amazon-ai-ops-acceptance-checklist.md
project-docs/amazon-ai-ops-delivery-evidence-2026-05-26.md
project-tasks/amazon-ai-ops-deliverable-tasklist.md
```

Required wording:

```text
AI 输出异常已改为一次 JSON 修复 + 中文兜底，不再向用户展示原始 parser position。
广告量化已按产品/ASIN 分组，默认只展示一个产品，避免跨产品混判。
Listing 优化已改为手工录入和版本历史为主流程，领星读取为辅助填充。
中途只跑增量测试；最终节点已跑全量 typecheck/test/build:win。
```

- [ ] **Step 9: Commit verification/docs**

```powershell
git add scripts/smoke-business-ui-ad-execution.js scripts/smoke-business-ui-data-pipeline.js scripts/smoke-business-ui-settings-delivery.js project-docs/amazon-ai-ops-acceptance-checklist.md project-docs/amazon-ai-ops-delivery-evidence-2026-05-26.md project-tasks/amazon-ai-ops-deliverable-tasklist.md
git commit -m "docs: record product ui stabilization evidence"
```

Only include smoke scripts if they actually changed.

## Execution Strategy

Recommended execution mode: Inline execution in the current session.

Reason:

- The current working tree already contains partial Task 1 and Task 2 edits.
- Continuing inline avoids losing uncommitted context.
- Use subagents only for isolated read-only checks or post-task review, then close them.

Commit cadence:

1. Task 1 commit: AI JSON and diagnostic messages.
2. Task 2 commit: app shell density and scope bar.
3. Task 3 commit: ad quant product scoping.
4. Task 4 commit: manual Listing versions.
5. Task 5 commit: page information architecture.
6. Task 6 commit: final evidence/docs.

## Risk Controls

- Do not write real ad actions while implementing UI and AI fixes.
- Do not mark APP_READY from code changes alone.
- Do not let AI insight-only candidates enter approval or execution.
- Do not treat audit JSON/PNG/HTML as real report files.
- Do not run full test/build repeatedly; use the final full verification gate once.
- Do not store API keys in logs or docs.

## Self-Review

Spec coverage:

- UI text too large: covered by Task 2 and Task 5.
- AI standard output error: covered by Task 1.
- Long pages: covered by Task 3 and Task 5.
- Product-scoped ads: covered by Task 3.
- Listing manual input and version history: covered by Task 4.
- Card/section layout: covered by Task 2 and Task 5.
- Incremental tests only until final: covered by Task 6.

Placeholder scan:

- No placeholder markers are present.
- Every task has exact files, commands, and expected results.

Type consistency:

- `ListingContent.source` values match renderer and main-process planned usage.
- `ListingContentVersion` extends `ListingContent` and adds `versionId`.
- Product grouping uses `productKey` consistently and reserves `UNBOUND_PRODUCT_KEY` for rows without ASIN.
