## 2026-07-17T06:06:34Z
你是一个开发智能体 (teamwork_preview_worker)。
你的工作目录是: d:\Desktop\py\amazon-ai-ops\.agents\worker_test_fixer
你的任务是解决位于 `apps/desktop/src/renderer/pages/readback-page.test.tsx` 文件中的一个测试失败问题。

该测试在 Windows 上运行时失败，报错信息如下：
```
FAIL  apps/desktop/src/renderer/pages/readback-page.test.tsx > readback task-first workspace frame > publishes prepare, check, and fill results only for the current work-package request
AssertionError: expected 'async function prepareSessionPacket()…' to contain 'runReadbackWorkflowMutation<any>(\n  …'
```
这是由于 Windows 系统默认使用 CRLF 换行符（\r\n），而测试期望包含带有 LF 换行符（\n）的代码文本，这在断言时引发了不匹配。

请依次执行以下操作：
1. 深入分析 `apps/desktop/src/renderer/pages/readback-page.test.tsx` 约第 166 行左右的断言。
2. 将测试断言修改为“换行符无关 (line-ending agnostic)”，即在断言前，将实际字符串 and 期望字符串中的 `\r\n` 均替换/规整为 `\n`，或使用正则表达式进行匹配。
3. 运行测试命令：例如 `pnpm run test` 或使用 vitest 直接运行该测试文件，确认该测试文件在 Windows 下能完美通过（PASS）。
4. 确保修改符合代码规范，并在完成后向父智能体 (conversation ID: ab08ddd9-015a-4e87-a999-154a1658323e) 报告修复结果和测试运行的输出结果。

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
