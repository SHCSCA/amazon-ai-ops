# Amazon AI Ops Agent

面向 Amazon 美国站运营者的 Windows 本地 Electron 应用，固定 US / USD，按店铺隔离数据库记录、浏览器 Profile、会话和授权。

**DELIVERY: APP_NEEDS_WORK — INTERNAL NON_READY.** 当前开发版本为 `1.6.0`，数据库目标为 schema 20。V1.6 正在实现和验收，尚未完成生产交付。用户已解除此前的动态验证禁令；旧版本的测试、包哈希和 READY 声明不能用于当前候选。

已证实成果只记录在 [PROGRESS.md](PROGRESS.md)，未满足条件只记录在 [BLOCKED.md](BLOCKED.md)。本文件介绍入口和交付规则，不重复维护测试计数。

本轮聚焦现有单店、人工审批与策略自动两条真实主流程，包含真实 AI、独立降价回读和七日实验结论/记忆。操作与本机恢复步骤见 [单店主流程说明](docs/SINGLE_STORE_MAIN_FLOW.md)；完整 V1.6 验收继续保留未完成状态。

## 当前范围

| 一级模块 | 入口 |
|---|---|
| 今日任务 | 今日总览、运营事件 |
| 运营资产 | 产品与经营目标、广告对象、关键词、商品详情、工作范围、报表采集、导入检查 |
| 决策中心 | 任务中心、任务事实、建议、人工审批、已决策 |
| 执行与实验 | 实时执行、结果核对、经营实验 |
| 经营记忆 | 因果记忆 |
| 系统设置 | 策略与风控、店铺与运行设置、定时任务、交付验收 |

六模块、22 个入口的实际路由以 `v16-module-router.ts` 为准。主流程为：

```text
连接店铺 → 真实采集八类报表 → 校验与导入 → Analysis Run
→ Decision / MissionGrant → 执行前核验 → 单次提交与回读
→ 实验观察 → 系统结论与因果记忆
```

人工模式必须在产品内批准具体的完整候选批次；策略自动模式使用当前已启用策略生成的授权。执行仅支持关键词降价，最大幅度为 `min(10%, Grant 上限)`。提交意图先持久化；UNKNOWN 只允许只读对账，不自动重试、不恢复旧授权、不计为已验证效果。

## 当前交付边界

- 全部 172 个 MUST 按 [V1.6 PRD](docs/amazon_ai_ops_agent_prd_v1_6_0.md) 及逐项 AC 验收。实现映射、单元通过、隔离服务集成都不自动等于真实店铺验收。
- 正式库schema20及真实八报表可用；人工模式已完成真实AI、具体批准、单次关键词降价USD1.80→1.62及提交后/独立刷新回读，重启后记录仍为成功。对应七日实验已启动；策略自动的第二独立候选与执行、观察结论及记忆尚未完成。详细证据见PROGRESS.md / BLOCKED.md。
- Windows 候选包重建及实包检查持续进行，当前准确结果见 PROGRESS / BLOCKED。最终版本必须同时绑定源码、包体、数据库和原始 runner / 运行证据。
- 两家真实 US 店铺各七个已完成美国业务日、独立的人工与策略自动执行、性能和 AI 成本预算批准、完整 L1–L8 及 matching READY bundle 尚未全部满足。
- L4 的 Package UI 当前合同为 schema v9：1366×768 的 100% / 125%、宽屏以及原生 1200×700 最小窗口均覆盖 22 个入口。历史 v8 不再获得当前交付信用。
- 安装版、便携版和 ZIP 的最终 SHA-256 由冻结交付清单提供。此处不复制会过期的包哈希。

## 开发与验证

本机已验证的工具环境：Node.js 24.13.0、pnpm 11.1.1；当前依赖由 `pnpm-lock.yaml` 固定。

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm run typecheck
pnpm run build:win
```

Windows 构建产物：

- `apps/desktop/release/AmazonAIOpsAgent-1.6.0.exe`
- `apps/desktop/release/AmazonAIOpsAgent-1.6.0-portable.exe`
- `apps/desktop/release/AmazonAIOpsAgent-1.6.0.zip`
- `apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe`

候选包直接启动会使用应用自身的迁移安全门。正式库升级必须在软件验收及候选冻结后，按迁移规格先完成 WAL-safe 备份和隔离恢复验证；不能把旧备份静默覆盖到已有新版本写入的库上。

```powershell
# 当前 Windows 包的隔离启动检查
pnpm run smoke:package-launch
pnpm run smoke:folder-zip-launch

# 根据唯一测试清单执行 runner 并保存证据
pnpm run test:v16:evidence

# 校验必需测试、逐项 AC 证据、最终状态和 Service 合同
pnpm run verify:v16-full
```

`verify:v16-full` 在证据缺失、必需测试空集/漏跑/跳过、版本或包身份不匹配时必须失败。L4–L7 的缺失原生证据不得用自报 `passed`、占位数据或文件存在性补齐。旧 `verify:s7-*` / `verify:v15-*` 工具仍服务于具体原生证据子链，单独通过不能替代 V1.6 最终验收。

## 文档与运行记录

| 文档 | 用途 |
|---|---|
| [PROGRESS.md](PROGRESS.md) | 已证实成果及证据位置 |
| [BLOCKED.md](BLOCKED.md) | 剩余实现、验收及用户实际节点 |
| [V1.6 PRD](docs/amazon_ai_ops_agent_prd_v1_6_0.md) | 本次完整交付范围和验收标准 |
| [需求索引](docs/v16_requirements_index.json) | 172 个 MUST 的实现、AC、案例与证据关联 |
| [必需测试清单](docs/v16_required_test_manifest.json) | L1–L7 的必需检查定义 |
| [迁移兼容规格](docs/v16_companion_migration_compatibility.md) | 历史分类、升级、旧版本拒写与恢复 |
| [验收追踪规格](docs/v16_companion_verification_traceability.md) | 原始 runner、原生证据、术语与无障碍检查 |
| [发布实测规格](docs/v16_companion_release_canary.md) | 冻结候选、双店运行、两种授权与真实回读 |

用户操作指南和最终交付报告在实包业务验收后随 matching bundle 冻结。现存 V1.5 指南、状态报告和旧包只作历史参考。

## 本地数据与提交范围

源码、测试、脚本、文档和小型配置可以进入 Git。`output/`、`storage/`、`apps/desktop/release/`、AppData 数据库与 Profile、原始领星报表、密钥、密码、Cookie 和 Token 均为本地产物，不提交。

已有工作、历史业务记录和验证原件必须保留。影响源码、包体或验收合同的修改需要更新对应证据；只有全部完成条件满足，最终状态才可以改为 `APP_READY`。

