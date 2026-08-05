# 免安装包启动修复状态（2026-08-05）

## 结论

当前候选仍是 `APP_NEEDS_WORK`，不能标记为 `APP_READY`。源码提交 `a47ca3da` 已取消全局
ERP/Ads 登录门：应用直接进入 Mission Control，店铺在左侧新增与切换，外部连接在当前店铺工作台
内配置。运营人员只填写领星账号和下载中心店铺名称，不再查找或输入 Ads Profile ID；Electron Main
从可见 `ads.lingxing.com` 受信页面自动识别广告身份，并在用户确认后才允许该身份进入真实广告执行
门禁。正式 authority DB 仍未执行需要两次精确人工确认的受控 v0→v11 迁移，真实 Ads canary 也未完成。

## 当前包身份

| 项目 | SHA-256 |
|---|---|
| Installer `AmazonAIOpsAgent-1.5.0.exe` | `469DB864647E5078241166E644A736065BA2D8CFEA8D311B517B637B08EE1CA6` |
| Portable `AmazonAIOpsAgent-1.5.0-portable.exe` | `6EFB6B9F0C17EA46872C6A811AC2E3A858D6C4C7C04F1F0E788FAE91D6CC5690` |
| win-unpacked EXE | `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89` |
| App content | `BB08F0D8B623DF6DEA821E42DA57E40487E7A57B8A06F7647F5BE09F2D4FDDB9` |
| Main bundle | `4348CEB4DAF52CCE41C15D8B66B7E42B54D3D1BD8BA385E3F35F22C75D947C36` |

本地 portable 路径为
`apps\desktop\release\AmazonAIOpsAgent-1.5.0-portable.exe`。release 二进制仍是本地交付产物，
不进入 Git。

## 已修复

- Package UI 首次店铺创建、连接配置、店铺切换和可见登录现在只在浏览器运行时启动前进入
  有界 setup mutation；进入已验证会话后仍恢复严格只读证据模式。
- 应用根节点不再根据 ERP/Ads 登录状态隐藏 Mission Control；左侧店铺动作统一使用“切换店铺”，
  不再把店铺范围切换描述为外部登录。
- 当前店铺连接工作台提供领星映射的增删改查、可见浏览器启动、Ads 身份只读候选与一次性确认；
  Renderer 提交 Ads Profile ID 和通用连接接口写入外部身份均被 Main 拒绝。
- Main 只接受 `ads.lingxing.com` 的唯一稳定 URL/活动 DOM 身份证据；冲突、缺失、跨店、旧会话、
  过期确认令牌或确认前切换广告账户均失败关闭。确认前真实广告执行保持阻断。
- 同一店铺的连接映射提交会推进权威 revision，但不会再清空尚未提交的密码草稿；连接启动成功后
  密码立即从 Renderer 表单清空。切换店铺时上一店铺草稿在绘制前清空。
- Package UI 店铺选择使用 `memory_only`，不会为了证据导航写入正式选择状态。
- 数据库只读基线改为在 Store authority 成立后延迟捕获，避免在首次店铺尚未选择时建立错误基线。
- Windows S7 离线迁移 helper 与 Node 统一使用 Ordinal 目录项排序，修复正式 userData 同时含
  `Cache` 和 `amazon-ai-ops.db` 时误报“Source directory changed”的问题；独占锁、SHA、sidecar、
  hard-link 和发布门槛均未降低。

## 当前验证

| 验证 | 结果 |
|---|---|
| 店铺内连接与身份边界聚焦回归 | 17 文件、315/315 PASS |
| S7 离线迁移与恢复完整回归 | 19/19 PASS；新增混合大小写目录真实 Windows 回归 |
| Desktop TypeScript | `tsc --noEmit` PASS |
| Windows 构建 | 提交 `a47ca3da`；Main、Preload、Renderer、Playwright Chromium staging、NSIS 与 portable 全部 PASS；源原生依赖哈希构建前后完全一致 |
| win-unpacked + portable 启动 | `output\codex-evidence\package-launch-smoke-1785915630818.json` PASS；两种形态均创建可见主窗口、使用隔离 userData，退出后目标进程 0 |
| 包体安全边界 | `output\codex-evidence\package-security-boundaries-a47ca3da.json`：11/11 PASS，并绑定当前 EXE、App content 与 Main bundle 哈希 |
| 当前业务 UI smoke | `output\codex-evidence\current-business-ui-smoke-1785915901541.json`：5/5 PASS |
| 开发预览交互 | 左侧切店、标准店铺/产品 CRUD、领星映射、密码草稿保留、启动连接、Ads 自动识别候选、人工确认和确认后只读状态均实际点击通过；不接触真实凭证或生产 DB |
| 当前 authority DB | SHA-256 `B7D0552BCF73773E91D17B8226D8AA4A9E5EC1BF76FC6E864B7A017E0945A633`，无 sidecar，未迁移 |
| 当前库离线副本 v0→v11 | PASS；migration 1–11 applied，integrity `ok`，FK 0，业务行保留通过 |
| 独立迁移复核 | 19/19 PASS |

离线 manifest 与复核回执位于
`D:\amazon-ai-ops-recovery\2026-08-05-portable-repair\offline\execute-attempt-4-current-b7d055`。
正式库迁移前备份位于
`D:\amazon-ai-ops-recovery\2026-08-05-portable-repair\snapshots\authority-pre-migration.db`。
这些路径包含本机数据库身份，只是本地恢复证据，不进入 Git。

## 当前阻塞

正式 Package UI schema v8 仍必须由操作者在当前店铺工作台中完成领星登录、Ads 授权、打开能暴露
唯一广告身份的广告活动或广告组页面，并在主窗口确认绑定；runner 不读取、填写、点击或保存凭证。
当前自动启动冒烟只证明包体能创建主窗口和安全退出，不替代真实账号 handoff、正式 package UI manifest
或 live migration 批准。

后续顺序不可跳过：

1. 操作者双击当前 portable，从左侧新增或选择店铺，在店铺工作台内完成领星映射与可见登录；
2. 在 Ads 可见窗口打开广告活动或广告组页面，回到主窗口确认 Main 自动识别的广告账户；
3. 保持主窗口打开，完成当前包 Package UI v8 operator handoff 并取得 PASS manifest；
4. `operate:s7-live-migration -- --prepare` 生成只读 approval packet；
5. 操作者复核并精确确认 live migration token 后，才允许迁移正式库并启动受控包；
6. 完成只读验收，再复核并精确确认 finalization token，最后重新验证正式 userData 下的 portable 启动。

即使上述启动恢复完成，真实 Amazon Ads Task 8B canary / before-after-reload 回读仍是整体
`APP_READY` 的外部阻塞，不能复用历史证据宣称 READY。
