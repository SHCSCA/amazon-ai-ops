# Amazon AI Ops 前端视觉重构计划 v2

**日期**: 2026-07-02  
**状态**: Plan Mode - 等待批准  
**设计真源**: `amazon-ai-ops-business-prototype/` (HTML 原型)  
**实施目标**: `apps/desktop/src/renderer/`  
**方法论**: 对抗式审查（逐层比对原型 vs 实现） + 第一性原则（原型即规范）

---

## 一、布局结构对比总表（原型 vs 当前实现）

```
原型 DOM 层级                              当前实现 DOM 层级                    差距
──────────────────────────────────────    ──────────────────────────────────    ──────────────────────
.proto-layout (flex column, 100vh)        .app-shell (flex column, 100vh)      ✅ 一致
├─ .proto-statusbar (40px, 浅底)          ├─ .topbar (54px, 深蓝底 #061629)    ❌ 需重构为浅色 40px
├─ .proto-workspace (grid 192px+1fr)      ├─ .app-body (flex row)              ❌ 需改为 grid 192px+1fr
│  ├─ .proto-sidebar (192px)              │  ├─ .app-sidebar (226px)           ❌ 192px + 加品牌卡片
│  │  ├─ .proto-brand (品牌卡片)           │  │  ├─ (无品牌卡片)                 ❌ 需新增
│  │  └─ .proto-nav-group ×5              │  │  └─ .nav-group ×5               ✅ 结构一致
│  └─ .proto-main (flex column)           │  └─ .app-content (flex:1, scroll)   ⚠️ 需对齐 padding
│     ├─ .proto-scopebar (浅底, 无阴影)    │     ├─ .scope-bar (白底, 有阴影)    ❌ 重构为浅底
│     ├─ .proto-pagehead                  │     ├─ PageHeader component         ✅ 语义一致
│     └─ .proto-content (gap:10, p:0 16)  │     └─ page components             ❌ gap/padding 不一致
```

---

## 二、逐层修改清单（按 DOM 层级，自上而下）

### 第 1 层：全局 CSS 变量 + 字体 + 基础重置

**文件**: `apps/desktop/src/renderer/styles.css`

#### 1.1 替换 `:root` 变量

删除当前所有自定义变量（约 30 个 `--color-*`、`--tone-*`、`--line-*`），替换为原型 `colors_and_type.css` 的完整 `:root`：

```css
:root {
  --aao-bg: #f8fafc;
  --aao-surface: #ffffff;
  --aao-surface-2: #f1f5f9;
  --aao-surface-3: #e2e8f0;
  --aao-ink: #0f172a;
  --aao-ink-2: #475569;
  --aao-ink-3: #94a3b8;
  --aao-line: #e2e8f0;
  --aao-line-strong: #cbd5e1;
  --aao-brand-50: #eff6ff; --aao-brand-100: #dbeafe;
  --aao-brand-200: #bfdbfe; --aao-brand-300: #93c5fd;
  --aao-brand-500: #3b82f6; --aao-brand-600: #2563eb; --aao-brand-700: #1d4ed8;
  --state-success: #16a34a; --state-success-soft: #f0fdf4;
  --state-warning: #ca8a04; --state-warning-soft: #fefce8;
  --state-error: #dc2626;   --state-error-soft: #fef2f2;
  --state-info: #2563eb;    --state-info-soft: #eff6ff;
  --shadow-1: 0 1px 3px rgba(0,0,0,.06);
  --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px;
  --font-body: "DM Sans","Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  --font-mono: "DM Mono","Cascadia Mono","SFMono-Regular",Consolas,monospace;
  color-scheme: light;

  /* 向后兼容别名（保证现有 CSS 类不改也能工作） */
  --bg: var(--aao-bg);
  --panel: var(--aao-surface);
  --panel-subtle: var(--aao-surface-2);
  --line: var(--aao-line-strong);
  --line-soft: var(--aao-line);
  --line-subtle: var(--aao-surface-3);
  --text: var(--aao-ink);
  --text-main: var(--aao-ink);
  --text-secondary: var(--aao-ink-2);
  --text-muted: var(--aao-ink-3);
  --text-placeholder: var(--aao-ink-3);
  --muted: var(--aao-ink-3);
  --blue: var(--aao-brand-500);
  --blue-strong: var(--aao-brand-700);
  --blue-soft: var(--aao-brand-50);
  --green: var(--state-success);
  --green-soft: var(--state-success-soft);
  --amber: var(--state-warning);
  --amber-soft: var(--state-warning-soft);
  --red: var(--state-error);
  --red-soft: var(--state-error-soft);
  --primary: var(--aao-brand-500); /* 过渡用，后续迁移到 --aao-brand-500 */
  --radius: var(--radius-md);
  --radius-sm: var(--radius-sm);
  --radius-xs: 4px;
  --radius-lg: var(--radius-lg);
}
```

#### 1.2 全局 `body` / `button` 重置对齐原型

```css
/* 原型: font-size:13px line-height:1.5 letter-spacing:-0.01em */
body {
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.5;
  letter-spacing: -0.01em;
}

/* 原型: button transition all .15s ease, hover brightness 1.06, active scale .97 */
button {
  transition: all .15s ease;
}
button:hover:not(:disabled) {
  filter: brightness(1.06);
}
button:active:not(:disabled) {
  transform: scale(.97);
}
```

#### 1.3 字体加载

**文件**: `apps/desktop/src/renderer/index.html`  
在 `<head>` 添加：
```html
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
```

---

### 第 2 层：Statusbar（当前叫 Topbar）

**原型结构**:
```html
<header class="proto-statusbar">
  <div class="chip-row"><strong>Amazon AI Ops</strong></div>
  <div class="chip-row"><span class="badge ready">本机加密已启用</span><span class="badge info">证据优先链路</span><span>USD 口径</span></div>
</header>
```

**当前结构 — `App.tsx`**:
```html
<header className="topbar">
  <div className="brand"><strong>...</strong><span>v1.5.0</span><span className="app-status">...</span></div>
  <div className="topbar-right"><strong>{store}</strong><span className="session-line">...</span><button>退出登录</button></div>
</header>
```

**CSS 修改 — `styles.css`**:
```css
/* 原型: 40px 高, 浅底, flex space-between, font-size:11px */
.topbar {
  min-height: 40px;
  padding: 0 16px;
  border-bottom: 1px solid var(--aao-line);
  background: var(--aao-surface-2);
  color: var(--aao-ink-2);
  font-size: 11px;
}
.topbar strong { color: var(--aao-brand-600); }  /* 品牌色文字 */
.brand { gap: 8px; }
.brand span { color: var(--aao-ink-3); }  /* 次要信息 */
```

**TSX 调整 — `App.tsx`**:  
保持现有 DOM 结构不变（版本号、验收状态、店铺、会话、退出按钮）。只改变 CSS 渲染效果。

---

### 第 3 层：Workspace（当前叫 app-body）

**原型**: `.proto-workspace { flex:1; display:grid; grid-template-columns: 192px minmax(0,1fr); }`  
**当前**: `.app-body { display:flex; }`

**CSS 修改 — `styles.css`**:
```css
.app-body {
  display: grid;
  grid-template-columns: 192px minmax(0, 1fr);
  min-height: 0;
  flex: 1;
}
```

---

### 第 4 层：Sidebar

**原型结构**:
```html
<aside class="proto-sidebar">
  <div class="proto-brand"><strong>Amazon AI Ops</strong><span>v1.5</span></div>
  <div class="proto-nav-group"><p class="proto-nav-title">总览</p>
    <button class="proto-nav-item" data-active="true"><span>今日看板</span></button>
  </div>
  <!-- ×4 more groups -->
</aside>
```

**CSS 修改 — `styles.css`**:
```css
/* 原型: 192px, padding:12px 8px, surface 背景 */
.app-sidebar {
  width: 192px;
  padding: 12px 8px;
  border-right: 1px solid var(--aao-line);
  background: var(--aao-surface);
}

/* 原型 .proto-brand: padding:10px, rounded, surface-2 背景, margin-bottom:10px */
.sidebar-brand {
  padding: 10px;
  border-radius: var(--radius-sm);
  background: var(--aao-surface-2);
  margin-bottom: 10px;
}
.sidebar-brand strong {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: var(--aao-brand-600);
  letter-spacing: -0.02em;
}
.sidebar-brand span {
  font-size: 10px;
  color: var(--aao-ink-3);
}

/* 原型 .proto-nav-title: font-size:9px, uppercase, ink-3 */
.nav-group-label {
  margin: 0 0 4px;
  padding: 0 8px;
  color: var(--aao-ink-3);
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

/* 原型 .proto-nav-item: width:100%, flex, gap:6px, padding:6px 8px, font-size:12px */
.nav-item {
  padding: 6px 8px;
  border: 1px solid transparent;
  border-left: 0;     /* 原型的 nav-item 没有左边框 */
  border-radius: 4px;
  background: transparent;
  color: var(--aao-ink-2);
  font-size: 12px;
  letter-spacing: -0.01em;
}
/* 保留现有的 aria-current 激活态样式，但颜色对齐原型 */
.nav-item[aria-current="page"] {
  border-color: var(--aao-brand-200);
  background: var(--aao-brand-50);
  color: var(--aao-brand-700);
}
.nav-item:hover:not([aria-current="page"]) {
  background: var(--aao-surface-2);
}
/* 保留 pending 态但颜色对齐 */
.nav-item[data-pending="true"] {
  border-left: 0;       /* pending 也用全边框而非左边框 */
  border-color: var(--aao-brand-200);
  background: var(--aao-brand-50);
  color: var(--aao-brand-700);
}

/* 序号标签保留但颜色对齐 */
.nav-item-index {
  border-color: var(--aao-line);
  color: var(--aao-ink-3);
}
.nav-item[aria-current="page"] .nav-item-index {
  border-color: var(--aao-brand-300);
  background: #fff;
  color: var(--aao-brand-700);
}

/* 保留 glow bar 动画但缩小 */
.nav-item::before {
  /* 保留现有实现 */
}
```

**TSX 修改 — `app-shell.tsx`**:  
在 `<nav className="app-sidebar">` 开头（`{navGroups.map(...)}` 之前）插入：
```tsx
<div className="sidebar-brand">
  <strong>Amazon AI Ops</strong>
  <span>高密度证据驱动桌面工作台</span>
</div>
```

**保留不变**: 所有 `role="group"`、`role="list"`、`role="listitem"`、`aria-current`、`aria-busy`、`data-pending`、序号标签、glow bar 动画。

---

### 第 5 层：ScopeBar

**原型结构**:
```html
<div class="proto-scopebar">
  <strong>当前范围：2026-06-24 - 06-30 / US / B0C8QW42LM</strong>
  <div class="proto-scope-tags">
    <span class="badge ready">已保存</span>
  </div>
</div>
```
- flex, space-between
- 左：strong 行内 scope 文本
- 右：badge 标签

**当前结构 — `scope-bar.tsx`**: 比原型多出批次选择器、编辑按钮、facts chips、ProgressiveDetails、弹窗编辑器。这些是**功能增强**，必须保留。

**CSS 修改 — `styles.css`**:
```css
/* 原型: surface-2 底, padding:6px 16px, 无阴影, 字体11px */
.scope-bar {
  background: var(--aao-surface-2);
  padding: 6px 16px;
  border-bottom: 1px solid var(--aao-line);
  box-shadow: none;
  font-size: 11px;
}

/* scope title row: flex space-between 对齐原型 */
.scope-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.scope-title-main { display: flex; align-items: center; gap: 6px; }
.scope-title-main span { color: var(--aao-ink-3); font-size: 11px; font-weight: 600; }
.scope-title-main strong {
  font-family: var(--font-mono);
  font-size: 11px;
}

/* scope facts 从 chip 改为 badge */
.scope-compact-facts { padding-top: 4px; border-top: none; }
.scope-fact {
  background: transparent;
  border: 1px solid var(--aao-line);
  color: var(--aao-ink-2);
  font-size: 10px;
}
```

**TSX 无需修改**: `scope-bar.tsx` 的 all logic (批次选择器、编辑按钮、编辑器、字段确认反馈) 保持不变。

---

### 第 6 层：PageHeader

**原型结构**:
```html
<header class="proto-pagehead">
  <div><h1>页面标题</h1><p>页面描述</p></div>
  <div class="action-row"><button class="btn primary">操作按钮</button></div>
</header>
```

**当前结构 — `ui.tsx` `PageHeader` component**:  
左侧 `eyebrow + h1 + p`，右侧 `page-header-rail` 任务卡片。

**CSS 修改 — `styles.css`**:
```css
/* 原型: flex space-between, padding:14px 16px 6px */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 16px 6px;
}
.page-header h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.page-header .page-eyebrow {
  color: var(--aao-ink-3);
  font-size: 10px;
  font-weight: 600;
}
.page-header p {
  margin: 1px 0 0;
  color: var(--aao-ink-3);
  font-size: 11px;
  max-width: 480px;
}
```

**TSX 无需修改**: `PageHeader` 组件结构保持不变。

---

### 第 7 层：主内容区

**原型**: `.proto-content { padding:0 16px 16px; display:flex; flex-direction:column; gap:10px; }`  
**当前**: `.app-content { padding:0 24px 28px; }`

**CSS 修改 — `styles.css`**:
```css
.app-content {
  padding: 0 16px 28px;
  /* 其余不变 */
}
```

页面内部使用 `gap: 10px` 的 flex column 布局应通过各个页面的 section 级间距实现。

---

### 第 8 层：共享组件样式对齐原型

#### 8.1 Panel 面板
```css
.ui-panel {
  padding: 12px;
  border: 1px solid var(--aao-line);
  border-radius: var(--radius-md);
  background: var(--aao-surface);
  /* 移除 box-shadow */
  box-shadow: none;
}
```

#### 8.2 按钮
```css
.primary-button {
  background: var(--aao-brand-600);
  border: 1px solid var(--aao-brand-600);
  color: #fff;
  font-weight: 600;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 4px;
  font-size: 11px;
}
.primary-button:hover {
  filter: brightness(1.06);
}
.secondary-button, .compact-button {
  background: var(--aao-surface);
  border: 1px solid var(--aao-line-strong);
  color: var(--aao-ink-2);
  min-height: 30px;
  padding: 0 10px;
}
```

#### 8.3 StatusPill / Badge
```css
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 10px;
  border: 1px solid var(--aao-line);
  letter-spacing: -0.01em;
}
.status-ready { color: var(--state-success); background: var(--state-success-soft); }
.status-blocked { color: var(--state-error); background: var(--state-error-soft); }
.status-warning { color: var(--state-warning); background: var(--state-warning-soft); }
.status-info { color: var(--state-info); background: var(--state-info-soft); }
```

#### 8.4 KPI 卡片
```css
.kpi, .status-card {
  padding: 10px 12px;
  border: 1px solid var(--aao-line);
  border-radius: var(--radius-md);
  background: var(--aao-surface);
  box-shadow: none;
}
.kpi label, .status-card label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.kpi strong, .status-card strong {
  font-size: 20px;
  line-height: 1.15;
  font-family: var(--font-mono);
  font-weight: 500;
}
```

#### 8.5 表格
```css
.table-wrap {
  overflow: auto;
  border: 1px solid var(--aao-line);
  border-radius: var(--radius-sm);
}
table { border-collapse: collapse; background: var(--aao-surface); }
th, td { padding: 6px 8px; border-bottom: 1px solid var(--aao-line); font-size: 11px; }
th {
  background: var(--aao-surface-2);
  color: var(--aao-ink-2);
  font-weight: 600;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
tr:hover td { background: var(--aao-surface-2); }
```

#### 8.6 Grid 布局
```css
.kpi-strip, .status-grid, .quad-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.triple-grid, .steps-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.dual-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
```

---

### 第 9 层：App.tsx 主内容区结构调整

**当前**: `ScopeBar` 渲染在 `.app-content` 内部，使用负 margin 撑满。

**改为**: ScopeBar 保持在 `.app-content` 内，但移除负 margin，使用原型风格 padding。

```css
/* ScopeBar 不再用负 margin 撑满 */
.scope-bar {
  position: sticky;
  top: 0;
  z-index: 30;
  margin: 0 -16px 10px;  /* 原来是 -24px，改为 -16px 对齐 app-content padding */
  /* 其余不变 */
}
```

---

## 三、完整修改文件清单

| # | 文件 | 修改类别 | 修改量 |
|---|------|---------|--------|
| 1 | `styles.css` | CSS 变量替换 + 布局重构 + 组件样式对齐 | 大量（核心文件） |
| 2 | `index.html` | 添加 Google Font link | 2 行 |
| 3 | `app-shell.tsx` | 添加 sidebar 品牌卡片 `<div>` | 4 行 |
| 4 | `App.tsx` | **不修改**（CSS 层完成全部视觉变化） | 0 行 |

---

## 四、验证清单

```powershell
# 1. 开发环境验证
pnpm dev
# 目视检查：Statusbar浅色、Sidebar 192px+品牌卡、ScopeBar浅底、PageHeader 18px h1

# 2. 类型检查
pnpm --filter @amazon-ai-ops/desktop run typecheck

# 3. 构建
pnpm --filter @amazon-ai-ops/desktop run build:win

# 4. 冒烟测试
pnpm run smoke:business-ui-current
pnpm run smoke:package-launch
pnpm run verify:ad-execution
```

---

## 五、不变项（功能安全保障）

| 层次 | 不变内容 |
|------|---------|
| 所有 `.tsx` JSX 结构 | 除 app-shell.tsx 插入 4 行品牌卡片外，完全不改 |
| 所有 IPC 调用 | 零数据层变化 |
| 所有 Zustand store | 零状态层变化 |
| 所有 ARIA 语义 | `role`、`aria-*` 属性完整保留 |
| 所有 busy/loading 交互 | `button-loading`、spinner、`aria-busy` 完整保留 |
| 所有 @keyframes 动画 | 保留现有动画关键帧 |
| 所有事件处理 | onClick、onChange、CustomEvent 监听完整保留 |
| 路由系统 | activeTab/requestNavigate 零变化 |
