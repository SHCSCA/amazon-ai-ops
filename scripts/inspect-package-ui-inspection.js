module.exports = function createInspectorModule(dependencies) {
  const {
    BUNDLED_CHROMIUM_RELATIVE_PATH,
    CHECKPOINT_SCHEMA,
    DEFAULT_APP_CONTENT,
    DEFAULT_EXE,
    InspectionError,
    PROFILE_SEQUENCE,
    RUN_GROUP_SCHEMA,
    fs,
    path,
    collectPackageUiRunnerSourceBinding,
  } = dependencies;
  const appContentManifest = (...args) => dependencies.appContentManifest(...args);
  const appendProcessViolations = (...args) => dependencies.appendProcessViolations(...args);
  const canonicalAuthorityPaths = (...args) => dependencies.canonicalAuthorityPaths(...args);
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const checkpointMatches = (...args) => dependencies.checkpointMatches(...args);
  const classify = (...args) => dependencies.classify(...args);
  const currentAuthorityBinding = (...args) => dependencies.currentAuthorityBinding(...args);
  const dedupeViolations = (...args) => dependencies.dedupeViolations(...args);
  const directoryTreeManifest = (...args) => dependencies.directoryTreeManifest(...args);
  const ensureNoFutureRecords = (...args) => dependencies.ensureNoFutureRecords(...args);
  const fail = (...args) => dependencies.fail(...args);
  const hasOnlyKeys = (...args) => dependencies.hasOnlyKeys(...args);
  const loadAttemptRecords = (...args) => dependencies.loadAttemptRecords(...args);
  const logicalMatches = (...args) => dependencies.logicalMatches(...args);
  const normalizedPath = (...args) => dependencies.normalizedPath(...args);
  const profileCursorBinding = (...args) => dependencies.profileCursorBinding(...args);
  const profileManifest = (...args) => dependencies.profileManifest(...args);
  const readEnvelope = (...args) => dependencies.readEnvelope(...args);
  const runnerFactsFromPureChild = (...args) => dependencies.runnerFactsFromPureChild(...args);
  const safeDirectory = (...args) => dependencies.safeDirectory(...args);
  const safeFileArtifact = (...args) => dependencies.safeFileArtifact(...args);
  const samePath = (...args) => dependencies.samePath(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);
  const sqliteLogicalArtifact = (...args) => dependencies.sqliteLogicalArtifact(...args);
  const stableFileRead = (...args) => dependencies.stableFileRead(...args);
  const stateMatches = (...args) => dependencies.stateMatches(...args);
  const validAuthorityBinding = (...args) => dependencies.validAuthorityBinding(...args);
  const validIsoDate = (...args) => dependencies.validIsoDate(...args);
  const validLogicalArtifact = (...args) => dependencies.validLogicalArtifact(...args);
  const validProfileState = (...args) => dependencies.validProfileState(...args);
  const validateAuthoritySelectionFromPureChild = (...args) => dependencies.validateAuthoritySelectionFromPureChild(...args);
  const validateInvocationCollections = (...args) => dependencies.validateInvocationCollections(...args);
  const validateManifestEvidenceFromPureChild = (...args) => dependencies.validateManifestEvidenceFromPureChild(...args);
  const validateManifests = (...args) => dependencies.validateManifests(...args);
  const validateProfileDatabaseProvenanceFromPureChild = (...args) => dependencies.validateProfileDatabaseProvenanceFromPureChild(...args);
  const validateProfileEvidenceFromPureChild = (...args) => dependencies.validateProfileEvidenceFromPureChild(...args);
  const validateRootStructure = (...args) => dependencies.validateRootStructure(...args);
  const violation = (...args) => dependencies.violation(...args);
  const writeResumeInspectionIntent = (...args) => dependencies.writeResumeInspectionIntent(...args);

function inspect(options, injected = {}) {
  const violations = [];
  let resumeContext = null;
  const runGroupId = options['resume-run-group'];
  const output = path.resolve(options.output);
  const runGroupPath = path.join(output, 'run-groups', runGroupId);
  const result = {
    bindings: {
      outputPathSha256: sha256Buffer(Buffer.from(normalizedPath(output), 'utf8')),
      protectedDatabasePathSha256: sha256Buffer(Buffer.from(normalizedPath(options['protected-db']), 'utf8')),
      userDataPathSha256: sha256Buffer(Buffer.from(normalizedPath(options['user-data-dir']), 'utf8')),
    },
    runGroupId,
    runnerLimitations: [],
    schemaVersion: 'package-ui-run-group-inspection/v1',
    violations,
  };
  const captureLogical = injected.captureSqliteLogicalArtifact || sqliteLogicalArtifact;
  const getRunnerFacts = injected.getRunnerFacts || runnerFactsFromPureChild;
  const validateProfileEvidence = injected.validateProfileEvidence || validateProfileEvidenceFromPureChild;
  const validateProfileProvenance = injected.validateProfileProvenance
    || validateProfileDatabaseProvenanceFromPureChild;
  const validateAuthoritySelection = injected.validateAuthoritySelection
    || validateAuthoritySelectionFromPureChild;
  try {
    if (
      injected.allowNonCanonicalPackagePaths !== true
      && (!samePath(options.executable, DEFAULT_EXE) || !samePath(options.appContent, DEFAULT_APP_CONTENT))
    ) fail('PACKAGE_PATH_OVERRIDE_FORBIDDEN', 'Production inspection must use the fixed canonical package paths.');
    const authorityPaths = injected.canonicalAuthorityPaths
      || (
        injected.allowNonCanonicalAuthorityPath === true
          ? {
            databasePath: path.resolve(options['protected-db']),
            roamingAppData: path.dirname(path.dirname(path.dirname(options['protected-db']))),
            userDataDir: path.dirname(options['protected-db']),
            userProfile: path.parse(options['protected-db']).root,
          }
          : canonicalAuthorityPaths(injected)
      );
    if (
      injected.allowNonCanonicalAuthorityPath !== true
      && !samePath(options['protected-db'], authorityPaths.databasePath)
    ) fail('PROTECTED_DB_PATH_INVALID', 'Production inspection must use the Windows Known Folder canonical authority database path.');
    if (!fs.existsSync(output) || !fs.existsSync(runGroupPath)) {
      fail('RECORD_ROOT_MISSING', 'The requested evidence root or run group does not exist.');
    }
    const root = safeDirectory(runGroupPath, 'Run-group root');
    const rootBefore = directoryTreeManifest(root, 'Run-group root');
    validateRootStructure(root);
    const rawMetadata = JSON.parse(
      stableFileRead(
        path.join(root, 'run-group.json'),
        'Run-group metadata',
        'RECORD_ROOT_INVALID',
      ).buffer.toString('utf8'),
    );
    if (
      rawMetadata?.payload?.kind === 'package-ui-run-group'
      && rawMetadata.payload.schemaVersion !== RUN_GROUP_SCHEMA
    ) {
      fail(
        'CHECKPOINT_SCHEMA_OBSOLETE',
        'Historical Package UI run groups are audit-only and require a fresh profile/run group.',
      );
    }
    const metadataRecord = readEnvelope(
      path.join(root, 'run-group.json'),
      'package-ui-run-group',
      RUN_GROUP_SCHEMA,
      root,
    );
    const metadata = metadataRecord.payload;
    if (
      !hasOnlyKeys(metadata, ['authorityBinding', 'createdAt', 'genesisProfileState', 'kind', 'packageLineage', 'profileSequence', 'protectedDatabaseLogical', 'runGroupId', 'runnerContract', 'runnerContractSha256', 'schemaVersion'])
      || metadata.runGroupId !== runGroupId
      || !validIsoDate(metadata.createdAt)
      || canonicalJson(metadata.profileSequence) !== canonicalJson(PROFILE_SEQUENCE)
      || !validProfileState(metadata.genesisProfileState)
      || !validAuthorityBinding(metadata.authorityBinding)
      || !validLogicalArtifact(metadata.protectedDatabaseLogical)
      || !hasOnlyKeys(metadata.packageLineage, ['appContentSha256', 'chromium', 'executableSha256', 'profileBindingSha256', 'profileBrowserBindingSha256'])
      || !hasOnlyKeys(metadata.packageLineage.chromium, ['relativePath', 'sha256', 'sizeBytes'])
      || !hasOnlyKeys(metadata.runnerContract, ['evidenceScript', 'protectedSqliteTempScript', 'semanticContractSha256', 'sha256'])
      || !hasOnlyKeys(metadata.runnerContract.evidenceScript, ['sha256', 'sizeBytes'])
      || !hasOnlyKeys(metadata.runnerContract.protectedSqliteTempScript, ['sha256', 'sizeBytes'])
    ) fail('RECORD_ROOT_INVALID', 'Run-group metadata has an invalid current-schema shape.');

    const exeBefore = safeFileArtifact(options.executable, 'Packaged EXE', 'PACKAGE_EXE_INVALID');
    const appBefore = appContentManifest(options.appContent);
    const chromiumPath = path.join(appBefore.root, ...BUNDLED_CHROMIUM_RELATIVE_PATH.split('/'));
    const chromiumBefore = safeFileArtifact(chromiumPath, 'Bundled Chromium', 'CHROMIUM_LINEAGE_INVALID');
    const runnerPath = path.join(__dirname, 'package-ui-evidence.js');
    const runnerBefore = collectPackageUiRunnerSourceBinding((filePath) => (
      safeFileArtifact(filePath, 'Package UI runner module', 'RUNNER_LINEAGE_INVALID')
    ));
    const protectedSqliteTempBefore = safeFileArtifact(
      path.join(__dirname, 'protected-sqlite-temp.js'),
      'Protected SQLite temp helper',
      'RUNNER_LINEAGE_INVALID',
    );
    const facts = getRunnerFacts({
      chromiumPath,
      executablePath: options.executable,
      outputDir: output,
      profileBrowserPath: path.join(options['user-data-dir'], 'stores'),
      runGroupId,
      runnerPath,
    });
    if (
      canonicalJson(facts?.runnerContract) !== canonicalJson(metadata.runnerContract)
      || metadata.runnerContractSha256 !== metadata.runnerContract.sha256
      || runnerBefore.sha256 !== metadata.runnerContract.evidenceScript.sha256
      || runnerBefore.sizeBytes !== metadata.runnerContract.evidenceScript.sizeBytes
      || protectedSqliteTempBefore.sha256
        !== metadata.runnerContract.protectedSqliteTempScript.sha256
      || protectedSqliteTempBefore.sizeBytes
        !== metadata.runnerContract.protectedSqliteTempScript.sizeBytes
    ) violations.push(violation('RUNNER_LINEAGE_DRIFT', 'Current runner code or semantic contract differs from the immutable run group.'));
    if (exeBefore.sha256 !== options['expected-exe-sha256'] || exeBefore.sha256 !== metadata.packageLineage.executableSha256) {
      violations.push(violation('PACKAGE_EXE_DRIFT', 'Packaged EXE differs from the approved run-group lineage.'));
    }
    if (appBefore.sha256 !== options['expected-app-content-sha256'] || appBefore.sha256 !== metadata.packageLineage.appContentSha256) {
      violations.push(violation('PACKAGE_APP_CONTENT_DRIFT', 'Packaged app content differs from the approved run-group lineage.'));
    }
    if (
      chromiumBefore.sha256 !== metadata.packageLineage.chromium.sha256
      || chromiumBefore.sizeBytes !== metadata.packageLineage.chromium.sizeBytes
      || metadata.packageLineage.chromium.relativePath !== BUNDLED_CHROMIUM_RELATIVE_PATH
    ) violations.push(violation('CHROMIUM_LINEAGE_DRIFT', 'Bundled Chromium differs from the immutable run-group lineage.'));
    if (
      metadata.runnerContractSha256 !== metadata.runnerContract.sha256
      || facts?.runnerContract?.sha256 !== metadata.runnerContractSha256
    ) violations.push(violation('RUNNER_LINEAGE_DRIFT', 'Run-group runner contract binding is internally inconsistent.'));
    appendProcessViolations(
      violations,
      facts,
      runGroupId,
      metadata.runnerContractSha256,
    );
    if (violations.length > 0) {
      const finalFacts = getRunnerFacts({
        chromiumPath,
        executablePath: options.executable,
        outputDir: output,
        profileBrowserPath: path.join(options['user-data-dir'], 'stores'),
        runGroupId,
        runnerPath,
      });
      appendProcessViolations(
        violations,
        finalFacts,
        runGroupId,
        metadata.runnerContractSha256,
      );
      result.processAttestation = {
        finalPackageObservedCount: finalFacts?.packageProcess?.observedCount ?? null,
        finalProfileMatchingCount: finalFacts?.profileProcess?.matchingCount ?? null,
        runnerLeaseSupported: finalFacts?.runnerLease?.supported === true,
      };
      dedupeViolations(violations);
      result.status = classify(violations);
      return result;
    }

    const profileRoot = safeDirectory(options['user-data-dir'], 'Isolated profile', 'PROFILE_CONTENT_INVALID');
    const profileDatabasePath = path.join(profileRoot, 'amazon-ai-ops.db');
    const protectedIdentity = stableFileRead(options['protected-db'], 'Protected database', 'PROTECTED_DB_INVALID');
    const profileIdentity = stableFileRead(profileDatabasePath, 'Isolated profile database', 'PROFILE_DATABASE_INVALID');
    if (
      samePath(protectedIdentity.file.path, profileIdentity.file.path)
      || (
        protectedIdentity.stat.dev === profileIdentity.stat.dev
        && protectedIdentity.stat.ino === profileIdentity.stat.ino
      )
    ) fail('PROFILE_DATABASE_NOT_ISOLATED', 'Isolated profile database is the protected authority database.');
    if (!logicalMatches(
      metadata.genesisProfileState.logicalDatabase,
      metadata.protectedDatabaseLogical,
    )) {
      fail(
        'PROFILE_GENESIS_PROVENANCE_INVALID',
        'The genesis profile logical DB is not an exact hash/size/page copy of the protected logical authority DB.',
      );
    }
    const provenanceValidation = validateProfileProvenance({
      profileDatabase: {
        path: profileDatabasePath,
        sha256: metadata.genesisProfileState.logicalDatabase.sha256,
        sizeBytes: metadata.genesisProfileState.logicalDatabase.sizeBytes,
      },
      profileDatabasePath,
      protectedDatabase: {
        path: options['protected-db'],
        sha256: metadata.protectedDatabaseLogical.sha256,
        sizeBytes: metadata.protectedDatabaseLogical.sizeBytes,
      },
      protectedDatabasePath: options['protected-db'],
      runnerPath,
    });
    if (
      provenanceValidation?.provenance?.passed !== true
      || provenanceValidation?.fileIsolation?.passed !== true
      || provenanceValidation.fileIsolation.sameFileIdentity !== false
      || provenanceValidation.fileIsolation.sharedHardLinkCount !== 0
    ) {
      fail(
        'PROFILE_DATABASE_FILE_ISOLATION_UNPROVEN',
        'Runner-grade Windows file-ID and two-way hardlink enumeration did not prove DB isolation.',
      );
    }

    const protectedBefore = captureLogical(options['protected-db'], 'protected-before');
    if (!logicalMatches(metadata.protectedDatabaseLogical, protectedBefore)) {
      violations.push(violation('PROTECTED_DB_DRIFT', 'Protected authority database differs from the immutable run group.'));
    }
    const authorityReceiptBefore = stableFileRead(
      options['authority-selection'],
      'Production authority-selection receipt',
      'AUTHORITY_SELECTION_INVALID',
    );
    const authorityValidation = validateAuthoritySelection({
      canonicalPaths: authorityPaths,
      protectedDatabasePath: options['protected-db'],
      receiptPath: authorityReceiptBefore.file.path,
    });
    if (
      authorityValidation?.passed !== true
      || authorityValidation.receiptSha256 !== authorityReceiptBefore.file.sha256
      || !logicalMatches(authorityValidation.logicalArtifact, metadata.protectedDatabaseLogical)
    ) {
      violations.push(violation(
        'AUTHORITY_SELECTION_INVALID',
        'The supplied authority-selection receipt is not current or is detached from the Known Folder authority DB and run-group logical hash.',
      ));
    }
    const authorityBindingBefore = currentAuthorityBinding(
      options['protected-db'],
      authorityReceiptBefore.file.sha256,
      authorityPaths.databasePath,
    );
    if (
      canonicalJson(authorityBindingBefore)
      !== canonicalJson(metadata.authorityBinding)
    ) {
      violations.push(violation(
        'AUTHORITY_BINDING_CHANGED',
        'Canonical DB path identity or authority-selection receipt hash differs from the immutable run group.',
      ));
    }
    const expectedProfileBinding = sha256Buffer(Buffer.from(normalizedPath(profileRoot), 'utf8'));
    const expectedBrowserBinding = sha256Buffer(Buffer.from(normalizedPath(path.join(profileRoot, 'stores')), 'utf8'));
    if (
      metadata.packageLineage.profileBindingSha256 !== expectedProfileBinding
      || metadata.packageLineage.profileBrowserBindingSha256 !== expectedBrowserBinding
    ) violations.push(violation('PROFILE_BINDING_DRIFT', 'Requested profile path differs from the immutable run-group binding.'));
    const manifestRecords = validateManifests(
      root,
      metadataRecord,
      options,
      injected.validateManifestEvidence || validateManifestEvidenceFromPureChild,
    );
    const profileLogicalBefore = captureLogical(profileDatabasePath, 'profile-before');
    const profileContentBefore = profileManifest(profileRoot);

    let cursor = metadata.genesisProfileState;
    let nextProfile = null;
    const allAttemptRecords = [];
    for (let index = 0; index < PROFILE_SEQUENCE.length; index += 1) {
      const profileId = PROFILE_SEQUENCE[index];
      const lineageStart = cursor;
      const attempts = loadAttemptRecords({
        metadata,
        profileId,
        root,
        startCursor: cursor,
      });
      allAttemptRecords.push(...attempts.records);
      cursor = attempts.cursor;
      const checkpointPath = path.join(root, 'checkpoints', `${profileId}.json`);
      if (fs.existsSync(checkpointPath)) {
        const checkpoint = readEnvelope(checkpointPath, 'package-ui-profile-checkpoint', CHECKPOINT_SCHEMA, root);
        checkpointMatches({
          checkpoint,
          lineageStart,
          metadata,
          profileId,
          records: attempts.records,
          root,
          runnerPath,
          sequence: index + 1,
          validateProfileEvidence,
        });
        cursor = checkpoint.payload.profileState.after;
        continue;
      }
      if (attempts.cleanupBindingProven !== true) {
        fail(
          'CLEANUP_BINDING_UNPROVEN',
          'A non-checkpointed attempt is not bound to complete cleanup-safe invocation evidence.',
        );
      }
      nextProfile = profileId;
      ensureNoFutureRecords(root, index);
      break;
    }
    validateInvocationCollections(root, manifestRecords, allAttemptRecords);
    if (nextProfile === null) violations.push(violation('RUN_GROUP_COMPLETE', 'Run group already has all immutable profile checkpoints.'));

    const profileContentAfter = profileManifest(profileRoot);
    const profileLogicalAfter = captureLogical(profileDatabasePath, 'profile-after');
    const currentProfileState = {
      capturedAt: new Date().toISOString(),
      logicalDatabase: profileLogicalAfter,
      profileContent: profileContentAfter,
    };
    if (
      !logicalMatches(profileLogicalBefore, profileLogicalAfter)
      || canonicalJson(profileContentBefore) !== canonicalJson(profileContentAfter)
      || !stateMatches(cursor, currentProfileState)
    ) violations.push(violation('PROFILE_CONTENT_DRIFT', 'Isolated profile changed or differs from its immutable continuation cursor.'));
    const protectedAfter = captureLogical(options['protected-db'], 'protected-after');
    if (!logicalMatches(protectedBefore, protectedAfter)) {
      violations.push(violation('PROTECTED_DB_DRIFT', 'Protected authority database changed during read-only inspection.'));
    }
    const authorityReceiptAfter = stableFileRead(
      options['authority-selection'],
      'Production authority-selection receipt',
      'AUTHORITY_SELECTION_INVALID',
    );
    if (
      authorityReceiptBefore.file.sha256 !== authorityReceiptAfter.file.sha256
      || authorityReceiptBefore.file.sizeBytes !== authorityReceiptAfter.file.sizeBytes
      || authorityReceiptBefore.file.mtimeMs !== authorityReceiptAfter.file.mtimeMs
    ) {
      violations.push(violation(
        'AUTHORITY_SELECTION_TOCTOU',
        'The production authority-selection receipt changed during inspection.',
      ));
    }
    const authorityBindingAfter = currentAuthorityBinding(
      options['protected-db'],
      authorityReceiptAfter.file.sha256,
      authorityPaths.databasePath,
    );
    if (canonicalJson(authorityBindingBefore) !== canonicalJson(authorityBindingAfter)) {
      violations.push(violation(
        'AUTHORITY_BINDING_TOCTOU',
        'Canonical authority DB file identity changed during inspection.',
      ));
    }
    const exeAfter = safeFileArtifact(options.executable, 'Packaged EXE', 'PACKAGE_EXE_INVALID');
    const appAfter = appContentManifest(options.appContent);
    const chromiumAfter = safeFileArtifact(chromiumPath, 'Bundled Chromium', 'CHROMIUM_LINEAGE_INVALID');
    const runnerAfter = collectPackageUiRunnerSourceBinding((filePath) => (
      safeFileArtifact(filePath, 'Package UI runner module', 'RUNNER_LINEAGE_INVALID')
    ));
    if (
      exeBefore.sha256 !== exeAfter.sha256
      || appBefore.sha256 !== appAfter.sha256
      || chromiumBefore.sha256 !== chromiumAfter.sha256
      || runnerBefore.sha256 !== runnerAfter.sha256
    ) violations.push(violation('PACKAGE_TOCTOU_DRIFT', 'Package or runner lineage changed during inspection.'));
    const rootAfter = directoryTreeManifest(root, 'Run-group root');
    if (canonicalJson(rootBefore) !== canonicalJson(rootAfter)) {
      violations.push(violation('RECORD_ROOT_TOCTOU', 'Run-group records changed during inspection.'));
    }
    result.nextProfileId = nextProfile;
    result.cursor = profileCursorBinding(cursor);
    result.authoritySelection = {
      receiptSha256: authorityReceiptAfter.file.sha256,
      status: authorityValidation?.status || null,
    };
    const finalFacts = getRunnerFacts({
      chromiumPath,
      executablePath: options.executable,
      outputDir: output,
      profileBrowserPath: path.join(options['user-data-dir'], 'stores'),
      runGroupId,
      runnerPath,
    });
    if (
      canonicalJson(finalFacts?.runnerContract) !== canonicalJson(metadata.runnerContract)
      || finalFacts?.runnerContract?.sha256 !== metadata.runnerContractSha256
    ) {
      violations.push(violation(
        'RUNNER_LINEAGE_DRIFT',
        'Runner code or semantic contract changed before the final process attestation.',
      ));
    }
    appendProcessViolations(
      violations,
      finalFacts,
      runGroupId,
      metadata.runnerContractSha256,
    );
    result.processAttestation = {
      finalPackageObservedCount: finalFacts?.packageProcess?.observedCount ?? null,
      finalProfileMatchingCount: finalFacts?.profileProcess?.matchingCount ?? null,
      runnerLeaseSupported: finalFacts?.runnerLease?.supported === true,
    };
    resumeContext = {
      authorityBinding: metadata.authorityBinding,
      cursor: result.cursor,
      nextProfileId: nextProfile,
      runGroupId,
      runnerContractSha256: metadata.runnerContractSha256,
    };
  } catch (error) {
    violations.push(violation(
      error instanceof InspectionError ? error.code : 'RECORD_ROOT_INVALID',
      error instanceof InspectionError
        ? error.message
        : 'Inspection failed on a missing, malformed, linked, or unstable artifact.',
    ));
  }
  dedupeViolations(violations);
  result.status = classify(violations);
  if (result.status === 'RESUME_SAFE') {
    result.resume = (injected.writeResumeInspectionIntent
      || writeResumeInspectionIntent)(options, resumeContext);
  }
  return result;
}

  return {
    inspect,
  };
};
