# Amazon AI Ops Agent

Amazon AI Ops Agent 是一个本地优先的 Electron 桌面应用，用于亚马逊运营数据采集、关键词机会分析、Listing 覆盖分析、Listing 改写建议、证据导出和本地审计。当前仓库主线是 v1.5 工作流。

## 当前状态

| 项目 | 状态 | 证据/位置 |
|---|---:|---|
| v1.5 基线合并 | 已完成 | `master...origin/master` 当前同步到已推送的 v1.5 基线 |
| 本轮收尾改动 | 本地待提交/推送 | 本轮 UI 布局、旧定时入口清理、文档和安装包证据已在本地完成，尚未提交到 `origin/master` |
| 本地测试 | 通过 | `pnpm test` 通过，最近记录见 `docs/V1_5_PROGRESS_REPORT.md` |
| 类型检查 | 通过 | `pnpm typecheck` 通过 |
| 桌面构建 | 通过 | `pnpm --filter @amazon-ai-ops/desktop run build:win` 生成 Windows 安装包 |
| 打包应用冒烟 | 通过 | 打包 exe 可启动并保持运行 |
| 当前安装包 | 已生成 | `apps/desktop/release/AmazonAIOpsAgent-1.5.0.exe`，SHA-256 `96A09A11CFB78C8BD10455274E33A2528C0430C0244BEF3933319DD9E202077D`，大小 `89594452` bytes，最后构建 `2026-06-04 16:28:38` |
| 关键词/Listing v1.5 工作流 | 已结构完成 | 导入、诊断、机会评分、建议、草稿、导出已接入 |
| 领星下载中心采集 | 创建页 selector 已只读诊断，自动化仍未放行 | 已用真实登录会话完成 Ads 下载中心两阶段诊断；真实生成/下载和 8 报表 E2E 仍 fail-closed |

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
| v1.5 工作台收尾 | 修复 `验证页面` 点击区域被相邻面板覆盖的问题；移除旧版 `daily_report_download` 定时入口 |
| 关键词导入 | Search Term/SQP/keyword report 映射、诊断、重复导入策略、错误行导出 |
| 关键词机会 | ASIN + normalized keyword 聚合、评分、风险过滤 |
| Listing 分析 | 手工/Excel 导入、覆盖分析、建议生成、接受/忽略、AI/规则草稿 |
| 导出 | CSV/XLSX/Markdown、验收审计、预检证据包、诊断证据包 |
| SQLite | v1.5 批次、文件、关键词、Listing、诊断、草稿等表已补齐 |
| 桌面 UI/API | IPC、preload、v1.5 工作台界面已接入 |

## 真实浏览器验证结论

| 项目 | 当前证据 | 结论 |
|---|---|---|
| ERP 登录入口 | `https://erp.lingxing.com/` 真实登录页字段为 `input[name="account"]`、`input[name="pwd"]`、`button.loginBtn` | 旧的 `www.lingxing.com/login` 和 `username/password` selector 不可用 |
| Ads 系统入口 | ERP 顶部“广告”进入 `https://ads.lingxing.com/home`，页面显示“领星广告系统” | ERP 登录和 Ads 会话必须分别校验，不能只看 ERP 是否登录 |
| Ads 下载中心真实 URL | `https://ads.lingxing.com/ak_download/download_center/download_report_log/index`，标题“下载中心” | 已固化为内置 page model 的首选候选 URL |
| 下载中心已读证据 | 页面存在“创建报告”“搜索店铺”“报告类型”“生成成功”“下载”，下载链接类名 `.JS-download-report` | 只证明只读页面和历史行可见，未证明自动创建/下载可安全执行 |
| 创建报告页面 | `create_report` 页面存在店铺选择、报告名称、报告类型、开始/结束日期、每日明细、全部指标、生成报告按钮 | 已记录 DOM/截图，并通过只读诊断确认关键控件可唯一定位；尚未点击“生成报告” |
| 下载中心 action selectors | 内置 `actionSelectors` 已填写创建页和历史行选择器草案，`requiresManualVerification: true` | 创建页控件已通过桌面 IPC 只读诊断；ready/download 仍需真实生成行验证后才能无人值守采集 |
| 真实 8 报表 E2E | 需要已登录领星账号和真实页面模型 | 未完成 |
| 真实失败 Trace 内容 | 需要真实失败路径触发 | 未完成 |

## 真实浏览器验证记录

用户明确要求必须打开浏览器验证，不能猜测。已使用 Playwright 持久化 Chromium 会话完成两轮验证。

第一轮未登录候选 URL 验证产物：

`output/playwright/lingxing-download-center-2026-06-03T01-35-38-629Z/`

| 候选 URL | 实际结果 | 结论 |
|---|---|---|
| `https://erp.lingxing.com/download-center` | 跳转到 `https://erp.lingxing.com/`，标题为“领星ERP - 跨境电商管理系统”，页面内容为账号/微信登录 | 当前浏览器会话未登录 |
| `https://www.lingxing.com/download-center` | 停留在官网 URL，页面提示“对不起，您访问的页面不存在” | 官网路径不可用 |
| `https://erp.lingxing.com/report/download` | 跳转到 `https://erp.lingxing.com/`，页面内容为登录 | 当前浏览器会话未登录 |

第二轮真实登录和 Ads 下载中心验证产物：

| 证据目录 | 证明内容 |
|---|---|
| `output/playwright/lingxing-login-probe-2026-06-03T01-56-31-491Z/` | ERP 登录页真实字段和按钮 selector |
| `output/playwright/lingxing-login-session-2026-06-03T01-57-48-284Z/` | 真实账号登录后进入 `https://erp.lingxing.com/erp/home` |
| `output/playwright/lingxing-ad-menu-probe-2026-06-03T02-12-52-205Z/` | ERP “广告”入口进入 Ads 系统 |
| `output/playwright/lingxing-ads-links-2026-06-03T02-14-53-432Z/` | Ads 系统存在下载中心链接 `/ak_download/download_center/download_report_log/index` |
| `output/playwright/lingxing-ads-download-center-2026-06-03T02-16-06-375Z/` | 真实 Ads 下载中心截图、HTML、JSON 快照，历史 8 类报告行可见 |
| `output/playwright/lingxing-ads-create-report-modal-2026-06-03T02-17-17-750Z/` | 创建报告页面截图、HTML、JSON 快照；未点击“生成报告” |

第三轮桌面应用两阶段只读诊断产物：

| 证据 | 证明内容 |
|---|---|
| `output/codex-evidence/desktop-ipc-two-phase-diagnostic-1780542152692.json` | 桌面主进程 IPC 诊断 id `4`，真实登录后进入 Ads 下载中心，`ready: true`，`missingRequiredSelectors: []` |
| `C:\Users\wz\AppData\Roaming\@amazon-ai-ops\desktop\storage\screenshots\download_center_diagnostic_1780542191091.png` | 同次诊断截图证据 |
| `C:\Users\wz\AppData\Roaming\@amazon-ai-ops\desktop\storage\dom-snapshots\download_center_diagnostic_1780542191254.html` | 同次诊断脱敏 DOM 证据 |

第四轮桌面 UI 布局回归产物：

| 证据 | 证明内容 |
|---|---|
| `output/codex-evidence/renderer-v15-diagnose-layout-qa-1780561270634.json` | `验证页面` 按钮中心点命中按钮本身，点击后能渲染诊断通过状态 |
| `output/codex-evidence/renderer-v15-diagnose-layout-qa-1780561270634.png` | 同次 UI 布局截图 |

因此，当前已证明下载中心真实页面位于 Ads 系统，而不是旧的 ERP/官网候选 URL；也已证明创建报告页的店铺、报告名称、报告类型、日期、每日明细、生成按钮等关键 selector 在只读诊断中可唯一定位。尚未证明真实报告生成后的 ready 行和下载按钮，也未完成真实 8 报表下载。

## 下一个 AI 接手步骤

| 顺序 | 任务 | 验收条件 |
|---:|---|---|
| 1 | 确认 Git 状态 | `git status --short --branch` 显示 `master...origin/master`；本轮收尾改动仍在本地，提交/推送前需复核变更范围 |
| 2 | 确认不要提交运行产物 | `output/`、`storage/` 是本地证据和浏览器 profile，已加入 `.gitignore` |
| 3 | 用真实浏览器登录领星 | 使用项目浏览器架构或桌面应用保持同一 `storage/browser-data` profile，并同时确认 Ads 系统会话 |
| 4 | 复核下载中心诊断证据 | 已有 IPC 诊断 id `4` 和 UI 布局点击证据；真实 Lingxing 会话稳定后，从桌面 UI 再点击 `验证页面` 刷新当前构建的同模型证据 |
| 5 | 导出诊断证据包 | 使用 `导出证据包`，保存截图、DOM、selector candidates、action selector checks |
| 6 | 复核页面模型 | 内置 `actionSelectors` 已填写；保持 `requiresManualVerification: true`，直到 ready/download 也有真实生成行证据 |
| 7 | 启用前审计 | 运行 `导出启用审计`，只有 scoped selectors、同模型同日期诊断、截图/DOM 文件证据都通过后才能考虑关闭人工验证 |
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

当前交付是“结构闭环 + 本地验证通过 + 真实 Ads 下载中心只读定位完成 + 创建报告页 selector 诊断通过”。还不能宣称“领星真实下载中心自动采集完成”。真实采集完成的最低证据是：已登录真实领星和 Ads 会话、同一 page-model snapshot 的桌面诊断证据、可唯一定位的创建/ready/download action selectors、完整 8 报表下载、manifest 与数据库/文件系统一致、最终验收审计通过。
