import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('preload business update bridge', () => {
  it('forwards main-process business-ui:data-updated IPC events to renderer DOM listeners', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).toContain("ipcRenderer.on('business-ui:data-updated'");
    expect(source).toContain("window.dispatchEvent(new Event('business-ui:data-updated'))");
  });

  it('exposes remembered login credential IPC calls', () => {
    const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(source).toContain("getSavedLoginCredentials: () => ipcRenderer.invoke('browser:get-saved-credentials')");
    expect(source).toContain('rememberPassword');
  });
});
