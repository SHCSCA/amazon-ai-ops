# V1.6 集成测试计划

> 2026-10-27 文档对齐：本文定义合同、方法或验收案例，不提供当前通过结论。现行状态、失败与后续计划统一见 [项目状态](PROJECT_STATUS.md)；当前仍为 APP_NEEDS_WORK / INTERNAL NON_READY。正文中的旧检查点只适用于当时版本。

> **创建日期**：2026-09-07  
> **目标**：验证 99% 完成度的真实性  
> **预计工作量**：2-3 天

---

## 🎯 测试目标

### 主要目标
1. **验证后端集成**：6 个 Services 协同工作
2. **验证前端集成**：Mission Control Shell 完整可用
3. **验证数据库集成**：Migration 链路正确
4. **验证跨店铺隔离**：店铺切换完整替换上下文

### 次要目标
1. **验证权限链路**：店铺/任务/决策/执行权限正确
2. **验证 IPC 契约**：Main/IPC/Preload 三层一致
3. **验证错误处理**：异常路径正确处理

---

## 📋 测试范围

### 后端集成测试（1 天）

#### 1. V1.6 Services 协同测试

**测试场景**：Mission → Decision → Execution → Memory 完整链路

**测试用例**：
```typescript
describe('V1.6 Services Integration', () => {
  test('Mission creates Decision', async () => {})
  test('Decision enables Execution', async () => {})
  test('Execution records Memory', async () => {})
  test('Experiment tracks variation', async () => {})
  test('MissionGrant authorizes Decision', async () => {})
  test('PolicyVersion governs all services', async () => {})
})
```

**预计用例**：20-30 个

---

#### 2. 店铺隔离测试

**测试场景**：切换店铺后，所有上下文正确替换

**测试用例**：
```typescript
describe('Store Isolation', () => {
  test('Store A context does not leak to Store B', async () => {})
  test('Store switching replaces Mission list', async () => {})
  test('Store switching replaces Decision queue', async () => {})
  test('Store switching replaces Execution list', async () => {})
  test('Store switching replaces Memory records', async () => {})
  test('Store switching replaces Experiment data', async () => {})
})
```

**预计用例**：10-15 个

---

#### 3. 权限链路测试

**测试场景**：店铺 → 任务 → 决策 → 执行 的权限传递

**测试用例**：
```typescript
describe('Authority Chain', () => {
  test('Store authority validates Mission', async () => {})
  test('Mission authority validates Decision', async () => {})
  test('Decision authority validates Execution', async () => {})
  test('Memory authority references Execution', async () => {})
  test('Experiment authority references Mission', async () => {})
})
```

**预计用例**：10-15 个

---

### 前端集成测试（1 天）

#### 1. Mission Control Shell 测试

**测试场景**：10 个 Workspace 协同工作

**测试用例**：
```typescript
describe('Mission Control Shell', () => {
  test('Router navigates between workspaces', async () => {})
  test('Navigation highlights current workspace', async () => {})
  test('Workspace state persists across navigation', async () => {})
  test('Cross-workspace data sharing works', async () => {})
})
```

**预计用例**：10-15 个

---

#### 2. Workspace 渲染测试

**测试场景**：每个 Workspace 正确渲染

**测试用例**：
```typescript
describe.each([
  ['Today', 'today-workspace'],
  ['Missions', 'missions-workspace'],
  ['Decisions', 'decisions-workspace'],
  ['Execution', 'execution-workspace'],
  ['Experiments', 'experiments-workspace'],
  ['Memory', 'memory-workspace'],
])('Workspace: %s', (name, file) => {
  test('renders without error', async () => {})
  test('displays correct state', async () => {})
  test('handles user interaction', async () => {})
  test('updates on data change', async () => {})
})
```

**预计用例**：24 个（6 个 Workspace × 4 个用例）

---

#### 3. UI 组件集成测试

**测试场景**：UI 组件与 Services 联动

**测试用例**：
```typescript
describe('UI Component Integration', () => {
  test('MissionFlightPanel subscribes to MissionService', async () => {})
  test('DecisionQueuePanel subscribes to DecisionService', async () => {})
  test('ExecutionMonitorPanel subscribes to ExecutionService', async () => {})
  test('MemoryBrowserPanel subscribes to MemoryService', async () => {})
})
```

**预计用例**：8-10 个

---

### 数据库集成测试（0.5 天）

#### 1. Migration 升级路径测试

**测试场景**：从 V1.5 升级到 V1.6

**测试用例**：
```typescript
describe('Migration Upgrade Path', () => {
  test('V1.5 schema upgrades to V1.6', async () => {})
  test('Data is preserved during upgrade', async () => {})
  test('Indexes are recreated correctly', async () => {})
  test('Foreign keys are maintained', async () => {})
})
```

**预计用例**：8-10 个

---

#### 2. 事务一致性测试

**测试场景**：复杂事务正确处理

**测试用例**：
```typescript
describe('Transaction Consistency', () => {
  test('Mission + Decision in single transaction', async () => {})
  test('Rollback on partial failure', async () => {})
  test('Concurrent writes are serialized', async () => {})
})
```

**预计用例**：5-8 个

---

### 端到端测试（0.5 天）

#### 1. 完整业务流程测试

**测试场景**：从用户登录到完成任务的完整流程

**测试用例**：
```typescript
describe('End-to-End Business Flow', () => {
  test('Operator creates Mission', async () => {})
  test('System generates Decision', async () => {})
  test('Operator approves Decision', async () => {})
  test('System executes Decision', async () => {})
  test('System records Memory', async () => {})
  test('Operator reviews Memory', async () => {})
})
```

**预计用例**：6-10 个

---

## 🛠️ 测试工具

### 1. 测试框架
- **Vitest**：单元测试和集成测试
- **Playwright**（可选）：E2E 测试
- **@testing-library/react**：React 组件测试

### 2. 测试工具库
- **msw**：Mock Service Worker
- **fake-indexeddb**：IndexedDB Mock
- **better-sqlite3**：真实 SQLite 测试

### 3. 覆盖率工具
- **c8**：代码覆盖率
- **istanbul**：覆盖率报告
- **lcov**：覆盖率可视化

---

## 📊 测试指标

### 覆盖率目标

| 模块 | 当前 | 目标 |
|------|------|------|
| V1.6 Services | 60% | 90%+ |
| Workspace 组件 | 50% | 85%+ |
| UI 组件 | 40% | 80%+ |
| Migration | 70% | 95%+ |
| Repository | 60% | 90%+ |
| **整体** | **55%** | **85%+** |

### 通过率目标

| 阶段 | 通过率 |
|------|--------|
| 单元测试 | 100% |
| 集成测试 | 95%+ |
| E2E 测试 | 90%+ |

---

## 📅 时间安排

### Day 1：后端集成（5-6 小时）

**上午**：
- [ ] V1.6 Services 协同测试（2 小时）
- [ ] 店铺隔离测试（1 小时）

**下午**：
- [ ] 权限链路测试（1 小时）
- [ ] 修复发现的问题（2 小时）

**交付物**：
- `v16-integration.test.ts` 完善
- `v16-store-isolation-integration.test.ts` 完善
- 后端集成测试报告

---

### Day 2：前端集成（5-6 小时）

**上午**：
- [ ] Mission Control Shell 测试（1 小时）
- [ ] Workspace 渲染测试（2 小时）

**下午**：
- [ ] UI 组件集成测试（1 小时）
- [ ] 修复发现的问题（2 小时）

**交付物**：
- `v16-module-navigation.test.tsx` 完善
- `v16-module-router.test.ts` 完善
- `v16-module-bridge.test.ts` 完善
- 前端集成测试报告

---

### Day 3：数据库 + E2E（5-6 小时）

**上午**：
- [ ] Migration 升级路径测试（1 小时）
- [ ] 事务一致性测试（1 小时）

**下午**：
- [ ] E2E 业务流程测试（2 小时）
- [ ] 生成最终集成测试报告（1 小时）

**交付物**：
- Migration 集成测试
- E2E 测试套件
- 集成测试总报告

---

## ✅ 验收标准

### 必须达成

1. **所有集成测试通过**（≥ 95%）
2. **关键路径 100% 覆盖**
3. **店铺隔离 100% 验证**
4. **权限链路 100% 验证**

### 推荐达成

1. **所有集成测试通过**（100%）
2. **覆盖率 ≥ 85%**
3. **E2E 流程完整**
4. **零集成缺陷**

---

## 📋 测试用例清单

### 后端（40-50 个）

| 类别 | 数量 | 状态 |
|------|------|------|
| Services 协同 | 20-30 | ⏳ |
| 店铺隔离 | 10-15 | ⏳ |
| 权限链路 | 10-15 | ⏳ |

### 前端（40-50 个）

| 类别 | 数量 | 状态 |
|------|------|------|
| Shell | 10-15 | ⏳ |
| Workspace | 24 | ⏳ |
| UI 组件 | 8-10 | ⏳ |

### 数据库（15-20 个）

| 类别 | 数量 | 状态 |
|------|------|------|
| Migration | 8-10 | ⏳ |
| 事务 | 5-8 | ⏳ |

### E2E（6-10 个）

| 类别 | 数量 | 状态 |
|------|------|------|
| 业务流程 | 6-10 | ⏳ |

**总计**：100-130 个集成测试用例

---

## 🎯 风险与缓解

### 风险 1：集成问题发现晚

**风险**：集成测试可能发现架构问题  
**缓解**：
- 优先测试关键路径
- 准备回滚方案
- 分阶段验证

### 风险 2：测试环境不一致

**风险**：不同环境的测试结果可能不一致  
**缓解**：
- 使用 Docker 容器化测试环境
- 锁定依赖版本
- 使用 CI/CD 标准化

### 风险 3：测试数据管理

**风险**：测试数据可能污染或冲突  
**缓解**：
- 每个测试前重置数据库
- 使用事务隔离
- 使用工厂函数生成测试数据

---

## 📝 测试报告模板

### 单次测试报告

```markdown
## 测试报告：V1.6 Services Integration

**测试日期**：2026-09-XX  
**测试人员**：开发团队  
**测试环境**：Windows + Node 20 + Electron 28

### 测试结果
- 总用例数：30
- 通过：28
- 失败：2
- 跳过：0
- 通过率：93.3%

### 失败用例
1. **Mission creates Decision**
   - 错误：Timeout
   - 原因：DecisionService 初始化慢
   - 修复：增加超时时间到 10s

2. **Execution records Memory**
   - 错误：Type mismatch
   - 原因：MemoryService 期望不同的字段
   - 修复：更新字段映射

### 性能指标
- 平均响应时间：150ms
- P95 响应时间：500ms
- P99 响应时间：1.2s

### 建议
- 优化 DecisionService 初始化
- 统一 MemoryService 字段
```

---

## 🏆 总结

### 工作量

- **总耗时**：2-3 天
- **测试用例**：100-130 个
- **覆盖模块**：15+ 个
- **覆盖路径**：50+ 条

### 收益

- ✅ 验证 99% 完成度
- ✅ 发现潜在集成问题
- ✅ 提供回归保护
- ✅ 增强发布信心

### 后续

- ✅ 测试结果作为 V1.6 交付证据
- ✅ 集成测试纳入 CI/CD
- ✅ 持续维护和扩展

---

**计划版本**：1.0  
**创建日期**：2026-09-07  
**预计开始**：2026-09-08  
**预计完成**：2026-09-10
