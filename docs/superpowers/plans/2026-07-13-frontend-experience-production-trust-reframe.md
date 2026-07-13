# Amazon AI Ops 前端体验与生产可信性重构计划

> **执行方式：** 主代理担任 Project Leader；实现阶段使用 `superpowers:subagent-driven-development`，每个任务由独立实现代理和独立复核代理完成。创意实现以 `docs/superpowers/specs/2026-07-13-task-first-workspace-design.md` 获得用户确认作为 Task 5A 的启动闸门。

**目标：** 把当前 16 路由、卡片堆叠、技术信息前置的 Electron 界面，重构为 7 个日常工作区加 1 个系统工作区；让用户进入任意页面后立即知道“当前阻塞、下一安全动作、正在处理的业务对象”，最终交付重新构建并验证的 Windows EXE 与一致的 READY 证据链。

**核心界面模型：** 一个紧凑的“运营作战单”连接一个真实“对象队列”。首屏只保留一个主任务、一个主动作和不超过两个次动作；表格、队列或编辑工作台占据主视觉，技术证据按需展开。

**技术边界：** 保留现有 Electron IPC、真实报表、人工审批、Ads 执行回读、Listing 仅本地、包体 smoke 和 APP_READY 的 fail-closed 安全边界。旧的 16 个 `AppRoute` 继续作为兼容输入，但不再等权展示在侧栏。

## 一、当前基线

| 阶段 | 状态 | 已确认结果 |
| --- | --- | --- |
| Task 1 测试与原生依赖 | 已完成 | Node/Electron ABI 准备链稳定；全量测试可串行通过 |
| Task 2 统一就绪判定 | 已完成 | 桌面端与 CLI 使用同一 fail-closed evaluator；缺失、过期、哈希不匹配均失败 |
| Task 3 显式开发预览 | 已完成 | 7 个预览场景只在显式 DEV 条件下启用；预览不能写证据或成为 APP_READY |
| Task 4 工作区导航基础 | 已完成 | 8 个可见工作区、16 路由兼容、`NextSafeAction`、工作流失效刷新已落地 |
| Task 5–8 界面与交付 | 待执行 | 等待本设计与计划确认后开始 |

当前有效验证基线：422 个测试套件、1165 个测试通过；Task 1–4 已分别提交并通过独立复核。后续不得用旧 APP_READY 证据声明新 UI 已交付。

## 二、固定约束

- 仅面向 Windows 桌面与浅色主题；不扩展移动端或暗色主题。
- 保护当前工作树；不提交 `output/`、`storage/`、AppData、数据库、原始领星报表、release EXE 或密钥。
- 可见导航固定为：`今日任务 / 产品工作台 / 数据准备 / 广告诊断 / 建议与审批 / 结果核对 / 关键词与 Listing / 系统与交付`。
- 所有主业务文案使用亚马逊运营语言；action code、batch id、JSON、命令、路径、哈希和 verifier 术语进入技术抽屉。
- 首屏恰好一个 `h1`、一个可见主动作、不超过两个次动作；可见文字不得小于 12px。
- `.app-content` 是默认纵向滚动所有者；只有明确标记的虚拟表格可以拥有局部纵向滚动。
- 运行态必须验证 1200×700、1400×900 与 125% 缩放；页面级不得横向溢出。
- 预览截图只证明布局；只有新包、package smoke、匹配哈希、final readiness、READY bundle、文档和安全检查同时一致，才可声明 APP_READY。

## 三、职责与协作

| 角色 | 责任 |
| --- | --- |
| Project Leader（主代理） | 维护计划、拆任务、保护安全边界、审查证据、控制合并与最终验收 |
| UI System 实现代理 | 共用组件、样式分层、Shell、Today 与运行态指标 |
| Workspace 实现代理 | Decisions、Readback 及后续业务工作区迁移 |
| UX/QA 复核代理 | 信息层级、交互状态、键盘行为、缩放与可访问性独立复核 |
| Delivery 复核代理 | Windows 包、smoke、哈希、READY 证据与文档一致性复核 |

每个实施任务遵循：失败测试或可复现基线 → 实现 → 聚焦验证 → 运行界面证据 → 独立复核 → 单独提交。未解决的 P0/P1 或 Critical/Important 问题阻止进入下一阶段。

## 四、执行计划

### Task 1：稳定测试与原生依赖基线 — 已完成

- [x] 为 Vitest 增加 Node native rebuild 准备链。
- [x] 为 Electron package 增加 `electron-builder install-app-deps` 准备链。
- [x] 修正过时的字符串契约测试，不回退已批准的表格优先界面。
- [x] 串行运行 SQLite、renderer、package-script 与全量测试。
- [x] 独立复核通过。

### Task 2：恢复唯一生产就绪判定链 — 已完成

- [x] 为缺失 smoke、过期 smoke、package hash mismatch 增加失败测试。
- [x] 桌面端与 CLI 统一使用 shared evaluator。
- [x] 保留稳定 gate id、failures、package smoke 与当前包哈希。
- [x] 修复 verifier 的结构化 tab/tabpanel 与边界契约。
- [x] 聚焦测试、typecheck、verifier 与独立复核通过。

### Task 3：让开发预览显式且内部一致 — 已完成

- [x] 仅允许 `DEV + localhost + preview=1 + scenario` 启动预览。
- [x] 建立 7 个具名场景，并确保跨页面状态一致。
- [x] `delivery-ready` 保持 preview-only、不可写证据、不可成为 APP_READY。
- [x] runtime bootstrap、Delivery selector、SSR 与 renderer 构建验证通过。

### Task 4：建立八工作区与下一安全动作模型 — 已完成

- [x] 建立 `PrimaryWorkspace / WorkspaceSubview / NavigationIntent`。
- [x] 将全部 16 个旧路由映射到 8 个工作区并保留事件兼容。
- [x] 建立证据驱动且 fail-closed 的 `NextSafeAction`。
- [x] 成功 mutation 后触发 workflow invalidation 并回载权威证据。
- [x] 聚焦测试 228/228、typecheck、Ads verifier、全量测试与独立复核通过。

### Task 5A：共用视觉系统、Shell 与 Today

**主要文件**

- 新建：`apps/desktop/src/renderer/components/workspace/`
- 新建：`apps/desktop/src/renderer/styles/tokens.css`
- 新建：`apps/desktop/src/renderer/styles/foundations.css`
- 新建：`apps/desktop/src/renderer/styles/shell.css`
- 新建：`apps/desktop/src/renderer/styles/workspace.css`
- 新建：`apps/desktop/src/renderer/styles/priority-table.css`
- 新建：`apps/desktop/src/renderer/styles/states-motion.css`
- 修改：Shell、Today 与样式入口
- 测试：共用组件、首屏动作、滚动所有权、viewport runtime runner

**交付内容**

- [ ] 先取得 `task-first-workspace-design.md` 的用户确认。
- [ ] 为 `PageFrame / TaskBanner / SummaryStrip / WorkbenchPanel / PriorityDataTable / ActionMenu / WorkspaceState` 写 RED 契约。
- [ ] 建立字体、间距、颜色、控件、状态与 120–180ms motion tokens。
- [ ] 顶栏承载紧凑范围、连接/交付状态、账号；侧栏只保留 8 个工作区。
- [ ] Today 按 `TaskBanner → SummaryStrip → 风险/对象队列 → 紧凑产品上下文` 重排。
- [ ] 删除 Today 的重复 CTA、KPI 卡片墙、嵌套 disclosure 和主区内部滚动。
- [ ] 在 1200×700、1400×900、1.25 DPR/zoom 下生成截图与 DOM 指标 JSON。
- [ ] 完成独立 UI/UX 复核与 scoped commit。

**闸门：** Today 首屏一眼可识别阻塞、下一动作与业务对象；无页面级水平溢出；一个纵向滚动所有者；一个主动作。

### Task 5B：建议与审批工作区

**信息结构：** `待判断 / 待审批 / 已决策`。

- [ ] 先写队列、详情 inspector、旧 approval route fallback 与状态迁移测试。
- [ ] 1400px 使用“队列 + 详情 inspector”；1200px 使用全宽队列 + 按需 drawer。
- [ ] 主列只保留动作、对象、当前值→建议值、证据状态、决策。
- [ ] campaign、ad group、来源、理由和技术证据移入 inspector。
- [ ] 已批准/已拒绝记录进入 `已决策`，并持续显示“批准不等于执行”。
- [ ] 验证批量选择、按钮 busy/peer lock、键盘焦点和 authority reload 不回退。
- [ ] 捕获两个 viewport 与 125% 证据，完成独立复核与提交。

**闸门：** 用户无需跨页面就能判断对象、证据、风险与决策结果；审批反馈不会被误认为 Ads 已执行。

### Task 5C：结果核对工作区

- [ ] 保留四个语义步骤和 tab/tabpanel 键盘契约，只展开当前步骤。
- [ ] 首屏只显示 TaskBanner、紧凑步骤摘要和当前核对工作区。
- [ ] 工作包、路径、命令、哈希、verifier 细节集中到一个技术抽屉。
- [ ] 缺截图、缺值、未校验各提供一个明确修复动作。
- [ ] 保留 evidence write、readback verify、export 与 APP_READY 全部 fail-closed 边界。
- [ ] 验证 preview 只能展示只读成功布局，不能写证据或解锁真实导出。
- [ ] 完成运行态证据、独立复核与提交。

**闸门：** 用户首先看到“还缺什么、去哪里补”；技术路径不再占据首屏；真实核对与预览视觉明确区分。

### Task 6A：产品工作台与数据准备

- [ ] 产品工作台合并 `products / targets / events`，以产品队列和当前锁定产品为核心。
- [ ] 数据准备合并 `scope / reports / import-check`，以八报表进度和阻塞修复为核心。
- [ ] 保留保存、批量 ACOS、事件上下文、报表采集与导入 IPC 契约。
- [ ] 对 loading / empty / blocked / ready / busy / error 状态逐项验证。
- [ ] 通过两个 viewport、125%、键盘与独立复核后提交。

### Task 6B：广告诊断与关键词/Listing

- [ ] 广告诊断以风险/机会对象队列为主，指标和 AI 解释服务于当前对象。
- [ ] 关键词与 Listing 合并 `keywords / current listing / local draft-export`。
- [ ] 保持真实报表、AI 输出契约和 recommendation eligibility 不变。
- [ ] 保持 Listing `仅本地预览/导出`，不得暗示提交 Amazon 或覆盖领星。
- [ ] 对长表虚拟化、列优先级、筛选、热图和草稿状态做运行态验证。
- [ ] 独立复核后提交。

### Task 6C：系统与交付

- [ ] 合并 AI 设置、定时任务和交付状态，默认只显示用户可理解的配置与状态。
- [ ] 命令、路径、哈希、bundle 与 gate failure 进入技术详情。
- [ ] 保留 key 加密、本地规则、scheduler 和 delivery evaluator 契约。
- [ ] Preview 在该工作区始终明确显示“仅开发预览，不代表 APP_READY”。
- [ ] 完成状态矩阵、运行态证据、独立复核与提交。

### Task 7：全工作区运行体验验收

- [ ] 为每个迁移工作区验证：一个 `h1`、一个主动作、最多两个次动作、可见字 >=12px。
- [ ] 验证无 `details details`、无页面级水平溢出、一个默认纵向滚动所有者。
- [ ] 验证 menu/drawer Escape、焦点恢复、tabs、列表/表格键盘路径与 reduced motion。
- [ ] 覆盖 7 个开发预览场景以及 loading、IPC error、long-task/cancel fixture。
- [ ] 在 1200×700、1400×900 和 1.25 DPR/zoom 生成截图与 JSON 指标。
- [ ] JSON 记录 workspace、subview、scenario、viewport、DPR、DOM metrics、时间与截图 SHA-256。
- [ ] 进行整分支 UI/UX 与代码复核，清零 P0/P1、Critical/Important。

### Task 8：重建并验证 Windows 交付

- [ ] 运行全量测试、typecheck、renderer build、业务 UI smoke、Ads verifier、依赖/安全检查。
- [ ] 构建 Windows installer 与 portable EXE candidate。
- [ ] 对 unpacked 与 portable app 运行 package-launch smoke。
- [ ] 在真实 Windows 100% 与 125% 缩放下检查 8 个工作区和关键 dialog/drawer。
- [ ] 验证 package index、portable SHA-256、smoke 和 final-readiness 指向同一候选包。
- [ ] 更新 README、用户指南、验收/进度/closeout 文档。
- [ ] 导出 READY bundle 并运行 READY safety。
- [ ] 完成独立 Delivery 复核后，才报告新的权威 EXE 路径、哈希和 APP_READY 状态。

## 五、统一验收矩阵

| 层级 | 必须通过 | 不能替代 |
| --- | --- | --- |
| 源码 | focused tests、typecheck、renderer build | 不能证明界面可用 |
| 运行态 | DOM 指标、截图、键盘、滚动、缩放 | 不能证明生产 READY |
| 业务安全 | 真实报表、AI 合同、审批、回读、Listing local-only | 不能由预览 fixture 替代 |
| 包体 | installer/portable、unpacked/portable smoke、哈希 | 不能由 dev renderer 替代 |
| 交付 | final readiness、READY bundle、docs、READY safety | 必须与同一包和证据集一致 |

## 六、完成定义

只有同时满足以下条件，项目才算完成：

1. 8 个工作区全部使用任务优先结构，旧 16 路由兼容仍通过；
2. 首屏可见性、滚动、缩放、键盘与状态矩阵全部通过；
3. 所有业务安全边界与 fail-closed readiness 未被削弱；
4. 新 Windows portable/installer 构建、启动和人工检查通过；
5. EXE 哈希、package smoke、final readiness、READY bundle 与文档完全一致；
6. 全分支代码、UI/UX 和 Delivery 独立复核无阻断问题。

在 Task 8 完成前，状态统一表述为“重构进行中”，不得沿用旧包的 APP_READY 结论描述新界面。
