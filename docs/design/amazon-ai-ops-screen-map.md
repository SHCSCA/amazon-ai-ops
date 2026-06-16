# Amazon AI Ops Screen Map

## 仪表盘

Purpose: Show current operational health, data readiness, KPI direction, and the next safe action for the selected Amazon ads scope.

Primary content: First-screen data health, current scope, data freshness, real report readiness, imported metric row count, AI status, pending approval count, KPI strip in USD, ad quantification summary, risk summary, recent evidence paths, and next-action routing.

Primary actions: Go to data collection, view ad quantification, generate recommendations, enter approval center, open recent evidence folder.

Blocked states: No original report files; no imported metrics; stale scope; missing store or marketplace; readiness manifest says the app is not delivery-ready.

Must not show: Raw selector diagnostics, long CLI commands, JSON manifests as primary content, RMB values for US scope, or optimistic ready claims without evidence.

## 数据采集

Purpose: Create, download, import, and audit real Lingxing advertising report files for the current operating scope.

Primary content: Current scope, selected report checklist, Lingxing download-center state, original file table, import summary, downloaded/imported counts, local folder paths, audit export status, and collapsed technical details.

Primary actions: Validate download center, run collection preflight, download already-created selected reports, recreate and download selected reports, open local report folder, open original file, open containing folder, re-download a report, export acceptance audit.

Blocked states: Lingxing session unavailable; download center cannot be verified; report rows not found; no XLSX/XLS/CSV files exist; files exist but import rows are zero; local path missing; only diagnostic files exist.

Must not show: Recommendation conclusions, approval controls, delivery-ready claims, or a false `已下载 8/8` state when the local folder has no original report files.

## 广告量化

Purpose: Quantify imported ad metrics and identify waste, scaling opportunities, and risk using real report data.

Primary content: Current scope, data prerequisite status, spend, sales, orders, ACOS, CVR, CPC, waste spend, scalable sales, high-risk entity count, threshold summary, entity-level table, and diagnosis reason codes.

Primary actions: Refresh quantification, adjust visible threshold filters, inspect entity detail, send qualified entities to recommendation generation, open source report evidence.

Blocked states: No original report files; no imported ad metric rows; current scope does not match available batch; thresholds missing; imported totals fail reconciliation.

Must not show: Execution controls, approval decisions, raw database dumps, unformatted technical stack traces, RMB values for US scope, or recommendations that are not backed by imported metrics.

## 优化建议

Purpose: Explain recommended advertising changes with complete business context, source evidence, current value, proposed value, source type, and risk.

Primary content: Current scope, recommendation readiness, AI connection status, rule fallback status, recommendation table by portfolio/campaign/ad group/product/entity, current metrics, recommended action, reason, risk, and detail drawer.

Primary actions: Generate recommendations, refresh recommendations, view detail, compare evidence, send selected recommendations to approval.

Blocked states: No imported metrics; ad quantification not ready; AI unavailable and no rule fallback available; recommendation lacks source evidence; selected recommendation has incomplete campaign/ad group/entity context.

Must not show: Raw readback forms, live execution buttons, unbounded write controls, full API keys, or recommendations without current and recommended values.

## 审批中心

Purpose: Let operators safely approve or reject recommendations with explicit scope, approver identity, allowed action types, risk, and decision evidence.

Primary content: Current scope, tabs for pending/approved/rejected recommendations, approval queue, risk policy, recommendation context, approver fields, approval scope, decision notes, and decision history.

Primary actions: Approve selected recommendation, reject selected recommendation, request changes, bulk-select only within the same validated scope, send approved actions to execution/readback.

Blocked states: Recommendation has no evidence; scope mismatch; approver missing; approval range missing; action type not allowed by safety policy; selected items cross stores, marketplaces, or incompatible scopes.

Must not show: Data collection diagnostics, raw Lingxing selectors, recommendation generation controls as the main task, or any claim that approval already means execution.

## 执行回读

Purpose: Record actual execution and verify after-values against approved recommendations and evidence paths.

Primary content: Current scope, approved action selector, execution result form, before/after values, readback actual value, evidence paths, operator notes, status timeline, export evidence controls, and collapsed technical validation commands.

Primary actions: Select approved action, record manual execution, attach before evidence, attach after evidence, enter readback actual value, validate readback, export ad readback evidence.

Blocked states: No approved action; missing before evidence; missing operator confirmation; missing after evidence; readback actual value missing; action scope differs from approved recommendation; safety policy does not permit execution.

Must not show: Long command walls by default, recommendations that bypass approval, one-off UI assumptions for a single ASIN/ad group, or unbounded live-write controls.

## 关键词机会

Purpose: Produce deduplicated keyword and search-term opportunities from real imported ad metrics while preserving ASIN, campaign, ad group, and evidence context.

Primary content: Current scope, keyword readiness, deduplication summary, opportunity table with ASIN/campaign/ad group/entity/keyword/search term, clicks, orders, spend, sales, ACOS, coverage status, opportunity score, recommended placement, and risk.

Primary actions: Refresh opportunities, filter by ASIN or campaign, inspect row evidence, export opportunity list, send selected keyword context to Listing optimization.

Blocked states: No imported search term or keyword metrics; missing ASIN/campaign/ad group context; duplicate keys cannot be resolved; current scope does not match available metrics.

Must not show: A `source` column as the main business signal, duplicate rows for the same business identity, keyword claims without metric evidence, or Listing submission controls.

## Listing 优化

Purpose: Read or import Listing content, evaluate keyword coverage, generate AI/rule-labeled local drafts, and export draft evidence.

Primary content: Current scope, ASIN selector, Listing source status, title/bullets/backend terms, Lingxing page match status, screenshot evidence, keyword coverage, AI/rule draft rows, risk notes, and export status.

Primary actions: Read Lingxing Listing, import Listing text, analyze coverage, generate draft, copy draft section, export draft package, open evidence path.

Blocked states: ASIN missing; Lingxing page does not match ASIN; title/bullets/backend terms not readable; no keyword opportunity evidence; AI unavailable and no rule fallback exists.

Must not show: Claims that the draft was submitted to Amazon, full API keys, unrelated ad approval controls, or Listing changes without source text and keyword evidence.

## 定时任务

Purpose: Manage scheduled collection, quantification, recommendation, and evidence-export jobs without confusing schedules with completed business evidence.

Primary content: Current scope defaults, schedule list, next run time, last run result, job type, prerequisite summary, failure reason, and output evidence path when available.

Primary actions: Create schedule, pause schedule, resume schedule, run once, view last evidence, open output folder.

Blocked states: Lingxing session required but unavailable; scope incomplete; target job has unmet upstream evidence; storage path missing; previous run failed and needs operator review.

Must not show: Scheduler success as delivery readiness, hidden automatic live writes, or technical cron/debug logs as the main page content.

## 设置

Purpose: Configure AI provider access, rule thresholds, storage, safety policy, and diagnostics while keeping secrets protected.

Primary content: DeepSeek/OpenAI-compatible settings, AI connection status, selected model/base URL, masked key state, ad quantification thresholds, safety controls, storage paths, and diagnostic utilities.

Primary actions: Save AI settings, test AI connection, update thresholds, reset thresholds, choose storage folder, run a diagnostic check, open local app data path.

Blocked states: Invalid base URL; missing API key for AI mode; model unavailable; threshold value outside allowed range; storage path inaccessible.

Must not show: Full API keys, primary business workflow controls, raw logs as the first view, or settings that silently diverge from runner-applied settings.

## 交付验收

Purpose: Summarize final evidence, missing blockers, manifest readiness, package status, installer hash, and user-readable acceptance output.

Primary content: Final readiness state, evidence manifest status, real report file evidence, ad quantification status, AI verification status, recommendation evidence, Listing read/draft evidence, readback evidence, package/export paths, installer path, SHA-256 hash, and missing blocker list.

Primary actions: Refresh readiness, export delivery bundle, open evidence folder, open installer path, copy final report summary.

Blocked states: Final readiness manifest fails; original report files missing; DB totals missing or inconsistent; AI verification missing when required; readback evidence missing; installer missing; hash not recorded.

Must not show: `APP_READY` when the manifest fails, technical artifacts without user-readable interpretation, or test/build success as a substitute for real report and readback evidence.
