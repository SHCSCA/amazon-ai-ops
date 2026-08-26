# v1.5 Orchestrator Closeout

Date: 2026-08-26

## Objective

Deliver Amazon AI Ops v1.5 as a user-usable desktop project, with operator-facing UX, evidence-backed readiness gates, final installer evidence, and a safe boundary for real ad actions.

## Agents Used

This closeout followed the repository's `.codex/agents/agents-orchestrator.toml` quality loop. The main agent retained integration ownership and delegated bounded audits:

| Agent role | Scope | Outcome |
| --- | --- | --- |
| `testing-reality-checker` | Audit APP_READY evidence, README/docs, final readiness JSON, bundle manifest, package scripts, and installer hash consistency | Found the app gates passed but the delivery bundle was stale after doc edits. Required bundle re-export and hash recheck. |
| `engineering-git-workflow-master` | Audit Git staging scope and local artifact risk | Recommended staging source, tests, scripts, docs, and page model changes; excluding `.codex/config.toml`, `output/`, `storage/`, browser profiles, AppData DB files, raw XLSX reports, release binaries, and secrets. |

Earlier delivery work also used orchestrator/product/UX/QA roles to reject premature READY claims until live Lingxing full-8 collection, Listing read, DeepSeek, Listing AI, ad AI explanation, and real ad readback evidence existed.

## Current 2026-08-26 Status

The v1.5.1 source and static Windows candidate now bind policy scope, keyword evidence, MissionGrant issuance and execution context to the same current-store authority chain. Exact completed-import evidence, latest Stage5 revision, canonical Stage6 identity/session where required, keyword `match_type`, proof hash and source-row cardinality all fail closed when stale or ambiguous. Execution evidence and progress remain bound to the selected store/batch/job/grant, and authority changes discard stale async results.

Focused authority verification passed 157/157; the allowed full unit gate passed 285/285 files and 3584/3584 tests; package script contracts passed 12/12. An independent read-only reviewer found no source blocker and passed 126/126 additional tests. Static `pnpm run build:win` passed all seven steps. Current SHA-256 values are installer `444802A1B282AC8EA28CA621ACA375229401DF650DB406B89926BCB9B7FEB956`, portable `637E7CC1E1BCAF3D2BE574D7D97563E70CDA1A5CD47FD52B955197EE81355A1D`, folder ZIP `CF1A80BC9D3F17B28071BDE49B1551C49C5644E7C171784AB058734352A7C534`, and Main bundle `1FAF882DA41047EA994B15EF73492BCFEE574A70AEFDBCD0CA8848527038FAB4`.

This is not an `APP_READY` closeout. The user prohibits typecheck, business smoke, Package UI, ZIP launch, current-package formal-DB pre/post verification, app/browser/desktop control and real Ads testing. Current-package runtime evidence and Task 8B write/reload proof therefore remain blocked; no Ads write occurred. ASAR-disabled and default-Electron-icon warnings remain recorded static packaging risks.

## Historical 2026-07-17 Status

The current external-security P1 candidate closes the three previous out-of-gate P1 findings. Main-window `will-navigate` and `will-redirect` accept only the exact development or packaged renderer document; development behavior also requires `!app.isPackaged`. Child-window requests are denied inside the app and only userinfo-free `http(s)` targets may be handed to `shell.openExternal`. Saved Lingxing passwords are resolved only in Electron Main; the Renderer receives non-secret status/username availability and keeps its password input empty. Legacy plaintext settings migrate transactionally into `safeStorage`, while unavailable, corrupt, and failed migration paths require safe re-entry without returning the secret to the UI. Login status distinguishes ready/warning/blocked/typed/pending paths and duplicate Enter/button submission is locked.

Final evidence is `output\codex-evidence\full-vitest-external-security-p1-20260717-final.json` (584/584 suites, 1992/1992 tests), `output\codex-evidence\package-launch-smoke-1784276358829.json` (PASS), `output\codex-evidence\package-security-boundaries-20260717-p1.json` (11/11), `output\codex-evidence\current-business-ui-smoke-1784276952256.json` (PASS), and schema-v5 package UI `output\codex-evidence\package-ui-evidence-20260717-p1\2026-07-17T08-21-12-482Z\manifest.json` (100%/125% each 8 workspaces + 3 overlays, plus wide Product/Diagnosis). Package identity is installer `A08715C80D660DDA615324FC146A164C5D3C19232BE6E55E90859348C9C01637`, portable `E8961E89B53A19F1C11D9A0DAFCC1797B0DE7C90B7972196B52D0F9F062FE1FE`, win-unpacked EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`, app content `8A9132109B9C2C6A4C1AA6A1EB18EFC675E53403004CF7000CC6C2A5C01AFF34`, and main bundle `74046AD904EE2DFFB77E892367F7D38E0BD695F89A5F7A88BE6EF97A848035B9`.

`output\codex-evidence\final-readiness-20260717-external-security-p1-non-ready.json` remains correctly `APP_NEEDS_WORK`, 7/8. The only external completion blocker is Task 8B: a current positive recommendation, human approval/Ads access, distinct real Amazon Ads v2 before/after/reload screenshots, and the correct authority-DB recommendationId. Once prerequisites exist, completion is estimated at 30–60 minutes. Non-blocking P2 follow-ups are a domain allowlist beyond the current protocol allowlist (optional 1–2 hours), stronger handling when a reused ERP session could otherwise save a password not verified on a visible login screen, and an adversarial-`NODE_ENV` packaged dynamic smoke.

READY and NON_READY safety now bind the win-unpacked EXE, app content, and `dist/main/index.js` hashes, require current package UI/package-security evidence, and reject stale bundle copies. The internal bundle `output\delivery-bundles\v15-delivery-bundle-20260717-external-security-p1-non-ready` was exported after documentation freeze and passed all 19 strict NON_READY safety checks. Current product management does not display a `凭证映射通过` or `Main Sandboxed ID` chip; those older claims are not valid current UI evidence.

Implementation rounds used focused tests. The recorded full regression is the final frozen-source evidence; documentation, export, and safety refresh do not trigger repeated full suites.

### Superseded UI P2 closeout

The current UI P2 candidate keeps the task-first 8-workspace / 16-legacy-route compatibility model and closes the Task 8A review follow-ups. Diagnosis Inspector now uses a diagnosis-specific two-column fact strip with non-breaking date tokens, bounded trend copy, and readable supporting-text contrast. Runtime evidence now includes explicit workspace error + retry, diagnosis AI busy, and diagnosis AI busy under reduced motion; the shared spinner has a static fallback. Package UI evidence is schema v5 with capped/redacted diagnostics and strict top-level plus per-run product/profile-browser process snapshots. Vitest defaults to `forks`; Electron shutdown is ordered scheduler → browser → DB with bounded per-resource timeout and continue-on-error cleanup. CRLF-sensitive fixture handling and the business-smoke assertion token split remove two Windows-only false-failure paths.

The delivery evidence for this code freeze is: final full regression `output\codex-evidence\ui-p2-full-vitest-20260717-final.json` at 170/170 files, 576/576 suites, 1950/1950 tests; workspace UI `output\codex-evidence\workspace-ui-task6\workspace-ui-evidence-run-2026-07-17T06-23-26-823Z.json` at 46/46; business smoke `output\codex-evidence\current-business-ui-smoke-1784270629248.json` at 5/5; package launch smoke `output\codex-evidence\package-launch-smoke-1784269772321.json` PASS; and package UI `output\codex-evidence\package-ui-evidence\2026-07-17T06-33-01-390Z\manifest.json` schema v5 PASS with 30 PNGs, zero console/page/dropped diagnostics, unchanged authority DB, and zero product/profile-browser residue before and after every run. `output\codex-evidence\final-readiness-20260717-ui-p2-non-ready.json` is correctly `APP_NEEDS_WORK`, 7/8, with only `real-ad-execution-readback` failing the formal readiness gates.

The superseded UI P2 NON_READY bundle was exported at `output\delivery-bundles\v15-delivery-bundle-20260717-ui-p2-non-ready\delivery-bundle-manifest.json` with manifest status `APP_NEEDS_WORK`, and strict `verify:v15-non-ready-safety` passed 17/17. At that snapshot, navigation/redirect, external-link, and legacy-credential P1 items were still open; the current external-security candidate above closes them. Task 8B still requires external human approval/access and distinct Ads UI before/after/reload evidence; once those prerequisites exist, its estimated execution and verification time is 30–60 minutes. Evaluation/audit artifact cleanup is nonblocking.

Testing discipline was deliberate: implementation rounds ran only focused incremental tests, followed by exactly one final full suite after code freeze. A separate orchestrator audit independently triggered an intermediate broad suite; that run is not used as delivery evidence and does not replace or duplicate the final frozen-suite record.

Historical Task 8A signoff remains Product/UX PASS 8.6/10, QA PASS 9.0/10, and Delivery Reviewer PASS 8.8/10, with P0=0 and P1=0 for that earlier local NON_READY handoff. The UI P2 candidate implements its P2 follow-ups and closes its own bundle/safety chain with current evidence; the historical signoff still does not approve external distribution, Task 8B, or an `APP_READY` claim.

## Historical Readiness — not current delivery authority

The following package hashes, READY bundles, safety results, and uses of “current” describe their dated historical snapshots only. They do not authorize the current eight-workspace package, current DB snapshot, or a new Ads action.

This document records the 2026-06-10 closeout and later package refreshes. At the historical 2026-07-03 prototype-parity snapshot, the packaged state was `APP_READY` for manifest-driven final-readiness `output\codex-evidence\final-readiness-1783043003005.json`, package launch smoke `output\codex-evidence\package-launch-smoke-1783043003005.json`, READY bundle `output\delivery-bundles\v15-delivery-bundle-2026-07-03T01-43-56-prototype-parity`, and matching `verify:v15-ready-safety` result. This includes 17 prototype-mapped pages with short operator-facing page titles and shared first-screen KPI rows, light-theme-only offline production tokens, explicit product field labels for current price/minimum acceptable price/targets, AI output contract tags, compact metric tags with focus dimming, business-domain navigation with active glow bar, Listing table editing, Listing local action busy feedback, Listing keyword heatmap and draft diff/skeleton/limit feedback, ad-quant metric focus filters, keyword-opportunity sortable headers and filter-axis feedback, approval decision feedback, data-collection and data-import busy feedback, OperatorTaskPanel shimmer/loading feedback, ProgressiveDetails summary feedback, global typography/button micro-response, FormTable focus feedback, scheduler/operation-scope/product-management/product-config/operation-event feedback, data-collection monitor drawer, delivery/readback evidence workflow feedback, live AI strategy JSON-contract fix, encrypted local remember-account/password support, readback screenshot capture, visible readback time/value safety contract cards, canonical daily metric accounting, and the dashboard product-selection gate. Live strategy evidence `output\codex-evidence\ad-strategy-live-1782358641101.json` returned `source=ai` with no fallback on that dated DB scope. Product-centered context remains the intended operator entry for ASIN-specific analysis: select the product in `产品管理`, let it populate `scope.asin`, then continue into ad quantification, recommendations, operation events, keywords, and Listing from that context. Historical manifest-driven final-readiness files, including `output\codex-evidence\final-readiness-1782964997320.json`, `output\codex-evidence\final-readiness-20260701095536.json` and `output\codex-evidence\final-readiness-2026-06-18-portable-fix.json`, remain baseline evidence only.


The 2026-06-26 keyword-opportunity refresh adds sortable `VirtualDataTable` headers and filter-axis micro-feedback to `关键词机会`: active headers expose `aria-sort`, render a 150ms rotating arrow, and sort filtered rows locally without mutating imported result order. Filter or sort changes update a stable `aria-live` result line and apply a 100ms vertical crossfade to the table shell. The 2026-06-30 refresh extends the same no-dead-click contract to the direct refresh action: `刷新机会` switches to `刷新中...`, renders a spinner, exposes `aria-busy=true`, carries `button-loading`, and locks row-level `带入 Listing` handoff while rows reload. This keeps the long-table virtual scrolling path while making sorting, filtering, and explicit refresh visible and reversible for operators.

The 2026-06-30 data-import validation row-thaw refresh applies the same operator-feedback standard to `数据导入与校验`: the 8-report validation table can sort by report, real file, extension, size, SHA-256 checksum, imported rows, and status; the page announces the active order and real-report/imported-row totals through `aria-live`; header clicks now trigger a reduced-motion-safe 200ms blur/sweep plus row fade-in refresh with a non-intercepting translucent overlay using `backdrop-filter: blur(2px)`, so sorting visibly completes without blocking the next action. Active imports still lock the table read-only by disabling sortable headers and row open-file buttons until SQLite writeback completes. This keeps import validation usable as a high-reliability table rather than a static checklist.

The 2026-06-26 operation-event refresh closes the last form-feedback gap on `运营事件`: submitting an event clears the form immediately, runs a short rebound animation, and shows that the local context write is in progress; if persistence fails, the submitted draft is restored so the operator does not lose the BD/Coupon/price/stock/Listing context they typed. Successful writes still flash the newest event card, and the page remains local-context only with no Ads or Listing mutation.

The 2026-06-30 operation-events save/refresh/delete action-button refresh closes the remaining no-dead-click gaps in the same page: the bottom `保存到上下文` action uses `operationEventInlineSaveButtonView`, manual `刷新` uses `operationEventRefreshButtonView`, and row-level `删除` uses `operationEventRowDeleteButtonView`. Only the real local save, refresh, or delete action shows `保存中...`, `刷新中...`, or `删除中...`, spinner, `aria-busy=true`, and `button-loading`; incomplete drafts and locked peer delete buttons remain plain unavailable states without running copy. This is still local operation-context feedback only and does not generate recommendations, approve actions, mutate Listing, or write Amazon Ads.

The 2026-07-01 operation-event timeline refresh closes the timeline-readback gap on `运营事件`: saved event cards now explicitly show an `AI 上下文` strip explaining which product/ad object/global scope and expected impact will enter ad quantification and AI diagnosis. Cards are keyboard focusable, expose a combined title/scope/impact/context `aria-label`, and use hover/focus/active isolation with a reduced-motion fallback. This is readability feedback only; it does not create recommendations, approve actions, mutate Listing, or write Amazon Ads.

The 2026-06-26 business-data pipeline refresh implements the spec's high-throughput query guard in the shared renderer data hook. First load and explicit reload/data-updated refreshes remain immediate, while scope-only changes are merged through a 300ms debounce and stale timers are cancelled before IPC. This keeps rapid ScopeBar/date/store/site/ASIN/batch edits from firing duplicate current-scope data reads across dashboard, collection, import validation, ad quantification, recommendations, approval, keywords, Listing, product, scope, and readback pages.

The 2026-06-26 Listing draft feedback refresh completes the spec's draft-comparison surface in `Listing 优化`: each heatmap section now shows red strikethrough chips for words removed from the current Listing, green chips for words added by the draft, a non-layout-shifting skeleton wave while local AI/rule draft generation is running, and red flashing character counters when title or bullet drafts exceed their configured limits.

The 2026-06-26 product-config bulk target ACOS refresh closes the product-target table gap on `产品配置`: current-scope product rows can be selected individually or via select-all, a toolbar accepts `目标 ACOS (%)`, and the page applies the normalized decimal target through the existing local `saveProductConfig` IPC. The action preserves product identity/cost fields, keeps failed selections visible, and is explicitly local configuration maintenance only, not recommendation approval or Ads execution.

The 2026-07-01 product-config bulk-selection feedback refresh closes the remaining pre-apply ambiguity on `产品配置`: the bulk target ACOS toolbar now shows `已选 X/N 个产品`, a compact progress rail, and an `aria-live` readback describing whether the local target ACOS write will affect selected products or none. This is selection feedback only; it does not save until the explicit bulk apply action runs, and it never approves recommendations or writes Amazon Ads.

The 2026-07-01 product-config row target ACOS edit refresh closes the remaining static-cell gap on `产品配置`: the current-scope product table target ACOS cell is now a compact percent input with ArrowUp/ArrowDown 0.5-point nudges, blur/Enter save, peer-row lock while one row is saving, and row-local `目标 ACOS 保存中...` / `目标 ACOS 已保存` / `目标 ACOS 保存失败` chips. This remains local product-target maintenance only and does not generate recommendations, approve actions, or write Amazon Ads.

The 2026-07-01 product-config row health refresh closes the missing table-readback gap on `产品配置`: the current-scope product table now includes a `健康度` column that maps target ACOS into `待配置`, `目标正常`, `需复核`, or `高风险` chips with stable percent detail. This is readability feedback only and does not generate recommendations, approve actions, or write Amazon Ads.

The 2026-06-30 product-config direct action-button refresh closes the remaining no-dead-click gap on `产品配置`: `保存完整产品配置` and bulk `应用到 X 个产品` now use `productConfigActionButtonView`, so only the active local save action shows `保存中...` or `批量应用中...`, spinner, `aria-busy=true`, and `button-loading`. Navigation peers lock as plain disabled buttons while the full-form save is pending, preventing conflicting clicks without making them look like running actions. This remains local product-target feedback only and does not generate recommendations, approve actions, or write Amazon Ads.

The 2026-06-30 product-config loaded-row confirmation refresh closes the remaining table-edit ambiguity on `产品配置`: the product row currently loaded into the edit form is visibly marked with `product-config-row-loaded`, the row action changes from `载入编辑` to `已载入`, `aria-pressed=true` identifies the active edit context, and the fixed `aria-live` message announces the loaded ASIN. This is local editing feedback only; it does not persist changes, approve recommendations, generate actions, or write Amazon Ads.

The 2026-06-30 settings rule-save action-button refresh closes the same no-dead-click gap in `AI 设置`: `保存广告阈值` now uses `settingsRuleActionButtonView`, so only the active local threshold save shows `保存中...`, spinner, `aria-busy=true`, and `button-loading`. Missing `saveRuleConfig` support remains a plain unavailable state without spinner or running copy. This remains local rule-configuration feedback only and does not generate recommendations, approve actions, or write Amazon Ads.

The 2026-06-30 settings local utility action-button refresh closes the remaining advanced Settings no-dead-click gap: `清除本地 AI Key` and `复制诊断检查清单` now use `settingsLocalActionButtonView`, so only the active local utility action shows `清除中...` or `复制中...`, spinner, `aria-busy=true`, and `button-loading`; the peer utility action locks as a plain disabled button. This remains local settings/diagnostic feedback only and does not change AI output contracts, generate recommendations, approve actions, or write Amazon Ads.

The 2026-06-26 ad-quant metric dimming refresh closes the focus-card attention contract on `广告量化`: `TagMetricGroup` supports opt-in inactive-chip dimming, and the ad-quant task panel enables it whenever the active focus is not `全部对象`. Non-active metric chips fade to 60% opacity and recover on hover/focus while staying clickable. Filtering rules, recommendations, approvals, and Ads execution state are unchanged.

The 2026-06-29 data-collection action-button refresh closes the remaining lower-action feedback gap on `数据采集`: `下载已创建`, `重建已选`, `重建全部 8 类`, and `导入本地` now share an explicit busy view model. The active action switches to `处理中...`, renders a spinner, exposes `aria-busy=true`, and keeps a blue striped progress surface while the button is disabled; sibling actions lock at the same time but do not visually impersonate the running action.

The 2026-06-30 data-collection feedback-action refresh closes the remaining no-dead-click gap in the same page's first-screen repair/diagnostic panel: `验证页面`, `重试获取 8 类`, and `重新获取完整 8 类报表` remain visible after they are clicked. Only the active feedback action switches to `处理中...`, renders the shared spinner, exposes `aria-busy=true`, and carries `button-loading`; peer repair/refresh actions lock as plain disabled controls. This is wait-state feedback only and does not change Lingxing collection, SQLite import, report readiness gates, recommendations, approvals, or Ads execution.

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

The 2026-06-30 recommendation direct action-button refresh closes the no-dead-click gap on `优化建议` direct actions: folded `刷新建议`, workflow-step `生成解释`, and empty-state `生成优化建议` now use `recommendationActionButtonView`. Only the active action switches to `刷新中...` or `生成中...`, renders a spinner, exposes `aria-busy=true`, and carries `button-loading`; missing real scope or pipeline loading remains a plain unavailable state. This is recommendation-page wait-state feedback only and does not bypass real-report gates, approve actions, or write Amazon Ads.

The 2026-06-30 delivery readback work-package action-button refresh closes the same no-dead-click gap on `交付验收`: `导出交付包`, `导出数据口径核对`, `创建回读工作包`, `检查工作包`, `生成回读证据`, `校验回读证据`, and `用回读证据刷新最终验收` now use `deliveryActionButtonView`. Only the active delivery action shows running copy, spinner, `aria-busy=true`, and `button-loading`; peer delivery actions lock as plain disabled controls. This is local delivery/readback evidence workflow feedback only and does not make a work package final proof, bypass `verify:ad-readback`, or write Amazon Ads.

The 2026-06-30 delivery summary-copy refresh closes the first-screen clipboard wait-state gap on `交付验收`: `复制摘要` now switches to `复制中...`, renders the shared spinner through `OperatorTaskPanel`, exposes `aria-busy=true`, and locks the peer first-screen action while the clipboard write is pending. This is local clipboard feedback only and does not change final-readiness evidence, export eligibility, or Ads execution state.

The 2026-06-30 readback evidence-workflow action-button refresh closes the same no-dead-click gap inside `执行回读`: `导出回读证据`, `创建回读工作包`, `检查工作包`, `生成回读证据`, and `校验回读证据` now use `readbackActionButtonView`. Only the active evidence-chain action shows running copy, spinner, `aria-busy=true`, and `button-loading`; peer evidence actions lock as plain disabled controls. This is local readback evidence workflow feedback only and does not make evidence final, bypass verifier gates, approve actions, or write Amazon Ads.

The 2026-06-30 readback local path-open refresh closes the remaining file/folder navigation wait-state gap on `执行回读`: `打开导出文件`, `打开工作包`, `打开填写文件`, and `打开填写说明` now use `readbackOpenPathButtonView`. Only the active path action switches to `打开中...`, shows the shared spinner, exposes `aria-busy=true`, and carries `button-loading`; peer path actions lock as plain disabled controls. This is Windows local path navigation feedback only and does not generate evidence, verify readback proof, approve actions, or write Amazon Ads.

The 2026-06-30 readback backup copy-command refresh closes the folded technical-command clipboard gap inside `执行回读`: backup commands for creating, checking, and filling readback work packages plus the long-argument fill command now switch the active button to `复制中...`, show the shared spinner, expose `aria-busy=true`, and lock peer copy buttons without making them look active. This is only backup-command clipboard feedback and does not make evidence final, bypass verifier gates, approve actions, or write Amazon Ads.

The 2026-06-30 data-collection report-selection feedback refresh closes the same dead-looking chooser gap on `数据采集`. The 8-report selector now has a stable selected-count chip, progress rail, `aria-live` status, selected-card styling, focus-within ring, and checked-state animation. This is target-selection feedback only; it does not create reports, import rows, or weaken the existing real-report and SQLite import gates.

The 2026-06-30 ad-quant AI-running radar and direct action-button busy feedback refresh closes the text-only pending gap on `广告量化`. While AI stage diagnosis is running, the feedback panel now exposes `aria-busy=true` and shows a contained radar sweep/pulse with reduced-motion fallback, so the operator sees the AI task is actively progressing. This is running-state feedback only; AI JSON contracts, formal recommendation gates, approval requirements, readback proof, and Ads execution remain unchanged.

The 2026-06-30 ad-quant direct action-button busy refresh closes the remaining in-page no-dead-click gap on `广告量化`: `运行 AI 阶段分析` and feedback-card `重新运行 AI` use `adQuantActionButtonView`, switch the active AI action to `AI 分析中...`, render the shared spinner, expose `aria-busy=true`, and lock recommendation-entry peers as plain disabled buttons while diagnosis is pending. This is local diagnosis feedback only and does not generate recommendations, approve actions, bypass readback proof, or write Amazon Ads.

The 2026-06-30 Listing heatmap focus feedback refresh completes the spec's clicked-root response on `Listing 优化`. Keyword rail buttons now expose `aria-pressed`, clicked roots flash on the rail item, matched section cards, and active token highlights, and a fixed `aria-live` status line announces which Listing sections are currently matched. This stays a local coverage-review interaction only and does not submit Amazon or modify Lingxing Listing.

The 2026-06-29 Listing heatmap containment refresh extends the spec-level high-density cell isolation contract to `Listing 优化`: left-side keyword rail cells now declare `contain: strict`, matching the existing strict containment on current/draft text cells while leaving auto-height outer sections content-driven. This keeps the heatmap interaction localized without risking layout collapse on variable Listing content.

The 2026-06-29 Listing local-draft workbench refresh closes the primary-copy gap on `Listing 优化`: keyword input, real-data gate, draft purpose, source counters, and generate/export actions now live in `关键词与本地草案工作台`. Missing real ad data is surfaced as `待补齐真实广告数据` and `仅本地预览`, not as placeholder copy, and the draft table still keeps source/evidence/risk detail for manual review. This improves operator comprehension without weakening the local-only, no-Amazon-submit boundary.

The 2026-06-30 Listing local action-button and history-refresh refresh closes the remaining local-action wait-state gap on `Listing 优化`: manual save, Lingxing read-only fill, version-history refresh, local draft generation, and draft export now use `listingLocalActionButtonView` plus `listingHistoryRefreshButtonView`. Only the active action switches to `保存中...`, `读取中...`, `刷新中...`, `生成中...`, or `导出中...`, renders a spinner, exposes `aria-busy=true`, and carries `button-loading`; sibling actions lock without pretending to be the running task. This is local version/draft feedback only and does not submit Amazon or modify Lingxing Listing.

The 2026-06-29 VirtualDataTable zebra refresh completes the shared heavy-table scanability contract. `关键词机会` and `数据导入与校验` now get alternating row backgrounds from actual virtual row indexes (`virtual-table-row-even` / `virtual-table-row-odd`) rather than DOM `nth-child`, so the visual striping stays stable when `@tanstack/react-virtual` recycles visible rows during long-table scrolling.

The 2026-06-29 ProgressiveDetails/direct details disclosure refresh completes the shared progressive-disclosure interaction contract. Every `ProgressiveDetails` summary now has a dedicated interaction surface with hover inset anchor, keyboard focus ring, active `scale(0.98)`, visible `展开`/`收起` chip, hidden native marker, and reduced-motion fallback. Direct native details summaries used by dashboard, detail panels, and evidence disclosures now share hover/focus/active feedback and reduced-motion fallback as well. This keeps detailed evidence and technical command walls folded without making the fold itself feel inert or ambiguous.

The 2026-06-29 global typography refresh completes the spec-level desktop typography contract. The renderer body now uses `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`, while body text, business-table cells, and virtual-table cells explicitly keep `line-height: 1.25`; this keeps mixed Chinese/English high-density report rows aligned without adding visual noise to the main window.

The 2026-06-25 approval-center refresh adds stamp-style decision feedback for approval and rejection paths. `SEALING`, `PASSED`, `REJECTED`, and `BLOCKED` are visible first-screen status states in `审批中心`; the active approve/reject button now also shows its own `处理中...` spinner/`aria-busy` state while the decision is being recorded. The three-state decision strip also fades non-focused available actions to 40% opacity on hover/focus, so the active approve/review/reject choice is visually isolated. The 2026-06-26 queue-exit refresh adds visible closure after a successful approve or reject: the decided row slides out for 180ms, leaves the local visible queue, and then the page reloads the authoritative queue. These acknowledge local decision recording only and do not replace the manual Ads UI execution/readback proof chain. The same package adds `优化建议` status-bucket filtering plus batch selection for formal-approval-ready rows; bucket filtering is visual triage only, batch handoff only passes selected recommendation IDs to `审批中心` as UI context, and every row still requires per-row approval and readback evidence before any manual Ads UI action.

## Current external-security P1 Evidence

| Gate | Evidence |
| --- | --- |
| Final readiness | `output\codex-evidence\final-readiness-20260717-external-security-p1-non-ready.json` (`APP_NEEDS_WORK`, 7/8; only Task 8B fails) |
| Full regression | `output\codex-evidence\full-vitest-external-security-p1-20260717-final.json` (584/584 suites, 1992/1992 tests) |
| Package launch smoke | `output\codex-evidence\package-launch-smoke-1784276358829.json` (PASS) |
| Package UI | `output\codex-evidence\package-ui-evidence-20260717-p1\2026-07-17T08-21-12-482Z\manifest.json` (schema v5 PASS; 100%/125% each 8 workspaces + 3 overlays; wide Product/Diagnosis) |
| Package security | `output\codex-evidence\package-security-boundaries-20260717-p1.json` (11/11 PASS) |
| Business smoke | `output\codex-evidence\current-business-ui-smoke-1784276952256.json` (PASS) |
| Installer SHA-256 | `A08715C80D660DDA615324FC146A164C5D3C19232BE6E55E90859348C9C01637` |
| Portable SHA-256 | `E8961E89B53A19F1C11D9A0DAFCC1797B0DE7C90B7972196B52D0F9F062FE1FE` |
| win-unpacked EXE SHA-256 | `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89` |
| App content SHA-256 | `8A9132109B9C2C6A4C1AA6A1EB18EFC675E53403004CF7000CC6C2A5C01AFF34` |
| Main bundle SHA-256 | `74046AD904EE2DFFB77E892367F7D38E0BD695F89A5F7A88BE6EF97A848035B9` |
| Current NON_READY bundle | `output\delivery-bundles\v15-delivery-bundle-20260717-external-security-p1-non-ready` (exported after docs freeze; strict safety 19/19 PASS) |

## Superseded UI P2 Evidence

Historical evidence for this superseded snapshot:

| Gate | Evidence |
| --- | --- |
| Final readiness | `output\codex-evidence\final-readiness-20260717-ui-p2-non-ready.json`（`APP_NEEDS_WORK`，7/8 gates passed；唯一失败门为 `real-ad-execution-readback`） |
| Evidence selection | `output\codex-evidence\v15-final-readiness-evidence-manifest-20260717-ui-p2-non-ready.json` |
| Delivery bundle | `output\delivery-bundles\v15-delivery-bundle-20260717-ui-p2-non-ready\delivery-bundle-manifest.json`（已导出；manifest status `APP_NEEDS_WORK`） |
| NON_READY safety | 严格 `verify:v15-non-ready-safety` 17/17 PASS；结果仅属于已取代的 UI P2 bundle，不复用 Task 8A 或当前 external-security 结果 |
| Package launch smoke | `output\codex-evidence\package-launch-smoke-1784269772321.json`（win-unpacked + portable PASS） |
| Package UI evidence | `output\codex-evidence\package-ui-evidence\2026-07-17T06-33-01-390Z\manifest.json`（schema v5；100%/125% + 1400×900 PASS；30 PNG、0 console/page/dropped diagnostics；每轮 DB/product/profile-browser isolation PASS） |
| Workspace UI evidence | `output\codex-evidence\workspace-ui-task6\workspace-ui-evidence-run-2026-07-17T06-23-26-823Z.json`（46/46，包含 error/retry、AI busy 与 reduced-motion） |
| Business UI smoke | `output\codex-evidence\current-business-ui-smoke-1784270629248.json`（5/5） |
| Full regression | `output\codex-evidence\ui-p2-full-vitest-20260717-final.json`（170/170 files，576/576 suites，1950/1950 tests） |
| Snapshot report/import authority | `batch_20260625013151957_ajw0nb`（8/8 imported report types，6827 imported total rows；产品页 1879 为当时所选 ASIN） |
| Authority DB snapshot SHA-256 | `9E82065E780B38A4D3348F4EE723DDF1A50142F3900192E612730CC1C8017439` |
| Live ad strategy diagnosis | `output\codex-evidence\ad-strategy-live-1782358641101.json` |
| Historical 2026-06-10 bundle | `output\delivery-bundles\v15-delivery-bundle-2026-06-10T07-00-21-859Z\delivery-bundle-manifest.json` |
| Product UI smoke | `output\codex-evidence\v15-product-readiness-ui-smoke-1781072779324.json` |
| Installer | `apps\desktop\release\AmazonAIOpsAgent-1.5.0.exe` |

Historical UI P2 package artifacts:

| Field | Value |
| --- | --- |
| Installer SHA-256 | `B5358B497FDABB956152EA2CAE419D82B612BC92736433FF9BD6B1DDA36CD5D9` |
| Installer size | `80,935,313` bytes |
| Installer last write | `2026-07-17T06:28:27Z` |
| Portable/no-install SHA-256 | `CE41FCF95EF592B839CFF3660B1C9DB11A2F546FB7F38D0CDD7160CA27E51B48` |
| Portable/no-install size | `80,769,562` bytes |
| Portable/no-install last write | `2026-07-17T06:28:29Z` |
| win-unpacked SHA-256 | `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89` |
| App content SHA-256 | `7C6BC0BA9EE2E99D7B02256143E7044757C11135ACFD3F1CE5059F6437511F8E` |
| Authority DB SHA-256 | `9E82065E780B38A4D3348F4EE723DDF1A50142F3900192E612730CC1C8017439` |

Superseded pre-drawer-layout package facts (historical only): installer `4104B07DAED970CEB7C805225C642CF3284FAE3C6535715201524A0CEFD19693`, portable `FA1D315F478CE751A301F5ED7B07111E8D012620C2B8BB0332E748CAF4CC9A31`, win-unpacked EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`, app content `43DB54D577CAD1C5144B8262E0B85402CD411846BB81EC98613A8098AFB6B903`, smoke `output\codex-evidence\package-launch-smoke-1784098235751.json`, evidence manifest `output\codex-evidence\v15-final-readiness-evidence-manifest-2026-07-15T06-51-17-826Z.json`, and final readiness `output\codex-evidence\final-readiness-2026-07-15T06-51-27-719Z.json`. These values cannot be used for the final candidate.

## Current Verification Snapshot

| Check | Result |
| --- | --- |
| Final full Vitest | 584/584 suites and 1992/1992 tests passed at `output\codex-evidence\full-vitest-external-security-p1-20260717-final.json` |
| Package launch | PASS at `output\codex-evidence\package-launch-smoke-1784276358829.json` |
| Package UI | Schema v5 PASS at `output\codex-evidence\package-ui-evidence-20260717-p1\2026-07-17T08-21-12-482Z\manifest.json` |
| Package security | 11/11 PASS at `output\codex-evidence\package-security-boundaries-20260717-p1.json` |
| Current business UI smoke | PASS at `output\codex-evidence\current-business-ui-smoke-1784276952256.json` |
| Final readiness | `APP_NEEDS_WORK`, 7/8; only `real-ad-execution-readback` fails |
| READY/NON_READY safety contract | Both bind EXE, app content, and main bundle plus exact package UI/package-security bundle copies; current NON_READY bundle passed all 19 strict checks after documentation freeze |

## Superseded UI P2 Verification Snapshot

Completed final-node checks:

| Check | Result |
| --- | --- |
| Final full Vitest | 170/170 files, 576/576 suites, and 1950/1950 tests passed at `output\codex-evidence\ui-p2-full-vitest-20260717-final.json`; this is the single deliberate full suite after code freeze |
| `pnpm -r run typecheck` | Passed for the final Windows candidate |
| Workspace UI evidence | Passed 46/46, including workspace error/retry, AI busy, and AI busy/reduced-motion states |
| Current business UI smoke | Passed 5/5 |
| `pnpm --filter @amazon-ai-ops/desktop run build:win` | Passed; final installer and portable hashes recorded above |
| Packaged UI 100%/125% + wide | Schema v5 passed at `output\codex-evidence\package-ui-evidence\2026-07-17T06-33-01-390Z\manifest.json`; compact runs each have 8/8 workspaces and 3/3 overlays, wide Product/Diagnosis verifies 8-row capacity and inline inspectors, 30 PNGs total, 0 console/page/dropped diagnostics, unchanged protected DB, and no product/profile-browser residue before or after any run |
| Current data authority | Passed: `batch_20260625013151957_ajw0nb` has 8/8 imported report types and 6827 total rows; product page 1879 is current-ASIN only |
| Package launch smoke | Passed at `output\codex-evidence\package-launch-smoke-1784269772321.json` |
| Delivery safety | Current UI P2 NON_READY bundle is exported with `APP_NEEDS_WORK`; strict NON_READY safety passes 17/17. READY safety remains externally blocked by Task 8B |

Historical 2026-06-10 post-audit fix:

- The stale delivery bundle found by `testing-reality-checker` was re-exported.
- The new bundle is `output\delivery-bundles\v15-delivery-bundle-2026-06-10T07-00-21-859Z`.
- The current source, bundle copy, and manifest SHA-256 values match for `docs/V1_5_PROGRESS_REPORT.md`, `docs/V1_5_ACCEPTANCE_MATRIX.md`, and `docs/REAL_AD_READBACK_RUNBOOK.md`.
- The stale pre-release wording identified by QA is absent from the current bundle docs.

## Safety Boundary

The app is an `APP_NEEDS_WORK` NON_READY candidate with the following explicit boundary. The three external-security P1 hardening items are complete; the post-documentation bundle export and strict NON_READY safety are complete, and external completion remains blocked only by Task 8B:

- Historical real ad execution readiness was demonstrated by one user-approved, low-risk manual Ads UI sample on a paused FT-US keyword row `door lock`, with live bid `1.30 -> 1.17`. It is baseline evidence only and does not satisfy the current v2 positive recommendation id/revision and SQLite authority contract.
- The app-side ad execution button remains fail-closed. It does not batch-write ads.
- The `执行回读` time/value contract cards are pre-export UX checks only; they help operators see blockers early but do not replace distinct screenshots, valid time ordering, before/after value change, readback equality, and `verify:ad-readback`.
- Future ad changes must each bind their own store, marketplace, portfolio, campaign, ad group, ASIN, entity type, entity name, action type, source recommendation, real source report file(s), original source row, live before value, live after value, approval proof, screenshots, and readback evidence.
- The verified D6 paused-target sample must not be reused as proof for another product, ad group, target, or bid.
- Navigation/redirect/window-open allowlists, packaged dev-downgrade prevention, Main-only saved passwords, and legacy plaintext migration are implemented and package-security evidence passes 11/11.
- Task 8B still requires a current positive recommendation, human approval/access, distinct Amazon Ads v2 before/after/reload screenshots, and the correct authority-DB recommendationId; estimated completion is 30–60 minutes once prerequisites exist.
- P2-only follow-ups are domain-level external-link allowlisting beyond `http(s)` (optional 1–2 hours), reused-ERP-session password validation, and an adversarial-`NODE_ENV` packaged dynamic smoke.

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
