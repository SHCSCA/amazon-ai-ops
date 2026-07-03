# 原型对照索引 — Amazon AI Ops 业务原型

> 最后更新：2026-07-03
> 原型项目路径：`amazon-ai-ops-business-prototype/`
> 代码根目录：`apps/desktop/src/renderer/`
> 当前生产主题：浅色 Windows 桌面主题；暗色变量保留在原型资产中，不进入本次生产实现。

## 一、全局公共组件

| 组件 | 原型定义 | 代码路径 |
|------|---------|---------|
| Shell 壳层 | `colors_and_type.css` (`.proto-layout` / `.proto-statusbar` / `.proto-sidebar`) | `components/app-shell.tsx` |
| 登录/路由 | — | `App.tsx` |
| ScopeBar | `.proto-scopebar` | `components/scope-bar.tsx` + `scope-store.ts` |
| 设计系统 | `colors_and_type.css` 的浅色 token、低噪音 KPI、面板、按钮和表单语言 | `styles.css` + `components/ui.tsx` |
| 按钮契约 | `.btn` / `.btn.primary` / `[disabled]` | `aria-busy` + spinner + `button-loading` |

---

## 二、页面映射总表

### 组 1 — 运营总览

| # | 页面 | 原型文件 | 代码路径 | 核心组件 | 交互边 | 实现状态 |
|---|------|---------|---------|---------|--------|---------|
| 1 | 登录与会话确认 | `pages/login.html` | `App.tsx` (`LoginPage` 内嵌) | `login-card` / `stat-card` | `enter-dashboard` → 今日看板 | 部分接入 |
| 2 | 今日看板 | `pages/dashboard.html` | `pages/dashboard-page.tsx` | `OperatorTaskPanel` / `KpiCard` / `StateLightGrid` / `ProgressiveDetails` | `go-product-management` → 产品管理；`jump-*` (5 条隐藏边) → 机会矩阵/设置/调度/事件/ACOS配置 | 高保真首屏接入 |
| 3 | 产品管理 | `pages/product-management.html` | `pages/product-management-page.tsx` | `KpiCard` / product-card + `aria-pressed` / inline-field / 时间线 | `go-operation-scope` → 工作范围 | 高保真首屏接入 |

### 组 2 — 数据与量化

| # | 页面 | 原型文件 | 代码路径 | 核心组件 | 交互边 | 实现状态 |
|---|------|---------|---------|---------|--------|---------|
| 4 | 工作范围 | `pages/operation-scope.html` | `pages/operation-scope-page.tsx` | `KpiCard` / FormTable / 字段确认反馈 / 推荐下一步 | `go-data-collection` → 数据采集 | 高保真首屏接入 |
| 5 | 批量数据采集 | `pages/data-collection.html` | `pages/data-collection-page.tsx` | `KpiCard` / `CollectionMonitorDrawer` / `MicroStepper` / 动作反馈三态 | `go-data-import-validation` → 指标入库 | 高保真首屏接入 |
| 6 | 指标核验入库 | `pages/data-import-validation.html` | `pages/data-import-validation-page.tsx` | `KpiCard` / `VirtualDataTable` / sortable headers / 只读锁定 | `go-ad-quant` → 量化诊断 | 高保真首屏接入 |
| 7 | 运营事件标记 | `pages/operation-events.html` | `pages/operation-events-page.tsx` | `KpiCard` / 时间轴卡片 / AI 上下文读回 / 乐观清除 | — | 高保真首屏接入 |
| 8 | 产品 ACOS 配置 | `pages/product-config.html` | `pages/product-config-page.tsx` | `KpiCard` / 批量工具栏 / inline 编辑 / 健康度列 | — | 高保真首屏接入 |
| 9 | 量化诊断中心 | `pages/ad-quant.html` | `pages/ad-quant-page.tsx` | `KpiCard` / `TagMetricGroup` 6维筛选 / AI Radar / 证据明细表 5 列 / 产品分组 / 对象时间线 | `go-recommendations` → 建议草案 | 高保真首屏接入 |

### 组 3 — 广告执行

| # | 页面 | 原型文件 | 代码路径 | 核心组件 | 交互边 | 实现状态 |
|---|------|---------|---------|---------|--------|---------|
| 10 | 优化建议草案 | `pages/recommendations.html` | `pages/recommendations-page.tsx` | `KpiCard` / 状态桶过滤 4 个 / `recommendationHasEvidenceBlocker` / 批量送审 | `go-approval` → 审批中心 | 高保真首屏接入 |
| 11 | 审批历史中心 | `pages/approval.html` | `pages/approval-page.tsx` | `KpiCard` / 选项卡 4 个 / `DecisionActionStrip` 三态 / stamp / 行退出动画 | `go-readback` → 执行回读 | 高保真首屏接入 |
| 12 | 渐进执行回读 | `pages/readback.html` | `pages/readback-page.tsx` | `KpiCard` / 4步 wizard / `SafetyGateLine` / 截图 Ctrl+V / 安全复选框 | `go-delivery` → 交付验收 | 高保真首屏接入 |

### 组 4 — 关键词与 Listing

| # | 页面 | 原型文件 | 代码路径 | 核心组件 | 交互边 | 实现状态 |
|---|------|---------|---------|---------|--------|---------|
| 13 | 关键词机会矩阵 | `pages/keyword-opportunities.html` | `pages/keyword-opportunities-page.tsx` | `KpiCard` / `VirtualDataTable` 13 列 / sticky ASIN / crossfade | `go-listing-optimization` (隐藏边) → Listing 重写 | 高保真首屏接入 |
| 14 | Listing 结构重写 | `pages/listing-optimization.html` | `pages/listing-optimization-page.tsx` | `KpiCard` / 热力图矩阵 / diff 芯片 / `contain:strict` / skeleton wave | — | 高保真首屏接入 |

### 组 5 — 系统与交付

| # | 页面 | 原型文件 | 代码路径 | 核心组件 | 交互边 | 实现状态 |
|---|------|---------|---------|---------|--------|---------|
| 15 | 本地定时调度 | `pages/scheduler.html` | `pages/scheduler-page.tsx` | `KpiCard` / cron 格式化 / 行级启用禁用 | — | 高保真首屏接入 |
| 16 | AI 适配与诊断 | `pages/settings.html` | `pages/settings-page.tsx` | `KpiCard` / AI 合同标签 3 个 / 阈值 12 字段 / 审计日志 / 安全策略 | — | 高保真首屏接入 |
| 17 | 最终验收就绪门 | `pages/delivery.html` | `pages/delivery-page.tsx` | `KpiCard` / 交付矩阵 / 回读修复 handoff / 工作包创建/检查/填充 / blocked-state | — | 高保真首屏接入 |

---

## 三、业务门禁链路（原型交互流）

```
登录会话 ──→ 今日看板 ──→ 产品管理 ──→ 工作范围 ──→ 批量数据采集
                                                         │
                                         关键词机会矩阵 ←─┼──→ 指标核验入库
                                              │           │
                                         Listing 重写      │
                                                         ↓
                                         产品 ACOS 配置 ←─ 运营事件标记 ──→ 量化诊断中心
                                                                               │
                                                                               ↓
                   最终验收就绪门 ←── 渐进执行回读 ←── 审批历史中心 ←── 优化建议草案
```

**支线**：指标入库 → 关键词机会矩阵 → Listing 结构重写 → 导出草稿
**系统**：定时调度 / AI 设置 — 独立于业务范围

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
