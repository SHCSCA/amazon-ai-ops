# Amazon AI Ops Integrated Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Amazon AI Ops 从“证据和按钮堆叠的工具”收尾成真实业务可用的广告运营后台：先拿到真实领星广告数据，沉淀每日数据库，再用规则 + AI 并行完成量化、诊断、建议、审批、执行、回读和交付验收。

**Architecture:** 以“全局工作范围 + 数据资产 + AI/规则决策 + 人工审批 + 安全执行 + 证据交付”为主线。UI 按业务职责拆页，后台以本地 SQLite 为每日数据事实表，DeepSeek/OpenAI Compatible 作为策略分析层，规则引擎作为确定性量化和安全边界。

**Tech Stack:** Electron, React, TypeScript, SQLite, Playwright/Chromium, Lingxing report collector, report parser, local-db repositories, rules-engine, ai-adapter, action-executor, Node smoke tests, Windows portable/unpacked exe.

---

## 0. 当前问题归纳

### 0.1 产品体验问题

- 仪表盘过于简单，只显示几个 0 值 KPI，用户不知道当前系统是否有数据、下一步该做什么。
- 原 v1.5 工作台把采集、审计、AI、Listing、执行等任务塞进一个菜单页，职责混乱。
- 页面里过多暴露审计、manifest、readback、命令行、状态枚举，运营用户无法判断重点。
- 全局工作范围概念不清晰，用户不知道日期、店铺、站点、币种、批次在哪里设置，以及批次影响哪些页面。
- 采集页按钮语义重复，例如“下载已创建”“重新创建并下载”“创建并下载”之间差异不够直观。
- 导出结果只看到审计包时，用户误以为真实广告表格没有下载；真实报表文件和审计证据没有明确分层。
- AI 设置保存后状态回到“待测试”，测试通过状态没有持久化，用户认为 AI 没有接入。
- 生成优化建议时即使 AI 可用，页面只显示“生成 0 条”，没有解释规则候选、AI 候选、被过滤原因。
- 控制台界面视觉粗糙，没有贯彻 Stitch/设计稿的后台信息架构。

### 0.2 业务逻辑问题

- 核心不是“导出审计”，而是从广告第一天开始拉取时间段报表，形成每日广告数据库。
- 后续建议必须基于每日广告表现、产品所处推广阶段、库存/价格/活动/折扣/BD/大促等运营上下文。
- AI 应与规则并行：规则负责确定性阈值、风险边界、可执行字段；AI 负责阶段判断、归因解释、阈值建议和策略候选。
- 量化阈值不应固定，例如 ACOS 50%，应按产品阶段、毛利、目标、预算、活动、历史曲线给出建议。
- 广告建议必须能适配多产品、多广告组合、多 campaign、多 ad group、多 keyword/search term/target，不能只绑定一个样例。
- 广告执行不能做批量自动写入；每个动作要有范围、审批、截图、before/after、回读验证和风险策略。
- Listing 优化应读取领星 Listing 真实详情，再由 AI 生成草案，不能只做关键词覆盖表。

### 0.3 数据链路问题

- 真实下载文件必须是 `.xlsx/.xls/.csv`，JSON/PNG/HTML/manifest 只能算证据。
- 当前已发现本机用户目录存在真实下载 batch，但 UI 对“真实表格已下载”“已导入数据库”“审计包已导出”区分不够明确。
- 需要按 `date + store + marketplace + batch_id + report_type + grain` 沉淀每日指标，避免 campaign/ad_group/placement/search_term 多粒度重复相加。
- 需要可重复的数据诊断脚本，证明：
  - 真实文件存在。
  - 8 类报表覆盖。
  - 文件已导入 DB。
  - DB 汇总口径正确。
  - UI 显示与 DB 一致。

---

## 1. 目标交付标准

### 1.1 用户可用标准

- 用户进入应用后，第一屏能看懂：
  - 当前工作范围是什么。
  - 是否已有真实数据。
  - 今天应该先做哪件事。
  - 哪些动作可做，哪些动作被阻断，阻断原因是什么。
- 数据采集页能明确分离：
  - 创建领星报表任务。
  - 下载真实表格。
  - 导入数据库。
  - 导出审计证据。
- 广告运营链路能按顺序完成：
  1. 选择工作范围。
  2. 获取真实报表。
  3. 导入每日广告数据库。
  4. 填写运营事件。
  5. 规则 + AI 并行分析。
  6. 生成量化建议。
  7. 审批低风险动作。
  8. 人工在 Ads UI 执行或受控执行。
  9. 回读验证。
  10. 形成交付包。

### 1.2 技术验收标准

- 所有真实广告数据必须来自 Lingxing 下载表格或用户导入表格。
- 不允许用 audit JSON 伪装广告报表。
- 所有金额默认 USD；UI 不再出现人民币符号。
- AI Key 不写入导出交付包。
- AI 测试状态必须持久化并可解释。
- 生成建议时必须展示规则候选、AI 候选、最终可审批动作、过滤原因。
- 批次选择必须有清晰语义：自动使用当前范围最新完整批次，或手动指定批次并显示待校验状态。
- 最终阶段才跑全量测试；开发中只跑增量测试。

---

## 2. 信息架构重构

### 2.1 侧边栏菜单

目标：不要再有“v1.5 工作台”内嵌全部任务。侧边栏应按真实业务职责拆分。

推荐结构：

```text
运营总览
  - 仪表盘

数据与量化
  - 工作范围
  - 数据采集
  - 数据导入与校验
  - 运营事件
  - 产品配置
  - 广告量化

广告执行
  - 优化建议
  - 审批中心
  - 执行回读

关键词与 Listing
  - 关键词机会
  - Listing 优化

系统与交付
  - 交付验收
  - 定时任务
  - 设置
```

### 2.2 页面职责

| 页面 | 用户目标 | 不能再承担的内容 |
| --- | --- | --- |
| 仪表盘 | 看当前状态、今日待办、核心 KPI、风险和下一步 | 不放大量审计命令 |
| 工作范围 | 设置日期、店铺、站点、币种、批次策略 | 不做下载、不做 AI |
| 数据采集 | 创建/下载领星 8 类报表 | 不展示 AI 结论 |
| 数据导入与校验 | 把真实表格导入 DB，展示文件和行数 | 不混合广告执行审计 |
| 广告量化 | 展示规则阈值、AI 阈值建议、阶段判断 | 不执行广告动作 |
| 优化建议 | 生成、解释、筛选建议 | 不做真实写入 |
| 审批中心 | 人工审批具体动作范围 | 不生成建议 |
| 执行回读 | 记录 before/after/readback | 不展示宽泛采集状态 |
| 关键词机会 | 从真实广告数据和 Listing 数据找机会 | 不显示 source 主列 |
| Listing 优化 | 读取 Listing、AI 草案、导出草稿 | 不提交 Amazon Listing |
| 运营事件 | 填写活动、折扣、BD、大促、缺货、改价 | 不做分析结论 |
| 交付验收 | 只汇总最终证据闭环 | 不承载日常运营 |
| 设置 | AI、路径、安全策略 | 不显示业务报表 |

---

## 3. 文件结构与职责

### 3.1 Renderer UI

- Modify: `apps/desktop/src/renderer/components/app-shell.tsx`
  - 侧边栏分组、页面路由、顶部状态。
- Modify: `apps/desktop/src/renderer/components/scope-bar.tsx`
  - 全局工作范围显示与快速编辑入口。
- Modify: `apps/desktop/src/renderer/components/business-data.tsx`
  - 统一展示真实文件、导入行数、批次健康度。
- Modify: `apps/desktop/src/renderer/styles.css`
  - 全局后台视觉系统、表格、状态、按钮、信息密度。
- Modify: `apps/desktop/src/renderer/pages/dashboard-page.tsx`
  - 首页改造成运营总览。
- Modify: `apps/desktop/src/renderer/pages/data-collection-page.tsx`
  - 只负责领星创建/下载真实报表。
- Create: `apps/desktop/src/renderer/pages/data-import-validation-page.tsx`
  - 新增数据导入与校验页。
- Modify: `apps/desktop/src/renderer/pages/ad-quant-page.tsx`
  - 承载广告阶段、规则阈值、AI 阈值建议。
- Modify: `apps/desktop/src/renderer/pages/recommendations-page.tsx`
  - 展示规则候选、AI 候选、最终建议、过滤原因。
- Modify: `apps/desktop/src/renderer/pages/approval-page.tsx`
  - 审批动作范围和风险。
- Modify: `apps/desktop/src/renderer/pages/readback-page.tsx`
  - 执行回读与证据。
- Modify: `apps/desktop/src/renderer/pages/keyword-opportunities-page.tsx`
  - 关键词机会按广告上下文拆行或可展开。
- Modify: `apps/desktop/src/renderer/pages/listing-optimization-page.tsx`
  - Listing 读取、AI 草案、导出。
- Modify: `apps/desktop/src/renderer/pages/operation-events-page.tsx`
  - 运营事件录入。
- Modify: `apps/desktop/src/renderer/pages/settings-page.tsx`
  - AI 设置持久化和测试状态。
- Modify: `apps/desktop/src/renderer/formatters.ts`
  - USD 金额、百分比、整数统一格式。

### 3.2 Main / IPC

- Modify: `apps/desktop/src/main/index.ts`
  - 新增或整理 IPC：范围、采集、导入、AI 测试、量化、建议、事件、证据。
- Modify: `apps/desktop/src/preload/index.ts`
  - 暴露 renderer 所需 API。
- Modify: `apps/desktop/src/main/business-report-files.ts`
  - 真实文件识别，不把 audit/manifest 当报表。
- Modify: `apps/desktop/src/main/ad-recommendation-ai-context.ts`
  - 给 AI 提供广告阶段、运营事件、每日趋势和候选上下文。

### 3.3 Data / Parser

- Modify: `packages/report-parser/src/parser.ts`
  - 8 类报表字段归一化。
- Modify: `packages/report-parser/src/parser-lingxing-ad-reports.test.ts`
  - 覆盖真实列名和 USD 口径。
- Modify: `packages/local-db/src/sqlite/db.ts`
  - migration：每日指标、运营事件、AI 测试状态、批次文件索引。
- Modify: `packages/local-db/src/sqlite/repositories/ad-metrics-repo.ts`
  - 查询按 grain/report_type 防重复聚合。
- Modify: `packages/local-db/src/sqlite/repositories/report-file-repo.ts`
  - 真实报表文件状态。
- Modify: `packages/local-db/src/sqlite/repositories/operation-event-repo.ts`
  - 运营事件 CRUD。

### 3.4 AI / Rules

- Modify: `packages/ai-adapter/src/openai-compatible.ts`
  - DeepSeek/OpenAI Compatible 调用和错误分类。
- Modify: `packages/ai-adapter/src/ad-strategy-diagnosis.ts`
  - 阶段诊断、阈值建议、异常归因。
- Modify: `packages/ai-adapter/src/ad-action-reason.ts`
  - 具体建议解释。
- Modify: `packages/rules-engine/src/quantification.ts`
  - 规则阈值量化。
- Modify: `packages/rules-engine/src/ad-decision-merger.ts`
  - 合并 AI 候选与规则候选。
- Modify: `packages/rules-engine/src/risk-evaluator.ts`
  - 执行安全边界。

### 3.5 Scripts / Evidence

- Create: `scripts/diagnose-real-ad-data-chain.js`
  - 一键诊断真实文件、DB 导入、口径和 UI 可用性。
- Modify: `scripts/reconcile-lingxing-full8-data.js`
  - 支持当前 DB schema 和旧 schema，不因列名差异崩溃。
- Modify: `scripts/smoke-business-ui-shell.js`
  - 验证菜单拆分和主导航。
- Modify: `scripts/smoke-business-ui-data-pipeline.js`
  - 验证采集/导入语义。
- Modify: `scripts/smoke-business-ui-ad-execution.js`
  - 验证建议、审批、执行回读页面。

---

## 4. 分阶段执行计划

## Phase A: 统一工作范围与后台信息架构

### Task A1: 移除“v1.5 工作台”式内嵌总控，改为分组侧边栏

**Files:**
- Modify: `apps/desktop/src/renderer/components/app-shell.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Test: `scripts/smoke-business-ui-shell.js`

- [x] Step 1: 定义菜单分组数据结构。

```ts
type NavGroup = {
  title: string;
  items: Array<{
    id: string;
    label: string;
    page: PageId;
    badge?: 'blocked' | 'needsWork' | 'ready';
  }>;
};
```

- [x] Step 2: 把侧边栏调整为业务分组。

```ts
const navGroups: NavGroup[] = [
  { title: '运营总览', items: [{ id: 'dashboard', label: '仪表盘', page: 'dashboard' }] },
  { title: '数据与量化', items: [
    { id: 'scope', label: '工作范围', page: 'scope' },
    { id: 'collection', label: '数据采集', page: 'dataCollection' },
    { id: 'import', label: '数据导入与校验', page: 'dataImportValidation' },
    { id: 'events', label: '运营事件', page: 'operationEvents' },
    { id: 'products', label: '产品配置', page: 'productConfig' },
    { id: 'adQuant', label: '广告量化', page: 'adQuant' },
  ] },
  { title: '广告执行', items: [
    { id: 'recommendations', label: '优化建议', page: 'recommendations' },
    { id: 'approval', label: '审批中心', page: 'approval' },
    { id: 'readback', label: '执行回读', page: 'readback' },
  ] },
  { title: '关键词与 Listing', items: [
    { id: 'keywords', label: '关键词机会', page: 'keywordOpportunities' },
    { id: 'listing', label: 'Listing 优化', page: 'listingOptimization' },
  ] },
  { title: '系统与交付', items: [
    { id: 'delivery', label: '交付验收', page: 'delivery' },
    { id: 'scheduler', label: '定时任务', page: 'scheduler' },
    { id: 'settings', label: '设置', page: 'settings' },
  ] },
];
```

- [x] Step 3: 删除 UI 中“v1.5 工作台”作为主页面的概念，保留版本号只在顶部小标签显示。

- [x] Step 4: 更新 smoke 断言。

```js
assertText(pageText, '运营总览');
assertText(pageText, '数据与量化');
assertText(pageText, '广告执行');
assertText(pageText, '关键词与 Listing');
assertText(pageText, '系统与交付');
assertNotText(pageText, 'v1.5 关键词与 Listing 工作台');
```

- [x] Step 5: 运行增量验证。

```powershell
node --check scripts\smoke-business-ui-shell.js
pnpm --filter @amazon-ai-ops/desktop run build:renderer
node scripts\smoke-business-ui-shell.js
```

Expected:

```text
business ui shell smoke passed
```

2026-06-16 navigation refinement:

- `apps/desktop/src/renderer/components/app-shell.tsx` now matches the design IA: `数据与量化` contains scope, collection, import validation, operation events, product config, and ad quantification; `广告执行` contains recommendations, approval, and readback; `系统与交付` contains delivery, scheduler, and settings.
- `data-import-validation-page.tsx`, `operation-scope-page.tsx`, and `product-config-page.tsx` use the same `数据与量化` page eyebrow.
- `scripts/smoke-business-ui-shell.js` and the legacy `smoke-v15-product-readiness-ui.js` were updated away from old `数据资产` / `广告运营` / `交付与系统` labels.
- Verification: `node --check scripts\smoke-business-ui-shell.js`, `node --check scripts\smoke-v15-product-readiness-ui.js`, `pnpm --filter @amazon-ai-ops/desktop run build:renderer`, `node scripts\smoke-business-ui-shell.js`, and `node scripts\smoke-business-ui-data-pipeline.js` passed.

### Task A2: 重构全局工作范围为可理解的“当前操作范围”

**Files:**
- Modify: `apps/desktop/src/renderer/components/scope-bar.tsx`
- Modify: `apps/desktop/src/renderer/scope-store.ts`
- Modify: `apps/desktop/src/renderer/formatters.ts`
- Test: `scripts/smoke-business-ui-shell.js`

- [x] Step 1: 范围显示改为一句业务话术。

```text
当前操作范围：2026-06-01 至 2026-06-12 · FT-US-US · US · USD
数据批次：自动使用当前范围最新完整批次
```

- [x] Step 2: 批次策略只保留两种用户能懂的模式。

```ts
type BatchMode = 'autoLatestComplete' | 'manualBatch';
```

- [x] Step 3: 手动批次未匹配时显示风险说明。

```text
手动批次待校验：后续页面会按该 batch_id 尝试读取；如不确定，请切回自动。
```

- [x] Step 4: 强制币种默认 USD。

```ts
export function formatMoney(value: number | null | undefined, currency = 'USD') {
  if (typeof value !== 'number' || Number.isNaN(value)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
```

- [x] Step 5: 运行增量验证。

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:renderer
node scripts\smoke-business-ui-shell.js
```

Expected:

```text
页面不再出现 ¥；范围文案包含 USD 和批次策略说明。
```

2026-06-16 A2 verification:

- `ScopeBar` shows `当前操作范围` as a single business sentence with date range, store, site, and `USD`.
- Batch selection is operator-readable: automatic latest complete batch, selected verified batch, or manual batch ID.
- Manual unmatched batch IDs show `手动批次待校验` and explain that downstream pages will try that ID and the operator should switch back to auto when unsure.
- `scope-store.ts` and `ScopeBar` force `currency: 'USD'`; `formatters.ts` uses `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`.
- Verification: `pnpm --filter @amazon-ai-ops/desktop run build:renderer`, `node scripts\smoke-business-ui-shell.js`, and `node scripts\smoke-business-ui-data-pipeline.js` passed in the 2026-06-16 navigation/data-flow increment.

## Phase B: 真实数据链路闭环

### Task B1: 数据采集页只负责真实领星报表创建与下载

**Files:**
- Modify: `apps/desktop/src/renderer/pages/data-collection-page.tsx`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `packages/lingxing-report-collector/src/batch-runner.ts`
- Test: `scripts/smoke-business-ui-data-pipeline.js`

- [x] Step 1: 将按钮重命名为明确动作。

```text
验证领星页面
创建报表任务
下载已生成报表
重新创建并下载
```

- [x] Step 2: 按钮解释规则。

```text
创建报表任务：在领星下载中心创建当前范围的 8 类报表。
下载已生成报表：只下载当前范围已处于 ready 的报表，不重复创建。
重新创建并下载：重新创建当前勾选的报表，再下载生成结果。
```

- [x] Step 3: 真实文件判定只接受表格。

```ts
const realReportExtensions = new Set(['.xlsx', '.xls', '.csv']);
const evidenceExtensions = new Set(['.json', '.png', '.html', '.md']);
```

- [x] Step 4: 下载完成但未导入时显示 warning，而不是 success。

```text
真实表格已下载，但尚未导入广告数据库。下一步：进入“数据导入与校验”。
```

- [x] Step 5: 运行增量验证。

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:renderer
node scripts\smoke-business-ui-data-pipeline.js
```

Expected:

```text
采集页不会把审计包误报为真实报表；下载和导入状态分开显示。
```

2026-06-16 B1 verification:

- `数据采集` page now separates `下载并导入已创建`, `重新创建、下载并导入已选报表`, `重新创建、下载并导入全部 8 类`, `导入已下载表格`, and `导入本地报表`.
- Real report availability is counted only from `.xlsx`, `.xls`, and `.csv`; audit JSON, screenshots, DOM HTML, manifests, and diagnostic files are excluded.
- If real report files exist but imported metric rows are still zero, the page tells the operator to import downloaded tables instead of presenting the scope as analysis-ready.
- Verification already passed in the current data-flow smoke: `node scripts\smoke-business-ui-data-pipeline.js`.

### Task B2: 新增数据导入与校验页

**Files:**
- Create: `apps/desktop/src/renderer/pages/data-import-validation-page.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `scripts/smoke-business-ui-data-pipeline.js`

- [x] Step 1: 页面顶部显示当前范围和数据状态。

```text
当前范围真实表格：8/8
已导入广告指标：1694 行
主分析口径：search term / keyword / target，不跨粒度重复相加
```

- [x] Step 2: 展示 8 类报表表格。

```ts
type ReportImportRow = {
  reportType: string;
  fileName: string | null;
  fileStatus: 'missing' | 'downloaded' | 'imported' | 'failed';
  importedRows: number;
  firstDate: string | null;
  lastDate: string | null;
  spendUsd: number;
  orders: number;
  errorMessage?: string;
};
```

- [x] Step 3: 提供“导入已下载表格”按钮。

```ts
await window.amazonAiOps.importDownloadedReports({
  dateFrom: scope.dateFrom,
  dateTo: scope.dateTo,
  storeName: scope.storeName,
  marketplaceCode: scope.marketplaceCode,
  batchId: scope.batchId,
});
```

- [x] Step 4: 导入完成后刷新 DB 汇总。

```text
导入完成：8 个文件，1694 行广告指标，日期 2026-06-01 至 2026-06-12。
```

- [x] Step 5: smoke 覆盖 UI 文案。

```js
assertText(pageText, '数据导入与校验');
assertText(pageText, '真实表格');
assertText(pageText, '已导入广告指标');
assertText(pageText, '导入已下载表格');
```

2026-06-16 B2 verification:

- `数据导入与校验` page exists as a standalone data-and-quantification page, not as an audit card inside a catch-all workbench.
- The page shows current scope, real report count, imported metric rows, primary analysis grain, per-report file/import status, real file path, manifest path, and import actions.
- The UI explicitly separates real report files from acceptance/audit/diagnostic files.
- Verification: `node scripts\smoke-business-ui-data-pipeline.js` passed.

### Task B3: 增强真实数据诊断脚本

**Files:**
- Create: `scripts/diagnose-real-ad-data-chain.js`
- Modify: `scripts/reconcile-lingxing-full8-data.js`
- Test: `scripts/smoke-import-lingxing-batch-metrics.js`

- [x] Step 1: 读取当前用户数据目录。

```js
const appDataCandidates = [
  path.join(process.env.APPDATA || '', '@amazon-ai-ops', 'desktop'),
  path.join(process.env.USERPROFILE || '', 'AmazonAIOps', 'app-data'),
];
```

- [x] Step 2: 检测 DB schema，不假设固定列名。

```js
function getColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}
```

- [x] Step 3: 支持 `lingxing_report_files` 和旧 `report_files`。

```js
const reportFileTable = tableExists(db, 'lingxing_report_files')
  ? 'lingxing_report_files'
  : tableExists(db, 'report_files')
    ? 'report_files'
    : null;
```

- [x] Step 4: 输出证据 JSON。

```json
{
  "status": "READY_FOR_ANALYSIS",
  "dbPath": "C:/Users/wz/AppData/Roaming/@amazon-ai-ops/desktop/amazon-ai-ops.db",
  "batchId": "batch_...",
  "rawReportFileCount": 8,
  "importedMetricRows": 1694,
  "canonicalReportTypes": ["keyword", "user_search_term", "product_targeting", "auto_targeting"],
  "warnings": []
}
```

- [x] Step 5: 只跑脚本级增量验证。

```powershell
node --check scripts\diagnose-real-ad-data-chain.js
node scripts\diagnose-real-ad-data-chain.js --json
```

Expected:

```text
JSON 中 rawReportFileCount >= 8，importedMetricRows > 0，金额为 USD 口径。
```

2026-06-16 B3 verification:

- `node --check scripts\diagnose-real-ad-data-chain.js` passed.
- `node scripts\diagnose-real-ad-data-chain.js` passed against `C:\Users\wz\AppData\Roaming\@amazon-ai-ops\desktop\amazon-ai-ops.db`.
- Current evidence: `output\codex-evidence\business-data-real-evidence-1781542255133.json`.
- Result: `READY_FOR_ANALYSIS`, batch `batch_20260612020905629_gkchz1`, 8/8 real report files, 2416 imported metric rows, canonical `user_search_term` spend USD `617.87`, orders `19`.
- `node --check scripts\smoke-import-lingxing-batch-metrics.js` passed.
- `node scripts\smoke-import-lingxing-batch-metrics.js` passed and wrote `output\codex-evidence\import-lingxing-batch-metrics-smoke-1781542262787.json`.

## Phase C: 运营事件与产品配置

### Task C1: 运营事件录入模型

**Files:**
- Modify: `packages/shared-types/src/operation-event.ts`
- Modify: `packages/local-db/src/sqlite/db.ts`
- Modify: `packages/local-db/src/sqlite/repositories/operation-event-repo.ts`
- Modify: `apps/desktop/src/renderer/pages/operation-events-page.tsx`
- Test: `packages/local-db/src/sqlite/repositories/operation-event-repo.test.ts`

- [x] Step 1: 定义运营事件类型。

```ts
export type OperationEventType =
  | 'coupon'
  | 'deal'
  | 'bd'
  | 'ld'
  | 'promotion'
  | 'price_change'
  | 'inventory'
  | 'inventory_issue'
  | 'listing_change'
  | 'external_traffic'
  | 'offsite_promotion'
  | 'review_change'
  | 'note'
  | 'manual_note';
```

- [x] Step 2: 事件字段覆盖日期、ASIN、影响范围和备注。

```ts
export type OperationEvent = {
  id: number;
  eventDate: string;
  storeName: string;
  marketplaceCode: string;
  asin?: string;
  campaignName?: string;
  adGroupName?: string;
  eventType: OperationEventType;
  title: string;
  impactExpectation?: 'conversion_up' | 'conversion_down' | 'traffic_up' | 'traffic_down' | 'acos_up' | 'acos_down' | 'unknown';
  notes?: string;
  evidencePath?: string;
  createdAt: string;
  updatedAt: string;
};
```

- [x] Step 3: UI 提供快速录入。

```text
今天开了 Coupon
今天参加 BD
大促/Deal
今天调价
今天库存风险
Listing 修改
自定义备注
```

- [x] Step 4: AI 上下文读取当前范围事件。

```ts
const events = await operationEventRepo.findByScope({
  dateFrom,
  dateTo,
  storeName,
  marketplaceCode,
  asin,
});
```

- [x] Step 5: 运行增量验证。

```powershell
pnpm --filter @amazon-ai-ops/local-db test -- operation-event-repo
pnpm --filter @amazon-ai-ops/desktop run build:renderer
```

2026-06-16 C1 verification:

- `operation-event.ts` defines coupon/deal/BD/LD/promotion/price/listing/external traffic/offsite/inventory/review/note event types.
- `operation_events` schema and repository preserve store/site/date/ASIN plus campaign/ad group context.
- `operation-events-page.tsx` provides quick templates for Coupon, BD, promotion, Deal, price change, inventory issue, and Listing change, and states that events enter ad quantification and AI diagnosis but do not execute ads.
- `ad-recommendation-ai-context.ts` and related AI strategy diagnosis code read operation events into the AI context.
- Verification: restored local Node `better-sqlite3` ABI 137 after packaging had rebuilt it for Electron ABI 119, then `pnpm exec vitest run packages/local-db/src/sqlite/repositories/operation-event-repo.test.ts` passed, 1 file / 3 tests.

## Phase D: AI + 规则并行量化

### Task D1: AI 设置状态持久化

**Files:**
- Modify: `apps/desktop/src/renderer/pages/settings-page.tsx`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `packages/local-db/src/sqlite/db.ts`
- Test: `scripts/smoke-ai-settings-no-key-status.js`

- [x] Step 1: `app_settings` 增加 AI 测试状态字段。

```ts
type AiConnectionStatus = {
  status: 'untested' | 'ok' | 'failed';
  testedAt?: string;
  provider?: 'deepseek' | 'openai-compatible';
  model?: string;
  baseUrl?: string;
  errorCode?: string;
  errorMessage?: string;
};
```

- [x] Step 2: 保存设置后不要覆盖最近一次测试状态，除非关键配置变更。

```ts
const connectionChanged =
  previous.baseUrl !== next.baseUrl ||
  previous.model !== next.model ||
  Boolean(next.apiKey);
```

- [x] Step 3: 测试成功后持久化。

```text
AI 可用 · DeepSeek · deepseek-v4-flash · 测试于 2026-06-15 19:30
```

- [x] Step 4: 切换页面再回来仍显示可用。

```js
assertText(settingsTextAfterNavigation, 'AI 可用');
assertNotText(settingsTextAfterNavigation, '待测试');
```

**2026-06-15 增量结果：**
- `settings-page.tsx` 和主进程设置 IPC 已支持保存/测试/回读 AI 状态；保存设置不会在 Base URL 和模型未变化时覆盖最近一次测试结果。
- `scripts/smoke-business-ui-settings-delivery.js` 已验证：测试 AI 后显示 `AI 可用`，切换到交付验收再返回设置页仍显示 `AI 可用`。
- `scripts/smoke-ai-settings-no-key-status.js` 已验证：未配置 Key 时不会把“未配置”持久化为失败测试状态。

### Task D2: 广告量化页展示规则阈值与 AI 阈值建议

**Files:**
- Modify: `apps/desktop/src/renderer/pages/ad-quant-page.tsx`
- Modify: `packages/rules-engine/src/quantification.ts`
- Modify: `packages/ai-adapter/src/ad-strategy-diagnosis.ts`
- Modify: `apps/desktop/src/main/ad-recommendation-ai-context.ts`
- Test: `packages/rules-engine/src/quantification.test.ts`
- Test: `packages/ai-adapter/src/ad-strategy-diagnosis.test.ts`

- [x] Step 1: 规则引擎输出确定性阈值。

```ts
export type RuleThresholdSuggestion = {
  targetAcos: number;
  highAcos: number;
  minClicksNoOrder: number;
  bidDownPercent: number;
  bidUpPercent: number;
  reason: string;
};
```

- [x] Step 2: AI 输出阶段判断和阈值建议。

```ts
export type AiStrategyDiagnosis = {
  productStage: 'launch' | 'growth' | 'stabilize' | 'harvest' | 'unknown';
  confidence: number;
  recommendedThresholds: RuleThresholdSuggestion;
  reasons: string[];
  risks: string[];
};
```

- [x] Step 3: 页面展示“规则建议”和“AI 建议”的差异。

```text
规则阈值：目标 ACOS 35%，高风险 ACOS 50%
AI 建议：当前处于 growth，建议目标 ACOS 42%，高风险 ACOS 58%
最终采用：运营确认后写入本范围策略配置
```

- [x] Step 4: AI 不可用时明确降级。

```text
AI 未连接：当前只使用规则量化。可在设置页测试 DeepSeek 后重新分析。
```

- [x] Step 5: 运行增量验证。

```powershell
pnpm --filter @amazon-ai-ops/rules-engine test -- quantification
pnpm --filter @amazon-ai-ops/ai-adapter test -- ad-strategy-diagnosis
pnpm --filter @amazon-ai-ops/desktop run build:renderer
```

**2026-06-16 增量结果：**
- `ad-quant-page.tsx` 已在广告量化页展示规则阈值和 AI 阈值建议的并排对比：目标 ACOS、高风险 ACOS、无订单点击、最低花费。
- AI 阶段诊断面板现在显示输入规模：广告指标、规则候选、运营事件、产品配置；并展示产品配置数量和 AI 候选数量。
- 页面明确说明：规则阈值是确定性安全边界，AI 阈值是当前范围阶段诊断建议；运营确认后再到设置页调整规则或进入优化建议页。
- AI 不可用或未配置 Key 时，页面明确显示：`AI 未连接：当前只使用规则量化。可在设置页测试 DeepSeek 后重新分析。`
- `scripts/smoke-business-ui-data-pipeline.js` 已覆盖 AI 成功与规则 fallback 两条路径。
- 增量验证通过：
  - `pnpm --filter @amazon-ai-ops/desktop run typecheck`
  - `pnpm --filter @amazon-ai-ops/desktop run build:renderer`
  - `node scripts\smoke-business-ui-data-pipeline.js`
  - `pnpm exec vitest run packages/rules-engine/src/quantification.test.ts`
  - `pnpm exec vitest run packages/ai-adapter/src/ad-strategy-diagnosis.test.ts`
  - `node scripts\diagnose-real-ad-data-chain.js`

### Task D3: 优化建议生成显示 AI 参与和过滤原因

**Files:**
- Modify: `apps/desktop/src/renderer/pages/recommendations-page.tsx`
- Modify: `packages/rules-engine/src/ad-decision-merger.ts`
- Modify: `packages/rules-engine/src/recommendation.ts`
- Modify: `packages/local-db/src/sqlite/repositories/recommendation-repo.ts`
- Test: `scripts/smoke-business-ui-ad-execution.js`

- [x] Step 1: 建议生成结果必须有三层计数。

```ts
type GenerateRecommendationSummary = {
  ruleCandidateCount: number;
  aiCandidateCount: number;
  finalActionCount: number;
  skippedCount: number;
  skippedReasons: Array<{ reason: string; count: number }>;
};
```

- [x] Step 2: AI 候选不能直接执行，必须绑定广告实体。

```ts
type BindableAdAction = {
  campaignName: string;
  adGroupName: string;
  entityType: 'keyword' | 'search_term' | 'target';
  entityText: string;
  currentValue?: number;
  recommendedValue?: number;
  source: 'rule' | 'ai' | 'rule_ai_merged';
};
```

- [x] Step 3: 无建议时解释具体原因。

```text
AI 返回 6 条策略候选，但 6 条都缺少 campaign/ad group/keyword/target 绑定，未进入审批。
```

- [x] Step 4: 页面表格必须展示上下文。

```text
广告组合 | Campaign | Ad Group | 产品/ASIN | Keyword/Search Term/Target | 当前值 | 建议值 | 来源 | 原因 | 风险
```

- [x] Step 5: 运行增量验证。

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:renderer
node scripts\smoke-business-ui-ad-execution.js
```

**2026-06-15 增量结果：**
- `recommendations:generate` 返回的 `strategyDiagnosis` 已包含 `decisionCounts`、`finalCandidateCount`、`filteredAiOnlyCandidateCount` 和 `filterReasons`。
- `recommendations-page.tsx` 已展示 AI/规则合并诊断：一致、规则-only、AI-only、冲突、需复核，以及 AI-only 被过滤或规则 fallback 的原因。
- 0 条建议时页面会说明是否为缺真实数据、重复建议、规则/AI 无候选、AI 候选无法绑定真实广告对象，而不是只显示空列表。
- 增量验证通过：
  - `pnpm --filter @amazon-ai-ops/desktop run typecheck`
  - `pnpm --filter @amazon-ai-ops/desktop run build:renderer`
  - `node scripts\smoke-business-ui-ad-execution.js`
  - `node scripts\smoke-business-ui-settings-delivery.js`
  - `node scripts\smoke-ai-settings-no-key-status.js`
  - `node scripts\diagnose-real-ad-data-chain.js`

## Phase E: 广告执行闭环

### Task E1: 审批中心只审批具体动作范围

**Files:**
- Modify: `apps/desktop/src/renderer/pages/approval-page.tsx`
- Modify: `apps/desktop/src/main/recommendation-approval-policy.ts`
- Modify: `packages/shared-types/src/action.ts`
- Test: `apps/desktop/src/main/recommendation-approval-policy.test.ts`

- [x] Step 1: 审批对象必须有完整范围。

```ts
type ApprovalScope = {
  storeName: string;
  marketplaceCode: string;
  campaignName: string;
  adGroupName: string;
  entityType: 'keyword' | 'search_term' | 'target';
  entityText: string;
  actionType: 'lower_bid' | 'raise_bid' | 'pause' | 'add_negative' | 'add_target';
};
```

- [x] Step 2: 审批缺字段时 fail closed。

```text
缺少广告组或投放对象，不能审批。
```

- [x] Step 3: 审批页不显示命令行模板，只显示可理解证据。

```text
当前 bid：1.20 USD
建议 bid：1.08 USD
理由：12 天点击 38，订单 0，高于当前阶段点击阈值。
```

**2026-06-16 增量结果：**
- `recommendation-approval-policy.ts` 要求建议必须绑定店铺、站点、来源批次、指标日期、campaign、ad group、对象类型、关键词/搜索词/投放对象、动作、当前值、建议值和来源文件。
- 主进程 `handleApproveRecommendation` 在写入 approved 前调用 `assertRecommendationCurrentDataGate` 和 `assertRecommendationApprovalPolicy`，所以审批不是只靠前端禁按钮。
- AI-only、AI/规则冲突、需复核、规则量化需复核、高风险/禁止等级都会被普通批准阻断。
- `approval-page.tsx` 展示审批范围、campaign、ad group、对象、当前值/建议值、来源文件和预检结论，不展示命令行模板。
- 增量验证通过：
  - `pnpm exec vitest run apps/desktop/src/main/recommendation-approval-policy.test.ts`
  - `node scripts\smoke-business-ui-ad-execution.js`

### Task E2: 执行回读支持通用多对象，不绑定单一样例

**Files:**
- Modify: `apps/desktop/src/renderer/pages/readback-page.tsx`
- Modify: `apps/desktop/src/main/ad-readback-evidence.ts`
- Modify: `packages/action-executor/src/ad-actions.ts`
- Test: `apps/desktop/src/main/ad-readback-evidence.test.ts`

- [x] Step 1: before/after/readback 结构按动作实体建模。

```ts
type AdActionReadback = {
  actionId: string;
  scope: ApprovalScope;
  before: { value: number; capturedAt: string; screenshotPath: string };
  after: { value: number; capturedAt: string; screenshotPath: string };
  readback: { value: number; capturedAt: string; evidencePath: string };
  verified: boolean;
};
```

- [x] Step 2: 低风险暂停广告样例只能作为验证样例，不写死进系统。

```text
当前样例已通过；后续每个广告动作必须重新绑定 campaign/ad group/entity/action。
```

- [x] Step 3: 执行页显示“下一步”而不是内部命令。

```text
下一步：在 Ads UI 中完成该动作后，上传或刷新 after 截图，再点击“回读验证”。
```

**2026-06-15 增量结果：**
- `readback-page.tsx` 已从已审批建议继承 campaign/ad group/entity/action、来源批次、来源文件、审批人/备注/时间，并新增产品阶段、目标 ACOS/TACOS/净利率/最低价、AI/规则一致性、AI 阈值建议、规则量化阈值展示。
- `ad-readback-evidence.ts` 导出的 JSON/Markdown 已保留产品上下文、AI 策略、规则量化阈值、决策来源和风险提示；导出动作仍只写本地证据，不执行 Amazon 写入。
- `smoke-business-ui-ad-execution.js` 已验证审批到回读 IPC 入参包含上述上下文，确保多对象动作不退化为单一样例。
- 增量验证通过：
  - `pnpm exec vitest run apps/desktop/src/main/ad-readback-evidence.test.ts`
  - `pnpm --filter @amazon-ai-ops/desktop run typecheck`
  - `pnpm --filter @amazon-ai-ops/desktop run build:renderer`
  - `node scripts\smoke-business-ui-ad-execution.js`
  - `node scripts\diagnose-real-ad-data-chain.js`

## Phase F: 关键词与 Listing

### Task F1: 关键词机会按广告上下文拆清楚

**Files:**
- Modify: `apps/desktop/src/renderer/pages/keyword-opportunities-page.tsx`
- Modify: `packages/keyword-opportunity/src/engine.ts`
- Modify: `packages/local-db/src/sqlite/repositories/ad-metrics-repo.ts`
- Test: `packages/keyword-opportunity/src/engine.test.ts`

- [x] Step 1: 不再把多个 campaign/ad group 混成一行。
  - 2026-06-16: `packages/keyword-opportunity` 聚合键改为 ASIN / portfolio / campaign / ad group / source / keyword；UI 后端按 campaign/ad group 分组，避免同词跨广告上下文混算。

```ts
type KeywordOpportunityRow = {
  portfolioName?: string;
  campaignName: string;
  adGroupName: string;
  asin?: string;
  searchTerm: string;
  clicks: number;
  orders: number;
  spendUsd: number;
  salesUsd: number;
  suggestedAction: string;
};
```

- [x] Step 2: 过滤器放顶部。
  - 2026-06-16: 关键词机会页补充当前日期、店铺、站点、批次只读摘要；筛选增加 Ad Group；说明同词不同广告组会拆为独立行。

```text
日期 | 店铺 | 站点 | ASIN | Campaign | Ad Group | 最小花费 | 最小点击
```

**F1 Incremental Verification - 2026-06-16**
- `pnpm exec vitest run packages/keyword-opportunity/src/engine.test.ts` - passed, 6 tests.
- `pnpm --filter @amazon-ai-ops/desktop run build:renderer` - passed.
- `node scripts\smoke-business-ui-keyword-listing.js` - passed, evidence `output\codex-evidence\business-ui-keyword-listing-smoke-1781540338030.json`.
- `pnpm --filter @amazon-ai-ops/desktop run typecheck` - passed.
- `node scripts\diagnose-real-ad-data-chain.js` - passed, 8/8 real report files, 2416 imported metric rows, canonical spend USD 617.87, orders 19.

### Task F2: Listing 读取与 AI 草案

**Files:**
- Modify: `apps/desktop/src/renderer/pages/listing-optimization-page.tsx`
- Modify: `apps/desktop/src/main/listing-lingxing-extractor.ts`
- Modify: `packages/listing-analyzer/src/draft.ts`
- Modify: `packages/ai-adapter/src/index.ts`
- Test: `apps/desktop/src/main/listing-lingxing-extractor.test.ts`
- Test: `packages/listing-analyzer/src/draft.test.ts`

- [x] Step 1: Listing 页分为三步。
  - 2026-06-16: Listing 页已拆为关键词机会、领星 Listing 读取、AI/规则草案、导出与发布边界四段工作流；页面不承载广告审批或真实广告执行。

```text
1. 从领星读取 Listing
2. 结合广告搜索词生成 AI 草案
3. 导出草案，不提交 Amazon
```

- [x] Step 2: 读取时校验 ASIN 是否匹配当前范围。
  - 2026-06-16: 前端读取时向主进程传 `expectedAsin`；主进程在持久化前校验，不匹配时返回阻断结果且不写入 Listing 内容。

```text
当前页面 ASIN 与工作范围 ASIN 不一致，请确认后再读取。
```

- [x] Step 3: AI 草案必须带来源。
  - 2026-06-16: Listing 草案导出保留 `source`、`aiFallbackReason`、`evidence` 和风险字段；页面显示 AI/规则数量、AI 可用状态和 fallback 边界。

```text
标题建议：...
来源：广告搜索词 top terms + 当前 Listing 标题 + 五点描述。
```

**F2 Incremental Verification - 2026-06-16**
- `pnpm exec vitest run apps/desktop/src/main/listing-lingxing-extractor.test.ts packages/listing-analyzer/src/draft.test.ts packages/listing-analyzer/src/export.test.ts` - passed, 11 tests.
- `pnpm --filter @amazon-ai-ops/desktop run build:renderer` - passed.
- `pnpm --filter @amazon-ai-ops/desktop run typecheck` - passed.
- `node scripts\smoke-business-ui-keyword-listing.js` - passed, evidence `output\codex-evidence\business-ui-keyword-listing-smoke-1781540504376.json`.

## Phase G: 仪表盘重构

### Task G1: 仪表盘变成“今天怎么运营”的总览

**Files:**
- Modify: `apps/desktop/src/renderer/pages/dashboard-page.tsx`
- Modify: `apps/desktop/src/renderer/components/business-data.tsx`
- Test: `scripts/smoke-business-ui-shell.js`

- [x] Step 1: 第一屏展示数据健康。
  - 2026-06-16: 仪表盘顶部新增“数据健康”，集中展示当前范围、真实报表 8 类覆盖、导入行、AI 状态、待审批建议、广告花费、销售/订单和 ACOS。

```text
当前范围：2026-06-01 至 2026-06-12 · FT-US-US · US · USD
真实报表：8/8
已导入指标：1694 行
AI：可用
待审批建议：N
待回读动作：M
```

- [x] Step 2: KPI 使用真实导入数据。
  - 2026-06-16: 首页花费、销售、订单、点击、CPC、CVR、ACOS 均来自 `useBusinessDataPipeline().quant`，无真实导入指标时显示等待状态，不展示业务结论。

```text
广告花费：$617.87
广告销售：$1,089.79
订单：19
ACOS：56.7%
点击：...
```

- [x] Step 3: 今日待办只显示 3 到 5 项。
  - 2026-06-16: 首页保留“今天先做什么”4 步工作流和“行动队列”3 项以内主任务，执行和审计入口不直接占据首屏。

```text
1. 当前范围已导入，建议先运行广告量化。
2. 有 3 条建议待审批。
3. 有 1 条执行动作待回读。
```

**G1 Incremental Verification - 2026-06-16**
- `pnpm --filter @amazon-ai-ops/desktop run build:renderer` - passed.
- `pnpm --filter @amazon-ai-ops/desktop run typecheck` - passed.
- `node scripts\smoke-business-ui-data-pipeline.js` - passed, evidence `output\codex-evidence\business-ui-data-pipeline-smoke-1781540694119.json`.

## Phase H: 视觉系统和 Stitch 设计稿落地

### Task H1: 将 Stitch/设计稿转成后台 UI 规则

**Files:**
- Modify: `docs/design/stitch-admin-console-redesign-2026-06-13.md`
- Modify: `docs/design/amazon-ai-ops-screen-map.md`
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: `apps/desktop/src/renderer/components/ui.tsx`

- [x] Step 1: 固化视觉原则。
  - 2026-06-16: 设计文档补充“首屏健康/门槛”和“技术细节默认折叠”；明确后台工具优先，技术命令、原始 JSON 和原始状态码不进入主视觉。

```text
后台工具优先：信息密度适中、状态明确、操作分层、少装饰、少大卡片。
```

- [x] Step 2: 定义统一组件。
  - 2026-06-16: 保持 `Panel` / `StatusPill` / `PageHeader` 统一组件；修复 CSS 未定义 `--accent`，统一 details/summary 折叠区样式。

```ts
export const statusToneClass = {
  success: 'status status-success',
  warning: 'status status-warning',
  danger: 'status status-danger',
  neutral: 'status status-neutral',
};
```

- [x] Step 3: 禁止 command/audit 信息直接占主视觉。
  - 2026-06-16: shell smoke 增加 `APP_NEEDS_WORK` 原始状态码保护；继续阻断 `APP_READY`、RMB 和长命令墙暴露。

```text
审计文件和命令只在“交付验收”或“高级详情”中展示。
```

- [x] Step 4: 按页面职责重排视觉。
  - 2026-06-16: 当前页面遵循“范围条 -> 页面职责 -> 数据健康/门槛 -> 核心动作 -> 结果/证据 -> 技术细节折叠”的后台信息层级。

```text
页面标题区 -> 当前任务 -> 主操作 -> 数据表/结果 -> 高级证据折叠区
```

**H1 Incremental Verification - 2026-06-16**
- `pnpm --filter @amazon-ai-ops/desktop run build:renderer` - passed.
- `node scripts\smoke-business-ui-shell.js` - passed, evidence `output\codex-evidence\business-ui-shell-smoke-1781540804539.json`.

## Phase I: 最终验收和无安装 exe

### Task I1: 增量完成后进行最终全量验证

**Files:**
- Modify as needed: `docs/V1_5_PROGRESS_REPORT.md`
- Modify as needed: `docs/V1_5_ACCEPTANCE_MATRIX.md`
- Modify as needed: `docs/USER_GUIDE_v1_5.md`

- [x] Step 1: 只在所有开发任务完成后跑全量。

```powershell
pnpm test
pnpm -r run typecheck
pnpm --filter @amazon-ai-ops/desktop run build:win
```

Note: the older `node scripts\run-tests.js` entry no longer exists on current `master`; the current full-suite command is the root `pnpm test` script.

2026-06-16 final validation:

- `pnpm test` - passed, 50 test files / 240 passed / 2 skipped.
- `pnpm -r run typecheck` - passed.
- `pnpm --filter @amazon-ai-ops/desktop run build:win` - passed.

- [x] Step 2: 记录安装包信息。

```powershell
Get-FileHash apps\desktop\release\AmazonAIOpsAgent-1.5.0.exe -Algorithm SHA256
Get-Item apps\desktop\release\AmazonAIOpsAgent-1.5.0.exe | Select-Object FullName,Length,LastWriteTime
Get-FileHash apps\desktop\release\AmazonAIOpsAgent-1.5.0-portable.exe -Algorithm SHA256
Get-Item apps\desktop\release\AmazonAIOpsAgent-1.5.0-portable.exe | Select-Object FullName,Length,LastWriteTime
```

2026-06-16 release artifacts:

- Installer: `apps\desktop\release\AmazonAIOpsAgent-1.5.0.exe`, SHA-256 `49CB66AB2356475B69988571CC1D3707586E293BCC013B09D3D4F1320BAD207E`, size `89809746` bytes, last write `2026-06-16 00:55:11`.
- No-install portable exe: `apps\desktop\release\AmazonAIOpsAgent-1.5.0-portable.exe`, SHA-256 `71E82D4752EC2BE14C60CF34A405BB844929EFAB106BB68A38CEB412B6CBA913`, size `89643993` bytes, last write `2026-06-16 00:55:12`.

2026-06-16 READY safety closeout:

- Fixed the final-readiness default selector in `scripts\verify-v15-ready-safety.js` and `scripts\export-v15-delivery-bundle.js` so smoke/guard files are not selected as final APP_READY evidence.
- Refreshed the APP_READY delivery bundle with explicit final readiness and current real-data reconciliation evidence:
  `output\delivery-bundles\v15-delivery-bundle-2026-06-15T17-00-08-661Z`.
- `pnpm run verify:v15-ready-safety` - passed.
- `node --check scripts\verify-v15-ready-safety.js` - passed.
- `node --check scripts\export-v15-delivery-bundle.js` - passed.
- `node scripts\smoke-export-v15-delivery-bundle.js` - passed, evidence `output\codex-evidence\export-v15-delivery-bundle-smoke-1781542828364.json`.

- [x] Step 3: 真实数据证据包必须包含。

```text
真实 8 类报表文件列表
DB 导入汇总
UI 截图
AI 测试证据
AI + 规则建议证据
审批证据
执行回读证据
最终 readiness JSON
```

2026-06-16 current real-data diagnostic:

- `node scripts\diagnose-real-ad-data-chain.js` - passed.
- Current AppData DB: `C:\Users\wz\AppData\Roaming\@amazon-ai-ops\desktop\amazon-ai-ops.db`.
- Batch: `batch_20260612020905629_gkchz1`.
- Result: 8/8 real report files, 2416 imported metric rows, canonical `user_search_term` spend USD `617.87`, orders `19`.
- Evidence: `output\codex-evidence\business-data-real-evidence-1781542255133.json`.

- [x] Step 4: 输出无安装 exe 路径。

```text
apps/desktop/release/AmazonAIOpsAgent-1.5.0-portable.exe
```

### Task I2: 最终交付判断

最终只有满足以下全部条件才能标记 READY：

- 真实 Lingxing 8 类报表已下载。
- 真实报表已导入 SQLite。
- USD 金额口径正确。
- 仪表盘 KPI 来自 DB，不是假数据。
- AI 设置测试成功且状态持久。
- 广告量化展示规则阈值 + AI 阈值建议。
- 优化建议展示规则候选、AI 候选、最终可审批动作和过滤原因。
- 审批和执行回读绑定具体 campaign/ad group/entity/action。
- Listing 可读取真实详情并生成 AI 草案。
- 交付验收只汇总证据，不承载日常操作。
- 最终全量测试、typecheck、Windows build 通过。

---

## 5. 测试策略

开发中只跑增量测试：

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:renderer
node scripts\<changed-page-smoke>.js
pnpm --filter @amazon-ai-ops/<changed-package> test -- <specific-test>
node --check scripts\<changed-script>.js
```

最终节点才跑全量：

```powershell
pnpm test
pnpm -r run typecheck
pnpm --filter @amazon-ai-ops/desktop run build:win
```

---

## 6. 风险与卡点

### 6.1 真实领星页面变化

风险：下载中心 DOM 或按钮变化导致创建/下载失败。

处理：

- 不猜 selector。
- 用页面模型验证保存当前 DOM/截图。
- 页面模型失败时，UI 显示“需要重新验证领星页面”，不继续伪成功。

### 6.2 数据口径重复相加

风险：campaign/ad_group/placement/search_term 多粒度同时汇总，导致花费/订单膨胀。

处理：

- 报表导入保留 `report_type` 和 `grain`。
- 仪表盘主 KPI 只选择一个 canonical 粒度。
- 建议生成只使用 keyword/search_term/target 可执行粒度。

### 6.3 AI 幻觉生成不可执行建议

风险：AI 给策略话术，但缺少 campaign/ad group/entity 绑定。

处理：

- AI 候选必须通过 binder。
- 未绑定候选只进入“策略观察”，不能进入审批。
- 页面展示过滤原因。

### 6.4 广告执行安全

风险：误批量写入 Ads。

处理：

- fail closed。
- 每条动作必须审批。
- 每条动作必须有 before/after/readback。
- 默认不自动提交 Listing。

---

## 7. 推荐实施顺序

1. Phase A：菜单和范围重构，先解决“用户不知道在哪做什么”。
2. Phase B：真实数据链路，解决“系统核心数据是否真实可用”。
3. Phase C：运营事件，补齐广告波动背景。
4. Phase D：AI + 规则量化，解决“AI 深度集成”和“阈值动态化”。
5. Phase E：审批执行回读，解决真实广告动作闭环。
6. Phase F：关键词与 Listing，补齐增长和内容优化链路。
7. Phase G/H：仪表盘和视觉系统整体打磨。
8. Phase I：最终全量测试、打包无安装 exe、交付证据。

---

## 8. 当前下一步建议

最优先执行这三个任务：

1. `Task A1` + `Task A2`：先把菜单和全局范围改清楚。
2. `Task B2` + `Task B3`：新增数据导入校验页和真实数据诊断脚本，证明真实报表与 DB 已闭环。
3. `Task D1` + `Task D2`：修复 AI 状态持久化，并把 AI 真正接入广告量化。

这三组完成后，用户能清楚看到：

- 当前范围是什么。
- 真实数据在哪里。
- 数据有没有进入数据库。
- AI 是否真的可用。
- AI 和规则分别给了什么量化结论。
