const { trustedMotionMain, verifyMotionNativeArtifacts } = require('./v16-ui-motion-artifacts');
const fs = require('node:fs');
const path = require('node:path');
const { insist, digest, same, hashEqual, readArtifact, timeWithin } = require('./v16-native-artifacts');
const governance = require('./v16-ui-governance');
const { validateProviderObservation } = require('./v16-nvda-provider-binding');

const CATEGORIES = Object.freeze(['keyboard', 'screen-reader', 'motion-zoom']);
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }
function bound(value, binding, context) {
  insist(same(value.binding, binding), 'ACCESSIBILITY_ORIGINAL_IDENTITY_MISMATCH');
  return timeWithin(value.capturedAt, context.execution, 'accessibility-original');
}
function readDom(record, binding, context, owner, schema = 'v16.accessibility-dom/1') {
  const dom = readArtifact(context.root, record, owner).json();
  insist(dom.schemaVersion === schema, 'ACCESSIBILITY_DOM_SCHEMA_INVALID');
  bound(dom, binding, context);
  insist(Array.isArray(dom.nodes) && dom.nodes.length >= 2 && new Set(dom.nodes.map(node => node.id)).size === dom.nodes.length
    && dom.nodes.every(node => nonempty(node.id) && nonempty(node.name) && nonempty(node.role)), 'ACCESSIBILITY_DOM_NODES_REQUIRED');
  return dom;
}
function readLog(record, binding, context, owner) {
  const lines = readArtifact(context.root, record, owner).bytes.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  insist(lines.length > 0, 'ACCESSIBILITY_RAW_LOG_REQUIRED');
  let previous = -Infinity;
  for (const line of lines) {
    insist(same(line.binding, binding) && nonempty(line.event), 'ACCESSIBILITY_LOG_IDENTITY_MISMATCH');
    const stamp = timeWithin(line.timestamp, context.execution, 'accessibility-log');
    insist(stamp >= previous, 'ACCESSIBILITY_LOG_ORDER_INVALID'); previous = stamp;
  }
  return lines;
}
function verifyKeyboard(observation, binding, context, owner) {
  const dom = readDom(observation.dom, binding, context, owner), logs = readLog(observation.log, binding, context, owner);
  const expected = binding.primitive === 'ReasonRequiredDialog'
    ? ['focus-enter', 'tab-wrap', 'shift-tab-wrap', 'escape', 'focus-return'] : ['focus-enter', 'keyboard-action', 'focus-return'];
  insist(same(logs.map(line => line.event), expected), 'ACCESSIBILITY_KEYBOARD_SEQUENCE_MISSING');
  for (const line of logs) {
    const target = dom.nodes.find(node => node.id === line.targetId);
    insist(target?.focusable === true && line.activeElementId === target.id, 'ACCESSIBILITY_FOCUS_NOT_OBSERVED');
  }
  insist(logs.at(-1).targetId === observation.triggerId && logs[0].targetId !== observation.triggerId, 'ACCESSIBILITY_FOCUS_NOT_RESTORED');
}
function verifyScreenReader(observation, binding, context, owner, run, seenNonces, sequenceState) {
  const dom = readDom(observation.dom, binding, context, owner), logs = readLog(observation.log, binding, context, owner);
  insist(['NVDA', 'Narrator', 'JAWS'].includes(observation.engine?.name) && nonempty(observation.engine.version), 'ACCESSIBILITY_ACTUAL_SCREEN_READER_REQUIRED');
  insist(logs[0].event === 'screen-reader-start' && logs.at(-1).event === 'screen-reader-end', 'ACCESSIBILITY_SCREEN_READER_SESSION_MISSING');
  const spoken = logs.slice(1, -1);
  insist(spoken.length >= 2 && spoken.every(line => line.event === 'spoken-node') && new Set(spoken.map(line => line.targetId)).size === spoken.length, 'ACCESSIBILITY_SPOKEN_TRANSCRIPT_MISSING');
  for (const line of spoken) {
    const target = dom.nodes.find(node => node.id === line.targetId);
    insist(target && line.role === target.role && nonempty(line.spoken) && line.spoken.includes(target.name), 'ACCESSIBILITY_SPOKEN_LABEL_MISMATCH');
  }
  insist(!spoken.some(line => line.providerWitness !== undefined || line.actualNvdaRows !== undefined) || observation.engine.name === 'NVDA',
    'ACCESSIBILITY_NVDA_ENGINE_PAYLOAD_MISMATCH');
  if (observation.engine.name === 'NVDA') {
    // 信任锚只能来自已验证的同次包运行，不能由待验语音记录选择原件。
    insist(run?.nativeLaunch, 'ACCESSIBILITY_NVDA_CURRENT_NATIVE_LAUNCH_REQUIRED');
    insist(run.readerLaunch, 'ACCESSIBILITY_NVDA_CURRENT_READER_LAUNCH_REQUIRED');
    const nativeLaunch = readArtifact(context.root, run.nativeLaunch).json();
    timeWithin(nativeLaunch.startedAt, context.execution, 'accessibility-native-launch');
    timeWithin(nativeLaunch.finishedAt, context.execution, 'accessibility-native-ready');
    for (const line of spoken) {
      const witness = line.providerWitness;
      insist(witness && same(witness.nativeLaunch, run.nativeLaunch), 'ACCESSIBILITY_NVDA_NATIVE_LAUNCH_REFERENCE_MISMATCH');
      insist(same(witness.readerLaunch, run.readerLaunch), 'ACCESSIBILITY_NVDA_READER_LAUNCH_REFERENCE_MISMATCH');
      const readerLaunch = readArtifact(context.root, run.readerLaunch).json();
      const rawRows = readArtifact(context.root, witness.rawSpeech, owner).bytes.toString('utf8').trim().split(/\r?\n/).map(value => JSON.parse(value));
      insist(witness.ready?.version === observation.engine.version && line.timestamp === line.actualNvdaRows?.at(-1)?.timestamp,
        'ACCESSIBILITY_NVDA_ENGINE_OR_OBSERVATION_TIME_MISMATCH');
      insist(Date.parse(observation.capturedAt) >= Date.parse(logs.at(-1).timestamp)
        && Date.parse(observation.capturedAt) >= Date.parse(witness.hostAfter?.observedAt), 'ACCESSIBILITY_NVDA_CAPTURE_PREDATES_OBSERVATION');
      insist(hashEqual(digest(Buffer.from(witness.binding?.storeContext?.storeId ?? '')), binding.storeIdSha256), 'ACCESSIBILITY_NVDA_STORE_MISMATCH');
      validateProviderObservation(witness, line.actualNvdaRows, dom.nodes.find(node => node.id === line.targetId), {
        nativeLaunch, readerLaunch, rawRows, execution: context.execution, spoken: line.spoken, observedAt: line.timestamp,
        focusModeReceipt: witness.speechSource?.focusModeReceipt ? readArtifact(context.root, witness.speechSource.focusModeReceipt, owner).json() : undefined,
        focusModeReceiptRef: witness.speechSource?.focusModeReceipt,
        inputReceipt: witness.speechSource?.input ? readArtifact(context.root, witness.speechSource.input, owner).json() : undefined,
        inputReceiptRef: witness.speechSource?.input ?? undefined,
        readerVersion: observation.engine.version, seenNonces, sequenceState,
        expected: { pid: binding.pid, packageIdentity: binding.packageIdentity, nativeLaunchRef: run.nativeLaunch,
          readerLaunchRef: run.readerLaunch, nativeLaunchKind: 'v16-package-ui-native-launch' },
      });
    }
  }
}
function verifyMotionZoom(observation, binding, context, owner, run) {
  const logs = readLog(observation.log, binding, context, owner);
  insist(same(logs.map(line => line.event), ['reduced-motion-enabled', '125-percent-capture', 'minimum-window-capture']), 'ACCESSIBILITY_MOTION_ZOOM_SEQUENCE_MISSING');
  insist(observation.viewports?.length === 2 && same(observation.viewports.map(view => view.kind).sort(), ['125-percent', 'minimum-window']), 'ACCESSIBILITY_VIEWPORT_SET_MISMATCH');
  insist(same(observation.viewports.map(view => view.kind), ['125-percent', 'minimum-window']) && run?.nativeLaunch,
    'ACCESSIBILITY_MOTION_OWNED_RUN_REQUIRED');
  const native = readArtifact(context.root, run.nativeLaunch).json(), identity = native.identity;
  const fixedScale = run.profileId === 'wide' && run.scalePercent === undefined ? 1
    : [100, 125].includes(run.scalePercent) && (run.profileId === undefined || run.profileId === `${run.scalePercent}-compact`)
      ? run.scalePercent / 100 : null;
  insist(native.kind === 'v16-package-ui-native-launch' && identity?.packaged === true && identity.pid === binding.pid
    && same(native.packageIdentity, binding.packageIdentity) && identity.windows?.length === 1 && identity.electronVersion === '44.2.0'
    && fixedScale !== null && run.actualDeviceScaleFactor === fixedScale,
  'ACCESSIBILITY_MOTION_OWNED_RUN_REQUIRED');
  const window = identity.windows[0];
  const expectedOwner = { mainPid: identity.pid, mainCreationTime: identity.creationTime, windowId: window.id,
    rendererPid: window.rendererPid, rendererCreationTime: window.creationTime, url: window.url, electronVersion: identity.electronVersion };
  let referenceGeometry = null;
  for (const view of observation.viewports) {
    const dom = readDom(view.dom, binding, context, owner, 'v16.accessibility-motion-dom/3');
    verifyMotionNativeArtifacts(dom.geometryWitness, context, owner, native);
    const png = require('./canary-png-evidence').inspectNativeOwnedMotionPngEvidenceBytes(readArtifact(context.root, view.screenshot, owner).bytes,
      dom.geometryWitness, { kind: view.kind, owner: expectedOwner, deviceScaleFactor: run.actualDeviceScaleFactor,
        referenceGeometry, execution: context.execution, capturedAt: dom.capturedAt, nativeMain: trustedMotionMain(native, expectedOwner) });
    insist(dom.reducedMotion === true && nonempty(dom.stateText) && Array.isArray(dom.animations) && dom.animations.every(animation => animation.durationMs === 0), 'ACCESSIBILITY_STATIC_STATE_REQUIRED');
    const renderer = dom.geometryWitness.before.renderer;
    const visible = png.visibleViewport;
    insist(dom.viewport?.width === png.width && dom.viewport?.height === png.height
      && dom.viewport.scaleFactor === (view.kind === '125-percent' ? 1.25 : 1)
      && dom.coordinateSpace === 'physical-pixels' && dom.cssToPhysicalFactor === renderer.devicePixelRatio,
    'ACCESSIBILITY_VIEWPORT_NOT_OBSERVED');
    for (const node of dom.nodes) {
      const box = node.bounds, css = node.cssBounds;
      insist(box && [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
        && box.x + box.width <= visible.width && box.y + box.height <= visible.height
        && css && [css.x, css.y, css.width, css.height].every(Number.isFinite) && css.x >= 0 && css.y >= 0 && css.width > 0 && css.height > 0
        && css.x + css.width <= renderer.innerWidth && css.y + css.height <= renderer.innerHeight
        && ['x', 'y', 'width', 'height'].every(field => box[field] === css[field] * renderer.devicePixelRatio), 'ACCESSIBILITY_ZOOM_TARGET_CLIPPED');
    }
    referenceGeometry = dom.geometryWitness;
  }
}
function verifyUiGovernance(raw, descriptor, context) {
  insist(raw.kind === 'v16-ui-governance' && raw.schemaVersion === 1 && raw.runId === descriptor.runId
    && raw.sourceSha256 === context.identity.sourceSha256 && same(raw.packageIdentity, context.current.packageIdentity), 'ACCESSIBILITY_CURRENT_IDENTITY_REQUIRED');
  const owner = path.dirname(path.resolve(context.root, descriptor.path));
  const fixed = context.trustedNativeEnvironment?.uiGovernanceSource;
  if (context.trustedNativeEnvironment) insist(fixed, 'TRUSTED_UI_GOVERNANCE_SOURCE_REQUIRED');
  const canonical = fixed ?? { path: path.join(context.root, governance.SOURCE), sha256: digest(fs.readFileSync(path.join(context.root, governance.SOURCE))) };
  const current = readArtifact(context.root, canonical);
  insist(hashEqual(raw.definitionSha256, canonical.sha256), 'ACCESSIBILITY_DEFINITION_IS_NOT_CURRENT');
  const definition = governance.parseUiGovernance(current.bytes.toString('utf8'));
  const registerArtifact = readArtifact(context.root, raw.register, owner);
  const register = governance.parseUiGovernance(registerArtifact.bytes.toString('utf8'));
  // 包内冻结定义保持待验状态；现场快照只能更新状态，不能改动风险或负责人。
  const semantic = value => ({ ...value, sourceSha256: undefined, accessibility: value.accessibility.map(({ status, ...delta }) => delta) });
  insist(same(semantic(definition), semantic(register)), 'ACCESSIBILITY_REGISTER_DEFINITION_CHANGED');
  const registeredAt = timeWithin(raw.registeredAt, context.execution, 'accessibility-register');
  insist(register.accessibility.every(delta => delta.status === 'PASS'), 'ACCESSIBILITY_REGISTER_HAS_PENDING_OR_FAILED_DELTA');
  insist(Array.isArray(raw.deltas) && raw.deltas.length === register.accessibility.length && new Set(raw.deltas.map(delta => delta.primitive)).size === raw.deltas.length, 'ACCESSIBILITY_DELTA_INVENTORY_MISMATCH');
  const ui = context.load(descriptor.packageUiArtifactId, 'package-ui');
  insist(raw.uiRunGroupId === ui.runGroup?.runGroupId, 'ACCESSIBILITY_UI_RUN_GROUP_MISMATCH');
  const seenNonces = new Set(), sequenceState = new Map();
  for (const delta of register.accessibility) {
    const evidence = raw.deltas.find(item => item.primitive === delta.primitive);
    insist(evidence && evidence.owner === delta.owner && evidence.method === delta.method && evidence.status === 'PASS', 'ACCESSIBILITY_OWNER_METHOD_MISMATCH');
    const run = [...ui.runs, ui.wideProfile].filter(Boolean).find(item => (item.profileId ?? `${item.scalePercent}-compact`) === evidence.profileId);
    insist(run && evidence.pid === run.schedulerReadOnlyRuntime?.main?.pid && hashEqual(evidence.storeIdSha256, run.session?.storeAuthorityReadback?.actualIdSha256), 'ACCESSIBILITY_RUNTIME_STORE_MISMATCH');
    const binding = { primitive: delta.primitive, runId: raw.runId, uiRunGroupId: raw.uiRunGroupId, sourceSha256: raw.sourceSha256,
      packageIdentity: raw.packageIdentity, profileId: evidence.profileId, pid: evidence.pid, storeIdSha256: evidence.storeIdSha256,
      governanceDefinitionSha256: canonical.sha256, registerSha256: raw.register.sha256 };
    const observationTimes = [];
    const observations = CATEGORIES.map(category => {
      const artifact = evidence.observations?.[category], observation = readArtifact(context.root, artifact, owner).json();
      insist(observation.schemaVersion === 'v16.accessibility-observation/1' && observation.category === category, 'ACCESSIBILITY_OBSERVATION_SCHEMA_INVALID');
      observationTimes.push(bound(observation, binding, context));
      ({ keyboard: verifyKeyboard, 'screen-reader': verifyScreenReader, 'motion-zoom': verifyMotionZoom })[category](observation, binding, context, owner, run, seenNonces, sequenceState);
      return { category, sha256: artifact.sha256 };
    });
    const approval = readArtifact(context.root, evidence.approval, owner).json();
    insist(approval.schemaVersion === 'v16.accessibility-approval/1' && approval.primitive === delta.primitive && approval.owner === delta.owner
      && nonempty(approval.approvedBy) && approval.status === 'approved' && approval.sourceSha256 === raw.sourceSha256
      && same(approval.packageIdentity, raw.packageIdentity) && hashEqual(approval.definitionSha256, canonical.sha256)
      && hashEqual(approval.registerSha256, raw.register.sha256) && same(approval.binding, binding)
      && same(approval.observations, observations), 'ACCESSIBILITY_CURRENT_APPROVAL_REQUIRED');
    const approvedAt = timeWithin(approval.approvedAt, context.execution, 'accessibility-approval');
    insist(approvedAt >= Math.max(registeredAt, ...observationTimes), 'ACCESSIBILITY_APPROVAL_PREDATES_REGISTER_OR_OBSERVATION');
  }
  insist(!raw.wcagLevel, 'ACCESSIBILITY_WCAG_CLAIM_UNSUPPORTED');
  return true;
}
module.exports = { CATEGORIES, verifyUiGovernance };
