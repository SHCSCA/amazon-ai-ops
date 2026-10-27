const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { insist, digest, readBound } = require('./v16-performance-artifacts');
const { logPackageUiNativeFailure } = require('./package-ui-native-launch');

const CONTEXT = ['storeId', 'marketplace', 'currency', 'businessTimezone', 'businessDate', 'browserProfileId', 'sessionGeneration'];

async function collectPackageUiNativeGovernance(runtime, options, ui, timeoutMs) {
  if (!options.screenReaderExecutablePath) return;
  try {
  const active = await runtime.page.evaluate(() => window.electronAPI.getActiveStoreWorkspaceView());
  const context = Object.fromEntries(CONTEXT.map(key => [key, active?.context?.[key]]));
  insist(CONTEXT.every(key => context[key] !== undefined) && context.marketplace === 'US' && context.currency === 'USD',
    'PACKAGE_UI_READER_CURRENT_STORE_CONTEXT_REQUIRED');
  const native = readBound(runtime.launch.receipt).json();
  insist(native.sourceIdentity && isDeepStrictEqual(native.sourceIdentity, options.governanceSourceIdentity)
    && /^[a-f0-9]{64}$/.test(native.sourceIdentity.sourceSha256), 'PACKAGE_UI_READER_BOUND_SOURCE_REQUIRED');
  const { openNvdaObserver } = require('./v16-ui-software-screen-reader');
  runtime.reader = await openNvdaObserver({ executablePath: options.screenReaderExecutablePath,
    directory: path.join(runtime.writer.root, 'reader-profile'), writer: runtime.writer,
    rendererPid: runtime.identity.windows[0].rendererPid, runtime, storeContext: context,
    nativeLaunchKind: 'v16-package-ui-native-launch', timeoutMs });
  runtime.readerLaunch = runtime.reader.receipt;
  const binding = { runId: options.runGroupId || options.resumeRunGroupId, uiRunGroupId: options.runGroupId || options.resumeRunGroupId,
    sourceSha256: native.sourceIdentity.sourceSha256, packageIdentity: native.packageIdentity,
    profileId: options.profileId, pid: runtime.identity.pid, storeIdSha256: digest(Buffer.from(context.storeId)) };
  const result = await require('./v16-ui-software-governance').collectSoftwareGovernance(runtime, runtime.writer, binding,
    { screenReader: runtime.reader, ui });
  runtime.governance = runtime.writer.json('governance/report.json', result);
  insist(result.issues.length === 0 && result.deltas.every(delta => Object.keys(delta.observations).length === 3),
    'PACKAGE_UI_READER_GOVERNANCE_INCOMPLETE');
  } catch (error) { logPackageUiNativeFailure(runtime.writer, 'package_ui.reader_governance_failed', error); throw error; }
}

async function closePackageUiNativeReader(runtime) {
  if (!runtime?.reader) return;
  try {
    const receipt = await runtime.reader.close();
    runtime.readerCleanup = runtime.writer.json('reader-cleanup.json', receipt);
  } catch (error) { logPackageUiNativeFailure(runtime.writer, 'package_ui.reader_cleanup_failed', error); throw error; }
}

module.exports = { collectPackageUiNativeGovernance, closePackageUiNativeReader };
