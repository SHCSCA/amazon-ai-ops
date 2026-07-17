import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('desktop product config persistence contract', () => {
  it('passes currentPrice through the products:save-config handler', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const start = source.indexOf("ipcMain.handle('products:save-config'");
    const handler = source.slice(start, source.indexOf("ipcMain.handle('products:bulk-update-target-acos'", start));

    expect(handler).toContain('currentPrice: toNumber(input.cost.currentPrice)');
    expect(handler).toContain('cost: state.productRepo.getCost(saved.id)');
  });

  it('applies bulk target ACOS in one database transaction', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../preload/index.ts', import.meta.url), 'utf8');
    const start = source.indexOf("ipcMain.handle('products:bulk-update-target-acos'");
    const handler = source.slice(start, source.indexOf('// Logs', start));

    expect(handler).toContain('state.productRepo.updateTargetAcosMany');
    expect(handler).toContain('updatedCount: updatedProducts.length');
    expect(preload).toContain("bulkUpdateProductTargetAcos: (input: any) => ipcRenderer.invoke('products:bulk-update-target-acos', input)");
  });
});
