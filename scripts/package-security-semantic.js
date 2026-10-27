const { parse } = require('acorn');
const { createHash } = require('node:crypto');
const { AUDITED_STARTUP_PROGRAMS, AUDITED_STARTUP_FUNCTIONS, AUDITED_REGISTRATION_PREFIXES } = require('./package-security-audited-startup');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');

const PARSE_OPTIONS = Object.freeze({ ecmaVersion: 2022, sourceType: 'script' });
const LEGACY_CHANNEL = ['browser', 'get-saved-credentials'].join(':');
const STATUS_CHANNEL = 'browser:get-saved-credential-status';

function children(node) {
  return Object.values(node).flatMap(value => Array.isArray(value) ? value : [value])
    .filter(value => value && typeof value.type === 'string');
}

function walk(root, includeNested = true) {
  const result = [], pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    result.push(node);
    if (includeNested || node === root || !/Function/.test(node.type)) pending.push(...children(node));
  }
  return result;
}

function shape(node) {
  return JSON.stringify(node, (key, value) => ['start', 'end', 'raw'].includes(key) ? undefined : value);
}

function expression(source) {
  return parse('(' + source + ')', PARSE_OPTIONS).body[0].expression;
}

function same(node, source) {
  if (node?.type === 'ObjectPattern') node = { ...node, type: 'ObjectExpression' };
  if (node?.type === 'AssignmentPattern') node = { type: 'AssignmentExpression', operator: '=', left: node.left, right: node.right };
  return shape(node) === shape(expression(source));
}
function id(node, name) { return node?.type === 'Identifier' && node.name === name; }
function propName(node) {
  if (!node) return null;
  return node.computed ? node.property?.value : node.property?.name;
}
function member(node, property) { return node?.type === 'MemberExpression' && propName(node) === property; }
function called(node, name) { return node?.type === 'CallExpression' && id(node.callee, name) && !node.optional; }
function ensure(value) { if (!value) throw new Error('PACKAGE_SECURITY_SEMANTIC_CONTRACT_MISMATCH'); return value; }
function exactlyOne(values) { ensure(values.length === 1); return values[0]; }

function objectFields(node) {
  ensure(node?.type === 'ObjectExpression');
  const fields = new Map();
  for (const property of node.properties) {
    ensure(property.type === 'Property' && !property.computed && property.kind === 'init' && !property.method);
    const name = property.key.name ?? property.key.value;
    ensure(typeof name === 'string' && !fields.has(name));
    fields.set(name, property.value);
  }
  return fields;
}

function namedFunction(index, name) {
  const fn = exactlyOne(index.nodes.filter(node => node.type === 'FunctionDeclaration' && id(node.id, name)));
  ensure(index.parents.get(fn) === index.ast && !fn.async && !fn.generator);
  ensure(!(index.variables.get(name)?.length));
  return fn;
}

function bindingNames(pattern) {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern.name];
  if (pattern.type === 'RestElement') return bindingNames(pattern.argument);
  if (pattern.type === 'AssignmentPattern') return bindingNames(pattern.left);
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(bindingNames);
  if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap(p => bindingNames(p.value ?? p.argument));
  return [];
}

function declarations(root, name) {
  return walk(root).filter(node => node.type === 'VariableDeclarator' && bindingNames(node.id).includes(name));
}

function local(index, fn, name, expected) {
  const declaration = exactlyOne(declarations(fn, name));
  ensure(id(declaration.id, name) && index.parents.get(declaration)?.kind === 'const');
  if (expected) ensure(same(declaration.init, expected));
  return declaration;
}

function rootName(node) {
  while (node?.type === 'MemberExpression') node = node.object;
  return node?.type === 'Identifier' ? node.name : null;
}

function writtenRoots(node) {
  if (!node) return [];
  if (node.type === 'Identifier' || node.type === 'MemberExpression') return [rootName(node)];
  if (node.type === 'RestElement') return writtenRoots(node.argument);
  if (node.type === 'AssignmentPattern') return writtenRoots(node.left);
  if (node.type === 'ArrayPattern') return node.elements.flatMap(writtenRoots);
  if (node.type === 'ObjectPattern') return node.properties.flatMap(property => writtenRoots(property.value ?? property.argument));
  return [];
}

function immutable(root, names, allowedAssignments = []) {
  for (const node of walk(root)) {
    if (node.type === 'AssignmentExpression') ensure(allowedAssignments.includes(node) || !writtenRoots(node.left).some(name => names.includes(name)));
    if (['ForInStatement', 'ForOfStatement'].includes(node.type) && node.left.type !== 'VariableDeclaration') ensure(!writtenRoots(node.left).some(name => names.includes(name)));
    if (node.type === 'UpdateExpression' || node.type === 'UnaryExpression' && node.operator === 'delete') {
      ensure(!names.includes(rootName(node.argument)));
    }
  }
}

function noShadow(root, names, allowed = []) {
  for (const node of walk(root)) {
    if (node.type === 'VariableDeclarator') {
      for (const name of bindingNames(node.id)) if (names.includes(name)) ensure(allowed.includes(node));
    }
    if (/Function/.test(node.type)) {
      if (node !== root) for (const param of node.params) ensure(!bindingNames(param).some(name => names.includes(name)));
      if (node !== root && node.id) ensure(!names.includes(node.id.name));
    }
    if (['ClassDeclaration', 'ClassExpression'].includes(node.type) && node.id) ensure(!names.includes(node.id.name));
    if (node.type === 'CatchClause') ensure(!bindingNames(node.param).some(name => names.includes(name)));
  }
}

function bindingIdentifiers(pattern) {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern];
  if (pattern.type === 'RestElement') return bindingIdentifiers(pattern.argument);
  if (pattern.type === 'AssignmentPattern') return bindingIdentifiers(pattern.left);
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(bindingIdentifiers);
  if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap(p => bindingIdentifiers(p.value ?? p.argument));
  return [];
}

function onlyUses(index, scope, name, allowed) {
  for (const node of walk(scope)) {
    if (!id(node, name) || index.bindingIds.has(node)) continue;
    let parent = index.parents.get(node);
    if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) continue;
    if (['Property', 'PropertyDefinition', 'MethodDefinition'].includes(parent?.type) && parent.key === node && parent.value !== node && !parent.computed) continue;
    let value = node;
    while (index.parents.get(value)?.type === 'MemberExpression' && index.parents.get(value).object === value) value = index.parents.get(value);
    parent = index.parents.get(value);
    ensure(allowed(value, parent));
  }
}

function programBindingNames(ast) {
  const names = [], pending = [...ast.body];
  while (pending.length) {
    const node = pending.pop();
    if (/Function/.test(node.type)) {
      if (node.type === 'FunctionDeclaration' && node.id) names.push(node.id.name);
      continue;
    }
    if (['ClassDeclaration', 'ClassExpression'].includes(node.type)) {
      if (node.type === 'ClassDeclaration' && node.id) names.push(node.id.name);
      continue;
    }
    if (node.type === 'VariableDeclarator') names.push(...bindingNames(node.id));
    if (node.type === 'CatchClause') names.push(...bindingNames(node.param));
    pending.push(...children(node));
  }
  return names;
}

function verifyAcornPrototypeRead(index, value, declaration) {
  ensure(declaration?.type === 'VariableDeclarator' && declaration.init === value && declaration.id.type === 'Identifier');
  let owner = index.parents.get(declaration);
  while (owner && !/Function/.test(owner.type)) owner = index.parents.get(owner);
  ensure(owner);
  let module = owner, acornModule = false;
  while (module) {
    if (module.type === 'Property' && module.method && module.key?.value === '../../node_modules/.pnpm/acorn@8.16.0/node_modules/acorn/dist/acorn.js') acornModule = true;
    module = index.parents.get(module);
  }
  ensure(acornModule);
  const name = declaration.id.name;
  for (const node of walk(owner)) {
    if (!id(node, name) || index.bindingIds.has(node)) continue;
    let parent = index.parents.get(node);
    if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) continue;
    if (parent?.type === 'Property' && parent.key === node && parent.value !== node && !parent.computed) continue;
    let enclosing = index.parents.get(node), ownBinding = false;
    while (enclosing && enclosing !== owner) {
      if (/Function/.test(enclosing.type)) {
        ownBinding = enclosing.params.some(param => bindingNames(param).includes(name))
          || walk(enclosing, false).some(child => child.type === 'VariableDeclarator' && index.parents.get(child)?.kind === 'var' && bindingNames(child.id).includes(name));
        if (ownBinding) break;
      }
      enclosing = index.parents.get(enclosing);
    }
    if (ownBinding) continue;
    ensure(parent?.type === 'MemberExpression' && parent.object === node && !parent.computed && ['hasOwnProperty', 'toString'].includes(parent.property.name));
    const use = index.parents.get(parent);
    ensure(use?.type === 'VariableDeclarator' && use.id.type === 'Identifier' && use.init === parent);
  }
}

function verifyBuiltinObjectUses(index) {
  const reads = ['assign', 'create', 'defineProperty', 'defineProperties', 'entries', 'freeze', 'fromEntries',
    'getOwnPropertyDescriptor', 'getOwnPropertyNames', 'getPrototypeOf', 'hasOwn', 'isFrozen', 'keys', 'values'];
  onlyUses(index, index.ast, 'Object', (value, parent) => {
    if (same(value, 'Object.prototype')) { verifyAcornPrototypeRead(index, value, parent); return true; }
    return anySame(value, reads.map(name => 'Object.' + name).concat(['Object.prototype.hasOwnProperty', 'Object.prototype.hasOwnProperty.call']));
  });
}

function anySame(node, sources) { return sources.some(source => same(node, source)); }
function primitiveRead(node, parent, sources) {
  return anySame(node, sources) && !(parent?.type === 'CallExpression' && parent.callee === node)
    && !(parent?.type === 'NewExpression' && parent.callee === node);
}
function argumentOf(node, parent, source) { return parent?.type === 'CallExpression' && parent.arguments.includes(node) && same(parent, source); }
function objectValue(node, parent, object, name) {
  return parent?.type === 'Property' && parent.value === node && indexProperty(object, name) === parent;
}
function indexProperty(object, name) {
  return object?.properties?.find(property => property.type === 'Property' && !property.computed && (property.key.name ?? property.key.value) === name);
}

function verifyFactoryObjectUses(index, factory, windowFn, destructure, target, load) {
  // 受保护对象只开放现有读取和调用端口，别名、展开与未知传参均不能写入配置。
  onlyUses(index, factory, 'runtime', (value, parent) =>
    value === destructure.init
    || primitiveRead(value, parent, ['runtime.preloadPath', 'runtime.userDataDir', 'runtime.packageLaunchSmoke'])
    || parent?.type === 'CallExpression' && parent.callee === value && anySame(parent, ['runtime.onCreated(createdWindow)', 'runtime.onClosed(createdWindow)']));
  onlyUses(index, windowFn, 'createdWindow', (value, parent) => {
    if (id(value, 'createdWindow')) {
      return argumentOf(value, parent, 'runtime.onCreated(createdWindow)')
        || argumentOf(value, parent, 'runtime.onClosed(createdWindow)')
        || argumentOf(value, parent, 'installRendererProcessErrorHandler(createdWindow, runtimeLogger, runtime.preloadPath)')
        || parent?.type === 'ReturnStatement' && ownReturns(windowFn).includes(parent) && parent.argument === value;
    }
    if (primitiveRead(value, parent, ['createdWindow.id'])) return true;
    if (parent?.type !== 'CallExpression' || parent.callee !== value) return false;
    if (anySame(parent, ['createdWindow.show()', 'createdWindow.focus()', 'createdWindow.isDestroyed()', 'createdWindow.webContents.isDestroyed()', 'createdWindow.webContents.getURL()'])) return true;
    if ([load.init.consequent, load.init.alternate].includes(parent)) return true;
    if (same(parent, 'createdWindow.webContents.openDevTools()')) return true;
    if (same(parent, 'createdWindow.on("closed", () => runtime.onClosed(createdWindow))')) return true;
    if (member(value, 'once') && parent.arguments.length === 2 && parent.arguments[1]?.type === 'ArrowFunctionExpression') {
      return same(value, 'createdWindow.once') && parent.arguments[0]?.value === 'ready-to-show'
        || same(value, 'createdWindow.webContents.once') && parent.arguments[0]?.value === 'did-finish-load';
    }
    if (same(value, 'createdWindow.webContents.on')) return ['will-navigate', 'will-redirect'].includes(parent.arguments[0]?.value);
    return same(value, 'createdWindow.webContents.setWindowOpenHandler') && parent.arguments.length === 1 && called(parent.arguments[0], 'createSecureWindowOpenHandler');
  });
  onlyUses(index, windowFn, 'trustedRendererTarget', (value, parent) => {
    if (!id(value, 'trustedRendererTarget') || parent?.type !== 'Property' || parent.value !== value || parent.key?.name !== 'target') return false;
    const object = index.parents.get(parent), call = index.parents.get(object);
    return called(call, 'createMainWindowNavigationHandler') && call.arguments[0] === object;
  });
  onlyUses(index, windowFn, 'rendererLoad', (value, parent) => member(value, 'catch') && parent?.type === 'CallExpression'
    && parent.callee === value && parent.arguments.length === 1 && parent.arguments[0]?.type === 'ArrowFunctionExpression');
}

function verifyInputObjectUses(index, configure) {
  const scalarPaths = ['input.isPackaged', 'input.environment.NODE_ENV', 'input.environment.AMAZON_AI_OPS_FINAL_READINESS_PATH', 'input.environment.FINAL_READINESS_PATH',
    'input.environment[PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV]', 'input.evidenceIdentity.mode', 'input.evidenceIdentity.overridden', 'input.evidenceIdentity.userDataDir'];
  onlyUses(index, configure, 'input', (value, parent) => primitiveRead(value, parent, scalarPaths)
    || id(value, 'input') && parent?.type === 'VariableDeclarator' && parent.init === value
      && same(parent.id, '{ userDataDir, repositoryRoot, mainModulePath, executablePath }'));
}

function verifyBootstrapObjectUses(index, initialize, source, environment, configuration) {
  const finallyDeletes = walk(initialize).filter(node => node.type === 'UnaryExpression' && node.operator === 'delete' && same(node.argument, 'sourceEnvironment[name]'));
  for (const deletion of finallyDeletes) {
    let block = index.parents.get(deletion);
    while (block && block.type !== 'TryStatement' && block !== initialize) block = index.parents.get(block);
    ensure(block?.type === 'TryStatement' && block.finalizer);
    const expected = '{ for (const name of Object.values(S7_STARTUP_GATE_ENV)) { if (!Object.prototype.hasOwnProperty.call(gateEnvironment, name)) delete sourceEnvironment[name]; } }';
    ensure(shape(block.finalizer) === shape(parse('function f() ' + expected, PARSE_OPTIONS).body[0].body));
    ensure(block.start > configuration.end);
  }
  onlyUses(index, initialize, 'sourceEnvironment', (value, parent) =>
    argumentOf(value, parent, 'captureBootstrapEnvironment(sourceEnvironment)') || finallyDeletes.some(node => node.argument === value));
  onlyUses(index, initialize, 'options', (value, parent) => value === source.init.left || primitiveRead(value, parent,
    ['options.repositoryRoot', 'options.mainModulePath', 'options.executablePath']));
  onlyUses(index, initialize, 'electronApp', (value, parent) => primitiveRead(value, parent, ['electronApp.isPackaged'])
    || parent?.type === 'CallExpression' && parent.callee === value && anySame(parent,
      ['electronApp.getPath("userData")', 'electronApp.requestSingleInstanceLock()', 'electronApp.exit(78)'])
    || argumentOf(value, parent, 'dependencies.configureEvidencePath(electronApp, environment)'));
  const returned = exactlyOne(ownReturns(initialize)).argument.arguments[0];
  onlyUses(index, initialize, 'environment', (value, parent) =>
    objectValue(value, parent, configuration.init.arguments[0], 'environment')
    || argumentOf(value, parent, 'dependencies.configureEvidencePath(electronApp, environment)')
    || argumentOf(value, parent, 'dependencies.resolveCanonicalPath(environment)')
    || parent?.type === 'SpreadElement' && index.parents.get(parent)?.type === 'ObjectExpression'
      && index.parents.get(index.parents.get(parent))?.type === 'VariableDeclarator'
      && id(index.parents.get(index.parents.get(parent)).id, 'gateEnvironment'));
  onlyUses(index, initialize, 'configuration', (value, parent) =>
    objectValue(value, parent, returned, 'configuration')
    || primitiveRead(value, parent, ['configuration.paths.logsDir', 'configuration.paths.userDataDir', 'configuration.packageLaunchSmoke', 'configuration.executablePath', 'configuration.mainModulePath'])
    || argumentOf(value, parent, 'dependencies.logger.setOutputDirectory(configuration.paths.logsDir, configuration.runtimeLogRetention)')
    || same(value, 'configuration.evidenceIdentity') && parent?.type === 'Property' && parent.key?.name === 'evidenceUserDataIdentity');
}

function verifyContextObjectUses(index, context, runtime, boot, config, factoryCall) {
  onlyUses(index, context, 'runtime', (value, parent) =>
    argumentOf(value, parent, 'Object.freeze(runtime)')
    || id(value, 'runtime') && parent?.type === 'ReturnStatement' && ownReturns(context).includes(parent));
  onlyUses(index, context, 'desktopBootstrap', (value, parent) =>
    value === config.init || same(value, 'desktopBootstrap.admission') && (parent?.type === 'VariableDeclarator' && id(parent.id, 'mainStartupAdmission') || objectValue(value, parent, runtime.init, 'mainStartupAdmission'))
    || objectValue(value, parent, runtime.init, 'desktopBootstrap'));
  onlyUses(index, context, 'bootstrapConfiguration', (value, parent) =>
    objectValue(value, parent, runtime.init, 'bootstrapConfiguration')
    || primitiveRead(value, parent, ['bootstrapConfiguration.development', 'bootstrapConfiguration.paths.preloadPath', 'bootstrapConfiguration.paths.rendererFilePath', 'bootstrapConfiguration.mainModulePath', 'bootstrapConfiguration.executablePath', 'bootstrapConfiguration.packageUiReadOnly', 'bootstrapConfiguration.packageUiFreshTypedProofRequired', 'bootstrapConfiguration.packageLaunchSmoke', 'bootstrapConfiguration.evidenceIdentity'])
    || same(value, 'bootstrapConfiguration.paths') && (parent?.type === 'VariableDeclarator' && parent.id.type === 'ObjectPattern' && parent.id.properties.every(property => property.type === 'Property' && !property.computed)
      || parent?.type === 'Property' && parent.key?.name === 'paths' && (() => {
        const object = index.parents.get(parent), call = index.parents.get(object);
        return call?.type === 'CallExpression' && ['createDeliveryRuntime', 'createDeliveryBundleExporter'].some(name => called(call, name)) && call.arguments[0] === object;
      })()));
  onlyUses(index, context, 'createWindow', (value, parent) =>
    objectValue(value, parent, runtime.init, 'createWindow') || parent?.type === 'CallExpression' && parent.callee === value && same(parent, 'createWindow({ forceVisible: true })'));
}

function ownReturns(fn) { return walk(fn, false).filter(node => node.type === 'ReturnStatement'); }
function uniqueCall(index, name) { return exactlyOne(index.nodes.filter(node => called(node, name))); }

function electronNamespace(index, name) {
  const declaration = exactlyOne(index.nodes.filter(node => node.type === 'VariableDeclarator' && id(node.id, name)));
  ensure(index.parents.get(index.parents.get(declaration)) === index.ast);
  ensure(same(declaration.init, 'require("electron")'));
  immutable(index.ast, [name]);
  onlyUses(index, index.ast, name, (value, parent) => {
    if (same(value, name + '.app')) return parent?.type === 'CallExpression' && called(parent, 'initializeDesktopBootstrap') && parent.arguments[0] === value;
    if (same(value, name + '.ipcMain')) return parent?.type === 'CallExpression' && called(parent, 'createTrackedIpcRegistrar') && parent.arguments[0] === value;
    if (same(value, name + '.BrowserWindow')) return parent?.type === 'NewExpression' && parent.callee === value;
    return parent?.type === 'CallExpression' && parent.callee === value && anySame(value, ['.app.quit', '.dialog.showErrorBox', '.dialog.showMessageBox', '.safeStorage.decryptString', '.safeStorage.encryptString', '.safeStorage.isEncryptionAvailable'].map(port => name + port));
  });
  return declaration;
}

function assertCallBound(index, call, fn) {
  ensure(index.nodes.includes(fn) && id(call.callee, fn.id.name));
  let parent = index.parents.get(call);
  while (parent && parent !== index.ast) {
    if (/Function/.test(parent.type)) noShadow(parent, [fn.id.name]);
    parent = index.parents.get(parent);
  }
  immutable(index.ast, [fn.id.name]);
}

function verifyRuntimeAccess(index) {
  immutable(index.ast, ['installMainRuntimeContext', 'getMainRuntimeContext']);
  const install = namedFunction(index, 'installMainRuntimeContext');
  const get = namedFunction(index, 'getMainRuntimeContext');
  ensure(shape(install.body) === shape(parse('function f(runtime) { if (currentRuntime) throw new Error("MAIN_RUNTIME_ALREADY_INSTALLED"); currentRuntime = runtime; }', PARSE_OPTIONS).body[0].body));
  ensure(shape(get.body) === shape(parse('function f() { if (!currentRuntime) throw new Error("MAIN_RUNTIME_NOT_INSTALLED"); return currentRuntime; }', PARSE_OPTIONS).body[0].body));
  ensure(install.params.length === 1 && id(install.params[0], 'runtime') && get.params.length === 0);
  const storage = exactlyOne(index.ast.body.filter(node => node.type === 'VariableDeclaration')
    .flatMap(node => node.declarations).filter(node => id(node.id, 'currentRuntime')));
  ensure(storage.init?.type === 'Literal' && storage.init.value === null);
  const storedNodes = new Set([...walk(install), ...walk(get)]);
  noShadow(install, ['currentRuntime']);
  noShadow(get, ['currentRuntime']);
  // 存储只允许原安装和读取节点；循环左值、对象逃逸和额外读取均不授予身份。
  onlyUses(index, index.ast, 'currentRuntime', (value, parent) => id(value, 'currentRuntime') && storedNodes.has(value)
    && (parent?.type === 'IfStatement' || parent?.type === 'UnaryExpression' && parent.operator === '!'
      || parent?.type === 'ReturnStatement' || parent?.type === 'AssignmentExpression' && parent.left === value && id(parent.right, 'runtime')));
  ensure(declarations(index.ast, 'currentRuntime').length === 1);
  return { install, get };
}

function verifyEnvironment(index, capture) {
  ensure(capture.params.length === 1 && same(capture.params[0], 'environment = process.env'));
  const expected = 'function f(environment = process.env) { const snapshot = {}; for (const key of BOOTSTRAP_ENVIRONMENT_KEYS) { if (Object.prototype.hasOwnProperty.call(environment, key)) { const value = environment[key]; if (value !== void 0) snapshot[key] = value; } } return Object.freeze(snapshot); }';
  ensure(shape(capture.body) === shape(parse(expected, PARSE_OPTIONS).body[0].body));
  const keys = exactlyOne(index.ast.body.filter(node => node.type === 'VariableDeclaration')
    .flatMap(node => node.declarations).filter(node => id(node.id, 'BOOTSTRAP_ENVIRONMENT_KEYS')));
  ensure(called(keys.init, 'Object') === false && keys.init?.type === 'CallExpression');
  ensure(same(keys.init.callee, 'Object.freeze') && keys.init.arguments.length === 1);
  const values = keys.init.arguments[0];
  ensure(values.type === 'ArrayExpression' && values.elements.filter(node => node?.type === 'Literal' && node.value === 'NODE_ENV').length === 1);
  immutable(index.ast, ['BOOTSTRAP_ENVIRONMENT_KEYS']);
  noShadow(capture, ['Object', 'process', 'BOOTSTRAP_ENVIRONMENT_KEYS']);
}

function verifyFactory(index, factory) {
  ensure(factory.params.length === 1 && id(factory.params[0], 'runtime'));
  const created = exactlyOne(ownReturns(factory));
  const windowFn = created.argument;
  ensure(windowFn?.type === 'FunctionExpression' && id(windowFn.id, 'createWindow'));
  const window = local(index, windowFn, 'createdWindow');
  ensure(window.init?.type === 'NewExpression' && member(window.init.callee, 'BrowserWindow') && id(window.init.callee.object, window.init.callee.object.name));
  electronNamespace(index, window.init.callee.object.name);
  const destructure = exactlyOne(declarations(windowFn, 'development'));
  ensure(same(destructure.id, '{ development, rendererFilePath }') && id(destructure.init, 'runtime'));
  ensure(index.parents.get(destructure)?.kind === 'const');
  const target = local(index, windowFn, 'trustedRendererTarget', 'development ? { kind: "development", rendererUrl: "http://localhost:5173" } : { kind: "packaged", rendererFilePath }');
  const load = local(index, windowFn, 'rendererLoad', 'development ? createdWindow.loadURL("http://localhost:5173") : createdWindow.loadFile(rendererFilePath)');
  const devtools = exactlyOne(walk(windowFn).filter(node => node.type === 'IfStatement' && id(node.test, 'development')));
  ensure(!devtools.alternate && same(devtools.consequent.expression, 'createdWindow.webContents.openDevTools()'));
  for (const [name, expected] of [['loadURL', load.init.consequent.callee], ['loadFile', load.init.alternate.callee], ['openDevTools', devtools.consequent.expression.callee]]) {
    const references = walk(windowFn).filter(node => member(node, name));
    ensure(references.length === 1 && references[0] === expected);
  }
  ensure(!walk(windowFn).some(node => node.type === 'MemberExpression' && node.computed && ['createdWindow', 'runtime'].includes(rootName(node))));
  ensure(!walk(windowFn).some(node => node.type === 'VariableDeclarator' && node.id.type !== 'Identifier' && id(node.init, 'createdWindow')));
  const protectedNames = ['runtime', 'createdWindow', 'development', 'rendererFilePath', 'rendererLoad', 'trustedRendererTarget'];
  immutable(windowFn, protectedNames);
  noShadow(windowFn, protectedNames, [window, destructure, target, load]);
  immutable(factory, ['runtime']);
  noShadow(factory, ['runtime']);
  for (const event of ['will-navigate', 'will-redirect']) {
    const wiring = exactlyOne(walk(windowFn).filter(node => node.type === 'CallExpression' && same(node.callee, 'createdWindow.webContents.on') && node.arguments[0]?.value === event));
    const handler = wiring.arguments[1];
    ensure(wiring.arguments.length === 2 && called(handler, 'createMainWindowNavigationHandler') && handler.arguments.length === 1);
    ensure(id(objectFields(handler.arguments[0]).get('target'), 'trustedRendererTarget'));
  }
  noShadow(factory, ['Object', 'process']);
  ensure(windowFn.params.length === 1 && same(windowFn.params[0], 'options = {}'));
  verifyFactoryObjectUses(index, factory, windowFn, destructure, target, load);
  return windowFn;
}

function verifyBusGuard(index) {
  const names = ['captureBootstrapEnvironment', 'createBootstrapConfiguration', 'initializeDesktopBootstrap', 'createMainRuntimeContext', 'createDesktopWindowFactory', 'startDesktopApplication'];
  const functions = new Map(names.map(name => [name, namedFunction(index, name)]));
  for (const [name, fn] of functions) assertCallBound(index, uniqueCall(index, name), fn);
  const capture = functions.get('captureBootstrapEnvironment');
  verifyEnvironment(index, capture);
  const configure = functions.get('createBootstrapConfiguration');
  ensure(configure.params.length === 1 && id(configure.params[0], 'input'));
  const configReturn = exactlyOne(ownReturns(configure)).argument;
  ensure(configReturn?.type === 'CallExpression' && same(configReturn.callee, 'Object.freeze') && configReturn.arguments.length === 1);
  ensure(same(objectFields(configReturn.arguments[0]).get('development'), '!input.isPackaged && input.environment.NODE_ENV === "development"'));
  immutable(configure, ['input']);
  verifyInputObjectUses(index, configure);
  noShadow(configure, ['Object', 'process', 'input']);
  const initialize = functions.get('initializeDesktopBootstrap');
  ensure(shape(initialize.params) === shape(parse('function f(electronApp, options, overrides = {}) {}', PARSE_OPTIONS).body[0].params));
  const source = local(index, initialize, 'sourceEnvironment', 'options.environment ?? process.env');
  const environment = local(index, initialize, 'environment', 'captureBootstrapEnvironment(sourceEnvironment)');
  const configuration = local(index, initialize, 'configuration', 'createBootstrapConfiguration({ environment, isPackaged: electronApp.isPackaged, evidenceIdentity, userDataDir, repositoryRoot: options.repositoryRoot, mainModulePath: options.mainModulePath, executablePath: options.executablePath })');
  ensure(same(exactlyOne(ownReturns(initialize)).argument, 'Object.freeze({ configuration, admission })'));
  immutable(initialize, ['electronApp', 'options', 'environment', 'configuration']);
  verifyBootstrapObjectUses(index, initialize, source, environment, configuration);
  noShadow(initialize, ['process', 'Object', 'sourceEnvironment', 'environment', 'configuration', 'captureBootstrapEnvironment', 'createBootstrapConfiguration'], [source, environment, configuration]);
  const context = functions.get('createMainRuntimeContext');
  ensure(context.params.length === 1 && id(context.params[0], 'mainModulePath'));
  const boot = local(index, context, 'desktopBootstrap');
  ensure(called(boot.init, 'initializeDesktopBootstrap') && boot.init.arguments.length === 2);
  const app = boot.init.arguments[0];
  ensure(member(app, 'app') && app.object.type === 'Identifier');
  electronNamespace(index, app.object.name);
  ensure(same(boot.init.arguments[1], '{ repositoryRoot: process.cwd(), executablePath: process.execPath, mainModulePath }'));
  const config = local(index, context, 'bootstrapConfiguration', 'desktopBootstrap.configuration');
  const factoryCall = local(index, context, 'createWindow');
  ensure(called(factoryCall.init, 'createDesktopWindowFactory') && factoryCall.init.arguments.length === 1);
  const windowOptions = objectFields(factoryCall.init.arguments[0]);
  ensure(same(windowOptions.get('development'), 'bootstrapConfiguration.development'));
  ensure(same(windowOptions.get('rendererFilePath'), 'bootstrapConfiguration.paths.rendererFilePath'));
  for (const name of ['onCreated', 'onClosed']) {
    const callback = windowOptions.get(name);
    if (!callback) continue;
    ensure(callback.type === 'ArrowFunctionExpression' && !callback.async && callback.params.length === 1 && callback.params[0].type === 'Identifier');
    const parameter = callback.params[0].name;
    ensure(/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(parameter));
    const expected = name === 'onCreated' ? '(' + parameter + ') => { mainWindow = ' + parameter + '; }'
      : '(' + parameter + ') => { if (mainWindow === ' + parameter + ') mainWindow = null; }';
    ensure(same(callback, expected));
  }
  const runtime = local(index, context, 'runtime');
  // 运行时对象的既有 getter 与 setter 不参与配置授权，仅检查窗口端口的唯一绑定。
  ensure(runtime.init?.type === 'ObjectExpression');
  const runtimeWindow = exactlyOne(runtime.init.properties.filter(node => node.type === 'Property' && !node.computed && (node.key.name ?? node.key.value) === 'createWindow'));
  ensure(runtimeWindow.kind === 'init' && !runtimeWindow.method && id(runtimeWindow.value, 'createWindow'));
  ensure(!runtime.init.properties.some(node => node.type === 'SpreadElement' || node.computed));
  ensure(same(exactlyOne(ownReturns(context)).argument, 'runtime'));
  ensure(walk(context, false).some(node => node.type === 'CallExpression' && same(node, 'Object.freeze(runtime)')));
  immutable(context, ['desktopBootstrap', 'bootstrapConfiguration', 'createWindow', 'runtime']);
  noShadow(context, ['process', 'Object', 'desktopBootstrap', 'bootstrapConfiguration', 'createWindow', 'runtime'], [boot, config, factoryCall, runtime]);
  verifyContextObjectUses(index, context, runtime, boot, config, factoryCall);
  verifyFactory(index, functions.get('createDesktopWindowFactory'));
  const access = verifyRuntimeAccess(index);
  const installCall = uniqueCall(index, 'installMainRuntimeContext');
  assertCallBound(index, installCall, access.install);
  ensure(installCall.arguments.length === 1 && same(installCall.arguments[0], 'createMainRuntimeContext(__filename)'));
  ensure(index.parents.get(installCall)?.type === 'ExpressionStatement' && index.parents.get(index.parents.get(installCall)) === index.ast);
  const activeRuntime = exactlyOne(index.ast.body.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations).filter(node => id(node.id, 'mainRuntimeContext')));
  ensure(same(activeRuntime.init, 'getMainRuntimeContext()'));
  immutable(index.ast, ['mainRuntimeContext']);
  const startup = uniqueCall(index, 'startDesktopApplication');
  ensure(startup.arguments.length === 1 && same(objectFields(startup.arguments[0]).get('createWindow'), 'mainRuntimeContext.createWindow'));
  verifyStartupAdmission(index, startup);
  const start = functions.get('startDesktopApplication');
  ensure(start.params.length === 1 && id(start.params[0], 'options'));
  immutable(start, ['options']);
  const startCalls = walk(start).filter(node => node.type === 'CallExpression' && member(node.callee, 'createWindow'));
  ensure(startCalls.length > 0 && startCalls.every(node => same(node, 'options.createWindow()')));
  noShadow(start, ['options']);
  return true;
}

function verifyDirectGuard(index) {
  // 兼容原有直接声明合同；存在总线结构或实际加载端口时必须走完整绑定证明。
  ensure(!index.nodes.some(node => node.type === 'FunctionDeclaration' && ['createBootstrapConfiguration', 'initializeDesktopBootstrap', 'createDesktopWindowFactory'].includes(node.id?.name)));
  ensure(!index.nodes.some(node => node.type === 'MemberExpression' && ['loadURL', 'loadFile', 'openDevTools'].includes(propName(node))));
  const declaration = exactlyOne(index.ast.body.filter(node => node.type === 'VariableDeclaration' && node.kind === 'const')
    .flatMap(node => node.declarations).filter(node => id(node.id, 'development')));
  ensure(same(declaration.init, '!app.isPackaged && process.env.NODE_ENV === "development"'));
  ensure(!declarations(index.ast, 'app').length && !declarations(index.ast, 'process').length);
  immutable(index.ast, ['app', 'process', 'development']);
  return true;
}

function stringValue(node, index, seen = new Set()) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    const left = stringValue(node.left, index, seen), right = stringValue(node.right, index, seen);
    return typeof left === 'string' && typeof right === 'string' ? left + right : null;
  }
  if (node?.type === 'TemplateLiteral') {
    let value = node.quasis[0].value.cooked;
    for (let i = 0; i < node.expressions.length; i += 1) {
      const part = stringValue(node.expressions[i], index, seen);
      if (typeof part !== 'string') return null;
      value += part + node.quasis[i + 1].value.cooked;
    }
    return value;
  }
  if (node?.type === 'Identifier' && !seen.has(node.name)) {
    const values = index.variables.get(node.name) ?? [];
    if (values.length !== 1 || index.parents.get(values[0])?.kind !== 'const') return null;
    return stringValue(values[0].init, index, new Set([...seen, node.name]));
  }
  if (node?.type === 'CallExpression' && member(node.callee, 'join') && node.arguments.length === 1 && node.callee.object.type === 'ArrayExpression') {
    const separator = stringValue(node.arguments[0], index, seen);
    const values = node.callee.object.elements.map(value => stringValue(value, index, seen));
    if (typeof separator === 'string' && values.every(value => typeof value === 'string')) return values.join(separator);
  }
  return null;
}

function oldCollectorLiteral(index, node) {
  const call = index.parents.get(node), negate = index.parents.get(call), and = index.parents.get(negate);
  const declaration = index.parents.get(and);
  if (!(call?.type === 'CallExpression' && same(call.callee, 'mainBundleText.includes') && call.arguments.length === 1
    && negate?.type === 'UnaryExpression' && negate.operator === '!' && negate.argument === call
    && and?.type === 'LogicalExpression' && and.operator === '&&' && and.left === negate
    && same(and.right, 'mainBundleText.includes("' + STATUS_CHANNEL + '")')
    && declaration?.type === 'VariableDeclarator' && id(declaration.id, 'legacySavedPasswordIpcAbsent'))) return false;
  let scope = declaration;
  while (scope && scope.type !== 'FunctionDeclaration') scope = index.parents.get(scope);
  if (!scope || !id(scope.id, 'collectPackageSecurityBoundaries')) return false;
  const text = declarations(scope, 'mainBundleText');
  if (text.length !== 1 || !['const', 'var'].includes(index.parents.get(text[0])?.kind)
    || !['const', 'var'].includes(index.parents.get(declaration)?.kind)) return false;
  const read = text[0].init;
  if (!(read?.type === 'CallExpression' && member(read.callee, 'readFileSync') && read.callee.object.type === 'Identifier'
    && read.arguments.length === 2 && same(read.arguments[0], 'options.mainBundlePath') && read.arguments[1]?.value === 'utf8')) return false;
  let owner = index.parents.get(scope);
  while (owner && owner !== index.ast && !/Function/.test(owner.type)) owner = index.parents.get(owner);
  const bindings = declarations(owner, read.callee.object.name);
  if (bindings.length !== 1 || !same(bindings[0].init, 'require("node:fs")')) return false;
  const moduleProperty = index.parents.get(owner);
  if (owner !== index.ast && !(moduleProperty?.type === 'Property' && moduleProperty.method
    && moduleProperty.key?.value === '../../scripts/smoke-package-security-boundaries.js')) return false;
  immutable(scope, ['mainBundleText']);
  noShadow(scope, ['mainBundleText', read.callee.object.name], text);
  return true;
}

function verifyTrackedForwarder(index, tracked) {
  ensure(tracked.params.length === 3 && tracked.params.every(node => node.type === 'Identifier' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(node.name)));
  const [ipc, tracker, logger] = tracked.params.map(node => node.name);
  const direct = 'function f() { return (channel, listener) => { ' + ipc + '.handle(channel, listener); }; }';
  const owned = 'function f() { return (channel, listener) => { ' + ipc + '.handle(channel, async (event, ...args) => { try { return await ' + tracker + '.run(channel, () => listener(event, ...args)); } catch (error2) { ' + logger + '.error("ipc.handler_failed", { channel, error: error2 }); throw error2; } }); }; }';
  // 只支持原参数的无条件转发及真实带错误日志的包装，不接受死分支或其它回调形状。
  ensure([direct, owned].some(source => shape(tracked.body) === shape(parse(source, PARSE_OPTIONS).body[0].body)));
}

function normalizedPrefixShapes(prefix, externalNames = new Map()) {
  // 按词法绑定归一局部名，保留成员键和外部端口名；不抹平后缀或不同绑定关系。
  const root = { type: 'Program', body: prefix }, scopes = new WeakMap(), parents = new WeakMap(), bindings = new WeakMap();
  let next = 0;
  const top = { parent: null, names: new Map(), functionScope: true };
  function visit(node, scope) {
    const outer = scope;
    if (/Function/.test(node.type) || node.type === 'ClassExpression' || node.type === 'BlockStatement' || node.type === 'CatchClause') scope = { parent: scope, names: new Map(), functionScope: /Function/.test(node.type) };
    scopes.set(node, scope);
    const bind = (pattern, owner) => { for (const identifier of bindingIdentifiers(pattern)) {
      if (!owner.names.has(identifier.name)) owner.names.set(identifier.name, '$binding' + next++);
      bindings.set(identifier, owner.names.get(identifier.name));
    } };
    if (/Function/.test(node.type)) {
      if (node.id) bind(node.id, node.type === 'FunctionDeclaration' ? outer : scope);
      for (const param of node.params) bind(param, scope);
    }
    if (['ClassDeclaration', 'ClassExpression'].includes(node.type) && node.id) bind(node.id, scope);
    if (node.type === 'CatchClause') bind(node.param, scope);
    if (node.type === 'VariableDeclarator') {
      let owner = scope;
      if (parents.get(node)?.kind === 'var') while (!owner.functionScope) owner = owner.parent;
      bind(node.id, owner);
    }
    for (const child of children(node)) { parents.set(child, node); visit(child, scope); }
  }
  visit(root, top);
  function copy(node, parent, key) {
    if (typeof node === 'bigint') return { bigintValue: node.toString() };
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(value => copy(value, parent, key));
    const result = {};
    for (const [name, value] of Object.entries(node)) if (!['start', 'end', 'raw'].includes(name)) result[name] = copy(value, node, name);
    if (node.type === 'Identifier' && !(parent?.type === 'MemberExpression' && key === 'property' && !parent.computed)
      && !(['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent?.type) && key === 'key' && !parent.computed)
      && !(['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parent?.type) && key === 'label')) {
      let token = bindings.get(node), scope = scopes.get(node);
      while (!token && scope) { token = scope.names.get(node.name); scope = scope.parent; }
      if (token || externalNames.has(node.name)) result.name = token ?? externalNames.get(node.name);
    }
    return result;
  }
  return prefix.map(node => JSON.stringify(copy(node, null, null)));
}

function startupModuleAliases(ast) {
  const aliases = new Map(), modulePaths = new Set(), programNames = programBindingNames(ast);
  for (const statement of ast.body) if (statement.type === 'VariableDeclaration') for (const declaration of statement.declarations) {
    const value = declaration.init;
    if (called(value, '__commonJS')) {
      // 被排除的惰性定义仍须有唯一简单绑定，不能覆盖真实同步端口或藏入模式取值。
      ensure(statement.declarations.length === 1 && declaration.id.type === 'Identifier');
      ensure(programNames.filter(name => name === declaration.id.name).length === 1);
      ensure(value.arguments.length === 1);
      const fields = value.arguments[0];
      ensure(fields?.type === 'ObjectExpression' && fields.properties.length === 1);
      const field = fields.properties[0];
      ensure(field.type === 'Property' && field.method && field.kind === 'init' && !field.computed && typeof field.key.value === 'string');
      ensure(field.value.type === 'FunctionExpression' && !field.value.async && !field.value.generator
        && field.value.params.every(node => node.type === 'Identifier') && field.value.body.type === 'BlockStatement');
      ensure(!modulePaths.has(field.key.value));
      modulePaths.add(field.key.value);
      aliases.set(declaration.id.name, '$commonJS:' + field.key.value);
    }
    if (declaration.id.type !== 'Identifier') continue;
    let imported = value;
    if (called(imported, '__toESM')) imported = imported.arguments[0];
    if (called(imported, 'require') && imported.arguments.length === 1 && typeof imported.arguments[0].value === 'string') aliases.set(declaration.id.name, '$module:' + imported.arguments[0].value);
  }
  return aliases;
}

const AUDITED_GLOBAL_WRITE_PORTS = Object.freeze([
  ["function:navigateToLingxingDownloadCenter","d4b1961d453c2547b508bfc6b480c2b951148c3c4317d72bb57abb3e2c2f02c1"],
  ["function:installGlobalRuntimeErrorHandlers","7f69fa5c52cbd8fdbade766203d2021e0007d9bdbc4c858425e428059e684256"],
  ["../../scripts/verify-v16-trace-closure.js","a414b697661e28fa971e011485f5f45d99809dc9e51ada93ba6efadaf3f103a5"],
  ["../../scripts/verify-v16-trace-closure.js","25c3149e748107f33603a7751f377c0aff0fada283303be3bd2219fc0cf431c3"],
  ["../../scripts/verify-v16-required-test-manifest.js","ef1dfc5dc1a69ea0dfc4e52ae85d539bae0e730c2ffeed1fd581979c4d3e34c3"],
  ["../../scripts/verify-v16-required-test-manifest.js","f5c0740c2fe6e32ab8f393bbe4b1ada24bb673b3e837fa146138308a725c783d"],
  ["../../scripts/v16-ui-governance.js","33cdf15e8b5a0c411a298e4243e732a7aaa8a57ba7d515377343c82d5d6285fe"],
  ["../../scripts/verify-s7-live-migration-acceptance.js","9256dc4040f8427b33a326896b8e59b594d591cb5bf5633e7aa9f1cdf69c260b"],
  ["../../scripts/verify-s7-live-migration-acceptance.js","1bb48a64163bbcd751ef6f32fedb4b108898d908fd3dbf70dde522f41b00eede"],
  ["../../scripts/verify-s7-live-migration-acceptance.js","96176f1afb3141c11d07d5c2460dec5a82297915815695c2be4f315fad26f168"],
  ["../../scripts/verify-s7-migration-backup-restore.js","1ef74c0dab2eebb4b290806160a35ba66347c5c3538f1e914996967e814be33f"],
  ["../../scripts/verify-mission-control-production-readiness.js","8e79566afe5fca18290f697e8720857af7a4fbff32f683aece3840b313d9f9cb"],
  ["../../scripts/smoke-package-adversarial-node-env.js","662d9b047812ac2b9291eac43ae9c0cc9432d6f12a05568d9350f437bd80f81b"],
  ["../../scripts/smoke-package-adversarial-node-env.js","aed49a46cea4a847d6475006bc16eff74f153449471a990594603d47cf9da06d"],
  ["../../scripts/smoke-package-security-boundaries.js","59d9aecfa4b069f9ab83316a769dcc5e03feaa3766a99617f00b45d83325d196"],
  ["../../scripts/smoke-package-security-boundaries.js","a10b8665d67f1e7533fb28fb5974795ce96576912799b6cd5c17bd45044b7caf"],
  ["../../scripts/package-evidence-paths.js","0144a1a891d61525f525c8c363b70ccff5aec97ffae155bfcb7f47e4ec0b30a4"],
  ["../../scripts/verify-s7-continuous-operation.js","9866d00013f817ade4f8cc78710757ef40b8bcab9e69107d41aa7d1ebd1a4c06"],
  ["../../scripts/export-mission-control-authority-snapshot.js","3d7b617d59f2bda7a401993951871204fde7195e70843e4a5380b10c9d93701f"],
  ["../../scripts/export-mission-control-authority-snapshot.js","76de1eecc84c34a09afc6b40da7e57ef8acad2e20a88ebd5c1869552c4039915"],
  ["../../scripts/verify-production-authority-selection.js","c9faab83afccef1ca64803f62cfbdf59e637f98b56e9c25b24c34f167374be39"],
  ["../../scripts/verify-production-authority-selection.js","96176f1afb3141c11d07d5c2460dec5a82297915815695c2be4f315fad26f168"],
  ["../../scripts/migrate-current-user-db.js","9609483323c835c396a35230694b0fd882376558f30e0a10754ec1ff0311ca3f"],
  ["../../scripts/sqlite-authority-currentness.js","3d7b617d59f2bda7a401993951871204fde7195e70843e4a5380b10c9d93701f"],
  ["../../scripts/sqlite-authority-currentness.js","53b4fe4f2c12351c80522f4ea2e9c79ab3d0d0ca9f7b62060cca380036489456"],
  ["../../scripts/smoke-package-security-boundaries.js","a9f18f3271cccc7b347e58468e90241f32e0e7f62d7d6b075591135743438fb3"]
]);

function auditedGlobalAssignments(index) {
  const aliases = startupModuleAliases(index.ast), allowed = [], cache = new Map();
  for (const node of index.nodes) {
    if (node.type !== 'AssignmentExpression' || !['process', 'window'].includes(rootName(node.left))
      || !anySame(node.left, ['process.exitCode', 'window.location.href'])) continue;
    let current = node, nearest, top, module;
    while (current) {
      if (!nearest && /Function/.test(current.type)) nearest = current;
      if (current.type === 'FunctionDeclaration' && index.parents.get(current) === index.ast) top = current;
      const object = index.parents.get(current), call = index.parents.get(object);
      if (current.type === 'Property' && current.method && typeof current.key?.value === 'string'
        && object?.type === 'ObjectExpression' && called(call, '__commonJS') && call.arguments[0] === object) module = current.key.value;
      current = index.parents.get(current);
    }
    const owner = module ? nearest : top, port = module ?? (top && 'function:' + top.id.name);
    if (!owner || !port) continue;
    if (!cache.has(owner)) cache.set(owner, createHash('sha256').update(normalizedPrefixShapes([owner], aliases)[0]).digest('hex'));
    // 只准入固定模块和完整函数指纹内的原节点；同名 evaluate 或属性名本身不提供信用。
    if (AUDITED_GLOBAL_WRITE_PORTS.some(([name, digest]) => name === port && digest === cache.get(owner))) allowed.push(node);
  }
  return allowed;
}

function verifyStartupSlice(index) {
  // 静态门仅证明受信构建的同步入口和实际安全调用图；依赖实现仍由冻结身份及真实对抗验证约束。
  const aliases = startupModuleAliases(index.ast), synchronous = [];
  for (const statement of index.ast.body) {
    if (statement.type === 'VariableDeclaration' && statement.declarations.every(node => called(node.init, '__commonJS'))) continue;
    // CJS 工厂与函数声明的函数体此刻不执行；真实 require 端口和其它同步语句仍完整保留。
    synchronous.push(statement.type === 'FunctionDeclaration' ? { ...statement, body: { type: 'BlockStatement', body: [] } } : statement);
  }
  const digest = value => createHash('sha256').update(value).digest('hex');
  ensure(AUDITED_STARTUP_PROGRAMS.includes(digest(JSON.stringify(normalizedPrefixShapes(synchronous, aliases)))));
  for (const [name, supported] of Object.entries(AUDITED_STARTUP_FUNCTIONS)) {
    const functions = index.ast.body.filter(node => node.type === 'FunctionDeclaration' && id(node.id, name));
    if (!functions.length) continue;
    const fn = exactlyOne(functions);
    // 完整语句模板保留计算属性、控制流和调用顺序，未知调用或逃逸无法被部分匹配掩盖。
    ensure(supported.includes(digest(normalizedPrefixShapes([fn], aliases)[0])));
  }
}

function verifyRegistrationPrefix(index, scope, statement) {
  ensure(scope.params.length === 0);
  const position = scope.body.body.indexOf(statement);
  ensure(position >= 0);
  const prefix = scope.body.body.slice(0, position);
  const fixture = parse('const mainRuntimeContext2 = getMainRuntimeContext();', PARSE_OPTIONS).body[0];
  if (prefix.length === 1 && normalizedPrefixShapes(prefix)[0] === normalizedPrefixShapes([fixture])[0]) return [];
  // 指纹固定已审的初始化门和登记端口；嵌套处理器的正常 return 属于原结构。
  const fingerprints = normalizedPrefixShapes(prefix).map(value => createHash('sha256').update(value).digest('hex'));
  ensure(AUDITED_REGISTRATION_PREFIXES.some(supported => fingerprints.length === supported.length
    && fingerprints.every((value, index) => value === supported[index])));
  // 仅已完整核验前缀内的原赋值节点可初始化业务状态，不放行接收者重绑或登记端口改写。
  return prefix.flatMap(node => walk(node)).filter(node => node.type === 'AssignmentExpression');
}

function verifyStartupAdmission(index, startup) {
  // 真正启动必须是唯一准入块的直接 void 语句，不能藏在循环或其它控制流中。
  const operation = index.parents.get(startup), statement = index.parents.get(operation);
  ensure(operation?.type === 'UnaryExpression' && operation.operator === 'void' && operation.argument === startup);
  ensure(statement?.type === 'ExpressionStatement' && statement.expression === operation);
  const block = index.parents.get(statement), entry = index.parents.get(block);
  ensure(block?.type === 'BlockStatement' && block.body.length === 1 && block.body[0] === statement);
  ensure(entry?.type === 'IfStatement' && entry.consequent === block && !entry.alternate
    && same(entry.test, 'mainRuntimeContext.mainStartupAdmission') && index.parents.get(entry) === index.ast);
}

function verifyRegistrationReachability(index, scope, registration) {
  ensure(scope === namedFunction(index, 'registerIpcHandlers'));
  ensure(index.parents.get(registration)?.type === 'ExpressionStatement' && index.parents.get(index.parents.get(registration)) === scope.body);
  const allowedAssignments = verifyRegistrationPrefix(index, scope, index.parents.get(registration));
  immutable(index.ast, ['registerIpcHandlers']);
  const startup = uniqueCall(index, 'startDesktopApplication');
  ensure(startup.arguments.length === 1 && id(objectFields(startup.arguments[0]).get('registerIpcHandlers'), 'registerIpcHandlers'));
  const start = namedFunction(index, 'startDesktopApplication');
  assertCallBound(index, startup, start);
  ensure(start.params.length === 1 && id(start.params[0], 'options'));
  const direct = 'function f(options) { options.registerIpcHandlers(); options.createWindow(); }';
  const own = 'function f(options) { const { app: app4 } = options; app4.on("second-instance", () => { const window2 = options.getMainWindow(); if (!window2 || window2.isDestroyed()) return; if (window2.isMinimized()) window2.restore(); window2.show(); window2.focus(); }); return options.lifecycleRecovery.runStartupBootstrap(async () => { await app4.whenReady(); runtimeLog.log("[App] ready"); await options.initialize(); options.registerIpcHandlers(); runtimeLog.log("[App] ipc-ready"); options.createWindow(); options.startBusinessDateMonitor(); runtimeLog.log("[App] window-created"); app4.on("activate", () => { if (options.countWindows() === 0) options.createWindow(); }); }); }';
  ensure([direct, own].some(source => shape(start.body) === shape(parse(source, PARSE_OPTIONS).body[0].body)));
  verifyStartupAdmission(index, startup);
  const installed = uniqueCall(index, 'installMainRuntimeContext');
  ensure(same(installed, 'installMainRuntimeContext(createMainRuntimeContext(__filename))')
    && index.parents.get(installed)?.type === 'ExpressionStatement' && index.parents.get(index.parents.get(installed)) === index.ast);
  const active = exactlyOne(index.ast.body.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations).filter(node => id(node.id, 'mainRuntimeContext')));
  ensure(same(active.init, 'getMainRuntimeContext()'));
  return allowedAssignments;
}

function verifyLegacyBoundary(index) {
  for (const node of index.nodes) {
    if (node.type === 'Literal' && node.value === LEGACY_CHANNEL) ensure(oldCollectorLiteral(index, node));
    if (['BinaryExpression', 'TemplateLiteral'].includes(node.type) && stringValue(node, index) === LEGACY_CHANNEL) ensure(false);
    if (node.type === 'CallExpression' && node.arguments.length && stringValue(node.arguments[0], index) === LEGACY_CHANNEL) {
      ensure(member(node.callee, 'includes') && node.arguments[0].type === 'Literal' && oldCollectorLiteral(index, node.arguments[0]));
    }
  }
  const statusRegistrations = index.nodes.filter(node => node.type === 'CallExpression' && stringValue(node.arguments[0], index) === STATUS_CHANNEL
    && (member(node.callee, 'handle') || member(node.callee, 'registerTrackedIpcHandler')));
  const registration = exactlyOne(statusRegistrations);
  ensure(registration.arguments.length === 2 && /Function/.test(registration.arguments[1]?.type));
  if (member(registration.callee, 'handle')) {
    ensure(id(registration.callee.object, 'ipcMain') && !declarations(index.ast, 'ipcMain').length);
    ensure(index.parents.get(registration)?.type === 'ExpressionStatement' && index.parents.get(index.parents.get(registration)) === index.ast);
  } else {
    const receiver = registration.callee.object;
    ensure(receiver.type === 'Identifier');
    let scope = registration;
    while (scope && scope.type !== 'FunctionDeclaration') scope = index.parents.get(scope);
    ensure(scope && id(scope.id, 'registerIpcHandlers'));
    const allowedAssignments = verifyRegistrationReachability(index, scope, registration);
    const runtime = local(index, scope, receiver.name, 'getMainRuntimeContext()');
    immutable(scope, [receiver.name], allowedAssignments);
    noShadow(scope, [receiver.name, 'getMainRuntimeContext'], [runtime]);
    verifyRuntimeAccess(index);
    const context = namedFunction(index, 'createMainRuntimeContext');
    const registrar = local(index, context, 'registerTrackedIpcHandler');
    ensure(called(registrar.init, 'createTrackedIpcRegistrar') && registrar.init.arguments.length === 3);
    const ipc = registrar.init.arguments[0];
    ensure(member(ipc, 'ipcMain') && ipc.object.type === 'Identifier');
    electronNamespace(index, ipc.object.name);
    const tracked = namedFunction(index, 'createTrackedIpcRegistrar');
    assertCallBound(index, uniqueCall(index, 'createTrackedIpcRegistrar'), tracked);
    verifyTrackedForwarder(index, tracked);
    immutable(context, ['registerTrackedIpcHandler']);
    const runtimeObject = local(index, context, 'runtime').init;
    const exposed = exactlyOne(runtimeObject.properties.filter(node => node.type === 'Property' && node.key?.name === 'registerTrackedIpcHandler'));
    ensure(id(exposed.value, 'registerTrackedIpcHandler') && exposed.kind === 'init' && !exposed.computed);
  }
  return true;
}

function inspectPackageSecuritySemantics(source) {
  let index, phase = 'parse';
  try {
    const ast = parse(source, PARSE_OPTIONS), parents = new WeakMap(), nodes = walk(ast);
    phase = 'index';
    for (const node of nodes) for (const child of children(node)) parents.set(child, node);
    const variables = new Map();
    for (const node of nodes) if (node.type === 'VariableDeclarator') {
      for (const name of bindingNames(node.id)) variables.set(name, [...(variables.get(name) ?? []), node]);
    }
    const bindingIds = new WeakSet();
    for (const node of nodes) {
      const patterns = node.type === 'VariableDeclarator' ? [node.id] : /Function/.test(node.type) ? [...node.params, node.id] : ['ClassDeclaration', 'ClassExpression'].includes(node.type) ? [node.id] : node.type === 'CatchClause' ? [node.param] : [];
      for (const pattern of patterns) for (const binding of bindingIdentifiers(pattern)) bindingIds.add(binding);
    }
    index = { ast, nodes, parents, variables, bindingIds };
    phase = 'builtin-bindings';
    const programBindings = programBindingNames(ast);
    for (const name of ['Object', 'process', 'require', 'globalThis', 'global', 'self', 'window', 'Reflect', 'Function', 'eval']) ensure(!programBindings.includes(name));
    ensure(!nodes.some(node => node.type === 'WithStatement'));
    phase = 'global-writes';
    immutable(ast, ['Object', 'process', 'require', 'globalThis', 'window', 'Reflect', 'Function', 'eval'], auditedGlobalAssignments(index));
    phase = 'builtin-reads';
    verifyBuiltinObjectUses(index);
    phase = 'startup-slice';
    verifyStartupSlice(index);
  } catch {
    // 语法失败与合同拒绝分别记录；上下文只含固定阶段，不包含候选源码或异常文本。
    const event = phase === 'parse' ? 'security.boundary_semantic_parse_failed' : 'security.boundary_semantic_rejected';
    console.error(JSON.stringify(createRuntimeLogRecord('error', event, { phase })));
    return { packagedDevDowngradeGuard: false, legacySavedPasswordIpcAbsent: false };
  }
  const result = {};
  for (const [key, verify] of [
    ['packagedDevDowngradeGuard', () => index.nodes.some(node => node.type === 'FunctionDeclaration' && id(node.id, 'createMainRuntimeContext')) ? verifyBusGuard(index) : verifyDirectGuard(index)],
    ['legacySavedPasswordIpcAbsent', () => verifyLegacyBoundary(index)],
  ]) {
    try { result[key] = verify() === true; }
    catch {
      console.error(JSON.stringify(createRuntimeLogRecord('error', 'security.boundary_semantic_rejected', { boundary: key })));
      result[key] = false;
    }
  }
  return result;
}

module.exports = { inspectPackageSecuritySemantics };
