const { insist } = require('./v16-performance-artifacts');
const { readActualAx, bindAccessibleNode } = require('./v16-ui-ax-identity');
function semanticRole(meta, ax) {
  // Chromium 的 summary Windows 角色为按钮；仅这一确定组合保留现有 NVDA 合同。
  if (meta.tagName === 'SUMMARY' && ax.rawRole === 'DisclosureTriangle' && !meta.declaredRole) return 'button';
  const tags = { BUTTON: 'button', INPUT: 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox', A: 'link', UL: 'list' };
  const expected = meta.declaredRole || (meta.tagName === 'INPUT' && ['checkbox', 'radio'].includes(meta.inputType)
    ? meta.inputType : tags[meta.tagName]) || 'group';
  insist(ax.rawRole === expected, 'UI_AX_SEMANTIC_ROLE_MISMATCH');
  return ax.rawRole;
}
function selectNode(value) {
  return { id: value.meta.id, name: value.ax.name, role: semanticRole(value.meta, value.ax) };
}
async function describeAccessibleElement(locator, evidenceId) {
  await locator.evaluate((element, id) => { element.dataset.v16A11yNode = id; }, evidenceId);
  const value = await readActualAx(locator), node = describeValue(value);
  insist(node.id === evidenceId, 'UI_AX_REGISTERED_NODE_CHANGED');
  return bindAccessibleNode(node, value.witness);
}
function describeValue(value) {
  const node = selectNode(value), meta = value.meta;
  const programmatic = node.role === 'dialog' && meta.tabIndex === -1 && meta.labelled;
  return { ...node, focusable: !meta.disabled && !meta.inert && (programmatic || meta.tabIndex >= 0
    || ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'SUMMARY'].includes(meta.tagName)), bounds: meta.bounds };
}
async function refreshAccessibleElement(locator, node, options = {}) {
  const value = await readActualAx(locator, { ...options, expectedNode: node }), current = describeValue(value);
  insist(current.id === node.id && current.name === node.name && current.role === node.role && current.focusable,
    'UI_NVDA_PROVIDER_CURRENT_DOM_CHANGED');
  return bindAccessibleNode(current, value.witness);
}
async function readAccessibleMode(locator, node, options = {}) {
  const value = await readActualAx(locator, { ...options, expectedNode: node }), current = selectNode(value), meta = value.meta;
  insist(current.id === node.id && current.name === node.name && current.role === node.role, 'UI_NVDA_PROVIDER_CURRENT_DOM_CHANGED');
  return { id: current.id, tabIndex: meta.tabIndex, role: current.role, name: current.name, disabled: meta.disabled, inert: meta.inert };
}
async function readAccessibleCurrent(locator, node, options = {}) {
  const value = await readActualAx(locator, { ...options, expectedNode: node });
  return { ...selectNode(value), activeElementId: value.meta.activeElementId };
}
async function readAccessibleFocus(page, context, node, options = {}) {
  const value = await readActualAx(null, { ...options, page, active: true, context, expectedNode: node });
  if (!value) return null;
  const actual = selectNode(value);
  return { ...value.focus, name: actual.name, role: actual.role };
}
module.exports = { describeAccessibleElement, refreshAccessibleElement, readAccessibleMode, readAccessibleCurrent, readAccessibleFocus, semanticRole };
