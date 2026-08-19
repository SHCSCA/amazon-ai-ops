# Operator Core Flow Repair — 2026-08-07

## 2026-08-19 当前交付状态（下载成功，导入阻断；不得标记 APP_READY）

- 连接恢复已在最新 Windows 目标应用内闭合：保存凭证重连遇到身份门时显示当前店铺专用重置动作；应用内重置后再次重连不需手输，状态为 `ERP/Ads 已连接`。凭证、Cookie、Profile 均未被执行者读取或打印。
- 真实采集已形成 durable 下载证据：`batch_20260819041021809_613h3r` 为 `download-existing` campaign 任务，job/batch `completed`，文件 `downloaded`、41504 bytes。已有报表行匹配改为按稳定报表类型回读，避免为历史行虚构新时间戳名称。
- 真实导入仍 fail-closed：报表第 193 行日期为空，严格校验返回 `LINGXING_COLLECTION_IMPORT_FAILED`，任务 `importState=failed`，没有 `report_import_runs`。不把下载成功当作生产入库，也不跳过该行。
- 本轮验证保持压缩：相关两文件聚焦回归 `3 passed / 80 skipped`，desktop typecheck、`build:win`、`smoke:package-launch` 均通过；构建产物 EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`、installer `E13DDAEC88DBAE0950A002BE163F6C08132A09E9C9421EF1D3BA7F237EB7DF89`、portable `1EA40051EE3AB86313537B03C8C774F73417E46250EFE5C4ECB35B31EC134E16`、folder ZIP `5090774DB52E80D629F3D584CA856C0484EB9ABED061B78E9AAFDED25F21BBF1`，原生绑定未变化。
- `pnpm run smoke:folder-zip-launch` 同样 `passed=true`，ZIP/EXE SHA 精确匹配且临时进程清理；证据 `output/codex-evidence/folder-zip-launch-smoke-1787114238805.json`。该证据属于本地提交，因 GitHub 连接重置尚未推送。
- 当前剩余主阻断是范围外的 `packages/report-parser` 坏行处理，等待用户明确确认；策略、运营任务、经营实验、当前包 Package UI 与 Task 8B 仍不宣称完成，Ads 写入继续为 0。
- 2026-08-19 追加一次主动作复验：应用先把范围恢复为 `2026-08-04` 至 `2026-08-17`，随后完整 8 类动作在旧 `campaign/create_unknown` 检查点处立即安全停止；人工核对入口保持禁用。没有重复创建报表、没有拼接独立任务、没有新增广告写入。
- 当前源码业务 smoke 单次复验通过：`pnpm run smoke:business-ui-current` 为 6/6 子脚本、7/7 flow coverage，汇总 `output/codex-evidence/current-business-ui-smoke-1787115252897.json`；这不等价于正式库 8/8 导入或广告执行证据。
- 只读状态快照仍显示策略/任务/实验/导入/推荐/审批均未形成真实记录，Package UI 仍缺当前包新 manifest；本地 `34417831` 与远端 `c4e6e5f6` 的差异等待网络恢复后推送。

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
