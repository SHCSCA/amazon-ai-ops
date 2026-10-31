# V1.6 数据库升级与兼容规格

> 2026-10-27 文档对齐：本文定义合同、方法或验收案例，不提供当前通过结论。现行状态、失败与后续计划统一见 [项目状态](PROJECT_STATUS.md)；当前仍为 APP_NEEDS_WORK / INTERNAL NON_READY。正文中的旧检查点只适用于当时版本。

版本：1.0；状态：待真实升级验收。本文定义流程，不证明迁移已完成。执行结果只记录 PROGRESS.md / BLOCKED.md。

## 权威与范围

- 正式库通过 Main 的当前 authority selection 定位；不得用相似 C:/D: 路径、旧副本或默认新建空库替代。
- schema_migrations 是迁移账本，当前源码链为 1–22，目标版本以实际迁移导出注册表及已冻结合同为准；PRAGMA user_version 不能代替账本、校验和及 schema 检查。未知合同、checksum 冲突或不连续 applied 账本在业务 DDL 前拒绝。
- 生产业务权威继续使用 missions / decisions / mission_grants / policy_runtime / analysis_* / ad_execution_* / experiments / causal_events。analysis_runs 由 AnalysisAuthorityService 写入。
- v16_missions、decisions_v16、mission_grants_v16、execution_slots、execution_batches、causal_events_v16、policy_versions_v16 等草稿表保留为历史。不能从这些表恢复当前授权或与生产表双写。
- schema 19 从已验证的升级前快照分类历史，legacy_record_classifications 仅存不可改写的分类回执：原表/主键/行哈希、source schema、classifier revision、原因与分类时间，不成为业务权威。有效店铺配置为 validated-compatible（连接仍须重新验证）；产品/指标/分析/建议须 re-derivation-required；其余有效旧记录为 historical-read-only；缺失归属、结构/外键错误或必要 proof 缺失为 quarantined。秘密与凭证表不复制到分类账本。
- 分类不修改原始记录，不补默认 session/Profile/审批时间。旧分析记忆在历史页保留，但非 validated-compatible 的旧事件与证据不参与当前可信分析索引。旧 Grant/Decision 缺少当前完整 authority 时始终不可执行。
- schema 20 的 ai_spend_policies 保存独立、不可覆盖的美元预算版本；ai_cost_records 在付费前记录上下文/用途/报价版本与预留，再单次结算。旧 AI 输出日志不推断 usage 或零费用，也不补预算。启动恢复将未结束请求记为费用未知的中断，窗口内存在未知费用时阻断后续自动付费。

## 本轮真实报表模板

正式导入使用 `packages/report-parser/src/lingxing-template-manifest.ts`，登记来自现有 48 份哈希一致原始文件的八种表头版本 `lingxing-us-{reportType}-20260908-v1`。每个版本固定完整表头集合，列顺序不限，别名复用已有字段映射；缺列、额外未知列、重复同义列或声明类型不符均拒绝。新增模板必须显式登记，不能自动学习并放行。普通文件预览保留兼容读取，正式 Main 导入始终要求登记模板。

表头均必需；数据行的店铺和活动沿用现有必填校验，国家必须是 US，金额使用 USD。本币金额中的非美元符号或百分号拒绝。暂停且无日期、无店铺的全零占位行沿用现有过滤规则，其余指标数值和日期窗沿用原验证。领星 ACOS 文本“有花费无销售额”只在花费大于零、销售额为零时合法，ACOS 仍由原始花费/销售额计算。“关键词”和“投放”是不同字段，搜索词报表可同时存在，关键词不被投放覆盖。

manifest 声明各报表业务维度；文件 SHA-256 与原始 source row 是物理记录唯一键，名称不当作可写 Ads ID。模板版本随本轮源码/包体固定，ParseResult 返回 templateRevision 或带错误码的 templateError，Main 用现有导入错误投影展示。原始文件、行号及导入记录保留现有持久化链，不新增平行业务表。

## 升级执行

1. 记录当前源码、包体 SHA-256、正式库路径、完整 schema ledger、integrity_check / foreign_key_check、各业务表行数和逻辑摘要。
2. 使用 SQLite online backup 形成一致快照，覆盖 WAL 中已提交行；正式文件身份哈希和复制主文件均不能替代一致备份。记录源/备份路径、时间、大小、哈希、账本及逻辑摘要。
3. 在隔离副本运行完整迁移。新数据库目标已应用时不伪造备份；待升级库在任何 CREATE/ALTER/历史归一化前保存覆盖完整待迁移链的不可变恢复点。
4. 独立检查 schema、checksum、触发器、外键、历史行保留与允许变化；再次启动验证幂等，分别注入迁移前、事务中和证据发布前中断后恢复。
5. 验证旧候选拒写当前数据库、未来 ledger 在写入前拒绝、checksum 冲突与缺表不被 already-applied 跳过。
6. 软件候选冻结后，关闭正式库相关写进程，重新获取当前身份及 WAL-safe 备份，通过已有独占迁移操作器升级正式库，完成前后核验后方可导入/分析/执行。

## 恢复与兼容

- restoreMigrationBackupTo 仅恢复到不存在的新路径并重新校验，绝不静默覆盖运行中的正式库。
- Windows 隔离启动或恢复本机加密历史时，还须在第一次启动前带上同一用户原 userData 的 `Local State`。单独复制 DB 会使新 profile 生成不同 OSCrypt 密钥，旧历史解密失败；不得因此清空历史或放宽安全门。该文件只在本机受控恢复目录保存，不提交源码或公开交付包。本轮副本已据此完成实际启动和安全退出。
- 已有新版本写入时保留当前库及其备份。回滚须明确比较新增/变更记录，禁止用旧备份覆盖丢失当前工作；不能证明兼容时保持只读历史和明确恢复说明。
- UNKNOWN 原任务和授权不可重试或复活，恢复后只读对账；观察到目标值也不能自动形成已验证效果。
- 外键/完整性错误、备份不可复核、并发写入、账本/schema 漂移均终止迁移，保留失败记录与副本。

## 验收证据

隔离库 L1/L3：db、legacy-upgrade、0014/0015/0016、upgrade-backup、store-repo 及离线/独占迁移脚本回归。L6：正式库一致备份、独占升级、前后摘要、恢复演练、旧包拒写及两店独立历史。任何测试替身都不计正式库验收。

## Companion 责任索引

版本：`v16.companion-responsibilities/1`。本表只定位唯一合同与实施入口，不复制业务 schema、审批状态或验收结果；需求及 AC 仍以 PRD 和需求索引为准。

| 责任 | 唯一规格 | 实施入口 |
|---|---|---|
| schema | docs/v16_companion_migration_compatibility.md | packages/local-db/src/sqlite/db.ts |
| template | docs/v16_companion_migration_compatibility.md | packages/report-parser/src/lingxing-template-manifest.ts |
| projection | docs/v16_companion_migration_compatibility.md | packages/shared-types/src/mission-domain.ts |
| evidence | docs/v16_companion_release_canary.md | scripts/mission-control-production-canary-artifacts.js |
| test | docs/v16_companion_verification_traceability.md | docs/v16_required_test_manifest.json |
| release | docs/v16_companion_release_canary.md | scripts/v16-publication-closure.js |

本表由 `scripts/v16-companion-responsibilities.js` 只读核对唯一责任、三份规格、实施入口、PRD/需求/测试清单的实际存在和链接；该检查不授予现场验收信用。projection 的版本、scope 与 opaque evidence 合同由共享类型和 Main 服务执行，不在规格内维护第二份 DTO。evidence 的三段回读以不可变事件与原件为事实源，release 只消费经过校验的产物。
