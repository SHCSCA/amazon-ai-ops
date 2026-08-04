# S7-02 数据升级与恢复手册

## 安全边界

- 所有操作必须在 Amazon AI Ops 完全退出后进行；源库旁存在 `-wal` 或 `-shm` 时脚本会拒绝继续。
- 脚本不再自动查找 `%APPDATA%`，也不会原地升级真实用户库。必须显式提供绝对源路径、源文件 SHA-256 和独立工作目录。
- 升级、回读和恢复都发生在工作目录的复制件中。恢复只发布到新文件，不覆盖源库、备份或既有目标。
- 浏览器 Profile 含 Cookie。迁移只允许一个物理源绑定一个店铺、一个 provider；身份不明确、浏览器未确认停止、目标非空或路径含 junction/symlink 时全部停止。
- 证据 JSON 可以记录本地路径和业务表计数，不得写入密码、Cookie、Token 或表内容。

## 先选择唯一生产库

离线迁移前先运行只读 authority 预检。它只接受当前包
`@amazon-ai-ops/desktop` 对应的 `%APPDATA%` userData，并会把
`%USERPROFILE%\AmazonAIOps\app-data` 等历史候选登记为非权威库：

```powershell
$userData = Join-Path $env:APPDATA '@amazon-ai-ops\desktop'
$sourceDb = Join-Path $userData 'amazon-ai-ops.db'
$sourceSha = (Get-FileHash -LiteralPath $sourceDb -Algorithm SHA256).Hash

pnpm run verify:s7-authority-selection -- `
  --db $sourceDb `
  --expected-user-data-dir $userData `
  --expected-main-sha256 $sourceSha
```

预检使用一次 WAL-aware 只读在线备份识别逻辑状态；主文件 SHA 与逻辑备份 SHA
是不同字段。存在 sidecar 时只会返回 `offlineMigrationEligible=false`，不得手工删除
sidecar。关闭应用并确认 sidecar 自然收束后，必须重新计算源主文件 SHA，再进入下方
离线升级。执行模式会用 Windows `FileShare.None` 从源 DB 取得连续排他句柄，
从同一句柄计算 SHA 并创建工作副本；该句柄一直保持到临时 manifest 完整写入、
`fsync`、关闭，并在同目录排他 hard-link 为最终文件之后。应用仍持有数据库、
WAL/SHM/journal 出现、源路径/目录身份变化、hard-link 数不为 1 或最终证据名已存在
都会拒绝继续，且不得以手工删除 sidecar 的方式绕过。

这把锁用于防止正常 Electron/SQLite 在迁移期间误重启，不是对同一 Windows 用户下
恶意进程的安全边界；工作目录应放在仅当前操作者可写的位置。失败最多保留需人工
清理的非最终工作文件，不得把临时 manifest 当成成功证据。

完整合同见 `docs/S7_03_AUTHORITY_SELECTION.md`。以下三个 CLI 均支持无副作用帮助：

```powershell
pnpm run verify:s7-authority-selection -- --help
pnpm run migrate:s7-offline -- --help
pnpm run verify:s7-live-migration-acceptance -- --help
pnpm run operate:s7-live-migration -- --help
```

## DB 离线升级

先关闭应用并计算源库哈希。以下路径仅为示例，工作目录应位于有足够空间的 D 盘隔离目录：

```powershell
$sourceDb = 'C:\Users\operator\AppData\Roaming\@amazon-ai-ops\desktop\amazon-ai-ops.db'
$sourceSha = (Get-FileHash -LiteralPath $sourceDb -Algorithm SHA256).Hash
$workDir = 'D:\amazon-ai-ops-recovery\2026-07-23'
$manifest = Join-Path $workDir 's7-offline-upgrade.json'

# 只读预检；不会创建工作目录或修改文件。
pnpm run migrate:s7-offline -- `
  --db $sourceDb `
  --expected-sha256 $sourceSha `
  --work-dir $workDir

# 明确执行：仅复制并升级工作副本。
pnpm run migrate:s7-offline -- `
  --db $sourceDb `
  --expected-sha256 $sourceSha `
  --work-dir $workDir `
  --out $manifest `
  --execute

# 独立复核升级库、v9 backup 绑定和 pre-v9 恢复副本。
pnpm run verify:s7-migration-backup-restore -- --manifest $manifest
```

成功证据必须同时证明：

- `offlineLease.method=windows-file-share-none`，并绑定源句柄 file identity、源/副本 SHA
  与 `lockHeldThroughFinalPublish=true`；
- 源 SHA 与操作者提供值一致，源库 `integrity_check=ok`；
- migration 1–9 全部为 `applied`，升级库 FK 检查为零；
- migration 1 新执行记录 checksum `store-authority-v1-20260727-03`；历史 `store-authority-v1-20260722-02`
  仅允许已应用记录只读兼容，或在 `started` / `failed` 且原始 bound backup 可复核时提升，并在 manifest
  保留 legacy checksum、原状态、原开始时间和提升时间；
- v9 manifest 绑定升级前版本、Schema 指纹、逐表行数、backup SHA 和完整性；
- 源业务表行数没有减少；
- 恢复副本的版本、逐表行数、Schema 指纹、完整性和 SHA 均回到升级前快照；
- 源库哈希在整个流程中保持不变。

## 用户批准后的真实迁移验收时序

真实 authority DB 的迁移不是离线演练的自动后续步骤。必须严格按以下顺序执行：

1. 在真实库仍是迁移前版本且应用已完全退出时，使用
   `verify:s7-authority-selection --export --out <绝对新文件>` 固化
   `production-authority-selection-preflight/v1`。该证据的 selected main SHA 必须绑定
   随后的 offline manifest `source.sha256`。
2. 完成上节的离线副本升级，并把
   `verify:s7-migration-backup-restore --manifest <绝对路径> --out <绝对新文件>`
   生成的通过结果交给用户复核。此时仍不得迁移真实库。
3. 先由 Windows-only 的 `operate:s7-live-migration -- --prepare` 做一次只读复核并
   生成不可覆盖的 approval packet。它只接受 Windows Known Folder 解析得到的
   `%APPDATA%\@amazon-ai-ops\desktop\amazon-ai-ops.db`，且 live schema 必须精确为
   v0；v1–v8 一律进入恢复处理。准备阶段会重新执行 strict authority selection 和
   `verifyS7MigrationBackupRestore`，要求官方 verifier 的 19 个 check code 精确、
   无重复且全部通过；同时调用正式 Package UI v8 完整性 evaluator，并把
   `protectedDatabase.before/after` 绑定到当前 live DB 的路径、SHA、大小和 mtime。
4. 准备阶段还会对任意路径下所有同名 `AmazonAIOpsAgent.exe` 做零存量只读确认；
   存在进程、查询失败或身份无法解析都会阻断，工具不会自动清理或结束进程。随后取得
   Windows `FileShare.None` 只读独占证明。packet 绑定 live DB 的
   同句柄 SHA/identity、无 sidecar、authority-selection、offline
   migration/verification、冻结包 EXE/app-content/Main 三项身份和 Package UI
   manifest；confirmation token 覆盖 packet 的完整不可变 approval payload，包括
   safety 与 instructions。它不启动应用、不迁移 DB，也不调用 Ads。
5. approval packet 和 launch receipt 必须分别写入显式的 `--recovery-root`。两个 root
   都必须是已存在、无 reparse/junction 的独立目录，不能位于冻结包目录、app-content、
   canonical userData/DB/sidecar/Profile 或任何输入证据所在目录树，也不能包含这些目录。
   建议把只读输入、approval 输出和 launch 输出放在三个并列目录；`--out` 必须位于对应
   root 内且不存在。每个 root 还必须由当前 Windows 用户拥有、关闭 ACL 继承，只允许
   当前用户、SYSTEM 和 Administrators 写入；Everyone、Authenticated Users、Users、
   Guests、Anonymous 或其他未知主体的允许写 ACE 会 fail-closed。最终 packet/receipt
   文件也会复核 owner 与有效 ACL。intent 与 `.s7-main-startup-gate` 目录首次创建时
   建立相同的受保护 ACL，已存在目录则只验证、不静默修复；intent 和 startup-gate
   收据文件自身也必须关闭 ACL 继承，并精确只允许当前用户、SYSTEM、Administrators。
   POSIX `0o600` 不是 Windows ACL 证明。这样回执写入不会改变已经核验的包身份或输入
   证据树。
6. **只有用户明确批准真实迁移后**，才可使用该 packet 中的精确 confirmation token
   运行 `--execute-approved`。执行器会重新完成上述所有检查，再由 Windows helper
   连续持有 live DB 的 `FileShare.None` 句柄。在句柄仍持有时，Node 完成最终同名进程、
   sidecar、包身份复核及 canonical userData 下
   `.s7-live-migration-launch-intents\<approval-payload-sha>.intent.json` 的直接
   `wx` 创建、完整写入及同一最终文件句柄 `fsync`；intent 不经过临时文件或 hardlink。
   从最终路径创建开始的任何写入、fsync 或 close 失败都保留零长度、部分或完整文件作为
   阻断证据，不得自动删除。随后 helper 使用 `CreateProcessW(CREATE_SUSPENDED)` 创建固定
   canonical EXE。Windows 对 suspended process 的 WMI `ExecutablePath` 可返回 null，
   因此 helper 必须用其原生 process handle 调用 `QueryFullProcessImageNameW` 生成
   `queriedExecutablePath` proof；不得把 WMI path 当成启动依据。helper 在
   `CreateProcessW` 前先以 `CreateNew`、同句柄 flush 和严格 ACL 写入
   `.s7-main-startup-gate\ACTIVE.json`；创建 suspended child 后，再原子创建
   `BOUND.json`，把 approved PID/thread、EXE/Main/package、live DB、intent、gate ID
   和 invocation ID 绑定到 ACTIVE 的真实 file identity。ACTIVE/BOUND 任一已存在、
   替换、hardlink、reparse、owner/ACL 不匹配都会保留现场并进入 `HOLD`。Node 再紧邻
   release 命令重新验证原生 image proof、ACTIVE/BOUND identity 和同名 PID 集合只有该
   suspended PID；helper 收到命令后还会在关闭 DB 句柄前再次做同名 PID WMI 清单，并用
   原生 handle 重查 image path，只允许唯一 PID 且路径匹配，然后才调用
   `ResumeThread`，且其返回值必须精确为 `1`。`READY/SPAWNED/final inventory/release/
   RESUMED/CLOSED` 时间必须单调，且不得超过允许的 60 秒时钟偏差。回执保存
   `READY → INTENT_PERSISTED → SPAWNED_SUSPENDED → STARTUP_GATE_ACTIVE_AND_BOUND →
   PID/PROCESS_VERIFIED → DB_RELEASED_AND_PROCESS_RESUMED →
   MAIN_ADMISSION_AND_HELPER_CLOSED_BOUND` 顺序，普通 `spawn` 不得绕过。完整 intent 或
   ACTIVE gate 存在期间，同一 packet 会被拒绝；删除或回滚属于证据完整性破坏，必须保持
   `HOLD`，重新生成 packet 并取得新的人工批准；本地管理员删除无法由该脚本绝对检测。
7. packaged Main 在任何 `initSqlite`、canonical DB open、浏览器运行时和窗口创建之前，
   同步检查 canonical ACTIVE/BOUND。无 ACTIVE 时普通实例仍必须取得 Electron
   single-instance lock，并在取得后再次检查 ACTIVE；ACTIVE 存在时，只有 gate env、
   自身 PID、canonical EXE/Main hash、DB、intent、gate/invocation 和 file identity
   全部匹配的 approved child 可在取得 lock 后再次全量复核并继续。其他实例在 DB 前退出。
   `requestSingleInstanceLock` 是第二道门，不替代 ACTIVE/BOUND。Package UI/launch-smoke
   evidence userData 只允许既有隔离 profile，不能携带 gate authority，也不会读取
   canonical gate/DB。Main 随后以 `CreateNew` + 同句柄 flush 写且只写一次
   `ADMISSION.json`；helper 只有在 child 确实以 code 0 退出、ADMISSION ACL/owner 和
   ACTIVE/BOUND/exe/Main/DB/intent 精确绑定全部通过后，才原子写 `CLOSED.json` 并发出
   `CLOSED` proof。child 非零退出、DB/Main preflight 失败、receipt 缺失/漂移或 helper
   状态未知都保留 ACTIVE/BOUND/可能存在的 ADMISSION 并进入 `HOLD`，绝不自动删除、
   闭合或重试。
8. 执行器只启动固定 `win-unpacked\AmazonAIOpsAgent.exe`，不接受 `--db`/`--exe`
   覆盖；child env 会移除项目、Electron、Node、Vite、readiness、portable 和
   credential-like 覆盖项，并把 `APPDATA` / `USERPROFILE` 固定到 Windows Known
   Folder。child env 不再复制任意“看起来安全”的变量，只允许 SystemRoot/WINDIR/
   ComSpec/PATH/PATHEXT/TEMP/TMP/PSModulePath、必要处理器/OS 字段和明确 locale 字段；
   仅另加 helper 在 ACTIVE 创建后明确注入、随后从 helper 清除的六个 startup-gate
   identity 变量；cookie/session/key/token/credential 及随机未知变量一律不继承。它必须观察 suspended
   create、resume 和真实 process close，并在
   pre-spawn、post-spawn、post-exit 三次绑定冻结包身份；stdout/stderr 不采集、不持久化。
   只有 helper 已验证 code 0 和 exact ADMISSION 并写入 CLOSED receipt 后，operator 才把
   close 当成受信事件并有界收集 post-exit 包三身份、全同名进程及同一稳定 DB snapshot
   的主文件哈希/sidecar/schema；否则直接保持 ACTIVE/HOLD。若已观察受信 package
   `CLOSED` 但 helper close 超时或失败，operator 仍关闭 helper
   stdin 并 unref/detach；只有 package close 和 helper 正常 close 都确认时才跳过清理。
   全程不 kill、不重试。helper `ERROR` 或丢失的 proof 只作为有界
   `UNTRUSTED_CANDIDATE_ONLY` 保存 PID、helper PID、phase、create/resume、DB handle 和
   release state，不能据此做成功判定。即使 READY acquisition 超时、调用方没有拿到
   helper handle，也必须保存 helper PID、helper script SHA、迟到 proof buffer 以及
   stdin close/unref 三态；`CLOSE_REQUESTED`、`CLOSE_FAILED`、`UNKNOWN` 不得简化成
   `helperInputClosed=true`。超时只记录 `RUNNING_UNRESOLVED` 并解除 operator
   引用，不强杀、不重试、不自动 rollback、不替换 DB。若 suspended PID 已创建但未确认
   resume，则保留现场并明确要求人工恢复。
9. 正常包会打开主窗口及 monitor，因此这不是 migration-only 命令：用户必须在场，
   且要在没有生产店铺会话/运行进程的 v0 停机条件下执行。只要发生过 launch attempt，
   `packageLaunched` 就是三态：handoff 前为 `NOT_LAUNCHED`，只有通过受信
   `RESUMED` proof 后才是 `CONFIRMED_LAUNCHED`，handoff 后 proof 失败、丢失或超时时
   必须是 `UNKNOWN_AFTER_HANDOFF`，不得写成 `false`。package Ads 状态仍是 `UNKNOWN`，
   不能据此声称未执行 Ads；operator 自身只证明没有直接调用 Ads。
10. 该包正常关闭、exact ADMISSION/CLOSED 链通过且 DB 到 v9 后，
   `packagedMainStartupSameNameGate` 才可记录为 `INTEGRATED_AND_PROVEN`；这只证明本次
   受控启动的 TOCTOU gate，不代表迁移验收、业务恢复或 READY。启动回执仍为
   `LAUNCHED_AWAITING_READONLY_ACCEPTANCE`、`passed=false`、
   `formalAcceptance=false`。必须在恢复调度、店铺配置或任何 Ads 执行前单独运行下方
   只读验收；启动回执不是验收通过，也不代表 Stage 3 或 READY。

```powershell
$inputRoot = 'D:\amazon-ai-ops-recovery\2026-07-29\inputs'
$approvalRoot = 'D:\amazon-ai-ops-recovery\2026-07-29\approval-output'
$launchRoot = 'D:\amazon-ai-ops-recovery\2026-07-29\launch-output'
$acceptanceRoot = 'D:\amazon-ai-ops-recovery\2026-07-29\acceptance-output'
$finalizationRoot = 'D:\amazon-ai-ops-recovery\2026-07-29\finalization-output'
$authoritySelection = Join-Path $inputRoot 'authority-selection.json'
$migrationManifest = Join-Path $inputRoot 's7-offline-upgrade.json'
$migrationVerification = Join-Path $inputRoot 's7-migration-verification.json'
$packageUiManifest = Join-Path $inputRoot 'package-ui-v8-manifest.json'
$approvalPacket = Join-Path $approvalRoot 'live-migration-approval.json'
$launchReceipt = Join-Path $launchRoot 'live-migration-launch.json'
$liveAcceptance = Join-Path $acceptanceRoot 's7-live-migration-acceptance.json'
$finalizationPacket = Join-Path $finalizationRoot 's7-finalization-approval.json'

# 五个 root 必须预先创建，且彼此、冻结包、canonical userData 和其他输入树不重叠。
# 仅只读复核 + 生成不可覆盖批准包。此命令不是用户批准本身。
pnpm run operate:s7-live-migration -- --prepare `
  --db $sourceDb `
  --authority-selection $authoritySelection `
  --migration-manifest $migrationManifest `
  --migration-verification $migrationVerification `
  --package-ui-manifest $packageUiManifest `
  --recovery-root $approvalRoot `
  --out $approvalPacket

# 由用户查看 packet 后，精确复制其 confirmation.token；启动一次后不得自动重跑。
pnpm run operate:s7-live-migration -- --execute-approved `
  --approval-packet $approvalPacket `
  --confirm-live-migration 'LIVE-MIGRATION-<packet-hash>' `
  --recovery-root $launchRoot `
  --out $launchReceipt
```

```powershell
$authoritySelection = 'D:\amazon-ai-ops-recovery\2026-07-29\inputs\authority-selection.json'
$migrationManifest = 'D:\amazon-ai-ops-recovery\2026-07-29\inputs\s7-offline-upgrade.json'
$migrationVerification = 'D:\amazon-ai-ops-recovery\2026-07-29\inputs\s7-migration-verification.json'
$approvalPacket = 'D:\amazon-ai-ops-recovery\2026-07-29\approval-output\live-migration-approval.json'
$launchReceipt = 'D:\amazon-ai-ops-recovery\2026-07-29\launch-output\live-migration-launch.json'
$acceptanceRoot = 'D:\amazon-ai-ops-recovery\2026-07-29\acceptance-output'
$finalizationRoot = 'D:\amazon-ai-ops-recovery\2026-07-29\finalization-output'
$liveAcceptance = Join-Path $acceptanceRoot 's7-live-migration-acceptance.json'
$finalizationPacket = Join-Path $finalizationRoot 's7-finalization-approval.json'

pnpm run verify:s7-live-migration-acceptance -- `
  --db $sourceDb `
  --authority-selection $authoritySelection `
  --migration-manifest $migrationManifest `
  --migration-verification $migrationVerification `
  --out $liveAcceptance

# 只读重验完整 migration/launch/acceptance/gate 链，并生成第二个不可覆盖确认包。
# 此步骤不会创建 canonical FINALIZED，也不会启动应用、修改 DB 或调用 Ads。
pnpm run operate:s7-live-migration -- --prepare-finalization `
  --approval-packet $approvalPacket `
  --launch-receipt $launchReceipt `
  --acceptance-receipt $liveAcceptance `
  --recovery-root $finalizationRoot `
  --out $finalizationPacket

# 用户复核 finalization packet 后，精确复制其中 confirmation.token。
# 只允许发布一次受保护的 canonical FINALIZED.json；这仍不是 APP_READY/Ads 授权。
pnpm run operate:s7-live-migration -- --finalize-approved `
  --finalization-packet $finalizationPacket `
  --confirm-finalization 'FINALIZE-S7-<finalization-payload-hash>'
```

验收器不会用可写模式打开真实库。它只通过 WAL-aware、readonly、`query_only`
SQLite online backup 把逻辑快照放入受控临时目录，后续完整性、FK、migration 1–9、
必需表和业务行保留检查都针对该临时副本。发布前会再次执行独立的只读 online
backup；两份逻辑快照的 SHA 与大小必须完全相同，期间出现 WAL-only 写入也会停止。
输入 JSON 以同一个稳定文件句柄读取、计算 SHA 并解析，路径被替换或内容漂移会停止。
offline manifest 必须带有持续到最终发布的 Windows `FileShare.None` lease、工作/恢复
hash 和完整业务行保留证明；migration verification 必须包含官方 verifier 的完整、
无重复且全通过 check-code 集合。验收器不会只相信这些 check code：它会再次以
readonly + `query_only` 打开 manifest 绑定且彼此 distinct 的 working/restore 文件，
独立核对当前 hash、完整性、FK、migration 1–9、逐表行数、业务行保留、v9 recovery
preflight，以及恢复副本的源版本/基线行数；真实 source 文件已经迁移，不会拿迁移前
SHA 再误验当前文件。working/restore 是已完成并封存的离线工件：检查开始前必须不存在
`-wal`、`-shm` 或 `-journal`；验收器会记录 canonical path、dev/ino、birthtime、
nlink、size、mtime 和同句柄 SHA，并在 readonly 语义检查关闭后重新核对身份与主文件
hash，同时再次确认 sidecar 不存在。路径替换、hard link、主文件漂移或 pre/post
sidecar 任一异常都会 fail-closed。验收器还要求 migration 9 内嵌的
`upgradeBackup` 精确绑定真实库及相邻固定 `.bak` / `.manifest.json` 路径，并通过
`StoreRepository.getMigrationRecoveryPreflight(9)` 的 SHA、完整性、Schema、行数和
`canRestore` 复核。相邻最终 manifest 必须保持 `status=created`；只有数据库内嵌
manifest 可因安全复用记录为 `created` 或 `reused`。失败不会留下正式回执；成功回执明确记录
`authorityDatabaseMutated=false`、`adsExecutionInvoked=false`，也不包含业务行内容、
密码、Cookie 或 Token。

只有 `status=PASSED`、`passed=true`、全部 checks 通过且回执已独占发布，才说明
“迁移后的真实库只读验收通过”。它仍不代表 Ads canary、package 或整体产品 READY。

通过只读验收后仍不能直接回到普通启动。`--prepare-finalization` 会再次校验原始
approval packet 自校验、成功 launch receipt、PASSED 且无写入的 acceptance receipt、
当前 v9 authority、migration 1–9 名称/校验和/状态、必需表、DB owner/ACL、无 sidecar、
当前冻结 package/受信 PowerShell，以及 ACTIVE → BOUND → HANDOFF_READY →
HANDOFF_RELEASED → ADMISSION → CLOSED 的受保护文件身份。任一输入、文件身份、ACL、机器、
SID、DB file ID 或链路变成未知都停止。`--finalize-approved` 还会在第二次人工确认时
重跑相同检查，随后以不可覆盖、落盘并受保护的原子发布方式写
`.s7-main-startup-gate\FINALIZED.json`。

首次正常 packaged Main 启动会在取得 Electron single-instance lock 前后各复核完整链、
FINALIZED、当前 DB 精确快照、冻结 package/Main、受信 shell、机器/SID/卷/file ID、
schema v9、migration ledger/checksum、完整性/FK/必需表；全部精确时，才在任何普通 DB
写入前独占发布一次 `POST_MIGRATION_ADMITTED.json`。发布前崩溃不会获得启动资格；发布后
崩溃可在下一次启动通过同一 marker 恢复，不会覆盖或重写。之后允许正常业务行变化以及
合法 package/Main/shell 升级，但仍固定 canonical DB 的同一 file identity、owner/ACL、
schema v9、migration ledger/checksum/invariants，并持续复核 FINALIZED、completion 和
全部外部证据绑定。DB 文件替换、marker 半写/篡改、链文件或证据漂移、ACL 漂移、schema/
ledger/checksum 漂移一律 `HOLD`。`FINALIZED` 和 `POST_MIGRATION_ADMITTED` 只解除 S7
迁移后的普通启动阻断，不代表 formal APP_READY，也不授权 Ads 自动执行。

## 恢复与切换

验证器生成的 `restored-pre-v9.db` 是恢复演练副本，不会自动替换真实库。需要回滚时：

1. 保持应用退出并再次确认真实源库没有 `-wal`/`-shm`。
2. 保存失败库、升级 manifest、`.pre-upgrade-to-v9.bak` 与 sidecar，不删除现场证据。
3. 对恢复副本再次运行 `integrity_check`、版本、行数和 SHA 校验。
4. 由操作者在停机窗口内把当前库移动到带时间戳的隔离名称，再把验证过的恢复副本复制为新的库文件。
5. 首次启动只做只读检查；确认店铺、Profile、业务行和 migration 状态后再恢复任务调度。

任何 SHA、行数、版本、Schema 指纹或身份不一致都必须停止，不得通过覆盖文件“试一下”。

## Profile 显式迁移

`@amazon-ai-ops/browser-worker` 导出：

- `preflightLegacyStoreProfileMigration(input)`：只读检查并生成逐文件 SHA 清单；
- `migrateLegacyStoreProfile(input)`：临时目录复制、复核、同盘原子发布；
- `StoreProfileMigrationError`：区分阻断、待显式恢复和复制失败。

调用方必须传入：

- Main 所有的 `trustedLegacyRoot`、`sourceProfilePath` 与 `trustedStoresRoot`；
- `browserState: 'stopped'`；
- `storeId`、`browserProfileId`、唯一 provider；
- 已在可见页面核验的外部账号 ID、核验时间和身份材料 SHA-256。

同一源路径会生成不可复用的 claim。不同店铺或 provider 再次引用时 fail-closed。异常中断留下 pending claim 时，先确认不存在仍在运行的旧迁移，再由人工使用相同绑定设置 `resumePending: true`；不得为绕过歧义而删除 claim。源 Profile 始终保留，只有目标发布、重新登录验证和备份验收全部完成后才可另行安排退役。

## 聚焦验收

```powershell
$env:TEMP = 'D:\Desktop\py\amazon-ai-ops\.tmp-s7-02'
$env:TMP = $env:TEMP

pnpm exec vitest run `
  packages/local-db/src/sqlite/migrations/upgrade-backup.test.ts `
  packages/local-db/src/sqlite/legacy-upgrade.test.ts `
  packages/local-db/src/sqlite/migrations/0008-execution-authority.test.ts `
  packages/local-db/src/sqlite/migrations/0009-store-authority-quarantine-repair.test.ts `
  packages/local-db/src/sqlite/repositories/store-repo.test.ts `
  packages/browser-worker/src/store-profile.test.ts `
  packages/browser-worker/src/store-profile-migration.test.ts `
  scripts/verify-s7-migration-backup-restore.test.mjs `
  scripts/verify-s7-live-migration-acceptance.test.mjs `
  scripts/operate-s7-live-migration-launch.test.mjs `
  apps/desktop/src/main/s7-migration-startup-gate.test.ts

pnpm --filter @amazon-ai-ops/local-db run typecheck
pnpm --filter @amazon-ai-ops/browser-worker run typecheck
git diff --check
```

此手册只覆盖 S7-02 的 DB/Profile 升级恢复链，不代表 package、UI、长稳运行或真实 Ads canary 已 READY。
