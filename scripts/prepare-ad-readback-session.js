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

function requireArg(args, key) {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required --${key}`);
  }
  return value.trim();
}

function safeSegment(value) {
  return String(value || 'ad-readback-session')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'ad-readback-session';
}

function psQuote(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function markdownEscape(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function unresolved(value) {
  const text = String(value ?? '').trim();
  return text.length === 0 || /<[^>]+>/.test(text);
}

function isFile(filePath) {
  return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function buildFillCommand(paths, candidate) {
  const riskRationale = candidate.risk?.rationale || '一次已审批的低风险 Ads UI 人工动作，具备 before/after/readback 证据。';
  const entityType = candidate.target?.entityType || '广告对象';
  return [
    'pnpm run fill:ad-readback --',
    `--source ${psQuote(paths.sourceCandidatePath)}`,
    `--out ${psQuote(paths.passEvidencePath)}`,
    '--approver-name "<approver>"',
    `--approval-artifact ${psQuote(path.join(paths.approvalsDir, '<approval-proof.png-or-ticket.txt>'))}`,
    '--approval-confirmed-at "<ISO time>"',
    '--before-value "<live before bid>"',
    '--before-captured-at "<ISO time>"',
    `--before-screenshot ${psQuote(path.join(paths.beforeScreenshotsDir, '<before.png>'))}`,
    `--live-bid-source-note "人工执行前从 Ads UI 可编辑${entityType}出价行读取 live bid。"`,
    '--after-value "<live after bid>"',
    '--after-captured-at "<ISO time>"',
    `--after-screenshot ${psQuote(path.join(paths.afterScreenshotsDir, '<after.png>'))}`,
    '--executed-at "<ISO time>"',
    '--executed-by "<operator>"',
    '--execution-id "<manual action id>"',
    '--readback-read-at "<ISO time>"',
    `--readback-evidence ${psQuote(path.join(paths.readbackScreenshotsDir, '<readback.png>'))}`,
    '--readback-actual-value "<independently observed reload value>"',
    `--risk-rationale ${psQuote(riskRationale)}`,
  ].join(' ');
}

function buildPowerShell(paths, candidate) {
  return [
    '# 在完成人工 Ads UI 审批、before/after 截图和刷新回读后再运行。',
    '# 先填写 session-input.json，再运行本文件。',
    '# 本命令会生成独立的 PASS-intended JSON；最终仍必须通过 verify:ad-readback。',
    '',
    `pnpm run fill:ad-readback-session -- --session ${psQuote(paths.sessionDir)}`,
    '',
  ].join('\r\n');
}

function sourceFiles(candidate) {
  return Array.isArray(candidate.source?.sourceFiles)
    ? candidate.source.sourceFiles.map((item) => String(item)).filter(Boolean)
    : [];
}

function buildChecklist(candidate, paths) {
  const target = candidate.target || {};
  const source = candidate.source || {};
  return `# 真实广告回读工作包

这个目录只是一条人工 Ads UI 回读动作的工作区，不是最终完成证据。只有生成的 PASS JSON 通过 \`verify:ad-readback\` 后，才能进入最终验收。

## 执行对象

| 字段 | 值 |
| --- | --- |
| 候选 JSON | \`${markdownEscape(paths.sourceCandidatePath)}\` |
| PASS 输出 JSON | \`${markdownEscape(paths.passEvidencePath)}\` |
| 店铺 | ${markdownEscape(target.storeName || '')} |
| 站点 | ${markdownEscape(target.marketplaceCode || '')} |
| 广告组合 | ${markdownEscape(target.portfolioName || '')} |
| ASIN | ${markdownEscape(target.asin || '')} |
| 广告活动 | ${markdownEscape(target.campaignName || '')} |
| 广告组 | ${markdownEscape(target.adGroupName || '')} |
| 对象类型 | ${markdownEscape(target.entityType || '')} |
| 对象 ID | ${markdownEscape(target.entityId || '')} |
| 对象名称 | ${markdownEscape(target.entityName || '')} |
| 对象身份证明 | ${markdownEscape(target.identityProofPath || '')} |
| 动作类型 | ${markdownEscape(target.actionType || '')} |
| 建议来源当前值 | ${markdownEscape(source.currentValue || '')} |
| 建议来源推荐值 | ${markdownEscape(source.recommendedValue || '')} |
| 来源报表行号 | ${markdownEscape(source.sourceRow || '')} |
| 来源报表文件 | ${markdownEscape(sourceFiles(candidate).join(', '))} |

注意：建议来源值不是 Ads UI 实时值。before 和 after 必须从当前 Ads UI 可编辑行现场读取。

## 证据保存位置

| 证据 | 目录 |
| --- | --- |
| 审批凭证 | \`${markdownEscape(paths.approvalsDir)}\` |
| before 截图 | \`${markdownEscape(paths.beforeScreenshotsDir)}\` |
| after 截图 | \`${markdownEscape(paths.afterScreenshotsDir)}\` |
| 刷新回读截图 | \`${markdownEscape(paths.readbackScreenshotsDir)}\` |

## 必须按顺序完成

1. 与审批人确认本次只处理这一条 campaign、ad group、ASIN、对象和动作。
2. 将审批截图、工单或聊天记录保存到 \`approvals\`。
3. 在 Ads UI 执行前截图，并记录现场 live bid。
4. 只执行一次已审批的人工 Ads UI 动作。
5. 执行后截图，并记录新的 live bid。
6. 刷新或重新打开 Ads UI 行，单独截图证明回读值。
7. 填写 \`session-input.json\`，再运行 \`fill-ad-readback.ps1\`。
8. 只有 PASS 输出 JSON 通过 \`verify:ad-readback\` 后，才能用于最终验收。

## 需要填写的文件

完成审批、截图和回读后填写这个文件：

\`${markdownEscape(path.join(paths.sessionDir, 'session-input.json'))}\`

## 生成回读证据命令

\`\`\`powershell
pnpm run fill:ad-readback-session -- --session ${psQuote(paths.sessionDir)}
\`\`\`

## PASS 后的最终验收命令

\`\`\`powershell
pnpm run verify:ad-readback -- ${paths.passEvidencePath}
pnpm run write:v15-evidence-manifest -- --ad-readback ${paths.passEvidencePath} --out output\\codex-evidence\\v15-final-readiness-evidence-manifest-2026-06-17.json
pnpm run verify:v15-final-readiness -- --evidence-manifest output\\codex-evidence\\v15-final-readiness-evidence-manifest-2026-06-17.json --out output\\codex-evidence\\final-readiness-2026-06-17.json
\`\`\`
`;
}

function buildLocatorGuide(candidate, paths) {
  const target = candidate.target || {};
  const source = candidate.source || {};
  return `# Ads UI 定位单

这个文件用于人工进入 Amazon Ads UI 时定位同一条对象。不要根据建议来源值直接填写 before/after；before 和 after 必须从 Ads UI 现场读取。

## 必须匹配的对象

| 字段 | 值 |
| --- | --- |
| 店铺 | ${markdownEscape(target.storeName || '')} |
| 站点 | ${markdownEscape(target.marketplaceCode || '')} |
| ASIN | ${markdownEscape(target.asin || '')} |
| 广告组合 | ${markdownEscape(target.portfolioName || '')} |
| 广告活动 | ${markdownEscape(target.campaignName || '')} |
| 广告组 | ${markdownEscape(target.adGroupName || '')} |
| 对象类型 | ${markdownEscape(target.entityType || '')} |
| 对象 ID | ${markdownEscape(target.entityId || '')} |
| 对象名称 | ${markdownEscape(target.entityName || '')} |
| 对象身份证明 | ${markdownEscape(target.identityProofPath || '')} |
| 动作 | ${markdownEscape(target.actionType || '')} |
| 建议来源当前值 | ${markdownEscape(source.currentValue || '')} |
| 建议来源推荐值 | ${markdownEscape(source.recommendedValue || '')} |
| 来源报表行号 | ${markdownEscape(source.sourceRow || '')} |
| 来源证据 | ${markdownEscape(source.evidencePath || '')} |

## 现场核对

1. 进入 Ads UI 后先按广告活动和广告组定位。
2. 在投放对象、关键词、搜索词或 target 列中找到对象名称。
3. 截图前确认行内 ASIN、campaign、ad group、对象名称与本定位单一致。
4. 如果 Ads UI 上找不到同一对象、对象不可编辑、对象值已变化无法解释，停止执行，不要写入。
5. before、after、readback 三张截图不能复用同一个文件。

## 本工作包路径

| 文件 | 路径 |
| --- | --- |
| 工作包目录 | \`${markdownEscape(paths.sessionDir)}\` |
| session-input.json | \`${markdownEscape(path.join(paths.sessionDir, 'session-input.json'))}\` |
| 操作清单 | \`${markdownEscape(path.join(paths.sessionDir, 'operator-checklist.md'))}\` |
| PASS 输出 JSON | \`${markdownEscape(paths.passEvidencePath)}\` |
`;
}

function buildSessionInput(paths, candidate) {
  const entityType = candidate.target?.entityType || '广告对象';
  return {
    approverName: '',
    approvalArtifactPath: path.join(paths.approvalsDir, '<approval-proof.png-or-ticket.txt>'),
    approvalConfirmedAt: '',
    beforeValue: '',
    beforeCapturedAt: '',
    beforeScreenshotPath: path.join(paths.beforeScreenshotsDir, '<before.png>'),
    liveBidSourceNote: `人工执行前从 Ads UI 可编辑${entityType}出价行读取 live bid。`,
    afterValue: '',
    afterCapturedAt: '',
    afterScreenshotPath: path.join(paths.afterScreenshotsDir, '<after.png>'),
    executedAt: '',
    executedBy: '',
    executionId: '',
    readbackReadAt: '',
    readbackEvidencePath: path.join(paths.readbackScreenshotsDir, '<readback.png>'),
    readbackActualValue: '',
    riskRationale: candidate.risk?.rationale || '一次已审批的低风险 Ads UI 人工动作，具备 before/after/readback 证据。',
  };
}

function buildSessionInputGuide(candidate, paths) {
  const target = candidate.target || {};
  const source = candidate.source || {};
  const rows = [
    ['approverName', '审批/审批人', '审批人或负责人姓名', 'Ops Lead'],
    ['approvalArtifactPath', '审批/审批凭证文件', `保存到 ${paths.approvalsDir}`, path.join(paths.approvalsDir, 'approval.png')],
    ['approvalConfirmedAt', '审批/审批确认时间', 'ISO 时间，必须早于执行时间', '2026-06-18T10:00:00.000Z'],
    ['beforeValue', '执行前/执行前 Ads UI live bid', '人工操作前从 Ads UI 当前行读取，不使用建议来源值', '1.20'],
    ['beforeCapturedAt', '执行前/执行前截图时间', 'before 截图时间，必须早于执行时间', '2026-06-18T10:01:00.000Z'],
    ['beforeScreenshotPath', '执行前/执行前截图文件', `保存到 ${paths.beforeScreenshotsDir}`, path.join(paths.beforeScreenshotsDir, 'before.png')],
    ['afterValue', '执行后/执行后 Ads UI live bid', '人工操作后从 Ads UI 当前行读取', '1.08'],
    ['afterCapturedAt', '执行后/执行后截图时间', 'after 截图时间，必须晚于执行时间', '2026-06-18T10:03:00.000Z'],
    ['afterScreenshotPath', '执行后/执行后截图文件', `保存到 ${paths.afterScreenshotsDir}`, path.join(paths.afterScreenshotsDir, 'after.png')],
    ['executedAt', '执行记录/人工执行时间', '实际点击保存或完成 Ads UI 操作的时间', '2026-06-18T10:02:00.000Z'],
    ['executedBy', '执行记录/执行人', '实际操作 Ads UI 的人员', 'Operator A'],
    ['executionId', '执行记录/执行编号或记录 ID', '工单、聊天记录编号或人工动作编号', 'manual-action-001'],
    ['readbackReadAt', '回读/刷新回读时间', '刷新或重新打开 Ads UI 后读取值的时间', '2026-06-18T10:05:00.000Z'],
    ['readbackEvidencePath', '回读/刷新回读截图文件', `保存到 ${paths.readbackScreenshotsDir}`, path.join(paths.readbackScreenshotsDir, 'readback.png')],
    ['readbackActualValue', '回读/刷新回读实际值', '必须从刷新后的 Ads UI 独立读取；校验时应等于 afterValue', '1.08'],
    ['riskRationale', '风控/低风险执行说明', '说明为什么本次动作低风险、可回滚、已审批', '一次已审批的低风险 Ads UI 人工动作，具备 before/after/readback 证据。'],
  ];
  return `# session-input.json 填写指南

这个文件解释如何填写同目录下的 \`session-input.json\`。结构检查通过不代表最终验收通过；只有真实审批、before、after、执行记录和刷新回读证据完整后，才能生成 PASS JSON。

## 当前动作

| 字段 | 值 |
| --- | --- |
| 店铺 | ${markdownEscape(target.storeName || '')} |
| 站点 | ${markdownEscape(target.marketplaceCode || '')} |
| ASIN | ${markdownEscape(target.asin || '')} |
| 广告组合 | ${markdownEscape(target.portfolioName || '')} |
| 广告活动 | ${markdownEscape(target.campaignName || '')} |
| 广告组 | ${markdownEscape(target.adGroupName || '')} |
| 对象类型 | ${markdownEscape(target.entityType || '')} |
| 对象 ID | ${markdownEscape(target.entityId || '')} |
| 对象名称 | ${markdownEscape(target.entityName || '')} |
| 对象身份证明 | ${markdownEscape(target.identityProofPath || '')} |
| 动作 | ${markdownEscape(target.actionType || '')} |
| 来源当前值 | ${markdownEscape(source.currentValue || '')} |
| 来源建议值 | ${markdownEscape(source.recommendedValue || '')} |
| 来源报表行号 | ${markdownEscape(source.sourceRow || '')} |
| 来源报表文件 | ${markdownEscape(sourceFiles(candidate).join(', '))} |

## 填写字段

| JSON 字段 | 业务含义 | 从哪里取 | 示例 |
| --- | --- | --- | --- |
${rows.map((row) => `| ${row.map(markdownEscape).join(' | ')} |`).join('\n')}

## 顺序要求

1. 先保存审批凭证，再截图 before。
2. 执行人工 Ads UI 动作，只处理定位单里的同一条对象。
3. 保存 after 截图。
4. 刷新或重新打开 Ads UI 行，保存 readback 截图。
5. 填完 \`session-input.json\` 后运行 \`fill-ad-readback.ps1\`。

## 停止条件

- Ads UI 找不到定位单里的 campaign、ad group 或对象。
- 当前行不可编辑，或对象已经不是同一个。
- before、after、readback 想复用同一张截图。
- after 值没有变化，且无法解释。
- 没有审批凭证或审批范围不能覆盖本次动作。
`;
}

function main() {
  const args = parseArgs(process.argv);
  const sourceCandidatePath = path.resolve(requireArg(args, 'source'));
  if (!fs.existsSync(sourceCandidatePath)) {
    throw new Error(`Candidate JSON not found: ${sourceCandidatePath}`);
  }
  const candidate = readJson(sourceCandidatePath);
  if (candidate.kind !== 'real-ad-execution-readback') {
    throw new Error(`Unsupported candidate kind: ${candidate.kind}`);
  }
  if (candidate.status !== 'NEEDS_WORK') {
    throw new Error('prepare:ad-readback-session only prepares NEEDS_WORK candidates.');
  }

  const target = candidate.target || {};
  if (unresolved(target.entityId)) {
    throw new Error('Candidate target.entityId is required before preparing a readback session.');
  }
  if (unresolved(target.identityProofPath)) {
    throw new Error('Candidate target.identityProofPath is required before preparing a readback session.');
  }
  const identityProofPath = path.resolve(String(target.identityProofPath).trim());
  if (!isFile(identityProofPath)) {
    throw new Error(`Candidate target identity proof file does not exist: ${identityProofPath}`);
  }
  const defaultName = [
    'ad-readback-session',
    target.storeName,
    target.marketplaceCode,
    target.actionType,
    target.entityName,
    Date.now(),
  ].filter(Boolean).map(safeSegment).join('-');
  const outDir = path.resolve(args.out || path.join(evidenceDir, defaultName));
  const paths = {
    sourceCandidatePath,
    sessionDir: outDir,
    passEvidencePath: path.join(outDir, 'real-ad-execution-readback-pass.json'),
    approvalsDir: path.join(outDir, 'approvals'),
    beforeScreenshotsDir: path.join(outDir, 'screenshots', 'before'),
    afterScreenshotsDir: path.join(outDir, 'screenshots', 'after'),
    readbackScreenshotsDir: path.join(outDir, 'screenshots', 'readback'),
    locatorGuidePath: path.join(outDir, 'ads-ui-locator.md'),
    sessionInputGuidePath: path.join(outDir, 'session-input-guide.md'),
    sourceReports: sourceFiles(candidate),
    sourceReportsCopied: false,
  };

  ensureDir(outDir);
  ensureDir(paths.approvalsDir);
  ensureDir(paths.beforeScreenshotsDir);
  ensureDir(paths.afterScreenshotsDir);
  ensureDir(paths.readbackScreenshotsDir);
  fs.writeFileSync(path.join(outDir, 'session-paths.json'), `${JSON.stringify(paths, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outDir, 'session-input.json'), `${JSON.stringify(buildSessionInput(paths, candidate), null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outDir, 'operator-checklist.md'), buildChecklist(candidate, paths), 'utf8');
  fs.writeFileSync(paths.locatorGuidePath, buildLocatorGuide(candidate, paths), 'utf8');
  fs.writeFileSync(paths.sessionInputGuidePath, buildSessionInputGuide(candidate, paths), 'utf8');
  fs.writeFileSync(path.join(outDir, 'fill-ad-readback.ps1'), buildPowerShell(paths, candidate), 'utf8');

  console.log(`Ad readback session packet written: ${outDir}`);
  console.log(`Checklist: ${path.join(outDir, 'operator-checklist.md')}`);
  console.log(`Ads UI locator: ${paths.locatorGuidePath}`);
  console.log(`Session input guide: ${paths.sessionInputGuidePath}`);
  console.log(`Fill command: ${path.join(outDir, 'fill-ad-readback.ps1')}`);
  console.log('Status: NEEDS_WORK. Capture real Ads UI approval/before/after/readback before running fill-ad-readback.');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
