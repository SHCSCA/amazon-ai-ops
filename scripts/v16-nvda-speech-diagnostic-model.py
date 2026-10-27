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
    directory, source, scenario, harness = sys.argv[1:5]
    with open(harness, encoding="utf-8") as handle:
        program = ast.parse(handle.read(), filename=harness)
    boundary = next(index for index, node in enumerate(program.body) if isinstance(node, ast.If)
                    and isinstance(node.test, ast.Compare) and isinstance(node.test.left, ast.Name)
                    and node.test.left.id == "mode" and isinstance(node.test.comparators[0], ast.Constant)
                    and node.test.comparators[0].value == "privacy")
    sys.argv = [harness, directory, source, "speech-diagnostic-model"]
    model = {"__file__": harness, "__name__": "__speech_diagnostic_model__"}
    # 原样复用既有系统替身前缀；不执行旧案例分支或查询真实进程。
    with contextlib.redirect_stdout(io.StringIO()):
        exec(compile(ast.Module(body=program.body[:boundary], type_ignores=[]), harness, "exec"), model)
    observer, module, binding = model["observer"], model["module"], model["binding"]
    state, warnings, errors = model["state"], model["warnings"], model["errors"]
    reads = {"request": 0, "focus": 0, "name": 0, "role": 0, "speech": 0, "clock": 0, "warning": 0}
    fixed_now = datetime.datetime.now(datetime.timezone.utc)

    class FixedDateTime(datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            reads["clock"] += 1
            return fixed_now + datetime.timedelta(milliseconds=state["clockMs"])

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

    class GuardedSequence:
        def __init__(self, values):
            self.values = values

        def __iter__(self):
            reads["speech"] += 1
            return iter(self.values)

    focus = GuardedFocus()
    def get_focus():
        reads["focus"] += 1
        return focus

    original_request = observer.request
    def counted_request():
        reads["request"] += 1
        return original_request()

    module.api.getFocusObject, observer.request = get_focus, counted_request
    module.datetime = types.SimpleNamespace(datetime=FixedDateTime, timezone=datetime.timezone, timedelta=datetime.timedelta)
    node = model["request"]()
    old_counter = (99, {"FOREGROUND": 17})
    observer.diagnostic_sequence, observer.diagnostic_counts = old_counter[0], dict(old_counter[1])
    before_rows = len(model["rows"]())
    values = [node["name"], object(), "实际字符串"]
    if scenario == "stopped": observer.stopped = True
    if scenario == "missing-request": os.remove(os.path.join(directory, "collector-node.json"))
    if scenario == "expired": state["clockMs"] = 11000
    if scenario == "invalid-token":
        model["write"]("collector-node.json", {"runToken": str(uuid.uuid4()), "request": node, "focusMode": "sequential"})
    if scenario == "root": state["rootOwner"] = 9999
    if scenario == "owner": focus.processID = 9999
    if scenario == "proof": focus.windowHandle = 1002
    if scenario in ["name", "counter", "counter-node", "counter-reason", "logging-name"]:
        focus.text = "同归属的不同私密名称"
    if scenario == "role": focus.role_name = "PRIVATE_ROLE_MUST_NOT_LEAK"
    if scenario in ["empty", "logging-empty"]: values = [object()]
    if scenario == "propertypage":
        focus.role_name, node["role"] = "PROPERTYPAGE", "tabpanel"
        model["write"]("collector-node.json", {"runToken": binding["runToken"], "request": node, "focusMode": "sequential"})
    logging_modes = ["logging-entry", "logging-name", "logging-empty", "logging-accepted", "logging-all"]
    stderr = io.StringIO()
    if scenario in logging_modes:
        def failed_warning(message):
            reads["warning"] += 1
            failure_at = 1 if scenario == "logging-entry" else 2
            if scenario == "logging-all" or reads["warning"] == failure_at:
                raise OSError("私密日志错误不可进入诊断")
            warnings.append(message)
        module.log.warning = failed_warning
        if scenario == "logging-all":
            module.log.error = lambda message: (_ for _ in ()).throw(OSError("私密日志出口错误"))
            module.sys = types.SimpleNamespace(stderr=stderr)
    calls = 1305 if scenario == "counter" else 0 if scenario == "no-callback" else 1
    for unused in range(calls):
        observer.observe(GuardedSequence(values))
    if scenario == "counter-node":
        node = model["request"]()
        observer.observe(GuardedSequence(values))
    if scenario == "counter-reason":
        focus.text = node["name"]
        observer.observe(GuardedSequence([object()]))
        observer.observe(GuardedSequence(values))
    if scenario == "replayed-nonce":
        before_replay = dict(reads)
        node = {**node, "sequence": node["sequence"] + 1}
        model["write"]("collector-node.json", {"runToken": binding["runToken"], "request": node, "focusMode": "sequential"})
        observer.observe(GuardedSequence(values))
        assert reads["name"] == before_replay["name"] and reads["speech"] == before_replay["speech"]
    diagnostics = [json.loads(row) for row in warnings if row.startswith("{")
                   and json.loads(row).get("event") == "v16.ui_nvda_speech_callback"]
    spoken = [row for row in model["rows"]() if row["kind"] == "nvda-synth-speech"]
    accepted = scenario in ["accepted", "propertypage", "counter-reason", "replayed-nonce", "logging-entry", "logging-accepted", "logging-all"]
    assert bool(spoken) is accepted, "诊断不得改变原语音接受或拒绝"
    assert len(model["rows"]()) == before_rows + len(spoken)
    for record in diagnostics:
        assert set(record) == {"level", "event", "context"}
        context = record["context"]
        assert set(context) == {"runToken", "nodeSequence", "reason", "count", "formalCredit"}
        assert context["formalCredit"] is False and context["runToken"] == binding["runToken"]
        assert context["reason"] in ["CALLBACK_SEEN", "NAME_OR_ROLE_MISMATCH", "NO_STRING_ITEMS", "ACCEPTED"]
        assert context["count"] in [1, 10, 100, 1000]
    reasons = [row["context"]["reason"] for row in diagnostics]
    if scenario in ["no-callback", "stopped", "missing-request", "expired", "invalid-token"]:
        assert not diagnostics and reads["focus"] == reads["name"] == reads["role"] == reads["speech"] == 0
    if scenario in ["root", "owner", "proof"]:
        assert reasons == ["CALLBACK_SEEN"] and reads["name"] == reads["role"] == reads["speech"] == 0
    if scenario in ["name", "role"]:
        assert reasons == ["CALLBACK_SEEN", "NAME_OR_ROLE_MISMATCH"] and reads["speech"] == 0
    if scenario == "empty": assert reasons == ["CALLBACK_SEEN", "NO_STRING_ITEMS"] and reads["speech"] == 1
    if scenario == "counter":
        for reason in ["CALLBACK_SEEN", "NAME_OR_ROLE_MISMATCH"]:
            assert [row["context"]["count"] for row in diagnostics if row["context"]["reason"] == reason] == [1, 10, 100, 1000]
        assert reads["request"] == reads["focus"] == reads["name"] == reads["role"] == 1305 and reads["speech"] == 0
        assert getattr(observer, "speech_diagnostic_counts", None) == {"CALLBACK_SEEN": 1000, "NAME_OR_ROLE_MISMATCH": 1000}
    if scenario == "counter-node":
        assert reasons == ["CALLBACK_SEEN", "NAME_OR_ROLE_MISMATCH", "CALLBACK_SEEN", "NAME_OR_ROLE_MISMATCH"]
        assert [row["context"]["count"] for row in diagnostics] == [1, 1, 1, 1]
        assert len({row["context"]["nodeSequence"] for row in diagnostics}) == 2
    if scenario == "counter-reason": assert reasons == ["CALLBACK_SEEN", "NAME_OR_ROLE_MISMATCH", "NO_STRING_ITEMS", "ACCEPTED"]
    if scenario not in ["root", "owner", "proof", "invalid-token", "replayed-nonce"]:
        assert (observer.diagnostic_sequence, observer.diagnostic_counts) == old_counter, "新增诊断不得占用原拒绝计数"
    if scenario in ["accepted", "propertypage"]:
        expected = {"kind": "nvda-synth-speech", "engine": "NVDA", "version": "unit-test-only", "pid": os.getpid(),
                    "binding": binding, "request": node, "focusPid": 1234, "focusHwnd": "1001", "rootOwnerPid": 1234,
                    "focusOwnerPid": 1234, "foregroundHwnd": "1000", "ancestorHwnd": "1000", "isChild": True,
                    "mainAlive": True, "handleCreationTimeUtc": model["birth"], "focusName": node["name"],
                    "focusRole": focus.role_name.lower(), "synthesizer": "unit-test-only", "spoken": node["name"] + " 实际字符串",
                    "timestamp": fixed_now.isoformat(timespec="milliseconds").replace("+00:00", "Z"), "rawIndex": before_rows}
        assert spoken == [expected], "原语音字段或原始索引改变"
        assert reads == {"request": 1, "focus": 1, "name": 1, "role": 1, "speech": 1, "clock": 2, "warning": 0}
        assert reasons == ["CALLBACK_SEEN", "ACCEPTED"]
    if scenario in logging_modes:
        encoded_errors = "\n".join(errors) + stderr.getvalue()
        assert "v16.ui_nvda_speech_diagnostic_failed" in encoded_errors
        assert "私密" not in encoded_errors and reads["warning"] == 2
        assert reads["request"] == 1 and reads["name"] == reads["role"] == 1
    encoded = json.dumps(diagnostics, ensure_ascii=False)
    assert node["name"] not in encoded and "私密" not in encoded and "PRIVATE_ROLE" not in encoded and "实际字符串" not in encoded
    observer.terminate()
    assert state["closed"] == 1
    print(json.dumps({"isolatedModel": True, "actualSourceExecuted": True, "scenario": scenario, "pid": os.getpid(),
                      "actualNvdaCredit": False, "inputSent": False, "accepted": accepted, "diagnostics": diagnostics,
                      "reads": reads, "originalSpeechPreserved": True, "ownerHandleClosed": True}))


try:
    main()
except Exception as error:
    print(json.dumps({"level": "error", "event": "v16.ui_nvda_speech_diagnostic_model_failed",
                      "context": {"errorType": type(error).__name__}}), file=sys.stderr)
    raise
