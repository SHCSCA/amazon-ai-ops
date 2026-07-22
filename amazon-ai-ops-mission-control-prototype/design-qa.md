# Amazon AI Ops Mission Control — Design QA

## 结论

final result: passed

本轮原型以当前 `amazon-ai-ops` 的业务边界、数据隔离要求和执行安全门为准，融合三套已确认的功能界面：Mission、经营实验、实时执行。三者不作为互斥视觉方案，而是同一桌面系统中面向不同任务的工作台。

## 对照基线

| 工作台 | 设计源图 | 实现截图 | 对照图 |
| --- | --- | --- | --- |
| Mission | `C:\Users\wz\.codex\generated_images\019f7d04-d3c5-79c0-a6cd-860f8c39ebd4\exec-dd0a78b5-3f64-4181-b3c5-c7a948b43966.png` | `evidence/qa/mission-final.png` | `evidence/qa/mission-comparison.png` |
| 经营实验 | `C:\Users\wz\.codex\generated_images\019f7d04-d3c5-79c0-a6cd-860f8c39ebd4\exec-5e976027-9370-4c5d-9e1b-a8c5ff9d0a65.png` | `evidence/qa/experiment-final.png` | `evidence/qa/experiment-comparison.png` |
| 实时执行 | `C:\Users\wz\.codex\generated_images\019f7d04-d3c5-79c0-a6cd-860f8c39ebd4\exec-71788fc8-d1ca-4803-b856-745c3920916a.png` | `evidence/qa/execution-final.png` | `evidence/qa/execution-comparison.png` |

- 对照视口：`1487 × 1058`。
- 对照状态：同一 `SHC001 / D6-SKU / B0GTTJFQTM` 店铺与产品范围，同一 Mission 主链路。
- 字体：使用本地/system sans-serif，中文正文和表格保持清晰；数值使用等宽/表格数字特性。
- 间距：统一 8px 基础节奏，桌面侧栏、顶部范围条、主画布与右侧检查器形成固定层级。
- 色彩：以深蓝灰、白色、业务蓝为主；绿色只表达通过/已验证，橙色表达人工审批，红色表达阻断或高风险。
- 资产：保留统一品牌图标和 Lucide 图标，不引入与当前产品无关的装饰性素材。
- 文案：全部改为运营任务语言，显式区分店铺、产品、广告对象、建议、审批、执行和回读。

## 区域级视觉核对

### Mission

- 顶部：店铺/产品范围、模式、安全状态与主任务标题保持单一视觉焦点。
- 中部：时间线、决策卡、风险门与执行状态形成连续主链路。
- 右侧：Agent 状态、审批约束和可解释上下文固定可见。

### 经营实验

- 顶部：实验契约、归属 Mission 与运行状态一屏可读。
- 中部：假设、变量、观察窗、因果记录和结论按实验流程排列。
- 右侧：实验检查器显示样本、约束、关联决策和可恢复状态。

### 实时执行

- 左侧：执行计划、变更前后值、审批和安全检查构成可审计步骤。
- 右侧：可见浏览器模拟领星页面，呈现写入、刷新和回读证据。
- 高风险动作必须进入人工审批；仅当前 Mission 可启用自动模式。

## 功能与交互验证

- 10 个工作区：今日、Mission、经营实验、决策与审批、实时执行、采集中心、对象中心、运营记忆、策略与护栏、系统设置。
- 3 个桌面视口，共 `30/30` 工作区通过布局和交互审计。
- 店铺 CRUD、店铺级数据隔离、独立 Lingxing/Amazon Ads 会话、浏览器 Profile 冲突 fail-closed、重连与重新验证通过。
- 产品和广告对象 CRUD、策略版本/快照/引用保护、采集任务与报表校验通过。
- Mission 作用域自动模式、暂停传播、完成闭环、深链、全局搜索和高风险审批通过。
- 实验因果记录、Mission 绑定、完成后只读、引用锁和安全删除通过。
- 执行前值/目标值、审批、可见写入模拟、刷新回读和证据状态通过。
- 最终构建通过：Vite `4575` 个模块转换完成；仅存在非阻断的 chunk-size 提示。
- 最终审计证据：`C:\Users\wz\.codex\visualizations\2026\07\20\019f7d04-d3c5-79c0-a6cd-860f8c39ebd4\final-ui-audit-20260721`。

## 修复历史

在最终冻结前识别并修复以下 P2 级状态问题：

- 实验因果记录缺少显式 `experimentId`，并补充 `links` 兼容回溯。
- Mission 全部执行完成后实验仍停留运行态，现统一进入完成且只读。
- 运行中独立实验可随店铺归档，现归档前强制阻断。
- 实验永久删除缺少 Mission/决策/执行/因果引用保护，现按依赖阻断。
- Profile 冲突店铺删除后同 Profile 店铺未恢复可验证状态，现统一重算并要求重新验证。

修复后重新执行模型矩阵、工作区多视口审计和生产构建，未发现可复现 P0/P1/P2。

## 已知边界

- 浏览器截图后端在当前 Windows 高 DPI 环境中会把 device surface 按 CSS 尺寸裁切；DOM 几何、`clientWidth === scrollWidth`、30/30 多视口审计均确认产品本身无横向溢出。对照图保留该采集限制，不以截图缩放结果反向修改布局。
- 这是本地交互原型。领星与 Amazon Ads 的真实写入仍以安全模拟呈现，不声称已完成生产候选中的 Task 8B 真实广告执行回读。
- 设计源图与实现之间剩余差异为统一信息架构、真实业务字段和当前项目状态文案带来的 P3 级密度差异，不影响任务完成或安全约束。
