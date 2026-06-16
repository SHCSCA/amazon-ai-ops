# Amazon AI Ops AI Quantified Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Amazon AI Ops from a report/audit tool into a real Amazon ads operating system: collect true daily Lingxing ad data, store it as a historical warehouse, combine rules and AI to diagnose product promotion stage, produce quantitative thresholds and recommendations, then route approved actions into safe execution/readback.

**Architecture:** Use real Lingxing XLSX/CSV files as source of record, import them idempotently into SQLite daily fact tables, enrich the facts with operator events such as coupons/promotions/BD/deals, then run rules and AI in parallel. UI must follow the business flow instead of showing one giant workbench: scope -> data -> quantification -> recommendations -> approval -> readback -> delivery.

**Tech Stack:** Electron desktop, React renderer, TypeScript, SQLite via `better-sqlite3`, existing Lingxing collector/parser packages, `rules-engine`, `ai-adapter`, DeepSeek/OpenAI-compatible API, targeted Vitest tests, renderer smoke scripts, final Windows build.

---

## 1. Product Decisions From Discussion

### 1.1 Core Business Premise

The system must start from real advertising data. If no original Lingxing ad report files are downloaded and imported, the app has no reliable basis for quantification, AI analysis, recommendations, or execution.

### 1.2 Data Time Horizon

For each product/ASIN, data should be collected from advertising day 1 onward where possible. Lingxing reports are pulled by date range, but after import the database must preserve daily rows so the app can reconstruct product history, promotion phases, and performance changes over time.

### 1.3 AI Role

AI is not just a text explainer. It must run in parallel with rule logic:

- Rules provide deterministic guardrails, minimum evidence, safety thresholds, and reproducible actions.
- AI provides product-stage judgment, context interpretation, dynamic threshold suggestions, diagnosis summaries, and candidate recommendations.
- The final decision layer compares AI and rules, highlights agreement/conflict, and never lets AI directly execute ads.

### 1.4 Operator Context

The system must allow operators to record business events that affect advertising interpretation:

- Coupon started/ended.
- Promotion or big sale event.
- BD / LD / seasonal campaign.
- Price change.
- Inventory pressure.
- Listing change.
- Review/rating change.
- External traffic or influencer activity.

These events become AI/rule context. Example: a short-term ACOS spike during a coupon or BD may mean a different action than the same ACOS spike during normal days.

### 1.5 UI Principle

The current UI problem is not just styling. The main issue is unclear responsibility and user flow. Every page must answer:

- What is this page for?
- What scope am I operating on?
- What data do I currently have?
- What is missing?
- What should I do next?
- Which action is safe now, and which action is blocked?

---

## 2. Target Information Architecture

Final sidebar structure:

```text
运营总览
  仪表盘

数据与量化
  数据采集
  广告量化
  运营事件

广告决策
  优化建议
  审批中心
  执行回读

关键词与 Listing
  关键词机会
  Listing 优化

系统与交付
  定时任务
  设置
  交付验收
```

No page should behave like another embedded workbench. Each page owns one job.

---

## 3. File Responsibility Map

### Shared Types

- `packages/shared-types/src/operation-event.ts`
  - Defines operator event records.
- `packages/shared-types/src/ad-quantification.ts`
  - Defines daily metrics, product stage, threshold suggestions, rule/AI decision contracts.
- `packages/shared-types/src/recommendation.ts`
  - Extend evidence with AI diagnosis, dynamic thresholds, and decision agreement.

### Local Database

- `packages/local-db/src/sqlite/db.ts`
  - Schema and migrations for operation events, report file manifests, daily ad facts, diagnosis runs.
- `packages/local-db/src/sqlite/repositories/operation-event-repo.ts`
  - CRUD for operator events.
- `packages/local-db/src/sqlite/repositories/ad-metrics-repo.ts`
  - Read daily and aggregated ad metrics by scope.
- `packages/local-db/src/sqlite/repositories/report-file-repo.ts`
  - Track real downloaded report files and import state.
- `packages/local-db/src/sqlite/repositories/ai-diagnosis-repo.ts`
  - Store AI diagnosis outputs without API keys.

### Report Collection and Import

- `packages/lingxing-report-collector/src/batch-runner.ts`
  - Create/download semantics and real file checks.
- `packages/report-parser/src/index.ts`
  - Parse Lingxing XLSX/CSV into normalized daily metrics.
- `scripts/import_lingxing_batch_metrics.py` or TypeScript equivalent
  - Existing import script should be made idempotent and evidence-producing.

### Rules and AI

- `packages/rules-engine/src/quantification.ts`
  - Deterministic KPI/entity classification.
- `packages/rules-engine/src/ad-decision-merger.ts`
  - Compare AI and rule decisions.
- `packages/ai-adapter/src/ad-strategy-diagnosis.ts`
  - DeepSeek/OpenAI-compatible structured diagnosis.
- `packages/ai-adapter/src/ad-action-reason.ts`
  - Existing recommendation explanation; must use USD context and stop using RMB copy.

### Desktop Main Process

- `apps/desktop/src/main/index.ts`
  - IPC for scope, data pipeline, operation events, quantification, AI diagnosis, recommendations, approval/readback.
- `apps/desktop/src/preload/index.ts`
  - Type-safe renderer API exposure.

### Renderer

- `apps/desktop/src/renderer/components/app-shell.tsx`
  - Sidebar and top-level shell.
- `apps/desktop/src/renderer/components/scope-bar.tsx`
  - Global operation scope display/edit.
- `apps/desktop/src/renderer/pages/dashboard-page.tsx`
  - Business cockpit.
- `apps/desktop/src/renderer/pages/data-collection-page.tsx`
  - Real report collection/import only.
- `apps/desktop/src/renderer/pages/ad-quant-page.tsx`
  - Quantitative diagnosis.
- `apps/desktop/src/renderer/pages/operation-events-page.tsx`
  - Operator event timeline/form.
- `apps/desktop/src/renderer/pages/recommendations-page.tsx`
  - AI+rule recommendation list/detail.
- `apps/desktop/src/renderer/pages/approval-page.tsx`
  - Approval queue.
- `apps/desktop/src/renderer/pages/readback-page.tsx`
  - Execution/readback evidence.
- `apps/desktop/src/renderer/pages/keyword-opportunities-page.tsx`
  - Keyword opportunities.
- `apps/desktop/src/renderer/pages/listing-optimization-page.tsx`
  - Listing read and AI draft.
- `apps/desktop/src/renderer/pages/settings-page.tsx`
  - AI, thresholds, storage, safety.
- `apps/desktop/src/renderer/pages/delivery-page.tsx`
  - Final readiness/evidence.

---

## 4. Execution Phases

## Phase 0: Baseline and Guardrails

**Goal:** Establish current truth without repeatedly running full test suites.

**Files:**
- Read: `package.json`
- Read: `apps/desktop/src/main/index.ts`
- Read: `packages/ai-adapter/src/index.ts`
- Read: `packages/rules-engine/src/index.ts`

- [ ] **Step 0.1: Record git state**

Run:

```powershell
git status --short --branch
```

Expected:

```text
Dirty files are known. Do not revert unrelated changes.
```

- [ ] **Step 0.2: Confirm available scripts**

Run:

```powershell
Get-Content -Raw package.json
```

Expected:

```text
Use targeted package tests during development. Full `pnpm -r run typecheck` and final build only at final gate.
```

- [ ] **Step 0.3: Confirm Stitch tool availability**

Use MCP/tool discovery for `stitch`.

Expected:

```text
If Stitch is callable, generate design screens before final UI implementation.
If Stitch is configured but not callable, record blocker and continue with backend/logic slices that do not require Stitch confirmation.
```

---

## Phase 1: Daily Ad Data Warehouse

**Goal:** Make true daily advertising data the foundation of all downstream logic.

**Files:**
- Modify: `packages/local-db/src/sqlite/db.ts`
- Modify: `packages/local-db/src/sqlite/repositories/ad-metrics-repo.ts`
- Create: `packages/local-db/src/sqlite/repositories/report-file-repo.ts`
- Create: `packages/local-db/src/sqlite/repositories/report-file-repo.test.ts`
- Modify: `packages/report-parser/src/index.ts`
- Modify: `packages/lingxing-report-collector/src/batch-runner.ts`
- Modify: `apps/desktop/src/main/index.ts`

### Task 1.1: Track Real Report Files

- [ ] **Step 1.1.1: Write failing test**

Create `packages/local-db/src/sqlite/repositories/report-file-repo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../test-utils';
import { ReportFileRepository } from './report-file-repo';

describe('ReportFileRepository', () => {
  it('tracks only real ad report files as downloadable business files', () => {
    const db = createTestDb();
    const repo = new ReportFileRepository(db);

    repo.upsert({
      batchId: 'batch_1',
      reportType: 'keyword',
      filePath: 'C:/reports/keyword.xlsx',
      fileName: 'keyword.xlsx',
      fileSize: 1200,
      status: 'downloaded',
      importedRows: 10,
    });

    repo.upsert({
      batchId: 'batch_1',
      reportType: 'diagnostic',
      filePath: 'C:/reports/diagnostic.json',
      fileName: 'diagnostic.json',
      fileSize: 200,
      status: 'downloaded',
      importedRows: 0,
    });

    const files = repo.findBusinessReportFiles({ batchId: 'batch_1' });

    expect(files).toHaveLength(1);
    expect(files[0].fileName).toBe('keyword.xlsx');
  });
});
```

- [ ] **Step 1.1.2: Run targeted test and confirm failure**

Run:

```powershell
pnpm exec vitest run packages/local-db/src/sqlite/repositories/report-file-repo.test.ts
```

Expected:

```text
FAIL because ReportFileRepository does not exist.
```

- [ ] **Step 1.1.3: Implement repository and schema**

Add table:

```sql
CREATE TABLE IF NOT EXISTS report_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  report_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  imported_rows INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(batch_id, report_type, file_path)
);
```

Business report file extensions:

```ts
const BUSINESS_REPORT_FILE = /\.(xlsx|xls|csv)$/i;
```

- [ ] **Step 1.1.4: Run targeted test**

Run:

```powershell
pnpm exec vitest run packages/local-db/src/sqlite/repositories/report-file-repo.test.ts
```

Expected:

```text
PASS.
```

### Task 1.2: Idempotent Daily Import

- [ ] **Step 1.2.1: Add import identity**

Daily metrics must have a stable identity:

```text
batch_id + report_type + date + store_name + marketplace_code + campaign_id/name + ad_group_id/name + asin + entity_type + entity_name
```

- [ ] **Step 1.2.2: Prevent duplicate aggregation**

Importing the same file twice must update or skip rows, not double spend/orders.

Test expectation:

```text
Import same keyword file twice -> spend/orders remain unchanged.
```

- [ ] **Step 1.2.3: Keep daily rows**

Do not only store period totals. Store rows by metric date. Aggregation for UI should be computed from daily facts.

- [ ] **Step 1.2.4: Validate with targeted tests**

Run:

```powershell
pnpm exec vitest run packages/local-db/src/sqlite/repositories/ad-metrics-repo.test.ts
pnpm --filter @amazon-ai-ops/report-parser test
```

Expected:

```text
Ad metrics import and parser tests pass.
```

---

## Phase 2: Operator Events

**Goal:** Give the system business context for interpreting ad performance.

**Files:**
- Create/Modify: `packages/shared-types/src/operation-event.ts`
- Create/Modify: `packages/local-db/src/sqlite/repositories/operation-event-repo.ts`
- Create/Modify: `packages/local-db/src/sqlite/repositories/operation-event-repo.test.ts`
- Modify: `packages/local-db/src/sqlite/db.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Create/Modify: `apps/desktop/src/renderer/pages/operation-events-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/ad-quant-page.tsx`

### Task 2.1: Event Types

Supported events:

```ts
export type OperationEventType =
  | 'coupon'
  | 'promotion'
  | 'bd'
  | 'ld'
  | 'price_change'
  | 'listing_change'
  | 'inventory'
  | 'review_change'
  | 'external_traffic'
  | 'note';
```

### Task 2.2: Event Fields

Required fields:

```ts
export interface OperationEvent {
  id: string;
  eventDate: string;
  eventType: OperationEventType;
  storeName: string;
  marketplaceCode: string;
  asin?: string;
  campaignName?: string;
  title: string;
  impactExpectation?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
```

### Task 2.3: UI Behavior

The `运营事件` page must support:

```text
Add event
Edit event
Delete event
Filter by current scope
Show timeline next to ad quantification
```

### Task 2.4: Validation

Run:

```powershell
pnpm exec vitest run packages/local-db/src/sqlite/repositories/operation-event-repo.test.ts
pnpm --filter @amazon-ai-ops/local-db run typecheck
pnpm --filter @amazon-ai-ops/desktop run typecheck
```

Expected:

```text
Targeted event tests and package typecheck pass.
```

---

## Phase 3: AI + Rules Parallel Diagnosis

**Goal:** AI and rules both analyze the same data. Final output shows where they agree, disagree, or require manual review.

**Files:**
- Create: `packages/ai-adapter/src/ad-strategy-diagnosis.ts`
- Create: `packages/ai-adapter/src/ad-strategy-diagnosis.test.ts`
- Modify: `packages/ai-adapter/src/index.ts`
- Modify: `packages/ai-adapter/src/ad-action-reason.ts`
- Create: `packages/rules-engine/src/quantification.ts`
- Create: `packages/rules-engine/src/quantification.test.ts`
- Create: `packages/rules-engine/src/ad-decision-merger.ts`
- Create: `packages/rules-engine/src/ad-decision-merger.test.ts`
- Modify: `packages/rules-engine/src/index.ts`
- Modify: `apps/desktop/src/main/index.ts`

### Task 3.1: AI Strategy Diagnosis

- [ ] **Step 3.1.1: Define AI output contract**

Create:

```ts
export type AdLifecycleStage =
  | 'cold_start'
  | 'keyword_exploration'
  | 'stable_conversion'
  | 'scaling'
  | 'profit_harvesting'
  | 'clearance'
  | 'declining_repair'
  | 'unknown';

export interface AdStrategyDiagnosisOutput {
  lifecycleStage: AdLifecycleStage;
  summary: string;
  mainProblems: string[];
  thresholdSuggestions: {
    targetAcos: { value: number; reason: string };
    highAcosThreshold: { value: number; reason: string };
    noOrderClickThreshold: { value: number; reason: string };
    minSpend: { value: number; reason: string };
  };
  aiCandidates: Array<{
    entityType: string;
    entityName: string;
    actionType: string;
    recommendedValue?: string;
    reason: string;
    confidence: number;
  }>;
  riskWarnings: string[];
  source: 'ai' | 'rule';
  aiFallbackReason?: string;
}
```

- [ ] **Step 3.1.2: Prompt requirements**

Prompt must include:

```text
Currency: USD
Scope: date/store/site/ASIN/batch
Daily metrics sample
Aggregated metrics
Operator events
Current rule thresholds
Rule candidates
Instruction: output strict JSON only
Instruction: do not execute ads
```

Prompt must not contain:

```text
¥
RMB
人民币
```

- [ ] **Step 3.1.3: Failure fallback**

If API fails or JSON parse fails:

```ts
{
  lifecycleStage: 'unknown',
  summary: 'AI diagnosis unavailable; using deterministic rules only.',
  mainProblems: [],
  thresholdSuggestions: currentRuleConfig,
  aiCandidates: [],
  riskWarnings: ['AI unavailable'],
  source: 'rule',
  aiFallbackReason: error.message
}
```

- [ ] **Step 3.1.4: Validation**

Run:

```powershell
pnpm exec vitest run packages/ai-adapter/src/ad-strategy-diagnosis.test.ts
pnpm --filter @amazon-ai-ops/ai-adapter run typecheck
```

Expected:

```text
AI diagnosis test passes; prompt uses USD and operation event context.
```

### Task 3.2: Rules Quantification

Rules must classify each entity:

```text
healthy
watch
waste
scale
blocked
```

Minimum deterministic signals:

```text
high ACOS with orders -> lower bid or review profitability
spend above threshold with zero orders -> pause/lower bid/add negative
good CVR and low ACOS -> scale
many clicks no orders -> query relevance/listing issue
low impressions on core target -> increase bid/budget only if stage supports it
```

Validation:

```powershell
pnpm exec vitest run packages/rules-engine/src/quantification.test.ts
pnpm --filter @amazon-ai-ops/rules-engine run typecheck
```

### Task 3.3: Decision Merger

Merge policy:

```text
rule + ai same entity/action -> aligned, confidence up, can enter approval queue
rule says risky and ai says aggressive scale -> conflict, manual review required
ai-only candidate -> insight only unless operator approves and rule policy allows
rule-only candidate -> allowed but flagged as no AI confirmation
```

Output:

```ts
export type DecisionAgreement = 'aligned' | 'rule_only' | 'ai_only' | 'conflict';
```

Validation:

```powershell
pnpm exec vitest run packages/rules-engine/src/ad-decision-merger.test.ts
```

Expected:

```text
Aligned/conflict/ai_only/rule_only cases pass.
```

---

## Phase 4: Recommendation Pipeline Integration

**Goal:** Recommendations are generated from real metrics, enriched by AI diagnosis, and explain thresholds.

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `packages/local-db/src/sqlite/repositories/recommendation-repo.ts`
- Modify: `packages/shared-types/src/recommendation.ts`
- Modify: `apps/desktop/src/renderer/pages/recommendations-page.tsx`

### Task 4.1: Input Gate

Before generating recommendations, require:

```text
At least one real report file exists for current scope.
Imported ad metric rows > 0.
Current scope is explicit: dateFrom/dateTo/store/site/currency.
```

Blocked message:

```text
当前范围缺少真实报表文件或导入后的广告指标，不能生成优化建议。请先完成数据采集和导入。
```

### Task 4.2: Generate Flow

Pipeline:

```text
Load daily metrics
Load operator events
Run rules quantification
Run AI strategy diagnosis if configured
Merge rule/AI decisions
Persist recommendations with evidence
Return summary to renderer
```

### Task 4.3: Recommendation Evidence

Each recommendation should include:

```text
source report files
date range
batch id
portfolio
campaign
ad group
product / ASIN
keyword/search term/target
current metric value
recommended action/value
rule reason
AI reason or fallback reason
dynamic threshold used
decision agreement
operator events count
```

### Task 4.4: Validation

Run:

```powershell
pnpm --filter @amazon-ai-ops/desktop run typecheck
pnpm exec vitest run packages/local-db/src/sqlite/repositories/recommendation-repo.test.ts
```

Expected:

```text
Recommendations cannot be created from empty or audit-only data.
```

---

## Phase 5: UI Redesign Implementation

**Goal:** Make the app usable by an operator who does not know the internals.

**Files:**
- Modify: `apps/desktop/src/renderer/components/app-shell.tsx`
- Modify: `apps/desktop/src/renderer/components/scope-bar.tsx`
- Modify: `apps/desktop/src/renderer/pages/*.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

### Task 5.1: Shell

Sidebar groups:

```text
运营总览
数据与量化
广告决策
关键词与 Listing
系统与交付
```

Remove:

```text
v1.5 工作台
one-page all-in-one workflow
raw command wall as primary content
```

### Task 5.2: Global Scope Bar

Scope bar copy:

```text
当前运营范围
日期: 2026-06-01 至 2026-06-12
店铺: FT-US-US
站点: US
币种: USD
数据批次: 已验证批次 / 最新完整批次 / 未选择
```

Scope bar explanation:

```text
这个范围会影响数据采集、广告量化、优化建议、关键词机会和 Listing 分析。
```

### Task 5.3: Page Contract

Every business page must have:

```text
Page title
One-sentence purpose
Current scope summary
Primary task card
Next action card
Missing prerequisite message
Primary action button
Evidence/result area
Collapsed technical details only when needed
```

### Task 5.4: Visual Rules

Use:

```text
restrained B2B console
consistent spacing
clear page hierarchy
tables for operational data
small status pills
USD formatting
no oversized decorative cards
no single-color purple/blue palette
```

Avoid:

```text
audit details mixed with main workflow
buttons with identical meaning
technical path dumps as first-level content
RMB symbols
```

### Task 5.5: Validation

Run after each edited page group:

```powershell
pnpm --filter @amazon-ai-ops/desktop run typecheck
pnpm --filter @amazon-ai-ops/desktop run build:renderer
```

Run smoke only for changed pages:

```powershell
node scripts/smoke-business-ui-data-pipeline.js
node scripts/smoke-business-ui-ad-execution.js
node scripts/smoke-business-ui-keyword-listing.js
```

---

## Phase 6: Data Collection Correctness

**Goal:** Fix the observed bug where UI reports downloaded/ready but local folder contains only audit JSON/HTML/PNG files.

**Files:**
- Modify: `packages/lingxing-report-collector/src/batch-runner.ts`
- Modify: `apps/desktop/src/main/business-report-files.ts`
- Modify: `apps/desktop/src/renderer/pages/data-collection-page.tsx`
- Create/Modify: `scripts/smoke-business-report-file-filter.js`

### Task 6.1: Business File Filter

Only these count as real report files:

```text
.xlsx
.xls
.csv
```

These do not count:

```text
.json
.md
.html
.png
.txt
diagnostic evidence files
manifest files
audit files
```

### Task 6.2: Button Semantics

Buttons must not look or behave identically:

```text
下载已创建的已选报表
  Reuses existing ready rows in Lingxing download center.
  Does not create new reports.

重新创建并下载已选报表
  Creates new Lingxing report tasks.
  Waits for ready state.
  Downloads files.

下载已创建的全部 8 类
  Reuses existing ready rows for all report types in current scope.
```

### Task 6.3: Empty Real File State

If only audit files exist:

```text
当前文件夹只有诊断/验收文件，没有真实广告报表 XLSX/CSV。不能进入广告量化。
```

### Task 6.4: Validation

Run:

```powershell
node scripts/smoke-business-report-file-filter.js
pnpm --filter @amazon-ai-ops/desktop run typecheck
```

Expected:

```text
Audit files no longer cause false downloaded/imported state.
```

---

## Phase 7: Approval and Execution Safety

**Goal:** Support many products/campaigns/ad groups while keeping execution controlled.

**Files:**
- Modify: `apps/desktop/src/renderer/pages/approval-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/readback-page.tsx`
- Modify: `apps/desktop/src/main/ad-readback-evidence.ts`
- Modify: `packages/action-executor/src/index.ts`

### Task 7.1: Approval Scope

Approval must include:

```text
store
marketplace
portfolio
campaign
ad group
ASIN/product
entity type
entity name
action type
approved current value
approved recommended value
approver
approval time
evidence path
```

### Task 7.2: Execution Is Per Target

No implementation should assume one paused ad or one product.

Allowed target identity:

```text
store/site/campaign/ad_group/entity_type/entity_name/action_type
```

### Task 7.3: Readback Required Fields

Before a real action can be marked verified:

```text
before live value
before screenshot
execution time
operator
after live value
after screenshot
readback actual value
readback evidence path
```

### Task 7.4: Validation

Run:

```powershell
pnpm exec vitest run apps/desktop/src/main/ad-readback-evidence.test.ts
pnpm --filter @amazon-ai-ops/desktop run typecheck
```

Expected:

```text
Readback evidence validates generic targets, not only a single sample ad.
```

---

## Phase 8: Keyword and Listing Business Flow

**Goal:** Keyword and Listing pages use the same real data foundation and AI/rule source labeling.

**Files:**
- Modify: `apps/desktop/src/renderer/pages/keyword-opportunities-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/listing-optimization-page.tsx`
- Modify: `packages/keyword-opportunity/src/index.ts`
- Modify: `packages/listing-analyzer/src/index.ts`
- Modify: `apps/desktop/src/main/listing-lingxing-extractor.ts`

### Task 8.1: Keyword Opportunity Identity

Rows must preserve:

```text
store
site
ASIN
portfolio
campaign
ad group
keyword/search term/target
spend
sales
orders
clicks
coverage
opportunity reason
```

### Task 8.2: Listing Draft Source

Listing suggestions must label:

```text
source = ai
source = rule
source = fallback
```

Drafts must never imply Amazon submit. They are local drafts only.

### Task 8.3: Validation

Run:

```powershell
pnpm --filter @amazon-ai-ops/keyword-opportunity test
pnpm --filter @amazon-ai-ops/listing-analyzer test
pnpm --filter @amazon-ai-ops/desktop run typecheck
```

---

## Phase 9: Settings, AI Status, and Threshold Configuration

**Goal:** Make AI and thresholds understandable and persistent.

**Files:**
- Modify: `apps/desktop/src/renderer/pages/settings-page.tsx`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `packages/ai-adapter/src/openai-compatible.ts`
- Modify: `packages/rules-engine/src/*`

### Task 9.1: AI Status Persistence

Statuses:

```text
未配置
待测试
测试中
可用
失败
```

After a successful test, switching pages must not reset the display to `待测试` unless settings changed.

### Task 9.2: Threshold Configuration

Editable fields:

```text
target ACOS
high ACOS threshold
no-order click threshold
min spend
bid adjust percentage
max decrement percentage
core keyword whitelist
brand keyword whitelist
```

### Task 9.3: AI Model Defaults

Default:

```text
baseURL: https://api.deepseek.com
model: deepseek-chat unless user explicitly changes it
temperature: 0.2 or 0.3 for diagnosis
```

No final artifact may store or expose the real API key.

### Task 9.4: Validation

Run:

```powershell
pnpm --filter @amazon-ai-ops/ai-adapter test
pnpm --filter @amazon-ai-ops/desktop run typecheck
node scripts/verify-ai-settings-ux.js
```

---

## Phase 10: Real Evidence Run

**Goal:** Prove the system works with real Lingxing data, not mock/audit files.

### Task 10.1: Login Correctly

Required flow:

```text
Open app login
Login Lingxing ERP
Enter Ads/download center from logged-in ERP context
Do not open Ads directly before login
```

### Task 10.2: Download Reports

For selected scope:

```text
dateFrom/dateTo/store/site
```

Download:

```text
广告活动报告
广告组报告
广告位报告
广告推广商品报告
自动投放报告
关键词报告
商品投放报告
用户搜索词报告
```

### Task 10.3: Evidence Must Include

```text
Original XLSX/CSV files
Local file paths
Manifest
DB aggregation totals
App screenshot
Exported acceptance audit
AI diagnosis evidence with redacted key
```

### Task 10.4: DB Check

Run:

```powershell
@'
import sqlite3, json
path = r'C:\Users\wz\AmazonAIOps\app-data\amazon-ai-ops.db'
conn = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
cur = conn.cursor()
rows = cur.execute("""
SELECT batch_id, report_type, COUNT(*) rows, ROUND(SUM(cost), 2) spend, SUM(orders) orders
FROM ad_daily_metrics
GROUP BY batch_id, report_type
ORDER BY batch_id DESC, report_type
LIMIT 50
""").fetchall()
print(json.dumps(rows, ensure_ascii=False, indent=2))
conn.close()
'@ | python -
```

Expected:

```text
Selected batch has real rows, realistic spend, and order totals.
```

---

## Phase 11: Final Validation and Build

**Goal:** Produce the no-install Windows executable only after final evidence is coherent.

### Task 11.1: Full Typecheck

Run once near final gate:

```powershell
pnpm -r run typecheck
```

### Task 11.2: Full Tests

Run once near final gate:

```powershell
pnpm test
```

If the project later restores `scripts/run-tests.js`, use that final runner instead.

### Task 11.3: Renderer Smoke

Run only final smoke suite after UI stabilizes:

```powershell
node scripts/smoke-business-ui-shell.js
node scripts/smoke-business-ui-data-pipeline.js
node scripts/smoke-business-ui-ad-execution.js
node scripts/smoke-business-ui-keyword-listing.js
node scripts/smoke-business-ui-settings-delivery.js
```

### Task 11.4: Build No-Install EXE

Run:

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:win
```

### Task 11.5: Hash

Run:

```powershell
Get-FileHash apps/desktop/release/AmazonAIOpsAgent-1.5.0.exe -Algorithm SHA256
```

### Task 11.6: Final Delivery Report

Report must include:

```text
EXE path
SHA-256
Real report file paths
DB aggregation totals
AI diagnosis status
UI screenshots
Known limitations
Whether APP_READY is true or still blocked
```

---

## 5. Incremental Test Policy

During development:

```text
Run only tests for the touched package/file.
Run desktop typecheck after renderer/main IPC changes.
Run renderer build after visual structure changes.
Do not run full repo test repeatedly.
```

Final gate only:

```text
pnpm -r run typecheck
pnpm test
pnpm --filter @amazon-ai-ops/desktop run build:win
```

---

## 6. Acceptance Criteria

The project is acceptable only when:

```text
1. Real Lingxing report files exist locally as XLSX/XLS/CSV.
2. Audit JSON/HTML/PNG files do not count as downloaded reports.
3. Imported daily ad metrics exist in SQLite and are idempotent.
4. Dashboard, data collection, quantification, recommendations, approval, readback, keyword, Listing, settings, and delivery are separate pages.
5. Currency is USD for US marketplace.
6. Operator events can be recorded and are visible to quantification/AI.
7. Rules and AI run in parallel for ad diagnosis.
8. AI suggests product stage and quantitative thresholds, not just text explanations.
9. Recommendations show campaign/ad group/product/keyword or target context.
10. Approval and readback support multiple products/campaigns/ad groups, not one hardcoded paused ad.
11. No live ad action can execute without approval, screenshots, before/after values, and readback evidence.
12. Final build produces a no-install EXE with hash and evidence report.
```

---

## 7. Known Current Risks

```text
1. Stitch MCP is configured but may not be callable in the current tool session.
2. Lingxing selector/page model cannot be guessed; real logged-in verification is required.
3. Previous UI may report 8/8 downloaded while only audit files exist. This must be treated as a blocker.
4. AI settings status currently appears to reset to 待测试 after navigation; status persistence must be fixed.
5. Existing recommendation generation may still be rules-first with AI explanation bolted on. It must become rules + AI parallel diagnosis.
6. Some existing prompts may still use RMB/¥. All US-scope ad analysis must use USD.
```

---

## 8. Recommended Execution Order

1. Phase 1: real file tracking and daily import correctness.
2. Phase 2: operator events.
3. Phase 3: AI strategy diagnosis and rule/AI merger.
4. Phase 4: recommendation pipeline integration.
5. Phase 6: data collection false-positive fix.
6. Phase 5: full UI responsibility split and visual cleanup.
7. Phase 8: keyword and Listing refinements.
8. Phase 9: settings/AI status persistence.
9. Phase 10: real Lingxing evidence run.
10. Phase 11: final validation and no-install EXE.

This order prioritizes the data foundation before visual polish, because the app cannot be a real operations system until it can prove it has real daily ad data.

