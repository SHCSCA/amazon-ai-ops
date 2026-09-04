#!/usr/bin/env node
/**
 * V1.6 Services Contract Verifier — Tests
 *
 * Exercises the contract verifier end-to-end. Uses a tmp dir to confirm it
 * passes when files exist and fails when they don't.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function run(args) {
  try {
    return { code: 0, stdout: execFileSync('node', [path.join(ROOT, 'scripts', 'verify-v16-services-contract.mjs'), ...args], { encoding: 'utf-8' }) };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL: ' + msg);
    process.exit(1);
  }
}

const real = run([]);
assert(real.code === 0, `real repo should pass contract (exit ${real.code})`);
assert(/PASS/.test(real.stdout), 'real repo stdout should mention PASS');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v16svc-'));
try {
  // Empty workspace — must fail
  const result = run(['--root', tmp]);
  assert(result.code === 1, `empty workspace should fail (got exit ${result.code})`);
  assert(/FAIL/.test(result.stdout) || /missing/.test(result.stderr), 'should report missing files');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('OK: V1.6 services contract verifier passes both checks.');
