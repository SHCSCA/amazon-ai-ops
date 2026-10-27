# Amazon AI Ops Agent · 项目规则

<!-- CCG-FAST-CONTEXT-START -->
# fast-context MCP 工具使用指南（辅助模式）

## 核心原则

**主检索工具为 ace-tool（`mcp__ace-tool__search_context`）。当 ace-tool 无法满足语义搜索需求时，使用 `mcp__fast-context__fast_context_search` 作为补充。**

适合使用 fast-context 的场景：
- 用自然语言描述要找的逻辑（如"部署流程"、"事件处理"）
- 跨模块、跨层级的调用链路追踪
- 中文语义搜索（工具支持中英文双语查询）
<!-- CCG-FAST-CONTEXT-END -->

## 范围与工作方式

- 本项目是 Windows-only、本地优先的 Electron 应用，不默认扩展移动端。
- 保留现有工作树、正式数据、运行状态及全部失败证据；不得自行回滚、删除、重写历史或恢复时间戳。
- 用户目标是推进到“开发完成，仅待真实环境验收”；以治理基线六项内部退出条件和用户最新指令为准。
- 用户操作使用真实 EXE，不恢复模拟工作台为默认流程。隔离夹具必须标记，不能写入正常 userData。
- 当前状态和卡点只在 PROGRESS.md、BLOCKED.md、docs/PROJECT_STATUS.md 维护；本规则不积累测试计数或包哈希流水账。

## 不可妥协的工程约束

- 按职责拆分实现模块，禁止千行实现；执行 `pnpm run check:module-boundaries:all`，不能只用增量门。
- 遵循统一领域边界；同一事务中的批次、revision、session、Grant 核验不能因拆文件变成独立事务。
- 新增注释仅用必要、简洁的中文，解释意图与边界。
- 异常经统一边界捕获和记录，保留首错、次错及真实失败；使用统一日志格式与脱敏出口，不吞错或伪造正常退出。
- 配置经启动快照、持久化配置总线及显式端口传入，不在业务消费者重读环境或添加旁路 fallback。
- Main 是凭证和权限边界；Renderer 不接收已保存密码或密钥。

## Required Safety Boundaries

- App-side batch ad execution remains fail-closed. The UI must not claim that blocked audit output equals a real Amazon Ads write.
- Recommendation batch handoff is not batch execution. It may preselect or hint approval rows, but it must not update Ads, bypass approval blockers, or convert review-only rows into formal approvals.
- Recommendation bucket filtering is visual triage only. It should reuse `recommendationHasEvidenceBlocker`, manual-review, and formal-approval gates so the visible buckets match approval policy.
- Ad-quant metric focus filtering is visual triage only. It should use shared quant thresholds for high ACOS/no-order waste buckets and must not update recommendations, approvals, or Ads state.
- Readback time/value contract cards are operator-facing prechecks, not proof of execution by themselves. Final readiness still requires distinct screenshots, valid time order, before/after value change, readback value equality, source traceability, and `verify:ad-readback`.
- Every future Ads UI action needs its own target, source report file(s), source row, approval, before screenshot, after screenshot, reload/readback screenshot, and `verify:ad-readback` pass.
- Structural/mock AI evidence never gives final readiness credit. Real readiness requires live provider evidence and the real ad/Listings verifier chain.
- Operator-facing UI should stay concise: avoid raw `APP_*` status codes, long command walls, or dense evidence text in primary views. Put technical details behind secondary panels.
- Main window text overload was a known UX problem; prefer task-first copy, compact summaries, and clear next action labels.
- AI output schemas are system-owned contracts. Settings may show contract tags and allow persona/expression tuning, but user-edited persona text must not control `schemaVersion`, fixed fields, or formal action eligibility.
- Dense readiness summaries should prefer compact tags/chips in primary views, with detailed evidence and explanations behind progressive disclosure.


## 当前验收边界

- 保持 APP_NEEDS_WORK / INTERNAL NON_READY，直到当前源码、完整172 MUST、L1–L8和包体匹配证据均满足。
- 历史 APP_READY、旧包、定向单测和内部模型不能获得当前全量或真实业务信用。
- 真实费用、候选批准、Grant、Ads执行及APP_READY不得合成。人工与策略模式各按当前有效授权执行。
- 原报告不补写、不转换为新版本证据；重跑用新目录并保留所有失败原件。
- 当前正式启动保护链要求最终快照与字节备份在打开正常数据库之前完成；不得为验收方便绕过。

## 验证与提交

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run check:module-boundaries:all
pnpm test
pnpm run verify:desktop-isolated
pnpm run build:win
```

- 命令存在不代表已经通过。按 docs/DEVELOPMENT_HANDOFF.md 生成当前实际证据。
- `output/`、`storage/`、AppData DB/Profile、原始报表、Local State、安装EXE/ZIP、回滚包及密钥不提交。
- 用户授权的代码迭代可正常提交与推送；Git快照不等于生产发布，不强推、不擅自打READY标签。
- 正式bundle须先通过对应验收，冻结匹配文档后重新导出并执行对应READY/NON_READY安全门。失败候选或文档同步提交不冒充完成该流程。

## 文档入口

- docs/README.md：全量分类目录。
- docs/ARCHITECTURE.md、docs/MAINTAINABILITY_BASELINE.md：当前职责、配置/日志及六项退出。
- docs/amazon_ai_ops_agent_prd_v1_6_0.md、docs/v16_requirements_index.json、docs/v16_required_test_manifest.json：需求和唯一测试定义。
- docs/V16_NATIVE_EVIDENCE_PROTOCOL.md、docs/v16_companion_verification_traceability.md：证据合同。
- docs/DEVELOPMENT_HANDOFF.md：继续执行与真实数据保护。
- docs/history/2026-10-27-documentation-sync/README.md：整理前规则与历史原件，仅作历史。

## 外部知识库

本机未配置原Obsidian Vault。普通任务不自动检索或写入Vault；只有用户明确要求时才定位可用路径和权限。历史Vault指令保存在归档中，不自动执行旧电脑路径。不得向知识库写入密钥、Cookie、完整原始对话或未筛选输出。Agent个人记忆仅在用户明确要求更新记忆时，通过平台允许的增量笔记流程更新。
