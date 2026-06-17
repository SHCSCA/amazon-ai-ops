# Real Ad Readback Runbook

历史 READY 阻断曾由一次低风险真实广告动作的前后回读证据关闭。当前工作树已经补强 AI 证据链、UI 和 readback 合同，并在 2026-06-18 使用当前合同重新完成一次真实 Ads UI 人工执行与刷新回读。本文保留为后续人工验收手册，不授权任何自动广告写入。

## Current Candidate

| Field | Value |
| --- | --- |
| Store / Marketplace | FT-US-US / US |
| ASIN | B0GTTJFQTM |
| Campaign | D6-精准-首轮投测词 - 5/18/2026 |
| Ad group | D6-手动精准-卧室核心长尾 - 5/18/2026 |
| Entity | editable keyword=door lock |
| Action | lower_bid, one object only |
| Evidence JSON | `output\codex-evidence\real-ad-execution-readback-candidate-rec-4-current-pass.json` |
| Approval checklist | `output\codex-evidence\real-ad-execution-readback-candidate-rec-4-current.md` |
| Source recommendation evidence | `output\codex-evidence\installed-ad-ai-explanation-packaged-final-20260617.json` |
| Source report row | `410` |
| Source recommendation value | `1.63 -> 1.46` |
| Live Ads UI bid found | `1.30` |
| Service status found | paused / `已暂停` |
| Verified manual after value | `1.17` |
| Final readiness evidence | `output\codex-evidence\final-readiness-2026-06-18.json` |

Source recommendation value `1.63 -> 1.46` comes from real report/search-term and keyword metrics. It is not proven to be the live Ads bid. In the verified 2026-06-18 run, the live Ads UI bid was already `1.30`, which is lower than the source recommended value `1.46`; therefore the operator did not write the stale source recommendation back into Ads. The verified action used a lower live validation value `1.17` and recorded the source recommendation and live before/after values as separate evidence layers.

The current PASS evidence has passed source report traceability, manual approval, before/after screenshot, independent reload/readback, low-risk direction, timestamp ordering, and secret-scan checks. The immutable NEEDS_WORK candidate and session folder remain useful as operator work material, but final readiness now selects the PASS evidence file.

## Do Not Execute If

- The exact campaign, ad group, and editable target row cannot be found.
- The page only shows a read-only search term row.
- The live bid differs from the source value and no new after target was approved.
- The source recommendation would increase or fail to lower the current live bid. In that case, do not write the source recommended value; either regenerate recommendations from current data or approve a separate lower live validation value.
- The paused campaign/service status is not explicitly accepted by the approval owner.
- Approval owner, approval proof, operator, before screenshot, after screenshot, or readback screenshot is missing.
- The source recommendation cannot be traced to real Lingxing spreadsheet report file(s) and a positive original report row number.
- The action increases budget, increases bid, creates a campaign, expands traffic, or performs a bulk edit.
- Reload/readback cannot prove `readback.actualValue == after.value`.

## Fill Before Execution

- `approval.operatorConfirmed=true`
- `realWriteApproved=true`
- `approval.confirmedAt`
- `approval.approverName`
- `approval.approvalArtifactPath`
- `source.sourceFiles` with real `.xlsx`, `.xls`, or `.csv` Lingxing report path(s)
- `source.sourceRow` with the original positive report row number
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

The recommendation-to-readback helper now enforces source traceability before it writes a candidate. If the installed AI explanation evidence is an older summary that lacks source report fields, pass both values explicitly:

```powershell
node scripts\create-ad-readback-candidate-from-recommendation.js --source <installed-ad-ai-explanation.json> --recommendation-id <id> --source-files <real-lingxing-report.xlsx> --source-row <positive-row-number> --out output\codex-evidence\real-ad-execution-readback-candidate-rec-<id>.json
```

Without existing real spreadsheet source file(s) and a positive source row, the helper exits before writing candidate JSON/Markdown.

Before operating in Ads UI, create a per-action working folder. In the desktop app, go to `执行回读`, export the readback JSON, then use `回读工作包 -> 创建回读工作包`. The app will display the session directory, `session-input.json`, operator checklist, and PASS output path. Use `检查工作包` before live capture; it only verifies that the session folder structure is safe, that the source candidate is still `NEEDS_WORK`, and that raw Lingxing spreadsheet reports were not copied into the session folder. The folder contains screenshot folders, an operator checklist, a `session-paths.json` file, and an editable `fill-ad-readback.ps1` command. It does not copy raw Lingxing spreadsheet reports.

The CLI fallback is:

```powershell
pnpm run prepare:ad-readback-session -- --source output\codex-evidence\real-ad-execution-readback-candidate-rec-4-current.json --out output\codex-evidence\ad-readback-session-rec-4-current
pnpm run verify:ad-readback-session -- output\codex-evidence\ad-readback-session-rec-4-current
```

`verify:ad-readback-session` only checks that the working folder is safe for live capture: source candidate is still `NEEDS_WORK`, the final output will not overwrite the candidate, approval/before/after/readback folders exist, and raw Lingxing spreadsheets were not copied into the session folder. It is not final readback proof.

After the approved manual Ads UI action is complete, fill `session-input.json` in the session folder. In the desktop app, use `回读工作包 -> 生成回读证据` to create the PASS-intended JSON/Markdown, then use `校验回读证据` on the generated JSON. The app still uses the readback evidence completeness and verifier rules and will return `NEEDS_WORK` if screenshots, timestamps, values, source files, source row, approval proof, low-risk policy, execution channel, readback value, distinct evidence files, or secret-scan checks fail. The CLI fallback is:

```powershell
pnpm run fill:ad-readback-session -- --session output\codex-evidence\ad-readback-session-rec-4-current
```

The session helper reads `session-paths.json` and `session-input.json`, writes the PASS-intended evidence JSON inside the session folder, and the desktop `校验回读证据` action runs the same verifier-class checks before the evidence can be considered for manifest aggregation.

The lower-level long-form helper remains available when no session folder is used:

```powershell
pnpm run fill:ad-readback -- --source output\codex-evidence\real-ad-execution-readback-candidate-rec-4-current.json --out output\codex-evidence\real-ad-execution-readback-rec-4-pass.json --approver-name "<approver>" --approval-artifact "<ticket-or-screenshot-path>" --approval-confirmed-at "<ISO time>" --before-value "<live before bid>" --before-captured-at "<ISO time>" --before-screenshot "<before screenshot path>" --live-bid-source-note "Read from Ads UI editable target bid row before manual change." --after-value "<live after bid>" --after-captured-at "<ISO time>" --after-screenshot "<after screenshot path>" --executed-at "<ISO time>" --executed-by "<operator>" --execution-id "<manual action id>" --readback-read-at "<ISO time>" --readback-evidence "<reload/readback screenshot path>"
```

The helper writes the output JSON and immediately runs `verify:ad-readback`. If the verifier fails, the output is not READY evidence.

```powershell
pnpm run verify:ad-readback -- output\codex-evidence\real-ad-execution-readback-candidate-rec-4-current-pass.json
pnpm run write:v15-evidence-manifest -- --ad-readback output\codex-evidence\real-ad-execution-readback-candidate-rec-4-current-pass.json --out output\codex-evidence\v15-final-readiness-evidence-manifest-2026-06-18.json
pnpm run verify:v15-final-readiness -- --evidence-manifest output\codex-evidence\v15-final-readiness-evidence-manifest-2026-06-18.json --out output\codex-evidence\final-readiness-2026-06-18.json
```

For future ad actions, repeat this same approval, before/after screenshot, reload/readback, and verifier flow with that action's own dynamic target fields. Do not reuse the current D6 `door lock` candidate evidence for another product, ad group, target, or bid.
