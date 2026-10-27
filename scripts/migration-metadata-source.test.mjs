import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import authority from './verify-production-authority-selection.js';

const roots = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-metadata-')); roots.push(root);
  for (let index = 1; index <= authority.TARGET_MIGRATION_VERSION; index += 1) {
    const name = index === 1 ? '0001-store-authority.ts' : String(index).padStart(4, '0') + '-fixture.ts';
    fs.writeFileSync(path.join(root, name), `export const FIXTURE_${index}_MIGRATION_VERSION = ${index};\nexport const FIXTURE_${index}_MIGRATION_NAME = 'fixture-${index}';\nexport const FIXTURE_${index}_MIGRATION_CHECKSUM = 'checksum-${index}';\n${index === 1 ? "export const LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM = 'legacy-checksum-1';" : ''}`);
  }
  const entry = path.join(root, '0001-store-authority.ts'), source = fs.readFileSync(entry, 'utf8');
  const facade = "export { FIXTURE_1_MIGRATION_VERSION, FIXTURE_1_MIGRATION_NAME, FIXTURE_1_MIGRATION_CHECKSUM, LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM } from './store-authority-contracts';";
  return { root, entry, source, facade, contracts: path.join(root, 'store-authority-contracts.ts') };
}
describe('迁移元数据同源静态导出', () => {
  it('职责拆分后仍读取完整生产版本序列与明确legacy checksum', () => {
    const f = setup(), before = authority.migrationContract(f.root);
    fs.writeFileSync(f.contracts, f.source); fs.writeFileSync(f.entry, f.facade);
    expect(authority.migrationContract(f.root)).toEqual(before);
    expect(authority.legacyV1Checksum(f.root)).toBe('legacy-checksum-1');
  });
  it('拒绝从迁移目录之外选择另一份常量', () => {
    const f = setup(); fs.writeFileSync(f.entry, f.facade.replace('./store-authority-contracts', '../other-contracts'));
    expect(() => authority.migrationContract(f.root)).toThrow(/remain in its source directory/);
  });
  it('循环重导出不会递归溢出或丢失缺少的版本', () => {
    const f = setup(); fs.writeFileSync(f.entry, f.facade);
    fs.writeFileSync(f.contracts, f.facade.replace('./store-authority-contracts', './0001-store-authority'));
    expect(() => authority.migrationContract(f.root)).toThrow(/re-export cycle/);
  });
  it('重复checksum定义不能被当作当前迁移合同', () => {
    const f = setup(); fs.appendFileSync(f.entry, "\nexport const FIXTURE_1_MIGRATION_CHECKSUM = 'duplicate';");
    expect(() => authority.migrationContract(f.root)).toThrow(/Could not read the production migration contract/);
  });
  it('硬链接元数据不能绕过直接原件要求', () => {
    const f = setup(); fs.writeFileSync(f.contracts, f.source); fs.writeFileSync(f.entry, f.facade);
    fs.linkSync(f.contracts, path.join(f.root, 'duplicate.ts'));
    expect(() => authority.migrationContract(f.root)).toThrow(/direct unique file/);
  });
});
