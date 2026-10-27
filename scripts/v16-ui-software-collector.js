const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createArtifactWriter, insist, readBound, fileRecord, digest } = require('./v16-performance-artifacts');
const { sourceIdentity } = require('./verify-v16-required-test-manifest');
const { currentPackage } = require('./v16-native-artifacts');
const { openNativeRuntime } = require('./v16-performance-runtime');
const { validateFixture } = require('./v16-performance-contract');
const { validateEvidenceUserDataPath } = require('./evidence-user-data');
const { captureSoftwareMatrix } = require('./v16-ui-software-matrix');
const { synchronizeSoftwareScope } = require('./v16-ui-software-scope');
const { collectSoftwareGovernance } = require('./v16-ui-software-governance');
const { collectSoftwareRecovery, readRuntimeLogs } = require('./v16-ui-software-recovery');
const { openNvdaObserver } = require('./v16-ui-software-screen-reader');
const { inspectFinalIdentity, inspectRuntimeLogFailures } = require('./v16-ui-software-integrity');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');

function logCaptureFailure(writer, event, error) {
  try { writer.log(event, error); }
  catch (loggingError) {
    try { process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'v16.ui_capture_log_failed', { event, error: loggingError, originalError: error })) + '\n'); }
    catch { /* 日志出口关闭不阻止本次自有观察器与应用回收。 */ }
  }
}

function canonicalState() {
  const directories = ['@amazon-ai-ops/desktop', 'AmazonAIOpsAgent', 'AmazonAIOps'].map(name => path.resolve(process.env.APPDATA || '', name));
  return directories.flatMap(directory => ['amazon-ai-ops.db', 'amazon-ai-ops.db-wal', 'Local State'].map(name => {
    const file = path.join(directory, name); return { path: file, sha256: fs.existsSync(file) ? digest(fs.readFileSync(file)) : null };
  }));
}
function currentBuild(root, fixture) {
  insist(fixture.generationState !== 'STALE', 'UI_SOFTWARE_FIXTURE_GENERATION_IS_STALE');
  const source = sourceIdentity(root), identity = { ...source, packageHashes: fixture.packageHashes };
  insist(fixture.sourceSha256 === source.sourceSha256, 'UI_SOFTWARE_FIXTURE_SOURCE_IS_NOT_CURRENT');
  const current = currentPackage(root, identity);
  const state = JSON.parse(fs.readFileSync(path.join(current.appRoot, 'dist/main/v16-build-state.json'), 'utf8'));
  insist(state.schemaVersion === 'v16.build-state/1' && state.status === 'CURRENT'
    && JSON.stringify(state.identity) === JSON.stringify(source), 'UI_SOFTWARE_PACKAGE_BUILD_IS_NOT_CURRENT');
  return { source, identity, current };
}
function recordRecoveryFailure(report, writer, error) {
  logCaptureFailure(writer, 'v16.ui_software_recovery_failed', error);
  report.issues.push({ code: error.message });
  report.passed = false;
}

async function collectSoftwareUi({ root = process.cwd(), fixtureRecord, output, profile, screenReaderExecutable, timeoutMs = 30000 }) {
  const writer = createArtifactWriter(path.resolve(output)), runId = `software-ui-${randomUUID()}`;
  const report = { kind: 'v16-software-ui-capture', schemaVersion: 1, runId, startedAt: new Date().toISOString(), formalCredit: false,
    classification: 'isolated-software-fixture', status: 'NON_READY', passed: false, issues: [], externalDependencies: ['真实店铺范围的正式原件', '每项屏读/交互观察后的当前包人工批准'] };
  let runtime, reader, buildBefore, canonicalBefore, readerOpenFailure;
  try {
    const input = readBound(fixtureRecord, root), rawFixture = input.json();
    const build = currentBuild(root, rawFixture); buildBefore = build; canonicalBefore = canonicalState();
    const fixture = validateFixture(rawFixture, rawFixture.fixture, build.identity);
    insist(fixture.classification === 'isolated-software-fixture' && fixture.formalCredit === false, 'UI_SOFTWARE_FIXTURE_REQUIRED');
    const userDataDir = validateEvidenceUserDataPath(path.resolve(profile), { requireExisting: false });
    const fixtureRoot = path.dirname(readBound(fixture.logicalDatabase).path);
    insist(path.dirname(userDataDir).toLowerCase() === fixtureRoot.toLowerCase(), 'UI_SOFTWARE_PROFILE_OWNER_ROOT_REQUIRED');
    const owner = JSON.parse(fs.readFileSync(fileRecord(path.join(fixtureRoot, 'owner.json')).path, 'utf8'));
    insist(owner.token === fixture.ownerToken && owner.classification === fixture.classification, 'UI_SOFTWARE_PROFILE_OWNER_MISMATCH');
    insist(!fs.existsSync(userDataDir), 'UI_SOFTWARE_NEW_PROFILE_REQUIRED');
    fs.mkdirSync(userDataDir, { recursive: true }); validateEvidenceUserDataPath(userDataDir);
    fs.copyFileSync(readBound(fixture.logicalDatabase).path, path.join(userDataDir, 'amazon-ai-ops.db'), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(userDataDir, 'v16-ui-owner.json'), JSON.stringify({ runId, classification: fixture.classification }), { flag: 'wx' });
    writer.copy('inputs/fixture.json', { ...fixtureRecord, path: input.path });
    report.sourceIdentity = build.source; report.packageIdentity = build.current.packageIdentity;
    runtime = await openNativeRuntime({ current: build.current, fixture, profile: userDataDir, writer, label: 'native', timeoutMs, root });
    report.launch = runtime.launch.receipt;
    const activeView = await runtime.page.evaluate(() => window.electronAPI.getActiveStoreWorkspaceView());
    const context = activeView?.context;
    insist(context && fixture.storeIds.includes(context.storeId), 'UI_SOFTWARE_SELECTED_STORE_REQUIRED');
    report.scopeInitialization = await synchronizeSoftwareScope(runtime, fixture, activeView, writer, timeoutMs);
    const binding = { runId, uiRunGroupId: runId, profileId: 'software-native-profile', pid: runtime.identity.pid,
      storeIdSha256: digest(Buffer.from(context.storeId)), sourceSha256: build.source.sourceSha256, packageIdentity: build.current.packageIdentity };
    report.binding = binding;
    report.matrix = await captureSoftwareMatrix(runtime, writer, binding);
    report.issues.push(...report.matrix.issues);
    if (screenReaderExecutable) {
      try {
        reader = await openNvdaObserver({ executablePath: screenReaderExecutable, directory: path.join(userDataDir, 'nvda-observer'), writer,
          rendererPid: runtime.identity.windows[0].rendererPid, runtime, storeContext: report.scopeInitialization.context,
          nativeLaunchKind: 'v16-nfr-native-launch', timeoutMs, root, sourceIdentity: build.source });
        report.screenReaderLaunch = reader.receipt;
      }
      catch (error) { readerOpenFailure = error; logCaptureFailure(writer, 'v16.ui_screen_reader_unavailable', error); report.issues.push({ code: error.message }); }
    }
    report.governance = await collectSoftwareGovernance(runtime, writer, binding, { screenReader: reader, root, blockedError: readerOpenFailure });
    report.issues.push(...report.governance.issues);
    if (readerOpenFailure || reader?.sessionFailure) {
      // 屏读会话失效后不再启动恢复交互，只保留明确未执行的原因。
      report.recoveryUnverified = writer.json('recovery/unverified.json', { kind: 'v16-software-ui-recovery-unverified', schemaVersion: 1,
        status: 'UNVERIFIED', executed: false, formalCredit: false, code: 'UI_NVDA_CAPTURE_SESSION_UNUSABLE',
        cause: String((readerOpenFailure || reader.sessionFailure).message || 'UI_NVDA_CAPTURE_FAILED').slice(0, 160), readerLaunch: report.screenReaderLaunch });
      report.issues.push({ code: 'UI_RECOVERY_NOT_EXECUTED_READER_SESSION_UNUSABLE' });
    } else {
      try { report.recovery = await collectSoftwareRecovery(runtime, fixture, writer, binding); }
      catch (error) { recordRecoveryFailure(report, writer, error); }
    }
    report.passed = report.issues.length === 0 && report.matrix.results.every(result => result.observed)
      && report.governance.deltas.every(delta => Object.keys(delta.observations).length === 3) && Boolean(report.recovery);
  } catch (error) {
    logCaptureFailure(writer, 'v16.ui_software_capture_failed', error);
    report.issues.push({ code: error.message });
  } finally {
    if (reader) { try { report.screenReaderCleanup = await reader.close(); } catch (error) { logCaptureFailure(writer, 'v16.ui_screen_reader_cleanup_failed', error); report.issues.push({ code: error.message }); } }
    if (runtime) { try { await runtime.close(); } catch (error) { logCaptureFailure(writer, 'v16.ui_software_cleanup_failed', error); report.issues.push({ code: error.message }); } }
    if (runtime?.rendererErrors.length) report.issues.push({ code: 'UI_SOFTWARE_RENDERER_RUNTIME_ERRORS', errors: [...runtime.rendererErrors] });
    if (runtime) {
      try {
        const logs = readRuntimeLogs(runtime.userDataDir);
        report.runtimeLogs = writer.write('native/runtime-log.jsonl', logs.map(record => JSON.stringify(record)).join('\n') + '\n');
        report.runtimeLogVerification = inspectRuntimeLogFailures(logs, report.recovery?.expectedFaultRecords);
        if (report.runtimeLogVerification.unexpected.length || report.runtimeLogVerification.missingOrRepeatedExpected.length) {
          report.issues.push({ code: 'UI_SOFTWARE_UNEXPECTED_RUNTIME_ERRORS' });
        }
      } catch (error) { logCaptureFailure(writer, 'v16.ui_software_runtime_log_failed', error); report.issues.push({ code: error.message }); }
    }
    if (buildBefore) {
      inspectFinalIdentity(report, { source: buildBefore.source, packageIdentity: buildBefore.current.packageIdentity, canonical: canonicalBefore },
        { source: () => sourceIdentity(root), packageIdentity: () => currentPackage(root, buildBefore.identity).packageIdentity, canonical: canonicalState }, writer);
    }
    report.passed = report.passed && report.issues.length === 0;
    report.finishedAt = new Date().toISOString();
    writer.json('report.json', report);
  }
  return { report, artifact: fileRecord(path.join(writer.root, 'report.json')) };
}
module.exports = { canonicalState, currentBuild, recordRecoveryFailure, collectSoftwareUi };
