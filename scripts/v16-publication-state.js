const fs = require('node:fs');
const path = require('node:path');
const { replacePublicationFile, replacePublicationJson } = require('./v16-publication-files.js');
const { readDeliveryStatus } = require('./v16-publication-bundle.js');

function downgradeReadme(root, options = {}) {
  const file = path.resolve(root, options.readmePath ?? 'README.md');
  const current = fs.readFileSync(file, 'utf8');
  if (readDeliveryStatus(current) === 'APP_READY') replacePublicationFile(file,
    current.replace(/^\*\*DELIVERY:[^\r\n]*/m, '**DELIVERY: APP_NEEDS_WORK — INTERNAL NON_READY.** 发布闭包需要重新验收；旧状态不再具有当前交付信用。'));
}

function invalidatePublicationRun(paths, error = null) {
  const failures = [];
  for (const invalidate of [
    () => downgradeReadme(paths.root, { readmePath: paths.readmePath }),
    () => replacePublicationJson(paths.readinessPath, {
      schemaVersion: 'v16.readiness/1', timestamp: new Date().toISOString(), identity: null,
      overallStatus: 'APP_NEEDS_WORK', publicationPhase: error ? 'ABORTED' : 'PREPARING',
      gates: Array.from({ length: 8 }, (_, index) => ({ layer: `L${index + 1}`, passed: false })),
      issues: [error ? 'PUBLICATION_ABORTED:' + String(error.message ?? error) : 'PUBLICATION_IN_PROGRESS'],
    }),
  ]) {
    try { invalidate(); } catch (invalidationError) { failures.push(invalidationError); }
  }
  if (failures.length) throw new AggregateError(failures, 'PUBLICATION_INVALIDATION_INCOMPLETE');
}

module.exports = { downgradeReadme, invalidatePublicationRun };
