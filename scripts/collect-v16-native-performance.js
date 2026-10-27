#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
const { validatePlan, defaultMetricTargets } = require('./v16-performance-contract');

function argumentsFor(argv) {
  const options = { phase: 'software' }, seen = new Set();
  for (let i=0;i<argv.length;i++) {
    const name = argv[i];
    if (name === '--help' || name === '--print-contract') {
      if (argv.length !== 1) throw new Error('NFR_INFORMATION_FLAG_MUST_STAND_ALONE');
      return { [name.slice(2)]: true };
    }
    if (!['--plan','--out','--phase'].includes(name) || seen.has(name)) throw new Error('NFR_UNKNOWN_OR_DUPLICATE_ARGUMENT:' + name);
    seen.add(name);
    const value = argv[++i];
    if (!value || value.trim() !== value || value.startsWith('--') || value.includes('\0')) throw new Error('NFR_ARGUMENT_VALUE_REQUIRED:' + name);
    options[name.slice(2)] = value;
  }
  if (!options.plan || !options.out || !['software','baseline','measure'].includes(options.phase)) throw new Error('NFR_PLAN_OUTPUT_PHASE_REQUIRED');
  return options;
}
async function main(argv = process.argv.slice(2)) {
  const options = argumentsFor(argv);
  if (options.help) {
    process.stdout.write('真实 Windows 目录 EXE 的 NFR 原件采集\n\n'
      + 'node scripts/collect-v16-native-performance.js --print-contract\n'
      + 'node scripts/collect-v16-native-performance.js --plan <capture-plan.json> --out <新目录> --phase software|baseline|measure\n\n'
      + 'software 默认输出隔离软件测量，不能用作正式 L4/L5。baseline 仅在所有实际样本齐全时标 measured；measure 必须提供已批准且绑定同包/同源码 baseline 的预算。\n'
      + '固定使用 release/win-unpacked/AmazonAIOpsAgent.exe 与现有只读隔离路径协议；不接受 URL、替代 EXE、回调、样本数字、凭证、审批、Ads 执行或配置写入参数。\n'
      + '典型/最大场景必须提供真实 profile、WAL-safe 快照、不同首次导入批次/分析任务；AI 与外部采集只能使用当前 Main 权威和另有的具体批准。缺失原件写入 issues，绝不补零或自动批准。\n');
    return;
  }
  if (options['print-contract']) {
    process.stdout.write(JSON.stringify({ kind: 'v16-nfr-capture-plan', schemaVersion: 1,
      runId: 'operator-selected-run-id', identity: null, operationTimeoutMs: 300000,
      metrics: defaultMetricTargets(), fixtures: ['typical','maximum'].map(fixture => ({ fixture, path: '', sha256: '' })),
      note: '仅为采集合同模板；没有预算阈值、批准、真实数据或验收信用。' }, null, 2) + '\n');
    return;
  }
  const planPath = path.resolve(options.plan);
  const plan = validatePlan(JSON.parse(fs.readFileSync(planPath, 'utf8').replace(/^\uFEFF/, '')));
  const result = await require('./v16-performance-sampler').collectPerformance({ plan, output: path.resolve(options.out), phase: options.phase });
  process.stdout.write(JSON.stringify(createRuntimeLogRecord(result.report.collectionComplete ? 'info' : 'warn',
    'v16.nfr_capture_reported', { report: result.reportArtifact, collectionComplete: result.report.collectionComplete,
      issueCount: result.report.issues.length, phase: options.phase, appReady: false })) + '\n');
  if (!(options.phase === 'software' ? result.report.softwareMeasurementsComplete : result.report.collectionComplete)) process.exitCode = 2;
  return result;
}
if (require.main === module) main().catch(error => {
  process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'v16.nfr_capture_failed', { error })) + '\n');
  process.exitCode = 1;
});
module.exports = { argumentsFor, main };
