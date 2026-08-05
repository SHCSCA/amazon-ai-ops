# Mission Control 当前交付状态（2026-08-04）

> 2026-08-05 的便携包身份、启动修复和 authority DB 迁移状态已由
> [PORTABLE_RECOVERY_STATUS_2026-08-05.md](./PORTABLE_RECOVERY_STATUS_2026-08-05.md) 取代。
> 本文保留为 2026-08-04 Mission Control 候选的历史基线，不得继续引用其中包哈希作为当前包身份。

## 结论

当前候选是 `APP_NEEDS_WORK`，只允许内部 NON_READY 验证与受控交接，不是 `APP_READY`。

包体对应源码提交 `3f6fbec3f40fe8ad5dc64f3309474c5d2ea61bda`。美国站 / USD、多店铺 Store Capsule、10 个 Mission Control 工作区、人工审批与策略自动两种授权路径，以及真实广告执行前检查和三段回读合同已经进入生产代码。当前包已通过内部 UI、业务 smoke、启动、安全边界和敌对 `NODE_ENV` 验证，但尚未完成需要真实账号、真实数据库、自然时间和真实广告对象的生产门禁。

历史的 v1.5 `7/8`、Mission `4/8`、旧 package UI manifest、旧数据库快照和旧 NON_READY bundle 都不能替代本候选的当前证据。本候选尚未生成新的正式八门聚合结果或匹配的严格交付 bundle。

## 当前包身份

| 项目 | SHA-256 |
|---|---|
| Installer `AmazonAIOpsAgent-1.5.0.exe` | `EDEC273C4B6FCC172D75160E3809FD2E8618B001BC3C3855E40EDC05CB61B96A` |
| Portable `AmazonAIOpsAgent-1.5.0-portable.exe` | `58C6D501329547654FCBCBE429AAE2CA73738DC17B17A28A3CCEC965411DEDE4` |
| win-unpacked EXE | `67DC2A7036860A68E5312C212C31B8772AC463ED0289FCC44897867F55075E89` |
| App content | `FC173A2EE64C949F2EDF4237D8B447AF2C3D721EC8F9AFDE3E97A59674C8DE43` |
| Main bundle | `9B0C43D5383F679567D74F8A63735829156926CB1290F603378A48CF7F5AF32A` |

包体包含项目自带的独立 Playwright Chromium。Runner 不读取、填写或点击账号密码；正式 package UI 仍必须由用户在可见窗口完成 operator handoff。

## 已完成并已验证

| 范围 | 当前证据 | 结论 |
|---|---|---|
| 多店铺入口与切换 | 左侧 `店铺与站点` 是新增、编辑、归档/恢复和切换的唯一入口；新增后不自动选中，必须显式 `切换并登录` | 已实现 |
| Store Capsule 隔离 | 店铺 DB 范围、Lingxing/Ads Profile、连接、会话代次、任务、配置、授权、执行和证据均绑定 `storeId`；错店、旧 revision、未知状态失败关闭 | 已实现并有聚焦回归 |
| 产品与广告对象 CRUD | 店铺与广告对象工作区提供产品、目标/成本、广告对象、关键词、Listing 和运营事件的标准增删改查/状态操作 | 已实现 |
| 双模式授权 | 人工审批模式和命中启用策略的 policy-auto 模式统一签发 store-scoped MissionGrant | 已实现；真实 canary 未完成 |
| 真实广告执行合同 | 第一版只允许经授权的低风险 `set_keyword_bid` 下调；执行前重新校验店铺、对象、策略、预算、kill switch 和会话，完成 before / after / reload 回读；任何 `UNKNOWN` 停止 | 已实现；真实 canary 未完成 |
| 内部交互 UI | `output\codex-evidence\mission-control-ui-3f6fbec3\manifest.json`：10 个工作区各 100% / 125%，另含 Store Gate、SHC001→SHC002 隔离和 1200×900 执行布局，共 23 PNG | PASS；明确 `NO_FINAL_READINESS_CREDIT` |
| 当前业务 UI smoke | `output\codex-evidence\current-business-ui-smoke-1785830923177.json` | 5/5 PASS |
| Windows 包启动 | `output\codex-evidence\package-launch-smoke-1785831535965.json` | win-unpacked + portable PASS，隔离 userData，退出后目标进程为 0 |
| 包体安全边界 | `output\codex-evidence\package-security-boundaries-3f6fbec3.json` | 11/11 PASS |
| 敌对 `NODE_ENV` | `output\codex-evidence\package-adversarial-node-env-3f6fbec3.json` | PASS |
| 编译边界 | 14 个 workspace / project typecheck | PASS |

## 尚未完成的生产门禁

| 门禁 | 当前状态 | 通过条件 |
|---|---|---|
| 正式 Package UI schema v8 | PENDING | 对当前包完成每轮 visible operator handoff；按 100% / 125% 覆盖 10 个工作区、只读 overlays、canonical 子视图、宽屏/最小窗口和店铺隔离；生成通过 manifest |
| 真实 authority DB 升级 | PENDING | 用户明确批准后，对选定 live DB 执行可恢复迁移并验证 stores、Store Capsule 和 execution authority 表；不得猜测或覆盖数据库 |
| 每店真实领星 8/8 | BLOCKED | 每个真实店铺以各自 Profile 完成 8 类报表下载、逐类导入、对账和身份校验 |
| 两店连续观察 | BLOCKED BY TIME / SESSIONS | 两家真实店铺连续 7 个已完成美国业务日形成 14/14 `SUCCESS_8_OF_8` |
| 人工审批真实 canary | BLOCKED | 当前真实对象、人工 MissionGrant、可见 Ads 会话和 before / after / reload 回读全部闭合 |
| Policy-auto 真实 canary | BLOCKED | 人工 canary 之后，以当前启用策略、限额、kill switch、真实对象和独立授权完成 policy-auto 回读 |
| 正式八门聚合与 bundle | PENDING | 上述当前证据齐备后重新聚合，导出与同一包/DB/证据选择绑定的严格 READY 或 NON_READY bundle 并通过 safety verifier |

## 当前安全边界

- 首版只支持 Amazon 美国站和 USD；不以跨站点或多币种扩展作为当前交付条件。
- 新建店铺不自动成为当前店铺，避免无意启动 Profile、调度或数据查询。
- 所有写动作必须绑定当前 `storeId`、revision、授权来源和真实广告对象；跨店、过期、歧义或 `UNKNOWN` 一律拒绝。
- AI 可以自主分析、生成建议和在策略允许时发起 policy-auto 授权，但不能绕过预算、kill switch、执行前检查和回读验证。
- `output/`、`storage/`、AppData DB/Profile、原始报表、release EXE、Cookie 和密钥均为本地运行/交付产物，不进入 Git。

## 下一次发布判定

文档提交与分支合并不会改变生产就绪状态。只有当前 package UI、真实 DB、两店连续采集和两条真实 Ads canary 都形成同一候选、同一 authority lineage 下的可验证证据后，才允许重新生成八门结果；聚合器未给出 `APP_READY` 前始终按 NON_READY 处理。
