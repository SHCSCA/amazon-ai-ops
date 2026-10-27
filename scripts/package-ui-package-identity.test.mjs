import {
  HASH_A,
  HASH_B,
  describe,
  expect,
  it,
  path,
  pathToFileURL,
  validatePackageIdentity,
} from './package-ui-test-context.mjs';
import {
  validIdentity,
} from './package-ui-test-fixtures.mjs';

describe('package identity fail-closed contract', () => {
  it('accepts only the expected packaged executable, unpacked app content, version and file renderer', () => {
    expect(validatePackageIdentity(validIdentity())).toEqual({ passed: true, violations: [] });
  });

  it.each([
    ['wrong executable hash', { actualExeSha256: HASH_B }, 'EXE_HASH_MISMATCH'],
    ['wrong unpacked app-content hash', { actualAppContentSha256: HASH_A }, 'APP_CONTENT_HASH_MISMATCH'],
    ['wrong executable', { actualExecutablePath: path.resolve('AmazonAIOpsAgent.exe') }, 'EXECUTABLE_PATH_MISMATCH'],
    ['unpackaged runtime', { isPackaged: false }, 'RUNTIME_NOT_PACKAGED'],
    ['preview renderer', { rendererUrl: 'file:///D:/resources/app/index.html?preview=1&scenario=diagnosis-ready' }, 'PREVIEW_RENDERER_FORBIDDEN'],
    ['web renderer', { rendererUrl: 'http://127.0.0.1:4174/' }, 'RENDERER_NOT_FILE_URL'],
    ['file renderer outside app content', { rendererUrl: 'file:///D:/outside/index.html' }, 'RENDERER_OUTSIDE_APP_CONTENT'],
    ['wrong renderer entry inside app content', {
      rendererUrl: pathToFileURL(path.resolve('apps/desktop/release/win-unpacked/resources/app/dist/renderer/alternate.html')).href,
    }, 'RENDERER_ENTRY_MISMATCH'],
    ['wrong app version', { appVersion: '1.4.0' }, 'APP_VERSION_MISMATCH'],
    ['wrong app path', { appPath: path.resolve('apps/desktop/dist') }, 'APP_CONTENT_PATH_MISMATCH'],
    ['real AppData userData', { actualUserDataDir: 'C:\\Users\\wz\\AppData\\Roaming\\@amazon-ai-ops\\desktop' }, 'ACTUAL_USER_DATA_UNSAFE'],
    ['different D-drive userData', { actualUserDataDir: 'D:\\Temp\\amazon-ai-ops-package-ui\\other-copy' }, 'USER_DATA_PATH_MISMATCH'],
    ['wrong evidence mode', { evidenceMode: 'package-launch-smoke' }, 'EVIDENCE_MODE_MISMATCH'],
  ])('rejects %s', (_label, overrides, code) => {
    const result = validatePackageIdentity(validIdentity(overrides));
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code }),
    ]));
  });
});
