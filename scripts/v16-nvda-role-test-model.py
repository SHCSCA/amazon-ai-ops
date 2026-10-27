import contextlib
import ast
import io
import json
import os
import sys
import types
import uuid


def main():
    directory, source, raw_role, expected_role, expected_result = sys.argv[1:6]
    harness = os.path.join(os.path.dirname(source), "v16-nvda-observer-test-harness.py")
    # 复用原全部系统端口，只选择未执行业务分支的新模型入口。
    sys.argv = [harness, directory, source, "canonical-role-model"]
    with open(harness, encoding="utf-8") as handle:
        program = ast.parse(handle.read(), filename=harness)
    boundary = next(index for index, node in enumerate(program.body) if isinstance(node, ast.If)
                    and isinstance(node.test, ast.Compare) and isinstance(node.test.left, ast.Name)
                    and node.test.left.id == "mode" and isinstance(node.test.comparators[0], ast.Constant)
                    and node.test.comparators[0].value == "privacy")
    model = {"__file__": harness, "__name__": "__canonical_role_model__"}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(compile(ast.Module(body=program.body[:boundary], type_ignores=[]), harness, "exec"), model)
    observer, focus, binding = model["observer"], model["focus"], model["binding"]
    focus.processID, focus.text, focus.role = binding["main"]["pid"], "受控测试按钮", types.SimpleNamespace(name=raw_role)
    node = model["request"](role=expected_role)
    observer.event_gainFocus(focus, lambda: None)
    command = {"kind": "nvda-owned-focus-request", "schemaVersion": 1, "runToken": binding["runToken"], "pid": os.getpid(),
               "nonce": str(uuid.uuid4()), "nodeSequence": node["sequence"], "nodeNonce": node["nonce"], "nodeId": node["nodeId"],
               "phase": "first-focus", "focusMode": "sequential", "phaseStartedAt": node["startedAt"], "startedAt": node["startedAt"],
               "deadlineAt": node["deadlineAt"], "baselineGeneration": 0, "allowAlreadyFocused": False,
               "name": node["name"], "role": expected_role}
    model["write"]("collector-focus.json", command)
    observer.poll_focus()
    ack_exists = os.path.exists(os.path.join(directory, "collector-focus-ack-" + command["nonce"] + ".json"))
    observer.observe(model["Sequence"](["受控测试按钮"]))
    spoken = [row for row in model["rows"]() if row["kind"] == "nvda-synth-speech"]
    passed = expected_result == "accept"
    assert ack_exists is passed and bool(spoken) is passed
    if passed:
        assert len(spoken) == 1 and spoken[0]["focusRole"] == raw_role.lower()
        assert spoken[0]["request"]["role"] == expected_role
    observer.terminate()
    assert model["state"]["closed"] == 1
    print(json.dumps({"isolatedModel": True, "rawRolePreserved": True, "focusAckAndSpeechMatch": True,
                      "accepted": passed, "actualNvdaCredit": False, "ownerHandleClosed": True}))


try:
    main()
except Exception as error:
    print(json.dumps({"level": "error", "event": "v16.ui_nvda_role_model_failed", "context": {"errorType": type(error).__name__}}), file=sys.stderr)
    raise
