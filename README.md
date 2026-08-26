# Amazon AI Ops Agent

面向亚马逊运营的 Windows 本地 AI Ops 桌面工作台。

它把领星广告报表采集、产品级广告量化、关键词与 Listing 优化、AI + 规则建议、人工审批、Ads UI 执行回读和最终交付验收串成一个可审计的本地闭环。

**DELIVERY: APP_NEEDS_WORK — INTERNAL NON_READY STATIC WINDOWS CANDIDATE.** 当前版本为 `1.5.1`，固定 Amazon US / USD、Windows 单机自用和逐店隔离。本轮把策略范围、关键词证据、Grant 签发和执行工作台收紧到同一条当前店铺真实权限链，并完成 `285/285` files、`3584/3584` 单元测试及静态 Windows 七步构建。当前包尚未在禁令允许范围内完成业务 smoke、Package UI、ZIP 真启动或真实 Ads 写入/回读，因此仍不得声明 `APP_READY`。

## 当前交付

| 项目 | 当前值 |
|---|---|
| 产品形态 | Windows 本地优先 Electron 桌面应用 |
| 当前版本 | `1.5.1` |
| 当前状态 | `APP_NEEDS_WORK / INTERNAL NON_READY`（静态 Windows 候选；尚无当前包运行态签收） |
| 当前源码验证 | 聚焦权限链 `157/157`；全量单元 `285/285` files、`3584/3584` tests；脚本契约 `12/12`；无 `.skip/.todo/skipIf/context.skip` |
| 无安装版 | `apps\desktop\release\AmazonAIOpsAgent-1.5.1-portable.exe`；SHA-256 `637E7CC1E1BCAF3D2BE574D7D97563E70CDA1A5CD47FD52B955197EE81355A1D` |
| 安装版 | `apps\desktop\release\AmazonAIOpsAgent-1.5.1.exe`；SHA-256 `444802A1B282AC8EA28CA621ACA375229401DF650DB406B89926BCB9B7FEB956` |
| 文件夹 ZIP | `apps\desktop\release\AmazonAIOpsAgent-1.5.1.zip`；SHA-256 `CF1A80BC9D3F17B28071BDE49B1551C49C5644E7C171784AB058734352A7C534` |
| 真实业务基线 | 最新已记录采集为 8/8、导入为 8 files / 1937 metrics / 8 reconciliations；存在 enabled 策略、active 运营任务和 draft 经营实验 |
| 新增执行恢复 | `UNKNOWN` 只读双次对账会在刷新前后读取并截图，校验稳定对象，保持原执行 `unknown` 且另记 `READBACK`；不会重试写入 |
| 新增因果记忆 | 当前店铺索引真实重建、索引搜索和 US/USD JSON 时间线导出 |
| 当前 Ads 安全门 | 最近只读记录仍为对象 authority=0、approval=0、Ads execution=0；真实写入须先唯一回读当前对象并取得该候选专属批准 |
| 当前静态构建 | `pnpm run build:win` 七步通过，`freshCurrentRun=true`；Main bundle `1FAF882D...8FAB4`；源码与包内 `s is not defined` 均为 0 |
| 最近运行态基线 | `1.5.0` 的 Package UI `operator-core-20260826-91` 三档曾通过；这是历史基线，不授予 `1.5.1` 信用 |
| `1.5.1` 动态门 | typecheck、7 类业务 smoke、Package UI、ZIP 真启动、正式库前后只读零写入复核及真实 Ads 写入/刷新回读待运行；用户当前禁止这些动作 |
| 正式八门 / bundle | `1.5.1` 尚未生成当前 readiness/bundle；旧 READY/NON_READY、旧哈希、旧 manifest 和旧 bundle 仅作历史记录 |
| 详细状态 | `docs\OPERATOR_CORE_FLOW_REPAIR_2026-08-07.md`（当前）；`docs\MISSION_CONTROL_RELEASE_STATUS_2026-08-04.md` 仅为历史基线 |

> 注意：`output/`、`storage/`、AppData DB、raw 领星报表、release EXE 和密钥都是本地交付/运行产物，不进入 Git 提交。
>
> 发布事实源：README 与用户指南只展示摘要；交付状态以 manifest-driven final readiness、当前安装包索引、交付包 manifest 和与状态匹配的 READY/NON_READY safety 校验结果为准。
>
> 历史候选（已取代，不能作为当前交付事实）：2026-07-15、2026-07-16、Task 8A、UI P2 与 2026-07-17 external-security P1 的 schema v5 package UI、旧哈希、smoke、readiness 和 bundle 只保留为修复过程记录，不得替代当前 Mission Control Stage 8 证据。

## 能做什么

| 业务域 | 功能 |
|---|---|
| 今日任务 / 任务中心 | 当前店铺下一动作、运营事件、Mission 飞行计划、事实与检查点 |
| 决策与审批 / 经营实验 | 建议、审批、已决策、实验假设、观察窗与结论 |
| 实时执行 / 因果记忆 | 受控执行、三段回读、人工接管、因果时间轴与证据引用 |
| 店铺与广告对象 / 数据采集 | 产品、目标、关键词、Listing、范围、八报表与导入检查 |
| 策略与风控 / 系统设置 | 策略版本、限额、kill switch、AI、本地运行、店铺调度与交付状态 |

## 当前 UI 状态

| 项目 | 状态 |
|---|---|
| 原型基准 | `amazon-ai-ops-mission-control-prototype` 的 US/USD、十工作区任务优先体验 |
| 生产主题 | 只保留浅色 Windows 桌面主题；不实现暗色切换 |
| 字体依赖 | renderer 使用本地/system 字体栈，不依赖 Google Fonts |
| 页面结构 | `StoreGate -> App Shell -> 10 个 Mission Control 工作区 -> canonical 子视图 -> 当前主任务 -> 业务明细` |
| 10 个工作区 | 今日任务、任务中心、决策与审批、经营实验、实时执行、因果记忆、店铺与广告对象、数据采集、策略与风控、系统设置 |
| 首屏任务 | 每个核心子视图先展示当前状态、唯一主动作和安全边界，技术依据与长明细下沉到辅助区 |
| 开发 UI 证据 | `output\codex-evidence\mission-control-ui-3f6fbec3\manifest.json` 覆盖 10 个工作区各 100%/125%，另含 Store Gate、双店隔离与 1200×900 执行布局；明确 `NO_FINAL_READINESS_CREDIT`，不能替代 package UI |
| Package UI 合同 | schema v8；包体必须包含项目自带 `playwright-browsers\chrome-win64\chrome.exe`，100%/125% 各覆盖十工作区、三项只读 overlay、canonical 子视图与宽屏/最小窗口隔离档 |
| 登录证据合同 | 每轮由可见 operator handoff 完成登录；runner 不读、不填、不点击秘密。首轮必须证明 fresh typed + saved、非复用会话和精确身份，saved continuation 也必须重新形成有界 Main 证明 |
| 当前数据事实 | 最新批次 `batch_20260625013151957_ajw0nb` 为 8/8 类逐类入库、6827 条导入指标；产品页 1879 条仅代表当前 ASIN |
| 产品字段 | 已明确为产品成本、FBA 费用、当前售价、最低可接受售价、目标 ACOS、目标 TACOS、目标净利率 |
| 原型清单 | `docs\design\prototype-reference-index.md`、`docs\design\prototype-parity-checklist.md` |

## 核心工作流

```text
选择当前 US / USD 店铺与独立 Profile
  -> 设置工作范围
  -> 采集 8 类领星广告报表
  -> 导入校验并写入本地 DB
  -> 建立店铺、产品与广告对象事实
  -> 记录运营事件
  -> 创建 Mission、冻结证据并生成建议
  -> 人工审批或命中已启用策略的整批授权
  -> 在可见 Ads UI 串行执行低风险动作
  -> 截图 / reload / 结果核对
  -> 因果记忆与正式 Mission 交付验收
```

## 产品边界

| 边界 | 说明 |
|---|---|
| 首版范围 | 只支持 Amazon 美国站和 USD；店铺数据、浏览器 Profile、任务、证据与运行配置按 StoreContext 隔离。 |
| 报表采集 | 只采集/下载/导入真实领星广告报表；截图、审计文件或页面归档不能替代真实报表。 |
| 数据口径 | `campaign`、`ad_group`、`placement`、`advertised_product`、`user_search_term` 是不同维度展开，不能直接相加。 |
| AI 建议 | AI 只生成诊断、解释、阈值建议和草案，不直接写入 Amazon Ads。 |
| 产品配置 | 成本、FBA、当前售价、最低可接受售价、目标 ACOS/TACOS/净利率只保存到本地配置，不审批建议，不执行广告动作。 |
| Listing | Listing 草案只保存为本地版本，不自动提交 Amazon 或领星。 |
| 广告执行 | 桌面端执行保持 fail-closed；动作必须取得当前人工审批，或命中已启用策略下的整批授权，并完成执行前、执行后、reload 回读和 verifier 校验。 |
| 密钥与凭证 | 登录凭证和 AI Key 由本地安全存储处理，UI 不展示明文，仓库不保存密钥。 |

## 外部分发阻断与剩余工作

`1.5.1` 当前只完成源码与单元门，不能继承 `1.5.0` 包的运行态信用。投产前必须按同一源码、包、数据库和证据谱系完成：

| 正式门 | 当前状态 | 完成条件 |
|---|---|---|
| 静态工程门 | pending | 运行 desktop typecheck 与 Renderer build，确认版本提升没有类型/打包合同漂移 |
| 业务主链 | pending | 运行当前 7 类业务 smoke，逐项报告连接、采集、策略、运营任务、经营实验、弹窗和按钮 |
| Windows 包 | 静态构建通过 | `1.5.1` installer、portable 与 folder ZIP 已生成并记录当前 SHA-256；尚待动态启动验收 |
| Package UI | pending | 用 `1.5.1` 完成 100%/125%/wide 三档、中文失败/下一步、弹窗滚动和店铺隔离合同 |
| Task 8B | blocked by authority/approval | 先唯一回读当前 Ads 对象和值，再让操作者批准具体 `lower_bid`；随后执行一次写入并刷新回读 |
| 八门聚合与 bundle | pending | 绑定同一 `1.5.1` 源码、包、DB 与证据生成严格 READY 或 NON_READY 结果 |

因此当前包只允许内部验证和受控交接；通过当前全部门禁、重新生成 Mission readiness，并生成匹配的严格 bundle 及安全校验前，不能作为 `APP_READY` 外部分发版本。

## 当前验证状态

| 验证门 | 状态 | 证据 |
|---|---|---|
| 全量单元测试 | 通过 | `285/285` files、`3584/3584` tests；失败 0、跳过声明 0 |
| 版本一致性 | 通过待提交 | root、desktop、Main IPC、ZIP 默认路径及 v1.5 验证器统一读取 `1.5.1` 权威 |
| `UNKNOWN` 对账 | 单元通过 | Service/IPC/Preload/Renderer 已接通；刷新前后双次只读证据，不重试原写入 |
| 因果记忆索引/导出 | 单元通过 | 当前店铺索引和 JSON 导出均有行为测试 |
| TypeScript | 未运行 | 本轮按用户约束禁止 typecheck；不能沿用旧结论 |
| 静态 Windows build | 通过 | 七步通过、`freshCurrentRun=true`，Main/Renderer 源码与包内容哈希一致 |
| 当前业务 UI smoke | 未运行 | `1.5.1` 尚无业务 smoke 证据 |
| Windows / ZIP 运行态 | 未运行 | `1.5.1` 已有 EXE、ZIP 和 SHA-256，但用户禁令下未做 ZIP 真启动 |
| Package UI | 未运行 | `1.5.0` 的历史通过 manifest 不授予 `1.5.1` 信用 |
| Ads 写入回读 | 阻断 | authority/approval/execution 最近记录均为 0；缺具体对象唯一回读和专属批准 |
| 正式 readiness / bundle | 未生成 | 当前有效状态保持 `APP_NEEDS_WORK / NON_READY` |

## 开发环境

| 依赖 | 版本/说明 |
|---|---|
| Node.js | `>=18` |
| 包管理器 | `pnpm` |
| 桌面框架 | Electron + React + TypeScript |
| 本地存储 | SQLite / DuckDB 风格本地数据管道 |
| 目标平台 | Windows 桌面，不针对移动端适配 |

安装依赖：

```powershell
pnpm install
```

启动开发环境：

```powershell
pnpm dev
```

## 常用命令

| 命令 | 用途 |
|---|---|
| `pnpm --filter @amazon-ai-ops/desktop run typecheck` | 桌面端类型检查 |
| `pnpm --filter @amazon-ai-ops/desktop run build:renderer` | 构建 renderer |
| `pnpm --filter @amazon-ai-ops/desktop run build:win` | 构建 Windows installer 和 portable EXE |
| `pnpm run smoke:business-ui-current` | 运行旧 v1.5 业务 UI smoke；当前 Mission Control 标题/动作适配未完成，不能把旧通过结果列为当前证据 |
| `pnpm run smoke:package-launch` | 打包产物启动 smoke |
| `pnpm run smoke:package-security-boundaries -- ...` | 收集并验证打包主进程的导航、外链、凭证与三重哈希安全边界 |
| `pnpm run verify:ad-execution` | 广告执行 fail-closed 安全验证 |
| `pnpm run verify:ad-readback -- <evidence.json>` | 单个广告回读证据验证 |
| `pnpm run gate:s8 -- ...` | 只读检查 Stage 8 live authority、全库双店覆盖、两店连接/会话和连续运行门；默认不写文件、不执行 Ads |
| `pnpm run write:v15-evidence-manifest -- ...` | 固定 v1.5 legacy baseline 证据选择 |
| `pnpm run verify:v15-final-readiness -- ...` | 生成/验证 v1.5 legacy baseline；不是正式 Mission 发布状态 |
| `pnpm run export:s7-authority-snapshot -- ...` | 从明确指定的 live AppData DB 生成 WAL-safe、只读、包身份绑定的 authority snapshot v2 |
| `pnpm run verify:s7-continuous-operation -- ...` | 只从 authority snapshot v2 验证两店连续七个美国业务日 |
| `pnpm run export:s7-execution-canary -- ...` | 从 authority snapshot 与 Store Capsule 三段工件只读导出人工或 policy-auto canary 证据 |
| `pnpm run verify:s7-production-readiness -- ...` | 聚合正式 Mission 八门并生成唯一正式生产状态 |
| `pnpm run export:v15-delivery-bundle -- ...` | 导出 manifest-driven 交付包 |
| `pnpm run verify:v15-ready-safety -- ...` | READY 交付安全门 |
| `pnpm run verify:v15-non-ready-safety -- ...` | APP_NEEDS_WORK 交付安全门 |

### Stage 8 只读 Gate Operator

默认诊断显式 live authority DB，不生成正式证据，也不迁移 SQLite、不请求网络、不执行 Amazon Ads：

```powershell
pnpm run gate:s8 -- --db <absolute-live-appdata-amazon-ai-ops.db>
pnpm run gate:s8 -- --db <absolute-live-appdata-amazon-ai-ops.db> --store <store-1> --store <store-2>
```

不传 `--store` 时，operator 只会在全库恰好存在两家 `active`、`US`、`USD` 店铺时自动选择。显式传入两个不同的 `--store` 只固定要检查的两家，不会缩小全库覆盖门：只要另有第三家 active US/USD，店铺 authority 与 continuous verifier 都会 fail-closed，不能靠参数把第三家排除。两家选中店还必须使用不同且非空的 `browser_profile_id`，并且都是 `America/Los_Angeles`。

每家店的 `lingxing` 与 `amazon_ads` 都必须各有一条 `ready` connection 和一条 `ready` session；session Profile 必须匹配店铺。`observed_at`、`verified_at` 必须是有效且不晚于本次检查时间的时间；`expires_at` 没有配置时不新增有效期业务语义，但一旦配置，就必须是有效且晚于检查时间的时间，已过期会立即阻断。输出只用 `store-1` / `store-2`、稳定 job/import 引用和安全 gap/violation 摘要，不公开原始店铺、Profile、job/import ID 或本地路径。

如需保存非正式 monitoring ledger，必须显式给出一个尚不存在的绝对 JSON 路径：

```powershell
pnpm run gate:s8 -- --db <absolute-live-appdata-amazon-ai-ops.db> --export --out <absolute-new-monitoring-ledger.json>
```

状态与退出码：

| 结果 | 顶层状态 | 退出码 |
|---|---|---|
| schema、全库双店 authority、两店 operational、连续运行全部通过 | `READY_FOR_EXPORT_PREFLIGHT` | `0` |
| 任一只读门未通过 | `PARTIAL_MONITORING` | `2` |
| 参数、输入、路径或运行错误 | 不生成可冒充 READY 的状态 | `1` |
| 显式 `--execute-exports` 全链完成 | `EXPORT_CHAIN_COMPLETED` | `0` |
| 显式 export 深预检被门禁阻断 / export 中断 | `PARTIAL_MONITORING` / `EXPORT_CHAIN_INTERRUPTED` | `2` / `1` |

`--execute-exports` 仍只编排正式证据导出，并要求显式 `--export-root`、`--out` 和五项 package evidence；它不会执行 Ads，也不会修改 authority DB。正式 immutable authority snapshot 生成后会再次执行全库双店与 operational gate，并把安全摘要写入 monitoring ledger；复检失败会在 continuous/canary/readiness 导出前中断。

生产交付顺序固定为：

```powershell
pnpm run write:v15-evidence-manifest -- --delivery <full8-evidence.json> --listing-read <listing-read.json> --ai-live <ai-live.json> --ad-ai-explanation <ad-ai-explanation.json> --listing-ai-draft <listing-ai-draft.json> --ad-readback <ad-readback.json> --out <evidence-manifest.json>
pnpm --filter @amazon-ai-ops/desktop run build:win
pnpm run smoke:package-launch
pnpm run evidence:package-ui -- --expected-exe-sha256 <win-unpacked-sha256> --expected-app-content-sha256 <app-content-sha256> --user-data-dir <fresh-isolated-profile-copy> --protected-db <live-appdata-amazon-ai-ops.db> --allow-interactive-login --interactive-login-timeout-ms 900000 --output <package-ui-evidence-root>
pnpm run smoke:package-security-boundaries -- --expected-exe-sha256 <win-unpacked-sha256> --expected-app-content-sha256 <app-content-sha256> --out <package-security-evidence.json>
pnpm run smoke:package-adversarial-node-env -- --expected-exe-sha256 <win-unpacked-sha256> --expected-app-content-sha256 <app-content-sha256> --expected-main-bundle-sha256 <main-bundle-sha256> --out <package-adversarial-node-env.json>
# 下面只生成 Mission 聚合器所需的 v1.5 legacy baseline
pnpm run verify:v15-final-readiness -- --evidence-manifest <evidence-manifest.json> --package-launch-smoke <package-launch-smoke.json> --db <amazon-ai-ops.db> --out <v15-legacy-final-readiness.json>
# 生成后续连续运行与 canary 共同引用的唯一 WAL-safe authority snapshot
pnpm run export:s7-authority-snapshot -- --db <absolute-live-appdata-amazon-ai-ops.db> --out <repo>\output\codex-evidence\authority-snapshots\<new-snapshot-id>
pnpm run verify:s7-continuous-operation -- --authority-snapshot-manifest <snapshot-manifest.json> --store <store-1> --store <store-2> --date-from <YYYY-MM-DD> --date-to <YYYY-MM-DD> --output <repo>\output\codex-evidence\continuous-operation\<new-evidence>.json
pnpm run export:s7-execution-canary -- --authority-snapshot-manifest <snapshot-manifest.json> --mode manual_approval --store-id <store-id> --authority-id <authority-id> --mission-grant-id <grant-id> --batch-id <batch-id> --job-id <job-id> --stores-root <absolute-stores-root> --before-artifact <before.png> --after-artifact <after.png> --reload-artifact <reload.png> --out <repo>\output\codex-evidence\execution-canaries\<new-manual-canary>.json
pnpm run export:s7-execution-canary -- --authority-snapshot-manifest <snapshot-manifest.json> --mode policy_auto --store-id <store-id> --authority-id <authority-id> --mission-grant-id <grant-id> --batch-id <batch-id> --job-id <job-id> --stores-root <absolute-stores-root> --before-artifact <before.png> --after-artifact <after.png> --reload-artifact <reload.png> --out <repo>\output\codex-evidence\execution-canaries\<new-policy-auto-canary>.json
# 正式发布状态只认 Mission 八门聚合结果
pnpm run verify:s7-production-readiness -- --authority-db <absolute-live-appdata-amazon-ai-ops.db> --v15-final-readiness <v15-legacy-final-readiness.json> --package-launch-smoke <package-launch-smoke.json> --package-ui-manifest <package-ui-manifest.json> --package-security-evidence <package-security-evidence.json> --package-adversarial-node-env-evidence <package-adversarial-node-env.json> --s7-continuous-operation-evidence <continuous-operation.json> --manual-canary-evidence <manual-canary.json> --policy-auto-canary-evidence <policy-auto-canary.json> --authority-snapshot-manifest <snapshot-manifest.json> --out <mission-production-readiness.json>
# 当前候选尚未生成正式八门结果；package UI、真实 DB、连续运行、人工 canary、policy-auto canary 未通过时不得把 bundle 称为最终交付
# 以下 legacy-named export/safety 只有在通过的 schema v8 manifest 与当前证据选择冻结后才运行；当前状态仍为 pending
# 如果最终验收为 `APP_NEEDS_WORK`，README 顶部 DELIVERY 行必须保持非 READY
pnpm run export:v15-delivery-bundle -- --final-readiness <v15-legacy-final-readiness.json> --package-ui-manifest <package-ui-manifest.json> --package-security-evidence <package-security-evidence.json> --package-adversarial-node-env-evidence <package-adversarial-node-env.json> --workspace-ui-manifest <workspace-ui-manifest.json> --business-ui-smoke <current-business-ui-smoke.json> --full-test-evidence <full-vitest.json> --data-reconciliation <reconciliation.json> --data-reconciliation-md <matching-reconciliation.md> --release-dir apps\desktop\release --readme README.md --db <amazon-ai-ops.db> --skip-latest-extras true --out <non-ready-bundle>
pnpm run verify:v15-non-ready-safety -- --final-readiness <v15-legacy-final-readiness.json> --bundle-manifest <non-ready-bundle>\delivery-bundle-manifest.json --package-launch-smoke <package-launch-smoke.json> --package-ui-manifest <package-ui-manifest.json> --package-security-evidence <package-security-evidence.json> --package-adversarial-node-env-evidence <package-adversarial-node-env.json> --readme README.md --db <amazon-ai-ops.db>
# 只有最终验收为 `APP_READY` 时，README 顶部 DELIVERY 行才切到 `APP_READY`
# 上述 export/safety 仍是 legacy-named bundle 工具；还必须 Mission 8/8 且匹配的正式 bundle 合同闭合
pnpm run export:v15-delivery-bundle -- --final-readiness <v15-legacy-final-readiness.json> --package-ui-manifest <package-ui-manifest.json> --package-security-evidence <package-security-evidence.json> --package-adversarial-node-env-evidence <package-adversarial-node-env.json> --workspace-ui-manifest <workspace-ui-manifest.json> --business-ui-smoke <current-business-ui-smoke.json> --full-test-evidence <full-vitest.json> --data-reconciliation <reconciliation.json> --data-reconciliation-md <matching-reconciliation.md> --release-dir apps\desktop\release --readme README.md --db <amazon-ai-ops.db> --skip-latest-extras true --out <ready-bundle>
pnpm run verify:v15-ready-safety -- --final-readiness <v15-legacy-final-readiness.json> --ui-smoke <current-business-ui-smoke.json> --bundle-manifest <ready-bundle>\delivery-bundle-manifest.json --package-ui-manifest <package-ui-manifest.json> --package-security-evidence <package-security-evidence.json> --package-adversarial-node-env-evidence <package-adversarial-node-env.json> --db <amazon-ai-ops.db>
```

Windows 打包时如果 C 盘临时目录空间不足，可以把 `TEMP` / `TMP` 切到 D 盘：

```powershell
$env:TEMP = 'D:\Temp\amazon-ai-ops-build'
$env:TMP = 'D:\Temp\amazon-ai-ops-build'
pnpm --filter @amazon-ai-ops/desktop run build:win
```

## 文档索引

| 文档 | 用途 |
|---|---|
| `AGENTS.md` | 后续 AI 接手规则、生产交付链、提交边界和验证要求 |
| `docs\amazon_ai_ops_desktop_prd_arch_dev_spec_v1_5_no_external.md` | v1.5 PRD / 架构 / 开发规格 |
| `docs\MISSING_MODULES_MATRIX.md` | 缺失模块矩阵 |
| `docs\V1_5_PROGRESS_REPORT.md` | 详细进度、历史增量、证据记录 |
| `docs\V1_5_ACCEPTANCE_MATRIX.md` | 验收矩阵 |
| `docs\USER_GUIDE_v1_5.md` | 用户操作指南 |
| `docs\REAL_AD_READBACK_RUNBOOK.md` | 真实 Ads UI 人工执行与回读手册 |

## Git 提交边界

可以提交：

- 源码
- 测试
- 脚本
- 文档
- 小型配置文件

不要提交：

- `output/`
- `storage/`
- `apps/desktop/release/`
- AppData DB / profile
- 原始 Lingxing `.xlsx` / `.xls` / `.csv`
- API Key、账号密码、Cookie、Token

## 维护原则

1. README 只放当前可用状态和入口信息，不再堆历史流水账。
2. 详细进度、历史证据和每轮变更记录放到 `docs\V1_5_PROGRESS_REPORT.md`。
3. README 影响交付状态说明且已有通过的正式 package UI/readiness 链时，重新导出当前状态对应的 bundle 并运行匹配的安全门；证据链未闭合时保持 bundle `pending`，不得复用历史 bundle。
4. 只要改动影响 Windows 桌面 UI / runtime / data collection / EXE 行为，就重新打包 Windows 产物。
5. 任何广告动作都不能绕过人工审批、截图、执行回读和 verifier。
