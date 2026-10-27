// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    DEFAULT_APP_CONTENT_PATH,
    DEFAULT_EXECUTABLE_PATH,
    DESKTOP_PACKAGE,
    REQUIRED_APP_CONTENT_ENTRIES,
    ROOT,
    fs,
    path,
  } = dependencies;
  const artifactInfo = (...args) => dependencies.artifactInfo(...args);
  const fail = (...args) => dependencies.fail(...args);
  const isPathWithin = (...args) => dependencies.isPathWithin(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);
  const stableFileRecord = (...args) => dependencies.stableFileRecord(...args);
  const violation = (...args) => dependencies.violation(...args);

function buildProductionBuildContentManifest(distPath) {
  const resolvedRoot = path.resolve(distPath);
  if (!fs.existsSync(resolvedRoot)) fail('Required desktop production-build directory is missing', resolvedRoot);
  const rootStat = fs.lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail('Desktop production-build directory must be a real directory, not a symbolic link or junction', resolvedRoot);
  }
  const rootPath = fs.realpathSync.native(resolvedRoot);
  if (resolvedRoot.replace(/\\/g, '/').toLowerCase() !== rootPath.replace(/\\/g, '/').toLowerCase()) {
    fail('Desktop production-build directory resolves through a symbolic link or junction', `${resolvedRoot} -> ${rootPath}`);
  }
  const files = [];
  const mtimes = [];
  const addFile = (filePath) => {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail('Desktop production-build payload may contain only real files', filePath);
    }
    const realPath = fs.realpathSync.native(filePath);
    if (!isPathWithin(rootPath, realPath)) fail('Desktop production-build payload escapes its fixed dist directory', filePath);
    files.push(stableFileRecord(rootPath, filePath));
    mtimes.push(stat.mtimeMs);
  };
  const fixedRuntimeEntries = [
    'main/index.cjs',
    'main/index.js',
    'preload/index.cjs',
    'preload/index.js',
  ];
  for (const relativePath of fixedRuntimeEntries) {
    const filePath = path.join(rootPath, ...relativePath.split('/'));
    if (!fs.existsSync(filePath)) fail('Required desktop production-build entry is missing', relativePath);
    addFile(filePath);
  }
  const rendererRoot = path.join(rootPath, 'renderer');
  if (!fs.existsSync(rendererRoot) || !fs.lstatSync(rendererRoot).isDirectory()) {
    fail('Required desktop renderer production-build directory is missing', 'renderer');
  }
  const visitRenderer = (directoryPath) => {
    for (const name of fs.readdirSync(directoryPath).sort()) {
      const targetPath = path.join(directoryPath, name);
      const stat = fs.lstatSync(targetPath);
      if (stat.isSymbolicLink()) fail('Desktop renderer production-build may not contain symbolic links or junctions', targetPath);
      const realPath = fs.realpathSync.native(targetPath);
      if (!isPathWithin(rootPath, realPath)) fail('Desktop renderer production-build escapes its fixed dist directory', targetPath);
      if (stat.isDirectory()) {
        visitRenderer(realPath);
      } else if (!name.endsWith('.map')) {
        addFile(targetPath);
      }
    }
  };
  visitRenderer(rendererRoot);
  if (!files.some((file) => file.path === 'renderer/index.html')) {
    fail('Required desktop production-build entry is missing', 'renderer/index.html');
  }
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const canonical = JSON.stringify({ schemaVersion: 1, files });
  return {
    kind: 'desktop-production-build-content-manifest',
    schemaVersion: 1,
    rootPath,
    fileCount: files.length,
    totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    oldestMtimeMs: Math.min(...mtimes),
    newestMtimeMs: Math.max(...mtimes),
    files,
    sha256: sha256Buffer(Buffer.from(canonical, 'utf8')),
  };
}

function buildAppContentManifest(appContentPath) {
  const resolvedRoot = path.resolve(appContentPath);
  if (!fs.existsSync(resolvedRoot)) fail('Required packaged app-content directory is missing', resolvedRoot);
  const rootStat = fs.lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink()) {
    fail('Fixed packaged app-content directory may not be a symbolic link or junction', resolvedRoot);
  }
  if (!rootStat.isDirectory()) fail('Required packaged app-content path is not a directory', resolvedRoot);
  const rootPath = fs.realpathSync.native(resolvedRoot);
  const requestedRootIdentity = resolvedRoot.replace(/\\/g, '/').toLowerCase();
  const realRootIdentity = rootPath.replace(/\\/g, '/').toLowerCase();
  if (requestedRootIdentity !== realRootIdentity) {
    fail('Fixed packaged app-content path resolves through a symbolic link or junction', `${resolvedRoot} -> ${rootPath}`);
  }
  for (const relativePath of REQUIRED_APP_CONTENT_ENTRIES) {
    const entryPath = path.join(rootPath, ...relativePath.split('/'));
    if (!fs.existsSync(entryPath) || !fs.lstatSync(entryPath).isFile()) {
      fail('Required packaged runtime entry is missing', relativePath);
    }
  }
  let packageMetadata;
  try {
    packageMetadata = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf8'));
  } catch (error) {
    fail('Packaged app package.json is not valid JSON', String(error?.message || error));
  }
  const packageMain = String(packageMetadata?.main || '').replace(/\\/g, '/');
  if (
    !packageMain
    || path.posix.isAbsolute(packageMain)
    || path.win32.isAbsolute(packageMain)
    || packageMain.split('/').some((segment) => segment === '..')
  ) {
    fail('package.json main must be a safe relative path inside resources/app', packageMain || '<missing>');
  }
  const mainPath = path.resolve(rootPath, ...packageMain.split('/'));
  if (!isPathWithin(rootPath, mainPath) || !fs.existsSync(mainPath) || !fs.lstatSync(mainPath).isFile()) {
    fail('package.json main does not resolve to a packaged runtime file', packageMain);
  }
  if (
    String(packageMetadata?.name || '') !== String(DESKTOP_PACKAGE.name || '')
    || String(packageMetadata?.version || '') !== String(DESKTOP_PACKAGE.version || '')
    || packageMain !== String(DESKTOP_PACKAGE.main || '').replace(/\\/g, '/')
  ) {
    fail('Packaged app package.json metadata does not match the expected desktop package', JSON.stringify({
      actual: { main: packageMain, name: packageMetadata?.name, version: packageMetadata?.version },
      expected: { main: DESKTOP_PACKAGE.main, name: DESKTOP_PACKAGE.name, version: DESKTOP_PACKAGE.version },
    }));
  }
  const files = [];
  const visit = (directoryPath) => {
    for (const name of fs.readdirSync(directoryPath).sort((left, right) => left.localeCompare(right, 'en'))) {
      const targetPath = path.join(directoryPath, name);
      const stat = fs.lstatSync(targetPath);
      if (stat.isSymbolicLink()) {
        fail('Packaged app content may not contain symbolic links or junctions', targetPath);
      }
      const realPath = fs.realpathSync.native(targetPath);
      if (!isPathWithin(rootPath, realPath)) {
        fail('Packaged app content escapes the fixed resources/app directory', targetPath);
      }
      if (stat.isDirectory()) {
        visit(realPath);
      } else {
        files.push(stableFileRecord(rootPath, targetPath));
      }
    }
  };
  visit(rootPath);
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const canonical = JSON.stringify({ schemaVersion: 1, files });
  return {
    kind: 'unpacked-app-content-manifest',
    schemaVersion: 1,
    rootPath,
    fileCount: files.length,
    totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    package: {
      main: packageMain,
      name: String(packageMetadata?.name || ''),
      version: String(packageMetadata?.version || ''),
    },
    files,
    sha256: sha256Buffer(Buffer.from(canonical, 'utf8')),
  };
}

function collectFixedPackageHashes() {
  const executable = artifactInfo(DEFAULT_EXECUTABLE_PATH);
  const appContent = buildAppContentManifest(DEFAULT_APP_CONTENT_PATH);
  const executableAfter = artifactInfo(DEFAULT_EXECUTABLE_PATH);
  const appContentAfter = buildAppContentManifest(DEFAULT_APP_CONTENT_PATH);
  if (executable.sha256 !== executableAfter.sha256 || appContent.sha256 !== appContentAfter.sha256) {
    fail('Fixed package artifacts changed during hash preflight. Rebuild or stop writers, then retry.');
  }
  return {
    kind: 'package-ui-hash-preflight',
    executablePath: executable.path,
    exeSha256: executable.sha256,
    exeSizeBytes: executable.sizeBytes,
    appContentPath: appContent.rootPath,
    appContentSha256: appContent.sha256,
    appContentFileCount: appContent.fileCount,
    appContentSizeBytes: appContent.totalSizeBytes,
  };
}

function latestProductionSourceWatermark(sourceRoots) {
  const roots = sourceRoots || [
    path.join(ROOT, 'apps', 'desktop', 'src'),
    path.join(ROOT, 'packages'),
  ];
  const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.json']);
  const excludedDirectories = new Set([
    '__snapshots__',
    '__tests__',
    'coverage',
    'dist',
    'fixtures',
    'linux-unpacked',
    'node_modules',
    'output',
    'release',
    'test',
    'tests',
    'win-unpacked',
  ]);
  const isTestFile = (name) => /(?:^|[._-])(spec|stories|test)(?:[._-]|$)/i.test(name);
  let latest = { path: null, mtimeMs: 0, mtime: null };
  const visit = (target) => {
    if (!fs.existsSync(target)) return;
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target)) {
        if (excludedDirectories.has(name.toLowerCase())) continue;
        visit(path.join(target, name));
      }
      return;
    }
    if (isTestFile(path.basename(target))) return;
    if (!extensions.has(path.extname(target).toLowerCase())) return;
    if (stat.mtimeMs > latest.mtimeMs) {
      latest = { path: target, mtimeMs: stat.mtimeMs, mtime: stat.mtime.toISOString() };
    }
  };
  roots.forEach(visit);
  return latest;
}

function validatePackageFreshness({ buildContent, packagedDistContent, sourceWatermark }) {
  const toleranceMs = 2_000;
  const violations = [];
  if (!sourceWatermark?.path) {
    return { passed: false, violations: [violation('SOURCE_WATERMARK_MISSING', 'Could not determine the newest packaged source file.')] };
  }
  if (!buildContent || !Number.isFinite(buildContent.oldestMtimeMs)) {
    violations.push(violation('BUILD_ARTIFACTS_MISSING', 'Could not determine the current desktop build artifacts.'));
  } else if (buildContent.oldestMtimeMs + toleranceMs < sourceWatermark.mtimeMs) {
    violations.push(violation('CURRENT_BUILD_STALE', 'Current desktop build artifacts are older than source and must be rebuilt.', {
      build: buildContent,
      newestSource: sourceWatermark,
    }));
  }
  if (!buildContent?.sha256 || !packagedDistContent?.sha256) {
    violations.push(violation('BUILD_CONTENT_HASH_MISSING', 'Current and packaged dist content hashes are required.'));
  } else if (String(buildContent.sha256).toUpperCase() !== String(packagedDistContent.sha256).toUpperCase()) {
    violations.push(violation('PACKAGED_DIST_MISMATCH', 'Packaged dist content is not byte-identical to the current desktop build.', {
      currentBuildSha256: buildContent.sha256,
      packagedDistSha256: packagedDistContent.sha256,
    }));
  }
  return { passed: violations.length === 0, violations };
}

  return {
    buildProductionBuildContentManifest,
    buildAppContentManifest,
    collectFixedPackageHashes,
    latestProductionSourceWatermark,
    validatePackageFreshness,
  };
};
