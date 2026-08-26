# Operator Core Flow Repair — 2026-08-07

## 2026-08-26 v1.5.1 权限链修复与静态 Windows 候选

- 策略创建、更新、启用及 Grant 签发现在共享同一套生产权限校验：当前店铺、最新完成导入、精确绑定的非隔离报表快照、最新 Stage5 修订，以及活动/广告组范围所需的当前 Stage6 身份与会话代次。每次签发 Grant 都在同一 `IMMEDIATE` 事务内重验，旧 token、旧导入、旧证明或会话漂移不能沿用。
- 策略对象范围由真实规范身份驱动：活动 token 绑定 `adsAccountId/campaignId`，广告组 token 再绑定 `adGroupId`；同名不同 ID 不合并，普通界面隐藏内部 ID。缺少当前规范身份时不提供活动或广告组授权范围。
- 关键词 Listing 权威把 `match_type` 纳入 SQL 聚合、稳定对象键和路径，且要求来源行数精确为 1。精确/广泛匹配、不同 completed run、Stage5/Stage6 修订、证明哈希和当前会话均失败关闭，不再以名称或任意历史行替代真实证据。
- 执行工作台把选择的 batch/job/slot 与 before/after/reload 三段证据、进度事件和 Grant 精确绑定；A→B→A 的异步返回用 authority key 和单调序号丢弃，权限切换后旧结果不能写入新上下文。
- 红→绿关键证据包括：执行竞态 `1 failed / 23 passed → 24/24`；匹配类型 `2 failed / 17 passed → 19/19`；会话/证明/标签 3 个红测转绿；最新导入排序 `3 failed / 25 passed → 28/28`；Grant 会话漂移 `1 failed → 1/1 passed` 且没有落 Grant。
- 最终聚焦权限链为 `10/10` files、`157/157` tests；允许范围内全量单元为 `285/285` files、`3584/3584` tests；交付脚本为 `12/12`，没有 `.skip/.todo/skipIf/context.skip`。独立只读终审为 `NO BLOCKER`，另跑 `126/126` tests 并通过 `git diff --check`。
- 静态 `pnpm run build:win` 七步通过且 `freshCurrentRun=true`。Installer SHA-256 `444802A1B282AC8EA28CA621ACA375229401DF650DB406B89926BCB9B7FEB956`；portable `637E7CC1E1BCAF3D2BE574D7D97563E70CDA1A5CD47FD52B955197EE81355A1D`；folder ZIP `CF1A80BC9D3F17B28071BDE49B1551C49C5644E7C171784AB058734352A7C534`；Main bundle `1FAF882DA41047EA994B15EF73492BCFEE574A70AEFDBCD0CA8848527038FAB4`。源码与包内 Renderer 的 `s is not defined` 精确命中均为 0。
- 本轮没有启动或操控应用、浏览器、桌面，没有运行 typecheck、业务 smoke、Package UI、ZIP 真启动或真实 Ads，也没有发生广告写入。ASAR 未启用与 Electron 默认图标作为静态包装风险保留。
- 因用户动态验收禁令，当前结论是“源码权限链和静态 Windows 候选完成”，不是 `APP_READY`。状态保持 `APP_NEEDS_WORK / INTERNAL NON_READY`；剩余门为 typecheck、当前哈希绑定的 Package UI 100%/125%/wide、folder ZIP 真启动、7 类业务 smoke、正式库前后只读零写入复核，以及 Task 8B 对当前稳定且经单条人工批准的 `lower_bid` 做一次写入和刷新回读。

## 历史：2026-08-26 v1.5.0 Package UI 三档验证轨迹

- `operator-core-20260826-86` 的真实本次凭证提交被 runner 接受，状态从 preparation 进入 browser authorization；应用自动完成 ERP/Ads 与店铺识别并运行到 `experiments/ledger`。失败 manifest `.../operator-core-20260826-86/manifests/2026-08-26T02-21-08-457Z-...json` 的唯一业务缺口是两个变量 JSON `<pre>` 形成未标注嵌套纵向滚动区，不是 Ads 失败。
- 新滚动回归先为 `1 failed / 10 skipped`，旧值 `overflow:auto / max-height:64px`；最小修复为 `overflow:visible / max-height:none` 后同命令 `1 passed / 10 skipped`，完整实验工作区 `11/11`、desktop typecheck、production Renderer 与 7 类 business UI smoke 全绿。
- Windows 七步重建 generatedAt `2026-08-26T02:36:45.944Z`、全部 status 0；installer `02B2195A...2E80`、portable `590EA2C2...6666`、folder ZIP `14195C36...7AB9`、app content `9B293852...D786`。正式库 SHA 仍为 `A12AC801...D3B4`，authority preflight 明确没有 DB mutation 或 Ads execution。
- 新 folder ZIP 真解压启动通过：311,689,621 bytes、解压 EXE 与 win-unpacked 一致、packaged Renderer 就绪、PID 9404 已停止、临时目录已清理；证据 `output/codex-evidence/folder-zip-launch-smoke-1787712440720.json`。事后正式库以 readonly/query_only 回读，approval tasks 与五张 Ads execution 表全部为 0。
- production/package CSS SHA-256 均为 `3A4527A84A92186B5C63D597196866F24EB2B47897D5A15041862213F143AFF3`；包内 `.experiment-variables pre` 已是 `overflow:visible / max-height:none`，旧 `overflow:auto / max-height:64px` 命中为 0。此项仅证明新修复进入包，不替代 Package UI 实屏合同。
- `-87` 因 Windows 进入锁屏而主动停止，目标进程已清零；官方 inspector 返回不可续跑的 `RECORD_ROOT_REQUIRED`，故不修补或复用。全新 `-88` 已以 1874/1874 页只读 backup、精确 ACL 和 `SELECTED_SCHEMA_READY` authority 准备，尚未启动；解锁后只需启动该谱系完成 100%/125%/wide。
- 连续第 3 次恢复审计仍为 Windows 锁屏，应用、runner 与 `-88` Profile Chrome 全为 0，且 `-88` run group 尚未创建；同一外部条件已达到 blocked 门槛。当前停止自动开窗；操作者解锁并回复“已解锁”后，直接消费现有 `-88` Profile/authority 继续三档实屏验收。
- 解锁后的 `-88` 再次从 preparation 进入 browser authorization，并运行至 `memory/timeline`；唯一失败为普通时间线显示 `Policy runtime authority manual_approval:closed / policy_auto:closed`。新增公开转换用例修前 `1 failed / 7 skipped`、修后 `1 passed / 7 skipped`；运行模式和安全门仅做中文展示转换，底层事实与执行门不变。下一步是完整记忆工作区、typecheck、业务 smoke、Windows 重建与全新 Package UI 三档。
- 直接复验已完成：完整记忆工作区 `8/8`、desktop typecheck、production Renderer 与 7 类 business UI smoke 全绿；summary `output/codex-evidence/current-business-ui-smoke-1787713643287.json`。下一步只重建 Windows 包并创建全新 Package UI 谱系，不复用旧包的 `-88`。
- 上述中文转换已进入 app content `DC8B5786F66571694B53AD1397A504C448B4561310E08FC4B23541395363A2C5`；同轮 installer `44CCEBE9...DCE46`、portable `6C4ECCA5...ECAF5A`、folder ZIP `1B7F9D80...C9AB`，ZIP 真解压启动通过，证据 `output/codex-evidence/folder-zip-launch-smoke-1787714168893.json`。
- 全新 `operator-core-20260826-89` 再次完成本次可见提交、ERP/Ads 与店铺连接，并于 `03:26:28Z` 进入工作区。首轮 Ads 识别出现页面导航导致的 `Execution context was destroyed`，应用内一次“重试 Ads”后成功收口；因此该谱系的最终失败不是登录。manifest `.../operator-core-20260826-89/manifests/2026-08-26T03-17-30-507Z-...json` 仍在 `memory/timeline` 报普通文案技术值，protected DB unchanged。
- readonly/query_only 隔离库证明真实事件将技术内容拆为 `title='Policy runtime authority'` 与 `signal='manual_approval:closed' / 'policy_auto:closed'` 两列。新增真实分列回归先红（英文标题原样返回），字段级翻译后同用例绿；完整 `memory-workspace.test.tsx` 现为 `9/9 passed`，desktop typecheck exit 0。下一步只把该修复重建进最终包并以全新 run group 跑 100%/125%/wide，不续跑 `-89`。
- 最终重建已完成：Windows 七步全部 status 0，installer `A57A04CC...E1213`、portable `4EC3E774...F1A6D`、folder ZIP `0C4E2824...58A39`、app content `71DB2426...06C9`，Renderer `index-DSuEqklx.js`。新 ZIP 311,689,827 bytes 已真实解压启动并清理，证据 `output/codex-evidence/folder-zip-launch-smoke-1787715875590.json`。当前仅待全新 Package UI 三档实屏合同。
- `operator-core-20260826-90` 的最终包 100%/125%/wide 三档均实际完成工作区、console/page error 为 0、Electron orderly exit 0 且 protected DB unchanged。100% 通过；125% 与 wide 因 Ads 首次导航重载形成合法 `preparation→authorization→preparation→authorization`，被只接受两段序列的诊断验证器误判，manifest 为 `.../operator-core-20260826-90/manifests/2026-08-26T03-47-33-744Z-...json`。
- 新验收器回归修前 `1 failed / 209 skipped`，修后 `1 passed / 209 skipped`；完整文件 `210/210 passed`。实现仅允许严格交替、各段受原 phase timeout 约束、总时长受原 hard maximum 约束且最终授权成功的重试序列，连续同相位和超时段继续拒绝。用修后验证器对 `-90` 三档原始诊断反算均为 true；首次手输、secret-blind、Main attestation、正式库与 Ads 写入门未放宽。下一步以全新 `-91` 绑定新 runner 合同重跑，不改写旧证据。
- `operator-core-20260826-91` 最终 manifest 已 `passed=true / violations=0`：100%、125% 与 1400×900 三档全部 `phase=completed / failure=null / consoleErrors=0 / pageErrors=0`。首档重新输入并保存，后两档只复用 Main 本机安全区；125% 与 wide 的四段合法重试由新合同接受。证据 `output/codex-evidence/package-ui-evidence/run-groups/operator-core-20260826-91/manifests/2026-08-26T04-14-33-049Z-2026-08-26T04-14-33-049Z-59a17a8c-9ae5-4264-bd96-dc21a43b157c.json`。
- protected 正式库主文件前后均为 7,675,904 bytes / `A12AC801...D3B4` / 同一 mtime，逻辑 online backup 前后均为 `16642C58...EBF2`、1874/1874 pages；应用与 runner 进程事后为 0。正式库 readonly/query_only 回读 approval tasks=0、Ads 五张执行表=0。最新 4 条 `rule_ai` 仍无稳定 authority/id/revision 且降幅 19.6507%–26.1044%，超过 10% 策略门；因此产品与交付主链已闭合，但不能把 Task 8B 伪造成 APP_READY，恢复必须先有当前、稳定、≤10% 且经具体批准的新候选。
- 本轮源码、测试与状态文档已选择性提交 `8b1ad067` 并推送到 `origin/master`；本地产物、Package UI 证据、隔离 Profile、正式库、报表及 EXE/ZIP 未提交。

- 全新 `operator-core-20260826-84` 已识别操作者本次手输提交并完成 ERP/Ads 真实连接，随后进入 `decisions/recommendations`；登录链与 Ads 身份识别不是本轮失败点。
- 正式包首档运行时合同发现两项真实缺陷：详情列在 1366×768 形成 `524/957px` 嵌套滚动；普通界面把不可变分析事实中的 `rule-revision/model-revision` 原样展示。失败 manifest 为 `output/codex-evidence/package-ui-evidence/run-groups/operator-core-20260826-84/manifests/2026-08-26T01-03-38-598Z-2026-08-26T01-03-38-597Z-8e78d965-d4c8-4117-b31e-5d17243aa95f.json`，protected DB unchanged、Ads 写入仍为 0。
- 滚动合同修前 `1 failed / 16 skipped`、修后 `1 passed / 16 skipped`；详情列不再独立 `overflow:auto`，由页面统一承担纵向滚动。
- 技术证据展示修前 `1 failed / 17 skipped`、修后 `1 passed / 17 skipped`；原始 evidence/rule/model/source 技术值只进入可折叠“诊断详情”，普通界面显示“证据包已锁定 / 规则与模型版本已校验 / 规则与 AI 分析一致”，没有删除真实证据。
- 完整决策页回归为 `18/18 passed`、skipped=0，desktop typecheck 为 `$ tsc --noEmit`、exit 0；既有断言没有删除、跳过或放宽。
- production Renderer 已构建为 `index-BSpYGz9j.js`（1,683,671 bytes / SHA-256 `8656FFCBE5678ED774752CA679F577E10290CA6C6E3ACC2C0003A2C276A0548D`）与 `index-BUxkUFrI.css`（483,088 bytes / `BAA30CC7F87ADBAFB29F68103A8EB697A79515684AC45F54732F4721DCFF5B77`）。随后 7 类 business UI smoke 全绿，summary `output/codex-evidence/current-business-ui-smoke-1787707204127.json`；正式库 SHA/大小/mtime 前后不变，query_only 回读 approval tasks 与 Ads 五表仍全部为 0。
- 修复已进入新 Windows 包：七步构建 generatedAt `2026-08-26T01:28:30.288Z`、全部 status 0；installer `8DE17BB7...C10D`、portable `C8B33E6...3063`、folder ZIP `5A072731...4F82`、app content `A86E1AA2...B963`。新 ZIP 真解压启动通过，证据 `output/codex-evidence/folder-zip-launch-smoke-1787707736463.json`。
- 全新 `operator-core-20260826-85` 只含正式库 readonly online backup（1874/1874 pages、logical SHA `16642C58...EBF2`），integrity/query_only/ACL/authority 均通过。当前仍为 `APP_NEEDS_WORK / NON_READY`，直到该新谱系 Package UI 三档通过；Task 8B 仍需稳定对象、≤10% 且经具体批准的候选。
- `-85` 已真实启动并稳定显示首档连接工作台，但 60 秒内未检测到操作者提交，故严格以 `runs=0 / RUN_FAILED` 关闭；manifest `.../operator-core-20260826-85/manifests/2026-08-26T01-33-07-545Z-...json` 证明 protected DB unchanged。官方 inspector 返回 `RESUME_SAFE / violations=[]` 并生成单次 receipt `AF93F3B...4C6A3.json`；下次只续跑同一谱系，不重建或空开新窗口。
- 决策页修复、回归断言和状态文档已选择性提交 `3420e00a` 并推送到 `origin/master`；本地产物、证据输出、Profile 与正式库没有进入 Git。
- 自动续接只做后台只读核验：`master=origin/master=2920b18c`，新 ZIP/EXE/app content 仍为 `5A072731...4F82` / `67DC2A70...5E89` / `A86E1AA2...B963`；包内 JS/CSS 与当前构建哈希一致，决策详情列规则已是 `max-height:none / overflow:visible`，中文证据摘要已进入包。
- 正式库当前仍为 ERP/Ads ready、8/8 downloaded、8 files / 1961 metrics / 8 reconciliations、enabled 策略、active/fact 运营任务与 draft 经营实验；readonly/query_only 前后主文件 SHA-256 均为 `A12AC801...D3B4`。最新 4 条 `rule_ai` 建议仍缺稳定广告对象且降幅 19.6507%–26.1044%，human/policy 均不可授权，approval/authority/identity/Ads execution 全为 0。
- 因此后台门已收敛，仍不能标记 APP_READY：`-85` 恢复 receipt 完整但新包 Package UI 三档未实际通过；Task 8B 也没有具体、稳定、≤10% 且经操作者批准的候选。未收到明确再次启动指令前不空开窗口。
- 第 2 次自动续接审计再次得到完全相同的包、正式库、候选与零写入结果；`-85` receipt 未消费，应用/runner 为 0。本轮没有重复测试、构建或开窗；若下一轮外部状态仍不变，将依阻断规则停止自动续接。
- 第 3 次审计仍无任何变化，连续三次同一外部条件已满足 blocked 门槛。当前不再自动重试；用户明确“再次启动验证”后，使用现有 `-85` receipt 续跑，并由用户在 60 秒内本人提交。Package UI 三档通过前继续 `APP_NEEDS_WORK / NON_READY`，Task 8B 也继续因无稳定、≤10%、已批准候选而阻断。

## 2026-08-25 最新状态：新业务日 8/8 与真实 AI 已闭合，Task 8B 安全阻断

- 正式应用使用 Main-only 保存连接完成新业务日采集：`batch_20260825055104954_vk66s3` 覆盖 `2026-08-10 至 2026-08-23`，八类报表全部 `downloaded`、作业 `completed`；正式导入 `import_batch_20260825055104954_vk66s3` 为 8 source files / 1961 metric rows / 8 reconciliations，状态 `completed`。没有读取或代填密码、Cookie 或 Profile。
- 正式应用已保存并回读工作范围 `JF-US / US / USD / 2026-08-10 至 2026-08-23`，随后新建运营任务 `2026-08-10 至 2026-08-23 数据分析`，精确绑定上述 completed 批次、启用策略版本 1 与产品 `B0GVRVD4PK`。
- 续费后的真实 AI 分析成功：最新 `ai_diagnosis_runs` 为 `success=1 / model=deepseek-v4-flash / formal_recommendation_count=7`；同轮 1 次诊断与 7 次动作说明调用全部成功，来源为 `rule_ai`，不再是 HTTP 402 或 `rule_fallback`。
- 7 条建议中只有 4 条进入不可变策略快照。它们均为 `lower_bid`，但稳定广告对象 authority/id/revision 全为空，且降幅为 19.6507%–26.1044%，全部超过启用策略 10% 上限。approval tasks=0，五张 `ad_execution_*` 表全部为 0；当前没有可请求人工批准的合格候选，Task 8B 必须继续阻断。
- 实屏发现候选卡裸露两个英文安全码，已精确改为中文原因与下一步，底层安全码和授权门不变；定点回归为 `1 RED → 1 GREEN`，desktop typecheck 通过。当前 Renderer `index-BbtiQUFp.js` SHA-256 为 `6D5E78535679E112D4DAC2B8696A85E9B1EF0323DDF0A75C38A99FF5C442D9E5`，`s is not defined` 为 0。
- 新 Windows 七步构建通过：installer `A25219E34C569C87C8B8421559B9308698350DB95BC8BE1E65DEF5901C62F018`、portable `345A33A708DE8F183AB6236FB5AEDB9E65B3EF356A9BDEBB96F005BE91418768`、folder ZIP `7B645884BDC530F135C98F868B1D2E97E3F90A8663B6E609157E3A69099F608E`；EXE `67DC2A...5E89`、app content `08390336ED278B5B9825291A7DB74540C5905F4D7E3178A0C25C84B39DE54F3A`。新 ZIP 真解压启动通过，临时进程和目录均清理。
- 新包 7 类 business UI smoke 再次全部通过，summary 为 `output/codex-evidence/current-business-ui-smoke-1787643311350.json`。随后正式库 `query_only=1` 复核：approval tasks=0、Ads 五表=0、主文件 SHA-256 `A12AC8014E643EA0FDA986D2AF0BEAB2EDEC49A0FC8263AF5E9B3893D8F2D3B4`。
- Package UI 全新 `operator-core-20260825-80` 已绑定当前包、authority 与 readonly/query-only 隔离 Profile；首次 60 秒内没有操作者提交，严格以 runs=0 关闭。官方 inspector 已返回 `RESUME_SAFE / violations=[] / nextProfileId=100-compact` 并生成一次性 receipt；下一次只续跑 `-80`，由操作者本人手输一次，不重复构建或前置测试。
- 随后的最终核心六文件复验真实暴露 Ads 多店铺切换缺口：打开下拉后，菜单内目标标签被误当成顶部已选标签，导致顶部仍为 `FT-US 美国`。修复不写死 JF-US：只有期望标签唯一且顶部控件总数唯一才允许提前成功，否则继续动态选择并回读。最终原命令 `148/148 passed / skipped=0`，typecheck 通过。
- Main 修复使 `-80` 谱系失效。最终包已重建：installer `96EB004032E7FEDAA0C353CC0DAE8699C6637DCD17D7D01C41567FBE27EF9686`、portable `6B0F7BDB9D27FA53098F1D98ADCE2D71B9F5BCBAD5AB568BEA3D02D65B7C7602`、folder ZIP `E951A8ABDD68A9221C3B98E6848F0A3A4F0D0D8E8CFB7CB1F1733CD05B67FA47`、app content `AD87081CB0CFB375E1022BA9F0872E3DBB87F6C77EEF4838AF14C68B3F499502`。ZIP 真启动与最终 7 类业务 smoke 均通过。
- `operator-core-20260825-81` 已收到操作者本次手输，隔离库随后回读 ERP/Ads 均 ready，但 Ads ready 比 60 秒 authorization 截止晚约 3 秒，因此 manifest 严格失败。resume 又暴露 runner 把工作区连接状态卡误判为登录页；新增回归修前 `1 failed / 207 skipped`，修后完整 runner `208/208`，fresh typed 及 Main attestation 门未放宽。
- `-82` 因误复用被写入的旧 Profile，在启动前被 `PROFILE_DATABASE_HASH_MISMATCH` 安全拒绝。全新 `-83` 已用正式库 readonly/query-only online backup 建立（1874/1874 pages、logical SHA-256 `16642C...34EBF2`、三主体 ACL、authority `SELECTED_SCHEMA_READY`），但首次 60 秒 preparation 无操作者提交而安全关闭；官方 inspector 随后返回 `RESUME_SAFE / violations=[] / nextProfileId=100-compact`。当前总体仍为 `APP_NEEDS_WORK / NON_READY`：Package UI 三档尚缺当前通过 manifest；Task 8B 没有当前、稳定对象、≤10% 且经具体批准的候选。
- runner 修复与状态文档已选择性提交 `a43c0a4b` 并推送到 `origin/master`；证据输出、Profile、正式库、报表及 EXE/ZIP 未进入 Git。
- 随后只读终审确认最终四类产物哈希、7 类业务 smoke、ZIP 启动、`-83` 包/authority/Profile 谱系均一致；resume receipt 保留未消费、目标进程为 0。由于连续三轮没有新的首档人工手输，任务按阻断规则停止自动重启；用户回复“启动”后只续跑 `-83`。
- 用户要求继续使用电脑后，再次只在后台完成无窗口复核：Git 起始为 `master=c67b01b4=origin/master`，最终 installer/portable/folder ZIP/win-unpacked EXE 的现场哈希保持一致，7 类 business smoke 与 ZIP 真启动证据仍为 passed。正式库以 readonly + `query_only=1` 打开后，approval tasks 与五张 `ad_execution_*` 表仍全为 0，主文件 SHA-256、大小及 mtime 前后不变；`-83` 的单次 resume receipt 未消费。没有启动、点击或操控 Amazon AI Ops、Chrome 或其他桌面应用。
- 同一无窗口审计直接从正式库完成业务对象矩阵：ERP/Ads provider 均为 ready；最新业务日作业为 completed、8/8 downloaded；最新导入为 completed、8 files、1961 metrics、8 reconciliations；当前店铺存在 enabled 策略版本、active/fact 运营任务和 draft 经营实验。该矩阵证明连接、采集、导入、策略、运营任务、经营实验已经真实落库；剩余唯一产品验收门仍是与当前包绑定的 Package UI 三档通过 manifest。
- 用户明确“启动验证”后，runner 只启动目标包并进入 `100-compact` preparation；60 秒内没有本次手输提交，故按既定时限主动停止为 `runs=0 / RUN_FAILED`，没有运行连接链，也没有操控其他窗口。正式库 query-only 复核仍为 approval tasks=0、Ads 五表=0、SHA-256 未变。官方只读 inspector 已返回 `RESUME_SAFE / violations=[] / nextProfileId=100-compact` 并生成新的单次 receipt；下一次继续同一 `-83`，不得把此次未提交冒充 Package UI 或登录失败。
- 2026-08-26 再次启动时，`-83` 在登录 handoff 前复现 identity 阶段导航上下文失效，`runs=0`、protected DB unchanged；不是账号或 ERP/Ads 结果。新增回归先 RED（旧默认三次均遇导航，第四次本可成功）再 GREEN；实现仅把精确导航错误的默认有界重试扩到 20 次，未知错误与显式尝试上限继续 fail-closed。完整 Package UI runner 为 `209/209 passed`、语法检查通过。runner 合同变化后必须使用全新 `operator-core-20260826-84`，旧 `-83` 只保留历史失败证据。

## 2026-08-24 最新交付状态：五条主业务闭环，Task 8B 因过期建议与授权事实阻断

- 连接、真实 8/8 采集与 1901 行正式导入、四步策略、真实运营任务、真实经营实验均已闭合；当前实包保存凭证恢复回读为 ERP=true、Ads=true。保存密码仍由 Main-only 本机安全区托管，Renderer/执行者没有读取密码、Cookie 或 Profile。
- 新增当前店铺 Ads 对象只读发现链：按运行时店铺别名、唯一 profile、活动、广告组、关键词和当前竞价核验，兼容生产表格固定列镜像；建议详情提供“从当前 Ads 页面识别（只读）”，只填表，不自动绑定、批准或执行。
- 真实建议 2 已唯一找到 `U07-1P-精准 > 精准 > cupping` 的稳定广告组/关键词身份；页面竞价 `$1.80` 与报表证据 `$2.51` 不一致，因此应用按预期返回“建议已失效，禁止绑定或执行，请刷新数据后重新生成建议”。这不是 Ads 登录或店铺匹配失败。
- 精简红→绿证据：关键词生产 DOM/固定列用例 5/5、Preload 2/2、建议页入口 1/1；desktop typecheck、Renderer production build 和 `git diff --check` 通过。当前 7 类 business UI flow（连接、采集、策略、运营任务、经营实验、弹窗、按钮）全部通过。
- 2026-08-24T07:11:32Z Windows 七步构建通过：installer `C3587D7E48E42BDC9B28373D88264D178359315FCA6FABA76392557A2CA11D4B`，portable `317D948F28BD2C06DFAC17BEC4557334F2D9F54BAA0875923E9DF90C8C3A8791`，folder ZIP `99B40C48488B09F92FE987F31FFCC31C5ED465C0CD0A2E5935E5EB4573DA75B3`，win-unpacked EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`；源码 native bindings 前后不变。folder ZIP 真解压启动 passed、临时目录已删除。
- 正式库 readonly/query-only 终审：`action_recommendations=5`、`approval_tasks=0`，五张 `ad_execution_*` 表全部为 0；主库 SHA-256 前后均为 `6A9BA6DDC45CE8783259F55ACA0A11D11BE3BF9B3BE12F03B373FE3DF8C03849`。
- 当前仍为 `APP_NEEDS_WORK / NON_READY`：DeepSeek HTTP 402 使候选为 `rule_fallback`，当前候选又超过策略 10% 上限或已发生竞价漂移，没有可批准的当前 `lower_bid`；新包还没有绑定当前哈希的 Package UI manifest。不得把 build/smoke/ZIP 启动冒充 APP_READY。

## 2026-08-21 最新交付状态：当前包已构建，Package UI 待一次可见登录

- 当前 Git 分支为 `master`，本轮源码与状态文档已推送 `origin/master`；既有未跟踪本地目录保留，`output/`、正式库、Profile、报表及 EXE/ZIP 未提交。
- 当前 Windows 产物已重新按文件核验：installer `99E93B9CA6BA8A8BC489FA7F6FB234AF5FEAA429380E96ECA55299DC4FBA778E`，portable `488CD1B09EE21ECABB520A403D6B97CC1C4B5D8AC62442D1663D509D1A9B0C37`，folder ZIP `0094767AC505439E1AB1902AFAAD8B8D11C9D6DD67FA1A1E0662398A3B2677A3`，blockmap `981725081587C1127719AB70984ACF144A5887A51212CD372A31C0F1841292C8`，win-unpacked EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`。Package UI hash preflight exit 0，app content 为 `93443D3489876300D2D4EFA32E7E320D4E23109F0D1311A2DFEDE0A885AE58F8`（5118 files / 544,549,369 bytes）。文件夹 ZIP 已有当前哈希绑定的真实解压起窗通过证据。
- 当前生产 Renderer 与源码对 `DAILY MISSION CONTROL`、裸 `Mission`、`UNKNOWN`、`set_keyword_bid` 的精确普通界面文案检索均为 0；策略可用时的陈旧阻断原因、运营任务弹窗裁切及经营实验空依赖入口均已进入当前包。最新 7 类业务 smoke、desktop typecheck、七步 Windows build 与 ZIP 启动均通过；这些证据不替代真实 8/8、Package UI 或 Task 8B。
- 正式库最新只读事实为 `query_only=1`，查询前后主文件 SHA-256 都是 `4C107960F7F75DFC566438A35817F912DDB55E9220BB7F3DFA475922529789A3`。resume attempts 12、active claims 0、events 111；6 类 downloaded，`product_targeting=failed / LINGXING_CREATE_CONFIRMED_ABSENT`，`user_search_term=queued`；`report_import_runs`、`policy_versions`、`missions`、`experiments` 与五张 `ad_execution_*` 表全部为 0。
- 当前 Package UI run group `operator-core-20260821-74` 已由只读 inspector 判为 `RESUME_SAFE / violations=[] / nextProfileId=100-compact`，包哈希、authority receipt 与只含 readonly/query-only 在线备份的新隔离 Profile 均已绑定。唯一未完成动作是操作者在目标应用首档可见窗口中本人输入密码、勾选“记住密码”并提交；只续跑同一 `-74`，不复用旧包证据、不新建重复 run group。
- 因领星对两次 `product_targeting` 创建均返回 `POST .../batch_create_report -> 200（操作成功）` 却未形成可唯一回读的下载中心行，本轮禁止盲目第三次创建。真实 8/8/import、随后启用策略并创建真实运营任务/经营实验仍未闭环；同时正式库没有具体、当前且已批准的正向 `lower_bid` 推荐，Task 8B 与任何 Ads 写入继续阻断。总体结论保持 `APP_NEEDS_WORK / NON_READY`，不得标记 `APP_READY`。

## 历史：2026-08-21 店铺选择与续跑链已修通，领星商品投放创建 200 后仍不落行

- `completed_with_errors` 原位续跑的三道状态遗漏已用红→绿修复：local-db、scheduler double-read 与 production composition 现在接受该合法终态；完整 8 类、店铺/Profile、request/job/batch、durable fingerprint 与 MainRuntime CAS 等既有门不变。
- 领星创建页的店铺名不是配置值 `JF-US`，而是运行时展示的 `JF-US-US`。实现动态接受“当前店铺名”或“当前店铺名-当前站点码”两个规范化精确别名；不写死 JF-US、不做子串匹配，缺失或重复仍 fail-closed。
- 正式目标应用通过应用内会话重置与 Main 托管凭证重新获得 ERP/Ads ready；未读取或传递密码、Cookie、Profile。刷新下载中心诊断后，同一任务成功进入 resume attempt 11/12，证明三道状态门和动态店铺选择均已进入真实主链。
- 两次商品投放创建都收到 `POST /ak_download/download_center/index/batch_create_report -> 200（操作成功）`。第一次新名 `…064519` 经 reconcile-only 唯一查询确认不存在后才允许一次重建；第二次新名 `AAO_20260806_20260819_product_targeting_064758` 仍未形成可见列表行，因此安全停止为 `create_unknown`，不得再次自动创建。
- 正式库终态为 6 类 downloaded、product_targeting create_unknown、user_search_term queued；resume attempts 12、active claims 0、events 111、import runs 0，五张 Ads execution 表全部为 0。8/8/import、策略真实启用、运营任务、经营实验、Package UI 与 Task 8B 仍未闭合，总体保持 `APP_NEEDS_WORK / NON_READY`。
- 精简源码主链回归为 6 files / `186/186 passed`、skipped=0，desktop typecheck 通过。最后一处 production composition 修复只进入 Main 诊断副本；最近一次完整 Windows 构建（folder ZIP `A4EFA70E947805EE62C6770670F1683C7AF53544F2B57B9F20E3B094358563F7`）早于该修复，不能当作最终交付包。外部阻断解除后必须重新完整构建与验收。
- Git 当前本地 `master` 已包含此前功能分支的快进合并，并新增本轮提交 `c26be721`。一次 fetch 与两次 push 均因 GitHub 443 reset/timeout 失败；远端仍未同步，网络恢复后执行 `git push origin master`，未成功前不得宣称已推送。

## 2026-08-20 当前状态：连接已闭合，8 类采集在创建结果不确定态安全停止

- 当前 Windows 包已包含 parser 窄修复、部分导入 known-failed 恢复和重启前 cancelled 任务的 pre-batch 安全分类。聚焦回归分别为 parser `16/16`、import recovery `9/9`、scheduler adapter `75/75`，desktop typecheck 与 Windows 七步构建均通过。
- 当前包谱系：installer `723225012B07FE7321A7242592936283183A92B27F473D26DC30CE4CB6EE82EE`；portable `857E59CF33FAEDC41726AE80A017D20D90C0EBD66A0EAF2DB68D18DDCC5F4807`；folder ZIP `DF5210B34903B3728776B370C3E6400052FBA7AFDD1604AD22935AEA56AB58A7`；win-unpacked EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`；app content `2BCA88C048C889D971B58A37E3A2397D547779752A8048A88EB62FBAE9C99BDB`；Main bundle `3AE00CE179A46765BAB398A149F87524DDD5B3E9625C65549D502E5995E82F6E`。
- 正式 AppData 目标应用已通过当前店铺显式会话重置，以 Main-only 已保存凭证完成 `ERP/Ads 已连接`；没有读取或代输密码、Cookie、Profile。
- 随后的单次完整 8 类动作形成正式失败证据：`product_targeting` 创建请求结束后，30 秒内没有唯一回读本次生成的下载中心行，任务以 `LINGXING_CREATE_CALL_INTERRUPTED` 停止。5 类已下载，1 类为 `create_unknown`，1 类 failed，1 类 queued；没有 import run。
- 该状态不能自动续跑。必须先人工确认领星下载中心中目标报表是否存在；存在时只能精确接管该行，不存在时才允许生成新的创建请求。系统当前保持安全阻断，没有重复创建或广告写入。
- 正式库只读终审为 jobs 5、batches 3、files 9、imports 0；五张广告执行表均为 0。策略、运营任务、经营实验、Package UI 与 Task 8B 继续后置，总体为 `APP_NEEDS_WORK / NON_READY`。
- 恢复修复与文档提交 `668ac75e` 已推送到功能分支，并以 `--ff-only` 快进合并到 `master` 后推送；本地运行产物与正式数据未进入 Git。

## 历史：2026-08-20 parser 已修复；正式启动恢复门成为主阻断

- 用户明确授权 parser 两文件后，新增精确红测并最小实现：只排除店铺/国家/日期为空、状态为 `paused`、活动名存在且 8 个导入指标全部为严格零值或领星 `--` 的占位行；非零/非法指标仍整文件 fail-closed，source row 在过滤前固定。
- parser 单文件 `16/16 passed`，package typecheck exit 0。正式 campaign XLSX 只读直接解析为 `totalRows=192 / validCount=191 / invalidCount=0 / data=191`，保留源行 `2…192`；未改写工作簿或正式库。
- 新 Windows 包七步构建与 package launch smoke 均通过；installer `1F50EBE8A90B0DFFD5609FEF9E91B47A41BDA7BD4A9E614AB7819418893F2BA0`、portable `78AAF47DC6EF01594865D3FF57DC6824D63DB8DFE3B7DD4BB08AD0E8636B47DB`、folder ZIP `AD1D5E88323F551E6B2ADA2CBF3D62D0B9E55DDF7F68830B2FEFE24D8B764CA6`，EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`。
- 正式 AppData 启动暴露新的 Main 阻断：旧 failed 导入任务恢复结果为 `authorityFailed=1`，`assertLingxingImportStartupRecoverySafe` 在主窗口前抛出 `LINGXING_COLLECTION_IMPORT_RECOVERY_AUTHORITY_FAILED`。没有新 import run，目标进程已清理，Ads 写入保持 0。
- 正式库 `query_only=1` 进一步证明该任务只有 `1/8` downloaded checkpoint/file、持久错误为 `LINGXING_IMPORT_RECONCILIATION_EVIDENCE_MISSING`、`report_import_runs=0`。这是“仓储允许部分任务进入 recovery queue，而 Main 只接受完整 8 类 proof”的合同错配，不是 parser 复发或半提交。
- 既有仓储测试明确锁定部分任务必须进入恢复队列，因此不能删测或用 SQL 隐藏。安全修复应只让合法部分终态在无 immutable run 且 durable failed settlement 精确匹配时成为 known failed；CAS/跨店/已有 run/证据漂移继续 fail-closed。
- 当前 folder ZIP 启动证据也已闭合：`output/codex-evidence/folder-zip-launch-smoke-1787206148806.json` 为 `passed=true`，ZIP SHA `AD1D5E88323F551E6B2ADA2CBF3D62D0B9E55DDF7F68830B2FEFE24D8B764CA6`，解压 EXE 与 win-unpacked 匹配，临时文件和进程已清理。
- 按用户“其他发现先记录、确认后再改”，恢复链不在本轮 parser 两文件授权内，因此未修改或绕过。总体仍 `APP_NEEDS_WORK / NON_READY`。

## 历史：2026-08-20 XLSX 阻断定性（parser 修复前）

- 对正式下载的 campaign XLSX 做了只读结构审计，未修改源文件。第 193 行不是日级指标：店铺、国家、日期为空，状态为 `paused`，17 个数值指标全部为 0，27 个文本指标全部为 `0%`/`--`，且它是文件末尾唯一同型非空行。
- 当前失败根因是 report parser 对领星零活动实体占位行仍执行日级必填日期校验；连接、下载与文件完整性并非该次导入失败原因。
- 合法修复边界必须足够窄：只分类无日期/无店铺国家/暂停/全零指标占位行；任何非零或非法指标的空日期行继续 fail-closed，并保留原始 source row。该授权已于后续收到并按上述边界完成。
- 当前正式库仍没有 import run、启用策略版本、运营任务、经营实验、推荐或审批，广告执行保持 0；不得标记 `APP_READY`。

## 2026-08-19 最新交付快照（当前事实）

- 当前 HEAD 与远端均为 `5d53747e`；最新重建包 EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`，app-content `A42398CEFD3CB076773D1668BF7C1E982CF6E3DB797AAF5999DB6B3038CA6DD0`；installer `DD00E35D95758664721BCBC08C41194A5AE1E2FC91B9679ED180D57BB883C6C2F`，portable `1A5DFBFEDBAB56C3B440C8408B2F99590D0AC426800F0B2A2452B5D0774663B9A`，folder ZIP `F66B66B711982076E160768342BF49E82BD845958941C5ECBAC60019B767CB28`。
- `build:win`、package launch、folder ZIP launch、业务 smoke 均通过；业务 smoke 为 6/6 子脚本和 7/7 flow。它们不替代真实入库证据。
- 全新 Package UI `operator-core-20260819-70` 绑定当前包，但因 60 秒内未收到操作者本人登录提交而以 `PACKAGE_UI_OPERATOR_WINDOW_CLOSED` 失败；历史 Package UI manifest 不得替代当前包。
- 正式库当前为采集 jobs 3、批次 2、文件 2、导入 0、策略启用版本 0、运营任务 0、经营实验 0、推荐/审批 0；广告执行表全 0。真实下载成功后，报表第 193 行日期为空导致严格导入失败。
- 因 `packages/report-parser` 在本轮授权范围外且用户要求先记录再确认，暂不跳过坏行或放宽日期校验。总体仍 `APP_NEEDS_WORK / NON_READY`，不得标记 `APP_READY`。

## 2026-08-19 当前交付状态（下载成功，导入阻断；不得标记 APP_READY）

- 连接恢复已在最新 Windows 目标应用内闭合：保存凭证重连遇到身份门时显示当前店铺专用重置动作；应用内重置后再次重连不需手输，状态为 `ERP/Ads 已连接`。凭证、Cookie、Profile 均未被执行者读取或打印。
- 真实采集已形成 durable 下载证据：`batch_20260819041021809_613h3r` 为 `download-existing` campaign 任务，job/batch `completed`，文件 `downloaded`、41504 bytes。已有报表行匹配改为按稳定报表类型回读，避免为历史行虚构新时间戳名称。
- 真实导入仍 fail-closed：报表第 193 行日期为空，严格校验返回 `LINGXING_COLLECTION_IMPORT_FAILED`，任务 `importState=failed`，没有 `report_import_runs`。不把下载成功当作生产入库，也不跳过该行。
- 本轮验证保持压缩：相关两文件聚焦回归 `3 passed / 80 skipped`，desktop typecheck、`build:win`、`smoke:package-launch` 均通过；构建产物 EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`、installer `E13DDAEC88DBAE0950A002BE163F6C08132A09E9C9421EF1D3BA7F237EB7DF89`、portable `1EA40051EE3AB86313537B03C8C774F73417E46250EFE5C4ECB35B31EC134E16`、folder ZIP `5090774DB52E80D629F3D584CA856C0484EB9ABED061B78E9AAFDED25F21BBF1`，原生绑定未变化。
- `pnpm run smoke:folder-zip-launch` 同样 `passed=true`，ZIP/EXE SHA 精确匹配且临时进程清理；证据 `output/codex-evidence/folder-zip-launch-smoke-1787114238805.json`。该证据属于本地提交，因 GitHub 连接重置尚未推送。
- 当前剩余主阻断是范围外的 `packages/report-parser` 坏行处理，等待用户明确确认；策略、运营任务、经营实验、当前包 Package UI 与 Task 8B 仍不宣称完成，Ads 写入继续为 0。
- 2026-08-19 追加一次主动作复验：应用先把范围恢复为 `2026-08-04` 至 `2026-08-17`，随后完整 8 类动作在旧 `campaign/create_unknown` 检查点处立即安全停止；人工核对入口保持禁用。没有重复创建报表、没有拼接独立任务、没有新增广告写入。
- 当前源码业务 smoke 单次复验通过：`pnpm run smoke:business-ui-current` 为 6/6 子脚本、7/7 flow coverage，汇总 `output/codex-evidence/current-business-ui-smoke-1787115252897.json`；这不等价于正式库 8/8 导入或广告执行证据。
- 只读状态快照仍显示策略/任务/实验/导入/推荐/审批均未形成真实记录，Package UI 仍缺当前包新 manifest；当前本地与远端均为 `b3ae3e31`，已完成同步。

## 2026-08-14 当前验收状态（覆盖下方历史记录）

- 结论仍为 **NON_READY / 不得标记“开发完成”或 `APP_READY`**。用户指出的 `Mission 队列`、`DAILY MISSION CONTROL`、裸 `UNKNOWN` 与 `authority/Main` 等普通界面漏出已修复，并新增覆盖 25 类内部词的真实 DOM 反向门；折叠“诊断详情”继续保留内部状态和原始证据。
- 当前源码门：任务书原始六文件精确命令 `6 files / 120/120 passed`；末端文案组件 `7 files / 76/76 passed`；Package UI runner/currentness `198/198 + 2/2`；业务预览合同 `18/18`；均 skipped=0。desktop typecheck、production Renderer（`assets/index-aTNft9Pp.js`）均通过。
- 当前业务门：`pnpm run smoke:business-ui-current` 6/6 子脚本、连接/采集/策略/运营任务/经营实验/弹窗/按钮 7/7 流程全部通过，采集 requestId=`lx:recreate-full:mssbuko4:fa25013a-a335-4c77-b6ea-6ced21b3`，summary=`output/codex-evidence/current-business-ui-smoke-1786674505600.json`。
- 当前 Windows 包：installer `BB18A6B25A2572B38DD2B69085E649608ECE5416266940547ABA84BC1138B89F`；portable `D63C732FEC8D96912C727CEE99703D7CA2AF77002EDC4EFDED7C07953C9FF0E6`；folder ZIP `CA26C4C92A318F9F50FED91AF15E6DEA78754CFB159D8E13DE9FA4D876ADEE37`；win-unpacked EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`；app-content `DA79586C7A418A3FC5B6472893B525065897DE191A072218FFAC45FB504B3135`（5118 files / 544,437,129 bytes）；Main 源码/包内均为 `43AE62FA66ED883A28D19C6BA539213DC30CDF132DA9D87A99704095D64D4FAC`，Renderer `index-aTNft9Pp.js` 源码/包内均为 `9FDF2962958E45DF9D74581DB2ABFC0A6C7F0B9ACB3391B34C777110F9A38461`。`build:win` 七步 status 0，folder ZIP 真实启动通过：`output/codex-evidence/folder-zip-launch-smoke-1786674928438.json`。
- 新包正式 Package UI 尚未通过。全新 `operator-core-20260814-68` 的隔离 Profile、三主体 ACL、316/316 页 readonly/query-only online backup 与 `SELECTED_SCHEMA_READY` authority receipt 均已通过；首档在 180 秒 preparation 内没有收到操作者本人提交，故 `runs=0`、未进入 ERP/Ads、没有业务截图并按边界 exit 1。随后合法续跑 inspector 的两个假漂移已按 TDD 修复：只读 SHM 仅允许两处 mtime 漂移，其他 SHM/WAL/journal 内容与路径仍拒绝；canonical DB 路径哈希改为与 Package Runner 相同的 Windows lexical 语义，不同路径仍拒绝。完整 inspector 为 `50/50 passed`，官方检查 exit 0、`RESUME_SAFE / violations=[] / nextProfileId=100-compact`，一次性续跑凭据为 `output/codex-evidence/package-ui-evidence/resume-intents/operator-core-20260814-68/777A37E18183C1EB10B4B77AB47187C0186CDDE462DE6599CC81E59234E8F481.json`。仍须操作者在目标应用亲自提交后跑完三档；旧 `operator-core-20260813-67` 已降为历史基线，不得替代当前包证据。
- 正式库终审：`mode=ro&immutable=1`、`query_only=1`；`ad_execution_batches/jobs/events/evidence/domain_reconciliations` 五表全部为 0，main/WAL/SHM/journal 的 exists/size/mtimeNs/SHA-256 查询前后全部不变。main 仍为 1,294,336 bytes / `E8E05025B44DA23442B06603C187C728749EB022804198F0A4455C37B803EAE9`。
- 除新包 schema-v8 100%/125%/wide Package UI manifest 外，全局 Task 8B 仍独立阻断：正式库当前没有可执行且已批准的正向 `lower_bid` 推荐，缺具体 recommendationId/revision、对象、前值、审批记录及 after/reload 回读。不得把一般性“完成 Task 8B”当作某一广告动作的批准；在这些条件成立前广告写入继续为 0。

## 历史：2026-08-13 当时成品与验收状态

- 连接主链已按阶段保真：ERP 成功不再被 Ads 失败抹掉；Ads 从 ERP 侧栏进入，有界处理可见公告，从运行时 `collectionStoreName` 动态匹配任意美国站店铺，经 NFKC/大小写/空白规范化后仅接受唯一精确选项与选后回读。没有写死 `JF-US`；缺失、重名、身份变化或浏览器关闭仍立即 fail-closed。
- 用户报告的“未勾选重置则闪退”根因已修：旧实现在真正 Ads 页面出现前，错把 amazon-ads controller 仍停留的 ERP 文档绑为 Ads 存活页，随后误降级为 `VISIBLE_BROWSER_CLOSED`。现在只对已属于对应受信 provider 的文档绑定 liveness，真正的 Ads 关闭/身份漂移门不变。
- 八类采集生产请求已移除默认参数/可选链压缩导致的 UUID 越域；业务 smoke 真实触发 requestId/IPC，当前包 `s is not defined=0`。策略为四步、V1 唯一动作为调整关键词竞价，并明确“数字越小越优先”与完整上下限。运营任务/经营实验只使用当前店铺真实产品、已完成批次、已启用策略和可执行广告对象，已删除伪造批次/版本。
- 当前回归：任务书六文件 `118/118 passed`，Ads 定向 `69/69`，Mission Control + Readback `101/101`，Package UI runner `195/195` 与 authority-currentness `2/2`，均 skipped=0；desktop typecheck 与 production Renderer 构建通过。2026-08-13 15:55 对后两项重新串行复验为两个文件 `197/197 passed`。`pnpm run smoke:business-ui-current` 为 6/6 子脚本且连接、采集、策略、运营任务、经营实验、弹窗、按钮 7/7 通过，summary 为 `output/codex-evidence/current-business-ui-smoke-1786602024788.json`。
- 当前 Windows 产物：installer `E9ECE230B239C00F0325A2BC9A12B85F074AEF12B8BB59C77C2E6523B163ED03`；portable `94E8F3376A682D62F7B64CF4FFEA636053D415F076D4C0B7525EC532F04B5030`；文件夹 ZIP `E7D45196A4EE879C5A0882FC0D7EAB073BBB2324FC7EEEBC0A2A32B9DE5AB8BB`；win-unpacked EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`；app-content `8A5371B337536909EED8E4D6420A2E1BC419C673FBF1DD0EF57758E237C98A3E`。文件夹 ZIP 已真实解压起窗并清理，证据 `output/codex-evidence/folder-zip-launch-smoke-1786602591414.json`。
- 正式库终审使用 `mode=ro&immutable=1` + `query_only=1`；main/WAL/SHM 查询前后长度、mtime 和 SHA-256 逐项不变，journal 前后均不存在。main 仍为 1,294,336 bytes / `E8E05025B44DA23442B06603C187C728749EB022804198F0A4455C37B803EAE9`；`ad_execution_batches/jobs/events/evidence/domain_reconciliations` 五表全 0。
- 最新正式 Package UI 已闭合：全新 `operator-core-20260813-67` 的 schema-v8 manifest `output/codex-evidence/package-ui-evidence/run-groups/operator-core-20260813-67/manifests/2026-08-13T08-28-00-516Z-2026-08-13T08-28-00-516Z-414cf23b-6116-490e-9275-b5822a4562be.json` 为 `passed=true / violations=[] / completeness.passed=true`。同一 invocation 生成 100%-compact、125%-compact、wide 三个不可变 checkpoint；两档 compact 各检查 10 个工作区、3 个弹层与 scheduler 子视图，wide 检查决策/产品指定宽屏入口。三档 console/page errors 均为 0，lifecycle、进程/Profile/锁隔离全部通过。
- 首档由操作者本人在目标应用直接输入并保存，后两档使用 Main 保存凭据；runner 继续声明且实际保持 `runnerReadsSecrets=false / runnerTypesSecrets=false`。执行者只在目标 Amazon AI Ops 应用内点击非秘密连接/精确店铺确认动作，没有操控桌面或其他应用。manifest 将包绑定为 EXE `67DC2A...5E89`、app-content `8A5371...A3E`，正式库文件及逻辑 online-backup before/after 均不变。至此本任务书 scoped 状态为完成；任务书之外的全局 Task 8B 真实广告执行/回读仍需独立外部证据，因此不把本结果扩大为全局 `APP_READY`。
- 正式运行结束后又做一次独立只读终审：WAL=0 bytes、journal 不存在，SQLite `mode=ro&immutable=1` + `query_only=1` 下五张 Ads execution 表全部为 0；main/WAL/SHM/journal 的 exists、size、mtimeNs、SHA-256 查询前后全部不变，正式库仍为 1,294,336 bytes / `E8E05025B44DA23442B06603C187C728749EB022804198F0A4455C37B803EAE9`。

## 历史：2026-08-11 17:04 Ads 候选确认修复与当时交付状态

- 最新真实诊断证明底层 SSO 与动态选店已走通：新 EXE 从 ERP 侧栏进入独立 Chrome Testing 的“下载中心”，自动唯一识别当前 `collectionStoreName=JF-US`；实现没有写死 JF-US，其他美国站店铺仍由同一运行时别名与唯一精确回读合同处理。
- 用户看到“Ads 已打开但仍待识别、重试 Ads 又不可点”的直接根因在 Renderer：`amazonAdsReadinessDetail` 先判断 `adsPageVisible`，吞掉了已经存在的 `adsIdentityCandidate`；同时 `retryAdsReady` 正确拒绝候选状态，因此文案与按钮相互矛盾。
- 修复后候选优先：顶部显示“ERP 已连接，Ads 待确认”，主动作区只渲染一个动态按钮“确认 <当前店铺> 并完成连接”；候选存在时不渲染重试、重新连接或禁用原因。Package UI 既有确认选择器移到同一主按钮，全页仅一处；人工确认、店铺隔离与真实写入阻断门没有放宽。
- 红→绿：新回归先为 `1 failed / 25 skipped`（候选判断索引 309 晚于页面可见索引 33），修后聚焦 1/1；完整连接/凭据 8 files `117/117`、任务书六文件 `109/109`、skipped=0；desktop typecheck、production Renderer、7 条业务 smoke、Windows build 与 folder ZIP 启动均通过。
- 严格视口现场抽查：同一真实 Ads 候选分别在 1200×700@100% 和 1200×700@125% 精确形成，document/main 均无横向溢出，唯一确认按钮完整位于视口且可键盘/滚动到达，alert 为空；干净截图为 `ads-confirmation-1200x700-100-20260811.png` 与 `ads-confirmation-1200x700-125-clean-20260811.png`。Package UI runner/currentness 另为 186/186、skipped=0。
- 新包现场机器快照只有 `{action: confirm-ads-identity, text: "确认 JF-US 并完成连接", disabled: false}`，`reconnect-all` 与 `retry-ads` 均不存在；截图为 `output/codex-evidence/ads-confirmation-button-20260811.png`。这证明修复已进入真实包，不只是源码合同。
- 当前产物：EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`；app-content `4E4304A917F49BB065135C56DC46ECDF8BA67786643C0B61BF7CE03696EE880A`；installer `A385665361BD8F0ADE7DE2B29B331F0673E5FDCC459EA903364E5791278C1C31`；portable `FAF56F5237BA3897B816DDF592B3AB65DC765C3E19829CA1800E52C7624AAD76`；folder ZIP `AB3FBD02C5B78236BA2DFADFF0D3278B2E645838520EAF75FED53012402451F4`；Renderer `113D5C8C9F9078B4803393017EBFFA059E6614C9C33A711CED6444CAE8070FAF`，包内 `s is not defined=0`。
- 正式库仍为 1,294,336 bytes / `E8E05025B44DA23442B06603C187C728749EB022804198F0A4455C37B803EAE9`，五张 `ad_execution_*` 表全 0；隔离诊断未读取/打印密码或 Cookie，也没有点击广告业务操作。
- 未闭合门仅为正式 Package UI 的新鲜手输凭证确认和 100%/125%/wide manifest。操作者回来后本人手输本次密码并提交，再点击唯一确认动作；执行者不代填、不绕过。通过前结论仍是 `APP_NEEDS_WORK / NON_READY`。

## 历史：2026-08-11 连接设计与当时交付状态

- 连接定义已拆开：① ERP 可见会话已验证；②从 ERP 侧栏进入 Ads 并读到可信 profile 证据；③下载中心对当前店铺做唯一精确选择与回读；④首次稳定身份由操作者确认。仅“Ads 页面打开”或“下载中心已手工选择店铺”都不足以标记 Ads 已连接。
- 不再以 Ads 直链代替领星 SSO。正确顺序固定为“登录 ERP → 点击 ERP 左侧广告 → 处理可信 Ads 公告 → 进入下载中心 → 动态选当前店铺”；直接打开 `ads.lingxing.com` 会绕过 ERP 颁发会话并可能落入 `/restartLogin`。
- “绑定领星广告账户”保留，但含义改为当前店铺的一次性稳定 Ads 身份登记，不是每次连接都要求人工找内部编号。它是多店铺严格隔离所必需：防止浏览器复用旧店铺会话时把 A 店 Ads 数据或写操作归到 B 店。后续每次连接只重验当前 profile 与下载中心唯一店铺选择；身份未变则无需重复人工绑定，身份变化则立即降级并阻断真实写入。
- 店铺匹配不写死 `JF-US`：使用当前店铺配置的 `collectionStoreName`，对任意美国站别名做 NFKC、大小写与连续空白规范化后的唯一精确匹配；缺失、重复、非美国站、选择后无法唯一回读都 fail-closed。公告按页面实时总数有界处理，不假设只有两条。
- “允许重置旧会话”不再是启动按钮前置条件。未勾选时允许先做非破坏性检查；只有实际检测到冲突旧登录且必须清理本店独立会话时，Main 才要求明确授权。密码仍只在 Main 安全区处理，Renderer 和证据脚本不读取密码/Cookie。
- 顺序根因红→绿：新增三条初连/retry/confirm 回归在修前为 `3 failed / 1 passed / 19 skipped`，修后为 `4 passed / 19 skipped`；完整连接/凭据 8 文件 `111/111 passed`、任务书六文件 `106/106 passed`、skipped=0。desktop typecheck、生产 Renderer、7 条业务 smoke、Windows build 与 folder ZIP 启动均通过，包内 `s is not defined` 为 0。
- 当前包：installer `4884FC11034E27F3BFE494B65699BD71E4476D964C5C707F8AA75252468A3804`；portable `F4AD76539B03FC1F67F2A73CA355E9D6741462D880F5AA588EA18E3B6BFFE4F3`；folder ZIP `693D84E70A1B1EB942BAF0F68C1BA50F2B3F7E663CA425A5BBED1ABDF6126DC7`；app-content `21DC78BC5DE0074FBF46C6E1A8331D45EA2350C201B70DFD67D9949E796EE516`；Main `FB40F4FFD0C0EFC3A2CD0E949D7F476A2588623C792322A7CF6E1270AE1F377E`；Renderer `D1579379387A4F64D25E86C1C41AF17CE11F89B321DA0D3347780EEC435C10E0`。
- `operator-core-20260811-23` 因 900,000ms 内没有密码提交而严格结束为 `passed=false / runs=0`；随后全新 `-24` 的整个 900 秒准备阶段又被 Windows 锁屏挡住，runner 从 900 秒倒数到 7 秒始终没有提交，最终同样 `passed=false / runs=0`。两轮都未进入授权，不能评价新链路；`-24` 的 interaction/process/profile-lock/file-isolation/freshness 与正式库 before/after 全部通过。下一轮只在操作者已解锁并能立即提交时创建全新 `-25`；通过前总体仍为 `APP_NEEDS_WORK / NON_READY`。

## 历史：2026-08-10 续接记录

- 现场新证据确认旧包仍有三项缺口：Main 已托管凭证被 Renderer 漏判为不可重试、Package UI 登录后误点解绑裸露内部英文、领星下载中心的店铺 FilterSelect 晚于身份接口渲染。三项均先补确定性红测再最小修复。
- 红→绿：`browser-login-staged-status.test.ts` 新增两条后为 `2 failed / 7 passed`，修后 9/9；延迟 250ms 注入任意店铺 `BRAVO-US` 的真实 Chromium 用例修前 `1 failed / 18 skipped`，修后 `1 passed / 18 skipped`。完整连接/SSO 为 8 files / 86 tests、skipped=0；任务书六项核心为 6 files / 92 tests、skipped=0。
- 店铺适配不写死 `JF-US`：运行时从当前店铺的 `collectionStoreName` 取别名，NFKC/大小写/连续空白规范化后仅接受唯一精确匹配；旧 Element UI 与新版 FilterSelect 均支持。新控件最多等待 40×250ms，重复项立即阻断、浏览器关闭立即降级、选后必须唯一回读。
- Ads 公告按实时 `(current/total)` 有界处理，最多 64 次，只在可信 Ads 域内操作可见“变更公告”；未知按钮、歧义、无进展或普通业务弹窗均不点击并继续阻断。
- 最新源码门：受影响面 34 files / 353 tests、Package UI runner/currentness 2 files / 186 tests 全绿且 skipped=0；任务书原始 6 文件最终复跑 97/97；desktop typecheck 通过；production renderer `index-rTFjbpw_.js` SHA-256 `A854D737B4C3233694A2B1858D66D7505E68BC65CD6541CF7BB1ACCC222AF266`，`s is not defined=0`；`smoke:business-ui-current` 最终 6 个脚本和 7 条 flowCoverage 全部通过，采集请求 `lx:recreate-full:msmqyrd0:beb5107b-44df-463e-a2d4-1ebc50c0`，summary `output/codex-evidence/current-business-ui-smoke-1786337107499.json`。
- 最新 Windows 构建：installer `7970DE8AB867F28BDE26F55873698B61A5849BC05869B13B5BACACFC2C0A3458`；portable `38D1565A0434894BCFF0C7BB9B45C98E267B093753A2E81186044D0723DACCE2`；folder ZIP `28B663E9C3F8A81B1BA65301073910DA2AB42E6C63089F198AFEF83AD788803E`；app-content `550E7338D3D66BC98DC9B8810B3EEF5E99121A5B29BBAF28CBE4824B50CC248C`；Main `DAB0FC49A5BD762495B38A8429BD9C784983693D1C6E74E0E3FD182F5345F56F`。源码与包内 Main/Renderer 逐一一致。
- 文件夹 ZIP 启动 smoke 通过，证据 `output/codex-evidence/folder-zip-launch-smoke-1786335474811.json`；正式库主文件仍为 1,294,336 bytes / `E8E05025B44DA23442B06603C187C728749EB022804198F0A4455C37B803EAE9`，广告执行四表均为 0。
- 最新 Package UI `operator-core-20260810-15` 在完整 900,000ms 内没有形成持久提交，停在 preparation 并 fail-closed；`runs=0`、未进入授权、未执行登录，不能用于判断 Ads 匹配修复。manifest 的进程/Profile/锁/数据库隔离和正式库 before/after 均通过。当前仍为 `APP_NEEDS_WORK / NON_READY`；下一次只能使用全新 `-16` Profile，且必须由操作者在窗口出现后当场点击，不能 resume `-15`。

## 历史：2026-08-07 阶段结论

该阶段已修复连接状态误报、首次登记闪退入口、八类采集、策略、运营任务与经营实验主链，并生成当时的 Windows installer、portable 与文件夹 ZIP。用户追加报告的领星新版店铺筛选器也已修复：实现从运行时 `collectionStoreName` 动态匹配任意美国站店铺别名，不写死 JF-US；缺失、重名或提交后无法唯一回读仍会阻断。当时源码主链已在真实领星下载中心唯一选择并回读当前店铺。Package UI 的提交序号已跨 Authority 刷新持久化。用户随后明确解除原 3 轮上限并允许继续；历史 `operator-core-20260807-09/-10` 均进入当时最新包的 100% 可见连接工作台，但各自在 300 秒内没有发生人工提交。这两轮只作历史失败记录，当前结论与恢复条件一律以本文顶部 2026-08-13 小节为准。

## 红到绿证据

- 连接：新增阶段状态红测后 `4 failed / 11 passed`；修复后 8 个 login/SSO 文件 `72/72`，skipped=0。Ads 失败保留已验证 ERP，只读采集可继续，真实 Ads 写入保持阻断。
- 采集：旧生产 bundle `index-DITJzMPt.js` 含 `r.call(s)`；新包 `index-Cea0zs6N.js` 的生产点击捕获请求 `lx:recreate-full:msidegc9:3c24b3ba-586f-43d4-b016-0acb955e`，`s is not defined=0`。
- 策略：新增四步合同后 `1 failed / 6 passed`；修复后 `8/8`。V1 只允许调整关键词竞价，优先级数字越小越先匹配。
- 运营任务/经营实验：新增真实来源和结构化选择断言后 `2 failed / 9 passed`；最终连仓储归属检查 `18/18`。普通界面无伪造批次/版本和裸露技术值。
- Package UI currentness：新增回归后 `1 failed / 1 passed`；修复后 2/2，且 SHM 内容哈希漂移仍严格拒绝。
- Package UI 生产入口：导航标签与真实连接工作台分别留下 `1 failed / 180 skipped` 红证据；修复后相关 Package UI、currentness、Stage7 合同/runner、workspace/settings 组合测试均通过，最高一次为 `5 files / 259 tests`。
- 指定 6 文件最终基线：`6 files / 85 tests passed / skipped=0`；desktop `tsc --noEmit` 通过。
- 补充连接红绿：新增 3 条断言后 `3 failed / 8 passed`；修复后同一组 `11/11`，完整 login/SSO `76/76`，指定 6 文件提升为 `86/86`，skipped=0。首次登记未授权时启动按钮禁用；Ads 页面可见证据与 `adsSessionReady` 的 exact store identity 分离。
- 新版店铺筛选器：第一条真实 Chromium DOM 用例以 `FT-US-US` 为动态目标，并同时放入 `FT-US`、`JF-US` 和非店铺多选器；修复前 `1 failed / 13 skipped`，旧实现得到 0 个控件。新增 `.fs-wrap.multiple` 双版本适配后转绿。
- 生产空白差分：首次源码实机验证发现真实标签为 `JF-US  美国`，共享规范化不折叠内部双空格；第二条 `ALPHA-US  美国` 红测为 `1 failed / 15 skipped`，加入选择器专用连续空白折叠后转为 `1 passed / 15 skipped`。
- 最终连接/核心回归：8 个 login/SSO 文件 `79/79`，任务书 6 文件 `89/89`，skipped=0；desktop typecheck 与 renderer production build 均通过。
- 真实领星验证：当前源码函数在下载中心 `/ak_download/download_center/download_report_log/index` 得到 `selectedControls=1`，可见标签和 `.selected` 回读均为当前店铺 `JF-US 美国`；没有读取/打印凭证、Cookie 或内部 ID。
- 提交证据生命周期：新增 `keeps the store-scoped submit sequence above authority-keyed workspace remounts`，修复前 1 failed / 182 skipped，确认 keyed 子树外无持久状态；提升为父层按店铺 setter 后同命令 1 passed / 182 skipped，Package UI runner/currentness 完整回归 185/185。

## 历史业务与视觉验收（当前结果以顶部 2026-08-13 记录为准）

`pnpm run smoke:business-ui-current` 修复后再次 6/6 脚本通过，summary 的 7 条 flowCoverage 全部通过：连接、采集、策略、运营任务、经营实验、弹窗、按钮。

- Shell 证据：`output/codex-evidence/business-ui-shell-smoke-1786074295661.json`
- Current smoke：`output/codex-evidence/current-business-ui-smoke-1786074332703.json`
- 店铺筛选修复后 Current smoke：`output/codex-evidence/current-business-ui-smoke-1786086065135.json`
- 提交证据修复后 Current smoke：`output/codex-evidence/current-business-ui-smoke-1786087909779.json`
- 当时续接 Current smoke：`output/codex-evidence/current-business-ui-smoke-1786091380067.json`（6/6 子脚本，7 条 flowCoverage 全部通过；采集请求 `lx:recreate-full:msionxn4:2d76333b-528c-416a-88ca-d29e1ae7`）。
- 生产采集：`output/codex-evidence/business-ui-data-collection-production-1786074295037.json`
- 1366×768：策略弹窗位于 85–683px；运营任务/经营实验弹窗位于 24–744px，底部动作均在视口内。
- 按钮：弹窗动作计算样式为水平 flex 且 `align-items:center`。

## 历史 Windows 交付（已被顶部当前包哈希覆盖）

以下为 2026-08-10 店铺筛选与提交证据生命周期修复后的历史重建；不得用这些哈希覆盖顶部 2026-08-13 当前包：

- Installer：`apps/desktop/release/AmazonAIOpsAgent-1.5.0.exe`
  - 231,457,148 bytes
  - SHA-256 `7970DE8AB867F28BDE26F55873698B61A5849BC05869B13B5BACACFC2C0A3458`
- Portable：`apps/desktop/release/AmazonAIOpsAgent-1.5.0-portable.exe`
  - 231,325,181 bytes
  - SHA-256 `38D1565A0434894BCFF0C7BB9B45C98E267B093753A2E81186044D0723DACCE2`
- 文件夹 ZIP：`apps/desktop/release/AmazonAIOpsAgent-1.5.0.zip`
  - 311,631,302 bytes
  - SHA-256 `28B663E9C3F8A81B1BA65301073910DA2AB42E6C63089F198AFEF83AD788803E`
- win-unpacked EXE SHA-256 `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`。
- Main bundle SHA-256 `DAB0FC49A5BD762495B38A8429BD9C784983693D1C6E74E0E3FD182F5345F56F`，源码与包内完全一致。
- Renderer bundle SHA-256 `A854D737B4C3233694A2B1858D66D7505E68BC65CD6541CF7BB1ACCC222AF266`（`index-rTFjbpw_.js`），源码与包内完全一致且 `s is not defined=0`。
- 当时 `smoke:folder-zip-launch` 复核通过；解压 EXE 哈希与 win-unpacked 一致，真实窗口和 packaged file renderer 就绪，临时进程/文件已清理。证据：`output/codex-evidence/folder-zip-launch-smoke-1786335474811.json`。

## 历史正式库与写入安全（顶部已有当前只读终审）

- 正式库主文件打包前后均为 1,294,336 bytes，SHA-256 `E8E05025B44DA23442B06603C187C728749EB022804198F0A4455C37B803EAE9`。
- 构建器另证实源 SQLite/DuckDB 前后哈希一致、`sourceReadOnly=true`。
- 只读查询：`ad_execution_batches`、`ad_execution_jobs`、`ad_execution_events`、`ad_execution_evidence` 均为 0；已完成/已应用写入任务为 0。

## 历史 Package UI 失败与修复记录

Package UI 已修复仅由只读 WAL 锁定导致的 SHM `mtimeMs` 假漂移；主 DB 身份、主/SHM 内容哈希、大小、路径与 WAL-aware 逻辑备份仍严格比较。随后修正两个生产入口漏检：对象工作区当前标签为“产品与广告对象”，连接工作台实际位于“系统设置”。

历史失败清单：`output/codex-evidence/package-ui-evidence/run-groups/operator-core-20260807-08/manifests/2026-08-07T06-15-33-902Z-2026-08-07T06-15-33-902Z-57edc552-8010-4c5e-b612-168c28e08d4e.json`。其中“无法唯一定位店铺选择器 JF-US”已通过真实 DOM 红绿、真实领星源码主链和新包重建解决；exact alias、美国站和唯一回读门没有放宽。

同一轮旧 runner 记录 `operatorHandoff.finalPhase=preparation`、`attempts=[]`、`interactive-timeout`，与截图和隔离库 06:17:26 的状态写入矛盾。对应提交证据生命周期代码已完成红绿修复，且没有延长阈值、读取密码或跳过 fresh typed proof。

用户解除轮次上限后，`-09` 首次尝试仍因 300 秒内没有人工提交停在 preparation；其 resume inspection 又暴露两个工具合同问题：只读锁造成的 SHM 时间戳漂移仍被严格相等比较，以及同一 Windows 正式库路径分别按反斜杠/正斜杠得到不同绑定哈希。正式主库、逻辑备份、SHM 内容、文件 ID 和硬链接数均未变化；检查器文件不在本任务写入白名单，未绕过或越界修改。随后使用全新 `-10` 避开 resume，但同样在 300 秒内无人提交，隔离库 ERP/Ads 均保持 `not_configured`。

当前恢复条件：操作者明确回复“已在屏幕前”后，由执行者为干净终态谱系新建下一隔离 Profile、authority receipt 与 run group，并只打开目标 Amazon AI Ops 应用；操作者本人在当前 120 秒 preparation 边界内输入领星密码、保留“记住密码”并提交。未检测到冲突旧会话时不要求勾选重置；只有应用明确报告本店旧会话冲突时才由操作者授权重置。执行者不得读取或代填密码/Cookie，也不得操控桌面或其他应用。通过 100%-compact 后，同一 run group 才能继续 125%-compact/wide；必须得到 3 个不可变 checkpoint 与最终 `passed=true` manifest，在此之前不得把源码测试、业务 smoke、旧截图或 ZIP 启动冒充 Package UI 完成。
