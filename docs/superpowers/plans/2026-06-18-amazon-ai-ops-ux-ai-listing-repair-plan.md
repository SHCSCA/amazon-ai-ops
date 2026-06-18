# Amazon AI Ops UX, AI, and Listing Repair Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复当前后台“看不懂、拉不完、AI 报错、广告未按产品拆分、Listing 读取不完整”的核心体验问题，把系统调整为可按产品运营的广告量化工作台。

**Architecture:** 保留现有 Electron + React + SQLite 架构，不重做系统。把主流程改为“范围 -> 产品 -> 数据健康 -> AI+规则诊断 -> 建议/审批/回读”，把审计、证据和历史信息放进展开区。Listing 以手工录入和版本历史为主，领星读取只作为辅助填充。

**Tech Stack:** Electron main/preload/renderer, React, TypeScript, SQLite, Vitest, existing smoke scripts, DeepSeek/OpenAI-compatible adapter.

---

## Delivery Principles

- 主界面只展示运营结论、当前任务、下一步和少量关键指标。
- 长证据、批次解释、AI 调用日志、原始诊断默认折叠。
- 广告量化必须按产品/ASIN 拆分，默认只看一个产品。
- AI 输出必须是结构化 JSON。AI JSON 失败时做一次修复，仍失败则显示中文兜底，不向用户暴露 parser position。
- Listing 不再依赖领星自动读取完整性。用户可手工维护标题、五点、详情、A+、图片文案和后台搜索词，每次保存都形成版本。
- 金额统一 USD 或 `$`。
- 中途只跑增量测试，最终节点再跑全量测试、UI smoke 和 Windows 打包。

## Current Files

- AI adapter:
  - `packages/ai-adapter/src/ad-strategy-diagnosis.ts`
  - `packages/ai-adapter/src/ad-strategy-diagnosis.test.ts`
- AI UI diagnostics:
  - `apps/desktop/src/renderer/ai-call-diagnostics.ts`
  - `apps/desktop/src/renderer/ai-call-diagnostics.test.ts`
- UI shell and scope:
  - `apps/desktop/src/renderer/App.tsx`
  - `apps/desktop/src/renderer/components/scope-bar.tsx`
  - `apps/desktop/src/renderer/styles.css`
- Ad quant:
  - `apps/desktop/src/renderer/pages/ad-quant-page.tsx`
  - `apps/desktop/src/renderer/ad-quant-product-groups.ts`
  - `apps/desktop/src/renderer/ad-quant-product-groups.test.ts`
- Listing:
  - `apps/desktop/src/renderer/pages/listing-optimization-page.tsx`
  - `apps/desktop/src/main/listing-manual-content.ts`
  - `apps/desktop/src/main/listing-manual-content.test.ts`
  - `packages/local-db/src/sqlite/db.ts`
  - `packages/local-db/src/sqlite/listing-content-version.test.ts`
  - `packages/shared-types/src/v1_5.ts`
- Page flow:
  - `apps/desktop/src/renderer/pages/dashboard-page.tsx`
  - `apps/desktop/src/renderer/pages/recommendations-page.tsx`
  - `apps/desktop/src/renderer/pages/approval-page.tsx`

## Task 1: Fix AI Structured Output Failure

**Objective:** 广告量化页不能再把 `Expected ',' or ']' after array element in JSON at position...` 这种工程错误暴露给运营用户。

- [ ] Add or keep tests in `packages/ai-adapter/src/ad-strategy-diagnosis.test.ts`:
  - malformed JSON triggers one repair request.
  - repaired JSON is parsed as `ad_strategy_diagnosis_v1`.
  - unrecoverable JSON returns Chinese fallback.
  - fallback still includes evidence-pack summary and rule fallback.

- [ ] Add or keep tests in `apps/desktop/src/renderer/ai-call-diagnostics.test.ts`:
  - raw parser location is hidden.
  - operator-facing text is `AI 输出格式未通过校验，当前使用规则引擎兜底。`

- [ ] Implementation rules:
  - `diagnoseAdStrategy()` first parses model output.
  - If parsing fails, call the same provider once with a JSON repair prompt and `responseFormat: 'json_object'`.
  - If repair fails, return rule fallback with Chinese `aiFallbackReason`.
  - Renderer must always pass AI errors through `operatorFacingAiError()`.

- [ ] Incremental test:

```powershell
pnpm exec vitest run packages/ai-adapter/src/ad-strategy-diagnosis.test.ts apps/desktop/src/renderer/ai-call-diagnostics.test.ts
```

Expected: PASS.

## Task 2: Reduce Global UI Density

**Objective:** 解决文字偏大、卡片过高、页面太长、范围说明占用主屏的问题。

- [ ] In `apps/desktop/src/renderer/styles.css`, enforce compact tokens:
  - body base font around `14px`.
  - topbar around `54px`.
  - sidebar width around `226px`.
  - main content padding around `18px 24px`.
  - cards use `8px` radius and smaller padding.
  - form controls use compact height and clear labels.

- [ ] In `apps/desktop/src/renderer/components/scope-bar.tsx`:
  - only show date, store, site, currency, current batch, report coverage and imported row count.
  - move “批次作用/范围说明” into `<details>`.
  - hide raw batch explanation unless expanded.

- [ ] In `apps/desktop/src/renderer/App.tsx`:
  - prevent duplicated navigation groups.
  - keep global topbar concise.
  - do not render page-level delivery/debug cards globally.

- [ ] Incremental check:

```powershell
pnpm exec vitest run apps/desktop/src/renderer/ai-call-diagnostics.test.ts
```

Expected: PASS. If scope-bar tests exist, include them.

## Task 3: Make Ad Quantification Product-Scoped

**Objective:** 广告量化不再一次展示全部广告对象。运营先选择产品/ASIN，再看该产品下的 Campaign、Ad Group、Keyword、Search Term、Target。

- [ ] In `apps/desktop/src/renderer/ad-quant-product-groups.ts`:
  - group metrics by ASIN when available.
  - put rows without ASIN into `未绑定 ASIN`.
  - default selection order:
    1. current scope ASIN
    2. highest spend ASIN
    3. first product group
    4. unbound group

- [ ] In `apps/desktop/src/renderer/pages/ad-quant-page.tsx`:
  - add product selector near page top.
  - show one selected product summary by default.
  - collapse evidence details, history details and AI call history.
  - show at most 3 core reasons in the first screen.
  - product switch must filter diagnostics, timelines, ledgers and recommendation candidates.

- [ ] Incremental test:

```powershell
pnpm exec vitest run apps/desktop/src/renderer/ad-quant-product-groups.test.ts
```

Expected: PASS.

## Task 4: Convert Listing To Manual Versioned Workflow

**Objective:** 领星 Listing 读取不完整时，系统仍可工作。用户手工维护 Listing 内容，并能查看历史版本用于对比。

- [ ] Data model:
  - extend `listing_content` with manual-source fields.
  - create `listing_content_versions`.
  - version fields include ASIN, title, bullets, description, A+, image copy, backend terms, source, version label, change summary, created time.

- [ ] Main process:
  - add manual Listing normalization in `apps/desktop/src/main/listing-manual-content.ts`.
  - add IPC for saving manual content.
  - add IPC for listing version history.
  - save latest content and append version in one transaction.

- [ ] Renderer:
  - `Listing 优化` page shows manual editor as the primary card.
  - inputs: ASIN, title, five bullets, description/detail, A+, image copy, backend search terms, version label, change summary.
  - Lingxing read button becomes “辅助读取并填入表单”, not a readiness blocker.
  - show latest saved version and history list.

- [ ] Incremental tests:

```powershell
pnpm exec vitest run packages/local-db/src/sqlite/listing-content-version.test.ts apps/desktop/src/main/listing-manual-content.test.ts apps/desktop/src/renderer/listing-workflow-summary.test.ts
```

Expected: PASS.

## Task 5: Rework Each Page Around One Operator Job

**Objective:** 每个页面第一屏只回答四件事：当前范围、是否可做、为什么、下一步。

- [ ] Dashboard:
  - current scope
  - data health
  - AI health
  - products needing attention
  - next action

- [ ] 数据采集:
  - selected scope and real report status
  - create/download/import separated clearly
  - export path visible only in result card
  - no audit JSON mixed into “真实报表”

- [ ] 数据导入与校验:
  - show imported report count, daily metric rows, missing report types, currency.
  - raw files and audit details collapsed.

- [ ] 广告量化:
  - product selector first.
  - show product phase, threshold suggestion, AI+rule agreement, evidence count.
  - long evidence details collapsed.

- [ ] 优化建议:
  - group by product/campaign.
  - main row shows action, object, current value, recommended value, reason, risk.
  - AI evidence and rule evidence in expandable details.

- [ ] 审批中心:
  - formal recommendations only.
  - insight-only candidates cannot be approved.
  - evidence and policy details collapsed.

- [ ] 执行回读:
  - only readback and execution evidence.
  - no recommendation generation controls here.

- [ ] 关键词机会:
  - group by product/ASIN.
  - show coverage and opportunity status.
  - keep source file evidence in details.

- [ ] Listing 优化:
  - manual content editor.
  - keyword coverage.
  - AI draft.
  - version history.

## Task 6: Visible UI Verification

**Objective:** 不只看测试，要看实际界面是否解决用户指出的问题。

- [ ] Build renderer:

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:renderer
```

- [ ] Run current UI smoke:

```powershell
pnpm run smoke:business-ui-current
```

- [ ] Visible checklist:
  - sidebar does not duplicate sections.
  - 1920x1080 下不需要长距离滚动才能理解页面。
  - dashboard first screen shows useful status, not empty KPI cards.
  - ad quant page defaults to one product.
  - AI error is Chinese fallback, not parser stack text.
  - Listing page can save manual version without Lingxing read.
  - no RMB symbols appear.

## Task 7: Final Delivery Gate

**Objective:** 只有最终节点跑全量验证和打包，避免中途浪费时间。

- [ ] Full typecheck:

```powershell
pnpm -r run typecheck
```

- [ ] Full tests:

```powershell
pnpm test
```

- [ ] Windows build:

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:win
```

- [ ] Package evidence:

```powershell
Get-FileHash apps/desktop/release/AmazonAIOpsAgent-1.5.0.exe -Algorithm SHA256
Get-FileHash apps/desktop/release/AmazonAIOpsAgent-1.5.0-portable.exe -Algorithm SHA256
Get-Item apps/desktop/release/AmazonAIOpsAgent-1.5.0.exe, apps/desktop/release/AmazonAIOpsAgent-1.5.0-portable.exe | Select-Object FullName,Length,LastWriteTime
```

- [ ] Final readiness:
  - generate or refresh evidence manifest.
  - run final readiness verifier.
  - export delivery bundle.
  - run READY safety verifier.

- [ ] Docs:
  - update `README.md`.
  - update `docs/V1_5_PROGRESS_REPORT.md`.
  - update `docs/V1_5_ACCEPTANCE_MATRIX.md`.
  - update `docs/USER_GUIDE_v1_5.md`.
  - update `docs/V1_5_ORCHESTRATOR_CLOSEOUT.md`.

## Acceptance Criteria

- AI structured-output error no longer appears as raw parser text.
- 广告量化按产品/ASIN 进入，不再一页铺满所有广告对象。
- Listing 主流程是手工录入 + 版本历史，领星读取为辅助。
- 每个页面第一屏有明确任务和下一步。
- 证据链还在，但默认不压住主流程。
- USD display is consistent.
- Incremental tests pass during implementation.
- Final typecheck, tests, smoke, build, final-readiness, delivery bundle and READY safety pass before claiming deliverable.

## Execution Mode

Recommended mode: inline execution in the current worktree.

Reason: 当前工作树已经有相关未提交修改，继续 inline 可以避免误覆盖上下文。子代理只用于独立审查或局部调研，用完即关。
