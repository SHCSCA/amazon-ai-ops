# Amazon AI Ops Frontend Experience And Production Trust Reframe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current 16-route Electron interface into eight task-oriented operator workspaces while restoring a single fail-closed production-readiness chain and delivering a verified Windows package.

**Architecture:** Preserve existing business functions and IPC boundaries. Add a workspace navigation compatibility layer and one workflow-state selector, then migrate pages onto shared task-first layout primitives. Desktop and CLI readiness must consume one evaluator that requires the current package-launch smoke and matching package hash.

**Tech Stack:** Electron 28, React 18, TypeScript, Zustand, Vite, Vitest, TanStack Virtual, electron-builder.

## Global Constraints

- Windows desktop only; light theme only; do not add mobile or dark-theme scope.
- Preserve all current user changes and local evidence; never commit output, release binaries, runtime databases, raw reports, profiles, or secrets.
- Keep real-report, approval, screenshot, readback, Listing-local-only, and Amazon Ads fail-closed boundaries unchanged.
- One visible primary action per workspace first screen; no more than two visible secondary actions.
- Main business copy must be Chinese operator language; raw action codes, batch ids, JSON, commands, hashes, and verifier terms stay in secondary technical detail surfaces.
- Verify at 1200x700, 1400x900, and Windows 125% scaling; the main workspace and primary tables must not create page-level horizontal scrolling.
- Current packaged APP_READY evidence remains the previous verified package until a new Windows package, package smoke, final readiness, READY bundle, docs, and READY safety all match.

---

### Task 1: Stabilize The Test And Native-Dependency Baseline

**Files:**
- Modify: root and desktop `package.json` scripts
- Modify: current renderer contract tests and `docs/USER_GUIDE_v1_5.md`
- Test: local-db smoke plus package-script and renderer contract tests

**Interfaces:**
- Produces an explicit Node-native preparation command for Vitest and an Electron-native preparation command for Windows packaging.
- Keeps the approved table-first UI; stale source-string assertions must follow semantic markers instead of restoring removed card/form walls.

- [ ] Use the current ABI and contract failures as RED evidence and add package-script assertions for both native preparation commands.
- [ ] Implement Node preparation with the local-db workspace rebuild and Electron preparation with `electron-builder install-app-deps`.
- [ ] Wire the Node preparation before the root test suite and the Electron preparation before package construction.
- [ ] Update the recommendation, data-collection, and release-order contracts to the approved current behavior.
- [ ] Run the six SQLite test files, renderer contract tests, package-script tests, and then the full suite.

### Task 2: Restore The Authoritative Verification Chain

**Files:**
- Modify: readiness evaluator and desktop refresh callers under `apps/desktop/src/main/`
- Modify: final-readiness and ad-execution verifiers under `scripts/`
- Test: matching readiness/verifier tests under `scripts/` and `apps/desktop/src/main/`

**Interfaces:**
- Produces one shared readiness result containing gate ids, failures, package-smoke evidence, and current package hash.
- Makes stale smoke, missing smoke, or hash mismatch fail closed in both desktop and CLI paths.

- [ ] Add failing tests for missing package smoke, stale smoke, and package hash mismatch.
- [ ] Run focused tests and confirm the expected readiness failures.
- [ ] Extract or extend the shared evaluator and route desktop/CLI callers through it.
- [ ] Replace brittle ad-execution copy matching with stable semantic/structural checks and a failing regression test.
- [ ] Run focused tests, typecheck, and verifier commands.

### Task 3: Make Development Preview Explicit And Internally Consistent

**Files:**
- Modify: `apps/desktop/src/renderer/dev-preview-api.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Test: renderer preview and business-state tests

**Interfaces:**
- Produces an explicit development-only preview bootstrap and named scenarios for missing scope, missing reports, pending import, diagnosis-ready, mixed recommendations, missing readback evidence, and delivery-ready.
- Production builds must not enable preview behavior solely because the hostname is localhost.

- [ ] Add failing tests for production preview rejection and cross-surface scenario consistency.
- [ ] Run tests and confirm failures are caused by the current implicit preview bootstrap or contradictory scenario state.
- [ ] Implement explicit preview enablement and a typed scenario registry.
- [ ] Run focused renderer tests, typecheck, and renderer build.

### Task 4: Introduce Eight Workspaces And A Single Next-Safe-Action Model

**Files:**
- Create: `apps/desktop/src/renderer/navigation.ts`
- Create: `apps/desktop/src/renderer/workflow-state.ts`
- Modify: `apps/desktop/src/renderer/App.tsx` and shell navigation
- Test: navigation compatibility and workflow-state tests

**Interfaces:**
- Produces `PrimaryWorkspace`, `WorkspaceSubview`, `NavigationIntent`, `WorkflowStage`, and `NextSafeAction`.
- Maps every legacy `AppRoute` to one of: today, product, data-preparation, diagnosis, decisions, readback, growth, system.

- [ ] Add failing tests for all legacy route mappings and evidence-driven next-safe-action decisions.
- [ ] Implement the types, compatibility map, and pure workflow selector.
- [ ] Replace visible 16-route navigation with seven daily workspaces plus one system entry while retaining legacy deep-link inputs.
- [ ] Run navigation, shell, accessibility, typecheck, and renderer-build verification.

### Task 5: Establish The Shared Task-First Visual System

**Files:**
- Split shared styles under `apps/desktop/src/renderer/styles/`
- Modify shared UI components under `apps/desktop/src/renderer/components/`
- Test: design-system integration and viewport-contract tests

**Interfaces:**
- Produces `PageFrame`, `TaskBanner`, `SummaryStrip`, `WorkbenchPanel`, `PriorityDataTable`, `ActionMenu`, and unified empty/blocked/error surfaces.

- [ ] Add failing contract tests for minimum 12px visible text, one primary action, one scroll owner, non-nested disclosures, and no page-level horizontal overflow.
- [ ] Introduce tokens for typography, spacing, contrast, controls, motion, and state language.
- [ ] Implement the shared page frame and priority-table column behavior.
- [ ] Migrate the shell, Today, Decisions, and Readback reference workspaces first.
- [ ] Capture and inspect both required viewports plus 125% scaling before continuing.

### Task 6: Migrate The Remaining Operator Workspaces

**Files:**
- Modify renderer pages for product, data preparation, diagnosis, growth, and system/hand-off.
- Test: page-specific behavior plus shared workspace-state scenarios.

**Interfaces:**
- Product views: products, targets, events.
- Data views: scope, reports, import-check.
- Decision views: recommendations, approval, decided.
- Growth views: keyword opportunities, current Listing, local draft/export.
- System views: AI settings, scheduler, delivery status.

- [ ] Migrate Product and Data Preparation while keeping existing save/import IPC contracts.
- [ ] Migrate Diagnosis and Growth while preserving metric evidence and Listing-local-only boundaries.
- [ ] Migrate System And Delivery while keeping technical evidence available only in secondary surfaces.
- [ ] Remove duplicate visible legacy page shells after compatibility routing and state tests pass.
- [ ] Run ready/blocked tests for every workspace and loading/empty/blocked/ready tests for the six critical workspaces.

### Task 7: Produce And Verify The Windows Delivery

**Files:**
- Modify delivery docs only after package evidence is final: `README.md`, `docs/USER_GUIDE_v1_5.md`, acceptance/progress/closeout docs.
- Generate local package and evidence artifacts without committing them.

**Interfaces:**
- Produces matching installer, portable EXE, package index, package-launch smoke, final-readiness JSON, READY bundle, READY safety result, and documented hashes.

- [ ] Run the complete test suite, typecheck, renderer build, business UI smoke, ad-execution verifier, dependency/security checks, and the full visual-state matrix.
- [ ] Build Windows installer and portable candidate packages.
- [ ] Run package-launch smoke and verify candidate hashes against the package index.
- [ ] Inspect all eight workspaces and critical dialogs in the packaged application at both viewports and 125% scaling.
- [ ] Generate final readiness, update delivery docs, export the READY bundle, and run READY safety.
- [ ] Run a whole-branch review and only then report the new authoritative portable path and hash.
