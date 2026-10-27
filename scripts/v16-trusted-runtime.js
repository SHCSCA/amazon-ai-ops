const fs = require('node:fs');
const path = require('node:path');
const { insist, readArtifact, hashEqual, digest } = require('./v16-native-artifacts');

// 可信环境只能由 Main 闭包传入；待验 JSON 中的同名字段不参与选择原件和源码。
function artifactRoots(environment) {
  if (environment == null) return [];
  insist(typeof environment.currentPackage === 'function' && Array.isArray(environment.artifactRoots) && environment.artifactRoots.length > 0, 'TRUSTED_NATIVE_ENVIRONMENT_INVALID');
  return environment.artifactRoots.map(directory => {
    insist(typeof directory === 'string' && path.isAbsolute(directory), 'TRUSTED_ARTIFACT_ROOT_INVALID');
    const resolved = path.resolve(directory), stat = fs.lstatSync(resolved);
    insist(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync.native(resolved).toLowerCase() === resolved.toLowerCase(), 'TRUSTED_ARTIFACT_ROOT_NOT_DIRECT');
    return resolved;
  });
}
function providedPackage(root, identity, environment) {
  const current = environment.currentPackage();
  insist(typeof environment.packageUiContract === 'function', 'TRUSTED_PACKAGE_UI_CONTRACT_REQUIRED');
  const packageUiContract = environment.packageUiContract();
  insist(typeof packageUiContract?.buildAppContentManifest === 'function' && typeof packageUiContract?.evaluatePackageUiEvidenceCompleteness === 'function', 'TRUSTED_PACKAGE_UI_CONTRACT_INVALID');
  insist(current && current.paths && current.packageIdentity && path.isAbsolute(current.appRoot), 'TRUSTED_CURRENT_PACKAGE_INVALID');
  for (const key of ['installer', 'portable', 'zip', 'mainBundle']) {
    insist(path.isAbsolute(current.paths[key] ?? ''), 'TRUSTED_CURRENT_PACKAGE_PATH_INVALID:' + key);
    readArtifact(root, { path: current.paths[key], sha256: identity.packageHashes?.[key] });
  }
  insist(path.resolve(current.paths.mainBundle).toLowerCase() === path.resolve(current.appRoot, 'dist/main/index.js').toLowerCase(), 'TRUSTED_MAIN_OUTSIDE_CURRENT_APP');
  const app = packageUiContract.buildAppContentManifest(current.appRoot);
  insist(hashEqual(app.sha256, identity.packageHashes?.appContent) && hashEqual(current.packageIdentity.appContentSha256, app.sha256)
    && hashEqual(current.packageIdentity.mainBundleSha256, identity.packageHashes?.mainBundle), 'TRUSTED_CURRENT_PACKAGE_HASH_MISMATCH');
  for (const record of app.files) readArtifact(root, { ...record, path: path.join(current.appRoot, record.path) });
  insist(path.isAbsolute(current.executablePath ?? ''), 'TRUSTED_CURRENT_EXE_PATH_INVALID');
  readArtifact(root, { path: current.executablePath, sha256: current.packageIdentity.executableSha256 });
  for (const record of current.inputArtifacts ?? []) readArtifact(root, record);
  return { ...current, packageUiContract };
}
function relativeSource(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim() && !value.includes('\\') && !value.includes('\0')
    && !path.isAbsolute(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
}
function validateFrozenBuild(frozen, expectedIdentity) {
  insist(frozen?.schemaVersion === 'v16.frozen-build/1', 'FROZEN_BUILD_SCHEMA_INVALID');
  insist(/^[a-f0-9]{40,64}$/i.test(frozen.identity?.sourceRevision ?? '') && /^[a-f0-9]{64}$/i.test(frozen.identity?.sourceSha256 ?? '')
    && typeof frozen.identity.packageVersion === 'string' && frozen.identity.packageVersion.length > 0, 'FROZEN_BUILD_IDENTITY_INVALID');
  if (expectedIdentity) for (const key of ['sourceRevision', 'sourceSha256', 'packageVersion']) insist(frozen.identity[key] === expectedIdentity[key], 'FROZEN_BUILD_IDENTITY_MISMATCH:' + key);
  insist(Array.isArray(frozen.prdMust) && frozen.prdMust.length > 0 && new Set(frozen.prdMust.map(item => item.id)).size === frozen.prdMust.length, 'FROZEN_PRD_INVENTORY_INVALID');
  insist(frozen.requirementsIndex?.requirements?.length === frozen.prdMust.length && Array.isArray(frozen.requiredManifestDefinition?.requiredTests), 'FROZEN_BUILD_CONTRACT_INVALID');
  insist(Array.isArray(frozen.testInventory) && frozen.testInventory.length > 0 && new Set(frozen.testInventory).size === frozen.testInventory.length
    && frozen.testInventory.every(file => relativeSource(file) && /^(apps|packages|scripts)\/.+\.(test|spec)\.[cm]?[jt]sx?$/.test(file)), 'FROZEN_TEST_INVENTORY_INVALID');
  insist(Array.isArray(frozen.implementationInventory) && frozen.implementationInventory.length > 0
    && new Set(frozen.implementationInventory.map(record => record.path)).size === frozen.implementationInventory.length
    && frozen.implementationInventory.every(record => relativeSource(record.path) && /^[a-f0-9]{64}$/i.test(record.sha256 ?? '') && Number.isSafeInteger(record.sizeBytes) && record.sizeBytes >= 0), 'FROZEN_IMPLEMENTATION_INVENTORY_INVALID');
  return frozen;
}
function trustedSecuritySources(context) {
  const sources = context.trustedNativeEnvironment?.securitySources;
  if (!context.trustedNativeEnvironment) {
    const readSource = relative => {
      const file = path.join(context.root, relative);
      return readArtifact(context.root, { path: file, sha256: digest(fs.readFileSync(file)) }).file;
    };
    return { settingsRepositoryPaths: [readSource('packages/local-db/src/sqlite/repositories/settings-repo.ts')],
      sqliteDbPaths: ['db.ts', 'db-migration-contract.ts', 'db-migration-runner.ts', 'db-metric-identity.ts', 'db-columns.ts'].map(file => readSource('packages/local-db/src/sqlite/' + file)) };
  }
  insist(sources && sources.settingsRepository && sources.sqliteDatabase, 'TRUSTED_SECURITY_SOURCES_REQUIRED');
  const readGroup = group => {
    const files = group.files ?? [group];
    insist(Array.isArray(files) && files.length > 0 && new Set(files.map(record => record.path)).size === files.length, 'TRUSTED_SECURITY_SOURCE_GROUP_INVALID');
    return files.map(record => readArtifact(context.root, record).file);
  };
  return { settingsRepositoryPaths: readGroup(sources.settingsRepository), sqliteDbPaths: readGroup(sources.sqliteDatabase) };
}
module.exports = { artifactRoots, providedPackage, validateFrozenBuild, relativeSource, trustedSecuritySources };
