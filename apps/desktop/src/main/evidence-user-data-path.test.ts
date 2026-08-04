import { describe, expect, it, vi } from 'vitest';
import {
  EVIDENCE_MODE_ENV,
  EVIDENCE_USER_DATA_DIR_ENV,
  PACKAGE_LAUNCH_WINDOW_READY_MARKER,
  PACKAGE_LAUNCH_SMOKE_MODE,
  PACKAGE_UI_EVIDENCE_MODE,
  configureEvidenceUserDataPath,
  isPackageLaunchWindowReadyMarker,
  validateEvidenceUserDataPath,
} from './evidence-user-data-path';

function fakeIo(realPath?: string) {
  return {
    existsSync: vi.fn(() => true),
    isDirectory: vi.fn(() => true),
    realpathSync: vi.fn((filePath: string) => realPath || filePath),
    writeFileSync: vi.fn(),
  };
}

describe('evidence userData path contract', () => {
  it('validates the launch-smoke window-ready marker against the exact Main/window/profile identity', () => {
    const marker = {
      kind: 'package-launch-window-ready',
      schemaVersion: 1,
      pid: 321,
      browserWindowId: 7,
      evidenceMode: PACKAGE_LAUNCH_SMOKE_MODE,
      userDataDir: 'D:\\Temp\\amazon-ai-ops-package-launch-smoke\\run-1',
      rendererUrl: 'file:///D:/App/resources/app.asar/dist/renderer/index.html',
      generatedAt: '2026-07-23T08:00:00.000Z',
    };

    expect(PACKAGE_LAUNCH_WINDOW_READY_MARKER).toBe('package-launch-window-ready.json');
    expect(isPackageLaunchWindowReadyMarker(marker, {
      pid: 321,
      browserWindowId: 7,
      userDataDir: 'd:\\temp\\amazon-ai-ops-package-launch-smoke\\run-1\\',
    })).toBe(true);
    expect(isPackageLaunchWindowReadyMarker({ ...marker, rendererUrl: '' })).toBe(false);
    expect(isPackageLaunchWindowReadyMarker({ ...marker, evidenceMode: 'package-ui' })).toBe(false);
    expect(isPackageLaunchWindowReadyMarker(marker, { pid: 999 })).toBe(false);
  });

  it('does not read or override userData during an ordinary application launch', () => {
    const app = { getPath: vi.fn(), setPath: vi.fn() };
    expect(configureEvidenceUserDataPath(app, {}, fakeIo())).toEqual({
      mode: null,
      overridden: false,
      userDataDir: null,
    });
    expect(app.setPath).not.toHaveBeenCalled();
    expect(app.getPath).not.toHaveBeenCalled();
  });

  it.each([PACKAGE_UI_EVIDENCE_MODE, PACKAGE_LAUNCH_SMOKE_MODE])(
    'sets and verifies the explicit D-drive userData before evidence mode %s proceeds',
    (mode) => {
      const expected = `D:\\Temp\\amazon-ai-ops-${mode}\\run-1`;
      const app = {
        getPath: vi.fn(() => expected),
        setPath: vi.fn(),
      };
      const io = fakeIo();
      const result = configureEvidenceUserDataPath(app, {
        [EVIDENCE_MODE_ENV]: mode,
        [EVIDENCE_USER_DATA_DIR_ENV]: expected,
      }, io);

      expect(app.setPath).toHaveBeenCalledWith('userData', expected);
      expect(app.getPath).toHaveBeenCalledWith('userData');
      expect(io.writeFileSync).toHaveBeenCalledWith(
        `${expected}\\evidence-user-data-runtime.json`,
        expect.stringContaining(`"mode": "${mode}"`),
      );
      expect(result).toEqual({ mode, overridden: true, userDataDir: expected });
    },
  );

  it.each([
    ['relative path', 'package-profile'],
    ['real AppData path', 'C:\\Users\\wz\\AppData\\Roaming\\@amazon-ai-ops\\desktop'],
    ['wrong D directory', 'D:\\Profiles\\amazon-ai-ops-package-ui'],
    ['unscoped temp directory', 'D:\\Temp\\package-ui'],
    ['UNC path', '\\\\server\\share\\amazon-ai-ops-package-ui'],
    ['alternate data stream', 'D:\\Temp\\amazon-ai-ops-package-ui:stream'],
  ])('rejects %s', (_label, candidate) => {
    expect(() => validateEvidenceUserDataPath(candidate, fakeIo())).toThrow();
  });

  it('rejects a D-drive junction that resolves outside the approved D:\\Temp subtree', () => {
    expect(() => validateEvidenceUserDataPath(
      'D:\\Temp\\amazon-ai-ops-package-ui\\profile',
      fakeIo('C:\\Users\\wz\\AppData\\Roaming\\@amazon-ai-ops\\desktop'),
    )).toThrow(/D: drive|symlink|junction/);
  });

  it('fails closed when the mode/path pair is incomplete, unsupported, or not applied by Electron', () => {
    const app = { getPath: vi.fn(() => 'D:\\Temp\\amazon-ai-ops-other'), setPath: vi.fn() };
    expect(() => configureEvidenceUserDataPath(app, {
      [EVIDENCE_MODE_ENV]: PACKAGE_UI_EVIDENCE_MODE,
    }, fakeIo())).toThrow(/provided together/);
    expect(() => configureEvidenceUserDataPath(app, {
      [EVIDENCE_USER_DATA_DIR_ENV]: 'D:\\Temp\\amazon-ai-ops-package-ui',
    }, fakeIo())).toThrow(/provided together/);
    expect(() => configureEvidenceUserDataPath(app, {
      [EVIDENCE_MODE_ENV]: 'unknown',
      [EVIDENCE_USER_DATA_DIR_ENV]: 'D:\\Temp\\amazon-ai-ops-package-ui',
    }, fakeIo())).toThrow(/not an allowed evidence mode/);
    expect(() => configureEvidenceUserDataPath(app, {
      [EVIDENCE_MODE_ENV]: PACKAGE_UI_EVIDENCE_MODE,
      [EVIDENCE_USER_DATA_DIR_ENV]: 'D:\\Temp\\amazon-ai-ops-package-ui',
    }, fakeIo())).toThrow(/did not take effect/);
  });
});
