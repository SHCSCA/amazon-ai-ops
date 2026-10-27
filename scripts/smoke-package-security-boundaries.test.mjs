import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  EXPECTED_PACKAGE_SECURITY_CHECK_CODES,
  collectPackageSecurityBoundaries,
  parsePackageSecurityBoundaryArgs,
  validatePackageSecurityEvidence,
} = require('./smoke-package-security-boundaries.js');

const HASH_A = 'A'.repeat(64);
const HASH_B = 'B'.repeat(64);
const HASH_C = 'C'.repeat(64);

function writeFixtureSources(dir, overrides = {}) {
  const files = {
    mainBundlePath: path.join(dir, 'dist', 'main', 'index.js'),
    settingsRepositoryPath: path.join(dir, 'settings-repo.ts'),
    sqliteDbPath: path.join(dir, 'db.ts'),
  };
  fs.mkdirSync(path.dirname(files.mainBundlePath), { recursive: true });
  fs.writeFileSync(files.mainBundlePath, overrides.mainBundle || [
    "const NAVIGATION_SECURITY_MARKER = 'amazon-ai-ops:navigation-security/v1';",
    "const LEGACY_LOGIN_MIGRATION_MARKER = 'amazon-ai-ops:legacy-login-migration/v1';",
    "const development = !app.isPackaged && process.env.NODE_ENV === 'development';",
    "mainWindow.webContents.on('will-navigate', createMainWindowNavigationHandler({}));",
    "mainWindow.webContents.on('will-redirect', createMainWindowNavigationHandler({}));",
    "mainWindow.webContents.setWindowOpenHandler(createSecureWindowOpenHandler({}));",
    "ipcMain.handle('browser:get-saved-credential-status', () => status);",
    'function openApprovedExternalTarget(safeUrl) { return shell.openExternal(safeUrl); }',
  ].join('\n'), 'utf8');
  fs.writeFileSync(files.settingsRepositoryPath, overrides.settingsRepository || [
    'export class SettingsRepository {',
    "  saveEncryptedLogin(value) { this.set('login_credentials_encrypted', value); }",
    '}',
  ].join('\n'), 'utf8');
  fs.writeFileSync(files.sqliteDbPath, overrides.sqliteDb || [
    "const db = new Database(finalPath);",
    'export default db;',
  ].join('\n'), 'utf8');
  return files;
}

describe('package security boundary evidence', () => {
  it('parses only explicit hash-bound output arguments', () => {
    expect(parsePackageSecurityBoundaryArgs([
      'node',
      'script',
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--out', 'evidence.json',
    ])).toMatchObject({
      expectedExeSha256: HASH_A,
      expectedAppContentSha256: HASH_B,
      out: 'evidence.json',
    });
    expect(() => parsePackageSecurityBoundaryArgs(['node', 'script', '--out', 'evidence.json']))
      .toThrow(/expected-exe-sha256/);
    expect(() => parsePackageSecurityBoundaryArgs([
      'node', 'script', '--expected-exe-sha256', HASH_A, '--expected-app-content-sha256', HASH_B, '--unknown', 'x',
    ])).toThrow(/Unexpected argument/);
  });

  it('emits a path-free, secret-free schema when every packaged boundary is present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'package-security-boundaries-'));
    try {
      const files = writeFixtureSources(dir);
      const evidence = collectPackageSecurityBoundaries({
        ...files,
        generatedAt: '2026-07-17T00:00:00.000Z',
        packageHashes: { exeSha256: HASH_A, appContentSha256: HASH_B },
        expectedExeSha256: HASH_A,
        expectedAppContentSha256: HASH_B,
      });

      expect(evidence).toMatchObject({
        kind: 'package-security-boundaries',
        schemaVersion: 1,
        generatedAt: '2026-07-17T00:00:00.000Z',
        passed: true,
        package: {
          executableSha256: HASH_A,
          appContentSha256: HASH_B,
        },
      });
      expect(evidence.checks.map((check) => check.code)).toEqual(EXPECTED_PACKAGE_SECURITY_CHECK_CODES);
      expect(evidence.checks.every((check) => check.passed === true)).toBe(true);
      expect(evidence.summary).toEqual({
        total: EXPECTED_PACKAGE_SECURITY_CHECK_CODES.length,
        passed: EXPECTED_PACKAGE_SECURITY_CHECK_CODES.length,
        failed: 0,
      });
      expect(validatePackageSecurityEvidence(evidence, {
        executableSha256: HASH_A,
        appContentSha256: HASH_B,
        mainBundleSha256: evidence.package.mainBundleSha256,
      })).toEqual({ passed: true, violations: [] });
      expect(validatePackageSecurityEvidence(evidence, {
        executableSha256: HASH_A,
        appContentSha256: HASH_B,
        mainBundleSha256: HASH_C,
      }).violations).toContain('package main-bundle hash mismatch');

      const serialized = JSON.stringify(evidence);
      expect(serialized).not.toContain(dir);
      expect(serialized).not.toMatch(/"(?:url|query|username|password|credential|sourcePath|bundlePath)"\s*:/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed without copying plaintext or unsafe source text into evidence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'package-security-boundaries-unsafe-'));
    try {
      const files = writeFixtureSources(dir, {
        mainBundle: [
          "const NAVIGATION_SECURITY_MARKER = 'amazon-ai-ops:navigation-security/v1';",
          "const LEGACY_LOGIN_MIGRATION_MARKER = 'amazon-ai-ops:legacy-login-migration/v1';",
          'mainWindow.webContents.setWindowOpenHandler(({ url }) => {',
          '  shell.openExternal(url);',
          "  return { action: 'deny' };",
          '});',
        ].join('\n'),
        settingsRepository: "this.set('login_password', 'never-copy-this-secret');",
        sqliteDb: 'new Database(finalPath, { verbose: console.log });',
      });
      const evidence = collectPackageSecurityBoundaries({
        ...files,
        packageHashes: { exeSha256: HASH_A, appContentSha256: HASH_B },
        expectedExeSha256: HASH_A,
        expectedAppContentSha256: HASH_B,
      });

      expect(evidence.passed).toBe(false);
      expect(evidence.checks).toEqual(expect.arrayContaining([
        { code: 'DIRECT_EXTERNAL_URL_FORWARDING_ABSENT', passed: false },
        { code: 'PLAINTEXT_CREDENTIAL_WRITER_ABSENT', passed: false },
        { code: 'SQLITE_VERBOSE_LOGGING_ABSENT', passed: false },
      ]));
      expect(JSON.stringify(evidence)).not.toContain('never-copy-this-secret');
      expect(validatePackageSecurityEvidence(evidence).passed).toBe(false);
      expect(validatePackageSecurityEvidence({ ...evidence, username: 'operator@example.com' }).violations)
        .toContain('unexpected top-level evidence fields');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when packaged navigation wiring omits the secure window-open handler', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'package-security-window-open-'));
    try {
      const files = writeFixtureSources(dir);
      const source = fs.readFileSync(files.mainBundlePath, 'utf8');
      fs.writeFileSync(
        files.mainBundlePath,
        source.replace("mainWindow.webContents.setWindowOpenHandler(createSecureWindowOpenHandler({}));\n", ''),
        'utf8',
      );
      const evidence = collectPackageSecurityBoundaries({
        ...files,
        packageHashes: { exeSha256: HASH_A, appContentSha256: HASH_B },
        expectedExeSha256: HASH_A,
        expectedAppContentSha256: HASH_B,
      });

      expect(evidence.passed).toBe(false);
      expect(evidence.checks).toContainEqual({ code: 'NAVIGATION_GUARDS_WIRED', passed: false });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});


const SEMANTIC_BUS_MAIN = "const electron = require(\"electron\");\nconst NAVIGATION_SECURITY_MARKER = \"amazon-ai-ops:navigation-security/v1\";\nconst LEGACY_LOGIN_MIGRATION_MARKER = \"amazon-ai-ops:legacy-login-migration/v1\";\nvar BOOTSTRAP_ENVIRONMENT_KEYS = Object.freeze([\"NODE_ENV\"]);\nfunction captureBootstrapEnvironment(environment = process.env) {\n  const snapshot = {};\n  for (const key of BOOTSTRAP_ENVIRONMENT_KEYS) {\n    if (Object.prototype.hasOwnProperty.call(environment, key)) {\n      const value = environment[key];\n      if (value !== void 0) snapshot[key] = value;\n    }\n  }\n  return Object.freeze(snapshot);\n}\nfunction createBootstrapConfiguration(input) {\n  return Object.freeze({ development: !input.isPackaged && input.environment.NODE_ENV === \"development\", paths: { rendererFilePath: \"fixture/index.html\" } });\n}\nfunction initializeDesktopBootstrap(electronApp, options, overrides = {}) {\n  const sourceEnvironment = options.environment ?? process.env;\n  const environment = captureBootstrapEnvironment(sourceEnvironment);\n  const evidenceIdentity = {};\n  const userDataDir = \"isolated-fixture\";\n  const configuration = createBootstrapConfiguration({ environment, isPackaged: electronApp.isPackaged, evidenceIdentity, userDataDir, repositoryRoot: options.repositoryRoot, mainModulePath: options.mainModulePath, executablePath: options.executablePath });\n  const admission = true;\n  return Object.freeze({ configuration, admission });\n}\nfunction createDesktopWindowFactory(runtime) {\n  return function createWindow(options = {}) {\n    const createdWindow = new electron.BrowserWindow({});\n    const { development, rendererFilePath } = runtime;\n    const trustedRendererTarget = development ? { kind: \"development\", rendererUrl: \"http://localhost:5173\" } : { kind: \"packaged\", rendererFilePath };\n    createdWindow.webContents.on(\"will-navigate\", createMainWindowNavigationHandler({ target: trustedRendererTarget }));\n    createdWindow.webContents.on(\"will-redirect\", createMainWindowNavigationHandler({ target: trustedRendererTarget }));\n    createdWindow.webContents.setWindowOpenHandler(createSecureWindowOpenHandler({}));\n    const rendererLoad = development ? createdWindow.loadURL(\"http://localhost:5173\") : createdWindow.loadFile(rendererFilePath);\n    if (development) createdWindow.webContents.openDevTools();\n    return createdWindow;\n  };\n}\nfunction createMainRuntimeContext(mainModulePath) {\n  const desktopBootstrap = initializeDesktopBootstrap(electron.app, { repositoryRoot: process.cwd(), executablePath: process.execPath, mainModulePath });\n  const bootstrapConfiguration = desktopBootstrap.configuration;\n  const createWindow = createDesktopWindowFactory({ development: bootstrapConfiguration.development, rendererFilePath: bootstrapConfiguration.paths.rendererFilePath });\n  const runtime = { createWindow, mainStartupAdmission: desktopBootstrap.admission };\n  Object.freeze(runtime);\n  return runtime;\n}\nvar currentRuntime = null;\nfunction installMainRuntimeContext(runtime) {\n  if (currentRuntime) throw new Error(\"MAIN_RUNTIME_ALREADY_INSTALLED\");\n  currentRuntime = runtime;\n}\nfunction getMainRuntimeContext() {\n  if (!currentRuntime) throw new Error(\"MAIN_RUNTIME_NOT_INSTALLED\");\n  return currentRuntime;\n}\nfunction startDesktopApplication(options) { options.createWindow(); }\ninstallMainRuntimeContext(createMainRuntimeContext(__filename));\nvar mainRuntimeContext = getMainRuntimeContext();\nif (mainRuntimeContext.mainStartupAdmission) {\n  void startDesktopApplication({ createWindow: mainRuntimeContext.createWindow });\n}\nipcMain.handle(\"browser:get-saved-credential-status\", () => status);\n";
const SEMANTIC_SELF_CHECK = "const fs = require(\"node:fs\");\nfunction collectPackageSecurityBoundaries(options) {\n  const mainBundleText = fs.readFileSync(options.mainBundlePath, \"utf8\");\n  const legacySavedPasswordIpcAbsent = !mainBundleText.includes(\"browser:get-saved-credentials\") && mainBundleText.includes(\"browser:get-saved-credential-status\");\n  return legacySavedPasswordIpcAbsent;\n}\n";
const SEMANTIC_BUNDLED_SELF_CHECK = "var require_security_check = __commonJS({\n  \"../../scripts/smoke-package-security-boundaries.js\"(exports2, module2) {\n    var fs71 = require(\"node:fs\");\n    function collectPackageSecurityBoundaries(options) {\n      var mainBundleText = fs71.readFileSync(options.mainBundlePath, \"utf8\");\n      var legacySavedPasswordIpcAbsent = !mainBundleText.includes(\"browser:get-saved-credentials\") && mainBundleText.includes(\"browser:get-saved-credential-status\");\n      return legacySavedPasswordIpcAbsent;\n    }\n  }\n});\n";

const SEMANTIC_TRACKED_BUS_MAIN = SEMANTIC_BUS_MAIN
  .replace('  const runtime = { createWindow,', '  const registerTrackedIpcHandler = createTrackedIpcRegistrar(electron.ipcMain, operationTracker, logger);\n  const runtime = { registerTrackedIpcHandler, createWindow,')
  .replace('ipcMain.handle("browser:get-saved-credential-status", () => status);', [
    'function createTrackedIpcRegistrar(ipcMain2, operationTracker, logger) {',
    '  return (channel, listener) => { ipcMain2.handle(channel, listener); };',
    '}',
    'function registerIpcHandlers() {',
    '  const mainRuntimeContext2 = getMainRuntimeContext();',
    '  mainRuntimeContext2.registerTrackedIpcHandler("browser:get-saved-credential-status", () => status);',
    '}',
  ].join('\n'))
  .replace('function startDesktopApplication(options) { options.createWindow(); }', 'function startDesktopApplication(options) { options.registerIpcHandlers(); options.createWindow(); }')
  .replace('createWindow: mainRuntimeContext.createWindow });', 'createWindow: mainRuntimeContext.createWindow, registerIpcHandlers });');

function inspectSemanticFixture(mainBundle) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'package-security-semantic-'));
  try {
    const files = writeFixtureSources(dir, { mainBundle });
    return collectPackageSecurityBoundaries({
      ...files,
      packageHashes: { exeSha256: HASH_A, appContentSha256: HASH_B },
      expectedExeSha256: HASH_A,
      expectedAppContentSha256: HASH_B,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function semanticMutation(source, before, after) {
  expect(source.split(before)).toHaveLength(2);
  return source.replace(before, after);
}

describe('package security semantic binding', () => {
  it.each([
    ['configuration bus to the actual window', ''],
    ['standalone collector inert legacy literal', SEMANTIC_SELF_CHECK],
    ['bundled collector inert legacy literal', SEMANTIC_BUNDLED_SELF_CHECK],
  ])('accepts %s', (_name, extra) => {
    const evidence = inspectSemanticFixture(SEMANTIC_BUS_MAIN + extra);
    expect(evidence.checks.map(check => check.code)).toEqual(EXPECTED_PACKAGE_SECURITY_CHECK_CODES);
    expect(evidence.passed).toBe(true);
    expect(evidence.summary).toEqual({ total: 11, passed: 11, failed: 0 });
    expect(validatePackageSecurityEvidence(evidence).passed).toBe(true);
  });

  it.each([
    ['OR downgrade', '!input.isPackaged && input.environment.NODE_ENV', '!input.isPackaged || input.environment.NODE_ENV'],
    ['missing packaged guard', '!input.isPackaged && input.environment.NODE_ENV', 'input.environment.NODE_ENV'],
    ['environment pretending to be Electron', '!input.isPackaged', '!input.environment.isPackaged'],
    ['loose NODE_ENV comparison', 'input.environment.NODE_ENV ===', 'input.environment.NODE_ENV =='],
    ['duplicate development property', 'development: !input.isPackaged', 'development: true, development: !input.isPackaged'],
    ['development spread override', 'paths: { rendererFilePath: "fixture/index.html" }', 'paths: { rendererFilePath: "fixture/index.html" }, ...override'],
    ['bootstrap environment injection', 'repositoryRoot: process.cwd(), executablePath: process.execPath, mainModulePath', 'repositoryRoot: process.cwd(), executablePath: process.execPath, mainModulePath, environment: unsafeEnvironment'],
    ['bootstrap dependency injection', 'executablePath: process.execPath, mainModulePath });', 'executablePath: process.execPath, mainModulePath }, unsafeOverrides);'],
    ['snapshot bypass', 'const environment = captureBootstrapEnvironment(sourceEnvironment);', 'const environment = sourceEnvironment;'],
    ['different captured environment', 'captureBootstrapEnvironment(sourceEnvironment);', 'captureBootstrapEnvironment(process.env);'],
    ['fake isPackaged input', 'isPackaged: electronApp.isPackaged', 'isPackaged: false'],
    ['NODE_ENV omitted from snapshot', 'Object.freeze(["NODE_ENV"])', 'Object.freeze(["APPDATA"])'],
    ['wrong consumer value', 'development: bootstrapConfiguration.development', 'development: true'],
    ['wrong renderer load condition', 'const rendererLoad = development ?', 'const rendererLoad = process.env.NODE_ENV === "development" ?'],
    ['unguarded automatic devtools', 'if (development) createdWindow.webContents.openDevTools();', 'createdWindow.webContents.openDevTools();'],
    ['extra renderer load', 'return createdWindow;', 'createdWindow.loadURL("http://untrusted.invalid"); return createdWindow;'],
    ['computed injected renderer load', 'return createdWindow;', 'createdWindow["load" + "URL"]("http://untrusted.invalid"); return createdWindow;'],
    ['destructured renderer load alias', 'return createdWindow;', 'const { loadURL } = createdWindow; loadURL("http://untrusted.invalid"); return createdWindow;'],
    ['wrong runtime window port', 'const runtime = { createWindow,', 'const runtime = { createWindow: unsafeWindowFactory,'],
    ['fake bootstrap scope', 'const environment = captureBootstrapEnvironment(sourceEnvironment);', 'const captureBootstrapEnvironment = identity; const environment = captureBootstrapEnvironment(sourceEnvironment);'],
    ['development mutation', 'if (development) createdWindow.webContents.openDevTools();', 'development = true; if (development) createdWindow.webContents.openDevTools();'],
    ['early configuration bypass', 'return Object.freeze({ development:', 'if (override) return override; return Object.freeze({ development:'],
    ['wrong Electron namespace', 'require("electron")', 'require("node:fs")'],
    ['wrong startup port', 'createWindow: mainRuntimeContext.createWindow', 'createWindow: unsafeWindowFactory'],
    ['wrong installed context', 'installMainRuntimeContext(createMainRuntimeContext(__filename));', 'installMainRuntimeContext(unsafeRuntime);'],
    ['wrong navigation target', 'target: trustedRendererTarget }));\n    createdWindow.webContents.on("will-redirect"', 'target: unsafeTarget }));\n    createdWindow.webContents.on("will-redirect"'],
    ['guard hidden in comments', 'development: !input.isPackaged && input.environment.NODE_ENV === "development"', 'development: true /* !input.isPackaged && input.environment.NODE_ENV === "development" */'],
    ['guard hidden in string', 'development: !input.isPackaged && input.environment.NODE_ENV === "development"', 'development: "!input.isPackaged && input.environment.NODE_ENV === development"'],
  ])('rejects %s', (_name, before, after) => {
    const evidence = inspectSemanticFixture(semanticMutation(SEMANTIC_BUS_MAIN, before.replaceAll('\\n', '\n'), after.replaceAll('\\n', '\n')));
    expect(evidence.passed).toBe(false);
    expect(evidence.checks).toContainEqual({ code: 'PACKAGED_DEV_DOWNGRADE_GUARD_PRESENT', passed: false });
    expect(evidence.checks).toHaveLength(11);
  });

  it('accepts the actual tracked registrar binding to Electron ipcMain', () => {
    const evidence = inspectSemanticFixture(SEMANTIC_TRACKED_BUS_MAIN + SEMANTIC_BUNDLED_SELF_CHECK);
    expect(evidence.passed).toBe(true);
    expect(evidence.summary).toEqual({ total: 11, passed: 11, failed: 0 });
  });

  it.each([
    ['fake registrar provider', 'createTrackedIpcRegistrar(electron.ipcMain,', 'createTrackedIpcRegistrar(fakeIpcMain,'],
    ['wrong runtime getter', 'const mainRuntimeContext2 = getMainRuntimeContext();', 'const mainRuntimeContext2 = fakeRuntime;'],
    ['wrong exposed registrar', 'const runtime = { registerTrackedIpcHandler,', 'const runtime = { registerTrackedIpcHandler: unsafeRegistrar,'],
    ['shadowed native registrar', 'return (channel, listener) => { ipcMain2.handle', 'return (ipcMain2, listener) => { ipcMain2.handle'],
  ])('rejects tracked status %s', (_name, before, after) => {
    const evidence = inspectSemanticFixture(semanticMutation(SEMANTIC_TRACKED_BUS_MAIN, before, after));
    expect(evidence.checks).toContainEqual({ code: 'LEGACY_SAVED_PASSWORD_IPC_ABSENT', passed: false });
  });

  it.each([
    ['real registration', 'ipcMain.handle("browser:get-saved-credentials", () => savedPassword);'],
    ['real invoke', 'ipcRenderer.invoke("browser:get-saved-credentials");'],
    ['computed registration method', 'ipcMain["handle"]("browser:get-saved-credentials", () => savedPassword);'],
    ['escaped channel', 'ipcMain.handle("browser:get-saved-credenti\\u0061ls", () => savedPassword);'],
    ['constant alias', 'const legacyChannel = "browser:get-saved-credentials"; ipcMain.handle(legacyChannel, () => savedPassword);'],
    ['constant concatenation', 'ipcMain.handle("browser:get-saved-" + "credentials", () => savedPassword);'],
    ['array channel construction', 'ipcMain.handle(["browser", "get-saved-credentials"].join(":"), () => savedPassword);'],
    ['template channel construction', 'ipcMain.handle(`browser:get-saved-${"credentials"}`, () => savedPassword);'],
    ['unknown inert literal', 'const unrelated = "browser:get-saved-credentials";'],
    ['unknown self-check body', 'function pretend() { return !mainBundleText.includes("browser:get-saved-credentials"); }'],
  ])('rejects legacy leakage through %s', (_name, extra) => {
    const evidence = inspectSemanticFixture(SEMANTIC_BUS_MAIN + SEMANTIC_SELF_CHECK + extra);
    expect(evidence.passed).toBe(false);
    expect(evidence.checks).toContainEqual({ code: 'LEGACY_SAVED_PASSWORD_IPC_ABSENT', passed: false });
    expect(JSON.stringify(evidence)).not.toContain('savedPassword');
  });

  it('requires a real unique status registration rather than checker string presence', () => {
    const source = semanticMutation(SEMANTIC_BUS_MAIN,
      'ipcMain.handle("browser:get-saved-credential-status", () => status);',
      'const statusText = "browser:get-saved-credential-status";');
    const evidence = inspectSemanticFixture(source + SEMANTIC_SELF_CHECK);
    expect(evidence.checks).toContainEqual({ code: 'LEGACY_SAVED_PASSWORD_IPC_ABSENT', passed: false });
    const duplicate = inspectSemanticFixture(SEMANTIC_BUS_MAIN + 'ipcMain.handle("browser:get-saved-credential-status", () => status);');
    expect(duplicate.checks).toContainEqual({ code: 'LEGACY_SAVED_PASSWORD_IPC_ABSENT', passed: false });
  });

  it('rejects forged collector read bindings and unsupported malformed input', () => {
    const forged = inspectSemanticFixture(SEMANTIC_BUS_MAIN + SEMANTIC_SELF_CHECK.replace('require("node:fs")', 'unsafeReader'));
    expect(forged.checks).toContainEqual({ code: 'LEGACY_SAVED_PASSWORD_IPC_ABSENT', passed: false });
    const malformed = inspectSemanticFixture(SEMANTIC_BUS_MAIN + '\nconst = ;');
    expect(malformed.checks).toContainEqual({ code: 'PACKAGED_DEV_DOWNGRADE_GUARD_PRESENT', passed: false });
    expect(malformed.checks).toContainEqual({ code: 'LEGACY_SAVED_PASSWORD_IPC_ABSENT', passed: false });
  });
});


const OWNED_TRACKED_FORWARDING = 'ipcMain2.handle(channel, async (event, ...args) => { try { return await operationTracker.run(channel, () => listener(event, ...args)); } catch (error2) { logger.error("ipc.handler_failed", { channel, error: error2 }); throw error2; } });';

describe('package security supported object ports and reachable registrar', () => {
  it.each([
    ['Object.assign runtime', 'const { development, rendererFilePath } = runtime;', 'Object.assign(runtime, { development: true }); const { development, rendererFilePath } = runtime;'],
    ['Reflect runtime setter', 'const { development, rendererFilePath } = runtime;', 'Reflect.set(runtime, "development", true); const { development, rendererFilePath } = runtime;'],
    ['runtime property definition', 'const { development, rendererFilePath } = runtime;', 'Object.defineProperty(runtime, "development", { value: true }); const { development, rendererFilePath } = runtime;'],
    ['runtime prototype write', 'const { development, rendererFilePath } = runtime;', 'Object.setPrototypeOf(runtime, unsafePrototype); const { development, rendererFilePath } = runtime;'],
    ['runtime alias escape', 'const { development, rendererFilePath } = runtime;', 'const escapedRuntime = runtime; Object.assign(escapedRuntime, { development: true }); const { development, rendererFilePath } = runtime;'],
    ['runtime nested argument escape', 'const { development, rendererFilePath } = runtime;', 'unknownWriter({ value: runtime }); const { development, rendererFilePath } = runtime;'],
    ['runtime callback escape', 'const { development, rendererFilePath } = runtime;', 'unknownWriter(() => runtime); const { development, rendererFilePath } = runtime;'],
    ['runtime spread escape', 'const { development, rendererFilePath } = runtime;', 'unknownWriter({ ...runtime }); const { development, rendererFilePath } = runtime;'],
    ['aliased writer', 'const { development, rendererFilePath } = runtime;', 'const write = Object.assign; write(runtime, { development: true }); const { development, rendererFilePath } = runtime;'],
    ['input mutation', 'return Object.freeze({ development:', 'Object.assign(input, { isPackaged: false }); return Object.freeze({ development:'],
    ['input alias escape', 'return Object.freeze({ development:', 'const escapedInput = input; unknownWriter(escapedInput); return Object.freeze({ development:'],
    ['source environment mutation', 'const environment = captureBootstrapEnvironment(sourceEnvironment);', 'Object.assign(sourceEnvironment, { NODE_ENV: "development" }); const environment = captureBootstrapEnvironment(sourceEnvironment);'],
    ['captured environment escape', 'const evidenceIdentity = {};', 'const escapedEnvironment = environment; const evidenceIdentity = {};'],
    ['configuration escape', 'const admission = true;', 'unknownWriter(configuration); const admission = true;'],
    ['returned runtime mutation', 'Object.freeze(runtime);', 'Object.assign(runtime, { createWindow: unsafeWindowFactory }); Object.freeze(runtime);'],
    ['bootstrap app mutation', 'const desktopBootstrap = initializeDesktopBootstrap(electron.app,', 'Object.assign(electron.app, { isPackaged: false }); const desktopBootstrap = initializeDesktopBootstrap(electron.app,'],
    ['bootstrap configuration mutation', 'const createWindow = createDesktopWindowFactory(', 'Object.defineProperty(desktopBootstrap.configuration, "development", { value: true }); const createWindow = createDesktopWindowFactory('],
    ['bootstrap paths escape', 'const createWindow = createDesktopWindowFactory(', 'Object.assign(bootstrapConfiguration.paths, { rendererFilePath: unsafeFile }); const createWindow = createDesktopWindowFactory('],
    ['created window mutation', 'const rendererLoad = development ?', 'Object.assign(createdWindow, { loadFile: unsafeLoader }); const rendererLoad = development ?'],
    ['webContents mutation', 'const rendererLoad = development ?', 'Object.assign(createdWindow.webContents, { openDevTools: unsafeLoader }); const rendererLoad = development ?'],
    ['created window escape', 'const rendererLoad = development ?', 'unknownWriter(createdWindow); const rendererLoad = development ?'],
    ['untrusted window callback', 'rendererFilePath: bootstrapConfiguration.paths.rendererFilePath });', 'rendererFilePath: bootstrapConfiguration.paths.rendererFilePath, onCreated: (window2) => { window2.webContents.openDevTools(); } });'],
  ])('rejects unsupported object port %s', (_name, before, after) => {
    const evidence = inspectSemanticFixture(semanticMutation(SEMANTIC_BUS_MAIN, before, after));
    expect(evidence.checks).toContainEqual({ code: 'PACKAGED_DEV_DOWNGRADE_GUARD_PRESENT', passed: false });
    expect(evidence.passed).toBe(false);
  });

  it.each([
    ['dead handle', 'ipcMain2.handle(channel, listener);', 'if (false) ipcMain2.handle(channel, listener);'],
    ['rewritten channel', 'ipcMain2.handle(channel, listener);', 'channel = ["browser", "get-saved-credentials"].join(":"); ipcMain2.handle(channel, listener);'],
    ['rewritten listener', 'ipcMain2.handle(channel, listener);', 'listener = unsafeListener; ipcMain2.handle(channel, listener);'],
    ['early return', 'ipcMain2.handle(channel, listener);', 'return; ipcMain2.handle(channel, listener);'],
    ['wrong forwarded channel', 'ipcMain2.handle(channel, listener);', 'ipcMain2.handle("wrong-channel", listener);'],
    ['extra returned closure', 'return (channel, listener) => { ipcMain2.handle(channel, listener); };', 'return (channel, listener) => () => { ipcMain2.handle(channel, listener); };'],
    ['aliased native registrar', 'ipcMain2.handle(channel, listener);', 'const nativeIpc = ipcMain2; nativeIpc.handle(channel, listener);'],
    ['dead status statement', 'mainRuntimeContext2.registerTrackedIpcHandler("browser:get-saved-credential-status", () => status);', 'if (false) mainRuntimeContext2.registerTrackedIpcHandler("browser:get-saved-credential-status", () => status);'],
    ['missing startup registration port', 'createWindow: mainRuntimeContext.createWindow, registerIpcHandlers', 'createWindow: mainRuntimeContext.createWindow'],
    ['wrong startup registration port', 'createWindow: mainRuntimeContext.createWindow, registerIpcHandlers', 'createWindow: mainRuntimeContext.createWindow, registerIpcHandlers: unsafeRegistration'],
    ['dead startup registration call', 'options.registerIpcHandlers(); options.createWindow();', 'if (false) options.registerIpcHandlers(); options.createWindow();'],
    ['unwired startup registration call', 'options.registerIpcHandlers(); options.createWindow();', 'options.createWindow();'],
    ['dead startup entry', 'if (mainRuntimeContext.mainStartupAdmission)', 'if (false)'],
  ])('rejects unreachable or rewritten registrar %s', (_name, before, after) => {
    const evidence = inspectSemanticFixture(semanticMutation(SEMANTIC_TRACKED_BUS_MAIN, before, after));
    expect(evidence.checks).toContainEqual({ code: 'LEGACY_SAVED_PASSWORD_IPC_ABSENT', passed: false });
    expect(evidence.passed).toBe(false);
  });

  it('accepts the exact owned async forwarding and rejects its dead tracker path', () => {
    const source = semanticMutation(SEMANTIC_TRACKED_BUS_MAIN, 'ipcMain2.handle(channel, listener);', OWNED_TRACKED_FORWARDING);
    expect(inspectSemanticFixture(source).passed).toBe(true);
    const dead = semanticMutation(source, 'return await operationTracker.run(channel, () => listener(event, ...args));', 'if (false) return await operationTracker.run(channel, () => listener(event, ...args));');
    expect(inspectSemanticFixture(dead).checks).toContainEqual({ code: 'LEGACY_SAVED_PASSWORD_IPC_ABSENT', passed: false });
  });

  it('preserves the exact post-capture startup nonce cleanup and rejects an extra delete', () => {
    const cleanup = 'let admission; const gateEnvironment = { ...environment }; try { admission = true; } finally { for (const name of Object.values(S7_STARTUP_GATE_ENV)) { if (!Object.prototype.hasOwnProperty.call(gateEnvironment, name)) delete sourceEnvironment[name]; } }';
    const source = 'const S7_STARTUP_GATE_ENV = Object.freeze({ nonce: "FIXTURE_NONCE" });\n'
      + semanticMutation(SEMANTIC_BUS_MAIN, 'const admission = true;', cleanup);
    expect(inspectSemanticFixture(source).passed).toBe(true);
    const unsafe = semanticMutation(source, 'const environment = captureBootstrapEnvironment(sourceEnvironment);', 'delete sourceEnvironment.NODE_ENV; const environment = captureBootstrapEnvironment(sourceEnvironment);');
    expect(inspectSemanticFixture(unsafe).checks).toContainEqual({ code: 'PACKAGED_DEV_DOWNGRADE_GUARD_PRESENT', passed: false });
  });
});


// 固定真实登记前缀只作 AST 夹具，不执行其中的业务调用。
const AUDITED_REGISTRATION_PREFIX_SOURCE = "const mainRuntimeContext2 = getMainRuntimeContext();\n  registerRendererRuntimeLogIpc(mainRuntimeContext2.trackedIpcRegistrar, runtimeLogger);\n  if (!mainRuntimeContext2.state.storeCoordinator)\n    throw new Error(\"Store coordinator is not initialized\");\n  if (!mainRuntimeContext2.state.storeDailyStatusReader)\n    throw new Error(\"Store daily status reader is not initialized\");\n  if (!mainRuntimeContext2.state.missionDomainService)\n    throw new Error(\"Mission domain service is not initialized\");\n  if (!mainRuntimeContext2.state.analysisAuthorityService)\n    throw new Error(\"Analysis authority service is not initialized\");\n  if (!mainRuntimeContext2.state.executionAuthorityService)\n    throw new Error(\"Execution authority service is not initialized\");\n  if (!mainRuntimeContext2.state.storeRuntimeConfigService)\n    throw new Error(\"Store runtime config service is not initialized\");\n  if (!mainRuntimeContext2.state.storeCollectionMainRuntime || !mainRuntimeContext2.state.storeCollectionSchedulerReadModel) {\n    throw new Error(\"Store collection production runtime is not initialized\");\n  }\n  if (!mainRuntimeContext2.state.productRepo || !mainRuntimeContext2.state.operationEventRepo) {\n    throw new Error(\"Store-scoped object repositories are not initialized\");\n  }\n  const schedulerEvidenceIpc = mainRuntimeContext2.packageUiSchedulerAudit.wrapRegistrar(mainRuntimeContext2.trackedIpcRegistrar);\n  mainRuntimeContext2.packageUiSchedulerAudit.registerDatabaseCheckpointIpc(schedulerEvidenceIpc);\n  registerStoreIpcHandlers(mainRuntimeContext2.trackedIpcRegistrar, mainRuntimeContext2.state.storeCoordinator, {\n    withUserStoreMutation: async (scope, work) => {\n      if (mainRuntimeContext2.packageUiReadOnlyRuntime) {\n        if (mainRuntimeContext2.pendingBrowserLogin || mainRuntimeContext2.state.isLoggedIn || mainRuntimeContext2.state.loginSession || mainRuntimeContext2.visibleBrowserRuntimeRegistry.read()) {\n          throw new StoreCollectionMainRuntimeError(\n            \"USER_OPERATION_BLOCKED\",\n            \"Package UI setup mutations are allowed only before visible login starts\"\n          );\n        }\n        return mainRuntimeContext2.state.storeCollectionMainRuntime.withPackageUiSetupMutation(\n          scope,\n          () => {\n            const laneActive = mainRuntimeContext2.state.storeCoordinator.getActiveStoreContext();\n            assertStoreIpcMutationTargetPreflight(\n              mainRuntimeContext2.state.storeCoordinator,\n              scope,\n              laneActive\n            );\n            return work();\n          }\n        );\n      }\n      const active = mainRuntimeContext2.state.storeCoordinator.getActiveStoreContext();\n      if (active)\n        mainRuntimeContext2.state.executionAuthorityService.assertStoreMutationAllowed(active);\n      let transitionedActiveAuthority = false;\n      const result = await mainRuntimeContext2.state.storeCollectionMainRuntime.withUserStoreMutation(\n        scope,\n        () => {\n          const laneActive = mainRuntimeContext2.state.storeCoordinator.getActiveStoreContext();\n          assertStoreIpcMutationTargetPreflight(\n            mainRuntimeContext2.state.storeCoordinator,\n            scope,\n            laneActive\n          );\n          const requiresTransition = storeMutationRequiresVisibleBrowserTransition(\n            scope,\n            laneActive ? String(laneActive.storeId) : void 0\n          );\n          if (!requiresTransition)\n            return work();\n          transitionedActiveAuthority = true;\n          return runUserVisibleBrowserTransition({\n            leases: mainRuntimeContext2.browserOperationLeases,\n            owner: `store-ipc:${scope.operation}`,\n            closeRuntime: closeUserVisibleBrowserRuntimeForTransition,\n            assertRuntimeClosed: assertUserVisibleBrowserRuntimeClosed,\n            work,\n            readFinalState: readEmptyUserVisibleBrowserTransitionState\n          });\n        }\n      );\n      const fresh = mainRuntimeContext2.state.storeCoordinator.getActiveStoreContext();\n      if (transitionedActiveAuthority && fresh) {\n        await mainRuntimeContext2.state.executionAuthorityService.resumePolicyGrantDispatches(\n          fresh,\n          \"store_activated\"\n        ).catch(() => {\n          runtimeLog.error(\"[Execution] persisted policy-grant recovery failed after store activation\");\n        });\n      }\n      return result;\n    },\n    beforeActiveStoreMutation: async (context) => {\n      mainRuntimeContext2.state.executionAuthorityService.assertStoreMutationAllowed(context);\n      mainRuntimeContext2.state.storeCoordinator.assertActiveStoreContext(context);\n    },\n    onStoreChanged: async (view) => {\n      if (view === null) {\n        if (mainRuntimeContext2.state.storeCoordinator.getActiveStoreContext() !== null) {\n          throw new Error(\"STORE_CHANGED_NULL_CONFLICTS_WITH_ACTIVE_AUTHORITY\");\n        }\n        mainRuntimeContext2.lastPublishedStoreContext = null;\n        mainRuntimeContext2.state.currentStore = \"\";\n        mainRuntimeContext2.mainWindow?.webContents.send(\"store-context:changed\", null);\n        mainRuntimeContext2.mainWindow?.webContents.send(\"business-ui:data-updated\");\n        return;\n      }\n      const freshView = mainRuntimeContext2.state.storeCoordinator.getActiveStoreWorkspaceView();\n      if (!freshView || freshView.store.storeId !== view.store.storeId) {\n        throw new Error(\"STORE_CHANGED_FRESH_AUTHORITY_MISSING\");\n      }\n      storeCapsuleFor(freshView.store);\n      try {\n        mainRuntimeContext2.state.executionAuthorityService.reconcileActiveStore(freshView.context);\n      } catch (error2) {\n        runtimeLog.error(\"[Execution] recovered Mission stop reconciliation failed:\", error2);\n      }\n      mainRuntimeContext2.state.currentStore = freshView.store.displayName;\n      publishStoreContextChanged(freshView);\n      mainRuntimeContext2.mainWindow?.webContents.send(\"business-ui:data-updated\");\n    },\n    onStoreRecordChanged: async (store) => {\n      const activeContext = mainRuntimeContext2.state.storeCoordinator?.getActiveStoreContext();\n      if (activeContext?.storeId === store.storeId) {\n        mainRuntimeContext2.state.currentStore = store.status === \"active\" ? store.displayName : \"\";\n      }\n      storeCapsuleFor(store);\n      mainRuntimeContext2.mainWindow?.webContents.send(\"stores:changed\", store);\n      const freshView = mainRuntimeContext2.state.storeCoordinator.getActiveStoreWorkspaceView();\n      if (freshView?.store.storeId === store.storeId) {\n        mainRuntimeContext2.state.currentStore = freshView.store.displayName;\n        publishStoreContextChanged(freshView);\n      } else if (!freshView && activeContext?.storeId === store.storeId) {\n        mainRuntimeContext2.lastPublishedStoreContext = null;\n        mainRuntimeContext2.state.currentStore = \"\";\n        mainRuntimeContext2.mainWindow?.webContents.send(\"store-context:changed\", null);\n      }\n      mainRuntimeContext2.mainWindow?.webContents.send(\"business-ui:data-updated\");\n    },\n    onPostCommitFailure: ({ operation, targetStoreId, error: error2 }) => {\n      runtimeLog.error(\n        `[StoreIPC] ${operation} committed but Renderer publication failed` + (targetStoreId ? ` for ${targetStoreId}` : \"\"),\n        error2\n      );\n    }\n  }, mainRuntimeContext2.state.storeDailyStatusReader);\n  registerMissionControlIpcHandlers(\n    schedulerEvidenceIpc,\n    mainRuntimeContext2.state.storeCoordinator,\n    createMissionControlLegacyAdapter({\n      buildTodayProjection: buildAuthoritativeMissionControlTodayProjection,\n      analysisAuthorityReady: Boolean(mainRuntimeContext2.state.analysisAuthorityService),\n      executionAuthorityReady: Boolean(mainRuntimeContext2.state.executionAuthorityService),\n      deliveryReadinessReady: true,\n      storeRuntimeConfigReady: Boolean(mainRuntimeContext2.state.storeRuntimeConfigService),\n      storeAutomationReady: Boolean(\n        mainRuntimeContext2.state.storeCollectionMainRuntime && mainRuntimeContext2.state.storeEvidenceRetentionService\n      ),\n      missionDomain: mainRuntimeContext2.state.missionDomainService\n    })\n  );\n  registerMissionDomainIpcHandlers(mainRuntimeContext2.trackedIpcRegistrar, mainRuntimeContext2.state.missionDomainService);\n  registerAnalysisAuthorityIpcHandlers(mainRuntimeContext2.trackedIpcRegistrar, mainRuntimeContext2.state.analysisAuthorityService);\n  registerExecutionAuthorityIpcHandlers(mainRuntimeContext2.trackedIpcRegistrar, mainRuntimeContext2.state.executionAuthorityService);\n  registerAnalysisRunsIpcHandlers(mainRuntimeContext2.trackedIpcRegistrar, mainRuntimeContext2.state.analysisAuthorityService, mainRuntimeContext2.state.storeCoordinator);\n  registerV16ServicesIpc(mainRuntimeContext2.trackedIpcRegistrar, {\n    domain: mainRuntimeContext2.state.missionDomainService,\n    analysis: mainRuntimeContext2.state.analysisAuthorityService,\n    execution: mainRuntimeContext2.state.executionAuthorityService,\n    storeCoordinator: mainRuntimeContext2.state.storeCoordinator\n  });\n  runtimeLog.log(\"[App] ipc:v16-services-registered\");\n  mainRuntimeContext2.registerTrackedIpcHandler(\n    \"execution-authority:discover-recommendation-target\",\n    (_, input) => handleDiscoverRecommendationTarget(input)\n  );\n  registerStoreRuntimeConfigIpcHandlers(\n    mainRuntimeContext2.trackedIpcRegistrar,\n    mainRuntimeContext2.state.storeRuntimeConfigService,\n    () => {\n      mainRuntimeContext2.mainWindow?.webContents.send(\"business-ui:data-updated\");\n    }\n  );\n  if (!mainRuntimeContext2.state.storeEvidenceRetentionService) {\n    throw new Error(\"\\u5E97\\u94FA\\u8BC1\\u636E\\u4FDD\\u7559\\u9884\\u89C8\\u670D\\u52A1\\u5C1A\\u672A\\u5C31\\u7EEA\\u3002\");\n  }\n  registerStoreEvidenceRetentionIpcHandlers(\n    schedulerEvidenceIpc,\n    mainRuntimeContext2.state.storeEvidenceRetentionService\n  );\n  registerStoreCollectionSchedulerIpcHandlers(\n    schedulerEvidenceIpc,\n    mainRuntimeContext2.packageUiReadOnlyRuntime ? {\n      get: (context) => readPackageUiStoreCollectionSchedule(context),\n      runNow: async () => {\n        throw new Error(\n          \"PACKAGE_UI_EVIDENCE_READ_ONLY: package UI evidence may read scheduler state but may not execute collection.\"\n        );\n      }\n    } : mainRuntimeContext2.state.storeCollectionSchedulerReadModel ? {\n      get: (context) => mainRuntimeContext2.state.storeCollectionSchedulerReadModel.get(context),\n      runNow: (context) => mainRuntimeContext2.state.storeCollectionSchedulerReadModel.runNow(context)\n    } : (() => {\n      throw new Error(\"\\u6B63\\u5F0F\\u91C7\\u96C6\\u8C03\\u5EA6\\u8BFB\\u6A21\\u578B\\u5C1A\\u672A\\u521D\\u59CB\\u5316\\u3002\");\n    })()\n  );\n  registerStoreScopedObjectsIpcHandlers(\n    mainRuntimeContext2.trackedIpcRegistrar,\n    new StoreScopedObjectsService({\n      storeCoordinator: mainRuntimeContext2.state.storeCoordinator,\n      productRepository: mainRuntimeContext2.state.productRepo,\n      operationEventRepository: mainRuntimeContext2.state.operationEventRepo,\n      validateEvidenceArtifact: (store, artifactId) => {\n        try {\n          mainRuntimeContext2.mainArtifactRegistry.resolve({\n            artifactId,\n            currentStoreId: store.storeId,\n            allowedRoots: artifactAllowedRootsForStore(store, \"export-file\")\n          });\n          return true;\n        } catch {\n          return false;\n        }\n      }\n    }),\n    {\n      onObjectsChanged: (context, mutation) => {\n        mainRuntimeContext2.state.missionDomainService.recordOperationEventMutation(context, mutation);\n        mainRuntimeContext2.mainWindow?.webContents.send(\"business-ui:data-updated\");\n      }\n    }\n  );\n  mainRuntimeContext2.state.storeScopedAdListingService = new StoreScopedAdListingService({\n    db: mainRuntimeContext2.state.db,\n    storeCoordinator: mainRuntimeContext2.state.storeCoordinator\n  });\n  registerStoreScopedAdListingIpcHandlers(\n    mainRuntimeContext2.trackedIpcRegistrar,\n    mainRuntimeContext2.state.storeScopedAdListingService,\n    {\n      onListingChanged: () => {\n        mainRuntimeContext2.mainWindow?.webContents.send(\"business-ui:data-updated\");\n      }\n    }\n  );\n  mainRuntimeContext2.registerTrackedIpcHandler(\"app:get-version\", () => mainRuntimeContext2.APP_VERSION);\n  mainRuntimeContext2.registerTrackedIpcHandler(\"app:get-state\", () => ({\n    isLoggedIn: mainRuntimeContext2.state.isLoggedIn,\n    currentStore: mainRuntimeContext2.state.currentStore,\n    loginSession: mainRuntimeContext2.state.loginSession,\n    storeContext: mainRuntimeContext2.state.storeCoordinator?.getActiveStoreContext() ?? null\n  }));\n  registerSettingsIpcHandlers(mainRuntimeContext2.trackedIpcRegistrar, {\n    readAiSettingsForMain,\n    persistAiSettingsForMain,\n    resolveBusinessStoreAuthority,\n    handleTestAiSettings,\n    handleListAiCallLogs,\n    getRuleConfig: () => mainRuntimeContext2.state.ruleConfig,\n    saveRuleConfig: (config) => mainRuntimeContext2.state.configurationBus?.saveRuleConfig(config),\n    handleGetOperationScope,\n    handleSaveOperationScope,\n    handleGetStoragePaths,\n    onBusinessDataUpdated: () => mainRuntimeContext2.mainWindow?.webContents.send(\"business-ui:data-updated\")\n  });";
const ACORN_PROTOTYPE_READ_FIXTURE = "var require_acorn_fixture = __commonJS({\n  \"../../node_modules/.pnpm/acorn@8.16.0/node_modules/acorn/dist/acorn.js\"(exports2, module2) {\n    (function (exports3) {\n      var ref = Object.prototype;\n      var hasOwnProperty = ref.hasOwnProperty;\n      var toString = ref.toString;\n      function privateScope() { var ref = {}; return ref; }\n    })(exports2);\n  }\n});\n";

describe('package security complete builtin bindings and audited registration prefix', () => {
  it.each([
    [
        "hoisted require function",
        "function require(name) { const real = module.require(name); return name === \"electron\" ? { ...real, app: new Proxy(real.app, { get(target, key) { return key === \"isPackaged\" ? false : Reflect.get(target, key); } }) } : real; }"
    ],
    [
        "top Object function",
        "function Object() {}"
    ],
    [
        "top process function",
        "function process() {}"
    ],
    [
        "top require class",
        "class require {}"
    ],
    [
        "top Object class",
        "class Object { static freeze(value) { return { ...value, development: true }; } }"
    ],
    [
        "top process class",
        "class process { static env = { NODE_ENV: \"development\" }; }"
    ],
    [
        "top Object pattern binding",
        "const { Object } = unsafeBuiltins;"
    ],
    [
        "top array require binding",
        "const [require] = unsafeBuiltins;"
    ],
    [
        "object-pattern require write",
        "({ require } = unsafeBuiltins);"
    ],
    [
        "array-pattern require write",
        "[require] = unsafeBuiltins;"
    ],
    [
        "for-of require write",
        "for (require of unsafeBuiltins) {}"
    ],
    [
        "for-in require write",
        "for (require in unsafeBuiltins) {}"
    ],
    [
        "for-of pattern require write",
        "for ([require] of unsafeBuiltins) {}"
    ],
    [
        "program block var require binding",
        "if (true) { var require = unsafeRequire; }"
    ],
    [
        "program catch require binding",
        "try { throw 0; } catch (require) {}"
    ],
    [
        "dynamic with scope",
        "with (unsafeBuiltins) {}"
    ]
])('rejects critical builtin binding %s', (_name, injection) => {
    const evidence = inspectSemanticFixture(injection + '\n' + SEMANTIC_BUS_MAIN);
    expect(evidence.passed).toBe(false);
    expect(evidence.checks).toContainEqual({ code: 'PACKAGED_DEV_DOWNGRADE_GUARD_PRESENT', passed: false });
  });

  it.each([
    [
        "Object.assign native Object",
        "Object.assign(Object, { freeze: value => value?.development === false ? { ...value, development: true } : value });"
    ],
    [
        "Reflect.set native Object",
        "Reflect.set(Object, \"freeze\", value => ({ ...value, development: true }));"
    ],
    [
        "native Object defineProperty",
        "Object.defineProperty(Object, \"freeze\", { value: value => ({ ...value, development: true }) });"
    ],
    [
        "native Object defineProperties",
        "Object.defineProperties(Object, { freeze: { value: value => ({ ...value, development: true }) } });"
    ],
    [
        "native Object alias",
        "const Builtin = Object; Object.assign(Builtin, { freeze: value => ({ ...value, development: true }) });"
    ],
    [
        "native Object destructuring escape",
        "const { freeze: rawFreeze } = Object;"
    ],
    [
        "aliased native writer",
        "const write = Object.assign; write(Object, { freeze: value => ({ ...value, development: true }) });"
    ],
    [
        "native Object callback escape",
        "unknownWriter(() => Object);"
    ],
    [
        "native Object Proxy escape",
        "const nativeProxy = new Proxy(Object, unsafeHandler);"
    ]
])('rejects native Object mutation or escape %s', (_name, injection) => {
    const evidence = inspectSemanticFixture(injection + '\n' + SEMANTIC_BUS_MAIN);
    expect(evidence.passed).toBe(false);
    expect(evidence.checks).toContainEqual({ code: 'PACKAGED_DEV_DOWNGRADE_GUARD_PRESENT', passed: false });
  });

  it('rejects a local Object class that replaces the actual frozen development value', () => {
    const source = semanticMutation(SEMANTIC_BUS_MAIN, 'return Object.freeze({ development:',
      'class Object { static freeze(value) { return { ...value, development: true }; } } return Object.freeze({ development:');
    expect(inspectSemanticFixture(source).checks).toContainEqual({ code: 'PACKAGED_DEV_DOWNGRADE_GUARD_PRESENT', passed: false });
  });

  it('supports the exact private Acorn prototype reads and rejects a writable alias', () => {
    expect(inspectSemanticFixture(SEMANTIC_BUS_MAIN + ACORN_PROTOTYPE_READ_FIXTURE).passed).toBe(true);
    const unsafe = semanticMutation(ACORN_PROTOTYPE_READ_FIXTURE, 'var hasOwnProperty = ref.hasOwnProperty;',
      'Object.assign(ref, { constructor: unsafeConstructor }); var hasOwnProperty = ref.hasOwnProperty;');
    expect(inspectSemanticFixture(SEMANTIC_BUS_MAIN + unsafe).passed).toBe(false);
  });

  it.each([
    [
        "unconditional return",
        "return;"
    ],
    [
        "unconditional throw",
        "throw new Error(\"never register\");"
    ],
    [
        "infinite while",
        "while (true) {}"
    ],
    [
        "infinite for",
        "for (;;) {}"
    ],
    [
        "conditional early return",
        "if (true) return;"
    ],
    [
        "try early return",
        "try { return; } finally {}"
    ],
    [
        "process exit",
        "process.exit(0);"
    ],
    [
        "unknown immediate call",
        "unknownBeforeRegistration();"
    ],
    [
        "unknown IIFE initialization",
        "const stop = (() => { while (true) {} })();"
    ],
    [
        "extra known port outside audited prefix",
        "registerRendererRuntimeLogIpc(mainRuntimeContext2.trackedIpcRegistrar, runtimeLogger);"
    ]
])('rejects pre-registration barrier %s', (_name, statement) => {
    const source = semanticMutation(SEMANTIC_TRACKED_BUS_MAIN, 'function registerIpcHandlers() {',
      'function registerIpcHandlers() { ' + statement);
    const evidence = inspectSemanticFixture(source);
    expect(evidence.passed).toBe(false);
    expect(evidence.checks).toContainEqual({ code: 'LEGACY_SAVED_PASSWORD_IPC_ABSENT', passed: false });
  });

  it('rejects a registration default parameter that exits before the body', () => {
    const source = semanticMutation(SEMANTIC_TRACKED_BUS_MAIN, 'function registerIpcHandlers() {',
      'function registerIpcHandlers(stop = process.exit(0)) {');
    expect(inspectSemanticFixture(source).checks).toContainEqual({ code: 'LEGACY_SAVED_PASSWORD_IPC_ABSENT', passed: false });
  });

  it('supports the actual audited precondition guards and nested handler returns', () => {
    const source = semanticMutation(SEMANTIC_TRACKED_BUS_MAIN,
      'const mainRuntimeContext2 = getMainRuntimeContext();', AUDITED_REGISTRATION_PREFIX_SOURCE);
    expect(inspectSemanticFixture(source).passed).toBe(true);
    const unsafe = semanticMutation(source, 'function registerIpcHandlers() {', 'function registerIpcHandlers() { return;');
    expect(inspectSemanticFixture(unsafe).checks).toContainEqual({ code: 'LEGACY_SAVED_PASSWORD_IPC_ABSENT', passed: false });
  });
});


describe('package security supported synchronous startup slice', () => {
  it.each([
  [
    "globalThis direct native write",
    "globalThis.Object.freeze = value => value?.development === false ? { ...value, development: true } : value;"
  ],
  [
    "global computed native write",
    "global['Obj' + 'ect']['freeze'] = value => ({ ...value, development: true });"
  ],
  [
    "Reflect global native alias",
    "const builtin = Reflect.get(globalThis, 'Object'); builtin.freeze = value => ({ ...value, development: true });"
  ],
  [
    "call returned global native alias",
    "function nativeRoot() { return globalThis; } const builtin = nativeRoot().Object; builtin.freeze = value => ({ ...value, development: true });"
  ],
  [
    "literal constructor native alias",
    "const builtin = ({}).constructor; builtin.freeze = value => ({ ...value, development: true });"
  ],
  [
    "dynamic holder and dynamic native writer",
    "const holder = {}; const native = holder[String.fromCharCode(99,111,110,115,116,114,117,99,116,111,114)]; native[String.fromCharCode(102,114,101,101,122,101)] = value => value?.development === false ? { ...value, development: true } : value;"
  ],
  [
    "dynamic builtin in called closure",
    "function mutateNative() { const holder = {}; const native = holder[String.fromCharCode(99,111,110,115,116,114,117,99,116,111,114)]; native[String.fromCharCode(102,114,101,101,122,101)] = value => ({ ...value, development: true }); } mutateNative();"
  ],
  [
    "vm evaluation mutation",
    "require('node:vm').runInThisContext('Object.freeze = value => ({ ...value, development: true })');"
  ],
  [
    "Function returned native root",
    "const builtin = Function('return Object')(); builtin.freeze = value => ({ ...value, development: true });"
  ],
  [
    "indirect eval returned native root",
    "const builtin = (0, eval)('Object'); builtin.freeze = value => ({ ...value, development: true });"
  ],
  [
    "window native namespace escape",
    "const builtin = window.Object; builtin.freeze = value => ({ ...value, development: true });"
  ],
  [
    "self native namespace escape",
    "const builtin = self.Object; builtin.freeze = value => ({ ...value, development: true });"
  ],
  [
    "constructor key binding escape",
    "const holder = {}; const field = ['cons', 'tructor'].join(''); const builtin = holder[field]; builtin.freeze = value => ({ ...value, development: true });"
  ],
  [
    "unknown synchronous call",
    "unknownSynchronousInitialization();"
  ]
])('rejects unknown synchronous native access %s', (_name, injection) => {
    const evidence = inspectSemanticFixture(injection + '\n' + SEMANTIC_TRACKED_BUS_MAIN);
    expect(evidence.passed).toBe(false);
    expect(evidence.checks).toContainEqual({ code: 'PACKAGED_DEV_DOWNGRADE_GUARD_PRESENT', passed: false });
    expect(evidence.checks).toContainEqual({ code: 'LEGACY_SAVED_PASSWORD_IPC_ABSENT', passed: false });
  });

  it.each([
  [
    "for-of storage write",
    "for (currentRuntime of [{ createWindow() {}, mainStartupAdmission: true, registerTrackedIpcHandler() {} }]) {}"
  ],
  [
    "for-in storage write",
    "for (currentRuntime in { unsafe: true }) {}"
  ],
  [
    "pattern storage write",
    "[currentRuntime] = [unsafeRuntime];"
  ],
  [
    "update storage write",
    "currentRuntime++;"
  ],
  [
    "delete storage field",
    "delete currentRuntime.createWindow;"
  ],
  [
    "storage object mutation",
    "Object.assign(currentRuntime, { createWindow() {}, registerTrackedIpcHandler() {} });"
  ],
  [
    "storage callback escape",
    "unknownRuntimeWriter(() => currentRuntime);"
  ],
  [
    "storage alias escape",
    "const escapedRuntime = currentRuntime; escapedRuntime.createWindow = () => {};"
  ]
])('rejects extra runtime storage use %s', (_name, injection) => {
    const before = 'installMainRuntimeContext(createMainRuntimeContext(__filename));';
    const source = semanticMutation(SEMANTIC_TRACKED_BUS_MAIN, before, before + '\n' + injection);
    const evidence = inspectSemanticFixture(source);
    expect(evidence.passed).toBe(false);
    expect(evidence.checks).toContainEqual({ code: 'LEGACY_SAVED_PASSWORD_IPC_ABSENT', passed: false });
  });

  it.each([
  [
    "while false",
    "while (false) { %s }"
  ],
  [
    "nested if false",
    "if (false) { %s }"
  ],
  [
    "for zero iteration",
    "for (; false;) { %s }"
  ],
  [
    "never called closure",
    "(() => { %s });"
  ],
  [
    "try extra control",
    "try { %s } finally {}"
  ]
])('rejects nested startup entry %s', (_name, wrapper) => {
    const entry = 'void startDesktopApplication({ createWindow: mainRuntimeContext.createWindow, registerIpcHandlers });';
    const source = semanticMutation(SEMANTIC_TRACKED_BUS_MAIN, entry, wrapper.replace('%s', entry));
    const evidence = inspectSemanticFixture(source);
    expect(evidence.passed).toBe(false);
    expect(evidence.checks).toContainEqual({ code: 'LEGACY_SAVED_PASSWORD_IPC_ABSENT', passed: false });
  });

  it.each([
    ['configuration', 'function createBootstrapConfiguration(input) {'],
    ['environment capture', 'function captureBootstrapEnvironment(environment = process.env) {'],
    ['window factory', 'function createDesktopWindowFactory(runtime) {'],
    ['runtime context', 'function createMainRuntimeContext(mainModulePath) {'],
    ['IPC registration', 'function registerIpcHandlers() {'],
  ])('rejects unknown computed access in protected %s', (_name, anchor) => {
    const injection = ' const holder = {}; const native = holder[String.fromCharCode(99,111,110,115,116,114,117,99,116,111,114)]; native[String.fromCharCode(102,114,101,101,122,101)] = value => ({ ...value, development: true });';
    const evidence = inspectSemanticFixture(semanticMutation(SEMANTIC_TRACKED_BUS_MAIN, anchor, anchor + injection));
    expect(evidence.passed).toBe(false);
    expect(evidence.checks).toContainEqual({ code: 'PACKAGED_DEV_DOWNGRADE_GUARD_PRESENT', passed: false });
  });

  it('supports declaration-reference renaming without erasing distinct binding identities', () => {
    const renamed = SEMANTIC_TRACKED_BUS_MAIN.replaceAll('mainRuntimeContext2', 'mainRuntimeContext77');
    expect(inspectSemanticFixture(renamed).passed).toBe(true);
    const wrong = semanticMutation(renamed, 'mainRuntimeContext77.registerTrackedIpcHandler(', 'otherRuntime.registerTrackedIpcHandler(');
    expect(inspectSemanticFixture(wrong).passed).toBe(false);
  });

  it('supports the fixed Acorn UMD module as a nonexecuted definition', () => {
    const library = fs.readFileSync(require.resolve('acorn'), 'utf8');
    const module = 'var require_acorn = __commonJS({ "../../node_modules/.pnpm/acorn@8.16.0/node_modules/acorn/dist/acorn.js"(exports, module) {\n' + library + '\n} });';
    expect(inspectSemanticFixture(SEMANTIC_TRACKED_BUS_MAIN + module).passed).toBe(true);
  });
});


const SYNC_OPAQUE_PORT_SUFFIX = '\nfunction installGlobalRuntimeErrorHandlers() { return; }\ninstallGlobalRuntimeErrorHandlers();\n';

describe('package security unique opaque module bindings', () => {
  it('supports a fixed synchronous port while preserving its real function binding', () => {
    expect(inspectSemanticFixture(SEMANTIC_TRACKED_BUS_MAIN + SYNC_OPAQUE_PORT_SUFFIX).passed).toBe(true);
  });

  it.each([
  [
    "same name as called FunctionDeclaration",
    "var installGlobalRuntimeErrorHandlers = __commonJS({ \"unreviewed\"(exports, module) { throw new Error(\"must not execute\"); } });"
  ],
  [
    "destructuring function collision",
    "var { prototype: installGlobalRuntimeErrorHandlers } = __commonJS({ \"unreviewed\"(exports, module) {} });"
  ],
  [
    "array destructuring function collision",
    "var [installGlobalRuntimeErrorHandlers] = __commonJS({ \"unreviewed\"(exports, module) {} });"
  ],
  [
    "duplicate CJS module identity",
    "var require_a = __commonJS({ \"duplicate\"(exports, module) {} }); var require_b = __commonJS({ \"duplicate\"(exports, module) {} });"
  ],
  [
    "multi declarator CJS shape",
    "var require_a = __commonJS({ \"a\"(exports, module) {} }), require_b = __commonJS({ \"b\"(exports, module) {} });"
  ],
  [
    "async CJS factory",
    "var require_async = __commonJS({ async \"unreviewed\"(exports, module) {} });"
  ],
  [
    "generator CJS factory",
    "var require_generator = __commonJS({ *\"unreviewed\"(exports, module) {} });"
  ],
  [
    "default parameter CJS factory",
    "var require_default = __commonJS({ \"unreviewed\"(exports = unknownSideEffect(), module) {} });"
  ]
])('rejects an excluded factory binding violation %s', (_name, injection) => {
    const source = injection + '\n' + SEMANTIC_TRACKED_BUS_MAIN + SYNC_OPAQUE_PORT_SUFFIX;
    const evidence = inspectSemanticFixture(source);
    expect(evidence.passed).toBe(false);
    expect(evidence.checks).toContainEqual({ code: 'PACKAGED_DEV_DOWNGRADE_GUARD_PRESENT', passed: false });
    expect(evidence.checks).toContainEqual({ code: 'LEGACY_SAVED_PASSWORD_IPC_ABSENT', passed: false });
  });

  it('keeps an unused unique factory inert but rejects its unreviewed invocation', () => {
    const definition = 'var require_inert = __commonJS({ "known-inert"(exports, module) {} });\n';
    expect(inspectSemanticFixture(definition + SEMANTIC_TRACKED_BUS_MAIN).passed).toBe(true);
    const active = inspectSemanticFixture(definition + SEMANTIC_TRACKED_BUS_MAIN + '\nrequire_inert();');
    expect(active.passed).toBe(false);
    expect(active.checks).toContainEqual({ code: 'PACKAGED_DEV_DOWNGRADE_GUARD_PRESENT', passed: false });
  });
});

// 固定真实浏览器与退出端口作源码夹具，仅解析 AST，不执行其中回调。
const REAL_BROWSER_NAVIGATION_FUNCTION = "async function navigateToLingxingDownloadCenter(controller, model, storeName) {\n  let page = getControllerPageOrThrow(controller);\n  try {\n    if (new URL(page.url()).origin !== \"https://ads.lingxing.com\" || /^https:\\/\\/ads\\.lingxing\\.com\\/restartLogin(?:\\/|$)/i.test(page.url())) {\n      page = await openLingxingAdsFromErp(controller);\n    }\n  } catch (error2) {\n    if (/可信 ERP 页面|Ads SSO|可见浏览器/u.test(error2 instanceof Error ? error2.message : String(error2))) {\n      throw error2;\n    }\n    page = await openLingxingAdsFromErp(controller);\n  }\n  await page.goto(model.candidateUrls[0], { waitUntil: \"domcontentloaded\", timeout: 45e3 }).catch(() => void 0);\n  if (await finalizeLingxingDownloadCenterPage(page, storeName))\n    return;\n  if (/^https:\\/\\/ads\\.lingxing\\.com\\/restartLogin(?:\\/|$)/i.test(page.url())) {\n    page = await openLingxingAdsFromErp(controller);\n    await page.goto(model.candidateUrls[0], { waitUntil: \"domcontentloaded\", timeout: 45e3 }).catch(() => void 0);\n    if (await finalizeLingxingDownloadCenterPage(page, storeName))\n      return;\n  }\n  const menuSelectors = [\n    'a.fa-download_menu[href=\"/ak_download/download_center/download_report_log/index\"]',\n    'a.not-root[href=\"/ak_download/download_center/download_report_log/index\"]',\n    'a[href=\"/ak_download/download_center/download_report_log/index\"]:has-text(\"\\u4E0B\\u8F7D\\u4E2D\\u5FC3\")'\n  ];\n  for (const selector of menuSelectors) {\n    const locator = page.locator(selector).first();\n    const visible = await locator.isVisible({ timeout: 5e3 }).catch(() => false);\n    if (!visible)\n      continue;\n    await Promise.all([\n      page.waitForLoadState(\"domcontentloaded\", { timeout: 45e3 }).catch(() => void 0),\n      locator.click({ timeout: 15e3 })\n    ]);\n    if (await finalizeLingxingDownloadCenterPage(page, storeName))\n      return;\n  }\n  await page.evaluate(() => {\n    window.location.href = \"/ak_download/download_center/download_report_log/index\";\n  });\n  await page.waitForLoadState(\"domcontentloaded\", { timeout: 45e3 }).catch(() => void 0);\n  if (await finalizeLingxingDownloadCenterPage(page, storeName))\n    return;\n  throw new Error(`\\u65E0\\u6CD5\\u8FDB\\u5165\\u9886\\u661F\\u5E7F\\u544A\\u4E0B\\u8F7D\\u4E2D\\u5FC3\\uFF0C\\u5F53\\u524D\\u9875\\u9762\\uFF1A${await page.title().catch(() => page.url())}`);\n}";
const AUDITED_EXIT_CODE_MODULE = "var require_cli_exit = __commonJS({ \"../../scripts/export-mission-control-authority-snapshot.js\"(exports, module) { const finish = ({ exitCode }) => {\n        process.exitCode = exitCode;\n      }; module.exports = { finish }; } });\n";
const CLASS_KEY_MODULE = "var require_class_keys = __commonJS({ \"semantic:class-keys\"(exports, module) { class Fields { currentRuntime = null; Object() { return null; } } module.exports = Fields; } });\n";

// 只解析当前自动采集登记前缀；不运行服务、回调或业务写入。
const COLLECTION_AUTOMATION_PREFIX = AUDITED_REGISTRATION_PREFIX_SOURCE
  .replace('  if (!mainRuntimeContext2.state.storeCollectionMainRuntime',
    '  if (!mainRuntimeContext2.state.storeCollectionAutomationService) throw new Error("店铺自动采集配置服务尚未初始化。");\n  if (!mainRuntimeContext2.state.storeCollectionMainRuntime')
  .replace('  if (!mainRuntimeContext2.state.storeEvidenceRetentionService)',
    '  registerStoreCollectionAutomationIpcHandlers(mainRuntimeContext2.trackedIpcRegistrar, mainRuntimeContext2.state.storeCollectionAutomationService, runtimeLogger, () => { mainRuntimeContext2.mainWindow?.webContents.send("business-ui:data-updated"); });\n  if (!mainRuntimeContext2.state.storeEvidenceRetentionService)');

describe('package security current collection registration and safe rejection logs', () => {
  const currentSource = () => semanticMutation(SEMANTIC_TRACKED_BUS_MAIN,
    'const mainRuntimeContext2 = getMainRuntimeContext();', COLLECTION_AUTOMATION_PREFIX);

  it('keeps exported audited templates and every nested template immutable', () => {
    const templates = require('./package-security-audited-startup.js');
    expect(Object.isFrozen(templates)).toBe(true);
    for (const value of Object.values(templates)) expect(Object.isFrozen(value)).toBe(true);
    for (const value of Object.values(templates.AUDITED_STARTUP_FUNCTIONS)) expect(Object.isFrozen(value)).toBe(true);
    for (const value of templates.AUDITED_REGISTRATION_PREFIXES) expect(Object.isFrozen(value)).toBe(true);
  });

  it('supports the complete current audited collection registration prefix', () => {
    expect(COLLECTION_AUTOMATION_PREFIX).not.toBe(AUDITED_REGISTRATION_PREFIX_SOURCE);
    expect(inspectSemanticFixture(currentSource()).passed).toBe(true);
  });

  it.each([
    ['unknown immediate call', source => source.replace('function registerIpcHandlers() {', 'function registerIpcHandlers() { unknownBeforeCollection();')],
    ['missing service guard', source => source.replace('if (!mainRuntimeContext2.state.storeCollectionAutomationService)', 'if (false)')],
    ['wrong service binding', source => source.replace('mainRuntimeContext2.state.storeCollectionAutomationService, runtimeLogger', 'mainRuntimeContext2.state.storeRuntimeConfigService, runtimeLogger')],
    ['callback global write', source => source.replace('mainRuntimeContext2.mainWindow?.webContents.send("business-ui:data-updated"); });', 'process.env.NODE_ENV = "development"; mainRuntimeContext2.mainWindow?.webContents.send("business-ui:data-updated"); });')],
  ])('rejects an unreviewed current collection prefix: %s', (_name, mutate) => {
    const source = currentSource(), changed = mutate(source);
    expect(changed).not.toBe(source);
    expect(inspectSemanticFixture(changed).passed).toBe(false);
  });

  it.each([
    ['invalid syntax', 'const secret = "PRIVATE_SOURCE_SENTINEL"; )', 'security.boundary_semantic_parse_failed', 'parse'],
    ['unknown synchronous call', 'unreviewedImmediate("PRIVATE_SOURCE_SENTINEL");\n' + SEMANTIC_TRACKED_BUS_MAIN, 'security.boundary_semantic_rejected', 'startup-slice'],
    ['builtin shadow', 'function Object() { return "PRIVATE_SOURCE_SENTINEL"; }\n' + SEMANTIC_TRACKED_BUS_MAIN, 'security.boundary_semantic_rejected', 'builtin-bindings'],
  ])('distinguishes syntax from contract rejection without source text: %s', (_name, source, event, phase) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(inspectSemanticFixture(source).passed).toBe(false);
      const entries = log.mock.calls.map(([value]) => JSON.parse(value));
      expect(entries).toContainEqual(expect.objectContaining({ level: 'error', event, context: expect.objectContaining({ phase }) }));
      expect(JSON.stringify(entries)).not.toContain('PRIVATE_SOURCE_SENTINEL');
      if (phase !== 'parse') expect(entries.some(entry => entry.event === 'security.boundary_semantic_parse_failed')).toBe(false);
    } finally { log.mockRestore(); }
  });
});

describe('package security actual runtime binding and realm ports', () => {
  it('supports the complete audited browser navigation callback', () => {
    expect(inspectSemanticFixture(SEMANTIC_TRACKED_BUS_MAIN + '\n' + REAL_BROWSER_NAVIGATION_FUNCTION).passed).toBe(true);
  });
  it('supports the audited inert CLI exit-code callback', () => {
    expect(inspectSemanticFixture(AUDITED_EXIT_CODE_MODULE + SEMANTIC_TRACKED_BUS_MAIN).passed).toBe(true);
  });
  it('treats noncomputed class field and method keys as names', () => {
    expect(inspectSemanticFixture(CLASS_KEY_MODULE + SEMANTIC_TRACKED_BUS_MAIN).passed).toBe(true);
  });
  it.each([
    ['argument IIFE runs in Main', 'page.evaluate((() => { Object.freeze = unsafeFreeze; return () => { window.location.href = "/ak_download/download_center/download_report_log/index"; }; })());\n' + SEMANTIC_TRACKED_BUS_MAIN],
    ['same-name fake evaluate port', 'const page = { evaluate(fn) { return fn(); } }; page.evaluate(() => { window.Object.freeze = unsafeFreeze; });\n' + SEMANTIC_TRACKED_BUS_MAIN],
    ['fake page inside the audited owner', SEMANTIC_TRACKED_BUS_MAIN + '\n' + semanticMutation(REAL_BROWSER_NAVIGATION_FUNCTION, 'let page = getControllerPageOrThrow(controller);', 'let page = { evaluate(fn) { return fn(); } };')],
    ['browser write moved to Main', 'window.location.href = "/ak_download/download_center/download_report_log/index";\n' + SEMANTIC_TRACKED_BUS_MAIN + '\n' + REAL_BROWSER_NAVIGATION_FUNCTION],
    ['class value reads runtime storage', semanticMutation(CLASS_KEY_MODULE, 'currentRuntime = null', 'currentRuntime = currentRuntime') + SEMANTIC_TRACKED_BUS_MAIN],
    ['computed class key reads runtime storage', semanticMutation(CLASS_KEY_MODULE, 'currentRuntime = null', '[currentRuntime] = null') + SEMANTIC_TRACKED_BUS_MAIN],
    ['unknown CLI exit-code owner', semanticMutation(AUDITED_EXIT_CODE_MODULE, 'process.exitCode = exitCode;', 'process.exitCode = exitCode + 1;') + SEMANTIC_TRACKED_BUS_MAIN],
    ['unknown CLI module path', semanticMutation(AUDITED_EXIT_CODE_MODULE, '../../scripts/export-mission-control-authority-snapshot.js', 'unreviewed-cli') + SEMANTIC_TRACKED_BUS_MAIN],
    ['process environment write beside an exit-code port', semanticMutation(AUDITED_EXIT_CODE_MODULE, 'process.exitCode = exitCode;', 'process.exitCode = exitCode; process.env.NODE_ENV = "development";') + SEMANTIC_TRACKED_BUS_MAIN],
  ])('rejects a realm or binding violation %s', (_name, source) => {
    const evidence = inspectSemanticFixture(source);
    expect(evidence.passed).toBe(false);
    expect(evidence.checks).toContainEqual({ code: 'PACKAGED_DEV_DOWNGRADE_GUARD_PRESENT', passed: false });
    expect(evidence.checks).toContainEqual({ code: 'LEGACY_SAVED_PASSWORD_IPC_ABSENT', passed: false });
  });
});
