# Amazon AI Ops Agent - Agent Instructions

<!-- CCG-FAST-CONTEXT-START -->
# fast-context MCP 工具使用指南（辅助模式）

## 核心原则

**主检索工具为 ace-tool（`mcp__ace-tool__search_context`）。当 ace-tool 无法满足语义搜索需求时，使用 `mcp__fast-context__fast_context_search` 作为补充。**

适合使用 fast-context 的场景：
- 用自然语言描述要找的逻辑（如"部署流程"、"事件处理"）
- 跨模块、跨层级的调用链路追踪
- 中文语义搜索（工具支持中英文双语查询）
<!-- CCG-FAST-CONTEXT-END -->

## Project Scope

- This repo is a local-first Electron desktop app for Amazon operators. Target Windows desktop only; do not spend effort on mobile layouts unless explicitly requested.
- Preserve the current worktree. Do not roll back user changes, generated evidence, or local runtime state unless the user explicitly asks.
- `output/`, `storage/`, AppData DB/profile files, raw Lingxing spreadsheets, release EXE binaries, and secrets are local artifacts. Do not commit them.

## Current Delivery State

- Current top-level state is `APP_READY` for the evidence set fixed on 2026-06-18.
- Authoritative final readiness: `output\codex-evidence\final-readiness-20260618170712.json`.
- Evidence manifest: `output\codex-evidence\v15-final-readiness-evidence-manifest-20260618170712.json`.
- Package launch smoke: `output\codex-evidence\package-launch-smoke-1781772408989.json`.
- READY bundle: `output\delivery-bundles\v15-delivery-bundle-20260618170712-ready`.
- Installer SHA-256: `E6890C9043BE8140900ACCF146898DD45B841C33FF5F4B3D4301CF5A1BFC94A2`.
- Portable/no-install SHA-256: `D9C181C09B32A1FBC5095281E1DBB788C1C8B9FAE36FA81F31B70E5BF319D1D2`.

Any code, package, scope, or ad-action change invalidates the current APP_READY claim until the final gates are rerun.

## Required Safety Boundaries

- App-side batch ad execution remains fail-closed. The UI must not claim that blocked audit output equals a real Amazon Ads write.
- Every future Ads UI action needs its own target, source report file(s), source row, approval, before screenshot, after screenshot, reload/readback screenshot, and `verify:ad-readback` pass.
- Structural/mock AI evidence never gives final readiness credit. Real readiness requires live provider evidence and the real ad/Listings verifier chain.
- Operator-facing UI should stay concise: avoid raw `APP_*` status codes, long command walls, or dense evidence text in primary views. Put technical details behind secondary panels.
- Main window text overload was a known UX problem; prefer task-first copy, compact summaries, and clear next action labels.

## Verification Commands

Use focused checks while iterating, then rerun the delivery chain before claiming readiness.

```powershell
pnpm --filter @amazon-ai-ops/desktop run typecheck
pnpm --filter @amazon-ai-ops/desktop run build:win
pnpm run smoke:business-ui-current
pnpm run smoke:package-launch
pnpm run verify:ad-execution
pnpm exec vitest run scripts\verify-v15-final-readiness.test.mjs scripts\verify-v15-ready-safety.test.mjs scripts\verify-v15-non-ready-safety.test.mjs scripts\package-scripts.test.mjs
```

Final delivery refresh:

```powershell
pnpm run write:v15-evidence-manifest -- --ad-readback output\codex-evidence\real-ad-execution-readback-candidate-rec-4-current-pass.json --out output\codex-evidence\v15-final-readiness-evidence-manifest-20260618170712.json
pnpm run verify:v15-final-readiness -- --evidence-manifest output\codex-evidence\v15-final-readiness-evidence-manifest-20260618170712.json --package-launch-smoke output\codex-evidence\package-launch-smoke-1781772408989.json --out output\codex-evidence\final-readiness-20260618170712.json
pnpm run export:v15-delivery-bundle -- --final-readiness output\codex-evidence\final-readiness-20260618170712.json --data-reconciliation output\codex-evidence\real-lingxing-reconciliation-batch_20260612020905629_gkchz1.json --data-reconciliation-md output\codex-evidence\real-lingxing-reconciliation-batch_20260612020905629_gkchz1.md --out output\delivery-bundles\v15-delivery-bundle-20260618170712-ready
pnpm run verify:v15-ready-safety -- --final-readiness output\codex-evidence\final-readiness-20260618170712.json --bundle-manifest output\delivery-bundles\v15-delivery-bundle-20260618170712-ready\delivery-bundle-manifest.json
```

## Docs To Keep In Sync

When delivery status, package hashes, readiness gates, UX boundaries, or evidence paths change, update these together:

- `README.md`
- `docs\USER_GUIDE_v1_5.md`
- `docs\V1_5_ACCEPTANCE_MATRIX.md`
- `docs\V1_5_PROGRESS_REPORT.md`
- `docs\V1_5_ORCHESTRATOR_CLOSEOUT.md`

After doc changes that affect delivery state, re-export the READY bundle and rerun `verify:v15-ready-safety` so bundled docs match the workspace docs.
