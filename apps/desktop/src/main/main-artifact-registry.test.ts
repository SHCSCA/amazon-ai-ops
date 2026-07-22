import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertRendererPayloadIsPathFree,
  MainArtifactRegistry,
} from './main-artifact-registry';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-artifacts-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('MainArtifactRegistry', () => {
  it('opens only a current-store artifact that remains inside its allowed Main directory', () => {
    const allowedRoot = makeTempDir();
    const reportPath = path.join(allowedRoot, 'keyword.xlsx');
    fs.writeFileSync(reportPath, 'report');
    const registry = new MainArtifactRegistry({
      createId: () => '00000000-0000-4000-8000-000000000001',
    });

    const descriptor = registry.issue({
      storeId: 'store-a',
      absolutePath: reportPath,
      allowedRoots: [allowedRoot],
      kind: 'report-file',
      displayName: 'keyword.xlsx',
    });

    expect(descriptor).toEqual({
      artifactId: 'artifact:v1:00000000-0000-4000-8000-000000000001',
      kind: 'report-file',
      displayName: 'keyword.xlsx',
    });
    expect(JSON.stringify(descriptor)).not.toContain(reportPath);
    expect(registry.resolve({
      artifactId: descriptor.artifactId,
      currentStoreId: 'store-a',
      allowedRoots: [allowedRoot],
    })).toBe(fs.realpathSync(reportPath));

    expect(() => registry.resolve({
      artifactId: descriptor.artifactId,
      currentStoreId: 'store-b',
      allowedRoots: [allowedRoot],
    })).toThrow(/当前店铺/);
    expect(() => registry.resolve({
      artifactId: 'artifact:v1:00000000-0000-4000-8000-000000000099',
      currentStoreId: 'store-a',
      allowedRoots: [allowedRoot],
    })).toThrow(/无效或已失效/);

    const differentAllowedRoot = makeTempDir();
    expect(() => registry.resolve({
      artifactId: descriptor.artifactId,
      currentStoreId: 'store-a',
      allowedRoots: [differentAllowedRoot],
    })).toThrow(/受控目录/);
  });

  it('rejects artifacts outside the declared Main-owned directory', () => {
    const allowedRoot = makeTempDir();
    const outsideRoot = makeTempDir();
    const outsidePath = path.join(outsideRoot, 'forged.xlsx');
    fs.writeFileSync(outsidePath, 'report');
    const registry = new MainArtifactRegistry();

    expect(() => registry.issue({
      storeId: 'store-a',
      absolutePath: outsidePath,
      allowedRoots: [allowedRoot],
      kind: 'report-file',
      displayName: 'forged.xlsx',
    })).toThrow(/受控目录/);
  });

  it('fails closed when a renderer payload contains path keys or Windows paths', () => {
    expect(() => assertRendererPayloadIsPathFree({
      filePath: 'C:\\stores\\store-a\\downloads\\keyword.xlsx',
    })).toThrow(/filePath/);
    expect(() => assertRendererPayloadIsPathFree({
      files: [{ displayName: 'keyword.xlsx', source: '\\\\server\\share\\keyword.xlsx' }],
    })).toThrow(/绝对路径/);

    expect(assertRendererPayloadIsPathFree({
      files: [{
        displayName: 'keyword.xlsx',
        artifactId: 'artifact:v1:00000000-0000-4000-8000-000000000001',
      }],
    })).toBeUndefined();
  });

  it('keeps legacy path-returning report IPC endpoints out of the Main boundary', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).not.toContain("ipcMain.handle('report:download'");
    expect(source).not.toContain("ipcMain.handle('report:parse'");
    expect(source).not.toContain("ipcMain.handle('report:select-file'");
    expect(source).toContain("ipcMain.handle('v1_5:reports:open-artifact'");
    expect(source).toContain("ipcMain.handle('v1_5:business-ui:export-data-reconciliation-artifacts'");
  });
});
