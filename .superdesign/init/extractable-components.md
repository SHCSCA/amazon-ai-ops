# Extractable Superdesign Components

This catalog is derived from the current React renderer under `apps/desktop/src/renderer`. It lists stable visual patterns that are suitable for reusable Superdesign `DraftComponent` entities. Props are deliberately limited to page-changing state, navigation, visibility and dynamic counts; product wording, class contracts and visual affordances stay hardcoded.

## Layout Components

### Sidebar
- Source: `apps/desktop/src/renderer/components/app-shell.tsx`
- Category: layout
- Description: Primary Windows desktop navigation grouped into daily operations and system workspaces.
- Extractable props: `activeRoute` (route id), `pendingRoute` (route id or null), `navigationBusy` (boolean), `onNavigate` (navigation action).
- Hardcoded: section labels “运营工作台” and “系统”, ordinal format `01`…, workspace labels/descriptions from `VISIBLE_WORKSPACES`, “转跳中...” feedback, no icon rail, all `app-sidebar`/`nav-*` CSS classes.

### ScopeBar
- Source: `apps/desktop/src/renderer/components/scope-bar.tsx`
- Category: layout
- Description: Persistent operation-scope strip for date range, store, marketplace, ASIN and data batch, with details and editor popovers.
- Extractable props: `detailsOpen` (boolean), `editing` (boolean), `saving` (boolean), `hasWarning` (boolean), `storeName`, `marketplaceCode`, `asin`, `batchId`, `reportCoverage`, `importedRows`.
- Hardcoded: labels “范围”, “范围设置”, “报表文件”, “逐类入库”, “产品”, “追溯批次”; USD currency; 8-report coverage model; editor field labels and validation copy; `scope-*` CSS classes.

### PageFrame
- Source: `apps/desktop/src/renderer/components/workspace/page-frame.tsx`
- Category: layout
- Description: Standard task-first page structure with heading, optional task area, summary strip and workbench content.
- Extractable props: `pageId` (string), `showTask` (boolean), `showSummary` (boolean).
- Hardcoded: semantic `section > header > h1` structure and `workspace-page-frame*` CSS classes; title, description and slot content are authored per draft.

### WorkspaceSubviewShell
- Source: `apps/desktop/src/renderer/components/workspace/workspace-subview-shell.tsx`
- Category: layout
- Description: Workspace identity block and keyboard-operable tab strip for related operational subviews.
- Extractable props: `subview` (active tab id), `ownsPageHeading` (boolean), `showPreviewNotice` (boolean), `onNavigate` (tab navigation).
- Hardcoded: “工作区” eyebrow, horizontal tablist behavior, Home/End/Arrow navigation, one shared tabpanel, `workspace-subview-shell*` CSS classes; tab labels and descriptions stay authored with the component.

### ResponsiveInspector
- Source: `apps/desktop/src/renderer/components/workspace/responsive-inspector.tsx`
- Category: layout
- Description: Object-detail inspector rendered inline at 1400px+ and as a modal drawer below 1400px.
- Extractable props: `open` (boolean), `busy` (boolean), `dismissDisabled` (boolean), `mode` (inline/drawer preview state), `onClose`.
- Hardcoded: 1399px media-query boundary, “关闭” control and accessible name, drawer focus trap/inert background/focus restoration, `responsive-inspector*` CSS classes.

### WorkbenchPanel
- Source: `apps/desktop/src/renderer/components/workspace/workbench-panel.tsx`
- Category: layout
- Description: Named operational panel with title/status, optional toolbar, content and footer regions.
- Extractable props: `showToolbar` (boolean), `showFooter` (boolean), `status` (state node).
- Hardcoded: semantic section/header/footer structure, generated heading IDs, “{title}工具栏” ARIA label, `workbench-panel*` CSS classes.

### TaskBanner
- Source: `apps/desktop/src/renderer/components/workspace/task-banner.tsx`
- Category: layout
- Description: Mission/task-first banner with one primary and up to two secondary actions, status and disabled-reason feedback.
- Extractable props: `compact` (boolean), `tone` (neutral/attention/blocked/confirmed), `status`, `primaryActionBusy`, `secondaryActionBusy`, `actionsDisabled`.
- Hardcoded: default eyebrow “当前主任务”, action group label “首屏任务动作”, maximum two visible secondary actions, “处理中...” fallback, `task-banner*` and `workspace-button*` CSS classes.

### SummaryStrip
- Source: `apps/desktop/src/renderer/components/workspace/summary-strip.tsx`
- Category: layout
- Description: Compact four-fact summary row between task banner and detailed workbench.
- Extractable props: `items` (up to four current values), `toneByItem` (neutral/attention/blocked/confirmed), `ariaLabel`.
- Hardcoded: definition-list markup, four-item maximum, default ARIA label “当前工作摘要”, `summary-strip*` CSS classes.

### OperatorTaskPanel
- Source: `apps/desktop/src/renderer/components/operator-task-panel.tsx`
- Category: layout
- Description: Legacy/shared first-screen task panel with primary and secondary action group busy locking.
- Extractable props: `primaryBusy` (boolean), `secondaryBusy` (boolean), `actionsDisabled` (boolean).
- Hardcoded: action group label “首屏任务动作”, “处理中...” fallback, primary/secondary button class names, generated title/description IDs.

### NextSafeActionHandoff
- Source: `apps/desktop/src/renderer/components/app-shell.tsx`
- Category: layout
- Description: Workflow handoff strip that explains and navigates to the next safe action.
- Extractable props: `blocked` (boolean), `stage` (workflow stage), `actionLabel`, `onNavigate`.
- Hardcoded: heading “下一安全动作”, one primary action, `next-safe-action-*` CSS classes.

## Basic Components

### PageHeader
- Source: `apps/desktop/src/renderer/components/ui.tsx`
- Category: basic
- Description: Semantic page title/description header with task rail and optional primary action.
- Extractable props: `showPrimaryTask` (boolean), `showNextAction` (boolean), `primaryActionBusy` (boolean), `primaryActionDisabled` (boolean).
- Hardcoded: rail labels “当前主任务” and “建议下一步”, generated heading IDs, default `primary-button` class, shared spinner markup.

### Panel
- Source: `apps/desktop/src/renderer/components/ui.tsx`
- Category: basic
- Description: Generic named surface with optional title accessory and semantic tone.
- Extractable props: `tone` (default/warning/blocked/success), `showTitleAccessory` (boolean).
- Hardcoded: `section`/`h3` hierarchy, generated title ID, `ui-panel*` and `panel-title-*` CSS classes.

### StatusPill
- Source: `apps/desktop/src/renderer/components/ui.tsx`
- Category: basic
- Description: Dense semantic state tag supporting passive note or live status behavior.
- Extractable props: `tone` (ready/pending/blocked/warning), `focusable` (boolean), `live` (boolean).
- Hardcoded: status role rules, “状态标签” ARIA role description, `status-pill status-*` CSS classes; visible label is authored per use.

### StateLightGrid
- Source: `apps/desktop/src/renderer/components/ui.tsx`
- Category: basic
- Description: Operational red/amber/green-style status-card grid for first-screen health facts.
- Extractable props: `refreshing` (boolean), `items` (current labels/values/details/tones), `ariaLabel`.
- Hardcoded: list/listitem semantics, default label “首屏状态红绿灯”, `state-light-*` CSS classes.

### MicroStepper
- Source: `apps/desktop/src/renderer/components/ui.tsx`
- Category: basic
- Description: Compact process-step list with tone indicator, metadata and detail.
- Extractable props: `items` (step status/value/detail), `ariaLabel`.
- Hardcoded: list semantics, default label “流程步骤状态”, indicator span, `micro-step*` CSS classes.

### FormTable
- Source: `apps/desktop/src/renderer/components/ui.tsx`
- Category: basic
- Description: Structured form surface composed of rows with stable feedback slots.
- Extractable props: none; row validation state belongs to `FormTableRow`.
- Hardcoded: `form-table` wrapper class and row composition contract.

### FormTableRow
- Source: `apps/desktop/src/renderer/components/ui.tsx`
- Category: basic
- Description: Label/control form row with required marker, hint and non-layout-shifting validation feedback.
- Extractable props: `required` (boolean), `feedbackTone` (ready/pending/blocked/warning), `hasFeedback` (boolean).
- Hardcoded: asterisk and “必填” ARIA label, reserved non-breaking feedback placeholder, live status behavior, `form-table-*` CSS classes.

### SafetyGateLine
- Source: `apps/desktop/src/renderer/components/ui.tsx`
- Category: basic
- Description: Live semantic safety-gate state line for approvals, evidence and readback workflows.
- Extractable props: `tone` (ready/pending/blocked/warning), `focusable` (boolean).
- Hardcoded: live status semantics, “安全门状态” ARIA role description, `safety-gate-*` CSS classes.

### DecisionActionStrip
- Source: `apps/desktop/src/renderer/components/ui.tsx`
- Category: basic
- Description: Approval decision action group with strong label, supporting detail and semantic tone.
- Extractable props: `items` (action states), `disabledByItem` (boolean), `ariaLabel`.
- Hardcoded: default label “审批三态决策动作”, hover-fade data contract, `decision-action*` CSS classes.

### KpiCard
- Source: `apps/desktop/src/renderer/components/ui.tsx`
- Category: basic
- Description: Low-noise KPI card with label, dominant value, detail and optional status tone.
- Extractable props: `value`, `detail`, `tone` (ready/warning/blocked/pending).
- Hardcoded: label/value/detail hierarchy and `kpi-card*` CSS classes; metric label is authored per card.

### TagMetricGroup
- Source: `apps/desktop/src/renderer/components/tag-metric-group.tsx`
- Category: basic
- Description: Compact metric-chip group that becomes a pressed-state filter when selectable.
- Extractable props: `activeKey`, `dimInactive` (boolean), `disabledByItem`, `onSelect`, current metric values.
- Hardcoded: tone set ready/warning/blocked/neutral, button-versus-span behavior, `tag-metric*` CSS classes.

### ProgressiveDetails
- Source: `apps/desktop/src/renderer/components/progressive-details.tsx`
- Category: basic
- Description: Native details disclosure for secondary facts, diagnostics or evidence.
- Extractable props: `defaultOpen` (boolean).
- Hardcoded: native `details/summary` structure and `progressive-details*` CSS classes; summary title/content remain authored per use.

### ActionMenu
- Source: `apps/desktop/src/renderer/components/workspace/action-menu.tsx`
- Category: basic
- Description: Accessible overflow menu with roving focus, disabled items and danger tone.
- Extractable props: `open` (design preview state), `align` (start/end), `disabled` (boolean), `disabledByItem`, `dangerByItem`.
- Hardcoded: ellipsis glyph “⋯”, Arrow/Home/End/Escape behavior, focus restoration, outside-pointer close, `action-menu*` CSS classes.

### PriorityDataTable
- Source: `apps/desktop/src/renderer/components/workspace/priority-data-table.tsx`
- Category: basic
- Description: Operational table with declared column priority and optional keyboard row selection.
- Extractable props: `selectedRowKey`, `selectable` (boolean), `rowCount`, `empty` (boolean).
- Hardcoded: anchor/primary/supporting/action priority taxonomy, caption and column structure, interactive-target exclusion, `priority-table*` CSS classes.

### VirtualDataTable
- Source: `apps/desktop/src/renderer/components/virtual-data-table.tsx`
- Category: basic
- Description: Virtualized high-volume queue/table with sortable headers, sticky anchor cells and optional expandable/selectable rows.
- Extractable props: `loading` (boolean), `sortKey`, `sortDirection`, `selectedRowKey`, `rowCount`, `columnCount`, `minWidth`.
- Hardcoded: default 960px minimum width, 54px row estimate, overscan 10, loading skeleton, Chinese live row/column status copy, downward sort arrow, `virtual-table*` CSS classes.

### WorkspaceState
- Source: `apps/desktop/src/renderer/components/workspace/workspace-state.tsx`
- Category: basic
- Description: Shared state block for loading, empty, blocked, error, busy and disabled workbench conditions.
- Extractable props: `kind`, `progressValue`, `progressMax`, `actionBusy`, `actionDisabled`.
- Hardcoded: default Chinese state titles, alert role only for errors, shared spinner, “处理中...” fallback, `workspace-state*` CSS classes.

### RequirementList
- Source: `apps/desktop/src/renderer/components/status.tsx`
- Category: basic
- Description: Ordered checklist/requirement list with numbered markers.
- Extractable props: `itemCount`, `items`.
- Hardcoded: native ordered-list markup, one-based numbering, `requirement-list` CSS class.

### Readback/Overlay Focus Scope
- Source: `apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts`
- Category: basic
- Description: Nonvisual behavior primitive for modal/drawer focus capture, autofocus, trapping, Escape dismissal, inert background and focus restoration.
- Extractable props: `open`, `modal`, `dismissDisabled`, `autoFocus`, `dismissOnEscape`, `inertBackground`, `restoreFocus`, `trapFocus`.
- Hardcoded: focusable selector set, top-overlay keyboard stack behavior, animation-frame focus restoration; no visual CSS or user-visible copy.

