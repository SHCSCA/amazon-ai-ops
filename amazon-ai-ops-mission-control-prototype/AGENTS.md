# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Confirmed product direction (2026-07-20)

- The three selected mockups are complementary workspaces in one product, not competing alternatives.
- The prototype must unify Mission flight planning, Operation Experiment / causal ledger, and visible Lingxing execution into one end-to-end stateful workflow.
- Mission, experiment, Crux decision, execution evidence, readback, and causal memory must share the same store-scoped records.
- Store switching must isolate data, mode, approvals, experiments, and activity history.
- CRUD is a baseline capability for managed business objects, but it stays visually secondary to the active Mission.
- Both human-approval and policy-bounded AI-auto modes must be interactive.
- Real Ads writes are simulated in this prototype, but the visible execution, approval boundary, retry, evidence, and verification states must feel operational and explicit.
- Version one supports Amazon US only. Every configurable store is fixed to region `US`, currency `USD`, and business timezone `America/Los_Angeles`; multiple US stores still keep separate data, browser profiles, policies, and history.
- User-facing automation copy must say `策略内自动` (policy-bounded automation), never imply unlimited or globally autonomous execution.
