# 当前架构导航

更新日期：2026-10-31。本文说明源码职责；验收状态见 [PROJECT_STATUS](PROJECT_STATUS.md)，历史 v1.2 设计保留在原路径供比较。

## Windows 本地应用

应用采用 Electron Main / Preload / Renderer 与本地工作区包。Main 是配置、凭证、数据库、浏览器连接和执行权限的权威边界，Renderer 通过受限 IPC 获取视图与提交意图。

| 责任 | 主要入口 |
| --- | --- |
| 组合根 | `apps/desktop/src/main/index.ts`、`main-runtime-context.ts`、`main-runtime-access.ts` |
| 启动与恢复 | `desktop-bootstrap.ts`、`desktop-startup.ts`、`main-application-initialization-runtime.ts` |
| 配置 | `bootstrap-configuration.ts`、`configuration-bus.ts`；共享显式配置端口见治理基线 |
| 日志与异常 | `runtime-logger.ts`、`runtime-error-handlers.ts`、`tracked-ipc-handler.ts`、共享 `runtime-log-format.cjs` |
| IPC 装配 | `main-ipc-registration-runtime.ts` 与按领域拆分的 IPC/服务模块 |
| 跨进程桥 | `apps/desktop/src/preload/index.ts` 及领域 API |
| 页面注册 | `renderer/mission-control/workspaces/registry.ts` |
| 六模块导航 | 同目录 `v16-module-router.ts` |
| 持久化 | `packages/local-db/src/sqlite/` 的迁移与按领域拆分仓储 |
| 报表资源 | `packages/report-parser/src/` 的策略、ZIP/OOXML、XLS、文本和工作表预算模块 |
| 隔离解析 | `report-parser-runtime.ts`、`report-parser-worker-client.ts`、`report-parser-worker.ts`；请求和结果合同按职责独立 |
| 导入提交 | `lingxing-report-import.ts`、`report-import-commit-guard.ts`、`collection-import-state-cas.ts` |

路径表中未写绝对目录的 Main 文件位于 `apps/desktop/src/main/`，Renderer 文件位于 `apps/desktop/src/`。原大型聚合文件已按领域拆分，不能重新通过拼接、压行或泛化巨型模块规避尺寸门。

## 当前信息架构

实际路由为六个业务模块，映射十个内部 workspace 和 22 个入口。`registry.ts` 定义 workspace/subview，`v16-module-router.ts` 定义一级模块映射；“六模块”和“十 workspace”是不同层级。

业务主链为：店铺连接与身份确认 → 八类报表采集/校验/导入 → 分析与建议 → Decision/MissionGrant → 执行前检查 → 一次动作和回读 → 实验 → 因果记忆。

报表下载预检与正式解析统一经过资源端口。Main 从配置总线捕获请求快照，在原字节分配前预留全局自有额度；解析 Worker 的克隆、展开内容、派生 STORE 容器及结果另受明确预算限制。派生容器不修改原始文件或其 SHA，Worker 不接收数据库或业务授权端口，也不是操作系统权限沙箱。

Main 等待真实解析终态后，在同一连接的 immediate 事务内重新核验来源、店铺/会话和持有的任务/claim/CAS，再执行原同步仓储提交。任务状态结算比较同一生产规范化合同，不能以重新读取当前数据库追认过期版本。关闭时解析排空加入原数据库关闭门，未归还额度或未退出 Worker 仍阻断正常关闭；细节见治理基线。

## 跨领域不变量

- 数据、查询、策略、授权、任务、浏览器 Profile 和回读始终绑定当前店铺及版本/会话。
- 同一事务内的批次、revision、session、Grant 核验不能在拆文件后变成独立事务。
- 人工批准和策略自动授权各有来源；批准不等于执行，执行不等于回读通过。
- 配置来自统一启动快照、持久配置总线或显式端口；消费者不临时读取环境作为 fallback。
- 异常通过统一边界记录首错和次错，不能吞异常、强退后补写正常关闭或把 UNKNOWN 转绿。
- Listing 为本地版本和导出，不自动提交到 Amazon 或领星。

原生采集、尺寸、日志、配置和六项退出条件详见 [MAINTAINABILITY_BASELINE](MAINTAINABILITY_BASELINE.md)；证据 schema 与拒绝规则见 [V16_NATIVE_EVIDENCE_PROTOCOL](V16_NATIVE_EVIDENCE_PROTOCOL.md) 和 [验证追踪合同](v16_companion_verification_traceability.md)。
