# Amazon AI Ops 生产闭环计划（2026-07-29）

## 目标

以当前 Windows 包为冻结候选，在不伪造数据、不绕过人工登录与授权、不复用历史 READY 证据的前提下，完成：

1. 当前包的正式 Package UI 证据；
2. 唯一权威数据库的安全升级与两家真实美国站店铺配置；
3. 两店最近 7 个已完成美国业务日、每天 8 类领星报表的真实采集、导入与分析；
4. 人工审批和 policy-auto 两条真实 Amazon Ads v2 执行回读；
5. 八门生产就绪、READY bundle 与 READY safety。

任何门失败都保持 `APP_NEEDS_WORK` / `NON_READY`，不得把阶段成果描述为生产完成。

## 冻结基线

- Git HEAD：`20df9d5bf8da9b4d2b6ef220f9bc9b444515dc50`
- win-unpacked EXE：
  `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89`
- app content：
  `823D35F372D345A265F546F34556B1AB61831ADB2B9D36F3D9CCAB4C7836C962`
- Main bundle：
  `880A8A3034166EBADC00A5F9D2A5964C2C1380456FD60140EE4FC6618CCC8585`
- 已通过：package launch、package security boundaries、adversarial `NODE_ENV`。
- 正在完成：Package UI v8 的 100% / 125% / 1400×900 三档。
- 尚未开始形成正式信用：两店 7 个业务日、manual canary、policy-auto canary、Mission Control 8/8。

冻结规则：

- 只读检查、证据导出、运行手册和本计划不改变包身份。
- 一旦修改任何被打包的应用代码、依赖、Main/Renderer bundle 或安装产物，必须重建，并从 Package UI 开始重新生成全部当前包证据；尚未完成的 7 日窗口也从新包首次有效日重新计算。
- 当前审计没有发现阻断上线的代码 P0/P1，因此生产闭环期间不主动扩大产品功能范围。

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

- 继续使用 run group `production-p2-20df9d5b-20260729`；
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
4. 用户明确批准后，启动冻结的当前包一次，让现有事务化 migration 1–9 对唯一 live DB 执行正式升级。
5. 迁移过程中不得强杀应用。异常时停止重复启动，保留源/备份/sidecar/日志，按
   `docs/S7_02_RECOVERY_RUNBOOK.md` 和 migration recovery preflight 处理。
6. 首次启动后先做只读复核：migration 1–9 为 `applied`、`integrity_check=ok`、FK=0、源业务行保留、v9 backup 绑定有效。

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
