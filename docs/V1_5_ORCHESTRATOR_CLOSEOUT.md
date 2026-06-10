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

## Current Readiness

The current manifest-driven application state is `APP_READY`.

Authoritative evidence:

| Gate | Evidence |
| --- | --- |
| Final readiness | `output\codex-evidence\final-readiness-2026-06-10.json` |
| Evidence selection | `output\codex-evidence\v15-final-readiness-evidence-manifest-2026-06-10.json` |
| Delivery bundle | `output\delivery-bundles\v15-delivery-bundle-2026-06-10T07-00-21-859Z\delivery-bundle-manifest.json` |
| Product UI smoke | `output\codex-evidence\v15-product-readiness-ui-smoke-1781072779324.json` |
| Installer | `apps\desktop\release\AmazonAIOpsAgent-1.5.0.exe` |

Final installer:

| Field | Value |
| --- | --- |
| SHA-256 | `96648ADD7F51C2CFAC8289CD61F5449FE2453C556127C049668F6FB3613FEBC1` |
| Size | `89678328` bytes |
| Last write | `2026-06-10 14:48:01` |

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

- Real ad execution readiness is proven by one user-approved, low-risk manual Ads UI sample on a paused target, with bid `1.20 -> 1.08`, before/after/reload screenshots, and `verify:ad-readback`.
- The app-side ad execution button remains fail-closed. It does not batch-write ads.
- Future ad changes must each bind their own store, marketplace, portfolio, campaign, ad group, ASIN, entity type, entity name, action type, source recommendation, live before value, live after value, approval proof, screenshots, and readback evidence.
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
