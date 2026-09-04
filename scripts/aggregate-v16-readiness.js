#!/usr/bin/env node
/**
 * aggregate-v16-readiness.js
 * 
 * L8 就绪性聚合器 — 读取 trace closure + 各层 evidence，输出最终就绪状态
 * 
 * 职责：
 * 1. 读取 docs/v16_trace_closure.schema.json 验证需求覆盖完整性
 * 2. 收集 L1-L7 各层 evidence（当前 L4-L7 gated，只读 L1-L3）
 * 3. 检查 critical path 是否通过（任一 critical 失败 → APP_NEEDS_WORK）
 * 4. 输出结构化 L8 readiness 判定 + blockers
 * 
 * 当前状态：L4-L7 gated → 始终输出 APP_NEEDS_WORK
 * APP_READY 条件：所有 gated buckets 解禁 + critical path 全过（PRD §21.6）
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(WORKSPACE_ROOT, 'output', 'v16-evidence');
const TRACE_CLOSURE_PATH = path.join(WORKSPACE_ROOT, 'docs', 'v16_trace_closure.schema.json');
const MANIFEST_PATH = path.join(WORKSPACE_ROOT, 'docs', 'v16_required_test_manifest.json');
const OUTPUT_PATH = path.join(EVIDENCE_DIR, 'v16_l8_readiness_aggregation.json');

// 确保输出目录存在
if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

/**
 * 读取并验证 trace closure
 */
function loadTraceClosure() {
  if (!fs.existsSync(TRACE_CLOSURE_PATH)) {
    throw new Error(`Trace closure not found: ${TRACE_CLOSURE_PATH}`);
  }
  return JSON.parse(fs.readFileSync(TRACE_CLOSURE_PATH, 'utf8'));
}

/**
 * 读取测试清单
 */
function loadTestManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Test manifest not found: ${MANIFEST_PATH}`);
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

/**
 * 收集已运行的 L1-L3 evidence
 */
function collectEvidence(manifest) {
  const evidence = {
    L1: [],
    L2: [],
    L3: [],
    gated: [] // L4-L7 当前 gated
  };

  manifest.tests.forEach(test => {
    const layer = test.layer;
    const artifactPath = test.producer?.producesArtifact;
    
    if (!artifactPath) return;
    
    const fullPath = path.join(WORKSPACE_ROOT, artifactPath);
    const exists = fs.existsSync(fullPath);
    
    const evidenceItem = {
      testId: test.testId,
      title: test.title,
      layer,
      bucketId: test.bucketId,
      artifactPath,
      exists,
      status: 'unknown'
    };

    // 尝试读取 evidence 判定结果
    if (exists) {
      try {
        const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        evidenceItem.status = content.status || content.result || 'pass';
        evidenceItem.testCount = content.numPassedTests || content.passed || 0;
        evidenceItem.failCount = content.numFailedTests || content.failed || 0;
      } catch (e) {
        evidenceItem.status = 'error';
        evidenceItem.error = e.message;
      }
    } else {
      evidenceItem.status = 'missing';
    }

    if (layer === 'L1') evidence.L1.push(evidenceItem);
    else if (layer === 'L2') evidence.L2.push(evidenceItem);
    else if (layer === 'L3') evidence.L3.push(evidenceItem);
    else if (['L4', 'L5', 'L6', 'L7'].includes(layer)) {
      evidence.gated.push({
        ...evidenceItem,
        reason: 'USER_PROHIBITION'
      });
    }
  });

  return evidence;
}

/**
 * 判定最终就绪状态
 */
function aggregateReadiness(traceClosure, manifest, evidence) {
  const blockers = [];
  const warnings = [];
  
  // 1. Trace closure 完整性检查
  const allRequirementIds = Object.keys(traceClosure.requirements || {});
  const coveredRequirementIds = new Set();
  
  manifest.tests.forEach(test => {
    (test.requirementIds || []).forEach(rid => coveredRequirementIds.add(rid));
  });
  
  const uncoveredRequirements = allRequirementIds.filter(rid => !coveredRequirementIds.has(rid));
  if (uncoveredRequirements.length > 0) {
    warnings.push({
      type: 'INCOMPLETE_COVERAGE',
      message: `${uncoveredRequirements.length} requirements not covered by tests`,
      uncoveredRequirements: uncoveredRequirements.slice(0, 5) // 只显示前5个
    });
  }

  // 2. 检查 L1-L3 critical path
  const criticalTests = manifest.tests.filter(t => 
    ['L1', 'L2', 'L3'].includes(t.layer) && t.bucketId && t.bucketId.includes('L1')
  );
  
  criticalTests.forEach(test => {
    const ev = [...evidence.L1, ...evidence.L2, ...evidence.L3].find(e => e.testId === test.testId);
    if (!ev) {
      blockers.push({
        type: 'MISSING_CRITICAL_EVIDENCE',
        testId: test.testId,
        layer: test.layer,
        message: `Critical test ${test.testId} has no evidence`
      });
    } else if (ev.status === 'missing') {
      blockers.push({
        type: 'MISSING_CRITICAL_EVIDENCE',
        testId: test.testId,
        layer: test.layer,
        message: `Critical test ${test.testId} evidence file not found`
      });
    } else if (ev.status !== 'pass' && ev.status !== 'passed') {
      blockers.push({
        type: 'FAILED_CRITICAL_TEST',
        testId: test.testId,
        layer: test.layer,
        status: ev.status,
        message: `Critical test ${test.testId} failed with status: ${ev.status}`
      });
    }
  });

  // 3. L4-L7 gated blocker（当前硬性阻断）
  if (evidence.gated.length > 0) {
    blockers.push({
      type: 'GATED_LAYERS',
      count: evidence.gated.length,
      message: `${evidence.gated.length} L4-L7 tests are gated by user prohibition`,
      gatedBuckets: [...new Set(evidence.gated.map(g => g.bucketId))]
    });
  }

  // 4. 最终判定
  const readinessStatus = blockers.length > 0 ? 'APP_NEEDS_WORK' : 'APP_READY';
  
  return {
    readinessStatus,
    blockers,
    warnings,
    summary: {
      totalTests: manifest.tests.length,
      L1_passed: evidence.L1.filter(e => e.status === 'pass' || e.status === 'passed').length,
      L1_total: evidence.L1.length,
      L2_passed: evidence.L2.filter(e => e.status === 'pass' || e.status === 'passed').length,
      L2_total: evidence.L2.length,
      L3_passed: evidence.L3.filter(e => e.status === 'pass' || e.status === 'passed').length,
      L3_total: evidence.L3.length,
      gated_count: evidence.gated.length,
      blocker_count: blockers.length,
      warning_count: warnings.length
    }
  };
}

/**
 * 主入口
 */
function main() {
  console.log('=== V1.6.0 L8 Readiness Aggregation ===\n');
  
  try {
    // 加载输入
    console.log('Loading trace closure...');
    const traceClosure = loadTraceClosure();
    console.log(`✓ Trace closure loaded: ${Object.keys(traceClosure.requirements || {}).length} requirements\n`);
    
    console.log('Loading test manifest...');
    const manifest = loadTestManifest();
    console.log(`✓ Test manifest loaded: ${manifest.tests.length} tests\n`);
    
    // 收集 evidence
    console.log('Collecting evidence from L1-L3...');
    const evidence = collectEvidence(manifest);
    console.log(`✓ Evidence collected:`);
    console.log(`  - L1: ${evidence.L1.length} tests`);
    console.log(`  - L2: ${evidence.L2.length} tests`);
    console.log(`  - L3: ${evidence.L3.length} tests`);
    console.log(`  - Gated (L4-L7): ${evidence.gated.length} tests\n`);
    
    // 聚合判定
    console.log('Aggregating readiness...');
    const result = aggregateReadiness(traceClosure, manifest, evidence);
    
    // 输出结果
    const output = {
      schemaVersion: '1.0.0',
      timestamp: new Date().toISOString(),
      readinessStatus: result.readinessStatus,
      summary: result.summary,
      blockers: result.blockers,
      warnings: result.warnings,
      evidence: {
        L1: evidence.L1.map(e => ({ testId: e.testId, status: e.status, exists: e.exists })),
        L2: evidence.L2.map(e => ({ testId: e.testId, status: e.status, exists: e.exists })),
        L3: evidence.L3.map(e => ({ testId: e.testId, status: e.status, exists: e.exists })),
        gated: evidence.gated.map(g => ({ testId: g.testId, layer: g.layer, reason: g.reason }))
      }
    };
    
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
    console.log(`✓ Readiness aggregation written to: ${OUTPUT_PATH}\n`);
    
    // 打印结果摘要
    console.log('=== Readiness Summary ===');
    console.log(`Status: ${result.readinessStatus}`);
    console.log(`Blockers: ${result.blockers.length}`);
    console.log(`Warnings: ${result.warnings.length}`);
    
    if (result.blockers.length > 0) {
      console.log('\nBlockers:');
      result.blockers.forEach((b, i) => {
        console.log(`  ${i + 1}. [${b.type}] ${b.message}`);
      });
    }
    
    if (result.warnings.length > 0) {
      console.log('\nWarnings:');
      result.warnings.forEach((w, i) => {
        console.log(`  ${i + 1}. [${w.type}] ${w.message}`);
      });
    }
    
    console.log('\n=== Aggregation Complete ===');
    process.exit(result.readinessStatus === 'APP_READY' ? 0 : 1);
    
  } catch (error) {
    console.error('ERROR:', error.message);
    console.error(error.stack);
    process.exit(2);
  }
}

// 运行
if (require.main === module) {
  main();
}

module.exports = { loadTraceClosure, loadTestManifest, collectEvidence, aggregateReadiness };
