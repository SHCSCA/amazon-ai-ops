const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');
const { collectFrozenBuild } = require('./v16-frozen-build');
const { createRuntimeLogRecord } = require('../../../packages/shared-types/src/runtime-log-format.cjs');

const rootDir = path.resolve(__dirname, '../../..');
const EXTERNALS = Object.freeze([
  'electron', 'nock', 'mock-aws-s3', 'aws-sdk', 'chromium-bidi', 'playwright', 'playwright-core',
  '@mapbox/node-pre-gyp', 'better-sqlite3', 'duckdb',
]);

function buildMain(options = {}) {
  const root = options.root ?? rootDir;
  const desktop = path.join(root, 'apps/desktop');
  const frozen = (options.collectFrozenBuild ?? collectFrozenBuild)(root);
  const writeState = options.writeBuildState ?? (options.buildSync ? () => undefined : state => {
    const file = path.join(desktop, 'dist/main/v16-build-state.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 'v16.build-state/1', timestamp: new Date().toISOString(), identity: frozen.identity, ...state }, null, 2) + '\n');
  });
  const common = {
    absWorkingDir: desktop, bundle: true, platform: 'node', target: 'node18',
    format: 'cjs', sourcemap: true, external: EXTERNALS,
    logLevel: 'warning',
  };
  writeState({ status: 'BUILDING' });
  try {
    // 冻结定义只进入后台核验器；运行时不读取开发机源码、Git 或 release 相对目录。
    for (const [entry, name] of [
    ['index.ts', 'index.cjs'],
    ['delivery-v16-worker.ts', 'delivery-v16-worker.cjs'],
    ['delivery-v16-backup-child.ts', 'delivery-v16-backup-child.cjs'],
    ['report-parser-worker.ts', 'report-parser-worker.cjs'],
    ]) {
      (options.buildSync ?? esbuild.buildSync)({
      ...common, entryPoints: [path.join('src/main', entry)],
      outfile: path.join(desktop, 'dist/main', name),
      ...(entry === 'delivery-v16-worker.ts' ? { define: { __V16_FROZEN_BUILD_JSON__: JSON.stringify(JSON.stringify(frozen)) } } : {}),
      });
    }
    const after = (options.collectFrozenBuild ?? collectFrozenBuild)(root);
    if (JSON.stringify(after) !== JSON.stringify(frozen)) throw new Error('V16_BUILD_SOURCE_CHANGED_DURING_BUNDLE');
    if (!options.buildSync) fs.copyFileSync(path.join(desktop, 'dist/main/index.cjs'), path.join(desktop, 'dist/main/index.js'));
    writeState({ status: 'CURRENT' });
    return frozen.identity;
  } catch (error) {
    try { writeState({ status: 'STALE', issue: 'BUILD_FAILED_OR_SOURCE_CHANGED' }); }
    catch (stateError) { throw new AggregateError([error, stateError], 'V16_BUILD_AND_STALE_MARKER_FAILED'); }
    throw error;
  }
}

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(createRuntimeLogRecord('info', 'build.main_started')) + '\n');
    const identity = buildMain();
    process.stdout.write(JSON.stringify(createRuntimeLogRecord('info', 'build.main_completed', { identity })) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'build.main_failed', { error })) + '\n');
    process.exitCode = 1;
  }
}
module.exports = { buildMain, EXTERNALS };
