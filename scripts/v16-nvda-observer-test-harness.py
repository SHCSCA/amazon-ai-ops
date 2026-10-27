import ctypes
import datetime
import importlib.util
import json
import os
import sys
import types
import uuid

directory, source = sys.argv[1:3]
mode = sys.argv[3] if len(sys.argv) > 3 else "privacy"
if mode == "focus-phases" and len(sys.argv) > 4 and sys.argv[4] == "long-path":
    require_padding = 171 - len(os.path.abspath(directory)) - 1
    assert require_padding > 0, "隔离路径父目录过长"
    directory = os.path.join(directory, "p" * require_padding)
os.makedirs(directory, exist_ok=True)
now = datetime.datetime.now(datetime.timezone.utc)
birth = "2026-10-20T08:00:00.1234567Z"
binding = {"schemaVersion": "v16.nvda-provider-binding/1", "providerKind": "nvda-main-window-accessibility",
           "runToken": "22222222-2222-4222-8222-222222222222",
           "main": {"pid": 1234, "creationTimeUtc": birth[:-2] + "0Z", "handleCreationTimeUtc": birth,
                    "creationPrecision": "cim-microsecond+handle-100ns", "executablePath": os.path.abspath("unit-package/AmazonAIOpsAgent.exe"),
                    "userDataDir": os.path.abspath("unit-profile"), "ownerToken": "11111111-1111-4111-8111-111111111111"},
           "renderer": {"pid": 5678, "creationTime": 1792483200124.5, "creationTimeSource": "electron.app.getAppMetrics.creationTime"},
           "window": {"id": 1, "url": "file:///unit-package/index.html", "rootHwnd": "1000"},
           "storeContext": {"storeId": "unit-store", "browserProfileId": "unit-browser", "marketplace": "US", "currency": "USD",
                            "businessTimezone": "America/Los_Angeles", "businessDate": "2026-10-20", "sessionGeneration": 1},
           "nativeLaunch": {"path": os.path.abspath("unit-native-launch.json"), "sha256": "a" * 64, "sizeBytes": 100}}


def write(name, value):
    with open(os.path.join(directory, name), "w", encoding="utf-8") as target:
        json.dump(value, target)


write("collector-target.json", binding)
state = {"rootOwner": 1234, "focusOwner": 1234, "foreground": 1000, "ancestor": 1000, "isChild": True,
         "alive": True, "birth": birth, "apiFailure": False, "closed": 0, "nameReads": 0, "speechReads": 0, "quits": 0}
state.update(foregroundCalls=0, setReturn=True, setTarget=1000, setApiFailure=False, afterSet=None, clockMs=0, expireOnImage=False,
             rootWindow=True, rootAncestor=1000, imagePath=binding['main']['executablePath'])
warnings, errors, scheduled = [], [], []


class Base:
    def __init__(self, *args, **kwargs):
        pass

    def terminate(self):
        pass


class Focus:
    processID, windowHandle, text = 9999, 1001, "其他应用的私密标题"
    role = types.SimpleNamespace(name="BUTTON")

    @property
    def name(self):
        state["nameReads"] += 1
        assert self.processID == binding["main"]["pid"], "读取了外部应用名称"
        return self.text


class Sequence:
    def __init__(self, values):
        self.values = values

    def __iter__(self):
        state["speechReads"] += 1
        return iter(self.values)


class Function:
    def __init__(self, callback):
        self.callback = callback

    def __call__(self, *args):
        return self.callback(*args)


def process_times(handle, created, *unused):
    stamp, fraction = state["birth"].split(".")
    date = datetime.datetime.fromisoformat(stamp).replace(tzinfo=datetime.timezone.utc)
    epoch = datetime.datetime(1601, 1, 1, tzinfo=datetime.timezone.utc)
    ticks = int((date - epoch).total_seconds()) * 10000000 + int(fraction[:-1])
    created._obj.dwHighDateTime, created._obj.dwLowDateTime = ticks >> 32, ticks & 0xffffffff
    return True


def image(handle, flags, buffer, size):
    buffer.value = state["imagePath"]
    if state["expireOnImage"]:
        state.update(clockMs=11000, expireOnImage=False)
    return True


def owner(hwnd, result):
    result._obj.value = state["rootOwner"] if hwnd == 1000 else state["focusOwner"] if hwnd == 1001 else 9999
    return 1


def ancestor(hwnd, flags):
    if state["apiFailure"]:
        raise OSError("隔离WinAPI失败")
    return state["rootAncestor"] if hwnd == 1000 else state["ancestor"]


def set_foreground(hwnd):
    assert hwnd == 1000, "不得激活非本次根窗口"
    state["foregroundCalls"] += 1
    if state["setApiFailure"]:
        raise OSError("隔离前台API失败")
    state["foreground"] = state["setTarget"]
    if state["afterSet"]:
        state.update(state["afterSet"])
    return state["setReturn"]


kernel = types.SimpleNamespace(OpenProcess=Function(lambda access, inherit, pid: 9000 if pid == 1234 else 0),
    GetProcessTimes=Function(process_times), WaitForSingleObject=Function(lambda handle, timeout: 258 if state["alive"] else 0),
    QueryFullProcessImageNameW=Function(image), CloseHandle=Function(lambda handle: state.update(closed=state["closed"] + 1) or True))
user = types.SimpleNamespace(IsWindow=Function(lambda hwnd: hwnd in [1000, 1001] and (hwnd != 1000 or state["rootWindow"])), GetWindowThreadProcessId=Function(owner),
    GetAncestor=Function(ancestor), IsChild=Function(lambda root, child: state["isChild"]), GetForegroundWindow=Function(lambda: state["foreground"]))
user.SetForegroundWindow = Function(set_foreground)
class StartupAction:
    def __init__(self):
        self.handlers, self.fail_register, self.fail_unregister = [], False, False

    def register(self, callback):
        if self.fail_register:
            raise OSError("隔离启动注册失败")
        self.handlers.append(callback)

    def unregister(self, callback):
        if self.fail_unregister:
            raise OSError("隔离启动注销失败")
        if callback not in self.handlers:
            return False
        self.handlers.remove(callback)
        return True

    def notify(self):
        for callback in list(self.handlers):
            callback()


startup_action = StartupAction()
# 只替换WinAPI端口，真实NativeOwner与plugin调用链原样运行，假PID从不查询系统。
ctypes.WinDLL = lambda name, **unused: kernel if name == "kernel32" else user
focus = Focus()
sys.modules["api"] = types.SimpleNamespace(getFocusObject=lambda: focus)
sys.modules["eventHandler"] = types.SimpleNamespace(isPendingEvents=lambda event: bool(state.get("pendingFocus", False)), lastQueuedFocusObject=focus)
sys.modules["core"] = types.SimpleNamespace(callLater=lambda delay, callback: scheduled.append(callback),
    triggerNVDAExit=lambda: state.update(quits=state["quits"] + 1))
sys.modules["core"].postNvdaStartup = startup_action
sys.modules["globalPluginHandler"] = types.SimpleNamespace(GlobalPlugin=Base)
sys.modules["globalVars"] = types.SimpleNamespace(appArgs=types.SimpleNamespace(configPath=directory))
sys.modules["versionInfo"] = types.SimpleNamespace(version="unit-test-only")
sys.modules["logHandler"] = types.SimpleNamespace(log=types.SimpleNamespace(exception=lambda message: errors.append(message), warning=warnings.append))
sys.modules["logHandler"].log.error = errors.append
sys.modules["synthDriverHandler"] = types.SimpleNamespace(pre_synthSpeak=types.SimpleNamespace(register=lambda observer: None, unregister=lambda observer: None),
                                                        getSynth=lambda: types.SimpleNamespace(name="unit-test-only"))
spec = importlib.util.spec_from_file_location("observer", source)
module = importlib.util.module_from_spec(spec)
# 仅执行本轮实际源码字节，不读取或写入源码目录的字节码缓存。
with open(source, "rb") as source_file:
    source_bytes = source_file.read()
exec(compile(source_bytes, source, "exec", dont_inherit=True), module.__dict__)
class ControlledDateTime(datetime.datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime.datetime.now(tz) + datetime.timedelta(milliseconds=state["clockMs"])


module.datetime = types.SimpleNamespace(datetime=ControlledDateTime, timezone=datetime.timezone, timedelta=datetime.timedelta)
observer = module.GlobalPlugin()
sequence = 0


def rows():
    with open(observer.output, encoding="utf-8") as target:
        return [json.loads(line) for line in target]


def request(**patch):
    global sequence
    sequence += 1
    stamp = lambda value: value.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    start = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(milliseconds=10)
    value = {"sequence": sequence, "nonce": str(uuid.uuid4()), "nodeId": "unit-node-" + str(sequence), "name": "受控测试按钮", "role": "button",
             "rawOffset": len(rows()), "startedAt": stamp(start), "deadlineAt": stamp(start + datetime.timedelta(seconds=10))}
    value.update(patch)
    write("collector-node.json", {"runToken": binding["runToken"], "request": value, "focusMode": "sequential"})
    return value


def foreground_request(**patch):
    stamp = lambda value: value.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    start = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(milliseconds=10)
    value = {"schemaVersion": 1, "command": "ensure-foreground", "runToken": binding["runToken"], "nonce": str(uuid.uuid4()),
             "pid": os.getpid(), "nodeSequence": 1, "startedAt": stamp(start), "deadlineAt": stamp(start + datetime.timedelta(seconds=10))}
    value.update(patch)
    write("collector-foreground.json", value)
    return value


def foreground_ack(nonce):
    with open(os.path.join(directory, "collector-foreground-ack-" + nonce + ".json"), "rb") as target:
        raw = target.read()
    value = json.loads(raw)
    assert set(value) == {"kind", "schemaVersion", "runToken", "nonce", "pid", "nodeSequence", "startedAt", "deadlineAt", "timestamp", "reason",
                          "foregroundNull", "ownerIsBoundMain", "exactRoot", "callReturnedTrue"}
    assert value["kind"] == "nvda-observer-foreground-ack" and value["schemaVersion"] == 1
    return value, raw


def processed_requests():
    paths = [os.path.join(directory, name) for name in os.listdir(directory) if name.startswith("collector-foreground-processed-")]
    return [open(file, "rb").read() for file in paths]


def owned_stop():
    write("collector-stop.json", {"command": "stop", "runToken": binding["runToken"], "nonce": str(uuid.uuid4()), "pid": os.getpid(),
                                  "requestedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")})
    observer.poll_stop()
    with open(os.path.join(directory, "collector-stop-ack.json"), encoding="utf-8") as target:
        ack = json.load(target)
    assert ack["runToken"] == binding["runToken"] and ack["pid"] == os.getpid()
    assert state["quits"] == 1 and state["closed"] == 1
    observer.terminate()


if mode == "privacy":
    request()
    observer.observe(Sequence(["其他应用绝不能写盘"]))
    with open(observer.output, encoding="utf-8") as target:
        excluded = target.read()
    assert "私密" not in excluded and "绝不能" not in excluded
    assert len(excluded.strip().splitlines()) == 1
    assert state["nameReads"] == 0 and state["speechReads"] == 0
    focus.processID, focus.text = 1234, "受控测试按钮"
    observer.observe(Sequence(["受控测试按钮"]))
    records = rows()
    assert len(records) == 2 and records[1]["focusPid"] == 1234
    assert records[1]["binding"]["renderer"]["pid"] == 5678 and records[1]["focusPid"] != 5678
    observer.terminate()
    write("collector-target.json", {**binding, "additionalPids": [9999]})
    try:
        module.GlobalPlugin()
        raise AssertionError("额外进程字段不应被接受")
    except ValueError:
        pass
    print(json.dumps({"excludedOtherProcessBeforeWrite": True, "matchingProcessOnly": True, "rejectedExtraTargets": True}))
elif mode == "native-gates":
    focus.processID, focus.text = 1234, "受控测试按钮"
    for key, value, reason in [("rootOwner", 9999, "ROOT_OWNER"), ("foreground", 2000, "FOREGROUND"),
                              ("focusOwner", 9999, "FOCUS_OWNER"), ("ancestor", 2000, "ANCESTOR"),
                              ("isChild", False, "IS_CHILD"), ("birth", birth[:-2] + "8Z", "BIRTH"),
                              ("alive", False, "BIRTH"), ("apiFailure", True, "API")]:
        previous = state[key]
        state[key] = value
        request()
        before = len(rows())
        observer.observe(Sequence(["绝不能读取或写出"]))
        assert len(rows()) == before and state["nameReads"] == 0 and state["speechReads"] == 0
        assert any("reason=" + reason in message for message in warnings)
        state[key] = previous
    assert all("9999" not in message and "2000" not in message and "绝不能" not in message for message in warnings)
    request()
    for unused in range(1200):
        state["foreground"] = 2000
        observer.observe(Sequence(["绝不能读取或写出"]))
    assert len([message for message in warnings if "nodeSequence=" + str(sequence) in message]) == 4
    state["foreground"], focus.windowHandle = 1000, 1000
    request()
    observer.observe(Sequence(["受控测试按钮"]))
    assert rows()[-1]["focusHwnd"] == "1000"
    observer.terminate()
    print(json.dumps({"nativeGatesBeforeContent": True, "fixedBoundedReasonsOnly": True, "sameRootAccepted": True, "heldHandleDisposed": state["closed"] == 1}))
elif mode == "node-gates":
    focus.processID, focus.text = 1234, "名字不同"
    request()
    observer.observe(Sequence(["受控测试按钮"]))
    assert len(rows()) == 1 and state["speechReads"] == 0
    focus.text = "受控测试按钮"
    old = "2020-01-01T00:00:00.000Z"
    request(startedAt=old, deadlineAt="2020-01-01T00:00:10.000Z")
    observer.observe(Sequence(["受控测试按钮"]))
    assert len(rows()) == 1
    value = request()
    write("collector-node.json", {"runToken": str(uuid.uuid4()), "request": value})
    observer.observe(Sequence(["受控测试按钮"]))
    assert len(rows()) == 1
    request()
    observer.observe(Sequence([object()]))
    assert len(rows()) == 1
    observer.observe(Sequence(["受控测试按钮"]))
    assert len(rows()) == 2
    request()
    observer.observe(Sequence(["受控测试按钮"]))
    assert len(rows()) == 3 and rows()[1]["request"]["nonce"] != rows()[2]["request"]["nonce"]
    observer.terminate()
    print(json.dumps({"readyIsNotSpeech": True, "nameTimeTokenBeforeStrings": True, "actualStringsOnly": True, "distinctNodeNonces": True}))
elif mode == "owned-stop":
    command = {"command": "stop", "runToken": str(uuid.uuid4()), "nonce": str(uuid.uuid4()), "pid": os.getpid(),
               "requestedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")}
    write("collector-stop.json", command)
    observer.poll_stop()
    assert not state["quits"] and not os.path.exists(os.path.join(directory, "collector-stop-ack.json"))
    command["runToken"] = binding["runToken"]
    write("collector-stop.json", command)
    observer.poll_stop()
    with open(os.path.join(directory, "collector-stop-ack.json"), encoding="utf-8") as target:
        ack = json.load(target)
    assert ack["nonce"] == command["nonce"] and ack["pid"] == os.getpid() and ack["runToken"] == binding["runToken"]
    observer.observe(Sequence(["停止后不能读出"]))
    observer.terminate()
    assert len(rows()) == 1 and state["quits"] == 1 and state["closed"] == 1
    print(json.dumps({"foreignStopRejected": True, "ownedAckOnly": True, "normalExitRequested": True, "handleDisposedBeforeAck": True}))
elif mode == "foreground-native":
    scenario = sys.argv[4]
    changes = {
        "already-owned": {}, "switch-true": {"foreground": 2000}, "switch-false-exact": {"foreground": 2000, "setReturn": False},
        "false-wrong": {"foreground": 2000, "setReturn": False, "setTarget": 2000}, "true-wrong": {"foreground": 2000, "setTarget": 2000},
        "null-window": {"foreground": 0, "setTarget": 0}, "same-main-other-root": {"foreground": 1001, "setTarget": 1001},
        "birth-before": {"foreground": 2000, "birth": birth[:-2] + "8Z"}, "exe-before": {"foreground": 2000, "imagePath": os.path.abspath("other.exe")},
        "root-before": {"foreground": 2000, "rootOwner": 9999}, "ancestor-before": {"foreground": 2000, "rootAncestor": 1001},
        "api-before": {"foreground": 2000, "apiFailure": True}, "birth-after": {"foreground": 2000, "afterSet": {"birth": birth[:-2] + "8Z"}},
        "exe-after": {"foreground": 2000, "afterSet": {"imagePath": os.path.abspath("other.exe")}},
        "root-after": {"foreground": 2000, "afterSet": {"rootOwner": 9999}},
        "ancestor-after": {"foreground": 2000, "afterSet": {"rootAncestor": 1001}}, "api-after": {"foreground": 2000, "afterSet": {"apiFailure": True}},
        "expire-before-activation": {"foreground": 2000, "expireOnImage": True},
        "expire-after-activation": {"foreground": 2000, "afterSet": {"clockMs": 11000}},
    }
    state.update(changes[scenario])
    value = foreground_request()
    request_raw = open(os.path.join(directory, "collector-foreground.json"), "rb").read()
    observer.poll_stop()
    ack, raw = foreground_ack(value["nonce"])
    assert all(ack[key] == value[key] for key in ["runToken", "nonce", "pid", "nodeSequence", "startedAt", "deadlineAt"])
    success = scenario in ["already-owned", "switch-true", "switch-false-exact"]
    assert (ack["reason"] in ["ALREADY_OWNED", "EXACT_ROOT_ESTABLISHED"]) == success
    assert not success or (ack["foregroundNull"] is False and ack["ownerIsBoundMain"] is True and ack["exactRoot"] is True)
    if scenario == "switch-false-exact":
        assert ack["callReturnedTrue"] is False
    calls = state["foregroundCalls"]
    observer.poll_stop()
    assert foreground_ack(value["nonce"])[1] == raw and state["foregroundCalls"] == calls
    assert not os.path.exists(os.path.join(directory, "collector-foreground.json"))
    assert not os.path.exists(os.path.join(directory, "collector-foreground-processing.json"))
    assert processed_requests() == [request_raw]
    assert len(rows()) == 1 and state["nameReads"] == 0 and state["speechReads"] == 0
    owned_stop()
    print(json.dumps({"isolatedModel": True, "setForegroundCalls": calls, "reason": ack["reason"], "exactOnly": True,
                      "noSpeechOrNames": True, "oneConsumedRequest": True, "ownedStopAfterward": True, "heldHandleDisposed": True}))
elif mode == "foreground-request":
    scenario = sys.argv[4]
    old = "2020-01-01T00:00:00.000Z"
    patches = {"expired": {"startedAt": old, "deadlineAt": "2020-01-01T00:00:10.000Z"},
               "future": {"startedAt": "2099-01-01T00:00:00.000Z", "deadlineAt": "2099-01-01T00:00:10.000Z"},
               "cross-token": {"runToken": str(uuid.uuid4())}, "cross-pid": {"pid": os.getpid() + 1}, "unknown-field": {"additionalPid": 9999}}
    value = foreground_request(**patches.get(scenario, {}))
    if scenario == "over-budget":
        end = datetime.datetime.fromisoformat(value["startedAt"].replace("Z", "+00:00")) + datetime.timedelta(seconds=11)
        value["deadlineAt"] = end.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        write("collector-foreground.json", value)
    if scenario == "stop-priority":
        owned_stop()
        assert state["foregroundCalls"] == 0 and not os.path.exists(os.path.join(directory, "collector-foreground-ack-" + value["nonce"] + ".json"))
    else:
        if scenario == "processing-busy":
            write("collector-foreground-processing.json", {"preserve": "先前尚未完成的本地命令"})
            processing = os.path.join(directory, "collector-foreground-processing.json")
            original_processing = open(processing, "rb").read()
            pending = open(os.path.join(directory, "collector-foreground.json"), "rb").read()
            observer.poll_stop()
            assert open(processing, "rb").read() == original_processing and state["foregroundCalls"] == 0
            assert open(os.path.join(directory, "collector-foreground.json"), "rb").read() == pending
            os.rename(processing, os.path.join(directory, "unit-preserved-processing.json"))
            state["clockMs"] = 11000
        observer.poll_stop()
        ack, raw = foreground_ack(value["nonce"])
        if scenario in ["replay-nonce", "replay-sequence"]:
            assert ack["reason"] == "ALREADY_OWNED"
            value.update(nodeSequence=2) if scenario == "replay-nonce" else value.update(nonce=str(uuid.uuid4()))
            write("collector-foreground.json", value)
            observer.poll_stop()
            if scenario == "replay-nonce":
                assert foreground_ack(value["nonce"])[1] == raw
            else:
                assert foreground_ack(value["nonce"])[0]["reason"] == "REQUEST_REPLAY"
        elif scenario == "duplicate-poll":
            observer.poll_stop()
            assert foreground_ack(value["nonce"])[1] == raw
        else:
            assert ack["reason"] in ["REQUEST_INVALID", "REQUEST_EXPIRED"]
        assert state["foregroundCalls"] == 0
        assert not os.path.exists(os.path.join(directory, "collector-foreground-processing.json"))
        assert len(processed_requests()) == (2 if scenario.startswith("replay-") else 1)
        assert not any(key in ack for key in ["foregroundPid", "foregroundHwnd", "name", "title", "spoken"])
        owned_stop()
    assert len(rows()) == 1 and state["nameReads"] == 0 and state["speechReads"] == 0
    print(json.dumps({"isolatedModel": True, "invalidOrOnceOnly": True, "noSpeechOrNames": True,
                      "noForeignIdentityPersisted": True, "ownedStopAfterward": True, "heldHandleDisposed": True}))
elif mode == "startup-gates":
    scenario = sys.argv[4]
    target = os.path.join(directory, "nvda-startup-complete.json")
    assert not os.path.exists(target) and [row["kind"] for row in rows()] == ["nvda-observer-ready"]
    assert hasattr(observer, "on_startup_complete") and observer.on_startup_complete in startup_action.handlers
    if scenario == "notify":
        startup_action.notify()
        original = open(target, "rb").read()
        value = json.loads(original)
        assert set(value) == {"kind", "schemaVersion", "engine", "version", "pid", "runToken", "binding", "startupSource", "timestamp"}
        assert value["kind"] == "nvda-observer-startup-complete" and value["schemaVersion"] == 1
        assert value["engine"] == "NVDA" and value["version"] == "unit-test-only" and value["pid"] == os.getpid()
        assert value["binding"] == binding and value["runToken"] == binding["runToken"]
        assert value["startupSource"] == "core.postNvdaStartup"
        assert module.moment(value["timestamp"]) >= now.replace(microsecond=(now.microsecond // 1000) * 1000)
        startup_action.notify()
        assert open(target, "rb").read() == original and observer.startup_complete
        owned_stop()
    elif scenario == "terminate-before-notify":
        callback = observer.on_startup_complete
        observer.terminate()
        startup_action.notify()
        callback()
        assert not os.path.exists(target) and state["closed"] == 1
    elif scenario == "publish-failure":
        with open(target + ".tmp", "x", encoding="utf-8") as output:
            output.write("隔离已有临时原件")
        startup_action.notify()
        assert not os.path.exists(target) and not observer.startup_complete
        before = len(errors)
        startup_action.notify()
        assert len(errors) == before and open(target + ".tmp", encoding="utf-8").read() == "隔离已有临时原件"
        assert json.loads(errors[-1])["event"] == "v16.ui_nvda_startup_complete_failed"
        owned_stop()
    elif scenario in ["register-failure", "missing-api"]:
        observer.terminate()
        if scenario == "register-failure":
            startup_action.fail_register = True
        else:
            sys.modules["core"].postNvdaStartup = None
        try:
            module.GlobalPlugin()
            raise AssertionError("缺失或失败的启动接口不得授予就绪")
        except (OSError, ValueError):
            pass
        assert state["closed"] == 2 and not startup_action.handlers
        assert json.loads(errors[-1])["event"] == "v16.ui_nvda_observer_initialize_failed"
    elif scenario == "unregister-failure":
        startup_action.fail_unregister = True
        try:
            observer.terminate()
            raise AssertionError("注销失败不得静默通过")
        except OSError:
            pass
        observer.on_startup_complete()
        assert state["closed"] == 1 and not os.path.exists(target)
        assert json.loads(errors[-1])["event"] == "v16.ui_nvda_startup_unregister_failed"
        startup_action.fail_unregister = False
        observer.terminate()
    else:
        raise AssertionError("未知启动隔离用例")
    assert not startup_action.handlers
    assert [row["kind"] for row in rows()] == ["nvda-observer-ready"]
    assert state["nameReads"] == 0 and state["speechReads"] == 0 and state["foregroundCalls"] == 0
    for message in errors:
        value = json.loads(message)
        assert set(value) == {"timestamp", "level", "event", "context"} and value["level"] == "error"
        assert value["context"]["pid"] == os.getpid() and value["context"]["runToken"] == binding["runToken"]
    print(json.dumps({"isolatedModel": True, "officialActionOnly": True, "readyIsNotStartupOrSpeech": True,
                      "lateOrFailedCallbackClosed": True, "ownedHandleDisposed": True, "noInputOrContent": True}))
elif mode == "focus-phases":
    scenario = sys.argv[4]
    focus.processID, focus.text = binding["main"]["pid"], "受控测试按钮"
    node = request()
    command = {"kind": "nvda-owned-focus-request", "schemaVersion": 1, "runToken": binding["runToken"], "pid": os.getpid(),
               "nonce": str(uuid.uuid4()), "nodeSequence": node["sequence"], "nodeNonce": node["nonce"], "nodeId": node["nodeId"],
               "phase": "first-focus", "focusMode": "sequential", "phaseStartedAt": node["startedAt"], "startedAt": node["startedAt"], "deadlineAt": node["deadlineAt"],
               "baselineGeneration": 0, "allowAlreadyFocused": scenario == "already", "name": node["name"], "role": node["role"]}
    if scenario in ["tab-already", "target-already", "handoff-sequential", "mode-switch", "dialog-handoff", "dialog-final", "dialog-skip", "dialog-mode-rewrite"]:
        observer.focus_sequence, observer.focus_phase, observer.focus_node_nonce = node["sequence"], 0, node["nonce"]
        observer.focus_mode = "sequential"
        command["phase"] = "tab"
        if scenario in ["tab-already", "target-already"]: command["allowAlreadyFocused"] = True
        if scenario == "target-already": command["phase"], observer.focus_phase = "target-focus", 1
        if scenario == "handoff-sequential": command["phase"], observer.focus_phase = "target-handoff", 1
        if scenario == "mode-switch": command["focusMode"] = "named-dialog-container"
        if scenario.startswith("dialog-"):
            node["role"] = "dialog"
            write("collector-node.json", {"runToken": binding["runToken"], "request": node, "focusMode": "named-dialog-container"})
            command["focusMode"], command["phase"], observer.focus_mode, observer.focus_phase = "named-dialog-container", "target-handoff", "named-dialog-container", 1
            if scenario in ["dialog-final", "dialog-skip"]:
                command["phase"], command["role"], focus.role.name = "target-focus", "dialog", "dialog"
                if scenario == "dialog-final": observer.focus_phase = 2
            if scenario == "dialog-mode-rewrite": observer.focus_mode = "sequential"
    before_speech = (observer.last_sequence, observer.last_nonce, set(observer.seen_nonces), len(rows()), state["speechReads"])
    calls = []
    def next_handler():
        calls.append("next")
        if scenario == "handler-failure":
            raise RuntimeError("UNIT_ORIGINAL_HANDLER_FAILURE")
    if scenario == "foreign":
        focus.processID = 9999
    if scenario != "already":
        try:
            observer.event_gainFocus(focus, next_handler)
        except RuntimeError as error:
            assert scenario == "handler-failure" and str(error) == "UNIT_ORIGINAL_HANDLER_FAILURE"
    else:
        # 当前焦点已由原链处理，无新事件时明确走metadata来源。
        next_handler()
    assert calls == ["next"]
    if scenario == "pending": state["pendingFocus"] = True
    if scenario == "unknown": command["foreign"] = True
    if scenario == "expired": state["clockMs"] = 11000
    if scenario == "identity": command["nodeNonce"] = str(uuid.uuid4())
    if scenario == "phase": command["phase"] = "tab"
    write("collector-focus.json", command)
    ack_file = os.path.join(directory, "collector-focus-ack-" + command["nonce"] + ".json")
    original_open, original_rename = open, os.rename
    original_uuid = module.uuid
    fixed_uuid = "33333333-3333-4333-8333-333333333333"
    temporary = os.path.join(directory, ".focus-" + fixed_uuid + ".tmp")
    sentinel, attempts = "隔离既有原件不得覆盖", []
    if scenario in ["ack-temp-collision", "ack-target-collision"]:
        with original_open(temporary if scenario == "ack-temp-collision" else ack_file, "x", encoding="utf-8") as target:
            target.write(sentinel)
    module.uuid = types.SimpleNamespace(UUID=uuid.UUID, uuid4=lambda: uuid.UUID(fixed_uuid))
    def failure():
        error = OSError(5, "隔离私密路径和外部名称不得进入日志")
        error.winerror = 5
        return error
    class WriteFailure:
        def __init__(self, handle): self.handle = handle
        def __enter__(self): self.handle.__enter__(); return self
        def __exit__(self, *args): return self.handle.__exit__(*args)
        def write(self, value): raise failure()
    def controlled_open(file, access="r", *args, **kwargs):
        if access == "x":
            attempts.append({"length": len(os.fspath(file)), "name": os.path.basename(file)})
            if scenario == "long-path" and len(os.fspath(file)) > 259:
                raise FileNotFoundError(2, "隔离宿主不支持长路径")
            if scenario == "ack-open-failure": raise failure()
        handle = original_open(file, access, *args, **kwargs)
        return WriteFailure(handle) if access == "x" and scenario == "ack-write-failure" else handle
    def controlled_rename(source, target):
        if scenario == "ack-publish-failure" and os.path.basename(source).startswith(".focus-"):
            raise failure()
        return original_rename(source, target)
    module.open, module.os.rename = controlled_open, controlled_rename
    try:
        observer.poll_focus()
    finally:
        module.open, module.os.rename, module.uuid = original_open, original_rename, original_uuid
    if scenario in ["event", "already", "replay", "long-path", "dialog-handoff", "dialog-final"]:
        with open(ack_file, "rb") as source: ack_bytes = source.read()
        ack = json.loads(ack_bytes)
        assert ack["source"] == ("already-focused" if scenario == "already" else "event-gainFocus")
        assert ack["pendingFocusEvents"] is False and ack["focusMatchesExpected"] is True
        assert ack["proof"]["focusPid"] == binding["main"]["pid"] and ack["proof"]["mainAlive"] is True
        if scenario == "replay":
            write("collector-focus.json", command)
            observer.poll_focus()
            assert open(ack_file, "rb").read() == ack_bytes
        if scenario == "long-path":
            assert len(os.path.abspath(directory)) == 171 and len(ack_file) == 233
            assert attempts and all(item["length"] <= 259 for item in attempts)
            assert os.path.isfile(os.path.join(directory, "collector-focus-consumed-" + command["nonce"] + ".json"))
            assert not errors
    elif scenario.startswith("ack-"):
        if scenario == "ack-target-collision":
            assert original_open(ack_file, encoding="utf-8").read() == sentinel
        else:
            assert not os.path.exists(ack_file)
        if scenario == "ack-temp-collision":
            assert original_open(temporary, encoding="utf-8").read() == sentinel
        elif scenario == "ack-write-failure":
            assert os.path.isfile(temporary) and os.path.getsize(temporary) == 0
        expected_stage = {"ack-open-failure": "create-ack-temporary", "ack-write-failure": "write-ack-temporary",
                          "ack-temp-collision": "create-ack-temporary", "ack-target-collision": "check-ack-target",
                          "ack-publish-failure": "publish-ack"}[scenario]
        error = json.loads(errors[-1])
        assert error["event"] == "v16.ui_nvda_focus_phase_failed"
        assert error["context"]["stage"] == expected_stage
        assert error["context"]["pathLength"] == len(ack_file if scenario == "ack-target-collision" else temporary)
        assert error["context"]["targetPathLength"] == len(ack_file)
        if scenario in ["ack-open-failure", "ack-write-failure", "ack-publish-failure"]:
            assert error["context"]["errno"] == 5 and error["context"]["winerror"] == 5
        if scenario == "ack-temp-collision": assert error["context"]["errno"] == 17
        assert directory not in errors[-1] and "受控测试按钮" not in errors[-1] and "隔离私密" not in errors[-1]
        assert os.path.isfile(os.path.join(directory, "collector-focus.json")) == (scenario != "ack-publish-failure")
    else:
        assert not os.path.exists(ack_file)
    assert (observer.last_sequence, observer.last_nonce, set(observer.seen_nonces), len(rows()), state["speechReads"]) == before_speech
    if scenario == "foreign": assert state["nameReads"] == 0
    observer.terminate()
    print(json.dumps({"isolatedModel": True, "source": scenario, "speechCredit": False, "originalSpeechStatePreserved": True, "nextHandlerOnce": True}))
elif mode == "native-keys":
    scenario = sys.argv[4]
    node = request()
    observer.focus_sequence, observer.focus_phase, observer.focus_node_nonce = node["sequence"], 0, node["nonce"]
    observer.focus_mode = "sequential"
    command = {"kind": "nvda-owned-native-keys-request", "schemaVersion": 1, "runToken": binding["runToken"], "pid": os.getpid(),
               "nonce": str(uuid.uuid4()), "nodeSequence": node["sequence"], "nodeNonce": node["nonce"], "nodeId": node["nodeId"],
               "phase": "tab", "focusMode": "sequential", "action": "Tab", "phaseStartedAt": node["startedAt"], "startedAt": node["startedAt"], "deadlineAt": node["deadlineAt"]}
    pressed, inputs, desktop_closes = set(), [], []
    state.update(guiActive=1000, guiFocus=1001, guiCapture=0, guiMenu=0, guiMove=0, desktopName="Default",
                 threadDesktopName="Default", rootVisible=True, rootEnabled=True, iconic=False)
    before_speech = (observer.last_sequence, observer.last_nonce, set(observer.seen_nonces), len(rows()), state["speechReads"], state["nameReads"])
    def gui_info(thread, pointer):
        if scenario == "gui-api": return False
        assert thread == 0 and pointer._obj.size == ctypes.sizeof(module.GuiThreadInfo)
        value = pointer._obj
        value.active, value.focus, value.capture, value.menu, value.move = state["guiActive"], state["guiFocus"], state["guiCapture"], state["guiMenu"], state["guiMove"]
        return True
    def desktop_name(handle, index, buffer, size, needed):
        assert index == 2 and size == ctypes.sizeof(buffer)
        buffer.value = state["desktopName"] if handle == 888 else state["threadDesktopName"]
        return scenario != "desktop-api"
    def async_key(key):
        if scenario == "cleanup-query-failure" and len(inputs) >= 3:
            raise OSError("隔离回收读回故障")
        down = key in pressed or (key == 16 and bool(pressed & {160, 161}))
        return 0x8000 if down else 0
    def send(count, pointer, size):
        value = pointer._obj
        assert count == 1 and value.kind == 1 and size == (40 if ctypes.sizeof(ctypes.c_void_p) == 8 else 28)
        assert value.value.keyboard.scan == 0 and value.value.keyboard.time == 0 and value.value.keyboard.extra == 0
        vk, flags = value.value.keyboard.vk, value.value.keyboard.flags
        assert vk in [9, 160] and flags in [0, 2]
        assert os.path.isfile(os.path.join(directory, ".keys-consumed-" + command["nonce"] + ".json")), "消费原件必须先于输入"
        inputs.append((vk, flags))
        index = len(inputs)
        fail_at = 2 if scenario in ["partial", "cleanup-query-failure", "cleanup-send-failure"] else 3 if scenario == "shift-partial" else None
        if index == fail_at or (scenario == "cleanup-send-failure" and index == 3): return 0
        if scenario == "send-api": raise OSError("隔离输入API故障")
        if flags == 0: pressed.add(vk)
        else: pressed.discard(vk)
        if index == 1 and scenario == "owner-after-down": state["foreground"] = 2000
        if index == 1 and scenario == "expired-after-down": state["clockMs"] = 11000
        if index == 1 and scenario == "stop-after-down":
            write("collector-stop.json", {"command": "stop", "runToken": binding["runToken"], "nonce": str(uuid.uuid4()),
                                          "pid": os.getpid(), "requestedAt": command["startedAt"]})
        return 1
    kernel.GetCurrentThreadId = Function(lambda: 77)
    user.SendInput, user.GetAsyncKeyState, user.GetGUIThreadInfo = Function(send), Function(async_key), Function(gui_info)
    user.OpenInputDesktop = Function(lambda *args: 0 if scenario == "desktop-open" else 888)
    user.GetThreadDesktop = Function(lambda thread: 999)
    user.GetUserObjectInformationW = Function(desktop_name)
    user.CloseDesktop = Function(lambda handle: desktop_closes.append(handle) or scenario != "desktop-close")
    user.IsWindowVisible, user.IsWindowEnabled, user.IsIconic = Function(lambda root: state["rootVisible"]), Function(lambda root: state["rootEnabled"]), Function(lambda root: state["iconic"])
    patches = {"token": {"runToken": str(uuid.uuid4())}, "pid": {"pid": os.getpid() + 1}, "node": {"nodeNonce": str(uuid.uuid4())},
               "unknown": {"arbitraryKey": "A"}, "action": {"action": "Enter"}, "phase": {"phase": "target-focus", "action": "ShiftTab"},
               "sequence": {"nodeSequence": 2}, "future": {"phaseStartedAt": "2099-01-01T00:00:00.000Z"},
               "over-budget": {"deadlineAt": "2099-01-01T00:00:00.000Z"}}
    command.update(patches.get(scenario, {}))
    if scenario == "reused-foreground": observer.foreground_nonces.add(command["nonce"])
    if scenario == "reused-focus": observer.focus_nonces.add(command["nonce"])
    if scenario == "reused-speech": observer.seen_nonces.add(command["nonce"])
    if scenario == "expired": state["clockMs"] = 11000
    if scenario == "birth": state["birth"] = "2020-01-01T00:00:00.0000000Z"
    if scenario == "exe": state["imagePath"] = os.path.abspath("foreign-package/secret.exe")
    if scenario == "foreground": state["foreground"] = 2000
    if scenario == "root-owner": state["rootOwner"] = 9999
    if scenario == "focus-owner": state["focusOwner"] = 9999
    if scenario == "gui-active": state["guiActive"] = 1001
    if scenario == "gui-focus": state["guiFocus"] = 2000
    if scenario == "gui-capture": state["guiCapture"] = 1001
    if scenario == "desktop-mismatch": state["threadDesktopName"] = "Other"
    if scenario == "hidden": state["rootVisible"] = False
    if scenario == "held-tab": pressed.add(9)
    if scenario == "held-shift": pressed.add(161)
    if scenario == "held-control": pressed.add(17)
    if scenario == "held-mouse": pressed.add(1)
    if scenario in ["shift", "shift-partial"]:
        command.update(phase="target-focus", action="ShiftTab")
        observer.keys_sequence, observer.keys_phase, observer.keys_node_nonce = 1, 0, node["nonce"]
        observer.focus_phase = 1
    if scenario == "stop-priority":
        write("collector-stop.json", {"command": "stop", "runToken": binding["runToken"], "nonce": str(uuid.uuid4()),
                                      "pid": os.getpid(), "requestedAt": command["startedAt"]})
    if scenario == "processing-busy": write("collector-keys-processing.json", {"preserve": True})
    write("collector-keys.json", command)
    observer.poll_native_keys()
    ack_file = os.path.join(directory, "collector-keys-ack-" + command["nonce"] + ".json")
    if scenario in ["tab", "shift", "replay"]:
        ack_bytes = open(ack_file, "rb").read()
        ack = json.loads(ack_bytes)
        assert ack["result"]["passed"] and ack["result"]["atomicTargetGuarantee"] is False
        assert inputs == ([(9, 0), (9, 2)] if scenario != "shift" else [(160, 0), (9, 0), (9, 2), (160, 2)])
        assert not pressed and ack["result"]["cleanupAttempted"] is False
        if scenario == "replay":
            write("collector-keys.json", command)
            observer.poll_native_keys()
            assert open(ack_file, "rb").read() == ack_bytes and len(inputs) == 2
    elif scenario in ["partial", "cleanup-query-failure", "cleanup-send-failure", "shift-partial", "owner-after-down", "expired-after-down", "stop-after-down"]:
        ack = json.loads(open(ack_file, "rb").read())
        result = ack["result"]
        assert not result["passed"] and result["cleanupOnly"] and result["cleanupAttempted"]
        assert result["cleanupKeys"] == ([9, 160] if scenario == "shift-partial" else [9])
        assert inputs[-len(result["cleanupKeys"]):] == [(key, 2) for key in result["cleanupKeys"]]
        assert result["cleanupAcceptedEvents"] <= 2
        if scenario not in ["cleanup-send-failure", "cleanup-query-failure"]: assert not pressed and not result["cleanupErrors"]
        else: assert result["cleanupErrors"]
        assert any(json.loads(message)["event"] == "v16.ui_nvda_native_keys_cleanup_only" for message in errors)
    elif scenario == "send-api":
        assert inputs == [(9, 0)] and not pressed
        assert not json.loads(open(ack_file, "rb").read())["result"]["passed"]
    else:
        assert not inputs
        if os.path.isfile(ack_file): assert json.loads(open(ack_file, "rb").read())["result"]["passed"] is False
    if scenario not in ["tab", "shift", "replay", "stop-priority"]:
        before_retry = list(inputs)
        write("collector-keys.json", {**command, "nonce": str(uuid.uuid4())})
        observer.poll_native_keys()
        assert inputs == before_retry, "失败会话不得重试任一down"
    expected_speech = list(before_speech)
    if scenario == "reused-speech": expected_speech[2] = before_speech[2] | {command["nonce"]}
    assert (observer.last_sequence, observer.last_nonce, set(observer.seen_nonces), len(rows()), state["speechReads"], state["nameReads"]) == tuple(expected_speech)
    assert all(directory not in message and "secret.exe" not in message and "受控测试按钮" not in message for message in errors)
    observer.terminate()
    print(json.dumps({"isolatedModel": True, "scenario": scenario, "nativeOnly": True, "speechCredit": False,
                      "singleEventLedger": True, "originalDeadlinePreserved": True, "failedDownNotRetried": True}))
else:
    raise AssertionError("未知隔离用例")
