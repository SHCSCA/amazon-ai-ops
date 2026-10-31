# V1.6 已证实进展

## 2026-10-30 · 1.6.1-dev.1 开发快照

本次统一来源与决策安全、原生 ASIN 部分日观察、产品族桌面会话确认等开发增量；不纳入另行隔离的 source-first 修复补丁，相关生产隔离器及其失败夹具保持原样。产品根包、桌面包和 Main 版本同步；锁文件没有根包版本字段，工作区库仍保留各自版本。

- Linux 安全定向验证：63 文件、743 项通过；全工作区类型检查通过；全量模块边界 2242 模块、零违规。此范围不是完整测试套件，完整 172 MUST / L1–L8 未验收。
- 用户私有文件的只读解析器检查 195 项通过；不覆盖应用数据库导入、UI 或 Electron，原始私有数据不提交。
- 原生 ASIN observedLedger 仅为 partial/unverified；来源匹配不等于新文件数据全部可信、完整产品日汇总或正式 AI 权限。
- 产品族确认仅限当前桌面会话和精确文件版本，不是持久身份、所有权证明、Grant 或 Ads 执行授权。
- 浏览器/Windows/Electron、用户真实文件的应用内导入链、真实 AI 费用、Ads 动作及效果均未取得本次验收。本次统一定向回归包含 importer/repository 测试；XLSX 解压资源安全仍未确立。
- 额外包脚本文档合同检查有 2 项失败（同依赖、固定基线对照亦为相同 2 项失败），未计入上述 63 文件通过范围；不声称全套通过。
- 原始报表、数据库/Profile、密钥、私有输入、交付 ZIP 及临时验证日志不纳入提交；历史归档不改写。

状态保持 **APP_NEEDS_WORK / INTERNAL NON_READY（INTERNAL_NON_READY）**。本次只发布源码开发快照，不创建 tag、Release、部署或新 Windows 安装包。

更新日期：2026-10-30。交付状态 **APP_NEEDS_WORK / INTERNAL NON_READY**。状态解释见 [PROJECT_STATUS](docs/PROJECT_STATUS.md)，当前缺口见 [BLOCKED](BLOCKED.md)。

## 2026-10-30 云端隔离候选：产品族观察桌面入口

在现有导入校验页新增主动选择文件、预览精确版本并明确确认的只读入口。Main 使用当前店铺回执和原始字节校验，绑定一次性会话 token；范围或店铺变化需重新确认。结果保留日值、差异、未知币种/归因与关键词子集边界，不新增数据库 schema 或正式权限。实现与验证细节见 [桌面观察说明](docs/FAMILY_OBSERVATION_DESKTOP.md) 及本次独立交付证据。

## 2026-10-29 云端隔离候选：部分产品日观察

在固定基线及第三轮来源/身份补丁上新增只读 observedLedger。它核对同一店铺、已完成批次、导入运行、文件快照、全批指标哈希及原始导入指纹；仅累计 advertised_product 的原生 ASIN 行，保留精确文件行号。字段缺失或任一原生行缺少有效单元格时该字段为未知，缺日不补零。

迁移 22 为新导入保存可空数值来源位图；历史 NULL 不回填。解析器同时检查原始数值单位、Excel 格式和物理行号。观察值可传入两条诊断路径，始终 partial/unverified；完整产品汇总仍 unavailable，正式 AI/Ads 资格不变。

该段记录当时的云端 Linux 隔离开发候选；本次源码快照纳入该增量，不代表 Windows 验收或正式发布。匹配候选的最终命令、测试数及哈希以独立交付 evidence 为准，不继承旧完整链信用。

## 最近完整内部链：FAILED

- 候选：`output/v16-evidence/development-candidate-1793044718141`。
- 北京时间 2026-10-27 04:08:21 开始；L1 于 04:50:27 退出 1，内部链于 04:50:30 结束。
- 原生 Node 依赖准备与全量模块边界检查通过。
- L1 实际 652 文件、8526 项，8506 通过、20 失败、0 pending、0 todo；全部失败集中在 `scripts/inspect-package-ui-run-group.test.mjs`。
- 多项断言提前返回 `PROFILE_DATABASE_NOT_ISOLATED`；原因尚待对照实现和夹具定位，不预先定性为纯测试错误。
- L2、L3、diagnostic-reconciliation 和三项最终 verify 未执行；保护外层 FAILED，并保留子进程 exit/close=1。旧会话查询已不可用，不补写根会话 CLI 终态。
- `internal-run.json` SHA-256：`433c005eb89a4c27184eb905cf5d43d39087eb88782959278f4df3f52bde937a`。

## 已测源码范围内的通过结果

下列结果来自文档整理前的 source `0185ae4e0a7cc8b36b71e0523eae6857830db456df1d733f9446c203b4b1c32a`、full `701f9b589b159a698a190e3f372d9431d22eaed106a914c87d57c6e8cd9089b2`，Git 基线 `e0a00c4`、产品版本 1.6.0。后续提交和文档改变身份后须重新冻结，不能自动继承。

| 范围 | 实际结果 | 本机原件（相对 output/development-completion-2026-10-16） |
| --- | --- | --- |
| 定向回归 | 11 文件、422/422 | `root/r268-current-stat-contract-regression-c35fd286-dec9-41e7-bbdc-7b99bd35e9aa/TEST-INVOCATION.json` |
| 类型检查 | 通过 | `root/r269-current-stat-contract-typecheck-4c63c2ce-decf-4b7e-9296-599eebe5dc24/REPORT.json` |
| 模块尺寸 | 2201 模块、零违规 | 六目标实际应用报告及当前完整链的 `module-boundaries.log` |
| 七步诊断构建 | 通过、无正式交付信用 | `root/r246-current-diagnostic-build-draft-c4a3c38d-23a0-45d7-b8d9-b160f48e83fc/build-6a72e67f-7723-464f-b898-fbbae6faeeb6/report.json` |
| 当前诊断包静态安全 | 11/11 | `root/r282-0185-package-static-security-5f6a9c3c-1195-4e94-aa2d-5552c5b5cd89/security.json` |
| 双档真实读屏独立复核 | 通过 | `independent/r412-actual-0185-native-postreview-c734b877-f806-488a-8af4-dec9390490e8/v2-REVIEW.json` |

## 读屏与原生几何修复

真实 Windows EXE 的 100%/125% 两档各覆盖十类原语、20 节点，共 40 节点、40 frames；每档 19 个自动焦点公告加 1 个真实 NVDA ReportFocus。DOM/3、geometry/2、工具四字段/七 stat、PNG 与真实可见范围校验通过，NVDA/Main/launcher 首次正常退出。原 stat 合同不一致卡点已由真实双档复验关闭。

原件为 `output/r401g-6801f188-ccc9-4302-8c29-d6b3f93da78f/REPORT.json`，SHA-256 `c0538e624da85ec8f7e7d4c978550f96be9952747cc9720b9961015db04b42b3`。这只是隔离诊断范围，不替代正式 post-C 读屏、完整界面矩阵、性能、安全总审或 APP_READY。

## 本次文档与代码快照

统一当前状态、后续计划、架构导航和操作入口；文档整理前八份入口/规则原件已按字节完整归档。历史记录中的失败、旧包身份和当时结论保留，见 [归档索引](docs/history/2026-10-27-documentation-sync/README.md)。本次不伪造通过、不发布生产包，172 项正式 MUST 仍为 UNVERIFIED，六项内部退出条件未全闭。
