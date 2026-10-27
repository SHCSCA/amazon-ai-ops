const { isDeepStrictEqual: same } = require('node:util');
const OWNED_ACCESSIBILITY_PROTOCOL = Object.freeze({ schemaVersion: 'v16.owned-app-accessibility/1',
  mode: 'native-tree-for-owned-reader', cleanupBoundary: 'owned-main-normal-exit',
  requiredFeatures: Object.freeze(['nativeAPIs', 'webContents', 'inlineTextBoxes', 'extendedProperties']) });
const handles = new WeakSet();
function validateOwnedAccessibilityProtocol(value = OWNED_ACCESSIBILITY_PROTOCOL) {
  if (!same(value, OWNED_ACCESSIBILITY_PROTOCOL)) throw new Error('UNIT_AX_FIXED_PROTOCOL_REQUIRED');
  return OWNED_ACCESSIBILITY_PROTOCOL;
}
// 旧焦点模型只隔离新增系统端口，不合成真实app设置、原生焦点或语音信用。
async function setupOwnedAccessibility({ binding, writer, deadline, protocol = OWNED_ACCESSIBILITY_PROTOCOL }) {
  validateOwnedAccessibilityProtocol(protocol);
  if (Date.now() >= deadline || !binding?.main) throw new Error('UNIT_AX_INVALID_BOUNDARY');
  const handle = Object.freeze({ receipt: writer.json('screen-reader/app-accessibility-setup.json', {
    kind: 'unit-owned-app-accessibility-port', unitOnly: true, formalCredit: false, nativeFocusCredit: false,
    setterCalls: 0, binding, protocol }) });
  handles.add(handle); return handle;
}
async function observeOwnedAccessibility(handle, { writer, assertActive = () => {} }) {
  assertActive(); if (!handles.has(handle)) throw new Error('UNIT_AX_HANDLE_REQUIRED');
  return writer.json('screen-reader/app-accessibility-ready.json', { unitOnly: true, formalCredit: false,
    nativeFocusCredit: false, setup: handle.receipt, setterCalls: 0 });
}
module.exports = { OWNED_ACCESSIBILITY_PROTOCOL, validateOwnedAccessibilityProtocol, setupOwnedAccessibility, observeOwnedAccessibility };
