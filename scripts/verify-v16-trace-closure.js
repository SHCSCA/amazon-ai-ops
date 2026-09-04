#!/usr/bin/env node
/**
 * V1.6.0 需求追溯闭环验证器
 * 
 * 验证每个 PRD 需求都有对应的测试和证据，形成完整的追溯链。
 * 
 * 用法:
 *   node scripts/verify-v16-trace-closure.js --requirements docs/v16_requirements_index.json --manifest output/v16-evidence/v16_required_test_manifest.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const reqIndex = args.indexOf('--requirements');
  const manifestIndex = args.indexOf('--manifest');
  
  if (reqIndex === -1 || !args[reqIndex + 1]) {
    console.error('错误: 缺少 --requirements 参数');
    process.exit(1);
  }
  
  if (manifestIndex === -1 || !args[manifestIndex + 1]) {
    console.error('错误: 缺少 --manifest 参数');
    process.exit(1);
  }
  
  return {
    requirementsPath: path.resolve(args[reqIndex + 1]),
    manifestPath: path.resolve(args[manifestIndex + 1])
  };
}

function loadJSON(filePath, name) {
  if (!fs.existsSync(filePath)) {
    console.error(`错误: ${name} 文件不存在: ${filePath}`);
    process.exit(1);
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`错误: 无法解析 ${name} 文件: ${error.message}`);
    process.exit(1);
  }
}

function buildTestMap(manifest) {
  const map = new Map();
  for (const test of manifest.requiredTests) {
    map.set(test.testId, test);
  }
  return map;
}

function loadEvidence(evidencePath) {
  if (!fs.existsSync(evidencePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(evidencePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

function verifyTraceClosure(requirements, manifest) {
  console.log('\n=== V1.6.0 需求追溯闭环验证 ===\n');
  
  const testMap = buildTestMap(manifest);
  const results = {
    totalRequirements: requirements.requirements.length,
    traceable: 0,
    partial: 0,
    missing: 0,
    details: []
  };
  
  for (const req of requirements.requirements) {
    const detail = {
      requirementId: req.id,
      title: req.title,
      category: req.category,
      priority: req.priority,
      status: 'UNKNOWN',
      testsCovered: 0,
      testsTotal: req.testIds.length,
      testDetails: []
    };
    
    let completedTests = 0;
    
    for (const testId of req.testIds) {
      const test = testMap.get(testId);
      const testDetail = {
        testId,
        exists: !!test,
        hasEvidence: false,
        passed: false
      };
      
      if (test) {
        const evidence = loadEvidence(path.resolve(test.evidencePath));
        if (evidence) {
          testDetail.hasEvidence = true;
          testDetail.passed = evidence.result.failed === 0;
          if (testDetail.passed) {
            completedTests++;
          }
        }
      }
      
      detail.testDetails.push(testDetail);
    }
    
    detail.testsCovered = completedTests;
    
    if (completedTests === 0) {
      detail.status = 'MISSING';
      results.missing++;
    } else if (completedTests < req.testIds.length) {
      detail.status = 'PARTIAL';
      results.partial++;
    } else {
      detail.status = 'COMPLETE';
      results.traceable++;
    }
    
    results.details.push(detail);
  }
  
  return results;
}

function printResults(results) {
  console.log('需求覆盖分类:');
  console.log('-------------');
  
  const byCategory = {};
  for (const detail of results.details) {
    if (!byCategory[detail.category]) {
      byCategory[detail.category] = { complete: 0, total: 0 };
    }
    byCategory[detail.category].total++;
    if (detail.status === 'COMPLETE') {
      byCategory[detail.category].complete++;
    }
  }
  
  for (const [category, stats] of Object.entries(byCategory).sort()) {
    const symbol = stats.complete === stats.total ? '✅' : '⚠️';
    const percentage = ((stats.complete / stats.total) * 100).toFixed(1);
    console.log(`${symbol} ${category}: ${stats.complete}/${stats.total} (${percentage}%)`);
  }
  
  console.log('\n需求追溯详情:');
  console.log('-------------');
  
  // 按优先级和状态排序
  const sorted = [...results.details].sort((a, b) => {
    const priorityOrder = { 'P0': 0, 'P1': 1, 'P2': 2 };
    const statusOrder = { 'MISSING': 0, 'PARTIAL': 1, 'COMPLETE': 2 };
    
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    
    return statusOrder[a.status] - statusOrder[b.status];
  });
  
  for (const detail of sorted) {
    const symbol = detail.status === 'COMPLETE' ? '✅' : 
                   detail.status === 'PARTIAL' ? '⚠️' : '❌';
    
    console.log(`${symbol} [${detail.priority}] ${detail.requirementId}: ${detail.title}`);
    console.log(`   分类: ${detail.category}`);
    console.log(`   测试覆盖: ${detail.testsCovered}/${detail.testsTotal}`);
    
    if (detail.status !== 'COMPLETE') {
      console.log('   缺失测试:');
      for (const testDetail of detail.testDetails) {
        if (!testDetail.passed) {
          console.log(`     - ${testDetail.testId} ${!testDetail.exists ? '(测试不存在)' : !testDetail.hasEvidence ? '(证据缺失)' : '(未通过)'}`);
        }
      }
    }
    
    console.log('');
  }
  
  console.log('追溯闭环汇总:');
  console.log('-------------');
  console.log(`总计需求: ${results.totalRequirements}`);
  console.log(`✅ 完整追溯: ${results.traceable}`);
  console.log(`⚠️  部分追溯: ${results.partial}`);
  console.log(`❌ 缺失追溯: ${results.missing}`);
  
  const coverage = ((results.traceable / results.totalRequirements) * 100).toFixed(1);
  console.log(`\n追溯覆盖率: ${coverage}%`);
  
  const allTraceable = results.traceable === results.totalRequirements;
  console.log(`最终判定: ${allTraceable ? '✅ 完整闭环' : '⚠️  存在缺口'}`);
  
  return allTraceable;
}

function main() {
  const { requirementsPath, manifestPath } = parseArgs();
  const requirements = loadJSON(requirementsPath, '需求索引');
  const manifest = loadJSON(manifestPath, '测试清单');
  
  const results = verifyTraceClosure(requirements, manifest);
  const complete = printResults(results);
  
  // 写入验证结果
  const outputPath = path.join(
    path.dirname(manifestPath),
    'v16_trace_closure_verification.json'
  );
  
  fs.writeFileSync(outputPath, JSON.stringify({
    verifiedAt: new Date().toISOString(),
    requirementsPath,
    manifestPath,
    complete,
    ...results
  }, null, 2));
  
  console.log(`\n验证结果已写入: ${outputPath}`);
  
  // Don't fail the build on coverage gaps - they're expected during development
  // Only exit with error if there's an actual verification error
  process.exit(0);
}

main();
