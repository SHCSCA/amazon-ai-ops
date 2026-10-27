// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    CURRENTNESS_METHOD,
    PRODUCTION_AUTHORITY_SELECTION_KIND,
    PRODUCTION_AUTHORITY_SELECTION_SCHEMA_VERSION,
    SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
    WINDOWS_HARDLINK_ENUMERATION_TIMEOUT_MS,
    crypto,
    fs,
    inspectProductionAuthoritySelection,
    path,
    spawnSync,
  } = dependencies;
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const canonicalPackageUiAuthorityPaths = (...args) => dependencies.canonicalPackageUiAuthorityPaths(...args);
  const fail = (...args) => dependencies.fail(...args);
  const normalizedWindowsPath = (...args) => dependencies.normalizedWindowsPath(...args);
  const sanitizeDiagnosticText = (...args) => dependencies.sanitizeDiagnosticText(...args);
  const violation = (...args) => dependencies.violation(...args);

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function currentFileRecordMatches(record) {
  const filePath = record?.path;
  if (!filePath || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) return false;
  const lstat = fs.lstatSync(filePath);
  if (!lstat.isFile() || lstat.isSymbolicLink() || lstat.nlink !== 1) return false;
  const stat = fs.statSync(filePath);
  return /^[A-F0-9]{64}$/.test(String(record?.sha256 || ''))
    && Number(record?.sizeBytes) === stat.size
    && sha256File(filePath) === String(record.sha256).toUpperCase();
}

function buildProtectedFileEvidence(before, after) {
  const samePath = normalizedWindowsPath(before?.path || '') === normalizedWindowsPath(after?.path || '');
  const unchanged = samePath
    && before?.sha256 === after?.sha256
    && before?.sizeBytes === after?.sizeBytes
    && before?.mtimeMs === after?.mtimeMs;
  return {
    before,
    after,
    passed: unchanged,
    unchanged,
  };
}

function lexicalWindowsPath(filePath) {
  return path.win32.normalize(String(filePath || '')).replace(/[\\/]+$/, '').toLowerCase();
}

function readWindowsFileIdentity(filePath) {
  const resolvedPath = path.resolve(filePath);
  const leaf = fs.lstatSync(resolvedPath, { bigint: true });
  if (leaf.isSymbolicLink() || !leaf.isFile()) {
    throw new Error(`Database identity target must be a real file, not a symbolic link or junction: ${resolvedPath}`);
  }
  const realPath = fs.realpathSync.native(resolvedPath);
  if (lexicalWindowsPath(realPath) !== lexicalWindowsPath(resolvedPath)) {
    throw new Error(`Database identity target may not traverse a symbolic link or junction: ${resolvedPath} -> ${realPath}`);
  }
  const stat = fs.statSync(realPath, { bigint: true });
  if (!stat.isFile()) {
    throw new Error(`Database identity target must remain a real file: ${realPath}`);
  }
  return {
    deviceId: stat.dev.toString(),
    fileId: stat.ino.toString(),
    hardLinkCount: Number(stat.nlink),
    path: realPath,
    stabilityToken: [
      stat.dev,
      stat.ino,
      stat.nlink,
      stat.size,
      stat.ctimeNs,
      stat.mtimeNs,
    ].join(':'),
  };
}

function readStableUniqueFile(filePath, label) {
  const resolvedPath = path.resolve(filePath);
  const before = fs.lstatSync(resolvedPath, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n) {
    fail(`${label} must be a unique direct regular file`, resolvedPath);
  }
  const realPath = fs.realpathSync.native(resolvedPath);
  if (lexicalWindowsPath(realPath) !== lexicalWindowsPath(resolvedPath)) {
    fail(`${label} may not traverse a symbolic link or junction`, resolvedPath);
  }
  const descriptor = fs.openSync(realPath, 'r');
  try {
    const handleBefore = fs.fstatSync(descriptor, { bigint: true });
    const buffer = fs.readFileSync(descriptor);
    const handleAfter = fs.fstatSync(descriptor, { bigint: true });
    const pathAfter = fs.lstatSync(resolvedPath, { bigint: true });
    const identity = (value) => [
      value.dev,
      value.ino,
      value.nlink,
      value.size,
      value.ctimeNs,
      value.mtimeNs,
    ].join(':');
    if (
      identity(before) !== identity(handleBefore)
      || identity(handleBefore) !== identity(handleAfter)
      || identity(handleAfter) !== identity(pathAfter)
      || buffer.length !== Number(handleAfter.size)
      || fs.realpathSync.native(resolvedPath) !== realPath
    ) {
      fail(`${label} changed while it was being read`, resolvedPath);
    }
    return {
      buffer,
      file: {
        path: realPath,
        sha256: sha256Buffer(buffer),
        sizeBytes: buffer.length,
      },
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function authorityLogicalArtifactFromSelection(evidence) {
  const logical = evidence?.selection?.selected?.logicalCapture;
  if (!logical) return null;
  return {
    method: logical.method,
    remainingPages: logical.remainingPages,
    schemaVersion: logical.schemaVersion,
    sha256: logical.logicalBackupSha256,
    sizeBytes: logical.logicalBackupSizeBytes,
    totalPages: logical.totalPages,
  };
}

function packageUiComparableAuthoritySelection(selection) {
  const comparable = JSON.parse(JSON.stringify(selection));
  const selected = comparable?.selected;
  const readOnlyShmMtimeMayChange = (
    selected?.sidecarObservation?.shmMayChangeForReadonlyWalLocking === true
    && selected?.sidecars?.shm?.exists === true
    && selected?.sidecarsBefore?.shm?.exists === true
  );
  if (readOnlyShmMtimeMayChange) {
    delete selected.sidecars.shm.mtimeMs;
    delete selected.sidecarsBefore.shm.mtimeMs;
  }
  return comparable;
}

function packageUiAuthoritySelectionsMatch(receiptSelection, currentSelection) {
  return canonicalJson(packageUiComparableAuthoritySelection(receiptSelection))
    === canonicalJson(packageUiComparableAuthoritySelection(currentSelection));
}

function validatePackageUiAuthoritySelection({
  authoritySelectionPath,
  canonicalPaths = canonicalPackageUiAuthorityPaths(),
  protectedDatabasePath,
  verifier = inspectProductionAuthoritySelection,
}) {
  if (
    lexicalWindowsPath(protectedDatabasePath)
    !== lexicalWindowsPath(canonicalPaths.databasePath)
  ) {
    fail(
      '--protected-db must resolve exactly to the Windows Known Folder authority database',
      protectedDatabasePath,
    );
  }
  const databaseIdentity = readWindowsFileIdentity(protectedDatabasePath);
  if (databaseIdentity.hardLinkCount !== 1) {
    fail('The canonical authority database must have exactly one hard link', protectedDatabasePath);
  }
  const receiptRecord = readStableUniqueFile(
    authoritySelectionPath,
    'Production authority-selection receipt',
  );
  let receipt;
  try {
    receipt = JSON.parse(receiptRecord.buffer.toString('utf8'));
  } catch {
    fail('Production authority-selection receipt is not valid JSON', authoritySelectionPath);
  }
  const expectedMainSha256 = String(
    receipt?.selection?.selected?.mainFileSha256 || '',
  ).toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(expectedMainSha256)) {
    fail('Production authority-selection receipt has no valid selected main-file hash');
  }
  const current = verifier({
    dbPath: protectedDatabasePath,
    expectedMainSha256,
    expectedUserDataDir: canonicalPaths.userDataDir,
  }, {
    env: {
      ...process.env,
      APPDATA: canonicalPaths.roamingAppData,
      USERPROFILE: canonicalPaths.userProfile,
    },
    writeStdout: () => {},
  });
  if (
    receipt?.kind !== PRODUCTION_AUTHORITY_SELECTION_KIND
    || receipt?.schemaVersion !== PRODUCTION_AUTHORITY_SELECTION_SCHEMA_VERSION
    || !['SELECTED_SCHEMA_READY', 'SELECTED_MIGRATION_REQUIRED'].includes(receipt?.status)
    || receipt.status !== current?.status
    || receipt.formalEvidence !== false
    || receipt.authorityDatabaseMutated !== false
    || receipt.adsExecutionInvoked !== false
    || !packageUiAuthoritySelectionsMatch(receipt.selection, current?.selection)
    || lexicalWindowsPath(current?.selection?.expectedDatabasePath)
      !== lexicalWindowsPath(protectedDatabasePath)
    || lexicalWindowsPath(current?.selection?.selected?.realPath)
      !== lexicalWindowsPath(protectedDatabasePath)
  ) {
    fail(
      'Production authority-selection receipt is stale or detached from the canonical authority database',
      authoritySelectionPath,
    );
  }
  const logicalArtifact = authorityLogicalArtifactFromSelection(current);
  if (
    logicalArtifact?.schemaVersion !== SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION
    || logicalArtifact?.method !== CURRENTNESS_METHOD
    || logicalArtifact?.remainingPages !== 0
    || !/^[A-F0-9]{64}$/.test(String(logicalArtifact?.sha256 || ''))
  ) {
    fail('Production authority-selection receipt did not yield a valid current logical artifact');
  }
  return {
    authorityBinding: {
      authoritySelectionReceiptSha256: receiptRecord.file.sha256,
      canonicalDatabasePathSha256: sha256Buffer(Buffer.from(
        lexicalWindowsPath(canonicalPaths.databasePath),
        'utf8',
      )),
      databaseFileIdentity: {
        deviceId: databaseIdentity.deviceId,
        fileId: databaseIdentity.fileId,
        hardLinkCount: databaseIdentity.hardLinkCount,
        stabilityTokenSha256: sha256Buffer(Buffer.from(
          databaseIdentity.stabilityToken,
          'utf8',
        )),
      },
    },
    canonicalPaths,
    logicalArtifact,
    receiptRecord,
    status: current.status,
  };
}

function absoluteHardLinkPath(filePath, outputLine) {
  const value = String(outputLine || '').trim();
  if (!value || /[\r\n\0]/.test(value)) return null;
  if (/^[a-z]:[\\/]/i.test(value)) return path.win32.normalize(value);
  if (/^[\\/]/.test(value)) {
    const drive = path.win32.parse(filePath).root.slice(0, 2);
    return path.win32.normalize(`${drive}${value}`);
  }
  return null;
}

function windowsFsutilPath() {
  const systemRoot = path.win32.normalize(String(process.env.SystemRoot || ''));
  if (!path.win32.isAbsolute(systemRoot) || systemRoot.startsWith('\\\\')) {
    throw new Error('SystemRoot does not identify a local absolute Windows directory.');
  }
  const executablePath = path.win32.join(systemRoot, 'System32', 'fsutil.exe');
  const leaf = fs.lstatSync(executablePath);
  if (leaf.isSymbolicLink() || !leaf.isFile()) {
    throw new Error(`Windows fsutil must be a real System32 executable: ${executablePath}`);
  }
  const realPath = fs.realpathSync.native(executablePath);
  if (lexicalWindowsPath(realPath) !== lexicalWindowsPath(executablePath)) {
    throw new Error(`Windows fsutil may not resolve through a symbolic link or junction: ${executablePath} -> ${realPath}`);
  }
  return realPath;
}

function enumerateWindowsHardLinks(fileIdentity, run = spawnSync) {
  let result;
  try {
    result = run(windowsFsutilPath(), ['hardlink', 'list', fileIdentity.path], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      shell: false,
      timeout: WINDOWS_HARDLINK_ENUMERATION_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`fsutil hardlink enumeration threw: ${sanitizeDiagnosticText(error?.message || error)}`);
  }
  if (
    !result
    || result.error
    || result.status !== 0
    || result.signal
  ) {
    const detail = result?.error?.message
      || result?.stderr
      || `status=${result?.status ?? 'unknown'} signal=${result?.signal ?? 'none'}`;
    throw new Error(`fsutil hardlink enumeration failed or timed out: ${sanitizeDiagnosticText(detail)}`);
  }
  const paths = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => absoluteHardLinkPath(fileIdentity.path, line))
    .filter(Boolean)
    .map(lexicalWindowsPath);
  const distinctPaths = [...new Set(paths)].sort();
  if (
    !distinctPaths.includes(lexicalWindowsPath(fileIdentity.path))
    || distinctPaths.length !== fileIdentity.hardLinkCount
  ) {
    throw new Error(
      `fsutil hardlink enumeration did not bind the queried file identity (reported=${distinctPaths.length}, nlink=${fileIdentity.hardLinkCount}).`,
    );
  }
  return distinctPaths;
}

function evaluateProfileDatabaseFileIsolation({
  profileDatabasePath,
  protectedDatabasePath,
  run = spawnSync,
}) {
  const violations = [];
  if (process.platform !== 'win32') {
    violations.push(violation(
      'PROFILE_DATABASE_FILE_IDENTITY_UNSUPPORTED',
      'Package UI database file-identity isolation is supported only on Windows.',
    ));
    return { passed: false, violations };
  }

  let profileBefore;
  let protectedBefore;
  let profileLinks;
  let protectedLinks;
  try {
    profileBefore = readWindowsFileIdentity(profileDatabasePath);
    protectedBefore = readWindowsFileIdentity(protectedDatabasePath);
    profileLinks = enumerateWindowsHardLinks(profileBefore, run);
    protectedLinks = enumerateWindowsHardLinks(protectedBefore, run);
    const profileAfter = readWindowsFileIdentity(profileDatabasePath);
    const protectedAfter = readWindowsFileIdentity(protectedDatabasePath);
    if (
      profileBefore.stabilityToken !== profileAfter.stabilityToken
      || protectedBefore.stabilityToken !== protectedAfter.stabilityToken
    ) {
      throw new Error('Database file identity changed during hardlink isolation attestation.');
    }
  } catch (error) {
    violations.push(violation(
      'PROFILE_DATABASE_FILE_IDENTITY_UNVERIFIED',
      'The profile and protected database file identities must be verified before packaged Electron starts.',
      sanitizeDiagnosticText(error?.message || error),
    ));
    return {
      passed: false,
      profileDatabase: profileBefore || null,
      protectedDatabase: protectedBefore || null,
      violations,
    };
  }

  const sameFileIdentity = profileBefore.deviceId === protectedBefore.deviceId
    && profileBefore.fileId === protectedBefore.fileId;
  const sharedHardLinkPaths = profileLinks.filter((candidate) => protectedLinks.includes(candidate));
  if (sameFileIdentity || sharedHardLinkPaths.length > 0) {
    violations.push(violation(
      'PROFILE_DATABASE_HARDLINK_ALIAS',
      'The isolated profile database must not be the protected authority database through a hardlink alias.',
      {
        sameFileIdentity,
        sharedHardLinkCount: sharedHardLinkPaths.length,
      },
    ));
  }
  return {
    passed: violations.length === 0,
    profileDatabase: {
      deviceId: profileBefore.deviceId,
      fileId: profileBefore.fileId,
      hardLinkCount: profileBefore.hardLinkCount,
      path: profileBefore.path,
    },
    protectedDatabase: {
      deviceId: protectedBefore.deviceId,
      fileId: protectedBefore.fileId,
      hardLinkCount: protectedBefore.hardLinkCount,
      path: protectedBefore.path,
    },
    sameFileIdentity,
    sharedHardLinkCount: sharedHardLinkPaths.length,
    violations,
  };
}

function evaluateProfileDatabaseProvenance({ profileDatabase, protectedDatabase }) {
  const hashMatches = Boolean(
    profileDatabase?.sha256
    && protectedDatabase?.sha256
    && String(profileDatabase.sha256).toUpperCase() === String(protectedDatabase.sha256).toUpperCase(),
  );
  const sizeMatches = Number.isFinite(Number(profileDatabase?.sizeBytes))
    && Number(profileDatabase.sizeBytes) === Number(protectedDatabase?.sizeBytes);
  const pathsDistinct = Boolean(
    profileDatabase?.path
    && protectedDatabase?.path
    && normalizedWindowsPath(profileDatabase.path) !== normalizedWindowsPath(protectedDatabase.path),
  );
  const violations = [];
  if (!hashMatches) {
    violations.push(violation(
      'PROFILE_DATABASE_HASH_MISMATCH',
      'The isolated profile database must begin with the protected authority database SHA-256.',
      { profile: profileDatabase?.sha256 || null, protected: protectedDatabase?.sha256 || null },
    ));
  }
  if (!sizeMatches) {
    violations.push(violation(
      'PROFILE_DATABASE_SIZE_MISMATCH',
      'The isolated profile database must begin with the protected authority database size.',
      { profile: profileDatabase?.sizeBytes ?? null, protected: protectedDatabase?.sizeBytes ?? null },
    ));
  }
  if (!pathsDistinct) {
    violations.push(violation(
      'PROFILE_DATABASE_NOT_ISOLATED',
      'The package UI profile database must be a distinct copy, never the protected authority file itself.',
      { profile: profileDatabase?.path || null, protected: protectedDatabase?.path || null },
    ));
  }
  return {
    hashMatches,
    passed: violations.length === 0,
    pathsDistinct,
    profileDatabase,
    protectedDatabase,
    sizeMatches,
    violations,
  };
}

  return {
    sha256Buffer,
    sha256File,
    currentFileRecordMatches,
    buildProtectedFileEvidence,
    lexicalWindowsPath,
    readWindowsFileIdentity,
    readStableUniqueFile,
    authorityLogicalArtifactFromSelection,
    packageUiComparableAuthoritySelection,
    packageUiAuthoritySelectionsMatch,
    validatePackageUiAuthoritySelection,
    absoluteHardLinkPath,
    windowsFsutilPath,
    enumerateWindowsHardLinks,
    evaluateProfileDatabaseFileIsolation,
    evaluateProfileDatabaseProvenance,
  };
};
