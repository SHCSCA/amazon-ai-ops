# Amazon AI Ops Agent

Amazon AI Ops Agent 是一个本地优先的 Electron 桌面应用，用于亚马逊运营数据采集、关键词机会分析、Listing 覆盖分析、Listing 改写建议、证据导出和本地审计。当前仓库主线是 v1.5 工作流。

## 当前状态

**DELIVERY: APP_READY.** 领星广告下载中心报表采集、Lingxing Listing 详情页只读读取、DeepSeek live、广告建议 AI 解释、Listing AI 草案和一次真实广告执行 readback 均已通过 manifest 驱动最终聚合。当前真实广告样例为用户明确批准的暂停 target 降 bid：现场 live bid `1.20 -> 1.08`，before/after/reload 截图和值回读均已通过 `verify:ad-readback`。应用内广告执行按钮仍保持 fail-closed，不做批量自动写入；后续每个广告动作必须绑定自己的店铺、站点、广告组合、campaign、ad group、ASIN、对象和动作，并独立审批、截图和回读。

| 项目 | 状态 | 证据/位置 |
|---|---:|---|
| v1.5 基线合并 | 已完成 | `master...origin/master` 当前同步到已推送的 v1.5 基线 |
| 本轮收尾改动 | 本地未提交 | 包含操作员验收门、单报表 canary、packaged runtime 依赖修复、ERP-to-Ads 登录入口修复、浏览器错误脱敏、广告执行 fail-closed、AI/DeepSeek 设置测试连接、AI live 脱敏证据脚本、Lingxing Listing 只读读取入口、源代码版 Listing 详情读取证据和交付证据脚本 |
| 本地测试 | 通过 | 最终节点已按用户要求跑一次全量：`pnpm test` 通过，37 test files / 191 passed / 2 skipped |
| 类型检查 | 通过 | `pnpm -r run typecheck` 通过 |
| 桌面构建 | 通过 | `pnpm --filter @amazon-ai-ops/desktop run build:win` 通过并生成最终 Windows 安装包 |
| 打包应用冒烟 | 通过 | `apps\desktop\release\win-unpacked\AmazonAIOpsAgent.exe` 启动后 8 秒仍存活，随后停止，无残留 `AmazonAIOpsAgent` 进程 |
| 最终安装包证据 | 通过 | `apps/desktop/release/AmazonAIOpsAgent-1.5.0.exe`，SHA-256 `96648ADD7F51C2CFAC8289CD61F5449FE2453C556127C049668F6FB3613FEBC1`，大小 `89678328` bytes，最后构建 `2026-06-10 14:48:01` |
| 当前安装版启动复验 | 通过 | 已清理 2026-06-03 旧安装目录并用当前 installer 覆盖；从系统应用入口打开进入登录页，不再出现主进程 JavaScript error |
| 关键词/Listing v1.5 工作流 | 结构完成，真实详情读取已验证 | 左侧菜单已按后台业务域拆成 `广告运营`、`关键词与 Listing`、`交付与系统` 等分组，`交付验收` 不再混在日常操作入口前面；`广告报表`、`关键词机会`、`Listing 优化` 各自有独立页面说明、主任务和验收口径。Listing 页新增 `读取 Listing -> 生成建议 -> 采纳建议 -> 生成草案 -> 导出交付` 流程状态条；导入、诊断、机会评分、建议、只用已采纳建议生成草案、AI 回退原因、草案审查表、复制草案、最近导出打开、草案导出、从当前领星页面/指定 URL 只读读取入口已接入；源代码版真实详情页已读到 ASIN/title、10 条五点和后台词，AI 改写仍需真实 Key 证据 |
| 领星下载中心采集 | full-8 真实 E2E 通过 | 当前安装版完成 ERP -> Ads 会话确认、启用后诊断 id `27` 通过；full-8 批次 `batch_20260609045655853_ft8uda` 下载 8/8、失败 0，DB/manifest/文件系统/验收审计均通过 `pnpm run verify:v15-delivery -- output\codex-evidence\desktop-live-full-8-e2e-2026-06-09.json` |
| 广告指标口径 | 需复核 | `output/codex-evidence/full8-data-reconciliation-2026-06-09.json` 显示当前 full-8 范围权威用户搜索词口径为 spend `145.20`、orders `5`、sales `324.95`；campaign/ad_group/placement/advertised_product/user_search_term 是不同维度展开，不能直接相加 |
| 广告建议执行 | 人工 readback 样例已通过，应用内执行仍 fail-closed | UI 的列表执行按钮仍显示为“生成阻断审计”，避免未绑定动态目标时批量写入广告账户。真实执行验收通过的是一次人工 Ads UI 低风险动作：暂停 target `紧密匹配` 出价 `1.20 -> 1.08`，并完成 before/after/reload readback。建议生成已接入 DeepSeek/OpenAI-compatible 解释链：有 Key 时记录 `explanationSource=ai`、AI explanation/model/risk，缺 Key 或失败时保留规则建议并显示 fallback |
| 广告建议 AI 解释证据 | 通过 | `output\codex-evidence\installed-ad-ai-explanation-user-key-2026-06-10.json` 由安装版 app 生成并通过 `pnpm run verify:ad-ai-explanation -- <evidence>`；证据证明 packaged app、真实 DeepSeek Key、AI 连接测试成功、只读安全标记、AI 设置恢复、266 条范围指标、1 条 `explanationSource=ai` 建议、store/site/ASIN/entity/action/metricDate 上下文、无 fallback、无密钥泄漏 |
| 广告 readback 证据契约 | 真实样例通过，通用合同已接入 UI | `output\codex-evidence\real-ad-execution-readback-candidate-rec-1.json` 已通过 `pnpm run verify:ad-readback -- <evidence>`。证据包含显式 operator approval、可追溯审批凭证、低风险 action、store/site/campaign/ad group/entity/action 上下文、before/after 截图、live bid 来源说明、值变化、readback actualValue、独立 readback evidence 文件、`execution.channel=manual_ads_ui`、`appExecutorUsed=false`、执行人、时间顺序、无 full8/listing AI 混入、无密钥泄漏。UI 已从固定候选升级为通用目标录入：后续任意品、广告组或投放对象都必须填写自己的动态 target/source/before/after/readback 字段，不能复用本次 D6 样例 |
| 真实广告 readback 操作手册 | 已新增 | `docs\REAL_AD_READBACK_RUNBOOK.md` 面向操作员列出当前候选动作、禁止执行条件、执行前/执行后必须填写字段、时间顺序和最终验收命令；该手册不授权自动写入，只用于人工低风险动作的证据闭环 |
| DeepSeek 真实连接 | 通过 | `output\codex-evidence\deepseek-live-1781066552798.json` 通过 `pnpm run verify:ai-live`，真实 provider 返回内容和 token usage；脚本已显式关闭 DeepSeek thinking 以避免短连接测试被 reasoning 消耗 |
| AI 结构证据 | 结构通过，不给 READY credit | `pnpm run run:ai-structural-mock` 生成 `output\codex-evidence\structural-ai-openai-compatible-mock-1780999446986.json`，并通过 `pnpm run verify:ai-structural-mock -- <evidence>`；该证据只证明 OpenAI-compatible 请求/响应形状、Listing AI JSON 映射和脱敏策略，明确 `NO_FINAL_READINESS_CREDIT`，不能替代真实 DeepSeek Key |
| Lingxing Listing 页面读取 | 真实详情页证据通过 | 主进程 IPC、preload、UI 按钮、指定 URL 读取、字段完整性证据已接入；读取区分 `partialReady` 和 `fullContentReady`，并支持显式 `只读探测详情页`：只从当前 ASIN 行点击唯一安全详情/查看/编辑候选，校验同域和同 ASIN，不点击保存/发布；`output\codex-evidence\source-listing-read-detail-probe-2026-06-09-merged-detail.json` 通过 `pnpm run verify:listing-read`，证明源代码版通过 ERP 登录态进入 `https://erp.lingxing.com/erp/editListing`，同 ASIN `B0GTTJFQTM`，读取标题、10 条五点和后台词，`fullContentReady=true` |
| Listing AI 草案证据 | 通过 | `output\codex-evidence\installed-listing-ai-draft-user-key-2026-06-10.json` 通过 `pnpm run verify:listing-ai-draft -- <evidence>`；证据证明本地 Listing 草案模式无广告写入/无 full-8 报表，AI 连接成功，基于 accepted suggestion 生成 `source=ai` 草案，无 fallback，含 `AI reason`，并恢复 AI 设置 |
| 最终就绪聚合门 | 当前输出 APP_READY | `pnpm run write:v15-evidence-manifest -- --ad-readback output\codex-evidence\real-ad-execution-readback-candidate-rec-1.json ...` 固定本次证据选择后，`pnpm run verify:v15-final-readiness -- --evidence-manifest output\codex-evidence\v15-final-readiness-evidence-manifest-2026-06-10.json --out output\codex-evidence\final-readiness-2026-06-10.json` 汇总报表采集、Listing 读取、AI live、广告建议 AI 解释、Listing AI 草案和广告真实回读证据；六项 gate 均 passed，`status=APP_READY` |
| READY 安全门 | 通过 | `pnpm run verify:v15-ready-safety` 检查 final readiness、evidence manifest、README、最新 UI smoke 和 READY bundle manifest 口径一致。旧 `verify:v15-non-ready-safety` 只用于历史非 READY 阶段，不应作为当前 APP_READY 的最终门 |
| 交付证据包 | 已导出 READY 包 | `output\delivery-bundles\v15-delivery-bundle-2026-06-10` 已基于当前 APP_READY 文档和最新 UI smoke 重新导出，manifest 状态 `APP_READY`；导出脚本强制 final readiness 必须来自 `evidenceSelection.mode=manifest`，并使用允许路径白名单、敏感信息扫描和禁入扩展名检查，不包含 DB、浏览器 profile、原始 xlsx、exe、API Key 或密码 |
| 交付证据脚本 | 通过 | `verify:v15-canary` 已覆盖 8/8 单报表；`verify:v15-enablement` 通过；`verify:v15-delivery` 已通过并同时验证广告执行 fail-closed、DB/manifest/audit 一致性和 full-8 xlsx 指标对账 |

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
| 采集预检 | 启动采集前检查页面模型、同店铺/站点/日期范围诊断证据、截图/DOM 文件、浏览器登录状态 |
| 后台菜单与 v1.5 收尾 | 修复 `验证页面` 点击区域被相邻面板覆盖的问题；移除旧版 `daily_report_download` 定时入口；新增真实采集验收门和单报表验证入口；把原 `v1.5 工作台` 拆为按业务域分组的后台菜单：`广告运营` 下放 `广告报表/优化建议`，`关键词与 Listing` 下放 `关键词机会/Listing 优化`，`交付与系统` 下放 `交付验收/定时任务/设置`；`广告报表` 和 `优化建议` 已增加同一已验证 full-8 范围预设，减少跨页重复手填范围 |
| 关键词导入 | Search Term/SQP/keyword report 映射、诊断、重复导入策略、错误行导出 |
| 关键词机会 | ASIN + normalized keyword 聚合、评分、风险过滤 |
| Listing 分析 | 手工/Excel 导入、覆盖分析、建议生成、接受/忽略、AI/规则草稿 |
| 导出 | CSV/XLSX/Markdown、验收审计、预检证据包、诊断证据包 |
| SQLite | v1.5 批次、文件、关键词、Listing、诊断、草稿等表已补齐 |
| 桌面 UI/API | IPC、preload、v1.5 分区后台界面已接入；打包依赖包含 `better-sqlite3` native loader 所需运行时依赖 |

## 真实浏览器验证结论

| 项目 | 当前证据 | 结论 |
|---|---|---|
| ERP 登录入口 | `https://erp.lingxing.com/` 真实登录页字段为 `input[name="account"]`、`input[name="pwd"]`、`button.loginBtn` | 旧的 `www.lingxing.com/login` 和 `username/password` selector 不可用 |
| Ads 系统入口 | ERP 顶部“广告”进入 `https://ads.lingxing.com/home`，页面显示“领星广告系统” | ERP 登录和 Ads 会话必须分别校验；桌面登录流程现在先进入 ERP，再从 ERP 广告入口进入 Ads，不再先直连 Ads URL |
| Ads 下载中心真实 URL | `https://ads.lingxing.com/ak_download/download_center/download_report_log/index`，标题“下载中心” | 已固化为内置 page model 的首选候选 URL |
| 下载中心已读证据 | 页面存在“创建报告”“搜索店铺”“报告类型”“生成成功”“下载”，下载链接类名 `.JS-download-report` | 已通过只读诊断和真实 create/ready/download canary/full-8 复验 |
| 创建报告页面 | `create_report` 页面存在店铺选择、报告名称、报告类型、开始/结束日期、每日明细、全部指标、生成报告按钮 | 已通过安装版真实生成/下载链路验证 |
| 下载中心 action selectors | 内置 `actionSelectors` 已验证，`requiresManualVerification: false` | 8/8 单报表 canary、启用后诊断、full-8 E2E 均通过 |
| 真实 8 报表 E2E | `output/codex-evidence/desktop-live-full-8-e2e-2026-06-09.json` | 已完成，批次 `batch_20260609045655853_ft8uda`，8 downloaded / 0 failed |
| Listing 列表页只读读取 | `output/codex-evidence/source-listing-read-2026-06-09-candidates.json` | 源代码版通过同一登录态只读打开 ERP Listing 列表页，提取 ASIN/title 并保存截图；该页面不暴露五点描述和后台搜索词，只作为 partial 证据 |
| Listing 详情页只读读取 | `output/codex-evidence/source-listing-read-detail-probe-2026-06-09-merged-detail.json` | 源代码版从列表页同 ASIN 行只读点击 `编辑在线商品`，进入 `https://erp.lingxing.com/erp/editListing`，读取标题、10 条五点、后台词并通过 `verify:listing-read` |
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
| `output/codex-evidence/v15-delivery-gate-ui-smoke.png` | 早期 v1.5 报表采集首屏显示真实采集验收门和 8 类单报表验证入口 |
| `output/codex-evidence/v15-workbench-operator-ui-smoke-2026-06-08.png` | 早期 v1.5 报表采集运营化首屏 smoke；确认下一步提示、单报表 0/8 进度、诊断折叠入口可见，默认不显示 selector 表，控制台无错误 |
| `output/codex-evidence/packaged-smoke.out.log` | 打包应用启动到 `sqlite-ready`、`ipc-ready`、`window-created`，并对历史 AppData DB 执行 store/site 列迁移 |
| `output/codex-evidence/desktop-live-scope-diagnostic-2026-06-08T02-47-44-379Z.json` | 当前打包版通过 Electron IPC 生成诊断 id `5`，同日期、店铺、站点范围诊断通过；预检仍被 `requiresManualVerification` 阻止 |
| `output/codex-evidence/installed-login-diagnostic-preflight-2026-06-08T06-16Z.json` | 当前安装版完成 ERP -> Ads 会话确认，导出诊断 id `8` 和同范围预检包；预检只被 `requiresManualVerification: true` 阻止 |
| `output/codex-evidence/installed-canary-campaign-2026-06-08T06-38Z.json` | 当前安装版在 `2026-05-01` ~ `2026-05-25` / `FT-US-US` / `US` 范围完成 `campaign` 单报表真实生成/下载；DB、manifest、文件系统、文件名日期 token 和文件大小一致 |
| `output/codex-evidence/installed-live-diagnostic-enabled-model-2026-06-09.json` | 启用后的 page model 诊断 id `26` 通过；`requiresManualVerification: false`，preflight 三项全部 passed |
| `output/codex-evidence/desktop-live-full-8-e2e-2026-06-09.json` | 安装版 full-8 E2E 通过；批次 `batch_20260609045655853_ft8uda`，8 个 `.xlsx` 均 downloaded，0 failed，acceptance audit passed |
| `output/codex-evidence/v15-product-readiness-ui-smoke-1781072779324.json` | 当前产品状态 smoke；确认左侧菜单按 `运营总览/广告运营/关键词与 Listing/交付与系统` 分组，旧 `v1.5 工作台` 不再出现；`交付验收` 页显示 `APP_READY`、真实 readback 已通过和 manifest 聚合；`优化建议` 页显示已验证 readback 样例、通用执行合同、动态 target/source 录入、本地预检、Readback 操作手册复制按钮和 no console error |
| `output/codex-evidence/v15-delivery-ui-smoke-1781072776206.png` | 当前 renderer build 的 `交付验收` 截图；显示“交付状态：APP_READY 证据已闭环”、六项 gate、广告 readback 已通过、最终发布前刷新 READY 包和安装包 |
| `output/codex-evidence/v15-reports-ui-smoke-1781068095973.png` | 当前 `广告报表` 页面截图；显示当前范围、已验证 full-8 范围预设、下一步、页面诊断、单报表覆盖、完整采集和验收审计门 |
| `output/codex-evidence/v15-recommendations-ad-readback-ui-smoke-1781072777685.png` | 当前 `优化建议` 页面截图；显示已验证 full-8 范围预设、建议生成、广告执行 readback PASS 样例、`通用执行合同`、动态目标字段（店铺/站点/广告组合/campaign/ad group/对象/action）、建议来源字段、before/after/readback 证据录入和导出 |
| `output/codex-evidence/v15-keywords-ui-smoke-1781068097252.png` | 当前 `关键词机会` 页面截图；显示导入源、重复文件策略、机会总数、高机会、风险和可用于 Listing 汇总 |
| `output/codex-evidence/v15-listing-ui-smoke-1781068097546.png` | 当前 `Listing 优化` 页面截图；显示 `读取 Listing -> 生成建议 -> 采纳建议 -> 生成草案 -> 导出交付` 流程条、指定 Lingxing URL 输入、`打开 URL 并读取`、`从当前领星页面读取`、`只读探测详情页` 和本地 Listing 表单 |
| `output/codex-evidence/v15-settings-ai-ui-smoke-1781068098108.png` | 当前 `设置` 页 AI 配置截图；显示 `保存真实 Key -> 测试 AI 连接 -> 生成广告 AI 解释 -> 生成 Listing AI 草案 -> 刷新最终验收` 证据流、`复制 AI 验收命令`、`verify:ad-ai-explanation` 和 `$env:DEEPSEEK_API_KEY="<your-deepseek-key>"` 安全模板 |
| `output/codex-evidence/v15-listing-read-ui-smoke-1780991635633.png` | Listing 面板截图；后台界面可见指定 Lingxing URL 输入、`打开 URL 并读取`、`从当前领星页面读取`、`只读探测详情页`、本地 Listing 表单和读取证据区 |
| `output/codex-evidence/source-listing-read-detail-probe-2026-06-09-merged-detail.json` | Listing 详情页真实只读证据；`fullContentReady=true`，同 ASIN 校验通过，10 条五点和后台词均读取成功 |
| `C:\Users\wz\AppData\Roaming\@amazon-ai-ops\desktop\storage\exports\lingxing_acceptance_audit_batch_20260608063734381_rhuubk_1780900813665` | 同批次验收审计包；单报表检查通过，但总状态 `incomplete`，因为只下载 1/8 报表 |

因此，当前已证明下载中心真实页面位于 Ads 系统，而不是旧的 ERP/官网候选 URL；也已证明创建报告页的店铺、报告名称、报告类型、日期、每日明细、生成按钮、ready row、download link 在真实安装版中可完成 8 类报表生成和下载。报表采集链路、Listing 详情只读读取链路和真实 AI 证据链已可交付；仍需补齐广告写执行真实 readback。

## 广告数据口径

当前 full-8 采集证明的是下载和审计链路，不代表 8 张报表可以直接相加。`output/codex-evidence/full8-data-reconciliation-2026-06-09.json` 对 `2026-05-01` ~ `2026-05-25` / `FT-US-US` / `US` 的已下载文件做内容对账：

| 口径 | 花费 | 订单 | 销售额 | 说明 |
|---|---:|---:|---:|---|
| `user_search_term` | `145.20` | `5` | `324.95` | Listing/搜索词机会的优先事实口径 |
| `keyword` | `25.38` | `1` | `49.99` | 手动关键词调价/否词建议口径，不代表全部真实搜索需求 |
| `auto_targeting` | `119.82` | `4` | `274.96` | 自动投放 target 诊断口径 |
| `product_targeting` | `0.00` | `0` | `0.00` | 商品投放 target 诊断口径 |

不要把 `campaign`、`ad_group`、`placement`、`advertised_product`、`user_search_term` 直接相加；它们是同一批广告事实的不同维度展开。当前证据也不支持“约 3 单 / 170+ USD 花费”的预期，除非另有 ASIN、活动或投放条件过滤证据。

## 下一个 AI 接手步骤

| 顺序 | 任务 | 验收条件 |
|---:|---|---|
| 1 | 确认 Git 状态 | `git status --short --branch` 显示 `master...origin/master`，并确认最新收尾提交已推送到 `origin/master` |
| 2 | 确认不要提交运行产物 | `output/`、`storage/` 是本地证据和浏览器 profile，已加入 `.gitignore` |
| 3 | 用真实浏览器登录领星 | 使用项目浏览器架构或桌面应用保持同一 `storage/browser-data` profile，并同时确认 Ads 系统会话 |
| 4 | 复核下载中心诊断证据 | 已有 IPC 诊断 id `4` 和 UI 布局点击证据；真实 Lingxing 会话稳定后，从桌面 UI 再点击 `验证页面` 刷新当前构建的同模型、同日期、同店铺、同站点证据 |
| 5 | 导出诊断证据包 | 使用 `导出证据包`，保存截图、DOM、selector candidates、action selector checks |
| 6 | 复核页面模型 | 已完成；`resources/page-models/lingxing-download-center.json` 和当前 AppData override 均为 `requiresManualVerification: false` |
| 7 | 启用前审计 | 已完成；`pnpm run verify:v15-enablement -- output\codex-evidence\installed-canary-auto_targeting-short-name-2026-06-09.json` 通过 |
| 8 | 单报表 canary | 已完成 8/8；所有 report type 均通过 `verify:v15-canary` |
| 9 | 真实采集 E2E | 已完成；full-8 批次 `batch_20260609045655853_ft8uda`，8 downloaded / 0 failed |
| 10 | 导出最终验收审计 | 已完成；`verify:v15-delivery` 通过，acceptance audit status passed |

## 常用命令

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @amazon-ai-ops/desktop run build:win
pnpm run run:v15-installed-live -- --mode diagnostic --login
pnpm run verify:v15-diagnostic -- output\codex-evidence\<installed-live-diagnostic-file>.json
pnpm run run:v15-installed-live -- --mode canary --report-type keyword --login
pnpm run verify:v15-canary -- output\codex-evidence\installed-canary-campaign-2026-06-08T06-38Z.json
pnpm run verify:v15-enablement
pnpm run run:v15-installed-live -- --mode full8 --login --invoke-timeout-ms 900000
pnpm run verify:ad-execution
pnpm run create:ad-readback-template -- --out output\codex-evidence\real-ad-execution-readback-manual.json --md-out output\codex-evidence\real-ad-execution-readback-manual.md
pnpm run create:ad-readback-candidate -- --source output\codex-evidence\installed-ad-ai-explanation-user-key-2026-06-10.json --recommendation-id 1 --source-entity-type search_term --source-current-value 2.40 --source-recommended-value 2.16 --out output\codex-evidence\real-ad-execution-readback-candidate-rec-1.json --md-out output\codex-evidence\real-ad-execution-readback-candidate-rec-1.md
pnpm run verify:ad-readback -- output\codex-evidence\<real-ad-readback-file>.json
pnpm run run:v15-installed-live -- --mode ad-ai-explanation --out output\codex-evidence\installed-ad-ai-explanation-manual.json
pnpm run verify:ad-ai-explanation -- output\codex-evidence\installed-ad-ai-explanation-manual.json
pnpm run verify:listing-draft-ux
pnpm run run:ai-structural-mock
pnpm run verify:ai-structural-mock -- output\codex-evidence\<structural-ai-openai-compatible-mock-file>.json
pnpm run run:v15-installed-live -- --mode listing-ai-draft --source-app
pnpm run verify:listing-ai-draft -- output\codex-evidence\<listing-ai-draft-file>.json
pnpm run verify:ai-settings-ux
pnpm run smoke:listing-draft-renderer
pnpm run write:v15-evidence-manifest -- --ad-readback output\codex-evidence\real-ad-execution-readback-candidate-rec-1.json --out output\codex-evidence\v15-final-readiness-evidence-manifest-2026-06-10.json
pnpm run verify:v15-delivery
pnpm run verify:v15-final-readiness -- --evidence-manifest output\codex-evidence\v15-final-readiness-evidence-manifest-2026-06-10.json --out output\codex-evidence\final-readiness-2026-06-10.json
pnpm run verify:v15-ready-safety
pnpm run export:v15-delivery-bundle -- --final-readiness output\codex-evidence\final-readiness-2026-06-10.json --out output\delivery-bundles\v15-delivery-bundle-2026-06-10
```

`run:v15-installed-live` 支持安装版只读诊断、显式指定的单报表 canary，以及 `--mode full8` 的完整 8 报表采集；三种模式都不会执行广告写操作。登录账号和密码必须通过环境变量 `LINGXING_USERNAME` / `LINGXING_PASSWORD` 提供，仓库不保存凭据。

## 关键文档

| 文档 | 用途 |
|---|---|
| `docs/amazon_ai_ops_desktop_prd_arch_dev_spec_v1_5_no_external.md` | v1.5 PRD/架构/开发规格 |
| `docs/MISSING_MODULES_MATRIX.md` | 缺失模块矩阵 |
| `docs/V1_5_PROGRESS_REPORT.md` | 当前进度和最新增量 |
| `docs/V1_5_ACCEPTANCE_MATRIX.md` | 需求验收矩阵 |
| `docs/USER_GUIDE_v1_5.md` | 用户操作指南 |

## 交付边界

当前报表采集交付边界是“真实 Ads 下载中心定位完成 + 启用后 page model 诊断通过 + 8/8 canary 通过 + full-8 真实下载 + manifest/DB/文件/验收审计一致”；Listing 读取边界是“真实 ERP Listing 列表页进入同 ASIN 编辑页 + 标题/五点/后台词完整读取 + verifier 通过”；AI 边界是“DeepSeek live、广告建议 AI 解释、Listing AI 草案三份证据均通过 verifier 且不泄露密钥”；广告执行边界是“每个低风险人工 Ads UI 动作都有独立 approval、before、after、reload readback 和 `verify:ad-readback` PASS”。最终聚合必须先 `write:v15-evidence-manifest` 固定证据选择，再运行 `verify:v15-final-readiness -- --evidence-manifest <manifest>`；只有输出包含 `evidenceSelection.mode=manifest` 的 final readiness JSON 才能用于交付包。应用内批量广告写入仍 fail-closed；当前最终节点已完成全量测试、全量 typecheck、Windows 打包、安装包 hash、packaged smoke 和 READY 交付包导出。
