# Amazon AI Ops Agent

Windows 本地优先的 Amazon 运营桌面应用，采用 Electron、TypeScript 与 pnpm 工作区。开发预发布版本 **1.6.1-dev.1**，当前处于开发收尾与内部验证阶段。

**DELIVERY: APP_NEEDS_WORK — INTERNAL NON_READY.**

截至 2026-10-30，当前定向回归为 63 文件、743 项通过（不是全量）；最近历史完整 L1 为 **8506/8526，20 失败**；L2/L3 未执行。真实 EXE 两档读屏诊断共 40 节点通过，但正式四包、完整界面、性能、恢复和最终安全审查尚未全部闭合。本仓库快照不能称为开发完成或生产交付。

## 项目信息入口

| 内容 | 文档 |
| --- | --- |
| 当前事实、证据范围与验收顺序 | [项目状态](docs/PROJECT_STATUS.md) |
| 已证实成果 | [PROGRESS.md](PROGRESS.md) |
| 当前缺口与卡点 | [BLOCKED.md](BLOCKED.md) |
| 下次开发如何继续 | [开发交接](docs/DEVELOPMENT_HANDOFF.md) |
| 架构与职责 | [当前架构](docs/ARCHITECTURE.md)、[治理基线](docs/MAINTAINABILITY_BASELINE.md) |
| 全部文档分类 | [文档目录](docs/README.md) |
| 本次迭代 | [CHANGELOG](docs/CHANGELOG.md) |

## 当前产品范围

六个业务模块：今日任务、运营资产、决策中心、执行与实验、经营记忆、系统设置。一级导航映射十个内部 workspace、22 个入口；实际注册源为 `apps/desktop/src/renderer/mission-control/workspaces/registry.ts`，六模块映射为同目录 `v16-module-router.ts`。

```text
店铺连接与身份确认 → 八类报表采集/校验/导入 → 分析与建议
→ Decision / MissionGrant → 执行前检查 → 单次动作与回读
→ 实验观察 → 系统结论与因果记忆
```

人工模式须批准具体候选；策略自动模式须有当前有效策略与授权。授权、执行及回读是独立阶段，均绑定当前店铺、对象、版本与会话。UNKNOWN 只读对账，不重复写入。Listing 为本地版本及导出，不自动提交 Amazon 或领星。

## 运行与开发

用户操作使用真实 Windows 应用 `apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe`。此文件由构建生成，不随源码提交；不默认启动模拟工作台。新机初始化数据库不代表恢复历史店铺或实验。

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm run typecheck
pnpm run check:module-boundaries:all
pnpm test
pnpm run build:win
```

这些是独立开发入口，不是一条已通过的交付流水线。原生模块须匹配 Node/Electron ABI；实包、迁移与业务验证使用显式隔离目录。当前验收保护链须先完成最终快照及字节备份，再开展会打开正常数据库的正式启动核验。详细步骤见 [开发交接](docs/DEVELOPMENT_HANDOFF.md)。

## 验收与真实环境

完整要求来自 [V1.6 PRD](docs/amazon_ai_ops_agent_prd_v1_6_0.md) 的 172 项 MUST 和 L1–L8 当前证据。实现映射、单测、诊断包或历史 READY 均不能替代当前验收；172 项正式状态仍为 UNVERIFIED。内部退出条件见治理基线。

真实环境阶段仍需当前 ERP/Ads 登录与八类报表、AI 连接与预算、具体人工候选批准/策略授权、实际单次动作与回读，以及完整发布要求的两家 US 店铺各七个已完成业务日、实验结论与记忆。内部软件验证不得以需要真实环境为由整体跳过。

## 本地数据与提交范围

提交源码、测试、锁文件、配置及文档；不提交 `output/`、`storage/`、AppData DB/Profile、Local State、原始报表、凭证、密钥、安装 EXE、ZIP 或回滚包。历史回滚包取消 Git 跟踪后仍保留在磁盘，历史证据不删除、不改写。

本次为代码迭代快照，不创建生产 Release、不宣称新安装包已验收。文档整理前的说明和全部历史检查点见 [归档索引](docs/history/2026-10-27-documentation-sync/README.md)。

## 验收命令与兼容分支

以下是维护人员的独立验证入口，不是已通过的流水线。每次使用当前源码、包体、隔离路径与新证据目录：

```powershell
pnpm run build:win
pnpm run smoke:package-launch
pnpm run smoke:folder-zip-launch
node scripts/generate-v16-l1-evidence.mjs --out-dir output/v16-evidence/<new-run>
pnpm run verify:v16-full
```

`pnpm run test:v16:evidence` 是默认写入 `output/v16-evidence/current` 的兼容别名；不要用它覆盖已有原件，也不要追加第二个 `--out-dir` 试图覆盖首个参数。受保护收尾使用上面显式的新目录入口。`verify:v16-full` 的默认输入仍为 current，使用前须按当前实际候选绑定必要输入，不能直接把新目录生成结果当默认聚合器已验证。

构建、smoke、定向测试或旧版安全分支单独通过不能替代 V1.6 最终验收。现存 V1.5 指南、状态报告和旧包只作历史参考；保留的 V1.5 证据工具仍需按明确状态分支交接，不能作为 172 MUST / L1–L8 的旁路。兼容操作见 [用户指南的维护附录](docs/USER_GUIDE_v1_5.md#维护附录证据命令与历史兼容分支)。
