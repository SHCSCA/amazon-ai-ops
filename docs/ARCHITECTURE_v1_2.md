# Amazon AI Ops Agent｜系统架构设计文档 v1.2

## 文档信息

| 字段 | 内容 |
|------|------|
| 文档名称 | Amazon AI Ops Agent 系统架构设计 |
| 版本 | v1.2 |
| 阶段 | 单机桌面版 / v0.1–v1.0 |
| 关联文档 | PRD v1.2 |

---

# 1. 整体架构

## 1.1 单机版架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    Windows 桌面应用                            │
│                  AmazonAIOpsAgent.exe                        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Electron                           │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │   │
│  │  │   UI Shell  │  │Local Scheduler│  │  IPC Bus   │  │   │
│  │  │  (React)    │  │              │  │            │  │   │
│  │  └─────────────┘  └──────────────┘  └───────────┘  │   │
│  │         │                 │                │        │   │
│  │  ┌──────▼─────────────────▼─────────────────▼────┐ │   │
│  │  │              Browser Worker                    │ │   │
│  │  │     (Playwright Chromium, Headful)             │ │   │
│  │  │  ┌─────────┐  ┌───────────┐  ┌──────────┐  │ │   │
│  │  │  │ Page    │  │  Element  │  │ Download  │  │ │   │
│  │  │  │ Models  │  │  Locator  │  │  Listener │  │ │   │
│  │  │  └─────────┘  └───────────┘  └──────────┘  │ │   │
│  │  └──────────────────────────────────────────────┘ │   │
│  │                         │                          │   │
│  │  ┌──────────────────────▼──────────────────────┐ │   │
│  │  │              本地业务层                         │ │   │
│  │  │  ┌───────────┐ ┌───────────┐ ┌──────────┐  │ │   │
│  │  │  │  Rule     │ │    AI     │ │ Scheduler │  │ │   │
│  │  │  │  Engine   │ │  Adapter  │ │           │  │ │   │
│  │  │  └───────────┘ └───────────┘ └──────────┘  │ │   │
│  │  │  ┌───────────┐ ┌───────────┐ ┌──────────┐  │ │   │
│  │  │  │  Report   │ │  Action   │ │   Audit   │  │ │   │
│  │  │  │  Parser   │ │  Executor │ │    Log    │  │ │   │
│  │  │  └───────────┘ └───────────┘ └──────────┘  │ │   │
│  │  └──────────────────────────────────────────────┘ │   │
│  │                         │                          │   │
│  │  ┌──────────────────────▼──────────────────────┐ │   │
│  │  │               本地数据层                       │ │   │
│  │  │  ┌─────────┐  ┌─────────┐  ┌───────────┐  │ │   │
│  │  │  │ SQLite  │  │ DuckDB  │  │  File     │  │ │   │
│  │  │  │  (cfg)  │  │(reports)│  │  Storage  │  │ │   │
│  │  │  └─────────┘  └─────────┘  └───────────┘  │ │   │
│  │  └──────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              用户可见浏览器 (Headful)                  │   │
│  │         领星 ERP - erp.lingxing.com                 │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**用户数据目录**: `C:\Users\<User>\AmazonAIOps\`

## 1.2 组件职责

| 组件 | 职责 | 技术栈 |
|------|------|--------|
| Electron 主进程 | 窗口管理、应用生命周期、本地文件路径 | Electron |
| UI Shell (Renderer) | React 桌面 UI、用户交互 | React + Tailwind CSS |
| Browser Worker | Playwright 浏览器控制、页面操作 | Playwright Chromium |
| Page Models | 领星 ERP 页面定义、元素定位策略 | JSON 配置 |
| Report Parser | Excel/CSV 解析、字段映射、数据清洗 | SheetJS / ExcelJS |
| Rule Engine | 广告/库存/利润规则执行、风险判断 | TypeScript |
| AI Adapter | OpenAI-compatible API 调用封装 | TypeScript |
| Scheduler | 本地定时任务调度 | node-cron / 内置调度器 |
| Action Executor | 动作执行、回读校验、异常处理 | TypeScript |
| Audit Log | 操作记录、截图、Trace 管理 | SQLite + 文件系统 |
| SQLite | 配置、规则、日志元数据存储 | better-sqlite3 |
| DuckDB | 大报表分析、广告聚合查询 | DuckDB |

## 1.3 不再使用的组件（相比 v1.0）

| 旧组件 | 状态 | 说明 |
|--------|------|------|
| Docker Compose | ❌ 移除 | 一期用户不需要 Docker |
| PostgreSQL | ❌ 移除 | 改为 SQLite 本地存储 |
| Redis | ❌ 移除 | 改为内存队列 + SQLite |
| FastAPI Server | ❌ 移除 | 改为 Electron 内置服务 |
| Next.js Web Console | ❌ 移除 | 改为 Electron 内置 UI |
| API Router/REST | ❌ 移除 | 改为 Electron IPC 直调 |

---

# 2. 模块划分

## 2.1 代码仓库结构

```
amazon-ai-ops/
├── apps/
│   └── desktop/
│       ├── main/                     # Electron main process
│       │   ├── index.ts              # 入口、窗口管理
│       │   ├── ipc/                  # IPC handlers
│       │   ├── tray.ts               # 系统托盘
│       │   └── lifecycle.ts          # 应用生命周期
│       │
│       ├── preload/                   # Preload scripts
│       │   └── index.ts              # contextBridge API
│       │
│       └── renderer/                  # React UI (桌面窗口)
│           ├── App.tsx
│           ├── pages/                 # 页面
│           │   ├── Home/             # 首页
│           │   ├── LoginDetect/      # ERP登录检测
│           │   ├── AdCenter/         # 广告优化中心
│           │   ├── Approvals/        # 审批确认
│           │   ├── Logs/             # 操作日志
│           │   ├── Rules/            # 规则设置
│           │   └── Diagnostics/      # 系统诊断
│           ├── components/           # 公共组件
│           └── stores/               # 状态管理
│
├── packages/
│   ├── browser-worker/               # Playwright 控制层 ★ 可复用
│   │   ├── src/
│   │   │   ├── controller.ts         # 浏览器控制器
│   │   │   ├── locator.ts             # 元素定位器
│   │   │   ├── session-manager.ts    # Session 检测
│   │   │   ├── page-model.ts         # 页面模型基类
│   │   │   ├── download-listener.ts   # 下载监听
│   │   │   └── types.ts
│   │   └── package.json
│   │
│   ├── page-models/                  # 领星页面模型 ★ 可复用
│   │   ├── src/
│   │   │   ├── lingxing/
│   │   │   │   ├── index.ts
│   │   │   │   ├── ad-campaign.ts    # 广告活动列表
│   │   │   │   ├── ad-targeting.ts   # 关键词/ASIN
│   │   │   │   ├── ad-search-term.ts # 搜索词报告
│   │   │   │   ├── ad-export.ts      # 报表导出
│   │   │   │   ├── inventory.ts      # 库存
│   │   │   │   └── profit.ts         # 利润
│   │   │   └── shared/
│   │   │       └── locator-presets.ts # 通用定位预设
│   │   └── package.json
│   │
│   ├── report-parser/                # 报表解析 ★ 可复用
│   │   ├── src/
│   │   │   ├── parser.ts             # 主解析器
│   │   │   ├── field-mapper.ts       # 字段映射
│   │   │   ├── ad-report.ts         # 广告报表
│   │   │   ├── inventory-report.ts   # 库存报表
│   │   │   └── profit-report.ts     # 利润报表
│   │   └── package.json
│   │
│   ├── rules-engine/                 # 规则引擎 ★ 可复用
│   │   ├── src/
│   │   │   ├── engine.ts             # 规则引擎主类
│   │   │   ├── ad-rules.ts           # 广告规则
│   │   │   ├── inventory-rules.ts    # 库存规则
│   │   │   ├── profit-rules.ts       # 利润规则
│   │   │   └── risk-evaluator.ts    # 风险评估
│   │   └── package.json
│   │
│   ├── ai-adapter/                   # AI Provider 适配器 ★ 新建
│   │   ├── src/
│   │   │   ├── provider.ts           # 抽象接口
│   │   │   ├── openai-compatible.ts  # OpenAI兼容实现
│   │   │   └── prompts/              # Prompt 模板
│   │   └── package.json
│   │
│   ├── local-db/                     # 本地数据库 ★ 新建
│   │   ├── src/
│   │   │   ├── sqlite/
│   │   │   │   ├── db.ts            # better-sqlite3 封装
│   │   │   │   ├── migrations/      # 迁移脚本
│   │   │   │   └── repositories/    # 数据访问层
│   │   │   ├── duckdb/
│   │   │   │   └── analytics.ts     # DuckDB 分析
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── action-executor/              # 动作执行器 ★ 可复用
│   │   ├── src/
│   │   │   ├── executor.ts          # 执行器主类
│   │   │   ├── ad-actions.ts        # 广告动作执行
│   │   │   ├── verifier.ts          # 回读校验
│   │   │   └── screenshot.ts        # 截图管理
│   │   └── package.json
│   │
│   ├── audit-log/                    # 日志/Trace ★ 可复用
│   │   ├── src/
│   │   │   ├── logger.ts            # 操作日志
│   │   │   ├── trace.ts             # Playwright Trace
│   │   │   └── cleanup.ts          # 过期清理
│   │   └── package.json
│   │
│   ├── scheduler/                     # 本地调度器 ★ 新建
│   │   ├── src/
│   │   │   └── scheduler.ts
│   │   └── package.json
│   │
│   └── shared-types/                  # 共享类型定义
│       ├── src/
│       │   ├── api/                  # 内部 API 类型
│       │   ├── agent/                # Agent 协议
│       │   ├── rules/                # 规则类型
│       │   └── reports/              # 报表类型
│       └── package.json
│
├── resources/                         # 静态资源
│   ├── prompts/                      # Prompt 模板
│   │   ├── search-term-relevance.md
│   │   ├── ad-action-reason.md
│   │   ├── daily-report.md
│   │   └── profit-anomaly.md
│   │
│   ├── field-mappings/               # 字段映射
│   │   ├── ad-report-mapping.json
│   │   ├── inventory-mapping.json
│   │   └── profit-mapping.json
│   │
│   └── page-models/                   # 页面模型（JSON）
│       ├── ad-campaign-model.json
│       └── ad-search-term-model.json
│
├── docs/
│   ├── PRD.md                        # 产品需求文档
│   ├── ARCHITECTURE.md               # 本文档
│   └── USER_GUIDE.md                 # 用户使用说明
│
├── build/                            # 构建输出
├── package.json                       # Root pnpm workspace
└── README.md
```

## 2.2 核心模块职责矩阵

| 模块 | 职责 | 边界 |
|------|------|------|
| browser-worker | Playwright 控制、页面操作、元素定位、下载监听 | 不执行业务逻辑 |
| page-models | 领星页面定义、定位策略、版本管理 | 只读配置，不含执行逻辑 |
| report-parser | Excel/CSV 解析、字段映射、数据清洗 | 不做业务判断 |
| rules-engine | 广告/库存/利润规则判断、风险分级 | 只输出建议，不执行 |
| ai-adapter | OpenAI-compatible API 调用、Prompt 版本管理 | 只输出分析结果，不执行 |
| action-executor | 动作执行、回读校验、截图管理 | 执行后必须回读校验 |
| local-db/sqlite | 配置、规则、日志、SKU 成本存储 | 不做分析计算 |
| local-db/duckdb | 大报表聚合分析、广告多周期统计 | 只做 OLAP 查询 |
| scheduler | 定时任务调度、任务状态管理 | 不执行具体任务 |
| audit-log | 操作记录、截图、Trace、过期清理 | 只记录，不判断 |

---

# 3. 核心数据流

## 3.1 每日广告优化完整数据流（单机版）

```
┌──────────────────────────────────────────────────────────────────┐
│                    T+0: Scheduler 定时触发                        │
│                    (每日 08:00 / 用户手动触发)                    │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Browser Worker (Playwright)                      │
│  1. 检测 Session（登录态、店铺、站点）                             │
│  2. 进入领星 ERP 广告报表页                                       │
│  3. 设置日期范围 / 店铺 / ASIN 筛选                               │
│  4. 点击导出，等待下载完成                                        │
│  5. 保存文件到 ~/AmazonAIOps/storage/downloads/                   │
│  6. 截图（before / after）                                       │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Report Parser                                │
│  1. 读取下载的报表文件（Excel/CSV）                               │
│  2. 根据字段映射表解析                                             │
│  3. 数据校验（关键字段是否存在）                                   │
│  4. 写入 SQLite（原始数据）                                       │
│  5. 写入 DuckDB（分析数据）                                       │
│  6. 触发规则引擎                                                  │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Rule Engine                                 │
│  1. 读取广告数据 + 用户规则配置                                    │
│  2. 对每个 Target/Search Term 执行规则判断                        │
│  3. 生成候选动作（否词、降 bid、暂停）                             │
│  4. 判定风险等级（AUTO/APPROVAL/FORBIDDEN）                      │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                       AI Adapter                                   │
│  1. 对候选动作补充 AI 解释（需配置 AI Key）                        │
│  2. 语义相关性判断（搜索词是否与产品相关）                         │
│  3. 无 AI Key 时降级为纯规则判断                                  │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Recommendation Store                            │
│  AUTO 动作 ──────────────► 直接入执行队列                         │
│  APPROVAL 动作 ─────────► 入审批中心（等待人工确认）               │
│  FORBIDDEN 动作 ─────────► 记录但不执行                           │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼ (AUTO 动作)
┌──────────────────────────────────────────────────────────────────┐
│                   Action Executor                                 │
│  1. 接收执行任务                                                   │
│  2. 执行前截图                                                    │
│  3. 进入目标页面                                                   │
│  4. 定位目标元素（Page Model 定位策略）                           │
│  5. 执行操作（click / fill）                                      │
│  6. 等待 Toast/结果                                               │
│  7. 回读校验（确认值已变更）                                       │
│  8. 执行后截图                                                    │
│  9. 保存 Playwright Trace                                         │
│  10. 记录 Action Log                                              │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                       日报生成                                     │
│  Scheduler 触发日报任务                                           │
│  AI Adapter 生成自然语言总结（有 AI Key 时）                       │
│  或生成结构化日报（无 AI Key 时）                                  │
│  保存到 ~/AmazonAIOps/storage/reports/daily/                      │
└──────────────────────────────────────────────────────────────────┘
```

## 3.2 Session 失效处理

```
浏览器操作中检测到 Session 失效
    │
    ├── URL 跳转到登录页
    ├── 页面出现登录表单
    ├── 关键 ERP 菜单消失
    ├── 接口返回 401/403
    └── 页面出现 session timeout / 安全验证
    │
    ▼
停止当前任务
标记 Agent 状态为 blocked
截图保存
提示用户重新登录
用户手动处理后点击"继续"
```

## 3.3 页面模型失效处理

```
触发条件：
- required_texts 缺失
- table_headers 缺失
- 核心按钮找不到
- 导出失败
- 回读失败
- 连续 3 次识别失败

处理方式：
停止任务 → 截图 → 保存 DOM snapshot → 标记 page_model_mismatch
→ 提示用户导出诊断包 → 不盲点操作
```

---

# 4. 本地数据目录设计

## 4.1 Windows 默认目录

```
C:\Users\<User>\AmazonAIOps\
├── app-data\
│   ├── app.db                    # SQLite 主数据库
│   ├── analytics.duckdb          # DuckDB 分析库
│   ├── config.json               # 用户配置
│   └── user-settings.json        # 用户偏好设置
│
├── browser-profile\
│   └── playwright-profile\       # Playwright persistent context
│                               # 包含登录态 Cookie
│
├── storage\
│   ├── downloads\               # 原始下载报表
│   │   ├── 2024-01-15\         # 按日期分目录
│   │   └── 2024-01-16\
│   │
│   ├── reports\                 # 解析后报表
│   │   ├── daily\              # 每日日报
│   │   └── export\             # 导出文件
│   │
│   ├── screenshots\             # 截图
│   │   ├── before\             # 操作前截图
│   │   ├── after\              # 操作后截图
│   │   └── error\              # 错误截图
│   │
│   ├── traces\                  # Playwright Trace 文件
│   │   ├── 2024-01-15\
│   │   └── 2024-01-16\
│   │
│   └── logs\                    # 日志文件
│       └── app.log
│
├── resources\                    # 内置资源（打包进 exe）
│   ├── prompts\
│   ├── field-mappings\
│   └── page-models\
│
└── backups\
    ├── sqlite\                  # SQLite 备份
    └── config\                  # 配置文件备份
```

## 4.2 文件保留策略

| 文件类型 | 默认保留 |
|----------|----------|
| 普通截图 | 30 天 |
| 错误截图 | 90 天 |
| 审批相关截图 | 180 天 |
| Trace | 14 天 |
| 原始下载报表 | 30 天 |
| 解析后导出文件 | 30 天 |
| SQLite 数据库 | 长期保留 |
| 操作日志元数据 | 长期保留 |

---

# 5. 技术选型

## 5.1 核心技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 桌面框架 | Electron | 28+ | 主进程 + Renderer 分离 |
| UI | React + TypeScript | 18+ | 桌面窗口内嵌 Web UI |
| 样式 | Tailwind CSS | 3.x | 原子化 CSS |
| 浏览器自动化 | Playwright | 1.40+ | Chromium (Headful) |
| 本地数据库 | better-sqlite3 | 9.x | SQLite Node.js 绑定 |
| 大数据分析 | DuckDB | 0.9+ | OLAP 分析引擎 |
| Excel 解析 | SheetJS (xlsx) | 0.18+ | 浏览器端解析 |
| 状态管理 | Zustand | 4.x | 轻量状态管理 |
| 打包 | electron-builder | 24+ | Windows 安装包 |

## 5.2 为什么选择这些技术

| 选择 | 原因 |
|------|------|
| Electron 而非 Tauri | 已有 Playwright Node.js 集成，Electron 更成熟 |
| Headful 而非 Headless | 用户需要可见操作过程、建立信任、处理验证码 |
| better-sqlite3 而非 sql.js | better-sqlite3 是原生绑定，性能好于 WASM 版 |
| DuckDB 而非纯 SQLite | 广告报表数据量大时需要列式存储分析 |
| SheetJS 而非 ExcelJS | SheetJS 对复杂 Excel 格式支持更好 |

---

# 6. SQLite 数据库设计

## 6.1 核心表（与 PRD v1.2 一致）

```sql
-- 应用配置
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

-- 产品表
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace_code TEXT,
  store_name TEXT,
  asin TEXT,
  parent_asin TEXT,
  msku TEXT,
  sku TEXT,
  title TEXT,
  product_stage TEXT,
  status TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- 产品成本
CREATE TABLE product_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  purchase_cost REAL,
  first_leg_cost REAL,
  fba_fee REAL,
  referral_fee_rate REAL,
  storage_fee REAL,
  other_cost REAL,
  min_price REAL,
  target_net_margin REAL,
  target_acos REAL,
  target_tacos REAL,
  updated_at TEXT
);

-- 广告每日指标（从报表解析写入）
CREATE TABLE ad_daily_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  store_name TEXT,
  marketplace_code TEXT,
  asin TEXT,
  msku TEXT,
  campaign_name TEXT,
  ad_group_name TEXT,
  targeting TEXT,
  search_term TEXT,
  match_type TEXT,
  impressions INTEGER,
  clicks INTEGER,
  cost REAL,
  orders INTEGER,
  sales REAL,
  acos REAL,
  cpc REAL,
  cvr REAL,
  source_file TEXT,
  created_at TEXT
);

-- 动作建议
CREATE TABLE action_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  store_name TEXT,
  marketplace_code TEXT,
  asin TEXT,
  msku TEXT,
  entity_type TEXT,
  entity_id TEXT,
  action_type TEXT,
  current_value TEXT,
  recommended_value TEXT,
  reason TEXT,
  evidence_json TEXT,
  confidence REAL,
  risk_level TEXT,
  status TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- 操作日志
CREATE TABLE action_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_id INTEGER,
  task_id TEXT,
  action_type TEXT,
  entity_type TEXT,
  entity_id TEXT,
  before_value TEXT,
  after_value TEXT,
  execution_status TEXT,
  failure_reason TEXT,
  screenshot_before TEXT,
  screenshot_after TEXT,
  trace_path TEXT,
  page_url TEXT,
  created_at TEXT
);

-- Prompt 模板
CREATE TABLE prompt_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_key TEXT,
  version TEXT,
  content TEXT,
  input_schema TEXT,
  output_schema TEXT,
  enabled INTEGER,
  created_at TEXT
);

-- AI 调用记录
CREATE TABLE ai_call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_key TEXT,
  prompt_version TEXT,
  model TEXT,
  input_hash TEXT,
  output_json TEXT,
  success INTEGER,
  error_message TEXT,
  created_at TEXT
);
```

---

# 7. 预留扩展点（Adapter 模式）

| 扩展点 | 当前实现 | 后续实现 |
|--------|----------|----------|
| Database Adapter | SQLiteAdapter | PostgresAdapter |
| Storage Adapter | LocalStorageAdapter | S3 / OSS Adapter |
| AI Provider Adapter | OpenAICompatibleAdapter | LocalModel / MultiProvider |
| Task Queue Adapter | LocalTaskQueue | RedisTaskQueue |

---

# 8. 与 v1.0 架构对比

| 对比项 | v1.0 (旧) | v1.2 (新) |
|--------|-----------|-----------|
| 部署形态 | Docker Compose | Windows 安装包 |
| 数据库 | PostgreSQL + Redis | SQLite + DuckDB |
| API Server | FastAPI 独立服务 | 移除 |
| Web Console | Next.js 独立部署 | Electron 内置 UI |
| 任务队列 | Redis + Celery | 内存队列 + SQLite |
| 用户要求 | 可能需要部署环境 | 一键安装，零技术门槛 |
| 数据存储 | 云端/远程 | 完全本地 |

---

本文档为 v1.2 单机版架构设计，与 PRD v1.2 配套使用。
