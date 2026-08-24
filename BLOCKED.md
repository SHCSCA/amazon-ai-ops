# BLOCKED — 2026-08-07

## 当前：2026-08-24 Ads 身份发现已闭合，Task 8B 被当前证据与授权事实阻断

- 已排除登录、店铺、活动导航与活动 ID 问题：真实应用可用保存凭证恢复 ERP/Ads，且只读发现已唯一进入 JF-US 的 `U07-1P-精准` 关键词详情页；当前 profile 与活动 ID 均回读一致。
- 真实关键词行身份已闭合：应用唯一回读 `U07-1P-精准 > 精准 > cupping` 的稳定广告组/关键词 ID，固定列镜像已按同一身份安全合并；登录、店铺、活动、身份 selector 均不再是 blocker。
- 当前事实门改为竞价漂移：报表证据为 `$2.51`，Ads 页面当前竞价为 `$1.80`。该建议已经失效，应用已明确阻断绑定和执行；恢复动作是重新采集 keyword 报表并重新分析，禁止用旧值或手填 ID 强行绑定。
- 建议详情的只读识别入口已进入正式 Windows 新包，只会填表，不会自动绑定/批准/执行。
- DeepSeek 402 与策略 10% 上限仍独立存在：即使对象身份发现成功，当前 rule_fallback/超限候选也不能自动批准或执行。五张 Ads 写入表必须继续为 0。
- Windows 新包、7 类业务 smoke 与 folder ZIP 启动现已通过；仍缺绑定新包哈希的 Package UI manifest。按“减少测试、不要重复登录”要求本轮未再启动强制 fresh typed-and-saved 的 Package UI 首档；旧 manifest 不得复用。恢复条件是操作者确认进行最后一次当前包可见登录验收。

## 当前：2026-08-24 8/8、正式导入与下游业务实例已关闭，剩余为当前包验收和 Task 8B 授权事实门

- 真实 8/8 外部事实门已关闭：最新生产作业 `completed / import succeeded / downloaded 8`，唯一 completed import run 为 8 files / 1901 metrics / 8 reconciliations。旧 6/8、create_unknown、control-total missing 记录均为历史，不再是当前 blocker。
- Task 8B 已形成当前正式批次的具体 `lower_bid` 候选，但 3 条全部不可授权：DeepSeek HTTP 402 `Insufficient Balance` 导致 `rule_fallback`，变化超过启用策略的 10% 上限；其中建议 2 的稳定 Ads 身份已找到，但页面竞价已从报表 `$2.51` 漂移到 `$1.80`。正式库 action recommendations=5、approval tasks=0，五张 `ad_execution_*` 表继续全部为 0；不得为验收虚构批准或广告写入。恢复条件是补足 AI 余额/可用模型，重新采集并分析形成当前、不超过 10% 且 human eligible 的候选，再由操作者明确批准。
- 正式库已有 enabled policy version、active 运营任务和 draft 经营实验，均绑定真实 completed 批次与现有产品；该 blocker 已关闭。实验产品选择器的本地行号/ASIN 不一致已完成源码红→绿，仍需新包界面回读。
- 启用版本仍保持对象白名单 0、影响预算 0 USD，经营实验保持待启动；原因已从“页面身份无法发现”收窄为“没有当前、合规、已批准的候选”。不得把已过期建议的真实 ID 写入白名单或实验。
- 正式 keyword/auto_targeting/product_targeting XLSX 的 53/33/51 个表头均无 ID/编号/标识字段，不能通过补 parser 得到稳定写入身份；当前关键词身份已由 Ads 页面只读发现链补足，但只能在报表竞价与页面当前竞价一致时绑定。
- 当前 Package UI schema v8 第一档硬性要求本次 visible typed-and-saved 登录；runner 明确禁止 saved-login 自动化。执行者不得读取或代填密码，因此新 manifest 仍需操作者在 Package UI 窗口内完成一次手输提交；旧 manifest 不能复用。
- 当前新包的 7 类 business smoke 与 folder ZIP launch 已通过；只剩新 Package UI manifest 尚未生成。旧 schema v8 manifest 绑定的是此前包哈希，不能复用为当前包交付证据。
- 本轮完整 `legacy-ipc-store-authority-contract.test.ts` 暴露 2 个既有源码顺序断言失败：`resumePolicyGrantDispatches` 顺序与 legacy operator lease 首次出现顺序。新增 control-total 定点断言通过，解析器/collector 共 51 项通过。按用户“先保证主流程、其它发现记录后确认再修”要求暂不扩修；集成前必须决定修复或证明为陈旧源码切片断言，不允许 `.skip`、删测或放宽。

## 历史：2026-08-24 Package UI 已关闭，剩余为 8/8 外部事实门与 Task 8B 授权事实门

- Package UI 已不再阻断：当前包 schema v8 manifest `output/codex-evidence/package-ui-evidence/run-groups/operator-core-20260821-77/manifests/2026-08-24T01-13-35-545Z-2026-08-24T01-13-15-991Z-c1f8bf7d-a392-49e8-a04f-11a58455b7a2.json` 完整通过，100%/125%/1400×900 三档均 passed，console/page errors 均为 0，正式库与隔离证据库均未发生验收改写。
- 剩余 blocker 1：真实 8 类采集仍停在 6 类 downloaded、`product_targeting=failed / LINGXING_CREATE_CONFIRMED_ABSENT`、`user_search_term=queued`，`report_import_runs=0`。连续两次 `POST .../batch_create_report -> 200（操作成功）` 均未形成下载中心精确行；当前没有新的领星外部事实或产品决定授权第三次创建。源码现已新增“先完成其余报表”安全模式，保证商品投放零创建并允许搜索词先推进，但尚未进入 Windows 包或形成正式 7/8 证据。商品投放的最终恢复条件仍是领星侧给出明确创建事实，或产品明确接受一次新的受控创建尝试。
- 剩余 blocker 2：Task 8B 没有产品内具体、当前、已批准的正向 `lower_bid` 推荐。正式库五张 `ad_execution_*` 表全部为 0；不得为了完成验收虚构推荐、批准或广告写入。恢复条件是应用产生满足当前店铺/产品/身份/审批门的真实推荐，并由操作者批准。
- 受 blocker 1 影响，正式 import run、enabled policy version、mission、experiment 当前均为 0；现有策略/运营任务/经营实验的界面、空依赖入口、业务 smoke 与 Package UI 已通过，但不能把界面可用冒充真实生产数据闭环。
- 2026-08-24 readonly + `query_only=ON` 终审：正式库主文件查询前后 SHA-256 均为 `4C107960F7F75DFC566438A35817F912DDB55E9220BB7F3DFA475922529789A3`；jobs=6、attempts=12、active claims=0、events=111、imports/policy versions/missions/experiments=0、Ads 五表=0。当前状态仍为 `APP_NEEDS_WORK / NON_READY`。

## 历史：2026-08-21 Package UI 等待首次可见提交；8/8 外部事实门仍未解除

- Ads 连接源码/实包主链本轮已真实通过：`operator-core-20260821-76` 在 Amazon AI Ops 应用内单独“重试 Ads”后显示“ERP/Ads 已连接”，runner 接受 100% 首档连接证明并进入 125% 业务截图。它不再是当前 blocker。
- `-76` 后续失败由 runner 自身的键盘检查滚动竞态造成；该缺陷已完成 `1 RED → 1 GREEN`，没有放宽 `WORKSPACE_NOT_AT_TOP`、视口或业务断言。runner 源码改变使 `-76` 按不可变谱系正确不可续跑。
- 当前可恢复 run group 为 `operator-core-20260821-77`。首次 120 秒可见窗口没有收到提交，因此 `runs=0 / interactive preparation timeout`；目标应用/Profile Chrome 已清理。官方只读 inspector 已返回 `RESUME_SAFE / violations=[] / nextProfileId=100-compact`，一次性 receipt 为 `output/codex-evidence/package-ui-evidence/resume-intents/operator-core-20260821-77/22F32CD64877EF09F407DAA0A5666008510709B681CCFF4653A0794C4D5325E9.json`。
- 唯一 Package UI 外部动作：恢复 `-77` 后，操作者在首档 Amazon AI Ops 窗口中完成一次 fresh typed-and-saved 提交；执行者不得读取/代填密码。通过前仍为 `APP_NEEDS_WORK / NON_READY`。
- 8/8 采集仍停在 6 类 downloaded、`product_targeting=LINGXING_CREATE_CONFIRMED_ABSENT`、`user_search_term=queued`；连续两次创建 200 未形成下载中心行，当前没有新的领星外部事实授权再次创建。正式 import run、policy version、mission、experiment 仍为 0。
- Task 8B 继续缺产品内具体、当前、已批准的 `lower_bid` 推荐；五张 Ads 执行表为 0，禁止为验收制造写入。

## 历史：2026-08-21 商品投放已确认不存在，采集暂停并转项

- 当前无需人工参与的检查已收口：普通界面精确技术文案检索为 0，正式库 readonly/query_only 复核保持 6 类 downloaded、商品投放 confirmed absent、搜索词 queued，正式导入/策略版本/运营任务/经营实验与 Ads 五表全为 0，主库查询前后 SHA-256 不变。没有新的独立源码缺口可在不越过外部事实门的情况下继续实现。
- Package UI 不再缺包哈希、authority receipt 或隔离 Profile：当前 `operator-core-20260821-74` 已由只读 inspector 判定 `RESUME_SAFE`，一次性 resume receipt 已生成。当前唯一人工前置是操作者必须在首档可见窗口内手输密码、勾选“记住密码”并提交；本轮 180 秒无人提交，runner 已失败关闭且目标进程残留为 0。恢复条件是用户明确回复“现在可以输入”，随后只续跑 `-74`，不新建重复 run group。
- 非主链视觉项：Windows 构建明确提示当前仍使用 Electron 默认图标（`application icon is not set`）。按用户要求仅记录，未扩改品牌资产；不影响本轮连接、采集安全门、业务 smoke 或 ZIP 启动结论。
- 用户看到的领星下载中心是上一轮商品投放创建后唯一回读的目标应用窗口；本轮已关闭，不再停留或重试。源码只保留非 GET 响应的 method/path/status/脱敏 message，现有证据仅能确认 `batch_create_report -> 200（操作成功）`，没有证据证明响应中存在可接管的任务号；在没有新外部事实前不推测字段、不放宽按精确报表名回读门。
- 当前包已修复策略可用时误显示阻断原因、正式空态下任务弹窗顶部裁切；新包 7 类 smoke、Windows build、ZIP 解压启动和正式包定点复验均通过。这两项不再是 blocker。
- Package UI 的自动准备部分已完成：当前包哈希、authority receipt 和只含正式库只读在线备份的新隔离 Profile 均已就绪。唯一不可自动替代项是 schema v8 首 profile 强制的本次可见 typed+saved 登录证明；旧已登录 Profile、Main 保存密码和现有会话均被 runner 明确拒绝。未取得该人工动作前不能生成当前包通过 manifest。
- 目标应用内 Main 托管凭证已重新验证 ERP/Ads 同店身份，下载中心诊断 `ready=true`；随后仅执行一次 `reconcileOnly=true`，未创建或下载报表。
- 精确名称 `AAO_20260806_20260819_product_targeting_064758` 仍不存在，正式作业已从 `create_unknown` 收口为 `failed / LINGXING_CREATE_CONFIRMED_ABSENT`；当前仍是 6 类 downloaded、商品投放 failed、用户搜索词 queued、正式 import run 0。
- 该状态技术上允许以后安全重新创建，但连续两次 `POST 200（操作成功）` 均未形成下载中心行；为避免继续空转，本轮不再创建，先推进不依赖 8/8 的策略/运营任务/经营实验界面与禁用路径。恢复条件是明确决定重新创建商品投放并接受一次新的外部尝试，或领星侧能解释该报表类型的创建限制。
- 8/8 入库、策略启用后的真实任务/实验数据闭环及 Task 8B 仍受前置事实阻断；没有产品内已批准 `lower_bid` 推荐，广告写入必须保持 0。
- 当前包的 Windows 构建、7 类业务 smoke 与文件夹 ZIP 真实启动均已通过；Package UI 尚无当前通过 manifest。runner 强制要求当前哈希、正式库 authority receipt、现存隔离 Profile 与可见操作者登录，不能用裸命令、旧 Profile 或保存密码伪造。当前哈希和 authority receipt 已准备好，恢复条件是创建/选择合规隔离 Profile并由操作者完成一次可见登录。
- GitHub 推送仍因 `Recv failure: Connection was reset` 失败；不影响本地提交，但远端仍未包含本轮新提交。恢复条件是本机到 github.com:443 连通后执行一次 `git push origin master`。

## 当前：2026-08-21 自动投放源码阻断已解除，商品投放仍需实包唯一回读

- “确认”兼容已被正式实包否定：`…044644` 仍未出现，提交事实为无二次确认、无可见错误。当前阻断只剩“前端表单未发请求”或“服务端请求拒绝”两类，必须通过脱敏请求/响应与表单就绪回读区分。
- 当前 attempts 7、claims 0、events 61、imports 0、Ads 五表 0；在上述诊断进入包前不再续采。
- 正式提交反馈已确定 `…043611` 的创建页没有可见错误，但旧逻辑未发现“确定”按钮；当前最可能的 DOM 漂移是二次动作改为“确认”。弹窗内“确定/确认”兼容已 `1 RED → 13/13 GREEN`，尚未进入 Windows 包。
- 当前 attempts 6、claims 0、events 54、imports 0、Ads 五表 0；下一包仍先只读核对 `…043611`，再做一次单独续采验证，未核对前禁止提交。
- “确定/确认”兼容已进入 folder ZIP `A0D436D2AFC9D00635CF8097724AAF4D20529DBE9E7A7FDE6A9FB3205DD21B30`；当前只差同一安全两步实包验证。
- 唯一可见确认修复实包仍未创建 `…042344`，因此当前不能再归因于隐藏旧弹窗；阻断收窄为创建提交后的可见表单/服务反馈被旧代码忽略。必须先把该反馈结构化回读，才能决定是缺必填字段、频控还是领星服务拒绝。
- 当前 attempts 5、active claims 0、events 47、import 0、Ads 五表 0；未经下一次只读核对与结构化提交反馈，不再续采。
- 提交反馈读取已 `1 RED → 13/13 GREEN` 并通过 typecheck，尚未进入 Windows 包；下一包只允许先核对 latest create_unknown，再做一次单独续采以取得确定的表单/服务反馈。
- 提交反馈读取已进入 folder ZIP `13B366D91DF38951B596435D22E9C9A8CF0656D22A03613725EAC944D2AA28B2`；当前只差正式应用的一次只读核对与一次单独续采返回确定原因。
- post-create 精确搜索已在正式包中生效并证明 `…040927` 不存在；问题不再是列表分页，而是创建确认未提交。确认按钮旧逻辑命中隐藏弹窗 `.first()` 的缺口已 `1 RED → 12/12 GREEN` 并通过 typecheck，尚未重建实测。
- 当前 latest create_unknown 必须先由下一包“仅核对创建结果”确认；之后只允许一次单独续采验证唯一可见确认修复。当前 attempts 4、active claims 0、events 40、import 0、Ads 五表 0。
- 确认按钮修复已进入 folder ZIP `1E4653779EABDF4BDDC1BDEB0478C7332B064C92B966FCEB778AD46F73FDB4C9`；当前只差新包依次执行一次只读核对和一次单独续采，仍不把构建成功当作创建成功。
- 旧包的“核对并继续”已证明存在产品级危险歧义：核对缺失后在同一点击中立即创建，而 post-create 仅看当前列表页，未按新生成名精确搜索，导致 `…034952` 再次 create_unknown。当前未确认该行存在前禁止再次恢复。
- reconcile-only 与 post-create 精确搜索已完成 `4 RED → 70/70 GREEN` 并通过 desktop typecheck，但尚未重建入 Windows 包。下一步必须先用新包“仅核对创建结果”；只有唯一找到或连续精确确认缺失后，才由单独“继续采集”动作推进。
- 修复已进入 folder ZIP `DC81A6A07276C5C60262592F53B62409386B8657501CD8A5B181D44C9B88F25C`；当前阻断收窄为新包对 `…034952` 的一次只读唯一核对结果，尚未授权语义上的再次创建。
- 最新正式续采已证明自动投放真实下载成功，但商品投放再次进入新的 `LINGXING_CREATE_CALL_INTERRUPTED/create_unknown`，搜索词仍 queued；当前为 downloaded 6/8、正式 import run 0。
- 本次恢复 claim 已释放（attempts 2、active claims 0、events 26），Ads 执行五表为 0。禁止直接重复续采；必须先由目标应用按精确生成名唯一核对本次创建结果。
- 自动投放真实文件不是坏文件：领星使用通用“投放”列并以受控值表示自动定向组。collector/parser 已用值域窄门完成红→绿，真实 XLSX 只读复验 30/30 行通过；ASIN、未知值、空文件反向门仍拒绝。
- 自动投放源码阻断虽已解除，但尚未产生正式 immutable import run；构建成功、测试或只读 parser 结果都不能冒充真实 8/8 入库。
- 修复现已进入新 Windows 包（folder ZIP `28C693563940302A0A166766FE8F1FF291351D68C91FDD7557732D0786A1EFED`），但仍未形成正式 8/8/import 证据；下一步实包只做唯一回读与安全恢复。
- 当前 `product_targeting` 仍保留 `LINGXING_CREATE_CALL_INTERRUPTED/create_unknown` 外部不确定态。新包中必须先按精确生成名核对下载中心唯一行：找到则接管，连续精确搜索确认缺失后才允许重建；重复、搜索漂移或未知状态继续阻断。
- 第一版新包的唯一回读被当前领星下载中心搜索框 DOM 漂移阻断：旧 Element selector 命中 0；双结构+唯一可见门已红→绿并进入 folder ZIP `FBCBBBF460D0846ABB074FB4D903F62B8816D2AB98C2B7E4B084B0A09185FC0F`。尚待新包实测，未发生创建或下载，不能把前一轮算作 create_unknown 已核清。
- 第二次实包证明上述包仍被已验证页面模型中的旧非空 selector 覆盖。运行时模型合并现已红→绿，但尚未进入下一包；当前 blocker 已从“未知 DOM”收窄为“新 Main 尚未构建复验”。
- 运行时模型合并已进入 folder ZIP `813CE0384E1EE0CFB57A374C7179026FA9EC29BD33E7564CA4BCB645A480BCFE`；当前只差实包唯一回读结果，仍不能预判 create_unknown 已核清。
- 唯一回读现已通过并确认原商品投放记录缺失；当前 blocker 下移为 continuation 的 Main runtime sticky unknown。只读 DB 证明新 attempt/claim/import 均未产生，因此没有重复创建风险，但必须先取得重启后第一次 resume 的原始错误，不能反复点击 sticky 次生错误。
- 首次原始错误已确认是 diagnostic page-model fingerprint 分裂，不是浏览器身份或 durable CAS。effective 模型统一修复已红→绿，但尚未进入下一包；当前阻断是“新包需证明 preflight→claim”，不是需要再次人工核对。
- effective 模型统一修复已进入 folder ZIP `B7878BF60E9633A554E774A8EACF0B2659E675FF93B90AD6245B8303DB9AA0C0`；当前只需实包证明 preflight→claim/runner，仍不重复 absence 核对。
- 正式 Ads 执行五表仍为 0。8/8 入库、策略启用、运营任务、经营实验、Package UI 与 Task 8B 仍未完成，整体为 `APP_NEEDS_WORK / NON_READY`。

## 当前：2026-08-20 原创建结果已核清，续跑在恢复 claim 前阻断

- 主因源码已定位并完成聚焦红→绿：完整八报表恢复漏登记同店 `operator_full` runtime 的预期关闭，可能把采集接管浏览器误判成身份/liveness 失效。新增契约先红（找不到登记），修后 `1/1 passed`，typecheck 通过；尚待重建与一次正式应用续跑证明，因此当前仍不能宣称 8/8。
- 第一版正式复验已否定“只保护 resumeJob”足够：核对阶段成功写入新 ready 诊断后 claim 仍为 0。第二个聚焦红测证明保护必须覆盖核对阶段的 ERP→Ads 导航；前移修复已绿并通过 typecheck，尚待新包单次复验。
- 前移修复已进入新包，folder ZIP `F5893461D841D64276085264A2A8E025605F3A4395984CAEEB6E2A5CE68CD062`；当前只差一次正式应用同任务续跑结果，不能用构建成功代替 claim/8/8/import 证据。
- 已取得 claim=0 的决定性源码原因：生产 coordinator 未注入 6 个 resume persistence 端口，首错为 `LINGXING_COLLECTION_RESUME_PERSISTENCE_UNAVAILABLE`；Main 随后才进入粘性 safety unknown。6 个端口现已全部一对一绑定既有仓储实现，聚焦红→绿与 typecheck 通过，尚待新包正式 claim/runner 证明。
- 6 端口 wiring 已进入新包，folder ZIP `A47F98F5C766C13D3B7791E969FC9D39B901FC894B4938444EFD0F2C0F667193`；当前阻断只剩正式同任务 claim/runner/import 结果，尚不能宣称采集闭环。
- 生产 resume persistence 阻断已正式解除：本包形成 1 个 attempt、最多 1 个 active claim、13 个事件，并以 failed 终态释放 claim。当前阻断已下移到真实外部报表：自动投放文件表头类型不匹配，以及商品投放创建结果再次 `create_unknown`；正式 import run 仍为 0。
- 商品投放本次精确生成名在 30 秒内未出现，属于新的外部事实不确定态；未核对下载中心前不得再次发起创建。自动投放文件允许只读检查表头/类型映射，但不得把错误报表强行标成目标类型或放宽列语义唯一性校验。
- 目标应用 shutdown 旁支仍存在：主窗关闭且 `electronApp.close()` 等待超过 60 秒后，3 个目标应用进程未退出；正式库无在途 claim/导入/Ads 写入后已定点终止，残留 0。主链完成前不扩修 shutdown，但交付验收不得忽略。
- 修复已进入新 Windows 包：installer `C26870A46AAC9578D921B7A4E7562E73C7B48995CB3CDD7FAF9B2876F73E3C81`、portable `78B71EA1E13853B8CF282F38511B9DC53CE543F957496E0193FB079BBCBE19B6`、folder ZIP `F47A6A20D0E31C818AB5CC7485CC129B14759B7399E6ABE0605BF9EDC0496355`。当前唯一未决是正式应用同一任务续跑结果。
- 非业务主链阻断：`browser-login-staged-status.test.ts` 全文件为 47/48，唯一旧断言把换行写死为 LF，而 Windows checkout 的 `index.ts` 为 CRLF。按“不改弱现有断言”保持原样；聚焦新增用例和类型检查已绿。后续统一测试源码换行策略时再修，不能用 `.skip`、删除断言或模糊匹配规避。
- 已用公开 `resumeInPlace` 主链增加三段非敏感失败标识：`RUNTIME_AUTHORITY`、`PREFLIGHT`、`CLAIM`。精确预检 RED 为 `1 failed / 22 skipped`（旧实现只返回原始错误），修后聚焦 `1 passed / 22 skipped`、全文件 `23/23 passed`、desktop typecheck 通过。这只是定位门，不冒充已修复真实恢复阻断。
- 定点应用实测同时证明旧 Renderer 在 generation 前进时清空在途 action token，使 Main 失败被静默丢弃：页面无处理中/成功/失败反馈，正式库仍 `0/0/0`。新增精确 wiring RED 后已修复为仅保留同店安全 generation-forward 动作；采集页 `58/58`、typecheck 通过。当前仍需重建后读取真实阶段错误，未宣称恢复已成功。
- 当前 Windows 运行包尚未包含该阶段标识。重建后允许一次仅操控目标应用的续跑复现；如果返回其中一个阶段，立即停止应用回放并转为该唯一条件的源码 TDD。
- 人工事实门已经闭合：目标应用已确认原 `product_targeting` 精确生成记录不存在，并把原任务持久化为 `LINGXING_CREATE_CONFIRMED_ABSENT`；因此当前阻断不再是“需要人工核对创建结果”。
- 最新包中点击同一任务“继续采集”后，恢复三表仍精确为 `attempts=0 / active_claims=0 / events=0`，任务未进入可变更下载/导入状态。代码边界为 `resumeJob` 已取得 exact durable resume packet，但在协调器的 `acquireCollectionResumeClaimForStore` 前被浏览器运行时或 preflight 安全门拒绝。
- 同日期最新下载中心诊断的安全摘要为：`ready=true`、截图文件存在、DOM 文件存在、16 条动作检查存在、页面模型快照完全匹配、必需动作证据缺失为 0、证据年龄约 6 分钟。因此不能再笼统归因于“没有验证页面”；需要用聚焦测试区分运行时身份/authority 变化与 preflight readback。
- 复制库已进一步排除仓储门：官方 readonly/query-only 在线备份上的 exact packet 成功取得 resume claim，复制库 `attempts/active_claims/events=1/1/1`；正式库保持 `0/0/0`。剩余阻断只可能位于协调器 claim 前的 operation lease、可见运行时/身份回读或 preflight 断言。
- UI 丢失错误反馈的确定缺口已红→绿修复：resume catch 现在只允许同店、同 Profile、同站点/币种/业务日且 generation 单调前进时保留中文失败；其他 authority 变化继续 fail-closed。聚焦回归 `66/66`、desktop typecheck 通过，但该源码尚未重建入包，因此当前运行包仍不能显示这次 preclaim 的精确原因。
- “确认缺失”安全门也已收紧：同日期兄弟行不再单独构成 absence proof；只有下载中心搜索框精确绑定本次生成名、值回读一致且连续 3 次无精确行才可重建。该修改防止分页或未生效过滤导致重复创建，不改变当前已经取得的正式人工事实。
- 最新构建哈希：installer `2E07497F23233D90DCDAA5B80E6748D93DD9401C20F561459A6E7C56EA125578`、portable `924D31B0875FE8C264D1E1D964E52531BD6E96997B4B29A4F31B25A6E4AC8D0C`、folder ZIP `C997AFEF9403806790B192568026B9AF5ED482BEBCD1526E95C5D2B423FA9AE5`、blockmap `4CDE6B7F23D1C87278418C96334BBDDD4D4F5A281A2ECE2D98E0E43C9DA7D6C1`。目标应用已停止且精确进程残留为 0。
- 广告执行五表继续为 0；没有产品内具体推荐和人工批准前不得进行 Task 8B。真实 8/8 入库未完成，整体仍为 `APP_NEEDS_WORK / NON_READY`。
- 当前安全修复已提交为 `5c5e23d3`，状态说明为 `614ab810`；功能分支已 `--ff-only` 合并到 `master` 并成功推送 `origin/master`。此前两次功能分支推送的 HTTPS 连接重置已解除，不再是当前阻断；业务阻断仍仅是 claim 前浏览器运行时/preflight。

## 历史：2026-08-20 真实 8 类采集需要人工核对领星创建结果

- 人工核对事实已取得：当前店铺同日期有 5 条其他生成成功报表，但原 `product_targeting` 精确生成名不存在；旧“无法判断是否创建”的事实不确定态已收窄为“可审计缺失”。
- 源码已新增显式“核对并继续”路径，聚焦回归 `65/65` 与 desktop typecheck 通过；它不盲重试，只有唯一生成名、当前店铺身份和同日期旁证同时成立才把缺失写为可恢复 checkpoint。尚未重建并用目标应用复验，因此当前阻断仍是“运行包未包含/未证明该恢复链”，不是代码已完成。

- 启动恢复、Main-only 保存凭证连接、ERP/Ads 同店身份链均已进入最新 Windows 包并完成正式 AppData 实测；当前不再被旧导入恢复门或登录阻断。
- 单次完整 8 类主动作形成 durable failed job。精确失败为 `LINGXING_CREATE_CALL_INTERRUPTED`：`product_targeting` 创建请求后，30 秒内无法在领星下载中心唯一定位本次生成的报表行。当前 checkpoint 分布为 downloaded 5、create_unknown 1、failed 1、queued 1；`report_import_runs=0`。
- 这是必须 fail-closed 的外部事实不确定态：应用不能自动断言“已创建”或“未创建”，也不能盲目重复创建。下一步必须由操作者在领星下载中心核对该报表是否存在，再决定安全接管或重新创建。未核对前不重复点击本次采集。
- 正式库只读 `mode=ro + query_only=1` 终审：jobs 5、batches 3、files 9、导入 0；五张广告执行表全部为 0。目标应用进程已退出且残留为 0。
- 当前整体仍为 `APP_NEEDS_WORK / NON_READY`。策略启用、运营任务、经营实验、当前包 Package UI 与 Task 8B 均不能越过真实 8/8 入库前置；没有具体、产品内已批准的 `lower_bid` 推荐前，任何广告写入继续为 0。
- 已记录但本轮不扩修：连接失败提示仍暴露 `Error invoking remote method`；正常应用重启后偶尔仍要求当前店铺会话重置。等待用户确认后再处理。
- 恢复修复与当前文档已提交为 `668ac75e`，已推送功能分支，并以 `--ff-only` 快进合并到 `master` 后推送。未提交 `output/`、`storage/`、Profile、报表或 EXE/ZIP；下方早期网络失败记录仅保留为历史。

## 历史：2026-08-20 正式 AppData 启动被旧失败导入恢复门阻断

- parser 修复已进入新 Windows 包，包启动 smoke 通过；但用正式 AppData 启动目标应用时，Main 在主窗口创建前扫描到 1 个旧 `failed` 导入任务，并得到 `recovered=0 / failed=1 / knownFailed=0 / authorityFailed=1`。
- `assertLingxingImportStartupRecoverySafe` 随即以 `LINGXING_COLLECTION_IMPORT_RECOVERY_AUTHORITY_FAILED` 安全停止。没有主窗口、没有执行新 parser 导入、没有新的 import run，也没有 Ads 写入；中止后目标应用进程残留为 0。
- 当前授权只覆盖 parser 两文件，恢复调用位于 `apps/desktop/src/main/index.ts`，分类门位于 `lingxing-import-startup-recovery-gate.ts` 及其测试，均未获本轮修改授权。按用户要求只记录，不绕过 gate、不直接改正式库、不清理旧任务。
- 正式库只读证据把原因收窄为合同错配：任务只有 `1/8` downloaded checkpoint/file，持久错误类别为 `LINGXING_IMPORT_RECONCILIATION_EVIDENCE_MISSING`，且 `report_import_runs=0`；恢复队列允许部分任务，但 Main 后续要求完整 8 类 reconciliation proof，因此必然落 authority failure。
- 仓储既有测试明确要求部分下载终态继续作为 recovery candidate，不能删测、改弱断言或简单从 SQL 隐藏。若获授权，应先红测“合法部分终态、无 immutable run、精确 failed settlement 不阻断应用启动”，然后在 Main 分类为 known failed；真正 CAS 冲突、已有 immutable run 不一致、跨店上下文或 reconciliation 漂移必须继续 authority-fail。
- 文档提交 `a4b62df4` 已在本地形成，但 GitHub 连续两次分别连接重置与 443 不可达，尚未推送；Parser 修复提交 `5f2907d5` 已在远端。没有强推或修改 remote。

## 历史：2026-08-20 parser 授权与源码阻断已解除

- 用户已授权 parser 两文件；零活动 paused 占位行分类已完成精确红→绿，正式 campaign XLSX 只读解析为 `192` 个原始数据行、`191` 条有效记录、`0` 条无效记录，原始来源行号保持 `2…192`。
- 非零与非法指标反向用例继续 fail-closed；没有跳过泛化坏行、没有改弱日期/店铺/活动必填校验、没有改写原 XLSX 或正式库。
- 当前剩余阻断从“解析器源码缺口”变为“运行包尚未重建并在目标应用内形成真实 import run”。重建并单次复验前，8/8 入库、策略/运营任务/经营实验、当前包 Package UI 与 Task 8B 仍未完成，Ads 写入保持 0。

## 历史：2026-08-19 最新阻断快照

- 当前 HEAD/远端均为 `5d53747e`；只剩既有未跟踪临时目录，未把产物、正式库或 Profile 纳入提交。
- 最新 Windows 包与 ZIP smoke 已通过，业务 smoke 为 6/6 子脚本、7/7 flow；当前包哈希与证据以 `PROGRESS.md` 最新快照为准。
- Package UI `operator-core-20260819-70` 绑定当前包，但因 60 秒内无操作者提交而产生不可变失败 `PACKAGE_UI_OPERATOR_WINDOW_CLOSED`；没有新的通过 manifest，历史 run 不得替代。
- 真实业务主阻断：下载已成功，严格导入因真实 XLSX 第 193 行日期为空失败，`report_import_runs=0`；`packages/report-parser` 不在已授权修改范围，按用户要求等待明确确认，不跳过坏行、不放宽校验。
- 由于没有完成 8/8 入库，策略/运营任务/经营实验没有可用真实前置；没有具体、产品内已批准的 `lower_bid` 推荐前，Task 8B 与所有广告写入继续为 0。整体仍 `APP_NEEDS_WORK / NON_READY`。
- neat-freak 盘点还发现 `AGENTS.md`、`README.md` 与 `docs/USER_GUIDE_v1_5.md` 保留更早候选包的“current/APP_READY”历史段；本轮原始文件边界只允许更新本文件、`PROGRESS.md` 与指定运营修复文档，因此不越界改写，以上三份置顶快照为当前事实来源。

## 当前：2026-08-19 下载已成功，严格导入因真实报表第 193 行空日期阻断

- 最新目标应用已完成同店保存凭证恢复：应用内显式重置后无需再次输入密码，`ERP/Ads 已连接`；未读取或打印密码、Cookie、Profile。
- 正式库真实下载任务 `batch_20260819041021809_613h3r` 为 `completed`，campaign 批次/文件均已落盘；随后导入返回 `LINGXING_COLLECTION_IMPORT_FAILED: 真实报表包含无效数据（第 193 行 date）`。仅该行“日期”为空，行仍含其他指标字段；`importState=failed`，`report_import_runs=0`，所以不能宣称生产入库或 8/8。
- 该解析/导入边界位于本轮允许修改范围外的 `packages/report-parser`；按用户“其他发现先记录、等确认再改”的要求，本轮不跳过坏行、不改弱校验、不越界修复。需要用户明确确认后，才能设计带来源行证据的安全处理方案。
- 技术修复与包门已通过：定点聚焦回归 `2 files / 3 passed / 80 skipped`、desktop typecheck、当前 `build:win`、`smoke:package-launch`、`smoke:folder-zip-launch`、业务 smoke `6/6 + 7/7` 均通过；Ads 执行表仍全 0。总体继续 `APP_NEEDS_WORK / NON_READY`。
- 交付提交 `91158052` 及后续文档提交已保留完整历史；当前状态已随 `a387879e` 推送到远端。未改 remote、未强推。
- 当前重建 folder ZIP smoke 为 `output/codex-evidence/folder-zip-launch-smoke-1787117059767.json`，安装包 smoke 为 `output/codex-evidence/package-launch-smoke-1787116961932.json`；构建产物本身仍按规则不进 Git。
- neat-freak 盘点发现 `README.md` 与 `AGENTS.md` 仍保留更早候选包的历史摘要；本轮硬边界只允许更新 `PROGRESS.md`、`BLOCKED.md` 与 `docs/OPERATOR_CORE_FLOW_REPAIR_2026-08-07.md`，因此未越界改写，当前事实以这三份文档的 2026-08-19 置顶段为准。
- 追加的完整 8 类应用动作在旧任务 `campaign/create_unknown` 处安全阻断；界面“人工核对（禁止恢复）”保持禁用，没有可用的应用内恢复路径。不能自动猜测领星结果、重复创建或拼接独立 campaign 批次，等待人工核对或用户确认新的安全修复方案。
- `pnpm run smoke:business-ui-current` 已单次通过 6/6 子脚本、7/7 flow coverage；它只证明隔离的 UI 合同，不解除真实报表导入、`create_unknown`、Package UI 或 Task 8B 阻断。
- 只读终审仍确认：策略无启用版本、运营任务/经营实验/导入/推荐/审批均为 0；Package UI `operator-core-20260819-70` 有不可变失败 manifest，但没有通过 manifest。当前本地与远端同步；没有通过 manifest 不等于 Package UI 已通过。

## 当前：2026-08-19 采集重试等待操作者；提示层阻断已修复

- 真实失败原因已确认：领星下载中心的非模态成功提示层覆盖店铺 FilterSelect，导致首个 campaign 创建/下载点击超时；正式库当前为 1 个 failed job、1 个 failed batch、1 个 failed file，尚无 import run/8 类完成批次。
- 修复已进入新 Windows 包：已知提示层只走关闭控件/Escape，无法关闭即阻断；SSO `35/35`、typecheck、build:win、package-launch smoke 均通过。未放宽 Ads 身份、店铺隔离或广告写入安全门。
- **待用户动作**：请在目标应用的数据采集页对失败任务点击一次“重试/继续采集”。仅在应用内观察成功或中文可操作失败；不盲点第二次。执行者不代输凭证、不操控桌面。
- 其他已发现问题（普通界面技术文案、scheduler title、任务/实验真实数据前置、Task 8B 推荐与审批）按用户要求只记录，等主流程确认后再决定是否扩修。当前仍 `APP_NEEDS_WORK / NON_READY`，Ads 写入 0。

## 当前：2026-08-19 诊断前置已进入包，唯一主流程阻断是正式 8/8 复验

- 已按确认方案闭合：collection-only 在进入 scheduler 前按当前店铺业务窗持久化同页下载中心诊断，TDD 聚焦红→绿、typecheck、`build:win` 均通过。
- 仍未有本包谱系的真实 collection job、8/8 完成批次或导入证据；不得用 build/smoke 代替正式业务结果。下一步只启动目标应用并点击一次完整 8 类采集，读取中文成功或失败原因后停止。
- 其他发现继续保持记录状态，未经用户再次确认不扩修；Ads 身份/审批/回读门与广告写入 0 不变，整体仍 `APP_NEEDS_WORK / NON_READY`。
- 版本状态：选择性提交 `02f47f46` 已成功；向 `origin/codex/preview-contract-production-p2` 的两次推送均因 GitHub 连接被远端重置（`Recv failure: Connection was reset`）失败，待网络恢复后再推送一次，不影响本地提交与回滚。

## 当前：2026-08-17 下载中心诊断前置与后台周期形成循环阻断，等待用户确认再改

- **已闭合但不足以恢复主链的范围**：`scheduler_request_bound + exact not_found` 现在会保留不可变失败证据，但不再占用当前 fingerprint 的有效采集资格；聚焦正向/反向测试 `2/2 passed`、typecheck 通过，新 Windows 包已构建。它只解决“旧失败不永久占位”，不能阻止下一次后台周期再次进入同一失败。
- **确定根因**：Main `start()` 会立即运行后台采集周期。生产 coordinator 在 collector 写入首条 durable progress 前调用下载中心预检；预检硬性要求同页面模型、日期窗、店铺/站点且 30 分钟内的成功诊断。正式库只读查询显示 `download_center_diagnostics=0`，所以预检必然抛错，而 transition 此时已是 `scheduler_request_bound`；编排器因此按未知 scheduler 结果 fail-closed，Main 再把整个运行时置为粘性 `SAFETY_STATE_UNKNOWN`。
- **为何现有自动修复不可达**：Renderer 已实现“采集报缺诊断 → 自动验证页面 → 原动作重试”，但主动作先调用 `getStoreCollectionSchedule` 捕获唯一日期窗。该读取会访问已进入安全未知的编排器，因此在真正调用采集前就失败，只能显示“采集窗口读取失败”；自动验证逻辑没有机会执行。
- **只读业务证据**：正式库 `query_only=1`；诊断、采集 jobs/batches/files 均为 0，Lingxing 与 Ads connection 均为 ready，五张广告执行表均为 0。因此不是登录或 Ads 连接失败，也未进入下载/导入，更不是广告写入。
- **按用户要求暂停扩修**：本轮没有新增产品代码或测试、没有启动应用。只读实现审计已把方案收窄：复用现有 collection-only 身份检查中“已精确匹配店铺并进入下载中心”的受控浏览器操作，在 `scheduler_request_bound` 之前为当前 runtime config / businessDate 唯一窗口生成并持久化诊断。通过才继续调度；失败按 pre-scheduler 页面/身份阻断清理并保持 0 durable job。前台仍只点击一次，不需要先失败再重试，也不放宽未知 scheduler 结果。
- **压缩验收计划（待批准）**：预计仅改白名单内 `apps/desktop/src/main/index.ts` 与现有 Main wiring 回归测试；只新增/运行 1 条聚焦主链用例，再跑 desktop typecheck 和一次目标应用真实 `0/8 → durable job → 8/8/可操作失败`，不先跑完整矩阵。
- **仅记录的其他问题**：应用头部“会话待确认”与正式 connection ready/连接工作台 ready 不一致；此前完整重连还出现过笼统错误提示；Vite CJS、超大 chunk、asar 关闭和默认图标继续只记录。未经用户确认不修改。
- **当前包身份**：EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`；installer `69ABB308056C6FA5D286F2ABBCFF8858ACE1075A38BF12780EB9C24ECA259759`；portable `C3D3C37816F3BC2AA6F28031DD6D8A9BDBCFDEE11B99664461155C3A2538404E`；folder ZIP `5191C8DFD3CDD289376E0658F5A208C2CADD19582772FB48AF144F6FD4B5B542`。
- **总体状态**：仍为 `APP_NEEDS_WORK / NON_READY`。真实 8/8、启用策略、运营任务、经营实验、当前包 Package UI、Task 8B 回读和选择性提交均未完成；没有产品内批准的具体 `lower_bid` 前广告写入必须保持 0。

## 当前：2026-08-17 原两项阻断已解除，等待最新包真实 8/8

- **采集恢复已解除**：用户已授权原白名单外两个编排器文件；44 历史下界、50→51 合法恢复现已通过，同时 1→2 低于历史与 0→1 回退仍严格阻断。编排器完整 `119/119 passed`，typecheck 通过。
- **业务 smoke 已解除**：共享导航 helper 不再把 `port: 0` 交给 Vite 5 回退到 5173，而是使用 Windows 分配的可绑定 loopback 端口；当前 `smoke:business-ui-current` 为 6/6 子脚本及 7/7 业务类别通过，summary `output/codex-evidence/current-business-ui-smoke-1786934114486.json`。
- **当前真实业务门**：修复尚未进入新的 Windows 包；正式库仍缺本轮包谱系的 8/8 完成批次与导入结果。下一步只做重建和目标应用真实采集，然后再做策略、运营任务与经营实验。
- **仅记录、暂不扩修**：Vite 启动仍输出“CJS build of Vite's Node API is deprecated”警告，但不影响动态端口启动和 6/6 smoke；按用户要求留待主流程闭合后确认是否处理。
- **构建旁支问题只记录**：production bundle 仍有单 chunk 超过 500 kB、Electron Builder 提示 `asar` 关闭，以及应用仍使用默认 Electron 图标；本次构建七步均成功，这些不阻断 8/8 主流程，未经用户后续确认不修改。
- **安全不变**：没有具体、产品内已批准的 `lower_bid` 推荐前，Task 8B 与所有真实广告写入继续为 0；不得提前标记 `APP_READY`。

## 历史：2026-08-17 启动恢复核心修复曾超出原文件白名单（现已授权并修复）

- **即时阻断**：最新包在业务会话建立前主动停止。Main 原始错误链为 `SAFETY_STATE_UNKNOWN`，具体失败谓词是“restore 回执未证明 durable generation 递增”，不是登录、Ads 店铺识别或采集页面问题。
- **确定性证据**：历史同店铺恢复下界 generation=44；当前 durable generation 已合法推进到 50；恢复回执为 50→51。店铺/Profile、US/USD、时区和日期单调性均通过，只有 `targetGenerationBefore === durableOriginGeneration` 的旧等值要求失败。每次重启都会继续推进当前 generation，因此等待或盲重试不能恢复。
- **安全修复边界**：应把等值要求改成“回执前代次不低于历史下界，回执后严格大于回执前”，并新增正向前进与回退/异店反向测试。禁止回滚正式库 generation、清空受保护历史、伪造回执或放宽店铺隔离。
- **为什么未直接修改**：必要文件 `apps/desktop/src/main/store-collection-orchestrator.ts` 与 `apps/desktop/src/main/store-collection-orchestrator.test.ts` 不在任务书允许修改的白名单；继续需要显式扩展这两个文件的授权。其余允许范围内没有安全、可维护的修复 seam。
- **当前数据安全**：目标应用已停止；正式库只读/query-only 复核显示采集任务/批次/文件仍为 0，五张广告执行表与 `action_logs` 均为 0。应用启动、真实 8 类采集及后续策略/任务/实验因此暂未继续，仍不得标记 `APP_READY`。
- **不受影响门已复验**：任务书六文件当前为 `129/129 passed`、skipped=0，desktop typecheck 通过，静态 diff 门无错误；因此当前阻断已收窄到上述编排器恢复谓词及其白名单授权，不是通用编译或六条核心业务测试回归。
- **业务 smoke 环境阻断**：本轮 summary `output/codex-evidence/current-business-ui-smoke-1786930530516.json` 中采集脚本通过，其余五项均在页面断言前因 `127.0.0.1:5173` 绑定 `EACCES` 失败。端口无占用，但当前 Windows TCP 排除范围 5131–5230 覆盖 5173。helper 的动态端口意图被 Vite config 固定端口覆盖；正确修复 seam 是白名单外 `scripts/business-ui-smoke-navigation.js` 或 `apps/desktop/vite.config.ts`，不得修改 Windows 排除范围、忽略失败或复用旧 smoke 结果。

## 当前：2026-08-14 恢复按钮与最新包已绿，真实 8/8 待立即复验

- **恢复入口源码阻断已解除**：新增 TDD 在修复前因目标恢复按钮判定函数缺失而红，最小实现后聚焦 `1/1 passed`，desktop typecheck exit 0；身份、精确店铺匹配与广告执行阻断均未放宽。
- **最新机器门与包身份**：业务 UI smoke 通过，证据 `output/codex-evidence/current-business-ui-smoke-1786688600259.json`；Renderer 为 `assets/index-iTiEtT3C.js` / `assets/index-CsHVBxxp.css`。`pnpm run build:win` exit 0；EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`、installer `1C908487291C047613DAE9F05EC5995790D2346236AABF81BB0E3493B82B09FD`、portable `8CD4BE2A7CBCAE351AC624D4D3C42CC4460394F6C114C0B7A7B180669310FB49`、folder ZIP `261B6D8E02DAEDB9A1F67332A5D51941F56095D181CB33E8B81C8CC24D4F1E66`、blockmap `A68AFCDA6F58842CB7E32BF7F2CD67E2FB2D23FE38CB3EC5799D5EE931BDC558`。
- **ZIP 门已通过**：新 folder ZIP 已真实解压启动，证据 `output/codex-evidence/folder-zip-launch-smoke-1786688906435.json`。上一节 `index-CC4xybyZ.js` 与 `00B8C4...` 包身份已经历史化，不代表当前产物。
- **当前即时业务门**：必须立即使用本包在正式应用复验完整 8 类采集；在取得 `8/8`、完成批次及导入证据前，测试、smoke、build 和 ZIP 启动都不能冒充业务完成。
- **全局门仍未完成**：Task 8B 正式广告写入继续为 0；具体 `lower_bid` 推荐、产品内人工审批和 before/after/reload 回读尚未同时成立。策略、运营任务、经营实验及全新 Package UI 也仍待验证，总体保持 `APP_NEEDS_WORK / NON_READY`，未标记 `APP_READY`。

## 当前：2026-08-14 采集修复与新包自动门已绿，待第二次真实 8/8

- **源码/自动门已解除**：本轮采集身份稳定化修复已按 TDD 完成；Main `browser-login-staged-status` `44/44`、Ads SSO `34/34`、visible collection adapter `24/24`、data collection Renderer `56/56` 均通过，desktop typecheck exit 0。业务 UI smoke 同样通过，证据 `output/codex-evidence/current-business-ui-smoke-1786687653507.json`。
- **最新构建已完成**：`pnpm run build:win` exit 0，Renderer 为 `assets/index-CC4xybyZ.js` / `assets/index-CsHVBxxp.css`；source native bindings 保持 `unchangedExact=true / sourceReadOnly=true`。当前 SHA-256 为 EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`、installer `00B8C4E3DE918D68221583A6CE69F79EE0733BBFAC2EF64E6F3277E5693CE1EE`、portable `295DBA4F002DF55CAACD02A98B1E75ABB0BAE1D009C70DDDB1F4FFE3B05AACBF`、folder ZIP `537F11DF173D170E7B3014D7C542B5156A88618574CF9ED429B384117857025F`、blockmap `39B222F9A436526F687092612DF40A55146C562E0570813E6F18E6C65041394E`。
- **当前即时业务阻断**：第二次正式应用真实 8 类采集尚未执行，因而尚无本包谱系下 `8/8`、完成批次及导入证据；机器测试、smoke 和 build 不能替代该业务结果。下方旧包哈希与旧阻断均保留为历史记录。
- **Task 8B 继续 fail-closed**：正式广告写入仍为 0；在具体 `lower_bid` 推荐、当前产品内人工审批及 before/after/reload 回读同时成立前不得执行。策略、运营任务、经营实验、全新 Package UI 也仍待后续真实闭环；总体保持 `APP_NEEDS_WORK / NON_READY`，未标记“开发完成”或 `APP_READY`。

## 当前：2026-08-14 连接门已闭合，下一门为真实 8/8 采集

- **真实连接恢复已通过**：最新 win-unpacked 已在正式 AppData 启动。首次 saved reconnect 精确因“未经本次凭证验证”fail-closed，并显示专用 `data-login-action="reset-lingxing-session"`；点击该目标应用动作后只重置当前店铺会话，广告账户映射与本机安全区密码保留。
- **免重输重连已通过**：随后点击 `data-login-action="reconnect-all"`，没有再次输入密码；最终 `.session-line[role=status]` 精确为 `ERP/Ads 已连接`，`alerts=[]`。因此 configured 店铺旧会话恢复不再是当前阻断。
- **当前业务阻断**：真实 8 类采集尚未在本次 ready 会话下取得 `8/8` 完成、批次和导入证据；下一步只推进该门。策略版本、运营任务、经营实验和绑定当前包哈希的全新 Package UI 均仍待后续验证，不能提前宣称完成。
- **Task 8B 不变**：尚无绑定正式 authority 的具体 `lower_bid` 推荐、产品内人工审批及 before/after/reload 回读；广告写入必须保持 0，总体仍为 `APP_NEEDS_WORK / NON_READY`。

## 当前：2026-08-14 新包与 ZIP 启动已通过，等待真实业务复验

- **构建阻断已解除**：configured 店铺安全重置与 Main-only 保存凭证恢复修复已进入最新 Windows 包；Renderer 为 `assets/index-w8-bAuxo.js` / `assets/index-CsHVBxxp.css`。`pnpm run build:win` exit 0，全部步骤 status 0，source native bindings 保持 `unchangedExact=true / sourceReadOnly=true`。
- **本轮包身份**：EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`；installer `601AF004D3ECAFFAC1E370EB60C3FEE8321C7403194503EF4E4862C084D6B0DD`；portable `2C638F6C82D5460BABF927CDD9EB8904187E947B9F6E1EE25625305020C1AA94`；folder ZIP `78297422CAAD69B5ECEB2C47E0EE694028FE50BD588BAED1504684E99F1927BF`；blockmap `2514B158DA57A9744CC2C81BB339B14A7E73EDEE181704FE199A6713148DE6FD`。
- **ZIP 门已闭合**：`pnpm run smoke:folder-zip-launch` exit 0；ZIP 311,651,062 bytes，SHA 与本节一致，解压 EXE 与 win-unpacked 精确匹配，主窗真实创建，临时进程停止且临时目录清理。证据 `output/codex-evidence/folder-zip-launch-smoke-1786685989543.json`。首次调用仅由外层工具 5 秒超时终止，不是产品或验收脚本失败；合理超时下同一验收通过，未改阈值。
- **当前仍未通过的门**：正式目标应用尚未用新包验证 saved 重置→ERP/Ads ready→8/8 采集；策略版本、运营任务与经营实验仍待真实闭环；全新 Package UI 仍须绑定上述当前包哈希重新生成。此前 13:19 的源码阻断已转为历史，不能用绿测、build 或 ZIP 启动代替这些运行时证据。
- **全局安全门不变**：Task 8B 仍缺绑定正式 authority 的具体 `lower_bid` 推荐、产品内人工审批及 before/after/reload 回读，广告写入必须保持 0；在 ZIP、真实业务、Package UI 与 Task 8B 闭合前仍为 `APP_NEEDS_WORK / NON_READY`。

## 当前：2026-08-14 13:19 真实采集被旧会话恢复缺口阻断

- **不是仍在测试登录**：操作者已在最新正常应用完成一次提交，目标应用真实达到 `ERP/Ads 已连接`。随后执行者仅在目标应用内进入报表采集并点击完整 8 类主动作；请求出现 busy/监控启动，但没有生成任务，页面仍为 `0/8`，顶部会话随即降级。
- **当前产品阻断**：Main 安全区已保存凭证可被页面识别，但完整重连遇到稳定身份的旧 ERP 会话时会报“当前领星会话身份未经本次凭证验证”；Renderer/Main 都只把重置授权限定在首次身份登记，已配置店铺反而没有安全恢复入口。这是确定性产品逻辑缺口，不是操作者未输入、Ads 店铺未匹配或继续等待能解决的问题。
- **下一步**：在允许的 Main/Renderer/login-test 文件内先红后绿，支持“精确同店、Main-only 已保存凭证、操作者显式授权”后仅清理当前店铺会话并重新可见登录；无授权、异店、身份变化仍阻断。重建后继续 8/8 真实采集。策略、运营任务和经营实验必须等待真实完成批次，当前不得冒充闭环。
- **源码修复已闭合，运行包尚未更新**：两条红测从 `2 failed / 8 skipped` 转为聚焦 `2/2 passed`；相关登录/凭证/SSO 为 `127/127 passed`、typecheck exit 0。saved 请求合同仍禁止携带 reset 字段；恢复权限来自应用内专用动作写入的当前店铺/相邻会话代次标记，异店、旧代次、未授权均不清会话。当前阻断已收窄为“重建最新包并在目标应用重走重置→保存凭证连接→8/8 采集”，尚无真实闭合结果。
- **安全边界**：未操控桌面或外部浏览器，不读取/代输密码、Cookie 或 Profile；本次真实 UI 尚未形成完成批次。应用仍打开期间不做可能误读 WAL 的正式库完成快照，广告身份/审批/回读门不放宽，Task 8B 仍无具体已批准动作。

## 历史：2026-08-14 13:12 验收未通过

- **正常业务链仍待一次操作者提交后才能继续**：最新 `release\win-unpacked` 已包含采集唯一窗口、运营任务 ASIN、“启动任务”文案、ERP 验证后 Ads 前安全保存凭证及 Renderer 失败回读修复；当前不是继续做登录测试。最新正常应用已重新打开在连接工作台，`记住密码=true` 且密码框已聚焦，只等待操作者本人首次输入密码并点击启动连接。执行者不读取、不代输密码/Cookie。提交前正式业务仍为 0 数据批次、0 启用策略版本、0 运营任务、0 经营实验、0 Ads 写入，故连接→8 类采集→策略→任务→实验的真实闭环尚无可声明的通过证据。
- **当前包只剩真实业务与全新 Package UI**：最后文案、“记住密码”Main 保存顺序和 Renderer 失败回读均已进入最新包；完整 staged suite `42/42` 与 typecheck 已绿。仍必须先完成真实业务链，再用全新 run group 完成 100%/125%/wide。`-69` 使用修前 runner/包合同，只能保留为历史失败，不得续跑、改名或晋升。
- **现有自动门已通过但不能代替真实业务**：任务书六文件 `124/124`、凭证/安全相关 `94/94`、最新 staged `42/42`、desktop typecheck、业务 smoke 6/6 子脚本与 7/7 流程均绿；当前 installer/portable/folder ZIP SHA-256 分别为 `48DB44067B971319D7C994E3802A1A7D03B0D28BA83A06147AD6E546DBC94E8B`、`10F7BEC1489D8CBEDDBF5D37F6E2C251235D01C1E171E385AB22634644B0D033`、`C020C8C59F382A3FE89D69671B4179BA6AEA5D51D5D6126CDED10AACDA9CCB91`；ZIP 真实启动证据为 `output/codex-evidence/folder-zip-launch-smoke-1786683755359.json`。这些只证明当前技术门，不证明正式库已有批次/版本/任务/实验。
- **全局 Task 8B 外部安全门**：当前仍没有绑定正式 authority 的具体、正向、单对象且产品内已批准 `lower_bid` 推荐；缺少 recommendationId/revision、目标对象、写前值、审批人/时间/范围及写后刷新回读。满足这些条件前广告写入必须保持 0，也不得标记 `APP_READY`。
- **版本可追溯阻断仍在**：大量既有脏工作树尚未形成选择性提交与推送。只能在真实业务、新包 Package UI 和最终安全核验完成后，选择性提交本任务获准源码/测试/文档；禁止提交 `output/`、`storage/`、Profile、正式库、报表、EXE 或 ZIP。
- 下方“运行包仍是旧包、两项修复均未进入运行包”的段落是本日较早历史，已由以上当前事实取代；其余下方内容继续仅作问题演进与证据保留。

## 历史：2026-08-14 较早验收状态

- **历史阻断（已进入当前包）**：旧运行包曾把产品数据库行号当 ASIN，导致运营任务无法保存；源码与最新 `win-unpacked` Renderer 均已改为使用规范化 ASIN。当前仍不能声称任务/实验闭环，原因是正式库尚无完成导入批次和启用策略版本。
- **当前 Package UI 阻断不是登录**：`-69` 已真实完成 ERP/Ads 连接，当前失败是定时任务 DOM 采集器定位了已废弃 aria-label；稳定 class selector 与缺失零值 attribute 的 fail-closed 修复已完成，旧 run group 不得晋升。须在上述真实业务源码重建后，用新包、新合同和全新 run group 重新验证 100%/125%/wide。
- **全局 Task 8B 外部安全门**：正式库只读查询确认 `action_recommendations` 当前为 0 行，因此不存在可执行或可批准的当前推荐。用户要求完成 Task 8B，但这不是某个具体广告动作的批准；目前缺 recommendationId/revision、店铺/产品/活动/广告组/真实实体、写前值与审批人/时间/范围。只有产品先生成一个当前、正向、单对象且非高风险的 `lower_bid` 推荐，并对该具体动作完成产品内人工审批后，才允许用人工 Ads UI 写入并采集 before/after/reload 三份不同证据。在此之前广告写入必须保持 0，也不得标记 `APP_READY`。
- **版本可追溯阻断**：当前工作树 120 项、0 staged，分支与上游仍同为 `e40861ad`。必须在新包 Package UI、新证据和 Task 8B 安全门完成后，选择性提交获准源码/测试/文档并推送；禁止把 `output/`、Profile、正式库、报表、EXE/ZIP 纳入提交。当前包由完整脏树构建，未形成提交前不得称为可复现交付。
- 下方记录均为历史证据。`operator-core-20260813-67` 仍可证明旧哈希技术链，但已降级为历史基线，不得晋升或复用为当前产品验收。

## 历史：Package UI 人工 handoff 阻断（已解除）

- 阻断审计已满足：连续多个目标回合都缺少同一个不可替代的外部动作——操作者本人在 schema-v8 的新鲜 100%-compact 目标应用窗口中直接输入并提交。源码、runner、包、正式库零写入、隔离 Profile、authority receipt 与文档均已完成可独立推进的收口；继续无人值守启动只会重复产生 preparation timeout，无法形成可信业务证据。因此当前目标按规则标记为 `BLOCKED`，恢复口令为“已在屏幕前”。
- runner 生命周期竞争已修并通过 195/195；随后 `-61`、`-62` 两个新鲜窗口均在 120 秒 preparation 内没有收到任何提交，未进入 ERP/Ads 授权，因而严格失败关闭。当前不再自动重开或空等；需要操作者在能立刻操作目标应用时明确回复“已在屏幕前”，再创建一个全新 run group。该动作仍只在目标应用内完成，执行者不读取/代输密码，也不操控桌面或其他应用。
- 人工输入来源阻断曾由用户在 `-60` 解除：该轮形成真实 `visible-user-handoff` 并完成全部 100%-compact 业务/弹窗/scheduler 采集；随后暴露的 2ms 生命周期通知顺序缺陷已经红→绿修复。旧 `-60` 因 runner contract 变化依法不能续跑或晋升，只保留为修前证据。
- 下一轮的安全准备已完成：全新 `-64` Profile 具备精确受保护 3-principal ACL、复制前后双重官方 verify、316/316 页只读 online backup 和新的 `SELECTED_SCHEMA_READY` authority receipt；run group/应用均尚未启动。因此现在唯一需要的外部动作是操作者明确就位并在目标应用首窗提交一次，后续 125%/wide 才可使用 Main 保存凭据。
- 历史预备编号 `-63` 因 `D:\Temp` 空目录无法收紧 ACL 而在 DB 复制前失败并已安全删除；未放宽 ACL 门，也未复用该编号，不构成当前产品阻断。
- 等待期间的只读复核没有发现新的产品或安全卡点：目标应用进程为 0，当前五个包身份与文档一致；正式库五张广告执行表仍全 0，immutable/query-only 查询前后 main/WAL/SHM/journal 全部未变化。因此当前阻断仍只是不应在操作者不在屏幕前时重复创建空正式 run。

## 历史：人工 handoff 与 `-59` 诊断

- 历史人工输入来源阻断已解除：正式 runner 没有导出其 `ElectronApplication/Page`，schema v8 仍硬断言 `visible-user-handoff / automationTypedSecrets=false / runnerTypesSecrets=false`；用户现已同意并实际直接输入，执行者未读取或代输秘密，故该门已诚信满足，不再列作当前阻断。
- 任务 1–4 与任务 5 的非 Package UI 门已闭合：指定六文件 `118/118`、Ads `69/69`、Readback/workspaces `101/101`、Package UI runner `195/195`、authority-currentness `2/2`、typecheck、7 条业务 UI flow、Windows build 和文件夹 ZIP 真实启动均通过。
- `-57` 已证明当前包中 ERP 与 Ads 的真实连接/动态店铺确认底层链成功：隔离库最终 `lingxing=ready / amazon_ads=ready`，五张广告执行表均为 0。它未转成通过 manifest 的唯一原因是 Ads Ready 回执比 120000ms authorization 截止晚约 3.5 秒；不是绑定失败、闪退或店铺匹配错误。
- 后续 `-58` 又因应用专用 CDP 端口在 preparation 窗内未建立而未提交。按“同一验收连败 3 次换项”已停止原样重跑；不允许强行 resume 已变更 Profile、改阈值或伪造 `automationTypedSecrets=false` 的 schema-v8 人工 fresh-typed 证明。
- 可接受的下一步只剩两种：操作者本人在新鲜 100%-compact 应用窗口中完成一次密码输入、勾选保存并提交，后续 125%/wide 可走 Main 管理的已保存凭据；或者由任务书所有者明确修改 schema-v8 的“人工 fresh-typed”验收语义并重建相应证据合同。当前不得修改阈值、伪造 handoff、复用失败 Profile 或把产品诊断包成 formal pass；在任一前提成立前保持 `APP_NEEDS_WORK / NON_READY`。
- 上述持续通道已以全新 `operator-core-20260813-59` 实施，但当前包该次未建立可用的 Renderer CDP 端点，因此未对应用输入/点击，runner 以 preparation timeout 结束。manifest `output/codex-evidence/package-ui-evidence/run-groups/operator-core-20260813-59/manifests/2026-08-13T07-00-48-735Z-2026-08-13T07-00-48-735Z-508cc247-b222-4a8b-b0ce-3b53138a5201.json` 为 `passed=false / RUN_FAILED`，console/page errors=0，窗口非意外关闭=false，Electron exit=0，进程清理为 0。因用户硬约束禁止桌面/电脑操控，又不允许伪造 schema-v8 的 fresh-typed/人工证据，该项现为真正 `BLOCKED`；不再空跑新 run group。

## 历史已解决：`-49` 首次 Ads 浏览器误闪退

- `operator-core-20260813-49` 未勾选会话重置即可启动，领星 ERP 已真实验证为 `ready`；9.6 秒后 Ads 阶段被 Main fail-closed 记录为 `VISIBLE_BROWSER_CLOSED`，与用户报告的“第一次闪退、第二次正常”一致。runner 随降级返回 preparation，最终在既定 5 分钟边界生成 `passed=false / resumable=true` attempt receipt；没有终态 manifest，也没有伪通过。
- 当前在白名单 Main/SSO 内补“ERP 成功后 Ads 可见窗口意外关闭”的精确红测并修窗口生命周期；必须保留 ERP ready、Ads blocked、执行写入 0，禁止通过延长等待、忽略关闭或放宽身份确认门来掩盖问题。此项不需要用户再次输入或确认。

## 历史：`-47` 已证明 Ads 连接成功，Package UI overlays 旧标签漏检已修复

- overlays 旧合同已按红→绿修复并由完整 runner/currentness `191/191 + 2/2` 证明；当前不再有已知源码/验收器红点。尚缺的是用新 runner 谱系跑出全新 Package UI 100%/125%/wide 通过 manifest，因此总体仍不得冒充 `APP_READY`。
- `-44` 的工作区卸载已由确定性红测证明为旧 active-view 查询覆盖较新 Main Authority 事件，不再是未定位疑点；监听器作废旧查询、bootstrap/retry 预留查询代次后，两个红点均转绿，相关集合 `41/41 passed`。
- 用户要求立即换项后，`operator-core-20260812-46` 在未提交、未进入 ERP/Ads、未写广告时由执行者主动结束；它不是产品失败。随后全新 `-47` 已真实提交并完成 ERP/Ads 连接与动态店铺确认，故 Ads 不再是当前卡点。
- `-47` 唯一失败是 Package UI overlays 仍按旧精确 tab 文案 `待判断（已载入 N）` 定位，30 秒找不到后严格停止；当前在允许脚本内补红→绿验收器合同，不需要用户输入，也不标记 blocked。身份、审批、回读及零写入门未放宽。

## 历史已解决：2026-08-12 `operator-core-20260812-44` 登录后工作区卸载

- Ads 连接问题已经关闭：本轮再次得到 `workspace-reached` 与 `operator-established-lingxing-connection-and-session`，不是登录失败、店铺选择失败或 Ads 待识别；当前 Windows 包连续两轮都能建立 ERP/Ads 真实连接。
- 唯一剩余正式门是 Package UI：点击“今日任务”后目标根节点一度可见，随后在稳定采样前消失；47 次采样均为 `rootVisible=false`，同时无 busy、导航 pending、console error 或 page error。失败 manifest 为 `output/codex-evidence/package-ui-evidence/run-groups/operator-core-20260812-44/manifests/2026-08-12T07-47-51-774Z-2026-08-12T07-47-51-773Z-7c83a255-d7c3-464f-a0ed-ff0396e8b6a8.json`。
- 只读代码链表明工作区会在 Store Gate 的 `authoritativeContext`/`activeStore` 暂时缺失时整体卸载，而登录后的异步 `store-context:changed` 是当前唯一与时间线吻合的替换路径；现有证据尚不能证明应忽略哪一种 Authority 变化，贸然保留旧上下文会违反店铺隔离优先级。因此不改安全门、不把短暂可见冒充稳定通过。
- 按用户要求不再围绕该点启动新的 Package UI 整轮。任务 1–4、128/128 连接回归、112/112 任务书测试、190/190 runner 测试、typecheck、Renderer build、7 条业务 smoke、Windows build 和文件夹 ZIP 启动均已有通过证据；总体仍必须标为 `APP_NEEDS_WORK / NON_READY`，只缺这一个 100%/125%/wide 正式 manifest。

## 置顶：2026-08-12 `operator-core-20260812-43` 响应式范围漏检

- 当前 Windows 包的 ERP/Ads 已在全新隔离 Profile 中真实连接成功；动态唯一店铺候选为运行时读取的 `JF-US`，人工确认后页面明确为“ERP/Ads 已连接”。此前 Ads 导航闪退/误降级不再是当前阻断。
- 正式 Package UI 仅在 100% compact 的 `settings/scheduler` 因 `SCHEDULER_FIXED_SCOPE_MISSING` 失败。截图真实可见“当前店铺 US / USD”，但 runner 只取页面第一个 `.mission-control-fixed-scope`；该节点在紧凑布局中隐藏，所以把可见生产适配范围漏读为空。
- 下一步只修改白名单内 `scripts/package-ui-evidence*`：新增修前必红合同，让采集器忽略隐藏副本，并核验所有可见的顶部/生产适配范围表示都一致为精确 `US`、`USD`；原 StoreContext、storeId、Main 回执、只读及零写入 validator 保留。总体仍为 `APP_NEEDS_WORK / NON_READY`，直到全新 run group 的 schema v8 manifest 通过。
- 上述采集器缺口已取得 `2 failed → 2 passed` 的聚焦红→绿；尚待完整 190 条 runner 回归及全新不可变 run group 实机 manifest，因此此处暂不移除阻断。

## 置顶：2026-08-12 14:08 当前交付状态（覆盖下方历史状态）

- Ads 连接本身已在全新 `operator-core-20260812-38` 再次真实闭环：本轮可见提交、ERP ready、首次 Ads 中断后的单独重试、动态唯一美国站候选、人工确认、Ads ready 全部成立；页面已显示“ERP/Ads 已连接”。当前不再把 Ads 识别列为阻断。
- Windows 新包、受保护历史的 Package UI 只读 fail-closed 投影及 20 秒 Electron 关闭边界均已进入产物；`-38` 没有卡死，418.8 秒内明确失败并写出 manifest。
- 当前唯一新阻断是 Package UI runner 的 scheduler 增量取证时序：真实 Main 审计总计含 3 次有效 workspace bootstrap、1 次 schedule read、1 次 retention read，且所有 run-now/start/reconcile/execute 为 0；但 runner 的 before 快照晚于最后一次 bootstrap，delta 错误得到 `workspaceQuery=0`，从而把本来完整的 US/USD/StoreContext/capability 证据排除在验证窗口外。
- 下一步只修白名单内 `scripts/package-ui-evidence*`：先补旧实现必红的时序合同，再让 scheduler 导航自身产生并消费新的真实 bootstrap；不删除或放宽任何 identity、capability、read-only、schedule/retention 或零写入断言。总体仍为 `APP_NEEDS_WORK / NON_READY`，直到全新 run group 的正式 manifest 通过。
- scheduler 取证时序源码修复已红→绿并通过完整 runner `187/187`；当前没有已知测试红点，但 Package UI runner 自身哈希已变化，必须按不可变谱系重建 Windows 包并用全新 `-39` receipt/Profile/run group 实测，旧 `-38` 不可续跑或改名为通过。
- `-39` 实机证明单纯切换工作区不产生新的 bootstrap，第一版时序修复无效；旧失败证据保留，未改 validator。当前改用“before ledger 后只读 reload Renderer”来强制真实 bootstrap，并将在正式第四轮前用隔离 Profile 做计数探针。按同一验收三连败规则，完成探针与源码绿测后先切换到任务书测试/业务 smoke/ZIP 等其他验收项，再返回 Package UI。
- 换项门已完成：runner 187/187、任务书 109/109、typecheck、7 流程业务 smoke 均绿。短只读实机探针证明 reload 真实新增 1 次 workspace bootstrap 且所有调度/广告写入为 0；当前可进入全新 `-40` 正式验收。总体在新 manifest 通过前仍为 `APP_NEEDS_WORK / NON_READY`。
- `-40` 仅因启动前发现一个 CIM 无法解析路径的短命日常 Chrome 而安全拒绝，产品未启动；该 PID 已自然退出且目标进程为 0。不修改或绕过 Chromium 隔离门，转用全新 `-41`。正式 Package UI manifest 仍是当前唯一交付阻断。
- `-41` 已证明 Ads 连接和 scheduler reload 主链均成功，所有调度/广告写入仍为 0；正式失败只剩验收器沿用旧店铺下拉框 DOM，以及 `textContent` 将相邻 `US`/`USD` 拼为 `USUSD`。该漏检已按红→绿修复且聚焦测试通过，但修改尚未进入 Windows 包；在全量测试、重建和全新 manifest 通过前，总体仍为 `APP_NEEDS_WORK / NON_READY`。

## 历史：2026-08-12 11:31 交付状态

- `-35` 的只读 inspector 返回 `LINEAGE_CHANGED`（`AUTHORITY_SELECTION_INVALID` / `AUTHORITY_BINDING_CHANGED`），未签发 resume receipt；不得绕过或继续该 run group。其检查器文件不在当前白名单。恢复正式 Package UI 只能新建全新 `-36` 并由操作者在新窗口实际手输提交。
- 当前唯一正式交付阻断是 `operator-core-20260812-35` 未发生操作者本轮输入/提交：300 秒内一直 preparation、attempts=[]、密码框为空、提交序号 0，最终严格 `interactive-timeout`；console/page errors=0，进程与 Profile 锁清理通过。这不是当前 Ads 代码失败，且旧 fresh-typed 证明不能替代新包正式 manifest。若继续，需要新建 `-36`（或只读 inspector 签发合法 resume receipt 后续跑 `-35`）并在窗口出现后由操作者本人实际输入提交；执行者仍不得读取/代填密码。
- 7 流程业务 smoke 首跑只在两个脚本的旧设置页 H1 期望上失败：产品/Package UI 已使用“店铺与运行设置”，`shell` 与 `settings-delivery` 仍等待“店铺连接与系统设置”。这是可在允许脚本内修正的验收漏同步，当前正在红→绿，尚不构成外部阻断。
- 当前新包已在复用认证的隔离 Profile 完成只读 100%/125%/wide 三档预检，三档各 10/10 工作区 runtime contract 全绿；此前 5 个首屏红点与导航滚动语义红点均已消失。该诊断仍不等同正式 Package UI manifest，最终证据链与其余交付命令未全部结束前结论保持 NON_READY。
- 已认证隔离 Profile 的只读 10 工作区预检曾精确发现 decisions 路由、execution/objects 主动作、settings 首屏、memory 滚动语义 5 个红点；产品级回归现已由 `5 failed` 转为 `62/62 passed`。这些问题不再是源码阻断，但尚未进入新的 Windows 包并完成 100%/125%/wide 实机复验，因此 Package UI 总门仍未闭合。
- Ads 连接已在 `operator-core-20260812-33` 真实闭环：本轮手输、ERP 验证、美国站动态唯一店铺候选、人工确认、Ads ready 全部成立；当前无 Ads 代码阻断。
- `-33` 的 Package UI 首档因授权后窗口从目标 `1200×700` 漂移到 `1200×938` 而严格失败；验收器已按红→绿修复为认证后重新退出全屏/最大化、恢复目标尺寸并使用原容差核验，完整 runner 测试 `185/185`。
- 只读 inspector 对旧 `-33` 返回 `LINEAGE_CHANGED / RUNNER_LINEAGE_DRIFT`，没有签发 resume receipt，故不得续跑或覆盖。当前唯一待办是用全新 `-34` Profile/run group 重新生成 100%/125%/wide 证据；schema v8 的首档仍需操作者再做一次本轮手输，不能用旧证明冒充。
- `-34` 已再次完成本轮手输与 Ads 连接，且授权后严格视口恢复已生效；下一 fail-closed 红点是紧凑高度下左侧导航确实滚动但未声明为显式 scroll owner。已在允许的 Mission Control shell 给真实 DOM 补可访问滚动区语义，聚焦测试通过；仍需 Renderer/Windows 重建与全新 Package UI 才能关闭，当前不能声明最终 manifest 通过。

## 置顶：2026-08-12 10:00 当前交付阻断（覆盖下方历史状态）

- `operator-core-20260812-32` 的 Ads 主连接已真实成功，不再被列为连接阻断；该轮未完成 Package UI 的原因是 Ads-only 重试错误覆写 ERP 原始凭据证据，造成产品状态与 schema v8 handoff 投影自相矛盾。已用新增红→绿测试修复源码并停止旧包归属进程；需要重建后的全新 Profile 验证，因此当前仍不能声明 Package UI 通过。

- 新包 `operator-core-20260812-31` 已由操作者完成新鲜手输，ERP ready、唯一 `确认 JF-US 并完成连接` 可用；确认时上一轮 45 秒 profile response 超时不再出现，证明可信 profile URL 刷新修复生效。下一红点为事务内 `StoreRepositoryError: Session generation 12 is older than 13`：`updateConnection` 首次写入 Ads external identity 时按通用“身份变更”规则先把 provider metadata 代际推进到 13，紧接着确认主链仍以活动可见 runtime/store context 的 12 写 ready metadata，事务因此回滚。隔离库事后仍为 Lingxing ready/12、Ads blocked/12，确认候选保留，真实广告执行未放行。
- 该缺陷仍在白名单 `index.ts/*login*.test.ts` 内可修，目标保持 active。修复必须是“仅限当前精确店铺、amazon_ads、尚未登记 external identity、一次性可信可见证据与 CAS revision 的首次登记”，使这次身份确认不被通用配置编辑路径错误地视为事后身份切换；已登记身份的任何变更仍必须推进代际、降级并阻断，不能改 StoreRepository 通用规则或绕过唯一索引。
- 新包 `-30` 已越过 suppressed-startup 门，但暴露下一可修复代码阻断：确认前在已经进入下载中心的页面二次调用 profile evidence，reload 不触发 `/get_profile_list`，45 秒后 `page.waitForResponse` 超时。上下文、fresh typed proof、唯一 JF-US 候选与人工确认入口均正常。该问题仍在白名单 `index.ts/*login*.test.ts` 内可修，目标保持 active；计划用 Main-only 首次 SSO profile URL 触发一次新鲜 profile-list 响应后再回下载中心，externalAccountId 与动态店铺别名双门不降级。
- suppressed-startup 代码缺陷已按红→绿修复并进入新 Windows 包：聚焦 1/1、完整连接/凭据 118/118、typecheck、Main/Renderer build、6/6 业务 smoke 与 Windows build 均通过；包内 Main 与 source 同为 `7567D8C6...EDE7`，旧矛盾条件为 0。当前不再存在可声明的代码阻断，下一步是全新 `-30` 隔离 Profile 的真实 Package UI 复验；`-29` 继续只作修前红证据。
- 2026-08-12 当前不再是外部输入阻断：`operator-core-20260811-29` 已得到本轮手输、ERP ready、唯一 Ads 店铺候选与新鲜证明。确认动作被代码内的 Package UI 启动状态矛盾阻断：初始化分支主动 suppress `startupReconcile`，故 MainRuntime 保持 `startup_unknown / startupRecoveryConfirmed=false`；后续 continuation guard 却要求 `startupRecoveryConfirmed=true`。受控断点同时证明上下文代际/业务日期一致、运行时存在、Lingxing verified、Ads pending、变更通道未占用/未 unknown。该缺陷可在白名单 `index.ts` 与 `*login*.test.ts` 内修复，目标保持 active；修复只能接受审计已证明的只读 suppressed-startup 状态，不得删除店铺唯一匹配、新鲜手输或人工确认门。
- 2026-08-12 用户已经回来并可输入，原“无人完成本轮手输证明”阻断已解除；全新 `-29` 隔离 Profile 与当前 authority receipt 均已安全创建，正在进入正式 Package UI。本条只恢复执行，不预判连接或最终 manifest 通过。
- 2026-08-12 同一“缺少操作者本轮手输密码与提交”的外部条件已连续三次目标回合复核：`-29` run group/Profile 仍不存在，应用/runner 为 0，正式库哈希与五张广告执行表零写入均未变化；全部无需密码的白名单工作已耗尽。目标依规则正式标记 blocked。用户回来后回复“我回来了，可以输入”即恢复，执行者创建全新 `-29` 并继续正式 manifest，不复用旧证据。
- 用户暂离期间已完成全部无需密码的最终当前性审计：当前五个交付文件哈希、Git/HEAD、正式库主文件/WAL/journal、五张广告执行表及进程清理状态均与最新通过证据一致；目标应用与 Package UI runner 均为 0。为避免伪造人工证明或再生成一个空等失败，没有启动新的 run group。
- 用户现场的 Ads 主链缺陷已在新包中真实关闭：隔离 Profile 自动完成 ERP→侧栏广告→Ads 下载中心→动态唯一店铺识别，机器快照只剩 enabled 的 `确认 JF-US 并完成连接`，不再同时显示“待识别”、禁用的“重试 Ads”或“重新连接”。对应红测先为 `1 failed / 25 skipped`，修后聚焦 1/1、完整连接 117/117、任务书六文件 109/109、typecheck、Renderer、7 条 smoke、Windows build 与 ZIP 启动均通过。
- 同一真实候选已在 1200×700@100%/125% 严格视口干净复测：DPR、内视口均精确，document/main 无横向溢出，唯一确认按钮完整可达、alert 为空；Package UI runner/currentness 186/186、skipped=0。该视觉与验收器证据仍不能替代正式新鲜登录 manifest。
- 当前唯一未闭合项不是 Ads 定位代码，而是正式 Package UI 的新鲜手输凭证确认及后续 100%/125%/wide manifest。诊断模式使用 Main 安全区托管凭证可以走到唯一候选，但按安全合同不能代替操作者本轮手输证明；执行者不得读取/代填密码，也不得放宽人工店铺确认门，因此仍不能宣称 `APP_READY`。
- 当前新包：win-unpacked EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`；app-content `4E4304A917F49BB065135C56DC46ECDF8BA67786643C0B61BF7CE03696EE880A`；installer `A385665361BD8F0ADE7DE2B29B331F0673E5FDCC459EA903364E5791278C1C31`；portable `FAF56F5237BA3897B816DDF592B3AB65DC765C3E19829CA1800E52C7624AAD76`；folder ZIP `AB3FBD02C5B78236BA2DFADFF0D3278B2E645838520EAF75FED53012402451F4`。正式库保持 `E8E05025...AE9`，五张 `ad_execution_*` 表全 0。
- 恢复动作：用户回来后只需明确“我回来了，可以输入”，执行者再创建已确认尚不存在的全新 `operator-core-20260811-29` run group/Profile 并把窗口置前；用户本人手输本次密码并提交，系统自动完成 Ads 识别后点击唯一的“确认 <店铺> 并完成连接”。不再做锁屏前置检查，也不设 60 秒/15 分钟空等建议；仍不复用旧 run group 或旧证据。
- 在该外部输入到位前，总体交付保持 `APP_NEEDS_WORK / NON_READY`；源码、构建、真实候选和 ZIP 启动通过不能冒充正式 Package UI 全量通过。
- 完成条件审计重读当前收据后确认 1366×768、7/7 流程和弹窗可达性均已有直接证据；但两个既有越界事实仍保留：`apps/desktop/src/renderer/pages/scheduler-page.tsx` 普通文案含 `UNKNOWN`，`apps/desktop/src/main/store-evidence-retention.test.ts` 有两处条件式 `context.skip()`。两文件都不在本任务写入白名单，本轮没有用 CSS 隐藏、删测或弱化断言规避；若硬约束按全仓绝对范围解释，它们也会阻止最终“全部完成”声明，需用户另行扩展写入范围。

## 历史：2026-08-11 早期交付阻断记录

- 当前唯一交付阻断仍是外部操作者输入：含导航连续性修复的新包已通过 116/116 连接回归、109/109 任务书六文件、typecheck、Renderer build、7 条业务 smoke、Windows build 与 ZIP 启动；但全新 `operator-core-20260811-28` 启动后密码框始终为空、启动按钮 disabled，随后只读 Windows 前台证据明确为 `LockApp`。本轮未提交、ERP/Ads 均为 `not_configured`，不能用它判断新连接修复成功或失败，总体仍为 `APP_NEEDS_WORK / NON_READY`。
- `-28` 已在锁屏证据成立后主动停止，匹配应用/runner/Profile 浏览器进程为 0；run group 只有 `run-group.json`、没有 manifest。隔离库和正式库五张 `ad_execution_*` 表均为 0，正式库主文件仍为 `E8E05025...AE9`。这是恢复 blocked audit 的第 2 次同类外部阻断；尚未达到三次标记 blocked 的门槛。
- 恢复动作：操作者解锁 Windows 后需保持在电脑前，并明确回复“已解锁并会立即输入，可开始 -29”；执行者届时创建全新 `operator-core-20260811-29` Profile/receipt/run group 并立即置前。操作者在窗口出现后输入密码、保留“记住密码”、不勾“重置旧会话”，点击一次“启动当前店铺连接”。不得 resume/改名复用 `-27/-28`，不得读取/代填密码或把旧包证据绑定到新包。
- `-25` 暴露的导航上下文/旧 Page 误降级缺陷已经按红→绿修复并进入新包：新增两条源码合同与三条行为回归，完整连接集合由 111 增至 116；只有明确 stale execution context 可有界重读，同隔离上下文只接管同 provider 可信替代页，`restartLogin`、ERP 页、关闭页与异源页仍不接受。需要下一次真实提交完成最终 Package UI 证明。
- `operator-core-20260811-25` 已越过原“无人提交/锁屏”阻断并暴露当前真实代码缺陷：ERP 已验证，Ads 可见窗口仍开着，但下载中心导航中的 `Execution context was destroyed` 被当作终态失败；随后旧 Page 的 `close` 事件又把仍有可信替代页的 amazon_ads 会话错误降级为 `VISIBLE_BROWSER_CLOSED`，导致“重试 Ads”被禁用。当前包因此仍为 `APP_NEEDS_WORK / NON_READY`，不得沿用旧 111/111 与启动证据宣称连接闭环。
- 本缺陷不需要外部授权即可继续修复，目标保持 active。允许范围内下一步为：新增导航上下文恢复和可信替代页接管的红测；修复后重跑连接测试/typecheck/build/业务 smoke/Windows 包/ZIP，再以全新 Profile 与 run group 做真实 Package UI。真正关闭全部可信 Ads 页、出现 `/restartLogin` 或异源页面时仍必须立即阻断；不能以“窗口存在”替代店铺唯一匹配与人工确认。
- 操作者已解锁并恢复目标，先前“锁屏下无法提交”阻断解除；全新 `-25` Profile 与 authority receipt 已用正式库 readonly online backup 创建，run group 尚未创建，当前正在进入真实 Package UI 验收。本条仅表示外部输入条件恢复，不预判连接或最终 manifest 通过。
- 三次连续目标回合 blocked audit 已满足：本回合再次实测 Windows 前台为“Windows 默认锁屏界面”，目标应用/runner 为 0，`-25` Profile/run group/receipt 均不存在；所有不依赖人工凭证的白名单内工作和当前性审计均已完成，没有可继续推进的安全项。目标已正式标记 `blocked`。恢复时操作者先解锁并回复“已解锁，可开始 -25”；恢复后的 blocked 计数重新开始，执行者创建全新 `-25`，绝不复用 `-23/-24`。
- 自动续接复核时 Windows 仍为锁屏，目标应用/runner 为 0；为避免生成第三份确定性的空等待失败，没有创建 `-25`。当前 package lineage、7 条业务 smoke、正式库主文件与广告零写入证据均重新核验通过，阻断仍只来自“锁屏下无法由操作者输入本次密码并提交”的外部条件。
- 当前源码与重建包已包含真实根因修复：不再在 Ads 首页寻找只存在于下载中心的店铺筛选器；初连、Ads-only 重试与身份确认均先经 ERP 侧栏进入 Ads，再导航下载中心，并使用运行时 `collectionStoreName` 对任意美国站店铺做唯一精确匹配。页面打开、profile 证据、店铺唯一选中和一次性人工确认仍是四层独立门，不因可见页面或手工选择而自动放行真实写入。
- 红→绿与集成证据已完成：新增下载中心顺序回归先为 `3 failed / 1 passed / 19 skipped`，修后为 `4 passed / 19 skipped`；完整连接/凭据 8 文件 `111/111 passed`、任务书六文件 `106/106 passed`、skipped=0；desktop typecheck、production Renderer build、7 条业务 smoke、Windows build 与 folder ZIP 启动均通过，包内 `s is not defined` 为 0。
- 当前包身份：installer `4884FC11034E27F3BFE494B65699BD71E4476D964C5C707F8AA75252468A3804`；portable `F4AD76539B03FC1F67F2A73CA355E9D6741462D880F5AA588EA18E3B6BFFE4F3`；folder ZIP `693D84E70A1B1EB942BAF0F68C1BA50F2B3F7E663CA425A5BBED1ABDF6126DC7`；app-content `21DC78BC5DE0074FBF46C6E1A8331D45EA2350C201B70DFD67D9949E796EE516`；Main `FB40F4FFD0C0EFC3A2CD0E949D7F476A2588623C792322A7CF6E1270AE1F377E`；Renderer `D1579379387A4F64D25E86C1C41AF17CE11F89B321DA0D3347780EEC435C10E0`；win-unpacked EXE `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`。
- 唯一未闭合门是当前包的真实 Package UI 100%/125%/wide 验收。全新 `operator-core-20260811-23` 在 900,000ms 内没有检测到操作者密码提交，故严格结束为 `passed=false`、`runs=0`、唯一 violation=`RUN_FAILED`；没有进入 authorization，也没有实际运行新连接链，不能据此宣称修复通过或失败。
- `-23` 失败 manifest：`output/codex-evidence/package-ui-evidence/run-groups/operator-core-20260811-23/manifests/2026-08-11T03-47-58-635Z-2026-08-11T03-47-58-635Z-48380bca-5e90-41b3-93dd-390cb3ee6d3f.json`。interaction/process/profile-lock/file-isolation/freshness 均通过，runner/目标应用已清理为 0。
- 正式库未被测试改写：manifest before/after 均为 1,294,336 bytes、mtime `2026-08-07T01:19:49.795Z`、SHA-256 `E8E05025B44DA23442B06603C187C728749EB022804198F0A4455C37B803EAE9`；逻辑快照 before/after 均为 `BAD4A5E7729F155D3267AFBE3C8BEEDB4998C3FC1F1E9FAA640703C047C9BB9C`；事后 readonly + `query_only=1` 查询五张 `ad_execution_*` 表全部为 0。
- 全新 `operator-core-20260811-24` 已在 900 秒等待后严格结束：整段期间 Windows 前台持续为“Windows 默认锁屏界面”，非敏感 UI 状态始终为“记住密码”已勾、“重置旧会话”未勾、启动按钮 disabled；runner 从 900 秒倒数到 7 秒均为 operator preparation，未发生提交或 authorization。manifest `output/codex-evidence/package-ui-evidence/run-groups/operator-core-20260811-24/manifests/2026-08-11T04-08-11-268Z-2026-08-11T04-08-11-267Z-18eaba08-ce7b-403b-9091-30a847ae5c14.json` 为 passed=false、runs=0、唯一 violation=`RUN_FAILED / preparation timeout`；interaction/process/profile-lock/file-isolation/freshness 全部通过，目标进程已清理为 0。
- 当前恢复条件：操作者先解锁 Windows，并明确能在新窗口出现后立即输入密码、保留“记住密码”、点击“启动当前店铺连接”；届时创建全新 `operator-core-20260811-25`，不得 resume/重命名 `-23/-24`。执行者不得读取、代填或打印密码/Cookie。在真实提交完成前，总体结论保持 `APP_NEEDS_WORK / NON_READY`。

## 置顶：2026-08-10 当前交付阻断（覆盖下方历史状态）

- 最新允许范围源码与新 Windows 包已完成：受影响面 34 files / 353 tests、Package UI runner/currentness 2 files / 186 tests 均全绿且 skipped=0；desktop typecheck、production renderer build、7 条业务 smoke、`build:win` 和文件夹 ZIP 启动均通过，`s is not defined` 为 0。
- 用户现场暴露的连接问题已形成红→绿修复并进入当前包：`main_managed` 凭证允许安全的 Ads-only 重试；登录开始后误点解绑显示中文原因与下一步；领星 Ads 公告按实际页数有界关闭；下载中心 FilterSelect 最多等待 10 秒，并按运行时 `collectionStoreName` 对任意美国站店铺做唯一精确匹配和回读，不写死 `JF-US`。
- 当前产物：installer `7970DE8AB867F28BDE26F55873698B61A5849BC05869B13B5BACACFC2C0A3458`；portable `38D1565A0434894BCFF0C7BB9B45C98E267B093753A2E81186044D0723DACCE2`；folder ZIP `28B663E9C3F8A81B1BA65301073910DA2AB42E6C63089F198AFEF83AD788803E`；app-content `550E7338D3D66BC98DC9B8810B3EEF5E99121A5B29BBAF28CBE4824B50CC248C`；Main `DAB0FC49A5BD762495B38A8429BD9C784983693D1C6E74E0E3FD182F5345F56F`；Renderer `A854D737B4C3233694A2B1858D66D7505E68BC65CD6541CF7BB1ACCC222AF266`。
- 当前主要未闭合项是新包 Package UI 的 100%/125%/wide 真实业务验收。全新 `operator-core-20260810-15` 已等待完整 900,000ms，但没有形成持久提交，严格失败为 preparation timeout；`runs=0`、未进入 authorization、未执行登录，因此不能据此判定 Ads 匹配修复成功或失败。
- `-15` 失败 manifest：`output/codex-evidence/package-ui-evidence/run-groups/operator-core-20260810-15/manifests/2026-08-10T04-21-25-572Z-2026-08-10T04-21-25-572Z-74d66780-f34c-4d57-9a91-1f76a59a06d9.json`。唯一 violation 为 `RUN_FAILED`；交互合同、Package/Profile 进程隔离、Profile 锁和数据库文件隔离全部通过，应用/runner 均已清理。
- 正式库保护通过：manifest 的 before/after 均为 1,294,336 bytes、mtime `2026-08-07T01:19:49.795Z`、SHA-256 `E8E05025B44DA23442B06603C187C728749EB022804198F0A4455C37B803EAE9`，`protectedDatabase.unchanged=true`；事后只读查询广告执行四表仍全部为 0。
- 恢复动作：仅当操作者能在窗口出现后当场输入领星密码、保留“记住密码”并点击“启动当前店铺连接”时，创建全新 `operator-core-20260810-16` 与全新 Profile；执行者不读取、代填或打印密码/Cookie，不 resume `-15`。
- 因完整 Package UI manifest 尚未通过，当前结论保持 `APP_NEEDS_WORK / NON_READY`；源码测试、业务 smoke、Windows 构建或 ZIP 启动均不能替代该门。
- 自动续接的逐项完成审计再次确认：活动 Package UI runner/目标应用为 0，`operator-core-20260810-16` 尚未创建；任务 1–4 的白名单内源码、测试与当前包证据无新增缺口。缺少操作者在可见窗口中的真实提交这一外部条件未变化，因此本轮没有空开新窗口或伪造第三份 timeout。
- 恢复后的第三次连续阻断审计仍为同一结果：`-16` run group/Profile 均不存在、活动目标进程为 0，无法在不读取/代填密码或伪造交互的前提下生成 Package UI 100%/125%/wide 证据。已达到 blocked 门槛并正式停止自动续接；操作者回复“开始 -16”即恢复，届时创建全新隔离 Profile 并由操作者本人完成可见提交。
- 2026-08-10 操作者已回复“开始 -16”，上述外部阻断解除，目标已恢复 active；当前正在创建全新 `operator-core-20260810-16` 隔离 Profile。本条仅解除“无人提交”阻断，不预判 Package UI 或 Ads 识别通过。
- 2026-08-10 完成条件审计另发现调度页普通文案仍裸露 `UNKNOWN`（`apps/desktop/src/renderer/pages/scheduler-page.tsx`，且现有 `scripts/smoke-business-ui-shell.js` 明确要求可见“UNKNOWN / 失败均人工核对”）。调度页不在本任务写入白名单，硬约束禁止越界修改；本轮只能记录，不能删除/弱化既有 smoke 断言。允许范围内 `mission-control/**` 的同类裸露继续按红→绿修复。
- 广义相关目录扫描另发现 `apps/desktop/src/main/store-evidence-retention.test.ts:156,183` 存在两处条件式 `context.skip()`；该文件工作树未修改且与 HEAD 相同，也不在本任务允许写入白名单。受影响验收实际运行的 34 文件 / 353 条与 Package UI 186 条均 `skipped=0`，但“全相关目录源码没有 `.skip/.todo`”无法在不越界的前提下声明完成；如要求清除，需新增该文件写权限并另做平台能力缺失时的确定性替代。

## 置顶：续接基线回归数字不符

- 2026-08-07 16:24 首次重跑任务书指定 6 文件得到 6 files 中 1 failed / 5 passed、89 tests 中 1 failed / 88 passed，低于当前记录的 89/89。
- 唯一失败：`apps/desktop/src/main/lingxing-ads-sso.test.ts > selectOnlyLingxingAdsStore > selects an arbitrary exact store alias in the current Lingxing FilterSelect DOM`，错误为 Vitest 5000ms timeout；其余 88 项通过，skipped=0。
- 当前先判为待诊断，不改超时阈值、不删/弱化断言。按任务书只做不受影响项，并用同一专项命令判断是 Chromium 资源抖动还是选择主链回退；绿证据形成前不得沿用旧 89/89 结论。
- 已复核解除该临时阻断：同一专项断言 1/1 通过（1.50s），完整 `lingxing-ads-sso.test.ts` 16/16 通过（2.89s），随后原始 6 文件命令 89/89 通过、skipped=0。没有修改 5000ms 阈值或任何业务断言；证据支持首次为并行 Chromium 启动抖动，不是选择主链回退。

## 当前状态

- 原“3/3 集成轮次已用满”阻断已由用户明确解除；目标已恢复 active，随后已分别执行全新 `operator-core-20260807-09/-10`，均未复用 `-08`。
- 领星新版店铺选择器阻断已解决：当前实现动态使用运行时 `collectionStoreName`，支持任意美国站店铺别名；旧 Element UI 与新版 FilterSelect 双路径均保留，只接受唯一精确别名，并在新版控件“确定”前后回读唯一选中态。真实领星下载中心已得到 `selectedControls=1`，当前店铺可见/选中标签均为 `JF-US 美国`。
- Package UI 提交观察器的源码缺陷也已修复：非敏感提交序号从 `key={store.authorityKey}` 子树提升到 `MissionControlRuntime`，按 storeId 隔离；authority 刷新不清零、切换店铺归零。新增红测由 1 failed / 182 skipped 转为 1 passed / 182 skipped，runner/currentness 完整回归 185/185。
- 修复已进入最新 Windows renderer bundle；新文件夹 ZIP SHA-256 `1F50BF6721BA61BC9B6598D24304A12F8C538464B33199B2046449E4C50B9FC3`，匹配的 folder ZIP 启动复核已通过，最新证据 `output/codex-evidence/folder-zip-launch-smoke-1786091436073.json`。
- 当前唯一未闭合项是最新包的 Package UI 100%/125%/wide 真实集成复验：历史 `-08` 仍是旧包失败证据，`-09/-10` 都只证明最新包可进入 100% 可见连接工作台，不能改名为通过。
- 新轮次 `operator-core-20260807-09` 的第一次 100% compact 已执行，但 300 秒等待期内没有发生提交：`phase=preparation`、`attempts=0`、`interactive-timeout`。attempt 自身标记 resumable，但下述只读 inspector 合同误报阻止生成合法续跑凭据；不得绕过。
- `-09` 的只读续跑检查被检查器自身的两个不可变合同差异阻断：它没有忽略已声明允许的 SHM 只读锁时间戳漂移，并把同一 Windows 正式库路径分别按反斜杠与正斜杠计算为 `6D8DE64D…` / `47B22453…`，导致 `AUTHORITY_SELECTION_INVALID` 与 `AUTHORITY_BINDING_CHANGED`。正式库主文件、逻辑 SHA、文件 ID、硬链接数与 SHM 内容均未变。
- 因缺少与最新包绑定的 Package UI manifest，总体候选仍为 `APP_NEEDS_WORK / NON_READY`，不是 `APP_READY`；安全身份、审批、回读和真实广告写入门均未放宽。
- `scripts/inspect-package-ui-run-group.js` 不在本任务写入白名单，当前不得修正或绕过；因此不再 resume `-09`。已改用全新 `-10` 验证该替代路径，但仍缺操作者在第一次可见窗口内的手工提交。
- `operator-core-20260807-10` 已按上述方案执行，窗口被恢复并成功置前，但 300 秒内仍没有连接提交；隔离库 ERP/Ads 均为 `not_configured`，不是提交后连接失败。新授权后同一外部输入条件已连续发生于 `-09/-10` 两次。
- 当前外部输入：操作者需在下一次新窗口出现后的 300 秒内输入领星密码、保留“记住密码”、勾选首次身份登记的旧会话重置授权并点击“启动当前店铺连接”。执行者不得读取或代填密码/Cookie；在操作者明确已就位前不启动第三个空等窗口。
- 用户解除上限后的新一轮阻断审计现已达到 3/3：最新仍只有 `-10` 的 1 个 `preparation / interactive-timeout / attempts=[]` 失败 attempt，没有 `-11`、活动应用或 runner。目标按规则转为 `blocked`。
- 唯一恢复条件：操作者明确回复“已准备好”并能在新窗口出现后 300 秒内手工输入领星密码、保留“记住密码”、勾选首次身份登记的旧会话重置授权并点击连接。恢复后必须新建 `operator-core-20260807-11`；执行者不得读取/代填密码或复用旧登录证据。

## 历史阻断记录（仅留证据，以上述当前状态为准）

- Package UI 已越过原 authority currentness、店铺导航与连接入口漏检，但当前阻断在 100% profile 的真实登录证明：`operator-core-20260807-04` 已选择现有店铺并进入生产“系统设置”连接工作台，console/page errors 均为 0；验收要求操作者在可见窗口内重新输入并保存凭证，使 ERP 与 Ads 都形成 fresh typed-and-saved 身份证明。任务环境明确“中途没人可问”，脚本也按安全设计不读取、不输入、不点击或保留凭证，因此 60 秒 preparation 阶段超时，`loginOutcome=interactive-timeout`，没有启动 125%/wide profile。
- 证据：`output/codex-evidence/package-ui-evidence/run-groups/operator-core-20260807-04/manifests/2026-08-07T03-41-15-402Z-2026-08-07T03-41-15-402Z-c98c817f-8305-4407-a9c3-dc703f59a26b.json`；attempt 的 process/profile/profile-lock isolation 全部通过，失败阶段为 `login`，未发生 console/page error。
- 下一步：由操作者在新隔离 Profile 的 100% 窗口中手工输入领星凭证并完成 Ads 身份确认，然后用原 run group 的 `--resume-run-group operator-core-20260807-04` 继续；不得把 saved-session、mock、旧截图或仅启动成功替代 fresh typed proof。
- 续接只读复核：run group 的 stored/current runner contract 一致，attempt 可恢复，lease 不存在，活动 runner/应用进程均为 0；固定 EXE/app-content、正式 authority 单硬链接和 WAL-aware 逻辑哈希全部仍匹配。阻断条件未因外部状态变化而解除。
- 连续审计：同一 fresh typed-and-saved ERP/Ads 身份门已连续三次确认，第三次仍只有原始 1 个 `interactive-timeout` attempt，无新登录、无活动 runner、无应用进程；目标已达到正式 blocked 条件。外部输入到位后可从该 run group 恢复，不需重做已完成项。
- 用户恢复后已新开 `operator-core-20260807-05`；操作者确认已提交连接，且 ERP 与 Ads 浏览器窗口都已打开，但 runner 在 300 秒内始终未识别到提交，失败 manifest 为 `output/codex-evidence/package-ui-evidence/run-groups/operator-core-20260807-05/manifests/2026-08-07T05-04-33-059Z-2026-08-07T05-04-33-059Z-078f767b-5bf8-45ce-a046-8de56fdf200f.json`。这不是操作者未提交，也不是已确认的凭证校验失败，而是提交开始信号漏检。
- 下一步：用红测复现“真实提交已发生但瞬时 aria-busy 未被轮询捕获”，增加不包含密码/Cookie 的持久提交序号，只将它用于启动严格的授权等待阶段；fresh typed-and-saved ERP/Ads 最终证明门保持不变。修复后重建 Windows 包、新建干净 run group 并复验。
- `operator-core-20260807-06` 证明提交漏检已解除，但暴露新的真实 Ads SSO 阻断：ERP 已连接，Ads 页面落到 `ads.lingxing.com/restartLogin`（页面明确要求从 ERP 进入），Ads 会话保持 blocked/`LOGIN_FAILED`，真实写入为 0。操作者截图显示窗口重试时闪退；代码中每次全量重试会先清理旧浏览器运行时，同时 `openLingxingAdsFromErp` 会被最先出现的 restartLogin 弹页提前判失败。
- 下一步：禁止用 Ads 直达 URL 绕过服务端 SSO；新增“先出现 restartLogin、随后同一 ERP 入口产生已认证 Ads 页”的回归红测，修正弹页竞速，只在可信 `ads.lingxing.com` 页面通过登录态与美国站身份读取后才把 Ads 标为 ready。然后重建并进行第 2 轮集成验收。
- 第 2 轮补充证据把当前卡点进一步收窄：Ads 登录页本身已打开并显示下载中心，但可见店铺为 `FT-US-US等2个店铺`，没有形成当前 `JF-US` 的唯一身份回读。当前安全门不得放宽；修复后界面应显示“Ads 页面已打开，店铺身份待识别”，并给出核对当前领星 Ads 店铺选择/重试 Ads 的下一步，而不是误报“页面未打开”。
- 未勾选首次身份登记重置授权时，Main 按设计拒绝复用旧会话并清理候选运行时；当前缺陷是 Renderer 仍允许启动，造成窗口闪退体验。可做项是在启动前把该显式授权纳入就绪门，不自动勾选、不绕过 Main 阻断。
- 已修复上述闪退入口与“页面已打开却显示未连接”的状态误报；第 3/3 轮真实剩余阻断是下载中心店铺选择器：Main 已进入已认证 Ads 页并读到 profile list，但 `selectOnlyLingxingAdsStore` 无法在当前下载中心 DOM 中唯一定位 `JF-US`，因此 Ads 只能保持待识别，不能标为 ready。下一代码项应在不放宽 exact alias 的前提下，为当前下载中心“搜索店铺”控件补真实 DOM 回归与唯一选择实现；若找不到或重复 JF-US 仍必须阻断。
- Package UI runner 同轮仍把真实提交记录成 preparation timeout：attempt receipt 为 `attempts=[]`，但截图和隔离库证明 Main 已在 06:17:26 完成 ERP ready / Ads blocked。下一代码项应让提交开始证据跨连接结果、Authority 刷新及可能的组件重建保持可观察，并补“提交后本地状态树重建仍进入 authorization”的红测；不得用延长超时、读取密码或跳过 fresh typed proof 修复。
- 已达到任务书最多 3 轮集成验收；不得启动第 4 轮或恢复 `operator-core-20260807-08`。当前交付结论固定为 `APP_NEEDS_WORK / NON_READY`，且最新 ZIP 尚无匹配的启动 smoke。
# 置顶：2026-08-12 `operator-core-20260812-42` 导航误降级

- 当前最终 Package UI 仍未通过。`-42` 已真实提交并得到 ERP ready，但 Ads 页面导航时的 `Execution context was destroyed` 没有在全部初连/重试读回点走 navigation-safe reader；随后 pending Ads 页的文档替换/换页被误判为 `VISIBLE_BROWSER_CLOSED`，可见 Ads 浏览器尚存却丢失 retry claim。
- 该问题可在任务白名单 `apps/desktop/src/main/{index.ts,lingxing-ads-sso.ts,*login*.test.ts,lingxing-ads-sso.test.ts}` 内继续修，不是外部输入阻断。安全边界保持：pending Ads 尚未获得写权限，短暂接管只接受同一隔离上下文内、同 provider、非 `restartLogin` 的可信页；verified Ads 关闭或身份变化仍立即阻断。
- `-42` 已停止且没有 manifest；不能沿用其 ERP 成功、窗口存在或旧 `-41` 的 scheduler 证据宣称 Package UI 完成。修复、测试、重建后必须使用全新 Profile/run group。
- 上述源码缺口已形成红→绿并通过 128/128 完整连接回归、112/112 任务书六文件与 typecheck；它不再是源码阻断。但尚未进入新的 Windows 包并完成全新 Package UI，故本阻断只在实包通过后才能移除。
# 当前阻断（2026-08-21）

- `product_targeting` 最新一次正式创建请求已由领星返回 `POST /ak_download/download_center/index/batch_create_report -> 200（操作成功）`，但当前列表精确回读仍未发现生成名 `AAO_20260806_20260819_product_targeting_050355`。创建接口失败已排除；需先修复并验证“填入精确名称后显式提交列表查询”的动作，再只读核对该名称，禁止在核对前重复创建。
- 同次 resume 后端已于 05:04:45 持久化 failed 并释放 claim，Renderer 在超过 65 秒后才从“恢复中...”回弹为“需人工核对”；当前已自行恢复，不列为持久阻断，但后续体验抽查需关注终态回弹耗时。
- “填名后显式提交查询”已进入新包并只读确认 `…050355` 不存在；该项排除了查询未提交造成的假阴性，但没有解除 8/8 阻断。
- 显式查询新包已确认 `…050355` 不存在；当前待重建验证的是“配置店铺必须唯一进入右侧已选列表”的提交前硬门。该门已通过 `16/16` 聚焦测试与 desktop typecheck，但未进包前 8/8 仍阻断。
- Main-only 热更新诊断运行时在 claim 前返回 `Main collection runtime safety state is unknown`；因其不是完整重建包，不把该错误记为产品回归。正式库 attempts/events 未增加，下一次验证必须使用完整 Windows 重建包。
- 完整包已证明创建前店铺移动后“待选 0 / 已选 0”，且明确未提交创建；当前实现改为从 `.el-checkbox__label` 精确读取店铺名，以排除整个 label 附加文本造成的假 0。新读取尚未进包复验，`product_targeting` 仍未完成。
- `.el-checkbox__label` 精确读取已加入 5 秒有界挂载等待并通过聚焦测试/typecheck，但尚未完整重建实测；因此仍不能继续到 `user_search_term` 或导入。
- 历史这条“未提交创建”已由窄恢复路径安全转为 confirmed_absent，后续同类错误落 `not_created`；正式任务当前已无 create_unknown，但仍有两类 `LINGXING_CREATE_STORE_NOT_SELECTED` 未完成。
- 历史误分类已在正式库安全恢复，任务已越过 create_unknown 并跑到第 8 类；当前两类失败的精确根因是领星右侧可见名 `JF-US-US` 与配置名 `JF-US` 的站点后缀差异。动态“店铺名-当前站点码”精确别名已 `17/17` + typecheck 通过，但尚未进入运行时复验。
- 原地恢复 `completed_with_errors` 的代码门已修复并通过定点测试/local-db typecheck，但尚未进入运行时；因此动态别名仍未真正提交两类报表。
- Main 双读恢复模型的同状态遗漏也已完成 `1 RED → 1 GREEN` 并通过 desktop typecheck；源码状态门已解除，当前只剩进入目标应用实跑并验证动态别名是否真实提交/下载两类报表，不能用定点测试替代 8/8/import 证据。
- Main-only 热更新运行时再次落入 sticky unknown，且重新连接未刷新 ERP/Ads 成功时间；它未取得 claim、未调用创建、未改变报表终态。当前改用完整 Windows 重建验证，避免继续把非交付热更新运行时的安全态误当成业务结论。
- 完整包已解除 sticky unknown 并重新验证 ERP/Ads，但 production composition 的第三处状态白名单在 MainRuntime CAS 前阻断；该缺口现已 `1 RED → 1 GREEN` + typecheck。当前仍需实跑证明 claim 与两报表下载，正式 8/8/import 尚未形成。
- 三道状态门、动态 `店铺名-站点码` 别名和真实创建提交均已实跑通过；attempt 11/12 都到达领星创建接口并收到 200，且 claim 均释放。`LINGXING_CREATE_STORE_NOT_SELECTED` 已不再复现。
- 当前唯一采集阻断是第二个商品投放新名 `AAO_20260806_20260819_product_targeting_064758` 在创建 200 后仍未形成可见列表行，任务保持 create_unknown、搜索词 queued。未经后续唯一核对禁止再次创建；8/8/import 因此外部阻断，整体继续 `APP_NEEDS_WORK / NON_READY`。
- 独立源码主链当前 `186/186 passed`、skipped=0 且 desktop typecheck 通过；这只能证明修复没有破坏续跑/解析合同，不能替代 `…064758` 的外部唯一回读、8/8/import、Package UI 或 Task 8B。
- Git 交付外部阻断：本地 `master` 已提交 `c26be721`，但 GitHub 443 连续三次连接失败（reset / connect timeout / reset），当前远端未同步。禁止宣称 push 完成；网络恢复后只需 `git push origin master`，无需重做源码或测试。
