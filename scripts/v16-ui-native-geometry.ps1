[CmdletBinding()]
param(
  [string]$MainPid,
  [string]$MainCreationTimeUtcTicks,
  [string]$MainExecutablePath,
  [string]$Hwnd,
  [string]$RequestNonce,
  [string]$ExpectedRendererPid,
  [string]$HelperTimeoutMs,
  [string]$WmQueryTimeoutMs,
  [string]$MaxOutputBytes,
  [string]$MaxChildren
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$exitCode = 1
$report = $null
$loggingFailure = $null
$maxOutputValue = 0
try {
  function Read-CappedLimit([string]$Value, [int]$Maximum, [string]$Name) {
    $number = 0
    if ($Value -notmatch '^[1-9][0-9]{0,8}$' -or -not [int]::TryParse($Value, [ref]$number) -or $number -gt $Maximum) { throw ($Name + '_INVALID') }
    return $number
  }
  $helperTimeoutValue = Read-CappedLimit $HelperTimeoutMs 20000 'HELPER_TIMEOUT'
  $wmQueryTimeoutValue = Read-CappedLimit $WmQueryTimeoutMs 1000 'WM_QUERY_TIMEOUT'
  $maxOutputValue = Read-CappedLimit $MaxOutputBytes 524288 'MAX_OUTPUT'
  $maxChildrenValue = Read-CappedLimit $MaxChildren 256 'MAX_CHILDREN'
  $ownerPidValue = 0
  $rendererPidValue = 0
  $birthTicksValue = 0L
  $hwndValue = 0L
  $nonceValue = [Guid]::Empty
  if ($MainPid -notmatch '^[1-9][0-9]{0,9}$' -or -not [int]::TryParse($MainPid, [ref]$ownerPidValue)) { throw 'MAIN_PID_INVALID' }
  if ($ExpectedRendererPid -notmatch '^[1-9][0-9]{0,9}$' -or -not [int]::TryParse($ExpectedRendererPid, [ref]$rendererPidValue) -or $rendererPidValue -eq $ownerPidValue) { throw 'RENDERER_PID_INVALID' }
  if ($MainCreationTimeUtcTicks -notmatch '^[1-9][0-9]{0,18}$' -or -not [long]::TryParse($MainCreationTimeUtcTicks, [ref]$birthTicksValue) -or $birthTicksValue -gt [DateTime]::MaxValue.Ticks) { throw 'MAIN_BIRTH_INVALID' }
  if ($Hwnd -notmatch '^[1-9][0-9]{0,18}$' -or -not [long]::TryParse($Hwnd, [ref]$hwndValue) -or ($hwndValue -eq 65535)) { throw 'HWND_INVALID' }
  if (-not [Guid]::TryParseExact($RequestNonce, 'D', [ref]$nonceValue) -or $nonceValue -eq [Guid]::Empty -or $RequestNonce -cne $nonceValue.ToString('D')) { throw 'REQUEST_NONCE_INVALID' }
  if ($MainExecutablePath -notmatch '^[A-Za-z]:\\' -or [System.IO.Path]::GetFullPath($MainExecutablePath) -cne $MainExecutablePath -or [System.IO.Path]::GetExtension($MainExecutablePath) -ine '.exe' -or -not [System.IO.File]::Exists($MainExecutablePath)) { throw 'MAIN_EXE_INVALID' }
  if ([IntPtr]::Size -ne 8) { throw 'X64_PROCESS_REQUIRED' }
  $nativeSource = @'
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class PhysicalGeometryProbe {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left; public int top; public int right; public int bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MINMAXINFO { public POINT reserved; public POINT maxSize; public POINT maxPosition; public POINT minTrackSize; public POINT maxTrackSize; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct MONITORINFOEX {
    public uint cbSize; public RECT monitor; public RECT work; public uint flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string device;
  }
  private delegate bool EnumChildProc(IntPtr hwnd, IntPtr argument);
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] private static extern void SetLastError(uint error);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] private static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);
  [DllImport("user32.dll", SetLastError = true)] private static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll", SetLastError = true)] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ClientToScreen(IntPtr hwnd, ref POINT point);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)] private static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int length);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)] private static extern IntPtr GetWindowLongPtrW(IntPtr hwnd, int index);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback, IntPtr argument);
  [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetMonitorInfoW(IntPtr monitor, ref MONITORINFOEX info);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)] private static extern IntPtr SendMessageTimeoutW(IntPtr hwnd, uint message, UIntPtr wParam, ref MINMAXINFO data, uint flags, uint timeoutMs, out UIntPtr result);
  [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd, uint attribute, out RECT rect, uint size);
  public static Dictionary<string, object> LastState;
  private static Dictionary<string, object> D(params object[] pairs) {
    Dictionary<string, object> value = new Dictionary<string, object>();
    for (int i = 0; i < pairs.Length; i += 2) value.Add((string)pairs[i], pairs[i + 1]);
    return value;
  }
  private static void Need(bool value, string code) { if (!value) throw new InvalidOperationException(code); }
  private static void Win(bool value, string api) { if (!value) throw new Win32Exception(Marshal.GetLastWin32Error(), api + "_FAILED"); }
  private static string Now() { return DateTime.UtcNow.ToString("o"); }
  private static object Point(POINT value) { return D("x", value.x, "y", value.y); }
  private static object Rect(RECT value) { return D("left", value.left, "top", value.top, "right", value.right, "bottom", value.bottom); }
  private static object MinMax(MINMAXINFO value) { return D("reserved", Point(value.reserved), "maxSize", Point(value.maxSize), "maxPosition", Point(value.maxPosition), "minTrackSize", Point(value.minTrackSize), "maxTrackSize", Point(value.maxTrackSize)); }
  private static long Style(IntPtr hwnd, int index) {
    SetLastError(0); IntPtr value = GetWindowLongPtrW(hwnd, index); int error = Marshal.GetLastWin32Error();
    Need(value != IntPtr.Zero || error == 0, "WINDOW_STYLE_READ_FAILED"); return value.ToInt64();
  }
  private static Dictionary<string, object> ProcessOwner(int pid, long? expectedTicks, string expectedExe) {
    using (Process process = Process.GetProcessById(pid)) {
      Need(!process.HasExited, "OWNER_PROCESS_EXITED");
      long ticks = process.StartTime.ToUniversalTime().Ticks;
      string actualExe = Path.GetFullPath(process.MainModule.FileName);
      Need(!expectedTicks.HasValue || ticks == expectedTicks.Value, "OWNER_BIRTH_CHANGED");
      Need(String.Equals(actualExe, expectedExe, StringComparison.OrdinalIgnoreCase), "OWNER_EXE_CHANGED");
      Need(!process.HasExited, "OWNER_PROCESS_EXITED_AFTER_READ");
      return D("pid", pid, "creationTimeUtcTicks", ticks.ToString(), "creationTimeUtc", new DateTime(ticks, DateTimeKind.Utc).ToString("o"), "executablePath", actualExe);
    }
  }
  private static Dictionary<string, object> Owner(IntPtr root, int pid, long birth, string exe) {
    Dictionary<string, object> value = ProcessOwner(pid, birth, exe);
    Need(IsWindow(root), "ROOT_HWND_MISSING"); uint actualPid;
    uint thread = GetWindowThreadProcessId(root, out actualPid);
    Need(thread != 0 && actualPid == (uint)pid && GetAncestor(root, 2) == root, "ROOT_HWND_OWNER_CHANGED");
    value.Add("hwnd", root.ToInt64().ToString()); value.Add("windowPid", actualPid); value.Add("windowThreadId", thread);
    return value;
  }
  private static Dictionary<string, object> Window(IntPtr hwnd, IntPtr root, int mainPid, int rendererPid) {
    Need(IsWindow(hwnd), "WINDOW_MISSING"); uint ownerPid; uint thread = GetWindowThreadProcessId(hwnd, out ownerPid);
    Need(thread != 0 && (ownerPid == (uint)mainPid || ownerPid == (uint)rendererPid), "WINDOW_PROCESS_NOT_ADMITTED");
    Need(GetAncestor(hwnd, 2) == root && (hwnd == root || IsChild(root, hwnd)), "WINDOW_ROOT_CHANGED");
    RECT outer, client;
    Win(GetWindowRect(hwnd, out outer), "GetWindowRect"); Win(GetClientRect(hwnd, out client), "GetClientRect");
    POINT first = new POINT { x = client.left, y = client.top }, last = new POINT { x = client.right, y = client.bottom };
    Win(ClientToScreen(hwnd, ref first), "ClientToScreen_first"); Win(ClientToScreen(hwnd, ref last), "ClientToScreen_last");
    StringBuilder name = new StringBuilder(256); Need(GetClassNameW(hwnd, name, name.Capacity) > 0, "WINDOW_CLASS_READ_FAILED");
    uint dpi = GetDpiForWindow(hwnd); Need(dpi > 0, "WINDOW_DPI_READ_FAILED");
    IntPtr parent = GetParent(hwnd); bool visible = IsWindowVisible(hwnd); long style = Style(hwnd, -16), exStyle = Style(hwnd, -20);
    uint afterPid; uint afterThread = GetWindowThreadProcessId(hwnd, out afterPid);
    Need(IsWindow(hwnd) && ownerPid == afterPid && thread == afterThread && GetAncestor(hwnd, 2) == root, "WINDOW_OWNER_CHANGED_DURING_SAMPLE");
    return D("hwnd", hwnd.ToInt64().ToString(), "pid", ownerPid, "threadId", thread, "parentHwnd", parent.ToInt64().ToString(),
      "rootHwnd", root.ToInt64().ToString(), "className", name.ToString(), "visible", visible, "dpi", dpi,
      "styleHex", "0x" + unchecked((uint)style).ToString("X8"), "exStyleHex", "0x" + unchecked((uint)exStyle).ToString("X8"),
      "windowRectScreenPhysicalPx", Rect(outer), "clientRectLocalPhysicalPx", Rect(client),
      "clientRectScreenPhysicalPx", D("left", first.x, "top", first.y, "right", last.x, "bottom", last.y), "observedAt", Now());
  }
  private static object Monitor(IntPtr root) {
    IntPtr monitor = MonitorFromWindow(root, 0); Need(monitor != IntPtr.Zero, "WINDOW_MONITOR_MISSING");
    MONITORINFOEX info = new MONITORINFOEX(); info.cbSize = (uint)Marshal.SizeOf(typeof(MONITORINFOEX));
    Win(GetMonitorInfoW(monitor, ref info), "GetMonitorInfoW");
    return D("handle", monitor.ToInt64().ToString(), "device", info.device, "flags", info.flags,
      "monitorRectScreenPhysicalPx", Rect(info.monitor), "workRectScreenPhysicalPx", Rect(info.work));
  }

  private static Dictionary<string, object> Query(Func<Dictionary<string, object>> call) {
    try { SetLastError(0); Dictionary<string, object> value = call(); value["executed"] = true; return value; }
    catch (Exception error) { return D("executed", true, "success", false, "error", D("name", error.GetType().Name, "message", error.Message)); }
  }
  private static Dictionary<string, object> WindowQueries(IntPtr hwnd, IntPtr root) {
    Dictionary<string, object> rows = D("startedAt", Now());
    rows["isWindow"] = Query(delegate { bool value = IsWindow(hwnd); return D("success", true, "returnValue", value, "lastError", Marshal.GetLastWin32Error()); });
    rows["threadProcess"] = Query(delegate { uint pid; uint value = GetWindowThreadProcessId(hwnd, out pid); int error = Marshal.GetLastWin32Error(); return D("success", value != 0 && pid != 0, "returnValue", value, "outPid", pid, "lastError", error); });
    rows["root"] = Query(delegate { IntPtr value = GetAncestor(hwnd, 2); return D("success", value != IntPtr.Zero, "returnValue", value.ToInt64().ToString(), "lastError", Marshal.GetLastWin32Error()); });
    rows["isChild"] = Query(delegate { bool value = IsChild(root, hwnd); return D("success", true, "returnValue", value, "lastError", Marshal.GetLastWin32Error()); });
    rows["parent"] = Query(delegate { IntPtr value = GetParent(hwnd); return D("success", true, "returnValue", value.ToInt64().ToString(), "lastError", Marshal.GetLastWin32Error()); });
    rows["className"] = Query(delegate { StringBuilder value = new StringBuilder(256); int length = GetClassNameW(hwnd, value, value.Capacity); return D("success", length > 0 && length < value.Capacity - 1, "returnValue", length, "outText", value.ToString(), "lastError", Marshal.GetLastWin32Error()); });
    rows["visible"] = Query(delegate { bool value = IsWindowVisible(hwnd); return D("success", true, "returnValue", value, "lastError", Marshal.GetLastWin32Error()); });
    rows["windowRect"] = Query(delegate { RECT value; bool result = GetWindowRect(hwnd, out value); return D("success", result, "returnValue", result, "outRectScreenPhysicalPx", Rect(value), "lastError", Marshal.GetLastWin32Error()); });
    rows["clientRect"] = Query(delegate { RECT value; bool result = GetClientRect(hwnd, out value); return D("success", result, "returnValue", result, "outRectLocalPhysicalPx", Rect(value), "lastError", Marshal.GetLastWin32Error()); });
    rows["clientScreenRect"] = Query(delegate {
      RECT client; bool local = GetClientRect(hwnd, out client); int localError = Marshal.GetLastWin32Error();
      POINT first = new POINT { x = client.left, y = client.top }, last = new POINT { x = client.right, y = client.bottom };
      SetLastError(0); bool firstResult = ClientToScreen(hwnd, ref first); int firstError = Marshal.GetLastWin32Error();
      SetLastError(0); bool lastResult = ClientToScreen(hwnd, ref last); int lastError = Marshal.GetLastWin32Error();
      return D("success", local && firstResult && lastResult, "returnValue", local && firstResult && lastResult,
        "clientQuery", D("executed", true, "success", local, "returnValue", local, "lastError", localError, "outRect", Rect(client)),
        "firstQuery", D("executed", true, "success", firstResult, "returnValue", firstResult, "lastError", firstError, "outPoint", Point(first)),
        "lastQuery", D("executed", true, "success", lastResult, "returnValue", lastResult, "lastError", lastError, "outPoint", Point(last)),
        "outRectScreenPhysicalPx", D("left", first.x, "top", first.y, "right", last.x, "bottom", last.y));
    });
    rows["dpi"] = Query(delegate { uint value = GetDpiForWindow(hwnd); return D("success", value > 0, "returnValue", value, "lastError", Marshal.GetLastWin32Error()); });
    rows["style"] = Query(delegate { IntPtr value = GetWindowLongPtrW(hwnd, -16); int error = Marshal.GetLastWin32Error(); return D("success", value != IntPtr.Zero || error == 0, "returnValue", value.ToInt64().ToString(), "hex", "0x" + unchecked((uint)value.ToInt64()).ToString("X8"), "lastError", error); });
    rows["exStyle"] = Query(delegate { IntPtr value = GetWindowLongPtrW(hwnd, -20); int error = Marshal.GetLastWin32Error(); return D("success", value != IntPtr.Zero || error == 0, "returnValue", value.ToInt64().ToString(), "hex", "0x" + unchecked((uint)value.ToInt64()).ToString("X8"), "lastError", error); });
    rows["finishedAt"] = Now(); return rows;
  }
  private static Dictionary<string, object> Row(Dictionary<string, object> queries, string name) { return (Dictionary<string, object>)queries[name]; }
  private static object Field(Dictionary<string, object> queries, string name, string key) {
    Dictionary<string, object> value = Row(queries, name); return value.ContainsKey(key) ? value[key] : null;
  }
  private static bool RawEqual(object a, object b) {
    Dictionary<string, object> left = a as Dictionary<string, object>, right = b as Dictionary<string, object>;
    if (left == null || right == null) return Object.Equals(a, b);
    foreach (string key in left.Keys) {
      if (key == "startedAt" || key == "finishedAt") continue;
      if (!right.ContainsKey(key) || !RawEqual(left[key], right[key])) return false;
    }
    foreach (string key in right.Keys) if (key != "startedAt" && key != "finishedAt" && !left.ContainsKey(key)) return false;
    return true;
  }
  private static object UntrustedProcess(uint pid) {
    try {
      using (Process process = Process.GetProcessById(checked((int)pid))) {
        long ticks = process.StartTime.ToUniversalTime().Ticks; string exe = Path.GetFullPath(process.MainModule.FileName);
        return D("executed", true, "success", !process.HasExited, "authority", "NONE", "pid", pid,
          "creationTimeUtcTicks", ticks.ToString(), "executablePath", exe);
      }
    } catch (Exception error) { return D("executed", true, "success", false, "authority", "NONE", "pid", pid, "error", D("name", error.GetType().Name, "message", error.Message)); }
  }
  private static Dictionary<string, object> Child(IntPtr hwnd, IntPtr root, int mainPid, int rendererPid) {
    Dictionary<string, object> before = WindowQueries(hwnd, root), after = WindowQueries(hwnd, root);
    List<string> reasons = new List<string>(); bool complete = true;
    foreach (string key in before.Keys) {
      if (key == "startedAt" || key == "finishedAt") continue;
      if (!Object.Equals(Field(before, key, "success"), true) || !Object.Equals(Field(after, key, "success"), true)) {
        complete = false; reasons.Add("QUERY_FAILED_" + key);
      }
    }
    bool same = RawEqual(before, after), windowExists = Object.Equals(Field(before, "isWindow", "returnValue"), true)
      && Object.Equals(Field(after, "isWindow", "returnValue"), true);
    bool sameRoot = Object.Equals(Field(before, "root", "returnValue"), root.ToInt64().ToString())
      && Object.Equals(Field(after, "root", "returnValue"), root.ToInt64().ToString())
      && Object.Equals(Field(before, "isChild", "returnValue"), true) && Object.Equals(Field(after, "isChild", "returnValue"), true);
    if (!same) reasons.Add("CHILD_CHANGED_DURING_SAMPLE"); if (!windowExists) reasons.Add("CHILD_HWND_NOT_PRESENT");
    if (!sameRoot) reasons.Add("CHILD_ROOT_OR_DESCENDANT_MISMATCH");
    object rawPid = Field(before, "threadProcess", "outPid"); uint pid = rawPid is uint ? (uint)rawPid : 0;
    string admission = "UNVERIFIED";
    if (complete && same && sameRoot && windowExists) admission = pid == (uint)mainPid ? "ADMITTED_MAIN" : pid == (uint)rendererPid ? "ADMITTED_RENDERER" : "UNADMITTED";
    if (admission == "UNADMITTED") reasons.Add("PID_NOT_MAIN_OR_EXPECTED_RENDERER");
    bool candidate = (Object.Equals(Field(before, "className", "outText"), "Chrome_RenderWidgetHostHWND") && Object.Equals(Field(before, "visible", "returnValue"), true))
      || (Object.Equals(Field(after, "className", "outText"), "Chrome_RenderWidgetHostHWND") && Object.Equals(Field(after, "visible", "returnValue"), true));
    return D("hwnd", hwnd.ToInt64().ToString(), "beforeQueries", before, "afterQueries", after, "ownerAdmission", admission,
      "complete", complete && same && sameRoot && windowExists, "isVisibleRenderWidgetCandidate", candidate,
      "rejectionReasons", reasons, "processObservationUntrusted", pid > 0 ? UntrustedProcess(pid) : D("executed", false, "success", false, "authority", "NONE", "reason", "NO_POSITIVE_OUT_PID"));
  }
  private static Dictionary<string, object> InventoryVerdict(List<object> children, Exception callbackFailure) {
    List<object> candidates = new List<object>(); List<string> reasons = new List<string>();
    foreach (Dictionary<string, object> child in children) {
      if (!(bool)child["complete"]) reasons.Add("CHILD_INVENTORY_QUERY_INCOMPLETE:" + child["hwnd"]);
      if ((bool)child["isVisibleRenderWidgetCandidate"]) candidates.Add(child["hwnd"]);
    }
    if (callbackFailure != null) reasons.Add("CHILD_ENUMERATION_CALLBACK_FAILED:" + callbackFailure.Message);
    if (candidates.Count != 1) reasons.Add("VISIBLE_RENDER_WIDGET_NOT_UNIQUE");
    Dictionary<string, object> selected = null;
    if (candidates.Count == 1) foreach (Dictionary<string, object> child in children) if (Object.Equals(child["hwnd"], candidates[0])) selected = child;
    if (selected != null && (!(bool)selected["complete"] || !((string)selected["ownerAdmission"]).StartsWith("ADMITTED_"))) {
      reasons.Add("VISIBLE_RENDER_WIDGET_OWNER_NOT_ADMITTED"); selected = null;
    }
    return D("rawChildCount", children.Count, "visibleRenderWidgetCandidateCount", candidates.Count, "visibleRenderWidgetCandidateHwnds", candidates,
      "selectedWidgetHwnd", selected == null ? null : selected["hwnd"], "selectedWidgetOwnerAdmission", selected == null ? null : selected["ownerAdmission"],
      "completed", callbackFailure == null, "accepted", reasons.Count == 0, "authority", "DIAGNOSTIC_MAIN_OR_EXPECTED_RENDERER_ONLY", "rejectionReasons", reasons);
  }

  public static Dictionary<string, object> Capture(int mainPid, long birth, string exe, long hwndValue, string nonce, int rendererPid, int helperTimeoutMs, int wmQueryTimeoutMs, int maxOutputBytes, int maxChildren) {
    LastState = D("schemaVersion", "v16.native-physical-geometry/2", "passed", false, "diagnosticOnly", true,
      "formalCredit", false, "coordinateSpace", "physical-pixels", "startedAt", Now(),
      "limits", D("helperTimeoutMs", helperTimeoutMs, "wmQueryTimeoutMs", wmQueryTimeoutMs, "maxOutputBytes", maxOutputBytes, "maxChildren", maxChildren),
      "ownerRequest", D("mainPid", mainPid, "mainCreationTimeUtcTicks", birth.ToString(), "mainExecutablePath", exe,
      "hwnd", hwndValue.ToString(), "requestNonce", nonce, "expectedRendererPid", rendererPid));
    IntPtr root = new IntPtr(hwndValue), previous = IntPtr.Zero; uint thread = GetCurrentThreadId();
    Stopwatch elapsed = Stopwatch.StartNew(); Exception firstFailure = null;
    try {
      Need(mainPid != Process.GetCurrentProcess().Id && rendererPid != mainPid, "INDEPENDENT_OWNER_REQUIRED");
      LastState["ownerBefore"] = Owner(root, mainPid, birth, exe);
      Dictionary<string, object> rendererBefore = ProcessOwner(rendererPid, null, exe);
      LastState["rendererBefore"] = rendererBefore;
      previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
      Win(previous != IntPtr.Zero, "SetThreadDpiAwarenessContext");
      IntPtr active = GetThreadDpiAwarenessContext();
      Need(AreDpiAwarenessContextsEqual(active, new IntPtr(-4)), "PMV2_CONTEXT_NOT_ACTIVE");
      Dictionary<string, object> native = D("threadId", thread, "contextBefore", previous.ToInt64().ToString(),
        "contextActive", active.ToInt64().ToString(), "requestedContext", "-4", "pmv2Verified", true);
      LastState["native"] = native;
      native["primaryBefore"] = Window(root, root, mainPid, rendererPid);
      native["monitor"] = Monitor(root);
      RECT extended; int hresult = DwmGetWindowAttribute(root, 9, out extended, (uint)Marshal.SizeOf(typeof(RECT)));
      native["dwmExtendedFrameBounds"] = D("attribute", 9, "hresult", hresult, "rectScreenPhysicalPx", hresult == 0 ? Rect(extended) : null);
      Need(elapsed.Elapsed.TotalMilliseconds < helperTimeoutMs, "HELPER_BUDGET_EXCEEDED");
      MINMAXINFO query = new MINMAXINFO(); object input = MinMax(query); UIntPtr messageResult;
      string queryStarted = Now(); SetLastError(0);
      IntPtr queryReturn = SendMessageTimeoutW(root, 0x0024, UIntPtr.Zero, ref query, 0x0023, (uint)wmQueryTimeoutMs, out messageResult);
      int queryError = Marshal.GetLastWin32Error();
      native["minMaxQuery"] = D("message", "WM_GETMINMAXINFO", "messageHex", "0x0024", "flagsHex", "0x0023", "timeoutMs", wmQueryTimeoutMs,
        "input", input, "output", MinMax(query), "returnValue", queryReturn.ToInt64().ToString(),
        "messageResult", messageResult.ToUInt64().ToString(), "lastError", queryError, "startedAt", queryStarted, "finishedAt", Now(),
        "semantics", "raw-query-response-not-independent-effective-constraints");
      Need(queryReturn != IntPtr.Zero, "MINMAX_QUERY_FAILED_OR_TIMED_OUT");
      List<object> children = new List<object>(); Exception childFailure = null;
      EnumChildProc callback = delegate(IntPtr child, IntPtr argument) {
        try {
          Need(children.Count < maxChildren, "CHILD_WINDOW_LIMIT_EXCEEDED");
          children.Add(Child(child, root, mainPid, rendererPid)); return true;
        } catch (Exception error) { childFailure = error; return false; }
      };
      bool enumReturn = EnumChildWindows(root, callback, IntPtr.Zero); GC.KeepAlive(callback);
      native["children"] = children; native["enumChildWindowsReturnUnused"] = enumReturn;
      Dictionary<string, object> verdict = InventoryVerdict(children, childFailure); native["childInventoryVerdict"] = verdict;
      Exception afterFailure = null; List<object> afterErrors = new List<object>();
      try { native["primaryAfter"] = Window(root, root, mainPid, rendererPid); }
      catch (Exception error) { afterFailure = error; afterErrors.Add(D("phase", "primaryAfter", "message", error.Message)); }
      try { LastState["ownerAfter"] = Owner(root, mainPid, birth, exe); }
      catch (Exception error) { if (afterFailure == null) afterFailure = error; afterErrors.Add(D("phase", "ownerAfter", "message", error.Message)); }
      try { LastState["rendererAfter"] = ProcessOwner(rendererPid, Int64.Parse((string)rendererBefore["creationTimeUtcTicks"]), exe); }
      catch (Exception error) { if (afterFailure == null) afterFailure = error; afterErrors.Add(D("phase", "rendererAfter", "message", error.Message)); }
      native["afterReadErrors"] = afterErrors;
      Need(GetCurrentThreadId() == thread && AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(), new IntPtr(-4)), "SAMPLING_CONTEXT_CHANGED");
      Need(elapsed.Elapsed.TotalMilliseconds < helperTimeoutMs, "HELPER_BUDGET_EXCEEDED");
      if (afterFailure != null) throw afterFailure;
      Need((bool)verdict["accepted"], "CHILD_INVENTORY_OR_RENDER_WIDGET_NOT_ADMITTED");
    } catch (Exception error) {
      firstFailure = error; LastState["error"] = D("name", error.GetType().Name, "message", error.Message);
    } finally {
      if (previous != IntPtr.Zero) {
        SetLastError(0); IntPtr restoredFrom = SetThreadDpiAwarenessContext(previous);
        int restoreError = Marshal.GetLastWin32Error(); IntPtr after = GetThreadDpiAwarenessContext();
        bool restored = restoredFrom != IntPtr.Zero && AreDpiAwarenessContextsEqual(after, previous) && GetCurrentThreadId() == thread;
        LastState["contextRestore"] = D("attempted", true, "threadId", GetCurrentThreadId(), "returnValue", restoredFrom.ToInt64().ToString(),
          "contextAfter", after.ToInt64().ToString(), "expectedContext", previous.ToInt64().ToString(), "lastError", restoreError, "confirmed", restored);
        if (!restored) {
          LastState["restoreError"] = D("name", "InvalidOperationException", "message", "DPI_CONTEXT_RESTORE_FAILED");
          if (firstFailure == null) firstFailure = new InvalidOperationException("DPI_CONTEXT_RESTORE_FAILED");
        }
      } else LastState["contextRestore"] = D("attempted", false, "confirmed", false);
      elapsed.Stop(); LastState["elapsedMs"] = elapsed.Elapsed.TotalMilliseconds; LastState["finishedAt"] = Now();
    }
    if (firstFailure != null) throw new InvalidOperationException("NATIVE_PHYSICAL_GEOMETRY_FAILED", firstFailure);
    LastState["passed"] = true; return LastState;
  }
}
'@
  Add-Type -TypeDefinition $nativeSource -Language CSharp -ErrorAction Stop
  $report = [PhysicalGeometryProbe]::Capture($ownerPidValue, $birthTicksValue, $MainExecutablePath, $hwndValue, $RequestNonce, $rendererPidValue, $helperTimeoutValue, $wmQueryTimeoutValue, $maxOutputValue, $maxChildrenValue)
  $exitCode = 0
} catch {
  $failureText = $_.Exception.Message
  if ($failureText.Length -gt 1000) { $failureText = $failureText.Substring(0, 1000) }
  $probeType = 'PhysicalGeometryProbe' -as [type]
  if ($null -ne $probeType -and $null -ne [PhysicalGeometryProbe]::LastState) { $report = [PhysicalGeometryProbe]::LastState }
  else { $report = @{ schemaVersion = 'v16.native-physical-geometry/2'; passed = $false; diagnosticOnly = $true; formalCredit = $false; validationFailed = $true } }
  $exitCode = 1
  $report['terminalError'] = $failureText
  try {
    [Console]::Error.WriteLine((@{ timestamp = [DateTime]::UtcNow.ToString('o'); level = 'error'; event = 'v16.native_physical_geometry.failed'; context = @{ error = $failureText } } | ConvertTo-Json -Depth 5 -Compress))
  } catch {
    $loggingFailure = $_.Exception
    $report['loggingError'] = [string]$loggingFailure.Message
  }
}
try {
  # 日志序列化已失败时，保留同一异常并直接进入不依赖序列化器的出口。
  if ($null -ne $loggingFailure) { throw $loggingFailure }
  $payload = $report | ConvertTo-Json -Depth 18 -Compress
  if ($maxOutputValue -gt 0 -and [Text.Encoding]::UTF8.GetByteCount($payload + [Environment]::NewLine) -gt $maxOutputValue) {
    $exitCode = 1
    $payload = @{schemaVersion='v16.native-physical-geometry/2';passed=$false;diagnosticOnly=$true;formalCredit=$false;terminalError='NATIVE_GEOMETRY_OUTPUT_LIMIT'} | ConvertTo-Json -Compress
    [Console]::Error.WriteLine((@{timestamp=[DateTime]::UtcNow.ToString('o');level='error';event='v16.native_physical_geometry.output_limit';context=@{error='NATIVE_GEOMETRY_OUTPUT_LIMIT'}} | ConvertTo-Json -Compress))
  }
  [Console]::Out.WriteLine($payload)
} catch {
  $serializationMessage = [string]$_.Exception.Message
  $originalMessage = $serializationMessage
  $loggingMessage = ''
  if ($null -ne $report) {
    if ($report.ContainsKey('terminalError')) { $originalMessage = [string]$report['terminalError'] }
    elseif ($report.ContainsKey('error')) { $originalMessage = [string]$report['error']['message'] }
    if ($report.ContainsKey('loggingError')) { $loggingMessage = [string]$report['loggingError'] }
  }
  function Escape-FallbackJson([string]$Value) {
    $escaped = $Value.Replace('\', '\\').Replace('"', '\"')
    return [regex]::Replace($escaped, '[\u0000-\u001f]', { param($match) '\u' + ([int][char]$match.Value).ToString('x4') })
  }
  # 序列化器已失败，兜底仅拼接固定结构与已转义的原始错误。
  $fallbackTime = [DateTime]::UtcNow.ToString('o')
  $fallbackContext = '{"error":"' + (Escape-FallbackJson $originalMessage) + '","loggingError":"' + (Escape-FallbackJson $loggingMessage) + '","serializationError":"' + (Escape-FallbackJson $serializationMessage) + '"}'
  [Console]::Error.WriteLine('{"timestamp":"' + $fallbackTime + '","level":"error","event":"v16.native_physical_geometry.serialization_failed","context":' + $fallbackContext + '}')
  $exitCode = 1
}
exit $exitCode

