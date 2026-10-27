import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const cases = ['root', 'owner', 'proof', 'pending', 'queued', 'name', 'role', 'role-unknown', 'fresh', 'stale',
  'counter', 'counter-isolation', 'nonce-counter', 'phase-counter', 'reason-counter', 'logging-failure', 'logging-all-failure',
  'stopped', 'owned-stop', 'expired', 'invalid-token', 'invalid-nonce', 'invalid-phase', 'identity',
  'late-before-log', 'stopped-before-log', 'stop-file-before-log', 'successful', 'successful-propertypage'];

async function executeModel(scenario) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-focus-diagnostic-model-'));
  const args = [path.resolve('scripts/v16-nvda-focus-diagnostic-model.py'), directory,
    path.resolve('scripts/v16-nvda-speech-observer.py'), scenario];
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

describe('真实生产poll_focus隔离拒绝诊断不改变原协议', () => {
  it.each(cases)('场景 %s 只观察有界阶段且保留归属、时限、原ACK与自然语音门', async (scenario) => {
    const result = await executeModel(scenario);
    expect(result).toMatchObject({ isolatedModel: true, actualSourceExecuted: true, scenario,
      actualNvdaCredit: false, inputSent: false, speechCounterUnchanged: true, ownerHandleClosed: true });
    expect(result.accepted).toBe(scenario === 'successful' || scenario === 'successful-propertypage');
    for (const row of result.diagnostics) {
      expect(row.event).toBe('v16.ui_nvda_focus_rejected');
      expect(row.context.formalCredit).toBe(false);
      expect([1, 10, 100, 1000]).toContain(row.context.count);
      expect(Object.keys(row.context)).not.toContain('name');
      expect(Object.keys(row.context)).not.toContain('speech');
    }
  });
});

describe('新增安全角色枚举诊断只扩展可读日志', () => {
  const roles = { 'role-togglebutton': 'togglebutton', 'role-treeviewitem': 'treeviewitem', 'role-treeviewbutton': 'treeviewbutton',
    'role-dropdownbutton': 'dropdownbutton', 'role-menubutton': 'menubutton', 'role-splitbutton': 'splitbutton' };
  it.each([...Object.keys(roles), 'role-unknown-new', 'role-secret-new', 'role-logging-failure', 'role-logging-all-failure'])(
    '场景 %s 保持原拒绝、单次内容读取和日志隐私', async scenario => {
      const result = await executeModel(scenario);
      expect(result).toMatchObject({ isolatedModel: true, actualSourceExecuted: true, scenario, actualNvdaCredit: false,
        inputSent: false, accepted: false, speechCounterUnchanged: true, ownerHandleClosed: true });
      expect(result.reads.name).toBe(1); expect(result.reads.role).toBe(1);
      if (scenario.includes('logging')) expect(result.diagnostics).toEqual([]);
      else {
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].context).toMatchObject({ reason: 'NAME_OR_ROLE_MISMATCH', nameMatches: true,
          roleMatches: false, roleToken: roles[scenario] || 'OTHER', formalCredit: false });
      }
    });
});
