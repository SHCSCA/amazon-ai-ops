import {
  createFixture,
  describe,
  expect,
  fs,
  hash,
  inspectFixture,
  inspector,
  it,
  path,
  writeEnvelope,
} from './inspect-package-ui-test-fixtures.mjs';

describe('package UI inspector composed source identity', () => {
  it('rejects a self-consistent run group that binds only the compatibility entry bytes', () => {
    const fixture = createFixture();
    const bytes = fs.readFileSync(path.resolve('scripts/package-ui-evidence.js'));
    const binding = {
      evidenceScript: { sha256: hash(bytes), sizeBytes: bytes.length },
      protectedSqliteTempScript: fixture.contract.protectedSqliteTempScript,
      semanticContractSha256: fixture.contract.semanticContractSha256,
    };
    fixture.contract = {
      ...binding,
      sha256: hash(Buffer.from(inspector.canonicalJson(binding))),
    };
    fixture.metadata.runnerContract = fixture.contract;
    fixture.metadata.runnerContractSha256 = fixture.contract.sha256;
    writeEnvelope(path.join(fixture.groupRoot, 'run-group.json'), fixture.metadata);
    const result = inspectFixture(fixture);
    expect(result.status).toBe('LINEAGE_CHANGED');
    expect(result.violations.map((item) => item.code)).toContain('RUNNER_LINEAGE_DRIFT');
    expect(result.resume).toBeUndefined();
  });

  it('uses stable module reads for both source snapshots and retains the final runner recollection', () => {
    const source = fs.readFileSync('scripts/inspect-package-ui-inspection.js', 'utf8');
    const before = source.indexOf('const runnerBefore = collectPackageUiRunnerSourceBinding');
    const after = source.indexOf('const runnerAfter = collectPackageUiRunnerSourceBinding');
    const finalFacts = source.indexOf('const finalFacts = getRunnerFacts', after);
    expect(before).toBeGreaterThan(-1);
    expect(after).toBeGreaterThan(before);
    expect(finalFacts).toBeGreaterThan(after);
    expect(source.match(/safeFileArtifact\(filePath, 'Package UI runner module', 'RUNNER_LINEAGE_INVALID'\)/g)).toHaveLength(2);
    expect(source).toContain('runnerBefore.sha256 !== runnerAfter.sha256');
    expect(source).not.toContain("safeFileArtifact(runnerPath, 'Package UI runner'");
  });
});
