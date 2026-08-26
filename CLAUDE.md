# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Amazon AI Ops Agent is a Windows-first, local Electron desktop app for Amazon operations. It connects Lingxing ad report collection, local report import, product-level ad quantification, keyword and Listing optimization, AI/rule-based recommendations, manual approval, Ads UI readback, and final delivery evidence into an auditable local workflow.

The app is currently a v1.5.1 source candidate in `APP_NEEDS_WORK` (`INTERNAL NON_READY`). The latest recorded business state has real 8/8 collection/import (`8 files / 1937 metrics / 8 reconciliations`), an enabled policy, an active Mission, and a draft experiment. UNKNOWN execution now has a Main-owned two-observation read-only reconciliation path, and causal memory has real current-store index rebuild/search and JSON export. Source unit evidence is 285/285 files and 3529/3529 tests; v1.5.1 has not yet been typechecked, built, smoke-tested, package-UI tested, ZIP-launched, or Ads-readback tested. The verified v1.5.0 package is historical and gives no v1.5.1 release credit. Ads execution remains fail-closed and still requires stable current object authority, a concrete current `lower_bid`, product-local human approval, distinct evidence, execution, reload/readback, and verifier proof.

## Common commands

Install dependencies:

```bash
pnpm install
```

Run the desktop app in development mode:

```bash
pnpm dev
```

Type-check everything that exposes a `typecheck` script:

```bash
pnpm run typecheck
```

Type-check only the Electron desktop app:

```bash
pnpm --filter @amazon-ai-ops/desktop run typecheck
```

Build only the renderer:

```bash
pnpm --filter @amazon-ai-ops/desktop run build:renderer
```

Build the Windows installer and portable EXE:

```bash
pnpm --filter @amazon-ai-ops/desktop run build:win
```

Run all Vitest tests:

```bash
pnpm test
```

Run one test file:

```bash
pnpm vitest run apps/desktop/src/main/recommendation-execution-policy.test.ts
```

Run a targeted package test suite, when the package has its own `test` script:

```bash
pnpm --filter @amazon-ai-ops/lingxing-report-collector test
pnpm --filter @amazon-ai-ops/report-parser test
```

Current business UI and delivery checks:

```bash
pnpm run smoke:business-ui-current
pnpm run smoke:package-launch
pnpm run verify:ad-execution
pnpm run verify:ad-readback -- <evidence.json>
pnpm run write:v15-evidence-manifest -- ...
pnpm run verify:v15-final-readiness -- ...
pnpm run export:v15-delivery-bundle -- ...
pnpm run verify:v15-ready-safety -- ...
```

Production delivery order is fixed by the README/user guide:

```bash
pnpm --filter @amazon-ai-ops/desktop run build:win
pnpm run smoke:package-launch
pnpm run verify:v15-final-readiness -- ...
# Update the README top DELIVERY line to the current evidence's `APP_READY` state.
pnpm run export:v15-delivery-bundle -- ...
pnpm run verify:v15-ready-safety -- ...
```

If Windows packaging runs out of space on the C: temp directory, set `TEMP` and `TMP` to a D: drive folder before `build:win`.

## Repository structure

This is a pnpm workspace:

- `apps/desktop/` is the Electron app.
- `packages/*` are local workspace packages consumed by the desktop main process.
- `scripts/` contains verification, smoke, evidence, delivery, and readback helper scripts.
- `resources/` contains bundled prompts, field mappings, page models, and default rules.
- `docs/` contains current product, acceptance, runbook, design parity, and progress documentation.
- `amazon-ai-ops-business-prototype/` is the visual/business prototype reference used for UI parity.

Do not commit local/runtime delivery artifacts listed in the README: `output/`, `storage/`, `apps/desktop/release/`, AppData DB/profile data, raw Lingxing reports, release EXEs, or credentials.

## Desktop architecture

The runtime is a local-first Electron app, not a client/server web app:

- `apps/desktop/src/main/index.ts` owns app initialization, storage paths under Electron `userData`, SQLite initialization, repository creation, scheduler setup, Playwright browser control, Lingxing report collection/import, recommendation generation, readback evidence, delivery evidence, and IPC handler registration.
- `apps/desktop/src/preload/index.ts` exposes a constrained `window.electronAPI` bridge. Renderer pages should call this bridge rather than importing Electron APIs directly.
- `apps/desktop/src/renderer/App.tsx` owns login gating, Zustand app state, top shell, route switching, `ScopeBar`, and mapping `AppRoute` values to business pages.
- `apps/desktop/src/renderer/types.ts` defines renderer-facing route and business view models for scope, reports, quantification, AI evidence, recommendations, readback, Listing, and delivery readiness.
- `apps/desktop/src/renderer/pages/` contains the business pages. The current shell flow is `Sidebar -> topbar -> ScopeBar -> PageHeader/OperatorTaskPanel/KPI -> page content`.

The main process currently registers IPC handlers in one large module. When adding renderer functionality, update all three layers consistently: the main handler, the preload bridge method, and the renderer view/types/tests that consume it.

## Workspace package responsibilities

The main process composes the local packages rather than duplicating their domain logic:

- `@amazon-ai-ops/browser-worker`: Playwright/browser control for Lingxing/Ads UI sessions.
- `@amazon-ai-ops/lingxing-report-collector`: Lingxing download center automation, page model diagnostics, preflight, batch manifests, and report verification.
- `@amazon-ai-ops/report-parser`: XLSX/CSV parsing and diagnostics for ad reports, keyword metrics, and Listing content.
- `@amazon-ai-ops/local-db`: SQLite initialization and repositories for settings, products, ad metrics, recommendations, operation events, report files, AI call logs, and diagnosis runs.
- `@amazon-ai-ops/rules-engine`: ad quantification, rule configuration, recommendation generation, risk evaluation, and AI/rule decision merging.
- `@amazon-ai-ops/ai-adapter`: OpenAI-compatible provider integration plus ad strategy diagnosis, action explanation, daily report, evidence sufficiency, and Listing draft AI helpers.
- `@amazon-ai-ops/action-executor`: ad action execution and verifier types/logic; keep real execution behind approval/readback safety gates.
- `@amazon-ai-ops/audit-log`: audit logging, screenshots, traces, and cleanup.
- `@amazon-ai-ops/scheduler`: local scheduled tasks for recommendation/report generation and cleanup.
- `@amazon-ai-ops/keyword-opportunity`: keyword opportunity derivation from imported metrics.
- `@amazon-ai-ops/listing-analyzer`: keyword coverage, safe Listing suggestions, rule-based/AI draft export helpers.
- `@amazon-ai-ops/shared-types`: cross-package domain types.

## Product and safety boundaries

Important product invariants from the README:

- Report collection/import must use real Lingxing ad reports. Screenshots, audit files, and page archives do not substitute for raw reports.
- `campaign`, `ad_group`, `placement`, `advertised_product`, and `user_search_term` are different grains and must not be blindly summed together.
- Product config fields such as cost, FBA fee, current price, minimum acceptable price, target ACOS/TACOS, and target net margin stay local and do not approve or execute ad actions.
- Listing drafts are local versions only and are not automatically submitted to Amazon or Lingxing.
- Credentials and AI keys are handled by local secure storage; do not expose plaintext in UI, logs, docs, tests, or commits.

## UI and design notes

The current UI is aligned to `amazon-ai-ops-business-prototype/pages/*.html` and the parity docs under `docs/design/`. The renderer intentionally uses a light Windows desktop theme and local/system fonts; do not introduce Google Fonts or a dark-mode toggle unless the product direction changes.

The 17 business routes are defined by `AppRoute` in `apps/desktop/src/renderer/types.ts` and rendered in `BusinessRoutePage` in `apps/desktop/src/renderer/App.tsx`. Navigation can also be requested through the `amazon-ai-ops:navigate` browser event.

## Documentation to check before large changes

- `README.md`: current state, delivery commands, commit boundaries, and product boundaries.
- `docs/amazon_ai_ops_desktop_prd_arch_dev_spec_v1_5_no_external.md`: v1.5 PRD/architecture/development specification.
- `docs/V1_5_ACCEPTANCE_MATRIX.md`: acceptance expectations.
- `docs/V1_5_PROGRESS_REPORT.md`: detailed progress and evidence history.
- `docs/USER_GUIDE_v1_5.md`: user-facing workflow and delivery order.
- `docs/REAL_AD_READBACK_RUNBOOK.md`: real Ads UI manual execution/readback process.
- `docs/design/prototype-reference-index.md` and `docs/design/prototype-parity-checklist.md`: prototype parity references.

No repository-level `.cursor/rules`, `.cursorrules`, or `.github/copilot-instructions.md` files were present when this file was created.
