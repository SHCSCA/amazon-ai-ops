import { useMemo, useState } from "react";
import {
  ArrowClockwise,
  ArrowRight,
  ArrowSquareOut,
  Brain,
  Check,
  CloudArrowDown,
  DownloadSimple,
  FileArrowUp,
  FileText,
  ListChecks,
  LockKey,
  MagnifyingGlass,
  Package,
  Pause,
  Play,
  Plus,
  Robot,
  ShieldCheck,
  Sparkle,
  Storefront,
  Target,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  DataTable,
  EmptyState,
  FieldRow,
  PageFrame,
  StatusPill,
  SummaryStrip,
  TaskBanner,
  WorkbenchPanel,
} from "./ui.jsx";

const REPORT_TYPES = [
  "广告活动",
  "广告组",
  "关键词",
  "搜索词",
  "商品投放",
  "广告位",
  "推广商品",
  "业务报告",
];

const PRODUCT_FALLBACK = [
  { id: "B0GTTJFQTM", sku: "FT-US-US", name: "Keypad Door Lock with Handle", status: "在售", price: "$79.99", targetAcos: "28%", targetTacos: "12%", margin: "31.4%" },
  { id: "B0F9W8P2KM", sku: "FT-US-BK", name: "Fingerprint Smart Lock", status: "在售", price: "$92.00", targetAcos: "25%", targetTacos: "10%", margin: "34.8%" },
  { id: "B0D7HC2Q9V", sku: "FT-US-RF", name: "Retrofit Keyless Deadbolt", status: "观察", price: "$69.50", targetAcos: "32%", targetTacos: "15%", margin: "24.1%" },
];

const EVENTS_FALLBACK = [
  { id: "EVT-0720-03", at: "2026-07-20 08:15", type: "促销", title: "Prime Deal 结束", scope: "B0GTTJFQTM", impact: "转化基线可能回落", context: "已进入诊断" },
  { id: "EVT-0719-08", at: "2026-07-19 16:40", type: "Listing", title: "主图版本 v14 上线", scope: "FT-US-US", impact: "CTR 需观察 72h", context: "已进入诊断" },
  { id: "EVT-0718-02", at: "2026-07-18 10:05", type: "库存", title: "FBA 可售恢复至 28 天", scope: "全店", impact: "解除预算保护", context: "已应用" },
];

const REPORT_FALLBACK = REPORT_TYPES.map((name, index) => ({
  id: `RPT-${String(index + 1).padStart(2, "0")}`,
  name,
  window: "2026-07-06 → 2026-07-19",
  status: index === 6 ? "待下载" : "已校验",
  rows: index === 6 ? "—" : [421, 1187, 6827, 9314, 762, 216, 389, 1462][index].toLocaleString(),
  updated: index === 6 ? "等待领星会话" : `08:${String(32 + index * 2).padStart(2, "0")}`,
}));

const DIAGNOSIS_FALLBACK = [
  { id: "DIA-101", severity: "高", object: "keypad door lock · exact", signal: "花费上升但转化下降", spend: "$184.20", acos: "47.8%", target: "28%", delta: "+19.8pct", confidence: "94%" },
  { id: "DIA-102", severity: "高", object: "Exact-Core · 广告组", signal: "高转化时段预算耗尽", spend: "$611.08", acos: "24.6%", target: "28%", delta: "-3.4pct", confidence: "91%" },
  { id: "DIA-103", severity: "中", object: "smart door handle · phrase", signal: "搜索词意图分散", spend: "$96.74", acos: "36.1%", target: "28%", delta: "+8.1pct", confidence: "86%" },
  { id: "DIA-104", severity: "低", object: "B0C8V4M1RX · 商品投放", signal: "CPC 高于建议区间", spend: "$41.70", acos: "31.2%", target: "28%", delta: "+3.2pct", confidence: "79%" },
];

const RECOMMENDATION_FALLBACK = [
  { id: "REC-20260720-004", risk: "高影响", action: "日预算上调", object: "Exact-Core", before: "$120", after: "$168", delta: "+40%", reason: "高转化时段预算提前耗尽", state: "待审批", owner: "运营负责人" },
  { id: "REC-20260720-003", risk: "低风险", action: "关键词竞价下调", object: "keypad door lock · exact", before: "$1.30", after: "$1.17", delta: "-10%", reason: "花费上升 21%，CVR 下降 8%", state: "可自动", owner: "AI 策略" },
  { id: "REC-20260720-002", risk: "低风险", action: "否定搜索词", object: "door latch cheap · phrase", before: "投放中", after: "否定", delta: "18 点击", reason: "连续点击无订单", state: "已决定", owner: "AI 策略" },
  { id: "REC-20260720-001", risk: "中风险", action: "广告位系数下调", object: "商品页面", before: "+32%", after: "+20%", delta: "-12pct", reason: "商品页 ROAS 低于基线", state: "待确认", owner: "运营负责人" },
];

const DECIDED_FALLBACK = [
  { id: "DEC-20260720-011", at: "08:58", decision: "批准", action: "关键词竞价 $1.30 → $1.17", actor: "AI 自动边界", license: "LIC-0341", execution: "排队中" },
  { id: "DEC-20260720-010", at: "08:54", decision: "驳回", action: "Exact-Core 日预算 $120 → $180", actor: "WZ · 人工", license: "—", execution: "已终止" },
  { id: "DEC-20260719-036", at: "17:42", decision: "批准", action: "搜索词 door latch cheap 否定", actor: "WZ · 人工", license: "LIC-0338", execution: "已回读" },
];

const EXECUTION_FALLBACK = [
  { id: "ACT-20260720-003", position: 1, object: "keypad door lock · exact", action: "竞价 $1.30 → $1.17", source: "REC-20260720-003", state: "等待可见浏览器", gate: "许可已签发" },
  { id: "ACT-20260720-004", position: 2, object: "Exact-Core", action: "预算 $120 → $168", source: "REC-20260720-004", state: "等待审批", gate: "缺少人工许可" },
  { id: "ACT-20260720-005", position: 3, object: "商品页面广告位", action: "系数 +32% → +20%", source: "REC-20260720-001", state: "已暂停", gate: "策略复核" },
];

const KEYWORDS_FALLBACK = [
  { id: "KW-01", keyword: "keypad door lock with handle", source: "搜索词", intent: "强购买", volume: "8,100", rank: "19", orders: 24, acos: "23.8%", state: "已投放" },
  { id: "KW-02", keyword: "fingerprint door handle lock", source: "竞品反查", intent: "品类", volume: "5,400", rank: "—", orders: 0, acos: "—", state: "待纳入" },
  { id: "KW-03", keyword: "smart lock for bedroom door", source: "搜索词", intent: "场景", volume: "3,600", rank: "42", orders: 7, acos: "31.2%", state: "待纳入" },
  { id: "KW-04", keyword: "keyless entry door knob", source: "自然词", intent: "功能", volume: "2,900", rank: "27", orders: 11, acos: "26.4%", state: "已覆盖" },
  { id: "KW-05", keyword: "door latch cheap", source: "搜索词", intent: "低意向", volume: "1,300", rank: "—", orders: 0, acos: "—", state: "排除" },
];

const SCHEDULE_FALLBACK = [
  { id: "SCH-01", task: "广告报表日采集", cadence: "每日 08:30", next: "明日 08:30", last: "今日 08:42 · 成功", enabled: true },
  { id: "SCH-02", task: "量化诊断", cadence: "报表导入后", next: "等待 8/8", last: "今日 08:49 · 成功", enabled: true },
  { id: "SCH-03", task: "24h 执行回读", cadence: "每小时", next: "10:00", last: "09:00 · 2/2 通过", enabled: true },
  { id: "SCH-04", task: "周交付包", cadence: "周一 09:30", next: "07-27 09:30", last: "07-20 · NON_READY", enabled: false },
];

const ACTION_ALIASES = {
  navigate: ["navigate", "onNavigate"],
  selectProduct: ["selectProduct", "lockProduct"],
  saveTargets: ["saveTargets", "saveProductTargets", "updateTargets"],
  addEvent: ["addEvent", "createEvent"],
  saveScope: ["saveScope", "updateScope"],
  collectReports: ["collectReports", "collectAllReports", "startCollection"],
  importReports: ["importReports", "startImport", "validateImport"],
  runDiagnosis: ["runDiagnosis", "runAiDiagnosis", "generateDiagnosis"],
  generateRecommendations: ["generateRecommendations", "refreshRecommendations"],
  submitForApproval: ["submitForApproval", "requestApproval"],
  approveRecommendation: ["approveRecommendation", "approve"],
  rejectRecommendation: ["rejectRecommendation", "reject"],
  recalculateRecommendation: ["recalculateRecommendation", "recalculate"],
  queueExecution: ["queueExecution", "startExecution"],
  pauseExecution: ["pauseExecution", "pause"],
  openVisibleBrowser: ["openVisibleBrowser", "openBrowser"],
  selectReadbackStep: ["selectReadbackStep", "setReadbackStep"],
  captureEvidence: ["captureEvidence", "attachEvidence"],
  verifyReadback: ["verifyReadback", "checkReadback"],
  exportReadback: ["exportReadback", "exportReadbackEvidence"],
  sendToListing: ["sendToListing", "addKeywordToListing"],
  generateListingDraft: ["generateListingDraft", "generateDraft"],
  saveListingDraft: ["saveListingDraft", "saveDraft"],
  exportListingDraft: ["exportListingDraft", "exportDraft"],
  saveAiSettings: ["saveAiSettings", "saveRules"],
  saveStoreConfig: ["saveStoreConfig", "updateStoreConfig"],
  verifyStoreSession: ["verifyStoreSession", "checkStoreSession"],
  toggleSchedule: ["toggleSchedule", "updateSchedule"],
  runScheduleNow: ["runScheduleNow", "runSchedule"],
  runDeliveryCheck: ["runDeliveryCheck", "checkDelivery"],
  exportDeliveryBundle: ["exportDeliveryBundle", "exportBundle"],
  openDeliveryPath: ["openDeliveryPath", "openPath"],
};

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) || [];
}

function storeIdOf(store) {
  return store?.id || store?.storeId || store?.code || "SHC001";
}

function selectedIdOf(selected) {
  if (typeof selected === "string") return selected;
  return selected?.id || selected?.asin || selected?.keyword || null;
}

function runAction(actions, type, payload = {}) {
  const names = ACTION_ALIASES[type] || [type];
  for (const name of names) {
    if (typeof actions?.[name] === "function") return actions[name](payload);
  }
  if (typeof actions?.dispatch === "function") return actions.dispatch(type, payload);
  if (typeof actions?.onAction === "function") return actions.onAction(type, payload);
  return undefined;
}

function storePayload(store, payload = {}) {
  return { storeId: storeIdOf(store), ...payload };
}

function statusTone(value) {
  const text = String(value || "");
  if (/失败|阻断|异常|高影响|高风险|缺少|待续期|NON_READY|驳回/.test(text)) return "danger";
  if (/等待|待下载|待确认|待审批|观察|中风险|已暂停|部分/.test(text)) return "warning";
  if (/成功|正常|已校验|已完成|已决定|已回读|可自动|在售|通过|READY|批准/.test(text)) return "success";
  if (/运行|排队|执行|AI|自动/.test(text)) return "info";
  return "neutral";
}

function Status({ children, tone }) {
  return <StatusPill tone={tone || statusTone(children)}>{children}</StatusPill>;
}

function ActionButton({ children, icon: Icon, kind = "secondary", disabled = false, onClick, title }) {
  return (
    <button type="button" className={kind === "primary" ? "primary-button" : kind === "danger" ? "danger-button" : "secondary-button"} disabled={disabled} onClick={onClick} title={title}>
      {Icon ? <Icon size={16} weight="bold" /> : null}
      <span>{children}</span>
    </button>
  );
}

function InlineActions({ children }) {
  return <div className="workspace-actions">{children}</div>;
}

function StoreScope({ store }) {
  const label = store?.product || store?.asin || "当前锁定产品";
  return <span className="workspace-scope"><LockKey size={14} weight="fill" />{storeIdOf(store)} · {label}</span>;
}

function selectRecord(record, type, store, actions, onSelect) {
  onSelect?.(record);
  if (type) runAction(actions, type, storePayload(store, { record, id: record?.id }));
}

function TodayOverview({ store, state, actions }) {
  const summary = store?.actionSummary || { total: 4, automatic: 3, approval: 1 };
  const reports = store?.reports || "7/8";
  const anomalies = store?.anomalies ?? 2;
  const steps = [
    { id: "scope", title: "确认店铺与产品范围", detail: `${storeIdOf(store)} · ${store?.asin || "B0GTTJFQTM"}`, state: "已完成", target: ["data-preparation", "scope"] },
    { id: "reports", title: "补齐 8 类广告事实", detail: `${reports} 报表 · ${store?.rows || "6,827"} 行`, state: reports === "8/8" ? "已完成" : "待处理", target: ["data-preparation", "reports"] },
    { id: "diagnosis", title: "运行量化诊断", detail: `${store?.diagnosedKeywords || 23} 个对象已进入分析`, state: state?.diagnosisRunning ? "AI 运行中" : "已完成", target: ["diagnosis", "analysis"] },
    { id: "decision", title: "处理高影响建议", detail: `${summary.approval} 个需要人工签发许可`, state: summary.approval ? "待审批" : "已完成", target: ["decisions", "approval"] },
    { id: "readback", title: "核对执行结果", detail: "页面值、店铺身份、动作版本", state: state?.readbackVerified ? "已回读" : "等待执行", target: ["readback", "evidence"] },
  ];

  const navigate = (workspace, subview) => runAction(actions, "navigate", { workspace, subview });
  return (
    <PageFrame
      eyebrow={`DAILY CONTROL · ${storeIdOf(store)}`}
      title="今日任务"
      description="从事实准备到结果回读，只处理今天会影响运营结果的下一步。"
      task={<TaskBanner tone={anomalies ? "warning" : "success"} title={anomalies ? `先补齐 ${8 - Number(String(reports).split("/")[0] || 0)} 份报表，再处理 ${summary.approval} 个审批` : "今日主链路已完成"} detail="自动动作仍受店铺策略边界、可见浏览器身份和回读门槛约束。" />}
      actions={<ActionButton kind="primary" icon={ArrowRight} onClick={() => navigate(reports === "8/8" ? "decisions" : "data-preparation", reports === "8/8" ? "approval" : "reports")}>继续主任务</ActionButton>}
    >
      <SummaryStrip items={[
        { label: "昨日广告销售额", value: store?.sales || "$4,862", detail: store?.salesDelta || "+8.6%", tone: "success" },
        { label: "ACOS / 目标", value: `${store?.acos || "38.4%"} / ${store?.target || "28%"}`, detail: "超目标 10.4pct", tone: "danger" },
        { label: "事实就绪", value: reports, detail: store?.rows ? `${store.rows} 行` : "等待 1 类报表", tone: reports === "8/8" ? "success" : "warning" },
        { label: "建议队列", value: `${summary.total} 个`, detail: `${summary.automatic} 自动 · ${summary.approval} 审批`, tone: "info" },
      ]} />

      <WorkbenchPanel title="今日主链路" meta={<StoreScope store={store} />} tone="primary">
        <ol className="workspace-stepper" aria-label="今日运营步骤">
          {steps.map((step, index) => (
            <li key={step.id} className="workspace-step">
              <span className="workspace-step-index">{index + 1}</span>
              <button type="button" className="workspace-step-body" onClick={() => navigate(...step.target)}>
                <span><b>{step.title}</b><small>{step.detail}</small></span>
                <Status>{step.state}</Status>
                <ArrowRight size={17} />
              </button>
            </li>
          ))}
        </ol>
      </WorkbenchPanel>

      <WorkbenchPanel title="需要你介入" meta="按业务影响排序" actions={<ActionButton icon={ListChecks} onClick={() => navigate("decisions", "approval")}>打开审批台</ActionButton>}>
        <div className="workspace-list">
          <button type="button" className="workspace-list-row" onClick={() => navigate("data-preparation", "reports")}>
            <WarningCircle size={19} weight="fill" />
            <span><b>推广商品报表仍未下载</b><small>领星下载中心 · 目标日期 2026-07-06 至 2026-07-19</small></span>
            <Status>待处理</Status>
          </button>
          <button type="button" className="workspace-list-row" onClick={() => navigate("decisions", "approval")}>
            <ShieldCheck size={19} weight="fill" />
            <span><b>Exact-Core 日预算调整超过自动边界</b><small>$120 → $168 · 需要人工签发执行许可</small></span>
            <Status>高影响</Status>
          </button>
        </div>
      </WorkbenchPanel>
    </PageFrame>
  );
}

function ProductList({ store, state, actions, selected, onSelect }) {
  const products = firstArray(state?.products, store?.products, PRODUCT_FALLBACK);
  const selectedId = selectedIdOf(selected) || state?.selectedProductId || store?.asin || products[0]?.id;
  const selectedProduct = products.find((item) => item.id === selectedId) || products[0];
  const columns = [
    { key: "sku", label: "SKU" },
    { key: "asin", label: "ASIN" },
    { key: "name", label: "产品" },
    { key: "status", label: "状态", render: (value) => <Status>{value}</Status> },
    { key: "price", label: "当前售价" },
    { key: "targetAcos", label: "目标 ACOS" },
    { key: "margin", label: "目标净利率" },
  ];
  const handleSelect = (product) => selectRecord(product, "selectProduct", store, actions, onSelect);

  return (
    <PageFrame
      eyebrow={`PRODUCT SCOPE · ${storeIdOf(store)}`}
      title="产品工作台"
      description="先锁定一个产品，再让数据、诊断、建议和执行共享同一作用域。"
      task={<TaskBanner tone="info" title="锁定今天要运营的产品" detail="切换产品会刷新后续工作区，但不会丢失各产品已保存的目标。" />}
      actions={<ActionButton kind="primary" icon={Target} disabled={!selectedId} onClick={() => runAction(actions, "navigate", { workspace: "product", subview: "targets" })}>维护目标</ActionButton>}
    >
      <SummaryStrip items={[
        { label: "当前产品", value: selectedProduct?.asin || "待锁定", detail: selectedProduct?.sku || "待锁定", tone: "info" },
        { label: "在售", value: `${products.filter((item) => item.status === "在售").length} 个`, detail: `共 ${products.length} 个产品` },
        { label: "目标已配置", value: `${products.filter((item) => item.targetAcos).length}/${products.length}`, detail: "ACOS · TACOS · 净利率", tone: "success" },
        { label: "范围隔离", value: storeIdOf(store), detail: "店铺级 authority", tone: "success" },
      ]} />
      <WorkbenchPanel title="当前店铺产品" meta="点击行即锁定产品" tone="primary">
        <DataTable columns={columns} rows={products} rowKey="id" selectedId={selectedId} onRowClick={handleSelect} empty="当前店铺没有可维护产品" />
      </WorkbenchPanel>
      <TaskBanner tone="neutral" title="作用域约束" detail="任何采集、诊断、建议与执行动作都必须同时绑定店铺 ID 和当前 ASIN；原型不会用默认产品替代未选择范围。" />
    </PageFrame>
  );
}

function ProductTargets({ store, state, actions, selected }) {
  const products = firstArray(state?.products, store?.products, PRODUCT_FALLBACK);
  const activeId = selectedIdOf(selected) || state?.selectedProductId || store?.asin || products[0]?.id;
  const product = products.find((item) => item.id === activeId) || products[0];
  const [form, setForm] = useState(() => ({
    price: product?.price?.replace(/[^0-9.]/g, "") || "79.99",
    minPrice: "64.00",
    targetAcos: product?.targetAcos?.replace("%", "") || "28",
    targetTacos: product?.targetTacos?.replace("%", "") || "12",
    margin: product?.margin?.replace("%", "") || "31.4",
  }));
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const save = () => runAction(actions, "saveTargets", storePayload(store, { productId: product?.id, targets: form }));
  const rows = products.map((item) => ({ ...item, health: Number(item.targetAcos?.replace("%", "")) <= 30 ? "目标正常" : "需复核" }));

  return (
    <PageFrame
      eyebrow={`TARGET CONTRACT · ${product?.id || "未选择"}`}
      title="产品目标"
      description="目标值是诊断、建议和自动边界的共同计算基准。"
      task={<TaskBanner tone="warning" title={`复核 ${product?.sku || "当前产品"} 的广告目标`} detail="保存只更新本地产品配置，不会直接修改 Amazon Ads。" />}
      actions={<ActionButton kind="primary" icon={Check} onClick={save}>保存产品目标</ActionButton>}
    >
      <WorkbenchPanel title="目标维护" meta={<StoreScope store={store} />} tone="primary" actions={<Status>仅本地配置</Status>}>
        <div className="workspace-field-grid">
          <FieldRow label="当前售价" hint="用于利润与调价保护"><input value={form.price} onChange={update("price")} inputMode="decimal" /><span className="field-suffix">USD</span></FieldRow>
          <FieldRow label="最低可接受价" hint="调价建议不得低于此值"><input value={form.minPrice} onChange={update("minPrice")} inputMode="decimal" /><span className="field-suffix">USD</span></FieldRow>
          <FieldRow label="目标 ACOS" hint="广告效率主目标"><input value={form.targetAcos} onChange={update("targetAcos")} inputMode="decimal" /><span className="field-suffix">%</span></FieldRow>
          <FieldRow label="目标 TACOS" hint="全店广告依赖度"><input value={form.targetTacos} onChange={update("targetTacos")} inputMode="decimal" /><span className="field-suffix">%</span></FieldRow>
          <FieldRow label="目标净利率" hint="利润安全底线"><input value={form.margin} onChange={update("margin")} inputMode="decimal" /><span className="field-suffix">%</span></FieldRow>
        </div>
      </WorkbenchPanel>
      <WorkbenchPanel title="店铺产品目标一览" meta={`${rows.length} 个产品`}>
        <DataTable columns={[
          { key: "sku", label: "SKU" },
          { key: "asin", label: "ASIN" },
          { key: "price", label: "售价" },
          { key: "targetAcos", label: "目标 ACOS" },
          { key: "targetTacos", label: "目标 TACOS" },
          { key: "margin", label: "目标净利率" },
          { key: "health", label: "健康度", render: (value) => <Status>{value}</Status> },
        ]} rows={rows} rowKey="id" selectedId={product?.id} empty="还没有产品目标" />
      </WorkbenchPanel>
    </PageFrame>
  );
}

function ProductEvents({ store, state, actions }) {
  const events = firstArray(state?.events, store?.events, EVENTS_FALLBACK);
  const [draft, setDraft] = useState({ type: "促销", title: "", at: "2026-07-20T09:30", impact: "", scope: store?.asin || "全店" });
  const update = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  const add = () => {
    if (!draft.title.trim()) return;
    runAction(actions, "addEvent", storePayload(store, { event: { ...draft, title: draft.title.trim() } }));
    setDraft((current) => ({ ...current, title: "", impact: "" }));
  };
  return (
    <PageFrame
      eyebrow={`OPERATION CONTEXT · ${storeIdOf(store)}`}
      title="运营事件标记"
      description="把促销、库存、Listing 与人工动作写入 LLM 上下文，避免把业务变化误判成广告异常。"
      task={<TaskBanner tone="info" title="记录今天会改变数据解释的动作" detail="事件只进入当前店铺与产品上下文，不会触发广告写入。" />}
      actions={<ActionButton kind="primary" icon={Plus} disabled={!draft.title.trim()} onClick={add}>保存到上下文</ActionButton>}
    >
      <WorkbenchPanel title="新增运营事件" meta={<StoreScope store={store} />} tone="primary">
        <div className="workspace-field-grid">
          <FieldRow label="事件类型"><select value={draft.type} onChange={update("type")}><option>促销</option><option>Listing</option><option>库存</option><option>价格</option><option>人工广告操作</option></select></FieldRow>
          <FieldRow label="发生时间"><input type="datetime-local" value={draft.at} onChange={update("at")} /></FieldRow>
          <FieldRow label="作用范围"><input value={draft.scope} onChange={update("scope")} /></FieldRow>
          <FieldRow label="事件标题" hint="描述发生了什么"><input value={draft.title} onChange={update("title")} placeholder="例如：Prime Deal 结束" /></FieldRow>
          <FieldRow label="预期影响" hint="帮助 AI 区分因果"><input value={draft.impact} onChange={update("impact")} placeholder="例如：转化基线可能回落" /></FieldRow>
        </div>
      </WorkbenchPanel>
      <WorkbenchPanel title="运营事件时间轴" meta={`${events.length} 条有效上下文`}>
        <DataTable columns={[
          { key: "at", label: "发生时间" },
          { key: "type", label: "类型", render: (value) => <Status tone="info">{value}</Status> },
          { key: "title", label: "事件" },
          { key: "scope", label: "范围" },
          { key: "impact", label: "对数据的影响" },
          { key: "context", label: "上下文状态", render: (value) => <Status>{value}</Status> },
        ]} rows={events} rowKey="id" empty="当前范围还没有运营事件" />
      </WorkbenchPanel>
    </PageFrame>
  );
}

function DataScope({ store, state, actions }) {
  const [scope, setScope] = useState(() => ({
    marketplace: store?.marketplace || "美国站",
    product: store?.asin || "B0GTTJFQTM",
    start: state?.scope?.start || "2026-07-06",
    end: state?.scope?.end || "2026-07-19",
    attribution: state?.scope?.attribution || "7 天点击 / 1 天浏览",
  }));
  const update = (key) => (event) => setScope((current) => ({ ...current, [key]: event.target.value }));
  const save = () => runAction(actions, "saveScope", storePayload(store, { scope }));
  return (
    <PageFrame
      eyebrow={`DATA CONTRACT · ${storeIdOf(store)}`}
      title="数据范围"
      description="在采集前冻结店铺、产品、站点与统计窗口，确保后续证据可以复现。"
      task={<TaskBanner tone="warning" title="确认本轮分析范围" detail="保存后，8 类报表、导入批次和诊断结果都会绑定同一个 scope id。" />}
      actions={<ActionButton kind="primary" icon={LockKey} onClick={save}>保存并锁定范围</ActionButton>}
    >
      <SummaryStrip items={[
        { label: "店铺舱", value: storeIdOf(store), detail: store?.name || "极光生活", tone: "success" },
        { label: "站点", value: scope.marketplace, detail: "Amazon marketplace" },
        { label: "产品", value: scope.product, detail: store?.product || "当前锁定 ASIN", tone: "info" },
        { label: "统计窗口", value: "14 天", detail: `${scope.start} → ${scope.end}` },
      ]} />
      <WorkbenchPanel title="采集与分析范围" meta="SCOPE-20260720-SHC001" tone="primary" actions={<Status>待确认</Status>}>
        <div className="workspace-field-grid">
          <FieldRow label="店铺" hint="由顶部店铺舱决定"><input value={`${storeIdOf(store)} · ${store?.name || "极光生活"}`} readOnly /></FieldRow>
          <FieldRow label="Amazon 站点"><select value={scope.marketplace} onChange={update("marketplace")}><option>美国站</option><option>加拿大站</option><option>英国站</option></select></FieldRow>
          <FieldRow label="产品 ASIN"><input value={scope.product} onChange={update("product")} /></FieldRow>
          <FieldRow label="开始日期"><input type="date" value={scope.start} onChange={update("start")} /></FieldRow>
          <FieldRow label="结束日期"><input type="date" value={scope.end} onChange={update("end")} /></FieldRow>
          <FieldRow label="归因窗口"><select value={scope.attribution} onChange={update("attribution")}><option>7 天点击 / 1 天浏览</option><option>14 天点击</option></select></FieldRow>
        </div>
        <div className="workspace-contract-note"><ShieldCheck size={18} weight="fill" /><span><b>范围隔离已开启</b><small>导入行若不匹配 {storeIdOf(store)} / {scope.product}，会进入隔离区而不是当前事实库。</small></span></div>
      </WorkbenchPanel>
    </PageFrame>
  );
}

function ReportCollection({ store, state, actions, selected, onSelect }) {
  const reports = firstArray(state?.reports, store?.reportRows, REPORT_FALLBACK);
  const ready = reports.filter((item) => item.status === "已校验").length;
  const selectedId = selectedIdOf(selected);
  const collect = () => runAction(actions, "collectReports", storePayload(store, { reportTypes: REPORT_TYPES, scope: state?.scope }));
  return (
    <PageFrame
      eyebrow={`LINGXING DOWNLOAD · ${storeIdOf(store)}`}
      title="报表采集"
      description="通过可见浏览器下载 8 类领星报表，逐份校验日期、店铺和文件完整性。"
      task={<TaskBanner tone={ready === 8 ? "success" : "warning"} title={ready === 8 ? "8 类报表已就绪" : `还需补齐 ${8 - ready} 类报表`} detail="采集只从当前领星会话读取；不会调用未授权的远程写接口。" />}
      actions={<InlineActions><ActionButton icon={ArrowSquareOut} onClick={() => runAction(actions, "openVisibleBrowser", storePayload(store, { target: "lingxing-download" }))}>打开下载中心</ActionButton><ActionButton kind="primary" icon={CloudArrowDown} onClick={collect}>采集 8 类报表</ActionButton></InlineActions>}
    >
      <SummaryStrip items={[
        { label: "采集进度", value: `${ready}/8`, detail: ready === 8 ? "全部校验通过" : `${8 - ready} 类等待下载`, tone: ready === 8 ? "success" : "warning" },
        { label: "统计窗口", value: "07-06 → 07-19", detail: "14 个自然日" },
        { label: "已下载行", value: store?.rows || "6,827", detail: "去重前" },
        { label: "浏览器身份", value: store?.session || "领星会话正常", detail: storeIdOf(store), tone: store?.sessionTone || "success" },
      ]} />
      <WorkbenchPanel title="采集清单" meta="每类报表独立记录来源" tone="primary">
        <DataTable columns={[
          { key: "name", label: "报表类型" },
          { key: "window", label: "数据窗口" },
          { key: "rows", label: "行数" },
          { key: "updated", label: "最近采集" },
          { key: "status", label: "状态", render: (value) => <Status>{value}</Status> },
        ]} rows={reports} rowKey="id" selectedId={selectedId} onRowClick={(row) => selectRecord(row, null, store, actions, onSelect)} empty="当前范围没有报表任务" />
      </WorkbenchPanel>
      {ready < 8 ? <TaskBanner tone="warning" title="缺失报表不会被静默跳过" detail="导入门槛仍显示未满足；需要明确重试或缩小范围后重新锁定 scope。" /> : null}
    </PageFrame>
  );
}

function ImportCheck({ store, state, actions }) {
  const reports = firstArray(state?.reports, store?.reportRows, REPORT_FALLBACK);
  const ready = reports.filter((item) => item.status === "已校验").length;
  const validationRows = [
    { id: "VAL-01", rule: "店铺身份一致", checked: "8 个文件", result: "通过", detail: storeIdOf(store) },
    { id: "VAL-02", rule: "统计窗口一致", checked: "8 个文件", result: "通过", detail: "2026-07-06 → 2026-07-19" },
    { id: "VAL-03", rule: "必填列完整", checked: "126 列", result: "通过", detail: "0 个缺列" },
    { id: "VAL-04", rule: "重复业务键", checked: "6,827 行", result: "警告", detail: "17 行将去重" },
    { id: "VAL-05", rule: "ASIN 范围", checked: "6,827 行", result: "通过", detail: store?.asin || "B0GTTJFQTM" },
    { id: "VAL-06", rule: "报表类型齐套", checked: `${ready}/8`, result: ready === 8 ? "通过" : "阻断", detail: ready === 8 ? "可导入" : `缺少 ${8 - ready} 类` },
  ];
  const blocked = validationRows.some((row) => row.result === "阻断");
  const startImport = () => runAction(actions, "importReports", storePayload(store, { scope: state?.scope, reports }));
  return (
    <PageFrame
      eyebrow={`IMPORT GATE · ${storeIdOf(store)}`}
      title="导入校验"
      description="在写入本地事实库前，验证来源、范围、列契约和业务键。"
      task={<TaskBanner tone={blocked ? "danger" : "success"} title={blocked ? "导入被完整性门槛阻断" : "事实包已达到导入门槛"} detail={blocked ? "先返回报表采集补齐缺失类型。" : "导入会生成不可变批次号并保留原文件哈希。"} />}
      actions={<InlineActions><ActionButton icon={ArrowClockwise} onClick={() => runAction(actions, "navigate", { workspace: "data-preparation", subview: "reports" })}>返回采集</ActionButton><ActionButton kind="primary" icon={FileArrowUp} disabled={blocked} onClick={startImport}>导入事实库</ActionButton></InlineActions>}
    >
      <SummaryStrip items={[
        { label: "待导入文件", value: `${ready} / 8`, detail: "领星下载中心", tone: ready === 8 ? "success" : "warning" },
        { label: "数据行", value: "6,827", detail: "17 行将去重" },
        { label: "校验规则", value: "6 项", detail: blocked ? "1 项阻断" : "全部满足", tone: blocked ? "danger" : "success" },
        { label: "目标批次", value: "IMP-0720-0846", detail: "尚未写入" },
      ]} />
      <WorkbenchPanel title="导入前校验" meta="严格门槛" tone="primary" actions={<Status>{blocked ? "阻断" : "可导入"}</Status>}>
        <DataTable columns={[
          { key: "rule", label: "校验规则" },
          { key: "checked", label: "检查对象" },
          { key: "detail", label: "结果详情" },
          { key: "result", label: "状态", render: (value) => <Status>{value}</Status> },
        ]} rows={validationRows} rowKey="id" empty="没有可校验的文件" />
      </WorkbenchPanel>
      <WorkbenchPanel title="事实写入预览" meta="只读" actions={<Status tone="neutral">SQLite · 本地</Status>}>
        <div className="workspace-kv-grid">
          <div><span>Authority DB</span><b>amazon-ai-ops.db</b></div>
          <div><span>Scope ID</span><b>SCOPE-20260720-SHC001</b></div>
          <div><span>去重键</span><b>store + date + entity + report</b></div>
          <div><span>原始文件</span><b>保留 SHA-256 绑定</b></div>
        </div>
      </WorkbenchPanel>
    </PageFrame>
  );
}

function DiagnosisAnalysis({ store, state, actions, selected, onSelect }) {
  const rows = firstArray(state?.diagnoses, store?.diagnoses, DIAGNOSIS_FALLBACK);
  const [severity, setSeverity] = useState("all");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => rows.filter((row) => {
    const severityMatch = severity === "all" || row.severity === severity;
    const queryMatch = !query.trim() || `${row.object} ${row.signal}`.toLowerCase().includes(query.trim().toLowerCase());
    return severityMatch && queryMatch;
  }), [rows, severity, query]);
  const run = () => runAction(actions, "runDiagnosis", storePayload(store, { scope: state?.scope, filters: { severity, query } }));
  return (
    <PageFrame
      eyebrow={`QUANT DIAGNOSIS · ${storeIdOf(store)}`}
      title="广告诊断"
      description="用目标差距、趋势和运营事件解释异常，并把可操作结论交给建议层。"
      task={<TaskBanner tone="warning" title="先核对 2 个高优先级异常" detail="AI 诊断只生成量化结论；任何 Ads 变更都需要进入建议、审批与回读链。" />}
      actions={<ActionButton kind="primary" icon={Brain} onClick={run}>运行 AI 诊断</ActionButton>}
    >
      <SummaryStrip items={[
        { label: "诊断对象", value: `${rows.length} 个`, detail: `${store?.diagnosedKeywords || 23} 个关键词已扫描` },
        { label: "高优先级", value: `${rows.filter((row) => row.severity === "高").length} 个`, detail: "需要运营确认", tone: "danger" },
        { label: "ACOS / 目标", value: `${store?.acos || "38.4%"} / ${store?.target || "28%"}`, detail: "+10.4pct", tone: "danger" },
        { label: "事实批次", value: "IMP-0720-0846", detail: "8/8 报表" },
      ]} />
      <WorkbenchPanel title="诊断结果" meta={`${filtered.length} / ${rows.length} 个对象`} tone="primary" actions={
        <div className="workspace-toolbar">
          <label className="workspace-search"><MagnifyingGlass size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索对象或信号" aria-label="搜索诊断结果" /></label>
          <select value={severity} onChange={(event) => setSeverity(event.target.value)} aria-label="按严重度筛选"><option value="all">全部严重度</option><option value="高">高</option><option value="中">中</option><option value="低">低</option></select>
        </div>
      }>
        <DataTable columns={[
          { key: "severity", label: "优先级", render: (value) => <Status tone={value === "高" ? "danger" : value === "中" ? "warning" : "neutral"}>{value}</Status> },
          { key: "object", label: "诊断对象" },
          { key: "signal", label: "核心信号" },
          { key: "spend", label: "花费" },
          { key: "acos", label: "ACOS" },
          { key: "target", label: "目标" },
          { key: "delta", label: "差距" },
          { key: "confidence", label: "置信度" },
        ]} rows={filtered} rowKey="id" selectedId={selectedIdOf(selected)} onRowClick={(row) => selectRecord(row, null, store, actions, onSelect)} empty="当前筛选没有诊断结果" />
      </WorkbenchPanel>
      <WorkbenchPanel title="诊断解释" meta="所选对象 · DIA-101" actions={<ActionButton icon={ArrowRight} onClick={() => runAction(actions, "navigate", { workspace: "decisions", subview: "recommendations" })}>查看建议</ActionButton>}>
        <div className="workspace-explanation">
          <div><span>观察</span><p>近 7 天花费上升 21%，转化率下降 8%，ACOS 超出产品目标 19.8pct。</p></div>
          <div><span>上下文</span><p>Prime Deal 已结束，转化基线回落；事件 EVT-0720-03 已纳入解释。</p></div>
          <div><span>结论</span><p>建议在自动边界内下调精确词竞价 10%，并在 24 小时后核对页面值与订单变化。</p></div>
        </div>
      </WorkbenchPanel>
    </PageFrame>
  );
}

function Recommendations({ store, state, actions, selected, onSelect }) {
  const rows = firstArray(state?.recommendations, store?.recommendations, RECOMMENDATION_FALLBACK);
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? rows : rows.filter((row) => row.state === filter || row.risk === filter);
  const generate = () => runAction(actions, "generateRecommendations", storePayload(store, { diagnosisIds: firstArray(state?.diagnoses, DIAGNOSIS_FALLBACK).map((item) => item.id) }));
  const submit = () => runAction(actions, "submitForApproval", storePayload(store, { recommendationIds: rows.filter((row) => /待/.test(row.state)).map((row) => row.id) }));
  return (
    <PageFrame
      eyebrow={`UNIFIED RECOMMENDATIONS · ${storeIdOf(store)}`}
      title="统一建议"
      description="广告、预算、否定词和 Listing 机会在一张可追溯的建议表中统一排序。"
      task={<TaskBanner tone="warning" title="把 2 个高影响建议送入人工审批" detail="低风险动作也必须保留来源诊断、变更前后值和策略边界。" />}
      actions={<InlineActions><ActionButton icon={Sparkle} onClick={generate}>重新生成</ActionButton><ActionButton kind="primary" icon={ArrowRight} onClick={submit}>送入审批</ActionButton></InlineActions>}
    >
      <SummaryStrip items={[
        { label: "全部建议", value: `${rows.length} 个`, detail: "本轮诊断" },
        { label: "可自动", value: `${rows.filter((row) => row.state === "可自动").length} 个`, detail: "在策略边界内", tone: "success" },
        { label: "待人工", value: `${rows.filter((row) => /待/.test(row.state)).length} 个`, detail: "高影响或不确定", tone: "warning" },
        { label: "预计预算影响", value: store?.budgetImpact || "$24 / $100", detail: "日级上限" },
      ]} />
      <WorkbenchPanel title="建议队列" meta={`${filtered.length} / ${rows.length} 个`} tone="primary" actions={
        <div className="workspace-filter-group" role="group" aria-label="建议筛选">
          {[['all', '全部'], ['可自动', '可自动'], ['待审批', '待审批'], ['高影响', '高影响']].map(([id, label]) => <button key={id} type="button" className={filter === id ? "active" : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
        </div>
      }>
        <DataTable columns={[
          { key: "risk", label: "风险", render: (value) => <Status>{value}</Status> },
          { key: "action", label: "建议动作" },
          { key: "object", label: "对象" },
          { key: "before", label: "当前值" },
          { key: "after", label: "建议值" },
          { key: "delta", label: "变化" },
          { key: "reason", label: "量化依据" },
          { key: "state", label: "状态", render: (value) => <Status>{value}</Status> },
        ]} rows={filtered} rowKey="id" selectedId={selectedIdOf(selected)} onRowClick={(row) => selectRecord(row, null, store, actions, onSelect)} empty="当前筛选没有建议" />
      </WorkbenchPanel>
      <TaskBanner tone="neutral" title="建议不是执行" detail="只有已决定记录才能产生执行许可；审批前重算会生成新版本，不会覆盖旧建议。" />
    </PageFrame>
  );
}

function Approval({ store, state, actions, selected, onSelect }) {
  const rows = firstArray(state?.recommendations, store?.recommendations, RECOMMENDATION_FALLBACK);
  const pending = rows.filter((row) => /待|高影响/.test(`${row.state} ${row.risk}`));
  const currentId = selectedIdOf(selected) || pending[0]?.id;
  const current = pending.find((row) => row.id === currentId) || pending[0];
  const approve = () => runAction(actions, "approveRecommendation", storePayload(store, { recommendationId: current?.id, version: "v3" }));
  const reject = () => runAction(actions, "rejectRecommendation", storePayload(store, { recommendationId: current?.id, reason: "operator_rejected" }));
  const recalculate = () => runAction(actions, "recalculateRecommendation", storePayload(store, { recommendationId: current?.id, constraint: "reduce_impact" }));
  return (
    <PageFrame
      eyebrow={`HUMAN GATE · ${storeIdOf(store)}`}
      title="人工审批"
      description="审阅高影响动作的依据、边界和执行前后值，并显式签发或拒绝许可。"
      task={<TaskBanner tone="danger" title={`${pending.length} 个建议等待人工决定`} detail="暂停、预算大幅调整和身份不确定的动作永远不会静默自动执行。" />}
      actions={<InlineActions><ActionButton kind="danger" onClick={reject}>驳回</ActionButton><ActionButton icon={ArrowClockwise} onClick={recalculate}>降低影响后重算</ActionButton><ActionButton kind="primary" icon={ShieldCheck} onClick={approve}>批准并签发许可</ActionButton></InlineActions>}
    >
      <div className="workspace-split">
        <WorkbenchPanel title="待审批队列" meta={`${pending.length} 个`} tone="primary">
          <div className="workspace-list" role="list">
            {pending.map((row) => (
              <button key={row.id} type="button" className={`workspace-list-row ${row.id === current?.id ? "selected" : ""}`} aria-pressed={row.id === current?.id} onClick={() => selectRecord(row, null, store, actions, onSelect)}>
                <Status>{row.risk}</Status>
                <span><b>{row.action}</b><small>{row.object} · {row.before} → {row.after}</small></span>
                <ArrowRight size={17} />
              </button>
            ))}
          </div>
        </WorkbenchPanel>
        <WorkbenchPanel title="审批事实" meta={current?.id || "未选择"} actions={<Status>待审批</Status>}>
          {current ? (
            <div className="workspace-review">
              <div className="workspace-change"><span><small>当前值</small><b>{current.before}</b></span><ArrowRight size={20} /><span><small>建议值</small><b>{current.after}</b></span><Status>{current.delta}</Status></div>
              <dl className="workspace-facts">
                <div><dt>建议对象</dt><dd>{current.object}</dd></div>
                <div><dt>量化依据</dt><dd>{current.reason}</dd></div>
                <div><dt>来源诊断</dt><dd>DIA-101 · IMP-0720-0846</dd></div>
                <div><dt>自动边界</dt><dd>日预算单次变更 ±20%</dd></div>
                <div><dt>本次变化</dt><dd>{current.delta} · 超过自动边界</dd></div>
                <div><dt>回读要求</dt><dd>保存后重载 + 24h 业务指标</dd></div>
              </dl>
              <div className="workspace-contract-note danger"><WarningCircle size={18} weight="fill" /><span><b>高影响动作</b><small>批准后只签发一次性许可；可见浏览器仍需再次确认店铺和对象身份。</small></span></div>
            </div>
          ) : <EmptyState title="没有待审批建议" detail="生成或提交建议后会显示在这里。" />}
        </WorkbenchPanel>
      </div>
    </PageFrame>
  );
}

function Decided({ store, state, actions, selected, onSelect }) {
  const rows = firstArray(state?.decisions, store?.decisions, DECIDED_FALLBACK);
  return (
    <PageFrame
      eyebrow={`DECISION LEDGER · ${storeIdOf(store)}`}
      title="已决定"
      description="审批结果、许可和执行状态以追加记录保留，不用当前状态覆盖历史决定。"
      task={<TaskBanner tone="success" title="所有决定都已绑定建议版本" detail="批准会产生一次性许可；驳回不会进入执行队列。" />}
      actions={<ActionButton kind="primary" icon={ArrowRight} onClick={() => runAction(actions, "navigate", { workspace: "readback", subview: "execution" })}>查看执行队列</ActionButton>}
    >
      <SummaryStrip items={[
        { label: "今日决定", value: `${rows.length} 条`, detail: "当前店铺" },
        { label: "已批准", value: `${rows.filter((row) => row.decision === "批准").length} 条`, detail: "许可已绑定", tone: "success" },
        { label: "已驳回", value: `${rows.filter((row) => row.decision === "驳回").length} 条`, detail: "不会执行", tone: "danger" },
        { label: "待回读", value: `${rows.filter((row) => /排队|执行/.test(row.execution)).length} 条`, detail: "执行链继续", tone: "warning" },
      ]} />
      <WorkbenchPanel title="决定账本" meta="append-only" tone="primary" actions={<Status tone="success">Authority DB 已绑定</Status>}>
        <DataTable columns={[
          { key: "at", label: "时间" },
          { key: "id", label: "决定 ID" },
          { key: "decision", label: "决定", render: (value) => <Status>{value}</Status> },
          { key: "action", label: "建议与版本" },
          { key: "actor", label: "决定者" },
          { key: "license", label: "执行许可" },
          { key: "execution", label: "后续状态", render: (value) => <Status>{value}</Status> },
        ]} rows={rows} rowKey="id" selectedId={selectedIdOf(selected)} onRowClick={(row) => selectRecord(row, null, store, actions, onSelect)} empty="当前店铺还没有已决定记录" />
      </WorkbenchPanel>
    </PageFrame>
  );
}

function ExecutionQueue({ store, state, actions, selected, onSelect }) {
  const rows = firstArray(state?.executionQueue, store?.executionQueue, EXECUTION_FALLBACK);
  const runnable = rows.filter((row) => row.gate === "许可已签发");
  const start = () => runAction(actions, "queueExecution", storePayload(store, { actionIds: runnable.map((row) => row.id), mode: "visible-browser" }));
  return (
    <PageFrame
      eyebrow={`TARGET EXPANSION · ${storeIdOf(store)}`}
      title="执行队列"
      description="目标扩展：把已决定动作排入可见浏览器队列，并在每次写入前重查身份与许可。"
      task={<TaskBanner tone="warning" title="目标扩展 · 生产导航之外的执行队列预览" detail="此子视图用于展示后续扩展，不代表当前生产版已经开放 Ads 写入。" />}
      actions={<InlineActions><ActionButton icon={Pause} onClick={() => runAction(actions, "pauseExecution", storePayload(store, { reason: "operator_pause" }))}>暂停队列</ActionButton><ActionButton kind="primary" icon={Play} disabled={!runnable.length} onClick={start}>启动可见浏览器</ActionButton></InlineActions>}
    >
      <SummaryStrip items={[
        { label: "队列动作", value: `${rows.length} 个`, detail: "按许可时间排序" },
        { label: "可执行", value: `${runnable.length} 个`, detail: "许可与边界通过", tone: "success" },
        { label: "被阻断", value: `${rows.length - runnable.length} 个`, detail: "不会自动绕过", tone: "danger" },
        { label: "浏览器模式", value: "可见", detail: "身份需人工可核对", tone: "info" },
      ]} />
      <WorkbenchPanel title="一次性执行队列" meta="每步保存后立即回读" tone="primary" actions={<Status tone="warning">写入前复核</Status>}>
        <DataTable columns={[
          { key: "position", label: "顺序" },
          { key: "id", label: "动作 ID" },
          { key: "object", label: "Amazon 对象" },
          { key: "action", label: "计划变更" },
          { key: "source", label: "建议来源" },
          { key: "gate", label: "安全门", render: (value) => <Status>{value}</Status> },
          { key: "state", label: "队列状态", render: (value) => <Status>{value}</Status> },
        ]} rows={rows} rowKey="id" selectedId={selectedIdOf(selected)} onRowClick={(row) => selectRecord(row, null, store, actions, onSelect)} empty="没有已决定动作进入队列" />
      </WorkbenchPanel>
      <TaskBanner tone="danger" title="当前交付仍是 APP_NEEDS_WORK" detail="真实 Ads v2 before / after / reload 证据与 human approval 尚未满足，原型不得呈现为生产可执行完成。" />
    </PageFrame>
  );
}

function ReadbackEvidence({ store, state, actions }) {
  const configuredStep = Number(state?.readbackStep ?? 0);
  const [localStep, setLocalStep] = useState(Number.isFinite(configuredStep) ? configuredStep : 0);
  const [approvalChecked, setApprovalChecked] = useState(Boolean(state?.approvalChecked));
  const [identityChecked, setIdentityChecked] = useState(Boolean(state?.identityChecked));
  const steps = [
    { id: "target", label: "目标与来源", detail: "绑定建议、决定和 Amazon 对象" },
    { id: "approval", label: "审批与身份", detail: "确认许可、人和店铺" },
    { id: "evidence", label: "执行证据", detail: "before / after / reload 截图" },
    { id: "verify", label: "回读校验", detail: "页面值、时间和值域一致" },
  ];
  const chooseStep = (index) => {
    setLocalStep(index);
    runAction(actions, "selectReadbackStep", storePayload(store, { step: index, stepId: steps[index].id }));
  };
  const canVerify = approvalChecked && identityChecked;
  const action = store?.action?.readback || { id: "ACT-20260720-003", recommendationId: "REC-20260720-003", object: "keypad door lock with handle · exact", from: "$1.30", to: "$1.17" };
  return (
    <PageFrame
      eyebrow={`EXECUTION READBACK · ${storeIdOf(store)}`}
      title="执行回读"
      description="用四步证据链证明执行对象、许可、页面保存值和重载结果一致。"
      task={<TaskBanner tone="danger" title="Task 8B 仍需真实 Ads v2 证据" detail="必须采集不同的 before、after、reload 截图，并绑定当前 authority recommendation id。" />}
      actions={<InlineActions><ActionButton icon={DownloadSimple} onClick={() => runAction(actions, "exportReadback", storePayload(store, { actionId: action.id }))}>导出证据</ActionButton><ActionButton kind="primary" icon={ShieldCheck} disabled={!canVerify} onClick={() => runAction(actions, "verifyReadback", storePayload(store, { actionId: action.id }))}>校验回读</ActionButton></InlineActions>}
    >
      <nav className="readback-rail" aria-label="执行回读四步">
        {steps.map((step, index) => (
          <button key={step.id} type="button" className={localStep === index ? "active" : ""} aria-current={localStep === index ? "step" : undefined} onClick={() => chooseStep(index)}>
            <span>{index + 1}</span><b>{step.label}</b><small>{step.detail}</small>
          </button>
        ))}
      </nav>

      {localStep === 0 ? (
        <WorkbenchPanel title="1 · 目标与来源" meta={action.id} tone="primary" actions={<Status tone="success">已绑定</Status>}>
          <div className="workspace-kv-grid">
            <div><span>动作 ID</span><b>{action.id}</b></div>
            <div><span>建议 ID</span><b>{action.recommendationId}</b></div>
            <div><span>店铺与站点</span><b>{storeIdOf(store)} · {store?.marketplace || "美国站"}</b></div>
            <div><span>Amazon 对象</span><b>{action.object}</b></div>
            <div><span>变更前</span><b>{action.from}</b></div>
            <div><span>目标值</span><b>{action.to}</b></div>
          </div>
        </WorkbenchPanel>
      ) : null}

      {localStep === 1 ? (
        <WorkbenchPanel title="2 · 审批与身份" meta="人工确认" tone="primary">
          <div className="workspace-checklist">
            <label><input type="checkbox" checked={approvalChecked} onChange={(event) => setApprovalChecked(event.target.checked)} /><span><b>已核对人工审批</b><small>批准记录 DEC-20260720-011 与建议版本 v3 一致</small></span></label>
            <label><input type="checkbox" checked={identityChecked} onChange={(event) => setIdentityChecked(event.target.checked)} /><span><b>已核对可见浏览器身份</b><small>页面店铺为 {storeIdOf(store)}，产品为 {store?.asin || "B0GTTJFQTM"}</small></span></label>
          </div>
        </WorkbenchPanel>
      ) : null}

      {localStep === 2 ? (
        <WorkbenchPanel title="3 · 执行证据" meta="需要 3 张不同截图" tone="primary" actions={<ActionButton icon={UploadSimple} onClick={() => runAction(actions, "captureEvidence", storePayload(store, { actionId: action.id, mode: "file-or-paste" }))}>添加截图</ActionButton>}>
          <div className="evidence-grid">
            {[{ id: "before", label: "Before", detail: `页面当前值 ${action.from}`, state: "已采集" }, { id: "after", label: "After", detail: `保存反馈与目标值 ${action.to}`, state: "待采集" }, { id: "reload", label: "Reload", detail: "重载后再次读取页面值", state: "待采集" }].map((item) => (
              <button key={item.id} type="button" className="evidence-slot" onClick={() => runAction(actions, "captureEvidence", storePayload(store, { actionId: action.id, evidenceType: item.id }))}>
                <FileText size={24} /><span><b>{item.label}</b><small>{item.detail}</small></span><Status>{item.state}</Status>
              </button>
            ))}
          </div>
        </WorkbenchPanel>
      ) : null}

      {localStep === 3 ? (
        <WorkbenchPanel title="4 · 回读校验" meta="严格门槛" tone="primary" actions={<Status tone={canVerify ? "warning" : "danger"}>{canVerify ? "等待证据" : "条件未满足"}</Status>}>
          <DataTable columns={[
            { key: "gate", label: "校验门槛" },
            { key: "expected", label: "要求" },
            { key: "actual", label: "当前证据" },
            { key: "result", label: "状态", render: (value) => <Status>{value}</Status> },
          ]} rows={[
            { id: "G1", gate: "Authority 绑定", expected: action.recommendationId, actual: action.recommendationId, result: "通过" },
            { id: "G2", gate: "人工审批", expected: "明确批准", actual: approvalChecked ? "DEC-20260720-011" : "未确认", result: approvalChecked ? "通过" : "阻断" },
            { id: "G3", gate: "店铺身份", expected: storeIdOf(store), actual: identityChecked ? storeIdOf(store) : "未确认", result: identityChecked ? "通过" : "阻断" },
            { id: "G4", gate: "三段截图", expected: "before / after / reload", actual: "1 / 3", result: "阻断" },
            { id: "G5", gate: "页面值", expected: action.to, actual: "等待 reload", result: "阻断" },
          ]} rowKey="id" empty="没有回读门槛" />
        </WorkbenchPanel>
      ) : null}
    </PageFrame>
  );
}

function KeywordOpportunities({ store, state, actions, selected, onSelect }) {
  const rows = firstArray(state?.keywords, store?.keywords, KEYWORDS_FALLBACK);
  const [query, setQuery] = useState("");
  const [intent, setIntent] = useState("all");
  const [onlyOpportunities, setOnlyOpportunities] = useState(true);
  const filtered = useMemo(() => rows.filter((row) => {
    const queryMatch = !query.trim() || row.keyword.toLowerCase().includes(query.trim().toLowerCase());
    const intentMatch = intent === "all" || row.intent === intent;
    const opportunityMatch = !onlyOpportunities || row.state === "待纳入";
    return queryMatch && intentMatch && opportunityMatch;
  }), [rows, query, intent, onlyOpportunities]);
  const send = (row) => runAction(actions, "sendToListing", storePayload(store, { keywordId: row.id, keyword: row.keyword, source: row.source }));
  return (
    <PageFrame
      eyebrow={`KEYWORD OPPORTUNITY · ${storeIdOf(store)}`}
      title="关键词机会"
      description="把搜索词、自然排名与竞品线索合并，筛出值得进入 Listing 的真实关键词。"
      task={<TaskBanner tone="info" title="从 2 个未覆盖机会中选择 Listing 候选" detail="纳入候选只更新本地关键词池，不会直接改写 Amazon Listing。" />}
      actions={<ActionButton kind="primary" icon={ArrowRight} onClick={() => runAction(actions, "navigate", { workspace: "growth", subview: "listing" })}>进入 Listing 工作台</ActionButton>}
    >
      <SummaryStrip items={[
        { label: "关键词池", value: `${rows.length} 个`, detail: "搜索词 + 自然词 + 竞品" },
        { label: "待纳入", value: `${rows.filter((row) => row.state === "待纳入").length} 个`, detail: "高相关未覆盖", tone: "warning" },
        { label: "已覆盖", value: `${rows.filter((row) => /已/.test(row.state)).length} 个`, detail: "广告或 Listing" },
        { label: "排除", value: `${rows.filter((row) => row.state === "排除").length} 个`, detail: "低意向保护", tone: "danger" },
      ]} />
      <WorkbenchPanel title="关键词机会池" meta={`${filtered.length} / ${rows.length} 个`} tone="primary" actions={
        <div className="workspace-toolbar">
          <label className="workspace-search"><MagnifyingGlass size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索关键词" aria-label="搜索关键词" /></label>
          <select value={intent} onChange={(event) => setIntent(event.target.value)} aria-label="按意图筛选"><option value="all">全部意图</option><option>强购买</option><option>品类</option><option>场景</option><option>功能</option><option>低意向</option></select>
          <label className="workspace-compact-check"><input type="checkbox" checked={onlyOpportunities} onChange={(event) => setOnlyOpportunities(event.target.checked)} />只看机会</label>
        </div>
      }>
        <DataTable columns={[
          { key: "keyword", label: "关键词" },
          { key: "source", label: "来源" },
          { key: "intent", label: "意图", render: (value) => <Status tone="info">{value}</Status> },
          { key: "volume", label: "月搜索量" },
          { key: "rank", label: "自然排名" },
          { key: "orders", label: "订单" },
          { key: "acos", label: "广告 ACOS" },
          { key: "state", label: "覆盖状态", render: (value) => <Status>{value}</Status> },
          { key: "listingAction", label: "动作", render: (_value, row) => row.state === "待纳入" ? <button type="button" className="text-button" onClick={(event) => { event.stopPropagation(); send(row); }}>纳入 Listing</button> : <span className="muted-copy">—</span> },
        ]} rows={filtered} rowKey="id" selectedId={selectedIdOf(selected)} onRowClick={(row) => selectRecord(row, null, store, actions, onSelect)} empty="当前筛选没有关键词机会" />
      </WorkbenchPanel>
    </PageFrame>
  );
}

function ListingWorkbench({ store, state, actions }) {
  const defaultTitle = "Keypad Door Lock with Handle, Fingerprint Keyless Entry Smart Lock";
  const defaultBullets = [
    "Fast fingerprint and keypad access for bedrooms, offices, and rental properties.",
    "Reversible handle fits most left- and right-handed doors without extra drilling.",
    "Auto-lock, passage mode, and temporary codes keep everyday access under control.",
    "Local unlocking works without a cloud subscription; emergency keys stay available.",
    "Clear voice guidance and a low-battery warning make setup and daily use simple.",
  ];
  const [title, setTitle] = useState(state?.listingDraft?.title || defaultTitle);
  const [bullets, setBullets] = useState(state?.listingDraft?.bullets || defaultBullets);
  const [activeSection, setActiveSection] = useState("title");
  const keywords = ["keypad door lock with handle", "fingerprint door handle lock", "smart lock for bedroom door", "keyless entry door knob"];
  const updateBullet = (index, value) => setBullets((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  const draft = { title, bullets, productId: store?.asin || "B0GTTJFQTM", version: "local-v15" };
  return (
    <PageFrame
      eyebrow={`LOCAL LISTING DRAFT · ${storeIdOf(store)}`}
      title="Listing 工作台"
      description="用真实关键词机会生成可审阅草稿，保留差异与版本，不直接提交 Amazon。"
      task={<TaskBanner tone="warning" title="仅本地预览 · 待人工核对品牌语气与事实声明" detail="生成、保存和导出都不会覆盖领星或 Amazon 上的现有 Listing。" />}
      actions={<InlineActions><ActionButton icon={Sparkle} onClick={() => runAction(actions, "generateListingDraft", storePayload(store, { keywords, productId: draft.productId }))}>生成本地草稿</ActionButton><ActionButton icon={DownloadSimple} onClick={() => runAction(actions, "exportListingDraft", storePayload(store, { draft }))}>导出草稿</ActionButton><ActionButton kind="primary" icon={Check} onClick={() => runAction(actions, "saveListingDraft", storePayload(store, { draft }))}>保存本地版本</ActionButton></InlineActions>}
    >
      <div className="workspace-split listing-layout">
        <WorkbenchPanel title="关键词覆盖" meta={`${keywords.length} 个候选`} tone="primary">
          <div className="keyword-rail">
            {keywords.map((keyword, index) => <button key={keyword} type="button" onClick={() => setActiveSection(index === 0 ? "title" : `bullet-${Math.min(index, 4)}`)}><span>{index + 1}</span><b>{keyword}</b><Status tone={index < 2 ? "success" : "warning"}>{index < 2 ? "已覆盖" : "待补齐"}</Status></button>)}
          </div>
          <div className="workspace-contract-note"><Target size={18} weight="fill" /><span><b>覆盖目标</b><small>标题承载主关键词；五点只在语义自然时补齐，不做关键词堆砌。</small></span></div>
        </WorkbenchPanel>
        <WorkbenchPanel title="本地草稿" meta="local-v15" actions={<Status tone="warning">未发布</Status>}>
          <div className="listing-editor">
            <label className={activeSection === "title" ? "active" : ""}><span><b>标题</b><small>{title.length} / 200</small></span><textarea value={title} maxLength={200} onFocus={() => setActiveSection("title")} onChange={(event) => setTitle(event.target.value)} /></label>
            {bullets.map((bullet, index) => (
              <label key={index} className={activeSection === `bullet-${index}` ? "active" : ""}><span><b>五点 {index + 1}</b><small>{bullet.length} / 500</small></span><textarea value={bullet} maxLength={500} onFocus={() => setActiveSection(`bullet-${index}`)} onChange={(event) => updateBullet(index, event.target.value)} /></label>
            ))}
          </div>
        </WorkbenchPanel>
      </div>
      <WorkbenchPanel title="版本差异" meta="现网 v14 → 本地 v15">
        <div className="workspace-diff"><div><span>当前版本</span><p>Keyless Entry Door Lock with Keypad, Black</p></div><ArrowRight size={20} /><div className="after"><span>本地草稿</span><p>{title}</p></div></div>
      </WorkbenchPanel>
    </PageFrame>
  );
}

function SystemSettings({ store, state, actions }) {
  const [section, setSection] = useState("ai");
  const [ai, setAi] = useState(() => ({
    provider: state?.settings?.provider || "OpenAI-compatible",
    model: state?.settings?.model || "gpt-5.4",
    temperature: state?.settings?.temperature ?? "0.2",
    maxBidChange: state?.settings?.maxBidChange || "15",
    maxBudgetChange: state?.settings?.maxBudgetChange || "20",
    pauseNeedsApproval: true,
  }));
  const [storeForm, setStoreForm] = useState(() => ({
    name: store?.name || "极光生活",
    marketplace: store?.marketplace || "美国站",
    currency: store?.currency || "$",
    account: store?.username || "ops@aurora.example",
  }));
  const updateAi = (key) => (event) => setAi((current) => ({ ...current, [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));
  const updateStore = (key) => (event) => setStoreForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <PageFrame
      eyebrow={`SYSTEM POLICY · ${storeIdOf(store)}`}
      title="AI 与店铺设置"
      description="维护模型连接、自动边界与店铺非敏感配置；保存的密码永远不进入 Renderer。"
      task={<TaskBanner tone={store?.sessionTone === "warning" ? "warning" : "success"} title={store?.session || "领星凭证状态正常"} detail="Renderer 只显示用户名可用性和凭证状态，密码字段始终为空。" />}
      actions={section === "ai" ? <ActionButton kind="primary" icon={Check} onClick={() => runAction(actions, "saveAiSettings", storePayload(store, { settings: ai }))}>保存 AI 与规则</ActionButton> : <ActionButton kind="primary" icon={Check} onClick={() => runAction(actions, "saveStoreConfig", storePayload(store, { config: storeForm }))}>保存店铺配置</ActionButton>}
    >
      <div className="workspace-section-tabs" role="tablist" aria-label="设置分类">
        <button type="button" role="tab" aria-selected={section === "ai"} onClick={() => setSection("ai")}><Robot size={17} />AI 与规则</button>
        <button type="button" role="tab" aria-selected={section === "store"} onClick={() => setSection("store")}><Storefront size={17} />店铺配置</button>
      </div>
      {section === "ai" ? (
        <>
          <SummaryStrip items={[
            { label: "模型连接", value: "可用", detail: `${ai.provider} · ${ai.model}`, tone: "success" },
            { label: "竞价自动边界", value: `±${ai.maxBidChange}%`, detail: "单次动作" },
            { label: "预算自动边界", value: `±${ai.maxBudgetChange}%`, detail: "超出需人工审批" },
            { label: "暂停动作", value: "始终审批", detail: "不可自动恢复", tone: "warning" },
          ]} />
          <WorkbenchPanel title="模型连接" meta="本地保存" tone="primary" actions={<Status tone="success">连接可用</Status>}>
            <div className="workspace-field-grid">
              <FieldRow label="Provider"><select value={ai.provider} onChange={updateAi("provider")}><option>OpenAI-compatible</option><option>Anthropic-compatible</option><option>Local model</option></select></FieldRow>
              <FieldRow label="模型"><input value={ai.model} onChange={updateAi("model")} /></FieldRow>
              <FieldRow label="Temperature" hint="量化任务建议保持低随机性"><input value={ai.temperature} onChange={updateAi("temperature")} inputMode="decimal" /></FieldRow>
            </div>
          </WorkbenchPanel>
          <WorkbenchPanel title="自动执行边界" meta="店铺级策略" actions={<Status tone="warning">高影响需人工</Status>}>
            <div className="workspace-field-grid">
              <FieldRow label="关键词竞价单次变化"><input value={ai.maxBidChange} onChange={updateAi("maxBidChange")} inputMode="numeric" /><span className="field-suffix">%</span></FieldRow>
              <FieldRow label="广告组预算单次变化"><input value={ai.maxBudgetChange} onChange={updateAi("maxBudgetChange")} inputMode="numeric" /><span className="field-suffix">%</span></FieldRow>
              <FieldRow label="暂停投放"><label className="workspace-switch"><input type="checkbox" checked={ai.pauseNeedsApproval} onChange={updateAi("pauseNeedsApproval")} /><span>始终要求人工审批</span></label></FieldRow>
            </div>
          </WorkbenchPanel>
        </>
      ) : (
        <>
          <WorkbenchPanel title="店铺非敏感配置" meta={storeIdOf(store)} tone="primary">
            <div className="workspace-field-grid">
              <FieldRow label="店铺名称"><input value={storeForm.name} onChange={updateStore("name")} /></FieldRow>
              <FieldRow label="Amazon 站点"><select value={storeForm.marketplace} onChange={updateStore("marketplace")}><option>美国站</option><option>加拿大站</option><option>英国站</option></select></FieldRow>
              <FieldRow label="币种"><select value={storeForm.currency} onChange={updateStore("currency")}><option value="$">USD ($)</option><option value="CA$">CAD (CA$)</option><option value="£">GBP (£)</option></select></FieldRow>
              <FieldRow label="领星用户名" hint="密码不会显示在此处"><input value={storeForm.account} onChange={updateStore("account")} /></FieldRow>
            </div>
          </WorkbenchPanel>
          <WorkbenchPanel title="身份与凭证状态" meta="Main-only secret storage" actions={<ActionButton icon={ArrowSquareOut} onClick={() => runAction(actions, "verifyStoreSession", storePayload(store, { mode: "visible-login" }))}>在可见页面验证</ActionButton>}>
            <DataTable columns={[
              { key: "system", label: "系统" },
              { key: "identity", label: "可见身份" },
              { key: "secret", label: "Renderer 可见密钥" },
              { key: "status", label: "状态", render: (value) => <Status>{value}</Status> },
            ]} rows={[
              { id: "AUTH-ERP", system: "领星 ERP", identity: storeForm.account, secret: "无", status: store?.session || "正常" },
              { id: "AUTH-ADS", system: "Amazon Ads", identity: storeIdOf(store), secret: "无", status: "待执行前复核" },
              { id: "AUTH-AI", system: "AI Provider", identity: ai.model, secret: "无", status: "连接可用" },
            ]} rowKey="id" empty="没有身份配置" />
          </WorkbenchPanel>
        </>
      )}
    </PageFrame>
  );
}

function Scheduler({ store, state, actions, selected, onSelect }) {
  const rows = firstArray(state?.schedules, store?.schedules, SCHEDULE_FALLBACK);
  const toggle = (row) => runAction(actions, "toggleSchedule", storePayload(store, { scheduleId: row.id, enabled: !row.enabled }));
  const runNow = (row) => runAction(actions, "runScheduleNow", storePayload(store, { scheduleId: row.id }));
  return (
    <PageFrame
      eyebrow={`LOCAL SCHEDULER · ${storeIdOf(store)}`}
      title="定时任务"
      description="编排采集、诊断、回读与交付；每个任务仍受当前店铺和前置门槛约束。"
      task={<TaskBanner tone="info" title="下一任务：明日 08:30 采集 8 类广告报表" detail="任务失败会保留可重试状态，不会把部分采集伪装成成功。" />}
      actions={<ActionButton icon={ArrowClockwise} onClick={() => runAction(actions, "runScheduleNow", storePayload(store, { scheduleId: "SCH-01" }))}>立即运行采集</ActionButton>}
    >
      <SummaryStrip items={[
        { label: "已启用", value: `${rows.filter((row) => row.enabled).length} 个`, detail: `共 ${rows.length} 个任务`, tone: "success" },
        { label: "下次运行", value: "明日 08:30", detail: "广告报表日采集" },
        { label: "今日成功", value: "5 次", detail: "0 次失败", tone: "success" },
        { label: "并发策略", value: "店铺串行", detail: "避免会话竞争" },
      ]} />
      <WorkbenchPanel title="任务计划" meta="本机时间 · Asia/Shanghai" tone="primary">
        <DataTable columns={[
          { key: "task", label: "任务" },
          { key: "cadence", label: "触发规则" },
          { key: "next", label: "下次运行" },
          { key: "last", label: "最近结果" },
          { key: "enabledState", label: "状态", render: (_value, row) => <Status>{row.enabled ? "已启用" : "已暂停"}</Status> },
          { key: "controls", label: "操作", render: (_value, row) => <InlineActions><button type="button" className="text-button" onClick={(event) => { event.stopPropagation(); toggle(row); }}>{row.enabled ? "暂停" : "启用"}</button><button type="button" className="text-button" onClick={(event) => { event.stopPropagation(); runNow(row); }}>立即运行</button></InlineActions> },
        ]} rows={rows} rowKey="id" selectedId={selectedIdOf(selected)} onRowClick={(row) => selectRecord(row, null, store, actions, onSelect)} empty="当前店铺没有定时任务" />
      </WorkbenchPanel>
      <TaskBanner tone="neutral" title="有序关停" detail="应用退出时按 scheduler → browser → DB 顺序进行有界清理；未完成任务会在下次启动恢复为可判断状态。" />
    </PageFrame>
  );
}

function Delivery({ store, state, actions }) {
  const readiness = state?.readiness || "APP_NEEDS_WORK";
  const checks = [
    { id: "DLV-01", gate: "完整测试回归", evidence: "584 / 584 suites · 1992 / 1992 tests", result: "通过" },
    { id: "DLV-02", gate: "Windows 包启动", evidence: "package-launch-smoke-1784276358829.json", result: "通过" },
    { id: "DLV-03", gate: "工作区 UI 证据", evidence: "schema v5 · 100% / 125%", result: "通过" },
    { id: "DLV-04", gate: "外部安全边界", evidence: "11 / 11", result: "通过" },
    { id: "DLV-05", gate: "真实广告执行回读", evidence: "Task 8B · 缺少 approval + before/after/reload", result: "阻断" },
    { id: "DLV-06", gate: "NON_READY 安全包", evidence: "19 / 19 strict checks", result: "通过" },
  ];
  const check = () => runAction(actions, "runDeliveryCheck", storePayload(store, { strict: true }));
  const exportBundle = () => runAction(actions, "exportDeliveryBundle", storePayload(store, { readiness, mode: "non-ready" }));
  return (
    <PageFrame
      eyebrow="WINDOWS DELIVERY"
      title="交付与验证"
      description="把源码、Windows 包、哈希、UI 证据和 readiness 判断绑定为同一候选。"
      task={<TaskBanner tone="danger" title={`${readiness} · 7 / 8 正式门槛通过`} detail="唯一失败门槛是 Task 8B real-ad-execution-readback；不得导出或复用历史 READY 声明。" />}
      actions={<InlineActions><ActionButton icon={ArrowClockwise} onClick={check}>重新检查</ActionButton><ActionButton icon={ArrowSquareOut} onClick={() => runAction(actions, "openDeliveryPath", { path: "output/delivery-bundles" })}>打开交付目录</ActionButton><ActionButton kind="primary" icon={Package} onClick={exportBundle}>导出 NON_READY 包</ActionButton></InlineActions>}
    >
      <SummaryStrip items={[
        { label: "Readiness", value: readiness, detail: "7 / 8 gates", tone: "danger" },
        { label: "测试", value: "1992 / 1992", detail: "全部通过", tone: "success" },
        { label: "UI 证据", value: "schema v5", detail: "8 workspaces + overlays", tone: "success" },
        { label: "安全包", value: "19 / 19", detail: "严格 NON_READY 检查", tone: "success" },
      ]} />
      <WorkbenchPanel title="正式交付门槛" meta="current external-security P1 candidate" tone="primary" actions={<Status tone="danger">NON_READY</Status>}>
        <DataTable columns={[
          { key: "gate", label: "门槛" },
          { key: "evidence", label: "当前证据" },
          { key: "result", label: "结果", render: (value) => <Status>{value}</Status> },
        ]} rows={checks} rowKey="id" empty="没有交付检查结果" />
      </WorkbenchPanel>
      <WorkbenchPanel title="当前候选绑定" meta="防止陈旧 READY 复用">
        <div className="workspace-code-list">
          <div><span>win-unpacked EXE</span><code>67DC2A7036860A68E5312C212C31B8772…</code></div>
          <div><span>app content</span><code>8A9132109B9C2C6A4C1AA6A1EB18EFC6…</code></div>
          <div><span>main bundle</span><code>74046AD904EE2DFFB77E892367F7D38E0…</code></div>
          <div><span>readiness JSON</span><code>final-readiness-20260717-external-security-p1-non-ready.json</code></div>
        </div>
      </WorkbenchPanel>
    </PageFrame>
  );
}

function UnknownSubview({ workspace, subview, actions }) {
  return (
    <PageFrame eyebrow="WORKSPACE ROUTER" title="子视图尚未注册" description={`无法解析 ${workspace || "unknown"} / ${subview || "unknown"}。`}>
      <EmptyState title="没有对应的工作区页面" detail="请选择生产导航中的有效子视图。" action={<ActionButton kind="primary" icon={ArrowRight} onClick={() => runAction(actions, "navigate", { workspace: "today", subview: "overview" })}>返回今日任务</ActionButton>} />
    </PageFrame>
  );
}

const ROUTES = {
  today: {
    overview: TodayOverview,
  },
  product: {
    products: ProductList,
    targets: ProductTargets,
    events: ProductEvents,
  },
  "data-preparation": {
    scope: DataScope,
    reports: ReportCollection,
    "import-check": ImportCheck,
  },
  diagnosis: {
    analysis: DiagnosisAnalysis,
  },
  decisions: {
    recommendations: Recommendations,
    approval: Approval,
    decided: Decided,
  },
  readback: {
    evidence: ReadbackEvidence,
    execution: ExecutionQueue,
  },
  growth: {
    keywords: KeywordOpportunities,
    listing: ListingWorkbench,
  },
  system: {
    settings: SystemSettings,
    scheduler: Scheduler,
    delivery: Delivery,
  },
};

const DEFAULT_SUBVIEW = {
  today: "overview",
  product: "products",
  "data-preparation": "scope",
  diagnosis: "analysis",
  decisions: "recommendations",
  readback: "evidence",
  growth: "keywords",
  system: "settings",
};

export function WorkspaceRouter({ workspace, subview, store, state, actions, selected, onSelect }) {
  const resolvedWorkspace = ROUTES[workspace] ? workspace : "today";
  const resolvedSubview = subview || DEFAULT_SUBVIEW[resolvedWorkspace];
  const View = ROUTES[resolvedWorkspace]?.[resolvedSubview];
  if (!View) return <UnknownSubview workspace={workspace} subview={subview} actions={actions} />;
  return <View store={store || {}} state={state || {}} actions={actions || {}} selected={selected} onSelect={onSelect} />;
}

export default WorkspaceRouter;
