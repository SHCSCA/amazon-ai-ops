const { main } = require('./v15-delivery-export-publication.js');

if (require.main === module) {
  try { main(); }
  catch (error) { process.stderr.write(JSON.stringify(require('../packages/shared-types/src/runtime-log-format.cjs').createRuntimeLogRecord('error', 'v15.delivery.export.failed', { error })) + '\n'); process.exitCode = 1; }
}

module.exports = { main };
