#!/usr/bin/env node
/**
 * V1.6.0 L8 就绪度聚合验证器
 * 
 * 聚合所有层级的测试证据，生成最终就绪度报告。
 * 
 * 用法:
 *   node scripts/verify-v16-readiness-aggregation.js --manifest output/v16-evidence/v16_required_test_manifest.json --out output/v16-evidence/v16_l8_readiness.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const manifestIndex = args.indexOf('--manifest');
  const outIndex = args.indexOf('--out');
  
  if (manifestIndex === -1 || !args[manifestIndex + 1]) {
    console.error('错误: 缺少 --manifest 参数');
    process.exit(1);
  }
  
  return {
    manifestPath: path.resolve(args[manifestIndex + 1]),
    outputPath: outIndex !== -1 && args[outIndex + 1] 
      ? path.resolve(args[outIndex + 1])
      : path.join(path.dirname(args[manifestIndex + 1]), 'v16_l8_readiness.json')
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

function aggregateReadiness(manifest) {
  console.log('\n=== V1.6.0 L8 就绪度聚合 ===\n');
  
  const byLayer = {};
  const gates = [];
  
  // 按层级聚合
  for (const test of manifest.requiredTests) {
    const evidence = loadEvidence(path.resolve(test.evidencePath));
    
    if (!byLayer[test.layer]) {
      byLayer[test.layer] = {
        layer: test.layer,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        missingEvidence: 0,
        suites: []
      };
    }
    
    const layerStats = byLayer[test.layer];
    
    if (!evidence) {
      layerStats.missingEvidence++;
      layerStats.suites.push({
        testId: test.testId,
        title: test.title,
        status: 'MISSING_EVIDENCE',
        passed: 0,
        total: 0
      });
    } else {
      layerStats.totalTests += evidence.result.total;
      layerStats.passedTests += evidence.result.passed;
      layerStats.failedTests += evidence.result.failed;
      
      layerStats.suites.push({
        testId: test.testId,
        title: test.title,
        status: evidence.result.failed === 0 ? 'PASSED' : 'FAILED',
        passed: evidence.result.passed,
        total: evidence.result.total,
        failed: evidence.result.failed,
        duration: evidence.duration
      });
    }
  }
  
  // 定义交付门禁
  const l1Complete = byLayer.L1 && byLayer.L1.failedTests === 0 && byLayer.L1.missingEvidence === 0;
  const l2Complete = byLayer.L2 && byLayer.L2.failedTests === 0 && byLayer.L2.missingEvidence === 0;
  const l3Complete = byLayer.L3 && byLayer.L3.failedTests === 0 && byLayer.L3.missingEvidence === 0;
  const l4Complete = byLayer.L4 && byLayer.L4.failedTests === 0 && byLayer.L4.missingEvidence === 0;
  
  gates.push({
    gateId: 'GATE-1-L1-INVARIANTS',
    title: 'L1 主域不变量',
    passed: l1Complete,
    required: true,
    blockerReason: l1Complete ? null : 'L1 层测试未通过或证据缺失'
  });
  
  gates.push({
    gateId: 'GATE-2-L2-COORDINATION',
    title: 'L2 跨域协调',
    passed: l2Complete,
    required: true,
    blockerReason: l2Complete ? null : 'L2 层测试未通过或证据缺失'
  });
  
  gates.push({
    gateId: 'GATE-3-L3-WORKFLOW',
    title: 'L3 工作流完整性',
    passed: l3Complete,
    required: true,
    blockerReason: l3Complete ? null : 'L3 层测试未通过或证据缺失'
  });
  
  gates.push({
    gateId: 'GATE-4-L4-UI',
    title: 'L4 UI 契约',
    passed: l4Complete,
    required: true,
    blockerReason: l4Complete ? null : 'L4 层测试未通过或证据缺失'
  });
  
  gates.push({
    gateId: 'GATE-5-L5-SMOKE',
    title: 'L5 业务烟雾测试',
    passed: false,
    required: true,
    blockerReason: 'L5 业务烟雾测试尚未运行'
  });
  
  gates.push({
    gateId: 'GATE-6-L6-PACKAGE',
    title: 'L6 打包完整性',
    passed: false,
    required: true,
    blockerReason: 'Windows 打包尚未执行'
  });
  
  gates.push({
    gateId: 'GATE-7-L7-LAUNCH',
    title: 'L7 启动验证',
    passed: false,
    required: true,
    blockerReason: '打包后启动验证尚未执行'
  });
  
  gates.push({
    gateId: 'GATE-8-REAL-ADS',
    title: '真实 Ads 执行回读',
    passed: false,
    required: true,
    blockerReason: '真实 Amazon Ads 执行回读尚未完成'
  });
  
  const allGatesPassed = gates.every(g => g.passed);
  const requiredGatesPassed = gates.filter(g => g.required).every(g => g.passed);
  
  return {
    timestamp: new Date().toISOString(),
    version: 'v1.6.0',
    overallStatus: allGatesPassed ? 'APP_READY' : 'APP_NEEDS_WORK',
    readinessLevel: requiredGatesPassed ? 'READY' : 'NOT_READY',
    gates,
    layerSummary: Object.values(byLayer),
    statistics: {
      totalGates: gates.length,
      passedGates: gates.filter(g => g.passed).length,
      totalTests: Object.values(byLayer).reduce((sum, layer) => sum + layer.totalTests, 0),
      passedTests: Object.values(byLayer).reduce((sum, layer) => sum + layer.passedTests, 0),
      failedTests: Object.values(byLayer).reduce((sum, layer) => sum + layer.failedTests, 0)
    }
  };
}

function printReadiness(readiness) {
  console.log('层级测试汇总:');
  console.log('-------------');
  
  for (const layer of readiness.layerSummary) {
    const symbol = layer.failedTests === 0 && layer.missingEvidence === 0 ? '✅' : '❌';
    console.log(`${symbol} ${layer.layer}: ${layer.passedTests}/${layer.totalTests} 测试通过 (${layer.suites.length} 套件)`);
    if (layer.missingEvidence > 0) {
      console.log(`   ⚠️  ${layer.missingEvidence} 个套件证据缺失`);
    }
    if (layer.failedTests > 0) {
      console.log(`   ❌ ${layer.failedTests} 个测试失败`);
    }
  }
  
  console.log('\n交付门禁状态:');
  console.log('-------------');
  
  for (const gate of readiness.gates) {
    const symbol = gate.passed ? '✅' : '❌';
    const requiredMark = gate.required ? '[必需]' : '[可选]';
    console.log(`${symbol} ${requiredMark} ${gate.gateId}: ${gate.title}`);
    if (!gate.passed && gate.blockerReason) {
      console.log(`   阻断原因: ${gate.blockerReason}`);
    }
  }
  
  console.log('\n整体统计:');
  console.log('---------');
  console.log(`交付门禁: ${readiness.statistics.passedGates}/${readiness.statistics.totalGates} 通过`);
  console.log(`测试用例: ${readiness.statistics.passedTests}/${readiness.statistics.totalTests} 通过`);
  console.log(`失败用例: ${readiness.statistics.failedTests}`);
  
  console.log(`\n就绪度等级: ${readiness.readinessLevel}`);
  console.log(`整体状态: ${readiness.overallStatus}`);
  
  const symbol = readiness.overallStatus === 'APP_READY' ? '✅' : '⚠️';
  console.log(`\n${symbol} 最终判定: ${readiness.overallStatus}`);
  
  return readiness.overallStatus === 'APP_READY';
}

function main() {
  const { manifestPath, outputPath } = parseArgs();
  const manifest = loadJSON(manifestPath, '测试清单');
  
  const readiness = aggregateReadiness(manifest);
  const ready = printReadiness(readiness);
  
  // 写入聚合结果
  fs.writeFileSync(outputPath, JSON.stringify(readiness, null, 2));
  console.log(`\n就绪度报告已写入: ${outputPath}`);
  
  // 同时写入验证结果
  const verificationPath = outputPath.replace('.json', '.verification.json');
  fs.writeFileSync(verificationPath, JSON.stringify({
    verifiedAt: new Date().toISOString(),
    manifestPath,
    outputPath,
    ready,
    summary: {
      overallStatus: readiness.overallStatus,
      passedGates: readiness.statistics.passedGates,
      totalGates: readiness.statistics.totalGates,
      passedTests: readiness.statistics.passedTests,
      totalTests: readiness.statistics.totalTests
    }
  }, null, 2));
  
  console.log(`验证结果已写入: ${verificationPath}`);
  
  // Don't fail the build when NOT_READY - this is expected during development
  // Only exit with error if there's an actual verification error
  process.exit(0);
}

main();
