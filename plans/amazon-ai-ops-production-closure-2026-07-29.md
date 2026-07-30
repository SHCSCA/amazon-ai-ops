# Amazon AI Ops 生产闭环计划（2026-07-29）

## 目标

以当前 Windows 包为冻结候选，在不伪造数据、不绕过人工登录与授权、不复用历史 READY 证据的前提下，完成：

1. 当前包的正式 Package UI 证据；
2. 唯一权威数据库的安全升级与两家真实美国站店铺配置；
3. 两店最近 7 个已完成美国业务日、每天 8 类领星报表的真实采集、导入与分析；
4. 人工审批和 policy-auto 两条真实 Amazon Ads v2 执行回读；
5. 八门生产就绪、READY bundle 与 READY safety。

任何门失败都保持 `APP_NEEDS_WORK` / `NON_READY`，不得把阶段成果描述为生产完成。

## 当前执行状态

- Stage 0 已完成只读选择：正式安装包 AppData 下的
  `C:\Users\wz\AppData\Roaming\@amazon-ai-ops\desktop\amazon-ai-ops.db`
  是唯一生产 authority DB；历史 `C:\Users\wz\AmazonAIOps\app-data\amazon-ai-ops.db`
  仅登记为非权威恢复候选。
- 当前 authority selection 回执：
  `output/codex-evidence/production-authority-selection-20260729-production-p2.json`；
  状态为 `SELECTED_MIGRATION_REQUIRED`，真实库仍未迁移。
- Stage 1 的旧 Package UI run group
  `production-p2-20df9d5b-20260729` 已固定为**历史证据，不得续跑**。首次 inspector 的
  `RESUME_SAFE` 结论已在独立审查后撤回：同名非 canonical 应用进程、完整 v8
  checkpoint、profile genesis/provenance 与 Windows hardlink 证明仍需按当前 runner
  合同重新验证；而后续 packaged 代码又必然改变包 lineage，因此禁止复用其 profile
  或 checkpoint。
- Stage 2 的离线演练工具已完成；`operate:s7-live-migration` 现在以 Windows Known
  Folder 的 canonical v0 DB、strict authority rerun、正式 Package UI evaluator、
  verifier 精确 19 checks、全同名进程零存量只读确认和 `FileShare.None` 为 approval 前置条件，
  并以持锁期间持久化的完整 intent 作为本地重放阻断证据。真实 authority DB 的
  v0→v9 启动迁移仍未获得用户明确批准。
- Stage 3–6 尚未形成生产信用：真实两店配置、7 个完成业务日、112 份报表、两条
  Ads canary、8/8 READY 都仍是待办。

## 冻结基线

- 包内容冻结 Git commit：`20df9d5bf8da9b4d2b6ef220f9bc9b444515dc50`。
  之后只允许增加不进入安装包的只读 operator/证据工具、测试和运行文档；这些提交会推进
  仓库 HEAD，但不得改变下列包哈希。
- win-unpacked EXE：
  `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`
- app content：
  `823D35F372D345A265F546F34556B1AB61831ADB2B9D36F3D9CCAB4C7836C962`
- Main bundle：
  `880A8A3034166EBADC00A5F9D2A5964C2C1380456FD60140EE4FC6618CCC8585`
- 已通过：package launch、package security boundaries、adversarial `NODE_ENV`。
- 下一步必须先集成并验证 packaged Main 启动时同名进程安全门、重建并冻结新包，再为
  新包创建全新的 Package UI v8 run group，完成 100% / 125% / 1400×900 三档；
  `production-p2-20df9d5b-20260729` 及当前旧包 run group 只保留为历史证据，禁止续跑。
- 尚未开始形成正式信用：两店 7 个业务日、manual canary、policy-auto canary、Mission Control 8/8。

冻结规则：

- 只读检查、证据导出、运行手册和本计划不改变包身份。
- 一旦修改任何被打包的应用代码、依赖、Main/Renderer bundle 或安装产物，必须重建，并从 Package UI 开始重新生成全部当前包证据；尚未完成的 7 日窗口也从新包首次有效日重新计算。
- 当前独立审查确认 packaged Main 启动时同名进程安全门仍是正式验收阻断依赖；仅允许
  完成该安全门、重建与证据刷新，不借此扩大其他产品功能范围。

## Stage 0：唯一权威运行环境

负责人：Codex 执行只读核验；用户确认真实业务身份。

时间窗口：15–30 分钟；该阶段只读，可与 Package UI 人工等待并行。

进入条件：

- 当前包及哈希仍与冻结基线一致；
- 当前权威库不得发生写入；
- 不启动默认 userData 的正式包，不触发迁移。

动作：

1. 明确列出两个已知数据库候选：
   - 正式安装包默认 AppData：
     `C:\Users\wz\AppData\Roaming\@amazon-ai-ops\desktop\amazon-ai-ops.db`
   - 历史/兼容候选：
     `C:\Users\wz\AmazonAIOps\app-data\amazon-ai-ops.db`
2. 通过当前 Main 的 `app.getPath('userData')` 合同、包 metadata、数据库 realpath、源 SHA-256、目录 sidecar 和 `storesRoot`，证明正式安装包应使用第一个路径；此阶段不为获取日志而启动默认 userData 的正式包。
3. 后续所有生产命令都显式传入该绝对 DB 路径，禁止依赖默认候选发现。
4. 第二个候选只做存在性、版本和 SHA 的只读登记，明确标记为非权威；不得跨库拼接店铺、任务、授权或 canary 证据。

退出条件：

- 形成唯一 authority DB 记录，包含绝对路径、realpath、SHA-256、版本、`storesRoot` 和非权威候选清单；
- 任一身份不确定时停止，不迁移、不采集、不执行 Ads。

## Stage 1：完成当前包 Package UI v8

负责人：用户完成凭证、MFA、验证码和授权；Codex 运行 secret-blind runner 并审核证据。

时间窗口：约 30–60 分钟，需用户在场。

进入条件：

- packaged 代码、runner 和包哈希冻结后，创建与该新包绑定的全新 run group；
- `production-p2-20df9d5b-20260729` 仅保留为历史诊断记录，禁止复用旧 profile、
  continuation cursor 或 checkpoint；
- 隔离 profile continuation cursor、包哈希和 protected live DB 均匹配；
- 首次失败 attempt 为 `resumable=true`。

动作：

1. 在 100% 档位重新输入领星密码、保留“记住密码”，确认领星绑定与 Amazon Ads Profile ID。
2. 用户只在独立 Playwright Chromium 中人工完成 MFA、验证码和授权。
3. 125% 与 wide 档位仍由用户在 Electron 主窗口触发登录；如浏览器再次要求授权，继续人工完成。
4. runner 只负责导航后的只读 UI 取证、哈希、隔离与清理，不读取、填写或保留密码、MFA、Cookie，不点击授权，不触发采集、审批、导出或 Ads 写入。

退出条件：

- 三档全部通过；
- 生成 v8 manifest、不可变 attempt receipts、PNG、诊断、进程清理和 protected DB 零变更证明；
- 基于该 manifest 生成当前包的 v15 final-readiness；此时只允许旧
  `real-ad-execution-readback` 一门保持失败，状态仍为 `APP_NEEDS_WORK`；
- cleanup 不能证明时停止并新建 profile/run group，禁止强制续跑。

## Stage 2：权威 DB 离线演练与当前包启动迁移

负责人：Codex 负责预检、演练和复核；用户明确批准真实库迁移并确认应用已退出。

时间窗口：约 30–60 分钟。

进入条件：

- Stage 0 唯一 authority DB 已确认；
- Package UI 已完成；
- 应用完全退出，源库不存在 `-wal`、`-shm`、`-journal`；
- 已记录源库原始 SHA-256，工作目录位于独立位置且空间充足。

动作：

1. 先运行 `migrate:s7-offline` dry-run；dry-run 不得在 live 目录落盘。
2. 对复制件运行 `--execute`，再运行
   `verify:s7-migration-backup-restore`，证明 v0→v9、完整性、FK、业务行保留和 pre-v9 恢复副本。
3. 不使用手工文件替换，也不新增一套与应用迁移逻辑竞争的 cutover 工具。
4. 先使用 `operate:s7-live-migration -- --prepare` 固化完整 approval payload：
   Windows Known Folder canonical DB 必须精确为 v0；strict authority selection 必须
   当前有效；独立 migration verifier 必须重跑并得到精确 19/19；Package UI v8 必须
   通过正式 evaluator 且 protected DB before/after 绑定当前 DB；任意路径的同名进程、
   无法解析的进程身份或 `FileShare.None` 失败都阻止继续。token 同时覆盖 safety 与
   instructions。
5. approval packet 与 launch receipt 必须写入两个显式、相互独立的
   `--recovery-root`；root/`--out` 不得与冻结包、app-content、canonical userData/DB/
   sidecar/Profile 或任一输入证据树重叠。root 必须由当前 Windows 用户拥有、关闭 ACL
   继承，且只允许当前用户/SYSTEM/Administrators 写入；高风险或未知主体写 ACE 直接
   阻断，最终文件、intent 和 `.s7-main-startup-gate` 目录/收据也复核严格
   owner/protected ACL，不能以 `0o600` 代替 Windows 证明。
   用户明确批准并提供 packet 的精确 token 后，
   使用 `--execute-approved` 启动冻结
   当前包一次，让现有事务化 migration 1–9 对唯一 live DB 执行正式升级。Windows helper
   连续持有 live DB 的 `FileShare.None`；Node 在锁内完成最终进程/sidecar/包身份复核及
   canonical userData intent 最终路径的直接 `wx` 创建、写入和同句柄 fsync；任何中途
   失败都保留该最终路径作为阻断证据。再由 helper 通过
   `CreateProcessW(CREATE_SUSPENDED)` 创建固定 EXE。由于 suspended process 的 WMI
   `ExecutablePath` 可为 null，helper 必须通过原生 process handle 的
   `QueryFullProcessImageNameW` 证明 image path；WMI 只负责同名 PID 集合。helper 在
   CreateProcess 前原子写 ACTIVE gate，在 suspended PID 已知后原子写 BOUND gate，
   精确绑定 PID/thread、EXE/Main/package、DB、intent、gate/invocation 及 file
   identity。Node 再在 release 前紧邻验证原生 image proof、ACTIVE/BOUND 和同名集合
   仅含该 PID；
   helper 收到 release 命令后、关闭 DB 句柄前还要独立重查唯一 PID 与原生 path，随后
   `ResumeThread` 返回值必须精确
   为 `1`。所有 helper 时间必须按 READY→SPAWNED→final inventory→release→RESUMED→CLOSED
   单调且不得超出 60 秒未来偏差。完整 intent 或 ACTIVE gate
   存在期间同一 packet 会被拒绝；删除或回滚属于证据完整性破坏，必须进入 `HOLD` 并
   重新取得 packet 与人工批准；本地管理员删除无法由脚本绝对检测。child env 固定
   APPDATA/USERPROFILE 并移除项目/Electron/Node/Vite/credential-like 覆盖项，只额外
   注入六个明确 startup-gate identity 变量。回执绑定
   `READY → INTENT → SPAWNED_SUSPENDED → ACTIVE/BOUND → PID/PROCESS_VERIFIED →
   RELEASED/RESUMED → ADMISSION/CLOSED`
   顺序及 pre-spawn/post-spawn/post-exit 三次包身份。
6. packaged Main 在任何 initSqlite/canonical DB open、浏览器和窗口前同步验证 ACTIVE/
   BOUND、自身 PID、canonical EXE/Main hash、DB、intent 与 gate identities；普通实例
   无 ACTIVE 时取得 Electron single-instance lock 后也必须二次检查，ACTIVE 存在时未获
   批准的实例 fail-before-DB。Main 只写一次 ADMISSION；helper 只在 child code 0 且 exact
   ADMISSION 通过后原子写 CLOSED。只有该链完整时，本次回执才可写
   `absoluteStartPrevention=true` 与 `packagedMainStartupSameNameGate=
   INTEGRATED_AND_PROVEN`；仍必须 `formalAcceptance=false`，并等待独立只读迁移验收。
7. 该工具不接受路径覆盖、不重试、不强杀、不回滚、不替换 DB；stdout/stderr 不进入
   回执。它不是 migration-only 启动，用户须在场。只有 exact ADMISSION/CLOSED 后才
   有界采集 post-exit 包身份、全同名进程和同一稳定 DB snapshot 的哈希/sidecar/schema；
   child exit/DB open/preflight 失败、receipt 缺失或未知状态保留 ACTIVE/BOUND 并进入
   HOLD；超时
   记录 `RUNNING_UNRESOLVED`，已创建但未 resume 的 suspended PID 进入人工恢复。发生
   launch attempt 后 `packageLaunched` 只能为已确认 `CONFIRMED_LAUNCHED` 或
   `UNKNOWN_AFTER_HANDOFF`，不能用 `false` 表示丢失/失败/超时的 RESUMED proof；package
   Ads 状态只能记录为 `UNKNOWN`。helper 错误 proof 只能作为有界 untrusted candidate
   保存；READY acquisition 即使未向调用方返回 handle，也必须保留 helper PID、script
   SHA、迟到 proof buffer、stdin close/unref 三态。child env 仅允许必要 Windows runtime
   和 locale 白名单，不继承 cookie/session/key/token/credential 或任意 sentinel。
   package CLOSED 后 helper-close 失败/超时时仍关闭 stdin 并 detach，不 kill。
   即使失败或超时进入 `HOLD`，也不得删除 intent、ACTIVE、BOUND 或 ADMISSION 后重试。
8. 迁移过程中不得强杀应用。异常时停止重复启动，保留源/备份/sidecar/日志/launch
   intent 与 startup-gate 全部收据，按
   `docs/S7_02_RECOVERY_RUNBOOK.md` 和 migration recovery preflight 处理。
9. 首次启动正常关闭、ADMISSION/CLOSED 精确绑定且 DB 到 v9 后仍先做独立只读验收：
   migration 1–9 为 `applied`、
   `integrity_check=ok`、FK=0、源业务行保留、v9 backup 绑定有效。启动回执固定为
   `passed=false` / `formalAcceptance=false`，不得作为 Stage 2 退出或 READY 证据。

退出条件：

- live authority DB 为 v9；
- 升级前 SHA、升级后 SHA、migration records、backup manifest、行数与恢复演练均可追溯；
- 任一校验失败进入 `RECOVERY_REQUIRED`，不得继续店铺配置。

## Stage 3：配置两家真实美国站店铺

负责人：用户提供并核对真实店铺/账号身份；Codex 核验隔离合同与数据库状态。

时间窗口：约 30–60 分钟，需用户在场。

进入条件：

- live DB v9 复核通过；
- 两家店铺均有可见领星和 Amazon Ads 登录权限。

每家店铺必须独立配置：

- 唯一 `store_id`；
- marketplace=`US`；
- currency=`USD`；
- business timezone=`America/Los_Angeles`；
- 不同 browser profile；
- 已在可见页面核验的领星店铺身份和 Amazon Ads Profile ID；
- 独立的采集、任务、建议、授权、执行和证据分区。

退出条件：

- 恰好两家 active US/USD 店铺被 Stage 8 只读诊断识别；
- profile、Ads Profile 或页面身份任何一项不一致时该店铺保持阻断；
- `UNKNOWN` 不允许通过改写配置或借用另一店会话绕过。

## Stage 4：最近 7 个已完成美国业务日

负责人：当前包调度与真实浏览器执行采集；Codex 每日审计；用户仅在会话失效时接力登录。

最短时间：7 个已完成的美国联邦业务日；缺失一天会延长窗口。

每天每店精确覆盖 8 类报告：

- `campaign`
- `ad_group`
- `placement`
- `advertised_product`
- `auto_targeting`
- `keyword`
- `product_targeting`
- `user_search_term`

验收量：

- 2 店 × 7 日 = 14 个成功 store-day；
- 14 × 8 = 112 个真实原始报表；
- 每份包含当前文件路径、尺寸、SHA-256、输入指纹、采集与导入 lineage。

运行规则：

- 应用无需在关闭后继续运行；允许有记录的正常重启，但不得缺失任何验收日的调度心跳、采集、导入和分析链。
- 会话失效进入可见人工登录接力；禁止自动填写凭证或 MFA。
- 合法零行报表与下载失败必须区分；缺失或失败不能伪装为成功。
- 每日只读运行 Stage 8 诊断和 coverage 检查，不提前导出最终 canary/readiness。

退出条件：

- 最近 7 个已完成美国业务日 14/14 store-day、112/112 报表均通过；
- 缺口只能通过后续真实业务日滚动补齐，不能补造历史证据。

## Stage 5：两条真实 Ads Canary

负责人：用户负责人工审批和 policy-auto 护栏启用；当前包执行；Codex核验回读。

时间窗口：约 30–60 分钟，需用户在场。

正式最小范围为两条 canary，且故意落在不同店铺，以证明店铺隔离：

### Canary A：Store A / manual approval

- 当前正向建议；
- 人工明确审批；
- 单个 `set_keyword_bid`；
- 仅降价，变化 `>0` 且 `<=10%`；
- 同一 recommendation/action/authority/grant/batch/job 因果链；
- 真实 before → write → after → reload，reload 必须等于 after。

### Canary B：Store B / policy-auto

- 与 Canary A 完全不同的 recommendation/action/authority/grant/batch/job；
- 策略只允许 Store B、一个明确对象、`set_keyword_bid` 降价；
- 最大变化 `10%`，最大动作数 `1`，有效期 `30` 分钟；
- 不允许动态增加对象；
- kill switch 必须为 off、breaker 必须 closed；
- 旧值预检不一致、身份不一致、超预算、超动作数或 `UNKNOWN` 时立即停止 Store B 车道；
- `post-intent / pre-readback` 不得自动重放，必须人工核对。

两条 canary 各需三张不同的真实 Amazon Ads v2 PNG：before、after、reload，最低
1200×700；截图必须绑定当前 authority snapshot 与 DB 事实，不接受手工填写业务结果。

退出条件：

- manual 与 policy-auto canary 均通过；
- 一家店的成功不解锁或替代另一家店；
- 任一失败不回退成功前缀、不自动重复疑似已写动作。

## Stage 6：最终快照、8/8、READY bundle

负责人：Codex 执行冻结和验证；用户确认不再进行业务写入。

时间窗口：canary 后 30–60 分钟；快照与 canary 的 72 小时有效期内完成。

动作：

1. canary 完成后正常关闭应用，live DB 停止变化。
2. 导出新的 v2 authority snapshot。
3. 使用同一 snapshot 依次生成：
   - continuous-operation evidence；
   - manual canary evidence；
   - policy-auto canary evidence。
4. 将 v15 final-readiness、package launch、Package UI、package security、
   adversarial `NODE_ENV`、continuous、manual、policy 全部绑定同一包身份和同一 live authority DB。
5. 运行 Mission Control production readiness。只有 8/8 才更新交付状态为
   `APP_READY`。
6. 新建 S7 READY bundle，再运行 READY safety；不得重命名或复用旧 NON_READY bundle。

退出条件：

- readiness 8/8；
- READY bundle 内容寻址、包哈希、authority DB/snapshot、两条 canary 和 112 份报表全部一致；
- READY safety 全部通过。

## 测试与提交纪律

- 不对外部等待阶段重复跑全量测试。
- 只有完成一个代码大阶段才运行聚焦测试、相关 typecheck 和审查，再 commit/push。
- 若发生任何被打包代码修改，代码冻结后运行一次完整回归、重建包并重跑全部 package gates。
- 证据失败先诊断原因；不得通过降低校验、改写数据库或编辑 JSON/PNG 让门通过。
- 不触碰用户已有脏文件；提交只包含当前阶段明确拥有的文件。

## 人工门

以下动作必须由用户完成或明确确认，Codex 不代替：

1. Package UI 的密码、验证码、MFA 与授权；
2. 唯一 live DB 正式迁移批准；
3. 两家真实店铺及 Ads Profile 身份确认；
4. manual canary 的明确审批；
5. policy-auto 护栏和 30 分钟 grant 的主动启用；
6. 最终快照前停止业务写入。

除这些人工门和至少 7 个真实业务日的时间门外，其余检查、证据生成、审计、修复、提交与推送由 Codex 持续推进。
