const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function unresolved(value) {
  const text = String(value ?? '').trim();
  return text.length === 0 || /<[^>]+>/.test(text);
}

function validateInput(input) {
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
  if (missing.length > 0) {
    throw new Error(`session-input.json has unresolved fields: ${missing.join(', ')}`);
  }
}

function pushArg(argv, key, value) {
  if (value === undefined || value === null || String(value).trim().length === 0) return;
  argv.push(key, String(value));
}

function runFill(argv) {
  return spawnSync(process.execPath, [
    path.join(__dirname, 'fill-ad-readback-evidence.js'),
    ...argv,
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
}

function main() {
  const args = parseArgs(process.argv);
  const sessionDir = path.resolve(requireArg(args, 'session'));
  const pathsFile = path.join(sessionDir, 'session-paths.json');
  const inputFile = path.join(sessionDir, 'session-input.json');
  if (!fs.existsSync(pathsFile)) throw new Error(`session-paths.json not found: ${pathsFile}`);
  if (!fs.existsSync(inputFile)) throw new Error(`session-input.json not found: ${inputFile}`);

  const paths = readJson(pathsFile);
  const input = readJson(inputFile);
  validateInput(input);

  const fillArgs = [];
  pushArg(fillArgs, '--db', args.db);
  pushArg(fillArgs, '--source', paths.sourceCandidatePath);
  pushArg(fillArgs, '--out', paths.passEvidencePath);
  pushArg(fillArgs, '--approver-name', input.approverName);
  pushArg(fillArgs, '--approval-artifact', input.approvalArtifactPath);
  pushArg(fillArgs, '--approval-confirmed-at', input.approvalConfirmedAt);
  pushArg(fillArgs, '--before-value', input.beforeValue);
  pushArg(fillArgs, '--before-captured-at', input.beforeCapturedAt);
  pushArg(fillArgs, '--before-screenshot', input.beforeScreenshotPath);
  pushArg(fillArgs, '--live-bid-source-note', input.liveBidSourceNote);
  pushArg(fillArgs, '--after-value', input.afterValue);
  pushArg(fillArgs, '--after-captured-at', input.afterCapturedAt);
  pushArg(fillArgs, '--after-screenshot', input.afterScreenshotPath);
  pushArg(fillArgs, '--executed-at', input.executedAt);
  pushArg(fillArgs, '--executed-by', input.executedBy);
  pushArg(fillArgs, '--execution-id', input.executionId);
  pushArg(fillArgs, '--readback-read-at', input.readbackReadAt);
  pushArg(fillArgs, '--readback-evidence', input.readbackEvidencePath);
  pushArg(fillArgs, '--readback-actual-value', input.readbackActualValue);
  pushArg(fillArgs, '--risk-rationale', input.riskRationale);

  const result = runFill(fillArgs);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
  console.log(`Filled ad readback session evidence written: ${paths.passEvidencePath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
