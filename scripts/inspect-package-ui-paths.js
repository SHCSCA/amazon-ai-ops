module.exports = function createInspectorModule(dependencies) {
  const {
    InspectionError,
    PACKAGED_APP_NAME,
    crypto,
    fs,
    path,
    spawnSync,
  } = dependencies;

  let cachedDefaultProtectedDatabasePath = null;

function fail(code, message) {
  throw new InspectionError(code, message);
}

function resolveWindowsKnownFolder(specialFolder, label, run = spawnSync) {
  if (process.platform !== 'win32') {
    throw new Error('Production authority resolution is supported only on Windows.');
  }
  const allowed = new Set(['ApplicationData', 'UserProfile']);
  if (!allowed.has(specialFolder)) {
    throw new Error('Unsupported Windows Known Folder request.');
  }
  const result = run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `[Environment]::GetFolderPath([Environment+SpecialFolder]::${specialFolder})`,
  ], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: 20_000,
    windowsHide: true,
  });
  const value = String(result?.stdout || '').trim();
  if (result?.error || result?.status !== 0 || result?.signal || !path.isAbsolute(value)) {
    throw new Error(`Windows Known Folder lookup for ${label} failed.`);
  }
  return path.resolve(value);
}

function canonicalAuthorityPaths(injected = {}) {
  const resolveKnownFolder = injected.resolveWindowsKnownFolder || resolveWindowsKnownFolder;
  const roamingAppData = resolveKnownFolder('ApplicationData', 'Roaming AppData');
  const userProfile = resolveKnownFolder('UserProfile', 'User Profile');
  const userDataDir = path.join(roamingAppData, ...PACKAGED_APP_NAME.split('/'));
  return {
    databasePath: path.join(userDataDir, 'amazon-ai-ops.db'),
    roamingAppData,
    userDataDir,
    userProfile,
  };
}

function defaultProtectedDatabasePath() {
  if (process.platform !== 'win32') return '';
  cachedDefaultProtectedDatabasePath ||= canonicalAuthorityPaths().databasePath;
  return cachedDefaultProtectedDatabasePath;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function normalizedPath(value) {
  return path.resolve(value).replace(/\\/g, '/').toLowerCase();
}

function lexicalWindowsPath(value) {
  return path.win32.normalize(String(value || '')).replace(/[\\/]+$/, '').toLowerCase();
}

function samePath(left, right) {
  return normalizedPath(left) === normalizedPath(right);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function hasOnlyKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validIsoDate(value) {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function statIdentityMatches(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function stableFileRead(filePath, label, code = 'RECORD_ROOT_INVALID') {
  const requested = path.resolve(filePath);
  let beforePath;
  let realBefore;
  let descriptor;
  try {
    beforePath = fs.lstatSync(requested);
    if (beforePath.isSymbolicLink() || !beforePath.isFile() || beforePath.nlink !== 1) {
      fail(code, `${label} must be a unique, direct regular file.`);
    }
    realBefore = fs.realpathSync.native(requested);
    if (!samePath(realBefore, requested)) fail(code, `${label} may not traverse a link.`);
    descriptor = fs.openSync(realBefore, 'r');
    const beforeHandle = fs.fstatSync(descriptor);
    if (!statIdentityMatches(beforePath, beforeHandle)) fail(code, `${label} identity changed before reading.`);
    const buffer = fs.readFileSync(descriptor);
    const afterHandle = fs.fstatSync(descriptor);
    const afterPath = fs.lstatSync(requested);
    const realAfter = fs.realpathSync.native(requested);
    if (
      afterPath.isSymbolicLink()
      || !afterPath.isFile()
      || afterPath.nlink !== 1
      || !samePath(realBefore, realAfter)
      || !statIdentityMatches(beforeHandle, afterHandle)
      || !statIdentityMatches(afterHandle, afterPath)
      || buffer.length !== afterHandle.size
    ) {
      fail(code, `${label} changed while being read.`);
    }
    return {
      buffer,
      file: {
        mtime: afterPath.mtime.toISOString(),
        mtimeMs: afterPath.mtimeMs,
        path: realAfter,
        sha256: sha256Buffer(buffer),
        sizeBytes: buffer.length,
      },
      stat: afterPath,
    };
  } catch (error) {
    if (error instanceof InspectionError) throw error;
    fail(code, `${label} is missing, unreadable, or unstable.`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function safeFileArtifact(filePath, label, code) {
  const { file } = stableFileRead(filePath, label, code);
  return file;
}

function safeDirectory(directoryPath, label, code = 'RECORD_ROOT_INVALID') {
  const requested = path.resolve(directoryPath);
  try {
    const stat = fs.lstatSync(requested);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail(code, `${label} must be a direct directory.`);
    const real = fs.realpathSync.native(requested);
    if (!samePath(real, requested)) fail(code, `${label} may not traverse a link.`);
    return real;
  } catch (error) {
    if (error instanceof InspectionError) throw error;
    fail(code, `${label} is missing, unreadable, or unstable.`);
  }
}

function directoryTreeManifest(directoryPath, label, code = 'RECORD_ROOT_INVALID') {
  const root = safeDirectory(directoryPath, label, code);
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const candidate = path.join(directory, entry.name);
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) fail(code, `${label} contains a symbolic link or junction.`);
      const real = fs.realpathSync.native(candidate);
      if (!isWithin(root, real)) fail(code, `${label} escaped its root.`);
      if (stat.isDirectory()) visit(real);
      else if (stat.isFile() && stat.nlink === 1) {
        const artifact = safeFileArtifact(candidate, `${label} file`, code);
        files.push({
          path: path.relative(root, real).split(path.sep).join('/'),
          sha256: artifact.sha256,
          sizeBytes: artifact.sizeBytes,
        });
      } else fail(code, `${label} contains an unsupported or hard-linked entry.`);
    }
  };
  visit(root);
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return {
    fileCount: files.length,
    files,
    sha256: sha256Buffer(Buffer.from(canonicalJson({ files, schemaVersion: 1 }), 'utf8')),
    sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
  };
}

function appContentManifest(appContentPath) {
  const root = safeDirectory(appContentPath, 'App content', 'PACKAGE_APP_CONTENT_INVALID');
  const manifest = directoryTreeManifest(root, 'App content', 'PACKAGE_APP_CONTENT_INVALID');
  return {
    root,
    sha256: sha256Buffer(Buffer.from(JSON.stringify({
      schemaVersion: 1,
      files: manifest.files,
    }), 'utf8')),
    files: manifest.files,
  };
}

function profileManifest(profilePath) {
  const manifest = directoryTreeManifest(profilePath, 'Isolated profile', 'PROFILE_CONTENT_INVALID');
  return {
    fileCount: manifest.fileCount,
    sha256: (() => {
      const digest = crypto.createHash('sha256');
      for (const record of manifest.files) {
        digest.update(record.path, 'utf8');
        digest.update('\0');
        digest.update(record.sha256, 'ascii');
        digest.update('\0');
        digest.update(String(record.sizeBytes), 'ascii');
        digest.update('\n');
      }
      return digest.digest('hex').toUpperCase();
    })(),
    sizeBytes: manifest.sizeBytes,
  };
}

function sqliteSourceBundle(databasePath) {
  const database = stableFileRead(databasePath, 'SQLite source database', 'PROTECTED_DB_CAPTURE_INVALID');
  const entries = [{ buffer: database.buffer, suffix: '' }];
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const candidate = `${database.file.path}${suffix}`;
    if (!fs.existsSync(candidate)) continue;
    const sidecar = stableFileRead(candidate, 'SQLite source sidecar', 'PROTECTED_DB_CAPTURE_INVALID');
    entries.push({ buffer: sidecar.buffer, suffix });
  }
  return {
    entries,
    signature: entries.map((entry) => ({
      sha256: sha256Buffer(entry.buffer),
      sizeBytes: entry.buffer.length,
      suffix: entry.suffix,
    })),
  };
}

  return {
    fail,
    resolveWindowsKnownFolder,
    canonicalAuthorityPaths,
    defaultProtectedDatabasePath,
    canonicalJson,
    sha256Buffer,
    normalizedPath,
    lexicalWindowsPath,
    samePath,
    isWithin,
    hasOnlyKeys,
    validIsoDate,
    statIdentityMatches,
    stableFileRead,
    safeFileArtifact,
    safeDirectory,
    directoryTreeManifest,
    appContentManifest,
    profileManifest,
    sqliteSourceBundle,
  };
};
