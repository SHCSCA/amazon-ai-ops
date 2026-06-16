# Amazon AI Ops UI Redesign Implementation Notes

## Stitch Status

`C:\Users\wz\.codex\config.toml` 已配置 Stitch MCP：

- `[mcp_servers.stitch]`
- `url = "https://stitch.googleapis.com/mcp"`
- `X-Goog-Api-Key` under `[mcp_servers.stitch.http_headers]`

当前 Codex 会话没有暴露可调用的 Stitch 工具。已通过本地配置搜索确认配置存在，但工具发现只暴露 Figma 等设计工具。除非 Stitch 工具实际返回设计结果，否则不得声称界面来自 Stitch 生成稿。

## Product Positioning

这是跨境 Amazon Ads 运营后台，不是营销页，也不是审计控制台。首要目标是让运营人员知道：

1. 当前运营范围是什么。
2. 当前是否有真实 Lingxing 广告报表。
3. 数据是否已经导入成每日广告事实。
4. 今天应该先处理什么风险或缺口。
5. AI 与规则分别给了什么判断。
6. 哪些动作可以审批，哪些必须阻断。

## Navigation Contract

侧边栏按业务流拆分：

- 运营总览：仪表盘
- 数据与量化：数据采集、广告量化、运营事件
- 广告决策：优化建议、审批中心、执行回读
- 关键词与 Listing：关键词机会、Listing 优化
- 系统与交付：定时任务、设置、交付验收

禁止重新引入“v1.5 工作台”式单页大杂烩。

## Page Contract

每个业务页必须只承担一个主任务：

- 仪表盘：回答“今天先做什么”。
- 数据采集：回答“真实报表是否下载并导入”。
- 广告量化：回答“产品/广告对象处于什么阶段，阈值和风险是什么”。
- 优化建议：回答“规则和 AI 分别建议什么，合并结论是什么”。
- 审批中心：回答“哪些建议可批准，哪些需要复核或拒绝”。
- 执行回读：回答“真实动作是否有 before/after/readback 证据”。

交付验收、manifest、审计命令、缺失证据矩阵只允许出现在 `交付验收` 或折叠技术细节里，不得作为仪表盘和日常业务页的主流程。

## Data Visibility Rules

- 只有 `.xlsx/.xls/.csv` 且存在于当前 batch 下载目录、文件大小大于 0 的文件，才算真实广告报表。
- `json/html/png/md/txt` 以及文件名含 `manifest/audit/diagnostic/screenshot/dom/trace/evidence/acceptance/batch-result/downloaded-report-files/failure` 的文件，不计入广告数据。
- 没有真实报表或没有导入行时，不展示 0 花费/0 订单作为业务结论；必须展示“缺少真实报表/待导入指标”。
- US 站点显示 USD，禁止人民币符号。

## Dashboard Workflow

仪表盘的四步业务流固定为：

1. 获取真实报表。
2. 广告量化。
3. 生成建议。
4. 审批与执行回读。

交付验收不进入仪表盘工作流。它属于系统与交付菜单。

