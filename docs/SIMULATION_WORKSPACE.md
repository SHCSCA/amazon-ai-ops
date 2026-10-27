# 模拟工作台历史说明

> 历史文档（2026-10-27 归类）：以下计划、完成声明、计数、包哈希及 READY 只描述原阶段，不代表当前版本。现行状态及后续工作见 [项目状态](PROJECT_STATUS.md)；保留正文供追溯，不自动重新执行旧计划。

## 当前入口

2026-10-16 用户要求后续直接使用真实应用，模拟先行方案已被取代。当前入口为 `apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe`，按正常模式使用应用默认 userData；新机无原运行数据不阻塞启动。真实应用已启动，并建立本次新机数据库、`Local State` 与初始化备份，未恢复旧店铺数据。

本文件及模拟脚本保留历史用途，后续不再默认启动模拟服务或打开预览页。以下记录先前的模拟数据与入口，不作为当前操作步骤。

## 历史方案

此前用户允许查找项目备份或使用模拟数据，方案曾复用 Renderer 已有的开发预览数据查看页面和演示本地交互。

模拟数据保存在预览 API 的内存中，不建立正式数据库，不恢复历史店铺会话。刷新页面或重新启动后恢复初始样例。

## 历史启动入口

原模拟入口为仓库根目录 `start-simulation.cmd`，对应命令：

```powershell
node scripts/start-local-simulation.mjs
```

该服务曾通过 `http://127.0.0.1:端口/?preview=1&scenario=mixed-recommendations` 提供示例店铺页面，按 `Ctrl+C` 关闭服务。

入口复用 `scripts/business-ui-smoke-navigation.js` 的本机 Vite 服务，只监听 `127.0.0.1`。启动清单和结构化日志保存在 `output/local-simulation/<运行时间>/`。

## 示例数据

| 内容 | 来源及用途 |
|---|---|
| SHC001-US、SHC002-US | 两个既有示例店铺，可查看店铺切换和不同对象 |
| 每店 3 个产品、4 类广告对象、2 条关键词机会 | 默认 `mixed-recommendations` 场景，查看经营对象与建议 |
| 每店 7 个任务、7 条决策 | 各含多种状态，任务中有 1 项归档，支持本地状态流转 |
| 每店 7 个实验、2 条观察、2 个指标快照、8 条因果事件 | 查看既有示例状态与本地交互，实验中有 1 项归档 |
| 八类报表投影、Listing 和版本 | 演示采集、导入、诊断和草稿页面；没有对应真实报表文件 |

主要数据源：

- `apps/desktop/src/renderer/dev-preview-api.ts`
- `apps/desktop/src/renderer/mission-control/workspaces/canonical-workspace-fixtures.ts`
- `apps/desktop/src/renderer/mission-control/workspaces/mission-domain-window-api.ts`

页面会显示“仅开发预览”“仅原型”或“仅供预览”等提示。示例日期沿用 fixture 的样例时间，审批、执行、实验状态均为演示内容，不代表真实店铺记录或七日效果。

如需查看较大产品列表，可把地址中的 `scenario=mixed-recommendations` 改成 `scenario=diagnosis-ready`。该场景每店有 120 个产品、120 条诊断、120 条运营事件和 34 日汇总。今日总览的真实准备度仍可能显示为零或阻断，这是预览环境的既定行为。

## 项目备份检查结果

2026-10-16 检查仓库当前文件、全部可达 Git 历史（309 个提交）及发布 ZIP 中央目录，没有发现正式数据库、报表备份或 `Local State`。发布 ZIP 是应用程序归档。历史文档指向的 `output/codex-evidence/authority-snapshots/`、2026-09-07 实施备份目录以及 `storage/` 均不存在。

本次范围不含仓库外目录和 Git 不可达对象。没有从历史状态文字重建店铺、授权或实验记录。

## 后续顺序

1. 直接使用真实 Windows Electron 应用，依据当前页面和日志处理实际问题。
2. 对实际发现的问题按领域修复，同步进度、阻塞与证据。
3. 在新电脑登录真实店铺、建立当前数据基线，再按人工与策略两种模式执行原主流程；若以后取得旧库，另行核验和安全恢复，不伪造历史数据或授权。

模拟工作台不连接领星、Amazon Ads 或付费 AI，不生成正式 Grant 或真实执行记录，也不提升 `APP_NEEDS_WORK / INTERNAL NON_READY` 状态。四种 Windows 包的工程验收结论继续以原工程汇总为准。
