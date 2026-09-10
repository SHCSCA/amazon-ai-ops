# V1.6 验证追踪规格

版本：1.0；适用完整 L1–L8。旧验证禁令已于本任务解除。本规格和清单本身不产生完成信用。

## 唯一需求与测试定义

- docs/amazon_ai_ops_agent_prd_v1_6_0.md 的全部 MUST，当前提取 172 个唯一 ID。
- docs/v16_requirements_index.json 保存原文、AC、实现定位、testIds 和状态。每个 MUST 必须有实现和已执行证据；不得仅凭文件存在或代码行数完成。
- 每个 AC 必须通过 acceptanceCases 关联 testId 与实际 runner 中的具体 caseId。Vitest caseId 为仓库相对文件路径加 `::` 加完整测试名；整套测试通过但未运行对应案例仍不得闭合。
- docs/v16_required_test_manifest.json 是唯一必需测试定义，schemaVersion=v16.manifest/1。L1 枚举 apps/packages/scripts 下全部真实测试文件；发现增删须更新清单，漏跑、空文件、skip/todo、runner 失败都不得通过。
- PROGRESS.md 记录当前证实成果，BLOCKED.md 记录未满足条件。历史报告没有当前完成信用。

## 证据合同

v16.evidence/1 包含 testId、layer、identity、execution、artifact、result。identity 绑定 Git HEAD、当前源码内容 SHA-256 和桌面 packageVersion；L4–L7 另外绑定安装/便携/ZIP/应用内容/Main 哈希。execution 保留真实开始/结束时间和退出码；artifact 保留实际 runner 文件及 SHA-256。

Vitest 结果直接重读 assertionResults，核对必需文件、实际数量、状态与汇总。不使用手写总数。静态和实测检查保留原生命令/日志/证据，检查集合必须与清单完全一致。无必需检查、旧 runner、旧包或跨店证明一律不能通过。

## 分层验收

| 层 | 验收内容 |
|---|---|
| L1 | 单元、领域状态机、完整上下文、IPC/Preload/Renderer 往返合同，全源必需测试真实执行 |
| L2 | 全工作区类型检查、Renderer/Main/Preload 构建、打包脚本合同 |
| L3 | 真实生产服务和隔离 SQLite：八报表导入→分析→Decision/Grant→执行→实验/记忆；外部适配器替身必须标注 |
| L4 | 当前 Windows 实包六模块22入口、四尺寸/缩放、弹窗键盘与中文恢复、无障碍 |
| L5 | 安装/便携/ZIP 实际启动、原生依赖、导航/外链、关闭清理及包体身份 |
| L6 | 正式库 WAL-safe 升级恢复核验，两店各七个完整美国业务日和写入对账 |
| L7 | 人工与策略独立真实候选、Decision/Grant、完整三段回读，性能及成本批准预算 |
| L8 | 全部 MUST 追踪闭合，L1–L7 当前通过，README/交付报告/READY bundle 一致 |

L1/L3 的夹具证明代码行为，不能替代 L4–L7 的真实包体、正式库、真实会话或 Ads 写入。反向场景见用户计划及发布规格，每项保留对应实际执行证据。

## 执行入口

- node scripts/generate-v16-l1-evidence.mjs --out-dir output/v16-evidence/current
- node scripts/verify-v16-l2-static-checks.js --out-dir output/v16-evidence/current
- node scripts/generate-v16-l1-evidence.mjs --test V16-T-L3-BUSINESS --out-dir output/v16-evidence/current
- pnpm run verify:v16-full

未就绪的 L4–L7 证据保持缺失/失败，不生成模拟 PASS。自报 checks.passed 不能证明原生运行，必须有专用原生证据校验；适配未完成时固定拒绝。聚合器读取实际 evidence 和源码身份，再检查双向追踪；任一必要条件失败时保持 APP_NEEDS_WORK。

## 当前 Package UI 合同

`package-ui-evidence` schema v9 绑定当前尝试、源码、包体、隔离 Profile、只读数据库审计和截图文件。六模块导航须逐一点击真实按钮，22 个入口各有原始页面指标、键盘状态与独立截图；1366×768 常规 100%/125%、1400×900 wide 和原生 minimum 分别取证。minimum 使用 Electron `getMinimumSize/getBounds/getContentSize` 证明 1200×700 窗口下限及实际内容区，不用内容区尺寸推定原生窗口尺寸。旧 v8 不可用于当前发布。

验收器重新判断页面标题、主动作、活动模块/入口、滚动归属、ARIA 引用、文案及键盘选中/焦点状态；保存的 `passed` 不能覆盖原始指标失败。截图还须通过当前文件哈希、尝试成员关系和唯一用途检查。原生 minimum 截图随交付包导出，并参与包内完整性检查。此合同不把只读浏览当作业务动作成功或正式数据验收。

## UI 术语表

版本 `v16.ui-terminology/1`；关联 V16-UI-006/010、AC-UI-008/012。普通页面优先中文，诊断展开前不得泄露 raw path、内部 ID、hash 或 revision。下列规范标识只允许在声明的位置出现，不能成为无解释的报错。

| 规范标识 | 普通文案 | 允许保留标识的位置 |
|---|---|---|
| Mission | 运营任务 | 任务详情次级标签、折叠诊断 |
| Analysis Run | 分析运行 | 运行详情、导出 schema |
| Decision | 运营判断 | 折叠因果链诊断 |
| MissionGrant | 执行授权 | 授权详情、折叠诊断 |
| Experiment | 经营实验 | 折叠诊断、导出 schema |
| READBACK / EFFECT | 执行回读 / 效果观察 | 因果阶段、导出；同时给出中文 |
| UNKNOWN | 执行结果未知，系统不会自动重试 | 终态展示保留 UNKNOWN 并同时解释中文；不得用成功语义 |
| manual_approval / policy_auto | 人工审批 / 策略内自动 | 模式设置、折叠诊断 |
| StoreContext / session generation / revision | 当前店铺范围 / 当前连接 / 当前版本 | 原值仅限折叠诊断及受控导出 |
| rule / rule_ai / ai / rule_fallback | 规则建议 / 规则与 AI 共同判断 / AI 建议 / 规则回退 | 建议来源与资格详情；不能混淆付费调用成功和内容可用 |

## Accessibility Delta Register

版本 `v16.accessibility-delta/1`；对比基线为 v1.5.1 primitives。负责人为当前实现者，发布核验由交付验收复核。下列状态表示当前包的完整验证状态；源码测试通过不自动改为 PASS，未进行屏幕阅读器操作时不声明屏幕阅读器通过或 WCAG 等级。

| 复用 primitive | v1.6 新交互 / 风险 | 验证方法 | 当前状态 |
|---|---|---|---|
| App Shell / sidebar | 六模块、22 入口、折叠及搜索；活动项与焦点丢失 | 实包逐入口点击、键盘进入、折叠恢复、屏幕阅读器读出当前项 | PENDING |
| WorkspaceSubviewShell | 跨模块子视图；中间页、Home/End/方向键 | 实包记录初始、末项及恢复后的焦点/选中值；每页截图 | PENDING |
| PageFrame / TaskBanner | 唯一主动作、busy、阻断与恢复 | 常规两档、wide/minimum 检查位置/可达性；实际失败与恢复 | PENDING |
| ReasonRequiredDialog | 审批、模式变更和修正原因；不可逆确认焦点 | 初始焦点、Tab/Shift+Tab 约束、Escape、关闭恢复、滚动正文和可达 footer | PENDING |
| ResponsiveInspector | 授权、对象与执行证据详情 | 宽屏侧栏/小窗抽屉、键盘关闭、焦点返回触发控件 | PENDING |
| PriorityDataTable / virtual table | 分页/虚拟行、行选择与刷新 | 典型/最大样本键盘遍历、选中回显、屏幕阅读器行列标签 | PENDING |
| WorkspaceState / status | UNKNOWN、永久无法判定、禁止重试 | 中文原因、规范终态、非成功色、一次只读对账、历史读取 | PENDING |
| FormTable / controls | disabled 原因、保存中锁定与校验 | 实际无效输入/保存失败/重试，确认有可达原因与恢复动作 | PENDING |
| Progress / motion | 分阶段进度、取消与旧响应抑制 | reduced-motion 开启后实包操作；动画关闭仍能判断阶段/结果 | PENDING |
| Store / AI settings | 切店、重连、预算及账单状态 | 125%/minimum、键盘、忙态读出，账单归原店且不泄密 | PENDING |

## NFR Baseline 与 Budget 记录合同

关联 V16-PERF-005/006/007/008、AC-PERF-005/006/007/008。先记录典型/最大支持样本定义及其 SHA-256、机器等级、包体和 DB/schema；样本上限须由实际支持能力验证。Baseline 保留原始样本、次数、P50/P95/峰值、时间窗及测量方法。Budget 另存 metric、fixture、environment、percentile/window、threshold、owner、approval、revision；不得从 Baseline 自动填入批准阈值。

预算目录必须覆盖 cold/warm startup、store switch、首页/模块 projection、exact-eight import、analysis、memory search、Main/Renderer 峰值内存与交互、DB/evidence growth、取消/恢复/离线降级，以及独立 AI latency/token/cost。尚未测量或尚未批准的记录使用 PENDING/UNKNOWN，当前包超预算形成 blocker，不能自动提高阈值。预算确认只在测量完成、可审查的记录准备好后交给用户。
