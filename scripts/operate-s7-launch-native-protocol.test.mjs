// 按证据职责拆分夹具与验收断言，测试仍归属原有入口。
import { EXCLUSIVE_WINDOW_HELPER_BOOTSTRAP, createInterface, defaultProtectWindowsDirectory, defaultProtectWindowsFile, describe, expect, fs, it, os, path, require, resolveTrustedWindowsPowerShell, spawn, spawnSync } from './s7-launch-operator-test-environment.mjs';
import { gateArtifact, gateBinding, sha, write } from './s7-launch-operator-test-artifacts.mjs';
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
describe('operate-s7-live-migration-launch', () => {
it.runIf(process.platform === 'win32')('runs the native CREATE_SUSPENDED -> SPAWNED -> RESUMED -> CLOSED chain only against a synthetic target and DB', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's7-helper-ready-'));
    const db = path.join(root, 'synthetic.db');
    const fakeExe = path.join(root, `S7T-${process.pid}.exe`);
    write(db, 'synthetic-exclusive-db');
    const targetSource = String.raw `
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

public static class S7SyntheticTarget {
  [StructLayout(LayoutKind.Sequential)]
  public struct FILETIME { public UInt32 Low; public UInt32 High; }

  [StructLayout(LayoutKind.Sequential)]
  public struct BY_HANDLE_FILE_INFORMATION {
    public UInt32 FileAttributes;
    public FILETIME CreationTime;
    public FILETIME LastAccessTime;
    public FILETIME LastWriteTime;
    public UInt32 VolumeSerialNumber;
    public UInt32 FileSizeHigh;
    public UInt32 FileSizeLow;
    public UInt32 NumberOfLinks;
    public UInt32 FileIndexHigh;
    public UInt32 FileIndexLow;
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetFileInformationByHandle(
    SafeFileHandle handle,
    out BY_HANDLE_FILE_INFORMATION information
  );

  private static Dictionary<string, object> ObjectAt(
    Dictionary<string, object> value,
    string key
  ) {
    return (Dictionary<string, object>)value[key];
  }

  private static Dictionary<string, object> Artifact(string filePath) {
    using (FileStream stream = File.Open(
      filePath,
      FileMode.Open,
      FileAccess.Read,
      FileShare.Read | FileShare.Delete
    )) {
      BY_HANDLE_FILE_INFORMATION information;
      if (!GetFileInformationByHandle(stream.SafeFileHandle, out information)) {
        throw new System.ComponentModel.Win32Exception();
      }
      UInt64 fileId = ((UInt64)information.FileIndexHigh << 32) | information.FileIndexLow;
      string hash;
      using (SHA256 sha = SHA256.Create()) {
        hash = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
      }
      return new Dictionary<string, object> {
        { "realPath", Path.GetFullPath(filePath) },
        { "sha256", hash },
        { "sizeBytes", stream.Length },
        { "identity", new Dictionary<string, object> {
          { "deviceId", ((UInt64)information.VolumeSerialNumber).ToString() },
          { "fileId", fileId.ToString() },
          { "hardLinkCount", (int)information.NumberOfLinks }
        }}
      };
    }
  }

  private static void ProtectFile(string filePath) {
    SecurityIdentifier current = WindowsIdentity.GetCurrent().User;
    SecurityIdentifier system = new SecurityIdentifier("S-1-5-18");
    SecurityIdentifier admins = new SecurityIdentifier("S-1-5-32-544");
    FileSecurity acl = new FileSecurity();
    acl.SetOwner(current);
    acl.SetAccessRuleProtection(true, false);
    foreach (SecurityIdentifier sid in new [] { current, system, admins }) {
      acl.AddAccessRule(new FileSystemAccessRule(
        sid,
        FileSystemRights.FullControl,
        InheritanceFlags.None,
        PropagationFlags.None,
        AccessControlType.Allow
      ));
    }
    new FileInfo(filePath).SetAccessControl(acl);
  }

  private static void WriteExclusiveJson(
    string filePath,
    Dictionary<string, object> value,
    JavaScriptSerializer serializer
  ) {
    byte[] bytes = new UTF8Encoding(false).GetBytes(serializer.Serialize(value) + Environment.NewLine);
    using (FileStream stream = File.Open(
      filePath,
      FileMode.CreateNew,
      FileAccess.Write,
      FileShare.None
    )) {
      stream.Write(bytes, 0, bytes.Length);
      stream.Flush(true);
    }
    ProtectFile(filePath);
  }

  private static string ReadPublishedJson(
    string filePath, Stopwatch wait, int maximumWaitMs, out int conflicts, out int lastHResult
  ) {
    conflicts = 0; lastHResult = 0;
    while (wait.ElapsedMilliseconds < maximumWaitMs) {
      if (File.Exists(filePath)) {
        try { return File.ReadAllText(filePath, new UTF8Encoding(false)); }
        catch (IOException error) {
          // 仅发布句柄尚未释放的共享/锁冲突可等待；内容与权限错误继续失败。
          if (error.HResult != unchecked((int)0x80070020) && error.HResult != unchecked((int)0x80070021)) throw;
          conflicts++; lastHResult = error.HResult;
        }
      }
      System.Threading.Thread.Sleep(25);
    }
    throw new TimeoutException("handoff-release-timeout");
  }

  private static Dictionary<string, object> ProbePublishedRead(string directory, JavaScriptSerializer serializer) {
    string probePath = Path.Combine(directory, "SYNTHETIC-PUBLISH-PROBE-" + Guid.NewGuid().ToString("N") + ".json");
    byte[] bytes = new UTF8Encoding(false).GetBytes("{");
    int conflicts = 0, lastHResult = 0; bool timedOut = false;
    Stopwatch heldWait = new Stopwatch();
    using (FileStream held = File.Open(probePath, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
      held.Write(bytes, 0, bytes.Length); held.Flush(true); heldWait.Start();
      try { ReadPublishedJson(probePath, heldWait, 100, out conflicts, out lastHResult); }
      catch (TimeoutException) { timedOut = true; }
      if (!timedOut || conflicts < 1 || heldWait.ElapsedMilliseconds < 100
        || (lastHResult != unchecked((int)0x80070020) && lastHResult != unchecked((int)0x80070021))) {
        throw new Exception("synthetic-held-share-probe-failed");
      }
    }
    int reopenedConflicts, reopenedHResult;
    string malformed = ReadPublishedJson(probePath, Stopwatch.StartNew(), 100, out reopenedConflicts, out reopenedHResult);
    if (malformed != "{" || reopenedConflicts != 0 || reopenedHResult != 0) throw new Exception("synthetic-reopened-read-failed");
    int deserializeAttempts = 0; bool invalidRejected = false;
    try { deserializeAttempts++; serializer.DeserializeObject(malformed); }
    catch (ArgumentException) { invalidRejected = true; }
    if (!invalidRejected || deserializeAttempts != 1) throw new Exception("synthetic-invalid-json-retry-detected");
    return new Dictionary<string, object> {
      { "kind", "s7-synthetic-native-publication-read-probe" }, { "formalAcceptanceEvidence", false },
      { "heldTimeoutMs", 100 }, { "heldElapsedMs", heldWait.ElapsedMilliseconds },
      { "heldConflicts", conflicts }, { "heldHResult", lastHResult }, { "timedOutWhileHeld", timedOut },
      { "reopenedConflicts", reopenedConflicts }, { "invalidJsonAttempts", deserializeAttempts }, { "invalidJsonRejected", invalidRejected }
    };
  }

  [STAThread]
  public static void Main() {
    try { Run(); }
    catch (Exception error) {
      // 只保存合成进程失败原件并重抛，不重试业务或改变退出语义。
      try {
        string activePath = Encoding.UTF8.GetString(Convert.FromBase64String(Environment.GetEnvironmentVariable("AAO_S7_STARTUP_GATE_ACTIVE_PATH_B64")));
        var diagnostic = new Dictionary<string, object> {
          { "timestamp", DateTime.UtcNow.ToString("o") }, { "level", "error" }, { "event", "development.s7_synthetic_target_failed" },
          { "context", new Dictionary<string, object> { { "type", error.GetType().FullName }, { "hResult", error.HResult },
            { "message", error.Message }, { "stack", error.StackTrace } } }
        };
        string json = new JavaScriptSerializer().Serialize(diagnostic);
        File.WriteAllText(Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(activePath)), "SYNTHETIC-ERROR.json"), json, new UTF8Encoding(false));
        Console.Error.WriteLine(json);
      } catch (Exception diagnosticError) {
        try {
          Console.Error.WriteLine(new JavaScriptSerializer().Serialize(new Dictionary<string, object> {
            { "timestamp", DateTime.UtcNow.ToString("o") }, { "level", "error" }, { "event", "development.s7_synthetic_diagnostic_failed" },
            { "context", new Dictionary<string, object> { { "originalError", error.ToString() }, { "diagnosticError", diagnosticError.ToString() } } }
          }));
        } catch (Exception streamError) { throw new AggregateException("synthetic diagnostic outputs failed", error, diagnosticError, streamError); }
        throw new AggregateException("synthetic diagnostic failed", error, diagnosticError);
      }
      throw;
    }
  }

  private static void Run() {
    JavaScriptSerializer serializer = new JavaScriptSerializer();
    string activePath = Encoding.UTF8.GetString(Convert.FromBase64String(
      Environment.GetEnvironmentVariable("AAO_S7_STARTUP_GATE_ACTIVE_PATH_B64")
    ));
    Dictionary<string, object> active = (Dictionary<string, object>)
      serializer.DeserializeObject(File.ReadAllText(activePath, new UTF8Encoding(false)));
    Dictionary<string, object> paths = ObjectAt(active, "paths");
    Dictionary<string, object> bindings = ObjectAt(active, "bindings");
    Dictionary<string, object> package = ObjectAt(bindings, "package");
    Dictionary<string, object> database = ObjectAt(bindings, "database");
    string databasePath = (string)database["realPath"];
    string boundPath = (string)paths["bound"];
    string handoffReadyPath = (string)paths["handoffReady"];
    string handoffReleasedPath = (string)paths["handoffReleased"];
    string admissionPath = (string)paths["admission"];
    string resultPath = Path.Combine(Path.GetDirectoryName(activePath), "SYNTHETIC-RESULT.json");
    bool helperPrivateEnvironmentAbsent =
      Environment.GetEnvironmentVariable("AAO_S7_EXCLUSIVE_DB_B64") == null &&
      Environment.GetEnvironmentVariable("AAO_S7_EXECUTABLE_B64") == null &&
      Environment.GetEnvironmentVariable("AAO_S7_WORKING_DIRECTORY_B64") == null;
    Dictionary<string, object> handoffReady = new Dictionary<string, object> {
      { "kind", "s7-main-startup-handoff-ready" },
      { "schemaVersion", "s7-main-startup-handoff-ready/v1" },
      { "status", "READY_FOR_DB_HANDOFF" },
      { "readyAt", DateTime.UtcNow.ToString("o") },
      { "pid", Process.GetCurrentProcess().Id },
      { "gateId", (string)active["gateId"] },
      { "invocationId", (string)active["invocationId"] },
      { "singleInstanceLockAcquired", true },
      { "canonicalUserDataDir", (string)active["canonicalUserDataDir"] },
      { "activeGate", Artifact(activePath) },
      { "boundGate", Artifact(boundPath) },
      { "executable", ObjectAt(bindings, "executable") },
      { "main", ObjectAt(package, "main") },
      { "intent", ObjectAt(bindings, "intent") },
      { "package", package },
      { "shell", ObjectAt(bindings, "shell") }
    };
    Dictionary<string, object> readProbe = ProbePublishedRead(Path.GetDirectoryName(Path.GetDirectoryName(activePath)), serializer);
    string readProbePath = Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(activePath)), "SYNTHETIC-PUBLISH-READ.json");
    File.WriteAllText(readProbePath, serializer.Serialize(readProbe), new UTF8Encoding(false));
    WriteExclusiveJson(handoffReadyPath, handoffReady, serializer);
    Stopwatch handoffWait = Stopwatch.StartNew();
    int handoffConflicts, handoffHResult;
    string handoffJson = ReadPublishedJson(handoffReleasedPath, handoffWait, 30000, out handoffConflicts, out handoffHResult);
    Dictionary<string, object> handoffReleased = (Dictionary<string, object>)serializer.DeserializeObject(handoffJson);
    readProbe["handoffConflicts"] = handoffConflicts; readProbe["handoffHResult"] = handoffHResult;
    File.WriteAllText(readProbePath, serializer.Serialize(readProbe), new UTF8Encoding(false));
    bool databaseExclusiveOpenPassed = false;
    try {
      using (FileStream stream = File.Open(
        databasePath,
        FileMode.Open,
        FileAccess.Read,
        FileShare.None
      )) {
        databaseExclusiveOpenPassed = stream.Length > 0;
      }
    } catch {
      databaseExclusiveOpenPassed = false;
    }
    Dictionary<string, object> admission = new Dictionary<string, object> {
      { "kind", "s7-main-startup-admission" },
      { "schemaVersion", "s7-main-startup-admission/v2" },
      { "status", "ADMITTED_UNDER_EXCLUSIVE_SQLITE_LOCK" },
      { "admittedAt", DateTime.UtcNow.ToString("o") },
      { "pid", Process.GetCurrentProcess().Id },
      { "gateId", (string)active["gateId"] },
      { "invocationId", (string)active["invocationId"] },
      { "singleInstanceLockAcquired", true },
      { "canonicalUserDataDir", (string)active["canonicalUserDataDir"] },
      { "activeGate", Artifact(activePath) },
      { "boundGate", Artifact(boundPath) },
      { "handoffReady", Artifact(handoffReadyPath) },
      { "handoffReleased", Artifact(handoffReleasedPath) },
      { "executable", ObjectAt(bindings, "executable") },
      { "main", ObjectAt(package, "main") },
      { "database", database },
      { "intent", ObjectAt(bindings, "intent") },
      { "package", package },
      { "shell", ObjectAt(bindings, "shell") },
      { "sqliteTakeover", new Dictionary<string, object> {
        { "connectionPath", databasePath },
        { "fileMustExist", true },
        { "busyTimeoutMs", 0 },
        { "lockingMode", "exclusive" },
        { "beginMode", "exclusive" },
        { "transactionActive", true },
        { "sameConnectionRequiredForMigration", true },
        { "schemaVersionBefore", 0 }
      }}
    };
    WriteExclusiveJson(admissionPath, admission, serializer);
    File.WriteAllText(resultPath, serializer.Serialize(new Dictionary<string, object> {
      { "helperPrivateEnvironmentAbsent", helperPrivateEnvironmentAbsent },
      { "databaseExclusiveOpenPassed", databaseExclusiveOpenPassed },
      { "gateEnvironmentPresent",
        Environment.GetEnvironmentVariable("AAO_S7_STARTUP_GATE_ID") != null }
    }), new UTF8Encoding(false));
  }
}
`;
    const compile = spawnSync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:S7_TARGET_SOURCE_B64));Add-Type -TypeDefinition $s -Language CSharp -ReferencedAssemblies System.Web.Extensions -OutputAssembly $env:S7_TARGET_EXE -OutputType WindowsApplication',
    ], {
        encoding: 'utf8',
        env: {
            ...process.env,
            S7_TARGET_SOURCE_B64: Buffer.from(targetSource, 'utf8').toString('base64'),
            S7_TARGET_EXE: fakeExe,
        },
        windowsHide: true,
        timeout: 30000,
    });
    expect(compile.error).toBeUndefined();
    expect(compile.status, compile.stderr).toBe(0);
    expect(fs.existsSync(fakeExe)).toBe(true);
    const gateDirectory = path.join(root, '.s7-main-startup-gate');
    const activePath = path.join(gateDirectory, 'ACTIVE.json');
    const boundPath = path.join(gateDirectory, 'BOUND.json');
    const handoffReadyPath = path.join(gateDirectory, 'HANDOFF_READY.json');
    const handoffReleasedPath = path.join(gateDirectory, 'HANDOFF_RELEASED.json');
    const admissionPath = path.join(gateDirectory, 'ADMISSION.json');
    const closedPath = path.join(gateDirectory, 'CLOSED.json');
    const finalizedPath = path.join(gateDirectory, 'FINALIZED.json');
    const targetResult = path.join(gateDirectory, 'SYNTHETIC-RESULT.json');
    const intentPath = path.join(root, 'synthetic.intent.json');
    const mainPath = path.join(root, 'synthetic-main.js');
    fs.mkdirSync(gateDirectory);
    defaultProtectWindowsDirectory(gateDirectory);
    defaultProtectWindowsFile(db);
    write(intentPath, '{"approved":true}\n');
    defaultProtectWindowsFile(intentPath);
    write(mainPath, 'synthetic-main');
    const executable = gateArtifact(fakeExe);
    const main = gateArtifact(mainPath);
    const database = gateArtifact(db);
    const intent = gateArtifact(intentPath);
    const trustedShell = resolveTrustedWindowsPowerShell(process.env);
    const gatePlan = {
        gateDirectory,
        activePath,
        boundPath,
        handoffReadyPath,
        handoffReleasedPath,
        admissionPath,
        closedPath,
        finalizedPath,
        gateId: 'gate-native-helper-synthetic',
        invocationId: 'invocation-native-helper-synthetic',
        activeDocument: {
            kind: 's7-main-startup-gate-active',
            schemaVersion: 's7-main-startup-gate-active/v2',
            status: 'ACTIVE_AWAITING_BOUND_CHILD',
            gateId: 'gate-native-helper-synthetic',
            invocationId: 'invocation-native-helper-synthetic',
            createdAt: new Date().toISOString(),
            canonicalUserDataDir: root,
            paths: {
                active: activePath,
                bound: boundPath,
                handoffReady: handoffReadyPath,
                handoffReleased: handoffReleasedPath,
                admission: admissionPath,
                closed: closedPath,
                finalized: finalizedPath,
            },
            bindings: {
                executable: gateBinding(executable),
                package: {
                    exe: gateBinding(executable),
                    appContent: {
                        realPath: root,
                        sha256: sha('synthetic-app-content'),
                        fileCount: 2,
                        sizeBytes: executable.sizeBytes + main.sizeBytes,
                    },
                    main: gateBinding(main),
                },
                database: gateBinding(database),
                intent: gateBinding(intent),
                shell: {
                    realPath: trustedShell.realPath,
                    sha256: trustedShell.sha256,
                    sizeBytes: trustedShell.sizeBytes,
                    identity: { ...trustedShell.identity },
                    hardlinkPaths: [...trustedShell.hardlinkPaths],
                    signature: { ...trustedShell.signature },
                    version: { ...trustedShell.version },
                },
            },
        },
    };
    const encode = (value) => Buffer.from(value, 'utf8').toString('base64');
    const nativeRuntimeEnvironment = {};
    const nativeRuntimeAllowlist = new Set([
        'COMSPEC',
        'LANG',
        'LC_ALL',
        'LC_CTYPE',
        'PATHEXT',
        'SYSTEMDRIVE',
        'SYSTEMROOT',
        'TEMP',
        'TMP',
        'WINDIR',
    ]);
    for (const [key, value] of Object.entries(process.env)) {
        if (nativeRuntimeAllowlist.has(key.toUpperCase()) && typeof value === 'string') {
            nativeRuntimeEnvironment[key.toUpperCase()] = value;
        }
    }
    const nativeWindowsRoot = process.env.WINDIR || 'C:\\Windows';
    const nativeSystem32 = path.join(nativeWindowsRoot, 'System32');
    nativeRuntimeEnvironment.SYSTEMROOT = nativeWindowsRoot;
    nativeRuntimeEnvironment.WINDIR = nativeWindowsRoot;
    nativeRuntimeEnvironment.SYSTEMDRIVE = path.parse(nativeWindowsRoot).root.replace(/[\\/]$/, '');
    nativeRuntimeEnvironment.COMSPEC = path.join(nativeSystem32, 'cmd.exe');
    nativeRuntimeEnvironment.PATH = [
        nativeSystem32,
        path.join(nativeSystem32, 'Wbem'),
        path.join(nativeSystem32, 'WindowsPowerShell', 'v1.0'),
    ].join(';');
    const child = spawn(path.join(nativeWindowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', EXCLUSIVE_WINDOW_HELPER_BOOTSTRAP], {
        env: {
            ...nativeRuntimeEnvironment,
            AAO_S7_EXCLUSIVE_DB_B64: encode(db),
            AAO_S7_EXECUTABLE_B64: encode(fakeExe),
            AAO_S7_WORKING_DIRECTORY_B64: encode(root),
        },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    });
    child.stdout.setEncoding('utf8');
    const closePromise = new Promise((resolve) => {
        child.once('close', (code, signal) => resolve({ code, signal }));
    });
    const stderr = [];
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const iterator = lines[Symbol.asyncIterator]();
    let lastProtocolProof = null;
    const nextProof = async (status) => {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`synthetic helper ${status} timeout: ${stderr.join('')}`)), 20000);
        });
        try {
            const item = await Promise.race([iterator.next(), timeout]);
            expect(item.done, `synthetic helper ${status} closed early: ${stderr.join('')}`).toBe(false);
            const proof = JSON.parse(item.value);
            lastProtocolProof = proof;
            if (proof.status !== status) {
                throw new Error(`synthetic helper expected ${status} but received ${JSON.stringify(proof)}`);
            }
            return proof;
        }
        finally {
            clearTimeout(timer);
        }
    };
    let spawnedPid = null;
    let releaseSent = false;
    let closedObserved = false;
    let fixtureSucceeded = false;
    let protocolFailure = null;
    const preserveFailure = (error, phase) => {
        const diagnosticErrors = [];
        let diagnostic;
        try {
            diagnostic = createRuntimeLogRecord('error', 'development.s7_synthetic_fixture_failed', {
                error, phase, root, lastProtocolProof, stderr: stderr.join(''), spawnedPid, releaseSent, closedObserved,
            });
        } catch (formatError) {
            diagnosticErrors.push(formatError);
            diagnostic = { timestamp: new Date().toISOString(), level: 'error', event: 'development.s7_synthetic_fixture_diagnostic_failed',
                context: { phase, root, originalError: { message: error.message, stack: error.stack } } };
        }
        try {
            fs.writeFileSync(path.join(root, 'SYNTHETIC-FAILURE-' + phase + '.json'), JSON.stringify(diagnostic, null, 2) + '\n', { flag: 'wx' });
        } catch (writeError) { diagnosticErrors.push(writeError); }
        if (diagnosticErrors.length) diagnostic.context.diagnosticErrors = diagnosticErrors.map(value => ({ message: value.message, stack: value.stack }));
        try { process.stderr.write(JSON.stringify(diagnostic) + '\n'); }
        catch (streamError) { diagnosticErrors.push(streamError); }
        if (diagnosticErrors.length) throw new AggregateError([error, ...diagnosticErrors], 'synthetic fixture diagnostic failed', { cause: error });
    };
    try {
        const ready = await nextProof('READY');
        expect(ready).toMatchObject({
            protocol: 's7-live-migration-exclusive-window/v1',
            status: 'READY',
            path: fs.realpathSync.native(db),
            sha256: sha('synthetic-exclusive-db'),
            databaseHandleExclusive: true,
        });
        expect(() => fs.openSync(db, fs.constants.O_RDONLY)).toThrow();
        child.stdin.write(`S7_CREATE_SUSPENDED ${encode(JSON.stringify(gatePlan))}\n`);
        const spawned = await nextProof('SPAWNED');
        spawnedPid = spawned.pid;
        expect(spawned).toMatchObject({
            protocol: 's7-live-migration-exclusive-window/v1',
            createdSuspended: true,
            databaseHandleExclusive: true,
            queriedExecutablePath: fs.realpathSync.native(fakeExe),
            processImageQueryPassed: true,
            startupGateId: gatePlan.gateId,
            startupGateInvocationId: gatePlan.invocationId,
            startupGateAdmissionPath: admissionPath,
            startupGateClosedPath: closedPath,
            startupGateWindowsSecurityPassed: true,
        });
        expect(fs.existsSync(targetResult)).toBe(false);
        expect(fs.existsSync(activePath)).toBe(true);
        expect(fs.existsSync(boundPath)).toBe(true);
        expect(fs.existsSync(admissionPath)).toBe(false);
        expect(fs.existsSync(closedPath)).toBe(false);
        expect(() => fs.openSync(db, fs.constants.O_RDONLY)).toThrow();
        const pidInspection = spawnSync('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `@(Get-CimInstance Win32_Process -Filter "ProcessId=${spawned.pid}" | Select-Object ProcessId,Name) | ConvertTo-Json -Compress`,
        ], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 20000,
        });
        expect(pidInspection.error).toBeUndefined();
        expect(pidInspection.status, pidInspection.stderr).toBe(0);
        const inspected = JSON.parse(String(pidInspection.stdout).trim());
        expect(Number(inspected.ProcessId)).toBe(spawned.pid);
        expect(String(inspected.Name).toLowerCase()).toBe(path.basename(fakeExe).toLowerCase());
        child.stdin.write('S7_RELEASE_AND_RESUME\n');
        releaseSent = true;
        const resumed = await nextProof('RESUMED');
        expect(resumed).toMatchObject({
            protocol: 's7-live-migration-exclusive-window/v1',
            pid: spawned.pid,
            databaseHandleExclusive: false,
            resumeResult: 1,
            finalSameNameInventoryPassed: true,
            finalSameNameProcessCount: 1,
            finalQueriedExecutablePath: fs.realpathSync.native(fakeExe),
            finalProcessImageQueryPassed: true,
            startupGateId: gatePlan.gateId,
            startupGateInvocationId: gatePlan.invocationId,
        });
        const closed = await nextProof('CLOSED');
        closedObserved = true;
        expect(closed).toMatchObject({
            protocol: 's7-live-migration-exclusive-window/v1',
            pid: spawned.pid,
            exitCode: 0,
            databaseHandleExclusive: false,
            startupGateId: gatePlan.gateId,
            startupGateInvocationId: gatePlan.invocationId,
            startupGateAdmissionVerified: true,
            startupGateWindowsSecurityPassed: true,
            startupGateAdmissionPath: fs.realpathSync.native(admissionPath),
            startupGateClosedPath: fs.realpathSync.native(closedPath),
        });
        expect(fs.existsSync(activePath)).toBe(true);
        expect(fs.existsSync(boundPath)).toBe(true);
        expect(fs.existsSync(admissionPath)).toBe(true);
        expect(fs.existsSync(closedPath)).toBe(true);
        await expect(closePromise).resolves.toEqual({ code: 0, signal: null });
        expect(JSON.parse(fs.readFileSync(targetResult, 'utf8').replace(/^\uFEFF/, ''))).toEqual({
            helperPrivateEnvironmentAbsent: true,
            databaseExclusiveOpenPassed: true,
            gateEnvironmentPresent: true,
        });
        const reopened = fs.openSync(db, fs.constants.O_RDONLY);
        fs.closeSync(reopened);
        expect(fs.readFileSync(db, 'utf8')).toBe('synthetic-exclusive-db');
        const readProbe = JSON.parse(fs.readFileSync(path.join(root, 'SYNTHETIC-PUBLISH-READ.json'), 'utf8'));
        process.stderr.write(JSON.stringify(createRuntimeLogRecord('info', 'development.s7_synthetic_native_read_probe', { root, readProbe })) + '\n');
        fixtureSucceeded = true;
    }
    catch (error) {
        protocolFailure = error;
        try { preserveFailure(error, 'protocol'); }
        catch (diagnosticError) { protocolFailure = diagnosticError; }
        throw protocolFailure;
    }
    finally {
        try {
        lines.close();
        if (!closedObserved
            && Number.isInteger(spawnedPid)
            && !releaseSent
            && !child.stdin.destroyed) {
            try {
                child.stdin.write('S7_RELEASE_AND_RESUME\n');
                releaseSent = true;
            }
            catch {
            }
        }
        else if (!Number.isInteger(spawnedPid) && !child.stdin.destroyed) {
            try {
                child.stdin.end();
            }
            catch {
            }
        }
        const boundedHelperClose = await Promise.race([
            closePromise,
            new Promise((resolve) => {
                const timer = setTimeout(() => resolve({ outcome: 'timeout' }), 10000);
                timer.unref?.();
            }),
        ]);
        child.stdin.unref?.();
        child.stdout.unref?.();
        child.stderr.unref?.();
        child.unref();
        if (boundedHelperClose?.outcome === 'timeout') {
            throw new Error(`synthetic helper did not close; preserved ${root}`);
        }
        if (Number.isInteger(spawnedPid)) {
            const remaining = spawnSync('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `@(Get-CimInstance Win32_Process -Filter "ProcessId=${spawnedPid}" | Select-Object ProcessId) | ConvertTo-Json -Compress`,
            ], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
            const remainingText = String(remaining.stdout || '').trim();
            if (remaining.error
                || remaining.status !== 0
                || !['', '[]', 'null'].includes(remainingText)) {
                throw new Error(`synthetic child close was not proven; preserved ${root}: `
                    + String(remaining.stdout || remaining.stderr || '')
                    + ` lastProtocolProof=${JSON.stringify(lastProtocolProof)}`);
            }
        }
        if (fixtureSucceeded) {
            fs.rmSync(root, {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 100,
            });
        }
        } catch (error) {
            let cleanupFailure = error;
            try { preserveFailure(error, 'cleanup'); }
            catch (diagnosticError) { cleanupFailure = diagnosticError; }
            if (protocolFailure) throw new AggregateError([protocolFailure, cleanupFailure], 'synthetic protocol and cleanup failed', { cause: protocolFailure });
            throw cleanupFailure;
        }
    }
}, 60000);
});
