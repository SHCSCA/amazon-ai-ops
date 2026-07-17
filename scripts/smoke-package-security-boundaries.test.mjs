import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  EXPECTED_PACKAGE_SECURITY_CHECK_CODES,
  collectPackageSecurityBoundaries,
  parsePackageSecurityBoundaryArgs,
  validatePackageSecurityEvidence,
} = require('./smoke-package-security-boundaries.js');

const HASH_A = 'A'.repeat(64);
const HASH_B = 'B'.repeat(64);
const HASH_C = 'C'.repeat(64);

function writeFixtureSources(dir, overrides = {}) {
  const files = {
    mainBundlePath: path.join(dir, 'dist', 'main', 'index.js'),
    settingsRepositoryPath: path.join(dir, 'settings-repo.ts'),
    sqliteDbPath: path.join(dir, 'db.ts'),
  };
  fs.mkdirSync(path.dirname(files.mainBundlePath), { recursive: true });
  fs.writeFileSync(files.mainBundlePath, overrides.mainBundle || [
    "const NAVIGATION_SECURITY_MARKER = 'amazon-ai-ops:navigation-security/v1';",
    "const LEGACY_LOGIN_MIGRATION_MARKER = 'amazon-ai-ops:legacy-login-migration/v1';",
    "const development = !app.isPackaged && process.env.NODE_ENV === 'development';",
    "mainWindow.webContents.on('will-navigate', createMainWindowNavigationHandler({}));",
    "mainWindow.webContents.on('will-redirect', createMainWindowNavigationHandler({}));",
    "mainWindow.webContents.setWindowOpenHandler(createSecureWindowOpenHandler({}));",
    "ipcMain.handle('browser:get-saved-credential-status', () => status);",
    'function openApprovedExternalTarget(safeUrl) { return shell.openExternal(safeUrl); }',
  ].join('\n'), 'utf8');
  fs.writeFileSync(files.settingsRepositoryPath, overrides.settingsRepository || [
    'export class SettingsRepository {',
    "  saveEncryptedLogin(value) { this.set('login_credentials_encrypted', value); }",
    '}',
  ].join('\n'), 'utf8');
  fs.writeFileSync(files.sqliteDbPath, overrides.sqliteDb || [
    "const db = new Database(finalPath);",
    'export default db;',
  ].join('\n'), 'utf8');
  return files;
}

describe('package security boundary evidence', () => {
  it('parses only explicit hash-bound output arguments', () => {
    expect(parsePackageSecurityBoundaryArgs([
      'node',
      'script',
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--out', 'evidence.json',
    ])).toMatchObject({
      expectedExeSha256: HASH_A,
      expectedAppContentSha256: HASH_B,
      out: 'evidence.json',
    });
    expect(() => parsePackageSecurityBoundaryArgs(['node', 'script', '--out', 'evidence.json']))
      .toThrow(/expected-exe-sha256/);
    expect(() => parsePackageSecurityBoundaryArgs([
      'node', 'script', '--expected-exe-sha256', HASH_A, '--expected-app-content-sha256', HASH_B, '--unknown', 'x',
    ])).toThrow(/Unexpected argument/);
  });

  it('emits a path-free, secret-free schema when every packaged boundary is present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'package-security-boundaries-'));
    try {
      const files = writeFixtureSources(dir);
      const evidence = collectPackageSecurityBoundaries({
        ...files,
        generatedAt: '2026-07-17T00:00:00.000Z',
        packageHashes: { exeSha256: HASH_A, appContentSha256: HASH_B },
        expectedExeSha256: HASH_A,
        expectedAppContentSha256: HASH_B,
      });

      expect(evidence).toMatchObject({
        kind: 'package-security-boundaries',
        schemaVersion: 1,
        generatedAt: '2026-07-17T00:00:00.000Z',
        passed: true,
        package: {
          executableSha256: HASH_A,
          appContentSha256: HASH_B,
        },
      });
      expect(evidence.checks.map((check) => check.code)).toEqual(EXPECTED_PACKAGE_SECURITY_CHECK_CODES);
      expect(evidence.checks.every((check) => check.passed === true)).toBe(true);
      expect(evidence.summary).toEqual({
        total: EXPECTED_PACKAGE_SECURITY_CHECK_CODES.length,
        passed: EXPECTED_PACKAGE_SECURITY_CHECK_CODES.length,
        failed: 0,
      });
      expect(validatePackageSecurityEvidence(evidence, {
        executableSha256: HASH_A,
        appContentSha256: HASH_B,
        mainBundleSha256: evidence.package.mainBundleSha256,
      })).toEqual({ passed: true, violations: [] });
      expect(validatePackageSecurityEvidence(evidence, {
        executableSha256: HASH_A,
        appContentSha256: HASH_B,
        mainBundleSha256: HASH_C,
      }).violations).toContain('package main-bundle hash mismatch');

      const serialized = JSON.stringify(evidence);
      expect(serialized).not.toContain(dir);
      expect(serialized).not.toMatch(/"(?:url|query|username|password|credential|sourcePath|bundlePath)"\s*:/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed without copying plaintext or unsafe source text into evidence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'package-security-boundaries-unsafe-'));
    try {
      const files = writeFixtureSources(dir, {
        mainBundle: [
          "const NAVIGATION_SECURITY_MARKER = 'amazon-ai-ops:navigation-security/v1';",
          "const LEGACY_LOGIN_MIGRATION_MARKER = 'amazon-ai-ops:legacy-login-migration/v1';",
          'mainWindow.webContents.setWindowOpenHandler(({ url }) => {',
          '  shell.openExternal(url);',
          "  return { action: 'deny' };",
          '});',
        ].join('\n'),
        settingsRepository: "this.set('login_password', 'never-copy-this-secret');",
        sqliteDb: 'new Database(finalPath, { verbose: console.log });',
      });
      const evidence = collectPackageSecurityBoundaries({
        ...files,
        packageHashes: { exeSha256: HASH_A, appContentSha256: HASH_B },
        expectedExeSha256: HASH_A,
        expectedAppContentSha256: HASH_B,
      });

      expect(evidence.passed).toBe(false);
      expect(evidence.checks).toEqual(expect.arrayContaining([
        { code: 'DIRECT_EXTERNAL_URL_FORWARDING_ABSENT', passed: false },
        { code: 'PLAINTEXT_CREDENTIAL_WRITER_ABSENT', passed: false },
        { code: 'SQLITE_VERBOSE_LOGGING_ABSENT', passed: false },
      ]));
      expect(JSON.stringify(evidence)).not.toContain('never-copy-this-secret');
      expect(validatePackageSecurityEvidence(evidence).passed).toBe(false);
      expect(validatePackageSecurityEvidence({ ...evidence, username: 'operator@example.com' }).violations)
        .toContain('unexpected top-level evidence fields');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when packaged navigation wiring omits the secure window-open handler', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'package-security-window-open-'));
    try {
      const files = writeFixtureSources(dir);
      const source = fs.readFileSync(files.mainBundlePath, 'utf8');
      fs.writeFileSync(
        files.mainBundlePath,
        source.replace("mainWindow.webContents.setWindowOpenHandler(createSecureWindowOpenHandler({}));\n", ''),
        'utf8',
      );
      const evidence = collectPackageSecurityBoundaries({
        ...files,
        packageHashes: { exeSha256: HASH_A, appContentSha256: HASH_B },
        expectedExeSha256: HASH_A,
        expectedAppContentSha256: HASH_B,
      });

      expect(evidence.passed).toBe(false);
      expect(evidence.checks).toContainEqual({ code: 'NAVIGATION_GUARDS_WIRED', passed: false });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
