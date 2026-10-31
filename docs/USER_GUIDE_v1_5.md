# Amazon AI Ops 用户操作指南

更新日期：2026-10-31。此兼容路径保留原文件名，内容适用于当前1.6.1-dev.1开发快照。当前未完成生产验收，完整状态见 [PROJECT_STATUS](PROJECT_STATUS.md)。

## 打开应用

使用真实Windows应用 `apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe`，不默认打开模拟工作台。安装EXE和ZIP由构建产生，不随源码提交。新电脑初始化的数据、Local State和备份不代表恢复旧店铺或历史实验。

正式数据库升级或验收启动前，先完成适用的快照、WAL安全备份和恢复检查；不要直接复制仍在写入的单个DB文件覆盖正式库。当前受保护验收流程的启动次序见 [开发交接](DEVELOPMENT_HANDOFF.md)。

## 六个业务模块

| 模块 | 主要操作 |
| --- | --- |
| 今日任务 | 查看今日总览、准备度、阻断与运营事件 |
| 运营资产 | 维护产品目标、广告对象、关键词、Listing本地版本，采集和校验八类报表 |
| 决策中心 | 查看任务事实、分析建议、人工审批与已处理决定 |
| 执行与实验 | 复核授权、执行前条件、实时执行、结果核对和经营实验 |
| 经营记忆 | 搜索当前店铺因果时间线及证据来源 |
| 系统设置 | 配置店铺/连接、AI、策略与风控、定时任务和交付验收 |

当前为六模块、十个内部workspace、22个入口，实际页面以代码注册表为准。旧文档里的十工作区是内部层级，不是另一套当前一级菜单。

## 店铺与连接

先维护并显式切换到目标店铺，再进行本店业务。连接ERP/Ads使用该店铺独立的可见浏览器Profile；登录、验证码/MFA及身份确认按实际页面完成。创建本地店铺或看见已登录页面，不等于广告账户授权已经生效。

凭证由Main安全存储边界处理；已保存密码不回传Renderer，不写入日志。当前账户、店铺、Profile或会话变化时须重新核实，不能凭历史连接结果继续执行。

## 采集、分析与审批

1. 为当前店铺和美国业务日期范围采集真实八类报表，核对下载、文件、导入和指标一致性。
2. 维护产品目标与成本，确认报表及对象来源，再生成分析和建议。不同统计粒度不混加。
3. 人工模式在产品内批准具体完整候选；策略自动模式使用当前已启用且有效的策略授权。
4. AI调用前确认真实连接与明确费用预算。测试夹具或结构化mock不提供真实调用和费用信用。

## 执行和回读

每个动作都须绑定当前店铺、唯一目标、数据来源、会话/版本与有效Grant，并通过执行前检查。批准不等于已执行；一次提交后还须独立before/after/reload回读。真实动作操作要求见 [回读手册](REAL_AD_READBACK_RUNBOOK.md)。

结果为UNKNOWN时停止写入，只读核对同一对象；不重复提交、不恢复旧授权、不把未知结果记为效果。界面卡片或绿色预检查本身不是执行证据。

## 实验与本地草案

实验按已完成美国业务日观察，形成系统结论与因果记忆；缺日期、数据或真实执行时不补造。完整发布仍要求两家US店铺的独立观察与双模式验收。Listing草案仅本地保存、比较和导出，不自动提交Amazon或领星。

## 当前限制与恢复

完整内部L1仍有20项失败，正式四包、完整界面、性能、安全和恢复验收未全部闭合。当前不能称可生产交付；后续计划见 [BLOCKED](../BLOCKED.md)。迁移与恢复按 [S7恢复手册](S7_02_RECOVERY_RUNBOOK.md) 和 [迁移兼容合同](v16_companion_migration_compatibility.md) 执行。

旧v1.5指南与包型历史完整保存在本次文档归档中，旧APP_READY、包哈希和动态验证禁令不再作为当前状态。

## 维护附录：证据命令与历史兼容分支

本节供维护人员使用，命令中的占位符必须替换为当前真实、匹配的输入；不是运营用户首屏流程，也不授权广告写入。当前版本与状态以 PROJECT_STATUS 为准。正式数据库保护、最终快照及字节备份仍须在适用操作之前完成。

### 稳定对象身份与独立回读

创建回读模板时需明确可写 Ads 对象的稳定 ID 和证明文件，不能用同名活动、搜索词行或报告建议值代替：

```powershell
pnpm run create:ad-readback-template -- --out <new-readback-template.json> --md-out <new-readback-checklist.md> --entity-id "<opaque Ads UI/API writable object id>" --identity-proof "C:\path\to\target-identity-proof.json" --source-files <real-report.xlsx> --source-row <positive-source-row>
```

模板须将 ID 绑定到 `target.entityId`，证明路径绑定到 `target.identityProofPath`；证明文件须存在且确证同一可写对象。模板生成不构成批准、执行或通过证据，独立刷新后的真实读数必须与执行后值匹配。后续真实批准、before/after/reload 截图、严格时间和值校验仍须全部完成。详细流程见 [回读手册](REAL_AD_READBACK_RUNBOOK.md)。

### Release order

生产交付顺序固定为：先以当前源码构建和采集匹配证据，再运行最终验收，冻结状态与文档，然后只选择一个匹配分支导出并执行对应安全门。以下展示仍保留的 V1.5 兼容工具；该分支通过不能替代当前 V1.6 全部 MUST 与 L1–L8 验收，也不能把旧包或历史报告变成当前信用。

```powershell
pnpm --filter @amazon-ai-ops/desktop run build:win
pnpm run smoke:package-launch
pnpm run verify:v15-final-readiness -- --evidence-manifest <current-evidence-manifest.json> --package-launch-smoke <current-package-launch-smoke.json> --db <authority-db> --out <current-final-readiness.json>
```

如果最终验收为 `APP_NEEDS_WORK`，README 顶部 DELIVERY 行必须保持非 READY。冻结匹配文档后导出新 NON_READY bundle，并执行对应安全门：

```powershell
pnpm run export:v15-delivery-bundle -- --final-readiness <current-final-readiness.json> --package-ui-manifest <current-package-ui-manifest.json> --package-security-evidence <current-package-security-evidence.json> --package-adversarial-node-env-evidence <current-package-adversarial-evidence.json> --workspace-ui-manifest <current-workspace-ui-manifest.json> --business-ui-smoke <current-business-ui-smoke.json> --full-test-evidence <current-full-test.json> --data-reconciliation <current-reconciliation.json> --data-reconciliation-md <current-reconciliation.md> --release-dir apps/desktop/release --readme README.md --db <authority-db> --skip-latest-extras true --out <new-non-ready-bundle>
pnpm run verify:v15-non-ready-safety -- --final-readiness <current-final-readiness.json> --package-launch-smoke <current-package-launch-smoke.json> --package-ui-manifest <current-package-ui-manifest.json> --package-security-evidence <current-package-security-evidence.json> --package-adversarial-node-env-evidence <current-package-adversarial-evidence.json> --bundle-manifest <new-non-ready-bundle>/delivery-bundle-manifest.json --readme README.md --db <authority-db>
```

只有最终验收为 `APP_READY` 时，README 顶部 DELIVERY 行才切到 `APP_READY`；这里同时要求当前 V1.6 全部必要条件通过，旧版 final-readiness 单独通过不充分。状态与文档冻结后导出新 READY bundle，再执行 READY 安全门：

```powershell
pnpm run export:v15-delivery-bundle -- --final-readiness <current-ready-final-readiness.json> --package-ui-manifest <current-package-ui-manifest.json> --package-security-evidence <current-package-security-evidence.json> --package-adversarial-node-env-evidence <current-package-adversarial-evidence.json> --workspace-ui-manifest <current-workspace-ui-manifest.json> --business-ui-smoke <current-business-ui-smoke.json> --full-test-evidence <current-full-test.json> --data-reconciliation <current-reconciliation.json> --data-reconciliation-md <current-reconciliation.md> --release-dir apps/desktop/release --readme README.md --db <authority-db> --skip-latest-extras true --out <new-ready-bundle>
pnpm run verify:v15-ready-safety -- --final-readiness <current-ready-final-readiness.json> --ui-smoke <current-business-ui-smoke.json> --bundle-manifest <new-ready-bundle>/delivery-bundle-manifest.json --package-ui-manifest <current-package-ui-manifest.json> --package-security-evidence <current-package-security-evidence.json> --package-adversarial-node-env-evidence <current-package-adversarial-evidence.json> --readme README.md --db <authority-db>
```

所有示例仅说明工具合同，不运行、不补写通过状态，不证明当前已有可用的正式 bundle 或 Windows 包。

## 报表容量、格式与取消后的处理

正式导入使用标准 XLSX、CSV 或受支持的 BIFF8 数据型 XLS。加密、宏、特殊内部格式或不支持的复杂结构会被拒绝；请从数据提供方重新导出标准 XLSX/CSV，不修改原始报表来绕过检查。中文外部文件名和工作表内容仍可使用。

容量检查覆盖压缩文件、展开内容、工作表范围、文本和结果大小。超限时整份文件不入库，不截取前几行冒充成功；请缩小导出日期范围或按业务范围分批重新导出。允许的最大行数也受列宽和总单元格预算约束。

取消、切换店铺/会话，或等待期间报表被修改，会使当前导入或产品族观察失效。重新选择当前文件并预览后再确认，不复用过期确认。后台解析失败时保留失败记录；只有全部文件与独立核对通过，且提交前权限和来源仍有效，才会写入该批次。
