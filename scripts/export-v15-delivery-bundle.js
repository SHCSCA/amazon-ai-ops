const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { resolveBoundAdReadbackAuthorityDbPath } = require('./ad-readback-authority-db');
const {
  PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
  validateAdversarialNodeEnvBundleSummaryContract,
  validateAdversarialNodeEnvEvidence,
  validateAdversarialNodeEnvSelectionContract,
} = require('./smoke-package-adversarial-node-env');
const { validatePackageSecurityEvidence } = require('./smoke-package-security-boundaries');
const { validatePackageLaunchSmokeEvidence } = require('./smoke-package-launch');
const {
  EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
  evaluatePackageUiEvidenceCompleteness,
  validatePackageUiReadOnlyRuntimeEvidence,
  validateSchedulerSubviewEvidence,
} = require('./package-ui-evidence');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const bundleRoot = path.join(root, 'output', 'delivery-bundles');
const appDataStorageRoot = process.env.APPDATA
  ? path.join(process.env.APPDATA, '@amazon-ai-ops', 'desktop', 'storage')
  : '';
const validatedExternalPackageLaunchArtifacts = new Set();
const validatedPackageLaunchEvidencePaths = new Set();

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

function latestEvidence(pattern, predicate = () => true) {
  if (!fs.existsSync(evidenceDir)) return null;
  const files = fs.readdirSync(evidenceDir)
    .filter((name) => pattern.test(name) && predicate(name))
    .map((name) => {
      const filePath = path.join(evidenceDir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.filePath || null;
}

function latestFinalReadinessEvidence() {
  return latestEvidence(/^final-readiness-(?:\d{4}-\d{2}-\d{2}|\d{10,})\.json$/i);
}

function latestFileInDir(dir, pattern, predicate = () => true) {
  if (!dir || !fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((name) => pattern.test(name) && predicate(name))
    .map((name) => {
      const filePath = path.join(dir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .filter((entry) => fs.statSync(entry.filePath).isFile())
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.filePath || null;
}

function latestAppDataExport(pattern, predicate) {
  return latestFileInDir(appDataStorageRoot ? path.join(appDataStorageRoot, 'exports') : '', pattern, predicate);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runNode(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
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

function assertSelectedReadbackPassesVerifier(finalReadiness, dbPath) {
  if (finalReadiness.status !== 'APP_READY' && finalReadiness.appReady !== true) return;
  const manifestPath = path.resolve(finalReadiness.evidenceSelection?.manifestPath || '');
  const evidenceManifest = readJson(manifestPath);
  const readbackPath = evidenceManifest.evidence?.adReadback?.absolutePath;
  if (!readbackPath || !fs.existsSync(path.resolve(readbackPath))) {
    throw new Error('Refusing to export APP_READY delivery bundle because manifest-selected ad readback evidence is missing.');
  }
  const verifierArgs = [path.resolve(readbackPath)];
  if (dbPath) verifierArgs.push('--db', dbPath);
  const verification = runNode('scripts/verify-ad-readback-evidence.js', verifierArgs);
  if (!verification.ok) {
    throw new Error(
      'Refusing to export APP_READY delivery bundle because manifest-selected ad readback evidence failed verify:ad-readback.\n'
      + verification.output.split(/\r?\n/).slice(-8).join('\n'),
    );
  }
}

function assertAppReadyReadmeState(finalReadiness, readmePath) {
  if (finalReadiness.status !== 'APP_READY' && finalReadiness.appReady !== true) return;
  const resolved = path.resolve(readmePath || path.join(root, 'README.md'));
  if (!fs.existsSync(resolved)) {
    throw new Error(`Refusing to export APP_READY delivery bundle because README is missing: ${resolved}`);
  }
  const text = fs.readFileSync(resolved, 'utf8');
  if (!/^\*\*DELIVERY:\s*APP_READY\b/im.test(text)) {
    throw new Error(
      'Refusing to export APP_READY delivery bundle because README delivery line is not APP_READY. '
      + 'Update the top-level README DELIVERY line before exporting the final handoff bundle.',
    );
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function assertCurrentHashBoundEvidenceFile(record, label) {
  const filePath = record?.path;
  if (!filePath || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) {
    throw new Error(`Refusing to export package UI evidence because ${label} is missing.`);
  }
  const lstat = fs.lstatSync(filePath);
  const stat = fs.statSync(filePath);
  if (
    !lstat.isFile()
    || lstat.isSymbolicLink()
    || Number(record?.sizeBytes) !== stat.size
    || !/^[A-F0-9]{64}$/.test(String(record?.sha256 || ''))
    || sha256(filePath) !== String(record.sha256).toUpperCase()
  ) {
    throw new Error(
      `Refusing to export package UI evidence because ${label} current SHA-256/size is missing or stale.`,
    );
  }
  return path.resolve(filePath);
}

function assertPackageUiV8SchedulerAndInteractiveLoginEvidence(packageUi) {
  if (packageUi?.kind !== 'package-ui-evidence' || packageUi?.schemaVersion !== 8) {
    throw new Error(
      'Refusing to export package UI evidence unless it uses current two-phase scheduler-read-only and interactive-login-attestation schema v8; schemas v5/v6/v7 are historical and cannot be used for current export.',
    );
  }
  const completeness = evaluatePackageUiEvidenceCompleteness(packageUi);
  if (completeness.passed !== true) {
    throw new Error(
      `Refusing to export incomplete package UI evidence: ${completeness.violations
        .map((item) => item.code || item.message)
        .join(', ')}.`,
    );
  }
  const runs = Array.isArray(packageUi.runs) ? packageUi.runs : [];
  const scales = runs.map((run) => run?.scalePercent).sort((left, right) => left - right);
  if (JSON.stringify(scales) !== JSON.stringify([100, 125])) {
    throw new Error('Refusing to export package UI evidence without exact 100% and 125% v8 runs.');
  }
  for (const run of runs) {
    const subviews = Array.isArray(run?.subviewChecks) ? run.subviewChecks : [];
    const scheduler = subviews.filter((item) => (
      item?.workspace === 'settings' && item?.subview === 'scheduler'
    ));
    if (
      scheduler.length !== 1
      || scheduler[0]?.passed !== true
      || validateSchedulerSubviewEvidence(
        scheduler[0]?.identityCapabilityEvidence,
        EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0],
      ).passed !== true
    ) {
      throw new Error(
        `Refusing to export package UI evidence because ${run?.scalePercent || 'unknown'}% settings/scheduler evidence is missing or failed.`,
      );
    }
    assertCurrentHashBoundEvidenceFile(
      scheduler[0].screenshot,
      `${run.scalePercent}% settings/scheduler screenshot`,
    );
    const runtimeValidation = validatePackageUiReadOnlyRuntimeEvidence(
      run?.schedulerReadOnlyRuntime,
      { requireSchedulerReads: true },
    );
    if (runtimeValidation.passed !== true) {
      throw new Error(
        `Refusing to export package UI evidence because ${run?.scalePercent || 'unknown'}% Main scheduler read-only runtime evidence failed.`,
      );
    }
    assertCurrentHashBoundEvidenceFile(
      run.schedulerReadOnlyRuntime.artifact,
      `${run.scalePercent}% Main scheduler read-only runtime attestation`,
    );
  }
  if (
    validatePackageUiReadOnlyRuntimeEvidence(
      packageUi.wideProfile?.schedulerReadOnlyRuntime,
      { requireSchedulerReads: false },
    ).passed !== true
  ) {
    throw new Error('Refusing to export package UI evidence because the wide Main scheduler read-only runtime evidence failed.');
  }
  assertCurrentHashBoundEvidenceFile(
    packageUi.wideProfile.schedulerReadOnlyRuntime.artifact,
    'wide Main scheduler read-only runtime attestation',
  );
}

function safeBasename(filePath) {
  return path.basename(filePath).replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function canonicalPath(inputPath) {
  const resolved = path.resolve(inputPath);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function samePath(left, right) {
  if (!left || !right) return false;
  return canonicalPath(left).toLowerCase() === canonicalPath(right).toLowerCase();
}

function isInside(childPath, parentPath) {
  if (!childPath || !parentPath) return false;
  const relative = path.relative(canonicalPath(parentPath), canonicalPath(childPath));
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
  const resolved = canonicalPath(sourcePath);
  const ext = path.extname(resolved).toLowerCase();
  const isRepoDocOrScript = isInside(resolved, root)
    && (
      isInside(resolved, path.join(root, 'docs'))
      || isInside(resolved, path.join(root, 'scripts'))
      || path.basename(resolved) === 'AGENTS.md'
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
  const isValidatedPackageLaunchArtifact = validatedExternalPackageLaunchArtifacts.has(
    resolved.toLowerCase(),
  );
  if (!isRepoDocOrScript && !isAppOwnedEvidence && !isValidatedPackageLaunchArtifact) {
    throw new Error(`Refusing to export ${label}: source path is outside allowed evidence roots: ${resolved}`);
  }
  if (['.db', '.sqlite', '.sqlite3', '.exe', '.xlsx', '.xls', '.csv'].includes(ext)) {
    throw new Error(`Refusing to export ${label}: blocked file extension ${ext}`);
  }
}

function copyFile(sourcePath, destinationDir, label, manifest) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    manifest.missing.push({ label, sourcePath: sourcePath || null });
    return null;
  }
  if (!fs.statSync(sourcePath).isFile()) return null;
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

function explicitFileArg(args, key) {
  if (!args[key]) return null;
  const filePath = path.resolve(args[key]);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Explicit --${key} file is missing: ${filePath}`);
  }
  return filePath;
}

function siblingMarkdownPath(jsonPath) {
  if (!jsonPath) return null;
  const markdownPath = jsonPath.replace(/\.json$/i, '.md');
  return fs.existsSync(markdownPath) && fs.statSync(markdownPath).isFile() ? markdownPath : null;
}

function isProductionDataReconciliationName(fileName) {
  return !/(?:^|[-_.])(smoke|test|fixture)(?:[-_.]|$)/i.test(path.basename(fileName));
}

function summarizeDataReconciliation(jsonPath, markdownPath) {
  if (!jsonPath) {
    return {
      present: false,
      sourceJsonPath: null,
      sourceMarkdownPath: markdownPath || null,
      canonicalSource: null,
      canonical: null,
      blockers: ['No current-scope data reconciliation JSON was found.'],
    };
  }
  const report = readJson(jsonPath);
  const canonical = report.canonical
    || report.db?.totals?.canonical
    || report.totals?.canonicalTotal
    || null;
  const canonicalSource = report.canonicalSource
    || report.db?.canonical?.summarySource
    || (report.totals?.canonicalTotal ? 'full8-data-reconciliation' : null);
  return {
    present: true,
    sourceJsonPath: jsonPath,
    sourceMarkdownPath: markdownPath || null,
    canonicalSource,
    canonical,
    blockers: Array.isArray(report.blockers)
      ? report.blockers
      : Array.isArray(report.db?.blockers)
        ? report.db.blockers
        : [],
  };
}

function isRealReportPath(value) {
  return typeof value === 'string' && /\.(xlsx|xls|csv)$/i.test(value.trim());
}

function addReportReference(map, filePath, ref) {
  if (!isRealReportPath(filePath)) return;
  const resolved = path.resolve(String(filePath).trim());
  const current = map.get(resolved) || {
    sourcePath: resolved,
    exists: fs.existsSync(resolved) && fs.statSync(resolved).isFile(),
    sizeBytes: null,
    sha256: null,
    refs: [],
  };
  if (current.exists) {
    current.sizeBytes = fs.statSync(resolved).size;
    current.sha256 = sha256(resolved);
  }
  if (ref && !current.refs.includes(ref)) current.refs.push(ref);
  map.set(resolved, current);
}

function collectReportReferencesFromValue(value, map, refPrefix) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectReportReferencesFromValue(item, map, `${refPrefix}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const ref = `${refPrefix}.${key}`;
    if (
      ['filePath', 'file_path', 'sourceFile', 'source_file', 'sourceFiles', 'source_files', 'reportPath', 'report_path'].includes(key)
    ) {
      if (Array.isArray(nested)) nested.forEach((item, index) => addReportReference(map, item, `${ref}[${index}]`));
      else addReportReference(map, nested, ref);
    }
    collectReportReferencesFromValue(nested, map, ref);
  }
}

function isSyntheticUiEvidenceForReportIndex(filePath) {
  const baseName = path.basename(String(filePath || ''));
  return [
    /^current-business-ui-smoke-.*\.json$/i,
    /^business-ui-.*-smoke-.*\.json$/i,
    /^v15-product-readiness-ui-smoke-.*\.json$/i,
    /^structural-ai-openai-compatible-mock-.*\.json$/i,
  ].some((pattern) => pattern.test(baseName));
}

function buildRealReportIndex({ finalReadiness, dataReconciliation, evidencePaths }) {
  const reports = new Map();
  collectReportReferencesFromValue(finalReadiness, reports, 'finalReadiness');
  if (dataReconciliation) collectReportReferencesFromValue(dataReconciliation, reports, 'dataReconciliation');
  for (const evidencePath of evidencePaths) {
    if (path.extname(evidencePath).toLowerCase() !== '.json') continue;
    if (isSyntheticUiEvidenceForReportIndex(evidencePath)) continue;
    if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) continue;
    try {
      collectReportReferencesFromValue(readJson(evidencePath), reports, `evidence:${path.basename(evidencePath)}`);
    } catch {
      // Ignore malformed optional evidence here; the dedicated verifier owns validity.
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    copyPolicy: 'Raw Lingxing report spreadsheets are not copied into the delivery bundle; this index records local paths, existence, size, and hash.',
    reports: Array.from(reports.values()).sort((a, b) => a.sourcePath.localeCompare(b.sourcePath)),
  };
}

function collectFinalReadinessBlockers(finalReadiness) {
  const blockers = [
    ...(Array.isArray(finalReadiness.missing) ? finalReadiness.missing : []),
    ...(Array.isArray(finalReadiness.actionItems) ? finalReadiness.actionItems : []),
    ...(Array.isArray(finalReadiness.recommendationReviewReasons) ? finalReadiness.recommendationReviewReasons : []),
    ...(Array.isArray(finalReadiness.reviewBlockers) ? finalReadiness.reviewBlockers : []),
    ...(Array.isArray(finalReadiness.deliveryReviewReasons) ? finalReadiness.deliveryReviewReasons : []),
  ];

  for (const gate of finalReadiness.gates || []) {
    if (gate && gate.ok === false) {
      const name = String(gate.name || 'gate').trim();
      const message = String(gate.message || gate.status || '未通过').trim();
      blockers.push(`${name}: ${message}`);
    }
  }

  return Array.from(new Set(blockers.map((item) => String(item || '').trim()).filter(Boolean)));
}

function writeRealReportIndex(bundleDir, evidenceOutDir, manifest, reportIndex) {
  const indexPath = path.join(evidenceOutDir, 'real-report-file-index.json');
  fs.mkdirSync(evidenceOutDir, { recursive: true });
  fs.writeFileSync(indexPath, `${JSON.stringify(reportIndex, null, 2)}\n`, 'utf8');
  manifest.files.push({
    label: 'real-report-file-index',
    sourcePath: 'generated',
    bundlePath: path.relative(bundleDir, indexPath),
    sizeBytes: fs.statSync(indexPath).size,
    sha256: sha256(indexPath),
  });
  return indexPath;
}

function latestReleasePackageFiles(releaseDir) {
  if (!releaseDir || !fs.existsSync(releaseDir)) return [];
  const files = fs.readdirSync(releaseDir)
    .filter((name) => /^AmazonAIOpsAgent-.*\.exe$/i.test(name))
    .map((name) => path.join(releaseDir, name))
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  const portable = files.find((filePath) => /portable/i.test(path.basename(filePath)));
  const installer = files.find((filePath) => !/portable/i.test(path.basename(filePath)));
  return [
    installer ? { kind: 'installer', filePath: installer } : null,
    portable ? { kind: 'portable', filePath: portable } : null,
  ].filter(Boolean);
}

function buildPackageIndex(releaseDir) {
  const packages = latestReleasePackageFiles(releaseDir).map((entry) => {
    const stat = fs.statSync(entry.filePath);
    return {
      kind: entry.kind,
      sourcePath: path.resolve(entry.filePath),
      fileName: path.basename(entry.filePath),
      exists: true,
      sizeBytes: stat.size,
      sha256: sha256(entry.filePath),
      modifiedAt: stat.mtime.toISOString(),
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    releaseDir: path.resolve(releaseDir || path.join(root, 'apps', 'desktop', 'release')),
    copyPolicy: 'Installer and portable EXE binaries are not copied into the delivery bundle; this index records local paths, existence, size, and SHA-256.',
    packages,
  };
}

function packageIdentity(item) {
  return [
    String(item?.kind || ''),
    String(item?.sourcePath || ''),
    String(item?.fileName || ''),
  ].join('\u0000');
}

function packageListsMatch(leftPackages, rightPackages) {
  if (!Array.isArray(leftPackages) || !Array.isArray(rightPackages)) return false;
  if (leftPackages.length !== rightPackages.length) return false;
  const left = [...leftPackages].sort((a, b) => packageIdentity(a).localeCompare(packageIdentity(b)));
  const right = [...rightPackages].sort((a, b) => packageIdentity(a).localeCompare(packageIdentity(b)));
  return left.every((item, index) => {
    const other = right[index];
    return item.kind === other.kind
      && path.resolve(item.sourcePath) === path.resolve(other.sourcePath)
      && item.fileName === other.fileName
      && Number(item.sizeBytes || 0) === Number(other.sizeBytes || 0)
      && String(item.sha256 || '').toUpperCase() === String(other.sha256 || '').toUpperCase();
  });
}

function assertAppReadyFinalReadinessHasPackageEvidence(finalReadiness, packageIndex) {
  if (!finalReadiness.appReady && finalReadiness.status !== 'APP_READY') return;
  const packageGate = (finalReadiness.gates || []).find((gate) => gate.name === 'Release package hash');
  if (!packageGate || packageGate.ok !== true || packageGate.status !== 'passed') {
    throw new Error('Refusing to export APP_READY delivery bundle because final readiness package hash gate evidence is missing.');
  }
  const readinessIndex = finalReadiness.packageIndex;
  if (!readinessIndex?.present || Number(readinessIndex.count || 0) <= 0) {
    throw new Error('Refusing to export APP_READY delivery bundle because final readiness package index is missing.');
  }
  if (!Array.isArray(readinessIndex.packages) || !packageListsMatch(readinessIndex.packages, packageIndex.packages)) {
    throw new Error('Refusing to export APP_READY delivery bundle because final readiness package index does not match current release package index.');
  }
}

function writePackageIndex(bundleDir, evidenceOutDir, manifest, packageIndex) {
  const indexPath = path.join(evidenceOutDir, 'release-package-index.json');
  fs.mkdirSync(evidenceOutDir, { recursive: true });
  fs.writeFileSync(indexPath, `${JSON.stringify(packageIndex, null, 2)}\n`, 'utf8');
  manifest.files.push({
    label: 'release-package-index',
    sourcePath: 'generated',
    bundlePath: path.relative(bundleDir, indexPath),
    sizeBytes: fs.statSync(indexPath).size,
    sha256: sha256(indexPath),
  });
  return indexPath;
}

function resolveDataReconciliationEvidence(args) {
  const explicitJson = explicitFileArg(args, 'data-reconciliation');
  const explicitMarkdown = explicitFileArg(args, 'data-reconciliation-md');
  const jsonPath = explicitJson
    || latestEvidence(/^data-reconciliation-.*\.json$/i, isProductionDataReconciliationName)
    || latestAppDataExport(/^data-reconciliation-.*\.json$/i, isProductionDataReconciliationName)
    || latestEvidence(/^full8-data-reconciliation-.*\.json$/i, isProductionDataReconciliationName);
  const markdownPath = explicitMarkdown
    || siblingMarkdownPath(jsonPath)
    || (!explicitJson
      ? latestEvidence(/^data-reconciliation-.*\.md$/i, isProductionDataReconciliationName)
        || latestAppDataExport(/^data-reconciliation-.*\.md$/i, isProductionDataReconciliationName)
      : null);
  return summarizeDataReconciliation(jsonPath, markdownPath);
}

function collectEvidencePaths(finalReadiness, options = {}) {
  const includeLatestExtras = options.includeLatestExtras !== false;
  const paths = new Set();
  const validatedPackageLaunchPaths = new Set();
  const addValidatedPackageLaunchEvidence = (filePath) => {
    if (!filePath) return;
    const absolutePath = path.resolve(filePath);
    if (validatedPackageLaunchPaths.has(absolutePath)) return;
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      throw new Error(`Package launch evidence is missing: ${absolutePath}`);
    }
    const smoke = readJson(absolutePath);
    const validation = validatePackageLaunchSmokeEvidence(smoke);
    if (!validation.passed) {
      throw new Error(`Package launch strict contract failed: ${validation.violations
        .map((violation) => `${violation.code}@${violation.path}`)
        .join('; ')}`);
    }
    validatedPackageLaunchPaths.add(absolutePath);
    validatedPackageLaunchEvidencePaths.add(absolutePath);
    paths.add(absolutePath);
    for (const check of smoke.checks || []) {
      for (const artifact of [
        { path: check?.stdoutPath, allowExternal: false },
        { path: check?.stderrPath, allowExternal: false },
        { path: check?.userDataEvidence?.markerPath, allowExternal: true },
        { path: check?.windowReadyEvidence?.markerPath, allowExternal: true },
      ]) {
        if (artifact.path) {
          const resolvedArtifactPath = path.resolve(artifact.path);
          paths.add(resolvedArtifactPath);
          if (
            artifact.allowExternal
            && !isInside(resolvedArtifactPath, root)
            && !isInside(resolvedArtifactPath, appDataStorageRoot)
          ) {
            validatedExternalPackageLaunchArtifacts.add(
              canonicalPath(resolvedArtifactPath).toLowerCase(),
            );
          }
        }
      }
    }
  };
  paths.add(finalReadiness.__path);
  paths.add(finalReadiness.evidenceSelection?.manifestPath);
  for (const gate of finalReadiness.gates || []) {
    if (gate.evidencePath) paths.add(gate.evidencePath);
  }
  addValidatedPackageLaunchEvidence(finalReadiness.packageLaunchSmoke?.evidencePath);
  for (const gate of finalReadiness.gates || []) {
    if (gate?.id === 'package-launch-smoke' || gate?.id === 'package-launch') {
      addValidatedPackageLaunchEvidence(gate.evidencePath);
    }
  }
  if (options.packageUiManifest) {
    paths.add(options.packageUiManifest);
    const packageUi = readJson(options.packageUiManifest);
    assertPackageUiV8SchedulerAndInteractiveLoginEvidence(packageUi);
    for (const run of packageUi.runs || []) {
      for (const screenshot of run.screenshots || []) {
        if (screenshot?.path) paths.add(path.resolve(screenshot.path));
      }
      for (const overlay of run.overlayChecks || []) {
        if (overlay?.screenshot?.path) paths.add(path.resolve(overlay.screenshot.path));
      }
      for (const workspace of run.workspaceChecks || []) {
        if (workspace?.inspectorEvidence?.screenshot?.path) {
          paths.add(path.resolve(workspace.inspectorEvidence.screenshot.path));
        }
      }
      for (const subview of run.subviewChecks || []) {
        if (subview?.screenshot?.path) {
          paths.add(path.resolve(subview.screenshot.path));
        }
      }
      if (run.schedulerReadOnlyRuntime?.artifact?.path) {
        paths.add(path.resolve(run.schedulerReadOnlyRuntime.artifact.path));
      }
    }
    for (const screenshot of packageUi.wideProfile?.screenshots || []) {
      if (screenshot?.path) paths.add(path.resolve(screenshot.path));
    }
    for (const workspace of packageUi.wideProfile?.workspaceChecks || []) {
      if (workspace?.inspectorEvidence?.screenshot?.path) {
        paths.add(path.resolve(workspace.inspectorEvidence.screenshot.path));
      }
    }
    if (packageUi.wideProfile?.schedulerReadOnlyRuntime?.artifact?.path) {
      paths.add(path.resolve(packageUi.wideProfile.schedulerReadOnlyRuntime.artifact.path));
    }
  }
  if (options.workspaceUiManifest) {
    paths.add(options.workspaceUiManifest);
    const workspaceUi = readJson(options.workspaceUiManifest);
    for (const target of workspaceUi.targets || []) {
      if (target?.screenshot?.path) paths.add(path.resolve(target.screenshot.path));
      if (target?.jsonPath) paths.add(path.resolve(target.jsonPath));
    }
  }
  if (options.businessUiSmoke) paths.add(options.businessUiSmoke);
  if (options.fullTestEvidence) paths.add(options.fullTestEvidence);
  if (options.packageSecurityEvidence) paths.add(options.packageSecurityEvidence);
  if (options.packageAdversarialNodeEnvEvidence) paths.add(options.packageAdversarialNodeEnvEvidence);
  if (includeLatestExtras) {
    const addSmokeEvidence = (smoke) => {
      if (!smoke) return;
      paths.add(smoke);
      const smokeJson = readJson(smoke);
      if (smokeJson.screenshotPath) paths.add(smokeJson.screenshotPath);
      if (smokeJson.listingScreenshotPath) paths.add(smokeJson.listingScreenshotPath);
      for (const page of Object.values(smokeJson.pages || {})) {
        if (page && page.screenshotPath) paths.add(page.screenshotPath);
      }
    };
    addSmokeEvidence(latestEvidence(/^current-business-ui-smoke-.*\.json$/i));
    for (const pattern of [
      /^business-ui-shell-smoke-.*\.json$/i,
      /^business-ui-data-pipeline-smoke-.*\.json$/i,
      /^business-ui-ad-execution-smoke-.*\.json$/i,
      /^business-ui-keyword-listing-smoke-.*\.json$/i,
      /^business-ui-settings-delivery-smoke-.*\.json$/i,
    ]) {
      addSmokeEvidence(latestEvidence(pattern));
    }
    addSmokeEvidence(latestEvidence(/^v15-product-readiness-ui-smoke-.*\.json$/i));
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
    if (validatedPackageLaunchPaths.size === 0) {
      addValidatedPackageLaunchEvidence(latestEvidence(/^package-launch-smoke-.*\.json$/i));
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
  const finalReadinessPath = path.resolve(args['final-readiness'] || latestFinalReadinessEvidence() || '');
  if (!finalReadinessPath || !fs.existsSync(finalReadinessPath)) {
    throw new Error('Missing final readiness evidence. Run pnpm run verify:v15-final-readiness first.');
  }
  const finalReadiness = readJson(finalReadinessPath);
  finalReadiness.__path = finalReadinessPath;
  assertManifestDrivenFinalReadiness(finalReadiness, finalReadinessPath);
  const claimsAppReady = finalReadiness.status === 'APP_READY' || finalReadiness.appReady === true;
  const recordedAuthorityDbPath = finalReadiness.evidenceSelection?.authorityDbPath;
  const authorityDbPath = recordedAuthorityDbPath || claimsAppReady
    ? resolveBoundAdReadbackAuthorityDbPath(recordedAuthorityDbPath, args.db)
    : null;
  assertSelectedReadbackPassesVerifier(finalReadiness, authorityDbPath);
  const readmePath = path.resolve(args.readme || path.join(root, 'README.md'));
  const packageUiManifestPath = explicitFileArg(args, 'package-ui-manifest');
  const workspaceUiManifestPath = explicitFileArg(args, 'workspace-ui-manifest');
  const businessUiSmokePath = explicitFileArg(args, 'business-ui-smoke');
  const fullTestEvidencePath = explicitFileArg(args, 'full-test-evidence');
  const packageSecurityEvidencePath = explicitFileArg(args, 'package-security-evidence');
  const packageAdversarialNodeEnvEvidencePath = explicitFileArg(args, 'package-adversarial-node-env-evidence');
  if (packageSecurityEvidencePath) {
    const validation = validatePackageSecurityEvidence(readJson(packageSecurityEvidencePath));
    if (!validation.passed) {
      throw new Error(`Refusing to export invalid package security evidence: ${validation.violations.join('; ')}`);
    }
  }
  const adversarialNodeEnvSelectionContract = validateAdversarialNodeEnvSelectionContract(
    finalReadiness.packageAdversarialNodeEnv,
  );
  if (!adversarialNodeEnvSelectionContract.passed) {
    throw new Error(
      `Refusing to export final readiness without the current adversarial NODE_ENV package evidence contract ${PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION}: `
      + adversarialNodeEnvSelectionContract.violations.join('; '),
    );
  }
  if (!packageAdversarialNodeEnvEvidencePath) {
    throw new Error('Refusing to export current delivery bundle without explicit adversarial NODE_ENV package evidence.');
  }
  if (packageAdversarialNodeEnvEvidencePath) {
    const selected = finalReadiness.packageAdversarialNodeEnv;
    const validation = validateAdversarialNodeEnvEvidence(
      readJson(packageAdversarialNodeEnvEvidencePath),
      selected?.package || {},
    );
    if (!validation.passed) {
      throw new Error(`Refusing to export invalid adversarial NODE_ENV package evidence: ${validation.violations.join('; ')}`);
    }
    if (
      selected?.passed !== true
      || !selected?.evidencePath
      || !samePath(selected.evidencePath, packageAdversarialNodeEnvEvidencePath)
      || !/^[A-F0-9]{64}$/.test(String(selected?.evidenceSha256 || ''))
      || sha256(packageAdversarialNodeEnvEvidencePath) !== String(selected.evidenceSha256).toUpperCase()
    ) {
      throw new Error('Refusing to export adversarial NODE_ENV evidence that is not the passing hash-bound selection in final readiness.');
    }
  }
  assertAppReadyReadmeState(finalReadiness, readmePath);

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
    authorityDatabase: {
      sourcePath: authorityDbPath,
      existsAtExport: Boolean(authorityDbPath && fs.existsSync(authorityDbPath)),
      copied: false,
      policy: 'SQLite authority database identity is recorded for revalidation and the database file is never copied.',
    },
    files: [],
    missing: [],
    dataReconciliation: {
      present: false,
      canonicalSource: null,
      canonical: null,
      blockers: [],
      sourceJsonPath: null,
      sourceMarkdownPath: null,
      bundleJson: null,
      bundleMarkdown: null,
    },
    finalReadinessBlockers: collectFinalReadinessBlockers(finalReadiness),
    realReportIndex: {
      present: false,
      count: 0,
      existingCount: 0,
      missingCount: 0,
      bundleJson: null,
      copyPolicy: 'Raw Lingxing report spreadsheets are not copied into the delivery bundle.',
    },
    packageIndex: {
      present: false,
      count: 0,
      existingCount: 0,
      missingCount: 0,
      bundleJson: null,
      copyPolicy: 'Installer and portable EXE binaries are not copied into the delivery bundle.',
    },
    uiEvidence: {
      packageUiManifest: {
        sourcePath: packageUiManifestPath,
        present: Boolean(packageUiManifestPath),
      },
      workspaceUiManifest: {
        sourcePath: workspaceUiManifestPath,
        present: Boolean(workspaceUiManifestPath),
      },
      copyPolicy: 'Explicit package/workspace UI manifests and every referenced screenshot/target JSON are copied into the bundle.',
    },
    sourceEvidence: {
      businessUiSmoke: {
        sourcePath: businessUiSmokePath,
        present: Boolean(businessUiSmokePath),
      },
      fullTestEvidence: {
        sourcePath: fullTestEvidencePath,
        present: Boolean(fullTestEvidencePath),
      },
      copyPolicy: 'Explicit source-level smoke and full-test evidence are copied into the bundle without latest-file discovery.',
    },
    securityEvidence: {
      packageSecurityBoundaries: {
        sourcePath: packageSecurityEvidencePath,
        present: Boolean(packageSecurityEvidencePath),
        bundlePath: null,
        sha256: null,
      },
      packageAdversarialNodeEnvSmoke: {
        contractVersion: PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
        sourcePath: packageAdversarialNodeEnvEvidencePath,
        present: Boolean(packageAdversarialNodeEnvEvidencePath),
        requiredByFinalReadiness: true,
        bundlePath: null,
        sha256: null,
      },
      copyPolicy: 'Explicit static and adversarial-runtime package security evidence is schema-validated and copied without source paths, URLs, or credential values in its payload.',
    },
  };

  const docsDir = path.join(bundleDir, 'docs');
  copyFile(readmePath, docsDir, 'README.md', manifest);
  for (const relativePath of [
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
    'scripts/smoke-export-v15-delivery-bundle.js',
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
    'scripts/prepare-ad-readback-session.js',
    'scripts/verify-ad-readback-session.js',
    'scripts/fill-ad-readback-session.js',
    'scripts/fill-ad-readback-evidence.js',
    'scripts/ad-readback-authority-db.js',
    'scripts/verify-ad-readback-evidence.js',
    'scripts/reconcile-lingxing-full8-data.js',
    'scripts/smoke-package-security-boundaries.js',
    'scripts/smoke-package-adversarial-node-env.js',
  ]) {
    copyFile(path.join(root, relativePath), scriptsDir, relativePath, manifest);
  }
  writeGitSnapshot(bundleDir, manifest);

  const evidenceOutDir = path.join(bundleDir, 'evidence');
  const screenshotsDir = path.join(bundleDir, 'screenshots');
  const dataReconciliation = resolveDataReconciliationEvidence(args);
  const copiedDataReconciliationJson = dataReconciliation.sourceJsonPath
    ? copyFile(dataReconciliation.sourceJsonPath, evidenceOutDir, 'data-reconciliation:json', manifest)
    : null;
  const copiedDataReconciliationMarkdown = dataReconciliation.sourceMarkdownPath
    ? copyFile(dataReconciliation.sourceMarkdownPath, evidenceOutDir, 'data-reconciliation:markdown', manifest)
    : null;
  manifest.dataReconciliation = {
    present: dataReconciliation.present,
    canonicalSource: dataReconciliation.canonicalSource,
    canonical: dataReconciliation.canonical,
    blockers: dataReconciliation.blockers,
    sourceJsonPath: dataReconciliation.sourceJsonPath,
    sourceMarkdownPath: dataReconciliation.sourceMarkdownPath,
    bundleJson: copiedDataReconciliationJson ? path.relative(bundleDir, copiedDataReconciliationJson) : null,
    bundleMarkdown: copiedDataReconciliationMarkdown ? path.relative(bundleDir, copiedDataReconciliationMarkdown) : null,
  };
  if (manifest.appReady && manifest.dataReconciliation.blockers.length > 0) {
    throw new Error(`Refusing to export APP_READY delivery bundle because data reconciliation has blockers: ${manifest.dataReconciliation.blockers.join('; ')}`);
  }
  if (manifest.appReady && Number(manifest.dataReconciliation.canonical?.spend || 0) <= 0) {
    throw new Error('Refusing to export APP_READY delivery bundle because data reconciliation has no positive canonical ad spend.');
  }

  const evidencePaths = collectEvidencePaths(finalReadiness, {
    includeLatestExtras: args['skip-latest-extras'] !== 'true',
    packageUiManifest: packageUiManifestPath,
    workspaceUiManifest: workspaceUiManifestPath,
    businessUiSmoke: businessUiSmokePath,
    fullTestEvidence: fullTestEvidencePath,
    packageSecurityEvidence: packageSecurityEvidencePath,
    packageAdversarialNodeEnvEvidence: packageAdversarialNodeEnvEvidencePath,
  });
  const packageIndex = buildPackageIndex(path.resolve(args['release-dir'] || path.join(root, 'apps', 'desktop', 'release')));
  assertAppReadyFinalReadinessHasPackageEvidence(finalReadiness, packageIndex);
  const packageIndexPath = writePackageIndex(bundleDir, evidenceOutDir, manifest, packageIndex);
  manifest.packageIndex = {
    present: packageIndex.packages.length > 0,
    count: packageIndex.packages.length,
    existingCount: packageIndex.packages.filter((item) => item.exists).length,
    missingCount: packageIndex.packages.filter((item) => !item.exists).length,
    bundleJson: path.relative(bundleDir, packageIndexPath),
    copyPolicy: packageIndex.copyPolicy,
  };
  if (manifest.appReady) {
    if (!manifest.packageIndex.present || manifest.packageIndex.count <= 0) {
      throw new Error('Refusing to export APP_READY delivery bundle because installer/package hash evidence is missing.');
    }
    if (!packageIndex.packages.some((item) => item.kind === 'installer')) {
      throw new Error('Refusing to export APP_READY delivery bundle because installer package hash evidence is missing.');
    }
    if (!packageIndex.packages.some((item) => item.kind === 'portable')) {
      throw new Error('Refusing to export APP_READY delivery bundle because portable no-install package hash evidence is missing.');
    }
    if (manifest.packageIndex.missingCount > 0) {
      throw new Error('Refusing to export APP_READY delivery bundle because installer/package index has missing files.');
    }
  }

  const reportIndex = buildRealReportIndex({
    finalReadiness,
    dataReconciliation: dataReconciliation.sourceJsonPath ? readJson(dataReconciliation.sourceJsonPath) : null,
    evidencePaths,
  });
  const reportIndexPath = writeRealReportIndex(bundleDir, evidenceOutDir, manifest, reportIndex);
  manifest.realReportIndex = {
    present: reportIndex.reports.length > 0,
    count: reportIndex.reports.length,
    existingCount: reportIndex.reports.filter((report) => report.exists).length,
    missingCount: reportIndex.reports.filter((report) => !report.exists).length,
    bundleJson: path.relative(bundleDir, reportIndexPath),
    copyPolicy: reportIndex.copyPolicy,
  };
  if (manifest.appReady) {
    if (!manifest.realReportIndex.present || manifest.realReportIndex.count <= 0) {
      throw new Error('Refusing to export APP_READY delivery bundle because real report index has no source reports.');
    }
    if (manifest.realReportIndex.missingCount > 0) {
      throw new Error('Refusing to export APP_READY delivery bundle because real report index has missing source reports.');
    }
  }

  for (const launchEvidencePath of validatedPackageLaunchEvidencePaths) {
    const validation = validatePackageLaunchSmokeEvidence(readJson(launchEvidencePath));
    if (!validation.passed) {
      throw new Error(`Package launch strict contract changed before bundle copy: ${validation.violations
        .map((violation) => `${violation.code}@${violation.path}`)
        .join('; ')}`);
    }
  }
  for (const sourcePath of evidencePaths) {
    const ext = path.extname(sourcePath).toLowerCase();
    const destinationDir = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? screenshotsDir : evidenceOutDir;
    const copied = copyFile(sourcePath, destinationDir, `evidence:${path.basename(sourcePath)}`, manifest);
    if (copied) assertNoObviousSecret(copied);
  }

  if (packageSecurityEvidencePath) {
    const bundledSecurityEvidence = manifest.files.find((file) => file.sourcePath === packageSecurityEvidencePath);
    if (!bundledSecurityEvidence) {
      throw new Error('Package security evidence was selected but not copied into the delivery bundle.');
    }
    manifest.securityEvidence.packageSecurityBoundaries.bundlePath = bundledSecurityEvidence.bundlePath;
    manifest.securityEvidence.packageSecurityBoundaries.sha256 = bundledSecurityEvidence.sha256;
  }
  if (packageAdversarialNodeEnvEvidencePath) {
    const bundledEvidence = manifest.files.find((file) => file.sourcePath === packageAdversarialNodeEnvEvidencePath);
    if (!bundledEvidence) {
      throw new Error('Adversarial NODE_ENV package evidence was selected but not copied into the delivery bundle.');
    }
    manifest.securityEvidence.packageAdversarialNodeEnvSmoke.bundlePath = bundledEvidence.bundlePath;
    manifest.securityEvidence.packageAdversarialNodeEnvSmoke.sha256 = bundledEvidence.sha256;
    const summaryContract = validateAdversarialNodeEnvBundleSummaryContract(
      manifest.securityEvidence.packageAdversarialNodeEnvSmoke,
    );
    if (!summaryContract.passed) {
      throw new Error(`Invalid adversarial NODE_ENV bundle summary contract: ${summaryContract.violations.join('; ')}`);
    }
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
