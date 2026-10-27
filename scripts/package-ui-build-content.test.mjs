import {
  buildAppContentManifest,
  describe,
  expect,
  it,
  mkdtempSync,
  path,
  readFileSync,
  rmSync,
  symlinkSync,
  tmpdir,
  writeFileSync,
} from './package-ui-test-context.mjs';
import {
  withValidAppContent,
} from './package-ui-test-fixtures.mjs';

describe('unpacked app-content manifest', () => {
  it('hashes a deterministic sorted manifest with relative paths, per-file SHA-256 and sizes', () => {
    withValidAppContent((root) => {
      const first = buildAppContentManifest(root);
      const second = buildAppContentManifest(root);

      expect(second).toEqual(first);
      expect(first.kind).toBe('unpacked-app-content-manifest');
      expect(first.sha256).toMatch(/^[A-F0-9]{64}$/);
      expect(first.fileCount).toBe(7);
      expect(first.files.map((file) => file.path)).toEqual([
        'dist/main/index.js',
        'dist/preload/index.js',
        'dist/renderer/assets/index.js',
        'dist/renderer/index.html',
        'node_modules/runtime/index.js',
        'package.json',
        'playwright-browsers/chrome-win64/chrome.exe',
      ]);
      expect(first.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'dist/main/index.js', sha256: expect.stringMatching(/^[A-F0-9]{64}$/), sizeBytes: 10 }),
      ]));
    });
  });

  it('fails closed when a required unpacked runtime entry is missing', () => {
    withValidAppContent((root) => {
      rmSync(path.join(root, 'dist/renderer/index.html'));
      expect(() => buildAppContentManifest(root)).toThrow(/required packaged runtime entry is missing.*dist\/renderer\/index\.html/i);
    });
  });

  it('rejects a package.json main entry that traverses outside resources/app', () => {
    withValidAppContent((root) => {
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({
        main: '../../outside.js',
        name: '@amazon-ai-ops/desktop',
        version: JSON.parse(readFileSync(new URL('../apps/desktop/package.json', import.meta.url), 'utf8')).version,
      }), 'utf8');
      expect(() => buildAppContentManifest(root)).toThrow(/package\.json main must be a safe relative path/i);
    });
  });

  it('rejects an app-content path whose ancestor symlink or junction escapes the fixed path', () => {
    withValidAppContent((root) => {
      const aliasBase = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-alias-'));
      const aliasParent = path.join(aliasBase, 'reparse-parent');
      try {
        symlinkSync(path.dirname(root), aliasParent, process.platform === 'win32' ? 'junction' : 'dir');
        const escapedRoot = path.join(aliasParent, path.basename(root));
        expect(() => buildAppContentManifest(escapedRoot)).toThrow(/app-content path resolves through a symbolic link or junction/i);
      } finally {
        rmSync(aliasBase, { force: true, recursive: true });
      }
    });
  });

  it('rejects a nested symlink or junction before hashing its target', () => {
    withValidAppContent((root) => {
      const outside = mkdtempSync(path.join(tmpdir(), 'amazon-ai-ops-package-ui-outside-'));
      try {
        writeFileSync(path.join(outside, 'escape.js'), 'outside', 'utf8');
        symlinkSync(outside, path.join(root, 'node_modules/escape'), process.platform === 'win32' ? 'junction' : 'dir');
        expect(() => buildAppContentManifest(root)).toThrow(/may not contain symbolic links or junctions/i);
      } finally {
        rmSync(outside, { force: true, recursive: true });
      }
    });
  });

  it('changes the tree hash when any runtime file content changes', () => {
    withValidAppContent((root) => {
      const before = buildAppContentManifest(root);
      writeFileSync(path.join(root, 'dist/renderer/assets/index.js'), 'changed-renderer-bundle', 'utf8');
      const after = buildAppContentManifest(root);
      expect(after.sha256).not.toBe(before.sha256);
    });
  });

  it('rejects package metadata that does not identify the expected desktop app', () => {
    withValidAppContent((root) => {
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({
        main: 'dist/main/index.js',
        name: '@amazon-ai-ops/desktop',
        version: '9.9.9',
      }), 'utf8');
      expect(() => buildAppContentManifest(root)).toThrow(/package\.json metadata does not match the expected desktop package/i);
    });
  });
});
