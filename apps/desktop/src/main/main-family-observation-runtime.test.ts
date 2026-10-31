import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { FamilyObservationAuthority, FamilyObservationSource } from './family-observation-service';
vi.mock('./main-business-scope-runtime', () => ({ resolveBusinessStoreAuthority: vi.fn() }));
vi.mock('./main-runtime-access', () => ({ getMainRuntimeContext: vi.fn() }));
vi.mock('./runtime-log-adapter', () => ({ runtimeLog: { warn: vi.fn() } }));
import { readFamilyObservationFile } from './main-family-observation-runtime';
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); vi.restoreAllMocks(); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-family-reader-')); roots.push(root);
  const store = path.join(root, 'synthetic-store'); const reports = path.join(store, 'reports'); fs.mkdirSync(reports, { recursive: true });
  const filePath = path.join(reports, 'campaign.csv'); fs.writeFileSync(filePath, 'synthetic');
  const context = normalizeStoreContextEnvelope({ storeId: 'synthetic-store', browserProfileId: 'synthetic-profile', marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles', businessDate: '2026-01-02', sessionGeneration: 1 });
  const authority: FamilyObservationAuthority = { context, storeName: 'Synthetic store' };
  const source: FamilyObservationSource = { id: 1, fileName: 'campaign.csv', batchId: 'synthetic', reportType: 'campaign', sha256: 'a'.repeat(64), dateFrom: '2026-01-01', dateTo: '2026-01-03', storeId: context.storeId, status: 'imported', filePath, fileSize: 9, version: '1' };
  return { root, store, reports, authority, source };
}
describe('Main-owned family file reader', () => {
  it('reads only a regular report file under the owned capsule', () => {
    const f = fixture(); expect(Buffer.from(readFamilyObservationFile(f.source, f.authority, f.root)).toString()).toBe('synthetic');
  });
  it('rejects renderer-like external and other store paths', () => {
    const f = fixture(); const external = path.join(f.root, 'other-store', 'reports', 'campaign.csv'); fs.mkdirSync(path.dirname(external), { recursive: true }); fs.writeFileSync(external, 'synthetic');
    expect(() => readFamilyObservationFile({ ...f.source, filePath: external }, f.authority, f.root)).toThrow();
  });
  it('rejects symlinks even into another folder of the same store', () => {
    const f = fixture(); const target = path.join(f.store, 'backups', 'private.csv'); fs.mkdirSync(path.dirname(target)); fs.writeFileSync(target, 'synthetic');
    fs.unlinkSync(f.source.filePath); fs.symlinkSync(target, f.source.filePath);
    expect(() => readFamilyObservationFile(f.source, f.authority, f.root)).toThrow();
  });
  it('rejects an intermediate symlink to another store', () => {
    const f = fixture(); const external = path.join(f.root, 'other-store'); fs.mkdirSync(external); fs.writeFileSync(path.join(external, 'campaign.csv'), 'synthetic');
    fs.rmSync(f.reports, { recursive: true }); fs.symlinkSync(external, f.reports, 'dir');
    expect(() => readFamilyObservationFile(f.source, f.authority, f.root)).toThrow();
  });
  it('rejects backups, evidence names, wrong size and oversized receipts before reading', () => {
    const f = fixture();
    expect(() => readFamilyObservationFile({ ...f.source, filePath: path.join(f.store, 'backups', 'campaign.csv') }, f.authority, f.root)).toThrow();
    expect(() => readFamilyObservationFile({ ...f.source, filePath: path.join(f.reports, 'audit.csv') }, f.authority, f.root)).toThrow();
    expect(() => readFamilyObservationFile({ ...f.source, fileSize: 8 }, f.authority, f.root)).toThrow();
    expect(() => readFamilyObservationFile({ ...f.source, fileSize: 33 * 1024 * 1024 }, f.authority, f.root)).toThrow();
  });
});
