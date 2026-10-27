// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    EVIDENCE_MODE_ENV,
    EVIDENCE_USER_DATA_DIR_ENV,
    PACKAGE_UI_DATABASE_CHECKPOINT_PHASES,
    PACKAGE_UI_DATABASE_COMPARISON_KEYS,
    PACKAGE_UI_DATABASE_METRIC_KEYS,
    PACKAGE_UI_EVIDENCE_MODE,
    PACKAGE_UI_SCHEDULER_AUDIT_FILE,
    fs,
    path,
  } = dependencies;
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const currentFileRecordMatches = (...args) => dependencies.currentFileRecordMatches(...args);
  const derivePackageUiSchedulerGuards = (...args) => dependencies.derivePackageUiSchedulerGuards(...args);
  const isRetryableLoginNavigationError = (...args) => dependencies.isRetryableLoginNavigationError(...args);
  const normalizedWindowsPath = (...args) => dependencies.normalizedWindowsPath(...args);
  const packageUiSchedulerAuditCounts = (...args) => dependencies.packageUiSchedulerAuditCounts(...args);
  const packageUiSchedulerAuditSnapshotViolations = (...args) => dependencies.packageUiSchedulerAuditSnapshotViolations(...args);
  const safeSegment = (...args) => dependencies.safeSegment(...args);
  const sha256File = (...args) => dependencies.sha256File(...args);
  const violation = (...args) => dependencies.violation(...args);

async function collectElectronIdentity(electronApp, page, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 20));
  const retryIntervalMs = Math.max(0, Number(options.retryIntervalMs ?? 150));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const mainIdentity = await electronApp.evaluate(
        ({ app }, envKeys) => ({
          appName: app.getName(),
          appPath: app.getAppPath(),
          appVersion: app.getVersion(),
          actualExecutablePath: process.execPath,
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          actualUserDataDir: app.getPath('userData'),
          evidenceMode: process.env[envKeys.evidenceMode] || null,
          requestedUserDataDir: process.env[envKeys.userDataDir] || null,
        }),
        {
          evidenceMode: EVIDENCE_MODE_ENV,
          userDataDir: EVIDENCE_USER_DATA_DIR_ENV,
        },
      );
      return {
        ...mainIdentity,
        rendererTitle: await page.title(),
        rendererUrl: page.url(),
      };
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableLoginNavigationError(error?.message || error)) {
        throw error;
      }
      if (retryIntervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
      }
    }
  }
  throw new Error('Package UI Electron identity collection exhausted without a result.');
}

function readPackageUiSchedulerAudit(userDataDir) {
  const filePath = path.join(userDataDir, PACKAGE_UI_SCHEDULER_AUDIT_FILE);
  try {
    if (!fs.statSync(filePath).isFile()) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function exactObjectKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function derivePackageUiDatabaseComparisons(checkpoints) {
  const baseline = checkpoints?.[0]?.metrics;
  const allCheckpointsMatch = (key) => baseline
    && checkpoints?.length === PACKAGE_UI_DATABASE_CHECKPOINT_PHASES.length
    ? checkpoints.every((checkpoint) => checkpoint?.metrics?.[key] === baseline[key])
    : null;
  return {
    contextDigestMatched: checkpoints?.length === PACKAGE_UI_DATABASE_CHECKPOINT_PHASES.length
      ? checkpoints.every(
          (checkpoint) => checkpoint?.contextDigestSha256 === checkpoints[0]?.contextDigestSha256,
        )
      : null,
    digestMatched: allCheckpointsMatch('digestSha256'),
    serializedBytesMatched: allCheckpointsMatch('serializedBytes'),
    totalChangesMatched: allCheckpointsMatch('totalChanges'),
    dataVersionMatched: allCheckpointsMatch('dataVersion'),
    pageCountMatched: allCheckpointsMatch('pageCount'),
    pageSizeMatched: allCheckpointsMatch('pageSize'),
    schemaVersionMatched: allCheckpointsMatch('schemaVersion'),
    userVersionMatched: allCheckpointsMatch('userVersion'),
  };
}

function validatePackageUiDatabaseMutationAudit(audit) {
  const violations = [];
  if (!exactObjectKeys(audit, [
    'kind',
    'schemaVersion',
    'requiredPhases',
    'checkpoints',
    'comparisons',
    'passed',
  ]) || audit?.kind !== 'package-ui-database-mutation-audit' || audit?.schemaVersion !== 1) {
    violations.push(violation(
      'PACKAGE_UI_DATABASE_AUDIT_INVALID',
      'The Main database mutation audit has missing, extra, or invalid top-level fields.',
      audit ?? null,
    ));
    return { audit, passed: false, violations };
  }
  if (canonicalJson(audit.requiredPhases) !== canonicalJson(PACKAGE_UI_DATABASE_CHECKPOINT_PHASES)) {
    violations.push(violation(
      'PACKAGE_UI_DATABASE_AUDIT_PHASE_CONTRACT_INVALID',
      'The database mutation audit must declare post-bootstrap, post-navigation, then Main pre-close-terminal order.',
      audit.requiredPhases,
    ));
  }
  const checkpoints = Array.isArray(audit.checkpoints) ? audit.checkpoints : [];
  if (checkpoints.length !== PACKAGE_UI_DATABASE_CHECKPOINT_PHASES.length) {
    violations.push(violation(
      'PACKAGE_UI_DATABASE_AUDIT_CHECKPOINT_COUNT_INVALID',
      'The database mutation audit must contain exactly three checkpoints.',
      checkpoints,
    ));
  }
  checkpoints.forEach((checkpoint, index) => {
    const metrics = checkpoint?.metrics;
    if (
      !exactObjectKeys(checkpoint, [
        'sequence',
        'phase',
        'capturedAt',
        'contextDigestSha256',
        'metrics',
      ])
      || checkpoint.sequence !== index + 1
      || checkpoint.phase !== PACKAGE_UI_DATABASE_CHECKPOINT_PHASES[index]
      || !Number.isFinite(Date.parse(checkpoint.capturedAt || ''))
      || !/^[A-F0-9]{64}$/.test(String(checkpoint.contextDigestSha256 || ''))
      || !exactObjectKeys(metrics, PACKAGE_UI_DATABASE_METRIC_KEYS)
      || !/^[A-F0-9]{64}$/.test(String(metrics?.digestSha256 || ''))
      || PACKAGE_UI_DATABASE_METRIC_KEYS
        .filter((key) => key !== 'digestSha256')
        .some((key) => !Number.isSafeInteger(metrics?.[key]) || metrics[key] < 0)
    ) {
      violations.push(violation(
        'PACKAGE_UI_DATABASE_AUDIT_CHECKPOINT_INVALID',
        'A database checkpoint is malformed, reordered, or contains unapproved fields.',
        checkpoint ?? null,
      ));
    }
  });
  const derivedComparisons = derivePackageUiDatabaseComparisons(checkpoints);
  const ordered = checkpoints.length === PACKAGE_UI_DATABASE_CHECKPOINT_PHASES.length
    && checkpoints.every((checkpoint, index) => (
      checkpoint?.sequence === index + 1
      && checkpoint?.phase === PACKAGE_UI_DATABASE_CHECKPOINT_PHASES[index]
    ));
  const derivedPassed = ordered
    && Object.values(derivedComparisons).every((value) => value === true);
  if (
    !exactObjectKeys(audit.comparisons, PACKAGE_UI_DATABASE_COMPARISON_KEYS)
    || canonicalJson(audit.comparisons) !== canonicalJson(derivedComparisons)
    || audit.passed !== derivedPassed
  ) {
    violations.push(violation(
      'PACKAGE_UI_DATABASE_AUDIT_DERIVATION_INVALID',
      'Database comparison and pass fields must be derived exactly from checkpoint metrics.',
      {
        actualComparisons: audit.comparisons ?? null,
        actualPassed: audit.passed,
        derivedComparisons,
        derivedPassed,
      },
    ));
  }
  if (!derivedPassed) {
    violations.push(violation(
      'PACKAGE_UI_DATABASE_MUTATION_DETECTED',
      'The live isolated SQLite database changed after allowed bootstrap completed.',
      derivedComparisons,
    ));
  }
  return {
    audit,
    comparisons: derivedComparisons,
    passed: violations.length === 0,
    violations,
  };
}

function validatePackageUiDatabaseCheckpointReceipts(receipts, runtimeEvidence) {
  const violations = [];
  const markerCheckpoints = runtimeEvidence?.marker?.databaseMutationAudit?.checkpoints;
  if (!exactObjectKeys(receipts, ['postBootstrap', 'postNavigation'])) {
    violations.push(violation(
      'PACKAGE_UI_DATABASE_CHECKPOINT_RECEIPTS_INVALID',
      'The runner must retain exactly the Main-issued post-bootstrap and post-navigation receipts.',
      receipts ?? null,
    ));
  }
  if (
    !Array.isArray(markerCheckpoints)
    || markerCheckpoints.length !== PACKAGE_UI_DATABASE_CHECKPOINT_PHASES.length
    || canonicalJson(receipts?.postBootstrap) !== canonicalJson(markerCheckpoints[0])
    || canonicalJson(receipts?.postNavigation) !== canonicalJson(markerCheckpoints[1])
  ) {
    violations.push(violation(
      'PACKAGE_UI_DATABASE_CHECKPOINT_RECEIPTS_NOT_BOUND',
      'Renderer-held database checkpoint receipts must match the ordered checkpoints copied from Main.',
      {
        markerCheckpoints: markerCheckpoints ?? null,
        receipts: receipts ?? null,
      },
    ));
  }
  return {
    passed: violations.length === 0,
    receipts: receipts ?? null,
    terminalCheckpoint: markerCheckpoints?.[2] ?? null,
    violations,
  };
}

function validatePackageUiReadOnlyRuntimeEvidence(input, options = {}) {
  const violations = [];
  const requireSchedulerReads = options.requireSchedulerReads === true;
  violations.push(...packageUiSchedulerAuditSnapshotViolations(
    input?.marker,
    'The copied Main scheduler audit',
  ));
  const databaseMutationAudit = validatePackageUiDatabaseMutationAudit(
    input?.marker?.databaseMutationAudit,
  );
  violations.push(...databaseMutationAudit.violations);
  if (input?.processExitConfirmed !== true) {
    violations.push(violation(
      'PACKAGE_UI_READ_ONLY_RUNTIME_PROCESS_EXIT_UNCONFIRMED',
      'The Main runtime attestation may only be copied after packaged Electron has exited.',
      input?.processExitConfirmed ?? null,
    ));
  }
  if (
    input?.main?.pid !== input?.marker?.pid
    || input?.main?.evidenceMode !== PACKAGE_UI_EVIDENCE_MODE
    || normalizedWindowsPath(input?.main?.userDataDir || '')
      !== normalizedWindowsPath(input?.marker?.userDataDir || '')
  ) {
    violations.push(violation(
      'PACKAGE_UI_READ_ONLY_RUNTIME_IDENTITY_MISMATCH',
      'The live Main PID, evidence mode, and isolated userData identity must match the marker.',
      { main: input?.main ?? null, marker: input?.marker ?? null },
    ));
  }
  const counts = packageUiSchedulerAuditCounts(input?.marker?.counts);
  const suppressed = input?.marker?.suppressed || {};
  const expectedGuards = derivePackageUiSchedulerGuards(counts, suppressed);
  if (canonicalJson(input?.marker?.guards) !== canonicalJson(expectedGuards)) {
    violations.push(violation(
      'PACKAGE_UI_READ_ONLY_RUNTIME_GUARDS_NOT_DERIVED',
      'The scheduler guard attestation must be derived exactly from its recorded counts and suppressions.',
      { actual: input?.marker?.guards ?? null, expected: expectedGuards },
    ));
  }
  if (
    counts.runNow !== 0
    || counts.runNowRejected !== 0
    || counts.localSchedulerStart !== 0
    || counts.storeSchedulerStart !== 0
    || counts.reconcile !== 0
    || counts.execute !== 0
    || suppressed.localSchedulerStart < 1
    || suppressed.storeSchedulerStart < 1
    || suppressed.startupReconcile < 1
    || expectedGuards.readOnlyInvariantPassed !== true
  ) {
    violations.push(violation(
      'PACKAGE_UI_READ_ONLY_RUNTIME_MUTATION_COUNT',
      'Package UI Main must record zero run-now/start/reconcile/execute calls and explicit startup suppression.',
      { counts, suppressed },
    ));
  }
  if (
    requireSchedulerReads
    && (
      counts.workspaceQuery < 1
      || counts.schedulerGet < 1
      || counts.retentionPreview < 1
    )
  ) {
    violations.push(violation(
      'PACKAGE_UI_READ_ONLY_RUNTIME_READS_MISSING',
      'A compact scheduler evidence run must record real workspace, schedule, and retention handler reads.',
      counts,
    ));
  }
  if ((input?.marker?.events || []).some((event) => event?.outcome === 'pending')) {
    violations.push(violation(
      'PACKAGE_UI_READ_ONLY_RUNTIME_PENDING_EVENT',
      'The copied scheduler audit must not contain an incomplete handler event.',
      input.marker.events,
    ));
  }
  if (!currentFileRecordMatches(input?.artifact)) {
    violations.push(violation(
      'PACKAGE_UI_READ_ONLY_RUNTIME_ARTIFACT_STALE',
      'The copied runtime attestation is missing or its current SHA-256/size does not match.',
      input?.artifact ?? null,
    ));
  } else {
    try {
      const copied = JSON.parse(fs.readFileSync(input.artifact.path, 'utf8'));
      if (canonicalJson(copied) !== canonicalJson(input.marker)) {
        violations.push(violation(
          'PACKAGE_UI_READ_ONLY_RUNTIME_ARTIFACT_MISMATCH',
          'The copied runtime attestation bytes do not represent the live Main marker.',
          input.artifact,
        ));
      }
    } catch (error) {
      violations.push(violation(
        'PACKAGE_UI_READ_ONLY_RUNTIME_ARTIFACT_INVALID',
        'The copied runtime attestation is not valid JSON.',
        String(error?.message || error),
      ));
    }
  }
  return {
    ...input,
    counts,
    databaseMutationAudit,
    expectedGuards,
    passed: violations.length === 0,
    requireSchedulerReads,
    violations,
  };
}

async function collectPackageUiMainIdentity(electronApp) {
  return electronApp.evaluate(({ app }, evidenceModeEnv) => ({
    evidenceMode: process.env[evidenceModeEnv] || null,
    pid: process.pid,
    userDataDir: app.getPath('userData'),
  }), EVIDENCE_MODE_ENV);
}

function collectPackageUiReadOnlyRuntimeEvidence(
  main,
  userDataDir,
  runDir,
  profileId,
  options = {},
) {
  const sourceMarkerPath = path.join(userDataDir, PACKAGE_UI_SCHEDULER_AUDIT_FILE);
  if (!fs.existsSync(sourceMarkerPath) || !fs.statSync(sourceMarkerPath).isFile()) {
    return validatePackageUiReadOnlyRuntimeEvidence({
      artifact: null,
      main,
      marker: null,
      processExitConfirmed: true,
      sourceMarkerPath,
    });
  }
  let marker;
  let markerBytes;
  try {
    markerBytes = fs.readFileSync(sourceMarkerPath);
    marker = JSON.parse(markerBytes.toString('utf8'));
  } catch {
    marker = null;
    markerBytes = Buffer.alloc(0);
  }
  const artifactPath = path.join(
    runDir,
    `${safeSegment(profileId)}-${PACKAGE_UI_SCHEDULER_AUDIT_FILE}`,
  );
  fs.writeFileSync(artifactPath, markerBytes);
  const artifact = {
    path: artifactPath,
    sha256: sha256File(artifactPath),
    sizeBytes: fs.statSync(artifactPath).size,
  };
  return validatePackageUiReadOnlyRuntimeEvidence({
    artifact,
    main,
    marker,
    processExitConfirmed: true,
    sourceMarkerPath,
  }, options);
}

async function requestPackageUiDatabaseCheckpoint(page, phase) {
  return page.evaluate(async (requestedPhase) => {
    const api = window.electronAPI;
    if (typeof api?.packageUiDatabaseCheckpoint !== 'function') {
      throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_PRELOAD_UNAVAILABLE');
    }
    return api.packageUiDatabaseCheckpoint(requestedPhase);
  }, phase);
}

  return {
    collectElectronIdentity,
    readPackageUiSchedulerAudit,
    exactObjectKeys,
    derivePackageUiDatabaseComparisons,
    validatePackageUiDatabaseMutationAudit,
    validatePackageUiDatabaseCheckpointReceipts,
    validatePackageUiReadOnlyRuntimeEvidence,
    collectPackageUiMainIdentity,
    collectPackageUiReadOnlyRuntimeEvidence,
    requestPackageUiDatabaseCheckpoint,
  };
};
