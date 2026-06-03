# Amazon AI Ops Agent

Amazon AI Ops Agent 是一个本地优先的 Electron 桌面应用，用于亚马逊运营数据采集、关键词机会分析、Listing 覆盖分析、Listing 改写建议、证据导出和本地审计。当前仓库主线是 v1.5 工作流。

## 当前状态

| 项目 | 状态 | 证据/位置 |
|---|---:|---|
| 主分支合并 | 已完成 | `master` 已快进到 v1.5 实现提交 |
| GitHub 推送 | 已完成 | `origin/master` 指向 v1.5 当前代码 |
| 本地测试 | 通过 | `pnpm test` 通过，最近记录见 `docs/V1_5_PROGRESS_REPORT.md` |
| 类型检查 | 通过 | `pnpm typecheck` 通过 |
| 桌面构建 | 通过 | `pnpm build` 生成 Windows 桌面包 |
| 打包应用冒烟 | 通过 | 打包 exe 可启动并保持运行 |
| 关键词/Listing v1.5 工作流 | 已结构完成 | 导入、诊断、机会评分、建议、草稿、导出已接入 |
| 领星下载中心采集 | 结构完成，未实采通过 | 自动化路径 fail-closed，等待真实登录会话验证页面模型 |

## 核心目标

当前目标不是简单把功能按钮补齐，而是把 v1.5 做成可审计、可回放、可失败闭环的本地桌面工作流：

| 目标 | 说明 |
|---|---|
| 保留现有代码 | v1.2 基础模块已恢复并保留，v1.5 在现有架构上补齐 |
| 缺失项显式化 | 缺口记录在 `docs/MISSING_MODULES_MATRIX.md`、`docs/V1_5_ACCEPTANCE_MATRIX.md` |
| 不猜测页面结构 | 领星页面模型只能从真实浏览器证据固化 |
| 失败可审计 | 诊断、截图、DOM、Trace、manifest、审计导出均本地保存 |
| 自动化 fail-closed | 未验证选择器、未登录、证据过期或不匹配时不得静默采集 |

## 已完成模块

| 模块 | 完成情况 |
|---|---|
| 共享 v1.5 类型 | `packages/shared-types/src/v1_5.ts` 已新增并导出 |
| 领星报表采集器 | 8 类广告报表定义、批次 manifest、文件校验、失败重试、单报表重试、模拟 E2E |
| 下载中心诊断 | 页面诊断、截图、DOM 快照、selector candidates、action selector 检查、证据包导出 |
| 页面模型覆盖 | 本地 override 保存、重置、备份、校验、启用审计 |
| 采集预检 | 启动采集前检查页面模型、诊断证据、截图/DOM 文件、浏览器登录状态 |
| 关键词导入 | Search Term/SQP/keyword report 映射、诊断、重复导入策略、错误行导出 |
| 关键词机会 | ASIN + normalized keyword 聚合、评分、风险过滤 |
| Listing 分析 | 手工/Excel 导入、覆盖分析、建议生成、接受/忽略、AI/规则草稿 |
| 导出 | CSV/XLSX/Markdown、验收审计、预检证据包、诊断证据包 |
| SQLite | v1.5 批次、文件、关键词、Listing、诊断、草稿等表已补齐 |
| 桌面 UI/API | IPC、preload、v1.5 工作台界面已接入 |

## 当前卡点

| 卡点 | 当前证据 | 结论 |
|---|---|---|
| 领星下载中心真实 URL | 真实浏览器打开候选地址后，`erp.lingxing.com` 跳回登录页 | 未登录状态不能验证内部下载中心 URL |
| 官网候选地址 | `https://www.lingxing.com/download-center` 返回官网 404 页面 | 不是可用下载中心 |
| 下载中心 action selectors | 当前无法进入已登录内部页面 | 不允许猜测 selector |
| 真实 8 报表 E2E | 需要已登录领星账号和真实页面模型 | 未完成 |
| 真实失败 Trace 内容 | 需要真实失败路径触发 | 未完成 |

## 真实浏览器验证记录

用户明确要求必须打开浏览器验证，不能猜测。已使用 Playwright 持久化 Chromium 会话打开页面模型候选 URL，产物在本地：

`output/playwright/lingxing-download-center-2026-06-03T01-35-38-629Z/`

| 候选 URL | 实际结果 | 结论 |
|---|---|---|
| `https://erp.lingxing.com/download-center` | 跳转到 `https://erp.lingxing.com/`，标题为“领星ERP - 跨境电商管理系统”，页面内容为账号/微信登录 | 当前浏览器会话未登录 |
| `https://www.lingxing.com/download-center` | 停留在官网 URL，页面提示“对不起，您访问的页面不存在” | 官网路径不可用 |
| `https://erp.lingxing.com/report/download` | 跳转到 `https://erp.lingxing.com/`，页面内容为登录 | 当前浏览器会话未登录 |

因此，当前只能证明“未登录会话会被重定向到登录页”，不能证明下载中心内部 selector。下一步必须在同一持久化浏览器 profile 中完成领星登录，再重新运行诊断。

## 下一个 AI 接手步骤

| 顺序 | 任务 | 验收条件 |
|---:|---|---|
| 1 | 确认 Git 状态 | `git status --short --branch` 显示 `master...origin/master`，除本地运行产物外无未提交代码 |
| 2 | 确认不要提交运行产物 | `output/`、`storage/` 是本地证据和浏览器 profile，已加入 `.gitignore` |
| 3 | 用真实浏览器登录领星 | 使用项目浏览器架构或桌面应用保持同一 `storage/browser-data` profile |
| 4 | 运行下载中心诊断 | 在桌面 UI 使用 `验证页面`，确认进入真实下载中心，而不是登录页 |
| 5 | 导出诊断证据包 | 使用 `导出证据包`，保存截图、DOM、selector candidates、action selector checks |
| 6 | 固化页面模型 | 从证据中填写 `actionSelectors`，保存本地 page-model override |
| 7 | 启用前审计 | 运行 `导出启用审计`，只有 scoped selectors 和同模型同日期诊断都通过后才能将 `requiresManualVerification` 设为 `false` |
| 8 | 真实采集 E2E | 跑完整 8 报表批次，验证 manifest、文件名日期 token、文件大小、失败重试、单报表重试 |
| 9 | 导出最终验收审计 | 使用 `导出验收审计`，要求所有 8 个报表、诊断证据、manifest 和文件证据一致 |

## 常用命令

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @amazon-ai-ops/desktop run build:win
```

## 关键文档

| 文档 | 用途 |
|---|---|
| `docs/amazon_ai_ops_desktop_prd_arch_dev_spec_v1_5_no_external.md` | v1.5 PRD/架构/开发规格 |
| `docs/MISSING_MODULES_MATRIX.md` | 缺失模块矩阵 |
| `docs/V1_5_PROGRESS_REPORT.md` | 当前进度和最新增量 |
| `docs/V1_5_ACCEPTANCE_MATRIX.md` | 需求验收矩阵 |
| `docs/USER_GUIDE_v1_5.md` | 用户操作指南 |

## 交付边界

当前交付是“结构闭环 + 本地验证通过 + 主分支已推送”。还不能宣称“领星真实下载中心自动采集完成”。真实采集完成的最低证据是：已登录真实领星会话、同一 page-model snapshot 的诊断证据、可唯一定位的 action selectors、完整 8 报表下载、manifest 与数据库/文件系统一致、最终验收审计通过。
