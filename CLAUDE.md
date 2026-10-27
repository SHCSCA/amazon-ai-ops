# CLAUDE.md

## 项目入口

Amazon AI Ops Agent 是 Windows-only、本地优先的 Electron / TypeScript 应用。产品版本为1.6.0；当前交付保持 APP_NEEDS_WORK / INTERNAL NON_READY。项目硬约束和安全边界以 [AGENTS.md](AGENTS.md) 及用户最新指令为准。两个入口独立保留，本次未合并或改变链接类型。

先读 [README](README.md)、[项目状态](docs/PROJECT_STATUS.md)、[进展](PROGRESS.md)、[当前缺口](BLOCKED.md) 和 [开发交接](docs/DEVELOPMENT_HANDOFF.md)。不要从历史phase完成报告、旧包或旧READY推断当前通过状态。

## 命令速查

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm run prepare:native:node
pnpm run typecheck
pnpm run check:module-boundaries:all
pnpm test
pnpm run verify:desktop-isolated
pnpm run build:win
```

测试/构建前核原生ABI及隔离路径；不要把源码应用检查当安装包验收。当前全量失败和下次复现入口见开发交接。

## 职责速查

| 位置 | 责任 |
| --- | --- |
| apps/desktop/src/main/index.ts | 组合根，接入运行上下文、全局异常和生命周期；领域逻辑不再集中回此文件 |
| main/bootstrap-configuration.ts、configuration-bus.ts | 启动快照、持久配置和提交后通知 |
| main/desktop-bootstrap.ts、desktop-startup.ts | 路径/S7准入、初始化、窗口和恢复 |
| main/main-ipc-registration-runtime.ts | 按领域装配IPC，处理器使用统一追踪和异常边界 |
| preload/index.ts及领域API | 受限跨进程桥 |
| renderer/mission-control/workspaces/registry.ts | 十workspace、22入口的实际注册 |
| 同目录v16-module-router.ts | 六个一级业务模块映射 |
| packages/local-db/src/sqlite | schema迁移及分领域仓储 |
| scripts | 隔离验证、原生证据、包型、安全、发布与回读工具 |

表中Main/Preload/Renderer路径相对 apps/desktop/src/。完整导航见 [ARCHITECTURE](docs/ARCHITECTURE.md)。

## 开发边界

- 新增/修改IPC须同步Main、Preload、Renderer类型和对应合同测试。
- 店铺、对象、批次、revision、session、Grant必须逐调用保持一致；聚合仓储的同事务核验不得拆开。
- UI保持任务优先、浅色Windows工作台和本地/系统字体。技术细节放次级区域；不把APP_*、长命令和证据墙作为运营首屏。
- 真实报表与不同统计粒度分别处理，不把campaign/ad_group/placement等混加。
- 产品配置不授广告权限，Listing仅本地版本与导出，UNKNOWN执行只读对账。
- 密码/密钥留Main安全存储边界，不返还已保存明文、不进日志或提交。
- 全局配置、日志、异常、简洁中文注释及模块尺寸门遵循AGENTS和治理基线。

## 文档与外部状态

[docs/README.md](docs/README.md)区分现行合同、历史规格/计划和运行原件。状态变化同步项目状态、PROGRESS、BLOCKED和现行操作说明；生产bundle仍要求当前身份与匹配安全校验。代码快照不发布生产包。

不自动写个人记忆或旧电脑Obsidian路径。整理前本文件完整原字节保存在 [归档](docs/history/2026-10-27-documentation-sync/README.md)，可供核对，不是新的指令来源。
