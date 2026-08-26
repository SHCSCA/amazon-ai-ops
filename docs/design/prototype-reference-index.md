# 原型对照索引 — Amazon AI Ops 业务原型

> 历史原型对照记录：仅用于设计参考，当前源码/包验收状态以 `PROGRESS.md`、`BLOCKED.md` 和 `docs/OPERATOR_CORE_FLOW_REPAIR_2026-08-07.md` 为准。

> 最后更新：2026-07-03
> 原型项目路径：`amazon-ai-ops-business-prototype/`
> 代码根目录：`apps/desktop/src/renderer/`
> 当前生产主题：浅色 Windows 桌面主题；暗色变量保留在原型资产中，不进入本次生产实现。
>
> 使用原则：原型用于约束业务结构、页面语气和首屏任务清晰度，不作为“增加面板密度”的目标；生产界面需要用渐进详情、友好空态/错态和明确下一步补足原型未覆盖的日常运营体验。

## 一、全局公共组件

| 组件 | 原型定义 | 代码路径 |
|------|---------|---------|
| Shell 壳层 | `colors_and_type.css` (`.proto-layout` / `.proto-statusbar` / `.proto-sidebar`) | `components/app-shell.tsx` |
| 登录/路由 | — | `App.tsx` |
| ScopeBar | `.proto-scopebar` | `components/scope-bar.tsx` + `scope-store.ts` |
| 设计系统 | `colors_and_type.css` 的浅色 token、低噪音 KPI、面板、按钮和表单语言 | `styles.css` + `components/ui.tsx`; login surface, safety gates, and read-only status cards now share the production light token semantics |
| 按钮契约 | `.btn` / `.btn.primary` / `[disabled]` | `aria-busy` + spinner + `button-loading` |

---

## 二、页面映射总表

### 组 1 — 总览

| # | 页面 | 原型文件 | 代码路径 | 核心组件 | 交互边 | 实现状态 |
|---|------|---------|---------|---------|--------|---------|
| 1 | 登录与会话确认 | `pages/login.html` | `App.tsx` (`LoginPage` 内嵌) | `login-card` / `stat-card` | `enter-dashboard` → 今日看板 | 部分接入 |
| 2 | 今日看板 | `pages/dashboard.html` | `pages/dashboard-page.tsx` | 原型 KPI 条 / 状态网格 / 风险对象表 / 产品工作台补充区 / 就绪态下一步 | `primary-task` → 产品管理/数据采集/导入校验/广告表现/优化建议/审批中心（按当前门禁）；`jump-*` (5 条隐藏边) → 关键词机会/AI与规则/自动任务/运营事件/成本目标 | 高保真接入中 |
| 3 | 产品管理 | `pages/product-management.html` | `pages/product-management-page.tsx` | 原型状态卡 / 产品表格 / 产品详情 / 明确成本售价目标字段 / 时间线 | `go-operation-scope` → 工作范围 | 高保真接入中 |

### 组 2 — 数据

| # | 页面 | 原型文件 | 代码路径 | 核心组件 | 交互边 | 实现状态 |
|---|------|---------|---------|---------|--------|---------|
| 4 | 工作范围 | `pages/operation-scope.html` | `pages/operation-scope-page.tsx` | 当前工作范围 / `FormTable` / 字段确认反馈 / 范围影响说明 / 推荐下一步 | `go-data-collection` → 数据采集 | 部分接入，待原型复核 |
| 5 | 数据采集 | `pages/data-collection.html` | `pages/data-collection-page.tsx` | 原型状态卡 / `CollectionMonitorDrawer` / `MicroStepper` / 8 类报表选择 / 排除证据文件 / 动作反馈三态 | `go-data-import-validation` → 导入校验 | 高保真接入中 |
| 6 | 导入校验 | `pages/data-import-validation.html` | `pages/data-import-validation-page.tsx` | 真实报表目录 / SQLite 入库动作 / 入库快照 / `VirtualDataTable` / 只读锁定 | `go-ad-quant` → 广告表现 | 部分接入，待原型复核 |
| 7 | 运营事件 | `pages/operation-events.html` | `pages/operation-events-page.tsx` | 新增事件表单 / 时间线卡片 / AI 上下文读回 / 乐观清除 | — | 部分接入，待原型复核 |
| 8 | 成本目标 | `pages/product-config.html` | `pages/product-config-page.tsx` | 批量工具栏 / 当前产品表 / inline ACOS 编辑 / 健康度列 | — | 部分接入，待原型复核 |
| 9 | 广告表现 | `pages/ad-quant.html` | `pages/ad-quant-page.tsx` | 总盘指标 / `TagMetricGroup` 6 维筛选 / AI Radar / 产品分组 / 对象时间线 | `go-recommendations` → 优化建议 | 部分接入，待原型复核 |

### 组 3 — 广告

| # | 页面 | 原型文件 | 代码路径 | 核心组件 | 交互边 | 实现状态 |
|---|------|---------|---------|---------|--------|---------|
| 10 | 优化建议 | `pages/recommendations.html` | `pages/recommendations-page.tsx` | 用户任务化建议动作表 / 送审判断 / 证据状态 / AI+规则详情折叠 | `go-approval` → 审批中心 | 高保真接入中 |
| 11 | 审批中心 | `pages/approval.html` | `pages/approval-page.tsx` | 批准 / 拒绝 / 查看复核要求 / stamp / 行退出动画 / 缺证据 fail-closed | `go-readback` → 结果核对 | 高保真接入中 |
| 12 | 结果核对 | `pages/readback.html` | `pages/readback-page.tsx` | 已批准动作选择 / 审批凭证 / 执行前后证据 / 回读值 / 导出校验 | `go-delivery` → 交付验收 | 高保真接入中 |

### 组 4 — 增长

| # | 页面 | 原型文件 | 代码路径 | 核心组件 | 交互边 | 实现状态 |
|---|------|---------|---------|---------|--------|---------|
| 13 | 关键词机会 | `pages/keyword-opportunities.html` | `pages/keyword-opportunities-page.tsx` | ASIN / 广告活动 / 广告组 / 搜索词上下文 / 证据状态 / Listing 交接 / 筛选排序虚拟表 | `go-listing-optimization` (隐藏边) → Listing草案 | 高保真接入中 |
| 14 | Listing草案 | `pages/listing-optimization.html` | `pages/listing-optimization-page.tsx` | 本地草案工作流 / 关键词热力图 / 草稿 diff / 字符限制 / 本地导出 / 不提交 Amazon 或 Lingxing | — | 高保真接入中 |

### 组 5 — 系统

| # | 页面 | 原型文件 | 代码路径 | 核心组件 | 交互边 | 实现状态 |
|---|------|---------|---------|---------|--------|---------|
| 15 | 自动任务 | `pages/scheduler.html` | `pages/scheduler-page.tsx` | 任务状态 / cron / 启停按钮 / 运行记录 | — | 部分接入，待原型复核 |
| 16 | AI与规则 | `pages/settings.html` | `pages/settings-page.tsx` | AI 服务连接 / 规则阈值与动作边界 / AI 调用记录折叠 / 本地支持路径折叠 / 安全策略 | — | 高保真接入中 |
| 17 | 交付验收 | `pages/delivery.html` | `pages/delivery-page.tsx` | 可交付判断 / 当前阻塞 / 交付包位置 / 可复制摘要 / 文件与矩阵折叠 | — | 高保真接入中 |

---

## 三、业务门禁链路（原型交互流）

```
登录会话 ──→ 今日看板 ──→ 产品管理 ──→ 工作范围 ──→ 数据采集
                                                         │
                                              关键词机会 ←─┼──→ 导入校验
                                              │           │
                                          Listing草案      │
                                                         ↓
                                           成本目标 ←─ 运营事件 ──→ 广告表现
                                                                               │
                                                                               ↓
                         交付验收 ←── 结果核对 ←── 审批中心 ←── 优化建议
```

**支线**：导入校验 → 关键词机会 → Listing草案 → 导出草稿
**系统**：自动任务 / AI与规则 / 交付验收 — 独立于日常广告执行。

---

## 四、设计系统 Token 对照

| 类别 | 变量前缀 | 生产浅色值示例 | 说明 |
|------|---------|----------------|------|
| 背景 | `--aao-bg` | `#f8fafc` | 页面底色 |
| 表面 | `--aao-surface` | `#ffffff` | 卡片/面板 |
| 表面 2 | `--aao-surface-2` | `#f1f5f9` | 次级表面 |
| 表面 3 | `--aao-surface-3` | `#e2e8f0` | 进度条底 |
| 主文字 | `--aao-ink` | `#0f172a` | 正文 |
| 次文字 | `--aao-ink-2` | `#475569` | 描述 |
| 弱文字 | `--aao-ink-3` | `#94a3b8` | 标签 |
| 边框 | `--aao-line` | `#e2e8f0` | 卡片边框 |
| 品牌主色 | `--aao-brand-500` | `#3b82f6` | 按钮/高亮 |
| 成功 | `--state-success` | `#16a34a` | 通过/就绪 |
| 警告 | `--state-warning` | `#ca8a04` | 待确认 |
| 错误 | `--state-error` | `#dc2626` | 阻断/失败 |
| 信息 | `--state-info` | `#2563eb` | 提示 |
| 字体 | `--font-body` | system / Segoe UI / Microsoft YaHei | 正文，生产包不依赖远程字体 |
| 等宽 | `--font-mono` | Cascadia Mono / Consolas | 数据/代码 |

暗色主题本次不纳入生产范围；原型资产中的暗色变量只作为后续设计参考。

---

## 五、相关文档

- [业务 UI 简报](./amazon-ai-ops-business-ui-brief.md)
- [屏幕地图](./amazon-ai-ops-screen-map.md)
- [原型 Parity Checklist](./prototype-parity-checklist.md)
- [PRD / 架构规约 v1.5](../amazon_ai_ops_desktop_prd_arch_dev_spec_v1_5_no_external.md)
- [用户指南 v1.5](../USER_GUIDE_v1_5.md)
- [对抗式审计报告 v1.5](../../audit-findings-v15.md)
