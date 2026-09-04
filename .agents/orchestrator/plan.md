# Execution Plan

## Steps
1. **Directory Discovery**: List and identify the structure of `apps/` and `packages/` folders in the workspace.
2. **Decomposition**: Define milestones in `PROJECT.md` for analyzing the different modules (Electron main process, IPC, DB, UI renderer, configs).
3. **Subagent Dispatch**:
   - Spawn explorer subagents to analyze the `packages/` codebase.
   - Spawn explorer subagents to analyze the `apps/` codebase.
4. **Synthesis & Writing**:
   - Synthesize the findings from explorers.
   - Write structured Chinese reports under `output/code_analysis/`.
   - Incorporate at least 2 Mermaid diagrams (architecture & data flow).
   - Detail at least 3 concrete refactoring suggestions with exact files and line numbers.
   - Generate `output/code_analysis/index.md` containing links to sub-reports.
5. **Quality Gate & Review**: Check character counts, diagrams, language consistency, and file links.
6. **Reporting**: Notify the parent Sentinel.
