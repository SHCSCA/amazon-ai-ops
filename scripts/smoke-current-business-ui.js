const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

const smokeScripts = [
  'scripts/smoke-business-ui-data-collection.js',
  'scripts/smoke-business-ui-shell.js',
  'scripts/smoke-business-ui-data-pipeline.js',
  'scripts/smoke-business-ui-ad-execution.js',
  'scripts/smoke-business-ui-keyword-listing.js',
  'scripts/smoke-business-ui-settings-delivery.js',
];

function runSmoke(scriptPath) {
  const absoluteScriptPath = path.join(root, scriptPath);
  if (!fs.existsSync(absoluteScriptPath)) {
    return {
      script: scriptPath,
      status: 1,
      error: `Smoke script not found: ${scriptPath}`,
    };
  }

  console.log(`\n[smoke-current-business-ui] running ${scriptPath}`);
  const result = spawnSync(process.execPath, [absoluteScriptPath], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
  });

  return {
    script: scriptPath,
    status: typeof result.status === 'number' ? result.status : 1,
    signal: result.signal || null,
    error: result.error ? result.error.message : null,
  };
}

function writeSummary(results) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const summary = {
    kind: 'current-business-ui-smoke-summary',
    generatedAt: new Date().toISOString(),
    scripts: results,
    flowCoverage: [
      { flow: '连接', evidenceScript: 'scripts/smoke-business-ui-shell.js' },
      { flow: '采集', evidenceScript: 'scripts/smoke-business-ui-data-collection.js' },
      { flow: '策略', evidenceScript: 'scripts/smoke-business-ui-shell.js' },
      { flow: '运营任务', evidenceScript: 'scripts/smoke-business-ui-shell.js' },
      { flow: '经营实验', evidenceScript: 'scripts/smoke-business-ui-shell.js' },
      { flow: '弹窗', evidenceScript: 'scripts/smoke-business-ui-shell.js' },
      { flow: '按钮', evidenceScript: 'scripts/smoke-business-ui-shell.js' },
    ].map((item) => ({
      ...item,
      passed: results.some((result) => result.script === item.evidenceScript && result.status === 0),
    })),
    passed: results.every((item) => item.status === 0),
  };
  const outPath = path.join(evidenceDir, `current-business-ui-smoke-${Date.now()}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return outPath;
}

const results = smokeScripts.map(runSmoke);
const summaryPath = writeSummary(results);
const failed = results.filter((item) => item.status !== 0);

console.log(`\n[smoke-current-business-ui] summary: ${summaryPath}`);

if (failed.length > 0) {
  for (const item of failed) {
    console.error(`[smoke-current-business-ui] failed: ${item.script} status=${item.status}${item.error ? ` error=${item.error}` : ''}`);
  }
  process.exit(1);
}

console.log('[smoke-current-business-ui] passed.');
