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
3. Use the split left menu for the upgraded v1.5 workflow:
   - `运营总览` -> `仪表盘`: current range data health, report coverage, imported row count, AI state, pending recommendation count, USD spend/sales/orders, and ACOS.
   - `数据与量化` -> `数据采集`: Lingxing Ads report diagnostics, canary verification, full 8-report collection, manifests, and acceptance audit.
   - `数据与量化` -> `运营事件`: local notes for events such as discounts, BD, promotions, deals, coupons, or other external factors that affect daily advertising interpretation.
   - `数据与量化` -> `广告量化`: daily DB-backed advertising metrics, rules thresholds, and AI threshold/strategy interpretation.
   - `广告执行` -> `优化建议`: rules plus AI candidate generation and explanation for ad changes; approval and execution are intentionally separated from generation.
   - `广告执行` -> `审批中心`: operator approval/rejection with approver, reason, scope, batch, target context, source values, and source files.
   - `广告执行` -> `执行回读`: manual Ads UI before/after/readback evidence export for each specific future action.
   - `关键词与 Listing` -> `关键词机会`: Search Term / SQP / keyword imports, ad-context-split opportunity analysis, filters, and evidence columns.
   - `关键词与 Listing` -> `Listing 优化`: Lingxing Listing read-only extraction, local Listing form, suggestions, accepted-only drafts, and exports.
   - `系统与交付` -> `定时任务`, `设置`, `交付验收`: scheduling, AI settings, and final evidence summary. `交付验收` is a proof page, not a daily operation workbench.

Current 2026-06-16 no-install executable for validation: `apps\desktop\release\AmazonAIOpsAgent-1.5.0-portable.exe`, SHA-256 `71E82D4752EC2BE14C60CF34A405BB844929EFAB106BB68A38CEB412B6CBA913`.

## Lingxing Report Collection

Open `数据与量化` -> `数据采集` from the left menu.

1. Set the start and end dates.
2. Enter the target store and marketplace/site for this collection.
3. Click `采集预检` to see whether the active page model, latest matching diagnostic evidence, and browser session are sufficient to start collection.
4. Use `导出预检` when you need a local evidence folder with the preflight result, active page model, machine-readable bundle index, review checklist, diagnostic evidence-file index, and safe copied diagnostic screenshot/DOM evidence when a matching diagnostic exists.
5. Click `验证页面` to run a read-only download center page-model diagnostic for the selected date range, store, and marketplace/site.
6. Review whether the page model matched expected entry hints, report names, and selectors.
7. It is recommended to click `导出证据包` after a diagnostic run to create a local verification bundle under the app export directory. The bundle is loaded from the persisted diagnostic ID and contains the diagnostic JSON, active page model, readiness result, selector candidates, action selector checks, screenshot/DOM evidence copies, and a manual verification checklist.
8. Click `生成模型草稿` after a diagnostic run when you want a safe local page-model draft. The draft is filled into the editor and exported with selector candidates and solidification notes, but it deliberately keeps `requiresManualVerification: true`.
9. Use `导出启用审计` before turning off `requiresManualVerification`. The audit checks whether the saved page model has complete scoped action selectors, recent same-model/same-date/same-store/same-marketplace diagnostic setup evidence, and local screenshot/DOM evidence files.
10. After a fresh same-scope diagnostic exists, choose one report type and click `单报表验证` to run a controlled canary through create, wait-ready, download, file verification, and batch evidence for exactly one report. This canary is the proof step for live ready/download selectors before attempting all 8 reports.
11. Click `启动采集`.
12. The app creates a collection batch and records all 8 report types:
   - 广告活动报告
   - 广告组报告
   - 广告位报告
   - 广告（推广的商品）报告
   - 自动投放报告
   - 关键词报告
   - 商品投放报告
   - 用户搜索词报告
13. Review the batch table for each report status, file path, and error message.
14. Use `打开文件夹`, `打开 Manifest`, or a row-level `打开` button to inspect local files.
15. Use `导出验收审计` after a collection batch to create a local audit folder with `acceptance-audit.json`, `acceptance-audit.md`, `filename-date-range-analysis.json`, `downloaded-report-files.json`, the batch result, diagnostic evidence when available, diagnostic screenshot/DOM evidence copies, diagnostic evidence file readiness, failed-report screenshot/DOM/Trace evidence copies, and a manifest copy. The audit can only pass when all 8 expected reports are downloaded, files exist inside the batch download folder, recorded file sizes still match the current files on disk, filenames include the expected report keyword and selected date range, the persisted batch and manifest both carry matching version and store/site scope evidence, a batch snapshot whose version, store/site scope, timestamps, download folder, and manifest path match the persisted batch, file rows whose identity, display name, status, path, size, retry/error/evidence metadata, and timestamps match the persisted file rows, and a parseable generation timestamp after the batch creation/completion timestamps but not later than the audit execution time, and matching diagnostic evidence plus readiness provenance and its local screenshot/DOM evidence files are present. `downloaded-report-files.json` lists each successful report file's path safety, actual size, expected filename keyword, report-type filename match, filename date analysis, `readyForAcceptance`, and `acceptanceBlockers`; size mismatches are included as blockers. If a batch fails, inspect `downloaded-report-files.json`, `report-failure-evidence-files.json`, and the `report-failure-evidence` folder in the audit export.
16. If one report row fails, use the row-level `重试` button to create a new single-report retry batch for that report type and date range. After retry, the batch table switches to that new retry batch instead of rewriting the original 8-report batch.

Current report-collection status: the Lingxing Ads download center page model has live enabled evidence for the documented `2026-05-01` to `2026-05-25` / `FT-US-US` / `US` scope, including 8/8 canaries and a full 8-report batch. For a new date range, store, site, account, or changed Lingxing page model, repeat the diagnostic, canary, and preflight steps instead of assuming old evidence applies.

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

You can either type Listing content manually or import it from Excel.

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
2. Enter a Lingxing Listing/Product URL and click `打开 URL 并读取`, or manually open the page in the app-controlled browser and click `从当前领星页面读取`.
3. Check the evidence panel. `列表页/当前页部分读取成功` means only ASIN/title were proven. `详情页完整读取成功` requires ASIN, title, bullets, and backend terms.
4. If the list page only produced partial evidence, click `只读探测详情页`. The app only clicks one visible safe detail/view/edit candidate inside the current ASIN row, rejects ambiguous candidates, validates the final Lingxing URL, rejects ASIN mismatch, reads basic information, switches read-only to the description tab, and persists only after title, bullets, and backend terms are complete.
5. Use `打开读取截图` to inspect the local screenshot evidence.

The Listing reader is read-only. It does not click save, publish, submit, sync, delete, or Amazon Listing modification actions.

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

1. Generate Listing suggestions first.
2. Mark the suggestions that should be used as `采纳`.
3. Click `用已采纳建议生成草案`.
4. Pending and ignored suggestions are excluded from the draft.
5. If AI settings are configured, the app attempts to generate a JSON rewrite draft using `resources/prompts/listing-rewrite.md`.
6. If AI is not configured, the AI call fails, or the AI response cannot be parsed, the app creates a local rule-based draft and records the AI fallback reason.
7. Review draft section, keywords, current text, drafted text, source, AI fallback reason, evidence, and risk warnings.
8. Use `复制草案` to copy the reviewed draft text locally.
9. After exporting drafts, use `打开最近草案导出` to reopen the latest exported draft file.

## Export

Listing suggestions can be exported as:

- CSV
- Excel `.xlsx`
- Markdown

Listing drafts can also be exported as CSV, Excel `.xlsx`, or Markdown after generation.

CSV and Excel exports include formula-injection protection and app version trace.

## AI / DeepSeek Settings

Use `设置` -> `AI / DeepSeek 配置` to configure the OpenAI-compatible provider used by Listing drafts and AI explanations.

1. Enter API Key.
2. Keep the default Base URL `https://api.deepseek.com` for DeepSeek, or replace it with another OpenAI-compatible endpoint.
3. Set model, temperature, and max tokens. The current DeepSeek default is `deepseek-v4-flash`.
4. Click `保存 AI 设置`.
5. Click `测试 AI 连接`.

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

v1.5 is presented as an upgrade of the existing backend, not as a nested all-in-one workbench. Use the left navigation by task domain:

- `数据与量化`: define the current scope, collect/import real Lingxing reports, record operation events, maintain product configuration, and review ad quantification.
- `广告执行`: review optimization recommendations, approve/reject concrete actions, and export execution readback evidence.
- `关键词与 Listing`: import keyword/search-term data, generate keyword opportunities, read Listing content, generate suggestions, and export drafts.
- `系统与交付`: review final delivery readiness, manage scheduled tasks, and configure AI settings.

Each v1.5 task page shows its primary task and proof boundary at the top. `交付验收` is for final status and evidence review only; daily report collection and Listing work should be done from their own pages. On `Listing 优化`, follow the visible flow from `读取 Listing` to `导出交付`; real AI draft readiness still requires `source=ai` evidence from a real provider run.

## Final Readiness Evidence

Use `交付验收` to review the current delivery state. The current manifest-driven final-readiness evidence is `APP_READY`: report collection, Listing full read, DeepSeek live, ad recommendation AI explanation, Listing AI draft, and one real manual Ads UI readback all pass. The verified ad sample is a paused target bid decrease from `1.20` to `1.08`; future ad changes must not reuse that scope and must each provide their own target, approval, before/after screenshots, and readback evidence.

After refreshing report, Listing, AI, and ad-readback evidence, write an explicit evidence-selection manifest first:

```powershell
pnpm run write:v15-evidence-manifest -- --ad-readback output\codex-evidence\real-ad-execution-readback-candidate-rec-1.json --out output\codex-evidence\v15-final-readiness-evidence-manifest-2026-06-10.json
```

Then run final readiness against that manifest:

```powershell
pnpm run verify:v15-final-readiness -- --evidence-manifest output\codex-evidence\v15-final-readiness-evidence-manifest-2026-06-10.json --out output\codex-evidence\final-readiness-2026-06-10.json
```

Finally export the bounded handoff bundle only after confirming final-readiness JSON was produced from the current evidence manifest and records `evidenceSelection.mode=manifest`:

```powershell
pnpm run export:v15-delivery-bundle -- --final-readiness output\codex-evidence\final-readiness-2026-06-10.json --data-reconciliation output\codex-evidence\real-lingxing-reconciliation-batch_20260612020905629_gkchz1.json --data-reconciliation-md output\codex-evidence\real-lingxing-reconciliation-batch_20260612020905629_gkchz1.md --out output\delivery-bundles\v15-delivery-bundle-2026-06-15T17-00-08-661Z
```

Do not treat structural mock AI evidence as final AI readiness. It is only a local schema/redaction proof. Real AI readiness requires `verify:ai-live`, a real ad recommendation AI explanation evidence file, a real Listing AI draft evidence file, and no-key fallback must be gone. Real ad execution readiness requires `verify:ad-readback` with operator approval, before/after screenshots, and verified readback for each action. The current `APP_READY` state includes one verified low-risk manual Ads UI sample; the in-app execution button remains fail-closed and does not batch-write ads.

Before any real ad write is attempted, generate the approval packet. The JSON remains `NEEDS_WORK` until real approval, screenshots, changed values, and readback are filled; the Markdown file is the human checklist for the operator:

```powershell
pnpm run create:ad-readback-template -- --out output\codex-evidence\real-ad-execution-readback-manual.json --md-out output\codex-evidence\real-ad-execution-readback-manual.md
pnpm run create:ad-readback-candidate -- --source output\codex-evidence\installed-ad-ai-explanation-user-key-2026-06-10.json --recommendation-id 1 --source-entity-type search_term --source-current-value 2.40 --source-recommended-value 2.16 --out output\codex-evidence\real-ad-execution-readback-candidate-rec-1.json --md-out output\codex-evidence\real-ad-execution-readback-candidate-rec-1.md
pnpm run verify:ad-readback -- output\codex-evidence\real-ad-execution-readback-manual.json
```

For the current concrete candidate, read `docs\REAL_AD_READBACK_RUNBOOK.md` before touching Ads UI. It lists the exact candidate scope, no-go conditions, required before/after/readback fields, timestamp order, and final commands.

The candidate command is only for an approval packet. `source-current-value` and `source-recommended-value` are report/recommendation inputs, not Ads UI before/after bid proof. The generated JSON must still fail `verify:ad-readback` until the operator fills real approval, screenshots, execution, and readback fields.

The `优化建议` page also includes a local readback evidence entry form. Use it after a separately approved low-risk Ads action to enter external approver/proof, manual Ads UI executor, before/after live bid values, before/after screenshot paths, independent readback screenshot/trace path, live bid row proof, execution id, explicit approval/before/execution/after/readback timestamps, and readback actual value. The local precheck only checks visible form completeness, value consistency, and timestamp ordering before export; file existence, independent proof quality, secret leakage, and final acceptance remain controlled by `verify:ad-readback`. The export button only writes local JSON/Markdown evidence under the app exports directory; it does not execute or save any ad change. A complete form is still only “ready for verifier”; `verify:ad-readback` remains authoritative and checks traceable approval proof, manual Ads UI execution, independent readback evidence, and timestamp order.

## Local Evidence

Generated data is retained locally:

- Lingxing batch manifest: batch download folder, `manifest.json`.
- SQLite tables: `lingxing_report_batches`, `lingxing_report_files`, `keyword_metrics`, `keyword_opportunities`, `listing_content`, `keyword_coverage`, `listing_suggestions`, `listing_drafts`.
- Exports: user data directory, `storage/exports`.
