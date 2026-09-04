# Project: Codebase Analysis of amazon-ai-ops

## Architecture
- Root workspace: `d:\Desktop\py\amazon-ai-ops`
- Target Code: `apps/desktop/` and `packages/`
- Output Target: `output/code_analysis/`

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Explore Packages | Analyze 13 packages under `packages/` | none | DONE |
| 2 | Explore Apps | Analyze `apps/desktop/src/` (main, preload, renderer) | none | DONE |
| 3 | Generate Reports | Write reports and index.md in `output/code_analysis/` | M1, M2 | DONE |
| 4 | Verification | Run QA validation and audit on reports | M3 | DONE |

## Interface Contracts
- Subagents will communicate findings via handoffs in their directories.
- Aggregated findings will be structured into final Chinese Markdown reports.
