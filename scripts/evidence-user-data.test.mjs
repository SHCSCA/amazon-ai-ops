import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import userDataModule from './evidence-user-data.js';
import { validateEvidenceUserDataPath as validateMainPath } from '../apps/desktop/src/main/evidence-user-data-path';

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
    'G:\\Temp\\amazon-ai-ops-maintenance\\run-1',
  ])('accepts an explicit scoped local-drive path: %s', (candidate) => {
    expect(validateEvidenceUserDataPath(candidate, { requireExisting: false })).toBe(candidate);
  });

  it.each([
    'F:\\Temp\\amazon-ai-ops-runtime\\run-1',
    'G:\\Temp\\amazon-ai-ops\\run-1',
    'G:\\Temp\\other\\run-1',
    'G:\\Temp\\amazon-ai-ops\\..\\other',
    'G:Temp\\amazon-ai-ops',
    'G:\\Temp\\amazon-ai-ops:stream',
    '\\\\?\\G:\\Temp\\amazon-ai-ops',
    'G:\\Temp\\amazon-ai-ops\0',
    ' G:\\Temp\\amazon-ai-ops',
  ])('keeps Main and runner path admission identical: %s', (candidate) => {
    const io = {
      existsSync: () => true, isDirectory: () => true,
      realpathSync: (value) => value, writeFileSync: () => {},
    };
    const observe = (work) => {
      try { return { value: work() }; } catch (error) { return { error: error.message }; }
    };
    expect(observe(() => validateMainPath(candidate, io))).toEqual(
      observe(() => validateEvidenceUserDataPath(candidate, { requireExisting: false })),
    );
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

  it('reads the structured identity record and ignores malformed or unrelated records', () => {
    const identity = { mode: PACKAGE_LAUNCH_SMOKE_MODE, overridden: true, userDataDir: 'D:\\Temp\\amazon-ai-ops-launch\\run-1' };
    const output = ['noise', '{broken', JSON.stringify({ event: 'other', context: { identity } }),
      JSON.stringify({ event: 'app.evidence_user_data', context: { identity: { ...identity, overridden: 'yes' } } }),
      JSON.stringify({ timestamp: '2026-10-15T00:00:00.000Z', level: 'info', event: 'app.evidence_user_data', context: { identity } }),
    ].join('\n');
    expect(parseEvidenceUserDataLog(output)).toEqual(identity);
  });

  it('keeps main and runner environment variable names identical', () => {
    const mainSource = readFileSync('apps/desktop/src/main/evidence-user-data-path.ts', 'utf8').replace(/\r\n/g, '\n');
    const indexSource = readFileSync('apps/desktop/src/main/index.ts', 'utf8').replace(/\r\n/g, '\n');
    const runtimeContextSource = readFileSync('apps/desktop/src/main/main-runtime-context.ts', 'utf8').replace(/\r\n/g, '\n');
    const browserSessionSource = readFileSync('apps/desktop/src/main/main-browser-session-runtime.ts', 'utf8').replace(/\r\n/g, '\n');
    const bootstrapSource = readFileSync('apps/desktop/src/main/desktop-bootstrap.ts', 'utf8');
    const configurationSource = readFileSync('apps/desktop/src/main/bootstrap-configuration.ts', 'utf8').replace(/\r\n/g, '\n');
    expect(mainSource).toContain(`EVIDENCE_MODE_ENV = '${EVIDENCE_MODE_ENV}'`);
    expect(mainSource).toContain(`EVIDENCE_USER_DATA_DIR_ENV = '${EVIDENCE_USER_DATA_DIR_ENV}'`);
    expect(mainSource).toContain(
      `PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV =\n  '${PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV}'`,
    );
    const configurePath = bootstrapSource.indexOf('dependencies.configureEvidencePath(electronApp, environment)');
    expect(bootstrapSource).toContain('configureEvidencePath: configureEvidenceUserDataPath');
    expect(configurePath).toBeGreaterThan(-1);
    expect(configurePath).toBeLessThan(bootstrapSource.indexOf("electronApp.getPath('userData')"));
    expect(configurationSource).toContain('packageUiReadOnly = input.evidenceIdentity.mode === PACKAGE_UI_EVIDENCE_MODE');
    expect(configurationSource).toContain(
      "packageUiFreshTypedProofRequired: packageUiReadOnly\n      && input.environment[PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV] === '1'",
    );
    expect(indexSource).toContain('installMainRuntimeContext(createMainRuntimeContext(__filename))');
    expect(runtimeContextSource).toContain('packageUiFreshTypedProofRequired = bootstrapConfiguration.packageUiFreshTypedProofRequired');
    expect(runtimeContextSource).toContain('packageUiReadOnlyRuntime = bootstrapConfiguration.packageUiReadOnly');
    expect(browserSessionSource).toContain('freshTypedProofRequired: mainRuntimeContext.packageUiFreshTypedProofRequired');
    expect(browserSessionSource).toContain('packageUiEvidenceMode: mainRuntimeContext.packageUiReadOnlyRuntime');
  });

  it('recognizes the main-process source contract that must survive into the packaged bundle', () => {
    expect(inspectPackagedUserDataOverrideContract(
      'apps/desktop/src/main/evidence-user-data-path.ts',
    )).toEqual(expect.objectContaining({ passed: true, violations: [] }));
  });
});
