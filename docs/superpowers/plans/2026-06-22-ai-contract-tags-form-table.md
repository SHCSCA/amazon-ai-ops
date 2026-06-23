# AI Contract Tags and Form Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make AI output contracts, dense metric summaries, and Listing manual input understandable in the Windows desktop UI without weakening fixed AI schemas or ad-execution safety.

**Architecture:** Keep backend AI contracts unchanged. Add small renderer helpers/components that explain fixed AI output contracts as tags, render dense numeric checks as compact chips instead of oversized card titles, and present Listing fields in a table-like editor. Apply those components to Settings, Ad Quant input checks, and Listing Optimization first because the screenshots show those as the highest-friction surfaces.

**Tech Stack:** Electron desktop app, React renderer, TypeScript, existing Vitest component-helper tests, existing smoke scripts under `scripts/`.

---

## Current Evidence

- Settings already uses `ProgressiveDetails` for `高级 AI 参数`, but the visible copy still says AI returns "标准 JSON" without showing the fixed contract names.
- Backend AI contracts are already fixed: `ad_strategy_diagnosis_v1`, `ad_action_reason_v1`, and `listing_rewrite_v1`.
- AI output parse/schema failures already fall back to rule output and do not directly enter formal ad execution.
- `context-summary-grid` cards still use oversized `strong` values in several places, including `AI+规则建议输入检查`.
- Listing manual input is still a wide form wall under `手工录入当前 Listing`.

## Non-Negotiable Boundaries

- Do not make user-edited persona text control schema fields or `schemaVersion`.
- Do not remove fallback behavior for malformed AI output.
- Do not expose raw JSON as primary UI.
- Do not hide evidence paths entirely; keep them in secondary details.
- Keep Windows desktop focus. No mobile work.
- Do not weaken fail-closed ad execution.

## File Structure

**Create**
- `apps/desktop/src/renderer/ai-output-contracts.ts`
  Pure helper for fixed AI contract metadata and operator-facing labels.
- `apps/desktop/src/renderer/ai-output-contracts.test.ts`
  Verifies contract names, labels, safety copy, and no raw JSON copy in primary summaries.
- `apps/desktop/src/renderer/components/tag-metric-group.tsx`
  Reusable compact tag/chip renderer for summary facts and contract badges.
- `apps/desktop/src/renderer/components/tag-metric-group.test.tsx`
  Verifies chip rendering, controlled typography classes, and no oversized metric title behavior.

**Modify**
- `apps/desktop/src/renderer/pages/settings-page.tsx`
  Replace "标准 JSON" primary copy with fixed-contract tags and move schema detail behind `高级 AI 参数`.
- `apps/desktop/src/renderer/pages/settings-page.test.ts`
  Add coverage for AI contract summaries and primary copy boundaries.
- `apps/desktop/src/renderer/pages/ad-quant-page.tsx`
  Replace the `AI+规则建议输入检查` card grid with compact metric tags.
- `apps/desktop/src/renderer/pages/listing-optimization-page.tsx`
  Replace the manual Listing form wall with a table-like editor grouped by Listing field.
- `apps/desktop/src/renderer/pages/listing-optimization-page.test.ts`
  Add helpers/tests proving the table field groups are complete and ordered.
- `apps/desktop/src/renderer/styles.css`
  Add contract tag, metric tag, and form table styles; reduce dense card title weight where these components are used.
- `scripts/smoke-business-ui-settings-delivery.js`
  Assert contract tags are visible and raw JSON wording is not primary copy.
- `scripts/smoke-business-ui-keyword-listing.js`
  Assert Listing table editor labels are visible.

---

### Task 1: Add Fixed AI Contract Metadata and Contract Tags

**Files:**
- Create: `apps/desktop/src/renderer/ai-output-contracts.ts`
- Create: `apps/desktop/src/renderer/ai-output-contracts.test.ts`
- Create: `apps/desktop/src/renderer/components/tag-metric-group.tsx`
- Create: `apps/desktop/src/renderer/components/tag-metric-group.test.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [x] **Step 1: Write failing tests for AI contract metadata**

Add tests that assert the UI has three fixed contracts and primary copy avoids raw JSON:

```ts
import { describe, expect, it } from 'vitest';
import {
  aiContractPrimaryCopy,
  aiOutputContracts,
  aiOutputContractTags,
  hasRawJsonPrimaryCopy,
} from './ai-output-contracts';

describe('AI output contracts', () => {
  it('lists the fixed contracts consumed by the app', () => {
    expect(aiOutputContracts.map((contract) => contract.version)).toEqual([
      'ad_strategy_diagnosis_v1',
      'ad_action_reason_v1',
      'listing_rewrite_v1',
    ]);
  });

  it('shows operator-facing tags instead of asking users to reason about raw JSON', () => {
    expect(aiOutputContractTags().map((tag) => tag.label)).toEqual([
      '广告诊断 v1',
      '广告解释 v1',
      'Listing 草案 v1',
      '异常回退规则',
    ]);
    expect(hasRawJsonPrimaryCopy(aiContractPrimaryCopy())).toBe(false);
  });
});
```

- [x] **Step 2: Run the metadata test and confirm failure**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\ai-output-contracts.test.ts
```

Expected: fail because the module does not exist.

- [x] **Step 3: Implement `ai-output-contracts.ts`**

Create fixed metadata:

```ts
export type AiOutputContractTone = 'ready' | 'warning';

export interface AiOutputContract {
  key: 'ad-strategy' | 'ad-action' | 'listing-draft';
  label: string;
  version: 'ad_strategy_diagnosis_v1' | 'ad_action_reason_v1' | 'listing_rewrite_v1';
  usedBy: string;
  consumedAs: string;
}

export interface AiContractTag {
  label: string;
  tone: AiOutputContractTone;
  detail: string;
}

export const aiOutputContracts: AiOutputContract[] = [
  {
    key: 'ad-strategy',
    label: '广告诊断',
    version: 'ad_strategy_diagnosis_v1',
    usedBy: '广告量化、优化建议',
    consumedAs: '阶段判断、阈值建议、候选动作',
  },
  {
    key: 'ad-action',
    label: '广告解释',
    version: 'ad_action_reason_v1',
    usedBy: '优化建议、审批中心',
    consumedAs: '动作解释、风险说明、证据摘要',
  },
  {
    key: 'listing-draft',
    label: 'Listing 草案',
    version: 'listing_rewrite_v1',
    usedBy: 'Listing 优化',
    consumedAs: '草案文本、修改理由',
  },
];

export function aiOutputContractTags(): AiContractTag[] {
  return [
    ...aiOutputContracts.map((contract) => ({
      label: `${contract.label} v1`,
      tone: 'ready' as const,
      detail: `${contract.usedBy} 读取固定字段：${contract.consumedAs}`,
    })),
    {
      label: '异常回退规则',
      tone: 'warning',
      detail: '字段缺失、版本不符或解析失败时，不进入正式可执行建议，改用规则兜底。',
    },
  ];
}

export function aiContractPrimaryCopy(): string {
  return 'AI 输出合同由系统固定，页面只读取已校验字段；人设只影响表达风格，不改变字段结构。';
}

export function hasRawJsonPrimaryCopy(text: string): boolean {
  return /\bJSON\b|schemaVersion|manifest|gate/i.test(text);
}
```

- [x] **Step 4: Write tests for compact tag component**

Create `tag-metric-group.test.tsx`:

```tsx
import React, { type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { TagMetricGroup } from './tag-metric-group';

function collectText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (!React.isValidElement(node)) return '';
  return collectText(node.props.children);
}

function collectElements(node: ReactNode, type: string): ReactElement[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap((child) => collectElements(child, type));
  if (!React.isValidElement(node)) return [];
  return (node.type === type ? [node] : []).concat(collectElements(node.props.children, type));
}

describe('TagMetricGroup', () => {
  it('renders compact chips for dense summary facts', () => {
    const tree = TagMetricGroup({
      items: [
        { label: '真实报表', value: '8/8', tone: 'ready' },
        { label: '指标', value: '2416 行', tone: 'ready' },
      ],
    }) as ReactElement;

    expect(collectText(tree)).toContain('真实报表');
    expect(collectText(tree)).toContain('2416 行');
    expect(collectElements(tree, 'strong')).toHaveLength(2);
  });
});
```

- [x] **Step 5: Implement `TagMetricGroup` and styles**

Create:

```tsx
import React from 'react';

export type TagMetricTone = 'ready' | 'warning' | 'blocked' | 'neutral';

export interface TagMetricItem {
  label: string;
  value?: string | number;
  detail?: string;
  tone?: TagMetricTone;
}

export function TagMetricGroup({ items }: { items: TagMetricItem[] }) {
  return (
    <div className="tag-metric-group">
      {items.map((item) => (
        <span className={`tag-metric tag-metric-${item.tone || 'neutral'}`} key={`${item.label}-${item.value ?? ''}`} title={item.detail}>
          <span>{item.label}</span>
          {item.value !== undefined && <strong>{item.value}</strong>}
        </span>
      ))}
    </div>
  );
}
```

Append styles:

```css
.tag-metric-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.tag-metric {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #fff;
  padding: 5px 10px;
  color: #30445f;
  font-size: 12px;
  font-weight: 700;
}

.tag-metric strong {
  color: var(--text);
  font-size: 13px;
  line-height: 1;
}

.tag-metric-ready {
  border-color: #b8e6c9;
  background: #f1fbf5;
}

.tag-metric-warning {
  border-color: #f1d08b;
  background: #fff9eb;
}

.tag-metric-blocked {
  border-color: #f0b9bf;
  background: #fff7f8;
}
```

- [x] **Step 6: Verify Task 1**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\ai-output-contracts.test.ts apps\desktop\src\renderer\components\tag-metric-group.test.tsx
```

Expected: all tests pass.

---

### Task 2: Apply AI Contract Tags to Settings

**Files:**
- Modify: `apps/desktop/src/renderer/pages/settings-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/settings-page.test.ts`
- Modify: `scripts/smoke-business-ui-settings-delivery.js`

- [x] **Step 1: Add settings tests for contract tags**

Extend `settings-page.test.ts`:

```ts
import { settingsAiContractTags, settingsAiContractPrimaryCopy } from './settings-page';

it('keeps AI output contract copy concrete and non-JSON primary', () => {
  expect(settingsAiContractPrimaryCopy()).toBe('AI 输出合同由系统固定，页面只读取已校验字段；人设只影响表达风格，不改变字段结构。');
  expect(settingsAiContractPrimaryCopy()).not.toMatch(/\bJSON\b|schemaVersion/i);
  expect(settingsAiContractTags().map((item) => item.label)).toEqual([
    '广告诊断 v1',
    '广告解释 v1',
    'Listing 草案 v1',
    '异常回退规则',
  ]);
});
```

- [x] **Step 2: Update Settings rendering**

In `settings-page.tsx`:
- Import `TagMetricGroup`.
- Import `aiContractPrimaryCopy` and `aiOutputContractTags`.
- Export `settingsAiContractPrimaryCopy()` and `settingsAiContractTags()` wrappers for tests.
- Replace the visible sentence containing "标准 JSON" with `settingsAiContractPrimaryCopy()`.
- Render a `TagMetricGroup` below the AI connection actions.
- Put the exact contract versions under `高级 AI 参数`.

- [x] **Step 3: Update settings smoke**

In `scripts/smoke-business-ui-settings-delivery.js`, assert:
- `广告诊断 v1`
- `广告解释 v1`
- `Listing 草案 v1`
- `异常回退规则`

Do not assert visible primary text containing `标准 JSON`.

- [x] **Step 4: Verify Task 2**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\pages\settings-page.test.ts apps\desktop\src\renderer\ai-output-contracts.test.ts apps\desktop\src\renderer\components\tag-metric-group.test.tsx
node scripts\smoke-business-ui-settings-delivery.js
```

Expected: tests and smoke pass.

---

### Task 3: Replace Oversized Input Check Cards with Metric Tags

**Files:**
- Modify: `apps/desktop/src/renderer/pages/ad-quant-page.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: smoke selectors if needed in `scripts/smoke-business-ui-data-pipeline.js`

- [x] **Step 1: Add a compact tag list in `AI+规则建议输入检查`**

Replace the first large `context-summary-grid` in `AI+规则建议输入检查` with:

```tsx
<TagMetricGroup
  items={[
    { label: '真实报表', value: `${realReportCount}/8`, tone: realReportCount >= 8 ? 'ready' : realReportCount > 0 ? 'warning' : 'blocked' },
    { label: '指标', value: `${importedRowCount} 行`, tone: importedRowCount > 0 ? 'ready' : 'blocked' },
    { label: '可建议对象', value: actionableRows, tone: actionableRows > 0 ? 'ready' : 'blocked' },
    { label: '诊断', value: diagnosticCount, tone: diagnosticCount > 0 ? 'ready' : 'warning' },
    { label: '产品目标', value: productWithTargets, tone: productWithTargets > 0 ? 'ready' : 'warning' },
    { label: '运营事件', value: operationEvents.length, tone: operationEvents.length > 0 ? 'ready' : 'warning' },
  ]}
/>
```

Follow it with one short paragraph for the recommendation entrance.

- [x] **Step 2: Keep detailed explanations collapsed**

Move the old seven-card explanations into a `ProgressiveDetails` block titled `输入明细和判断依据`.

- [x] **Step 3: Verify Task 3**

Run:

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:renderer
node scripts\smoke-business-ui-data-pipeline.js
```

Expected: build and smoke pass.

---

### Task 4: Convert Listing Manual Input to a Table-Like Editor

**Files:**
- Modify: `apps/desktop/src/renderer/pages/listing-optimization-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/listing-optimization-page.test.ts`
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: `scripts/smoke-business-ui-keyword-listing.js`

- [x] **Step 1: Add helper tests for Listing field order**

Extend `listing-optimization-page.test.ts`:

```ts
import { listingManualFieldGroups } from './listing-optimization-page';

it('orders manual Listing fields like a table editor', () => {
  expect(listingManualFieldGroups().map((group) => group.title)).toEqual([
    '基础信息',
    '标题',
    '五点',
    '详情与搜索词',
  ]);
  expect(listingManualFieldGroups().flatMap((group) => group.fields.map((field) => field.label))).toContain('五点 5');
});
```

- [x] **Step 2: Export field group metadata**

In `listing-optimization-page.tsx`, add:

```ts
export function listingManualFieldGroups() {
  return [
    { title: '基础信息', fields: [{ key: 'asin', label: 'ASIN' }, { key: 'versionLabel', label: '版本名称' }, { key: 'changeSummary', label: '修改说明' }] },
    { title: '标题', fields: [{ key: 'title', label: '标题' }] },
    { title: '五点', fields: [1, 2, 3, 4, 5].map((index) => ({ key: `bullet-${index}`, label: `五点 ${index}` })) },
    { title: '详情与搜索词', fields: [{ key: 'description', label: '详情 / A+ 内容' }, { key: 'backendTerms', label: '后台搜索词' }, { key: 'imageCopy', label: '图片文案' }] },
  ];
}
```

- [x] **Step 3: Replace the grid form with table rows**

Render `手工录入当前 Listing` as:
- left column: field label and required/optional tag
- right column: input or textarea
- status column: `必填`, `建议填写`, or `可选`

Use class names:
- `listing-editor-table`
- `listing-editor-section`
- `listing-editor-row`
- `listing-editor-label`
- `listing-editor-control`

- [x] **Step 4: Add table styles**

Append styles:

```css
.listing-editor-table {
  display: grid;
  gap: 12px;
}

.listing-editor-section {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: #fff;
  overflow: hidden;
}

.listing-editor-section > strong {
  display: block;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line-soft);
  background: #f8fafc;
  font-size: 14px;
}

.listing-editor-row {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) 90px;
  gap: 12px;
  align-items: start;
  padding: 10px 12px;
  border-top: 1px solid var(--line-soft);
}

.listing-editor-row:first-of-type {
  border-top: 0;
}

.listing-editor-label {
  color: #52657f;
  font-size: 13px;
  font-weight: 800;
}

.listing-editor-control input,
.listing-editor-control textarea {
  width: 100%;
}
```

- [x] **Step 5: Update keyword/listing smoke**

Assert the page contains:
- `基础信息`
- `五点 5`
- `详情与搜索词`
- `保存为新版本`

- [x] **Step 6: Verify Task 4**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\pages\listing-optimization-page.test.ts
node scripts\smoke-business-ui-keyword-listing.js
```

Expected: tests and smoke pass.

---

### Task 5: Final Focused Verification

**Files:**
- Modify docs only if the visible UX contract changes are mentioned in handoff docs.

- [x] **Step 1: Run focused tests**

```powershell
pnpm exec vitest run apps\desktop\src\renderer\ai-output-contracts.test.ts apps\desktop\src\renderer\components\tag-metric-group.test.tsx apps\desktop\src\renderer\pages\settings-page.test.ts apps\desktop\src\renderer\pages\listing-optimization-page.test.ts
```

Expected: all selected tests pass.

- [x] **Step 2: Run renderer build**

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:renderer
```

Expected: renderer build passes.

- [x] **Step 3: Run relevant smoke scripts**

```powershell
node scripts\smoke-business-ui-settings-delivery.js
node scripts\smoke-business-ui-data-pipeline.js
node scripts\smoke-business-ui-keyword-listing.js
```

Expected: all smoke scripts pass.

- [x] **Step 4: Run safety guard**

```powershell
pnpm run verify:ad-execution
```

Expected: `AD_EXECUTION_FAIL_CLOSED verified.`

## Acceptance Criteria

- Settings clearly shows fixed AI contracts as tags: `广告诊断 v1`, `广告解释 v1`, `Listing 草案 v1`, `异常回退规则`.
- Primary Settings copy no longer asks users to reason about raw JSON.
- Advanced details still expose the concrete contract versions for debugging.
- `AI+规则建议输入检查` no longer uses oversized multi-line card titles for dense metrics.
- The same metric/tag component can be reused globally.
- Manual Listing input is a table-like editor grouped by `基础信息`, `标题`, `五点`, and `详情与搜索词`.
- AI persona remains a style/control input only; schema remains system-owned.
- Ad execution safety and fallback behavior remain unchanged.

## Self-Review

- Spec coverage: Covers all three user concerns: AI JSON consistency, oversized title/tag conversion, and table-like data input. Treats them as global component problems, not single-page fixes.
- Placeholder scan: No TBD/TODO/implement-later placeholders. Each task lists concrete file paths and verification commands.
- Type consistency: New helpers are renderer-only and do not change backend AI contract types.
- Scope check: Focused on Windows desktop renderer UX. No backend contract or ad-write behavior changes.
