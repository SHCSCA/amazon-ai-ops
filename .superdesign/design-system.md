# Amazon AI Ops — Mission Control Design System

## Product context

Amazon AI Ops is a Windows desktop operating system for one-person Amazon operations. It is not a generic ERP dashboard and not a chat wrapper. The primary product promise is: an operator defines a business Mission and its risk boundary; a persistent Agent Runtime continuously observes Lingxing/Amazon facts, selects governed Skills, executes allowed changes, independently verifies them, and escalates only consequential decisions.

Primary connector for v1: a visible Lingxing browser session used for report collection, advertising actions, reload verification, and evidence capture. Lingxing is an adapter below the product domain model, never the navigation or information architecture.

Primary user: an experienced Amazon operator managing multiple strictly isolated stores on Windows. They need fast daily supervision, trustworthy real-ad execution, exact history retrieval, and an obvious path to pause or take over.

## Jobs to be done

1. Understand which Mission most needs attention now.
2. See what the Agent observed, inferred, planned, executed, and verified.
3. Approve only decisions that cross policy or risk boundaries.
4. Watch or take over the visible Lingxing browser execution.
5. Review each advertising adjustment as an Operation Experiment: hypothesis, baseline, action, guardrails, observation window, outcome, and conclusion.
6. Switch stores without leaking any facts, policies, missions, or evidence across stores.

## Core information architecture

- Command: active Mission, next safe action, agent state, risk budget, data freshness.
- Missions: objective, scope, constraints, plan, checkpoints, Skills, and current state.
- Decisions: Crux cards with evidence, impact, alternatives, recommendation, and approve/reject/edit actions.
- Experiments: adjustment ledger with hypothesis, baseline, action, observation window, measured outcome, and confidence.
- Live execution: visible Lingxing browser, current Skill, target identity, before/after/reload evidence, pause and takeover.
- Memory: searchable causal timeline across store, SKU, campaign, decision, execution, and outcome.
- Configuration: store, autonomy mode, policy, connector health, schedules, Skill versions. This is secondary, not the daily home.

## Desktop shell

- Windows desktop only. Primary design viewport: 1440 x 1024. Also remain valid at 1280 x 800 and 1920 x 1080.
- Fixed 52px top bar on wide screens; 82px two-row top bar at 1280px and below.
- Fixed 184px left rail on wide screens; 176px at 1280px and below.
- Main content is the only page scroll owner.
- Preserve the current product's compact operational density and serious tone.
- Top bar must show product identity, strict store selector, Lingxing session health, active scope, autonomy mode, and global pause/takeover control.
- Left rail should foreground Command, Missions, Decisions, Experiments, and Memory. Put Data/Skills/System into a secondary group.
- At 1400px and wider, contextual detail can use a 360px right inspector. Below that it becomes a modal drawer up to 460px.

## Visual tokens — hard constraints

Use only the following visual language, taken from the production renderer.

### Typography

- UI font: `Segoe UI`, `Microsoft YaHei UI`, `Microsoft YaHei`, system-ui, sans-serif.
- Mono/data font: `Cascadia Mono`, `SFMono-Regular`, Consolas, monospace.
- Body: 14px / 21px.
- Controls: 13px / 20px.
- Supporting text: 12px / 18px.
- Page title: 24px / 32px, 750–800 weight.
- Section title: 16px / 24px, 700–750 weight.
- Key number: 20px / 24px, tabular numerals.
- No decorative display type and no more than these two font families.

### Color

- App background: `#f5f7fa`.
- Surface: `#ffffff`.
- Subtle surface: `#f8fafc`.
- Primary text: `#172033`.
- Secondary text: `#475569`.
- Disabled text: `#94a3b8`.
- Border: `#dbe2ea`.
- Strong border: `#b8c4d1`.
- Primary action: `#2563eb`; hover `#1d4ed8`; soft `#eff6ff`.
- Attention: `#b45309`; soft `#fffbeb`.
- Blocked: `#c2410c`; soft `#fff7ed`.
- Error: `#b91c1c`; soft `#fef2f2`.
- Confirmed: `#15803d`; soft `#f0fdf4`.
- Overlay: `rgba(23, 32, 51, 0.18)`.
- Do not introduce purple, pink, cyan, neon, gradients, glassmorphism, dark mode, or black marketing surfaces.

### Spacing and geometry

- Spacing scale: 4, 8, 12, 16, 24, 32px.
- Radius: 6px controls, 8px panels, 10px large work surfaces.
- Buttons: minimum 36px height, compact horizontal padding, 1px border.
- Use shadows only for popovers, modal drawers, or floating browser controls: `0 16px 36px rgba(23,32,51,.14), 0 2px 8px rgba(23,32,51,.08)`.
- Prefer alignment, typography, whitespace, and row dividers over a field of cards.
- Do not nest cards inside cards. Normal data should be grouped into lists, tables, timelines, or one continuous work surface.

## Component patterns

- Primary action: solid blue button. One clear primary action per dominant surface.
- Secondary action: white button with strong border.
- Status: compact text pill using soft semantic backgrounds; never use color without text.
- Mission header: objective and outcome first, constraints/risk budget second, current checkpoint and next safe action third.
- Crux decision: one consequential question, evidence and impact summary, recommended option, alternatives, approval expiry, and explicit result.
- Operation Experiment: continuous timeline or ledger row; show hypothesis → action → observation → outcome. Avoid isolated metric cards.
- Agent plan: structured step list with Skill name/version, status, evidence, and verification dependency. Do not expose chain-of-thought.
- Live execution: browser/session surface is visibly tied to store, Mission, target and current Skill. Pause and takeover must remain obvious.
- Memory: causal timeline must distinguish confirmed fact, temporal association, AI inference, and verified conclusion.
- CRUD: create/edit/archive/version actions are available where needed, but remain secondary to the Mission workflow.

## Motion and feedback

- Fast transition: 120ms; standard: 180ms; easing `cubic-bezier(0.2, 0, 0, 1)`.
- Use motion only for route handoff, state change, live execution progress, inspector opening, and confirmed action feedback.
- Buttons move at most 1px on press. No decorative floating, pulsing dashboards, or large ambient animations.
- Respect reduced motion.

## Content rules

- Chinese operator-facing copy; English only for standard identifiers such as Mission, Skill, ASIN, ACOS, TACOS and connector names.
- Show realistic store/SKU/campaign values and dates anchored to 2026-07-20.
- Separate observed facts from AI inference and verified results.
- Never label a request accepted by Lingxing as a completed business outcome. Platform reload verification and observation-window results are separate states.
- Never claim production readiness or real execution in a visual concept. A coded prototype must mark simulated execution explicitly until wired to production.

## Anti-patterns

- No generic 4-KPI dashboard as the dominant first screen.
- No feature-inventory home page.
- No 17 equal-weight CRUD pages.
- No chatbot as the main product surface.
- No connector marketplace as the home page.
- No autonomous-mode toggle without visible policy, scope, risk budget, pause, and audit context.
- No hidden store scope or cross-store aggregate unless explicitly labelled.
- No card grid where a mission timeline, decision queue, experiment ledger, or evidence table communicates the relationship better.
