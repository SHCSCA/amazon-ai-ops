import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('store evidence retention Main wiring contract', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

  it('registers the Main-authorized preview service without a deletion IPC', () => {
    expect(source).toContain('registerStoreEvidenceRetentionIpcHandlers(');
    expect(source).toContain('state.storeEvidenceRetentionService');
    expect(source).not.toContain("ipcMain.handle('store-evidence-retention:delete'");
    expect(source).not.toContain("ipcMain.handle('store-evidence-retention:apply'");
  });

  it('keeps legacy data_cleanup disabled and dry-run only', () => {
    const registration = source.match(/name: 'data_cleanup',[\s\S]*?\n\s*\}\);/)?.[0] ?? '';

    expect(registration).toContain('enabled: false');
    expect(registration).toContain('previewActiveStore()');
    expect(registration).toContain("mainWindow?.webContents.send('cleanup:report'");
    expect(registration).not.toMatch(/\.cleanup\s*\(/);
    expect(registration).not.toMatch(/unlinkSync|rmSync|removeSync|deleteFile/);
  });

  it('does not construct or invoke the destructive global CleanupManager', () => {
    expect(source).not.toContain('CleanupManager');
    expect(source).not.toContain('cleanupMgr');
  });

  it('derives retention paths without creating or ensuring the Store Capsule', () => {
    const start = source.indexOf('const storeEvidenceRetentionService = new StoreEvidenceRetentionPreviewService');
    const end = source.indexOf('const analysisAuthorityService', start);
    const wiring = source.slice(start, end);

    expect(wiring).toContain('deriveCapsuleFor: (context) => deriveStoreCapsulePaths(');
    expect(wiring).not.toContain('storeCapsuleFor(context)');
    expect(wiring).not.toContain('ensureStoreCapsulePaths');
  });
});
