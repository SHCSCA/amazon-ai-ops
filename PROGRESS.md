# V1.6 已证实进展

更新日期：2026-10-27。交付状态 **APP_NEEDS_WORK / INTERNAL NON_READY**。状态解释见 [PROJECT_STATUS](docs/PROJECT_STATUS.md)，当前缺口见 [BLOCKED](BLOCKED.md)。

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
