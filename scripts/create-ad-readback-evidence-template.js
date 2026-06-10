const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function value(args, key, fallback = '') {
  return args[key] || fallback;
}

function markdownEscape(text) {
  return String(text ?? '').replace(/\|/g, '\\|');
}

function buildChecklist(evidence, jsonPath) {
  const target = evidence.target;
  return `# Real Ad Execution Readback Approval Packet

Status: NEEDS_WORK

This packet is for one explicitly approved low-risk Amazon Ads action. It is not approval by itself and must not be used to claim APP_READY until the JSON evidence passes \`pnpm run verify:ad-readback\`.

## Proposed Scope

| Field | Value |
| --- | --- |
| Evidence JSON | \`${markdownEscape(jsonPath)}\` |
| Store | ${markdownEscape(target.storeName)} |
| Marketplace | ${markdownEscape(target.marketplaceCode)} |
| Campaign | ${markdownEscape(target.campaignName)} |
| Ad group | ${markdownEscape(target.adGroupName)} |
| Portfolio | ${markdownEscape(target.portfolioName || '')} |
| ASIN | ${markdownEscape(target.asin || '')} |
| Metric date | ${markdownEscape(target.metricDate || '')} |
| Entity type | ${markdownEscape(target.entityType)} |
| Entity name | ${markdownEscape(target.entityName)} |
| Action type | ${markdownEscape(target.actionType)} |
| Before value | ${markdownEscape(evidence.before.value)} |
| Proposed after value | ${markdownEscape(evidence.after.value)} |
| Source evidence | ${markdownEscape(evidence.source?.evidencePath || '')} |
| Source entity type | ${markdownEscape(evidence.source?.entityType || '')} |
| Source current metric value | ${markdownEscape(evidence.source?.currentValue || '')} |
| Source recommended value | ${markdownEscape(evidence.source?.recommendedValue || '')} |
| Approver | ${markdownEscape(evidence.approval?.approverName || '')} |
| Approval artifact | ${markdownEscape(evidence.approval?.approvalArtifactPath || '')} |
| Execution channel | ${markdownEscape(evidence.execution?.channel || '')} |
| App executor used | ${markdownEscape(String(evidence.execution?.appExecutorUsed))} |
| Readback evidence | ${markdownEscape(evidence.readback?.evidencePath || '')} |

## Approval Required Before Any Write

- [ ] Operator confirms this exact scope and timestamp in \`approval\`.
- [ ] Operator fills \`approval.approverName\` and \`approval.approvalArtifactPath\` with the external approval owner and proof reference.
- [ ] Operator confirms \`realWriteApproved=true\`.
- [ ] Risk owner confirms \`risk.allowedByPolicy=true\` and documents why the action is low risk.
- [ ] The selected action is one of: \`lower_bid\`, \`pause_target\`, \`add_negative_exact\`, \`add_negative_phrase\`, \`add_negative_broad\`.
- [ ] The first validation action avoids budget increases, bid increases, campaign creation, broad account changes, and irreversible bulk edits.

## Evidence To Capture

- [ ] Before screenshot: Ads UI shows the exact campaign/ad group/entity and current value.
- [ ] Before value: copied into \`before.value\`.
- [ ] Before source: fill \`before.liveBidSourceNote\` to prove this value came from the editable Ads UI bid row, not report CPC.
- [ ] Execute exactly one approved action manually in Ads UI.
- [ ] After screenshot: Ads UI shows the same entity after the change.
- [ ] After value: copied into \`after.value\`.
- [ ] Readback: reload or reopen Ads UI/API and confirm \`readback.actualValue\` equals \`after.value\`.
- [ ] Readback evidence: capture a separate reload/readback screenshot or trace and fill \`readback.evidencePath\`.
- [ ] Execution proof: operator name is copied into \`execution.performedBy\`, local action log id or Ads operation id is copied into \`execution.executionId\`, and \`execution.appExecutorUsed=false\` remains unchanged.
- [ ] Timestamp order is preserved: approval <= before screenshot <= manual execution <= after screenshot <= readback evidence.

## Verification Commands

\`\`\`powershell
pnpm run verify:ad-readback -- ${jsonPath}
pnpm run write:v15-evidence-manifest -- --ad-readback ${jsonPath} --out output\\codex-evidence\\v15-final-readiness-evidence-manifest-2026-06-10.json
pnpm run verify:v15-final-readiness -- --evidence-manifest output\\codex-evidence\\v15-final-readiness-evidence-manifest-2026-06-10.json --out output\\codex-evidence\\final-readiness-2026-06-10.json
\`\`\`
`;
}

function main() {
  const args = parseArgs(process.argv);
  const now = new Date().toISOString();
  const out = path.resolve(args.out || path.join(evidenceDir, `real-ad-execution-readback-template-${Date.now()}.json`));
  const mdOut = path.resolve(args['md-out'] || out.replace(/\.json$/i, '.md'));
  const evidence = {
    kind: 'real-ad-execution-readback',
    status: 'NEEDS_WORK',
    createdAt: now,
    realWriteApproved: false,
    safety: {
      full8Started: false,
      listingAiDraftOnly: false,
      adWriteActionsPerformed: false,
    },
    approval: {
      operatorConfirmed: false,
      scope: value(args, 'approval-scope', 'FILL: operator-approved low-risk scope, including store/site/campaign/ad group/entity/action'),
      confirmedAt: value(args, 'approval-confirmed-at', 'FILL: approval timestamp in ISO format'),
      approverName: value(args, 'approver-name', 'FILL: external approver or responsible owner'),
      approvalArtifactPath: value(args, 'approval-artifact', 'FILL: approval screenshot path, ticket id, or chat record reference'),
    },
    target: {
      storeName: value(args, 'store', 'FT-US-US'),
      marketplaceCode: value(args, 'marketplace', 'US'),
      portfolioName: value(args, 'portfolio', ''),
      asin: value(args, 'asin', ''),
      metricDate: value(args, 'metric-date', ''),
      campaignName: value(args, 'campaign', 'FILL: campaign name'),
      adGroupName: value(args, 'ad-group', 'FILL: ad group name'),
      entityType: value(args, 'entity-type', 'target'),
      entityName: value(args, 'entity', 'FILL: keyword/search term/target'),
      actionType: value(args, 'action', 'lower_bid'),
    },
    risk: {
      level: 'low',
      allowedByPolicy: false,
      rationale: value(args, 'risk-rationale', 'FILL: why this action is low risk and reversible or bounded'),
    },
    before: {
      value: value(args, 'before-value', 'FILL: value before write'),
      capturedAt: value(args, 'before-captured-at', 'FILL: before screenshot timestamp in ISO format'),
      screenshotPath: value(args, 'before-screenshot', 'FILL: absolute path to before screenshot'),
      liveBidSourceNote: value(args, 'live-bid-source-note', 'FILL: where the live Ads UI bid was read before the manual write'),
    },
    after: {
      value: value(args, 'after-value', 'FILL: value after write'),
      capturedAt: value(args, 'after-captured-at', 'FILL: after screenshot timestamp in ISO format'),
      screenshotPath: value(args, 'after-screenshot', 'FILL: absolute path to after screenshot'),
    },
    readback: {
      verified: false,
      method: 'FILL: Ads UI reload/API/readback method',
      readAt: value(args, 'readback-read-at', 'FILL: readback timestamp in ISO format'),
      actualValue: value(args, 'after-value', 'FILL: must equal after.value'),
      evidencePath: value(args, 'readback-evidence', 'FILL: absolute path to readback screenshot/trace evidence'),
    },
    execution: {
      success: false,
      verified: false,
      executionId: 'FILL: local action log id or Ads operation id',
      executedAt: value(args, 'execution-executed-at', 'FILL: manual execution timestamp in ISO format'),
      channel: 'manual_ads_ui',
      performedBy: value(args, 'executed-by', 'FILL: operator who manually performed the approved Ads UI action'),
      appExecutorUsed: false,
    },
    source: {
      recommendationId: value(args, 'recommendation-id', ''),
      evidencePath: value(args, 'source-evidence', ''),
      entityType: value(args, 'source-entity-type', ''),
      currentValue: value(args, 'source-current-value', ''),
      recommendedValue: value(args, 'source-recommended-value', ''),
    },
    notes: [
      'This template is intentionally NEEDS_WORK and must not pass verify:ad-readback until every FILL field is replaced with real evidence.',
      'Do not include API keys, passwords, cookies, browser profiles, or raw account exports.',
      'Before/after screenshots must be local evidence image files under an allowed evidence/export location.',
    ],
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  fs.mkdirSync(path.dirname(mdOut), { recursive: true });
  fs.writeFileSync(mdOut, buildChecklist(evidence, out), 'utf8');
  console.log(`Ad readback evidence template written: ${out}`);
  console.log(`Ad readback approval checklist written: ${mdOut}`);
  console.log('Status: NEEDS_WORK. Fill real approved execution/readback evidence before running verify:ad-readback.');
}

main();
