import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { bindRuntimeWorkerLogReceipts, classifyIsolatedRuntimeLogs, currentWorkerRuntimeHashes,
  requireHonestRuntimeReadiness, requireInsideRuntimeProfile, verifyRuntimeNonReadyBundle } from './isolated-v16-delivery-receipt.mjs';

const require = createRequire(import.meta.url);
const { writePublicationBundle } = require('./v16-publication-bundle.js');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('amazon-worker-receipt-')) throw new Error('拒绝清理非本次收据测试目录。');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-worker-receipt-')); roots.push(profile);
  const bundle = path.join(profile, 'nonce', 'delivery-bundle'); fs.mkdirSync(path.dirname(bundle));
  const core = { schemaVersion: 'v16.release-core/1', identity: { sourceRevision: 'test-only', sourceSha256: 'a'.repeat(64), packageVersion: '1.6.0' },
    eligible: false, gates: Array.from({ length: 7 }, (_, i) => ({ layer: `L${i + 1}`, passed: false })), issues: ['MISSING_REAL_EVIDENCE'] };
  writePublicationBundle(bundle, core, '**DELIVERY: APP_NEEDS_WORK — INTERNAL NON_READY.**\n', []);
  return { profile, bundle, core };
}
const readiness = () => ({ appReady: false, status: 'APP_NEEDS_WORK', previewOnly: false, manifestDriven: true, available: true,
  verificationProtocol: 'v16.current-publication/1', gates: Array.from({ length: 8 }, (_, i) => ({ id: `L${i + 1}`, ok: false })) });
const injectedFault = () => ({ level: 'error', event: 'ipc.handler_failed', context: { channel: 'settings:save-rule-config', error: { message: '规则配置必须是 JSON 对象。' } } });
const diagnostic = nonce => JSON.parse(JSON.stringify(createRuntimeLogRecord('warn', 'delivery.worker_diagnostic', {
  nonce, diagnostic: createRuntimeLogRecord('info', 'delivery.v16_current_verification', { nonce }),
})));

describe('isolated packaged Worker receipt validation', () => {
  it('accepts the exact eight non-ready production gates without assigning real-store or APP_READY credit', () => {
    expect(requireHonestRuntimeReadiness(readiness(), true).appReady).toBe(false);
    const { profile, bundle } = fixture(); const result = verifyRuntimeNonReadyBundle(profile, bundle);
    expect(result).toMatchObject({ status: 'NON_READY', phase: 'PUBLISHED', formalAppReadiness: false, realStoreEvidence: false });
    expect(result.structuralSafety.success).toBe(true); expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(['ready', 'preview', 'missing-gate', 'duplicate-gate', 'real-L6', 'real-L7', 'old-protocol'])('rejects a %s readiness claim', kind => {
    const value = readiness();
    if (kind === 'ready') value.appReady = true;
    if (kind === 'preview') value.previewOnly = true;
    if (kind === 'missing-gate') value.gates.pop();
    if (kind === 'duplicate-gate') value.gates[7].id = 'L7';
    if (kind === 'real-L6') value.gates[5].ok = true;
    if (kind === 'real-L7') value.gates[6].ok = true;
    if (kind === 'old-protocol') value.verificationProtocol = 'legacy';
    expect(() => requireHonestRuntimeReadiness(value, true)).toThrow();
  });
  it.each(['payload', 'unexpected-file', 'ready-manifest', 'missing-original', 'linked-original'])('rejects a %s export instead of treating self-reported NON_READY as sufficient', kind => {
    const { profile, bundle } = fixture();
    const manifest = path.join(bundle, 'delivery-bundle-manifest.json');
    if (kind === 'payload') fs.appendFileSync(path.join(bundle, 'README.snapshot.md'), 'changed');
    if (kind === 'unexpected-file') fs.writeFileSync(path.join(bundle, 'extra.json'), '{}');
    if (kind === 'ready-manifest') { const value = JSON.parse(fs.readFileSync(manifest)); value.status = 'READY_CANDIDATE'; fs.writeFileSync(manifest, JSON.stringify(value)); }
    if (kind === 'missing-original') fs.unlinkSync(path.join(bundle, 'release-core.json'));
    if (kind === 'linked-original') fs.linkSync(path.join(bundle, 'release-core.json'), path.join(profile, 'alias.json'));
    expect(() => verifyRuntimeNonReadyBundle(profile, bundle)).toThrow();
  });
  it('refuses outputs outside the isolated profile and binds the complete actual Worker and backup-helper byte set', () => {
    const { profile } = fixture();
    expect(() => requireInsideRuntimeProfile(profile, profile)).toThrow();
    expect(() => requireInsideRuntimeProfile(profile, path.join(profile, '..', 'foreign'))).toThrow();
    const main = path.join(profile, 'main'); fs.mkdirSync(main);
    const names = ['index.js', 'delivery-v16-worker.cjs', 'delivery-v16-backup-child.cjs', 'report-parser-worker.cjs'];
    for (const name of names) fs.writeFileSync(path.join(main, name), name);
    const hashes = currentWorkerRuntimeHashes(profile); expect(Object.keys(hashes)).toEqual(names);
    for (const name of names) {
      const file = path.join(main, name);
      fs.appendFileSync(file, 'changed'); expect(currentWorkerRuntimeHashes(profile)).not.toEqual(hashes);
      fs.writeFileSync(file, name);
      fs.unlinkSync(file); expect(() => currentWorkerRuntimeHashes(profile)).toThrow();
      fs.writeFileSync(file, name);
    }
  });
  it('classifies only the exact injected settings fault while retaining the explicit missing-manifest warning', () => {
    const warning = { level: 'warn', event: 'delivery.worker_diagnostic', context: { diagnostic: { event: 'delivery.v16_manifest_missing', level: 'warn' } } };
    expect(classifyIsolatedRuntimeLogs([injectedFault(), warning])).toMatchObject({ expectedFaults: [injectedFault()], missingWorkPackageWarnings: [warning], unexpectedErrors: [] });
    expect(() => classifyIsolatedRuntimeLogs([])).toThrow(); expect(() => classifyIsolatedRuntimeLogs([injectedFault(), injectedFault()])).toThrow();
  });
  it.each(['unknown-worker', 'ENOENT', 'wrong-channel', 'wrong-message'])('never suppresses the %s runtime error as expected non-ready state', kind => {
    const error = injectedFault();
    if (kind === 'unknown-worker') error.event = 'delivery.worker_failed';
    if (kind === 'ENOENT') { error.event = 'delivery.worker_diagnostic'; error.context = { diagnostic: { event: 'delivery.v16_manifest_missing', level: 'error', message: 'ENOENT' } }; }
    if (kind === 'wrong-channel') error.context.channel = 'delivery:export';
    if (kind === 'wrong-message') error.context.error.message += ' changed';
    expect(() => classifyIsolatedRuntimeLogs([injectedFault(), error])).toThrow();
  });
  it('rejects nested Worker errors even when the Main diagnostic transport is warn', () => {
    const record = { level: 'warn', event: 'delivery.worker_diagnostic', context: { diagnostic: { event: 'delivery.v16_evidence_status_failed', level: 'error' } } };
    expect(() => classifyIsolatedRuntimeLogs([injectedFault(), record])).toThrow();
  });
  it('requires independent actual Worker nonces including the export nonce and records Main PID and Electron ABI provenance', () => {
    const receipt = { exportNonce: '00000000-0000-4000-8000-000000000003', actualElectron: { pid: 1234, modulesAbi: '136' } };
    const logs = [1, 2, 3].map(i => diagnostic(`00000000-0000-4000-8000-00000000000${i}`));
    expect(bindRuntimeWorkerLogReceipts(logs, receipt)).toMatchObject({ exportNonce: receipt.exportNonce, mainPid: 1234, electronModulesAbi: '136' });
    expect(() => bindRuntimeWorkerLogReceipts([logs[0], logs[0], logs[2]], receipt)).toThrow();
    expect(() => bindRuntimeWorkerLogReceipts(logs, { ...receipt, exportNonce: 'other' })).toThrow();
    expect(() => bindRuntimeWorkerLogReceipts([...logs, diagnostic(undefined)], receipt)).toThrow();
    expect(bindRuntimeWorkerLogReceipts(logs, receipt).acceptedWorkerNonces).toEqual(logs.map(record => record.context.nonce));
    expect(logs[2].context.diagnostic.context.nonce).toBe(logs[2].context.nonce);
    for (const exportNonce of [undefined, null, 123, logs[2].context.nonce]) {
      expect(() => bindRuntimeWorkerLogReceipts(logs, { ...receipt, exportNonce })).toThrow();
    }
    expect(() => bindRuntimeWorkerLogReceipts(logs, { ...receipt, exportNonce: '00000000-0000-4000-8000-000000000004' })).toThrow();
    for (const nonce of [receipt.exportNonce, `[path:${'a'.repeat(20)}]`, `[id:${'a'.repeat(20)}]`,
      `[nonce:${'a'.repeat(19)}]`, `[nonce:${'a'.repeat(21)}]`, `[nonce:${'A'.repeat(20)}]`, 'arbitrary', 123, null]) {
      const corrupted = structuredClone(logs); corrupted[0].context.nonce = nonce;
      expect(() => bindRuntimeWorkerLogReceipts(corrupted, receipt)).toThrow();
    }
    const missingMainNonce = structuredClone(logs); delete missingMainNonce[2].context.nonce;
    expect(() => bindRuntimeWorkerLogReceipts(missingMainNonce, receipt)).toThrow();
    const unrelated = { ...logs[1], event: 'delivery.other_diagnostic' };
    expect(() => bindRuntimeWorkerLogReceipts([logs[0], logs[0], logs[2], unrelated], receipt)).toThrow();
  });
});
