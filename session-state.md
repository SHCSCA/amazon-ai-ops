# 会话状态 — Amazon AI Ops Agent

> 创建时间：2026-09-03 14:22
> 最后更新：2026-09-04 09:11
> 用途：用于在新对话中快速恢复上下文，请保持文件长度在 100 行以内。

## 项目快照

- **应用形态**：仅限 Windows 的 Electron 桌面应用，面向 Amazon 美国站广告运营人员
- **版本状态**：
  - 1.5.1 = 静态 Windows 候选包，`APP_NEEDS_WORK / INTERNAL NON_READY`
  - 1.6.0 = 下一主版本，正在开发中（V1.6 验证框架）
- **用户禁令**（仍然有效）：typecheck、build:win、业务 smoke、Package UI、ZIP 启动、当前包正式库前后复核、真实 Ads 验证、应用/浏览器/桌面控制
- **一句话总结**：要拿到运行时验收信用，必须先让 Task 8B 通过（唯一当前对象/出价回读 + 10% 以内的 lower_bid + 产品内人工批准 + 一次写入 + 刷新回读证据）。

## V1.6.0 进度（2026-09-04 09:50 更新）

| 阶段 | 状态 | 说明 |
|------|------|------|
| 阶段 1：Analysis Runs 基础设施 | ✅ 100% | `AnalysisRunRecord`、迁移 0012、仓储、44/44 测试 |
| 阶段 2：Analysis Runs 完整集成 | ✅ 100% | 主进程 IPC、Preload 桥接、业务层、所有测试通过 |
| 阶段 3：六模块领域模型 | ✅ 100% | 全部 6 个子模块完成，360/360 测试通过（**阶段完成但未生产接线**）|
| 阶段 4：六模块信息架构重组 | ✅ 90% | Router/Bridge/Sidebar 集成完成，41/41 测试通过 |
| 阶段 5：StoreContext 严格隔离 | ✅ 80% | **核心完成**，52/52 测试通过（待 Service 集成） |
| 阶段 6：策略与自动化边界 | ⚪ 0% | 未启动 |
| 阶段 7：交付验收体系 | ⚪ 0% | 未启动 |

总体进度：**68%**（阶段 5 从 0% → 80%，总进度从 60% → 68%）

## 当前工作（2026-09-04 09:50）

**刚完成**：阶段 5 - StoreContext 严格隔离（核心实现完成）⭐

**已完成**：
- ✅ StoreContextTracker 单例：追踪当前 context、pending operations、switch callbacks
  - `setContext` / `getContext` / `isCurrentContext` / `assertCurrentContext`
  - `trackOperation` — 阻止有未完成操作时切换 store
  - `onContextSwitch` — 注册 store 切换回调
  - **34/34 测试通过**
- ✅ ContextAuthorityChain：Mission/Grant/Execution context 绑定验证
  - `assertMissionContextValid` — 验证 Mission 的 `sessionGeneration` 和 `contextSnapshot`
  - `assertGrantContextValid` — 验证 Grant 的 `sessionGeneration` 和 `contextSnapshot`
  - `assertExecutionContextValid` — 验证 Execution context
  - `createContextBoundOperation` — 创建 context 绑定的操作追踪器
  - `installContextAuthorityHandlers` — 安装 store 切换处理器
  - **18/18 测试通过**
- ✅ Domain Model 更新：
  - `MissionRecord` 新增 `sessionGeneration` 和 `contextSnapshot`
  - `MissionGrantRecord` 完善 `sessionGeneration` 和 `contextSnapshot`
- ✅ **A→B→A 竞态保护**：通过 sessionGeneration 防止过期异步结果

**测试总结**：52/52 全部通过 + 全量 V16 测试 165/165 通过 ✅
- StoreContextGuard: 34/34 ✅
- ContextAuthorityChain: 18/18 ✅
- 全量 V16 Services: 165/165 ✅（Decision/Execution/Memory/Experiment/MissionGrant/Mission/Guard/Authority）

**核心成果**：
1. ✅ Store 切换必须等待所有 pending operations 完成
2. ✅ Mission/Grant 绑定创建时的 `sessionGeneration`
3. ✅ 异步操作结果在 context 切换后自动失效
4. ✅ Store 切换触发 callback 通知所有监听者

**下一步**：
- ⏳ Service 集成：在 6 个 V16 Service 中应用 context 验证
- ⏳ 阶段 6：策略与自动化边界

## 阶段 3 重要提醒

⚠️ **所有 6 个 V16 Service 已完整实现但未生产接线**：
- DecisionService (34/34 测试)
- ExecutionService (27/27 测试)
- MemoryService (9/9 测试)
- ExperimentService (14/14 测试)
- MissionGrantService (13/13 测试)
- MissionService (34/34 测试)

**缺失项**：
- ❌ 未在 Main 构造/调用
- ❌ 未注册 IPC handlers
- ❌ 无 Preload bridge
- ❌ 无 Renderer 集成

当前测试覆盖仅证明**隔离聚焦行为**，不授予生产可用性或 L3/L4 信用。
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

### 3. Memory 域模型（21 类型 + 9 Service = 30 测试通过）✅

#### 类型层（`packages/shared-types/src/memory-domain.ts`）
- `CausalEventRecord` — 不可变因果事件（六阶段：fact_gathered→analysis_started/completed→decision_proposed/approved/rejected→grant_issued→action_submitted→readback_verified→effect_observed）
- `MemoryStatus`：observed / trusted / corrected / disputed
- `EvidenceRef` — 证据引用（screenshot/document/value/hash）
- `isIndexable` — 可信索引条件：stage=readback/effect + status=trusted + 有 proofHash + 有溯源链
- `computeMemoryDigest` — 稳定 64 位哈希
- `validateCausalEventRecord` / `buildCausalEventRecord` / `buildCorrectionEvent` / `safeExportEvent`
- **21/21 测试通过**

#### Service 层（`apps/desktop/src/main/v16-memory-service.ts`）
- `append` — 追加事件（必须有 proofHash）
- `correct` — 追加修正事件（引用原事件，原事件标记为 corrected）
- `promoteToTrusted` — 将 observed 事件提升为 trusted（仅限 readback/effect stage）
- `exportMemory` — 安全导出（可按日期/stage/trustedOnly 过滤，不含本地路径）
- `searchByEntity` / `searchByProduct` — 按实体/产品搜索
- **9/9 测试通过**

### 4. Experiment 域模型（21 类型 + 14 Service = 35 测试通过）✅

#### 类型层（`packages/shared-types/src/experiment-domain.ts`）
- `ExperimentRecord` — 实验记录（draft→running→paused→blocked→completed→archived）
- `ExperimentHypothesis` — 假设（statement + expectedEffect + expectedChangePercent）
- `Guardrail` — 护栏（metric + operator + threshold）
- `isGuardrailTriggered` / `checkGuardrails` — 护栏检查逻辑
- `validateExperimentRecord` / `buildExperimentRecord` / `isExperimentTerminal`
- **21/21 测试通过**

#### Service 层（`apps/desktop/src/main/v16-experiment-service.ts`）
- `createExperiment` — 创建实验（draft 状态，将字符串 hypothesis 转换为对象）
- `activateExperiment` — 激活实验（draft→active）
- `completeExperiment` — 完成实验（active→completed，记录 outcome/learnings）
- `terminateExperiment` — 终止实验（draft/active→terminated）
- `getExperimentsByStore` / `getExperimentById` — 查询
- **14/14 测试通过**

### 5. MissionGrant 域模型（25 类型 + 13 Service = 38 测试通过）✅

#### 类型层（`packages/shared-types/src/mission-grant-domain.ts`）
- `MissionGrantRecord` — 授权记录（issued→active→partially_consumed→consumed→revoked→invalidated）
- `GrantLifecycleEvent` — 生命周期事件
- `calculateResidualAuthority` — 计算剩余权限（maxSlots - usedSlots）
- `validateMissionGrantRecord` / `buildMissionGrantRecord` / `isGrantTerminal` / `canReserveSlot`
- **25/25 测试通过**

#### Service 层（`apps/desktop/src/main/v16-mission-grant-service.ts`）
- `issue` — 签发授权（创建 active grant + issued 事件，必须有 reason）
- `reserveSlot` — 预留 slot（usedSlots++，active→partially_consumed，达到上限→consumed）
- `revoke` — 撤销授权（→revoked，必须有 reason）
- `invalidate` — 作废授权（→invalidated，用于过期/权限变更）
- `deriveResidualAuthority` — 派生剩余权限
- **13/13 测试通过**

### 6. Mission 域模型（已存在类型 + 34 Service = 34 测试通过）✅

#### 类型层（`packages/shared-types/src/mission-domain.ts`）
- `MissionRecord` — 任务记录（draft→active→paused→blocked→completed→archived）
- `MissionStage` — 六阶段流程：fact→analysis→decision→execution→readback→effect
- 已存在完整类型定义

#### Service 层（`apps/desktop/src/main/v16-mission-service.ts`）
- `createMission` — 创建任务（draft 状态）
- `startMission` / `pauseMission` / `blockMission` / `completeMission` / `archiveMission` — 状态转换
- `advanceStage` — 推进阶段（fact→analysis→decision→execution→readback→effect，自动完成）
- `getMission` / `listMissions` — 查询（强制 store 隔离）
- **34/34 测试通过**

### 测试覆盖
- Decision 域：73 个测试 ✅
- Execution 域：71 个测试 ✅
- Memory 域：30 个测试 ✅
- Experiment 域：35 个测试 ✅
- MissionGrant 域：38 个测试 ✅
- Mission 域：34 个测试 ✅
- Migration 0013：6 个测试 ✅
- v16-domain-repositories：12 个测试 ✅
- **总计：302/302 全部通过 ✅**

### 重要提醒

**所有 6 个 Service 已完整实现但未生产接线**（未在 Main 构造/调用、未注册 IPC、无 Preload bridge、无 Renderer 集成）。当前测试覆盖仅证明**隔离聚焦行为**，不授予生产可用性或 L3/L4 信用。

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

1. **V1.6 阶段 4：六模块信息架构重组**（预估 3-4 周）
   - 新增六个主要 workspace：Missions / Decisions / Execution / Experiments / Memory / Policy
   - 重组现有页面路由和导航结构
   - 实现跨域数据流和状态管理
   - UI 组件开发和集成测试

2. **V1.6 阶段 5：StoreContext 严格隔离**（预估 2-3 周）
   - 强制所有查询/操作携带 StoreContext
   - 跨店操作拒绝逻辑
   - Store 切换时清空全局状态
   - 隔离测试和边界验证

3. **继续 V1.6 阶段 2 剩余工作**（UI 集成）
   - M4.2：`AnalysisRunDetailView` 组件
   - M4.4：把 AnalysisRuns 接入 `decisions-workspace`
   - M4.5：渲染层测试

4. **V1.6 阶段 3 生产接线**（预估 1-2 周）
   - 在 Main 构造 6 个 Service 实例
   - 注册 IPC handlers（v16-services-ipc）
   - 实现 Preload bridge（v16-services-preload）
   - Renderer 集成和 UI 连接
   - E2E 流程测试
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
