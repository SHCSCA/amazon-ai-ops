const { insist, same } = require('./v16-native-artifacts');

const MEMORY_METRICS = new Set(['main-memory', 'renderer-memory']);
const PEAK_MEMORY_WINDOW = 'process-lifetime-peak';
const PEAK_MEMORY_BASIS = 'electron.app.getAppMetrics.peakWorkingSetSize';
const positive = value => Number.isFinite(value) && value > 0;
const pid = value => Number.isSafeInteger(value) && value > 0;

function selectNativeMemoryPeaks(observed, identity) {
  const rendererIdentity = identity?.windows?.[0];
  insist(pid(identity?.pid) && pid(rendererIdentity?.rendererPid)
    && identity.pid !== rendererIdentity.rendererPid && positive(identity.creationTime)
    && positive(rendererIdentity.creationTime), 'NFR_MEMORY_PROCESS_IDENTITY_REQUIRED');
  insist(observed?.pid === identity.pid && observed.rendererPid === rendererIdentity.rendererPid
    && Array.isArray(observed.metrics), 'NFR_MEMORY_PROCESS_IDENTITY_CHANGED');
  function select(processId, creationTime, type) {
    const matches = observed.metrics.filter(metric => metric.pid === processId);
    insist(matches.length === 1, 'NFR_MEMORY_PROCESS_METRIC_NOT_UNIQUE');
    const metric = matches[0];
    insist(metric.type === type && metric.creationTime === creationTime, 'NFR_MEMORY_PROCESS_IDENTITY_CHANGED');
    const memory = metric.memory;
    // 当前工作集只作旁证，不能替代操作系统记录的进程历史峰值。
    insist(positive(memory?.workingSetSize) && positive(memory?.peakWorkingSetSize)
      && memory.peakWorkingSetSize >= memory.workingSetSize, 'NFR_MEMORY_NATIVE_PEAK_UNAVAILABLE');
    return memory.peakWorkingSetSize / 1024;
  }
  return { raw: observed, pid: observed.pid, rendererPid: observed.rendererPid,
    mainMiB: select(identity.pid, identity.creationTime, 'Browser'),
    rendererMiB: select(rendererIdentity.rendererPid, rendererIdentity.creationTime, 'Tab') };
}

function inside(value, execution) {
  const time = Date.parse(value), start = Date.parse(execution?.startedAt), end = Date.parse(execution?.finishedAt);
  insist(Number.isFinite(time) && Number.isFinite(start) && Number.isFinite(end)
    && start <= time && time <= end, 'NFR_MEMORY_TIME_OUTSIDE_EXECUTION');
  return time;
}

function observationPeak(reference, phase, metric, expected, load) {
  const receipt = load(reference);
  insist(receipt?.kind === 'v16-nfr-memory-observation' && receipt.schemaVersion === 2
    && receipt.capturePhase === phase && receipt.fixture === expected.fixture
    && receipt.runId === expected.runId && receipt.sourceSha256 === expected.sourceSha256
    && Number.isSafeInteger(receipt.sampleIndex) && receipt.sampleIndex >= 0
    && same(receipt.packageIdentity, expected.packageIdentity)
    && receipt.measurementBasis === PEAK_MEMORY_BASIS && receipt.window === PEAK_MEMORY_WINDOW,
  'NFR_MEMORY_OBSERVATION_CONTRACT_MISMATCH');
  insist(['isolated-software-fixture', 'real-data-copy'].includes(receipt.classification)
    && (!expected.formal || (receipt.classification === 'real-data-copy'
      && receipt.formalAcceptanceEvidence !== false)), 'NFR_MEMORY_SOFTWARE_EVIDENCE_NOT_FORMAL');
  const launch = load(receipt.launch);
  insist(launch?.kind === 'v16-nfr-native-launch' && launch.schemaVersion === 1
    && launch.label === `${expected.fixture}/${receipt.sampleIndex}/${phase}`
    && launch.fixture === expected.fixture && launch.classification === receipt.classification
    && same(launch.packageIdentity, expected.packageIdentity)
    && launch.identity?.packaged === true && launch.identity.windows?.length === 1
    && launch.identity.windows[0].visible === true
    && (!expected.formal || launch.formalAcceptanceEvidence !== false), 'NFR_MEMORY_LAUNCH_BINDING_MISMATCH');
  const started = inside(launch.startedAt, expected.execution);
  const ready = inside(launch.finishedAt, expected.execution);
  const observedAt = inside(receipt.observedAt, expected.execution);
  insist(started <= ready && ready <= observedAt, 'NFR_MEMORY_PHASE_ORDER_INVALID');
  const values = selectNativeMemoryPeaks(receipt.raw, launch.identity);
  insist(receipt.pid === values.pid && receipt.rendererPid === values.rendererPid
    && receipt.mainMiB === values.mainMiB && receipt.rendererMiB === values.rendererMiB,
  'NFR_MEMORY_OBSERVATION_VALUE_CHANGED');
  const renderer = metric === 'renderer-memory', processId = renderer ? values.rendererPid : values.pid;
  const creationTime = renderer ? launch.identity.windows[0].creationTime : launch.identity.creationTime;
  insist(creationTime >= started && creationTime <= ready, 'NFR_MEMORY_PROCESS_OUTSIDE_LAUNCH');
  return { sampleIndex: receipt.sampleIndex, classification: receipt.classification, started, observedAt,
    selected: { phase, pid: processId, creationTime, value: renderer ? values.rendererMiB : values.mainMiB,
      observedAt: receipt.observedAt } };
}

function createMemoryPeakSample(metric, observations, expected, load) {
  insist(MEMORY_METRICS.has(metric) && Array.isArray(observations) && observations.length === 2
    && observations[0]?.phase === 'cold' && observations[1]?.phase === 'warm', 'NFR_MEMORY_COLD_WARM_REQUIRED');
  const cold = observationPeak(observations[0].receipt, 'cold', metric, expected, load);
  const warm = observationPeak(observations[1].receipt, 'warm', metric, expected, load);
  insist(cold.sampleIndex === warm.sampleIndex && cold.classification === warm.classification
    && cold.observedAt <= warm.started
    && (cold.selected.pid !== warm.selected.pid || cold.selected.creationTime !== warm.selected.creationTime),
  'NFR_MEMORY_INDEPENDENT_PHASES_REQUIRED');
  // 每轮分别取冷、暖进程的原生峰值，再取两者最大值；不是瞬时截面的最大值。
  const selected = cold.selected.value >= warm.selected.value ? cold.selected : warm.selected;
  return { kind: 'v16-nfr-memory-peak-sample', schemaVersion: 1, runId: expected.runId,
    sourceSha256: expected.sourceSha256, packageIdentity: expected.packageIdentity,
    metric, fixture: expected.fixture, sampleIndex: cold.sampleIndex, classification: cold.classification,
    unit: 'MiB', window: PEAK_MEMORY_WINDOW, measurementBasis: PEAK_MEMORY_BASIS, observations, selected };
}

function verifyMemoryPeakSample(sample, metric, expected, load) {
  const receipt = load(sample?.receipt);
  insist(receipt?.kind === 'v16-nfr-memory-peak-sample' && receipt.schemaVersion === 1
    && receipt.metric === metric && receipt.fixture === expected.fixture && receipt.runId === expected.runId
    && receipt.sourceSha256 === expected.sourceSha256 && same(receipt.packageIdentity, expected.packageIdentity)
    && receipt.unit === 'MiB' && receipt.window === PEAK_MEMORY_WINDOW
    && receipt.measurementBasis === PEAK_MEMORY_BASIS
    && (!expected.formal || (receipt.classification === 'real-data-copy'
      && receipt.formalAcceptanceEvidence !== false)), 'NFR_MEMORY_PEAK_SAMPLE_REQUIRED');
  const derived = createMemoryPeakSample(metric, receipt.observations, expected, load);
  insist(receipt.sampleIndex === derived.sampleIndex && receipt.classification === derived.classification
    && same(receipt.selected, derived.selected) && sample.value === derived.selected.value
    && sample.pid === derived.selected.pid && sample.creationTime === derived.selected.creationTime
    && sample.observedAt === derived.selected.observedAt, 'NFR_MEMORY_PEAK_SAMPLE_CHANGED');
  return derived.selected.value;
}

function verifyMemoryPeakSamples(samples, metric, expected, load) {
  insist(Array.isArray(samples) && samples.length > 0, 'NFR_MEMORY_PEAK_SAMPLES_REQUIRED');
  const indices = new Set(), processes = new Set();
  for (const sample of samples) {
    verifyMemoryPeakSample(sample, metric, expected, load);
    const receipt = load(sample.receipt);
    insist(!indices.has(receipt.sampleIndex), 'NFR_MEMORY_INDEPENDENT_SAMPLES_REQUIRED');
    for (const observation of receipt.observations) {
      const raw = load(observation.receipt).raw;
      const processId = metric === 'renderer-memory' ? raw.rendererPid : raw.pid;
      const processMetric = raw.metrics.find(value => value.pid === processId);
      const process = `${processId}/${processMetric.creationTime}`;
      // 较低且未入选的phase也必须独立，不能复用它来冒充新一轮采样。
      insist(!processes.has(process), 'NFR_MEMORY_INDEPENDENT_SAMPLES_REQUIRED');
      processes.add(process);
    }
    indices.add(receipt.sampleIndex);
  }
}

module.exports = { MEMORY_METRICS, PEAK_MEMORY_WINDOW, PEAK_MEMORY_BASIS, selectNativeMemoryPeaks,
  createMemoryPeakSample, verifyMemoryPeakSample, verifyMemoryPeakSamples };
