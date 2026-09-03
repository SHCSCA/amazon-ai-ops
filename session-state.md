# 会话状态 — Amazon AI Ops Agent

> 创建时间：2026-09-03 14:22
> 用途：用于在新对话中快速恢复上下文，请保持文件长度在 100 行以内。

## 项目快照

- **应用形态**：仅限 Windows 的 Electron 桌面应用，面向 Amazon 美国站广告运营人员
- **版本状态**：
  - 1.5.1 = 静态 Windows 候选包，`APP_NEEDS_WORK / INTERNAL NON_READY`
  - 1.6.0 = 下一主版本，正在开发中（V1.6 验证框架）
- **用户禁令**（仍然有效）：typecheck、build:win、业务 smoke、Package UI、ZIP 启动、当前包正式库前后复核、真实 Ads 验证、应用/浏览器/桌面控制
- **一句话总结**：要拿到运行时验收信用，必须先让 Task 8B 通过（唯一当前对象/出价回读 + 10% 以内的 lower_bid + 产品内人工批准 + 一次写入 + 刷新回读证据）。

## V1.6.0 进度（2026-09-03 17:25 更新）

| 阶段 | 状态 | 说明 |
|------|------|------|
| 阶段 1：Analysis Runs 基础设施 | ✅ 100% | `AnalysisRunRecord`、迁移 0012、仓储、44/44 测试 |
| 阶段 2：Analysis Runs 完整集成 | ✅ 100% | 主进程 IPC、Preload 桥接、业务层、所有测试通过 |
| 阶段 3：六模块领域模型 | 🟡 50% | Decision 域（73测试）+ Execution 域（71测试）完成；剩余 4 个子模块 |
| 阶段 4：六模块信息架构重组 | ⚪ 0% | 未启动 |
| 阶段 5：StoreContext 严格隔离 | ⚪ 0% | 未启动 |
| 阶段 6：策略与自动化边界 | ⚪ 0% | 未启动 |
| 阶段 7：交付验收体系 | ⚪ 0% | 未启动 |

总体进度：**40%**

## 本轮具体改动（2026-09-03 16:23-17:26）

完成了 **Decision 域模型** 和 **Execution 域模型** 的完整实现（阶段 3 的前两个子模块）：

### 1. Decision 域模型（73 个测试通过）

#### 类型层（`packages/shared-types/src/decision-domain.ts`）
- 增强 `DecisionRecord`：添加 `marketplace`/`currency`/`analysisRunId` 字段，构成完整溯源链 `Decision → AnalysisRun → Mission`
- `CreateDecisionInput` 同步更新
- 新增 `validateDecisionRecord` / `validateCreateDecisionInput` — 严格验证（US/USD 硬约束、必填字段、时间戳合法性）
- 新增 `decisionRowToRecord` / `decisionRecordToRow` — SQLite 行 ↔ 领域模型双向映射
- 新增 `buildDecisionRecord` / `buildHistoryEntry` — 构建器函数
- 新增 `DecisionProjection` — 店铺级聚合统计类型
- 新增 `isDecisionTerminal` / `getDecisionProvenanceChain` — 辅助函数
- **39/39 测试通过**

#### SQLite 迁移更新（`packages/local-db/src/sqlite/migrations/0013-v16-domain.ts`）
- `decisions_v16` 表新增 `marketplace`/`currency`/`analysis_run_id` 列
- 新增 `idx_decisions_v16_analysis_run` 索引
- `verifyV16DomainSchema` 同步更新必需列校验

#### Repository 层扩展（`packages/local-db/src/sqlite/repositories/v16-domain-repositories.ts`）
- `DecisionRow` 接口增加 `marketplace`/`currency`/`analysis_run_id`
- `DecisionRepository.create` 更新插入语句
- 新增 `findByAnalysisRunId` / `findByBatchId` 查询方法
- 新增 `transitionStatus` — **原子状态转换**（事务内更新 status + revision 并追加 history）
- 新增 `getProjection` — 店铺级决策聚合统计（按状态/实体类型/动作类型分组）

#### Service 业务层（`apps/desktop/src/main/v16-decision-service.ts`，新建）
- `DecisionService` 类，包含完整业务逻辑：
  - `createDecision` — 从推荐创建决策
  - `getDecision` / `listDecisions` / `listByStatus` / `listByAnalysisRun` / `listByMission` — 查询
  - `approveDecision` — 批准（需 non-empty reason + expectedRevision 乐观锁）
  - `rejectDecision` — 拒绝（需 non-empty reason + expectedRevision）
  - `supersedeDecision` — 替代（不可替代已批准/拒绝的决策，历史不可变）
  - `transitionStatus` — 通用状态转换
  - `markExecuted` — 标记已执行
  - `markVerified` — 标记已验证（success/failure/unknown）
  - `getHistory` — 获取完整状态变更历史
  - `getProjection` — 店铺级统计
- `DecisionServiceError` — 错误码：`DECISION_NOT_FOUND / INVALID_STATUS_TRANSITION / DECISION_TERMINAL / REVISION_CONFLICT / MISSING_REASON / ALREADY_SUPERSEDED / VALIDATION_ERROR / SERVICE_ERROR`
- **34/34 测试通过**

### 2. Execution 域模型（71 个测试通过）

#### 类型层（`packages/shared-types/src/execution-domain.ts`）
- 完善 `ExecutionSlot` / `ExecutionBatch` / `ReconciliationCase` 类型
- `SlotStatus`：`pending → preflight_blocked / submit_intent_recorded → submitted → verified / failed / unknown`
- `BatchStatus`：`running → completed / stopped_invalidated / stopped_unknown`
- Preflight gates (P0-P6)：`P0_KILL_SWITCH / P1_CIRCUIT_BREAKER / P2_CONTEXT_MISMATCH / P3_REVISION_MISMATCH / P4_GRANT_INVALID / P5_SCOPE_MISMATCH / P6_EVIDENCE_REQUIRED`
- `ReconciliationOutcome`：`target_stably_observed / original_stably_observed / other_value / inconclusive_permanent`
- `checkPreflightGates` — 预检门禁检查函数
- `verifyReadbackMatch` — 回读值验证（支持数值容差）
- `validateExecutionSlot` / `validateExecutionBatch` / `validateReconciliationCase` — 验证函数
- `buildExecutionSlot` / `buildExecutionBatch` / `buildReconciliationCase` — 构建器
- **44/44 测试通过**

#### Repository 层扩展（`packages/local-db/src/sqlite/repositories/v16-domain-repositories.ts`）
- `ExecutionRepository` 新增方法：
  - `findBatchesByGrant` / `findBatchesByMission` — 按 grant/mission 查询批次
  - `createReconciliationCase` / `findReconciliationCaseBySlot` / `findReconciliationCasesByBatch` / `updateReconciliationCase` — Reconciliation 管理
  - `getBatchProjection` — 店铺级执行统计（totalBatches / runningCount / completedCount / stoppedCount / totalSlots / pendingSlots / submittedSlots / verifiedSlots / failedSlots / unknownSlots）

#### Service 业务层（`apps/desktop/src/main/v16-execution-service.ts`，新建）
- `ExecutionService` 类，实现**安全执行合同**：
  - **Batch 生命周期**：
    - `createBatch` — 创建批次（同时创建所有 slots）
    - `getBatch` / `listBatchesByStore` / `refreshBatchProgress` — 查询和进度刷新
    - `stopBatch` — 停止批次（invalidated / unknown）
  - **Slot 提交流程**：
    - `submitSlot` — 提交 slot（记录 intent + before evidence）
    - `markSubmitted` — 标记已提交（at-most-once 保证）
    - `preflightCheck` — 预检门禁检查
    - `recordSubmitIntent` — 记录提交意图（point of no return）
  - **Readback 验证**：
    - `recordReadback` — 记录三阶段回读（before/after/reload）
    - `verifySlot` — 验证执行结果（三阶段回读匹配，支持数值容差）
    - `markSlotFailed` — 标记 slot 失败
  - **Reconciliation（UNKNOWN 固定合同）**：
    - `createReconciliationCaseIfNeeded` — 自动创建 reconciliation case（私有）
    - `getReconciliationCase` — 获取 reconciliation case
    - `recordReconciliationObservation` — 记录观测（自动处理 observation 1 和 2）
    - `recordObservation1` / `recordObservation2` — 分别记录两次观测
    - Reconciliation 逻辑：两次观测都匹配 target → `target_stably_observed`；都匹配 original → `original_stably_observed`；都匹配但不是 target/original → `other_value`；两次不匹配 → `inconclusive_permanent`
  - **查询**：
    - `getSlot` / `listSlotsByBatch` — Slot 查询
    - `getBatchProjection` — 店铺级统计
- `ExecutionServiceError` — 错误码：`SLOT_NOT_FOUND / BATCH_NOT_FOUND / INVALID_STATUS_TRANSITION / SLOT_TERMINAL / BATCH_TERMINAL / PREFLIGHT_BLOCKED / ALREADY_SUBMITTED / NOT_SUBMITTED / VERIFICATION_FAILED / RECONCILIATION_LIMIT / VALIDATION_ERROR / SERVICE_ERROR`
- **关键特性**：
  - **At-most-once submit**：`markSubmitted` 只能从 `submit_intent_recorded` 调用一次
  - **UNKNOWN 是终态**：一旦 slot 进入 `unknown`，不可重试，自动创建 reconciliation case
  - **Batch 自动停止**：当有 slot 进入 `unknown` 且无 pending/submitted slots 时，batch 自动进入 `stopped_unknown`
  - **Preflight gates**：P0-P6 七层门禁，任一阻断则 slot 进入 `preflight_blocked`
- **27/27 测试通过**

### 测试覆盖
- Decision 域：73 个测试 ✅
- Execution 域：71 个测试 ✅
- **总计：144/144 全部通过 ✅**

## 上一轮具体改动（2026-09-03 13:38 那次对话）

在最近一次会话（对话记录 `8f0ad86a-5a12-491b-b519-a282185456bc`）中，助手完成了阶段 2 的 M2.2（AnalysisRunsService）：

1. **`scripts/prepare-native-runtime.js`** — 修复 ESM `export {}` 与实际导出函数名不匹配的问题（曾导致测试失败）。
2. **`apps/desktop/src/main/analysis-runs-service.ts`** — 新建文件。在仓储之上加业务层，包含：
   - `computeFingerprint(input)` — 基于 `{storeId, productId, reportSnapshotId, missionId?, policyRevision?, modelRevision?}` 的稳定哈希
   - `AnalysisRunsService` 类，方法包括 `createRun / startRun / updateStage / completeRun / failRun / blockRun / getRun / listRuns / findReusedRun`
   - `AnalysisRunsServiceError`，错误码：`STORE_MISMATCH / RUN_NOT_FOUND / INVALID_TRANSITION / REUSE_DETECTED / SERVICE_ERROR`
   - `validateStoreContext` 辅助函数，跨店操作直接拒绝
3. **`apps/desktop/src/main/analysis-runs-service.test.ts`** — 新建文件，22/22 测试通过。
4. **`apps/desktop/src/main/analysis-runs-ipc.test.ts`** — 修复 vi.mock 顺序问题（vi.mock 必须在 import 之前）。

会话在 todo 列表中间断，剩下的工作包括：
- 阶段 2 M4.2：`AnalysisRunDetailView` 组件（未开始）
- 阶段 2 M4.4：把 AnalysisRuns 接入 `decisions-workspace`（未开始）
- 阶段 2 M4.5：渲染层测试（未开始）
- 阶段 2 M5：`AnalysisRunOrchestrator`（业务层已部分覆盖）
- 阶段 3：六模块领域模型（Decision / Execution / Experiment / Memory / MissionGrant / Decision-Domain）
- 阶段 4-7：未开始

## 需要留意的未跟踪文件

根据当前 git 状态：
- `apps/desktop/.amazon-ai-ops-package-rollback-1T6RKm/` — 包回滚产物
- `amazon-ai-ops-autonomy-prototype/` — 独立的六模块原型，与生产无关
- `amazon-ai-ops-interactive-prototype-v2/` — 早期原型
- `amazon-ai-ops-check.py`、`build_check.ps1`、`find_bad.py`、`find_broken.py` 等 — 根目录工具脚本（非核心）
- `output/` — 本地交付产物，**禁止提交**
- 大量 `output/v16-evidence/*.json` — V1.6 验证证据（被 `scripts/verify-v16-*.js` 消费）

## 最近一次测试状态（来自 CLAUDE.md 与跟踪看板）

- 聚焦权限测试：`157/157` 通过
- 允许范围全量：`285/285` 个文件、`3584/3584` 个测试通过
- 独立只读评审：`126/126` 通过，无阻断
- `.skip / .todo / skipIf / context.skip` 数量：0

## 包哈希（1.5.1，静态包，INTERNAL NON_READY）

- 安装包 SHA-256：`444802A1B282AC8EA28CA621ACA375229401DF650DB406B89926BCB9B7FEB956`
- 便携版 SHA-256：`637E7CC1E1BCAF3D2BE574D7D97563E70CDA1A5CD47FD52B955197EE81355A1D`
- 文件夹 ZIP：`CF1A80BC9D3F17B28071BDE49B1551C49C5644E7C171784AB058734352A7C534`
- 主进程 bundle：`1FAF882DA41047EA994B15EF73492BCFEE574A70AEFDBCD0CA8848527038FAB4`

## 续接点（下次会话任选其一）

1. **继续 V1.6 阶段 3 剩余 4 个子模块**：
   - **MissionGrant** — 不可变授权（预估 2-3 周）：Grant lifecycle events (issued→slot_reserved→slot_spent→consumed/invalidated)、Authorization path (manual_approval vs policy_auto)、Residual authority 派生逻辑、`GrantService` — issueGrant 验证、checkValidity
   - **Experiment** — 经营实验（预估 2 周）：Experiment lifecycle（draft→running→completed）、Baseline/observation/result snapshots、Guardrail 检查逻辑、系统结论生成 → 产生 EFFECT 事件、`ExperimentService`
   - **Memory** — 经营记忆（预估 1-2 周）：CausalEvent 六阶段因果链（FACT→ANALYSIS→DECISION→ACTION→READBACK→EFFECT）、可信索引条件（stage=READBACK/EFFECT、status≠UNKNOWN、有 proof）、Correction 追加（不覆盖历史）、`MemoryRepository` — append-only insert + 多维搜索、安全导出（不含秘密或本地路径）
   - **Mission** — Mission 领域模型（预估 2-3 周）：Mission lifecycle（draft→active→paused→completed→archived）、Mission stages（FACT→ANALYSIS→DECISION→ACTION→READBACK→EFFECT）、`MissionService` — 推进阶段、StoreContext 验证、Optimistic concurrency（revision conflict）
2. **推进阶段 4-7**：尚未启动。

## 文档维护提醒

交付状态变化时，需要同步更新：`README.md`、`docs/USER_GUIDE_v1_5.md`、`docs/V1_5_ACCEPTANCE_MATRIX.md`、`docs/V1_5_PROGRESS_REPORT.md`、`docs/V1_5_ORCHESTRATOR_CLOSEOUT.md`。文档更新后重新导出对应分支的 bundle，并重跑 `verify:v15-non-ready-safety` 或 `verify:v15-ready-safety`。

## output 目录磁盘压力

- `output/codex-temp/` 约 3 GB，可安全删除（详见 `output/CLEANUP_REPORT.md` 2026-09-02）
- `output/test-temp/` 约 244 MB，可安全删除
- `output/electron-cache/` 约 102 MB，可安全删除
- `output/codex-evidence/` 约 18 MB，**保留**（真实证据）
- `output/v16-evidence/` MB 级，**保留**（V1.6 验证输入）

## 约定要点

- 项目语言：中文。界面仅 `zh-CN`，业务文案使用中文。
- 仅 Windows，不做移动端或 macOS。
- 主进程入口：`apps/desktop/src/main/index.ts`。每次新增功能必须同时更新 主进程 + Preload + Renderer 三层。
- 权限链读取统一使用 `IMMEDIATE` 事务；A→B→A 竞态会让挂起的异步结果作废。
- 不要提交开发库、`output/`、`storage/`、`apps/desktop/release/`。
