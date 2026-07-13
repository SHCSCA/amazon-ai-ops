# Task 3 Report: Explicit, Scenario-Consistent Development Preview

## Outcome

Implemented an explicit development-only browser preview contract for Task 3.

- Preview bootstrap now requires all of: a Vite development build, a local host (`localhost` or `127.0.0.1`), and `preview=1`.
- A production renderer on localhost does not install the preview Electron API, even when the preview query is present.
- The default explicit preview scenario is `diagnosis-ready`.
- Invalid scenario ids fall back deterministically to `diagnosis-ready` and render a visible warning in the top bar.
- The top bar labels all enabled scenarios as `仅开发预览`, including `delivery-ready`.
- `delivery-ready` is an in-memory preview fixture only. It always reports `appReady: false`, `manifestDriven: false`, and `previewOnly: true`; it exposes no readback/final-readiness evidence-writing API.

## Scenario registry

The typed registry contains exactly:

1. `missing-scope`
2. `missing-reports`
3. `pending-import`
4. `diagnosis-ready`
5. `mixed-recommendations`
6. `missing-readback-evidence`
7. `delivery-ready`

All preview API surfaces derive from the selected registry contract. Pre-diagnosis scenarios expose no imported totals, product metric history, diagnostics, recommendations, or keyword opportunities. Mixed/approved recommendations honor the same `status` filter used by approval, readback, and delivery pages. Readback and delivery state cannot become ready before their preceding scenario gates.

## Browser smoke URL contract

Existing browser smoke scripts now opt in explicitly and name a scenario:

- Shell, data pipeline, keyword/listing, and listing-draft smoke: `diagnosis-ready`
- Ad execution smoke: `mixed-recommendations`
- Settings/delivery and legacy product-readiness smoke: `delivery-ready`

The smoke scripts continue to inject their own isolated API fixtures; explicit query selection documents and enforces the preview URL contract without connecting real persistence or Ads surfaces.

## TDD evidence

Initial RED:

- Command: `pnpm exec vitest run apps/desktop/src/renderer/dev-preview-api.test.ts scripts/browser-preview-smoke-contract.test.mjs`
- Result: 2 failed files, 15 failed tests.
- Expected causes: resolver/registry/bootstrap exports did not exist, App still enabled preview from localhost alone, and seven browser smoke URLs lacked explicit opt-in.

Production DEV wiring RED:

- Command: `pnpm exec vitest run apps/desktop/src/renderer/dev-preview-api.test.ts`
- Result: 1 failed test because App did not yet use the static `import.meta.env.DEV` production boundary.

Cross-surface consistency RED:

- Command: `pnpm exec vitest run apps/desktop/src/renderer/dev-preview-api.test.ts`
- Result: 2 failed tests because pre-diagnosis fixtures retained non-zero metric totals and recommendation responses ignored page status filters.

Minimal GREEN changes were applied after each observed failure.

## Final verification

- `pnpm exec vitest run apps/desktop/src/renderer/dev-preview-api.test.ts scripts/browser-preview-smoke-contract.test.mjs`
  - 2 files passed; 18 tests passed.
- `pnpm --filter @amazon-ai-ops/desktop run typecheck`
  - Passed (`tsc --noEmit`).
- `pnpm --filter @amazon-ai-ops/desktop run build:renderer`
  - Passed; 90 modules transformed.
  - Existing non-failing warnings remain for Vite's deprecated CJS Node API and a renderer chunk larger than 500 kB.
- `pnpm exec vitest run`
  - 130 files passed; 1103 tests passed; 2 skipped.
- `git diff --check`
  - Passed before commit.

## Scope and risk

- No main-process, preload, database, real report ingestion, approval persistence, Ads execution, APP_READY artifact, delivery bundle, or EXE packaging code was changed.
- No preview evidence-writing methods were added.
- Preview fixtures remain bundled with the renderer module but are unreachable unless the static development flag, local host, and explicit URL opt-in all pass.
- Browser smoke executables were not run because they generate local screenshot/evidence files; their URL contract is covered by the focused source contract test, and the renderer plus full suite were run.
