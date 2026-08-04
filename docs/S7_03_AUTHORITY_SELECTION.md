# S7.03 唯一生产 Authority DB 预检

`scripts/verify-production-authority-selection.js` 是 Windows 本地运行环境进入生产数据链之前的只读选择门。它解决的是“哪一个 SQLite 文件是当前唯一权威库”，不迁移数据库、不采集业务报表，也不执行 Amazon Ads。

## 必需输入

```powershell
node scripts/verify-production-authority-selection.js `
  --db "C:\Users\<user>\AppData\Roaming\@amazon-ai-ops\desktop\amazon-ai-ops.db" `
  --expected-user-data-dir "C:\Users\<user>\AppData\Roaming\@amazon-ai-ops\desktop" `
  --expected-main-sha256 "<64 位主数据库文件 SHA-256>"
```

三个选择器缺一不可，且路径必须是绝对路径：

- `--db` 必须是普通、非符号链接的 `amazon-ai-ops.db`。
- `--expected-user-data-dir` 必须是普通目录，不能是 symlink、junction 或其他 reparse
  路径，并且必须精确等于当前包名 `@amazon-ai-ops/desktop` 在 `%APPDATA%` 下的目录。
- `--db` 的 realpath 必须严格对应 `<expected-user-data-dir>\amazon-ai-ops.db`。
- `--expected-main-sha256` 绑定 SQLite 主文件本身；WAL 中的最新已提交状态由后续只读在线备份单独捕获。
- `storesRoot` 永远只从 `<expected-user-data-dir>\stores` 派生，不能由 CLI 另行指定。

## 只读与候选隔离

预检通过 `ad-readback-authority-db.defaultDbCandidates` 枚举所有默认 AppData 候选。显式选中的一个候选标记为 `selected`，其他存在的候选全部标记为 `non-authority`。

每个存在候选只产生一次 WAL-aware online backup，Schema 与完整性识别全部在该次逻辑副本上执行：

- 主文件 SHA-256、大小与 mtime；
- `-wal`、`-shm`、`-journal` sidecar 是否存在及其文件身份；
- 逻辑副本上的 `readonly: true` 与 `PRAGMA query_only = ON`；
- `PRAGMA integrity_check`；
- `PRAGMA foreign_key_check`；
- `sqlite_master`、`PRAGMA table_info(schema_migrations)` 及迁移版本/status。

预检不会从非权威候选的产品、店铺、报表、建议、授权或执行表读取任何业务行，也不会把非权威库中的字段拼接到权威结果。

只有在 `schema_migrations` 与全部 S7 目标表都不存在时才识别为干净 v0；ledger
缺失但任一目标表已存在时返回 `SELECTED_RECOVERY_REQUIRED`。旧 ledger 只有
`version` 等少量列、或使用 `20260525_001` 一类文本版本时不会因为缺列/非整数崩溃，
而会归类为 legacy/unrecognized recovery，防止把 partial schema 当作可直接升级的 v0。

## WAL-aware currentness

预检复用 `sqlite-authority-currentness` 的独立 Node 子进程执行只读 SQLite online backup。对唯一 `selected` 库，同一份临时逻辑副本还负责 Schema、迁移、完整性、外键和店铺配置计数，避免第二次捕获产生 TOCTOU。它记录：

- 逻辑 SHA-256；
- 逻辑文件大小；
- online backup 总页数与剩余页数；
- 副本 `integrity_check`。

输出明确区分 `mainFileSha256` 与 `logicalBackupSha256`。存在 `-wal`、`-shm` 或 `-journal` 时只会令 `offlineMigrationEligible=false`；预检绝不 checkpoint、截断或删除生产 sidecar。

临时副本会在返回前清理。捕获前后再次计算生产主文件 SHA-256、大小和 mtime，并要求
WAL/journal 身份不变；SQLite 的只读 WAL 锁可能合法改变 SHM 锁字节，因此只记录 SHM
前后身份，不把 SHM 字节完全不变伪装成安全保证。出现主文件或 WAL 漂移、路径歧义、
多选、备份失败或 currentness 证明不完整时立即 fail closed。

## 输出状态

- `SELECTED_SCHEMA_READY`：唯一库选择成立，迁移 1–9 都记录为 `applied`。
- `SELECTED_MIGRATION_REQUIRED`：唯一库选择成立，且是没有迁移 ledger 的干净 v0 库。
- `SELECTED_RECOVERY_REQUIRED`：存在 partial ledger、迁移 checksum/status 不匹配、所需表缺失、完整性失败、外键异常或 malformed stores；必须先恢复/审计，不能直接当作干净 v0 升级。

两种状态都只是“选择/迁移预检”结果。输出固定声明：

```json
{
  "formalEvidence": false,
  "authorityDatabaseMutated": false,
  "adsExecutionInvoked": false
}
```

它不能替代正式 authority snapshot、连续运行证据、真实人工 canary、策略自动 canary 或生产 readiness。

## 可选监控证据

默认模式只向 stdout 打印诊断，不在磁盘留下证据文件。确需保存非正式监控记录时使用：

```powershell
node scripts/verify-production-authority-selection.js `
  --db "<absolute-db>" `
  --expected-user-data-dir "<absolute-userData>" `
  --expected-main-sha256 "<64hex>" `
  --export `
  --out "D:\absolute\new-authority-selection.json"
```

`--out` 必须是尚不存在的绝对 `.json` 路径。实现先在同目录写入并 fsync 一个独占临时文件，再通过同卷 hard-link 原子且排他地发布目标；已有目标永不覆盖。`--help` 可在没有任何生产路径时安全退出。
