const fs = require('node:fs');
const path = require('node:path');
const { insist, fileRecord, readBound, createArtifactWriter, within, directPath } = require('./v16-performance-artifacts');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
const { validateWindowPlan, captureEvidenceInventory } = require('./v16-evidence-growth-capture');
const { buildEvidenceWindow, verifyEvidenceWindowArtifacts, same } = require('./v16-evidence-growth-window');

function parseArguments(argv) {
  const options = {}, accepted = new Set(['--mode', '--plan', '--start', '--out-dir', '--report', '--require-full-day']);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    insist(accepted.has(key) && !(key in options) && typeof value === 'string' && value && value.trim() === value
      && !value.includes('\0') && !value.startsWith('--') && !value.includes('://'), 'EVIDENCE_WINDOW_CLI_ARGUMENT_INVALID');
    options[key] = value;
  }
  insist(['begin', 'end', 'verify'].includes(options['--mode'])
    && ['true', 'false'].includes(options['--require-full-day'] ?? 'false'), 'EVIDENCE_WINDOW_CLI_MODE_INVALID');
  insist(options['--out-dir'] && (options['--mode'] === 'verify' ? options['--report'] : options['--plan']),
    'EVIDENCE_WINDOW_CLI_INPUT_REQUIRED');
  insist((options['--mode'] === 'end') === Boolean(options['--start']), 'EVIDENCE_WINDOW_CLI_START_REQUIRED_ONLY_FOR_END');
  insist(options['--mode'] === 'verify' || !options['--report'], 'EVIDENCE_WINDOW_CLI_REPORT_ONLY_FOR_VERIFY');
  insist(options['--mode'] !== 'begin' || options['--require-full-day'] !== 'true', 'EVIDENCE_WINDOW_BEGIN_CANNOT_CLAIM_DAY');
  return { mode: options['--mode'], plan: options['--plan'], start: options['--start'], report: options['--report'],
    output: options['--out-dir'], requireFullDay: options['--require-full-day'] === 'true' };
}
function currentWindowBinding(root, plan) {
  const source = require('./verify-v16-required-test-manifest').sourceIdentity(root);
  insist(source.sourceSha256 === plan.binding.sourceSha256, 'EVIDENCE_WINDOW_SOURCE_IS_NOT_CURRENT');
  const identity = { ...source, packageHashes: plan.packageHashes };
  const current = require('./v16-native-artifacts').currentPackage(root, identity);
  insist(same(current.packageIdentity, plan.binding.packageIdentity), 'EVIDENCE_WINDOW_PACKAGE_IS_NOT_CURRENT');
  return { source, packageIdentity: current.packageIdentity };
}
function admitOutput(root, output, plan) {
  const target = path.resolve(root, output), outputRoot = path.join(root, 'output');
  insist(within(outputRoot, target) && target !== outputRoot && !fs.existsSync(target), 'EVIDENCE_WINDOW_NEW_OUTPUT_REQUIRED');
  let ancestor = path.dirname(target);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  directPath(ancestor, true);
  if (plan) insist(!within(plan.evidenceRoot, target) && !within(target, plan.evidenceRoot), 'EVIDENCE_WINDOW_OUTPUT_INTERSECTS_MEASURED_ROOT');
  return target;
}
function logFailure(event, error, context) {
  try { process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', event, { ...context, error })) + '\n'); }
  catch { /* 日志出口失效时继续传播原异常，不改写失败结果。 */ }
}
async function main(argv, root = process.cwd()) {
  const options = parseArguments(argv);
  const originalPlanRecord = options.plan ? fileRecord(path.resolve(root, options.plan)) : undefined;
  const originalPlan = originalPlanRecord ? readBound(originalPlanRecord).json() : undefined;
  const plan = originalPlan ? validateWindowPlan(originalPlan) : undefined;
  const output = admitOutput(root, options.output, plan), writer = createArtifactWriter(output);
  let before;
  try {
    if (options.mode === 'verify') {
      const record = fileRecord(path.resolve(root, options.report));
      const container = readBound(record).json(), boundPlan = readBound(container.plan).json();
      validateWindowPlan(boundPlan); currentWindowBinding(root, boundPlan);
      const verification = verifyEvidenceWindowArtifacts(record, { requireFullDay: options.requireFullDay });
      currentWindowBinding(root, boundPlan); readBound(container.plan); readBound(record);
      writer.json('verification.json', { kind: 'v16-evidence-window-verification', generatedAt: new Date().toISOString(),
        verification, report: record, formalAcceptanceEvidence: false, appReady: false });
      return { status: 'VERIFIED_OBSERVATION_ONLY', verification, formalAcceptanceEvidence: false, appReady: false };
    }
    before = currentWindowBinding(root, originalPlan);
    writer.copy('inputs/plan.json', originalPlanRecord);
    const snapshot = captureEvidenceInventory(originalPlan), snapshotRecord = writer.json('snapshot.json', snapshot);
    let observation, observationRecord;
    if (options.mode === 'end') {
      const startContainerRecord = fileRecord(path.resolve(root, options.start)), startContainer = readBound(startContainerRecord).json();
      insist(startContainer.kind === 'v16-evidence-window-start' && same(startContainer.plan, originalPlanRecord), 'EVIDENCE_WINDOW_START_PLAN_MISMATCH');
      const start = readBound(startContainer.snapshot).json();
      observation = buildEvidenceWindow(start, snapshot, { requireFullDay: options.requireFullDay });
      observationRecord = writer.json('window.json', { kind: 'v16-evidence-growth-window-artifacts', schemaVersion: 1,
        plan: originalPlanRecord, start: startContainer.snapshot, end: snapshotRecord, observation, formalAcceptanceEvidence: false, appReady: false });
      verifyEvidenceWindowArtifacts(observationRecord, { requireFullDay: options.requireFullDay });
      readBound(startContainerRecord);
    }
    insist(same(before, currentWindowBinding(root, originalPlan)), 'EVIDENCE_WINDOW_SOURCE_OR_PACKAGE_CHANGED_DURING_CAPTURE');
    readBound(originalPlanRecord);
    const record = writer.json('report.json', options.mode === 'begin'
      ? { kind: 'v16-evidence-window-start', schemaVersion: 1, plan: originalPlanRecord, snapshot: snapshotRecord,
        startedAt: snapshot.clock.observedAt, formalAcceptanceEvidence: false, appReady: false }
      : { kind: 'v16-evidence-window-end', schemaVersion: 1, plan: originalPlanRecord, snapshot: snapshotRecord,
        observation: observationRecord, status: observation.status, realTimeDayObserved: observation.realTimeDayObserved,
        formalAcceptanceEvidence: false, appReady: false });
    return { status: options.mode === 'begin' ? 'STARTED_NO_DAILY_CREDIT' : observation.status, report: record,
      formalAcceptanceEvidence: false, appReady: false };
  } catch (error) {
    logFailure('v16.evidence_window_failed', error, { mode: options.mode });
    try { writer.json('failure.json', { kind: 'v16-evidence-window-failure', status: 'FAILED',
      message: error.message, mode: options.mode, formalAcceptanceEvidence: false, appReady: false }); }
    catch (outputError) {
      logFailure('v16.evidence_window_failure_receipt_failed', outputError, { mode: options.mode });
      throw new AggregateError([error, outputError], 'EVIDENCE_WINDOW_AND_FAILURE_RECEIPT_FAILED');
    }
    throw error;
  }
}
if (require.main === module) main(process.argv.slice(2)).then(value => {
  process.stdout.write(JSON.stringify(createRuntimeLogRecord('info', 'v16.evidence_window_finished', value)) + '\n');
}).catch(error => { logFailure('v16.evidence_window_cli_failed', error); process.exitCode = 1; });
module.exports = { parseArguments, currentWindowBinding, admitOutput, logFailure, main };

