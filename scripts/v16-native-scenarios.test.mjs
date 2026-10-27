import { afterEach, describe, expect, it } from 'vitest';
import adapters from './v16-native-scenario-adapters.js';
import business from './v16-native-business-adapters.js';
import packages from './v16-native-package-adapters.js';
import canaries from './v16-native-canary-independence.js';
import sampler from './v16-performance-sampler.js';
import native from './v16-native-evidence.js';
import { nativeFixture } from './v16-native-test-fixture.mjs';
import protocol from './v16-performance-protocol.test-support.cjs';
const fixtures = [];
afterEach(() => fixtures.splice(0).forEach(f => f.cleanup()));
function fixture() {
  const f = nativeFixture(); fixtures.push(f);
  const environment = { os: 'win32', cpu: 'fixture-only', memoryBytes: 16_000_000_000 };
  const approval = f.write('budget-approval.txt', '仅用于校验器分支测试的批准夹具');
  const metrics = adapters.PERFORMANCE_METRICS.flatMap(metric => ['typical', 'maximum'].flatMap(fixture => (['store-switch', 'home-projection', 'module-projection'].includes(metric) ? [50, 95] : [95]).map(percentile => ({ metric, fixture, percentile, unit: 'fixture-unit', window: 'current-run', threshold: 10, sampleCount: 3 }))));
  const budget = { kind: 'v16-nfr-budget', schemaVersion: 1, status: 'approved', revision: 1, owner: 'fixture-engineer', approval: { approver: 'fixture-approver', approvedAt: f.execution.startedAt, artifact: approval }, environment, metrics };
  const baseline = { kind: 'v16-nfr-baseline', schemaVersion: 1, status: 'measured', environment, sourceSha256: f.identity.sourceSha256, packageIdentity: f.current.packageIdentity };
  const raw = { kind: 'v16-performance-budget', schemaVersion: 1, environment, packageIdentity: f.current.packageIdentity, budget: f.json('budget.json', budget), baseline: f.json('baseline.json', baseline), measurements: metrics.map(metric => ({ ...metric, observed: 5, samples: f.json(`samples/${metric.metric}-${metric.fixture}.json`, { kind: 'v16-nfr-samples', runId: 'fixture-run', metric: metric.metric, fixture: metric.fixture, environment, packageIdentity: f.current.packageIdentity, samples: [1, 2, 3].map(() => ({ value: 5, pid: 123, observedAt: f.execution.startedAt })) }) })) };
  const context = { root: f.root, current: f.current, identity: f.identity, execution: f.execution };
  baseline.measurements = raw.measurements;
  raw.baseline = f.json('baseline.json', baseline);
  budget.baselineSha256 = raw.baseline.sha256;
  raw.budget = f.json('budget.json', budget);
  protocol.completeLegacyPerformanceFixture({ root: f.root, raw, baseline, budget, context, json: f.json, packageHashes: f.identity.packageHashes });
  return { ...f, raw, budget, baseline, context, verify: () => adapters.verifyPerformance(raw, { runId: 'fixture-run' }, context) };
}
describe('性能预算原件重算', () => {
  it('只在批准预算、环境、典型最大夹具及原始样本全部匹配时接受', () => { expect(fixture().verify()).toBe(true); });
  it('不将当前观测数值自动当批准阈值', () => {
    const f = fixture(); f.budget.status = 'pending'; f.raw.budget = f.json('budget.json', f.budget);
    expect(() => f.verify()).toThrow(/NOT_APPROVED/);
  });
  it('拒绝遗漏典型或最大支持规模', () => {
    const f = fixture(); f.raw.measurements = f.raw.measurements.filter(x => x.fixture !== 'maximum');
    expect(() => f.verify()).toThrow(/REQUIRED_METRIC_MISSING/);
  });
  it('从样本重新计算P95而非信任汇总值', () => {
    const f = fixture(); f.raw.measurements[0].observed = 1;
    expect(() => f.verify()).toThrow(/APPROVED_BUDGET_EXCEEDED/);
  });
  it('环境或当前包变化时拒绝复用旧baseline', () => {
    const f = fixture(); f.baseline.environment = { os: 'other' }; f.raw.baseline = f.json('baseline.json', f.baseline);
    expect(() => f.verify()).toThrow(/BASELINE_OR_ENVIRONMENT_MISMATCH/);
  });
  it('实际collector的合法正式报告形态保留批准典型最大性能通路且不产生APP_READY', () => {
    const f = fixture();
    f.raw.fixtureClassifications = structuredClone(f.baseline.fixtureClassifications);
    f.raw.verification = sampler.captureVerification(f.budget.metrics, f.raw.measurements, [], 'measure', f.raw.fixtureClassifications);
    expect(f.raw.verification.formalAcceptanceEvidence).toBeUndefined();
    expect(f.raw.verification.appReady).toBe(false);
    expect(f.verify()).toBe(true);
    f.raw.verification = sampler.captureVerification(f.budget.metrics, f.raw.measurements, [], 'software', f.raw.fixtureClassifications);
    expect(f.raw.verification.formalAcceptanceEvidence).toBe(false);
    expect(() => f.verify()).toThrow('PERFORMANCE_SOFTWARE_EVIDENCE_NOT_FORMAL');
    const isolated = f.raw.fixtureClassifications.map(row => ({ ...row, classification: 'isolated-software-fixture' }));
    f.raw.verification = sampler.captureVerification(f.budget.metrics, f.raw.measurements, [], 'measure', isolated);
    expect(f.raw.verification.formalAcceptanceEvidence).toBe(false);
    expect(() => f.verify()).toThrow('PERFORMANCE_SOFTWARE_EVIDENCE_NOT_FORMAL');
  });
  it.each([
    ['顶层软件标记', value => { value.formalAcceptanceEvidence = false; }],
    ['验证层软件标记', value => { value.verification = { formalAcceptanceEvidence: false }; }],
    ['直接隔离分类', value => { value.classification = 'isolated-software-fixture'; }],
    ['典型隔离分类', value => { value.fixtureClassifications = [{ fixture: 'typical', classification: 'isolated-software-fixture' }]; }],
    ['最大隔离分类', value => { value.fixtures = [{ fixture: 'maximum', classification: 'isolated-software-fixture' }]; }],
  ])('正式性能报告拒绝%s', (_name, mark) => {
    const f = fixture(); mark(f.raw);
    expect(() => f.verify()).toThrow('PERFORMANCE_SOFTWARE_EVIDENCE_NOT_FORMAL');
  });
  it.each([
    ['非空错误列表', value => { value.issues = [{ metric: 'module-projection', code: 'FAILED_ENTRY' }]; }],
    ['采集未完成', value => { value.collectionComplete = false; }],
    ['软件分组未完成', value => { value.verification = { software: { status: 'INCOMPLETE' } }; }],
    ['AI分组未完成', value => { value.verification = { externalAi: { status: 'INCOMPLETE' } }; }],
  ])('样本齐全仍拒绝显式%s', (_name, mark) => {
    const f = fixture(); expect(f.verify()).toBe(true); mark(f.raw);
    expect(() => f.verify()).toThrow('PERFORMANCE_CAPTURE_INCOMPLETE');
  });
  it('实际collector保留失败入口时不能用其他模块的齐全样本遮盖', () => {
    const f = fixture(), issues = [{ metric: 'module-projection', fixture: 'maximum', sample: '2-objects-targets', code: 'FAILED_ENTRY' }];
    const datasets = ['typical', 'maximum'].map(fixture => ({ fixture, classification: 'real-data-copy' }));
    expect(f.raw.measurements).toHaveLength(f.budget.metrics.length);
    f.raw.verification = sampler.captureVerification(f.budget.metrics, f.raw.measurements, issues, 'measure', datasets);
    expect(f.raw.verification.software).toMatchObject({ status: 'INCOMPLETE', missing: [] });
    expect(() => f.verify()).toThrow('PERFORMANCE_CAPTURE_INCOMPLETE');
    f.raw.verification = sampler.captureVerification(f.budget.metrics, f.raw.measurements, [], 'measure', datasets);
    f.raw.collectionComplete = true; f.raw.issues = [];
    expect(f.verify()).toBe(true);
  });
  it('正式报告不能引用被标为软件验证的baseline或样本', () => {
    const f = fixture(); f.baseline.verification = { formalAcceptanceEvidence: false };
    f.raw.baseline = f.json('software-baseline.json', f.baseline); f.budget.baselineSha256 = f.raw.baseline.sha256;
    f.raw.budget = f.json('budget.json', f.budget);
    expect(() => f.verify()).toThrow('PERFORMANCE_SOFTWARE_EVIDENCE_NOT_FORMAL');
    delete f.baseline.verification;
    const target = f.raw.measurements[0];
    const sample = { kind: 'v16-nfr-samples', runId: 'fixture-run', metric: target.metric, fixture: target.fixture,
      environment: f.raw.environment, packageIdentity: f.current.packageIdentity, formalAcceptanceEvidence: false,
      samples: [1,2,3].map(() => ({ value: 5, pid: 123, observedAt: f.execution.startedAt })) };
    target.samples = f.json('software-sample.json', sample);
    f.raw.baseline = f.json('baseline.json', f.baseline); f.budget.baselineSha256 = f.raw.baseline.sha256;
    f.raw.budget = f.json('budget.json', f.budget);
    expect(() => f.verify()).toThrow('PERFORMANCE_SOFTWARE_EVIDENCE_NOT_FORMAL');
  });
  it('采集器顶层finishedAt与execution完成时间一致且能进入严格原生时间入口', () => {
    const f = fixture(); Object.assign(f.raw, sampler.captureExecution(f.execution.startedAt, f.execution.finishedAt));
    expect(f.raw.finishedAt).toBe(f.raw.execution.finishedAt);
    const testId = 'V16-T-L7-REAL-EXECUTION', requiredChecks = Object.keys(native.CHECK_ADAPTERS[testId]);
    const packet = { schemaVersion: 'v16.native-checks/1', runId: 'fixture-run', testId, sourceSha256: f.identity.sourceSha256,
      success: true, nativeArtifacts: [{ id: 'performance', adapter: 'performance-budget', runId: 'fixture-run', ...f.json('performance.json', f.raw) }],
      checks: requiredChecks.map(id => ({ id, passed: true, nativeArtifactIds: id === 'performance-budget' ? ['performance'] : [] })) };
    const test = { testId, layer: 'L7', requiredChecks };
    const verify = () => native.verifyNativeEvidence(packet, test, f.identity, f.root, f.execution);
    expect(verify().passed).toBe(1);
    expect(verify().issues.some(issue => issue.startsWith('performance-budget:'))).toBe(false);
    delete f.raw.finishedAt;
    Object.assign(packet.nativeArtifacts[0], f.json('performance.json', f.raw));
    expect(verify().issues).toContain('performance-budget:NATIVE_TIME_OUTSIDE_EXECUTION:performance');
  });
});
describe('业务适配器拒绝自述摘要', () => {
  it.each([
    ['L4 UI', packages.verifyPackageUi], ['L6 连续运行', business.verifyContinuous],
    ['L7 人工策略执行', business.verifyCanary], ['L7 UNKNOWN对账', business.verifyReconciliation], ['L7 AI费用', business.verifyAiBudget],
  ])('%s缺原件不因passed=true而放行', (_name, verify) => {
    expect(() => verify({ passed: true, success: true }, {}, { load() { throw new Error('NATIVE_ORIGINAL_MISSING'); } })).toThrow();
  });
});
describe('已验证canary的双模式独立性', () => {
  const reports = () => ['manual_approval', 'policy_auto'].map(mode => ({ kind: 'mission-control-execution-canary-evidence', mode,
    authority: Object.fromEntries(canaries.INDEPENDENT_AUTHORITY_FIELDS.map(key => [key, mode + ':' + key])),
    execution: { evidence: ['before', 'after', 'reload'].map(slot => ({ slot, id: mode + ':' + slot, artifactRef: mode + ':ref:' + slot })) } }));
  const proofs = values => new Map(values.map((report, index) => [report, { ok: true, canaryBinding: { submitIntentId: report.mode + ':intent' },
    verifiedPngArtifacts: report.execution.evidence.map((record, slot) => ({ slot: record.slot, filePath: `${process.cwd()}/fixture/${report.mode}/${record.slot}.png`,
      sha256: String(index * 3 + slot + 1).repeat(64), fileIdentity: { dev: '1', ino: String(index * 3 + slot + 100) } })) } ]));
  it('仅允许六类授权对象全部不同的独立人工和策略结果', () => { const values = reports(); expect(canaries.verifyCanaryIndependence(values, proofs(values))).toBe(true); });
  it.each(canaries.INDEPENDENT_AUTHORITY_FIELDS)('拒绝人工与策略复用%s', field => {
    const values = reports(); values[1].authority[field] = values[0].authority[field];
    expect(() => canaries.verifyCanaryIndependence(values)).toThrow('CANARIES_NOT_INDEPENDENT:' + field);
  });
  it('缺少任一模式或复用同模式结果时拒绝', () => {
    expect(() => canaries.verifyCanaryIndependence(reports().slice(0, 1))).toThrow(/MODES_REQUIRED/);
    const values = reports(); values[1].mode = 'manual_approval';
    expect(() => canaries.verifyCanaryIndependence(values)).toThrow(/MODES_REQUIRED/);
  });
  it('提交意图必须来自严格DB核验结果且两模式各自独立', () => {
    const values = reports(); expect(() => canaries.verifyCanaryIndependence(values)).toThrow('VERIFIED_CANARY_DATABASE_PROOFS_REQUIRED');
    const verified = proofs(values); verified.get(values[1]).canaryBinding.submitIntentId = verified.get(values[0]).canaryBinding.submitIntentId;
    expect(() => canaries.verifyCanaryIndependence(values, verified)).toThrow('CANARIES_NOT_INDEPENDENT:submitIntentId');
  });
  it.each(['before', 'after', 'reload'])('两模式不得共享%s证据ID或不透明引用', slot => {
    const values = reports(), verified = proofs(values);
    values[1].execution.evidence.find(record => record.slot === slot).id = values[0].execution.evidence.find(record => record.slot === slot).id;
    expect(() => canaries.verifyCanaryIndependence(values, verified)).toThrow('CANARIES_SHARE_EXECUTION_ORIGINAL:evidenceId');
    values[1].execution.evidence.find(record => record.slot === slot).id += '-unique';
    values[1].execution.evidence.find(record => record.slot === slot).artifactRef = values[0].execution.evidence.find(record => record.slot === slot).artifactRef;
    expect(() => canaries.verifyCanaryIndependence(values, verified)).toThrow('CANARIES_SHARE_EXECUTION_ORIGINAL:artifactRef');
  });
  it.each(['filePath', 'sha256', 'fileIdentity'])('两模式不得共享三段原件的%s', key => {
    const values = reports(), verified = proofs(values);
    verified.get(values[1]).verifiedPngArtifacts[2][key] = verified.get(values[0]).verifiedPngArtifacts[0][key];
    expect(() => canaries.verifyCanaryIndependence(values, verified)).toThrow('CANARIES_SHARE_EXECUTION_ORIGINAL:' + ({ filePath: 'artifactPath', sha256: 'contentSha256', fileIdentity: 'fileIdentity' })[key]);
  });
});
