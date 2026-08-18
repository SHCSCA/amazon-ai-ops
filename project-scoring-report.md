# Amazon AI Ops Agent — 项目多维度评分报告

> 评估对象: `d:/Desktop/py/amazon-ai-ops`(v1.5.0,external-security P1 候选)
> 评估时间: 2026-07-22
> 评分基准: 10 分制;基于源码结构与量化指标,非主观印象。

---

## 一、量化指标(评分依据)

| 指标 | 实测值 | 含义 |
|---|---|---|
| 测试文件数(`.test.ts`,`apps/desktop/src`) | 97(+ 大量 `.test.tsx`) | 测试文化强 |
| 源文件数(`.ts`,排除测试) | 84 | 测试/源 ≈ 1.15:1 |
| 全量测试结果 | 1992/1992 通过(584 suites) | 回归基线稳 |
| `main/index.ts` 体积 | 345.83 KB / 8331 行 | God file,可维护性红线 |
| `renderer/dev-preview-api.ts` | 56.23 KB | 单文件偏大 |
| 领域库(packages) | 13 个 | 模块化分层清晰 |
| IPC 通道 | 89 个 `ipcMain.handle` | 按前缀分组,契约显式 |
| ESLint/Prettier 配置 | 0 | 工程自动化缺口 |
| 安全门禁 | external P1 完成 + fail-closed 执行 | 安全闭环 |
| 证据/就绪门禁 | 8 gates、manifest-driven bundle | 可审计性极高 |

---

## 二、多维度评分表

| # | 维度 | 权重 | 得分 | 加权 | 评级 |
|---|---|---|---|---|---|
| 1 | 架构设计 | 10% | 7.5 | 0.75 | B+ |
| 2 | 模块化/分层 | 7% | 7.5 | 0.53 | B+ |
| 3 | 代码质量 | 8% | 7.0 | 0.56 | B |
| 4 | 测试覆盖 | 12% | 9.0 | 1.08 | A |
| 5 | 类型安全 | 6% | 8.5 | 0.51 | A- |
| 6 | 安全性 | 12% | 8.5 | 1.02 | A- |
| 7 | 可维护性 | 10% | 6.5 | 0.65 | C+ |
| 8 | 工程化/构建 | 6% | 7.0 | 0.42 | B |
| 9 | 可扩展性 | 5% | 7.0 | 0.35 | B |
| 10 | 文档完备性 | 5% | 8.5 | 0.43 | A- |
| 11 | 业务完整性 | 5% | 8.0 | 0.40 | B+ |
| 12 | 可审计性/证据链 | 7% | 9.5 | 0.67 | A+ |
| 13 | UI/UX | 4% | 8.0 | 0.32 | B+ |
| 14 | 错误处理 | 2% | 7.5 | 0.15 | B+ |
| 15 | 性能 | 1% | 7.5 | 0.08 | B+ |
| | **综合加权总分** | 100% | | **≈ 7.9 / 10** | **B+** |

> 一句话定位:**工程纪律与安全/证据链是一流水准,但被一个 8000+ 行的 god file 与缺失的 lint 链路拖累可维护性。**

---

## 三、各维度详解

### 1. 架构设计 — 7.5
**优**: Electron 三层(main/preload/renderer)清晰;preload 用 `contextBridge` 白名单暴露 API,无 `nodeIntegration`;IPC 通道按 `app:`/`settings:`/`browser:`/`v1_5:reports:`/`recommendation:` 等前缀分组;主进程=业务大脑、渲染端=纯 UI 的职责切分正确。
**劣**: `main/index.ts` 单文件承载应用入口 + 89 个 IPC handler + 全部业务编排,违反单一职责;IPC 层未抽到独立模块(`main/ipc/` 目录实际为空)。

### 2. 模块化/分层 — 7.5
**优**: 13 个独立 `packages/*` 各司其职(local-db / ai-adapter / rules-engine / browser-worker / lingxing-report-collector 等),通过 `workspace:*` 引用;`shared-types` 统一跨进程类型契约。
**劣**: 编排逻辑集中而非分散到各领域 service;`renderer/dev-preview-api.ts` 单文件 56KB,职责过载。

### 3. 代码质量 — 7.0
**优**: TypeScript 严格、命名规范、注释为中文且务实;每个业务模块都有配对 `.test.ts`。
**劣**: **无 ESLint/Prettier**,代码风格与潜在坏味道靠人工保证;部分文件注释稀疏;god file 内逻辑耦合度高。

### 4. 测试覆盖 — 9.0
**优**: 测试/源文件 ≈ 1.15:1;1992 测试全绿;关键链路有集成测试(`ad-readback-authority.integration.test.ts`);Vitest 用 `forks` pool 保证原生模块隔离;测试文件普遍较大(如 `dashboard-page.test.ts` 59KB),说明是真实断言而非占位。
**劣**: 无显式覆盖率阈值配置(未见 coverage gate);UI 测试偏重逻辑模型层。

### 5. 类型安全 — 8.5
**优**: TS 5 全量;`shared-types` 跨进程共享;preload 用具体类型收窄 IPC 返回;`types.ts` 显式建模业务实体。
**劣**: `preload/index.ts` 多处 `any`(如 `saveSettings(settings: any)`),IPC 边界类型未完全收窄。

### 6. 安全性 — 8.5
**优**: external P1 完成——窗口导航精确白名单、`window.open` 不在应用内打开、`shell.openExternal` 仅无 userinfo 的 http(s);密码 Main-only + `safeStorage` 事务迁移;渲染端凭证沙箱不收明文;广告执行 **fail-closed**;`NODE_ENV` 无法单独降级打包行为(需 `!app.isPackaged`)。
**劣**: 外链 domain allowlist 仍为 P2 未做(只限协议);ERP 会话复用凭证验证待硬化;敌对 `NODE_ENV` 动态 smoke 待补。

### 7. 可维护性 — 6.5(最大短板)
**优**: 模块化 + 配对测试 + 详尽文档降低理解成本。
**劣**: `main/index.ts` 8331 行是**致命维护负担**——新人定位、改动风险评估、合并冲突都极困难;无 lint/format 自动化;缺 CI 配置文件(未见 `.github/workflows`);god file 使"改一处影响面"难以预估。

### 8. 工程化/构建 — 7.0
**优**: pnpm workspace;`scripts/` 下 30+ 证据/验证脚本形成完整交付流水线;electron-builder + esbuild + Vite 分层构建;`pretest` 自动 rebuild 原生模块。
**劣**: 无 lint/format/CI 自动化;构建脚本用 `node -e copyFileSync` 拼接(`build:main`/`build:preload`)较脆弱;无 husky/commit 校验。

### 9. 可扩展性 — 7.0
**优**: 新增业务域只需加 package + IPC 前缀;页面/组件模板一致。
**劣**: 新 IPC handler 默认进 `index.ts`,加剧 god file;`types.ts` 20KB 单文件承载全部渲染端类型,扩展易冲突。

### 10. 文档完备性 — 8.5
**优**: README 简洁权威;`AGENTS.md` 极详尽(交付状态/边界/验证要求);`docs/` 含 PRD/进度/验收矩阵/用户指南/原型索引;`ORIGINAL_REQUEST.md` 记录需求演进。
**劣**: 文档偏"状态台账"风格,缺少架构图与贡献者上手指南;部分历史信息需交叉比对才不混淆。

### 11. 业务完整性 — 8.0
**优**: 8 个工作区覆盖采集→导入→诊断→建议→审批→执行→回读→交付全闭环;产品/关键词/Listing 域齐全。
**劣**: 唯一外部阻断 Task 8B(真实 Ads v2 回读)未完成,导致 `APP_NEEDS_WORK`;AI 执行仍 fail-closed,无真实写入闭环。

### 12. 可审计性/证据链 — 9.5(最大亮点)
**优**: 业内罕见的强证据体系——8 个 formal readiness gates、manifest-driven final-readiness、`output/codex-evidence/` + `output/delivery-bundles/`、READY/NON_READY safety 校验、EXE/app-content/main-bundle **三重哈希绑定**、readback 权威链绑定 recommendationId。任何交付声明都可溯源校验。
**劣**: 证据脚本与产物体积大,学习曲线陡。

### 13. UI/UX — 8.0
**优**: 8 工作区首屏任务面板、`ScopeBar` 作用域、虚拟化表格、a11y(aria-live/aria-busy/tabpanel)、busy 反馈一致、原型对齐、reduced-motion 支持。
**劣**: 仅浅色 Windows 主题(产品边界内合理但灵活度低);登录页内联 style 较多,设计 token 未完全统一。

### 14. 错误处理 — 7.5
**优**: `user-facing-error.ts` 统一面向用户错误;fail-closed 广告执行;登录/工作流有 busy 与重试反馈。
**劣**: god file 内错误处理分散,难全局审视;缺统一错误上报/日志聚合视图。

### 15. 性能 — 7.5
**优**: `@tanstack/react-virtual` 表虚拟化;SQLite WAL + DuckDB 分析;scope-change 300ms debounce;有序关闭协调器。
**劣**: 本地 Electron+SQLite 天花板有限;god file 首次解析/热重载偏慢(开发体验);未见性能基准测试。

---

## 四、优势 / 风险矩阵

### 核心优势(应保持)
1. **可审计性 9.5** — 证据链 + 三重哈希 + readiness 门禁,交付声明不可伪造。
2. **测试覆盖 9.0** — 1:1 配对测试,1992 全绿,回归基线稳。
3. **安全性 8.5** — external P1 + fail-closed,凭证不越界。

### 主要风险(应优先治理)
1. 🔴 **god file**(`main/index.ts` 8331 行) — 可维护性/可扩展性/工程化的共同瓶颈。
2. 🟠 **无 lint/format/CI** — 代码质量与一致性靠人工,规模化风险高。
3. 🟠 **Task 8B 未完成** — 业务完整性的唯一外部阻断,阻止 `APP_READY`。
4. 🟡 **IPC 边界 `any`** — preload 多处 `any`,类型安全未闭环。
5. 🟡 **单文件过大** — `dev-preview-api.ts` 56KB、`types.ts` 20KB。

---

## 五、改进优先级建议

| 优先级 | 行动 | 预期收益 | 难度 |
|---|---|---|---|
| P0 | 拆分 `main/index.ts`:按领域抽 `main/ipc/{reports,recommendations,readback,browser,settings,delivery}.ts` | 可维护性 +1.0,可扩展性 +0.5 | 中 |
| P0 | 引入 ESLint + Prettier + tsc 门禁,接 CI | 代码质量 +1.0,工程化 +1.0 | 低 |
| P1 | 收窄 preload 的 `any`,用 shared-types 为每个 IPC 通道建模请求/响应 | 类型安全 +1.0 | 中 |
| P1 | 完成 Task 8B 真实 Ads v2 回读 → `APP_READY` | 业务完整性 +1.5 | 外部依赖 |
| P2 | 拆分 `dev-preview-api.ts` / `types.ts` 按域分文件 | 可维护性 +0.5 | 低 |
| P2 | 补 domain allowlist + 敌对 NODE_ENV 动态 smoke | 安全性 +1.0 | 低 |
| P3 | 增加覆盖率阈值 gate + 性能基准 | 测试/性能 +0.5 | 中 |

---

## 六、结论

**综合加权 ≈ 7.9 / 10(B+)**

这是一个**纪律性极强、证据链一流、安全性扎实**的工程,在"可审计交付"这一最难维度上做到了 9.5。但它被一个 8000+ 行的 god file 和缺失的 lint/CI 链路锁住了可维护性上限。**若完成 P0 两项(god file 拆分 + lint/CI),综合分可升至 8.5+(A-)**;若再闭合 Task 8B,即可冲击 `APP_READY`。

> 评分性质说明:本评分基于代码结构、量化指标与文档事实,非运行时性能压测或渗透测试结论;部分维度(性能/错误处理)的细颗粒判断受 god file 内部不可见逻辑限制,存在 ±0.5 的不确定区间。
