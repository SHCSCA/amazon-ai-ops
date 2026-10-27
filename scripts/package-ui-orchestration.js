// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    BUNDLED_CHROMIUM_RELATIVE_PATH,
    EXPECTED_PACKAGE_UI_SCALES,
    EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
    INTERACTIVE_LOGIN_CONTRACT,
    ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
    PACKAGE_UI_EVIDENCE_MODE,
    PACKAGE_UI_EVIDENCE_SCHEMA_VERSION,
    PACKAGE_UI_INVOCATION_RECEIPT_SCHEMA_VERSION,
    PACKAGE_UI_PROFILE_ATTEMPT_SCHEMA_VERSION,
    PACKAGE_UI_PROFILE_SEQUENCE,
    PACKAGE_UI_NATIVE_RUNTIME_CONTRACT,
    PACKAGE_UI_VIEWPORT,
    PACKAGE_UI_WIDE_PROFILE,
    READ_ONLY_INTERACTION_PLAN,
    ROOT,
    crypto,
    inspectPackagedUserDataOverrideContract,
    path,
    validateEvidenceUserDataPath,
  } = dependencies;
  const acquirePackageUiRunGroupLease = (...args) => dependencies.acquirePackageUiRunGroupLease(...args);
  const artifactInfo = (...args) => dependencies.artifactInfo(...args);
  const assertPackageUiRuntimeLoginBoundary = (...args) => dependencies.assertPackageUiRuntimeLoginBoundary(...args);
  const buildAppContentManifest = (...args) => dependencies.buildAppContentManifest(...args);
  const buildPackageUiAttemptArtifactManifest = (...args) => dependencies.buildPackageUiAttemptArtifactManifest(...args);
  const buildPackageUiAttemptArtifactReferences = (...args) => dependencies.buildPackageUiAttemptArtifactReferences(...args);
  const buildPackageUiRunnerContract = (...args) => dependencies.buildPackageUiRunnerContract(...args);
  const buildProcessIsolationEvidence = (...args) => dependencies.buildProcessIsolationEvidence(...args);
  const buildProductionBuildContentManifest = (...args) => dependencies.buildProductionBuildContentManifest(...args);
  const buildProtectedFileEvidence = (...args) => dependencies.buildProtectedFileEvidence(...args);
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const canonicalPackageUiAuthorityPaths = (...args) => dependencies.canonicalPackageUiAuthorityPaths(...args);
  const captureProfileLineageState = (...args) => dependencies.captureProfileLineageState(...args);
  const captureSqliteLogicalArtifact = (...args) => dependencies.captureSqliteLogicalArtifact(...args);
  const collectMatchingPackageProcesses = (...args) => dependencies.collectMatchingPackageProcesses(...args);
  const collectMatchingProfileBrowserProcesses = (...args) => dependencies.collectMatchingProfileBrowserProcesses(...args);
  const collectPackageUiProcessStartIdentity = (...args) => dependencies.collectPackageUiProcessStartIdentity(...args);
  const collectPackageUiProfileLockEvidence = (...args) => dependencies.collectPackageUiProfileLockEvidence(...args);
  const composePackageUiRunGroup = (...args) => dependencies.composePackageUiRunGroup(...args);
  const consumePackageUiResumeInspectionReceipt = (...args) => dependencies.consumePackageUiResumeInspectionReceipt(...args);
  const createPackageLineage = (...args) => dependencies.createPackageLineage(...args);
  const createPackageUiProfileAttemptContext = (...args) => dependencies.createPackageUiProfileAttemptContext(...args);
  const createStructuredFailure = (...args) => dependencies.createStructuredFailure(...args);
  const evaluatePackageUiEvidenceCompleteness = (...args) => dependencies.evaluatePackageUiEvidenceCompleteness(...args);
  const evaluateProfileDatabaseFileIsolation = (...args) => dependencies.evaluateProfileDatabaseFileIsolation(...args);
  const evaluateProfileDatabaseProvenance = (...args) => dependencies.evaluateProfileDatabaseProvenance(...args);
  const fail = (...args) => dependencies.fail(...args);
  const initializePackageUiRunGroup = (...args) => dependencies.initializePackageUiRunGroup(...args);
  const latestProductionSourceWatermark = (...args) => dependencies.latestProductionSourceWatermark(...args);
  const loadPackageUiAttemptRecords = (...args) => dependencies.loadPackageUiAttemptRecords(...args);
  const logicalSqliteArtifactMatches = (...args) => dependencies.logicalSqliteArtifactMatches(...args);
  const packageProcessAbsencePassed = (...args) => dependencies.packageProcessAbsencePassed(...args);
  const packageUiAttemptCleanupPassed = (...args) => dependencies.packageUiAttemptCleanupPassed(...args);
  const packageUiCursorBinding = (...args) => dependencies.packageUiCursorBinding(...args);
  const packageUiProfileLockSnapshotPassed = (...args) => dependencies.packageUiProfileLockSnapshotPassed(...args);
  const packageUiRunGroupId = (...args) => dependencies.packageUiRunGroupId(...args);
  const packageUiRunGroupPaths = (...args) => dependencies.packageUiRunGroupPaths(...args);
  const processSnapshotEvidencePassed = (...args) => dependencies.processSnapshotEvidencePassed(...args);
  const profileLineageStateMatches = (...args) => dependencies.profileLineageStateMatches(...args);
  const readImmutableEnvelope = (...args) => dependencies.readImmutableEnvelope(...args);
  const recordPackageUiProfileAttempt = (...args) => dependencies.recordPackageUiProfileAttempt(...args);
  const releasePackageUiRunGroupLease = (...args) => dependencies.releasePackageUiRunGroupLease(...args);
  const resolvePackageUiProfileCursor = (...args) => dependencies.resolvePackageUiProfileCursor(...args);
  const runScaleEvidence = (...args) => dependencies.runScaleEvidence(...args);
  const runWideProfileEvidence = (...args) => dependencies.runWideProfileEvidence(...args);
  const safeSegment = (...args) => dependencies.safeSegment(...args);
  const sanitizeDiagnosticText = (...args) => dependencies.sanitizeDiagnosticText(...args);
  const timestampSegment = (...args) => dependencies.timestampSegment(...args);
  const validatePackageFreshness = (...args) => dependencies.validatePackageFreshness(...args);
  const validatePackageUiAuthoritySelection = (...args) => dependencies.validatePackageUiAuthoritySelection(...args);
  const validatePackageUiResumeInspectionReceipt = (...args) => dependencies.validatePackageUiResumeInspectionReceipt(...args);
  const validateReadOnlyInteractionPlan = (...args) => dependencies.validateReadOnlyInteractionPlan(...args);
  const violation = (...args) => dependencies.violation(...args);
  const waitForPackageProcessCleanup = (...args) => dependencies.waitForPackageProcessCleanup(...args);
  const waitForProfileBrowserProcessCleanup = (...args) => dependencies.waitForProfileBrowserProcessCleanup(...args);
  const writeImmutableEnvelope = (...args) => dependencies.writeImmutableEnvelope(...args);
  const writeJsonExclusive = (...args) => dependencies.writeJsonExclusive(...args);
  const writePackageUiProfileCheckpoint = (...args) => dependencies.writePackageUiProfileCheckpoint(...args);

async function runPackageUiEvidence(options, dependencies = {}) {
  assertPackageUiRuntimeLoginBoundary(options);
  if (process.platform !== 'win32') fail('Package UI evidence currently supports Windows only', process.platform);
  const runnerContract = buildPackageUiRunnerContract();
  const runGroupId = packageUiRunGroupId(options);
  options = { ...options, runGroupId };
  const pendingInspectionReceipt = options.resumeRunGroupId
    ? validatePackageUiResumeInspectionReceipt({
      invocationArgv: options.invocationArgv,
      receiptPath: options.resumeInspectionReceiptPath,
      runGroupId,
      runnerContractSha256: runnerContract.sha256,
    })
    : null;
  const invocationId = pendingInspectionReceipt?.payload?.invocationId
    || `${timestampSegment()}-${crypto.randomUUID()}`;
  const attemptId = `${timestampSegment()}-${safeSegment(invocationId)}`;
  const runId = runGroupId;
  const outputDir = path.resolve(ROOT, options.outputDir);
  const runDir = packageUiRunGroupPaths(outputDir, runGroupId).root;
  const manifestPath = path.join(runDir, 'manifests', `${attemptId}.json`);
  const summaryPath = path.join(outputDir, `package-ui-evidence-${runId}-${attemptId}.json`);
  const invocationReceiptPath = path.join(
    runDir,
    'invocation-receipts',
    `${safeSegment(invocationId)}.json`,
  );
  let runGroupManager = null;
  let consumedInspectionReceipt = null;
  let lease = null;
  const collectProfileLocksForRun = dependencies.collectProfileLocks
    || collectPackageUiProfileLockEvidence;
  const manifest = {
    failure: null,
    kind: 'package-ui-evidence',
    schemaVersion: PACKAGE_UI_EVIDENCE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    runId,
    runGroup: {
      attemptId,
      invocationId,
      profileSequence: PACKAGE_UI_PROFILE_SEQUENCE,
      resumed: Boolean(options.resumeRunGroupId),
      runGroupId,
      runnerContractSha256: runnerContract.sha256,
    },
    invocation: {
      attemptReceipts: [],
      invocationId,
      lease: null,
      receiptPath: invocationReceiptPath,
      resumeInspectionReceipt: pendingInspectionReceipt
        ? {
          payloadSha256: pendingInspectionReceipt.payloadSha256,
          sha256: pendingInspectionReceipt.file.sha256,
        }
        : null,
    },
    requested: {
      allowInteractiveLogin: options.allowInteractiveLogin,
      allowSavedLogin: options.allowSavedLogin,
      appContentPath: options.appContentPath,
      executablePath: options.executablePath,
      expectedAppContentSha256: options.expectedAppContentSha256,
      expectedExeSha256: options.expectedExeSha256,
      evidenceMode: PACKAGE_UI_EVIDENCE_MODE,
      interactiveLoginMaximumTotalMs: options.interactiveLoginTimeoutMs * 2,
      interactiveLoginTimeoutMs: options.interactiveLoginTimeoutMs,
      loginMode: 'interactive-operator-each-run',
      authoritySelectionPath: options.authoritySelectionPath,
      protectedDatabasePath: options.protectedDatabasePath,
      profileBrowserUserDataDir: path.join(options.userDataDir, 'stores'),
      screenReaderExecutablePath: options.screenReaderExecutablePath || null,
      resumeRunGroupId: options.resumeRunGroupId,
      resumeInspectionReceiptPath: options.resumeInspectionReceiptPath,
      runGroupId,
      scales: EXPECTED_PACKAGE_UI_SCALES,
      subviewChecks: EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
      userDataDir: options.userDataDir,
      viewport: PACKAGE_UI_VIEWPORT,
      wideProfile: PACKAGE_UI_WIDE_PROFILE,
    },
    nativeRuntimeContract: PACKAGE_UI_NATIVE_RUNTIME_CONTRACT,
    interactiveLoginContract: INTERACTIVE_LOGIN_CONTRACT,
    interactionPlan: READ_ONLY_INTERACTION_PLAN,
    isolatedProfileBootstrapContract: ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
    runs: [],
    passed: false,
    violations: [],
  };

  lease = acquirePackageUiRunGroupLease({
    collectProcessIdentity: dependencies.collectProcessIdentity
      || collectPackageUiProcessStartIdentity,
    invocationId,
    outputDir,
    runGroupId,
    runnerContractSha256: runnerContract.sha256,
  });
  manifest.invocation.lease = {
    generation: lease.payload.generation,
    payloadSha256: lease.payloadSha256,
    processStartIdentitySha256: lease.payload.processStartIdentitySha256,
  };

  try {
    if (pendingInspectionReceipt) {
      consumedInspectionReceipt = consumePackageUiResumeInspectionReceipt(
        pendingInspectionReceipt,
      );
      manifest.invocation.resumeInspectionReceipt = {
        consumedAt: consumedInspectionReceipt.consumedAt,
        originalPathSha256: consumedInspectionReceipt.originalPathSha256,
        payloadSha256: consumedInspectionReceipt.payloadSha256,
        sha256: consumedInspectionReceipt.file.sha256,
      };
    }
    const interactionContract = validateReadOnlyInteractionPlan();
    manifest.interactionContract = interactionContract;
    if (!interactionContract.passed) fail('Read-only interaction contract failed', JSON.stringify(interactionContract.violations));

    manifest.userDataPreflight = {
      evidenceMode: PACKAGE_UI_EVIDENCE_MODE,
      requestedUserDataDir: options.userDataDir,
      validatedUserDataDir: validateEvidenceUserDataPath(options.userDataDir),
      passed: true,
    };
    manifest.userDataOverrideBundleContract = inspectPackagedUserDataOverrideContract(
      path.join(options.appContentPath, 'dist', 'main', 'index.js'),
    );
    if (!manifest.userDataOverrideBundleContract.passed) {
      fail('Packaged main bundle does not contain the fail-closed userData override contract', JSON.stringify(
        manifest.userDataOverrideBundleContract.violations,
      ));
    }

    const chromiumPath = path.join(options.appContentPath, BUNDLED_CHROMIUM_RELATIVE_PATH);
    const collectPackageProcesses = dependencies.collectPackageProcesses
      || collectMatchingPackageProcesses;
    const collectProfileProcesses = dependencies.collectProfileProcesses
      || collectMatchingProfileBrowserProcesses;
    const packageProcessesBefore = collectPackageProcesses(options.executablePath);
    const profileBrowserProcessesBefore = collectProfileProcesses(
      manifest.requested.profileBrowserUserDataDir,
      { expectedExecutablePath: chromiumPath },
    );
    const runGroupProfileLockOptions = {
      invocationId,
      profileId: 'run-group',
    };
    const profileLocksBefore = collectProfileLocksForRun(
      options.userDataDir,
      runGroupProfileLockOptions,
    );
    manifest.packageProcessIsolation = {
      before: packageProcessesBefore,
      after: null,
      passed: false,
    };
    manifest.profileProcessIsolation = {
      before: profileBrowserProcessesBefore,
      after: null,
      passed: false,
    };
    manifest.profileLockIsolation = {
      after: null,
      before: profileLocksBefore,
      passed: false,
    };
    if (!packageProcessAbsencePassed(packageProcessesBefore)) {
      fail('Every same-name AmazonAIOpsAgent.exe process must be absent before evidence capture', JSON.stringify(packageProcessesBefore));
    }
    if (
      !processSnapshotEvidencePassed(profileBrowserProcessesBefore)
      || profileBrowserProcessesBefore.matchingCount !== 0
      || profileBrowserProcessesBefore.unresolvedCount !== 0
    ) {
      fail('A Chromium profile process was already running or could not be resolved before evidence capture', JSON.stringify(profileBrowserProcessesBefore));
    }
    if (!packageUiProfileLockSnapshotPassed(profileLocksBefore)) {
      fail('The isolated profile bounded lock/handle preflight was incomplete', JSON.stringify(profileLocksBefore));
    }

    const canonicalAuthorityPaths = (
      dependencies.canonicalAuthorityPaths
      || canonicalPackageUiAuthorityPaths
    )();
    const authorityValidation = (
      dependencies.validateAuthoritySelection
      || validatePackageUiAuthoritySelection
    )({
      authoritySelectionPath: options.authoritySelectionPath,
      canonicalPaths: canonicalAuthorityPaths,
      protectedDatabasePath: options.protectedDatabasePath,
    });
    manifest.authority = {
      binding: authorityValidation.authorityBinding,
      selectionStatus: authorityValidation.status,
    };
    if (
      pendingInspectionReceipt
      && canonicalJson(pendingInspectionReceipt.payload.authorityBinding)
        !== canonicalJson(authorityValidation.authorityBinding)
    ) {
      fail('Resume inspection receipt authority binding changed before runner entry');
    }
    const profileDatabasePath = path.join(options.userDataDir, 'amazon-ai-ops.db');
    const protectedDatabaseBefore = artifactInfo(options.protectedDatabasePath);
    const protectedDatabaseLogicalBefore = captureSqliteLogicalArtifact(
      options.protectedDatabasePath,
      'protected-before',
    );
    if (!logicalSqliteArtifactMatches(
      authorityValidation.logicalArtifact,
      protectedDatabaseLogicalBefore,
    )) {
      fail('Current authority-selection receipt logical artifact changed before run-group entry');
    }
    manifest.protectedDatabase = {
      before: protectedDatabaseBefore,
      after: null,
      passed: false,
      unchanged: false,
    };
    manifest.protectedDatabaseLogical = {
      after: null,
      before: protectedDatabaseLogicalBefore,
      passed: false,
      unchanged: false,
    };

    const artifacts = {
      appContent: buildAppContentManifest(options.appContentPath),
      chromium: artifactInfo(chromiumPath),
      exe: artifactInfo(options.executablePath),
    };
    manifest.artifactsBefore = artifacts;
    if (artifacts.exe.sha256 !== options.expectedExeSha256) {
      fail('EXE hash does not match --expected-exe-sha256', `${artifacts.exe.sha256} != ${options.expectedExeSha256}`);
    }
    if (artifacts.appContent.sha256 !== options.expectedAppContentSha256) {
      fail('Unpacked app-content hash does not match --expected-app-content-sha256', `${artifacts.appContent.sha256} != ${options.expectedAppContentSha256}`);
    }
    const governanceSource = require('./package-ui-native-launch').collectPackageUiGovernanceSource(options, artifacts, ROOT);
    options.governanceSourceIdentity = governanceSource?.identity || null;
    options.governanceBuildState = governanceSource?.buildState || null;
    manifest.nativeSourceIdentity = governanceSource;
    options.chromiumArtifact = artifacts.chromium;
    const packageLineage = createPackageLineage(options, artifacts);
    const currentProfileState = captureProfileLineageState(
      options.userDataDir,
      profileDatabasePath,
      'run-group-entry',
    );
    runGroupManager = initializePackageUiRunGroup({
      authorityBinding: authorityValidation.authorityBinding,
      genesisProfileState: currentProfileState,
      options,
      outputDir,
      packageLineage,
      protectedDatabaseLogical: protectedDatabaseLogicalBefore,
      runnerContract,
    });
    manifest.runGroup = {
      ...manifest.runGroup,
      authorityBinding: runGroupManager.metadata.authorityBinding,
      metadata: runGroupManager.metadataRecord.file,
      profileSequence: runGroupManager.metadata.profileSequence,
      resumed: runGroupManager.resumed,
      runnerContractSha256: runGroupManager.metadata.runnerContractSha256,
    };
    if (pendingInspectionReceipt) {
      let nextProfileId = null;
      let nextCursor = null;
      for (const candidateProfileId of PACKAGE_UI_PROFILE_SEQUENCE) {
        const candidate = resolvePackageUiProfileCursor(
          runGroupManager,
          candidateProfileId,
        );
        if (!candidate.checkpoint) {
          nextProfileId = candidateProfileId;
          nextCursor = candidate.cursor;
          break;
        }
      }
      if (
        nextProfileId === null
        || pendingInspectionReceipt.payload.nextProfileId !== nextProfileId
        || canonicalJson(pendingInspectionReceipt.payload.cursor)
          !== canonicalJson(packageUiCursorBinding(nextCursor))
      ) {
        fail('Resume inspection receipt cursor no longer matches the run group');
      }
    }
    console.error(
      `[RUN GROUP] ${runGroupManager.runGroupId} `
      + `(${runGroupManager.resumed ? 'resumed' : 'created'}); `
      + `use --resume-run-group ${runGroupManager.runGroupId} after a later profile interruption.`,
    );
    manifest.profileDatabaseProvenance = evaluateProfileDatabaseProvenance({
      profileDatabase: {
        path: profileDatabasePath,
        sha256: runGroupManager.metadata.genesisProfileState.logicalDatabase.sha256,
        sizeBytes: runGroupManager.metadata.genesisProfileState.logicalDatabase.sizeBytes,
      },
      protectedDatabase: {
        path: options.protectedDatabasePath,
        sha256: runGroupManager.metadata.protectedDatabaseLogical.sha256,
        sizeBytes: runGroupManager.metadata.protectedDatabaseLogical.sizeBytes,
      },
    });
    if (!manifest.profileDatabaseProvenance.passed) {
      fail('Isolated profile logical database provenance failed', JSON.stringify(
        manifest.profileDatabaseProvenance.violations,
      ));
    }
    const sourceWatermark = latestProductionSourceWatermark();
    const buildContent = buildProductionBuildContentManifest(path.join(ROOT, 'apps', 'desktop', 'dist'));
    const packagedDistContent = buildProductionBuildContentManifest(path.join(options.appContentPath, 'dist'));
    const freshness = validatePackageFreshness({ buildContent, packagedDistContent, sourceWatermark });
    manifest.sourceWatermark = sourceWatermark;
    manifest.buildContent = buildContent;
    manifest.packagedDistContent = packagedDistContent;
    manifest.freshness = freshness;
    if (!freshness.passed) fail('Packaged app content is stale or differs from the current build', JSON.stringify(freshness.violations));

    manifest.profileDatabaseFileIsolation = evaluateProfileDatabaseFileIsolation({
      profileDatabasePath,
      protectedDatabasePath: options.protectedDatabasePath,
    });
    if (!manifest.profileDatabaseFileIsolation.passed) {
      fail('Isolated profile database file-identity check failed before packaged Electron launch', JSON.stringify(
        manifest.profileDatabaseFileIsolation.violations,
      ));
    }

    for (let profileIndex = 0; profileIndex < PACKAGE_UI_PROFILE_SEQUENCE.length; profileIndex += 1) {
      const profileId = PACKAGE_UI_PROFILE_SEQUENCE[profileIndex];
      const cursor = resolvePackageUiProfileCursor(runGroupManager, profileId);
      if (cursor.checkpoint) {
        console.error(`[RESUME ${profileIndex + 1}/${PACKAGE_UI_PROFILE_SEQUENCE.length}] Reusing immutable ${profileId} checkpoint.`);
        continue;
      }
      const beforeState = captureProfileLineageState(
        options.userDataDir,
        profileDatabasePath,
        `${profileId}-before`,
      );
      if (!profileLineageStateMatches(cursor.cursor, beforeState)) {
        fail(
          'Current isolated profile does not match the run-group continuation cursor',
          profileId,
        );
      }
      const profileOptions = {
        ...options,
        runGroupId,
        invocationId,
        profileId,
        profileStage: {
          current: profileIndex + 1,
          profileId,
          total: PACKAGE_UI_PROFILE_SEQUENCE.length,
        },
        requireFreshTypedProof: profileId === PACKAGE_UI_PROFILE_SEQUENCE[0],
      };
      console.error(
        `[PROFILE ${profileIndex + 1}/${PACKAGE_UI_PROFILE_SEQUENCE.length}] Starting ${profileId}; `
        + `${profileOptions.requireFreshTypedProof ? 'fresh typed proof required' : 'saved continuation permitted'}.`,
      );
      const attemptContext = createPackageUiProfileAttemptContext(
        runGroupManager,
        profileId,
        { invocationId, lease },
      );
      const rawRun = profileId === PACKAGE_UI_WIDE_PROFILE.id
        ? await runWideProfileEvidence(
            profileOptions,
            artifacts,
            attemptContext.artifactDir,
          )
        : await runScaleEvidence(
          profileOptions,
          EXPECTED_PACKAGE_UI_SCALES.find(
            (scale) => `${scale.scalePercent}-compact` === profileId,
          ),
          artifacts,
          attemptContext.artifactDir,
        );
      const attemptArtifacts = buildPackageUiAttemptArtifactManifest(
        attemptContext.artifactDir,
      );
      const run = {
        ...rawRun,
        attemptArtifacts,
        profileId,
        evidenceBinding: {
          attemptId: attemptContext.attemptId,
          invocationId,
          profileId,
          profileLockBinding:
            rawRun?.profileLockIsolation?.before?.binding || null,
          runGroupId: runGroupManager.runGroupId,
          runnerContractSha256:
            runGroupManager.metadata.runnerContractSha256,
          scalePercent: profileId === PACKAGE_UI_WIDE_PROFILE.id
            ? PACKAGE_UI_WIDE_PROFILE.scalePercent
            : rawRun.scalePercent,
        },
      };
      run.artifactReferences = buildPackageUiAttemptArtifactReferences(
        attemptArtifacts,
        run,
      );
      const resumable = packageUiAttemptCleanupPassed(run);
      const afterState = resumable
        ? captureProfileLineageState(
            options.userDataDir,
            profileDatabasePath,
            `${profileId}-after`,
          )
        : null;
      const profileState = { after: afterState, before: beforeState };
      const attemptRecord = recordPackageUiProfileAttempt({
        attemptArtifacts,
        attemptContext,
        manager: runGroupManager,
        profileId,
        profileState,
        resumable,
        runEvidence: run,
      });
      const attemptEnvelope = readImmutableEnvelope(
        attemptRecord.path,
        'package-ui-profile-attempt',
        PACKAGE_UI_PROFILE_ATTEMPT_SCHEMA_VERSION,
      );
      manifest.invocation.attemptReceipts.push({
        attemptId: attemptEnvelope.payload.attemptId,
        file: attemptEnvelope.file,
        invocationId: attemptEnvelope.payload.invocationId,
        invocationManifest: attemptEnvelope.payload.attemptInvocationManifest,
        ordinal: attemptEnvelope.payload.ordinal,
        payloadSha256: attemptEnvelope.payloadSha256,
        profileId,
      });
      if (!resumable) {
        fail(
          `Packaged UI ${profileId} cleanup could not be attested; this run group is non-resumable and a fresh isolated profile/run group is required`,
          JSON.stringify({
            chromiumProcessLineage: run.chromiumProcessLineage,
            packageProcessIsolation: run.packageProcessIsolation,
            profileProcessIsolation: run.profileProcessIsolation,
          }),
        );
      }
      if (!run.passed) {
        fail(`Packaged UI ${profileId} evidence profile failed`, JSON.stringify(run.failure || {
          chromiumProcessLineage: run.chromiumProcessLineage,
          packageProcessIsolation: run.packageProcessIsolation,
          profileProcessIsolation: run.profileProcessIsolation,
        }));
      }
      writePackageUiProfileCheckpoint({
        attemptRecord,
        lineageStart: cursor.lineageStart,
        manager: runGroupManager,
        profileId,
        profileState,
        runEvidence: run,
      });
    }
    const checkpointComposition = composePackageUiRunGroup(runGroupManager);
    manifest.runs = checkpointComposition.compactRuns;
    manifest.wideProfile = checkpointComposition.wideProfile;
    manifest.checkpointComposition = {
      checkpointRecords: checkpointComposition.checkpointRecords,
      finalProfileState: checkpointComposition.finalProfileState,
      packageLineage: checkpointComposition.packageLineage,
      passed: checkpointComposition.passed,
      runGroupId: checkpointComposition.runGroupId,
      runnerContractSha256: checkpointComposition.runnerContractSha256,
    };
    const terminalProfileState = captureProfileLineageState(
      options.userDataDir,
      profileDatabasePath,
      'run-group-terminal',
    );
    manifest.profileLineage = {
      final: terminalProfileState,
      passed: profileLineageStateMatches(
        checkpointComposition.finalProfileState,
        terminalProfileState,
      ),
    };
    if (!manifest.profileLineage.passed) {
      fail('Terminal isolated profile state does not match the composed checkpoint lineage');
    }

    const artifactsAfter = {
      appContent: buildAppContentManifest(options.appContentPath),
      chromium: artifactInfo(chromiumPath),
      exe: artifactInfo(options.executablePath),
    };
    manifest.artifactsAfter = artifactsAfter;
    manifest.nativeSourceIdentityAfter = require('./package-ui-native-launch').collectPackageUiGovernanceSource(options, artifactsAfter, ROOT);
    if (governanceSource && canonicalJson(manifest.nativeSourceIdentityAfter) !== canonicalJson(governanceSource)) {
      fail('Package UI governance source identity changed during the same run.');
    }
    manifest.artifactHashesStable = artifacts.exe.sha256 === artifactsAfter.exe.sha256
      && artifacts.appContent.sha256 === artifactsAfter.appContent.sha256
      && artifacts.chromium.sha256 === artifactsAfter.chromium.sha256;
    const protectedDatabaseAfter = artifactInfo(options.protectedDatabasePath);
    manifest.protectedDatabase = buildProtectedFileEvidence(protectedDatabaseBefore, protectedDatabaseAfter);
    const protectedDatabaseLogicalAfter = captureSqliteLogicalArtifact(
      options.protectedDatabasePath,
      'protected-after',
    );
    manifest.protectedDatabaseLogical = {
      after: protectedDatabaseLogicalAfter,
      before: protectedDatabaseLogicalBefore,
      passed: logicalSqliteArtifactMatches(
        protectedDatabaseLogicalBefore,
        protectedDatabaseLogicalAfter,
      ),
      unchanged: logicalSqliteArtifactMatches(
        protectedDatabaseLogicalBefore,
        protectedDatabaseLogicalAfter,
      ),
    };
    const [packageProcessesAfter, profileBrowserProcessesAfter] = await Promise.all([
      waitForPackageProcessCleanup(options.executablePath),
      waitForProfileBrowserProcessCleanup(
        manifest.requested.profileBrowserUserDataDir,
        {
          collectOptions: {
            baselineProcessIds: profileBrowserProcessesBefore.observedProcessIds || [],
            expectedExecutablePath: chromiumPath,
          },
        },
      ),
    ]);
    const profileLocksAfter = collectProfileLocksForRun(
      options.userDataDir,
      runGroupProfileLockOptions,
    );
    manifest.packageProcessIsolation = buildProcessIsolationEvidence(packageProcessesBefore, packageProcessesAfter);
    manifest.profileProcessIsolation = buildProcessIsolationEvidence(
      profileBrowserProcessesBefore,
      profileBrowserProcessesAfter,
    );
    manifest.profileLockIsolation = {
      after: profileLocksAfter,
      before: profileLocksBefore,
      passed: packageUiProfileLockSnapshotPassed(profileLocksBefore)
        && packageUiProfileLockSnapshotPassed(
          profileLocksAfter,
          profileLocksBefore.binding,
        ),
    };
    const completeness = evaluatePackageUiEvidenceCompleteness(manifest);
    manifest.completeness = completeness;
    manifest.passed = completeness.passed;
    manifest.violations = completeness.violations;
    if (!manifest.passed) fail('Package UI evidence completeness failed', JSON.stringify(completeness.violations));
  } catch (error) {
    manifest.passed = false;
    manifest.failure = createStructuredFailure(error, 'package-ui-evidence');
    manifest.violations = manifest.violations || [];
    manifest.violations.push(violation('RUN_FAILED', 'Packaged UI evidence stopped fail-closed.', manifest.failure.message));
  } finally {
    const postRunAttestationErrors = [];
    if (manifest.packageProcessIsolation?.before && !manifest.packageProcessIsolation.after) {
      try {
        const packageProcessesAfter = await waitForPackageProcessCleanup(options.executablePath);
        manifest.packageProcessIsolation = buildProcessIsolationEvidence(
          manifest.packageProcessIsolation.before,
          packageProcessesAfter,
        );
      } catch (error) {
        postRunAttestationErrors.push({
          check: 'package-process-isolation',
          message: String(error?.message || error),
        });
      }
    }
    if (manifest.profileProcessIsolation?.before && !manifest.profileProcessIsolation.after) {
      try {
        const profileProcessesAfter = await waitForProfileBrowserProcessCleanup(
          manifest.requested.profileBrowserUserDataDir,
          {
            collectOptions: {
              expectedExecutablePath: path.join(
                options.appContentPath,
                BUNDLED_CHROMIUM_RELATIVE_PATH,
              ),
              baselineProcessIds:
                manifest.profileProcessIsolation.before.observedProcessIds || [],
            },
          },
        );
        manifest.profileProcessIsolation = buildProcessIsolationEvidence(
          manifest.profileProcessIsolation.before,
          profileProcessesAfter,
        );
      } catch (error) {
        postRunAttestationErrors.push({
          check: 'profile-process-isolation',
          message: sanitizeDiagnosticText(error?.message || error),
        });
      }
    }
    if (manifest.protectedDatabase?.before && !manifest.protectedDatabase.after) {
      try {
        manifest.protectedDatabase = buildProtectedFileEvidence(
          manifest.protectedDatabase.before,
          artifactInfo(options.protectedDatabasePath),
        );
      } catch (error) {
        postRunAttestationErrors.push({
          check: 'protected-database',
          message: String(error?.message || error),
        });
      }
    }
    if (manifest.profileLockIsolation?.before && !manifest.profileLockIsolation.after) {
      try {
        const profileLocksAfter = collectProfileLocksForRun(
          options.userDataDir,
          {
            invocationId,
            profileId: 'run-group',
          },
        );
        manifest.profileLockIsolation = {
          after: profileLocksAfter,
          before: manifest.profileLockIsolation.before,
          passed: packageUiProfileLockSnapshotPassed(
            manifest.profileLockIsolation.before,
          )
            && packageUiProfileLockSnapshotPassed(
              profileLocksAfter,
              manifest.profileLockIsolation.before.binding,
            ),
        };
      } catch (error) {
        postRunAttestationErrors.push({
          check: 'profile-lock-isolation',
          message: sanitizeDiagnosticText(error?.message || error),
        });
      }
    }
    if (
      manifest.protectedDatabaseLogical?.before
      && !manifest.protectedDatabaseLogical.after
    ) {
      try {
        const logicalAfter = captureSqliteLogicalArtifact(
          options.protectedDatabasePath,
          'protected-finally',
        );
        manifest.protectedDatabaseLogical = {
          after: logicalAfter,
          before: manifest.protectedDatabaseLogical.before,
          passed: logicalSqliteArtifactMatches(
            manifest.protectedDatabaseLogical.before,
            logicalAfter,
          ),
          unchanged: logicalSqliteArtifactMatches(
            manifest.protectedDatabaseLogical.before,
            logicalAfter,
          ),
        };
      } catch (error) {
        postRunAttestationErrors.push({
          check: 'protected-database-logical',
          message: String(error?.message || error),
        });
      }
    }
    if (postRunAttestationErrors.length > 0) {
      manifest.postRunAttestationErrors = postRunAttestationErrors;
      manifest.passed = false;
      if (manifest.failure === null) {
        manifest.failure = createStructuredFailure(
          new Error('One or more terminal Package UI attestations failed.'),
          'post-run-attestation',
        );
      }
    }
    const actualInvocationAttempts = [];
    if (runGroupManager) {
      for (const profileId of PACKAGE_UI_PROFILE_SEQUENCE) {
        for (const record of loadPackageUiAttemptRecords(
          runGroupManager,
          profileId,
        )) {
          if (record.payload.invocationId !== invocationId) continue;
          actualInvocationAttempts.push({
            attemptId: record.payload.attemptId,
            file: record.file,
            invocationId: record.payload.invocationId,
            invocationManifest: record.payload.attemptInvocationManifest,
            ordinal: record.payload.ordinal,
            payloadSha256: record.payloadSha256,
            profileId,
          });
        }
      }
    }
    actualInvocationAttempts.sort((left, right) => (
      PACKAGE_UI_PROFILE_SEQUENCE.indexOf(left.profileId)
        - PACKAGE_UI_PROFILE_SEQUENCE.indexOf(right.profileId)
      || left.ordinal - right.ordinal
    ));
    const declaredInvocationAttempts = [...manifest.invocation.attemptReceipts]
      .sort((left, right) => (
        PACKAGE_UI_PROFILE_SEQUENCE.indexOf(left.profileId)
          - PACKAGE_UI_PROFILE_SEQUENCE.indexOf(right.profileId)
        || left.ordinal - right.ordinal
      ));
    if (
      canonicalJson(actualInvocationAttempts)
      !== canonicalJson(declaredInvocationAttempts)
    ) {
      manifest.passed = false;
      manifest.failure = createStructuredFailure(
        new Error('Invocation manifest attempt collection is incomplete or detached.'),
        'invocation-attempt-collection',
      );
      manifest.violations.push(violation(
        'INVOCATION_ATTEMPT_COLLECTION_MISMATCH',
        'Manifest attempt collection must exactly match immutable attempts for this invocation.',
      ));
    }
    manifest.invocation.attemptReceipts = actualInvocationAttempts;
    manifest.invocation.collection = {
      attemptCount: actualInvocationAttempts.length,
      attemptInvocationManifestCount: actualInvocationAttempts.filter(
        (entry) => entry.invocationManifest,
      ).length,
      passed: actualInvocationAttempts.every(
        (entry) => entry.invocationId === invocationId,
      ),
    };
    if (manifest.passed !== true && manifest.failure === null) {
      manifest.failure = createStructuredFailure(
        new Error('Package UI invocation failed without a prior structured failure.'),
        'package-ui-evidence',
      );
    }
    manifest.completedAt = new Date().toISOString();
    manifest.invocation.leaseHeldThroughPersistence = true;
    const manifestRecord = writeJsonExclusive(manifestPath, manifest);
    const summaryRecord = writeJsonExclusive(summaryPath, manifest);
    const invocationReceipt = writeImmutableEnvelope(
      invocationReceiptPath,
      {
        attemptReceipts: actualInvocationAttempts,
        authorityBinding: manifest.authority?.binding || null,
        completedAt: new Date().toISOString(),
        failure: manifest.failure,
        invocationId,
        kind: 'package-ui-invocation-receipt',
        lease: {
          generation: lease.payload.generation,
          payloadSha256: lease.payloadSha256,
          processStartIdentitySha256: lease.payload.processStartIdentitySha256,
        },
        manifest: manifestRecord,
        passed: manifest.passed === true,
        resumeInspectionReceipt: consumedInspectionReceipt
          ? {
            payloadSha256: consumedInspectionReceipt.payloadSha256,
            sha256: consumedInspectionReceipt.file.sha256,
          }
          : null,
        runGroupId,
        runnerContractSha256: runnerContract.sha256,
        schemaVersion: PACKAGE_UI_INVOCATION_RECEIPT_SCHEMA_VERSION,
        summary: summaryRecord,
      },
    );
    manifest.invocationReceipt = invocationReceipt;
    releasePackageUiRunGroupLease(lease);
  }

  if (!manifest.passed) {
    const error = new Error(`Package UI evidence failed: ${manifestPath}`);
    error.evidencePath = manifestPath;
    throw error;
  }
  return {
    invocationReceiptPath,
    manifest,
    manifestPath,
    summaryPath,
  };
}

  return {
    runPackageUiEvidence,
  };
};
