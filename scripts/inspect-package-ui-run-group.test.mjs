import {
  authorityBinding,
  createDatabase,
  createFixture,
  createRequire,
  createWalAuthoritySelectionFixture,
  describe,
  envelope,
  expect,
  fastLogical,
  fs,
  hash,
  inspectFixture,
  inspector,
  isolation,
  it,
  makeRoot,
  mutateProfileState,
  parseRunnerArgsWithoutPlaywright,
  path,
  profileLockIsolation,
  protectedSqliteTemp,
  require,
  runnerContract,
  samePathForTest,
  spawnSync,
  validDiagnostics,
  validateWalAuthoritySelectionFixture,
  writeAttempt,
  writeCheckpoint,
  writeRunManifest,
  zeroSnapshot,
} from './inspect-package-ui-test-fixtures.mjs';

describe('inspect-package-ui-run-group', () => {
  it('parses the documented CLI exactly once, forbids package overrides, and emits runner-parseable resume argv', () => {
    const parsed = inspector.parseArgs([
      '--output', 'output/codex-evidence/package-ui-evidence',
      '--resume-run-group', 'fixture-run-001',
      '--expected-exe-sha256', 'A'.repeat(64),
      '--expected-app-content-sha256', 'B'.repeat(64),
      '--user-data-dir', 'D:\\Temp\\amazon-ai-ops-fixture',
      '--protected-db', inspector.DEFAULT_PROTECTED_DB,
      '--authority-selection', 'D:\\Temp\\authority-selection.json',
    ]);
    expect(parsed.output).toBe(path.resolve('output/codex-evidence/package-ui-evidence'));
    expect(parsed.executable).toBe(inspector.DEFAULT_EXE);
    expect(parsed.appContent).toBe(inspector.DEFAULT_APP_CONTENT);
    expect(() => inspector.parseArgs(['--executable', 'x'])).toThrow(/unknown argument/i);

    const fixture = createFixture();
    const result = inspectFixture(fixture);
    expect(result.status).toBe('RESUME_SAFE');
    const runnableResumeArgs = result.resume.argv.slice(1).map((value) => (
      samePathForTest(value, fixture.profile)
        ? 'D:\\Temp\\amazon-ai-ops-fixture'
        : value
    ));
    const parsedResume = parseRunnerArgsWithoutPlaywright(runnableResumeArgs);
    expect(parsedResume).toEqual({
      allowInteractiveLogin: true,
      expectedExeSha256: fixture.expectedExe,
      resumeRunGroupId: fixture.runGroupId,
    });
    expect(result.resume.powershellDisplay).toContain("'--allow-interactive-login'");
    expect(result.resume.argv).toContain(path.resolve(fixture.profile));
    expect(result.resume.argv).toContain(path.resolve(fixture.protectedDb));
    expect(result.resume.argv).toContain(path.resolve(fixture.authoritySelection));
    expect(result.resume.pathInputsRequired).toEqual([]);
  });

  it('accepts a fully bound current v9 manifest without importing Playwright', () => {
    const fixture = createFixture();
    writeRunManifest(fixture);
    const result = inspectFixture(fixture);
    expect(result).toMatchObject({ nextProfileId: '100-compact', status: 'RESUME_SAFE', violations: [] });
    expect(require.cache[require.resolve('./playwright-loader.js')]).toBeUndefined();
  });

  it.runIf(process.platform === 'win32')('binds the canonical authority path with package-runner Windows lexical semantics', () => {
    const fixture = createFixture();
    const canonicalDatabasePath = fs.realpathSync.native(fixture.protectedDb);
    const expectedPathHash = hash(Buffer.from(
      path.win32.normalize(canonicalDatabasePath).replace(/[\\/]+$/, '').toLowerCase(),
      'utf8',
    ));
    expect(path.win32.isAbsolute(canonicalDatabasePath)).toBe(true);
    expect(fixture.metadata.authorityBinding.canonicalDatabasePathSha256)
      .toBe(expectedPathHash);
    expect(inspectFixture(fixture)).toMatchObject({
      status: 'RESUME_SAFE',
      violations: [],
    });

    const differentCanonicalPath = path.join(fixture.root, 'different-authority.db');
    const rejected = inspectFixture(fixture, {
      canonicalAuthorityPaths: {
        databasePath: differentCanonicalPath,
        roamingAppData: fixture.root,
        userDataDir: path.dirname(differentCanonicalPath),
        userProfile: fixture.root,
      },
    });
    expect(rejected.status).toBe('LINEAGE_CHANGED');
    expect(rejected.violations.map((item) => item.code))
      .toContain('AUTHORITY_BINDING_CHANGED');
  });

  it('uses RECORD_ROOT_REQUIRED for a missing root and creates no evidence output', () => {
    const root = makeRoot();
    const result = inspector.inspect({
      appContent: inspector.DEFAULT_APP_CONTENT,
      executable: inspector.DEFAULT_EXE,
      output: path.join(root, 'missing'),
      'expected-app-content-sha256': 'B'.repeat(64),
      'expected-exe-sha256': 'A'.repeat(64),
      'authority-selection': path.join(root, 'authority.json'),
      'protected-db': path.join(root, 'missing.db'),
      'resume-run-group': 'fixture-run-001',
      'user-data-dir': path.join(root, 'profile'),
    }, { allowNonCanonicalAuthorityPath: true });
    expect(result).toMatchObject({
      status: 'RECORD_ROOT_REQUIRED',
      violations: [{ code: 'RECORD_ROOT_MISSING' }],
    });
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it.each([
    ['protected DB', (fixture) => createDatabase(fixture.protectedDb, 'drift'), 'LINEAGE_CHANGED', 'PROTECTED_DB_DRIFT'],
    ['profile', (fixture) => fs.writeFileSync(path.join(fixture.profile, 'profile.txt'), 'changed'), 'FRESH_PROFILE_REQUIRED', 'PROFILE_CONTENT_DRIFT'],
    ['Chromium', (fixture) => fs.writeFileSync(fixture.chromium, 'drift'), 'LINEAGE_CHANGED', 'PACKAGE_APP_CONTENT_DRIFT'],
    ['package', (fixture) => fs.writeFileSync(fixture.exe, 'drift'), 'LINEAGE_CHANGED', 'PACKAGE_EXE_DRIFT'],
  ])('rejects %s lineage drift with a source-specific status', (_label, mutate, status, code) => {
    const fixture = createFixture();
    mutate(fixture);
    const result = inspectFixture(fixture);
    expect(result.status).toBe(status);
    expect(result.violations.map((item) => item.code)).toContain(code);
  });

  it('resumes from an uncheckpointed failed attempt only when its exact cleanup and invocation chain are proven', () => {
    const fixture = createFixture();
    writeRunManifest(fixture, {
      completedAt: '2026-07-29T00:10:00.000Z',
      generatedAt: '2026-07-29T00:00:00.000Z',
    });
    writeAttempt(fixture, { completedAt: '2026-07-29T00:05:00.000Z' });
    const result = inspectFixture(fixture);
    expect(result).toMatchObject({
      nextProfileId: '100-compact',
      status: 'RESUME_SAFE',
      violations: [],
    });
  });

  it('rejects a run manifest detached from the exact userData/protected DB/package bindings', () => {
    const fixture = createFixture();
    writeRunManifest(fixture);
    const manifestPath = path.join(
      fixture.groupRoot,
      'manifests',
      '2026-07-29T00-00-00-000Z.json',
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.requested.userDataDir = path.join(fixture.root, 'other-profile');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
    const result = inspectFixture(fixture);
    expect(result.status).toBe('RECORD_ROOT_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('MANIFEST_RECORD_INVALID');
  });

  it('rejects inconsistent or non-secret-blind attempt failure diagnostics', () => {
    const fixture = createFixture();
    const receipt = writeAttempt(fixture);
    const value = JSON.parse(fs.readFileSync(receipt.record.path, 'utf8'));
    value.payload.failure = {
      ...value.payload.failure,
      password: 'must-not-survive',
    };
    fs.writeFileSync(receipt.record.path, `${JSON.stringify(envelope(value.payload))}\n`, 'utf8');
    const result = inspectFixture(fixture);
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('ATTEMPT_RECORD_INVALID');
  });

  it('rejects a forged semantic contract even when its outer hashes are self-consistent', () => {
    const fixture = createFixture();
    const file = path.join(fixture.groupRoot, 'run-group.json');
    const data = JSON.parse(fs.readFileSync(file));
    data.payload.runnerContract.semanticContractSha256 = 'C'.repeat(64);
    const binding = {
      evidenceScript: data.payload.runnerContract.evidenceScript,
      protectedSqliteTempScript:
        data.payload.runnerContract.protectedSqliteTempScript,
      semanticContractSha256: data.payload.runnerContract.semanticContractSha256,
    };
    data.payload.runnerContract.sha256 = hash(Buffer.from(inspector.canonicalJson(binding)));
    data.payload.runnerContractSha256 = data.payload.runnerContract.sha256;
    fs.writeFileSync(file, JSON.stringify(envelope(data.payload)));
    const result = inspectFixture(fixture);
    expect(result.status).toBe('LINEAGE_CHANGED');
    expect(result.violations.map((item) => item.code)).toContain('RUNNER_LINEAGE_DRIFT');
  });

  it('accepts a failed-then-successful retry chain bound to one exact immutable invocation', () => {
    const fixture = createFixture();
    writeRunManifest(fixture);
    const firstAfter = mutateProfileState(fixture, 'failed-attempt-session');
    const first = writeAttempt(fixture, { after: firstAfter });
    const secondAfter = mutateProfileState(fixture, 'successful-session');
    const second = writeAttempt(fixture, {
      after: secondAfter,
      before: firstAfter,
      completedAt: '2026-07-29T00:07:00.000Z',
      ordinal: 2,
      passed: true,
    });
    writeCheckpoint(fixture, { receipts: [first, second] });
    const result = inspectFixture(fixture);
    expect(result).toMatchObject({
      nextProfileId: '125-compact',
      status: 'RESUME_SAFE',
      violations: [],
    });
  });

  it('accepts one fully bound successful checkpoint and advances to the next profile', () => {
    const fixture = createFixture();
    const success = writeAttempt(fixture, { failure: null, passed: true });
    writeCheckpoint(fixture, { receipts: [success] });
    const result = inspectFixture(fixture);
    expect(result).toMatchObject({
      nextProfileId: '125-compact',
      status: 'RESUME_SAFE',
      violations: [],
    });
  });

  it('rejects a self-consistent checkpoint binding spliced from another invocation and run group', () => {
    const fixture = createFixture();
    const success = writeAttempt(fixture, { failure: null, passed: true });
    writeCheckpoint(fixture, { receipts: [success] });
    const checkpointPath = path.join(
      fixture.groupRoot,
      'checkpoints',
      '100-compact.json',
    );
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    const detachedInvocationId = 'detached-invocation-001';
    const detachedRunGroupId = 'detached-run-group-001';
    const detachedLock = profileLockIsolation(
      '100-compact',
      detachedInvocationId,
    );
    checkpoint.payload.runEvidence.evidenceBinding = {
      ...checkpoint.payload.runEvidence.evidenceBinding,
      invocationId: detachedInvocationId,
      profileLockBinding: detachedLock.before.binding,
      runGroupId: detachedRunGroupId,
    };
    checkpoint.payload.runEvidence.profileLockIsolation = detachedLock;
    checkpoint.payload.runEvidence.artifactReferences =
      checkpoint.payload.runEvidence.artifactReferences.map((reference) => {
        const binding = {
          ...reference.binding,
          invocationId: detachedInvocationId,
          runGroupId: detachedRunGroupId,
        };
        return {
          ...reference,
          binding,
          semanticKey: inspector.sha256Buffer(Buffer.from(
            inspector.canonicalJson({
              binding,
              role: reference.role,
              slot: reference.slot,
            }),
            'utf8',
          )),
        };
      });
    fs.writeFileSync(
      checkpointPath,
      `${JSON.stringify(envelope(checkpoint.payload))}\n`,
      'utf8',
    );

    const result = inspectFixture(fixture);
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code))
      .toContain('CHECKPOINT_CURSOR_MISMATCH');
  });

  it('rejects duplicate semantic keys, reused paths, and lexical path aliases in immutable artifact references', () => {
    const fixture = createFixture();
    const success = writeAttempt(fixture, { failure: null, passed: true });
    const { attemptArtifacts, artifactReferences } = success.payload;
    expect(inspector.attemptArtifactMembershipMatches(
      attemptArtifacts,
      artifactReferences,
      artifactReferences[0].binding,
      true,
    )).toBe(true);
    expect(inspector.attemptArtifactMembershipMatches(
      attemptArtifacts,
      [...artifactReferences, structuredClone(artifactReferences[0])],
      artifactReferences[0].binding,
    )).toBe(false);
    const aliased = structuredClone(artifactReferences);
    aliased[0].path = `${path.dirname(aliased[0].path)}${path.sep}.${path.sep}${path.basename(aliased[0].path)}`;
    expect(inspector.attemptArtifactMembershipMatches(
      attemptArtifacts,
      aliased,
      artifactReferences[0].binding,
    )).toBe(false);
    const detachedBinding = structuredClone(artifactReferences[0].binding);
    detachedBinding.invocationId = 'detached-invocation-001';
    expect(inspector.attemptArtifactMembershipMatches(
      attemptArtifacts,
      artifactReferences,
      detachedBinding,
    )).toBe(false);
    const failedCaptureOnSuccess = structuredClone(artifactReferences);
    failedCaptureOnSuccess[0].role = 'failed-capture-artifact';
    failedCaptureOnSuccess[0].slot = {
      kind: 'failed-capture',
      overlayId: null,
      pathSha256: hash(Buffer.from(attemptArtifacts.files[0].path, 'utf8')),
      subview: null,
      workspace: null,
    };
    failedCaptureOnSuccess[0].semanticKey = inspector.sha256Buffer(Buffer.from(
      inspector.canonicalJson({
        binding: failedCaptureOnSuccess[0].binding,
        role: failedCaptureOnSuccess[0].role,
        slot: failedCaptureOnSuccess[0].slot,
      }),
      'utf8',
    ));
    expect(inspector.attemptArtifactMembershipMatches(
      attemptArtifacts,
      failedCaptureOnSuccess,
      artifactReferences[0].binding,
      true,
    )).toBe(false);

    const cleanup = {
      chromiumProcessLineage: null,
      packageProcessIsolation: isolation(),
      profileLockIsolation: profileLockIsolation(
        artifactReferences[0].binding.profileId,
        artifactReferences[0].binding.invocationId,
      ),
      profileProcessIsolation: isolation(),
    };
    expect(inspector.cleanupProven(cleanup)).toBe(true);
    cleanup.profileLockIsolation.before.tree.unexpected = true;
    expect(inspector.cleanupProven(cleanup)).toBe(false);
  });

  it('rejects a minimal passed checkpoint when the current profile-specific v9 validator fails', () => {
    const fixture = createFixture();
    const success = writeAttempt(fixture, { failure: null, passed: true });
    writeCheckpoint(fixture, { receipts: [success] });
    const result = inspectFixture(fixture, {
      validateProfileEvidence: () => ({
        cleanupPassed: true,
        diagnosticsPassed: true,
        passed: false,
        relevantViolations: [{ code: 'WORKSPACE_CHECK_MISSING_OR_FAILED' }],
        shapePassed: true,
      }),
    });
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('CHECKPOINT_EVIDENCE_INCOMPLETE');
  });

  it('loads the current runner in a pure child and rejects minimal runEvidence without importing Playwright', () => {
    const validation = inspector.validateProfileEvidenceFromPureChild({
      profileId: '100-compact',
      runEvidence: {
        diagnostics: validDiagnostics('100-compact'),
        packageProcessIsolation: isolation(),
        passed: true,
        profileId: '100-compact',
        profileProcessIsolation: isolation(),
        scalePercent: 100,
      },
      runnerPath: path.resolve('scripts/package-ui-evidence.js'),
    });
    expect(validation.passed).toBe(false);
    expect(validation.relevantViolations.length).toBeGreaterThan(0);
    expect(validation.relevantViolations.map((item) => item.code)).toContain(
      'V9_WORKSPACE_CHECKS_NOT_EXACT',
    );
    expect(require.cache[require.resolve('./playwright-loader.js')]).toBeUndefined();
  });

  it.each([
    ['non-resumable receipt', (fixture) => writeAttempt(fixture, { resumable: false }), 'CLEANUP_UNPROVEN'],
    ['detached artifact directory', (fixture) => {
      writeRunManifest(fixture);
      const receipt = writeAttempt(fixture);
      const file = receipt.record.path;
      const data = JSON.parse(fs.readFileSync(file));
      data.payload.attemptArtifacts.rootPath = path.join(fixture.groupRoot, 'profile-attempt-artifacts', '100-compact');
      fs.writeFileSync(file, JSON.stringify(envelope(data.payload)));
    }, 'ATTEMPT_RECORD_INVALID'],
  ])('requires a fresh profile for %s', (_label, arrange, code) => {
    const fixture = createFixture();
    arrange(fixture);
    const result = inspectFixture(fixture);
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain(code);
  });

  it('rejects a checkpoint bound to a failed terminal receipt and out-of-order future records', () => {
    const fixture = createFixture();
    writeRunManifest(fixture);
    const failed = writeAttempt(fixture);
    writeCheckpoint(fixture, { receipts: [failed] });
    let result = inspectFixture(fixture);
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('CHECKPOINT_CURSOR_MISMATCH');

    const second = createFixture();
    fs.mkdirSync(path.join(second.groupRoot, 'attempts', '125-compact'), { recursive: true });
    result = inspectFixture(second);
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('CHECKPOINT_CURSOR_MISMATCH');
  });

  it('rejects active package/profile processes before touching SQLite state', () => {
    const fixture = createFixture();
    const active = { ...zeroSnapshot(), matching: [{}], matchingCount: 1, observedCount: 1 };
    const capture = () => {
      throw new Error('SQLite capture must not run while a target process is active');
    };
    const result = inspectFixture(fixture, {
      captureSqliteLogicalArtifact: capture,
      getRunnerFacts: () => ({
        packageProcess: active,
        profileProcess: zeroSnapshot(),
        runnerLease: {
          activeRunnerCount: 0,
          passed: true,
          runGroupId: fixture.runGroupId,
          runnerContractSha256: fixture.contract.sha256,
          supported: true,
        },
        runnerContract: fixture.contract,
      }),
    });
    expect(result.status).toBe('PROCESS_STOP_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('PROCESS_PACKAGE_ACTIVE');
  });

  it.each([
    ['canonical', {
      ...zeroSnapshot(),
      matching: [{ executablePath: 'canonical.exe', processId: 1 }],
      matchingCount: 1,
      observedCount: 1,
    }],
    ['installed-or-portable', {
      ...zeroSnapshot(),
      matching: [],
      matchingCount: 0,
      observedCount: 1,
    }],
    ['unresolvable', {
      ...zeroSnapshot(),
      observedCount: 1,
      passed: false,
      unresolved: [{ executablePath: null, processId: 1 }],
      unresolvedCount: 1,
    }],
  ])('requires observedCount=0 for every %s same-name AmazonAIOpsAgent.exe process', (_kind, packageProcess) => {
    const fixture = createFixture();
    const result = inspectFixture(fixture, {
      getRunnerFacts: () => ({
        packageProcess,
        profileProcess: zeroSnapshot(),
        runnerContract: fixture.contract,
        runnerLease: {
          activeRunnerCount: 0,
          passed: true,
          runGroupId: fixture.runGroupId,
          runnerContractSha256: fixture.contract.sha256,
          supported: true,
        },
      }),
    });
    expect(result.status).toBe('PROCESS_STOP_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('PROCESS_PACKAGE_ACTIVE');
  });

  it('recollects package/profile/runner state immediately before returning', () => {
    const fixture = createFixture();
    let calls = 0;
    const result = inspectFixture(fixture, {
      getRunnerFacts: () => {
        calls += 1;
        return {
          packageProcess: calls === 1
            ? zeroSnapshot()
            : { ...zeroSnapshot(), observedCount: 1 },
          profileProcess: zeroSnapshot(),
          runnerContract: fixture.contract,
          runnerLease: {
            activeRunnerCount: 0,
            passed: true,
            runGroupId: fixture.runGroupId,
            runnerContractSha256: fixture.contract.sha256,
            supported: true,
          },
        };
      },
    });
    expect(calls).toBe(2);
    expect(result.status).toBe('PROCESS_STOP_REQUIRED');
    expect(result.processAttestation.finalPackageObservedCount).toBe(1);
  });

  it('fails closed with a runner repair status when no contract-bound run-group lease exists', () => {
    const fixture = createFixture();
    const result = inspectFixture(fixture, {
      getRunnerFacts: () => ({
        packageProcess: zeroSnapshot(),
        profileProcess: zeroSnapshot(),
        runnerContract: fixture.contract,
        runnerLease: {
          activeRunnerCount: null,
          passed: false,
          reasonCode: 'RUNNER_LEASE_NOT_IMPLEMENTED',
          runGroupId: fixture.runGroupId,
          runnerContractSha256: fixture.contract.sha256,
          supported: false,
        },
      }),
    });
    expect(result.status).toBe('RUNNER_REPAIR_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('RUNNER_LEASE_UNSUPPORTED');
    expect(result.runnerLimitations).toEqual([]);
  });

  it('rejects the protected DB itself as the isolated profile DB', () => {
    const fixture = createFixture();
    fixture.options['protected-db'] = path.join(fixture.profile, 'amazon-ai-ops.db');
    const result = inspectFixture(fixture);
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('PROFILE_DATABASE_NOT_ISOLATED');
  });

  it('requires genesis profile logical hash, size, and pages to equal protected logical authority', () => {
    const fixture = createFixture();
    const file = path.join(fixture.groupRoot, 'run-group.json');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    value.payload.genesisProfileState.logicalDatabase.totalPages += 1;
    fs.writeFileSync(file, `${JSON.stringify(envelope(value.payload))}\n`, 'utf8');
    const result = inspectFixture(fixture);
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain(
      'PROFILE_GENESIS_PROVENANCE_INVALID',
    );
  });

  it('fails closed when runner-grade Windows file-ID/hardlink isolation is not proven', () => {
    const fixture = createFixture();
    const result = inspectFixture(fixture, {
      validateProfileProvenance: () => ({
        fileIsolation: {
          passed: false,
          sameFileIdentity: true,
          sharedHardLinkCount: 1,
        },
        provenance: { passed: true },
      }),
    });
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain(
      'PROFILE_DATABASE_FILE_ISOLATION_UNPROVEN',
    );
  });

  it('compares totalPages during current logical authority checks', () => {
    const fixture = createFixture();
    const result = inspectFixture(fixture, {
      captureSqliteLogicalArtifact: (filePath) => {
        const artifact = fastLogical(filePath);
        return samePathForTest(filePath, fixture.protectedDb)
          ? { ...artifact, totalPages: artifact.totalPages + 1 }
          : artifact;
      },
    });
    expect(result.status).toBe('LINEAGE_CHANGED');
    expect(result.violations.map((item) => item.code)).toContain('PROTECTED_DB_DRIFT');
  });

  it.each(['symlink', 'hardlink', 'path-escape', 'nested-extra-field', 'manifest-extra-entry'])('rejects immutable evidence %s', (mode) => {
    const fixture = createFixture();
    if (mode === 'symlink') {
      const link = `${fixture.profile}-junction`;
      fs.symlinkSync(fixture.profile, link, 'junction');
      fixture.options['user-data-dir'] = link;
    } else if (mode === 'hardlink') {
      fs.linkSync(path.join(fixture.groupRoot, 'run-group.json'), path.join(fixture.groupRoot, 'copy.json'));
    } else if (mode === 'path-escape') {
      fs.mkdirSync(path.join(fixture.groupRoot, 'attempts'), { recursive: true });
      fs.symlinkSync(path.dirname(fixture.protectedDb), path.join(fixture.groupRoot, 'attempts', '100-compact'), 'junction');
    } else if (mode === 'nested-extra-field') {
      const file = path.join(fixture.groupRoot, 'run-group.json');
      const data = JSON.parse(fs.readFileSync(file));
      data.payload.genesisProfileState.profileContent.unexpected = true;
      fs.writeFileSync(file, JSON.stringify(envelope(data.payload)));
    } else {
      fs.mkdirSync(path.join(fixture.groupRoot, 'manifests'), { recursive: true });
      fs.writeFileSync(path.join(fixture.groupRoot, 'manifests', 'unexpected.txt'), 'x');
    }
    expect(inspectFixture(fixture).status).not.toBe('RESUME_SAFE');
  });

  it('rejects parseable but non-canonical ISO timestamps in immutable records', () => {
    const fixture = createFixture();
    const file = path.join(fixture.groupRoot, 'run-group.json');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    value.payload.createdAt = '2026-07-29T00:00:00Z';
    fs.writeFileSync(file, `${JSON.stringify(envelope(value.payload))}\n`, 'utf8');
    const result = inspectFixture(fixture);
    expect(result.status).toBe('RECORD_ROOT_REQUIRED');
    expect(result.violations.map((item) => item.code)).toContain('RECORD_ROOT_INVALID');
  });

  it('uses the WAL-aware online-backup helper without changing a synthetic source DB or its sidecars', () => {
    const root = makeRoot();
    const dbPath = path.join(root, 'wal.db');
    const localRequire = createRequire(path.resolve('packages/local-db/package.json'));
    const Database = localRequire('better-sqlite3');
    const db = new Database(dbPath);
    try {
      db.pragma('journal_mode = WAL');
      db.exec('CREATE TABLE proof(value TEXT); INSERT INTO proof(value) VALUES (\'wal-row\');');
      const paths = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].filter((candidate) => fs.existsSync(candidate));
      const before = paths.map((candidate) => ({
        path: candidate,
        sha256: hash(fs.readFileSync(candidate)),
        size: fs.statSync(candidate).size,
      }));
      const proof = inspector.sqliteLogicalArtifact(dbPath);
      const after = paths.map((candidate) => ({
        path: candidate,
        sha256: hash(fs.readFileSync(candidate)),
        size: fs.statSync(candidate).size,
      }));
      expect(proof).toMatchObject({
        method: 'readonly-sqlite-online-backup',
        remainingPages: 0,
        schemaVersion: 'sqlite-authority-currentness-proof/v1',
      });
      expect(after).toEqual(before);
    } finally {
      db.close();
    }
  });

  it.runIf(process.platform === 'win32')('fails before any DB copy when the owned temp ACL cannot be restricted', () => {
    const root = makeRoot();
    const tempParent = path.join(root, 'bounded-temp');
    fs.mkdirSync(tempParent);
    const dbPath = path.join(root, 'source.db');
    createDatabase(dbPath);
    let backupCalls = 0;
    expect(() => inspector.sqliteLogicalArtifact(dbPath, 'acl-negative', {
      runReadonlySqliteOnlineBackupSync: () => {
        backupCalls += 1;
        throw new Error('backup must not run');
      },
      spawnSync: () => ({
        error: null,
        signal: null,
        status: 1,
        stderr: 'synthetic ACL denial',
      }),
      tempParent,
    })).toThrow(/ACL application\/readback failed before any DB copy/i);
    expect(backupCalls).toBe(0);
    expect(fs.readdirSync(tempParent)).toEqual([]);
  });

  it.runIf(process.platform === 'win32')('rejects a real protected-root readback after an explicit Everyone ACE is added', () => {
    const root = makeRoot();
    const tempRoot = fs.mkdtempSync(path.join(
      root,
      'amazon-ai-ops-package-ui-inspector-acl-',
    ));
    protectedSqliteTemp.restrictWindowsTempAcl(tempRoot);
    const encodedRoot = Buffer.from(tempRoot, 'utf8').toString('base64');
    const mutation = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        "$ErrorActionPreference = 'Stop'",
        `$target=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedRoot}'))`,
        '$directory=[IO.DirectoryInfo]::new($target)',
        '$acl=$directory.GetAccessControl()',
        '$everyone=[Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::WorldSid,$null)',
        "$rule=[Security.AccessControl.FileSystemAccessRule]::new($everyone,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')",
        '$acl.AddAccessRule($rule) | Out-Null',
        '$directory.SetAccessControl($acl)',
      ].join('; '),
    ], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    expect(mutation.status).toBe(0);
    expect(() => protectedSqliteTemp.verifyWindowsTempAcl(tempRoot))
      .toThrow(/ACL application\/readback failed before any DB copy/i);
  });

  it('removes owned source/destination DB copies even when the backup helper leaves an unexpected entry and throws', () => {
    const root = makeRoot();
    const tempParent = path.join(root, 'bounded-temp');
    fs.mkdirSync(tempParent);
    const dbPath = path.join(root, 'source.db');
    createDatabase(dbPath);
    expect(() => inspector.sqliteLogicalArtifact(dbPath, 'cleanup-negative', {
      runReadonlySqliteOnlineBackupSync: ({
        destinationPath,
        ownedTempRoot,
        sourceDatabasePath,
      }) => {
        fs.copyFileSync(sourceDatabasePath, destinationPath);
        fs.copyFileSync(sourceDatabasePath, path.join(ownedTempRoot, 'unexpected-full-copy.db'));
        throw new Error('synthetic backup failure');
      },
      tempParent,
    })).toThrow(/synthetic backup failure/);
    expect(fs.readdirSync(tempParent)).toEqual([]);
  });

  it('rejects a stale or detached production authority-selection receipt', () => {
    const fixture = createFixture();
    const result = inspectFixture(fixture, {
      validateAuthoritySelection: () => ({
        logicalArtifact: fixture.metadata.protectedDatabaseLogical,
        passed: false,
        receiptSha256: hash(fs.readFileSync(fixture.authoritySelection)),
        status: 'SELECTED_RECOVERY_REQUIRED',
      }),
    });
    expect(result.status).toBe('LINEAGE_CHANGED');
    expect(result.violations.map((item) => item.code)).toContain('AUTHORITY_SELECTION_INVALID');
  });

  it.runIf(process.platform === 'win32')('accepts only SHM mtime drift during pure-child authority revalidation', () => {
    const fixture = createWalAuthoritySelectionFixture();
    try {
      expect(fixture.receipt.selection.selected.sidecars.shm.exists).toBe(true);
      expect(fixture.receipt.selection.selected.sidecarsBefore.shm.exists).toBe(true);
      fixture.receipt.selection.selected.sidecars.shm.mtimeMs -= 10_000;
      fixture.receipt.selection.selected.sidecarsBefore.shm.mtimeMs -= 10_000;

      expect(validateWalAuthoritySelectionFixture(fixture)).toMatchObject({
        passed: true,
        status: fixture.receipt.status,
      });
    } finally {
      fixture.database.close();
    }
  });

  describe.runIf(process.platform === 'win32')('pure-child authority sidecar drift guards', () => {
    it.each([
      ['SHM hash', (selected) => { selected.sidecars.shm.sha256 = '0'.repeat(64); }],
      ['SHM size', (selected) => { selected.sidecars.shm.sizeBytes += 1; }],
      ['SHM path', (selected) => { selected.sidecars.shm.absolutePath += '.detached'; }],
      ['WAL hash', (selected) => { selected.sidecars.wal.sha256 = '0'.repeat(64); }],
      ['journal path', (selected) => { selected.sidecarsBefore.journal.absolutePath += '.detached'; }],
    ])('rejects %s drift during pure-child authority revalidation', (_label, mutate) => {
      const fixture = createWalAuthoritySelectionFixture();
      try {
        mutate(fixture.receipt.selection.selected);
        expect(validateWalAuthoritySelectionFixture(fixture)).toMatchObject({
          passed: false,
          status: fixture.receipt.status,
        });
      } finally {
        fixture.database.close();
      }
    });
  });

  it('resolves the canonical authority through Windows Known Folder rather than a poisoned APPDATA variable', () => {
    const root = makeRoot();
    const child = spawnSync(process.execPath, [
      '-e',
      "const inspector=require('./scripts/inspect-package-ui-run-group.js');process.stdout.write(inspector.DEFAULT_PROTECTED_DB);",
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: { ...process.env, APPDATA: path.join(root, 'poisoned-appdata') },
      shell: false,
      timeout: 30_000,
      windowsHide: true,
    });
    expect(child.status).toBe(0);
    expect(samePathForTest(child.stdout, inspector.DEFAULT_PROTECTED_DB)).toBe(true);
    expect(samePathForTest(child.stdout, path.join(root, 'poisoned-appdata'))).toBe(false);
  });

  it('keeps --help pure and documents the no-browser boundary', () => {
    expect(inspector.main(['--help'])).toBe(0);
    expect(inspector.USAGE).toMatch(/never launches Electron, Playwright, Chromium/i);
  });
});
