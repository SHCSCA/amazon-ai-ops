# Amazon AI Ops Agent

面向亚马逊运营的 Windows 本地 AI Ops 桌面工作台。

它把领星广告报表采集、产品级广告量化、关键词与 Listing 优化、AI + 规则建议、人工审批、Ads UI 执行回读和最终交付验收串成一个可审计的本地闭环。

**DELIVERY: APP_READY.** 当前 v1.5 Windows 桌面包已按 `amazon-ai-ops-business-prototype/` 完成 17 页首屏原型 parity 接入、重新打包、启动 smoke、manifest-driven final-readiness、READY bundle 和 READY safety。应用内广告写入仍保持 fail-closed；任何 Ads 改动都必须经过人工审批、截图、执行和回读验证。

## 当前交付

| 项目 | 当前值 |
|---|---|
| 产品形态 | Windows 本地优先 Electron 桌面应用 |
| 当前版本 | `1.5.0` |
| 当前状态 | `APP_READY` |
| 无安装版 EXE | `apps\desktop\release\AmazonAIOpsAgent-1.5.0-portable.exe` |
| 安装版 EXE | `apps\desktop\release\AmazonAIOpsAgent-1.5.0.exe` |
| 无安装版 SHA-256 | `849E5C11D5F4742C936FB4A532E1435B3D33B76187E561CB912A08FA6F673CB9` |
| 安装版 SHA-256 | `3CAB193DE243D53ADB3348569FF5506B1C5A2FE7D237C7590B849A3FFC44D89B` |
| 最终验收证据 | `output\codex-evidence\final-readiness-1783043003005.json` |
| Package launch smoke | `output\codex-evidence\package-launch-smoke-1783043003005.json` |
| READY bundle | `output\delivery-bundles\v15-delivery-bundle-2026-07-03T01-43-56-prototype-parity` |

> 注意：`output/`、`storage/`、AppData DB、raw 领星报表、release EXE 和密钥都是本地交付/运行产物，不进入 Git 提交。

## 能做什么

| 业务域 | 功能 |
|---|---|
| 运营总览 | 今日看板、数据健康、审批/交付状态总览 |
| 数据与量化 | 工作范围、8 类领星广告报表采集、指标核验入库、运营事件标记、产品 ACOS 配置、广告量化诊断 |
| 广告执行 | 优化建议草案、审批历史中心、渐进执行回读 |
| 关键词与 Listing | 关键词机会矩阵、Listing 结构重写、产品管理 |
| 系统与交付 | 最终验收就绪门、本地定时调度、AI 适配与诊断 |

## 当前 UI 状态

| 项目 | 状态 |
|---|---|
| 原型基准 | `amazon-ai-ops-business-prototype/pages/*.html` 17 页 |
| 生产主题 | 只保留浅色 Windows 桌面主题；不实现暗色切换 |
| 字体依赖 | renderer 使用本地/system 字体栈，不依赖 Google Fonts |
| 页面结构 | `ScopeBar -> PageHeader -> OperatorTaskPanel/KPI -> 主业务内容` |
| 17 页首屏 | 已接入短标题、共享 `KpiCard`、状态/表格/流程反馈合同 |
| 产品字段 | 已明确为产品成本、FBA 费用、当前售价、最低可接受售价、目标 ACOS、目标 TACOS、目标净利率 |
| 原型清单 | `docs\design\prototype-reference-index.md`、`docs\design\prototype-parity-checklist.md` |

## 核心工作流

```text
设置工作范围
  -> 采集 8 类领星广告报表
  -> 核验并导入本地 DB
  -> 锁定产品 ASIN
  -> 维护产品成本 / 售价 / ACOS 目标
  -> 记录运营事件
  -> 运行广告量化与 AI 阶段诊断
  -> 生成优化建议
  -> 人工审批
  -> 人工进入 Ads UI 执行
  -> 截图 / reload / 回读
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

## 当前验证状态

| 验证门 | 状态 | 证据 |
|---|---|---|
| TypeScript | 通过 | `pnpm --filter @amazon-ai-ops/desktop run typecheck` |
| Renderer build | 通过 | `pnpm --filter @amazon-ai-ops/desktop run build:renderer` |
| 当前业务 UI smoke | 通过 | `output\codex-evidence\current-business-ui-smoke-1783042927932.json` |
| 广告执行 fail-closed | 通过 | `pnpm run verify:ad-execution` |
| Windows 打包 | 通过 | installer + portable 已生成 |
| Package launch smoke | 通过 | `output\codex-evidence\package-launch-smoke-1783043003005.json` |
| Final readiness | 通过 | `output\codex-evidence\final-readiness-1783043003005.json` |
| READY safety | 通过 | `pnpm run verify:v15-ready-safety ...` |

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
| `pnpm run export:v15-delivery-bundle -- ...` | 导出 READY 交付包 |
| `pnpm run verify:v15-ready-safety -- ...` | READY 交付安全门 |

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
3. 只要 README 影响交付状态说明，就重新导出 READY bundle 并运行 READY safety。
4. 只要改动影响 Windows 桌面 UI / runtime / data collection / EXE 行为，就重新打包 Windows 产物。
5. 任何广告动作都不能绕过人工审批、截图、执行回读和 verifier。
