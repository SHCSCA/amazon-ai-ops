# Amazon AI Ops Prototype Parity Checklist

> Historical prototype-parity record. It remains a design reference only; current source/package readiness is governed by `PROGRESS.md`, `BLOCKED.md`, and `docs/OPERATOR_CORE_FLOW_REPAIR_2026-08-07.md`.

> Updated: 2026-07-03
> Prototype source: `amazon-ai-ops-business-prototype/pages/*.html`
> Production renderer: `apps/desktop/src/renderer/`

This checklist tracks the Windows desktop UI parity pass against the business prototype. It is scoped to the production light theme only. Dark theme variables in the prototype remain reference material and are not part of the current executable.

## Global Contract

| Area | Required production contract | Status |
|---|---|---|
| Shell | Five short prototype navigation groups (`总览` / `数据` / `广告` / `增长` / `系统`), compact left rail, route busy feedback, no marketing landing page | High-fidelity integration in progress |
| ScopeBar | Low-noise current work context bar for product, real reports, imported metrics, trace batch, date, store, site, currency, ASIN | High-fidelity integration in progress |
| PageHeader | Short prototype `h1`, compact description, optional primary action | High-fidelity integration in progress |
| KPI rows | Primary pages use compact shared `KpiCard`/status rows near the first-screen task area; read-only status cards keep quiet non-moving hover feedback while active/safety controls stay visually stronger | Verified |
| Design tokens | Production uses local/system font stack, light tokens, 6-8px panels, compact spacing; login and shared status surfaces use the same light token set | Verified |
| Remote assets | No Google Fonts or remote font dependency in production renderer | Verified |
| Theme scope | No `.dark` or dark color-scheme promise in production renderer | Verified |
| Product fields | Product inputs use explicit labels for cost, FBA, current price, minimum acceptable price, target ACOS/TACOS, margin | Verified |
| Half-built shared components | Prototype-only `AiModuleCard`, `EmptyState`, `ContentCard`, `SectionHeader` stubs are removed until actually wired | Verified |

## Page Checklist

| # | Page | Prototype file | Renderer file | Core parity surface | Status |
|---|---|---|---|---|---|
| 1 | 登录与会话确认 | `pages/login.html` | `App.tsx` | trusted login gate, credential status, busy submit | Partial parity |
| 2 | 今日看板 | `pages/dashboard.html` | `pages/dashboard-page.tsx` | prototype KPI strip, status grid, risk table, product workbench supplement, readiness-driven next safe action | High-fidelity integration in progress |
| 3 | 产品管理 | `pages/product-management.html` | `pages/product-management-page.tsx` | product table, product details, explicit product fields, daily data | High-fidelity integration in progress |
| 4 | 工作范围 | `pages/operation-scope.html` | `pages/operation-scope-page.tsx` | current work context, field grid, scope confirmation, downstream impact | Partial parity, needs visual recheck |
| 5 | 数据采集 | `pages/data-collection.html` | `pages/data-collection-page.tsx` | 8-report selector, real-report-first progress, evidence-file exclusion, explicit action feedback | High-fidelity integration in progress |
| 6 | 导入校验 | `pages/data-import-validation.html` | `pages/data-import-validation-page.tsx` | real report directory, SQLite import snapshot, 8-report table, evidence-not-data distinction | Partial parity, needs visual recheck |
| 7 | 运营事件 | `pages/operation-events.html` | `pages/operation-events-page.tsx` | event form, timeline, AI context readback | Partial parity, needs visual recheck |
| 8 | 成本目标 | `pages/product-config.html` | `pages/product-config-page.tsx` | bulk toolbar, inline ACOS edit, health column | Partial parity, needs visual recheck |
| 9 | 广告表现 | `pages/ad-quant.html` | `pages/ad-quant-page.tsx` | total metrics, product dimension, daily data blocker, AI feedback | Partial parity, needs visual recheck |
| 10 | 优化建议 | `pages/recommendations.html` | `pages/recommendations-page.tsx` | user-task action table for recommended action, target, current -> proposed value, reason metrics, evidence state, risk, and send-to-approval judgment; AI/rule internals remain behind details | High-fidelity integration in progress |
| 11 | 审批中心 | `pages/approval.html` | `pages/approval-page.tsx` | approve / reject / review-requirement decision surface, stamp, queue feedback, fail-closed missing-evidence guard | High-fidelity integration in progress |
| 12 | 结果核对 | `pages/readback.html` | `pages/readback-page.tsx` | approved-action wizard, approval proof, before/after manual evidence, refreshed readback value, export gate | High-fidelity integration in progress |
| 13 | 关键词机会 | `pages/keyword-opportunities.html` | `pages/keyword-opportunities-page.tsx` | deduplicated opportunity rows with ASIN/campaign/ad group/search term context, evidence state, Listing handoff, sortable/filterable virtual table | High-fidelity integration in progress |
| 14 | Listing草案 | `pages/listing-optimization.html` | `pages/listing-optimization-page.tsx` | local-only draft workflow, keyword heatmap, draft diff, character limits, local preview/export, no Amazon/Lingxing submission | High-fidelity integration in progress |
| 15 | 自动任务 | `pages/scheduler.html` | `pages/scheduler-page.tsx` | local task state, cron rows, run history, no Ads writes | Partial parity, needs visual recheck |
| 16 | AI与规则 | `pages/settings.html` | `pages/settings-page.tsx` | AI service connection and safe rule thresholds first; logs, paths, and support checks folded into details | High-fidelity integration in progress |
| 17 | 交付验收 | `pages/delivery.html` | `pages/delivery-page.tsx` | can-deliver judgment, blockers, user-readable package location, copyable summary, secondary hashes/manifests/matrices | High-fidelity integration in progress |

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
