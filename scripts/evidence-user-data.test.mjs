import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import userDataModule from './evidence-user-data.js';

const {
  EVIDENCE_MODE_ENV,
  EVIDENCE_USER_DATA_DIR_ENV,
  PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV,
  PACKAGE_LAUNCH_SMOKE_MODE,
  PACKAGE_UI_EVIDENCE_MODE,
  inspectPackagedUserDataOverrideContract,
  parseEvidenceUserDataLog,
  validateEvidenceUserDataIdentity,
  validateEvidenceUserDataPath,
} = userDataModule;

describe('packaged evidence userData script contract', () => {
  it.each([
    'D:\\Temp\\amazon-ai-ops-package-ui\\profile-copy',
    'D:\\Temp\\amazon-ai-ops\\package-launch-smoke\\unpacked',
  ])('accepts an explicit scoped D-drive path: %s', (candidate) => {
    expect(validateEvidenceUserDataPath(candidate, { requireExisting: false })).toBe(candidate);
  });

  it.each([
    'C:\\Users\\wz\\AppData\\Roaming\\@amazon-ai-ops\\desktop',
    'D:\\outside\\amazon-ai-ops-package-ui',
    'D:\\Temp\\package-ui',
    '\\\\server\\share\\amazon-ai-ops-package-ui',
    'relative-profile',
  ])('rejects unsafe or unscoped path: %s', (candidate) => {
    expect(() => validateEvidenceUserDataPath(candidate, { requireExisting: false })).toThrow();
  });

  it('requires the actual runtime identity to equal the expected isolated path and mode', () => {
    const expected = 'D:\\Temp\\amazon-ai-ops-package-ui\\profile-copy';
    expect(validateEvidenceUserDataIdentity({
      actualUserDataDir: expected,
      evidenceMode: PACKAGE_UI_EVIDENCE_MODE,
      expectedMode: PACKAGE_UI_EVIDENCE_MODE,
      expectedUserDataDir: expected,
    })).toEqual(expect.objectContaining({ passed: true, violations: [] }));

    const failed = validateEvidenceUserDataIdentity({
      actualUserDataDir: 'C:\\Users\\wz\\AppData\\Roaming\\@amazon-ai-ops\\desktop',
      evidenceMode: PACKAGE_UI_EVIDENCE_MODE,
      expectedMode: PACKAGE_UI_EVIDENCE_MODE,
      expectedUserDataDir: expected,
    });
    expect(failed.passed).toBe(false);
    expect(failed.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ACTUAL_USER_DATA_UNSAFE' }),
    ]));
  });

  it('parses the main-process runtime marker', () => {
    const userDataDir = 'D:\\Temp\\amazon-ai-ops-package-launch-smoke\\run-1';
    expect(parseEvidenceUserDataLog(`noise\n[App] evidence-user-data ${JSON.stringify({
      mode: PACKAGE_LAUNCH_SMOKE_MODE,
      overridden: true,
      userDataDir,
    })}\n`)).toEqual({ mode: PACKAGE_LAUNCH_SMOKE_MODE, overridden: true, userDataDir });
  });

  it('keeps main and runner environment variable names identical', () => {
    const mainSource = readFileSync('apps/desktop/src/main/evidence-user-data-path.ts', 'utf8');
    const indexSource = readFileSync('apps/desktop/src/main/index.ts', 'utf8');
    expect(mainSource).toContain(`EVIDENCE_MODE_ENV = '${EVIDENCE_MODE_ENV}'`);
    expect(mainSource).toContain(`EVIDENCE_USER_DATA_DIR_ENV = '${EVIDENCE_USER_DATA_DIR_ENV}'`);
    expect(mainSource).toContain(
      `PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV =\n  '${PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV}'`,
    );
    expect(indexSource.indexOf('configureEvidenceUserDataPath(app);')).toBeGreaterThan(-1);
    expect(indexSource.indexOf('configureEvidenceUserDataPath(app);')).toBeLessThan(indexSource.indexOf("app.getPath('userData')"));
    expect(indexSource).toContain(
      "packageUiFreshTypedProofRequired = packageUiReadOnlyRuntime\n  && process.env[PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV] === '1'",
    );
    expect(indexSource).toContain('freshTypedProofRequired: packageUiFreshTypedProofRequired');
    expect(indexSource).toContain('packageUiEvidenceMode: packageUiReadOnlyRuntime');
  });

  it('recognizes the main-process source contract that must survive into the packaged bundle', () => {
    expect(inspectPackagedUserDataOverrideContract(
      'apps/desktop/src/main/evidence-user-data-path.ts',
    )).toEqual(expect.objectContaining({ passed: true, violations: [] }));
  });
});
