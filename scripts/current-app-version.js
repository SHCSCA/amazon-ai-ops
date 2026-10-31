const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function isValidAppVersion(value) {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value);
}

function packageVersion(packagePath) {
  const value = JSON.parse(fs.readFileSync(packagePath, 'utf8'))?.version;
  if (!isValidAppVersion(value)) {
    throw new Error(`Invalid package version: ${packagePath}`);
  }
  return value;
}

function currentAppVersion() {
  const rootVersion = packageVersion(path.join(repoRoot, 'package.json'));
  const desktopVersion = packageVersion(path.join(repoRoot, 'apps', 'desktop', 'package.json'));
  if (rootVersion !== desktopVersion) {
    throw new Error(`Root/desktop version mismatch: ${rootVersion} != ${desktopVersion}`);
  }
  return rootVersion;
}

module.exports = { currentAppVersion, isValidAppVersion };
