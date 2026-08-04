# Mission Control 生产实施任务台账

> 总负责人维护。状态只依据当前工作树、commit、测试输出和真实运行证据更新。任务完成顺序遵循 `plans/mission-control-production-integration-plan.md`。

## 状态定义

- `TODO`：未开始。
- `ACTIVE`：已有明确 owner 正在开发。
- `REVIEW`：开发结束，等待阶段集中验证。
- `DONE`：阶段验证通过且 commit 已推送。
- `BLOCKED`：外部条件阻断且没有安全替代路径。

## 2026-08-04 当前集成检查点

- 当前包对应源码提交 `3f6fbec3f40fe8ad5dc64f3309474c5d2ea61bda`，状态仍是 `APP_NEEDS_WORK` / internal NON_READY。installer `EDEC273C...B96A`、portable `58C6D501...DEDE4`、win-unpacked `67DC2A70...5E89`、app content `FC173A2E...E43`、main bundle `9B0C43D5...32A`。
- 当前内部证据：`mission-control-ui-3f6fbec3\manifest.json` 完成 20 个 workspace captures + Store Gate + SHC001→SHC002 隔离 + 1200×900 执行布局，共 23 PNG，明确 `NO_FINAL_READINESS_CREDIT`；当前业务 UI smoke 5/5、package launch、package security 11/11、adversarial `NODE_ENV` 和 14 个 workspace/project typecheck 均通过。
- 当前生产阻断：schema v8 正式 package UI visible operator handoff、真实 authority DB 可恢复升级、每店真实 8/8、两店连续 7 个美国业务日、人工 Ads canary、policy-auto Ads canary、当前八门聚合与匹配 bundle。旧 `7/8`、Mission `4/8`、schema v7 manifest、旧 authority snapshot 和旧 bundle 只保留为历史证据，不能计入当前候选。
- 当前详细事实源为 `docs/MISSION_CONTROL_RELEASE_STATUS_2026-08-04.md`。下方 2026-07-22 至 2026-07-29 的阶段记录保留实现和审查轨迹；其中带“当前”的句子以本检查点为准。

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

阶段 2 集中验证（2026-07-22）：19 个聚焦测试文件 224/224 通过；`shared-types` 与 `desktop` typecheck 通过；Renderer 生产构建通过（4705 modules）。当前 UI 证据为 `output/codex-evidence/mission-control-stage2-ui-20260722-final/manifest.json`：10 个工作区各完成 100%/125% 捕获，共 20 次 workspace capture，另含 StoreGate、SHC001→SHC002 事实/Profile 隔离与 1200px 最小窗口执行布局，共 23 个 PNG；证据严格校验绝对路径、文件存在性和 SHA-256，但明确不提供最终生产 READY credit。独立审查提出的 previewMode 真值门、canonical 多店 fixture 隔离、Objects CRUD 精确 capability gate 和 1200px 表格裁切均已修复并加入回归。

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
| S7-01 | DONE | Renderer/性能 | S6 | 十工作区正式矩阵、设置 CRUD、5 万行、键盘、100%/125% package 证据合同已收口并推送；真实 package 截图归 S7-04 |
| S7-02 | DONE | migration/backup/security | S6 | v7→v8 全链升级备份、只恢复到新文件、显式离线迁移、Profile 单店绑定/回滚/防篡改已完成并推送 |
| S7-03 | BLOCKED | 连续运行验收 | S3..S6 | 只读验收器已完成；仍需两家真实店铺自然经过连续 7 个美国业务日并形成每天 8/8 或明确终态 BLOCKED 的外部证据 |
| S7-04 | ACTIVE | package/evidence | S7-01..03 | 当前 package source `3f6fbec3` 的 installer/portable、launch、安全与 adversarial `NODE_ENV` 已通过；项目随包 Playwright Chromium 已解决运行时来源，schema v8 正式 package UI 仍需用户完成 visible operator handoff；通过 manifest 与匹配 bundle pending |
| S7-05 | REVIEW | 总负责人 | S7-04 | 8 门生产就绪聚合器与逐项审计代码已完成；当前候选尚未生成新的聚合结果，历史 4/8 不复用，等待 S7-03/S7-04 与两条真实 canary 的当前证据后重跑 |

阶段 7A/7B 内部验证（2026-07-23）：第一版继续固定 Amazon US / USD；新增店铺级运行配置的创建、修改、可恢复归档与版本历史，并把目标 ACOS、分析窗口、最低建议置信度和店铺 AI 开关接入正式分析 Authority。10 个正式工作区的 package UI 基线已替换旧 8 页矩阵，要求 100%/125% 各一份、唯一 H1、无横向溢出、canonical 子视图 End/Home 键盘往返和三项只读 overlay 焦点证据；真实 package 截图仍由 S7-04 生成。5 万行验证使用生产同款 TanStack virtualizer，在首段/中段/末段分别只渲染 22/32/22 行，并验证稳定行键、Enter/Space 选择与粘性表头合同。数据库升级在任何待执行迁移前创建完整恢复点，校验 integrity/schema/行数/SHA；离线升级必须显式绑定绝对源路径与 SHA，禁止猜测 AppData 或原地覆盖。浏览器 Profile 迁移要求当前店铺、Provider、停止状态与身份凭证一致，拒绝 junction、歧义绑定、非空目标、哈希复用与篡改恢复。两店 7 美国业务日验收器要求每日 8 个下载检查点、8 类导入、8 份匹配对账且无 Profile/指纹/文件哈希串店；当前没有自然经过的 7 日真实证据，S7-03 保持 BLOCKED。集中验证 18/18 个聚焦测试文件、197/197 项通过；14/14 含 typecheck 的 workspace 通过；全量非浏览器回归 268/268 个文件、2713 项通过、2 项既有条件跳过；Main、Preload、Renderer 生产构建通过。迁移恢复 CLI 在没有显式离线 manifest 时按设计失败关闭，未触碰当前用户数据库；当前不得声明 READY。

阶段 7C 生产就绪审计（2026-07-23）：新增 8 门失败关闭聚合器，旧 v1.5 的 7/8 只允许由新的数据库回溯人工 canary 与策略自动 canary 共同取代，任何其他旧门失败均拒绝。聚合器会重新核对 package UI 截图文件与 SHA、只读 SQLite 快照、两店七个周一至周五美国业务日、MissionGrant/执行任务/三段回读以及 Store Capsule 路径和文件哈希，手写 PASSED JSON 不能直接获得信用。首轮 117/117 项聚焦回归通过，但独立审查发现包体/数据库根未锚定、app content 未现场重算、全 BLOCKED 可误计连续运行以及旧证据重放四项 P1 假 READY 风险；修复后生产聚合器固定 canonical release 与 AppData authority snapshot 根，现场重算 EXE/app content/Main bundle，拒绝 symlink/reparse/hardlink，强制同包同快照与时间顺序，并把连续运行收紧为 14/14 `SUCCESS_8_OF_8`。阶段边界共 129/129 项通过；重新生成的 `output/codex-evidence/mission-control-production-readiness-20260723-stage7c-hardened-non-ready.json` 仍按预期为 `APP_NEEDS_WORK` 4/8：v1.5 基线、当前 package launch、安全边界、adversarial `NODE_ENV` 通过；十工作区 package UI、两店连续七日、人工 canary、策略自动 canary 缺失。当前 package UI 所需独立 Chromium 不存在，且用户已选定只使用应用内浏览器，因此未擅自安装或切换浏览器；严格 NON_READY bundle 未导出。阶段 7A/7B 提交 `9392aecd`、Windows package 确定性修复 `85ce509e` 与 Stage 7C 审计提交 `b8075d38` 均已推送至 `origin/codex/preview-contract-production-p2`。

阶段 7D 当前非最终状态（2026-07-27，取代上段中的当前阻断描述但保留其历史审计事实）：第一版仍固定 Amazon US / USD，正式矩阵为 10 个 Mission Control 工作区。当前包 installer `AA3F15...0C14`、portable `17B881...B811`、win-unpacked `67DC2A...5E89`、app content `2FA784...30D5`、main bundle `2DEB38...C4838`；package launch、security boundaries 与 adversarial `NODE_ENV` 已通过。项目自带 Playwright Chromium 已进入 `resources/app/playwright-browsers/chrome-win64`，不再依赖用户日常 Chrome。package UI 合同已升级到 schema v7：每轮必须由 visible operator handoff 完成登录，runner 不读取、输入或点击秘密；首轮必须证明 fresh typed + saved、non-reused、identity-verified，saved continuation 也必须形成新的有界 Main 证明。本轮可见登录窗口被外部关闭，最新 manifest 因 target page/context/browser closed 而失败，真实 DB 前后保持不变；通过的 100%/125% 十工作区 manifest 与严格 NON_READY bundle 仍 pending。`final-readiness-20260727-stage8-non-ready-v7.json` 的 7/8 只是 v1.5 legacy baseline；重新绑定当前四项已通过内部门生成的 `mission-control-production-readiness-20260727-stage8-interim-4-of-8-v7.json` 仍为正式 Mission 4/8，缺 package UI、两店连续七日、人工 canary、policy-auto canary，绝不能提前写为 5/8。旧 `current-business-ui-smoke` 五个脚本仍等待 v1.5 标题/动作，本轮 5/5 失败，不计当前通过证据。

阶段 7E authority/evidence 生产链收口（2026-07-28，取代 7D 中的当前证据路径）：新增 WAL-safe SQLite online backup authority snapshot v2 导出器、只从 snapshot 读取的连续运行证据器，以及从 snapshot DB 权威行和 Store Capsule before/after/reload 工件只读重建的人工/policy-auto canary 导出器。正式聚合器现在强制显式 `--authority-db`，拒绝多候选猜测和 v1 snapshot，并重开 snapshot 执行 `query_only`、integrity/FK、独立文件/根目录/包三重身份校验；三项工具不会执行 Ads 或修改 DB。独立审计进一步发现 SQLite WAL 中已提交的授权变化不会改变 main DB SHA/mtime，现已统一加入 `sqlite-authority-currentness-proof/v1`：continuous、canary 与正式聚合器都用只读 SQLite online backup 重建 live committed 视图，并在工作前、最终写入前、写入后与选定 snapshot 的 bytes/SHA 比对；WAL-only 授权撤销和 Store Capsule TOCTOU 均失败关闭。最终组合聚焦验证 6 个文件、133/133 项通过。当前明确 AppData live DB 已生成 `authority-snapshots\2026-07-27T08-27-40-681Z-0faeb2d2-2280-4b75-a1b2-083f8da806a6\snapshot-manifest.json`，snapshot SHA-256 `7E3C7B...A5DD`，三次 fresh online-backup currentness 均匹配；但快照只有 24 张 legacy 表，尚无 Mission `stores` / execution authority 表，不能伪造两店连续运行或 canary。最新 schema v7 package UI `2026-07-27T08-10-15-137Z\manifest.json` 因首轮 15 分钟内未形成 ERP + Ads ready 而 fail-closed，protected DB 主文件前后 SHA-256 均为 `9E8206...7439`。显式绑定该失败 manifest、live DB 与 snapshot v2 的 `mission-control-production-readiness-20260728-stage8-wal-currentness-4-of-8.json` 输入合同与 WAL-aware currentness 通过，正式状态仍为 `APP_NEEDS_WORK` 4/8。

## 阶段 8：运行配置闭环与持续运营

| ID | 状态 | Owner / 文件边界 | 依赖 | 交付物 |
| --- | --- | --- | --- | --- |
| S8-01 | DONE | Main AI/runtime authority | S5/S7 | 系统级 OpenAI-compatible 配置、Main-only Key、AI runtime fingerprint 与分析规则 fingerprint 分域；生成入口绑定不可变快照并阻断 A→B→A TOCTOU |
| S8-02 | DONE | Main scheduler/collection + Renderer | S3/S7 | 当前店铺/Profile 可见领星会话、美国业务日、采集窗口和持久幂等调度闭环；“当前店铺自动化”七状态与二次确认已接入 |
| S8-03 | DONE | Store Capsule/evidence retention | S7 | 路径无关 StoreContext-only dry-run 摘要、全引用保护、只读派生 Capsule 和旧全局删除器禁用已完成 |
| S8-04 | BLOCKED | 真实运行验收 | S6/S8-02 | 两店七个美国业务日、低风险人工 canary、策略自动 canary；依赖真实登录会话、当次对象与授权 |
| S8-05 | REVIEW | 总负责人 | S8-01..04 | authority snapshot/continuous/canary 生产工具、WAL-aware currentness 与正式聚合合同已收口；当前 package source `3f6fbec3` 尚无 schema v8 pass manifest、当前 authority lineage、连续运行、人工 canary、policy-auto canary 或新聚合结果，严格 bundle pending |

阶段 8 固定边界：第一版只支持 Amazon 美国站和 USD；店铺数据、浏览器 Profile、任务、证据与运行配置相互隔离。AI 连接继续是系统级配置，店铺只持有启停和分析规则；采集调度不会自动切换店铺或复用别店 Profile。真实写入仍只允许人工批准或命中已启用策略的整批授权，`UNKNOWN` 继续停止并交由人工核对。

阶段 8A–8D 内部验证（2026-07-23）：AI Key 只保留在 Main `safeStorage`，模型修订绑定 provider/Base URL/model/温度/输出长度/人设/提示词合同/店铺 AI 开关，分析规则修订只绑定影响分析的阈值；一次分析从证据封存到两段 AI 生成始终使用同一冻结快照，设置 A→B→A 也不能复用旧授权。店铺调度固定领星美国站八报表采集合同，fingerprint 绑定店铺/Profile/业务日/回看窗口/日期范围而不绑定触发分钟，已认领、成功、失败和 `UNKNOWN` 均不会因改时间或重连会话自动重试；应用退出把未完成认领写为 `APP_EXIT_INTERRUPTED`，迟到结果不能覆盖。采集只要求经验证的领星 ERP Profile 能通过可见浏览器进入下载中心，真实 Ads 写入仍严格要求独立 Ads controller、connection、page、external account、ready session、Profile 与 generation 全部匹配。

证据保留第一版严格为 dry-run：完整候选 manifest 只留在 Main，IPC/Preload 只传路径无关汇总；当前店铺 Store Capsule 中超过保留期且无任一店铺 DB/Authority 引用的普通 `screenshots`/`traces` 才能成为候选，`evidence`、`reports`、`downloads`、`backups` 和浏览器 Profile 永久保护。跨店引用、路径逃逸、symlink/junction、hardlink、缺失 Capsule、异常文件类型和过期 StoreContext 均失败关闭，扫描过程只派生路径且不创建目录；没有 delete/apply API。独立核心与留存审查共发现 6 个 P1，均已修复且复审无新增 P0/P1。

“当前店铺自动化”替换旧全局 Cron CRUD，显示当前店铺、US/USD、业务日、时区、会话代次、配置版本、七状态计划和只读保留汇总；立即采集必须二次确认并再次由 Main 核对 StoreContext。应用内浏览器在 1280×720 下验证侧栏 216px、主区无横向溢出、SHC001/SHC002 切换后计划、配置版本、窗口与安全阻塞独立，确认框 Esc 关闭并把焦点返回“立即采集”；DEV 页面明确 `PROTOTYPE_ONLY`，不形成 package 或生产执行证据。集中验证 20 个文件 243/243 项、复审后 8 个文件 135/135 项通过；全量非浏览器回归 277/277 个文件通过，2825 项通过、2 项条件跳过；14/15 workspace typecheck 通过；Main、Preload、Renderer 生产构建通过（Renderer 4733 modules，只有既有 chunk 体积提示）。2026-07-27 已由项目随包 Playwright Chromium 取代早期缺少独立浏览器的环境阻断，并开始运行 schema v7 package UI；当前运行因 visible operator handoff 窗口被外部关闭而安全失败，尚未生成通过 manifest。真实连续运行、Ads canary 和严格 bundle 仍未形成，当前不得声明 READY。阶段实现提交 `d43cfc8f` 已推送至 `origin/codex/preview-contract-production-p2`。
