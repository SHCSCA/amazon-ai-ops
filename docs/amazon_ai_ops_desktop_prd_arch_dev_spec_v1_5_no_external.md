# Amazon AI Ops Agent 单机版｜PRD + 架构 + 开发需求文档 v1.5

## 文档信息

| 字段 | 内容 |
|---|---|
| 文档名称 | Amazon AI Ops Agent 单机版 PRD + 架构 + 开发需求文档 |
| 文档版本 | v1.5 |
| 版本定位 | v1.2 的增强版，新增“领星下载中心广告报告批量采集”与“搜索词/SQP → Listing 关键词机会分析”能力 |
| 当前产品形态 | Windows 单机桌面应用 |
| 后续预留形态 | 团队版 / 私有化部署版 / SaaS + Local Agent 版 |
| 当前明确不纳入 | Webhook、集简云、飞书、企业微信、Zapier、n8n、Amazon SP-API、Amazon Ads API |
| 核心场景 | 通过用户已登录的领星 ERP 浏览器与用户上传/导入报表，完成领星下载中心广告报告批量创建与下载、广告分析、报表采集、低风险广告操作、库存预警、利润分析、搜索词机会分析、Listing 优化建议与日报生成 |
| 核心原则 | 单机、本地、一键安装、可见浏览器、用户手动登录、操作留痕、高风险审批、不接外部自动化平台、不接亚马逊官方 API |
| 适用对象 | AI 开发、桌面端开发、浏览器自动化开发、前端开发、数据分析开发、测试工程师、产品经理 |

---

# 0. 本版修订说明

v1.5 基于 v1.2 单机版文档、系统架构文档与工程结构文档进行增量升级。

## 0.1 v1.5 新增重点

v1.5 新增核心模块：

```text
领星下载中心广告报告批量采集
→ 用户选择时间段
→ 批量创建广告活动 / 广告组 / 广告位 / 商品 / 自动投放 / 关键词 / 商品投放 / 用户搜索词报告
→ 下载并回显本地文件地址

Search Term / SQP / 关键词报表
→ 关键词机会识别
→ Listing 关键词覆盖分析
→ Listing 优化建议
→ 用户确认后手动应用
```

## 0.2 v1.5 保持不变的原则

```text
不做 SaaS
不做多租户
不做团队权限
不接 Amazon SP-API
不接 Amazon Ads API
不接 Webhook
不接集简云
不接飞书
不接企业微信
不接 Zapier / n8n
不做浏览器插件
不做手机端
不做 Docker 用户部署
不做 PostgreSQL / Redis 用户安装
```

## 0.3 v1.5 产品目标变化

v1.2 的重点是：

```text
广告报表采集
广告规则建议
低风险广告执行
库存 / 利润基础分析
日报
```

v1.5 在此基础上新增：

```text
通过领星下载中心批量创建和下载多类广告报告
把广告搜索词、SQP 报表、关键词表现数据反哺 Listing 优化
```

核心目标：

> 先降低用户采集广告报表的重复操作成本，再把下载到的广告搜索词、关键词、商品投放等数据转化为广告优化、关键词机会、Listing 优化与日报输入。

---

# 1. 产品定位

## 1.1 一句话定位

Amazon AI Ops Agent 是一个面向不会开发的亚马逊卖家的本地 AI 运营助手。用户安装 Windows 软件后，通过已登录的领星 ERP 浏览器与本地报表导入，让 AI 自动创建并下载领星广告报告、读取数据、分析广告、发现搜索词机会、生成 Listing 优化建议，并在用户授权范围内执行低风险广告操作。

## 1.2 当前版本定位

当前版本只做：

```text
单人
单机
Windows 桌面软件
本地数据存储
可见浏览器控制
领星 ERP 自动化
领星下载中心广告报告批量采集
广告运营闭环
搜索词机会分析
Listing 优化建议
本地报表导入 / 导出
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
Amazon SP-API
Amazon Ads API
Webhook
集简云
飞书
企业微信
Zapier
n8n
自动账号申诉
自动修改 Listing 核心信息
自动破解验证码
```

---

# 2. 用户使用流程

## 2.1 v1.0 基础流程

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

## 2.2 v1.5 新增关键词机会流程

```text
1. 用户导入 Search Term Report / SQP 报表 / 关键词报表
2. 系统解析关键词、搜索词、点击、加购、购买、ACOS、CVR 等数据
3. 系统识别高价值关键词
4. 系统对比当前 Listing 文案关键词覆盖情况
5. 系统输出标题、五点、A+、图片文案的关键词建议
6. 用户在软件内查看建议
7. 用户导出 Listing 优化建议表
8. 用户手动修改 Listing，系统不自动提交
```

## 2.3 v1.5 新增领星下载中心广告报告采集流程

```text
1. 用户点击“广告报告采集”
2. 用户选择报表时间段
3. 系统通过已登录的领星 ERP 浏览器进入下载中心
4. 系统按固定顺序逐个创建广告报告
5. 系统等待领星生成报告
6. 系统逐个下载已生成的报告文件
7. 系统校验文件是否存在、大小是否正常、文件名是否可识别
8. 系统在页面展示本次采集批次的本地文件夹地址
9. 用户可打开文件夹、复制路径、查看单个报表文件地址
10. 系统把下载文件交给报表解析器，进入广告分析、关键词机会与日报流程
```

本流程面向普通运营用户。用户只需要确认时间段，不需要理解领星下载中心的页面层级、文件命名、下载目录或后续解析过程。

### 2.3.1 需要批量创建和下载的报告

```text
广告活动报告
广告组报告
广告位报告
广告（推广的商品）报告
自动投放报告
关键词报告
商品投放报告
用户搜索词报告
```

### 2.3.2 用户角度评估

| 用户收益 | 说明 |
|---|---|
| 减少重复操作 | 用户不需要在领星下载中心为 8 类广告报告重复选择时间段、创建报告、等待生成、下载文件 |
| 降低漏下风险 | 系统按清单逐个创建并记录状态，避免运营人员漏下某一类关键报告 |
| 保证时间段一致 | 所有报告使用同一时间段，后续广告分析和关键词分析口径一致 |
| 过程可见 | 浏览器为可见模式，用户可以看到系统在领星中执行的步骤 |
| 结果可找回 | 下载完成后展示本地文件夹地址和单个文件地址，用户可以直接打开、复制、备份或发给同事 |
| 失败可重试 | 某个报告失败时只重试该报告，不要求用户重新下载全部报告 |

### 2.3.3 产品角度评估

领星下载中心广告报告采集不是独立下载工具，而是产品的数据入口。

```text
下载中心批量采集
→ 原始广告报告留存
→ 报表解析与字段标准化
→ 广告表现分析
→ 否词 / 调价 / 暂停建议
→ 关键词机会识别
→ Listing 覆盖分析
→ 日报 / 周报生成
```

该功能解决产品闭环中的“数据从哪里来”问题。相比只支持用户手动上传文件，下载中心批量采集可以让普通用户更稳定地获得广告活动、关键词、商品投放、用户搜索词等基础数据，从而提升后续 AI 分析的完整性和可信度。

---

# 3. v1.5 功能边界

## 3.1 v1.5 必做

```text
支持上传 Search Term Report
支持上传 SQP 类报表
支持上传关键词表现表
支持在领星下载中心按时间段批量创建广告报告
支持批量下载广告活动、广告组、广告位、广告（推广的商品）、自动投放、关键词、商品投放、用户搜索词报告
支持下载批次记录、单个报告状态记录、本地文件地址回显
支持关键词字段映射
支持关键词机会分层
支持当前 Listing 文案录入 / 导入
支持 Listing 关键词覆盖分析
支持 Listing 优化建议
支持建议导出为 Excel / CSV / Markdown
支持 AI 生成 Listing 修改草案
支持版本留痕
```

## 3.2 v1.5 不做

```text
不自动修改 Listing
不通过 API 更新标题 / 五点 / A+
不接 Amazon SP-API
不接 Amazon Ads API
不做 Webhook 推送
不接集简云 / 飞书 / 企业微信
不接 Zapier / n8n
不做多人审核流
不做移动端审批
不做浏览器插件
不绕过领星下载中心的正常报告生成流程
不把下载的原始广告报告自动上传到云端
```

## 3.3 v1.5 高风险边界

以下动作只能生成建议，不执行：

```text
修改 Listing 标题
修改 Bullet Points
修改 A+ 页面
修改主图
修改类目节点
修改价格
创建 Coupon / Deal
提交账号申诉
提交合规文件
```

---

# 4. 总体架构

## 4.1 单机版架构

```text
Windows 桌面应用
├── UI 层
│   ├── 首页
│   ├── ERP 登录检测
│   ├── 广告报告采集
│   ├── 广告优化中心
│   ├── 关键词机会中心
│   ├── Listing 优化建议
│   ├── 审批确认
│   ├── 操作日志
│   ├── 规则设置
│   └── 系统诊断
│
├── 业务层
│   ├── 本地任务调度器
│   ├── 报表采集器
│   ├── 领星下载中心报告采集器
│   ├── 报表解析器
│   ├── 广告规则引擎
│   ├── 库存规则引擎
│   ├── 利润计算引擎
│   ├── 关键词机会引擎
│   ├── Listing 覆盖分析引擎
│   ├── AI Provider 适配器
│   └── 动作执行器
│
├── 浏览器自动化层
│   ├── Playwright 控制器
│   ├── 页面模型
│   ├── 下载中心页面模型
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

## 4.2 技术栈

| 层级 | 技术 |
|---|---|
| 桌面端 | Electron + TypeScript |
| UI | React + TypeScript + Tailwind CSS |
| 浏览器自动化 | Playwright |
| 本地数据库 | SQLite / better-sqlite3 |
| 大报表分析 | DuckDB |
| Excel/CSV 解析 | SheetJS / ExcelJS / DuckDB CSV |
| 本地文件存储 | Windows 用户目录 |
| AI 接入 | OpenAI-compatible API |
| 本地任务调度 | 内置 Scheduler |
| 打包安装 | electron-builder |
| 日志 | SQLite 元数据 + 本地文件 |
| 截图 / Trace | Playwright Screenshot / Trace |

---

## 4.3 领星下载中心广告报告采集模块

该模块负责通过用户已登录的领星 ERP 浏览器，在领星下载中心创建并下载多类广告报告。它是报表采集器的一个具体实现，输出为本地原始报表文件和采集批次元数据。

### 4.3.1 模块职责

| 子模块 | 职责 |
|---|---|
| Download Center Page Model | 定义领星下载中心入口、报告分类、创建按钮、时间段控件、生成状态、下载按钮等定位规则 |
| Report Creation Runner | 按报告清单逐个选择报告类型、设置时间段、提交创建任务 |
| Report Status Poller | 等待报告生成完成，识别生成中、成功、失败、过期等状态 |
| Download Listener | 监听浏览器下载事件，保存文件到本地批次目录 |
| File Verifier | 校验文件存在、大小、扩展名、报告类型和时间段标识 |
| Batch Recorder | 写入采集批次、报告状态、文件路径、失败原因、截图与 Trace |

### 4.3.2 报告清单与系统用途

| 领星报告 | 系统用途 |
|---|---|
| 广告活动报告 | Campaign 维度预算、花费、销售额、ACOS、ROAS 分析 |
| 广告组报告 | 广告组维度表现聚合，辅助定位结构性问题 |
| 广告位报告 | Top of Search / Product Pages 等广告位表现判断 |
| 广告（推广的商品）报告 | 被推广 ASIN / SKU 的广告承接效果分析 |
| 自动投放报告 | 自动广告投放词和匹配类型表现分析 |
| 关键词报告 | 关键词出价、点击、转化、ACOS、否词和调价建议 |
| 商品投放报告 | ASIN / 商品定向表现分析，识别可暂停或加价的投放对象 |
| 用户搜索词报告 | 搜索词挖掘、否词、出单词迁移、关键词机会和 Listing 覆盖分析 |

### 4.3.3 采集状态

```text
pending       待创建
creating      创建中
created       已创建，等待生成
ready         已生成，可下载
downloading   下载中
downloaded    已下载并校验成功
failed        创建或下载失败
skipped       用户跳过或报告不可用
```

失败处理原则：

```text
单个报告失败不阻断其他报告下载
失败报告最多自动重试 2 次
重试仍失败时记录原因、截图、DOM snapshot 和 Trace
任务结束后向用户展示成功数量、失败数量、失败报告名称和可重试入口
```

### 4.3.4 下载后的数据流

```text
原始下载文件
→ 保存到批次目录
→ 写入采集批次记录
→ Report Parser 读取文件
→ 字段映射与标准化
→ SQLite 保存原始元数据和采集日志
→ DuckDB 保存可分析明细
→ 广告规则引擎 / 关键词机会引擎 / Listing 覆盖分析引擎消费数据
```

下载文件不只是给用户保存，也会成为系统后续分析的输入。系统必须保留原始文件路径，便于用户复核 AI 建议对应的原始证据。

---

# 5. v1.5 新增模块：关键词机会中心

## 5.1 模块目标

关键词机会中心用于把广告搜索词、SQP 报表、搜索词表现数据转化为可执行的 Listing 优化建议。

核心问题：

```text
哪些词带来了转化？
哪些词有高点击但 Listing 承接差？
哪些词有高加购但低购买？
哪些词应该进入标题 / 五点 / A+ / 图片文案？
哪些词应继续广告测试？
哪些词应该否定或降价？
```

## 5.2 支持的数据来源

v1.5 只支持本地文件导入与领星 ERP 导出，不接 API。

| 数据来源 | 方式 | 是否支持 |
|---|---|---|
| 领星下载中心广告报告 | ERP 下载中心批量创建 / 下载 | 支持 |
| 领星广告搜索词报告 | ERP 下载 / 用户导入 | 支持 |
| Amazon Search Term Report | 用户导入 | 支持 |
| SQP 报表 | 用户导入 | 支持 |
| 关键词调研表 | 用户导入 | 支持 |
| 当前 Listing 文案 | 用户手动录入 / 文件导入 | 支持 |
| Amazon SP-API | API 自动拉取 | 不支持 |
| Amazon Ads API | API 自动拉取 | 不支持 |

## 5.3 支持文件格式

```text
.csv
.xlsx
.xls
.tsv
.txt
```

## 5.4 关键词机会中心 UI

页面字段：

```text
关键词 / 搜索词
ASIN / MSKU
来源报表
曝光 / 展示
点击
点击率
加购
加购率
订单 / 购买
购买率
广告花费
销售额
ACOS
CPC
CVR
搜索热度 / Query Volume
Query Score
当前 Listing 是否覆盖
建议位置
建议动作
机会等级
风险等级
证据说明
```

操作：

```text
导入报表
选择字段映射
运行关键词分析
查看关键词机会
加入标题建议
加入五点建议
加入 A+ 建议
加入图片文案建议
标记已使用
标记忽略
加入观察
导出建议表
```

---

# 6. v1.5 新增模块：SQP / 搜索词报表解析

## 6.1 SQP 字段映射

SQP 类报表可能包含以下字段，系统需要支持中英文别名映射。

```json
{
  "search_query": ["searchQuery", "Search Query", "搜索查询", "搜索词", "关键词"],
  "query_score": ["searchQueryScore", "Query Score", "搜索词得分", "查询得分"],
  "query_volume": ["searchQueryVolume", "Query Volume", "搜索量", "查询量"],
  "impressions": ["impressions", "展示量", "曝光量"],
  "clicks": ["clicks", "点击量"],
  "cart_adds": ["cartAdds", "加购数", "加购"],
  "purchases": ["purchases", "购买数", "订单数"],
  "click_rate": ["clickRate", "点击率"],
  "cart_add_rate": ["cartAddRate", "加购率"],
  "purchase_rate": ["purchaseRate", "购买率", "转化率"],
  "asin_click_share": ["asinClickShare", "ASIN点击份额"],
  "asin_cart_add_share": ["asinCartAddShare", "ASIN加购份额"],
  "asin_purchase_share": ["asinPurchaseShare", "ASIN购买份额"]
}
```

## 6.2 Search Term Report 字段映射

```json
{
  "search_term": ["搜索词", "用户搜索词", "Customer Search Term", "Search Term"],
  "campaign_name": ["Campaign", "广告活动"],
  "ad_group_name": ["Ad Group", "广告组"],
  "targeting": ["Targeting", "投放词", "关键词"],
  "match_type": ["Match Type", "匹配方式"],
  "impressions": ["Impressions", "曝光", "展示"],
  "clicks": ["Clicks", "点击"],
  "cost": ["Spend", "Cost", "花费"],
  "orders": ["Orders", "订单"],
  "sales": ["Sales", "销售额"],
  "acos": ["ACOS"],
  "cpc": ["CPC"],
  "cvr": ["CVR", "Conversion Rate", "转化率"]
}
```

## 6.3 解析失败处理

| 情况 | 处理 |
|---|---|
| 关键字段缺失 | 提示用户手动映射 |
| 非关键字段缺失 | 继续导入并标记 warning |
| 字段名未知 | 进入字段映射确认页 |
| 数据类型异常 | 尝试清洗，失败则记录错误行 |
| 超过 5% 行失败 | 整个导入任务失败 |
| 重复报表导入 | 提示覆盖 / 合并 / 跳过 |

---

# 7. v1.5 新增模块：Listing 关键词覆盖分析

## 7.1 当前 Listing 输入方式

v1.5 不自动从 Amazon 后台拉取 Listing。支持以下方式：

```text
用户手动复制标题
用户手动复制五点
用户手动复制描述
用户手动复制 A+ 文案
用户导入 Listing 文案 Excel
用户从领星 ERP 页面读取可见内容，若页面模型支持
```

## 7.2 Listing 内容结构

```text
Title
Bullet Point 1
Bullet Point 2
Bullet Point 3
Bullet Point 4
Bullet Point 5
Product Description
A+ Module Text
Image Text / Infographic Text
Backend Search Terms，若用户提供
```

## 7.3 覆盖分析指标

| 指标 | 说明 |
|---|---|
| 是否完全覆盖 | 关键词完整出现在 Listing 文案中 |
| 是否部分覆盖 | 关键词部分词根或词组出现 |
| 覆盖位置 | Title / Bullet / Description / A+ / Image Text |
| 覆盖强度 | 标题最高，其次五点、图片文案、A+、描述 |
| 重复程度 | 是否过度堆词 |
| 语义相关性 | AI 判断是否与产品强相关 |
| 商业价值 | 按订单、CVR、购买率、Query Score 等计算 |
| 建议位置 | 应放入标题 / 五点 / A+ / 图片文案 / 仅观察 |

## 7.4 覆盖状态

```text
covered_title
covered_bullet
covered_description
covered_aplus
covered_image_text
partially_covered
not_covered
irrelevant
needs_review
```

---

# 8. v1.5 新增模块：关键词机会评分

## 8.1 机会评分公式

系统需要生成 0–100 分的 Keyword Opportunity Score。

基础公式：

```text
Keyword Opportunity Score =
  转化表现分 * 0.35
+ 搜索需求分 * 0.20
+ 广告验证分 * 0.20
+ Listing 未覆盖分 * 0.15
+ 相关性分 * 0.10
```

## 8.2 分项说明

| 分项 | 数据来源 | 说明 |
|---|---|---|
| 转化表现分 | Orders / CVR / Purchase Rate | 词是否真实带来购买 |
| 搜索需求分 | Query Volume / Impressions | 词是否有足够搜索量 |
| 广告验证分 | ACOS / CPC / Sales | 词是否在广告中验证过 |
| Listing 未覆盖分 | Listing Coverage | 未覆盖但高价值则分高 |
| 相关性分 | AI / 词库 / 人工确认 | 词是否适合产品 |

## 8.3 机会等级

| 分数 | 等级 | 含义 |
|---:|---|---|
| 80–100 | A | 高优先级，应进入 Listing 或重点广告测试 |
| 60–79 | B | 中高优先级，建议进入五点/A+或继续观察 |
| 40–59 | C | 低优先级，仅观察或广告小预算测试 |
| 0–39 | D | 不建议使用或相关性不足 |

## 8.4 特殊规则

```text
如果词不相关，直接降为 D
如果词包含竞品品牌名，不建议进入 Listing
如果词转化高但 ACOS 极高，只建议继续广告测试，不建议立即进入标题
如果词购买率高且 Listing 未覆盖，优先建议进入五点或 A+
如果词搜索量大但转化差，建议优化图片文案或暂不采纳
```

---

# 9. v1.5 新增模块：Listing 优化建议

## 9.1 建议类型

| 建议类型 | 说明 |
|---|---|
| Title Keyword Suggestion | 建议进入标题 |
| Bullet Keyword Suggestion | 建议进入五点 |
| A+ Keyword Suggestion | 建议进入 A+ 文案 |
| Image Text Suggestion | 建议进入图片文案 |
| Backend Term Suggestion | 建议进入后台搜索词，仅在用户提供相关字段时 |
| Observe Keyword | 建议观察 |
| Reject Keyword | 不建议使用 |
| Ad Test Keyword | 建议广告继续测试 |

## 9.2 标题建议规则

标题建议必须谨慎。

默认只推荐：

```text
机会等级 A
相关性强
非竞品品牌词
非侵权风险词
有订单或高购买率证据
当前标题未覆盖
不会造成标题明显堆词
```

输出格式：

```text
建议加入标题的词：
- keyword
原因：
- 过去 14/30 天订单表现
- 当前标题未覆盖
- 与产品核心场景相关
风险：
- 是否可能过度堆词
- 是否涉及竞品品牌
```

## 9.3 五点建议规则

五点可承接更多长尾词。

适合：

```text
场景词
痛点词
材质词
尺寸词
功能词
适用人群词
高转化长尾词
```

输出格式：

```text
建议加入 Bullet 1：功能核心词
建议加入 Bullet 2：场景词
建议加入 Bullet 3：痛点词
建议加入 Bullet 4：规格/兼容词
建议加入 Bullet 5：售后/安装/使用词
```

## 9.4 图片文案建议规则

适合：

```text
高点击低转化词
痛点强的词
场景词
卖点差异词
买家误解词
```

输出：

```text
图片主题建议
图片标题文案
图片辅助文案
需要表达的卖点
对应搜索词证据
```

## 9.5 A+ 建议规则

适合：

```text
解释型关键词
品牌故事类关键词
使用场景关键词
对比型关键词
安装/规格/兼容性关键词
```

---

# 10. v1.5 Listing 草案生成

## 10.1 AI 生成内容范围

有 AI Key 时，系统可生成：

```text
标题修改草案
五点修改草案
A+ 模块文案草案
图片文案草案
关键词插入建议
```

## 10.2 生成原则

```text
不自动提交
不覆盖原文
保留修改前版本
标注新增关键词
标注删除/替换内容
给出修改理由
给出风险提示
```

## 10.3 文案输出结构

```json
{
  "asin": "B0XXXX",
  "section": "bullet_1",
  "original_text": "...",
  "suggested_text": "...",
  "inserted_keywords": ["keyword1", "keyword2"],
  "evidence": [
    {
      "keyword": "keyword1",
      "orders": 3,
      "cvr": 0.18,
      "source": "search_term_report"
    }
  ],
  "risk_notes": [
    "请确认是否符合亚马逊类目规范",
    "请确认是否不涉及竞品品牌词"
  ]
}
```

---

# 11. v1.5 数据库新增表

## 11.1 keyword_metrics

```sql
CREATE TABLE keyword_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_task_id TEXT,
  source_type TEXT,
  date_range_start TEXT,
  date_range_end TEXT,
  store_name TEXT,
  marketplace_code TEXT,
  asin TEXT,
  msku TEXT,
  keyword TEXT,
  normalized_keyword TEXT,
  impressions INTEGER,
  clicks INTEGER,
  click_rate REAL,
  cart_adds INTEGER,
  cart_add_rate REAL,
  purchases INTEGER,
  purchase_rate REAL,
  orders INTEGER,
  sales REAL,
  cost REAL,
  acos REAL,
  cpc REAL,
  cvr REAL,
  query_score REAL,
  query_volume REAL,
  asin_click_share REAL,
  asin_cart_add_share REAL,
  asin_purchase_share REAL,
  source_file TEXT,
  created_at TEXT
);
```

## 11.2 listing_content

```sql
CREATE TABLE listing_content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asin TEXT,
  marketplace_code TEXT,
  store_name TEXT,
  title TEXT,
  bullet_1 TEXT,
  bullet_2 TEXT,
  bullet_3 TEXT,
  bullet_4 TEXT,
  bullet_5 TEXT,
  description TEXT,
  aplus_text TEXT,
  image_text TEXT,
  backend_terms TEXT,
  version TEXT,
  source TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

## 11.3 keyword_coverage

```sql
CREATE TABLE keyword_coverage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asin TEXT,
  keyword TEXT,
  normalized_keyword TEXT,
  coverage_status TEXT,
  covered_in_title INTEGER,
  covered_in_bullet INTEGER,
  covered_in_description INTEGER,
  covered_in_aplus INTEGER,
  covered_in_image_text INTEGER,
  covered_in_backend_terms INTEGER,
  coverage_score REAL,
  created_at TEXT
);
```

## 11.4 keyword_opportunities

```sql
CREATE TABLE keyword_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asin TEXT,
  msku TEXT,
  marketplace_code TEXT,
  keyword TEXT,
  normalized_keyword TEXT,
  opportunity_score REAL,
  opportunity_level TEXT,
  recommended_section TEXT,
  recommended_action TEXT,
  reason TEXT,
  evidence_json TEXT,
  risk_level TEXT,
  status TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

## 11.5 listing_suggestions

```sql
CREATE TABLE listing_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asin TEXT,
  section TEXT,
  original_text TEXT,
  suggested_text TEXT,
  inserted_keywords TEXT,
  evidence_json TEXT,
  risk_notes TEXT,
  status TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

## 11.6 lingxing_report_batches

记录每次从领星下载中心创建和下载广告报告的采集批次。

```sql
CREATE TABLE lingxing_report_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT UNIQUE NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  source TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  total_reports INTEGER NOT NULL,
  downloaded_reports INTEGER NOT NULL,
  failed_reports INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

## 11.7 lingxing_report_files

记录每个报告文件的下载状态、本地地址和后续解析状态。

```sql
CREATE TABLE lingxing_report_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  report_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL,
  file_name TEXT,
  file_path TEXT,
  file_size_bytes INTEGER,
  checksum TEXT,
  parse_status TEXT,
  parsed_rows INTEGER,
  error_message TEXT,
  downloaded_at TEXT,
  parsed_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

系统分析结果需要保留 `batch_id` 与 `report_type`，用于把广告建议、关键词机会和日报中的证据回链到原始文件。

---

# 12. v1.5 新增 Prompt

## 12.1 search_keyword_opportunity_prompt

用途：

```text
判断搜索词是否值得进入 Listing，以及适合进入哪个模块。
```

输入：

```json
{
  "product_title": "...",
  "product_category": "...",
  "keyword": "...",
  "metrics": {
    "orders": 3,
    "cvr": 0.18,
    "acos": 0.22,
    "query_score": 78
  },
  "current_coverage": {
    "title": false,
    "bullet": true,
    "aplus": false
  }
}
```

输出：

```json
{
  "is_relevant": true,
  "recommended_section": "bullet",
  "priority": "A",
  "reason": "...",
  "risk_notes": []
}
```

## 12.2 listing_rewrite_prompt

用途：

```text
在不改变产品事实、不引入违规词、不堆砌关键词的前提下，生成 Listing 文案修改草案。
```

输出必须包含：

```text
原文
建议文案
新增关键词
证据
风险提示
```

## 12.3 keyword_risk_prompt

用途：

```text
识别竞品品牌词、侵权风险词、不相关词、误导性词。
```

---

# 13. v1.5 UI 新增页面

## 13.1 广告报告采集页

入口：

```text
左侧菜单：广告报告采集
首页快捷按钮：采集广告报告
广告优化中心空数据状态：去采集报告
关键词机会中心空数据状态：去采集用户搜索词报告
```

页面区域：

```text
时间段选择器
报告清单
采集进度
下载结果
失败报告重试入口
本地文件夹地址
单个文件地址列表
打开文件夹按钮
复制路径按钮
进入分析按钮
```

报告清单默认全选：

```text
广告活动报告
广告组报告
广告位报告
广告（推广的商品）报告
自动投放报告
关键词报告
商品投放报告
用户搜索词报告
```

用户可以取消勾选暂时不需要的报告，但系统需要提示：

```text
缺少用户搜索词报告会影响否词建议、出单词迁移和 Listing 关键词机会分析。
缺少关键词报告会影响关键词 bid 分析和关键词表现判断。
缺少商品投放报告会影响 ASIN 定向表现分析。
```

下载完成后展示：

```text
本次采集时间段
本次采集批次 ID
成功下载数量
失败报告数量
本地文件夹地址
每个报告的文件名、文件大小、下载时间、文件路径
```

用户可执行：

```text
打开文件夹
复制批次路径
复制单个文件路径
重新下载失败报告
用本批次数据开始分析
```

## 13.2 关键词机会中心

入口：

```text
左侧菜单：关键词机会
```

页面区域：

```text
导入区
字段映射区
关键词机会列表
筛选器
机会详情
导出按钮
```

筛选器：

```text
ASIN
来源报表
机会等级
建议位置
覆盖状态
是否有订单
是否高购买率
是否未覆盖
是否需要人工确认
```

## 13.3 Listing 覆盖分析页

展示：

```text
当前 Listing 文案
关键词覆盖热力图
未覆盖高价值词
已覆盖高价值词
过度重复词
建议补充位置
```

## 13.4 Listing 建议详情页

展示：

```text
原文
建议文案
新增关键词
对应证据
风险提示
导出按钮
复制按钮
标记已采纳
标记忽略
```

---

# 14. v1.5 导出能力

当前不做任何外部平台兼容，只做本地导出。

## 14.1 支持导出格式

```text
Excel
CSV
Markdown
JSON
```

## 14.2 导出内容

```text
关键词机会表
Listing 覆盖分析表
标题修改建议
五点修改建议
A+ 文案建议
图片文案建议
关键词证据表
风险词清单
```

## 14.3 导出目录

```text
C:\Users\<User>\AmazonAIOps\storage\exports\
```

## 14.4 领星广告报告下载目录

领星下载中心下载的原始广告报告必须保存在独立目录，不与系统导出的建议表混放。

```text
C:\Users\<User>\AmazonAIOps\storage\downloads\lingxing-ad-reports\<start_date>_<end_date>\<batch_id>\
```

示例：

```text
C:\Users\zhangsan\AmazonAIOps\storage\downloads\lingxing-ad-reports\2026-05-01_2026-05-25\batch_20260525_093012\
```

批次目录下按报告类型保存原始文件：

```text
ad_campaign_report.xlsx
ad_group_report.xlsx
ad_placement_report.xlsx
ad_promoted_product_report.xlsx
auto_targeting_report.xlsx
keyword_report.xlsx
product_targeting_report.xlsx
user_search_term_report.xlsx
manifest.json
```

`manifest.json` 用于记录本次下载结果：

```json
{
  "batch_id": "batch_20260525_093012",
  "date_range": {
    "start": "2026-05-01",
    "end": "2026-05-25"
  },
  "source": "lingxing_download_center",
  "folder_path": "C:\\Users\\zhangsan\\AmazonAIOps\\storage\\downloads\\lingxing-ad-reports\\2026-05-01_2026-05-25\\batch_20260525_093012",
  "reports": [
    {
      "type": "user_search_term_report",
      "display_name": "用户搜索词报告",
      "status": "downloaded",
      "file_path": "C:\\Users\\zhangsan\\AmazonAIOps\\storage\\downloads\\lingxing-ad-reports\\2026-05-01_2026-05-25\\batch_20260525_093012\\user_search_term_report.xlsx",
      "file_size_bytes": 2048576
    }
  ]
}
```

## 14.5 用户可见的下载地址

每次采集完成后，系统必须把下载地址明确给到用户。

UI 必须展示：

```text
本次下载文件夹地址
每个报告的本地文件地址
打开文件夹按钮
复制文件夹地址按钮
复制单个文件地址按钮
```

当部分报告失败时，仍然展示成功文件的地址，同时标记失败报告：

```text
已下载：6 个
失败：2 个
文件夹：C:\Users\<User>\AmazonAIOps\storage\downloads\lingxing-ad-reports\2026-05-01_2026-05-25\batch_20260525_093012\
```

系统后续分析引用 AI 建议证据时，需要能回链到：

```text
采集批次 ID
报告类型
原始文件路径
原始行号或原始记录标识
解析后的标准化字段
```

---

# 15. v1.5 风控规则

## 15.1 禁止自动动作

```text
禁止自动修改 Listing
禁止自动提交 Listing
禁止自动调用 Amazon API
禁止自动调用第三方自动化平台
禁止自动创建外部任务
禁止自动发布到飞书 / 企业微信 / 集简云
```

## 15.2 风险词识别

系统需要识别并提示：

```text
竞品品牌词
侵权风险词
绝对化词
医疗功效词
虚假承诺词
不符合产品事实的词
与产品无关的高流量词
```

## 15.3 人工确认

以下建议必须人工确认：

```text
加入标题
加入五点
加入 A+
加入图片文案
加入后台搜索词
```

---

# 16. v1.5 工程结构调整

在 v1.2 工程结构基础上新增：

```text
packages/
├── lingxing-report-collector/
│   ├── src/
│   │   ├── report-types.ts
│   │   ├── batch-runner.ts
│   │   ├── download-center-page.ts
│   │   ├── status-poller.ts
│   │   ├── file-verifier.ts
│   │   ├── manifest.ts
│   │   └── index.ts
│   └── package.json
│
├── keyword-opportunity/
│   ├── src/
│   │   ├── engine.ts
│   │   ├── scoring.ts
│   │   ├── normalizer.ts
│   │   ├── relevance.ts
│   │   ├── risk-checker.ts
│   │   └── index.ts
│   └── package.json
│
├── listing-analyzer/
│   ├── src/
│   │   ├── coverage.ts
│   │   ├── rewrite.ts
│   │   ├── section-recommender.ts
│   │   ├── export.ts
│   │   └── index.ts
│   └── package.json
│
resources/
├── prompts/
│   ├── search-keyword-opportunity.md
│   ├── listing-rewrite.md
│   └── keyword-risk.md
│
├── field-mappings/
│   ├── lingxing-ad-report-mapping.json
│   ├── sqp-report-mapping.json
│   ├── search-term-report-mapping.json
│   └── listing-content-mapping.json
│
├── page-models/
│   └── lingxing-download-center.json
```

Renderer 新增页面：

```text
apps/desktop/src/renderer/pages/
├── AdReportCollector/
├── KeywordOpportunity/
├── ListingCoverage/
└── ListingSuggestions/
```

IPC 新增：

```text
apps/desktop/src/main/ipc/
├── report-collector-handlers.ts
├── keyword-handlers.ts
└── listing-handlers.ts
```

---

# 17. v1.5 版本规划

## 17.1 v1.1｜报表导入增强版

目标：

```text
增强本地文件导入能力，为 v1.5 关键词机会模块打基础。
```

功能：

```text
支持用户上传 Search Term Report
支持字段映射确认
支持导入任务记录
支持错误行导出
支持重复文件处理
```

## 17.2 v1.2｜当前基础稳定版

目标：

```text
完成单机版广告、库存、利润、日志、规则基础闭环。
```

## 17.3 v1.3｜关键词数据模型版

目标：

```text
建立关键词指标数据结构。
```

功能：

```text
keyword_metrics 表
关键词归一化
关键词去重
搜索词来源标记
多报表合并
```

## 17.4 v1.4｜Listing 覆盖分析版

目标：

```text
将关键词和当前 Listing 文案建立关联。
```

功能：

```text
Listing 文案录入
关键词覆盖检测
覆盖位置识别
覆盖强度评分
未覆盖高价值词识别
```

## 17.5 v1.5｜关键词机会与 Listing 建议版

目标：

```text
完成领星广告报告采集 → Search Term / SQP → Listing 优化建议闭环。
```

功能：

```text
领星下载中心批量创建广告报告
8 类广告报告下载与本地地址回显
下载批次记录与原始文件留存
关键词机会评分
关键词机会等级
Listing 建议位置
AI 生成修改草案
导出优化建议
人工标记采纳 / 忽略
```

验收标准：

```text
可选择时间段并创建 8 类领星广告报告
可下载成功报告并展示本地文件夹地址
每个下载文件有报告类型、文件路径和状态记录
可导入至少 2 类关键词报表
可识别高价值未覆盖关键词
可生成标题 / 五点 / A+ / 图片文案建议
每条建议有数据证据
每条建议有风险提示
不会自动修改 Listing
可导出建议表
```

---

# 18. v1.5 测试计划

## 18.1 单元测试

覆盖：

```text
领星报告类型清单
采集批次目录生成
manifest.json 生成
报告文件状态流转
关键词归一化
字段映射
SQP 报表解析
Search Term Report 解析
机会评分
覆盖检测
风险词识别
建议位置判断
```

## 18.2 集成测试

覆盖：

```text
选择时间段 → 创建领星下载中心报告 → 下载文件 → 生成批次记录
下载文件 → 校验 → 保存本地地址 → 解析 → 入库
上传报表 → 字段映射 → 解析 → 入库 → 机会评分
Listing 文案录入 → 覆盖分析 → 未覆盖词识别
关键词机会 → AI 建议 → 导出建议表
```

## 18.3 E2E 测试

覆盖：

```text
用户选择时间段
系统进入领星下载中心
系统逐个创建 8 类广告报告
系统下载成功报告并展示本地文件夹地址
用户打开文件夹并看到原始报告文件
用户导入 Search Term Report
用户导入当前 Listing 文案
系统识别高价值未覆盖词
系统生成五点优化建议
用户导出 Excel
用户标记已采纳
```

## 18.4 人工验收

必须人工验证：

```text
领星下载中心入口和报告名称是否与真实页面一致
时间段是否正确应用到每个报告
下载地址是否能被用户复制和打开
失败报告是否清晰提示并支持单独重试
关键词机会是否符合运营常识
Listing 建议是否不堆词
是否误用竞品品牌词
是否引入虚假卖点
导出表是否可直接给运营使用
```

---

# 19. v1.5 交付清单

```text
1. 关键词机会中心页面
2. 广告报告采集页面
3. 领星下载中心页面模型
4. 8 类广告报告批量创建与下载
5. 下载批次目录与 manifest.json
6. 用户可见的本地文件夹地址与单文件地址
7. SQP / Search Term Report 导入
8. 字段映射确认
9. lingxing_report_batches 数据表
10. lingxing_report_files 数据表
11. keyword_metrics 数据表
12. listing_content 数据表
13. keyword_coverage 数据表
14. keyword_opportunities 数据表
15. listing_suggestions 数据表
16. 关键词归一化模块
17. 关键词机会评分模块
18. Listing 覆盖分析模块
19. Listing 建议生成模块
20. AI Prompt：关键词机会判断
21. AI Prompt：Listing 改写
22. AI Prompt：风险词识别
23. Excel / CSV / Markdown 导出
24. 人工采纳 / 忽略标记
25. 单元测试与 E2E 测试
26. 用户说明文档
```

---

# 20. v1.5 不可做事项

```text
不接 Webhook
不接集简云
不接飞书
不接企业微信
不接 Zapier
不接 n8n
不接 Amazon SP-API
不接 Amazon Ads API
不自动修改 Listing
不自动提交 Listing
不自动创建外部流程
不做团队审批
不做移动端
不做浏览器插件
不做云端同步
```

---

# 21. 最终总结

v1.5 的重点不是外部集成，而是增强单机产品本身的运营价值。

v1.0 解决：

```text
广告数据分析
广告低风险动作执行
库存 / 利润基础分析
日报与日志
```

v1.5 解决：

```text
搜索词数据如何反哺 Listing
高价值关键词是否被 Listing 承接
哪些词应该进入标题 / 五点 / A+ / 图片文案
如何给运营输出可采纳的 Listing 修改建议
```

产品仍然坚持：

```text
单机
本地
一键安装
不接外部自动化平台
不接 Amazon API
不自动改 Listing
全部建议可解释、可导出、可人工确认
```

最终 v1.5 应表现为：

> 一个能从广告搜索词和 SQP 报表中发现 Listing 增长机会的本地 AI 亚马逊运营助手。
