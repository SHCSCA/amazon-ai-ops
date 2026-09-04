# V1.6 阶段 4 进度报告

> 开始时间：2026-09-04 09:00  
> 当前时间：2026-09-04 09:11  
> 阶段名称：六模块信息架构重组  
> 状态：🔄 **30% 完成**

---

## 执行概要

V1.6 阶段 4（六模块信息架构重组）已启动，目标是将现有的 10 个 workspace 和 22 个 intent 重新组织到 6 个业务模块下，提供统一的用户导航体验。

### 核心成果（截至目前）

| 指标 | 完成情况 |
|------|---------|
| V16 Module Router 完善 | ✅ 完成 |
| 22 intent 到 6 模块映射 | ✅ 完成 |
| V16ModuleNavigation 组件 | ✅ 完成 |
| Router 测试 | ✅ 16/16 通过 |
| Navigation 测试 | ✅ 7/7 通过 |
| Shell 集成 | ⏳ 进行中 |
| 面包屑和状态 | ⏳ 待开始 |
| 向后兼容测试 | ⏳ 待开始 |
| **阶段 4 总进度** | **30%** |

---

## 六个业务模块定义

根据 PRD v1.6.0，统一的 6 个业务模块为：

### 1️⃣ 今日任务（Today）
- **ID**: `today`
- **描述**: 当前唯一主动作、准备度摘要、最近一次验证
- **包含 workspace**: `today`
- **包含 intent (2)**:
  - `today:overview` — 今日总览
  - `today:events` — 运营事件

### 2️⃣ 运营资产（Operations Assets）
- **ID**: `operations-assets`
- **描述**: 产品、广告对象路径、exact 8/8 报表、Listing 本地草案
- **包含 workspace**: `objects`, `collection`
- **包含 intent (7)**:
  - `objects:products` — 产品与目标
  - `objects:targets` — 成本与目标
  - `objects:keywords` — 关键词机会
  - `objects:listing` — Listing 草案
  - `collection:scope` — 采集范围
  - `collection:reports` — 采集任务
  - `collection:import-check` — 导入检查

### 3️⃣ 决策中心（Decision Center）
- **ID**: `decision-center`
- **描述**: Analysis Runs、AI 建议、Decision 历史、MissionGrant 详情
- **包含 workspace**: `missions`, `decisions`
- **包含 intent (5)**:
  - `missions:overview` — 运营任务队列
  - `missions:facts` — 广告事实
  - `decisions:recommendations` — 待判断
  - `decisions:approval` — 待审批
  - `decisions:decided` — 已处理

### 4️⃣ 执行与实验（Execution & Experiments）
- **ID**: `execution-experiments`
- **描述**: preflight gates、可见执行、三段回读、Experiment 跟踪
- **包含 workspace**: `execution`, `experiments`
- **包含 intent (3)**:
  - `execution:live` — 可见执行
  - `execution:evidence` — 执行回读
  - `experiments:ledger` — 经营实验

### 5️⃣ 经营记忆（Operating Memory）
- **ID**: `operating-memory`
- **描述**: 六阶段因果时间线、可信索引、correction 追加、安全导出
- **包含 workspace**: `memory`
- **包含 intent (1)**:
  - `memory:timeline` — 因果时间线

### 6️⃣ 系统设置（System Settings）
- **ID**: `system-settings`
- **描述**: 店铺、ERP/Ads 连接、写入模式、策略版本、scheduler、AI config
- **包含 workspace**: `policy`, `settings`
- **包含 intent (4)**:
  - `policy:rules` — 策略与风控
  - `settings:ai-and-local` — AI 与本地
  - `settings:scheduler` — 定时任务
  - `settings:delivery` — 交付验收

**总计**: 6 个模块，10 个 workspace，22 个 intent

---

## 已完成工作

### 1. V16 Module Router 完善 ✅

**文件**: `apps/desktop/src/renderer/mission-control/workspaces/v16-module-router.ts`

**新增内容**:
- 修正 `system-settings` 模块包含 `policy` workspace
- 新增 `V16ModuleWithIntents` 类型，包含 intent 列表
- 新增 `V16_MODULE_INTENT_MAP` 常量，完整映射 22 个 intent
- 新增 `findModuleForIntent()` 函数，根据 intent 查找父模块
- 新增 `assertIntentCoverage()` 函数，验证 22 个 intent 全覆盖

**测试**: 16/16 通过
- ✅ 6 个模块数量验证
- ✅ 10 个 workspace 映射验证
- ✅ 22 个 intent 完整性验证
- ✅ 无重复 workspace 验证
- ✅ 无重复 intent 验证
- ✅ 所有 intent 可查找验证

### 2. V16ModuleNavigation 组件 ✅

**文件**: 
- `apps/desktop/src/renderer/mission-control/components/v16-module-navigation.tsx`
- `apps/desktop/src/renderer/mission-control/components/v16-module-navigation.css`

**组件特性**:
- 渲染 6 个模块按钮
- 支持 active 状态（蓝色高亮 + 左侧指示条）
- 支持 pending 状态（转跳中...提示 + 禁用）
- 每个模块显示图标 + 中文标签
- 完整的 ARIA 语义（aria-current、aria-busy、role）
- 键盘焦点可见
- Reduced-motion 支持

**CSS 特性**:
- 模块按钮：hover 背景色、active 缩放、focus 边框
- 激活状态：蓝色背景 + 左侧 3px 指示条
- 挂起状态：转跳中芯片 + 禁用
- Dark mode 支持（媒体查询）
- 紧凑模式支持

**辅助函数**:
- `getModuleDefaultIntent()` — 获取模块的默认 intent

**测试**: 7/7 通过
- ✅ 所有 6 个模块默认 intent 验证

---

## 进行中工作

### 3. 集成到 mission-control-shell 🔄

**目标**: 将 V16ModuleNavigation 集成到主 Shell 中，替换旧的 workspace 导航

**计划**:
1. 在 Shell 中添加 `activeModuleId` 和 `pendingModuleId` 状态
2. 根据当前 `activeIntent` 计算 `activeModuleId`
3. 创建 `handleModuleNavigation` 处理器
4. 渲染 V16ModuleNavigation 替代旧侧边栏（或并存过渡期）
5. 保持 22 个 intent 的向后兼容路由

---

## 待开始工作

### 4. 模块级面包屑和状态 ⏳

**目标**: 在页面顶部显示当前模块路径和状态

**计划**:
- 创建 ModuleBreadcrumb 组件
- 显示：模块名称 > workspace 名称 > subview 名称
- 添加模块级状态指示（blocked、prototype-only 等）

### 5. 向后兼容测试 ⏳

**目标**: 确保 22 个旧 intent 仍可正常导航

**计划**:
- 测试所有 22 个 intent 的路由映射
- 测试模块切换不影响 workspace 内跳转
- 测试 legacy route 到 intent 的转换

### 6. 导航完整性测试 ⏳

**目标**: E2E 测试完整导航流程

**计划**:
- 测试 6 个模块的默认 intent
- 测试模块间切换
- 测试 workspace 和 subview 切换
- 测试 pending 状态和 busy 反馈

---

## 文件清单

### 已完成文件（6 个）

**Router 层**（2 个）:
- `apps/desktop/src/renderer/mission-control/workspaces/v16-module-router.ts` ✅
- `apps/desktop/src/renderer/mission-control/workspaces/v16-module-router.test.ts` ✅

**组件层**（4 个）:
- `apps/desktop/src/renderer/mission-control/components/v16-module-navigation.tsx` ✅
- `apps/desktop/src/renderer/mission-control/components/v16-module-navigation.css` ✅
- `apps/desktop/src/renderer/mission-control/components/v16-module-navigation.test.tsx` ✅

**文档**（1 个）:
- `docs/V1_6_PHASE_4_PROGRESS.md` ✅ (本文件)

### 待修改文件（预估 3-5 个）

**Shell 集成**:
- `apps/desktop/src/renderer/mission-control/mission-control-shell.tsx` — 集成新导航
- `apps/desktop/src/renderer/styles/mission-control-shell.css` — 更新样式

**面包屑**:
- `apps/desktop/src/renderer/mission-control/components/module-breadcrumb.tsx` — 待创建
- `apps/desktop/src/renderer/mission-control/components/module-breadcrumb.css` — 待创建

---

## 测试统计

| 测试套件 | 通过 | 总计 | 状态 |
|---------|---:|---:|------|
| v16-module-router.test.ts | 16 | 16 | ✅ |
| v16-module-navigation.test.tsx | 7 | 7 | ✅ |
| **总计** | **23** | **23** | ✅ |

---

## 技术亮点

### 1. 完整的 22 intent 映射

- 每个 intent 都精确映射到唯一的父模块
- 提供双向查找：workspace → module、intent → module
- 运行时合同验证：确保无重复、无遗漏

### 2. 声明式模块定义

```typescript
const V16_MODULE_INTENT_MAP = [
  {
    ...V16_SIX_MODULES[0], // 今日任务
    intents: [
      { workspace: 'today', subview: 'overview' },
      { workspace: 'today', subview: 'events' },
    ],
  },
  // ... 5 more modules
];
```

### 3. 组件化导航

- 纯 React 组件，无全局状态依赖
- 完整的 TypeScript 类型
- 可测试的辅助函数
- ARIA 语义完整

### 4. 向后兼容

- 保持 22 个 intent 不变
- 保持旧的 AppRoute 路由映射
- 只在 UI 层添加模块分组

---

## 下一步计划

### 立即任务（1-2 小时）

1. 在 mission-control-shell 中集成 V16ModuleNavigation
2. 添加模块 ID 状态管理
3. 实现模块导航处理器

### 短期任务（2-3 小时）

4. 创建 ModuleBreadcrumb 组件
5. 添加模块级状态指示

### 验证任务（1-2 小时）

6. 编写向后兼容测试
7. 编写导航完整性测试
8. 手动测试完整导航流程

---

## 进度里程碑

- [x] **2026-09-04 09:00** — 阶段 4 启动
- [x] **2026-09-04 09:05** — V16 Module Router 完善完成
- [x] **2026-09-04 09:10** — V16ModuleNavigation 组件完成
- [ ] **2026-09-04 10:00** — Shell 集成完成（预计）
- [ ] **2026-09-04 11:00** — 面包屑和状态完成（预计）
- [ ] **2026-09-04 12:00** — 测试和验证完成（预计）
- [ ] **2026-09-04 13:00** — 阶段 4 完成（预计）

---

**报告生成时间**：2026-09-04 09:11  
**报告版本**：1.0  
**阶段状态**：🔄 进行中（30% 完成）
