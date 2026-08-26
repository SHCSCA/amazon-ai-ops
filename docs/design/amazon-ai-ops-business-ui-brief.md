# Amazon AI Ops Business UI Brief

> Historical design reference (2026-07-03 baseline). Current delivery status and acceptance authority live in `PROGRESS.md`, `BLOCKED.md`, and `docs/OPERATOR_CORE_FLOW_REPAIR_2026-08-07.md`; status wording below is not current release evidence.

## User

The primary user is an Amazon cross-border ads operator or operations lead who manages US marketplace advertising through Lingxing ERP, Amazon Ads evidence, keyword opportunities, and Listing optimization. The user needs to understand daily performance quickly, trust the source data, decide what actions are safe, and produce evidence that another operator, manager, or delivery reviewer can audit later.

This is not a developer console and not a marketing dashboard. It is an operational desktop console for repeated work: collect reports, quantify ads, review recommendations, approve changes, record execution/readback, and deliver a proof package.

## Core Tasks

- Confirm the current operating scope: date range, store, marketplace, ASIN when relevant, currency, and data batch.
- Collect real Lingxing advertising report files for the selected scope.
- Import and reconcile original XLSX, XLS, or CSV report files before showing quantitative diagnosis.
- Quantify ad performance with spend, sales, orders, ACOS, CVR, CPC, waste, scaling opportunity, and risk.
- Generate recommendations from imported metrics, rules, and AI explanations only after the data prerequisites are satisfied.
- Review, approve, or reject recommendations with clear scope, risk, approver, and decision evidence.
- Record actual execution and readback evidence, including before and after values and evidence paths.
- Surface keyword opportunities from real imported ad metrics, with deduplication and campaign/ad group/product context.
- Read Lingxing Listing content, assess keyword coverage, produce AI/rule-labeled drafts, and export drafts without implying live Amazon submission.
- Export a delivery and acceptance package that summarizes evidence, missing blockers, final readiness status, and installer/package artifacts.

## Non-Negotiable Constraints

- The current US marketplace scope uses USD as the default currency. Do not show RMB or mixed-currency summaries on business pages.
- Real Lingxing report files are the source of record. Original XLSX, XLS, or CSV file paths must be visible where data readiness is discussed.
- No original report files means no ad quantification.
- No imported ad metrics means no recommendations.
- No recommendation evidence means no approval.
- No approval and readback evidence means no delivery-ready claim.
- Technical audit details must remain accessible, but they are not the primary workflow. JSON, selectors, command snippets, and diagnostics belong in collapsed technical panels or the delivery/acceptance page.
- A page must never claim `APP_READY` or delivery completion unless the final manifest-driven readiness gate passes.
- API keys and secrets must never be displayed in full.
- Batch labels must never replace user-readable evidence. A batch only matters when its source, date range, store, marketplace, original files, import status, and downstream impact are clear.

## Real Reports First

The redesign must treat report collection as the first operational gate. The user should not have to infer whether a result came from real files, audit screenshots, test fixtures, or optimistic state labels.

Business pages should answer these questions before showing downstream actions:

- Which store, marketplace, and date range are being evaluated?
- Which Lingxing reports were requested?
- Which original files exist locally?
- Which files were imported?
- How many ad metric rows are available?
- Where are the original files and audit artifacts stored?
- What is still missing before the next step becomes safe?

When a page references a data batch, it should use the label `数据批次` and explain it as a verified data set tied to the current scope and source files. A naked `batch_...` identifier is not enough for business users.

## Currency

Use USD for all US marketplace spend, sales, CPC, opportunity value, and financial summaries. Recommended formatting:

```ts
const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});
```

If later scopes support other marketplaces, currency should be tied to the selected marketplace and shown in the global scope. For this redesign group, the current US scope must remain USD.

## Primary Flow

The main workflow is:

```text
登录领星 ERP
-> 进入 Ads / 下载中心
-> 设置运营范围: 日期 / 店铺 / 站点 / ASIN / 数据批次
-> 下载或复用真实 Lingxing 广告报表
-> 导入并核验原始 XLSX / XLS / CSV
-> 广告量化诊断
-> 规则 / DeepSeek 生成优化建议
-> 人工审批
-> 执行记录或低风险受控执行
-> before / after / readback 验收
-> 交付验收包
```

Each transition must be gated by evidence. The UI should make the next safe action obvious without hiding why blocked actions are disabled.

## Secondary Keyword and Listing Flow

The secondary workflow starts from the same real imported data:

```text
真实报表文件与导入指标
-> 关键词机会识别
-> 按 ASIN / campaign / ad group / keyword / search term 去重
-> Listing 读取或导入
-> 关键词覆盖评估
-> AI / 规则生成 Listing 草案
-> 导出草案与证据
```

Keyword opportunity rows must preserve business context. A keyword without ASIN, campaign, ad group, match/source context, and metric evidence is not actionable enough for operations.

Listing optimization must be framed as a local draft workflow. It can read Lingxing content, produce drafts, and export them, but it must not imply that the app automatically submits Listing changes to Amazon.

## Page-Level Visual Principles

- Use a restrained B2B operations style: dense, scannable, calm, and evidence-led.
- Keep the app shell stable. Navigation should make workflows visible instead of burying everything inside one large workbench.
- Every page should show the current operating scope near the top.
- Every page should have one dominant job, one clear next action, and explicit blocked states.
- Use compact KPI strips, status rows, tables, filters, and detail drawers rather than oversized marketing cards.
- Use semantic status language: ready, missing files, imported, blocked, needs approval, approved, readback pending, delivery blocked.
- Avoid large code blocks, CLI command walls, raw selector diagnostics, and JSON dumps in the primary view.
- Put technical proof in collapsed `技术细节` sections or in `交付验收`.
- Prefer tables for operational objects: report files, metrics, recommendations, approvals, readback records, keywords, and Listing draft rows.
- Show file paths in compact form in tables, with actions to open the file or containing folder where supported.
- Use clear disabled states. A disabled action must explain the missing prerequisite.
- Keep page copy business-facing. Explain what the user can do and what evidence exists, not how the implementation works internally.

## Required Navigation Model

- 运营总览
  - 仪表盘
- 数据与量化
  - 数据采集
  - 广告量化
- 广告执行
  - 优化建议
  - 审批中心
  - 执行回读
- 关键词与 Listing
  - 关键词机会
  - Listing 优化
- 系统与交付
  - 定时任务
  - 设置
  - 交付验收

## Implementation Source of Truth

Until Stitch is callable in the current Codex session, this brief and `docs/design/amazon-ai-ops-screen-map.md` are the design source of truth for Task 0/1. Future Stitch output can supplement these docs, but it must not contradict the evidence gates, USD rule, real-report-first principle, or page responsibilities defined here.
