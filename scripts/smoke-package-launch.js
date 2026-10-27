const { PORTABLE_START_TIMEOUT_MS, PROCESS_CLEANUP_ATTEMPTS, TASKKILL_COMMAND_TIMEOUT_MS, WINDOWS_PROCESS_COMMAND_ATTEMPTS, WINDOWS_PROCESS_COMMAND_TIMEOUT_MS, normalizedExecutablePath } = require('./package-launch-contracts.js');
const { cleanupVerifiedProcessTrees, selectVerifiedPortableRuntimeProcess, windowsDescendants, windowsProcessesByIds, windowsRuntimeWindowById } = require('./package-launch-processes.js');
const { packagedRendererPathForExecutable, readPackageLaunchWindowReadyEvidence, validatePackageLaunchSmokeEvidence, validatePackageLaunchWindowReadyMarker } = require('./package-launch-validation.js');
const { main } = require('./package-launch-runtime.js');

if (require.main === module) {
  main().catch((error) => { process.stderr.write(JSON.stringify(require('../packages/shared-types/src/runtime-log-format.cjs').createRuntimeLogRecord('error', 'package.launch_failed', { error })) + '\n'); process.exitCode = 1; });
}

module.exports = { PORTABLE_START_TIMEOUT_MS, PROCESS_CLEANUP_ATTEMPTS, TASKKILL_COMMAND_TIMEOUT_MS, WINDOWS_PROCESS_COMMAND_ATTEMPTS, WINDOWS_PROCESS_COMMAND_TIMEOUT_MS, cleanupVerifiedProcessTrees, normalizedExecutablePath, packagedRendererPathForExecutable, readPackageLaunchWindowReadyEvidence, selectVerifiedPortableRuntimeProcess, validatePackageLaunchSmokeEvidence, validatePackageLaunchWindowReadyMarker, windowsDescendants, windowsProcessesByIds, windowsRuntimeWindowById };
