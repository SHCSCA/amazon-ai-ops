# Amazon AI Ops Agent v1.5 Progress Report

Date: 2026-06-08

## Goal

Execute the v1.5 plan while preserving the current codebase. Missing modules are documented in `docs/MISSING_MODULES_MATRIX.md` and filled in rather than hidden or silently skipped.

## Current Completion

Overall v1.5 structural completion is high: the workspace builds, typechecks, packages, and starts from the packaged executable. The real Lingxing Ads download-center URL has been verified in a logged-in browser session. A same-model desktop IPC diagnostic now also verifies the create-report setup selectors in a read-only two-phase flow. The remaining production blocker is unattended live Lingxing report creation/download: ready/download row selectors, final filenames, and the full live 8-report E2E run still need real generated-report evidence.

Implemented and verified:

- Restored and retained the existing v1.2 module set.
- Added v1.5 shared types, resources, field mappings, prompts, and page-model diagnostics.
- Added Lingxing report collector with 8 report definitions, batch manifest, file verification, report subset batches, manual single-report retry, automatic retry metadata, and failure evidence hooks.
- Added a local simulated download-center E2E test that drives the exact 8 report types through create, wait, download, file verification, and manifest generation, with manifest/result parity assertions. This proves the local orchestration path but does not replace live Lingxing E2E.
- Added Lingxing E2E acceptance audit export. After a batch, the app can export JSON/Markdown audit evidence plus DB-loaded batch result, DB-loaded same-model/same-date/same-store/same-marketplace diagnostic evidence, and a bounded manifest copy; the audit only passes when all 8 expected reports, files, filename date tokens, manifest identity/content, batch store/site scope, and matching diagnostic gate evidence are present.
- Added desktop main-process path-boundary tests for acceptance audit manifest handling, including same-prefix sibling directory rejection, manifest filename enforcement, unreadable JSON handling, safe export directory segment sanitization, and a capability-gated symlink escape regression.
- Added keyword report import, keyword opportunity scoring, Listing import/manual entry, coverage analysis, suggestions, drafts, status updates, and CSV/XLSX/Markdown export.
- Keyword report import now uses parse diagnostics: missing critical keyword columns fail clearly, invalid row ratios above 5% fail the import, and optional missing/unparseable numeric fields are surfaced as warnings instead of being silently hidden.
- Keyword parse diagnostics can now be exported as a local formula-safe CSV so operators can inspect warning/error rows outside the app.
- Duplicate keyword report imports now support merge, overwrite, or skip from the workspace UI. The backend treats duplicate scope as source type plus canonical file path, merge skips already-imported source rows, skip refreshes the UI without writing DB rows, and opportunity refreshes upsert by ASIN plus normalized keyword instead of appending duplicates.
- Added SQLite tables for v1.5 report batches/files, keyword metrics/opportunities, Listing content/coverage/suggestions/drafts, and download-center diagnostics.
- Added desktop v1.5 workbench UI and IPC/preload APIs.
- Added user guide and acceptance matrix.

## Latest Increment

- Added a first-screen delivery-gate summary to the v1.5 report-collection panel. It shows the selected date/store/site scope, page-model readiness, same-scope diagnostic status, 8-report batch status, and final audit gate in one place so operators can see the next blocker before clicking live actions.
- Added an operator-facing `单报表验证` canary control with all 8 Lingxing report types. It reuses the existing single-report batch path and hard preflight gate, making it possible to prove live create/ready/download behavior on one report before attempting the full 8-report E2E run.
- Renderer smoke evidence for the new delivery-gate UI: `output/codex-evidence/v15-delivery-gate-ui-smoke.png`. The smoke check verified the v1.5 page renders, the gate is visible, the canary dropdown exposes 8 report types, the canary button is in the first viewport, and no console warnings/errors are emitted.
- Fixed the packaged runtime dependency closure for `better-sqlite3` by making the desktop package explicitly include `bindings` and `file-uri-to-path`. Packaged smoke now reaches `sqlite-ready`, `ipc-ready`, and `window-created` instead of merely keeping an Electron process alive.
- A current packaged app launch migrated the live AppData DB to include `download_center_diagnostics.store_name/marketplace_code` and `lingxing_report_batches.store_name/marketplace_code`. Existing historical diagnostics still have null store/site, so they cannot unlock same-scope live collection.
- Evidence audit still says not READY: the current Electron DB has only read-only diagnostic evidence and no current v1.5 completed report batch; the existing diagnostic's ready/download action selector checks do not prove a newly generated report row.
- Fixed the v1.5 workbench panel layout that let the keyword-opportunity panel overlap the report-collection panel and intercept the `验证页面` click target. The top-level panel grid and nested forms now use responsive minimum widths with `minWidth: 0`, and small buttons rely on layout gaps instead of extra margins.
- Renderer QA evidence now proves the `验证页面` button is the actual element under the click center and that the diagnostic success state can render through the UI path: `output/codex-evidence/renderer-v15-diagnose-layout-qa-1780561270634.json` and `output/codex-evidence/renderer-v15-diagnose-layout-qa-1780561270634.png`.
- Removed the deprecated `daily_report_download` scheduled task registration and scheduler task type. The current scheduler UI no longer exposes a legacy single-report path that is intentionally disabled under v1.5; operators should use `采集预检` / `验证页面` / `启动采集`.
- Added store/site inputs to the desktop report-collection panel and passes them through collect, preflight, retry, diagnostic, and enablement-audit IPC calls.
- Download-center automation now generates unique report names per report/date range and renders `{generatedReportName}`, `{storeName}`, and `{marketplaceCode}` placeholders for scoped selectors.
- Download-center navigation now handles the ERP-logged-in/Ads-not-entered case by entering the Ads system through the ERP advertising menu before navigating to the Ads download-center URL.
- Create-report automation now opens the create-report page before filling controls, then fills store transfer search/selection, generated report name, report type dropdown, start/end dates, and daily-detail radio before the guarded generate action.
- The bundled download-center page model now contains an action selector draft for create-page controls, generated-report scoped ready rows, and generated-report scoped download buttons, while keeping `requiresManualVerification: true`.
- Download-center diagnostics now perform a two-phase read-only selector check: list-page selectors first, then create-report page setup selectors after opening the page and report type dropdown without clicking `生成报告`.
- The diagnostic evidence gate now requires the full create setup selector set: store search/option/move, report name, report type select/option, start/end dates, daily detail, create button, and confirm-create button.
- Real desktop IPC diagnostic evidence: `output/codex-evidence/desktop-ipc-two-phase-diagnostic-1780542152692.json`, diagnostic id `4`, `ready: true`, `missingRequiredSelectors: []`, URL `https://ads.lingxing.com/ak_download/download_center/download_report_log/index`, screenshot `C:\Users\wz\AppData\Roaming\@amazon-ai-ops\desktop\storage\screenshots\download_center_diagnostic_1780542191091.png`, DOM snapshot `C:\Users\wz\AppData\Roaming\@amazon-ai-ops\desktop\storage\dom-snapshots\download_center_diagnostic_1780542191254.html`.
- Desktop/native startup hardening now avoids pulling `duckdb` into desktop main/audit-log runtime paths, externalizes Playwright/DuckDB in the main-process build, and rebuilds packaged native dependencies with `npmRebuild: true`.
- Collector now retries each failed report up to 2 automatic retries before final failure.
- Final failed report rows record attempt errors, screenshot path, DOM snapshot path, Playwright Trace path when tracing starts successfully, and a Trace unavailable reason when tracing cannot be produced.
- Download-center automation now has a selector-driven Playwright path for create, wait-ready, and download. The path stays disabled until the page model is manually verified and action selectors are filled.
- Download-center diagnostics now persist screenshot, sanitized DOM snapshot, and selector candidates with uniqueness/match-count hints for manually solidifying the page model.
- Download-center diagnostics can now be exported as a local evidence bundle containing the diagnostic JSON, active page model, readiness result, selector candidates, action selector checks, copied screenshot/DOM evidence, and a manual verification checklist.
- Download-center diagnostic bundle export now takes only a diagnostic ID from the renderer and reloads the persisted diagnostic in the main process before writing evidence files.
- Download-center diagnostics can now generate a safe page-model draft from persisted evidence. The draft is exported with selector candidates and solidification notes, filled into the UI editor, and keeps `requiresManualVerification: true` until the operator deliberately completes and re-diagnoses the verified selector set. Unit tests cover the manual gate, trusted Lingxing URL promotion, selector deduplication, and operator notes.
- Added a page-model enablement audit for the final selector-solidification step. It exports JSON/Markdown evidence for the active saved page model and can only say manual verification may be disabled when scoped action selectors and recent same-model/same-date/same-store/same-marketplace diagnostic setup evidence both pass. Tests also pin the post-enable requirement: after `requiresManualVerification` is saved as `false`, an older manual-gated diagnostic no longer matches and collection remains blocked until a fresh enabled-snapshot diagnostic exists.
- Page-model enablement audit export now also applies diagnostic screenshot/DOM evidence file readiness, safely copies those files into the audit folder, and writes `diagnostic-evidence-files.json`; missing local evidence files block the audit from saying manual verification can be disabled.
- Acceptance audit diagnostic lookup now uses a tested same-model/same-date/same-store/same-marketplace query helper so the default UI path cannot accidentally fall back to a different page-model snapshot or another collection scope.
- Download-center collection now requires a recent matching diagnostic record for the active page-model snapshot, selected date range, store, and marketplace before any create, wait, or download action can run. The runtime gate verifies page/date/create selector evidence, while ready/download selectors are checked live immediately before use to avoid self-locking new date-range report creation.
- The diagnostic evidence gate is now a tested `lingxing-report-collector` helper covering missing/failed diagnostics, stale or future timestamps, malformed selector-check evidence, model/date/store/site mismatches, optional confirm dialogs, and new date-range creation without pre-existing ready/download rows.
- Local evidence opening is now constrained to app-owned download, screenshot, DOM snapshot, trace, report, and export directories with a safe extension allowlist.
- DOM evidence metadata now strips URL query/hash fragments and redacts token/session/cookie/auth-like values before writing local snapshots.
- Selector candidate collection now tolerates unusual DOM id/class values by using CSS escaping and skipping only the bad element instead of failing the whole diagnostic.
- Download-center page models now support a local override in app storage, with IPC/UI save, reload, reset, source display, validation, invalid-override recovery feedback, and readiness feedback. This lets verified live selectors be applied without rebuilding the app.
- Download-center page-model overrides now save metadata and automatically back up previous override files before save/reset, preserving selector-solidification history. Metadata also records whether manual verification is disabled and whether a fresh post-save diagnostic is required for the exact enabled snapshot.
- Download-center page-model validation is now isolated in a testable main-process helper. Tests cover manual-verification-on bundled models, complete selector-scoped verified models, missing required selectors, missing report/date placeholders, non-HTTPS/non-allowlisted URLs, and timeout bounds.
- Added a non-mutating Lingxing collection preflight. The desktop can now show whether collection is blocked by page-model readiness, missing/stale/mismatched same-model/date/store/site diagnostic evidence, or missing browser login/session before it clicks anything.
- `启动采集` and row-level `重试` now run the same preflight as a hard gate before creating a collection batch, so known-unready page models or missing diagnostics fail before noisy failed batches are produced.
- The hard preflight gate is now a package-level assertion helper reused by the desktop main process, with regression tests proving blocked starts throw a batch-preserving error and ready preflights pass through.
- Collection preflight now also verifies that the matching diagnostic screenshot and sanitized DOM snapshot files still exist inside the app-owned evidence directories before any collection batch is created.
- Lingxing E2E acceptance audit export now applies the same diagnostic screenshot/DOM evidence file readiness, copies those evidence files into the audit folder when safe, and writes `diagnostic-evidence-files.json` so final audit bundles remain self-contained.
- Lingxing E2E acceptance audit export now also copies and indexes failed-report screenshot, DOM snapshot, and Playwright Trace evidence into `report-failure-evidence` with `report-failure-evidence-files.json`, making failed live runs easier to review without chasing DB paths.
- Lingxing E2E acceptance audit now also checks batch download-directory layout, so a manifest or downloaded report file outside the batch `downloadDir` fails the final audit instead of being accepted as evidence.
- Lingxing E2E acceptance audit export now writes `downloaded-report-files.json`, a safety index for successfully downloaded report files that records path containment, existence, actual size, declared size, and filename date-range analysis without copying large raw report files.
- Lingxing E2E acceptance audit now re-checks expected report filename keywords, so a persisted campaign row pointing at a keyword report file fails final audit even when the manifest and date tokens otherwise match.
- `downloaded-report-files.json` now also records each report's expected filename keyword and whether the basename matches that report type, so manual live-review can inspect report/file mismatches from the export folder directly.
- `downloaded-report-files.json` now includes per-file `readyForAcceptance` and `acceptanceBlockers`, summarizing path safety, report keyword match, and selected date-token checks for manual audit review.
- Lingxing E2E acceptance audit now compares recorded downloaded file sizes with the current files on disk during export, so a report file that was replaced or truncated after collection fails final audit.
- `downloaded-report-files.json` now also treats recorded/current file size mismatches as per-file acceptance blockers, keeping the JSON index aligned with the final acceptance audit.
- Lingxing E2E acceptance audit now also checks manifest `appVersion` against the persisted batch `appVersion`, so version-trace evidence must stay consistent through final audit.
- Lingxing E2E acceptance audit now treats a missing batch/manifest `appVersion` as incomplete evidence, so final audit cannot pass without version trace.
- Lingxing E2E acceptance audit now also requires manifest `generatedAt`, so final audit cannot pass with a manifest missing its own generation timestamp.
- Lingxing E2E acceptance audit now validates manifest `generatedAt` as a parseable timestamp that does not predate the persisted batch creation/completion time and is not later than the audit execution time.
- Lingxing E2E acceptance audit now also verifies the manifest's embedded batch snapshot `appVersion`, `createdAt`, and `completedAt` against the persisted batch, so a copied or stale manifest cannot pass with only matching top-level metadata.
- Lingxing E2E acceptance audit now verifies the manifest's embedded batch `downloadDir` and `manifestPath` against the persisted batch, so a manifest copied from another batch folder cannot pass final evidence review.
- Lingxing E2E acceptance audit now also verifies manifest file-row `displayName`, `createdAt`, and `updatedAt` against persisted report file rows, so stale file metadata cannot pass with only matching path and size.
- Lingxing E2E acceptance audit now also verifies manifest file-row retry and failure evidence metadata, including auto retry counts, error messages, attempt errors, screenshot/DOM/Trace paths, and trace-unavailable reasons.
- Independent subagent review found that batch `appVersion` was not persisted through the desktop DB path; the local DB schema, migration, save query, and persisted batch loader now keep `app_version` so final manifest version-trace audit has real DB evidence.
- Independent subagent review found that package-level acceptance audit could pass when callers omitted file existence or size callbacks; the audit now returns incomplete unless both evidence callbacks are supplied.
- Independent subagent review found that package-level acceptance audit could accept a forged diagnostic readiness boolean; the audit now requires readiness provenance (`diagnosticId` and `checkedAt`) to match the persisted diagnostic before the diagnostic check can pass.
- Goodall subagent review found no high/medium risk in the hard collection preflight gate. The review confirmed the change moves known failures before batch creation without adding new success-path semantics.
- Added collection preflight export. Operators can write a local preflight evidence folder before attempting live report creation.
- Collection preflight export now also writes the active page model, diagnostic evidence-file readiness index, matching diagnostic JSON when available, and safe copies of diagnostic screenshot/DOM evidence. This makes before/after selector-solidification review possible from the export folder without querying the local database.
- Collection preflight export is now extracted into a pure main-process helper with tests covering both matching-diagnostic and missing-diagnostic evidence bundle outputs.
- Collection preflight export now includes `preflight-review-checklist.md`, so live selector-solidification sessions have a fixed local review checklist covering blocked checks, date range, store/site scope, active model, diagnostic evidence, and next required action.
- Download-center diagnostics, collection preflight, enablement audit, collection batches, batch manifest, persisted batch rows, and final acceptance audit now carry the selected store/site scope. A diagnostic for one store/site no longer unlocks collection or enablement for another scope, and the final manifest check compares persisted batch store/site with the manifest batch snapshot.
- A follow-up reality-check review found a package-level final-audit gap: callers could provide matching diagnostic readiness provenance while the diagnostic itself belonged to a different store/site. `auditLingxingAcceptanceEvidence` now directly compares diagnostic store/site scope with the persisted batch scope and stays incomplete on mismatch.
- Collection preflight export now also writes `preflight-bundle-index.json`, a machine-readable index of readiness, blocked checks, diagnostic evidence readiness, diagnostic ID, and expected bundle files for automated review of pre-live evidence folders.
- Download-center diagnostics now include read-only Playwright visible-locator counts for configured action selectors, including placeholder-expanded checks across the 8 report types, plus usable/ambiguous labels so broad selectors are not mistaken for safe automation targets.
- Real collection now repeats per-action visible-locator safety checks before filling fields or clicking create/download controls, and ready/download selectors must include both report and date placeholders so old report rows fail closed before download.
- Downloaded report verification now also requires valid collection dates and selected start/end date tokens in the filename, so wrong-date files are marked failed with preserved file-size evidence instead of being imported silently.
- Filename date-range verification now uses a shared analyzer that reports normalized filename digits and whether the start or end token is missing, so real Lingxing sample filename mismatches are easier to diagnose without loosening the fail-closed policy.
- Lingxing E2E acceptance audit JSON now includes per-report filename/date analyses and the desktop export writes `filename-date-range-analysis.json`, giving a machine-readable record for real Lingxing filename sample validation.
- Report status polling now has DOM-independent semantics for pending, created, generating, ready, failed, expired, skipped, and unknown states, with terminal failure fail-fast behavior covered by unit tests. Desktop automation can optionally use a verified `statusTextSelector` to read row status text before download; if omitted, it falls back to the ready-row selector.
- Keyword opportunity generation now keeps the same keyword separated by ASIN, preserving product-specific opportunity rows during repeated imports. Listing suggestions are generated from opportunities scoped to the current Listing ASIN.
- Local DB startup deduplicates historical keyword metric/opportunity rows before adding unique indexes for imported source rows and ASIN/keyword opportunities.
- SQLite persistence now stores automatic retry counts and failure evidence fields, including migrations for existing local databases.
- UI report table now shows automatic retry count and links to screenshot/DOM/Trace evidence when present.
- Manual row-level `重试` still creates a new single-report retry batch.
- Stabilized the status-poller success-path test timeout so full parallel test runs do not fail before the second status read under local load. Production polling defaults were not changed.
- Verified the real ERP login surface in a Playwright persistent browser session: `https://erp.lingxing.com/` uses `input[name="account"]`, `input[name="pwd"]`, and `button.loginBtn`; the older `www.lingxing.com/login` path is not the app login surface.
- Verified that the Ads system is a distinct surface at `https://ads.lingxing.com/home`; login handling now validates the Ads session after ERP login and throws a clear operator message if Ads authorization/session is not ready.
- Verified the real Ads download center at `https://ads.lingxing.com/ak_download/download_center/download_report_log/index`; the bundled page model now starts from that URL and allowlists `ads.lingxing.com`.
- Captured read-only live Ads download center evidence under `output/playwright/lingxing-ads-download-center-2026-06-03T02-16-06-375Z/`, including rows for the 8 SP report types and `.JS-download-report` download links.
- Captured read-only create-report evidence under `output/playwright/lingxing-ads-create-report-modal-2026-06-03T02-17-17-750Z/`, including store selection, report name, report type, start/end date fields, metric controls, and the `生成报告` button. No live report generation was clicked.
- Updated selector-candidate collection to include the real Ads download-center DOM families: DataTables rows, Element UI date/select/dialog controls, `.JS-download-report`, and role-based rows/dialogs.

## Verification

Latest local evidence:

- `pnpm vitest run packages/lingxing-report-collector/src/page-model-diagnostic.test.ts packages/lingxing-report-collector/src/diagnostic-evidence-gate.test.ts packages/lingxing-report-collector/src/page-model-enablement-audit.test.ts packages/lingxing-report-collector/src/collection-preflight.test.ts packages/lingxing-report-collector/src/batch-runner.test.ts apps/desktop/src/main/download-center-page-model-validation.test.ts`: passed, 6 test files / 52 passed.
- `pnpm -r run typecheck`: passed across workspace packages and desktop app.
- `pnpm test`: passed, 24 test files / 146 passed / 2 skipped.
- Targeted scope-regression run: `pnpm test -- acceptance-audit.test.ts diagnostic-evidence-gate.test.ts batch-runner.test.ts collection-preflight-export.test.ts page-model-enablement-audit-export.test.ts` passed, 5 test files / 53 passed.
- After packaging rebuilt `better-sqlite3` for Electron ABI `119`, the local Node-side binary was restored with `D:\PY\python.exe`, VS BuildTools/MSBuild, and `PlatformToolset=v143`; `pnpm --filter @amazon-ai-ops/local-db exec node -e "require('better-sqlite3')"` passed, followed by `pnpm test -- db.test.ts acceptance-audit.test.ts` passing, 2 files / 32 passed.
- Deprecated scheduler cleanup targeted checks: `pnpm --filter @amazon-ai-ops/scheduler run typecheck` and `pnpm --filter @amazon-ai-ops/desktop run typecheck` both passed after removing `daily_report_download`.
- Renderer layout QA: `output/codex-evidence/renderer-v15-diagnose-layout-qa-1780561270634.json` shows `elementFromPoint` at the `验证页面` button center resolves to the button and that the mocked UI diagnostic success message appears.
- `pnpm test -- download-center-page-model-validation.test.ts page-model-diagnostic.test.ts`: passed after accepting `ads.lingxing.com` and updating the bundled page model.
- `pnpm --filter @amazon-ai-ops/desktop run build:win`: passed and generated `apps/desktop/release/AmazonAIOpsAgent-1.5.0.exe`.
- Current installer evidence: size `89601584` bytes, SHA-256 `6039B60FADCC0AF2BA0553B2316A0534D9258E68C735A1E072DDCB3304994C7F`, last write time `2026-06-08 10:35:51`.
- Packaged executable smoke test: `apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe` remained alive after 8 seconds, then was stopped.
- Real desktop IPC diagnostic evidence: diagnostic id `4`, `ready: true`, `missingRequiredSelectors: []`; create-page setup selectors were all found and usable with match count `1`. `readyReportSelector` and `downloadButton` remain unproven because no generated report row for the unique generated name exists yet.
- `pnpm --filter @amazon-ai-ops/desktop test -- collection-preflight-export.test.ts`: passed after extracting the preflight evidence bundle writer, adding the review checklist, and adding `preflight-bundle-index.json`.
- `pnpm --filter @amazon-ai-ops/desktop test -- download-center-diagnostic-evidence-files.test.ts`: passed after adding the preflight diagnostic evidence bundle helper.
- `git diff --check`: passed with only expected Windows LF-to-CRLF warnings.
- `pnpm build`: previously passed after the preflight evidence-bundle export change and generated `apps/desktop/release/AmazonAIOpsAgent-1.5.0.exe`; the latest installer evidence above is from `build:win`.
- A re-run after a transient NSIS-stage nonzero exit also passed; the retry reached `building block map` and exited successfully.
- Earlier packaged executable smoke test: process started and remained alive after 8 seconds.
- Latest post-smoke process check found no remaining `AmazonAIOpsAgent`, `7za`, or `electron` process.

Known build warnings:

- Vite CJS Node API deprecation warning.
- electron-builder warns `asar: false`.
- electron-builder warns `cannot find prebuild-install` during native dependency rebuild, but the build continued and completed NSIS packaging.

## Active Blocker

Real Lingxing download-center automation is intentionally fail-closed. These items are now verified:

- ERP login selectors.
- Ads system URL and session check.
- Ads download-center URL and menu link.
- Read-only historical rows for the 8 SP report types.
- Create-report page presence, including report name, report type, date fields, metrics, and generate button.

These live automation details still need verification before disabling `requiresManualVerification`:

- Store selector action flow through an actual generate attempt, including the already-selected-store case.
- Report type dropdown action flow for all 8 reports, not only the campaign-report diagnostic context.
- Date range control fill behavior through Lingxing's Vue/Element UI state, not only visible input uniqueness.
- Create report button click plus any confirm/result dialog.
- Generation/ready status indicator.
- Row scoping for report name/date/status.
- Download button selector scoped by report/date and final filenames.
- Real Playwright tracing lifecycle for failed download attempts.
- Full desktop UI `验证页面` rerun with a live Lingxing session should still be used to refresh same-model/date/store/site evidence, but the prior click blocker was a renderer layout overlap and is now covered by renderer QA. Direct desktop IPC diagnostic remains proven by diagnostic id `4`.

Until those are verified, the app can diagnose the page, record retry/evidence metadata, and expose retry workflows, but it must not claim that real Lingxing report creation/download is complete.

## Next Work

1. Export the diagnostic evidence bundle for diagnostic id `4`, then review screenshot, DOM, and action selector checks.
2. Rerun the desktop UI `验证页面` path after the Lingxing login/Ads session is stable to refresh same-model/date/store/site evidence from the current build.
3. If report generation is approved, run a controlled single-report live create/download proof before enabling all 8 reports.
4. Use the generated report row to verify ready/download selectors scoped by `{generatedReportName}` and selected date range.
5. Run `导出启用审计`; only if setup, ready, download, same-model/date diagnostic, and evidence-file checks pass should `requiresManualVerification` be considered for disablement.
6. Run live E2E: full 8-report batch, automatic retry failure path, manual single-report retry, manifest verification, downloaded file parsing, and final acceptance audit.
