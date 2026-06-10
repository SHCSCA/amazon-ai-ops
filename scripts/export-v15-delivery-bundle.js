const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const bundleRoot = path.join(root, 'output', 'delivery-bundles');
const appDataStorageRoot = process.env.APPDATA
  ? path.join(process.env.APPDATA, '@amazon-ai-ops', 'desktop', 'storage')
  : '';

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

function latestEvidence(pattern) {
  if (!fs.existsSync(evidenceDir)) return null;
  const files = fs.readdirSync(evidenceDir)
    .filter((name) => pattern.test(name))
    .map((name) => {
      const filePath = path.join(evidenceDir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.filePath || null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertManifestDrivenFinalReadiness(finalReadiness, finalReadinessPath) {
  if (finalReadiness.evidenceSelection?.mode !== 'manifest') {
    throw new Error(
      `Refusing to export delivery bundle from non-manifest final readiness evidence: ${finalReadinessPath}. `
      + 'Run write:v15-evidence-manifest, then verify:v15-final-readiness with --evidence-manifest.',
    );
  }
  const manifestPath = finalReadiness.evidenceSelection?.manifestPath;
  if (!manifestPath || !fs.existsSync(path.resolve(manifestPath))) {
    throw new Error(`Refusing to export delivery bundle because evidence manifest is missing: ${manifestPath || '<none>'}`);
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function safeBasename(filePath) {
  return path.basename(filePath).replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function isInside(childPath, parentPath) {
  if (!childPath || !parentPath) return false;
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function uniqueDestinationPath(destinationDir, basename) {
  const parsed = path.parse(basename);
  let candidate = path.join(destinationDir, basename);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(destinationDir, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function assertAllowedSource(sourcePath, label) {
  const resolved = path.resolve(sourcePath);
  const ext = path.extname(resolved).toLowerCase();
  const isRepoDocOrScript = isInside(resolved, root)
    && (
      isInside(resolved, path.join(root, 'docs'))
      || isInside(resolved, path.join(root, 'scripts'))
      || path.basename(resolved) === 'README.md'
      || path.basename(resolved) === 'package.json'
      || isInside(resolved, evidenceDir)
    );
  const isAppOwnedEvidence = appDataStorageRoot
    && isInside(resolved, appDataStorageRoot)
    && (
      isInside(resolved, path.join(appDataStorageRoot, 'screenshots'))
      || isInside(resolved, path.join(appDataStorageRoot, 'exports'))
      || path.basename(resolved).toLowerCase() === 'manifest.json'
    );
  if (!isRepoDocOrScript && !isAppOwnedEvidence) {
    throw new Error(`Refusing to export ${label}: source path is outside allowed evidence roots: ${resolved}`);
  }
  if (['.db', '.sqlite', '.sqlite3', '.exe', '.xlsx', '.xls', '.csv'].includes(ext)) {
    throw new Error(`Refusing to export ${label}: blocked file extension ${ext}`);
  }
}

function copyFile(sourcePath, destinationDir, label, manifest) {
  if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    manifest.missing.push({ label, sourcePath: sourcePath || null });
    return null;
  }
  const resolved = path.resolve(sourcePath);
  assertAllowedSource(resolved, label);
  assertNoObviousSecret(resolved);
  const destinationPath = uniqueDestinationPath(destinationDir, safeBasename(resolved));
  fs.mkdirSync(destinationDir, { recursive: true });
  fs.copyFileSync(resolved, destinationPath);
  manifest.files.push({
    label,
    sourcePath: resolved,
    bundlePath: path.relative(manifest.bundleDir, destinationPath),
    sizeBytes: fs.statSync(destinationPath).size,
    sha256: sha256(destinationPath),
  });
  return destinationPath;
}

function assertNoObviousSecret(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.json', '.md', '.txt', '.csv'].includes(ext)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  const textForScan = text.replace(
    /(DEEPSEEK[_-]?API[_-]?KEY["']?\s*[:=]\s*)["']<[^"']+>["']/gi,
    '$1<placeholder>',
  );
  const patterns = [
    /sk-[A-Za-z0-9_-]{16,}/,
    /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
    /deepseek[_-]?api[_-]?key["']?\s*[:=]\s*["'][^"']+/i,
    /LINGXING_PASSWORD\s*[:=]\s*['"]?(?!<)[^'"\s]+/i,
  ];
  const matched = patterns.find((pattern) => pattern.test(textForScan));
  if (matched) {
    throw new Error(`Refusing to export possible secret in ${filePath}: ${matched}`);
  }
}

function collectEvidencePaths(finalReadiness) {
  const paths = new Set();
  paths.add(finalReadiness.__path);
  for (const gate of finalReadiness.gates || []) {
    if (gate.evidencePath) paths.add(gate.evidencePath);
  }
  const smoke = latestEvidence(/^v15-product-readiness-ui-smoke-.*\.json$/i);
  if (smoke) {
    paths.add(smoke);
    const smokeJson = readJson(smoke);
    if (smokeJson.screenshotPath) paths.add(smokeJson.screenshotPath);
    if (smokeJson.listingScreenshotPath) paths.add(smokeJson.listingScreenshotPath);
    for (const page of Object.values(smokeJson.pages || {})) {
      if (page && page.screenshotPath) paths.add(page.screenshotPath);
    }
  }
  const reconciliation = latestEvidence(/^full8-data-reconciliation-.*\.json$/i);
  if (reconciliation) paths.add(reconciliation);
  const structuralAi = latestEvidence(/^structural-ai-openai-compatible-mock-.*\.json$/i);
  if (structuralAi) paths.add(structuralAi);
  const evidenceManifest = latestEvidence(/^v15-final-readiness-evidence-manifest-.*\.json$/i);
  if (evidenceManifest) paths.add(evidenceManifest);
  for (const pattern of [
    /^real-ad-execution-readback-candidate-.*\.json$/i,
    /^real-ad-execution-readback-candidate-.*\.md$/i,
    /^real-ad-execution-readback-manual\.json$/i,
    /^real-ad-execution-readback-manual\.md$/i,
    /^ads-readonly-locate-.*\.json$/i,
  ]) {
    const adReadbackPacket = latestEvidence(pattern);
    if (adReadbackPacket) {
      paths.add(adReadbackPacket);
      if (/^ads-readonly-locate-.*\.json$/i.test(path.basename(adReadbackPacket))) {
        const readonlyLocation = readJson(adReadbackPacket);
        for (const evidencePath of Object.values(readonlyLocation.evidence || {})) {
          if (evidencePath) paths.add(evidencePath);
        }
      }
    }
  }

  const delivery = (finalReadiness.gates || []).find((gate) => gate.name === 'Report collection delivery')?.evidencePath;
  if (delivery && fs.existsSync(delivery)) {
    const deliveryJson = readJson(delivery);
    if (deliveryJson.batch?.manifestPath) paths.add(deliveryJson.batch.manifestPath);
    if (deliveryJson.result?.batch?.manifestPath) paths.add(deliveryJson.result.batch.manifestPath);
    const batchId = deliveryJson.batch?.id || deliveryJson.result?.batch?.id;
    const auditDir = findAcceptanceAuditDir(batchId);
    if (auditDir) {
      for (const name of [
        'acceptance-audit.json',
        'acceptance-audit.md',
        'downloaded-report-files.json',
        'filename-date-range-analysis.json',
        'manifest.json',
      ]) {
        const filePath = path.join(auditDir, name);
        if (fs.existsSync(filePath)) paths.add(filePath);
      }
    }
  }

  const listing = (finalReadiness.gates || []).find((gate) => gate.name === 'Lingxing Listing full read')?.evidencePath;
  if (listing && fs.existsSync(listing)) {
    const listingJson = readJson(listing);
    if (listingJson.listingRead?.evidence?.screenshotPath) {
      paths.add(listingJson.listingRead.evidence.screenshotPath);
    }
  }
  return [...paths].filter(Boolean);
}

function findAcceptanceAuditDir(batchId) {
  if (!batchId || !appDataStorageRoot) return null;
  const exportsDir = path.join(appDataStorageRoot, 'exports');
  if (!fs.existsSync(exportsDir)) return null;
  const candidates = fs.readdirSync(exportsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.includes(batchId) && entry.name.startsWith('lingxing_acceptance_audit_'))
    .map((entry) => {
      const filePath = path.join(exportsDir, entry.name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.filePath || null;
}

function writeGitSnapshot(bundleDir, manifest) {
  const { spawnSync } = require('child_process');
  const run = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    return result.status === 0 ? (result.stdout || '').trim() : `ERROR: ${(result.stderr || result.stdout || '').trim()}`;
  };
  const text = [
    `generatedAt=${new Date().toISOString()}`,
    `head=${run(['rev-parse', 'HEAD'])}`,
    `branch=${run(['branch', '--show-current'])}`,
    '',
    'status --short:',
    run(['status', '--short']),
    '',
    'diff --stat:',
    run(['diff', '--stat']),
  ].join('\n');
  const gitDir = path.join(bundleDir, 'git');
  fs.mkdirSync(gitDir, { recursive: true });
  const targetPath = path.join(gitDir, 'git-status.txt');
  fs.writeFileSync(targetPath, text, 'utf8');
  manifest.files.push({
    label: 'git-status',
    sourcePath: 'generated',
    bundlePath: path.relative(manifest.bundleDir, targetPath),
    sizeBytes: fs.statSync(targetPath).size,
    sha256: sha256(targetPath),
  });
}

function main() {
  const args = parseArgs(process.argv);
  const finalReadinessPath = path.resolve(args['final-readiness'] || latestEvidence(/^final-readiness-.*\.json$/i) || '');
  if (!finalReadinessPath || !fs.existsSync(finalReadinessPath)) {
    throw new Error('Missing final readiness evidence. Run pnpm run verify:v15-final-readiness first.');
  }
  const finalReadiness = readJson(finalReadinessPath);
  finalReadiness.__path = finalReadinessPath;
  assertManifestDrivenFinalReadiness(finalReadiness, finalReadinessPath);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bundleDir = path.resolve(args.out || path.join(bundleRoot, `v15-delivery-bundle-${stamp}`));
  if (fs.existsSync(bundleDir) && isInside(bundleDir, bundleRoot)) {
    fs.rmSync(bundleDir, { recursive: true, force: true });
  }
  fs.mkdirSync(bundleDir, { recursive: true });

  const manifest = {
    generatedAt: new Date().toISOString(),
    bundleDir,
    status: finalReadiness.status,
    appReady: Boolean(finalReadiness.appReady),
    reportCollectionReady: Boolean(finalReadiness.reportCollectionReady),
    listingReadReady: Boolean(finalReadiness.listingReadReady),
    warning: finalReadiness.appReady
      ? 'APP_READY evidence bundle.'
      : 'APP_NEEDS_WORK evidence bundle. Do not present this bundle as final READY until every gate passes.',
    sensitiveDataNotice: [
      'This bundle excludes browser profiles, credentials, AppData SQLite DB files, raw downloaded report XLSX files, and installer binaries.',
      'Screenshots and evidence JSON may still contain business context such as store, ASIN, Listing text, URLs, and local paths.',
    ],
    excludedByDesign: [
      'storage/browser-data',
      'AppData amazon-ai-ops.db',
      'raw downloaded XLSX reports',
      'installer EXE',
      'API keys and passwords',
    ],
    files: [],
    missing: [],
  };

  const docsDir = path.join(bundleDir, 'docs');
  for (const relativePath of [
    'README.md',
    'package.json',
    'docs/V1_5_PROGRESS_REPORT.md',
    'docs/V1_5_ACCEPTANCE_MATRIX.md',
    'docs/USER_GUIDE_v1_5.md',
    'docs/REAL_AD_READBACK_RUNBOOK.md',
    'docs/V1_5_ORCHESTRATOR_CLOSEOUT.md',
  ]) {
    copyFile(path.join(root, relativePath), docsDir, relativePath, manifest);
  }

  const scriptsDir = path.join(bundleDir, 'scripts');
  for (const relativePath of [
    'scripts/verify-v15-final-readiness.js',
    'scripts/verify-v15-non-ready-safety.js',
    'scripts/verify-v15-ready-safety.js',
    'scripts/export-v15-delivery-bundle.js',
    'scripts/write-v15-evidence-manifest.js',
    'scripts/verify-v15-delivery-evidence.js',
    'scripts/verify-listing-read-evidence.js',
    'scripts/verify-ai-live.js',
    'scripts/verify-ai-live-connection.js',
    'scripts/run-ai-structural-mock.js',
    'scripts/verify-ai-structural-mock-evidence.js',
    'scripts/verify-listing-ai-draft-evidence.js',
    'scripts/verify-ad-ai-explanation-evidence.js',
    'scripts/verify-ad-execution-fail-closed.js',
    'scripts/create-ad-readback-evidence-template.js',
    'scripts/create-ad-readback-candidate-from-recommendation.js',
    'scripts/verify-ad-readback-evidence.js',
    'scripts/reconcile-lingxing-full8-data.js',
  ]) {
    copyFile(path.join(root, relativePath), scriptsDir, relativePath, manifest);
  }
  writeGitSnapshot(bundleDir, manifest);

  const evidenceOutDir = path.join(bundleDir, 'evidence');
  const screenshotsDir = path.join(bundleDir, 'screenshots');
  for (const sourcePath of collectEvidencePaths(finalReadiness)) {
    const ext = path.extname(sourcePath).toLowerCase();
    const destinationDir = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? screenshotsDir : evidenceOutDir;
    const copied = copyFile(sourcePath, destinationDir, `evidence:${path.basename(sourcePath)}`, manifest);
    if (copied) assertNoObviousSecret(copied);
  }

  for (const file of manifest.files) {
    assertNoObviousSecret(path.join(bundleDir, file.bundlePath));
  }

  const manifestPath = path.join(bundleDir, 'delivery-bundle-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Delivery bundle exported: ${bundleDir}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Status: ${manifest.status}`);
  if (!manifest.appReady) {
    console.log('Notice: bundle is APP_NEEDS_WORK, not final READY.');
  }
}

main();
