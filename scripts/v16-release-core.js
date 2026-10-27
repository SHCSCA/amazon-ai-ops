const { LAYERS, verifyManifest, sha256 } = require('./verify-v16-required-test-manifest.js');
const { verifyTraceClosure } = require('./verify-v16-trace-closure.js');

const TITLES = ['单元与合同', '静态工程', '业务集成', '实包体验', '包体与安全', '正式数据与双店连续运行', '人工与策略独立真实执行'];

function evaluateReleaseCore(manifest, requirements, root = process.cwd(), trustedRuntime) {
  const verification = verifyManifest(manifest, root, undefined, trustedRuntime);
  const trace = verifyTraceClosure(requirements, manifest, root, verification, trustedRuntime);
  const gates = LAYERS.map((layer, index) => {
    const tests = verification.details.filter(test => test.layer === layer);
    return { layer, title: TITLES[index], passed: !verification.issues.length && tests.length > 0 && tests.every(test => test.success), tests };
  });
  return {
    schemaVersion: 'v16.release-core/1',
    identity: { ...verification.identity, packageHashes: manifest?.identity?.packageHashes ?? null },
    eligible: trace.success && gates.every(gate => gate.passed),
    gates, trace, issues: verification.issues,
  };
}

function releaseCoreFingerprint(core) {
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).filter(key => key !== 'diagnostics').sort().map(key => [key, stable(value[key])]));
  }
  return sha256(Buffer.from(JSON.stringify(stable(core))));
}

function readinessFromCore(core, publication) {
  const gates = [...core.gates, { layer: 'L8', title: '完整 MUST 追踪与交付', passed: core.eligible && publication.success, trace: core.trace, publication }];
  return { schemaVersion: 'v16.readiness/1', timestamp: new Date().toISOString(), identity: core.identity, overallStatus: gates.every(gate => gate.passed) ? 'APP_READY' : 'APP_NEEDS_WORK', gates, issues: [...core.issues, ...publication.issues] };
}

module.exports = { evaluateReleaseCore, releaseCoreFingerprint, readinessFromCore };
