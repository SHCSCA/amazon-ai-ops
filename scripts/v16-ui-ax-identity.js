const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual: same } = require('node:util');
const { insist } = require('./v16-performance-artifacts');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
const bindings = new WeakMap();
function logFailure(writer, error, cleanupOnly = false, axReferenceProofs = []) {
  try {
    const context = { cleanupOnly, ...(axReferenceProofs.length ? { axReferenceProofs } : {}) };
    if (writer) writer.log('v16.ui_accessible_node_failed', error, context);
    else process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'v16.ui_accessible_node_failed', { error, ...context })) + '\n');
  } catch { /* 日志出口故障不替换名称读取首错。 */ }
}
function bindAccessibleNode(node, witness) { bindings.set(node, witness); return node; }
function guard(options) {
  options.assertActive?.();
  if (options.deadline !== undefined) insist(Date.now() < options.deadline, 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
}
function registerProbe(element, request) {
  if (request === undefined) { request = element; element = document.activeElement; }
  if (request.deadline !== undefined && Date.now() >= request.deadline) throw new Error('UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
  const state = request.context ? window.__amazonAiOpsDomFocus : null;
  if (request.context && (!state || state.closed || state.nonce !== request.context.nonce || state.phase !== request.context.phase
    || state.deadline !== request.context.deadline)) return null;
  const target = state?.target || element, active = document.activeElement;
  if (request.active) element = active;
  if (!element || !target || !element.isConnected || !target.isConnected || element.ownerDocument !== document || window !== window.top)
    throw new Error('UI_AX_EXACT_MAIN_FRAME_ELEMENT_REQUIRED');
  // 各阶段先等待既定焦点条件，再建立身份探针；原截止时间保持。
  if (request.active && request.context
    && ((['first-focus', 'target-focus'].includes(request.context.phase) && active !== target)
      || request.context.phase === 'tab' && active === target
      || request.context.phase === 'target-handoff' && (active === state.before || active === target))) return null;
  const key = '__amazonAiOpsAxProbes';
  const probes = window[key] || (window[key] = new Map());
  if (probes.has(request.nonce)) throw new Error('UI_AX_PROBE_NONCE_REUSED');
  const meta = { id: element.getAttribute('data-v16-a11y-node'), tagName: element.tagName, inputType: element.type || null,
    declaredRole: element.getAttribute('role'), tabIndex: element.tabIndex, disabled: element.matches(':disabled'),
    inert: Boolean(element.closest('[inert]')), labelled: Boolean(element.getAttribute('aria-labelledby')),
    bounds: element.getBoundingClientRect().toJSON(), activeElementId: active?.getAttribute('data-v16-a11y-node') };
  const focus = state ? { nonce: state.nonce, phase: state.phase, observedAt: new Date().toISOString(), documentFocused: document.hasFocus(),
    targetConnected: target.isConnected, activeConnected: element.isConnected, sameTarget: element === target,
    sameBefore: element === state.before, targetId: target.getAttribute('data-v16-a11y-node') } : null;
  probes.set(request.nonce, { element, target, state, before: state?.before, document, meta, focus });
  return { meta, focus, targetId: target.getAttribute('data-v16-a11y-node') };
}
function proveObject(request) {
  const probe = window.__amazonAiOpsAxProbes?.get(request.nonce);
  const element = probe?.[request.kind];
  const state = probe?.state;
  const meta = probe?.meta;
  const gates = Array(26).fill(null);
  const record = (index, value) => { gates[index] = Boolean(value); return value; };
  // 同一次原表达式只记录已求值门，null表示原短路没有读取。
  const valid = Boolean(record(0, (probe)) && record(1, (this === element)) && record(2, (element.isConnected)) && record(3, (element.ownerDocument === document))
    && record(4, (probe.document === document)) && record(5, (window === window.top))
    && record(6, (probe.element.getAttribute('data-v16-a11y-node') === meta.id)) && record(7, (probe.element.tagName === meta.tagName))
    && record(8, ((probe.element.type || null) === meta.inputType))
    && record(9, (probe.element.getAttribute('role') === meta.declaredRole)) && record(10, (probe.element.tabIndex === meta.tabIndex))
    && record(11, (probe.element.matches(':disabled') === meta.disabled)) && record(12, (Boolean(probe.element.closest('[inert]')) === meta.inert))
    && (record(13, (!(request.active || request.requireActiveTarget))) || record(14, (document.activeElement === probe.element)))
    && (record(15, (!state)) || record(16, (window.__amazonAiOpsDomFocus === state)) && record(17, (!state.closed)) && record(18, (state.target === probe.target))
      && record(19, (state.before === probe.before)) && record(20, (state.target.getAttribute('data-v16-a11y-node') === probe.focus.targetId))
      && record(21, (state.nonce === request.context.nonce)) && record(22, (state.phase === request.context.phase)) && record(23, (state.deadline === request.context.deadline)))
    && (record(24, (request.deadline === undefined)) || record(25, (Date.now() < request.deadline))));
  return { kind: 'v16-ax-dom-proof', schemaVersion: 1, valid, gates };
}
function proofObservation(proof, resolveKind, resolveNumber) {
  const exceptionPresent = Boolean(proof.exceptionDetails), value = proof.result?.value;
  const shapeValid = Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && same(Object.keys(value).sort(), ['gates', 'kind', 'schemaVersion', 'valid'])
    && value.kind === 'v16-ax-dom-proof' && value.schemaVersion === 1 && typeof value.valid === 'boolean'
    && Array.isArray(value.gates) && value.gates.length === 26
    && value.gates.every(item => item === null || typeof item === 'boolean'));
  let traceValid = false;
  if (shapeValid) {
    const reached = Array(26).fill(false), gate = index => { reached[index] = true; return value.gates[index]; };
    const traced = Boolean(gate(0) && gate(1) && gate(2) && gate(3)
    && gate(4) && gate(5)
    && gate(6) && gate(7)
    && gate(8)
    && gate(9) && gate(10)
    && gate(11) && gate(12)
    && (gate(13) || gate(14))
    && (gate(15) || gate(16) && gate(17) && gate(18)
      && gate(19) && gate(20)
      && gate(21) && gate(22) && gate(23))
    && (gate(24) || gate(25)));
    traceValid = traced === value.valid && value.gates.every((item, index) => reached[index] ? typeof item === 'boolean' : item === null);
  }
  const booleanResult = typeof value === 'boolean' ? value : typeof value?.valid === 'boolean' ? value.valid : null;
  return { kind: 'v16-ax-dom-proof-observation', schemaVersion: 1, resolveKind, resolveNumber,
    exceptionPresent, booleanResult, booleanResultTrue: booleanResult === true,
    envelopeValid: shapeValid && traceValid, gates: shapeValid ? [...value.gates] : null };
}
function extractAx(response, backend) {
  insist(response && Array.isArray(response.nodes) && response.nodes.length === 1, 'UI_AX_ONE_ACTUAL_NODE_REQUIRED');
  const node = response.nodes[0];
  insist(node.ignored === false && node.backendDOMNodeId === backend && typeof node.name?.value === 'string'
    && /\S/.test(node.name.value) && !/[\r\n]/.test(node.name.value) && typeof node.role?.value === 'string' && node.role.value.length > 0,
  'UI_AX_ACTUAL_NODE_INVALID');
  // 不保存 AX value、来源树或完整响应，名称中的空白也不能替换。
  return { name: node.name.value, rawRole: node.role.value, backendDOMNodeId: backend };
}
function finishProbe(request) {
  const probes = window.__amazonAiOpsAxProbes, probe = probes?.get(request.nonce);
  try {
    if (!request.validate) return null;
    const element = probe?.element, target = probe?.target, meta = probe?.meta, state = probe?.state;
    if (!(probe && probe.document === document && window === window.top && element.isConnected && target.isConnected
      && element.ownerDocument === document && target.ownerDocument === document
      && element.getAttribute('data-v16-a11y-node') === meta.id && element.tagName === meta.tagName
      && (element.type || null) === meta.inputType && element.getAttribute('role') === meta.declaredRole
      && element.tabIndex === meta.tabIndex && element.matches(':disabled') === meta.disabled
      && Boolean(element.closest('[inert]')) === meta.inert
      && (!(request.active || request.requireActiveTarget) || document.activeElement === element)
      && (!state || window.__amazonAiOpsDomFocus === state && !state.closed && state.target === target
        && state.before === probe.before && target.getAttribute('data-v16-a11y-node') === probe.focus.targetId
        && state.nonce === request.context.nonce && state.phase === request.context.phase && state.deadline === request.context.deadline))) return { valid: false };
    return { valid: true, activeElementId: document.activeElement?.getAttribute('data-v16-a11y-node'),
      focus: state ? { nonce: state.nonce, phase: state.phase, observedAt: new Date().toISOString(), documentFocused: document.hasFocus(),
        targetConnected: target.isConnected, activeConnected: element.isConnected, sameTarget: element === target,
        sameBefore: element === state.before, targetId: target.getAttribute('data-v16-a11y-node') } : null };
  } finally { probes?.delete(request.nonce); }
}
async function readActualAx(locator, options = {}) {
  const page = options.page || locator.page(), request = { nonce: randomUUID(), active: Boolean(options.active),
    requireActiveTarget: Boolean(options.requireActiveTarget),
    ...(options.context ? { context: options.context } : {}), ...(options.deadline === undefined ? {} : { deadline: options.deadline }) };
  let session, probe, firstError, result, probeAttempted = false, resolveCount = 0; const objects = [], axReferenceProofs = [];
  try {
    guard(options);
    probeAttempted = true;
    probe = options.active ? await page.evaluate(registerProbe, request) : await locator.evaluate(registerProbe, request);
    guard(options); if (!probe) return null;
    const url = page.url();
    session = await page.context().newCDPSession(page); guard(options);
    const send = async (method, params = {}) => { guard(options); const value = await session.send(method, params); guard(options); return value; };
    const frame = async () => {
      const value = (await send('Page.getFrameTree')).frameTree?.frame;
      insist(value && !value.parentId && value.id && value.loaderId && value.url === url && page.url() === url, 'UI_AX_MAIN_FRAME_CHANGED');
      return { id: value.id, loaderId: value.loaderId, url: value.url };
    };
    const firstFrame = await frame(), firstDocument = (await send('DOM.getDocument', { depth: 0 })).root;
    insist(Number.isSafeInteger(firstDocument?.nodeId) && Number.isSafeInteger(firstDocument?.backendNodeId), 'UI_AX_DOCUMENT_IDENTITY_REQUIRED');
    async function resolve(kind, root) {
      const resolveNumber = ++resolveCount;
      const selector = kind === 'element' && request.active ? ':focus'
        : '[data-v16-a11y-node=' + JSON.stringify(kind === 'target' ? probe.targetId : probe.meta.id) + ']';
      const result = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector });
      insist(result.nodeIds?.length === 1, 'UI_AX_UNIQUE_DOM_NODE_REQUIRED');
      const nodeId = result.nodeIds[0], described = (await send('DOM.describeNode', { nodeId })).node;
      insist(Number.isSafeInteger(described?.backendNodeId), 'UI_AX_BACKEND_NODE_REQUIRED');
      const objectId = (await send('DOM.resolveNode', { nodeId })).object?.objectId;
      insist(typeof objectId === 'string' && objectId, 'UI_AX_REMOTE_OBJECT_REQUIRED'); objects.push(objectId);
      const proof = await send('Runtime.callFunctionOn', { objectId, functionDeclaration: proveObject.toString(),
        arguments: [{ value: { ...request, kind } }], returnByValue: true });
      const observation = proofObservation(proof, kind, resolveNumber); axReferenceProofs.push(observation);
      insist(!observation.exceptionPresent && observation.envelopeValid && observation.booleanResultTrue, 'UI_AX_EXACT_DOM_REFERENCE_CHANGED');
      return { nodeId, backendNodeId: described.backendNodeId };
    }
    const first = await resolve('element', firstDocument);
    const target = request.active ? await resolve('target', firstDocument) : first;
    const witness = { frame: firstFrame, documentBackend: firstDocument.backendNodeId, targetBackend: target.backendNodeId };
    if (options.expectedNode) insist(same(bindings.get(options.expectedNode), witness), 'UI_AX_PREBOUND_TARGET_CHANGED');
    const firstAx = extractAx(await send('Accessibility.getPartialAXTree', { nodeId: first.nodeId, fetchRelatives: false }), first.backendNodeId);
    const lastDocument = (await send('DOM.getDocument', { depth: 0 })).root;
    insist(same(await frame(), firstFrame) && lastDocument?.backendNodeId === firstDocument.backendNodeId, 'UI_AX_DOCUMENT_IDENTITY_CHANGED');
    const last = await resolve('element', lastDocument);
    const lastTarget = request.active ? await resolve('target', lastDocument) : last;
    insist(last.backendNodeId === first.backendNodeId && lastTarget.backendNodeId === target.backendNodeId, 'UI_AX_BACKEND_NODE_CHANGED');
    const lastAx = extractAx(await send('Accessibility.getPartialAXTree', { nodeId: last.nodeId, fetchRelatives: false }), last.backendNodeId);
    insist(same(lastAx, firstAx), 'UI_AX_NAME_OR_ROLE_CHANGED');
    guard(options);
    return result = { meta: probe.meta, focus: probe.focus, ax: firstAx, witness };
  } catch (error) { firstError = error; logFailure(options.writer, error, false, axReferenceProofs); throw error; }
  finally {
    const cleanup = async action => { try { await action(); } catch (error) { logFailure(options.writer, error, true, axReferenceProofs); if (!firstError) firstError = error; } };
    if (session) {
      for (const objectId of objects) await cleanup(() => session.send('Runtime.releaseObject', { objectId }));
      await cleanup(() => session.detach());
    }
    if (probeAttempted) await cleanup(async () => {
      // 最后一个异步出口同时验证真实引用与焦点，再删除本 nonce；清理不能让旧结果逃过取消或原截止时间。
      const final = await page.evaluate(finishProbe, { ...request, validate: !firstError && Boolean(result) });
      if (!firstError && result) {
        guard(options); insist(final?.valid === true, 'UI_AX_FINAL_DOM_IDENTITY_CHANGED');
        const initialFocus = result.focus;
        result.meta.activeElementId = final.activeElementId;
        if (final.focus) insist(initialFocus && initialFocus.nonce === final.focus.nonce && initialFocus.phase === final.focus.phase
          && initialFocus.targetId === final.focus.targetId && final.focus.nonce === request.context?.nonce
          && final.focus.phase === request.context?.phase && final.focus.targetId === probe.targetId,
        'UI_AX_FOCUS_INTERVAL_IDENTITY_CHANGED');
        // 保存两次真实 Renderer 采样；不能用最终时间回填丢失的初值。
        result.focus = final.focus ? { ...final.focus, rendererTiming: {
          kind: 'v16-dom-renderer-interval', schemaVersion: 1, clock: 'renderer-wall',
          probeNonce: request.nonce, nonce: final.focus.nonce, phase: final.focus.phase,
          targetId: final.focus.targetId, startedAt: initialFocus?.observedAt, finishedAt: final.focus.observedAt,
        } } : final.focus;
      }
    });
    if (!firstError) { try { guard(options); } catch (error) { firstError = error; logFailure(options.writer, error, false, axReferenceProofs); } }
    if (firstError) throw firstError;
  }
}
module.exports = { readActualAx, bindAccessibleNode, extractAx };
