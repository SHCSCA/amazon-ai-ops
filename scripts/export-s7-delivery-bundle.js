const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildAppContentManifest } = require('./package-ui-evidence');
const {
  AUTHORITY_SNAPSHOT_BACKUP_METHOD,
  AUTHORITY_SNAPSHOT_KIND,
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  GATE_SPECS,
  OUTPUT_KIND: READINESS_KIND,
  OUTPUT_SCHEMA_VERSION: READINESS_SCHEMA_VERSION,
} = require('./verify-mission-control-production-readiness');

const ROOT = path.resolve(__dirname, '..');
const BUNDLE_KIND = 's7-mission-control-delivery-bundle';
const BUNDLE_SCHEMA_VERSION = 's7-mission-control-delivery-bundle/v1';
const GATE_IDS = Object.freeze(GATE_SPECS.map((gate) => gate.id));
const GATE_OPTIONS = Object.freeze(Object.fromEntries(GATE_SPECS.map((gate) => [gate.id, gate.option])));
const PACKAGE_IDENTITY_FIELDS = Object.freeze([
  'executableSha256',
  'appContentSha256',
  'mainBundleSha256',
]);
const CURRENT_REVALIDATION_KIND = 'mission-control-current-revalidation/v1';
const SAFE_BUNDLED_EXTENSIONS = new Set([
  '.json',
  '.md',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.txt',
  '.log',
]);
const HASH_ONLY_EXTENSIONS = new Set([
  '.db',
  '.sqlite',
  '.sqlite3',
  '.xlsx',
  '.xls',
  '.csv',
  '.exe',
  '.zip',
  '.7z',
]);
const HASH_PATH_KEYS = Object.freeze([
  'path',
  'absolutePath',
  'filePath',
  'artifactPath',
  'sourcePath',
]);
const HASH_KEYS = Object.freeze(['sha256', 'contentSha256']);
const SENSITIVE_JSON_KEYS = /^(password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|cookies)$/i;

function parseArgs(argv) {
  const allowed = new Set(['readiness', 'out', 'readme', 'help']);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help') {
      values.help = true;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (!allowed.has(key)) throw new Error(`Unexpected argument: --${key}`);
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`Duplicate argument: --${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  return values;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSha256(value) {
  return /^[A-F0-9]{64}$/.test(String(value || '').toUpperCase());
}

function normalizeSha256(value) {
  return isSha256(value) ? String(value).toUpperCase() : null;
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function stableEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function canonicalPath(filePath) {
  const resolved = path.resolve(filePath);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function normalizedPath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') return '';
  const canonical = canonicalPath(filePath);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function samePath(left, right) {
  const normalizedLeft = normalizedPath(left);
  return Boolean(normalizedLeft && normalizedLeft === normalizedPath(right));
}

function sameOptionalPath(left, right) {
  if ((left === null || left === undefined) && (right === null || right === undefined)) return true;
  return samePath(left, right);
}

function pathIsInside(filePath, parentDir) {
  const relative = path.relative(path.resolve(parentDir), path.resolve(filePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function requireRegularUnlinkedFile(filePath, label) {
  if (!filePath || !path.isAbsolute(filePath)) {
    throw new Error(`${label} must be an explicit absolute path.`);
  }
  if (!fs.existsSync(filePath)) throw new Error(`${label} is missing: ${filePath}`);
  const lstat = fs.lstatSync(filePath);
  const stat = fs.statSync(filePath);
  if (!lstat.isFile() || lstat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be one regular, non-symbolic-link file: ${filePath}`);
  }
  return stat;
}

function artifactRecord(filePath) {
  const resolved = canonicalPath(filePath);
  const stat = requireRegularUnlinkedFile(resolved, 'Artifact');
  return {
    sourcePath: resolved,
    sizeBytes: stat.size,
    sha256: sha256File(resolved),
  };
}

function normalizedPackageIdentity(value) {
  if (!isRecord(value)) return null;
  const result = {};
  for (const field of PACKAGE_IDENTITY_FIELDS) {
    const normalized = normalizeSha256(value[field]);
    if (!normalized) return null;
    result[field] = normalized;
  }
  return result;
}

function inspectCanonicalPackage({
  releaseRoot = path.join(ROOT, 'apps', 'desktop', 'release'),
} = {}) {
  const executablePath = path.join(releaseRoot, 'win-unpacked', 'AmazonAIOpsAgent.exe');
  const appContentPath = path.join(releaseRoot, 'win-unpacked', 'resources', 'app');
  const mainBundlePath = path.join(appContentPath, 'dist', 'main', 'index.js');
  requireRegularUnlinkedFile(executablePath, 'Canonical packaged executable');
  requireRegularUnlinkedFile(mainBundlePath, 'Canonical packaged Main bundle');
  const appContent = buildAppContentManifest(appContentPath);
  if (!isSha256(appContent?.sha256) || !Number.isInteger(appContent?.fileCount) || appContent.fileCount <= 0) {
    throw new Error('Canonical packaged app-content manifest is incomplete.');
  }
  return {
    paths: {
      executablePath: canonicalPath(executablePath),
      appContentPath: canonicalPath(appContentPath),
      mainBundlePath: canonicalPath(mainBundlePath),
    },
    identity: {
      executableSha256: sha256File(executablePath),
      appContentSha256: String(appContent.sha256).toUpperCase(),
      mainBundleSha256: sha256File(mainBundlePath),
    },
    appContentFileCount: appContent.fileCount,
    artifacts: {
      executable: artifactRecord(executablePath),
      mainBundle: artifactRecord(mainBundlePath),
    },
  };
}

function gateStateIsConsistent(gate) {
  if (!isRecord(gate) || !GATE_IDS.includes(gate.id)) return false;
  if (gate.ok === true) return gate.status === 'passed';
  return gate.ok === false && ['missing', 'needs_work'].includes(gate.status);
}

function validateReadinessReport(report, { expectedMode = null } = {}) {
  const errors = [];
  const push = (condition, message) => {
    if (!condition) errors.push(message);
  };
  push(isRecord(report), 'readiness must be an object');
  push(report?.kind === READINESS_KIND, `readiness kind must be ${READINESS_KIND}`);
  push(
    report?.schemaVersion === READINESS_SCHEMA_VERSION,
    `readiness schemaVersion must be ${READINESS_SCHEMA_VERSION}`,
  );
  push(validTimestamp(report?.generatedAt), 'readiness generatedAt is invalid');
  push(report?.evidenceSelection?.explicitOnly === true, 'readiness must use explicit-only evidence selection');
  push(report?.evidenceSelection?.latestFallbackUsed === false, 'readiness must not use latest-file fallback');

  const gates = Array.isArray(report?.gates) ? report.gates : [];
  const gateIds = gates.map((gate) => gate?.id);
  push(
    gates.length === GATE_IDS.length
      && new Set(gateIds).size === GATE_IDS.length
      && GATE_IDS.every((id) => gateIds.includes(id)),
    'readiness must contain exactly the eight canonical Mission gates',
  );
  push(gates.every(gateStateIsConsistent), 'readiness gate status/ok pairs are inconsistent');
  const passed = gates.filter((gate) => gate?.ok === true && gate?.status === 'passed').length;
  const failed = gates.length - passed;
  push(
    report?.summary?.total === GATE_IDS.length
      && report?.summary?.passed === passed
      && report?.summary?.failed === failed,
    'readiness summary does not match its eight gates',
  );

  const inputErrors = Array.isArray(report?.inputErrors) ? report.inputErrors : [];
  const inputContractPassed = report?.inputContractPassed === true && inputErrors.length === 0;
  push(
    report?.inputContractPassed === inputContractPassed,
    'readiness inputContractPassed does not match inputErrors',
  );
  const ready = inputContractPassed && passed === GATE_IDS.length;
  push(
    report?.status === (ready ? 'APP_READY' : 'APP_NEEDS_WORK')
      && report?.appReady === ready
      && report?.allGatesPass === ready,
    'readiness READY/NEEDS_WORK claims do not match the canonical eight-gate result',
  );
  if (expectedMode === 'ready') push(ready, 'READY safety requires a genuine 8/8 APP_READY report');
  if (expectedMode === 'non-ready') push(!ready && passed <= 7, 'NON_READY safety requires a genuine 0-7/8 APP_NEEDS_WORK report');

  const selectedPaths = report?.evidenceSelection?.selectedPaths;
  push(isRecord(selectedPaths), 'readiness selectedPaths is missing');
  const selectedKeys = isRecord(selectedPaths) ? Object.keys(selectedPaths) : [];
  push(
    selectedKeys.length === GATE_IDS.length
      && GATE_IDS.every((id) => Object.prototype.hasOwnProperty.call(selectedPaths, id)),
    'readiness selectedPaths must contain exactly the eight canonical gate ids',
  );
  for (const gate of gates) {
    const selectedPath = selectedPaths?.[gate.id] ?? null;
    push(
      (selectedPath === null && gate.evidencePath === null)
        || (typeof selectedPath === 'string' && samePath(selectedPath, gate.evidencePath)),
      `${gate.id} gate evidencePath does not match explicit selection`,
    );
    if (gate.ok) {
      push(
        typeof selectedPath === 'string' && path.isAbsolute(selectedPath),
        `${gate.id} passed without an explicit absolute evidence path`,
      );
    }
  }
  const selectedExistingPaths = gates
    .map((gate) => selectedPaths?.[gate.id])
    .filter((value) => typeof value === 'string' && value.length > 0)
    .map(normalizedPath);
  push(
    new Set(selectedExistingPaths).size === selectedExistingPaths.length,
    'readiness reuses one evidence file for multiple Mission gates',
  );

  const packageIdentity = normalizedPackageIdentity(report?.packageIdentity);
  push(Boolean(packageIdentity), 'readiness packageIdentity is incomplete');
  const snapshotPath = report?.evidenceSelection?.authoritySnapshotManifest;
  push(
    typeof snapshotPath === 'string'
      && path.isAbsolute(snapshotPath)
      && samePath(snapshotPath, report?.authoritySnapshot?.evidencePath),
    'readiness authority snapshot selection is missing or inconsistent',
  );
  push(
    typeof report?.evidenceSelection?.authorityDb === 'string'
      && path.isAbsolute(report.evidenceSelection.authorityDb),
    'readiness authority database identity is missing',
  );
  if (ready) {
    push(report?.authoritySnapshot?.ok === true, 'READY readiness authority snapshot did not pass');
    push(report?.authoritySnapshot?.currentness?.passed === true, 'READY readiness lacks WAL-aware currentness');
    push(
      Array.isArray(report?.authoritySnapshot?.currentness?.captures)
        && report.authoritySnapshot.currentness.captures.length >= 3
        && report.authoritySnapshot.currentness.captures.every((capture) => (
          capture?.matchesSelectedSnapshot === true
        )),
      'READY readiness lacks the complete WAL-aware currentness capture chain',
    );
  }

  const failures = Array.isArray(report?.failures) ? report.failures : [];
  const failureGateIds = failures.map((failure) => failure?.gateId);
  for (const gate of gates.filter((candidate) => !candidate.ok)) {
    push(failureGateIds.includes(gate.id), `${gate.id} failure is absent from readiness.failures`);
  }
  for (const gate of gates.filter((candidate) => candidate.ok)) {
    push(!failureGateIds.includes(gate.id), `${gate.id} passed but is listed as a readiness failure`);
  }
  return {
    errors,
    ok: errors.length === 0,
    passed,
    failed,
    ready,
    packageIdentity,
  };
}

function validateAuthoritySnapshot(snapshotPath, readiness, packageIdentity) {
  requireRegularUnlinkedFile(snapshotPath, 'Authority snapshot manifest');
  const snapshot = readJson(snapshotPath);
  const errors = [];
  const push = (condition, message) => {
    if (!condition) errors.push(message);
  };
  push(snapshot?.kind === AUTHORITY_SNAPSHOT_KIND, 'authority snapshot kind is invalid');
  push(
    snapshot?.schemaVersion === AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    'authority snapshot must use Mission snapshot schema v2',
  );
  push(validTimestamp(snapshot?.exportedAt), 'authority snapshot exportedAt is invalid');
  push(
    snapshot?.backup?.method === AUTHORITY_SNAPSHOT_BACKUP_METHOD
      && snapshot?.backup?.completed === true
      && snapshot?.backup?.remainingPages === 0,
    'authority snapshot was not completed by sqlite-online-backup',
  );
  push(
    snapshot?.source?.openedReadOnly === true
      && snapshot?.source?.queryOnly === true
      && samePath(snapshot?.source?.absolutePath, readiness?.evidenceSelection?.authorityDb),
    'authority snapshot source does not bind the read-only selected authority database',
  );
  push(
    snapshot?.snapshot?.openedReadOnly === true
      && snapshot?.snapshot?.queryOnly === true
      && typeof snapshot?.snapshot?.absolutePath === 'string'
      && path.isAbsolute(snapshot.snapshot.absolutePath),
    'authority snapshot artifact identity is incomplete',
  );
  const snapshotArtifact = snapshot?.snapshot?.absolutePath
    ? artifactRecord(snapshot.snapshot.absolutePath)
    : null;
  push(
    Boolean(snapshotArtifact)
      && Number(snapshot?.snapshot?.sizeBytes) === snapshotArtifact.sizeBytes
      && normalizeSha256(snapshot?.snapshot?.sha256) === snapshotArtifact.sha256,
    'authority snapshot database bytes do not match snapshot v2 provenance',
  );
  push(
    stableEqual(normalizedPackageIdentity(snapshot?.packageIdentity), packageIdentity),
    'authority snapshot package identity does not match Mission readiness',
  );
  return {
    errors,
    ok: errors.length === 0,
    snapshot,
    snapshotArtifact,
  };
}

function assertNoSensitiveJson(value, sourcePath, currentPath = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveJson(item, sourcePath, `${currentPath}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (
      SENSITIVE_JSON_KEYS.test(key)
      && ((typeof item === 'string' && item.trim() !== '') || (isRecord(item) && Object.keys(item).length > 0))
    ) {
      throw new Error(`Refusing to bundle possible secret field ${currentPath}.${key} from ${sourcePath}.`);
    }
    assertNoSensitiveJson(item, sourcePath, `${currentPath}.${key}`);
  }
}

function collectHashedArtifactReferences(value, origin, target = [], visited = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectHashedArtifactReferences(item, origin, target, visited);
    return target;
  }
  if (!isRecord(value) || visited.has(value)) return target;
  visited.add(value);
  const pathKey = HASH_PATH_KEYS.find((key) => (
    typeof value[key] === 'string' && path.isAbsolute(value[key])
  ));
  const hashKey = HASH_KEYS.find((key) => isSha256(value[key]));
  if (pathKey && hashKey && Number.isInteger(Number(value.sizeBytes)) && Number(value.sizeBytes) > 0) {
    target.push({
      origin,
      sourcePath: value[pathKey],
      sizeBytes: Number(value.sizeBytes),
      sha256: String(value[hashKey]).toUpperCase(),
    });
  }
  for (const item of Object.values(value)) {
    collectHashedArtifactReferences(item, origin, target, visited);
  }
  return target;
}

function validateReferencedArtifact(reference) {
  const stat = requireRegularUnlinkedFile(reference.sourcePath, `${reference.origin} referenced artifact`);
  if (
    stat.size !== reference.sizeBytes
    || sha256File(reference.sourcePath) !== reference.sha256
  ) {
    throw new Error(`${reference.origin} referenced artifact changed: ${reference.sourcePath}`);
  }
  return {
    ...reference,
    sourcePath: canonicalPath(reference.sourcePath),
  };
}

function classifyReferencedArtifact(reference, evidenceRoot) {
  const extension = path.extname(reference.sourcePath).toLowerCase();
  if (HASH_ONLY_EXTENSIONS.has(extension)) {
    return {
      copy: false,
      policy: 'hash-only-sensitive-or-runtime-artifact',
    };
  }
  if (
    SAFE_BUNDLED_EXTENSIONS.has(extension)
    && pathIsInside(reference.sourcePath, evidenceRoot)
  ) {
    return {
      copy: true,
      policy: 'bundled-evidence-artifact',
    };
  }
  return {
    copy: false,
    policy: 'hash-only-external-artifact',
  };
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact';
}

function copyWithRecord({
  bundleDir,
  destinationRelativePath,
  id,
  role,
  sourcePath,
}) {
  const source = artifactRecord(sourcePath);
  const destination = path.resolve(bundleDir, destinationRelativePath);
  if (!pathIsInside(destination, bundleDir)) {
    throw new Error(`Bundle copy escapes output root: ${destinationRelativePath}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source.sourcePath, destination, fs.constants.COPYFILE_EXCL);
  const bundled = artifactRecord(destination);
  if (source.sha256 !== bundled.sha256 || source.sizeBytes !== bundled.sizeBytes) {
    throw new Error(`Bundle copy changed bytes for ${source.sourcePath}.`);
  }
  return {
    id,
    role,
    sourcePath: source.sourcePath,
    sizeBytes: source.sizeBytes,
    sha256: source.sha256,
    bundlePath: path.relative(bundleDir, destination).replace(/\\/g, '/'),
  };
}

function inspectSelectedEvidence(readiness) {
  const records = [];
  for (const id of GATE_IDS) {
    const gate = readiness.gates.find((candidate) => candidate.id === id);
    const selectedPath = readiness.evidenceSelection.selectedPaths[id];
    if (typeof selectedPath !== 'string' || selectedPath.trim() === '') {
      records.push({
        gateId: id,
        status: gate.status,
        ok: gate.ok,
        sourcePath: null,
        sourceExists: false,
        sourceJson: null,
      });
      continue;
    }
    const sourceExists = fs.existsSync(selectedPath);
    if (gate.ok && !sourceExists) {
      throw new Error(`Passed gate ${id} evidence is missing: ${selectedPath}`);
    }
    if (!sourceExists) {
      records.push({
        gateId: id,
        status: gate.status,
        ok: gate.ok,
        sourcePath: canonicalPath(selectedPath),
        sourceExists: false,
        sourceJson: null,
      });
      continue;
    }
    requireRegularUnlinkedFile(selectedPath, `${id} evidence`);
    const sourceJson = readJson(selectedPath);
    assertNoSensitiveJson(sourceJson, selectedPath);
    records.push({
      gateId: id,
      status: gate.status,
      ok: gate.ok,
      sourcePath: canonicalPath(selectedPath),
      sourceExists: true,
      sourceJson,
    });
  }
  return records;
}

function validateOperationalEvidenceSemantics(selectedEvidence) {
  const byId = new Map(selectedEvidence.map((record) => [record.gateId, record]));
  const continuous = byId.get('s7-continuous-operation');
  if (continuous?.ok) {
    if (
      continuous.sourceJson?.kind !== 's7-continuous-operation-evidence'
      || continuous.sourceJson?.schemaVersion !== 's7-continuous-operation-evidence/v1'
      || continuous.sourceJson?.passed !== true
      || continuous.sourceJson?.status !== 'PASSED'
    ) {
      throw new Error('Passed continuous-operation evidence does not use the current passing S7 contract.');
    }
  }
  const canarySpecs = [
    ['manual-canary', 'manual_approval'],
    ['policy-auto-canary', 'policy_auto'],
  ];
  for (const [id, mode] of canarySpecs) {
    const record = byId.get(id);
    if (!record?.ok) continue;
    if (
      record.sourceJson?.kind !== 'mission-control-execution-canary-evidence'
      || record.sourceJson?.schemaVersion !== 'mission-control-execution-canary-evidence/v1'
      || record.sourceJson?.passed !== true
      || record.sourceJson?.status !== 'PASSED'
      || record.sourceJson?.mode !== mode
    ) {
      throw new Error(`Passed ${id} evidence does not use the current ${mode} canary contract.`);
    }
  }
  const manual = byId.get('manual-canary');
  const policy = byId.get('policy-auto-canary');
  if (manual?.ok && policy?.ok) {
    const distinctFields = [
      ['scope', 'storeId'],
      ['authority', 'missionId'],
      ['authority', 'missionGrantId'],
      ['authority', 'batchId'],
      ['authority', 'jobId'],
      ['authority', 'decisionId'],
    ];
    for (const [group, field] of distinctFields) {
      const manualValue = manual.sourceJson?.[group]?.[field];
      const policyValue = policy.sourceJson?.[group]?.[field];
      if (!manualValue || !policyValue || manualValue === policyValue) {
        throw new Error(`Manual and policy-auto canaries are not independent at ${group}.${field}.`);
      }
    }
  }
}

function readinessRevalidationArgs(report, outputPath) {
  const args = [];
  for (const id of GATE_IDS) {
    const selectedPath = report.evidenceSelection.selectedPaths[id];
    if (selectedPath) args.push(`--${GATE_OPTIONS[id]}`, selectedPath);
  }
  args.push('--authority-db', report.evidenceSelection.authorityDb);
  args.push('--authority-snapshot-manifest', report.evidenceSelection.authoritySnapshotManifest);
  args.push('--out', outputPath);
  return args;
}

function runReadyRevalidation(report, {
  rootDir = ROOT,
  readinessRunner = null,
} = {}) {
  if (typeof readinessRunner === 'function') {
    return readinessRunner(report);
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-s7-ready-'));
  const outputPath = path.join(tempDir, 'readiness.json');
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(rootDir, 'scripts', 'verify-mission-control-production-readiness.js'),
        ...readinessRevalidationArgs(report, outputPath),
      ],
      {
        cwd: rootDir,
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    const refreshed = fs.existsSync(outputPath) ? readJson(outputPath) : null;
    return {
      exitCode: result.status,
      report: refreshed,
      stderr: String(result.stderr || ''),
      stdout: String(result.stdout || ''),
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function assertCurrentRevalidation(original, result, expectedMode) {
  const validation = validateReadinessReport(result?.report, { expectedMode });
  const expectedExitCode = expectedMode === 'ready' ? 0 : 1;
  if (
    result?.exitCode !== expectedExitCode
    || !validation.ok
    || !stableEqual(
      normalizedPackageIdentity(result.report.packageIdentity),
      normalizedPackageIdentity(original.packageIdentity),
    )
    || !GATE_IDS.every((id) => (
      sameOptionalPath(
        result.report.evidenceSelection.selectedPaths[id],
        original.evidenceSelection.selectedPaths[id],
      )
    ))
    || !samePath(
      result.report.evidenceSelection.authoritySnapshotManifest,
      original.evidenceSelection.authoritySnapshotManifest,
    )
    || !samePath(
      result.report.evidenceSelection.authorityDb,
      original.evidenceSelection.authorityDb,
    )
    || !GATE_IDS.every((id) => {
      const originalGate = original.gates.find((gate) => gate.id === id);
      const refreshedGate = result.report.gates.find((gate) => gate.id === id);
      return originalGate?.ok === refreshedGate?.ok
        && originalGate?.status === refreshedGate?.status;
    })
  ) {
    const detail = [
      ...(validation.errors || []),
      result?.stderr,
      result?.stdout,
    ].filter(Boolean).join('; ');
    throw new Error(`Current Mission readiness revalidation rejected ${expectedMode}: ${detail}`);
  }
  return {
    kind: CURRENT_REVALIDATION_KIND,
    checkedAt: new Date().toISOString(),
    passed: true,
    readyCredit: expectedMode === 'ready',
    status: result.report.status,
    summary: { ...result.report.summary },
    packageIdentity: normalizedPackageIdentity(result.report.packageIdentity),
    selectedPathsSha256: crypto
      .createHash('sha256')
      .update(JSON.stringify(result.report.evidenceSelection.selectedPaths))
      .digest('hex')
      .toUpperCase(),
  };
}

function readmeContract(text, ready) {
  const claimsReady = /^\*\*DELIVERY:\s*APP_READY\b/im.test(text);
  const claimsNonReady = /^\*\*DELIVERY:\s*(?:APP_NEEDS_WORK|IN_PROGRESS|REPORT_COLLECTION_READY \/ APP_NEEDS_WORK)\b/im.test(text);
  return ready ? claimsReady : (claimsNonReady && !claimsReady);
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

function exportBundle({
  readinessPath,
  outDir,
  readmePath = path.join(ROOT, 'README.md'),
  rootDir = ROOT,
  releaseRoot = path.join(rootDir, 'apps', 'desktop', 'release'),
  evidenceRoot = path.join(rootDir, 'output', 'codex-evidence'),
  readinessRunner = null,
  now = new Date(),
} = {}) {
  if (!readinessPath || !path.isAbsolute(readinessPath)) {
    throw new Error('--readiness must be an explicit absolute path.');
  }
  if (!outDir || !path.isAbsolute(outDir)) {
    throw new Error('--out must be an explicit absolute path.');
  }
  if (fs.existsSync(outDir)) {
    throw new Error(`Refusing to overwrite existing S7 delivery bundle: ${outDir}`);
  }
  requireRegularUnlinkedFile(readinessPath, 'Mission readiness');
  requireRegularUnlinkedFile(readmePath, 'README');
  const readiness = readJson(readinessPath);
  const readinessValidation = validateReadinessReport(readiness);
  if (!readinessValidation.ok) {
    throw new Error(`Invalid Mission readiness report: ${readinessValidation.errors.join('; ')}`);
  }
  const canonicalPackage = inspectCanonicalPackage({ releaseRoot });
  if (!stableEqual(canonicalPackage.identity, readinessValidation.packageIdentity)) {
    throw new Error('Mission readiness package identity does not match the current canonical package.');
  }
  const snapshotPath = readiness.evidenceSelection.authoritySnapshotManifest;
  const snapshotValidation = validateAuthoritySnapshot(
    snapshotPath,
    readiness,
    readinessValidation.packageIdentity,
  );
  if (!snapshotValidation.ok) {
    throw new Error(`Invalid authority snapshot v2: ${snapshotValidation.errors.join('; ')}`);
  }
  const selectedEvidence = inspectSelectedEvidence(readiness);
  validateOperationalEvidenceSemantics(selectedEvidence);
  const readmeText = fs.readFileSync(readmePath, 'utf8');
  if (!readmeContract(readmeText, readinessValidation.ready)) {
    throw new Error(
      readinessValidation.ready
        ? 'README must explicitly state DELIVERY: APP_READY before READY export.'
        : 'README must explicitly remain non-ready for an APP_NEEDS_WORK export.',
    );
  }

  const currentRevalidation = assertCurrentRevalidation(
    readiness,
    runReadyRevalidation(readiness, { rootDir, readinessRunner }),
    readinessValidation.ready ? 'ready' : 'non-ready',
  );

  const parentDir = path.dirname(outDir);
  fs.mkdirSync(parentDir, { recursive: true });
  const stagingDir = path.join(
    parentDir,
    `.${path.basename(outDir)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  fs.mkdirSync(stagingDir, { recursive: false });
  try {
    const files = [];
    const readinessFile = copyWithRecord({
      bundleDir: stagingDir,
      destinationRelativePath: 'evidence/mission-control-production-readiness.json',
      id: 'mission-readiness',
      role: 'mission-readiness',
      sourcePath: readinessPath,
    });
    files.push(readinessFile);
    const snapshotFile = copyWithRecord({
      bundleDir: stagingDir,
      destinationRelativePath: 'evidence/authority-snapshot-manifest.json',
      id: 'authority-snapshot-manifest',
      role: 'authority-snapshot-manifest',
      sourcePath: snapshotPath,
    });
    files.push(snapshotFile);
    const readmeFile = copyWithRecord({
      bundleDir: stagingDir,
      destinationRelativePath: 'handoff/README.md',
      id: 'readme',
      role: 'handoff-document',
      sourcePath: readmePath,
    });
    files.push(readmeFile);

    const gateArtifacts = [];
    for (const record of selectedEvidence) {
      let bundled = null;
      if (record.sourceExists) {
        bundled = copyWithRecord({
          bundleDir: stagingDir,
          destinationRelativePath: `evidence/gates/${safeName(record.gateId)}.json`,
          id: `gate:${record.gateId}`,
          role: 'gate-evidence',
          sourcePath: record.sourcePath,
        });
        files.push(bundled);
      }
      gateArtifacts.push({
        gateId: record.gateId,
        status: record.status,
        ok: record.ok,
        sourcePath: record.sourcePath,
        sourceExists: record.sourceExists,
        sizeBytes: bundled?.sizeBytes ?? null,
        sha256: bundled?.sha256 ?? null,
        bundlePath: bundled?.bundlePath ?? null,
      });
    }

    const supportPaths = [
      path.join(rootDir, 'package.json'),
      path.join(rootDir, 'scripts', 'export-s7-delivery-bundle.js'),
      path.join(rootDir, 'scripts', 'verify-s7-non-ready-safety.js'),
      path.join(rootDir, 'scripts', 'verify-s7-ready-safety.js'),
      path.join(rootDir, 'scripts', 'verify-mission-control-production-readiness.js'),
    ];
    const supportFiles = [];
    for (const sourcePath of supportPaths) {
      if (!fs.existsSync(sourcePath)) continue;
      const bundled = copyWithRecord({
        bundleDir: stagingDir,
        destinationRelativePath: `handoff/${safeName(path.relative(rootDir, sourcePath))}`,
        id: `support:${path.relative(rootDir, sourcePath).replace(/\\/g, '/')}`,
        role: 'verification-support',
        sourcePath,
      });
      files.push(bundled);
      supportFiles.push(bundled.id);
    }

    const rootSources = new Set(files.map((file) => normalizedPath(file.sourcePath)));
    const closureCandidates = [];
    collectHashedArtifactReferences(
      snapshotValidation.snapshot,
      'authority-snapshot',
      closureCandidates,
    );
    for (const record of selectedEvidence.filter((candidate) => candidate.ok && candidate.sourceJson)) {
      collectHashedArtifactReferences(
        record.sourceJson,
        `gate:${record.gateId}`,
        closureCandidates,
      );
    }
    closureCandidates.push({
      origin: 'authority-snapshot',
      ...snapshotValidation.snapshotArtifact,
    });
    closureCandidates.push({
      origin: 'canonical-package:executable',
      ...canonicalPackage.artifacts.executable,
    });
    closureCandidates.push({
      origin: 'canonical-package:main-bundle',
      ...canonicalPackage.artifacts.mainBundle,
    });

    const deduped = new Map();
    for (const candidate of closureCandidates) {
      if (rootSources.has(normalizedPath(candidate.sourcePath))) continue;
      const validated = validateReferencedArtifact(candidate);
      const key = normalizedPath(validated.sourcePath);
      const previous = deduped.get(key);
      if (
        previous
        && (previous.sha256 !== validated.sha256 || previous.sizeBytes !== validated.sizeBytes)
      ) {
        throw new Error(`Conflicting hash bindings for referenced artifact: ${validated.sourcePath}`);
      }
      if (!previous) deduped.set(key, validated);
    }

    const externalArtifacts = [];
    const closureFiles = [];
    for (const [key, reference] of [...deduped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const classification = classifyReferencedArtifact(reference, evidenceRoot);
      if (!classification.copy) {
        externalArtifacts.push({
          id: `external:${externalArtifacts.length + 1}`,
          origin: reference.origin,
          sourcePath: reference.sourcePath,
          sizeBytes: reference.sizeBytes,
          sha256: reference.sha256,
          copied: false,
          policy: classification.policy,
        });
        continue;
      }
      const bundled = copyWithRecord({
        bundleDir: stagingDir,
        destinationRelativePath: `evidence/artifacts/${reference.sha256.slice(0, 16)}-${safeName(path.basename(reference.sourcePath))}`,
        id: `closure:${closureFiles.length + 1}`,
        role: 'evidence-closure',
        sourcePath: reference.sourcePath,
      });
      files.push(bundled);
      closureFiles.push({
        ...bundled,
        origin: reference.origin,
        policy: classification.policy,
      });
    }

    const manifest = {
      kind: BUNDLE_KIND,
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      generatedAt: now.toISOString(),
      status: readiness.status,
      appReady: readiness.appReady,
      warning: readinessValidation.ready
        ? 'APP_READY Mission bundle. READY credit still requires verify:s7-ready-safety against current source artifacts.'
        : 'APP_NEEDS_WORK Mission bundle. It must never be presented as READY.',
      gateSummary: {
        total: GATE_IDS.length,
        passed: readinessValidation.passed,
        failed: readinessValidation.failed,
      },
      gateOrder: [...GATE_IDS],
      readiness: {
        sourcePath: readinessFile.sourcePath,
        sizeBytes: readinessFile.sizeBytes,
        sha256: readinessFile.sha256,
        bundlePath: readinessFile.bundlePath,
        generatedAt: readiness.generatedAt,
      },
      authoritySnapshot: {
        ok: readiness.authoritySnapshot.ok,
        sourcePath: snapshotFile.sourcePath,
        sizeBytes: snapshotFile.sizeBytes,
        sha256: snapshotFile.sha256,
        bundlePath: snapshotFile.bundlePath,
        schemaVersion: snapshotValidation.snapshot.schemaVersion,
        exportedAt: snapshotValidation.snapshot.exportedAt,
        databaseArtifactSha256: snapshotValidation.snapshotArtifact.sha256,
        databaseArtifactSizeBytes: snapshotValidation.snapshotArtifact.sizeBytes,
        databaseCopied: false,
      },
      authorityDatabase: {
        sourcePath: canonicalPath(readiness.evidenceSelection.authorityDb),
        copied: false,
        policy: 'Live authority DB is never copied; READY is revalidated with WAL-aware online backup.',
      },
      packageIdentity: { ...canonicalPackage.identity },
      canonicalPackage: {
        executablePath: canonicalPackage.paths.executablePath,
        appContentPath: canonicalPackage.paths.appContentPath,
        mainBundlePath: canonicalPackage.paths.mainBundlePath,
        appContentFileCount: canonicalPackage.appContentFileCount,
        copied: false,
        policy: 'Package binaries and app-content are not copied; their canonical hashes are rechecked.',
      },
      currentRevalidation,
      gateArtifacts,
      files,
      closure: {
        copiedArtifactCount: closureFiles.length,
        externalHashOnlyArtifactCount: externalArtifacts.length,
        copiedArtifacts: closureFiles,
        externalArtifacts,
        complete: true,
        policy: 'Evidence JSON/screenshots under output/codex-evidence are bundled; DB, raw reports, package binaries, and external runtime files remain hash-only.',
      },
      supportFiles,
      exclusions: [
        'credentials, cookies, browser profiles, API keys, and passwords',
        'live and snapshot SQLite database bytes',
        'raw Lingxing report files',
        'installer, portable, unpacked EXE, and packaged app-content bytes',
      ],
    };
    const manifestPath = path.join(stagingDir, 's7-delivery-bundle-manifest.json');
    writeJsonAtomic(manifestPath, manifest);
    fs.renameSync(stagingDir, outDir);
    return {
      manifest,
      manifestPath: path.join(outDir, path.basename(manifestPath)),
      outDir,
    };
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

function usage() {
  return [
    'Usage: node scripts/export-s7-delivery-bundle.js',
    '  --readiness <absolute mission-control-production-readiness.json>',
    '  --out <absolute new bundle directory>',
    '  [--readme <absolute README.md>]',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.readiness) throw new Error('Missing required argument: --readiness');
  if (!args.out) throw new Error('Missing required argument: --out');
  const result = exportBundle({
    readinessPath: path.resolve(args.readiness),
    outDir: path.resolve(args.out),
    readmePath: path.resolve(args.readme || path.join(ROOT, 'README.md')),
  });
  process.stdout.write(`S7 delivery bundle exported: ${result.outDir}\n`);
  process.stdout.write(`Manifest: ${result.manifestPath}\n`);
  process.stdout.write(`${result.manifest.status}: ${result.manifest.gateSummary.passed}/8 gates.\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  BUNDLE_KIND,
  BUNDLE_SCHEMA_VERSION,
  GATE_IDS,
  PACKAGE_IDENTITY_FIELDS,
  CURRENT_REVALIDATION_KIND,
  artifactRecord,
  assertCurrentRevalidation,
  classifyReferencedArtifact,
  collectHashedArtifactReferences,
  exportBundle,
  inspectCanonicalPackage,
  normalizeSha256,
  normalizedPath,
  normalizedPackageIdentity,
  parseArgs,
  pathIsInside,
  readJson,
  readmeContract,
  runReadyRevalidation,
  samePath,
  sameOptionalPath,
  sha256File,
  validateAuthoritySnapshot,
  validateOperationalEvidenceSemantics,
  validateReadinessReport,
  validateReferencedArtifact,
};
