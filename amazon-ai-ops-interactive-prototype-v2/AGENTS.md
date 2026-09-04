# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable design decisions

- This is a Windows desktop prototype; optimize for 1280x800, 1440x900, and 1920x1080 rather than mobile.
- Use a task-first information architecture with eight workspaces and seventeen subviews. Keep execution queue operations inside the execution/readback workspace.
- Keep the visual direction close to the production Amazon AI Ops shell, combined with the previously selected 75% daily-control and 25% operations-ledger direction.
- CRUD is a baseline capability for every mutable entity. Use archive, void, cancel, supersede, and immutable version history where physical deletion would destroy operational evidence.
- Keep text inside its intended control or grid cell at all supported desktop sizes. The main canvas is the page scroller; the body and sidebar must never horizontally scroll.
- Keep each configured store strictly isolated, including data, drafts, filters, selections, overlays, execution mode, ledger entries, and exported evidence.
- All execution and readback interactions in this prototype are simulated and must be visibly labelled as such; they never imply a production-ready Amazon Ads write.
