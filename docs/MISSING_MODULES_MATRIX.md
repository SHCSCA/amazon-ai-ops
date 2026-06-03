# Amazon AI Ops Agent 缺失模块职责矩阵

生成日期：2026-05-28

## 当前处理原则

本轮执行保留当前工作区已有内容，不整仓回滚。此前在 git 中显示为删除的工程文件被视为“缺失代码”，按其职责补回；当前已有的 `docs/`、`.codex/` 和 v1.5 文档保持为当前版本。

## 缺失项分类

| 分类 | 路径/模块 | 原职责 | v1.5 处理 |
|---|---|---|---|
| 工程根配置 | `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`electron-builder.yml` | 定义 pnpm workspace、统一 TypeScript 配置、Electron 打包配置 | 必须补全，并修正会导致递归安装或无效 workspace 配置的问题 |
| 桌面应用 | `apps/desktop` | Electron main/preload/React renderer，承载本地 UI、IPC、浏览器和调度入口 | 必须补全，并扩展 v1.5 的广告报告采集、关键词机会、Listing 建议页面 |
| 共享类型 | `packages/shared-types` | 跨包共享广告、库存、利润、任务、浏览器和建议类型 | 必须补全，并新增 v1.5 报告批次、关键词、Listing 类型 |
| 本地数据库 | `packages/local-db` | SQLite 配置、日志、商品、广告指标、建议仓储；DuckDB 分析查询 | 必须补全，并新增 v1.5 表结构 |
| 浏览器控制 | `packages/browser-worker` | Playwright 可见浏览器控制、下载监听、元素定位、登录态检测 | 必须补全，v1.5 继续复用并服务下载中心采集 |
| 页面模型 | `packages/page-models` | 领星登录、广告导出、广告关键词、库存页面模型 | 必须补全，并新增下载中心页面模型资源 |
| 报表解析 | `packages/report-parser` | Excel/CSV 解析、字段映射、校验与清洗 | 必须补全，并扩展 Search Term/SQP/关键词表现表 |
| 规则引擎 | `packages/rules-engine` | 广告优化规则、风险等级、建议生成 | 必须补全，继续支撑广告建议；关键词机会另建模块 |
| AI 适配 | `packages/ai-adapter` | OpenAI-compatible Provider、搜索词相关性、广告动作原因、日报 | 必须补全，并扩展 Listing 改写与风险词 Prompt |
| 动作执行 | `packages/action-executor` | 低风险广告动作执行与回读校验 | 必须补全，但 v1.5 不允许自动修改 Listing |
| 审计日志 | `packages/audit-log` | 操作日志、截图、Trace、过期清理 | 必须补全，v1.5 采集/建议/导出也要留痕 |
| 调度器 | `packages/scheduler` | 本地定时任务注册与执行 | 必须补全，后续用于每日采集/分析 |
| v1.5 新增 | `packages/lingxing-report-collector` | 8 类领星广告报告批量创建、下载、manifest、文件校验 | 新建 |
| v1.5 新增 | `packages/keyword-opportunity` | 关键词归一化、机会评分、风险词识别、搜索词/SQP 机会分析 | 新建 |
| v1.5 新增 | `packages/listing-analyzer` | Listing 覆盖分析、建议位置、草案导出 | 新建 |
| v1.5 新增 | `resources/` | Prompt、字段映射、下载中心页面模型 | 新建 |

## 当前验收标准

1. 工程能被 pnpm workspace 正确识别。
2. v1.2 缺失基础模块重新存在，当前文档不被覆盖。
3. v1.5 新增模块至少提供可导入的 TypeScript 契约和基础实现。
4. `pnpm typecheck` 能作为持续验证入口运行；若失败，失败点必须来自真实代码问题并在后续任务中处理。
