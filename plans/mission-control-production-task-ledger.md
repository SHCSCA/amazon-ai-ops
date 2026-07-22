# Mission Control 生产实施任务台账

> 总负责人维护。状态只依据当前工作树、commit、测试输出和真实运行证据更新。任务完成顺序遵循 `plans/mission-control-production-integration-plan.md`。

## 状态定义

- `TODO`：未开始。
- `ACTIVE`：已有明确 owner 正在开发。
- `REVIEW`：开发结束，等待阶段集中验证。
- `DONE`：阶段验证通过且 commit 已推送。
- `BLOCKED`：外部条件阻断且没有安全替代路径。

## 阶段 0：基线与计划

| ID | 状态 | Owner / 文件边界 | 交付物 | 阶段验证 / 提交边界 |
| --- | --- | --- | --- | --- |
| S0-01 | DONE | Main/Preload/Renderer/Rules/package-ui 既有修改 | Preview、Decisions、登录与外链安全 checkpoint | 284 聚焦测试 + 全 workspace typecheck；commit `05dec18b` 已推送 |
| S0-02 | DONE | `package.json`、adversarial package smoke/readiness/bundle scripts | 不可降级的 adversarial `NODE_ENV` 证据合同 | 6 files、94/94 聚焦测试通过；独立 `fix:` commit/push |
| S0-03 | DONE | `amazon-ai-ops-mission-control-prototype` 源码 | 多美国店铺、US/USD、十工作区产品基线 | prototype build 通过；随本产品基线提交推送 |
| S0-04 | DONE | `plans/mission-control-production-*`、`.gitignore` | 生产对接计划、矩阵、台账、artifact ignore | `git diff --check` + reviewer 8.1/10；随 S0-03 提交推送 |

## 阶段 1：美国站多店铺权威层

| ID | 状态 | Owner / 文件边界 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| S1-01 | TODO | `packages/shared-types` | S0 | `StoreId`、StoreContextEnvelope、connection/session/capability 合同 |
| S1-02 | TODO | `packages/local-db/src/sqlite/db.ts` 与 migration 模块 | S1-01 | `schema_migrations`、stores、connections、session metadata、quarantine |
| S1-03 | TODO | `packages/local-db/.../repositories` | S1-02 | StoreRepository、迁移回填、store-scoped repository contract |
| S1-04 | TODO | 新 store capsule/path 模块 | S1-01 | `%LOCALAPPDATA%/stores/{storeId}`、canonical path containment、备份 manifest |
| S1-05 | TODO | `packages/browser-worker` | S1-01/S1-04 | 每店 Lingxing/Ads Profile、BrowserLease、sessionGeneration |
| S1-06 | TODO | `apps/desktop/src/main`、`preload` | S1-02..05 | StoreCoordinator、店铺 CRUD/切换/连接 IPC、旧请求失效 |
| S1-07 | TODO | 阶段质量 owner | S1-01..06 | 迁移/隔离/Profile/凭证/桌面 smoke 集中验证与阶段 commit/push |

阶段 1 集中验证：受影响 package typecheck、migration/repository/browser/Main IPC 聚焦测试、两个美国店铺隔离 smoke。

## 阶段 2：Mission Control 正式 Renderer

| ID | 状态 | Owner / 文件边界 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| S2-01 | TODO | Renderer navigation/shell/types | S1 | 十工作区 canonical navigation 与顶部 StoreContext |
| S2-02 | TODO | Renderer design system/styles | S2-01 | 原型视觉迁移、响应式 Inspector、统一 CRUD primitive |
| S2-03 | TODO | Renderer query/command bridge | S1/S2-01 | 去除生产 localStorage authority，query projection + typed command |
| S2-04 | TODO | Renderer legacy adapters | S2-01 | 16 个旧路由映射为 subview/alias，不丢生产能力 |
| S2-05 | TODO | Dev preview/package UI evidence | S2-01..04 | 十工作区 fixture 合同和 UI evidence vNext |
| S2-06 | TODO | 阶段质量 owner | S2-01..05 | typecheck、导航/渲染聚焦测试、十工作区 100%/125% UI 证据、commit/push |

## 阶段 3：真实领星采集与运营底座

| ID | 状态 | Owner / 文件边界 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| S3-01 | TODO | collector/browser/page-model | S1/S2 | 店铺身份核验、可见下载中心、八报告任务 |
| S3-02 | TODO | report parser/local DB | S3-01 | store-scoped 批次、文件、幂等导入和 0.01 对账 |
| S3-03 | TODO | Objects workspace | S1/S2 | 店铺、产品、成本目标、广告对象、关键词、Listing 真实数据 |
| S3-04 | TODO | Collection workspace | S3-01/S3-02 | scope、任务 CRUD、运行历史、可见监控、导入检查 |
| S3-05 | TODO | Today projection | S3-02/S3-03 | 当前店铺真实准备度、下一动作和阻断原因 |
| S3-06 | TODO | 阶段质量 owner | S3-01..05 | 每店 8/8 采集导入 smoke、Repository/IPC/UI 聚焦测试、commit/push |

## 阶段 4：Mission、决策、策略、实验与因果账本

| ID | 状态 | Owner / 文件边界 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| S4-01 | TODO | shared-types/local-db | S3 | Mission、Decision、Policy Version、Experiment、Causal contracts/tables |
| S4-02 | TODO | Main domain services/preload | S4-01 | 状态机、Repository、事务、revision、审计 IPC |
| S4-03 | TODO | Missions workspace | S4-02 | 飞行计划、检查点、暂停/恢复/归档与关联链 |
| S4-04 | TODO | Decisions workspace | S4-02 | Crux decision、备选方案、CAS、MissionGrant、整批授权 |
| S4-05 | TODO | Policy workspace | S4-02 | 店铺/对象策略、版本、模式、限额、熔断、kill switch |
| S4-06 | TODO | Experiments workspace | S4-02 | 假设、指标、守护栏、观察窗、结论和引用保护 |
| S4-07 | TODO | Memory workspace | S4-02/S4-06 | 追加式 CausalLedger、证据引用与索引 |
| S4-08 | TODO | 阶段质量 owner | S4-01..07 | 状态机/CAS/跨店/因果链/Renderer 集中测试、commit/push |

## 阶段 5：真实分析与双模式授权

| ID | 状态 | Owner / 文件边界 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| S5-01 | TODO | rules-engine/ai-adapter | S3/S4 | store-scoped 量化、证据包、结构化提案、模型 revision |
| S5-02 | TODO | policy/decision services | S5-01 | 人工签发与策略签发 MissionGrant 的统一流水线 |
| S5-03 | TODO | Renderer Today/Mission/Decision | S5-01/S5-02 | 真实建议、批准来源、阻断与授权状态 |
| S5-04 | TODO | 阶段质量 owner | S5-01..03 | 缺数据、旧 revision、越权、跨店、预算和 AI 降级集中测试、commit/push |

## 阶段 6：真实 Amazon Ads 执行

| ID | 状态 | Owner / 文件边界 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| S6-01 | TODO | ad object registry/local DB | S3/S4 | canonical keyword identity、alias/resolution revision |
| S6-02 | TODO | action-executor/browser-worker | S5/S6-01 | 白名单关键词降价 preflight/apply/reload Adapter |
| S6-03 | TODO | ExecutionCoordinator/Main/preload | S6-02 | queue、BrowserLease、intent、idempotency、UNKNOWN、恢复 |
| S6-04 | TODO | Execution workspace | S6-03 | 可见浏览器、任务进度、人工接管、三段证据 |
| S6-05 | TODO | 人工 canary | S6-01..04 | 最新低风险对象，人工 MissionGrant，真实 before/after/reload |
| S6-06 | TODO | 策略自动 canary | S6-05 | 无人点击批准，由启用策略签发并真实执行回读 |
| S6-07 | TODO | 阶段质量 owner | S6-01..06 | 错店/错对象/幂等/UNKNOWN/崩溃/包体 smoke，commit/push |

## 阶段 7：完整交付

| ID | 状态 | Owner / 文件边界 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| S7-01 | TODO | Renderer/性能 | S6 | 十工作区 CRUD 收口、5 万行、键盘、100%/125% |
| S7-02 | TODO | migration/backup/security | S6 | 旧库升级、Profile 迁移、备份恢复、异常演练、secret scan |
| S7-03 | TODO | 连续运行验收 | S3..S6 | 两店连续 7 美国业务日 8/8 或明确 BLOCKED，零串店/假成功/重复导入 |
| S7-04 | TODO | package/evidence | S7-01..03 | installer、portable、package smoke、十工作区 UI、安全、readiness、bundle |
| S7-05 | TODO | 总负责人 | S7-04 | requirement-by-requirement completion audit、最终 commit/push |
