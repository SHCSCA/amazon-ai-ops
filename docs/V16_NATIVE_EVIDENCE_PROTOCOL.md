# V1.6 原生验收证据协议

> 2026-10-27 文档对齐：本文定义合同、方法或验收案例，不提供当前通过结论。现行状态、失败与后续计划统一见 [项目状态](PROJECT_STATUS.md)；当前仍为 APP_NEEDS_WORK / INTERNAL NON_READY。正文中的旧检查点只适用于当时版本。

本协议描述软件校验能力，不表示当前包已完成 L4–L7。隔离夹具只能证明校验分支；真实包、正式库、店铺会话、屏幕阅读器操作和 Ads 回读仍须现场采集。治理定义文件的 PENDING 状态保持原样。

## 入口与身份

`scripts/v16-native-evidence-cli.js` 接收 `--test-id`、`--packet`、`--started-at`、`--finished-at`、`--out`，可选 `--repo-root`。输出必须是 `output/` 中尚不存在的新文件。失败输出保持失败退出码和结构化诊断，不生成成功信用。

外层 `v16.evidence/1` 绑定当前源码、包版本、安装包、便携包、ZIP、应用内容及 Main 哈希。内层 `v16.native-checks/1` 包含：

| 字段 | 约束 |
|---|---|
| testId / runId / sourceSha256 | 当前必需测试、唯一执行标识、当前源码 |
| checks | 必须与该测试 requiredChecks 精确一致 |
| nativeArtifacts | 唯一 id、固定 adapter、runId、path、sha256 |
| nativeArtifactIds | 按固定 adapter 顺序引用完整原件 |

`success`、`passed` 和原报告汇总均不单独授予信用。适配器重新执行专用校验，检查原件、包体、运行、店铺及时间。L4/L5 原件最长 30 天，L6 最长 14 天，L7 最长 3 天；原件时间还必须位于本次 execution 时间窗内。

## 固定校验职责

| 层 | 必需校验与原件 |
|---|---|
| L4 | 当前 Package UI schema v9，六模块22入口、100%/125%/wide/minimum、弹窗键盘；中文失败→重试→恢复原始事件/日志/截图；治理定义、现场登记、屏幕阅读器及缩放操作原件 |
| L5 | 安装/便携/ZIP 原生启动和重启、SQLite/DuckDB 原生探针、导航/外链边界、关闭清理；三种包和完整目录内容身份 |
| L6 | 当前正式 authority 快照、WAL-safe 在线备份及采集前/发布前 currentness 重验；离线迁移/中断/旧版写入拒绝；两店独立 Profile，各七个完整美国业务日，每天八报表及原文件 |
| L7 | 人工/策略各自独立的候选、判断、授权、批次、作业、提交意图；三段 PNG 和实际 DB 行；UNKNOWN 只读对账；单独批准的性能预算、baseline、原样本及 AI 账单/预算 |

同一包的报告仍须满足各自 schema 的完整要求。旧报告不能通过补一个 schema 或新的布尔字段升级。不存在适配器或缺少原件时拒绝。

本地软件性能目录保留原34目标并增加两档memory-search，合计15类36目标，每目标至少3个独立真实EXE样本；完整目录为21类48目标。Main/Renderer使用原生进程累计峰值（MiB，process-lifetime-peak），覆盖冷/暖各阶段至采样点；旧after-sample截面不能升级。memory-search标量为一次预选唯一命中查询的单调毫秒端点差，原件须证明真实输入及结果完成；零命中/清空为正确性对照，准备与可见详情核对在计时之外。

单轮evidence-growth（bytes，after-sample）继续作诊断。正式evidence-daily-growth（bytes，at-least-24h-endpoint-net-byte-change）重核至少24小时端点库存、实际fixture合同/profile/owner、同物理树及跨档重叠/复用，使用同一定义的批准预算；短窗口旧证据拒绝。结果保留有符号端点净变化，不按天外推，不声称中间瞬态或gross写入量；actualMainContextObserved:false、bindingRole:planned-fixture-window明确上下文仅为计划绑定。软件阶段的PENDING_REAL_OBSERVATION标记不产生正式日增长信用。

内部36目标工程阈值用于开发侧当前EXE实测比较，与正式用户批准的性能/AI预算分别存储；内部定义审查和隔离软件测试不代替该比较、正式日窗口观察或用户批准。

## 双模式独立性

人工与策略报告先分别通过 `validateExecutionCanary` 的真实快照、发行者、不可变历史、时序与 PNG 校验。`submitIntentId` 直接从已经核验的 SQLite 作业读取，不采用报告自填值。

随后再检查：

- authorityId、missionGrantId、batchId、jobId、proposalId、decisionId 和实际 submitIntentId 各自不同。
- 两模式的 before/after/reload 共六条证据，证据 ID、不透明引用、规范路径、当前 PNG 哈希及 dev/ino 文件身份均不复用。
- 在以上全部通过前，不输出 L7 的已验证 caseId。

## 无障碍治理：冻结定义与现场登记

固定定义来自 `docs/v16_companion_verification_traceability.md`，包含版本化 UI 术语和十个 primitive 的交互风险、键盘/焦点风险、屏幕阅读器风险、motion/zoom 风险、验证方法及 owner。包内冻结定义可以保持 PENDING。

现场报告使用 `kind=v16-ui-governance`、`schemaVersion=1`：

| 字段 | 内容 |
|---|---|
| definitionSha256 | 当前固定定义的原文字节 SHA-256 |
| register | 当前工作包中的登记 Markdown 原件描述符 |
| registeredAt | 本次执行窗内的登记时间 |
| packageIdentity / sourceSha256 | 当前包及源码身份 |
| runId / uiRunGroupId | 本次治理执行及已经严格校验的 Package UI 运行组 |
| deltas | 十项 primitive，逐项 owner、method、PASS、profileId、PID、storeIdSha256、observations、approval |

现场登记也由 `parseUiGovernance` 解析。它只能改变固定定义的 status；其余语义字段、版本、术语、风险、owner 和 method 必须逐字段相同。十项状态必须 PASS，并提供下列全部实测原件。单独的 PASS 登记没有完成信用，也不会自动更改源码中的 PENDING。

每份观察、DOM 与日志绑定：`primitive/runId/uiRunGroupId/sourceSha256/packageIdentity/profileId/pid/storeIdSha256/governanceDefinitionSha256/registerSha256`。Profile、PID 和店铺哈希必须来自已验证 Package UI 的同一次运行。

### 三类观察

- `keyboard`：`v16.accessibility-observation/1` 引用 `v16.accessibility-dom/1` 和 JSONL 原日志。控件必须实际可聚焦，事件中的 activeElementId 必须等于目标。普通交互要求进入→键盘动作→返回触发控件；ReasonRequiredDialog 另要求 Tab/Shift+Tab 环绕及 Escape。
- `screen-reader`：记录实际 NVDA/Narrator/JAWS 版本、会话开始/结束及逐节点读出原日志。至少两个不同节点，读出的角色与中文名称必须和 DOM 对应；只有 ARIA 指标不能通过。

命名 dialog 的固定读屏合同为 `v16.nvda-report-focus/1`：仍保留同一原容器与关闭按钮两个节点。容器在原四阶段焦点验证后，于同一原十秒内固定执行一次真实 NVDA+Tab，标记 `nvda-report-current-focus`；其它节点保持 `automatic-focus-announcement`。隔离 Profile 的 Extended Insert 配置必须实际确认，四次输入与 modifier、owner、释放和原期限原件须绑定到语音触发记录。输入收据不能替代原 synth raw、当前 DOM、名称/角色及身份校验；缺失能力或主动输入原件不能降级通过。未知 schema、字段、触发模式及能力标记不一致均拒绝。原自动公告采集未通过，最终阶段回调及原因仍未证实；此方法不宣称自动公告已修复，旧失败原件保留。禁止直接调用语音或官方 script API、重放语音、模拟事件、重试或扩大预算。

- `motion-zoom`：原日志记录 reduced-motion 开启、125% 与 minimum 采集。每个尺寸保留 DOM 和完整可解码 PNG，尺寸必须相同，所有目标边界位于视口内；动画关闭后仍保留可辨认的静态阶段/结果。

逐项批准使用 `v16.accessibility-approval/1`，绑定 owner、复核人、当前包/源码、定义与现场登记两份哈希、完整运行 binding，以及三类观察的实际哈希。批准时间不得早于登记或观察。该局部验收不声明未经证明的 WCAG 等级。

## 打包运行与发布输入闭包

普通 CLI 继续读取当前源码、Git 和真实包体。打包应用由 Main Worker 显式传入可信运行环境：冻结构建库存、固定原件根、当前包提供器、冻结安全源码组、固定 authority 路径/SQLite 构造器/只读备份子进程及 `uiGovernanceSource={path,sha256,sizeBytes}`。这些提供器来自程序闭包与配置总线，不能由待验 packet 或 Renderer 提供。

安全扫描逐一读取实际源码文件。SQLite 组包含 `db.ts`、`db-migration-contract.ts`、`db-migration-runner.ts`、`db-metric-identity.ts` 和 `db-columns.ts`，不拼接伪造源码代替真实文件。

`inputArtifacts` 返回全部已经严格读取的规范路径、SHA-256 和字节数，涵盖包、报告、日志、截图、预算、baseline、DB 快照、治理定义和现场登记。完成前再次重读；L8 每次重新验证并冻结传递输入。只保存顶层报告哈希不能替代此闭包。同路径改写、缺失、链接、旧包、跨店或过期输入均使当前发布失效。
