# Amazon AI Ops Prototype Parity Checklist

> Updated: 2026-07-03
> Prototype source: `amazon-ai-ops-business-prototype/pages/*.html`
> Production renderer: `apps/desktop/src/renderer/`

This checklist tracks the Windows desktop UI parity pass against the business prototype. It is scoped to the production light theme only. Dark theme variables in the prototype remain reference material and are not part of the current executable.

## Global Contract

| Area | Required production contract | Status |
|---|---|---|
| Shell | Five business navigation groups, compact left rail, route busy feedback, no marketing landing page | High-fidelity first-screen parity |
| ScopeBar | Low-noise current range bar for date, store, site, currency, batch, ASIN | High-fidelity first-screen parity |
| PageHeader | Short `h1`, compact description, current task and next action rail | High-fidelity first-screen parity |
| KPI rows | All 16 business renderer pages use shared `KpiCard` rows near the first-screen task area | High-fidelity first-screen parity |
| Design tokens | Production uses local/system font stack, light tokens, 6-8px panels, compact spacing | Verified |
| Remote assets | No Google Fonts or remote font dependency in production renderer | Verified |
| Theme scope | No `.dark` or dark color-scheme promise in production renderer | Verified |
| Product fields | Product inputs use explicit labels for cost, FBA, current price, minimum acceptable price, target ACOS/TACOS, margin | Verified |
| Half-built shared components | Prototype-only `AiModuleCard`, `EmptyState`, `ContentCard`, `SectionHeader` stubs are removed until actually wired | Verified |

## Page Checklist

| # | Page | Prototype file | Renderer file | Core parity surface | Status |
|---|---|---|---|---|---|
| 1 | 登录与会话确认 | `pages/login.html` | `App.tsx` | trusted login gate, credential status, busy submit | Partial parity |
| 2 | 今日看板 | `pages/dashboard.html` | `pages/dashboard-page.tsx` | KPI, data health, product lock blockers, next actions | High-fidelity first-screen parity |
| 3 | 产品管理 | `pages/product-management.html` | `pages/product-management-page.tsx` | product cards, product details, explicit product fields, daily data | High-fidelity first-screen parity |
| 4 | 工作范围 | `pages/operation-scope.html` | `pages/operation-scope-page.tsx` | field grid, scope confirmation, downstream impact | High-fidelity first-screen parity |
| 5 | 批量数据采集 | `pages/data-collection.html` | `pages/data-collection-page.tsx` | 8-report selector, progress, explicit action feedback | High-fidelity first-screen parity |
| 6 | 指标核验入库 | `pages/data-import-validation.html` | `pages/data-import-validation-page.tsx` | real report directory, import snapshot, 8-report table | High-fidelity first-screen parity |
| 7 | 运营事件标记 | `pages/operation-events.html` | `pages/operation-events-page.tsx` | event form, timeline, AI context readback | High-fidelity first-screen parity |
| 8 | 产品 ACOS 配置 | `pages/product-config.html` | `pages/product-config-page.tsx` | bulk toolbar, inline ACOS edit, health column | High-fidelity first-screen parity |
| 9 | 量化诊断中心 | `pages/ad-quant.html` | `pages/ad-quant-page.tsx` | total metrics, product dimension, daily data blocker, AI feedback | High-fidelity first-screen parity |
| 10 | 优化建议草案 | `pages/recommendations.html` | `pages/recommendations-page.tsx` | status buckets, evidence blockers, batch handoff | High-fidelity first-screen parity |
| 11 | 审批历史中心 | `pages/approval.html` | `pages/approval-page.tsx` | tabs, three-state decision strip, stamp, queue feedback | High-fidelity first-screen parity |
| 12 | 渐进执行回读 | `pages/readback.html` | `pages/readback-page.tsx` | four-step wizard, screenshot evidence, safety gates | High-fidelity first-screen parity |
| 13 | 关键词机会矩阵 | `pages/keyword-opportunities.html` | `pages/keyword-opportunities-page.tsx` | virtual table, sticky ASIN, sortable headers, filters | High-fidelity first-screen parity |
| 14 | Listing 结构重写 | `pages/listing-optimization.html` | `pages/listing-optimization-page.tsx` | heatmap, draft diff, character limits, local preview | High-fidelity first-screen parity |
| 15 | 本地定时调度 | `pages/scheduler.html` | `pages/scheduler-page.tsx` | local task state, cron rows, run history, no Ads writes | High-fidelity first-screen parity |
| 16 | AI 适配与诊断 | `pages/settings.html` | `pages/settings-page.tsx` | AI contract tags, schema-oriented settings, logs, safety policy | High-fidelity first-screen parity |
| 17 | 最终验收就绪门 | `pages/delivery.html` | `pages/delivery-page.tsx` | READY gates, evidence package, readback repair handoff | High-fidelity first-screen parity |

## Required Checks

```powershell
pnpm exec vitest run apps/desktop/src/renderer/page-header-copy.test.ts apps/desktop/src/renderer/design-system-integration.test.ts
pnpm --filter @amazon-ai-ops/desktop run typecheck
pnpm --filter @amazon-ai-ops/desktop run build:renderer
pnpm run smoke:business-ui-current
pnpm --filter @amazon-ai-ops/desktop run build:win
pnpm run smoke:package-launch
```

Final release still requires manifest-driven final readiness, READY bundle export, READY safety, and refreshed EXE hashes in `README.md`.
