# S7-02 数据升级与恢复手册

## 安全边界

- 所有操作必须在 Amazon AI Ops 完全退出后进行；源库旁存在 `-wal` 或 `-shm` 时脚本会拒绝继续。
- 脚本不再自动查找 `%APPDATA%`，也不会原地升级真实用户库。必须显式提供绝对源路径、源文件 SHA-256 和独立工作目录。
- 升级、回读和恢复都发生在工作目录的复制件中。恢复只发布到新文件，不覆盖源库、备份或既有目标。
- 浏览器 Profile 含 Cookie。迁移只允许一个物理源绑定一个店铺、一个 provider；身份不明确、浏览器未确认停止、目标非空或路径含 junction/symlink 时全部停止。
- 证据 JSON 可以记录本地路径和业务表计数，不得写入密码、Cookie、Token 或表内容。

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

- 源 SHA 与操作者提供值一致，源库 `integrity_check=ok`；
- migration 1–9 全部为 `applied`，升级库 FK 检查为零；
- migration 1 新执行记录 checksum `store-authority-v1-20260727-03`；历史 `store-authority-v1-20260722-02`
  仅允许已应用记录只读兼容，或在 `started` / `failed` 且原始 bound backup 可复核时提升，并在 manifest
  保留 legacy checksum、原状态、原开始时间和提升时间；
- v9 manifest 绑定升级前版本、Schema 指纹、逐表行数、backup SHA 和完整性；
- 源业务表行数没有减少；
- 恢复副本的版本、逐表行数、Schema 指纹、完整性和 SHA 均回到升级前快照；
- 源库哈希在整个流程中保持不变。

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
  scripts/verify-s7-migration-backup-restore.test.mjs

pnpm --filter @amazon-ai-ops/local-db run typecheck
pnpm --filter @amazon-ai-ops/browser-worker run typecheck
git diff --check
```

此手册只覆盖 S7-02 的 DB/Profile 升级恢复链，不代表 package、UI、长稳运行或真实 Ads canary 已 READY。
