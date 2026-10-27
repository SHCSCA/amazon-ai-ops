module.exports = function createInspectorModule(dependencies) {
  const {
    CURRENTNESS_METHOD,
    SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
    TEMP_ROOT_PREFIX,
    cleanupOwnedSqliteTempRoot,
    fs,
    os,
    path,
    restrictWindowsTempAcl,
    runReadonlySqliteOnlineBackupSync,
    spawnSync,
  } = dependencies;
  const canonicalJson = (...args) => dependencies.canonicalJson(...args);
  const fail = (...args) => dependencies.fail(...args);
  const hasOnlyKeys = (...args) => dependencies.hasOnlyKeys(...args);
  const lexicalWindowsPath = (...args) => dependencies.lexicalWindowsPath(...args);
  const safeDirectory = (...args) => dependencies.safeDirectory(...args);
  const safeFileArtifact = (...args) => dependencies.safeFileArtifact(...args);
  const samePath = (...args) => dependencies.samePath(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);
  const sqliteSourceBundle = (...args) => dependencies.sqliteSourceBundle(...args);
  const validIsoDate = (...args) => dependencies.validIsoDate(...args);

function sqliteLogicalArtifact(databasePath, label = 'package-ui-inspector', injected = {}) {
  const tempParent = safeDirectory(
    injected.tempParent || os.tmpdir(),
    'OS temporary directory',
    'PROTECTED_DB_CAPTURE_INVALID',
  );
  const tempRoot = fs.mkdtempSync(path.join(tempParent, TEMP_ROOT_PREFIX), { encoding: 'utf8' });
  const directRoot = safeDirectory(tempRoot, 'SQLite temporary root', 'PROTECTED_DB_CAPTURE_INVALID');
  if (!samePath(path.dirname(directRoot), tempParent) || !path.basename(directRoot).startsWith(TEMP_ROOT_PREFIX)) {
    fail('PROTECTED_DB_CAPTURE_INVALID', 'SQLite temporary root escaped the validated OS temp parent.');
  }
  const sourceCopyPath = path.join(tempRoot, 'source.db');
  const destinationPath = path.join(tempRoot, 'logical-online-backup.db');
  try {
    restrictWindowsTempAcl(directRoot, {
      spawnSync: injected.spawnSync || spawnSync,
    });
    const sourceBefore = sqliteSourceBundle(databasePath);
    for (const entry of sourceBefore.entries) {
      fs.writeFileSync(`${sourceCopyPath}${entry.suffix}`, entry.buffer, { flag: 'wx', mode: 0o600 });
    }
    const sourceAfterCopy = sqliteSourceBundle(databasePath);
    if (canonicalJson(sourceBefore.signature) !== canonicalJson(sourceAfterCopy.signature)) {
      fail('PROTECTED_DB_CAPTURE_INVALID', 'SQLite source database changed while its read-only snapshot was copied.');
    }
    const backupRunner = injected.runReadonlySqliteOnlineBackupSync || runReadonlySqliteOnlineBackupSync;
    const proof = backupRunner({
      destinationPath,
      ownedTempRoot: directRoot,
      sourceDatabasePath: sourceCopyPath,
    });
    const backup = safeFileArtifact(destinationPath, 'SQLite online-backup result', 'PROTECTED_DB_CAPTURE_INVALID');
    if (
      backup.sha256 !== proof.observedBackup.sha256
      || backup.sizeBytes !== proof.observedBackup.sizeBytes
    ) {
      fail('PROTECTED_DB_CAPTURE_INVALID', 'SQLite online-backup result changed before inspection.');
    }
    return {
      method: proof.method,
      remainingPages: proof.observedBackup.remainingPages,
      schemaVersion: proof.schemaVersion,
      sha256: proof.observedBackup.sha256,
      sizeBytes: proof.observedBackup.sizeBytes,
      totalPages: proof.observedBackup.totalPages,
    };
  } finally {
    cleanupOwnedSqliteTempRoot(
      tempParent,
      directRoot,
      TEMP_ROOT_PREFIX,
      injected,
    );
  }
}

function validLogicalArtifact(value) {
  return hasOnlyKeys(value, ['method', 'remainingPages', 'schemaVersion', 'sha256', 'sizeBytes', 'totalPages'])
    && value.schemaVersion === SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION
    && value.method === CURRENTNESS_METHOD
    && value.remainingPages === 0
    && Number.isInteger(value.totalPages)
    && value.totalPages > 0
    && /^[A-F0-9]{64}$/.test(String(value.sha256 || ''))
    && Number.isInteger(value.sizeBytes)
    && value.sizeBytes > 0;
}

function validAuthorityBinding(value) {
  return hasOnlyKeys(value, [
    'authoritySelectionReceiptSha256',
    'canonicalDatabasePathSha256',
    'databaseFileIdentity',
  ])
    && /^[A-F0-9]{64}$/.test(String(value.authoritySelectionReceiptSha256 || ''))
    && /^[A-F0-9]{64}$/.test(String(value.canonicalDatabasePathSha256 || ''))
    && hasOnlyKeys(value.databaseFileIdentity, [
      'deviceId',
      'fileId',
      'hardLinkCount',
      'stabilityTokenSha256',
    ])
    && typeof value.databaseFileIdentity.deviceId === 'string'
    && value.databaseFileIdentity.deviceId.length > 0
    && typeof value.databaseFileIdentity.fileId === 'string'
    && value.databaseFileIdentity.fileId.length > 0
    && value.databaseFileIdentity.hardLinkCount === 1
    && /^[A-F0-9]{64}$/.test(
      String(value.databaseFileIdentity.stabilityTokenSha256 || ''),
    );
}

function currentAuthorityBinding(databasePath, receiptSha256, canonicalDatabasePath) {
  const resolved = path.resolve(databasePath);
  const stat = fs.statSync(resolved, { bigint: true });
  const stabilityToken = [
    stat.dev,
    stat.ino,
    stat.nlink,
    stat.size,
    stat.ctimeNs,
    stat.mtimeNs,
  ].join(':');
  return {
    authoritySelectionReceiptSha256: receiptSha256,
    canonicalDatabasePathSha256: sha256Buffer(Buffer.from(
      lexicalWindowsPath(canonicalDatabasePath),
      'utf8',
    )),
    databaseFileIdentity: {
      deviceId: stat.dev.toString(),
      fileId: stat.ino.toString(),
      hardLinkCount: Number(stat.nlink),
      stabilityTokenSha256: sha256Buffer(Buffer.from(stabilityToken, 'utf8')),
    },
  };
}

function validProfileState(value) {
  return hasOnlyKeys(value, ['capturedAt', 'logicalDatabase', 'profileContent'])
    && validIsoDate(value.capturedAt)
    && validLogicalArtifact(value.logicalDatabase)
    && hasOnlyKeys(value.profileContent, ['fileCount', 'sha256', 'sizeBytes'])
    && Number.isInteger(value.profileContent.fileCount)
    && value.profileContent.fileCount > 0
    && /^[A-F0-9]{64}$/.test(String(value.profileContent.sha256 || ''))
    && Number.isInteger(value.profileContent.sizeBytes)
    && value.profileContent.sizeBytes > 0;
}

function stateMatches(left, right) {
  return validProfileState(left)
    && validProfileState(right)
    && logicalMatches(left.logicalDatabase, right.logicalDatabase)
    && left.profileContent.sha256 === right.profileContent.sha256
    && left.profileContent.fileCount === right.profileContent.fileCount
    && left.profileContent.sizeBytes === right.profileContent.sizeBytes;
}

function logicalMatches(left, right) {
  return validLogicalArtifact(left)
    && validLogicalArtifact(right)
    && left.sha256 === right.sha256
    && left.sizeBytes === right.sizeBytes
    && left.totalPages === right.totalPages
    && left.remainingPages === right.remainingPages;
}

  return {
    sqliteLogicalArtifact,
    validLogicalArtifact,
    validAuthorityBinding,
    currentAuthorityBinding,
    validProfileState,
    stateMatches,
    logicalMatches,
  };
};
