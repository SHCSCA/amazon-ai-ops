# Amazon AI Ops — Store-Isolated Operations Prototype

## Outcome

The prototype should let one Amazon US operator understand and rehearse the complete operating loop without reading a dense technical console: choose a store and product, complete eight-report collection, run an attributable analysis, review and approve one safe recommendation, pass the execution gate, observe readback, run an experiment, and preserve a cautious causal memory.

Everything in this standalone prototype is simulated. It performs no Lingxing or Amazon Ads writes and is not production-readiness evidence.

## Information Architecture

Six modules replace the previous long, repeated navigation:

| Module | Operator question | Included capabilities |
| --- | --- | --- |
| 今日任务 | What needs my attention now? | progress, blockers, result, next action |
| 运营资产 | Is the current store's evidence ready? | products, ad objects, 8-report collection |
| 决策中心 | Where did this advice come from? | analysis runs, recommendation provenance, approval |
| 执行与实验 | Can this safely run and did it work? | gated execution/readback, business experiments |
| 经营记忆 | What did we learn and what actually happened? | causal observations, immutable operation record |
| 系统设置 | What boundaries govern this store? | stores, ERP/Ads truth, policies, automation modes |

Internal Skills compose these flows but are not user-facing features. A diagnostics-only view may explain which internal capability owned a phase; users cannot add, delete, or invoke Skills directly.

## Core Domain Model

An **analysis run** is the central source object. It is bound to one store, selected product, date window, report snapshot, fingerprint, status, output summary, and recommendation set. Re-running the same fingerprint supersedes the older run and recommendations, so repeated analysis never silently stacks duplicate advice.

The visible chain is:

`store + product → 8 reports → analysis run → recommendation → approval → safety gate → simulated execution → readback → experiment → causal memory`

The chain is not a forced wizard. Each module can be entered independently, while the shared store-scoped state and explicit next action keep the loop coherent.

## Store and Mode Contract

- Simulated stores: JF-US, HN-US, and TP-US.
- Marketplace and currency: Amazon United States / USD only.
- Store switching replaces all product, report, run, recommendation, approval, execution, experiment, and memory state.
- Each store independently keeps one of three modes: 人工审批, 半自动, or 策略内自动.
- Changing mode requires confirmation and never weakens the safety gates.

## Truth and Safety Contract

- 8/8 reports: analysis may complete and publish a recommendation.
- 7/8 reports: analysis is blocked, publishes no recommendation, and points to the missing collection step.
- ERP and Ads are separate truth states. ERP may support read-only collection while Ads failure or identity mismatch blocks execution.
- V1 supports only keyword bid adjustments. Any other action remains unavailable regardless of mode.
- Execution additionally requires a completed current analysis, live Ads session, selected-store identity match, current-store approval/authorization, and mandatory readback.
- Causal memory labels a single result as an observation, records guardrails and provenance, and does not overstate correlation as reusable causality.

## Interaction Principles

- Persistent top context: store, product, US/USD, ERP/Ads truth, and current mode.
- Each screen answers: current state, what just happened, why it matters, and the next action.
- Analysis shows staged progress and a completion result with its source run; recommendation cards name that run and evidence window.
- Identical reruns visibly mark the previous result as superseded rather than adding another active recommendation.
- Disabled controls explain why they are disabled and link to recovery.
- Ordinary UI hides internal IDs and engineering values. Advertising objects use the readable path `活动 > 广告组 > 关键词/投放`.
- Dialog content can scroll while footer actions remain reachable at 1366×768 and 100%/125% scaling.

## Visual Direction

A calm light Windows console: narrow grouped navigation, white content surfaces on a pale canvas, restrained blue for the active task, green only for verified success, amber for attention, and red only for hard blockers. The hierarchy prioritizes one task and one next action; details, evidence, and operation records expand progressively instead of competing on the first screen.

## Acceptance Examples

- JF-US with 8/8 reports can create a new analysis; its prior identical run becomes superseded and only the new recommendation remains active.
- TP-US with 7/8 reports cannot publish advice and receives a direct route to data collection.
- An approved keyword bid recommendation still cannot execute when Ads is unavailable or the account does not match the selected store.
- A budget change remains blocked in every operating mode because V1 permits keyword bid adjustment only.
- A completed experiment creates a store-scoped memory with observation window, guardrails, evidence, and an explicit "needs more samples" limitation.

