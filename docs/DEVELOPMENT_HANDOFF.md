# 开发交接与继续执行

<!-- 本轮推进状态开始 -->
## 2026-10-31 · 完整C2失败后的修复与重跑准备

版本1.6.1-dev.1，已推送的最近代码检查点为3473735f6937b24ef4dadf562c4ac83c51909b5c；保持APP_NEEDS_WORK / INTERNAL NON_READY。完整C2真实controller退出1，L1失败后链路停止，L2/原28文件L3未执行；source/frozen前后无漂移，退出后8项保护文件字节/七stat全部未变，未运行新Windows构建或正式应用。

C2原件：`output/v16-evidence/development-candidate-2026-10-31-84d42a05-fdf2-4c2e-a2ef-b47025908631`。686文件、9,118断言，按实际assertion重算为8,641通过/264失败/213未执行；原runner头把未执行项计入passed，生产汇总已正确拒绝RUNNER_COUNT_MISMATCH，未给予213项通过信用。真实FAILED收据及原退出位于`output/development-advance-2026-10-31-dae6edf0-3bbe-425c-861a-6ce1a9b6df93/repaired-full-c-terminal.json`，不改写为成功。

失败已分类：226断言及213个beforeAll未执行项涉及44文件的浏览器缓存路径；本轮执行环境遗漏PLAYWRIGHT_BROWSERS_PATH。现有F:/Temp/amazon-ai-ops-build-cache/playwright的revision1223与锁定Playwright1.60.0匹配，实际headless版本148.0.7778.96启动/正常关闭通过，原2文件9项复验通过；不下载/重装依赖、不跳过原断言。其余38项是第五关闭屏障及current/future/legacy schema夹具契约：settings原5项已复验通过，3个旧库测试文件已对全部65项真实迁移/备份/恢复目标复验通过，原37项失败闭合，生产迁移和安全门不改。44浏览器文件已实际复验467通过/1失败/0跳过（CLI1）；唯一失败为v16-ui-software-capture真实Shell路由进入OperationScopePage的30s测试超时；单case诊断13.7s未复现，已证首个it混入冷编译但不把它称为唯一根因。同一个memoized scopeBundle改在对应suite setup完成，setup/it/生产验证各自仍30s，原全部it callback/断言/时限逐字节保持；完整文件60/60通过。完整44统一复验已实际CLI1：462通过/0断言失败/6未执行；store-scope-switcher-actions的独立编译beforeAll30s超时导致6例未执行，原导航文件60项本轮全部通过。此新RED不转绿；该6例原样独跑6/6、CLI0、墙钟29.577s，源码/原hook与it30s预算均不变，未复现且不猜原根因。不再第三遍44，不以局部结果冒充44或全C；现进入文档/全局检查、提交冻结，再由新完整686文件C3提供统一终态。

下一候选预定`output/v16-evidence/development-candidate-2026-10-31-cb9743f9-9a8d-4618-a50d-97b87492445a`，当前未启动。L1按单个隔离fork逐文件执行，JSON仅整轮结束时落盘，生产器未定义整轮总时限；不以日志活动估算完成比例。新完整C必须同时带入已验证F浏览器缓存、Node22/PSModulePath清理及既有隔离环境。唯一L1仍686文件、L3仍28文件，172MUST和原安全门均不放宽。

先前统一资源/异步导入、夹具23项、包体留存46项、193安全项均只保留各自定向信用，不冒充当前全C或实包通过。后续仍需隔离迁移恢复、当前canonical Windows包与四runtime、22入口×四视图/真实NVDA、典型最大软件性能/故障/安全，以及任何正式DB读取前的最终文件S与字节备份。当前迁移/四runtime的347-C2工具仅为准备原件且真实C2门拒绝；下一轮必须新目录重新绑定，不得改旧报告。正式库版本和ACTIVE链状态仍UNKNOWN，未以SQLite打开查询。

总入口：`output/development-advance-2026-10-31-dae6edf0-3bbe-425c-861a-6ce1a9b6df93`；失败分类v2、浏览器44文件清单、保护复核及各RED原件均在其中或其引用目录保留。
<!-- 本轮推进状态结束 -->

## 2026-10-30 · 1.6.1-dev.1 开发快照

本次统一来源与决策安全、原生 ASIN 部分日观察、产品族桌面会话确认等开发增量；不纳入另行隔离的 source-first 修复补丁，相关生产隔离器及其失败夹具保持原样。产品根包、桌面包和 Main 版本同步；锁文件没有根包版本字段，工作区库仍保留各自版本。

- Linux 安全定向验证：63 文件、743 项通过；全工作区类型检查通过；全量模块边界 2242 模块、零违规。此范围不是完整测试套件，完整 172 MUST / L1–L8 未验收。
- 原生 ASIN observedLedger 仅为 partial/unverified；来源匹配不等于新文件数据全部可信、完整产品日汇总或正式 AI 权限。
- 产品族确认仅限当前桌面会话和精确文件版本，不是持久身份、所有权证明、Grant 或 Ads 执行授权。
- 浏览器/Windows/Electron、用户真实文件的应用内导入链、真实 AI 费用、Ads 动作及效果均未取得本次验收。本次统一定向回归包含 importer/repository 测试；XLSX 解压资源安全仍未确立。
- 额外包脚本文档合同检查有 2 项失败（同依赖、固定基线对照亦为相同 2 项失败），未计入上述 63 文件通过范围；不声称全套通过。
- 原始报表、数据库/Profile、密钥、私有输入、交付 ZIP 及临时验证日志不纳入提交；历史归档不改写。

状态保持 **APP_NEEDS_WORK / INTERNAL NON_READY（INTERNAL_NON_READY）**。本次只发布源码开发快照，不创建 tag、Release、部署或新 Windows 安装包。

更新日期：2026-10-30。先读 [项目状态](PROJECT_STATUS.md)、[PROGRESS](../PROGRESS.md) 和 [BLOCKED](../BLOCKED.md)。当前是 1.6.1-dev.1 开发迭代，完整内部链失败，不能进入正式发布。

## 第一个待办

完整链 `development-candidate-1793044718141` 的 20 项失败均位于 `scripts/inspect-package-ui-run-group.test.mjs`。原始 runner 为同目录 `V16-T-L1-ALL.runner.json`，日志为 `L1.log`；内部链与保护外层均为 FAILED。先对照当前生产检查器、隔离路径合同及测试夹具，确认提前返回 `PROFILE_DATABASE_NOT_ISOLATED` 的原因。

不得先改期望值、删反例或放宽隔离门以获得 GREEN。修复后先执行该测试及直接影响的路径/来源校验，再重新冻结全量工程链；旧 8506/8526 及失败原件保持原样。本次文档提交改变源码身份，旧的冻结 settings、成功计数和包绑定不能直接沿用。

## 可复现开发入口

在 Windows、仓库根目录和锁文件对应的 pnpm 环境中执行：

```powershell
pnpm install --frozen-lockfile
pnpm run prepare:native:node
pnpm exec vitest run scripts/inspect-package-ui-run-group.test.mjs
pnpm run typecheck
pnpm run check:module-boundaries:all
node scripts/generate-v16-l1-evidence.mjs --test V16-T-L1-ALL --out-dir output/v16-evidence/<new-run>
```

每次实际运行使用新目录。Node 与 Electron 的原生 ABI 不同，源码测试前准备 Node 原生模块；Windows 构建和实包检查使用对应 Electron 原生模块，不能拿其中一套覆盖另一套的验收结论。

L2/L3 的实际测试定义、caseIds 和适配入口以 `docs/v16_required_test_manifest.json`、`docs/v16_requirements_index.json` 及专用验证器为准。只记录实际执行结果；不得手写 PASSED 或将模型结果改称原生运行。

## 应用与正式数据

- 用户使用真实 Windows 应用 `apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe`；不默认打开浏览器模拟工作台。
- 开发验证仅使用显式隔离目录及标记夹具，不写入正常 userData。
- 本机已有新机初始化数据，不代表恢复历史店铺/实验；旧经营记录仍为 UNKNOWN。
- 当前保护链要求在最终快照和字节备份之前，不启动会打开正常数据库的新验收流程。使用既有迁移/备份工具，保留 DB/WAL/SHM 与 Local State 的保护边界。
- UNKNOWN 执行仅只读对账；不重复写入，不借历史授权恢复动作。

## 后续验收顺序

当前全量工程链及隔离恢复通过后，再重建正式包，执行四种包型、完整界面与原生读屏、性能、安全、最终备份和正常启动。读屏诊断的 40 节点通过不替代完整矩阵或正式 post-C 绑定。

本机 `output/development-completion-2026-10-16/` 留有未绑定的 caller/build、G3 和最终汇总工具草稿。它们保持 null/拒绝入口，不是成功结果，也不是可直接用于本次新提交的通用工具；继续前必须核对源码、当前实际报告和所有依赖身份。无这些本地产物的其他电脑仍可使用仓库内正式验证脚本重新生成证据。

## Git 与交付

用户已授权整理文档并提交、推送代码迭代。本次沿现有分支正常提交和推送，不强推、不修改历史，不发布 GitHub Release。产品 package 与 Main 版本同步为 1.6.1-dev.1，以开发预发布版本区分本次迭代；这不构成正式 Windows 二进制发布。

提交范围为源码、测试、锁文件、构建配置与项目文档。`output/`、运行数据库/Profile、原始报表、安装包、ZIP、回滚包和密钥留在本机。历史误跟踪的回滚包仅移出 Git 索引，物理文件保留。
