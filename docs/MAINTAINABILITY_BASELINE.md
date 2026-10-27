# 架构治理基线

> 2026-10-27 文档对齐：本文定义合同、方法或验收案例，不提供当前通过结论。现行状态、失败与后续计划统一见 [项目状态](PROJECT_STATUS.md)；当前仍为 APP_NEEDS_WORK / INTERNAL NON_READY。正文中的旧检查点只适用于当时版本。

- 复核日期：2026-10-26
- 源码基线：本地 `master` 为 `e0a00c4`（2026-09-10），本轮改动尚未提交
- 交付状态：`APP_NEEDS_WORK / INTERNAL NON_READY`

## 2026-10-27 原生 motion v2 与真实可见交集合同

本节明确替换下方历史 motion DOM/2、geometry/1 的正式采集方法；业务 MUST、原十类组件、二十读屏节点、控件可达、减弱动态和六项内部退出条件保持。v1 的纯 API、默认 PNG 门和历史测试保留，正式采集改为 motion DOM/3 与 owned-motion-geometry/2；旧 raw 不补写、不转换为新信用。本节只定义实现合同，实际源码、包和终态仍由外置进展及绑定原件说明。

同一所属 Main/Renderer 的 PID、出生、BrowserWindow id、URL、可信 Electron44.2.0、HWND、窗口/内容/菜单/显示状态和 appMetrics 均前后实际读取。Main 原生100ns出生及EXE只从已核nativeLaunch的held watcher导出；Renderer及关联GPU的100ns值按Chromium整数/10截断与Electron微秒指标精确比较，不用旧+5四舍五入或自由出生时间容差。原生七位UTC保留，操作先后只在原Main Date毫秒分辨率比较，不能估算偏移或改写时刻。独立PMv2 helper原件、参数、nonce、源脚本/可信PowerShell哈希、真实spawn/exit/close、stdout/stderr及同线程context恢复均需校验；正式artifact入口检查真实文件，纯几何入口校验同一原始读数。

工具文件记录须与真实producer一致：invocation.tool严格使用path、sha256、sizeBytes、stat四字段；stat严格使用ino、size、mtimeMs、ctimeMs、birthtimeMs、mode、nlink七字段，并核文件类型、单链接及与sizeBytes一致的尺寸。纯几何入口验证该记录结构，正式artifact入口核实际工具文件与记录绑定。stdout/stderr仍使用原path、sha256、sizeBytes三字段及空stderr规则；不得通过删除真实stat、允许任意额外字段或改变所有权、时间、几何、输入及退出门来兼容。

窗口仍实际请求setContentSize(1366,768,false)，minimum先核1200×700再请求setSize(1199,699,false)。receipt记录原owner、zoom、实际调用参数及调用/返回/稳定读回。DSF严格只接正式profile的1或1.25，force与display DSF必须精确一致，DPR必须精确等于DSF×zoom。原viewport/tolerance、restore5000ms、stable250ms、poll25ms迁至无I/O配置叶子并原值重导出；DSF1尺寸和跨view DIP chrome继续精确，DSF1.25正常内容仅用原±2DIP，minimum实际bounds只能处于[声明minimum,minimum+2]。旧0.02 scale容差不用于降低本门。

原生客户区不等同Electron content_view。按固定Chromium的ScreenToDIPRect实现，对实际绝对物理client矩形沿该版本float与enclosing算子取得logical client size：左/上向下、右/下向上取整，保留原浮点中间态，不增加epsilon；content width必须填满该宽，menu DIP为logical client height减实际content height，并与真实菜单状态及跨view的同一菜单高度严格关联。将局部content矩形(0,menuDIP,contentWidth,contentHeight)经同版本DIPToClientRect的enclosing规则转换，再平移原生client起点；唯一Main-owned可见Chrome_RenderWidgetHostHWND的window/clientScreen必须与该重建矩形精确相等。不能以contained、自由±1、图片比值或任意小角落代替完整覆盖。OS window→client inset、同HWND/style/DPI/monitor跨view严格保持；实际GetDpiForWindow不强行等于forceDSF×96。

每个child在同次原始采样内的两次逐API查询均须完整、成功且除实际时间外严格相等，先数全部可见同类RenderWidget，再核唯一Main/root所属者。Main/root和该widget在截图前后独立观测间几何稳定。GPU仅可在不同独立观测之间更新其原始几何；每次原始采样内仍沿同一严格稳定门，并由同次Main前后稳定appMetrics的GPU类型、同包EXE与精确出生关联逐项核验。该Intermediate D3D Window始终UNADMITTED与authority:NONE，不能成为viewport、控件或动作授权来源；未知class/process、不可读、单次采样内变化或重复RenderWidget仍拒绝。

PNG仍严格为ceil(actual content DIP×可信DSF)，NativeImage的实际nativeSize与scaleFactors=[1]精确匹配；沿原PNG结构、CRC、解压及资源上限检查，Ads/canary/readback默认1200×700不变。bitmap与原生可见范围分别记录：validateOwnedMotionV2保留原{width,height}返回形状，新增frame入口复用同一core取得深冻结pixels和visibleViewport。可见范围取真实client∩RWH，再与PNG逐轴相交。正式控件须同时满足原CSS/viewport边界、真实DPR逐字段映射，以及物理边界不跨该可见交集；PNG内但被原生client裁掉的最后半像素也不能取得可见信用。

截图继续复用旧capture及finally恢复原字节，通过独立wrapper在旧capture前后采native并由完整Main夹读包围；旧capture共享Main投影逐字段核同，实际capture起止不改写。原10秒节点、20秒采集/正常关闭预算和失败语义保持。统一叶子的helper上限为20000ms、WM查询1000ms、输出524288字节、child256，均显式传入PS并核对，不开放环境fallback。helper异常和日志自身序列化失败均保留首错、统一timestamp/level/event/context及次错，真实失败继续exit1；不强退业务进程，不把晚到原件转绿。

运行闭包保留原106路径及顺序，仅追加七个实际新模块到113；六个新测试文件加入唯一L1清单，support不匹配测试入口，L3及其他定义保持。新文件依职责拆分、必要中文注释，原始失败、真实运行状态及正式数据保护边界保持。该合同不批准费用、不生成Grant或Ads执行，也不授完整UI矩阵、内部退出或APP_READY信用。

固定源码依据：[Electron内容尺寸](https://github.com/electron/electron/blob/v44.2.0/shell/browser/native_window_views.cc#L932-L942)、[原生client到DIP](https://github.com/chromium/chromium/blob/152.0.7977.76/ui/views/widget/desktop_aura/desktop_window_tree_host_win.cc#L399-L402)、[enclosing双向换算](https://github.com/chromium/chromium/blob/152.0.7977.76/ui/display/win/screen_win.cc#L739-L793)、[RWH实际SetWindowPos](https://github.com/chromium/chromium/blob/152.0.7977.76/content/browser/renderer_host/legacy_render_widget_host_win.cc#L209-L218)。独立原生实测用于确认四view的事实，不以模型替代新候选的当前实包验收。

## 2026-10-26 焦点准入与空 worker 退出合同（待实包验证）

真实焦点采集在注册 AX 探针前，沿用既有阶段的焦点谓词：first-focus / target-focus 等待既定 target 成为活动对象；tab 等待活动对象离开 target；target-handoff 等待活动对象同时离开 before 与 target。尚未满足时仅返回 pending，由原等待循环在同一节点十秒总期限内继续观察。原 context、nonce、deadline、元素连接、ownerDocument 与主文档前置门保持；准入后 CDP 对象、元素、上下文和时间证明仍严格拒绝任何变化。不捕获引用异常后重试，不换 locator 或重绑，不重复原生输入，不用 ACK 代替语音。

退出时先设置停止准入标记并快照自有 worker。空集合直接完成该排空步骤，不读取与空集合无关的关闭配置；这不引入默认值或旁路配置。非空集合继续从原统一配置总线读取并校验同一预算，保留终止、超时、异常、重试与日志合同。排空失败继续由原安全屏障保持窗口可见，并通过同所属原生对话框正常重试；不得强退或改写原失败。实包关闭仍使用原二十秒总预算，事后恢复不计作首次关闭通过。

本节定义候选方法边界，不提供新实包读屏、原生几何、首次正常退出或 APP_READY 信用；当前实现和结果由外置进展及绑定原件说明。全部历史与六项内部退出条件保持。

## 2026-10-26 motion 截图几何与减弱动态合同（待最终实现核准）

motion DOM 使用 v16.accessibility-motion-dom/2，几何见证使用 v16.owned-motion-geometry/1。见证固定包含 method、imageSemantics、before、captureStartedAt、captureFinishedAt、after、nativeSize 和 nativeScaleFactors；同一所属窗口在截图前后实际读取 Main/Renderer PID 与出生身份、窗口身份、URL、可信 Electron 版本、bounds/contentBounds/contentSize/minimumSize、zoom、显示状态、display 的 DSF、实际 force 开关，以及 Renderer viewport/DPR；before/after 及截图起止均为同 owned Electron Main 的实际 Date 采样时刻。Renderer 数值由同一 webContents 独立实际读取，不提供独立 Renderer 墙钟证明或跨时钟偏移校正。身份与几何必须前后一致，截图时刻位于两次实际观测之间；不能以事后估计、PNG/innerWidth 比值或报告自声明替代所属和几何证明。

正式采集分别固定启动 DSF 为 1 与 1.25，并核对 run.actualDeviceScaleFactor、实际 force 开关、窗口 display 和 Renderer DPR；DPR 应等于 DSF×zoom。125-percent view 固定 content 1366×768、zoom 1.25；minimum-window view 固定 bounds/minimum 1200×700、zoom 1。minimum 内容尺寸由前一份已核同所属窗口的 125-percent 见证中四边 chrome 差推导，前后差值必须一致；Renderer innerWidth/innerHeight 仅接受 contentDIP/zoom 的相邻 floor/ceil 整数格点。控件同时保留原 cssBounds，并按真实 DPR 转为物理边界，不能从截图比例反推身份或尺寸。

截图像素语义只接收已核的 Electron 44.2.0：可信 Main 的实际 process.versions.electron 与当前 run 版本必须同为该版本。其 capturePage 逐轴产生 ceil(contentDIP×DSF) 物理像素，NativeImage 的 nativeSize 是物理尺寸、nativeScaleFactors 为 [1]，PNG 两轴必须与该尺寸精确相等。依据为该固定版本的 [capturePage 与 1x bitmap 实现](https://github.com/electron/electron/blob/v44.2.0/shell/browser/api/electron_api_web_contents.cc#L3734-L3750)、[OnCapturePageDone 的 1x bitmap 回调](https://github.com/electron/electron/blob/v44.2.0/shell/browser/api/electron_api_web_contents.cc#L602-L621)及 [NativeImage 尺寸与表示枚举](https://github.com/electron/electron/blob/v44.2.0/shell/common/api/electron_api_native_image.cc#L321-L333)；不得套用不同版本的像素语义，未知或不匹配版本拒绝。

motion PNG 沿原严格结构、CRC、解压和资源上限校验，再按所属几何见证执行精确像素校验；不开放自由 minWidth/minHeight，也不更改 canary、Ads 和 readback 的默认 1200×700 门。旧 motion 原件缺少所属见证或可信版本时保留原样，必须重新采集，不能补写旧 raw。NFR 空 args 的实际启动与未设置 force 的状态须忠实记录，该记录本身不提供正式 motion 几何信用。

减弱动态沿 PageFrame 及 legacy/shared-component-density、mission-control/store-connection-and-dialogs、mission-control-workspace-tabs、readback 四份既有样式的 reduce 媒体规则统一零时长：PageFrame 两项与四文件六项 animation-duration/transition-duration 的 !important 声明均为 0ms；迭代次数、选择范围、类名和正常态规则保持，非 important 的原声明与 readback 非 reduce 的 150ms 规则保持。验证须先在正常态观察实际非零 computed 时长和正在运行的非零动画，再切换 reduce，核对同一页面后代及伪元素的 computed 时长严格为零、实际 WAAPI 不含非零动画；不能使用容差、过滤非零项或修改原始记录。原读屏节点、十秒预算、owner、语音身份、输入和 STOP 门保持。本节只定义待核准的方法合同，最终实现与实际结果仍由外置进展及绑定原件说明；全部历史和六项退出条件保持。


## 2026-10-26 真实读屏用户命令合同

本节明确修订下方历史实现中命名 dialog 仅等待自动焦点公告的采集方法。高层要求和六项内部退出条件保持：仍验证原十类组件、二十个原节点，详情检查器仍为已有命名 dialog 与唯一关闭按钮，另保留标题、状态、键盘约束和关闭恢复覆盖。原自动公告采集未通过；最终阶段是否产生回调及原因仍未证实。全部原始日志保留，方法修订不能反推静默根因或宣称自动公告已修复。

顺序控件继续使用 automatic-focus-announcement。仅具名 dialog 容器采用 nvda-report-current-focus：原首次焦点、Tab、ShiftTab handoff、最终目标焦点及对应真实 NVDA ACK 全部成功后，在同一原始十秒节点期限内固定请求一次真实 NVDA+Tab；不在超时后补取、不重试、不改选节点。报告动作是正常屏幕阅读器用户命令，不制造新 gainFocus 或 DOM Tab ACK；原 Tab 的 DOM 事件与焦点门保持。报告协议标记为 v16.nvda-report-focus/1，使用独立 nonce 和实际输入收据，消费者区分主动读出与自动公告。

只在本次隔离 NVDA Profile 固定 desktop 布局、NVDAModifierKeys=4 和 handleInjectedKeys=True，发送前从 NVDA 实际配置只读确认 Extended Insert。固定四事件为 extended Insert 按下、Tab 按下、Tab 松开、extended Insert 松开；逐事件保留出生身份、held Main、前台/焦点根、输入桌面、其它按键释放、时刻和接受结果。失败时只释放本次已接受且仍由本次持有的键，保留 extended 位；未知配置、外部归属、未完成焦点、重复请求、STOP 或超时均拒绝，不试其它 modifier，不改系统或用户 NVDA 配置。

输入 ACK 仅证明输入，不提供语音信用。实际语音仍只来自原合成器观察回调，保留完整 raw、中文名称和真实角色、Main/Renderer/窗口/文档身份、DOM 引用、节点 nonce、前缀时序和原时间窗口校验。主动分支还须绑定实际报告输入原件和 modifier 配置原件；未知 schema、字段、触发模式及能力标记不一致均拒绝；缺失、篡改或移除能力标记不能使当前来源降级为旧自动协议。不得直接调用 speech、ui.message、官方命令 script、模拟 NVDA 事件或照读测试传入文本。原 STOP、正常 Main/NVDA 退出、正式数据保护和配置总线边界保持。

输入收据与 ACK 的固定 schema、身份、事件、时间和归属校验由独立纯合同模块共享。交付证据验证器只依赖该纯模块，不能通过复用收据验证把原生输入、DOM/AX 或屏读采集器引入生产 Main。原生采集入口复用同一校验并保留既有导出；运行源码清单保留原105项次序，仅登记新增纯合同，总数增至106项，库存断言及依赖隔离回归同步。所有原门和预算保持，不给全局写入增加白名单。

命名 dialog 的 target-handoff 读取先经过原 context、连接和主文档检查；若本次已读 active 仍是 before 或原 target，则只返回 pending，不建立探针或发起 CDP。原 waitDomFocus 的25毫秒轮询和十秒绝对期限保持；真正交接后仍完整执行原26项引用谓词、双AX和最终清理，任何实际身份错误仍使会话失效，不捕获重试。此前补证没有复现 receiver 不同，故本前置门不能被写成已证实旧失败根因的修复。

焦点拒绝日志仅给同一次已读 raw_role 增加六种固定枚举：togglebutton、treeviewitem、treeviewbutton、dropdownbutton、menubutton、splitbutton；枚举名来自 [NVDA 2026.2 Role](https://github.com/nvaccess/nvda/blob/release-2026.2/source/controlTypes/role.py)。未知或任意内容仍为 OTHER，不增加对象、名称、语音或时钟读取，不改变角色归一化、焦点或语音接受条件。日志异常独立捕获；具体平台角色须实际采集，不能凭名称或枚举存在直接放行。

执行工作区的“执行来源”保留原生按钮、原名称、位置和原 authorityOpen 切换逻辑；它控制详情区域显示，按 [W3C Disclosure 模式](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)使用 aria-expanded 与 aria-controls，并以组件 useId 关联原受控 section。初始折叠、原 hidden 状态、其它打开入口、店铺变更复位、点击及原生 Enter/Space 行为保持；不更改授权、队列创建或执行业务。这是同一节点的展开语义修正，不更换目标或增加平台角色接受映射。旧 NVDA OTHER 的具体枚举未采得，实际读屏与因果结论仍须新包验证。

API Key 字段使用独立的短名称与帮助描述：SettingsPage以useId生成稳定引用，原password input的aria-labelledby仅指向可见“API Key”短文本，aria-describedby关联原隐私帮助，aria-required仅在密钥尚未明确配置时为true；Main已明确配置密钥时为false，使可留空的更新字段不被读成必须重新输入。FormTableRow仅增加可选labelId/hintId端口；未传入时保留原默认内容树，多控件行不自动克隆或共用名称，组件自身不新增Hook。原可见文案、布局、密码类型、输入/保存/清空明文、已配置密钥时空输入更新Base URL或Model的行为保持，不增加提交验证。此处修正产品名称/描述归属，语音原件、名称字面匹配、角色与十秒门不作归一化或放宽；实包完整20项仍须独立复验。

此处仅定义方法与实现边界，不预授测试、真实读屏、全矩阵、开发完成或 APP_READY 信用。当前身份和实际结果外置于 PROGRESS/BLOCKED 及绑定原件，冻结后不得修改本文件。

## 2026-10-24 R63 caption原查询操作数记录

PointOwned仅在原调用点保留WindowFromPoint、GetAncestor和GetWindowThreadProcessId已经取得的原始操作数，以固定、有界的数值、句柄十进制串和查询执行标记记录。原Time、非空短路、调用顺序及参数保持；root不匹配仍执行原PID查询，原Require、错误、Activate全部调用点、输入次数和预算不变。不增加Win32读取、lastError、重采样、时间采样或内容读取，不授予任何所有权成功或执行权限。API返回零与成功返回不同PID必须依据各自原值区分，不能只从旧false布尔或非零outPID推定外来窗口。

隔离C#机制验证只运行从真实源抽取的PointOwned方法体与假API，不能替代新增字段在当前EXE原失败瞬间的实测或原20自然节点；事后被动sidecar仍仅准备、未执行。实现身份及实际结果继续外置PROGRESS/BLOCKED与原始报告；本节不预授新构建、完整冻结链或开发完成信用，六项退出条件和全部历史原文保持，不自嵌source/full摘要。

## 2026-10-24 R59 原生UL的真实AX语义

公共可访问节点投影将原生UL映射为实际观察到的list；显式声明role继续优先，实际rawRole必须与期望逐字相等，冲突仍失败关闭。本次只补UL，不扩展OL、通用容器或其它未声明元素；既有SUMMARY精确组合保持，不能以名称、推断或通配替代当前真实AX。

原locator引用、backend/frame/document预绑定、双次实际AX与最后DOM/清理、名称、collector/Renderer时间、provider、输入、STOP及每节点十秒合同保持。受控浏览器键盘诊断只证明该路径的实际UL/list与原语义门拒绝，不授原生NVDA自然语音或完整20节点信用；实现身份及实测结果统一外置PROGRESS/BLOCKED与原始报告。本节只补充维护合同，不预授新构建、完整冻结链或开发完成结论；六项退出条件及全部历史原文保持，不自嵌最终source/full摘要。

## 2026-10-24 R57 DOM焦点观测时钟域

DOM焦点证据分开保留Renderer本域原始区间与collector接收凭据。registerProbe和finishProbe各自真实生成初、终时间；原值仅按本域校验finite、canonical和先后顺序，并绑定本probe及同一焦点nonce、phase、target。完整实际AX、双次节点/文档身份及finally最终DOM与清理校验成功返回后，collector才记录同一Node时钟的真实read开始和接收时刻，并在原phase、原deadline内核验；原五项时间谓词使用明确标记的collector接收时间。不能用Renderer字段覆盖接收凭据，不能回填缺失原值、夹值、加容差、估算偏移或延时重试。原身份、焦点、自然语音、输入、provider、STOP和每节点十秒预算保持。

本节只对齐实现合同，不授予真实20节点、完整冻结链或开发完成信用。当前结果以PROGRESS/BLOCKED绑定的原件为准；六项退出条件、全部历史和真实验收依赖保持。本维护文件进入完整frozen/fullSha256，不进入sourceIdentity；根README/PROGRESS/BLOCKED均不进入这两组冻结成员，冻结后不得修改本维护文件。

## 2026-10-24 R56 真实读屏采集与可访问名称边界

本节同步当前实现范围，替代下方历史检查点中的旧实现描述；六项开发退出条件和真实验收依赖原文保持。最终源码、完整输入、包身份及实测结果继续外置PROGRESS/BLOCKED与原始报告，本文件不自嵌最终source/full摘要，冻结后停止修改。

原生窗口前置只对初始非置顶的自有窗口执行一次pop-up-menu置顶，按同一原截止只读等待真实getter；原已置顶状态在任何窗口副作用前拒绝，避免恢复未知level。原生绝对坐标使用像素中心归一化，严格光标回读、身份、一次三输入及原预算保持。公共实际AX读取将同一locator与backend/frame/document绑定，名称和角色来自当前真实AX；内部引用及双次观察不得由旧缓存替代。Tab须实际离开；顺序节点由ShiftTab回到同一目标，命名弹窗经固定ShiftTab handoff后程序回焦，并在最后等待后重验STOP与原截止。Tab及回焦阶段核对同一绑定owner的新gainFocus ACK；输入ACK仅证明受身份、桌面及原时限守卫的有限按键序列被接受并完成输入后回读，不单独证明DOM移焦、自然语音或原20节点。

reader在原Main/Renderer/出生/root/owner绑定和既有reader检查后、spawn前采用固定冻结协议开启本Main应用级AX一次，沿用原openDeadline；setup与ready读取真实bool及四项必需功能。协议校验后仅消费返回的canonical对象，等待期间caller修改不能影响原件或清理合同。清理边界为所属Main正常退出，不将boolfalse当成原features精确恢复；不改系统全局flag或产品默认，保留--no-sr-flag、输入、自然名称/角色、nonce/STOP及每节点十秒门。测试替身仅通过明确依赖端口，不能授真实AX信用。必填标签将纯业务名称与装饰星号分离，原必填和业务校验保持。自然朗读先按原request的身份、原始序号、时间窗口与全流顺序核验完整流，再仅将真实hostBefore/hostAfter内的合法行授予原provider；合法early/tail原始保留但不授信用，provider原谓词和原十秒预算保持。

此前R55身份的工程检查记录为L1库存641、相关21文件722/722及2175模块零超999行；新增测试和闭包补齐后的当前库存与全量结果须由新冻结实测，不预填数量。此前包的静态检查通过亦不代替完整冻结L1–L3、四包、22入口/110原图/20自然NVDA、恢复、36性能、完整安全/备份和最终独审。172正式MUST继续UNVERIFIED，APP_NEEDS_WORK / INTERNAL NON_READY；全部六项退出条件真实闭合后才能限定仅剩真实环境验收。

## 2026-10-22 R38 原生采集时序与便携运行边界

便携运行关闭流程现通过单一共享closePromise串行处理，首次关闭前固定核对包体，保留首错与次错、真实launcher exit/close及三项正常退出条件，形成有界原子收据；没有新增kill、目录删除权限或放宽45秒关闭、500ms轮询及既有启动预算。原56案例完整保留，新增33例；实际provider阶段62通过、27项行为失败，helper消费后89/89通过，相关七文件147/147通过。这些是隔离系统端口回归，不代表先前真实便携关闭失败已获根因或清理信用。

原真实读屏诊断中，官方startup-complete与owned caption已经通过；节点2的当前焦点、nonce和归属满足，但自然spoken仍是前一目标名称，原名称门正确拒绝。现对first-focus、Tab、target-focus串行核对NVDA自然gainFocus处理完成的owned metadata；重复焦点只在真实DOM前后相同且NVDA已处理当前焦点、无pending时标记already-focused，不伪造新事件。ACK不写实际语音，不调用speak/cancel或手工事件；自然spoken名称、角色、单Main/root/出生、原request nonce及raw门保持。每节点仍共用原10秒绝对deadline，原30秒open、STOP十五秒加十五秒保持，处理元数据不能替代20自然节点与十原语。

完整两文件147案先实际129通过、18失败；接入生产consumer后首次146通过、1失败的原件保留。该失败是旧隔离模型把nodeFocusCount为1时的全部locator.evaluate都当成host-before，误向新增布尔焦点探测注入异常。随后仅将该故障端口限定为真实host-read返回的自有id/activeElementId对象，原案例名称、body、断言、预算及同一boundaryError保留，同147/147通过；再按原模型三处插入追加Tab移到不同名称/角色与旧ACK回放拒绝两例，完整149/149通过。模型通过不等同真实自然NVDA已过门，原FAILED报告不改写。

新焦点helper属于reader实际require闭包，package UI registry保留原97项次序，仅增至98项。应用工具用独立新Node进程读取修改前后registry，从完整来源字节分别派生evidenceScript及canonical envelope，避免require缓存或遗漏新依赖；除明确目标和派生摘要外的冻结字段保持。新增出口沿用统一日志及异常首错。业务配置仍经ConfigurationBus，本轮运行存储仅通过可信CLI显式--runtime-drive、本地盘根严格校验及既有evidence-path-policy生成冻结的五字段配置，不采TEMP/TMP等环境默认、不静默fallback、不扩正式权限。

运行盘配置的原59案例全文及预算保留，新增12例；实际完整71案RED为68通过、3项真实消费行为失败，FINAL同名同次数71/71通过，另外9项新例在两侧均通过。独立实际复核9975420f4604291f8b64a6364eadc0b6bbbbe017c55ddc2751e36fccbb68a77e确认精确两阶段应用、原59 Counter、关闭helper及98项runner contract不变；native/canonical保存三stat与字节、原包/app保存对象、应用raw两文件全部七stat按各自收据范围保持。该结果不证明F盘真实EXE运行、自动清理或当前四包成功。

最新便携开发诊断的launcher终态为exit1，未到实际关闭控制器；其后只读观察到同EXE子PID112928、parent108940、出生2026-10-22T09:55:00.1656042Z。10:13:38Z原生查询返回GetExitCodeProcess成功且259、WaitForSingleObject(0)=258；CIM记录线程和句柄均0、窗口0及标题空，不能当成已退出。相邻CIM/GetProcess身份匹配不能冒充同一native handle出生证明。没有可证正常可控退出端口，创建机制及该状态原因仍UNKNOWN。失败提取树12137文件、1583273350字节已逐文件校验复制至F盘归档；源目录RemoveItem在System.dll返回AccessDenied，移除失败原件保留，具体文件句柄持有者没有证明，不能把“占用”推断写成已定根因或自动清理通过。

当前L1库存630文件；本轮十二文件相关回归384/384实际通过，全仓--all实际核查2148实现模块、零超999行。上述只授当前定向和尺寸范围，尚未新冻结完整内部链；当时完整保护基线及后续终态由实际descriptor绑定原件。当前源码仍须完整冻结L1–L3、新Windows构建与依赖审查、四形态首启/重启、隔离双档样本、22入口与110张当轮原图、20自然NVDA及十原语、motion/失败恢复、36本地工程性能、安全与隔离WAL恢复、最终S和正式字节备份、真实正常应用启动及独立总审；不能用定向模型或旧包代替。

下方89132原字节、全部历史失败与六项退出条件完整保留；本文件不自嵌未来source/full哈希。172项正式MUST继续UNVERIFIED，APP_NEEDS_WORK / INTERNAL NON_READY。软件六条件真实闭合后才可限定剩余真实环境；不合成真实账号、批准、费用、Grant、Ads执行或APP_READY。正常用户入口仍为真实Windows应用、空args及canonical userData，环境残留未解除时不授新的EXE/UI运行信用。

## 2026-10-22 R37 店铺自动采集独立控制与读屏启动握手

为分离有效分析配置和自动采集启用状态，新增独立Store/Profile覆盖，由正式Main服务经ConfigurationBus事务CAS、严格身份校验和写后回读持久化。缺覆盖只保留历史启用行为、revision0且不写记录；显式覆盖必须满足精确schema、版本、布尔值及UTC，损坏或身份不一致失败关闭。正式orchestrator和读模型消费同一覆盖；原七字段分析配置、手动采集权限及已有任务恢复语义保持。设置界面包含暂停/恢复、UNKNOWN、忙锁和GET/SET的A→B→A拒绝，未增加Ads执行权限。

自动采集支持和四条新增L1路径先行，五个消费者保持旧逻辑时实际10文件231案为222通过/9预期行为失败；仅应用五消费者后同名同次数231/231通过，相关11文件250/250通过。独立合审d9e3333bc9547276cbcd60a4396b0549da18f44e864c264908c622a9d9d70913确认143旧案完整保留和88新增。真实bus与owned磁盘SQLite覆盖commit通知、rollback及物理关闭重开。隔离样本只通过正式服务关闭自动采集，分析保持active、AI明确false；admission只在生产codec确认explicit false且AI===false时排除有效自动计划，不放宽零凭证/授权/费用门。四包脚本已加入公共IPC首启关闭与Main重启GET读回，当前尚未跑新包，不能预授信用。

读屏流程先前只等插件构造发出的observer-ready，早于官方core.postNvdaStartup。现通过官方Action注册一次独立startup-complete原件，注销和初始化异常沿统一有界日志及自有清理处理；不占用自然语音序号。launcher在原openDeadline内严格核对PID、token、完整binding、版本、来源和UTC，复制后重读原件并保存path/SHA/bytes、实际宿主观察时刻，再进入原caption步骤。原30秒open、节点十秒、STOP十五秒、唯一真实输入/点归属/前台校验及20自然节点保持。没有把启动通知或插件ready当成自然语音，也未声称启动握手偏早解释了旧cursor偏移。

新增协议测试先应用两测试/隔离harness，原两生产文件保留时120案为原102全通过、新18失败；其中12是旧launcher仅ready继续或不等待的隔离消费模型行为，6是新observer handler缺失的供应方契约断言，两类不混同。随后两生产文件落地，同两文件120/120通过，加入原caption回归后三文件146/146通过。Python harness只读指定源字节在内存compile/exec，新例用-B，不读写repo observer pyc；未实际启动NVDA或产品输入，全部只授软件机制信用。旧cursor原因仍UNKNOWN，实际20自然节点与十原语必须在新包独立完成。

读屏两生产源属于package UI runner源码绑定清单，应用工具原预计值未计入其派生摘要而保持FAILED原件。随后只读逐项重算完整runnerSourcePaths ledger，仅这两项变化；旧/新evidenceScript与canonical envelope SHA均匹配保存快照，semantic/protected-temp合同保持；新fresh快照等于应用后原件。仅两source/implementation行、派生identity/full和runner摘要变化，native、既有包、app及canonical保存对象保持，raw两文件七stat与应用前保护点精确相等；没有重复应用、回滚、改写旧FAILED或恢复时间戳。ordinary回归的canonical保存仍只有原三stat，不能泛化为全窗口七stat证明。

当前测试库存630；读屏后全仓2146实现模块、超999行零；自动采集后的L2四类五命令已通过。新完整用例数必须由最终冻结候选实测，不能用旧C045800的626/7360、包或安全结果代替当前源码。仍须同源完整L1–L3、新四包实际重启、隔离双档样本、22入口及110张当前原图、自然NVDA二十节点与十原语、motion/失败恢复、36本地固定预算性能、安全、隔离WAL恢复、最终S及正式字节备份、真实应用正常启动和独立总审。六项退出条件全部实际闭合前，保持APP_NEEDS_WORK / INTERNAL NON_READY，172项正式MUST继续UNVERIFIED。

下方全部历史字节与六项退出条件完整保留；本文件不自嵌最终source/full哈希。新候选身份与真实终态由PROGRESS/BLOCKED及绑定原件记录，冻结后停止修改本文件。正常用户入口仍是真实Windows应用、空args与canonical userData；不合成真实账号、批准、费用、Grant、Ads执行或APP_READY。

## 2026-10-22 R35 生产样式接线与可读布局

真实历史EXE截图逐图检查发现五项可行动布局缺陷，不能用矩阵issues为零替代像素核对。Mission入口漏接既有拆分CSS；OperatorFlowFeedback两个子项误套旧三列网格；Memory直接button选择器失配真实action-shell；审批窄队列头部与授权原因横排挤压；共享摘要长时区挤压辅助说明。修复仅补样式入口、专属两列样式及局部布局，保留旧三子项结构，不改权限、ARIA、业务文本、事件或数据。canonical-workspace-surfaces.css原971行保持；六源生产改动均低于1000行。

新增真实CSS浏览器回归从实际App依赖图加载样式，Mission CSS只经真实组件入口引入，开发预览引导关闭。五类布局各100%与125% CSS等效尺寸，共10个案例、静态74处expect与8处assert；每案30秒和准备60秒固定，原案例、断言及预算不改。内部legacy CSS防回归保留PROTOTYPE_ONLY和disabled边界，不启动模拟工作台。新增错误记录复用项目真实统一日志API及隐私投影，旧v1日志格式阻断和未运行事实完整保留。清单只登记一个新测试文件，旧625项次序与L3清单保持；未压行规避实现模块999行硬门。

先仅应用test/support与清单三个目标，实际10案例全部因计算样式或几何断言失败，分别为block/grid、flex/grid、三轨/两轨、shrink1/0及nowrap/wrap，非编译或端口错误；随后应用六个生产目标，同名10案例全部通过。保留相关13文件178/178通过，旧168案例完整保留；冻结前L2四类五命令通过，含全工作区类型检查和32项包脚本合同；全仓2133实现模块零超999行。两个源码阶段及实际回归的原生、既有包体、app、canonical四文件和原始两文件七stat保护按收据保持，不恢复时间戳。

实际原件：output/development-completion-2026-10-16/root/r35-real-css-old-layout-red-20261022T043321381Z-5996f5bc-1fa7-40b9-aa54-02bd6584437e/report.json；output/development-completion-2026-10-16/root/r35-real-css-fixed-layout-green-20261022T043701218Z-8020a5c8-851d-4115-a690-39fe10c8d8a0/report.json；output/development-completion-2026-10-16/root/r35-layout-preserved-thirteen-green-20261022T043922264Z-d54dbdf0-dfe1-4c2c-9cf5-a806ee21547b/report.json。独立实际复核：output/development-completion-2026-10-16/independent/r35-layout-actual-chain-review-5f29c611-78a1-4e85-a024-a379afd16948/REVIEW.json。内部组件截图和几何仅授自身范围，不授EXE、原生DPI或NVDA信用。

前置C033554的625文件7350案例及L2/L3已实际通过，但其源码早于本布局修复。当前测试文件库存为626；新完整用例数及整链通过须由下一冻结候选实测。完整自然NVDA仍未通过，原caption原因UNKNOWN；无NVDA纯探针一次成功及sidecar零样本不算读屏。仍须最终同源全量L1–L3、四包、22入口及完整读屏/恢复、36本地性能、安全、隔离WAL恢复、正式字节备份、正常真实应用和最终独审，全部六条件闭合后才能限定仅剩真实环境。

172项正式MUST保持UNVERIFIED，APP_NEEDS_WORK / INTERNAL NON_READY；不合成登录、批准、费用、Grant、Ads执行或APP_READY。正常用户工作流继续真实Windows应用、args空与canonical userData。下方81033旧字节及全部六项退出条件完整保留，本文件不自嵌最终source/full摘要；最终身份与实测结果由PROGRESS/BLOCKED引用原始报告，冻结后停止修改本文件。

## 2026-10-22 R34 隔离软件样本的店铺运行配置

实际性能采集曾在典型与最大各三轮的前置数据读取报缺少店铺运行配置。正式缺配置拒绝行为保留。隔离生成器现复用与正式初始化相同的StoreRuntimeConfigService、ConfigurationBus和StoreCoordinator：在逻辑备份前为两个真实仓库Store对象切换得到的context逐店创建配置，真实get回读同Store/Profile、active revision1及单条create历史，随后恢复首店并生成原逻辑快照和三个coldProfile副本。未手造context、配置envelope或SQL配置键。

七字段为隔离专用显式值：关闭AI推荐、采集时间08:00、回看14天、分析30天、默认目标ACOS 28%、最低推荐置信度72%、证据保留365天；值经正式服务与配置总线持久化。关闭推荐AI不等于停止采集调度，既有无连接能力门仍保留。未创建真实连接、批准、MissionGrant、AI费用或Ads执行；实际业务权限与真实环境验收不由夹具配置提供。

原四个夹具用例、原27处断言和两个30秒预算完整保留；新增一个配置回读用例及13处断言站点（新用例12处、原用例增强零权限检查1处）。RED状态明确为旧generator加新runtime公开导出和新tests，实际四通过、一失败，首错为current:null；随后仅应用generator初始化，六个相关文件49/49实际通过，包含真实服务/分析合同、三个副本回读及既有配置、跨店身份和admission负例。不是缺导出TypeError，也未提高原用例预算。

实际原件：output/development-completion-2026-10-16/root/r34-store-config-old-generator-red-20261022T032502554Z-275c47da-fb48-4aaf-b9db-e013f92e58ee/report.json；output/development-completion-2026-10-16/root/r34-store-config-six-suite-green-20261022T032803936Z-a5213014-91c4-4b36-8236-403d4b5fe686/report.json；独立实际复核：output/development-completion-2026-10-16/independent/r34-fixture-config-actual-review-3f77c3f6-082b-4c65-bc4a-5165be600ea0/REVIEW.json。源码应用仅三个已审目标，正式四文件、源原生组件、现有包体和两项原始文件保护按实际收据保留，不恢复任何时间戳。

独立纯caption探针曾按原门取得一次成功；附加sidecar因UTC/Local时间比较误拒而为FAILED、零样本，未获覆盖信用。该探针没有NVDA，原完整UI自然读屏失败原因仍UNKNOWN。当前collector原门、一次输入和预算保持；后续必须在新冻结候选完成全量L1–L3、当前四包、22入口/真实读屏/恢复、36本地工程性能、安全、隔离恢复和正常真实应用及最终独审，才可限定为仅剩真实环境。旧候选的通过计数、包哈希及局部探针不授新候选信用。

L1文件清单仍为625，新增夹具用例由下一次完整冻结回归实测计数。172项正式MUST继续UNVERIFIED，状态保持APP_NEEDS_WORK / INTERNAL NON_READY。下方全部历史字节及六项退出条件保留；本文件不自嵌最终源码或完整输入摘要。最终身份和后续实际结果统一外置PROGRESS/BLOCKED与原始报告，冻结后停止修改本文件。正常用户入口仍为真实Windows应用及canonical userData。

## 2026-10-21 R30 读屏与安全检查收口基线

本节复核日期为2026-10-21。当前L1清单为625文件；全仓尺寸实际2130模块、零超999行。下方全部历史字节及六项开发退出条件完整保留。当前仍为APP_NEEDS_WORK / INTERNAL NON_READY，172项正式MUST全部UNVERIFIED。

正式reader在自然NVDA ready后对同一held Main、出生身份、根窗口及Renderer执行一次owned caption setup，临时置顶后恢复原布尔状态；只有正常恢复在原30秒setup内完成才可通过。失败后的独立5秒恢复仅用于清理，不授setup信用。每节点原10秒、owned STOP原15秒及原15秒强制清理预算保持。节点首焦点前原子布防；setup或读屏会话失败保留首错并走owned STOP/close，后续治理零prepare、焦点、键盘及motion，十项保留UNVERIFIED，恢复流程另存明确未执行原因。

caption旧接线完整102项实际97通过、5项行为断言失败；三处正式接线后相关10文件298/298通过，零pending，原名称、断言和预算保留。独立实际复核通过，仅授代码字节与相关回归信用，不授当前包或完整读屏验收信用。原件：`output/development-completion-2026-10-16/root/r30-caption-old-wiring-red-20261021T101652570Z-c58c4502-3735-48e4-9f51-1ea20a124f44/report.json`；`output/development-completion-2026-10-16/root/r30-caption-related-ten-green-20261021T102057624Z-05f41569-7777-49f7-b7e8-a414383cbc5f/report.json`；`output/development-completion-2026-10-16/independent/r30-caption-applied-actual-review-b0fd553d-cc2b-4e06-8cb7-8774358c554f/review.json`。

安全语义检查此前V5的171通过/1失败和V6的172/172通过，均按各自模型历史保留。随后真实Main形状暴露page.evaluate导航回调、27处exitCode写入及非计算class键的误拒。V7仅按26组精确owner/module版本指纹准入原AST中的process.exitCode或window.location.href赋值；非计算class字段/方法key只作为名称，value与computed key读取继续检查，异常日志仅记录固定phase。没有通用window、process或evaluate豁免；原11项静态门、策略、权限、断言和预算保持。Acorn根直接依赖仍精确固定8.16.0并由锁文件绑定。原172安全案例全文保留，仅新增12项，合184项；旧helper完整RED实际181通过、3项合法正例失败，原172与新增9项拒绝例全部通过。新helper完整GREEN实际184/184通过，exit/close为0，保护检查通过，并获独立实际复核。184是安全案例数，不是172项PRD MUST的验收信用。原件：`output/development-completion-2026-10-16/root/r30-security-real-bundle-old-red-20261021T114646906Z-40a28fab-68da-46ab-96d4-1e2e98fe25f4/report.json`；`output/development-completion-2026-10-16/root/r30-security-real-bundle-green-20261021T115207564Z-6f7e6d27-7b64-46c7-b674-ed6c72485dc4/report.json`；`output/development-completion-2026-10-16/independent/r30-security-v7-production-apply-actual-review-7d458940-e5d1-4de5-9001-ef66a7363e02/REVIEW.json`。

尺寸原件：`output/development-completion-2026-10-16/root/r30-real-bundle-boundaries-all-cb22cb72-dae2-4c9f-8c8d-e9a1a1aa0969/report.json`。当前定向GREEN不替代新的完整冻结L1–L3、同源四种Windows包、22入口及20读屏节点/110张截图/失败恢复、36目标工程性能、静态11项与实际对抗安全、隔离WAL备份恢复、正式字节备份、可见真实应用正常启动及最终独立复核；上述软件整链仍待执行。全部六项退出条件实际闭合前不能宣布开发完成或仅待真实环境。

最终身份与后续实测统一外置PROGRESS/BLOCKED和原始报告，本文件不自嵌最终源码或完整输入摘要；冻结后停写本文件。真实账号、正式数据、具体费用与候选批准、真实调用/Ads写入回读及业务观察时间继续另行验收，不合成授权、账单、执行或APP_READY。正常用户入口继续为真实Windows应用及canonical userData，不恢复模拟工作台。

## 2026-10-21 R29 显式验收路径与既有测试边界

验收工具必须先取得显式、非空的selector，并严格通过绝对路径、唯一候选、直接文件与realpath一致性校验，才可交给reader。缺失或空白参数在resolver前拒绝；显式解析调用传入`{}`，不采环境默认；全部异常记录后清为`path=null`。其它工具共享resolver的默认发现接口保持。

原缺参数案例已实际产生两份canonical只读备份；正式文件字节保持，SHM的mtime发生变化，操作系统层面独占触碰的具体原因仍为UNKNOWN。原失败记录保留，不回写时间戳。

旧browser-login源码测试改用精确JSX语义边界，并补3条边界断言；原业务断言和用例保留。两个旧测试的pwsh helper仅增加`windowsHide:true`，宿主、argv、command、env、20秒预算及原103个案例保持；真实正常用户启动继续为可见Windows应用，`args:[]`。

新增11个自足隔离端口案例仅提供模型信用，旧32个案例完整保留。本节不记录尚未取得的通过数量或最终包信用，也不生成真实登录、授权、费用、Ads执行或APP_READY。

当前L1清单仍为623文件，172项需求继续UNVERIFIED，状态保持APP_NEEDS_WORK / INTERNAL NON_READY。下方六项内部退出条件及真实环境边界完整有效；必须完成同一最终冻结版本的全部软件验收和独立复核，才可限定剩余真实环境工作。直接使用真实Windows应用及canonical userData，不恢复模拟工作台入口。最终源码身份与后续实际结果由外置PROGRESS/BLOCKED引用，本文件不自嵌最终完整摘要。

原71917字节及全部历史失败记录精确保留；本前缀仅由root在源码修正与实际相关GREEN后应用。

## 2026-10-21 R21–R28 界面与原生验收边界收口基线

设置页使用当前共享规则和真实配置的明确禁用说明；交付页按实际采用的完整店铺范围同步读取，显式呈现被动读取忙碌状态。执行导航复用一份可见禁用原因并保持各按钮可访问描述，预览与实时可用性仍由原能力门决定。以上不改变Main业务权威、配置总线、批准、费用、Grant或Ads执行。

实包采集器继续使用同次启动并持有出生身份的单一Main根窗口，独立记录当前Renderer。原生前台握手绑定本次token、NVDA进程、节点序号和独立nonce；在原节点10秒总期限内，最多调用一次精确根窗口的SetForegroundWindow，必须重新核对held Main身份及实际前台。API布尔结果或握手ACK均不提供语音信用。STOP优先、请求原子消费、nonce原件归档和仅撤销本次完整pending保持；真实朗读仍要求本次名称/角色、原生焦点归属、自然语音和原始记录交叉成立。

重复prepare显式恢复真实滚动所有者，顺序键盘仅选真实可顺序焦点控件；详情检查器采用已有命名dialog容器和唯一关闭按钮两个不同真实焦点节点。矩阵在键盘返回并重新挂载页面后，使用唯一原预算等待最终稳定状态，再采集DOM与截图。无障碍、滚动、焦点、稳定状态和清理失败继续按原门拒绝，未延长操作、用例或工程预算。

Python隔离harness从实际源码字节compile与exec，不读取或更新仓库生成pyc；标准__pycache__/分类与已有缓存物理原件继续保留。既有测试夹具仅补公共Locator与命名dialog端口，原案例名称、断言、时限及正式binding字段顺序/未知字段拒绝合同保持。当前L1清单为623文件；隔离模型、静态审查和定向测试各按自身证据记录，不生成真实登录、批准、账单、Ads回读或APP_READY。

本节仅记录实现边界与冻结准备。全部172项需求验收状态继续UNVERIFIED，当前仍为APP_NEEDS_WORK / INTERNAL NON_READY。开发完成必须取得同一最终冻结版本的全量L1–L3、全量模块硬约束、当前四种Windows交付包、双档软件样本、22入口/完整截图/真实读屏与失败恢复、工程性能、安全与隔离WAL恢复、正式字节备份、正常真实应用及最终独立复核。最终源码/完整输入、包体和实际结果统一外置PROGRESS/BLOCKED与原始报告，本文件不自嵌其最终完整摘要。

原69014字节、下方六项退出条件和历史失败记录完整保留。软件门实际闭合后，剩余项方可限定为真实账号、正式数据、具体费用/候选授权、真实调用/写入回读和业务观察时间；直接使用真实Windows应用及默认userData，不恢复浏览器模拟工作台作为用户入口。

## 2026-10-19 R20 回归资源隔离与产品保存反馈基线

R19完整L1仍保留FAILED：621文件、6789案例实际6774通过、2失败、13前置待执行，未进入后续层级或新构建。初始化超时的OS原因仍UNKNOWN；本轮文件串行是统一资源准入策略，不是已证资源根因。Vitest继续forks隔离，原覆盖、全部断言、case/hook/locator和NFR预算保持；配置合同在原matcher追加fileParallelism:false，原forks/max4/min1字段保留。

产品保存的实际界面时序观察到成功提示随后随同一身份配置重读被清空。现仅移除selected/selectedContext初始化effect中两句反馈清理，保留草稿/成本刷新；完整operationKey与save begin继续清理旧反馈，旧ticket/ABA、显式产品锁、统一日志及Main权威门保持。静态夹具标题回原值不代表真实数据库回滚。原2案例及14matcher保留，仅新增1草稿前置断言和公开input刷新完成屏障；仍使用原维护tabpanel精确全文、5000ms等待和30秒案例预算，无sleep、私有hook或夹具替换。

相同加强测试在旧生产代码实际1通过/1失败，失败位于刷新完成后的原成功提示检查；仅合上述生产两句删除后，普通七文件52/52通过、零pending/todo，原52名称与次数保留。红：output/development-completion-2026-10-16/root/r20-product-old-red-20261019T103123673Z-19b841b2-a369-40f6-9a09-264aa711aeb0/report.json；绿：output/development-completion-2026-10-16/root/r20-final-seven-20261019T103318988Z-9142a93c-d997-4607-9954-3d6c22feb874/report.json。源码/完整输入、原生、四包、app及正式四文件前后保护相同；独立复核由PROGRESS/BLOCKED引用。全仓2109模块零超限与空白检查通过，原件output/development-completion-2026-10-16/root/r19-boundaries-20261019T103521529Z-ded9e6df-ba99-435c-b934-4140aa5950c1/report.json。

原66679字节及六退出条件保留。库存621、172项UNVERIFIED、APP_NEEDS_WORK / INTERNAL NON_READY保持；仍须新冻结完整L1–L3、同源新四包、22入口/读屏/恢复、双档样本及36本地工程性能、安全/隔离恢复、正式字节备份、真实应用正常启动和最终独审。上述软件门闭合前不能称仅剩真实环境；最终身份与实际结果外置PROGRESS/BLOCKED。

## 2026-10-19 R19 有效批次操作隔离与组件导入收口基线

C084653完整L1原件仍为FAILED：逐assert实际6782通过、1项Readback失败、5项objects前置hook待执行，未进入L2/L3或新构建。原失败及诊断全部保留，objects全量超时的底层原因仍UNKNOWN；后续低载对照不反推其根因。

Readback现按实际采用的有效批次绑定操作范围，显式批次固定时，未采用的fallback数据补齐不再撤销新导出或清空表单；真正店铺、会话、日期和有效批次变化、旧ticket结束保护及Main批次/版本/来源权威门保持。相同19项测试在旧生产代码真实18通过/1项原忙碌断言失败，修复后19/19通过；原18名称、95个matcher及等待预算保留，仅新增1个真实有效批次变化反例。提交观察仅只读当前固定React版本的真实已提交组件状态，不产生Main实时权威信用。

对象组件的11个图标仅改用同包官方CSR入口，实际组件对象相同。两幅真实夹具构建图各4617→100个输入，原65个正贡献模块集合保持；这是移除零输出导入的解析负担，不能称包体减小。原两夹具及构建选项、30秒hook不变，低载准备对照约6.09秒→0.45527秒，不是完整回归或NFR性能信用。诊断Node实际退出0；原生服务在stop后以null/SIGTERM实际exit/close，不能写成原生退出0。

普通综合10文件168/168实际通过，原167案例名称、次数和顺序完整保留，独立复核已闭合；源码/完整输入、原生、四包、完整app及正式四文件前后保护相同。主要原件：output/development-completion-2026-10-16/root/r19-combined-regression-20261019T093704134Z-3bf7e262-4d96-477b-a83e-3e90af692883/report.json。全仓2109模块零超999行、空白检查实际通过，冻结输入前后相同。

库存仍621；原64276字节、六项退出条件及历史记录完整保留。当前须重新冻结完整L1–L3，再完成同源新四包、22入口/NVDA/恢复、典型与最大样本36目标工程性能、安全与备份、正式字节复制、真实应用正常启动和最终独审。172项继续UNVERIFIED，APP_NEEDS_WORK / INTERNAL NON_READY保持；上述软件门未闭合前不能称仅剩真实环境。最终冻结身份及后续实际结果外置PROGRESS/BLOCKED，本文件不自嵌最终完整输入摘要。

## 2026-10-19 R18 真实浏览器测试准备及阶段诊断基线

C081003完整L1原件保持FAILED：逐assert实际6780通过、3外层超时失败、5前置hook超时待执行，621文件/6788案例；顶层6785通过和0pending不作为逐项结论。原raw SHA 3fa95a007ba5bb8c95a4b8a38cb150fea916adac7dac14fd50721243af7036e9，源码/full前后保护通过；未进入L2/L3或新构建。旧6786名称及次数完整保留，仅新增2UTF8案例已通过。

本轮只改三个既有测试文件，不修改生产功能。记忆漂移负例在原synthetic账本中仅预置两条并真实render，原CONTEXT_CHANGED/5秒/options1000保持，正例仍12条及第一页10行。两个Ads真实浏览器case沿用同文件已有30秒局部全生命周期预算，newPage纳入原try清理，并记录单调阶段耗时/原错误；生产45秒、全局测试超时和NFR阈值不变，不把该调整称为产品原5秒性能通过。objects保留两真实串行build及原30秒hook，仅增加开始/完成/失败及单调耗时，未知原卡点或OS原因仍UNKNOWN，不声称已定位资源根因。所有旧案例与断言保留。

首次普通3文件49/49通过，但renderer console阶段日志未进入保存输出，原件保留不授阶段信用。随后仅将Node测试阶段出口改为现有RuntimeLogger标准流，无目录配置或定时副作用，错误日志不能覆盖原错误。最新普通3文件49/49实际通过，旧49逐项完整、零failed/pending/todo，源码/full、原生、四包、app及正式四文件前后相同；原件 G:\AI\amazon-ai-ops\output\development-completion-2026-10-16\root\r18-ordinary-node-phase-2026-10-19T08-43-14-163Z\report.json SHA e20fedb399b84c944baa80291f875b19b49f948244d996ffb1c75ea76b69d88e。实际保存products/events各一started和finished，同PID64032，阶段3425.2741ms/1740.2313ms、hook总5165.8238ms；这只证明本轮定向阶段，不能反推旧超时根因或替代压力下全量。

全仓2109模块零超999行及空白检查实际通过，原件 G:\AI\amazon-ai-ops\output\development-completion-2026-10-16\root\r18-boundaries-2026-10-19T08-44-50-666Z\report.json SHA 2a0096d0d447a3651770179ff3ee6a78e6c95de14e057e9ba305f8247f2a31bf。库存仍621，原61642字节和下方六退出条件精确保留。当前再次冻结完整L1–L3、新四包、软件样本/22入口/读屏/恢复/工程性能/安全备份及正常真实应用和最终独审；全部软件门闭合前不宣称仅剩真实环境。172项UNVERIFIED、APP_NEEDS_WORK / INTERNAL NON_READY及所有旧FAILED保持，最终身份与结果外置PROGRESS/BLOCKED。

## 2026-10-19 R17 Windows PowerShell 交付验收兼容基线

上一C064冻结版本完整621文件6786项、L2四类及L3业务192项已通过，Windows构建、包依赖及目录运行亦通过；其四形态原FAILED保留。随后定向实际观察到系统PS5对无BOM脚本、高级参数默认路径、原生stderr和UTF8中文JSON的兼容边界，全部失败原件继续保留，不由后续结果改写。

本批累计仅改两PS1及原两测试四目标：脚本加UTF8 BOM；省略RepoRoot时进入正文后解析默认目录，显式覆盖及显式空拒绝保持；两原生CLI调用局部Continue并finally恢复原Stop，保留两路日志、实际退出码和严格报告/身份门；五个已核对UTF8 producer的JSON读取显式指定编码，PS5自身UTF16 BOM重定向日志仍自动识别。原卸载、注册表、进程、正式数据保护及业务授权逻辑保持。运行子进程清理继承的Core专用PSModulePath仅限临时验证环境，不修改用户/机器设置或安装模块。

普通相关4文件65/65实际通过，原63逐case完整保留，仅新增2个独立JSON编码case，旧超时不变；实际原件 G:\AI\amazon-ai-ops\output\development-completion-2026-10-16\root\r17-targeted-utf8-2026-10-19T08-00-32-991Z\report.json SHA 00fd6b0d87adfd369f3d65e9fd71947d2e73007202d5629cbf3c4ef7ba39e1ec。PS5/PS7受控实际覆盖退出0/17、完整双流、恢复Stop及中文/引号/emoji无BOM JSON和畸形JSON拒绝。旧C064包的安装、便携和ZIP三形态亦实际通过，安装含真实卸载/注册表恢复；原件 G:\AI\amazon-ai-ops\output\development-completion-2026-10-16\root\r17-old-c064-three-form-compat-2026-10-19T08-01-43-594Z\report.json SHA fc4a7a35f036e2c0845cc845a9d61e7c04148a13ff4d84ae9071f60914850005，全部前后保护相同。这只是旧包兼容定向，不授R17新源码完整回归或新包信用。

库存仍621，原始59292字节及下方六项退出条件精确保留；172项继续UNVERIFIED，APP_NEEDS_WORK / INTERNAL NON_READY保持。当前一次同步本维护文档后重新冻结完整L1–L3、新四包及全部软件界面/性能/安全/恢复/正式备份/正常启动和最终独审；全部闭合前不能宣称仅剩真实环境。最终身份及实际结果由PROGRESS/BLOCKED引用外部原件，本文件不自嵌完整摘要。

## 2026-10-19 R16 参数化案例追踪名称精确对齐基线

R15冻结候选 development-candidate-20261019T062810Z 已实际完整通过621文件6786项、L2四类及L3业务28文件192项，六步骤及最终source/full前后保护通过。L1原件SHA 121cfb8130d35214539a5a0826c409fef0c6b1a4dad49bf56bc43dac76f5fc5a，L3原件SHA 4295c40648c61269c1196e66a0433b7dae02bb788b2444bccccff992f1d71b01；internal-run原件SHA 739db4329a6a7e06db5c10c87b1d91506f61e93008778a91a2786500ab3a8365。此前原75/76解析子进程失败仍保留，不由本次结果改写。

独立追踪全量枚举1020个映射发现8处名称登记差异，限定4项需求的零值、引号及长文本格式；相应测试生产实现均存在。根用本轮实际verifyEvidence分别核验737条L1与205条L3引用，确认仅同8处失配。现只精确更新 requirements_index 中8个caseId，旧416357字节备份及8步逆操作可逐字节还原，更新后416338字节。实际落盘原件 output/development-completion-2026-10-16/root/r16-trace-correction-2026-10-19T06-43-29-657Z/report.json SHA 58ab8b113bd42c1945a6449353a238ed93d519e808cd10f89bc89ac84268fcfb；对照本轮名称集合已无登记差异，不修改测试名称、断言、严格匹配器、权限或费用。

172项全部保持UNVERIFIED；78条非文件检查只核对声明结构，其中L4–L7尚缺实际正式原件，不能把名单当通过结果。六项退出条件与下方历史原文精确保留。新源码、依赖、测试库存621及本维护文档再次冻结，须重新完整L1–L3和当前实包整链；前轮raw仅提供名称参照，不授新身份全量或包体验收信用。仍为APP_NEEDS_WORK / INTERNAL NON_READY，全部软件门与独立最终复核通过前不声明仅剩真实环境。最终身份及实测结果外置PROGRESS/BLOCKED。

## 2026-10-19 R15 实包 Worker 日志关联验收收口基线

上一冻结候选完整621文件6786项、L2四类、L3业务192项以及当前Windows四包构建均通过，但四形态实际运行止于目录版日志关联检查；其余三形态未运行。原FAILED目录报告SHA 73d7271b7ff47f3e91d99a3a952b46af75dc75779893a0aa8b4aa156090e3108 保留。生产Main生成UUID、Worker传回并经共享日志出口稳定脱敏；导出原nonce经同一格式投影精确命中真实日志，缺口在验收读取器错误要求持久日志含原UUID，未改变生产隐私规则。

本轮只修改既有receipt读取器及对应测试两文件：先校验原导出UUID，通过公共createRuntimeLogRecord计算精确期望别名；目标事件的顶层Main标识必须为规范nonce类别/20位小写摘要，仍至少3个独立标识且精确包含导出投影。重复不足、错误导出、坏UUID、缺失或非目标事件不得补数，nested不能替代顶层Main字段；单测经过真实Worker/Main格式器及JSON往返，旧案例与断言保留，库存及21个案例不增不减。

普通相关9文件76/76实际通过，零failed/pending；原件 output/development-completion-2026-10-16/root/r15-targeted-confirmation-2026-10-19T06-26-00-543Z/report.json SHA 5bb669424f5c7be5c2b01b5bd6ed13b75967872093c81b0d3cb4bb1b2deacb2c，源码/完整输入、原生、四容器、完整app和正式四文件前后保护相同。独立静审SHA 356aebb4e9ed14ed9aa5f291e30de90e4dbbb9414971688afc516eef5c33ab15 确认两文件精确微增量及生产链不变。此前同组75/76失败亦保留：旧wrapper仅启动pwsh解析脚本参数时发生CLR内部异常，未运行安装器或应用；原raw无该子PID，时间匹配Windows事件不升级为精确PID因果，底层原因UNKNOWN，未加入重试或降低门。

下方原文及六项退出条件完整保留。当前重新冻结完整输入并执行完整L1–L3、新四包实跑、22入口/读屏/恢复、36目标工程性能、安全、隔离恢复/正式字节备份和真实应用正常启动；在全部软件门和最终独审通过前仍未开发完成。APP_NEEDS_WORK / INTERNAL NON_READY及172项MUST UNVERIFIED保持；最终身份与实际结果外置PROGRESS/BLOCKED，不自嵌本文件完整摘要。

## 2026-10-19 R14 原生启动测试夹具发布读取收口基线

旧完整621文件6786项实际6785通过/1失败，原件`output/v16-evidence/development-candidate-20261019T051750Z/V16-T-L1-ALL.runner.json`（SHA-256 `21f2d13be078d45b59923e458f038f562ceb1993fc726a134c19227ab6fde67c`）保持FAILED。两条Windows原始事件精确对应synthetic child62304的未处理IOException/CLR退出；协议顺序定位到第二次读取HANDOFF_RELEASED，原具体Win32 HRESULT仍UNKNOWN。CreateNew/FileShare.None发布与Exists读取之间的共享窗口为代码及时序支持的推断，不倒填原事件。

本轮仅修一个既有测试夹具：接收侧仅对精确共享/锁冲突HResult 0x80070020/21，在原30秒总期限及25ms间隔内等待读取；内容解析在等待外，其他错误继续失败。原it/runIf条件、26条expect、60000ms用例超时及生产helper保持。新增自有唯一小文件原生探针和分阶段失败诊断；协议与清理同时失败时聚合保留两条异常链，两phase原件分别wx写入，协议失败不自动删除自有目录。

普通根7文件66/66已实际通过，零failed/pending/todo；CLI PID46292的spawn/exit/close已观察且exit/close0/null。自检实际持锁预算100ms、耗时127ms、观察3次HResult -2147024864（共享冲突），关闭句柄后零冲突读成功，畸形JSON仅一次解析并拒绝。该次真实handoffConflicts为0，不能声称这次正常交接复现了原故障或恢复原HRESULT。所有源码、原生、四包、完整app及canonical四文件前后保护相同；模块2109个零超999行，格式检查通过。

合入源码为`f93904c35f3f04870c13579c2c79e6571e5f4f94b536c90db0acc9c19d4c0953`。普通66原件`output/development-completion-2026-10-16/root/r14-root66-2026-10-19T05-48-19-109Z-0a78d781-2edd-47e3-91bf-6142fb28c105/report.json`（SHA-256 `ce402ad4aa12d894ad5783fd17a701e886a391ceddf2c1a27e678e7d26eef2e2`）；单文件静审SHA-256 `434de38a6d2d20a35ef5f79945cc4067e91a57f2fa5895d9291dd9d21bafdcce`。实际独审及最终冻结身份由PROGRESS/BLOCKED引用外部原件，本文件不自嵌最终完整输入哈希。

库存仍621，无新增/删除测试用例；manifest、六项开发退出条件和全部下方历史原文保留。原完整FAILED与补充L2/L3结果各按自身身份保存；定向66不能替代重新冻结后的完整L1–L3及当前四包/界面/性能/安全/恢复/正常启动。当前继续APP_NEEDS_WORK / INTERNAL NON_READY，172项MUST仍UNVERIFIED，尚不能声明仅待真实环境。

## 2026-10-19 R13 证据目录原生身份无损收口基线

本轮仅修正证据目录与文件的原生身份精度：path/FD及目录前后检查使用BigInt，dev/ino无损序列化为规范十进制串，保留精确安全旧数值兼容并继续拒绝不安全Number；纳秒竞态、owner/fixture绑定、跨档物理树去重及原24小时/预算门保持。暂存12文件253/253已实际通过并获独立复核；这只提供隔离软件信用，不等于真实根或全量验收。

六个已审身份源码/测试目标及L1清单已精确落盘，新增一测试，库存620→621无删除；全量尺寸2109个代码模块零超999行，空白检查通过。随后普通根默认Vitest CLI的12文件253/253实际通过，零failed/pending/todo，子进程PID38528的spawn、exit、close均已观察且exit/close0；执行时源码与完整输入前后相同，原生依赖、四包、完整app及正式canonical四文件保护未变。这是落盘代码的定向信用，不替代完整621文件回归。

合入阶段源码为`47acc2ba13f82a2d601f9cf93915f7687dc348a6e4c5fed27e9b3d67dd510868`。普通根253原件：`output/development-completion-2026-10-16/root/nfr-root253-c72a1e96/runs/actual-2026-10-19T05-12-27-501Z-6628ec46-983a-44fe-b061-6f5b3651dc9e/report.json`（SHA-256 `73c6a92821f44f7ed589bdcb589dc81d8276ff2f4bb1b9ab16ffda166bc723a8`）；模块与空白检查：`output/development-completion-2026-10-16/root/r13-boundaries-2026-10-19T05-12-55-954Z/report.json`（SHA-256 `9fd06d53d151a1dd77540cd4ba2f2229c2bfb47d7fba119c0f84252dffde1ce7`）；独立实际复核：`output/development-completion-2026-10-16/independent/r13-postapply-root253-actual-review-2026-10-19T05-16-13-089Z-52afdb78-e86d-40c3-8d86-4f10e08382b8.json`（SHA-256 `9786394098f88dc90660adb49f272068bf1e01aa4e2bd05395adab3e413e90bf`）。本次文档微增量后重新冻结完整输入。

此前620文件全量L1实际为6759/6762、3失败、零pending，原件`output/v16-evidence/development-candidate-20261019T042720Z/V16-T-L1-ALL.runner.json`（SHA-256 `feeb76a72f42cca878e977da65d17dbe73730ff7aacf7c0460ea24464293559c`）保留FAILED；三个已删除临时目录的具体inode不能恢复，现存原生NTFS高inode与Number精度损失诊断不倒填为其原值。定向修订不改写原全量结果，仍须按新冻结身份完整重跑。

下方六项开发退出条件、L1–L8合同和历史记录原文保持；当前仍为`APP_NEEDS_WORK / INTERNAL NON_READY`。同源全量L1–L3、隔离迁移/备份/恢复、新四包、22入口及无障碍、36目标实包性能比较和独立最终复核未全部闭合前，不能声明仅待真实环境。最终身份与实际结果由PROGRESS/BLOCKED引用外部原件，本文件不自包含其最终完整输入哈希。

## 2026-10-19 R12 原生性能采集与夹具对齐合入基线

本批24个NFR目标及1个旧页面交互测试support，共25个目标（8个既有、17个新增）已精确落盘；新增测试恰6个，Git全量测试库存614→620，无删除；全量尺寸2107个代码模块均不超过999行。暂存组合11文件229/229及旧页面交互18/18已分别实际通过并获独立复核；随后普通根12文件247/247实际通过，零failed/pending/todo，实际子进程PID59768的spawn、exit与close均已观察且exit/close0，源和完整输入前后相同。这是当前落盘代码的定向软件信用，不等于全量620文件或当前EXE性能通过。旧完整614文件6616项中的10个失败及中间runner/夹具失败保留原状态，不由此次结果改写。

合入阶段源码为`eae91cff2c1ebfeb64faad44f462640a47b79382a6ee4319e4630946cf0f13fc`。普通根247原件：`output/development-completion-2026-10-16/root/nfr-root247-91c342ad/runs/actual-2026-10-19T04-16-22-265Z-32132dd0-0e6d-4141-baa3-de2c6fe74f2e/report.json`（SHA-256 `e8c276d577bf3f98d13c86d6f066360af489a1471a1d749ec50390ebc417dca6`）；独立实际复核：`output/development-completion-2026-10-16/independent/r12-ordinary-root247-actual-independent-review-2026-10-19T04-21-33-691Z-b76bc488-6801-43cb-90b6-817af588c89b.json`（SHA-256 `f0d59564fdfd3a4483f5e5cd47989c20da5c351bd17eb45caad81c86138cfb3f`）。本次文档微增量完成后重新冻结源码与完整输入；最终身份及全链实际结果由PROGRESS/BLOCKED引用外部原件，本文件不自包含其最终完整输入哈希。

Main/Renderer内存使用Windows原生累计峰值，绑定冷/暖启动各自的PID与进程创建时间，再重算所选最大值；单位MiB，窗口为`process-lifetime-peak`，覆盖进程启动至各阶段采样，暖阶段采样后的退出清理不在本次窗口。旧`after-sample`内存截面不升级为峰值。

经营记忆搜索新增独立真实界面观察器。标量仅为预先选定的唯一命中查询：同次单调毫秒计时端点重算耗时，结果完成与上下文/账本绑定；零命中和清空是必需正确性对照，准备与可见详情核对在命中计时之外。P95只聚合各独立命中查询耗时，不能把三次操作的最大值称为全部查询P95。

原`evidence-growth / bytes / after-sample`保留为单轮增量诊断。正式`evidence-daily-growth / bytes / at-least-24h-endpoint-net-byte-change`必须重核至少24小时原始端点库存、实际fixture合同、profile和owner，以及跨档复用/重叠；保留有符号净变化，不按天外推，也不证明中间瞬态写入或gross写入量。窗口完整七字段为计划元数据，`actualMainContextObserved:false`、`bindingRole:planned-fixture-window`；软件阶段标为`PENDING_REAL_OBSERVATION`，不能把短窗口原件升级。采集与校验能力的软件验证已完成，正式日窗口仍待真实观察与批准预算。

软件目录保留原34目标并新增两档memory-search，合计15类36目标，每目标至少3个独立真实EXE样本。内部工程阈值按桌面响应、资源余量和既定样本定义预先提出，已获独立定义可用性复核，尚待当前EXE实测比较；该定义不等于用户批准的正式性能/AI预算。完整性能目录为21类48目标，其余AI证据仍按正式合同验收，不能以软件采样或假账单替代。

下方六项开发退出条件及L1–L8合同保持。当前普通247仅为定向回归；仍须同一最终冻结身份下的全量L1–L3（当前L1库存620文件）、隔离迁移/备份/恢复、新四包、22入口及无障碍、36目标实包性能比较与独立最终复核，不能沿用旧包或暂存结果。上述软件侧待办未闭合前，不能声明只差真实环境。当前继续`APP_NEEDS_WORK / INTERNAL NON_READY`。下方各日期章节及其“当前”表述均保留为该历史检查点身份，不授予本次候选信用。

## 2026-10-17T10:20Z 共享业务配置前置与未读取展示收口基线

R10完整611文件6537/6537、L2四类、L3业务192/192及七步Windows构建按旧身份保留；其目录虽通过11个业务检查，仍因合法未配置店铺触发三次分析管线错误日志整体失败，未取得四形态通过信用。此次只修复该共享读取边界及必要页面展示，未改变Main、预加载、数据库、配置总线、授权、执行或迁移合同。

共享hook在每次读取中以当前完整七字段店铺上下文预检canonical配置，await后保持原取消/世代门；复用原delivery严格纯投影断言。合法空投影返回data:null、明确配置待创建并沿统一日志warn，不调用分析、不合成零指标；坏配置、错店、过期返回和配置后的真实失败仍按原异常路径处理。页面按统一Notice/Guard隔离依赖数据的区域，保留范围保存、静态八类采集目录、独立任务/队列和本地草稿。已有配置的Guard不增加DOM包装；原本地导入的“仅检查”误导文案改为真实导入，权限/写入逻辑保持。

最终暂存48项纯校验、16项真实浏览器hook检查、15项页面接线及完整desktop overlay零诊断均已实际通过，并保存旧断言红灯、加载/等待API失败、类型错误及逐版本修订原件；overlay不替代本轮完整L2。26目标经独立审查精确落盘后，旧定向发现两个旧测试适配文件：仅补configured夹具的新配置端口及原概览/首屏peer的严格对象定位，另将采集title/detail两个精确静态串扩为真实条件全文。旧案例、操作顺序和expected保留，原失败采集action四例已通过，其可选getter未纳入改动。

原26目标真实落盘与本次额外2测试复制分别记录，旧过渡/计划/失败原件不覆盖；整合原件位于`output/development-completion-2026-10-16/root/r11-transition-aligned-2026-10-17T10-16-28-555Z-51e3cf29-f681-464c-9e36-b4f45c45adb1/`。根session94470实际exit0，普通根无alias/暂存选择的52文件定向887/887通过（旧49文件808项、新3文件79项），零pending/todo，实际子进程exit/close0；源和完整输入前后相同。测试库存611→614仅新3无删；全量尺寸2090模块零超999行，空白检查通过。

当前源码`c2b3e4d2f5299e7d3b41690c95c0d5f3cfeddab0c80d09a83e413fdf4f3a2fa3`。最终微增量只含28个renderer源码/测试目标、L1真实库存及本维护基线，全部安全源、权限、需求/验收定义的其余字段与迁移合同严格保持。完成当前差异独立复核后冻结源码、测试及本文件，重新执行完整L1–L3、新四包构建/实际运行、界面/读屏/恢复、实际EXE性能、匹配WAL恢复及最终复核，再备份正式目录并普通启动真实应用。本文件冻结后的实际结果外置PROGRESS/BLOCKED；本基线不提前授予开发完成、APP_READY或172项MUST验收信用。

## 2026-10-17T08:29Z 显式范围验收与原始身份索引收口基线

R9的609文件6489/6489、L2四类、L3业务192/192、七步Windows构建、双软件样本与隔离WAL恢复均按旧身份保留；其目录实跑因验收遗漏既有“确认并保存范围”前置而失败，四形态整体没有通过。实际Node CPU profile与独立SQL探针定位INSERT触发器查找热点，只提供诊断，不提供EXE耗时、P95或预算信用。

本轮仅落盘两项已独立审查的六文件提案。隔离运行脚本通过生产范围页的可见按钮确认范围，再只读核对Main持久值、完整七字段上下文及重启保持，不自动保存、不放宽严格范围门。统一identity installer增加完整、非唯一、非partial的原始13列lookup索引；旧表达式lookup、触发器、DELETE/INSERT、归属权限、schema20与迁移checksum保持。旧lookup测试仅多一条setup DROP新索引以维持原无完整索引基线，原55个expect及名称保持。

范围暂存同字节34项由旧33通过/1真实失败到34/34，分层VM与生产Page/API mock分别按其边界保存；raw索引同字节14项由旧8通过/6真实失败到14/14，暂存相关25文件220/220。VM不是Electron transport，Page/mock截图不是完整应用视觉，overlay零诊断不替代当前L2。落盘后普通根Vitest实际26文件254/254、子进程exit/close0，源输入前后相同。真实Git测试库存609→611，仅增加两文件无删除；全量尺寸门2084模块、零超999行，空白检查通过。原件与落盘备份在`output/development-completion-2026-10-16/root/r10-transition-2026-10-17T08-27-59-840Z-c9fadd11-9de2-4644-8cb2-3acbc4e49892/`，两项独立审查在同批`independent/`目录。

当前源码`89680758ac7d228224c8ac14e6ea39af8b1ab5168f83b8d8362496216cf45770`。安全源快照仅允许该已审identity文件的摘要、长度与base64随相同源码变化，其余安全源及迁移合同完整等值。最终微增量复核后重新冻结全部源码、测试和本文件，执行完整L1–L3、新四包实际运行、L4界面/键盘/读屏/恢复、L5实包性能、匹配WAL恢复与最终独立复核，最后备份正式目录并普通启动真实应用。全部完成前仍非开发完成或仅待真实环境，172项MUST保持UNVERIFIED。

## 2026-10-17T06:51Z 交付首屏与实包消息定位器收口基线

上一冻结源码`84ffcda7…dd4b`完整607文件6454/6454、L2四类及L3业务192/192和七步四包构建均通过；典型/最大软件数据亦实际生成完毕并通过独立库存、源/包及退出保护。目录实跑未通过：首load被未配置店铺的业务pipeline阻断，而刷新成功消息的exact文本定位器未匹配带标题的Panel。后续真实GUI观察证明Worker实际exit0、Main与Renderer刷新均成功；原正常关窗的触发源仍UNKNOWN。所有旧失败/诊断/包及数据均按原身份保留，不移用于新候选。

本轮只修两处已证实问题。Renderer先读既有canonical店铺配置投影：合法未配置状态跳过依赖运行配置的业务读取，仍读取真实验收原件，业务数据持续标为UNKNOWN并给配置入口；已有配置的业务读取失败与严格验收失败继续拒绝，店铺及异步世代隔离保持。概览、矩阵、详细金额与复制摘要不再把未读取数据显示为零。完整配置版本历史审计继续由Main统一负责，未改Main、配置总线、Worker生命周期、权限或严格验收/导出合同。

验收脚本仅提取共享消息等待，采用准确命名region、准确标题、转义后完整正文及真实可见性，刷新与NON_READY导出共用。真实生产Panel/React/Chromium同字节红例7/11、修复后11/11，当前相关6文件65/65，原52执行项按参数化发生次序保留；4次自有浏览器actual exit/close0。首load固定ignored红例18项2通过/16真实断言失败，同字节green18/18，普通4文件87/87及桌面类型检查通过。新unit仅另将beforeEach回调改为void返回修正TS2322，断言不变、原失败保留。定向原件位于`output/v16-evidence/development-completion-20261017/root/delivery-message-selector/`及`root/delivery-initial-load-config-missing/projection-v2/`；独立审查位于`output/development-completion-2026-10-16/independent/`。

真实Git测试库存已607→609，仅新增2文件无删除；2081生产与构建/验收模块零超999行。当前源码`86e1e851725aca463e9610c3abe57ec2b9a18ca7a3f053dffa10fd79c20e9da6`。完成落盘微增量独立绑定后重新完整冻结L1–L3，再构建同源四包并实际运行、完成22入口/键盘/读屏/恢复、本地典型/最大性能、WAL备份恢复和最终候选复核。冻结期间本文件及全部源码/测试停写，进展仅更新PROGRESS/BLOCKED和ignored原件；当前仍未达到仅待真实环境的退出条件，不授APP_READY信用。

## 2026-10-17T05:46Z 大样本查找索引单点后的冻结基线

上一源码`0dfd939e…145b`完整606文件L1为6449/6449、L2四类、L3业务192/192均通过，源码和完整冻结输入一致，原诊断及最近afterAll失败逐项对账通过。随后只修已证实的大样本逐行删除扫描：中央索引ensure为完全原DELETE补充非唯一、非partial、同13身份表达式lookup索引，保留原partial唯一索引及数据/隔离逻辑，已有schema20启动同样幂等安装。没有更改删除/插入条件、authority或schema版本/迁移checksum。

新专用测试先在原生产代码执行：5项可加载、4项因缺失lookup或缺失精确查询计划失败、1项原删除范围通过；相同测试字节在补丁后5/5通过。相关24文件206/206、local-db类型检查通过，50个受保护源码SHA一致，已有schema20缺失/错误索引重开和数据/隔离ledger/hash/外键/integrity核对通过。首轮非法跨店批次测试夹具被既有触发器拒绝的原件保留，不计为产品缺陷。原件见`output/v16-evidence/development-completion-20261017/root/metric-lookup-index/`；查询计划原件不冒充实际EXE耗时。

真实库存已同步607文件，2078生产及构建/验收模块零超999行；当前源码`84ffcda741ba48ee8e0bc1d2394706bcd8c2dc74731f35342997483ede65dd4b`。独立复核闭合后最终冻结完整L1–L3，再构建和实际运行四包，完成22入口/键盘/读屏/恢复、本地典型/最大性能、WAL备份恢复及最终候选复核。执行时本文件和全部源码/测试停写，结果只进PROGRESS/BLOCKED与ignored原件。当前仍未达到仅待真实环境的退出条件，不授APP_READY信用。

## 2026-10-17T05:26Z 测试收尾单点闭合后的冻结基线

上一冻结候选606文件的6441断言全部通过，但性能观察测试在根afterAll超过默认10秒，suite失败；源码与完整输入未漂移。原件没有浏览器PID/退出记录，不能据此声称已证明具体OS卡点。本轮仅调整测试生命周期：持有BrowserServer的确切ChildProcess、明确30秒正常关闭及10秒强制清理、45秒专用hook，记录exit/close，超时即使清理成功仍抛原错，双失败保留AggregateError；最后日志出口失效也不能覆盖清理异常。生产采样器和全局Vitest设置未改。

原13项业务断言完整保留，新增8项生命周期反例；两次相关聚合4文件45/45，根组合3文件47/47。独立Chromium正常退出及停滞注入后的自有回收有原件；故意复现的旧10秒hook失败和双日志出口红例保留。根预加载构建测试只补临时目录删除前的绝对路径、父目录、前缀及直接路径核对，原13项断言未改且通过。

当前测试库存仍606文件，生产及构建/验收模块2077、零超999行，源码`0dfd939ef0a7474077a737b617c963503ef951ea45e3bcfc19cfad2f1ef0145b`。完成独立只读复核后重新冻结完整L1–L3，再构建并实际运行四包、完成界面/读屏/恢复、本地性能、WAL备份恢复及最终候选复核。执行期间源码、测试和本文件停写；当前仍未达到仅待真实环境的退出条件，后续事实见PROGRESS/BLOCKED。

## 2026-10-17T04:57Z 实包启动修复后的冻结基线

上一候选完整回归及构建通过，但目录EXE实际白屏；预加载bundle在暴露桥接前引入沙盒禁止的`node:crypto`。现改用浏览器条件生成单CJS及map，写出前校验输出和仅外部`electron`的依赖白名单，仍保留沙盒、上下文隔离及禁用Node集成。Main在加载前接入统一脱敏预加载日志，Renderer在App/Provider外提供中文错误与显式手动重载。

组合10文件73/73、零跳过/待办；其中真实Electron44.2沙盒正负例3/3，生产接口130项、被动业务IPC为0，禁止模块实际触发preload-error，中文错误与手动重载均可观察。生产构建、Main日志、Renderer接线独立只读复核无已证实问题。原件见`output/development-completion-2026-10-16/root/preload-startup-fix/`及`output/v16-evidence/preload-sandbox-focused-handoff.json`。这些定向结果不提供正式包验收信用。

当前测试库存606文件，生产及构建/验收模块2076、零超999行，源码`a9cc81e32a2b07c513d8d101708830148631c74798cfa11009da6375fdf0a070`。全部源码、测试及本文件在冻结后停写；新候选须完整L1–L3、重建四包并实际运行、22入口/键盘/读屏/恢复、本地性能、隔离WAL备份恢复和最终独立复核。正常本机应用仅在上述软件验收及备份完成后启动。未达到仅待真实环境的退出条件，不授APP_READY信用；后续结果只更新非冻结进展文件与ignored原件。

## 2026-10-17T04:12Z 最后单点收口后的冻结基线

ZIP清理身份缺口已最小修补，两个分支采用精确EXE/创建时间、非零句柄与二次身份核对、同对象终止/等待/释放；未知、复用、查询失败/非唯一和仍存活均拒绝，调用层亦保存失败账本，不能确认清理则保留目录。新34个行为案例与原45个合同组合79/79、零跳过，原NSIS及相关原合同未改，详细原件见PROGRESS顶部。

最终测试库存603文件，生产及构建/验收模块2071、零超999行，空白检查通过；源码`91d6c8d15a2fdc8a8a242ea243f00006acebecd044e209bcb572e55d0e762605`。上一源码完整回归通过仍按原身份保留，当前重新冻结完整L1–L3，再重建四包和实际EXE内部验收；本文件属于冻结输入，执行期停写，后续实际结果以PROGRESS/BLOCKED及对应原件为准。只有全部内部退出条件通过并完成候选独立复核，才可宣布开发完成；当前不授APP_READY信用。

## 2026-10-17T04:02Z 完整回归检查点与ZIP单点

源码`1e80eec4…2d24`的完整内部L1–L3已通过：602文件6378/6378、四类静态检查、业务192/192；原30失败逐条对账通过，源码与完整构建输入前后相同，原件封套重验通过。运行目录为`output/v16-evidence/development-candidate-20261017T034145924Z/`，下方03:42Z的“仍未通过”是保留的历史检查点。

新包构建前另确认ZIP验收脚本的清理身份缺口：路径不可读仍按PID停止、校验与停止间未持同一句柄、路径前缀不具边界。当前仅解冻此单点及其故障反例，复用安装版已有精确EXE/创建时间和句柄复核模式；随后必须按新身份重新冻结完整回归，不移用上一源码的通过结果。当前四包、实际EXE界面/读屏/恢复/性能、备份恢复和最终候选复核仍待完成。最终事实与未完成项见PROGRESS/BLOCKED顶部。

## 2026-10-17T03:42Z 完整冻结包含文档

第二次完整L1因包内Worker suite初始化的`V16_TEST_SOURCE_CHANGED_DURING_BUNDLE`仍FAILED：6374实际通过、4未执行，不能采用runner顶层矛盾的全通过计数。源码身份前后稳定；本代理运行中写入本文件与suite真实初始化窗口重合，本文件属于implementationInventory，因此外层代码摘要不变不足以代表完整输入未变。失败时两份库存未落盘，唯一精确差异不作已证实结论。

全部停写后原suite4/4通过。下一轮保留守卫并增加完整输入逐步骤摘要和原件冻结，源码、测试及正常文档均停写至内部回归和新包构建结束；输出只写忽略目录。当前完整L1–L3、四包及实际EXE内部验收仍未通过，六项开发退出条件保持未完成，详情见PROGRESS/BLOCKED顶部。

## 2026-10-17T03:28Z 修复后重新冻结

唯一类型导出失败已由实际浏览器、64/64定向、类型检查及独立全语句AST/符号复核闭合；3个facade只标明7个纯类型，其余值导出与业务不变。新源码 `1e80eec4…2d24` 的602文件完整L1正在重跑，Node原生运行时与2070模块尺寸门通过；后续L2/L3、四包及实际EXE和最终候选审查仍待执行。下方03:16Z为保留的失败检查点。

## 2026-10-17T03:16Z 完整回归发现的模块链接阻断

冻结L1实跑602文件6378例，6377通过、1失败、零跳过，源身份稳定。唯一失败是Renderer纯类型导出被当成运行时导出，页面链接未完成；修复后需重新冻结并完整重跑，当前不计全量通过。L2/L3和当前四包/实际EXE验收尚未执行。原件及修复进度以PROGRESS/BLOCKED顶部为准，六项退出条件仍未全部满足。

## 2026-10-17T03:09Z 当前冻结执行口径

两组末审日志缺口已修复并由151/151、桌面类型检查及独立复核闭合；最终602测试文件、2070生产与构建模块（0超限）已冻结，源码摘要 `8a0e5e0de7d26e804beac9ab299ce3d021de46fa3a844b374967b9b18362953c`。Node原生运行时与尺寸门通过，完整L1–L3执行中；当前四包与实际EXE界面/无障碍/恢复/性能及最终候选独立复核仍未完成。只在六项退出条件全部满足后宣布开发完成，下方旧检查点按原时点保留。

## 2026-10-17T02:52Z 当前生产范围尺寸已闭合

4个大CSS已按职责拆分，规则/声明及级联独立等价、Vite4/4、定向579/579和桌面类型检查通过。尺寸门当前覆盖生产源码与桌面构建/验收脚本、Vite/Vitest配置，包含样式、Python、PowerShell等，共2065模块、0超限；历史原型/设计档案与本地发布产物不属于该生产源码范围，保留原状。下方02:42Z的4项超限已闭合。

生产依赖扫描0告警，L1清单599；采集进度通知、凭证安全诊断两组全局日志末审缺口仍在修补。随后仍须冻结完整L1–L3、匹配四包及实际EXE验收和最终独立复核，六项退出条件尚未全部满足。

## 2026-10-17T02:42Z 全实现资源尺寸口径更正

此前尺寸门仅覆盖JS/TS。现将CSS/SCSS/Sass/Less、Python及HTML/Vue一并纳入；1988文件实查仍有4个超999行CSS，最大styles.css为13022行，正在按职责及原级联顺序拆分。较早“全仓0超限”均为当时JS/TS范围的结论，不代表所有实现资源。原件及当前进展见PROGRESS/BLOCKED，完成拆分及独立顺序等价复核前不冻结候选。

生产依赖扫描的11项告警已通过4个兼容修补版本更新后归零；当前L1库存598。完整冻结回归、当前四包及实际EXE验收仍须完成，不能从定向结果宣布开发完成。

## 2026-10-17T02:05Z 当前收尾顺序

当前继续完成六项内部退出条件，不能认定“仅待真实环境”。172/172需求已完成精确实现/AC/案例映射，全部UNVERIFIED，L1库存596。22入口交互组合90文件1183/1183，应用源码前后身份一致；此后原因确认框焦点返回的真实反例已修复，4文件34/34通过，须纳入最终冻结全量。全仓尺寸门最近1954模块、0超限。首次组合的源码漂移失败原件保留；定向结果不作为完整验收。

先完成全部实际入口的精确追踪及采集工具软件验证，再同步最终库存并停止源码/定义写入；随后完整L1–L3、当前四包及真实EXE的界面/恢复/无障碍/性能、最后独立审查与文档对齐。只有完成这些，剩余项才可限定为真实账号、数据、预算授权、候选批准、Ads读写和观察时间。下方较早“当前”描述均为对应时点记录；最新事实与原件见PROGRESS/BLOCKED。

## 2026-10-17T01:10Z 当前开发退出条件

当前全仓尺寸门覆盖1910模块、0项超999行。共享操作、业务管线、导入/Listing等14文件225/225，共享费用/确认/状态/检查器等5文件86/86；桌面类型检查通过。配置与日志本轮确认的三组缺口已修复并有78/78定向证据，未发现已证实的生产配置总线绕过。

实际路由复核区分22入口与旧兼容页，原生Listing、店铺切换/连接和共享动作仍在交互收口。需求仍170/172具精确映射、全172项UNVERIFIED。最终完整L1–L3、隔离迁移/恢复、当前四种Windows包的22入口/键盘/无障碍/性能和冻结后独立审查尚未完成；下方六项退出条件全部闭合后才可称为“开发完成，仅待真实环境验收”。详情以PROGRESS/BLOCKED最新检查点及原件为准，较早数量和代码形态仅为历史记录。

## 2026-10-17T00:25Z 当前退出条件状态

最新全仓尺寸检查覆盖1887文件、0项超999行；L1已补齐到实际568测试文件，工作区类型检查通过。需求映射170/172、全172仍UNVERIFIED；全局禁用原因/恢复与即时反馈AC、统一配置/异常日志最终审计、同一冻结源码的完整L1–L3、当前四包/22入口/无障碍/性能及候选独立复核仍须完成。达到开发完成必须闭合下方六项退出条件，不能仅凭尺寸门或局部回归宣布“仅待真实环境”。

当前事实与原件见PROGRESS最新检查点，剩余工作以BLOCKED最新五组清单为准；下方较早数字为历史快照。

## 2026-10-17T00:03Z 当前收尾口径

本节取代下方旧盘点中“当前”的数量与实现状态，原记录保留。当前需求映射170/172，但全172仍UNVERIFIED；禁用原因/恢复和异步即时反馈仍待补齐，verified成功语义已补具体反例但尚无最终当前验收信用。全量模块检查覆盖1805文件，6项仍超999行，原件为 `output/development-completion-2026-10-16/root/module-boundaries-status-20261017.jsonl`。

Main已收为薄组合入口，V16包内worker/冻结构建库存、L4–L7原生适配、发布闭包及日志留存等机制已有实现和定向证据；下方“原生报告固定拒绝”“Main仍一万余行”“日志没有留存”只属于历史状态。当前源码仍在修改，完整内部回归、当前四种包型/22入口/无障碍/性能证据、最终冻结及独立审查尚未完成。达到“仅待真实环境验收”必须满足下方六项退出条件，不能从映射数或定向测试推断完成。

## 2026-10-16T13:17Z 开发收尾执行检查点

本节取代下方早期盘点的“当前”口径，保留历史原件。六项退出条件尚未满足。

- 实现/AC/具体案例映射已从39补到133/172；39项继续核对，所有MUST仍为UNVERIFIED。测试清单随职责拆分及新增案例更新，最终冻结时重新核对实际库存与反向关联。
- 已增加 `pnpm run check:module-boundaries:all`；13:17Z扫描1375个代码文件仍有62项超999行。Main入口、任务/执行仓储、分析服务/仓储、Package UI/inspector、App、建议页和Renderer领域桥已按职责拆分；后续拆分完成后重测，不能以局部成果宣布全仓库合规。
- Renderer与Main日志共用格式/脱敏，Renderer只报告固定日志事件。保留策略经启动配置快照发布：单文件5MB、总量100MB、64文件、14天，只操作本出口拥有的普通日志文件。对应58项轮转/配置/降级回归通过，其他生产日志/配置消费者仍须全量核对。
- 因果记忆生产导出读取同一只读事务内的事件及独立证据表；完整范围、历史日期、搜索词、修正链和proof refs经过安全投影，界面只下载当前Main响应，拒绝跨店、过期会话及A→B→A旧响应。50项回归与桌面类型检查通过。
- L4–L7固定原生适配及封套CLI已实现，73项针对性测试通过；只有真实原件通过专用重验才返回caseIds。V16发布闭包早期失败/中断失效处理已独立复核，私有README扩展后发布组合30项通过；Main交付页正在接包内V16只读worker与可信冻结库存，不能继续从legacy READY取得当前信用。
- 成功执行的真实READBACK证明进入可信分析记忆、原会话/业务日期贯通、幂等恢复的组合240项通过；App与建议页拆分组合110项、分析拆分/严格时间校验77项通过。以上为定向内部证据，不能替代全量与当前实包验证。
- 当前源码未冻结，也未重建匹配本批修改的四种包；完整L1–L5、性能/无障碍及最终独立审查仍待执行。真实账号、数据、费用批准、Ads写入和观察时间继续与软件机制验收区分。

本批原始记录位于 `output/development-completion-2026-10-16/`；失败原件保留，完整退出条件仍以下方“达到开发完成、仅待真实环境验收的工作”为准。

## 项目形态

这是面向 Windows 的本地优先 Electron 桌面应用。Renderer 使用 React、TypeScript 和 Vite；Main 负责浏览器控制、店铺上下文、审批与执行授权、调度、SQLite 生命周期及 IPC；持久化使用 `better-sqlite3`，源码迁移目标为 schema 20。仓库按 pnpm workspace 拆分为桌面端与领域、采集、AI、规则、数据库等包。

| 边界 | 主要职责 |
| --- | --- |
| `apps/desktop` | Electron Main/Preload/Renderer、IPC 及桌面交付 |
| `shared-types`、`page-models`、`business-presenters` | 跨层契约、页面模型和展示转换 |
| `local-db`、`audit-log` | SQLite 仓储、迁移、业务审计 |
| `browser-worker`、`lingxing-report-collector`、`report-parser` | 浏览器操作、报表采集、解析与导入前处理 |
| `rules-engine`、`keyword-opportunity`、`listing-analyzer` | 规则计算、关键词机会和 Listing 建议 |
| `ai-adapter`、`action-executor`、`scheduler` | AI 适配、受授权的动作执行和周期任务 |

主要业务链可概括为：报表采集/解析与导入 → 店铺隔离数据与分析 → AI/规则建议 → Decision/Grant 授权 → 浏览器执行和回读 → 实验、记忆与交付证据。Main 既是系统组合根，也长期承载了较多流程编排，是首要拆分对象。

2026-10-15 首次远端刷新因旧代理 `127.0.0.1:7897` 拒绝连接失败；按用户指令将 Git 全局 HTTP/HTTPS 代理统一切换至 `http://127.0.0.1:7689` 后，再次 fetch 成功。刷新后的 `origin/master` 与本地 HEAD 均为 `e0a00c4`，领先/落后 0/0，原网络阻断已解决。此前未找到 canonical userData，后续源码验收使用独立目录；当前候选包四种形态隔离运行验收已通过；正式库 schema、七日实验结论和策略自动执行仍未核实，详见 [PROGRESS.md](../PROGRESS.md) 和 [BLOCKED.md](../BLOCKED.md)。

## 可量化的维护风险

2026-10-16 开发收尾盘点覆盖 `apps/desktop/src`、`packages`、`scripts` 中已跟踪和未被忽略的未跟踪 JS/JSX/TS/TSX/MJS/CJS：960 个代码文件，91 个超过 999 行，其中 60 个实现/脚本、31 个测试。行数不计文件末尾换行形成的空段。启动阶段的 879 文件、81 个超长文件和 61 个非测试文件采用较窄扩展名及不同末尾计数，仅保留为历史口径，不能与本次全量口径混用。

存量最大的非测试文件如下；Main 行数已更新至 2026-10-16 本阶段：

| 文件 | 行数 | 主要职责/拆分建议 |
| --- | ---: | --- |
| `apps/desktop/src/main/index.ts` | 14,317 | 已抽离启动配置、启动编排、窗口与 IPC 包装；后续按领域 IPC 及运行时协调器继续拆分 |
| `scripts/package-ui-evidence.js` | 12,568 | UI 证据编排；拆分浏览器驱动、采集步骤、校验和报告 |
| `scripts/operate-s7-live-migration-launch.js` | 5,749 | S7 迁移启动编排；拆分预检、子进程、快照校验和恢复 |
| `packages/local-db/src/sqlite/repositories/mission-domain-repo.ts` | 4,631 | Mission 多聚合仓储；按聚合与事务边界拆分 |
| `packages/local-db/src/sqlite/repositories/lingxing-import-repo.ts` | 4,517 | 导入批次、行及恢复仓储；按批次、明细、恢复职责拆分 |
| `apps/desktop/src/main/store-collection-orchestrator.ts` | 4,158 | 采集编排；拆分状态机、恢复和外部适配器 |
| `apps/desktop/src/renderer/dev-preview-api.ts` | 3,857 | 开发预览接口集合；按页面/领域拆分 |
| `apps/desktop/src/renderer/pages/data-collection-page.tsx` | 3,703 | 页面、流程状态和展示耦合；抽离视图、状态及请求适配器 |
| `apps/desktop/src/main/s7-migration-startup-gate.ts` | 3,483 | 启动门、清单与验证职责；按纯校验、文件系统与流程拆分 |
| `packages/local-db/src/sqlite/repositories/execution-authority-repo.ts` | 3,064 | 执行授权事务；按 grant、dispatch、恢复职责拆分 |

启动阶段 Main 从 14,589 行减少至 14,551 行；本批设置/交付模块接线后为 14,317 行。窗口工厂 `desktop-window.ts` 负责窗口、导航安全及启动标记；`tracked-ipc-handler.ts` 负责 IPC 包装；配置持久化、规则订阅、日志出口、脱敏器和异常处理器分别位于独立模块。原有 IPC、调度器、采集运行时和执行授权四路关闭屏障仍留在 `index.ts`，存量大文件拆分尚未完成。

## 配置与日志现状

- Main 持久化设置统一经 `ConfigurationBus` 读写。事务提交后才发布不可变通知，嵌套回滚与提交失败不发布；重入写入保持所有订阅者收到的 revision 顺序一致，异步订阅失败也会记录。
- 通用批量保存和订阅通知均过滤全局登录字段、店铺登录命名空间及 AI 密钥字段。Main 专用凭据读写仍可通过 `get/set/delete` 完成，通知不携带任何配置值。
- `persistAiConfiguration` 在同一事务中保存加密 AI Key、普通 AI 设置和规则；`bindRuleConfiguration` 在提交后刷新 Main 规则消费者，删除配置后恢复默认规则。业务版本化的店铺配置仍由 `StoreRuntimeConfigService` 校验并通过总线持久化。
- 启动阶段由 `bootstrap-configuration.ts` 捕获冻结环境白名单：`APPDATA`、`NODE_ENV`、三个证据模式/目录/新凭据证明键、两个最终 readiness 路径键，以及 `S7_STARTUP_GATE_ENV` 的六个一次性绑定键，共 13 个。冻结配置统一派生模式、userData/storage 与最终 readiness 路径和 Main 相邻 Preload/Renderer 路径；打包应用不能通过 `NODE_ENV=development` 降级。
- `desktop-bootstrap.ts` 按隔离路径配置 → 实际 userData 日志目录 → S7 与单实例准入 → 清理旧 launch-ready 标记的顺序运行。持久配置总线在准入后的应用初始化中接管；启动配置端口不提前打开数据库。
- `desktop-startup.ts` 通过现有生命周期恢复器编排 ready → init → IPC → window → 日期监控，并处理 second-instance 与 activate。数据库、浏览器与调度资源的关闭顺序仍由 `index.ts` 的原屏障控制。
- 三个授权仓储直接读取 `store_session_generation`，用于同事务的店铺会话授权核验，后续应收敛存储端口，不能替换成可能过期的异步配置缓存。最终 readiness 路径已通过启动配置端口读取，保留主键优先、空白主键抑制回退及相对仓库根解析的既有语义；其他迁移输入仍待按实际调用点收拢。
- 证据路径的纯校验已收拢至 `main/evidence-path-policy.cjs`，由 Main 与脚本共用。由于本机没有 D 盘，允许现有本地盘符的 `Temp\amazon-ai-ops*` 子树；预先存在、非链接、实际路径一致与 S7 正式目录隔离门保持生效。源码 runner 与包/ZIP 默认路径使用仓库所在盘；后者通过 `scripts/package-evidence-paths.js` 统一派生，ZIP 递归删除前重新核对准确路径和 realpath。
- Main 源目录已无直接 `console.log/info/warn/error` 调用。原消息经 `runtime-log-adapter.ts` 保留在结构化字段中，新增边界使用明确事件名；独立脚本的旧输出协议仍待按需迁移，不能宣称整个仓库的日志治理完成。

## 日志与配置调用约定

运行日志写入 Electron 实际 userData 下的 `logs/runtime-YYYY-MM-DD.jsonl`，日期使用 UTC；开发者可按 `event`、`level` 和 `context` 过滤。格式为 `{ timestamp, level, event, context? }`。日志会遮蔽敏感键、带标签的凭据文本、错误堆栈与 cause 中的敏感值，并限制递归深度、集合条目和文本长度。IPC 异常只记录 channel 与异常，不记录调用输入。

文件出口失败仍向流输出原始业务错误，并附加 `runtime.logger_write_failed`；流出口失败则保留文件记录并尝试标准错误输出。日志失败不覆盖业务异常或改变退出码。未处理 Promise 拒绝请求安全退出，未捕获异常监视器只负责记录，保留 Node 默认致命退出行为。

证据隔离身份改为结构化事件 `app.evidence_user_data`，载荷在 `context.identity`。`scripts/evidence-user-data.js` 同时识别该事件和历史 `[App] evidence-user-data ...` 行；包启动流程使用的 `[App] window-created` 文字仍保留，匹配方式不变。

启动准入结果使用 `desktop.startup_admitted`，只记录模式、准入和单实例锁结果。路径、准入或标记清理失败记录 `desktop.startup_blocked`，调用 `exit(78)` 后重新抛出原异常，阻止继续初始化数据库；退出调用自身失败另记 `desktop.startup_exit_failed`。`[App] ready`、`[App] ipc-ready`、`[App] window-created` 仍经 `main.message` 的 `context.message` 输出，未更换证据 runner 依赖的文字协议。

路径配置、canonical 目录判定与 S7 必须复用同一冻结快照。S7 会删除一次性绑定，调用方只从快照复制可变 `gateEnvironment`，并在 `finally` 中仅把门已删除的六个绑定键同步从原环境删除，避免子进程继承；快照不变，绑定值不进入日志。不要直接把冻结快照传给会消费环境的 S7 门，也不要在这些消费者内再次读取 `process.env`。

新增持久化配置消费者应订阅总线并在提交后读取当前值；需要多个设置一致提交时使用 `transaction`。日志禁止直接传入密码、Key 或完整 IPC 输入，即使脱敏器能够处理常见标签。日志文件尚未增加自动清理策略，不能把日志目录当作业务验收证据。

## 增量模块尺寸检查

运行 `pnpm run check:module-boundaries` 检查 `apps/desktop/src`、`packages`、`scripts` 下相对 HEAD 的已修改及未跟踪代码，覆盖 JS/TS 与 CJS/MJS。新增模块最多 999 行；已有超限模块允许持平或缩小，禁止净增长。检查包含测试文件，排除 Git 忽略的构建及依赖产物；行数不计文件末尾换行产生的空段。

10 月 16 日本轮工程检查覆盖 65 个变更代码文件，无违规。此门阻止新增和扩张的超长模块，但允许存量超限模块持平或缩小；开发完成还须增加全量尺寸核验，消除当前 60 个超长实现/脚本和 31 个超长测试，不能以增量门通过替代全量合规。

## 执行顺序

每一步均同步 README、PROGRESS、BLOCKED 与可核验的证据；缺少本机运行数据时明确记录 `UNKNOWN`。

本轮五项计划的第1–4项已经完成，证据绑定最终新包。2026-10-16 用户最新要求直接使用真实应用，原模拟先行方案已被取代；当前入口为 `apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe`，已按正常模式使用默认 userData 启动，并建立新机数据库、`Local State` 与初始化备份。第5项从当前登录与数据基线继续，不把新机初始化视为旧数据恢复。每批继续同步原始失败记录、当前事实和未满足条件。

1. **已完成：配置与路径。** 最终 readiness 路径纳入13键冻结快照，保留优先级/空白/相对路径语义；包/ZIP默认目录适配仓库所在盘，共用严格隔离与清理保护。
2. **已完成：本轮四种包型隔离验收。** 目录、NSIS安装、便携、ZIP分别两次实际启动，保存重启、交付/路径IPC、当前包hash、原生加载、日志和进程清理通过。安装版实际安装/卸载并等待全部注册及快捷方式撤销；便携退出清理重试已进入新包，两次解压目录由NSIS自行删除；ZIP临时目录已清理。早先失败现场保留，不能用它们替代最终报告。
3. **已完成：设置IPC接线。** 九个设置通道共用tracked registrar和Main持久化端口；保持密钥保护、配置原子事务、动态规则订阅、明确StoreContext及关闭屏障。AI测试正常返回失败也会刷新已持久化状态，拒绝或抛错由统一异常边界处理。
4. **已完成：交付编排接线。** delivery-runtime和delivery-bundle-export使用启动路径总线及逐调用的DB/范围/店铺access/authority，保留currentPackage、本店缺失候选显式路径及READY导出门；对账SQL与真实授权验证保留Main端口。组合回归、类型检查及匹配新包已通过。
5. **真实应用与单店主流程。** 后续直接使用真实桌面应用，原模拟入口仅保留历史用途。新机无原数据不阻塞正常启动；真实店铺重新登录并建立当前数据基线后，再推进人工/策略双模式、真实AI、独立回读和七日实验。若取得旧库，则先核验身份及WAL安全备份，不伪造数据、授权或历史实验，不从历史文档推断当前授权。

当前汇总：`output/goal-delivery-2026-10-16/engineering-acceptance-summary.json`；源码回归39文件511用例，包脚本回归8文件353用例，零失败零跳过；模块门65个变更代码文件，无违规。工程验收不等于完整V1.6或APP_READY，全量盘点的91个超长代码文件及其他配置/脚本治理仍待完成。

## 达到开发完成、仅待真实环境验收的工作

本节定义接下来的开发收尾目标，不改变既有 L1–L8 发布合同，也不增加可以绕过 `APP_READY` 的状态。当前尚未达到本节退出条件。机械盘点结果保存在 `output/goal-delivery-2026-10-16/development-completion-inventory.json`；本次只核对代码、清单和文档，未运行测试、构建或真实业务。

### 2026-10-16首次确认的开发缺口（历史）

本小节保留首次盘点，当前数量与实现状态已由本文顶部及PROGRESS/BLOCKED最新检查点取代；下面六项退出条件继续有效。日志留存、全量尺寸门、原生适配等已在后续实现，当前仍须冻结后完整验收。

- 172 项 MUST 均为 `UNVERIFIED`，133 项同时缺少实现路径、testIds 和具体 acceptanceCases。先定位代码并补充映射，再确定需要补实现的需求；不能将这133项直接称为未实现功能。
- 实际测试库存400个文件，必需L1清单仅列379个，遗漏21个。本轮配置、日志、启动、设置/交付及包型验证的新增测试必须纳入完整清单。
- `scripts/verify-v16-required-test-manifest.js` 对 L4–L7 的原生报告仍固定产生 `NATIVE_ARTIFACT_VERIFICATION_REQUIRED`，并未提取这些报告的caseIds。需要接入各schema专用的原生校验和案例映射；不能删除拒绝条件或直接相信报告的 `passed` 字段。
- 全量尺寸、统一配置、全局异常及日志覆盖尚未完成。`AGENTS.md` 和 `CLAUDE.md` 为独立文件，前者约69KB且包含较多历史状态；现行规则与历史记录还需收敛，保留用户指令和证据，不自动合并、改链接或删除历史。

### 执行顺序与交付物

| 顺序 | 工作 | 必须得到的结果 |
| --- | --- | --- |
| 1 | 补全需求与测试追踪 | 172项逐条定位生产实现、AC和具体可执行案例；补齐21个遗漏测试，并对缺实现、缺内部验证、只缺真实证据分别给出定位 |
| 2 | 补齐功能与验收工具 | 修复逐项核对发现的生产功能缺口；实现L4–L7原生报告验证和caseId映射，验证有效证据可接收、伪造/过期/跨店证据被拒绝 |
| 3 | 完成架构硬约束 | 按职责拆分全部超长代码；Main收为组合根；配置经启动快照/持久总线/显式端口管理；异常进入统一日志并保留原失败语义；新增注释为简洁中文；补日志轮转/保留和全量尺寸门 |
| 4 | 完整内部回归与故障恢复 | 当前全量L1–L3及隔离旧库迁移/备份/恢复通过；覆盖双店切换、过期版本/会话、重复提交、取消、UNKNOWN、AI超时/费用未知、预算耗尽和进程中断恢复 |
| 5 | 当前实包界面、性能与交付 | 使用真实Windows EXE和隔离测试数据完成L4–L5：22入口、100%/125%/wide/minimum、弹窗/键盘/失败恢复/无障碍、四种包型；测量典型/最大样本性能并形成明确预算；继续保留失败原件 |
| 6 | 冻结开发候选并独立复核 | 源码、依赖、包体和证据身份一致；文档与实际行为一致；无已知软件缺陷或硬约束欠项；剩余项逐条证明仅依赖真实账号、正式数据、具体授权、真实调用或观察时间 |

拆分以低耦合的证据脚本、纯投影和展示层开始，再拆Main领域运行时，最后处理授权/导入等聚合仓储。不得用part1/part2、源码拼接或压行规避尺寸限制。领域运行时逐调用获取DB、StoreContext及authority；同一事务中的批次、revision、session与Grant核验不能因拆文件被拆成独立事务。授权账本中的会话读取不得替换成可能过期的异步配置缓存。

内部验证使用生产服务、真实桌面包和隔离测试库；外部适配器替身须明确标注。后续用户操作继续使用真实应用，不恢复浏览器模拟工作台，也不将隔离数据写入正常userData。

### 最终只允许保留的真实验收依赖

- ERP/Ads真实登录、店铺身份和独立profile/session；当前真实八类报表及指标核对。
- 真实AI连接、用量/费用及批准预算；独立人工候选的具体批准、策略自动候选与当前授权。
- 实际一次写入及before/after/reload回读、真实断线对账；正式库迁移前后与WAL安全备份的实际核验。
- 完整发布要求的两家US店铺、各七个已完成美国业务日，以及系统实验结论和经营记忆。

迁移、回读、费用、实验和证据工具的软件机制必须先在隔离环境验证完成，不能整体以“需要真实环境”为由延后开发。剩余L6/L7真实证据未完成时，L8与正式READY bundle继续保持未就绪。

## 本轮核验边界

本轮最终证据以上述工程汇总为准；以下启动阶段与源码GUI记录为前序历史诊断，不替代最终四种包型报告。

本阶段最终单次受影响回归为 28 文件、356 用例通过，零失败、零跳过，记录为 `output/bootstrap-2026-10-16/current-final.json`。Main 构建与 S7 一次性环境消费修复后的桌面类型检查通过，对应 `build-main-final.log`、`desktop-typecheck-final.log`；工作区类型检查已通过 `typecheck-final.log`，最终桌面检查补验了随后修改。S7 消费清理经过独立复核，未发现新增明确缺陷。

本阶段首次单测及桌面类型检查曾因测试 mock 参数签名和 Vitest 2 不支持的断言失败，原件保留在同目录 `bootstrap-tests.json`、`desktop-typecheck.log`；修正夹具后再执行了上述完整受影响集。

上一阶段在 10 月 16 日完成 Main/Preload/Renderer 构建及单次 21 文件、263 用例回归，记录为 `output/maintenance-2026-10-16/current-final.json`；10 月 15 日的 248 用例记录也保留为历史。依赖按锁文件安装，未修改版本；此前单独补装 DuckDB Node 绑定及锁定版本 Electron 文件。

首次检查的原生绑定缺失、Windows CRLF 源码合同断言和两处测试夹具类型错误保留在 10 月 15 日原始失败记录中；后续分别修复了读取规范化、XLSX 表头可变副本与 StoreId 构造。

本阶段 `pnpm run verify:desktop-isolated` 报告为 `output/playwright/isolated-desktop-runtime/2026-10-16T04-17-11-116Z/report.json`，`passed=true`，10 项检查全部通过。源码窗口连续启动、关闭和重启，界面保存人设与规则、IPC 组合保存及规则投影即时刷新、重启回显通过。41 条结构化日志包含 1 条主动触发的无效规则 IPC 错误及 2 次关闭记录，Renderer/控制台错误为 0。隔离 SQLite 完整性为 ok，连接、Grant、执行及 AI 费用记录为 0；SQLite/DuckDB 探针均为 1，原生绑定未改写，canonical 目录前后均不存在。报告中的本地测试店铺明确没有真实授权，此结果不代表全页面视觉或真实业务验收。

上一阶段 GUI 历史证据 `output/playwright/isolated-desktop-runtime/2026-10-16T01-02-11-991Z/` 保留，不作为本阶段启动拆分后的当前证据。

早期运行脚本错误地等待仅已配置状态才出现的按钮，并在组合请求中混用新旧字段别名，失败记录保留在各次报告中；后续按实际界面状态和页面字段格式修正脚本，再次完整执行通过。Vite 仍有 CJS API 弃用及构建 chunk 大小提示，未在本轮扩展为打包优化。完整 L1–L8、安装包及真实 Ads 流程未执行，不提升产品交付状态。正式库、仓库 `storage/` 及用户 UI 设计文件未改动。

文档审计纠正了 `CLAUDE.md` 中 v1.5.1 和旧验证禁令，现行权限以用户最新指令及 `AGENTS.md` 为准。`AGENTS.md` 仍为独立的 68,230 字节历史规则文件，超过技能建议的 15KB 软上限，并未与 `CLAUDE.md` 合并或改成链接；后续规则精简需保留用户明确给出的现行约束。
