# Amazon AI Ops Agent

面向亚马逊运营的 Windows 本地 AI Ops 桌面工作台。

它把领星广告报表采集、产品级广告量化、关键词与 Listing 优化、AI + 规则建议、人工审批、Ads UI 执行回读和最终交付验收串成一个可审计的本地闭环。

**DELIVERY: APP_NEEDS_WORK — INTERNAL NON_READY ONLY.** 当前候选已进入 Mission Control Stage 8：第一版固定 Amazon US / USD，正式桌面导航为 10 个 Mission Control 工作区，店铺数据、浏览器 Profile、任务、证据与运行配置按 StoreContext 隔离。当前 v1.5 manifest-driven final-readiness 是 7/8，但它只作为正式 Mission 八门聚合器的 legacy baseline 输入；最新正式 Mission production readiness 已绑定明确 live authority DB 与 WAL-safe snapshot v2，仍为 4/8。项目自带的 Playwright Chromium 已进入包体，schema v7 package UI 要求每轮 visible operator handoff，首轮必须形成 fresh typed + saved、non-reused、identity-verified 的 Main 有界证明；本轮首轮在 15 分钟内未形成 ERP + Ads ready，runner 已 fail-closed，尚未得到通过的 package UI manifest。当前四个未通过的正式门是 package UI、两店连续七个美国业务日、人工 canary 和 policy-auto canary，严格 NON_READY bundle 仍待生成。应用内广告写入继续 fail-closed，当前不得声明 `APP_READY`。

## 当前交付

| 项目 | 当前值 |
|---|---|
| 产品形态 | Windows 本地优先 Electron 桌面应用 |
| 当前版本 | `1.5.0` |
| 当前状态 | `APP_NEEDS_WORK`（内部 NON_READY 候选；正式 Mission readiness 仍为 4/8，package UI pending） |
| 无安装版 EXE | `apps\desktop\release\AmazonAIOpsAgent-1.5.0-portable.exe` |
| 安装版 EXE | `apps\desktop\release\AmazonAIOpsAgent-1.5.0.exe` |
| 无安装版 SHA-256 | `17B881F2FAEDC717AC3E98A027C4EB51EC2DC8AEC9D59B1DE350B9A83F76B811` |
| 安装版 SHA-256 | `AA3F15BBDFFD3ACE4B498019F81D4069B473704127DF34A21FC2F9BBA8FB0C14` |
| win-unpacked EXE SHA-256 | `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89` |
| app content SHA-256 | `2FA784EFF7864F84F9F501E25DCE918ACF6838C63CD92DCF5D6300B33D0B30D5` |
| main bundle SHA-256 | `2DEB3823C52BCFEBCB369FF87F5B6CDB6B27791C69441E8068985BA4338C4838` |
| 当前 live authority DB 主文件 / Package UI 保护基线 SHA-256 | `9E82065E780B38A4D3348F4EE723DDF1A50142F3900192E612730CC1C8017439`（只用于主文件保护，不代表包含 WAL 的完整 SQLite authority 状态） |
| 当前 authority snapshot v2 | `output\codex-evidence\authority-snapshots\2026-07-27T08-27-40-681Z-0faeb2d2-2280-4b75-a1b2-083f8da806a6\snapshot-manifest.json`；snapshot SHA-256 `7E3C7B62E6FB5A993332E38883500DE027CF74E7C4E4E979B0BA5A4EE453A5DD`；正式聚合器在选择后、最终写入前、首次写入后三次对 live DB 做只读 SQLite online backup，均与该 snapshot 的 18,448,384 bytes / SHA-256 完全一致 |
| v1.5 legacy baseline | `output\codex-evidence\final-readiness-20260727-stage8-non-ready-v7.json`（`APP_NEEDS_WORK`；7/8，仅作为 Mission 聚合输入） |
| 正式 Mission readiness | `output\codex-evidence\mission-control-production-readiness-20260728-stage8-wal-currentness-4-of-8.json`（输入合同、snapshot v2 与 WAL-aware live authority currentness 通过；v1.5 baseline、launch、security、adversarial 四门通过；整体仍为 4/8） |
| Package launch smoke | `output\codex-evidence\package-launch-smoke-1785134748920.json`（win-unpacked + portable PASS） |
| Package UI evidence | schema v7 pending；`output\codex-evidence\package-ui-evidence-20260727-stage8-final-v7\2026-07-27T08-10-15-137Z\manifest.json` 因 100% 首轮 15 分钟内未形成 ERP + Ads ready 而 `passed: false`；protected DB 前后哈希不变 |
| Package security evidence | `output\codex-evidence\package-security-boundaries-20260727-stage8-final-v7.json`（11/11 PASS；绑定当前 EXE、app content、main bundle） |
| Adversarial `NODE_ENV` | `output\codex-evidence\package-adversarial-node-env-20260727-stage8-final-v7.json`（PASS） |
| 本轮 NON_READY bundle | pending；通过的 schema v7 package UI manifest 与刷新后的 Mission readiness 生成前不得导出为当前最终 bundle |

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
| 开发 UI 证据 | `mission-control-stage2-ui-20260722-final\manifest.json` 覆盖 10 个工作区各 100%/125%，但明确 `NO_FINAL_READINESS_CREDIT`，不能替代 package UI |
| Package UI 合同 | schema v7；包体必须包含项目自带 `playwright-browsers\chrome-win64\chrome.exe`，100%/125% 各覆盖十工作区、三项只读 overlay、canonical 子视图与宽屏隔离档 |
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

当前 v1.5 legacy baseline 是 7/8，但正式发布状态由 Mission 八门聚合器决定，最新已生成结果仍为 4/8。项目随包 Playwright Chromium、package launch、安全边界和 adversarial `NODE_ENV` 已验证；当前不存在“唯一阻断”，剩余四门如下：

| 正式门 | 当前状态 | 完成条件 |
|---|---|---|
| Package UI | pending | 重新完成 schema v7 每轮 visible operator handoff；首轮形成 fresh typed + saved/non-reused/identity-verified 证明，并通过 100%/125% 十工作区、overlay、子视图与宽屏合同 |
| 两店连续运行 | blocked by time/real sessions | 两家真实店铺自然经过连续 7 个美国业务日，并形成 14/14 `SUCCESS_8_OF_8` |
| 人工 canary | blocked by current authority | 当前低风险真实对象、当前人工 MissionGrant、可见 Ads 会话以及 before/after/reload 回读全部闭合 |
| Policy-auto canary | blocked by current authority | 人工 canary 完成后，以当前启用策略、kill switch、真实对象和会话完成独立策略自动 canary |

因此当前包只允许内部验证和受控交接；通过 package UI、刷新 Mission readiness、生成匹配的严格 bundle 并完成其安全校验前，不能作为 `APP_READY` 外部分发版本。

## 当前验证状态

| 验证门 | 状态 | 证据 |
|---|---|---|
| 全量测试 | 当前完整回归通过 | `output\codex-evidence\full-vitest-stage8-20260728-final-v7.json`；829/829 suites、3096/3096 tests，0 failed |
| Authority/evidence 聚焦回归 | 通过 | 6 个文件、133/133 tests；覆盖 WAL-only live authority drift、fresh online-backup currentness、Store Capsule TOCTOU、连续运行与两类 canary |
| TypeScript / build | 阶段验证通过 | Main、Preload、Renderer 与相关 workspace 阶段门已通过；正式发布仍以包体和 Mission evidence 为准 |
| 当前业务 UI smoke | 失败，不计当前通过 | `output\codex-evidence\current-business-ui-smoke-1785136536629.json`；5/5 旧 v1.5 脚本因等待旧标题/旧动作超时，需适配 Mission Control 后重跑 |
| 开发工作区 UI 证据 | 通过但无正式信用 | `output\codex-evidence\mission-control-stage2-ui-20260722-final\manifest.json`；10 个工作区各 100%/125%，明确 `NO_FINAL_READINESS_CREDIT` |
| 广告执行 fail-closed | 通过 | `pnpm run verify:ad-execution` |
| Windows 打包 | 通过 | installer `AA3F...0C14`、portable `17B8...B811`、win-unpacked `67DC...5E89`、app content `2FA7...30D5`、main bundle `2DEB...4838` |
| Package launch smoke | 通过 | `output\codex-evidence\package-launch-smoke-1785134748920.json` |
| Package security boundaries | 11/11 通过 | `output\codex-evidence\package-security-boundaries-20260727-stage8-final-v7.json` |
| Adversarial `NODE_ENV` | 通过 | `output\codex-evidence\package-adversarial-node-env-20260727-stage8-final-v7.json` |
| v1.5 legacy final-readiness | `APP_NEEDS_WORK` 7/8 | `output\codex-evidence\final-readiness-20260727-stage8-non-ready-v7.json`；仅是正式 Mission 聚合器的一门输入，不代表 Mission 7/8 |
| Authority snapshot v2 | 快照合同与 WAL-aware currentness 通过，业务权威内容仍不足 | WAL-safe online backup、源/快照只读完整性、当前包三重身份，以及 live DB 三次 fresh online-backup 比对均通过；当前 snapshot 只有 24 张 legacy 表，尚无 Mission `stores` / execution authority 表，因此不能生成两店连续运行或 canary 通过证据 |
| 正式 Mission readiness | `APP_NEEDS_WORK` 4/8 | `output\codex-evidence\mission-control-production-readiness-20260728-stage8-wal-currentness-4-of-8.json`；显式 live DB、snapshot v2、WAL-aware currentness 与输入合同通过，当前仍只通过 v1.5 baseline、launch、security、adversarial 四门 |
| Package UI | schema v7 pending | 项目 Chromium 已进入包体；最新 `2026-07-27T08-10-15-137Z\manifest.json` 因 100% 首轮 15 分钟内未形成 ERP + Ads ready 而失败，protected DB 前后哈希不变 |
| 当前数据导入 | 通过 | 最新批次 `batch_20260625013151957_ajw0nb`：8/8 imported report types，6827 imported total rows；1879 是当前 ASIN 指标，不是全库总量 |
| NON_READY 交付包/安全门 | pending | 旧 2026-07-17 bundle 仅为历史；通过的 schema v7 manifest、刷新后的 Mission readiness 与当前证据选择冻结前不得复用 |

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
# 当前正式结果仍为 4/8；package UI、连续运行、人工 canary、policy-auto canary 未通过时不得把 bundle 称为最终交付
# 以下 legacy-named export/safety 只有在通过的 schema v7 manifest 与当前 NON_READY 证据选择冻结后才运行；当前状态仍为 pending
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
