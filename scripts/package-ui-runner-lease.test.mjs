import {
  AUTHORITY_SELECTION_PATH,
  EXPECTED_OVERLAY_CHECK_IDS,
  HASH_A,
  HASH_B,
  PACKAGE_UI_PROFILE_SEQUENCE,
  PROTECTED_DB_PATH,
  USER_DATA_DIR,
  acquirePackageUiRunGroupLease,
  buildPackageUiAttemptArtifactManifest,
  buildPackageUiAttemptArtifactReferences,
  canonicalJsonForTest,
  consumePackageUiResumeInspectionReceipt,
  describe,
  evidenceModule,
  expect,
  inspectPackageUiRunGroupLease,
  it,
  linkSync,
  mkdtempSync,
  path,
  releasePackageUiRunGroupLease,
  rmSync,
  tmpdir,
  validAuthorityBinding,
  validRunEvidenceBinding,
  validatePackageUiAttemptArtifactMembership,
  validatePackageUiResumeInspectionReceipt,
  writeFileSync,
} from './package-ui-test-context.mjs';
import {
  artifactReferences,
} from './package-ui-test-fixtures.mjs';

describe('package UI invocation lease and resume receipt', () => {
  it('acquires one atomic run-group lease and classifies concurrent, stale, and released states fail-closed', () => {
    const outputDir = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-lease-'));
    const runGroupId = 'lease-run-group-001';
    const invocationId = 'lease-invocation-001';
    const identity = {
      alive: true,
      identitySha256: HASH_B,
      passed: true,
      processId: process.pid,
    };
    try {
      const lease = acquirePackageUiRunGroupLease({
        collectProcessIdentity: () => identity,
        invocationId,
        outputDir,
        randomUUID: () => '00000000-0000-4000-8000-000000000001',
        runGroupId,
        runnerContractSha256: HASH_A,
      });
      expect(inspectPackageUiRunGroupLease({
        collectProcessIdentity: () => identity,
        outputDir,
        runGroupId,
        runnerContractSha256: HASH_A,
      })).toEqual(expect.objectContaining({
        activeRunnerCount: 1,
        invocationId,
        reasonCode: 'RUNNER_LEASE_ACTIVE',
        state: 'active',
        supported: true,
      }));
      expect(() => acquirePackageUiRunGroupLease({
        collectProcessIdentity: () => identity,
        invocationId: 'lease-invocation-002',
        outputDir,
        runGroupId,
        runnerContractSha256: HASH_A,
      })).toThrow(/RUNNER_LEASE_ACTIVE.*fail closed/i);
      expect(inspectPackageUiRunGroupLease({
        collectProcessIdentity: () => ({
          alive: false,
          passed: true,
          processId: process.pid,
        }),
        outputDir,
        runGroupId,
        runnerContractSha256: HASH_A,
      })).toEqual(expect.objectContaining({
        activeRunnerCount: null,
        reasonCode: 'RUNNER_LEASE_STALE',
        state: 'stale',
      }));
      expect(releasePackageUiRunGroupLease(lease)).toEqual(expect.objectContaining({
        invocationId,
        released: true,
      }));
      expect(inspectPackageUiRunGroupLease({
        collectProcessIdentity: () => identity,
        outputDir,
        runGroupId,
        runnerContractSha256: HASH_A,
      })).toEqual(expect.objectContaining({
        activeRunnerCount: 0,
        passed: true,
        state: 'absent',
      }));
    } finally {
      rmSync(outputDir, { force: true, recursive: true });
    }
  });

  it('validates exact resume argv and consumes the content-bound inspection receipt only once', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-resume-'));
    const createdAt = new Date();
    const core = {
      authorityBinding: validAuthorityBinding(),
      createdAt: createdAt.toISOString(),
      cursor: {
        logicalDatabaseSha256: HASH_A,
        profileContentSha256: HASH_B,
      },
      expiresAt: new Date(createdAt.valueOf() + 60_000).toISOString(),
      invocationId: 'resume-invocation-001',
      kind: 'package-ui-resume-inspection',
      nextProfileId: PACKAGE_UI_PROFILE_SEQUENCE[0],
      runGroupId: 'resume-run-group-001',
      runnerContractSha256: HASH_A,
      schemaVersion: 'package-ui-resume-inspection/v1',
    };
    const intentBindingSha256 = evidenceModule.sha256Buffer(
      Buffer.from(canonicalJsonForTest(core), 'utf8'),
    );
    const receiptPath = path.join(root, `${intentBindingSha256}.json`);
    const argv = [
      'scripts/run-package-ui-evidence.js',
      '--output', path.join(root, 'evidence'),
      '--resume-run-group', core.runGroupId,
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--user-data-dir', USER_DATA_DIR,
      '--protected-db', PROTECTED_DB_PATH,
      '--authority-selection', AUTHORITY_SELECTION_PATH,
      '--resume-inspection-receipt', receiptPath,
      '--allow-interactive-login',
    ];
    const payload = { ...core, argv, intentBindingSha256 };
    try {
      writeFileSync(
        receiptPath,
        `${JSON.stringify(evidenceModule.createImmutableEnvelope(payload))}\n`,
        'utf8',
      );
      const record = validatePackageUiResumeInspectionReceipt({
        invocationArgv: argv.slice(1),
        receiptPath,
        runGroupId: core.runGroupId,
        runnerContractSha256: HASH_A,
      });
      const consumed = consumePackageUiResumeInspectionReceipt(record);
      expect(consumed).toEqual(expect.objectContaining({
        consumedAt: expect.any(String),
        payloadSha256: record.payloadSha256,
      }));
      expect(() => consumePackageUiResumeInspectionReceipt(record))
        .toThrow(/already consumed/i);
      expect(() => validatePackageUiResumeInspectionReceipt({
        invocationArgv: [...argv.slice(1), '--settle-ms', '1'],
        receiptPath: consumed.file.path,
        runGroupId: core.runGroupId,
        runnerContractSha256: HASH_A,
      })).toThrow(/exact argv/i);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('requires the declared artifact collection to exactly match evidence-bearing attempt files', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-membership-'));
    try {
      const screenshotPath = path.join(root, 'workspace.png');
      writeFileSync(screenshotPath, 'synthetic-workspace-capture', 'utf8');
      const attemptArtifacts = buildPackageUiAttemptArtifactManifest(root);
      const file = attemptArtifacts.files[0];
      const evidenceBinding = validRunEvidenceBinding('100-compact', {
        attemptId: 'membership-attempt-001',
        invocationId: 'membership-invocation-001',
        runGroupId: 'membership-run-group-001',
      });
      const runEvidence = {
        evidenceBinding,
        passed: true,
        screenshots: [{
          path: screenshotPath,
          sha256: file.sha256,
          sizeBytes: file.sizeBytes,
          subview: 'overview',
          workspace: 'today',
        }],
      };
      runEvidence.artifactReferences = buildPackageUiAttemptArtifactReferences(
        attemptArtifacts,
        runEvidence,
      );
      expect(validatePackageUiAttemptArtifactMembership(
        attemptArtifacts,
        runEvidence,
      )).toEqual(expect.objectContaining({ passed: true, violations: [] }));
      expect(validatePackageUiAttemptArtifactMembership(
        attemptArtifacts,
        { ...runEvidence, artifactReferences: [] },
      )).toEqual(expect.objectContaining({
        passed: false,
        violations: expect.arrayContaining([
          expect.objectContaining({
            code: 'ATTEMPT_ARTIFACT_DECLARATION_MISMATCH',
          }),
        ]),
      }));

      const aliasedReference = structuredClone(runEvidence);
      aliasedReference.artifactReferences[0].path =
        `${root}${path.sep}.${path.sep}workspace.png`;
      expect(validatePackageUiAttemptArtifactMembership(
        attemptArtifacts,
        aliasedReference,
      )).toEqual(expect.objectContaining({
        passed: false,
        violations: expect.arrayContaining([
          expect.objectContaining({
            code: 'ATTEMPT_ARTIFACT_REFERENCE_INVALID',
          }),
        ]),
      }));

      const reusedSemanticFile = structuredClone(runEvidence);
      reusedSemanticFile.overlayChecks = [{
        id: EXPECTED_OVERLAY_CHECK_IDS[0],
        screenshot: {
          overlayId: EXPECTED_OVERLAY_CHECK_IDS[0],
          path: screenshotPath,
          scalePercent: 100,
          sha256: file.sha256,
          sizeBytes: file.sizeBytes,
        },
      }];
      expect(() => buildPackageUiAttemptArtifactReferences(
        attemptArtifacts,
        reusedSemanticFile,
      )).toThrow(/cannot satisfy multiple semantic slots/i);

      const hardlinkPath = path.join(root, 'workspace-hardlink.png');
      linkSync(screenshotPath, hardlinkPath);
      expect(validatePackageUiAttemptArtifactMembership(
        attemptArtifacts,
        runEvidence,
      )).toEqual(expect.objectContaining({
        passed: false,
        violations: expect.arrayContaining([
          expect.objectContaining({
            code: 'ATTEMPT_ARTIFACT_MANIFEST_INVALID',
          }),
        ]),
      }));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
