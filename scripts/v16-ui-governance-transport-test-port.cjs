const assert = require('node:assert/strict');
const commonReads = require('./v16-ui-accessible-node-test-port.cjs');
function createGovernanceTransportTestPorts() {
  const calls = [];
  async function describeAccessibleElement(locator, id) {
    calls.push({ method: 'describe', id, isolatedModel: true, actualAxCredit: false });
    // 仅为运输/DOM合同夹具读取既定标签，不是生产AX降级路径，也不能作为NVDA原件。
    return locator.evaluate((element, evidenceId) => {
      element.dataset.v16A11yNode = evidenceId;
      const labelled = (element.getAttribute('aria-labelledby') || '').split(/\s+/)
        .map(key => document.getElementById(key)?.textContent || '').join(' ').trim();
      const roles = { BUTTON: 'button', INPUT: ['checkbox', 'radio'].includes(element.type) ? element.type : 'textbox',
        SELECT: 'combobox', TEXTAREA: 'textbox', A: 'link', SUMMARY: 'button' };
      const role = element.getAttribute('role') || roles[element.tagName] || 'group';
      const dialog = role === 'dialog' && element.getAttribute('tabindex') === '-1';
      return { id: evidenceId, role, name: element.getAttribute('aria-label') || labelled
        || [...(element.labels || [])].map(label => label.textContent).join(' ').trim() || element.textContent.trim(),
      focusable: !element.matches(':disabled') && !element.closest('[inert]') && (dialog ? Boolean(labelled)
        : element.tabIndex >= 0 || element.matches('button,input,select,textarea,a[href],summary')),
      bounds: element.getBoundingClientRect().toJSON() };
    }, id);
  }
  async function refreshAccessibleElement(locator, node, options) {
    calls.push({ method: 'refresh', id: node.id, requireActiveTarget: options?.requireActiveTarget, isolatedModel: true, actualAxCredit: false });
    assert.equal(options?.requireActiveTarget, true);
    const current = await describeAccessibleElement(locator, node.id);
    assert.equal(current.id, node.id); assert.equal(current.name, node.name); assert.equal(current.role, node.role);
    assert.equal(current.focusable, true);
    return current;
  }
  async function prepareReaderTarget(_runtime, _target, node) {
    calls.push({ method: 'setup', id: node.id, role: node.role, isolatedModel: true, actualAxCredit: false });
    // 此运输夹具只登记按钮与具名容器；意外出现页签时不能伪装执行真实选择流程。
    assert.ok(['button', 'dialog'].includes(node.role), 'UNIT_TRANSPORT_UNEXPECTED_TAB_OR_ROLE');
  }
  const dependencies = Object.freeze({ './v16-ui-accessible-node': Object.freeze({ ...commonReads, describeAccessibleElement, refreshAccessibleElement }),
    './v16-ui-reader-target-setup': Object.freeze({ prepareReaderTarget }) });
  function assertUsed() {
    for (const method of ['describe', 'refresh', 'setup']) assert.ok(calls.some(row => row.method === method), 'UNIT_TRANSPORT_PORT_NOT_USED:' + method);
    assert.ok(calls.every(row => row.isolatedModel === true && row.actualAxCredit === false));
  }
  function resolveModelLocator(selector, locators) {
    const prefix = '[data-v16-a11y-node=';
    if (!selector.startsWith(prefix)) return null;
    assert.ok(selector.endsWith(']'), 'UNIT_TRANSPORT_MARKER_SELECTOR_INVALID');
    const id = JSON.parse(selector.slice(prefix.length, -1)), matches = locators.filter(locator => locator.id === id);
    assert.equal(matches.length, 1, 'UNIT_TRANSPORT_MARKER_NOT_UNIQUE');
    calls.push({ method: 'resolve', id, isolatedModel: true, actualAxCredit: false });
    return matches[0];
  }
  return { dependencies, calls, assertUsed, resolveModelLocator };
}
module.exports = { createGovernanceTransportTestPorts };
