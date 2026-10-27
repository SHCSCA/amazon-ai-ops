import {
  AUTHORITY_SELECTION_PATH,
  Database,
  HASH_A,
  HASH_B,
  PACKAGE_UI_PROFILE_ATTEMPT_SCHEMA_VERSION,
  PACKAGE_UI_PROFILE_SEQUENCE,
  PACKAGE_UI_WIDE_PROFILE,
  PROTECTED_DB_PATH,
  USER_DATA_DIR,
  buildPackageUiAttemptArtifactManifest,
  buildPackageUiAttemptArtifactReferences,
  buildPackageUiRunnerContract,
  captureSqliteLogicalArtifact,
  composePackageUiRunGroup,
  copyFileSync,
  createPackageUiProfileAttemptContext,
  describe,
  evaluateProfileDatabaseFileIsolation,
  evaluateProfileDatabaseProvenance,
  expect,
  initializePackageUiRunGroup,
  it,
  linkSync,
  mkdirSync,
  mkdtempSync,
  packageUiAttemptArtifactManifestMatches,
  packageUiAttemptCleanupPassed,
  parsePackageUiEvidenceArgs,
  path,
  profileLineageStateMatches,
  readFileSync,
  readdirSync,
  recordPackageUiProfileAttempt,
  resolvePackageUiProfileCursor,
  rmSync,
  spawnSync,
  symlinkSync,
  tmpdir,
  validAuthorityBinding,
  validLogicalArtifact,
  validProfileLineageState,
  validProfileLockIsolation,
  writeFileSync,
  writeImmutableEnvelope,
  writePackageUiProfileCheckpoint,
} from './package-ui-test-context.mjs';
import {
  artifactReferences,
  bindSingleSuccessfulAttemptArtifact,
  changedRunnerContract,
  failedDiagnostics,
  runEvidenceBindingFromAttempt,
  validDiagnostics,
  validInvocation,
  validProcessIsolation,
  validProcessSnapshot,
} from './package-ui-test-fixtures.mjs';

describe('isolated profile database provenance', () => {
  it('captures committed WAL state through the shared read-only SQLite online-backup helper', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-wal-'));
    const databasePath = path.join(root, 'authority.db');
    const database = new Database(databasePath);
    try {
      database.pragma('journal_mode = WAL');
      database.pragma('wal_autocheckpoint = 0');
      database.exec('CREATE TABLE authority_state (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)');
      database.prepare('INSERT INTO authority_state VALUES (?, ?)').run('grant-1', 1);
      const before = captureSqliteLogicalArtifact(databasePath, 'test-before');
      database.prepare('UPDATE authority_state SET revision = 2 WHERE id = ?').run('grant-1');
      const after = captureSqliteLogicalArtifact(databasePath, 'test-after');

      expect(before).toEqual(expect.objectContaining({
        method: 'readonly-sqlite-online-backup',
        remainingPages: 0,
        schemaVersion: 'sqlite-authority-currentness-proof/v1',
      }));
      expect(after.sha256).not.toBe(before.sha256);
      expect(after.totalPages).toBeGreaterThan(0);
    } finally {
      database.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.runIf(process.platform === 'win32')(
    'rejects a high-risk ACL readback before the runner can invoke SQLite backup',
    () => {
      const root = mkdtempSync(path.join(
        tmpdir(),
        'amazon-ai-ops-package-ui-runner-acl-',
      ));
      const tempParent = path.join(root, 'temp');
      const databasePath = path.join(root, 'authority.db');
      mkdirSync(tempParent);
      const database = new Database(databasePath);
      let backupCalls = 0;
      try {
        database.exec('CREATE TABLE proof(value TEXT)');
        expect(() => captureSqliteLogicalArtifact(
          databasePath,
          'acl-readback-negative',
          {
            runReadonlySqliteOnlineBackupSync: () => {
              backupCalls += 1;
              throw new Error('backup must not run');
            },
            spawnSync: () => ({
              error: null,
              signal: null,
              status: 0,
              stderr: '',
              stdout: JSON.stringify({
                allowedSids: [
                  'S-1-1-0',
                  'S-1-5-18',
                  'S-1-5-21-1000',
                  'S-1-5-32-544',
                ],
                areAccessRulesProtected: true,
                deniedRuleCount: 0,
                exactRuleCount: 3,
                inheritedRuleCount: 0,
                ownerSid: 'S-1-5-21-1000',
                ruleCount: 4,
              }),
            }),
            tempParent,
          },
        )).toThrow(/high-risk principal/i);
        expect(backupCalls).toBe(0);
        expect(readdirSync(tempParent)).toEqual([]);
      } finally {
        database.close();
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

  it('recursively removes an unexpected runner backup sidecar after an abnormal helper exit', () => {
    const root = mkdtempSync(path.join(
      tmpdir(),
      'amazon-ai-ops-package-ui-runner-cleanup-',
    ));
    const tempParent = path.join(root, 'temp');
    const databasePath = path.join(root, 'authority.db');
    mkdirSync(tempParent);
    const database = new Database(databasePath);
    try {
      database.exec('CREATE TABLE proof(value TEXT)');
      expect(() => captureSqliteLogicalArtifact(
        databasePath,
        'cleanup-negative',
        {
          runReadonlySqliteOnlineBackupSync: ({
            destinationPath,
            ownedTempRoot,
            sourceDatabasePath,
          }) => {
            copyFileSync(sourceDatabasePath, destinationPath);
            const residue = path.join(ownedTempRoot, 'unexpected', 'backup.db-wal');
            mkdirSync(path.dirname(residue));
            copyFileSync(sourceDatabasePath, residue);
            throw new Error('synthetic runner backup failure');
          },
          tempParent,
        },
      )).toThrow(/synthetic runner backup failure/);
      expect(readdirSync(tempParent)).toEqual([]);
    } finally {
      database.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails closed on cleanup itself when the bounded runner temp-root cleanup cannot finish', () => {
    const root = mkdtempSync(path.join(
      tmpdir(),
      'amazon-ai-ops-package-ui-runner-cleanup-fail-',
    ));
    const tempParent = path.join(root, 'temp');
    const databasePath = path.join(root, 'authority.db');
    mkdirSync(tempParent);
    const database = new Database(databasePath);
    try {
      database.exec('CREATE TABLE proof(value TEXT)');
      expect(() => captureSqliteLogicalArtifact(
        databasePath,
        'cleanup-fail-closed',
        {
          cleanupMaxEntries: 1,
          cleanupRetries: 1,
          runReadonlySqliteOnlineBackupSync: ({
            destinationPath,
            sourceDatabasePath,
          }) => {
            copyFileSync(sourceDatabasePath, destinationPath);
            throw new Error('original synthetic backup failure');
          },
          tempParent,
        },
      )).toThrow(/could not be completely removed after bounded retries/i);
      expect(readdirSync(tempParent)).toHaveLength(1);
    } finally {
      database.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('writes immutable ordered checkpoints and resumes only the same package/profile lineage', () => {
    const outputDir = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-checkpoint-'));
    const genesis = validProfileLineageState();
    const protectedDatabaseLogical = validLogicalArtifact();
    const runnerContract = buildPackageUiRunnerContract();
    const packageLineage = {
      appContentSha256: HASH_A,
      chromium: { relativePath: 'playwright-browsers/chrome-win64/chrome.exe', sha256: HASH_B, sizeBytes: 100 },
      executableSha256: HASH_B,
      profileBindingSha256: HASH_A,
      profileBrowserBindingSha256: HASH_B,
    };
    try {
      const manager = initializePackageUiRunGroup({
        authorityBinding: validAuthorityBinding(),
        genesisProfileState: genesis,
        options: { runGroupId: 'checkpoint-run-001' },
        outputDir,
        packageLineage,
        protectedDatabaseLogical,
      });
      for (let index = 0; index < PACKAGE_UI_PROFILE_SEQUENCE.length; index += 1) {
        const profileId = PACKAGE_UI_PROFILE_SEQUENCE[index];
        const cursor = resolvePackageUiProfileCursor(manager, profileId);
        const after = structuredClone(cursor.cursor);
        after.capturedAt = `2026-07-17T06:00:0${index + 2}.000Z`;
        after.profileContent.sha256 = String(index + 1).padStart(64, String(index + 1));
        const profileState = { before: cursor.cursor, after };
        const attemptContext = createPackageUiProfileAttemptContext(
          manager,
          profileId,
          validInvocation(manager, `ordered-${index + 1}`),
        );
        writeFileSync(
          path.join(attemptContext.artifactDir, `${profileId}.txt`),
          `immutable-${profileId}`,
          'utf8',
        );
        const attemptArtifacts = buildPackageUiAttemptArtifactManifest(
          attemptContext.artifactDir,
        );
        const evidenceBinding = runEvidenceBindingFromAttempt(
          manager,
          profileId,
          attemptContext,
        );
        const runEvidence = bindSingleSuccessfulAttemptArtifact({
          attemptArtifacts,
          diagnostics: validDiagnostics(profileId),
          evidenceBinding,
          failure: null,
          packageProcessIsolation: validProcessIsolation(),
          passed: true,
          profileId,
          profileLockIsolation: validProfileLockIsolation(
            profileId,
            evidenceBinding.invocationId,
          ),
          profileProcessIsolation: validProcessIsolation(),
        }, attemptArtifacts);
        const attemptRecord = recordPackageUiProfileAttempt({
          attemptArtifacts,
          attemptContext,
          manager,
          profileId,
          profileState,
          resumable: true,
          runEvidence,
        });
        if (index === 0) {
          const detachedInvocationId = 'detached-invocation-001';
          const detachedRun = structuredClone(runEvidence);
          detachedRun.evidenceBinding = {
            ...detachedRun.evidenceBinding,
            invocationId: detachedInvocationId,
            profileLockBinding: validProfileLockIsolation(
              profileId,
              detachedInvocationId,
            ).before.binding,
            runGroupId: 'detached-run-group-001',
          };
          detachedRun.profileLockIsolation = validProfileLockIsolation(
            profileId,
            detachedInvocationId,
          );
          detachedRun.artifactReferences =
            buildPackageUiAttemptArtifactReferences(
              attemptArtifacts,
              detachedRun,
            );
          expect(() => writePackageUiProfileCheckpoint({
            attemptRecord,
            lineageStart: cursor.lineageStart,
            manager,
            profileId,
            profileState,
            runEvidence: detachedRun,
          })).toThrow(/exact invocation binding.*detached/i);
        }
        writePackageUiProfileCheckpoint({
          attemptRecord,
          lineageStart: cursor.lineageStart,
          manager,
          profileId,
          profileState,
          runEvidence,
        });
        expect(() => writePackageUiProfileCheckpoint({
          attemptRecord,
          lineageStart: cursor.lineageStart,
          manager,
          profileId,
          profileState,
          runEvidence,
        })).toThrow(/immutable/i);
      }

      const composed = composePackageUiRunGroup(manager);
      expect(composed.passed).toBe(true);
      expect(composed.checkpointRecords.map((item) => item.profileId))
        .toEqual(PACKAGE_UI_PROFILE_SEQUENCE);
      expect(composed.compactRuns).toHaveLength(2);
      expect(composed.wideProfile.profileId).toBe(PACKAGE_UI_WIDE_PROFILE.id);
      expect(profileLineageStateMatches(
        composed.finalProfileState,
        resolvePackageUiProfileCursor(manager, PACKAGE_UI_WIDE_PROFILE.id)
          .checkpoint.payload.profileState.after,
      )).toBe(true);

      expect(initializePackageUiRunGroup({
        authorityBinding: validAuthorityBinding(),
        genesisProfileState: structuredClone(composed.finalProfileState),
        options: { resumeRunGroupId: 'checkpoint-run-001' },
        outputDir,
        packageLineage,
        protectedDatabaseLogical,
      }).resumed).toBe(true);
      expect(() => initializePackageUiRunGroup({
        authorityBinding: validAuthorityBinding(),
        genesisProfileState: structuredClone(composed.finalProfileState),
        options: { resumeRunGroupId: 'checkpoint-run-001' },
        outputDir,
        packageLineage: { ...packageLineage, executableSha256: HASH_A },
        protectedDatabaseLogical,
      })).toThrow(/lineage changed/i);
      expect(() => initializePackageUiRunGroup({
        authorityBinding: validAuthorityBinding(),
        genesisProfileState: structuredClone(composed.finalProfileState),
        options: { resumeRunGroupId: 'checkpoint-run-001' },
        outputDir,
        packageLineage,
        protectedDatabaseLogical,
        runnerContract: changedRunnerContract(runnerContract),
      })).toThrow(/runner contract lineage changed/i);

      const sequenceDriftRunGroupId = 'checkpoint-sequence-drift';
      writeImmutableEnvelope(
        path.join(
          outputDir,
          'run-groups',
          sequenceDriftRunGroupId,
          'run-group.json',
        ),
        {
          ...manager.metadata,
          profileSequence: [...PACKAGE_UI_PROFILE_SEQUENCE].reverse(),
          runGroupId: sequenceDriftRunGroupId,
        },
      );
      expect(() => initializePackageUiRunGroup({
        authorityBinding: validAuthorityBinding(),
        genesisProfileState: genesis,
        options: { resumeRunGroupId: sequenceDriftRunGroupId },
        outputDir,
        packageLineage,
        protectedDatabaseLogical,
      })).toThrow(/profile sequence.*lineage changed/i);
    } finally {
      rmSync(outputDir, { force: true, recursive: true });
    }
  });

  it('keeps failed-attempt artifacts immutable and resumes from the cleanup-safe cursor before success', () => {
    const outputDir = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-retry-'));
    const genesis = validProfileLineageState();
    const packageLineage = {
      appContentSha256: HASH_A,
      chromium: { relativePath: 'playwright-browsers/chrome-win64/chrome.exe', sha256: HASH_B, sizeBytes: 100 },
      executableSha256: HASH_B,
      profileBindingSha256: HASH_A,
      profileBrowserBindingSha256: HASH_B,
    };
    const profileId = PACKAGE_UI_PROFILE_SEQUENCE[0];
    try {
      const manager = initializePackageUiRunGroup({
        authorityBinding: validAuthorityBinding(),
        genesisProfileState: genesis,
        options: { runGroupId: 'retry-run-001' },
        outputDir,
        packageLineage,
        protectedDatabaseLogical: validLogicalArtifact(),
      });
      const firstContext = createPackageUiProfileAttemptContext(
        manager,
        profileId,
        validInvocation(manager, 'retry-1'),
      );
      const firstArtifactPath = path.join(firstContext.artifactDir, 'first-failure.txt');
      writeFileSync(firstArtifactPath, 'first-failure-is-immutable', 'utf8');
      const firstArtifacts = buildPackageUiAttemptArtifactManifest(firstContext.artifactDir);
      const firstAfter = structuredClone(genesis);
      firstAfter.capturedAt = '2026-07-17T06:00:02.000Z';
      firstAfter.profileContent.sha256 = 'C'.repeat(64);
      const firstFailureState = failedDiagnostics(
        profileId,
        'renderer assertion failed after cleanup',
      );
      const firstDiagnostics = firstFailureState.diagnostics;
      const firstEvidenceBinding = runEvidenceBindingFromAttempt(
        manager,
        profileId,
        firstContext,
      );
      firstDiagnostics.login.failureMessage = 'username=operator@example.com password=hunter2';
      Object.assign(firstDiagnostics, {
        commandline: '--password bare-command-secret',
        password: 'bare-secret',
        passwordInputEmpty: true,
        session: 'bare-session',
        'set-cookie': 'sid=bare-cookie',
        token: 'bare-token',
      });
      const firstAttempt = recordPackageUiProfileAttempt({
        attemptArtifacts: firstArtifacts,
        attemptContext: firstContext,
        manager,
        profileId,
        profileState: { before: genesis, after: firstAfter },
        resumable: true,
        runEvidence: {
          attemptArtifacts: firstArtifacts,
          diagnostics: firstDiagnostics,
          evidenceBinding: firstEvidenceBinding,
          failure: firstFailureState.failure,
          packageProcessIsolation: validProcessIsolation(),
          passed: false,
          profileId,
          profileLockIsolation: validProfileLockIsolation(
            profileId,
            firstEvidenceBinding.invocationId,
          ),
          profileProcessIsolation: validProcessIsolation(),
        },
      });
      expect(PACKAGE_UI_PROFILE_ATTEMPT_SCHEMA_VERSION).toBe('package-ui-profile-attempt/v3');
      const firstAttemptEnvelope = JSON.parse(readFileSync(firstAttempt.path, 'utf8'));
      expect(firstAttemptEnvelope.payload.diagnostics).toEqual(expect.objectContaining({
        login: expect.objectContaining({
          failureMessage: 'username=[REDACTED] password=[REDACTED]',
        }),
        commandline: '[REDACTED]',
        password: '[REDACTED]',
        passwordInputEmpty: true,
        schemaVersion: 'package-ui-run-diagnostics/v2',
        session: '[REDACTED]',
        'set-cookie': '[REDACTED]',
        token: '[REDACTED]',
      }));
      expect(JSON.stringify(firstAttemptEnvelope.payload)).not.toContain('operator@example.com');
      expect(JSON.stringify(firstAttemptEnvelope.payload)).not.toContain('hunter2');
      expect(JSON.stringify(firstAttemptEnvelope.payload)).not.toContain('bare-secret');
      expect(JSON.stringify(firstAttemptEnvelope.payload)).not.toContain('bare-token');
      expect(JSON.stringify(firstAttemptEnvelope.payload)).not.toContain('bare-command-secret');
      expect(JSON.stringify(firstAttemptEnvelope.payload)).not.toContain('bare-session');
      expect(JSON.stringify(firstAttemptEnvelope.payload)).not.toContain('bare-cookie');

      const retryCursor = resolvePackageUiProfileCursor(manager, profileId);
      expect(retryCursor.checkpoint).toBeNull();
      expect(retryCursor.receipts).toHaveLength(1);
      expect(profileLineageStateMatches(retryCursor.cursor, firstAfter)).toBe(true);

      const secondContext = createPackageUiProfileAttemptContext(
        manager,
        profileId,
        validInvocation(manager, 'retry-2'),
      );
      expect(secondContext.ordinal).toBe(2);
      expect(secondContext.artifactDir).not.toBe(firstContext.artifactDir);
      writeFileSync(
        path.join(secondContext.artifactDir, 'second-success.txt'),
        'second-success-is-separate',
        'utf8',
      );
      const secondArtifacts = buildPackageUiAttemptArtifactManifest(secondContext.artifactDir);
      const secondAfter = structuredClone(firstAfter);
      secondAfter.capturedAt = '2026-07-17T06:00:03.000Z';
      secondAfter.profileContent.sha256 = 'D'.repeat(64);
      const secondEvidenceBinding = runEvidenceBindingFromAttempt(
        manager,
        profileId,
        secondContext,
      );
      const secondRun = bindSingleSuccessfulAttemptArtifact({
        attemptArtifacts: secondArtifacts,
        diagnostics: validDiagnostics(profileId),
        evidenceBinding: secondEvidenceBinding,
        failure: null,
        packageProcessIsolation: validProcessIsolation(),
        passed: true,
        profileId,
        profileLockIsolation: validProfileLockIsolation(
          profileId,
          secondEvidenceBinding.invocationId,
        ),
        profileProcessIsolation: validProcessIsolation(),
      }, secondArtifacts);
      const secondAttempt = recordPackageUiProfileAttempt({
        attemptArtifacts: secondArtifacts,
        attemptContext: secondContext,
        manager,
        profileId,
        profileState: { before: firstAfter, after: secondAfter },
        resumable: true,
        runEvidence: secondRun,
      });
      writePackageUiProfileCheckpoint({
        attemptRecord: secondAttempt,
        lineageStart: genesis,
        manager,
        profileId,
        profileState: { before: firstAfter, after: secondAfter },
        runEvidence: secondRun,
      });

      expect(readFileSync(firstArtifactPath, 'utf8')).toBe('first-failure-is-immutable');
      expect(packageUiAttemptArtifactManifestMatches(firstArtifacts)).toBe(true);
      expect(packageUiAttemptArtifactManifestMatches(secondArtifacts)).toBe(true);
      expect(
        profileLineageStateMatches(
          resolvePackageUiProfileCursor(manager, profileId).checkpoint.payload.profileState.after,
          secondAfter,
        ),
      ).toBe(true);
    } finally {
      rmSync(outputDir, { force: true, recursive: true });
    }
  });

  it('records cleanup failure without an after cursor and makes the run group explicitly non-resumable', () => {
    const outputDir = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-nonresumable-'));
    const genesis = validProfileLineageState();
    const profileId = PACKAGE_UI_PROFILE_SEQUENCE[0];
    const packageLineage = {
      appContentSha256: HASH_A,
      chromium: { relativePath: 'playwright-browsers/chrome-win64/chrome.exe', sha256: HASH_B, sizeBytes: 100 },
      executableSha256: HASH_B,
      profileBindingSha256: HASH_A,
      profileBrowserBindingSha256: HASH_B,
    };
    try {
      const manager = initializePackageUiRunGroup({
        authorityBinding: validAuthorityBinding(),
        genesisProfileState: genesis,
        options: { runGroupId: 'cleanup-failure-run-001' },
        outputDir,
        packageLineage,
        protectedDatabaseLogical: validLogicalArtifact(),
      });
      const attemptContext = createPackageUiProfileAttemptContext(
        manager,
        profileId,
        validInvocation(manager, 'cleanup-failure'),
      );
      writeFileSync(path.join(attemptContext.artifactDir, 'cleanup-failure.txt'), 'failed', 'utf8');
      const attemptArtifacts = buildPackageUiAttemptArtifactManifest(
        attemptContext.artifactDir,
      );
      const cleanupFailureBinding = runEvidenceBindingFromAttempt(
        manager,
        profileId,
        attemptContext,
      );
      const cleanupSafeRun = {
        chromiumProcessLineage: null,
        packageProcessIsolation: validProcessIsolation(),
        profileLockIsolation: validProfileLockIsolation(),
        profileProcessIsolation: validProcessIsolation(),
      };
      expect(packageUiAttemptCleanupPassed(cleanupSafeRun)).toBe(true);
      expect(packageUiAttemptCleanupPassed({
        ...cleanupSafeRun,
        chromiumProcessLineage: {
          cleanup: validProcessSnapshot({ attempts: 1 }),
          passed: false,
        },
      })).toBe(true);
      const cleanupFailedRun = {
        ...cleanupSafeRun,
        profileProcessIsolation: {
          ...validProcessIsolation(),
          passed: false,
        },
      };
      expect(packageUiAttemptCleanupPassed(cleanupFailedRun)).toBe(false);
      recordPackageUiProfileAttempt({
        attemptArtifacts,
        attemptContext,
        manager,
        profileId,
        profileState: { before: genesis, after: null },
        resumable: false,
        runEvidence: {
          ...cleanupFailedRun,
          attemptArtifacts,
          diagnostics: failedDiagnostics(
            profileId,
            'target Chromium cleanup unresolved',
          ).diagnostics,
          evidenceBinding: cleanupFailureBinding,
          failure: failedDiagnostics(
            profileId,
            'target Chromium cleanup unresolved',
          ).failure,
          passed: false,
          profileId,
          profileLockIsolation: validProfileLockIsolation(
            profileId,
            cleanupFailureBinding.invocationId,
          ),
        },
      });

      expect(() => resolvePackageUiProfileCursor(manager, profileId))
        .toThrow(/non-resumable.*fresh isolated profile\/run group/i);
    } finally {
      rmSync(outputDir, { force: true, recursive: true });
    }
  });

  it.runIf(process.platform === 'win32')('accepts a byte-for-byte copy with a distinct Windows file identity', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-copy-'));
    const protectedDatabasePath = path.join(root, 'protected.db');
    const profileDatabasePath = path.join(root, 'profile.db');
    try {
      writeFileSync(protectedDatabasePath, 'authority-db');
      copyFileSync(protectedDatabasePath, profileDatabasePath);

      expect(evaluateProfileDatabaseFileIsolation({
        profileDatabasePath,
        protectedDatabasePath,
      })).toEqual(expect.objectContaining({
        passed: true,
        sameFileIdentity: false,
        sharedHardLinkCount: 0,
        violations: [],
      }));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('accepts one path-safe resume run group and rejects ambiguous or traversal-like ids', () => {
    const base = [
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--allow-interactive-login',
      '--user-data-dir', USER_DATA_DIR,
      '--protected-db', PROTECTED_DB_PATH,
      '--authority-selection', AUTHORITY_SELECTION_PATH,
    ];
    expect(parsePackageUiEvidenceArgs([
      ...base,
      '--resume-run-group', 'operator-run-001',
      '--resume-inspection-receipt', 'D:\\Temp\\resume-inspections\\operator-run-001.json',
    ]).resumeRunGroupId).toBe('operator-run-001');
    expect(() => parsePackageUiEvidenceArgs([
      ...base,
      '--run-group', 'operator-run-001',
      '--resume-run-group', 'operator-run-001',
      '--resume-inspection-receipt', 'D:\\Temp\\resume-inspections\\operator-run-001.json',
    ])).toThrow(/cannot be combined/);
    expect(() => parsePackageUiEvidenceArgs([
      ...base,
      '--resume-run-group', '..\\escape',
      '--resume-inspection-receipt', 'D:\\Temp\\resume-inspections\\operator-run-001.json',
    ])).toThrow(/path-safe identifier/);
    expect(() => parsePackageUiEvidenceArgs([
      ...base,
      '--resume-run-group', 'operator-run-001',
    ])).toThrow(/--resume-inspection-receipt is required/i);
    expect(() => parsePackageUiEvidenceArgs([
      ...base,
      '--run-group', 'operator-run-001',
      '--resume-inspection-receipt', 'D:\\Temp\\resume-inspections\\operator-run-001.json',
    ])).toThrow(/only with --resume-run-group/i);
  });

  it('allows a bounded interactive operator login handoff but never combines it with saved-login automation', () => {
    const parsed = parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--allow-interactive-login',
      '--interactive-login-timeout-ms', '600000',
      '--user-data-dir', USER_DATA_DIR,
      '--protected-db', PROTECTED_DB_PATH,
      '--authority-selection', AUTHORITY_SELECTION_PATH,
    ]);

    expect(parsed.allowInteractiveLogin).toBe(true);
    expect(parsed.allowSavedLogin).toBe(false);
    expect(parsed.interactiveLoginTimeoutMs).toBe(600_000);
    expect(parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--allow-interactive-login',
      '--user-data-dir', USER_DATA_DIR,
      '--protected-db', PROTECTED_DB_PATH,
      '--authority-selection', AUTHORITY_SELECTION_PATH,
    ]).interactiveLoginTimeoutMs).toBe(900_000);
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--allow-interactive-login',
      '--interactive-login-timeout-ms', '900001',
      '--user-data-dir', USER_DATA_DIR,
      '--protected-db', PROTECTED_DB_PATH,
      '--authority-selection', AUTHORITY_SELECTION_PATH,
    ])).toThrow(/must not exceed 900000/i);
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--allow-saved-login',
      '--user-data-dir', USER_DATA_DIR,
      '--protected-db', PROTECTED_DB_PATH,
      '--authority-selection', AUTHORITY_SELECTION_PATH,
    ])).toThrow(/schema v9.*--allow-interactive-login/i);
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--allow-saved-login',
      '--allow-interactive-login',
      '--user-data-dir', USER_DATA_DIR,
      '--protected-db', PROTECTED_DB_PATH,
      '--authority-selection', AUTHORITY_SELECTION_PATH,
    ])).toThrow(/cannot be combined/i);
  });

  it.runIf(process.platform === 'win32')('rejects a real hardlink alias before package UI may launch', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-hardlink-'));
    const protectedDatabasePath = path.join(root, 'protected.db');
    const profileDatabasePath = path.join(root, 'profile.db');
    try {
      writeFileSync(protectedDatabasePath, 'authority-db');
      linkSync(protectedDatabasePath, profileDatabasePath);

      const result = evaluateProfileDatabaseFileIsolation({
        profileDatabasePath,
        protectedDatabasePath,
      });

      expect(result.passed).toBe(false);
      expect(result.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'PROFILE_DATABASE_HARDLINK_ALIAS' }),
      ]));

      const source = readFileSync('scripts/package-ui-orchestration.js', 'utf8');
      const runBody = source.slice(
        source.indexOf('async function runPackageUiEvidence(options, dependencies = {})'),
        source.indexOf('\n  return {\n    runPackageUiEvidence,'),
      );
      expect(runBody.indexOf('manifest.profileDatabaseFileIsolation = evaluateProfileDatabaseFileIsolation')).toBeGreaterThan(-1);
      expect(runBody.indexOf('manifest.profileDatabaseFileIsolation = evaluateProfileDatabaseFileIsolation'))
        .toBeLessThan(runBody.indexOf('for (let profileIndex = 0;'));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.runIf(process.platform === 'win32')('fails closed when bounded Windows hardlink enumeration times out', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-timeout-'));
    const protectedDatabasePath = path.join(root, 'protected.db');
    const profileDatabasePath = path.join(root, 'profile.db');
    const calls = [];
    try {
      writeFileSync(protectedDatabasePath, 'authority-db');
      copyFileSync(protectedDatabasePath, profileDatabasePath);

      const result = evaluateProfileDatabaseFileIsolation({
        profileDatabasePath,
        protectedDatabasePath,
        run: (command, args, options) => {
          calls.push({ args, command, options });
          return {
            error: Object.assign(new Error('operation timed out'), { code: 'ETIMEDOUT' }),
            signal: 'SIGTERM',
            status: null,
            stderr: '',
            stdout: '',
          };
        },
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(expect.objectContaining({
        args: ['hardlink', 'list', profileDatabasePath],
        options: expect.objectContaining({
          shell: false,
          timeout: expect.any(Number),
          windowsHide: true,
        }),
      }));
      expect(calls[0].command).toMatch(/[\\/]System32[\\/]fsutil\.exe$/i);
      expect(calls[0].options.timeout).toBeGreaterThan(0);
      expect(calls[0].options.timeout).toBeLessThanOrEqual(5_000);
      expect(result.passed).toBe(false);
      expect(result.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'PROFILE_DATABASE_FILE_IDENTITY_UNVERIFIED' }),
      ]));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.runIf(process.platform === 'win32')('retains fail-closed rejection for a database path traversing a junction', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-junction-'));
    const protectedDatabasePath = path.join(root, 'protected.db');
    const profileSource = path.join(root, 'profile-source');
    const profileAlias = path.join(root, 'profile-alias');
    try {
      mkdirSync(profileSource);
      writeFileSync(protectedDatabasePath, 'authority-db');
      copyFileSync(protectedDatabasePath, path.join(profileSource, 'amazon-ai-ops.db'));
      symlinkSync(profileSource, profileAlias, 'junction');

      const result = evaluateProfileDatabaseFileIsolation({
        profileDatabasePath: path.join(profileAlias, 'amazon-ai-ops.db'),
        protectedDatabasePath,
      });

      expect(result.passed).toBe(false);
      expect(result.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'PROFILE_DATABASE_FILE_IDENTITY_UNVERIFIED' }),
      ]));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('accepts only a distinct isolated database with the protected database SHA-256 and size', () => {
    const protectedDatabase = {
      path: PROTECTED_DB_PATH,
      sha256: HASH_A,
      sizeBytes: 18_448_384,
    };
    const profileDatabase = {
      path: path.join(USER_DATA_DIR, 'amazon-ai-ops.db'),
      sha256: HASH_A,
      sizeBytes: 18_448_384,
    };

    expect(evaluateProfileDatabaseProvenance({ profileDatabase, protectedDatabase })).toEqual({
      hashMatches: true,
      passed: true,
      pathsDistinct: true,
      profileDatabase,
      protectedDatabase,
      sizeMatches: true,
      violations: [],
    });
  });

  it.each([
    ['hash drift', { sha256: HASH_B }, 'PROFILE_DATABASE_HASH_MISMATCH'],
    ['size drift', { sizeBytes: 18_448_385 }, 'PROFILE_DATABASE_SIZE_MISMATCH'],
    ['protected path reuse', { path: PROTECTED_DB_PATH }, 'PROFILE_DATABASE_NOT_ISOLATED'],
  ])('fails closed for %s', (_label, override, code) => {
    const result = evaluateProfileDatabaseProvenance({
      protectedDatabase: { path: PROTECTED_DB_PATH, sha256: HASH_A, sizeBytes: 18_448_384 },
      profileDatabase: {
        path: path.join(USER_DATA_DIR, 'amazon-ai-ops.db'),
        sha256: HASH_A,
        sizeBytes: 18_448_384,
        ...override,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });
});
