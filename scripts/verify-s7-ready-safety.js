const fs = require('node:fs');
const path = require('node:path');
const {
  BUNDLE_KIND,
  BUNDLE_SCHEMA_VERSION,
  GATE_IDS,
  CURRENT_REVALIDATION_KIND,
  assertCurrentRevalidation,
  classifyReferencedArtifact,
  collectHashedArtifactReferences,
  inspectCanonicalPackage,
  normalizedPath,
  normalizedPackageIdentity,
  pathIsInside,
  readJson,
  readmeContract,
  runReadyRevalidation,
  samePath,
  sha256File,
  validateAuthoritySnapshot,
  validateOperationalEvidenceSemantics,
  validateReadinessReport,
  validateReferencedArtifact,
} = require('./export-s7-delivery-bundle');

const ROOT = path.resolve(__dirname, '..');
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function parseArgs(argv) {
  const allowed = new Set(['bundle-manifest', 'readiness', 'help']);
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

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function check(condition, message, failures) {
  if (condition) return;
  failures.push(message);
}

function requireRegularUnlinkedFile(filePath, label, failures) {
  try {
    if (!filePath || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) {
      failures.push(`${label} is missing or is not an absolute path`);
      return null;
    }
    const lstat = fs.lstatSync(filePath);
    const stat = fs.statSync(filePath);
    if (!lstat.isFile() || lstat.isSymbolicLink() || !stat.isFile()) {
      failures.push(`${label} is not a regular non-symbolic-link file`);
      return null;
    }
    return stat;
  } catch (error) {
    failures.push(`${label} could not be inspected: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function validateFileRecord(record, bundleDir, failures) {
  if (!isRecord(record)) {
    failures.push('bundle file record is invalid');
    return false;
  }
  const sourceStat = requireRegularUnlinkedFile(record.sourcePath, `${record.id || 'unknown'} source`, failures);
  const bundlePath = typeof record.bundlePath === 'string'
    ? path.resolve(bundleDir, record.bundlePath)
    : '';
  check(
    Boolean(bundlePath)
      && pathIsInside(bundlePath, bundleDir)
      && !samePath(bundlePath, path.join(bundleDir, 's7-delivery-bundle-manifest.json')),
    `${record.id || 'unknown'} bundlePath escapes or targets the manifest`,
    failures,
  );
  const bundleStat = bundlePath
    ? requireRegularUnlinkedFile(bundlePath, `${record.id || 'unknown'} bundled copy`, failures)
    : null;
  const expectedHash = String(record.sha256 || '').toUpperCase();
  const expectedSize = Number(record.sizeBytes);
  check(/^[A-F0-9]{64}$/.test(expectedHash), `${record.id || 'unknown'} SHA-256 is invalid`, failures);
  check(Number.isInteger(expectedSize) && expectedSize >= 0, `${record.id || 'unknown'} size is invalid`, failures);
  if (sourceStat) {
    check(sourceStat.size === expectedSize, `${record.id || 'unknown'} source size changed`, failures);
    check(sha256File(record.sourcePath) === expectedHash, `${record.id || 'unknown'} source SHA-256 changed`, failures);
  }
  if (bundleStat) {
    check(bundleStat.size === expectedSize, `${record.id || 'unknown'} bundled size changed`, failures);
    check(sha256File(bundlePath) === expectedHash, `${record.id || 'unknown'} bundled SHA-256 changed`, failures);
  }
  return Boolean(sourceStat && bundleStat);
}

function collectBundleFiles(bundleDir, currentDir = bundleDir, result = []) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const filePath = path.join(currentDir, entry.name);
    const lstat = fs.lstatSync(filePath);
    if (lstat.isSymbolicLink()) {
      result.push({ relativePath: path.relative(bundleDir, filePath).replace(/\\/g, '/'), linked: true });
      continue;
    }
    if (entry.isDirectory()) {
      collectBundleFiles(bundleDir, filePath, result);
      continue;
    }
    if (entry.isFile()) {
      result.push({ relativePath: path.relative(bundleDir, filePath).replace(/\\/g, '/'), linked: false });
    }
  }
  return result;
}

function validateExternalArtifact(record, failures) {
  if (!isRecord(record)) {
    failures.push('external artifact record is invalid');
    return;
  }
  check(record.copied === false, `${record.id || 'unknown'} external artifact must not claim copied`, failures);
  const stat = requireRegularUnlinkedFile(record.sourcePath, `${record.id || 'unknown'} external artifact`, failures);
  const expectedHash = String(record.sha256 || '').toUpperCase();
  const expectedSize = Number(record.sizeBytes);
  check(/^[A-F0-9]{64}$/.test(expectedHash), `${record.id || 'unknown'} external SHA-256 is invalid`, failures);
  check(Number.isInteger(expectedSize) && expectedSize > 0, `${record.id || 'unknown'} external size is invalid`, failures);
  if (stat) {
    check(stat.size === expectedSize, `${record.id || 'unknown'} external artifact size changed`, failures);
    check(sha256File(record.sourcePath) === expectedHash, `${record.id || 'unknown'} external artifact SHA-256 changed`, failures);
  }
}

function verifyArtifactClosure({
  canonicalPackage,
  copiedClosure,
  evidenceRoot,
  externalClosure,
  files,
  selectedEvidence,
  snapshotValidation,
}, failures) {
  if (!canonicalPackage || !snapshotValidation?.snapshot || !snapshotValidation?.snapshotArtifact) return;
  try {
    const candidates = [];
    collectHashedArtifactReferences(snapshotValidation.snapshot, 'authority-snapshot', candidates);
    for (const record of selectedEvidence.filter((candidate) => candidate.ok && candidate.sourceJson)) {
      collectHashedArtifactReferences(record.sourceJson, `gate:${record.gateId}`, candidates);
    }
    candidates.push({
      origin: 'authority-snapshot',
      ...snapshotValidation.snapshotArtifact,
    });
    candidates.push({
      origin: 'canonical-package:executable',
      ...canonicalPackage.artifacts.executable,
    });
    candidates.push({
      origin: 'canonical-package:main-bundle',
      ...canonicalPackage.artifacts.mainBundle,
    });
    const rootSources = new Set(
      files
        .filter((file) => !String(file?.id || '').startsWith('closure:'))
        .map((file) => normalizedPath(file?.sourcePath))
        .filter(Boolean),
    );
    const deduped = new Map();
    for (const candidate of candidates) {
      if (rootSources.has(normalizedPath(candidate.sourcePath))) continue;
      const validated = validateReferencedArtifact(candidate);
      const key = normalizedPath(validated.sourcePath);
      const previous = deduped.get(key);
      if (
        previous
        && (previous.sha256 !== validated.sha256 || previous.sizeBytes !== validated.sizeBytes)
      ) {
        throw new Error(`Conflicting current hash bindings for ${validated.sourcePath}.`);
      }
      if (!previous) deduped.set(key, validated);
    }
    const expectedCopied = [];
    const expectedExternal = [];
    for (const [, reference] of [...deduped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const classification = classifyReferencedArtifact(reference, evidenceRoot);
      const expected = {
        origin: reference.origin,
        sourcePath: reference.sourcePath,
        sizeBytes: reference.sizeBytes,
        sha256: reference.sha256,
        policy: classification.policy,
      };
      (classification.copy ? expectedCopied : expectedExternal).push(expected);
    }
    const recordMatches = (actual, expected) => (
      samePath(actual?.sourcePath, expected.sourcePath)
      && actual?.origin === expected.origin
      && Number(actual?.sizeBytes) === expected.sizeBytes
      && String(actual?.sha256 || '').toUpperCase() === expected.sha256
      && actual?.policy === expected.policy
    );
    check(
      copiedClosure.length === expectedCopied.length
        && expectedCopied.every((expected) => copiedClosure.some((actual) => (
          recordMatches(actual, expected)
        ))),
      'bundle copied artifact closure does not exactly match current passed-gate references',
      failures,
    );
    check(
      externalClosure.length === expectedExternal.length
        && expectedExternal.every((expected) => externalClosure.some((actual) => (
          recordMatches(actual, expected)
        ))),
      'bundle external hash-only closure does not exactly match current passed-gate references',
      failures,
    );
  } catch (error) {
    failures.push(`artifact closure recomputation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function gateSelectedEvidence(manifest, readiness, failures) {
  const records = Array.isArray(manifest.gateArtifacts) ? manifest.gateArtifacts : [];
  const ids = records.map((record) => record?.gateId);
  check(
    records.length === GATE_IDS.length
      && new Set(ids).size === GATE_IDS.length
      && GATE_IDS.every((id) => ids.includes(id)),
    'bundle gateArtifacts is not the exact eight-gate set',
    failures,
  );
  const selected = [];
  for (const id of GATE_IDS) {
    const record = records.find((candidate) => candidate?.gateId === id);
    const gate = readiness.gates.find((candidate) => candidate.id === id);
    if (!record || !gate) continue;
    check(
      record.ok === gate.ok && record.status === gate.status,
      `${id} bundle gate state does not match readiness`,
      failures,
    );
    const selectedPath = readiness.evidenceSelection.selectedPaths[id];
    check(
      (selectedPath === null && record.sourcePath === null)
        || samePath(selectedPath, record.sourcePath),
      `${id} bundle source path does not match readiness selection`,
      failures,
    );
    if (!record.sourceExists) {
      check(
        gate.ok === false
          && record.sizeBytes === null
          && record.sha256 === null
          && record.bundlePath === null,
        `${id} absent evidence record claims passed or bundled bytes`,
        failures,
      );
      selected.push({
        gateId: id,
        ok: false,
        sourceExists: false,
        sourceJson: null,
      });
      continue;
    }
    const fileRecord = manifest.files.find((file) => file?.id === `gate:${id}`);
    check(Boolean(fileRecord), `${id} selected evidence is not in bundle files`, failures);
    if (fileRecord) {
      check(
        samePath(fileRecord.sourcePath, record.sourcePath)
          && fileRecord.sizeBytes === record.sizeBytes
          && fileRecord.sha256 === record.sha256
          && fileRecord.bundlePath === record.bundlePath,
        `${id} gate summary does not match its bundled file record`,
        failures,
      );
    }
    let sourceJson = null;
    try {
      sourceJson = readJson(record.sourcePath);
    } catch (error) {
      failures.push(`${id} selected evidence is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    selected.push({
      gateId: id,
      ok: gate.ok,
      sourceExists: true,
      sourceJson,
    });
  }
  try {
    validateOperationalEvidenceSemantics(selected);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  return selected;
}

function verifyS7Bundle({
  manifestPath,
  readinessPath,
  mode,
  rootDir = ROOT,
  releaseRoot = path.join(rootDir, 'apps', 'desktop', 'release'),
  readinessRunner = null,
  nowMs = Date.now(),
} = {}) {
  const failures = [];
  if (!['ready', 'non-ready'].includes(mode)) {
    throw new Error('verifyS7Bundle mode must be ready or non-ready.');
  }
  const manifestStat = requireRegularUnlinkedFile(manifestPath, 'S7 bundle manifest', failures);
  const readinessStat = requireRegularUnlinkedFile(readinessPath, 'Mission readiness source', failures);
  if (!manifestStat || !readinessStat) return { failures, passed: false };
  const bundleDir = path.dirname(manifestPath);
  check(
    path.basename(manifestPath) === 's7-delivery-bundle-manifest.json',
    'S7 manifest must use the canonical filename',
    failures,
  );
  let manifest;
  let readiness;
  try {
    manifest = readJson(manifestPath);
    readiness = readJson(readinessPath);
  } catch (error) {
    failures.push(`S7 manifest/readiness JSON could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return { failures, passed: false };
  }
  check(manifest.kind === BUNDLE_KIND, `bundle kind must be ${BUNDLE_KIND}`, failures);
  check(
    manifest.schemaVersion === BUNDLE_SCHEMA_VERSION,
    `bundle schemaVersion must be ${BUNDLE_SCHEMA_VERSION}`,
    failures,
  );
  check(validTimestamp(manifest.generatedAt), 'bundle generatedAt is invalid', failures);
  check(
    validTimestamp(manifest.generatedAt)
      && Date.parse(manifest.generatedAt) <= nowMs + MAX_FUTURE_SKEW_MS
      && Date.parse(manifest.generatedAt) >= Date.parse(readiness.generatedAt),
    'bundle generatedAt predates readiness or is future-dated',
    failures,
  );

  const readinessValidation = validateReadinessReport(readiness, { expectedMode: mode });
  failures.push(...readinessValidation.errors.map((message) => `readiness: ${message}`));
  check(
    manifest.status === readiness.status
      && manifest.appReady === readiness.appReady
      && manifest.gateSummary?.total === GATE_IDS.length
      && manifest.gateSummary?.passed === readinessValidation.passed
      && manifest.gateSummary?.failed === readinessValidation.failed,
    'bundle top-level readiness claim does not match Mission readiness',
    failures,
  );
  check(
    Array.isArray(manifest.gateOrder)
      && JSON.stringify(manifest.gateOrder) === JSON.stringify(GATE_IDS),
    'bundle gateOrder is not canonical',
    failures,
  );
  check(
    mode === 'ready'
      ? /READY credit still requires verify:s7-ready-safety/.test(manifest.warning || '')
      : /must never be presented as READY/.test(manifest.warning || ''),
    `${mode} bundle warning contract is missing`,
    failures,
  );

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const fileIds = files.map((file) => file?.id);
  const filePaths = files.map((file) => file?.bundlePath);
  check(
    files.length > 0
      && new Set(fileIds).size === files.length
      && new Set(filePaths).size === files.length,
    'bundle file ids/paths are missing or duplicated',
    failures,
  );
  for (const file of files) validateFileRecord(file, bundleDir, failures);

  const readinessRecord = files.find((file) => file?.id === 'mission-readiness');
  check(Boolean(readinessRecord), 'bundle does not include Mission readiness', failures);
  check(
    Boolean(readinessRecord)
      && samePath(readinessRecord.sourcePath, readinessPath)
      && samePath(manifest.readiness?.sourcePath, readinessPath)
      && manifest.readiness?.sha256 === readinessRecord.sha256
      && manifest.readiness?.sizeBytes === readinessRecord.sizeBytes
      && manifest.readiness?.bundlePath === readinessRecord.bundlePath
      && manifest.readiness?.generatedAt === readiness.generatedAt,
    'bundle Mission readiness binding is inconsistent',
    failures,
  );

  const selectedEvidence = gateSelectedEvidence(manifest, readiness, failures);

  let canonicalPackage = null;
  try {
    canonicalPackage = inspectCanonicalPackage({ releaseRoot });
    check(
      JSON.stringify(canonicalPackage.identity)
        === JSON.stringify(normalizedPackageIdentity(readiness.packageIdentity))
        && JSON.stringify(canonicalPackage.identity)
        === JSON.stringify(normalizedPackageIdentity(manifest.packageIdentity)),
      'bundle/readiness package identity does not match current canonical package',
      failures,
    );
    check(
      samePath(manifest.canonicalPackage?.executablePath, canonicalPackage.paths.executablePath)
        && samePath(manifest.canonicalPackage?.appContentPath, canonicalPackage.paths.appContentPath)
        && samePath(manifest.canonicalPackage?.mainBundlePath, canonicalPackage.paths.mainBundlePath)
        && manifest.canonicalPackage?.appContentFileCount === canonicalPackage.appContentFileCount
        && manifest.canonicalPackage?.copied === false,
      'bundle canonical package provenance is incomplete',
      failures,
    );
  } catch (error) {
    failures.push(`canonical package verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const snapshotRecord = files.find((file) => file?.id === 'authority-snapshot-manifest');
  check(Boolean(snapshotRecord), 'bundle does not include authority snapshot manifest', failures);
  check(
    Boolean(snapshotRecord)
      && samePath(snapshotRecord.sourcePath, readiness.evidenceSelection.authoritySnapshotManifest)
      && samePath(manifest.authoritySnapshot?.sourcePath, snapshotRecord.sourcePath)
      && manifest.authoritySnapshot?.schemaVersion === 'mission-control-authority-database-snapshot/v2'
      && manifest.authoritySnapshot?.sha256 === snapshotRecord.sha256
      && manifest.authoritySnapshot?.sizeBytes === snapshotRecord.sizeBytes
      && manifest.authoritySnapshot?.bundlePath === snapshotRecord.bundlePath
      && manifest.authoritySnapshot?.databaseCopied === false,
    'bundle authority snapshot binding is inconsistent',
    failures,
  );
  let snapshotValidation = null;
  if (canonicalPackage) {
    try {
      snapshotValidation = validateAuthoritySnapshot(
        readiness.evidenceSelection.authoritySnapshotManifest,
        readiness,
        canonicalPackage.identity,
      );
      failures.push(...snapshotValidation.errors.map((message) => `authority snapshot: ${message}`));
      check(
        snapshotValidation.snapshotArtifact?.sha256 === manifest.authoritySnapshot?.databaseArtifactSha256
          && snapshotValidation.snapshotArtifact?.sizeBytes === manifest.authoritySnapshot?.databaseArtifactSizeBytes,
        'bundle authority snapshot database artifact binding changed',
        failures,
      );
    } catch (error) {
      failures.push(`authority snapshot verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  check(
    manifest.authorityDatabase?.copied === false
      && samePath(manifest.authorityDatabase?.sourcePath, readiness.evidenceSelection.authorityDb),
    'bundle live authority database identity is inconsistent',
    failures,
  );

  const copiedClosure = Array.isArray(manifest.closure?.copiedArtifacts)
    ? manifest.closure.copiedArtifacts
    : [];
  const externalClosure = Array.isArray(manifest.closure?.externalArtifacts)
    ? manifest.closure.externalArtifacts
    : [];
  check(
    manifest.closure?.complete === true
      && manifest.closure?.copiedArtifactCount === copiedClosure.length
      && manifest.closure?.externalHashOnlyArtifactCount === externalClosure.length,
    'bundle artifact closure summary is inconsistent',
    failures,
  );
  for (const copied of copiedClosure) {
    const file = files.find((candidate) => candidate?.id === copied?.id);
    check(
      Boolean(file)
        && file.sourcePath === copied.sourcePath
        && file.bundlePath === copied.bundlePath
        && file.sizeBytes === copied.sizeBytes
        && file.sha256 === copied.sha256,
      `${copied?.id || 'unknown'} closure file is not bound to bundle files`,
      failures,
    );
  }
  for (const external of externalClosure) validateExternalArtifact(external, failures);
  verifyArtifactClosure({
    canonicalPackage,
    copiedClosure,
    evidenceRoot: path.join(rootDir, 'output', 'codex-evidence'),
    externalClosure,
    files,
    selectedEvidence,
    snapshotValidation,
  }, failures);

  const bundleFiles = collectBundleFiles(bundleDir);
  check(
    bundleFiles.every((file) => !file.linked),
    'bundle contains a symbolic link or junction-like file entry',
    failures,
  );
  const expectedBundleFiles = new Set([
    ...files.map((file) => String(file.bundlePath).replace(/\\/g, '/')),
    's7-delivery-bundle-manifest.json',
  ]);
  const actualBundleFiles = new Set(bundleFiles.map((file) => file.relativePath));
  check(
    expectedBundleFiles.size === actualBundleFiles.size
      && [...expectedBundleFiles].every((file) => actualBundleFiles.has(file)),
    'bundle contains unlisted files or omits a listed file',
    failures,
  );

  const readme = files.find((file) => file?.id === 'readme');
  if (readme) {
    check(
      readmeContract(fs.readFileSync(readme.sourcePath, 'utf8'), mode === 'ready'),
      `${mode} README delivery line is inconsistent`,
      failures,
    );
  } else {
    failures.push('bundle README is missing');
  }

  check(
    manifest.currentRevalidation?.kind === CURRENT_REVALIDATION_KIND
      && manifest.currentRevalidation?.passed === true
      && manifest.currentRevalidation?.readyCredit === (mode === 'ready')
      && manifest.currentRevalidation?.status === readiness.status
      && manifest.currentRevalidation?.summary?.total === GATE_IDS.length
      && manifest.currentRevalidation?.summary?.passed === readinessValidation.passed,
    `${mode} bundle lacks faithful export-time formal revalidation`,
    failures,
  );
  try {
    assertCurrentRevalidation(
      readiness,
      runReadyRevalidation(readiness, { rootDir, readinessRunner }),
      mode,
    );
  } catch (error) {
    failures.push(`current ${mode} revalidation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    failures,
    manifest,
    passed: failures.length === 0,
    readiness,
  };
}

function usage() {
  return [
    'Usage: node scripts/verify-s7-ready-safety.js',
    '  --bundle-manifest <absolute s7-delivery-bundle-manifest.json>',
    '  --readiness <absolute mission-control-production-readiness.json>',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args['bundle-manifest']) throw new Error('Missing required argument: --bundle-manifest');
  if (!args.readiness) throw new Error('Missing required argument: --readiness');
  const result = verifyS7Bundle({
    manifestPath: path.resolve(args['bundle-manifest']),
    readinessPath: path.resolve(args.readiness),
    mode: 'ready',
  });
  if (!result.passed) {
    for (const failure of result.failures) process.stderr.write(`[FAIL] ${failure}\n`);
    throw new Error(`READY_SAFETY rejected: ${result.failures.length} check(s) failed.`);
  }
  process.stdout.write('READY_SAFETY verified: current Mission readiness is 8/8 and the bundle is closed.\n');
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
  collectBundleFiles,
  parseArgs,
  validateExternalArtifact,
  validateFileRecord,
  verifyS7Bundle,
};
