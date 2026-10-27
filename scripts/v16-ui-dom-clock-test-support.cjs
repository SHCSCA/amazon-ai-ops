const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const START = Date.parse('2026-10-24T02:22:24.000Z');
const iso = value => new Date(value).toISOString();

function clock(initial, constructorTimes = []) {
  const state = { current: initial, calls: [], constructorTimes: [...constructorTimes] };
  class Clock extends Date {
    constructor(...args) {
      const value = args.length ? args : [state.constructorTimes.length ? state.constructorTimes.shift() : state.current];
      state.calls.push({ method: 'constructor', args: [...value], implicit: args.length === 0 });
      super(...value);
    }
    static now() { state.calls.push({ method: 'now', value: state.current }); return state.current; }
  }
  return Object.assign(state, { Date: Clock, set(value) { state.current = value; } });
}

function loadRuntime(directory, DatePort, stderr) {
  const loaded = new Map(), host = createRequire(path.join(directory, 'v16-ui-dom-clock-test-support.cjs'));
  const local = new Map([
    ['./v16-ui-accessible-node', 'v16-ui-accessible-node.js'],
    ['./v16-ui-ax-identity', 'v16-ui-ax-identity.js'],
  ]);
  const allowed = new Set(['node:crypto', 'node:util', './v16-performance-artifacts',
    '../packages/shared-types/src/runtime-log-format.cjs']);
  const sandbox = vm.createContext({ Date: DatePort, Error, Map, Set, WeakMap, Number, JSON, Math, Promise,
    setTimeout, clearTimeout, process: { stderr: { write(value) { stderr.push(value); } } } });
  function load(file) {
    if (loaded.has(file)) return loaded.get(file).exports;
    const module = { exports: {} }; loaded.set(file, module);
    const requirePort = request => {
      if (local.has(request)) return load(local.get(request));
      if (allowed.has(request)) return host(request);
      throw new Error('UNIT_UNKNOWN_CJS_DEPENDENCY:' + request);
    };
    const absolute = path.join(directory, file);
    vm.runInContext('(function(require,module,exports){' + fs.readFileSync(absolute, 'utf8') + '\n})',
      sandbox, { filename: absolute })(requirePort, module, module.exports);
    return module.exports;
  }
  return { dom: load('v16-ui-nvda-dom-focus.js'), accessible: load('v16-ui-accessible-node.js'),
    ax: load('v16-ui-ax-identity.js'), loaded };
}

function createDomClockModel(options = {}) {
  const directory = path.resolve('scripts'), stderr = [], evaluations = [];
  const nodeClock = clock(options.nodeNow ?? START + 100);
  const rendererClock = clock(options.rendererNow ?? START + 101, options.rendererTimes);
  const absolute = path.join(directory, 'v16-ui-ax-test-model.cjs'), module = { exports: {} };
  // 两个时钟只在各自执行域使用，原 AX 端口继续运行真实页面回调。
  vm.runInNewContext(fs.readFileSync(absolute, 'utf8'), { module, exports: module.exports, Date: rendererClock.Date, Error,
    require(request) { if (request === 'node:vm') return vm; throw new Error('UNIT_UNKNOWN_AX_MODEL_DEPENDENCY:' + request); } },
  { filename: absolute });
  const f = module.exports.axModel(), runtime = loadRuntime(directory, nodeClock.Date, stderr);
  const evaluate = f.page.evaluate;
  f.page.evaluate = async (callback, request) => {
    const value = await evaluate(callback, request);
    evaluations.push({ name: callback.name, request, value });
    if (callback.name === 'registerProbe') await model.afterRegister?.(value, request);
    if (callback.name === 'finishProbe') await model.afterFinish?.(value, request);
    return value;
  };
  const model = { f, runtime, stderr, evaluations, nodeClock, rendererClock, activeChecks: 0,
    assertActive() {
      model.activeChecks++;
      if (f.stopped) throw new Error('UNIT_STOPPED');
      model.afterActive?.();
    },
    async prepare(overrides = {}) {
      model.node = await runtime.accessible.describeAccessibleElement(f.locator, 'unit-node');
      model.context = { nonce: 'unit-clock-phase', phase: 'first-focus', phaseStartedAt: iso(START),
        deadline: START + 10000, ...overrides };
      f.window.__amazonAiOpsDomFocus = { ...model.context, closed: false, target: f.target, before: f.target };
      model.readSessionStart = f.sessions.length;
      model.readEvaluationStart = evaluations.length;
      return model;
    },
    read(node = model.node) {
      return runtime.dom.readDomFocus({ page: f.page }, model.context, model.context.deadline, node, model.assertActive);
    },
    readEvaluations() { return evaluations.slice(model.readEvaluationStart); },
    readSessions() { return f.sessions.slice(model.readSessionStart); },
  };
  const readAccessibleFocus = runtime.accessible.readAccessibleFocus;
  runtime.accessible.readAccessibleFocus = async (...args) => {
    const value = await readAccessibleFocus(...args);
    model.accessibleReads = (model.accessibleReads || 0) + 1;
    model.nodeAfterAccessibleClockStart = nodeClock.calls.length;
    await model.afterAccessible?.(value);
    return value;
  };
  return model;
}

module.exports = { START, iso, clock, createDomClockModel };
