# Amazon AI Ops Agent

Amazon AI Ops Agent 是一个本地优先的 Electron 桌面应用，用于亚马逊运营数据采集、关键词机会分析、Listing 覆盖分析、Listing 改写建议、证据导出和本地审计。当前仓库主线是 v1.5 工作流。

## 当前状态

**DELIVERY: APP_READY.** 2026-06-30 Windows 桌面 high-fidelity UI、AI 输出合同硬化、领星报表日期弹层自动提交修复、产品级工作台和产品信息维护修复、产品管理首屏任务面板、工作范围首屏确认反馈、页面内范围表单和字段级绿色确认、ScopeBar 字段级绿色确认与范围编辑浮层、共享业务数据管道 300ms scope 防抖合并、产品配置首屏任务、直接保存/批量应用按钮 busy 反馈、批量目标 ACOS 行选择应用、上下键微调、实时健康度芯片和失焦即时保存反馈、运营事件首屏任务反馈和提交即清空/失败恢复、AI 设置首屏连接测试反馈、阈值字段级修复提示和广告阈值保存按钮 busy 反馈、共享表单行聚焦外发光反馈、定时任务首屏本地调度反馈和控制器/行级按钮 busy 反馈、加密记住账号密码、登录入口按钮 busy/spinner/`aria-busy` 与固定凭证状态反馈、AI/导入首屏反馈、OperatorTaskPanel 按钮 loading 微反馈、OperatorTaskPanel 卡片 Shimmer 扫光、ProgressiveDetails 与原生 details 折叠明细 hover/focus/active 与展开/收起反馈、全局字体栈和表格行高契约、全局按钮 active scale(0.98) 微反馈、状态红绿灯卡片 hover +2px 浮起投影反馈、MicroStepper 状态点和待处理旋转环反馈、数据采集监控抽屉与 Canvas 小电视预览、数据采集底部动作按钮 `aria-busy`/spinner/条纹进度反馈、交付验收回读阻断直达补证与字段级红圈定位、交付包导出未就绪红色禁止态、广告回读截图零路径存证、拖入态高亮、固定后缩略预览和绿色 `证据已安全固定` 徽标、执行回读时间/值安全合同可视化、执行回读安全复选框确认反馈、执行回读证据链按钮 busy 反馈、重型表格虚拟滚动、真实行号斑马纹和行按压/focus反馈、关键词机会表头排序箭头/ARIA 与筛选 100ms 反馈、今日看板主行动转跳中反馈、数据导入 SHA-256 核验列/表头排序/导入只读锁定/ARIA/直接动作按钮 busy 与 200ms blur/sweep 加行淡入反馈、Listing 词根热力图矩阵、关键词格块 strict containment 和草案 diff/骨架/超字数反馈、广告量化指标卡点击聚焦与非激活降噪、以及 canonical 日级广告口径说明已完成，并重新跑通 Windows installer/portable 打包、packaged launch smoke、manifest-driven final-readiness、READY bundle 和 READY safety。权威 final-readiness 为 `output\codex-evidence\final-readiness-20260630144400.json`，证据选择 manifest 为 `output\codex-evidence\v15-final-readiness-evidence-manifest-20260630144400.json`，package launch smoke 为 `output\codex-evidence\package-launch-smoke-1782801832587.json`，READY bundle 为 `output\delivery-bundles\v15-delivery-bundle-20260630144400-ready`。本轮 UI 将主窗口改为更清晰的业务分组导航、紧凑状态标签、表格化录入、AI 输出合同标签和更少首屏长文案；产品管理页现在可直接维护 ASIN、标题、SKU/MSKU、阶段、状态、成本、最低价和目标阈值，并按显式选中的产品展示 DB 中的日级广告指标；系统工作台和产品管理都不会再默认拿第一条产品历史，未锁定 ASIN 时会先引导选择产品，已选产品但缺导入指标时会先引导进入 `数据导入与校验`，避免看错产品后继续运行 AI。所有接入 `OperatorTaskPanel` 的异步主行动在 busy 时会立即禁用、显示 spinner、暴露 `aria-busy`，并把按钮文案切到 `处理中...` 或业务化“正在…”状态，避免用户误以为点击无响应；共享业务数据管道会在 ScopeBar 或工作范围页面快速连续修改日期、店铺、站点、ASIN 或批次时合并 300ms 内的 scope-only 查询，显式刷新、导入完成和 data-updated 事件仍立即读取，避免高吞吐页面重复打 IPC；`产品管理` 现在有首屏产品作战台，固定显示产品数、当前 ASIN、指标行数、日级天数和 Main 凭证沙箱托管状态，`凭证映射通过` 芯片支持 hover/focus 浮层显示 Main Sandboxed ID、站点周期和 UI 不留存明文说明，选择/保存/缺指标/读取失败都写入 `aria-live` 反馈；`AI 设置` 现在有首屏连接任务面板，保存/测试按钮使用 busy/spinner/disabled 反馈，测试中、测试通过、测试失败和保存完成都固定显示在 `aria-live` 气泡里，不再重复落到底部状态面板；广告阈值保存阻断会回落到具体输入行，目标 ACOS、高 ACOS、无订单点击、最低花费、降价比例、最大降价比例、最低 CPC 和最高 CPC 都有预留 `aria-live` 修复提示，不再让用户从全局错误句子里猜哪个框错了；`定时任务` 现在有首屏本地调度任务面板，刷新状态、手动触发前确认、执行中和失败都会固定显示在 `aria-live` 反馈里；下方控制器刷新、确认触发和行级启用/停用按钮也会显示 spinner、`aria-busy` 和同组锁定，并持续提示本地调度不会批准建议或写入 Amazon Ads；`工作范围` 现在有首屏任务面板和页面内范围表单，主按钮会保存当前日期、店铺、站点、批次和 ASIN 范围，字段变更会在本字段保留空间闪绿色确认，保存中/已保存/失败都有固定 `aria-live` 反馈，并可从页面直接打开顶部范围编辑浮层，不下推主工作区；`产品配置` 现在有首屏任务面板和当前范围产品批量目标 ACOS 工具栏，可勾选单行或全选产品，把百分比输入统一转换成本地阈值并通过 `saveProductConfig` 写入产品配置；成本、最低售价、目标净利率、目标 ACOS/TACOS 字段支持上/下方向键按步长微调，右侧稳定反馈位即时显示“已调整，失焦或回车保存”；固定成本、毛利空间、目标 ACOS/TACOS 摘要芯片会随草稿值实时变色，失焦或回车仍自动保存并显示“已保存/保存失败”。批量目标 ACOS 只更新本地产品配置，不审批建议、不执行广告动作、不写入 Amazon Ads；`运营事件` 现在也有首屏任务面板，记录 BD、Coupon、调价、库存和 Listing 变化时，提交后表单会立即清空并轻微回弹，同时显示正在写入本地上下文；保存失败会恢复刚才填写的草稿，保存成功后新事件卡片短暂高亮。数据采集在创建领星广告报表时会在填完起止日期后自动提交并关闭 Element 日期范围弹层，避免流程停在日期选择器等待人工点击；点击验证、重建、下载或导入动作时会立刻从右侧浮出监控抽屉，显示当前动作、页面验证、下载/导入步骤、阻断状态和证据路径，同时不拦截主页面后续按钮；底部四个采集动作按钮会在当前动作运行时切到 `处理中...`，显示 spinner、`aria-busy` 和蓝色条纹进度面，其他动作同步锁定但不会让运行中按钮看起来像普通灰色禁用。数据导入将已下载未入库文件明确标记为 `已下载待入库`；`数据导入与校验` 和 `关键词机会` 的长表已改用 `@tanstack/react-virtual` 虚拟滚动、sticky 表头、真实行号斑马纹、加载骨架和滚动容器；`关键词机会` 表头可点击排序，当前排序列显示 150ms 箭头旋转并暴露 `aria-sort`；筛选或排序变化会更新固定 `aria-live` 结果行，并让表格壳层执行 100ms 纵向淡入淡出；`数据导入与校验` 的 8 类报表表头也可按报表、真实文件、类型、大小、SHA-256、入库行数和状态排序，排序后更新 `aria-live` 汇总并触发 200ms blur/sweep 与行淡入刷新反馈；导入写入 SQLite 期间表格进入只读锁定态，禁用表头排序和行内打开表格按钮，并显示固定锁定提示；首屏导入任务、折叠区导入按钮和对账导出按钮也会在运行时统一切到 `处理中...`、显示 spinner、暴露 `aria-busy=true`，只有当前运行按钮带 `button-loading`，被锁定的同级按钮不会伪装成运行中，避免大批量导入行或关键词机会拖慢页面。Listing 优化页新增词根热力图矩阵，左侧按关键词/词根列出覆盖状态和推荐落位，关键词 rail 格块和右侧文本格都使用 strict containment 做高密 UI 局部隔离，右侧把标题、五点、后台词、详情/A+ 的当前文本与草案/建议并排高亮，点击词根即可定位覆盖空缺；每个区块还会把原文删除词标为红色删除芯片、草案新增词标为绿色芯片，生成草案时草案侧显示非挤压骨架波动，标题/五点超过字数限制时计数会红色闪烁；关键词输入、数据门槛、草案用途和生成/导出被合并成 `关键词与本地草案工作台`，缺真实广告数据时明确标为 `仅本地预览` 和 `待补齐真实广告数据`，不再把主界面草案叫作占位或让用户猜规则来源。广告量化首屏显示 AI 未运行、运行中、完成、失败或规则兜底反馈，指标卡可点击聚焦全部对象、无订单浪费、高 ACOS、出单、可扩量和待复核视图；非激活指标卡会降到 60% 透明度并在 hover/focus 恢复，帮助运营只看当前风险维度，同时同步过滤下方诊断表、对象时间线和复核队列；聚焦只改变本页视图，不改建议状态、不审批、不写入广告账户。执行回读页现在可在审批、执行前、执行后和回读步骤直接拖入或 Ctrl+V 粘贴截图，主进程会把图片写入当前回读工作包对应目录并自动回填路径和 ISO 时间，保存成功后目标卡立即显示缩略图、文件名和绿色 `证据已安全固定` 徽标，减少人工找目录/复制路径和“到底有没有存上”的摩擦；补执行证据时会显示“时间和值安全合同”，把时间顺序、前后值变化、回读一致、降价方向和截图不复用拆成可见状态卡，阻断项在导出前就能看到；导出证据、创建工作包、检查工作包、生成证据和校验证据这些证据链按钮也会在运行时显示导出中/创建中/检查中/生成中/校验中、spinner 和 `aria-busy`，并锁定同组动作防止重复点击。AI 设置会把旧的低 `maxTokens` 提升到结构化输出下限，并把广告策略诊断的证据引用归一化到当前 evidencePack 中真实存在的 ID；本次还修复了真实 AI 策略诊断反复落入“格式问题/规则兜底”的根因：OpenAI-compatible provider 现在会使用保存的 temperature/maxTokens，策略诊断与 JSON repair 都强制 8192 token floor，提示词输出合同改为当前证据驱动的具体 JSON 样例。真实 DeepSeek 验证见 `output\codex-evidence\ad-strategy-live-1782358641101.json`，结果为 `source=ai`、无 fallback。应用内广告执行仍保持 fail-closed，不做批量自动写入；后续每个广告动作必须绑定自己的店铺、站点、广告组合、广告活动、广告组、ASIN、对象和动作，并独立审批、截图和回读。

本轮继续补齐 数据采集 8 类报表勾选反馈：选择区现在用 已选 X/8 类 胶囊和进度轨道显示覆盖度，勾选/全选/只选缺失/清空都会写入 `aria-live` 状态；每个报表卡片被选中时有蓝色侧边锚点、focus-within 光圈和 checked 确认动画。这个反馈只说明当前将作用哪些报表，下载、重建、导入真实报表和 DB 入库门槛不变。

本轮追加的回读步骤条反馈已包含在同一包内：`执行回读` 的四步 tab 下方现在有 2px 蓝色滑块，会随当前步骤平滑平移，并在 reduced-motion 设置下关闭动画。它只是步骤定位反馈，不改变审批、截图、回读值或 `verify:ad-readback` 安全边界。

本轮继续补齐 `执行回读` 安全复选框反馈：审批确认和回读核验复选框现在有 hover、focus-within、按压 `scale(0.98)` 和勾选后的绿色确认脉冲，并在 reduced-motion 设置下关闭动画。这个反馈只说明本地输入已被界面接收，不代表审批、截图、回读值、导出或 `verify:ad-readback` 已通过。

本轮继续补齐 `今日看板` 首屏主行动反馈：点击主行动进入 150ms `转跳中...` 状态时，`数据健康` 红绿灯网格会同步触发 180ms 蓝色边框脉冲和扫光刷新反馈，并在 reduced-motion 设置下关闭动画。这个刷新只表示看板已接收跳转动作，不改变数据、建议、审批或广告执行状态。

本轮继续补齐 `OperatorTaskPanel` 的组级 busy 锁定：任一首屏任务动作进入运行态后，整个动作组立即禁用，防止用户在保存、导入、生成或跳转尚未返回时继续点旁边按钮制造竞态。只有真正运行的按钮显示 `处理中...` 或业务化运行文案、spinner、`button-loading` 和 `aria-busy=true`；被锁定的兄弟按钮保持普通禁用态，不会伪装成也在执行。

本轮继续补齐全局导航交接反馈：侧边栏点击和页面内 `amazon-ai-ops:navigate` 跳转事件都会进入 150ms `转跳中...` 状态，目标导航项显示 pending 芯片并暴露 `aria-busy=true`，同组导航按钮临时锁定；主画布右上角显示绝对定位的 `转跳中...` 状态浮层，不挤压 ScopeBar 或页面内容，并在 reduced-motion 设置下关闭动画。

本轮继续补齐产品级入口闭环：旧 `product-config` 深链仍可打开，但侧边栏会把它归属并高亮到 `产品管理`；产品管理里的 `补齐产品配置`、`打开完整配置` 和交付矩阵里的产品上下文修复入口都回到 `产品管理`，避免用户被带到无导航锚点的旧配置页。这个改动只收敛信息架构和修复入口，不改变本地产品配置的安全边界：不审批建议、不生成 Ads 动作、不写入 Amazon Ads。

本轮继续补齐 `产品管理` 产品卡片锁定反馈：每张产品卡片现在显示 `点击锁定` / `已锁定` 小标签，选中卡片暴露 `aria-pressed=true`、触发短暂锁定脉冲，并把“工具栏已解冻、后续页面按该 ASIN 读取数据库”写入固定 `aria-live` 状态行。这个反馈只说明当前产品上下文已被选择，不保存产品配置、不生成建议、不审批、不写入 Amazon Ads。

本轮继续补齐 `产品管理` 保存动作反馈：点击 `保存产品信息` 后按钮立即切到 `保存中...`，显示 spinner、`button-loading` 和 `aria-busy=true`，同时锁定 `打开完整配置`，但旁边按钮不会伪装成也在执行。这个反馈只覆盖本地产品信息保存，不生成建议、不审批、不写入 Amazon Ads。

本轮继续补齐 `产品配置` 直接动作反馈：点击 `保存完整产品配置` 后按钮立即切到 `保存中...`，显示 spinner、`button-loading` 和 `aria-busy=true`，`补充运营事件` 和 `进入广告量化` 会作为普通同级按钮锁定；批量目标 ACOS 的 `应用到 X 个产品` 运行时也会切到 `批量应用中...` 并显示同样 busy 合同。这个反馈只覆盖本地产品目标维护，不生成建议、不审批、不写入 Amazon Ads。

本轮继续补齐 `AI 设置` 广告阈值保存动作反馈：点击 `保存广告阈值` 后按钮立即切到 `保存中...`，显示 spinner、`button-loading` 和 `aria-busy=true`；未接入保存接口时仍是普通禁用态，不伪装成正在运行。这个反馈只覆盖本地规则配置保存，不生成建议、不审批、不写入 Amazon Ads。

本轮继续补齐 `运营事件` 内联保存动作反馈：点击底部 `保存到上下文` 后按钮立即切到 `保存中...`，显示 spinner、`button-loading` 和 `aria-busy=true`；事件信息未填完整时仍是普通禁用态，不伪装成正在运行。这个反馈只覆盖本地运营事件上下文保存，不生成建议、不审批、不改 Listing、不写入 Amazon Ads。

本轮继续补齐 `Listing 优化` 词根热力图聚焦反馈：左侧词根按钮现在暴露 `aria-pressed`，点击后左侧词根、右侧命中区块和命中 token 会短暂闪烁，底部固定 `aria-live` 状态行读回当前词根命中的标题/五点/后台词/详情区域。这个反馈只用于本地覆盖复核，不提交 Amazon，不自动改写 Lingxing Listing。

本轮继续补齐 `Listing 优化` 本地动作按钮反馈：保存手工 Listing、从领星读取、生成本地草案、导出草案现在统一使用 running 合同；当前运行按钮会切到保存中/读取中/生成中/导出中，显示 spinner、`button-loading` 和 `aria-busy=true`，同组其他本地动作同步锁定但不伪装成运行中。这个反馈只覆盖本地 Listing 工作流，不提交 Amazon，不覆盖 Lingxing。

本轮继续补齐 `定时任务` 控制器动作反馈：下方控制器刷新、确认触发、行级启用/停用现在统一使用 running 合同；当前运行按钮会切到正在刷新/执行中/启用中/停用中，显示 spinner、`button-loading` 和 `aria-busy=true`，同组其他调度动作同步锁定但不伪装成运行中。这个反馈只覆盖本地调度控制，不审批建议、不改 bid、不暂停广告、不写入 Amazon Ads。

本轮继续补齐登录入口微反馈：点击 `登录并进入 Ads` 后按钮会立即切到 `正在确认 ERP 和 Ads 会话...`，显示 spinner、设置 `aria-busy=true` 并锁定二次点击；账号密码保存/未保存/加载提示统一进入固定 `aria-live` 状态行，避免登录入口成为主进程凭证沙箱之外的静默等待点。

本轮继续补齐 `优化建议` 批量选择反馈：待处理建议表的勾选框现在有键盘 focus 光圈和 checked 确认动画，批量审批工具条的 `X/N` 计数改为稳定胶囊并在选中后短暂弹出确认，同时用 `aria-live` 明确提示当前可选数量或已选数量。这个反馈只说明选择动作已被界面接收；批量送审仍只传递正式可审批建议 ID 到 `审批中心`，不审批、不改推荐状态、不执行 Ads。

本轮继续补齐 `优化建议` 直接动作按钮反馈：折叠区 `刷新建议`、处理路径里的 `生成解释`、空建议面板里的 `生成优化建议` 都会在运行时切到 `刷新中...` 或 `生成中...`，显示 spinner、`button-loading` 和 `aria-busy=true`；缺真实范围或 pipeline 正在读取时仍是普通禁用态，不伪装成正在运行。这个反馈只覆盖建议页本地刷新/生成等待状态，不绕过真实报表门槛、不审批、不写入 Amazon Ads。

本轮继续补齐 `交付验收` 回读工作包动作反馈：`导出交付包`、`导出数据口径核对`、`创建回读工作包`、`检查工作包`、`生成回读证据`、`校验回读证据`、`用回读证据刷新最终验收` 现在统一使用 running 合同；当前运行按钮切到导出中/创建中/检查中/生成中/校验中/刷新中，显示 spinner、`button-loading` 和 `aria-busy=true`，同组交付动作同步锁定但不伪装成运行中。这个反馈只覆盖本地交付与回读证据工作流，不补齐截图证据、不绕过 verifier、不写入 Amazon Ads。

本轮继续补齐 `执行回读` 证据链动作反馈：`导出回读证据`、`创建回读工作包`、`检查工作包`、`生成回读证据`、`校验回读证据` 现在统一使用 running 合同；当前运行按钮切到导出中/创建中/检查中/生成中/校验中，显示 spinner、`button-loading` 和 `aria-busy=true`，同组证据链动作同步锁定但不伪装成运行中。这个反馈只说明本地文件/校验任务正在处理，不代表回读证据已通过或可交付。

| 项目 | 状态 | 证据/位置 |
|---|---:|---|
| v1.5 基线合并 | 已完成 | v1.5 业务后台重构和最终验收已合入 `master` |
| 本轮 high-fidelity UI 收尾改动 | 已完成 | 业务域导航与激活光条、主窗口降噪、紧凑状态标签、AI 输出合同标签、共享业务数据管道 300ms scope 防抖、OperatorTaskPanel 主行动 loading/spinner/disabled 合同、优化建议刷新/生成直接动作按钮 busy 反馈、交付验收回读工作包直接动作按钮 busy 反馈、执行回读证据链动作按钮 busy 反馈、定时任务首屏本地调度反馈和控制器/行级按钮 busy 反馈、Listing 表格化录入、Listing 词根热力图矩阵、Listing 草案 diff/骨架/超字数反馈、Listing 本地保存/读取/生成/导出按钮 busy 反馈、数据采集监控抽屉与 Canvas 小电视预览、数据采集底部动作按钮 `aria-busy`/spinner/条纹进度反馈、审批决策按钮 `处理中...`/spinner/`aria-busy` 反馈、数据导入直接导入/导出按钮 `处理中...`/spinner/`aria-busy` 反馈、交付验收回读阻断直达补证与字段级红圈定位、长表虚拟滚动、虚拟表格真实行号斑马纹和行按压/focus反馈、关键词机会表头排序与筛选淡入反馈、数据导入表头排序、导入只读锁定与 200ms blur/sweep 行淡入反馈、状态红绿灯卡片 hover +2px 浮起投影反馈、MicroStepper 状态点和待处理旋转环反馈、ProgressiveDetails 与原生 details 折叠明细标题交互反馈、共享表单行聚焦外发光反馈、加密记住账号密码、登录入口按钮 busy/spinner/`aria-busy` 与固定凭证状态反馈、AI/导入首屏反馈、广告回读截图拖拽/Ctrl+V 存证、拖入态高亮、固定后缩略图和绿色固定徽标、执行回读时间/值安全合同可视化、执行回读安全复选框 hover/focus/checked 确认反馈、canonical 日级口径说明、Windows build、无安装版启动 smoke、manifest-driven final-readiness 和 READY safety 已接入 |
| 审批中心盖章与队列反馈 | 已接入 | 批准、拒绝、阻断会在首屏显示 `SEALING` / `PASSED` / `REJECTED` / `BLOCKED` 类盖章式状态；当前批准/拒绝按钮在提交中会切到 `处理中...`，显示 spinner、`aria-busy=true` 和 `button-loading`，其他决策按钮同步锁定。批准或拒绝成功后，当前行会按通过/拒绝色调滑出 180ms 并先从本地队列移除，随后刷新真实审批队列。三态决策按钮支持 hover/focus 组级弱淡化，当前按钮保持高亮，其余可用动作降到 40% 透明度，降低误点风险。该反馈只代表本地审批决策状态，不代表 Ads 已执行；真实广告动作仍必须进入人工执行、截图和回读 verifier。 |
| 优化建议状态桶与批量送审 | 已接入 | `优化建议` 首屏状态桶可点击过滤主表：全部、缺证据阻断、需人工复核、正式可审批；切换视图会清空勾选，避免隐藏行被批量提交。待处理建议表支持勾选当前视图内证据完整且可进入正式审批的建议，checkbox 有 focus/checked 微反馈，批量审批工具条用 `X/N` 计数胶囊和 `aria-live` 状态确认选择已生效，并用 `批量提交 X 项到审批中心` 带入审批上下文；折叠区刷新、流程条生成和空建议面板生成按钮现在运行时显示 `刷新中...` / `生成中...`、spinner、`button-loading` 和 `aria-busy=true`。`审批中心` 会显示批量送审提示并自动定位首个匹配队列项，但仍逐条重新校验证据、安全边界和人工盖章，不执行 Ads 动作。 |
| 广告量化指标聚焦与 AI 运行反馈 | 已接入 | `广告量化` 首屏指标卡支持点击聚焦：全部对象、浪费超支、高 ACOS、出单对象、可扩量、待复核。聚焦后非激活指标卡降到 60% 透明度并在 hover/focus 恢复，避免首屏指标全部抢注意力；下方实体诊断表、产品/广告对象阶段时间线和复核队列同步显示 `visible/total`。运行 AI 阶段诊断时，反馈面板现在带 `aria-busy=true` 和受控雷达扫线/脉冲，页面内 `运行 AI 阶段分析` 与反馈卡 `重新运行 AI` 按钮会切到 `AI 分析中...`、显示 spinner、暴露 `aria-busy=true` 和 `button-loading`，生成建议入口在 AI 运行中只作为普通禁用同级按钮锁定。产品汇总区已将原工程占位指标改成 `浪费/高风险花费`，显示金额、占当前产品花费比例和高风险对象数；缺日级数据时提示先导入 8 类真实报表。该聚焦、运行反馈和按钮锁定只改变本页视图与本地诊断等待状态，不改变建议状态、不审批、不写入 Ads。 |
| 执行回读时间/值合同 | 已接入 | `执行回读` 的补证据步骤新增 `时间和值安全合同` 状态卡，实时显示时间顺序、前后值变化、回读值一致、降价方向和截图不复用五类判定；这些判定复用导出前校验规则，任何阻断项都只允许导出缺口草稿，不能伪装成最终执行完成证据。 |
| High-fidelity UI / AI contract rebuild | APP_READY | 数据采集底部 `下载已创建`、`重建已选`、`重建全部 8 类`、`导入本地` 动作按钮现在有统一 `处理中...`、spinner、`aria-busy` 和蓝色条纹进度反馈；`数据导入与校验` 首屏导入、折叠区导入和对账导出按钮现在也统一使用 `处理中...`、spinner、`aria-busy` 和 `button-loading` 运行态；设置页显示固定 AI 输出合同标签 `广告诊断 v1`、`广告解释 v1`、`Listing 草案 v1`、`异常回退规则`，高级设置不再显示 raw schema ID，人设字段只控制表达风格；结构化 AI 输出预算低于 8192 会自动提升，广告策略诊断会过滤不存在的 evidenceRefs 并补入当前 evidencePack 中可追溯证据；`AI+规则建议输入检查`、推荐、审批、范围、数据、Listing 等页面使用标签/状态灯/表格化控件减少首屏长文案，状态红绿灯卡片支持 hover +2px 浮起投影反馈，ProgressiveDetails 与原生 details 折叠明细标题支持 hover/focus/active 与 `展开`/`收起` 状态芯片；`手工录入当前 Listing` 改成 `基础信息`、`标题`、`五点`、`详情与搜索词` 表格化编辑器，新增词根热力图矩阵并把关键词 rail 格块隔离为 `contain: strict`，同时把当前文本与草案/建议按标题、五点、后台词、详情/A+ 并排高亮，草案区还能显示红色删除词、绿色新增词、生成中骨架波动和超字数红色告警；`数据采集` 的验证、下载、重建、导入动作会立刻打开右侧监控抽屉并展示步骤/阻断/证据路径，抽屉不推挤布局也不拦截主操作；`数据导入与校验` 的导入和对账导出直接按钮统一使用 `处理中...`、spinner、`aria-busy` 和 `button-loading` 运行态；`数据导入与校验` 和 `关键词机会` 的重型表格使用 `VirtualDataTable` 虚拟滚动、sticky 表头、加载骨架和滚动边界；`关键词机会` 表头支持点击排序、150ms 箭头旋转和 `aria-sort` 语义，筛选或排序变化会触发 100ms 表格淡入反馈和 `aria-live` 结果计数；`数据导入与校验` 报表表头排序会同步更新 `aria-live` 汇总，并触发 200ms blur/sweep 与行淡入反馈；领星创建报表日期范围输入会自动提交并关闭弹层。验证：desktop typecheck、renderer build、`pnpm run smoke:business-ui-current`、`pnpm run smoke:package-launch`、`pnpm run verify:ad-execution`、manifest-driven final-readiness 和 READY safety |
| AI 设置连接测试反馈 | 已接入 | `AI 设置` 页面新增首屏 `OperatorTaskPanel`，`保存 AI 设置` 和 `测试 AI 连接` 使用共享 busy/spinner/disabled 契约；保存完成、测试中、测试通过和测试失败固定显示在 `aria-live` 气泡，AI 任务消息不再重复出现在底部状态面板。 |
| 定时任务本地调度反馈 | 已接入 | `定时任务` 页面新增首屏 `OperatorTaskPanel`，默认主行动是刷新调度状态；点击立即执行只会进入人工确认，确认后也只触发本地下载/导入/建议生成任务，不会批准建议、改 bid 或写入 Amazon Ads。刷新中、等待确认、执行中、失败和最近结果都固定显示在 `aria-live` 反馈行。 |
| 产品管理工作流 | 已接入 | `运营总览` 新增 `产品管理`，操作员先选产品再进入广告量化、优化建议、运营事件、关键词机会和 Listing。首屏 `OperatorTaskPanel` 会提示未锁定产品、读取中、保存中、缺指标或可进入 AI 量化；产品卡片显示 `点击锁定` / `已锁定` 标签，选中卡片暴露 `aria-pressed=true`、短暂锁定脉冲和固定 `aria-live` 状态读回；`凭证映射通过` 芯片可 hover/focus 查看 Main Sandboxed ID 和 UI 不留存明文说明；选择产品会同步当前 `scope.asin`，页面不再暗中选择第一条产品。产品维护表单可保存产品基础信息和成本/阈值配置，产品页按 ASIN 展示 `ad_daily_metrics` 聚合出来的日级广告数据，产品时间线同时显示当前产品事件、广告对象事件和全局运营事件，避免回到裸 ASIN 或跨产品混看。 |
| 工作范围确认反馈 | 已接入 | `工作范围` 页面新增首屏 `OperatorTaskPanel` 和页面内 `范围表单`，主按钮显式保存当前范围并显示保存中、已保存或失败；表单内店铺、站点、日期、ASIN 和批次字段改变时会在字段内保留空间闪绿色确认，不挤压布局；页面内 `编辑范围` 仍可直接打开顶部 ScopeBar 浮层编辑器，不下推主工作区；下一步按钮按当前报表/导入状态跳转到数据采集、导入校验或广告量化。 |
| 业务数据管道防抖 | 已接入 | `useBusinessDataPipeline` 首屏加载和显式 reload/data-updated 立即执行；仅 ScopeBar/工作范围连续修改日期、店铺、站点、ASIN、批次等 scope-only 变化时进入 300ms 防抖合并窗口，并取消过期定时器，避免高吞吐页面重复触发当前范围 IPC 查询。 |
| 产品配置批量目标与即时保存 | 已接入 | `产品配置` 页面新增首屏 `OperatorTaskPanel`，当前范围产品列表可勾选单行或全选，使用 `目标 ACOS (%)` 工具栏批量应用到所选产品；输入会从百分比归一化为本地小数阈值，并复用 `saveProductConfig` 保存，不审批建议、不执行广告动作、不写入 Ads。成本、最低售价、目标净利率、目标 ACOS/TACOS 输入框支持上/下方向键微调，右侧固定反馈位会立即显示“已调整，失焦或回车保存”；固定成本、毛利空间、目标 ACOS/TACOS 摘要芯片随草稿值实时变色，失焦或 Enter 仍自动保存并显示保存中、已保存或失败。 |
| 运营事件任务反馈 | 已接入 | `运营事件` 页面现在把“记录 BD/Coupon/调价/库存/Listing 变化”作为首屏任务，主按钮使用 OperatorTaskPanel busy/disabled/spinner 合同，底部内联保存按钮改为 `保存到上下文` 以避免重复主行动，并在本地保存中显示 `保存中...`、spinner、`button-loading` 和 `aria-busy=true`；提交后表单立即清空并回弹，页面提示正在写入本地上下文，保存失败会恢复刚才填写的草稿，保存成功后最新事件卡片短暂高亮。 |
| 本地测试 | 增量通过 | 本轮重点测试：业务数据管道 300ms scope 防抖、账号密码保存、工作范围首屏保存反馈、页面内范围表单字段确认、产品管理、产品配置批量目标 ACOS/成本回填/上下键微调、产品级看板、AI 阻断提示、广告量化、导入反馈、产品上下文和业务 UI smoke 通过；READY/final-readiness 脚本和 package launch smoke 通过 |
| 类型检查 | 通过 | `pnpm --filter @amazon-ai-ops/desktop run typecheck` 通过 |
| 桌面构建 | 通过 | `pnpm --filter @amazon-ai-ops/desktop run build:win` 通过；native rebuild 已关闭，打包日志显示 `skipped dependencies rebuild` |
| 当前业务 UI 冒烟 | 通过 | `pnpm run smoke:business-ui-current` 通过，汇总证据 `output\codex-evidence\current-business-ui-smoke-1782801751321.json` |
| 当前安装包证据 | 已进入 final-readiness | installer `apps\desktop\release\AmazonAIOpsAgent-1.5.0.exe`，大小 `83126959`，SHA-256 `4CD831C9E7A2C6AF9B84E989894E596039DE71A580CDAD83472663840814745C`；portable `apps\desktop\release\AmazonAIOpsAgent-1.5.0-portable.exe`，大小 `82961210`，SHA-256 `8696F23C4B91875745B46D4EF0CB99436D3A21B2B0E9770FB10D0E244BB86D15` |
| 当前安装/免安装启动复验 | 通过 | `pnpm run smoke:package-launch` 通过，证据 `output\codex-evidence\package-launch-smoke-1782801832587.json`；`win-unpacked` 到达 `ipc-ready/window-created`，portable 从 Temp 解压并启动子进程 |
| 关键词/Listing v1.5 工作流 | 结构完成，真实详情读取和 AI 草案已验证 | 左侧菜单已按后台业务域拆成 `运营总览`、`数据与量化`、`广告执行`、`关键词与 Listing`、`系统与交付`。`产品管理` 是 ASIN 级运营入口；`数据采集`、`数据导入与校验`、`广告量化`、`优化建议`、`审批中心`、`执行回读`、`关键词机会`、`Listing 优化` 各自独立承载业务流程，`交付验收` 只汇总证据，不承载日常操作。Listing 页已接入读取、建议、采纳、草案、词根热力图矩阵、差量芯片、生成骨架、字数告警和导出流程；手工保存、领星读取、草案生成和草案导出都有明确 running/spinner/`aria-busy` 反馈；`关键词与本地草案工作台` 把关键词输入、真实数据门槛、草案用途和生成/导出放在同一首屏区块，缺真实广告数据时只显示 `仅本地预览`，不会把草案误称为占位或交付证据；真实详情页读取和 Listing AI 草案均有最终 READY 证据 |
| 领星下载中心采集 | full-8 真实 E2E 通过 | 当前安装版完成 ERP -> Ads 会话确认、启用后诊断 id `27` 通过；full-8 批次 `batch_20260609045655853_ft8uda` 下载 8/8、失败 0，DB/manifest/文件系统/验收审计均通过 `pnpm run verify:v15-delivery -- output\codex-evidence\desktop-live-full-8-e2e-2026-06-09.json`。当用户切到新日期范围/店铺/站点且缺少同范围下载中心诊断时，`重新获取完整 8 类报表` 会先自动执行只读页面验证，验证通过后继续创建并下载 8 类报表；创建报表页填完起止日期后会自动提交并关闭日期范围弹层；页面右侧监控抽屉会在动作触发后立即展示进行中、阻断或完成状态 |
| 广告指标口径 | 通过 | 当前 AppData 真实数据链路已通过：批次 `batch_20260612020905629_gkchz1`，范围 `2026-06-01` 至 `2026-06-12` / `FT-US-US` / `US`，8/8 真实报表文件，2416 行入库指标，权威 `user_search_term` 口径 spend USD `617.87`、orders `19`、sales `1089.79`。campaign/ad_group/placement/advertised_product/user_search_term 是不同维度展开，不能直接相加 |
| 广告建议执行 | 当前合同真实 readback 已通过，应用内执行仍 fail-closed | UI 的列表执行按钮仍显示为“生成阻断审计”，避免未绑定动态目标时批量写入广告账户；状态桶过滤只改变当前表格视图，批量送审只把当前视图内可审批建议 ID 传给审批中心，不改变推荐状态，也不执行 Ads。真实执行验收通过的是一次人工 Ads UI 低风险动作：FT-US 暂停关键词 `door lock`，live bid `1.30 -> 1.17`，并完成 before/after/reload readback。源建议证据为 `1.63 -> 1.46`，但现场 live bid 已低于源建议值，因此没有写入 `1.46`；本次只执行额外降低的验证动作。建议生成已接入 DeepSeek/OpenAI-compatible 解释链：有 Key 时记录 `explanationSource=ai`、AI explanation/model/risk，缺 Key 或失败时保留规则建议并显示 fallback |
| 广告建议 AI 解释证据 | 当前 packaged app 通过 | `output\codex-evidence\installed-ad-ai-explanation-packaged-final-20260617.json` 由本轮 packaged app 生成并通过 `node scripts\verify-ad-ai-explanation-evidence.js <evidence>`；证据证明真实 DeepSeek/OpenAI-compatible 设置已配置、AI 连接测试成功、只读安全标记、未修改 AI 设置、2 条正式建议均有 store/site/ASIN/entity/action、AI 中文解释、AI model、真实报表 source file 和 source row |
| 广告 readback 证据契约 | 当前合同已补强并通过 | 历史 `output\codex-evidence\real-ad-execution-readback-candidate-rec-1.json` 只能作为基线参考。当前 manifest 选用 `output\codex-evidence\real-ad-execution-readback-candidate-rec-4-current-pass.json`，该证据绑定真实报表 `source.sourceFiles`、原始报表 `source.sourceRow=410`、显式审批凭证、before/after/reload 三份独立截图、live bid 来源说明、`execution.channel=manual_ads_ui`、`appExecutorUsed=false` 和时间顺序。当前候选工作包位于 `output\codex-evidence\ad-readback-session-rec-4-current`，用于保存本次审批、截图和填写材料。执行回读页支持审批、before、after、readback 截图拖拽或 Ctrl+V 存证，并在拖入时显示 `松开即可存证` 高亮，图片会写入工作包目录并回填路径/时间；补证据步骤会用状态卡实时标出审批≤执行前≤执行动作≤执行后≤回读、执行前后值必须变化、回读值必须等于执行后值、降价动作必须变小、截图不能复用；交付验收页和 CLI 仍用中文分组显示未填写项，后续任意品、广告组或投放对象都必须填写自己的动态 target/source/before/after/readback 字段，不能复用本次样例 |
| 真实广告 readback 操作手册 | 已新增 | `docs\REAL_AD_READBACK_RUNBOOK.md` 面向操作员列出当前候选动作、禁止执行条件、执行前/执行后必须填写字段、时间顺序和最终验收命令；该手册不授权自动写入，只用于人工低风险动作的证据闭环 |
| DeepSeek 真实连接 | 通过 | `output\codex-evidence\deepseek-live-1781066552798.json` 通过 `pnpm run verify:ai-live`，真实 provider 返回内容和 token usage；脚本已显式关闭 DeepSeek thinking 以避免短连接测试被 reasoning 消耗 |
| 广告策略诊断真实 AI | 通过 | `pnpm run verify:ad-strategy-live -- --input output\codex-evidence\ad-strategy-live-input-current-scope.json` 生成并验证 `output\codex-evidence\ad-strategy-live-1782358641101.json`；当前范围 `2026-05-21` 至 `2026-06-23` / `FT-US-US` / `US` / `B0GTTJFQTM` 返回 `source=ai`、`schemaVersion=ad_strategy_diagnosis_v1`、无规则 fallback，且记录请求合同 `response_format=json_object`、temperature `0.3`、maxTokens `8192` |
| AI 结构证据 | 结构通过，不给 READY credit | `pnpm run run:ai-structural-mock` 最新生成并通过 verifier：`output\codex-evidence\structural-ai-openai-compatible-mock-1781703077556.json`；该结构证据使用 `/chat/completions` 和 `response_format: json_object`，只证明 OpenAI-compatible 请求/响应形状、Listing AI JSON 映射和脱敏策略，明确 `NO_FINAL_READINESS_CREDIT`，不能替代真实 DeepSeek Key |
| Lingxing Listing 页面读取 | 真实详情页证据通过 | 主进程 IPC、preload、UI 按钮、指定 URL 读取、字段完整性证据已接入；读取区分 `partialReady` 和 `fullContentReady`，并支持显式 `只读探测详情页`：只从当前 ASIN 行点击唯一安全详情/查看/编辑候选，校验同域和同 ASIN，不点击保存/发布；`output\codex-evidence\source-listing-read-detail-probe-2026-06-09-merged-detail.json` 通过 `pnpm run verify:listing-read`，证明源代码版通过 ERP 登录态进入 `https://erp.lingxing.com/erp/editListing`，同 ASIN `B0GTTJFQTM`，读取标题、10 条五点和后台词，`fullContentReady=true` |
| Listing AI 草案证据 | 通过 | `output\codex-evidence\installed-listing-ai-draft-user-key-2026-06-10.json` 通过 `pnpm run verify:listing-ai-draft -- <evidence>`；证据证明本地 Listing 草案模式无广告写入/无 full-8 报表，AI 连接成功，基于 accepted suggestion 生成 `source=ai` 草案，无 fallback，含 `AI reason`，并恢复 AI 设置 |
| 最终就绪聚合门 | 当前通过 | `output\codex-evidence\final-readiness-20260630144400.json` 为 2026-06-30 high-fidelity UI / AI/import feedback / data-import row-fade refresh / credential refresh / 产品配置批量目标 ACOS / 数据采集动作按钮 busy 反馈 / Listing 本地动作按钮 busy 反馈 / 定时任务控制器按钮 busy 反馈 / 广告量化指标聚焦降噪与 AI 运行雷达反馈 / 今日看板主行动反馈 / 执行回读安全复选框确认反馈 / 执行回读证据链动作按钮 busy 反馈、关键词机会排序与筛选反馈 / ProgressiveDetails 折叠反馈 / 全局字体栈和表格行高契约后的 manifest-driven `APP_READY`，manifest 为 `output\codex-evidence\v15-final-readiness-evidence-manifest-20260630144400.json`，包含 `Release package hash` 与 `Package launch smoke` 两个安装包门槛 |
| READY 安全门 | 通过 | `pnpm run verify:v15-ready-safety --final-readiness output\codex-evidence\final-readiness-20260630144400.json --bundle-manifest output\delivery-bundles\v15-delivery-bundle-20260630144400-ready\delivery-bundle-manifest.json` |
| 交付证据包 | 当前 READY | `output\delivery-bundles\v15-delivery-bundle-20260630144400-ready`；历史 `output\delivery-bundles\v15-delivery-bundle-2026-06-18-portable-fix-ready` 只作基线参考 |
| 交付证据脚本 | 通过 | 当前应用内执行回读 smoke 覆盖 session 创建、审批盖章反馈、结构检查和中文现场证据未填写提示、打开 `session-input.json` 填写文件、打开 `session-input-guide.md` 填写说明、回读证据生成、回读证据 verifier 和路径展示：`output\codex-evidence\business-ui-ad-execution-smoke-1782434665074.json`；`交付验收` 页新增 `刷新最终验收` 和 `广告回读补证`，可从失败 readback gate 直接创建工作包、检查工作包、显示 `结构通过，现场证据待填写` 和中文缺失字段、生成回读证据、校验回读证据、用该证据刷新最终验收，并打开候选证据/工作包/操作清单/Ads UI 定位单/填写文件/填写说明，settings/delivery smoke 已覆盖：`output\codex-evidence\business-ui-settings-delivery-smoke-1782434681112.json`；当前 final-readiness、bundle export 和 READY safety 已刷新 |

## 核心目标

当前目标不是简单把功能按钮补齐，而是把 v1.5 做成可审计、可回放、可失败闭环的本地桌面工作流：

| 目标 | 说明 |
|---|---|
| 保留现有代码 | v1.2 基础模块已恢复并保留，v1.5 在现有架构上补齐 |
| 缺失项显式化 | 缺口记录在 `docs/MISSING_MODULES_MATRIX.md`、`docs/V1_5_ACCEPTANCE_MATRIX.md` |
| 不猜测页面结构 | 领星页面模型只能从真实浏览器证据固化 |
| 失败可审计 | 诊断、截图、DOM、Trace、manifest、审计导出均本地保存 |
| 自动化 fail-closed | 未验证选择器、未登录、证据过期或不匹配时不得静默采集 |

## 已完成模块

| 模块 | 完成情况 |
|---|---|
| 共享 v1.5 类型 | `packages/shared-types/src/v1_5.ts` 已新增并导出 |
| 领星报表采集器 | 8 类广告报表定义、批次 manifest、文件校验、失败重试、单报表重试、模拟 E2E |
| 下载中心诊断 | 页面诊断、截图、DOM 快照、selector candidates、action selector 检查、证据包导出 |
| 页面模型覆盖 | 本地 override 保存、重置、备份、校验、启用审计 |
| 采集预检 | 启动采集前检查页面模型、同店铺/站点/日期范围诊断证据、截图/DOM 文件、浏览器登录状态 |
| 后台菜单与 v1.5 收尾 | 修复 `验证页面` 点击区域被相邻面板覆盖的问题；移除旧版 `daily_report_download` 定时入口；新增真实采集验收门和单报表验证入口；把原 `v1.5 工作台` 拆为按业务域分组的后台菜单：`广告运营` 下放 `广告报表/优化建议`，`关键词与 Listing` 下放 `关键词机会/Listing 优化`，`交付与系统` 下放 `交付验收/定时任务/设置`；`广告报表` 和 `优化建议` 已增加同一已验证 full-8 范围预设，减少跨页重复手填范围 |
| 产品管理 | 产品列表、当前产品范围、产品/全局/广告对象时间线和跨页面入口已接入；工作范围页提供首屏确认范围任务和保存反馈；选择产品会更新 `scope.asin`，广告量化、优化建议、运营事件、关键词机会和 Listing 沿用同一产品上下文；产品配置页提供首屏保存目标任务、批量目标 ACOS 行选择工具栏、上/下方向键微调、实时健康度芯片和失焦/回车即时保存反馈，运营事件页提供首屏记录任务、提交即清空回弹、失败恢复草稿和保存后的新卡片高亮反馈 |
| 关键词导入 | Search Term/SQP/keyword report 映射、诊断、重复导入策略、错误行导出 |
| 关键词机会 | ASIN + normalized keyword 聚合、评分、风险过滤 |
| Listing 分析 | 手工/Excel 导入、覆盖分析、建议生成、接受/忽略、AI/规则草稿 |
| 导出 | CSV/XLSX/Markdown、验收审计、预检证据包、诊断证据包 |
| SQLite | v1.5 批次、文件、关键词、Listing、诊断、草稿等表已补齐 |
| 桌面 UI/API | IPC、preload、v1.5 分区后台界面已接入；打包依赖包含 `better-sqlite3` native loader 所需运行时依赖 |

## 真实浏览器验证结论

| 项目 | 当前证据 | 结论 |
|---|---|---|
| ERP 登录入口 | `https://erp.lingxing.com/` 真实登录页字段为 `input[name="account"]`、`input[name="pwd"]`、`button.loginBtn` | 旧的 `www.lingxing.com/login` 和 `username/password` selector 不可用 |
| Ads 系统入口 | ERP 顶部“广告”进入 `https://ads.lingxing.com/home`，页面显示“领星广告系统” | ERP 登录和 Ads 会话必须分别校验；桌面登录流程现在先进入 ERP，再从 ERP 广告入口进入 Ads，不再先直连 Ads URL |
| Ads 下载中心真实 URL | `https://ads.lingxing.com/ak_download/download_center/download_report_log/index`，标题“下载中心” | 已固化为内置 page model 的首选候选 URL |
| 下载中心已读证据 | 页面存在“创建报告”“搜索店铺”“报告类型”“生成成功”“下载”，下载链接类名 `.JS-download-report` | 已通过只读诊断和真实 create/ready/download canary/full-8 复验 |
| 创建报告页面 | `create_report` 页面存在店铺选择、报告名称、报告类型、开始/结束日期、每日明细、全部指标、生成报告按钮 | 已通过安装版真实生成/下载链路验证 |
| 下载中心 action selectors | 内置 `actionSelectors` 已验证，`requiresManualVerification: false` | 8/8 单报表 canary、启用后诊断、full-8 E2E 均通过 |
| 真实 8 报表 E2E | `output/codex-evidence/desktop-live-full-8-e2e-2026-06-09.json` | 已完成，批次 `batch_20260609045655853_ft8uda`，8 downloaded / 0 failed |
| Listing 列表页只读读取 | `output/codex-evidence/source-listing-read-2026-06-09-candidates.json` | 源代码版通过同一登录态只读打开 ERP Listing 列表页，提取 ASIN/title 并保存截图；该页面不暴露五点描述和后台搜索词，只作为 partial 证据 |
| Listing 详情页只读读取 | `output/codex-evidence/source-listing-read-detail-probe-2026-06-09-merged-detail.json` | 源代码版从列表页同 ASIN 行只读点击 `编辑在线商品`，进入 `https://erp.lingxing.com/erp/editListing`，读取标题、10 条五点、后台词并通过 `verify:listing-read` |
| 真实失败 Trace 内容 | 需要真实失败路径触发 | 未完成 |

## 真实浏览器验证记录

用户明确要求必须打开浏览器验证，不能猜测。已使用 Playwright 持久化 Chromium 会话完成两轮验证。

第一轮未登录候选 URL 验证产物：

`output/playwright/lingxing-download-center-2026-06-03T01-35-38-629Z/`

| 候选 URL | 实际结果 | 结论 |
|---|---|---|
| `https://erp.lingxing.com/download-center` | 跳转到 `https://erp.lingxing.com/`，标题为“领星ERP - 跨境电商管理系统”，页面内容为账号/微信登录 | 当前浏览器会话未登录 |
| `https://www.lingxing.com/download-center` | 停留在官网 URL，页面提示“对不起，您访问的页面不存在” | 官网路径不可用 |
| `https://erp.lingxing.com/report/download` | 跳转到 `https://erp.lingxing.com/`，页面内容为登录 | 当前浏览器会话未登录 |

第二轮真实登录和 Ads 下载中心验证产物：

| 证据目录 | 证明内容 |
|---|---|
| `output/playwright/lingxing-login-probe-2026-06-03T01-56-31-491Z/` | ERP 登录页真实字段和按钮 selector |
| `output/playwright/lingxing-login-session-2026-06-03T01-57-48-284Z/` | 真实账号登录后进入 `https://erp.lingxing.com/erp/home` |
| `output/playwright/lingxing-ad-menu-probe-2026-06-03T02-12-52-205Z/` | ERP “广告”入口进入 Ads 系统 |
| `output/playwright/lingxing-ads-links-2026-06-03T02-14-53-432Z/` | Ads 系统存在下载中心链接 `/ak_download/download_center/download_report_log/index` |
| `output/playwright/lingxing-ads-download-center-2026-06-03T02-16-06-375Z/` | 真实 Ads 下载中心截图、HTML、JSON 快照，历史 8 类报告行可见 |
| `output/playwright/lingxing-ads-create-report-modal-2026-06-03T02-17-17-750Z/` | 创建报告页面截图、HTML、JSON 快照；未点击“生成报告” |

第三轮桌面应用两阶段只读诊断产物：

| 证据 | 证明内容 |
|---|---|
| `output/codex-evidence/desktop-ipc-two-phase-diagnostic-1780542152692.json` | 桌面主进程 IPC 诊断 id `4`，真实登录后进入 Ads 下载中心，`ready: true`，`missingRequiredSelectors: []` |
| `C:\Users\wz\AppData\Roaming\@amazon-ai-ops\desktop\storage\screenshots\download_center_diagnostic_1780542191091.png` | 同次诊断截图证据 |
| `C:\Users\wz\AppData\Roaming\@amazon-ai-ops\desktop\storage\dom-snapshots\download_center_diagnostic_1780542191254.html` | 同次诊断脱敏 DOM 证据 |

第四轮桌面 UI 布局回归产物：

| 证据 | 证明内容 |
|---|---|
| `output/codex-evidence/renderer-v15-diagnose-layout-qa-1780561270634.json` | `验证页面` 按钮中心点命中按钮本身，点击后能渲染诊断通过状态 |
| `output/codex-evidence/renderer-v15-diagnose-layout-qa-1780561270634.png` | 同次 UI 布局截图 |
| `output/codex-evidence/v15-delivery-gate-ui-smoke.png` | 早期 v1.5 报表采集首屏显示真实采集验收门和 8 类单报表验证入口 |
| `output/codex-evidence/v15-workbench-operator-ui-smoke-2026-06-08.png` | 早期 v1.5 报表采集运营化首屏 smoke；确认下一步提示、单报表 0/8 进度、诊断折叠入口可见，默认不显示 selector 表，控制台无错误 |
| `output/codex-evidence/packaged-smoke.out.log` | 打包应用启动到 `sqlite-ready`、`ipc-ready`、`window-created`，并对历史 AppData DB 执行 store/site 列迁移 |
| `output/codex-evidence/desktop-live-scope-diagnostic-2026-06-08T02-47-44-379Z.json` | 当前打包版通过 Electron IPC 生成诊断 id `5`，同日期、店铺、站点范围诊断通过；预检仍被 `requiresManualVerification` 阻止 |
| `output/codex-evidence/installed-login-diagnostic-preflight-2026-06-08T06-16Z.json` | 当前安装版完成 ERP -> Ads 会话确认，导出诊断 id `8` 和同范围预检包；预检只被 `requiresManualVerification: true` 阻止 |
| `output/codex-evidence/installed-canary-campaign-2026-06-08T06-38Z.json` | 当前安装版在 `2026-05-01` ~ `2026-05-25` / `FT-US-US` / `US` 范围完成 `campaign` 单报表真实生成/下载；DB、manifest、文件系统、文件名日期 token 和文件大小一致 |
| `output/codex-evidence/installed-live-diagnostic-enabled-model-2026-06-09.json` | 启用后的 page model 诊断 id `26` 通过；`requiresManualVerification: false`，preflight 三项全部 passed |
| `output/codex-evidence/desktop-live-full-8-e2e-2026-06-09.json` | 安装版 full-8 E2E 通过；批次 `batch_20260609045655853_ft8uda`，8 个 `.xlsx` 均 downloaded，0 failed，acceptance audit passed |
| `output/codex-evidence/current-business-ui-smoke-1782801751321.json` | 当前业务 UI 汇总 smoke；覆盖 shell、data pipeline、ad execution、keyword/listing、settings/delivery，证明当前 renderer/operator flow 与新 AI fallback、Listing 草案、数据采集文案、scheduler 控制器 busy 反馈和关键词机会刷新按钮 busy 反馈一致；并已与本轮 package smoke/final-readiness 刷新同步 |
| `output/codex-evidence/business-ui-shell-smoke-1782793602269.json` | 当前后台框架 smoke；确认左侧菜单按 `运营总览`、`数据与量化`、`广告执行`、`关键词与 Listing`、`系统与交付` 分组，旧 `v1.5 工作台` 不再作为总入口；`交付验收` 只汇总最终证据，不承载日常操作 |
| `output/codex-evidence/business-ui-data-pipeline-smoke-1782793609367.json` | 当前数据链路 smoke；确认 `数据采集` 和 `数据导入与校验` 分离，真实表格、导入指标、USD 口径、当前操作范围、失败动作指引和自动数据采集监控抽屉可见，且监控抽屉不会遮挡后续主流程按钮 |
| `output/codex-evidence/business-ui-ad-execution-smoke-1782793618363.json` | 当前广告执行 smoke；覆盖优化建议、审批/回读路径、审批盖章反馈、AI fallback 状态、证据不足阻断、fail-closed 执行边界，以及执行回读页可见的 session 工作包创建、结构检查、中文现场证据未填写提示、打开填写文件、打开填写说明、应用内生成回读证据、路径展示和隐藏技术区的 `prepare/verify/fill session` 命令入口 |
| `output/codex-evidence/business-ui-keyword-listing-smoke-1782793628320.json` | 当前关键词/Listing smoke；覆盖关键词机会、Listing 读取状态、ASIN/范围核对、本地草案生成，并确认草案生成提示区分 `AI 草案` 与 `本地规则参考` |
| `output/codex-evidence/business-ui-settings-delivery-smoke-1782793633967.json` | 当前设置/交付 smoke；覆盖 AI 设置保存/测试/清除本地 Key、AI 调用审计、交付矩阵、非 READY 展示、`交付验收` 页应用内刷新最终验收，以及从失败 readback gate 创建/检查工作包、显示中文现场证据未填写字段、生成/校验回读证据、用生成的 PASS JSON 刷新最终验收，并打开候选证据、工作包目录、操作清单、Ads UI 定位单、填写文件和填写说明 |
| `output/codex-evidence/v15-listing-read-ui-smoke-1780991635633.png` | 历史 Listing 面板截图；当前完整 Listing 交互 smoke 以上方 `business-ui-keyword-listing-smoke-1782380523885.json` 为准 |
| `output/codex-evidence/source-listing-read-detail-probe-2026-06-09-merged-detail.json` | Listing 详情页真实只读证据；`fullContentReady=true`，同 ASIN 校验通过，10 条五点和后台词均读取成功 |
| `C:\Users\wz\AppData\Roaming\@amazon-ai-ops\desktop\storage\exports\lingxing_acceptance_audit_batch_20260608063734381_rhuubk_1780900813665` | 同批次验收审计包；单报表检查通过，但总状态 `incomplete`，因为只下载 1/8 报表 |

因此，历史基线已证明下载中心真实页面位于 Ads 系统，而不是旧的 ERP/官网候选 URL；也已证明创建报告页的店铺、报告名称、报告类型、日期、每日明细、生成按钮、ready row、download link 在真实安装版中可完成 8 类报表生成和下载。当前工作树正在补强 AI 证据链和量化决策，最终可交付状态必须重新用当前代码跑完整验收；广告写执行仍必须逐动作保留真实 readback。

## 广告数据口径

当前 full-8 采集证明的是下载和审计链路，不代表 8 张报表可以直接相加。`output/codex-evidence/full8-data-reconciliation-2026-06-09.json` 对 `2026-05-01` ~ `2026-05-25` / `FT-US-US` / `US` 的已下载文件做内容对账：

| 口径 | 花费 | 订单 | 销售额 | 说明 |
|---|---:|---:|---:|---|
| `user_search_term` | `145.20` | `5` | `324.95` | Listing/搜索词机会的优先事实口径 |
| `keyword` | `25.38` | `1` | `49.99` | 手动关键词调价/否词建议口径，不代表全部真实搜索需求 |
| `auto_targeting` | `119.82` | `4` | `274.96` | 自动投放 target 诊断口径 |
| `product_targeting` | `0.00` | `0` | `0.00` | 商品投放 target 诊断口径 |

不要把 `campaign`、`ad_group`、`placement`、`advertised_product`、`user_search_term` 直接相加；它们是同一批广告事实的不同维度展开。当前证据也不支持“约 3 单 / 170+ USD 花费”的预期，除非另有 ASIN、活动或投放条件过滤证据。

## 下一个 AI 接手步骤

| 顺序 | 任务 | 验收条件 |
|---:|---|---|
| 1 | 确认 Git 状态和提交边界 | `git status --short --branch`；只提交源码、脚本、测试和文档，继续排除 `.codex/config.toml`、`output/`、`storage/`、AppData DB、raw 报表、release EXE 和密钥 |
| 2 | 复核当前 READY 证据 | `output\codex-evidence\final-readiness-20260630144400.json`、`output\codex-evidence\package-launch-smoke-1782801832587.json`、`output\delivery-bundles\v15-delivery-bundle-20260630144400-ready\delivery-bundle-manifest.json` 三者必须同属当前 package hash |
| 3 | 变更后重新跑交付门 | 任意代码、包、范围或广告动作变更后，重新运行 `build:win`、`smoke:package-launch`、`write:v15-evidence-manifest`、`verify:v15-final-readiness`、`export:v15-delivery-bundle` 和 `verify:v15-ready-safety` |
| 4 | 保持广告执行边界 | 应用内批量广告写入继续 fail-closed；未来每个 Ads UI 动作都必须单独审批、截图、执行、reload readback，并通过 `verify:ad-readback` |
| 5 | 保持文档同步 | README、`docs/USER_GUIDE_v1_5.md`、`docs/V1_5_ACCEPTANCE_MATRIX.md`、`docs/V1_5_PROGRESS_REPORT.md` 和交付包 manifest 必须引用同一组 final-readiness/package smoke/bundle 证据 |

## 常用命令

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @amazon-ai-ops/desktop run build:win
pnpm run smoke:package-launch
pnpm run run:v15-installed-live -- --mode diagnostic --login
pnpm run verify:v15-diagnostic -- output\codex-evidence\<installed-live-diagnostic-file>.json
pnpm run run:v15-installed-live -- --mode canary --report-type keyword --login
pnpm run verify:v15-canary -- output\codex-evidence\installed-canary-campaign-2026-06-08T06-38Z.json
pnpm run verify:v15-enablement
pnpm run run:v15-installed-live -- --mode full8 --login --invoke-timeout-ms 900000
pnpm run verify:ad-execution
pnpm run create:ad-readback-template -- --out output\codex-evidence\real-ad-execution-readback-manual.json --md-out output\codex-evidence\real-ad-execution-readback-manual.md --source-files C:\path\to\user-search-term.xlsx --source-row 18
pnpm run create:ad-readback-candidate -- --source output\codex-evidence\installed-ad-ai-explanation-packaged-final-20260617.json --recommendation-id 4 --out output\codex-evidence\real-ad-execution-readback-candidate-rec-4-current.json --md-out output\codex-evidence\real-ad-execution-readback-candidate-rec-4-current.md
pnpm run prepare:ad-readback-session -- --source output\codex-evidence\real-ad-execution-readback-candidate-rec-4-current.json --out output\codex-evidence\ad-readback-session-rec-4-current
pnpm run verify:ad-readback-session -- output\codex-evidence\ad-readback-session-rec-4-current
pnpm run fill:ad-readback-session -- --session output\codex-evidence\ad-readback-session-rec-4-current
pnpm run fill:ad-readback -- --source output\codex-evidence\real-ad-execution-readback-candidate-rec-4-current.json --out output\codex-evidence\real-ad-execution-readback-rec-4-pass.json --approver-name "<approver>" --approval-artifact "<ticket-or-screenshot-path>" --approval-confirmed-at "<ISO time>" --before-value "<live before bid>" --before-captured-at "<ISO time>" --before-screenshot "<before screenshot path>" --live-bid-source-note "Read from Ads UI editable keyword/target bid row before manual change." --after-value "<live after bid>" --after-captured-at "<ISO time>" --after-screenshot "<after screenshot path>" --executed-at "<ISO time>" --executed-by "<operator>" --execution-id "<manual action id>" --readback-read-at "<ISO time>" --readback-evidence "<reload/readback screenshot path>" --readback-actual-value "<reload value>"
pnpm run verify:ad-readback -- output\codex-evidence\<real-ad-readback-file>.json
pnpm run run:v15-installed-live -- --mode ad-ai-explanation --out output\codex-evidence\installed-ad-ai-explanation-manual.json
pnpm run verify:ad-ai-explanation -- output\codex-evidence\installed-ad-ai-explanation-manual.json
pnpm run verify:listing-draft-ux
pnpm run run:ai-structural-mock
pnpm run verify:ai-structural-mock -- output\codex-evidence\<structural-ai-openai-compatible-mock-file>.json
pnpm run run:v15-installed-live -- --mode listing-ai-draft --source-app
pnpm run verify:listing-ai-draft -- output\codex-evidence\<listing-ai-draft-file>.json
pnpm run verify:ad-strategy-live -- --input output\codex-evidence\ad-strategy-live-input-current-scope.json
pnpm run verify:ai-settings-ux
pnpm run smoke:listing-draft-renderer
pnpm run write:v15-evidence-manifest --ad-readback output\codex-evidence\real-ad-execution-readback-candidate-rec-4-current-pass.json --out output\codex-evidence\v15-final-readiness-evidence-manifest-20260630144400.json
pnpm run verify:v15-delivery
pnpm run verify:v15-final-readiness --evidence-manifest output\codex-evidence\v15-final-readiness-evidence-manifest-20260630144400.json --package-launch-smoke output\codex-evidence\package-launch-smoke-1782801832587.json --out output\codex-evidence\final-readiness-20260630144400.json
# 先把 README 顶部 DELIVERY 行切到当前证据对应的 `APP_READY`，再导出交付包；导出器会拒绝 IN_PROGRESS README。
pnpm run export:v15-delivery-bundle --final-readiness output\codex-evidence\final-readiness-20260630144400.json --data-reconciliation output\codex-evidence\real-lingxing-reconciliation-batch_20260612020905629_gkchz1.json --data-reconciliation-md output\codex-evidence\real-lingxing-reconciliation-batch_20260612020905629_gkchz1.md --out output\delivery-bundles\v15-delivery-bundle-20260630144400-ready
pnpm run verify:v15-ready-safety --final-readiness output\codex-evidence\final-readiness-20260630144400.json --bundle-manifest output\delivery-bundles\v15-delivery-bundle-20260630144400-ready\delivery-bundle-manifest.json
```

`run:v15-installed-live` 支持安装版只读诊断、显式指定的单报表 canary，以及 `--mode full8` 的完整 8 报表采集；三种模式都不会执行广告写操作。登录账号和密码必须通过环境变量 `LINGXING_USERNAME` / `LINGXING_PASSWORD` 提供，仓库不保存凭据。

## 关键文档

| 文档 | 用途 |
|---|---|
| `AGENTS.md` | 后续 AI 接手规则、交付边界、验证命令和 fast-context 检索约定 |
| `docs/amazon_ai_ops_desktop_prd_arch_dev_spec_v1_5_no_external.md` | v1.5 PRD/架构/开发规格 |
| `docs/MISSING_MODULES_MATRIX.md` | 缺失模块矩阵 |
| `docs/V1_5_PROGRESS_REPORT.md` | 当前进度和最新增量 |
| `docs/V1_5_ACCEPTANCE_MATRIX.md` | 需求验收矩阵 |
| `docs/USER_GUIDE_v1_5.md` | 用户操作指南 |

## 交付边界

当前报表采集交付边界是“真实 Ads 下载中心定位完成 + 启用后 page model 诊断通过 + 8/8 canary 通过 + full-8 真实下载 + manifest/DB/文件/验收审计一致”；Listing 内容边界现在是“手工录入/辅助读取后保存为本地版本，草案和覆盖分析只读取本地版本，不自动提交 Amazon”；产品配置边界是“本地产品阈值维护和批量目标 ACOS 应用，只保存本地配置，不审批建议、不写入 Ads”；AI 边界是“DeepSeek live、广告策略诊断 live、广告建议 AI 解释、Listing AI 草案证据均通过 verifier 且不泄露密钥，并且 AI 证据引用、固定输出合同、正式动作准入和洞察分流均通过当前代码验证”；广告执行边界是“每个低风险人工 Ads UI 动作都有独立 approval、真实报表 sourceFiles/sourceRow、before、after、reload readback 和 `verify:ad-readback` PASS”。最终聚合必须先 `build:win` 生成当前代码的 installer 和 portable/no-install EXE，再用 `write:v15-evidence-manifest` 固定证据选择，并运行 `verify:v15-final-readiness --evidence-manifest <manifest> --package-launch-smoke <smoke>`；只有输出包含 `evidenceSelection.mode=manifest`、通过 `Release package hash` 与 `Package launch smoke` 的 final readiness JSON 才能用于交付包。导出 READY 交付包前，必须先把 README 顶部 DELIVERY 行切到当前证据对应的 `APP_READY`，这样包内文档和外部 READY safety 校验不会脱节；导出后再运行 `verify:v15-ready-safety`。应用内批量广告写入仍 fail-closed；2026-06-30 high-fidelity UI / AI-import feedback / data-import row-fade refresh / credential refresh / 产品配置批量目标 ACOS / 数据采集动作按钮反馈 / Listing 本地动作按钮反馈 / 定时任务控制器按钮反馈 / 执行回读安全复选框确认反馈 / 关键词机会排序与筛选反馈 / ProgressiveDetails 折叠反馈 / 全局字体栈和表格行高契约已完成当前业务 UI smoke、Windows 打包、安装包 hash 记录、真实广告策略诊断 live 验证、package launch smoke、manifest-driven final-readiness、READY bundle 和 READY safety，当前 READY 证据为 `output\codex-evidence\final-readiness-20260630144400.json` 与 `output\delivery-bundles\v15-delivery-bundle-20260630144400-ready`；`output\codex-evidence\final-readiness-2026-06-18-portable-fix.json` 与 `output\delivery-bundles\v15-delivery-bundle-2026-06-18-portable-fix-ready` 只作为历史 READY 基线。
