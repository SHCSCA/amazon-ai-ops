import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const cases = ['no-callback', 'stopped', 'missing-request', 'expired', 'invalid-token', 'root', 'owner', 'proof',
  'name', 'role', 'empty', 'accepted', 'propertypage', 'counter', 'counter-node', 'counter-reason', 'replayed-nonce',
  'logging-entry', 'logging-name', 'logging-empty', 'logging-accepted', 'logging-all'];

async function executeModel(scenario) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-speech-diagnostic-model-'));
  const args = ['-B', path.resolve('scripts/v16-nvda-speech-diagnostic-model.py'), directory,
    path.resolve('scripts/v16-nvda-speech-observer.py'), scenario, path.resolve('scripts/v16-nvda-observer-test-harness.py')];
  const execution = { scenario, command: 'python', args, startedAt: new Date().toISOString(), events: [] };
  let stdout = '', stderr = '';
  await new Promise((resolve) => {
    const child = spawn('python', args, { windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (bytes) => { stdout += bytes.toString('utf8'); });
    child.stderr.on('data', (bytes) => { stderr += bytes.toString('utf8'); });
    child.once('spawn', () => {
      execution.pid = child.pid;
      execution.events.push({ type: 'spawn', pid: child.pid, timestamp: new Date().toISOString() });
    });
    child.once('error', (error) => {
      execution.error = { name: error.name, message: error.message };
      execution.events.push({ type: 'error', timestamp: new Date().toISOString() });
    });
    child.once('exit', (code, signal) => execution.events.push({ type: 'exit', code, signal, timestamp: new Date().toISOString() }));
    child.once('close', (code, signal) => {
      Object.assign(execution, { code, signal, completedAt: new Date().toISOString() });
      execution.events.push({ type: 'close', code, signal, timestamp: new Date().toISOString() });
      resolve();
    });
  });
  fs.writeFileSync(path.join(directory, 'MODEL-HOST.json'), JSON.stringify(execution, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, 'MODEL-stdout.txt'), stdout);
  fs.writeFileSync(path.join(directory, 'MODEL-stderr.txt'), stderr);
  expect(execution.error).toBeUndefined();
  expect(execution.events.map((event) => event.type)).toEqual(['spawn', 'exit', 'close']);
  expect(execution.signal).toBeNull();
  expect(execution.code, stderr).toBe(0);
  const result = JSON.parse(stdout);
  expect(result.pid).toBe(execution.pid);
  return result;
}

describe('真实生产observe的有限回调诊断保持原语音链', () => {
  it.each(cases)('场景 %s 保留原门与语音原件且诊断失败不参与判定', async (scenario) => {
    const result = await executeModel(scenario);
    expect(result).toMatchObject({ isolatedModel: true, actualSourceExecuted: true, scenario,
      actualNvdaCredit: false, inputSent: false, originalSpeechPreserved: true, ownerHandleClosed: true });
    expect(result.accepted).toBe(['accepted', 'propertypage', 'counter-reason', 'replayed-nonce',
      'logging-entry', 'logging-accepted', 'logging-all'].includes(scenario));
    for (const row of result.diagnostics) {
      expect(row.event).toBe('v16.ui_nvda_speech_callback');
      expect(row.context.formalCredit).toBe(false);
      expect([1, 10, 100, 1000]).toContain(row.context.count);
      expect(Object.keys(row.context)).not.toContain('name');
      expect(Object.keys(row.context)).not.toContain('speech');
    }
  });
});
