# Amazon AI Ops Agent - Agent Instructions

<!-- CCG-FAST-CONTEXT-START -->
# fast-context MCP 工具使用指南（辅助模式）

## 核心原则

**主检索工具为 ace-tool（`mcp__ace-tool__search_context`）。当 ace-tool 无法满足语义搜索需求时，使用 `mcp__fast-context__fast_context_search` 作为补充。**

适合使用 fast-context 的场景：
- 用自然语言描述要找的逻辑（如"部署流程"、"事件处理"）
- 跨模块、跨层级的调用链路追踪
- 中文语义搜索（工具支持中英文双语查询）
<!-- CCG-FAST-CONTEXT-END -->

## Project Scope

- This repo is a local-first Electron desktop app for Amazon operators. Target Windows desktop only; do not spend effort on mobile layouts unless explicitly requested.
- Preserve the current worktree. Do not roll back user changes, generated evidence, or local runtime state unless the user explicitly asks.
- `output/`, `storage/`, AppData DB/profile files, raw Lingxing spreadsheets, release EXE binaries, and secrets are local artifacts. Do not commit them.

## Current Delivery State

- Current packaged state is `APP_READY` for the high-fidelity Windows desktop UI, AI output-contract refresh, real ad strategy diagnosis JSON-contract fix, Lingxing report date-picker commit fix, product-level workbench/product maintenance refresh, product-management first-screen task panel with explicit product locking and credential sandbox hover/focus summary, operation-scope first-screen confirmation, ScopeBar field-level confirmation feedback, and non-layout-shifting ScopeBar editor popover, product-config first-screen task and inline autosave feedback, operation-event first-screen task feedback, settings-page first-screen AI connection feedback plus threshold field-level validation feedback, shared FormTable focus-within glow feedback, scheduler first-screen local task feedback, encrypted login credential saving, visible AI/import feedback, OperatorTaskPanel loading micro-response and non-blocking shimmer sweep, global button active `scale(0.98)` micro-response and disabled cursor lock, StateLightGrid hover +2px lift feedback, MicroStepper status-dot and pending-spinner feedback, data-collection monitor drawer with Canvas browser preview, delivery readback repair handoff, ad readback screenshot paste/drop capture with drag-over feedback, readback time/value contract visualization, heavy table virtualization, keyword-opportunity sortable headers with arrow/ARIA feedback plus filter-axis 100ms crossfade/live feedback, Listing keyword heatmap matrix with draft diff/skeleton/over-limit feedback, ad-quant metric focus filters, and canonical daily metric explanations verified on 2026-06-26.
- Approval center decisions now show immediate stamp-style first-screen feedback for approving, approved, rejecting, rejected, and blocked states. The three-state decision strip also fades non-focused available actions to 40% opacity on hover/focus so the active approval/review/reject choice is visually isolated. The stamp is status feedback only; ad execution still requires separate manual Ads UI proof, screenshots, reload/readback, and verifier approval.
- `优化建议` now supports batch-selecting only formal-approval-ready recommendations and handing their IDs to `审批中心`; this is a UI context handoff only, and approval still reloads the real queue, revalidates evidence, and requires per-row human decision feedback before any manual Ads UI readback workflow.
- `优化建议` status buckets are interactive table filters. `全部`, `高风险强阻断`, `需人工复核`, and `已就绪可批准` only change the visible recommendation table and clear current checkbox selection; they must not change recommendation state, bypass blockers, or submit hidden rows.
- `广告量化` metric chips are interactive focus filters. `全部对象`, `浪费超支`, `高 ACOS`, `出单对象`, `可扩量`, and `待复核` only change the current quantification view, object timeline, and review queue; they must not change recommendation state, approvals, or Ads execution state.
- Authoritative final readiness: `output\codex-evidence\final-readiness-20260626141045.json`.
- Evidence manifest: `output\codex-evidence\v15-final-readiness-evidence-manifest-20260626141045.json`.
- Package launch smoke: `output\codex-evidence\package-launch-smoke-1782454222875.json`.
- READY bundle: `output\delivery-bundles\v15-delivery-bundle-20260626141045-ready`.
- Installer SHA-256: `4F535873D0F79C3DC0955B8126D8062CA775D4A9A6731B67C03F610D5A400702`.
- Portable/no-install SHA-256: `98D508CAC94B044A1C483F2DB8375AE0CD07AC6575039BF7A57FFCC872C44687`.
- The 2026-06-25 refresh keeps the high-fidelity business-domain navigation with active glow bar, compact status/tag surfaces, AI output contract tags, table-like Listing editor, Listing keyword heatmap matrix, structured AI token floor, strategy-diagnosis evidence-ref normalization, Lingxing date-range picker commit behavior, product-first dashboard gate, and data-collection monitor drawer with Canvas browser preview. It additionally fixes the real AI strategy diagnosis format-fallback root cause by making the OpenAI-compatible provider honor saved temperature/maxTokens, forcing diagnosis and JSON repair calls to the 8192 token floor, and replacing placeholder schema text with concrete evidence-driven JSON examples. Live DeepSeek evidence `output\codex-evidence\ad-strategy-live-1782358641101.json` returned `source=ai` with no fallback for the current scope. It also stores remembered Lingxing login credentials locally through Electron `safeStorage`, makes AI strategy diagnosis and import actions show first-viewport running/success/failure feedback, gives OperatorTaskPanel actions a shared busy contract with immediate disabled state, spinner, `aria-busy`, and `处理中...`/business-specific running copy, gives OperatorTaskPanel cards a non-blocking reduced-motion-safe shimmer sweep behind their content, aligns global button active feedback to `scale(0.98)` with disabled `cursor: not-allowed`, gives shared state-light cards a reduced-motion-safe hover `translateY(-2px)` lift and shadow, adds settings, operation-scope, product-management, product-config, operation-events, and scheduler task panels so AI connection testing, scope confirmation, explicit ASIN locking, product targets, BD/Coupon/price/stock/Listing context, and local automation status are visible as first-screen actions, keeps product management from silently using the first product when no ASIN is selected, routes selected products without imported metrics to `数据导入与校验` before AI quantification, exposes `凭证映射通过` as a hover/focus chip that shows only Main Sandboxed ID, site/period, and UI no-plaintext-retention copy, lets ad-quant metric chips focus the page on all objects, no-order waste, high ACOS, ordered, scale-ready, or review-needed objects with visible/total counts, keeps AI save/test results in a fixed `aria-live` feedback bubble without duplicating them in the bottom status panel, lets `工作范围` explicitly save the current scope with fixed `aria-live` saved/error feedback and open the ScopeBar editor from the page as a non-layout-shifting popover, autosaves product cost/min-price/target fields on blur or Enter with stable `aria-live` saved/error feedback, flashes the newest saved operation-event card, keeps scheduler refresh/run-now confirmation/failure feedback visible in a fixed first-screen status line, opens a non-layout-shifting right-side monitor drawer with a Canvas browser-preview frame for data-collection verify/download/recreate/import actions, labels downloaded reports as `已下载待入库` until SQLite rows exist, virtualizes the `关键词机会` and `数据导入与校验` heavy tables with `@tanstack/react-virtual`, sticky headers, skeleton loading, and scroll containment, shows Listing keyword/root coverage as a left keyword rail plus right current-vs-draft title/bullets/backend/details heatmap with click-to-highlight, colors Listing draft deleted/added tokens as red/green diff chips, overlays a draft-generation skeleton wave, flashes over-limit character counts, explains that daily totals use the selected batch/source files plus canonical report priority rather than cross-batch or cross-grain summing, lets the `执行回读` page save approval/before/after/readback screenshots by drag/drop or Ctrl+V into the current readback session folder while backfilling evidence paths and timestamps, and visualizes the readback time/value safety contract before export so operators see time-order, value-change, readback-match, bid-direction, and evidence-reuse blockers before a draft can be mistaken for final proof. Focused renderer/product/import/data-collection-monitor/AI/readback-capture/readback-contract/virtual-table/listing-heatmap/operator-task-panel/operation-event/product-config/operation-scope/settings-page/scheduler/ad-quant focus tests, desktop typecheck, `smoke:business-ui-current`, `build:win`, `smoke:package-launch`, manifest-driven final-readiness, READY bundle export, and READY safety have been rerun for this source state.
- The approval feedback refresh adds `PASSED` / `REJECTED` / `BLOCKED` stamp copy in an `aria-live` status block, disables duplicate decision submissions while IPC is pending, and keeps exact operator error text in the page message area to avoid strict text duplication. Focused approval tests, desktop typecheck, renderer build, ad-execution smoke, current business UI smoke, `verify:ad-execution`, `build:win`, package launch smoke, manifest-driven final-readiness, READY bundle export, and READY safety were rerun for this package state.
- The 2026-06-26 keyword-opportunity refresh makes `VirtualDataTable` headers optionally sortable with `aria-sort`, a 150ms rotating arrow, and stable button feedback. `关键词机会` now sorts filtered rows locally without mutating source order, defaults to high opportunity levels first, and gives filter/sort changes a fixed `aria-live` result line plus a 100ms vertical crossfade while preserving virtual scrolling for long tables. Focused virtual-table and keyword-opportunity tests, desktop typecheck, `smoke:business-ui-current`, `verify:ad-execution`, `build:win`, package launch smoke, manifest-driven final-readiness, READY bundle export, and READY safety were rerun for this package state.
- The 2026-06-26 Listing draft feedback refresh adds per-section diff chips to the Listing heatmap matrix: removed original tokens are red and struck through, added draft tokens are green chips, AI/rule draft generation overlays a non-layout-shifting skeleton wave on the draft pane, and character counts flash red when a title/bullet exceeds its limit. Focused Listing tests, desktop typecheck, `smoke:business-ui-current`, `verify:ad-execution`, `build:win`, package launch smoke, manifest-driven final-readiness, READY bundle export, and READY safety were rerun for this package state.

Any future code, package, scope, or ad-action change invalidates applying this `APP_READY` claim to that modified state until the final gates are rerun.

## Required Safety Boundaries

- App-side batch ad execution remains fail-closed. The UI must not claim that blocked audit output equals a real Amazon Ads write.
- Recommendation batch handoff is not batch execution. It may preselect or hint approval rows, but it must not update Ads, bypass approval blockers, or convert review-only rows into formal approvals.
- Recommendation bucket filtering is visual triage only. It should reuse `recommendationHasEvidenceBlocker`, manual-review, and formal-approval gates so the visible buckets match approval policy.
- Ad-quant metric focus filtering is visual triage only. It should use shared quant thresholds for high ACOS/no-order waste buckets and must not update recommendations, approvals, or Ads state.
- Readback time/value contract cards are operator-facing prechecks, not proof of execution by themselves. Final readiness still requires distinct screenshots, valid time order, before/after value change, readback value equality, source traceability, and `verify:ad-readback`.
- Every future Ads UI action needs its own target, source report file(s), source row, approval, before screenshot, after screenshot, reload/readback screenshot, and `verify:ad-readback` pass.
- Structural/mock AI evidence never gives final readiness credit. Real readiness requires live provider evidence and the real ad/Listings verifier chain.
- Operator-facing UI should stay concise: avoid raw `APP_*` status codes, long command walls, or dense evidence text in primary views. Put technical details behind secondary panels.
- Main window text overload was a known UX problem; prefer task-first copy, compact summaries, and clear next action labels.
- AI output schemas are system-owned contracts. Settings may show contract tags and allow persona/expression tuning, but user-edited persona text must not control `schemaVersion`, fixed fields, or formal action eligibility.
- Dense readiness summaries should prefer compact tags/chips in primary views, with detailed evidence and explanations behind progressive disclosure.

## Verification Commands

Use focused checks while iterating, then rerun the delivery chain before claiming readiness.

```powershell
pnpm --filter @amazon-ai-ops/desktop run typecheck
pnpm --filter @amazon-ai-ops/desktop run build:win
pnpm run smoke:business-ui-current
pnpm run smoke:package-launch
pnpm run verify:ad-execution
pnpm run verify:ad-strategy-live -- --input output\codex-evidence\ad-strategy-live-input-current-scope.json
pnpm exec vitest run scripts\verify-v15-final-readiness.test.mjs scripts\verify-v15-ready-safety.test.mjs scripts\verify-v15-non-ready-safety.test.mjs scripts\package-scripts.test.mjs
```

Final delivery refresh:

```powershell
pnpm run write:v15-evidence-manifest -- --ad-readback output\codex-evidence\real-ad-execution-readback-candidate-rec-4-current-pass.json --out output\codex-evidence\v15-final-readiness-evidence-manifest-20260626141045.json
pnpm run verify:v15-final-readiness -- --evidence-manifest output\codex-evidence\v15-final-readiness-evidence-manifest-20260626141045.json --package-launch-smoke output\codex-evidence\package-launch-smoke-1782454222875.json --out output\codex-evidence\final-readiness-20260626141045.json
pnpm run export:v15-delivery-bundle -- --final-readiness output\codex-evidence\final-readiness-20260626141045.json --data-reconciliation output\codex-evidence\real-lingxing-reconciliation-batch_20260612020905629_gkchz1.json --data-reconciliation-md output\codex-evidence\real-lingxing-reconciliation-batch_20260612020905629_gkchz1.md --out output\delivery-bundles\v15-delivery-bundle-20260626141045-ready
pnpm run verify:v15-ready-safety -- --final-readiness output\codex-evidence\final-readiness-20260626141045.json --bundle-manifest output\delivery-bundles\v15-delivery-bundle-20260626141045-ready\delivery-bundle-manifest.json
```

## Docs To Keep In Sync

When delivery status, package hashes, readiness gates, UX boundaries, or evidence paths change, update these together:

- `README.md`
- `docs\USER_GUIDE_v1_5.md`
- `docs\V1_5_ACCEPTANCE_MATRIX.md`
- `docs\V1_5_PROGRESS_REPORT.md`
- `docs\V1_5_ORCHESTRATOR_CLOSEOUT.md`

After doc changes that affect delivery state, re-export the READY bundle and rerun `verify:v15-ready-safety` so bundled docs match the workspace docs.
