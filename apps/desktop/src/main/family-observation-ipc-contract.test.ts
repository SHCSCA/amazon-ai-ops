import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('family observation desktop bridge', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main-ipc-registration-runtime.ts'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../preload/index.ts'), 'utf8');
  it('routes read-only operations through tracked IPC and sender-bound Main handlers', () => {
    for (const [channel, method] of [
      ['list', 'ListFamilyObservationFiles'], ['prepare', 'PrepareFamilyObservation'], ['confirm', 'ConfirmFamilyObservation'],
    ]) {
      const asynchronous = channel === 'confirm';
      expect(main).toContain(`registerTrackedIpcHandler('family-observation:${channel}', ${asynchronous ? 'async ' : ''}(event, input)`);
      expect(main).toContain(`rendererPayload(${asynchronous ? 'await ' : ''}handle${method}(event.sender.id, input))`);
      expect(preload).toContain(`ipcRenderer.invoke('family-observation:${channel}',`);
    }
    expect(main).toContain('handleCancelFamilyObservation(event.sender.id)');
    expect(preload).toContain("cancelFamilyObservation: (): Promise<void> => ipcRenderer.invoke('family-observation:cancel')");
  });
  it('offers typed IDs and token requests, never a path or byte bridge', () => {
    const methods = preload.slice(preload.indexOf('  listFamilyObservationFiles:'), preload.indexOf('  getDeliveryReadiness:'));
    expect(methods).toContain('fileIds: number[]');
    expect(methods).toContain('storeContext: StoreContextEnvelope; token: string');
    expect(methods).not.toMatch(/filePath|bytes|save|grant|execute/);
  });
});
