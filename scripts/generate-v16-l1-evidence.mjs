#!/usr/bin/env node
/**
 * V1.6.0 L1 测试证据生成器
 * 
 * 运行指定测试并生成符合 v16_evidence.schema.json 的证据文件
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const L1_TESTS = [
  {
    testId: 'V16-T-L1-ANALYSIS-AUTH',
    title: 'Analysis Authority L1 主域不变量',
    file: 'apps/desktop/src/main/analysis-authority-service.test.ts',
  },
  {
    testId: 'V16-T-L1-EXECUTION-AUTH',
    title: 'Execution Authority L1 主域不变量',
    file: 'apps/desktop/src/main/execution-authority-service.test.ts',
  },
  {
    testId: 'V16-T-L1-MISSION-DOMAIN',
    title: 'Mission Domain L1 主域不变量',
    file: 'apps/desktop/src/main/mission-domain-service.test.ts',
  },
  {
    testId: 'V16-T-L1-FORMAL-DATA-GATE',
    title: 'Formal Business Data Gate L1 合同',
    file: 'apps/desktop/src/main/formal-business-data-gate.test.ts',
  },
];

function runTest(testFile) {
  const start = Date.now();
  try {
    const output = execSync(
      `pnpm vitest run ${testFile} --reporter=json --reporter=verbose`,
      { 
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    
    // 从 JSON reporter 输出解析结果
    const lines = output.split('\n');
    const jsonLine = lines.find(line => line.trim().startsWith('{') && line.includes('"testResults"'));
    
    if (jsonLine) {
      const result = JSON.parse(jsonLine);
      const testResults = result.testResults?.[0];
      
      return {
        passed: true,
        duration: Date.now() - start,
        total: testResults?.assertionResults?.length || 0,
        passedCount: testResults?.assertionResults?.filter(t => t.status === 'passed').length || 0,
        failedCount: testResults?.assertionResults?.filter(t => t.status === 'failed').length || 0,
        skippedCount: testResults?.assertionResults?.filter(t => t.status === 'skipped').length || 0,
      };
    }
    
    // fallback: 从 verbose 输出计数
    const passedMatch = output.match(/(\d+) passed/);
    const totalTests = passedMatch ? parseInt(passedMatch[1]) : 0;
    
    return {
      passed: true,
      duration: Date.now() - start,
      total: totalTests,
      passedCount: totalTests,
      failedCount: 0,
      skippedCount: 0,
    };
  } catch (error) {
    return {
      passed: false,
      duration: Date.now() - start,
      total: 0,
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      error: error.message,
    };
  }
}

function writeEvidence(testConfig, result) {
  const evidenceDir = path.join(ROOT, 'output', 'v16-evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  
  const evidence = {
    schemaVersion: 'v16.evidence/0.1',
    testId: testConfig.testId,
    title: testConfig.title,
    layer: 'L1',
    testFile: testConfig.file,
    executionTime: new Date().toISOString(),
    duration: result.duration,
    result: {
      passed: result.passed,
      total: result.total,
      passed: result.passedCount,
      failed: result.failedCount,
      skipped: result.skippedCount,
    },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
    },
  };
  
  if (result.error) {
    evidence.error = result.error;
  }
  
  const filename = testConfig.testId.toLowerCase().replace(/[^a-z0-9]/g, '_') + '.json';
  const filepath = path.join(evidenceDir, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(`✓ Evidence written: ${filename}`);
  
  return evidence.result.passed;
}

console.log('=== V1.6.0 L1 Test Evidence Generator ===\n');

let allPassed = true;

for (const test of L1_TESTS) {
  console.log(`Running: ${test.testId}...`);
  const result = runTest(test.file);
  const passed = writeEvidence(test, result);
  
  if (passed) {
    console.log(`  ✓ ${result.passedCount}/${result.total} tests passed (${result.duration}ms)\n`);
  } else {
    console.log(`  ✗ Test failed\n`);
    allPassed = false;
  }
}

console.log(allPassed ? '✓ All L1 tests passed' : '✗ Some tests failed');
process.exit(allPassed ? 0 : 1);
