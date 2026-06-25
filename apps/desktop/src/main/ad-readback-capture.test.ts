import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { saveReadbackCaptureFile } from './ad-readback-capture';

const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'readback-capture-'));
}

function writeSessionPaths(sessionDir: string) {
  const paths = {
    sessionDir,
    approvalsDir: path.join(sessionDir, 'approvals'),
    beforeScreenshotsDir: path.join(sessionDir, 'screenshots', 'before'),
    afterScreenshotsDir: path.join(sessionDir, 'screenshots', 'after'),
    readbackScreenshotsDir: path.join(sessionDir, 'screenshots', 'readback'),
  };
  for (const dirPath of Object.values(paths)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  fs.writeFileSync(path.join(sessionDir, 'session-paths.json'), `${JSON.stringify(paths, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(sessionDir, 'session-input.json'), `${JSON.stringify({
    beforeScreenshotPath: '',
    beforeCapturedAt: '',
    readbackEvidencePath: '',
    readbackReadAt: '',
  }, null, 2)}\n`, 'utf8');
  return paths;
}

describe('saveReadbackCaptureFile', () => {
  it('writes a pasted before screenshot into the prepared session folder', () => {
    const root = tempDir();
    const paths = writeSessionPaths(path.join(root, 'session'));

    const result = saveReadbackCaptureFile({
      slot: 'before',
      sessionDir: paths.sessionDir,
      dataUrl: ONE_PIXEL_PNG,
      fileName: 'before shot.png',
      fallbackRootDir: path.join(root, 'fallback'),
      now: new Date('2026-06-25T12:00:00.000Z'),
    });

    expect(result.slot).toBe('before');
    expect(result.savedAt).toBe('2026-06-25T12:00:00.000Z');
    expect(result.filePath).toContain(path.join('screenshots', 'before'));
    expect(path.basename(result.filePath)).toMatch(/^before-2026-06-25T12-00-00-000Z-before-shot\.png$/);
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(fs.readFileSync(result.filePath).length).toBeGreaterThan(10);
    const sessionInput = JSON.parse(fs.readFileSync(path.join(paths.sessionDir, 'session-input.json'), 'utf8'));
    expect(sessionInput.beforeScreenshotPath).toBe(result.filePath);
    expect(sessionInput.beforeCapturedAt).toBe('2026-06-25T12:00:00.000Z');
  });

  it('uses a local fallback evidence folder before a session packet exists', () => {
    const root = tempDir();

    const result = saveReadbackCaptureFile({
      slot: 'readback',
      dataUrl: ONE_PIXEL_PNG,
      fallbackRootDir: path.join(root, 'fallback'),
      now: new Date('2026-06-25T12:01:00.000Z'),
    });

    expect(result.filePath).toContain(path.join('fallback', 'readback'));
    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  it('rejects non-image clipboard payloads', () => {
    const root = tempDir();

    expect(() => saveReadbackCaptureFile({
      slot: 'after',
      dataUrl: 'data:text/plain;base64,SGVsbG8=',
      fallbackRootDir: root,
    })).toThrow(/Only image clipboard payloads/);
  });

  it('rejects session path mappings that escape the session folder', () => {
    const root = tempDir();
    const sessionDir = path.join(root, 'session');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'session-paths.json'), JSON.stringify({
      sessionDir,
      beforeScreenshotsDir: path.join(root, 'outside'),
    }), 'utf8');

    expect(() => saveReadbackCaptureFile({
      slot: 'before',
      sessionDir,
      dataUrl: ONE_PIXEL_PNG,
      fallbackRootDir: path.join(root, 'fallback'),
    })).toThrow(/outside the readback session/);
  });
});
