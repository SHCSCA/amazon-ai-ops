const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'in-place') {
      args[key] = true;
      continue;
    }
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

function optionalArg(args, key, fallback) {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) return fallback;
  return value.trim();
}

function isIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function ensureIso(value, key) {
  if (!isIsoDate(value)) {
    throw new Error(`--${key} must be an ISO timestamp`);
  }
  return value;
}

function ensureEvidenceFile(filePath, key) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`--${key} evidence file does not exist: ${resolved}`);
  }
  return resolved;
}

function numericBid(value, key) {
  const text = String(value ?? '').trim();
  const number = Number(text.replace(/^\$/, '').replace(/\s*usd$/i, ''));
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`--${key} must be a positive numeric bid`);
  }
  return text;
}

function runVerifier(evidencePath, dbPath) {
  const verifierArgs = [
    path.join(__dirname, 'verify-ad-readback-evidence.js'),
    evidencePath,
  ];
  if (dbPath) verifierArgs.push('--db', dbPath);
  return spawnSync(process.execPath, verifierArgs, {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
}

function main() {
  const args = parseArgs(process.argv);
  const sourcePath = path.resolve(requireArg(args, 'source'));
  const outPath = path.resolve(requireArg(args, 'out'));

  if (sourcePath === outPath && args['in-place'] !== true) {
    throw new Error('Refusing to overwrite source candidate without --in-place');
  }

  const candidate = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  if (candidate.kind !== 'real-ad-execution-readback') {
    throw new Error(`Unsupported evidence kind: ${candidate.kind}`);
  }

  const approvalConfirmedAt = ensureIso(requireArg(args, 'approval-confirmed-at'), 'approval-confirmed-at');
  const beforeCapturedAt = ensureIso(requireArg(args, 'before-captured-at'), 'before-captured-at');
  const executedAt = ensureIso(requireArg(args, 'executed-at'), 'executed-at');
  const afterCapturedAt = ensureIso(requireArg(args, 'after-captured-at'), 'after-captured-at');
  const readbackReadAt = ensureIso(requireArg(args, 'readback-read-at'), 'readback-read-at');
  const beforeValue = numericBid(requireArg(args, 'before-value'), 'before-value');
  const afterValue = numericBid(requireArg(args, 'after-value'), 'after-value');
  const readbackActualValue = numericBid(requireArg(args, 'readback-actual-value'), 'readback-actual-value');

  const evidence = {
    ...candidate,
    status: 'PASS',
    finalizedAt: new Date().toISOString(),
    realWriteApproved: true,
    safety: {
      ...(candidate.safety || {}),
      full8Started: false,
      listingAiDraftOnly: false,
      adWriteActionsPerformed: true,
    },
    approval: {
      ...(candidate.approval || {}),
      operatorConfirmed: true,
      scope: optionalArg(args, 'approval-scope', candidate.approval?.scope || ''),
      confirmedAt: approvalConfirmedAt,
      approverName: requireArg(args, 'approver-name'),
      approvalArtifactPath: requireArg(args, 'approval-artifact'),
    },
    risk: {
      ...(candidate.risk || {}),
      level: 'low',
      allowedByPolicy: true,
      rationale: optionalArg(args, 'risk-rationale', candidate.risk?.rationale || ''),
    },
    before: {
      ...(candidate.before || {}),
      value: beforeValue,
      capturedAt: beforeCapturedAt,
      screenshotPath: ensureEvidenceFile(requireArg(args, 'before-screenshot'), 'before-screenshot'),
      liveBidSourceNote: requireArg(args, 'live-bid-source-note'),
    },
    after: {
      ...(candidate.after || {}),
      value: afterValue,
      capturedAt: afterCapturedAt,
      screenshotPath: ensureEvidenceFile(requireArg(args, 'after-screenshot'), 'after-screenshot'),
    },
    readback: {
      ...(candidate.readback || {}),
      verified: true,
      method: optionalArg(args, 'readback-method', 'Ads UI reload target row'),
      readAt: readbackReadAt,
      actualValue: readbackActualValue,
      evidencePath: ensureEvidenceFile(requireArg(args, 'readback-evidence'), 'readback-evidence'),
    },
    execution: {
      ...(candidate.execution || {}),
      success: true,
      verified: true,
      executionId: requireArg(args, 'execution-id'),
      executedAt,
      channel: 'manual_ads_ui',
      performedBy: requireArg(args, 'executed-by'),
      appExecutorUsed: false,
    },
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  const verification = runVerifier(outPath, args.db);
  if (verification.stdout) process.stdout.write(verification.stdout);
  if (verification.stderr) process.stderr.write(verification.stderr);
  if (verification.status !== 0) {
    process.exit(verification.status || 1);
  }

  console.log(`Filled ad readback evidence written: ${outPath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
