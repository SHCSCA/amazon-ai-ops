import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  StoreProfilePathError,
  deriveStoreCapsulePaths,
  ensureStoreCapsulePaths,
  resolveStoreCapsulePath,
} from './store-profile';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('store browser capsule paths', () => {
  it('derives separate Lingxing and Ads profiles for each store', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-store-'));
    temporaryRoots.push(root);
    const first = ensureStoreCapsulePaths(deriveStoreCapsulePaths(root, 'store-one', 'browser-one'));
    const second = ensureStoreCapsulePaths(deriveStoreCapsulePaths(root, 'store-two', 'browser-two'));

    expect(first.lingxingProfileDir).not.toBe(first.amazonAdsProfileDir);
    expect(first.lingxingProfileDir).not.toBe(second.lingxingProfileDir);
    expect(fs.existsSync(first.amazonAdsProfileDir)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('rejects path traversal, absolute caller paths, and path-shaped ids', () => {
    const root = path.resolve('C:\\trusted-store-root');
    const paths = deriveStoreCapsulePaths(root, 'store-one', 'browser-one');
    expect(() => resolveStoreCapsulePath(paths, '..', 'outside')).toThrow(/safe relative/);
    expect(() => resolveStoreCapsulePath(paths, path.resolve(root, 'absolute'))).toThrow(/safe relative/);
    expect(() => deriveStoreCapsulePaths(root, '..\\outside', 'browser-one')).toThrow();
    expect(() => deriveStoreCapsulePaths(root, 'CON', 'browser-one')).toThrow(/canonical Windows/);
    expect(() => deriveStoreCapsulePaths(root, 'store-one.', 'browser-one')).toThrow(/canonical Windows/);
    expect(() => deriveStoreCapsulePaths(root, 'store-one', 'C:browser')).toThrow();
    expect(deriveStoreCapsulePaths(root, 'Store-One', 'Browser-One')).toMatchObject({
      storeId: 'store-one',
      browserProfileId: 'browser-one',
    });
  });

  it('rejects forged capsule roots instead of trusting caller-owned absolute paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-store-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-outside-'));
    temporaryRoots.push(root, outside);
    const paths = deriveStoreCapsulePaths(root, 'store-one', 'browser-one');

    expect(() => resolveStoreCapsulePath({ ...paths, storeRoot: outside }, 'report.csv')).toThrow(
      StoreProfilePathError,
    );
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('fails before a junction can create profile directories outside its store capsule', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-store-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-outside-'));
    temporaryRoots.push(root, outside);
    const paths = deriveStoreCapsulePaths(root, 'store-one', 'browser-one');
    fs.mkdirSync(paths.storeRoot, { recursive: true });
    fs.symlinkSync(outside, path.join(paths.storeRoot, 'browser'), 'junction');

    expect(() => ensureStoreCapsulePaths(paths)).toThrow(/symbolic links or junctions/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});
