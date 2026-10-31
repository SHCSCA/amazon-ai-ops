import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINGXING_TEMPLATE_MANIFEST } from '@amazon-ai-ops/report-parser';
import { createReportParserWorkerClient, type ParserWorkerLike } from './report-parser-worker-client';
import { captureReportParserLimits, reportBytesSha256, type ReportParserTask, type ReportParserLimits } from './report-parser-worker-contracts';
import { testReportWorkerPath, testReportParserRuntime } from './report-parser-worker.test-support';

const directories: string[] = [];
const clients: ReturnType<typeof createReportParserWorkerClient>[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.stopAndDrain();
  for (const directory of directories.splice(0)) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir())) throw new Error('TEST_DIRECTORY_NOT_OWNED');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Main 来源快照的共享字节租约', () => {
  function boundedRuntime() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-client-')); directories.push(directory);
    const file = path.join(directory, 'input.csv'); fs.writeFileSync(file, 'h\nv');
    return { file, runtime: testReportParserRuntime({ 'report_parser_maxMainInputBytes:v1': '16',
      'report_parser_maxInputBytes:v1': '8', 'report_parser_shutdownTimeoutMs:v1': '50' }) };
  }
  it('不同 session 共用分配前预算，归还会清空原字节，双重归还不会释放其他租约', () => {
    const { runtime, file } = boundedRuntime(), first = runtime.createSession(), second = runtime.createSession();
    const a = first.read(file), b = second.read(file);
    expect(() => first.read(file)).toThrow('REPORT_PARSER_MAIN_INPUT_LIMIT');
    first.release(a); first.release(a); expect(a.bytes.byteLength).toBe(0);
    const c = first.read(file);
    expect(b.bytes.byteLength).toBe(3);
    expect(() => first.read(file)).toThrow('REPORT_PARSER_MAIN_INPUT_LIMIT');
    first.release(c); second.release(b);
    const all = first.reserveInputBytes(16); all(); all();
  });
  it('真实 Worker await 期间保持原快照额度，完成和取消后 finally 都能归还', async () => {
    const { runtime, file } = boundedRuntime(), session = runtime.createSession();
    const pending = session.preflight(file);
    expect(() => session.reserveInputBytes(16)).toThrow('REPORT_PARSER_MAIN_INPUT_LIMIT');
    await expect(pending).resolves.toEqual([['h'], ['v']]);
    session.reserveInputBytes(16)();
    const controller = new AbortController(), cancelled = session.preflight(file, controller.signal);
    controller.abort(); await expect(cancelled).rejects.toThrow('REPORT_PARSER_ABORTED');
    session.reserveInputBytes(16)();
  });
  it('捕获错误与真实 Worker 解析错误均归还额度，下一请求能继续', async () => {
    const { runtime, file } = boundedRuntime(), session = runtime.createSession();
    expect(() => session.read(file + '.missing')).toThrow();
    session.reserveInputBytes(16)();
    fs.writeFileSync(file, 'a,b\n1,2');
    const tight = testReportParserRuntime({ 'report_parser_maxMainInputBytes:v1': '8', 'report_parser_maxInputBytes:v1': '8',
      'report_parser_maxColumns:v1': '1' }).createSession();
    await expect(tight.preflight(file)).rejects.toThrow('REPORT_RESOURCE_LIMIT');
    tight.reserveInputBytes(8)();
    fs.writeFileSync(file, 'h\nv'); await expect(tight.preflight(file)).resolves.toEqual([['h'], ['v']]);
  });
  it('未归还原快照不能假装 drain，显式归还后才能完成关机', async () => {
    const { runtime, file } = boundedRuntime(), session = runtime.createSession(), snapshot = session.read(file);
    await expect(runtime.stopAndDrain()).rejects.toThrow('REPORT_PARSER_INPUT_DRAIN_TIMEOUT');
    expect(() => session.read(file)).toThrow('REPORT_PARSER_MAIN_INPUT_LIMIT');
    session.release(snapshot); await expect(runtime.stopAndDrain()).resolves.toBeUndefined();
  });
});
function limits(overrides: Partial<ReportParserLimits> = {}) { return { ...captureReportParserLimits(() => null), ...overrides }; }
function task(): ReportParserTask {
  const bytes = Uint8Array.from(Buffer.from('日期,店铺名称,国家,广告活动,曝光量,点击,花费-本币,广告订单,广告销售额-本币\n2026-01-02,Synthetic store,US,Campaign,100,4,3,1,10'));
  return { operation: 'preflight', files: [{ bytes, sourceName: 'synthetic.csv', sha256: reportBytesSha256(bytes) }] };
}
function fixture(source?: string, custom?: (request: any) => ParserWorkerLike) {
  let workerPath = testReportWorkerPath;
  if (source) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-client-')); directories.push(directory);
    workerPath = path.join(directory, 'worker.cjs');
    fs.writeFileSync(workerPath, `const {parentPort,workerData}=require('node:worker_threads');\n${source}`);
  }
  const logger = { error: vi.fn() }, exits: number[] = [];
  const client = createReportParserWorkerClient({ workerPath, logger, createWorker: custom ?? (request => {
    const worker = new Worker(workerPath, { workerData: request });
    worker.once('exit', code => exits.push(code)); return worker;
  }) });
  clients.push(client); return { client, logger, exits };
}
const response = `parentPort.postMessage({protocol:workerData.protocol,nonce:workerData.nonce,operation:workerData.task.operation,hashes:workerData.task.files.map(f=>f.sha256),payload:JSON.stringify([['header'],['value']])});`;

describe('bounded report parser Worker lifecycle', () => {
  it('关键词与 Listing 兼容解析也经真实 Worker 纯字节端口，不恢复退休入口', async () => {
    const { client, exits } = fixture();
    const keyword = Uint8Array.from(Buffer.from('ASIN,Search Term,Impressions,Clicks,Spend,Orders,Sales\nB012345678,Garlic Press,1000,50,25,5,125'));
    const parsed = await client.execute<any>({ operation: 'keyword', files: [{ bytes: keyword, sourceName: 'keyword.csv', sha256: reportBytesSha256(keyword) }],
      options: { source: 'search_term' } }, limits());
    expect(parsed.metrics).toEqual([expect.objectContaining({ asin: 'B012345678', normalizedKeyword: 'garlic press', cost: 25, acos: 0.2 })]);
    const listing = Uint8Array.from(Buffer.from('ASIN,Title,Bullet Points,A+,Image Copy,Backend Search Terms\nB012345678,Kitchen Press,Durable,Premium,Fast,kitchen tool'));
    await expect(client.execute({ operation: 'listing', files: [{ bytes: listing, sourceName: 'listing.csv', sha256: reportBytesSha256(listing) }] }, limits()))
      .resolves.toEqual({ asin: 'B012345678', title: 'Kitchen Press', bullets: ['Durable'], aPlus: 'Premium', imageCopy: 'Fast', backendTerms: 'kitchen tool' });
    expect(exits).toEqual([0, 0]);
  });
  it('runs the actual packaged-entry source parser and independent raw totals', async () => {
    const { client, exits } = fixture();
    const template = LINGXING_TEMPLATE_MANIFEST.find(row => row.reportType === 'campaign')!;
    const values: Record<string, unknown> = { '日期': '2026-01-02', '店铺名称': 'Synthetic store', '国家': 'US', '类型': 'SP', '广告活动': 'Campaign', '曝光量': 100, '点击': 4, '花费-本币': 3, '广告订单': 1, '广告销售额-本币': 10 };
    const bytes = Uint8Array.from(Buffer.from('\uFEFF' + template.headers.join(',') + '\n' + template.headers.map(header => values[header] ?? '').join(',')));
    const files = [{ bytes, sourceName: 'campaign.csv', sha256: reportBytesSha256(bytes) }] as [any];
    const parsed = await client.execute<any>({ operation: 'report', files, options: { reportType: 'campaign', requireRegisteredTemplate: true } }, limits());
    expect(parsed).toMatchObject({ success: true, schemaValid: true, totalRows: 1 });
    const totals = await client.execute<any>({ operation: 'control-totals', files, window: { dateStart: '2026-01-02', dateEnd: '2026-01-02' } }, limits());
    expect(totals).toEqual({ expectedRows: 1, expectedCost: 3 });
    const family = await client.execute<any>({ operation: 'family', files, levels: ['campaign'], scope: {
      schemaVersion: 1, provenanceLabel: 'user_confirmed_scope', familyLabel: 'Synthetic family',
      confirmationReference: 'synthetic-confirmation', storeName: 'Synthetic store', marketplaceCode: 'US',
      dateFrom: '2026-01-02', dateTo: '2026-01-02', files: [{ sha256: files[0].sha256, reportType: 'campaign', dateFrom: '2026-01-02', dateTo: '2026-01-02' }],
    } }, limits());
    expect(family).toMatchObject({ formalEligibility: false, nativeAsinAuthority: false, authority: 'campaign-only' });
    expect(family.days[0].campaign.metrics.cost).toBe(3);
    expect(exits).toEqual([0, 0, 0]);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
  it('preserves a real Worker resource rejection code/stage through the fixed safe diagnostic contract', async () => {
    const input = fixture();
    const request = task(); request.files[0].bytes = Uint8Array.from(Buffer.from('PRIVATE_COLUMN,another\nvalue,value'));
    request.files[0].sha256 = reportBytesSha256(request.files[0].bytes);
    const budget = limits(); budget.resource = { ...budget.resource, maxColumns: 1 };
    await expect(input.client.execute(request, budget)).rejects.toThrow('REPORT_RESOURCE_LIMIT');
    const diagnostic = input.logger.error.mock.calls.find(([event]) => event === 'report_parser.worker_diagnostic')?.[1] as any;
    expect(diagnostic.diagnostic).toMatchObject({ code: 'REPORT_RESOURCE_LIMIT' });
    expect(diagnostic.diagnostic.stage).not.toBe('parse');
    expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE_COLUMN');
  });
  it('rejects negative report validation counts returned by a real faulty Worker', async () => {
    const input = fixture(`parentPort.postMessage({protocol:workerData.protocol,nonce:workerData.nonce,operation:workerData.task.operation,
      hashes:workerData.task.files.map(f=>f.sha256),payload:JSON.stringify({success:true,schemaValid:true,data:[],totalRows:0,headers:['header'],
      sourceFile:workerData.task.files[0].sourceName,parsedAt:new Date().toISOString(),validation:{valid:true,errors:[],validCount:-1,invalidCount:0}})});`);
    const file = task().files[0];
    await expect(input.client.execute({ operation: 'report', files: [file] }, limits())).rejects.toThrow('REPORT_PARSER_RESULT_SCHEMA_INVALID');
  });
  it('rejects repeated source labels at the real production Worker result prebudget without waiting for heap OOM', async () => {
    const input = fixture();
    const template = LINGXING_TEMPLATE_MANIFEST.find(row => row.reportType === 'campaign')!;
    const values: Record<string, unknown> = { '日期': '2026-01-02', '店铺名称': 'Synthetic store', '国家': 'US', '类型': 'SP', '广告活动': 'Campaign', '曝光量': 100, '点击': 4, '花费-本币': 3, '广告订单': 1, '广告销售额-本币': 10 };
    const row = template.headers.map(header => values[header] ?? '').join(',');
    const bytes = Uint8Array.from(Buffer.from('\uFEFF' + template.headers.join(',') + '\n' + Array.from({ length: 100 }, () => row).join('\n')));
    await expect(input.client.execute({ operation: 'report', files: [{ bytes, sourceName: 'x'.repeat(2000) + '.csv', sha256: reportBytesSha256(bytes) }],
      options: { reportType: 'campaign', requireRegisteredTemplate: true } }, limits({ maxResultBytes: 32 * 1024 }))).rejects.toThrow('REPORT_PARSER_RESULT_LIMIT');
    const failures = input.logger.error.mock.calls.map(([, context]) => context as any);
    expect(failures.some(context => context.error?.code === 'ERR_WORKER_OUT_OF_MEMORY')).toBe(false);
  });
  it('rejects a real Worker preflight result beyond twelve header rows', async () => {
    const input = fixture(response.replace("[['header'],['value']]", 'Array.from({length:13},()=>["header"])'));
    await expect(input.client.execute(task(), limits())).rejects.toThrow('REPORT_PARSER_RESULT_SCHEMA_INVALID');
  });
  it('terminates a real busy loop at the timeout and waits for its actual exit before allowing another task', async () => {
    const input = fixture('while(true){}');
    await expect(input.client.execute(task(), limits({ timeoutMs: 100 }))).rejects.toThrow('REPORT_PARSER_TIMEOUT');
    expect(input.exits).toHaveLength(1);
    expect(input.exits[0]).not.toBe(0);
    expect(input.logger.error).toHaveBeenCalled();
  });
  it('enforces the production default spawn heap limit, observes real OOM exit and keeps Main usable for the next request', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-client-')); directories.push(directory);
    const workerPath = path.join(directory, 'default-worker.cjs');
    fs.writeFileSync(workerPath, `const {parentPort,workerData}=require('node:worker_threads');
      if(workerData.task.files[0].sourceName==='oom.csv'){const held=[];while(true)held.push(new Array(100000).fill('retained-heap'));}
      else {${response}}`);
    const logger = { error: vi.fn() };
    const client = createReportParserWorkerClient({ workerPath, logger }); clients.push(client);
    const input = task(); input.files[0].sourceName = 'oom.csv';
    await expect(client.execute(input, limits({ heapMb: 16, youngHeapMb: 4, stackMb: 1, timeoutMs: 5000 })))
      .rejects.toMatchObject({ code: 'ERR_WORKER_OUT_OF_MEMORY' });
    const failure = logger.error.mock.calls.find(([event]) => event === 'report_parser.worker_failed')?.[1] as any;
    expect(failure.error).toMatchObject({ code: 'ERR_WORKER_OUT_OF_MEMORY' });
    expect(failure.exitCode).not.toBe(0); expect(typeof failure.exitCode).toBe('number');
    await expect(client.execute(task(), limits())).resolves.toEqual([['header'], ['value']]);
    expect(input.files[0].bytes.byteLength).toBeGreaterThan(0);
  });
  it('cancels and drains a real worker, rejecting queued work and all work submitted after shutdown', async () => {
    const input = fixture('while(true){}');
    const running = input.client.execute(task(), limits()).catch(error => error);
    const queued = input.client.execute(task(), limits()).catch(error => error);
    await input.client.stopAndDrain();
    expect(await running).toMatchObject({ message: 'REPORT_PARSER_ABORTED' });
    expect(await queued).toMatchObject({ message: 'REPORT_PARSER_ABORTED' });
    expect(input.exits).toHaveLength(1);
    await expect(input.client.execute(task(), limits())).rejects.toThrow('REPORT_PARSER_ABORTED');
  });
  it.each([
    ['throw', 'throw new Error("synthetic worker failure")'], ['nonzero', 'process.exit(2)'], ['empty', 'parentPort.close()'],
    ['duplicate', response + response], ['invalid-shape', response.replace("[['header'],['value']]", '{}')],
    ['bad-json', response.replace('JSON.stringify([[\'header\'],[\'value\']])', '"{"')],
    ['oversized', response.replace('JSON.stringify([[\'header\'],[\'value\']])', '"x".repeat(5000)')],
    ['wrong-nonce', response.replace('nonce:workerData.nonce', 'nonce:"different"')],
  ])('rejects real worker failure %s and can process a later healthy request', async (_name, source) => {
    let calls = 0;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-client-')); directories.push(directory);
    const failed = path.join(directory, 'failed.cjs'), healthy = path.join(directory, 'healthy.cjs');
    fs.writeFileSync(failed, `const {parentPort,workerData}=require('node:worker_threads');${source}`);
    fs.writeFileSync(healthy, `const {parentPort,workerData}=require('node:worker_threads');${response}`);
    const input = fixture(undefined, request => new Worker(calls++ === 0 ? failed : healthy, { workerData: request }));
    await expect(input.client.execute(task(), limits({ maxResultBytes: 1024 }))).rejects.toBeInstanceOf(Error);
    await expect(input.client.execute(task(), limits())).resolves.toEqual([['header'], ['value']]);
  });
  it('retains the first error and logger/termination errors, bounds UI failure and refuses a false drain without exit', async () => {
    const worker = new EventEmitter() as EventEmitter & ParserWorkerLike;
    worker.terminate = vi.fn(async () => { throw new Error('synthetic termination failure'); });
    const input = fixture(undefined, () => worker);
    input.logger.error.mockImplementation(() => { throw new Error('synthetic logger failure'); });
    const result = input.client.execute(task(), limits({ timeoutMs: 20, shutdownTimeoutMs: 30 }));
    await expect(result).rejects.toBeInstanceOf(AggregateError);
    await expect(input.client.stopAndDrain()).rejects.toBeInstanceOf(AggregateError);
    worker.emit('exit', 1);
  });
});
