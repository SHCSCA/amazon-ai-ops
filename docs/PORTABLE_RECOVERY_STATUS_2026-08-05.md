# 免安装包启动修复状态（2026-08-05）

## 结论

当前修复仍是 `APP_NEEDS_WORK`，不能标记为 `APP_READY`。截图中的
`Package UI read-only mode forbids stores:switch` 已在源码提交
`f018690d3f9aeea79eb18312856383d8689d296e` 修复并重新打包；正式 authority DB 仍保持
v0 原样，尚未执行需要两次精确人工确认的受控 v0→v11 迁移。因此当前 portable 文件已包含
修复代码，但还不能把“在这台机器上双击进入业务工作区”声明为完成。

## 当前包身份

| 项目 | SHA-256 |
|---|---|
| Installer `AmazonAIOpsAgent-1.5.0.exe` | `A9B0733E086C9182C897A6AEB4679577BB4DA8BC760AC5AD65ADB3C261A770AB` |
| Portable `AmazonAIOpsAgent-1.5.0-portable.exe` | `B1A3BA60D499F2D95B19F2F74B56FB928C7A0E991FE0AA286612D046702A9AC7` |
| win-unpacked EXE | `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89` |
| App content | `DC8CF4C40EB25CD43D1FE2BD872547BA7C420016772ECAF2349F941220682700` |

本地 portable 路径为
`apps\desktop\release\AmazonAIOpsAgent-1.5.0-portable.exe`。release 二进制仍是本地交付产物，
不进入 Git。

## 已修复

- Package UI 首次店铺创建、连接配置、店铺切换和可见登录现在只在浏览器运行时启动前进入
  有界 setup mutation；进入已验证会话后仍恢复严格只读证据模式。
- Package UI 店铺选择使用 `memory_only`，不会为了证据导航写入正式选择状态。
- 数据库只读基线改为在 Store authority 成立后延迟捕获，避免在首次店铺尚未选择时建立错误基线。
- Windows S7 离线迁移 helper 与 Node 统一使用 Ordinal 目录项排序，修复正式 userData 同时含
  `Cache` 和 `amazon-ai-ops.db` 时误报“Source directory changed”的问题；独占锁、SHA、sidecar、
  hard-link 和发布门槛均未降低。

## 当前验证

| 验证 | 结果 |
|---|---|
| Package UI / Store authority 聚焦回归 | 8 文件、300/300 PASS |
| S7 离线迁移与恢复完整回归 | 19/19 PASS；新增混合大小写目录真实 Windows 回归 |
| Desktop TypeScript | `tsc --noEmit` PASS |
| 当前 authority DB | SHA-256 `B7D0552BCF73773E91D17B8226D8AA4A9E5EC1BF76FC6E864B7A017E0945A633`，无 sidecar，未迁移 |
| 当前库离线副本 v0→v11 | PASS；migration 1–11 applied，integrity `ok`，FK 0，业务行保留通过 |
| 独立迁移复核 | 19/19 PASS |

离线 manifest 与复核回执位于
`D:\amazon-ai-ops-recovery\2026-08-05-portable-repair\offline\execute-attempt-4-current-b7d055`。
正式库迁移前备份位于
`D:\amazon-ai-ops-recovery\2026-08-05-portable-repair\snapshots\authority-pre-migration.db`。
这些路径包含本机数据库身份，只是本地恢复证据，不进入 Git。

## 当前阻塞

正式 Package UI schema v8 必须由操作者在可见窗口完成领星和 Amazon Ads 登录；runner 不读取、
填写、点击或保存凭证。2026-08-05 的两次新包运行均正常进入应用，`stores:switch` 异常没有再出现，
但都在登录完成前被关闭，审计记录为 0 个数据库检查点，因此没有生成可用于 live migration 的
通过 manifest。“无法安全退出”是缺少终态检查点时的预期安全门，不是新的 Store 错误。

后续顺序不可跳过：

1. 操作者保持窗口打开并完成可见领星 / Ads 授权，取得当前包 Package UI v8 PASS manifest；
2. `operate:s7-live-migration -- --prepare` 生成只读 approval packet；
3. 操作者复核并精确确认 live migration token 后，才允许迁移正式库并启动受控包；
4. 完成只读验收，再复核并精确确认 finalization token；
5. 最后重新验证 portable 双击启动。

即使上述启动恢复完成，真实 Amazon Ads Task 8B canary / before-after-reload 回读仍是整体
`APP_READY` 的外部阻塞，不能复用历史证据宣称 READY。
