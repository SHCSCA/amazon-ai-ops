#!/usr/bin/env node
/**
 * V1.6.0 必需测试清单验证器
 * 
 * 验证所有必需测试是否完成，并检查证据完整性。
 * 
 * 用法:
 *   node scripts/verify-v16-required-test-manifest.js --manifest output/v16-evidence/v16_required_test_manifest.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const manifestIndex = args.indexOf('--manifest');
  
  if (manifestIndex === -1 || !args[manifestIndex + 1]) {
    console.error('错误: 缺少 --manifest 参数');
    console.error('用法: node verify-v16-required-test-manifest.js --manifest <manifest.json>');
    process.exit(1);
  }
  
  return {
    manifestPath: path.resolve(args[manifestIndex + 1])
  };
}

function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    console.error(`错误: manifest 文件不存在: ${manifestPath}`);
    process.exit(1);
  }
  
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`错误: 无法解析 manifest 文件: ${error.message}`);
    process.exit(1);
  }
}

function loadEvidence(evidencePath) {
  if (!fs.existsSync(evidencePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(evidencePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.warn(`警告: 无法解析证据文件 ${evidencePath}: ${error.message}`);
    return null;
  }
}

function verifyManifest(manifest) {
  console.log('\n=== V1.6.0 必需测试清单验证 ===\n');
  
  const { requiredTests } = manifest;
  const results = {
    total: requiredTests.length,
    completed: 0,
    missing: 0,
    failed: 0,
    details: []
  };
  
  for (const test of requiredTests) {
    const evidencePath = path.resolve(test.evidencePath);
    const evidence = loadEvidence(evidencePath);
    
    const detail = {
      testId: test.testId,
      title: test.title,
      layer: test.layer,
      status: 'UNKNOWN',
      passed: 0,
      total: 0,
      evidencePath: test.evidencePath
    };
    
    if (!evidence) {
      detail.status = 'MISSING';
      results.missing++;
    } else if (evidence.result.failed > 0) {
      detail.status = 'FAILED';
      detail.passed = evidence.result.passed;
      detail.total = evidence.result.total;
      detail.failed = evidence.result.failed;
      results.failed++;
    } else {
      detail.status = 'COMPLETED';
      detail.passed = evidence.result.passed;
      detail.total = evidence.result.total;
      results.completed++;
    }
    
    results.details.push(detail);
  }
  
  return results;
}

function printResults(results) {
  console.log('测试层级汇总:');
  console.log('-------------');
  
  const byLayer = {};
  for (const detail of results.details) {
    if (!byLayer[detail.layer]) {
      byLayer[detail.layer] = { completed: 0, total: 0, tests: 0 };
    }
    byLayer[detail.layer].tests++;
    if (detail.status === 'COMPLETED') {
      byLayer[detail.layer].completed++;
      byLayer[detail.layer].total += detail.total;
    }
  }
  
  for (const [layer, stats] of Object.entries(byLayer).sort()) {
    const symbol = stats.completed === stats.tests ? '✅' : '❌';
    console.log(`${symbol} ${layer}: ${stats.completed}/${stats.tests} 测试套件完成`);
  }
  
  console.log('\n详细结果:');
  console.log('----------');
  
  for (const detail of results.details) {
    const symbol = detail.status === 'COMPLETED' ? '✅' : 
                   detail.status === 'FAILED' ? '❌' : '⚠️';
    const statusText = detail.status === 'COMPLETED' ? `${detail.passed}/${detail.total} 通过` :
                       detail.status === 'FAILED' ? `${detail.passed}/${detail.total} 通过, ${detail.failed} 失败` :
                       '证据缺失';
    
    console.log(`${symbol} [${detail.layer}] ${detail.testId}`);
    console.log(`   ${detail.title}`);
    console.log(`   状态: ${statusText}`);
    console.log(`   证据: ${detail.evidencePath}`);
    console.log('');
  }
  
  console.log('总体结果:');
  console.log('---------');
  console.log(`总计: ${results.total} 个必需测试套件`);
  console.log(`✅ 完成: ${results.completed}`);
  console.log(`⚠️  缺失: ${results.missing}`);
  console.log(`❌ 失败: ${results.failed}`);
  
  const allPassed = results.completed === results.total && results.failed === 0;
  console.log(`\n最终判定: ${allPassed ? '✅ 通过' : '❌ 未通过'}`);
  
  return allPassed;
}

function main() {
  const { manifestPath } = parseArgs();
  const manifest = loadManifest(manifestPath);
  const results = verifyManifest(manifest);
  const passed = printResults(results);
  
  // 写入验证结果
  const outputPath = manifestPath.replace('.json', '.verification.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    verifiedAt: new Date().toISOString(),
    manifestPath,
    passed,
    ...results
  }, null, 2));
  
  console.log(`\n验证结果已写入: ${outputPath}`);
  
  process.exit(passed ? 0 : 1);
}

main();
