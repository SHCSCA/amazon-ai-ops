# Mission Control 十工作区生产对接矩阵

> 产品信息架构以 `amazon-ai-ops-mission-control-prototype` 为准；当前八工作区和十六个 legacy route 作为能力来源与兼容入口。V1 固定 Amazon US / USD，但支持多个相互隔离的美国站店铺。

> 2026-08-26 v1.5.1 更新：十工作区现展开为 22 个标准视图；全部保留能力在 provider ready 时都有原生或受控生产实现。Mission/实验仅归档恢复，不提供硬删除；串行执行遇 `UNKNOWN` 停止并提供只读双次对账，不提供 skip；唯一急停保留在策略运行页。因果记忆支持当前店铺索引重建和 JSON 导出。

## 1. 对接规则

- 原型提供界面、交互和领域意图，`localStorage + reducer` 不进入生产权威链。
- 所有业务记录拥有稳定 `store_id`；`store_name + marketplace_code` 仅用于显示和旧数据迁移。
- 配置类对象使用 CRUD + 归档；Mission、实验和策略使用版本化状态机；决策、审批、执行和因果记录使用追加式审计。
- 当前十六个旧路由保留为兼容 alias 或新工作区 subview，直至相应能力完成 `PRODUCTION_NATIVE` 迁移。
- Renderer 的完成状态只来自 Main/SQLite 回读；原型 fixture 必须明确标记 `PROTOTYPE_ONLY`。

## 2. 工作区矩阵

| Mission Control 工作区 | 吸收的现有页面/能力 | 生产化开发项 | IPC / DB 主合同 | 阶段验收 |
| --- | --- | --- | --- | --- |
| **今日任务 `today`** | `dashboard`、业务数据管道、数据新鲜度、指标摘要、建议就绪、部分 `operation-events` | `TodayProjectionService`，按店铺聚合 Mission、采集、决策、执行和实验；下一动作必须定位到精确实体 | 新增 `today:get-projection`；复用指标、报表、建议、事件表并补 `store_id` | 切店不串数；刷新投影一致；下一动作进入正确店铺和实体 |
| **任务中心 `missions`** | `ad-quant` 事实诊断、workflow-state、调度、action log | Mission 创建/编辑/启动/暂停/恢复/归档/恢复；检查点、产品、广告对象、决策、实验和执行关联 | 新增 `mission:*`；新增 `missions`、`mission_checkpoints`、`mission_links`、`mission_events` | 一条 Mission 从事实进入决策、实验、执行、回读，始终保持同店铺和 revision |
| **决策与审批 `decisions`** | `recommendations`、`approval`、`decided`、AI Adapter、Rules Engine、RecommendationRepo、revision/CAS、目标绑定 | 升级为 Crux Decision；补 Mission、策略快照、备选方案、历史和 MissionGrant；批准不等于执行 | 扩展 `recommendations:*` 命令为 `storeId + expectedRevision + actor`；新增 decision event/alternative/approval batch | 旧 revision、跨店审批被阻断；整批授权一次；决定历史不可篡改 |
| **经营实验 `experiments`** | 指标查询、广告诊断、运营事件、执行回读、AI 结果 | 实验创建/编辑/暂停/恢复/归档/恢复；假设、主指标、守护栏、观察窗和结论 | 新增 `experiment:*`；新增 `experiments`、`experiment_records`、`experiment_metric_snapshots`、`experiment_links` | 从执行前基线到结果窗口可复现；记录只追加；归档可恢复 |
| **实时执行 `execution`** | `readback`、BrowserController、page models、action-executor、audit log、证据 verifier | `ExecutionCoordinator`、队列、对象锁、BrowserLease、幂等、sessionGeneration、before/apply/reload、崩溃恢复、UNKNOWN 只读双次对账 | `execution:prepare/start/cancel/takeover/reconcile-unknown/verify/get`；新增 job/item/attempt/evidence/lock 表 | 错店、旧对象、重复键、UNKNOWN 均无二次写；UNKNOWN 原状态不可改写，另记双次回读证据 |
| **因果记忆 `memory`** | operation events、action logs、推荐证据、AI diagnosis、报表批次、Listing 版本 | 统一追加式 CausalLedger；事实、决策、干预、回读、结果、索引重建、JSON 导出和复用边界 | `memory:query/get/rebuild-index/export`；新增 `causal_events`、`causal_links`、`evidence_refs` | 无悬空引用；证据可追溯；跨店查询隔离；重建索引结果一致；导出仅含当前店铺 |
| **店铺与广告对象 `objects`** | `product-management`、`product-config`、`keyword-opportunities`、`listing-optimization`、ProductRepo | 店铺完整 CRUD；产品归档/恢复/依赖删除；Campaign/Ad Group/Keyword/Target/Product Ad 主数据、父子关系、Amazon ID 和版本 | 新增 `store:*`、`ad-objects:*`；新增 `stores`、connections/profiles、ad objects/versions；旧表补 FK | 同 Amazon ID 唯一；对象树有效；跨店同 ASIN 隔离；本地主数据维护不触发 Ads 写入 |
| **数据采集 `collection`** | `operation-scope`、`data-collection`、`data-import-validation`、Lingxing Collector、Parser、Browser Worker、八报表批次与诊断 | 原型简化报告改为真实八类合同；持久采集任务 CRUD、运行历史、店铺 Profile 调度和业务日 | 复用 `v1_5:reports:*` 并校验 `storeId`；新增 `collection-jobs:*`、jobs/runs 表；批次/文件/指标补 `store_id` | 每店独立 8/8；失败不伪造完成；America/Los_Angeles 业务日；验证码/漂移可接管 |
| **策略与风控 `policy`** | Rules Engine、Risk Evaluator、RuleConfig、审批策略、设置页规则表单 | 店铺/产品/广告对象级版本化策略 CRUD；模式、作用域、优先级、快照、硬上限、熔断和 kill switch | 新增 `policy:*`、`store:set-mode`；新增 policies/versions/bindings/store modes | 策略优先级确定；已启用版本不可覆盖；越界和过期数据绝对阻断 |
| **系统设置 `settings`** | `settings`、`scheduler`、`delivery`、safeStorage、登录会话、存储路径、包体验收 | 店铺级设置/Profile/调度；US/USD 只读；会话中心；店铺归档依赖检查；凭证只在 Main | 扩展 `settings:*`、新增 `sessions:*`；新增 store settings、credential refs、scheduled jobs/runs | Profile 唯一；凭证不出 Main；切店不复用 Cookie；活动任务阻断归档；包体安全通过 |

## 3. Legacy Route 归属

| Legacy route | 新工作区 / subview |
| --- | --- |
| `dashboard` | `today/overview` |
| `product-management` | `objects/products` |
| `product-config` | `objects/targets` |
| `operation-events` | `today/events` 与 `memory/events` |
| `operation-scope` | `collection/scope` |
| `data-collection` | `collection/reports` |
| `data-import-validation` | `collection/import-check` |
| `ad-quant` | `missions/facts` |
| `recommendations` | `decisions/recommendations` |
| `approval` | `decisions/approval` |
| `readback` | `execution/evidence` |
| `keyword-opportunities` | `objects/keywords` |
| `listing-optimization` | `objects/listing` |
| `settings` | `settings/ai-and-local` |
| `scheduler` | `settings/scheduler` |
| `delivery` | `settings/delivery` |

## 4. 横向数据库迁移

1. 新增 `schema_migrations`，后续升级不再只依赖 `CREATE TABLE + ensureColumn`。
2. 新增 `stores`，首版约束 `marketplace_code='US'`、`currency='USD'`，默认业务时区 `America/Los_Angeles`。
3. 为现有业务表补 `store_id`；通过现有 `store_name + marketplace_code` 回填，无法唯一映射的记录进入 quarantine，禁止猜测。
4. 增加店铺范围唯一约束、外键和查询索引。
5. Main 的 `StoreCoordinator` 解析活动 store capability、路径和 Profile；Renderer 的 `storeId` 不能绕过服务端绑定。
6. 生产成功状态只来自 Main/SQLite；原型 localStorage 只允许承载无业务权威的 DEV fixture 或瞬时表单草稿。

## 5. 能力迁移状态表

每项能力在代码和 UI 中使用统一状态：

| 状态 | 含义 | UI 规则 |
| --- | --- | --- |
| `PROTOTYPE_ONLY` | 只有交互/fixture | 明确标注模拟，禁止真实成功文案 |
| `LEGACY_ADAPTER` | 调用当前生产能力 | 显示真实来源与兼容边界 |
| `PRODUCTION_NATIVE` | 正式领域服务和权威 DB | 可作为业务事实和验收依据 |
| `BLOCKED` | 安全门或前置能力缺失 | 显示可操作阻断原因，不提供假成功 |

## 6. 阶段测试边界

| 大阶段 | 阶段结束时一次性验证 |
| --- | --- |
| 店铺权威层 | DB 迁移、跨店隔离、Profile/凭证安全、桌面 smoke |
| 原型主壳迁移 | typecheck、导航与渲染测试、十工作区 UI 证据 |
| 真实底座接入 | Repository/IPC、每店 8/8 采集导入、对象/Listing smoke |
| 智能决策闭环 | Mission/Policy/Decision 状态机、CAS、跨店授权阻断 |
| 学习闭环 | 实验状态、因果链完整性、同店检索和索引重建 |
| 真实执行 | 错店/错对象/幂等/UNKNOWN/崩溃恢复、真实 Ads readback |
| 生产交付 | 全量回归、Windows 包、十工作区 UI、安全、readiness 和 bundle |
