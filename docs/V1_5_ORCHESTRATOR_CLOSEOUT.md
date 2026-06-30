# v1.5 Orchestrator Closeout

Date: 2026-06-10

## Objective

Deliver Amazon AI Ops v1.5 as a user-usable desktop project, with operator-facing UX, evidence-backed readiness gates, final installer evidence, and a safe boundary for real ad actions.

## Agents Used

This closeout followed the repository's `.codex/agents/agents-orchestrator.toml` quality loop. The main agent retained integration ownership and delegated bounded audits:

| Agent role | Scope | Outcome |
| --- | --- | --- |
| `testing-reality-checker` | Audit APP_READY evidence, README/docs, final readiness JSON, bundle manifest, package scripts, and installer hash consistency | Found the app gates passed but the delivery bundle was stale after doc edits. Required bundle re-export and hash recheck. |
| `engineering-git-workflow-master` | Audit Git staging scope and local artifact risk | Recommended staging source, tests, scripts, docs, and page model changes; excluding `.codex/config.toml`, `output/`, `storage/`, browser profiles, AppData DB files, raw XLSX reports, release binaries, and secrets. |

Earlier delivery work also used orchestrator/product/UX/QA roles to reject premature READY claims until live Lingxing full-8 collection, Listing read, DeepSeek, Listing AI, ad AI explanation, and real ad readback evidence existed.

## Historical Readiness

This document records the 2026-06-10 closeout and the later 2026-06-18 product-ui, portable-fix, packaged-launch, 2026-06-23 high-fidelity UI closeout, and 2026-06-24 AI output-contract/package refresh plus the 2026-06-25 credential, AI/import feedback, OperatorTaskPanel loading micro-response, OperatorTaskPanel shimmer sweep, settings AI connection first-screen feedback, settings threshold field-level validation feedback, settings rule-save action-button busy feedback, scheduler first-screen local task feedback plus scheduler controller/row action-button busy feedback, operation-scope first-screen confirmation, page-level range FormTable feedback, ScopeBar field-level confirmation feedback, and non-layout-shifting ScopeBar editor popover, product-management first-screen product-locking, product-card locked/idle tags, selection `aria-live` feedback, credential sandbox hover feedback, approval decision-strip hover/focus weak-fade feedback, operation-event first-screen task feedback with optimistic clear/rebound/failure restore, product-config bulk target ACOS apply, inline autosave, keyboard nudge, and live target health feedback, canonical metric, Lingxing date-picker, product-level workbench refresh, data-collection monitor drawer with Canvas browser preview, data-collection action-button busy/spinner/striped-progress feedback, delivery readback repair handoff with field-level red repair rings, delivery export blocked-state red no-drop feedback, ad readback screenshot capture with drag-over feedback plus fixed thumbnail/badge confirmation, readback time/value contract visualization, readback safety checkbox confirmation feedback, heavy table virtualization, VirtualDataTable actual-row zebra striping and row press/focus feedback, ProgressiveDetails disclosure summary hover/focus/active feedback with visible open/close chips, Listing local action-button busy feedback, Listing keyword heatmap matrix, strict-contained Listing heatmap keyword rail cells, Listing draft diff/skeleton/limit feedback, ad-quant metric focus filters with inactive-chip dimming, ad-quant AI-running radar feedback, keyword-opportunity sortable header, filter-axis feedback, and refresh action-button busy feedback, dashboard primary action jump feedback, data-import validation SHA-256 checksum column/sortable header/import-time read-only lock/direct action-button busy feedback/`aria-live`/200ms blur/sweep plus row fade-in feedback, global typography contract, global button active `scale(0.98)` micro-response, shared state-light hover +2px lift feedback, MicroStepper status-dot/pending-spinner feedback, and live AI strategy JSON-contract fix. The current delivery state is recorded in `README.md`; as of the 2026-06-30 refresh the packaged state is `APP_READY` for the refreshed manifest-driven final-readiness `output\codex-evidence\final-readiness-20260630132927.json`, package launch smoke `output\codex-evidence\package-launch-smoke-1782797330367.json`, READY bundle `output\delivery-bundles\v15-delivery-bundle-20260630132927-ready`, and matching `verify:v15-ready-safety` result. This includes the renderer UX polish for AI output contract tags, compact metric tags with focus dimming, business-domain navigation with active glow bar, Listing table editing, Listing local save/read/generate/export button busy feedback, Listing keyword/root heatmap coverage, strict-contained heatmap keyword rail cells, Listing draft red/green diff chips, skeleton generation feedback, over-limit character alarms, ad-quant metric focus filters, ad-quant AI-running radar feedback, keyword-opportunity sortable header arrow/ARIA, filter-axis 100ms crossfade/live feedback, and refresh action-button busy feedback, approval decision-strip weak-fade focus, shared task-panel button busy states with spinner/disabled/`aria-busy` feedback, data-collection action buttons with `处理中...`, spinner, `aria-busy`, and striped progress feedback, data-import import/export direct buttons with `处理中...`, spinner, `aria-busy`, and `button-loading` feedback, non-blocking reduced-motion-safe OperatorTaskPanel shimmer, ProgressiveDetails and native details folded technical sections with hover/focus/active summary feedback and `展开`/`收起` state chips, global typography contract, global enabled-button active `scale(0.98)` feedback plus disabled `cursor: not-allowed`, shared state-light hover `translateY(-2px)` lift feedback, MicroStepper status-dot/pending-spinner feedback, FormTable focus-within glow feedback, settings save/test feedback in a fixed `aria-live` bubble without duplicate bottom status text, settings threshold repair prompts on the exact form row, settings rule-save action-button busy feedback, scheduler refresh/run-now confirmation/failure feedback plus controller/row action-button busy feedback in fixed `aria-live` lines, operation-scope save feedback plus page-level range FormTable and ScopeBar field-level confirmation, product-management explicit ASIN locking, product-card locked/idle tags, fixed selection readback, and no first-product fallback, operation-event task capture with optimistic form clear/rebound, failure draft restore, and saved-card highlight feedback, product-config current-scope row selection with bulk target ACOS apply, target autosave, keyboard nudge, and health-chip feedback, data-collection monitor drawer with Canvas browser preview, delivery readback repair handoff with field-level red repair rings, structured output token floor, OpenAI-compatible saved temperature/maxTokens usage, strategy diagnosis evidence-ref normalization, concrete JSON output examples, automatic commit/close behavior for the Lingxing date range picker during report creation, inline product maintenance, per-product daily ad metrics, encrypted local remember-account/password support, login submit `aria-busy`/spinner and stable credential status feedback, first-viewport AI/import feedback, virtualized keyword/import validation tables with actual-row zebra striping and row press/focus feedback and sortable keyword-opportunity headers and filter-axis feedback, ad readback screenshot drag/drop or Ctrl+V capture into session evidence folders with fixed thumbnail and badge confirmation, visible readback time/value safety contract cards, readback safety checkbox confirmation feedback, canonical daily metric accounting, and the dashboard product-selection gate. Live strategy evidence `output\codex-evidence\ad-strategy-live-1782358641101.json` returned `source=ai` with no fallback on the current DB scope. Product-centered context is now the intended operator entry for ASIN-specific analysis: select the product in `产品管理`, let it populate `scope.asin`, then continue into ad quantification, recommendations, operation events, keywords, and Listing from that context. The historical manifest-driven final-readiness `output\codex-evidence\final-readiness-2026-06-18-portable-fix.json` and READY bundle `output\delivery-bundles\v15-delivery-bundle-2026-06-18-portable-fix-ready` remain baseline evidence only.


The 2026-06-26 keyword-opportunity refresh adds sortable `VirtualDataTable` headers and filter-axis micro-feedback to `关键词机会`: active headers expose `aria-sort`, render a 150ms rotating arrow, and sort filtered rows locally without mutating imported result order. Filter or sort changes update a stable `aria-live` result line and apply a 100ms vertical crossfade to the table shell. The 2026-06-30 refresh extends the same no-dead-click contract to the direct refresh action: `刷新机会` switches to `刷新中...`, renders a spinner, exposes `aria-busy=true`, carries `button-loading`, and locks row-level `带入 Listing` handoff while rows reload. This keeps the long-table virtual scrolling path while making sorting, filtering, and explicit refresh visible and reversible for operators.

The 2026-06-30 data-import validation row-thaw refresh applies the same operator-feedback standard to `数据导入与校验`: the 8-report validation table can sort by report, real file, extension, size, SHA-256 checksum, imported rows, and status; the page announces the active order and real-report/imported-row totals through `aria-live`; header clicks now trigger a reduced-motion-safe 200ms blur/sweep plus row fade-in refresh with a non-intercepting translucent overlay using `backdrop-filter: blur(2px)`, so sorting visibly completes without blocking the next action. Active imports still lock the table read-only by disabling sortable headers and row open-file buttons until SQLite writeback completes. This keeps import validation usable as a high-reliability table rather than a static checklist.

The 2026-06-26 operation-event refresh closes the last form-feedback gap on `运营事件`: submitting an event clears the form immediately, runs a short rebound animation, and shows that the local context write is in progress; if persistence fails, the submitted draft is restored so the operator does not lose the BD/Coupon/price/stock/Listing context they typed. Successful writes still flash the newest event card, and the page remains local-context only with no Ads or Listing mutation.

The 2026-06-30 operation-events inline save action-button refresh closes the remaining no-dead-click gap in the same page: the bottom `保存到上下文` action now uses `operationEventInlineSaveButtonView`, so only a real local save shows `保存中...`, spinner, `aria-busy=true`, and `button-loading`. Incomplete drafts remain a plain unavailable state without running copy. This is still local operation-context feedback only and does not generate recommendations, approve actions, mutate Listing, or write Amazon Ads.

The 2026-06-26 business-data pipeline refresh implements the spec's high-throughput query guard in the shared renderer data hook. First load and explicit reload/data-updated refreshes remain immediate, while scope-only changes are merged through a 300ms debounce and stale timers are cancelled before IPC. This keeps rapid ScopeBar/date/store/site/ASIN/batch edits from firing duplicate current-scope data reads across dashboard, collection, import validation, ad quantification, recommendations, approval, keywords, Listing, product, scope, and readback pages.

The 2026-06-26 Listing draft feedback refresh completes the spec's draft-comparison surface in `Listing 优化`: each heatmap section now shows red strikethrough chips for words removed from the current Listing, green chips for words added by the draft, a non-layout-shifting skeleton wave while local AI/rule draft generation is running, and red flashing character counters when title or bullet drafts exceed their configured limits.

The 2026-06-26 product-config bulk target ACOS refresh closes the product-target table gap on `产品配置`: current-scope product rows can be selected individually or via select-all, a toolbar accepts `目标 ACOS (%)`, and the page applies the normalized decimal target through the existing local `saveProductConfig` IPC. The action preserves product identity/cost fields, keeps failed selections visible, and is explicitly local configuration maintenance only, not recommendation approval or Ads execution.

The 2026-06-30 product-config direct action-button refresh closes the remaining no-dead-click gap on `产品配置`: `保存完整产品配置` and bulk `应用到 X 个产品` now use `productConfigActionButtonView`, so only the active local save action shows `保存中...` or `批量应用中...`, spinner, `aria-busy=true`, and `button-loading`. Navigation peers lock as plain disabled buttons while the full-form save is pending, preventing conflicting clicks without making them look like running actions. This remains local product-target feedback only and does not generate recommendations, approve actions, or write Amazon Ads.

The 2026-06-30 settings rule-save action-button refresh closes the same no-dead-click gap in `AI 设置`: `保存广告阈值` now uses `settingsRuleActionButtonView`, so only the active local threshold save shows `保存中...`, spinner, `aria-busy=true`, and `button-loading`. Missing `saveRuleConfig` support remains a plain unavailable state without spinner or running copy. This remains local rule-configuration feedback only and does not generate recommendations, approve actions, or write Amazon Ads.

The 2026-06-26 ad-quant metric dimming refresh closes the focus-card attention contract on `广告量化`: `TagMetricGroup` supports opt-in inactive-chip dimming, and the ad-quant task panel enables it whenever the active focus is not `全部对象`. Non-active metric chips fade to 60% opacity and recover on hover/focus while staying clickable. Filtering rules, recommendations, approvals, and Ads execution state are unchanged.

The 2026-06-29 data-collection action-button refresh closes the remaining lower-action feedback gap on `数据采集`: `下载已创建`, `重建已选`, `重建全部 8 类`, and `导入本地` now share an explicit busy view model. The active action switches to `处理中...`, renders a spinner, exposes `aria-busy=true`, and keeps a blue striped progress surface while the button is disabled; sibling actions lock at the same time but do not visually impersonate the running action.

The 2026-06-29 approval decision-button refresh applies the same micro-response contract to `审批中心` approve/reject actions. The active decision button switches to `处理中...`, renders a spinner, exposes `aria-busy=true`, and carries `button-loading` while both decision buttons are disabled during the pending IPC call. This is local decision feedback only; it does not imply that Amazon Ads has been executed.

The 2026-06-29 data-import action-button refresh applies that same direct-button contract to `数据导入与校验`: the first-screen import task, folded import actions, and reconciliation export action now switch only the active button to `处理中...`, render a spinner, expose `aria-busy=true`, and carry `button-loading`; sibling actions stay locked without visually impersonating the running task. This closes the last visible import-page gap where a user could click import/export and see inconsistent button feedback.

The 2026-06-29 readback step-rail refresh adds a 2px blue active-step slider under the `执行回读` wizard tabs. The slider follows the current approval/before/after/readback step through CSS variables, uses a reduced-motion fallback, and remains purely navigational; final proof still depends on distinct approval, before/after, reload/readback evidence and `verify:ad-readback`.

The 2026-06-30 readback safety-checkbox refresh closes the local confirmation gap on `执行回读` approval and verification rows. Checkbox labels now respond to hover/focus/press, checked boxes emit a short green confirmation pulse, and reduced-motion disables the animation. This is only input feedback; final proof still depends on real approval, screenshots, changed values, readback equality, export verification, and `verify:ad-readback`.

The 2026-06-29 dashboard state-light refresh closes a first-screen response gap on `今日看板`: the primary task button still performs the short `转跳中...` handoff, and now the `数据健康` state-light grid also receives a shared `refreshing` pulse/sweep for 180ms. This is an operator feedback signal only and does not change current-scope data, recommendation queues, approvals, or Ads execution.

The 2026-06-29 OperatorTaskPanel group-busy lock refresh closes a cross-page race gap in the first-screen task surface. When any panel action is busy, the full action group disables immediately; only the active running action shows `处理中...` or business busy copy, spinner, `button-loading`, and `aria-busy=true`. Sibling actions remain disabled without busy decoration, so the operator can tell which action is running while duplicate or conflicting clicks are physically blocked.

The 2026-06-30 scheduler controller action-button refresh closes the lower-surface wait-state gap on `定时任务`: the controller refresh button, inline confirm-run button, and row-level enable/disable controls now use `schedulerActionButtonView`. Only the active local scheduler action switches to `正在刷新...`, `执行中...`, `启用中...`, or `停用中...`, renders a spinner, exposes `aria-busy=true`, and carries `button-loading`; peer scheduler controls lock without pretending to run. This is local automation feedback only and does not approve recommendations, modify bids, pause ads, add negatives, or write Amazon Ads.

The 2026-06-29 global route-handoff refresh closes the remaining route-click dead corner in the App Shell. Sidebar clicks and page-dispatched `amazon-ai-ops:navigate` events now share a 150ms `转跳中...` handoff: the target nav item exposes `aria-busy=true`, sibling nav buttons lock during the handoff, and the main canvas renders an absolute `route-handoff-feedback` status pill. This is non-layout-shifting navigation feedback only; it does not change route authority, scope data, approvals, recommendations, or Ads execution state.

The 2026-06-30 product route consolidation refresh closes the remaining product-flow orientation gap. Legacy `product-config` deep links remain compatible, but their active and pending App Shell state is anchored to `产品管理`; product-management configuration actions and delivery-matrix product-context repair now route to `产品管理`, so operators maintain ASIN identity, title, SKU/MSKU, cost, minimum price, and target thresholds inside the product-level workbench rather than being dropped into a navigation-orphaned configuration page. This is IA and repair-entry cleanup only; product configuration remains local-only and never approves recommendations or writes Amazon Ads.

The 2026-06-30 product-card lock feedback refresh closes the remaining ambiguity inside the `产品管理` product list. Product cards now expose `aria-pressed`, show `点击锁定` / `已锁定` tags, pulse briefly when selected, and announce in a fixed `aria-live` line that the toolbar is unlocked and downstream pages will read the selected ASIN. This is selection feedback only; saving product configuration, generating recommendations, approvals, and Ads execution remain separate gates.

The 2026-06-30 product-management save action-button refresh closes the direct-save wait-state gap on `产品管理`: `保存产品信息` switches to `保存中...`, renders a spinner, exposes `aria-busy=true`, and carries `button-loading` while the local save IPC is pending. `打开完整配置` locks as a plain disabled peer during the same save so operators cannot start a conflicting navigation, but it does not impersonate the running action. This remains local product configuration feedback only and does not generate recommendations, approve actions, or write Amazon Ads.

The 2026-06-30 login-entry micro-response refresh closes the first-screen login wait-state gap. The login submit button now enters the shared loading contract with `aria-busy=true`, spinner, duplicate-click lock, and `正在确认 ERP 和 Ads 会话...` copy while the main process confirms ERP and Ads session state. Credential sandbox notices, remembered-account/password guidance, and local-only login copy now stay in a fixed `aria-live` status line, so the login surface no longer relies on silent waits or optional secondary text for security feedback.

The 2026-06-30 recommendation batch-selection micro-response refresh closes the remaining dead-looking checkbox/count gap on `优化建议`. Formal-approval-ready rows now show keyboard focus rings and checked-state confirmation animation, while the batch toolbar renders a stable `X/N` selected-count chip, active pop feedback, and an `aria-live` status line. This only confirms selection state; the batch handoff still passes selected recommendation IDs to `审批中心` as context and does not approve, reject, execute, or write Ads changes.

The 2026-06-30 data-collection report-selection feedback refresh closes the same dead-looking chooser gap on `数据采集`. The 8-report selector now has a stable selected-count chip, progress rail, `aria-live` status, selected-card styling, focus-within ring, and checked-state animation. This is target-selection feedback only; it does not create reports, import rows, or weaken the existing real-report and SQLite import gates.

The 2026-06-30 ad-quant AI-running radar feedback refresh closes the text-only pending gap on `广告量化`. While AI stage diagnosis is running, the feedback panel now exposes `aria-busy=true` and shows a contained radar sweep/pulse with reduced-motion fallback, so the operator sees the AI task is actively progressing. This is running-state feedback only; AI JSON contracts, formal recommendation gates, approval requirements, readback proof, and Ads execution remain unchanged.

The 2026-06-30 Listing heatmap focus feedback refresh completes the spec's clicked-root response on `Listing 优化`. Keyword rail buttons now expose `aria-pressed`, clicked roots flash on the rail item, matched section cards, and active token highlights, and a fixed `aria-live` status line announces which Listing sections are currently matched. This stays a local coverage-review interaction only and does not submit Amazon or modify Lingxing Listing.

The 2026-06-29 Listing heatmap containment refresh extends the spec-level high-density cell isolation contract to `Listing 优化`: left-side keyword rail cells now declare `contain: strict`, matching the existing strict containment on current/draft text cells while leaving auto-height outer sections content-driven. This keeps the heatmap interaction localized without risking layout collapse on variable Listing content.

The 2026-06-29 Listing local-draft workbench refresh closes the primary-copy gap on `Listing 优化`: keyword input, real-data gate, draft purpose, source counters, and generate/export actions now live in `关键词与本地草案工作台`. Missing real ad data is surfaced as `待补齐真实广告数据` and `仅本地预览`, not as placeholder copy, and the draft table still keeps source/evidence/risk detail for manual review. This improves operator comprehension without weakening the local-only, no-Amazon-submit boundary.

The 2026-06-30 Listing local action-button refresh closes the remaining local-action wait-state gap on `Listing 优化`: manual save, Lingxing read-only fill, local draft generation, and draft export now use `listingLocalActionButtonView`. Only the active action switches to `保存中...`, `读取中...`, `生成中...`, or `导出中...`, renders a spinner, exposes `aria-busy=true`, and carries `button-loading`; sibling actions lock without pretending to be the running task. This is local version/draft feedback only and does not submit Amazon or modify Lingxing Listing.

The 2026-06-29 VirtualDataTable zebra refresh completes the shared heavy-table scanability contract. `关键词机会` and `数据导入与校验` now get alternating row backgrounds from actual virtual row indexes (`virtual-table-row-even` / `virtual-table-row-odd`) rather than DOM `nth-child`, so the visual striping stays stable when `@tanstack/react-virtual` recycles visible rows during long-table scrolling.

The 2026-06-29 ProgressiveDetails/direct details disclosure refresh completes the shared progressive-disclosure interaction contract. Every `ProgressiveDetails` summary now has a dedicated interaction surface with hover inset anchor, keyboard focus ring, active `scale(0.98)`, visible `展开`/`收起` chip, hidden native marker, and reduced-motion fallback. Direct native details summaries used by dashboard, detail panels, and evidence disclosures now share hover/focus/active feedback and reduced-motion fallback as well. This keeps detailed evidence and technical command walls folded without making the fold itself feel inert or ambiguous.

The 2026-06-29 global typography refresh completes the spec-level desktop typography contract. The renderer body now uses `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`, while body text, business-table cells, and virtual-table cells explicitly keep `line-height: 1.25`; this keeps mixed Chinese/English high-density report rows aligned without adding visual noise to the main window.

The 2026-06-25 approval-center refresh adds stamp-style decision feedback for approval and rejection paths. `SEALING`, `PASSED`, `REJECTED`, and `BLOCKED` are visible first-screen status states in `审批中心`; the active approve/reject button now also shows its own `处理中...` spinner/`aria-busy` state while the decision is being recorded. The three-state decision strip also fades non-focused available actions to 40% opacity on hover/focus, so the active approve/review/reject choice is visually isolated. The 2026-06-26 queue-exit refresh adds visible closure after a successful approve or reject: the decided row slides out for 180ms, leaves the local visible queue, and then the page reloads the authoritative queue. These acknowledge local decision recording only and do not replace the manual Ads UI execution/readback proof chain. The same package adds `优化建议` status-bucket filtering plus batch selection for formal-approval-ready rows; bucket filtering is visual triage only, batch handoff only passes selected recommendation IDs to `审批中心` as UI context, and every row still requires per-row approval and readback evidence before any manual Ads UI action.

Authoritative evidence:

| Gate | Evidence |
| --- | --- |
| Final readiness | `output\codex-evidence\final-readiness-20260630132927.json` |
| Evidence selection | `output\codex-evidence\v15-final-readiness-evidence-manifest-20260630132927.json` |
| Delivery bundle | `output\delivery-bundles\v15-delivery-bundle-20260630132927-ready` |
| Current package launch smoke | `output\codex-evidence\package-launch-smoke-1782797330367.json` |
| Live ad strategy diagnosis | `output\codex-evidence\ad-strategy-live-1782358641101.json` |
| Historical 2026-06-10 bundle | `output\delivery-bundles\v15-delivery-bundle-2026-06-10T07-00-21-859Z\delivery-bundle-manifest.json` |
| Product UI smoke | `output\codex-evidence\v15-product-readiness-ui-smoke-1781072779324.json` |
| Installer | `apps\desktop\release\AmazonAIOpsAgent-1.5.0.exe` |

Final package artifacts:

| Field | Value |
| --- | --- |
| Installer SHA-256 | `3FBAAA57DC2445A87E8E802F799E32BF4F6D146FFA445A516F05E3C17F6260C9` |
| Installer size | `83125864` bytes |
| Installer last write | `2026-06-30 12:54:54` |
| Portable/no-install SHA-256 | `F818EB7321C41FEEAD4579278381B90F73462C502F148AB01056318E79A853B4` |
| Portable/no-install size | `82960115` bytes |
| Portable/no-install last write | `2026-06-30 12:54:56` |

## Verification Snapshot

Completed final-node checks:

| Check | Result |
| --- | --- |
| `pnpm test` | Passed, 37 test files / 191 passed / 2 skipped |
| `pnpm -r run typecheck` | Passed |
| `pnpm --filter @amazon-ai-ops/desktop run build:win` | Passed |
| Packaged smoke | `win-unpacked\AmazonAIOpsAgent.exe` stayed alive for 8 seconds and stopped with no remaining process |
| `pnpm run smoke:v15-product-readiness-ui` | Passed |
| `pnpm run verify:v15-ready-safety` | Passed |

Post-audit fix:

- The stale delivery bundle found by `testing-reality-checker` was re-exported.
- The new bundle is `output\delivery-bundles\v15-delivery-bundle-2026-06-10T07-00-21-859Z`.
- The current source, bundle copy, and manifest SHA-256 values match for `docs/V1_5_PROGRESS_REPORT.md`, `docs/V1_5_ACCEPTANCE_MATRIX.md`, and `docs/REAL_AD_READBACK_RUNBOOK.md`.
- The stale pre-release wording identified by QA is absent from the current bundle docs.

## Safety Boundary

The app is deliverable with the following explicit boundary:

- Current real ad execution readiness is proven by one user-approved, low-risk manual Ads UI sample on a paused FT-US keyword row `door lock`, with live bid `1.30 -> 1.17`, before/after/reload screenshots, real spreadsheet source traceability, and `verify:ad-readback`. The historical paused target sample `1.20 -> 1.08` remains baseline only.
- The app-side ad execution button remains fail-closed. It does not batch-write ads.
- The `执行回读` time/value contract cards are pre-export UX checks only; they help operators see blockers early but do not replace distinct screenshots, valid time ordering, before/after value change, readback equality, and `verify:ad-readback`.
- Future ad changes must each bind their own store, marketplace, portfolio, campaign, ad group, ASIN, entity type, entity name, action type, source recommendation, real source report file(s), original source row, live before value, live after value, approval proof, screenshots, and readback evidence.
- The verified D6 paused-target sample must not be reused as proof for another product, ad group, target, or bid.

## Commit Boundary

Stage source, tests, scripts, docs, and page model changes needed for v1.5. Exclude local/runtime artifacts:

- `.codex/config.toml`
- `output/`
- `storage/`
- `apps/desktop/release/`
- AppData SQLite DB files
- raw downloaded XLSX reports
- browser profiles, cookies, sessions, traces
- API keys, passwords, `.env*`
