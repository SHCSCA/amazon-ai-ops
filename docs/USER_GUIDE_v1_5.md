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
2. Log in to Lingxing ERP through the visible browser session, then confirm the Ads system session is available. The verified Ads entry is `https://ads.lingxing.com/home`, and the verified Ads download center is `https://ads.lingxing.com/ak_download/download_center/download_report_log/index`.
3. Open `v1.5 工作台`.

## Lingxing Report Collection

1. Set the start and end dates.
2. Enter the target store and marketplace/site for this collection.
3. Click `采集预检` to see whether the active page model, latest matching diagnostic evidence, and browser session are sufficient to start collection.
4. Use `导出预检` when you need a local evidence folder with the preflight result, active page model, machine-readable bundle index, review checklist, diagnostic evidence-file index, and safe copied diagnostic screenshot/DOM evidence when a matching diagnostic exists.
5. Click `验证页面` to run a read-only download center page-model diagnostic for the selected date range, store, and marketplace/site.
6. Review whether the page model matched expected entry hints, report names, and selectors.
7. It is recommended to click `导出证据包` after a diagnostic run to create a local verification bundle under the app export directory. The bundle is loaded from the persisted diagnostic ID and contains the diagnostic JSON, active page model, readiness result, selector candidates, action selector checks, screenshot/DOM evidence copies, and a manual verification checklist.
8. Click `生成模型草稿` after a diagnostic run when you want a safe local page-model draft. The draft is filled into the editor and exported with selector candidates and solidification notes, but it deliberately keeps `requiresManualVerification: true`.
9. Use `导出启用审计` before turning off `requiresManualVerification`. The audit checks whether the saved page model has complete scoped action selectors, recent same-model/same-date/same-store/same-marketplace diagnostic setup evidence, and local screenshot/DOM evidence files.
10. Click `启动采集`.
11. The app creates a collection batch and records all 8 report types:
   - 广告活动报告
   - 广告组报告
   - 广告位报告
   - 广告（推广的商品）报告
   - 自动投放报告
   - 关键词报告
   - 商品投放报告
   - 用户搜索词报告
12. Review the batch table for each report status, file path, and error message.
13. Use `打开文件夹`, `打开 Manifest`, or a row-level `打开` button to inspect local files.
14. Use `导出验收审计` after a collection batch to create a local audit folder with `acceptance-audit.json`, `acceptance-audit.md`, `filename-date-range-analysis.json`, `downloaded-report-files.json`, the batch result, diagnostic evidence when available, diagnostic screenshot/DOM evidence copies, diagnostic evidence file readiness, failed-report screenshot/DOM/Trace evidence copies, and a manifest copy. The audit can only pass when all 8 expected reports are downloaded, files exist inside the batch download folder, recorded file sizes still match the current files on disk, filenames include the expected report keyword and selected date range, the persisted batch and manifest both carry matching version and store/site scope evidence, a batch snapshot whose version, store/site scope, timestamps, download folder, and manifest path match the persisted batch, file rows whose identity, display name, status, path, size, retry/error/evidence metadata, and timestamps match the persisted file rows, and a parseable generation timestamp after the batch creation/completion timestamps but not later than the audit execution time, and matching diagnostic evidence plus readiness provenance and its local screenshot/DOM evidence files are present. `downloaded-report-files.json` lists each successful report file's path safety, actual size, expected filename keyword, report-type filename match, filename date analysis, `readyForAcceptance`, and `acceptanceBlockers`; size mismatches are included as blockers. If a batch fails, inspect `downloaded-report-files.json`, `report-failure-evidence-files.json`, and the `report-failure-evidence` folder in the audit export.
15. If one report row fails, use the row-level `重试` button to create a new single-report retry batch for that report type and date range. After retry, the batch table switches to that new retry batch instead of rewriting the original 8-report batch.

Current limitation: the Lingxing Ads download center URL, read-only list page, and create-report setup selectors have been verified, but the action model is still marked as requiring manual verification. Until ready-row/download selectors and a real generated report flow are confirmed through the desktop diagnostic and enablement audit, report creation and download fail closed instead of pretending to succeed.

The legacy single-report download IPC/scheduler path is intentionally disabled because it pointed at an outdated Lingxing page model. Use only the v1.5 report collection workflow for live Lingxing report collection.

The desktop app already contains a selector-driven automation path for the download center. It only activates when the active download-center page model has `requiresManualVerification: false`, complete action selectors for creating, waiting for, and downloading a report, and a recent matching diagnostic record for the same page model, selected date range, store, and marketplace/site. That diagnostic gate checks the page/date/create selectors before collection; ready-row and download selectors are still checked live for uniqueness and report/date scope immediately before wait/download actions. With the bundled default model, create-page selectors are present but manual verification remains enabled, so the app deliberately refuses to create or download reports until live ready/download evidence is available.

The `采集预检` action performs the same non-mutating readiness checks before collection: page-model automation readiness, latest same-model/same-date/same-store/same-marketplace diagnostic evidence gate, local diagnostic screenshot/DOM evidence file presence, and the local browser login/session prerequisite. It does not click the live page. Use it before `启动采集` to see exactly whether the blocker is the model itself, missing/stale diagnostic evidence, missing local evidence files, date mismatch, store/site mismatch, selector evidence, or the browser session. `启动采集` and row-level `重试` also run this preflight automatically and fail before creating a new batch when any check is blocked.

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
5. Use `采纳` or `忽略` to mark the suggestion.

The app only produces suggestions. It does not submit changes to Amazon.

## Listing Drafts

1. Generate Listing suggestions first.
2. Click `生成草案`.
3. If AI settings are configured, the app attempts to generate a JSON rewrite draft using `resources/prompts/listing-rewrite.md`.
4. If AI is not configured or the AI call fails, the app creates a local rule-based draft.
5. Review draft section, keywords, drafted text, source, and risk warnings.

## Export

Listing suggestions can be exported as:

- CSV
- Excel `.xlsx`
- Markdown

CSV and Excel exports include formula-injection protection and app version trace.

## Local Evidence

Generated data is retained locally:

- Lingxing batch manifest: batch download folder, `manifest.json`.
- SQLite tables: `lingxing_report_batches`, `lingxing_report_files`, `keyword_metrics`, `keyword_opportunities`, `listing_content`, `keyword_coverage`, `listing_suggestions`, `listing_drafts`.
- Exports: user data directory, `storage/exports`.
