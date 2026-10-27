import { mainRuntimeModuleContracts, mainRuntimeModuleContract, mainRuntimeFunctionContract, mainRuntimeVariableContract, mainRuntimeSectionContract } from './main-runtime-source.test-support';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = mainRuntimeModuleContract('index.ts');
const contextSource = mainRuntimeModuleContract('main-runtime-context.ts');
const initializationSource = mainRuntimeFunctionContract('initApp');
const bootstrapSource = readFileSync(new URL('./desktop-bootstrap.ts', import.meta.url), 'utf8');
const startupSource = readFileSync(new URL('./desktop-startup.ts', import.meta.url), 'utf8');

function ordered(source: string, markers: string[]): void {
  let previous = -1;
  for (const marker of markers) {
    const current = source.indexOf(marker);
    expect(current, `缺少或顺序错误: ${marker}`).toBeGreaterThan(previous);
    previous = current;
  }
}

describe('desktop bootstrap source wiring', () => {
  it('installs global error handling and synchronously admits startup before wiring the database initializer', () => {
    ordered(mainSource, [
      'installGlobalRuntimeErrorHandlers(app)',
      'installMainRuntimeContext(createMainRuntimeContext(__filename))',
      'if (mainStartupAdmission)',
      'void startDesktopApplication({',
      'initialize: initApp,',
    ]);
    expect(contextSource.match(/initializeDesktopBootstrap\(app,/g)).toHaveLength(1);
    expect(initializationSource.match(/\binitApp\s*\(/g)).toHaveLength(1);
    ordered(contextSource, ['const desktopBootstrap = initializeDesktopBootstrap(app, {', 'const mainStartupAdmission = desktopBootstrap.admission']);
    expect(initializationSource).toContain('state.db = initSqlite(DB_PATH)');
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('enforceS7MainStartupGate('); }
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toContain('configureEvidenceUserDataPath('); }
  });

  it('uses one environment snapshot for evidence path, canonical path and the S7 gate', () => {
    ordered(bootstrapSource, [
      'const environment = captureBootstrapEnvironment(sourceEnvironment)',
      'dependencies.configureEvidencePath(electronApp, environment)',
      "electronApp.getPath('userData')",
      'const configuration = createBootstrapConfiguration({',
      'dependencies.logger.setOutputDirectory(',
      'admission = dependencies.enforceStartupGate({',
      'return Object.freeze({ configuration, admission })',
    ]);
    expect(bootstrapSource).toContain('configureEvidencePath: configureEvidenceUserDataPath');
    expect(bootstrapSource).toContain('enforceStartupGate: enforceS7MainStartupGate');
    expect(bootstrapSource).toContain('canonicalUserDataDir: dependencies.resolveCanonicalPath(environment)');
    expect(bootstrapSource).toContain('const gateEnvironment = { ...environment }');
    expect(bootstrapSource).toContain('env: gateEnvironment,');
    expect(bootstrapSource).toContain('requestSingleInstanceLock: () => electronApp.requestSingleInstanceLock()');
  });

  it('logs and throws when startup admission fails so no database initialization can continue', () => {
    const failure = bootstrapSource.slice(bootstrapSource.indexOf('} catch (error) {'));
    ordered(failure, [
      "dependencies.logger.error('desktop.startup_blocked', { error })",
      'electronApp.exit(78)',
      'throw error',
    ]);
    expect(failure).toContain("dependencies.logger.error('desktop.startup_exit_failed', { error: exitError })");
    expect(bootstrapSource).not.toMatch(/initSqlite|initGuardedExistingSqlite|new BrowserWindow/);
    expect(startupSource).toContain("app.on('second-instance'");
  });

  it('registers lifecycle recovery and strict cleanup before starting the real initializer', () => {
    ordered(contextSource, ['const lifecycleRecovery = createAppLifecycleRecoveryController', 'const handleBeforeQuit = createBeforeQuitCoordinator']);
    ordered(mainSource, [
      'installMainRuntimeContext(createMainRuntimeContext(__filename))',
      "app.on('before-quit', handleBeforeQuit)",
      'void startDesktopApplication({',
    ]);
    const startup = mainSource.slice(mainSource.indexOf('void startDesktopApplication({'));
    expect(startup).toContain('lifecycleRecovery,');
    expect(startup).toContain('initialize: initApp,');
    expect(startup).toContain('registerIpcHandlers,');
    expect(startup).toContain('createWindow,');
    expect(startup).toContain('startBusinessDateMonitor: startStoreBusinessDateAuthorityMonitor');
    ordered(startupSource, [
      'return options.lifecycleRecovery.runStartupBootstrap(async () => {',
      'await app.whenReady()',
      'await options.initialize()',
      'options.registerIpcHandlers()',
      'options.createWindow()',
      'options.startBusinessDateMonitor()',
    ]);
  });
});
