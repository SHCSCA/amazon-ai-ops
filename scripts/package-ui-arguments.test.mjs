import {
  AUTHORITY_SELECTION_PATH,
  HASH_A,
  HASH_B,
  PROTECTED_DB_PATH,
  USER_DATA_DIR,
  assertPackageUiRuntimeLoginBoundary,
  describe,
  expect,
  it,
  parsePackageUiEvidenceArgs,
  path,
  readFileSync,
  runPackageUiEvidenceCli,
  spawnSync,
} from './package-ui-test-context.mjs';

describe('package UI evidence CLI contract', () => {
  it('reasserts the schema-v9 secret-blind login boundary for direct runtime callers', () => {
    expect(assertPackageUiRuntimeLoginBoundary({
      allowInteractiveLogin: true,
      allowSavedLogin: false,
    })).toBe(true);
    expect(() => assertPackageUiRuntimeLoginBoundary({
      allowInteractiveLogin: false,
      allowSavedLogin: true,
    })).toThrow(/saved-login automation is forbidden/i);
    const source = readFileSync('scripts/package-ui-orchestration.js', 'utf8');
    const runtimeStart = source.indexOf('async function runPackageUiEvidence(options, dependencies = {})');
    const runtimeBody = source.slice(
      runtimeStart,
      source.indexOf('const runGroupId = packageUiRunGroupId(options)', runtimeStart),
    );
    expect(runtimeBody).toContain('assertPackageUiRuntimeLoginBoundary(options)');
    const profileSource = readFileSync('scripts/package-ui-profile-run.js', 'utf8');
    expect(profileSource.match(/\[PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV\]: options\.requireFreshTypedProof \? '1' : '0'/g))
      .toHaveLength(2);
  });

  it('requires immutable EXE and unpacked app-content hashes and keeps both paths fixed to win-unpacked', () => {
    expect(() => parsePackageUiEvidenceArgs([])).toThrow(/--expected-exe-sha256/);
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
    ])).toThrow(/--expected-app-content-sha256/);
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', 'not-a-hash',
      '--expected-app-content-sha256', HASH_B,
    ])).toThrow(/64-character SHA-256/);

    const parsed = parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A.toLowerCase(),
      '--expected-app-content-sha256', HASH_B.toLowerCase(),
      '--allow-interactive-login',
      '--user-data-dir', USER_DATA_DIR,
      '--protected-db', PROTECTED_DB_PATH,
      '--authority-selection', AUTHORITY_SELECTION_PATH,
      '--run-group', 'operator-run-001',
      '--output', 'output/custom-package-ui',
      '--settle-ms', '900',
    ]);

    expect(parsed.expectedExeSha256).toBe(HASH_A);
    expect(parsed.expectedAppContentSha256).toBe(HASH_B);
    expect(parsed.allowInteractiveLogin).toBe(true);
    expect(parsed.allowSavedLogin).toBe(false);
    expect(parsed.outputDir).toBe('output/custom-package-ui');
    expect(parsed.settleMs).toBe(900);
    expect(parsed.userDataDir).toBe(USER_DATA_DIR);
    expect(parsed.protectedDatabasePath).toBe(path.resolve(PROTECTED_DB_PATH));
    expect(parsed.authoritySelectionPath).toBe(path.resolve(AUTHORITY_SELECTION_PATH));
    expect(parsed.runGroupId).toBe('operator-run-001');
    expect(parsed.resumeRunGroupId).toBeNull();
    expect(parsed.executablePath).toBe(path.resolve('apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe'));
    expect(parsed.appContentPath).toBe(path.resolve('apps/desktop/release/win-unpacked/resources/app'));
  });

  it('requires a scoped explicit local-drive userData copy and rejects the real AppData profile', () => {
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
    ])).toThrow(/--user-data-dir is required/);
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--user-data-dir', 'C:\\Users\\wz\\AppData\\Roaming\\@amazon-ai-ops\\desktop',
    ])).toThrow(/must be a child of C:\\Temp/);
  });

  it('requires an explicit protected AppData database for durable before/after evidence', () => {
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--user-data-dir', USER_DATA_DIR,
    ])).toThrow(/--protected-db is required/);
  });

  it('exposes a root package command without a URL or preview escape hatch', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(packageJson.scripts['evidence:package-ui']).toBe('node scripts/run-package-ui-evidence.js');
    expect(() => parsePackageUiEvidenceArgs([
      '--expected-exe-sha256', HASH_A,
      '--expected-app-content-sha256', HASH_B,
      '--url', 'http://127.0.0.1:4174/?preview=1',
    ])).toThrow(/Unknown argument: --url/);
  });

  it('prints help without launching Electron or requiring package hashes', () => {
    const result = spawnSync(process.execPath, ['scripts/run-package-ui-evidence.js', '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('real packaged Electron application');
    expect(result.stdout).toContain('all ten canonical Mission Control workspaces');
    expect(result.stdout).toContain('50,000-row production');
    expect(result.stdout).toContain('virtualizer contract');
    expect(result.stdout).toContain('--expected-app-content-sha256');
    expect(result.stdout).toContain('--print-package-hashes');
    expect(result.stdout).toContain('--user-data-dir');
    expect(result.stdout).toContain('--protected-db');
    expect(result.stdout).toContain('--authority-selection');
    expect(result.stdout).toContain('--resume-inspection-receipt');
    expect(result.stdout).toContain('--resume-run-group');
    expect(result.stdout).toContain('fresh typed-and-saved identity proof');
    expect(result.stdout).not.toContain('--allow-saved-login');
    expect(result.stdout).toContain("app.setPath('userData')");
    expect(result.stdout).toContain('win-unpacked/resources/app');
    expect(result.stdout).toContain('accepts no');
  });

  it('prints fixed package hashes without launching the Electron evidence runtime', async () => {
    const output = [];
    let launches = 0;
    await runPackageUiEvidenceCli(['--print-package-hashes'], {
      collectFixedPackageHashes: () => ({
        appContentFileCount: 42,
        appContentPath: path.resolve('apps/desktop/release/win-unpacked/resources/app'),
        appContentSha256: HASH_B,
        executablePath: path.resolve('apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe'),
        exeSha256: HASH_A,
        kind: 'package-ui-hash-preflight',
      }),
      print: (value) => output.push(value),
      runPackageUiEvidence: async () => { launches += 1; },
    });

    expect(launches).toBe(0);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toEqual(expect.objectContaining({
      appContentSha256: HASH_B,
      exeSha256: HASH_A,
      kind: 'package-ui-hash-preflight',
    }));
  });

  it('rejects path overrides or other arguments in fixed hash-preflight mode', async () => {
    await expect(runPackageUiEvidenceCli([
      '--print-package-hashes',
      '--output',
      'output/alternate',
    ], {
      collectFixedPackageHashes: () => ({ exeSha256: HASH_A, appContentSha256: HASH_B }),
      print: () => undefined,
    })).rejects.toThrow(/cannot be combined.*path overrides/i);
  });
});


it('uses only the explicit NVDA executable option and leaves the existing default disabled', () => {
  const base = ['--expected-exe-sha256', HASH_A, '--expected-app-content-sha256', HASH_B,
    '--allow-interactive-login', '--user-data-dir', USER_DATA_DIR, '--protected-db', PROTECTED_DB_PATH,
    '--authority-selection', AUTHORITY_SELECTION_PATH];
  expect(parsePackageUiEvidenceArgs(base).screenReaderExecutablePath).toBeNull();
  const executable = path.resolve('D:/unit-screen-reader/nvda.exe');
  expect(parsePackageUiEvidenceArgs([...base, '--screen-reader-executable', executable]).screenReaderExecutablePath).toBe(executable);
  expect(() => parsePackageUiEvidenceArgs([...base, '--screen-reader-executable', 'nvda.exe'])).toThrow(/explicit absolute nvda.exe/);
  expect(() => assertPackageUiRuntimeLoginBoundary({ allowInteractiveLogin: true, allowSavedLogin: false,
    screenReaderExecutablePath: path.resolve('D:/unit-screen-reader/foreign.exe') })).toThrow(/explicit absolute nvda.exe/);
});
