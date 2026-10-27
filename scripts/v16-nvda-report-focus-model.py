import ast
import contextlib
import ctypes
import datetime
import io
import json
import os
import sys
import types
import uuid


def main():
    directory, source, scenario, harness = sys.argv[1:5]
    with open(harness, encoding="utf-8") as handle:
        program = ast.parse(handle.read(), filename=harness)
    boundary = next(index for index, node in enumerate(program.body) if isinstance(node, ast.If)
                    and isinstance(node.test, ast.Compare) and isinstance(node.test.left, ast.Name)
                    and node.test.left.id == "mode" and isinstance(node.test.comparators[0], ast.Constant)
                    and node.test.comparators[0].value == "privacy")
    sys.argv = [harness, directory, source, "report-focus-model"]
    model = {"__file__": harness, "__name__": "__report_focus_model__"}
    # 原系统替身前缀保持；新模型不运行旧案例或查询真实进程。
    with contextlib.redirect_stdout(io.StringIO()):
        exec(compile(ast.Module(body=program.body[:boundary], type_ignores=[]), harness, "exec"), model)
    observer, module, state, binding = model["observer"], model["module"], model["state"], model["binding"]
    node = model["request"](role="dialog")
    model["write"]("collector-node.json", {"runToken": binding["runToken"], "request": node, "focusMode": "named-dialog-container"})
    observer.focus_sequence, observer.focus_phase, observer.focus_node_nonce = node["sequence"], 3, node["nonce"]
    observer.focus_mode = "named-dialog-container"
    observer.keys_sequence, observer.keys_phase, observer.keys_node_nonce = node["sequence"], 1, node["nonce"]
    command = {"kind": "nvda-owned-native-keys-request", "schemaVersion": 1, "runToken": binding["runToken"], "pid": os.getpid(),
               "nonce": str(uuid.uuid4()), "nodeSequence": node["sequence"], "nodeNonce": node["nonce"], "nodeId": node["nodeId"],
               "phase": "report-focus", "focusMode": "named-dialog-container", "action": "ReportFocus",
               "phaseStartedAt": node["startedAt"], "startedAt": node["startedAt"], "deadlineAt": node["deadlineAt"]}
    keyboard = {"NVDAModifierKeys": 4, "keyboardLayout": "desktop", "handleInjectedKeys": True}
    configuration_reads = []

    class Configuration:
        def __getitem__(self, key):
            configuration_reads.append(key)
            if scenario == "config-error": raise OSError("私密配置异常不应出现在日志")
            if scenario == "config-late" and key == "handleInjectedKeys": state["clockMs"] = 11000
            return keyboard[key]

    config = types.ModuleType("config")
    config.__path__, config.conf = [], {"keyboard": Configuration()}
    flags_module = types.ModuleType("config.configFlags")
    flags_module.NVDAKey = types.SimpleNamespace(EXTENDED_INSERT=types.SimpleNamespace(value=2 if scenario == "enum" else 4))
    sys.modules["config"], sys.modules["config.configFlags"] = config, flags_module
    pressed, inputs = set(), []
    state.update(guiActive=1000, guiFocus=1001, desktopName="Default", threadDesktopName="Default")
    Function, user, kernel = model["Function"], model["user"], model["kernel"]

    def gui_info(thread, pointer):
        assert thread == 0 and pointer._obj.size == ctypes.sizeof(module.GuiThreadInfo)
        value = pointer._obj
        value.active, value.focus = state["guiActive"], state["guiFocus"]
        value.capture, value.menu, value.move = 0, 0, 0
        return True

    def desktop_name(handle, index, buffer, size, needed):
        assert index == 2 and size == ctypes.sizeof(buffer)
        buffer.value = state["desktopName"] if handle == 888 else state["threadDesktopName"]
        return True

    def async_key(key):
        if scenario == "cleanup-query-failure" and len(inputs) >= 3:
            raise OSError("隔离回收检查异常")
        return 0x8000 if key in pressed else 0

    def send(count, pointer, size):
        value = pointer._obj
        assert count == 1 and value.kind == 1 and size == ctypes.sizeof(module.NativeInput)
        key, flags = value.value.keyboard.vk, value.value.keyboard.flags
        assert (key, flags) in [(45, 1), (9, 0), (9, 2), (45, 3)]
        assert value.value.keyboard.scan == value.value.keyboard.time == value.value.keyboard.extra == 0
        assert os.path.isfile(os.path.join(directory, ".keys-consumed-" + command["nonce"] + ".json"))
        inputs.append((key, flags))
        index = len(inputs) - 1
        fail_at = int(scenario[-1]) if scenario.startswith("partial-") else 1 if scenario.startswith("cleanup-") else None
        if index == fail_at or scenario == "cleanup-send-failure" and index == 2:
            return 0
        if flags & 2: pressed.discard(key)
        else: pressed.add(key)
        if index == 0:
            if scenario == "owner-after-down": state["foreground"] = 2000
            if scenario == "expired-after-down": state["clockMs"] = 11000
            if scenario == "stop-after-down": model["write"]("collector-stop.json", {"command": "stop"})
        return 1

    user.GetGUIThreadInfo, user.GetAsyncKeyState, user.SendInput = Function(gui_info), Function(async_key), Function(send)
    user.OpenInputDesktop, user.GetThreadDesktop = Function(lambda *args: 888), Function(lambda thread: 999)
    user.GetUserObjectInformationW, user.CloseDesktop = Function(desktop_name), Function(lambda handle: True)
    user.IsWindowVisible, user.IsWindowEnabled, user.IsIconic = Function(lambda hwnd: True), Function(lambda hwnd: True), Function(lambda hwnd: False)
    kernel.GetCurrentThreadId = Function(lambda: 321)
    if scenario == "sequential":
        command["focusMode"], observer.focus_mode = "sequential", "sequential"
        model["write"]("collector-node.json", {"runToken": binding["runToken"], "request": node, "focusMode": "sequential"})
    if scenario == "wrong-role":
        node["role"] = "button"
        model["write"]("collector-node.json", {"runToken": binding["runToken"], "request": node, "focusMode": "named-dialog-container"})
    if scenario == "focus-not-final": observer.focus_phase = 2
    if scenario == "keys-not-complete": observer.keys_phase = 0
    if scenario == "sequence": command["nodeSequence"] += 1
    if scenario == "node-nonce": command["nodeNonce"] = str(uuid.uuid4())
    if scenario == "nonce": command["nonce"] = command["nodeNonce"]
    if scenario == "unknown": command["private-field"] = True
    if scenario == "wrong-action": command["action"] = "NVDA+Enter"
    if scenario == "expired": state["clockMs"] = 11000
    if scenario == "over-budget":
        end = module.moment(command["startedAt"]) + datetime.timedelta(seconds=11)
        command["deadlineAt"] = node["deadlineAt"] = end.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        model["write"]("collector-node.json", {"runToken": binding["runToken"], "request": node, "focusMode": "named-dialog-container"})
    if scenario == "modifier-disabled": keyboard["NVDAModifierKeys"] = 2
    if scenario == "modifier-extra": keyboard["NVDAModifierKeys"] = 6
    if scenario == "modifier-bool": keyboard["NVDAModifierKeys"] = True
    if scenario == "layout": keyboard["keyboardLayout"] = "laptop"
    if scenario == "injected": keyboard["handleInjectedKeys"] = False
    if scenario == "held-insert": pressed.add(45)
    if scenario == "held-control": pressed.add(17)
    if scenario == "foreground": state["foreground"] = 2000
    if scenario == "birth": state["birth"] = "2020-01-01T00:00:00.0000000Z"
    if scenario == "desktop": state["threadDesktopName"] = "Other"
    if scenario == "stop-priority": model["write"]("collector-stop.json", {"command": "stop"})
    before_speech = (observer.last_sequence, observer.last_nonce, set(observer.seen_nonces), len(model["rows"]()), state["speechReads"], state["nameReads"])
    model["write"]("collector-keys.json", command)
    observer.poll_native_keys()
    ack_path = os.path.join(directory, "collector-keys-ack-" + command["nonce"] + ".json")
    ack = json.load(open(ack_path, encoding="utf-8")) if os.path.isfile(ack_path) else None
    first_ack = open(ack_path, "rb").read() if ack else None
    accepted = scenario in ["success", "repeat", "repeat-new-nonce"]
    assert bool(ack and ack["result"]["passed"]) is accepted
    if accepted:
        assert inputs == [(45, 1), (9, 0), (9, 2), (45, 3)] and not pressed
        result = ack["result"]
        assert result["requestedEvents"] == result["acceptedEvents"] == result["sendInputCalls"] == 4
        assert [step["proof"]["heldKeys"] for step in result["steps"]] == [[], [45], [45, 9], [45]]
        assert result["afterProof"]["heldKeys"] == [] and result["cleanupOnly"] is False
        assert ack["modifierEvidence"] == {"kind": "nvda-report-focus-modifier", "schemaVersion": 1, "source": "nvda.config.conf",
            "keyboardLayout": "desktop", "modifierKeys": 4, "extendedInsertMask": 4, "handleInjectedKeys": True}
    elif scenario.startswith("partial-"):
        failed = int(scenario[-1])
        expected = [(45, 1), (9, 0), (9, 2), (45, 3)][:failed + 1]
        expected += [] if failed == 0 else [(45, 3)] if failed in [1, 3] else [(9, 2), (45, 3)]
        assert inputs == expected and not pressed
        assert ack["result"]["cleanupOnly"] is (failed > 0)
    elif scenario in ["owner-after-down", "expired-after-down", "stop-after-down"]:
        assert inputs == [(45, 1), (45, 3)] and not pressed and ack["result"]["cleanupOnly"] is True
    elif scenario.startswith("cleanup-"):
        assert inputs == [(45, 1), (9, 0), (45, 3)] and ack["result"]["cleanupErrors"]
        assert ack["result"]["cleanupOnly"] is True
    else:
        assert not inputs, "前置门失败不得发送输入"
    if scenario in ["repeat", "repeat-new-nonce"]:
        before_retry = list(inputs)
        if scenario == "repeat-new-nonce": command["nonce"] = str(uuid.uuid4())
        model["write"]("collector-keys.json", command)
        observer.poll_native_keys()
        assert inputs == before_retry and observer.keys_failed is True
        if scenario == "repeat": assert open(ack_path, "rb").read() == first_ack
    if not accepted and scenario != "stop-priority":
        before_retry = list(inputs)
        command["nonce"] = str(uuid.uuid4())
        model["write"]("collector-keys.json", command)
        observer.poll_native_keys()
        assert inputs == before_retry, "失败ReportFocus不得重试down"
    assert before_speech == (observer.last_sequence, observer.last_nonce, set(observer.seen_nonces), len(model["rows"]()), state["speechReads"], state["nameReads"])
    encoded = "\n".join(model["errors"])
    assert "私密" not in encoded and directory not in encoded
    observer.terminate()
    assert state["closed"] == 1
    print(json.dumps({"isolatedModel": True, "actualSourceExecuted": True, "scenario": scenario, "pid": os.getpid(),
        "inputSent": False, "actualNvdaCredit": False, "accepted": accepted, "inputs": inputs,
        "configurationReads": configuration_reads, "speechStateUnchanged": True, "ownerHandleClosed": True}))


try:
    main()
except Exception as error:
    print(json.dumps({"timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(), "level": "error",
        "event": "v16.ui_nvda_report_focus_model_failed", "context": {"errorType": type(error).__name__}}), file=sys.stderr)
    raise
