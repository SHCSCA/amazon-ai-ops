const { packageUiReferencedArtifactsAreBundled } = require('./v15-non-ready-safety-bundle.js');
const { main } = require('./v15-non-ready-safety-publication.js');
if (require.main === module) {
  const report = error => { process.stderr.write(JSON.stringify(require('../packages/shared-types/src/runtime-log-format.cjs').createRuntimeLogRecord('error', 'v15.non.ready.safety.failed', { error })) + '\n'); process.exitCode = 1; };
  try { main(); } catch (error) { report(error); }
}

module.exports = { packageUiReferencedArtifactsAreBundled };
