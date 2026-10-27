import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const startedAt = new Date().toISOString();
const runId = `${startedAt.replace(/[:.]/g, '-')}-${process.pid}`;
const configuration = Object.freeze({
  repositoryRoot,
  scenario: 'mixed-recommendations',
  host: '127.0.0.1',
  outputDirectory: path.join(repositoryRoot, 'output', 'local-simulation', runId),
  shutdownTimeoutMs: 10_000,
  dataSource: 'memory-fixtures',
  dataPersistence: '刷新页面或重启后恢复初始样例',
});

const runtime = { server: null, startup: null, shutdown: null, manifest: null, loggingReady: false };
const logPath = path.join(configuration.outputDirectory, 'runtime.jsonl');
const manifestPath = path.join(configuration.outputDirectory, 'manifest.json');

function describeError(error) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { name: 'UnknownError', message: String(error) };
}

function log(level, event, context = {}) {
  const entry = { timestamp: new Date().toISOString(), level, event, context };
  const serialized = `${JSON.stringify(entry)}\n`;
  if (runtime.loggingReady) {
    try {
      fs.appendFileSync(logPath, serialized, 'utf8');
    } catch (error) {
      process.stderr.write(`${JSON.stringify({
        timestamp: new Date().toISOString(), level: 'error',
        event: 'local_simulation_log_write_failed', context: { error: describeError(error) },
      })}\n`);
    }
  }
  if (level === 'error') process.stderr.write(serialized);
}

function writeManifest(update) {
  runtime.manifest = { ...runtime.manifest, ...update, updatedAt: new Date().toISOString() };
  fs.writeFileSync(manifestPath, `${JSON.stringify(runtime.manifest, null, 2)}\n`, 'utf8');
}

function updateManifestSafely(update) {
  try {
    if (runtime.manifest) writeManifest(update);
  } catch (error) {
    log('error', 'local_simulation_manifest_write_failed', { error: describeError(error) });
  }
}

function shutdown(reason, exitCode = 0) {
  if (runtime.shutdown) return runtime.shutdown;
  runtime.shutdown = (async () => {
    log('info', 'local_simulation_stopping', { reason, exitCode });
    updateManifestSafely({ state: 'stopping', stopReason: reason });
    const timeout = setTimeout(() => {
      log('error', 'local_simulation_shutdown_timeout', { timeoutMs: configuration.shutdownTimeoutMs });
      updateManifestSafely({ state: 'failed', stoppedAt: new Date().toISOString(), exitCode: 1 });
      process.exit(1);
    }, configuration.shutdownTimeoutMs);
    let finalCode = exitCode;
    try {
      if (runtime.startup) await runtime.startup;
      if (runtime.server) await runtime.server.close();
    } catch (error) {
      finalCode = 1;
      log('error', 'local_simulation_shutdown_failed', { error: describeError(error) });
    }
    clearTimeout(timeout);
    updateManifestSafely({
      state: finalCode === 0 ? 'stopped' : 'failed',
      stoppedAt: new Date().toISOString(),
      exitCode: finalCode,
    });
    log(finalCode === 0 ? 'info' : 'error', 'local_simulation_stopped', { reason, exitCode: finalCode });
    process.exit(finalCode);
  })();
  return runtime.shutdown;
}

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.length === 1 && ['--help', '-h'].includes(argumentsList[0])) {
    process.stdout.write([
      'Amazon AI Ops 本机模拟工作台',
      '用法：node scripts/start-local-simulation.mjs',
      '默认场景：mixed-recommendations；仅监听 127.0.0.1 的动态端口。',
      '使用已有开发预览内存样例，刷新页面或重启会重置。',
      '不建立正式数据库，不连接真实店铺或付费 AI，不代表 APP_READY。',
      '启动后保持终端开启，浏览器打开输出的 URL；按 Ctrl+C 关闭。',
      '',
    ].join('\n'));
    return;
  }
  fs.mkdirSync(configuration.outputDirectory, { recursive: true });
  runtime.loggingReady = true;
  writeManifest({
    schemaVersion: 1,
    kind: 'local-simulation-session',
    runId,
    pid: process.pid,
    startedAt,
    state: 'starting',
    configuration,
    realData: false,
    formalDatabaseCreated: false,
    electronBridgeAttached: false,
    liveStoreConnected: false,
    readinessEvidence: false,
    appReady: false,
    productDeliveryStatus: 'APP_NEEDS_WORK',
    label: '仅开发预览',
    manifestPath,
    logPath,
  });
  if (argumentsList.length) throw new Error('不支持启动参数；使用 --help 查看说明。');
  log('info', 'local_simulation_starting', { configuration });
  const { startBusinessUiDevServer } = require('./business-ui-smoke-navigation.js');
  runtime.startup = startBusinessUiDevServer(configuration.repositoryRoot, configuration.scenario)
    .then((server) => {
      runtime.server = server;
      return server;
    });
  const server = await runtime.startup;
  if (runtime.shutdown) return;
  const url = new URL(server.url);
  if (url.hostname !== configuration.host || url.protocol !== 'http:') {
    throw new Error('模拟服务未绑定预期的本机地址。');
  }
  writeManifest({ state: 'running', url: server.url, port: Number(url.port) });
  log('info', 'local_simulation_ready', { url: server.url, manifestPath });
  process.stdout.write([
    '',
    'Amazon AI Ops 模拟工作台已启动（仅开发预览）',
    `浏览器地址：${server.url}`,
    `运行记录：${configuration.outputDirectory}`,
    '数据来源：memory-fixtures；非真实数据，刷新页面或重启会重置。',
    '本次模拟不代表 APP_READY。请保持此终端开启，按 Ctrl+C 关闭。',
    '',
  ].join('\n'));
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('uncaughtException', (error) => {
  log('error', 'local_simulation_uncaught_exception', { error: describeError(error) });
  void shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (error) => {
  log('error', 'local_simulation_unhandled_rejection', { error: describeError(error) });
  void shutdown('unhandledRejection', 1);
});

main().catch((error) => {
  log('error', 'local_simulation_start_failed', { error: describeError(error) });
  process.stderr.write('模拟工作台启动失败，请检查上方错误与运行日志。\n');
  void shutdown('startupFailure', 1);
});
