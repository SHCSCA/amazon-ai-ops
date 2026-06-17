import * as fs from 'fs';
import * as path from 'path';
import { adReadbackEvidenceToMarkdown, buildAdReadbackEvidence } from './ad-readback-evidence';

type ReadbackCandidate = Record<string, any>;

export interface PrepareAdReadbackSessionInput {
  sourcePath: string;
  outDir?: string;
}

export interface PreparedAdReadbackSession {
  sessionDir: string;
  sourceCandidatePath: string;
  passEvidencePath: string;
  approvalsDir: string;
  beforeScreenshotsDir: string;
  afterScreenshotsDir: string;
  readbackScreenshotsDir: string;
  checklistPath: string;
  locatorGuidePath: string;
  sessionInputPath: string;
  sessionInputGuidePath: string;
  fillScriptPath: string;
  sourceReportsCopied: false;
}

export interface ReadbackCaptureMissingField {
  field: string;
  label: string;
  group: string;
}

export interface VerifiedAdReadbackSession {
  sessionDir: string;
  ready: boolean;
  captureReady: boolean;
  checks: Array<{ label: string; passed: boolean; details?: string }>;
  issues: string[];
  unresolvedFields: string[];
  captureMissingFields: ReadbackCaptureMissingField[];
  captureIssues: string[];
}

export interface FilledAdReadbackSession {
  sessionDir: string;
  jsonPath: string;
  markdownPath: string;
  status: string;
  readyForVerifier: boolean;
  issues: string[];
}

function readJson(filePath: string): ReadbackCandidate {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dirPath: string): string {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function psQuote(value: string): string {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function markdownEscape(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|');
}

function sourceFiles(candidate: ReadbackCandidate): string[] {
  return Array.isArray(candidate.source?.sourceFiles)
    ? candidate.source.sourceFiles.map((item: unknown) => String(item)).filter(Boolean)
    : [];
}

function defaultSessionDir(sourcePath: string): string {
  return path.resolve(sourcePath).replace(/\.json$/i, '-session');
}

function isInside(childPath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function collectFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const filePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

function hasSpreadsheetExtension(filePath: string): boolean {
  return ['.xlsx', '.xls', '.csv'].includes(path.extname(filePath).toLowerCase());
}

function unresolved(value: unknown): boolean {
  const text = String(value ?? '').trim();
  return text.length === 0 || /<[^>]+>/.test(text);
}

function isFile(filePath: string): boolean {
  return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
}

function isDirectory(dirPath: string): boolean {
  return Boolean(dirPath && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory());
}

const SESSION_INPUT_FIELD_LABELS: Record<string, { label: string; group: string }> = {
  approverName: { label: '审批人', group: '审批' },
  approvalArtifactPath: { label: '审批凭证文件', group: '审批' },
  approvalConfirmedAt: { label: '审批确认时间', group: '审批' },
  beforeValue: { label: '执行前 Ads UI live bid', group: '执行前' },
  beforeCapturedAt: { label: '执行前截图时间', group: '执行前' },
  beforeScreenshotPath: { label: '执行前截图文件', group: '执行前' },
  liveBidSourceNote: { label: '执行前现场值来源说明', group: '执行前' },
  afterValue: { label: '执行后 Ads UI live bid', group: '执行后' },
  afterCapturedAt: { label: '执行后截图时间', group: '执行后' },
  afterScreenshotPath: { label: '执行后截图文件', group: '执行后' },
  executedAt: { label: '人工执行时间', group: '执行记录' },
  executedBy: { label: '执行人', group: '执行记录' },
  executionId: { label: '执行编号或记录 ID', group: '执行记录' },
  readbackReadAt: { label: '刷新回读时间', group: '回读' },
  readbackEvidencePath: { label: '刷新回读截图文件', group: '回读' },
  readbackActualValue: { label: '刷新回读实际值', group: '回读' },
  riskRationale: { label: '低风险执行说明', group: '风控' },
  'session-input.json': { label: 'session-input.json 文件', group: '工作包' },
};

function captureMissingFields(fields: string[]): ReadbackCaptureMissingField[] {
  return fields.map((field) => {
    const meta = SESSION_INPUT_FIELD_LABELS[field] || { label: field, group: '其他' };
    return { field, label: meta.label, group: meta.group };
  });
}

function summarizeCaptureMissing(fields: ReadbackCaptureMissingField[]): string {
  return fields.map((field) => `${field.group}/${field.label}`).join('、');
}

function buildPowerShell(paths: PreparedAdReadbackSession): string {
  return [
    '# 在完成人工 Ads UI 审批、before/after 截图和刷新回读后再运行。',
    '# 先填写 session-input.json，再运行本文件。',
    '# 本命令会生成独立的 PASS-intended JSON；最终仍必须通过 verify:ad-readback。',
    '',
    `pnpm run fill:ad-readback-session -- --session ${psQuote(paths.sessionDir)}`,
    '',
  ].join('\r\n');
}

function buildSessionInput(paths: PreparedAdReadbackSession, candidate: ReadbackCandidate): Record<string, string> {
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

function buildSessionInputGuide(candidate: ReadbackCandidate, paths: PreparedAdReadbackSession): string {
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
    ['readbackActualValue', '回读/刷新回读实际值', '刷新后看到的实际值；通常应等于 afterValue', '1.08'],
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
| 对象名称 | ${markdownEscape(target.entityName || '')} |
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

function buildChecklist(candidate: ReadbackCandidate, paths: PreparedAdReadbackSession): string {
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
| 对象名称 | ${markdownEscape(target.entityName || '')} |
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
`;
}

function buildLocatorGuide(candidate: ReadbackCandidate, paths: PreparedAdReadbackSession): string {
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
| 对象名称 | ${markdownEscape(target.entityName || '')} |
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
| session-input.json | \`${markdownEscape(paths.sessionInputPath)}\` |
| 操作清单 | \`${markdownEscape(paths.checklistPath)}\` |
| PASS 输出 JSON | \`${markdownEscape(paths.passEvidencePath)}\` |
`;
}

export function prepareAdReadbackSession(input: PrepareAdReadbackSessionInput): PreparedAdReadbackSession {
  const sourceCandidatePath = path.resolve(input.sourcePath || '');
  if (!sourceCandidatePath || !fs.existsSync(sourceCandidatePath)) {
    throw new Error(`Candidate JSON not found: ${sourceCandidatePath || '<missing>'}`);
  }
  const candidate = readJson(sourceCandidatePath);
  if (candidate.kind !== 'real-ad-execution-readback') {
    throw new Error(`Unsupported candidate kind: ${candidate.kind || '<missing>'}`);
  }
  if (candidate.status !== 'NEEDS_WORK') {
    throw new Error('prepareAdReadbackSession only prepares NEEDS_WORK candidates.');
  }

  const sessionDir = path.resolve(input.outDir || defaultSessionDir(sourceCandidatePath));
  const result: PreparedAdReadbackSession = {
    sessionDir,
    sourceCandidatePath,
    passEvidencePath: path.join(sessionDir, 'real-ad-execution-readback-pass.json'),
    approvalsDir: path.join(sessionDir, 'approvals'),
    beforeScreenshotsDir: path.join(sessionDir, 'screenshots', 'before'),
    afterScreenshotsDir: path.join(sessionDir, 'screenshots', 'after'),
    readbackScreenshotsDir: path.join(sessionDir, 'screenshots', 'readback'),
    checklistPath: path.join(sessionDir, 'operator-checklist.md'),
    locatorGuidePath: path.join(sessionDir, 'ads-ui-locator.md'),
    sessionInputPath: path.join(sessionDir, 'session-input.json'),
    sessionInputGuidePath: path.join(sessionDir, 'session-input-guide.md'),
    fillScriptPath: path.join(sessionDir, 'fill-ad-readback.ps1'),
    sourceReportsCopied: false,
  };

  ensureDir(result.sessionDir);
  ensureDir(result.approvalsDir);
  ensureDir(result.beforeScreenshotsDir);
  ensureDir(result.afterScreenshotsDir);
  ensureDir(result.readbackScreenshotsDir);

  const pathsFile = path.join(result.sessionDir, 'session-paths.json');
  fs.writeFileSync(pathsFile, `${JSON.stringify({
    sourceCandidatePath: result.sourceCandidatePath,
    sessionDir: result.sessionDir,
    passEvidencePath: result.passEvidencePath,
    approvalsDir: result.approvalsDir,
    beforeScreenshotsDir: result.beforeScreenshotsDir,
    afterScreenshotsDir: result.afterScreenshotsDir,
    readbackScreenshotsDir: result.readbackScreenshotsDir,
    locatorGuidePath: result.locatorGuidePath,
    sessionInputGuidePath: result.sessionInputGuidePath,
    sourceReports: sourceFiles(candidate),
    sourceReportsCopied: false,
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(result.sessionInputPath, `${JSON.stringify(buildSessionInput(result, candidate), null, 2)}\n`, 'utf8');
  fs.writeFileSync(result.checklistPath, buildChecklist(candidate, result), 'utf8');
  fs.writeFileSync(result.locatorGuidePath, buildLocatorGuide(candidate, result), 'utf8');
  fs.writeFileSync(result.sessionInputGuidePath, buildSessionInputGuide(candidate, result), 'utf8');
  fs.writeFileSync(result.fillScriptPath, buildPowerShell(result), 'utf8');

  return result;
}

function requireResolvedSessionInput(input: Record<string, any>): string[] {
  const required = [
    'approverName',
    'approvalArtifactPath',
    'approvalConfirmedAt',
    'beforeValue',
    'beforeCapturedAt',
    'beforeScreenshotPath',
    'liveBidSourceNote',
    'afterValue',
    'afterCapturedAt',
    'afterScreenshotPath',
    'executedAt',
    'executedBy',
    'executionId',
    'readbackReadAt',
    'readbackEvidencePath',
    'riskRationale',
  ];
  const missing = required.filter((key) => unresolved(input[key]));
  if (input.readbackActualValue && /<[^>]+>/.test(String(input.readbackActualValue))) {
    missing.push('readbackActualValue');
  }
  return missing;
}

function inspectSessionCaptureInput(sessionDir: string): { captureReady: boolean; unresolvedFields: string[]; captureMissingFields: ReadbackCaptureMissingField[]; captureIssues: string[] } {
  const inputPath = path.join(sessionDir, 'session-input.json');
  if (!isFile(inputPath)) {
    const missing = captureMissingFields(['session-input.json']);
    return {
      captureReady: false,
      unresolvedFields: ['session-input.json'],
      captureMissingFields: missing,
      captureIssues: ['session-input.json 不存在，尚未能判断现场证据填写状态。'],
    };
  }

  try {
    const input = readJson(inputPath);
    const unresolvedFields = requireResolvedSessionInput(input);
    const missing = captureMissingFields(unresolvedFields);
    return {
      captureReady: unresolvedFields.length === 0,
      unresolvedFields,
      captureMissingFields: missing,
      captureIssues: unresolvedFields.length === 0
        ? []
        : [`session-input.json 仍有未填写项：${summarizeCaptureMissing(missing)}`],
    };
  } catch (error) {
    const missing = captureMissingFields(['session-input.json']);
    return {
      captureReady: false,
      unresolvedFields: ['session-input.json'],
      captureMissingFields: missing,
      captureIssues: [`session-input.json 不是可读取 JSON：${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

export function fillAdReadbackSession(sessionDir: string): FilledAdReadbackSession {
  const verification = verifyAdReadbackSession(sessionDir);
  if (!verification.ready) {
    return {
      sessionDir: verification.sessionDir,
      jsonPath: '',
      markdownPath: '',
      status: 'NEEDS_WORK',
      readyForVerifier: false,
      issues: verification.issues,
    };
  }

  const paths = readJson(path.join(verification.sessionDir, 'session-paths.json'));
  const input = readJson(path.join(verification.sessionDir, 'session-input.json'));
  const unresolvedFields = requireResolvedSessionInput(input);
  if (unresolvedFields.length > 0) {
    return {
      sessionDir: verification.sessionDir,
      jsonPath: String(paths.passEvidencePath || ''),
      markdownPath: String(paths.passEvidencePath || '').replace(/\.json$/i, '.md'),
      status: 'NEEDS_WORK',
      readyForVerifier: false,
      issues: [`session-input.json has unresolved fields: ${unresolvedFields.join(', ')}`],
    };
  }

  const candidate = readJson(String(paths.sourceCandidatePath || ''));
  const afterValue = String(input.afterValue || '');
  const evidence = buildAdReadbackEvidence({
    target: candidate.target || {},
    source: candidate.source || {},
    approval: {
      ...(candidate.approval || {}),
      operatorConfirmed: true,
      realWriteApproved: true,
      confirmedAt: input.approvalConfirmedAt,
      approverName: input.approverName,
      approvalArtifactPath: input.approvalArtifactPath,
    },
    risk: {
      ...(candidate.risk || {}),
      allowedByPolicy: true,
      rationale: input.riskRationale,
    },
    before: {
      ...(candidate.before || {}),
      value: input.beforeValue,
      capturedAt: input.beforeCapturedAt,
      screenshotPath: input.beforeScreenshotPath,
      liveBidSourceNote: input.liveBidSourceNote,
    },
    after: {
      ...(candidate.after || {}),
      value: afterValue,
      capturedAt: input.afterCapturedAt,
      screenshotPath: input.afterScreenshotPath,
    },
    readback: {
      ...(candidate.readback || {}),
      verified: true,
      method: 'Ads UI reload target row',
      readAt: input.readbackReadAt,
      actualValue: input.readbackActualValue || afterValue,
      evidencePath: input.readbackEvidencePath,
    },
    execution: {
      ...(candidate.execution || {}),
      success: true,
      verified: true,
      executionId: input.executionId,
      executedAt: input.executedAt,
      channel: 'manual_ads_ui',
      executedBy: input.executedBy,
      appExecutorUsed: false,
    },
  });

  const jsonPath = path.resolve(String(paths.passEvidencePath || path.join(verification.sessionDir, 'real-ad-execution-readback-pass.json')));
  const markdownPath = jsonPath.replace(/\.json$/i, '.md');
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, adReadbackEvidenceToMarkdown(evidence, jsonPath), 'utf8');

  return {
    sessionDir: verification.sessionDir,
    jsonPath,
    markdownPath,
    status: String(evidence.status || 'NEEDS_WORK'),
    readyForVerifier: evidence.status === 'PASS',
    issues: evidence.status === 'PASS' ? [] : ['Generated readback evidence is still NEEDS_WORK; check image files, values, timestamps, source files, and approval fields.'],
  };
}

export function verifyAdReadbackSession(sessionDir: string): VerifiedAdReadbackSession {
  const resolvedSessionDir = path.resolve(sessionDir || '');
  const checks: VerifiedAdReadbackSession['checks'] = [];
  const addCheck = (label: string, passed: boolean, details?: string) => {
    checks.push({ label, passed, details });
  };

  addCheck('session folder exists', isDirectory(resolvedSessionDir), resolvedSessionDir);
  const pathsFile = path.join(resolvedSessionDir, 'session-paths.json');
  addCheck('session-paths.json exists', isFile(pathsFile), pathsFile);

  let paths: Record<string, any> = {};
  if (isFile(pathsFile)) {
    try {
      paths = readJson(pathsFile);
    } catch (error) {
      addCheck('session-paths.json is readable JSON', false, error instanceof Error ? error.message : String(error));
    }
  }

  const sourceCandidatePath = path.resolve(String(paths.sourceCandidatePath || ''));
  const passEvidencePath = path.resolve(String(paths.passEvidencePath || ''));
  addCheck('source candidate JSON exists', isFile(sourceCandidatePath), sourceCandidatePath);
  addCheck('pass output is separate from source candidate', Boolean(passEvidencePath && sourceCandidatePath !== passEvidencePath), passEvidencePath);
  addCheck('pass output is inside session folder', Boolean(passEvidencePath && isInside(passEvidencePath, resolvedSessionDir)), passEvidencePath);

  if (isFile(sourceCandidatePath)) {
    try {
      const candidate = readJson(sourceCandidatePath);
      addCheck(
        'source candidate is NEEDS_WORK',
        candidate.kind === 'real-ad-execution-readback' && candidate.status === 'NEEDS_WORK',
        `kind=${candidate.kind || '<missing>'}, status=${candidate.status || '<missing>'}`,
      );
    } catch (error) {
      addCheck('source candidate JSON is readable', false, error instanceof Error ? error.message : String(error));
    }
  }

  addCheck('approval evidence folder exists', isDirectory(String(paths.approvalsDir || '')), String(paths.approvalsDir || ''));
  addCheck('before screenshot folder exists', isDirectory(String(paths.beforeScreenshotsDir || '')), String(paths.beforeScreenshotsDir || ''));
  addCheck('after screenshot folder exists', isDirectory(String(paths.afterScreenshotsDir || '')), String(paths.afterScreenshotsDir || ''));
  addCheck('readback screenshot folder exists', isDirectory(String(paths.readbackScreenshotsDir || '')), String(paths.readbackScreenshotsDir || ''));
  addCheck('operator checklist exists', isFile(path.join(resolvedSessionDir, 'operator-checklist.md')), path.join(resolvedSessionDir, 'operator-checklist.md'));
  addCheck('Ads UI locator guide exists', isFile(path.join(resolvedSessionDir, 'ads-ui-locator.md')), path.join(resolvedSessionDir, 'ads-ui-locator.md'));
  addCheck('session input exists', isFile(path.join(resolvedSessionDir, 'session-input.json')), path.join(resolvedSessionDir, 'session-input.json'));
  addCheck('session input guide exists', isFile(path.join(resolvedSessionDir, 'session-input-guide.md')), path.join(resolvedSessionDir, 'session-input-guide.md'));

  const fillScriptPath = path.join(resolvedSessionDir, 'fill-ad-readback.ps1');
  const fillScriptExists = isFile(fillScriptPath);
  addCheck('fill command script exists', fillScriptExists, fillScriptPath);
  if (fillScriptExists) {
    const command = fs.readFileSync(fillScriptPath, 'utf8');
    addCheck('fill command references session folder', command.includes('pnpm run fill:ad-readback-session --') && command.includes(String(paths.sessionDir || '')));
  }

  addCheck('sourceReportsCopied is false', paths.sourceReportsCopied === false, String(paths.sourceReportsCopied));
  const rawFiles = collectFiles(resolvedSessionDir).filter(hasSpreadsheetExtension);
  addCheck('raw report files are not copied into session', rawFiles.length === 0, rawFiles.join(', '));

  const issues = checks.filter((check) => !check.passed).map((check) => check.details ? `${check.label}: ${check.details}` : check.label);
  const capture = inspectSessionCaptureInput(resolvedSessionDir);
  return {
    sessionDir: resolvedSessionDir,
    ready: issues.length === 0,
    captureReady: issues.length === 0 && capture.captureReady,
    checks,
    issues,
    unresolvedFields: capture.unresolvedFields,
    captureMissingFields: capture.captureMissingFields,
    captureIssues: capture.captureIssues,
  };
}
