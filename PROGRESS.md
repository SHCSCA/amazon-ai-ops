# V1.6 已证实进展

当前状态：APP_NEEDS_WORK / INTERNAL NON_READY。仅此文件记录已验证事实；未完成条件见 BLOCKED.md。

- 2026-09-10T04:30Z：人工执行批次exec-batch-7a4e66cdda2fc8dfa4f503f52f3c91f6c420614f于04:22:30Z成功，提交意图04:22:27.197Z先于保存，before/after/reload分别180/162/162美分；真实回读与重启历史一致（real-mainflow-save-hover-execution.json、real-mainflow-manual-experiment-started.json）。实验入口漏传kind=target已修复；基线误取单日源行已改为同批次同对象同匹配每日明细汇总，保留身份锚点、唯一日期和隔离行拒绝，相关两个仓储用例与类型检查/Main构建通过。实验EXPERIMENT-store-8cf446cb-6c63-4688-807c-8621248e6809-1789014396820-1已running，系统基线ACOS=0.4728705668384359、订单=1，观察[2026-09-10T07:00Z,2026-09-17T07:00Z)。最终安装版、便携版及ZIP已按实验修复统一，Main/Preload/Renderer内容逐一匹配目录包，SHA-256与源码清单见mainflow-current-archives-identity.json和mainflow-current-source-identity.json。实际目录包重启后实验仍为观察中；不冒充三个包型分别完成运行验收。

- 2026-09-10T04:14Z：第二批次 exec-batch-f991238e6e32238ebc0173243e9175a3c4184a76 已通过真实预检，随后因 SAVE_CONTROL_NOT_READY 在持久化提交意图前阻断。真实页面确认保存图标仅悬停竞价框才显示；独立刷新竞价仍为1.80，无实际提交。生产 prepareSave 已补原生 hover，保留唯一性、可见性和可用性检查；针对性用例、desktop类型检查及Main构建通过。目录包已更新并启动，三种归档包尚待本次修复更新。

- 2026-09-10T03:56Z：已实际签发人工Grant mission-grant:1e1d9b4bfcdd163363d5a7b641e68abf并创建单动作执行批次。工作台后台刷新曾清空浏览器核验状态，已在共用Bridge保留同上下文刷新状态；类型检查、Renderer构建及实际“检查浏览器→开始按钮可用”通过（real-mainflow-background-refresh-check.json）。首次点击开始后，批次exec-batch-9aa6ba44f7dcd47d4693fefc1abf3a7119c5c62b在preflight被KEYWORD_ROW_NOT_UNIQUE阻断，无意图、提交或回读证据（real-mainflow-v3-first-execution-projection.json）；稍后真实只读页唯一行存在，确认异步加载问题。页面适配器已补有界等待、保留唯一性校验；对应新用例通过，另修正此前状态门导致的两条过期测试预期并仅重跑这两条通过，desktop类型检查和Main构建通过。更新目录包已启动，需恢复会话继续新授权批次；三种归档包暂未包含这次行等待和后台刷新修复。

- 2026-09-10T03:44Z：用户明确指示“你自己处理”，已通过产品批准V3 Decision analysis-decision:c27d8ae47006955936970f2b6c9b75e2，原因明确标注Codex代操作。正式库approved/revision2，Grant/执行任务0（real-mainflow-v3-approval-before-expiry-fix.json）。签发Grant实际失败原因为有效期超出临时策略有效期；AnalysisAuthorityService统一将Grant到期时间取证据、建议、策略三者最早值，两模式针对用例通过、desktop类型检查及Main构建通过。当前目录包已更新并启动，正在恢复会话及更新三种归档包；旧包身份不能当作修复后的包体验证据。

- 2026-09-10T03:39Z：V3建议16已完成真实Ads对象绑定；绑定后生产分析回读 human.eligible=true、blockers=[]，USD1.80→1.62，真实AI已参与（real-mainflow-v3-postbinding-analysis.json）。实际刷新并进入待审批显示唯一当前候选、对象版本已校验、批准按钮可用（real-mainflow-v3-current-review.txt）。新分析来源为rule、AI解释成功但未形成规则+AI一致，置信度82%；不冒充原V2的89%一致性结果。尚未代替用户批准新Decision，Grant/Ads执行仍未发生。

- 2026-09-10T03:35Z：用户明确要求改为当前执行时段，已通过实际产品启用 V3，窗口为洛杉矶20:31–21:31（北京时间今天11:31–12:31），V2自动停用；单对象、10%、USD0.18、每日1次、1440分钟冷却不变。正式库回读见 real-mainflow-immediate-window-enabled.json。V3任务已创建并启动；初次分析遭遇 Ads 匹配方式列识别失败，一次生产入口重试真实AI成功，得到建议16、USD1.80→1.62（real-mainflow-v3-analysis-diagnostic.json），正在核验对象并重建当前授权。原V2人工批准保留，但不冒充V3授权；无需等待明天，七天真实观察尚未开始。

已安排当前任务每天北京时间15:30自动跟进（automation），相同批次不重复收费分析；只在可行动变化时通知。人工已执行对象不得再次调整来冒充策略模式。

当前阶段（2026-09-10T04:30Z）：人工模式已完成真实八报表→Mission→真实AI→具体批准→Grant→单次降价→三段回读。cupping massager实际1.80→1.62，实验已进入running，观察洛杉矶9月10日至16日。策略自动第二个独立候选/执行及两条观察结论、记忆仍未完成，完整APP_READY仍未通过。

- 2026-09-10T03:18:50.925Z 用户已在产品内批准V2当前完整候选，原因“同意执行操作测试”。Decision analysis-decision:70288e2b222d7f60f97a4269120a049d 为approved/revision2，对应建议15、关键词233831751475726、USD1.80→1.62；页面与正式库一致（real-mainflow-v2-human-approved-window-pending.json）。当前洛杉矶2026-09-09 20:19，策略仅周一至周五09:00–17:00；未改变窗口，Grant/Ads任务仍0。下个窗口为北京时间2026-09-11 00:00–08:00，届时仍须核对当前会话、竞价、投放状态及候选版本。原候选的具体人工批准已完成，不应再次泛泛请求同意；未设置后台唤醒任务。

- 2026-09-10最新可恢复节点：V2人工Mission MISSION-store-8cf446cb-6c63-4688-807c-8621248e6809-1789008157817-1 已形成当前可人工审批建议15；关键词233831751475726，U07-1P-精准/精准，USD1.80→1.62，10%，真实AI解释已保存。初始revision=0被界面误拒，已与Main的非负整数合同对齐；实际从0绑定到1成功。同一Mission使用稳定生成范围，绑定后重分析保留建议15及绑定，未另建副本。绑定后首次分析失败，保留失败记录；一次生产IPC重试成功（real-mainflow-v2-refresh-diagnostic.json），刷新后的产品待审批页显示1条、对象版本已校验、批准按钮可用（real-mainflow-v2-ready-for-human-review.txt、real-mainflow-v2-human-review-ready.json）。当前Main18992/session332，Grant/Ads任务仍0，未点击批准、未改价。候选有效至2026-09-11T03:05:29.031Z，人工eligible=true；策略模式未启用，不复用此候选作为第二条流程。
- 最新源码已构建为安装版、便携版、ZIP，内容与实际目录包Main/Preload/Renderer匹配（mainflow-package-build-mission-history.log、mainflow-current-mission-archives.log、mainflow-current-archives-identity.json）。直接检查为仓储6/6、分析复用1项及desktop类型检查通过。截图捕获超时未计为通过；已有真实页面文本、生产投影与正式库回读，不据此宣称完整包体验或APP_READY。

- 2026-09-10 继续推进：经产品创建并启动“单店真实主流程｜人工审批｜V2｜2026-09-10”，绑定同一真实批次、产品B0GVRVD4PK和已启用V2（real-mainflow-v2-mission-created.txt）。定位重新分析仍返回旧已绑定建议的问题：Mission新生成现在按本轮taskId去重，保存自己的输出，不覆盖旧建议；返回ID去重，避免同一记录计为两条。对应仓储6/6直接回归、desktop类型检查与Main构建通过（mainflow-generation-history-focused.json、mainflow-generation-history-typecheck.log）。目录包Main已更新，正在真实重跑；归档包仍是前一状态门版本，不能视为包含本次修复。

- 2026-09-10 状态检查已进入新安装版、便携版及ZIP，现有七步打包脚本完成（mainflow-package-build-serving-state.log），三包Main/Preload/Renderer入口内容与目录包一致（mainflow-current-archives-identity.json；上版身份已保留为mainflow-before-serving-state-archives-identity.json）。新目录包Main7448实际启动正式库，页面回显8/8报表、1309行；回读schema_migrations为20、V2 enabled/V1 retired、Grant和Ads执行任务均0（real-mainflow-serving-state-package-restart.json、startup.txt/png）。重启后浏览器会话待确认；三种归档包分别启动、双模式执行及七日实验仍未验收。

- 2026-09-10 用户同意启用具体V2草稿，并要求核对广告活动是否已关闭。实际Ads页面确认U07-1P-精准（237420834150892）为enabled/投放中，广告组精准（249755766852252）及关键词cupping massager（233831751475726）同为enabled/投放中，竞价仍USD1.80。证据real-mainflow-current-campaign-status.json、real-mainflow-live-serving-status.json。之后经产品启用V2，V1自动停用，正式库回读与页面一致（real-mainflow-policy-v2-activation.json、real-mainflow-policy-v2-enabled.txt）；模式仍manual_approval，Grant/Ads任务0。
- 共用关键词页面适配器新增活动/广告组/关键词启用状态检查，在分析对象识别、整批预检、填写前及保存前执行；关闭、暂停或状态无法确认均拒绝改价。只读readSnapshot仍允许UNKNOWN对账。并适配实际观察到的关键词详情路径及DataTables冻结列镜像行，真实唯一主行不再被镜像重复阻断。直接回归同时覆盖三层关闭、写前拒绝及只读回读，类型检查通过；同一源适配器在真实页面assertServing通过（mainflow-serving-state-focused.json、mainflow-serving-state-typecheck.log、real-mainflow-serving-guard-check.json）。正在更新包，旧包身份不包含本次状态门。

- 当前目录内容已归档为安装版/便携版/ZIP；electron-builder首次误跳过旧ZIP，已保留旧ZIP并单独生成新ZIP。三包Main、Preload、Renderer入口及引用JS/CSS内容哈希均匹配当前运行目录；包体SHA-256与核对明细见mainflow-current-archives-identity.json，源码快照见mainflow-current-source-identity.json。该证据只证明归档内容一致，不替代三种包各自启动或完整生产验收。

- 当前目录包Main27040已验证策略范围回显1个对象。填写USD0.18时发现策略金额输入step=1误拒小数，两个共用预算入口改为step=0.01，Renderer构建及实际原生校验通过；版本2草稿经生产入口保存、正式库及刷新回读一致，仅允许233831751475726、maxChangePct=10、totalImpactBudget=0.18、每日1次、冷却1440分钟、洛杉矶周一至周五09:00–17:00（real-mainflow-policy-draft-receipt.json、real-mainflow-policy-draft-after-refresh.txt）。草稿未启用，原零权限版本仍有效，Grant/Ads任务仍0；0.18是竞价差额上限，不是AI费用或广告日预算。

- 2026-09-10 当前只读绑定成功：关键词233831751475726，U07-1P-精准 / 精准，真实当前USD1.80、建议USD1.62、降幅10%。analysis-run:bc9b6cccdcef9d45178aae70836240ea完成且aiSummary.invoked=true/source=ai；绑定后通过原Mission流程重新分析，证据为real-mainflow-live-bid-binding-receipt.json。当前人工授权阻断为POLICY_ENTITY_NOT_ALLOWED；尚未生成Grant或Ads执行任务。
- 已修复两个当前页面问题：AI动作解释输入补充真实当前竞价并区分历史CPC；DecisionsWorkspace用useMemo固定接口引用，停止历史加载effect随每次渲染重启。desktop类型检查、Renderer构建通过（mainflow-live-bid-final-typecheck.log、mainflow-decision-api-renderer-build.log）。已封存旧建议中的“约38%”解释不会被改写，不能把旧解释当作本次修复后的AI证据。
- 策略对象投影将同一关键词跨日记录要求为总共一行，导致已核验身份仍显示0个对象。现改为每个日期唯一一行，保留同日重复记录阻断；一个直接回归覆盖单日、多日及同日重复，实际通过（mainflow-policy-daily-grain-focused.json）。Main构建通过，目录包已更新，待实际页面回读；安装/便携/ZIP还未与这次更新一致。

- 已确认竞价不一致的源码原因：RecommendationGenerator把历史CPC作为currentValue，量化规则也以CPC计算目标。Main分析入口现先读取当前Ads唯一关键词竞价、截图并再次核对身份/价格，再按现有规则计算、交AI分析；AI目标金额不做裁剪。生成结果记录真实竞价来源，未绑定未批准的旧CPC建议可以按原版本事务刷新，旧分析快照保留。两个窄回归真实通过，desktop类型检查修正共享证据类型后通过（mainflow-live-bid-focused.json、mainflow-live-bid-typecheck-r2.log）。当前更新包正在构建，尚待真实链路验证。

- 重连后的真实Ads只读核验找到cupping massager，但页面当前竞价USD1.80与建议依据USD2.60不一致，生产服务拒绝绑定/执行（real-mainflow-budget-fixed-main-stderr.log，诊断截图error_1789002977907.png）。没有改价；下一步核对建议竞价来源及真实当前值，不直接将不一致建议交人工批准。

- 当前店铺重连首次被旧会话凭证状态阻断，使用产品既有“重置当前店铺会话（保留本机密码）”后正常连接，界面确认ERP/Ads当前会话均已验证（real-mainflow-ads-reconnect-current-ui.txt）。已继续从当前候选发起只读Ads对象核验，未批准或提交竞价。

- 2026-09-10：预算整数输入修复后的七步打包通过（mainflow-package-build-budget-input-r2.log），安装/便携/ZIP及源码身份见mainflow-package-identity-budget-input.json、mainflow-candidate-source-identity-budget-input.json。实际包Main13524预算表单原生校验通过，USD3已保存并回读，有效UTC 2026-09-10 01:09至2026-10-10 01:09（real-mainflow-budget-activation.json）。
- 已在实际产品创建并启动人工Mission，绑定batch_20260910004706552_bmcey3及B0GVRVD4PK；analysis-run:3d0aba39fe7ba9f84972f412dd61455d completed，aiSummary.invoked=true、source=ai，4次服务请求估算USD0.046693。分析统计2条候选实际复用同一个recommendation，不算两个独立对象；可见cupping massager为USD2.60→2.34，当前缺可核验Ads身份，尚无Grant/执行任务。页面重载后新决策仍可读（real-mainflow-manual-analysis-completed.json、real-mainflow-manual-decision-after-refresh-ui.txt/png）。已发起当前店铺重新连接，随后核验真实对象；Mission日期仅为计划，实验实际窗口须执行后创建。

- 2026-09-10 用户明确批准两条主流程及观察分析共用 USD 3、启用后30天、到额停止且不自动续期。实际预算表单提交被原生校验阻止：整数token字段使用min=0.000001、step=1，整数值因此stepMismatch（real-mainflow-budget-form-validation.json）。已将整数最小值修正为1，金额仍保留六位小数；正在更新包并验证保存，尚未发出付费AI请求。

2026-09-08 本轮范围已收窄为现有单店、人工/策略两条独立真实主流程，真实 AI 成功，执行后各七个完整美国业务日观察并形成系统结论/记忆。双店、全量需求映射、优化和整套验收平台不阻断本轮；最终只声明本轮主流程状态，不替代完整 V1.6 APP_READY。

- 2026-09-10：PolicyWorkspace 用已有 useMemo 固定接口对象，desktop 类型检查与 Renderer 构建通过。实际目录包 Main19232 的策略页正常显示已启用版本，随后 AI 与本地页面及预算表单可交互（real-mainflow-policy-fixed-settled-ui.txt、real-mainflow-policy-fixed-ai-ui.txt/png）。未新增测试基础设施；安装/便携/ZIP尚待本次Renderer修复统一打包。当前策略版本0个可核验自动对象、自动批次预算0，真实候选形成后仍需按产品策略边界核对，不能视为已具备自动执行许可。
- 同次启动中现有定时计划自然认领2026-09-09美国业务日任务，开始采集2026-08-26至2026-09-08窗口，batch_20260910004706552_bmcey3。当前为running，待真实完成；未重复点击或手动追加采集。此前八报表完成记录保留，AI预算未启用、Grant/Ads执行任务仍0。
- 上述新任务已真实完成：8类downloaded、import succeeded，生产导入8文件/1309行/8对账，正式累计8次导入/14006指标行（real-mainflow-scheduled-20260910-current.json、real-mainflow-scheduled-20260910-import.json）。定时任务页面明确显示本业务日采集与导入已完成，未再出现旧收尾阻断；保存新范围后Mission可选择新批次。WAL-safe备份为mainflow-collected-20260910，integrity ok、外键0。实际应用正常关闭，Playwright launcher退出0且无残留应用进程；开始统一生成含策略页修复的安装/便携/ZIP。
- 最终本轮候选七步打包通过（mainflow-package-build-policy-api.log），安装/便携/ZIP的SHA-256见mainflow-package-identity-policy-api.json；982个源码/合同文件的快照摘要见mainflow-candidate-source-identity.json，原脏工作区保留。该统一包实际Main25592再次打开正式库，策略入口及AI预算表单正常，预算仍未启用、无已记录付费调用（real-mainflow-final-candidate-runtime.json、real-mainflow-final-candidate-budget-ui.txt/png）。当前应用保留在费用表单，等待用户确认费用上限；这不是单店双模式主流程通过或APP_READY。

- 当前 Windows 包实际连接 JF-US 的 ERP/Ads，并从产品“立即采集”下载 2026-08-25 至 2026-09-07 八类报表；batch_20260908101132005_ied3ne 的八个下载检查点及生产导入均 completed，8 文件、1338 指标行、8 份对账，正式库累计 7 个导入、12697 指标行（real-mainflow-collection-current.json、real-mainflow-import-completed.json）。刷新首页显示新批次 8/8；采集收尾另报 SAFETY_STATE_UNKNOWN，不能据此将整个自动化运行记为通过。
- Mission 新批次下拉已通过现有“采集范围”页面保存新日期和批次后正常显示。根因为旧持久化日期精确筛选，并非未入库或缺少批次登记；未重采、重导或修改业务代码。尚未创建新 Mission 或调用付费 AI。
- 采集收尾根因已定位并修复：collector 成功回执保留 `errorCode: undefined`，持久化回读省略该字段，深比较误判两个回执不一致。adapter 现按既有 JSON 持久化形状比较，真实有值差异仍拒绝；同时修复异常 cause 自引用并保留关闭错误。两个直接窄用例分别通过，desktop 类型检查通过（mainflow-scheduler-undefined-focused-final.json、mainflow-orchestrator-cause-focused-final.json、mainflow-collection-receipt-typecheck.log）。尚待新包恢复验证。
- 旧包进入系统设置后 Renderer 无响应并退出，Main 无响应；现场不足以确认独立 Renderer 根因，未作猜测修改。正式库已 WAL-safe 导出 mainflow-collected-20260908，一致性 ok、外键0；正式 Grant/Ads执行任务均0，新采集任务 completed。正常 CloseMainWindow 未完成，已明确记录 Main49740 强制终止、实际退出码 -1、不计正常关闭（real-mainflow-forced-restart.json）。保留持久化未终结 transition，下一包沿现有启动恢复按原 request 查完成记录；不清锁、不重采、不伪造终态。
- 修复包七步构建通过，安装/便携/ZIP身份见 mainflow-package-identity-collection-receipt.json。实际 Main41280 启动后按原 request 恢复采集：原 transition 为 completed、outcome=succeeded、schedulerSucceeded=true、cleanupStatus=confirmed（real-mainflow-recovered-transition.json）；首页仍为8/8、1338行，没有重新下载或入库。
- 设置页面卡住在修复包复现。实际 Main CPU 采样定位反复 listPolicyVersions（real-mainflow-settings-main-profile-nodes.json），根因为 PolicyWorkspace 每次渲染新建 api 对象，版本加载 effect 随之重复执行；正在修复该对象引用，未修改 AI 费用规则或时区校验。

- 恢复补丁针对检查2/2、类型检查与七步打包通过；更新包哈希见mainflow-package-identity-recovery.json。原HOLD单文件权限已通过现有工具收紧，内容及file identity不变（hold-file-protection.json），操作器已补一致前置检查并单例通过。正式FINALIZED明确为RECOVERED_AFTER_FAILED_MIGRATION_PROCESS、closed:null，不伪造正常关闭；恢复包为D:/AmazonAIOpsRecovery/mainflow-finalization-20260908/recovery.json。当前包实际Main PID49740使用正式userData并打开JF-US今日总览（real-mainflow-runtime.json、real-mainflow-initial-ui.txt/png）；旧包保存在failed-formal-r3-package且三哈希与原失败链一致。历史当日数据未计今日准备度，页面要求新采集截止2026-09-07的窗口、确认ERP/Ads会话。

- 正式升级后只读验收通过48/48（mainflow-formal-upgrade/acceptance-closed.json）：完整迁移账本1–20、integrity ok、外键0、原业务行保留；SQLite正常checkpoint并收为DELETE模式后无sidecar，行数不变（post-hold-checkpoint.json）。更新后WAL-safe备份为output/codex-evidence/authority-snapshots/mainflow-post-hold-r3-closed-20260908/。这不补造CLOSED，也不代表正式窗口启动成功。相同升级数据与Local State在隔离目录、相同最小环境中实际ready并正常退出0（post-upgrade-runtime-diagnostic.json）。实际验收器读取离线WAL文件时自己生成空sidecar的问题已改为只读内存检查，磁盘文件不改；一条对应回归同时覆盖读值、拒写、无sidecar和拒绝待处理WAL（mainflow-offline-wal-read.json）。

- 当前包七步重建通过（mainflow-package-build-shell-fix.log），隔离升级副本两次原生启动/关闭通过（mainflow-upgrade-package-smoke-r6/receipt.json），哈希见 mainflow-package-identity-shell-fix.json。正式第三次启动已完成 HANDOFF/ADMISSION 并写入升级；主窗口创建但隐藏，原生显示后为空白页，正常 CloseMainWindow 返回 true，helper 报 child-exit-failed-before-closed-receipt，故保留 HOLD，不计正式启动或迁移通过（D:/AmazonAIOpsRecovery/mainflow-launch-r3-20260908/launch.json）。关闭后完整 DB/WAL/Local State 已逐文件校验保存至受保护的 mainflow-20260908/post-hold-r3，另用现有 sqlite-online-backup 导出 mainflow-post-hold-r3-20260908 一致快照；没有回滚或删除当前 gate/intent。下列“正式库未升级”均为当时阶段记录，不再代表当前状态。

- 单店主流程模板已落地：正式库的 48 份原始文件全部存在且 SHA-256 与入库快照一致，登记为八个明确表头版本；真实文件只读回放 48/48，11,365 原始行扣除六个已有规则识别的暂停占位行后为 11,359 指标行，与正式库指标总数一致（mainflow-template-inventory.json、real-template-replay.json）。未重新导入或修改历史记录。
- 修复真实文件暴露的两项兼容问题：搜索词的“关键词”与“投放”分开保留，避免重复列误拒及覆盖；“有花费无销售额”只在实际花费>0、销售额=0时作为合法 ACOS 非数值标记，主指标仍按原公式计算。正式 Main 导入强制模板匹配并返回中文模板错误。三个直接受影响文件 35 通过、1 项测试断言语法错误；只修该断言并重跑该项通过（mainflow-template-check.json、mainflow-template-case-final.json）。两种模式的八文件隔离业务流程在首次运行均通过；最后 desktop 类型检查通过 mainflow-template-typecheck.log。
- 正式 schema 11 已用现有只读 sqlite-online-backup 导出一致快照（output/codex-evidence/authority-snapshots/mainflow-schema11-20260908/），integrity_check 为 ok、foreign_key_check 为空。原备份保留；另制隔离输入副本，经现有工具升级到20、恢复到独立路径并通过原业务记录保留核对（mainflow-isolated-upgrade/s7-offline-upgrade-v11-to-v20.json）。正式库尚未升级。
- 现有正式升级操作器/启动门支持完整校验的 schema 11，FINALIZED 记录复用 Main 相同合同；窄包启动收据只用于本轮升级，不替代完整 UI 验收。针对性记录为 mainflow-migration-v11-focused.json、mainflow-migration-finalization-focused.json、mainflow-upgrade-smoke-contract.json、mainflow-upgrade-smoke-source-chain.json。desktop 类型检查通过 mainflow-migration-typecheck.log；Windows 七步构建通过 mainflow-package-build.log，安装/便携/ZIP 已统一生成，实际启动正在验证。
- 升级副本实包启动未通过：初次脚本 SHA 大小写断言已修正，后续实际启动暴露采集编排历史 CORRUPT_PERSISTENCE，导致关闭时 SAFETY_STATE_UNKNOWN；完整原生启动日志为 mainflow-native-startup-stdout.log / mainflow-native-startup-stderr.log。这些失败不计启动通过，正式库未写入。
- 上述隔离启动问题已定位为准备副本时遗漏 Windows safeStorage 依赖的 Local State；同一历史密文用原配置可解密，用新 profile 配置返回 InvalidTag。新隔离副本同时复制原 Local State 后，同一个包恢复已有店铺、完成初始化并安全退出（exitCode=0，mainflow-native-startup-r2-stdout.log）。未修改生产安全门、历史或包体。
- 当前候选目录包在升级副本实际两次启动、退出通过（mainflow-upgrade-package-smoke-r5/receipt.json）。正式库已由 SQLite 安全 checkpoint 并切为离线 DELETE journal，行数/完整性/外键核对保持；正式路径绑定的升级副本与恢复核验 19/19（mainflow-formal-upgrade/verification.json）。正式 schema 仍为11，尚未执行受控升级；原始及整理后的在线备份均保留，Local State 已另存于受保护恢复目录。
- 正式受控尝试在原生 helper 的 validate-startup-gate-plan 阶段 HOLD（D:/AmazonAIOpsRecovery/mainflow-launch-20260908/launch.json），包未启动。失败后已核对正式 DB 全文件哈希仍与批准时一致、无 sidecar（mainflow-formal-upgrade/hold-database-verification.json）；helper PID48032及所有同名包进程均已不存在。未删除或重用旧 intent，正在定位具体失败。
- 上述 fileId 精度问题已在 operator 的统一文件读取入口改为 BigInt，并以字符串保存精确身份；大 fileId 与相邻编号替换拒绝的单个回归通过（mainflow-large-file-id.json），原生只读合同复放通过（mainflow-startup-plan-readonly-fixed-result.json）。随后新启动已越过身份比对，但 Main 的 PowerShell 探针使用本地化 FileVersion 与非 UTF-8 输出，和 operator 固定版本/UTF-8 合同不一致，握手前退出；第二个 HOLD、ACTIVE/BOUND 均保留，DB 哈希仍未变（hold-r2-database-verification.json）。Main 两处读取方式现已统一，单个针对性回归通过（mainflow-main-shell-contract-focused.json），正在据此重建。旧安装/便携/ZIP已备份并逐项核对哈希（pre-shell-fix-package/SHA256.json）。

- 权威源码 D:/Desktop/py/amazon-ai-ops，master，基线 HEAD 51821bbdcc4b59fb14eb78f6b5dcfb170e7b330d。原 113 个未提交/新增文件及二进制 Git diff 已备份，已有工作未回退。
- 唯一证据根目录：output/v16-evidence/implementation-2026-09-07T07-15-05-786Z/。baseline.json 的正式库文件哈希仅标识身份，不是 WAL-safe 备份。
- 已提取 PRD 全部 172 个 MUST，保留原文及 AC，当前未闭合条目均为 UNVERIFIED。迁移、验收追踪、发布实测三份配套规格已写入 docs，规格本身不计验收通过。
- 已将 39 个 MUST 关联到具体实现、AC 和真实 runner 案例；所有条目仍为 UNVERIFIED，映射不代表完整验收。验收追踪规格补入版本化 UI 术语表、Accessibility Delta Register 和 Baseline/Budget 记录合同；无障碍各项仍为 PENDING，不声明标准合规。
- Package UI 已替换旧侧栏选择器，按六模块的真实按钮进入全部 22 个入口；原始标题/模块/入口/键盘指标必须重新校验，不能只相信 passed。初次六模块改动回归 210/210（package-ui-v9-first.json）。加入原生 minimum/完整导出后，跨脚本回归先为 421/449，再为 443/449，均非通过。剩余失败涉及旧尺寸的容差测试、夹具遗漏 minimum 截图、JSON 重读后夹具截图引用未重新绑定；现只回归受影响三个文件，不扩大重跑已通过的三个文件。
- 已恢复完整执行工作台、StoreCoordinator 完整上下文与启动/切店路径；P0 回归 62/62（p0-after.json）。
- V1.6 原 37 个版本化 IPC/Preload 方法委托实际 MissionDomainService、AnalysisAuthorityService、ExecutionAuthorityService；schema 20 加入 AI 预算读写后共 39 个。上下文和异步失效的初始合同 37/37（facade-source-only.json）；新增费用接口证据见下文。
- 移除未接入生产的六个平行草稿服务及草稿分析编排；原文件保留在 Git/基线备份，替代集成测试调用现有生产服务。
- Analysis Run 由 AnalysisAuthorityService 唯一写入 analysis_runs，保留输入指纹、新回执、合法结果复用及中断投影。修复历史状态筛选先截断、IPC 错误原文泄漏和无效实现链接被验收器接受；相关回归 75/75（analysis-history-boundary-green.json）。其后的历史敏感字段投影与调度等待回归已通过 foundation-failures-after.json（157/157）。
- 修复整数美分合法降价被舍入误拒，并使旧计算版本缓存失效。生产事务的人工/策略模式、UNKNOWN 和完整批次等集成 10/10；与验收器合同合计 25/25（consolidated-contracts.json）。使用隔离 SQLite 和外部测试替身，不是 L6/L7 真实店铺证据。
- 模式/策略运行时变更在同一事务中撤销未结束 Grant；分析完成前再次检查策略运行时及策略 revision，阻断模式 A→B→A 复用。针对性回归 118/118（mode-replay-green.json）。
- 此前升级目标与恢复脚本统一为 schema 15；未来 schema 在业务 DDL 前拒绝。修复 Windows 原生启动链比较本地化 FileVersion 文本的问题，改用固定版本号，保留原有文件身份、哈希和签名校验。原生启动/隔离升级及恢复测试 50/50（native-migration-green.json）。
- 交付验收测试复用严格的 schema-v8 authority、调用、Profile、attempt、checkpoint 绑定夹具，未放宽实际校验器。夹具输出的 APP_READY 仅为单元测试预期值。
- 当前 foundation-static 的完整 workspace 类型检查、Renderer 构建、Main/Preload 构建及打包脚本合同 4/4 通过。foundation-current 实际执行 377 文件、5260 测试，通过 5258、失败 2、跳过 0；两项失败修复后的完整受影响文件 157/157，通过范围不等于当前全量 L1。
- 正式库只读核验仍为 schema 1–11 applied，mission_grants、mission_grant_events 和执行领域对账记录均为 0（formal-schema-readonly.json）。本次未升级或写入正式库，未执行真实 Ads。

- UNKNOWN 对账接入原 ExecutionAuthorityService/Repository，schema 16 持久化每个 submit intent 唯一 case、固定首次/刷新后两个位置及不可改写终态。重复观察问题有 red 证据；四种观察结果、急停/失效 Grant 下只读、断线和进程恢复、执行历史不变、升级恢复回归 120/120（unknown-canonical-green.json）。实机 UNKNOWN 仍待 L7。
- 生产依赖升级为 Electron 44.2.0、better-sqlite3 13.0.3、SheetJS 官方 0.20.3，并修补 tar/brace-expansion/ip-address。当前 pnpm audit --prod 为 0 告警（dependency-audit-after.json）；原生及报表读取回归 92/92（dependency-xlsx-native-green.json）。
- 修复 Windows 原生校验 CLI 原来未进入主函数及 ESM require 缺失；真实 Node 和 Electron 44 原生探针分别证明 SQLite/DuckDB 加载成功、ABI 137/149、源二进制未改写（native-node-v13-current.json / native-electron-v44.json）。
- schema 16 的临时候选完成 build:win 七步骤（package-v44-second.log），目录版与便携版实际启动/清理通过（output/codex-evidence/package-launch-smoke-1788830267982.json）。隔离配置经真实 UI 创建店铺、显式切换、重启回显，并打开六模块/22 入口，页面异常为 0（package-v44-empty-navigation.json）；不计完整 L4 或真实第二店。该包早于下面的 schema 17 源码，后续需重建。
- schema 17 在 canonical batch、Decision、Grant 中固化完整上下文、模式修订及单一 issuer；旧记录不补当前授权。人工模式必须逐条记录原因后整批签发，策略模式独立形成判断；直接 Repository 拆批与模式 A→B→A 复用被阻断。相关分析/执行 111 项通过（authority-v17-domain.json 中前三文件）；人工原因与撤销 IPC 18/18（authority-v17-reason-green.json）。其余领域/迁移/UI检查见 authority-v17-final.json，初次 167 通过、2 个原因处理失败已由前述 18 项回归修复。desktop 类型检查通过 authority-v17-typecheck-fixed.log；尚非全量 L1/L2。
- 实包诊断发现的实验页嵌套 main 已改为具名 section；撤销人工授权复用原因对话框，原因经 IPC 持久化，不再填固定内部文案。

- schema 18 已接入 reserved/spent/invalidated 追加账本，剩余额度由 Main 派生；提交状态在点击返回后、截图前持久化，UNKNOWN 永久占用额度，明确零点击不消费。每日次数/冷却改为按实际提交记录检查，并在意图事务中重验。修复后执行/业务/UI 82/82（grant-v18-submit-green.json），其他受影响域/迁移/适配器结果见 grant-v18-domain.json 与 grant-v18-submit.json（初次失败已定位并在上述 82 项修复）；desktop 类型检查通过 grant-v18-typecheck-fixed.log。该阶段的旧 schema 16 包已被后续 schema 20 候选替代，真实执行验收仍未完成。

- schema 19 从已校验的升级前一致快照逐条分类历史，保存原记录哈希、原因、source schema 与 classifier revision；旧因果记录保留可读但不进入当前可信分析记忆。损坏/不连续迁移账本在任何业务 DDL 前拒绝。数据库/历史分类 25/25（compat-v19-preflight.json），离线备份升级恢复 19/19（compat-v19-offline-final.json）；独占迁移及 authority selection 的生产脚本合同已在 compat-v19-contract-green.json 对应两文件通过。正式库未改动。
- AI provider 未返回完整一致 usage 时保持未知；不再默认计零，适配器 10/10（ai-usage-unknown.json）。独立费用账本与预算治理的后续实现见 schema 20 记录。
- 验收器拒绝仅凭自报 checks.passed 获得 L4–L7 信用；AC 必须关联实际 runner 已执行通过的具体 case。原生证据缺失反向测试 26/26（native-evidence-fail-closed.json），AC 映射验证 24/24（acceptance-case-mapping.json）；需求闭合仍未通过。
- UNKNOWN 后禁止恢复旧 Mission 或从旧任务新建分析/判断/授权；校验位于生产事务入口，归档恢复及只读对账不解除限制。先复现旧任务可激活，再修复；执行/分析/IPC 122/122（unknown-mission-green.json），不等于真实店铺验收。
- schema 20 增加独立 store-scoped AI 预算与费用账本，全部 Main AI 付费调用经过同一边界；自动请求先按复核模型上限预留，未知费用阻断后续自动付费，旧请求费用仍结算到原上下文。Main 服务/IPC 可保存和重读预算，设置页展示调用、估算/未知费用与配置。费用/并发/断线/崩溃/版本/跨店/秘密反向验证及受影响 UI、数据库合同 51/51（ai-spend-roundtrip.json）；desktop 类型检查通过 ai-spend-typecheck-green.log。报价与预算尚未经真实测量批准，没有真实付费调用。schema 20 迁移链首次 116 通过、1 个旧备份文件名断言失败；该断言更新后由上述数据库文件回归通过，尚非全量 L1/L2。

历史状态文档已保全至上述证据目录 before-status-consolidation 文件，不再保留为相互矛盾的当前完成声明。

- Package UI v9 最后 6 个失败已修复；受影响三个完整文件实际执行 300/300、零跳过（package-ui-v9-affected-green.json）。先前其余三个文件共 149 项通过位于 package-ui-v9-final.json；不将两个运行拼成单次全量报告。完整 workspace 类型检查通过 pre-package-schema20-typecheck.log。旧 schema 16 安装/便携/ZIP 已复制保全并逐项对照 SHA-256（retired-schema16-package/SHA256.json），随后已生成 schema 20 候选。
- 首次 schema 20 Windows 七步构建通过（package-schema20-current.json / .log），freshCurrentRun=true。标准/宽屏/原生最小窗口完成 66 次入口诊断，页面异常为 0；实际原生最小外框 1200×700、内容区 1184×638。诊断发现四个对象/事件入口缺失主动作标记与 ARIA 标题引用、最小窗口交付动作在首屏之外；另有诊断器多元素定位错误，不能把 66 次计为通过。当前 125% 原生截图完成 22 入口诊断，保留同类缺陷；初次 CDP 截图超时亦保留原始失败。
- 原生弹窗键盘检查证明产品、运营事件和 Listing 编辑器 Tab 会逸出、Escape 不关闭（schema20-controls-1788845160266/controls.json）。已在对象与 Listing 的编辑/确认/历史弹窗复用现有焦点管理，补齐背景禁用、Tab 循环、Escape 与焦点回归；保存错误放回弹窗内。主动作、标题引用、最小窗口顶栏挤压与交付动作位置也已修复，实包复查尚未完成。
- 原生 UI 修复涉及四个完整单元文件通过 69/69、零跳过（native-ui-fixes-unit.json）；完整 workspace 类型检查通过 native-ui-fixes-typecheck.log，随后弹窗错误位置调整的 desktop 类型检查通过 native-ui-final-typecheck.log。125% 一像素取整的窗口 setter 与既有两像素验证规则统一，3 个筛选案例通过（native-dpi-setter-check.log，其他 217 个案例未执行，不计全文件通过）。首次 schema 20 EXE/ZIP 已保全；随后七步重建通过 package-schema20-ui-fixed.json。
- README 的旧 1.5.1、旧通过数字、旧哈希和旧验证禁令已移出当前说明；原文保存为 README-before-v16-status.md。README 现在引用唯一 PROGRESS/BLOCKED、V1.6 PRD 及三份配套规格，不声明已完成生产交付。

- 真实执行证据合同更新为 mission-control-execution-canary-evidence/v2 与 authority/v2，导出与校验共同检查完整上下文、单一 issuer、固定 action batch、连续 Mission/Decision 历史和 reserved/spent/submit-intent 链。TTL 在提交时验证，提交后截图耗时不反向抹去已发生事实；旧 v1 缺快照证据不兼容。修复领域时间戳人为 +1ms 导致批准晚于紧接签发的 Grant：同毫秒顺序由 CAS revision 保证。生产服务及验证器受影响回归 187/187、0 跳过（canary-causal-time-green.json）。
- 当前 schema 20 隔离迁移与 delivery bundle 合同回归 40/40（canary-migration-bundle.json），实际仅执行其中列出的两个测试文件。实际旧 schema 16 EXE 对隔离 schema 20 DB 在业务仓储就绪前拒写，数据库字节不变（old-package-database-refusal-verification.json）；启动桥接超时原始证据仍为失败，不计 Package UI/正常启动/正式迁移通过。
- Main 八报表导入代码提取为 lingxing-report-import.ts，原调用链直接委托同一实现。真实 XLSX 解析、独立 control totals、SQLite 入库与幂等、Analysis/Decision/Grant、执行、实验基线、观察后新八报表、系统结论及可信记忆已在人工/策略两个隔离服务流程贯通；针对性 64/64、0 跳过（experiment-observation-roundtrip.json），desktop 类型检查通过 experiment-observation-typecheck-final.log。外部采集、AI 与 Ads 浏览器仍为明示的测试输入，不计 L6/L7。
- 实验基线固定到已验证 Decision 的原始分析对象快照，避免同对象历史修订误判歧义；观察结果使用该批次最新对象修订。已修复 SALES/ORDERS 别名漏采基线、含糊护栏文本误读、UTC 日界及未完成美国业务日提前判定；结果批次必须精确覆盖观察窗口业务日。最新完整八报表对账、禁止回退旧导入、早于干预的观察起点及夏令时边界均已纳入回归。
- 导入期间替换关键词但保持相同行数/花费的反向场景先复现了错误入库（import-file-change-red.json，仅执行一个 red case，其余按 runner 原始 case 状态是 skipped，不能采用顶层 numPassedTests）。解析前后和最终提交前现在重验 SHA-256；真实文件导入与实验仓储最终回归 72/72、0 跳过（import-and-experiment-green.json）。desktop 类型检查通过 import-final-typecheck.log。其余受影响服务回归在 eight-workbook-experiment-final.json 的五个文件通过；该记录中的一个测试自身误查未创建实验已在上述 72 项修复。
- L3 唯一清单中的八个必需文件已由实际 runner 完整执行，150/150、零跳过，源码身份在运行前后相同（l3-business-current/V16-T-L3-BUSINESS.json）。该证据只覆盖其固定源码快照；后续 AI/合同改动需更新受影响证据，不计真实采集或 Ads 写入。
- AI 成本与语义结果分开留证：消费者校验回调按费用记录 ID 追加至原 ai_call_logs，HTTP 成功但无效 JSON/字段/语言会显示规则或模板回退，费用仍保留；旧上下文响应记录 discarded，未校验响应保持 unvalidated。策略 JSON 修复的首次失败与修复响应分别审计，不能把首次失败改成成功；同结果幂等，不同结果拒绝改写。日报补齐结构化 JSON/字段/币种校验，Listing、建议解释、策略诊断与连接测试接入结果审计。相关六文件 60/60、零跳过（ai-semantic-outcome-green.json），desktop 类型检查通过 ai-semantic-typecheck-green.log。正式 provider 费用与人工价值评价仍未实测。

- 内部目录版的三个实际编辑弹窗通过初始焦点、正反向 Tab、Escape 和焦点回归；无效 ASIN 返回中文错误并保留草稿。实际新增产品后重载应用，成本 3.50 USD、售价 29.99 USD、目标 ACOS 30% 正确回显（schema20-controls-1788846192334/controls.json）。只写入明确隔离配置，不属于正式店铺或 Ads 证据。
- 同一内部目录候选的标准和宽屏分别 22/22 入口通过（schema20-ui-100-1788846228478/diagnostic.json）。该次最小窗口检查因窗口被最小化失败；Win32 IsIconic 实查为 true，窗口恢复器补齐 restore 后的稳定检查，4 个筛选案例从 3 通过/1 失败转为 4 通过（minimized-viewport-red/green.json，其余案例未执行）。最小窗口另次 22/22 通过（schema20-ui-100-1788846587954/diagnostic.json），125% 另次 22/22 通过（schema20-ui-125-1788846730214/diagnostic.json）；均无页面异常、包体内容前后不变，不合并冒充一个正式 L4 通过。
- 上述截图复查发现未确认会话使用成功色、长表单页脚超出弹窗；已收紧会话确认条件、分离弹窗滚动正文与固定页脚，并补齐 ObjectsWorkspace 的样式根节点。会话回归 21/21、Objects/Missions 回归 36/36；实际 125% 产品/事件/Listing 三类弹窗页脚、滚动、Escape 与焦点恢复通过（schema20-local-flows-125-1788847839737/local-flows.json）。
- 隔离目录实包创建事件后刷新可见；Listing 实际保存首版、再次修改保存、刷新并逐一读取两个不可变历史版本通过（schema20-local-flows-100-1788847468610/local-flows.json 的事件结果、schema20-listing-readback-1788847813139/readback.json）。首次 Listing 自动化回读失败原因为 textarea 定位器不匹配，已使用实际可访问角色定位并从已存首版恢复验证，未重造首版记录。这些均不是正式店铺数据或 Ads 证据。
- Mission、策略、实验、记忆、Decision 编辑与归档弹窗复用现有 useOverlayFocusScope。五个受影响文件 106/106 回归、desktop 类型检查及 Renderer 构建通过（domain-dialog-focus.json、domain-dialog-typecheck.log、domain-dialog-renderer.log）。五类新建弹窗分别在原生最小窗口及 125% 通过初始焦点、正反 Tab、Escape、焦点归还及页脚可见检查（schema20-domain-dialogs-100-1788848156326/dialogs.json、schema20-domain-dialogs-125-1788848269960/dialogs.json）；未执行领域写入。最后目录包内容 SHA-256 为 7BEA6AD9E1DB71696E2B27D496B11B133E4BCDC61D74CB1D273A370EFDDACB4C。
- 当前采用目录版快速迭代，保留旧未引用静态资源；安装版、便携版、ZIP 与最后目录修改尚不匹配，必须稳定后统一重建。上述分次局部检查不作为完整 L4 通过。
- 核查 foundation-current 的数小时测试耗时：Windows Kernel-Power 记录测试期间合盖/待机，时间点与两个异常案例的约 3 小时 11 分、4 小时耗时吻合（foundation-power-events.json）。单独重跑三个快照反向案例均通过，分别 6345/6389/6345 ms（authority-duration-recheck.json，仅三个案例执行）；本次未复现代码长时间阻塞，不以缩减测试或伪造耗时处理。
- 新发现并修复首页忽略 UNKNOWN 的问题：Main 读取当前店铺执行记录，UNKNOWN 优先指向执行工作台的只读对账，不受产品/采集准备顺序影响，跨店 UNKNOWN 不改变当前主动作（today-unknown-red.json → today-unknown-offline-green.json）。同时修复 Ads 断线后拒绝读取执行历史的问题；历史读取复用店铺级只读仓储，恢复写入仍归启动/切店流程。断线回归先 red，最终 execution-authority-service 全文件 48/48；四个受影响文件合计 82/82、零跳过，desktop 类型检查及 Main 构建通过。尚未将此轮 Main 修改更新到目录包，旧包证据不覆盖该修复。
- 2026-09-08 最新一次完整 L1 实际执行 379 文件、5349 案例：5314 通过、35 失败、0 跳过，耗时约 9 分 16 秒（foundation-schema20-current/V16-T-L1-ALL.runner.json）。该次运行早于用户最新的禁止过度测试指令；保留原始失败，不合并后续筛选结果改写为全量通过。
- 其中确有生产启动问题：迁移后的启动门独立清单只到 schema 15，拒绝合法 schema 20。已复用 SQLite 唯一迁移合同，补齐新增表及 schema 16–20 的已有结构校验；原 FINALIZED 启动案例通过（migration-startup-schema20-focused.json，仅执行 1 项）。迁移测试修正旧版本数量预期；v4 修复单测直接调用 v4 迁移，生产初始化仍拒绝不连续账本。原失败的 16 个数据库案例全部通过（migration-previous-failures-check.json，仅这 16 项执行）。
- 修复报表映射丢弃同名标准字段、重复/同义列静默覆盖的问题：保留标准字段，在 SheetJS 重命名重复列之前校验原始表头，ROAS 与 ACOS 分开映射。Main 导入大小使用实际文件字节数。直接解析检查及两条过期文档/日报合同检查共 3 项通过（import-header-and-stale-contract-check.json）；Main 重复列拒绝且不落部分记录、人工模式八报表贯通并核对实际大小共 2 项通过（import-header-main-check.json）。上述筛选未执行的案例不计通过。最后 desktop 类型检查通过 migration-import-final-typecheck.log；未重复全量测试或打包，未修改正式库。




