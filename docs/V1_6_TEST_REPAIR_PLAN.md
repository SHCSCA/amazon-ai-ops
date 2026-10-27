# V1.6 测试修复详细计划

> 历史文档（2026-10-27 归类）：以下计划、完成声明、计数、包哈希及 READY 只描述原阶段，不代表当前版本。现行状态及后续工作见 [项目状态](PROJECT_STATUS.md)；保留正文供追溯，不自动重新执行旧计划。

> **创建日期**：2026-09-07  
> **目标**：修复 342 个失败测试，提升覆盖率 70% → 95%+  
> **预计工作量**：5-7 天

---

## 📊 测试现状

### 总体数据

| 指标 | 数值 |
|------|------|
| 测试文件总数 | 379 |
| 通过文件 | 307 |
| 失败文件 | 72 |
| 测试用例总数 | 4,397 |
| 通过用例 | 4,122 |
| 失败用例 | 275 |
| 占位用例 | 67 |
| **待修复总计** | **342** |
| 当前通过率 | **70%** |

### 失败原因分类

```
342 个失败测试
├── 275 个（80%）：Legacy 测试 - IPC 契约变更
└── 67 个（20%）：占位测试 - L2/L3/L4 TODO
```

---

## 🔧 修复策略

### 阶段 1：分类和分析（0.5 天）

#### 1.1 收集失败信息

```bash
# 运行所有测试，捕获失败信息
pnpm test 2>&1 | tee test-results-full.txt

# 提取失败文件
grep -E "FAIL|✗" test-results-full.txt | awk -F' ' '{print $2}' > failed-files.txt

# 提取失败原因
grep -E "Error:|TypeError:|ReferenceError:" test-results-full.txt > failed-reasons.txt
```

#### 1.2 分类失败原因

| 失败类型 | 数量 | 占比 | 修复难度 |
|---------|------|------|---------|
| IPC 契约变更 | 200 | 58% | 中 |
| 类型不匹配 | 50 | 15% | 低 |
| API 路径错误 | 25 | 7% | 低 |
| 占位测试 | 67 | 20% | 高 |
| **总计** | **342** | **100%** | - |

---

### 阶段 2：批量修复 Legacy 测试（4-5 天）

#### 2.1 IPC 契约变更修复（3-4 天）

**问题**：V1.6 重构后，IPC 契约从扁平化改为命名空间化

**旧契约**：
```typescript
window.electronAPI.v16MissionCreate(input)
window.electronAPI.v16DecisionCreate(input)
window.electronAPI.v16ExecutionStart(input)
```

**新契约**：
```typescript
window.electronAPI.v16.mission.create(input)
window.electronAPI.v16.decision.create(input)
window.electronAPI.v16.execution.start(input)
```

**修复步骤**：

1. **生成迁移映射表**
```typescript
const IPC_MIGRATION_MAP = {
  'v16MissionCreate': 'v16.mission.create',
  'v16MissionList': 'v16.mission.list',
  'v16MissionGet': 'v16.mission.get',
  'v16MissionUpdate': 'v16.mission.update',
  'v16MissionDelete': 'v16.mission.delete',
  'v16DecisionCreate': 'v16.decision.create',
  'v16DecisionList': 'v16.decision.list',
  // ... 更多映射
}
```

2. **编写自动修复脚本**
```javascript
// scripts/fix-v16-test-ipc.mjs
import fs from 'fs'
import path from 'path'

const MIGRATION_MAP = {
  // ... 映射表
}

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  for (const [old, newPath] of Object.entries(MIGRATION_MAP)) {
    content = content.replaceAll(old, newPath)
  }
  fs.writeFileSync(filePath, content)
}
```

3. **逐个验证**
```bash
pnpm test <path-to-test-file>
```

**预计工作量**：3-4 天

---

#### 2.2 类型不匹配修复（0.5-1 天）

**问题**：V1.6 引入了更严格的类型检查

**常见错误**：

```typescript
// 错误：undefined 检查
expect(result).toBe(undefined)

// 正确：使用 toBeUndefined
expect(result).toBeUndefined()
```

```typescript
// 错误：any 类型
const data: any = await service.get()

// 正确：使用具体类型
const data: MissionData = await service.get()
```

**修复工具**：
```bash
# 使用 TypeScript 自动修复
pnpm exec tsc --noEmit --fix

# 使用 ESLint 自动修复
pnpm exec eslint --fix apps/desktop/src/**/*.test.ts
```

**预计工作量**：0.5-1 天

---

#### 2.3 API 路径错误修复（0.5 天）

**问题**：文件路径变更后未更新测试导入

**修复**：
```typescript
// 旧路径
import { service } from '../v16-mission-service'

// 新路径
import { service } from '../../main/v16/services/v16-mission-service'
```

**自动修复**：
```bash
# 使用 IDE 重构功能批量更新导入路径
# 或手动逐个文件修复
```

**预计工作量**：0.5 天

---

### 阶段 3：实现占位测试（1-2 天）

#### 3.1 L2 集成测试（0.5 天）

**目标**：测试多个模块的协作

**示例**：
```typescript
describe('L2: Mission + Decision Integration', () => {
  test('Mission creates Decision', async () => {
    const mission = await missionService.create({...})
    const decision = await decisionService.create({
      missionId: mission.id,
      ...
    })
    expect(decision.missionId).toBe(mission.id)
  })
})
```

**预计工作量**：0.5 天

---

#### 3.2 L3 端到端测试（0.5-1 天）

**目标**：测试完整的业务流

**示例**：
```typescript
describe('L3: Mission → Decision → Execution → Memory', () => {
  test('Complete business flow', async () => {
    // 1. 创建任务
    const mission = await missionService.create({...})
    
    // 2. 生成决策
    const decision = await decisionService.create({...})
    
    // 3. 执行
    const execution = await executionService.start({...})
    
    // 4. 记忆
    const memory = await memoryService.record({...})
    
    // 验证完整链路
    expect(memory.missionId).toBe(mission.id)
    expect(memory.decisionId).toBe(decision.id)
    expect(memory.executionId).toBe(execution.id)
  })
})
```

**预计工作量**：0.5-1 天

---

#### 3.3 L4 边界测试（0.5 天）

**目标**：测试错误处理和边界条件

**示例**：
```typescript
describe('L4: Edge cases', () => {
  test('Empty mission list', async () => {
    const result = await missionService.list()
    expect(result).toEqual([])
  })
  
  test('Invalid input', async () => {
    await expect(
      missionService.create({ invalid: 'data' })
    ).rejects.toThrow()
  })
  
  test('Concurrent access', async () => {
    const promises = Array(10).fill(null).map(() => 
      missionService.create({...})
    )
    const results = await Promise.all(promises)
    expect(results).toHaveLength(10)
  })
})
```

**预计工作量**：0.5 天

---

## 📋 详细测试文件清单

### V1.6 Services 测试（10 个文件）

| 文件 | 行数 | 状态 | 优先级 |
|------|------|------|--------|
| `v16-mission-service.test.ts` | 280 | 🟡 部分失败 | P1 |
| `v16-decision-service.test.ts` | 195 | 🟡 部分失败 | P1 |
| `v16-execution-service.test.ts` | 165 | 🟡 部分失败 | P1 |
| `v16-experiment-service.test.ts` | 180 | 🟡 部分失败 | P1 |
| `v16-memory-service.test.ts` | 155 | 🟡 部分失败 | P1 |
| `v16-mission-grant-service.test.ts` | 140 | 🟡 部分失败 | P1 |
| `v16-policy-runtime.test.ts` | 120 | 🟡 部分失败 | P1 |
| `v16-authority-gates.test.ts` | 135 | 🟡 部分失败 | P1 |
| `v16-store-context-guard.test.ts` | 110 | 🟡 部分失败 | P1 |
| `v16-policy-version.test.ts` | 95 | 🟡 部分失败 | P1 |

### 集成测试（5 个文件）

| 文件 | 行数 | 状态 | 优先级 |
|------|------|------|--------|
| `v16-integration.test.ts` | 200 | 🟡 部分失败 | P1 |
| `v16-store-isolation-integration.test.ts` | 180 | 🟡 部分失败 | P1 |
| `v16-context-authority-chain.test.ts` | 150 | 🟡 部分失败 | P1 |
| `verify-v16-services-contract.test.mjs` | 120 | 🟡 部分失败 | P1 |
| `verify-v16-services-contract.mjs` | 80 | 🟡 部分失败 | P1 |

### Migration 测试（2 个文件）

| 文件 | 行数 | 状态 | 优先级 |
|------|------|------|--------|
| `0014-v16-context-binding.test.ts` | 130 | 🟡 部分失败 | P1 |
| `0015-v16-policy-authority.test.ts` | 95 | 🟡 部分失败 | P1 |

### Repository 测试（2 个文件）

| 文件 | 行数 | 状态 | 优先级 |
|------|------|------|--------|
| `v16-domain-repositories.test.ts` | 160 | 🟡 部分失败 | P1 |
| `store-repo.test.ts` | 140 | 🟡 部分失败 | P1 |

### UI 测试（3 个文件）

| 文件 | 行数 | 状态 | 优先级 |
|------|------|------|--------|
| `v16-ui-components.test.tsx` | 180 | 🟡 部分失败 | P2 |
| `v16-module-navigation.test.tsx` | 150 | 🟡 部分失败 | P2 |
| `v16-module-router.test.ts` | 120 | 🟡 部分失败 | P2 |
| `v16-module-bridge.test.ts` | 100 | 🟡 部分失败 | P2 |

---

## 🛠️ 修复工具和脚本

### 工具 1：自动迁移脚本

```javascript
// scripts/fix-v16-test-ipc.mjs
import fs from 'fs'
import path from 'path'
import { glob } from 'glob'

const MIGRATION_MAP = {
  'v16MissionCreate': 'v16.mission.create',
  'v16MissionList': 'v16.mission.list',
  'v16MissionGet': 'v16.mission.get',
  'v16MissionUpdate': 'v16.mission.update',
  'v16MissionDelete': 'v16.mission.delete',
  'v16DecisionCreate': 'v16.decision.create',
  'v16DecisionList': 'v16.decision.list',
  'v16DecisionGet': 'v16.decision.get',
  'v16ExecutionStart': 'v16.execution.start',
  'v16ExecutionStop': 'v16.execution.stop',
  'v16ExecutionStatus': 'v16.execution.status',
  'v16ExperimentCreate': 'v16.experiment.create',
  'v16ExperimentList': 'v16.experiment.list',
  'v16MemoryRecord': 'v16.memory.record',
  'v16MemoryList': 'v16.memory.list',
  'v16MissionGrantIssue': 'v16.missionGrant.issue',
  'v16MissionGrantRevoke': 'v16.missionGrant.revoke',
}

async function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8')
  let modified = false
  
  for (const [oldName, newName] of Object.entries(MIGRATION_MAP)) {
    const regex = new RegExp(`\\b${oldName}\\b`, 'g')
    if (regex.test(content)) {
      content = content.replace(regex, newName)
      modified = true
    }
  }
  
  if (modified) {
    fs.writeFileSync(filePath, content)
    console.log(`✅ Fixed: ${filePath}`)
  }
}

const files = await glob('apps/desktop/src/**/*.test.{ts,tsx}')
for (const file of files) {
  await fixFile(file)
}
```

### 工具 2：测试运行器

```bash
# scripts/run-tests-by-category.sh
#!/bin/bash

echo "=== Running V1.6 Service Tests ==="
pnpm vitest run apps/desktop/src/main/v16-*-service.test.ts

echo "=== Running Integration Tests ==="
pnpm vitest run apps/desktop/src/main/v16-*integration.test.ts

echo "=== Running Migration Tests ==="
pnpm vitest run packages/local-db/src/sqlite/migrations/001[4-5]-*.test.ts

echo "=== Running Repository Tests ==="
pnpm vitest run packages/local-db/src/sqlite/repositories/v16-*.test.ts

echo "=== Running UI Tests ==="
pnpm vitest run apps/desktop/src/renderer/**/*.test.{ts,tsx}
```

### 工具 3：覆盖率报告

```bash
# scripts/check-coverage.sh
#!/bin/bash

pnpm vitest run --coverage

# 检查覆盖率阈值
if [ $(grep -oP 'All files.*?(\d+\.\d+)' coverage/coverage-summary.json | grep -oP '\d+\.\d+' | head -1) -lt 80 ]; then
  echo "❌ Coverage below 80%"
  exit 1
fi
```

---

## 📈 进度跟踪

### 每日目标

| Day | 目标 | 完成标准 |
|-----|------|---------|
| Day 1 | 分类 + 自动迁移 | 200 个 IPC 错误修复 |
| Day 2 | IPC 修复完成 | 275 个 Legacy 测试通过 |
| Day 3 | 类型修复 | 类型错误清零 |
| Day 4 | API 路径修复 | 路径错误清零 |
| Day 5 | L2/L3 测试 | 67 个占位测试完成 |
| Day 6 | 边界测试 | 边界用例覆盖 |
| Day 7 | 验证 + 报告 | 覆盖率 ≥ 95% |

### 检查点

- [ ] Day 1 结束：IPC 错误 < 50
- [ ] Day 2 结束：Legacy 测试全部通过
- [ ] Day 3 结束：类型错误清零
- [ ] Day 4 结束：路径错误清零
- [ ] Day 5 结束：占位测试全部完成
- [ ] Day 6 结束：边界用例完成
- [ ] Day 7 结束：覆盖率 ≥ 95%

---

## ✅ 验收标准

### 必须达成

1. **测试通过率**：95%+
2. **代码覆盖率**：80%+
3. **零 IPC 错误**
4. **零类型错误**
5. **零占位测试**

### 推荐达成

1. **测试通过率**：99%+
2. **代码覆盖率**：90%+
3. **关键路径 100% 覆盖**
4. **边界用例 100% 覆盖**

---

## 💡 最佳实践

### 1. 测试隔离
```typescript
beforeEach(() => {
  // 重置状态
  db.reset()
  services.clear()
})
```

### 2. 测试数据
```typescript
// 使用工厂函数
const mockMission = (overrides = {}) => ({
  id: 'test-id',
  name: 'Test Mission',
  ...overrides,
})
```

### 3. 异步测试
```typescript
test('async operation', async () => {
  const result = await service.create(input)
  expect(result).toBeDefined()
})
```

### 4. 错误测试
```typescript
test('error handling', async () => {
  await expect(service.create(badInput)).rejects.toThrow(ValidationError)
})
```

---

## 🎯 总结

### 工作量

- **总耗时**：5-7 天
- **修复测试**：342 个
- **新增测试**：约 50 个（边界用例）
- **总测试数**：约 350 个

### 收益

- ✅ 测试覆盖率：70% → 95%+
- ✅ 代码质量：显著提升
- ✅ 回归保护：增强
- ✅ 开发信心：提升

### 风险

- ⚠️ 修复可能引入新 bug（需要仔细验证）
- ⚠️ 时间可能超期（建议预留缓冲）

---

**计划版本**：1.0  
**创建日期**：2026-09-07  
**预计开始**：2026-09-08  
**预计完成**：2026-09-14
