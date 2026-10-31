# 开发交接与继续执行

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
