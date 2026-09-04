#!/usr/bin/env node
/**
 * verify-v16-l8-readiness-aggregation.js
 * 
 * L8 就绪性聚合验证器 — 验证聚合器输出格式和最终判定逻辑
 * 
 * 职责：
 * 1. 验证 L8 聚合器输出结构符合 schema
 * 2. 检查 readinessStatus 判定逻辑正确性
 * 3. 验证 blockers/warnings 完整性
 * 4. 确认当前 gated 状态下始终输出 APP_NEEDS_WORK
 * 
 * 期望行为：
 * - L4-L7 gated → 必须有 GATED_LAYERS blocker → readinessStatus = APP_NEEDS_WORK
 * - Critical path 失败 → 必须有 blocker → APP_NEEDS_WORK
 * - 所有门禁通过 → APP_READY
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const DEFAULT_INPUT = path.join(WORKSPACE_ROOT, 'output', 'v16-evidence', 'v16_l8_readiness_aggregation.json');

/**
 * 验证 L8 聚合器输出
 */
function verifyL8Aggregation(inputPath) {
  const results = {
    passed: [],
    failed: [],
    warnings: []
  };

  function pass(check) {
    results.passed.push(check);
  }

  function fail(check, reason) {
    results.failed.push({ check, reason });
  }

  function warn(message) {
    results.warnings.push(message);
  }

  // 1. 文件存在性
  if (!fs.existsSync(inputPath)) {
    fail('FILE_EXISTS', `Aggregation output not found: ${inputPath}`);
    return results;
  }
  pass('FILE_EXISTS');

  // 2. 读取并解析
  let data;
  try {
    data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (e) {
    fail('JSON_PARSE', `Failed to parse JSON: ${e.message}`);
    return results;
  }
  pass('JSON_PARSE');

  // 3. Schema 完整性
  const requiredFields = ['schemaVersion', 'timestamp', 'readinessStatus', 'summary', 'blockers', 'warnings', 'evidence'];
  const missingFields = requiredFields.filter(f => !(f in data));
  if (missingFields.length > 0) {
    fail('SCHEMA_COMPLETE', `Missing required fields: ${missingFields.join(', ')}`);
  } else {
    pass('SCHEMA_COMPLETE');
  }

  // 4. readinessStatus 枚举值
  const validStatuses = ['APP_READY', 'APP_NEEDS_WORK'];
  if (!validStatuses.includes(data.readinessStatus)) {
    fail('READINESS_STATUS_VALID', `Invalid readinessStatus: ${data.readinessStatus}. Must be one of: ${validStatuses.join(', ')}`);
  } else {
    pass('READINESS_STATUS_VALID');
  }

  // 5. Summary 结构
  if (data.summary) {
    const summaryFields = ['totalTests', 'L1_passed', 'L1_total', 'L2_passed', 'L2_total', 'L3_passed', 'L3_total', 'gated_count', 'blocker_count', 'warning_count'];
    const missingSummaryFields = summaryFields.filter(f => !(f in data.summary));
    if (missingSummaryFields.length > 0) {
      fail('SUMMARY_COMPLETE', `Missing summary fields: ${missingSummaryFields.join(', ')}`);
    } else {
      pass('SUMMARY_COMPLETE');
    }

    // 检查数值合理性
    if (data.summary.totalTests < 1) {
      fail('SUMMARY_TOTAL_TESTS', 'totalTests must be >= 1');
    } else {
      pass('SUMMARY_TOTAL_TESTS');
    }

    if (data.summary.blocker_count !== data.blockers.length) {
      warn(`Summary blocker_count (${data.summary.blocker_count}) != actual blockers length (${data.blockers.length})`);
    }

    if (data.summary.warning_count !== data.warnings.length) {
      warn(`Summary warning_count (${data.summary.warning_count}) != actual warnings length (${data.warnings.length})`);
    }
  } else {
    fail('SUMMARY_EXISTS', 'summary field is missing');
  }

  // 6. Blockers 结构
  if (Array.isArray(data.blockers)) {
    pass('BLOCKERS_ARRAY');
    data.blockers.forEach((blocker, i) => {
      if (!blocker.type) {
        fail(`BLOCKER_${i}_TYPE`, `Blocker ${i} missing type field`);
      }
      if (!blocker.message) {
        fail(`BLOCKER_${i}_MESSAGE`, `Blocker ${i} missing message field`);
      }
    });
  } else {
    fail('BLOCKERS_ARRAY', 'blockers must be an array');
  }

  // 7. Warnings 结构
  if (Array.isArray(data.warnings)) {
    pass('WARNINGS_ARRAY');
  } else {
    fail('WARNINGS_ARRAY', 'warnings must be an array');
  }

  // 8. Evidence 结构
  if (data.evidence) {
    const evidenceLayers = ['L1', 'L2', 'L3', 'gated'];
    const missingLayers = evidenceLayers.filter(l => !Array.isArray(data.evidence[l]));
    if (missingLayers.length > 0) {
      fail('EVIDENCE_LAYERS', `Missing evidence layers: ${missingLayers.join(', ')}`);
    } else {
      pass('EVIDENCE_LAYERS');
    }

    // 检查 gated 层
    if (data.evidence.gated && data.evidence.gated.length > 0) {
      pass('GATED_LAYERS_RECORDED');
    }
  } else {
    fail('EVIDENCE_EXISTS', 'evidence field is missing');
  }

  // 9. 逻辑一致性：gated 存在 → 必须有 GATED_LAYERS blocker
  if (data.evidence && data.evidence.gated && data.evidence.gated.length > 0) {
    const hasGatedBlocker = Array.isArray(data.blockers) && data.blockers.some(b => b.type === 'GATED_LAYERS');
    if (!hasGatedBlocker) {
      fail('GATED_BLOCKER_REQUIRED', 'Gated layers exist but no GATED_LAYERS blocker found');
    } else {
      pass('GATED_BLOCKER_REQUIRED');
    }
  }

  // 10. 逻辑一致性：有 blocker → 必须 APP_NEEDS_WORK
  if (Array.isArray(data.blockers) && data.blockers.length > 0 && data.readinessStatus === 'APP_READY') {
    fail('BLOCKERS_FORCE_NEEDS_WORK', `${data.blockers.length} blockers exist but readinessStatus is APP_READY`);
  } else if (Array.isArray(data.blockers) && data.blockers.length > 0) {
    pass('BLOCKERS_FORCE_NEEDS_WORK');
  }

  // 11. 当前预期：L4-L7 gated → 必须 APP_NEEDS_WORK
  if (data.readinessStatus === 'APP_READY' && data.summary && data.summary.gated_count > 0) {
    fail('GATED_FORCES_NEEDS_WORK', `${data.summary.gated_count} tests are gated but readinessStatus is APP_READY. Expected APP_NEEDS_WORK while L4-L7 prohibited.`);
  } else if (data.summary && data.summary.gated_count > 0) {
    pass('GATED_FORCES_NEEDS_WORK');
  }

  // 12. Timestamp 有效性
  if (data.timestamp) {
    const ts = new Date(data.timestamp);
    if (isNaN(ts.getTime())) {
      fail('TIMESTAMP_VALID', 'timestamp is not a valid ISO date');
    } else {
      pass('TIMESTAMP_VALID');
    }
  } else {
    fail('TIMESTAMP_EXISTS', 'timestamp field is missing');
  }

  return results;
}

/**
 * 打印验证结果
 */
function printResults(results) {
  console.log('\n=== L8 Readiness Aggregation Verification ===\n');

  console.log(`✓ Passed: ${results.passed.length}`);
  results.passed.forEach(check => {
    console.log(`  ✓ ${check}`);
  });

  if (results.warnings.length > 0) {
    console.log(`\n⚠ Warnings: ${results.warnings.length}`);
    results.warnings.forEach(warning => {
      console.log(`  ⚠ ${warning}`);
    });
  }

  if (results.failed.length > 0) {
    console.log(`\n✗ Failed: ${results.failed.length}`);
    results.failed.forEach(failure => {
      console.log(`  ✗ [${failure.check}] ${failure.reason}`);
    });
  }

  const total = results.passed.length + results.failed.length;
  const passRate = total > 0 ? ((results.passed.length / total) * 100).toFixed(1) : 0;

  console.log(`\n=== Summary ===`);
  console.log(`Pass Rate: ${passRate}% (${results.passed.length}/${total})`);
  console.log(`Status: ${results.failed.length === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`Warnings: ${results.warnings.length}`);
}

/**
 * 主入口
 */
function main() {
  const args = process.argv.slice(2);
  const inputPath = args.find(a => !a.startsWith('--')) || DEFAULT_INPUT;

  console.log(`Verifying L8 aggregation: ${inputPath}`);

  const results = verifyL8Aggregation(inputPath);
  printResults(results);

  // 写入结构化结果
  const outputPath = inputPath.replace('.json', '.verification.json');
  const output = {
    timestamp: new Date().toISOString(),
    inputFile: inputPath,
    result: results.failed.length === 0 ? 'PASS' : 'FAIL',
    passed: results.passed.length,
    failed: results.failed.length,
    warnings: results.warnings.length,
    checks: {
      passed: results.passed,
      failed: results.failed,
      warnings: results.warnings
    }
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nVerification result written to: ${outputPath}`);

  process.exit(results.failed.length === 0 ? 0 : 1);
}

// 运行
if (require.main === module) {
  main();
}

module.exports = { verifyL8Aggregation };
