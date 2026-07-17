const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isInside(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function collectFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

function hasSpreadsheetExtension(filePath) {
  return ['.xlsx', '.xls', '.csv'].includes(path.extname(filePath).toLowerCase());
}

function unresolved(value) {
  const text = String(value ?? '').trim();
  return text.length === 0 || /<[^>]+>/.test(text);
}

const SESSION_INPUT_FIELD_LABELS = {
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

function captureMissingFields(fields) {
  return fields.map((field) => {
    const meta = SESSION_INPUT_FIELD_LABELS[field] || { label: field, group: '其他' };
    return { field, label: meta.label, group: meta.group };
  });
}

function summarizeCaptureMissing(fields) {
  return fields.map((field) => `${field.group}/${field.label}`).join('、');
}

function unresolvedSessionInputFields(input) {
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
    'readbackActualValue',
    'riskRationale',
  ];
  const missing = required.filter((key) => unresolved(input[key]));
  return missing;
}

function pass(label, details = '') {
  console.log(`[PASS] ${label}${details ? `: ${details}` : ''}`);
}

function fail(label, details = '') {
  console.error(`[FAIL] ${label}${details ? `: ${details}` : ''}`);
  process.exitCode = 1;
}

function requireFile(filePath, label) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(`${label} exists`, filePath || '<missing>');
    return false;
  }
  pass(`${label} exists`, filePath);
  return true;
}

function requireDir(dirPath, label) {
  if (!dirPath || !fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    fail(`${label} exists`, dirPath || '<missing>');
    return false;
  }
  pass(`${label} exists`, dirPath);
  return true;
}

function verifySession(sessionDir) {
  const resolvedSessionDir = path.resolve(sessionDir);
  const pathsFile = path.join(resolvedSessionDir, 'session-paths.json');
  if (!requireDir(resolvedSessionDir, 'session folder')) return;
  if (!requireFile(pathsFile, 'session-paths.json')) return;

  const paths = readJson(pathsFile);
  const sourceCandidatePath = path.resolve(paths.sourceCandidatePath || '');
  const passEvidencePath = path.resolve(paths.passEvidencePath || '');
  requireFile(sourceCandidatePath, 'source candidate JSON');
  if (sourceCandidatePath === passEvidencePath) {
    fail('pass output must not overwrite source candidate', passEvidencePath);
  } else {
    pass('pass output is separate from source candidate', passEvidencePath);
  }
  if (!isInside(passEvidencePath, resolvedSessionDir)) {
    fail('pass output is inside session folder', passEvidencePath);
  } else {
    pass('pass output is inside session folder', passEvidencePath);
  }

  if (fs.existsSync(sourceCandidatePath)) {
    const candidate = readJson(sourceCandidatePath);
    if (candidate.kind === 'real-ad-execution-readback' && candidate.status === 'NEEDS_WORK') {
      pass('source candidate is NEEDS_WORK');
    } else {
      fail('source candidate is NEEDS_WORK', `kind=${candidate.kind || '<missing>'}, status=${candidate.status || '<missing>'}`);
    }
    const target = candidate.target || {};
    if (unresolved(target.entityId)) {
      fail('source candidate target.entityId exists', '<missing>');
    } else {
      pass('source candidate target.entityId exists', String(target.entityId));
    }
    if (unresolved(target.identityProofPath)) {
      fail('target identity proof file exists', '<missing target.identityProofPath>');
    } else {
      requireFile(path.resolve(String(target.identityProofPath).trim()), 'target identity proof file');
    }
  }

  requireDir(paths.approvalsDir, 'approval evidence folder');
  requireDir(paths.beforeScreenshotsDir, 'before screenshot folder');
  requireDir(paths.afterScreenshotsDir, 'after screenshot folder');
  requireDir(paths.readbackScreenshotsDir, 'readback screenshot folder');
  requireFile(path.join(resolvedSessionDir, 'operator-checklist.md'), 'operator checklist');
  requireFile(path.join(resolvedSessionDir, 'ads-ui-locator.md'), 'Ads UI locator guide');
  requireFile(path.join(resolvedSessionDir, 'session-input.json'), 'session input');
  requireFile(path.join(resolvedSessionDir, 'session-input-guide.md'), 'session input guide');
  const fillScriptPath = path.join(resolvedSessionDir, 'fill-ad-readback.ps1');
  if (requireFile(fillScriptPath, 'fill command script')) {
    const command = fs.readFileSync(fillScriptPath, 'utf8');
    if (command.includes('pnpm run fill:ad-readback-session --') && command.includes(paths.sessionDir)) {
      pass('fill command references session folder');
    } else {
      fail('fill command references session folder');
    }
  }

  if (paths.sourceReportsCopied === false) {
    pass('sourceReportsCopied is false');
  } else {
    fail('sourceReportsCopied is false', String(paths.sourceReportsCopied));
  }
  const rawFiles = collectFiles(resolvedSessionDir).filter(hasSpreadsheetExtension);
  if (rawFiles.length === 0) {
    pass('raw report files are not copied into session');
  } else {
    fail('raw report files must not be copied into the session folder', rawFiles.join(', '));
  }

  return resolvedSessionDir;
}

function verifyCaptureInput(sessionDir) {
  const inputPath = path.join(sessionDir, 'session-input.json');
  if (!fs.existsSync(inputPath)) {
    const missing = captureMissingFields(['session-input.json']);
    return {
      captureReady: false,
      unresolvedFields: ['session-input.json'],
      captureMissingFields: missing,
      captureIssues: ['session-input.json not found'],
    };
  }
  const input = readJson(inputPath);
  const unresolvedFields = unresolvedSessionInputFields(input);
  const missing = captureMissingFields(unresolvedFields);
  return {
    captureReady: unresolvedFields.length === 0,
    unresolvedFields,
    captureMissingFields: missing,
    captureIssues: unresolvedFields.length ? [`session-input.json has unresolved fields: ${summarizeCaptureMissing(missing)}`] : [],
  };
}

function main() {
  const sessionDir = process.argv[2];
  if (!sessionDir) {
    throw new Error('Usage: node scripts/verify-ad-readback-session.js <session-dir>');
  }
  const resolvedSessionDir = verifySession(sessionDir);
  if (process.exitCode) {
    console.error('\nSESSION_NEEDS_WORK: Ad readback session packet is not ready for live capture.');
    process.exit(process.exitCode);
  }
  console.log('\nSESSION_STRUCTURE_READY: Ad readback session packet structure is ready for live approval/before/after/readback capture.');
  const capture = verifyCaptureInput(resolvedSessionDir);
  if (capture.captureReady) {
    console.log('CAPTURE_READY: session-input.json has no unresolved live evidence fields.');
  } else {
    console.log(`CAPTURE_NEEDS_WORK: Fill live evidence before generating final readback JSON. Missing: ${summarizeCaptureMissing(capture.captureMissingFields || captureMissingFields(capture.unresolvedFields))}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
