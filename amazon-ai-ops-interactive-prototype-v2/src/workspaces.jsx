import { useState } from "react";
import {
  Archive,
  ArrowClockwise,
  ArrowRight,
  Check,
  CloudArrowDown,
  DownloadSimple,
  FileArrowUp,
  FloppyDisk,
  LockKey,
  MagnifyingGlass,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  Sparkle,
  UploadSimple,
} from "@phosphor-icons/react";
import {
  formatDateTime,
  formatMoney,
  formatPercent,
  getWorkspace,
} from "./spec.js";
import {
  WorkspacePageFrame as BaseWorkspacePageFrame,
  WorkspaceTabs,
  TaskBanner,
  SummaryStrip,
  Panel as BasePanel,
  Toolbar,
  DataTable,
  StatusPill,
  Button,
  Field,
  SelectField as BaseSelectField,
  TextAreaField as BaseTextAreaField,
  Modal as BaseModal,
  ConfirmDialog,
  EmptyState,
  InlineFeedback,
  SectionEmpty,
} from "./ui.jsx";

function WorkspacePageFrame({ task, children, ...props }) {
  return <BaseWorkspacePageFrame {...props}>{task}{children}</BaseWorkspacePageFrame>;
}

function Panel({ meta, description, ...props }) {
  return <BasePanel {...props} description={description ?? meta} />;
}

function SelectField({ onChange, ...props }) {
  return <BaseSelectField {...props} onChange={(event) => onChange?.(event.target.value, event)} />;
}

function TextAreaField({ onChange, ...props }) {
  return <BaseTextAreaField {...props} onChange={(event) => onChange?.(event.target.value, event)} />;
}

function Modal({ actions, footer, ...props }) {
  return <BaseModal {...props} footer={footer ?? actions} />;
}

const nowLocal = () => new Date().toISOString().slice(0, 16);

function tableRows(table) {
  if (Array.isArray(table)) return table;
  if (!table || typeof table !== "object") return [];
  if (Array.isArray(table.allIds) && table.byId) {
    return table.allIds.map((id) => table.byId[id]).filter(Boolean);
  }
  return Object.values(table.byId ?? table).filter((item) => item && typeof item === "object");
}

function entities(store, ...names) {
  for (const name of names) {
    const rows = tableRows(store?.entities?.[name] ?? store?.[name]);
    if (rows.length) return rows;
  }
  return [];
}

function entityId(row) {
  return row?.id ?? row?.entityId ?? row?.key ?? row?.sku ?? row?.asin;
}

function currentProduct(store) {
  const products = entities(store, "products");
  const selectedId = store?.scope?.selectedProductId;
  return products.find((product) => entityId(product) === selectedId) ?? products[0] ?? null;
}

const ENUM_LABELS = {
  active: "在售",
  watch: "观察",
  archived: "已归档",
  pending_review: "待判断",
  pending_approval: "待审批",
  approved: "已批准",
  rejected: "已驳回",
  executed: "已执行",
  superseded: "已替代",
  queued: "排队中",
  running: "执行中",
  awaiting_readback: "待回读",
  verified: "已验证",
  failed: "失败",
  cancelled: "已取消",
  enabled: "已启用",
  paused: "已暂停",
  ready: "就绪",
  downloaded: "已下载",
  imported: "已导入",
  high: "高",
  medium: "中",
  low: "低",
  included: "已纳入",
  candidate: "候选",
  excluded: "已排除",
  editing: "编辑中",
  saved: "已保存",
  collection: "报表采集",
  diagnosis: "量化诊断",
  readback: "执行回读",
  delivery: "交付检查",
};

function display(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return ENUM_LABELS[value] ?? String(value);
}

function statusTone(status) {
  const value = String(status ?? "").toLowerCase();
  if (/失败|错误|阻断|拒绝|failed|error|blocked|rejected|mismatch/.test(value)) return "danger";
  if (/等待|待|警告|暂停|部分|running|pending|warning|partial|paused|queued/.test(value)) return "warning";
  if (/成功|完成|通过|批准|已锁定|verified|success|passed|approved|ready|active/.test(value)) return "success";
  if (/模拟|草稿|prototype|draft/.test(value)) return "info";
  return "neutral";
}

function statusLabel(row, fallback = "正常") {
  return row?.statusLabel ?? display(row?.status ?? row?.state ?? fallback);
}

function storeId(store) {
  return store?.id ?? store?.storeId ?? "UNKNOWN";
}

function money(value, store) {
  if (typeof value === "string" && /[$£¥]/.test(value)) return value;
  return formatMoney(value, store?.config?.currency ?? "USD");
}

function percent(value) {
  if (typeof value === "string" && value.includes("%")) return value;
  const number = Number(value ?? 0);
  return formatPercent(number > 1 ? number / 100 : number);
}

function asOptions(values) {
  return values.map((value) => typeof value === "string" ? { value, label: value } : value);
}

function invoke(command, type, payload, setFeedback) {
  const result = command(type, payload);
  setFeedback?.({
    tone: result?.ok ? "success" : "danger",
    message: result?.message ?? (result?.ok ? "操作已保存" : "操作未完成"),
  });
  return result;
}

function Feedback({ value }) {
  if (!value) return null;
  return <InlineFeedback tone={value.tone}>{value.message}</InlineFeedback>;
}

function InspectButton({ onClick, children = "详情" }) {
  return <button className="table-text-action" type="button" onClick={(event) => { event.stopPropagation(); onClick(); }}>{children}</button>;
}

function openInspector(onInspect, type, row, options = {}) {
  const id = entityId(row);
  onInspect?.({
    type,
    id,
    title: options.title ?? row?.title ?? row?.name ?? row?.label ?? id ?? "记录详情",
    subtitle: options.subtitle ?? row?.subtitle ?? row?.description ?? `${type} · ${id ?? "未编号"}`,
    fields: options.fields ?? Object.entries(row ?? {}).slice(0, 9).map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : display(value)]),
    actions: options.actions ?? [],
  });
}

function WorkspaceSurface({ route, onNavigate, children }) {
  const workspace = getWorkspace(route.workspace);
  return (
    <div className="workspace-surface">
      <WorkspaceTabs
        items={workspace.subviews}
        active={route.subview}
        onChange={(subviewId) => onNavigate(workspace.id, subviewId)}
      />
      {children}
    </div>
  );
}

function TodayOverview({ store, command, onNavigate, onInspect }) {
  const reports = entities(store, "reports");
  const recommendations = recommendationRows(store);
  const executions = entities(store, "executions", "executionQueue");
  const products = entities(store, "products");
  const readyReports = reports.filter((row) => /完成|ready|downloaded|imported|success/i.test(statusLabel(row))).length;
  const pendingApprovals = recommendations.filter((row) => /待审批|pending_approval/.test(statusLabel(row))).length;
  const waitingReadback = executions.filter((row) => /回读|awaiting_readback|saved/.test(statusLabel(row))).length;
  const product = currentProduct(store);
  const steps = [
    { id: "scope", title: "确认店铺与产品范围", detail: product ? `${product.sku ?? product.asin} 已锁定` : "尚未锁定产品", state: product ? "已完成" : "待处理", target: ["product", "products"] },
    { id: "reports", title: "补齐并导入广告报表", detail: `${readyReports}/${Math.max(reports.length, 8)} 类已就绪`, state: readyReports >= 8 ? "已完成" : "待处理", target: ["data", "reports"] },
    { id: "diagnosis", title: "运行量化诊断", detail: `${entities(store, "diagnostics").length} 个诊断对象`, state: entities(store, "diagnostics").length ? "已完成" : "待处理", target: ["diagnosis", "analysis"] },
    { id: "approval", title: "处理高影响建议", detail: `${pendingApprovals} 个等待人工决定`, state: pendingApprovals ? "待审批" : "已完成", target: ["decisions", "approval"] },
    { id: "readback", title: "核对模拟执行结果", detail: `${waitingReadback} 个等待 reload 证据`, state: waitingReadback ? "待回读" : "已完成", target: ["readback", "execution"] },
  ];
  const next = steps.find((step) => step.state !== "已完成") ?? steps.at(-1);
  return (
    <WorkspacePageFrame
      eyebrow={`DAILY CONTROL · ${storeId(store)}`}
      title="今日巡航"
      description="从当前店铺最重要的阻断项开始，完成数据、诊断、决策与模拟回读闭环。"
      task={<TaskBanner tone={next.state === "已完成" ? "success" : "warning"} title={next.state === "已完成" ? "今日主链路已完成" : `下一步：${next.title}`} detail={next.detail} />}
      actions={<Button variant="primary" icon={ArrowRight} onClick={() => onNavigate(...next.target)}>继续主任务</Button>}
    >
      <SummaryStrip items={[
        { label: "广告销售额", value: money(store?.metrics?.adSales ?? store?.metrics?.sales ?? 0, store), detail: "当前事实批次" },
        { label: "ACOS / 目标", value: `${percent(store?.metrics?.acos)} / ${percent(product?.targets?.targetAcos ?? product?.target?.targetAcos)}`, detail: "按锁定产品" },
        { label: "报表就绪", value: `${readyReports}/${Math.max(reports.length, 8)}`, detail: readyReports >= 8 ? "完整" : "仍有缺口", tone: readyReports >= 8 ? "success" : "warning" },
        { label: "待人工 / 回读", value: `${pendingApprovals} / ${waitingReadback}`, detail: store?.autonomy?.mode === "auto" ? "AI 全自动边界" : "人工审批模式" },
      ]} />
      <Panel title="今日主链路" meta={`${storeId(store)} · ${product?.sku ?? "未锁定产品"}`} tone="primary">
        <div className="task-step-list">
          {steps.map((step, index) => (
            <button key={step.id} type="button" className="task-step-row" onClick={() => onNavigate(...step.target)}>
              <span className="task-step-index">{index + 1}</span>
              <span className="task-step-copy"><b>{step.title}</b><small>{step.detail}</small></span>
              <StatusPill tone={statusTone(step.state)}>{step.state}</StatusPill>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="最近需要关注" meta="当前店铺">
        {recommendations.length ? (
          <DataTable
            columns={[
              { key: "title", label: "建议" },
              { key: "risk", label: "风险", render: (value) => <StatusPill tone={statusTone(value)}>{display(value)}</StatusPill> },
              { key: "status", label: "状态", render: (_value, row) => <StatusPill tone={statusTone(statusLabel(row))}>{statusLabel(row)}</StatusPill> },
              { key: "action", label: "操作", render: (_value, row) => <InspectButton onClick={() => openInspector(onInspect, "recommendation", row)}>检查</InspectButton> },
            ]}
            rows={recommendations.slice(0, 4)}
            rowKey="id"
            onRowClick={(row) => openInspector(onInspect, "recommendation", row)}
          />
        ) : <SectionEmpty title="当前没有建议" detail="完成诊断后，建议会出现在这里。" action={<Button onClick={() => onNavigate("diagnosis", "analysis")}>前往诊断</Button>} />}
      </Panel>
    </WorkspacePageFrame>
  );
}

function Products({ store, command, onNavigate, onInspect }) {
  const rows = entities(store, "products");
  const selectedId = store?.scope?.selectedProductId;
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [form, setForm] = useState({ sku: "", asin: "", name: "", status: "active" });
  const visibleRows = rows.filter((row) => `${row.sku} ${row.asin} ${row.name ?? row.title}`.toLowerCase().includes(query.toLowerCase()));
  const openForm = (row = null) => {
    setForm({ sku: row?.sku ?? "", asin: row?.asin ?? "", name: row?.name ?? row?.title ?? "", status: row?.status ?? "active" });
    setDialog({ mode: row ? "edit" : "create", row });
  };
  const save = () => {
    const type = dialog?.mode === "edit" ? "updateProduct" : "createProduct";
    const payload = dialog?.mode === "edit"
      ? { productId: entityId(dialog.row), expectedRevision: dialog.row?.revision, patch: form }
      : { product: form };
    const result = invoke(command, type, payload, setFeedback);
    if (result?.ok) setDialog(null);
  };
  const archive = (row, archived = true) => invoke(command, archived ? "archiveProduct" : "restoreProduct", { productId: entityId(row), expectedRevision: row.revision }, setFeedback);
  return (
    <WorkspacePageFrame
      eyebrow={`PRODUCT SCOPE · ${storeId(store)}`}
      title="产品工作台"
      description="维护本店产品映射并锁定当前运营产品；归档不会破坏历史事实。"
      task={<TaskBanner tone={selectedId ? "success" : "warning"} title={selectedId ? "当前产品已锁定" : "先锁定今天要运营的产品"} detail="后续报表、诊断、建议和模拟执行都绑定同一个产品范围。" />}
      actions={<Button variant="primary" icon={Plus} onClick={() => openForm()}>新增产品映射</Button>}
    >
      <SummaryStrip items={[
        { label: "当前产品", value: currentProduct(store)?.sku ?? "未锁定", detail: currentProduct(store)?.asin ?? "请选择产品" },
        { label: "有效产品", value: `${rows.filter((row) => !row.archived && row.status !== "archived").length} 个`, detail: `共 ${rows.length} 个` },
        { label: "已归档", value: `${rows.filter((row) => row.archived || row.status === "archived").length} 个`, detail: "可恢复" },
        { label: "隔离范围", value: storeId(store), detail: store?.config?.marketplace ?? "当前店铺", tone: "success" },
      ]} />
      <Feedback value={feedback} />
      <Panel title="当前店铺产品" meta={`${visibleRows.length} / ${rows.length}`} tone="primary" actions={
        <Toolbar><label className="workspace-search"><MagnifyingGlass size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 SKU / ASIN / 产品名" /></label></Toolbar>
      }>
        {rows.length ? <DataTable
          columns={[
            { key: "sku", label: "SKU" },
            { key: "asin", label: "ASIN" },
            { key: "name", label: "产品", render: (_value, row) => <span className="cell-clip" title={row.name ?? row.title}>{row.name ?? row.title}</span> },
            { key: "status", label: "状态", render: (_value, row) => <StatusPill tone={statusTone(statusLabel(row))}>{row.archived ? "已归档" : statusLabel(row)}</StatusPill> },
            { key: "actions", label: "操作", render: (_value, row) => <div className="row-actions"><InspectButton onClick={() => openForm(row)}>编辑</InspectButton><InspectButton onClick={() => archive(row, !(row.archived || row.status === "archived"))}>{row.archived || row.status === "archived" ? "恢复" : "归档"}</InspectButton></div> },
          ]}
          rows={visibleRows}
          rowKey="id"
          selectedId={selectedId}
          onRowClick={(row) => { invoke(command, "selectProduct", { productId: entityId(row) }, setFeedback); openInspector(onInspect, "product", row); }}
        /> : <EmptyState title="本店还没有产品" detail="新增本地产品映射后即可建立量化范围。" action={<Button variant="primary" icon={Plus} onClick={() => openForm()}>新增产品</Button>} />}
      </Panel>
      <Modal open={Boolean(dialog)} title={dialog?.mode === "edit" ? "编辑产品" : "新增产品映射"} description="仅修改当前店铺的本地产品配置。" onClose={() => setDialog(null)} actions={<><Button onClick={() => setDialog(null)}>取消</Button><Button variant="primary" icon={FloppyDisk} disabled={!form.sku.trim() || !form.asin.trim() || !form.name.trim()} onClick={save}>保存产品</Button></>}>
        <div className="form-grid">
          <Field label="SKU"><input value={form.sku} onChange={(event) => setForm((current) => ({ ...current, sku: event.target.value }))} /></Field>
          <Field label="ASIN"><input value={form.asin} onChange={(event) => setForm((current) => ({ ...current, asin: event.target.value.toUpperCase() }))} /></Field>
          <Field label="产品名称"><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
          <SelectField label="状态" value={form.status} options={asOptions([{ value: "active", label: "在售" }, { value: "watch", label: "观察" }])} onChange={(value) => setForm((current) => ({ ...current, status: value }))} />
        </div>
      </Modal>
    </WorkspacePageFrame>
  );
}

function Targets({ store, command, onNavigate, onInspect }) {
  const product = currentProduct(store);
  const versions = entities(store, "targetVersions").filter((row) => !product || row.productId === entityId(product));
  const seed = product?.targets ?? product?.target ?? {};
  const [form, setForm] = useState({
    currentPrice: seed.currentPrice ?? product?.price ?? "",
    minPrice: seed.minPrice ?? "",
    targetAcos: seed.targetAcos ?? "",
    targetTacos: seed.targetTacos ?? "",
    targetNetMargin: seed.targetNetMargin ?? "",
  });
  const [feedback, setFeedback] = useState(null);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const save = () => invoke(command, "saveProductTargets", { productId: entityId(product), targets: form, expectedRevision: product?.revision }, setFeedback);
  if (!product) return <WorkspacePageFrame title="量化目标" description="先选择一个产品，再维护广告与利润边界。" task={<TaskBanner tone="warning" title="尚未锁定产品" detail="目标必须绑定当前店铺和产品。" />} actions={<Button onClick={() => onNavigate("product", "products")}>选择产品</Button>}><EmptyState title="没有当前产品" detail="前往产品列表锁定一个产品。" /></WorkspacePageFrame>;
  return (
    <WorkspacePageFrame
      eyebrow={`TARGET CONTRACT · ${product.sku ?? product.asin}`}
      title="量化目标"
      description="目标和成本是诊断、建议与自动边界的共同计算基准。"
      task={<TaskBanner tone="info" title="复核本产品的目标与利润底线" detail="保存会创建新版本，不会覆盖历史目标。" />}
      actions={<Button variant="primary" icon={FloppyDisk} onClick={save}>保存新版本</Button>}
    >
      <SummaryStrip items={[
        { label: "当前售价", value: money(form.currentPrice, store), detail: product.sku },
        { label: "目标 ACOS", value: percent(form.targetAcos), detail: "广告效率" },
        { label: "目标 TACOS", value: percent(form.targetTacos), detail: "全店依赖度" },
        { label: "版本", value: `v${product.targetRevision ?? versions.length + 1}`, detail: `${versions.length} 个历史版本` },
      ]} />
      <Feedback value={feedback} />
      <Panel title="目标与成本" meta={`${storeId(store)} · ${product.asin}`} tone="primary">
        <div className="form-grid form-grid--numeric">
          <Field label="当前售价" hint="用于利润测算"><input inputMode="decimal" value={form.currentPrice} onChange={(event) => update("currentPrice", event.target.value)} /></Field>
          <Field label="最低可接受价" hint="建议不得低于此值"><input inputMode="decimal" value={form.minPrice} onChange={(event) => update("minPrice", event.target.value)} /></Field>
          <Field label="目标 ACOS"><input inputMode="decimal" value={form.targetAcos} onChange={(event) => update("targetAcos", event.target.value)} /></Field>
          <Field label="目标 TACOS"><input inputMode="decimal" value={form.targetTacos} onChange={(event) => update("targetTacos", event.target.value)} /></Field>
          <Field label="目标净利率"><input inputMode="decimal" value={form.targetNetMargin} onChange={(event) => update("targetNetMargin", event.target.value)} /></Field>
        </div>
      </Panel>
      <Panel title="目标版本历史" meta="不可变记录">
        {versions.length ? <DataTable columns={[
          { key: "versionNumber", label: "版本", render: (value) => `v${value ?? 1}` },
          { key: "createdAt", label: "创建时间", render: (value) => formatDateTime(value) },
          { key: "targetAcos", label: "目标 ACOS", render: (value) => percent(value) },
          { key: "targetNetMargin", label: "目标净利率", render: (value) => percent(value) },
          { key: "actions", label: "操作", render: (_value, row) => <InspectButton onClick={() => invoke(command, "restoreProductTargetVersion", { productId: entityId(product), versionId: entityId(row) }, setFeedback)}>恢复为新版本</InspectButton> },
        ]} rows={versions} rowKey="id" onRowClick={(row) => openInspector(onInspect, "target-version", row)} /> : <SectionEmpty title="还没有历史版本" detail="首次保存后会保留完整版本记录。" />}
      </Panel>
    </WorkspacePageFrame>
  );
}

function Events({ store, command, onInspect }) {
  const rows = entities(store, "events");
  const [dialog, setDialog] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [form, setForm] = useState({ type: "促销", occurredAt: nowLocal(), title: "", description: "", impact: "material" });
  const openForm = (row = null) => {
    setForm({ type: row?.type ?? "促销", occurredAt: (row?.occurredAt ?? nowLocal()).slice(0, 16), title: row?.title ?? "", description: row?.description ?? "", impact: row?.impact ?? "material" });
    setDialog({ mode: row ? "edit" : "create", row });
  };
  const save = () => {
    const result = invoke(
      command,
      dialog?.mode === "edit" ? "updateEvent" : "createEvent",
      dialog?.mode === "edit"
        ? { eventId: entityId(dialog.row), expectedRevision: dialog.row?.revision, patch: form }
        : { event: { ...form, impactLevel: form.impact } },
      setFeedback,
    );
    if (result?.ok) setDialog(null);
  };
  return (
    <WorkspacePageFrame eyebrow={`OPERATION CONTEXT · ${storeId(store)}`} title="运营事件" description="记录会改变数据解释的促销、价格、库存和人工动作。" task={<TaskBanner tone="info" title="把关键变化写进 AI 上下文" detail="作废事件会保留历史记录，但不再参与新诊断。" />} actions={<Button variant="primary" icon={Plus} onClick={() => openForm()}>新增事件</Button>}>
      <SummaryStrip items={[
        { label: "有效事件", value: `${rows.filter((row) => !row.voided && !["void", "voided"].includes(row.status)).length} 条`, detail: "进入当前上下文" },
        { label: "今日新增", value: `${rows.filter((row) => String(row.occurredAt).slice(0, 10) === new Date().toISOString().slice(0, 10)).length} 条`, detail: "当前店铺" },
        { label: "已作废", value: `${rows.filter((row) => row.voided || ["void", "voided"].includes(row.status)).length} 条`, detail: "历史保留" },
        { label: "当前产品", value: currentProduct(store)?.sku ?? "全店", detail: currentProduct(store)?.asin ?? "店铺范围" },
      ]} />
      <Feedback value={feedback} />
      <Panel title="运营事件时间轴" meta={`${rows.length} 条`} tone="primary">
        {rows.length ? <DataTable columns={[
          { key: "occurredAt", label: "发生时间", render: (value) => formatDateTime(value) },
          { key: "type", label: "类型", render: (value) => <StatusPill tone="info">{display(value)}</StatusPill> },
          { key: "title", label: "事件" },
          { key: "description", label: "影响说明", render: (value) => <span className="cell-clip" title={value}>{display(value)}</span> },
          { key: "status", label: "状态", render: (_value, row) => <StatusPill tone={row.voided || ["void", "voided"].includes(row.status) ? "neutral" : "success"}>{row.voided || ["void", "voided"].includes(row.status) ? "已作废" : "有效"}</StatusPill> },
          { key: "actions", label: "操作", render: (_value, row) => <div className="row-actions"><InspectButton onClick={() => openForm(row)}>编辑</InspectButton>{!row.voided && !["void", "voided"].includes(row.status) && <InspectButton onClick={() => invoke(command, "voidEvent", { eventId: entityId(row), expectedRevision: row.revision, reason: "运营者在原型中作废" }, setFeedback)}>作废</InspectButton>}</div> },
        ]} rows={rows} rowKey="id" onRowClick={(row) => openInspector(onInspect, "event", row)} /> : <EmptyState title="还没有运营事件" detail="记录促销、价格或库存变化，帮助诊断避免误判。" action={<Button variant="primary" icon={Plus} onClick={() => openForm()}>新增事件</Button>} />}
      </Panel>
      <Modal open={Boolean(dialog)} title={dialog?.mode === "edit" ? "编辑运营事件" : "新增运营事件"} description="事件只进入当前店铺与产品上下文。" onClose={() => setDialog(null)} actions={<><Button onClick={() => setDialog(null)}>取消</Button><Button variant="primary" disabled={!form.title.trim()} onClick={save}>保存事件</Button></>}>
        <div className="form-grid">
          <SelectField label="事件类型" value={form.type} options={asOptions(["促销", "价格", "库存", "Listing", "人工广告操作"])} onChange={(value) => setForm((current) => ({ ...current, type: value }))} />
          <Field label="发生时间"><input type="datetime-local" value={form.occurredAt} onChange={(event) => setForm((current) => ({ ...current, occurredAt: event.target.value }))} /></Field>
          <Field label="事件标题"><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></Field>
          <SelectField label="影响级别" value={form.impact} options={asOptions([{ value: "positive", label: "正向" }, { value: "material", label: "显著" }, { value: "warning", label: "风险" }])} onChange={(value) => setForm((current) => ({ ...current, impact: value }))} />
          <TextAreaField label="影响说明" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} />
        </div>
      </Modal>
    </WorkspacePageFrame>
  );
}

function Scope({ store, command, onNavigate }) {
  const scope = store?.scope ?? {};
  const products = entities(store, "products").filter((row) => !row.archived);
  const [form, setForm] = useState({
    marketplace: scope.marketplace ?? store?.config?.marketplace ?? "美国站",
    selectedProductId: scope.selectedProductId ?? entityId(products[0]),
    dateFrom: scope.dateFrom ?? "",
    dateTo: scope.dateTo ?? "",
    attribution: scope.attribution ?? "7 天点击 / 1 天浏览",
  });
  const [feedback, setFeedback] = useState(null);
  const locked = Boolean(scope.lockedAt || scope.status === "locked");
  const save = () => invoke(command, "updateScope", { patch: form, expectedRevision: scope.revision }, setFeedback);
  const lock = () => invoke(command, "lockScope", { patch: form, expectedRevision: scope.revision }, setFeedback);
  return (
    <WorkspacePageFrame eyebrow={`DATA CONTRACT · ${storeId(store)}`} title="采集范围" description="冻结店铺、产品、站点与统计窗口，确保后续事实和建议可复现。" task={<TaskBanner tone={locked ? "success" : "warning"} title={locked ? "范围已锁定" : "先确认本轮采集范围"} detail={locked ? "已锁定范围只能克隆为新版本，不能原地改写。" : "报表、导入、诊断与建议将共享同一个 scope revision。"} />} actions={<div className="page-actions"><Button onClick={save} disabled={locked} icon={FloppyDisk}>保存草稿</Button><Button variant="primary" onClick={lock} disabled={locked || !form.selectedProductId || !form.dateFrom || !form.dateTo} icon={LockKey}>保存并锁定</Button></div>}>
      <SummaryStrip items={[
        { label: "店铺", value: storeId(store), detail: store?.config?.name ?? "当前店铺", tone: "success" },
        { label: "产品", value: products.find((row) => entityId(row) === form.selectedProductId)?.sku ?? "未选择", detail: products.find((row) => entityId(row) === form.selectedProductId)?.asin ?? "—" },
        { label: "统计窗口", value: form.dateFrom && form.dateTo ? `${form.dateFrom.slice(5)} → ${form.dateTo.slice(5)}` : "未设置", detail: form.attribution },
        { label: "Scope revision", value: `r${scope.revision ?? 1}`, detail: locked ? "已锁定" : "草稿", tone: locked ? "success" : "warning" },
      ]} />
      <Feedback value={feedback} />
      <Panel title="采集与分析范围" meta={scope.id ?? "新范围"} tone="primary">
        <fieldset className="form-grid" disabled={locked}>
          <Field label="店铺"><input readOnly value={`${storeId(store)} · ${store?.config?.name ?? ""}`} /></Field>
          <SelectField label="Amazon 站点" value={form.marketplace} options={asOptions(["美国站", "加拿大站", "英国站"])} onChange={(value) => setForm((current) => ({ ...current, marketplace: value }))} />
          <SelectField label="产品" value={form.selectedProductId} options={products.map((row) => ({ value: entityId(row), label: `${row.sku ?? row.asin} · ${row.asin ?? ""}` }))} onChange={(value) => setForm((current) => ({ ...current, selectedProductId: value }))} />
          <Field label="开始日期"><input type="date" value={form.dateFrom} onChange={(event) => setForm((current) => ({ ...current, dateFrom: event.target.value }))} /></Field>
          <Field label="结束日期"><input type="date" value={form.dateTo} onChange={(event) => setForm((current) => ({ ...current, dateTo: event.target.value }))} /></Field>
          <SelectField label="归因窗口" value={form.attribution} options={asOptions(["7 天点击 / 1 天浏览", "14 天点击", "30 天点击"])} onChange={(value) => setForm((current) => ({ ...current, attribution: value }))} />
        </fieldset>
      </Panel>
      {!products.length && <InlineFeedback tone="danger">当前店铺没有可用产品，无法锁定范围。</InlineFeedback>}
      {locked && <Panel title="下一步" meta="范围已冻结"><div className="next-action-row"><span><b>采集领星广告报表</b><small>所有文件都将绑定 {scope.id ?? `scope-${storeId(store)}`}。</small></span><Button variant="primary" icon={ArrowRight} onClick={() => onNavigate("data", "reports")}>前往报表采集</Button></div></Panel>}
    </WorkspacePageFrame>
  );
}

function Reports({ store, command, onNavigate, onInspect }) {
  const rows = entities(store, "reports");
  const [feedback, setFeedback] = useState(null);
  const running = rows.some((row) => /running|采集中|下载中/.test(statusLabel(row)));
  const ready = rows.filter((row) => /ready|downloaded|完成|imported|已校验/.test(statusLabel(row))).length;
  return (
    <WorkspacePageFrame eyebrow={`VISIBLE LINGXING · ${storeId(store)}`} title="报表采集" description="在可见浏览器中逐类采集领星广告报表，并核对日期、店铺和文件哈希。" task={<TaskBanner tone={ready >= 8 ? "success" : running ? "info" : "warning"} title={ready >= 8 ? "8 类报表已就绪" : running ? "正在采集，保持可见窗口" : `仍需补齐 ${Math.max(8 - ready, 0)} 类报表`} detail="此处只模拟领星可见浏览器流程，不调用未授权 API。" />} actions={<div className="page-actions">{running && <Button icon={Pause} onClick={() => invoke(command, "cancelReportCollection", {}, setFeedback)}>取消采集</Button>}<Button variant="primary" icon={CloudArrowDown} disabled={running} onClick={() => invoke(command, "collectReports", {}, setFeedback)}>采集 8 类报表</Button></div>}>
      <SummaryStrip items={[
        { label: "采集进度", value: `${ready}/8`, detail: running ? "采集中" : "逐类校验", tone: ready >= 8 ? "success" : "warning" },
        { label: "数据行", value: rows.reduce((total, row) => total + Number(row.rows ?? row.rowCount ?? 0), 0).toLocaleString("zh-CN"), detail: "当前范围" },
        { label: "浏览器会话", value: store?.session?.statusLabel ?? store?.session?.status ?? "待验证", detail: store?.session?.profileId ?? store?.session?.profile ?? "独立 Profile" },
        { label: "Scope", value: store?.scope?.id ?? "未锁定", detail: `r${store?.scope?.revision ?? 1}` },
      ]} />
      <Feedback value={feedback} />
      <Panel title="8 类报表清单" meta="每类独立重试" tone="primary">
        {rows.length ? <DataTable columns={[
          { key: "label", label: "报表类型", render: (_value, row) => row.label ?? row.name ?? row.type },
          { key: "dateRange", label: "数据窗口", render: (_value, row) => row.dateRange ?? `${store?.scope?.dateFrom ?? "—"} → ${store?.scope?.dateTo ?? "—"}` },
          { key: "rows", label: "行数", render: (_value, row) => Number(row.rows ?? row.rowCount ?? 0).toLocaleString("zh-CN") },
          { key: "updatedAt", label: "最近采集", render: (value) => formatDateTime(value) },
          { key: "status", label: "状态", render: (_value, row) => <StatusPill tone={statusTone(statusLabel(row))}>{statusLabel(row)}</StatusPill> },
          { key: "actions", label: "操作", render: (_value, row) => <div className="row-actions"><InspectButton onClick={() => openInspector(onInspect, "report", row)}>详情</InspectButton>{/失败|缺失|failed|missing/.test(statusLabel(row)) && <InspectButton onClick={() => invoke(command, "retryReport", { reportId: entityId(row) }, setFeedback)}>重试</InspectButton>}</div> },
        ]} rows={rows} rowKey="id" onRowClick={(row) => openInspector(onInspect, "report", row)} /> : <EmptyState title="尚未创建采集任务" detail="先锁定工作范围，再启动 8 类报表采集。" action={<Button onClick={() => onNavigate("data", "scope")}>检查采集范围</Button>} />}
      </Panel>
      <Panel title="导入门槛" meta={ready >= 8 ? "已满足" : "未满足"}><div className="next-action-row"><span><b>{ready >= 8 ? "可以进入导入校验" : "缺失报表不会被静默跳过"}</b><small>{ready >= 8 ? "下一步将核对列、业务键和跨店铺隔离。" : "请重试失败报表，或取消后调整范围。"}</small></span><Button variant="primary" disabled={ready < 8} icon={ArrowRight} onClick={() => onNavigate("data", "import-check")}>进入导入校验</Button></div></Panel>
    </WorkspacePageFrame>
  );
}

function ImportCheck({ store, command, onNavigate, onInspect }) {
  const reports = entities(store, "reports");
  const imports = entities(store, "imports", "importRuns");
  const checks = entities(store, "importChecks", "validations");
  const [feedback, setFeedback] = useState(null);
  const ready = reports.filter((row) => /ready|downloaded|完成|imported|已校验/.test(statusLabel(row))).length;
  const blocked = ready < 8 || checks.some((row) => /阻断|failed|error/.test(statusLabel(row)));
  const latest = imports[0];
  return (
    <WorkspacePageFrame eyebrow={`IMPORT GATE · ${storeId(store)}`} title="导入校验" description="在写入本地事实库前，核对来源、列契约、业务键、店铺与产品范围。" task={<TaskBanner tone={blocked ? "danger" : latest ? "success" : "warning"} title={blocked ? "导入被完整性门槛阻断" : latest ? "最新事实批次已写入" : "事实包已达到导入门槛"} detail={blocked ? "先补齐报表或修复校验错误。" : "重复点击会返回同一个 import run，不会重复写入。"} />} actions={<div className="page-actions"><Button onClick={() => onNavigate("data", "reports")}>返回采集</Button><Button variant="primary" icon={FileArrowUp} disabled={blocked} onClick={() => invoke(command, "importReports", { reportIds: reports.map(entityId), scopeRevision: store?.scope?.revision }, setFeedback)}>导入事实库</Button></div>}>
      <SummaryStrip items={[
        { label: "待导入文件", value: `${ready}/8`, detail: "领星下载中心" },
        { label: "数据行", value: reports.reduce((sum, row) => sum + Number(row.rows ?? row.rowCount ?? 0), 0).toLocaleString("zh-CN"), detail: "去重前" },
        { label: "校验规则", value: `${checks.length || 6} 项`, detail: blocked ? "存在阻断" : "全部满足", tone: blocked ? "danger" : "success" },
        { label: "最新批次", value: latest?.id ?? "尚未导入", detail: latest ? statusLabel(latest) : "等待确认" },
      ]} />
      <Feedback value={feedback} />
      <Panel title="导入前校验" meta="严格门槛" tone="primary">
        {checks.length ? <DataTable columns={[
          { key: "rule", label: "校验规则", render: (_value, row) => row.rule ?? row.name },
          { key: "checked", label: "检查对象" },
          { key: "detail", label: "结果详情", render: (value) => <span className="cell-clip" title={value}>{display(value)}</span> },
          { key: "status", label: "状态", render: (_value, row) => <StatusPill tone={statusTone(statusLabel(row))}>{statusLabel(row)}</StatusPill> },
        ]} rows={checks} rowKey="id" onRowClick={(row) => openInspector(onInspect, "import-check", row)} /> : <div className="validation-placeholder"><ShieldCheck size={22} /><span><b>6 项基础校验将在导入时执行</b><small>店铺身份、统计窗口、必填列、重复键、ASIN 范围与报表齐套。</small></span></div>}
      </Panel>
      <Panel title="导入批次" meta="不可变记录">
        {imports.length ? <DataTable columns={[
          { key: "id", label: "批次 ID" },
          { key: "createdAt", label: "完成时间", render: (value) => formatDateTime(value) },
          { key: "rows", label: "写入行数", render: (_value, row) => Number(row.rows ?? row.importedRows ?? 0).toLocaleString("zh-CN") },
          { key: "duplicates", label: "重复 / 拒绝", render: (_value, row) => `${row.duplicates ?? row.duplicateRows ?? 0} / ${row.rejected ?? row.rejectedRows ?? 0}` },
          { key: "status", label: "状态", render: (_value, row) => <StatusPill tone={statusTone(statusLabel(row))}>{statusLabel(row)}</StatusPill> },
        ]} rows={imports} rowKey="id" onRowClick={(row) => openInspector(onInspect, "import-run", row)} /> : <SectionEmpty title="还没有导入批次" detail="完成校验后，首次导入会生成不可变事实批次。" />}
      </Panel>
    </WorkspacePageFrame>
  );
}

function Diagnosis({ store, command, onNavigate, onInspect }) {
  const rows = entities(store, "diagnostics");
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("all");
  const [feedback, setFeedback] = useState(null);
  const filtered = rows.filter((row) => (severity === "all" || String(row.severity) === severity) && `${row.objectName ?? row.object} ${row.diagnosis ?? row.signal}`.toLowerCase().includes(query.toLowerCase()));
  const selected = filtered[0];
  return (
    <WorkspacePageFrame eyebrow={`QUANT DIAGNOSIS · ${storeId(store)}`} title="量化诊断" description="从当前事实批次识别广告浪费、增长机会和数据风险。" task={<TaskBanner tone={rows.length ? "warning" : "info"} title={rows.length ? `先处理 ${rows.filter((row) => /high|高/.test(row.severity)).length} 个高优先级对象` : "运行当前范围的量化诊断"} detail="诊断只生成分析结论，不会产生任何真实 Ads 写入。" />} actions={<Button variant="primary" icon={Sparkle} onClick={() => invoke(command, "runDiagnosis", { scopeRevision: store?.scope?.revision }, setFeedback)}>运行诊断</Button>}>
      <SummaryStrip items={[
        { label: "诊断对象", value: `${rows.length} 个`, detail: currentProduct(store)?.sku ?? "当前产品" },
        { label: "高优先级", value: `${rows.filter((row) => /high|高/.test(row.severity)).length} 个`, detail: "需要运营确认", tone: "danger" },
        { label: "ACOS / 目标", value: `${percent(store?.metrics?.acos)} / ${percent(currentProduct(store)?.targets?.targetAcos ?? currentProduct(store)?.target?.targetAcos)}`, detail: "当前范围" },
        { label: "事实批次", value: store?.facts?.activeImportId ?? entities(store, "imports", "importRuns")[0]?.id ?? "未导入", detail: `scope r${store?.scope?.revision ?? 1}` },
      ]} />
      <Feedback value={feedback} />
      <Panel title="诊断结果" meta={`${filtered.length}/${rows.length} 个对象`} tone="primary" actions={<Toolbar><label className="workspace-search"><MagnifyingGlass size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索对象或信号" /></label><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">全部优先级</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></Toolbar>}>
        {rows.length ? <DataTable columns={[
          { key: "severity", label: "优先级", render: (value) => <StatusPill tone={statusTone(value)}>{display(value)}</StatusPill> },
          { key: "objectName", label: "诊断对象", render: (_value, row) => row.objectName ?? row.object },
          { key: "diagnosis", label: "核心信号", render: (_value, row) => <span className="cell-clip" title={row.diagnosis ?? row.signal}>{row.diagnosis ?? row.signal}</span> },
          { key: "spend", label: "花费", render: (value) => money(value, store) },
          { key: "acos", label: "ACOS", render: (value) => percent(value) },
          { key: "confidence", label: "置信度", render: (value) => percent(value) },
        ]} rows={filtered} rowKey="id" onRowClick={(row) => openInspector(onInspect, "diagnostic", row, { fields: [["对象", row.objectName ?? row.object], ["诊断", row.diagnosis ?? row.signal], ["建议动作", row.recommendedAction], ["事实批次", row.batchId ?? store?.facts?.activeImportId], ["置信度", percent(row.confidence)]] })} /> : <EmptyState title="当前范围还没有诊断结果" detail="先完成事实导入，再运行量化诊断。" action={<Button onClick={() => onNavigate("data", "import-check")}>检查事实批次</Button>} />}
      </Panel>
      {selected && <Panel title="诊断解释" meta={selected.id} actions={<Button icon={ArrowRight} onClick={() => onNavigate("decisions", "recommendations")}>查看建议</Button>}><div className="explanation-grid"><div><span>观察</span><p>{selected.observation ?? selected.diagnosis ?? selected.signal}</p></div><div><span>上下文</span><p>{selected.context ?? "已绑定当前店铺、产品、事实批次与运营事件。"}</p></div><div><span>下一步</span><p>{selected.recommendedAction ?? "生成建议并核对策略边界。"}</p></div></div></Panel>}
    </WorkspacePageFrame>
  );
}

function recommendationRows(store, view = "all") {
  const recommendations = entities(store, "recommendations");
  const revisions = store?.entities?.recommendationRevisions?.byId ?? {};
  const decisions = store?.entities?.decisions?.byId ?? {};
  return recommendations.map((recommendation) => {
    const revision = revisions[recommendation.currentRevisionId] ?? {};
    const decision = decisions[recommendation.decisionId] ?? null;
    return {
      ...recommendation,
      ...revision,
      id: recommendation.id,
      recommendationRevision: recommendation.revision,
      currentRevisionId: recommendation.currentRevisionId,
      status: recommendation.status,
      decision,
    };
  }).filter((row) => view === "all" || row.status === view);
}

function Recommendations({ store, command, onNavigate, onInspect }) {
  const rows = recommendationRows(store, "pending_review");
  const diagnostics = entities(store, "diagnostics");
  const [selectedIds, setSelectedIds] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [risk, setRisk] = useState("all");
  const filtered = risk === "all" ? rows : rows.filter((row) => row.risk === risk);
  const toggle = (id) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const submit = () => {
    const result = invoke(command, "submitForApproval", { recommendationIds: selectedIds }, setFeedback);
    if (result?.ok) setSelectedIds([]);
  };
  return (
    <WorkspacePageFrame eyebrow={`UNIFIED RECOMMENDATIONS · ${storeId(store)}`} title="建议队列" description="将量化诊断转成有来源、边界和版本的可判断建议。" task={<TaskBanner tone={rows.length ? "warning" : "success"} title={rows.length ? `复核 ${rows.length} 条待判断建议` : "当前没有待判断建议"} detail="重算会创建新的不可变 revision；建议本身不等于执行。" />} actions={<div className="page-actions"><Button icon={Sparkle} onClick={() => invoke(command, "generateRecommendations", { diagnosticIds: diagnostics.map(entityId) }, setFeedback)}>生成建议</Button><Button variant="primary" icon={ArrowRight} disabled={!selectedIds.length} onClick={submit}>送审 {selectedIds.length || ""}</Button></div>}>
      <SummaryStrip items={[
        { label: "待判断", value: `${rows.length} 条`, detail: "当前店铺" },
        { label: "已选择", value: `${selectedIds.length} 条`, detail: "准备送审" },
        { label: "高风险", value: `${rows.filter((row) => row.risk === "high").length} 条`, detail: "必须人工复核", tone: "danger" },
        { label: "策略版本", value: `r${store?.autonomy?.revision ?? 1}`, detail: store?.autonomy?.mode === "auto" ? "AI 全自动边界" : "人工审批模式" },
      ]} />
      <Feedback value={feedback} />
      <Panel title="待判断建议" meta={`${filtered.length}/${rows.length}`} tone="primary" actions={<Toolbar><select value={risk} onChange={(event) => setRisk(event.target.value)}><option value="all">全部风险</option><option value="high">高风险</option><option value="medium">中风险</option><option value="low">低风险</option></select></Toolbar>}>
        {rows.length ? <DataTable columns={[
          { key: "select", label: "选择", render: (_value, row) => <input aria-label={`选择 ${row.title}`} type="checkbox" checked={selectedIds.includes(row.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggle(row.id)} /> },
          { key: "risk", label: "风险", render: (value) => <StatusPill tone={statusTone(value)}>{display(value)}</StatusPill> },
          { key: "title", label: "建议动作" },
          { key: "entityId", label: "对象", render: (value) => <span className="cell-clip" title={value}>{display(value)}</span> },
          { key: "currentValue", label: "当前值", render: (value) => money(value, store) },
          { key: "recommendedValue", label: "建议值", render: (value) => money(value, store) },
          { key: "revisionNumber", label: "版本", render: (value) => `rev ${value ?? 1}` },
          { key: "actions", label: "操作", render: (_value, row) => <InspectButton onClick={() => invoke(command, "recalculateRecommendation", { recommendationId: row.id, expectedRevision: row.recommendationRevision, constraint: "降低影响" }, setFeedback)}>降低影响后重算</InspectButton> },
        ]} rows={filtered} rowKey="id" onRowClick={(row) => openInspector(onInspect, "recommendation", row, { fields: [["建议版本", row.currentRevisionId], ["当前值", money(row.currentValue, store)], ["建议值", money(row.recommendedValue, store)], ["量化依据", row.reason], ["事实批次", row.authorityBatchId], ["策略边界", JSON.stringify(row.policySnapshot ?? {})]] })} /> : <EmptyState title="当前没有待判断建议" detail="运行诊断并生成建议后会出现在这里。" action={<Button onClick={() => onNavigate("diagnosis", "analysis")}>前往诊断</Button>} />}
      </Panel>
    </WorkspacePageFrame>
  );
}

function Approval({ store, command, onNavigate, onInspect }) {
  const rows = recommendationRows(store, "pending_approval");
  const [selectedId, setSelectedId] = useState(rows[0]?.id ?? null);
  const current = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState(null);
  const confirm = () => {
    if (!current || !reason.trim()) return;
    const result = invoke(command, decision === "approve" ? "approveRecommendation" : "rejectRecommendation", {
      recommendationId: current.id,
      recommendationRevisionId: current.currentRevisionId,
      expectedRevision: current.recommendationRevision,
      reason: reason.trim(),
      actor: "prototype-operator",
    }, setFeedback);
    if (result?.ok) { setDecision(null); setReason(""); }
  };
  return (
    <WorkspacePageFrame eyebrow={`HUMAN GATE · ${storeId(store)}`} title="人工审批" description="核对事实、建议 revision、策略边界和前后值，再显式签发或拒绝模拟执行许可。" task={<TaskBanner tone={rows.length ? "danger" : "success"} title={rows.length ? `${rows.length} 条建议等待人工决定` : "当前没有待审批建议"} detail="批准只签发当前 revision 的一次性原型许可，不代表真实 Ads 已执行。" />} actions={<div className="page-actions"><Button variant="danger" disabled={!current} onClick={() => setDecision("reject")}>驳回</Button><Button disabled={!current} icon={ArrowClockwise} onClick={() => invoke(command, "recalculateRecommendation", { recommendationId: current?.id, expectedRevision: current?.recommendationRevision, constraint: "缩小调整幅度" }, setFeedback)}>降低影响后重算</Button><Button variant="primary" disabled={!current} icon={ShieldCheck} onClick={() => setDecision("approve")}>批准原型许可</Button></div>}>
      <SummaryStrip items={[
        { label: "待审批", value: `${rows.length} 条`, detail: "当前店铺" },
        { label: "高风险", value: `${rows.filter((row) => row.risk === "high").length} 条`, detail: "不能自动执行", tone: "danger" },
        { label: "当前模式", value: store?.autonomy?.mode === "auto" ? "AI 全自动" : "人工审批", detail: store?.autonomy?.paused ? "已暂停" : "运行中" },
        { label: "操作者", value: "本机运营者", detail: "原型身份" },
      ]} />
      <Feedback value={feedback} />
      <div className="workspace-two-column">
        <Panel title="待审批队列" meta={`${rows.length} 条`} tone="primary">
          {rows.length ? <div className="selection-list">{rows.map((row) => <button key={row.id} className={row.id === current?.id ? "is-selected" : ""} type="button" onClick={() => { setSelectedId(row.id); openInspector(onInspect, "recommendation", row); }}><StatusPill tone={statusTone(row.risk)}>{display(row.risk)}</StatusPill><span><b>{row.title}</b><small>{row.entityId} · rev {row.revisionNumber}</small></span><ArrowRight size={16} /></button>)}</div> : <SectionEmpty title="没有待审批建议" description="待判断建议送审后会出现在这里。" action={<Button onClick={() => onNavigate("decisions", "recommendations")}>查看建议队列</Button>} />}
        </Panel>
        <Panel title="审批事实" meta={current?.currentRevisionId ?? "未选择"} status={current ? <StatusPill tone="warning">待审批</StatusPill> : null}>
          {current ? <div className="review-stack"><div className="change-preview"><span><small>当前值</small><b>{money(current.currentValue, store)}</b></span><ArrowRight size={20} /><span><small>建议值</small><b>{money(current.recommendedValue, store)}</b></span></div><dl className="fact-list"><div><dt>建议对象</dt><dd>{current.entityId}</dd></div><div><dt>量化依据</dt><dd>{current.reason}</dd></div><div><dt>来源批次</dt><dd>{current.authorityBatchId}</dd></div><div><dt>建议 revision</dt><dd>{current.currentRevisionId}</dd></div><div><dt>执行边界</dt><dd>{current.policySnapshot?.eligible ? "策略内，但仍等待本次人工许可" : "超出自动边界"}</dd></div><div><dt>回读要求</dt><dd>模拟 before / after / reload 三段证据</dd></div></dl><InlineFeedback tone="warning" title="原型许可">不会连接或写入真实 Amazon Ads。</InlineFeedback></div> : <SectionEmpty title="请选择一条建议" description="选择后查看当前 revision 的完整审批事实。" />}
        </Panel>
      </div>
      <ConfirmDialog open={Boolean(decision)} title={decision === "approve" ? "批准本次原型执行许可" : "驳回本次建议"} description="决定原因必填，并绑定当前建议 revision。" tone={decision === "approve" ? "primary" : "danger"} confirmLabel={decision === "approve" ? "批准并签发原型许可" : "确认驳回"} onClose={() => { setDecision(null); setReason(""); }} onConfirm={confirm}>
        <div className="confirm-form"><p>{current?.title}</p><TextAreaField label="决定原因" required value={reason} onChange={setReason} placeholder="说明批准或驳回的业务依据" /></div>
      </ConfirmDialog>
    </WorkspacePageFrame>
  );
}

function Decided({ store, command, onNavigate, onInspect }) {
  const decisions = entities(store, "decisions");
  const recommendations = store?.entities?.recommendations?.byId ?? {};
  const revisions = store?.entities?.recommendationRevisions?.byId ?? {};
  const executions = store?.entities?.executions?.byId ?? {};
  const rows = decisions.map((row) => {
    const recommendation = recommendations[row.recommendationId] ?? {};
    const revision = revisions[row.recommendationRevisionId] ?? {};
    return { ...row, title: revision.title ?? recommendation.title ?? row.recommendationId, revisionNumber: revision.revisionNumber, executionStatus: statusLabel(executions[recommendation.executionId], recommendation.executionId ? "已入队" : "未入队") };
  });
  return (
    <WorkspacePageFrame eyebrow={`DECISION LEDGER · ${storeId(store)}`} title="决策账本" description="决定、建议版本和许可是不可变记录，只能查看、筛选和追溯。" task={<TaskBanner tone="success" title="历史决定已绑定建议 revision" detail="批准会产生一次性原型许可；驳回不会进入模拟执行队列。" />} actions={<Button variant="primary" icon={ArrowRight} onClick={() => onNavigate("readback", "execution")}>查看执行回读</Button>}>
      <SummaryStrip items={[
        { label: "全部决定", value: `${rows.length} 条`, detail: "当前店铺" },
        { label: "已批准", value: `${rows.filter((row) => row.outcome === "approved").length} 条`, detail: "许可已绑定", tone: "success" },
        { label: "已驳回", value: `${rows.filter((row) => row.outcome === "rejected").length} 条`, detail: "不会执行", tone: "danger" },
        { label: "待回读", value: `${rows.filter((row) => /回读|awaiting/.test(row.executionStatus)).length} 条`, detail: "模拟执行链" },
      ]} />
      <Panel title="不可变决定记录" meta="append-only" tone="primary">
        {rows.length ? <DataTable columns={[
          { key: "createdAt", label: "决定时间", render: (value) => formatDateTime(value) },
          { key: "id", label: "决定 ID" },
          { key: "outcome", label: "决定", render: (value) => <StatusPill tone={statusTone(value)}>{value === "approved" ? "批准" : "驳回"}</StatusPill> },
          { key: "title", label: "建议" },
          { key: "revisionNumber", label: "版本", render: (value) => `rev ${value ?? 1}` },
          { key: "actor", label: "决定者" },
          { key: "reason", label: "原因", render: (value) => <span className="cell-clip" title={value}>{display(value)}</span> },
          { key: "executionStatus", label: "后续状态", render: (value) => <StatusPill tone={statusTone(value)}>{display(value)}</StatusPill> },
        ]} rows={rows} rowKey="id" onRowClick={(row) => openInspector(onInspect, "decision", row, { fields: [["决定 ID", row.id], ["结果", row.outcome], ["建议 revision", row.recommendationRevisionId], ["决定者", row.actor], ["原因", row.reason], ["后续状态", row.executionStatus]] })} /> : <EmptyState title="还没有决定记录" detail="审批结果会以不可变记录保留在这里。" action={<Button onClick={() => onNavigate("decisions", "approval")}>前往人工审批</Button>} />}
      </Panel>
    </WorkspacePageFrame>
  );
}

function preflightRows(store, execution, recommendation, decision) {
  const revision = store?.entities?.recommendationRevisions?.byId?.[execution?.recommendationRevisionId];
  return [
    { id: "PF-1", gate: "店铺与浏览器 Profile", expected: `${storeId(store)} / ${store?.session?.browserProfileId}`, actual: execution?.browserProfileId ?? "未入队", pass: Boolean(execution && execution.browserProfileId === store?.session?.browserProfileId) },
    { id: "PF-2", gate: "可见会话", expected: "ready", actual: store?.session?.status ?? "unknown", pass: store?.session?.status === "ready" },
    { id: "PF-3", gate: "建议与 revision", expected: execution?.recommendationRevisionId ?? "—", actual: recommendation?.currentRevisionId ?? "—", pass: Boolean(execution && recommendation?.currentRevisionId === execution.recommendationRevisionId) },
    { id: "PF-4", gate: "一次性许可", expected: "approved decision", actual: decision?.outcome ?? "未签发", pass: decision?.outcome === "approved" && decision?.recommendationRevisionId === execution?.recommendationRevisionId },
    { id: "PF-5", gate: "当前值", expected: display(revision?.currentValue), actual: display(execution?.beforeValue), pass: Boolean(execution && String(revision?.currentValue) === String(execution?.beforeValue)) },
    { id: "PF-6", gate: "Kill switch", expected: "未暂停", actual: store?.autonomy?.paused ? "已暂停" : "未暂停", pass: !store?.autonomy?.paused },
    { id: "PF-7", gate: "幂等", expected: "同 revision 无活动执行", actual: execution ? `run ${execution.id}` : "待入队", pass: Boolean(execution && execution.status === "queued") },
  ].map((row) => ({ ...row, result: row.pass ? "通过" : "阻断" }));
}

function ExecutionReadback({ store, command, onNavigate, onInspect }) {
  const executions = entities(store, "executions");
  const readbacks = entities(store, "readbacks");
  const evidence = entities(store, "evidence");
  const approved = recommendationRows(store, "approved");
  const [selectedId, setSelectedId] = useState(executions.find((row) => row.status !== "verified")?.id ?? executions[0]?.id ?? null);
  const selected = executions.find((row) => row.id === selectedId) ?? executions[0] ?? null;
  const selectedRecommendation = selected ? store?.entities?.recommendations?.byId?.[selected.recommendationId] : null;
  const selectedDecision = selectedRecommendation ? store?.entities?.decisions?.byId?.[selectedRecommendation.decisionId] : null;
  const readback = readbacks.find((row) => row.executionId === selected?.id) ?? null;
  const attached = readback ? evidence.filter((item) => readback.evidenceIds?.includes(item.id) && item.status === "attached") : [];
  const evidenceByType = Object.fromEntries(attached.map((item) => [item.type, item]));
  const gates = preflightRows(store, selected, selectedRecommendation, selectedDecision);
  const preflightPassed = gates.every((row) => row.pass);
  const [feedback, setFeedback] = useState(null);
  const [reloadValue, setReloadValue] = useState(readback?.reloadValue ?? readback?.savedValue ?? "");
  const enqueue = (row) => invoke(command, "queueExecution", { recommendationId: row.id }, setFeedback);
  const simulate = () => invoke(command, "runSimulatedExecution", { executionId: selected.id, expectedRevision: selected.revision }, setFeedback);
  const attach = (type) => invoke(command, "attachEvidence", { readbackId: readback.id, evidenceType: type, origin: "prototype", filename: `${type}-${readback.id}.png` }, setFeedback);
  const setReload = () => invoke(command, "setReloadValue", { readbackId: readback.id, reloadValue, storeIdentityVerified: true }, setFeedback);
  const verify = () => invoke(command, "verifyReadback", { readbackId: readback.id, expectedRevision: readback.revision }, setFeedback);
  return (
    <WorkspacePageFrame eyebrow={`SIMULATED EXECUTION · ${storeId(store)}`} title="执行与回读" description="对已批准动作执行预检、原型模拟写入和 before / after / reload 证据校验。" task={<TaskBanner tone="danger" eyebrow="原型安全边界" title="所有执行与证据均为模拟" detail="不会打开、修改或写入真实 Amazon Ads，也不能用于正式 READY 证明。" />} actions={<div className="page-actions"><Button icon={Pause} onClick={() => invoke(command, "pauseExecution", { reason: "运营者暂停原型队列" }, setFeedback)}>暂停原型队列</Button>{selected?.status === "queued" && <Button variant="primary" icon={Play} disabled={!preflightPassed} onClick={simulate}>开始模拟执行</Button>}</div>}>
      <SummaryStrip items={[
        { label: "已批准待入队", value: `${approved.filter((row) => !row.executionId).length} 个`, detail: "一次性原型许可" },
        { label: "执行队列", value: `${executions.length} 个`, detail: `${executions.filter((row) => row.status === "queued").length} 个可预检` },
        { label: "等待回读", value: `${readbacks.filter((row) => row.status === "waiting").length} 个`, detail: "模拟 reload" },
        { label: "已验证", value: `${readbacks.filter((row) => row.status === "verified").length} 个`, detail: "仅原型验证", tone: "info" },
      ]} />
      <Feedback value={feedback} />
      {approved.some((row) => !row.executionId) && <Panel title="已批准，等待进入原型队列" meta="不会写入真实 Ads" tone="primary"><div className="action-list">{approved.filter((row) => !row.executionId).map((row) => <div key={row.id}><span><b>{row.title}</b><small>{row.currentRevisionId} · {row.entityId}</small></span><Button onClick={() => enqueue(row)} icon={ArrowRight}>加入模拟队列</Button></div>)}</div></Panel>}
      <Panel title="模拟执行队列" meta={`${executions.length} 个动作`} tone="primary">
        {executions.length ? <DataTable columns={[
          { key: "id", label: "Run ID" },
          { key: "entityId", label: "Amazon 对象" },
          { key: "beforeValue", label: "Before", render: (value) => display(value) },
          { key: "intendedValue", label: "目标值", render: (value) => display(value) },
          { key: "status", label: "状态", render: (value) => <StatusPill tone={statusTone(value)}>{display(value)}</StatusPill> },
          { key: "mode", label: "性质", render: () => <StatusPill tone="info">仅原型模拟</StatusPill> },
        ]} rows={executions} rowKey="id" selectedId={selected?.id} onRowClick={(row) => { setSelectedId(row.id); openInspector(onInspect, "execution", row); }} /> : <EmptyState title="没有模拟执行动作" detail="先批准一条建议，再把许可绑定到执行队列。" action={<Button onClick={() => onNavigate("decisions", "approval")}>前往审批</Button>} />}
      </Panel>
      {selected && <>
        <Panel title="执行前预检" meta={selected.id} status={<StatusPill tone={preflightPassed ? "success" : "danger"}>{preflightPassed ? "可模拟执行" : "存在阻断"}</StatusPill>}>
          <DataTable columns={[
            { key: "gate", label: "预检项" },
            { key: "expected", label: "要求" },
            { key: "actual", label: "当前" },
            { key: "result", label: "状态", render: (value) => <StatusPill tone={statusTone(value)}>{display(value)}</StatusPill> },
          ]} rows={gates} rowKey="id" />
        </Panel>
        {readback && <Panel title="模拟回读证据链" meta={readback.id} status={<StatusPill tone="info">不能用于正式 READY</StatusPill>}>
          <div className="evidence-grid">{["before", "after", "reload"].map((type) => <button className={evidenceByType[type] ? "evidence-slot is-complete" : "evidence-slot"} key={type} type="button" onClick={() => attach(type)}><UploadSimple size={22} /><span><b>{type.toUpperCase()}</b><small>{evidenceByType[type] ? `${evidenceByType[type].filename} · ${String(evidenceByType[type].sha256).slice(0, 18)}…` : "附加原型模拟截图"}</small></span><StatusPill tone={evidenceByType[type] ? "success" : "warning"}>{evidenceByType[type] ? "已附加" : "待附加"}</StatusPill></button>)}</div>
          <div className="reload-entry"><Field label="模拟 reload 页面值" hint={`保存值：${display(readback.savedValue)}`}><input value={reloadValue} onChange={(event) => setReloadValue(event.target.value)} /></Field><Button icon={Check} onClick={setReload}>记录 reload 与店铺身份</Button><Button variant="primary" icon={ShieldCheck} onClick={verify}>验证模拟回读</Button></div>
          <InlineFeedback tone={readback.status === "verified" ? "success" : "warning"} title={readback.status === "verified" ? "模拟回读已验证" : "等待完整证据"}>Authority、店铺身份、3 段证据和值匹配全部通过后才会结束。</InlineFeedback>
        </Panel>}
      </>}
    </WorkspacePageFrame>
  );
}

function Keywords({ store, command, onNavigate, onInspect }) {
  const rows = entities(store, "keywords");
  const draft = entities(store, "listingDrafts").find((row) => row.productId === store?.scope?.selectedProductId && row.status !== "archived");
  const [query, setQuery] = useState("");
  const [onlyCandidates, setOnlyCandidates] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const filtered = rows.filter((row) => `${row.keyword} ${row.source}`.toLowerCase().includes(query.toLowerCase()) && (!onlyCandidates || row.state === "candidate"));
  const toggle = (row) => invoke(command, row.state === "included" ? "removeFromListing" : "sendToListing", { keywordId: row.id, draftId: draft?.id, productId: store?.scope?.selectedProductId }, setFeedback);
  return (
    <WorkspacePageFrame eyebrow={`SEARCH TERM OPPORTUNITY · ${storeId(store)}`} title="关键词机会" description="筛选真实广告搜索词，并把有价值的词纳入当前 Listing 草稿候选池。" task={<TaskBanner tone="info" title="优先处理高相关且有订单的候选词" detail="纳入或移除只更新本地 Listing 草稿，不会修改真实 Amazon Listing。" />} actions={<Button variant="primary" icon={ArrowRight} onClick={() => onNavigate("growth", "listing")}>进入 Listing 优化</Button>}>
      <SummaryStrip items={[
        { label: "关键词", value: `${rows.length} 个`, detail: "当前产品" },
        { label: "候选", value: `${rows.filter((row) => row.state === "candidate").length} 个`, detail: "待判断" },
        { label: "已纳入", value: `${rows.filter((row) => row.state === "included").length} 个`, detail: "本地草稿", tone: "success" },
        { label: "已排除", value: `${rows.filter((row) => row.state === "excluded").length} 个`, detail: "低意向" },
      ]} />
      <Feedback value={feedback} />
      <Panel title="关键词机会表" meta={`${filtered.length}/${rows.length}`} tone="primary" actions={<Toolbar><label className="workspace-search"><MagnifyingGlass size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索关键词" /></label><label className="compact-check"><input type="checkbox" checked={onlyCandidates} onChange={(event) => setOnlyCandidates(event.target.checked)} />只看候选</label></Toolbar>}>
        {rows.length ? <DataTable columns={[
          { key: "keyword", label: "关键词" },
          { key: "source", label: "来源" },
          { key: "priority", label: "优先级", render: (value) => <StatusPill tone={statusTone(value)}>{display(value)}</StatusPill> },
          { key: "searchVolume", label: "月搜索量", render: (value) => Number(value ?? 0).toLocaleString("zh-CN") },
          { key: "orders", label: "订单" },
          { key: "acos", label: "广告 ACOS", render: (value) => value == null ? "—" : percent(value) },
          { key: "state", label: "覆盖状态", render: (value) => <StatusPill tone={statusTone(value)}>{display(value)}</StatusPill> },
          { key: "actions", label: "操作", render: (_value, row) => row.state === "excluded" ? <span className="muted-copy">已排除</span> : <InspectButton onClick={() => toggle(row)}>{row.state === "included" ? "移出 Listing" : "纳入 Listing"}</InspectButton> },
        ]} rows={filtered} rowKey="id" onRowClick={(row) => openInspector(onInspect, "keyword", row)} /> : <EmptyState title="当前没有关键词机会" detail="完成诊断后会从搜索词与关键词报表生成机会池。" action={<Button onClick={() => onNavigate("diagnosis", "analysis")}>运行诊断</Button>} />}
      </Panel>
    </WorkspacePageFrame>
  );
}

function Listing({ store, command, onNavigate, onInspect }) {
  const product = currentProduct(store);
  const drafts = entities(store, "listingDrafts").filter((row) => row.productId === entityId(product));
  const versions = entities(store, "listingVersions").filter((row) => row.productId === entityId(product));
  const activeDraft = drafts.find((row) => row.status !== "archived") ?? null;
  const [draftId, setDraftId] = useState(activeDraft?.id ?? null);
  const selectedDraft = drafts.find((row) => row.id === draftId) ?? activeDraft;
  const [form, setForm] = useState({ title: selectedDraft?.title ?? product?.title ?? "", bullets: selectedDraft?.bullets ?? ["", "", ""], backendTerms: selectedDraft?.backendTerms ?? "" });
  const [feedback, setFeedback] = useState(null);
  const updateBullet = (index, value) => setForm((current) => ({ ...current, bullets: current.bullets.map((item, itemIndex) => itemIndex === index ? value : item) }));
  const create = () => invoke(command, "createListingDraft", { productId: entityId(product), title: product?.title, bullets: ["", "", ""], backendTerms: "" }, setFeedback);
  const save = () => invoke(command, "saveListingDraft", { draftId: selectedDraft?.id, expectedRevision: selectedDraft?.revision, patch: form }, setFeedback);
  const saveVersion = () => invoke(command, "saveListingVersion", { draftId: selectedDraft?.id, expectedRevision: selectedDraft?.revision, note: "运营者保存原型版本" }, setFeedback);
  if (!product) return <WorkspacePageFrame title="Listing 优化" description="先锁定一个产品。" task={<TaskBanner tone="warning" title="尚未选择产品" detail="Listing 草稿必须属于当前店铺和产品。" />}><EmptyState title="没有当前产品" action={<Button onClick={() => onNavigate("product", "products")}>选择产品</Button>} /></WorkspacePageFrame>;
  return (
    <WorkspacePageFrame eyebrow={`LOCAL LISTING · ${storeId(store)}`} title="Listing 优化" description="编辑、保存、比较和恢复本地 Listing 版本；全程不提交 Amazon。" task={<TaskBanner tone="warning" title="仅本地原型草稿" detail="需要人工核对品牌语气、事实声明和字符限制，不会覆盖领星或 Amazon。" />} actions={<div className="page-actions">{!selectedDraft && <Button icon={Plus} onClick={create}>创建草稿</Button>}<Button icon={FloppyDisk} disabled={!selectedDraft} onClick={save}>保存草稿</Button><Button variant="primary" icon={Check} disabled={!selectedDraft} onClick={saveVersion}>保存版本</Button></div>}>
      <SummaryStrip items={[
        { label: "当前产品", value: product.sku, detail: product.asin },
        { label: "本地草稿", value: `${drafts.filter((row) => row.status !== "archived").length} 个`, detail: "可编辑" },
        { label: "版本历史", value: `${versions.length} 个`, detail: "不可变" },
        { label: "发布权限", value: "无", detail: "仅本地导出", tone: "warning" },
      ]} />
      <Feedback value={feedback} />
      {selectedDraft ? <div className="workspace-two-column listing-workspace">
        <Panel title="草稿版本" meta={`${drafts.length} 个`} tone="primary"><div className="selection-list">{drafts.map((row) => <button className={row.id === selectedDraft.id ? "is-selected" : ""} key={row.id} type="button" onClick={() => { setDraftId(row.id); setForm({ title: row.title, bullets: row.bullets, backendTerms: row.backendTerms }); }}><StatusPill tone={statusTone(row.status)}>{display(row.status)}</StatusPill><span><b>{row.id}</b><small>rev {row.revision} · {formatDateTime(row.updatedAt)}</small></span></button>)}</div></Panel>
        <Panel title="本地 Listing 草稿" meta={`rev ${selectedDraft.revision}`} status={<StatusPill tone="info">未发布</StatusPill>}>
          <div className="listing-editor"><TextAreaField label="标题" hint={`${form.title.length}/200`} rows={3} maxLength={200} value={form.title} onChange={(value) => setForm((current) => ({ ...current, title: value }))} />{form.bullets.map((bullet, index) => <TextAreaField key={index} label={`五点 ${index + 1}`} hint={`${bullet.length}/500`} rows={3} maxLength={500} value={bullet} onChange={(value) => updateBullet(index, value)} />)}<TextAreaField label="后台搜索词" rows={3} value={form.backendTerms} onChange={(value) => setForm((current) => ({ ...current, backendTerms: value }))} /></div>
          <div className="panel-inline-actions"><Button variant="danger" icon={Archive} onClick={() => invoke(command, "archiveListingDraft", { draftId: selectedDraft.id, reason: "运营者归档原型草稿" }, setFeedback)}>归档草稿</Button></div>
        </Panel>
      </div> : <EmptyState title="当前产品没有可编辑草稿" detail="创建本地草稿后即可编辑并保留版本历史。" action={<Button variant="primary" icon={Plus} onClick={create}>创建草稿</Button>} />}
      <Panel title="不可变版本历史" meta={`${versions.length} 个版本`}>
        {versions.length ? <DataTable columns={[
          { key: "versionNumber", label: "版本", render: (value) => `v${value}` },
          { key: "createdAt", label: "保存时间", render: (value) => formatDateTime(value) },
          { key: "title", label: "标题", render: (value) => <span className="cell-clip" title={value}>{value}</span> },
          { key: "note", label: "备注" },
          { key: "actions", label: "操作", render: (_value, row) => <InspectButton onClick={() => invoke(command, "restoreListingVersion", { versionId: row.id }, setFeedback)}>恢复为新草稿</InspectButton> },
        ]} rows={versions} rowKey="id" onRowClick={(row) => openInspector(onInspect, "listing-version", row)} /> : <SectionEmpty title="还没有保存版本" description="保存版本后可随时比较并恢复为新草稿。" />}
      </Panel>
    </WorkspacePageFrame>
  );
}

function Settings({ store, command }) {
  const [form, setForm] = useState({
    provider: store?.config?.aiProvider ?? store?.settings?.aiProvider ?? "OpenAI-compatible",
    model: store?.config?.aiModel ?? store?.settings?.aiModel ?? "gpt-5.4",
    temperature: store?.config?.temperature ?? store?.settings?.temperature ?? 0.1,
    maxBidChange: store?.autonomy?.bidChangeLimitPercent ?? 15,
    maxBudgetChange: store?.autonomy?.budgetChangeLimitPercent ?? 20,
    pauseNeedsApproval: store?.autonomy?.pauseAlwaysNeedsApproval ?? true,
  });
  const [feedback, setFeedback] = useState(null);
  const save = () => invoke(command, "saveAiSettings", { settings: form }, setFeedback);
  const setMode = (mode) => invoke(command, "setMode", { mode, reason: "系统设置中切换原型模式" }, setFeedback);
  const togglePause = () => invoke(command, "killSwitch", { active: !store?.autonomy?.paused, reason: "运营者在原型中切换 kill switch" }, setFeedback);
  return (
    <WorkspacePageFrame eyebrow={`STORE POLICY · ${storeId(store)}`} title="系统设置" description="配置 AI 连接、店铺级自动边界、执行模式与 kill switch。" task={<TaskBanner tone={store?.autonomy?.paused ? "danger" : "info"} title={store?.autonomy?.paused ? "本店原型执行已暂停" : "复核本店 AI 与执行边界"} detail="模式和规则按店铺隔离；任何模拟执行仍需通过许可、会话和回读门槛。" />} actions={<Button variant="primary" icon={FloppyDisk} onClick={save}>保存 AI 与规则</Button>}>
      <SummaryStrip items={[
        { label: "执行模式", value: store?.autonomy?.mode === "auto" ? "AI 全自动" : "人工审批", detail: "仅原型模拟" },
        { label: "竞价边界", value: `±${form.maxBidChange}%`, detail: "单次动作" },
        { label: "预算边界", value: `±${form.maxBudgetChange}%`, detail: "超出转人工" },
        { label: "Kill switch", value: store?.autonomy?.paused ? "已启用" : "未启用", detail: store?.autonomy?.killSwitchReason ?? "运行中", tone: store?.autonomy?.paused ? "danger" : "success" },
      ]} />
      <Feedback value={feedback} />
      <div className="workspace-two-column">
        <Panel title="AI 连接" meta="本地原型配置" tone="primary"><div className="form-grid"><SelectField label="Provider" value={form.provider} options={asOptions(["OpenAI-compatible", "Anthropic-compatible", "Local model"])} onChange={(value) => setForm((current) => ({ ...current, provider: value }))} /><Field label="模型"><input value={form.model} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} /></Field><Field label="Temperature"><input inputMode="decimal" value={form.temperature} onChange={(event) => setForm((current) => ({ ...current, temperature: event.target.value }))} /></Field></div></Panel>
        <Panel title="执行模式" meta="店铺级" status={<StatusPill tone={store?.autonomy?.paused ? "danger" : "warning"}>{store?.autonomy?.paused ? "已暂停" : "受控"}</StatusPill>}><div className="mode-choice"><button className={store?.autonomy?.mode === "review" ? "is-active" : ""} type="button" onClick={() => setMode("review")}><b>人工审批</b><small>任何原型写入都需人工理由与许可</small></button><button className={store?.autonomy?.mode === "auto" ? "is-active" : ""} type="button" onClick={() => setMode("auto")}><b>AI 全自动</b><small>仅策略内低风险动作可生成原型许可</small></button></div><Button variant={store?.autonomy?.paused ? "primary" : "danger"} icon={store?.autonomy?.paused ? Play : Pause} onClick={togglePause}>{store?.autonomy?.paused ? "解除 Kill switch" : "暂停本店原型执行"}</Button></Panel>
      </div>
      <Panel title="自动执行边界" meta={`policy r${store?.autonomy?.revision ?? 1}`}><div className="form-grid"><Field label="竞价单次变化"><input inputMode="numeric" value={form.maxBidChange} onChange={(event) => setForm((current) => ({ ...current, maxBidChange: event.target.value }))} /></Field><Field label="预算单次变化"><input inputMode="numeric" value={form.maxBudgetChange} onChange={(event) => setForm((current) => ({ ...current, maxBudgetChange: event.target.value }))} /></Field><Field label="暂停动作"><label className="switch-row"><input type="checkbox" checked={form.pauseNeedsApproval} onChange={(event) => setForm((current) => ({ ...current, pauseNeedsApproval: event.target.checked }))} /><span>始终要求人工审批</span></label></Field></div></Panel>
    </WorkspacePageFrame>
  );
}

function Scheduler({ store, command, onInspect }) {
  const rows = entities(store, "schedules");
  const runs = entities(store, "scheduleRuns");
  const [dialog, setDialog] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [form, setForm] = useState({ name: "", kind: "collection", cron: "30 8 * * *", timezone: store?.config?.timezone ?? store?.settings?.timezone ?? "Asia/Shanghai" });
  const openForm = (row = null, duplicate = false) => { setForm({ name: duplicate ? `${row.name} 副本` : row?.name ?? "", kind: row?.kind ?? "collection", cron: row?.cron ?? "30 8 * * *", timezone: row?.timezone ?? store?.config?.timezone ?? store?.settings?.timezone ?? "Asia/Shanghai" }); setDialog({ mode: row && !duplicate ? "edit" : "create", row }); };
  const save = () => { const result = invoke(command, dialog?.mode === "edit" ? "updateSchedule" : "createSchedule", dialog?.mode === "edit" ? { scheduleId: dialog.row.id, expectedRevision: dialog.row.revision, patch: form } : { schedule: form }, setFeedback); if (result?.ok) setDialog(null); };
  return (
    <WorkspacePageFrame eyebrow={`LOCAL SCHEDULER · ${storeId(store)}`} title="定时任务" description="编排采集、诊断和回读任务；每个运行都保留独立 run id。" task={<TaskBanner tone="info" title="检查下一次任务与最近运行结果" detail="失败可重试，部分完成不会被伪装成成功。" />} actions={<Button variant="primary" icon={Plus} onClick={() => openForm()}>新增定时任务</Button>}>
      <SummaryStrip items={[
        { label: "已启用", value: `${rows.filter((row) => row.status === "enabled").length} 个`, detail: `共 ${rows.length} 个` },
        { label: "已暂停", value: `${rows.filter((row) => row.status === "paused").length} 个`, detail: "可恢复" },
        { label: "最近运行", value: `${runs.length} 次`, detail: runs[0]?.status ?? "暂无" },
        { label: "并发策略", value: "店铺串行", detail: "避免 Profile 竞争" },
      ]} />
      <Feedback value={feedback} />
      <Panel title="任务计划" meta={`${rows.length} 个`} tone="primary">
        {rows.length ? <DataTable columns={[
          { key: "name", label: "任务" },
          { key: "kind", label: "类型" },
          { key: "cron", label: "触发规则" },
          { key: "timezone", label: "时区" },
          { key: "status", label: "状态", render: (value) => <StatusPill tone={statusTone(value)}>{display(value)}</StatusPill> },
          { key: "actions", label: "操作", render: (_value, row) => <div className="row-actions"><InspectButton onClick={() => openForm(row)}>编辑</InspectButton><InspectButton onClick={() => openForm(row, true)}>复制</InspectButton><InspectButton onClick={() => invoke(command, "toggleSchedule", { scheduleId: row.id, enabled: row.status !== "enabled" }, setFeedback)}>{row.status === "enabled" ? "暂停" : "启用"}</InspectButton><InspectButton onClick={() => invoke(command, "runScheduleNow", { scheduleId: row.id }, setFeedback)}>立即运行</InspectButton><InspectButton onClick={() => invoke(command, "deleteSchedule", { scheduleId: row.id, reason: "运营者归档原型任务" }, setFeedback)}>归档</InspectButton></div> },
        ]} rows={rows} rowKey="id" onRowClick={(row) => openInspector(onInspect, "schedule", row)} minWidth={980} /> : <EmptyState title="还没有定时任务" detail="创建首个采集、诊断或回读任务。" action={<Button variant="primary" icon={Plus} onClick={() => openForm()}>新增任务</Button>} />}
      </Panel>
      <Panel title="运行历史" meta="durable run id"><DataTable columns={[
        { key: "startedAt", label: "开始时间", render: (value) => formatDateTime(value) },
        { key: "scheduleId", label: "任务 ID" },
        { key: "id", label: "Run ID" },
        { key: "summary", label: "结果摘要" },
        { key: "status", label: "状态", render: (value) => <StatusPill tone={statusTone(value)}>{display(value)}</StatusPill> },
      ]} rows={runs} rowKey="id" empty="尚无运行历史" onRowClick={(row) => openInspector(onInspect, "schedule-run", row)} /></Panel>
      <Modal open={Boolean(dialog)} title={dialog?.mode === "edit" ? "编辑定时任务" : "新增定时任务"} description="任务只在当前店铺数据舱中运行。" onClose={() => setDialog(null)} actions={<><Button onClick={() => setDialog(null)}>取消</Button><Button variant="primary" disabled={!form.name.trim() || !form.cron.trim()} onClick={save}>保存任务</Button></>}><div className="form-grid"><Field label="任务名称"><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field><SelectField label="任务类型" value={form.kind} options={asOptions([{ value: "collection", label: "报表采集" }, { value: "diagnosis", label: "量化诊断" }, { value: "readback", label: "执行回读" }])} onChange={(value) => setForm((current) => ({ ...current, kind: value }))} /><Field label="触发规则"><input value={form.cron} onChange={(event) => setForm((current) => ({ ...current, cron: event.target.value }))} /></Field><Field label="时区"><input value={form.timezone} onChange={(event) => setForm((current) => ({ ...current, timezone: event.target.value }))} /></Field></div></Modal>
    </WorkspacePageFrame>
  );
}

function Delivery({ store, onInspect }) {
  const checks = store?.delivery?.checks ?? [
    { id: "DLV-1", gate: "V2 交互原型构建", evidence: "本地 Vite build", status: "pending" },
    { id: "DLV-2", gate: "17 子视图交互", evidence: "需要逐页运行验收", status: "pending" },
    { id: "DLV-3", gate: "跨店铺隔离", evidence: "SHC001 / LMX002 / NOC003", status: "pending" },
    { id: "DLV-4", gate: "真实 Ads 执行回读", evidence: "原型不提供真实证据", status: "blocked" },
  ];
  const [feedback, setFeedback] = useState(null);
  const passed = checks.filter((row) => /passed|通过/.test(statusLabel(row))).length;
  const runPrototypeCheck = () => setFeedback({
    tone: "success",
    message: `已重新读取 ${checks.length} 项原型门槛；真实 Ads 回读仍保持阻断。`,
  });
  const exportPrototype = () => {
    const payload = {
      artifactType: "INTERACTIVE_PROTOTYPE_ONLY",
      productionReady: false,
      realAdsWriteEvidence: false,
      storeId: storeId(store),
      exportedAt: new Date().toISOString(),
      checks,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `amazon-ai-ops-${storeId(store)}-PROTOTYPE_ONLY.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setFeedback({ tone: "success", message: "已导出 PROTOTYPE_ONLY 清单；文件不包含生产 READY 声明。" });
  };
  return (
    <WorkspacePageFrame eyebrow="PROTOTYPE DELIVERY" title="交付检查" description="检查 V2 原型构建、交互、隔离与安全文案；不会生成生产 READY 声明。" task={<TaskBanner tone="danger" title="V2 仍是交互原型，不是生产候选" detail="真实 Amazon Ads before / after / reload 不属于本原型，任何导出只能标记为 PROTOTYPE。" />} actions={<div className="page-actions"><Button icon={ArrowClockwise} onClick={runPrototypeCheck}>重新检查</Button><Button variant="primary" icon={DownloadSimple} onClick={exportPrototype}>模拟导出原型包</Button></div>}>
      <SummaryStrip items={[
        { label: "交付性质", value: "PROTOTYPE", detail: "仅交互演示", tone: "warning" },
        { label: "检查通过", value: `${passed}/${checks.length}`, detail: "当前会话" },
        { label: "店铺隔离", value: "3 店", detail: "独立 localStorage" },
        { label: "生产 READY", value: "不允许", detail: "无真实 Ads 回读", tone: "danger" },
      ]} />
      <Feedback value={feedback} />
      <Panel title="原型交付门槛" meta="不复用历史 READY" tone="primary"><DataTable columns={[
        { key: "gate", label: "门槛" },
        { key: "evidence", label: "当前证据", render: (value) => <span className="cell-clip" title={value}>{value}</span> },
        { key: "status", label: "状态", render: (value) => <StatusPill tone={statusTone(value)}>{display(value)}</StatusPill> },
      ]} rows={checks} rowKey="id" onRowClick={(row) => openInspector(onInspect, "delivery-check", row)} /></Panel>
      <InlineFeedback tone="danger" title="严禁误用">模拟执行、模拟截图和模拟导出都不能用于正式 APP_READY 或真实广告执行证明。</InlineFeedback>
    </WorkspacePageFrame>
  );
}

const ROUTES = {
  today: { overview: TodayOverview },
  product: { products: Products, targets: Targets, events: Events },
  data: { scope: Scope, reports: Reports, "import-check": ImportCheck },
  diagnosis: { analysis: Diagnosis },
  decisions: { recommendations: Recommendations, approval: Approval, decided: Decided },
  readback: { execution: ExecutionReadback },
  growth: { keywords: Keywords, listing: Listing },
  system: { settings: Settings, scheduler: Scheduler, delivery: Delivery },
};

export function WorkspaceRouter({ store, route, command, onNavigate, onInspect }) {
  const View = ROUTES[route?.workspace]?.[route?.subview];
  if (!View) {
    return (
      <WorkspaceSurface route={route} onNavigate={onNavigate}>
        <WorkspacePageFrame title="子视图不可用" description="当前路由没有对应的 V2 工作区页面。">
          <EmptyState title="无法打开当前页面" detail={`${route?.workspace ?? "unknown"} / ${route?.subview ?? "unknown"}`} action={<Button variant="primary" onClick={() => onNavigate("today", "overview")}>返回今日巡航</Button>} />
        </WorkspacePageFrame>
      </WorkspaceSurface>
    );
  }
  return (
    <WorkspaceSurface route={route} onNavigate={onNavigate}>
      <View store={store} route={route} command={command} onNavigate={onNavigate} onInspect={onInspect} />
    </WorkspaceSurface>
  );
}

export default WorkspaceRouter;
