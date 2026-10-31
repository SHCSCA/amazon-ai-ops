import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const authority = require('./verify-production-authority-selection.js');

const roots = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-metadata-')); roots.push(root);
  for (let index = 1; index <= authority.TARGET_MIGRATION_VERSION; index += 1) {
    const name = index === 1 ? '0001-store-authority.ts' : String(index).padStart(4, '0') + '-fixture.ts';
    fs.writeFileSync(path.join(root, name), `export const FIXTURE_${index}_MIGRATION_VERSION = ${index};\nexport const FIXTURE_${index}_MIGRATION_NAME = 'fixture-${index}';\nexport const FIXTURE_${index}_MIGRATION_CHECKSUM = 'checksum-${index}';\n${index === 1 ? "export const LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM = 'legacy-checksum-1';" : ''}`);
  }
  fs.writeFileSync(path.join(root, 'index.ts'), fs.readdirSync(root).sort()
    .map(name => `export * from './${name.slice(0, -3)}';`).join('\n'));
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
  it('离线迁移与authority复用同一当前注册表版本', async () => {
    const runtime = await import('../packages/local-db/src/sqlite/db-migration-contract.ts');
    const { TARGET_VERSION } = require('./migrate-current-user-db.js');
    expect(authority.migrationContract()).toEqual(runtime.SQLITE_MIGRATION_CONTRACT);
    expect(TARGET_VERSION).toBe(runtime.SQLITE_SCHEMA_VERSION);
    expect(authority.TARGET_MIGRATION_VERSION).toBe(runtime.SQLITE_SCHEMA_VERSION);
  });
  it.each(['missing', 'duplicate', 'detached'])('拒绝注册表和迁移原件不一致 %s', (mode) => {
    const f = setup();
    const registry = path.join(f.root, 'index.ts');
    if (mode === 'missing') fs.unlinkSync(path.join(f.root, '0002-fixture.ts'));
    if (mode === 'duplicate') fs.appendFileSync(registry, "\nexport * from './0002-fixture';");
    if (mode === 'detached') fs.appendFileSync(registry, "\nexport * from './9999-detached';");
    expect(() => authority.migrationContract(f.root)).toThrow(/registry must bind/);
  });
  it('缺少末尾版本及重复版本均不能冒充完整合同', () => {
    const f = setup();
    const file = path.join(f.root, String(authority.TARGET_MIGRATION_VERSION).padStart(4, '0') + '-fixture.ts');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(`VERSION = ${authority.TARGET_MIGRATION_VERSION};`, 'VERSION = 1;'));
    expect(() => authority.migrationContract(f.root)).toThrow(/must contain versions/);
  });
  it('注册表只导出函数或部分元数据时不能取得完整版本信用', () => {
    const f = setup();
    const registry = path.join(f.root, 'index.ts');
    fs.writeFileSync(registry, fs.readFileSync(registry, 'utf8')
      .replace("export * from './0002-fixture';", "export { FIXTURE_2_MIGRATION_NAME } from './0002-fixture';"));
    expect(() => authority.migrationContract(f.root)).toThrow(/must export complete metadata/);
  });
  it('台账旧checksum或重复行不能通过当前注册表', () => {
    const contract = authority.migrationContract();
    const rows = contract.map(row => ({ ...row, status: 'applied' }));
    expect(authority.migrationRowsMatchProductionContract(rows)).toBe(true);
    const stale = structuredClone(rows);
    stale.at(-1).checksum = 'stale-checksum';
    expect(authority.migrationRowsMatchProductionContract(stale)).toBe(false);
    expect(authority.migrationRowsMatchProductionContract([...rows.slice(0, -1), rows[0]])).toBe(false);
  });
  it('打包验证模块导入和CLI帮助不读取开发迁移树或加载SQLite', () => {
    const script = [
      "const fs=require('node:fs'),Module=require('node:module');const read=fs.readFileSync,load=Module._load;",
      "fs.readFileSync=function(file,...args){if(typeof file==='string'&&file.replaceAll('\\\\','/').includes('/packages/local-db/src/sqlite/migrations/'))throw new Error('DEVELOPER_MIGRATION_SOURCE_FORBIDDEN');return read.call(this,file,...args)};",
      "Module._load=function(name,...args){if(name==='better-sqlite3')throw new Error('SQLITE_LOAD_FORBIDDEN');return load.call(this,name,...args)};",
      "const cli=require('./scripts/migrate-current-user-db');",
      "require('./scripts/verify-production-authority-selection');",
      "require('./scripts/verify-s7-migration-backup-restore');",
      "require('./scripts/v16-native-evidence');",
      "require('./scripts/package-ui-verifier');",
      "require('./scripts/verify-s7-live-migration-acceptance');",
      "if(cli.main(['node','migration','--help'],{log(){},error(){}})!==0)throw new Error('HELP_REJECTED');",
    ].join('');
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
  });
});
