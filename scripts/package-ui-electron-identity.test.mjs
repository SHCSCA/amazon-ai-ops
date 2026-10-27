import {
  USER_DATA_DIR,
  collectElectronIdentity,
  describe,
  expect,
  it,
} from './package-ui-test-context.mjs';

describe('collectElectronIdentity', () => {
  it('passes evidence environment keys into the isolated Electron main-process evaluation', async () => {
    let receivedKeys = null;
    const electronApp = {
      evaluate: async (callback, envKeys) => {
        receivedKeys = envKeys;
        expect(String(callback)).not.toContain('EVIDENCE_MODE_ENV');
        expect(String(callback)).not.toContain('EVIDENCE_USER_DATA_DIR_ENV');
        return {
          actualExecutablePath: 'D:\\app\\AmazonAIOpsAgent.exe',
          actualUserDataDir: USER_DATA_DIR,
          appName: 'Amazon AI Ops Agent',
          appPath: 'D:\\app\\resources\\app',
          appVersion: '1.5.0',
          evidenceMode: 'package-ui',
          isPackaged: true,
          requestedUserDataDir: USER_DATA_DIR,
          resourcesPath: 'D:\\app\\resources',
        };
      },
    };
    const page = {
      title: async () => 'Amazon AI Ops Agent',
      url: () => 'file:///D:/app/resources/app/dist/renderer/index.html',
    };

    const identity = await collectElectronIdentity(electronApp, page);

    expect(receivedKeys).toEqual({
      evidenceMode: 'AMAZON_AI_OPS_EVIDENCE_MODE',
      userDataDir: 'AMAZON_AI_OPS_USER_DATA_DIR',
    });
    expect(identity).toMatchObject({
      actualUserDataDir: USER_DATA_DIR,
      evidenceMode: 'package-ui',
      rendererTitle: 'Amazon AI Ops Agent',
      rendererUrl: 'file:///D:/app/resources/app/dist/renderer/index.html',
      requestedUserDataDir: USER_DATA_DIR,
    });
  });

  it('retries a bounded Electron identity read when startup navigation destroys the transient execution context', async () => {
    let evaluateCalls = 0;
    const electronApp = {
      evaluate: async () => {
        evaluateCalls += 1;
        if (evaluateCalls === 1) {
          throw new Error('Execution context was destroyed, most likely because of a navigation.');
        }
        return {
          actualExecutablePath: 'D:\\app\\AmazonAIOpsAgent.exe',
          actualUserDataDir: USER_DATA_DIR,
          appName: 'Amazon AI Ops Agent',
          appPath: 'D:\\app\\resources\\app',
          appVersion: '1.5.0',
          evidenceMode: 'package-ui',
          isPackaged: true,
          requestedUserDataDir: USER_DATA_DIR,
          resourcesPath: 'D:\\app\\resources',
        };
      },
    };
    const page = {
      title: async () => 'Amazon AI Ops Agent',
      url: () => 'file:///D:/app/resources/app/dist/renderer/index.html',
    };

    const identity = await collectElectronIdentity(electronApp, page, {
      retryIntervalMs: 0,
    });

    expect(evaluateCalls).toBe(2);
    expect(identity).toMatchObject({
      actualUserDataDir: USER_DATA_DIR,
      evidenceMode: 'package-ui',
      rendererTitle: 'Amazon AI Ops Agent',
    });
  });

  it('keeps the identity read alive when startup navigation outlasts the legacy three-attempt window', async () => {
    let evaluateCalls = 0;
    const electronApp = {
      evaluate: async () => {
        evaluateCalls += 1;
        if (evaluateCalls <= 3) {
          throw new Error('Execution context was destroyed, most likely because of a navigation.');
        }
        return {
          actualExecutablePath: 'D:\\app\\AmazonAIOpsAgent.exe',
          actualUserDataDir: USER_DATA_DIR,
          appName: 'Amazon AI Ops Agent',
          appPath: 'D:\\app\\resources\\app',
          appVersion: '1.5.0',
          evidenceMode: 'package-ui',
          isPackaged: true,
          requestedUserDataDir: USER_DATA_DIR,
          resourcesPath: 'D:\\app\\resources',
        };
      },
    };

    const identity = await collectElectronIdentity(electronApp, {
      title: async () => 'Amazon AI Ops Agent',
      url: () => 'file:///D:/app/resources/app/dist/renderer/index.html',
    }, {
      retryIntervalMs: 0,
    });

    expect(evaluateCalls).toBe(4);
    expect(identity.actualUserDataDir).toBe(USER_DATA_DIR);
  });

  it('fails immediately for a non-navigation Electron identity error', async () => {
    let evaluateCalls = 0;
    const electronApp = {
      evaluate: async () => {
        evaluateCalls += 1;
        throw new Error('Packaged runtime identity channel is unavailable.');
      },
    };

    await expect(collectElectronIdentity(electronApp, {
      title: async () => 'Amazon AI Ops Agent',
      url: () => 'file:///D:/app/resources/app/dist/renderer/index.html',
    }, {
      retryIntervalMs: 0,
    })).rejects.toThrow('Packaged runtime identity channel is unavailable.');
    expect(evaluateCalls).toBe(1);
  });

  it('stops after the configured number of transient navigation retries', async () => {
    let evaluateCalls = 0;
    const electronApp = {
      evaluate: async () => {
        evaluateCalls += 1;
        throw new Error('Execution context was destroyed, most likely because of a navigation.');
      },
    };

    await expect(collectElectronIdentity(electronApp, {
      title: async () => 'Amazon AI Ops Agent',
      url: () => 'file:///D:/app/resources/app/dist/renderer/index.html',
    }, {
      maxAttempts: 2,
      retryIntervalMs: 0,
    })).rejects.toThrow('Execution context was destroyed');
    expect(evaluateCalls).toBe(2);
  });
});
