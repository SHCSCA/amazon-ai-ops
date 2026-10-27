import fs from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryFixture, completeMemoryAdapterFixture } from './v16-performance-memory.test-support.mjs';

const require = createRequire(import.meta.url);
const memory = require('./v16-performance-memory.js');
const runtime = require('./v16-performance-runtime.js');
const contract = require('./v16-performance-contract.js');
const adapters = require('./v16-native-scenario-adapters.js');

const fixtures = [];
afterEach(() => fixtures.splice(0).forEach(fixture => fixture.cleanup()));
function fixture() { const value = memoryFixture(); fixtures.push(value); return value; }
function observed() {
  const identity = { pid: 100, creationTime: 1000, windows: [{ rendererPid: 101, creationTime: 1100 }] };
  const raw = { pid: 100, rendererPid: 101, metrics: [
    { pid: 100, type: 'Browser', creationTime: 1000, memory: { workingSetSize: 16 * 1024, peakWorkingSetSize: 512 * 1024 } },
    { pid: 101, type: 'Tab', creationTime: 1100, memory: { workingSetSize: 32 * 1024, peakWorkingSetSize: 256 * 1024 } },
  ] };
  return { raw, identity };
}

describe('真实原生内存峰值字段与进程身份', () => {
  it('使用原生历史峰值而不把低于峰值的当前工作集当结果', () => {
    const { raw, identity } = observed();
    expect(memory.selectNativeMemoryPeaks(raw, identity)).toMatchObject({ mainMiB: 512, rendererMiB: 256, pid: 100, rendererPid: 101 });
  });
  it('实际runtime桥回调读取Main和可见Renderer的原生峰值', async () => {
    const { raw, identity } = observed(), mainPid = process.pid, rendererPid = mainPid + 10000;
    identity.pid = mainPid; identity.windows[0].rendererPid = rendererPid;
    raw.pid = mainPid; raw.rendererPid = rendererPid; raw.metrics[0].pid = mainPid; raw.metrics[1].pid = rendererPid;
    let reads = 0;
    const value = await runtime.readNativeMemory({ identity, app: { evaluate: callback => callback({
      app: { getAppMetrics: () => { reads++; return raw.metrics; } },
      BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { getOSProcessId: () => rendererPid } }] },
    }) } });
    expect(reads).toBe(1); expect(value).toMatchObject({ mainMiB: 512, rendererMiB: 256, pid: mainPid, rendererPid });
    expect(value.raw.metrics[0].creationTime).toBe(identity.creationTime);
  });
  it.each([undefined, 0, -1, NaN, Infinity])('拒绝缺失或无效原生peak值 %s', peak => {
    const { raw, identity } = observed(); raw.metrics[0].memory.peakWorkingSetSize = peak;
    expect(() => memory.selectNativeMemoryPeaks(raw, identity)).toThrow('NFR_MEMORY_NATIVE_PEAK_UNAVAILABLE');
  });
  it('拒绝小于当前工作集的所谓历史峰值', () => {
    const { raw, identity } = observed(); raw.metrics[1].memory.peakWorkingSetSize = 1;
    expect(() => memory.selectNativeMemoryPeaks(raw, identity)).toThrow('NFR_MEMORY_NATIVE_PEAK_UNAVAILABLE');
  });
  it.each([
    ['Renderer PID变化', raw => { raw.rendererPid++; }],
    ['Main创建时间变化', raw => { raw.metrics[0].creationTime++; }],
    ['Renderer创建时间变化', raw => { raw.metrics[1].creationTime++; }],
    ['Main角色替换', raw => { raw.metrics[0].type = 'Tab'; }],
    ['Renderer角色替换', raw => { raw.metrics[1].type = 'Browser'; }],
  ])('拒绝%s', (_name, mutate) => {
    const { raw, identity } = observed(); mutate(raw);
    expect(() => memory.selectNativeMemoryPeaks(raw, identity)).toThrow('NFR_MEMORY_PROCESS_IDENTITY_CHANGED');
  });
  it('拒绝同PID重复metric及缺失进程身份', () => {
    const { raw, identity } = observed(); raw.metrics.push(structuredClone(raw.metrics[0]));
    expect(() => memory.selectNativeMemoryPeaks(raw, identity)).toThrow('NFR_MEMORY_PROCESS_METRIC_NOT_UNIQUE');
    delete identity.creationTime;
    expect(() => memory.selectNativeMemoryPeaks(raw, identity)).toThrow('NFR_MEMORY_PROCESS_IDENTITY_REQUIRED');
  });
});

describe('冷暖进程原件与峰值重新计算', () => {
  it('保留冷Main更高峰值并用冷进程PID标记样本', () => {
    const f = fixture(), proof = f.proof();
    expect(proof.aggregate.selected).toMatchObject({ phase: 'cold', value: 512, pid: 1000 });
    expect(memory.verifyMemoryPeakSample(proof.sample, 'main-memory', proof.expected, f.load)).toBe(512);
  });
  it('Renderer独立取暖进程更高峰值且不与Main求和', () => {
    const f = fixture(), proof = f.proof('renderer-memory');
    expect(proof.aggregate.selected).toMatchObject({ phase: 'warm', value: 256, pid: 1003 });
    expect(memory.verifyMemoryPeakSample(proof.sample, 'renderer-memory', proof.expected, f.load)).toBe(256);
  });
  it('缺少cold或warm原件时不产生完整峰值样本', () => {
    const f = fixture(), proof = f.proof();
    for (const observations of [proof.observations.slice(0, 1), proof.observations.slice(1), [...proof.observations].reverse()])
      expect(() => memory.createMemoryPeakSample('main-memory', observations, proof.expected, f.load)).toThrow('NFR_MEMORY_COLD_WARM_REQUIRED');
  });
  it('拒绝把旧after-sample截面receipt当峰值', () => {
    const f = fixture(), proof = f.proof();
    proof.sample.receipt = f.json('legacy', { kind: 'v16-nfr-memory-observation', mainMiB: 16, rendererMiB: 32,
      window: 'after-sample', raw: observed().raw });
    expect(() => memory.verifyMemoryPeakSample(proof.sample, 'main-memory', proof.expected, f.load)).toThrow('NFR_MEMORY_PEAK_SAMPLE_REQUIRED');
  });
  it.each([
    ['样本低截面值', sample => { sample.value = 16; }],
    ['Main样本误绑Renderer PID', sample => { sample.pid++; }],
    ['样本进程创建时间替换', sample => { sample.creationTime++; }],
    ['样本时间替换', sample => { sample.observedAt = '2020-01-01T00:00:00Z'; }],
  ])('拒绝%s', (_name, mutate) => {
    const f = fixture(), proof = f.proof(); mutate(proof.sample);
    expect(() => memory.verifyMemoryPeakSample(proof.sample, 'main-memory', proof.expected, f.load)).toThrow('NFR_MEMORY_PEAK_SAMPLE_CHANGED');
  });
  it('即使重写汇总hash仍从原始peak字段拒绝伪造低值', () => {
    const f = fixture(), proof = f.proof();
    proof.aggregate.selected.value = 16; proof.sample.value = 16;
    proof.sample.receipt = f.json('low-summary', proof.aggregate);
    expect(() => memory.verifyMemoryPeakSample(proof.sample, 'main-memory', proof.expected, f.load)).toThrow('NFR_MEMORY_PEAK_SAMPLE_CHANGED');
  });
  it('拒绝互换Main和Renderer汇总receipt', () => {
    const f = fixture(), main = f.proof(), renderer = f.proof('renderer-memory');
    main.sample.receipt = renderer.sample.receipt;
    expect(() => memory.verifyMemoryPeakSample(main.sample, 'main-memory', main.expected, f.load)).toThrow('NFR_MEMORY_PEAK_SAMPLE_REQUIRED');
  });
  it.each(['packageIdentity', 'sourceSha256', 'runId', 'fixture'])('拒绝%s与当前输入不匹配', key => {
    const f = fixture(), proof = f.proof(), changed = { ...proof.expected, [key]: key === 'packageIdentity' ? {} : 'other' };
    expect(() => memory.verifyMemoryPeakSample(proof.sample, 'main-memory', changed, f.load)).toThrow('NFR_MEMORY_PEAK_SAMPLE_REQUIRED');
  });
  it('原始launch或memory被换字节时保留hash读取失败', () => {
    const f = fixture(), proof = f.proof(); fs.appendFileSync(proof.observations[0].receipt.path, ' ');
    expect(() => memory.verifyMemoryPeakSample(proof.sample, 'main-memory', proof.expected, f.load)).toThrow('UNIT_ORIGINAL_CHANGED');
  });
  it('重复同一峰值原件不能冒充三个独立sample', () => {
    const f = fixture(), proof = f.proof();
    expect(() => memory.verifyMemoryPeakSamples([proof.sample, proof.sample, proof.sample], 'main-memory', proof.expected, f.load))
      .toThrow('NFR_MEMORY_INDEPENDENT_SAMPLES_REQUIRED');
    const first = f.proof('main-memory', { coldMain: 128, warmMain: 512 });
    const second = f.proof('main-memory', { sampleIndex: 1, coldMain: 128, warmMain: 512 });
    const lower = f.load(first.observations[0].receipt), launch = f.load(lower.launch);
    lower.sampleIndex = 1; launch.label = 'typical/1/cold';
    lower.launch = f.json('reused-lower-launch', launch);
    second.observations[0].receipt = f.json('reused-lower-observation', lower);
    const combined = memory.createMemoryPeakSample('main-memory', second.observations, second.expected, f.load);
    const sample = { ...combined.selected, receipt: f.json('reused-lower-peak', combined) };
    expect(first.sample.pid).not.toBe(sample.pid);
    expect(() => memory.verifyMemoryPeakSamples([first.sample, sample], 'main-memory', first.expected, f.load))
      .toThrow('NFR_MEMORY_INDEPENDENT_SAMPLES_REQUIRED');
  });
  it('正式校验拒绝隔离软件原件且不丢弃其分类', () => {
    const f = fixture(), proof = f.proof('main-memory', { classification: 'isolated-software-fixture' });
    expect(proof.aggregate.classification).toBe('isolated-software-fixture');
    expect(() => memory.verifyMemoryPeakSample(proof.sample, 'main-memory', proof.expected, f.load)).toThrow('NFR_MEMORY_PEAK_SAMPLE_REQUIRED');
    expect(memory.verifyMemoryPeakSample(proof.sample, 'main-memory', { ...proof.expected, formal: false }, f.load)).toBe(512);
  });
  it('两个phase必须来自独立进程生命期且按cold到warm排序', () => {
    const f = fixture(), proof = f.proof();
    const cold = f.load(proof.observations[0].receipt), warm = f.load(proof.observations[1].receipt);
    const coldLaunch = f.load(cold.launch), warmLaunch = f.load(warm.launch);
    warmLaunch.startedAt = coldLaunch.startedAt; warmLaunch.finishedAt = coldLaunch.finishedAt;
    warmLaunch.identity = coldLaunch.identity;
    warm.launch = f.json('same-process-launch', warmLaunch);
    warm.raw = cold.raw; warm.pid = cold.pid; warm.rendererPid = cold.rendererPid;
    warm.mainMiB = cold.mainMiB; warm.rendererMiB = cold.rendererMiB;
    proof.observations[1].receipt = f.json('same-process-memory', warm);
    expect(() => memory.createMemoryPeakSample('main-memory', proof.observations, proof.expected, f.load)).toThrow('NFR_MEMORY_INDEPENDENT_PHASES_REQUIRED');
  });
  it('两项memory合同明确峰值窗口且拒绝旧截面合同', () => {
    const targets = contract.defaultMetricTargets();
    for (const target of targets.filter(row => memory.MEMORY_METRICS.has(row.metric)))
      expect(target).toMatchObject({ unit: 'MiB', window: 'process-lifetime-peak', sampleCount: 3 });
    expect(() => contract.validateMetricTargets(targets.map(row => memory.MEMORY_METRICS.has(row.metric)
      ? { ...row, window: 'after-sample' } : row))).toThrow('NFR_MEASUREMENT_UNIT_OR_WINDOW_UNSUPPORTED');
  });
  it('sampler在cold关闭前留证并在warm业务之后组合两个生命期', () => {
    const source = fs.readFileSync(new URL('./v16-performance-sampler.js', import.meta.url), 'utf8');
    const cold = source.indexOf("const coldMemory = await recordMemory(runtime, 'cold', fixture, index)");
    const close = source.indexOf('await runtime.close(); runtime = null;');
    const warm = source.indexOf("const warmMemory = await recordMemory(runtime, 'warm', fixture, index)");
    const combine = source.indexOf('const memory = createMemoryPeakSample(metric,');
    expect(cold).toBeGreaterThan(0); expect(close).toBeGreaterThan(cold);
    expect(warm).toBeGreaterThan(close); expect(combine).toBeGreaterThan(warm);
    expect(source).toContain("[{ phase: 'cold', receipt: coldMemory }");
    expect(source).toContain("{ phase: 'warm', receipt: warmMemory }]");
    expect(source).toContain('add(metric, fixture.fixture, memory.selected.value, runtime, receipt, memory.selected)');
  });
});

function adapterFixture(peak = 32) {
  const f = fixture(), measurements = [];
  const metrics = adapters.PERFORMANCE_METRICS.flatMap(metric => ['typical', 'maximum'].flatMap(fixture =>
    (['store-switch', 'home-projection', 'module-projection'].includes(metric) ? [50, 95] : [95])
      .map(percentile => ({ metric, fixture, percentile, unit: memory.MEMORY_METRICS.has(metric) ? 'MiB' : 'fixture-unit',
        window: memory.MEMORY_METRICS.has(metric) ? memory.PEAK_MEMORY_WINDOW : 'current-run', threshold: 64, sampleCount: 3 }))));
  for (const target of metrics) {
    const samples = memory.MEMORY_METRICS.has(target.metric)
      ? [0, 1, 2].map(sampleIndex => f.proof(target.metric, { sampleIndex, fixture: target.fixture,
        coldMain: peak, warmMain: 16, coldRenderer: peak, warmRenderer: 16 }).sample)
      : [0, 1, 2].map(() => ({ value: 5, pid: 123, observedAt: f.execution.finishedAt }));
    measurements.push({ ...target, observed: memory.MEMORY_METRICS.has(target.metric) ? peak : 5,
      samples: f.json('samples', { kind: 'v16-nfr-samples', runId: 'fixture-run', metric: target.metric, fixture: target.fixture,
        environment: { platform: 'unit-only' }, packageIdentity: f.packageIdentity, samples }) });
  }
  const environment = { platform: 'unit-only' };
  const baseline = { kind: 'v16-nfr-baseline', schemaVersion: 1, status: 'measured', runId: 'fixture-run',
    sourceSha256: f.sourceSha256, packageIdentity: f.packageIdentity, execution: f.execution, environment, measurements: structuredClone(measurements) };
  const baselineRef = f.json('baseline', baseline);
  const budget = { kind: 'v16-nfr-budget', schemaVersion: 1, status: 'approved', revision: 1, owner: 'unit-only',
    environment, metrics, baselineSha256: baselineRef.sha256,
    approval: { approver: 'unit-only', approvedAt: f.execution.finishedAt, artifact: f.json('unit-approval', { unitOnly: true }) } };
  const raw = { kind: 'v16-performance-budget', schemaVersion: 1, environment, packageIdentity: f.packageIdentity,
    budget: f.json('budget', budget), baseline: baselineRef, measurements };
  const context = { root: f.root, current: { packageIdentity: f.packageIdentity }, identity: { sourceSha256: f.sourceSha256 }, execution: f.execution };
  completeMemoryAdapterFixture({ root: f.root, raw, baseline, budget, context, json: f.json });
  return { ...f, raw, baseline, budget, context, verify: () => adapters.verifyPerformance(raw, { runId: 'fixture-run' }, context) };
}

describe('正式适配器保持预算门并重算内存原件', () => {
  it('完整冷暖原件满足已存在数值门时保留正式验证通路', () => { expect(adapterFixture().verify()).toBe(true); });
  it('原生峰值超过现有阈值时保留blocker且不提高预算', () => {
    const f = adapterFixture(128), budgetBytes = fs.readFileSync(f.raw.budget.path);
    expect(() => f.verify()).toThrow('PERFORMANCE_APPROVED_BUDGET_EXCEEDED:main-memory');
    expect(fs.readFileSync(f.raw.budget.path)).toEqual(budgetBytes);
  });
  it('低截面样本和低汇总不能遮盖原件中的更高峰值', () => {
    const f = adapterFixture(128), target = f.raw.measurements.find(row => row.metric === 'main-memory');
    const samples = f.load(target.samples);
    for (const sample of samples.samples) sample.value = 16;
    target.observed = 16; target.samples = f.json('low-current-samples', samples);
    expect(() => f.verify()).toThrow('NFR_MEMORY_PEAK_SAMPLE_CHANGED');
  });
  it('数值和P95齐全但没有内存receipt时拒绝旧型样本', () => {
    const f = adapterFixture(), target = f.raw.measurements.find(row => row.metric === 'main-memory');
    const samples = f.load(target.samples);
    for (const sample of samples.samples) delete sample.receipt;
    target.samples = f.json('receipt-missing', samples);
    expect(() => f.verify()).toThrow('ARTIFACT_DIGEST_REQUIRED');
  });
  it('baseline内存原件为空时不能仅因measurement行存在而放行', () => {
    const f = adapterFixture(), target = f.baseline.measurements.find(row => row.metric === 'main-memory');
    const samples = f.load(target.samples); samples.samples = [];
    target.samples = f.json('empty-baseline-samples', samples);
    f.raw.baseline = f.json('empty-baseline', f.baseline); f.budget.baselineSha256 = f.raw.baseline.sha256;
    f.raw.budget = f.json('rebound-budget', f.budget);
    expect(() => f.verify()).toThrow('PERFORMANCE_MEMORY_BASELINE_SAMPLES_REQUIRED');
  });
  it('collector的baseline审批入口也重算内存receipt而不只信sample.value', () => {
    const f = adapterFixture(), target = f.baseline.measurements.find(row => row.metric === 'main-memory');
    const samples = f.load(target.samples); samples.samples[0].value = 16;
    target.samples = f.json('baseline-low-current', samples);
    // 这里只校验新memory入口，其他指标使用现有默认合同完成准备。
    const metrics = contract.defaultMetricTargets();
    f.budget.metrics = metrics.map(target => ({ ...target, threshold: 64 }));
    for (const row of f.baseline.measurements) Object.assign(row, metrics.find(target =>
      target.metric === row.metric && target.fixture === row.fixture && target.percentile === row.percentile));
    const reference = f.json('changed-baseline', f.baseline);
    f.budget.baselineSha256 = reference.sha256;
    expect(() => contract.validateBudget(f.budget, reference, f.baseline, f.raw.environment,
      { sourceSha256: f.sourceSha256 }, { packageIdentity: f.packageIdentity })).toThrow('NFR_MEMORY_PEAK_SAMPLE_CHANGED');
  });
});
