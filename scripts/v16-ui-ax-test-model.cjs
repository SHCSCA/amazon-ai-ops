const vm = require('node:vm');
function axModel() {
  const f = { name: '今日总览 生产', role: 'tab', calls: [], logs: [], sessions: [], now: Date.now(), stopped: false };
  const window = {}; window.top = window;
  const document = { activeElement: null, hasFocus: () => true };
  function element(id, role = 'tab', name = '今日总览生产') {
    return { tagName: 'BUTTON', type: 'submit', dataset: {}, tabIndex: 0, isConnected: true, ownerDocument: document,
      attrs: { 'data-v16-a11y-node': id, role, 'aria-selected': 'true' }, textContent: name,
      getAttribute(key) { return key === 'data-v16-a11y-node' ? this.dataset.v16A11yNode || this.attrs[key] : this.attrs[key] || null; },
      matches: () => false, closest: () => null, getBoundingClientRect: () => ({ toJSON: () => ({ x: 1, y: 2, width: 30, height: 20 }) }) };
  }
  f.target = element('unit-node'); f.active = f.target; document.activeElement = f.target;
  const vmContext = vm.createContext({ window, document, Map, Date, Error });
  const run = (callback, args, receiver) => vm.runInContext('(' + callback.toString() + ')', vmContext).apply(receiver, args);
  const page = { url: () => 'file:///unit/index.html', evaluate: async (callback, request) => {
    const value = run(callback, [request]); await f.onEvaluate?.(callback.name, request); return value;
  }, context: () => ({
    newCDPSession: async () => {
      const session = { detached: false, objects: new Map(), axReads: 0, frameReads: 0,
        async send(method, params) {
          f.calls.push({ method, params });
          if (f.onSend) await f.onSend(method, params, session);
          if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: f.frame || 'frame-1', loaderId: f.loader || 'loader-1', url: page.url() } } };
          if (method === 'DOM.getDocument') return { root: { nodeId: 1, backendNodeId: f.documentBackend || 10 } };
          if (method === 'DOM.querySelectorAll') {
            if (f.duplicate) return { nodeIds: [2, 3] };
            const active = params.selector === ':focus';
            return { nodeIds: [active && document.activeElement !== f.target ? 3 : 2] };
          }
          if (method === 'DOM.describeNode') return { node: { backendNodeId: params.nodeId === 2 ? f.backend || 20 : 30 } };
          if (method === 'DOM.resolveNode') {
            const objectId = 'object-' + params.nodeId + '-' + session.objects.size;
            session.objects.set(objectId, params.nodeId === 2 ? (f.replaced || f.target) : document.activeElement);
            return { object: { objectId } };
          }
          if (method === 'Runtime.callFunctionOn') return { result: { value: run(params.functionDeclaration,
            [params.arguments[0].value], session.objects.get(params.objectId)) } };
          if (method === 'Accessibility.getPartialAXTree') {
            session.axReads++;
            const nodes = [{ ignored: Boolean(f.ignored), backendDOMNodeId: f.badBackend ? 999 : params.nodeId === 2 ? f.backend || 20 : 30,
              name: { value: f.empty ? '' : f.changeName && session.axReads > 1 ? f.name + '变化' : f.name },
              role: { value: f.changeRole && session.axReads > 1 ? 'button' : f.role }, value: { value: 'UNIT_SECRET_NEVER_PERSIST' } }];
            return { nodes: f.multiple ? [...nodes, ...nodes] : nodes };
          }
          if (method === 'Runtime.releaseObject') { if (f.releaseFailure) throw new Error('UNIT_RELEASE_FAILED'); return {}; }
          throw new Error('UNIT_UNEXPECTED_CDP:' + method);
        }, async detach() { session.detached = true; await f.onDetach?.(); if (f.detachFailure) throw new Error('UNIT_DETACH_FAILED'); } };
      f.sessions.push(session); return session;
    } }) };
  const locator = { page: () => page, evaluate: async (callback, request) => run(callback, [f.target, request]) };
  const writer = { log(event, error, metadata) { f.logs.push({ event, message: error.message, metadata }); } };
  return Object.assign(f, { page, locator, document, window, element, writer,
    options: () => ({ deadline: Date.now() + 10000, writer, assertActive() { if (f.stopped) throw new Error('UNIT_STOPPED'); } }) });
}
module.exports = { axModel };
