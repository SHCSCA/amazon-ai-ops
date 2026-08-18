# Windows Desktop UX Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce cognitive load in the Windows desktop app so Amazon operators see one clear next action per workflow while preserving fail-closed ad execution, evidence provenance, and current APP_READY safety gates.

**Architecture:** Keep the current Electron/React renderer structure and avoid a broad rewrite. Add small UX view-model helpers for operator-facing copy, primary actions, and progressive disclosure, then update the highest-friction pages in place: dashboard, data collection/import, recommendations/approval, readback, delivery, and settings. Technical evidence remains available behind secondary panels, but primary views use task-first language and show fewer simultaneous decisions.

**Tech Stack:** Electron desktop app, React, Zustand, TypeScript, Vitest renderer tests, Playwright smoke scripts under `scripts/`, existing package/readiness verifier chain.

---

## Non-Negotiable Boundaries

- Windows desktop only. Do not spend effort on mobile layouts.
- Do not weaken ad execution safety. Batch ad writes remain fail-closed.
- Do not remove evidence paths, package hashes, final-readiness gates, or readback verification. Move them to secondary/technical areas when they are not the primary operator task.
- Primary UI must avoid raw `APP_READY`, `APP_NEEDS_WORK`, `READY`, `manifest`, `gate`, command walls, and long JSON/path blocks unless the user explicitly opens technical details.
- Each major page should expose one dominant primary action in the first viewport.
- Keep file/folder path visibility because operators need local delivery and report traceability.

## Target UX Outcomes

- Dashboard first viewport answers: "Can I analyze now? What should I do next?"
- Data pages answer: "Where are my reports? Are they imported? What button fixes the gap?"
- Recommendation pages answer: "Which actions are worth reviewing, which are blocked, and why in business terms?"
- Readback page becomes a step-by-step evidence wizard instead of a full blank form wall.
- Delivery page answers: "Can this be handed to a user? If not, what exact business item is missing?"
- Settings page separates normal AI/rule setup from advanced diagnostics/storage.

## File Structure

**Create**
- `apps/desktop/src/renderer/operator-ux.ts`
  Shared helpers for operator-facing terms, primary-action selection, technical-term detection, and compact status labels.
- `apps/desktop/src/renderer/operator-ux.test.ts`
  Tests for copy sanitization, primary action decisions, and technical term detection.
- `apps/desktop/src/renderer/components/operator-task-panel.tsx`
  Reusable "current task + one primary action + secondary details" component.
- `apps/desktop/src/renderer/components/operator-task-panel.test.tsx`
  Renderer tests for one-primary-action behavior and compact detail rendering.
- `apps/desktop/src/renderer/components/progressive-details.tsx`
  Reusable wrapper for technical details, evidence paths, and advanced sections.
- `apps/desktop/src/renderer/components/progressive-details.test.tsx`
  Tests that details are collapsed by default and expose content on demand.
- `apps/desktop/src/renderer/readback-wizard.ts`
  Readback step grouping and next-step logic built on the existing `requiredMissing()` contract.
- `apps/desktop/src/renderer/readback-wizard.test.ts`
  Tests for readback step status, missing-field grouping, and step routing.

**Modify**
- `apps/desktop/src/renderer/components/ui.tsx`
  Add optional compact header/action affordances without breaking existing `PageHeader` callers.
- `apps/desktop/src/renderer/components/scope-bar.tsx`
  Make the global scope bar visually compact by default and keep detailed explanation under disclosure.
- `apps/desktop/src/renderer/components/app-shell.tsx`
  Keep current grouped navigation, but make labels and ordering support task-first use.
- `apps/desktop/src/renderer/pages/dashboard-page.tsx`
  Replace multiple competing first-viewport panels with one "today's task" panel and demote delivery/file details.
- `apps/desktop/src/renderer/pages/data-collection-page.tsx`
  Collapse file/path/audit detail by default and make the main data action unambiguous.
- `apps/desktop/src/renderer/pages/data-import-validation-page.tsx`
  Align with data collection page: one import action, compact data-location summary, advanced details collapsed.
- `apps/desktop/src/renderer/pages/ad-quant-page.tsx`
  Keep analysis depth, but lead with the business judgment and next action; move AI evidence internals down.
- `apps/desktop/src/renderer/pages/recommendations-page.tsx`
  Show recommendation outcome buckets before AI/规则 evidence internals.
- `apps/desktop/src/renderer/pages/approval-page.tsx`
  Make "approve / reject / cannot approve" the first decision; move full evidence detail behind disclosure.
- `apps/desktop/src/renderer/pages/readback-page.tsx`
  Convert the long readback form into a wizard with object/source, approval, screenshots/values, verify/export steps.
- `apps/desktop/src/renderer/pages/delivery-page.tsx`
  Convert to operator delivery summary first, technical evidence list second.
- `apps/desktop/src/renderer/pages/settings-page.tsx`
  Split normal setup from advanced diagnostics/storage.
- `apps/desktop/src/renderer/styles.css`
  Add compact task panels, calmer alert tones, wizard layout, and less dense cards.
- Existing tests under `apps/desktop/src/renderer/**/*.test.ts*`
  Update expected copy and add coverage for new view-model helpers.
- Existing smoke scripts under `scripts/smoke-business-ui-*.js`
  Update selectors and screenshot assertions for new primary-first layout.
- `README.md`, `docs/USER_GUIDE_v1_5.md`, `docs/V1_5_PROGRESS_REPORT.md`, `docs/V1_5_ACCEPTANCE_MATRIX.md`, `docs/V1_5_ORCHESTRATOR_CLOSEOUT.md`
  Only update after implementation changes affect UX boundaries, evidence paths, or readiness claims.

---

### Task 1: Add Operator UX Copy and Action Helpers

**Files:**
- Create: `apps/desktop/src/renderer/operator-ux.ts`
- Create: `apps/desktop/src/renderer/operator-ux.test.ts`

- [ ] **Step 1: Write tests for operator-facing term handling**

Add tests that lock down primary-copy boundaries:

```ts
import { describe, expect, it } from 'vitest';
import {
  containsTechnicalTerm,
  deliveryStatusCopy,
  operatorStatusLabel,
  primaryActionForDataState,
} from './operator-ux';

describe('operator ux copy', () => {
  it('detects technical terms that should not appear in primary operator copy', () => {
    expect(containsTechnicalTerm('APP_READY manifest gate')).toBe(true);
    expect(containsTechnicalTerm('最终验收已通过，可以导出交付包')).toBe(false);
  });

  it('maps delivery readiness to business language', () => {
    expect(deliveryStatusCopy({ appReady: true, manifestDriven: true })).toEqual({
      label: '可以交付',
      tone: 'ready',
      detail: '最终验收和安装包证据已通过。保留交付包、安装包路径和校验码。',
    });
    expect(deliveryStatusCopy({ appReady: false, manifestDriven: false })).toEqual({
      label: '还不能交付',
      tone: 'blocked',
      detail: '还有验收项未通过。先补齐下方最关键缺口，再刷新最终验收。',
    });
  });

  it('chooses a single primary data action', () => {
    expect(primaryActionForDataState({ realReportCount: 0, importedRows: 0, actionableRows: 0 })).toMatchObject({
      label: '获取真实报表',
      route: 'data-collection',
    });
    expect(primaryActionForDataState({ realReportCount: 8, importedRows: 0, actionableRows: 0 })).toMatchObject({
      label: '导入广告指标',
      route: 'data-import-validation',
    });
    expect(primaryActionForDataState({ realReportCount: 8, importedRows: 96, actionableRows: 12 })).toMatchObject({
      label: '复核广告量化',
      route: 'ad-quant',
    });
  });

  it('keeps status labels short', () => {
    expect(operatorStatusLabel('blocked')).toBe('需处理');
    expect(operatorStatusLabel('warning')).toBe('需复核');
    expect(operatorStatusLabel('ready')).toBe('已完成');
  });
});
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\operator-ux.test.ts
```

Expected: fail because `operator-ux.ts` does not exist.

- [ ] **Step 3: Implement the helper module**

Create `operator-ux.ts` with:

```ts
import type { AppRoute, DeliveryReadinessView } from './types';

export type OperatorTone = 'ready' | 'warning' | 'blocked' | 'pending';

export interface OperatorCopy {
  label: string;
  tone: OperatorTone;
  detail: string;
}

export interface PrimaryAction {
  label: string;
  route: AppRoute;
  detail: string;
}

const TECHNICAL_TERMS = [
  /\bAPP_READY\b/i,
  /\bAPP_NEEDS_WORK\b/i,
  /\bREADY\b/,
  /\bmanifest\b/i,
  /\bgate\b/i,
  /\breadback\b/i,
  /\bjson\b/i,
  /\bsha-?256\b/i,
];

export function containsTechnicalTerm(text: string): boolean {
  return TECHNICAL_TERMS.some((pattern) => pattern.test(text));
}

export function operatorStatusLabel(tone: OperatorTone): string {
  if (tone === 'ready') return '已完成';
  if (tone === 'warning') return '需复核';
  if (tone === 'blocked') return '需处理';
  return '待开始';
}

export function deliveryStatusCopy(readiness: Partial<DeliveryReadinessView> | null | undefined): OperatorCopy {
  if (readiness?.appReady && readiness?.manifestDriven) {
    return {
      label: '可以交付',
      tone: 'ready',
      detail: '最终验收和安装包证据已通过。保留交付包、安装包路径和校验码。',
    };
  }
  return {
    label: '还不能交付',
    tone: 'blocked',
    detail: '还有验收项未通过。先补齐下方最关键缺口，再刷新最终验收。',
  };
}

export function primaryActionForDataState(input: {
  realReportCount: number;
  importedRows: number;
  actionableRows: number;
}): PrimaryAction {
  if (input.realReportCount <= 0) {
    return {
      label: '获取真实报表',
      route: 'data-collection',
      detail: '先拿到当前范围的领星广告原始表格。',
    };
  }
  if (input.importedRows <= 0) {
    return {
      label: '导入广告指标',
      route: 'data-import-validation',
      detail: '已有表格，下一步写入本地广告指标。',
    };
  }
  if (input.actionableRows <= 0) {
    return {
      label: '检查量化口径',
      route: 'ad-quant',
      detail: '已有指标，但还没有可生成建议的对象。',
    };
  }
  return {
    label: '复核广告量化',
    route: 'ad-quant',
    detail: '真实数据已具备，先复核风险对象和机会对象。',
  };
}
```

- [ ] **Step 4: Verify tests pass**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\operator-ux.test.ts
```

Expected: 4 tests pass.

---

### Task 2: Add Reusable Operator Task Panel and Progressive Details

**Files:**
- Create: `apps/desktop/src/renderer/components/operator-task-panel.tsx`
- Create: `apps/desktop/src/renderer/components/operator-task-panel.test.tsx`
- Create: `apps/desktop/src/renderer/components/progressive-details.tsx`
- Create: `apps/desktop/src/renderer/components/progressive-details.test.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Write component tests**

Test that the task panel renders one primary button and secondary details are separate:

```tsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OperatorTaskPanel } from './operator-task-panel';
import { ProgressiveDetails } from './progressive-details';

describe('OperatorTaskPanel', () => {
  it('renders exactly one primary action', () => {
    render(
      <OperatorTaskPanel
        eyebrow="今日主任务"
        title="先获取真实报表"
        detail="当前范围还没有可分析的广告数据。"
        primaryAction={{ label: '去数据采集', onClick: vi.fn() }}
        secondaryActions={[{ label: '查看说明', onClick: vi.fn() }]}
      />,
    );

    expect(screen.getByRole('button', { name: '去数据采集' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});

describe('ProgressiveDetails', () => {
  it('keeps technical details collapsed by default', async () => {
    render(
      <ProgressiveDetails title="技术细节">
        <p>manifest gate json</p>
      </ProgressiveDetails>,
    );

    expect(screen.queryByText('manifest gate json')).not.toBeVisible();
    await userEvent.click(screen.getByText('技术细节'));
    expect(screen.getByText('manifest gate json')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\components\operator-task-panel.test.tsx apps\desktop\src\renderer\components\progressive-details.test.tsx
```

Expected: fail because components do not exist.

- [ ] **Step 3: Implement `OperatorTaskPanel`**

Create:

```tsx
import React from 'react';

export interface OperatorTaskAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function OperatorTaskPanel({
  eyebrow,
  title,
  detail,
  primaryAction,
  secondaryActions = [],
  children,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  primaryAction: OperatorTaskAction;
  secondaryActions?: OperatorTaskAction[];
  children?: React.ReactNode;
}) {
  return (
    <section className="operator-task-panel">
      <div className="operator-task-main">
        {eyebrow && <span>{eyebrow}</span>}
        <strong>{title}</strong>
        {detail && <p>{detail}</p>}
        {children}
      </div>
      <div className="operator-task-actions">
        <button className="primary-button" disabled={primaryAction.disabled} onClick={primaryAction.onClick} type="button">
          {primaryAction.label}
        </button>
        {secondaryActions.map((action) => (
          <button className="secondary-button" disabled={action.disabled} key={action.label} onClick={action.onClick} type="button">
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Implement `ProgressiveDetails`**

Create:

```tsx
import React from 'react';

export function ProgressiveDetails({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="progressive-details" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="progressive-details-body">{children}</div>
    </details>
  );
}
```

- [ ] **Step 5: Add styles**

Append focused CSS:

```css
.operator-task-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: #fff;
  padding: 16px;
  box-shadow: var(--shadow-card);
}

.operator-task-main span {
  display: block;
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}

.operator-task-main strong {
  display: block;
  margin-top: 4px;
  font-size: 22px;
  line-height: 1.2;
}

.operator-task-main p {
  margin: 6px 0 0;
  color: #33465c;
  line-height: 1.45;
}

.operator-task-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.progressive-details {
  border: 1px solid var(--line-soft);
  border-radius: var(--radius);
  background: #fff;
}

.progressive-details summary {
  cursor: pointer;
  padding: 9px 12px;
  color: #163252;
  font-size: 13px;
  font-weight: 800;
}

.progressive-details-body {
  border-top: 1px solid var(--line-soft);
  padding: 12px;
}
```

- [ ] **Step 6: Verify**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\components\operator-task-panel.test.tsx apps\desktop\src\renderer\components\progressive-details.test.tsx
```

Expected: tests pass.

---

### Task 3: Compact the Global Scope Bar

**Files:**
- Modify: `apps/desktop/src/renderer/components/scope-bar.tsx`
- Modify: `apps/desktop/src/renderer/components/scope-bar.test.ts`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Add tests for compact facts**

Extend `scope-bar.test.ts` to assert the compact summary stays short:

```ts
import { buildScopeSummaryFacts } from './scope-bar';

it('keeps the scope summary to four compact facts', () => {
  const facts = buildScopeSummaryFacts({
    batchId: 'batch_20260612020905629_gkchz1',
    batchModeLabel: '自动使用当前范围最新完整批次',
    reportCoverage: '8/8 类真实报表',
    importedRows: '2416 行',
    asin: 'B0TESTASIN',
  });

  expect(facts.map((fact) => fact.label)).toEqual(['批次', '报表', '指标', 'ASIN']);
  expect(facts).toHaveLength(4);
});
```

- [ ] **Step 2: Update rendering**

Keep only this visible in the default bar:
- date range/store/site/USD
- batch select
- four compact fact chips
- `编辑范围`

Move scope explanation, batch helper text, and persistence errors into `ProgressiveDetails` or a single short warning line.

- [ ] **Step 3: Verify**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\components\scope-bar.test.ts
```

Expected: all scope tests pass.

---

### Task 4: Simplify Dashboard to One Primary Task

**Files:**
- Modify: `apps/desktop/src/renderer/pages/dashboard-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/dashboard-page.test.ts`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Add tests for dashboard first action**

Add tests around existing dashboard helpers:

```ts
import {
  dashboardDataActionQueueBlocker,
  dashboardTaskEntryStatus,
  dashboardVisibleDeliveryItems,
} from './dashboard-page';

it('dashboard first task prioritizes missing reports before delivery details', () => {
  expect(dashboardTaskEntryStatus({
    canGenerateFormalRecommendations: false,
    hasRealFiles: false,
    realReportCount: 0,
    importedRows: 0,
  })).toBe('不可分析：缺真实报表和入库指标');

  expect(dashboardDataActionQueueBlocker({
    canGenerateFormalRecommendations: false,
    hasRealFiles: false,
    hasMetrics: false,
    realReportCount: 0,
  })?.title).toBe('补齐真实报表');
});

it('dashboard only exposes the top three delivery gaps', () => {
  const items = [
    { key: 'data', tone: 'ready' },
    { key: 'aiEvidence', tone: 'blocked' },
    { key: 'businessContext', tone: 'warning' },
    { key: 'listing', tone: 'blocked' },
  ] as any;
  expect(dashboardVisibleDeliveryItems(items).map((item) => item.key)).toEqual(['aiEvidence', 'businessContext', 'listing']);
});
```

- [ ] **Step 2: Replace first viewport layout**

Use `OperatorTaskPanel` as the first panel after `PageHeader`:
- Title from `taskEntryStatus`
- Detail from `dashboardDataGateDetail`
- Primary action routes to `taskEntryRoute`
- One secondary action only when useful, e.g. "查看文件路径" or "查看交付缺口"

- [ ] **Step 3: Demote duplicated panels**

Collapse or move down:
- `交付状态矩阵`
- `行动队列`
- `最近证据/文件路径入口`

Keep `数据健康` as compact four metrics, but do not duplicate next-step text already shown in the task panel.

- [ ] **Step 4: Verify**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\pages\dashboard-page.test.ts
```

Expected: tests pass.

---

### Task 5: Make Data Collection and Import Pages Task-First

**Files:**
- Modify: `apps/desktop/src/renderer/pages/data-collection-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/data-import-validation-page.tsx`
- Modify: existing tests for those pages if present
- Modify: `scripts/smoke-business-ui-data-pipeline.js`

- [ ] **Step 1: Reduce first-viewport panels**

Data collection first viewport should show:
- one summary: report coverage and imported row count
- one primary action: `重新获取完整 8 类报表` when incomplete, or `进入广告量化` when complete
- one secondary action: `导入本地报表` or `打开报表目录`

- [ ] **Step 2: Collapse file/path/audit sections**

Move these behind `ProgressiveDetails`:
- `文件位置与用途`
- `真实原始报表文件`
- `验收审计/技术细节`

Keep one visible path card only: "真实报表目录".

- [ ] **Step 3: Keep the 8-report chooser but reduce copy**

Change action button visible text to:
- `下载已创建`
- `重建已选`
- `重建全部 8 类`
- `导入本地`

Keep detailed explanation in small text under the group or tooltip-level copy.

- [ ] **Step 4: Update smoke selectors**

In `scripts/smoke-business-ui-data-pipeline.js`, update assertions to find:
- `重新获取完整 8 类报表`
- `打开报表目录`
- collapsed `技术细节`

- [ ] **Step 5: Verify**

Run:

```powershell
pnpm run smoke:business-ui-data-pipeline
```

Expected: smoke passes and screenshots show a shorter first viewport.

---

### Task 6: Simplify Recommendations and Approval Decision Flow

**Files:**
- Modify: `apps/desktop/src/renderer/pages/recommendations-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/approval-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/recommendations-page.test.ts`
- Modify: `scripts/smoke-business-ui-ad-execution.js`

- [ ] **Step 1: Add tests for action-state copy**

Use existing `recommendationWorkflowActionState` tests or add:

```ts
import { recommendationWorkflowActionState } from './recommendations-page';

it('uses business labels when recommendations are blocked by evidence', () => {
  expect(recommendationWorkflowActionState({
    recommendationCount: 2,
    formalApprovalCount: 0,
    manualReviewCount: 1,
    evidenceBlockedCount: 1,
  })).toEqual({
    approvalDisabled: true,
    readbackDisabled: true,
    approvalLabel: '先处理复核/证据',
    readbackLabel: '等待可审批建议',
  });
});
```

- [ ] **Step 2: Recommendations page first viewport**

Show:
- "可审批 / 需复核 / 缺证据" counts
- one primary action: generate suggestions, go approval, or fix evidence
- hide AI evidence detail behind `ProgressiveDetails`

- [ ] **Step 3: Approval page first decision**

When a row is selected, show a compact decision banner:
- `可以批准`
- `不能普通批准`
- `需要复核`

Put full AI/规则 evidence, source files, thresholds, and source rows below the approval decision or inside details.

- [ ] **Step 4: Verify**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\pages\recommendations-page.test.ts apps\desktop\src\renderer\pages\approval-page.test.ts
pnpm run smoke:business-ui-ad-execution
```

Expected: unit tests and ad-execution smoke pass.

---

### Task 7: Convert Execution Readback to a Wizard

**Files:**
- Create: `apps/desktop/src/renderer/readback-wizard.ts`
- Create: `apps/desktop/src/renderer/readback-wizard.test.ts`
- Modify: `apps/desktop/src/renderer/pages/readback-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/readback-page.test.tsx`
- Modify: `scripts/smoke-business-ui-ad-execution.js`

- [ ] **Step 1: Add wizard logic tests**

Create tests:

```ts
import { describe, expect, it } from 'vitest';
import { readbackWizardSteps, firstIncompleteReadbackStep } from './readback-wizard';

describe('readback wizard', () => {
  it('routes missing target fields to the object/source step', () => {
    const missing = ['店铺', 'ASIN', '来源文件'];
    expect(firstIncompleteReadbackStep(missing)).toBe('target-source');
  });

  it('routes screenshot gaps to the evidence step', () => {
    const missing = ['执行前截图', '执行后截图', '回读证据'];
    expect(firstIncompleteReadbackStep(missing)).toBe('evidence');
  });

  it('has four operator-facing steps', () => {
    expect(readbackWizardSteps.map((step) => step.id)).toEqual([
      'target-source',
      'approval',
      'evidence',
      'verify-export',
    ]);
  });
});
```

- [ ] **Step 2: Implement wizard module**

Create:

```ts
export type ReadbackWizardStepId = 'target-source' | 'approval' | 'evidence' | 'verify-export';

export const readbackWizardSteps: Array<{ id: ReadbackWizardStepId; title: string; labels: string[] }> = [
  {
    id: 'target-source',
    title: '1. 确认动作和来源',
    labels: ['店铺', '站点', 'ASIN', '广告活动', '广告组', '对象类型', '对象名称', '动作类型', '来源当前值', '来源建议值', '来源批次', '指标日期', '来源行号', '推荐来源文件'],
  },
  {
    id: 'approval',
    title: '2. 填写审批允许',
    labels: ['审批人', '审批凭证', '审批时间', '审批人确认范围', '外部审批允许', '低风险策略允许'],
  },
  {
    id: 'evidence',
    title: '3. 补执行前后和回读',
    labels: ['执行人', '执行编号', '执行时间', '执行前值', '执行前时间', '执行后值', '执行后时间', '回读值', '回读时间', '执行前截图', '执行后截图', '回读证据', '现场行证明'],
  },
  {
    id: 'verify-export',
    title: '4. 校验并导出证据',
    labels: ['执行成功确认', '执行核验', '回读核验', '执行前值和执行后值不能相同', '回读值必须等于执行后值', '时间顺序必须为审批≤执行前≤执行动作≤执行后≤回读'],
  },
];

export function firstIncompleteReadbackStep(missing: string[]): ReadbackWizardStepId {
  for (const step of readbackWizardSteps) {
    if (step.labels.some((label) => missing.includes(label))) return step.id;
  }
  return 'verify-export';
}
```

- [ ] **Step 3: Refactor page rendering**

In `readback-page.tsx`:
- Keep `requiredMissing()` unchanged.
- Add `activeStep` state initialized from `firstIncompleteReadbackStep(missing)`.
- Render step tabs at the top.
- Render only fields for the active step.
- Keep generated command/work-package details behind `ProgressiveDetails`.

- [ ] **Step 4: Preserve safety copy**

Keep visible:
- `人工执行证据，不批量写入`
- "执行前、执行后、回读截图不能复用"
- "回读值必须等于执行后值"

Do not show all missing fields at once; show missing count per wizard step.

- [ ] **Step 5: Verify**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\readback-wizard.test.ts apps\desktop\src\renderer\pages\readback-page.test.tsx
pnpm run smoke:business-ui-ad-execution
```

Expected: tests and smoke pass. Screenshot should show a wizard, not a full field wall.

---

### Task 8: Reframe Delivery Page as User Delivery Summary

**Files:**
- Modify: `apps/desktop/src/renderer/pages/delivery-page.tsx`
- Modify: `apps/desktop/src/renderer/delivery-readiness-matrix.ts`
- Modify: `apps/desktop/src/renderer/delivery-readiness-matrix.test.ts`
- Modify: `scripts/smoke-business-ui-settings-delivery.js`

- [ ] **Step 1: Test delivery matrix copy**

Add/adjust tests so the matrix uses business labels:

```ts
import { buildDeliveryReadinessMatrix } from './delivery-readiness-matrix';

it('summarizes delivery readiness without raw app status codes', () => {
  const matrix = buildDeliveryReadinessMatrix({
    realReportCount: 8,
    importedRows: 96,
    actionableRows: 12,
    aiAvailable: true,
    aiSuccessCount: 1,
    operationEventCount: 1,
    productContextCount: 1,
    listingReadReady: true,
    listingDraftReady: true,
    pendingRecommendationCount: 1,
    approvedRecommendationCount: 1,
    readbackVerifiedCount: 1,
    installerAvailable: true,
    deliveryManifestReady: true,
  });

  expect(matrix.headline).toBe('可交付证据闭环已完成');
  expect(matrix.headline).not.toMatch(/APP_|READY|manifest|gate/i);
});
```

- [ ] **Step 2: Delivery first viewport**

Show:
- delivery status: `可以交付` or `还不能交付`
- one primary action: `导出交付包` when ready, otherwise primary missing action
- package path/SHA summary only if ready
- top three missing items when not ready

- [ ] **Step 3: Move evidence internals**

Collapse by default:
- final evidence list
- gate list
- technical details
- JSON/manifest paths

Keep buttons for opening folders, but label them as "打开交付包", "打开证据目录", "打开安装包目录".

- [ ] **Step 4: Verify**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\delivery-readiness-matrix.test.ts
pnpm run smoke:business-ui-settings-delivery
```

Expected: tests pass; delivery smoke still finds final readiness refresh, bundle export, readback package actions, and technical detail disclosure.

---

### Task 9: Make Settings Normal-First, Advanced-Second

**Files:**
- Modify: `apps/desktop/src/renderer/pages/settings-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/settings-page.test.ts`
- Modify: `scripts/smoke-business-ui-settings-delivery.js`

- [ ] **Step 1: Split settings into visible normal sections**

First viewport:
- AI connection status
- API Key/Base URL/Model
- `保存 AI 设置`
- `测试 AI 连接`

Second visible section:
- core rule thresholds
- `保存广告阈值`

- [ ] **Step 2: Collapse advanced sections**

Move these into `ProgressiveDetails`:
- AI 调用审计
- 安全策略
- 本地存储路径
- 诊断工具

- [ ] **Step 3: Verify**

Run:

```powershell
pnpm exec vitest run apps\desktop\src\renderer\pages\settings-page.test.ts
pnpm run smoke:business-ui-settings-delivery
```

Expected: tests and smoke pass. Screenshot should show AI setup and thresholds before diagnostics.

---

### Task 10: Visual Density Pass

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: page files only where class usage is needed

- [ ] **Step 1: Reduce visual noise**

Apply these rules:
- Use red only for non-actionable blockers, not every "needs work" state.
- Use amber for review/attention.
- Use green for completed state, but do not make whole large sections green unless the section is the final positive result.
- Prefer white panels with status chips over full-color panel backgrounds for dense pages.

- [ ] **Step 2: Reduce repeated cards**

For first viewport cards:
- max 3 metric cards unless the page is a table page.
- no nested cards inside cards.
- technical details always collapsed.

- [ ] **Step 3: Verify by screenshots**

Run smoke scripts that produce screenshots:

```powershell
pnpm run smoke:business-ui-current
```

Expected: all smoke scripts pass and first screenshots show less dense first viewports.

---

### Task 11: Final Verification and READY Refresh

**Files:**
- Modify docs only if evidence paths, UX boundaries, or delivery status changed.

- [ ] **Step 1: Run focused renderer tests**

```powershell
pnpm exec vitest run apps\desktop\src\renderer\operator-ux.test.ts apps\desktop\src\renderer\components\operator-task-panel.test.tsx apps\desktop\src\renderer\components\progressive-details.test.tsx apps\desktop\src\renderer\readback-wizard.test.ts apps\desktop\src\renderer\pages\dashboard-page.test.ts apps\desktop\src\renderer\pages\readback-page.test.tsx apps\desktop\src\renderer\delivery-readiness-matrix.test.ts
```

Expected: all selected renderer tests pass.

- [ ] **Step 2: Run desktop typecheck**

```powershell
pnpm --filter @amazon-ai-ops/desktop run typecheck
```

Expected: `tsc --noEmit` passes.

- [ ] **Step 3: Run current UI smoke**

```powershell
pnpm run smoke:business-ui-current
```

Expected: shell, data pipeline, ad execution, keyword/listing, settings/delivery smoke all pass.

- [ ] **Step 4: Run safety checks**

```powershell
pnpm run verify:ad-execution
```

Expected: `AD_EXECUTION_FAIL_CLOSED verified.`

- [ ] **Step 5: Rebuild package if implementation changed shipped UI**

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:win
pnpm run smoke:package-launch
```

Expected: installer and portable launch smoke pass.

- [ ] **Step 6: Refresh final delivery evidence**

Run only after package smoke passes:

```powershell
pnpm run write:v15-evidence-manifest -- --ad-readback output\codex-evidence\real-ad-execution-readback-candidate-rec-4-current-pass.json --out output\codex-evidence\v15-final-readiness-evidence-manifest-20260618170712.json
pnpm run verify:v15-final-readiness -- --evidence-manifest output\codex-evidence\v15-final-readiness-evidence-manifest-20260618170712.json --package-launch-smoke output\codex-evidence\package-launch-smoke-1781772408989.json --out output\codex-evidence\final-readiness-20260618170712.json
pnpm run export:v15-delivery-bundle -- --final-readiness output\codex-evidence\final-readiness-20260618170712.json --data-reconciliation output\codex-evidence\real-lingxing-reconciliation-batch_20260612020905629_gkchz1.json --data-reconciliation-md output\codex-evidence\real-lingxing-reconciliation-batch_20260612020905629_gkchz1.md --out output\delivery-bundles\v15-delivery-bundle-20260618170712-ready
pnpm run verify:v15-ready-safety -- --final-readiness output\codex-evidence\final-readiness-20260618170712.json --bundle-manifest output\delivery-bundles\v15-delivery-bundle-20260618170712-ready\delivery-bundle-manifest.json
```

Expected: READY safety passes.

---

## Acceptance Criteria

- Dashboard first viewport has one dominant primary action.
- Global scope bar is compact by default and does not push the page task too far down.
- Data collection/import first viewport does not show full technical file tables by default.
- Recommendations and approval lead with business decision state, not AI evidence internals.
- Readback page shows a step wizard and does not display the full blank evidence form at once.
- Delivery page starts with a user-facing deliverability answer and top missing actions.
- Settings page starts with AI setup and thresholds; storage/diagnostics are advanced.
- Primary UI does not expose raw `APP_*`, `manifest`, `gate`, command walls, or long JSON/path blocks.
- Evidence paths remain available through secondary details or explicit "open folder/file" actions.
- `verify:ad-execution` still proves fail-closed behavior.
- `smoke:business-ui-current` passes and screenshots show reduced first-viewport density.

## Suggested Commit Slices

1. `feat: add operator ux helper components`
2. `feat: simplify dashboard and scope bar`
3. `feat: streamline data collection ux`
4. `feat: streamline recommendation approval ux`
5. `feat: convert readback to wizard`
6. `feat: simplify delivery and settings ux`
7. `test: refresh business ui smoke coverage`
8. `docs: sync ux readiness handoff`

## Self-Review

- Spec coverage: Covers all P0/P1 UX issues from the brainstorming pass: main-window overload, action focus, scope bar, readback wizard, delivery page, settings, AI/evidence verbosity, and path visibility.
- Placeholder scan: No `TBD`, `TODO`, or undefined "handle later" tasks. Each implementation task lists files and exact verification commands.
- Type consistency: New helpers use existing `AppRoute` and `DeliveryReadinessView` types. Readback wizard uses existing `requiredMissing()` output labels.
- Scope check: This is one focused UX simplification plan for the Windows desktop renderer. It does not change backend contracts or ad execution semantics.
