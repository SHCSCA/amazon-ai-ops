import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const pointOwnedScenarios = Object.freeze(['owned', 'foreignroot', 'threadReturn0', 'threadReturn0WithPid', 'pidmismatch', 'hitnull',
  'ancestor0', 'throwWindowFromPoint', 'throwGetAncestor', 'throwThreadPid', 'expiredTime']);
export const originalPointOwnedSha256 = 'b0cf1c2d6c3a6c4ec6e3e4a88ab355459b05eec43b04b87fc489cfb2d3f536af';
// 逐字保存原查询职责，用真实旧方法体与当前方法体执行同一组隔离端口。
export const originalPointOwned = `  static void PointOwned(Point point, IntPtr root, uint pid, DateTime deadline, Dictionary<string, object> result) {
    Time(deadline); var hit = WindowFromPoint(point);
    bool hitNull = hit == IntPtr.Zero;
    bool rootIsBound = !hitNull && GetAncestor(hit, 2) == root;
    uint hitPid = 0; bool pointOwnerIsBoundMain = !hitNull && GetWindowThreadProcessId(hit, out hitPid) != 0 && hitPid == pid;
    result["hitNull"] = hitNull; result["rootIsBound"] = rootIsBound; result["pointOwnerIsBoundMain"] = pointOwnerIsBoundMain;
    Require(!hitNull && rootIsBound && pointOwnerIsBoundMain, "UI_CAPTION_POINT_NOT_OWNED");
  }`;
export const methodSha256 = value => createHash('sha256').update(value).digest('hex');
export function extractPointOwned(source) {
  const marker = '  static void PointOwned(', start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) >= 0) throw new Error('UI_CAPTION_POINT_MODEL_METHOD_REQUIRED');
  const open = source.indexOf('{', start);
  let depth = 0, quoted = false, escaped = false;
  for (let at = open; at < source.length; at++) {
    const char = source[at];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, at + 1);
  }
  throw new Error('UI_CAPTION_POINT_MODEL_METHOD_INCOMPLETE');
}
function modelClass(name, method) {
  return `public sealed class ${name} : V16PointOwnedHarness {
${method}
  public static Dictionary<string,object> Run(string scenario) { return Execute(scenario, PointOwned); }
}`;
}
function fakeSource(method) {
  return `using System;
using System.Collections.Generic;
public class V16PointOwnedHarness {
  public struct Point { public int X, Y; }
  static string Scenario;
  static List<string> Trace;
  static Exception FirstError;
  static int WindowCalls, AncestorCalls, OwnerCalls;
  static readonly IntPtr BoundRoot = new IntPtr(111);
  const uint BoundPid = 1234;
  protected static void Require(bool ok, string reason) {
    Trace.Add("Require:" + reason + ":" + (ok ? "true" : "false"));
    if (!ok) { var error = new InvalidOperationException(reason); if (FirstError == null) FirstError = error; throw error; }
  }
  protected static void Time(DateTime deadline) {
    Trace.Add("Time"); Require(DateTime.UtcNow < deadline, "UI_CAPTION_DEADLINE");
  }
  static void ThrowFirst(string reason) {
    var error = new InvalidOperationException(reason); FirstError = error; throw error;
  }
  protected static IntPtr WindowFromPoint(Point point) {
    WindowCalls++; Trace.Add("WindowFromPoint:" + point.X + ":" + point.Y);
    if (Scenario == "throwWindowFromPoint") ThrowFirst("UNIT_WINDOW_FROM_POINT_FAILED");
    return Scenario == "hitnull" ? IntPtr.Zero : new IntPtr(222);
  }
  protected static IntPtr GetAncestor(IntPtr hit, uint flags) {
    AncestorCalls++; Trace.Add("GetAncestor:" + hit.ToInt64() + ":" + flags);
    if (Scenario == "throwGetAncestor") ThrowFirst("UNIT_GET_ANCESTOR_FAILED");
    return Scenario == "ancestor0" ? IntPtr.Zero : Scenario == "foreignroot" ? new IntPtr(333) : BoundRoot;
  }
  protected static uint GetWindowThreadProcessId(IntPtr hit, out uint pid) {
    OwnerCalls++; Trace.Add("GetWindowThreadProcessId:" + hit.ToInt64());
    if (Scenario == "throwThreadPid") ThrowFirst("UNIT_THREAD_PID_FAILED");
    pid = Scenario == "threadReturn0" ? 0 : Scenario == "pidmismatch" || Scenario == "threadReturn0WithPid" ? 4321 : BoundPid;
    return Scenario == "threadReturn0" || Scenario == "threadReturn0WithPid" ? 0U : 77U;
  }
  protected static Dictionary<string,object> Execute(string scenario,
    Action<Point,IntPtr,uint,DateTime,Dictionary<string,object>> action) {
    Scenario = scenario; Trace = new List<string>(); FirstError = null; WindowCalls = 0; AncestorCalls = 0; OwnerCalls = 0;
    var result = new Dictionary<string,object>(); Exception caught = null; bool returned = false;
    var deadline = DateTime.UtcNow.AddDays(scenario == "expiredTime" ? -1 : 1);
    try { action(new Point { X = 979, Y = 236 }, BoundRoot, BoundPid, deadline, result); returned = true; }
    catch (Exception error) { caught = error; }
    return new Dictionary<string,object> { {"scenario", scenario}, {"returned", returned}, {"result", result},
      {"trace", Trace.ToArray()}, {"firstErrorPreserved", Object.ReferenceEquals(caught, FirstError)},
      {"error", caught == null ? null : new Dictionary<string,object> { {"type", caught.GetType().Name}, {"code", caught.Message} }},
      {"counts", new Dictionary<string,object> { {"WindowFromPoint", WindowCalls}, {"GetAncestor", AncestorCalls}, {"GetWindowThreadProcessId", OwnerCalls} }} };
  }
}
${modelClass('V16PointOwnedOriginalModel', originalPointOwned)}
${modelClass('V16PointOwnedCurrentModel', method)}
public static class V16PointOwnedMechanismProbe {
  public static Dictionary<string,object> Run() {
    var rows = new List<object>();
    foreach (var scenario in new string[] { ${pointOwnedScenarios.map(value => '"' + value + '"').join(',')} }) {
      rows.Add(new Dictionary<string,object> { {"scenario", scenario},
        {"original", V16PointOwnedOriginalModel.Run(scenario)}, {"current", V16PointOwnedCurrentModel.Run(scenario)} });
    }
    return new Dictionary<string,object> { {"rows", rows}, {"isolatedModel", true}, {"realWinApiInvoked", false}, {"activateInvoked", false} };
  }
}`;
}
export function runPointOwnedModels(source) {
  if (methodSha256(originalPointOwned) !== originalPointOwnedSha256) throw new Error('UI_CAPTION_POINT_MODEL_ORIGINAL_CHANGED');
  const method = extractPointOwned(source), driver = fakeSource(method), systemRoot = process.env.SystemRoot;
  if (!systemRoot || !path.isAbsolute(systemRoot)) throw new Error('UI_CAPTION_POINT_MODEL_SYSTEM_ROOT_REQUIRED');
  const command = `$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
  $driver=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(driver).toString('base64')}'))
  Add-Type -TypeDefinition $driver -Language CSharp
  [Console]::Out.WriteLine(([V16PointOwnedMechanismProbe]::Run()|ConvertTo-Json -Depth 12 -Compress))
}catch{
  [Console]::Error.WriteLine('{"level":"error","event":"v16.caption_point_owned_model_failed","code":"ISOLATED_METHOD_COMPILE_OR_RUN_FAILED"}')
  exit 1
}`;
  const child = spawnSync(path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, PSModulePath: '' }, timeout: 10000, maxBuffer: 1024 * 1024 });
  if (child.error || child.status !== 0 || child.signal !== null) {
    console.error(JSON.stringify({ level: 'error', event: 'v16.caption_point_owned_model_child_failed',
      status: child.status, signal: child.signal, error: child.error?.code || null }));
  }
  let report = null;
  if (!child.error && child.status === 0 && child.signal === null) {
    try { report = JSON.parse(child.stdout.trim()); }
    catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'v16.caption_point_owned_model_report_failed', code: error.name }));
      throw error;
    }
  }
  return { child, report, driver, originalMethod: originalPointOwned, method,
    originalMethodSha256: methodSha256(originalPointOwned), currentMethodSha256: methodSha256(method) };
}
