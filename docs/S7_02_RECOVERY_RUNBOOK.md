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
3. **只有用户明确批准真实迁移后**，才可由另行批准的生产迁移/启动流程处理真实
   authority DB。本验收 CLI 不执行迁移、不启动应用，也不能替代该批准。
4. 真实迁移结束后、恢复调度或任何 Ads 执行前，运行下方只读验收。`--out` 必须是
   不存在的绝对 `.json` 路径；碰撞不会覆盖。

```powershell
$authoritySelection = 'D:\amazon-ai-ops-recovery\2026-07-29\authority-selection.json'
$migrationManifest = 'D:\amazon-ai-ops-recovery\2026-07-29\s7-offline-upgrade.json'
$migrationVerification = 'D:\amazon-ai-ops-recovery\2026-07-29\s7-migration-verification.json'
$liveAcceptance = 'D:\amazon-ai-ops-recovery\2026-07-29\s7-live-migration-acceptance.json'

pnpm run verify:s7-live-migration-acceptance -- `
  --db $sourceDb `
  --authority-selection $authoritySelection `
  --migration-manifest $migrationManifest `
  --migration-verification $migrationVerification `
  --out $liveAcceptance
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
  scripts/verify-s7-live-migration-acceptance.test.mjs

pnpm --filter @amazon-ai-ops/local-db run typecheck
pnpm --filter @amazon-ai-ops/browser-worker run typecheck
git diff --check
```

此手册只覆盖 S7-02 的 DB/Profile 升级恢复链，不代表 package、UI、长稳运行或真实 Ads canary 已 READY。
