import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';

const sourcePath = path.resolve('scripts/v16-ui-owned-caption-native.cs');
const extents = [2, 1920, 1440, 2560, 3840, 7680];
const screens = extents.flatMap(extent => [0, -extent, 127].map(origin => ({ origin, extent })));
const known = [[0, 0, 1920, 17], [1, 0, 1920, 51], [979, 0, 1920, 33433], [980, 0, 1920, 33467],
  [1919, 0, 1920, 65518], [265, 0, 1440, 12083], [1439, 0, 1440, 65513], [-1920, -1920, 3840, 8],
  [-1, -1920, 3840, 32759], [1919, -1920, 3840, 65527], [0, 0, 2, 16384], [1, 0, 2, 49152],
  [-2147483648, -2147483648, 2, 16384], [-2147483647, -2147483648, 2, 49152], [2147483647, 2147483646, 2, 49152]];
const invalid = [[0, 0, 0], [0, 0, 1], [0, 0, -1], [0, 0, -2147483648], [-1, 0, 1920], [1920, 0, 1920],
  [-1921, -1920, 1920], [0, -1920, 1920], [2147483647, -2147483648, 2147483647], [-2147483648, 2147483647, 2]];
const rows = values => values.map(value => 'new int[]{' + value.join(',') + '}').join(',');
const driver = `
public static class V16CaptionCoordinatePureProbe {
  public static System.Collections.Generic.Dictionary<string,object> Run() {
    var report = new System.Collections.Generic.Dictionary<string,object>();
    var screens = new int[][] { ${rows(screens.map(value => [value.origin, value.extent]))} };
    var exhaustive = new System.Collections.Generic.List<object>();
    foreach (var screen in screens) {
      int origin=screen[0], extent=screen[1], failures=0, first=-1, firstNormalized=-1;
      long firstBack=0; int min=65536, max=-1;
      for(int offset=0;offset<extent;offset++) {
        int point=origin+offset, normalized=V16OwnedCaption.NormalizeAbsoluteCoordinate(point,origin,extent);
        long back=(long)origin+(long)System.Math.Floor(normalized*(double)extent/65536.0);
        if(normalized<min) min=normalized; if(normalized>max) max=normalized;
        if(back!=point || normalized<0 || normalized>65535) {
          failures++; if(first<0) {first=offset;firstNormalized=normalized;firstBack=back;}
        }
      }
      exhaustive.Add(new System.Collections.Generic.Dictionary<string,object>{{"origin",origin},{"extent",extent},{"visited",extent},
        {"failures",failures},{"firstMismatchOffset",first},{"firstNormalized",firstNormalized},{"firstBack",firstBack},{"min",min},{"max",max}});
    }
    var known = new int[][] { ${rows(known)} };
    var actual = new System.Collections.Generic.List<int>();
    foreach(var value in known) actual.Add(V16OwnedCaption.NormalizeAbsoluteCoordinate(value[0],value[1],value[2]));
    var invalid = new int[][] { ${rows(invalid)} };
    var rejected = new System.Collections.Generic.List<object>();
    foreach(var value in invalid) {
      bool refused=false; string type=null, code=null;
      try { V16OwnedCaption.NormalizeAbsoluteCoordinate(value[0],value[1],value[2]); }
      catch(System.Exception error) { type=error.GetType().Name;code=error.Message;refused=error is System.InvalidOperationException; }
      rejected.Add(new System.Collections.Generic.Dictionary<string,object>{{"rejected",refused},{"type",type},{"code",code}});
    }
    report["exhaustive"]=exhaustive;report["known"]=actual;report["invalid"]=rejected;
    report["pureMethodOnly"]=true;report["activateInvoked"]=false;report["winApiInvoked"]=false;
    return report;
  }
}`;
let source, result;
beforeAll(() => {
  // 编译完整真实职责源，只调用独立纯方法；绝不调用窗口激活或任何原生 API。
  source = fs.readFileSync(sourcePath, 'utf8');
  const sha256 = createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !path.isAbsolute(systemRoot)) throw new Error('UI_CAPTION_COORDINATE_SYSTEM_ROOT_REQUIRED');
  const quote = value => value.replaceAll("'", "''");
  const command = `$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
  $bytes=[IO.File]::ReadAllBytes('${quote(sourcePath)}')
  $hash=[Security.Cryptography.SHA256]::Create()
  try {$sha=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
  $source=[Text.Encoding]::UTF8.GetString($bytes)
  $driver=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(driver).toString('base64')}'))
  Add-Type -TypeDefinition ($source+[Environment]::NewLine+$driver) -Language CSharp
  $report=[V16CaptionCoordinatePureProbe]::Run();$report['compiledSourceSha256']=$sha
  [Console]::Out.WriteLine(($report|ConvertTo-Json -Depth 8 -Compress))
}catch{
  [Console]::Error.WriteLine('{"level":"error","event":"v16.caption_coordinate_pure_probe_failed","code":"COMPILE_OR_PURE_METHOD_FAILED"}')
  exit 1
}`;
  const child = spawnSync(path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, PSModulePath: '' }, timeout: 10000, maxBuffer: 1024 * 1024 });
  if (child.error || child.status !== 0 || child.signal !== null) {
    console.error(JSON.stringify({ level: 'error', event: 'v16.caption_coordinate_compile_failed', code: 'PURE_COMPILE_CHILD_FAILED', status: child.status, signal: child.signal }));
  }
  expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
  result = JSON.parse(child.stdout.trim()); expect(result.compiledSourceSha256).toBe(sha256);
  expect(result).toMatchObject({ pureMethodOnly: true, activateInvoked: false, winApiInvoked: false });
  console.info(JSON.stringify({ level: 'info', event: 'v16.caption_coordinate_pure_probe_observed', compiledSourceSha256: result.compiledSourceSha256,
    visitedPixels: result.exhaustive.reduce((sum, value) => sum + value.visited, 0), screens: result.exhaustive.length,
    known: result.known.length, invalid: result.invalid.length, activateInvoked: false, winApiInvoked: false }));
});

describe('真实完整C#绝对坐标纯方法', () => {
  it.each(screens.map((value, index) => ({ ...value, index })))('origin=$origin extent=$extent全部像素严格回映', ({ origin, extent, index }) => {
    expect(result.exhaustive[index]).toMatchObject({ origin, extent, visited: extent, failures: 0, firstMismatchOffset: -1 });
    expect(result.exhaustive[index].min).toBeGreaterThanOrEqual(0); expect(result.exhaustive[index].max).toBeLessThanOrEqual(65535);
  });
  it.each(known.map((value, index) => ({ point: value[0], origin: value[1], extent: value[2], expected: value[3], index })))
  ('point=$point origin=$origin extent=$extent像素中心已知值', ({ expected, index }) => { expect(result.known[index]).toBe(expected); });
  it.each(invalid.map((value, index) => ({ point: value[0], origin: value[1], extent: value[2], index })))
  ('point=$point origin=$origin extent=$extent无效范围拒绝', ({ index }) => {
    expect(result.invalid[index]).toEqual({ rejected: true, type: 'InvalidOperationException', code: 'UI_CAPTION_VIRTUAL_SCREEN_INVALID' });
  });
  it('纯方法不调用窗口或输入API', () => {
    const method = source.match(/public static int NormalizeAbsoluteCoordinate\([^]*?\n  \}/)?.[0];
    expect(method).toBeTypeOf('string'); expect(method).not.toMatch(/\b(?:Activate|SendInput|Get\w*|Set\w*)\s*\(/);
    expect([...driver.matchAll(/V16OwnedCaption\.(\w+)/g)].map(value => value[1])).toEqual(Array(3).fill('NormalizeAbsoluteCoordinate'));
  });
  it('保留严格坐标回读和唯一三输入，未引入容差重试', () => {
    expect(source).toContain('bool cursorMatches=actual.X==point.X && actual.Y==point.Y;');
    expect(source.match(/SendInput\(3,inputs,inputSize\)/g)).toHaveLength(1);
    expect(source).toContain('Require(width>1 && height>1 && point.X>=left && point.X<left+width && point.Y>=top && point.Y<top+height, "UI_CAPTION_VIRTUAL_SCREEN_INVALID");');
  });
});

describe('真实PointOwned方法体的隔离查询机制', () => {
  let model;
  const completed = ['owned', 'foreignroot', 'threadReturn0', 'threadReturn0WithPid', 'pidmismatch', 'hitnull', 'ancestor0'];
  const failedEarly = ['throwWindowFromPoint', 'throwGetAncestor', 'throwThreadPid', 'expiredTime'];
  const all = [...completed, ...failedEarly];
  const row = scenario => model.report.rows.find(value => value.scenario === scenario);
  const legacy = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'pointOwnershipQuery'));
  const expectedCounts = scenario => ({ WindowFromPoint: scenario === 'expiredTime' ? 0 : 1,
    GetAncestor: ['expiredTime', 'hitnull', 'throwWindowFromPoint'].includes(scenario) ? 0 : 1,
    GetWindowThreadProcessId: ['expiredTime', 'hitnull', 'throwWindowFromPoint', 'throwGetAncestor'].includes(scenario) ? 0 : 1 });
  function expectedTrace(scenario) {
    const trace = ['Time', 'Require:UI_CAPTION_DEADLINE:' + (scenario === 'expiredTime' ? 'false' : 'true')];
    if (scenario === 'expiredTime') return trace;
    trace.push('WindowFromPoint:979:236'); if (scenario === 'throwWindowFromPoint') return trace;
    if (scenario !== 'hitnull') {
      trace.push('GetAncestor:222:2'); if (scenario === 'throwGetAncestor') return trace;
      trace.push('GetWindowThreadProcessId:222'); if (scenario === 'throwThreadPid') return trace;
    }
    trace.push('Require:UI_CAPTION_POINT_NOT_OWNED:' + (scenario === 'owned' ? 'true' : 'false')); return trace;
  }
  beforeAll(async () => {
    const support = await import('./test-support/v16-caption-point-owned-model.mjs');
    model = support.runPointOwnedModels(source);
    expect(model.child.error).toBeUndefined(); expect(model.child.signal).toBeNull();
    expect(model.child.status, model.child.stderr).toBe(0);
    expect(model.originalMethodSha256).toBe(support.originalPointOwnedSha256);
    expect(model.currentMethodSha256).toBe(createHash('sha256').update(support.extractPointOwned(source)).digest('hex'));
    expect(model.report).toMatchObject({ isolatedModel: true, activateInvoked: false, realWinApiInvoked: false });
    expect(model.report.rows.map(value => value.scenario)).toEqual(all);
    console.info(JSON.stringify({ level: 'info', event: 'v16.caption_point_owned_model_observed',
      originalMethodSha256: model.originalMethodSha256, currentMethodSha256: model.currentMethodSha256,
      scenarios: model.report.rows.length, activateInvoked: false, realWinApiInvoked: false }));
  });
  it('原版与当前版均由完整真实PointOwned方法体编译执行', () => {
    expect(model.driver).toContain(model.originalMethod); expect(model.driver).toContain(model.method);
    expect(model.originalMethodSha256).toBe('b0cf1c2d6c3a6c4ec6e3e4a88ab355459b05eec43b04b87fc489cfb2d3f536af');
  });
  it.each(all)('%s保留原查询次序、次数、短路、布尔门和首错对象', scenario => {
    const value = row(scenario), { original, current } = value;
    expect(current.trace).toEqual(original.trace); expect(current.trace).toEqual(expectedTrace(scenario));
    expect(current.counts).toEqual(original.counts); expect(current.counts).toEqual(expectedCounts(scenario));
    expect(current.returned).toBe(original.returned); expect(current.error).toEqual(original.error);
    expect(legacy(current.result)).toEqual(original.result);
    expect(original.firstErrorPreserved).toBe(true); expect(current.firstErrorPreserved).toBe(true);
    expect(current.returned).toBe(scenario === 'owned');
    if (!failedEarly.includes(scenario)) expect(current.error).toEqual(scenario === 'owned' ? null
      : { type: 'InvalidOperationException', code: 'UI_CAPTION_POINT_NOT_OWNED' });
  });
  it.each(completed)('%s报告只保存原三次查询实际操作数及执行标记', scenario => {
    expect(row(scenario).current.result.pointOwnershipQuery).toEqual({
      kind: 'v16-caption-point-ownership-query', schemaVersion: 1,
      hitHwnd: scenario === 'hitnull' ? '0' : '222', rootHwnd: '111',
      hitRootHwnd: ['hitnull', 'ancestor0'].includes(scenario) ? '0' : scenario === 'foreignroot' ? '333' : '111',
      threadId: ['hitnull', 'threadReturn0', 'threadReturn0WithPid'].includes(scenario) ? 0 : 77,
      hitPid: ['hitnull', 'threadReturn0'].includes(scenario) ? 0 : ['pidmismatch', 'threadReturn0WithPid'].includes(scenario) ? 4321 : 1234,
      ancestorQueryExecuted: scenario !== 'hitnull', ownerQueryExecuted: scenario !== 'hitnull',
    });
  });
  it.each(failedEarly)('%s沿原抛错边界退出且不补造未完成报告', scenario => {
    const value = row(scenario);
    const codes = { throwWindowFromPoint: 'UNIT_WINDOW_FROM_POINT_FAILED', throwGetAncestor: 'UNIT_GET_ANCESTOR_FAILED',
      throwThreadPid: 'UNIT_THREAD_PID_FAILED', expiredTime: 'UI_CAPTION_DEADLINE' };
    expect(value.current.error).toEqual({ type: 'InvalidOperationException', code: codes[scenario] });
    expect(value.current.result).toEqual({}); expect(value.original.result).toEqual({});
    expect(value.current.firstErrorPreserved).toBe(true);
  });
  it('线程查询返回零与成功查询到不同PID在同一拒绝门下仍可区分', () => {
    expect(row('threadReturn0').current.result.pointOwnershipQuery).toMatchObject({ threadId: 0, hitPid: 0, ownerQueryExecuted: true });
    expect(row('threadReturn0WithPid').current.result.pointOwnershipQuery).toMatchObject({ threadId: 0, hitPid: 4321, ownerQueryExecuted: true });
    expect(row('pidmismatch').current.result.pointOwnershipQuery).toMatchObject({ threadId: 77, hitPid: 4321, ownerQueryExecuted: true });
    expect(row('hitnull').current.result.pointOwnershipQuery).toMatchObject({ threadId: 0, hitPid: 0, ownerQueryExecuted: false });
  });
  it('机制模型没有原生声明且不调用Activate或输入出口', () => {
    expect(model.driver).not.toMatch(/DllImport|SendInput|Activate\s*\(/);
    expect(model.report.activateInvoked).toBe(false); expect(model.report.realWinApiInvoked).toBe(false);
  });
});
