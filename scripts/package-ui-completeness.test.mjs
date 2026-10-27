import { packageUiFunctionSource, packageUiImplementationSources } from './package-ui-test-sources.mjs';
import {
  EXPECTED_OVERLAY_CHECK_IDS,
  EXPECTED_PACKAGE_UI_SCALES,
  HASH_A,
  INTERACTIVE_LOGIN_CONTRACT,
  ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
  PACKAGE_UI_PROFILE_SEQUENCE,
  PACKAGE_UI_WIDE_PROFILE,
  READ_ONLY_INTERACTION_PLAN,
  USER_DATA_DIR,
  buildPackageUiRunnerContract,
  describe,
  evaluatePackageUiEvidenceCompleteness,
  evaluatePackageUiProfileEvidence,
  expect,
  it,
  path,
  readFileSync,
  validAuthorityBinding,
  validCheckpointComposition,
  validLogicalArtifact,
  validProfileLockIsolation,
  validateOverlayKeyboardEvidence,
  validateOverlayTriggerContract,
  validateReadOnlyInteractionPlan,
  validateSchedulerSubviewEvidence,
} from './package-ui-test-context.mjs';
import {
  validProcessIsolation,
  validProcessSnapshot,
  validRun,
  validWideRun,
} from './package-ui-test-fixtures.mjs';

describe('read-only interactions and evidence completeness', () => {
  it('uses the same native summary-aware focus boundary as the renderer', () => {
    const source = readFileSync('scripts/package-ui-contracts.js', 'utf8');
    expect(source).toContain("  'summary',");
  });

  it('limits automation to navigation, canonical tab keyboard checks, read-only subviews and three non-writing overlays', () => {
    const result = validateReadOnlyInteractionPlan();
    expect(result).toEqual({ passed: true, violations: [] });
    expect(EXPECTED_OVERLAY_CHECK_IDS).toEqual([
      'report-selector-dialog',
      'decisions-controlled-review-inspector',
      'readback-technical-drawer',
    ]);
    expect(READ_ONLY_INTERACTION_PLAN.filter((item) => item.kind === 'keyboard-navigation').map((item) => item.id)).toEqual([
      'workspace-tab-keyboard-navigation',
    ]);
    expect(READ_ONLY_INTERACTION_PLAN.filter((item) => item.kind === 'subview').map((item) => item.id)).toEqual([
      'report-subview-navigation',
      'scheduler-subview-readonly',
    ]);
    expect(READ_ONLY_INTERACTION_PLAN.filter((item) => item.kind === 'row-selection')).toEqual([]);
    const source = readFileSync('scripts/package-ui-overlays.js', 'utf8');
    expect(source.match(/electronApp: runOptions\.electronApp/g)).toHaveLength(3);
    const runtimeSource = readFileSync('scripts/package-ui-runtime-database.js', 'utf8');
    expect(runtimeSource).toContain('const api = window.electronAPI;');
    for (const module of packageUiImplementationSources()) expect(module.source).not.toContain('window.desktopApi');
    const schedulerCollector = packageUiFunctionSource('package-ui-scheduler-collector.js', 'collectSchedulerSubviewEvidence');
    expect(schedulerCollector).toContain('ledgerBefore');
    expect(schedulerCollector).toContain('ledgerAfter');
    expect(schedulerCollector).toContain("getAttribute('data-schedule-state')");
    expect(schedulerCollector).toContain("root.querySelectorAll('.mission-control-retention-metrics')");
    expect(schedulerCollector).not.toContain('证据保留 dry-run 摘要');
    expect(schedulerCollector).not.toContain('window.electronAPI');
    expect(schedulerCollector).not.toContain('missionControl.query');
    expect(schedulerCollector).not.toContain('getStoreCollectionSchedule');
    expect(schedulerCollector).not.toContain('previewStoreEvidenceRetention');
    expect(schedulerCollector).not.toContain('missionControl.command');
    expect(schedulerCollector).not.toContain('runStoreCollectionScheduleNow');
  });

  it('accepts only the stable enabled controlled-review trigger before the evidence runner clicks', () => {
    expect(validateOverlayTriggerContract({
      actionId: 'open-controlled-review-inspector',
      ariaDisabled: null,
      disabled: false,
      expectedActionId: 'open-controlled-review-inspector',
      rendered: true,
      tagName: 'button',
      triggerCount: 1,
    })).toEqual({ passed: true, violations: [] });
  });

  it('pins the Decisions overlay to the canonical read-only capability boundary', () => {
    const overlayRunner = packageUiFunctionSource('package-ui-overlays.js', 'runOverlayChecks');
    expect(overlayRunner).toContain("page.locator('#decisions-workspace-tab-recommendations')");
    expect(overlayRunner).toContain("expectedActionId: 'decision-boundary'");
    expect(overlayRunner).toContain("dialogName: '决策与审批接入边界'");
    expect(overlayRunner).toContain('仅展示本机安全进程返回的店铺范围和动作级能力。');
    expect(overlayRunner).toContain("name: '决策与审批接入边界', exact: true");
    expect(overlayRunner).toContain('[data-action-id="decision-boundary"]');
    expect(overlayRunner).not.toContain('open-controlled-review-inspector');
    expect(overlayRunner).not.toContain('decisions-inspector-form-title');
  });

  it('pins the Readback overlay to the canonical evidence tab and stable read-only action', () => {
    const source = readFileSync('scripts/package-ui-overlays.js', 'utf8');
    const overlayRunner = packageUiFunctionSource('package-ui-overlays.js', 'runOverlayChecks');
    expect(overlayRunner).toContain("page.locator('#execution-workspace-tab-evidence')");
    expect(overlayRunner).toContain('[data-workspace="readback"][data-workspace-subview="evidence"]');
    expect(overlayRunner).toContain('await page.locator(readbackAdapterRootSelector).waitFor');
    expect(overlayRunner).toContain('[data-action="open-technical-inspector"]');
    expect(overlayRunner).toContain('trigger: page.locator(`${readbackAdapterRootSelector} [data-action="open-technical-inspector"]`)');
    expect(overlayRunner).toContain("expectedActionId: 'open-technical-inspector'");
    expect(overlayRunner).not.toContain("page.getByRole('button', { name: '查看技术与证据详情', exact: true })");
    expect(source).toContain("actionId: node.getAttribute('data-action-id') || node.getAttribute('data-action')");
  });

  it('fails closed before clicking when the controlled-review row is absent or the primary action is mutating', () => {
    const absent = validateOverlayTriggerContract({
      expectedActionId: 'open-controlled-review-inspector',
      triggerCount: 0,
    });
    expect(absent.passed).toBe(false);
    expect(absent.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OVERLAY_TRIGGER_COUNT_MISMATCH' }),
    ]));

    const mutating = validateOverlayTriggerContract({
      actionId: 'generate-recommendations',
      ariaDisabled: null,
      disabled: false,
      expectedActionId: 'open-controlled-review-inspector',
      rendered: true,
      tagName: 'button',
      triggerCount: 1,
    });
    expect(mutating.passed).toBe(false);
    expect(mutating.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OVERLAY_TRIGGER_ACTION_MISMATCH' }),
    ]));
  });

  it('fails closed before clicking a hidden or disabled controlled-review trigger', () => {
    const result = validateOverlayTriggerContract({
      actionId: 'open-controlled-review-inspector',
      ariaDisabled: 'true',
      disabled: true,
      expectedActionId: 'open-controlled-review-inspector',
      rendered: false,
      tagName: 'button',
      triggerCount: 1,
    });
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OVERLAY_TRIGGER_DISABLED' }),
      expect.objectContaining({ code: 'OVERLAY_TRIGGER_NOT_RENDERED' }),
    ]));
  });

  it('accepts a one-control dialog only when Shift+Tab and Tab both retain that unique control inside the dialog', () => {
    const uniqueControl = { evidenceBoundary: 'single', id: 'close-drawer', insideDialog: true, tag: 'button' };
    const result = validateOverlayKeyboardEvidence({
      backwardFocus: uniqueControl,
      focusableCount: 1,
      forwardFocus: uniqueControl,
    });

    expect(result).toEqual({
      mode: 'single-control',
      passed: true,
      singleControlEvidence: {
        shiftTabRetained: true,
        tabRetained: true,
        uniqueBoundary: 'single',
      },
      violations: [],
    });
  });

  it('fails closed for zero controls and when either single-control keypress escapes the dialog', () => {
    const noControls = validateOverlayKeyboardEvidence({ focusableCount: 0 });
    expect(noControls.passed).toBe(false);
    expect(noControls.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OVERLAY_FOCUSABLE_CONTROL_MISSING' }),
    ]));

    const escaped = validateOverlayKeyboardEvidence({
      backwardFocus: { evidenceBoundary: null, insideDialog: false },
      focusableCount: 1,
      forwardFocus: { evidenceBoundary: 'single', insideDialog: true },
    });
    expect(escaped.passed).toBe(false);
    expect(escaped.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SINGLE_CONTROL_SHIFT_TAB_ESCAPED' }),
    ]));
  });

  it('preserves first/last bidirectional wrapping evidence when a dialog has multiple controls', () => {
    const result = validateOverlayKeyboardEvidence({
      backwardFocus: { evidenceBoundary: 'last', insideDialog: true },
      focusableCount: 2,
      forwardFocus: { evidenceBoundary: 'first', insideDialog: true },
    });
    expect(result).toEqual({
      mode: 'multi-control-wrap',
      multiControlEvidence: { backwardWrapped: true, forwardWrapped: true },
      passed: true,
      violations: [],
    });
  });

  it('returns structured profile-scoped violations for an incomplete wide checkpoint', () => {
    const wide = validWideRun();
    wide.workspaceChecks = [];
    const result = evaluatePackageUiProfileEvidence(
      PACKAGE_UI_WIDE_PROFILE.id,
      wide,
    );
    expect(result.passed).toBe(false);
    expect(result.relevantViolations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'WIDE_CANONICAL_WORKSPACE_MISSING_OR_FAILED',
        profileId: PACKAGE_UI_WIDE_PROFILE.id,
      }),
    ]));
  });

  it('requires protected state, cleanup, both scales, all 22 entries, native minimum, wide, keyboard and overlay evidence', () => {
    const runGroupId = 'package-ui-test-run-group';
    const runnerContract = buildPackageUiRunnerContract();
    const runs = EXPECTED_PACKAGE_UI_SCALES.map(validRun);
    const wideProfile = validWideRun();
    const checkpointComposition = validCheckpointComposition(
      runGroupId,
      runnerContract.sha256,
      [...runs, wideProfile],
    );
    const authorityBinding = validAuthorityBinding();
    const invocationId = 'package-ui-test-invocation';
    const valid = {
      artifactHashesStable: true,
      authority: { binding: authorityBinding },
      checkpointComposition,
      failure: null,
      invocation: {
        attemptReceipts: [],
        invocationId,
        lease: {
          generation: 'package-ui-test-generation',
          payloadSha256: HASH_A,
        },
      },
      schemaVersion: 9,
      interactiveLoginContract: INTERACTIVE_LOGIN_CONTRACT,
      isolatedProfileBootstrapContract: ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
      packageProcessIsolation: validProcessIsolation(),
      profileLockIsolation: validProfileLockIsolation(
        'run-group',
        invocationId,
      ),
      profileDatabaseFileIsolation: { passed: true },
      profileDatabaseProvenance: { passed: true },
      profileProcessIsolation: validProcessIsolation(),
      profileLineage: {
        final: structuredClone(checkpointComposition.finalProfileState),
        passed: true,
      },
      protectedDatabase: { passed: true },
      protectedDatabaseLogical: {
        after: validLogicalArtifact(),
        before: validLogicalArtifact(),
        passed: true,
      },
      requested: {
        allowInteractiveLogin: true,
        allowSavedLogin: false,
        interactiveLoginMaximumTotalMs: 1_200_000,
        interactiveLoginTimeoutMs: 600_000,
        loginMode: 'interactive-operator-each-run',
        resumeRunGroupId: null,
        runGroupId,
        userDataDir: USER_DATA_DIR,
      },
      runGroup: {
        authorityBinding,
        invocationId,
        profileSequence: PACKAGE_UI_PROFILE_SEQUENCE,
        runGroupId,
        runnerContractSha256: runnerContract.sha256,
      },
      runs,
      wideProfile,
    };
    expect(evaluatePackageUiEvidenceCompleteness(valid)).toEqual({ passed: true, violations: [] });

    const nonNullManifestFailure = structuredClone(valid);
    nonNullManifestFailure.failure = {
      at: '2026-07-17T06:00:01.000Z',
      message: 'stale success failure',
      name: 'Error',
      phase: 'completed',
      stack: 'Error: stale success failure',
    };
    expect(evaluatePackageUiEvidenceCompleteness(
      nonNullManifestFailure,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'V9_MANIFEST_FAILURE_NOT_NULL' }),
    ]));

    const extraScaleRun = structuredClone(valid);
    extraScaleRun.runs.push(structuredClone(extraScaleRun.runs[0]));
    expect(evaluatePackageUiEvidenceCompleteness(
      extraScaleRun,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'V9_SCALE_RUN_SET_NOT_EXACT' }),
    ]));

    const nestedProfileLockExtra = structuredClone(valid);
    nestedProfileLockExtra.runs[0]
      .profileLockIsolation.before.tree.unexpected = true;
    expect(evaluatePackageUiEvidenceCompleteness(
      nestedProfileLockExtra,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'SCALE_PROFILE_LOCK_HANDLE_ATTESTATION_FAILED',
      }),
    ]));

    const duplicateWorkspaceKey = structuredClone(valid);
    duplicateWorkspaceKey.runs[0].workspaceChecks.push(
      structuredClone(duplicateWorkspaceKey.runs[0].workspaceChecks[0]),
    );
    expect(evaluatePackageUiEvidenceCompleteness(
      duplicateWorkspaceKey,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'V9_WORKSPACE_CHECKS_NOT_EXACT' }),
    ]));

    const extraSubviewKey = structuredClone(valid);
    extraSubviewKey.runs[0].subviewChecks.push({
      ...structuredClone(extraSubviewKey.runs[0].subviewChecks[0]),
      subview: 'delivery',
    });
    expect(evaluatePackageUiEvidenceCompleteness(
      extraSubviewKey,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'V9_SUBVIEW_CHECKS_NOT_EXACT' }),
    ]));

    const duplicateOverlayKey = structuredClone(valid);
    duplicateOverlayKey.runs[0].overlayChecks.push(
      structuredClone(duplicateOverlayKey.runs[0].overlayChecks[0]),
    );
    expect(evaluatePackageUiEvidenceCompleteness(
      duplicateOverlayKey,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'V9_OVERLAY_CHECKS_NOT_EXACT' }),
    ]));

    const extraScreenshotKey = structuredClone(valid);
    extraScreenshotKey.runs[0].screenshots.push({
      ...structuredClone(extraScreenshotKey.runs[0].screenshots[0]),
      subview: 'events',
    });
    expect(evaluatePackageUiEvidenceCompleteness(
      extraScreenshotKey,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'V9_SCREENSHOTS_NOT_EXACT' }),
    ]));

    const reusedScreenshotAcrossSlots = structuredClone(valid);
    reusedScreenshotAcrossSlots.runs[0].screenshots[1] = {
      ...reusedScreenshotAcrossSlots.runs[0].screenshots[1],
      path: reusedScreenshotAcrossSlots.runs[0].screenshots[0].path,
      sha256: reusedScreenshotAcrossSlots.runs[0].screenshots[0].sha256,
      sizeBytes: reusedScreenshotAcrossSlots.runs[0].screenshots[0].sizeBytes,
    };
    reusedScreenshotAcrossSlots.runs[0].workspaceChecks[1].screenshot =
      reusedScreenshotAcrossSlots.runs[0].screenshots[1];
    expect(evaluatePackageUiEvidenceCompleteness(
      reusedScreenshotAcrossSlots,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'V9_SCREENSHOT_PATH_REUSED' }),
    ]));

    const invocationProfileBindingDrift = structuredClone(valid);
    invocationProfileBindingDrift.runs[0].evidenceBinding.invocationId =
      'detached-profile-invocation';
    expect(evaluatePackageUiEvidenceCompleteness(
      invocationProfileBindingDrift,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_ATTEMPT_ARTIFACTS_MISSING_OR_CHANGED' }),
      expect.objectContaining({ code: 'PROFILE_CHECKPOINT_COMPOSITION_MISSING_OR_FAILED' }),
    ]));

    const mismatchedHandoffPhaseBound = structuredClone(valid);
    mismatchedHandoffPhaseBound.runs[0].session.operatorHandoff.phaseTimeoutMs = 900_000;
    expect(evaluatePackageUiEvidenceCompleteness(
      mismatchedHandoffPhaseBound,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_INTERACTIVE_LOGIN_PHASE_BOUND_MISMATCH' }),
    ]));

    const missingLogicalProtection = structuredClone(valid);
    delete missingLogicalProtection.protectedDatabaseLogical;
    expect(evaluatePackageUiEvidenceCompleteness(
      missingLogicalProtection,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROTECTED_DATABASE_LOGICAL_STATE_CHANGED' }),
    ]));

    const missingCheckpointComposition = structuredClone(valid);
    delete missingCheckpointComposition.checkpointComposition;
    expect(evaluatePackageUiEvidenceCompleteness(
      missingCheckpointComposition,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROFILE_CHECKPOINT_COMPOSITION_MISSING_OR_FAILED' }),
      expect.objectContaining({ code: 'TERMINAL_PROFILE_LINEAGE_MISSING_OR_FAILED' }),
    ]));

    const missingChromiumLineage = structuredClone(valid);
    delete missingChromiumLineage.runs[0].chromiumProcessLineage;
    expect(evaluatePackageUiEvidenceCompleteness(
      missingChromiumLineage,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_CHROMIUM_LINEAGE_MISSING_OR_FAILED' }),
    ]));

    const missingAttemptArtifacts = structuredClone(valid);
    delete missingAttemptArtifacts.runs[0].attemptArtifacts;
    expect(evaluatePackageUiEvidenceCompleteness(
      missingAttemptArtifacts,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_ATTEMPT_ARTIFACTS_MISSING_OR_CHANGED' }),
    ]));

    const changedRunnerLineage = structuredClone(valid);
    changedRunnerLineage.runGroup.runnerContractSha256 = HASH_A;
    expect(evaluatePackageUiEvidenceCompleteness(
      changedRunnerLineage,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'RUNNER_CONTRACT_LINEAGE_MISSING_OR_CHANGED' }),
    ]));

    const emptyWideWorkspace = structuredClone(valid);
    emptyWideWorkspace.wideProfile.workspaceChecks = [];
    expect(evaluatePackageUiEvidenceCompleteness(
      emptyWideWorkspace,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WIDE_CANONICAL_WORKSPACE_MISSING_OR_FAILED' }),
    ]));

    const missingScaleDatabaseReceipts = structuredClone(valid);
    delete missingScaleDatabaseReceipts.runs[0].databaseAuditCheckpoints;
    expect(evaluatePackageUiEvidenceCompleteness(
      missingScaleDatabaseReceipts,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_DATABASE_AUDIT_CHECKPOINTS_MISSING_OR_FAILED' }),
    ]));

    const tamperedScaleDatabaseReceipt = structuredClone(valid);
    tamperedScaleDatabaseReceipt.runs[0]
      .databaseAuditCheckpoints
      .postNavigation
      .metrics
      .totalChanges += 1;
    expect(evaluatePackageUiEvidenceCompleteness(
      tamperedScaleDatabaseReceipt,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_DATABASE_AUDIT_CHECKPOINTS_MISSING_OR_FAILED' }),
    ]));

    const missingWideDatabaseReceipts = structuredClone(valid);
    delete missingWideDatabaseReceipts.wideProfile.databaseAuditCheckpoints;
    expect(evaluatePackageUiEvidenceCompleteness(
      missingWideDatabaseReceipts,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WIDE_DATABASE_AUDIT_CHECKPOINTS_MISSING_OR_FAILED' }),
    ]));

    const changedMainDatabaseAudit = structuredClone(valid);
    changedMainDatabaseAudit.runs[0]
      .schedulerReadOnlyRuntime
      .marker
      .databaseMutationAudit
      .checkpoints[1]
      .metrics
      .dataVersion += 1;
    expect(evaluatePackageUiEvidenceCompleteness(
      changedMainDatabaseAudit,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_SCHEDULER_READ_ONLY_RUNTIME_MISSING_OR_FAILED' }),
      expect.objectContaining({ code: 'SCALE_DATABASE_AUDIT_CHECKPOINTS_MISSING_OR_FAILED' }),
    ]));

    const missingBootstrapContract = structuredClone(valid);
    delete missingBootstrapContract.isolatedProfileBootstrapContract;
    expect(evaluatePackageUiEvidenceCompleteness(missingBootstrapContract).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ISOLATED_PROFILE_BOOTSTRAP_CONTRACT_MISSING_OR_CHANGED' }),
    ]));

    const missingInteractiveLoginContract = structuredClone(valid);
    delete missingInteractiveLoginContract.interactiveLoginContract;
    expect(evaluatePackageUiEvidenceCompleteness(
      missingInteractiveLoginContract,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INTERACTIVE_LOGIN_CONTRACT_MISSING_OR_CHANGED' }),
    ]));

    const savedOnlyV7 = structuredClone(valid);
    savedOnlyV7.requested.allowInteractiveLogin = false;
    savedOnlyV7.requested.allowSavedLogin = true;
    savedOnlyV7.requested.loginMode = 'app-owned-saved-login';
    expect(evaluatePackageUiEvidenceCompleteness(savedOnlyV7).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INTERACTIVE_LOGIN_REQUEST_CONTRACT_MISMATCH' }),
    ]));

    const firstRunReusedWithoutTypedProof = structuredClone(valid);
    firstRunReusedWithoutTypedProof.runs[0].session.loginSessionAttestation = {
      adsSessionReady: true,
      credentialPersistence: 'main_managed',
      credentialSource: 'saved',
      erpSessionReady: true,
      erpSessionReused: true,
      ok: true,
      sessionIdentityVerified: false,
    };
    expect(evaluatePackageUiEvidenceCompleteness(
      firstRunReusedWithoutTypedProof,
    ).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INTERACTIVE_LOGIN_FIRST_RUN_TYPED_PROOF_MISSING' }),
    ]));

    const nonInteractiveScale = structuredClone(valid);
    nonInteractiveScale.runs[1].session.mode = 'existing-authenticated-session';
    nonInteractiveScale.runs[1].diagnostics.login.outcome = 'existing-authenticated-session';
    delete nonInteractiveScale.runs[1].session.operatorHandoff;
    delete nonInteractiveScale.runs[1].diagnostics.login.operatorHandoff;
    expect(evaluatePackageUiEvidenceCompleteness(nonInteractiveScale).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_INTERACTIVE_LOGIN_HANDOFF_MISSING' }),
    ]));

    const nonInteractiveWide = structuredClone(valid);
    nonInteractiveWide.wideProfile.session.mode = 'saved-credentials-login';
    nonInteractiveWide.wideProfile.diagnostics.login.outcome = 'saved-credentials-login';
    delete nonInteractiveWide.wideProfile.session.operatorHandoff;
    delete nonInteractiveWide.wideProfile.diagnostics.login.operatorHandoff;
    expect(evaluatePackageUiEvidenceCompleteness(nonInteractiveWide).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WIDE_INTERACTIVE_LOGIN_HANDOFF_MISSING' }),
    ]));

    const missingScaleBootstrap = structuredClone(valid);
    delete missingScaleBootstrap.runs[0].session.connectionBootstrap;
    expect(evaluatePackageUiEvidenceCompleteness(missingScaleBootstrap).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_ISOLATED_PROFILE_BOOTSTRAP_MISSING_OR_FAILED' }),
    ]));

    const legacyV5 = structuredClone(valid);
    legacyV5.schemaVersion = 5;
    for (const run of legacyV5.runs) {
      run.viewport = { width: 1200, height: 700 };
      delete run.schedulerReadOnlyRuntime;
      delete run.subviewChecks;
    }
    delete legacyV5.wideProfile.schedulerReadOnlyRuntime;
    expect(evaluatePackageUiEvidenceCompleteness(legacyV5)).toEqual({ passed: true, violations: [] });

    const legacyV6 = structuredClone(valid);
    legacyV6.schemaVersion = 6;
    for (const run of legacyV6.runs) run.viewport = { width: 1200, height: 700 };
    delete legacyV6.interactiveLoginContract;
    expect(evaluatePackageUiEvidenceCompleteness(legacyV6)).toEqual({ passed: true, violations: [] });

    const unsupportedSchema = evaluatePackageUiEvidenceCompleteness({ ...valid, schemaVersion: 4 });
    expect(unsupportedSchema.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PACKAGE_UI_SCHEMA_UNSUPPORTED' }),
    ]));
    expect(evaluatePackageUiEvidenceCompleteness({ ...valid, schemaVersion: 8 }).violations)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PACKAGE_UI_SCHEMA_UNSUPPORTED' })]));

    const missingTopLevelProfileIsolation = structuredClone(valid);
    delete missingTopLevelProfileIsolation.profileProcessIsolation;
    expect(evaluatePackageUiEvidenceCompleteness(missingTopLevelProfileIsolation).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROFILE_PROCESS_CLEANUP_FAILED' }),
    ]));

    const incompleteTopLevelProcessSnapshot = structuredClone(valid);
    incompleteTopLevelProcessSnapshot.packageProcessIsolation.before = {
      error: null,
      matchingCount: 0,
      passed: true,
      unresolvedCount: 0,
    };
    expect(evaluatePackageUiEvidenceCompleteness(incompleteTopLevelProcessSnapshot).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PACKAGE_PROCESS_CLEANUP_FAILED' }),
    ]));

    const leakedScaleProfile = structuredClone(valid);
    leakedScaleProfile.runs[0].profileProcessIsolation.after.matchingCount = 1;
    leakedScaleProfile.runs[0].profileProcessIsolation.passed = false;
    expect(evaluatePackageUiEvidenceCompleteness(leakedScaleProfile).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_PROFILE_PROCESS_ISOLATION_FAILED' }),
    ]));

    const missingScaleDiagnostics = structuredClone(valid);
    delete missingScaleDiagnostics.runs[0].diagnostics;
    expect(evaluatePackageUiEvidenceCompleteness(missingScaleDiagnostics).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_DIAGNOSTICS_MISSING_OR_FAILED' }),
    ]));

    const droppedScaleDiagnostics = structuredClone(valid);
    droppedScaleDiagnostics.runs[0].diagnostics.renderer.droppedCount.consoleErrors = 1;
    expect(evaluatePackageUiEvidenceCompleteness(droppedScaleDiagnostics).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_DIAGNOSTICS_MISSING_OR_FAILED' }),
    ]));

    const leakedWideProduct = structuredClone(valid);
    leakedWideProduct.wideProfile.packageProcessIsolation.after.matchingCount = 1;
    leakedWideProduct.wideProfile.packageProcessIsolation.passed = false;
    expect(evaluatePackageUiEvidenceCompleteness(leakedWideProduct).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WIDE_PACKAGE_PROCESS_ISOLATION_FAILED' }),
    ]));

    const missingScale = evaluatePackageUiEvidenceCompleteness({
      artifactHashesStable: true,
      runs: [validRun(EXPECTED_PACKAGE_UI_SCALES[0])],
    });
    expect(missingScale.passed).toBe(false);
    expect(missingScale.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_RUN_MISSING' }),
    ]));

    const unstable = evaluatePackageUiEvidenceCompleteness({ ...valid, artifactHashesStable: false });
    expect(unstable.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ARTIFACT_CHANGED_DURING_RUN' }),
    ]));

    const changedDatabase = evaluatePackageUiEvidenceCompleteness({
      ...valid,
      protectedDatabase: { passed: false },
    });
    expect(changedDatabase.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROTECTED_DATABASE_CHANGED_DURING_RUN' }),
    ]));

    const unrelatedProfileDatabase = evaluatePackageUiEvidenceCompleteness({
      ...valid,
      profileDatabaseProvenance: { passed: false },
    });
    expect(unrelatedProfileDatabase.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROFILE_DATABASE_PROVENANCE_FAILED' }),
    ]));

    const hardlinkedProfileDatabase = evaluatePackageUiEvidenceCompleteness({
      ...valid,
      profileDatabaseFileIsolation: { passed: false },
    });
    expect(hardlinkedProfileDatabase.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROFILE_DATABASE_FILE_ISOLATION_FAILED' }),
    ]));

    const leakedProcess = evaluatePackageUiEvidenceCompleteness({
      ...valid,
      packageProcessIsolation: {
        ...validProcessIsolation(),
        after: validProcessSnapshot({ matching: [{ processId: 1 }], matchingCount: 1 }),
        passed: false,
      },
    });
    expect(leakedProcess.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PACKAGE_PROCESS_CLEANUP_FAILED' }),
    ]));

    const unsettledWorkspace = structuredClone(valid);
    unsettledWorkspace.runs[0].workspaceChecks[0].settleEvidence.passed = false;
    expect(evaluatePackageUiEvidenceCompleteness(unsettledWorkspace).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WORKSPACE_NOT_SETTLED_FOR_CAPTURE' }),
    ]));

    const staleOverlayFrame = structuredClone(valid);
    staleOverlayFrame.runs[0].overlayChecks[0].overlayVisibleAfterCapture = false;
    expect(evaluatePackageUiEvidenceCompleteness(staleOverlayFrame).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OVERLAY_NOT_STABLE_FOR_CAPTURE' }),
    ]));

    const missingOverlayScreenshot = structuredClone(valid);
    delete missingOverlayScreenshot.runs[0].overlayChecks[0].screenshot;
    const missingOverlayScreenshotResult = evaluatePackageUiEvidenceCompleteness(missingOverlayScreenshot);
    expect(missingOverlayScreenshotResult.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OVERLAY_SCREENSHOT_MISSING_OR_UNHASHED' }),
    ]));

    const missingSchedulerSubview = structuredClone(valid);
    missingSchedulerSubview.runs[0].subviewChecks = [];
    expect(evaluatePackageUiEvidenceCompleteness(missingSchedulerSubview).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SUBVIEW_CHECK_MISSING_OR_FAILED' }),
    ]));

    const forgedSchedulerIdentity = structuredClone(valid);
    forgedSchedulerIdentity.runs[0].subviewChecks[0].identityCapabilityEvidence = { passed: true };
    expect(evaluatePackageUiEvidenceCompleteness(forgedSchedulerIdentity).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SUBVIEW_IDENTITY_CAPABILITY_MISSING_OR_FAILED' }),
    ]));

    const detachedSchedulerLedger = structuredClone(valid);
    const detachedSchedulerIdentity = detachedSchedulerLedger.runs[0]
      .subviewChecks[0]
      .identityCapabilityEvidence;
    detachedSchedulerIdentity.ledgerAfter.events[0].request.requestId = 'renderer-bootstrap-detached-2';
    detachedSchedulerIdentity.ledgerAfter.events[0].response.requestId = 'renderer-bootstrap-detached-2';
    expect(validateSchedulerSubviewEvidence(detachedSchedulerIdentity).passed).toBe(true);
    expect(evaluatePackageUiEvidenceCompleteness(detachedSchedulerLedger).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SUBVIEW_RUNTIME_ATTESTATION_BINDING_FAILED' }),
    ]));

    const missingSchedulerScreenshot = structuredClone(valid);
    delete missingSchedulerScreenshot.runs[0].subviewChecks[0].screenshot;
    expect(evaluatePackageUiEvidenceCompleteness(missingSchedulerScreenshot).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SUBVIEW_SCREENSHOT_MISSING_OR_STALE' }),
    ]));

    const staleSchedulerScreenshot = structuredClone(valid);
    staleSchedulerScreenshot.runs[0].subviewChecks[0].screenshot.sha256 = HASH_A;
    expect(evaluatePackageUiEvidenceCompleteness(staleSchedulerScreenshot).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SUBVIEW_SCREENSHOT_MISSING_OR_STALE' }),
    ]));

    const missingSchedulerRuntime = structuredClone(valid);
    delete missingSchedulerRuntime.runs[0].schedulerReadOnlyRuntime;
    expect(evaluatePackageUiEvidenceCompleteness(missingSchedulerRuntime).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_SCHEDULER_READ_ONLY_RUNTIME_MISSING_OR_FAILED' }),
    ]));

    const missingWideSchedulerRuntime = structuredClone(valid);
    delete missingWideSchedulerRuntime.wideProfile.schedulerReadOnlyRuntime;
    expect(evaluatePackageUiEvidenceCompleteness(missingWideSchedulerRuntime).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WIDE_SCHEDULER_READ_ONLY_RUNTIME_MISSING_OR_FAILED' }),
    ]));

    const workspaceSubviewCollision = structuredClone(valid);
    workspaceSubviewCollision.runs[0].screenshots.find((item) => item.workspace === 'settings').subview = 'scheduler';
    expect(evaluatePackageUiEvidenceCompleteness(workspaceSubviewCollision).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WORKSPACE_SCREENSHOT_MISSING_OR_UNHASHED' }),
    ]));

    const consoleFailure = structuredClone(valid);
    consoleFailure.runs[0].consoleErrors.push('renderer failed');
    expect(evaluatePackageUiEvidenceCompleteness(consoleFailure).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'RENDERER_CONSOLE_ERROR' }),
    ]));

    const rounded125 = structuredClone(valid);
    rounded125.runs.find((run) => run.scalePercent === 125).viewport.height += 2;
    const rounded125Result = evaluatePackageUiEvidenceCompleteness(rounded125);
    expect(rounded125Result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'PROFILE_CHECKPOINT_COMPOSITION_MISSING_OR_FAILED',
      }),
    ]));
    expect(rounded125Result.violations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_VIEWPORT_MISMATCH' }),
    ]));

    const drifted125 = structuredClone(valid);
    drifted125.runs.find((run) => run.scalePercent === 125).viewport.height += 3;
    expect(evaluatePackageUiEvidenceCompleteness(drifted125).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCALE_VIEWPORT_MISMATCH' }),
    ]));

    const missingWideProfile = structuredClone(valid);
    delete missingWideProfile.wideProfile;
    expect(evaluatePackageUiEvidenceCompleteness(missingWideProfile).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WIDE_PROFILE_MISSING' }),
    ]));
  });
});
