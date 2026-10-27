const crypto = require('node:crypto');
const path = require('node:path');
const { runnerSourcePaths } = require('./package-ui-module-registry');

function collectPackageUiRunnerSourceBinding(readArtifact, sourcePaths = runnerSourcePaths) {
  const records = sourcePaths.map((filePath) => {
    const record = readArtifact(filePath);
    return { name: path.basename(filePath), sha256: record.sha256, sizeBytes: record.sizeBytes };
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (
    records.length === 0
    || new Set(records.map((record) => record.name)).size !== records.length
    || records.some((record) => !/^[A-F0-9]{64}$/.test(record.sha256)
      || !Number.isInteger(record.sizeBytes) || record.sizeBytes < 1)
  ) throw new Error('包界面证据的源码身份记录无效');
  return {
    sha256: crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex').toUpperCase(),
    sizeBytes: records.reduce((total, record) => total + record.sizeBytes, 0),
  };
}

module.exports = { collectPackageUiRunnerSourceBinding };
