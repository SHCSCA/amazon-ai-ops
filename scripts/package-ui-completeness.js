// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    EXPECTED_OVERLAY_CHECK_IDS,
    EXPECTED_PACKAGE_UI_ENTRIES,
    EXPECTED_PACKAGE_UI_SCALES,
    EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
    EXPECTED_PACKAGE_UI_WORKSPACES,
    INTERACTIVE_LOGIN_CONTRACT,
    ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
    LEGACY_PACKAGE_UI_EVIDENCE_SCHEMA_VERSION,
    LEGACY_SCHEDULER_READ_ONLY_PACKAGE_UI_EVIDENCE_SCHEMA_VERSION,
    PACKAGE_OBJECT_WORKSPACES,
    PACKAGE_UI_EVIDENCE_SCHEMA_VERSION,
    PACKAGE_UI_PROFILE_SEQUENCE,
    PACKAGE_UI_VIEWPORT,
    PACKAGE_UI_WIDE_PROFILE,
    path,
  } = dependencies;
  const buildPackageUiRunnerContract = (...args) => dependencies.buildPackageUiRunnerContract(...args);
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const chromiumLineageEvidencePassed = (...args) => dependencies.chromiumLineageEvidencePassed(...args);
  const currentFileRecordMatches = (...args) => dependencies.currentFileRecordMatches(...args);
  const evaluatePackageViewportContract = (...args) => dependencies.evaluatePackageViewportContract(...args);
  const exactPackageUiCollection = (...args) => dependencies.exactPackageUiCollection(...args);
  const firstInteractiveLoginAttestationPassed = (...args) => dependencies.firstInteractiveLoginAttestationPassed(...args);
  const logicalSqliteArtifactMatches = (...args) => dependencies.logicalSqliteArtifactMatches(...args);
  const packageProcessAbsencePassed = (...args) => dependencies.packageProcessAbsencePassed(...args);
  const packageProcessIsolationEvidencePassed = (...args) => dependencies.packageProcessIsolationEvidencePassed(...args);
  const packageUiAttemptArtifactManifestMatches = (...args) => dependencies.packageUiAttemptArtifactManifestMatches(...args);
  const packageUiCheckpointRecordMatches = (...args) => dependencies.packageUiCheckpointRecordMatches(...args);
  const packageUiProfileLockIsolationPassed = (...args) => dependencies.packageUiProfileLockIsolationPassed(...args);
  const processIsolationEvidencePassed = (...args) => dependencies.processIsolationEvidencePassed(...args);
  const profileLineageStateMatches = (...args) => dependencies.profileLineageStateMatches(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);
  const validPackageUiAuthorityBinding = (...args) => dependencies.validPackageUiAuthorityBinding(...args);
  const validRunDiagnostics = (...args) => dependencies.validRunDiagnostics(...args);
  const validateCurrentProfileExactSet = (...args) => dependencies.validateCurrentProfileExactSet(...args);
  const validateIsolatedProfileBootstrapEvidence = (...args) => dependencies.validateIsolatedProfileBootstrapEvidence(...args);
  const validatePackageMinimumWindow = (...args) => dependencies.validatePackageMinimumWindow(...args);
  const validatePackageUiAttemptArtifactMembership = (...args) => dependencies.validatePackageUiAttemptArtifactMembership(...args);
  const validatePackageUiDatabaseCheckpointReceipts = (...args) => dependencies.validatePackageUiDatabaseCheckpointReceipts(...args);
  const validatePackageUiReadOnlyRuntimeEvidence = (...args) => dependencies.validatePackageUiReadOnlyRuntimeEvidence(...args);
  const validateSchedulerSubviewEvidence = (...args) => dependencies.validateSchedulerSubviewEvidence(...args);
  const validateSchedulerSubviewRuntimeBinding = (...args) => dependencies.validateSchedulerSubviewRuntimeBinding(...args);
  const validateWorkspaceRuntimeMetrics = (...args) => dependencies.validateWorkspaceRuntimeMetrics(...args);
  const validateWorkspaceTabKeyboardEvidence = (...args) => dependencies.validateWorkspaceTabKeyboardEvidence(...args);
  const violation = (...args) => dependencies.violation(...args);

function evaluatePackageUiEvidenceCompleteness(input) {
  const violations = [];
  const schemaVersion = Number(input.schemaVersion || 0);
  const legacyV5 = schemaVersion === LEGACY_PACKAGE_UI_EVIDENCE_SCHEMA_VERSION;
  const legacySchedulerReadOnlyV6 =
    schemaVersion === LEGACY_SCHEDULER_READ_ONLY_PACKAGE_UI_EVIDENCE_SCHEMA_VERSION;
  const interactiveLoginCurrent = schemaVersion === PACKAGE_UI_EVIDENCE_SCHEMA_VERSION;
  const schedulerReadOnlyContract = legacySchedulerReadOnlyV6 || interactiveLoginCurrent;
  const runs = Array.isArray(input.runs) ? input.runs : [];
  const wideRun = input.wideProfile;
  if (!legacyV5 && !schedulerReadOnlyContract) {
    violations.push(violation(
      'PACKAGE_UI_SCHEMA_UNSUPPORTED',
      'Package UI evidence must use historical schema v5/v6 or current two-phase interactive-login schema v9; schema v7 is superseded.',
      { schemaVersion },
    ));
  }
  if (
    interactiveLoginCurrent
    && canonicalJson(input.interactiveLoginContract) !== canonicalJson(INTERACTIVE_LOGIN_CONTRACT)
  ) {
    violations.push(violation(
      'INTERACTIVE_LOGIN_CONTRACT_MISSING_OR_CHANGED',
      'Schema v9 must declare the exact two-phase, bounded, secret-blind operator login contract.',
      input.interactiveLoginContract ?? null,
    ));
  }
  if (interactiveLoginCurrent && input.failure !== null) {
    violations.push(violation(
      'V9_MANIFEST_FAILURE_NOT_NULL',
      'A successful schema v9 manifest must carry failure exactly null.',
      input.failure ?? null,
    ));
  }
  if (
    interactiveLoginCurrent
    && (
      input.requested?.allowInteractiveLogin !== true
      || input.requested?.allowSavedLogin !== false
      || input.requested?.loginMode !== 'interactive-operator-each-run'
      || input.requested?.runGroupId !== input.runGroup?.runGroupId
      || (
        input.requested?.resumeRunGroupId != null
        && input.requested.resumeRunGroupId !== input.runGroup?.runGroupId
      )
      || !Number.isInteger(input.requested?.interactiveLoginTimeoutMs)
      || input.requested.interactiveLoginTimeoutMs < 60_000
      || input.requested.interactiveLoginTimeoutMs > 900_000
      || input.requested?.interactiveLoginMaximumTotalMs
        !== input.requested.interactiveLoginTimeoutMs * 2
    )
  ) {
    violations.push(violation(
      'INTERACTIVE_LOGIN_REQUEST_CONTRACT_MISMATCH',
      'Schema v9 must request a two-phase bounded visible operator handoff for every run and must not enable saved-login automation.',
      {
        allowInteractiveLogin: input.requested?.allowInteractiveLogin ?? null,
        allowSavedLogin: input.requested?.allowSavedLogin ?? null,
        interactiveLoginMaximumTotalMs:
          input.requested?.interactiveLoginMaximumTotalMs ?? null,
        interactiveLoginTimeoutMs: input.requested?.interactiveLoginTimeoutMs ?? null,
        loginMode: input.requested?.loginMode ?? null,
        resumeRunGroupId: input.requested?.resumeRunGroupId ?? null,
        runGroupId: input.requested?.runGroupId ?? null,
      },
    ));
  }
  if (
    interactiveLoginCurrent
    && (
      !validPackageUiAuthorityBinding(input.authority?.binding)
      || canonicalJson(input.authority?.binding)
        !== canonicalJson(input.runGroup?.authorityBinding)
    )
  ) {
    violations.push(violation(
      'AUTHORITY_BINDING_MISSING_OR_CHANGED',
      'Schema v9 must bind the canonical Known Folder DB identity and current authority-selection receipt hash.',
      {
        authority: input.authority?.binding ?? null,
        runGroup: input.runGroup?.authorityBinding ?? null,
      },
    ));
  }
  if (
    interactiveLoginCurrent
    && (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(
        String(input.invocation?.invocationId || ''),
      )
      || input.runGroup?.invocationId !== input.invocation?.invocationId
      || input.invocation?.lease?.generation == null
      || !/^[A-F0-9]{64}$/.test(
        String(input.invocation?.lease?.payloadSha256 || ''),
      )
      || !Array.isArray(input.invocation?.attemptReceipts)
      || input.invocation.attemptReceipts.some(
        (record) => record?.invocationId !== input.invocation.invocationId,
      )
    )
  ) {
    violations.push(violation(
      'INVOCATION_BINDING_MISSING_OR_CHANGED',
      'Schema v9 manifest must bind one invocation id, lease generation, and exact attempt receipt collection.',
      input.invocation ?? null,
    ));
  }
  const currentRunnerContract = interactiveLoginCurrent
    ? buildPackageUiRunnerContract()
    : null;
  if (
    interactiveLoginCurrent
    && (
      canonicalJson(input.runGroup?.profileSequence)
        !== canonicalJson(PACKAGE_UI_PROFILE_SEQUENCE)
      || input.runGroup?.runnerContractSha256 !== currentRunnerContract.sha256
      || input.checkpointComposition?.runnerContractSha256
        !== currentRunnerContract.sha256
    )
  ) {
    violations.push(violation(
      'RUNNER_CONTRACT_LINEAGE_MISSING_OR_CHANGED',
      'Schema v9 must bind the immutable run group and composed checkpoints to the current evidence script and semantic contract.',
      {
        checkpointRunnerContractSha256:
          input.checkpointComposition?.runnerContractSha256 ?? null,
        currentRunnerContractSha256: currentRunnerContract.sha256,
        profileSequence: input.runGroup?.profileSequence ?? null,
        runGroupRunnerContractSha256: input.runGroup?.runnerContractSha256 ?? null,
      },
    ));
  }
  if (input.artifactHashesStable !== true) {
    violations.push(violation('ARTIFACT_CHANGED_DURING_RUN', 'EXE or unpacked app content changed while evidence was being captured.'));
  }
  if (input.protectedDatabase?.passed !== true) {
    violations.push(violation(
      'PROTECTED_DATABASE_CHANGED_DURING_RUN',
      'The protected real AppData SQLite file must retain the same path, SHA-256, size, and mtime during package evidence capture.',
      input.protectedDatabase,
    ));
  }
  if (input.profileDatabaseProvenance?.passed !== true) {
    violations.push(violation(
      'PROFILE_DATABASE_PROVENANCE_FAILED',
      'The isolated profile amazon-ai-ops.db genesis must be a distinct WAL-aware logical copy of --protected-db.',
      input.profileDatabaseProvenance,
    ));
  }
  if (
    interactiveLoginCurrent
    && (
      input.protectedDatabaseLogical?.passed !== true
      || !logicalSqliteArtifactMatches(
        input.protectedDatabaseLogical?.before,
        input.protectedDatabaseLogical?.after,
      )
    )
  ) {
    violations.push(violation(
      'PROTECTED_DATABASE_LOGICAL_STATE_CHANGED',
      'Schema v9 must prove the protected authority DB is unchanged through WAL-aware read-only online backups.',
      input.protectedDatabaseLogical ?? null,
    ));
  }
  if (
    interactiveLoginCurrent
    && (
      input.checkpointComposition?.passed !== true
      || input.checkpointComposition?.checkpointRecords?.length
        !== PACKAGE_UI_PROFILE_SEQUENCE.length
      || input.checkpointComposition?.runGroupId !== input.runGroup?.runGroupId
      || !PACKAGE_UI_PROFILE_SEQUENCE.every((profileId, index) => {
        const record = input.checkpointComposition?.checkpointRecords?.[index];
        const expectedRun = profileId === PACKAGE_UI_WIDE_PROFILE.id
          ? wideRun
          : runs.find((candidate) =>
              candidate?.profileId === profileId);
        return packageUiCheckpointRecordMatches(
          record,
          input.runGroup?.runGroupId,
          profileId,
          input.runGroup?.runnerContractSha256,
          expectedRun,
        );
      })
    )
  ) {
    violations.push(violation(
      'PROFILE_CHECKPOINT_COMPOSITION_MISSING_OR_FAILED',
      'Schema v9 must compose immutable ordered 100/125/wide checkpoints from one run-group/package/profile lineage.',
      input.checkpointComposition ?? null,
    ));
  }
  if (
    interactiveLoginCurrent
    && (
      input.profileLineage?.passed !== true
      || !profileLineageStateMatches(
        input.checkpointComposition?.finalProfileState,
        input.profileLineage?.final,
      )
    )
  ) {
    violations.push(violation(
      'TERMINAL_PROFILE_LINEAGE_MISSING_OR_FAILED',
      'Schema v9 must bind the terminal isolated-profile content/logical DB hash to the composed checkpoints.',
      input.profileLineage ?? null,
    ));
  }
  if (schedulerReadOnlyContract && input.profileDatabaseFileIsolation?.passed !== true) {
    violations.push(violation(
      'PROFILE_DATABASE_FILE_ISOLATION_FAILED',
      'Schema v6/v9 evidence must prove that the isolated profile database is not a hardlink alias of --protected-db.',
      input.profileDatabaseFileIsolation,
    ));
  }
  if (
    schedulerReadOnlyContract
    && canonicalJson(input.isolatedProfileBootstrapContract)
      !== canonicalJson(ISOLATED_PROFILE_BOOTSTRAP_CONTRACT)
  ) {
    violations.push(violation(
      'ISOLATED_PROFILE_BOOTSTRAP_CONTRACT_MISSING_OR_CHANGED',
      'Schema v6/v9 must declare the exact isolated-profile-only visible bootstrap contract with no business readiness credit.',
      input.isolatedProfileBootstrapContract ?? null,
    ));
  }
  if (!packageProcessAbsencePassed(input.packageProcessIsolation?.before)) {
    violations.push(violation(
      'PACKAGE_PROCESS_PREEXISTING_OR_UNRESOLVED',
      'No matching packaged process may be running before evidence capture.',
      input.packageProcessIsolation?.before,
    ));
  }
  if (!packageProcessIsolationEvidencePassed(input.packageProcessIsolation)) {
    violations.push(violation(
      'PACKAGE_PROCESS_CLEANUP_FAILED',
      'All matching packaged processes must be gone after evidence capture.',
      input.packageProcessIsolation?.after,
    ));
  }
  if (!processIsolationEvidencePassed(input.profileProcessIsolation)) {
    violations.push(violation(
      'PROFILE_PROCESS_CLEANUP_FAILED',
      'The exact isolated browser profile must have zero Chrome, Chromium, or Edge processes before and after evidence capture.',
      input.profileProcessIsolation,
    ));
  }
  const topLevelProfileLockBinding = interactiveLoginCurrent
    ? {
        invocationIdSha256: sha256Buffer(Buffer.from(
          String(input.invocation?.invocationId || ''),
          'utf8',
        )),
        profileId: 'run-group',
        rootPathSha256: sha256Buffer(Buffer.from(
          path.resolve(String(input.requested?.userDataDir || ''))
            .replace(/\\/g, '/')
            .toLowerCase(),
          'utf8',
        )),
      }
    : null;
  if (
    interactiveLoginCurrent
      ? !packageUiProfileLockIsolationPassed(
          input.profileLockIsolation,
          topLevelProfileLockBinding,
        )
      : input.profileLockIsolation?.passed !== true
        || input.profileLockIsolation?.before?.passed !== true
        || input.profileLockIsolation?.after?.passed !== true
  ) {
    violations.push(violation(
      'PROFILE_LOCK_HANDLE_ATTESTATION_FAILED',
      'The isolated browser profile must pass bounded full-tree exclusive-open attestation before and after evidence capture.',
      input.profileLockIsolation ?? null,
    ));
  }
  if (interactiveLoginCurrent) {
    const exactScaleRuns = exactPackageUiCollection(
      runs,
      EXPECTED_PACKAGE_UI_SCALES.map(
        (scale) => `${scale.scalePercent}-compact`,
      ),
      (candidate) => String(candidate?.profileId || ''),
    );
    if (!exactScaleRuns.passed) {
      violations.push(violation(
        'V9_SCALE_RUN_SET_NOT_EXACT',
        'Schema v9 compact scale runs must exactly equal the canonical 100/125 profile set.',
        exactScaleRuns,
      ));
    }
  }
  for (const scale of EXPECTED_PACKAGE_UI_SCALES) {
    const profileId = `${scale.scalePercent}-compact`;
    const profileViolationStart = violations.length;
    const run = interactiveLoginCurrent
      ? runs.find((candidate) => candidate?.profileId === profileId)
      : runs.find((candidate) => candidate.scalePercent === scale.scalePercent);
    if (!run) {
      violations.push({
        ...violation('SCALE_RUN_MISSING', `Missing ${scale.scalePercent}% packaged UI run.`),
        profileId,
      });
      continue;
    }
    if (interactiveLoginCurrent) {
      const exactProfile = validateCurrentProfileExactSet(run, {
        overlays: EXPECTED_OVERLAY_CHECK_IDS,
        profileId,
        profileRootPathSha256: input.profileValidationOnly === true
          ? null
          : sha256Buffer(Buffer.from(
              path.resolve(String(input.requested?.userDataDir || ''))
                .replace(/\\/g, '/')
                .toLowerCase(),
              'utf8',
            )),
        runGroupId: input.runGroup?.runGroupId,
        runnerContractSha256: input.runGroup?.runnerContractSha256,
        scalePercent: scale.scalePercent,
        subviews: EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
        workspaces: EXPECTED_PACKAGE_UI_ENTRIES,
      });
      violations.push(...exactProfile.violations);
      if (scale.scalePercent === 100) {
        violations.push(...validatePackageMinimumWindow(run.minimumWindow).violations);
      } else if (run.minimumWindow != null) {
        violations.push(violation('MINIMUM_WINDOW_WRONG_PROFILE', 'The native minimum-window capture belongs only to the 100% run.'));
      }
    }
    if (interactiveLoginCurrent && run.session?.mode !== 'interactive-operator-login') {
      violations.push(violation(
        'SCALE_INTERACTIVE_LOGIN_HANDOFF_MISSING',
        `The ${scale.scalePercent}% schema v9 run must be reached through its own visible operator handoff.`,
        { mode: run.session?.mode ?? null },
      ));
    }
    if (
      interactiveLoginCurrent
      && (
        run.session?.operatorHandoff?.phaseTimeoutMs
          !== input.requested?.interactiveLoginTimeoutMs
        || run.session?.operatorHandoff?.maximumTotalTimeoutMs
          !== input.requested?.interactiveLoginMaximumTotalMs
      )
    ) {
      violations.push(violation(
        'SCALE_INTERACTIVE_LOGIN_PHASE_BOUND_MISMATCH',
        `The ${scale.scalePercent}% visible handoff phase bounds must match the requested immutable evidence contract.`,
        {
          maximumTotalTimeoutMs:
            run.session?.operatorHandoff?.maximumTotalTimeoutMs ?? null,
          phaseTimeoutMs: run.session?.operatorHandoff?.phaseTimeoutMs ?? null,
        },
      ));
    }
    if (
      interactiveLoginCurrent
      && scale.scalePercent === EXPECTED_PACKAGE_UI_SCALES[0].scalePercent
      && !firstInteractiveLoginAttestationPassed(run.session?.loginSessionAttestation)
    ) {
      violations.push(violation(
        'INTERACTIVE_LOGIN_FIRST_RUN_TYPED_PROOF_MISSING',
        'The first schema v9 run must establish a fresh typed-and-saved, non-reused, identity-verified ERP session before any saved-session continuation.',
        run.session?.loginSessionAttestation ?? null,
      ));
    }
    const viewportContract = evaluatePackageViewportContract({
      actual: run.viewport,
      actualDeviceScaleFactor: run.actualDeviceScaleFactor,
      expectedDeviceScaleFactor: scale.deviceScaleFactor,
      requested: interactiveLoginCurrent ? PACKAGE_UI_VIEWPORT : { width: 1200, height: 700 },
    });
    if (viewportContract.violations.some((item) => item.code === 'DEVICE_SCALE_FACTOR_DELTA')) {
      violations.push(violation('DEVICE_SCALE_FACTOR_MISMATCH', `The ${scale.scalePercent}% run did not use the expected device scale factor.`, {
        viewportContract,
      }));
    }
    if (viewportContract.violations.some((item) => item.code === 'VIEWPORT_DIMENSION_DELTA')) {
      violations.push(violation('SCALE_VIEWPORT_MISMATCH', `The ${scale.scalePercent}% run exceeded its declared viewport and DPI rounding tolerance.`, viewportContract));
    }
    if (run.identity?.passed !== true) {
      violations.push(violation('SCALE_IDENTITY_FAILED', `The ${scale.scalePercent}% packaged identity check failed.`, run.identity?.violations));
    }
    if (!packageProcessIsolationEvidencePassed(run.packageProcessIsolation)) {
      violations.push(violation('SCALE_PACKAGE_PROCESS_ISOLATION_FAILED', `The ${scale.scalePercent}% product process isolation evidence is missing or failed.`, run.packageProcessIsolation));
    }
    if (!processIsolationEvidencePassed(run.profileProcessIsolation)) {
      violations.push(violation('SCALE_PROFILE_PROCESS_ISOLATION_FAILED', `The ${scale.scalePercent}% profile browser isolation evidence is missing or failed.`, run.profileProcessIsolation));
    }
    if (
      interactiveLoginCurrent
        ? !packageUiProfileLockIsolationPassed(
            run.profileLockIsolation,
            run.evidenceBinding?.profileLockBinding || null,
          )
        : run.profileLockIsolation?.passed !== true
          || run.profileLockIsolation?.before?.passed !== true
          || run.profileLockIsolation?.after?.passed !== true
    ) {
      violations.push(violation(
        'SCALE_PROFILE_LOCK_HANDLE_ATTESTATION_FAILED',
        `${scale.scalePercent}% bounded full-tree profile lock/handle evidence is missing or failed.`,
        run.profileLockIsolation ?? null,
      ));
    }
    if (interactiveLoginCurrent && !chromiumLineageEvidencePassed(run.chromiumProcessLineage)) {
      violations.push(violation(
        'SCALE_CHROMIUM_LINEAGE_MISSING_OR_FAILED',
        `${scale.scalePercent}% did not bind the packaged Chromium hash, root/descendant PIDs, profile binding, and terminal cleanup.`,
        run.chromiumProcessLineage ?? null,
      ));
    }
    if (
      interactiveLoginCurrent
      && (
        !packageUiAttemptArtifactManifestMatches(run.attemptArtifacts)
        || !validatePackageUiAttemptArtifactMembership(
          run.attemptArtifacts,
          run,
        ).passed
      )
    ) {
      violations.push(violation(
        'SCALE_ATTEMPT_ARTIFACTS_MISSING_OR_CHANGED',
        `${scale.scalePercent}% attempt screenshots and runtime artifacts are missing, changed, or detached from their immutable attempt directory.`,
        run.attemptArtifacts ?? null,
      ));
    }
    if (input.nativeRuntimeContract || run.nativeLaunch || run.screenReaderRequested) {
      const nativeEvidence = require('./package-ui-native-evidence').validatePackageUiNativeEvidence(run, {
        requireReader: Boolean(input.requested?.screenReaderExecutablePath || run.screenReaderRequested), artifacts: input.artifactsBefore,
      });
      for (const entry of nativeEvidence.violations) violations.push(violation(entry.code, entry.message, { profileId: `${scale.scalePercent}-compact` }));
    }
    const schedulerReadOnlyRuntime = schedulerReadOnlyContract
      ? validatePackageUiReadOnlyRuntimeEvidence(
          run.schedulerReadOnlyRuntime,
          { requireSchedulerReads: true },
        )
      : null;
    if (schedulerReadOnlyContract && schedulerReadOnlyRuntime?.passed !== true) {
      violations.push(violation(
        'SCALE_SCHEDULER_READ_ONLY_RUNTIME_MISSING_OR_FAILED',
        `${scale.scalePercent}% package UI did not prove the live Main scheduler read-only guard.`,
        schedulerReadOnlyRuntime,
      ));
    }
    const databaseCheckpointBinding = schedulerReadOnlyContract
      ? validatePackageUiDatabaseCheckpointReceipts(
          run.databaseAuditCheckpoints,
          run.schedulerReadOnlyRuntime,
        )
      : null;
    if (schedulerReadOnlyContract && databaseCheckpointBinding?.passed !== true) {
      violations.push(violation(
        'SCALE_DATABASE_AUDIT_CHECKPOINTS_MISSING_OR_FAILED',
        `${scale.scalePercent}% package UI database checkpoint receipts are not bound to the copied Main audit.`,
        databaseCheckpointBinding,
      ));
    }
    if (!validRunDiagnostics(run.diagnostics, run)) {
      violations.push(violation('SCALE_DIAGNOSTICS_MISSING_OR_FAILED', `The ${scale.scalePercent}% structured run diagnostics are missing or invalid.`, run.diagnostics));
    }
    const profileBootstrap = schedulerReadOnlyContract
      ? validateIsolatedProfileBootstrapEvidence(run.session, run.diagnostics)
      : null;
    if (schedulerReadOnlyContract && profileBootstrap?.passed !== true) {
      violations.push(violation(
        'SCALE_ISOLATED_PROFILE_BOOTSTRAP_MISSING_OR_FAILED',
        `${scale.scalePercent}% package UI did not prove bounded visible Store Gate and Lingxing-connection bootstrap.`,
        profileBootstrap,
      ));
    }
    if ((run.consoleErrors || []).length > 0) {
      violations.push(violation('RENDERER_CONSOLE_ERROR', `The ${scale.scalePercent}% packaged renderer emitted console errors.`, run.consoleErrors));
    }
    if ((run.pageErrors || []).length > 0) {
      violations.push(violation('RENDERER_PAGE_ERROR', `The ${scale.scalePercent}% packaged renderer emitted uncaught page errors.`, run.pageErrors));
    }
    for (const workspace of interactiveLoginCurrent ? EXPECTED_PACKAGE_UI_ENTRIES : EXPECTED_PACKAGE_UI_WORKSPACES) {
      const check = (run.workspaceChecks || []).find((candidate) => (
        candidate.workspace === workspace.workspace && candidate.subview === workspace.subview
      ));
      if (!check || check.passed !== true) {
        violations.push(violation('WORKSPACE_CHECK_MISSING_OR_FAILED', `${scale.scalePercent}% ${workspace.workspace}/${workspace.subview} runtime check is missing or failed.`, check));
      }
      if (check?.settleEvidence?.passed !== true || check?.compositeEvidence?.passed !== true) {
        violations.push(violation('WORKSPACE_NOT_SETTLED_FOR_CAPTURE', `${scale.scalePercent}% ${workspace.workspace}/${workspace.subview} was not stably rendered before capture.`, check));
      }
      if (check?.keyboardEvidence?.passed !== true) {
        violations.push(violation('WORKSPACE_KEYBOARD_EVIDENCE_MISSING_OR_FAILED', `${scale.scalePercent}% ${workspace.workspace}/${workspace.subview} tab keyboard evidence is missing or failed.`, check?.keyboardEvidence));
      }
      if (interactiveLoginCurrent) {
        violations.push(...validateWorkspaceRuntimeMetrics(check?.metrics || {}, workspace).violations);
        violations.push(...validateWorkspaceTabKeyboardEvidence(check?.keyboardEvidence, workspace).violations);
      }
      const screenshot = (run.screenshots || []).find((candidate) => (
        candidate.workspace === workspace.workspace && candidate.subview === workspace.subview
      ));
      if (!screenshot || !/^[A-F0-9]{64}$/.test(String(screenshot.sha256 || ''))) {
        violations.push(violation('WORKSPACE_SCREENSHOT_MISSING_OR_UNHASHED', `${scale.scalePercent}% ${workspace.workspace}/${workspace.subview} screenshot is missing or unhashed.`, screenshot));
      }
      if (PACKAGE_OBJECT_WORKSPACES.some((item) => item.workspace === workspace.workspace)) {
        if (check?.experienceEvidence?.passed !== true) {
          violations.push(violation('OBJECT_WORKSPACE_EXPERIENCE_MISSING_OR_FAILED', `${scale.scalePercent}% ${workspace.workspace} queue experience evidence is missing or failed.`, check?.experienceEvidence));
        }
        if (check?.inspectorEvidence?.passed !== true) {
          violations.push(violation('OBJECT_INSPECTOR_MISSING_OR_FAILED', `${scale.scalePercent}% ${workspace.workspace} read-only drawer evidence is missing or failed.`, check?.inspectorEvidence));
        }
        if (!/^[A-F0-9]{64}$/.test(String(check?.inspectorEvidence?.screenshot?.sha256 || ''))) {
          violations.push(violation('OBJECT_INSPECTOR_SCREENSHOT_MISSING_OR_UNHASHED', `${scale.scalePercent}% ${workspace.workspace} read-only drawer screenshot is missing or unhashed.`, check?.inspectorEvidence?.screenshot));
        }
      }
    }
    // v5 按历史十工作区解释；v6/v9 还需定时任务、Main 只读守卫及当前截图，禁止原地升级。
    for (const expectedSubview of schedulerReadOnlyContract ? EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS : []) {
      const check = (run.subviewChecks || []).find((candidate) => (
        candidate.workspace === expectedSubview.workspace
        && candidate.subview === expectedSubview.subview
      ));
      if (!check || check.passed !== true) {
        violations.push(violation(
          'SUBVIEW_CHECK_MISSING_OR_FAILED',
          `${scale.scalePercent}% ${expectedSubview.workspace}/${expectedSubview.subview} read-only subview check is missing or failed.`,
          check,
        ));
        continue;
      }
      if (check.settleEvidence?.passed !== true || check.compositeEvidence?.passed !== true) {
        violations.push(violation(
          'SUBVIEW_NOT_SETTLED_FOR_CAPTURE',
          `${scale.scalePercent}% ${expectedSubview.workspace}/${expectedSubview.subview} was not stably rendered before capture.`,
          check,
        ));
      }
      const schedulerSubviewValidation = validateSchedulerSubviewEvidence(
        check.identityCapabilityEvidence,
        expectedSubview,
      );
      if (schedulerSubviewValidation.passed !== true) {
        violations.push(violation(
          'SUBVIEW_IDENTITY_CAPABILITY_MISSING_OR_FAILED',
          `${scale.scalePercent}% ${expectedSubview.workspace}/${expectedSubview.subview} identity/capability evidence is missing or failed.`,
          schedulerSubviewValidation,
        ));
      }
      const schedulerSubviewRuntimeBinding = validateSchedulerSubviewRuntimeBinding(
        check.identityCapabilityEvidence,
        run.schedulerReadOnlyRuntime,
      );
      if (schedulerSubviewRuntimeBinding.passed !== true) {
        violations.push(violation(
          'SUBVIEW_RUNTIME_ATTESTATION_BINDING_FAILED',
          `${scale.scalePercent}% ${expectedSubview.workspace}/${expectedSubview.subview} IPC/DOM evidence is not bound to the hash-proven Main scheduler ledger.`,
          schedulerSubviewRuntimeBinding,
        ));
      }
      if (!currentFileRecordMatches(check.screenshot)) {
        violations.push(violation(
          'SUBVIEW_SCREENSHOT_MISSING_OR_STALE',
          `${scale.scalePercent}% ${expectedSubview.workspace}/${expectedSubview.subview} screenshot is missing or its current SHA-256/size is stale.`,
          check.screenshot,
        ));
      }
    }
    for (const overlayId of EXPECTED_OVERLAY_CHECK_IDS) {
      const check = (run.overlayChecks || []).find((candidate) => candidate.id === overlayId);
      if (!check || check.passed !== true) {
        violations.push(violation('OVERLAY_CHECK_MISSING_OR_FAILED', `${scale.scalePercent}% ${overlayId} focus check is missing or failed.`, check));
        continue;
      }
      if (check.compositeEvidence?.passed !== true
        || check.overlayVisibleBeforeCapture !== true
        || check.overlayVisibleAfterCapture !== true) {
        violations.push(violation('OVERLAY_NOT_STABLE_FOR_CAPTURE', `${scale.scalePercent}% ${overlayId} was not visibly stable across screenshot capture.`, check));
      }
      if (!/^[A-F0-9]{64}$/.test(String(check.screenshot?.sha256 || ''))) {
        violations.push(violation('OVERLAY_SCREENSHOT_MISSING_OR_UNHASHED', `${scale.scalePercent}% ${overlayId} screenshot is missing or unhashed.`, check.screenshot));
      }
    }
    for (let index = profileViolationStart; index < violations.length; index += 1) {
      violations[index] = { ...violations[index], profileId };
    }
  }
  if (!wideRun || wideRun.profileId !== PACKAGE_UI_WIDE_PROFILE.id) {
    violations.push({
      ...violation('WIDE_PROFILE_MISSING', 'Missing the fixed 1400x900@100 Product/Diagnosis package profile.', wideRun),
      profileId: PACKAGE_UI_WIDE_PROFILE.id,
    });
  } else {
  const wideViolationStart = violations.length;
  if (interactiveLoginCurrent) {
    const exactWide = validateCurrentProfileExactSet(wideRun, {
      overlays: [],
      profileId: PACKAGE_UI_WIDE_PROFILE.id,
      profileRootPathSha256: input.profileValidationOnly === true
        ? null
        : sha256Buffer(Buffer.from(
            path.resolve(String(input.requested?.userDataDir || ''))
              .replace(/\\/g, '/')
              .toLowerCase(),
            'utf8',
          )),
      runGroupId: input.runGroup?.runGroupId,
      runnerContractSha256: input.runGroup?.runnerContractSha256,
      scalePercent: PACKAGE_UI_WIDE_PROFILE.scalePercent,
      subviews: [],
      workspaces: PACKAGE_UI_WIDE_PROFILE.workspaces,
    });
    violations.push(...exactWide.violations);
  }
  if (interactiveLoginCurrent && wideRun.session?.mode !== 'interactive-operator-login') {
    violations.push(violation(
      'WIDE_INTERACTIVE_LOGIN_HANDOFF_MISSING',
      'The wide schema v9 run must be reached through its own visible operator handoff.',
      { mode: wideRun.session?.mode ?? null },
    ));
  }
  if (
    interactiveLoginCurrent
    && (
      wideRun.session?.operatorHandoff?.phaseTimeoutMs
        !== input.requested?.interactiveLoginTimeoutMs
      || wideRun.session?.operatorHandoff?.maximumTotalTimeoutMs
        !== input.requested?.interactiveLoginMaximumTotalMs
    )
  ) {
    violations.push(violation(
      'WIDE_INTERACTIVE_LOGIN_PHASE_BOUND_MISMATCH',
      'The wide-profile visible handoff phase bounds must match the requested immutable evidence contract.',
      {
        maximumTotalTimeoutMs:
          wideRun.session?.operatorHandoff?.maximumTotalTimeoutMs ?? null,
        phaseTimeoutMs: wideRun.session?.operatorHandoff?.phaseTimeoutMs ?? null,
      },
    ));
  }
    const wideViewportContract = evaluatePackageViewportContract({
      actual: wideRun.viewport,
      actualDeviceScaleFactor: wideRun.actualDeviceScaleFactor,
      expectedDeviceScaleFactor: PACKAGE_UI_WIDE_PROFILE.deviceScaleFactor,
      requested: PACKAGE_UI_WIDE_PROFILE.viewport,
    });
    if (!wideViewportContract.passed) {
      violations.push(violation('WIDE_PROFILE_VIEWPORT_MISMATCH', 'The wide package profile must remain 1400x900@100 within DPI tolerance.', wideViewportContract));
    }
    if (wideRun.identity?.passed !== true) {
      violations.push(violation('WIDE_PROFILE_IDENTITY_FAILED', 'The wide package profile did not retain packaged runtime identity.', wideRun.identity));
    }
    if (!packageProcessIsolationEvidencePassed(wideRun.packageProcessIsolation)) {
      violations.push(violation('WIDE_PACKAGE_PROCESS_ISOLATION_FAILED', 'The wide profile product process isolation evidence is missing or failed.', wideRun.packageProcessIsolation));
    }
    if (!processIsolationEvidencePassed(wideRun.profileProcessIsolation)) {
      violations.push(violation('WIDE_PROFILE_PROCESS_ISOLATION_FAILED', 'The wide profile browser isolation evidence is missing or failed.', wideRun.profileProcessIsolation));
    }
    if (
      interactiveLoginCurrent
        ? !packageUiProfileLockIsolationPassed(
            wideRun.profileLockIsolation,
            wideRun.evidenceBinding?.profileLockBinding || null,
          )
        : wideRun.profileLockIsolation?.passed !== true
          || wideRun.profileLockIsolation?.before?.passed !== true
          || wideRun.profileLockIsolation?.after?.passed !== true
    ) {
      violations.push(violation(
        'WIDE_PROFILE_LOCK_HANDLE_ATTESTATION_FAILED',
        'The wide bounded full-tree profile lock/handle evidence is missing or failed.',
        wideRun.profileLockIsolation ?? null,
      ));
    }
    if (interactiveLoginCurrent && !chromiumLineageEvidencePassed(wideRun.chromiumProcessLineage)) {
      violations.push(violation(
        'WIDE_CHROMIUM_LINEAGE_MISSING_OR_FAILED',
        'The wide profile did not bind the packaged Chromium hash, root/descendant PIDs, profile binding, and terminal cleanup.',
        wideRun.chromiumProcessLineage ?? null,
      ));
    }
    if (
      interactiveLoginCurrent
      && (
        !packageUiAttemptArtifactManifestMatches(wideRun.attemptArtifacts)
        || !validatePackageUiAttemptArtifactMembership(
          wideRun.attemptArtifacts,
          wideRun,
        ).passed
      )
    ) {
      violations.push(violation(
        'WIDE_ATTEMPT_ARTIFACTS_MISSING_OR_CHANGED',
        'The wide attempt screenshots and runtime artifacts are missing, changed, or detached from their immutable attempt directory.',
        wideRun.attemptArtifacts ?? null,
      ));
    }
    if (input.nativeRuntimeContract || wideRun.nativeLaunch || wideRun.screenReaderRequested) {
      const nativeEvidence = require('./package-ui-native-evidence').validatePackageUiNativeEvidence(wideRun, {
        requireReader: Boolean(input.requested?.screenReaderExecutablePath || wideRun.screenReaderRequested), artifacts: input.artifactsBefore,
      });
      for (const entry of nativeEvidence.violations) violations.push(violation(entry.code, entry.message, { profileId: PACKAGE_UI_WIDE_PROFILE.id }));
    }
    const schedulerReadOnlyRuntime = schedulerReadOnlyContract
      ? validatePackageUiReadOnlyRuntimeEvidence(
          wideRun.schedulerReadOnlyRuntime,
          { requireSchedulerReads: false },
        )
      : null;
    if (schedulerReadOnlyContract && schedulerReadOnlyRuntime?.passed !== true) {
      violations.push(violation(
        'WIDE_SCHEDULER_READ_ONLY_RUNTIME_MISSING_OR_FAILED',
        'The wide package UI profile did not prove the live Main scheduler read-only guard.',
        schedulerReadOnlyRuntime,
      ));
    }
    const databaseCheckpointBinding = schedulerReadOnlyContract
      ? validatePackageUiDatabaseCheckpointReceipts(
          wideRun.databaseAuditCheckpoints,
          wideRun.schedulerReadOnlyRuntime,
        )
      : null;
    if (schedulerReadOnlyContract && databaseCheckpointBinding?.passed !== true) {
      violations.push(violation(
        'WIDE_DATABASE_AUDIT_CHECKPOINTS_MISSING_OR_FAILED',
        'The wide package UI database checkpoint receipts are not bound to the copied Main audit.',
        databaseCheckpointBinding,
      ));
    }
    if (!validRunDiagnostics(wideRun.diagnostics, wideRun)) {
      violations.push(violation('WIDE_DIAGNOSTICS_MISSING_OR_FAILED', 'The wide profile structured run diagnostics are missing or invalid.', wideRun.diagnostics));
    }
    const wideProfileBootstrap = schedulerReadOnlyContract
      ? validateIsolatedProfileBootstrapEvidence(wideRun.session, wideRun.diagnostics)
      : null;
    if (schedulerReadOnlyContract && wideProfileBootstrap?.passed !== true) {
      violations.push(violation(
        'WIDE_ISOLATED_PROFILE_BOOTSTRAP_MISSING_OR_FAILED',
        'The wide package UI profile did not prove bounded visible Store Gate and Lingxing-connection bootstrap.',
        wideProfileBootstrap,
      ));
    }
    if ((wideRun.consoleErrors || []).length > 0 || (wideRun.pageErrors || []).length > 0) {
      violations.push(violation('WIDE_PROFILE_RENDERER_ERROR', 'The wide package profile emitted renderer errors.', {
        consoleErrors: wideRun.consoleErrors,
        pageErrors: wideRun.pageErrors,
      }));
    }
    for (const workspace of interactiveLoginCurrent ? PACKAGE_UI_WIDE_PROFILE.workspaces : []) {
      const check = (wideRun.workspaceChecks || []).find((candidate) => (
        candidate.workspace === workspace.workspace
        && candidate.subview === workspace.subview
      ));
      if (
        !check
        || check.passed !== true
        || check.settleEvidence?.passed !== true
        || check.compositeEvidence?.passed !== true
        || check.keyboardEvidence?.passed !== true
      ) {
        violations.push(violation(
          'WIDE_CANONICAL_WORKSPACE_MISSING_OR_FAILED',
          `Wide ${workspace.workspace}/${workspace.subview} canonical runtime check is missing or failed.`,
          check ?? null,
        ));
      }
      const screenshot = (wideRun.screenshots || []).find((candidate) => (
        candidate.workspace === workspace.workspace
        && candidate.subview === workspace.subview
      ));
      violations.push(...validateWorkspaceRuntimeMetrics(check?.metrics || {}, workspace, PACKAGE_UI_WIDE_PROFILE.viewport).violations);
      violations.push(...validateWorkspaceTabKeyboardEvidence(check?.keyboardEvidence, workspace).violations);
      if (!/^[A-F0-9]{64}$/.test(String(screenshot?.sha256 || ''))) {
        violations.push(violation(
          'WIDE_CANONICAL_SCREENSHOT_MISSING_OR_UNHASHED',
          `Wide ${workspace.workspace}/${workspace.subview} screenshot is missing or unhashed.`,
          screenshot ?? null,
        ));
      }
    }
    for (const workspace of PACKAGE_OBJECT_WORKSPACES) {
      const check = (wideRun.workspaceChecks || []).find((candidate) => candidate.workspace === workspace.workspace);
      if (!check || check.passed !== true
        || check.experienceEvidence?.passed !== true
        || check.inspectorEvidence?.passed !== true
        || check.inspectorEvidence?.inspector?.mode !== 'inline'
        || check.inspectorEvidence?.inspector?.ariaModal === 'true') {
        violations.push(violation('WIDE_OBJECT_WORKSPACE_MISSING_OR_FAILED', `Wide ${workspace.workspace} experience/inline-inspector evidence is missing or failed.`, check));
      }
      const screenshot = (wideRun.screenshots || []).find((candidate) => candidate.workspace === workspace.workspace);
      if (!/^[A-F0-9]{64}$/.test(String(screenshot?.sha256 || ''))
        || !/^[A-F0-9]{64}$/.test(String(check?.inspectorEvidence?.screenshot?.sha256 || ''))) {
        violations.push(violation('WIDE_SCREENSHOT_MISSING_OR_UNHASHED', `Wide ${workspace.workspace} queue or inline-inspector screenshot is missing or unhashed.`, {
          inspector: check?.inspectorEvidence?.screenshot,
          workspace: screenshot,
        }));
      }
    }
    for (let index = wideViolationStart; index < violations.length; index += 1) {
      violations[index] = {
        ...violations[index],
        profileId: PACKAGE_UI_WIDE_PROFILE.id,
      };
    }
  }
  return { passed: violations.length === 0, violations };
}

  return {
    evaluatePackageUiEvidenceCompleteness,
  };
};
