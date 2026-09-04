# V1.6.0 Quick Reference

> **快速参考：** V1.6.0 Phase 1 验证状态和常用命令

---

## 当前状态

```
Version:    1.6.0
Phase:      Phase 1 Complete ✅
Status:     APP_NEEDS_WORK / INTERNAL NON_READY
Gates:      4/8 passed (50%)
Tests:      162/162 passed (100%)
Coverage:   11/29 requirements traced (37.9%)
Updated:    2026-09-02
```

---

## 快速验证

```bash
# 运行完整验证链（推荐）
pnpm run verify:v16-full

# 查看就绪度报告
cat output/v16-evidence/v16_l8_readiness.json | jq .

# 查看追溯覆盖
cat output/v16-evidence/v16_trace_closure_verification.json | jq .
```

**预期输出：**
- ✅ 必需测试清单: 7/7 套件通过
- ⚠️ 需求追溯闭环: 11/29 需求已追溯 (37.9%)
- ⚠️ L8 就绪度聚合: 4/8 门禁通过

---

## 测试层状态

| Layer | Status | Tests | Evidence File |
|-------|--------|-------|---------------|
| L1 Domain | ✅ | 95/95 | 4 files |
| L2 Coordination | ✅ | 12/12 | 1 file |
| L3 Workflow | ✅ | 23/23 | 1 file |
| L4 UI Contract | ✅ | 32/32 | 1 file |
| L5 Smoke | ❌ | - | User prohibited |
| L6 Package | ❌ | - | Build prohibited |
| L7 Launch | ❌ | - | Depends on L6 |
| L8 Real Ads | ❌ | - | Manual workflow |

---

## 需求覆盖

### ✅ Complete (11/29)
- Core Domain: 6/6 ✅
- User Interface: 2/2 ✅
- Data Pipeline: 2/5 ⚠️
- Type System: 1/2 ⚠️

### ❌ Missing (18/29)
- **P0 Critical:** 12 requirements
  - Operating Mode (2)
  - Execution Safety (2)
  - Analysis Domain (2)
  - Engineering Quality (3)
  - Decision Engine (1)
  - Type System (1)
  - Delivery Quality (1)

- **P1 Secondary:** 6 requirements
  - Data Pipeline (3)
  - AI Integration (3)

---

## Phase 2 目标

**工作量：** 14-20 sessions (~2-3 weeks)

**关键交付：**
1. 实现核心服务 (Mission, Policy, Experiment, AnalysisRun)
2. 补齐 12 个 P0 需求测试
3. 扩展数据库和 IPC 层
4. 达到 80% 需求覆盖

**成功标准：**
- [ ] 23/29 P0 requirements traced (100%)
- [ ] Core services implemented
- [ ] Database and IPC extended
- [ ] Requirements coverage ≥ 80%

---

## 文档索引

| 文档 | 描述 | 位置 |
|------|------|------|
| 📊 进度报告 | 详细进度跟踪 | `docs/V1_6_PROGRESS_REPORT.md` |
| ✅ 验收矩阵 | 验收标准与签核 | `docs/V1_6_ACCEPTANCE_MATRIX.md` |
| 🎯 Phase 1 完成报告 | Phase 1 详细总结 | `docs/V1_6_PHASE_1_COMPLETION.md` |
| 📋 验证状态 | 当前验证快照 | `docs/V1_6_VERIFICATION_STATUS.md` |
| 🎉 交付总结 | Phase 1 交付摘要 | `output/V1_6_PHASE_1_DELIVERY_SUMMARY.md` |
| 📖 需求索引 | 29 个需求目录 | `docs/v16_requirements_index.json` |

---

## 证据位置

```
output/v16-evidence/
├── v16_t_l1_*.json                              (4 L1 evidence files)
├── v16_t_l2_cross_domain.json                   (12 tests)
├── v16_t_l3_workflow.json                       (23 tests)
├── v16_t_l4_ui_contract.json                    (32 tests)
├── v16_required_test_manifest.json              (test manifest)
├── v16_required_test_manifest.verification.json (verifier result)
├── v16_trace_closure_verification.json          (trace result)
├── v16_l8_readiness.json                        (readiness report)
└── v16_l8_readiness.verification.json           (readiness verifier)
```

---

## 常见命令

### 测试执行
```bash
pnpm test                                    # 全部测试
pnpm test -- --coverage                      # 带覆盖率
pnpm vitest run apps/desktop/src/main/v16-* # 仅 V1.6 新测试
```

### 验证执行
```bash
pnpm run verify:v16-full                     # 完整验证链
pnpm run verify:v16-required-tests           # 测试清单验证
pnpm run verify:v16-trace-closure            # 追溯闭环验证
pnpm run verify:v16-readiness                # L8 就绪度聚合
```

### 证据查看
```bash
# 查看就绪度
jq . output/v16-evidence/v16_l8_readiness.json

# 查看追溯覆盖
jq '.byCategory' output/v16-evidence/v16_trace_closure_verification.json

# 查看测试清单
jq '.results[] | select(.status=="complete")' output/v16-evidence/v16_required_test_manifest.json

# 查看缺失需求
jq '.missingRequirements[] | select(.priority=="P0")' output/v16-evidence/v16_trace_closure_verification.json
```

---

## 历史对比

| Metric | V1.5.1 | V1.6.0 Phase 1 | Δ |
|--------|--------|----------------|---|
| Authority Tests | 157 | 162 | +5 |
| Integration Tests | 0 | 67 | +67 |
| Gates Passed | 7/8 | 4/8 | -3* |
| Requirements Traced | N/A | 11/29 | NEW |
| Evidence Files | 0 | 12 | +12 |

*同样的用户禁令阻断 L5-L8

---

## 下一步

1. ✅ **Phase 1 完成** - 证据基础设施已建立
2. 🔄 **进入 Phase 2** - 实现核心架构和 P0 测试
3. 📋 **目标** - 80% 需求覆盖，核心服务就绪

**建议行动：**
- 继续实现 MissionDomainService, PolicyService, ExperimentService
- 补齐 Operating Mode 和 Execution Safety 测试
- 扩展数据库 Schema 和 IPC 层

---

**生成时间：** 2026-09-02T08:55:00Z  
**Schema Version:** v16.evidence/0.1  
**Verification:** `pnpm run verify:v16-full`
