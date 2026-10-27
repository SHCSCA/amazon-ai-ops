// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    CURRENTNESS_METHOD,
    PACKAGE_UI_SQLITE_TEMP_ROOT_PREFIX,
    SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
    cleanupOwnedSqliteTempRoot,
    crypto,
    fs,
    os,
    path,
    restrictWindowsTempAcl,
    runReadonlySqliteOnlineBackupSync,
    spawnSync,
  } = dependencies;
  const fail = (...args) => dependencies.fail(...args);
  const isPathWithin = (...args) => dependencies.isPathWithin(...args);
  const safeRealPath = (...args) => dependencies.safeRealPath(...args);
  const safeSegment = (...args) => dependencies.safeSegment(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);

function artifactInfo(filePath) {
  if (!fs.existsSync(filePath)) {
    fail('Required packaged artifact is missing', filePath);
  }
  const before = fs.lstatSync(filePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    fail('Required packaged artifact must be a real file, not a symbolic link or junction', filePath);
  }
  const buffer = fs.readFileSync(filePath);
  const after = fs.lstatSync(filePath);
  if (
    before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || before.ctimeMs !== after.ctimeMs
    || buffer.length !== after.size
  ) {
    fail('Required packaged artifact changed while it was being hashed', filePath);
  }
  return {
    path: safeRealPath(filePath),
    sha256: sha256Buffer(buffer),
    sizeBytes: buffer.length,
    mtime: after.mtime.toISOString(),
    mtimeMs: after.mtimeMs,
  };
}

function logicalSqliteArtifactMatches(left, right) {
  return Boolean(
    left?.schemaVersion === SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION
    && right?.schemaVersion === SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION
    && left?.method === CURRENTNESS_METHOD
    && right?.method === CURRENTNESS_METHOD
    && /^[A-F0-9]{64}$/.test(String(left?.sha256 || ''))
    && left.sha256 === right.sha256
    && Number.isInteger(left?.sizeBytes)
    && left.sizeBytes > 0
    && left.sizeBytes === right.sizeBytes
  );
}

function captureSqliteLogicalArtifact(
  databasePath,
  label = 'package-ui-sqlite',
  injected = {},
) {
  const tempBase = fs.realpathSync.native(path.resolve(
    injected.tempParent || os.tmpdir(),
  ));
  const tempRoot = fs.mkdtempSync(
    path.join(
      tempBase,
      `${PACKAGE_UI_SQLITE_TEMP_ROOT_PREFIX}${safeSegment(label)}-`,
    ),
  );
  const destinationPath = path.join(tempRoot, 'logical-online-backup.db');
  try {
    restrictWindowsTempAcl(tempRoot, {
      spawnSync: injected.spawnSync || spawnSync,
    });
    const backupRunner = injected.runReadonlySqliteOnlineBackupSync
      || runReadonlySqliteOnlineBackupSync;
    const proof = backupRunner({
      destinationPath,
      ownedTempRoot: tempRoot,
      sourceDatabasePath: path.resolve(databasePath),
    });
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
      tempBase,
      tempRoot,
      PACKAGE_UI_SQLITE_TEMP_ROOT_PREFIX,
      injected,
    );
  }
}

function collectProfileContentManifest(profileRoot) {
  const rootPath = fs.realpathSync.native(path.resolve(profileRoot));
  const rootStat = fs.lstatSync(rootPath);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail('Package UI profile root must be a real directory', rootPath);
  }
  const records = [];
  const queue = [rootPath];
  while (queue.length > 0) {
    const directory = queue.pop();
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      const lstat = fs.lstatSync(candidate);
      if (lstat.isSymbolicLink()) {
        fail('Package UI profile lineage may not traverse a symlink or junction', candidate);
      }
      if (lstat.isDirectory()) {
        queue.push(candidate);
        continue;
      }
      if (!lstat.isFile()) {
        fail('Package UI profile lineage contains an unsupported filesystem entry', candidate);
      }
      const realPath = fs.realpathSync.native(candidate);
      if (!isPathWithin(rootPath, realPath)) {
        fail('Package UI profile lineage escaped the isolated profile root', candidate);
      }
      const relativePath = path.relative(rootPath, realPath).split(path.sep).join('/');
      const buffer = fs.readFileSync(realPath);
      const after = fs.lstatSync(realPath);
      if (after.size !== lstat.size || after.mtimeMs !== lstat.mtimeMs || buffer.length !== after.size) {
        fail('Package UI profile changed while its lineage hash was being captured', candidate);
      }
      records.push({
        relativePath,
        sha256: sha256Buffer(buffer),
        sizeBytes: buffer.length,
      });
    }
  }
  records.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
  const digest = crypto.createHash('sha256');
  let sizeBytes = 0;
  for (const record of records) {
    digest.update(record.relativePath, 'utf8');
    digest.update('\0');
    digest.update(record.sha256, 'ascii');
    digest.update('\0');
    digest.update(String(record.sizeBytes), 'ascii');
    digest.update('\n');
    sizeBytes += record.sizeBytes;
  }
  return {
    fileCount: records.length,
    sha256: digest.digest('hex').toUpperCase(),
    sizeBytes,
  };
}

function captureProfileLineageState(userDataDir, databasePath, label) {
  return {
    capturedAt: new Date().toISOString(),
    logicalDatabase: captureSqliteLogicalArtifact(databasePath, `${label}-db`),
    profileContent: collectProfileContentManifest(userDataDir),
  };
}

function profileLineageStateMatches(left, right) {
  return logicalSqliteArtifactMatches(left?.logicalDatabase, right?.logicalDatabase)
    && /^[A-F0-9]{64}$/.test(String(left?.profileContent?.sha256 || ''))
    && left.profileContent.sha256 === right?.profileContent?.sha256
    && Number.isInteger(left?.profileContent?.fileCount)
    && left.profileContent.fileCount === right?.profileContent?.fileCount
    && Number.isInteger(left?.profileContent?.sizeBytes)
    && left.profileContent.sizeBytes === right?.profileContent?.sizeBytes;
}

  return {
    artifactInfo,
    logicalSqliteArtifactMatches,
    captureSqliteLogicalArtifact,
    collectProfileContentManifest,
    captureProfileLineageState,
    profileLineageStateMatches,
  };
};
