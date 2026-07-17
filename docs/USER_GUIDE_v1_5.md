# Amazon AI Ops Agent v1.5 User Guide

## Scope

This guide covers the v1.5 local workflow for:

- Lingxing advertising report collection batch records.
- Search Term / SQP / keyword report import.
- Listing content import or manual entry.
- Keyword opportunity analysis.
- Listing suggestions, drafts, accept / ignore status, and exports.

The app remains local-first. It does not connect to Amazon SP-API or Amazon Ads API, and it does not automatically modify Amazon Listing content.

## Start

1. Open Amazon AI Ops Agent.
2. Log in to Lingxing ERP through the visible browser session. The desktop app validates ERP first and then enters the Ads system through the ERP `广告` entry; it should not start by directly opening an Ads URL. After login, the header shows the ERP/Ads session status, including the Ads page title or URL when available. The verified Ads home after ERP entry is `https://ads.lingxing.com/home`, and the verified Ads download center is `https://ads.lingxing.com/ak_download/download_center/download_report_log/index`.
   While login is running, the submit button switches to `正在确认 ERP 和 Ads 会话...`, shows a spinner, exposes `aria-busy=true`, and blocks duplicate submission. The account/password save notice stays in the fixed status line and only describes local encrypted storage; it does not mean credentials are written into repo files or visible renderer state.
3. Use the 8 visible workspaces in the left menu. When a workspace has several tools, choose its tab at the top of the workspace:
   - `今日任务`: review the current work context, data health, report coverage, imported rows, AI state, pending decisions, USD spend/sales/orders, ACOS, and the next safe action.
   - `产品工作台` -> `产品` / `目标与成本` / `运营事件`: select and lock the current product, maintain cost and advertising targets, and record the business context that affects later diagnosis.
   - `数据准备` -> `工作范围` / `报表采集` / `导入检查`: confirm date/store/site/batch/ASIN scope, obtain all 8 real Lingxing Ads reports, and verify their per-report SQLite import state. Import writes lock sorting and row actions until the refreshed authoritative data returns.
   - `广告诊断`: inspect DB-backed advertising metrics, focus filters, rule thresholds, and AI strategy interpretation for the current scope.
   - `建议与审批` -> `待判断` / `待审批` / `已决策`: review suggested actions, make explicit human decisions, and inspect decided records. Approval still does not mean Ads execution.
   - `结果核对`: select an approved action, record approval and before/after manual Ads UI evidence, enter the refreshed value, and export local readback evidence for that specific action.
   - `关键词与 Listing` -> `关键词机会` / `Listing 草案`: review deduplicated keyword opportunities and prepare local-only Listing drafts. Drafts are never submitted to Amazon or written back to Lingxing.
   - `系统与交付` -> `AI 与规则` / `定时任务` / `交付验收`: configure AI and local rules, inspect local automation, and verify package/readiness evidence. `交付验收` is a proof page, not a daily operation workbench.

   Legacy deep links may still use old route names for compatibility, but those names are not separate items in the current left menu. Follow the workspace and tab labels above when navigating in the final package.

The 2026-07-17 task-first build exposes 8 visible workspaces and preserves the v2 readback authority contract, fail-closed delivery gating, per-report data truth, encrypted AI Key persistence, and scheduler/product persistence hardening. The final full regression passes 170/170 test files, 575/575 suites, and 1920/1920 tests. Runtime evidence records 43/43 workspace targets and 5/5 business UI smoke scripts. The final Windows candidate passed win-unpacked/portable launch smoke, two isolated real-package UI runs at 100% and 125%, and a 1400×900 Product/Diagnosis wide profile. The compact runs each cover 8/8 workspaces and 3/3 overlays; the wide run verifies 8-row queue capacity plus inline inspectors, yielding 30 PNG files in total with zero console/page errors. The package UI manifest also records an unchanged protected SQLite DB snapshot before/after, zero matching product processes, and no remaining profile Chromium after the controlled async shutdown chain. Formal analysis requires both 8/8 report files and 8/8 per-type imports, and the latest real batch `batch_20260625013151957_ajw0nb` satisfies all 8 imported report types with 6827 imported rows. The 1879 rows shown on the product page are the current ASIN's metrics, not the database-wide total. Business readiness nevertheless remains `APP_NEEDS_WORK`: 7/8 final-readiness gates pass and only `real-ad-execution-readback` still fails against authority DB `C:\Users\wz\AppData\Roaming\@amazon-ai-ops\desktop\amazon-ai-ops.db`. Do not present this package as `APP_READY` until a newly approved action is executed and read back through the current workflow.

| Current package fact | Value |
|---|---|
| Installer SHA-256 | `3BCC87F4A2FD25ECB47E450D04D215D7C0A546CB121438F0B4CB22D3B5492426` |
| Portable SHA-256 | `413209648DDB33906360833B7BEC0759CABBA12E935CD2A0444D07F717EB7C9E` |
| win-unpacked EXE SHA-256 | `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89` |
| App content SHA-256 | `505AF5AB0B9F63B3C970A00475D29BBC57478357932CC6228BB26CE633595BC0` |
| Authority DB snapshot SHA-256 | `9E82065E780B38A4D3348F4EE723DDF1A50142F3900192E612730CC1C8017439` |
| Package UI | `output\codex-evidence\package-ui-evidence\2026-07-17T04-16-32-110Z\manifest.json` |
| Workspace UI | `output\codex-evidence\workspace-ui-task6\workspace-ui-evidence-run-2026-07-17T04-25-13-089Z.json` (43/43) |
| Business UI smoke | `output\codex-evidence\current-business-ui-smoke-1784262294451.json` (5/5) |
| Full regression | `output\codex-evidence\task8a-full-vitest-20260717-final.json` (170/170 files, 575/575 suites, 1920/1920 tests) |
| Package launch smoke | `output\codex-evidence\package-launch-smoke-1784261752633.json` |
| Evidence selection | `output\codex-evidence\v15-final-readiness-evidence-manifest-20260717-task8a-non-ready.json` |
| Final readiness | `output\codex-evidence\final-readiness-20260717-task8a-non-ready.json` (`APP_NEEDS_WORK`, 7/8) |
| Current data batch | `batch_20260625013151957_ajw0nb`: 8/8 imported report types, 6827 total imported rows; product-page 1879 is current-ASIN only |
| NON_READY bundle | `output\delivery-bundles\v15-delivery-bundle-20260717-task8a-non-ready` (exported and verified by the current 17/17 strict NON_READY safety gate) |

Superseded package UI runs from 2026-07-15/16 and the pre-shutdown-fix `2026-07-17T04-02-25-468Z` run are retained only to explain the repair sequence. They are not current delivery proof.

The following 2026-07-03 package description is retained as historical baseline only; its hashes and READY result do not authorize the current package:

Historical 2026-07-03 no-install executable for validation: `apps\desktop\release\AmazonAIOpsAgent-1.5.0-portable.exe`, SHA-256 `849E5C11D5F4742C936FB4A532E1435B3D33B76187E561CB912A08FA6F673CB9`. Launch smoke evidence: `output\codex-evidence\package-launch-smoke-1783043003005.json`. This build includes the prototype-parity UI refactor with 17 prototype-mapped pages using short operator-facing titles, shared first-screen KPI rows, local/system font stack, light-theme-only production tokens, explicit product cost/current price/minimum acceptable price/target field labels, plus encrypted local remember-account/password support, login submit `aria-busy`/spinner and stable credential status feedback, first-viewport AI/import feedback, approval decision stamp feedback, approval decision-button `处理中...`/spinner/`aria-busy` feedback, approval queue row slide-out/removal feedback, recommendation batch-selection count chip plus checkbox focus/checked micro-response, OperatorTaskPanel action loading/spinner feedback, OperatorTaskPanel shimmer sweep, ProgressiveDetails and direct details disclosure hover/focus/active feedback, global typography contract, global button active scale feedback, state-light hover lift feedback, MicroStepper status indicator feedback, operation-scope first-screen confirmation feedback, page-level range form field confirmations, non-layout-shifting ScopeBar editor popover, ScopeBar editor save action-button busy feedback, shared business-data pipeline 300ms scope-change debounce with immediate explicit reload, product-management first-screen product-locking, product-card locked/idle tags, selection `aria-live` readback, product-save button busy/spinner/`aria-busy` feedback, and credential sandbox hover feedback, product-config first-screen task, loaded-row confirmation feedback, direct save/bulk button busy feedback, bulk selection count/progress feedback, keyboard nudge, live target health chips, and inline autosave feedback, operation-event first-screen task feedback with immediate clear/rebound, failure draft restore, timeline AI-context readback, and card hover/focus isolation, settings threshold field-level validation feedback, settings rule-save/local utility action-button busy feedback, scheduler first-screen local task feedback plus scheduler controller/row action-button busy feedback, data-collection monitor drawer with Canvas browser preview, data-collection action-button `aria-busy`/spinner/striped-progress feedback plus feedback repair/refresh button spinner/`aria-busy` feedback, data-import direct import/export `处理中...`/spinner/`aria-busy` feedback, delivery readback repair handoff, ad-quant metric focus filters with inactive-chip 60% dimming, ad-quant AI-running radar and direct action-button busy feedback, canonical daily ad metric explanation, ad readback screenshot paste/drop capture with drag-over feedback plus fixed thumbnail/badge confirmation, readback time/value contract cards, readback safety checkbox hover/focus/press/checked confirmation feedback, heavy table virtualization with actual-row zebra striping and row press/focus feedback plus sortable header arrow/ARIA, 100ms filter-result feedback, and refresh action-button busy feedback for `关键词机会`, heavy table virtualization plus sortable report/file/type/size/SHA-256/row/status headers, import-time read-only table lock, `aria-live` summary, and 200ms blur/sweep plus row fade-in refresh for `数据导入与校验`, Listing local save/read/history-refresh/generate/export button busy feedback, Listing keyword heatmap coverage with strict-contained keyword rail cells, draft diff chips, generation skeleton feedback, and over-limit character alarms, the Lingxing report creation fix that commits the date range picker after filling the start/end dates, the product-level workbench refresh that requires an explicit product before ASIN-specific analysis, and the live ad strategy diagnosis JSON-contract fix verified by `output\codex-evidence\ad-strategy-live-1782358641101.json`. In `审批中心`, hover or keyboard-focus one of the three decision buttons to keep that choice prominent while the other available choices fade; while approve or reject is being recorded, the active button changes to `处理中...`, shows a spinner, exposes `aria-busy=true`, and locks the other decision action. After a successful approve or reject, the decided row briefly slides out and is removed from the visible queue before the page reloads the authoritative queue. In `产品管理`, selected product cards expose `aria-pressed`, show `点击锁定` / `已锁定` tags, and write a fixed `aria-live` line when the product context is locked; `保存产品信息` switches to `保存中...` with spinner/`aria-busy` while `打开完整配置` locks as a plain peer; hover or keyboard-focus `凭证映射通过` to inspect the Main sandbox channel summary, which intentionally shows only the sandbox ID, site/period, and no-plaintext-retention statement.

On `今日任务`, the first-screen primary task answers the operator's next question instead of always opening product management. If no ASIN/product scope is selected, it sends the operator to `产品工作台` -> `产品`; after product scope exists, it follows the current evidence gate and routes to the next safe workspace or tab, such as `数据准备` -> `报表采集`, `数据准备` -> `导入检查`, `广告诊断`, or `建议与审批`. The header also shows the current blocker/ready state as `当前主任务` and the button label as `建议下一步`, so the operator can see why that action is safe before clicking.

Clicking the `今日看板` first-screen primary task button immediately changes that button to `转跳中...`. During the same short handoff, the `数据健康` state-light grid runs a blue pulse/sweep refresh so the operator sees that the dashboard accepted the action before the route changes. The pulse is feedback only; it does not refresh or mutate the underlying reports, recommendations, approvals, or Ads state.

All sidebar and in-page route changes now share the same navigation handoff. When a route click is accepted, the target nav item shows `转跳中...`, exposes `aria-busy=true`, and briefly locks sibling nav actions; the main canvas shows a small non-layout-shifting `转跳中...` status pill. This only confirms navigation is being handed off and does not change scope, data, approvals, recommendations, or Ads execution.

Old `product-config` deep links are still accepted for compatibility, but the visible navigation now anchors them under `产品工作台` and opens the relevant `产品` or `目标与成本` tab. Product repair and configuration actions from `产品工作台` and `系统与交付` -> `交付验收` return to that shared product context, where ASIN selection, product identity, cost, minimum price, and target thresholds are maintained.

Across pages that use `OperatorTaskPanel`, first-screen task actions are group-locked while one action is busy. The running action shows `处理中...` or the page-specific running copy, a spinner, and `aria-busy=true`; sibling actions are disabled at the same time but keep their normal label and do not show a spinner. This means the click was accepted and the page is preventing duplicate or conflicting operations.

Read-only first-screen status cards now use quiet hover feedback without moving the layout, while safety gates remain visually stronger with red blocked emphasis. This makes metadata easier to scan without making it look like a clickable task, and keeps approval/readback/delivery blockers more prominent than ordinary status tags.

## 定时任务

Open `系统与交付` -> `定时任务` when you need to inspect or manually trigger local automation.

1. Start from the first-screen local scheduler task panel. It shows how many tasks are enabled, the next visible run, the latest run, and the hard boundary that local scheduling cannot write Amazon Ads.
2. Click `刷新调度状态` to reread the task list from the main process. The first-screen task action and the lower controller button both enter the shared busy state while scheduler status is loading.
3. Click a row's manual run action only when you intend to trigger that local task. The first click opens a confirmation state in the top task panel; it does not immediately run the task.
4. Click `执行本地任务` only after checking the named task and purpose. The confirmation button shows `执行中...`, spinner, and `aria-busy=true` while the local task is running.
5. Use row-level `启用` / `停用` only to control local scheduling. The clicked row button changes to `启用中...` or `停用中...`, shows a spinner, and locks peer scheduler controls until the IPC call returns.
6. Read the fixed `aria-live` feedback line after refresh, confirmation, success, or failure. It keeps scheduler errors visible instead of hiding them in the lower table.

Scheduler busy feedback is only local task feedback. It does not approve suggestions, change bids, add negatives, pause ads, or write Amazon Ads.

## 工作范围

Open `数据准备` -> `工作范围` before starting a new analysis pass or when you suspect the current data does not match the ERP view.

1. Review the first-screen task panel and the sticky `当前工作范围：` bar. They summarize product, real report coverage, imported metric rows, trace batch, and USD scope.
2. Click `确认并保存范围` to persist the current date, store, marketplace, batch, ASIN, and currency. While saving, the button is disabled and shows the running state.
3. Read the fixed feedback line under the task metrics. It reports whether the scope is unsaved, saving, saved, or failed without shifting the page.
4. Use the `范围表单` on the page to adjust store, marketplace, date range, ASIN, or batch without leaving the workflow.
5. Each changed field in the page form flashes a small green confirmation line in its own reserved space. This confirms the value has been recorded in the draft scope without moving nearby controls.
6. Click `确认并保存范围` after editing. The normalized draft is persisted through the same local `saveOperationScope` path before downstream pages read it.
7. Use `编辑范围` only when you want the sticky ScopeBar popover; it remains a non-layout-shifting secondary entry. Its `保存范围` action changes to `正在保存...`, shows a spinner, exposes `aria-busy=true`, and keeps the popover open with an error message if local scope persistence fails.
8. Use the next-step action suggested by the page: no reports routes to `数据准备` -> `报表采集`, downloaded-but-unimported reports route to `数据准备` -> `导入检查`, and imported metrics route to `广告诊断`.

## 产品管理

Open `产品工作台` -> `产品` when the work is about a specific ASIN. The page separates browsing, saving, and locking so a review action cannot silently change the shared operation scope.

1. Start from the compact first-screen task banner. It shows the locked product, current data gate, and the next safe action without pushing the product queue below the first viewport.
2. Review `产品对象队列`. Selecting a row opens its responsive Inspector and keeps the global ASIN unchanged; the fixed status line explicitly says that the row is only being viewed.
3. Use the row-level `锁定` button or the Inspector action `锁定为当前产品` when you intentionally want downstream `广告诊断`, `建议与审批`, `运营事件`, `关键词机会`, and `Listing 草案` to read that ASIN. Only these explicit lock actions change the shared product scope.
4. Use the Inspector `维护` tab to edit ASIN, title, MSKU/SKU, stage, status, purchase/FBA/min-price fields, target ACOS/TACOS, and target margin. `保存产品信息` updates local product configuration only; it does not lock or switch the global ASIN. While saving, the button shows `保存中...` with spinner/`aria-busy`, locks its peer action, and writes saving/saved/error feedback into the fixed task status line.
5. Use the Inspector `概览` tab to compare ad spend, sales, orders, risk count, product stage, and event count before deciding whether to lock the product.
6. Use the Inspector `日级` tab to inspect the viewed product's daily DB metrics. If this view is empty, collect/import the current 8 Lingxing report set before running AI.
7. Use the Inspector `事件` tab to read product events, ad-object events, and global events together. Global events such as BD, Coupon, stock, pricing, or Listing changes remain visible in product analysis, but events from other ASINs are excluded.
8. Use the action buttons to maintain operation events, open keyword opportunities, open Listing optimization, or enter AI quantification for the selected product. These actions navigate only; they do not approve or execute ad changes.

## 目标与成本

Open `产品工作台` -> `目标与成本` when the selected product needs cost, minimum price, margin, ACOS, or TACOS thresholds.

1. Use the first-screen task panel to save the current target configuration or jump to ad quantification.
2. Fill ASIN before saving. Without an ASIN, downstream AI and rule thresholds cannot bind the product context.
3. Cost, minimum price, target net margin, target ACOS, and target TACOS fields support ArrowUp/ArrowDown nudges. The right-side inline status immediately shows the adjusted state, then blur or Enter saves through the existing autosave path. The fixed-cost, margin, ACOS, and TACOS chips recolor from the draft value before saving.
4. Use `载入编辑` in the current-scope product table to bring one row into the form. The loaded row is highlighted, the row action changes to `已载入`, the button exposes `aria-pressed=true`, and the fixed feedback line reads back the ASIN so the edit context is clear before saving.
5. Edit `目标 ACOS` directly in the current-scope product table when only one row needs a quick threshold change. The cell accepts a percent value, supports ArrowUp/ArrowDown 0.5-point nudges, and saves on blur or Enter. The same row shows `目标 ACOS 保存中...`, `目标 ACOS 已保存`, or `目标 ACOS 保存失败` without resizing the table.
6. Read the `健康度` column before leaving the table. It translates the row target ACOS into `待配置`, `目标正常`, `需复核`, or `高风险`, with a stable target-percent detail line so the risk meaning is visible without mental conversion.
7. Use the current-scope product table when several products need the same target ACOS. Select one or more rows, enter `目标 ACOS (%)` such as `35`, and click `应用到 X 个产品`. While the bulk save is running, the button changes to `批量应用中...`, shows a spinner/`aria-busy`, and locks the toolbar inputs until the local save returns. The page converts the percent into the local decimal threshold, saves through `saveProductConfig`, keeps failed rows selected, and reports success or failure in the fixed feedback line.
8. The row-level and bulk ACOS controls only update local product configuration. They do not approve recommendations, generate AI advice, execute bid changes, or write Amazon Ads.
9. The bottom `保存完整产品配置` action remains available for saving the whole form after changing base product fields such as title, SKU, stage, or status. During the save it changes to `保存中...`, shows a spinner/`aria-busy`, and locks `补充运营事件` plus `查看广告表现` as plain disabled peers so the running action is unambiguous.

## 广告表现

Open `广告诊断` after the current scope has real Lingxing reports and imported DB metrics.

1. Start from the first-screen task panel. It reports the current product/scope, whether AI strategy diagnosis can run, and the current metric focus view.
2. Click the metric chips to focus the page: `全部对象`, `浪费超支`, `高 ACOS`, `出单对象`, `可扩量`, or `待复核`.
3. When the focus is not `全部对象`, inactive metric chips fade to 60% opacity and recover on hover/focus. This is only attention management; the dimmed chips remain clickable.
4. After a chip is clicked, read the fixed focus line. It shows `visible/total` and confirms that the focus only changes the current view.
5. Review `产品/广告对象阶段时间线`, `主要问题摘要`, `复核队列`, and `实体诊断`; these sections follow the selected focus so the operator can inspect one risk dimension at a time.
6. Click `运行 AI 阶段分析` only after the current scope has real report data. During the diagnosis, both this in-page button and any feedback-card `重新运行 AI` retry action switch to `AI 分析中...`, show a spinner, expose `aria-busy=true`, and lock the recommendation-entry peers as plain disabled buttons.
7. The focus filter and AI-running feedback do not create recommendations, approve rows, execute Ads changes, or write Amazon Ads. Use `优化建议`, `审批中心`, and `结果核对` for those separate safety steps.

## 运营事件

Open `产品工作台` -> `运营事件` when advertising interpretation needs business context such as BD, Coupon, price changes, stock changes, review events, or Listing edits.

1. Use the first-screen task panel to confirm whether the current product/global scope already has context events.
2. Click `记录事件` to save the current form through the task panel. The form clears immediately and gives a short rebound response while the page says it is writing the event into local context.
3. While saving, the main action is disabled and shows the running state. If persistence fails, the form restores the draft you just submitted so it can be corrected or retried.
4. The lower form button is labeled `保存到上下文`; use it when you are already editing the form area and do not need the top task action. While the local save is pending it changes to `保存中...`, shows a spinner, exposes `aria-busy=true`, and carries `button-loading`; incomplete drafts remain a plain disabled state.
5. Manual refresh and row deletion also have explicit wait states. `刷新` changes to `刷新中...`; the event row being removed changes to `删除中...`, shows the spinner, exposes `aria-busy=true`, and locks peer delete buttons as plain disabled controls until the local DB operation returns.
6. After saving, the newest event card flashes briefly so the operator can see that the local context record was actually written. This still only updates local context; it does not modify Amazon Ads or Listing content.

## Lingxing Report Collection

Open `数据准备` -> `报表采集` from the left menu.

1. Set the start and end dates.
2. Enter the target store and marketplace/site for this collection.
3. Click `采集预检` to see whether the active page model, latest matching diagnostic evidence, and browser session are sufficient to start collection.
4. Use `导出预检` when you need a local evidence folder with the preflight result, active page model, machine-readable bundle index, review checklist, diagnostic evidence-file index, and safe copied diagnostic screenshot/DOM evidence when a matching diagnostic exists.
5. Click `验证页面` to run a read-only download center page-model diagnostic for the selected date range, store, and marketplace/site. In the simplified `数据采集` page, clicking `重新获取完整 8 类报表` also handles this automatically when the current range is missing matching diagnostic evidence: it first validates the download center page, then continues to create and download the 8 report tasks after the diagnostic passes.
6. When any verify, download, re-fetch, or import action starts, read the right-side `自动数据采集监控` drawer. It includes a Canvas browser-preview frame and shows the current action, whether the page is being verified, which step is running, whether the action is blocked, and the evidence path. The drawer does not push the page down and should not block the next main button after the action returns.
7. In the lower action grid, `下载已创建`, `重新获取已选`, `重新获取完整 8 类`, and `导入本地` are mutually locked while one action runs. The active action changes to `处理中...`, shows a spinner and blue striped progress surface, and exposes `aria-busy=true`; sibling actions stay disabled so the running action is visibly different from an inert disabled button.
8. In `8 类报表选择与进度`, use the count chip and progress rail to confirm which reports are selected before clicking a download or re-fetch action. Checkbox changes update the `aria-live` status immediately; selected report cards show a blue side anchor and focus ring, but this only changes the pending action target and does not import DB rows by itself.
9. Read the `排除证据文件` progress step before continuing. Screenshots, DOM, audit packages, manifests, and page archives prove the collection workflow, but they cannot participate in ad-performance calculations and do not replace the original xlsx/xls/csv reports.
10. Review whether the page model matched expected entry hints, report names, and selectors.
11. It is recommended to click `导出证据包` after a diagnostic run to create a local verification bundle under the app export directory. The bundle is loaded from the persisted diagnostic ID and contains the diagnostic JSON, active page model, readiness result, selector candidates, action selector checks, screenshot/DOM evidence copies, and a manual verification checklist.
12. Click `生成模型草稿` after a diagnostic run when you want a safe local page-model draft. The draft is filled into the editor and exported with selector candidates and solidification notes, but it deliberately keeps `requiresManualVerification: true`.
13. Use `导出启用审计` before turning off `requiresManualVerification`. The audit checks whether the saved page model has complete scoped action selectors, recent same-model/same-date/same-store/same-marketplace diagnostic setup evidence, and local screenshot/DOM evidence files.
14. After a fresh same-scope diagnostic exists, choose one report type and click `单报表验证` to run a controlled canary through create, wait-ready, download, file verification, and batch evidence for exactly one report. This canary is the proof step for live ready/download selectors before attempting all 8 reports.
15. Click `启动采集`.
16. The app creates a collection batch and records all 8 report types:
   - 广告活动报告
   - 广告组报告
   - 广告位报告
   - 广告（推广的商品）报告
   - 自动投放报告
   - 关键词报告
   - 商品投放报告
   - 用户搜索词报告
17. Review the batch table for each report status, file path, and error message.
18. Use `打开文件夹`, `打开 Manifest`, or a row-level `打开` button to inspect local files.
    Local file and folder open buttons switch to `打开中...`, show a spinner, expose `aria-busy=true`, and lock sibling path buttons until the OS open request returns.
19. Use `导出验收审计` after a collection batch to create a local audit folder with `acceptance-audit.json`, `acceptance-audit.md`, `filename-date-range-analysis.json`, `downloaded-report-files.json`, the batch result, diagnostic evidence when available, diagnostic screenshot/DOM evidence copies, diagnostic evidence file readiness, failed-report screenshot/DOM/Trace evidence copies, and a manifest copy. The audit can only pass when all 8 expected reports are downloaded, files exist inside the batch download folder, recorded file sizes still match the current files on disk, filenames include the expected report keyword and selected date range, the persisted batch and manifest both carry matching version and store/site scope evidence, a batch snapshot whose version, store/site scope, timestamps, download folder, and manifest path match the persisted batch, file rows whose identity, display name, status, path, size, retry/error/evidence metadata, and timestamps match the persisted file rows, and a parseable generation timestamp after the batch creation/completion timestamps but not later than the audit execution time, and matching diagnostic evidence plus readiness provenance and its local screenshot/DOM evidence files are present. `downloaded-report-files.json` lists each successful report file's path safety, actual size, expected filename keyword, report-type filename match, filename date analysis, `readyForAcceptance`, and `acceptanceBlockers`; size mismatches are included as blockers. If a batch fails, inspect `downloaded-report-files.json`, `report-failure-evidence-files.json`, and the `report-failure-evidence` folder in the audit export.
20. If one report row fails, use the row-level `重试` button to create a new single-report retry batch for that report type and date range. After retry, the batch table switches to that new retry batch instead of rewriting the original 8-report batch.

Current report-collection status: the Lingxing Ads download center page model has live enabled evidence, including 8/8 canaries and full 8-report collection. The latest current-scope batch is `batch_20260625013151957_ajw0nb`; all 8 report types are imported and the database contains 6827 imported rows for that batch. Product-level surfaces intentionally narrow this to the selected ASIN, where the current count is 1879, and must not label that number as the full-database total. For a new date range, store, site, account, or changed Lingxing page model, the app must refresh diagnostic evidence for that exact scope before creating or downloading reports. The primary refresh action performs that diagnostic automatically when the backend reports missing same-scope evidence.

The legacy single-report download IPC/scheduler path is intentionally disabled because it pointed at an outdated Lingxing page model. Use only the v1.5 report collection workflow for live Lingxing report collection.

## Installed-App Live Evidence Runner

For repeatable acceptance evidence, use the installed-app runner instead of ad-hoc Playwright snippets. The runner launches the packaged desktop app, calls the same preload IPC methods as the UI, and writes evidence under `output/codex-evidence`.

Set login credentials only in the current shell environment; do not commit credentials or write them into repo files:

```powershell
$env:LINGXING_USERNAME = '<account>'
$env:LINGXING_PASSWORD = '<password>'
```

Refresh the same-scope diagnostic first:

```powershell
pnpm run run:v15-installed-live -- --mode diagnostic --login --start 2026-05-01 --end 2026-05-25 --store FT-US-US --marketplace US
pnpm run verify:v15-diagnostic -- output\codex-evidence\<installed-live-diagnostic-file>.json
```

Then run one canary at a time. Stop at the first failure and inspect that canary's manifest, acceptance audit, screenshot, DOM, and trace evidence before continuing:

```powershell
pnpm run run:v15-installed-live -- --mode canary --report-type ad_group --login --start 2026-05-01 --end 2026-05-25 --store FT-US-US --marketplace US
pnpm run verify:v15-canary -- output\codex-evidence\<installed-canary-file>.json
```

Repeat only for the missing report types: `ad_group`, `placement`, `advertised_product`, `auto_targeting`, `keyword`, `product_targeting`, and `user_search_term`. After all 8 report types have passing canary evidence from the refreshed diagnostic window, run `pnpm run verify:v15-enablement`. Passing enablement proves the page model can be considered for disabling manual verification; full delivery still requires a live full-8 run and `verify:v15-delivery`.

The runner supports three explicit modes: read-only diagnostics, one explicitly selected single-report canary, and full 8-report collection after the page model/preflight gate is enabled. None of these modes perform ad write actions.

```powershell
pnpm run run:v15-installed-live -- --mode full8 --login --invoke-timeout-ms 900000 --start 2026-05-01 --end 2026-05-25 --store FT-US-US --marketplace US
pnpm run verify:v15-delivery -- output\codex-evidence\<desktop-live-full-8-e2e-file>.json
```

The desktop app already contains a selector-driven automation path for the download center. Full 8-report collection and row-level retry only activate when the active download-center page model has `requiresManualVerification: false`, complete action selectors for creating, waiting for, and downloading a report, and a recent matching diagnostic record for the same page model, selected date range, store, and marketplace/site. The `单报表验证` canary is narrower: it requires the same browser session and same-scope diagnostic setup evidence, then runs exactly one report so the operator can prove live ready-row and download selectors before disabling manual verification for full collection.

The UI also gates the `启动 8 报表采集` button. It remains disabled until the selected collection scope, page-model readiness, and same-scope diagnostic evidence have all passed. Use the visible blocker message next to the button as the next required operator action.

The `采集预检` action performs the non-mutating readiness checks before full collection: page-model automation readiness, latest same-model/same-date/same-store/same-marketplace diagnostic evidence gate, local diagnostic screenshot/DOM evidence file presence, and the local browser login/session prerequisite. It does not click the live page. Use it before `启动采集` to see exactly whether the blocker is the model itself, missing/stale diagnostic evidence, missing local evidence files, date mismatch, store/site mismatch, selector evidence, or the browser session. `启动采集` and row-level `重试` run this full preflight automatically and fail before creating a new batch when any check is blocked. `单报表验证` uses a dedicated canary gate so one live report can be generated/downloaded while full collection remains blocked by manual verification.

The `导出预检` action writes a local evidence folder without starting report creation. It includes `collection-preflight.json`, `collection-preflight.md`, `active-page-model.json`, `diagnostic-evidence-files.json`, `preflight-review-checklist.md`, and `preflight-bundle-index.json`. The bundle index records readiness, selected date range, store/site scope, blocked checks, diagnostic ID when present, diagnostic evidence readiness, and expected bundle files. When a matching same-model/same-date/same-store/same-marketplace diagnostic exists, it also writes `diagnostic.json` and safely copies the diagnostic screenshot/DOM evidence files into the export folder. Use this before and after selector solidification so the live verification trail is reviewable without reading the database.

The active page model is shown in the report collection panel. The bundled model is the default, and a local override can be saved from the JSON editor in the same panel. Overrides are stored under the app data `storage/page-models` directory and are used before the bundled resource on the next diagnostic or collection run. Use `保存页面模型` only after comparing the diagnostic screenshot, sanitized DOM, and selector candidates against the real Lingxing page. Saving an override writes metadata next to the override and automatically backs up any previous override under `storage/page-models/backups`; the metadata records whether manual verification is still enabled and whether a post-save diagnostic is required. `恢复内置模型` also backs up the current override before removing it. Before `requiresManualVerification` can be set to `false`, the model must include start/end date selectors plus create, ready-row, and download selectors; ready-row and download selectors must include both report and date placeholders. Candidate URLs are limited to HTTPS Lingxing domains. If a local override becomes invalid, the UI reports the error and falls back to the bundled model for inspection; use `恢复内置模型` to remove the bad override and return to the packaged default.

For each report, the collector now performs up to 2 automatic retries before marking the report as failed. A final failed row records the failure reason, attempt errors, screenshot path, DOM snapshot path, and Playwright Trace path when tracing starts successfully. If tracing cannot start or stop, the row records the Trace unavailable reason instead of creating a fake trace.

Downloaded files are verified before a report is marked successful. The file must be a CSV/XLS/XLSX report, exceed the minimum size, include the expected report keyword, and include both selected start/end dates in the filename. A file that appears to be from another date range is marked failed and kept with failure evidence for inspection. Filename/date failures include the normalized filename digits and whether the start or end token is missing, so real Lingxing sample filenames can be compared quickly. This filename-date assumption must be confirmed against real Lingxing sample downloads before enabling the page model for unattended collection; if Lingxing changes the naming format, keep the run failed and inspect the preserved evidence before importing data.

The `验证页面` action does not create or download reports. It only navigates to the configured candidate download-center URL and checks visible text plus CSS selectors from the active page model. It also performs read-only Playwright visible-locator counts for the configured action selectors, including report-name placeholder expansion across the 8 supported report types and date placeholders from the selected range, so you can see whether date, create, ready-row, and download selectors currently match the live page before enabling automation. A selector is treated as usable only when it resolves to a single visible target; report ready/download selectors must include both a report placeholder such as `{reportName}` and a date placeholder such as `{dateStart}`, `{dateEnd}`, or `{dateRange}` to avoid broad row or old-report matches.

The `导出证据包` action creates a local folder in `storage/exports` for the latest diagnostic by asking the main process to reload the persisted diagnostic record by ID. Use this folder for manual review before saving a page-model override. It is intentionally local evidence, not an external upload or approval flow. If the page model is edited after a diagnostic, run `验证页面` again for the same date range, store, and marketplace/site before starting collection; collection checks the stored diagnostic snapshot and scope against the active model before it clicks anything. A matching diagnostic must be less than 30 minutes old, and its screenshot plus sanitized DOM snapshot files must still exist under the app-owned evidence directories.

The `生成模型草稿` action reloads the persisted diagnostic by ID, creates `page-model-draft.json`, `solidification-notes.md`, `selector-candidates.json`, and `action-selector-checks.json`, and fills the JSON editor with the draft. The draft can promote the trusted Lingxing diagnostic URL and merge unique selector candidates into non-required verification selectors, but it never turns automation on by itself. Keep `requiresManualVerification: true` until the screenshot, DOM evidence, and action selector checks prove that every create/wait/download selector is unique and scoped by report plus date.

The `导出启用审计` action writes `enablement-audit.json`, `enablement-audit.md`, the active saved page model, matching diagnostic evidence when available, `diagnostic-evidence-files.json`, safe copies of the diagnostic screenshot/DOM evidence files, and `enablement-bundle-index.json`. The bundle index records whether manual verification can be disabled, selected date range, store/site scope, blocked checks, diagnostic ID when present, diagnostic evidence readiness, and expected bundle files. Use it after saving an override and re-running `验证页面` for the same date range, store, and marketplace/site. The desktop asks the main process to load the latest diagnostic for the active saved page model, exact model snapshot, selected date range, store, and marketplace, so stale UI state cannot pick an older diagnostic by accident. The audit can say yes only when the saved page model would be structurally ready with `requiresManualVerification: false`, the recent persisted diagnostic proves the same saved model/date/store/site setup selectors, and the local screenshot/DOM evidence files still exist under app-owned evidence directories. It does not modify the page model. After you actually save an override with `requiresManualVerification: false`, run `验证页面` again; the saved model snapshot has changed, and collection remains blocked until a fresh diagnostic exists for that enabled snapshot and selected scope.

The same action selector safety rule is enforced again during real collection. Before the app fills a field or clicks a button, it counts the target locator without changing the page. Broad, missing, invalid, report-unscoped, or date-unscoped selectors fail closed before the click/download action runs.

The collector has report-status semantics for generated, in-progress, failed, expired, canceled, and unknown states. If the local page-model override includes a verified `statusTextSelector`, unattended collection reads that row status text and fails fast on failed, expired, or canceled reports before download. If `statusTextSelector` is omitted, the app falls back to the verified ready-row selector. The status selector must still be confirmed from diagnostic evidence before enabling unattended collection.

Each diagnostic is saved locally in `download_center_diagnostics` with app version, URL, selector results, matched texts, missing required selectors, selector candidates, action selector checks, error message, screenshot path, and sanitized DOM snapshot path. Use `打开截图` and `打开 DOM` in the UI to inspect local evidence. The app only opens files or folders from its own local evidence, download, report, trace, and export directories; files are limited to supported document/image/archive extensions. The DOM snapshot is minimized and redacted for selector verification, including URL query/hash removal in evidence metadata, but it can still contain business context from the logged-in page, so treat files under the local `storage/dom-snapshots` directory as sensitive evidence.

## Keyword Report Import

Open `关键词机会` from the left menu.

1. Select the source type:
   - 搜索词报表
   - SQP 报表
   - 关键词报表
2. Click `选择报表`.
3. Pick a `.xlsx`, `.xls`, or `.csv` file.
4. Choose the duplicate-file policy:
   - `重复文件：合并` keeps existing rows from the same source/file and only imports new source rows.
   - `重复文件：覆盖` deletes old rows from the same source/file and imports the selected file again.
   - `重复文件：跳过` leaves existing rows unchanged and refreshes the workspace from persisted data.
5. Click `导入并生成机会`.
6. Review the opportunity table for keyword level, ASIN, score, evidence, and risk flags.

Field mappings are loaded from packaged resources under `resources/field-mappings`.

Keyword import is fail-closed for critical parser problems. If the keyword/search-term column cannot be mapped, or more than 5% of non-empty rows are invalid, the import stops and reports the reason. Missing non-critical metric columns and unparseable numeric cells are surfaced as parse warnings in the workspace and default to `0`, so downstream opportunity scoring is not silently based on hidden parser assumptions.

Duplicate detection uses the source type plus the canonical local file path. A Search Term report and an SQP report with the same file path are treated as different imports. Keyword opportunities are refreshed by `ASIN + normalized keyword`, so repeated imports update evidence and score without endlessly appending duplicate opportunities or overwriting accepted/ignored opportunity status.

When parse warnings or recoverable row errors are present, use `导出诊断` to save a local CSV of warning/error rows under the app export directory. The diagnostic CSV is spreadsheet-formula safe.

## Listing Content

Open `Listing 优化` from the left menu.

Manual Listing entry is the primary path. The editor is grouped like an operator table: `基础信息`, `标题`, `五点`, and `详情与搜索词`, with field status tags for required, recommended, and optional fields. Fill the current ASIN, title, five bullets, description/A+ content, image copy, and backend search terms, then click `保存为新版本`. Each save records a local version snapshot for later comparison. Excel import and Lingxing read-only fill are auxiliary paths; neither submits changes to Amazon.

When `保存为新版本`, `尝试从当前领星页面填入表单`, `生成本地草案`, or `导出草案` is running, the active button changes to its business running label such as `保存中...`, `读取中...`, `生成中...`, or `导出中...`, shows a spinner, exposes `aria-busy=true`, and locks the sibling Listing actions until the local task returns.

Supported Listing import fields:

- `ASIN`
- `Title` / `标题`
- `Bullet Points` / `五点` / `卖点`
- `A+`
- `Image Copy` / `图片文案`
- `Backend Search Terms` / `后台搜索词`

To import:

1. Click `导入 Listing Excel`.
2. Select the Listing workbook.
3. Confirm ASIN, title, bullets, A+, image copy, and backend terms are filled in the form.

To read from Lingxing without submitting changes:

1. Log in through the desktop app so the same ERP browser session is active.
2. Use `尝试从当前领星页面填入表单` only as an auxiliary fill action when the Listing page is already visible.
3. Review the filled ASIN/title/bullets/backend terms before saving. If any field is missing or the ASIN does not match the current scope, correct it manually.
4. Click `保存为新版本` to make the current local Listing content available to coverage analysis and draft generation.
5. Use `打开读取截图` when Lingxing read-only fill produced screenshot evidence that needs review.

The Listing reader is read-only. It does not click save, publish, submit, sync, delete, or Amazon Listing modification actions.

## Listing Keyword Heatmap

After current Listing content and keyword opportunities exist, use `核心商机词根热力图矩阵` to inspect coverage before generating or accepting rewrite drafts. The left rail lists normalized keywords/roots, current coverage count, draft coverage count, and the recommended Listing section. Click a keyword to highlight only that root across the matrix; the selected rail button exposes `aria-pressed`, the matched sections and tokens flash briefly, and the fixed status line announces which Listing sections were hit. Each right-side section also shows what changed: removed original words are red strikethrough chips, added draft words are green chips, draft generation displays a skeleton wave over the draft pane, and title/bullet character counters flash red when they exceed the configured limit.

The right matrix compares current text with draft or suggested text across `标题`, `五点`, `后台词`, and `详情/A+`. Yellow highlights mean the keyword exists in that field, and blue highlights indicate the active keyword selected from the left rail. The matrix is local-only: it helps the operator decide where a root should appear, but it does not submit Listing changes to Amazon or Lingxing.

## Listing Local Draft Workbench

Use `关键词与本地草案工作台` after saving the current Listing version. The workbench keeps the whole draft decision in one first-screen block:

1. Paste keyword opportunities or bring them from `关键词机会`. The placeholder uses real operator examples such as `wide toe box` and `barefoot shoes`, not generic test words.
2. Check `数据门槛`. When all 8 real reports are imported and current-scope metrics are available, the state is `真实广告数据可用`. When data is missing, the state is `待补齐真实广告数据`.
3. Check `草案用途`. If real data is missing, the draft is marked `仅本地预览`; it can help with structure and wording review, but it cannot enter the delivery evidence package.
4. Click `生成本地草案` or `生成本地预览草案`. The app writes only local draft rows and does not submit Amazon or Lingxing changes. While generation or export is running, only the active action shows spinner/`处理中` feedback; locked sibling actions stay disabled without pretending to be the running action.
5. Review the source counters and draft table. AI drafts and local rule references are both review material; neither bypasses human review or the delivery gates.
6. Use `导出草案` only after reviewing the draft table.

## Listing Suggestions

1. Import keyword data.
2. Enter or import Listing content.
3. Click `生成建议`.
4. Review each suggestion:
   - keyword
   - target section
   - suggested text
   - risk warnings
   - status
5. Use `标记采纳` or `标记忽略` to mark the suggestion.

The app only produces suggestions. It does not submit changes to Amazon.

## Listing Drafts

1. Save or read the current Listing content first.
2. Paste or bring in keyword opportunities.
3. Check the workbench data gate and local-only purpose.
4. Generate the local draft.
5. If AI settings are configured, the app attempts to generate a structured rewrite draft through the fixed `listing_rewrite_v1` contract using `resources/prompts/listing-rewrite.md`.
6. If AI is not configured, the AI call fails, or the AI response cannot be parsed, the app creates a local rule-reference draft and records the reason.
7. Review draft section, keywords, current text, drafted text, source, evidence, and risk warnings.
8. Export drafts only for operator review. Exporting does not publish Listing changes.

## Export

Listing suggestions can be exported as:

- CSV
- Excel `.xlsx`
- Markdown

Listing drafts can also be exported as CSV, Excel `.xlsx`, or Markdown after generation.

CSV and Excel exports include formula-injection protection and app version trace.

## AI / DeepSeek Settings

Use `设置` -> `AI / DeepSeek 配置` to configure the OpenAI-compatible provider used by Listing drafts and AI explanations. The Settings page shows fixed output contract tags for `广告诊断 v1`, `广告解释 v1`, `Listing 草案 v1`, and `异常回退规则`; these tags explain what downstream pages can safely read. The persona field only changes expression style and language tone. It does not change fixed output fields, required evidence refs, or ad-action safety gates. Structured AI calls enforce an output-token floor of 8192 so older low values such as `700` cannot truncate diagnosis output.

1. Enter API Key.
2. Keep the default Base URL `https://api.deepseek.com` for DeepSeek, or replace it with another OpenAI-compatible endpoint.
3. Set model, temperature, and max tokens. The current DeepSeek default is `deepseek-v4-flash`.
4. Click `保存 AI 设置`.
5. Click `测试 AI 连接`.

The first Settings viewport now keeps this as one visible task. The save/test buttons disable immediately while running, show a spinner, and write the current result into the AI connection feedback bubble beside the task. The bottom status panel is reserved for non-AI global messages so the same AI save/test result does not appear twice.

In the advertising threshold section, field errors stay on the exact row that needs repair. When `保存广告阈值` is clicked, the active button switches to `保存中...`, shows a spinner, exposes `aria-busy=true`, and blocks repeat saves until the local rule configuration call returns. This saves only local threshold rules; it does not generate recommendations, approve actions, or write Amazon Ads.

Advanced local utility actions now use the same visible running contract. `清除本地 AI Key` switches to `清除中...`, and `复制诊断检查清单` switches to `复制中...`; only the active utility button shows the spinner, `button-loading`, and `aria-busy=true`, while the peer utility button locks as a plain disabled control. These actions only change local settings or clipboard diagnostics. They do not change AI output contracts, generate recommendations, approve actions, or write Amazon Ads.

The UI setting is used by the desktop app. Final readiness evidence scripts intentionally read the key from the shell environment so the evidence file never stores the secret. After the UI test passes, use the command template shown in Settings:

```powershell
$env:DEEPSEEK_API_KEY="<your-deepseek-key>"
pnpm run verify:ai-live
pnpm run run:v15-installed-live -- --mode ad-ai-explanation --out output\codex-evidence\installed-ad-ai-explanation-manual.json
pnpm run verify:ad-ai-explanation -- output\codex-evidence\installed-ad-ai-explanation-manual.json
pnpm run run:v15-installed-live -- --mode listing-ai-draft --source-app --out output\codex-evidence\installed-listing-ai-draft-manual.json
pnpm run verify:listing-ai-draft -- output\codex-evidence\installed-listing-ai-draft-manual.json
```

If the test fails or no API Key is configured, Listing drafts remain local rule-based drafts and the app records the AI fallback reason. The app does not submit Listing changes to Amazon.

## Backend Navigation

v1.5 is presented as an upgrade of the existing backend, not as a nested all-in-one workbench. The left navigation exposes exactly eight task workspaces:

- `今日任务`: review the current blocker, next safe action, product, data, performance, and decision queue.
- `产品工作台`: lock the current ASIN and maintain product, target, cost, and operation-event context through its subviews.
- `数据准备`: define the current scope, collect the eight real Lingxing report files, and complete per-type import validation.
- `广告诊断`: review quantified ad objects and run AI-stage analysis only after the formal data gate closes.
- `建议与审批`: review recommendations and record per-row approval or rejection through `待判断` and `待审批`.
- `结果核对`: record approval evidence, manual Ads UI before/after screenshots, reload values, and verifier-ready readback proof.
- `关键词与 Listing`: review real-data keyword opportunities and prepare local-only Listing drafts.
- `系统与交付`: configure AI/rules, review scheduled tasks, and inspect final delivery readiness.

Each v1.5 task page shows its primary task and proof boundary at the top. `交付验收` is for final status and evidence review only; daily report collection and Listing work should be done from their own pages. On `Listing 优化`, follow the visible flow from manual `保存为新版本` to suggestions/drafts/export; real AI draft readiness still requires `source=ai` evidence from a real provider run.

On `建议与审批` -> `待判断`, click the first-screen status buckets to switch the table between `全部建议`, `高风险强阻断`, `需人工复核`, and `已就绪可批准`. This is a view filter only; switching buckets clears current checkbox selection so hidden rows cannot be batch-submitted. Use the checkbox column to select only recommendations that pass the formal approval precheck. Checked rows show a confirmation animation, keyboard focus shows a visible checkbox ring, and the batch toolbar announces `0/N` or `X/N` through a stable count chip plus `aria-live` status. Direct page actions now also show explicit running feedback: folded `刷新建议` switches to `刷新中...`, while workflow-step `生成解释` and empty-state `生成优化建议` switch to `生成中...`; the active action shows a spinner, exposes `aria-busy=true`, and carries `button-loading`. Missing real scope or pipeline loading remains a plain unavailable state without spinner, so operators can distinguish blocked from running. The `批量提交 X 项到审批中心` action stores a local handoff hint and opens the `待审批` tab; it does not approve, reject, execute, or write any Ads change. Review-only or evidence-blocked rows stay disabled until their missing source, scope, or AI evidence details are resolved.

On `建议与审批` -> `待审批`, approval and rejection provide first-screen stamp feedback. `SEALING` means the app is recording the approval request, `PASSED` means the local recommendation record was approved, `REJECTED` means the recommendation was explicitly blocked, and `BLOCKED` means a required approver, reason, target, source, or safety precheck is missing. During approval/rejection IPC, the active decision button changes to `处理中...`, shows a spinner, exposes `aria-busy=true`, and disables the sibling decision action so the click is visibly accepted instead of looking inert. After a successful approve or reject, the decided queue row uses a tone-specific 180ms slide-out, disappears from the local visible table, and then the page reloads the authoritative approval queue. When arriving from a batch handoff, the page shows a `批量送审` hint and selects the first matching row, but it still reloads the real approval queue and requires each row to pass the same evidence and safety checks. These stamps, button loading states, and queue animations are only decision feedback. They do not execute Amazon Ads changes. A `PASSED` decision must still continue to `结果核对` for manual Ads UI action, before/after screenshots, reload/readback evidence, and `verify:ad-readback`.

## Final Readiness Evidence

Use `交付验收` to review the delivery state. The page is for final status and evidence governance only; daily report collection, Listing work, recommendation review, and readback capture should be completed from their own pages first.

### Current release summary

The README lists the current delivery status, package paths, hashes, final-readiness JSON, package-launch smoke, and delivery bundle. Treat those tables as a human-readable summary. The authoritative release facts are the manifest-driven final readiness JSON, its recorded package index, the delivery bundle manifest, and the matching READY or NON_READY safety result. As of 2026-07-17 the current final candidate is `APP_NEEDS_WORK`, not `APP_READY`: package UI `output\codex-evidence\package-ui-evidence\2026-07-17T04-16-32-110Z\manifest.json`, smoke `output\codex-evidence\package-launch-smoke-1784261752633.json`, evidence selection `output\codex-evidence\v15-final-readiness-evidence-manifest-20260717-task8a-non-ready.json`, and final readiness `output\codex-evidence\final-readiness-20260717-task8a-non-ready.json` refer to the same package candidate. The final isolated package UI run records 30 PNGs across 100%/125% compact matrices plus a 1400×900 Product/Diagnosis wide profile, and proves DB/process/controlled-shutdown isolation. The NON_READY bundle at `output\delivery-bundles\v15-delivery-bundle-20260717-task8a-non-ready` explicitly binds those artifacts and passes the current strict NON_READY safety gate 17/17. Earlier package UI runs, hashes, smoke files, readiness files, bundles, and safety results are historical and cannot be used as current delivery authority. Task 8B remains externally blocked only on the new real Ads v2 authority readback.

Historical final-readiness files and old delivery bundles remain useful as baseline evidence only. Do not reuse a previous readback scope, package hash, or delivery bundle as proof for a future package rebuild, source change, scope change, or ad action.

### Evidence governance rule

A deliverable can claim `APP_READY` only when the selected final-readiness JSON was produced from an explicit evidence-selection manifest and records `evidenceSelection.mode=manifest`. Latest-file fallback, README prose, UI smoke, screenshots, page archives, audit JSON, and structural mock AI evidence are supporting context only; they do not replace the manifest-driven final-readiness chain.

The delivery bundle intentionally does not copy raw `.xlsx`, `.xls`, or `.csv` Lingxing report files. It writes `evidence/real-report-file-index.json` instead, with each source report's local path, existence flag, size, SHA-256, and evidence references. Use that index to locate the actual downloaded spreadsheets on the operator machine.

### Release order

After refreshing report, Listing, AI, and ad-readback evidence, write an explicit evidence-selection manifest first:

```powershell
pnpm run write:v15-evidence-manifest -- --delivery <full8-evidence.json> --listing-read <listing-read.json> --ai-live <ai-live.json> --ad-ai-explanation <ad-ai-explanation.json> --listing-ai-draft <listing-ai-draft.json> --ad-readback <ad-readback.json> --out <current-evidence-manifest.json>
```

Build the current Windows installer and no-install portable executable before final readiness. The final readiness verifier records both package hashes and will not accept an APP_READY claim without them:

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:win
pnpm run smoke:package-launch
pnpm run evidence:package-ui -- --expected-exe-sha256 <win-unpacked-sha256> --expected-app-content-sha256 <app-content-sha256> --user-data-dir <isolated-profile-copy> --protected-db <amazon-ai-ops.db> --allow-saved-login
```

Then run final readiness against that manifest and the current packaged launch smoke:

```powershell
pnpm run verify:v15-final-readiness -- --evidence-manifest <current-evidence-manifest.json> --package-launch-smoke <current-package-launch-smoke.json> --db <amazon-ai-ops.db> --out <current-final-readiness.json>
```

Choose exactly one handoff branch from the final-readiness result. Do not change the README to READY while any gate remains blocked.

If the result is not ready, follow branch A: 如果最终验收为 `APP_NEEDS_WORK`，README 顶部 DELIVERY 行必须保持非 READY. Export a bounded diagnostic bundle, then run the NON_READY safety gate:

```powershell
pnpm run export:v15-delivery-bundle -- --final-readiness <current-final-readiness.json> --package-ui-manifest <current-package-ui-manifest.json> --workspace-ui-manifest <current-workspace-ui-manifest.json> --business-ui-smoke <current-business-ui-smoke.json> --full-test-evidence <full-vitest.json> --data-reconciliation <current-reconciliation.json> --data-reconciliation-md <matching-current-reconciliation.md> --release-dir apps/desktop/release --readme README.md --db <amazon-ai-ops.db> --skip-latest-extras true --out <new-non-ready-bundle>
pnpm run verify:v15-non-ready-safety -- --final-readiness <current-final-readiness.json> --package-launch-smoke <current-package-launch-smoke.json> --package-ui-manifest <current-package-ui-manifest.json> --bundle-manifest <new-non-ready-bundle>/delivery-bundle-manifest.json --readme README.md --db <amazon-ai-ops.db>
```

Only after every gate passes, follow branch B: 只有最终验收为 `APP_READY` 时，README 顶部 DELIVERY 行才切到 `APP_READY`. Export a fresh READY bundle after updating the README, then run the READY safety gate:

```powershell
pnpm run export:v15-delivery-bundle -- --final-readiness <app-ready-final-readiness.json> --package-ui-manifest <current-package-ui-manifest.json> --workspace-ui-manifest <current-workspace-ui-manifest.json> --business-ui-smoke <current-business-ui-smoke.json> --full-test-evidence <full-vitest.json> --data-reconciliation <reconciliation.json> --data-reconciliation-md <matching-reconciliation.md> --release-dir apps/desktop/release --readme README.md --db <amazon-ai-ops.db> --skip-latest-extras true --out <new-ready-bundle>
pnpm run verify:v15-ready-safety -- --final-readiness <app-ready-final-readiness.json> --ui-smoke <current-business-ui-smoke.json> --bundle-manifest <new-ready-bundle>/delivery-bundle-manifest.json --db <amazon-ai-ops.db>
```

### Readback repair only if blocked

The `交付验收` page provides `刷新最终验收`. This is an in-app diagnostic refresh: it writes a new evidence-selection manifest and final readiness JSON, then shows file paths and failed gate count. It does not override the final delivery rules. If a future ad readback gate is missing operator approval, before/after Ads UI screenshots, changed live value, or reload readback proof, the refresh must remain `APP_NEEDS_WORK`.

When final readiness is blocked by ad readback, use `广告回读补证` only for the failed candidate evidence path. `创建回读工作包` creates a working session folder with a checklist, locator guide, `session-input-guide.md`, and `session-input.json`. The generated work package becomes final evidence only after the operator fills real approval, before/after/readback proof, produces the PASS-intended JSON, and the ad readback verifier passes.

`结构通过，现场证据待填写` means only the folder structure is safe. It is not final readback proof. Missing items are shown as grouped evidence labels such as `审批/审批人`, `执行前/执行前 Ads UI live bid`, `执行后/执行后截图文件`, and `回读/刷新回读截图文件`.

### What must not be treated as final evidence

Do not treat structural mock AI evidence as final AI readiness. It is only a local schema/redaction proof. Real AI readiness requires `verify:ai-live`, a real ad recommendation AI explanation evidence file, a real Listing AI draft evidence file, and no-key fallback must be gone.

Real ad execution readiness requires `verify:ad-readback` with operator approval, real Lingxing spreadsheet source file(s), positive source row number, before/after screenshots, and verified readback for each action. Future ad changes must provide their own target, source report files/row, approval, before/after screenshots, and readback evidence. The in-app execution button remains fail-closed and does not batch-write ads.

### Readback page interaction feedback

On `结果核对`, screenshots can be dropped or pasted into approval, before, after, and reload/readback capture targets. The shortcut only reduces path handling; it does not bypass approval, source-row traceability, timestamp order, distinct screenshot, or `verify:ad-readback` requirements.

Readback actions such as `导出回读证据`, `创建回读工作包`, `检查工作包`, `生成回读证据`, and `校验回读证据` show a single active running state with spinner and `aria-busy=true`. Clipboard/open helpers likewise only confirm the local file, folder, or clipboard action; they do not generate, fill, verify, approve, execute, or write Amazon Ads.

Before any real ad write is attempted, generate the approval packet. The JSON remains `NEEDS_WORK` until real approval, screenshots, changed values, and readback are filled; the Markdown file is the human checklist for the operator:

```powershell
pnpm run create:ad-readback-template -- --out output\codex-evidence\real-ad-execution-readback-manual.json --md-out output\codex-evidence\real-ad-execution-readback-manual.md --entity-id "<opaque Ads UI/API writable object id>" --identity-proof "C:\path\to\target-identity-proof.json" --source-files C:\path\to\user-search-term.xlsx --source-row 18
pnpm run create:ad-readback-candidate -- --source output\codex-evidence\installed-ad-ai-explanation-user-key-2026-06-10.json --recommendation-id 1 --source-entity-type search_term --source-current-value 2.40 --source-recommended-value 2.16 --out output\codex-evidence\real-ad-execution-readback-candidate-rec-1.json --md-out output\codex-evidence\real-ad-execution-readback-candidate-rec-1.md
pnpm run verify:ad-readback -- output\codex-evidence\real-ad-execution-readback-manual.json
```

For the current concrete candidate, read `docs\REAL_AD_READBACK_RUNBOOK.md` before touching Ads UI. It lists the exact candidate scope, no-go conditions, required before/after/readback fields, timestamp order, and final commands.

The candidate command is only for an approval packet. `source-current-value` and `source-recommended-value` are report/recommendation inputs, not Ads UI before/after bid proof. Every candidate must bind `target.entityId` to the opaque writable Ads UI/API object ID and set `target.identityProofPath` to an existing local screenshot or API JSON that proves that ID; session preparation and structural verification fail before capture when either field or the proof file is missing. The generated JSON must still fail `verify:ad-readback` until the operator fills real approval, screenshots, execution, and readback fields. `verify:ad-readback` also rejects audit JSON/PNG/HTML as source data; `source.sourceFiles` must point to real `.xlsx`, `.xls`, or `.csv` report file(s), and `source.sourceRow` must be a positive original report row.

The `优化建议` page also includes a local readback evidence entry form. Use it after a separately approved low-risk Ads action to enter external approver/proof, manual Ads UI executor, original report source file(s)/row, before/after live bid values, before/after screenshot paths, independent readback screenshot/trace path, live bid row proof, execution id, explicit approval/before/execution/after/readback timestamps, and readback actual value. The local precheck only checks visible form completeness, value consistency, and timestamp ordering before export; file existence, independent proof quality, secret leakage, source-file type, and final acceptance remain controlled by `verify:ad-readback`. The export button only writes local JSON/Markdown evidence under the app exports directory; it does not execute or save any ad change. A complete form is still only “ready for verifier”; `verify:ad-readback` remains authoritative and checks source report traceability, traceable approval proof, manual Ads UI execution, independent readback evidence, and timestamp order.

## Local Evidence

Generated data is retained locally:

- Lingxing batch manifest: batch download folder, `manifest.json`.
- SQLite tables: `lingxing_report_batches`, `lingxing_report_files`, `keyword_metrics`, `keyword_opportunities`, `listing_content`, `keyword_coverage`, `listing_suggestions`, `listing_drafts`.
- Exports: user data directory, `storage/exports`.
