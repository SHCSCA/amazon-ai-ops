# Amazon AI Ops V2 interactive prototype — Design QA

## Scope

- Artifact: Windows desktop interactive prototype at `http://127.0.0.1:4175/`
- Information architecture: 8 workspaces / 17 subviews
- Store fixtures: `SHC001`, `LMX002`, `NOC003`
- Safety boundary: all Ads execution, screenshots, evidence, readback, and delivery exports are explicitly simulated / prototype-only

## Visual references

- Production Today reference: `output/codex-evidence/package-ui-evidence-20260717-p1/2026-07-17T08-21-12-482Z/100-today-overview.png`
- Production Product reference: `output/codex-evidence/package-ui-evidence-20260717-p1/2026-07-17T08-21-12-482Z/wide-1400x900-100-product-products.png`
- Same-size V2 comparisons:
  - `evidence/qa-20260720/09-today-reference-size-1200x700.png`
  - `evidence/qa-20260720/08-product-reference-size-1400x900.png`
- Final localized screens:
  - `evidence/qa-20260720/prototype-today-1920x1080-final.png`
  - `evidence/qa-20260720/prototype-product-1440x900-final.png`

The V2 retains the production shell proportions, compact Segoe UI / Microsoft YaHei typography, blue active navigation, pale work surface, bordered table and form rhythm, task banner, and four-cell summary strip. The intentional changes are the task-first workspace labels, denser CRUD workbenches, store selector, execution-mode control, and contextual Inspector.

## Layout and visual QA

| Check | Result |
| --- | --- |
| 1280×800 topbar is 82px, sidebar is 176px | passed |
| 1440×900 topbar is 52px, sidebar is 184px | passed |
| 1920×1080 topbar is 52px, sidebar is 184px | passed |
| App content is the only page scroll container | passed |
| Body, sidebar, and page frame have no horizontal overflow | passed |
| 1440+ Inspector is a fixed 360px inline column | passed |
| 1280 Inspector is a 460px modal drawer with backdrop | passed |
| Page titles, task copy, KPI values, table first/last columns, and primary actions remain visible | passed |
| Text-overflow scan across all 17 subviews reports no unintended candidates | passed |
| 17-view final contact sheet reviewed for clipping, hierarchy, and route distinction | passed (17/17) |

Evidence:

- `evidence/qa-20260720/02-today-cdp-1440.png`
- `evidence/qa-20260720/04-recommendations-inspector-1440.png`
- `evidence/qa-20260720/05-readback-1440.png`
- `evidence/qa-20260720/06-listing-1440.png`
- `evidence/qa-20260720/07-today-1280x800.png`
- `evidence/qa-20260720/07-today-1920x1080.png`
- `evidence/qa-20260720/10-product-inspector-drawer-1280x800.png`
- `evidence/qa-20260720/workspaces/contact-sheet-17.png`
- `evidence/qa-20260720/inspector-inline-1440.png`
- `evidence/qa-20260720/inspector-drawer-1280.png`

## Interaction QA

The final browser-driven acceptance run is recorded in `evidence/qa-20260720/ui-interaction-smoke.json`: 39/39 checks passed with zero browser errors. The earlier 17-route visual traversal remains recorded in `evidence/qa-20260720/qa-results.json`.

| Check | Result |
| --- | --- |
| All 17 subviews navigate to the correct visible page title | passed (17/17) |
| Product create persists after reload | passed |
| Product created in SHC001 is absent from LMX002 and NOC003 | passed |
| Scheduler create persists the selected task type | passed |
| Recommendation generation opens contextual Inspector | passed |
| Recommendation selection → submit → required reason → approval confirmation | passed |
| Execution page keeps the simulated / no-real-write warning visible | passed |
| No runtime exception or console error during the full run | passed (0 errors) |
| Approval → queue → simulated execution → before/after/reload evidence → verification | passed |
| Refresh persistence and return-to-SHC001 isolation | passed |

Domain-level smoke additionally covers product target versions, event voiding, report retry/cancel/import idempotency, diagnosis and recommendation generation, decision immutability, execution queue, three distinct prototype evidence records, reload-value verification, Listing version restore, rule updates, scheduler toggle/run-now, kill switch, and localStorage rehydration.

Production build verification: `npm run build` passed with 4,575 modules transformed.

## CRUD and state integrity

- Mutable business objects expose create and edit actions.
- Evidence-bearing objects use domain actions such as archive, void, reject, cancel, supersede, or version restore instead of destructive deletion.
- Every mutation is scoped by `storeId`, persisted before UI success feedback, increments a revision, and appends an audit entry.
- Current navigation, drafts, selections, modes, products, recommendations, Listing versions, schedules, and audit entries are isolated per store.
- Prototype evidence always has `origin: "prototype"`; simulated verification never satisfies production verification.

## Accessibility and control behavior

- Topbar, primary navigation, main content, panels, tables, dialogs, and Inspector use semantic landmarks and labels.
- Buttons remain native buttons; tabs use tab semantics; dynamic feedback uses status / live regions.
- Modal and drawer support Escape, backdrop close, initial focus, focus trapping, and trigger-focus restoration.
- Row selection is keyboard operable; focus rings and reduced-motion behavior are present.

## Issues found and resolved during QA

1. CRUD modal actions were not rendered because the page layer used an `actions` alias; the shared Modal now supports the footer/action contract.
2. Select and textarea value adapters were briefly normalized twice; the base controls now preserve native React events and the workspace adapter owns value extraction.
3. Inspector validation originally targeted an empty recommendation fixture state; the acceptance path now generates recommendations before selecting an object.

## Final result

final result: passed
