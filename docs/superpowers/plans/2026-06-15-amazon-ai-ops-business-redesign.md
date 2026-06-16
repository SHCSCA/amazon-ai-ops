# Amazon AI Ops Business Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前 Amazon AI Ops 从“审计按钮集合”重构成围绕真实领星广告数据、每日量化、AI+规则分析、运营事件、建议审批、执行回读和交付证据闭环的可用后台。

**Architecture:** 数据链路优先：领星真实 8 类报表 -> 文件登记与导入 -> DB 日粒度事实表 -> 规则量化与 AI 诊断并行 -> 合并建议 -> 人工审批 -> 单动作执行与 readback。UI 按运营工作流拆分菜单，顶部只保留清晰的当前业务范围，不把所有任务塞进一个工作台。

**Tech Stack:** Electron + React + TypeScript, SQLite local-db, Lingxing Playwright collector, rules-engine, ai-adapter DeepSeek/OpenAI compatible, vitest, pnpm, Windows electron-builder.

---

## Current Problems To Fix

1. 真实数据链路不可信：界面显示“已下载/已创建”，但导出的目录只有审计 JSON/HTML/截图，没有真实 XLSX/CSV 广告表格，导致后续建议和 AI 分析无数据基础。
2. 按钮语义混乱：“下载已创建的已选报表”和“重新创建并下载已选报表”视觉和反馈接近，点击后用户不知道是否真的发生了领星下载动作。
3. 报表口径混合：campaign、ad_group、placement、advertised_product、keyword、target、search_term 等不同粒度不能直接相加，否则销售额、花费、订单会膨胀。
4. AI 接入不够深：当前更像规则生成后附加解释，缺少 AI 对产品阶段、广告生命周期、运营事件、阈值建议的并行判断。
5. AI 设置状态不持久：测试成功后切换页面又显示“待测试”，会让用户以为配置失效。
6. 菜单和页面职责不清：v1.5 工作台内嵌工作台、审计信息和操作按钮堆叠，后台用户不知道下一步做什么。
7. 仪表盘太弱：没有围绕“今天应该看什么、做什么、风险在哪里、数据是否可用”设计。
8. 工作范围不清：日期、店铺、站点、批次、币种、数据来源的作用没有解释，也不知道在哪里设置。
9. 运营上下文缺失：活动、折扣、BD、大促、调价、断货、Listing 修改等事件没有进入广告分析，所以 AI 和规则无法解释异常波动。
10. 交付验收和日常业务混在一起：用户日常操作不应看到大量审计命令、manifest、缺失项列表；这些应进入“交付验收/诊断”页。

---

## Target Menu Structure

左侧菜单按真实业务流拆分：

1. **运营总览**
   - 仪表盘
   - 今日待办
2. **数据中心**
   - 数据采集
   - 导入历史
   - 数据质量
3. **广告量化**
   - 产品广告档案
   - 每日量化分析
   - 阈值与策略
4. **广告优化**
   - 优化建议
   - 审批复核
   - 执行与回读
5. **关键词与 Listing**
   - 关键词机会
   - Listing 优化
6. **运营事件**
   - 活动/折扣/BD/大促
   - 备注与异常
7. **系统与交付**
   - AI 设置
   - 交付验收
   - 诊断包

全局顶部保留一个明确的 **当前业务范围**：日期范围、店铺、站点、币种 USD、数据批次。只显示用户能理解的业务含义；批次 ID 默认收起到详情中。

---

## File Structure

### Data Model And Import

- Modify: `packages/shared-types/src/ad.ts`
  - 明确广告事实数据字段币种为 USD。
  - 增加 `ReportGrain`、`ReportFileStatus`、`DailyAdFact` 等共享类型。

- Create/Modify: `packages/local-db/src/sqlite/ad-metric-grain.ts`
  - 统一定义 `canonical`、`actionable`、`breakdown`、`all` 四种广告报表口径。
  - 禁止各模块重复写 report_type 过滤 SQL。

- Modify: `packages/local-db/src/sqlite/db.ts`
  - 确保 `report_files`、`ad_daily_metrics`、`operation_events`、`ai_connection_status` 必需字段存在。
  - 对 `scope + batch + report_type + date + campaign + ad_group + target` 建索引。

- Modify: `packages/local-db/src/sqlite/repositories/report-file-repo.ts`
  - 登记真实下载文件、文件大小、hash、来源、报表类型、导入行数、错误。

- Modify: `packages/local-db/src/sqlite/repositories/ad-metrics-repo.ts`
  - 查询时明确 `canonical` 或 `actionable`。
  - 全局总计只用单一权威报表口径，不跨粒度相加。

- Create/Modify: `scripts/import_lingxing_batch_metrics.py`
  - 导入真实下载目录中的 XLSX/CSV。
  - 输出导入摘要 JSON：8 类报表是否存在、每类行数、日期范围、总花费、订单、销售额。

### Lingxing Collector

- Modify: `packages/lingxing-report-collector/src/download-center-page.ts`
  - 区分“已创建 ready 行下载”和“重新创建任务后下载”。
  - 只有检测到真实文件落盘才返回 downloaded。
  - 如果下载中心没有 ready 行，返回明确错误和截图/DOM 证据。

- Modify: `packages/lingxing-report-collector/src/batch-runner.ts`
  - 每个报表的状态使用 `created | ready | downloading | downloaded | imported | failed`。
  - 每个阶段写入 manifest，不把审计文件当作真实报表。

- Modify: `packages/lingxing-report-collector/src/batch-runner.test.ts`
  - 覆盖“已创建直接下载”“重新创建再下载”“无 ready 行失败”“真实文件缺失失败”。

### AI And Quantification

- Modify: `packages/rules-engine/src/quantification.ts`
  - 按产品推广阶段输出量化状态：冷启动、测词、放量、稳定、防守、异常。
  - 输出建议阈值：目标 ACOS、止损花费、无订单点击阈值、加价比例、降价比例。

- Modify: `packages/ai-adapter/src/ad-strategy-diagnosis.ts`
  - AI 输入包含：每日广告事实、运营事件、产品阶段、历史趋势、当前规则阈值。
  - AI 输出独立判断：阶段、阈值建议、异常解释、建议动作、是否需要人工复核。

- Modify: `packages/rules-engine/src/ad-decision-merger.ts`
  - 合并规则和 AI：一致则生成可审批建议；冲突、AI-only、规则-only 高风险进入复核。

- Modify: `apps/desktop/src/main/ad-recommendation-ai-context.ts`
  - 用真实日粒度数据构建 AI 上下文。
  - 不允许无真实报表时生成“看似成功”的建议。

### Operation Events

- Modify: `packages/shared-types/src/operation-event.ts`
  - 支持 store、marketplace、ASIN、campaign、adGroup、eventType、date、impact、note。

- Modify: `packages/local-db/src/sqlite/repositories/operation-event-repo.ts`
  - 支持按日期范围和广告对象查询事件。

- Modify: `apps/desktop/src/renderer/pages/operation-events-page.tsx`
  - 运营可录入：折扣、BD、大促、Coupon、调价、库存、Listing 修改、预算调整。

### Desktop Main IPC

- Modify: `apps/desktop/src/main/index.ts`
  - `business:get-scope` / `business:save-scope`：持久化当前业务范围。
  - `reports:download-existing`：只下载 ready 行。
  - `reports:recreate-and-download`：重新创建任务后下载。
  - `reports:import-batch`：导入真实文件到 DB。
  - `business:get-quant-summary`：返回可加总口径总览和 actionable 明细。
  - `recommendations:generate`：必须基于已导入真实数据。
  - `settings:test-ai`：测试结果持久化。

- Modify: `apps/desktop/src/preload/index.ts`
  - 暴露以上 IPC，保持 renderer 不直接访问 Node API。

### Renderer UI

- Modify: `apps/desktop/src/renderer/App.tsx`
  - 移除 v1.5 工作台式入口。
  - 左侧菜单按目标结构拆分。

- Modify/Create: `apps/desktop/src/renderer/components/scope-bar.tsx`
  - 顶部显示“当前范围：2026-06-01 至 2026-06-12 / FT-US-US / US / USD”。
  - 批次 ID 放到“数据详情”弹层。

- Create/Modify: `apps/desktop/src/renderer/pages/dashboard-page.tsx`
  - 展示数据可用性、今日风险、AI 状态、待审批建议、执行回读状态。

- Modify: `apps/desktop/src/renderer/pages/data-collection-page.tsx`
  - 分区：范围、报表选择、领星动作、下载结果、导入结果、下一步。
  - 三个按钮文案和行为必须不同：
    - `下载已创建报表`
    - `重新创建并下载`
    - `导入本地报表`

- Modify: `apps/desktop/src/renderer/pages/quantification-page.tsx`
  - 展示产品/ASIN 维度广告阶段、阈值建议、趋势和异常。

- Modify: `apps/desktop/src/renderer/pages/recommendations-page.tsx`
  - 展示规则建议、AI 建议、合并结果、冲突原因、证据。

- Modify: `apps/desktop/src/renderer/pages/approval-page.tsx`
  - AI-only、规则冲突、高风险建议只能进入复核，不能直接批准。

- Modify: `apps/desktop/src/renderer/pages/ad-execution-page.tsx`
  - 真实执行必须单动作、绑定店铺/站点/campaign/ad group/对象/before/after/readback。

- Modify: `apps/desktop/src/renderer/pages/settings-page.tsx`
  - AI 测试状态持久化，显示最后测试时间、模型、错误。

- Modify: `apps/desktop/src/renderer/styles.css`
  - 按 Stitch 设计稿重建后台视觉语言：清晰层级、低噪声卡片、表格可读、按钮主次明确。

---

## Phase 1: Stabilize Real Data Collection

**Objective:** 用户点击下载后必须真的得到领星广告表格；没有表格时系统必须明确阻断，不允许进入建议生成。

### Task 1.1: Split Download Button Semantics

**Files:**
- Modify: `apps/desktop/src/renderer/pages/data-collection-page.tsx`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `packages/lingxing-report-collector/src/batch-runner.ts`
- Test: `packages/lingxing-report-collector/src/batch-runner.test.ts`

- [ ] 将按钮改成三个明确动作：`下载已创建报表`、`重新创建并下载`、`导入本地报表`。
- [ ] `下载已创建报表` 只查找当前范围已有 ready 行并下载。
- [ ] `重新创建并下载` 必须先创建任务，再轮询 ready，再下载。
- [ ] 下载成功条件改为：目标目录存在真实 XLSX/CSV，文件大小大于 0，且 manifest 记录该文件。
- [ ] 如果只产生审计 JSON/HTML/截图，不得显示“下载完成”。
- [ ] 增量测试：

```powershell
pnpm exec vitest run packages/lingxing-report-collector/src/batch-runner.test.ts
```

Expected: 覆盖 ready 下载、重新创建、无文件失败。

### Task 1.2: Register Real Report Files

**Files:**
- Modify: `packages/local-db/src/sqlite/db.ts`
- Modify: `packages/local-db/src/sqlite/repositories/report-file-repo.ts`
- Test: `packages/local-db/src/sqlite/repositories/report-file-repo.test.ts`

- [ ] `report_files` 记录 `batch_id`、`scope`、`report_type`、`file_path`、`file_size`、`sha256`、`downloaded_at`、`imported_at`、`row_count`、`status`。
- [ ] 文件登记失败时返回用户可读错误：缺文件、空文件、报表类型无法识别、日期不匹配。
- [ ] 增量测试：

```powershell
pnpm exec vitest run packages/local-db/src/sqlite/repositories/report-file-repo.test.ts
pnpm --filter @amazon-ai-ops/local-db run typecheck
```

### Task 1.3: Import Downloaded Reports Into Daily Facts

**Files:**
- Modify: `scripts/import_lingxing_batch_metrics.py`
- Modify: `apps/desktop/src/main/index.ts`
- Test: add targeted import fixture tests if fixtures exist; otherwise add smoke script under `scripts/`.

- [ ] 导入当前 batch 下 8 类真实文件。
- [ ] 每行写入 `ad_daily_metrics`，保留 `date`、store、site、currency USD、campaign、ad group、portfolio、ASIN、keyword/search term/target、report_type、source_file、source_row。
- [ ] 导入完成后返回：每类文件行数、总导入行数、日期范围、发现的币种。
- [ ] 没有真实文件时，建议生成、量化分析、仪表盘广告数据全部显示“缺少真实报表”，不能显示 0 当作真实结果。

---

## Phase 2: Fix Report Grain And Data Truth

**Objective:** 系统必须知道哪些数据可以加总，哪些只能做分解展示，避免花费/销售/订单膨胀。

### Task 2.1: Create Shared Report Grain Helper

**Files:**
- Create: `packages/local-db/src/sqlite/ad-metric-grain.ts`
- Test: `packages/local-db/src/sqlite/ad-metric-grain.test.ts`
- Modify: `packages/local-db/src/index.ts`

- [ ] 定义四种口径：
  - `canonical`: 全局总计，只选一个权威报表。
  - `actionable`: keyword、product_targeting、auto_targeting、search_term，用于建议。
  - `breakdown`: campaign、ad_group、placement、advertised_product，只用于分解展示。
  - `all`: 文件导入完整性统计。
- [ ] canonical 优先级：
  - 有 `user_search_term` 用它做搜索词层真实消费总览。
  - 否则用 `search_term`。
  - 否则用 `keyword + product_targeting + auto_targeting` 分组展示，但全局总额标注为“近似，不可与 campaign 报表相加”。
- [ ] 增量测试：

```powershell
pnpm exec vitest run packages/local-db/src/sqlite/ad-metric-grain.test.ts
```

### Task 2.2: Apply Grain Helper To Existing Queries

**Files:**
- Modify: `packages/local-db/src/sqlite/repositories/ad-metrics-repo.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Test: `packages/local-db/src/sqlite/repositories/ad-metrics-repo.test.ts`

- [ ] `getSummary()` 使用 canonical。
- [ ] `findForRecommendations()` 使用 actionable。
- [ ] `countImportedRowsForFile()` 使用 all，不再因为 report_type 被过滤而显示 0。
- [ ] `loadBusinessQuantSummary()` 返回：
  - `totalCostUsd`
  - `totalSalesUsd`
  - `totalOrders`
  - `canonicalRows`
  - `actionableRows`
  - `breakdownRows`
  - `summaryGrain`
  - `grainWarning`
- [ ] 增量测试：

```powershell
pnpm exec vitest run packages/local-db/src/sqlite/repositories/ad-metrics-repo.test.ts
pnpm --filter @amazon-ai-ops/local-db run typecheck
pnpm --filter @amazon-ai-ops/desktop run typecheck
```

---

## Phase 3: Build AI + Rules Parallel Quantification

**Objective:** AI 不是事后解释器，而是和规则并行分析广告阶段、阈值和策略，再合并成可审批建议。

### Task 3.1: Daily Product Advertising Timeline

**Files:**
- Modify: `packages/rules-engine/src/quantification.ts`
- Test: `packages/rules-engine/src/quantification.test.ts`

- [ ] 以 ASIN/campaign/ad group/object 生成每日序列。
- [ ] 识别阶段：冷启动、测词、放量、稳定、防守、异常。
- [ ] 输出每个对象的量化标签：`healthy | watch | waste | scale | blocked`。
- [ ] 输出可解释阈值：目标 ACOS、止损花费、无订单点击、加价比例、降价比例。
- [ ] 增量测试：

```powershell
pnpm exec vitest run packages/rules-engine/src/quantification.test.ts
pnpm --filter @amazon-ai-ops/rules-engine run typecheck
```

### Task 3.2: Operation Events As First-Class AI Context

**Files:**
- Modify: `packages/shared-types/src/operation-event.ts`
- Modify: `packages/local-db/src/sqlite/repositories/operation-event-repo.ts`
- Modify: `apps/desktop/src/renderer/pages/operation-events-page.tsx`
- Test: `packages/local-db/src/sqlite/repositories/operation-event-repo.test.ts`

- [ ] 运营可录入事件：
  - coupon/折扣
  - BD/LD/大促
  - 预算调整
  - 出价调整
  - Listing 修改
  - 价格变化
  - 库存异常
  - 外部流量
- [ ] 事件可绑定 ASIN、campaign、ad group、日期范围。
- [ ] AI 分析时把事件合并进对应广告对象上下文。

### Task 3.3: AI Strategy Diagnosis

**Files:**
- Modify: `packages/ai-adapter/src/ad-strategy-diagnosis.ts`
- Modify: `apps/desktop/src/main/ad-recommendation-ai-context.ts`
- Test: `packages/ai-adapter/src/ad-strategy-diagnosis.test.ts`
- Test: `apps/desktop/src/main/ad-recommendation-ai-context.test.ts`

- [ ] AI 输入必须包含：
  - 当前范围和币种 USD。
  - 每日广告数据序列。
  - 规则量化结果。
  - 运营事件。
  - 当前阈值配置。
  - 产品推广阶段。
- [ ] AI 输出必须结构化：
  - `stage`
  - `thresholdSuggestion`
  - `recommendedAction`
  - `evidence`
  - `risk`
  - `requiresReview`
  - `reason`
- [ ] 无 API key 时降级为规则建议，但 UI 明确标注“AI 未参与”。
- [ ] API 测试通过后状态持久化，切换页面不丢失。

### Task 3.4: Merge AI And Rule Decisions

**Files:**
- Modify: `packages/rules-engine/src/ad-decision-merger.ts`
- Modify: `packages/rules-engine/src/recommendation.ts`
- Test: `packages/rules-engine/src/ad-decision-merger.test.ts`
- Test: `packages/rules-engine/src/recommendation.test.ts`

- [ ] 规则与 AI 一致：生成 `pending` 建议。
- [ ] AI-only：生成 `needs_review`。
- [ ] 规则与 AI 冲突：生成 `needs_review` 并展示冲突原因。
- [ ] 高风险动作：只能复核，不能直接批准。

---

## Phase 4: Redesign UI From Business Flow

**Objective:** 用 Stitch 设计稿和实际运营路径重建后台，而不是继续堆按钮和审计字段。

### Task 4.1: Confirm Stitch Design Source

**Files:**
- Read/Update: `docs/design/*`
- Update: `docs/design/ui-redesign-implementation-notes.md`

- [ ] 检查 MCP 配置是否有 Stitch。
- [ ] 调用 Stitch 生成或读取完整后台设计稿。
- [ ] 抽取设计规则：侧边栏、顶部范围、卡片密度、表格、状态标签、按钮主次。
- [ ] 把设计稿落成 implementation notes，供开发对照。

### Task 4.2: Rebuild App Shell And Navigation

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: `apps/desktop/src/renderer/components/scope-bar.tsx`

- [ ] 移除“v1.5 工作台”作为单独菜单。
- [ ] 实现目标菜单结构。
- [ ] 顶部范围清楚展示日期、店铺、站点、USD；批次 ID 收起。
- [ ] 页面标题区只说明当前页面任务，不展示审计命令。

### Task 4.3: Dashboard Redesign

**Files:**
- Modify/Create: `apps/desktop/src/renderer/pages/dashboard-page.tsx`

- [ ] 仪表盘展示：
  - 当前范围是否有真实数据。
  - 广告销售、广告花费、ACOS、订单、点击。
  - AI 状态。
  - 待复核建议数。
  - 今日最重要风险。
  - 下一步操作。
- [ ] 如果没有真实数据，仪表盘主行动是“去数据采集”，不是显示一堆 0。

### Task 4.4: Data Collection Page UX

**Files:**
- Modify: `apps/desktop/src/renderer/pages/data-collection-page.tsx`

- [ ] 报表选择区显示每类状态：
  - 未创建
  - 已创建待下载
  - 已下载未导入
  - 已导入
  - 失败
- [ ] 用户点击下载后显示真实进度：
  - 正在查找 ready 行
  - 正在下载
  - 文件已落盘
  - 正在导入
  - 导入完成
- [ ] “结果中心”显示真实文件列表，而不是只显示审计包。

### Task 4.5: Quantification Page UX

**Files:**
- Modify/Create: `apps/desktop/src/renderer/pages/quantification-page.tsx`

- [ ] 按 ASIN/产品展示广告阶段。
- [ ] 展示当前阈值和 AI 建议阈值。
- [ ] 展示运营事件对趋势的解释。
- [ ] 展示“为什么建议调整/暂停/否词/加价”。

### Task 4.6: Recommendation And Approval UX

**Files:**
- Modify: `apps/desktop/src/renderer/pages/recommendations-page.tsx`
- Modify: `apps/desktop/src/renderer/pages/approval-page.tsx`

- [ ] 建议列表必须显示：
  - portfolio
  - campaign
  - ad group
  - ASIN/product
  - keyword/search term/target
  - 当前值
  - 建议值
  - ACOS/spend/orders/sales USD
  - 规则证据
  - AI 判断
  - 合并结论
- [ ] 复核页明确区分：
  - 可审批
  - AI 复核
  - 冲突复核
  - 已批准
  - 已拒绝

### Task 4.7: Settings UX Fix

**Files:**
- Modify: `apps/desktop/src/renderer/pages/settings-page.tsx`
- Modify: `apps/desktop/src/main/index.ts`

- [ ] AI 设置保存后保持“已配置”。
- [ ] 测试成功后保存 `lastTestedAt`、model、baseUrl、status。
- [ ] 切换页面后仍显示“可用”，除非配置变更。
- [ ] API Key 不写入日志、证据包或交付包。

---

## Phase 5: Safe Execution And Readback

**Objective:** 广告动作可以适配任意店铺、产品、campaign、ad group 和对象，但必须单动作、可回读、可审计。

### Task 5.1: Generalize Execution Target

**Files:**
- Modify: `apps/desktop/src/main/ad-readback-evidence.ts`
- Modify: `apps/desktop/src/main/ad-readback-evidence.test.ts`
- Modify: `apps/desktop/src/renderer/pages/ad-execution-page.tsx`

- [ ] 执行目标字段必须包含：
  - store
  - marketplace
  - portfolio
  - campaign
  - ad group
  - object type
  - object name/id
  - action type
  - before value
  - after value
- [ ] 不允许只绑定一个样例广告或 ASIN。
- [ ] 执行前必须有人工批准证据。

### Task 5.2: Readback Evidence

**Files:**
- Modify: `apps/desktop/src/main/ad-readback-evidence.ts`
- Test: `apps/desktop/src/main/ad-readback-evidence.test.ts`

- [ ] 每次真实动作生成：
  - before screenshot
  - after screenshot
  - readback screenshot
  - field value before/after/readback
  - operator
  - timestamp
  - action id
- [ ] readback 值不一致时，不能标记成功。

---

## Phase 6: Delivery And Verification

**Objective:** 最终交付一个免安装 exe，并有证据证明数据、AI、规则、UI、执行和验收闭环可用。

### Task 6.1: Incremental Verification During Development

**Policy:** 开发阶段只跑被改动模块的增量测试；不反复跑全量测试。

Common commands:

```powershell
pnpm exec vitest run <changed-test-file>
pnpm --filter @amazon-ai-ops/<package> run typecheck
git diff --check -- <changed-files>
```

### Task 6.2: Product Smoke Verification

**Files:**
- Update/Create: `scripts/smoke-business-ui-data-pipeline.js`
- Update/Create: `scripts/smoke-business-ui-shell.js`
- Update/Create: `scripts/smoke-business-ui-settings-delivery.js`

- [ ] 启动桌面应用。
- [ ] 验证菜单拆分。
- [ ] 验证当前业务范围持久化。
- [ ] 验证无真实数据时建议生成被阻断。
- [ ] 验证真实文件导入后仪表盘、量化、建议页面有数据。
- [ ] 验证 AI 测试状态持久化。

### Task 6.3: Final Full Verification

Only at final node:

```powershell
node scripts/run-tests.js
pnpm -r run typecheck
pnpm --filter @amazon-ai-ops/desktop run build:win
Get-FileHash apps/desktop/release/AmazonAIOpsAgent-1.2.0.exe -Algorithm SHA256
```

Expected:
- 全量测试通过。
- 全仓 typecheck 通过。
- Windows 免安装 exe 生成。
- 输出 hash、size、路径。

### Task 6.4: Final Evidence Package

**Files:**
- Update: `project-docs/amazon-ai-ops-acceptance-checklist.md`
- Update: `project-docs/amazon-ai-ops-delivery-evidence-2026-06-15.md`
- Update: `project-tasks/amazon-ai-ops-deliverable-tasklist.md`

- [ ] 记录真实 8 类报表文件路径和 hash。
- [ ] 记录 DB 汇总 SQL 和结果。
- [ ] 记录 UI 截图：数据采集、仪表盘、量化、建议、AI 设置、交付验收。
- [ ] 记录 AI 测试不含 API key 的脱敏证据。
- [ ] 记录最终 exe 路径、hash、大小。

---

## Acceptance Criteria

1. 用户在数据采集页能明确知道当前范围需要哪些报表、哪些已创建、哪些已下载、哪些已导入。
2. “下载已创建报表”必须真的下载已有 ready 报表；没有文件时不能显示成功。
3. 结果中心必须能打开真实 XLSX/CSV 文件目录。
4. DB 中能按日期保留广告从第一天开始的每日数据。
5. 全局总计不跨报表粒度混加；可加总口径和分解口径在 UI 中明确。
6. AI 和规则并行参与建议生成，AI 能分析产品阶段、运营事件和阈值。
7. 无 AI key 或 AI 测试失败时，系统明确显示“仅规则分析”。
8. AI 测试成功后状态持久化，切换页面不回到“待测试”。
9. 建议列表必须展示 portfolio、campaign、ad group、产品、keyword/search term/target、当前值、建议值、USD 指标和证据。
10. 冲突建议、高风险建议、AI-only 建议不能直接批准。
11. 广告执行适配任意广告对象，不绑定单一样例。
12. 真实执行必须有 before/after/readback 证据。
13. 后台 UI 不再使用“一个工作台承载所有任务”的结构。
14. 交付验收和日常运营页面分离。
15. 最终提供免安装 exe、hash、测试结果和交付证据包。

---

## Execution Order

1. Phase 1: 真实下载与导入链路。
2. Phase 2: 报表口径和 DB 数据可信。
3. Phase 3: AI+规则并行量化。
4. Phase 4: 按 Stitch 设计稿重构 UI。
5. Phase 5: 广告执行和 readback 泛化。
6. Phase 6: 最终测试、打包、证据包。

This order is mandatory. UI 可以并行设计，但不能在真实数据链路未修复时继续声称业务闭环完成。

---

## Risk Register

1. **领星页面 DOM 变化**
   - Mitigation: 每次下载失败保留 screenshot、DOM、URL、action trace；selector 不猜测。

2. **下载中心已有任务但状态不 ready**
   - Mitigation: UI 显示“已创建待生成”，并提供“重新创建并下载”。

3. **真实文件名不含日期或报表类型**
   - Mitigation: 通过文件内容 header 识别报表类型，文件名只作辅助。

4. **广告报表口径冲突**
   - Mitigation: 所有总计必须走 `ad-metric-grain.ts`，禁止页面自己聚合。

5. **AI 输出不稳定**
   - Mitigation: AI 输出必须 JSON schema 校验；失败则保留规则建议并标注 AI 失败。

6. **API Key 泄漏**
   - Mitigation: 设置、日志、证据包、交付包全部脱敏。

7. **用户把审计包误认为数据包**
   - Mitigation: UI 文案区分“真实报表文件”和“诊断证据包”。

8. **测试耗时过长**
   - Mitigation: 开发中只跑增量测试；最终节点跑全量测试和 build。

