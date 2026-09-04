# Standalone Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when the agent can run it.

This directory is a standalone interactive prototype. Do not modify the production Electron application while iterating on it. The prototype may simulate progress, analysis, approvals, execution, readback, experiments, and memories, but it must never claim to write Lingxing or Amazon Ads. Keep a persistent visible notice that all data and actions are simulated.

## Product Direction (confirmed 2026-08-28)

- Use a calm, light Windows operations-console layout with a narrow business navigation, a persistent store/product/connection/mode context bar, and task-oriented content.
- Optimize for a single operator at 1366×768. Prefer one clear primary action, progressive disclosure, and explicit progress/success/failure/next-step feedback over dense card walls.
- Ordinary UI uses business Chinese. Hide internal IDs, raw state values, revision names, implementation keys, and English engineering terms; technical detail belongs only in a collapsed diagnostic surface.
- Store switching must replace the entire product, report, analysis, recommendation, approval, execution, experiment, and memory context. Never combine or reuse state across stores.
- Current prototype scope is Amazon United States / USD only. The three simulated stores are JF-US, HN-US, and TP-US; no store may imply another marketplace or currency.

## Six Business Modules

The primary navigation is intentionally limited to six modules:

1. **今日任务** — current progress, blocker, result, and next action.
2. **运营资产** — products, advertising objects, and eight-report collection.
3. **决策中心** — analysis runs, AI recommendations, provenance, and approval.
4. **执行与实验** — safety-gated live execution/readback and operating experiments.
5. **经营记忆** — constrained causal observations and immutable operation records.
6. **系统设置** — stores, ERP/Ads connection truth, policies, and automation boundaries.

Do not add a separate Skills marketplace or expose internal tools as primary navigation. Skills are internal, composable capabilities used by the analysis and execution orchestration. They are read-only and diagnostics-only in the prototype.

## Analysis Run Is a First-Class Object

- Every recommendation belongs to exactly one analysis run, one store, one selected product, one data window, and one 8-report snapshot.
- A run visibly moves through creation, fact verification, analysis, recommendation generation, and completion or actionable blocking.
- The UI must show when the run started, when it completed, what it produced, and where to inspect the result.
- Re-running identical input supersedes the older run and its recommendations. The active recommendation list must never accumulate duplicate advice from repeated analysis of the same evidence.
- An incomplete 7/8 report snapshot blocks analysis publication and routes the operator to data collection. Only an exact 8/8 snapshot may publish recommendations.

## Per-Store Operating Modes

The three supported modes are **人工审批**, **半自动**, and **策略内自动**. Mode selection is stored per store, always visible, and changed only after an explicit confirmation that explains what becomes automatic and what remains blocked. Switching stores must restore that store's own mode.

## V1 Execution Safety Contract

- V1 permits only **adjust keyword bid**. Campaign, ad-group, budget, pause, negative-keyword, product-targeting, or other actions remain blocked even if mock fixture data contains them.
- Real execution is fail-closed unless all gates pass: current store has 8/8 reports, current analysis completed, Ads session is live, Ads identity matches the selected store, the active action is a keyword bid adjustment, current-store approval/authorization exists, and readback is required.
- ERP may remain available for read-only collection when Ads is unavailable. Ads or store-identity failure must never be presented as a successful connection or executable state.
- Approval, execution, readback, experiments, and causal memory remain separate events with visible provenance; a simulated success must not be mistaken for production evidence.

## Interaction and Visual Conventions

- Keep the store selector, selected product, ERP/Ads connection truth, and current mode visible in the top context bar.
- Use one shared object path format for advertising objects: `活动 > 广告组 > 关键词/投放`; hide internal identifiers in ordinary UI.
- All async simulations need immediate feedback, a determinate or staged progress state, a final result, and a concrete recovery/next action.
- Dialog bodies may scroll while their actions remain reachable; keyboard focus must be visible; reduced-motion preferences must be respected.
- No Google Fonts and no dark-mode toggle. Use Segoe UI/system fonts and the light theme only.

