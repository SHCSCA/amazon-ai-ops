import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const memory = createRequire(import.meta.url)('./v16-performance-memory.js');
const protocol = createRequire(import.meta.url)('./v16-performance-protocol.test-support.cjs');

export function completeMemoryAdapterFixture(value) { return protocol.completeLegacyPerformanceFixture(value); }

// 仅生成校验器单元测试原件；不启动应用，不生成真实批准或验收证据。
export function memoryFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v16-memory-peak-unit-'));
  const packageIdentity = { executableSha256: 'a'.repeat(64), appContentSha256: 'b'.repeat(64), mainBundleSha256: 'c'.repeat(64) };
  const sourceSha256 = 'd'.repeat(64), start = Date.now() - 120000;
  const execution = { startedAt: new Date(start).toISOString(), finishedAt: new Date(start + 100000).toISOString() };
  let sequence = 0;
  const json = (label, value) => {
    const file = path.join(root, `${sequence++}-${label}.json`), bytes = Buffer.from(JSON.stringify(value));
    fs.writeFileSync(file, bytes, { flag: 'wx' });
    return { path: file, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length };
  };
  const load = reference => {
    const bytes = fs.readFileSync(reference.path);
    if (createHash('sha256').update(bytes).digest('hex') !== reference.sha256) throw new Error('UNIT_ORIGINAL_CHANGED');
    return JSON.parse(bytes.toString('utf8'));
  };
  function proof(metric = 'main-memory', options = {}) {
    const { fixture = 'typical', runId = 'fixture-run', sampleIndex = 0,
      coldMain = 512, warmMain = 128, coldRenderer = 128, warmRenderer = 256,
      classification = 'real-data-copy' } = options;
    const expected = { runId, fixture, sourceSha256, packageIdentity, execution, formal: true };
    const observations = ['cold', 'warm'].map((phase, phaseIndex) => {
      const offset = phaseIndex * 10000 + sampleIndex * 20000;
      const mainPid = 1000 + sampleIndex * 10 + phaseIndex * 2, rendererPid = mainPid + 1;
      const startedAt = new Date(start + offset + 1000).toISOString();
      const creationTime = start + offset + 1100, rendererCreationTime = start + offset + 1200;
      const identity = { pid: mainPid, creationTime, packaged: true,
        windows: [{ rendererPid, creationTime: rendererCreationTime, visible: true }] };
      const launch = json('launch', { kind: 'v16-nfr-native-launch', schemaVersion: 1,
        fixture, classification, label: `${fixture}/${sampleIndex}/${phase}`, packageIdentity, identity,
        startedAt, finishedAt: new Date(start + offset + 2000).toISOString() });
      const mainPeak = phaseIndex ? warmMain : coldMain, rendererPeak = phaseIndex ? warmRenderer : coldRenderer;
      const raw = { pid: mainPid, rendererPid, metrics: [
        { pid: mainPid, type: 'Browser', creationTime,
          memory: { workingSetSize: 16 * 1024, peakWorkingSetSize: mainPeak * 1024 } },
        { pid: rendererPid, type: 'Tab', creationTime: rendererCreationTime,
          memory: { workingSetSize: 16 * 1024, peakWorkingSetSize: rendererPeak * 1024 } },
      ] };
      const reading = memory.selectNativeMemoryPeaks(raw, identity);
      const receipt = json('observation', { kind: 'v16-nfr-memory-observation', schemaVersion: 2,
        runId, fixture, sampleIndex, capturePhase: phase, classification, sourceSha256, packageIdentity,
        measurementBasis: memory.PEAK_MEMORY_BASIS, window: memory.PEAK_MEMORY_WINDOW,
        observedAt: new Date(start + offset + 3000).toISOString(), launch, ...reading });
      return { phase, receipt };
    });
    const aggregate = memory.createMemoryPeakSample(metric, observations, { ...expected, formal: false }, load);
    const sample = { ...aggregate.selected, receipt: json('peak-sample', aggregate) };
    return { expected, observations, aggregate, sample };
  }
  return { root, packageIdentity, sourceSha256, execution, json, load, proof,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
