import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { beforeAll, afterAll } from 'vitest';
import { createReportParserRuntime } from './report-parser-runtime';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-parser-worker-'));
export const testReportWorkerPath = path.join(root, 'report-parser-worker.cjs');
const runtimes: ReturnType<typeof createReportParserRuntime>[] = [];
beforeAll(() => {
  const { buildSync } = createRequire(path.resolve(__dirname, '../../package.json'))('esbuild');
  buildSync({ entryPoints: [path.join(__dirname, 'report-parser-worker.ts')], outfile: testReportWorkerPath,
    bundle: true, platform: 'node', target: 'node22', format: 'cjs', logLevel: 'silent' });
});
afterAll(async () => {
  for (const runtime of runtimes) await runtime.stopAndDrain();
  const temporaryRoot = path.resolve(os.tmpdir()), resolved = path.resolve(root);
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith('report-parser-worker-')) throw new Error('TEST_WORKER_DIRECTORY_NOT_OWNED');
  fs.rmSync(resolved, { recursive: true, force: true });
});
export function testReportParserRuntime(configuration: Record<string, string> = {}) {
  const runtime = createReportParserRuntime({ mainModulePath: path.join(root, 'index.cjs'),
    getConfigurationBus: () => ({ get: key => configuration[key] ?? null }) });
  runtimes.push(runtime);
  return runtime;
}
export function testReportParserSession(configuration: Record<string, string> = {}) {
  return testReportParserRuntime(configuration).createSession();
}
