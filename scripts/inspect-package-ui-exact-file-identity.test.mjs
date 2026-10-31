import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFixture, fs, inspectFixture, path, require } from './inspect-package-ui-test-fixtures.mjs';

afterEach(() => vi.restoreAllMocks());

function withRoundedDatabaseIds(fixture) {
  const databases = new Set([fixture.protectedDb, path.join(fixture.profile, 'amazon-ai-ops.db')].map(value => path.resolve(value)));
  const descriptors = new Set();
  const original = Object.fromEntries(['lstatSync', 'fstatSync', 'openSync', 'closeSync'].map(key => [key, fs[key]]));
  const rounded = Number(9007199254740992n);
  const round = (stat, options) => options?.bigint ? stat
    : Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { ino: rounded });
  vi.spyOn(fs, 'lstatSync').mockImplementation((file, options) => {
    const stat = original.lstatSync(file, options);
    return databases.has(path.resolve(String(file))) ? round(stat, options) : stat;
  });
  vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
    const descriptor = original.openSync(file, ...args);
    if (databases.has(path.resolve(String(file)))) descriptors.add(descriptor);
    return descriptor;
  });
  vi.spyOn(fs, 'fstatSync').mockImplementation((descriptor, options) => {
    const stat = original.fstatSync(descriptor, options);
    return descriptors.has(descriptor) ? round(stat, options) : stat;
  });
  vi.spyOn(fs, 'closeSync').mockImplementation((descriptor) => {
    descriptors.delete(descriptor);
    return original.closeSync(descriptor);
  });
}

describe('恢复检查器的精确数据库身份', () => {
  it('Number fileId舍入重合时仍由原生精确身份端口决定隔离结果', () => {
    const fixture = createFixture();
    expect(Number(9007199254740992n)).toBe(Number(9007199254740993n));
    withRoundedDatabaseIds(fixture);
    const validateProfileProvenance = vi.fn(() => {
      const protectedId = fs.statSync(fixture.protectedDb, { bigint: true });
      const profileId = fs.statSync(path.join(fixture.profile, 'amazon-ai-ops.db'), { bigint: true });
      expect(protectedId.dev === profileId.dev && protectedId.ino === profileId.ino).toBe(false);
      return { fileIsolation: { passed: true, sameFileIdentity: false, sharedHardLinkCount: 0 }, provenance: { passed: true } };
    });
    expect(inspectFixture(fixture, { validateProfileProvenance }).status).toBe('RESUME_SAFE');
    expect(validateProfileProvenance).toHaveBeenCalledOnce();
  });

  it.each([
    { passed: false, sameFileIdentity: false, sharedHardLinkCount: 0 },
    { passed: true, sameFileIdentity: true, sharedHardLinkCount: 0 },
    { passed: true, sameFileIdentity: false, sharedHardLinkCount: 1 },
  ])('Number重合不绕过原生身份拒绝项 %j', (fileIsolation) => {
    const fixture = createFixture();
    withRoundedDatabaseIds(fixture);
    const capture = vi.fn(() => { throw new Error('ISOLATION_MUST_PRECEDE_SQLITE'); });
    const result = inspectFixture(fixture, {
      captureSqliteLogicalArtifact: capture,
      validateProfileProvenance: () => ({ fileIsolation, provenance: { passed: true } }),
    });
    expect(result.status).toBe('FRESH_PROFILE_REQUIRED');
    expect(result.violations.map(item => item.code)).toContain('PROFILE_DATABASE_FILE_ISOLATION_UNPROVEN');
    expect(capture).not.toHaveBeenCalled();
  });

  it('真实硬链接仍在稳定唯一文件读取门拒绝', () => {
    const fixture = createFixture();
    const shared = path.join(fixture.root, 'authority-hardlink.db');
    fs.linkSync(fixture.protectedDb, shared);
    const result = inspectFixture(fixture);
    expect(result.status).toBe('LINEAGE_CHANGED');
    expect(result.violations.map(item => item.code)).toContain('PROTECTED_DB_INVALID');
  });

  it('复用的原生身份读取端口保留大于2^53的相邻fileId', () => {
    const fixture = createFixture();
    const profile = path.join(fixture.profile, 'amazon-ai-ops.db');
    const ids = new Map([[path.resolve(fixture.protectedDb), 9007199254740992n], [path.resolve(profile), 9007199254740993n]]);
    const stat = (file, options) => {
      const actual = fs.statSync(file, options);
      return Object.assign(Object.create(Object.getPrototypeOf(actual)), actual, { ino: ids.get(path.resolve(file)) });
    };
    const port = require('./package-ui-file-identity.js')({ fs: { ...fs, lstatSync: stat, statSync: stat }, path });
    const left = port.readWindowsFileIdentity(fixture.protectedDb);
    const right = port.readWindowsFileIdentity(profile);
    expect(left.fileId).toBe('9007199254740992');
    expect(right.fileId).toBe('9007199254740993');
    expect(left.fileId).not.toBe(right.fileId);
  });
});
