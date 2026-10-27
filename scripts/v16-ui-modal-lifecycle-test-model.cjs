const { axModel } = require('./v16-ui-ax-test-model.cjs');
function loadProductionInert() {
  const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
  const file = 'apps/desktop/src/renderer/components/workspace/overlay-focus-scope.ts', source = fs.readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const selected = tree.statements.filter(node => ts.isFunctionDeclaration(node)
    && ['asOverlayInertTarget', 'makeOverlayBackgroundInert'].includes(node.name?.text));
  if (selected.length !== 2) throw new Error('EXACT_PRODUCTION_INERT_FUNCTIONS_REQUIRED');
  // 精确抽取生产纯函数，去除类型后执行；不装载 React 生命周期或启动实际界面。
  const code = ts.transpileModule(selected.map(node => node.getText(tree)).join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Set });
  return exports.makeOverlayBackgroundInert;
}
function modalModel(primitive, makeInert) {
  const f = axModel(), trigger = f.target, control = f.element('control-before', primitive === 'ReasonRequiredDialog' ? 'textbox' : 'button');
  const evaluate = f.locator.evaluate.bind(f.locator), pageEvaluate = f.page.evaluate.bind(f.page);
  const events = [], records = new Map(); let restore, active = false, restored = false;
  const root = { parentElement: null, attrs: { role: primitive === 'ReasonRequiredDialog' ? 'alertdialog' : 'dialog' } };
  root.parentElement = { children: [trigger, root], parentElement: null };
  trigger.axName = primitive === 'ReasonRequiredDialog' ? '人工审批' : '技术与证据详情'; control.axName = '现有关闭或原因控件';
  trigger.hasAttribute = key => Object.hasOwn(trigger.attrs, key);
  trigger.setAttribute = (key, value) => { trigger.attrs[key] = value; };
  trigger.removeAttribute = key => { delete trigger.attrs[key]; };
  trigger.closest = () => trigger.inert ? trigger : null;
  trigger.matches = () => Boolean(trigger.disabled);
  trigger.getBoundingClientRect = () => ({ toJSON: () => ({ x: restored ? 40 : 10, y: 20, width: 80, height: 30 }) });
  class Locator {
    constructor(element) { this.element = element; }
    page() { return f.page; }
    async evaluate(callback, request) { f.target = this.element; return evaluate(callback, request); }
    async focus() { f.document.activeElement = this.element; }
    async click() { events.push('open'); restore = makeInert(root); active = true; f.document.activeElement = control; }
    async waitFor() {}
    async isEnabled() { return true; }
    async isVisible() { return true; }
    async count() { return 1; }
    async getAttribute(key) { return this.element === root ? root.attrs[key] ?? null : this.element.getAttribute(key); }
    first() { return this; }
    filter() { return this; }
    getByRole() { return triggerLocator; }
    locator() { return controls; }
  }
  const triggerLocator = new Locator(trigger), controlLocator = new Locator(control), rootLocator = new Locator(root);
  const controls = { filter() { return this; }, count: async () => 1, nth: () => controlLocator,
    evaluateAll: async callback => callback([control]) };
  f.onSend = method => {
    f.name = f.target.axName; f.role = f.target.getAttribute('role'); f.ignored = Boolean(f.target.inert);
    if (method === 'Accessibility.getPartialAXTree') events.push((f.target === trigger ? 'trigger' : 'control') + '-AX-' + (active ? 'open' : 'closed'));
  };
  f.page.locator = selector => selector === '[role="dialog"],[role="alertdialog"]' ? { filter() { return this; }, count: async () => active ? 1 : 0 }
    : selector === '.policy-domain-runtime' ? { getByRole: () => triggerLocator }
      : selector.includes('.app-sidebar') || selector.includes('open-technical-inspector') ? triggerLocator : rootLocator;
  f.page.getByRole = () => triggerLocator;
  f.page.waitForFunction = async (callback, request) => { if (!await pageEvaluate(callback, request)) throw new Error('UNIT_RESTORE_FOCUS_MISSING'); };
  f.page.keyboard = { press: async key => {
    events.push(key);
    if (key === 'Escape') {
      if (active) {
        if (f.afterEscape !== 'inert') restore();
        restored = true; active = false;
        if (f.afterEscape === 'name') trigger.axName += '已改变';
        if (f.afterEscape === 'role') trigger.attrs.role = 'link';
        if (f.afterEscape === 'backend') f.backend = 999;
        if (f.afterEscape === 'disabled') trigger.disabled = true;
      }
      f.document.activeElement = f.afterEscape === 'focus' ? control : trigger;
    } else f.document.activeElement = control;
  } };
  const writer = { json(label, value) { records.set(label, value); return { label }; }, write(label, value) { records.set(label, value); return { label }; }, log: f.writer.log };
  const item = { primitive, entry: primitive === 'ReasonRequiredDialog' ? 'policy/rules' : 'execution/evidence',
    root: root.attrs.role === 'dialog' ? '[role="dialog"]' : '[role="alertdialog"]', open: primitive === 'ReasonRequiredDialog' ? 'reason' : 'inspector' };
  const [workspace, subview] = item.entry.split('/');
  return Object.assign(f, { trigger, control, triggerLocator, rootLocator, item, events, records, writer,
    runtime: { page: f.page }, ui: { EXPECTED_PACKAGE_UI_ENTRIES: [{ workspace, subview }], navigateToWorkspace: async () => events.push('navigate') },
    isOpen: () => active });
}
module.exports = { modalModel, loadProductionInert };
