# Amazon AI Ops Agent 产品需求文档（PRD）v1.6.0

> **文档状态：Draft / Proposed**
>
> 本文档定义 Amazon AI Ops Agent 的下一目标产品版本 `v1.6.0`，不代表该版本已经实现、打包、验收或可交付。当前生产基线仍为 `v1.5.1 APP_NEEDS_WORK / INTERNAL NON_READY`。任何历史源码测试、静态构建、Package UI、真实业务或 Ads 证据均不得自动继承为 v1.6.0 验收信用。

---

## 0. 文档控制

### 0.1 文档信息

| 字段 | 内容 |
|---|---|
| 产品名称 | Amazon AI Ops Agent |
| 文档名称 | Amazon AI Ops Agent 产品需求文档（PRD） |
| 目标产品版本 | `v1.6.0` |
| 文档版本 | `1.1` |
| 文档状态 | `Draft / Proposed` |
| 文档日期 | `2026-09-01` |
| 当前实现基线 | `v1.5.1 APP_NEEDS_WORK / INTERNAL NON_READY` |
| 产品形态 | Windows 本地优先 Electron 桌面应用 |
| 目标用户 | 单个 Amazon 运营操作者 / 卖家 |
| 当前市场范围 | Amazon United States / USD |
| 主要数据入口 | 真实领星 ERP 广告报表、本地正式导入、可见浏览器回读 |
| 主要执行入口 | 用户已登录的可见 Amazon Ads UI |
| 文档负责人 | Product / Engineering |
| 评审对象 | 产品、UX、研发、测试、安全评审、交付验证 |
| 文档用途 | 产品设计、UX、研发、测试、安全评审、交付验收的统一需求事实源 |

### 0.2 版本关系

| 版本 | 定位 | 与本文档的关系 |
|---|---|---|
| v1.5 | 报表采集、关键词机会和 Listing 建议基础版本 | 保留历史需求与基础能力定义 |
| v1.5.1 | 当前静态 Windows 候选，Mission/Authority/Safety 链已大幅收紧 | v1.6.0 的实现基线，但仍无当前包完整运行态签收 |
| v1.6.0 | 六业务模块、Analysis Run、Mission、Decision、Grant、Execution、Experiment、Memory 的统一产品版本 | 本文档定义的目标版本 |

### 0.3 文档解释规则

本文档采用以下需求等级：

| 等级 | 定义 | 发布含义 |
|---|---|---|
| **MUST** | v1.6.0 必须满足的产品或安全合同 | 任一对应验收项未通过，版本不得声明 `APP_READY` |
| **SHOULD** | 应在 v1.6.0 完成的体验或质量目标 | 未完成必须记录明确偏差、风险与后续版本，不得静默降级 |
| **FUTURE** | 明确不属于 v1.6.0 的预留方向 | 不得以隐藏开关或未验收能力混入当前发布 |

其他解释原则：

1. 产品目标、实现进度和验收信用是三个不同概念。
2. 原型只用于表达产品方向，不是生产数据、生产行为或交付证据。
3. Renderer 展示不是权限事实；Main、SQLite、当前 StoreContext 与追加式证据记录才是生产权威。
4. 无法证明满足某项 MUST 时，结果必须是 `BLOCKED`、`UNKNOWN`、`APP_NEEDS_WORK` 或对应非成功状态，不能以默认值推断成功。
5. 本文档使用的 `Analysis Run`、`MissionGrant`、`READBACK`、`EFFECT` 等英文标识属于规范领域术语；普通 UI 应优先使用业务中文。

需求等级与变更治理：

1. 所有规范性发布约束必须使用稳定 `V16-*` 需求 ID，并引用至少一个稳定 `AC-*`；设计引用不等于验收通过。
2. MUST 缺少当前版本可验证证据时只能标记为 `PENDING` 或 `FAIL`，不能依据设计意图推断 `PASS`。
3. MUST 降级、SHOULD/FUTURE 调整或 AC 放宽必须形成版本化变更记录，说明理由、风险、受影响证据和旧验收是否失效。
4. StoreContext、authority、凭证安全、一次写入、UNKNOWN 不重试、readback 和 readiness 等安全合同不得通过 SHOULD 偏差或临时范围裁剪绕过。
5. 任何被 defer 的能力不得保留看似可用但没有真实 authority 的生产入口。

迁移与信用解释：

1. schema migration 成功、历史记录可展示或 migration receipt 存在，均不表示 legacy record 已获得当前 v1.6.0 authority。
2. prior-version artifact、当前版本 durable history 和当前可执行 authority 必须分别标识；只有满足当前合同且通过当前验证的记录才可参与授权。
3. legacy Decision、Grant、execution、readback、evidence 或 Renderer selection 不得通过默认补值提升为当前可执行事实。
4. `ready` 只表示当前步骤可继续；`READINESS_PASS`、`APP_READY` 和 READY/NON_READY bundle 是不同层级的发布状态。
5. `MissionGrant.totalImpactBudget` 是 Ads 动作影响边界，AI 费用预算是独立治理对象，两者不得共用 authority 或单位。
6. 本次 1.1 新增或修改的需求与 AC 初始均为 `PENDING`，不产生实现、测试、包体或交付信用。

### 0.4 修订记录

| 文档版本 | 日期 | 修订内容 |
|---|---|---|
| 1.0 | 2026-09-01 | 首版 v1.6.0 PRD：统一六模块、完整经营闭环、权限合同、验收矩阵和迁移路线 |
| 1.1 | 2026-09-01 | 补齐 UNKNOWN 残余 authority、授权模式/issuer、policy gate、迁移兼容、模板兼容、投影/evidence ref、AI/NFR 治理及 L1–L8 追踪发布合同；仍为 Draft / Proposed，不授予实现或验收信用 |

---

# 1. 执行摘要

Amazon AI Ops Agent v1.6.0 是一款面向 Amazon 美国站运营人员的 Windows 本地 AI 运营工作台。它把真实领星八报表采集、正式数据入库、产品级分析、建议与审批、安全广告执行、三段回读、经营实验和因果记忆串成一个按店铺隔离、可追溯、可恢复、默认拒绝不确定动作的本地闭环。

v1.6.0 的产品重点不是继续增加页面或广告动作，而是解决五个核心问题：

1. **当前应该做什么不清楚**：操作者需要在一个页面看到当前进度、阻断、结果和唯一下一动作。
2. **建议从哪里来不清楚**：每条建议必须回链到当前店铺、产品、时间窗、同一批次八报表、规则/模型版本和 Analysis Run。
3. **审批是否真的授权当前动作不清楚**：Decision 与 MissionGrant 必须绑定最新 revision、对象、变化幅度、策略和会话。
4. **执行是否真正成功不清楚**：每个动作必须可见执行，并有 before、after、reload 三段回读；不确定结果必须保留为 UNKNOWN。
5. **经营经验无法可信复用**：只有具备真实回读和观察结果的店铺级记录才能进入经营记忆，单样本不得夸大为确定因果。

v1.6.0 的用户侧信息架构统一为六个业务模块：

```text
今日任务
运营资产
决策中心
执行与实验
经营记忆
系统设置
```

底层继续复用现有 10 个 Mission Control workspace、22 个 intent 和既有 Main/Preload/SQLite 权限链，不为导航重组进行不必要的领域重写。

---

# 2. 产品背景与问题定义

## 2.1 用户现状

Amazon 运营人员通常需要在领星 ERP、Amazon Ads、Excel、聊天记录和本地文件之间反复切换：

- 重复创建和下载多个广告报表；
- 无法快速确认报表是否来自同一店铺、同一时间窗和同一批次；
- 不同维度报表可能被错误相加；
- AI 建议缺少稳定证据、对象身份和版本归属；
- 多次运行分析可能堆叠重复建议；
- 审批和实际写入之间可能出现对象、竞价或会话漂移；
- 写入后只看到“点击成功”，没有 reload 后的事实证明；
- 失败或 UNKNOWN 时容易误重试，造成重复修改；
- 实验结果和日常运营记录无法形成谨慎、可追溯的经验。

## 2.2 一句话定位

> Amazon AI Ops Agent 是一个面向单个 Amazon US 运营操作者的 Windows 本地运营智能体：从真实八报表建立事实，在明确授权下执行一个低风险关键词降价动作，并用回读、实验和经营记忆证明发生了什么。

## 2.3 核心价值

| 价值 | 用户结果 |
|---|---|
| 数据可信 | 只有同一 `production_full` 谱系的 exact 8/8 才能发布分析 |
| 建议可解释 | 每条建议显示业务路径、当前值、建议值、证据、规则/模型来源和风险 |
| 权限可验证 | 审批与策略均通过不可变 MissionGrant 授权完整最新动作批次 |
| 执行可见 | 用户可以看到浏览器、对象核验、写入和回读过程 |
| 失败可恢复 | 每个 blocker 提供原因和恢复入口；UNKNOWN 不会自动重试 |
| 经验可复核 | 经营记忆回链到 Mission、Decision、ACTION、READBACK、EFFECT 与证明哈希 |
| 数据不出本机 | 报表、数据库、浏览器 Profile、凭证和证据保存在本地受控范围 |

## 2.4 v1.6.0 产品目标

| 目标 ID | 目标 | 成功表现 |
|---|---|---|
| G-01 | 建立单一操作者主线 | 用户无需理解内部 workspace 即可完成从采集到记忆的闭环 |
| G-02 | 将 Analysis Run 产品化 | 用户可以识别本次分析的状态、输入、输出、复用结果和失败恢复 |
| G-03 | 完成六模块收敛 | 22 个既有 intent 只归属一个一级模块，无重复、无丢失 |
| G-04 | 证明安全黄金闭环 | 一个真实合格关键词降价动作完成单次写入和三段回读 |
| G-05 | 让不确定性可见 | 任何身份、数据、权限或回读不确定都不会显示为成功 |
| G-06 | 建立谨慎经营记忆 | 只有非 UNKNOWN、具备 proof 的 READBACK/EFFECT 进入可信索引 |
| G-07 | 建立可交付证据链 | 源码、包、数据库和验收证据属于同一版本谱系 |

## 2.5 产品成功指标

| 指标 | v1.6.0 目标 | 统计口径 |
|---|---:|---|
| 非 exact 8/8 发布建议数 | `0` | 正式 Analysis Run 发布事件 |
| 同 fingerprint 重复活跃建议数 | `0` | 当前店铺、产品、时间窗、证据 fingerprint |
| 跨店铺数据/审批/执行/记忆串用数 | `0` | StoreContext authority/audit |
| UNKNOWN 原写入自动重试数 | `0` | execution ledger |
| 已声明成功但缺三段回读的执行数 | `0` | before/after/reload evidence |
| 超过有效上限的关键词降价数 | `0` | `min(10%, grant.maxChangePct)` |
| 无 reason 的权限模式/策略变更数 | `0` | policy runtime audit |
| 进入可信记忆但缺 proof 的记录数 | `0` | causal memory index |
| MUST blocker 无恢复入口数量 | `0` | UI 状态验收 |
| v1.6.0 历史包证据复用数量 | `0` | readiness manifest |

---

# 3. 用户、角色与核心任务

## 3.1 主要用户

### 角色 A：Amazon 运营操作者

特征：

- 熟悉 Amazon 经营和广告，但不要求具备开发能力；
- 在一台 Windows 电脑上管理一家或多家相互隔离的 US 店铺；
- 能在可见浏览器中手动登录领星 ERP 和 Amazon Ads；
- 需要系统明确告诉其当前事实、风险和下一动作；
- 不愿意为理解系统而阅读内部 ID、数据库状态或工程日志。

核心任务：

1. 选择当前店铺和产品；
2. 准备完整八报表；
3. 运行分析并理解建议来源；
4. 审批或拒绝具体建议；
5. 观察一次安全执行；
6. 处理失败或 UNKNOWN；
7. 查看实验和经营记忆。

### 角色 B：审批/复核者

v1.6.0 仍为单用户本地应用，不实现团队 RBAC。审批/复核者是同一设备上的操作职责，而不是独立账号体系。

核心任务：

- 检查证据、对象、当前值、建议值和变化幅度；
- 记录批准或拒绝原因；
- 确认整批授权边界；
- 不通过口头确认、聊天记录或截图替代系统 Decision/Grant。

### 角色 C：交付验证者

核心任务：

- 验证包、源码、数据库和证据谱系；
- 检查 Package UI、业务 smoke、安全边界和正式 readiness；
- 在门禁不完整时维持 `APP_NEEDS_WORK`。

## 3.2 Jobs-to-be-Done

| JTBD ID | 当…… | 我希望…… | 从而…… |
|---|---|---|---|
| JTBD-01 | 我打开当前店铺 | 立即看到当前阻断和唯一下一动作 | 不需要逐页寻找任务 |
| JTBD-02 | 我准备运行分析 | 确认八报表、产品和时间窗完整且同源 | 不基于错误数据做决策 |
| JTBD-03 | 我看到一条建议 | 知道它来自哪个 Analysis Run 和哪些证据 | 能判断是否值得批准 |
| JTBD-04 | 我批准降价 | 明确授权的是哪个对象、当前值、目标值和最大变化 | 不会批准后写到另一个对象 |
| JTBD-05 | 系统执行广告动作 | 看到写入前、写入后和 reload 事实 | 能区分点击成功和业务成功 |
| JTBD-06 | 结果不确定 | 保留 UNKNOWN 并执行只读对账 | 不会因自动重试造成二次写入 |
| JTBD-07 | 观察期结束 | 查看指标、护栏和系统结论 | 能形成谨慎经营经验 |
| JTBD-08 | 我切换店铺 | 完整替换所有业务上下文 | 不会混用另一店铺的事实或授权 |

## 3.3 运行假设

1. 产品运行在 Windows 11/受支持 Windows 桌面环境。
2. 用户通过可见浏览器手动登录；系统不读取、填写或导出登录秘密。
3. 当前只支持 Amazon US 和 USD。
4. 一台设备可配置多个隔离 StoreContext，但同一时刻只有一个当前权威店铺。
5. 每个店铺拥有独立数据库逻辑范围、浏览器 Profile、会话、任务、策略、证据、实验和记忆。
6. 网络、ERP 或 Ads 不可用时，本地历史和诊断仍可读；需要外部页面的动作必须阻断。

---

# 4. 版本范围

## 4.1 v1.6.0 范围内

| 范围 | 说明 |
|---|---|
| 六模块 IA | 用六个业务模块组织现有 10 workspace / 22 intent |
| StoreContext | 店铺、产品、日期、会话、US/USD 权威上下文 |
| 运营资产 | 产品目标、广告对象、关键词、Listing、本地版本 |
| 八报表采集 | 真实领星八类广告报表的同批次采集、导入和对账 |
| Analysis Run | 运行回执、阶段、输入 fingerprint、结果、复用、阻断和恢复 |
| Mission | FACT → ANALYSIS → DECISION → ACTION → READBACK → EFFECT |
| 决策中心 | 建议、证据、审批、拒绝、已处理、superseded 历史 |
| MissionGrant | 人工或策略签发的不可变整批授权 |
| 安全执行 | 当前关键词对象的具体降价、串行单次写入、可见浏览器 |
| 回读与 UNKNOWN | before/after/reload、verifier、双次只读对账、不重试 |
| 经营实验 | 假设、真实基线、观察窗、指标快照、护栏、机器结论 |
| 经营记忆 | 店铺级谨慎因果时间线、搜索、修正、导出 |
| 策略与自动化 | 两种写入权限模式、策略版本、限额、窗口、冷却、熔断、kill switch |
| 本地 AI | OpenAI-compatible 配置、结构化建议、超时/取消/回退、安全上下文 |
| 交付验收 | 当前版本 package、UI、安全、数据库、canary、readiness/bundle |

## 4.2 v1.6.0 明确不做

| 不做项 | 原因 |
|---|---|
| Amazon SP-API / Amazon Ads API | 当前坚持可见浏览器和本地证据链 |
| SaaS、多租户、云数据库 | 不属于 Windows 单机产品边界 |
| 团队账号、RBAC、远程多人审批 | v1.6.0 仍为单用户本地应用 |
| 手机 App、浏览器插件 | 不属于目标平台 |
| Webhook、飞书、企业微信、集简云、Zapier、n8n | 不建立外部自动化依赖 |
| 云同步和跨设备同步 | 避免扩大隐私、安全和一致性范围 |
| 自动读取/填写密码、Cookie、Token | 凭证由用户和本地安全存储控制 |
| 绕过验证码或风控 | 明确禁止 |
| 自动提交 Listing | Listing 只生成本地版本和导出 |
| 广告 bid increase | v1.6.0 仅允许关键词降价 |
| 修改预算 | 风险和影响面超出 v1.6.0 |
| 暂停 Campaign/Ad Group | 超出安全动作白名单 |
| 添加否定关键词 | 超出当前执行合同 |
| 商品投放写入 | 只读分析，不执行 |
| 多站点、多币种 | 当前固定 US/USD |
| 用户可安装的 Skills 市场 | Skills 只作为内部组合能力和诊断信息 |
| AI 自主操作任意页面 | AI 无写入 authority |

## 4.3 后续版本候选（FUTURE）

以下内容只有在 v1.6.0 黄金闭环、双店隔离、人工 canary、policy-auto canary 和连续运行均验证后才可重新立项：

- 更多 marketplace/currency；
- 受控 bid increase；
- 预算动作；
- 否定关键词；
- Campaign/Ad Group 状态动作；
- Listing 发布集成；
- 团队审批；
- 云端协作与远程任务。

---

# 5. 产品原则与权威层级

## 5.1 产品原则

| 原则 | 要求 |
|---|---|
| 本地优先 | 正式业务数据、凭证、Profile、证据和运行记录默认保留在本机 |
| 当前店铺唯一 | 所有读取、写入和展示必须属于当前 StoreContext |
| 事实先于分析 | 没有完整、同源、可对账的八报表，不发布建议 |
| 证据先于动作 | 没有当前对象、当前值、批准和 Grant，不执行写入 |
| 不确定即阻断 | 无法证明的状态不推断为成功 |
| 写入可见 | 用户必须能看到受控浏览器执行过程 |
| 一次动作一次证明 | 每个 action slot 只允许一次提交并要求独立回读 |
| 结果不等于因果 | 单次结果只能作为观察，需保留样本和护栏限制 |
| 一个首要任务 | 页面优先展示当前状态、主动作和下一步 |
| 技术细节渐进披露 | 普通 UI 不暴露内部 ID、revision、路径和工程状态值 |

## 5.2 权威层级

从高到低：

```text
当前 Main StoreContext + durable SQLite authority
  → 当前正式 report/import/evidence/action/decision/grant/execution records
    → Main 派生的受限 Renderer projection
      → Renderer 临时交互状态
        → 原型 fixture / preview 数据
```

任何低层状态都不能覆盖高层事实。

## 5.3 数据口径原则

1. `campaign`、`ad_group`、`placement`、`advertised_product`、`auto_targeting`、`keyword`、`product_targeting`、`user_search_term` 是不同业务粒度。
2. 不同粒度不能直接相加形成“总花费”或“总销售额”。
3. 产品成本、FBA 费用、当前售价、最低可接受售价、目标 ACOS/TACOS/净利率属于本地经营配置，不构成审批或执行授权。
4. 截图、审计 JSON、Trace、DOM snapshot 和页面归档不能替代真实原始领星报表。
5. Renderer 不接触凭证、Cookie、浏览器 Profile 路径、原始证据绝对路径或数据库写权限。

---

# 6. 信息架构

## 6.1 用户侧六模块

| 模块 | 操作者问题 | 主要内容 | 默认入口 |
|---|---|---|---|
| 今日任务 | 现在最需要我处理什么？ | 当前进度、阻断、结果、下一动作、Mission | 今日总览 |
| 运营资产 | 当前店铺的产品和数据是否准备好？ | 产品、广告对象、关键词、Listing、八报表 | 产品与目标 |
| 决策中心 | 这条建议从哪里来，是否值得批准？ | Analysis Run、建议、证据、审批、已处理 | 分析运行/待判断 |
| 执行与实验 | 这个动作能否安全执行，实际发生了什么？ | 实时执行、回读、UNKNOWN、经营实验 | 实验台账或当前执行 |
| 经营记忆 | 我们做过什么，学到了什么？ | 因果时间线、搜索、证据、修正、导出 | 因果时间线 |
| 系统设置 | 哪些连接、策略和边界治理当前店铺？ | 店铺、连接、策略、自动任务、AI、交付 | 店铺与连接/策略边界 |

## 6.2 现有 10 workspace / 22 intent 映射

| 一级模块 | 内部 workspace | intent / 子视图 | 数量 |
|---|---|---|---:|
| 今日任务 | today | `today/overview`、`today/events` | 2 |
| 今日任务 | missions | `missions/overview`、`missions/facts` | 2 |
| 运营资产 | objects | `objects/products`、`objects/targets`、`objects/keywords`、`objects/listing` | 4 |
| 运营资产 | collection | `collection/scope`、`collection/reports`、`collection/import-check` | 3 |
| 决策中心 | decisions | `decisions/recommendations`、`decisions/approval`、`decisions/decided` | 3 |
| 执行与实验 | experiments | `experiments/ledger` | 1 |
| 执行与实验 | execution | `execution/live`、`execution/evidence` | 2 |
| 经营记忆 | memory | `memory/timeline` | 1 |
| 系统设置 | policy | `policy/rules` | 1 |
| 系统设置 | settings | `settings/ai-and-local`、`settings/scheduler`、`settings/delivery` | 3 |
| **合计** | **10 workspace** | **22 intent** | **22** |

## 6.3 IA 需求

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-IA-001 | MUST | 一级业务导航必须且仅展示六个模块，不新增 Skills 一级入口 | AC-IA-001 |
| V16-IA-002 | MUST | 现有 22 个 intent 必须各自且仅归属一个一级模块 | AC-IA-001 |
| V16-IA-003 | MUST | 导航重组不得改变 StoreContext、Main authority 或领域记录所有权 | AC-IA-002 |
| V16-IA-004 | MUST | 当前路由无 native 能力时必须显示受阻或受控 legacy adapter，不得显示模拟成功 | AC-IA-003 |
| V16-IA-005 | SHOULD | 侧栏一级模块使用用户业务语言，内部 workspace 名称不作为主要导航负担 | AC-UI-001 |
| V16-IA-006 | SHOULD | Ctrl+K 首先支持模块/功能入口搜索；对象搜索只有在 Main 提供当前店铺权威 projection 时启用 | AC-IA-004 |

## 6.4 全局上下文栏

全局上下文栏在所有业务模块保持可见，至少显示：

- 当前店铺；
- 当前选中产品或“尚未选择”；
- `US / USD`；
- 当前业务日；
- ERP 连接/会话事实；
- Ads 连接/会话/身份事实；
- 当前 Ads 写入权限模式；
- 全局搜索；
- 能力边界/阻断入口。

店铺切换不得只是替换标签，必须重新取得完整 bootstrap projection。

---

# 7. 端到端黄金闭环

## 7.1 主流程

```text
选择当前 StoreContext 与产品
  ↓
采集同一 production_full 谱系的八类真实领星报表
  ↓
完成逐类导入、reconciliation 与正式数据门
  ↓
创建/激活 Mission，冻结目标、观察窗、成功条件、护栏和 policy version
  ↓
启动 Analysis Run，封存 Evidence Package
  ↓
生成不可变 action batch、proposal snapshot 与 Decision
  ↓
人工审批或命中 policy-auto，签发 MissionGrant
  ↓
可见 Ads UI preflight：店铺/账号/对象/match type/current bid/page identity
  ↓
每个 action slot 只执行一次具体 lower_bid 写入
  ↓
before → after → reload 三段回读与 verifier
  ↓
建立经营实验：真实基线、观察窗、指标快照和护栏
  ↓
系统形成 EFFECT 结论
  ↓
合格记录进入店铺级经营记忆
  ↓
形成同一源码/包/DB/证据谱系的 readiness 与 bundle
```

## 7.2 阶段合同

| 阶段 | 进入条件 | 完成输出 | 主要阻断 | 恢复入口 | 权威记录 |
|---|---|---|---|---|---|
| StoreContext | 有当前 active US/USD 店铺 | 当前店铺、Profile、business date、session generation | 店铺缺失、跨店身份 | 系统设置/店铺 | store runtime/bootstrap |
| 产品范围 | 当前店铺已加载 | 当前产品与经营目标 | 产品不存在/跨店 | 运营资产/产品 | product record |
| 八报表 | ERP 会话可用、范围确定 | 同一 batch 的 8/8 原始文件 | 登录过期、某报表失败 | 运营资产/采集任务 | collection batch/report files |
| 正式导入 | 8 报表可校验 | import run、8 reconciliations、metrics | 类型错、重复、跨批次拼接 | 导入检查 | formal import lineage |
| Mission | 当前 batch/policy/product 可用 | active Mission revision | batch/policy 不匹配 | 今日任务/Mission | MissionRecord |
| Analysis Run | exact 8/8、Mission 最新 | Evidence Package、action batch、proposals、receipt | 7/8、数据过期、AI/规则冲突 | 数据采集/决策中心 | analysis authority records |
| Decision | proposals 属于最新批次 | approved/rejected/blocked/superseded records | revision 漂移、证据不合格 | 决策中心 | Decision/history |
| Grant | 完整最新 proposal batch 可授权 | immutable MissionGrant | 部分选择、过期、策略/会话漂移 | 决策/策略 | Grant/event ledger |
| Execution | Grant、Ads 身份、current bid 全通过 | 单次 submit + execution record | 身份/对象/值漂移、kill switch | 执行/设置 | execution authority/intent |
| READBACK | 已有 submit intent | before/after/reload proof 或 UNKNOWN | 页面刷新失败、目标不稳定 | 执行回读 | readback evidence/events |
| Experiment | verified readback 和当前指标基线 | metric snapshots、机器结论 | 缺基线、窗口未结束、guardrail | 实验台账 | Experiment/observations |
| EFFECT/Memory | 系统结论、proof、非 UNKNOWN | EFFECT event、memory index | 证据不足、跨店、过度因果表述 | 实验/记忆 | causal ledger/index |
| Delivery | 当前包全门禁证据 | APP_READY 或 APP_NEEDS_WORK bundle | 任一门缺失 | 交付验收 | readiness manifest/bundle |

## 7.3 流程需求

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-FLOW-001 | MUST | 每个主阶段必须显示当前状态、刚发生的结果、阻断原因和恢复/下一动作 | AC-FLOW-001 |
| V16-FLOW-002 | MUST | 阶段完成必须由相应 Main 持久化事实驱动，Renderer 不得自行推进业务真相 | AC-FLOW-002 |
| V16-FLOW-003 | MUST | 任一上游权威发生 revision/session/store 漂移时，下游待执行 authority 必须失效或重新验证 | AC-FLOW-003 |
| V16-FLOW-004 | SHOULD | 主链不是强制 wizard，各模块可独立进入，但共享当前 StoreContext 和下一动作 | AC-FLOW-004 |

---

# 8. StoreContext 与上下文隔离需求

## 8.1 StoreContext 范围

StoreContext 至少包含或派生：

- `storeId`；
- `marketplace = US`；
- `currency = USD`；
- `businessDate`；
- 当前 `sessionGeneration`；
- 当前独立 `browserProfileId`（只在 Main 使用）；
- 当前选择产品；
- 当前 ERP/Ads connection 和 session truth。

## 8.2 隔离需求

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-CTX-001 | MUST | 所有业务 query/command 必须携带或由 Main 推导当前 StoreContext，并在 Main 再验证 | AC-CTX-001 |
| V16-CTX-002 | MUST | 切换店铺必须替换产品、报表、Analysis Run、建议、审批、Grant、执行、实验和记忆上下文 | AC-CTX-002 |
| V16-CTX-003 | MUST | 不同店铺不得共用 browser Profile、session generation、Grant 或执行证据 | AC-CTX-003 |
| V16-CTX-004 | MUST | marketplace/currency 非 US/USD 时，v1.6.0 业务主链必须阻断 | AC-CTX-004 |
| V16-CTX-005 | MUST | StoreContext mismatch 必须返回业务可理解的阻断，不得返回另一店铺数据 | AC-CTX-005 |
| V16-CTX-006 | MUST | 店铺切换或 session generation 变化后，旧的异步响应不得覆盖新上下文 | AC-CTX-006 |
| V16-CTX-007 | SHOULD | 顶栏持续显示当前权威店铺、产品和连接状态，不能依赖用户记忆 | AC-UI-002 |

---

# 9. 模块一：今日任务

## 9.1 模块目标

今日任务是操作者的默认控制面，不重复承载所有编辑功能，而是回答：

1. 当前店铺准备好了吗？
2. 当前 Mission 到哪一步？
3. 最近一次 Analysis Run 发生了什么？
4. 是否有待审批、执行、UNKNOWN 或实验结果？
5. 现在唯一最重要的下一动作是什么？

### 用户故事

| 用户故事 ID | 作为 | 我希望 | 从而 |
|---|---|---|---|
| US-TODAY-01 | 运营操作者 | 打开应用就看到当前店铺唯一主任务 | 不在多个页面间猜测下一步 |
| US-TODAY-02 | 运营操作者 | 看到每个 blocker 的原因和恢复入口 | 能安全恢复而不是反复重试 |
| US-TODAY-03 | 复核者 | 看到最新 Mission、Analysis、执行和效果摘要 | 快速判断当前闭环是否可信 |

### 页面与权限合同

| 项目 | 合同 |
|---|---|
| 主要动作 | 执行当前唯一下一动作；主动作由 Main projection 和优先级规则决定 |
| 空状态 | 无店铺、无产品、无 Mission 分别提供创建/选择入口，不合并为“暂无数据” |
| 加载状态 | store/bootstrap/summary 分区加载；旧店铺数据立即退出可见上下文 |
| 阻断/错误 | 显示业务原因、不会自动做什么、恢复 route；诊断 detail 折叠 |
| 成功状态 | 只展示持久化或 verified 事实，并给出下一阶段入口 |
| 权限边界 | 首页只发起受限 query/command，不直接写 Mission/Decision/Grant/Execution 状态 |
| 跨模块链接 | 运营资产、决策中心、执行与实验、经营记忆、系统设置的对应 intent |

## 9.2 页面构成

```text
全局 StoreContext
任务横幅：当前唯一主动作
准备度摘要：产品 / ERP / 八报表 / 导入 / Ads
当前 Mission：目标、阶段、状态、阻断
最近 Analysis Run：开始、结束、产出、复用/失败
待处理：建议、审批、执行、UNKNOWN、实验
最近验证结果：READBACK / EFFECT
次级区：运营事件与诊断
```

## 9.3 下一动作优先级

当多个问题同时存在时，首页按以下优先级选择唯一主动作：

1. Store/Ads 身份或跨店安全阻断；
2. UNKNOWN 只读对账；
3. 当前店铺/产品未选择；
4. exact 8/8 未完成；
5. 导入或 reconciliation 未完成；
6. Mission 未创建/被阻断；
7. Analysis Run 未运行/失败；
8. 待审批；
9. 已授权待执行；
10. 实验观察/结论待处理；
11. 已完成，可开始下一周期。

## 9.4 状态与动作

| 状态 | 主文案方向 | 主动作 |
|---|---|---|
| 无当前店铺 | 尚未选择运营店铺 | 前往店铺设置 |
| 无产品 | 当前店铺尚未选择产品 | 选择/创建产品 |
| 报表不完整 | 当前数据不足，分析不会发布建议 | 前往数据采集 |
| 导入受阻 | 八报表已下载，但正式入库未通过 | 查看导入检查 |
| Mission active | 显示当前阶段和最近检查点 | 继续当前阶段 |
| Analysis running | 显示分阶段进度，不提供重复启动 | 查看运行详情/取消 |
| 待审批 | 显示建议数与最高风险项 | 前往决策中心 |
| 待执行 | 显示 Grant expiry 和 Ads 状态 | 前往可见执行 |
| UNKNOWN | 明确“结果未知，不会自动重试” | 开始/继续只读对账 |
| Experiment running | 显示观察窗与护栏 | 查看实验 |
| Effect verified | 显示验证结果和限制 | 查看经营记忆 |

## 9.5 需求

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-TODAY-001 | MUST | 首页投影必须与当前 storeId、businessDate、US/USD authority key 完全匹配 | AC-TODAY-001 |
| V16-TODAY-002 | MUST | 首页必须显示且只显示一个当前主动作，其他动作降为次级入口 | AC-TODAY-002 |
| V16-TODAY-003 | MUST | 首页不得把缺失、过期或受阻能力展示为成功/就绪 | AC-TODAY-003 |
| V16-TODAY-004 | MUST | 当前有 UNKNOWN 时，主动作必须优先指向只读对账，而非再次执行 | AC-TODAY-004 |
| V16-TODAY-005 | MUST | 每个 blocker 必须包含中文原因和具体恢复目的地 | AC-TODAY-005 |
| V16-TODAY-006 | SHOULD | 首页显示当前 Mission、最新 Analysis Run、待审批、执行/实验和最近 EFFECT 摘要 | AC-TODAY-006 |
| V16-TODAY-007 | SHOULD | 运营事件作为分析上下文可见，但不得直接授权 Ads 写入 | AC-TODAY-007 |

---

# 10. 模块二：运营资产

## 10.1 模块目标

运营资产统一管理当前店铺的产品事实、广告对象、关键词、Listing 和八报表数据入口，使操作者在进入分析前清楚知道：

- 分析对象是谁；
- 当前经营目标是什么；
- 广告对象路径是什么；
- 八报表是否来自同一范围和同一谱系；
- 哪些字段或数据仍不足。

### 用户故事

| 用户故事 ID | 作为 | 我希望 | 从而 |
|---|---|---|---|
| US-ASSET-01 | 运营操作者 | 维护当前产品经营目标并清楚其非授权属性 | 可以改善分析而不会误触发写入 |
| US-ASSET-02 | 运营操作者 | 通过业务路径查看活动、广告组和关键词 | 不依赖内部 Ads ID 理解对象 |
| US-ASSET-03 | 运营操作者 | 看到八类报表逐类状态、来源和恢复动作 | 能在分析前补齐 exact 8/8 |
| US-ASSET-04 | Listing 操作者 | 保存、比较和导出本地草案 | 不会被系统自动提交到外部平台 |

### 页面与权限合同

| 项目 | 合同 |
|---|---|
| 主要动作 | 根据当前缺口选择“完善产品”“采集报表”或“检查导入”，同屏只保留一个 primary |
| 空状态 | 产品、广告对象、报表、Listing 分别提供范围明确的建立入口 |
| 加载状态 | 资产摘要先加载，明细按 intent 分段获取；切店取消/忽略旧响应 |
| 阻断/错误 | 报表失败按类型诊断；跨店、跨批次、非 US/USD 和无会话 fail-closed |
| 成功状态 | 只有 Main 确认的保存、8/8、import/reconciliation 完成才显示成功 |
| 权限边界 | 产品配置、Listing 草案和报表事实不能直接签发 Decision/Grant |
| 跨模块链接 | exact 8/8 完成后进入今日任务/Mission 或决策中心 Analysis Run |

## 10.2 产品与经营目标

支持字段：

- ASIN / MSKU / SKU 等当前产品标识；
- 产品成本；
- FBA 费用；
- 当前售价；
- 最低可接受售价；
- 目标 ACOS；
- 目标 TACOS；
- 目标净利率；
- Listing 本地版本和来源。

上述字段只参与分析和护栏判断，不等于批准任何广告动作。

## 10.3 广告对象

普通 UI 使用统一可读路径：

```text
广告活动 > 广告组 > 关键词/投放
```

内部稳定 ID、revision、source row 和 authority ID 只在折叠诊断中展示，且不能包含凭证或本地敏感路径。

## 10.4 exact 8/8 报表类型与模板兼容合同

必须包含且仅按规范识别以下八种业务 grain：

1. `campaign` — 广告活动；
2. `ad_group` — 广告组；
3. `placement` — 广告位；
4. `advertised_product` — 推广商品；
5. `auto_targeting` — 自动投放；
6. `keyword` — 关键词；
7. `product_targeting` — 商品投放；
8. `user_search_term` — 用户搜索词。

“8”表示八种固定业务 grain，不表示每类永远只有一个物理导出模板。每一类型可以支持多个经过显式登记和验证的领星模板 revision，但支持范围必须由 **Migration and Compatibility** companion specification 中的版本化 template compatibility manifest 定义。

模板兼容必须满足：

- template revision 显式映射到唯一 report type；
- 定义规范字段、允许的 header alias、必填/条件为空字段、单位/币种、grain 和唯一键；
- 未知 header、缺关键字段、重复候选列、单位/币种不明确或同时匹配多个 report type 时 fail-closed；
- 不得按列位置、模糊近似列名、上次人工选择或默认模板猜测 report type/字段；
- provider 暂不提供任一 required report 时，正式 Analysis Run 保持 blocked，不把该类型改为 optional；
- legacy 文件重新导入必须形成新的 import attempt，不改写历史 import/reconciliation；
- 模板兼容不得放宽 current store、`production_full`、lineage、file hash、formal import、reconciliation、source row 或 freshness 门禁。

正式分析发布要求：

- 同一 active StoreContext；
- 同一 marketplace/currency；
- 同一日期范围；
- 同一 completed `production_full` lineage；
- 每类有真实原始文件及合法 hash；
- 每类完成正式 import/reconciliation；
- 不从多个独立批次拼出 8/8；
- 数据未超过 Evidence Package freshness 窗口。

## 10.5 采集任务状态

```text
待运行 → 采集中 → 等待生成 → 下载中 → 已下载 → 校验中 → 可导入
                      ↘ 失败/可恢复
                      ↘ 已取消/可恢复
```

失败或取消后可以恢复未完成的采集，但恢复结果必须仍属于同一合法 collection lineage；不能把旧文件静默替换为另一批次。

## 10.6 需求

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-ASSET-001 | MUST | 产品、目标、广告对象、关键词和 Listing 数据必须按当前店铺隔离 | AC-ASSET-001 |
| V16-ASSET-002 | MUST | 产品经营配置只能影响分析和护栏，不得直接生成审批或执行 authority | AC-ASSET-002 |
| V16-ASSET-003 | MUST | 普通 UI 必须用可读广告对象路径，内部标识默认折叠 | AC-ASSET-003 |
| V16-ASSET-004 | MUST | Listing 只保存本地版本、差异、建议和导出，不自动提交 Amazon/领星 | AC-ASSET-004 |
| V16-DATA-001 | MUST | 正式 Analysis Run 只能使用同一 `production_full` lineage 的 exact 8/8 | AC-DATA-001 |
| V16-DATA-002 | MUST | 7/8 或任一 reconciliation 失败必须阻断建议发布并指向缺失项 | AC-DATA-002 |
| V16-DATA-003 | MUST | 系统不得跨独立 batch/import 拼接为形式上的 8/8 | AC-DATA-003 |
| V16-DATA-004 | MUST | 截图、审计文件、DOM/Trace 或页面归档不得计为原始报表 | AC-DATA-004 |
| V16-DATA-005 | MUST | 每个报表必须保留类型、文件 hash、大小、导入行数、指标行数和 source row 范围 | AC-DATA-005 |
| V16-DATA-006 | MUST | 不同业务粒度不得盲目相加；UI 指标必须标明粒度/口径 | AC-DATA-006 |
| V16-DATA-007 | MUST | 采集 start/resume/cancel/import 必须使用当前店铺 authority，切店后旧任务结果不得写入新上下文 | AC-DATA-007 |
| V16-DATA-008 | SHOULD | 单个报表失败时显示独立诊断和恢复入口，同时明确整批分析仍被阻断 | AC-DATA-008 |
| V16-DATA-009 | MUST | 每种 report type 的受支持模板 revision、规范字段、alias、必填性、单位、grain 和唯一键必须进入版本化 compatibility manifest | AC-DATA-009 |
| V16-DATA-010 | MUST | 未知或歧义模板、缺关键字段、单位/币种不明确、多类型匹配均必须阻断，禁止猜测导入 | AC-DATA-010 |
| V16-DATA-011 | MUST | provider 缺少任一 required report 时 exact 8/8 保持 blocked；不得把 required type 静默降级为 optional | AC-DATA-011 |

---

# 11. 模块三：决策中心

## 11.1 模块目标

决策中心将 Analysis Run、建议、证据、人工判断和 MissionGrant 组织为一条可解释、可审计的决策链。

它必须回答：

- 本次分析何时开始和结束；
- 使用了什么店铺、产品、时间窗和报表快照；
- 哪些建议被新建、刷新、复用或跳过；
- AI 是否被调用、是否回退到规则；
- 建议是否具备人工/策略授权资格；
- 谁因为什么原因批准或拒绝；
- 当前 Grant 覆盖哪些完整动作。

### 用户故事

| 用户故事 ID | 作为 | 我希望 | 从而 |
|---|---|---|---|
| US-DEC-01 | 运营操作者 | 看到本次 Analysis Run 的输入、阶段和结果 | 能区分新结果、复用结果和失败 |
| US-DEC-02 | 审批者 | 对照对象、当前值、建议值、证据和风险逐条判断 | 批准的是具体、当前、可解释的建议 |
| US-DEC-03 | 审批者 | 在批准或拒绝时记录业务原因 | 后续可以审计当时的判断 |
| US-DEC-04 | 运营操作者 | 看到旧建议为何 superseded 以及完整已处理历史 | 不把历史变化误认为数据丢失 |

### 页面与权限合同

| 项目 | 合同 |
|---|---|
| 主要动作 | 无运行时“运行分析”；有待判断时“审查建议”；完整批准后“签发/查看 Grant” |
| 空状态 | 区分尚未运行、输入受阻、运行完成但无候选、无待审批建议 |
| 加载状态 | Run/建议列表/详情分区加载，运行中禁用重复启动 |
| 阻断/错误 | exact-eight、freshness、AI、revision、整批授权分别显示 blocker 与恢复 route |
| 成功状态 | completed/reused、approved/rejected 和 Grant issued 均来自 durable Main records |
| 权限边界 | UI 不能修改 immutable proposal；Decision/Grant command 必须重验 expectedRevision 和整批范围 |
| 跨模块链接 | 上游进入运营资产/Mission；下游进入执行与实验；历史进入经营记忆 |

## 11.2 Analysis Run 产品对象

### 11.2.1 逻辑属性

| 属性 | 说明 |
|---|---|
| Run identity | 一次分析尝试的稳定逻辑标识/回执引用 |
| StoreContext | 当前 store、US/USD、business date、session generation |
| Mission | missionId + latest missionRevision |
| Product | 当前 productId/ASIN |
| Data window | dateFrom/dateTo |
| Evidence | Evidence Package ID/hash、batch/import、8 sources |
| Fingerprint | store + product + data window + evidence/rule/model/policy 等规范输入摘要 |
| Stages | 创建、事实核验、分析、建议生成、完成或可恢复阻断 |
| Result | created/refreshed/reused/skipped 数、AI/fallback 详情、action batch |
| Timing | startedAt/completedAt/failedAt/interruptedAt |
| Status | started/completed/failed/interrupted/reused，预检阻断不冒充已启动 |

### 11.2.2 相同输入重跑语义

当规范 fingerprint 完全一致时：

1. 保存新的运行尝试/回执；
2. 复用已封存的合法 Evidence Package/分析结果；
3. 结果明确显示 `reused`；
4. 不生成重复 action batch、proposal、Decision 或活跃建议；
5. 不删除旧回执；
6. 如果任一权威 revision、证据或配置发生变化，则产生新的合法分析结果，而不是错误复用。

这一定义优先于原型中“每次都生成新结果再 supersede”的模拟表达。

## 11.3 建议与 action batch

一轮正式分析输出：

- 一个不可变 `AnalysisActionBatchRecord`；
- 零个或多个不可变 `AnalysisProposalSnapshotRecord`；
- 每个 proposal 对应一个稳定广告对象 authority；
- 每个 proposal 显示 campaign、ad group、keyword、match type、current bid、proposed bid、changePct、confidence、source、explanation；
- 每个 proposal 分别计算人工授权和策略授权资格；
- 不支持的建议被跳过或阻断，不能混入 Grant。

## 11.4 Decision

Decision 状态：

```text
proposed
→ needs_approval
→ approved / rejected / blocked / superseded
→ executed
→ verified
```

规则：

- 批准/拒绝必须记录业务原因；
- 已批准历史不可被新分析重写；
- 新 action revision 只 supersede 仍开放的旧建议；
- revision 冲突必须要求刷新，不允许 last-write-wins；
- 已处理记录为只读历史；
- 所有 Decision 必须回链到 proposal 和 Evidence Package。

## 11.5 独占授权路径与整批授权

每个 action batch 必须选择且只选择一条 `authorizationPath`：

| authority mode | Decision 路径 | Grant issuer | 约束 |
|---|---|---|---|
| `manual_approval` | 操作者逐条形成 human Decision | `human_operator` | 完整 batch 全部取得当前人工判断后显式签发 Grant |
| `policy_auto` | 当前 enabled policy 对完整 batch 形成 policy Decision | `policy_runtime` | 全部 proposal 同时满足当前 policy eligibility 后自动签发 Grant |

人工审批可以逐条处理 Decision，但 MissionGrant 必须授权**最新完整 action batch**，不得只选其中容易通过的子集规避风险。`policy_auto` 不要求人工补签 Grant；scheduler、AI、rule engine、Renderer 和 browser worker 只能作为 trigger/source/consumer，不能成为 Grant issuer。

以下行为禁止：

- 同一 batch/Grant 混合 human Decision 与 policy Decision；
- 人工补齐 policy-ineligible proposal 后继续称为 policy-auto；
- 将 proposal 拆成多个 Grant 规避整批门禁；
- 组合不同 mode、policy revision 或 action revision 的 Decision；
- mode 切换后复用旧 Decision/Grant；
- 把“半自动”持久化为第三种 authority mode。

如果任一 proposal 不满足当前授权条件：

- 整批 Grant 不签发；
- 返回具体 blocker；
- 已完成的逐条判断记录保留为对应 revision 的历史；
- 用户修复后必须基于最新 StoreContext、mode/policy/action revision 重新计算整批授权。

## 11.6 需求

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-ANA-001 | MUST | 每个正式建议必须属于一个当前店铺、产品、时间窗、Evidence Package 和 Analysis Run | AC-ANA-001 |
| V16-ANA-002 | MUST | Analysis Run 必须显示阶段、开始/结束时间、结果摘要和恢复入口 | AC-ANA-002 |
| V16-ANA-003 | MUST | 相同 fingerprint 重跑必须保留新回执、复用合法结果并保持重复活跃建议为 0 | AC-ANA-003 |
| V16-ANA-004 | MUST | Evidence、Mission、rule、model、policy 或 session authority 变化时不得复用旧可执行结果 | AC-ANA-004 |
| V16-ANA-005 | MUST | AI 超时、取消、结构无效或不可用时必须记录结果并按合同阻断或规则回退，不得伪造 AI 成功 | AC-ANA-005 |
| V16-ANA-006 | MUST | `rule`、`rule_ai`、`ai`、`rule_fallback` 必须按规范 source eligibility matrix 分别计算人工与 policy-auto 资格；AI-only 与 rule fallback 不得获得 policy-auto eligibility，AI/rule 冲突必须阻断 | AC-ANA-006 |
| V16-ANA-007 | MUST | action batch 和 proposal snapshot 必须不可变，并绑定 actionRevision | AC-ANA-007 |
| V16-DEC-001 | MUST | 每个 Decision 必须回链到当前 proposal、Mission、batch、policy 和 action revision | AC-DEC-001 |
| V16-DEC-002 | MUST | 批准、拒绝和权限变更必须记录非空业务 reason | AC-DEC-002 |
| V16-DEC-003 | MUST | 只 supersede 仍开放的旧建议，已批准/拒绝/验证历史不可被新分析重写 | AC-DEC-003 |
| V16-DEC-004 | MUST | revision 冲突必须 fail-closed 并要求刷新 | AC-DEC-004 |
| V16-DEC-005 | MUST | MissionGrant 必须覆盖最新完整 action batch，禁止部分选择规避整批门禁 | AC-DEC-005 |
| V16-DEC-006 | SHOULD | 决策详情优先显示业务对象、当前值、建议值、幅度、原因、风险和证据，内部 lineage 放入诊断区 | AC-DEC-006 |
| V16-DEC-007 | MUST | 每个 batch/Grant 只能使用 human 或 policy 一条 authorization path；禁止 mixed issuer、跨 mode Decision 复用、拆批或组合 Grant | AC-DEC-007 |

---

# 12. Mission 与 MissionGrant 合同

## 12.1 Mission

Mission 是完整经营闭环的飞行计划，包含：

- 当前店铺和 US/USD；
- dataBatchId；
- policyVersionId；
- 目标、优先级、产品；
- observationStartsAt / observationEndsAt；
- successCriteria；
- guardrails；
- revision；
- 生命周期和当前阶段。

生命周期：

```text
draft → active ↔ paused
active / paused → blocked
blocked → active / paused
active → completed
draft / active / paused / blocked / completed → archived
archived --restore--> 由领域服务恢复到合法的非归档状态
```

阶段：

```text
FACT → ANALYSIS → DECISION → ACTION → READBACK → EFFECT
```

阶段推进必须由领域服务根据持久化事实完成。Renderer 不能直接把 Mission 推到 READBACK、EFFECT 或 completed。

## 12.2 MissionGrant

MissionGrant 是人工审批和 policy-auto 共同使用的不可变授权包，至少绑定：

- storeId、US/USD；
- missionId + missionRevision；
- 完整 decisionIds；
- actionRevision；
- allowedActionTypes；
- allowedAdEntityIds；
- maxChangePct；
- totalImpactBudget；
- expiresAt；
- policyVersionId + policyRevision；
- requiredEvidence；
- stopConditions；
- issuer；
- createdSessionGeneration。

必需证据类型：

- `before_screenshot`；
- `after_screenshot`；
- `reload_screenshot`；
- `page_identity`；
- `readback_value`。

停止条件：

- `identity_drift`；
- `expected_before_mismatch`；
- `unknown_result`；
- `data_stale`；
- `impact_budget_exhausted`；
- `kill_switch`。

Grant 还必须记录并验证：

- `authorityMode` 与 `authorityModeRevision`；
- `issuerType` 与 `issuerRef`；
- `authorizationPath = human | policy`；
- 可选 `triggerActor`，仅用于审计，不获得 issuer authority。

### 12.2.1 Grant 生命周期与残余 authority

MissionGrant 本体不可变。当前可用性由 Grant 与追加式 lifecycle/residual events 共同派生，至少区分：

- `issued`：已签发，不表示任一写入成功；
- `slot_reserved`：当前 slot 的唯一 submit intent 已持久化；
- `slot_spent`：已发生 submit，或进入 submit-intent 边界后无法证明 click=0；
- `consumed`：授权 slot 已花费完毕，与 execution success 正交；
- `invalidated`：剩余 authority 因 UNKNOWN、上游漂移、mode/policy/session 变化或硬门禁失效；
- `revoked`：由明确权限操作撤销；
- `expired`：超过 `expiresAt`。

terminal event 不得删除、覆盖或恢复为 `issued`。重新满足门禁只能建立新 Grant，不能复活旧 Grant。

### 12.2.2 多 slot 残余规则

1. submit 前且 durable fact 明确证明 click=0 的 blocker 不花费 slot，但恢复时必须重验全部门禁。
2. submit intent 持久化后中断且无法证明 click=0 时，slot 视为 `spent + unknown`。
3. 已 submit 的 slot 无论 verified、明确失败或 UNKNOWN，均不返还 submit authority。
4. 正常 verified slot 保持历史事实；进入下一 slot 前必须重新读取全部当前门禁。
5. 任一 slot UNKNOWN 时，当前 slot 永久 unknown、batch 进入 `stopped_unknown`、未提交 slot 进入 `not_submitted_blocked`、Grant 追加 `invalidated(reason=unknown_result)`，剩余写入 authority 为 0。
6. UNKNOWN 保守占用一次 daily action count、启动 cooldown，并按该 proposal 最大可能影响计入 impact budget；对账不得返还这些计数。
7. UNKNOWN 之前的 verified slot 不被改写，但整个 batch 不得声明成功完成。

### 12.2.3 Issuer 与责任边界

- `manual_approval` 只能对应 `authorizationPath=human` 和 `issuerType=human_operator`；
- `policy_auto` 只能对应 `authorizationPath=policy` 和 `issuerType=policy_runtime`；
- scheduler 只记录 trigger，AI/rule engine 只记录 source，Renderer/browser worker 只执行受限职责；它们都不是 issuer；
- 一个 Grant 只能有一个 mode、mode revision、authorization path 和 issuer；
- mode 切换或 mode revision 变化使旧 pending Grant 终止失效，切回旧值也不复活。

## 12.3 需求

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-MIS-001 | MUST | Mission 必须绑定当前 store、data batch、policy version、观察窗、成功条件和护栏 | AC-MIS-001 |
| V16-MIS-002 | MUST | Mission 阶段只能按 FACT→ANALYSIS→DECISION→ACTION→READBACK→EFFECT 的事实链推进 | AC-MIS-002 |
| V16-MIS-003 | MUST | Renderer 不得直接声明 Mission EFFECT/completed | AC-MIS-003 |
| V16-MIS-004 | MUST | Mission 和 Experiment 只支持归档/恢复，不支持不可恢复硬删除 | AC-MIS-004 |
| V16-GRANT-001 | MUST | Grant 必须是不可变、店铺级、最新 revision 和 session generation 绑定的完整授权包 | AC-GRANT-001 |
| V16-GRANT-002 | MUST | 过期、撤销、已消费或 revision/session/store 不匹配的 Grant 不得授权执行 | AC-GRANT-002 |
| V16-GRANT-003 | MUST | Grant 必须包含完整 decisionIds、allowed entity、上限、预算、证据和停止条件 | AC-GRANT-003 |
| V16-GRANT-004 | MUST | 每个 slot 必须在 submit 前最后一刻重验全部当前写入 authority；submit 后只验证历史绑定及 after/reload 事实，后发漂移不得改写历史 submit，但必须阻断剩余 slot并在无法证明结果时保持 UNKNOWN | AC-GRANT-004 |
| V16-GRANT-005 | MUST | Grant 事件 issued/reserved/spent/invalidated/revoked/consumed/expired 必须追加记录，不覆盖历史 | AC-GRANT-005 |
| V16-GRANT-006 | MUST | Grant 当前状态与 residual authority 必须由不可变 Grant 和追加式 slot/lifecycle events 派生；authority consumption 与 execution success 必须分离 | AC-GRANT-006 |
| V16-GRANT-007 | MUST | UNKNOWN 或硬门禁导致的 Grant invalidation 为终态；恢复原条件或切回旧 mode/policy 不得复活旧 Grant | AC-GRANT-007 |
| V16-GRANT-008 | MUST | Grant 的 authority mode、mode revision、authorization path 和 issuer 必须唯一匹配 | AC-GRANT-008 |
| V16-GRANT-009 | MUST | 禁止 mixed authorization、跨 mode Decision 复用、拆批规避或组合多个 Grant | AC-GRANT-009 |

---

# 13. 模块四：执行与实验

## 13.0 模块体验合同

### 用户故事

| 用户故事 ID | 作为 | 我希望 | 从而 |
|---|---|---|---|
| US-EXE-01 | 运营操作者 | 在写入前看到 Grant、对象、当前 bid、目标 bid 和所有门禁 | 确认系统不会操作错误对象 |
| US-EXE-02 | 运营操作者 | 观察可见浏览器中的单次写入和三段回读 | 区分提交动作和业务成功 |
| US-EXE-03 | 运营操作者 | UNKNOWN 时只做只读对账 | 避免自动重试导致二次修改 |
| US-EXE-04 | 运营操作者 | 必要时安全接管或急停 | 停止流程但不绕过审计 |
| US-EXP-01 | 经营复核者 | 对照真实基线、观察窗、指标和护栏查看实验结论 | 形成有限、可复核的经营认识 |

### 页面与权限合同

| 项目 | 合同 |
|---|---|
| 主要动作 | 按状态唯一选择“开始 preflight”“执行当前 slot”“只读对账”或“查看实验结果” |
| 空状态 | 无 Grant、无执行、无实验分别解释前置条件并链接决策中心/今日任务 |
| 加载状态 | preflight、浏览器定位、submit、after、reload、experiment refresh 分阶段显示 |
| 阻断/错误 | 写入前失败 click=0；写入后不确定进入 UNKNOWN；两者文案和恢复动作严格区分 |
| 成功状态 | execution 只有 reload/verifier 后 verified；experiment 只有系统结论后 completed/EFFECT |
| 权限边界 | Renderer 不持有 browser write handle；Main 校验 Grant 并控制 submit slot |
| 跨模块链接 | 上游 Decision/Grant；下游 Experiment/EFFECT/经营记忆；连接问题进入系统设置 |

## 13.1 v1.6.0 唯一生产写入动作

领域动作类型仍使用：

```text
set_keyword_bid
```

但 v1.6.0 产品行为严格限制为：

```text
lower_bid only
```

即：

- 对象必须是当前店铺已核验 keyword；
- proposed bid 必须低于当前 bid；
- 实际变化百分比必须不超过 `min(10%, MissionGrant.maxChangePct)`；
- 不允许 bid increase；
- 不允许预算、暂停、否词、商品投放等其他写入。

## 13.2 执行前门禁

在第一次保存之前，所有门禁必须完成：

1. 当前 StoreContext 与 Grant 一致；
2. Mission、action、policy revision 均为最新；
3. Grant 未过期、未撤销、未消费；
4. Ads session live 且 session generation 一致；
5. 当前 Ads account/marketplace 与店铺身份一致；
6. campaign、ad group、keyword、match type、stable entity ID 唯一匹配；
7. 页面当前 bid 与 proposal currentBid 一致；
8. proposed bid 为具体、合法、向下变化；
9. changePct 不超过有效上限；
10. impact budget、daily count、cooldown、execution window 可用；
11. kill switch 关闭、circuit breaker 允许；
12. 必需 before/page identity 证据可建立；
13. 为当前 slot 先持久化唯一 submit intent 和 idempotency identity，再允许该 execution attempt 进行至多一次 click/save；进入该边界后其他 attempt 不得复用 slot。

门禁结果只对紧随其后的当前 submit attempt 有效，不形成可缓存的写入许可。等待、导航、session/policy/mode/revision 变化均要求在 click 前重新读取并重验。崩溃、重启或中断后无法由 durable fact 证明 click=0 时必须进入 UNKNOWN。

任一门禁失败，写入次数必须为 0。

## 13.3 串行执行

一个 action batch 可以包含多个合格 action slot，但必须：

- 串行；
- 每个 slot 独立 preflight；
- 每个 slot 只允许一次 submit；
- 每个 slot 完成回读后才能进入下一个；
- 任一 slot 进入 UNKNOWN，整批停止；
- 不提供“跳过 UNKNOWN 继续”；
- 用户接管不能绕过 Grant 或重新触发原 submit。

slot authority 与 execution outcome 是正交维度，至少使用以下状态：

```text
pending
→ preflight_blocked_no_submit
→ submit_intent_recorded
→ submitted
→ verified | failed_with_proof | unknown
```

只有 durable fact 明确证明 click=0 的 `preflight_blocked_no_submit` 才能在全部门禁重验后继续；`submit_intent_recorded` 后的中断不得回退为 pending。`submitted`、`verified`、`failed_with_proof` 和 `unknown` 都表示一次性 submit authority 已花费。

batch outcome 至少区分：

```text
running → completed | stopped_invalidated | stopped_unknown
```

`stopped_unknown` 为终态，不能 resume。

## 13.4 三段回读

| 阶段 | 内容 | 成功条件 |
|---|---|---|
| Before | 写入前对象身份、当前 bid、页面身份、截图 | 与 proposal/Grant 一致 |
| After | 写入后页面显示值、对象身份、截图 | 目标值可观察且对象稳定 |
| Reload | 刷新页面后重新定位并读取当前值、截图 | 目标值仍然一致，verifier 通过 |

只有 reload 后的事实通过 verifier，执行才能标记为 verified success。

## 13.5 UNKNOWN 与固定只读对账

UNKNOWN 是原 execution、slot 和 batch 的永久终态边界，不是“可稍后重试”的错误状态。当 submit intent 已持久化且系统无法用 durable fact 证明 click=0，或无法证明写入结果时：

- 原 execution 记录永久保持 `unknown`；
- 当前 slot 的一次性 submit authority 视为已花费；
- batch 进入不可恢复的 `stopped_unknown`；
- 后续未 submit slot 标记为 `not_submitted_blocked`；
- 当前 Grant 追加 invalidated，residual write authority 为 0；
- 不自动重试、不改写为 failed、不跳过继续；
- UNKNOWN 之前 verified 的 slot 保持原事实，但 batch 不得声明成功；
- UNKNOWN 及其 reconciliation-only 记录不得满足 verified Experiment、成功 EFFECT 或可信记忆前提。

### 13.5.1 固定双次只读 reconciliation

每个 unknown submit intent 最多创建一个权威 reconciliation case。该 case 不是原 execution attempt 的 continuation，并且恰好包含两个 observation slot：

1. reload 前唯一定位当前 store/account/entity，读取当前值并记录独立 timestamp、page identity、entity identity、screenshot/proof 和 evidence ref；
2. 明确 reload 后重新定位同一对象，再次独立读取和记录。

约束：

- reconciliation 不要求有效写入 Grant，但必须重新证明当前 StoreContext、Ads account、marketplace 和 entity 的只读身份；
- kill switch、open breaker 或 Grant invalidation 不阻断安全只读观察，但继续阻断所有写入；
- 对账期间不得调用 save、submit 或任何可改变 Ads 状态的控件；
- 任一 observation 缺 proof、身份不唯一或读取失败时不得用默认值补齐；
- 对账只追加 READBACK/reconciliation records，不修改原 intent、execution、slot、batch 或 Grant 历史；
- 不允许第三次“权威观察”把已经永久不确定的 case 升级为成功或失败。

### 13.5.2 对账结论

| outcome | 判定条件 | 允许表达 | 禁止表达 |
|---|---|---|---|
| `target_stably_observed` | 两次均唯一读到 target value，身份稳定 | 两次当前观察均为目标值 | 原执行已验证成功、变化一定由原 submit 导致 |
| `original_stably_observed` | 两次均唯一读到 expected-before value，身份稳定 | 两次当前观察均为原值 | 原 click 未发生、原 Grant 可以重试 |
| `other_value_stably_observed` | 两次均读到同一其他值，身份稳定 | 当前值存在外部或未知漂移 | 原执行成功或失败 |
| `inconclusive_permanent` | 两次不一致，或任一 proof/identity/value 无法唯一证明 | 对账仍无法确定，原执行永久未知 | 再观察一次即可升级、默认采用最后值 |

四种 outcome 都只能形成独立观察性 READBACK，不得把原 execution 改为 verified/failed，也不得返还 slot、daily count、cooldown 或 impact budget。

### 13.5.3 后续写入

对账完成不恢复旧写入权。若未来仍需处理同一业务对象，必须从当时的当前 StoreContext 重新取得：

```text
current report/import/evidence
→ latest Mission/Analysis/action revision
→ new Decision path
→ new MissionGrant
→ fresh Ads identity/session/entity/current bid preflight
```

旧 UNKNOWN 链只读保留并必须参与冲突和风险判断；不得复制、复用或“重新打开”旧 slot、batch 或 Grant。

## 13.6 人工接管

人工接管用于：

- 查看当前浏览器和对象；
- 处理登录/页面异常；
- 停止自动流程；
- 发起只读对账；
- 记录人工观察。

人工接管不得：

- 伪造系统回读；
- 消除 UNKNOWN 历史；
- 重新提交原动作；
- 绕过 Grant；
- 把手工文字标记为 verified execution。

## 13.7 经营实验

### 实验创建前提

- 当前 store/product/Mission；
- verified Decision；
- 对应 action/READBACK；
- 当前 formal business data baseline；
- 明确 primary metric；
- guardrail metrics/criteria；
- observation window。

### 实验状态

```text
draft → running ↔ paused → completed
draft / running / paused / completed → archived
archived --restore--> 由领域服务恢复到合法的非归档状态
```

### 实验输出

- baseline snapshot；
- observation snapshots；
- result snapshot；
- guardrail 状态；
- 系统判定；
- 限制说明；
- EFFECT 事件；
- 可进入经营记忆的证据。

操作者可以输入假设和备注，但不能用自由文本直接提前完成实验或推进 Mission 到 EFFECT。

## 13.8 需求

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-EXE-001 | MUST | v1.6.0 只允许当前已核验 keyword 的具体 bid reduction | AC-EXE-001 |
| V16-EXE-002 | MUST | 有效降幅上限必须为 `min(10%, Grant.maxChangePct)`，bid increase 永久阻断 | AC-EXE-002 |
| V16-EXE-003 | MUST | 所有 preflight 完成且 submit intent 持久化后才允许第一次保存 | AC-EXE-003 |
| V16-EXE-004 | MUST | 每个 action slot 最多一次 submit，batch 必须串行 | AC-EXE-004 |
| V16-EXE-005 | MUST | 成功必须具备 before、after、reload 和 verifier 证明 | AC-EXE-005 |
| V16-EXE-006 | MUST | 当前对象/账号/match type/bid/page identity 任一不唯一或漂移时写入次数为 0 | AC-EXE-006 |
| V16-EXE-007 | MUST | UNKNOWN 必须停止 batch、禁止原写入自动重试和跳过 | AC-EXE-007 |
| V16-EXE-008 | MUST | UNKNOWN 对账必须是两次只读观察、独立证明、另记 READBACK，不重写原历史 | AC-EXE-008 |
| V16-EXE-009 | MUST | 人工接管不得绕过 Grant、重试原写入或伪造 verified 结果 | AC-EXE-009 |
| V16-EXE-010 | MUST | kill switch 是当前 StoreContext 写入域的紧急停止机制；触发后任何待授权或待执行写入立即阻断，但安全只读对账仍可进行 | AC-EXE-010 |
| V16-EXE-011 | MUST | UNKNOWN 后 slot 视为 spent、batch 为 stopped_unknown、未提交 slots 被阻断、Grant residual authority 为 0 | AC-EXE-011 |
| V16-EXE-012 | MUST | 每个 unknown intent 最多一个 reconciliation case，且恰好执行 reload 前后两个独立 observation slots | AC-EXE-012 |
| V16-EXE-013 | MUST | 对账只能产生四种规范 outcome；任一不一致或证据不足必须为 inconclusive_permanent，禁止第三次观察升级 | AC-EXE-013 |
| V16-EXE-014 | MUST | UNKNOWN 后任何新写入必须从当前 StoreContext 建立新的完整 Mission/Analysis/Decision/Grant authority 链 | AC-EXE-014 |
| V16-EXE-015 | MUST | UNKNOWN 保守占用 daily count、cooldown 和最大可能 impact budget，对账不得返还 | AC-EXE-015 |
| V16-EXE-016 | MUST | submit 后 mode/policy/session/revision 漂移不得改写已发生事实，但必须停止后续写入并只允许受限 readback | AC-EXE-016 |
| V16-EXP-001 | MUST | Experiment 必须绑定当前 store、Mission、product/ad entity 和 verified Decision/READBACK | AC-EXP-001 |
| V16-EXP-002 | MUST | baseline/metric snapshot 必须来自当前权威正式数据和对应 dataBatchId | AC-EXP-002 |
| V16-EXP-003 | MUST | 观察窗未结束、指标不足或 guardrail 触发时不得形成成功 EFFECT | AC-EXP-003 |
| V16-EXP-004 | MUST | 实验结论和 Mission EFFECT/completed 必须由系统判定，不接受自由文本直接推进 | AC-EXP-004 |
| V16-EXP-005 | SHOULD | 实验结果明确显示样本、观察窗、护栏、限制和“需要更多样本”语义 | AC-EXP-005 |

---

# 14. 模块五：经营记忆

## 14.1 模块目标

经营记忆不是通用聊天记忆，也不是 AI 可以自由改写的长期提示词。它是当前店铺经过约束的经营观察和不可变操作记录，用于回答：

- 当时基于什么事实；
- 做了什么决策和动作；
- 写入后实际读到了什么；
- 观察期后发生了什么；
- 哪些结论仍受样本、时间窗和护栏限制。

### 用户故事

| 用户故事 ID | 作为 | 我希望 | 从而 |
|---|---|---|---|
| US-MEM-01 | 运营操作者 | 按当前店铺、产品、阶段和关键词检索历史 | 找到可复核的相似经营观察 |
| US-MEM-02 | 复核者 | 从 EFFECT 回看 Decision、ACTION 和 READBACK 证据 | 理解结论边界而不是只看摘要 |
| US-MEM-03 | 运营操作者 | 追加修正并安全导出时间线 | 保留历史真实性且不泄露本地秘密 |

### 页面与权限合同

| 项目 | 合同 |
|---|---|
| 主要动作 | 有筛选结果时“查看证据链”；需要交接时“导出当前范围” |
| 空状态 | 区分当前店铺无事件、筛选无结果、记录存在但不符合可信索引 |
| 加载状态 | 时间线与 Inspector 独立加载；切店立即清空旧店结果 |
| 阻断/错误 | evidence 不可解析、proof 无效、跨店或 UNKNOWN 时显示不可进入可信索引原因 |
| 成功状态 | 仅对 proof 合格的 READBACK/EFFECT 使用可信/verified 语义 |
| 权限边界 | UI 只能追加 correction，不得覆盖或物理删除因果事件 |
| 跨模块链接 | 回链 Mission、Analysis、Decision、Execution、Experiment 和对应证据 |

## 14.2 可进入可信索引的记录

可信经营记忆至少满足：

- 属于当前 store；
- 如有产品，属于当前 product；
- stage 为 `READBACK` 或 `EFFECT`，或作为其明确上游链路；
- status 非 UNKNOWN；
- 有合法 opaque evidence ref；
- 有 SHA-256 proof；
- 能回链 Mission、Decision、ACTION/READBACK/Experiment；
- 记录 actor、business date、session generation；
- 文案不把单次相关性夸大为永久因果。

## 14.3 因果阶段

```text
FACT
ANALYSIS
DECISION
ACTION
READBACK
EFFECT
```

经营记忆 UI 可以展示完整链，但用于后续分析的“可信历史摘要”必须优先使用已验证的 READBACK/EFFECT，并携带限制。

## 14.4 修正与删除

- 因果事件采用 append-only；
- 错误记录通过 correction 指向被修正记录；
- 不覆盖或物理删除历史；
- 导出保留修正关系；
- 历史文本传给 AI 时按不可信 user context 处理，不能成为 system instruction。

## 14.5 需求

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-MEM-001 | MUST | 经营记忆按当前店铺重建和检索，跨店事件必须阻断 | AC-MEM-001 |
| V16-MEM-002 | MUST | UNKNOWN 或缺 proof 的记录不得进入可信记忆索引 | AC-MEM-002 |
| V16-MEM-003 | MUST | 可信 READBACK/EFFECT 必须保留 Mission、对象、business date、session generation 和 evidence proof | AC-MEM-003 |
| V16-MEM-004 | MUST | 历史只能追加修正，不能覆盖或硬删除 | AC-MEM-004 |
| V16-MEM-005 | MUST | 记忆文本作为 AI 不可信 user context，不能覆盖系统安全指令 | AC-MEM-005 |
| V16-MEM-006 | MUST | JSON 导出必须包含 US/USD 范围、业务日期、记录、检索词和证据引用，不含秘密或本地敏感路径 | AC-MEM-006 |
| V16-MEM-007 | SHOULD | 单样本结果标记为观察并显示限制，不使用“已证明永久有效”等夸大语言 | AC-MEM-007 |

---

# 15. 模块六：系统设置

## 15.0 模块体验合同

### 用户故事

| 用户故事 ID | 作为 | 我希望 | 从而 |
|---|---|---|---|
| US-SET-01 | 运营操作者 | 分别确认 ERP 与 Ads 的连接、会话和身份事实 | 知道哪些只读/写入能力当前可用 |
| US-SET-02 | 风控操作者 | 查看策略版本、上限、时间窗、急停和熔断 | 清楚自动化不会越过哪些边界 |
| US-SET-03 | 风控操作者 | 切换写入模式时输入真实业务原因 | 权限变化可追溯且不会静默覆盖 |
| US-SET-04 | 交付验证者 | 查看当前包、数据和 readiness 门禁状态 | 不把静态或历史证据误认为当前通过 |

### 页面与权限合同

| 项目 | 合同 |
|---|---|
| 主要动作 | 当前最大阻断决定“连接/重新检测”“配置策略”“设置调度”或“查看交付门” |
| 空状态 | 未配置店铺、连接、策略、AI、scheduler 分别提供受限配置入口 |
| 加载状态 | 店铺 bootstrap、连接检测、策略 runtime、readiness 分区加载并显示时间 |
| 阻断/错误 | 凭证不回显；CAS 冲突要求刷新；连接失败区分 ERP 与 Ads；禁令门保持 pending |
| 成功状态 | 保存成功、session ready、policy enabled、readiness 通过均由 Main/验证器事实驱动 |
| 权限边界 | Renderer 不接触秘密、Profile 路径或任意文件/DB；所有 authority 变更要求 reason/CAS |
| 跨模块链接 | 连接/策略修复后回到原 blocker；交付页回链相应证据而不自行改 DELIVERY |

## 15.1 店铺与连接

每个店铺独立配置：

- store identity；
- US/USD；
- America/Los_Angeles 业务时区；
- 独立 browser Profile；
- 领星 ERP connection/session；
- Amazon Ads connection/session；
- 当前写入权限模式；
- policy runtime；
- scheduler；
- AI provider 本地配置。

ERP 和 Ads 必须分开显示：

- ERP ready 可以支持只读采集；
- Ads unavailable/identity mismatch 必须阻断执行；
- 不允许用“浏览器已打开”替代 session/identity truth。

## 15.2 两种 Ads 写入权限模式

写入权限模式只决定 Decision/Grant 的授权路径和 issuer，不表示采集、分析或调度的自动化程度。

| 能力维度 | `manual_approval` | `policy_auto` |
|---|---|---|
| 采集/正式数据检查 | 手动或 scheduler | 手动或 scheduler |
| Analysis Run | 手动或 scheduler | 手动或 scheduler |
| Decision path | 操作者逐条 human Decision | 当前 enabled policy 对完整 batch 形成 policy Decision |
| Grant issuer | `human_operator` | `policy_runtime` |
| execution trigger | 人工启动或合规调度触发 | 人工启动或合规调度触发 |
| execution gates | 全部适用 | 同样全部适用，不放宽 |
| readback/UNKNOWN | 全部适用 | 同样全部适用 |

### 人工审批 `manual_approval`

- 建议必须由操作者逐条判断并记录 reason；
- 最新完整 action batch 必须由 human issuer 显式签发 Grant；
- Ads 写入仍经过全部执行门禁。

### 策略内自动 `policy_auto`

- 只有 active、enabled、当前 revision 的 policy version 可以参与；
- 完整 batch 的每个 proposal 必须满足 policy eligibility；
- 由 `policy_runtime` 对完整最新 action batch 自动形成 policy Decision/Grant；
- 不要求人工补签，也不允许人工补齐不合格 proposal 后继续称为 policy-auto；
- 不放宽对象、变化、证据、session、readback、kill switch、breaker、窗口、限额、冷却或每日次数门禁。

### “半自动”的处理

v1.6.0 不增加或持久化第三个 Ads write-authority mode。“半自动”只能描述以下 `manual_approval` 用户体验：

```text
自动采集/自动分析/自动生成建议
+ 人工 Decision
+ 人工 MissionGrant
+ 受控执行
```

即：调度自动化与写入 authority 分离；“半自动”不得作为 mode、issuer 或绕过人工 Grant 的理由。

## 15.3 策略版本

策略规则至少包括：

- allowedActionTypes；
- allowedAdEntityIds；
- maxChangePct；
- totalImpactBudget；
- maxDailyActionCount；
- cooldownMinutes；
- executionWindow（IANA timezone、星期、开始/结束）；
- requiredEvidence；
- stopConditions；
- killSwitch。

规则：

- draft 版本不可授权；
- enabled 版本不可被原地修改；
- 变更创建新版本；
- active runtime 明确指向版本；
- policy revision 漂移使旧 Grant 无效；
- v1.6.0 执行窗口不跨午夜。

### 15.3.1 写入 gate 优先级

所有 gate 仍为 AND；优先级只决定 primary blocker、失效范围和恢复入口，不表示后续 gate 可以跳过：

```text
P0  kill switch
P1  circuit breaker
P2  StoreContext / Ads account / session / identity
P3  Mission / action / authorityMode / policy revision
P4  Grant validity / expiry / residual authority
P5  action/entity scope / window / daily count / impact budget / cooldown
P6  evidence freshness / page identity / expected-before current value
```

规则：

- P0–P5 任一失败均使当前写入 submit=0，并按合同使 pending Grant/preflight/未提交 slots 失效；
- P6 只有在 click=0 有 durable proof、Grant 尚未终止且其他 authority 全部不变时，才可修复后全量重验同一 pending slot；
- gate 失败可以同时返回全部 blocker，但 UI 只按上述优先级选择一个 primary 恢复动作；
- kill switch/open breaker 阻断授权和写入，但不得阻断安全只读 readback/reconciliation；
- policy/mode/session/revision 在 submit 后变化，不追溯删除既有 submit 事实，但立即停止后续 slots；
- budget 在 submit intent 前按当前 proposal 预留，verified/failed/UNKNOWN 按规范结算；UNKNOWN 不退款；
- 解除 blocker、切回旧 mode/policy 或关闭 kill switch 不得复活 terminal Grant、batch 或 slot。

### 15.3.2 授权阶段分离

| 阶段 | 必须验证 | 允许结果 |
|---|---|---|
| Grant issuance | 完整 batch、mode/issuer、policy、scope、limits、evidence | issued 或 blocked；不触发 Ads submit |
| just-before-submit | P0–P6、session/entity/current bid、unique intent | click=0 或当前 slot 至多一次 submit |
| post-submit readback | 历史 Grant/intent 绑定、当前只读身份、after/reload proof | verified/failed-with-proof/UNKNOWN；不得追加 submit |

## 15.4 模式/策略变更 reason

所有模式和权限变更必须：

1. UI 显示将自动化什么、仍阻断什么；
2. 用户输入非空业务原因；
3. reason 通过 Renderer → Preload → Main；
4. Main 以当前 expectedRevision/CAS 更新，并递增 `authorityModeRevision` 或对应 policy runtime revision；
5. durable audit 保存真实 reason、actor、old/new mode 与 revision；
6. 成功变更使旧 pending Decision/Grant/preflight/未提交 slots 终止失效，但不改写已 submit 历史或阻断只读回读；
7. 失败时保留原模式并显示原因；
8. 切回旧值不复活旧 authority，且变更只影响当前 StoreContext。

固定技术字符串不能替代操作者业务原因。

## 15.5 定时任务

Scheduler 可以自动执行：

- 报表采集准备/任务；
- 正式数据检查；
- Analysis Run；
- 日报/本地报告；
- 清理和维护任务。

Scheduler 不可直接绕过 Decision/Grant 执行 Ads 写入。policy-auto 的自动授权和执行仍必须逐次满足当前 authority。

## 15.6 AI 与本地配置

- AI provider 采用 OpenAI-compatible 配置；
- Key 使用本地安全存储；
- UI 只显示掩码和连接状态；
- 测试连接不回显秘密；
- 无 AI Key 时按明确规则回退或阻断；
- Listing 草案仍只保存本地；
- 本地支持路径可以展示给用户，但不得进入 Renderer 领域记录或外部日志。

## 15.7 需求

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-SET-001 | MUST | ERP 和 Ads connection/session/identity 必须独立投影，ERP ready 不等于 Ads 可执行 | AC-SET-001 |
| V16-SET-002 | MUST | 每个店铺恢复自己的 mode、policy runtime、Profile 和 scheduler，不跨店复用 | AC-SET-002 |
| V16-POL-001 | MUST | Ads 写入 authority 仅有 manual_approval 和 policy_auto 两种 | AC-POL-001 |
| V16-POL-002 | MUST | 调度自动化与 Ads 写入 authority 必须分离；manual_approval 始终要求 human Grant，policy_auto 始终要求当前 policy-runtime Grant，“半自动”不得成为第三 mode | AC-POL-002 |
| V16-POL-003 | MUST | policy-auto 必须使用 active enabled 当前版本，并满足 scope/priority/entity/action/window/count/cooldown/limit/evidence 条件 | AC-POL-003 |
| V16-POL-004 | MUST | kill switch 或 open circuit breaker 必须阻断新授权和写入，但不得阻断安全只读 readback/reconciliation | AC-POL-004 |
| V16-POL-005 | MUST | 策略版本启用后不可原地修改，变更必须生成新版本 | AC-POL-005 |
| V16-POL-006 | MUST | 模式、kill switch、circuit breaker、active policy 变更必须使用 expectedRevision/CAS | AC-POL-006 |
| V16-POL-007 | MUST | 所有模式/权限变更的真实 operator reason 必须端到端持久化 | AC-POL-007 |
| V16-POL-008 | MUST | P0–P6 gate precedence 必须确定性计算；所有 gate 为 AND，优先级不得被解释为跳过后续门禁 | AC-POL-008 |
| V16-POL-009 | MUST | hard gate invalidation 和 terminal Grant/batch/slot 不得因恢复旧配置而复活 | AC-POL-009 |
| V16-POL-010 | MUST | 只有 click=0 有 durable proof、Grant 未终止且 authority 未漂移的 P6 transient blocker 才允许全量重验后继续 pending slot | AC-POL-010 |
| V16-POL-011 | MUST | Grant issuance、just-before-submit 与 post-submit readback 必须使用不同阶段合同，readback 不得追加写入 | AC-POL-011 |
| V16-POL-012 | MUST | mode change 必须递增 authorityModeRevision 并终止旧 pending authority；切回旧 mode 不得复活 | AC-POL-012 |
| V16-POL-013 | MUST | trigger、proposal source、Decision actor、Grant issuer 和 execution worker 必须分离记录，只有合法 human/policy issuer 可签发 Grant | AC-POL-013 |
| V16-SCH-001 | MUST | scheduler 可自动采集和分析，但不能绕过当前 mode 对应的 Decision、Grant 和 execution gate，也不能成为 Grant issuer | AC-SCH-001 |
| V16-AI-001 | MUST | AI Key/凭证不得以明文出现在 UI、日志、Prompt、测试、文档或仓库 | AC-AI-001 |
| V16-AI-002 | MUST | AI 输出必须结构化验证；无效、超时、取消和 fallback 状态必须可审计 | AC-AI-002 |
| V16-AI-003 | MUST | AI 不拥有 Grant 签发或 Ads 写入 authority | AC-AI-003 |

---

# 16. 数据与领域模型需求

## 16.1 关键逻辑实体

本文档不复制旧 PRD 中可能已经过时的示意 SQL。现有 SQLite repository/migration/shared-types 仅作为 v1.5.1 inventory 和兼容设计输入；本文档定义 v1.6.0 目标不变量。某实体或代码路径当前存在，不表示 v1.6.0 已实现、已迁移或已验收。

| 实体 | 必要归属/字段摘要 | 不变量 |
|---|---|---|
| StoreContext | storeId、US/USD、businessDate、sessionGeneration | 当前唯一、跨店不可复用 |
| Product | storeId、产品标识、经营配置 | 配置不是 authority |
| Collection Batch | store、日期、production_full lineage、8 report states | 不跨批次拼接 |
| Import Run | batch、8 reconciliations、metrics、completed state | exact current row |
| Evidence Package | mission、batch/import、8 sources/hashes、rule/model、freshness | sealed、不可变 |
| Analysis Run Receipt | store/mission/input、stage/result/timing/reuse | 每次尝试可追溯 |
| Action Batch | missionRevision、evidence、rule/model、actionRevision | 不可变 |
| Proposal Snapshot | batch、entity authority、current/proposed bid、eligibility | 不可变、仅 keyword lower bid 可执行 |
| Decision | mission/batch/policy/action revision、status/history/reason | optimistic concurrency |
| MissionGrant | decisions/entities/limits/evidence/expiry/policy/session/mode/issuer | 不可变、整批 |
| Grant Residual Event | grant/slot/event/reason/count/budget/time | append-only、终态不复活 |
| Execution Intent | grant/action/entity/expected before/target/idempotency | submit 前持久化 |
| Execution Slot/Batch | authority consumption、execution outcome、batch outcome | 三个维度正交 |
| Readback Evidence | before/after/reload、identity、value、proof | 追加式、独立证明 |
| Reconciliation Case | unknown intent、两个 observation slots、规范 outcome | 每 unknown intent 至多一个 |
| Experiment | mission/product/entity/baseline/window/guardrails | 系统结论 |
| Causal Event | store/stage/mission/entity/businessDate/session/proof | append-only correction |
| Schema/Migration Receipt | source/target schema、step、status、hash、backup ref | 不授予业务 authority |
| Legacy Classification | record identity、class、reason、validation revision | 不允许默认补 authority |
| Template Compatibility Entry | report type、template revision、fields/aliases/grain/units | 版本化、歧义即阻断 |
| Evidence Ref Mapping | opaque ref、kind、scope、proof、resolver version | Main-only 安全解析 |

## 16.2 数据谱系

任一可执行 proposal 必须能完整追踪：

```text
StoreContext
  → Collection Batch
  → Report File Hash + Source Row
  → Import Run + Reconciliation
  → Evidence Package Hash
  → Mission + Revision
  → Analysis Run Receipt
  → Action Batch + Revision
  → Proposal Snapshot
  → Decision + History
  → MissionGrant
  → Execution Intent
  → Before/After/Reload
  → Experiment Snapshot
  → EFFECT / Causal Memory
```

## 16.3 数据需求

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-DOM-001 | MUST | 所有可执行对象必须具备从当前 StoreContext 到 proposal 的完整可验证谱系 | AC-DOM-001 |
| V16-DOM-002 | MUST | 对 authority 有影响的实体必须包含 revision 或不可变 identity，并在写入时校验 | AC-DOM-002 |
| V16-DOM-003 | MUST | Evidence Package、action batch、proposal、Grant、audit/readback 记录必须不可变或追加式 | AC-DOM-003 |
| V16-DOM-004 | MUST | Evidence ref 必须是 opaque logical ID，不得是本地绝对路径或 file URI | AC-DOM-004 |
| V16-DOM-005 | MUST | Renderer projection 不得包含 Cookie、密码、Token、Profile 路径或原始证据绝对路径 | AC-DOM-005 |
| V16-DOM-006 | MUST | 时间戳、业务日期、时区、过期时间必须可验证，未来/过期/非法值按合同阻断 | AC-DOM-006 |
| V16-DOM-007 | MUST | slot authority consumption、execution outcome、batch outcome 与 Grant residual authority 必须分离持久化和派生 | AC-DOM-007 |
| V16-DOM-008 | MUST | 每个 unknown submit intent 最多关联一个 reconciliation case，case 固定两个 observation slots | AC-DOM-008 |

## 16.4 Legacy record 分类

升级前必须将 legacy authority/evidence 记录按目标合同分类：

| 分类 | 含义 | v1.6.0 可用性 |
|---|---|---|
| `validated-compatible` | 必需字段、作用域、revision/proof 均经目标规则验证 | 仅在记录类型明确允许时作为当前只读/业务输入；仍需 currentness 重验 |
| `historical-read-only` | 历史真实但缺少当前执行 authority | 只读展示/审计，不可签发 Grant 或执行 |
| `re-derivation-required` | 可由正式原始事实按当前规则重新派生 | 必须产生新 record/revision，不修改旧记录 |
| `quarantined` | 歧义、损坏、跨店、缺 proof 或无法验证 | 不可用于业务主链，只显示安全 blocker |

禁止使用当前 store/session/revision、Renderer selection、默认 issuer 或空字段补齐旧记录；禁止复活旧 Grant、把旧文本状态提升为 verified，或把 migration receipt 当作 execution proof。

## 16.5 Schema upgrade 与 rollback

v1.6.0 实施必须在 **Migration and Compatibility** companion specification 中定义：

- 支持的 source/target schema versions 和有序 migration steps；
- upgrade 前 WAL-safe backup、输入 hash、空间/完整性预检；
- migration 的 transaction、幂等、可恢复中断和 durable receipt；
- partial、unknown 或 future schema 的 fail-closed 读取/写入策略；
- immutable/append-only authority 历史跨版本保留；
- 旧 binary 对不支持的新 schema 拒绝写入；
- rollback 优先恢复经验证的升级前 backup，不自动执行 destructive down migration；
- 已有目标版本新写入时禁止静默覆盖；
- rollback 或恢复失败时保持 `BLOCKED / NON_READY`。

## 16.6 Projection、Preload 与 evidence-ref compatibility

每个 v1.6.0 projection/API 必须定义 contract version、capability identity、repository source、Main owner、typed preload request/response、StoreContext/session/revision/currentness 字段、stale/error/unsupported 状态、Renderer consumer 和兼容/退役策略。

约束：

- 缺安全字段返回 `unsupported/blocked`，Renderer 不得默认补值；
- Preload 保持 typed、store-scoped、minimum-capability，不增加 generic invoke、任意 fs/db 或 raw path 能力；
- legacy absolute evidence path 只允许 Main 在受控迁移中验证并映射为 opaque ref；
- evidence hash 单独存在不足以提升 authority，映射必须验证 scope、kind、proof 和 resolver version；
- malformed、expired、deleted、legacy 或跨店 ref 必须显示可解释 blocker，并在导出中保留安全占位而非泄露路径。

## 16.7 迁移与兼容需求

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-MIG-001 | MUST | 所有 legacy authority/evidence records 必须进入四类之一并记录 reason/validation revision | AC-MIG-001 |
| V16-MIG-002 | MUST | migration 不得通过默认补值把 legacy record 提升为当前可执行 authority | AC-MIG-002 |
| V16-MIG-003 | MUST | schema upgrade 必须 transactional、idempotent、可从中断恢复并产生 durable receipt | AC-MIG-003 |
| V16-MIG-004 | MUST | unknown/future/partial schema 必须 fail-closed，旧 binary 不得写入不支持的新 schema | AC-MIG-004 |
| V16-MIG-005 | MUST | upgrade 前必须有经验证的 WAL-safe backup；rollback 不得静默覆盖目标版本新写入或执行 destructive down migration | AC-MIG-005 |
| V16-MIG-006 | MUST | exact-eight template compatibility 必须来自版本化 manifest，未知或歧义模板拒绝导入 | AC-MIG-006 |
| V16-MIG-007 | MUST | Main/Preload/Renderer projection/API 必须版本化，缺字段或版本不兼容时返回 blocked/unsupported | AC-MIG-007 |
| V16-MIG-008 | MUST | legacy evidence path 只能在 Main 映射为经 scope/proof 验证的 opaque ref，不得进入 Renderer payload | AC-MIG-008 |
| V16-MIG-009 | MUST | migration、兼容读取和历史可见性不得继承 prior-version acceptance credit | AC-MIG-009 |
| V16-MIG-010 | MUST | 迁移实施必须闭合本文规定的三份 companion specifications 与当前 PRD/AC traceability | AC-MIG-010 |

---

# 17. AI、规则与提示安全

## 17.1 AI 角色

AI 可以：

- 生成广告诊断；
- 解释规则结果；
- 生成建议文案；
- 生成日报；
- 评估证据充分性；
- 生成 Listing 本地草案；
- 帮助总结经营记忆中的历史观察。

AI 不可以：

- 自己选择另一个店铺；
- 修改正式报表事实；
- 伪造 stable Ads ID/current bid；
- 批准 Decision；
- 签发 MissionGrant；
- 关闭 kill switch；
- 绕过 policy；
- 直接点击 Ads 保存；
- 把历史文本当作系统指令；
- 提交 Listing。

## 17.2 AI 结果来源与授权资格

| source | 含义 | `manual_approval` | `policy_auto` | fail-closed 条件 |
|---|---|---|---|---|
| `rule` | 纯规则结果 | 可进入人工判断 | 可评估 policy eligibility | 仍需完整 evidence、entity、policy 和 execution gates |
| `rule_ai` | AI 与规则在全部可执行事实上一致 | 可进入人工判断 | 可评估 policy eligibility | 任一对象、方向、current/target value、幅度或限制不一致即 `AI_RULE_CONFLICT` |
| `ai` | AI-only | 仅可进入人工判断 | 禁止 | 不得因 AI 置信度或人工备注获得 policy-auto authority |
| `rule_fallback` | AI 不可用后的规则回退 | 仅可进入人工复核，默认不可直接授权 | 禁止 | 显式标记 `RULE_FALLBACK_NOT_AUTHORIZABLE`，不得冒充 `rule`/`rule_ai` |

source 必须唯一且不可由 Renderer 修改。人工审批不能把 policy-ineligible source 重新标记为 policy-auto；需要不同结果时必须形成新的 Analysis/action revision。

## 17.3 Prompt 注入与历史上下文

来自报表文本、Listing、运营事件、网页、经营记忆或用户自由文本的内容均作为不可信数据：

- 不能改变 system/developer safety contract；
- 不能调用未授权工具；
- 不能要求输出秘密；
- 不能扩大 action type；
- 不能改变 StoreContext；
- 不能把描述性内容解释为批准。

## 17.4 AI 可恢复性

AI 调用必须支持：

- 超时；
- 取消；
- app/session 中断后的 interrupted receipt；
- 结构化解析错误；
- provider 未配置；
- provider/network 错误；
- 明确规则回退；
- 重试时保持幂等和无重复建议。

## 17.5 AI 价值与成本治理

AI 能力按价值和可替代性分层：

| 等级 | 典型场景 | 对主链的影响 | fallback |
|---|---|---|---|
| A0 | 权限、数值门禁、确定性计算 | AI 不参与 | 纯规则 |
| A1 | 解释、摘要、中文表达 | 不得阻断核心事实链 | 模板化解释 |
| A2 | 诊断假设、Listing 草案、建议补充 | 可缺省，不得产生 authority | 规则结果或不生成 |
| A3 | 影响 proposal 内容的结构化分析 | 失败可导致人工复核/阻断，但不能授权 | fail-closed 或显式 rule fallback |

每次可计费 AI 调用必须形成 store-scoped AI Cost Record，至少记录 provider/model、purpose、input/output usage、费用状态 `reported | estimated | unknown`、预算 policy revision、开始/结束状态和 fallback。provider 未返回统一 usage/cost 时必须记为 `unknown`，不得记为零。

自动付费调用必须受独立 AI Spend Policy 约束；无法证明剩余预算时 fail-closed 或进入明确 rule fallback。AI spend budget 不构成 Ads authority，也不得与 `MissionGrant.totalImpactBudget` 混用。

AI Value Evaluation Record 必须以人工评估 rubric、基线、样本、时间窗和限制评价解释质量、采纳价值、节省时间或误导风险。Decision 被批准、Ads 写入成功或一次 EFFECT 不能单独证明 AI 产生因果价值。

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-AI-004 | MUST | 每个 AI 场景必须声明 A0–A3 价值等级、是否必要、fallback 和是否允许阻断 | AC-AI-004 |
| V16-AI-005 | MUST | 可计费调用必须记录 usage/cost 状态；未知费用不得记零 | AC-AI-005 |
| V16-AI-006 | MUST | 自动付费调用必须验证当前 store-scoped spend policy，无法证明预算余量时 fail-closed 或 rule fallback | AC-AI-006 |
| V16-AI-007 | MUST | AI 费用预算与 Ads impact budget 必须使用独立记录、单位、revision 和 authority | AC-AI-007 |
| V16-AI-008 | SHOULD | AI 价值评价使用版本化 rubric、基线、样本与限制，不以单次批准/写入/EFFECT 推断因果价值 | AC-AI-008 |
| V16-AI-009 | MUST | AI value/cost records 不得包含秘密、raw path 或超出已声明目的的业务数据 | AC-AI-009 |

---

# 18. UX 与视觉需求

## 18.1 视觉方向

- 浅色 Windows 运营控制台；
- 页面底色低噪音，内容表面为白色或浅色；
- 主色用于当前任务和主要动作；
- 绿色只用于经过事实验证的成功；
- 黄色/琥珀用于注意、待确认和可恢复阻断；
- 红色只用于硬阻断、失败和高风险；
- 使用 Segoe UI、Microsoft YaHei 等本地/system 字体；
- 不依赖 Google Fonts；
- 不提供暗色切换。

## 18.2 页面信息顺序

每个核心页面按以下层级组织：

```text
1. 当前 StoreContext
2. 页面标题与当前状态
3. 唯一主要任务 / 下一动作
4. 摘要指标
5. 核心工作区
6. 次级证据与历史
7. 折叠诊断 / Inspector
```

## 18.3 业务语言

普通 UI 使用中文业务语言。例如：

| 工程词 | 普通 UI 建议 |
|---|---|
| missionRevision mismatch | 当前任务已更新，请刷新后重新处理 |
| session generation mismatch | 当前广告会话已变化，请重新确认连接 |
| evidence package stale | 本次分析证据已过期，请重新采集或运行分析 |
| unknown execution | 执行结果未知，系统不会自动重试 |
| policy runtime blocked | 当前策略不允许自动授权，请查看策略边界 |
| entity authority missing | 尚未唯一核验当前广告对象 |

内部 ID、hash、revision、source row 和技术 blocker code 放在折叠诊断区域。

## 18.4 交互状态

所有异步动作必须提供：

1. 点击后的即时反馈；
2. `aria-busy` 或等效 loading 状态；
3. 分阶段/确定性进度（可提供时）；
4. 完成、失败、取消或阻断结果；
5. 下一动作或恢复入口；
6. 防重复提交；
7. 切店/卸载时取消或忽略陈旧响应。

## 18.5 复用工作台组件

产品实现应复用已有工作台合同：

- `PageFrame`；
- `TaskBanner`；
- `SummaryStrip`；
- `WorkspaceState`；
- `PriorityDataTable`；
- `ReasonRequiredDialog`；
- `ResponsiveInspector`；
- `WorkbenchPanel`；
- `WorkspaceSubviewShell`；
- `ActionMenu`。

页面可以有领域专用组件，但不应重新定义一套冲突的状态色、按钮层级、弹窗或表格行为。

## 18.6 响应和可访问性

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-UI-001 | MUST | 核心工作区必须在 1366×768、100%、125% 和规定 wide/minimum 档可操作 | AC-UI-003 |
| V16-UI-002 | MUST | 弹窗正文可滚动且 footer 动作始终可达，不能因缩放遮挡 | AC-UI-004 |
| V16-UI-003 | MUST | 键盘焦点可见，主要交互支持键盘，关闭后焦点合理恢复 | AC-UI-005 |
| V16-UI-004 | MUST | 支持 reduced-motion 偏好，关键信息不依赖动画表达 | AC-UI-006 |
| V16-UI-005 | MUST | disabled 控件必须解释原因并在可恢复时提供入口 | AC-UI-007 |
| V16-UI-006 | MUST | 普通页面不得显示秘密、原始路径或不必要的内部 ID/revision | AC-UI-008 |
| V16-UI-007 | MUST | 成功色只用于 verified 状态，UNKNOWN/blocked 不得使用成功语义 | AC-UI-009 |
| V16-UI-008 | SHOULD | 大表格使用 priority/virtualization，低优先列在窄屏进入详情或隐藏 | AC-UI-010 |
| V16-UI-009 | SHOULD | Inspector 在宽屏为侧栏、窄屏为可达抽屉/底层，不遮挡主要动作 | AC-UI-011 |
| V16-UI-010 | MUST | 业务中文、规范英文领域标识、内部 code 和仅诊断字段必须遵循版本化 UI terminology table | AC-UI-012 |
| V16-UI-011 | MUST | modal/dialog 必须验证初始焦点、焦点约束、Escape 行为和关闭后焦点恢复，不能只验证 ARIA 属性存在 | AC-UI-013 |
| V16-UI-012 | MUST | v1.6.0 必须维护相对 v1.5.1 primitives 的 Accessibility Delta Register；未验证项不得声明改善或标准合规 | AC-UI-014 |

## 18.7 UI 术语与可访问性差距治理

普通 UI 术语至少遵守：

| 领域标识 | 普通 UI | 可出现英文标识的位置 |
|---|---|---|
| Mission | 运营任务 | 详情标题后的次级标签/诊断 |
| Analysis Run | 分析运行 | 运行详情/导出 schema |
| Decision | 运营判断 | lineage 诊断 |
| MissionGrant | 执行授权 | 授权详情/诊断 |
| READBACK | 执行回读 | 因果阶段/导出 |
| EFFECT | 效果观察 | 因果阶段/导出 |
| UNKNOWN | 执行结果未知 | 必须保留规范终态标识并同时给中文解释 |
| `manual_approval` / `policy_auto` | 人工审批 / 策略内自动 | 模式设置和诊断 |

Accessibility Delta Register 必须逐项记录 reused primitive、v1.6.0 新交互、keyboard/focus/screen-reader/reduced-motion/zoom 风险、测试方法、owner 和当前 `PENDING/PASS/FAIL`。存在 aria 属性或开发预览不能替代 Package UI 与键盘行为验证，也不得据此声明未经批准的 WCAG 等级。

---

# 19. 非功能需求

## 19.1 可靠性与一致性

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-NFR-001 | MUST | 可变 authority 更新使用事务和 expectedRevision/CAS；不可变/追加写入使用事务和唯一性/幂等约束，冲突不静默覆盖 | AC-NFR-001 |
| V16-NFR-002 | MUST | 执行 intent、证据和结果在崩溃/重启后可恢复为可解释状态 | AC-NFR-002 |
| V16-NFR-003 | MUST | 重复 query/refresh 不产生重复业务记录；相同幂等 command 不产生重复写入 | AC-NFR-003 |
| V16-NFR-004 | MUST | submit intent 前且 durable fact 证明 click=0 的中断可为 interrupted；submit intent 后无法证明 click=0 或结果时必须为 UNKNOWN，绝不得推断 success | AC-NFR-004 |
| V16-NFR-005 | MUST | 正式 DB 取证使用 WAL-safe、readonly/query_only 方式，验收前后证明零业务写入 | AC-NFR-005 |
| V16-NFR-006 | MUST | submit intent/idempotency/slot reservation 必须形成可恢复的 crash boundary，重启不得分配第二次 submit authority | AC-NFR-006 |
| V16-NFR-007 | MUST | 重启后必须从 durable slot/batch/Grant residual events 重建 authority，不依赖 Renderer memory | AC-NFR-007 |

## 19.2 安全与隐私

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-SEC-001 | MUST | 凭证、AI Key、Cookie、Token 和 Profile 数据不得进入 Renderer domain payload、日志、文档、测试或 Git | AC-SEC-001 |
| V16-SEC-002 | MUST | Preload 只暴露受限、类型化、store-scoped API，不暴露任意 Electron/文件/数据库能力 | AC-SEC-002 |
| V16-SEC-003 | MUST | 外链、导航、新窗口和 Node 环境按 package security contract fail-closed | AC-SEC-003 |
| V16-SEC-004 | MUST | 本地证据引用对 Renderer 使用 opaque logical ID，Main 负责安全解析 | AC-SEC-004 |
| V16-SEC-005 | MUST | 日志和导出对 store/profile/job/import 等敏感标识采用必要的稳定别名或最小披露 | AC-SEC-005 |
| V16-SEC-006 | MUST | v1.6.0 不得默认把业务数据、证据、Prompt、日志或遥测上传到未明确声明的云端服务 | AC-SEC-006 |

## 19.3 性能与可用性

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-PERF-001 | MUST | 用户触发异步动作后必须立即进入反馈状态，禁止无反馈重复点击窗口 | AC-PERF-001 |
| V16-PERF-002 | SHOULD | 大报表和表格采用分页、虚拟化或分段读取，避免 Renderer 一次渲染全部行 | AC-PERF-002 |
| V16-PERF-003 | SHOULD | AI/采集/导入等长任务可取消，并在完成或中断后释放 UI busy 状态 | AC-PERF-003 |
| V16-PERF-004 | SHOULD | 首页和模块切换优先使用 Main 投影摘要，不让 Renderer 扫描全库重建事实 | AC-PERF-004 |

## 19.4 离线与降级

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-OFF-001 | MUST | 网络/ERP/Ads 不可用时，本地产品、历史、实验、记忆和诊断仍可只读访问 | AC-OFF-001 |
| V16-OFF-002 | MUST | ERP 不可用阻断采集；Ads 不可用只阻断执行，不能错误阻断本地分析历史查看 | AC-OFF-002 |
| V16-OFF-003 | MUST | AI provider 不可用时按当前规则显示 fallback/blocked，不影响本地历史完整性 | AC-OFF-003 |

## 19.5 可维护性与可观测性

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-MNT-001 | MUST | Main/Preload/Renderer 的 query/command 合同使用共享类型并保持 store-scoped | AC-MNT-001 |
| V16-MNT-002 | MUST | 关键流程具有结构化业务事件、blocker code、用户文案和诊断 detail | AC-MNT-002 |
| V16-MNT-003 | MUST | preview/prototype fixture 在 production mode 不得作为 fallback | AC-MNT-003 |
| V16-MNT-004 | SHOULD | 六模块重组复用现有 workspace/intent/service，不复制领域实现 | AC-MNT-004 |

## 19.6 数值 NFR 基线与预算治理

文档 1.1 不在缺少可重复测量的情况下编造启动、延迟、内存、导入吞吐或 AI 响应数字。实施必须先定义典型与最大支持 fixture，在相同机器等级、package、DB/schema 和采样方法下建立 Baseline Record，再由产品/工程批准 Budget Record。

至少覆盖：

- cold/warm startup；
- current-store switch 和首页/模块 projection P50/P95；
- exact-eight 典型/最大文件、行数、导入与 Analysis elapsed time；
- Renderer/Main 峰值内存、长表滚动和交互响应；
- SQLite 大小、evidence 日增长、保留与清理上限；
- AI latency、timeout、call/token/cost budget；
- 取消、恢复和离线降级时间。

Baseline 观测值不自动成为可接受预算；Budget 必须版本化记录 metric、fixture、environment、percentile/window、threshold、owner、approval 和 revision。批准前对应数字状态为 `PENDING/UNKNOWN`，不得记为通过。

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-PERF-005 | MUST | M0/M1 必须建立可重复的典型/最大 fixture 和版本化 NFR Baseline Record | AC-PERF-005 |
| V16-PERF-006 | MUST | 每个发布阻断型性能指标必须有经批准的 Budget Record，不得直接把当前观测值当阈值 | AC-PERF-006 |
| V16-PERF-007 | MUST | startup、store switch、projection、exact-eight、analysis、memory、DB/evidence growth 至少进入预算目录 | AC-PERF-007 |
| V16-PERF-008 | MUST | 当前 package 超过批准预算时必须形成 blocker/偏差，不得静默扩大阈值 | AC-PERF-008 |
| V16-PERF-009 | SHOULD | 性能证据保存 fixture/environment/percentile/sample 与 source/package identity，支持跨版本比较 | AC-PERF-009 |

---

# 20. 错误、阻断与恢复合同

## 20.1 状态分类

| 类型 | 含义 | 是否成功 | 用户可做什么 |
|---|---|---:|---|
| ready | 所有当前前提已验证 | 否，仅表示可继续 | 执行下一动作 |
| running | 操作正在进行 | 否 | 查看进度/按合同取消 |
| attention | 仍可使用，但有需关注信息 | 否 | 查看说明 |
| blocked | 当前不能继续，原因明确 | 否 | 前往恢复入口 |
| failed | 已明确失败且未产生目标业务结果 | 否 | 按幂等合同重试/修复 |
| interrupted | submit intent 前流程中断且 durable fact 证明 click=0 | 否 | 刷新权威状态/按合同恢复 |
| unknown | submit-intent/写入边界后无法证明 click=0 或结果；原 slot/batch 永久终止 | 否 | 只执行固定双次只读对账，不重试 |
| inconclusive_permanent | UNKNOWN 双次对账无法形成唯一稳定观察结论 | 否 | 查看结论、保留历史；如需新写入则建立 fresh authority |
| success | 操作完成且持久化事实通过 | 是 | 查看结果/下一步 |
| verified | reload/verifier 或系统结果确认 | 是 | 进入实验/记忆 |

## 20.2 Blocker 内容合同

每个 blocker 至少包含：

- 中文标题；
- 用户可理解的原因；
- 被阻断的动作；
- 当前已知事实；
- 不会自动做什么；
- 恢复入口；
- 折叠诊断 code/detail；
- 发生时间和当前店铺范围。

## 20.3 恢复原则

1. 恢复必须重新读取 Main 权威，不能只修改 Renderer 状态。
2. 过期证据通过重新采集/分析恢复，不修改 `freshUntil`。
3. revision 冲突通过刷新后重新提交恢复，不强制覆盖。
4. session identity 问题通过显式重新登录/检测恢复；UNKNOWN 场景下恢复身份只恢复只读对账能力。
5. UNKNOWN 只能通过 §13.5 固定双次只读对账增加观察理解，不恢复原写入重试权；永久 inconclusive 不允许继续权威观察循环。
6. kill switch 只能通过明确权限操作解除并记录 reason；解除只允许建立新的当前 authority。
7. invalidated/expired/revoked/consumed Grant、stopped batch 和 spent slot 均为终态，不得 resume/reactivate。
8. 只有 P6 blocker、click=0 有 durable proof、Grant 未终止且全部 authority 未漂移时，才允许全门重验后继续同一 pending slot。
9. 只读恢复入口不得调用任何写 command。
10. 所有恢复仍遵守当前 StoreContext。

---

# 21. 交付与验收策略

## 21.1 验收原则

v1.6.0 的正式状态必须绑定同一条谱系：

```text
source revision
→ package version/hash
→ app content/main bundle identity
→ live authority DB snapshot
→ business/package/security evidence
→ manual + policy canary
→ Mission production readiness
→ matching READY/NON_READY bundle
```

不允许：

- 使用 v1.5.0 Package UI 证明 v1.6.0；
- 使用旧 EXE hash 证明新源码；
- 使用开发预览截图替代 Package UI；
- 使用另一数据库/店铺的 authority；
- 运行部分门禁后手工改 README 为 APP_READY；
- 因用户禁止某项测试而默认该项通过。

## 21.2 验收层级

| 层级 | 目的 | 最低内容 | 主要正式 AC |
|---|---|---|---|
| L1 单元/合同 | 验证领域不变量 | shared types、service、repo、IPC、Preload、Renderer behavior；使用版本化 required-test manifest，未运行即 PENDING | AC-ACC-001 |
| L2 静态工程 | 验证类型和构建合同 | typecheck、Renderer build、package script contracts | AC-ACC-002 |
| L3 业务集成 | 验证主链 | exact 8/8、analysis、decision、grant、UNKNOWN residual/reconciliation、policy precedence、experiment/memory | AC-ACC-004 |
| L4 Package UI | 验证真实包体验 | 100%、125%、wide/minimum、overlay/dialog/store isolation、a11y delta | AC-ACC-005、AC-ACC-013 |
| L5 Package 身份/安全 | 验证打包边界 | installer/portable/ZIP/win-unpacked、launch、navigation、external links、Node environment、三重 hash | AC-ACC-003、AC-ACC-006 |
| L6 正式 DB | 验证运行事实 | current authority DB、WAL-safe readonly/query_only pre/post、snapshot、two-store × seven business days | AC-ACC-007、AC-ACC-008 |
| L7 Canary | 验证真实动作 | 独立 manual approval 和 policy-auto canary，不共享 Grant/batch/job/evidence | AC-ACC-009、AC-ACC-010、AC-ACC-016 |
| L8 Readiness/Bundle | 生成唯一正式状态 | trace closure、L1–L7 聚合、matching READY/NON_READY bundle、publication closure | AC-ACC-011～AC-ACC-015、AC-ACC-017 |

## 21.3 正式验收场景目录

### A. IA 与体验

| 验收 ID | 场景 | 通过条件 |
|---|---|---|
| AC-IA-001 | 导航完整性 | 六模块；22 intent 各出现一次；无 Skills 一级入口 |
| AC-IA-002 | 导航不改变 authority | 同一 intent 重组前后 Main store-scoped query/command 不变 |
| AC-IA-003 | capability 降级 | BLOCKED/LEGACY_ADAPTER/PROTOTYPE_ONLY 均按生产合同展示，无模拟成功 |
| AC-IA-004 | Ctrl+K | 功能入口可搜索；无 Main 对象 projection 时不提供伪对象搜索 |
| AC-UI-001 | 业务语言 | 一级导航和首屏不要求用户理解内部 workspace |
| AC-UI-002 | 上下文持续可见 | 六模块均显示当前店铺、产品、US/USD、连接和 mode |
| AC-UI-003 | 多档布局 | 1366×768、100%、125%、wide/minimum 均可完成主动作 |
| AC-UI-004 | 弹窗滚动 | 长内容和缩放下 footer 动作可达 |
| AC-UI-005 | 键盘焦点 | Tab/Enter/Escape/关闭恢复符合合同 |
| AC-UI-006 | reduced motion | 减少动画后功能和状态信息完整 |
| AC-UI-007 | disabled 原因 | 禁用动作有原因和恢复入口 |
| AC-UI-008 | 敏感显示 | 普通 UI 无秘密、raw path、不必要内部 ID |
| AC-UI-009 | 状态颜色 | verified 才为成功；UNKNOWN/blocked 不使用绿色成功语义 |
| AC-UI-010 | 大表格 | 窄屏/大数据下主列可用，低优先列可渐进查看 |
| AC-UI-011 | Inspector | 不同宽度下可访问且不遮挡主要动作 |
| AC-UI-012 | 术语一致性 | 六模块和导出遵守版本化中文/英文/诊断术语表 |
| AC-UI-013 | dialog 焦点 | 初始焦点、焦点约束、Escape 和关闭恢复均通过键盘行为测试 |
| AC-UI-014 | a11y delta | v1.5.1 primitives 到 v1.6.0 差距逐项有 owner/test/status，未验证项不宣称合规 |

### B. 上下文与主流程

| 验收 ID | 场景 | 通过条件 |
|---|---|---|
| AC-CTX-001 | Main 重验 StoreContext | 伪造/陈旧 Renderer context 被拒绝 |
| AC-CTX-002 | 切店完整替换 | 所有模块无上一店铺产品/建议/执行/记忆残留 |
| AC-CTX-003 | Profile/session/grant 隔离 | 跨店复用全部被阻断 |
| AC-CTX-004 | 非 US/USD | 主链明确阻断 |
| AC-CTX-005 | mismatch 查询 | 返回 blocker，不返回他店数据 |
| AC-CTX-006 | 切店竞态 | 旧异步响应不覆盖新店铺 |
| AC-FLOW-001 | 每阶段反馈 | 每阶段都有状态、结果、原因和下一步 |
| AC-FLOW-002 | Renderer 越权 | Renderer 无法直接推进持久化阶段 |
| AC-FLOW-003 | 上游漂移 | 旧下游 authority 失效/重验 |
| AC-FLOW-004 | 独立入口 | 各模块可直接打开并保持同一主链上下文 |

### C. 今日任务

| 验收 ID | 场景 | 通过条件 |
|---|---|---|
| AC-TODAY-001 | authority key | store/date/marketplace/currency 任一不匹配即阻断投影 |
| AC-TODAY-002 | 单主动作 | 任一状态只有一个 primary action |
| AC-TODAY-003 | 不假成功 | 缺失能力显示 blocked/attention |
| AC-TODAY-004 | UNKNOWN 优先 | 主动作进入只读对账，无重试入口 |
| AC-TODAY-005 | blocker 恢复 | 每个 blocker 跳到正确 intent |
| AC-TODAY-006 | 闭环摘要 | Mission/run/approval/execution/experiment/effect 可追踪 |
| AC-TODAY-007 | 运营事件边界 | 事件可作为上下文但不能生成 authority |

### D. 运营资产与数据

| 验收 ID | 场景 | 通过条件 |
|---|---|---|
| AC-ASSET-001 | 资产隔离 | 产品/对象/Listing 跨店不可见不可写 |
| AC-ASSET-002 | 配置非授权 | 修改目标值不会自动批准/签发/执行 |
| AC-ASSET-003 | 对象路径 | 普通 UI 使用活动>广告组>关键词路径 |
| AC-ASSET-004 | Listing 边界 | 只产生本地版本/导出，无提交能力 |
| AC-DATA-001 | exact 8/8 | 同一 production_full 8 类全部完成才能发布 |
| AC-DATA-002 | 7/8 | 发布数量为 0，指出缺失类型 |
| AC-DATA-003 | 跨批次拼接 | 即使凑齐 8 类型也被 lineage gate 拒绝 |
| AC-DATA-004 | 证据文件冒充 | screenshot/audit/trace 不能计入 8 类 |
| AC-DATA-005 | source refs | 每类 hash/size/rows/source range 完整 |
| AC-DATA-006 | 粒度口径 | 不同 report grain 不盲加且 UI 有说明 |
| AC-DATA-007 | 切店中的任务 | 旧店任务完成不写入新店 |
| AC-DATA-008 | 单报表失败 | 有独立诊断/恢复，整批仍 blocked |
| AC-DATA-009 | 模板 manifest | 八种 grain 的支持 revision/字段/alias/单位/唯一键均版本化且唯一映射 |
| AC-DATA-010 | 模板歧义 | 未知 header、缺字段、单位不明或多类型匹配时导入=0，并给出诊断 |
| AC-DATA-011 | provider 缺报表 | 任一 required type 不可取得时正式分析保持 blocked，不生成 optional 例外 |

### E. Analysis、Decision、Mission、Grant

| 验收 ID | 场景 | 通过条件 |
|---|---|---|
| AC-ANA-001 | 建议来源 | 每条建议可追到当前 run/evidence/store/product/window |
| AC-ANA-002 | Run 回执 | started/completed/failed/interrupted/reused 可见且有时间/结果 |
| AC-ANA-003 | 相同 fingerprint | 新回执、reused=1、无重复 batch/proposal/decision |
| AC-ANA-004 | authority 变化 | revision/fingerprint 变化不错误复用可执行结果 |
| AC-ANA-005 | AI 失败 | timeout/cancel/invalid/fallback 正确记录，无假 AI 成功 |
| AC-ANA-006 | 来源资格 | rule/rule_ai/ai/fallback eligibility 符合合同 |
| AC-ANA-007 | 不可变快照 | 旧 batch/proposal 无法原地修改 |
| AC-DEC-001 | Decision lineage | mission/batch/policy/action/proposal 全匹配 |
| AC-DEC-002 | reason | 空 reason 被拒绝，真实输入落 durable audit |
| AC-DEC-003 | supersede | 只影响开放建议，已处理历史不变 |
| AC-DEC-004 | revision 冲突 | 第二并发写入被拒绝并要求刷新 |
| AC-DEC-005 | 整批授权 | 省略任一最新 proposal 时不签发 Grant |
| AC-DEC-006 | 决策可读性 | 首屏显示业务信息，诊断区显示 lineage |
| AC-DEC-007 | 独占授权路径 | 一个 batch/Grant 只能为 human 或 policy；mixed issuer、拆批、跨 mode 组合全部被拒绝 |
| AC-MIS-001 | Mission 绑定 | store/batch/policy/window/criteria/guardrails 完整 |
| AC-MIS-002 | 六阶段顺序 | 非法跳阶段被拒绝 |
| AC-MIS-003 | Renderer 完成 | 前端无法直接写 EFFECT/completed |
| AC-MIS-004 | 生命周期 | archive/restore 可用，无硬删除 |
| AC-GRANT-001 | Grant 完整性 | immutable，绑定最新 store/mission/action/policy/session |
| AC-GRANT-002 | 终止/漂移 | expired/revoked/consumed/mismatch 全部拒绝 |
| AC-GRANT-003 | 授权边界 | decisions/entities/limits/budget/evidence/stops 完整 |
| AC-GRANT-004 | submit 前后边界 | click 前全部 authority 重验；click 后只读验证历史绑定/事实，后发漂移停止后续 slot且不改写历史 |
| AC-GRANT-005 | 事件追加 | issued/reserved/spent/invalidated/revoked/consumed/expired 历史完整 |
| AC-GRANT-006 | residual ledger | Grant 可用性由 immutable Grant + append-only slot/events 派生，spent 不等于 success |
| AC-GRANT-007 | 终态不复活 | UNKNOWN/硬门导致 invalidated 后，恢复旧配置仍拒绝旧 Grant |
| AC-GRANT-008 | issuer 匹配 | manual=human_operator、policy_auto=policy_runtime，mode/revision/path 唯一一致 |
| AC-GRANT-009 | 禁止混合 | mixed Decision/issuer、拆批和组合 Grant 均被拒绝 |

### F. 执行与实验

| 验收 ID | 场景 | 通过条件 |
|---|---|---|
| AC-EXE-001 | 动作白名单 | 非 keyword lower_bid 全部 blocked |
| AC-EXE-002 | 幅度 | 10% 和 grant 较小者生效，increase blocked |
| AC-EXE-003 | preflight/intent | 任一门失败 click=0；intent 在 click 前持久化 |
| AC-EXE-004 | 串行单次 | 每 slot click≤1，前一个回读后才开始下一个 |
| AC-EXE-005 | 三段回读 | before/after/reload + verifier 才 verified |
| AC-EXE-006 | 对象漂移 | account/campaign/group/keyword/match/bid 任一漂移 click=0 |
| AC-EXE-007 | UNKNOWN | batch 停止，无自动 retry/skip |
| AC-EXE-008 | 双次对账 | 两次只读、两份独立 proof、原记录仍 unknown |
| AC-EXE-009 | 接管边界 | 接管不能绕 Grant 或创建 verified 假记录 |
| AC-EXE-010 | kill switch | 当前 StoreContext 写入被阻断，只读 reconciliation 仍安全可用 |
| AC-EXE-011 | UNKNOWN residual | slot spent、batch stopped_unknown、后续 slots blocked、Grant residual=0 |
| AC-EXE-012 | reconciliation 数量 | 每 unknown intent 只能创建一个 case，且只有 reload 前后两个 observation slots |
| AC-EXE-013 | 四种 outcome | target/original/other/inconclusive_permanent 唯一分类；证据不足为永久不确定，无第三次升级 |
| AC-EXE-014 | fresh authority | 新写入无法复用旧 slot/batch/Grant，必须建立新的当前完整链 |
| AC-EXE-015 | 保守计数 | UNKNOWN 占 count/cooldown/max impact，对账后不退款 |
| AC-EXE-016 | post-submit drift | 既有 submit 历史保留、后续 slot 停止、仅完成受限只读取证 |
| AC-EXP-001 | 实验归属 | 当前 store/mission/product/entity/decision/readback 全匹配 |
| AC-EXP-002 | 正式基线 | baseline/snapshot 来自当前 formal row/batch |
| AC-EXP-003 | 窗口/护栏 | 未到期/不足/触发护栏不形成成功效果 |
| AC-EXP-004 | 系统推进 | 自由文本不能完成实验或 Mission |
| AC-EXP-005 | 限制表达 | 样本、时间窗、护栏和需更多样本可见 |

### G. 记忆、策略、AI

| 验收 ID | 场景 | 通过条件 |
|---|---|---|
| AC-MEM-001 | 店铺索引 | 当前店铺重建/检索，跨店事件拒绝 |
| AC-MEM-002 | 可信资格 | unknown/无 proof 不入可信索引 |
| AC-MEM-003 | 链路 | READBACK/EFFECT 保留 mission/entity/date/session/proof |
| AC-MEM-004 | 修正 | correction 追加，原记录不删除 |
| AC-MEM-005 | Prompt 注入 | 历史恶意文本不能改变系统规则/调用写入 |
| AC-MEM-006 | 导出 | 范围、日期、记录、词、证据完整且无秘密/路径 |
| AC-MEM-007 | 谨慎措辞 | 单样本标记 observation/limitations |
| AC-SET-001 | ERP/Ads 分离 | ERP ready + Ads failed 时采集可用、执行 blocked |
| AC-SET-002 | 店铺配置隔离 | mode/policy/profile/scheduler 随店铺恢复 |
| AC-POL-001 | 两种模式 | 只有 manual_approval/policy_auto 可持久化 |
| AC-POL-002 | 自动化边界 | manual 必须 human Grant；policy-auto 必须 current policy Grant；无第三 mode |
| AC-POL-003 | policy eligibility | scope/priority/entity/action/window/count/cooldown/limit/evidence 全验证 |
| AC-POL-004 | 熔断/急停 | kill/open circuit 阻断授权和写入，但安全只读对账可继续 |
| AC-POL-005 | 版本不可变 | enabled 版本修改被拒绝，必须新建版本 |
| AC-POL-006 | CAS | 并发 runtime 变更第二个失败 |
| AC-POL-007 | reason 透传 | UI 输入原文出现在 durable audit，无固定字符串替代 |
| AC-POL-008 | gate precedence | P0–P6 顺序确定、全部 AND、primary blocker 稳定且不跳门 |
| AC-POL-009 | no revival | terminal authority 在 blocker 解除或切回旧值后仍不可用 |
| AC-POL-010 | P6 恢复 | 仅 click=0 有 proof、Grant 未终止、authority 未漂移时可全量重验 pending slot |
| AC-POL-011 | 阶段分离 | issuance 不 submit、just-before-submit 最多一次写、post-submit 只有 readback |
| AC-POL-012 | mode revision | 切 mode 递增 revision 并终止旧 pending authority；切回不复活 |
| AC-POL-013 | 责任分离 | trigger/source/actor/issuer/worker 分别记录，非法 issuer 签发被拒绝 |
| AC-SCH-001 | scheduler 越权 | 定时分析可完成，但无当前 mode 合法 Decision/Grant 时执行=0，scheduler 不能签发 Grant |
| AC-AI-001 | secret redaction | UI/log/prompt/test/export 无明文 key/secret |
| AC-AI-002 | 结构和恢复 | invalid/timeout/cancel/fallback 可审计 |
| AC-AI-003 | AI authority | AI 不能签发 Grant 或调用写入 command |
| AC-AI-004 | AI 价值等级 | 每个场景声明 A0–A3、必要性、fallback 和阻断语义 |
| AC-AI-005 | 费用状态 | provider 未报 usage/cost 时记录 unknown 而非 0 |
| AC-AI-006 | spend gate | 无法证明当前预算余量时自动付费调用=0 或明确 rule fallback |
| AC-AI-007 | 预算隔离 | AI spend 与 Ads impact budget 的记录、单位、revision、authority 不交叉 |
| AC-AI-008 | 价值评价 | rubric/基线/样本/限制完整，单次批准/写入/EFFECT 不产生因果价值结论 |
| AC-AI-009 | AI 治理隐私 | value/cost records 无秘密/raw path/超目的数据 |

### H. 数据、安全、非功能与交付

| 验收 ID | 场景 | 通过条件 |
|---|---|---|
| AC-DOM-001 | 全链追踪 | proposal 可追到 store/report row/evidence/run/mission |
| AC-DOM-002 | revision | 陈旧 revision 写入全被拒绝 |
| AC-DOM-003 | 不可变/追加式 | authority 历史不能原地篡改 |
| AC-DOM-004 | evidence ref | path/file URI 被验证器拒绝 |
| AC-DOM-005 | Renderer payload | 无 secret/profile/raw path |
| AC-DOM-006 | 时间合同 | 非法/未来/过期时间按相应门禁拒绝 |
| AC-DOM-007 | 正交状态 | slot consumption、execution outcome、batch outcome、Grant residual 可独立重建且无互相推断 |
| AC-DOM-008 | reconciliation 唯一性 | 重复创建 case 或第三 observation 被唯一性/状态门拒绝 |
| AC-NFR-001 | 事务/CAS | 并发和失败不会半写 |
| AC-NFR-002 | 重启恢复 | intent/unknown/interrupted 可解释恢复 |
| AC-NFR-003 | 幂等 | 重复 refresh/command 不产生重复业务记录/写入 |
| AC-NFR-004 | 中断边界 | intent 前 click=0 可证明才 interrupted；intent 后无法证明则 unknown，均不变 success |
| AC-NFR-005 | DB 零写入 | readonly/query_only pre/post 一致 |
| AC-NFR-006 | crash boundary | intent/idempotency/slot reservation 持久化后重启无法获得第二次 submit authority |
| AC-NFR-007 | durable 重建 | 清空 Renderer memory 后仍从 slot/batch/residual events 恢复相同 authority |
| AC-SEC-001 | 凭证边界 | secrets 不出 Main/local secure storage |
| AC-SEC-002 | Preload 边界 | 无任意 fs/db/electron API |
| AC-SEC-003 | Package 安全 | navigation/external/node adversarial gate 通过 |
| AC-SEC-004 | evidence 解析 | Renderer 只拿 opaque refs |
| AC-SEC-005 | 最小披露 | 日志/导出不泄露真实敏感标识和路径 |
| AC-SEC-006 | 无隐式云上传 | 默认网络观察和配置检查确认业务数据/证据/Prompt/日志不上传未声明服务 |
| AC-PERF-001 | 即时反馈 | 点击后 busy/disabled，不能重复提交 |
| AC-PERF-002 | 大表格 | 大数据量下采用分页/虚拟化/分段呈现 |
| AC-PERF-003 | 长任务取消 | 取消后 busy 清除且有 interrupted/cancelled 结果 |
| AC-PERF-004 | 投影摘要 | 首页不在 Renderer 扫全库 |
| AC-PERF-005 | baseline fixture | 典型/最大 fixture、机器/package/DB/schema/采样方法完整且可重复 |
| AC-PERF-006 | budget approval | 每个发布阻断指标有独立批准的版本化 Budget Record，baseline 不自动成为阈值 |
| AC-PERF-007 | 预算目录 | startup/store switch/projection/exact-eight/analysis/memory/DB/evidence growth 均有状态 |
| AC-PERF-008 | 超预算 | 当前 package 超预算形成 blocker/批准偏差，不自动扩大阈值 |
| AC-PERF-009 | 可比证据 | 性能证据绑定 fixture/environment/percentile/sample/source/package identity |
| AC-OFF-001 | 离线历史 | 本地历史/实验/记忆可读 |
| AC-OFF-002 | ERP/Ads 降级 | 两连接分别影响正确能力 |
| AC-OFF-003 | AI 降级 | fallback/blocked 明确且历史不丢 |
| AC-MNT-001 | 共享合同 | Main/Preload/Renderer 类型和 store scope 一致 |
| AC-MNT-002 | 诊断 | 关键 blocker 有 code/user copy/detail |
| AC-MNT-003 | 生产无 fixture | production mode 不加载模拟 fallback |
| AC-MNT-004 | 复用 | 六模块不复制领域 service/repository |

### I. 迁移与兼容

| 验收 ID | 场景 | 通过条件 |
|---|---|---|
| AC-MIG-001 | legacy 分类 | 所有 legacy authority/evidence record 恰好进入四类之一并有 reason/revision |
| AC-MIG-002 | authority 不提升 | 缺 store/session/revision/issuer/proof 的旧记录无法通过默认值变成可执行记录 |
| AC-MIG-003 | 原子迁移 | 成功全量提交；注入失败无半写；重复运行幂等；中断后可解释恢复 |
| AC-MIG-004 | schema 拒绝 | unknown/future/partial schema 和旧 binary 写新 schema 全部 fail-closed |
| AC-MIG-005 | backup/rollback | WAL-safe backup 验证通过；已有新写入时拒绝静默回滚覆盖；无 destructive down migration |
| AC-MIG-006 | template manifest | 已支持 revision 唯一映射，未知/歧义/缺字段模板 import=0 |
| AC-MIG-007 | projection version | 版本/安全字段不匹配返回 blocked/unsupported，Renderer 不补默认 authority |
| AC-MIG-008 | evidence mapping | Main 验证 scope/kind/proof 后产生 opaque ref；raw path 不进入 Renderer/export |
| AC-MIG-009 | 验收信用隔离 | migration receipt、legacy artifact、历史可见性均不能满足当前 v1.6 AC |
| AC-MIG-010 | companion trace | 三份 companion specs 覆盖 schema/template/projection/evidence/test/release 责任且无重复事实源 |

### J. 最终交付门

| 验收 ID | 门 | 通过条件 |
|---|---|---|
| AC-ACC-001 | 单元与合同 | 当前 v1.6.0 versioned required-test manifest 全部运行并通过，失败/跳过/未运行为 0 |
| AC-ACC-002 | TypeScript/Renderer | 当前版本 typecheck、renderer build 和 package-script contracts 通过 |
| AC-ACC-003 | Windows package | installer、portable、ZIP、win-unpacked 与同一 source identity、版本和三重 hash 绑定 |
| AC-ACC-004 | Business integration/smoke | 当前版本化业务 scenario catalog 全部通过，不能使用“后续权威”移动目标 |
| AC-ACC-005 | Package UI | schema 当前版，100%/125%/wide/minimum、六模块、overlay/dialog/store isolation 通过 |
| AC-ACC-006 | Package security | launch、navigation、external link、credential、Node environment、三重 hash 通过 |
| AC-ACC-007 | Live DB | 明确 current authority DB；WAL-safe snapshot；readonly/query_only pre/post 零写入和 currentness 通过 |
| AC-ACC-008 | 两店连续运行 | 全库恰好两家 active US/USD、不同非空 Profile、ready ERP/Ads connection/session；按 Release companion spec 的七个已完成美国业务日形成 14 个 accepted store-days，无跨 batch 拼接或临时整形真实店铺 |
| AC-ACC-009 | Manual canary | human_operator issuer 的合法人工 Grant 完成一个真实 lower_bid 和完整回读 |
| AC-ACC-010 | Policy-auto canary | policy_runtime issuer 的合法 policy-auto Grant 完成独立真实 canary 和完整回读 |
| AC-ACC-011 | L1–L8 聚合 | trace closure 完整且 L1–L7 当前结果全部 PASS，生成唯一 current release result |
| AC-ACC-012 | Bundle safety | APP_READY 只生成 matching READY bundle；其余生成忠实 NON_READY bundle，均通过对应 verifier |
| AC-ACC-013 | NFR/AI/a11y 治理 | 当前批准预算、AI cost/value records 和 Accessibility Delta Register 具有当前 package 证据，缺项为 pending |
| AC-ACC-014 | 追踪闭环 | 每个 MUST 机器可追到 AC、L1–L8 layer、producer、verifier、artifact schema/hash 和 current result |
| AC-ACC-015 | 历史拒绝 | legacy v15/s7 工具名、manifest、artifact 或历史 PASS 无法被重标为 v1.6 当前信用 |
| AC-ACC-016 | 双 canary 独立 | manual/policy canary 不共享 Grant、batch、job、submit intent、before/after/reload evidence，并分别验证 issuer |
| AC-ACC-017 | publication closure | source/package/DB/evidence/trace/readiness/README/bundle 任一输入变化使旧发布闭包失效并保持 NON_READY |

## 21.4 发布判定需求

| 需求 ID | 等级 | 需求 | 验收引用 |
|---|---|---|---|
| V16-ACC-001 | MUST | v1.6.0 不得继承 v1.5.x 运行态证据 | AC-ACC-001～AC-ACC-017 |
| V16-ACC-002 | MUST | 当前源码、包、DB snapshot、canary 和 readiness 必须属于同一版本谱系 | AC-ACC-003、AC-ACC-007、AC-ACC-009～AC-ACC-017 |
| V16-ACC-003 | MUST | L1–L8 或 trace closure 任一门缺失/失败时状态必须为 APP_NEEDS_WORK/NON_READY | AC-ACC-011、AC-ACC-012、AC-ACC-014 |
| V16-ACC-004 | MUST | README DELIVERY 只能在当前 READINESS_PASS、matching READY bundle safety 全部通过后更新为 APP_READY | AC-ACC-011、AC-ACC-012、AC-ACC-017 |
| V16-ACC-005 | MUST | 用户禁止的动态门必须保持 pending，不得用静态或历史证据替代 | AC-ACC-002、AC-ACC-003、AC-ACC-004、AC-ACC-005、AC-ACC-006、AC-ACC-007、AC-ACC-008、AC-ACC-009、AC-ACC-010 |
| V16-ACC-006 | MUST | 正式取证 DB 按当前 gate 使用恰好两家 active US/USD 店铺；额外店铺需 inactive/archived 或先正式升级 gate | AC-ACC-007、AC-ACC-008 |
| V16-ACC-007 | MUST | NFR、AI cost/value 和 accessibility 发布声明必须有当前版本批准记录与 package evidence | AC-ACC-013 |
| V16-ACC-008 | MUST | MUST→AC→L1–L8→evidence/result trace closure 必须机器可检查，缺项不得 PASS | AC-ACC-014 |
| V16-ACC-009 | MUST | manual 与 policy-auto canary 必须使用独立 candidate/Grant/batch/job/evidence 并验证不同合法 issuer | AC-ACC-016 |
| V16-ACC-010 | MUST | legacy v15/s7 命名工具只有通过 v1.6 schema/identity adapter 和当前验证后才能参与流程，旧结果不得获得 v1.6 credit | AC-ACC-015 |
| V16-ACC-011 | MUST | L8 聚合不得用嵌套 legacy readiness 替代任一 L1–L7 当前结果 | AC-ACC-011、AC-ACC-015 |
| V16-ACC-012 | MUST | publication closure 任一输入变化必须使旧 readiness/README READY/bundle 失效并恢复 NON_READY | AC-ACC-017 |

## 21.5 需求—AC—证据追踪合同

**Verification and Traceability** companion specification 必须为每个 MUST/SHOULD 建立版本化、机器可检查的记录：

```text
requirementId
→ acceptanceId
→ L1–L8 layer
→ test/script/manual procedure
→ fixture + current inputs
→ evidenceKind/schema
→ producer
→ verifier
→ result (PENDING/PASS/FAIL)
→ artifact hash + source/package/DB identity
→ blocker/deviation
```

PRD 中存在 AC 引用只表示设计追踪，不表示测试已实现或已通过。任何缺 producer、verifier、artifact schema、current result 或 identity binding 的 MUST 都保持 PENDING。

## 21.6 READY/NON_READY 状态不变量

```text
READINESS_PASS = trace closure 完整
                 AND L1–L7 当前结果全部 PASS
                 AND publication closure 当前复验通过

APP_READY = READINESS_PASS
            AND README DELIVERY 与结果一致
            AND matching READY bundle safety PASS

否则 = APP_NEEDS_WORK / INTERNAL NON_READY
```

NON_READY bundle 必须忠实记录失败/缺失门，不能伪装 READY；READY bundle 不得在任一闭包输入变化后继续有效。

---

# 22. v1.5.1 → v1.6.0 迁移基线

## 22.1 当前能力评估

> 下表的“已有”“已接”“生产链”只描述 v1.5.1 源码/领域库存。它既不表示已满足本文新增合同，也不授予 v1.6.0 实现、迁移、package runtime 或验收信用。

| 能力 | v1.5.1 基线 | v1.6.0 目标 |
|---|---|---|
| StoreContext | 已有生产隔离链 | 六模块统一使用并补足竞态/对象搜索边界 |
| 八报表/正式门 | exact-eight/current-store authority 已收紧 | 增加 template compatibility manifest，作为所有 Analysis Run 唯一发布入口 |
| Mission | canonical、六阶段、真实领域服务 | 首页聚合和完整用户旅程收敛 |
| Analysis | Evidence/action batch/proposal/receipt 已存在 | Analysis Run 成为显式产品对象和决策入口 |
| Decision | canonical workspace 与 authority 已存在 | registry/能力/导航语义统一 |
| MissionGrant | 当前批次授权基础链已存在 | 补齐独占 mode/issuer/path、slot residual ledger、终态不复活和 reason 透传合同 |
| Execution | 可见执行、单次写入、三段回读、UNKNOWN 基础链已接 | 补齐 slot/batch 状态机、永久 reconciliation 分类、当前包动态签收和黄金 canary |
| Experiment | 真实基线、观察窗、机器结论已接 | 首页/执行/记忆链路进一步统一 |
| Memory | 店铺索引、搜索、导出已接 | 谨慎因果语言和对象级 Inspector |
| Policy | 两模式、版本、限额、急停已接 | 补齐 P0–P6 precedence、mode revision、issuer 与 reason 审计 |
| Today | 真实 readiness projection | 完整当前进度/结果/下一动作驾驶舱 |
| Objects | 真实后端 + legacy UI | 迁入运营资产 canonical 工作台 |
| Collection | 真实后端 + legacy adapter | 迁入运营资产并统一 exact-eight/模板恢复体验 |
| Settings | native/legacy 混合 | 归入系统设置并统一组件/状态合同 |
| 一级 IA | 六模块 facade，但语义与目标模型不完全一致 | 采用本文档六模块映射 |
| Schema/Projection | 当前 v1.5.1 schema、IPC 和 Renderer contracts | 版本化迁移 receipt、projection compatibility 和 evidence-ref mapping |
| AI/NFR/A11y | 有局部实现和测试基础 | 建立 cost/value/spend、Baseline/Budget、Accessibility Delta 发布治理 |
| Package acceptance | v1.6.0 尚不存在 | 依 L1–L8、trace closure 和 publication closure 全链重新取证 |

## 22.2 迁移原则

1. 不重写已经验证且仍符合 v1.6 合同的 Main/SQLite authority 领域逻辑；任何“复用”都需 current contract test 证明。
2. 先定义一级模块和 route 映射，再迁移页面外观；UI 重组不改变正式数据、Decision、Grant、Execution、Experiment 和 Memory 不变量。
3. legacy 页面按黄金闭环优先级逐步放入 canonical workspace，不做一次性全量重写，也不以默认字段补成新 authority。
4. 所有 legacy authority/evidence record 必须恰好分类为 `validated-compatible`、`historical-read-only`、`re-derivation-required` 或 `quarantined`，并记录 reason、source schema 和 classifier revision。
5. schema upgrade 必须声明支持的 source/target、执行 WAL-safe backup、使用事务且可幂等恢复；unknown/future/partial schema fail-closed。
6. 不自动 destructive down-migration；目标版本已有新写入后，不允许静默用旧 snapshot 覆盖或让旧 binary 写新 schema。
7. 每次 projection 迁移同时覆盖 Main owner、Preload request/response、contract version、StoreContext/session/revision/currentness、Renderer consumer 和 blocked/unsupported 行为。
8. raw local path 只留 Main；只有通过 scope/kind/proof 校验和版本映射后才生成 Renderer/export 可用 opaque evidence ref。
9. template compatibility 只承认 manifest 明列且唯一匹配的 revision；未知/歧义/缺必需字段不猜测、不导入。
10. migration receipt、legacy 可见性、adapter 成功和历史 artifact 均不构成 v1.6 acceptance credit。
11. v1.5.1 保持真实交付状态，不因 PRD、migration 或兼容层创建而修改 package version 或 DELIVERY。

## 22.3 三份配套规格边界

v1.6.0 只建立以下三份 companion specification；schema、template、IPC、evidence 和 rollback 子题归入其中，不再拆出平行事实源：

| 配套规格 | 唯一责任 | 必须覆盖 | 不得承担 |
|---|---|---|---|
| **Migration and Compatibility** | 数据/合同从支持的 legacy 版本安全进入 v1.6 | schema matrix、WAL-safe backup、upgrade/interruption/recovery、legacy classification、template manifest、projection version、evidence-ref mapping、rollback refusal | 当前 package PASS 或 release 状态 |
| **Verification and Traceability** | 把每个 requirement/AC 与可执行验证及证据闭合 | required-test manifest、L1–L8 mapping、fixture、artifact schema、producer/verifier、hash、result/blocker、trace closure | 修改业务门槛或生成 APP_READY |
| **Release, Canary, and Evidence** | 规定 current candidate 的动态取证、聚合和发布闭包 | package identity、安全/UI、formal DB、two-store × seven days、独立双 canary、readiness、README/bundle closure | 把 legacy/migration 结果重标为当前信用 |

三份规格必须引用本文档 requirement/AC ID，发生冲突时以本文档安全不变量和更保守 fail-closed 解释为准。

---

# 23. 版本里程碑与退出条件

## M0：产品、authority 与证据合同冻结

### 交付物

- v1.6.0 PRD 正式评审；
- 六模块与 22 intent 映射；
- Analysis Run 重用语义；
- 两种互斥 Ads write-authority mode 及合法 issuer/path；
- MissionGrant residual ledger 与 slot/batch/UNKNOWN 终态合同；
- legacy 四分类、三份 companion specification 和 trace schema；
- NFR Baseline/Budget、AI cost/value/spend、Accessibility Delta 治理模板；
- 当前工作树和正式/概念/历史原型边界。

### 退出条件

- 无未决的 IA、mode/issuer、action scope、UNKNOWN、migration 和 readiness 语义；
- requirement/AC ID、L1–L8 和 evidence schema 可机器追踪，初始结果均忠实标记 `PENDING`；
- 临时产物、runtime 数据和秘密不在提交范围；
- 当前 package/source lineage 可识别，且未产生 v1.6 runtime credit。

## M1：六模块 Shell 与关键 canonical 黄金路径

### 交付物

- 六模块一级导航和全局 context bar；
- 今日任务闭环聚合；
- Mission/Analysis/Decision/Execution/Experiment/Memory 主路径；
- UNKNOWN、`inconclusive_permanent`、Grant residual 和 P0–P6 blocker 投影；
- mode reason、mode revision 与 issuer/path 端到端审计；
- feature search 和 capability boundary。

### 退出条件

- 22 intent 唯一映射；
- 六模块无 mock fallback 或 Renderer 默认 authority；
- 每个 blocker 有合法恢复入口，终态无复活/重试入口；
- 核心 route 的 Main/Preload/Renderer contract/behavior 测试通过，但不冒充 package credit。

## M2：运营资产、模板与系统设置收敛

### 交付物

- Objects/Collection/Settings 迁入统一工作台组件；
- exact-eight 数据入口和 template compatibility manifest；
- 产品/广告对象/Listing/策略/连接/调度统一体验；
- supported legacy template diagnostics、unknown/ambiguous template fail-closed；
- Responsive Inspector 和 priority tables。

### 退出条件

- 黄金主链不依赖视觉不一致的 legacy 页面；
- 每个支持模板唯一映射且有 fixture，未知/歧义/缺字段导入为 0；
- 所有核心页面满足状态/业务文案/主动作合同；
- 100%/125% 开发 UI 检查通过，但不冒充 Package UI credit。

## M3：迁移、兼容与当前包运行态签收

### 交付物

- supported fixture upgrade、重复运行幂等、注入失败/中断恢复；
- future/partial schema refusal、旧 binary 写新 schema 拒绝和 rollback safety；
- projection-version mismatch、evidence-ref mapping 和 raw-path boundary；
- typecheck/Renderer build、Windows package、business integration/smoke、Package UI、Package security；
- current live DB WAL-safe readonly/query_only pre/post。

### 退出条件

- Migration and Compatibility AC 全部由当前 fixture/evidence 验证；
- 所有运行证据绑定 v1.6.0 当前源码、package hashes、schema 和 trace identity；
- 失败/未运行项形成 NON_READY blocker，不复用历史或 migration evidence。

## M4：人工审批黄金 canary

### 进入条件

- M3 完成且 L6 当前 authority snapshot/DB currentness 通过；
- 自然产生一个当前店铺、当前产品、当前 exact 8/8、当前 stable keyword/current bid、合法 ≤10% lower_bid、专属人工 Decision 和 `human_operator` Grant 的候选。

### 退出条件

- 独立 manual candidate/Grant/batch/job；
- 一次写入；
- before/after/reload 与 verifier 通过；
- Experiment 可使用真实基线；
- 不伪造候选、不降低门槛、不复用其他 canary 证据。

## M5：policy-auto canary 与重复性

### 进入条件

- L6 仍为 current PASS，policy runtime、mode revision 和 enabled policy 均可证明当前有效。

### 交付物

- 与 manual canary 完全独立的 policy-auto candidate/Decision/`policy_runtime` Grant/batch/job/evidence；
- 两店不同 Profile 和 session；
- 两店各七个已完成美国业务日的连续运行证据；
- UNKNOWN 零自动重试及 kill switch/circuit breaker 验证。

### 退出条件

- policy-auto 不比人工模式放宽任何执行门；
- 两个 canary 不共享 authority/evidence；
- 两店隔离和连续运行通过当前 L6/L7 formal gate。

## M6：L1–L8 readiness 与发布闭包

### 退出条件

- 所有 MUST trace closure 完整；
- L1–L7 当前结果全部 PASS，L8 聚合不嵌套替代任何门；
- 生成唯一 current release result；
- README DELIVERY 与 readiness 一致；
- matching READY 或忠实 NON_READY bundle 通过对应 verifier；
- source/package/DB/evidence/trace/readiness/README/bundle publication closure 完整；
- 只有全部条件同时成立时才能声明 `APP_READY`。

---

# 24. 风险与依赖

| 风险 | 影响 | 缓解策略 |
|---|---|---|
| 当前工作树规模大且含未跟踪概念原型 | 难以证明 package/source 谱系 | M0 先拆分、冻结和明确提交边界；概念原型不作生产事实 |
| 六模块与现有 facade 语义不同 | 重复路由或用户迷失 | 保留 10/22 内部结构，只重组一级用户模型 |
| 原型三模式与生产两模式冲突 | 误把半自动当写入权限 | 只持久化 manual_approval/policy_auto；半自动是 scheduler + human Grant 体验 |
| mixed issuer 或 Decision 跨 mode 复用 | 责任不清、越权 Grant | batch/path/mode/revision/issuer 独占校验，禁止拆批和组合 Grant |
| UNKNOWN residual 含糊或 reconciliation 被当成执行证明 | 重复写入、错误 success/memory | slot spent、batch stopped_unknown、Grant residual=0；原执行永久 unknown；一次 case/两次观察 |
| blocker 消失后旧 Grant/slot 复活 | 使用陈旧 authority 再写 | terminal invalidation append-only；任何后续写入建立 fresh authority |
| 原型重跑 supersede 与生产 reuse 冲突 | 重复建议或历史丢失 | 新 run receipt + immutable result reuse |
| legacy 默认值提升 authority | 缺 issuer/session/proof 的旧记录变成可执行 | 四分类；不得补 authority 默认值；re-derivation 或 quarantine |
| schema 迁移/回滚损坏正式数据 | 半写、WAL 丢失或新写入被覆盖 | WAL-safe backup、transaction/idempotency、future/partial refusal、无 destructive down migration |
| 任意模板兼容或猜字段 | 错 grain/单位进入 exact-eight | versioned template manifest；唯一匹配；未知/歧义/缺字段 import=0 |
| projection 或 evidence mapping 默认泄露 | Renderer 获得陈旧 authority、raw path 或秘密 | version/currentness fail-closed；Main-only mapping 到 opaque refs |
| Ads UI 页面结构或身份变化 | 对象定位和回读失败 | page identity、stable ID、current value 和 P6 fail-closed |
| 当前没有合法真实候选 | L7 长期 blocked | 不伪造候选，等待自然合格 lower_bid，保持 NON_READY |
| 用户禁令限制动态验收 | 无 current package credit | 保持 PENDING/NON_READY，解除后按固定 L1–L8 顺序执行 |
| v15/s7 历史证据重标或 L8 嵌套 legacy readiness | 产生虚假 v1.6 PASS | current schema/identity adapter、trace closure；旧 artifact 只作历史输入，不作当前结果 |
| manual/policy canary 复用 evidence | 无法证明两条授权路径 | candidate/Grant/batch/job/intent/readback 全部独立并各验 issuer |
| readiness、README、bundle 闭包错位 | 外部交付状态不真实 | publication closure hash binding；任一输入变化立即失效为 NON_READY |
| AI provider 不稳定或未报 cost 被记为 0 | 分析中断或预算失真 | timeout/cancel/validation/fallback；cost=`unknown`；无法证明余量则阻断付费调用 |
| AI 价值因一次批准/写入/EFFECT 被过度宣称 | 错误投资和产品结论 | A0–A3、rubric、基线/样本/限制；单次结果不得推断因果价值 |
| Ads impact budget 与 AI spend budget 混用 | 错误授权或成本控制 | 分离单位、revision、owner、gate 和 ledger |
| 未验证的 accessibility/performance 声明 | 虚假合规或不可复现目标 | Accessibility Delta Register 与独立批准的 NFR Baseline/Budget Record；无证据保持 PENDING |
| kill switch scope 含糊 | 误阻断他店或漏阻断当前店 | 定义为当前 StoreContext 写入域 P0 gate；安全只读 reconciliation 可继续 |
| 店铺切换竞态 | 跨店显示/写入 | context key、session generation、abort/ignore stale response |
| 历史文本 prompt injection | AI 安全合同被污染 | 历史作为 untrusted user context，不得改变 authority/tool policy |
| 单样本过度解释 | 错误经营记忆 | observation/limitations/needs-more-samples |

---

# 25. 需求追踪矩阵

## 25.1 需求组到实现域

| 需求组 | 代表实现域 | 主要验收层 |
|---|---|---|
| V16-IA / TODAY / UI | Mission Control shell、workspace registry、canonical workspace、共享组件、Accessibility Delta Register | L1/L3/L4 |
| V16-CTX | StoreContext、bootstrap projection、Main request validation | L1/L3/L4/L6 |
| V16-ASSET / DATA | collection coordinator、formal data gate、template manifest、report parser/local-db | L1/L3/L6 |
| V16-ANA | analysis authority service/repo/shared types | L1/L3/L4 |
| V16-DEC / MIS / GRANT / POL | mission domain service/repo/shared types、mode/issuer/residual ledger | L1/L3/L6/L7 |
| V16-EXE | execution authority、slot/batch/reconciliation、Ads session/browser worker、readback verifier | L1/L3/L6/L7 |
| V16-EXP / MEM | experiment/causal ledger/index/export | L1/L3/L4/L6 |
| V16-AI | ai-adapter、analysis service、secure settings、value/cost/spend records | L1/L3/L4/L8 |
| V16-DOM / MIG | schema migration、legacy classifier、projection contract、evidence-ref mapping | L1/L3/L6/L8 |
| V16-NFR / PERF / SEC / MNT | Main/Preload/SQLite、Baseline/Budget Records、package security | L1/L2/L4/L5/L6/L8 |
| V16-OFF / SCH / SET | local projections、connection capability、scheduler/policy runtime | L1/L3/L4/L6 |
| V16-ACC | required-test manifest、trace schema、readiness、publication closure、bundle verifier | L1–L8 |

## 25.2 六模块到现有生产路径

| 模块 | 代表 Renderer 路径 | 代表 Main/领域路径 |
|---|---|---|
| 今日任务 | `mission-control/workspaces/today-workspace.tsx`、`missions-workspace.tsx` | mission domain、today projection、operation events |
| 运营资产 | legacy product/target/keyword/listing/collection pages → canonical migration | collection coordinator、formal data gate、local repositories |
| 决策中心 | `decisions-workspace.tsx`、analysis window API | analysis authority、mission domain IPC/service |
| 执行与实验 | `execution-workspace.tsx`、`experiments-workspace.tsx` | execution authority、browser worker、experiment service |
| 经营记忆 | `memory-workspace.tsx` | causal ledger/index/export |
| 系统设置 | `policy-workspace.tsx`、settings/scheduler/delivery pages | policy runtime、store config、scheduler、readiness scripts |

## 25.3 MUST 覆盖声明

本文档所有 MUST 需求均应在需求表的“验收引用”列指向至少一个 `AC-*` 场景；Verification and Traceability specification 还必须把每个 requirement/AC 映射到 L1–L8、具体 test/script/manual procedure、fixture、artifact schema、producer、independent verifier、输入/hash、current result 和 blocker。PRD 中存在 AC 链接仅表示设计可追踪，不等于实现完成或 PASS；任何缺字段、未执行、结果陈旧或未绑定 current identity 的 MUST 均为 `PENDING`。

---

# 26. 术语表

| 术语 | 定义 |
|---|---|
| StoreContext | 当前店铺、US/USD、业务日期、会话代次和相关范围形成的 Main 权威上下文 |
| production_full | 用于正式完整业务导入的采集/导入谱系类型 |
| exact 8/8 | 同一合法谱系中八种要求报表全部完成、模板受支持且可对账 |
| lineage | 从 store、batch、file、import、evidence 到下游记录的不可混淆来源链 |
| Evidence Package | 封存八报表 source hash、batch/import、日期、规则/模型和 freshness 的分析证据包 |
| Analysis Run | 一次可追踪的分析尝试及其阶段、回执、输入 fingerprint、结果或复用状态 |
| fingerprint | 对规范分析输入的稳定摘要，用于识别可安全复用的相同输入 |
| Action Batch | 一轮分析形成的不可变最新动作批次 |
| Proposal Snapshot | 某一 actionRevision 下具体广告对象、当前值、建议值和资格的不可变建议快照 |
| Decision | 对 proposal 作出的版本化业务决定；授权链中必须属于唯一 human 或 policy path |
| Mission | 绑定事实、目标、约束、观察窗和六阶段闭环的运营任务 |
| MissionGrant | 由唯一合法 issuer 签发、绑定最新 Mission/action/policy/session 的不可变整批执行授权 |
| authorization path | 一个 batch/Grant 唯一采用的 `human` 或 `policy` 决策—签发路径，禁止混合/拆分 |
| issuer | 对 Grant 承担签发责任的主体：manual 为 `human_operator`，policy-auto 为 `policy_runtime`；scheduler/AI/worker 不是 issuer |
| authorityModeRevision | 当前 StoreContext 每次 write-authority mode 变化后递增的版本，旧 revision 的 pending authority 不复活 |
| manual_approval | 由人工完成 Decision、由 `human_operator` 签发 Grant 的 Ads 写入权限模式 |
| policy_auto | 当前 enabled policy 完成 Decision、由 `policy_runtime` 签发 Grant 的模式；不放宽执行门 |
| slot | Grant batch 中一个具体、串行、最多一次 submit 的 action position |
| residual authority | 根据 immutable Grant 与 append-only slot/events 派生的剩余可写次数/范围；spent 不等于 success |
| Grant invalidation | 使 Grant residual authority 永久归零的终态事件；条件恢复或切回旧 mode 不会复活 |
| fresh authority | 后续写入重新建立的 current Mission/proposal/Decision/Grant/session/entity/preflight 全链，不复用终态 slot/batch/Grant |
| submit intent | 实际点击保存之前持久化的写入意图；之后无法证明 click=0 时 slot 必须按 UNKNOWN 保守消费 |
| READBACK | 对动作后页面事实进行读取和证明的独立因果阶段，不等同于新的执行授权 |
| UNKNOWN | submit intent 后无法以 durable facts 证明 click=0 或最终结果的永久执行终态；slot spent、batch stopped、Grant residual=0、禁止原写入重试/skip |
| reconciliation case | 一个 unknown submit intent 唯一的安全只读对账容器，只允许 reload 前后两次 authoritative observation |
| inconclusive_permanent | 两次限定观察仍无法稳定分类的永久对账结果；不允许第三次观察升级，也不改写原 UNKNOWN |
| EFFECT | 观察窗和系统规则完成后形成的效果阶段，不等同于一次页面回读 |
| Causal Memory | 受 StoreContext、proof、READBACK/EFFECT 和谨慎表述约束的经营记忆索引；UNKNOWN 不进入可信记忆 |
| kill switch | 当前 StoreContext 写入域的 P0 紧急停止机制，阻断新授权/真实写入但不阻断安全只读 reconciliation |
| circuit breaker | 根据当前运行事实暂停授权/执行的 P1 策略熔断状态 |
| legacy classification | 旧记录的四选一分类：`validated-compatible`、`historical-read-only`、`re-derivation-required`、`quarantined` |
| template compatibility manifest | 对八种 grain 的支持 revision、header/alias、必需字段、单位/币种、grain/唯一键进行版本化声明的唯一兼容合同 |
| projection contract version | Main→Preload→Renderer projection 的版本标识；不匹配时 blocked/unsupported，不补 authority 默认值 |
| evidence-ref mapping | Main 验证 raw artifact 的 scope/kind/proof 后映射为 opaque ref 的版本化关系；raw path 不出 Main |
| NFR Baseline Record | 在明确 fixture/environment/package/DB/schema/采样方法下记录当前性能观测，不自动成为发布阈值 |
| NFR Budget Record | 对具体发布阻断性能指标独立批准的版本化预算，包含 owner、method、status 和 deviation |
| AI Value Record | 按 A0–A3、rubric、基线、样本和限制记录 AI 价值证据，不从单次结果推断因果价值 |
| AI Cost Record | 保存 provider usage/cost 的 reported/estimated/unknown 状态；未知不能记为 0 |
| AI Spend Policy | Store-scoped AI 付费调用预算/窗口/revision/owner 合同，与 Ads impact budget 完全分离 |
| Accessibility Delta Register | 从 v1.5.1 primitives 到 v1.6.0 的 accessibility 差距、owner、test、evidence 和 status 清单；未验证项不宣称合规 |
| acceptance credit | 某一 current version/source/package/DB/evidence identity 在指定 AC/layer 上经 verifier 形成的 PASS；不能跨版本继承 |
| READINESS_PASS | trace closure 完整、L1–L7 当前全部 PASS 且 publication closure 当前复验通过的内部聚合结果 |
| readiness | 依 L1–L8 聚合形成的唯一当前正式状态；缺项或失败为 APP_NEEDS_WORK/NON_READY |
| publication closure | source、package、DB、evidence、trace、readiness、README 和 bundle 的一致性闭包；任一输入变化使旧闭包失效 |
| bundle | 与最终 READY/NON_READY 状态和相同 identity 匹配、通过对应 safety verifier 的交付证据包 |
| legacy adapter | 将已有生产页面/服务接入新 Shell 的受控过渡层；不等于模拟、迁移 PASS 或当前验收信用 |
| canonical workspace | 使用 Mission Control 工作台合同和真实领域服务的目标页面实现 |

---

# 27. 最终产品定义

Amazon AI Ops Agent v1.6.0 完成时，应表现为：

> 一个面向 Amazon US 单个运营操作者、在 Windows 本地运行、以真实同源八报表建立事实、以 Analysis Run 和 Mission 组织决策、以 MissionGrant 限定 Ads 写入、以 before/after/reload 证明执行、以经营实验和谨慎因果记忆沉淀经验的可审计运营智能体。

v1.6.0 的完成标准不是“六个模块页面都能打开”，而是：

1. 用户始终知道当前店铺、当前任务和下一动作；
2. 任何建议都能回链到 exact 8/8、受支持模板和当前 Analysis Run；
3. 任何写入都经过唯一 mode/issuer/path 的最新完整授权且只允许合格关键词降价；
4. 任何成功都有 reload 后 verifier 证明；
5. 任何 UNKNOWN 都使原 slot、batch 和 Grant residual 永久终止，不会因对账、修复或条件恢复而重试/复活；
6. legacy/migration/reconciliation observation 不会因可见、兼容或稳定而自动成为 current execution truth 或 acceptance credit；
7. 任何进入经营记忆的结果都有店铺级 proof 和限制，UNKNOWN 不进入可信记忆；
8. 任何 APP_READY 声明都来自当前 v1.6.0 同谱系的 requirement trace closure、L1–L8 current evidence、publication closure 和 matching READY bundle；任一条件不成立都保持 `APP_NEEDS_WORK / INTERNAL NON_READY`。
