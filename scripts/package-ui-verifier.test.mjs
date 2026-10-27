import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { withValidAppContent } from './package-ui-test-fixtures.mjs';
import { validAuthorityBinding, validCheckpointComposition, validLogicalArtifact, validProfileLockIsolation, USER_DATA_DIR } from './package-ui-test-context.mjs';
import { validRun, validWideRun, validProcessIsolation } from './package-ui-test-fixtures.mjs';
import original from './package-ui-evidence.js';
import { createPackageUiVerificationContract } from './package-ui-verifier.js';

const require = createRequire(import.meta.url);
const metadata = require('../apps/desktop/package.json');
function contract(overrides = {}) {
  return createPackageUiVerificationContract({
    sourceRoot: 'F:\\Temp\\amazon-ai-ops-no-source-tree', desktopPackage: metadata,
    runnerContract: original.buildPackageUiRunnerContract(), ...overrides,
  });
}

function completeEvidence() {
  const runner = original.buildPackageUiRunnerContract();
  const runs = original.EXPECTED_PACKAGE_UI_SCALES.map(validRun), wideProfile = validWideRun();
  const runGroupId = 'package-ui-test-run-group', invocationId = 'package-ui-test-invocation';
  const authorityBinding = validAuthorityBinding();
  const checkpointComposition = validCheckpointComposition(runGroupId, runner.sha256, [...runs, wideProfile]);
  return {
    artifactHashesStable: true, authority: { binding: authorityBinding }, checkpointComposition, failure: null,
    invocation: { attemptReceipts: [], invocationId, lease: { generation: 'package-ui-test-generation', payloadSha256: 'A'.repeat(64) } },
    schemaVersion: 9, interactiveLoginContract: original.INTERACTIVE_LOGIN_CONTRACT,
    isolatedProfileBootstrapContract: original.ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
    packageProcessIsolation: validProcessIsolation(), profileLockIsolation: validProfileLockIsolation('run-group', invocationId),
    profileDatabaseFileIsolation: { passed: true }, profileDatabaseProvenance: { passed: true }, profileProcessIsolation: validProcessIsolation(),
    profileLineage: { final: structuredClone(checkpointComposition.finalProfileState), passed: true }, protectedDatabase: { passed: true },
    protectedDatabaseLogical: { after: validLogicalArtifact(), before: validLogicalArtifact(), passed: true },
    requested: { allowInteractiveLogin: true, allowSavedLogin: false, interactiveLoginMaximumTotalMs: 1_200_000, interactiveLoginTimeoutMs: 600_000, loginMode: 'interactive-operator-each-run', resumeRunGroupId: null, runGroupId, userDataDir: USER_DATA_DIR },
    runGroup: { authorityBinding, invocationId, profileSequence: original.PACKAGE_UI_PROFILE_SEQUENCE, runGroupId, runnerContractSha256: runner.sha256 },
    runs, wideProfile,
  };
}

describe('packaged Package UI verification composition', () => {
  it('hashes current app content identically without the development metadata directory', () => {
    const portable = contract();
    withValidAppContent(root => expect(portable.buildAppContentManifest(root)).toEqual(original.buildAppContentManifest(root)));
  });

  it('retains every schema v9 completeness check in the read-only composition', () => {
    const evidence = completeEvidence(), portable = contract();
    expect(original.evaluatePackageUiEvidenceCompleteness(evidence)).toEqual({ passed: true, violations: [] });
    expect(portable.evaluatePackageUiEvidenceCompleteness(evidence)).toEqual({ passed: true, violations: [] });
    for (const key of ['profileLineage', 'profileLockIsolation', 'checkpointComposition', 'authority', 'wideProfile']) {
      const invalid = structuredClone(evidence);
      delete invalid[key];
      expect(portable.evaluatePackageUiEvidenceCompleteness(invalid)).toEqual(original.evaluatePackageUiEvidenceCompleteness(invalid));
      expect(portable.evaluatePackageUiEvidenceCompleteness(invalid).passed).toBe(false);
    }
  });

  it('rejects substituted frozen runner semantics and source identities', () => {
    const runner = original.buildPackageUiRunnerContract();
    for (const key of ['evidenceScript', 'protectedSqliteTempScript']) {
      const changed = structuredClone(runner);
      changed[key].sha256 = 'F'.repeat(64);
      expect(() => contract({ runnerContract: changed })).toThrow('FROZEN_PACKAGE_UI_RUNNER_CONTRACT_INVALID');
    }
    expect(() => contract({ runnerContract: null })).toThrow('FROZEN_PACKAGE_UI_CONTRACT_REQUIRED');
  });

  it('exports only verification operations and the fixed intent matrix', () => {
    const portable = contract();
    expect(portable.EXPECTED_PACKAGE_UI_ENTRIES).toHaveLength(22);
    expect(portable.runPackageUiEvidence).toBeUndefined();
    expect(portable.ensureAuthenticatedWorkspace).toBeUndefined();
    expect(portable.validatePackageUiReadOnlyRuntimeEvidence({})).toEqual(original.validatePackageUiReadOnlyRuntimeEvidence({}));
  });
});
