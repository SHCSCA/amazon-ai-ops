import ctypes
from ctypes import wintypes
import datetime
import json
import math
import os
import re
import sys
import uuid
import api
import eventHandler
import core
import globalPluginHandler
import globalVars
import synthDriverHandler
import versionInfo
from logHandler import log


def require(value, message):
    if not value:
        raise ValueError(message)


def exact(value, fields):
    require(isinstance(value, dict) and set(value) == set(fields), "屏读绑定字段必须精确且唯一")


def positive(value):
    return type(value) is int and value > 0


def canonical_token(value):
    return (isinstance(value, str) and re.fullmatch(r"[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}", value)
            and str(uuid.UUID(value)) == value)


def moment(value):
    require(isinstance(value, str) and value.endswith("Z"), "屏读时刻必须为UTC原件")
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))


def validate_binding(value):
    exact(value, ["schemaVersion", "providerKind", "runToken", "main", "renderer", "window", "storeContext", "nativeLaunch"])
    require(value["schemaVersion"] == "v16.nvda-provider-binding/1" and value["providerKind"] == "nvda-main-window-accessibility"
            and canonical_token(value["runToken"]), "屏读仅接受单一Main provider")
    main, renderer, window = value["main"], value["renderer"], value["window"]
    exact(main, ["pid", "creationTimeUtc", "handleCreationTimeUtc", "creationPrecision", "executablePath", "userDataDir", "ownerToken"])
    exact(renderer, ["pid", "creationTime", "creationTimeSource"])
    exact(window, ["id", "url", "rootHwnd"])
    exact(value["storeContext"], ["storeId", "browserProfileId", "marketplace", "currency", "businessTimezone", "businessDate", "sessionGeneration"])
    exact(value["nativeLaunch"], ["path", "sha256", "sizeBytes"])
    pattern = r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z"
    require(positive(main["pid"]) and all(isinstance(main[key], str) and re.fullmatch(pattern, main[key]) for key in ["creationTimeUtc", "handleCreationTimeUtc"])
            and main["creationTimeUtc"][:26] == main["handleCreationTimeUtc"][:26]
            and main["creationPrecision"] == "cim-microsecond+handle-100ns" and canonical_token(main["ownerToken"]), "Main出生原件缺失或不符")
    require(positive(renderer["pid"]) and renderer["pid"] != main["pid"] and type(renderer["creationTime"]) in [int, float]
            and math.isfinite(renderer["creationTime"]) and renderer["creationTime"] > 0
            and renderer["creationTimeSource"] == "electron.app.getAppMetrics.creationTime", "独立Renderer身份缺失")
    require(positive(window["id"]) and isinstance(window["rootHwnd"], str) and re.fullmatch(r"[1-9]\d*", window["rootHwnd"])
            and int(window["rootHwnd"]) <= 0xffffffffffffffff and isinstance(window["url"], str) and window["url"], "原生根窗口缺失")
    require(all(isinstance(main[key], str) and os.path.isabs(main[key]) for key in ["executablePath", "userDataDir"]), "Main路径原件缺失")
    context = value["storeContext"]
    require(context["marketplace"] == "US" and context["currency"] == "USD" and all(isinstance(context[key], str) and context[key]
            for key in ["storeId", "browserProfileId", "businessTimezone", "businessDate"])
            and type(context["sessionGeneration"]) is int and context["sessionGeneration"] >= 0, "当前店铺上下文缺失")
    require(re.fullmatch(r"[a-fA-F0-9]{64}", value["nativeLaunch"]["sha256"]) and positive(value["nativeLaunch"]["sizeBytes"]), "原生启动引用缺失")
    return value


class KeyInput(ctypes.Structure):
    _fields_ = [("vk", wintypes.WORD), ("scan", wintypes.WORD), ("flags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("extra", ctypes.c_size_t)]


class MouseInput(ctypes.Structure):
    _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG), ("data", wintypes.DWORD),
                ("flags", wintypes.DWORD), ("time", wintypes.DWORD), ("extra", ctypes.c_size_t)]


class InputValue(ctypes.Union):
    _fields_ = [("keyboard", KeyInput), ("mouse", MouseInput)]


class NativeInput(ctypes.Structure):
    _fields_ = [("kind", wintypes.DWORD), ("value", InputValue)]


class GuiThreadInfo(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("flags", wintypes.DWORD), ("active", wintypes.HWND),
                ("focus", wintypes.HWND), ("capture", wintypes.HWND), ("menu", wintypes.HWND),
                ("move", wintypes.HWND), ("caret", wintypes.HWND), ("rect", wintypes.RECT)]


def key_events(action):
    if action == "ReportFocus":
        return [(45, 1), (9, 0), (9, 2), (45, 3)]
    require(action in ["Tab", "ShiftTab"], "UI_NVDA_NATIVE_KEYS_ACTION_INVALID")
    return [(9, 0), (9, 2)] if action == "Tab" else [(160, 0), (9, 0), (9, 2), (160, 2)]


def native_input(key, flags):
    value = NativeInput()
    value.kind, value.value.keyboard = 1, KeyInput(key, 0, flags, 0, 0)
    return value


def native_keys_result(action):
    return {"passed": False, "reason": "REQUEST_INVALID", "requestedEvents": len(key_events(action)),
            "acceptedEvents": 0, "sendInputCalls": 0, "steps": [], "afterProof": None,
            "cleanupOnly": False, "cleanupAttempted": False, "cleanupAcceptedEvents": 0,
            "cleanupKeys": [], "cleanupKeysReleased": True, "cleanupErrors": [], "atomicTargetGuarantee": False}


class NativeOwner:
    def __init__(self, binding):
        self.binding = binding
        self.reason = None
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.user = ctypes.WinDLL("user32", use_last_error=True)
        self.kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel.OpenProcess.restype = wintypes.HANDLE
        self.kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
        self.kernel.GetProcessTimes.restype = wintypes.BOOL
        self.kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        self.kernel.WaitForSingleObject.restype = wintypes.DWORD
        self.kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
        self.kernel.QueryFullProcessImageNameW.restype = wintypes.BOOL
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.restype = wintypes.BOOL
        self.user.IsWindow.argtypes = [wintypes.HWND]
        self.user.IsWindow.restype = wintypes.BOOL
        self.user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
        self.user.GetWindowThreadProcessId.restype = wintypes.DWORD
        self.user.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
        self.user.GetAncestor.restype = wintypes.HWND
        self.user.IsChild.argtypes = [wintypes.HWND, wintypes.HWND]
        self.user.IsChild.restype = wintypes.BOOL
        self.user.GetForegroundWindow.restype = wintypes.HWND
        self.user.SetForegroundWindow.argtypes = [wintypes.HWND]
        self.user.SetForegroundWindow.restype = wintypes.BOOL
        self.handle = self.kernel.OpenProcess(0x100000 | 0x1000, False, binding["main"]["pid"])
        require(bool(self.handle), "不能持有本次Main只读句柄")
        try:
            require(self.alive() and self.owner(int(binding["window"]["rootHwnd"])) == binding["main"]["pid"], "Main或根窗口原件不符")
        except Exception:
            self.close()
            raise

    def birth(self):
        values = [wintypes.FILETIME() for _ in range(4)]
        if not self.kernel.GetProcessTimes(self.handle, *(ctypes.byref(item) for item in values)):
            raise ctypes.WinError(ctypes.get_last_error())
        ticks = (values[0].dwHighDateTime << 32) | values[0].dwLowDateTime
        seconds, fraction = divmod(ticks, 10000000)
        date = datetime.datetime(1601, 1, 1, tzinfo=datetime.timezone.utc) + datetime.timedelta(seconds=seconds)
        return date.strftime("%Y-%m-%dT%H:%M:%S") + "." + str(fraction).zfill(7) + "Z"

    def alive(self):
        if self.kernel.WaitForSingleObject(self.handle, 0) != 258:
            return False
        buffer, length = ctypes.create_unicode_buffer(32768), wintypes.DWORD(32768)
        if not self.kernel.QueryFullProcessImageNameW(self.handle, 0, buffer, ctypes.byref(length)):
            raise ctypes.WinError(ctypes.get_last_error())
        return (self.birth() == self.binding["main"]["handleCreationTimeUtc"]
                and os.path.normcase(buffer.value) == os.path.normcase(self.binding["main"]["executablePath"]))

    def owner(self, hwnd):
        result = wintypes.DWORD()
        if not self.user.GetWindowThreadProcessId(hwnd, ctypes.byref(result)):
            raise ctypes.WinError(ctypes.get_last_error())
        return result.value

    def root(self):
        root = int(self.binding["window"]["rootHwnd"])
        self.reason = None
        if not self.alive():
            return self.reject("BIRTH")
        if not self.user.IsWindow(root) or self.owner(root) != self.binding["main"]["pid"]:
            return self.reject("ROOT_OWNER")
        if int(self.user.GetAncestor(root, 2) or 0) != root:
            return self.reject("ANCESTOR")
        if int(self.user.GetForegroundWindow() or 0) != root:
            return self.reject("FOREGROUND")
        return root

    def foreground(self, start, end):
        state = {"reason": "API", "foregroundNull": None, "ownerIsBoundMain": None, "exactRoot": None, "callReturnedTrue": None}
        root = int(self.binding["window"]["rootHwnd"])

        def owned_root():
            if not self.alive():
                return "BIRTH"
            if not self.user.IsWindow(root) or self.owner(root) != self.binding["main"]["pid"]:
                return "ROOT_OWNER"
            if int(self.user.GetAncestor(root, 2) or 0) != root:
                return "ANCESTOR"
            return None

        def readback():
            foreground = int(self.user.GetForegroundWindow() or 0)
            state["foregroundNull"] = foreground == 0
            state["ownerIsBoundMain"] = foreground != 0 and self.owner(foreground) == self.binding["main"]["pid"]
            state["exactRoot"] = foreground == root and state["ownerIsBoundMain"]

        try:
            reason = owned_root()
            if reason:
                state["reason"] = reason
                return state
            readback()
            reason = owned_root()
            if reason:
                state["reason"] = reason
                return state
            if state["exactRoot"]:
                state["reason"] = "ALREADY_OWNED"
                return state
            if not start <= datetime.datetime.now(datetime.timezone.utc) <= end:
                state["reason"] = "REQUEST_EXPIRED"
                return state
            # 只尝试一次本次根窗口；禁止通过线程附加、全局按键或权限回退抢占前台。
            state["callReturnedTrue"] = bool(self.user.SetForegroundWindow(root))
            state.update(foregroundNull=None, ownerIsBoundMain=None, exactRoot=None)
            reason = owned_root()
            if reason:
                state["reason"] = reason
                return state
            readback()
            reason = owned_root()
            state["reason"] = reason or ("EXACT_ROOT_ESTABLISHED" if state["exactRoot"] else "NOT_ESTABLISHED")
        except Exception:
            state["reason"] = "API"
            log.exception("隔离屏读原生前台确认失败")
        return state

    def reject(self, reason):
        self.reason = reason
        return None

    def focus(self, focus_pid, focus_hwnd):
        root = self.root()
        if not root:
            return None
        if focus_pid != self.binding["main"]["pid"] or not positive(focus_hwnd) or not self.user.IsWindow(focus_hwnd):
            return self.reject("FOCUS_OWNER")
        owner, ancestor = self.owner(focus_hwnd), int(self.user.GetAncestor(focus_hwnd, 2) or 0)
        child = bool(self.user.IsChild(root, focus_hwnd))
        if owner != focus_pid:
            return self.reject("FOCUS_OWNER")
        if ancestor != root:
            return self.reject("ANCESTOR")
        if focus_hwnd != root and not child:
            return self.reject("IS_CHILD")
        return {"focusPid": focus_pid, "focusHwnd": str(focus_hwnd), "rootOwnerPid": self.binding["main"]["pid"],
                "focusOwnerPid": owner, "foregroundHwnd": str(root), "ancestorHwnd": str(ancestor), "isChild": child,
                "mainAlive": True, "handleCreationTimeUtc": self.birth()}

    def keys_api(self):
        declarations = {
            "SendInput": ([wintypes.UINT, ctypes.POINTER(NativeInput), ctypes.c_int], wintypes.UINT),
            "GetAsyncKeyState": ([ctypes.c_int], ctypes.c_short),
            "GetGUIThreadInfo": ([wintypes.DWORD, ctypes.POINTER(GuiThreadInfo)], wintypes.BOOL),
            "OpenInputDesktop": ([wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE),
            "GetThreadDesktop": ([wintypes.DWORD], wintypes.HANDLE),
            "GetUserObjectInformationW": ([wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)], wintypes.BOOL),
            "CloseDesktop": ([wintypes.HANDLE], wintypes.BOOL),
            "IsWindowVisible": ([wintypes.HWND], wintypes.BOOL), "IsWindowEnabled": ([wintypes.HWND], wintypes.BOOL),
            "IsIconic": ([wintypes.HWND], wintypes.BOOL)}
        for name, (arguments, result) in declarations.items():
            function = getattr(self.user, name)
            function.argtypes, function.restype = arguments, result
        self.kernel.GetCurrentThreadId.argtypes, self.kernel.GetCurrentThreadId.restype = [], wintypes.DWORD
        require(ctypes.sizeof(NativeInput) == (40 if ctypes.sizeof(ctypes.c_void_p) == 8 else 28), "UI_NVDA_NATIVE_KEYS_LAYOUT_INVALID")

    def keys_proof(self, held, end, report_focus=False):
        require(datetime.datetime.now(datetime.timezone.utc) <= end, "UI_NVDA_NATIVE_KEYS_DEADLINE")
        root = self.root()
        require(bool(root), "UI_NVDA_NATIVE_KEYS_OWNER_CHANGED")
        require(self.user.IsWindowVisible(root) and self.user.IsWindowEnabled(root) and not self.user.IsIconic(root),
                "UI_NVDA_NATIVE_KEYS_ROOT_UNAVAILABLE")
        desktop = self.user.OpenInputDesktop(0, False, 1)
        require(bool(desktop), "UI_NVDA_NATIVE_KEYS_DESKTOP_UNAVAILABLE")
        failure = None
        try:
            names = []
            for handle in [desktop, self.user.GetThreadDesktop(self.kernel.GetCurrentThreadId())]:
                buffer, needed = ctypes.create_unicode_buffer(512), wintypes.DWORD()
                require(bool(handle) and self.user.GetUserObjectInformationW(handle, 2, buffer, ctypes.sizeof(buffer), ctypes.byref(needed)),
                        "UI_NVDA_NATIVE_KEYS_DESKTOP_QUERY_FAILED")
                names.append(buffer.value)
            require(names[0] == names[1], "UI_NVDA_NATIVE_KEYS_DESKTOP_CHANGED")
        except Exception as error:
            failure = error
        finally:
            try:
                require(self.user.CloseDesktop(desktop), "UI_NVDA_NATIVE_KEYS_DESKTOP_CLOSE_FAILED")
            except Exception as error:
                self.log_failure("v16.ui_nvda_native_keys_desktop_cleanup_failed", error, {"stage": "desktop-close"})
                if failure is None:
                    failure = error
        if failure is not None:
            raise failure
        info = GuiThreadInfo()
        info.size = ctypes.sizeof(info)
        require(self.user.GetGUIThreadInfo(0, ctypes.byref(info)), "UI_NVDA_NATIVE_KEYS_GUI_QUERY_FAILED")
        active, focus = int(info.active or 0), int(info.focus or 0)
        require(active == root and bool(focus) and self.user.IsWindow(active) and self.user.IsWindow(focus)
                and self.owner(active) == self.binding["main"]["pid"] and self.owner(focus) == self.binding["main"]["pid"]
                and int(self.user.GetAncestor(focus, 2) or 0) == root and not any([info.capture, info.menu, info.move]),
                "UI_NVDA_NATIVE_KEYS_GUI_OWNER_CHANGED")
        allowed = set(held) | ({16} if 160 in held else set())
        require(all(key in allowed or not self.user.GetAsyncKeyState(key) & 0x8000
                    for key in [1, 2, 4, 5, 6, 9, 16, 17, 18, 91, 92, 160, 161, 162, 163, 164, 165] + ([45] if report_focus else [])),
                "UI_NVDA_NATIVE_KEYS_INPUT_HELD")
        require(self.root() == root and datetime.datetime.now(datetime.timezone.utc) <= end, "UI_NVDA_NATIVE_KEYS_OWNER_CHANGED")
        return {"mainPid": self.binding["main"]["pid"], "mainAlive": True, "handleCreationTimeUtc": self.birth(),
                "mainExeMatches": True, "rootHwnd": str(root), "activeHwnd": str(active), "focusHwnd": str(focus),
                "focusOwnerPid": self.binding["main"]["pid"], "focusAncestorHwnd": str(root),
                "inputDesktopMatched": True, "otherInputReleased": True, "heldKeys": list(held)}

    def native_keys(self, action, end, stopping, result):
        self.keys_api()
        held, failure = [], None
        try:
            for index, (key, flags) in enumerate(key_events(action)):
                result["reason"] = "PRE_INPUT_GATE"
                require(not stopping(), "UI_NVDA_NATIVE_KEYS_STOP_PENDING")
                proof = self.keys_proof(held, end, action == "ReportFocus")
                result["reason"] = "INPUT_NOT_ACCEPTED"
                result["sendInputCalls"] += 1
                before_input = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                accepted = int(self.user.SendInput(1, ctypes.byref(native_input(key, flags)), ctypes.sizeof(NativeInput)))
                result["steps"].append({"index": index, "key": key, "flags": flags, "accepted": accepted, "proof": proof, "beforeInputAt": before_input,
                                        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")})
                require(accepted in [0, 1], "UI_NVDA_NATIVE_KEYS_COUNT_INVALID")
                if accepted == 1:
                    result["acceptedEvents"] += 1
                    if not flags & 2: held.append(key)
                    else: held.remove(key)
                require(accepted == 1, "UI_NVDA_NATIVE_KEYS_PARTIAL_INPUT")
            result["reason"] = "POST_INPUT_GATE"
            result["afterProof"] = self.keys_proof([], end, action == "ReportFocus")
            require(not stopping(), "UI_NVDA_NATIVE_KEYS_STOP_PENDING")
            result.update(passed=True, reason="COMPLETE")
        except Exception as error:
            failure = error
        finally:
            if held:
                result.update(passed=False, cleanupOnly=True, cleanupAttempted=True, cleanupKeys=list(reversed(held)))
                cleanup_end = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(milliseconds=1000)
                # 仅回收本次逐事件确认的未配对down；最多两次keyup，不重试输入或延长节点信用。
                for key in reversed(held):
                    try:
                        require(datetime.datetime.now(datetime.timezone.utc) <= cleanup_end, "UI_NVDA_NATIVE_KEYS_CLEANUP_DEADLINE")
                        released = int(self.user.SendInput(1, ctypes.byref(native_input(key, 3 if action == "ReportFocus" and key == 45 else 2)), ctypes.sizeof(NativeInput)))
                        result["cleanupAcceptedEvents"] += released if released in [0, 1] else 0
                        require(released == 1, "UI_NVDA_NATIVE_KEYS_CLEANUP_NOT_ACCEPTED")
                    except Exception as error:
                        result["cleanupErrors"].append("KEYUP_NOT_ACCEPTED")
                        self.log_failure("v16.ui_nvda_native_keys_keyup_cleanup_failed", error, {"stage": "bounded-keyup"})
                try:
                    result["cleanupKeysReleased"] = all(not self.user.GetAsyncKeyState(key) & 0x8000 for key in held)
                except Exception as error:
                    result["cleanupKeysReleased"] = False
                    result["cleanupErrors"].append("KEYUP_READBACK_FAILED")
                    self.log_failure("v16.ui_nvda_native_keys_keyup_readback_failed", error, {"stage": "keyup-readback"})
                if not result["cleanupKeysReleased"]:
                    result["cleanupErrors"].append("OWNED_KEY_STILL_HELD")
        if failure is not None:
            raise failure
        require(result["passed"] and not result["cleanupErrors"], "UI_NVDA_NATIVE_KEYS_NOT_COMPLETE")


    def close(self):
        if self.handle:
            if not self.kernel.CloseHandle(self.handle):
                raise ctypes.WinError(ctypes.get_last_error())
            self.handle = None


class GlobalPlugin(globalPluginHandler.GlobalPlugin):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.output = os.path.join(globalVars.appArgs.configPath, "actual-speech.jsonl")
        with open(os.path.join(globalVars.appArgs.configPath, "collector-target.json"), "r", encoding="utf-8") as source:
            self.binding = validate_binding(json.load(source))
        self.native = NativeOwner(self.binding)
        self.native.log_failure = self.log_failure
        self.row_count, self.last_sequence, self.last_nonce = 0, 0, None
        self.seen_nonces = set()
        self.foreground_sequence, self.foreground_nonces = 0, set()
        self.focus_generation, self.focus_event_object, self.focus_event_at = 0, None, None
        self.focus_sequence, self.focus_phase, self.focus_node_nonce, self.focus_nonces = 0, -1, None, set()
        self.focus_mode = None
        self.focus_diagnostic_identity, self.focus_diagnostic_counts = None, {}
        self.speech_diagnostic_identity, self.speech_diagnostic_counts = None, {}
        self.keys_sequence, self.keys_phase, self.keys_node_nonce, self.keys_nonces, self.keys_failed = 0, -1, None, set(), False
        self.stopped, self.registered, self.diagnostic_sequence, self.diagnostic_counts = False, False, 0, {}
        self.startup_action = getattr(core, "postNvdaStartup", None)
        self.startup_registered, self.startup_attempted, self.startup_complete = False, False, False
        try:
            require(callable(getattr(core, "callLater", None)) and callable(getattr(core, "triggerNVDAExit", None)), "屏读专属退出接口缺失")
            require(callable(getattr(self.startup_action, "register", None))
                    and callable(getattr(self.startup_action, "unregister", None)), "屏读启动完成通知接口缺失")
            self.startup_action.register(self.on_startup_complete)
            self.startup_registered = True
            synthDriverHandler.pre_synthSpeak.register(self.observe)
            self.registered = True
            self.write({"kind": "nvda-observer-ready", "engine": "NVDA", "version": versionInfo.version,
                        "pid": os.getpid(), "binding": self.binding})
            core.callLater(100, self.poll_stop)
        except Exception as error:
            self.log_failure("v16.ui_nvda_observer_initialize_failed", error)
            try:
                self.terminate()
            except Exception as cleanup_error:
                self.log_failure("v16.ui_nvda_observer_initialize_cleanup_failed", cleanup_error)
            raise

    def log_failure(self, event, error, context=None):
        record = {"timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                  "level": "error", "event": event,
                  "context": {"pid": os.getpid(), "runToken": self.binding["runToken"], "errorType": type(error).__name__}}
        if context:
            record["context"].update({key: context[key] for key in ["stage", "pathLength", "targetPathLength"] if key in context})
        for key in ["errno", "winerror"]:
            value = getattr(error, key, None)
            if type(value) is int:
                record["context"][key] = value
        try:
            log.error(json.dumps(record, ensure_ascii=False))
        except Exception as logging_error:
            record["context"].update(originalEvent=event, loggingErrorType=type(logging_error).__name__)
            record["event"] = "v16.ui_nvda_observer_log_failed"
            try:
                sys.stderr.write(json.dumps(record, ensure_ascii=False) + "\n")
            except Exception:
                pass  # 日志出口均关闭仍保留原错误和自有清理边界。

    def on_startup_complete(self):
        if self.stopped or self.startup_attempted:
            return
        self.startup_attempted = True
        try:
            require(self.startup_registered, "屏读启动完成回调未注册")
            record = {"kind": "nvda-observer-startup-complete", "schemaVersion": 1, "engine": "NVDA",
                      "version": versionInfo.version, "pid": os.getpid(), "runToken": self.binding["runToken"],
                      "binding": self.binding, "startupSource": "core.postNvdaStartup",
                      "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")}
            # 独立原件不占用自然语音序号；Windows 同目录重命名不会覆盖已有目标。
            target = os.path.join(globalVars.appArgs.configPath, "nvda-startup-complete.json")
            require(not os.path.exists(target), "屏读启动完成原件已存在")
            with open(target + ".tmp", "x", encoding="utf-8") as output:
                json.dump(record, output, ensure_ascii=False)
                output.flush()
                os.fsync(output.fileno())
            os.rename(target + ".tmp", target)
            self.startup_complete = True
        except Exception as error:
            self.log_failure("v16.ui_nvda_startup_complete_failed", error)

    def write(self, record):
        record["timestamp"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        record["rawIndex"] = self.row_count
        with open(self.output, "a", encoding="utf-8") as target:
            target.write(json.dumps(record, ensure_ascii=False) + "\n")
        self.row_count += 1

    def request(self):
        file = os.path.join(globalVars.appArgs.configPath, "collector-node.json")
        if not os.path.isfile(file):
            return None
        with open(file, "r", encoding="utf-8") as source:
            command = json.load(source)
        exact(command, ["runToken", "request", "focusMode"])
        require(command["runToken"] == self.binding["runToken"], "屏读节点属于其他运行")
        require(command["focusMode"] in ["sequential", "named-dialog-container"]
                and (command["focusMode"] != "named-dialog-container" or command["request"].get("role") == "dialog"), "节点回焦模式无效")
        value = command["request"]
        exact(value, ["sequence", "nonce", "nodeId", "name", "role", "rawOffset", "startedAt", "deadlineAt"])
        require(positive(value["sequence"]) and canonical_token(value["nonce"]) and all(isinstance(value[key], str) and value[key] for key in ["nodeId", "name", "role"])
                and type(value["rawOffset"]) is int and 1 <= value["rawOffset"] <= self.row_count, "屏读节点原件缺失")
        require(value["nonce"] not in self.foreground_nonces | self.focus_nonces | self.keys_nonces, "语音与其他控制请求不能共用nonce")
        now, start, end = datetime.datetime.now(datetime.timezone.utc), moment(value["startedAt"]), moment(value["deadlineAt"])
        require(0 < (end - start).total_seconds() <= 10, "屏读节点预算不能扩展")
        if not start <= now <= end:
            return None
        require((value["sequence"] > self.last_sequence and value["nonce"] not in self.seen_nonces)
                or (value["sequence"] == self.last_sequence and value["nonce"] == self.last_nonce), "屏读节点序号或nonce复用")
        self.seen_nonces.add(value["nonce"])
        self.last_sequence, self.last_nonce = value["sequence"], value["nonce"]
        return value

    def diagnose(self, request, reason):
        # 固定原因限量记入屏读日志，不保存外部窗口身份或名称，也不生成语音证据。
        if reason not in ["BIRTH", "ROOT_OWNER", "FOREGROUND", "FOCUS_OWNER", "IS_CHILD", "ANCESTOR", "API"]:
            reason = "API"
        if self.diagnostic_sequence != request["sequence"]:
            self.diagnostic_sequence, self.diagnostic_counts = request["sequence"], {}
        if self.diagnostic_counts.get(reason, 0) >= 1000:
            return
        self.diagnostic_counts[reason] = self.diagnostic_counts.get(reason, 0) + 1
        count = self.diagnostic_counts[reason]
        if count in [1, 10, 100, 1000]:
            log.warning("UI_NVDA_PROVIDER_REJECT reason=%s count=%s nodeSequence=%s" % (reason, count, request["sequence"]))

    def diagnose_speech(self, request, reason):
        try:
            if reason not in ["CALLBACK_SEEN", "NAME_OR_ROLE_MISMATCH", "NO_STRING_ITEMS", "ACCEPTED"]:
                return
            identity = (request["sequence"], request["nonce"])
            if self.speech_diagnostic_identity != identity:
                self.speech_diagnostic_identity, self.speech_diagnostic_counts = identity, {}
            count = self.speech_diagnostic_counts.get(reason, 0)
            if count >= 1000:
                return
            count += 1
            self.speech_diagnostic_counts[reason] = count
            if count not in [1, 10, 100, 1000]:
                return
            # 使用NVDA日志外层时刻，只记录原回调的有限阶段，不读取名称、语音或新时钟。
            log.warning(json.dumps({"level": "warning", "event": "v16.ui_nvda_speech_callback",
                                   "context": {"runToken": self.binding["runToken"], "nodeSequence": request["sequence"],
                                               "reason": reason, "count": count,
                                               "formalCredit": False}}, ensure_ascii=False))
        except Exception as error:
            try:
                self.log_failure("v16.ui_nvda_speech_diagnostic_failed", error)
            except Exception:
                pass  # 诊断出口失败不得改变原语音判定或写入。

    def observe(self, speechSequence):
        request = None
        try:
            # 先核原生归属与单节点时窗，再读取对象名称和实际合成器字符串。
            if self.stopped:
                return
            request = self.request()
            if not request:
                return
            self.diagnose_speech(request, "CALLBACK_SEEN")
            if not self.native.root():
                self.diagnose(request, self.native.reason)
                return
            focus = api.getFocusObject()
            focus_pid = focus.processID
            if focus_pid != self.binding["main"]["pid"]:
                self.diagnose(request, "FOCUS_OWNER")
                return
            proof = self.native.focus(focus_pid, focus.windowHandle)
            if not proof:
                self.diagnose(request, self.native.reason)
                return
            name, role = focus.name, focus.role.name.lower()
            normalized = {"editabletext": "textbox", "radiobutton": "radio", "propertypage": "tabpanel"}.get(role, role)
            if name != request["name"] or normalized != request["role"]:
                self.diagnose_speech(request, "NAME_OR_ROLE_MISMATCH")
                return
            texts = [item for item in speechSequence if isinstance(item, str)]
            if not texts:
                self.diagnose_speech(request, "NO_STRING_ITEMS")
                return
            self.write({"kind": "nvda-synth-speech", "engine": "NVDA", "version": versionInfo.version, "pid": os.getpid(),
                        "binding": self.binding, "request": request, **proof, "focusName": name, "focusRole": role,
                        "synthesizer": synthDriverHandler.getSynth().name, "spoken": " ".join(texts)})
            self.diagnose_speech(request, "ACCEPTED")
        except Exception:
            if request:
                self.diagnose(request, "API")
            log.exception("隔离屏读观察出口失败")

    def event_gainFocus(self, obj, nextHandler):
        completed = False
        try:
            nextHandler()
            completed = True
        finally:
            # 不拦截或重放自然事件；只有原处理链成功返回才记录处理完成。
            if completed:
                try:
                    if self.stopped or not self.native.root() or obj.processID != self.binding["main"]["pid"]:
                        return
                    if not self.native.focus(obj.processID, obj.windowHandle):
                        return
                    self.focus_generation += 1
                    self.focus_event_object, self.focus_event_at = obj, datetime.datetime.now(datetime.timezone.utc)
                    state = {"kind": "nvda-owned-focus-state", "schemaVersion": 1, "runToken": self.binding["runToken"],
                             "pid": os.getpid(), "binding": self.binding, "generation": self.focus_generation,
                             "eventTimestamp": self.focus_event_at.isoformat(timespec="milliseconds").replace("+00:00", "Z")}
                    target = os.path.join(globalVars.appArgs.configPath, "collector-focus-state.json")
                    temporary = target + "." + str(uuid.uuid4()) + ".tmp"
                    with open(temporary, "x", encoding="utf-8") as output:
                        json.dump(state, output)
                    os.replace(temporary, target)
                except Exception as error:
                    self.log_failure("v16.ui_nvda_focus_event_record_failed", error)

    def diagnose_focus(self, command, reason, role_token="NOT_READ", **gates):
        try:
            # 诊断只消费已校验元数据，不再读取对象或生成焦点、语音、ACK信用。
            if self.stopped or os.path.isfile(os.path.join(globalVars.appArgs.configPath, "collector-stop.json")):
                return
            start, end = moment(command["startedAt"]), moment(command["deadlineAt"])
            if not start <= datetime.datetime.now(datetime.timezone.utc) <= end or not 0 < (end - start).total_seconds() <= 10:
                return
            if (command["runToken"] != self.binding["runToken"] or command["pid"] != os.getpid()
                    or not canonical_token(command["nonce"]) or not canonical_token(command["nodeNonce"])
                    or not positive(command["nodeSequence"]) or command["phase"] not in ["first-focus", "tab", "target-handoff", "target-focus"]):
                return
            if reason not in ["ROOT_NOT_OWNED", "FOCUS_OWNER", "FOCUS_PROOF", "GAIN_FOCUS_PENDING",
                              "LAST_QUEUED_MISMATCH", "NAME_OR_ROLE_MISMATCH", "FRESH_EVENT_NOT_OBSERVED"]:
                return
            if role_token not in ["NOT_READ", "OTHER", "button", "tab", "dialog", "alertdialog", "textbox", "editabletext",
                                  "radio", "radiobutton", "propertypage", "tabpanel", "checkbox", "combobox", "list", "listitem",
                                  "table", "row", "cell", "heading", "link", "grouping", "section", "statusbar", "progressbar",
                                  "togglebutton", "treeviewitem", "treeviewbutton", "dropdownbutton", "menubutton", "splitbutton"]:
                role_token = "OTHER"
            allowed = ["rootOwned", "focusOwned", "proofValid", "pendingFocusEvents", "lastQueuedMatches",
                       "nameMatches", "roleMatches", "freshEventObserved", "allowAlreadyFocused"]
            context = {key: gates[key] for key in allowed if key in gates and type(gates[key]) is bool}
            identity = (command["nodeSequence"], command["nodeNonce"], command["phase"])
            if self.focus_diagnostic_identity != identity:
                self.focus_diagnostic_identity, self.focus_diagnostic_counts = identity, {}
            # 独立计数每阶段每原因最多记录四次，不消耗自然语音拒绝计数。
            count = self.focus_diagnostic_counts.get(reason, 0)
            if count >= 1000:
                return
            count += 1
            self.focus_diagnostic_counts[reason] = count
            if count not in [1, 10, 100, 1000]:
                return
            now = datetime.datetime.now(datetime.timezone.utc)
            if self.stopped or os.path.isfile(os.path.join(globalVars.appArgs.configPath, "collector-stop.json")) or not start <= now <= end:
                return
            context.update(pid=os.getpid(), runToken=self.binding["runToken"], nonce=command["nonce"],
                           nodeSequence=command["nodeSequence"], phase=command["phase"], reason=reason, count=count,
                           roleToken=role_token, eventGeneration=self.focus_generation,
                           baselineGeneration=command["baselineGeneration"], formalCredit=False)
            record = {"timestamp": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                      "level": "warning", "event": "v16.ui_nvda_focus_rejected", "context": context}
            log.warning(json.dumps(record, ensure_ascii=False))
        except Exception as error:
            try:
                self.log_failure("v16.ui_nvda_focus_diagnostic_failed", error)
            except Exception:
                pass  # 诊断日志故障不得替换原拒绝或协议异常。

    def poll_focus(self):
        file = os.path.join(globalVars.appArgs.configPath, "collector-focus.json")
        stage, current_path, target = "read-request", file, None
        try:
            if not os.path.isfile(file):
                return
            with open(file, "r", encoding="utf-8") as source:
                command = json.load(source)
            stage = "validate-request"
            fields = ["kind", "schemaVersion", "runToken", "pid", "nonce", "nodeSequence", "nodeNonce", "nodeId", "phase", "focusMode",
                      "phaseStartedAt", "startedAt", "deadlineAt", "baselineGeneration", "allowAlreadyFocused", "name", "role"]
            exact(command, fields)
            require(command["kind"] == "nvda-owned-focus-request" and command["schemaVersion"] == 1
                    and command["runToken"] == self.binding["runToken"] and command["pid"] == os.getpid()
                    and canonical_token(command["nonce"]) and canonical_token(command["nodeNonce"])
                    and command["nonce"] != command["nodeNonce"] and command["nonce"] not in self.focus_nonces
                    and command["nonce"] not in self.foreground_nonces | self.seen_nonces | self.keys_nonces
                    and positive(command["nodeSequence"]) and type(command["baselineGeneration"]) is int
                    and 0 <= command["baselineGeneration"] <= self.focus_generation
                    and type(command["allowAlreadyFocused"]) is bool
                    and all(isinstance(command[key], str) and command[key] for key in ["nodeId", "name", "role"]), "焦点请求身份无效")
            stage, current_path = "read-node", os.path.join(globalVars.appArgs.configPath, "collector-node.json")
            with open(current_path, "r", encoding="utf-8") as source:
                node = json.load(source)
            stage = "validate-node"
            exact(node, ["runToken", "request", "focusMode"])
            request = node["request"]
            exact(request, ["sequence", "nonce", "nodeId", "name", "role", "rawOffset", "startedAt", "deadlineAt"])
            require(node["runToken"] == self.binding["runToken"] and request["sequence"] == command["nodeSequence"]
                    and request["nonce"] == command["nodeNonce"] and request["nodeId"] == command["nodeId"]
                    and request["startedAt"] == command["startedAt"] and request["deadlineAt"] == command["deadlineAt"], "焦点请求与原节点不一致")
            mode = node["focusMode"]
            require(mode in ["sequential", "named-dialog-container"] and command["focusMode"] == mode
                    and (mode != "named-dialog-container" or request["role"] == "dialog"), "焦点模式与原节点不一致")
            phases = (["first-focus", "tab", "target-focus"] if mode == "sequential"
                      else ["first-focus", "tab", "target-handoff", "target-focus"])
            require(command["phase"] in phases, "焦点阶段未知")
            phase_index = phases.index(command["phase"])
            require((command["nodeSequence"] == self.focus_sequence + 1 and phase_index == 0)
                    or (command["nodeSequence"] == self.focus_sequence and phase_index == self.focus_phase + 1
                        and command["nodeNonce"] == self.focus_node_nonce and mode == self.focus_mode), "焦点阶段重放或乱序")
            require(command["phase"] == "first-focus" or command["allowAlreadyFocused"] is False, "移焦阶段禁止already-focused")
            if command["phase"] in ["first-focus", "target-focus"]:
                require(request["name"] == command["name"] and request["role"] == command["role"], "焦点目标与原节点不一致")
            now, start, end = datetime.datetime.now(datetime.timezone.utc), moment(command["startedAt"]), moment(command["deadlineAt"])
            phase_start = moment(command["phaseStartedAt"])
            require(start <= phase_start <= now <= end and 0 < (end - start).total_seconds() <= 10, "焦点阶段不能扩展原节点时限")
            stage = "inspect-focus"
            if self.stopped:
                return
            if not self.native.root():
                self.diagnose_focus(command, "ROOT_NOT_OWNED", rootOwned=False)
                return
            focus = api.getFocusObject()
            if focus.processID != self.binding["main"]["pid"]:
                self.diagnose_focus(command, "FOCUS_OWNER", rootOwned=True, focusOwned=False)
                return
            proof = self.native.focus(focus.processID, focus.windowHandle)
            if not proof:
                self.diagnose_focus(command, "FOCUS_PROOF", rootOwned=True, focusOwned=True, proofValid=False)
                return
            if eventHandler.isPendingEvents("gainFocus"):
                self.diagnose_focus(command, "GAIN_FOCUS_PENDING", rootOwned=True, focusOwned=True, proofValid=True, pendingFocusEvents=True)
                return
            if focus != eventHandler.lastQueuedFocusObject:
                self.diagnose_focus(command, "LAST_QUEUED_MISMATCH", rootOwned=True, focusOwned=True, proofValid=True, pendingFocusEvents=False, lastQueuedMatches=False)
                return
            raw_role = focus.role.name.lower()
            role = {"editabletext": "textbox", "radiobutton": "radio", "propertypage": "tabpanel"}.get(raw_role, raw_role)
            name_matches = focus.name == command["name"]
            if not name_matches or role != command["role"]:
                self.diagnose_focus(command, "NAME_OR_ROLE_MISMATCH", role_token=raw_role, rootOwned=True, focusOwned=True, proofValid=True,
                                    pendingFocusEvents=False, lastQueuedMatches=True, nameMatches=name_matches, roleMatches=role == command["role"])
                return
            event_current = (self.focus_event_object == focus and self.focus_generation > command["baselineGeneration"]
                             and self.focus_event_at is not None and self.focus_event_at >= phase_start)
            if not event_current and not command["allowAlreadyFocused"]:
                self.diagnose_focus(command, "FRESH_EVENT_NOT_OBSERVED", role_token=raw_role, rootOwned=True, focusOwned=True, proofValid=True,
                                    pendingFocusEvents=False, lastQueuedMatches=True, nameMatches=True, roleMatches=True,
                                    freshEventObserved=False, allowAlreadyFocused=False)
                return
            ack = {**command, "source": "event-gainFocus" if event_current else "already-focused",
                   "eventGeneration": self.focus_generation, "eventTimestamp": None if self.focus_event_at is None else
                   self.focus_event_at.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                   "observedAt": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                   "pendingFocusEvents": False, "focusMatchesExpected": True, "proof": proof}
            target = os.path.join(globalVars.appArgs.configPath, "collector-focus-ack-" + command["nonce"] + ".json")
            stage, current_path = "check-ack-target", target
            require(not os.path.exists(target), "焦点ACK不能覆盖旧原件")
            # 同目录短临时名兼容长路径宿主，仍独占创建且不覆盖既有原件。
            temporary = os.path.join(globalVars.appArgs.configPath, ".focus-" + str(uuid.uuid4()) + ".tmp")
            stage, current_path = "create-ack-temporary", temporary
            with open(temporary, "x", encoding="utf-8") as output:
                stage = "write-ack-temporary"
                json.dump(ack, output)
            stage = "check-publish-deadline"
            require(datetime.datetime.now(datetime.timezone.utc) <= end, "焦点ACK发布已过原节点时限")
            stage, current_path = "consume-request", file
            os.rename(file, os.path.join(globalVars.appArgs.configPath, "collector-focus-consumed-" + command["nonce"] + ".json"))
            self.focus_nonces.add(command["nonce"])
            self.focus_sequence, self.focus_phase, self.focus_node_nonce = command["nodeSequence"], phase_index, command["nodeNonce"]
            self.focus_mode = mode
            stage = "check-commit-deadline"
            require(datetime.datetime.now(datetime.timezone.utc) <= end, "焦点ACK提交已过原节点时限")
            stage, current_path = "publish-ack", temporary
            os.rename(temporary, target)
        except Exception as error:
            self.log_failure("v16.ui_nvda_focus_phase_failed", error, {"stage": stage,
                             "pathLength": len(current_path), "targetPathLength": len(target) if target else 0})

    def poll_foreground(self):
        file = os.path.join(globalVars.appArgs.configPath, "collector-foreground.json")
        if not os.path.isfile(file):
            return
        ack = {"kind": "nvda-observer-foreground-ack", "schemaVersion": 1, "runToken": self.binding["runToken"],
               "nonce": None, "pid": os.getpid(), "nodeSequence": None, "startedAt": None, "deadlineAt": None,
               "reason": "REQUEST_INVALID", "foregroundNull": None, "ownerIsBoundMain": None, "exactRoot": None, "callReturnedTrue": None}
        reason, claimed, start, end = "REQUEST_INVALID", False, None, None
        processing = os.path.join(globalVars.appArgs.configPath, "collector-foreground-processing.json")
        try:
            # 固定处理中路径不得覆盖；已消费原件在所有出口移入唯一历史文件。
            require(not os.path.exists(processing), "原生前台已有未结束命令")
            os.rename(file, processing)
            claimed = True
            with open(processing, "r", encoding="utf-8") as source:
                command = json.load(source)
            pattern = r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"
            if isinstance(command, dict):
                if canonical_token(command.get("nonce")):
                    ack["nonce"] = command["nonce"]
                if positive(command.get("nodeSequence")):
                    ack["nodeSequence"] = command["nodeSequence"]
                for key in ["startedAt", "deadlineAt"]:
                    if isinstance(command.get(key), str) and re.fullmatch(pattern, command[key]):
                        ack[key] = command[key]
            exact(command, ["schemaVersion", "command", "runToken", "nonce", "pid", "nodeSequence", "startedAt", "deadlineAt"])
            require(command["schemaVersion"] == 1 and type(command["schemaVersion"]) is int
                    and command["command"] == "ensure-foreground" and command["runToken"] == self.binding["runToken"]
                    and canonical_token(command["nonce"]) and positive(command["pid"]) and command["pid"] == os.getpid()
                    and positive(command["nodeSequence"]), "原生前台请求不属于本次节点")
            require(all(isinstance(command[key], str) and re.fullmatch(pattern, command[key]) for key in ["startedAt", "deadlineAt"]),
                    "原生前台请求时刻必须为UTC毫秒原件")
            start, end = moment(command["startedAt"]), moment(command["deadlineAt"])
            require(0 < (end - start).total_seconds() <= 10, "原生前台请求不能扩展节点预算")
            reason = "REQUEST_EXPIRED"
            require(start <= datetime.datetime.now(datetime.timezone.utc) <= end, "原生前台请求已失效")
            reason = "REQUEST_REPLAY"
            require(command["nodeSequence"] > self.foreground_sequence and command["nonce"] not in self.foreground_nonces
                    and command["nonce"] not in self.seen_nonces | self.focus_nonces | self.keys_nonces, "原生前台请求序号或nonce复用")
            self.foreground_sequence = command["nodeSequence"]
            self.foreground_nonces.add(command["nonce"])
            ack.update(self.native.foreground(start, end))
        except Exception:
            ack["reason"] = reason
            log.exception("隔离屏读原生前台请求失败")
        finally:
            if claimed:
                try:
                    history = os.path.join(globalVars.appArgs.configPath, "collector-foreground-processed-" + str(uuid.uuid4()) + ".json")
                    require(not os.path.exists(history), "原生前台历史路径必须为新文件")
                    os.rename(processing, history)
                except Exception:
                    ack["reason"] = "API"
                    log.exception("隔离屏读原生前台历史保存失败")
        try:
            now = datetime.datetime.now(datetime.timezone.utc)
            if start is not None and end is not None and not start <= now <= end:
                ack["reason"] = "REQUEST_EXPIRED"
            ack["timestamp"] = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
            name = "collector-foreground-ack-" + ack["nonce"] + ".json" if ack["nonce"] else "collector-foreground-invalid-ack-" + str(uuid.uuid4()) + ".json"
            target = os.path.join(globalVars.appArgs.configPath, name)
            require(not os.path.exists(target), "原生前台确认原件不得覆盖")
            with open(target + ".tmp", "x", encoding="utf-8") as output:
                json.dump(ack, output)
            os.rename(target + ".tmp", target)
            if ack["reason"] not in ["ALREADY_OWNED", "EXACT_ROOT_ESTABLISHED"]:
                log.warning("UI_NVDA_OWNED_FOREGROUND_NOT_ESTABLISHED reason=%s" % ack["reason"])
        except Exception:
            log.exception("隔离屏读原生前台确认出口失败")

    def report_modifier_evidence(self):
        import config
        from config.configFlags import NVDAKey
        keyboard = config.conf["keyboard"]
        keys, layout, injected = keyboard["NVDAModifierKeys"], keyboard["keyboardLayout"], keyboard["handleInjectedKeys"]
        mask = NVDAKey.EXTENDED_INSERT.value
        require(type(mask) is int and mask == 4 and type(keys) is int and keys == 4
                and layout == "desktop" and injected is True, "UI_NVDA_REPORT_MODIFIER_CONFIG_INVALID")
        return {"kind": "nvda-report-focus-modifier", "schemaVersion": 1, "source": "nvda.config.conf",
                "keyboardLayout": layout, "modifierKeys": keys, "extendedInsertMask": mask, "handleInjectedKeys": injected}

    def poll_native_keys(self):
        directory = globalVars.appArgs.configPath
        file, processing = os.path.join(directory, "collector-keys.json"), os.path.join(directory, "collector-keys-processing.json")
        if self.stopped or os.path.isfile(os.path.join(directory, "collector-stop.json")) or not os.path.isfile(file):
            return
        command, result, claimed, stage = None, None, False, "claim-request"
        modifier_evidence = None
        try:
            require(not os.path.exists(processing), "原生按键已有处理中原件")
            os.rename(file, processing)
            claimed, stage = True, "validate-request"
            with open(processing, "r", encoding="utf-8") as source:
                command = json.load(source)
            exact(command, ["kind", "schemaVersion", "runToken", "pid", "nonce", "nodeSequence", "nodeNonce", "nodeId",
                            "phase", "focusMode", "action", "phaseStartedAt", "startedAt", "deadlineAt"])
            require(command["kind"] == "nvda-owned-native-keys-request" and type(command["schemaVersion"]) is int and command["schemaVersion"] == 1
                    and command["runToken"] == self.binding["runToken"] and command["pid"] == os.getpid()
                    and canonical_token(command["nonce"]) and canonical_token(command["nodeNonce"])
                    and command["nonce"] != command["nodeNonce"] and positive(command["nodeSequence"])
                    and isinstance(command["nodeId"], str) and 0 < len(command["nodeId"]) <= 128
                    and command["phase"] in ["tab", "target-focus", "report-focus"]
                    and command["action"] == {"tab": "Tab", "target-focus": "ShiftTab", "report-focus": "ReportFocus"}[command["phase"]], "原生按键身份或窄动作不符")
            result = native_keys_result(command["action"])
            require(not self.keys_failed and command["nonce"] not in self.keys_nonces | self.focus_nonces | self.foreground_nonces | self.seen_nonces
                    and command["nodeNonce"] not in self.keys_nonces | self.focus_nonces | self.foreground_nonces,
                    "原生按键会话失败或nonce复用")
            phase = {"tab": 0, "target-focus": 1, "report-focus": 2}[command["phase"]]
            require((phase == 0 and command["nodeSequence"] == self.keys_sequence + 1)
                    or (phase in [1, 2] and command["nodeSequence"] == self.keys_sequence and self.keys_phase == phase - 1
                        and command["nodeNonce"] == self.keys_node_nonce), "原生按键阶段重放或乱序")
            require(phase != 2 or command["focusMode"] == "named-dialog-container", "UI_NVDA_REPORT_NAMED_DIALOG_REQUIRED")
            require(command["focusMode"] == self.focus_mode and self.focus_sequence == command["nodeSequence"] and self.focus_phase == (3 if phase == 2 else phase)
                    and self.focus_node_nonce == command["nodeNonce"], "原生按键前缺少本节点焦点处理ACK")
            with open(os.path.join(directory, "collector-node.json"), "r", encoding="utf-8") as source:
                node = json.load(source)
            exact(node, ["runToken", "request", "focusMode"])
            request = node["request"]
            exact(request, ["sequence", "nonce", "nodeId", "name", "role", "rawOffset", "startedAt", "deadlineAt"])
            require(node["runToken"] == self.binding["runToken"] and all(request[key] == command[other] for key, other in
                    [("sequence", "nodeSequence"), ("nonce", "nodeNonce"), ("nodeId", "nodeId"), ("startedAt", "startedAt"), ("deadlineAt", "deadlineAt")]),
                    "原生按键必须绑定当前节点原件")
            require(all(isinstance(command[key], str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", command[key])
                        for key in ["phaseStartedAt", "startedAt", "deadlineAt"]), "原生按键时刻必须为UTC毫秒原件")
            start, end, phase_start = moment(command["startedAt"]), moment(command["deadlineAt"]), moment(command["phaseStartedAt"])
            require(0 < (end - start).total_seconds() <= 10 and start <= phase_start <= datetime.datetime.now(datetime.timezone.utc) <= end,
                    "原生按键不能扩展或越过原节点时限")
            require(node["focusMode"] == command["focusMode"], "原生按键回焦模式与原件不符")
            if phase == 2:
                require(request["role"] == "dialog", "UI_NVDA_REPORT_NAMED_DIALOG_REQUIRED")
                stage = "report-modifier-config"
                modifier_evidence = self.report_modifier_evidence()
            history = os.path.join(directory, ".keys-consumed-" + command["nonce"] + ".json")
            require(not os.path.exists(history), "原生按键不能覆盖消费原件")
            os.rename(processing, history)
            claimed = False
            self.keys_nonces.add(command["nonce"])
            self.keys_sequence, self.keys_phase, self.keys_node_nonce = command["nodeSequence"], phase, command["nodeNonce"]
            stage = "owned-native-input"
            self.native.native_keys(command["action"], end,
                                    lambda: self.stopped or os.path.isfile(os.path.join(directory, "collector-stop.json")), result)
        except Exception as error:
            self.keys_failed = True
            if result is not None:
                result["passed"] = False
            self.log_failure("v16.ui_nvda_native_keys_failed", error, {"stage": stage, "pathLength": len(processing)})
        finally:
            if claimed:
                try:
                    os.rename(processing, os.path.join(directory, ".keys-rejected-" + str(uuid.uuid4()) + ".json"))
                except Exception as error:
                    self.keys_failed = True
                    if result is not None: result["passed"] = False
                    self.log_failure("v16.ui_nvda_native_keys_history_failed", error, {"stage": "save-rejected"})
        if result is not None and command is not None:
            try:
                if result["cleanupOnly"]:
                    self.log_failure("v16.ui_nvda_native_keys_cleanup_only", ValueError("自有按键回收不授节点信用"), {"stage": "bounded-keyup-cleanup"})
                ack = {**command, "result": result, "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")}
                if command["action"] == "ReportFocus":
                    ack["modifierEvidence"] = modifier_evidence
                target, temporary = os.path.join(directory, "collector-keys-ack-" + command["nonce"] + ".json"), os.path.join(directory, ".keys-" + str(uuid.uuid4()) + ".tmp")
                require(not os.path.exists(target), "原生按键ACK不能覆盖旧原件")
                with open(temporary, "x", encoding="utf-8") as output:
                    json.dump(ack, output)
                os.rename(temporary, target)
            except Exception as error:
                self.keys_failed = True
                self.log_failure("v16.ui_nvda_native_keys_ack_failed", error, {"stage": "publish-ack", "targetPathLength": len(target)})


    def poll_stop(self):
        if self.stopped:
            return
        try:
            file = os.path.join(globalVars.appArgs.configPath, "collector-stop.json")
            if os.path.isfile(file):
                with open(file, "r", encoding="utf-8") as source:
                    command = json.load(source)
                exact(command, ["command", "runToken", "nonce", "pid", "requestedAt"])
                require(command["command"] == "stop" and command["runToken"] == self.binding["runToken"]
                        and canonical_token(command["nonce"]) and command["pid"] == os.getpid(), "屏读停止请求不属于本次配置")
                now = datetime.datetime.now(datetime.timezone.utc)
                require(0 <= (now - moment(command["requestedAt"])).total_seconds() <= 15, "屏读停止请求已失效")
                self.stopped = True
                self.native.close()
                ack = {"kind": "nvda-observer-stop-ack", "schemaVersion": 1, "runToken": self.binding["runToken"],
                       "nonce": command["nonce"], "pid": os.getpid(), "timestamp": now.isoformat(timespec="milliseconds").replace("+00:00", "Z")}
                target = os.path.join(globalVars.appArgs.configPath, "collector-stop-ack.json")
                with open(target + ".tmp", "x", encoding="utf-8") as output:
                    json.dump(ack, output)
                os.replace(target + ".tmp", target)
                core.triggerNVDAExit()
                return
            self.poll_foreground()
            self.poll_native_keys()
            self.poll_focus()
        except Exception:
            log.exception("隔离屏读专属停止出口失败")
        core.callLater(100, self.poll_stop)

    def terminate(self):
        self.stopped = True
        callbacks = []
        if self.startup_registered:
            callbacks.append(("v16.ui_nvda_startup_unregister_failed",
                              lambda: self.startup_action.unregister(self.on_startup_complete), "startup_registered"))
        if self.registered:
            callbacks.append(("v16.ui_nvda_speech_unregister_failed",
                              lambda: synthDriverHandler.pre_synthSpeak.unregister(self.observe), "registered"))
        callbacks.extend([("v16.ui_nvda_native_close_failed", self.native.close, None),
                          ("v16.ui_nvda_plugin_terminate_failed", super().terminate, None)])
        failure = None
        for event, callback, flag in callbacks:
            try:
                callback()
                if flag:
                    setattr(self, flag, False)
            except Exception as error:
                self.log_failure(event, error)
                if failure is None:
                    failure = error
        if failure is not None:
            raise failure
