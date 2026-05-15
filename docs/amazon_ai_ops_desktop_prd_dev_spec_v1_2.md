# Amazon AI Ops Agent 单机版｜PRD + AI 开发需求文档 v1.2

## 文档信息

| 字段 | 内容 |
|---|---|
| 文档名称 | Amazon AI Ops Agent 单机版 PRD + AI 开发需求文档 |
| 文档版本 | v1.2 |
| 当前产品形态 | Windows 单机桌面应用 |
| 后续预留形态 | 团队版 / 私有化部署版 / SaaS + Local Agent 版 |
| 核心场景 | 通过用户已登录的领星 ERP 浏览器，自动完成亚马逊广告分析、报表采集、低风险广告操作、库存预警、利润分析、日报生成 |
| 核心原则 | 普通用户不接触 Docker、PostgreSQL、Redis、Node.js、Python、命令行；一键安装，本地运行，可见浏览器，操作留痕，高风险审批 |
| 适用对象 | AI 开发、桌面端开发、浏览器自动化开发、前端开发、数据分析开发、测试工程师、产品经理 |

---

# 0. 本版修订说明

本 v1.2 文档整合并替代此前两份文档：

1. Amazon AI Ops Agent｜亚马逊 AI 自动运营系统 PRD + 开发需求文档 v1.0
2. Amazon AI Ops Agent｜需求确认与工程约束补充文档 v1.1

并根据最新产品方向进行重大调整：

> 当前只考虑 **单机版本**。开发者版、私有化部署版、SaaS 版只做架构预留，不作为一期交付内容。

核心变化：

| 旧方案 | 新方案 |
|---|---|
| Electron Agent + Docker Compose 服务端 | Windows 一键安装包 + 本地模块化单体 |
| PostgreSQL / Redis 作为一期默认依赖 | SQLite + DuckDB + 本地文件系统 |
| Web 服务端部署 | 内置本地控制台 |
| 多用户 / 团队协作 | 本机单用户 |
| SaaS 后台 | 只预留接口，不实现 |
| 用户可能需要部署环境 | 用户不接触任何技术环境 |

---

# 1. 产品定位

## 1.1 一句话定位

Amazon AI Ops Agent 是一个面向不会开发的亚马逊卖家的本地 AI 运营助手。用户安装 Windows 软件后，通过已登录的领星 ERP 浏览器，让 AI 自动读取数据、分析广告、生成运营建议，并在用户授权范围内执行低风险广告操作。

## 1.2 当前版本定位

当前版本只做：

```text
单人
单机
Windows 桌面软件
本地数据存储
可见浏览器控制
领星 ERP 自动化
广告运营闭环优先
```

当前版本不做：

```text
SaaS
多租户
云数据库
团队权限
手机 App
浏览器插件
Docker 用户部署
PostgreSQL 用户部署
Redis 用户部署
自动账号申诉
自动修改 Listing 核心信息
自动破解验证码
```

## 1.3 用户使用流程

```text
1. 下载 AmazonAIOpsAgent-Setup.exe
2. 双击安装
3. 打开软件
4. 点击“启动领星 ERP 浏览器”
5. 在浏览器里手动登录领星 ERP
6. 点击“我已登录，开始检测”
7. 软件自动检查广告、库存、利润数据
8. 生成广告优化建议
9. 用户确认后执行低风险动作
10. 查看日报和操作记录
```

用户不应该看到 Docker、PostgreSQL、Redis、Node.js、Python、命令行、环境变量、端口配置、数据库连接等技术细节。

---

# 2. 项目背景

亚马逊运营每天需要处理大量重复且高频的数据工作：广告搜索词分析、高点击无转化词处理、关键词 bid 调整、Campaign 预算控制、无效 ASIN / Target 暂停、出单词迁移、库存断货预警、滞销库存识别、利润异常识别、每日运营复盘、每周广告复盘。

传统人工运营的问题：

| 问题 | 影响 |
|---|---|
| 数据量大 | 容易漏掉异常广告、异常 SKU |
| 操作重复 | 广告优化耗费大量人力 |
| 标准不统一 | 不同运营判断标准不同 |
| 响应滞后 | 库存、广告、利润问题发现太晚 |
| 权限敏感 | 不适合直接交出亚马逊主账号 |
| 工具复杂 | 普通运营不具备开发部署能力 |

本项目通过本地桌面 Agent 控制用户已登录的领星 ERP，实现可控自动化运营。

---

# 3. 产品目标

## 3.1 一期目标

一期目标是做出一个非技术用户可安装、可使用、可验证价值的单机版产品。

```text
一键安装
本地运行
可见浏览器
登录态复用
自动下载报表
自动分析广告
生成优化建议
低风险动作可执行
中风险动作需确认
所有动作可追溯
```

## 3.2 业务目标

| 目标 | 衡量指标 |
|---|---|
| 降低广告分析时间 | 每日广告分析耗时减少 60%+ |
| 减少无效广告花费 | 高点击无转化词识别率 ≥ 90% |
| 提高操作标准化 | 100% 操作有规则、有原因、有日志 |
| 降低误操作风险 | 高风险动作 100% 人工确认 |
| 降低部署门槛 | 普通用户无需安装任何开发环境 |
| 验证商业价值 | 单机版可在真实店铺连续运行 7 天以上 |

---

# 4. 目标用户

| 用户类型 | 需求 |
|---|---|
| 亚马逊中小卖家老板 | 减少人工运营依赖，快速知道广告和库存问题 |
| 单人运营 | 自动完成每日广告数据分析和重复操作 |
| 精品卖家 | 精细控制广告、库存、利润 |
| 多店铺个人卖家 | 在一台电脑上管理多个领星店铺数据 |
| 不会开发的运营人员 | 一键安装、图形化操作，不接触技术环境 |

暂不面向：需要团队协作的大公司、希望多人权限审批的公司、要求 SaaS 云端管理的用户、不使用领星 ERP 的卖家、希望 AI 完全无监督代操账号的用户。

---

# 5. 产品形态

## 5.1 当前交付形态

当前只交付：

```text
AmazonAIOpsAgent-Setup.exe
```

软件内包含：

```text
本地 UI
本地任务调度器
Playwright 浏览器控制层
报表解析器
规则引擎
AI Provider 适配器
SQLite 数据库
DuckDB 分析引擎
本地文件存储
操作日志
诊断工具
```

## 5.2 一期不暴露的内容

普通用户不感知 Playwright、SQLite、DuckDB、Prompt、规则引擎、页面模型、字段映射、Trace 文件、本地 API、本地任务队列。

## 5.3 后续预留形态

| 后续形态 | 当前是否实现 | 预留方式 |
|---|---|---|
| 开发者版 | 不实现 | 保留模块化工程结构 |
| 私有化部署版 | 不实现 | 保留 DB / Storage Adapter |
| 团队局域网版 | 不实现 | 保留 Auth / Task Adapter |
| SaaS + Local Agent | 不实现 | 保留云端通信接口 |
| 浏览器插件 | 不实现 | 保留页面模型与 DOM 抽象 |
| 移动审批 | 不实现 | 保留审批数据结构 |

---

# 6. 核心原则

## 6.1 产品原则

```text
普通用户一键安装
不要求用户部署环境
不获取用户账号密码
用户手动登录领星 ERP
浏览器操作过程可见
低风险动作可自动
中风险动作必须确认
高风险动作禁止自动
所有动作必须留痕
页面异常立即停止
不做验证码破解
不做账号申诉自动提交
```

## 6.2 技术原则

```text
优先 DOM / Accessibility Tree 定位
其次文本定位
再其次 CSS / XPath fallback
默认禁止坐标盲点
操作前读取原值
操作后回读校验
规则引擎有最终否决权
AI 只做分析与辅助判断
没有 AI Key 时基础规则仍可运行
所有 Prompt 版本化
所有字段映射版本化
所有页面模型版本化
```

---

# 7. 总体架构

## 7.1 单机版架构

```text
Windows 桌面应用
├── UI 层
│   ├── 首页
│   ├── ERP 登录检测
│   ├── 广告优化中心
│   ├── 审批确认
│   ├── 操作日志
│   ├── 规则设置
│   └── 系统诊断
│
├── 业务层
│   ├── 本地任务调度器
│   ├── 报表采集器
│   ├── 报表解析器
│   ├── 广告规则引擎
│   ├── 库存规则引擎
│   ├── 利润计算引擎
│   ├── AI Provider 适配器
│   └── 动作执行器
│
├── 浏览器自动化层
│   ├── Playwright 控制器
│   ├── 页面模型
│   ├── 元素定位器
│   ├── 截图与 Trace
│   ├── 下载监听
│   └── 回读校验
│
├── 数据层
│   ├── SQLite
│   ├── DuckDB
│   ├── 本地文件系统
│   └── 配置文件
│
└── 扩展抽象层
    ├── Database Adapter
    ├── Storage Adapter
    ├── AI Provider Adapter
    ├── Task Queue Adapter
    └── Agent Communication Adapter
```

## 7.2 推荐技术栈

| 层级 | 技术 |
|---|---|
| 桌面端 | Electron + TypeScript |
| UI | React + TypeScript + Tailwind CSS |
| 浏览器自动化 | Playwright |
| 本地数据库 | SQLite |
| 大报表分析 | DuckDB |
| Excel/CSV 解析 | SheetJS / ExcelJS / DuckDB CSV |
| 本地文件存储 | Windows 用户目录 |
| AI 接入 | OpenAI-compatible API |
| 本地任务调度 | 内置 Scheduler |
| 打包安装 | electron-builder |
| 自动更新 | electron-updater，后续实现 |
| Trace / 截图 | Playwright Trace + screenshot |
| 日志 | 本地日志文件 + SQLite 元数据 |

## 7.3 为什么不使用 Docker 作为一期用户方案

普通用户不会安装和维护 Docker Desktop、PostgreSQL、Redis、API Server、Web Console、环境变量、端口映射、容器日志。因此 Docker 只用于开发环境、内部测试或未来私有化部署，单机用户版不使用。

---

# 8. 本地目录设计

## 8.1 Windows 默认目录

```text
C:\Users\<User>\AmazonAIOps\
├── app-data\
│   ├── app.db
│   ├── analytics.duckdb
│   ├── config.json
│   └── user-settings.json
│
├── browser-profile\
│   └── playwright-profile\
│
├── storage\
│   ├── downloads\
│   ├── reports\
│   ├── screenshots\
│   │   ├── before\
│   │   ├── after\
│   │   └── error\
│   ├── traces\
│   ├── logs\
│   └── exports\
│
├── resources\
│   ├── prompts\
│   ├── page-models\
│   └── field-mappings\
│
└── backups\
    ├── sqlite\
    └── config\
```

## 8.2 文件保留策略

| 文件类型 | 默认保留 |
|---|---:|
| 普通截图 | 30 天 |
| 错误截图 | 90 天 |
| 审批相关截图 | 180 天 |
| Trace | 14 天 |
| 原始下载报表 | 30 天 |
| 解析后导出文件 | 30 天 |
| SQLite 数据库 | 长期保留 |
| 操作日志元数据 | 长期保留，至少 1 年 |

## 8.3 本地存储膨胀处理

必须提供：存储空间检测、文件大小统计、过期文件自动清理、手动清理按钮、导出诊断包、清理 Trace、清理截图、清理原始报表、备份数据库、恢复数据库。

默认阈值：超过 10GB 提醒，超过 20GB 强提醒，超过 30GB 自动清理过期大文件。

---

# 9. 领星 ERP 环境约束

## 9.1 默认访问地址

一期默认支持：

```text
https://erp.lingxing.com/*
```

但必须配置化：

```json
{
  "lingxing_base_url": "https://erp.lingxing.com"
}
```

## 9.2 是否支持多域名

| 项目 | 一期 |
|---|---|
| 单一公网域名 | 支持 |
| 多域名 allowlist | 预留，不实现 |
| 私有化领星地址 | 预留，不实现 |
| 本地部署版 ERP | 一期不支持 |

## 9.3 浏览器模式

一期必须为 Headful 可见浏览器，便于用户手动登录、处理验证码、观察操作过程并建立信任。一期不默认 headless。

---

# 10. Session 与登录态

## 10.1 登录方式

系统不获取账号密码。

```text
用户点击“启动领星 ERP 浏览器”
→ 软件打开可见浏览器
→ 用户手动输入账号密码并完成 2FA
→ 用户回到软件点击“我已登录”
→ Agent 检测登录状态
→ 检测通过后开始任务
```

## 10.2 登录态保存

使用 Playwright persistent context 保存浏览器用户目录：

```text
C:\Users\<User>\AmazonAIOps\browser-profile\
```

不保存明文密码、用户输入的 2FA、收款信息、信用卡信息。

## 10.3 Session 失效处理

一期不自动重登。检测到失效后：停止当前任务、Agent 状态设为 blocked、截图、提示用户重新登录、用户处理后点击“继续”。

检测条件：URL 跳转登录页、页面出现登录表单、关键 ERP 菜单消失、接口返回 401/403、页面出现 session timeout、页面出现安全验证。

---

# 11. 页面模型设计

## 11.1 页面模型原则

```text
人工预置页面模型
运行时自动校验
失败后触发维护
AI 只辅助生成变更报告
不自动修改生产页面模型
```

## 11.2 一期必须支持页面

| 页面 | 功能 | 优先级 |
|---|---|---|
| 首页 / 登录态检测页 | 判断登录状态 | P0 |
| 广告活动列表页 | Campaign 数据读取与预算操作 | P0 |
| 广告 Targeting / 关键词页 | bid、暂停、启用 | P0 |
| 广告搜索词报告页 | 搜索词分析、否词 | P0 |
| 广告报表导出页 | 下载 Campaign / Targeting / Search Term 报表 | P0 |
| 操作确认弹窗 | 保存、确认、回读校验 | P0 |

## 11.3 页面模型结构

```json
{
  "page_name": "广告搜索词报告",
  "version": "1.0.0",
  "domain": "erp.lingxing.com",
  "path_pattern": "/advertising/*",
  "required_texts": ["搜索词", "花费", "订单", "ACOS"],
  "table_headers": ["搜索词", "Campaign", "点击", "花费", "订单", "销售额", "ACOS"],
  "filters": ["店铺", "站点", "日期", "ASIN", "Campaign"],
  "actions": ["export_report", "add_negative_exact", "filter_by_date", "filter_by_asin"],
  "success_toasts": ["操作成功", "保存成功"],
  "error_toasts": ["操作失败", "权限不足", "网络异常"]
}
```

## 11.4 页面模型失效处理

触发条件：required_texts 缺失、table_headers 缺失、核心按钮找不到、导出失败、回读失败、连续 3 次识别失败。

处理方式：停止任务、截图、保存 DOM snapshot、标记 page_model_mismatch、提示用户导出诊断包、不盲点。

---

# 12. 元素识别与操作策略

## 12.1 定位优先级

```text
1. getByRole / aria-label / label
2. 精确文本定位
3. 页面模型限定区域内定位
4. CSS selector
5. XPath
6. 截图视觉辅助识别
7. 坐标点击：默认禁止，仅开发调试可用
```

## 12.2 fallback 示例

```json
{
  "action": "add_negative_exact",
  "primary_locator": {
    "role": "button",
    "name": "添加否定关键词"
  },
  "fallback_locators": [
    { "text": "添加否定" },
    { "css": "button[data-action='add-negative']" },
    { "xpath": "//button[contains(., '否定')]" }
  ],
  "must_be_inside": {
    "page_section": "search_term_table"
  },
  "allow_coordinate_click": false
}
```

## 12.3 操作前检查

每次写操作前必须检查：当前页面是否正确、当前店铺是否正确、当前站点是否正确、目标对象是否正确、目标元素是否唯一、目标元素是否可见、目标元素是否可点击、目标动作是否在白名单、是否超过操作限额、是否需要人工确认。

## 12.4 操作后检查

每次写操作后必须检查：是否出现成功提示、页面值是否回读成功、目标值是否等于预期值、是否出现错误提示、是否误改其他对象、是否需要回滚或人工提示。

---

# 13. CAPTCHA / 滑块 / 安全验证处理

一期不自动处理 CAPTCHA / 滑块。

```text
检测验证码 / 滑块
→ 停止当前任务
→ 状态标记 blocked
→ 截图
→ 提示用户人工处理
→ 用户处理完成后点击“继续”
```

系统不得自动破解验证码、调用打码平台、绕过风控、模拟异常登录、隐藏浏览器自动化特征用于规避安全验证。

---

# 14. 数据采集需求

## 14.1 一期必须支持的报表

| 报表 | 用途 |
|---|---|
| Campaign Report | 广告活动表现 |
| Targeting Report | 关键词 / ASIN 表现 |
| Search Term Report | 挖词、否词 |
| Placement Report | 判断 Top of Search 效果，可选 |
| Product Performance Report | 产品表现，v1.0 可选 |
| Inventory Report | 库存分析，v1.0 基础支持 |
| Profit Report | 利润分析，v1.0 基础支持 |

## 14.2 报表下载流程

```text
进入指定页面
→ 设置日期范围
→ 设置店铺 / 站点 / ASIN 筛选
→ 点击导出
→ 等待下载完成
→ 校验文件完整性
→ 保存原始文件
→ 解析 Excel / CSV
→ 标准化字段
→ 写入 SQLite / DuckDB
→ 记录采集日志
```

## 14.3 字段映射

```json
{
  "search_term_report": {
    "搜索词": "search_term",
    "用户搜索词": "search_term",
    "Campaign": "campaign_name",
    "广告活动": "campaign_name",
    "点击": "clicks",
    "花费": "cost",
    "订单": "orders",
    "销售额": "sales",
    "ACOS": "acos"
  }
}
```

## 14.4 解析失败处理

| 情况 | 处理 |
|---|---|
| 非关键字段缺失 | 记录 warning，继续导入 |
| 关键字段缺失 | 文件导入失败 |
| 单行数据异常 | 跳过该行，记录错误 |
| 超过 5% 行失败 | 整个任务 failed |
| 字段名变化 | 触发字段映射维护 |
| 数值格式异常 | 尝试清洗，失败则记录 |

---

# 15. 本地数据库设计

## 15.1 SQLite 用途

SQLite 保存配置、规则、任务、建议、审批、日志、SKU 成本、Prompt 版本、页面模型版本、字段映射版本、AI 调用记录。

## 15.2 DuckDB 用途

DuckDB 用于大 CSV / Excel 报表分析、广告多周期聚合、Search Term 统计、Targeting 统计、SKU 销售趋势分析。如果数据量不大，也可以只用 SQLite，DuckDB 作为性能增强项。

## 15.3 核心表设计

```sql
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

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

# 16. AI 模型与规则引擎

## 16.1 一期模型策略

一期采用 OpenAI-compatible API。用户可在设置页配置 API Base URL、API Key、Model Name。这样可以兼容 OpenAI、DeepSeek、Qwen、Claude 中转、其他 OpenAI-compatible 服务。

## 16.2 无 AI Key 降级能力

| 功能 | 是否依赖 AI |
|---|---|
| 启动浏览器 | 否 |
| 登录检测 | 否 |
| 报表下载 | 否 |
| 字段解析 | 否 |
| 高点击无转化识别 | 否 |
| ACOS 规则判断 | 否 |
| bid 建议 | 否 |
| 否词建议初筛 | 否 |
| 搜索词语义相关性判断 | 是，可降级人工确认 |
| 日报自然语言总结 | 是 |
| 异常归因解释 | 是 |
| Listing 文案建议 | 是，后续版本 |

## 16.3 决策机制

```text
报表数据输入
→ 规则引擎生成候选建议
→ AI 判断语义相关性 / 生成解释
→ 规则引擎二次校验
→ 风险等级判定
→ 自动执行 / 人工确认 / 禁止
```

规则引擎拥有最终否决权。

## 16.4 Prompt 管理

Prompt 必须模板化、版本化、按任务类型拆分、记录调用版本、支持后续更新。一期 Prompt 类型：search_term_relevance_prompt、ad_action_reason_prompt、daily_report_prompt、profit_anomaly_prompt、inventory_risk_prompt、approval_summary_prompt。

---

# 17. 广告运营功能

## 17.1 广告数据分析指标

```text
impressions
clicks
cost
orders
sales
acos
cpc
cvr
campaign_name
ad_group_name
targeting
search_term
match_type
```

## 17.2 广告建议类型

| 建议类型 | 说明 |
|---|---|
| 添加精准否定关键词 | 高点击无转化 / 明显不相关搜索词 |
| 降低 bid | 高 ACOS / 高花费低转化 target |
| 提高 bid | 低 ACOS / 高转化 target，默认需确认 |
| 暂停 target | 长期无转化且非核心词 |
| 新增 Exact 关键词 | 出单搜索词迁移 |
| 调整预算 | 一期仅生成建议，不默认执行 |
| 生成广告日报 | 汇总广告表现与动作 |

## 17.3 搜索词否定规则

### 明显不相关词

条件：搜索词语义与产品明显不相关，不是品牌词，不是核心词白名单。动作：建议添加 Negative Exact。风险：自动允许或人工确认，取决于用户设置。

### 高点击无转化

默认条件：

```text
点击数 >= 20
订单数 = 0
花费 >= 产品售价的 50%
不是核心词白名单
不是品牌词白名单
```

动作：添加 Negative Exact 或降低 bid。Negative Exact 默认自动允许，Negative Phrase 必须确认。

## 17.4 bid 下调规则

默认条件：

```text
点击数 >= 20
订单数 = 0 或 ACOS > 目标 ACOS * 1.5
不是核心推排名词
不是新品推广重点词
```

动作：bid 下调 5%–10%。默认风险：自动允许，限幅。

## 17.5 bid 上调规则

默认条件：

```text
订单数 >= 2
ACOS < 目标 ACOS * 0.7
CVR 高于 SKU 平均值
库存可售天数 >= 30
当前 bid 未超过上限
```

动作：bid 上调 5%–10%。默认风险：人工确认。

## 17.6 自动否词数量限制

| 限制项 | 默认值 | 是否可配置 |
|---|---:|---|
| 单日单 SKU 自动否词数 | 20 | 可配置 |
| 单批自动否词数 | 50 | 可配置 |
| 单 Campaign 单日否词数 | 30 | 可配置 |
| 单店铺单日否词数 | 200 | 可配置 |

系统硬上限：单批自动否词 ≤100，单日单 SKU 自动否词 ≤50，单日单店铺自动否词 ≤500。

---

# 18. 库存功能

## 18.1 一期库存能力

一期只做基础库存预警，不做自动采购。

```text
读取库存报表
计算可售天数
识别低库存 SKU
识别紧急断货 SKU
识别滞销 SKU
生成补货建议
库存状态影响广告建议
```

## 18.2 可售天数计算

```text
可售天数 = FBA 可售库存 / 日均销量
```

日均销量取值：新品近 7 天权重更高；成熟品近 14 / 30 天综合；异常促销期标记异常；断货期排除断货天数。

## 18.3 库存风险等级

| 风险等级 | 条件 |
|---|---|
| 正常 | 可售天数 > 45 |
| 预警 | 30 < 可售天数 ≤ 45 |
| 紧急 | 15 < 可售天数 ≤ 30 |
| 高危 | 可售天数 ≤ 15 |
| 滞销 | 库存周转天数过长，阈值可配置 |

## 18.4 库存影响广告

| 库存状态 | 广告处理 |
|---|---|
| 正常 | 正常投放 |
| 预警 | 控制高 ACOS 广告 |
| 紧急 | 降低非核心广告 |
| 高危 | 只保留核心利润词或暂停推广型广告 |

---

# 19. 利润功能

## 19.1 成本数据来源

一期采用双轨：优先读取领星利润报表；缺失时允许用户维护 SKU 成本表。

| 优先级 | 来源 |
|---|---|
| 1 | 领星 ERP 利润报表 |
| 2 | 用户维护 SKU 成本表 |
| 3 | Excel 成本表导入 |
| 4 | 缺失则利润模块降级 |

## 19.2 利润公式

```text
净利润 = 销售额
       - 采购成本
       - 头程成本
       - 平台佣金
       - FBA 费用
       - 广告费
       - Coupon 成本
       - 退款损耗
       - 仓储费
       - 其他费用
```

```text
净利率 = 净利润 / 销售额
TACOS = 广告费 / 总销售额
ACOS = 广告费 / 广告销售额
```

## 19.3 成本缺失降级

| 缺失内容 | 降级方式 |
|---|---|
| 采购成本缺失 | 不计算净利润 |
| 头程成本缺失 | 标记利润不完整 |
| FBA 费用缺失 | 使用报表值；无报表则不估算 |
| 佣金缺失 | 不自动估算，除非配置费率 |
| Coupon 成本缺失 | 标记促销成本未知 |

成本缺失时仍可显示销售额、广告费、ACOS、TACOS、广告销售额、退款额、库存，但不做净利润判断、盈亏平衡 ACOS 判断、利润类自动动作。

---

# 20. 审批 / 确认机制

## 20.1 单机版审批定义

一期没有多人审批，改为本机人工确认。

```text
系统生成建议
→ 标记风险等级
→ 自动允许的直接执行
→ 需要确认的弹出确认卡片
→ 用户点击确认后执行
```

## 20.2 状态

```text
pending
approved
rejected
modified_approved
expired
cancelled
executed
failed
```

## 20.3 超时处理

一期不做复杂 SLA 自动流转。用户未确认则不执行；过期后标记 expired；第二天根据新数据重新生成建议。

---

# 21. 操作日志与审计

## 21.1 每个操作必须记录

```text
任务 ID
动作 ID
执行时间
店铺
站点
ASIN / MSKU
Campaign
Ad Group
Target / Search Term
动作类型
原始值
目标值
执行前截图
执行后截图
Trace 路径
页面 URL
执行状态
失败原因
规则命中原因
AI 解释
```

## 21.2 日志查看

UI 需要支持按日期筛选、按 ASIN 筛选、按动作类型筛选、按成功 / 失败筛选、查看操作前截图、查看操作后截图、打开 Trace 文件位置、导出日志、导出诊断包。

---

# 22. UI 功能

## 22.1 首页

展示 ERP 登录状态、今日采集状态、今日广告建议数量、今日可自动执行动作数量、今日需确认动作数量、库存风险 SKU 数、利润异常 SKU 数、最近一次任务结果、开始体检按钮、启动浏览器按钮。

## 22.2 ERP 登录检测页

功能：启动领星 ERP 浏览器、检测是否已登录、显示当前 URL、显示当前店铺 / 站点、显示权限检测结果、重新检测、清除登录态。

## 22.3 广告优化中心

字段：店铺、站点、ASIN / MSKU、Campaign、Ad Group、Target / Search Term、点击、花费、订单、销售额、ACOS、CPC、CVR、建议动作、建议值、风险等级、原因、状态。

操作：确认执行、拒绝、修改后执行、加入白名单、加入黑名单、查看证据、查看原始报表行。

## 22.4 规则设置

用户可配置目标 ACOS、目标 TACOS、点击无单阈值、花费阈值、bid 单次最大调整幅度、单日自动否词数量、单批自动否词数量、核心词白名单、品牌词白名单、自动执行开关。

## 22.5 系统诊断

提供：检测 ERP 可访问性、检测登录状态、检测浏览器是否可启动、检测本地存储空间、检测数据库状态、检测页面模型版本、检测字段映射版本、检测 AI Key 是否可用、重新启动浏览器、清除登录态、导出诊断包、清理本地缓存。

---

# 23. 报告功能

## 23.1 每日日报

日报包含今日销售概况、今日广告表现、今日广告建议、今日已执行动作、今日未执行动作、今日库存风险、今日利润异常、明日重点关注。

没有 AI Key 时，生成结构化日报；有 AI Key 时，生成自然语言总结。

## 23.2 周报

v1.0 可选，v1.1 完善。包含销售趋势、广告花费趋势、ACOS/TACOS 趋势、高效广告、低效广告、搜索词变化、库存风险变化、利润变化、下周建议。

---

# 24. 安全与风控

## 24.1 禁止采集

系统不得主动要求用户输入或上传亚马逊主账号密码、领星 ERP 密码、2FA 验证码、银行账户信息、收款账户信息、信用卡完整信息、浏览器 Cookie 明文。

## 24.2 禁止自动动作

一期明确禁止：自动破解验证码、自动重登账号、自动提交账号申诉、自动提交合规文件、自动修改 Listing 标题 / 主图 / 五点 / A+、自动合并 / 拆分变体、自动删除 Listing、自动修改品牌名、自动修改类目、自动大额调价、自动创建采购单并提交、自动创建 Deal / Coupon 并提交。

## 24.3 高风险动作

一期只生成建议，不执行：提高 Campaign 预算、大幅提高 bid、新建 Campaign、批量暂停广告、修改价格、创建补货单、修改 Listing。

---

# 25. 异常处理

## 25.1 异常类型

| 异常 | 处理 |
|---|---|
| 浏览器启动失败 | 提示重启软件 / 导出诊断包 |
| ERP 未登录 | 停止任务，提示登录 |
| Session 失效 | 停止任务，提示重新登录 |
| CAPTCHA / 滑块 | 停止任务，用户人工处理 |
| 页面模型失效 | 停止任务，截图并导出诊断 |
| 按钮找不到 | 停止，不盲点 |
| 多个同名按钮 | 停止，要求模型限定 |
| 下载失败 | 重试 1–2 次 |
| 报表字段缺失 | 导入失败或警告 |
| 写操作回读失败 | 标记失败，不继续批量任务 |

## 25.2 重试策略

| 动作 | 策略 |
|---|---|
| 页面加载 | 最多重试 2 次 |
| 报表下载 | 最多重试 2 次 |
| 数据解析 | 不重试，记录错误 |
| 写操作 | 默认不自动重试 |
| 批量操作 | 单个失败后暂停后续同类动作 |

---

# 26. 安装与更新

## 26.1 一期安装包

交付物：

```text
AmazonAIOpsAgent-Setup.exe
```

安装后生成桌面快捷方式、开始菜单入口、本地数据目录、内置运行环境。

## 26.2 环境自检

首次启动必须执行操作系统检测、存储空间检测、网络检测、浏览器启动检测、本地数据库初始化、资源文件完整性检测、AI 配置检测、ERP 访问检测。

## 26.3 自动更新

一期可以先做提示更新，不强制自动更新。后续支持主程序更新、页面模型更新、字段映射更新、Prompt 模板更新、广告规则更新。页面模型、字段映射、Prompt 必须具备版本号。

---

# 27. 版本规划

## v0.1｜本地浏览器验证版

目标：验证本地软件能控制领星 ERP。

功能：桌面软件雏形、启动可见浏览器、用户手动登录领星 ERP、检测登录态、读取页面标题 / URL、截图、保存本地日志。

验收：能打开领星 ERP，能保持登录态，能判断是否登录，能截图。

## v0.2｜报表采集版

目标：下载并解析广告报表。

功能：进入广告报表页面、选择日期范围、下载 Campaign / Targeting / Search Term 报表、解析 Excel / CSV、写入 SQLite / DuckDB、展示基础数据表。

验收：可下载最近 7 / 14 / 30 天广告报表，字段解析成功率 ≥95%，关键字段缺失时任务失败。

## v0.3｜广告建议版

目标：只生成建议，不执行。

功能：高点击无转化识别、高 ACOS 识别、低 ACOS 高转化识别、否词建议、bid 调整建议、暂停建议、建议原因说明、风险等级。

验收：每条建议有证据，每条建议有规则原因，可导出建议表。

## v0.4｜确认与执行版

目标：安全执行低风险动作。

功能：本机确认中心、自动允许动作、人工确认动作、精准否词执行、小幅降 bid 执行、暂停高浪费 target、执行前截图、执行后回读、操作日志。

验收：可成功执行至少 3 类广告动作，所有动作有前后值和截图，失败时停止后续写操作。

## v0.5｜单机可用版

目标：非技术用户可以安装使用。

功能：Windows 安装包、环境自检、本地数据目录管理、系统诊断、日志导出、本地备份、错误提示优化、页面模型版本管理、字段映射版本管理。

验收：普通用户无需命令行即可安装使用，连续运行 3 天不丢数据，错误能通过 UI 提示处理。

## v1.0｜单机正式版

目标：真实运营可用。

功能：广告分析闭环、低风险动作执行、人工确认执行、本地日报、库存基础预警、利润基础分析、本地备份恢复、诊断包导出、基础更新机制。

验收：连续运行 7 天，每日自动采集报表，每日生成广告建议，可执行低风险动作，所有动作可追踪，普通用户无需技术支持即可完成基础使用。

## v2.0｜团队 / 私有化预留版

当前不开发，只保留方向：PostgreSQL Adapter、多用户权限、局域网部署、多 Agent 管理、团队审批、集中日志。

## v3.0｜SaaS + Local Agent 预留版

当前不开发，只保留方向：云端 Web 后台、本地 Agent 连接云端、多租户、移动审批、云端数据库、对象存储、套餐计费。

---

# 28. 工程目录建议

```text
amazon-ai-ops-desktop/
├── apps/
│   └── desktop/
│       ├── main/                 # Electron main process
│       ├── renderer/             # React UI
│       └── preload/
│
├── packages/
│   ├── browser-worker/           # Playwright 控制
│   ├── page-models/              # 领星页面模型
│   ├── report-parser/            # Excel / CSV 解析
│   ├── rules-engine/             # 广告 / 库存 / 利润规则
│   ├── ai-engine/                # AI Provider + Prompt
│   ├── local-db/                 # SQLite / DuckDB
│   ├── action-executor/          # 动作执行
│   ├── audit-log/                # 日志 / 截图 / Trace
│   ├── scheduler/                # 本地任务调度
│   └── shared-types/             # 共享类型
│
├── resources/
│   ├── prompts/
│   ├── field-mappings/
│   ├── page-models/
│   └── default-rules/
│
├── docs/
│   ├── PRD.md
│   ├── DEV_SPEC.md
│   ├── PAGE_MODEL_GUIDE.md
│   └── USER_GUIDE.md
│
└── build/
```

---

# 29. 预留扩展点

虽然当前只做单机版，但代码必须保留抽象。

| 扩展点 | 当前实现 | 后续实现 |
|---|---|---|
| Database Adapter | SQLiteAdapter | PostgresAdapter |
| Storage Adapter | LocalStorageAdapter | S3 / OSS / MinIO Adapter |
| Task Queue Adapter | LocalTaskQueue | RedisTaskQueue / CloudTaskQueue |
| AI Provider Adapter | OpenAICompatibleProvider | LocalModelProvider / MultiProviderRouter |
| Auth Adapter | LocalUser | OrganizationUser / SaaSUser |
| Agent Communication | LocalIPC | WebSocket / Cloud API |

---

# 30. 测试计划

## 30.1 单元测试

覆盖字段映射、报表解析、ACOS 计算、TACOS 计算、bid 调整规则、否词规则、库存可售天数计算、利润计算、风险等级判断。

## 30.2 集成测试

覆盖下载报表 → 解析 → 入库 → 生成建议；确认动作 → 执行 → 回读 → 写日志；ERP 未登录 → blocked；页面模型失效 → 停止；字段缺失 → 导入失败。

## 30.3 E2E 测试

覆盖首次安装、启动浏览器、用户登录 ERP、下载广告报表、生成建议、确认执行否词、回读结果、查看日志、导出日报。

## 30.4 人工验收

必须人工验证页面识别是否准确、按钮点击是否准确、广告对象是否正确、回读结果是否正确、截图是否可用、错误提示是否能让普通用户理解。

---

# 31. 一期交付清单

v1.0 必须交付：

```text
1. Windows 桌面安装包
2. 本地可见浏览器控制
3. 领星 ERP 登录态检测
4. 广告报表下载
5. 报表字段解析
6. SQLite / DuckDB 本地存储
7. 广告规则引擎
8. AI Provider 配置
9. 广告优化建议中心
10. 本机确认中心
11. 精准否词执行
12. 小幅降 bid 执行
13. 暂停无效 target 执行
14. 操作前后截图
15. Trace 记录
16. 操作日志
17. 规则设置
18. 系统诊断
19. 本地备份
20. 用户使用说明
```

---

# 32. 一期不可做事项

```text
不做 Docker 用户部署
不做 PostgreSQL 用户安装
不做 Redis 用户安装
不做 SaaS
不做多租户
不做手机端
不做浏览器插件
不做复杂权限系统
不自动处理验证码
不自动重登
不自动提交申诉
不自动修改 Listing 核心信息
不自动批量大幅调价
不自动创建采购单并提交
不允许坐标盲点作为生产策略
```

---

# 33. 最终总结

当前阶段的正确路线是：

```text
先做单机版
把一个人、一台电脑、一个领星 ERP 登录环境跑稳定
通过广告自动分析与低风险执行验证价值
后续再扩展团队版和 SaaS
```

最终一期产品应表现为：

> 一个不会开发的人也能安装使用的 Windows 桌面 AI 运营助手。

核心用户动作只有：

```text
安装软件
打开软件
登录领星 ERP
点击开始
查看建议
确认执行
查看日志和日报
```

核心工程策略是：

```text
模块化单体
本地 SQLite / DuckDB
Playwright 可见浏览器
规则引擎优先
AI 辅助判断
高风险禁止自动
全部操作留痕
后续扩展接口预留
```

这份文档可直接作为单机版 MVP 的产品需求和 AI 开发需求输入。
