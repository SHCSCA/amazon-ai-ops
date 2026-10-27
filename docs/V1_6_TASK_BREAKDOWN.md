# Amazon AI Ops Agent V1.6.0 任务分解

> 历史文档（2026-10-27 归类）：以下计划、完成声明、计数、包哈希及 READY 只描述原阶段，不代表当前版本。现行状态及后续工作见 [项目状态](PROJECT_STATUS.md)；保留正文供追溯，不自动重新执行旧计划。

> 基于 `amazon_ai_ops_agent_prd_v1_6_0.md` 生成  
> 生成时间：2026-09-03

## 概述

V1.6.0 是从 v1.5.1 静态单店、手工审批、keyword bid 降幅原型向**多店、Mission 飞行计划、策略内自动、经营实验与记忆**的重大架构升级。

### 核心目标

1. **六模块 IA 重组**：今日任务、运营资产、决策中心、执行与实验、经营记忆、系统设置
2. **Mission 领域模型**：完整经营闭环飞行计划，六阶段状态机 (FACT→ANALYSIS→DECISION→ACTION→READBACK→EFFECT)
3. **Analysis Runs 基础设施**：可追溯的分析运行记录、fingerprint 重用检测、阶段推进
4. **MissionGrant 不可变授权**：人工审批与策略内自动双路径、整批授权、residual authority 派生
5. **UNKNOWN 固定合同**：submit intent 后无法证明结果 → 终态 → 固定双次只读对账 → 不重试
6. **经营实验与记忆**：基线、观察窗、护栏、系统结论 → EFFECT 事件 → 可信因果索引
7. **StoreContext 严格隔离**：每店独立 Profile/session/mode/policy/data，切店完整替换
8. **L1-L8 交付验收体系**：从单元测试到 canary 到 bundle 的完整可追溯链

---

## Phase 1: V1.5.1 → V1.6.0 迁移准备（已完成 ✅）

**Milestone 1: Analysis Runs 基础设施（已完成）**

- ✅ 创建 `AnalysisRunRecord` shared type
- ✅ 创建 migration `0012-analysis-runs.ts`
- ✅ 创建 `AnalysisRunsRepository` 和完整测试
- ✅ 验证 store-scoped query、fingerprint、stages、timing

---

## Phase 2: Analysis Runs 完整集成（进行中 🚧）

### Milestone 2: Main Process 集成（进行中）

**任务清单：**

1. **M2.1**: 创建 AnalysisRunsRepository - insert/update/query/list 方法，支持 store-scoped 查询和 fingerprint 重用检测
2. **M2.2**: 创建 AnalysisRunsService - 包装 repository，处理 StoreContext 验证和 run lifecycle
3. **M2.3**: Main IPC handlers - registerAnalysisRunsIpc，暴露 createRun/updateStage/queryRun/listRuns
4. **M2.4**: 单元测试 - repository CRUD、service store isolation、IPC contract

**关键产出：**
- `apps/desktop/src/main/analysis-runs-service.ts`
- `apps/desktop/src/main/analysis-runs-ipc.ts`
- 完整单元测试覆盖

### Milestone 3: IPC 层

**任务清单：**

1. **M3.1**: 定义 IPC channels - `'analysis-runs:create'`, `'analysis-runs:update-stage'`, `'analysis-runs:query'`, `'analysis-runs:list'`
2. **M3.2**: Preload bridge API - `window.electronAPI.analysisRuns.{create,updateStage,query,list}`
3. **M3.3**: Request/Response types - CreateRunRequest, UpdateStageRequest, QueryRunRequest, ListRunsRequest + 对应 Response
4. **M3.4**: 测试 IPC 完整链路 - Main handler → Preload → mock Renderer call

**关键产出：**
- `apps/desktop/src/preload/analysis-runs-api.ts`
- IPC 合同类型定义和测试

### Milestone 4: Renderer UI

**任务清单：**

1. **M4.1**: AnalysisRunsListView 组件 - 显示当前店铺的 runs，支持筛选 completed/running/failed
2. **M4.2**: AnalysisRunDetailView 组件 - 展示 run 的 input/stages/result/timing/reuse
3. **M4.3**: RunStatusIndicator 组件 - 可视化 started/running/completed/failed/reused 状态
4. **M4.4**: 集成到 decisions-workspace - 添加 Analysis Runs 子视图，连接 window.electronAPI
5. **M4.5**: Renderer 测试 - 列表渲染、详情展开、状态变化、store 切换清空

**关键产出：**
- Analysis Runs 完整 UI 组件
- 决策中心集成

### Milestone 5: Service 层

**任务清单：**

1. **M5.1**: AnalysisRunOrchestrator - `orchestrateRun(input)` → 验证 evidence → 调用 AI/rule → 生成 proposals
2. **M5.2**: Fingerprint 计算 - 规范输入摘要（store+product+window+evidence+rule+model+policy）
3. **M5.3**: Reuse 检测 - 相同 fingerprint 返回 reused，不生成重复 proposals
4. **M5.4**: Stage state machine - FACT→ANALYSIS→DECISION→ACTION→READBACK→EFFECT 推进逻辑
5. **M5.5**: 与现有 recommendation-service 集成 - run 完成后生成 action batch 和 proposals
6. **M5.6**: 集成测试 - 完整 run 流程、fingerprint reuse、stage 推进、store isolation

**关键产出：**
- 完整 Analysis Run 编排能力
- 与现有推荐系统无缝集成

### Phase 2 完成检查点

- ✅ 检查点-1: 验证 AnalysisRunsRepository 可以 CRUD + store-scoped query + fingerprint reuse
- ⏳ 检查点-2: 验证 Main IPC 可以创建/更新/查询 runs，Preload API 正确暴露
- ⏳ 检查点-3: 验证 Renderer 可以显示 runs 列表、详情、状态，切店清空
- ⏳ 检查点-4: 验证 orchestrator 可以完整运行 fingerprint reuse、stage 推进、与 recommendation 集成
- ⏳ 检查点-5: 运行 Phase 2 所有单元测试和集成测试，确认无 .skip/.todo

---

## Phase 3: 核心领域模型（进行中 🚧，50% 完成）

### ✅ V1.6 - Decision 领域模型（已完成）

**已完成组件：**

1. ✅ **Decision schema** - missionId/missionRevision/batchId/proposalId/policyRevision/actionRevision/status/reason/history/analysisRunId/marketplace/currency
2. ✅ **Decision 状态机** - proposed→needs_approval→approved/rejected/blocked/superseded→executed→verified
3. ✅ **Decision history append-only** - 每次状态变化追加新记录，保留完整 audit trail
4. ✅ **DecisionRepository** - insert/updateStatus/appendHistory/query/transitionStatus（原子）/getProjection（聚合统计）
5. ✅ **DecisionService** - approve/reject 必须验证 non-empty reason + expectedRevision；完整实现（创建、批准、拒绝、替代、执行、验证、历史、统计）
6. ✅ **Supersede 逻辑** - 只影响开放 Decision，已批准/拒绝历史不可重写
7. ✅ **单元测试** - 39 个类型测试 + 34 个 Service 测试 = **73/73 通过**

**实际工作量：** 1 天（2026-09-03）

**状态：** ✅ 完成，但**未生产接线**（未在 Main 构造/调用、未注册 IPC、无 Preload bridge、无 Renderer 集成）

---

### ✅ V1.6 - 安全执行合同（已完成）

**已完成组件：**

1. ✅ **Execution schema** - intentId/grantId/actionId/entityId/expectedBefore/target/idempotency/submitTimestamp
2. ✅ **Slot 状态** - pending→preflight_blocked→submit_intent_recorded→submitted→verified/failed/unknown
3. ✅ **Batch 状态** - running→completed/stopped_invalidated/stopped_unknown (UNKNOWN 为终态)
4. ✅ **READBACK 三段** - before / after / reload 独立证明
5. ✅ **UNKNOWN 固定合同** - submit_intent 后无法证明 click=0 或结果 → unknown 终态 → 不重试
6. ✅ **Reconciliation case** - 每个 unknown intent 最多一个 case，恰好两个 observation slots
7. ✅ **Reconciliation outcome** - target_stably_observed / original_stably_observed / other_value / inconclusive_permanent
8. ✅ **ExecutionService** - preflight gates (P0-P6) → submit (至多一次) → readback → verifier；Batch 状态自动管理
9. ✅ **单元测试** - 44 个类型测试 + 27 个 Service 测试 = **71/71 通过**

**实际工作量：** 1 天（2026-09-03）

**状态：** ✅ 完成，但**未生产接线**（未在 Main 构造/调用、未注册 IPC、无 Preload bridge、无 Renderer 集成）

---

### ⏳ V1.6 - Mission 领域模型（待推进）

**关键组件：**

1. **Mission schema** - storeId/US/USD/dataBatchId/policyVersionId/observationWindow/successCriteria/guardrails/revision
2. **Mission lifecycle** - draft→active↔paused→blocked→completed→archived + restore
3. **Mission stages** - FACT→ANALYSIS→DECISION→ACTION→READBACK→EFFECT
4. **MissionRepository** - CRUD + store/status/stage 查询 + optimistic concurrency
5. **MissionService** - 创建/更新/推进阶段/归档/恢复，强制 StoreContext 验证
6. **单元测试** - lifecycle transitions、revision conflict、stage 非法跳跃、store isolation

**预估工作量：** 2-3 周

---

### ⏳ V1.6 - MissionGrant 不可变授权（待推进）

**关键组件：**

1. **MissionGrant schema** - immutable grant：decisionIds/entities/limits/budget/evidence/expiry/policy/session/mode/issuer
2. **Grant lifecycle events** - issued→slot_reserved→slot_spent→consumed/invalidated/revoked/expired (append-only)
3. **Authorization path** - manual_approval=human_operator / policy_auto=policy_runtime，禁止 mixed issuer
4. **GrantRepository** - insert immutable Grant + append lifecycle events + derive residual authority
5. **GrantService** - issueGrant 验证完整 batch + checkValidity
6. **Residual authority 派生** - 从 Grant + slot/lifecycle events 计算剩余可用 authority

**预估工作量：** 2-3 周

---

### ⏳ V1.6 - 经营实验（待推进）

**关键组件：**

1. **Experiment schema** - missionId/decisionId/baseline/primaryMetric/guardrails/observationWindow/hypothesis
2. **Experiment lifecycle** - draft→running↔paused→completed→archived + restore
3. **Snapshot 记录** - baseline / observation / result snapshots (来自 formal business data)
4. **Guardrail 检查** - 观察期内持续验证，触发即停止
5. **系统结论** - 观察窗结束 + 护栏未触发 → 系统生成结论
6. **ExperimentService** - 创建实验、更新观察、检查护栏、生成结论 → 产生 EFFECT 事件

**预估工作量：** 2 周

---

### ⏳ V1.6 - 经营记忆（待推进）

**关键组件：**

1. **CausalEvent schema** - storeId/stage/missionId/entityId/businessDate/sessionGeneration/proofHash/eventType
2. **六阶段因果链** - FACT→ANALYSIS→DECISION→ACTION→READBACK→EFFECT 完整回溯
3. **可信索引条件** - 属于当前 store、stage=READBACK/EFFECT、status≠UNKNOWN、有 proof、可回链
4. **Correction 追加** - 错误记录通过 correction 指向被修正记录，不覆盖历史
5. **MemoryRepository** - insert append-only + search by store/product/stage/keyword
6. **安全导出** - JSON 包含 store/date/records/search/evidence refs，不含秘密或本地路径

**预估工作量：** 1-2 周

---

### Phase 3 完成检查点

- ✅ 检查点-1: Decision 领域模型完整实现（类型、验证、Repository、Service）— **73/73 测试通过**
- ✅ 检查点-2: Execution 领域模型完整实现（类型、验证、Repository、Service、安全执行合同）— **71/71 测试通过**
- ⏳ 检查点-3: MissionGrant 领域模型完整实现
- ⏳ 检查点-4: Experiment 领域模型完整实现
- ⏳ 检查点-5: Memory 领域模型完整实现
- ⏳ 检查点-6: Mission 领域模型完整实现
- ⏳ 检查点-7: 所有六个领域模型生产接线（Main 构造/调用、IPC 注册、Preload bridge、Renderer 集成）

**Phase 3 当前进度：50%**（Decision + Execution 完成，4 个子模块待推进）

---

## Phase 4: 六模块 IA 重组（规划中 📋）

### 模块结构

1. **今日任务** - 当前唯一主动作、准备度摘要、Mission 状态、Analysis Run、待处理、最近验证
2. **运营资产** - 产品配置、广告对象路径、exact 8/8 报表、Listing 本地草案
3. **决策中心** - Analysis Runs、建议列表、Decision 历史、MissionGrant 详情
4. **执行与实验** - preflight gates、可见执行、三段回读、UNKNOWN 对账、Experiment 跟踪
5. **经营记忆** - 因果时间线、六阶段搜索、proof 链接、correction 追加、安全导出
6. **系统设置** - 店铺配置、ERP/Ads 连接、写入模式、策略版本、scheduler、AI config

### 导航完整性

- 六模块各出现一次
- 无 Skills 一级入口
- 22 intent 完整覆盖

**预估工作量：** 3-4 周（大规模 UI 重组）

---

## Phase 5: StoreContext 严格隔离（规划中 📋）

**关键任务：**

1. **StoreContext schema** - storeId/marketplace=US/currency=USD/businessDate/sessionGeneration
2. **切店完整替换** - 所有模块清空上一店铺的产品/建议/执行/实验/记忆残留
3. **Main 重验 authority** - 伪造或陈旧 Renderer context 被拒绝
4. **Profile/session/grant 隔离** - 跨店复用全部阻断
5. **非 US/USD** - 主链明确阻断
6. **切店竞态保护** - 旧异步响应不覆盖新店铺投影

**预估工作量：** 1-2 周

---

## Phase 6: 策略与自动化边界（规划中 📋）

**关键任务：**

1. **两种写入模式** - manual_approval (human Decision+Grant) vs policy_auto (policy Decision+Grant)
2. **半自动不是第三模式** - 调度自动化与写入 authority 分离
3. **PolicyVersion schema** - allowedActionTypes/entities/maxChangePct/budget/dailyCount/cooldown/window/evidence/stops/killSwitch
4. **Policy lifecycle** - draft 不可授权、enabled 不可原地修改、变更创建新版本
5. **Gate 优先级 P0-P6** - kill switch / circuit breaker / context / revision / grant / scope / evidence
6. **模式变更 reason** - 所有 mode/policy 变更必须记录真实 operator reason + CAS
7. **终态不复活** - kill switch 解除、policy 切回旧值不复活 terminal Grant/batch/slot

**预估工作量：** 2-3 周

---

## Phase 7: 交付验收体系（规划中 📋）

### L1-L8 验收层级

| 层级 | 内容 | 预估工作量 |
|------|------|-----------|
| L1 | 单元/合同测试 - shared types/service/repo/IPC/Preload/Renderer，版本化 required-test manifest | 持续 |
| L2 | 静态工程 - typecheck、Renderer build、package script contracts | 每次构建 |
| L3 | 业务集成 - exact 8/8、analysis、decision、grant、UNKNOWN residual、policy precedence | 2 周 |
| L4 | Package UI - 100%/125%、wide/minimum、overlay/dialog/store isolation、a11y delta register | 1 周 |
| L5 | Package 身份/安全 - installer/portable/ZIP hash、launch、navigation、external links | 3 天 |
| L6 | 正式 DB - current authority DB、WAL-safe readonly pre/post、snapshot、two-store × seven days | 1 周 |
| L7 | Canary - 独立 manual approval 和 policy-auto canary，不共享 Grant/batch/job/evidence | 1 周 |
| L8 | Readiness/Bundle - trace closure、L1-L7 聚合、matching READY/NON_READY bundle | 3 天 |

### 关键产出

1. **Readiness aggregation script** - 聚合 L1-L8 证据、生成 final-readiness.json、验证 trace closure
2. **Bundle export** - 基于 readiness 状态导出 READY 或 NON_READY bundle

**总预估工作量：** 4-5 周（与其他 Phase 并行）

---

## 总体时间估算

| Phase | 描述 | 预估时间 | 状态 |
|-------|------|----------|------|
| Phase 1 | V1.5.1 → V1.6.0 迁移准备 | 1 周 | ✅ 已完成 |
| Phase 2 | Analysis Runs 完整集成 | 3-4 周 | 🚧 进行中 (M1 完成) |
| Phase 3 | 核心领域模型 (Mission/Decision/Grant/Execution/Experiment/Memory) | 12-16 周 | 📋 规划中 |
| Phase 4 | 六模块 IA 重组 | 3-4 周 | 📋 规划中 |
| Phase 5 | StoreContext 严格隔离 | 1-2 周 | 📋 规划中 |
| Phase 6 | 策略与自动化边界 | 2-3 周 | 📋 规划中 |
| Phase 7 | 交付验收体系 (L1-L8) | 4-5 周（并行） | 📋 规划中 |

**总计：约 6-8 个月全职开发时间**

---

## 关键风险与依赖

### 高风险项

1. **UNKNOWN 固定合同实现复杂度** - 需要精确的 crash boundary、durable fact、双次只读对账
2. **StoreContext 严格隔离** - 需要重构大量现有代码，确保无跨店残留
3. **MissionGrant residual authority 派生** - 需要正确处理 slot/batch/Grant 三维度状态
4. **L6 正式 DB 验证** - 需要 WAL-safe readonly 访问，确保零业务写入
5. **L7 Canary 独立性** - 需要完全独立的 manual 和 policy-auto 测试路径

### 关键依赖

1. **v1.5.1 稳定基线** - 必须先有稳定的 v1.5.1 才能安全迁移
2. **Migration & Compatibility Spec** - 需要完整的 schema upgrade/rollback 规范
3. **UI Terminology Table** - 需要版本化的业务中文/英文/诊断术语表
4. **Accessibility Delta Register** - 需要逐项记录 v1.5.1 到 v1.6.0 的 a11y 差距

---

## 下一步行动

### 立即行动（本周）

1. ✅ 完成 Phase 2 Milestone 1 (Analysis Runs 基础设施)
2. 🚧 开始 Phase 2 Milestone 2 (Main Process 集成)
   - 创建 AnalysisRunsService
   - 注册 IPC handlers
   - 编写单元测试

### 短期目标（本月）

1. 完成 Phase 2 所有 Milestones (M2-M5)
2. 通过 Phase 2 完成检查点 (检查点-1 到检查点-5)
3. 开始 Phase 3 Mission 领域模型设计

### 中期目标（本季度）

1. 完成 Phase 3 核心领域模型 (Mission/Decision/Grant)
2. 开始 Phase 4 六模块 IA 重组
3. 建立 L1-L3 持续验收流程

---

## 附录：关键 PRD 章节索引

- **§9 今日任务模块** - 唯一主动作、准备度摘要
- **§10 运营资产模块** - 产品配置、exact 8/8、Listing
- **§11 决策中心模块** - Analysis Run、建议、Decision、Grant
- **§12 Mission 与 MissionGrant 合同** - revision、lifecycle、stages、residual authority
- **§13 执行与实验模块** - preflight gates、UNKNOWN、reconciliation、Experiment
- **§14 经营记忆模块** - 因果链、可信索引、correction、导出
- **§15 系统设置模块** - 店铺、连接、mode、policy、scheduler
- **§16 数据与领域模型需求** - StoreContext、Evidence Package、谱系、migration
- **§17 AI、规则与提示安全** - source 资格、prompt 注入、fallback、cost governance
- **§18 UX 与视觉需求** - 业务语言、交互状态、响应性、a11y
- **§19 非功能需求** - 可靠性、安全、性能、离线、可观测性
- **§20 错误、阻断与恢复合同** - 状态分类、blocker 内容、恢复原则
- **§21 交付与验收策略** - L1-L8 层级、正式验收场景目录

---

**文档版本：** V1.6.0 Draft 1.1  
**最后更新：** 2026-09-03 17:30  
**负责人：** Development Team  
**审批状态：** 待审批

---

## 最新进展（2026-09-03 17:30）

### Phase 3 当前状态：50% 完成

**已完成（2026-09-03）：**

1. ✅ **Decision 领域模型**（73/73 测试通过）
   - 类型系统完整（`DecisionRecord`、验证函数、映射函数、构建器）
   - `DecisionRepository` 扩展（原子状态转换、聚合统计）
   - `DecisionService` 完整实现（创建、批准、拒绝、替代、执行、验证）
   - 强制 reason 必填、乐观锁、不可变历史
   - **注意：未生产接线**

2. ✅ **Execution 领域模型**（71/71 测试通过）
   - 类型系统完整（`ExecutionSlot`/`ExecutionBatch`/`ReconciliationCase`）
   - Preflight gates (P0-P6)、状态机、Reconciliation outcomes
   - `ExecutionRepository` 扩展（Reconciliation 管理、batch projection）
   - `ExecutionService` 完整实现：
     - At-most-once submit 保证
     - Three-phase readback (before/after/reload)
     - UNKNOWN 固定合同（终态、不重试）
     - Reconciliation 双观测逻辑（4 种 outcomes）
     - Batch 状态自动管理
   - **注意：未生产接线**

**下一步推荐顺序：**

1. **Memory 领域模型**（最独立，1-2 周）
2. **MissionGrant 领域模型**（2-3 周）
3. **Experiment 领域模型**（2 周）
4. **Mission 领域模型**（2-3 周）
5. **所有六个领域模型生产接线**（Main 构造/调用、IPC 注册、Preload bridge、Renderer 集成）

---
