const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { resolveBoundAdReadbackAuthorityDbPath } = require('./ad-readback-authority-db');
const {
  PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
  rendererPathIdentity,
  validateAdversarialNodeEnvBundleSummaryContract,
  validateAdversarialNodeEnvEvidence,
  validateAdversarialNodeEnvManifestEntryContract,
  validateAdversarialNodeEnvSelectionContract,
} = require('./smoke-package-adversarial-node-env');
const { validatePackageSecurityEvidence } = require('./smoke-package-security-boundaries');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const bundleRoot = path.join(root, 'output', 'delivery-bundles');
const finalReadinessPattern = /^final-readiness-(?:\d{4}-\d{2}-\d{2}|\d{10,})\.json$/i;
const packageLaunchSmokePattern = /^package-launch-smoke-\d+\.json$/i;
const DIAGNOSTIC_RENDERER_ENTRY_LIMIT = 100;
const expectedNonReadyGateIds = new Set([
  'report-collection-delivery',
  'lingxing-listing-full-read',
  'ai-live-provider',
  'ad-recommendation-ai-explanation',
  'listing-ai-draft',
  'real-ad-execution-readback',
  'release-package-hash',
  'package-launch-smoke',
]);

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

function latestBundleManifest() {
  if (!fs.existsSync(bundleRoot)) return null;
  const files = fs.readdirSync(bundleRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(bundleRoot, entry.name, 'delivery-bundle-manifest.json'))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.filePath || null;
}

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

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} file is missing: ${filePath}`);
  }
}

function gateByName(finalReadiness, name) {
  return (finalReadiness.gates || []).find((gate) => gate.name === name);
}

function gateById(finalReadiness, id) {
  return (finalReadiness.gates || []).find((gate) => gate.id === id);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function normalizedPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  const resolved = path.resolve(filePath);
  let canonical = resolved;
  try {
    canonical = fs.realpathSync.native(resolved);
  } catch {
    // Callers separately validate existence where it is required.
  }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function samePath(left, right) {
  const normalizedLeft = normalizedPath(left);
  return Boolean(normalizedLeft && normalizedLeft === normalizedPath(right));
}

function validArtifact(artifact) {
  if (!artifact?.path || !fs.existsSync(artifact.path)) return false;
  try {
    const stat = fs.statSync(artifact.path);
    if (!stat.isFile() || Number(artifact.sizeBytes || 0) <= 0) return false;
    if (stat.size !== Number(artifact.sizeBytes || 0)) return false;
    return /^[A-F0-9]{64}$/.test(String(artifact.sha256 || ''))
      && sha256(artifact.path) === String(artifact.sha256 || '').toUpperCase();
  } catch {
    return false;
  }
}

function artifactsMatch(left, right) {
  return Boolean(left && right)
    && samePath(left.path, right.path)
    && Number(left.sizeBytes || 0) === Number(right.sizeBytes || 0)
    && String(left.sha256 || '').toUpperCase() === String(right.sha256 || '').toUpperCase();
}

function check(condition, message, failures) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    return;
  }
  failures.push(message);
  console.error(`[FAIL] ${message}`);
}

function readmeStatesNonReady(readme) {
  return /\*\*DELIVERY:\s*(IN_PROGRESS|APP_NEEDS_WORK|REPORT_COLLECTION_READY \/ APP_NEEDS_WORK)\b/.test(readme)
    && !/\*\*DELIVERY:\s*APP_READY\b/.test(readme);
}

function selectedAdReadbackPath(finalReadiness) {
  const manifestPath = finalReadiness.evidenceSelection?.manifestPath;
  if (!manifestPath || !fs.existsSync(path.resolve(manifestPath))) return '';
  try {
    const evidenceManifest = readJson(path.resolve(manifestPath));
    return evidenceManifest.evidence?.adReadback?.absolutePath || '';
  } catch {
    return '';
  }
}

function hasOnlyLegacySourceTraceabilityFailure(output) {
  const failureLines = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('[FAIL]'));
  return failureLines.length === 1 && failureLines[0] === '[FAIL] source report traceability is incomplete';
}

function hasCurrentPackageHashEvidence(finalReadiness) {
  const releasePackageGate = gateById(finalReadiness, 'release-package-hash')
    || gateByName(finalReadiness, 'Release package hash');
  const index = finalReadiness.packageIndex;
  if (!releasePackageGate || releasePackageGate.ok !== true || releasePackageGate.status !== 'passed') return false;
  if (index?.present !== true) return false;
  if (Number(index.count || 0) <= 0) return false;
  if (Number(index.existingCount || 0) !== Number(index.count || 0)) return false;
  if (Number(index.missingCount || 0) !== 0) return false;
  if (!Array.isArray(index.packages)) return false;
  if (index.packages.length !== Number(index.count || 0)) return false;
  if (!index.packages.some((item) => item.kind === 'installer')) return false;
  if (!index.packages.some((item) => item.kind === 'portable')) return false;
  return index.packages.every((item) => {
    if (item?.exists !== true || !item?.sourcePath || !item?.fileName) return false;
    return validArtifact({
      path: item.sourcePath,
      sizeBytes: item.sizeBytes,
      sha256: item.sha256,
    });
  });
}

function packageIdentity(item) {
  return [
    String(item?.kind || ''),
    normalizedPath(item?.sourcePath),
    String(item?.fileName || ''),
  ].join('\u0000');
}

function packageEvidenceRecord(item) {
  return {
    kind: String(item?.kind || ''),
    sourcePath: normalizedPath(item?.sourcePath),
    fileName: String(item?.fileName || ''),
    exists: item?.exists === true,
    sizeBytes: Number(item?.sizeBytes || 0),
    sha256: String(item?.sha256 || '').toUpperCase(),
    modifiedAt: String(item?.modifiedAt || ''),
  };
}

function packageEvidenceListsMatch(leftPackages, rightPackages) {
  if (!Array.isArray(leftPackages) || !Array.isArray(rightPackages)) return false;
  if (leftPackages.length !== rightPackages.length) return false;
  const left = [...leftPackages].sort((a, b) => packageIdentity(a).localeCompare(packageIdentity(b)));
  const right = [...rightPackages].sort((a, b) => packageIdentity(a).localeCompare(packageIdentity(b)));
  return left.every((item, index) => (
    JSON.stringify(packageEvidenceRecord(item)) === JSON.stringify(packageEvidenceRecord(right[index]))
  ));
}

function pathIsInside(filePath, parentDir) {
  const relative = path.relative(normalizedPath(parentDir), normalizedPath(filePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function bundleFileRecordMatches(manifest, bundleManifestPath, label, expectedPath) {
  const record = Array.isArray(manifest.files)
    ? manifest.files.find((item) => item?.label === label && item?.bundlePath)
    : null;
  if (!record) return false;
  const recordedPath = path.resolve(path.dirname(bundleManifestPath), record.bundlePath);
  if (!samePath(recordedPath, expectedPath) || !pathIsInside(recordedPath, path.dirname(bundleManifestPath))) return false;
  return validArtifact({
    path: recordedPath,
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
  });
}

function bundlePackageIndexMatchesFinalReadiness(finalReadiness, manifest, bundleManifestPath) {
  const summary = manifest.packageIndex;
  const finalIndex = finalReadiness.packageIndex;
  if (summary?.present !== true || !summary.bundleJson || !finalIndex) return false;
  if (Number(summary.count || 0) !== Number(finalIndex.count || 0)) return false;
  if (Number(summary.existingCount || 0) !== Number(finalIndex.existingCount || 0)) return false;
  if (Number(summary.missingCount || 0) !== Number(finalIndex.missingCount || 0)) return false;
  const indexPath = path.resolve(path.dirname(bundleManifestPath), summary.bundleJson);
  if (!pathIsInside(indexPath, path.dirname(bundleManifestPath))) return false;
  if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) return false;
  if (!bundleFileRecordMatches(manifest, bundleManifestPath, 'release-package-index', indexPath)) return false;
  let bundleIndex;
  try {
    bundleIndex = readJson(indexPath);
  } catch {
    return false;
  }
  if (!samePath(bundleIndex.releaseDir, finalIndex.releaseDir)) return false;
  if (!packageEvidenceListsMatch(bundleIndex.packages, finalIndex.packages)) return false;
  const packages = Array.isArray(bundleIndex.packages) ? bundleIndex.packages : [];
  if (packages.length !== Number(summary.count || 0)) return false;
  return packages.every((item) => item?.exists === true && validArtifact({
    path: item.sourcePath,
    sizeBytes: item.sizeBytes,
    sha256: item.sha256,
  }));
}

function bundleSourceFileMatches(manifest, bundleManifestPath, sourcePath) {
  const record = Array.isArray(manifest.files)
    ? manifest.files.find((item) => samePath(item?.sourcePath, sourcePath) && item?.bundlePath)
    : null;
  if (!record) return false;
  const bundledPath = path.resolve(path.dirname(bundleManifestPath), record.bundlePath);
  if (!pathIsInside(bundledPath, path.dirname(bundleManifestPath))) return false;
  if (!validArtifact({ path: bundledPath, sizeBytes: record.sizeBytes, sha256: record.sha256 })) return false;
  return fs.statSync(sourcePath).size === Number(record.sizeBytes || 0)
    && sha256(sourcePath) === String(record.sha256 || '').toUpperCase();
}

function viewportMatchesBoundedContract(run, requestedViewport, expectedDeviceScaleFactor) {
  const actualWidth = Number(run?.viewport?.width);
  const actualHeight = Number(run?.viewport?.height);
  const requestedWidth = Number(requestedViewport?.width);
  const requestedHeight = Number(requestedViewport?.height);
  const actualDeviceScaleFactor = Number(run?.actualDeviceScaleFactor);
  const contract = run?.viewportContract;
  if (!Number.isFinite(actualWidth)
    || !Number.isFinite(actualHeight)
    || !Number.isFinite(requestedWidth)
    || !Number.isFinite(requestedHeight)
    || !Number.isFinite(actualDeviceScaleFactor)
    || actualDeviceScaleFactor !== expectedDeviceScaleFactor
    || contract?.passed !== true
    || (Array.isArray(contract?.violations) && contract.violations.length > 0)) {
    return false;
  }

  if (actualWidth === requestedWidth && actualHeight === requestedHeight) return true;

  const contractRequested = contract?.requested;
  const contractActual = contract?.actual;
  const tolerance = contract?.tolerance;
  const widthTolerance = Number(tolerance?.width);
  const heightTolerance = Number(tolerance?.height);
  const scaleTolerance = Number(tolerance?.deviceScaleFactor);
  const boundedTolerance = Number.isFinite(widthTolerance)
    && Number.isFinite(heightTolerance)
    && Number.isFinite(scaleTolerance)
    && widthTolerance >= 0
    && heightTolerance >= 0
    && scaleTolerance >= 0
    && widthTolerance <= 2
    && heightTolerance <= 2
    && scaleTolerance <= 0.02;

  return boundedTolerance
    && Number(contractRequested?.width) === requestedWidth
    && Number(contractRequested?.height) === requestedHeight
    && Number(contractRequested?.deviceScaleFactor) === expectedDeviceScaleFactor
    && Number(contractActual?.width) === actualWidth
    && Number(contractActual?.height) === actualHeight
    && Number(contractActual?.deviceScaleFactor) === actualDeviceScaleFactor
    && Math.abs(actualWidth - requestedWidth) <= widthTolerance
    && Math.abs(actualHeight - requestedHeight) <= heightTolerance
    && Math.abs(actualDeviceScaleFactor - expectedDeviceScaleFactor) <= scaleTolerance;
}

function processSnapshotIsStrictlyZero(snapshot, expectedProfilePath, requireAttempts = false) {
  if (snapshot?.passed !== true
    || !Number.isInteger(snapshot?.observedCount)
    || snapshot.observedCount < 0
    || !Array.isArray(snapshot?.matching)
    || snapshot?.matchingCount !== 0
    || snapshot.matchingCount !== snapshot.matching.length
    || !Array.isArray(snapshot?.unresolved)
    || snapshot?.unresolvedCount !== 0
    || snapshot.unresolvedCount !== snapshot.unresolved.length
    || snapshot.observedCount < snapshot.matchingCount + snapshot.unresolvedCount
    || snapshot?.error !== null
    || (requireAttempts && (!Number.isInteger(snapshot?.attempts) || snapshot.attempts < 1))) {
    return false;
  }
  if (expectedProfilePath && !samePath(snapshot.profilePath, expectedProfilePath)) return false;
  return true;
}

function containsCommandLineField(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsCommandLineField(item));
  return Object.entries(value).some(([key, item]) => (
    /^commandline$/i.test(key) || containsCommandLineField(item)
  ));
}

function processIsolationIsStrictlyValid(evidence, expectedProfilePath = null) {
  return evidence?.passed === true
    && processSnapshotIsStrictlyZero(evidence.before, expectedProfilePath)
    && processSnapshotIsStrictlyZero(evidence.after, expectedProfilePath, true)
    && (!expectedProfilePath || !containsCommandLineField(evidence));
}

function redactDiagnosticSecrets(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/gi, '[REDACTED_API_KEY]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|authorization|cookie|password|pwd|secret|session(?:[_-]?(?:id|key|token))?|token|username|user[_-]?name|account)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/(--(?:api[-_]?key|access[-_]?token|authorization|cookie|password|passwd|pwd|secret|session(?:[-_]?(?:id|key|token))?|token|username|user[-_]?name|account))(\s*=\s*|\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi, '$1$2[REDACTED]')
    .replace(/(\b(?:authorization|proxy-authorization)\s*[:=])[^\r\n]*/gi, '$1 [REDACTED]')
    .replace(/(\b(?:cookie|set-cookie)\s*:)[^\r\n]*/gi, '$1 [REDACTED]')
    .replace(/(\bbearer\s+)[A-Za-z0-9._~+/-]{6,}/gi, '$1[REDACTED]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|authorization|cookie|password|passwd|pwd|secret|session(?:[_ -]?(?:id|key|token))?|token|username|user_name|account)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,]+)/gi, '$1[REDACTED]');
}

function diagnosticValueIsSanitized(value, depth = 0) {
  if (depth > 12) return false;
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return true;
  if (typeof value === 'string') {
    if (value.length > 4_000) return false;
    return redactDiagnosticSecrets(value) === value;
  }
  if (Array.isArray(value)) return value.every((item) => diagnosticValueIsSanitized(item, depth + 1));
  if (typeof value !== 'object') return false;
  return Object.entries(value).every(([entryKey, item]) => (
    !/^(?:api[_-]?key|password|passwd|pwd|secret|token|access[_-]?token|authorization|cookie|set-cookie|session(?:[_-]?(?:id|key|token))?|username|user_name|account|commandline)$/i.test(entryKey)
    && diagnosticValueIsSanitized(item, depth + 1)
  ));
}

function runDiagnosticsAreStrictlyValid(diagnostics, run, expectedProfileId) {
  const startedAt = Date.parse(diagnostics?.startedAt);
  const completedAt = Date.parse(diagnostics?.completedAt);
  const loginStartedAt = Date.parse(diagnostics?.login?.startedAt);
  const loginCompletedAt = Date.parse(diagnostics?.login?.completedAt);
  const timeline = diagnostics?.timeline;
  const loginAttempts = diagnostics?.login?.attempts;
  const renderer = diagnostics?.renderer;
  const successfulLoginOutcomes = new Set([
    'existing-authenticated-session',
    'saved-credentials-auto-login',
    'saved-credentials-login',
  ]);
  const timelineValid = Array.isArray(timeline)
    && timeline.length >= 2
    && timeline.every((item) => (
      Number.isFinite(Date.parse(item?.at))
      && Date.parse(item.at) >= startedAt
      && Date.parse(item.at) <= completedAt
      && typeof item?.phase === 'string'
      && item.phase.length > 0
      && item.phase.length <= 160
    ))
    && timeline.at(-1)?.phase === 'completed';
  const loginAttemptsValid = Array.isArray(loginAttempts)
    && loginAttempts.every((attempt) => (
      Number.isInteger(attempt?.attempt)
      && attempt.attempt >= 1
      && Number.isFinite(Date.parse(attempt?.startedAt))
      && Number.isFinite(Date.parse(attempt?.completedAt))
      && Date.parse(attempt.completedAt) >= Date.parse(attempt.startedAt)
      && typeof attempt?.outcome === 'string'
      && attempt.outcome !== 'in-progress'
      && typeof attempt?.retryable === 'boolean'
      && (attempt.message === null || typeof attempt.message === 'string')
    ));
  return diagnostics?.schemaVersion === 'package-ui-run-diagnostics/v1'
    && diagnostics?.profileId === expectedProfileId
    && Number.isFinite(startedAt)
    && Number.isFinite(completedAt)
    && completedAt >= startedAt
    && diagnostics.phase === 'completed'
    && diagnostics.failure === null
    && Array.isArray(diagnostics.cleanupErrors)
    && diagnostics.cleanupErrors.length === 0
    && timelineValid
    && renderer?.limits?.consoleErrors === DIAGNOSTIC_RENDERER_ENTRY_LIMIT
    && renderer?.limits?.pageErrors === DIAGNOSTIC_RENDERER_ENTRY_LIMIT
    && renderer?.droppedCount?.consoleErrors === 0
    && renderer?.droppedCount?.pageErrors === 0
    && Array.isArray(renderer?.consoleErrors)
    && renderer.consoleErrors.length <= DIAGNOSTIC_RENDERER_ENTRY_LIMIT
    && renderer.consoleErrors.length === 0
    && Array.isArray(renderer?.pageErrors)
    && renderer.pageErrors.length <= DIAGNOSTIC_RENDERER_ENTRY_LIMIT
    && renderer.pageErrors.length === 0
    && Array.isArray(run?.consoleErrors)
    && run.consoleErrors.length === 0
    && Array.isArray(run?.pageErrors)
    && run.pageErrors.length === 0
    && Number.isFinite(loginStartedAt)
    && Number.isFinite(loginCompletedAt)
    && loginCompletedAt >= loginStartedAt
    && successfulLoginOutcomes.has(diagnostics?.login?.outcome)
    && loginAttemptsValid
    && diagnosticValueIsSanitized(diagnostics);
}

function packageUiEvidenceIsStrictlyValid({
  filePath,
  finalReadiness,
  manifest,
  bundleManifestPath,
  smoke,
}) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  try {
    const packageUi = readJson(filePath);
    const runs = Array.isArray(packageUi.runs) ? packageUi.runs : [];
    const expectedScales = new Map([[100, 1], [125, 1.25]]);
    const requestedProfileBrowserPath = packageUi.requested?.profileBrowserUserDataDir;
    const expectedProfileBrowserPath = packageUi.requested?.userDataDir
      ? path.join(packageUi.requested.userDataDir, 'storage', 'browser-data')
      : null;
    const profileBrowserPathBound = Boolean(requestedProfileBrowserPath)
      && Boolean(expectedProfileBrowserPath)
      && samePath(requestedProfileBrowserPath, expectedProfileBrowserPath);
    const runsComplete = runs.length === expectedScales.size
      && new Set(runs.map((run) => run?.scalePercent)).size === expectedScales.size
      && runs.every((run) => (
        expectedScales.has(run?.scalePercent)
        && viewportMatchesBoundedContract(
          run,
          packageUi.requested?.viewport,
          expectedScales.get(run.scalePercent),
        )
        && run?.passed === true
        && processIsolationIsStrictlyValid(run?.packageProcessIsolation)
        && processIsolationIsStrictlyValid(run?.profileProcessIsolation, requestedProfileBrowserPath)
        && runDiagnosticsAreStrictlyValid(run?.diagnostics, run, `${run.scalePercent}-compact`)
        && Array.isArray(run?.consoleErrors)
        && run.consoleErrors.length === 0
        && Array.isArray(run?.pageErrors)
        && run.pageErrors.length === 0
        && Array.isArray(run?.screenshots)
        && run.screenshots.length >= 8
        && Array.isArray(run?.workspaceChecks)
        && run.workspaceChecks.length >= 8
        && run.workspaceChecks.every((item) => item?.passed === true)
        && Array.isArray(run?.overlayChecks)
        && run.overlayChecks.length >= 3
        && run.overlayChecks.every((item) => item?.passed === true)
      ));
    const wideProfile = packageUi.wideProfile;
    const wideWorkspaceNames = new Set(['product', 'diagnosis']);
    const wideWorkspaceChecks = Array.isArray(wideProfile?.workspaceChecks) ? wideProfile.workspaceChecks : [];
    const wideScreenshots = Array.isArray(wideProfile?.screenshots) ? wideProfile.screenshots : [];
    const wideProfileComplete = packageUi.requested?.wideProfile?.id === 'wide-1400x900-100'
      && packageUi.requested?.wideProfile?.viewport?.width === 1400
      && packageUi.requested?.wideProfile?.viewport?.height === 900
      && Number(packageUi.requested?.wideProfile?.deviceScaleFactor) === 1
      && wideProfile?.profileId === 'wide-1400x900-100'
      && wideProfile?.passed === true
      && wideProfile?.viewport?.width === 1400
      && wideProfile?.viewport?.height === 900
      && Number(wideProfile?.actualDeviceScaleFactor) === 1
      && wideProfile?.viewportContract?.passed === true
      && wideProfile?.identity?.passed === true
      && processIsolationIsStrictlyValid(wideProfile?.packageProcessIsolation)
      && processIsolationIsStrictlyValid(wideProfile?.profileProcessIsolation, requestedProfileBrowserPath)
      && runDiagnosticsAreStrictlyValid(wideProfile?.diagnostics, wideProfile, 'wide-1400x900-100')
      && Array.isArray(wideProfile?.consoleErrors)
      && wideProfile.consoleErrors.length === 0
      && Array.isArray(wideProfile?.pageErrors)
      && wideProfile.pageErrors.length === 0
      && wideWorkspaceChecks.length === wideWorkspaceNames.size
      && new Set(wideWorkspaceChecks.map((item) => item?.workspace)).size === wideWorkspaceNames.size
      && wideWorkspaceChecks.every((item) => (
        wideWorkspaceNames.has(item?.workspace)
        && item?.passed === true
        && item?.experienceEvidence?.passed === true
        && item?.inspectorEvidence?.passed === true
        && item?.inspectorEvidence?.inspector?.mode === 'inline'
        && item?.inspectorEvidence?.inspector?.ariaModal !== 'true'
        && /^[A-F0-9]{64}$/.test(String(item?.inspectorEvidence?.screenshot?.sha256 || ''))
      ))
      && wideScreenshots.length === wideWorkspaceNames.size
      && new Set(wideScreenshots.map((item) => item?.workspace)).size === wideWorkspaceNames.size
      && wideScreenshots.every((item) => (
        wideWorkspaceNames.has(item?.workspace)
        && /^[A-F0-9]{64}$/.test(String(item?.sha256 || ''))
      ));
    const generatedAt = Date.parse(packageUi.generatedAt);
    const completedAt = Date.parse(packageUi.completedAt);
    const smokeGeneratedAt = Date.parse(smoke?.generatedAt);
    const exeBefore = packageUi.artifactsBefore?.exe;
    const exeAfter = packageUi.artifactsAfter?.exe;
    const appContentBefore = packageUi.artifactsBefore?.appContent;
    const appContentAfter = packageUi.artifactsAfter?.appContent;
    const requested = packageUi.requested || {};
    const protectedDatabase = packageUi.protectedDatabase;
    const profileDatabaseProvenance = packageUi.profileDatabaseProvenance;
    const dbBefore = protectedDatabase?.before;
    const dbAfter = protectedDatabase?.after;
    const authorityDbPath = finalReadiness.evidenceSelection?.authorityDbPath;
    const packageHashesValid = packageUi.artifactHashesStable === true
      && validArtifact(exeBefore)
      && validArtifact(exeAfter)
      && artifactsMatch(exeBefore, smoke?.artifacts?.unpacked)
      && artifactsMatch(exeAfter, smoke?.artifacts?.unpacked)
      && samePath(requested.executablePath, smoke?.artifacts?.unpacked?.path)
      && String(requested.expectedExeSha256 || '').toUpperCase() === String(smoke?.artifacts?.unpacked?.sha256 || '').toUpperCase()
      && String(requested.expectedAppContentSha256 || '').toUpperCase() === String(appContentBefore?.sha256 || '').toUpperCase()
      && String(appContentBefore?.sha256 || '').toUpperCase() === String(appContentAfter?.sha256 || '').toUpperCase()
      && samePath(requested.appContentPath, appContentBefore?.rootPath)
      && samePath(appContentBefore?.rootPath, appContentAfter?.rootPath);
    const databaseIsolated = protectedDatabase?.passed === true
      && protectedDatabase?.unchanged === true
      && samePath(requested.protectedDatabasePath, authorityDbPath)
      && samePath(dbBefore?.path, authorityDbPath)
      && samePath(dbAfter?.path, authorityDbPath)
      && String(dbBefore?.sha256 || '').toUpperCase() === String(dbAfter?.sha256 || '').toUpperCase()
      && Number(dbBefore?.sizeBytes || 0) === Number(dbAfter?.sizeBytes || 0)
      && Number(dbBefore?.mtimeMs || 0) === Number(dbAfter?.mtimeMs || 0)
      && validArtifact(dbAfter);
    const profileDatabaseProvenanceValid = profileDatabaseProvenance?.passed === true
      && profileDatabaseProvenance?.hashMatches === true
      && profileDatabaseProvenance?.sizeMatches === true
      && profileDatabaseProvenance?.pathsDistinct === true
      && Array.isArray(profileDatabaseProvenance?.violations)
      && profileDatabaseProvenance.violations.length === 0
      && !samePath(profileDatabaseProvenance?.profileDatabase?.path, authorityDbPath)
      && samePath(profileDatabaseProvenance?.protectedDatabase?.path, authorityDbPath)
      && String(profileDatabaseProvenance?.profileDatabase?.sha256 || '').toUpperCase() === String(dbBefore?.sha256 || '').toUpperCase()
      && String(profileDatabaseProvenance?.protectedDatabase?.sha256 || '').toUpperCase() === String(dbBefore?.sha256 || '').toUpperCase()
      && Number(profileDatabaseProvenance?.profileDatabase?.sizeBytes || 0) === Number(dbBefore?.sizeBytes || 0)
      && Number(profileDatabaseProvenance?.protectedDatabase?.sizeBytes || 0) === Number(dbBefore?.sizeBytes || 0);
    const processIsolated = processIsolationIsStrictlyValid(packageUi.packageProcessIsolation);
    const profileProcessIsolated = profileBrowserPathBound
      && processIsolationIsStrictlyValid(packageUi.profileProcessIsolation, requestedProfileBrowserPath);
    const bundled = manifest.uiEvidence?.packageUiManifest?.present === true
      && samePath(manifest.uiEvidence?.packageUiManifest?.sourcePath, filePath)
      && bundleSourceFileMatches(manifest, bundleManifestPath, filePath);
    return packageUi.kind === 'package-ui-evidence'
      && Number(packageUi.schemaVersion || 0) >= 5
      && packageUi.passed === true
      && Array.isArray(packageUi.violations)
      && packageUi.violations.length === 0
      && packageUi.freshness?.passed === true
      && Array.isArray(packageUi.freshness?.violations)
      && packageUi.freshness.violations.length === 0
      && packageUi.completeness?.passed === true
      && Array.isArray(packageUi.completeness?.violations)
      && packageUi.completeness.violations.length === 0
      && runsComplete
      && wideProfileComplete
      && Number.isFinite(generatedAt)
      && Number.isFinite(completedAt)
      && Number.isFinite(smokeGeneratedAt)
      && generatedAt >= smokeGeneratedAt
      && completedAt >= generatedAt
      && packageHashesValid
      && databaseIsolated
      && profileDatabaseProvenanceValid
      && processIsolated
      && profileProcessIsolated
      && bundled;
  } catch {
    return false;
  }
}

function readValidPackageLaunchSmoke(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    const smoke = readJson(filePath);
    const unpacked = smoke.artifacts?.unpacked;
    const portable = smoke.artifacts?.portable;
    const checks = Array.isArray(smoke.checks) ? smoke.checks : [];
    const hasCheck = (kind) => checks.some((item) => item?.kind === kind && item.ok === true);

    const valid = smoke.kind === 'package-launch-smoke'
      && smoke.passed === true
      && Number.isFinite(Date.parse(smoke.generatedAt))
      && validArtifact(unpacked)
      && validArtifact(portable)
      && hasCheck('win-unpacked')
      && hasCheck('portable');
    return valid ? smoke : null;
  } catch {
    return null;
  }
}

function packageLaunchSmokeMatchesFinalReadiness(finalReadiness, filePath, smoke) {
  const recorded = finalReadiness.packageLaunchSmoke;
  if (!recorded || !smoke) return false;
  const recordedChecks = Array.isArray(recorded.checks) ? recorded.checks : [];
  const hasRecordedCheck = (kind) => recordedChecks.some((item) => item?.kind === kind && item.ok === true);
  return recorded.present === true
    && recorded.passed === true
    && recorded.selectedBy === 'explicit-arg'
    && samePath(recorded.evidencePath, filePath)
    && String(recorded.generatedAt || '') === String(smoke.generatedAt || '')
    && artifactsMatch(recorded.artifacts?.unpacked, smoke.artifacts?.unpacked)
    && artifactsMatch(recorded.artifacts?.portable, smoke.artifacts?.portable)
    && hasRecordedCheck('win-unpacked')
    && hasRecordedCheck('portable');
}

function packageLaunchSmokeMatchesPackageIndex(finalReadiness, smoke) {
  if (!smoke || !Array.isArray(finalReadiness.packageIndex?.packages)) return false;
  const portablePackages = finalReadiness.packageIndex.packages.filter((item) => item?.kind === 'portable');
  if (portablePackages.length !== 1) return false;
  const portablePackage = portablePackages[0];
  return artifactsMatch(smoke.artifacts?.portable, {
    path: portablePackage.sourcePath,
    sizeBytes: portablePackage.sizeBytes,
    sha256: portablePackage.sha256,
  });
}

function packageSecurityEvidenceIsStrictlyValid({
  filePath,
  packageUiManifestPath,
  manifest,
  bundleManifestPath,
  smoke,
}) {
  if (!filePath || !packageUiManifestPath || !smoke || !fs.existsSync(filePath)) return false;
  try {
    const evidence = readJson(filePath);
    const packageUi = readJson(packageUiManifestPath);
    const expectedExecutableSha256 = smoke.artifacts?.unpacked?.sha256;
    const expectedAppContentSha256 = packageUi.artifactsAfter?.appContent?.sha256;
    const beforeMainBundles = (packageUi.artifactsBefore?.appContent?.files || [])
      .filter((item) => String(item?.path || '').replace(/\\/g, '/') === 'dist/main/index.js');
    const afterMainBundles = (packageUi.artifactsAfter?.appContent?.files || [])
      .filter((item) => String(item?.path || '').replace(/\\/g, '/') === 'dist/main/index.js');
    const expectedMainBundleSha256 = afterMainBundles.length === 1
      ? String(afterMainBundles[0]?.sha256 || '').toUpperCase()
      : '';
    const mainBundleIdentityBound = beforeMainBundles.length === 1
      && afterMainBundles.length === 1
      && /^[A-F0-9]{64}$/.test(expectedMainBundleSha256)
      && String(beforeMainBundles[0]?.sha256 || '').toUpperCase() === expectedMainBundleSha256;
    const validation = validatePackageSecurityEvidence(evidence, {
      executableSha256: expectedExecutableSha256,
      appContentSha256: expectedAppContentSha256,
      mainBundleSha256: expectedMainBundleSha256,
    });
    const bundled = manifest.securityEvidence?.packageSecurityBoundaries?.present === true
      && samePath(manifest.securityEvidence?.packageSecurityBoundaries?.sourcePath, filePath)
      && bundleSourceFileMatches(manifest, bundleManifestPath, filePath);
    return mainBundleIdentityBound
      && validation.passed
      && evidence.passed === true
      && bundled;
  } catch {
    return false;
  }
}

function packageAdversarialNodeEnvEvidenceIsStrictlyValid({
  filePath,
  finalReadiness,
  packageUiManifestPath,
  manifest,
  bundleManifestPath,
  smoke,
}) {
  if (!filePath || !packageUiManifestPath || !smoke || !fs.existsSync(filePath)) return false;
  try {
    const evidence = readJson(filePath);
    const packageUi = readJson(packageUiManifestPath);
    const appContentAfter = packageUi.artifactsAfter?.appContent;
    const beforeMainBundles = (packageUi.artifactsBefore?.appContent?.files || [])
      .filter((item) => String(item?.path || '').replace(/\\/g, '/') === 'dist/main/index.js');
    const afterMainBundles = (appContentAfter?.files || [])
      .filter((item) => String(item?.path || '').replace(/\\/g, '/') === 'dist/main/index.js');
    if (!appContentAfter?.rootPath || beforeMainBundles.length !== 1 || afterMainBundles.length !== 1) return false;
    const expectedMainBundleSha256 = String(afterMainBundles[0]?.sha256 || '').toUpperCase();
    if (String(beforeMainBundles[0]?.sha256 || '').toUpperCase() !== expectedMainBundleSha256) return false;
    const validation = validateAdversarialNodeEnvEvidence(evidence, {
      executableSha256: smoke.artifacts?.unpacked?.sha256,
      appContentSha256: appContentAfter.sha256,
      mainBundleSha256: expectedMainBundleSha256,
      rendererEntrySha256: rendererPathIdentity(path.join(appContentAfter.rootPath, 'dist', 'renderer', 'index.html')),
    });
    const selected = finalReadiness.packageAdversarialNodeEnv;
    const summary = manifest.securityEvidence?.packageAdversarialNodeEnvSmoke;
    const selectionContract = validateAdversarialNodeEnvSelectionContract(selected);
    const summaryContract = validateAdversarialNodeEnvBundleSummaryContract(summary);
    return validation.passed
      && selectionContract.passed
      && summaryContract.passed
      && samePath(selected?.evidencePath, filePath)
      && /^[A-F0-9]{64}$/.test(String(selected?.evidenceSha256 || ''))
      && String(selected.evidenceSha256).toUpperCase() === sha256(filePath)
      && samePath(summary?.sourcePath, filePath)
      && bundleSourceFileMatches(manifest, bundleManifestPath, filePath);
  } catch {
    return false;
  }
}

function hasBoundExistingAuthorityDb(finalReadiness, manifest, explicitPath) {
  const bundleAuthority = manifest.authorityDatabase;
  if (!bundleAuthority?.sourcePath || bundleAuthority.existsAtExport !== true || bundleAuthority.copied !== false) return false;
  try {
    const recordedPath = resolveBoundAdReadbackAuthorityDbPath(
      finalReadiness.evidenceSelection?.authorityDbPath,
      explicitPath,
    );
    return fs.statSync(recordedPath).isFile()
      && fs.statSync(bundleAuthority.sourcePath).isFile()
      && samePath(recordedPath, bundleAuthority.sourcePath);
  } catch {
    return false;
  }
}

function main() {
  const args = parseArgs(process.argv);
  const finalReadinessPath = path.resolve(args['final-readiness'] || latestEvidence(finalReadinessPattern) || path.join(evidenceDir, 'final-readiness-2026-06-09.json'));
  const bundleManifestPath = path.resolve(args['bundle-manifest'] || latestBundleManifest() || path.join(bundleRoot, 'v15-delivery-bundle-2026-06-09', 'delivery-bundle-manifest.json'));
  const packageLaunchSmokePath = args['package-launch-smoke']
    ? path.resolve(args['package-launch-smoke'])
    : latestEvidence(packageLaunchSmokePattern);
  const packageSecurityEvidencePath = args['package-security-evidence']
    ? path.resolve(args['package-security-evidence'])
    : '';
  const packageAdversarialNodeEnvEvidencePath = args['package-adversarial-node-env-evidence']
    ? path.resolve(args['package-adversarial-node-env-evidence'])
    : '';
  const readmePath = path.resolve(args.readme || path.join(root, 'README.md'));
  const failures = [];

  requireFile(finalReadinessPath, 'final readiness');
  requireFile(bundleManifestPath, 'delivery bundle manifest');
  requireFile(readmePath, 'README');

  const finalReadiness = readJson(finalReadinessPath);
  const manifest = readJson(bundleManifestPath);
  const readme = fs.readFileSync(readmePath, 'utf8');
  const aiLive = gateByName(finalReadiness, 'AI live provider');
  const adAiExplanation = gateByName(finalReadiness, 'Ad recommendation AI explanation');
  const listingAiDraft = gateByName(finalReadiness, 'Listing AI draft');
  const adReadback = gateByName(finalReadiness, 'Real ad execution readback');
  const releasePackageHash = gateById(finalReadiness, 'release-package-hash');
  const packageLaunchSmokeGate = gateById(finalReadiness, 'package-launch-smoke');
  const readmeNonReady = readmeStatesNonReady(readme);
  const explicitStrictNonReady = Boolean(args['package-ui-manifest']);
  const historicalReadyFinalReadiness = !explicitStrictNonReady && readmeNonReady && finalReadiness.status === 'APP_READY' && finalReadiness.appReady === true;
  const historicalReadyBundle = !explicitStrictNonReady && readmeNonReady && manifest.status === 'APP_READY' && manifest.appReady === true;
  const currentPackageHashEvidence = hasCurrentPackageHashEvidence(finalReadiness);
  const currentPackageLaunchSmoke = readValidPackageLaunchSmoke(packageLaunchSmokePath);
  const adversarialNodeEnvSelectionContract = validateAdversarialNodeEnvSelectionContract(
    finalReadiness.packageAdversarialNodeEnv,
  );

  check(finalReadiness.evidenceSelection?.mode === 'manifest', 'final readiness uses manifest evidence selection', failures);
  check(
    Boolean(finalReadiness.evidenceSelection?.manifestPath && fs.existsSync(path.resolve(finalReadiness.evidenceSelection.manifestPath))),
    'final readiness evidence manifest exists',
    failures,
  );
  if (historicalReadyFinalReadiness) {
    check(true, 'historical APP_READY final readiness is baseline only because README is non-ready', failures);
    check(
      currentPackageHashEvidence || Boolean(currentPackageLaunchSmoke),
      'historical APP_READY baseline has current package hash or launch smoke evidence',
      failures,
    );
  } else {
    let adversarialNodeEnvManifestContractPassed = false;
    try {
      const evidenceManifest = readJson(path.resolve(finalReadiness.evidenceSelection?.manifestPath || ''));
      adversarialNodeEnvManifestContractPassed = validateAdversarialNodeEnvManifestEntryContract(
        evidenceManifest.evidence?.packageAdversarialNodeEnv,
      ).passed;
    } catch {
      adversarialNodeEnvManifestContractPassed = false;
    }
    check(
      adversarialNodeEnvSelectionContract.passed,
      `current NON_READY safety requires ${PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION}`,
      failures,
    );
    check(
      adversarialNodeEnvManifestContractPassed,
      `evidence manifest requires ${PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION}`,
      failures,
    );
    check(
      Boolean(args['package-ui-manifest']),
      'strict APP_NEEDS_WORK requires an explicit package UI manifest',
      failures,
    );
    check(
      packageUiEvidenceIsStrictlyValid({
        filePath: args['package-ui-manifest'] ? path.resolve(args['package-ui-manifest']) : '',
        finalReadiness,
        manifest,
        bundleManifestPath,
        smoke: currentPackageLaunchSmoke,
      }),
      'explicit package UI evidence is fresh, complete, hash-bound, DB-safe, process-isolated, and bundled',
      failures,
    );
    check(
      Boolean(args['package-security-evidence']),
      'strict APP_NEEDS_WORK requires explicit passing package security evidence',
      failures,
    );
    check(
      packageSecurityEvidenceIsStrictlyValid({
        filePath: packageSecurityEvidencePath,
        packageUiManifestPath: args['package-ui-manifest'] ? path.resolve(args['package-ui-manifest']) : '',
        manifest,
        bundleManifestPath,
        smoke: currentPackageLaunchSmoke,
      }),
      'explicit package security evidence is schema-valid, fully passing, package-hash-bound, and bundled byte-for-byte',
      failures,
    );
    check(
      Boolean(args['package-adversarial-node-env-evidence']),
      'current strict APP_NEEDS_WORK requires explicit adversarial NODE_ENV package evidence',
      failures,
    );
    check(
      adversarialNodeEnvSelectionContract.passed
        && Boolean(args['package-adversarial-node-env-evidence'])
        && packageAdversarialNodeEnvEvidenceIsStrictlyValid({
        filePath: packageAdversarialNodeEnvEvidencePath,
        finalReadiness,
        packageUiManifestPath: args['package-ui-manifest'] ? path.resolve(args['package-ui-manifest']) : '',
        manifest,
        bundleManifestPath,
        smoke: currentPackageLaunchSmoke,
      }),
      'adversarial NODE_ENV evidence is passing, EXE/app-content/main/renderer hash-bound, process-clean, and bundled byte-for-byte',
      failures,
    );
    check(
      finalReadiness.status === 'APP_NEEDS_WORK' && finalReadiness.appReady === false,
      'final readiness remains APP_NEEDS_WORK with appReady=false',
      failures,
    );
    const gates = Array.isArray(finalReadiness.gates) ? finalReadiness.gates : [];
    const gateIds = gates.map((gate) => gate?.id);
    const passedGates = gates.filter((gate) => gate?.ok === true && gate?.status === 'passed');
    const failedGates = gates.filter((gate) => gate?.ok === false && gate?.status === 'needs_work');
    check(
      gates.length === expectedNonReadyGateIds.size
        && new Set(gateIds).size === expectedNonReadyGateIds.size
        && gateIds.every((id) => expectedNonReadyGateIds.has(id))
        && passedGates.length === 7
        && failedGates.length === 1
        && passedGates.length + failedGates.length === gates.length
        && failedGates[0]?.id === 'real-ad-execution-readback',
      'final readiness has exactly 8 gates, 7 passed, and only real-ad-execution-readback needs work',
      failures,
    );
    check(
      releasePackageHash?.ok === true
        && releasePackageHash?.status === 'passed'
        && currentPackageHashEvidence,
      'release-package-hash gate is passed with current package index evidence',
      failures,
    );
    check(
      bundlePackageIndexMatchesFinalReadiness(finalReadiness, manifest, bundleManifestPath),
      'bundle release-package-index exactly matches final readiness and current package files',
      failures,
    );
    check(
      packageLaunchSmokeGate?.ok === true
        && packageLaunchSmokeGate?.status === 'passed'
        && Boolean(args['package-launch-smoke'])
        && Boolean(currentPackageLaunchSmoke)
        && packageLaunchSmokeGate?.evidencePath
        && samePath(packageLaunchSmokeGate.evidencePath, packageLaunchSmokePath)
        && packageLaunchSmokeMatchesFinalReadiness(finalReadiness, packageLaunchSmokePath, currentPackageLaunchSmoke)
        && packageLaunchSmokeMatchesPackageIndex(finalReadiness, currentPackageLaunchSmoke),
      'package-launch-smoke gate is passed with explicit current evidence matching final readiness and package index',
      failures,
    );
    check(
      hasBoundExistingAuthorityDb(finalReadiness, manifest, args.db),
      'final readiness, explicit selection, and delivery bundle bind the same existing SQLite authority database identity',
      failures,
    );
  }
  check(finalReadiness.reportCollectionReady === true, 'report collection ready remains true', failures);
  check(finalReadiness.listingReadReady === true, 'Listing read ready remains true', failures);
  check(aiLive && aiLive.ok === true && aiLive.status === 'passed', 'AI live gate is passed with real provider evidence', failures);
  check(adAiExplanation && adAiExplanation.ok === true && adAiExplanation.status === 'passed', 'ad recommendation AI explanation gate is passed with real AI evidence', failures);
  check(listingAiDraft && listingAiDraft.ok === true && listingAiDraft.status === 'passed', 'Listing AI draft gate is passed with real AI evidence', failures);
  if (historicalReadyFinalReadiness) {
    check(adReadback && adReadback.ok === true && adReadback.status === 'passed', 'historical real ad readback gate is baseline only', failures);
    const readbackPath = selectedAdReadbackPath(finalReadiness);
    let authorityDbPath = '';
    try {
      authorityDbPath = resolveBoundAdReadbackAuthorityDbPath(
        finalReadiness.evidenceSelection?.authorityDbPath,
        args.db,
      );
      check(true, 'historical APP_READY records an existing SQLite authority database identity', failures);
    } catch (error) {
      check(false, `historical SQLite authority database identity is invalid: ${error instanceof Error ? error.message : String(error)}`, failures);
    }
    if (readbackPath && fs.existsSync(path.resolve(readbackPath)) && authorityDbPath) {
      const verifierArgs = [path.resolve(readbackPath)];
      verifierArgs.push('--db', authorityDbPath);
      const readbackVerification = runNode('scripts/verify-ad-readback-evidence.js', verifierArgs);
      if (readbackVerification.ok) {
        check(true, 'historical real ad readback baseline passes verify:ad-readback', failures);
      } else if (hasOnlyLegacySourceTraceabilityFailure(readbackVerification.output)) {
        check(false, 'historical real ad readback baseline lacks current source report traceability only', failures);
      } else {
        check(false, 'historical real ad readback baseline fails current verify:ad-readback', failures);
      }
      if (!readbackVerification.ok && readbackVerification.output && !hasOnlyLegacySourceTraceabilityFailure(readbackVerification.output)) {
        console.error(readbackVerification.output.split(/\r?\n/).slice(-8).join('\n'));
      }
    } else {
      check(false, 'historical real ad readback baseline has manifest-selected evidence file', failures);
    }
  }

  if (historicalReadyBundle) {
    check(true, 'historical APP_READY delivery bundle is baseline only because README is non-ready', failures);
  } else {
    check(
      manifest.status === 'APP_NEEDS_WORK'
        && manifest.appReady === false
        && /Do not present this bundle as final READY/.test(manifest.warning || ''),
      'delivery bundle remains APP_NEEDS_WORK and blocks READY claims',
      failures,
    );
  }
  check(readmeNonReady, 'README top-level delivery line is non-ready', failures);

  if (failures.length > 0) {
    console.error(`\nNEEDS_WORK: ${failures.length} non-ready safety check(s) failed.`);
    process.exit(1);
  }
  console.log('\nNON_READY_SAFETY verified.');
}

main();
