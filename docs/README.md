# 项目文档目录

更新日期：2026-10-27。当前版本1.6.0，交付状态APP_NEEDS_WORK / INTERNAL NON_READY。最近完整L1失败；请从现行入口读取状态，不使用历史完成率、旧READY或旧包哈希判断当前交付。

## 现行入口

| 文档 | 用途 |
| --- | --- |
| [PROJECT_STATUS](PROJECT_STATUS.md) | 当前结果、身份、内部退出与真实环境依赖 |
| [DEVELOPMENT_HANDOFF](DEVELOPMENT_HANDOFF.md) | 首个失败的复现、开发命令、数据保护与继续顺序 |
| [ARCHITECTURE](ARCHITECTURE.md) | 当前Main/Preload/Renderer、配置、日志和导航职责 |
| [MAINTAINABILITY_BASELINE](MAINTAINABILITY_BASELINE.md) | 配置/日志/模块规则、原生方法和六项内部退出合同 |
| [用户操作指南](USER_GUIDE_v1_5.md) | 当前真实应用操作，保留兼容文件名 |
| [V1_6_QUICK_REFERENCE](V1_6_QUICK_REFERENCE.md) | 开发命令速查 |
| [CHANGELOG](CHANGELOG.md) | 本次开发快照的变更与已知限制 |
| [PROGRESS](../PROGRESS.md)、[BLOCKED](../BLOCKED.md) | 已证实事实与当前未满足条件 |

## 需求与验收合同

当前产品需求来自 [V1.6 PRD](amazon_ai_ops_agent_prd_v1_6_0.md)，需求和测试机器定义分别是 `v16_requirements_index.json` 与 `v16_required_test_manifest.json`，原文及正式状态不得因为文档整理而改变。172项仍为UNVERIFIED。

- [验收矩阵](V1_6_ACCEPTANCE_MATRIX.md)、[集成测试计划](V1_6_INTEGRATION_TEST_PLAN.md)：案例和期望，不是当前执行结果。
- [原生证据协议](V16_NATIVE_EVIDENCE_PROTOCOL.md)、[验证追踪合同](v16_companion_verification_traceability.md)：schema、caseIds、来源及拒绝规则。
- [迁移兼容](v16_companion_migration_compatibility.md)、[S7恢复](S7_02_RECOVERY_RUNBOOK.md)、[Authority选择](S7_03_AUTHORITY_SELECTION.md)：数据保护与恢复边界。
- [真实回读](REAL_AD_READBACK_RUNBOOK.md)、[单店双模式](SINGLE_STORE_MAIN_FLOW.md)、[发布与真实运行](v16_companion_release_canary.md)：真实身份、授权、费用、执行和观察条件。

## 历史与设计资料

旧v1.2/v1.5规格、phase完成报告、评分、历史运行状态、plans及原型设计均保留供追溯。它们描述原阶段，不会覆盖现行状态，也不能直接执行其旧交付命令。设计原型/静态界面仍是参考，不能冒充真实应用或授权。

整理前的README、PROGRESS、BLOCKED、项目规则、速查和操作指南已按原字节保留在 [历史索引](history/2026-10-27-documentation-sync/README.md)。原始运行证据、数据库、报表、截图、语音和包体留在本机output/或受保护目录，不随Git推送。

## 全量盘点

[文档盘点表](DOCUMENT_INVENTORY.md)逐项列出本次读取和评估的Markdown文档，包括未修改项。需求原文、提示词载荷、自动设计采样、原型规则及原始请求保留原文；它们不作为当前进度报告。历史大规格保留原定位以维持需求和引用可追溯性。
