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
| Task 5A 共用视觉系统、Shell 与 Today | 已完成 | 任务优先 Today、8 工作区 Shell、fail-closed 运行态证据已通过独立双评审 |
| Task 5B 建议与审批 | 已完成 | 统一权威队列、响应式检查器、批量送审重载与审批状态守卫均通过独立代码/视觉复核 |
| Task 5C 结果核对 | 已完成 | v2 权威合同、PASS/NEEDS_WORK 分流、异步防串、只读预览和任务优先核对工作区均通过独立 Runtime、QA 与 UI/Product 复核 |
| Task 6A 产品工作台与数据准备 | 已完成 | 产品、范围、八报表、导入和事件子视图已迁入任务优先工作区并通过状态/长数据验证 |
| Task 6B 广告诊断与关键词/Listing | 已完成 | 诊断对象队列、关键词长表与 Listing 本地草案工作流已完成，真实报表和 local-only 边界保持不变 |
| Task 6C 系统与交付 | 已完成 | AI、规则、定时任务和交付状态已收敛到系统工作区，技术证据进入按需详情 |
| Task 7 全工作区运行体验验收 | 已完成 | 8 个工作区、43 个目标和 5 组业务 smoke 已通过；P0=0、P1=0（开发/运行态） |
| Task 6D 产品与诊断对象工作台纠偏 | 已完成 | 产品与诊断均已改为固定虚拟队列 + 响应式 Inspector；查看/保存/锁定、筛选/正式资格和阻断主动作语义已分离并通过独立 Product/QA/Reviewer 验收 |
| Task 7R 纠偏后运行体验复验 | 已完成 | 新 43/43 运行矩阵、1200 drawer、1400 inline、125%、全量测试、typecheck、renderer build 与 5/5 业务 smoke 已通过；完整对象身份绑定和首屏 AI 四态反馈已通过独立验收，P0=0、P1=0 |
| Task 8A 本地 NON_READY candidate | 已完成 | 当前 Windows candidate、package UI、哈希、smoke、7/8 readiness、NON_READY bundle 与 17/17 safety 已固定；Product/UX 8.6、QA 9.0、Reviewer 8.8，P0=0、P1=0 |
| Task 8B 外部真实 Ads v2 APP_READY | 外部证据待补 | 需要新的真实审批、Ads UI 执行、独立截图、reload 回读以及正整数 recommendationId/SQLite authority 校验 |

当前源码验收基线：最终全量测试 170/170 files、575/575 suites、1920/1920 tests 通过（`output/codex-evidence/task8a-full-vitest-20260717-final.json`）；工作区证据 43/43 通过（`output/codex-evidence/workspace-ui-task6/workspace-ui-evidence-run-2026-07-17T04-25-13-089Z.json`）；业务 smoke 5/5 通过（`output/codex-evidence/current-business-ui-smoke-1784262294451.json`）。最新批次 `batch_20260625013151957_ajw0nb` 已 8/8 类逐类入库，共 6827 行；产品页 1879 行是当前 ASIN 指标，不是全库总量。当前 Windows NON_READY candidate 已完成重建、包体 UI、哈希、smoke、7/8 readiness、bundle 与严格 NON_READY safety 17/17；唯一失败门为 `real-ad-execution-readback`。2026-07-16 及更早证据均为历史候选。Task 8B 外部真实 Ads v2 authority 门仍未完成。

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

### Task 5A：共用视觉系统、Shell 与 Today — 已完成

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

- [x] 先取得 `task-first-workspace-design.md` 的用户确认。
- [x] 为 `PageFrame / TaskBanner / SummaryStrip / WorkbenchPanel / PriorityDataTable / ActionMenu / WorkspaceState` 写 RED 契约。
- [x] 建立字体、间距、颜色、控件、状态与 120–180ms motion tokens。
- [x] 顶栏承载紧凑范围、连接/交付状态、账号；侧栏只保留 8 个工作区。
- [x] Today 按 `TaskBanner → SummaryStrip → 风险/对象队列 → 紧凑产品上下文` 重排。
- [x] 删除 Today 的重复 CTA、KPI 卡片墙、嵌套 disclosure 和主区内部滚动。
- [x] 在 1200×700、1400×900、1.25 DPR/zoom 下生成截图与 DOM 指标 JSON。
- [x] 完成独立 UI/UX 复核、代码质量复核与 scoped commit。

**闸门：** Today 首屏一眼可识别阻塞、下一动作与业务对象；无页面级水平溢出；一个纵向滚动所有者；一个主动作。

**验证：** Dashboard 88/88、workspace evidence 18/18、全量串行 140/140 test files（1208 passed / 2 skipped）、desktop typecheck、renderer build、5 组业务 smoke 与 5/5 Today viewport matrix 通过；实际 workspace/subview/scenario 身份不匹配时证据生成 fail-closed。

### Task 5B：建议与审批工作区

**信息结构：** `待判断 / 待审批 / 已决策`。

- [x] 先写队列、详情 inspector、旧 approval route fallback 与状态迁移测试。
- [x] 1400px 使用“队列 + 详情 inspector”；1200px 使用全宽队列 + 按需 drawer。
- [x] 主列只保留动作、对象、当前值→建议值、证据状态、决策。
- [x] campaign、ad group、来源、理由和技术证据移入 inspector，并将来源技术明细默认折叠。
- [x] 已批准/已拒绝记录进入 `已决策`，并持续显示“批准不等于执行”。
- [x] 验证批量选择、按钮 busy/peer lock、键盘焦点和 authority reload 不回退。
- [x] 捕获两个 viewport 与 125% 证据，完成独立代码与 UI/UX 复核。

**闸门：** 用户无需跨页面就能判断对象、证据、风险与决策结果；审批反馈不会被误认为 Ads 已执行。

**验证：** Decisions/旧 Recommendations/旧 Approval/preview/navigation/style 聚焦回归 192/192、desktop typecheck、renderer build、Ads fail-closed verifier、6/6 viewport matrix、真实 1200 drawer/1400 inline 交互 smoke 与全业务 5/5 smoke 通过。最新矩阵为 `output/codex-evidence/workspace-ui-task5b-decisions/workspace-ui-evidence-run-2026-07-14T06-13-53-172Z.json`；最新审批运行证据为 `output/codex-evidence/business-ui-ad-execution-smoke-1784009692861.json`；全业务汇总为 `output/codex-evidence/current-business-ui-smoke-1784009732378.json`。独立复核结果为 P0=0、P1=0、Critical=0、Important=0。

### Task 5C：结果核对工作区

#### 2026-07-14 运行合同决议

三个独立只读角色（Backend Runtime、Frontend/UX、QA/Acceptance）一致判定旧实现为 `BLOCK`。Task 5C 在下列合同全部转绿前不得进入视觉验收，也不得继承旧 `APP_READY`：

1. **API boundary**：renderer 只提交 `recommendationId + expectedRevision + 当前 scope/batch + operatorEvidence`。Main 必须重新读取数据库中的建议，确认仍为 `approved` 且 revision、店铺、站点、ASIN、日期范围、批次和真实来源文件一致；目标、来源、动作和审批身份全部由 Main 派生。
2. **Data contract**：回读证据升级为 v2，顶层携带 Main 生成的 `authority`（建议 id/revision、导出时状态、scope、batch、checkedAt）。无 authority、authority 被修改、旧 revision 或非 approved 行均不能通过 verifier/READY。
3. **Task/event flow**：`PASS` 导出直接校验 `exportResult.jsonPath`，绝不创建工作包；只有 `NEEDS_WORK` 才允许 `prepare -> check -> fill -> verify`。只有 verifier 返回 `ready=true` 才广播 `readback-verified`。
4. **Frontend integration**：scope/batch 生成稳定 query key；行加载、选择、表单、导出和校验都绑定 query key/request id/form epoch，旧异步结果不得发布。Preview 权限由 App 显式下发，即使注入写 API 也不能截图存证、导出、建包、填充或校验。
5. **Error/logging**：IPC 保持 Promise 兼容，但只向 UI 返回稳定中文可行动错误；SQL、堆栈和原始异常不得进入首屏。路径、命令、哈希和 verifier 细节只进入技术抽屉。
6. **Verification**：必须覆盖 authority 单测与临时真实数据库集成、PASS 直验、NEEDS_WORK 工作包、`ready=false` 不广播、scope/form race、恶意 preview 注入零写入、四个稳定 tabpanel、三个唯一修复动作及 1200/1400/125% 运行矩阵。
7. **Blockers**：P0/P1、UX Critical/Important、workspace evidence contract violation 任一非零时保持阻断；现有把 `PASS -> prepare` 当作成功的浏览器 mock smoke 必须改为与真实后端同构。

- [x] 保留四个语义步骤和 tab/tabpanel 键盘契约，只展开当前步骤。
- [x] 首屏只显示 TaskBanner、紧凑步骤摘要和当前核对工作区。
- [x] 工作包、路径、命令、哈希、verifier 细节集中到一个技术抽屉。
- [x] 缺截图、缺值、未校验各提供一个明确修复动作。
- [x] 保留 evidence write、readback verify、export 与 APP_READY 全部 fail-closed 边界。
- [x] 验证 preview 只能展示只读成功布局，不能写证据或解锁真实导出。
- [x] 完成运行态证据、独立复核与提交。

**闸门：** 用户首先看到“还缺什么、去哪里补”；技术路径不再占据首屏；真实核对与预览视觉明确区分。

**验证：** authority/READY/bundle 68/68、fill/preview/workspace broader 39/39、全仓 148/148 test files（1465 passed / 2 skipped）、全仓 typecheck、Main/Preload/Renderer 与 Windows installer/portable 构建均通过。最新业务 smoke 为 `output/codex-evidence/business-ui-ad-execution-smoke-1784081512998.json`；最新补证截图为 `output/codex-evidence/business-ui-ad-execution-readback-needs-work-1784081512998.png`；1200/1400/125% 视觉矩阵 6/6 通过。独立终审为 PASS，P0=0、P1=0；当前构建仍只是后续 Task 6–8 的中间候选，不声明新的 `APP_READY`。

### Task 6A：产品工作台与数据准备 — 已完成

- [x] 产品工作台合并 `products / targets / events`，以产品队列和当前锁定产品为核心。
- [x] 数据准备合并 `scope / reports / import-check`，以八报表进度和阻塞修复为核心。
- [x] 保留保存、批量 ACOS、事件上下文、报表采集与导入 IPC 契约。
- [x] 对 loading / empty / blocked / ready / busy / error 状态逐项验证。
- [x] 通过两个 viewport、125%、键盘与独立复核。

### Task 6B：广告诊断与关键词/Listing — 已完成

- [x] 广告诊断以风险/机会对象队列为主，指标和 AI 解释服务于当前对象。
- [x] 关键词与 Listing 合并 `keywords / current listing / local draft-export`。
- [x] 保持真实报表、AI 输出契约和 recommendation eligibility 不变。
- [x] 保持 Listing `仅本地预览/导出`，不得暗示提交 Amazon 或覆盖领星。
- [x] 对长表虚拟化、列优先级、筛选、热图和草稿状态做运行态验证。
- [x] 完成独立复核。

### Task 6C：系统与交付 — 已完成

- [x] 合并 AI 设置、定时任务和交付状态，默认只显示用户可理解的配置与状态。
- [x] 命令、路径、哈希、bundle 与 gate failure 进入技术详情。
- [x] 保留 key 加密、本地规则、scheduler 和 delivery evaluator 契约。
- [x] Preview 在该工作区始终明确显示“仅开发预览，不代表 APP_READY”。
- [x] 完成状态矩阵、运行态证据与独立复核。

### Task 6D：产品与诊断对象工作台纠偏 — 已完成

**触发原因：** 2026-07-17 对真实长数据重新审计后，产品页约 13.4 屏、诊断页约 15.2 屏；旧 runner 只验证页面可渲染，没有约束对象队列进入首屏、队列局部滚动、虚拟 DOM 行数或 sticky header，因此旧 PASS 对这两页属于验收盲区。

- [x] 由 UI、UX 架构、UX 研究和 QA 四个角色重新审计，固定“对象驱动的证据运营账本”方向，复用 Decisions 的队列 + Inspector 模型。
- [x] 为紧凑任务条、工作区唯一标题、虚拟队列标记和行内控件防误选建立共享 RED/GREEN 契约。
- [x] 产品页拆开 `focusedAsin` 与全局 `lockedAsin`：查看和保存都不得静默修改范围，只有显式“锁定”动作才允许更新全局 ASIN。
- [x] 产品页使用完整配置产品池、固定高度虚拟队列和响应式 Inspector；1200px drawer、1400px inline。
- [x] 诊断页保持“全部产品”是真正全量视图，视图筛选不得改变正式建议 eligibility；真实选中对象进入 Inspector，移除重复大表与重复 CTA。
- [x] 诊断与时间线使用包含 report identity 的完整 `objectKey` 和规范 `objectType` 严格绑定；同名跨报表、错类型或缺 key 均 fail-closed，不再退化为展示字段匹配。
- [x] AI 运行中、成功、规则兜底和失败原因默认显示在紧凑任务横幅中；技术详情保持折叠，失败时首屏提供“重新运行 AI / 检查 AI 设置”。
- [x] 保持真实报表、保存、AI、建议、审批、回读与 Listing local-only 安全合同不变；阻断态只保留顶部唯一修复主动作。

### Task 7R：纠偏后运行体验复验 — 已完成

- [x] runner 对产品/诊断启用 fail-closed experience contract：work surface、queue、scroll owner、sticky header、唯一 row key、DOM 行数上限、首屏高度和页面溢出。
- [x] 1200×700 至少看到 5 个完整队列行，1400×900 至少看到 8 个；队列滚动不得推动 `.app-content`。
- [x] 1200px 验证 drawer 的打开、Escape、焦点恢复和 busy lock；1400px 验证 inline Inspector。运行截图见 `interaction-product-inline-1400x900.png` 与 `interaction-diagnosis-inline-1400x900.png`。
- [x] 重新生成 100% 与 125% 截图/DOM JSON，运行聚焦测试、全仓测试、typecheck、renderer build 与业务 smoke。
- [x] 独立验收清零新的 P0/P1；Product 8.7/10、QA 8.8/10，独立 Reviewer 最终签字记录随本任务收口。

**非阻断后续：** 诊断 1400px 虚拟窗口探针已达到 30/30 DOM 行上限，1200px 页面溢出为 3px；后续字体或密度调整必须重点回归。1200px 技术依据浮层覆盖面积与任务条次动作拥挤可继续优化；AI 详细说明在窄屏使用单行省略和 `title` 提示，可在不破坏首屏密度的前提下评估两行失败态。上述均不替代 Task 8A 的新 Windows package UI、哈希、package smoke、readiness 与 NON_READY safety。

### Task 7：全工作区运行体验验收 — 已完成

- [x] 为每个迁移工作区验证：一个 `h1`、一个主动作、最多两个次动作、可见字 >=12px。
- [x] 验证无 `details details`、无页面级水平溢出、一个默认纵向滚动所有者。
- [x] 验证真实侧栏点击、menu/drawer Escape、焦点恢复、tabs、列表/表格键盘路径与 reduced motion。
- [x] 覆盖 7 个开发预览场景以及 loading、IPC error、long-task/cancel fixture。
- [x] 在 1200×700、1400×900 和 1.25 DPR/zoom 生成截图与 JSON 指标。
- [x] JSON 同时记录并校验目标/实际 workspace、subview、scenario、viewport、DPR、DOM metrics、时间与截图 SHA-256；隐藏主动作不得计入通过。
- [x] 验证不经滚动的真实首屏，并确保同页同名共享组件的 ARIA id 仍唯一。
- [x] 进行整分支 UI/UX 与代码复核，清零 P0/P1、Critical/Important。

**当前 Task 8A 证据：** 43/43 工作区目标见 `output/codex-evidence/workspace-ui-task6/workspace-ui-evidence-run-2026-07-17T04-25-13-089Z.json`；5/5 业务 smoke 见 `output/codex-evidence/current-business-ui-smoke-1784262294451.json`；170/170 files、575/575 suites、1920/1920 tests 见 `output/codex-evidence/task8a-full-vitest-20260717-final.json`；包体 UI 见 `output/codex-evidence/package-ui-evidence/2026-07-17T04-16-32-110Z/manifest.json`；readiness 见 `output/codex-evidence/final-readiness-20260717-task8a-non-ready.json`。

### Task 8A：本地 Windows NON_READY candidate — 已完成

- [x] 完成最终全量复跑：170/170 files、575/575 suites、1920/1920 tests、43/43 工作区证据和 5/5 业务 UI smoke 通过；其后只运行增量检查。
- [x] 确认最新批次 `batch_20260625013151957_ajw0nb` 已有 8/8 imported report types 和 6827 imported total rows；产品页 1879 是当前 ASIN 指标，不得再解释为全库总量或导入阻断。
- [x] 基于当前源码重新构建 Windows installer、portable EXE 与 win-unpacked；未复用 2026-07-16 候选哈希。
- [x] 对新 win-unpacked 与 portable app 运行 package-launch smoke，并在 100% / 125% 下完成 8/8 工作区、3/3 overlays；另在 1400×900 完成 Product/Diagnosis 宽屏队列与 inline inspector 包体证据。
- [x] 修复 Electron `before-quit` 异步清理竞态；包体三轮重启后无产品/profile Chromium 残留，authority DB 不变。
- [x] 重新生成 package index、installer/portable/win-unpacked/app-content SHA-256、authority DB 快照、evidence selection 与 final readiness，使其全部指向同一候选。
- [x] 刷新 README、用户指南、验收/进度/closeout 文档中的 package 路径、哈希和 readiness；历史值只保留为历史候选。
- [x] 导出新的 NON_READY delivery bundle，显式绑定最新 package/workspace UI manifest、同范围数据核对证据与 authority DB。
- [x] 对新 bundle 运行严格 NON_READY safety；当前结果为 17/17 PASS，不沿用旧 bundle 的 safety 数量或结论。
- [x] 完成独立 Product/UX、QA 与 Delivery Reviewer 验收：8.6/10、9.0/10、8.8/10，Task 8A 均为 PASS，P0=0、P1=0。

历史候选仅供追溯：2026-07-16 installer `8B8479D6D40E37D1F20D14D63107FF3EC1C1EBA68BB6FCA6D2CC6D9FD0455818`、portable `1FB7CDCE0B0FE0E76DB6D0BF795A293C9DD3CF03559A81CA48B83D1F956D966F`、package-launch smoke `output/codex-evidence/package-launch-smoke-1784189230056.json`、package UI `output/codex-evidence/package-ui-evidence/2026-07-16T09-04-21-298Z/manifest.json`、readiness `output/codex-evidence/final-readiness-2026-07-16T08-35-package-isolation.json`。这些证据早于 Task 6D/7R，不能代表当前源码，也不得用于声明 `APP_READY`。

### Task 8B：外部真实 Ads v2 APP_READY — 外部证据待补

- [ ] 选择一条当前 SQLite 中 `approved` 且具有正整数 `recommendationId`、当前 revision/scope/batch 的低风险建议。
- [ ] 完成新的真实审批、Ads UI 人工执行、互不复用的 before/after/reload 截图和回读值核对。
- [ ] 让 v2 readback 通过 `verify:ad-readback --db <当前 authority DB>`，且 final-readiness 八门全部通过。
- [ ] README 顶部切换为 `APP_READY` 后导出新的 READY bundle，并运行 READY safety。
- [ ] 完成独立 Delivery 复核，确认包哈希、smoke、readiness、bundle、文档和 SQLite authority 完全一致。

## 五、统一验收矩阵

| 层级 | 必须通过 | 不能替代 |
| --- | --- | --- |
| 源码 | focused tests、typecheck、renderer build | 不能证明界面可用 |
| 运行态 | DOM 指标、截图、键盘、滚动、缩放 | 不能证明生产 READY |
| 业务安全 | 真实报表、AI 合同、审批、回读、Listing local-only | 不能由预览 fixture 替代 |
| 包体 | installer/portable、unpacked/portable smoke、哈希 | 不能由 dev renderer 替代 |
| 本地交付 | APP_NEEDS_WORK final readiness、NON_READY bundle、docs、NON_READY safety | 必须与同一候选包和证据集一致 |
| APP_READY | 八门通过的 final readiness、READY bundle、docs、READY safety、真实 Ads v2 authority | 不能由本地候选或历史回读替代 |

## 六、完成定义

源码重构、运行态验收、Windows 包体候选、NON_READY bundle、safety 与独立复核均已完成；Task 8A 的以下 1–6 条全部满足：

1. 8 个工作区全部使用任务优先结构，旧 16 路由兼容仍通过；
2. 首屏可见性、滚动、缩放、键盘与状态矩阵全部通过；
3. 所有业务安全边界与 fail-closed readiness 未被削弱；
4. 新 Windows portable/installer 构建、启动和包体 UI 检查通过；
5. EXE 哈希、package smoke、`APP_NEEDS_WORK` final readiness、NON_READY bundle 与文档完全一致，并通过当前 NON_READY safety；
6. 全分支代码、UI/UX 和 Delivery 独立复核无阻断问题。

`APP_READY` 是第二层外部完成条件：在上述本地条件之外，还必须补齐当前真实 Ads v2 SQLite authority 回读，使 final-readiness 八门全部通过，再导出 READY bundle、运行 READY safety 并完成独立复核。在 Task 8B 完成前，状态只能表述为 `APP_NEEDS_WORK`，不得沿用旧包或历史回读的 APP_READY 结论描述新界面。
