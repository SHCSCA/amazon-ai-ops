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
| S1-01 | DONE | `packages/shared-types` | S0 | `StoreId`、StoreContextEnvelope、connection/session/capability 合同 |
| S1-02 | DONE | `packages/local-db/src/sqlite/db.ts` 与 migration 模块 | S1-01 | `schema_migrations`、stores、connections、session metadata、quarantine |
| S1-03 | DONE | `packages/local-db/.../repositories` | S1-02 | StoreRepository、迁移回填、store-scoped repository contract |
| S1-04 | DONE | 新 store capsule/path 模块 | S1-01 | `%LOCALAPPDATA%/stores/{storeId}`、canonical path containment、备份 manifest |
| S1-05 | DONE | `packages/browser-worker` | S1-01/S1-04 | 每店 Lingxing/Ads Profile、BrowserLease、sessionGeneration |
| S1-06 | DONE | `apps/desktop/src/main`、`preload` | S1-02..05 | StoreCoordinator、店铺 CRUD/切换/连接 IPC、旧请求失效 |
| S1-07 | DONE | 阶段质量 owner | S1-01..06 | 迁移/隔离/Profile/凭证/桌面 smoke 集中验证与阶段 commit/push |

阶段 1 集中验证（2026-07-22）：11 个聚焦测试文件最终 80/80 通过；`shared-types`、`local-db`、`browser-worker`、`desktop` 四包 typecheck 通过；跨店 Profile、Repository、BrowserLease、StoreContext、迁移恢复和 generation 单调性均有回归。阶段提交 `87cb7600` 已推送至 `origin/codex/preview-contract-production-p2`。

## 阶段 2：Mission Control 正式 Renderer

| ID | 状态 | Owner / 文件边界 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| S2-01 | DONE | Renderer navigation/shell/types | S1 | 十工作区 canonical navigation 与顶部 StoreContext |
| S2-02 | DONE | Renderer design system/styles | S2-01 | 原型视觉迁移、响应式 Inspector、统一 CRUD primitive |
| S2-03 | DONE | Renderer query/command bridge | S1/S2-01 | 去除生产 localStorage authority，query projection + typed command |
| S2-04 | DONE | Renderer legacy adapters | S2-01 | 16 个旧路由映射为 subview/alias，不丢生产能力 |
| S2-05 | DONE | Dev preview/package UI evidence | S2-01..04 | 十工作区 fixture 合同和 UI evidence vNext |
| S2-06 | DONE | 阶段质量 owner | S2-01..05 | typecheck、导航/渲染聚焦测试、十工作区 100%/125% UI 证据、commit/push |

阶段 2 集中验证（2026-07-22）：19 个聚焦测试文件 224/224 通过；`shared-types` 与 `desktop` typecheck 通过；Renderer 生产构建通过（4705 modules）。当前 UI 证据为 `output/codex-evidence/mission-control-stage2-ui-20260722-final/manifest.json`：20 个工作区 100%/125% 捕获、StoreGate、SHC001→SHC002 事实/Profile 隔离与 1200px 最小窗口执行布局共 23 个 PNG，严格校验绝对路径、文件存在性和 SHA-256；证据明确不提供最终生产 READY credit。独立审查提出的 previewMode 真值门、canonical 多店 fixture 隔离、Objects CRUD 精确 capability gate 和 1200px 表格裁切均已修复并加入回归。

## 阶段 3：真实领星采集与运营底座

| ID | 状态 | Owner / 文件边界 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| S3-01 | DONE | collector/browser/page-model | S1/S2 | 店铺身份核验、可见下载中心、八报告任务 |
| S3-02 | DONE | report parser/local DB | S3-01 | store-scoped 批次、文件、幂等导入和 0.01 对账 |
| S3-03 | DONE | Objects workspace | S1/S2 | 店铺、产品、成本目标、广告对象、关键词、Listing 真实数据 |
| S3-04 | DONE | Collection workspace | S3-01/S3-02 | scope、任务 CRUD、运行历史、可见监控、导入检查 |
| S3-05 | DONE | Today projection | S3-02/S3-03 | 当前店铺真实准备度、下一动作和阻断原因 |
| S3-06 | BLOCKED | 阶段质量 owner | S3-01..05 | 每店 8/8 采集导入 smoke、Repository/IPC/UI 聚焦测试、commit/push |

阶段 3 集中验证（2026-07-22）：完整 Vitest 回归 226/226 个文件通过，2444 项通过、2 项按预期跳过；最后一轮 Objects/Event/Preview 聚焦回归 4 个文件 109/109 通过；`shared-types`、`local-db`、`browser-worker`、`lingxing-report-collector`、`report-parser`、`desktop` 六包 typecheck 通过，Desktop 生产构建通过（4711 modules）。可见原型已验证 SHC001/SHC002 数据隔离、广告对象、Listing 版本账本、店铺范围编辑，以及运营事件的创建→编辑→归档→恢复闭环。数据库身份冲突采用保留原行、隔离并失败关闭，不再启动时静默合并。当前唯一阶段阻断是缺少可授权的真实领星会话来完成每店 8/8 现场采集与导入 smoke；自动化、UI 预览或历史文件均不会冒充这项生产证据。

## 阶段 4：Mission、决策、策略、实验与因果账本

| ID | 状态 | Owner / 文件边界 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| S4-01 | DONE | shared-types/local-db | S3 | Mission、Decision、Policy Version、Experiment、Causal contracts/tables |
| S4-02 | DONE | Main domain services/preload | S4-01 | 状态机、Repository、事务、revision、审计 IPC |
| S4-03 | DONE | Missions workspace | S4-02 | 飞行计划、检查点、暂停/恢复/归档与关联链 |
| S4-04 | DONE | Decisions workspace | S4-02 | Crux decision、备选方案、CAS、MissionGrant、整批授权 |
| S4-05 | DONE | Policy workspace | S4-02 | 店铺/对象策略、版本、模式、限额、熔断、kill switch |
| S4-06 | DONE | Experiments workspace | S4-02 | 假设、指标、守护栏、观察窗、结论和引用保护 |
| S4-07 | DONE | Memory workspace | S4-02/S4-06 | 追加式 CausalLedger、证据引用与索引 |
| S4-08 | DONE | 阶段质量 owner | S4-01..07 | 状态机/CAS/跨店/因果链/Renderer 集中测试、commit/push |

阶段 4 集中验证（2026-07-22）：20 个领域/Repository/IPC/preload/Renderer 聚焦文件 219/219 项通过；排除两个因本机缺少 Playwright Chromium Headless Shell 而无法启动的证据脚本后，非浏览器完整回归 238/238 个文件通过，2530 项通过、2 项按预期跳过。`shared-types`、`local-db`、`desktop` typecheck 通过，Main、Preload、Renderer 生产构建通过（Renderer 4723 modules）。用户选定的应用内浏览器已按相同 1280×720 视口逐页对照原型与集成版，覆盖 Mission、Decision、Policy、Experiment、Memory 五个工作区及核心 CRUD/状态切换/跨店隔离交互；`missions/facts` 已切换到 canonical Mission 事实面且不再暴露新建 Mission。完整 `pnpm test` 的业务测试均通过，唯一两项失败均为上述本地 Playwright 可执行文件缺失，未冒充正式浏览器证据。实现提交 `af5783c6` 已推送，远端完整哈希与本地一致：`af5783c69c17b670e4738d742165247a1a2fc114`。

## 阶段 5：真实分析与双模式授权

| ID | 状态 | Owner / 文件边界 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| S5-01 | DONE | rules-engine/ai-adapter | S3/S4 | store-scoped 量化、证据包、结构化提案、模型 revision |
| S5-02 | DONE | policy/decision services | S5-01 | 人工签发与策略签发 MissionGrant 的统一流水线 |
| S5-03 | DONE | Renderer Today/Mission/Decision | S5-01/S5-02 | 真实建议、批准来源、阻断与授权状态 |
| S5-04 | DONE | 阶段质量 owner | S5-01..03 | 缺数据、旧 revision、越权、跨店、预算和 AI 降级集中测试、commit/push |

阶段 5 集中验证（2026-07-22）：排除两个必须启动 Playwright Chromium 的独立证据脚本后，非浏览器完整回归 746/746 个测试文件、2581/2581 项测试通过；14 个 workspace typecheck 已通过，最后修改涉及的 `local-db` 与 `desktop` 再次 typecheck 通过，Main、Preload、Renderer 生产构建通过。应用内浏览器已把原型与集成版放在同一轮对照中复核 Decision、Policy 和长表单交互；策略版本编辑器现为内部滚动且底部保存区可达。授权链新增 Mission 异步分析期 revision 事务校验，并覆盖证据/对象/批次/策略/规则/模型 revision、整批授权、窗口、日限额、冷却、kill switch、终态 grant 与策略自动不降级。实现提交 `c4ea7cc5` 已推送，远端完整哈希与本地一致：`c4ea7cc596dc240f96db5720796eec811a4c40e2`。

## 阶段 6：真实 Amazon Ads 执行

| ID | 状态 | Owner / 文件边界 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| S6-01 | DONE | ad object registry/local DB | S3/S4 | canonical keyword identity、alias/resolution revision |
| S6-02 | DONE | action-executor/browser-worker | S5/S6-01 | 白名单关键词降价 preflight/apply/reload Adapter |
| S6-03 | DONE | ExecutionCoordinator/Main/preload | S6-02 | queue、BrowserLease、intent、idempotency、UNKNOWN、恢复 |
| S6-04 | DONE | Execution workspace | S6-03 | 可见浏览器、任务进度、人工接管、三段证据 |
| S6-05 | BLOCKED | 人工 canary | S6-01..04 | 需要当前低风险真实关键词对象、当前人工 MissionGrant 与已登录可见领星 Ads 会话；未获这些当次授权前禁止真实写入 |
| S6-06 | BLOCKED | 策略自动 canary | S6-05 | 依赖先完成当前人工 canary，并需要已启用策略、实时 kill switch/会话与当次真实对象授权 |
| S6-07 | BLOCKED | 阶段质量 owner | S6-01..06 | 内部错店/错对象/幂等/UNKNOWN/崩溃验证已收口；受 S6-05/S6-06 当次真实授权与会话阻断，package smoke 延至 S7-04，当前不得声明 READY |

阶段 6 内部验证（2026-07-23）：产品范围固定为 Amazon US / USD，原型继续作为可见体验基准；实现只开放 `set_keyword_bid` 降价、单动作最多 10%、单批最多 10 个对象。Main Authority 在提交前重新核对店铺、Profile、Ads Account、Campaign、Ad Group、Keyword、对象 revision、MissionGrant、策略、kill switch 与当前可见会话；intent 落库后只允许一次保存点击，before / after / reload 必须绑定同一 canonical 对象和值。`UNKNOWN` 不自动重试，并会停止同批后续对象、撤销授权、保留因果事件与启动恢复标记。应用内浏览器已在相同视口对照原型与集成版，验证执行来源展开、身份解析、整批建队列、串行执行、三段回读、标签与详情切换。阶段集中回归 257/257 个测试文件通过，2670 项通过、2 项按既有条件跳过；14/15 workspace typecheck 通过，Main、Preload、Renderer 生产构建通过。实现提交 `4cb5a3870a4db8ef9ed8b1d795cbf3b4230d85fb` 已推送到 `origin/codex/preview-contract-production-p2`。真实人工 canary、策略自动 canary 与 package smoke 仍需当次真实对象、有效授权和已登录领星 Ads 可见会话，当前不得声明 READY。

## 阶段 7：完整交付

| ID | 状态 | Owner / 文件边界 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| S7-01 | TODO | Renderer/性能 | S6 | 十工作区 CRUD 收口、5 万行、键盘、100%/125% |
| S7-02 | TODO | migration/backup/security | S6 | 旧库升级、Profile 迁移、备份恢复、异常演练、secret scan |
| S7-03 | TODO | 连续运行验收 | S3..S6 | 两店连续 7 美国业务日 8/8 或明确 BLOCKED，零串店/假成功/重复导入 |
| S7-04 | TODO | package/evidence | S7-01..03 | installer、portable、package smoke、十工作区 UI、安全、readiness、bundle |
| S7-05 | TODO | 总负责人 | S7-04 | requirement-by-requirement completion audit、最终 commit/push |
