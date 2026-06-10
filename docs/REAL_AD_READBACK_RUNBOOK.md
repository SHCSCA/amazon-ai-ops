# Real Ad Readback Runbook

当前项目的 READY 阻断已由一次低风险真实广告动作的前后回读证据关闭。本文保留为后续人工验收手册，不授权任何自动广告写入。

## Current Candidate

| Field | Value |
| --- | --- |
| Store / Marketplace | FT-US-US / US |
| ASIN | B0GTTJFQTM |
| Campaign | D6-自动-低价探索 - 5/18/2026 |
| Ad group | D6-自动-卧室室内-挖词 - 5/18/2026 |
| Entity | editable target=紧密匹配 |
| Action | lower_bid, one object only |
| Evidence JSON | `output\codex-evidence\real-ad-execution-readback-candidate-rec-1.json` |
| Approval checklist | `output\codex-evidence\real-ad-execution-readback-candidate-rec-1.md` |
| Read-only location evidence | `output\codex-evidence\ads-readonly-locate-2026-06-10T05-50-16-170Z.json` |
| Live Ads UI bid found | `1.20` |
| Service status found | `广告活动已暂停` |
| Candidate after value if separately approved | `1.08` |

Source recommendation value `2.40 -> 2.16` comes from report/search-term metrics. It is not proven to be the live Ads bid. Before any write, the operator must find the editable target bid row in Ads UI and use the live UI value as `before.value`.

2026-06-10 read-only location did find the editable `紧密匹配` target row through ERP -> Ads. The live bid was `1.20`, not `2.40`, and the row showed `广告活动已暂停`. This evidence is approval material only. Because it was captured before second write approval, it must not be reused as the final `before.screenshotPath`; after approval, capture a new before screenshot so timestamp order remains valid.

## Do Not Execute If

- The exact campaign, ad group, and editable target row cannot be found.
- The page only shows a read-only search term row.
- The live bid differs from the source value and no new after target was approved.
- The paused campaign/service status is not explicitly accepted by the approval owner.
- Approval owner, approval proof, operator, before screenshot, after screenshot, or readback screenshot is missing.
- The action increases budget, increases bid, creates a campaign, expands traffic, or performs a bulk edit.
- Reload/readback cannot prove `readback.actualValue == after.value`.

## Fill Before Execution

- `approval.operatorConfirmed=true`
- `realWriteApproved=true`
- `approval.confirmedAt`
- `approval.approverName`
- `approval.approvalArtifactPath`
- `risk.allowedByPolicy=true`
- `before.value`
- `before.capturedAt`
- `before.screenshotPath`
- `before.liveBidSourceNote`

## Fill After Execution

- `execution.success=true`
- `execution.verified=true`
- `execution.executionId`
- `execution.executedAt`
- `execution.channel=manual_ads_ui`
- `execution.appExecutorUsed=false`
- `execution.performedBy`
- `after.value`
- `after.capturedAt`
- `after.screenshotPath`
- `readback.verified=true`
- `readback.method`
- `readback.readAt`
- `readback.actualValue`
- `readback.evidencePath`

Required timestamp order:

```text
approval.confirmedAt <= before.capturedAt <= execution.executedAt <= after.capturedAt <= readback.readAt
```

## Verification

```powershell
pnpm run verify:ad-readback -- output\codex-evidence\real-ad-execution-readback-candidate-rec-1.json
pnpm run write:v15-evidence-manifest -- --ad-readback output\codex-evidence\real-ad-execution-readback-candidate-rec-1.json --out output\codex-evidence\v15-final-readiness-evidence-manifest-2026-06-10.json
pnpm run verify:v15-final-readiness -- --evidence-manifest output\codex-evidence\v15-final-readiness-evidence-manifest-2026-06-10.json --out output\codex-evidence\final-readiness-2026-06-10.json
```

For future ad actions, repeat this same approval, before/after screenshot, reload/readback, and verifier flow with that action's own dynamic target fields. Do not reuse the current D6 paused-target evidence for another product, ad group, target, or bid.
