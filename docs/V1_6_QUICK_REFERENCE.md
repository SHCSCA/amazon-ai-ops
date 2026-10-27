# V1.6 开发速查

更新日期：2026-10-27。版本1.6.0，交付未就绪；结果以 [项目状态](PROJECT_STATUS.md) 和 [开发交接](DEVELOPMENT_HANDOFF.md) 为准。

| 需求 | 入口 |
| --- | --- |
| 启动源码应用 | `pnpm dev` |
| 类型检查 | `pnpm run typecheck` |
| 全仓模块尺寸 | `pnpm run check:module-boundaries:all` |
| 全量单测 | `pnpm test` |
| 隔离源码运行检查 | `pnpm run verify:desktop-isolated` |
| Windows构建 | `pnpm run build:win` |
| 当前失败复现 | `pnpm exec vitest run scripts/inspect-package-ui-run-group.test.mjs` |
| 实际需求与测试定义 | `v16_requirements_index.json`、`v16_required_test_manifest.json` |
| 原生证据协议 | [V16_NATIVE_EVIDENCE_PROTOCOL](V16_NATIVE_EVIDENCE_PROTOCOL.md) |
| 交付聚合 | `pnpm run verify:v16-full`，必须先有当前真实输入，不是生成通过状态的命令 |

源码测试和实包需分别匹配Node/Electron原生ABI。内部夹具必须隔离；正常用户入口为真实Windows EXE，不默认启动模拟工作台。费用、批准、Grant、执行、回读与APP_READY不得合成。旧速查见 [归档](history/2026-10-27-documentation-sync/README.md)。
