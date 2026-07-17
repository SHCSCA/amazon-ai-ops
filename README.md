# Amazon AI Ops Agent

面向亚马逊运营的 Windows 本地 AI Ops 桌面工作台。

它把领星广告报表采集、产品级广告量化、关键词与 Listing 优化、AI + 规则建议、人工审批、Ads UI 执行回读和最终交付验收串成一个可审计的本地闭环。

**DELIVERY: APP_NEEDS_WORK — INTERNAL NON_READY ONLY.** 当前 v1.5 已完成任务优先的 8 个可见工作区重构、本轮 UI P2 可读性与状态证据加固、Windows installer/portable 重建、受控有界异步退出清理、包体启动 smoke、100%/125% 紧凑窗口与 1400×900 宽屏包体 UI 验收、哈希固定和 manifest-driven final-readiness。最新真实批次 `batch_20260625013151957_ajw0nb` 已有 8/8 类报表逐类入库，共 6827 条导入指标；产品页显示的 1879 条是当前 ASIN 指标，不是全库总量，因此正式分析入口当前不再受导入完整性门禁阻断。正式 8 个 readiness gates 中 7 个通过，唯一失败门是 `real-ad-execution-readback`；但独立安全审计还发现 3 个不在这 8 门内的基线 P1：导航/重定向 allowlist、`openExternal` 的 `http(s)` allowlist、旧版明文凭证迁移。它们不改变 7/8 计数，却共同阻止对外分发。应用内广告写入继续保持 fail-closed；在真实 Ads v2 回读与这 3 个外部分发 P1 都关闭前，不得声明 `APP_READY` 或把本包对外发布。

## 当前交付

| 项目 | 当前值 |
|---|---|
| 产品形态 | Windows 本地优先 Electron 桌面应用 |
| 当前版本 | `1.5.0` |
| 当前状态 | `APP_NEEDS_WORK`（内部 NON_READY 候选；正式 8 门仅真实 Ads v2 回读失败，另有 3 个门外 P1 阻止对外分发） |
| 无安装版 EXE | `apps\desktop\release\AmazonAIOpsAgent-1.5.0-portable.exe` |
| 安装版 EXE | `apps\desktop\release\AmazonAIOpsAgent-1.5.0.exe` |
| 无安装版 SHA-256 | `CE41FCF95EF592B839CFF3660B1C9DB11A2F546FB7F38D0CDD7160CA27E51B48` |
| 安装版 SHA-256 | `B5358B497FDABB956152EA2CAE419D82B612BC92736433FF9BD6B1DDA36CD5D9` |
| win-unpacked EXE SHA-256 | `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89` |
| app content SHA-256 | `7C6BC0BA9EE2E99D7B02256143E7044757C11135ACFD3F1CE5059F6437511F8E` |
| SQLite authority DB 快照 SHA-256 | `9E82065E780B38A4D3348F4EE723DDF1A50142F3900192E612730CC1C8017439` |
| 证据选择 manifest | `output\codex-evidence\v15-final-readiness-evidence-manifest-20260717-ui-p2-non-ready.json` |
| 最终验收证据 | `output\codex-evidence\final-readiness-20260717-ui-p2-non-ready.json`（`APP_NEEDS_WORK`；7/8 gates passed） |
| Package launch smoke | `output\codex-evidence\package-launch-smoke-1784269772321.json`（win-unpacked + portable PASS） |
| Package UI evidence | `output\codex-evidence\package-ui-evidence\2026-07-17T06-33-01-390Z\manifest.json`（schema v5；2 个紧凑缩放档 + 1 个宽屏档、30 PNG、DB/process/diagnostics PASS） |
| 本轮 NON_READY bundle | `output\delivery-bundles\v15-delivery-bundle-20260717-ui-p2-non-ready`（已导出；`delivery-bundle-manifest.json` 状态为 `APP_NEEDS_WORK`，严格 NON_READY safety 17/17 PASS） |

> 注意：`output/`、`storage/`、AppData DB、raw 领星报表、release EXE 和密钥都是本地交付/运行产物，不进入 Git 提交。
>
> 发布事实源：README 与用户指南只展示摘要；交付状态以 manifest-driven final readiness、当前安装包索引、交付包 manifest 和与状态匹配的 READY/NON_READY safety 校验结果为准。
>
> 历史候选（已取代，不能作为当前交付事实）：2026-07-15、2026-07-16、Task 8A 的 `2026-07-17T04-16-32-110Z` 包体 UI 及其旧哈希、smoke、readiness、bundle 只保留为修复过程记录，不得替代当前 schema v5 的 `2026-07-17T06-33-01-390Z` 包体证据。

## 能做什么

| 业务域 | 功能 |
|---|---|
| 总览 | 今日看板、产品管理、数据健康、审批/交付状态总览 |
| 数据 | 工作范围、数据采集、导入校验、运营事件、成本目标、广告表现 |
| 广告 | 优化建议、审批中心、结果核对 |
| 增长 | 关键词机会、Listing 草案 |
| 系统 | 交付验收、自动任务、AI 与规则 |

## 当前 UI 状态

| 项目 | 状态 |
|---|---|
| 原型基准 | `amazon-ai-ops-business-prototype/pages/*.html` 17 页 |
| 生产主题 | 只保留浅色 Windows 桌面主题；不实现暗色切换 |
| 字体依赖 | renderer 使用本地/system 字体栈，不依赖 Google Fonts |
| 页面结构 | `App Shell -> 8 个可见工作区 -> 子视图导航 -> 当前主任务 -> 业务明细` |
| 8 个工作区 | 今日任务、产品工作台、数据准备、广告诊断、建议与审批、结果核对、关键词与 Listing、系统与交付；旧 16 路由仍由兼容层承接 |
| 首屏任务 | 每个核心子视图先展示当前状态、唯一主动作和安全边界，技术依据与长明细下沉到辅助区 |
| UI 证据 | 开发/运行态 46/46 目标通过，其中 3 个 DEV-only 状态靶点覆盖错误/重试、AI 忙碌与 reduced-motion；最终包 100% 与 125% 两轮均覆盖 8/8 工作区、3/3 overlays，另有 1400×900 的产品/诊断宽屏双栏；合计 30 张 PNG、0 console/page/dropped diagnostics；schema v5 逐轮证明成品进程与目标 profile Chromium 前后均为 0，真实 DB 前后哈希不变 |
| 本轮体验修复 | Diagnosis Inspector 的日期、趋势与支撑文本改为局部双列事实带和可读对比度，消除紧凑/宽屏下日期碎裂与空白失衡；错误重试、AI 忙碌及 reduced-motion 状态已有显式运行态证据 |
| 当前数据事实 | 最新批次 `batch_20260625013151957_ajw0nb` 为 8/8 类逐类入库、6827 条导入指标；产品页 1879 条仅代表当前 ASIN |
| 产品字段 | 已明确为产品成本、FBA 费用、当前售价、最低可接受售价、目标 ACOS、目标 TACOS、目标净利率 |
| 原型清单 | `docs\design\prototype-reference-index.md`、`docs\design\prototype-parity-checklist.md` |

## 核心工作流

```text
设置工作范围
  -> 采集 8 类领星广告报表
  -> 导入校验并写入本地 DB
  -> 锁定产品 ASIN
  -> 维护产品成本 / 售价 / ACOS 目标
  -> 记录运营事件
  -> 运行广告表现与 AI 阶段诊断
  -> 生成优化建议
  -> 人工审批
  -> 人工进入 Ads UI 执行
  -> 截图 / reload / 结果核对
  -> 最终交付验收
```

## 产品边界

| 边界 | 说明 |
|---|---|
| 报表采集 | 只采集/下载/导入真实领星广告报表；截图、审计文件或页面归档不能替代真实报表。 |
| 数据口径 | `campaign`、`ad_group`、`placement`、`advertised_product`、`user_search_term` 是不同维度展开，不能直接相加。 |
| AI 建议 | AI 只生成诊断、解释、阈值建议和草案，不直接写入 Amazon Ads。 |
| 产品配置 | 成本、FBA、当前售价、最低可接受售价、目标 ACOS/TACOS/净利率只保存到本地配置，不审批建议，不执行广告动作。 |
| Listing | Listing 草案只保存为本地版本，不自动提交 Amazon 或领星。 |
| 广告执行 | 桌面端执行保持 fail-closed；低风险动作也必须逐条人工审批、截图、执行、reload 回读和 verifier 通过。 |
| 密钥与凭证 | 登录凭证和 AI Key 由本地安全存储处理，UI 不展示明文，仓库不保存密钥。 |

## 外部分发阻断与剩余工作

正式 final-readiness 仍准确记录为 7/8：只有真实 Ads v2 执行回读未通过。以下 3 项来自独立安全审计，位于正式 8 门之外，因此不能用“7/8 只差回读”推导为可对外分发：

| 优先级 | 未完成项 | 当前边界 | 预计工时 |
|---|---|---|---|
| P1 | 导航/重定向目标 allowlist | 需要限制可导航目标并覆盖拒绝路径；完成前阻止外部分发 | 合计聚焦工程约 4–6 小时（与下两项合计） |
| P1 | `openExternal` 的 `http(s)` allowlist | 需要限制协议与允许目标，拒绝非预期外链；完成前阻止外部分发 | 计入上述 4–6 小时 |
| P1 | 旧版明文凭证迁移 | 当前 authority DB 已有加密 key，且未发现 legacy 明文 key；仍需实现旧安装升级时的迁移/清除路径 | 计入上述 4–6 小时 |
| 外部门 | 真实 Ads v2 执行回读 | 需先具备当前正向 recommendation、人工批准与 Ads 访问，再完成执行、前后/reload 截图及 authority 校验 | 前置条件满足后约 30–60 分钟 |
| 非阻断 | eval/历史证据清理 | 不影响当前内部 NON_READY 验收，可在交付后整理 | 约 0.5–1.5 小时 |

因此当前包只允许内部验证和受控交接，不能作为外部分发版本。

## 当前验证状态

| 验证门 | 状态 | 证据 |
|---|---|---|
| 全量测试 | 通过 | `output\codex-evidence\ui-p2-full-vitest-20260717-final.json`；170/170 文件、576/576 suites、1950/1950 tests，0 failed/pending；默认 Vitest pool 已固定为 forks，避免 Windows threads teardown 假失败 |
| TypeScript | 通过 | 最终 Windows 候选前门禁已完成 |
| Renderer build | 通过 | 统一正式数据门、任务摘要与关键词阻断状态已进入当前包体 |
| 当前业务 UI smoke | 5/5 通过 | `output\codex-evidence\current-business-ui-smoke-1784270629248.json` |
| 工作区 UI 证据 | 46/46 通过 | `output\codex-evidence\workspace-ui-task6\workspace-ui-evidence-run-2026-07-17T06-23-26-823Z.json`；含 3 个 DEV preview 状态靶点 |
| 广告执行 fail-closed | 通过 | `pnpm run verify:ad-execution` |
| Windows 打包 | 通过 | 当前 installer、portable、win-unpacked 与 app content 哈希已固定 |
| Package launch smoke | 通过 | `output\codex-evidence\package-launch-smoke-1784269772321.json` |
| Final readiness | `APP_NEEDS_WORK` | `output\codex-evidence\final-readiness-20260717-ui-p2-non-ready.json`；7/8 gates passed，唯一失败门是 `real-ad-execution-readback`；这不覆盖上述 3 个门外 P1；authority DB 为 `C:\Users\wz\AppData\Roaming\@amazon-ai-ops\desktop\amazon-ai-ops.db` |
| 打包 UI 证据 | schema v5 / 3 个视口档通过 | `output\codex-evidence\package-ui-evidence\2026-07-17T06-33-01-390Z\manifest.json`；100%/125% 各覆盖 8/8 工作区、3/3 overlays，1400×900 覆盖产品/诊断宽屏双栏，共 30 PNG；每轮成品/profile browser 前后为 0，0 console/page/dropped diagnostics，受保护 DB 不变 |
| 当前数据导入 | 通过 | 最新批次 `batch_20260625013151957_ajw0nb`：8/8 imported report types，6827 imported total rows；1879 是当前 ASIN 指标，不是全库总量 |
| NON_READY 交付包/安全门 | 17/17 通过 | `output\delivery-bundles\v15-delivery-bundle-20260717-ui-p2-non-ready\delivery-bundle-manifest.json` 已导出，状态为 `APP_NEEDS_WORK`；严格 `verify:v15-non-ready-safety` 17/17 PASS。它只授权内部 NON_READY 交接，不代表 `APP_READY` 或允许外部分发 |

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
| `pnpm run smoke:business-ui-current` | 当前业务 UI smoke |
| `pnpm run smoke:package-launch` | 打包产物启动 smoke |
| `pnpm run verify:ad-execution` | 广告执行 fail-closed 安全验证 |
| `pnpm run verify:ad-readback -- <evidence.json>` | 单个广告回读证据验证 |
| `pnpm run write:v15-evidence-manifest -- ...` | 固定最终验收证据选择 |
| `pnpm run verify:v15-final-readiness -- ...` | 生成/验证 final-readiness |
| `pnpm run export:v15-delivery-bundle -- ...` | 导出 manifest-driven 交付包 |
| `pnpm run verify:v15-ready-safety -- ...` | READY 交付安全门 |
| `pnpm run verify:v15-non-ready-safety -- ...` | APP_NEEDS_WORK 交付安全门 |

生产交付顺序固定为：

```powershell
pnpm run write:v15-evidence-manifest -- --delivery <full8-evidence.json> --listing-read <listing-read.json> --ai-live <ai-live.json> --ad-ai-explanation <ad-ai-explanation.json> --listing-ai-draft <listing-ai-draft.json> --ad-readback <ad-readback.json> --out <evidence-manifest.json>
pnpm --filter @amazon-ai-ops/desktop run build:win
pnpm run smoke:package-launch
pnpm run evidence:package-ui -- --expected-exe-sha256 <win-unpacked-sha256> --expected-app-content-sha256 <app-content-sha256> --user-data-dir <isolated-profile-copy> --protected-db <amazon-ai-ops.db> --allow-saved-login
pnpm run verify:v15-final-readiness -- --evidence-manifest <evidence-manifest.json> --package-launch-smoke <package-launch-smoke.json> --db <amazon-ai-ops.db> --out <final-readiness.json>
# 分支 A：如果最终验收为 `APP_NEEDS_WORK`，README 顶部 DELIVERY 行必须保持非 READY
pnpm run export:v15-delivery-bundle -- --final-readiness <final-readiness.json> --package-ui-manifest <package-ui-manifest.json> --workspace-ui-manifest <workspace-ui-manifest.json> --business-ui-smoke <current-business-ui-smoke.json> --full-test-evidence <full-vitest.json> --data-reconciliation <reconciliation.json> --data-reconciliation-md <matching-reconciliation.md> --release-dir apps\desktop\release --readme README.md --db <amazon-ai-ops.db> --skip-latest-extras true --out <non-ready-bundle>
pnpm run verify:v15-non-ready-safety -- --final-readiness <final-readiness.json> --bundle-manifest <non-ready-bundle>\delivery-bundle-manifest.json --package-launch-smoke <package-launch-smoke.json> --package-ui-manifest <package-ui-manifest.json> --readme README.md --db <amazon-ai-ops.db>
# 分支 B：只有最终验收为 `APP_READY` 时，README 顶部 DELIVERY 行才切到 `APP_READY`
pnpm run export:v15-delivery-bundle -- --final-readiness <final-readiness.json> --package-ui-manifest <package-ui-manifest.json> --workspace-ui-manifest <workspace-ui-manifest.json> --business-ui-smoke <current-business-ui-smoke.json> --full-test-evidence <full-vitest.json> --data-reconciliation <reconciliation.json> --data-reconciliation-md <matching-reconciliation.md> --release-dir apps\desktop\release --readme README.md --db <amazon-ai-ops.db> --skip-latest-extras true --out <ready-bundle>
pnpm run verify:v15-ready-safety -- --final-readiness <final-readiness.json> --ui-smoke <current-business-ui-smoke.json> --bundle-manifest <ready-bundle>\delivery-bundle-manifest.json --db <amazon-ai-ops.db>
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
3. 只要 README 影响交付状态说明，就重新导出当前状态对应的 bundle，并运行与 final-readiness 匹配的 READY 或 NON_READY safety。
4. 只要改动影响 Windows 桌面 UI / runtime / data collection / EXE 行为，就重新打包 Windows 产物。
5. 任何广告动作都不能绕过人工审批、截图、执行回读和 verifier。
