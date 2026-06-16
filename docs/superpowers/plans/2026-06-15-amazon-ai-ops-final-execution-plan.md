# Amazon AI Ops Final Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Amazon AI Ops 收尾成真实可用的跨境广告运营后台：从领星真实广告表格开始，沉淀每日广告数据，用规则和 AI 并行完成量化诊断、阈值建议、优化建议、审批、真实执行回读，并以清晰 UI 交付给运营使用。

**Architecture:** 真实领星 XLSX/CSV 是唯一数据入口；导入 SQLite 后形成日粒度广告事实表；运营事件、广告量化、规则建议和 DeepSeek/OpenAI-compatible AI 诊断并行进入决策合并层；前端按业务流拆成数据、量化、建议、审批、执行、关键词/Listing、设置、交付验收，不再把所有任务塞进 v1.5 工作台。

**Tech Stack:** Electron desktop, React, TypeScript, SQLite/better-sqlite3, Lingxing collector/parser, rules-engine, ai-adapter, DeepSeek/OpenAI-compatible API, renderer smoke scripts, targeted tests, Windows electron-builder.

---

## 1. 当前共识和不可退让标准

### 1.1 项目核心

- 系统核心不是审计包，也不是 UI 按钮集合，而是拿到真实领星广告数据后持续形成每日广告数据库。
- 没有真实 XLSX/CSV 广告报表时，系统必须明确阻断广告量化、优化建议和 AI 诊断，不能用 0 或审计 JSON 假装有数据。
- 这是跨境广告系统，金额默认显示 USD，不使用人民币符号。
- 批次 ID 是系统证据字段，不应在主界面高频暴露；用户主视角应该是日期、店铺、站点、币种、数据是否完整、下一步该做什么。

### 1.2 AI 使用方式

- AI 必须深度接入广告分析，而不是只给规则建议写解释。
- AI 和规则并行：
  - 规则负责硬约束、可复现阈值、安全边界、数据口径。
  - AI 负责产品推广阶段判断、异常解释、动态阈值建议、运营事件影响判断、建议理由。
  - 决策合并层展示 AI 与规则一致、冲突、AI-only、rule-only，并决定是否进入人工复核。
- 用户提供的 DeepSeek Key 只能进入本地设置和系统安全存储，不写入代码、文档、测试快照、证据包或日志。

### 1.3 运营上下文

需要支持运营录入会影响广告判断的事件：

- Coupon / 折扣。
- BD / LD / 大促。
- 调价。
- 预算调整。
- Listing 修改。
- 库存异常。
- 评价/星级变化。
- 外部流量。
- 手工备注。

这些事件必须进入 AI 上下文和量化分析，避免把促销期的 ACOS 波动当作普通异常。

### 1.4 UI 原则

每个页面必须回答六个问题：

1. 当前页面负责什么。
2. 当前操作范围是什么。
3. 现在有哪些真实数据。
4. 缺什么。
5. 下一步做什么。
6. 哪些动作安全，哪些动作被阻断。

---

## 2. 目标菜单和页面职责

### 2.1 左侧菜单

```text
运营总览
  仪表盘
  今日待办

数据中心
  数据采集
  导入历史
  数据质量

广告量化
  产品广告档案
  每日量化分析
  阈值与策略
  运营事件

广告优化
  优化建议
  审批中心
  执行回读

关键词与 Listing
  关键词机会
  Listing 优化

系统与交付
  AI 设置
  定时任务
  交付验收
  诊断包
```

### 2.2 页面职责边界

- 仪表盘：只展示运营状态、今日风险、数据可用性、待办，不展示审计命令。
- 数据采集：只负责领星报表创建、下载、导入、真实文件检查。
- 广告量化：只负责基于每日事实数据输出阶段、阈值、趋势、异常。
- 运营事件：只负责录入和维护活动/折扣/BD/调价等事件。
- 优化建议：只负责 AI+规则并行生成建议和解释。
- 审批中心：只负责人工审核、范围确认、风险确认。
- 执行回读：只负责真实 Ads UI 单动作执行、before/after/readback 证据。
- 关键词机会：只负责关键词和搜索词机会。
- Listing 优化：只负责领星 Listing 读取、关键词覆盖、AI 草稿。
- AI 设置：只负责模型配置、连接测试、测试状态持久化。
- 交付验收：只负责最终 READY 证据、manifest、安装包、审计缺口。

---

## 3. 文件责任图

### 3.1 数据模型

- Modify: `packages/shared-types/src/ad.ts`
  - 增加 `ReportGrain`、`ReportFileStatus`、`DailyAdFact`、`CurrencyCode`。
  - 默认跨境币种为 `USD`。

- Modify: `packages/shared-types/src/recommendation.ts`
  - 增加 AI 诊断、规则诊断、动态阈值、冲突状态、来源证据字段。

- Create/Modify: `packages/shared-types/src/operation-event.ts`
  - 定义运营事件类型、影响范围、日期、备注、关联 ASIN/campaign/ad group。

### 3.2 本地数据库

- Modify: `packages/local-db/src/sqlite/db.ts`
  - 迁移 `report_files`、`operation_events`、`ai_diagnosis_runs`、`ai_connection_status`。
  - 补足 `ad_daily_metrics` 的 `source_file`、`source_row`、`currency`、`report_type`、`batch_id`。

- Modify/Create: `packages/local-db/src/sqlite/repositories/report-file-repo.ts`
  - 登记真实报表文件、hash、大小、状态、导入行数。

- Modify: `packages/local-db/src/sqlite/repositories/ad-metrics-repo.ts`
  - 统一数据口径查询，不跨 report grain 混加。

- Modify/Create: `packages/local-db/src/sqlite/repositories/operation-event-repo.ts`
  - CRUD 和按范围查询运营事件。

- Create: `packages/local-db/src/sqlite/repositories/ai-diagnosis-repo.ts`
  - 存 AI 输出，不存 API Key。

### 3.3 领星采集和导入

- Modify: `packages/lingxing-report-collector/src/download-center-page.ts`
  - 固化真实 DOM 后的 action selectors。
  - 区分 ready 行下载和重新创建任务。

- Modify: `packages/lingxing-report-collector/src/batch-runner.ts`
  - 状态流：`created -> ready -> downloading -> downloaded -> imported -> failed`。
  - 只有真实 XLSX/CSV 落盘才算 downloaded。

- Modify: `scripts/import_lingxing_batch_metrics.py`
  - 导入 8 类真实表格，输出导入摘要 JSON。

### 3.4 AI 和规则

- Modify/Create: `packages/rules-engine/src/quantification.ts`
  - 阶段判断：冷启动、测词、放量、稳定、防守、异常。
  - 输出目标 ACOS、止损花费、无订单点击阈值、升降价比例等阈值。

- Modify/Create: `packages/ai-adapter/src/ad-strategy-diagnosis.ts`
  - AI 输入：每日广告事实、运营事件、规则结果、历史趋势、当前阈值。
  - AI 输出：阶段判断、阈值建议、异常解释、建议动作、置信度、复核原因。

- Modify/Create: `packages/rules-engine/src/ad-decision-merger.ts`
  - 合并 AI 和规则结果，输出一致/冲突/AI-only/rule-only。

### 3.5 Electron IPC

- Modify: `apps/desktop/src/main/index.ts`
  - 增加/修复业务范围、报表下载、导入、量化、运营事件、AI 设置、建议生成、审批、readback IPC。

- Modify: `apps/desktop/src/preload/index.ts`
  - 暴露类型安全 renderer API。

### 3.6 Renderer

- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify/Create: `apps/desktop/src/renderer/components/app-shell.tsx`
- Modify/Create: `apps/desktop/src/renderer/components/scope-bar.tsx`
- Modify: `apps/desktop/src/renderer/pages/dashboard-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/data-collection-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/ad-quant-page.tsx`
- Modify/Create: `apps/desktop/src/renderer/pages/operation-events-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/recommendations-page.tsx`
- Modify/Create: `apps/desktop/src/renderer/pages/approval-page.tsx`
- Modify/Create: `apps/desktop/src/renderer/pages/readback-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/keyword-opportunities-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/listing-optimization-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/settings-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/delivery-page.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

---

## 4. 分阶段执行计划

## Phase 0: 当前状态冻结和设计前置

**目标:** 确认当前代码、Stitch 能力、现有真实数据证据，不重复跑全量测试。

- [ ] **Step 0.1: 记录当前分支和脏文件**

Run:

```powershell
git status --short --branch
```

Expected:

```text
记录当前分支和工作区状态；不 revert 用户或历史生成文件。
```

- [ ] **Step 0.2: 检查 Stitch MCP 是否可调用**

Run:

```powershell
rg -n "stitch|mcp_servers.stitch" "$env:USERPROFILE\.codex" "$env:USERPROFILE\.config" -g "*.toml" -g "*.json" -g "*.md"
```

Expected:

```text
如果有可调用 Stitch MCP 工具，先生成整体后台设计稿。
如果只有配置没有工具暴露，记录为阻断，不声称已使用 Stitch 生成设计。
```

- [ ] **Step 0.3: 读取广告量化理论文档**

Use document tooling or Python docx reader for:

```text
C:\Users\wz\Downloads\amazon_ads_quant_theory.docx
```

Expected:

```text
提取可落地字段：产品阶段、阈值、广告指标、动作规则、风险限制。
```

---

## Phase 1: 真实报表下载和导入闭环

**目标:** 用户点击下载后能在文件夹看到真实领星 XLSX/CSV；导入后 DB 有每日广告事实。

### Task 1.1: 拆清楚三个报表动作

**Files:**
- Modify: `apps/desktop/src/renderer/pages/data-collection-page.tsx`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `packages/lingxing-report-collector/src/batch-runner.ts`
- Test: `packages/lingxing-report-collector/src/batch-runner.test.ts`

- [ ] UI 按钮改为三个不同动作：
  - `下载已创建报表`
  - `重新创建并下载`
  - `导入本地报表`
- [ ] `下载已创建报表` 只下载当前范围已有 ready 行。
- [ ] `重新创建并下载` 先创建任务，轮询 ready，再下载。
- [ ] `导入本地报表` 允许用户选择已有 XLSX/CSV 文件夹导入。
- [ ] 下载成功必须满足：文件存在、扩展名是 XLSX/CSV、大小大于 0、manifest 登记 hash。
- [ ] 只产生 JSON/PNG/HTML/MD/TXT 审计文件时，状态必须是 failed 或 blocked。

Incremental verification:

```powershell
pnpm exec vitest run packages/lingxing-report-collector/src/batch-runner.test.ts
pnpm --filter @amazon-ai-ops/desktop run typecheck
```

### Task 1.2: 登记真实报表文件

**Files:**
- Modify: `packages/local-db/src/sqlite/db.ts`
- Modify/Create: `packages/local-db/src/sqlite/repositories/report-file-repo.ts`
- Test: `packages/local-db/src/sqlite/repositories/report-file-repo.test.ts`

- [ ] `report_files` 字段包含：`batch_id`、`scope_key`、`report_type`、`file_path`、`file_size`、`sha256`、`downloaded_at`、`imported_at`、`row_count`、`status`、`error_message`。
- [ ] 文件缺失、空文件、日期范围不匹配、报表类型无法识别，都返回可读错误。
- [ ] 文件登记结果在数据采集页显示为“真实文件 8/8、已导入 N 行”。

Incremental verification:

```powershell
pnpm exec vitest run packages/local-db/src/sqlite/repositories/report-file-repo.test.ts
pnpm --filter @amazon-ai-ops/local-db run typecheck
```

### Task 1.3: 导入每日广告事实

**Files:**
- Modify: `scripts/import_lingxing_batch_metrics.py`
- Modify: `packages/local-db/src/sqlite/repositories/ad-metrics-repo.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Test: `scripts/smoke-business-report-file-filter.js`

- [ ] 导入 8 类报表后写入 `ad_daily_metrics`。
- [ ] 每行保留：日期、店铺、站点、币种、campaign、ad group、portfolio、ASIN、keyword/search term/target、report type、source file、source row。
- [ ] 导入摘要包含：每类文件行数、总导入行数、日期范围、花费、订单、销售额、币种。
- [ ] 金额显示统一为 USD。
- [ ] 后续页面只读取 DB，不直接猜审计目录。

Incremental verification:

```powershell
node scripts\smoke-business-report-file-filter.js
```

---

## Phase 2: 数据口径和量化层

**目标:** 不同报表粒度不混加，广告量化能给出产品阶段和阈值建议。

### Task 2.1: 统一报表粒度

**Files:**
- Create/Modify: `packages/local-db/src/sqlite/ad-metric-grain.ts`
- Modify: `packages/local-db/src/sqlite/repositories/ad-metrics-repo.ts`
- Test: `packages/local-db/test/ad-metrics-repo.test.ts`

- [ ] 定义 `canonical`、`actionable`、`breakdown` 三类口径。
- [ ] 总销售额、总花费、总订单只使用一个权威口径。
- [ ] 建议生成只使用可执行口径：keyword、product_targeting、search_term、auto_targeting。
- [ ] campaign、ad_group、placement 只做分解查看，不参与重复加总。

Incremental verification:

```powershell
pnpm exec vitest run packages/local-db/test/ad-metrics-repo.test.ts
```

### Task 2.2: 广告量化输出

**Files:**
- Create/Modify: `packages/rules-engine/src/quantification.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/renderer/pages/ad-quant-page.tsx`
- Test: `packages/rules-engine/test/quantification.test.ts`

- [ ] 对 ASIN/campaign/ad group/target 输出：阶段、核心指标、风险等级、建议阈值。
- [ ] 阈值至少包含：目标 ACOS、高 ACOS、无订单点击阈值、止损花费、建议降价比例、建议加价比例。
- [ ] 阈值来源标记为：默认配置、规则计算、AI 建议、人工覆盖。
- [ ] 没有真实数据时，页面显示“缺少真实报表文件或导入数据”，不能显示 0 当作结果。

Incremental verification:

```powershell
pnpm exec vitest run packages/rules-engine/test/quantification.test.ts
node scripts\smoke-business-ui-data-pipeline.js
```

---

## Phase 3: 运营事件进入分析

**目标:** 运营能记录折扣、BD、大促等事件，AI 和规则能解释广告波动。

### Task 3.1: 运营事件数据模型

**Files:**
- Modify/Create: `packages/shared-types/src/operation-event.ts`
- Modify: `packages/local-db/src/sqlite/db.ts`
- Modify/Create: `packages/local-db/src/sqlite/repositories/operation-event-repo.ts`
- Test: `packages/local-db/src/sqlite/repositories/operation-event-repo.test.ts`

- [ ] 支持事件类型：coupon、deal、bd、ld、price_change、inventory、listing_change、review_change、external_traffic、note。
- [ ] 支持范围：店铺、站点、ASIN、campaign、ad group、日期起止。
- [ ] 支持影响标记：increase_conversion、increase_traffic、margin_risk、stock_risk、noise。

Incremental verification:

```powershell
pnpm exec vitest run packages/local-db/src/sqlite/repositories/operation-event-repo.test.ts
```

### Task 3.2: 运营事件页面

**Files:**
- Modify/Create: `apps/desktop/src/renderer/pages/operation-events-page.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/index.ts`

- [ ] 页面提供时间线和录入表单。
- [ ] 用户可以按当前业务范围快速新增事件。
- [ ] 广告量化页和优化建议页展示“当前范围内运营事件 N 条”。

Incremental verification:

```powershell
pnpm --filter @amazon-ai-ops/desktop run typecheck
pnpm --filter @amazon-ai-ops/desktop run build:renderer
```

---

## Phase 4: DeepSeek AI 深度接入

**目标:** AI 不再只是解释文案，而是参与产品阶段判断、动态阈值和建议生成。

### Task 4.1: AI 设置状态持久化

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/renderer/pages/settings-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/recommendations-page.tsx`
- Test: `scripts/smoke-business-ui-ad-execution.js`

- [ ] 保存设置后显示“已配置，待测试”。
- [ ] 测试成功后持久化：状态、模型、base URL、测试时间。
- [ ] 切换页面后仍显示“AI 可用”。
- [ ] API Key 不在界面、日志、证据包中明文显示。

Incremental verification:

```powershell
node scripts\smoke-business-ui-ad-execution.js
```

### Task 4.2: AI 广告策略诊断

**Files:**
- Create/Modify: `packages/ai-adapter/src/ad-strategy-diagnosis.ts`
- Create/Modify: `packages/rules-engine/src/ad-decision-merger.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/renderer/pages/recommendations-page.tsx`
- Test: `packages/ai-adapter/test/ad-strategy-diagnosis.test.ts`

- [ ] AI 输入必须包含真实日粒度广告数据、运营事件、规则阈值、历史趋势。
- [ ] AI 输出结构化 JSON：阶段、动态阈值、异常原因、建议动作、证据引用、复核建议。
- [ ] 规则和 AI 合并后展示：一致、冲突、AI-only、rule-only。
- [ ] AI 失败时规则仍可生成建议，但页面明确标记“AI 未参与”。

Incremental verification:

```powershell
pnpm exec vitest run packages/ai-adapter/test/ad-strategy-diagnosis.test.ts
pnpm --filter @amazon-ai-ops/desktop run typecheck
```

---

## Phase 5: UI 按业务后台重构

**目标:** 根据用户确认的方案 C 和 Stitch/设计稿方向，把界面从审计工具改成运营后台。

### Task 5.1: 全局 Shell 和 Scope Bar

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify/Create: `apps/desktop/src/renderer/components/app-shell.tsx`
- Modify/Create: `apps/desktop/src/renderer/components/scope-bar.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] 左侧菜单按业务流拆分。
- [ ] 顶部范围显示：日期、店铺、站点、USD、数据状态。
- [ ] 批次 ID 默认收起进“数据详情”，主界面不直接堆长 ID。
- [ ] 所有金额显示 USD 或 `$`，不显示 `￥`。

Incremental verification:

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:renderer
node scripts\smoke-business-ui-data-pipeline.js
```

### Task 5.2: 数据采集页重构

**Files:**
- Modify: `apps/desktop/src/renderer/pages/data-collection-page.tsx`

- [ ] 页面分区：当前范围、报表选择、领星动作、真实文件结果、导入结果、下一步。
- [ ] 按钮主次明确，下载状态必须展示“正在打开下载中心 / 找 ready 行 / 下载文件 / 校验文件 / 导入 DB”。
- [ ] 结果中心展示真实文件路径，并提供“打开文件夹”。
- [ ] 没有真实文件时，下一步明确为“重新下载或导入本地报表”。

Incremental verification:

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:renderer
```

### Task 5.3: 仪表盘升级

**Files:**
- Modify: `apps/desktop/src/renderer/pages/dashboard-page.tsx`

- [ ] 展示：数据健康、今日风险、待审批、AI 状态、执行回读、关键词/Listing 状态。
- [ ] 仪表盘不展示交付审计缺失命令。
- [ ] 每个卡片有明确动作入口。

Incremental verification:

```powershell
node scripts\smoke-business-ui-data-pipeline.js
```

### Task 5.4: 优化建议页重构

**Files:**
- Modify: `apps/desktop/src/renderer/pages/recommendations-page.tsx`

- [ ] 顶部显示建议范围和真实数据行数。
- [ ] 显示 AI 状态、规则状态、运营事件数量。
- [ ] 表格展示：广告组合、campaign、ad group、ASIN、keyword/search term/target、当前值、建议值、证据、AI/规则一致性、风险、操作。
- [ ] 点击建议进入详情，不把所有证据堆在主表。

Incremental verification:

```powershell
node scripts\smoke-business-ui-ad-execution.js
```

### Task 5.5: 交付验收隔离

**Files:**
- Modify: `apps/desktop/src/renderer/pages/delivery-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/dashboard-page.tsx`

- [ ] 日常业务页不显示 manifest 命令、最终 readiness 缺失项。
- [ ] 交付验收页集中展示 READY 状态、证据包、安装包、hash、最终测试矩阵。

Incremental verification:

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:renderer
```

---

## Phase 6: 安全审批和真实执行回读

**目标:** 广告动作不批量误写；每个动作都能绑定对象、审批、截图、before/after/readback。

### Task 6.1: 审批中心

**Files:**
- Modify/Create: `apps/desktop/src/renderer/pages/approval-page.tsx`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `packages/shared-types/src/action.ts`

- [ ] 只有 AI+规则一致且低风险建议可进入快速审批。
- [ ] 冲突建议、高风险建议、AI-only 建议必须人工复核。
- [ ] 审批记录包含：审批人、审批时间、范围、动作、原因、证据。

Incremental verification:

```powershell
pnpm --filter @amazon-ai-ops/desktop run typecheck
```

### Task 6.2: 执行回读泛化

**Files:**
- Modify/Create: `apps/desktop/src/renderer/pages/readback-page.tsx`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `packages/ads-execution/src/*`
- Test: `scripts/smoke-business-ui-ad-execution.js`

- [ ] 执行动作必须绑定：store、site、campaign、ad group、对象类型、对象名、动作类型。
- [ ] before 截图、before value、执行时间、after 截图、after value、readback 结果都必填。
- [ ] 暂停广告样本可作为低风险样例，但实现必须适配任意 ASIN/campaign/ad group/target，不硬编码单个广告。

Incremental verification:

```powershell
node scripts\smoke-business-ui-ad-execution.js
```

---

## Phase 7: 关键词和 Listing

**目标:** 关键词机会和 Listing 草稿基于真实数据和 AI，不再像孤立页面。

### Task 7.1: 关键词机会

**Files:**
- Modify: `apps/desktop/src/renderer/pages/keyword-opportunities-page.tsx`
- Modify: `packages/local-db/src/sqlite/repositories/ad-metrics-repo.ts`

- [ ] 关键词机会显示 campaign、ad group、ASIN、搜索词/关键词、花费、订单、销售、转化。
- [ ] 不把多个 campaign/ad group 合并成一行导致上下文丢失。
- [ ] 来源列不作为主列；来源进入详情。

Incremental verification:

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:renderer
```

### Task 7.2: Listing 优化

**Files:**
- Modify: `apps/desktop/src/main/listing-lingxing-extractor.ts`
- Modify: `apps/desktop/src/renderer/pages/listing-optimization-page.tsx`
- Modify/Create: `packages/ai-adapter/src/listing-draft.ts`
- Test: `apps/desktop/test/listing-lingxing-extractor.test.ts`

- [ ] 从领星 Listing 页面读取 ASIN、标题、五点、描述、后台词。
- [ ] 校验当前页面 ASIN 和当前业务范围 ASIN 是否一致。
- [ ] AI 草稿输出标题、五点、描述、后台词，保留关键词覆盖证据。
- [ ] 不提交 Amazon Listing，只本地生成草稿和复制内容。

Incremental verification:

```powershell
pnpm exec vitest run apps/desktop/test/listing-lingxing-extractor.test.ts
```

---

## Phase 8: 最终验收、安装包和交付

**目标:** 最终才跑全量测试和 Windows 打包；产出可验证的免安装/安装包和证据。

### Task 8.1: 最终全量验证

Run:

```powershell
node scripts/run-tests.js
pnpm -r run typecheck
pnpm --filter @amazon-ai-ops/desktop run build:renderer
```

Expected:

```text
全部通过；失败则回到对应阶段修复，只跑相关增量测试后再回最终门。
```

### Task 8.2: Windows 构建

Run:

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:win
```

Expected artifacts:

```text
apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe
apps/desktop/release/AmazonAIOpsAgent-*.exe
```

### Task 8.3: Hash 和证据

Run:

```powershell
Get-FileHash apps\desktop\release\AmazonAIOpsAgent-*.exe -Algorithm SHA256
Get-ChildItem apps\desktop\release\win-unpacked\AmazonAIOpsAgent.exe
```

Expected:

```text
记录 exe 路径、大小、SHA-256、构建时间。
```

### Task 8.4: 交付证据包

**Files:**
- Modify: `project-docs/amazon-ai-ops-acceptance-checklist.md`
- Modify: `project-docs/amazon-ai-ops-delivery-evidence-2026-05-26.md`
- Modify: `project-tasks/amazon-ai-ops-deliverable-tasklist.md`

- [ ] 记录真实 8 报表文件路径、导入摘要、DB 汇总 SQL、UI 截图、AI 测试、广告 readback。
- [ ] READY 只能在真实数据、AI、Listing、执行回读、全量测试、安装包 hash 全部通过后标记。

---

## 5. 增量测试策略

开发阶段只跑当前改动相关测试：

```powershell
pnpm exec vitest run <specific-test-file>
pnpm --filter @amazon-ai-ops/desktop run typecheck
pnpm --filter @amazon-ai-ops/desktop run build:renderer
node scripts\<specific-smoke>.js
```

最终节点才跑：

```powershell
node scripts/run-tests.js
pnpm -r run typecheck
pnpm --filter @amazon-ai-ops/desktop run build:win
```

---

## 6. 当前优先级顺序

1. 修复真实报表下载/导入闭环：必须能看到真实 XLSX/CSV。
2. 修复数据口径：禁止混加不同 report grain。
3. 完成每日广告事实和广告量化。
4. 接入运营事件。
5. 完成 DeepSeek AI 深度诊断和 AI+规则合并。
6. 按业务流重构 UI。
7. 完成审批和执行回读泛化。
8. 完成关键词/Listing AI 工作流。
9. 最终全量测试、打包、hash、证据包。

---

## 7. READY 判定

只有以下全部满足，才能标记 `APP_READY`：

- 真实领星 8 类广告 XLSX/CSV 文件存在，且不是审计 JSON/截图。
- DB 中存在当前范围每日广告事实。
- UI 显示的销售、花费、订单与真实报表/DB 汇总一致。
- 广告量化能输出阶段和阈值。
- DeepSeek AI 测试状态持久化，且 AI 参与建议生成。
- 运营事件能进入 AI/规则上下文。
- 优化建议展示 AI+规则一致性、证据、风险和动作对象。
- 审批和执行回读支持非硬编码广告对象。
- Listing 读取和 AI 草稿可用。
- 日常业务页不混入最终交付审计命令。
- 最终全量测试、typecheck、Windows build 通过。
- 安装包路径、大小、SHA-256、证据包已记录。
