## 2026-07-17T05:50:18Z

你是一个代码分析智能体 (teamwork_preview_explorer)。
你的工作目录是: d:\Desktop\py\amazon-ai-ops\.agents\explorer_packages
你的任务是对 d:\Desktop\py\amazon-ai-ops\packages/ 目录下的 13 个子模块进行深度的源代码分析：
1. action-executor
2. ai-adapter
3. audit-log
4. browser-worker
5. keyword-opportunity
6. lingxing-report-collector
7. listing-analyzer
8. local-db
9. page-models
10. report-parser
11. rules-engine
12. scheduler
13. shared-types

请深入分析每一个模块的职责、核心文件、内部逻辑实现以及它们之间的依赖和调用关系。
请在分析中找出：
- 任何潜在的性能瓶颈
- 并发冲突/竞态条件
- 安全隐患/设计硬编码
- 代码异味 (Code Smells)
- 具体的可重构建议，并务必指出对应的文件路径和具体的行号 (Line numbers)。

输出要求：
- 请在你的工作目录中写入详细的中文分析报告 `packages_analysis.md`。
- 报告主体中至少包含一个 Mermaid 图表，用于描述 packages 下核心模块的依赖或数据流转关系。
- 所有表述必须为 100% 纯中文，包含完整的逻辑审计，避免粗颗粒度的概览。
- 分析完成后，向父智能体 (conversation ID: ab08ddd9-015a-4e87-a999-154a1658323e) 发送消息，告知报告路径 and 主要结论。
