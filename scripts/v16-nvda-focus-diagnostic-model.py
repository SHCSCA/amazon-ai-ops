import ast
import contextlib
import datetime
import io
import json
import os
import sys
import types
import uuid


def main():
    directory, source, scenario = sys.argv[1:4]
    harness = os.path.join(os.path.dirname(source), "v16-nvda-observer-test-harness.py")
    with open(harness, encoding="utf-8") as handle:
        program = ast.parse(handle.read(), filename=harness)
    boundary = next(index for index, node in enumerate(program.body) if isinstance(node, ast.If)
                    and isinstance(node.test, ast.Compare) and isinstance(node.test.left, ast.Name)
                    and node.test.left.id == "mode" and isinstance(node.test.comparators[0], ast.Constant)
                    and node.test.comparators[0].value == "privacy")
    sys.argv = [harness, directory, source, "focus-diagnostic-model"]
    model = {"__file__": harness, "__name__": "__focus_diagnostic_model__"}
    # 仅复用原替身端口；该前缀原样编译执行传入的真实生产Python源码。
    with contextlib.redirect_stdout(io.StringIO()):
        exec(compile(ast.Module(body=program.body[:boundary], type_ignores=[]), harness, "exec"), model)
    observer, module, binding = model["observer"], model["module"], model["binding"]
    state, warnings, errors = model["state"], model["warnings"], model["errors"]
    original_focus = model["focus"]
    reads = {"focus": 0, "name": 0, "role": 0, "warning": 0}

    class GuardedFocus:
        processID, windowHandle, text, role_name = binding["main"]["pid"], 1001, "受控测试按钮", "BUTTON"

        @property
        def name(self):
            reads["name"] += 1
            assert self.processID == binding["main"]["pid"], "外部名称不得被读取"
            return self.text

        @property
        def role(self):
            reads["role"] += 1
            assert self.processID == binding["main"]["pid"], "外部角色不得被读取"
            return types.SimpleNamespace(name=self.role_name)

    focus = GuardedFocus()
    def get_focus():
        reads["focus"] += 1
        return focus
    module.api.getFocusObject = get_focus
    module.eventHandler.lastQueuedFocusObject = focus
    node = model["request"]()
    command = {"kind": "nvda-owned-focus-request", "schemaVersion": 1, "runToken": binding["runToken"], "pid": os.getpid(),
               "nonce": str(uuid.uuid4()), "nodeSequence": node["sequence"], "nodeNonce": node["nonce"], "nodeId": node["nodeId"],
               "phase": "first-focus", "focusMode": "sequential", "phaseStartedAt": node["startedAt"], "startedAt": node["startedAt"],
               "deadlineAt": node["deadlineAt"], "baselineGeneration": 0, "allowAlreadyFocused": False,
               "name": node["name"], "role": node["role"]}
    expected = {
        "root": "ROOT_NOT_OWNED", "owner": "FOCUS_OWNER", "proof": "FOCUS_PROOF", "pending": "GAIN_FOCUS_PENDING",
        "queued": "LAST_QUEUED_MISMATCH", "name": "NAME_OR_ROLE_MISMATCH", "role": "NAME_OR_ROLE_MISMATCH",
        "role-unknown": "NAME_OR_ROLE_MISMATCH", "fresh": "FRESH_EVENT_NOT_OBSERVED", "stale": "FRESH_EVENT_NOT_OBSERVED",
        "counter": "GAIN_FOCUS_PENDING", "counter-isolation": "GAIN_FOCUS_PENDING", "nonce-counter": "GAIN_FOCUS_PENDING",
        "phase-counter": "GAIN_FOCUS_PENDING", "reason-counter": "GAIN_FOCUS_PENDING",
    }.get(scenario)
    if scenario not in ["fresh", "stale", "stopped", "owned-stop", "expired", "invalid-token", "invalid-nonce", "invalid-phase", "identity"]:
        observer.event_gainFocus(focus, lambda: None)
    if scenario == "stale":
        observer.event_gainFocus(focus, lambda: None)
        command["baselineGeneration"] = observer.focus_generation
    if scenario == "root": state["foreground"] = 9999
    if scenario == "owner": focus.processID = 9999
    if scenario == "proof": focus.windowHandle = 1002
    if scenario in ["pending", "counter", "counter-isolation", "nonce-counter", "phase-counter", "reason-counter",
                    "logging-failure", "logging-all-failure", "late-before-log", "stopped-before-log", "stop-file-before-log"]:
        state["pendingFocus"] = True
    if scenario == "queued": module.eventHandler.lastQueuedFocusObject = original_focus
    if scenario == "name": focus.text = "同归属不同名称不得进入日志"
    if scenario == "role": focus.role_name = "CHECKBOX"
    if scenario == "role-unknown": focus.role_name = "PRIVATE_ROLE_MUST_NOT_LEAK"
    role_scenarios = {"role-togglebutton": "TOGGLEBUTTON", "role-treeviewitem": "TREEVIEWITEM", "role-treeviewbutton": "TREEVIEWBUTTON",
                      "role-dropdownbutton": "DROPDOWNBUTTON", "role-menubutton": "MENUBUTTON", "role-splitbutton": "SPLITBUTTON"}
    if scenario in role_scenarios:
        focus.role_name = role_scenarios[scenario]
        expected = "NAME_OR_ROLE_MISMATCH"
    if scenario in ["role-unknown-new", "role-secret-new"]:
        focus.role_name = "UNLISTED_FUTURE_ROLE" if scenario == "role-unknown-new" else "PRIVATE_ROLE_CONTAINS_SECRET_LABEL"
        expected = "NAME_OR_ROLE_MISMATCH"
    if scenario in ["role-logging-failure", "role-logging-all-failure"]:
        focus.role_name = "TOGGLEBUTTON"
    if scenario == "successful-propertypage":
        focus.role_name = "PROPERTYPAGE"
        node["role"], command["role"] = "tabpanel", "tabpanel"
        model["write"]("collector-node.json", {"runToken": binding["runToken"], "request": node, "focusMode": "sequential"})
    if scenario == "stopped": observer.stopped = True
    if scenario == "owned-stop": model["owned_stop"]()
    if scenario == "expired": state["clockMs"] = 11000
    if scenario == "invalid-token": command["runToken"] = str(uuid.uuid4())
    if scenario == "invalid-nonce": command["nonce"] = "private-invalid-nonce"
    if scenario == "invalid-phase": command["phase"] = "private-invalid-phase"
    if scenario == "identity": command["nodeNonce"] = str(uuid.uuid4())
    if scenario in ["late-before-log", "stopped-before-log", "stop-file-before-log"] and hasattr(observer, "diagnose_focus"):
        diagnose = observer.diagnose_focus
        def interrupted(command, reason, **gates):
            if scenario == "late-before-log": state["clockMs"] = 11000
            if scenario == "stopped-before-log": observer.stopped = True
            if scenario == "stop-file-before-log": model["write"]("collector-stop.json", {"command": "stop"})
            return diagnose(command, reason, **gates)
        observer.diagnose_focus = interrupted
    if scenario in ["logging-failure", "logging-all-failure"]:
        def failed_warning(message):
            reads["warning"] += 1
            raise OSError("私密诊断异常不得进入日志")
        module.log.warning = failed_warning
        if scenario == "logging-all-failure":
            module.log.error = lambda message: (_ for _ in ()).throw(OSError("私密日志出口异常"))
            module.sys = types.SimpleNamespace(stderr=io.StringIO())
    observer.diagnostic_sequence, observer.diagnostic_counts = 99, {"FOREGROUND": 17}
    if scenario in ["role-logging-failure", "role-logging-all-failure"]:
        def failed_role_warning(message):
            reads["warning"] += 1
            raise OSError("私密角色诊断异常不得进入日志")
        module.log.warning = failed_role_warning
        if scenario == "role-logging-all-failure":
            module.log.error = lambda message: (_ for _ in ()).throw(OSError("私密角色日志出口异常"))
            module.sys = types.SimpleNamespace(stderr=io.StringIO())
    speech_before = (observer.last_sequence, observer.last_nonce, set(observer.seen_nonces), len(model["rows"]()), state["speechReads"])
    model["write"]("collector-focus.json", command)
    calls = 1305 if scenario == "counter" else 2 if scenario == "nonce-counter" else 1
    for index in range(calls):
        if scenario == "nonce-counter" and index == 1:
            command["nonce"] = str(uuid.uuid4())
            model["write"]("collector-focus.json", command)
        observer.poll_focus()
    if scenario == "phase-counter":
        observer.focus_sequence, observer.focus_phase, observer.focus_node_nonce, observer.focus_mode = node["sequence"], 0, node["nonce"], "sequential"
        command.update(phase="tab", nonce=str(uuid.uuid4()))
        model["write"]("collector-focus.json", command)
        observer.poll_focus()
    if scenario == "reason-counter":
        state["pendingFocus"] = False
        module.eventHandler.lastQueuedFocusObject = original_focus
        observer.poll_focus()
    diagnostics = [json.loads(row) for row in warnings if row.startswith('{') and json.loads(row).get("event") == "v16.ui_nvda_focus_rejected"]
    ack_exists = any(name.startswith("collector-focus-ack-") for name in os.listdir(directory))
    success = scenario in ["successful", "successful-propertypage"]
    assert ack_exists is success, "原焦点ACK接受或拒绝发生变化"
    if success:
        ack_path = os.path.join(directory, "collector-focus-ack-" + command["nonce"] + ".json")
        with open(ack_path, encoding="utf-8") as handle: ack = json.load(handle)
        assert set(ack) == set(command) | {"source", "eventGeneration", "eventTimestamp", "observedAt", "pendingFocusEvents", "focusMatchesExpected", "proof"}
        assert ack["source"] == "event-gainFocus" and ack["focusMatchesExpected"] is True
        observer.observe(model["Sequence"]([node["name"]]))
        assert len([row for row in model["rows"]() if row["kind"] == "nvda-synth-speech"]) == 1
        assert not diagnostics
    else:
        assert speech_before == (observer.last_sequence, observer.last_nonce, set(observer.seen_nonces), len(model["rows"]()), state["speechReads"])
    assert (observer.diagnostic_sequence, observer.diagnostic_counts) == (99, {"FOREGROUND": 17})
    if expected:
        assert diagnostics and diagnostics[0]["context"]["reason"] == expected, "新增拒绝阶段诊断缺失或不准确"
        assert all(row["context"]["formalCredit"] is False and row["context"]["nonce"] for row in diagnostics)
    if scenario in ["root", "owner", "proof", "pending", "queued", "counter", "counter-isolation", "nonce-counter", "phase-counter", "reason-counter"]:
        assert reads["name"] == reads["role"] == 0, "归属及待处理门之前读取了内容"
    if scenario in ["stopped", "owned-stop", "expired", "invalid-token", "invalid-nonce", "invalid-phase", "identity"]:
        assert reads["focus"] == reads["name"] == reads["role"] == 0 and not diagnostics
    if scenario in ["late-before-log", "stopped-before-log", "stop-file-before-log"]:
        assert not diagnostics and reads["name"] == reads["role"] == 0
    if scenario == "counter": assert [row["context"]["count"] for row in diagnostics] == [1, 10, 100, 1000]
    if scenario == "nonce-counter": assert [row["context"]["count"] for row in diagnostics] == [1]
    if scenario == "phase-counter": assert [row["context"]["phase"] for row in diagnostics] == ["first-focus", "tab"]
    if scenario == "reason-counter": assert [row["context"]["reason"] for row in diagnostics] == ["GAIN_FOCUS_PENDING", "LAST_QUEUED_MISMATCH"]
    if scenario == "name": assert diagnostics[0]["context"]["nameMatches"] is False and diagnostics[0]["context"]["roleMatches"] is True
    if scenario == "role": assert diagnostics[0]["context"]["roleToken"] == "checkbox" and diagnostics[0]["context"]["roleMatches"] is False
    if scenario == "role-unknown": assert diagnostics[0]["context"]["roleToken"] == "OTHER"
    if scenario in role_scenarios:
        assert diagnostics[0]["context"]["roleToken"] == role_scenarios[scenario].lower()
        assert diagnostics[0]["context"]["nameMatches"] is True and diagnostics[0]["context"]["roleMatches"] is False
    if scenario in ["role-unknown-new", "role-secret-new"]:
        assert diagnostics[0]["context"]["roleToken"] == "OTHER"
    if scenario in role_scenarios or scenario in ["role-unknown-new", "role-secret-new", "role-logging-failure", "role-logging-all-failure"]:
        assert reads["name"] == reads["role"] == 1, "诊断不得再次读取名称或角色"
    if scenario in ["role-logging-failure", "role-logging-all-failure"]:
        assert reads["warning"] == 1 and not ack_exists and not diagnostics
        encoded_errors = "\n".join(errors) + (module.sys.stderr.getvalue() if scenario == "role-logging-all-failure" else "")
        assert "v16.ui_nvda_focus_diagnostic_failed" in encoded_errors and "私密" not in encoded_errors
    if scenario in ["fresh", "stale"]: assert diagnostics[0]["context"]["freshEventObserved"] is False
    if scenario in ["logging-failure", "logging-all-failure"]:
        assert reads["warning"] == 1 and not ack_exists
        encoded_errors = "\n".join(errors) + (module.sys.stderr.getvalue() if scenario == "logging-all-failure" else "")
        assert 'v16.ui_nvda_focus_diagnostic_failed' in encoded_errors
        assert "私密" not in encoded_errors
    encoded = json.dumps(diagnostics, ensure_ascii=False)
    assert node["name"] not in encoded and "同归属不同名称" not in encoded and "PRIVATE_ROLE" not in encoded
    assert not any(row["kind"] not in ["nvda-observer-ready", "nvda-synth-speech"] for row in model["rows"]())
    observer.terminate()
    assert state["closed"] == 1
    print(json.dumps({"isolatedModel": True, "actualSourceExecuted": True, "scenario": scenario, "pid": os.getpid(),
                      "actualNvdaCredit": False, "inputSent": False, "diagnostics": diagnostics, "accepted": success,
                      "reads": reads, "speechCounterUnchanged": True, "ownerHandleClosed": True}))


try:
    main()
except Exception as error:
    print(json.dumps({"timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(), "level": "error",
                      "event": "v16.ui_nvda_focus_diagnostic_model_failed", "context": {"errorType": type(error).__name__}}), file=sys.stderr)
    raise
