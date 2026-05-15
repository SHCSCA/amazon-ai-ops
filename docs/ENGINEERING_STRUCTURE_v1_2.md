# Amazon AI Ops Agent - 新工程结构设计

## 目录结构

```
amazon-ai-ops/
├── apps/
│   └── desktop/                          # Electron 主应用
│       ├── src/
│       │   ├── main/                    # Electron main process
│       │   │   ├── index.ts             # 入口 + 窗口管理
│       │   │   ├── ipc/                # IPC handlers (与 renderer 通信)
│       │   │   │   ├── handlers.ts
│       │   │   │   ├── ad-handlers.ts
│       │   │   │   ├── browser-handlers.ts
│       │   │   │   └── db-handlers.ts
│       │   │   ├── tray.ts              # 系统托盘
│       │   │   ├── lifecycle.ts         # 应用生命周期
│       │   │   └── store.ts             # 主进程状态管理
│       │   │
│       │   ├── preload/                  # Preload scripts (安全桥接)
│       │   │   └── index.ts
│       │   │
│       │   └── renderer/                 # React UI (Electron window)
│       │       ├── index.html
│       │       ├── main.tsx
│       │       ├── App.tsx
│       │       ├── pages/
│       │       │   ├── Home/
│       │       │   ├── LoginDetect/
│       │       │   ├── AdCenter/
│       │       │   ├── Approvals/
│       │       │   ├── Logs/
│       │       │   ├── Rules/
│       │       │   └── Diagnostics/
│       │       ├── components/
│       │       │   ├── ui/              # 基础 UI 组件
│       │       │   ├── BrowserView/     # 嵌入浏览器
│       │       │   ├── AdTable/         # 广告数据表
│       │       │   └── ConfirmCard/     # 审批确认卡片
│       │       ├── hooks/               # React hooks
│       │       ├── stores/              # Zustand stores
│       │       └── lib/                 # 工具函数
│       │
│       ├── package.json
│       └── electron-builder.yml
│
├── packages/
│   ├── browser-worker/                  # Playwright 控制层
│   │   ├── src/
│   │   │   ├── controller.ts            # 浏览器控制器
│   │   │   ├── locator.ts               # 元素定位器
│   │   │   ├── session-manager.ts      # Session 检测
│   │   │   ├── download-listener.ts     # 下载监听
│   │   │   ├── page-nav.ts              # 页面导航
│   │   │   ├── screenshot.ts            # 截图管理
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── page-models/                     # 领星页面模型
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── lingxing/
│   │   │   │   ├── ad-campaign.ts       # 广告活动列表
│   │   │   │   ├── ad-targeting.ts      # 关键词/ASIN
│   │   │   │   ├── ad-search-term.ts    # 搜索词报告
│   │   │   │   ├── ad-export.ts         # 报表导出
│   │   │   │   ├── inventory.ts         # 库存
│   │   │   │   ├── login.ts             # 登录页
│   │   │   │   └── types.ts
│   │   │   └── shared/
│   │   │       ├── locator-presets.ts
│   │   │       └── wait-conditions.ts
│   │   └── package.json
│   │
│   ├── report-parser/                   # 报表解析
│   │   ├── src/
│   │   │   ├── parser.ts                # 主解析器
│   │   │   ├── field-mapper.ts         # 字段映射
│   │   │   ├── ad-report.ts            # 广告报表
│   │   │   ├── inventory-report.ts     # 库存报表
│   │   │   ├── profit-report.ts        # 利润报表
│   │   │   └── validators.ts           # 数据校验
│   │   └── package.json
│   │
│   ├── rules-engine/                    # 规则引擎
│   │   ├── src/
│   │   │   ├── engine.ts               # 主引擎
│   │   │   ├── ad-rules.ts             # 广告规则
│   │   │   ├── inventory-rules.ts       # 库存规则
│   │   │   ├── profit-rules.ts         # 利润规则
│   │   │   ├── risk-evaluator.ts       # 风险评估
│   │   │   └── recommendation.ts        # 建议生成
│   │   └── package.json
│   │
│   ├── ai-adapter/                     # AI Provider 适配器
│   │   ├── src/
│   │   │   ├── provider.ts             # 抽象接口
│   │   │   ├── openai-compatible.ts     # OpenAI 兼容实现
│   │   │   ├── prompts/                # Prompt 模板
│   │   │   │   ├── search-term-relevance.ts
│   │   │   │   ├── ad-action-reason.ts
│   │   │   │   ├── daily-report.ts
│   │   │   │   └── profit-anomaly.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── local-db/                       # 本地数据库
│   │   ├── src/
│   │   │   ├── sqlite/
│   │   │   │   ├── db.ts              # better-sqlite3 封装
│   │   │   │   ├── migrations/        # 迁移脚本
│   │   │   │   │   └── 001_initial.ts
│   │   │   │   └── repositories/
│   │   │   │       ├── product-repo.ts
│   │   │   │       ├── ad-metrics-repo.ts
│   │   │   │       ├── recommendation-repo.ts
│   │   │   │       ├── action-log-repo.ts
│   │   │   │       └── settings-repo.ts
│   │   │   ├── duckdb/
│   │   │   │   ├── analytics.ts        # DuckDB OLAP
│   │   │   │   └── queries/
│   │   │   │       ├── ad-summary.ts
│   │   │   │       └── search-term-analysis.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── action-executor/                # 动作执行器
│   │   ├── src/
│   │   │   ├── executor.ts            # 执行器主类
│   │   │   ├── ad-actions.ts          # 广告动作
│   │   │   │   ├── add-negative.ts
│   │   │   │   ├── adjust-bid.ts
│   │   │   │   └── pause-target.ts
│   │   │   ├── verifier.ts            # 回读校验
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── audit-log/                     # 操作日志
│   │   ├── src/
│   │   │   ├── logger.ts              # SQLite 日志
│   │   │   ├── screenshot.ts          # 截图管理
│   │   │   ├── trace.ts              # Playwright Trace
│   │   │   ├── cleanup.ts            # 过期清理
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── scheduler/                     # 本地调度器
│   │   ├── src/
│   │   │   └── scheduler.ts
│   │   └── package.json
│   │
│   └── shared-types/                  # 共享类型
│       ├── src/
│       │   ├── index.ts
│       │   ├── ad.ts                  # 广告相关类型
│       │   ├── inventory.ts            # 库存类型
│       │   ├── profit.ts              # 利润类型
│       │   ├── action.ts             # 动作类型
│       │   ├── page-model.ts          # 页面模型类型
│       │   └── recommendation.ts      # 建议类型
│       └── package.json
│
├── resources/                          # 静态资源
│   ├── prompts/                       # Prompt 模板 (JSON)
│   ├── field-mappings/               # 字段映射 (JSON)
│   │   ├── ad-report-mapping.json
│   │   └── inventory-mapping.json
│   └── page-models/                   # 页面模型 (JSON)
│
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   └── USER_GUIDE.md
│
├── package.json                        # Root workspace
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

## 包依赖关系

```
apps/desktop (Electron)
├── packages/browser-worker
├── packages/page-models
├── packages/report-parser
├── packages/rules-engine
├── packages/ai-adapter
├── packages/local-db
├── packages/action-executor
├── packages/audit-log
├── packages/scheduler
└── packages/shared-types
```

## electron-builder 打包配置

```yaml
# electron-builder.yml
appId: com.amazon-ai-ops.agent
productName: AmazonAIOpsAgent
copyright: Copyright 2024
win:
  target:
    - target: nsis
      arch:
        - x64
  icon: build/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  installerIcon: build/icon.ico
  uninstallerIcon: build/icon.ico
  installerHeaderIcon: build/icon.ico
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: Amazon AI Ops
```

## 初始化命令

```bash
# 创建项目后
pnpm install

# 开发模式
pnpm --filter @amazon-ai-ops/desktop dev

# 构建安装包
pnpm --filter @amazon-ai-ops/desktop build
```

## 迁移策略

| 阶段 | 内容 | 可复用 |
|------|------|--------|
| 1 | 创建新工程结构 | - |
| 2 | 实现 local-db (SQLite) | 表结构参考 |
| 3 | 实现 browser-worker | 70% 复用 |
| 4 | 实现 page-models | 80% 复用 |
| 5 | 实现 report-parser | 80% 复用 |
| 6 | 实现 rules-engine | 60% 复用 |
| 7 | 实现 ai-adapter | 新建 |
| 8 | 实现 action-executor | 70% 复用 |
| 9 | 实现 scheduler | 新建 |
| 10 | 实现 Electron UI | 30% 复用组件 |
