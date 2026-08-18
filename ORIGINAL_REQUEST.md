# Original User Request

## Initial Request — 2026-07-17T13:49:26+08:00

# Teamwork Project Prompt

对 `amazon-ai-ops` 项目的核心业务模块（`apps/` 和 `packages/`）进行深度的源代码逐行/逐段读取与分析。必须避免粗颗粒度的概览，输出详尽的中文架构与逻辑审计报告。

Working directory: d:\Desktop\py\amazon-ai-ops
Integrity mode: development

## Requirements

### R1. apps/ 与 packages/ 核心业务代码深度分析
对 `apps/` 目录和 `packages/` 目录下的核心模块进行深度逐行读取。必须还原各核心文件的真实逻辑，包含但不限于 Electron 主进程入口、核心通信 IPC 管道、关键 API 交互流程、核心页面组件及状态管理。

### R2. 模块化中文 Markdown 报告输出
在 `output/code_analysis/` 目录下输出多份按模块归类的中文 Markdown 分析报告，并在 `output/code_analysis/` 根目录生成一份索引导航文件 `index.md` 指向所有子报告。所有输出及思考均为中文。

### R3. 系统架构图示与重构隐患分析
分析报告中必须包含核心模块的系统架构 Mermaid 图示、详尽的数据流转路径说明，以及对项目中潜在的性能瓶颈、并发冲突、安全隐患、代码异味（Code Smells）与具体的重构建议。

## Acceptance Criteria

### 报告输出与结构
- [ ] 在 `d:\Desktop\py\amazon-ai-ops\output\code_analysis` 目录下成功生成了索引文件 `index.md`，且包含了指向各个模块分析子文件的相对路径链接。
- [ ] 子报告中必须涵盖主进程与渲染进程的交互分析，且每个模块的分析报告主体字符数不少于 800 字（以确保分析并非简单概览）。

### 内容深度与要素
- [ ] 报告中至少包含 2 个使用 Mermaid 语法绘制的关键模块架构图或数据流转图。
- [ ] 报告中必须明确指明至少 3 个具体的潜在性能瓶颈、安全隐患或架构重构建议，并标明对应的代码文件及行号。
- [ ] 所有代码分析、逻辑推演和最终输出物必须使用 100% 纯中文表述。

## Verification Plan

### 自动化验证
运行验证脚本（或使用独立 Auditor 智能体），确认：
- `output/code_analysis/index.md` 存在且格式正确。
- 子报告目录中至少有 3 个非空 Markdown 报告文件。
- 使用 grep 检查生成的报告中不含 "Lorem ipsum" 或未填充的占位符（TBD），且主要语言为中文。

## Follow-up — 2026-07-17T06:05:42Z

# Teamwork Project Prompt — Finalized

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview

评估 `amazon-ai-ops` 桌面端应用的前端页面在视觉美观度、组件一致性以及 UI/UX 交互体验上的现状，识别体验缺陷并提供具体的分析与优化方案。

Working directory: d:\Desktop\py\amazon-ai-ops
Integrity mode: development

## Requirements

### R1. 前端页面美观度与视觉设计审计
对渲染进程的核心页面组件（如布局 Shell、首屏任务面板、数据报表表格等）进行设计美观度与视觉一致性（Color Palette, Typography, spacing）审计。

### R2. UI/UX 交互体验与性能缺陷审计
审计用户在典型工作流（如数据导入、参数修改、建议审批、回读执行）中的交互响应、加载与按钮忙状态反馈、聚焦控制，以及重渲染时的性能问题（如 VirtualDataTable 的列定义无缓存重算问题）。

## Acceptance Criteria

### 报告输出与质量
- [ ] 在 `output/code_analysis/` 目录下生成独立的中文前端审计报告 `frontend_audit.md`。
- [ ] 审计报告主体字符数不少于 1200 字，且结构清晰，无未填充的占位符。
- [ ] 报告中针对美观度与交互体验各列出不少于 3 项的具体改进建议，并对应到相关代码文件与行号。
