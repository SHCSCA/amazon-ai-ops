## 2026-07-17T05:53:16Z
你是一个开发智能体 (teamwork_preview_worker)。
你的工作目录是: d:\Desktop\py\amazon-ai-ops\.agents\worker_report_writer
你的任务是为 `amazon-ai-ops` 项目创建并写入核心代码分析报告到指定目录。

请依次执行以下操作：
1. 创建目录 `d:\Desktop\py\amazon-ai-ops\output\code_analysis`（如果它不存在）。
2. 将 `d:\Desktop\py\amazon-ai-ops\.agents\explorer_apps\apps_analysis.md` 的内容读取并完整写入为新文件：`d:\Desktop\py\amazon-ai-ops\output\code_analysis\apps_analysis.md`。
3. 将 `d:\Desktop\py\amazon-ai-ops\.agents\explorer_packages\packages_analysis.md` 的内容读取并完整写入为新文件：`d:\Desktop\py\amazon-ai-ops\output\code_analysis\packages_analysis.md`。
4. 创建并写入主索引导航文件 `d:\Desktop\py\amazon-ai-ops\output\code_analysis\index.md`。

`index.md` 必须使用 100% 纯中文编写，内容包含：
- 对整个 `amazon-ai-ops` 项目代码分析报告的导航和介绍。
- 指向 `apps_analysis.md` 和 `packages_analysis.md` 的相对路径链接（例如 `./apps_analysis.md`、`./packages_analysis.md`）。
- 梳理整合系统整体架构逻辑，总结核心发现。
- 至少包含 2 个关键模块架构图或数据流转图的 Mermaid 源码（可以直接展示或者引用子报告中的架构图，但本索引文件中必须也展示至少 2 个清晰的 Mermaid 图表）。
- 明确指出至少 3 个潜在性能瓶颈、安全隐患或架构重构建议，并标明对应的代码文件及具体的行号 (Line numbers)。请从子报告收集到的问题中筛选出最关键的几个问题（例如：COALESCE导致索引失效全表扫描问题、N+1查询问题、主窗口缺乏 will-navigate 导航限制漏洞等）。

完成以上文件的创建和写入后，请向父智能体 (conversation ID: ab08ddd9-015a-4e87-a999-154a1658323e) 发送消息汇报完成情况和文件生成路径。

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
