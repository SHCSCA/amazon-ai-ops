# Amazon AI Ops renderer page dependency trees

Scope: current production renderer under `apps/desktop/src/renderer`. The application is a Vite + React SPA inside Electron, so there are no URL route files. `App.tsx` maps the active `NavigationIntent` to business page components through `BusinessRoutePage`. External packages (`react`, `zustand`, `@tanstack/react-virtual`, and workspace packages such as `@amazon-ai-ops/rules-engine`) are intentionally not expanded; every local renderer import is traced recursively.

## Common renderer entry and shell context

Every page is mounted through this common path and should include these files as Superdesign context in addition to its page-specific tree:

- `apps/desktop/src/renderer/index.html`
- `apps/desktop/src/renderer/main.tsx`
  - `apps/desktop/src/renderer/App.tsx`
    - `apps/desktop/src/renderer/components/app-shell.tsx`
      - `apps/desktop/src/renderer/navigation.ts`
        - `apps/desktop/src/renderer/types.ts`
      - `apps/desktop/src/renderer/types.ts`
      - `apps/desktop/src/renderer/workflow-state.ts`
        - `apps/desktop/src/renderer/navigation.ts`
        - `apps/desktop/src/renderer/report-coverage.ts`
    - `apps/desktop/src/renderer/components/scope-bar.tsx`
      - `apps/desktop/src/renderer/components/progressive-details.tsx`
      - `apps/desktop/src/renderer/scope-store.ts`
        - `apps/desktop/src/renderer/types.ts`
      - `apps/desktop/src/renderer/types.ts`
      - `apps/desktop/src/renderer/user-facing-error.ts`
    - `apps/desktop/src/renderer/components/workspace/index.ts`
      - `apps/desktop/src/renderer/components/workspace/action-menu.tsx`
      - `apps/desktop/src/renderer/components/workspace/page-frame.tsx`
      - `apps/desktop/src/renderer/components/workspace/priority-data-table.tsx`
      - `apps/desktop/src/renderer/components/workspace/responsive-inspector.tsx`
        - `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts`
      - `apps/desktop/src/renderer/components/workspace/summary-strip.tsx`
        - `apps/desktop/src/renderer/components/workspace/types.ts`
      - `apps/desktop/src/renderer/components/workspace/task-banner.tsx`
        - `apps/desktop/src/renderer/components/workspace/types.ts`
      - `apps/desktop/src/renderer/components/workspace/types.ts`
      - `apps/desktop/src/renderer/components/workspace/workbench-panel.tsx`
      - `apps/desktop/src/renderer/components/workspace/workspace-state.tsx`
        - `apps/desktop/src/renderer/components/workspace/types.ts`
      - `apps/desktop/src/renderer/components/workspace/workspace-subview-shell.tsx`
    - `apps/desktop/src/renderer/navigation.ts`
    - `apps/desktop/src/renderer/scope-store.ts`
    - `apps/desktop/src/renderer/workflow-state.ts`
      - `apps/desktop/src/renderer/navigation.ts`
      - `apps/desktop/src/renderer/report-coverage.ts`
    - `apps/desktop/src/renderer/workflow-invalidation.ts`
    - `apps/desktop/src/renderer/user-facing-error.ts`
    - `apps/desktop/src/renderer/dev-preview-api.ts`
    - `apps/desktop/src/renderer/pages/readback-workspace-model.ts`
    - `apps/desktop/src/renderer/types.ts`
    - `apps/desktop/src/shared/login-contract.ts`
    - `apps/desktop/src/renderer/styles.css`
    - `apps/desktop/src/renderer/styles/tokens.css`
    - `apps/desktop/src/renderer/styles/foundations.css`
    - `apps/desktop/src/renderer/styles/shell.css`
    - `apps/desktop/src/renderer/styles/workspace.css`
    - `apps/desktop/src/renderer/styles/priority-table.css`
    - `apps/desktop/src/renderer/styles/decisions.css`
    - `apps/desktop/src/renderer/styles/object-workspace.css`
    - `apps/desktop/src/renderer/styles/readback.css`
    - `apps/desktop/src/renderer/styles/states-motion.css`

Repeated files inside a page tree are marked `[already expanded above in this page tree]`; this means the file remains required context, but its children are not duplicated.

## Today / 今日概览

Entry: `apps/desktop/src/renderer/pages/dashboard-page.tsx`

Navigation intent: `{ workspace: "today", subview: "overview" }`

Dependencies:

- `apps/desktop/src/renderer/pages/dashboard-page.tsx`
  - `apps/desktop/src/renderer/components/business-data.tsx`
    - `apps/desktop/src/renderer/scope-store.ts`
      - `apps/desktop/src/renderer/types.ts`
    - `apps/desktop/src/renderer/user-facing-error.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/components/progressive-details.tsx`
  - `apps/desktop/src/renderer/components/ui.tsx`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/components/workspace/index.ts`
    - `apps/desktop/src/renderer/components/workspace/action-menu.tsx`
    - `apps/desktop/src/renderer/components/workspace/page-frame.tsx`
    - `apps/desktop/src/renderer/components/workspace/priority-data-table.tsx`
    - `apps/desktop/src/renderer/components/workspace/responsive-inspector.tsx`
      - `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts`
    - `apps/desktop/src/renderer/components/workspace/summary-strip.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts`
    - `apps/desktop/src/renderer/components/workspace/task-banner.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workbench-panel.tsx`
    - `apps/desktop/src/renderer/components/workspace/workspace-state.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workspace-subview-shell.tsx`
  - `apps/desktop/src/renderer/delivery-readiness-matrix.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/report-coverage.ts`
  - `apps/desktop/src/renderer/formatters.ts`
  - `apps/desktop/src/renderer/ai-call-diagnostics.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/report-coverage.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/navigation.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/workflow-state.ts`
    - `apps/desktop/src/renderer/navigation.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/report-coverage.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/user-facing-error.ts` [already expanded above in this page tree]

## Product / 产品工作台

Entry: `apps/desktop/src/renderer/pages/product-management-page.tsx`

Navigation intent: `{ workspace: "product", subview: "products" }`

Dependencies:

- `apps/desktop/src/renderer/pages/product-management-page.tsx`
  - `apps/desktop/src/renderer/components/business-data.tsx`
    - `apps/desktop/src/renderer/scope-store.ts`
      - `apps/desktop/src/renderer/types.ts`
    - `apps/desktop/src/renderer/user-facing-error.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/components/ui.tsx`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/components/virtual-data-table.tsx`
  - `apps/desktop/src/renderer/components/workspace/index.ts`
    - `apps/desktop/src/renderer/components/workspace/action-menu.tsx`
    - `apps/desktop/src/renderer/components/workspace/page-frame.tsx`
    - `apps/desktop/src/renderer/components/workspace/priority-data-table.tsx`
    - `apps/desktop/src/renderer/components/workspace/responsive-inspector.tsx`
      - `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts`
    - `apps/desktop/src/renderer/components/workspace/summary-strip.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts`
    - `apps/desktop/src/renderer/components/workspace/task-banner.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workbench-panel.tsx`
    - `apps/desktop/src/renderer/components/workspace/workspace-state.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workspace-subview-shell.tsx`
  - `apps/desktop/src/renderer/formatters.ts`
  - `apps/desktop/src/renderer/report-coverage.ts`
  - `apps/desktop/src/renderer/scope-store.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/pages/product-config-page.tsx`
    - `apps/desktop/src/renderer/components/business-data.tsx` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/ui.tsx` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/index.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/page-header-copy.ts`
    - `apps/desktop/src/renderer/formatters.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/scope-store.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/user-facing-error.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/product-management.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/user-facing-error.ts` [already expanded above in this page tree]

## Product / 经营目标

Entry: `apps/desktop/src/renderer/pages/product-config-page.tsx`

Navigation intent: `{ workspace: "product", subview: "targets" }`

Dependencies:

- `apps/desktop/src/renderer/pages/product-config-page.tsx`
  - `apps/desktop/src/renderer/components/business-data.tsx`
    - `apps/desktop/src/renderer/scope-store.ts`
      - `apps/desktop/src/renderer/types.ts`
    - `apps/desktop/src/renderer/user-facing-error.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/components/ui.tsx`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/components/workspace/index.ts`
    - `apps/desktop/src/renderer/components/workspace/action-menu.tsx`
    - `apps/desktop/src/renderer/components/workspace/page-frame.tsx`
    - `apps/desktop/src/renderer/components/workspace/priority-data-table.tsx`
    - `apps/desktop/src/renderer/components/workspace/responsive-inspector.tsx`
      - `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts`
    - `apps/desktop/src/renderer/components/workspace/summary-strip.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts`
    - `apps/desktop/src/renderer/components/workspace/task-banner.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workbench-panel.tsx`
    - `apps/desktop/src/renderer/components/workspace/workspace-state.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workspace-subview-shell.tsx`
  - `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/page-header-copy.ts`
  - `apps/desktop/src/renderer/formatters.ts`
  - `apps/desktop/src/renderer/scope-store.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/user-facing-error.ts` [already expanded above in this page tree]

## Data / 报表采集

Entry: `apps/desktop/src/renderer/pages/data-collection-page.tsx`

Navigation intent: `{ workspace: "data-preparation", subview: "reports" }`

Dependencies:

- `apps/desktop/src/renderer/pages/data-collection-page.tsx`
  - `apps/desktop/src/renderer/components/business-data.tsx`
    - `apps/desktop/src/renderer/scope-store.ts`
      - `apps/desktop/src/renderer/types.ts`
    - `apps/desktop/src/renderer/user-facing-error.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/components/progressive-details.tsx`
  - `apps/desktop/src/renderer/components/ui.tsx`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/components/workspace/index.ts`
    - `apps/desktop/src/renderer/components/workspace/action-menu.tsx`
    - `apps/desktop/src/renderer/components/workspace/page-frame.tsx`
    - `apps/desktop/src/renderer/components/workspace/priority-data-table.tsx`
    - `apps/desktop/src/renderer/components/workspace/responsive-inspector.tsx`
      - `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts`
    - `apps/desktop/src/renderer/components/workspace/summary-strip.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts`
    - `apps/desktop/src/renderer/components/workspace/task-banner.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workbench-panel.tsx`
    - `apps/desktop/src/renderer/components/workspace/workspace-state.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workspace-subview-shell.tsx`
  - `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/page-header-copy.ts`
  - `apps/desktop/src/renderer/collection-action-summary.ts`
  - `apps/desktop/src/renderer/data-readiness-ledger.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/formatters.ts`
  - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/user-facing-error.ts` [already expanded above in this page tree]

## Diagnosis / 量化诊断

Entry: `apps/desktop/src/renderer/pages/ad-quant-page.tsx`

Navigation intent: `{ workspace: "diagnosis", subview: "analysis" }`

Dependencies:

- `apps/desktop/src/renderer/pages/ad-quant-page.tsx`
  - `apps/desktop/src/renderer/components/business-data.tsx`
    - `apps/desktop/src/renderer/scope-store.ts`
      - `apps/desktop/src/renderer/types.ts`
    - `apps/desktop/src/renderer/user-facing-error.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/components/progressive-details.tsx`
  - `apps/desktop/src/renderer/components/tag-metric-group.tsx`
  - `apps/desktop/src/renderer/components/ui.tsx`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/components/virtual-data-table.tsx`
  - `apps/desktop/src/renderer/components/workspace/index.ts`
    - `apps/desktop/src/renderer/components/workspace/action-menu.tsx`
    - `apps/desktop/src/renderer/components/workspace/page-frame.tsx`
    - `apps/desktop/src/renderer/components/workspace/priority-data-table.tsx`
    - `apps/desktop/src/renderer/components/workspace/responsive-inspector.tsx`
      - `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts`
    - `apps/desktop/src/renderer/components/workspace/summary-strip.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts`
    - `apps/desktop/src/renderer/components/workspace/task-banner.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workbench-panel.tsx`
    - `apps/desktop/src/renderer/components/workspace/workspace-state.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workspace-subview-shell.tsx`
  - `apps/desktop/src/renderer/page-header-copy.ts`
  - `apps/desktop/src/renderer/ad-quant-product-groups.ts`
  - `apps/desktop/src/renderer/evidence-display.ts`
    - `apps/desktop/src/renderer/formatters.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/formatters.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/ai-call-diagnostics.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/recommendation-readiness.ts`
  - `apps/desktop/src/renderer/report-coverage.ts`
  - `apps/desktop/src/renderer/product-context.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/scope-store.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/user-facing-error.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/workflow-invalidation.ts`
  - `apps/desktop/src/renderer/pages/diagnosis-workspace-model.ts`

## Decisions / 建议、审批、已决策

Entry: `apps/desktop/src/renderer/pages/decisions-page.tsx`

Navigation intents: `{ workspace: "decisions", subview: "recommendations" | "approval" | "decided" }`

Dependencies:

- `apps/desktop/src/renderer/pages/decisions-page.tsx`
  - `apps/desktop/src/renderer/components/business-data.tsx`
    - `apps/desktop/src/renderer/scope-store.ts`
      - `apps/desktop/src/renderer/types.ts`
    - `apps/desktop/src/renderer/user-facing-error.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/components/workspace/index.ts`
    - `apps/desktop/src/renderer/components/workspace/action-menu.tsx`
    - `apps/desktop/src/renderer/components/workspace/page-frame.tsx`
    - `apps/desktop/src/renderer/components/workspace/priority-data-table.tsx`
    - `apps/desktop/src/renderer/components/workspace/responsive-inspector.tsx`
      - `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts`
    - `apps/desktop/src/renderer/components/workspace/summary-strip.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts`
    - `apps/desktop/src/renderer/components/workspace/task-banner.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workbench-panel.tsx`
    - `apps/desktop/src/renderer/components/workspace/workspace-state.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workspace-subview-shell.tsx`
  - `apps/desktop/src/renderer/components/workspace/responsive-inspector.tsx` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/evidence-display.ts`
    - `apps/desktop/src/renderer/formatters.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/formatters.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/recommendation-readiness.ts`
  - `apps/desktop/src/renderer/report-coverage.ts`
  - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/user-facing-error.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/pages/approval-page.tsx`
    - `apps/desktop/src/renderer/components/business-data.tsx` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/progressive-details.tsx`
    - `apps/desktop/src/renderer/components/ui.tsx`
      - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/page-header-copy.ts`
    - `apps/desktop/src/renderer/evidence-display.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/formatters.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/user-facing-error.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/workflow-invalidation.ts`
  - `apps/desktop/src/renderer/pages/recommendations-page.tsx`
    - `apps/desktop/src/renderer/components/business-data.tsx` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/progressive-details.tsx` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/ui.tsx` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/page-header-copy.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/evidence-display.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/formatters.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/recommendation-readiness.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/report-coverage.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/product-context.ts`
      - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/user-facing-error.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/workflow-invalidation.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/pages/approval-page.tsx` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/pages/decisions-workspace-model.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]

## Readback / 执行回读

Entry: `apps/desktop/src/renderer/pages/readback-page.tsx`

Navigation intent: `{ workspace: "readback", subview: "evidence" }`

Dependencies:

- `apps/desktop/src/renderer/pages/readback-page.tsx`
  - `apps/desktop/src/renderer/components/business-data.tsx`
    - `apps/desktop/src/renderer/scope-store.ts`
      - `apps/desktop/src/renderer/types.ts`
    - `apps/desktop/src/renderer/user-facing-error.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/components/ui.tsx`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/components/workspace/index.ts`
    - `apps/desktop/src/renderer/components/workspace/action-menu.tsx`
    - `apps/desktop/src/renderer/components/workspace/page-frame.tsx`
    - `apps/desktop/src/renderer/components/workspace/priority-data-table.tsx`
    - `apps/desktop/src/renderer/components/workspace/responsive-inspector.tsx`
      - `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts`
    - `apps/desktop/src/renderer/components/workspace/summary-strip.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts`
    - `apps/desktop/src/renderer/components/workspace/task-banner.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workbench-panel.tsx`
    - `apps/desktop/src/renderer/components/workspace/workspace-state.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workspace-subview-shell.tsx`
  - `apps/desktop/src/renderer/readback-repair-intent.ts`
    - `apps/desktop/src/renderer/readback-wizard.ts`
  - `apps/desktop/src/renderer/readback-wizard.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/pages/readback-workspace-model.ts`
  - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/user-facing-error.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/workflow-invalidation.ts`

## Product / 运营事件标记

Entry: `apps/desktop/src/renderer/pages/operation-events-page.tsx`

Navigation intent: `{ workspace: "product", subview: "events" }`

Dependencies:

- `apps/desktop/src/renderer/pages/operation-events-page.tsx`
  - `apps/desktop/src/renderer/scope-store.ts`
    - `apps/desktop/src/renderer/types.ts`
  - `apps/desktop/src/renderer/user-facing-error.ts`
  - `apps/desktop/src/renderer/components/progressive-details.tsx`
  - `apps/desktop/src/renderer/components/ui.tsx`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/components/workspace/index.ts`
    - `apps/desktop/src/renderer/components/workspace/action-menu.tsx`
    - `apps/desktop/src/renderer/components/workspace/page-frame.tsx`
    - `apps/desktop/src/renderer/components/workspace/priority-data-table.tsx`
    - `apps/desktop/src/renderer/components/workspace/responsive-inspector.tsx`
      - `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts`
    - `apps/desktop/src/renderer/components/workspace/summary-strip.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts`
    - `apps/desktop/src/renderer/components/workspace/task-banner.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workbench-panel.tsx`
    - `apps/desktop/src/renderer/components/workspace/workspace-state.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workspace-subview-shell.tsx`
  - `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/page-header-copy.ts`
  - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]

## Growth / Listing 优化

Entry: `apps/desktop/src/renderer/pages/listing-optimization-page.tsx`

Navigation intent: `{ workspace: "growth", subview: "listing" }`

Dependencies:

- `apps/desktop/src/renderer/pages/listing-optimization-page.tsx`
  - `apps/desktop/src/renderer/components/business-data.tsx`
    - `apps/desktop/src/renderer/scope-store.ts`
      - `apps/desktop/src/renderer/types.ts`
    - `apps/desktop/src/renderer/user-facing-error.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/components/progressive-details.tsx`
  - `apps/desktop/src/renderer/components/ui.tsx`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/components/workspace/index.ts`
    - `apps/desktop/src/renderer/components/workspace/action-menu.tsx`
    - `apps/desktop/src/renderer/components/workspace/page-frame.tsx`
    - `apps/desktop/src/renderer/components/workspace/priority-data-table.tsx`
    - `apps/desktop/src/renderer/components/workspace/responsive-inspector.tsx`
      - `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts`
    - `apps/desktop/src/renderer/components/workspace/summary-strip.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts`
    - `apps/desktop/src/renderer/components/workspace/task-banner.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workbench-panel.tsx`
    - `apps/desktop/src/renderer/components/workspace/workspace-state.tsx`
      - `apps/desktop/src/renderer/components/workspace/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/components/workspace/workspace-subview-shell.tsx`
  - `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/page-header-copy.ts`
  - `apps/desktop/src/renderer/listing-workflow-summary.ts`
  - `apps/desktop/src/renderer/report-coverage.ts`
  - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/user-facing-error.ts` [already expanded above in this page tree]

## System / 交付检查

Entry: `apps/desktop/src/renderer/pages/delivery-page.tsx`

Navigation intent: `{ workspace: "system", subview: "delivery" }`

Dependencies:

- `apps/desktop/src/renderer/pages/delivery-page.tsx`
  - `apps/desktop/src/renderer/components/operator-task-panel.tsx`
  - `apps/desktop/src/renderer/components/progressive-details.tsx`
  - `apps/desktop/src/renderer/components/ui.tsx`
    - `apps/desktop/src/renderer/types.ts`
  - `apps/desktop/src/renderer/page-header-copy.ts`
  - `apps/desktop/src/renderer/delivery-readiness-matrix.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
    - `apps/desktop/src/renderer/report-coverage.ts`
  - `apps/desktop/src/renderer/readback-repair-intent.ts`
    - `apps/desktop/src/renderer/readback-wizard.ts`
  - `apps/desktop/src/renderer/scope-store.ts`
    - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/types.ts` [already expanded above in this page tree]
  - `apps/desktop/src/renderer/user-facing-error.ts`
  - `apps/desktop/src/renderer/workflow-invalidation.ts`

## Design-context rule

For any Superdesign draft of a page above, pass every file in the common renderer entry/shell list, every file in that page's dependency tree, and the complete theme files captured in `theme.md`. The current `App.tsx` also statically imports sibling pages; those sibling route branches are not UI dependencies of the selected page and are intentionally excluded from the page-specific trees.
