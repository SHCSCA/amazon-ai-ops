# Amazon AI Ops Task-First Workspace Design

**Date:** 2026-07-13

**Status:** Ready for user review
**Implementation plan:** `docs/superpowers/plans/2026-07-13-frontend-experience-production-trust-reframe.md`

## Goal

Turn the Windows Electron client from a dense 16-page administration surface into a task-first Amazon operator workbench. A user must be able to identify the current blocker, the next safe action, and the primary business object without scanning duplicate cards, forms, technical paths, or nested disclosures.

This design does not weaken report provenance, human approval, Ads readback, Listing-local-only behavior, package smoke, or APP_READY gates.

## Chosen direction

Three approaches were evaluated:

1. **Continue page-by-page cleanup.** Lowest implementation risk, but preserves 16 equal navigation entries and keeps accumulating local CSS/interaction patterns. Rejected.
2. **Rewrite the renderer as a new application.** Cleanest theoretical result, but creates unacceptable data-contract, safety-gate, and delivery risk. Rejected.
3. **Introduce stable workspaces and migrate incrementally.** Keep existing routes, IPC and safety logic; add a canonical workspace model, shared task-first primitives, and migrate reference workspaces before the remainder. Chosen.

## Visual thesis

The product feels like a precise Amazon operations workbench through one compact **运营作战单** connected to one real **对象队列**.

- The task banner explains the current state and one next safe action.
- The main area is a product list, risk-object table, recommendation queue, approval queue, or readback work area.
- Summary information is a compact strip, not a KPI-card mosaic.
- Blue means navigation or executable action; amber/red means attention or blocking; green is reserved for authoritative confirmation.
- Ordinary work areas use borders and spacing, not decorative shadows, gradients, or motion.

## Information architecture

Visible navigation contains seven daily workspaces plus one separated system entry:

| Workspace | Subviews | Legacy compatibility |
| --- | --- | --- |
| 今日任务 | overview | dashboard |
| 产品工作台 | products / targets / events | product-management / product-config / operation-events |
| 数据准备 | scope / reports / import-check | operation-scope / data-collection / data-import-validation |
| 广告诊断 | analysis | ad-quant |
| 建议与审批 | recommendations / approval / decided | recommendations / approval |
| 结果核对 | evidence | readback |
| 关键词与 Listing | keywords / listing | keyword-opportunities / listing-optimization |
| 系统与交付 | settings / scheduler / delivery | settings / scheduler / delivery |

`NavigationIntent` is the canonical runtime state. All 16 `AppRoute` values remain valid compatibility inputs. New subviews such as `decisions/decided` do not need a unique legacy route.

External URL/protocol deep links are not introduced because the current product has no such authoritative mechanism. The compatibility boundary is the existing `amazon-ai-ops:navigate` event plus canonical in-app state.

## Workflow authority

`NextSafeAction` is derived in this order:

1. select product;
2. confirm scope;
3. collect real reports;
4. validate import;
5. run diagnosis;
6. generate/review recommendations;
7. complete human approval;
8. supply verified Ads execution/readback evidence;
9. pass manifest-driven final readiness with current package smoke and matching package hash;
10. return to Today.

The selector fails closed for missing or contradictory evidence. Preview state, stale smoke, hash mismatch, missing manifest, and unverified readback can never produce operational completion. Approval never means execution.

Successful diagnosis, recommendation, approval, readback and delivery mutations emit one workflow invalidation event. The App reloads authoritative evidence after the event; it does not poll or infer success from local button state.

## Shared component system

Create under `components/workspace/`:

- `PageFrame`: one page `h1`, description, task slot and content; never creates a second `<main>`.
- `TaskBanner`: renders the authoritative NextSafeAction with exactly one primary action and at most two secondary actions.
- `SummaryStrip`: up to four decision metrics in one compact row.
- `WorkbenchPanel`: named toolbar + primary work area + state surface.
- `PriorityDataTable`: anchor/primary/action column priorities, compact projection and details entry; no business gate logic.
- `ActionMenu`: visible affordance, keyboard support, Escape close and focus restoration.
- `WorkspaceState`: loading, empty, blocked, error, busy/long-task and disabled-reason states in Chinese.

Business pages continue to own data loading and Electron IPC. Shared components display state; they do not reimplement approvals, evidence verification, Ads execution or persistence.

## Style layers

Introduce:

- `styles/tokens.css`
- `styles/foundations.css`
- `styles/shell.css`
- `styles/workspace.css`
- `styles/priority-table.css`
- `styles/states-motion.css`

The current `styles.css` remains a temporary legacy reservoir for unmigrated pages. New broad overlays at its tail are forbidden. Migrated selectors move to the new layers and old rules are deleted when no longer used.

### Tokens

- body: 14px/21px;
- tables, controls and buttons: 13px/20px;
- visible supporting text: minimum 12px/18px;
- page title: 24px/32px;
- section title: 16px/24px;
- key number: 20px/24px with tabular numerals;
- spacing: 4/8/12/16/24/32;
- radii: 6/8/10px;
- motion: 120–180ms, purpose only, reduced-motion fallback;
- `#94a3b8` is limited to disabled/placeholder use, not small explanatory copy.

The production renderer remains light-theme-only for this project phase. Dark theme is explicitly N/A; no fake untested dark tokens are added.

## Shell

- Topbar contains brand, compact current scope, connection/delivery status and account controls.
- Sidebar contains only the eight workspaces and no duplicate brand block.
- `.app-content` owns workspace vertical scrolling.
- A virtual table may own vertical scroll only when explicitly labelled as an exception; ordinary tables may use a local horizontal wrapper.
- Scope editing remains an on-demand popover/drawer and must not push every page down.
- Topbar may form a controlled second row at Windows 125% scaling, but must not overlap or clip.

## Reference workspaces

### Today

Order: `TaskBanner -> SummaryStrip -> risk/object queue -> compact product context`.

Data health, delivery details, paths, hashes and technical evidence move into one secondary surface. Duplicate PageHeader task cards, duplicate CTA, KPI mosaics, nested disclosures and internal vertical table scrolling are removed.

### Decisions

Subviews are `待判断 / 待审批 / 已决策`. One queue is primary. At 1400px it uses queue + detail inspector; at 1200px it uses a full-width queue plus an on-demand drawer.

Core columns are action, object, current-to-suggested value, evidence status and decision. Campaign, ad group, source and rationale move to the inspector. All visible risk/action terms use Chinese operator copy. Approved/rejected rows appear in `已决策`; approval copy states that approval is not execution.

### Result verification

The four semantic steps remain, but only the current task/work area is expanded. The first screen contains TaskBanner, compact step summary and the current step.

Work packages, local paths, fill commands, hashes and verifier details live in one technical drawer. Missing screenshot/value/verification states each provide one repair action. Preview may hydrate a read-only verified layout, but it cannot expose evidence writing or unlock real export/APP_READY.

## Remaining workspace migration

- Product: products / business targets / operation records.
- Data Preparation: scope / report acquisition / import check.
- Diagnosis: risk and opportunity queue with object detail.
- Growth: keyword opportunities / current Listing / local draft and export.
- System: AI settings / scheduler / delivery status, with technical evidence in secondary surfaces.

Legacy page shells are removed only after the corresponding workspace state and compatibility tests pass.

## State coverage

Every workspace covers loading, empty, ready, busy, error and disabled-reason states where relevant. Blocked states always answer “what is missing” and “where to fix it”.

The seven development scenarios are layout fixtures only:

- missing-scope;
- missing-reports;
- pending-import;
- diagnosis-ready;
- mixed-recommendations;
- missing-readback-evidence;
- delivery-ready (preview-only and never APP_READY).

Transient loading, IPC error and long-task/cancel fixtures are added separately; fake metrics are not presented as real evidence.

## Motion and accessibility

- Navigation, row selection, inspector reveal and confirmed status transitions use 120–180ms motion for spatial continuity.
- Repeated animation is restricted to real loading/progress.
- `transition: all`, decorative background animation and new motion dependencies are forbidden.
- `prefers-reduced-motion` replaces movement with opacity or immediate state.
- Buttons remain real buttons; tabs use tab/tabpanel relationships; menus and drawers support keyboard navigation, Escape and focus restoration.

## Runtime acceptance contracts

Source-string tests are not experience evidence. A Playwright/runtime runner records DOM metrics and screenshots.

For each migrated workspace:

- exactly one `h1`;
- exactly one visible `[data-action-priority="primary"]` in the first screen;
- no more than two visible secondary actions in the first screen;
- visible text computed size >=12px;
- no `details details` nesting;
- `documentElement`, body, app shell and app content have no horizontal overflow;
- one workspace vertical scroll owner, with explicitly labelled table exceptions only;
- no hidden primary repair action;
- keyboard navigation and drawer/menu focus behavior work.

Intermediate renderer evidence uses 1200×700 and 1400×900 at 100% plus a 1.25 device-scale/zoom check. Final acceptance uses the newly packaged Windows app at real 100% and 125% display scaling.

Screenshots are accompanied by JSON containing workspace, subview, scenario, viewport, DPR, DOM metrics, timestamp and screenshot SHA-256. Final packaged evidence additionally records EXE SHA-256.

## Production acceptance

Preview-ready proves layout only. Real ready requires all of:

- current Windows package;
- package launch smoke for unpacked and portable app;
- matching portable SHA-256;
- manifest-driven final readiness;
- real reports and live required AI evidence;
- verified Ads readback evidence;
- all shared evaluator gates passing;
- READY bundle, docs and safety checks aligned to the same package/evidence set.

No source edit, renderer build, DOM metric or screenshot alone can establish APP_READY.

## Implementation sequence

1. Shared components, style layers, shell and Today.
2. Decisions workspace.
3. Result verification workspace.
4. Product and Data Preparation.
5. Diagnosis and Growth.
6. System and Delivery.
7. Full workspace state matrix, packaged Windows evidence and delivery refresh.

Each step uses RED/GREEN tests, a fresh implementation review, running layout evidence and a scoped commit. Unresolved P0/P1 or Critical/Important findings block progression.
