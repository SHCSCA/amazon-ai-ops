const fs = require('node:fs');
const path = require('node:path');
const { digest, insist, fileRecord } = require('./v16-performance-artifacts');
const governance = require('./v16-ui-governance');

const CATALOG = Object.freeze([
  { primitive: 'App Shell / sidebar', entry: 'today/overview', root: '.app-sidebar' },
  { primitive: 'WorkspaceSubviewShell', entry: 'today/overview', root: '.workspace-subview-shell__navigation' },
  { primitive: 'PageFrame / TaskBanner', entry: 'missions/overview', root: '.task-banner' },
  { primitive: 'ReasonRequiredDialog', entry: 'policy/rules', root: '[role="alertdialog"]', open: 'reason' },
  { primitive: 'ResponsiveInspector', entry: 'execution/evidence', root: '[role="dialog"]', open: 'inspector' },
  { primitive: 'PriorityDataTable / virtual table', entry: 'objects/targets', root: '.priority-table-scroll' },
  { primitive: 'WorkspaceState / status', entry: 'execution/live', root: '[data-canonical-surface="execution"]' },
  { primitive: 'FormTable / controls', entry: 'settings/ai-and-local', root: '[role="dialog"]', open: 'settings' },
  { primitive: 'Progress / motion', entry: 'collection/reports', root: '[data-workspace-evidence-root][data-workspace="collection"]' },
  { primitive: 'Store / AI settings', entry: 'settings/ai-and-local', root: '[data-workspace-evidence-root][data-workspace="settings"]' },
]);

async function preparePrimitive(runtime, item, ui, { triggerEvidenceId } = {}) {
  await runtime.page.keyboard.press('Escape');
  const entry = ui.EXPECTED_PACKAGE_UI_ENTRIES.find(entry => `${entry.workspace}/${entry.subview}` === item.entry);
  insist(entry, 'UI_PRIMITIVE_CANONICAL_ROUTE_REQUIRED');
  // 复用导航原有唯一滚动门；重复准备也必须先复位真实工作区滚动容器。
  await ui.navigateToWorkspace(runtime.page, entry, undefined, { resetScroll: true });
  let trigger;
  if (item.open === 'reason') trigger = runtime.page.locator('.policy-domain-runtime').getByRole('button', { name: '人工审批', exact: true });
  else if (item.open === 'inspector') trigger = runtime.page.locator('[data-action="open-technical-inspector"]');
  else if (item.open === 'settings') trigger = runtime.page.getByRole('button', { name: /^(填写并保存 AI 设置|编辑连接)$/ });
  else trigger = runtime.page.locator('.app-sidebar [data-operator-entry][aria-current="page"]').first();
  await trigger.waitFor({ state: 'visible' });
  insist(await trigger.isEnabled(), 'UI_PRIMITIVE_TRIGGER_DISABLED');
  await trigger.focus();
  // 背景进入 modal inert 前采集真实触发器；关闭后仍须同对象重新读取，不能把旧快照作为当前信用。
  const triggerNode = item.open && triggerEvidenceId ? await describeElement(trigger, triggerEvidenceId) : undefined;
  if (item.open) await trigger.click();
  const root = runtime.page.locator(item.root).filter({ visible: true }).first();
  await root.waitFor({ state: 'visible' });
  return { root, trigger, ...(triggerNode ? { triggerNode } : {}) };
}

const { describeAccessibleElement: describeElement, refreshAccessibleElement } = require('./v16-ui-accessible-node');
const { prepareReaderTarget } = require('./v16-ui-reader-target-setup');
async function focusedId(page) { return page.evaluate(() => document.activeElement?.getAttribute('data-v16-a11y-node')); }

async function captureKeyboard(runtime, prepared, binding, writer, label) {
  let triggerNode = prepared.triggerNode || await describeElement(prepared.trigger, label + '-trigger');
  insist(triggerNode.id === label + '-trigger', 'UI_PRIMITIVE_TRIGGER_AX_ID_MISMATCH');
  const selectors = ['button:not(:disabled)', 'input:not(:disabled)', 'select:not(:disabled)', 'textarea:not(:disabled)', 'a[href]', 'summary', '[tabindex="0"]'];
  const candidates = prepared.root.locator(selectors.map(selector => `${selector}:not([data-v16-a11y-node="${triggerNode.id}"])`).join(',')).filter({ visible: true });
  // 程序可聚焦不等于可参与顺序 Tab；原生页签的非活动项必须排除。
  const indices = await candidates.evaluateAll(elements => elements.flatMap((element, index) =>
    element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') ? [index] : []));
  const controls = indices.map(index => candidates.nth(index));
  insist(controls.length >= 1, 'UI_PRIMITIVE_KEYBOARD_CONTROL_NOT_OBSERVED');
  const control = controls[0], node = await describeElement(control, label + '-control');
  insist(node.name && triggerNode.name && node.id !== triggerNode.id && node.focusable && triggerNode.focusable, 'UI_PRIMITIVE_NAMED_FOCUS_NODES_REQUIRED');
  await control.focus();
  insist(await focusedId(runtime.page) === node.id, 'UI_PRIMITIVE_INITIAL_FOCUS_NOT_OBSERVED');
  const events = [{ event: 'focus-enter', targetId: node.id, activeElementId: node.id, timestamp: new Date().toISOString(), binding }];
  const keys = [];
  if (binding.primitive === 'ReasonRequiredDialog') {
    const count = controls.length;
    for (let index = 0; index < count; index++) { await runtime.page.keyboard.press('Tab'); keys.push('Tab'); }
    insist(await focusedId(runtime.page) === node.id, 'UI_PRIMITIVE_DIALOG_TAB_WRAP_FAILED');
    events.push({ event: 'tab-wrap', targetId: node.id, activeElementId: node.id, keys: [...keys], timestamp: new Date().toISOString(), binding });
    for (let index = 0; index < count; index++) await runtime.page.keyboard.press('Shift+Tab');
    insist(await focusedId(runtime.page) === node.id, 'UI_PRIMITIVE_DIALOG_BACKWARD_WRAP_FAILED');
    events.push({ event: 'shift-tab-wrap', targetId: node.id, activeElementId: node.id, keys: Array(count).fill('Shift+Tab'), timestamp: new Date().toISOString(), binding });
    await runtime.page.keyboard.press('Escape');
    await runtime.page.waitForFunction(id => document.activeElement?.getAttribute('data-v16-a11y-node') === id, triggerNode.id);
    events.push({ event: 'escape', targetId: triggerNode.id, activeElementId: await focusedId(runtime.page), timestamp: new Date().toISOString(), binding });
  } else {
    await runtime.page.keyboard.press('Tab'); keys.push('Tab');
    await runtime.page.keyboard.press('Shift+Tab'); keys.push('Shift+Tab');
    insist(await focusedId(runtime.page) === node.id, 'UI_PRIMITIVE_KEYBOARD_ACTION_RETURN_FAILED');
    events.push({ event: 'keyboard-action', targetId: node.id, activeElementId: node.id, keys, timestamp: new Date().toISOString(), binding });
    if (prepared.root !== prepared.trigger && await runtime.page.locator('[role="dialog"],[role="alertdialog"]').filter({ visible: true }).count()) await runtime.page.keyboard.press('Escape');
    else await prepared.trigger.focus();
  }
  await runtime.page.waitForFunction(id => document.activeElement?.getAttribute('data-v16-a11y-node') === id, triggerNode.id);
  insist(await focusedId(runtime.page) === triggerNode.id, 'UI_PRIMITIVE_TRIGGER_FOCUS_NOT_RESTORED');
  triggerNode = await refreshAccessibleElement(prepared.trigger, triggerNode, { requireActiveTarget: true });
  events.push({ event: 'focus-return', targetId: triggerNode.id, activeElementId: triggerNode.id, timestamp: new Date().toISOString(), binding });
  return { nodes: [node, triggerNode], triggerId: triggerNode.id, control,
    dom: writer.json(label + '/keyboard-dom.json', { schemaVersion: 'v16.accessibility-dom/1', binding, capturedAt: new Date().toISOString(), nodes: [node, triggerNode] }),
    log: writer.write(label + '/keyboard.jsonl', events.map(event => JSON.stringify(event)).join('\n') + '\n') };
}

function readerSessionBlock(error) {
  return { code: 'UI_NVDA_CAPTURE_SESSION_UNUSABLE', cause: String(error.message || 'UI_NVDA_CAPTURE_FAILED').slice(0, 160) };
}
function logFailedReaderSession(writer, error, context) {
  try { writer.log('v16.ui_primitive_observation_failed', error, context); }
  catch (loggingError) {
    try {
      const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
      process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'v16.ui_primitive_session_log_failed', { error: loggingError, originalError: error, ...context })) + '\n');
    } catch { /* 失效会话已停止，日志出口故障不覆盖真实首错。 */ }
  }
}

async function collectSoftwareGovernance(runtime, writer, binding, { screenReader, root = process.cwd(), ui = require('./package-ui-evidence'), blockedError } = {}) {
  const source = path.join(root, governance.SOURCE), bytes = fs.readFileSync(source), parsed = governance.parseUiGovernance(bytes.toString('utf8'));
  insist(CATALOG.length === parsed.accessibility.length && CATALOG.every(item => parsed.accessibility.some(delta => delta.primitive === item.primitive)), 'UI_PRIMITIVE_DEFINITION_INVENTORY_CHANGED');
  const definition = writer.write('governance/definition.md', bytes), deltas = [], issues = [];
  for (const [index, item] of CATALOG.entries()) {
    const label = 'governance/' + index, delta = parsed.accessibility.find(delta => delta.primitive === item.primitive);
    const canonicalBinding = { primitive: item.primitive, runId: binding.runId, uiRunGroupId: binding.uiRunGroupId,
      sourceSha256: binding.sourceSha256, packageIdentity: binding.packageIdentity, profileId: binding.profileId,
      pid: binding.pid, storeIdSha256: binding.storeIdSha256, governanceDefinitionSha256: definition.sha256, registerSha256: digest(bytes) };
    // 未知键仍写入原件，由正式消费者的精确身份门拒绝，不能悄悄丢弃。
    const currentBinding = { ...canonicalBinding, ...Object.fromEntries(Object.entries(binding).filter(([key]) => !Object.hasOwn(canonicalBinding, key))) };
    const result = { primitive: item.primitive, owner: delta.owner, method: delta.method, status: 'UNVERIFIED', observations: {}, external: ['需要当前原件的逐项人工批准'] };
    if (blockedError || screenReader?.sessionFailure) {
      // 保留全部登记项和具体阻断，失效会话不再制造后续焦点事件。
      result.blocked = readerSessionBlock(blockedError || screenReader.sessionFailure);
      issues.push({ primitive: item.primitive, ...result.blocked }); deltas.push(result); continue;
    }
    try {
      const prepared = await preparePrimitive(runtime, item, ui, { triggerEvidenceId: label + '-trigger' });
      const keyboard = await captureKeyboard(runtime, prepared, currentBinding, writer, label);
      result.observations.keyboard = writer.json(label + '/keyboard-observation.json', { schemaVersion: 'v16.accessibility-observation/1', category: 'keyboard',
        binding: currentBinding, capturedAt: new Date().toISOString(), triggerId: keyboard.triggerId, dom: keyboard.dom, log: keyboard.log });
      if (screenReader) {
        const speechTarget = await preparePrimitive(runtime, item, ui);
        const descendants = speechTarget.root.locator('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]').filter({ visible: true });
        let targets, containerNode;
        if (item.primitive === 'ResponsiveInspector') {
          // 只读检查器的合法双节点是现有具名容器和关闭按钮，不解禁业务动作。
          containerNode = await describeElement(speechTarget.root, `${index}-spoken-0`);
          insist(await speechTarget.root.getAttribute('role') === 'dialog' && await speechTarget.root.getAttribute('tabindex') === '-1'
            && await speechTarget.root.getAttribute('aria-labelledby') && containerNode.role === 'dialog' && containerNode.name && containerNode.focusable,
          'UI_SCREEN_READER_INSPECTOR_CONTAINER_INVALID');
          const close = speechTarget.root.getByRole('button', { name: '关闭详情检查器', exact: true });
          insist(await close.count() === 1 && await close.isVisible() && await close.isEnabled(), 'UI_SCREEN_READER_TWO_ACTUAL_NODES_REQUIRED');
          targets = [speechTarget.root, close];
        } else {
          insist(await descendants.count() >= 2, 'UI_SCREEN_READER_TWO_ACTUAL_NODES_REQUIRED');
          targets = [descendants.nth(0), descendants.nth(1)];
        }
        const originalNodes = [];
        for (let number = 0; number < 2; number++) originalNodes.push(number === 0 && containerNode ? containerNode
          : await describeElement(targets[number], `${index}-spoken-${number}`));
        targets = originalNodes.map(node => runtime.page.locator('[data-v16-a11y-node=' + JSON.stringify(node.id) + ']'));
        const spoken = [], nodes = [];
        for (let number = 0; number < 2; number++) {
          const target = targets[number], node = originalNodes[number];
          await prepareReaderTarget(runtime, target, node, speechTarget.root, ui, writer, label);
          const observation = await screenReader.capture(runtime, target, node); nodes.push(node); spoken.push({ node, observation });
        }
        const lines = [{ event: 'screen-reader-start', timestamp: spoken[0].observation.rows[0].timestamp, binding: currentBinding },
          ...spoken.map(({ node, observation }) => ({ event: 'spoken-node', timestamp: observation.observedAt, targetId: node.id, role: node.role,
            spoken: observation.rows.map(row => row.spoken).join(' '), actualNvdaRows: observation.rows, providerWitness: observation.providerWitness, binding: currentBinding })),
          { event: 'screen-reader-end', timestamp: new Date().toISOString(), binding: currentBinding }];
        result.observations['screen-reader'] = writer.json(label + '/screen-reader-observation.json', { schemaVersion: 'v16.accessibility-observation/1', category: 'screen-reader',
          binding: currentBinding, capturedAt: new Date().toISOString(), engine: spoken[0].observation.engine,
          dom: writer.json(label + '/screen-reader-dom.json', { schemaVersion: 'v16.accessibility-dom/1', binding: currentBinding, capturedAt: new Date().toISOString(), nodes }),
          log: writer.write(label + '/screen-reader.jsonl', lines.map(line => JSON.stringify(line)).join('\n') + '\n') });
      } else issues.push({ primitive: item.primitive, code: 'UI_ACTUAL_SCREEN_READER_NOT_CONFIGURED' });
      result.observations['motion-zoom'] = await require('./v16-ui-software-motion').captureMotionZoom(runtime, writer, currentBinding, label,
        () => preparePrimitive(runtime, item, ui), describeElement, ui);
      if (Object.keys(result.observations).length === 3) result.status = 'OBSERVED_WITHOUT_APPROVAL';
    } catch (error) {
      if (screenReader?.sessionFailure) {
        result.blocked = readerSessionBlock(screenReader.sessionFailure);
        logFailedReaderSession(writer, error, { primitive: item.primitive, pid: runtime.identity.pid });
      } else writer.log('v16.ui_primitive_observation_failed', error, { primitive: item.primitive, pid: runtime.identity.pid });
      issues.push({ primitive: item.primitive, code: error.message });
    } finally {
      if (!screenReader?.sessionFailure) await runtime.page.keyboard.press('Escape')
        .catch(error => writer.log('v16.ui_primitive_dismiss_failed', error, { primitive: item.primitive }));
    }
    deltas.push(result);
  }
  return { kind: 'v16-software-ui-governance', schemaVersion: 1, formalCredit: false, definition, deltas, issues,
    pendingApprovals: parsed.accessibility.map(delta => ({ primitive: delta.primitive, owner: delta.owner, status: 'PENDING' })) };
}
module.exports = { CATALOG, preparePrimitive, describeElement, captureKeyboard, collectSoftwareGovernance };
