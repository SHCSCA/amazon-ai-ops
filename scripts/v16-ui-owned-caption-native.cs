using System;
using System.Text;
using System.IO;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public static class V16OwnedCaption {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct FileTime { public uint Low, High; }
  [StructLayout(LayoutKind.Sequential)] public struct MouseInput {
    public int X, Y; public uint Data, Flags, Time; public UIntPtr Extra;
  }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion {
    [FieldOffset(0)] public MouseInput Mouse;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint Type; public InputUnion Value; }
  [StructLayout(LayoutKind.Sequential)] public struct GuiInfo {
    public uint Size, Flags; public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret; public Rect CaretRect;
  }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint wait);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle, out FileTime born, out FileTime exit, out FileTime kernel, out FileTime user);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr handle, uint flags, StringBuilder name, ref uint size);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll", SetLastError=true)] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll", SetLastError=true)] static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll", SetLastError=true)] static extern bool GetWindowRect(IntPtr window, out Rect rectangle);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] static extern int GetSystemMetricsForDpi(int index, uint dpi);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wp, IntPtr lp, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] values, int size);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll", SetLastError=true)] static extern bool GetGUIThreadInfo(uint thread, ref GuiInfo info);
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetUserObjectInformation(IntPtr obj, int index, StringBuilder value, uint size, out uint needed);
  [DllImport("user32.dll", SetLastError=true)] static extern bool CloseDesktop(IntPtr desktop);

  static void Require(bool ok, string reason) { if (!ok) throw new InvalidOperationException(reason); }
  static void Time(DateTime deadline) { Require(DateTime.UtcNow < deadline, "UI_CAPTION_DEADLINE"); }
  static uint Owner(IntPtr window) {
    uint pid; Require(GetWindowThreadProcessId(window, out pid) != 0, "UI_CAPTION_WINDOW_PID_API"); return pid;
  }
  static void Identity(IntPtr held, uint pid, string exe, long born, IntPtr root, DateTime deadline) {
    Time(deadline); Require(WaitForSingleObject(held, 0) == 258, "UI_CAPTION_MAIN_NOT_ALIVE");
    FileTime birth, exit, kernel, user;
    Require(GetProcessTimes(held, out birth, out exit, out kernel, out user), "UI_CAPTION_BIRTH_API");
    long ticks = unchecked((long)(((ulong)birth.High << 32) | birth.Low));
    Require(ticks == born, "UI_CAPTION_MAIN_BIRTH_CHANGED");
    var buffer = new StringBuilder(32768); uint size = 32768;
    Require(QueryFullProcessImageName(held, 0, buffer, ref size), "UI_CAPTION_EXE_API");
    Require(String.Equals(Path.GetFullPath(buffer.ToString()), Path.GetFullPath(exe), StringComparison.OrdinalIgnoreCase), "UI_CAPTION_MAIN_EXE_CHANGED");
    Require(IsWindow(root) && IsWindowVisible(root) && IsWindowEnabled(root) && !IsIconic(root), "UI_CAPTION_ROOT_NOT_VISIBLE_ENABLED");
    Require(Owner(root) == pid && GetAncestor(root, 2) == root, "UI_CAPTION_ROOT_IDENTITY_CHANGED");
  }
  static void PointOwned(Point point, IntPtr root, uint pid, DateTime deadline, Dictionary<string, object> result) {
    Time(deadline); var hit = WindowFromPoint(point);
    bool hitNull = hit == IntPtr.Zero;
    IntPtr hitRoot = IntPtr.Zero;
    bool rootIsBound = !hitNull && (hitRoot = GetAncestor(hit, 2)) == root;
    uint hitPid = 0, hitThread = 0; bool pointOwnerIsBoundMain = !hitNull && (hitThread = GetWindowThreadProcessId(hit, out hitPid)) != 0 && hitPid == pid;
    result["hitNull"] = hitNull; result["rootIsBound"] = rootIsBound; result["pointOwnerIsBoundMain"] = pointOwnerIsBoundMain;
    // 仅保留上方原查询的实际操作数；不增加原生读取，也不改变短路或拒绝规则。
    result["pointOwnershipQuery"] = new Dictionary<string, object> {
      {"kind", "v16-caption-point-ownership-query"}, {"schemaVersion", 1},
      {"hitHwnd", hit.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture)},
      {"rootHwnd", root.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture)},
      {"hitRootHwnd", hitRoot.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture)},
      {"threadId", hitThread}, {"hitPid", hitPid},
      {"ancestorQueryExecuted", !hitNull}, {"ownerQueryExecuted", !hitNull}
    };
    Require(!hitNull && rootIsBound && pointOwnerIsBoundMain, "UI_CAPTION_POINT_NOT_OWNED");
  }
  static string DesktopName(IntPtr desktop) {
    var name = new StringBuilder(512); uint needed;
    Require(desktop != IntPtr.Zero && GetUserObjectInformation(desktop, 2, name, 1024, out needed), "UI_CAPTION_DESKTOP_QUERY_FAILED");
    return name.ToString();
  }
  static bool InputReleased() {
    foreach (int key in new int[] {1,2,4,5,6,16,17,18,91,92})
      if((GetAsyncKeyState(key) & 0x8000) != 0) return false;
    var info = new GuiInfo(); info.Size = (uint)Marshal.SizeOf(typeof(GuiInfo));
    Require(GetGUIThreadInfo(0, ref info), "UI_CAPTION_CAPTURE_QUERY_FAILED");
    return info.Capture == IntPtr.Zero;
  }
  static Input Mouse(int x, int y, uint flags) {
    var item = new Input(); item.Type = 0;
    item.Value.Mouse = new MouseInput { X=x, Y=y, Data=0, Flags=flags, Time=0, Extra=UIntPtr.Zero }; return item;
  }
  // 映射到目标像素的归一化区间中心，避免边界舍入落入相邻像素。
  public static int NormalizeAbsoluteCoordinate(int coordinate, int origin, int extent) {
    long offset=(long)coordinate-origin;
    Require(extent>1 && offset>=0 && offset<extent, "UI_CAPTION_VIRTUAL_SCREEN_INVALID");
    return (int)Math.Floor((offset+0.5)*65536.0/extent);
  }
  public static Dictionary<string, object> Activate(uint pid, string expectedBirth, string exe, string rootText, string deadlineText, uint hitMaxMs, uint observeMs, uint pollMs) {
    var result = new Dictionary<string, object>();
    result["startedAt"] = DateTime.UtcNow.ToString("o"); result["passed"] = false;
    result["stage"] = "validate"; result["sendInputCalls"] = 0; result["inputSent"] = 0;
    result["externalContentRead"] = false; result["atomicTargetGuarantee"] = false;
    IntPtr held=IntPtr.Zero, desktop=IntPtr.Zero, oldDpi=IntPtr.Zero; string failure=null; bool ownDownProven=false;
    var cleanupErrors = new List<string>();
    try {
      var deadline = DateTime.Parse(deadlineText, null, System.Globalization.DateTimeStyles.RoundtripKind).ToUniversalTime();
      Require(pid > 0 && Path.IsPathRooted(exe), "UI_CAPTION_INPUT_INVALID");
      Require(hitMaxMs>0 && hitMaxMs<=1000 && observeMs>0 && observeMs<=1000 && pollMs==10, "UI_CAPTION_OBSERVATION_LIMIT_INVALID");
      ulong raw = UInt64.Parse(rootText); Require(raw > 0 && raw <= Int64.MaxValue, "UI_CAPTION_ROOT_INVALID");
      var root = new IntPtr((long)raw);
      long born = DateTime.Parse(expectedBirth, null, System.Globalization.DateTimeStyles.RoundtripKind).ToUniversalTime().ToFileTimeUtc();
      held = OpenProcess(0x00101000, false, pid); Require(held != IntPtr.Zero, "UI_CAPTION_MAIN_HANDLE_FAILED");
      Identity(held, pid, exe, born, root, deadline);
      result["heldMainVerified"] = true;
      desktop = OpenInputDesktop(0, false, 0x0001); Require(desktop != IntPtr.Zero, "UI_CAPTION_INPUT_DESKTOP_UNAVAILABLE");
      Require(String.Equals(DesktopName(desktop), DesktopName(GetThreadDesktop(GetCurrentThreadId())), StringComparison.Ordinal), "UI_CAPTION_DESKTOP_MISMATCH");
      oldDpi = SetThreadDpiAwarenessContext(new IntPtr(-4)); Require(oldDpi != IntPtr.Zero, "UI_CAPTION_DPI_CONTEXT_FAILED");
      Rect rect; Require(GetWindowRect(root, out rect), "UI_CAPTION_RECT_API");
      result["windowRect"]=new int[]{rect.Left,rect.Top,rect.Right,rect.Bottom};
      uint dpi=GetDpiForWindow(root); Require(dpi > 0, "UI_CAPTION_DPI_QUERY_FAILED");
      int caption=GetSystemMetricsForDpi(4,dpi), frame=GetSystemMetricsForDpi(33,dpi), pad=GetSystemMetricsForDpi(92,dpi);
      Require(caption > 0 && rect.Right-rect.Left >= 400, "UI_CAPTION_RECT_TOO_SMALL");
      var point = new Point { X=rect.Left+(rect.Right-rect.Left)/3, Y=rect.Top+frame+pad+caption/2 };
      Require(point.X>rect.Left && point.X<rect.Right && point.Y>rect.Top && point.Y<rect.Bottom, "UI_CAPTION_POINT_OUTSIDE");
      Require(point.X>=Int16.MinValue && point.X<=Int16.MaxValue && point.Y>=Int16.MinValue && point.Y<=Int16.MaxValue, "UI_CAPTION_POINT_INT16_RANGE");
      result["point"] = new int[] {point.X,point.Y}; result["dpi"] = dpi;
      result["stage"] = "caption-hit-test"; PointOwned(point,root,pid,deadline,result);
      uint wait=(uint)Math.Min(hitMaxMs, Math.Max(1,(deadline-DateTime.UtcNow).TotalMilliseconds)); UIntPtr hit;
      long packed=(long)(unchecked((uint)(ushort)(short)point.X) | (unchecked((uint)(ushort)(short)point.Y) << 16));
      Require(SendMessageTimeout(root,0x0084,UIntPtr.Zero,new IntPtr(unchecked((int)packed)),0x0002|0x0020,wait,out hit)!=IntPtr.Zero, "UI_CAPTION_HIT_TEST_TIMEOUT");
      Require(hit.ToUInt64()==2, "UI_CAPTION_NOT_HTCAPTION");
      Identity(held,pid,exe,born,root,deadline); PointOwned(point,root,pid,deadline,result);
      Require(InputReleased(), "UI_CAPTION_INPUT_ALREADY_PRESSED_OR_CAPTURED");
      int left=GetSystemMetrics(76), top=GetSystemMetrics(77), width=GetSystemMetrics(78), height=GetSystemMetrics(79);
      result["virtualScreen"]=new int[]{left,top,width,height};
      Require(width>1 && height>1 && point.X>=left && point.X<left+width && point.Y>=top && point.Y<top+height, "UI_CAPTION_VIRTUAL_SCREEN_INVALID");
      int x=NormalizeAbsoluteCoordinate(point.X,left,width), y=NormalizeAbsoluteCoordinate(point.Y,top,height);
      result["normalizedPoint"]=new int[]{x,y};
      // 命中与输入之间仍可能发生窗口竞争；不作原子目标保证，且不换点重试。
      Identity(held,pid,exe,born,root,deadline); PointOwned(point,root,pid,deadline,result); Time(deadline);
      var inputs=new Input[] {Mouse(x,y,0x0001|0x8000|0x4000),Mouse(0,0,0x0002),Mouse(0,0,0x0004)};
      int inputSize=Marshal.SizeOf(typeof(Input)); Require(inputSize==(IntPtr.Size==8?40:28), "UI_CAPTION_INPUT_LAYOUT_INVALID");
      result["stage"]="single-input"; result["beforeInputAt"]=DateTime.UtcNow.ToString("o"); result["sendInputCalls"]=1;
      uint sent=SendInput(3,inputs,inputSize); ownDownProven=sent==2;
      result["inputSent"]=sent; result["afterInputAt"]=DateTime.UtcNow.ToString("o");
      result["leftDownAfterInput"]=(GetAsyncKeyState(1)&0x8000)!=0; result["ownDownProven"]=ownDownProven;
      Require(sent==3, "UI_CAPTION_PARTIAL_OR_BLOCKED_INPUT");
      result["stage"]="observe-input-processing";
      DateTime observationDeadline=DateTime.UtcNow.AddMilliseconds(observeMs);
      if(observationDeadline>deadline) observationDeadline=deadline;
      var observationClock=System.Diagnostics.Stopwatch.StartNew();
      var observations=new List<Dictionary<string,object>>(); result["observations"]=observations;
      while(true) {
        Identity(held,pid,exe,born,root,deadline);
        Point actual; Require(GetCursorPos(out actual), "UI_CAPTION_CURSOR_QUERY_FAILED");
        IntPtr hitWindow=WindowFromPoint(actual), foreground=GetForegroundWindow();
        bool cursorMatches=actual.X==point.X && actual.Y==point.Y;
        bool pointOwned=hitWindow!=IntPtr.Zero && GetAncestor(hitWindow,2)==root && Owner(hitWindow)==pid;
        bool owner=foreground!=IntPtr.Zero && Owner(foreground)==pid;
        bool exact=foreground==root && owner, released=InputReleased();
        observations.Add(new Dictionary<string,object>{{"at",DateTime.UtcNow.ToString("o")},{"cursorMatches",cursorMatches},{"actualCursor",new int[]{actual.X,actual.Y}},
          {"pointOwned",pointOwned},{"foregroundNull",foreground==IntPtr.Zero},{"ownerIsBoundMain",owner},{"exactRoot",exact},{"inputReleased",released}});
        result["actualCursor"]=new int[]{actual.X,actual.Y}; result["foregroundNull"]=foreground==IntPtr.Zero;
        result["ownerIsBoundMain"]=owner; result["exactRoot"]=exact; result["inputReleased"]=released;
        Require(DateTime.UtcNow<=observationDeadline && observationClock.ElapsedMilliseconds<=observeMs,"UI_CAPTION_INPUT_NOT_OBSERVED_WITHIN_SETUP");
        if(cursorMatches && pointOwned && exact && released) break;
        System.Threading.Thread.Sleep((int)Math.Min(pollMs,Math.Max(1,(observationDeadline-DateTime.UtcNow).TotalMilliseconds)));
      }
      Identity(held,pid,exe,born,root,deadline); result["stage"]="complete"; result["passed"]=true;
    } catch(Exception error) { failure=error.GetType().Name+":"+error.Message; }
    finally {
      try {
        // 仅部分插入已证明本次 down 时补一次 up；它只清理，不重试激活或授予通过。
        result["releaseCleanupAttempted"]=false;
        if(ownDownProven) {
          result["releaseCleanupAttempted"]=true; result["releaseCleanupAt"]=DateTime.UtcNow.ToString("o");
          result["leftDownBeforeReleaseCleanup"]=(GetAsyncKeyState(1)&0x8000)!=0;
          uint released=SendInput(1,new Input[] {Mouse(0,0,0x0004)},Marshal.SizeOf(typeof(Input)));
          result["releaseCleanupInputSent"]=released;
          bool remains=(GetAsyncKeyState(1)&0x8000)!=0; result["leftDownAfterReleaseCleanup"]=remains;
          if(released!=1 || remains) cleanupErrors.Add("UI_CAPTION_OWNED_UP_NOT_CONFIRMED");
        }
      } catch(Exception) { cleanupErrors.Add("UI_CAPTION_OWNED_UP_CLEANUP_FAILED"); }
      try { if(oldDpi!=IntPtr.Zero && SetThreadDpiAwarenessContext(oldDpi)==IntPtr.Zero) cleanupErrors.Add("UI_CAPTION_DPI_RESTORE_FAILED"); }
      catch(Exception) { cleanupErrors.Add("UI_CAPTION_DPI_RESTORE_FAILED"); }
      try { if(desktop!=IntPtr.Zero && !CloseDesktop(desktop)) cleanupErrors.Add("UI_CAPTION_DESKTOP_CLOSE_FAILED"); }
      catch(Exception) { cleanupErrors.Add("UI_CAPTION_DESKTOP_CLOSE_FAILED"); }
      try { if(held!=IntPtr.Zero && !CloseHandle(held)) cleanupErrors.Add("UI_CAPTION_MAIN_HANDLE_CLOSE_FAILED"); }
      catch(Exception) { cleanupErrors.Add("UI_CAPTION_MAIN_HANDLE_CLOSE_FAILED"); }
    }
    if(cleanupErrors.Count>0 && failure==null) failure=cleanupErrors[0];
    if(failure!=null) { result["passed"]=false; result["error"]=failure; }
    result["cleanupErrors"]=cleanupErrors.ToArray(); result["finishedAt"]=DateTime.UtcNow.ToString("o");
    return result;
  }
}

