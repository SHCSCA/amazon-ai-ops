import { mainRuntimeModuleContracts, mainRuntimeModuleContract, mainRuntimeFunctionContract, mainRuntimeVariableContract, mainRuntimeSectionContract } from './main-runtime-source.test-support';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = mainRuntimeModuleContract('main-ipc-registration-runtime.ts').replace(/\r\n/g, '\n');
const contextSource = mainRuntimeModuleContract('main-runtime-context.ts');
const moduleSource = readFileSync(new URL('./settings-ipc.ts', import.meta.url), 'utf8');
const compact = (text: string): string => text.replace(/\s+/g, '');

function between(startMarker: string, endMarker: string): string {
  const section = mainRuntimeSectionContract(startMarker, endMarker);
  expect(section.indexOf(startMarker), '职责源码缺少起始标记').toBeGreaterThanOrEqual(0);
  expect(section.length, '职责源码边界必须包含完整内容').toBeGreaterThan(startMarker.length);
  return section;
}

function settingsRegistration(): string {
  const registration = source.match(/\bregisterSettingsIpcHandlers\s*\(\s*trackedIpcRegistrar\s*,\s*\{([\s\S]*?)\n\s*\}\s*\);/);
  expect(registration, '设置通道必须接入同一个 trackedIpcRegistrar').not.toBeNull();
  return compact(registration?.[1] ?? '');
}

describe('settings IPC Main source wiring', () => {
  it('uses the existing tracked registrar and global operation tracker exactly once', () => {
    expect(source).toMatch(/import\s*\{\s*registerSettingsIpcHandlers\s*\}\s*from\s*['"]\.\/settings-ipc['"]/);
    expect(source.match(/\bregisterSettingsIpcHandlers\s*\(/g)).toHaveLength(1);
    expect(contextSource.match(/new MainIpcOperationTracker\(\)/g)).toHaveLength(1);
    expect(compact(contextSource)).toContain(
      'constregisterTrackedIpcHandler=createTrackedIpcRegistrar(ipcMain,mainIpcOperationTracker,runtimeLogger,);',
    );
    const registrar = between('const trackedIpcRegistrar = Object.freeze({', 'function analysisRuleRevision');
    expect(compact(registrar)).toContain('registerTrackedIpcHandler(channel,(event,input)=>listener(event,input))');
    settingsRegistration();
  });

  it('injects Main-only configuration, encryption persistence and store-authorized services', () => {
    const registration = settingsRegistration();
    for (const port of [
      'readAiSettingsForMain', 'persistAiSettingsForMain', 'resolveBusinessStoreAuthority',
      'handleTestAiSettings', 'handleListAiCallLogs', 'handleGetOperationScope',
      'handleSaveOperationScope', 'handleGetStoragePaths',
    ]) {
      expect(registration, `缺少 Main 服务端口：${port}`).toMatch(new RegExp(`(?:^|,)${port}(?:,|:${port},)`));
    }
    expect(registration).not.toContain('process.env');
    expect(registration).not.toContain('ipcMain');
  });

  it('keeps rules dynamic and saves through the configuration bus with the existing update event', () => {
    const registration = settingsRegistration();
    expect(registration).toContain('getRuleConfig:()=>state.ruleConfig,');
    expect(registration).toContain('saveRuleConfig:(config)=>state.configurationBus?.saveRuleConfig(config),');
    expect(registration).toContain('onBusinessDataUpdated:()=>');
    expect(registration).toContain("mainWindow?.webContents.send('business-ui:data-updated')");
    expect(registration).not.toContain('state.ruleConfig=');
  });

  it('registers the nine settings channels only in the extracted module', () => {
    for (const module of mainRuntimeModuleContracts()) { expect(module.source).not.toMatch(/\b(?:registerTrackedIpcHandler|ipcMain\.handle|trackedIpcRegistrar\.handle)\s*\(\s*['"]settings:/); }
    expect(moduleSource.match(/trackedRegistrar\.handle\('settings:/g)).toHaveLength(9);
    expect(moduleSource).not.toMatch(/\bipcMain\.handle\s*\(/);
  });

  it('retains the four synchronous shutdown admissions and waits before browser or database cleanup', () => {
    const barrier = between('const shutdownBarrierSteps = [', '] as const;');
    // 保留原四项同步准入，并加入解析排空，避免未退出的线程进入数据库清理。
    expect(barrier.match(/invokeShutdownOperationNow\s*\(/g)).toHaveLength(5);
    expect(barrier).not.toMatch(/\bawait\b/);
    for (const marker of [
      "name: 'report-parser-drain'", 'reportParserRuntime.stopAndDrain()',
      "name: 'main-ipc-drain'", 'mainIpcOperationTracker.stopAndDrain(shutdownTimeoutMs)',
      "name: 'local-scheduler-drain'", 'localScheduler?.stopAndDrain(shutdownTimeoutMs)',
      "name: 'store-collection-drain'", 'mainRuntime?.stopAndDrain(shutdownTimeoutMs)',
      "name: 'execution-authority'", 'executionAuthority?.prepareForShutdown(shutdownTimeoutMs)',
    ]) expect(barrier).toContain(marker);
    const cleanup = between('const handleBeforeQuit = createBeforeQuitCoordinator({', "app.on('before-quit', handleBeforeQuit)");
    expect(cleanup).toContain("cleanupFailurePolicy: 'fail-closed'");
    let previous = -1;
    for (const marker of [
      'const shutdownBarrierSteps = [', 'const shutdownBarrier = await Promise.allSettled(',
      'shutdownBarrierSteps.map((step) => step.operation)', 'if (barrierFailures.length > 0)',
      'throw new AggregateError(', 'await mainRuntime?.closeRegistry(shutdownTimeoutMs)',
      'await closeBrowserControllers(pendingControllers)', 'await db?.close()',
    ]) {
      const current = cleanup.indexOf(marker);
      expect(current, `关闭顺序错误：${marker}`).toBeGreaterThan(previous);
      previous = current;
    }
  });
});
