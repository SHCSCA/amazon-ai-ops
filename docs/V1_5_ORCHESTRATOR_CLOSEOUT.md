# v1.5 Orchestrator Closeout

Date: 2026-06-10

## Objective

Deliver Amazon AI Ops v1.5 as a user-usable desktop project, with operator-facing UX, evidence-backed readiness gates, final installer evidence, and a safe boundary for real ad actions.

## Agents Used

This closeout followed the repository's `.codex/agents/agents-orchestrator.toml` quality loop. The main agent retained integration ownership and delegated bounded audits:

| Agent role | Scope | Outcome |
| --- | --- | --- |
| `testing-reality-checker` | Audit APP_READY evidence, README/docs, final readiness JSON, bundle manifest, package scripts, and installer hash consistency | Found the app gates passed but the delivery bundle was stale after doc edits. Required bundle re-export and hash recheck. |
| `engineering-git-workflow-master` | Audit Git staging scope and local artifact risk | Recommended staging source, tests, scripts, docs, and page model changes; excluding `.codex/config.toml`, `output/`, `storage/`, browser profiles, AppData DB files, raw XLSX reports, release binaries, and secrets. |

Earlier delivery work also used orchestrator/product/UX/QA roles to reject premature READY claims until live Lingxing full-8 collection, Listing read, DeepSeek, Listing AI, ad AI explanation, and real ad readback evidence existed.

## Historical Readiness

This document records the 2026-06-10 closeout and the later 2026-06-18 product-ui, portable-fix, packaged-launch, 2026-06-23 high-fidelity UI closeout, and 2026-06-24 AI output-contract/package refresh plus the 2026-06-25 credential, AI/import feedback, canonical metric, Lingxing date-picker, product-level workbench refresh, ad readback screenshot capture, heavy table virtualization, Listing keyword heatmap matrix, and live AI strategy JSON-contract fix. The current delivery state is recorded in `README.md`; as of the 2026-06-25 refresh the packaged state is `APP_READY` for the refreshed manifest-driven final-readiness `output\codex-evidence\final-readiness-20260625132557.json`, package launch smoke `output\codex-evidence\package-launch-smoke-1782365100586.json`, READY bundle `output\delivery-bundles\v15-delivery-bundle-20260625132557-ready`, and matching `verify:v15-ready-safety` result. This includes the renderer UX polish for AI output contract tags, compact metric tags, business-domain navigation, Listing table editing, Listing keyword/root heatmap coverage, structured output token floor, OpenAI-compatible saved temperature/maxTokens usage, strategy diagnosis evidence-ref normalization, concrete JSON output examples, automatic commit/close behavior for the Lingxing date range picker during report creation, inline product maintenance, per-product daily ad metrics, encrypted local remember-account/password support, first-viewport AI/import feedback, virtualized keyword/import validation tables, ad readback screenshot drag/drop or Ctrl+V capture into session evidence folders, canonical daily metric accounting, and the dashboard product-selection gate. Live strategy evidence `output\codex-evidence\ad-strategy-live-1782358641101.json` returned `source=ai` with no fallback on the current DB scope. Product-centered context is now the intended operator entry for ASIN-specific analysis: select the product in `产品管理`, let it populate `scope.asin`, then continue into ad quantification, recommendations, operation events, keywords, and Listing from that context. The historical manifest-driven final-readiness `output\codex-evidence\final-readiness-2026-06-18-portable-fix.json` and READY bundle `output\delivery-bundles\v15-delivery-bundle-2026-06-18-portable-fix-ready` remain baseline evidence only.

Authoritative evidence:

| Gate | Evidence |
| --- | --- |
| Final readiness | `output\codex-evidence\final-readiness-20260625132557.json` |
| Evidence selection | `output\codex-evidence\v15-final-readiness-evidence-manifest-20260625132557.json` |
| Delivery bundle | `output\delivery-bundles\v15-delivery-bundle-20260625132557-ready` |
| Current package launch smoke | `output\codex-evidence\package-launch-smoke-1782365100586.json` |
| Live ad strategy diagnosis | `output\codex-evidence\ad-strategy-live-1782358641101.json` |
| Historical 2026-06-10 bundle | `output\delivery-bundles\v15-delivery-bundle-2026-06-10T07-00-21-859Z\delivery-bundle-manifest.json` |
| Product UI smoke | `output\codex-evidence\v15-product-readiness-ui-smoke-1781072779324.json` |
| Installer | `apps\desktop\release\AmazonAIOpsAgent-1.5.0.exe` |

Final installer:

| Field | Value |
| --- | --- |
| SHA-256 | `8B4ED7F35AB396F2C807C3AFB1BC70F055D2851680DD0CEE9E5B12FAE8B98425` |
| Size | `83100529` bytes |
| Last write | `2026-06-25 13:24:50` |

## Verification Snapshot

Completed final-node checks:

| Check | Result |
| --- | --- |
| `pnpm test` | Passed, 37 test files / 191 passed / 2 skipped |
| `pnpm -r run typecheck` | Passed |
| `pnpm --filter @amazon-ai-ops/desktop run build:win` | Passed |
| Packaged smoke | `win-unpacked\AmazonAIOpsAgent.exe` stayed alive for 8 seconds and stopped with no remaining process |
| `pnpm run smoke:v15-product-readiness-ui` | Passed |
| `pnpm run verify:v15-ready-safety` | Passed |

Post-audit fix:

- The stale delivery bundle found by `testing-reality-checker` was re-exported.
- The new bundle is `output\delivery-bundles\v15-delivery-bundle-2026-06-10T07-00-21-859Z`.
- The current source, bundle copy, and manifest SHA-256 values match for `docs/V1_5_PROGRESS_REPORT.md`, `docs/V1_5_ACCEPTANCE_MATRIX.md`, and `docs/REAL_AD_READBACK_RUNBOOK.md`.
- The stale pre-release wording identified by QA is absent from the current bundle docs.

## Safety Boundary

The app is deliverable with the following explicit boundary:

- Current real ad execution readiness is proven by one user-approved, low-risk manual Ads UI sample on a paused FT-US keyword row `door lock`, with live bid `1.30 -> 1.17`, before/after/reload screenshots, real spreadsheet source traceability, and `verify:ad-readback`. The historical paused target sample `1.20 -> 1.08` remains baseline only.
- The app-side ad execution button remains fail-closed. It does not batch-write ads.
- Future ad changes must each bind their own store, marketplace, portfolio, campaign, ad group, ASIN, entity type, entity name, action type, source recommendation, real source report file(s), original source row, live before value, live after value, approval proof, screenshots, and readback evidence.
- The verified D6 paused-target sample must not be reused as proof for another product, ad group, target, or bid.

## Commit Boundary

Stage source, tests, scripts, docs, and page model changes needed for v1.5. Exclude local/runtime artifacts:

- `.codex/config.toml`
- `output/`
- `storage/`
- `apps/desktop/release/`
- AppData SQLite DB files
- raw downloaded XLSX reports
- browser profiles, cookies, sessions, traces
- API keys, passwords, `.env*`
