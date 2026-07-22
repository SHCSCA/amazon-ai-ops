import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowRight,
  Browser,
  CheckCircle,
  ClipboardText,
  CloudArrowUp,
  Database,
  Eye,
  FileArrowUp,
  Flask,
  Funnel,
  Gear,
  HardDrives,
  ListChecks,
  LockKey,
  MagnifyingGlass,
  MonitorPlay,
  NotePencil,
  PencilSimple,
  Play,
  Plus,
  Pulse,
  Robot,
  ShieldCheck,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  IconButton,
  Modal,
  Panel,
} from "./primitives.jsx";
import { resolveProductId as sharedResolveProductId } from "./model.js";
import { StoreManagement } from "./store-management.jsx";
import { US_BUSINESS_TIMEZONE, US_CURRENCY, businessTimezoneOf } from "./us-market.js";

const STATUS_COPY = {
  active: ["进行中", "info"],
  running: ["运行中", "info"],
  enabled: ["已启用", "success"],
  healthy: ["健康", "success"],
  completed: ["已完成", "success"],
  success: ["成功", "success"],
  approved: ["已批准", "success"],
  verified: ["已验证", "success"],
  connected: ["已连接", "success"],
  empty: ["空报告", "warning"],
  ready: ["可执行", "info"],
  queued: ["队列中", "info"],
  applied: ["已应用", "success"],
  executing: ["执行中", "info"],
  pending: ["待处理", "warning"],
  needs_approval: ["待审批", "warning"],
  awaiting_approval: ["待审批", "warning"],
  needs_data: ["等待新数据", "warning"],
  escalated: ["已转审批", "warning"],
  paused: ["已暂停", "warning"],
  warning: ["需关注", "warning"],
  attention: ["需关注", "warning"],
  expired: ["已过期", "danger"],
  disconnected: ["未连接", "danger"],
  failed: ["失败", "danger"],
  blocked: ["已阻断", "danger"],
  rejected: ["已拒绝", "danger"],
  skipped: ["已跳过", "neutral"],
  archived: ["已归档", "neutral"],
  imported: ["已导入", "success"],
  observed: ["已记录", "info"],
  draft: ["草稿", "neutral"],
  idle: ["待命", "neutral"],
};

const REPORT_TYPE_OPTIONS = [
  ["business", "业务报告"],
  ["ads_campaign", "广告活动报告"],
  ["search_term", "搜索词报告"],
  ["advertised_product", "广告商品报告"],
  ["inventory", "库存报告"],
  ["listing", "Listing 报告"],
];

const REPORT_TYPES_BY_SOURCE = {
  lingxing: new Set(["business", "ads_campaign", "search_term", "inventory", "listing"]),
  amazon_ads: new Set(["ads_campaign", "search_term", "advertised_product"]),
};

function reportTypeLabel(value) {
  const normalized = value === "ads" ? "ads_campaign" : value === "search-term" ? "search_term" : value;
  return REPORT_TYPE_OPTIONS.find(([optionValue]) => optionValue === normalized)?.[1] || value || "数据报告";
}

function statusLabel(value, fallback = "待处理") {
  return STATUS_COPY[value]?.[0] || value || fallback;
}

function selectTabFromKeyboard(event, values, current, onSelect) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const currentIndex = Math.max(0, values.indexOf(current));
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? values.length - 1
      : event.key === "ArrowRight"
        ? (currentIndex + 1) % values.length
        : (currentIndex - 1 + values.length) % values.length;
  onSelect(values[nextIndex]);
  const tabs = event.currentTarget.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]');
  window.requestAnimationFrame(() => tabs?.[nextIndex]?.focus());
}

const AD_OBJECT_TYPES = [
  ["campaign", "广告活动"],
  ["ad_group", "广告组"],
  ["keyword", "关键词"],
  ["target", "商品投放"],
];

const COLLECTION_SOURCE_LABELS = {
  lingxing: "领星 ERP",
  amazon_ads: "Amazon Ads",
  amazon_seller: "Amazon Seller Central",
  local_csv: "本地 CSV",
};

function collectionSourceLabel(value) {
  return COLLECTION_SOURCE_LABELS[value] || value || "未知来源";
}

function matchTypeLabel(value) {
  return ({ exact: "精准匹配", phrase: "词组匹配", broad: "广泛匹配" })[value] || value || "—";
}

const OPERATION_IMPACT_META = {
  low: { label: "低", tone: "neutral" },
  medium: { label: "中", tone: "warning" },
  high: { label: "高", tone: "danger" },
  negative_short_term: { label: "短期负面", tone: "warning" },
  positive_short_term: { label: "短期正面", tone: "success" },
};

function operationImpactMeta(value) {
  return OPERATION_IMPACT_META[value] || { label: value || "未评估", tone: "neutral" };
}

function makeId(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function storeIdOf(store) {
  return store?.id || store?.storeId || store?.code || "当前店铺";
}

function storeNameOf(store) {
  return store?.name || store?.storeName || storeIdOf(store);
}

function dispatchAction(dispatch, type, payload = {}) {
  return dispatch?.({ type, ...payload, payload });
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function statusOf(record, fallback = "active") {
  if (record?.archived) return "archived";
  return record?.status || fallback;
}

function StatusBadge({ status, children }) {
  const normalized = status || "idle";
  const [label, tone] = STATUS_COPY[normalized] || [children || normalized, "neutral"];
  return <Badge tone={tone}>{children || label}</Badge>;
}

function runtimeTimezone(store) {
  return businessTimezoneOf(store);
}

function runtimeCurrency(store) {
  return store?.currency || US_CURRENCY;
}

function formatMoney(value, currency = "USD", fallback = "—") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      currencyDisplay: "code",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric).replace(/\s+/g, " ");
  } catch {
    return `${currency} ${numeric.toFixed(2)}`;
  }
}

function resolvedProductId(store, item) {
  return sharedResolveProductId(store, item);
}

function matchesSelectedProduct(store, item) {
  const selectedProductId = String(store?.selectedProductId || "");
  if (!selectedProductId) return true;
  const itemProductId = resolvedProductId(store, item);
  return !itemProductId || itemProductId === selectedProductId;
}

function formatTime(value, timeZone = US_BUSINESS_TIMEZONE) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
}

function dateTimeInputValue(value, timeZone) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  } catch {
    const localOffset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - localOffset).toISOString().slice(0, 16);
  }
}

function zonedDateTimeToIso(value, timeZone) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return new Date(value).toISOString();
  const [, year, month, day, hour, minute] = match;
  const wallClockUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  try {
    const rendered = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(wallClockUtc)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const renderedUtc = Date.UTC(Number(rendered.year), Number(rendered.month) - 1, Number(rendered.day), Number(rendered.hour), Number(rendered.minute));
    return new Date(wallClockUtc - (renderedUtc - wallClockUtc)).toISOString();
  } catch {
    return new Date(value).toISOString();
  }
}

function businessDateValue(value, timeZone = US_BUSINESS_TIMEZONE) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function numberText(value, suffix = "") {
  if (value === null || value === undefined || value === "") return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return `${value}${suffix}`;
  return `${parsed.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${suffix}`;
}

function WorkspaceHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="workspace-header">
      <div className="workspace-title">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="workspace-actions">{actions}</div> : null}
    </header>
  );
}

function StoreIsolationNotice({ store, children }) {
  return (
    <div className="info-banner store-isolation-notice" role="note">
      <LockKey size={16} weight="fill" aria-hidden="true" />
      <strong>{storeIdOf(store)} 独立数据域</strong>
      <span>{children || "对象、策略、执行模式与活动历史不会跨店铺共享。"}</span>
      <span className="spacer" />
      <Badge tone="info">{store?.marketplace || "站点隔离"}</Badge>
    </div>
  );
}

function SearchControl({ value, onChange, placeholder, label = "搜索" }) {
  return (
    <label className="search-control">
      <span className="sr-only">{label}</span>
      <MagnifyingGlass size={16} aria-hidden="true" />
      <input className="search-input" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function ActionButtons({ onInspect, onEdit, onArchive, archiveBlockedReason, onRestore, restoreBlockedReason, onDelete, deleteBlockedReason }) {
  return (
    <div className="table-actions" onClick={(event) => event.stopPropagation()}>
      {onInspect ? <IconButton icon={Eye} label="查看详情" size="small" onClick={onInspect} /> : null}
      {onEdit ? <IconButton icon={PencilSimple} label="编辑" size="small" onClick={onEdit} /> : null}
      {onArchive ? <IconButton icon={Archive} label="归档" size="small" onClick={onArchive} /> : null}
      {archiveBlockedReason ? <IconButton icon={Archive} label={`不可归档：${archiveBlockedReason}`} size="small" disabled /> : null}
      {onRestore ? <Button variant="ghost" size="small" onClick={onRestore}>恢复</Button> : null}
      {restoreBlockedReason ? <Button variant="ghost" size="small" disabled title={restoreBlockedReason}>{restoreBlockedReason}</Button> : null}
      {onDelete ? <IconButton icon={Trash} label="删除" variant="danger" size="small" disabled={Boolean(deleteBlockedReason)} title={deleteBlockedReason} onClick={deleteBlockedReason ? undefined : onDelete} /> : null}
    </div>
  );
}

function InspectorAction({ openInspector, record, eyebrow, title, fields, note }) {
  return () => openInspector?.({ eyebrow, title, subtitle: record?.id, fields, note });
}

function operationEventInitial(store, record) {
  const timeZone = runtimeTimezone(store);
  return {
    title: record?.title || "",
    type: record?.type || "promotion",
    occurredAt: dateTimeInputValue(record?.occurredAt || record?.createdAt, timeZone),
    impact: record?.impact || "medium",
    note: record?.note || record?.description || record?.context || "",
    productId: record
      ? record.productId || ""
      : store?.selectedProductId || asList(store?.products).find((product) => !product.archived && product.status !== "archived")?.id || "",
  };
}

function OperationEventModal({ open, record, store, onClose, onSave }) {
  const [form, setForm] = useState(() => operationEventInitial(store, record));
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (open) {
      setForm(operationEventInitial(store, record));
      setErrors({});
    }
  }, [open, record?.id, record?.updatedAt, store?.id, store?.selectedProductId]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.title.trim()) nextErrors.title = "请填写事件标题。";
    if (!form.occurredAt) nextErrors.occurredAt = "请选择事件发生时间。";
    if (!form.note.trim()) nextErrors.note = "请记录可用于因果判断的事实。";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    onSave({
      ...form,
      id: record?.id || makeId("event"),
      description: form.note,
      context: form.note,
      occurredAt: zonedDateTimeToIso(form.occurredAt, runtimeTimezone(store)),
      createdAt: record?.createdAt || new Date().toISOString(),
      storeId: storeIdOf(store),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={record ? "编辑运营事件" : "记录运营事件"} description="事件进入当前店铺的因果时间线；每次修改都会追加审计记录。">
      <form className="form-grid operation-event-form" onSubmit={submit} noValidate>
        <Field label="事件标题" error={errors.title} required className="span-2">
          <input value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="例如：Prime Day 价格调整" autoFocus />
        </Field>
        <Field label="事件类型" required>
          <select value={form.type} onChange={(event) => update("type", event.target.value)}>
            <option value="promotion">促销活动</option>
            <option value="price">价格变更</option>
            <option value="inventory">库存变化</option>
            <option value="listing">Listing 变更</option>
            <option value="competitor">竞品动作</option>
            <option value="external">外部因素</option>
          </select>
        </Field>
        <Field label="发生时间" error={errors.occurredAt} required>
          <input type="datetime-local" value={form.occurredAt} onChange={(event) => update("occurredAt", event.target.value)} />
        </Field>
        <Field label="影响等级" required>
          <select value={form.impact} onChange={(event) => update("impact", event.target.value)}>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
            <option value="negative_short_term">短期负面</option>
            <option value="positive_short_term">短期正面</option>
          </select>
        </Field>
        <Field label="关联产品">
          <select value={form.productId} onChange={(event) => update("productId", event.target.value)}>
            <option value="">店铺级事件</option>
            {asList(store?.products).filter((product) => !product.archived && product.status !== "archived").map((product) => (
              <option key={product.id} value={product.id}>{product.sku || product.name || product.id}</option>
            ))}
          </select>
        </Field>
        <Field label="事实说明" hint="写明发生了什么，不提前下因果结论。" error={errors.note} required className="span-2">
          <textarea value={form.note} onChange={(event) => update("note", event.target.value)} placeholder="记录动作、范围与已知影响" />
        </Field>
        <div className="dialog-actions span-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" type="submit" leadingIcon={NotePencil}>{record ? "保存修改" : "写入时间线"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function TodayWorkspace({ store, dispatch, onNavigate, openInspector, notify, focusTarget }) {
  const [eventEditor, setEventEditor] = useState(null);
  const [eventConfirm, setEventConfirm] = useState(null);
  const [eventQuery, setEventQuery] = useState("");
  const missions = asList(store?.missions).filter((item) => matchesSelectedProduct(store, item));
  const decisions = asList(store?.decisions).filter((item) => matchesSelectedProduct(store, item));
  const experiments = asList(store?.experiments).filter((item) => matchesSelectedProduct(store, item));
  const executions = (asList(store?.executionQueue).length
    ? asList(store?.executionQueue)
    : asList(store?.executions).length
      ? asList(store?.executions)
      : asList(store?.executionRuns)).filter((item) => matchesSelectedProduct(store, item));
  const events = asList(store?.operationEvents).filter((item) => matchesSelectedProduct(store, item));
  const policies = asList(store?.policies).filter((item) => !item.archived && item.status === "active");
  const collectionJobs = asList(store?.collectionJobs).length ? asList(store?.collectionJobs) : asList(store?.collectionRuns);
  const activeMission = missions.find((mission) => mission.status === "active");
  const recentMission = [...missions].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0];
  const displayedMission = activeMission || recentMission;
  const activeExperiment = experiments.find((experiment) => ["active", "running"].includes(experiment.status));
  const pendingDecisions = decisions.filter((decision) => ["pending", "needs_approval", "awaiting_approval", "proposed", "draft", "needs_data", "escalated", "blocked"].includes(decision.status));
  const failedCollections = collectionJobs.filter((job) => job.status === "failed");
  const lingxingFreshness = Number(store?.session?.lingxing?.freshnessMinutes);
  const hasFreshData = store?.session?.lingxing?.status === "connected"
    && Number.isFinite(lingxingFreshness)
    && collectionJobs.some((job) => (job.status === "completed" && Number(job.records || 0) > 0) || job.lastEvidence?.status === "verified")
    && asList(store?.reportImports).some((report) => report.status === "imported" && Number(report.rowCount || 0) > 0);
  const lingxingConnected = store?.session?.lingxing?.status === "connected";
  const adsConnected = store?.session?.amazonAds?.status === "connected";
  const adsWritable = store?.session?.amazonAds?.scope === "read_write_simulated";
  const browserReady = lingxingConnected && adsConnected && adsWritable;
  const browserReadinessLabel = browserReady
    ? "会话与权限正常"
    : store?.profileConflict
      ? "Profile 冲突"
      : !lingxingConnected
      ? "领星待确认"
      : !adsConnected
        ? "Ads 待登录"
        : "Ads 待授权";
  const latestExecution = [...executions].sort((a, b) => new Date(b.updatedAt || b.startedAt || 0) - new Date(a.updatedAt || a.startedAt || 0))[0];
  const normalizedQuery = eventQuery.trim().toLowerCase();
  const visibleEvents = events
    .filter((event) => !normalizedQuery || `${event.title || ""} ${event.note || event.description || ""}`.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => new Date(b.occurredAt || b.createdAt || 0) - new Date(a.occurredAt || a.createdAt || 0));
  const missionProgress = Number(displayedMission?.progress ?? displayedMission?.completion ?? (latestExecution?.status === "verified" ? 100 : activeExperiment ? 58 : displayedMission ? 30 : 0));

  const chain = [
    { route: "missions", icon: ListChecks, label: "Mission", detail: activeMission ? "目标已锁定" : displayedMission ? `最近任务 · ${statusLabel(statusOf(displayedMission))}` : "等待任务", status: displayedMission?.status || "idle" },
    { route: "decisions", icon: ClipboardText, label: "Crux 决策", detail: pendingDecisions.length ? `${pendingDecisions.length} 项待处理` : !policies.length ? "尚未配置策略边界" : !decisions.length ? "尚无可评估决策" : "边界已确认", status: pendingDecisions.length ? "needs_approval" : !policies.length || !decisions.length ? "idle" : "approved" },
    { route: "experiments", icon: Flask, label: "经营实验", detail: activeExperiment?.name || activeExperiment?.title || "等待分配", status: activeExperiment?.status || "idle" },
    { route: "execution", icon: MonitorPlay, label: "可见执行", detail: latestExecution ? `最近 ${formatTime(latestExecution.updatedAt || latestExecution.startedAt, runtimeTimezone(store))}` : "尚无执行", status: latestExecution?.status || "idle" },
  ];

  useEffect(() => {
    setEventEditor(null);
    setEventConfirm(null);
    setEventQuery("");
  }, [storeIdOf(store)]);

  useEffect(() => {
    if (focusTarget?.kind !== "operationEvent") return;
    const target = events.find((event) => event.id === focusTarget.id);
    if (!target) return;
    setEventQuery("");
    if (statusOf(target, "observed") !== "archived") {
      setEventEditor({ record: target });
    } else {
      openInspector?.({ eyebrow: "已归档运营事件", title: target.title, fields: [["发生时间", formatTime(target.occurredAt, runtimeTimezone(store))], ["影响等级", operationImpactMeta(target.impact).label], ["关联产品", target.productId || "店铺级"], ["记录类型", target.type]], note: target.note || target.description });
    }
  }, [focusTarget?.nonce, storeIdOf(store)]);

  const saveEvent = (eventRecord) => {
    let validation;
    if (eventEditor?.record) {
      validation = dispatchAction(dispatch, "UPDATE_OPERATION_EVENT", { eventId: eventRecord.id, operationEventId: eventRecord.id, event: eventRecord, operationEvent: eventRecord });
      if (validation?.ok === false) return notify?.(validation.message || "运营事件未能更新", "danger");
      notify?.("运营事件已更新并追加审计记录");
    } else {
      validation = dispatchAction(dispatch, "ADD_OPERATION_EVENT", { event: eventRecord, operationEvent: eventRecord });
      if (validation?.ok === false) return notify?.(validation.message || "运营事件未能创建", "danger");
      notify?.("运营事件已写入当前店铺因果时间线");
    }
    setEventEditor(null);
  };

  const eventColumns = [
    { key: "time", header: "时间", render: (event) => <time dateTime={event.occurredAt || event.createdAt}>{formatTime(event.occurredAt || event.createdAt, runtimeTimezone(store))}</time> },
    { key: "event", header: "事件", render: (event) => <div className="table-primary-cell"><strong>{event.title}</strong><small>{event.note || event.description}</small></div> },
    { key: "impact", header: "影响", render: (event) => { const meta = operationImpactMeta(event.impact); return <Badge tone={meta.tone}>{meta.label}</Badge>; } },
    { key: "status", header: "状态", render: (event) => <StatusBadge status={statusOf(event, "observed")} /> },
    { key: "actions", header: "操作", render: (event) => {
      const archived = statusOf(event, "observed") === "archived";
      return <ActionButtons
        onInspect={InspectorAction({ openInspector, record: event, eyebrow: "运营事件", title: event.title, fields: [["发生时间", formatTime(event.occurredAt, runtimeTimezone(store))], ["影响等级", operationImpactMeta(event.impact).label], ["关联产品", event.productId || "店铺级"], ["记录类型", event.type]], note: event.note || event.description })}
        onEdit={!archived ? () => setEventEditor({ record: event }) : undefined}
        onArchive={!archived ? () => { const validation = dispatchAction(dispatch, "ARCHIVE_OPERATION_EVENT", { eventId: event.id, operationEventId: event.id }); notify?.(validation?.ok === false ? validation.message : `运营事件 ${event.title} 已归档`, validation?.ok === false ? "danger" : "info"); } : undefined}
        onRestore={archived ? () => { const validation = dispatchAction(dispatch, "RESTORE_OPERATION_EVENT", { eventId: event.id, operationEventId: event.id }); notify?.(validation?.ok === false ? validation.message : `运营事件 ${event.title} 已恢复`, validation?.ok === false ? "danger" : "success"); } : undefined}
        onDelete={() => setEventConfirm(event)}
      />;
    } },
  ];

  return (
    <div className="workspace today-workspace">
      <WorkspaceHeader
        eyebrow={`${storeIdOf(store)} · 今日控制面`}
        title={displayedMission?.title || displayedMission?.name || "等待新的 Mission"}
        description={displayedMission?.objective || displayedMission?.description || "从明确经营目标开始，再进入决策、实验与可见执行。"}
        actions={(
          <>
            <Button variant="secondary" leadingIcon={NotePencil} onClick={() => setEventEditor({ record: null })}>记录运营事件</Button>
            <Button variant="primary" leadingIcon={ListChecks} onClick={() => onNavigate?.("missions")}>打开 Mission</Button>
          </>
        )}
      />

      <StoreIsolationNotice store={store}>今日任务、审批与因果记录仅来自 {storeNameOf(store)}。</StoreIsolationNotice>

      <section className="mission-control-board" aria-label="Mission 推进控制板">
        <div className="mission-control-main">
          <div className="mission-status-line">
            <div>
              <span className="eyebrow">{activeMission ? "ACTIVE MISSION" : displayedMission ? `RECENT MISSION · ${statusLabel(statusOf(displayedMission))}` : "NO ACTIVE MISSION"}</span>
              <strong>{displayedMission?.goal || displayedMission?.objective || "尚未定义量化目标"}</strong>
            </div>
            <StatusBadge status={displayedMission?.status || "idle"} />
          </div>
          <div className="mission-progress" aria-label={`Mission 完成度 ${missionProgress}%`}>
            <div className="mission-progress-copy"><span>推进度</span><strong>{Math.max(0, Math.min(100, missionProgress))}%</strong></div>
            <div className="progress-track"><span style={{ width: `${Math.max(0, Math.min(100, missionProgress))}%` }} /></div>
          </div>
          <div className="mission-chain" role="list" aria-label="Mission 端到端链路">
            {chain.map(({ route, icon: Icon, label, detail, status }, index) => (
              <div className="mission-chain-item" role="listitem" key={route}>
                <button type="button" className="mission-chain-step" onClick={() => onNavigate?.(route)}>
                  <span className="mission-chain-icon"><Icon size={19} weight="fill" /></span>
                  <span className="mission-chain-copy"><strong>{label}</strong><small>{detail}</small></span>
                  <StatusBadge status={status} />
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
                {index < chain.length - 1 ? <span className="mission-chain-connector" aria-hidden="true" /> : null}
              </div>
            ))}
          </div>
        </div>

        <aside className="mission-health-rail" aria-label="当前任务健康状态">
          <header><span className="eyebrow">OPERATING HEALTH</span><h2>执行前检查</h2></header>
          <ul className="health-signal-list">
            <li><span><Database size={16} /><strong>数据新鲜度</strong></span><StatusBadge status={failedCollections.length ? "warning" : hasFreshData ? "healthy" : "idle"}>{failedCollections.length ? `${failedCollections.length} 项失败` : hasFreshData ? `${lingxingFreshness} 分钟前同步` : "尚无有效采集"}</StatusBadge></li>
            <li><span><ShieldCheck size={16} /><strong>策略边界</strong></span><StatusBadge status={pendingDecisions.length ? "needs_approval" : policies.length ? "approved" : "idle"}>{pendingDecisions.length ? `${pendingDecisions.length} 项待处理` : policies.length ? `${policies.length} 条启用` : "尚未配置"}</StatusBadge></li>
            <li><span><Browser size={16} /><strong>可见浏览器</strong></span><StatusBadge status={store?.profileConflict ? "blocked" : browserReady ? "connected" : "warning"}>{browserReadinessLabel}</StatusBadge></li>
            <li><span><Flask size={16} /><strong>因果隔离</strong></span><StatusBadge status={activeExperiment ? "active" : "idle"}>{activeExperiment ? "实验运行中" : "未占用"}</StatusBadge></li>
          </ul>
          <Button variant="ghost" size="small" trailingIcon={ArrowRight} onClick={() => onNavigate?.(decisions.length ? "decisions" : "policy")}>检查执行边界</Button>
        </aside>
      </section>

      <div className="today-lower-grid">
        <Panel
          title="运营事件与干扰记录"
          description={`完整显示当前范围的 ${events.length} 条事实记录，帮助 AI 区分策略效果与外部干扰。`}
          actions={<SearchControl value={eventQuery} onChange={setEventQuery} placeholder="搜索事件" label="搜索运营事件" />}
        >
          <DataTable
            caption="当前店铺运营事件"
            columns={eventColumns}
            rows={visibleEvents}
            emptyTitle="尚无运营事件"
            emptyDescription="价格、库存、促销或竞品变化都应在实验判断前留下事实记录。"
            emptyAction={<Button variant="primary" leadingIcon={Plus} onClick={() => setEventEditor({ record: null })}>记录首个事件</Button>}
          />
        </Panel>

        <Panel title="下一推进动作" description="按阻塞关系排列，不以指标卡替代任务。">
          <ol className="next-action-list">
            {pendingDecisions.length ? (
              <li><span><WarningCircle size={18} weight="fill" /></span><div><strong>处理 {pendingDecisions.length} 项 Crux 决策</strong><p>补数据、确认边界或审批后才会进入执行队列。</p></div><Button variant="warning" size="small" onClick={() => onNavigate?.("decisions")}>去处理</Button></li>
            ) : null}
            {failedCollections.length ? (
              <li><span><Database size={18} weight="fill" /></span><div><strong>恢复 {failedCollections.length} 个采集任务</strong><p>缺失数据会降低 Mission 判断可信度。</p></div><Button variant="secondary" size="small" onClick={() => onNavigate?.("collection")}>去处理</Button></li>
            ) : null}
            <li><span><MonitorPlay size={18} weight="fill" /></span><div><strong>{latestExecution ? "检查最近执行回读" : "准备首个可见执行"}</strong><p>保留 before、after 与 reload 证据。</p></div><Button variant="secondary" size="small" onClick={() => onNavigate?.("execution")}>打开执行</Button></li>
          </ol>
        </Panel>
      </div>

      <OperationEventModal open={Boolean(eventEditor)} record={eventEditor?.record} store={store} onClose={() => setEventEditor(null)} onSave={saveEvent} />
      <ConfirmDialog open={Boolean(eventConfirm)} onClose={() => setEventConfirm(null)} onConfirm={() => { if (!eventConfirm) return; const validation = dispatchAction(dispatch, "DELETE_OPERATION_EVENT", { eventId: eventConfirm.id, operationEventId: eventConfirm.id }); notify?.(validation?.ok === false ? validation.message : `运营事件 ${eventConfirm.title} 已删除`, validation?.ok === false ? "danger" : "info"); if (validation?.ok !== false) setEventConfirm(null); }} title="删除运营事件？" description="当前记录会从列表移除；删除动作本身仍保留在追加式审计中。" confirmLabel="确认删除"><p className="confirm-object-name">{eventConfirm?.title}</p></ConfirmDialog>
    </div>
  );
}

function productInitial(record, store) {
  return {
    sku: record?.sku || "",
    asin: record?.asin || "",
    name: record?.name || record?.title || "",
    marketplace: record?.marketplace || store?.marketplace || "US",
    price: record?.price ?? "",
    cost: record?.cost ?? "",
    targetAcos: record?.targetAcos ?? record?.targetACOS ?? "",
    targetMargin: record?.targetMargin ?? "",
    status: ["active", "paused"].includes(record?.status) ? record.status : "active",
  };
}

function ProductEditor({ open, record, store, onClose, onSave }) {
  const [form, setForm] = useState(() => productInitial(record, store));
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (open) {
      setForm(productInitial(record, store));
      setErrors({});
    }
  }, [open, record?.id, record?.updatedAt, store?.id]);
  const identityLocked = Boolean(record && productDependencyCount(store, record.id));
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.sku.trim()) nextErrors.sku = "SKU 不能为空。";
    else if (asList(store?.products).some((product) => product.id !== record?.id && String(product.sku || "").trim().toLowerCase() === form.sku.trim().toLowerCase())) nextErrors.sku = "当前店铺已存在相同 SKU。";
    if (!/^[A-Z0-9]{10}$/i.test(form.asin.trim())) nextErrors.asin = "ASIN 应为 10 位字母或数字。";
    if (asList(store?.products).some((product) => product.id !== record?.id && String(product.asin || "").toUpperCase() === form.asin.trim().toUpperCase())) nextErrors.asin = "当前店铺已存在相同 ASIN。";
    if (!form.name.trim()) nextErrors.name = "请填写产品名称。";
    if (!form.marketplace.trim()) nextErrors.marketplace = "站点不能为空。";
    else if (form.marketplace !== store?.marketplace) nextErrors.marketplace = "产品站点必须与当前店铺站点一致。";
    if (!(Number(form.price) > 0)) nextErrors.price = "售价必须大于 0。";
    if (form.cost !== "" && Number(form.cost) < 0) nextErrors.cost = "成本不能小于 0。";
    if (!(Number(form.targetAcos) > 0 && Number(form.targetAcos) <= 100)) nextErrors.targetAcos = "目标 ACOS 应在 0–100% 之间。";
    if (form.targetMargin !== "" && !(Number(form.targetMargin) >= -100 && Number(form.targetMargin) <= 100)) nextErrors.targetMargin = "目标净利率应在 -100–100% 之间。";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    onSave({ ...form, price: Number(form.price), cost: form.cost === "" ? 0 : Number(form.cost), targetAcos: Number(form.targetAcos), targetMargin: form.targetMargin === "" ? null : Number(form.targetMargin) });
  };
  return (
    <Modal open={open} onClose={onClose} title={record ? "编辑产品" : "新增产品"} description={`保存到 ${storeIdOf(store)} 的独立产品目录。`}>
      <form className="form-grid product-editor-form" onSubmit={submit} noValidate>
        <Field label="SKU" error={errors.sku} hint={identityLocked ? "已有业务或因果记录，商品身份已锁定。" : undefined} required><input value={form.sku} disabled={identityLocked} onChange={(event) => update("sku", event.target.value)} autoFocus /></Field>
        <Field label="ASIN" error={errors.asin} required><input value={form.asin} disabled={identityLocked} onChange={(event) => update("asin", event.target.value.toUpperCase())} maxLength={10} /></Field>
        <Field label="产品名称" error={errors.name} required className="span-2"><input value={form.name} onChange={(event) => update("name", event.target.value)} /></Field>
        <Field label="站点" error={errors.marketplace} hint="站点由当前店铺数据域固定，切换店铺后分别维护。" required><input value={form.marketplace} readOnly aria-readonly="true" /></Field>
        <Field label="状态" required><select value={form.status} onChange={(event) => update("status", event.target.value)}><option value="active">在售</option><option value="paused">暂停运营</option></select></Field>
        <Field label={`当前售价 (${runtimeCurrency(store)})`} error={errors.price} required><input type="number" min="0" step="0.01" value={form.price} onChange={(event) => update("price", event.target.value)} /></Field>
        <Field label={`单位成本 (${runtimeCurrency(store)})`} error={errors.cost}><input type="number" min="0" step="0.01" value={form.cost} onChange={(event) => update("cost", event.target.value)} /></Field>
        <Field label="目标 ACOS (%)" error={errors.targetAcos} required><input type="number" min="0.1" max="100" step="0.1" value={form.targetAcos} onChange={(event) => update("targetAcos", event.target.value)} /></Field>
        <Field label="目标净利率 (%)" error={errors.targetMargin}><input type="number" min="-100" max="100" step="0.1" value={form.targetMargin} onChange={(event) => update("targetMargin", event.target.value)} /></Field>
        <div className="dialog-actions span-2"><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" type="submit">{record ? "保存修改" : "创建产品"}</Button></div>
      </form>
    </Modal>
  );
}

function adObjectInitial(record, store) {
  return {
    name: record?.name || "",
    type: record?.type || "campaign",
    externalId: record?.externalId || record?.amazonId || "",
    productId: record?.productId || store?.selectedProductId || "",
    status: ["enabled", "paused"].includes(record?.status) ? record.status : "paused",
    parentId: record?.parentId || "",
    matchType: record?.matchType || "exact",
    bid: record?.bid ?? "",
    targetingExpression: record?.targetingExpression || record?.expression || "",
    dailyBudget: record?.dailyBudget ?? record?.budget ?? "",
    targetAcos: record?.targetAcos ?? "",
  };
}

function AdObjectEditor({ open, record, store, onClose, onSave }) {
  const [form, setForm] = useState(() => adObjectInitial(record, store));
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (open) {
      setForm(adObjectInitial(record, store));
      setErrors({});
    }
  }, [open, record?.id, record?.updatedAt, store?.id, store?.selectedProductId]);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const identityLocked = Boolean(record && adObjectDependencyCount(store, record.id));
  const parentType = form.type === "ad_group" ? "campaign" : ["keyword", "target"].includes(form.type) ? "ad_group" : null;
  const parentOptions = asList(store?.adObjects).filter((object) => object.id !== record?.id && object.type === parentType && object.productId === form.productId && !object.archived && !["archived", "deleted", "disabled", "paused"].includes(object.status));
  const submit = (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = "请填写对象名称。";
    if (!form.externalId.trim()) nextErrors.externalId = "请填写 Amazon 对象 ID。";
    if (asList(store?.adObjects).some((object) => object.id !== record?.id && object.externalId && String(object.externalId).trim().toLowerCase() === form.externalId.trim().toLowerCase())) nextErrors.externalId = "当前店铺已存在相同 Amazon 对象 ID。";
    if (!form.productId) nextErrors.productId = "请选择所属产品。";
    else if (!asList(store?.products).some((product) => product.id === form.productId && !product.archived && product.status !== "archived")) nextErrors.productId = "所属产品已归档或不存在，请重新选择。";
    const hasChildren = Boolean(record && asList(store?.adObjects).some((object) => object.parentId === record.id));
    if (hasChildren && form.type !== record.type) nextErrors.type = "存在下级对象时不能更改对象类型。";
    if (hasChildren && form.productId !== record.productId) nextErrors.productId = "存在下级对象时不能更改所属产品。";
    if (parentType && !form.parentId) nextErrors.parentId = `请选择父级${parentType === "campaign" ? "广告活动" : "广告组"}。`;
    else if (parentType && !parentOptions.some((object) => object.id === form.parentId)) nextErrors.parentId = "父级对象不存在、未启用或不属于当前产品。";
    if (form.type === "campaign" && !(Number(form.dailyBudget) > 0)) nextErrors.dailyBudget = "广告活动日预算必须大于 0。";
    if (["keyword", "target"].includes(form.type) && !(Number(form.bid) > 0)) nextErrors.bid = "竞价必须大于 0。";
    if (form.type === "target" && !form.targetingExpression.trim()) nextErrors.targetingExpression = "请填写商品投放表达式。";
    if (form.targetAcos !== "" && !(Number(form.targetAcos) > 0 && Number(form.targetAcos) <= 100)) nextErrors.targetAcos = "目标 ACOS 应在 0–100% 之间。";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    onSave({
      ...form,
      externalId: form.externalId.trim(),
      parentId: parentType ? form.parentId : null,
      matchType: form.type === "keyword" ? form.matchType : null,
      bid: ["keyword", "target"].includes(form.type) ? Number(form.bid) : null,
      targetingExpression: form.type === "target" ? form.targetingExpression.trim() : null,
      dailyBudget: form.type === "campaign" ? Number(form.dailyBudget) : null,
      targetAcos: form.targetAcos === "" ? null : Number(form.targetAcos),
    });
  };
  return (
    <Modal open={open} onClose={onClose} title={record ? "编辑广告对象" : "新增广告对象"} description="对象 ID 与产品关系仅写入当前店铺数据域。">
      <form className="form-grid ad-object-editor-form" onSubmit={submit} noValidate>
        <Field label="对象名称" error={errors.name} hint={identityLocked && ["keyword", "target"].includes(form.type) ? "关键词或投放表达式已有历史引用，名称身份已锁定。" : undefined} required className="span-2"><input value={form.name} disabled={identityLocked && ["keyword", "target"].includes(form.type)} onChange={(event) => update("name", event.target.value)} autoFocus /></Field>
        <Field label="对象类型" error={errors.type} hint={identityLocked ? "已有下级或业务链路引用，对象身份已锁定。" : undefined} required><select value={form.type} disabled={identityLocked} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value, parentId: "" }))}>{AD_OBJECT_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
        <Field label="Amazon 对象 ID" error={errors.externalId} required><input value={form.externalId} disabled={identityLocked} onChange={(event) => update("externalId", event.target.value)} /></Field>
        <Field label="所属产品" error={errors.productId} required><select value={form.productId} disabled={identityLocked} onChange={(event) => setForm((current) => ({ ...current, productId: event.target.value, parentId: "" }))}><option value="">请选择</option>{asList(store?.products).filter((product) => !product.archived && product.status !== "archived").map((product) => <option value={product.id} key={product.id}>{product.sku || product.name || product.id}</option>)}</select></Field>
        <Field label="投放状态" required><select value={form.status} onChange={(event) => update("status", event.target.value)}><option value="enabled">已启用</option><option value="paused">已暂停</option></select></Field>
        {parentType ? <Field label={parentType === "campaign" ? "父级广告活动" : "父级广告组"} error={errors.parentId} required><select value={form.parentId} disabled={identityLocked} onChange={(event) => update("parentId", event.target.value)}><option value="">请选择</option>{parentOptions.map((object) => <option value={object.id} key={object.id}>{object.name} · {object.externalId}</option>)}</select></Field> : null}
        {form.type === "campaign" ? <Field label={`日预算 (${runtimeCurrency(store)})`} error={errors.dailyBudget} required><input type="number" min="0.01" step="0.01" value={form.dailyBudget} onChange={(event) => update("dailyBudget", event.target.value)} /></Field> : null}
        {form.type === "keyword" ? <Field label="匹配方式" required><select value={form.matchType} disabled={identityLocked} onChange={(event) => update("matchType", event.target.value)}><option value="exact">精准匹配</option><option value="phrase">词组匹配</option><option value="broad">广泛匹配</option></select></Field> : null}
        {["keyword", "target"].includes(form.type) ? <Field label={`当前竞价 (${runtimeCurrency(store)})`} error={errors.bid} required><input type="number" min="0.01" step="0.01" value={form.bid} onChange={(event) => update("bid", event.target.value)} /></Field> : null}
        {form.type === "target" ? <Field label="商品投放表达式" error={errors.targetingExpression} required className="span-2"><input value={form.targetingExpression} disabled={identityLocked} onChange={(event) => update("targetingExpression", event.target.value)} placeholder="例如 asin=B0XXXXXXXX" /></Field> : null}
        <Field label="目标 ACOS (%)" error={errors.targetAcos}><input type="number" min="0.1" max="100" step="0.1" value={form.targetAcos} onChange={(event) => update("targetAcos", event.target.value)} /></Field>
        <div className="dialog-actions span-2"><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" type="submit">{record ? "保存修改" : "创建对象"}</Button></div>
      </form>
    </Modal>
  );
}

function productDependencyCount(store, productId) {
  return asList(store?.adObjects).filter((item) => item.productId === productId).length
    + asList(store?.missions).filter((item) => item.productId === productId).length
    + asList(store?.experiments).filter((item) => item.productId === productId).length
    + asList(store?.decisions).filter((item) => item.productId === productId).length
    + asList(store?.executionQueue).filter((item) => item.productId === productId).length
    + asList(store?.policies).filter((item) => item.scope === `product:${productId}`).length;
}

function adObjectDependencyCount(store, adObjectId) {
  return asList(store?.adObjects).filter((item) => item.parentId === adObjectId).length
    + asList(store?.experiments).filter((item) => item.adObjectId === adObjectId).length
    + asList(store?.decisions).filter((item) => item.adObjectId === adObjectId).length
    + asList(store?.executionQueue).filter((item) => item.adObjectId === adObjectId).length
    + asList(store?.policies).filter((item) => item.scope === `adObject:${adObjectId}`).length;
}

export function ObjectsWorkspace({ store, dispatch, onNavigate: _onNavigate, openInspector, notify, focusTarget }) {
  const [tab, setTab] = useState("products");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const products = asList(store?.products);
  const adObjects = asList(store?.adObjects);
  const currency = runtimeCurrency(store);
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    setQuery("");
    setEditor(null);
    setConfirm(null);
  }, [storeIdOf(store)]);

  useEffect(() => {
    if (focusTarget?.storeId !== storeIdOf(store) || !["product", "adObject"].includes(focusTarget?.kind)) return;
    const collection = focusTarget.kind === "product" ? products : adObjects;
    const record = collection.find((item) => item.id === focusTarget.id);
    if (!record) return;
    setTab(focusTarget.kind === "product" ? "products" : "adObjects");
    setShowArchived(Boolean(record.archived || record.status === "archived"));
    setQuery(focusTarget.kind === "product" ? record.asin || record.sku || record.name || record.id : record.externalId || record.name || record.id);
  }, [focusTarget?.nonce, storeIdOf(store), products, adObjects]);

  const visibleProducts = useMemo(() => products.filter((product) => {
    if (!showArchived && (product.archived || product.status === "archived")) return false;
    return !normalizedQuery || `${product.sku || ""} ${product.asin || ""} ${product.name || product.title || ""}`.toLowerCase().includes(normalizedQuery);
  }), [products, normalizedQuery, showArchived]);

  const visibleAdObjects = useMemo(() => adObjects.filter((object) => {
    if (!showArchived && (object.archived || object.status === "archived")) return false;
    return !normalizedQuery || `${object.name || ""} ${object.externalId || object.amazonId || ""} ${object.type || ""}`.toLowerCase().includes(normalizedQuery);
  }), [adObjects, normalizedQuery, showArchived]);

  const saveProduct = (values) => {
    let validation;
    if (editor?.record) {
      const product = { ...editor.record, ...values, updatedAt: new Date().toISOString() };
      validation = dispatchAction(dispatch, "UPDATE_PRODUCT", { productId: product.id, id: product.id, updates: values, product });
      if (validation?.ok === false) return notify?.(validation.message || "产品未能更新", "danger");
      notify?.(`产品 ${product.sku} 已更新`);
    } else {
      const product = { ...values, id: makeId("product"), storeId: storeIdOf(store), archived: false, createdAt: new Date().toISOString() };
      validation = dispatchAction(dispatch, "CREATE_PRODUCT", { product });
      if (validation?.ok === false) return notify?.(validation.message || "产品未能创建", "danger");
      notify?.(`产品 ${product.sku} 已创建`);
    }
    setEditor(null);
  };

  const saveAdObject = (values) => {
    let validation;
    if (editor?.record) {
      const adObject = { ...editor.record, ...values, updatedAt: new Date().toISOString() };
      validation = dispatchAction(dispatch, "UPDATE_AD_OBJECT", { adObjectId: adObject.id, id: adObject.id, updates: values, adObject });
      if (validation?.ok === false) {
        notify?.(validation.message || "广告对象未能更新", "danger");
        return;
      }
      notify?.(`广告对象 ${adObject.name} 已更新`);
    } else {
      const adObject = { ...values, id: makeId("ad-object"), storeId: storeIdOf(store), archived: false, createdAt: new Date().toISOString() };
      validation = dispatchAction(dispatch, "CREATE_AD_OBJECT", { adObject });
      if (validation?.ok === false) {
        notify?.(validation.message || "广告对象未能创建", "danger");
        return;
      }
      notify?.(`广告对象 ${adObject.name} 已创建`);
    }
    setEditor(null);
  };

  const archiveProduct = (product) => {
    const validation = dispatchAction(dispatch, "ARCHIVE_PRODUCT", { productId: product.id, id: product.id, archived: true });
    if (validation?.ok === false) {
      notify?.(validation.message || "产品未能归档", "danger");
      return;
    }
    notify?.(`产品 ${product.sku} 已归档`, "info");
  };
  const restoreProduct = (product) => {
    const validation = dispatchAction(dispatch, "UPDATE_PRODUCT", { productId: product.id, id: product.id, updates: { archived: false, status: "active" }, product: { ...product, archived: false, status: "active" } });
    notify?.(validation?.ok === false ? validation.message : `产品 ${product.sku} 已恢复`, validation?.ok === false ? "danger" : "success");
  };
  const archiveAdObject = (adObject) => {
    const validation = dispatchAction(dispatch, "ARCHIVE_AD_OBJECT", { adObjectId: adObject.id, id: adObject.id, archived: true });
    if (validation?.ok === false) {
      notify?.(validation.message || "广告对象未能归档", "danger");
      return;
    }
    notify?.(`广告对象 ${adObject.name} 已归档`, "info");
  };
  const restoreAdObject = (adObject) => {
    const productAvailable = asList(store?.products).some((product) => product.id === adObject.productId && !product.archived && product.status !== "archived");
    const requiredParentType = adObject.type === "ad_group" ? "campaign" : ["keyword", "target"].includes(adObject.type) ? "ad_group" : null;
    const hierarchyAvailable = !requiredParentType || asList(store?.adObjects).some((parent) => parent.id === adObject.parentId && parent.type === requiredParentType && parent.productId === adObject.productId && !parent.archived && !["archived", "deleted", "disabled", "paused"].includes(parent.status));
    if (!productAvailable || !hierarchyAvailable) {
      notify?.(!productAvailable ? "关联产品已删除，广告对象不能恢复" : "请先恢复并启用父级广告对象", "danger");
      return;
    }
    const validation = dispatchAction(dispatch, "UPDATE_AD_OBJECT", { adObjectId: adObject.id, id: adObject.id, updates: { archived: false, status: "paused" }, adObject: { ...adObject, archived: false, status: "paused" } });
    if (validation?.ok === false) {
      notify?.(validation.message || "广告对象未能恢复", "danger");
      return;
    }
    notify?.(`广告对象 ${adObject.name} 已恢复`);
  };

  const performDelete = () => {
    if (!confirm) return;
    if (confirm.kind === "product") {
      const validation = dispatchAction(dispatch, "DELETE_PRODUCT", { productId: confirm.record.id, id: confirm.record.id });
      if (validation?.ok === false) {
        notify?.(validation.message || "产品未能删除", "danger");
        setConfirm(null);
        return;
      }
      notify?.(`产品 ${confirm.record.sku} 已删除`, "info");
    } else {
      const validation = dispatchAction(dispatch, "DELETE_AD_OBJECT", { adObjectId: confirm.record.id, id: confirm.record.id });
      if (validation?.ok === false) {
        notify?.(validation.message || "广告对象未能删除", "danger");
        setConfirm(null);
        return;
      }
      notify?.(`广告对象 ${confirm.record.name} 已删除`, "info");
    }
    setConfirm(null);
  };

  const productColumns = [
    { key: "product", header: "产品", render: (product) => <div className="table-primary-cell"><strong>{product.name || product.title}</strong><small>{product.sku} · {product.asin}</small></div> },
    { key: "marketplace", header: "站点", render: (product) => product.marketplace || store?.marketplace },
    { key: "price", header: `售价 / 成本 (${currency})`, render: (product) => <div className="table-stacked-value"><strong>{formatMoney(product.price, currency)}</strong><small>成本 {formatMoney(product.cost, currency)}</small></div> },
    { key: "targets", header: "经营目标", render: (product) => <div className="table-stacked-value"><strong>ACOS {numberText(product.targetAcos ?? product.targetACOS, "%")}</strong><small>净利率 {numberText(product.targetMargin, "%")}</small></div> },
    { key: "status", header: "状态", render: (product) => <StatusBadge status={statusOf(product)} /> },
    { key: "actions", header: "操作", render: (product) => {
      const archived = product.archived || product.status === "archived";
      const dependencyCount = productDependencyCount(store, product.id);
      const dependencyReason = dependencyCount ? `仍被 ${dependencyCount} 个业务对象或历史链路引用` : undefined;
      return <ActionButtons onInspect={InspectorAction({ openInspector, record: product, eyebrow: "产品对象", title: product.name || product.title, fields: [["SKU", product.sku], ["ASIN", product.asin], ["当前售价", formatMoney(product.price, currency)], ["单位成本", formatMoney(product.cost, currency)], ["目标 ACOS", numberText(product.targetAcos ?? product.targetACOS, "%")], ["依赖记录", dependencyCount]], note: dependencyReason || `此对象仅属于 ${storeIdOf(store)}，金额均按 ${currency} 解释。` })} onEdit={!archived ? () => setEditor({ kind: "product", record: product }) : undefined} onArchive={!archived && !dependencyReason ? () => archiveProduct(product) : undefined} archiveBlockedReason={!archived ? dependencyReason : undefined} onRestore={archived ? () => restoreProduct(product) : undefined} onDelete={() => dependencyReason ? notify?.(`${dependencyReason}，不能删除`, "danger") : setConfirm({ kind: "product", record: product })} />;
    } },
  ];

  const adColumns = [
    { key: "object", header: "广告对象", render: (object) => <div className="table-primary-cell"><strong>{object.name}</strong><small>{AD_OBJECT_TYPES.find(([type]) => type === object.type)?.[1] || object.type} · {object.externalId || object.amazonId}</small></div> },
    { key: "product", header: "所属产品 / 父级", render: (object) => <div className="table-stacked-value"><strong>{products.find((product) => product.id === object.productId)?.sku || object.productId || "—"}</strong><small>{adObjects.find((candidate) => candidate.id === object.parentId)?.name || "顶级对象"}</small></div> },
    { key: "parameter", header: `投放参数 (${currency})`, render: (object) => <div className="table-stacked-value"><strong>{object.type === "campaign" ? `日预算 ${formatMoney(object.dailyBudget ?? object.budget, currency)}` : ["keyword", "target"].includes(object.type) ? `竞价 ${formatMoney(object.bid, currency)}` : "继承活动预算"}</strong><small>{object.type === "keyword" ? `匹配 ${matchTypeLabel(object.matchType)}` : object.type === "target" ? object.targetingExpression || "—" : "—"}</small></div> },
    { key: "target", header: "目标 ACOS", render: (object) => numberText(object.targetAcos, "%") },
    { key: "status", header: "状态", render: (object) => <StatusBadge status={statusOf(object, "enabled")} /> },
    { key: "actions", header: "操作", render: (object) => {
      const archived = object.archived || object.status === "archived";
      const productAvailable = !object.productId || asList(store?.products).some((product) => product.id === object.productId && !product.archived && product.status !== "archived");
      const parentAvailable = !object.parentId || adObjects.some((parent) => parent.id === object.parentId && !parent.archived && !["archived", "deleted", "disabled", "paused"].includes(parent.status));
      const restoreAvailable = productAvailable && parentAvailable;
      const dependencyCount = adObjectDependencyCount(store, object.id);
      const dependencyReason = dependencyCount ? `仍被 ${dependencyCount} 个下级对象或业务链路引用` : undefined;
      return <ActionButtons onInspect={InspectorAction({ openInspector, record: object, eyebrow: "广告对象", title: object.name, fields: [["Amazon ID", object.externalId || object.amazonId], ["对象类型", AD_OBJECT_TYPES.find(([type]) => type === object.type)?.[1] || object.type], ["父级对象", adObjects.find((parent) => parent.id === object.parentId)?.name || "顶级对象"], [object.type === "campaign" ? `日预算 (${currency})` : `当前竞价 (${currency})`, formatMoney(object.type === "campaign" ? object.dailyBudget ?? object.budget : object.bid, currency)], ["匹配/表达式", object.type === "keyword" ? matchTypeLabel(object.matchType) : object.targetingExpression || "—"], ["目标 ACOS", numberText(object.targetAcos, "%")], ["依赖记录", dependencyCount]], note: dependencyReason || "广告对象维护不会直接触发 Amazon Ads 写入。" })} onEdit={!archived ? () => setEditor({ kind: "adObject", record: object }) : undefined} onArchive={!archived && !dependencyReason ? () => archiveAdObject(object) : undefined} archiveBlockedReason={!archived ? dependencyReason : undefined} onRestore={archived && restoreAvailable ? () => restoreAdObject(object) : undefined} restoreBlockedReason={archived && !restoreAvailable ? !productAvailable ? "父产品已删除或归档" : "请先恢复父级广告对象" : undefined} onDelete={() => dependencyReason ? notify?.(`${dependencyReason}，不能删除`, "danger") : setConfirm({ kind: "adObject", record: object })} />;
    } },
  ];

  const currentCount = tab === "products" ? visibleProducts.length : visibleAdObjects.length;
  return (
    <div className="workspace objects-workspace">
      <WorkspaceHeader
        eyebrow="业务对象"
        title="店铺与广告对象"
        description="维护 Mission 可引用的产品、广告活动、广告组与投放目标；不会在此处执行 Ads 写入。"
        actions={<Button variant="primary" leadingIcon={Plus} onClick={() => setEditor({ kind: tab === "products" ? "product" : "adObject", record: null })}>{tab === "products" ? "新增产品" : "新增广告对象"}</Button>}
      />
      <StoreIsolationNotice store={store} />

      <Panel className="object-directory-panel">
        <div className="toolbar object-directory-toolbar">
          <div className="tabs" role="tablist" aria-label="对象类型">
            <button id="objects-tab-products" aria-controls="objects-panel-products" tabIndex={tab === "products" ? 0 : -1} type="button" role="tab" aria-selected={tab === "products"} className={tab === "products" ? "active" : ""} onKeyDown={(event) => selectTabFromKeyboard(event, ["products", "adObjects"], tab, (value) => { setTab(value); setQuery(""); })} onClick={() => { setTab("products"); setQuery(""); }}>产品 <Badge>{products.length}</Badge></button>
            <button id="objects-tab-adObjects" aria-controls="objects-panel-adObjects" tabIndex={tab === "adObjects" ? 0 : -1} type="button" role="tab" aria-selected={tab === "adObjects"} className={tab === "adObjects" ? "active" : ""} onKeyDown={(event) => selectTabFromKeyboard(event, ["products", "adObjects"], tab, (value) => { setTab(value); setQuery(""); })} onClick={() => { setTab("adObjects"); setQuery(""); }}>广告对象 <Badge>{adObjects.length}</Badge></button>
          </div>
          <span className="spacer" />
          <SearchControl value={query} onChange={setQuery} placeholder={tab === "products" ? "搜索 SKU、ASIN 或名称" : "搜索名称或 Amazon ID"} />
          <label className="checkbox-filter"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /><span>显示已归档</span></label>
          <Badge tone="info">当前 {currentCount} 项</Badge>
        </div>
        <div id={`objects-panel-${tab}`} role="tabpanel" aria-labelledby={`objects-tab-${tab}`}>
          <DataTable
            caption={tab === "products" ? "产品目录" : "广告对象目录"}
            columns={tab === "products" ? productColumns : adColumns}
            rows={tab === "products" ? visibleProducts : visibleAdObjects}
            emptyTitle={query ? "没有匹配对象" : tab === "products" ? "当前店铺还没有产品" : "当前店铺还没有广告对象"}
            emptyDescription={query ? "调整搜索词或显示已归档对象。" : "创建对象后，Mission、实验和策略才能引用稳定业务范围。"}
            emptyAction={!query ? <Button variant="primary" leadingIcon={Plus} onClick={() => setEditor({ kind: tab === "products" ? "product" : "adObject", record: null })}>立即创建</Button> : undefined}
          />
        </div>
      </Panel>

      <ProductEditor open={editor?.kind === "product"} record={editor?.record} store={store} onClose={() => setEditor(null)} onSave={saveProduct} />
      <AdObjectEditor open={editor?.kind === "adObject"} record={editor?.record} store={store} onClose={() => setEditor(null)} onSave={saveAdObject} />
      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={performDelete}
        title={confirm?.kind === "product" ? "删除产品？" : "删除广告对象？"}
        description="仅无下级对象、Mission、实验、决策、执行或策略依赖的对象可删除；删除不会静默级联。"
        confirmLabel="确认删除"
      >
        <p className="confirm-object-name">{confirm?.record?.name || confirm?.record?.sku}</p>
      </ConfirmDialog>
    </div>
  );
}

function collectionJobInitial(record) {
  const source = record?.source || "lingxing";
  const rawReportType = record?.reportType === "ads" ? "ads_campaign" : record?.reportType === "search-term" ? "search_term" : record?.reportType;
  return {
    name: record?.name || "",
    source,
    reportType: REPORT_TYPES_BY_SOURCE[source]?.has(rawReportType) ? rawReportType : source === "amazon_ads" ? "ads_campaign" : "business",
    frequencyMinutes: record?.frequencyMinutes ?? 60,
    status: record?.status === "paused" ? "paused" : "enabled",
  };
}

function CollectionJobEditor({ open, record, store, onClose, onSave }) {
  const [form, setForm] = useState(() => collectionJobInitial(record));
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (open) {
      setForm(collectionJobInitial(record));
      setErrors({});
    }
  }, [open, record]);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const reportOptions = REPORT_TYPE_OPTIONS.filter(([value]) => REPORT_TYPES_BY_SOURCE[form.source]?.has(value));
  const submit = (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = "请填写任务名称。";
    if (!(Number(form.frequencyMinutes) >= 15)) nextErrors.frequencyMinutes = "采集间隔不能少于 15 分钟。";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    onSave({ ...form, frequencyMinutes: Number(form.frequencyMinutes), kind: "job" });
  };
  return (
    <Modal open={open} onClose={onClose} title={record ? "编辑采集任务" : "新增采集任务"} description={`任务使用 ${storeIdOf(store)} 的隔离浏览器与本地数据库。`}>
      <form className="form-grid collection-job-form" onSubmit={submit} noValidate>
        <Field label="任务名称" error={errors.name} required className="span-2"><input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：领星业务报告每小时同步" autoFocus /></Field>
        <Field label="数据源" required>
          <select value={form.source} onChange={(event) => { const source = event.target.value; const allowed = REPORT_TYPE_OPTIONS.filter(([value]) => REPORT_TYPES_BY_SOURCE[source]?.has(value)); setForm((current) => ({ ...current, source, reportType: REPORT_TYPES_BY_SOURCE[source]?.has(current.reportType) ? current.reportType : allowed[0]?.[0] || "business" })); }}>
            <option value="lingxing">领星 ERP</option>
            <option value="amazon_ads">Amazon Ads</option>
          </select>
        </Field>
        <Field label="报告类型" hint={`仅显示 ${collectionSourceLabel(form.source)} 支持的报告。`} required><select value={form.reportType} onChange={(event) => update("reportType", event.target.value)}>{reportOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
        <Field label="采集间隔（分钟）" error={errors.frequencyMinutes} hint="最短 15 分钟。" required><input type="number" min="15" step="15" value={form.frequencyMinutes} onChange={(event) => update("frequencyMinutes", event.target.value)} /></Field>
        <Field label="任务状态" required><select value={form.status} onChange={(event) => update("status", event.target.value)}><option value="enabled">启用</option><option value="paused">暂停</option></select></Field>
        <div className="dialog-actions span-2"><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" type="submit">{record ? "保存修改" : "创建任务"}</Button></div>
      </form>
    </Modal>
  );
}

function reportImportInitial(store) {
  const today = businessDateValue(new Date(), runtimeTimezone(store));
  return { fileName: "", reportType: "business", source: "local_csv", periodStart: today, periodEnd: today, note: "" };
}

const REPORT_IMPORT_TYPES_BY_SOURCE = {
  local_csv: new Set(REPORT_TYPE_OPTIONS.map(([value]) => value)),
  lingxing_export: REPORT_TYPES_BY_SOURCE.lingxing,
  amazon_export: REPORT_TYPES_BY_SOURCE.amazon_ads,
};

function ReportImportModal({ open, store, onClose, onSave }) {
  const [form, setForm] = useState(() => reportImportInitial(store));
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (open) {
      setForm(reportImportInitial(store));
      setErrors({});
    }
  }, [open, storeIdOf(store), runtimeTimezone(store)]);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const reportOptions = REPORT_TYPE_OPTIONS.filter(([value]) => REPORT_IMPORT_TYPES_BY_SOURCE[form.source]?.has(value));
  const submit = (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.fileName.trim()) nextErrors.fileName = "请选择或填写本地报告文件。";
    if (asList(store?.reportImports).some((record) => String(record.fileName || record.name || "").toLowerCase() === form.fileName.trim().toLowerCase())) nextErrors.fileName = "当前店铺已导入同名报告。";
    if (!form.periodStart || !form.periodEnd) nextErrors.period = "请选择完整报告区间。";
    if (form.periodStart && form.periodEnd && form.periodStart > form.periodEnd) nextErrors.period = "开始日期不能晚于结束日期。";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    onSave(form);
  };
  return (
    <Modal open={open} onClose={onClose} title="导入本地报告" description={`文件只进入 ${storeIdOf(store)} 的本地数据域，本原型不会上传外部服务器。`}>
      <form className="form-grid report-import-form" onSubmit={submit} noValidate>
        <Field label="本地文件" error={errors.fileName} hint="演示环境记录文件名；真实产品由系统文件选择器读取。" required className="span-2">
          <input value={form.fileName} onChange={(event) => update("fileName", event.target.value)} placeholder="例如：BusinessReport_2026-07-20.xlsx" autoFocus />
        </Field>
        <Field label="报告类型" hint="报告类型会按文件来源约束。" required><select value={form.reportType} onChange={(event) => update("reportType", event.target.value)}>{reportOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
        <Field label="文件来源" required><select value={form.source} onChange={(event) => { const source = event.target.value; const allowed = REPORT_TYPE_OPTIONS.filter(([value]) => REPORT_IMPORT_TYPES_BY_SOURCE[source]?.has(value)); setForm((current) => ({ ...current, source, reportType: REPORT_IMPORT_TYPES_BY_SOURCE[source]?.has(current.reportType) ? current.reportType : allowed[0]?.[0] || "business" })); }}><option value="local_csv">本地文件</option><option value="lingxing_export">领星导出</option><option value="amazon_export">Amazon 导出</option></select></Field>
        <Field label="开始日期" error={errors.period} required><input type="date" value={form.periodStart} onChange={(event) => update("periodStart", event.target.value)} /></Field>
        <Field label="结束日期" error={errors.period} required><input type="date" value={form.periodEnd} onChange={(event) => update("periodEnd", event.target.value)} /></Field>
        <Field label="导入备注" className="span-2"><textarea value={form.note} onChange={(event) => update("note", event.target.value)} placeholder="可选：说明补数原因或报表版本" /></Field>
        <div className="dialog-actions span-2"><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" type="submit" leadingIcon={CloudArrowUp}>开始导入</Button></div>
      </form>
    </Modal>
  );
}

function collectionSessionFor(store, job) {
  if (job?.source === "amazon_ads") return store?.session?.amazonAds || {};
  return store?.session?.lingxing || {};
}

function collectionBrowserUrl(job) {
  if (job?.source === "amazon_ads") return "https://advertising.amazon.com/cm/reports";
  return "https://erp.lingxing.com/report-center/download";
}

function collectionDownloadName(store, job, timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  const dateToken = Number.isNaN(date.getTime()) ? "latest" : businessDateValue(date, runtimeTimezone(store)).replaceAll("-", "");
  const reportToken = String(job?.reportType || "report").replaceAll("-", "_");
  return `${storeIdOf(store)}_${reportToken}_${dateToken}.xlsx`;
}

function CollectionMonitorModal({ open, jobId, store, onClose, onRun, onOpenSessionCenter, notify }) {
  const [takeover, setTakeover] = useState(false);
  const [runState, setRunState] = useState({ status: "idle", message: "" });
  const allRuns = asList(store?.collectionRuns);
  const jobs = asList(store?.collectionJobs).length
    ? asList(store?.collectionJobs)
    : allRuns.filter((run) => !run.kind || run.kind === "job");
  const liveJob = jobs.find((job) => job.id === jobId) || null;
  const sourceSession = collectionSessionFor(store, liveJob);
  const sourceConnected = sourceSession.status === "connected";
  const browserProfile = store?.session?.profile
    || store?.session?.browserProfileId
    || store?.session?.amazonAds?.profileId
    || `${storeIdOf(store)}-isolated-profile`;
  const completed = liveJob?.status === "completed" && Number(liveJob?.progress || 0) >= 100;
  const recentImport = [...asList(store?.reportImports)]
    .filter((record) => !liveJob || !record.reportType || record.reportType === liveJob.reportType)
    .sort((a, b) => new Date(b.importedAt || b.createdAt || 0) - new Date(a.importedAt || a.createdAt || 0))[0];
  const evidenceRecord = [...asList(store?.audit)]
    .filter((record) => record.entityType === "collectionJob" && record.entityId === jobId)
    .sort((a, b) => new Date(b.at || b.createdAt || 0) - new Date(a.at || a.createdAt || 0))[0];
  const observedAt = liveJob?.completedAt || liveJob?.lastRunAt || recentImport?.importedAt;
  const rowCount = Number(liveJob?.records ?? recentImport?.rowCount ?? 0);
  const evidenceId = evidenceRecord?.id || (liveJob ? `EVD-${storeIdOf(store)}-${String(liveJob.id).slice(-8).toUpperCase()}` : "—");
  const downloadRows = liveJob ? [{
    id: recentImport?.id || `download-${liveJob.id}`,
    fileName: recentImport?.fileName || collectionDownloadName(store, liveJob, observedAt),
    status: completed ? "已校验并入库" : liveJob.status === "empty" ? "空报告，未入库" : liveJob.status === "failed" ? "采集失败" : "等待下载",
    rowCount,
    at: observedAt,
  }] : [];

  useEffect(() => {
    if (!open) return;
    setTakeover(false);
    setRunState({ status: "idle", message: "" });
  }, [open, jobId, storeIdOf(store)]);

  if (!liveJob) return null;

  const runAndObserve = () => {
    setTakeover(false);
    setRunState({ status: "running", message: "已提交采集任务，正在观察可见浏览器。" });
    const validation = onRun?.(liveJob);
    if (validation?.ok === false) {
      setRunState({ status: "blocked", message: validation.message || "采集任务已被安全阻断。" });
      return;
    }
    setRunState({ status: "completed", message: "演示采集已完成，下载、入库与审计证据已回读。" });
  };

  const requestReconnect = () => {
    if (onOpenSessionCenter) {
      onOpenSessionCenter({ source: liveJob.source, returnTo: "collection", jobId: liveJob.id });
      return;
    }
    notify?.("会话中心尚未接入；请从顶部会话状态入口重新连接。", "warning");
  };

  const stepState = (index) => {
    if (runState.status === "blocked" && index >= 2) return index === 2 ? "blocked" : "pending";
    if (liveJob.status === "empty") return index <= 3 ? "completed" : index === 4 ? "blocked" : "pending";
    if (completed || runState.status === "completed") return "completed";
    if (index === 0) return "completed";
    if (index === 1) return sourceConnected ? "completed" : "blocked";
    if (runState.status === "running" && index === 2) return "running";
    return "pending";
  };
  const steps = [
    ["确认隔离 Profile", `${browserProfile} · ${storeIdOf(store)} 专属`],
    ["校验来源会话", `${collectionSourceLabel(liveJob.source)} · ${statusLabel(sourceSession.status, "未连接")}`],
    ["打开报告并提交日期范围", reportTypeLabel(liveJob.reportType)],
    ["在下载中心等待文件", downloadRows[0]?.fileName || "等待文件名"],
    ["校验字段并写入本地数据库", liveJob.status === "empty" ? "0 行 · 未入库" : rowCount ? `${rowCount.toLocaleString("zh-CN")} 行` : "等待行数"],
    ["生成因果与审计证据", evidenceId],
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="可见采集监控"
      description={`${liveJob.name} · 所有画面均为可交互原型模拟，不会连接真实领星或 Amazon Ads。`}
      size="large"
      className="collection-monitor-modal"
      footer={(
        <>
          <div className="collection-monitor-footer-copy" role="status" aria-live="polite">
            <StatusBadge status={runState.status === "blocked" ? "blocked" : completed || runState.status === "completed" ? "completed" : liveJob.status || "idle"} />
            <span>{runState.message || (sourceConnected ? "会话已通过，可开始一次演示采集。" : "来源会话未连接，运行会被安全阻断。")}</span>
          </div>
          <Button variant="ghost" onClick={onClose}>关闭</Button>
          <Button variant="secondary" leadingIcon={Browser} onClick={requestReconnect}>重新连接会话</Button>
          <Button variant="primary" leadingIcon={runState.status === "running" ? Pulse : Play} onClick={runAndObserve} disabled={liveJob.status === "running" || takeover}>{liveJob.status === "failed" ? "重试并观察" : "运行并观察"}</Button>
        </>
      )}
    >
      <div className="collection-monitor-alert" role="note">
        <WarningCircle size={17} weight="fill" aria-hidden="true" />
        <div><strong>原型模拟 · 不连接真实系统</strong><span>这里演示未来 Windows 客户端中真实可见浏览器、领星下载中心与人工接管的完整工作方式。</span></div>
      </div>

      <div className="collection-monitor-layout">
        <section className="collection-browser-stage" aria-label="可见浏览器模拟">
          <header className="collection-browser-titlebar">
            <div className="collection-browser-dots" aria-hidden="true"><i /><i /><i /></div>
            <span><Browser size={15} weight="fill" /> 采集浏览器 · {storeIdOf(store)}</span>
            <Badge tone={takeover ? "warning" : sourceConnected ? "success" : "danger"}>{takeover ? "人工接管中" : sourceConnected ? "会话受控" : "等待登录"}</Badge>
          </header>
          <div className="collection-browser-toolbar">
            <button type="button" aria-label="后退" disabled>←</button>
            <button type="button" aria-label="刷新模拟页面" onClick={() => notify?.("模拟页面已刷新，不会发起真实网络请求。", "info")}>↻</button>
            <div className="collection-browser-address"><LockKey size={13} /><span>{collectionBrowserUrl(liveJob)}</span></div>
            <Badge tone="neutral">只读模拟</Badge>
          </div>
          <div className="collection-browser-page">
            <aside className="collection-browser-nav" aria-label="模拟领星导航">
              <strong>{liveJob.source === "amazon_ads" ? "Amazon Ads" : "领星 ERP"}</strong>
              <span>经营概览</span>
              <span className="active">报告中心</span>
              <span>广告管理</span>
              <span>下载中心</span>
            </aside>
            <div className="collection-browser-content">
              <div className="collection-browser-pagehead">
                <div><small>报告中心 / 下载中心</small><h3>{reportTypeLabel(liveJob.reportType)}</h3></div>
                <StatusBadge status={sourceConnected ? "connected" : "disconnected"}>{sourceConnected ? "当前会话已登录" : "需要重新登录"}</StatusBadge>
              </div>
              <div className="collection-browser-filters">
                <span><small>店铺</small><strong>{storeNameOf(store)}</strong></span>
                <span><small>报告日期</small><strong>最近 7 天</strong></span>
                <span><small>报告类型</small><strong>{reportTypeLabel(liveJob.reportType)}</strong></span>
                <button type="button" disabled={!takeover}>{takeover ? "人工可操作" : "由 Agent 控制"}</button>
              </div>
              <section className="collection-download-center" aria-labelledby="collection-download-title">
                <div className="collection-download-head"><div><small>DOWNLOAD CENTER</small><h4 id="collection-download-title">下载中心</h4></div><span>{downloadRows.length} 个文件</span></div>
                <div className="collection-download-table" role="table" aria-label="领星下载中心记录">
                  <div className="collection-download-row collection-download-header" role="row"><span role="columnheader">文件</span><span role="columnheader">生成时间</span><span role="columnheader">数据行</span><span role="columnheader">状态</span></div>
                  {downloadRows.map((record) => (
                    <div className="collection-download-row" role="row" key={record.id}>
                      <span role="cell"><strong>{record.fileName}</strong><small>{reportTypeLabel(liveJob.reportType)}</small></span>
                      <span role="cell">{formatTime(record.at, runtimeTimezone(store))}</span>
                      <span role="cell">{liveJob.status === "empty" ? "0（空报告）" : record.rowCount ? record.rowCount.toLocaleString("zh-CN") : "—"}</span>
                      <span role="cell"><Badge tone={completed ? "success" : liveJob.status === "failed" ? "danger" : "warning"}>{record.status}</Badge></span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
          <footer className="collection-browser-statusbar">
            <span><span className={`session-dot ${sourceConnected ? "connected" : "blocked"}`} />Profile：{browserProfile}</span>
            <span>URL 已脱敏 · Cookie 不进入界面</span>
            <Button variant={takeover ? "warning" : "secondary"} size="small" leadingIcon={Eye} onClick={() => { setTakeover((value) => !value); setRunState({ status: "idle", message: takeover ? "已把控制权交还 Agent。" : "已暂停 Agent 并进入人工接管；退出后可继续运行。" }); }}>{takeover ? "交还 Agent" : "接管浏览器"}</Button>
          </footer>
        </section>

        <aside className="collection-monitor-rail" aria-label="采集运行证据">
          <section className="collection-monitor-context">
            <div className="collection-monitor-sectionhead"><small>RUN CONTEXT</small><h3>运行上下文</h3></div>
            <dl>
              <div><dt>当前任务</dt><dd>{liveJob.name}</dd></div>
              <div><dt>来源</dt><dd>{collectionSourceLabel(liveJob.source)}</dd></div>
              <div><dt>Profile</dt><dd>{browserProfile}</dd></div>
              <div><dt>会话</dt><dd><StatusBadge status={sourceSession.status || "disconnected"} /></dd></div>
              <div><dt>最近完成</dt><dd>{formatTime(observedAt, runtimeTimezone(store))}</dd></div>
            </dl>
          </section>
          <section className="collection-monitor-steps">
            <div className="collection-monitor-sectionhead"><small>OBSERVABLE STEPS</small><h3>采集步骤</h3></div>
            <ol>
              {steps.map(([title, detail], index) => {
                const status = stepState(index);
                return (
                  <li key={title} className={`is-${status}`}>
                    <span className="collection-step-marker">{status === "completed" ? <CheckCircle size={17} weight="fill" /> : status === "blocked" ? <WarningCircle size={17} weight="fill" /> : status === "running" ? <Pulse size={17} weight="fill" /> : index + 1}</span>
                    <div><strong>{title}</strong><small>{detail}</small></div>
                  </li>
                );
              })}
            </ol>
          </section>
          <section className="collection-evidence-card">
            <div className="collection-monitor-sectionhead"><small>READBACK EVIDENCE</small><h3>本次证据</h3></div>
            <div className="collection-evidence-grid">
              <div><small>证据 ID</small><strong>{evidenceId}</strong></div>
              <div><small>写入行数</small><strong>{liveJob.status === "empty" ? "0（未入库）" : rowCount ? rowCount.toLocaleString("zh-CN") : "等待"}</strong></div>
              <div><small>回读时间</small><strong>{formatTime(observedAt, runtimeTimezone(store))}</strong></div>
              <div><small>隔离范围</small><strong>{storeIdOf(store)}</strong></div>
            </div>
          </section>
        </aside>
      </div>
    </Modal>
  );
}

export function CollectionWorkspace({ store, dispatch, onNavigate: _onNavigate, openInspector, notify, onOpenSessionCenter, focusTarget }) {
  const [tab, setTab] = useState("jobs");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [jobEditor, setJobEditor] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [monitorJobId, setMonitorJobId] = useState(null);
  const allRuns = asList(store?.collectionRuns);
  const jobs = asList(store?.collectionJobs).length ? asList(store?.collectionJobs) : allRuns.filter((run) => !run.kind || run.kind === "job");
  const reportImports = asList(store?.reportImports).length ? asList(store?.reportImports) : allRuns.filter((run) => run.kind === "report_import");
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    setQuery("");
    setStatusFilter("all");
    setJobEditor(null);
    setImportOpen(false);
    setConfirm(null);
    setMonitorJobId(null);
  }, [storeIdOf(store)]);

  useEffect(() => {
    if (focusTarget?.kind === "collectionJob") {
      const target = jobs.find((job) => job.id === focusTarget.id);
      if (!target) return;
      setTab("jobs");
      setStatusFilter("all");
      setQuery("");
      if (!target.archived && target.status !== "archived") setMonitorJobId(target.id);
      else openInspector?.({ eyebrow: "已归档采集任务", title: target.name, fields: [["来源", collectionSourceLabel(target.source)], ["报告", reportTypeLabel(target.reportType)], ["状态", statusLabel(target.status)], ["最近运行", formatTime(target.lastRunAt, runtimeTimezone(store))]], note: target.error || "已归档任务不可运行，可先恢复。" });
    }
    if (focusTarget?.kind === "reportImport") {
      const target = reportImports.find((report) => report.id === focusTarget.id);
      if (!target) return;
      setTab("imports");
      setStatusFilter("all");
      setQuery(target.fileName || target.name || "");
      openInspector?.({ eyebrow: "报表导入", title: target.fileName || target.name, fields: [["报告类型", reportTypeLabel(target.reportType)], ["数据行", target.rowCount ?? 0], ["导入时间", formatTime(target.importedAt, runtimeTimezone(store))], ["证据 ID", target.evidenceId || "手动导入"]], note: `记录仅属于 ${storeIdOf(store)}。` });
    }
  }, [focusTarget?.nonce, storeIdOf(store)]);

  const matchesFilters = (record) => {
    const matchesQuery = !normalizedQuery || `${record.name || ""} ${record.fileName || ""} ${record.source || ""} ${record.reportType || ""}`.toLowerCase().includes(normalizedQuery);
    const matchesStatus = statusFilter === "all" || statusOf(record, "idle") === statusFilter;
    return matchesQuery && matchesStatus;
  };
  const visibleJobs = jobs.filter(matchesFilters);
  const visibleImports = reportImports.filter(matchesFilters);
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const monitorCandidate = jobs.find((job) => !job.archived && job.status !== "archived");

  const saveJob = (values) => {
    let validation;
    if (jobEditor?.record) {
      const collectionJob = { ...jobEditor.record, ...values, updatedAt: new Date().toISOString() };
      validation = dispatchAction(dispatch, "UPDATE_COLLECTION_JOB", { collectionJobId: collectionJob.id, id: collectionJob.id, updates: values, collectionJob });
      if (validation?.ok === false) return notify?.(validation.message || "采集任务未能更新", "danger");
      notify?.(`采集任务 ${collectionJob.name} 已更新`);
    } else {
      const collectionJob = { ...values, id: makeId("collection"), storeId: storeIdOf(store), progress: 0, archived: false, createdAt: new Date().toISOString() };
      validation = dispatchAction(dispatch, "CREATE_COLLECTION_JOB", { collectionJob });
      if (validation?.ok === false) return notify?.(validation.message || "采集任务未能创建", "danger");
      notify?.(`采集任务 ${collectionJob.name} 已创建`);
    }
    setJobEditor(null);
  };

  const runJob = (job) => {
    const validation = dispatchAction(dispatch, "RUN_COLLECTION_JOB", { collectionJobId: job.id, id: job.id });
    if (validation?.ok === false) notify?.(validation.message || `${job.name} 已被安全阻断`, "danger");
    else notify?.(`${job.name} 已完成一次演示采集并写入审计`, "info");
    return validation;
  };

  const importReport = (values) => {
    const reportImport = {
      ...values,
      id: makeId("report-import"),
      kind: "report_import",
      status: "completed",
      progress: 100,
      storeId: storeIdOf(store),
      importedAt: new Date().toISOString(),
    };
    const validation = dispatchAction(dispatch, "CREATE_REPORT_IMPORT", { reportImport });
    if (validation?.ok === false) return notify?.(validation.message || "报表未能导入", "danger");
    setImportOpen(false);
    notify?.(`${values.fileName} 已导入当前店铺`);
  };

  const performDelete = () => {
    if (!confirm) return;
    let validation;
    if (confirm.kind === "job") {
      validation = dispatchAction(dispatch, "DELETE_COLLECTION_JOB", { collectionJobId: confirm.record.id, id: confirm.record.id });
      notify?.(validation?.ok === false ? validation.message : `采集任务 ${confirm.record.name} 已删除`, validation?.ok === false ? "danger" : "info");
    } else {
      validation = dispatchAction(dispatch, "DELETE_REPORT_IMPORT", { reportImportId: confirm.record.id, id: confirm.record.id });
      notify?.(validation?.ok === false ? validation.message : `导入记录 ${confirm.record.fileName || confirm.record.name} 已删除`, validation?.ok === false ? "danger" : "info");
    }
    if (validation?.ok !== false) setConfirm(null);
  };

  const jobColumns = [
    { key: "job", header: "采集任务", render: (job) => <div className="table-primary-cell"><strong>{job.name}</strong><small>{collectionSourceLabel(job.source)} · {reportTypeLabel(job.reportType)}</small></div> },
    { key: "frequency", header: "频率", render: (job) => job.frequencyMinutes ? `每 ${job.frequencyMinutes} 分钟` : job.frequency || "手动" },
    { key: "lastRun", header: "最近运行", render: (job) => <div className="table-stacked-value"><strong>{formatTime(job.lastRunAt || job.updatedAt, runtimeTimezone(store))}</strong><small>下次 {formatTime(job.nextRunAt, runtimeTimezone(store))}</small></div> },
    { key: "progress", header: "进度", render: (job) => <div className="table-progress-cell"><div className="progress-track"><span style={{ width: `${Number(job.progress || 0)}%` }} /></div><small>{Number(job.progress || 0)}%</small></div> },
    { key: "status", header: "状态", render: (job) => <StatusBadge status={statusOf(job, "idle")} /> },
    { key: "actions", header: "操作", render: (job) => {
      const archived = job.archived || job.status === "archived";
      const linkedImportCount = reportImports.filter((report) => report.collectionJobId === job.id).length;
      const deleteBlockedReason = linkedImportCount ? `已关联 ${linkedImportCount} 份入库报告，请保留任务来源链路` : undefined;
      return <div className="table-actions"><IconButton icon={MonitorPlay} label="打开可见采集监控" size="small" disabled={archived} onClick={() => setMonitorJobId(job.id)} /><IconButton icon={job.status === "running" ? Pulse : Play} label={job.status === "failed" ? "重试采集" : "立即运行"} size="small" disabled={job.status === "running" || archived} onClick={() => runJob(job)} /><ActionButtons onInspect={InspectorAction({ openInspector, record: job, eyebrow: "数据采集任务", title: job.name, fields: [["数据源", collectionSourceLabel(job.source)], ["状态", statusLabel(statusOf(job))], ["最近运行", formatTime(job.lastRunAt, runtimeTimezone(store))], ["下次运行", formatTime(job.nextRunAt, runtimeTimezone(store))]], note: job.error || `使用 ${storeIdOf(store)} 的隔离会话运行。` })} onEdit={!archived ? () => setJobEditor({ record: job }) : undefined} onArchive={!archived ? () => { const validation = dispatchAction(dispatch, "ARCHIVE_COLLECTION_JOB", { collectionJobId: job.id, id: job.id }); notify?.(validation?.ok === false ? validation.message : `${job.name} 已归档`, validation?.ok === false ? "danger" : "info"); } : undefined} onRestore={archived ? () => { const validation = dispatchAction(dispatch, "UPDATE_COLLECTION_JOB", { collectionJobId: job.id, id: job.id, updates: { archived: false, status: "paused" }, collectionJob: { ...job, archived: false, status: "paused" } }); notify?.(validation?.ok === false ? validation.message : `${job.name} 已恢复`, validation?.ok === false ? "danger" : "success"); } : undefined} onDelete={() => setConfirm({ kind: "job", record: job })} deleteBlockedReason={deleteBlockedReason} /></div>;
    } },
  ];

  const importColumns = [
    { key: "file", header: "导入文件", render: (record) => <div className="table-primary-cell"><strong>{record.fileName || record.name}</strong><small>{reportTypeLabel(record.reportType)}</small></div> },
    { key: "period", header: "报告区间", render: (record) => record.period || `${record.periodStart || "—"} 至 ${record.periodEnd || "—"}` },
    { key: "source", header: "来源", render: (record) => record.source || "local_csv" },
    { key: "time", header: "导入时间", render: (record) => formatTime(record.importedAt || record.createdAt, runtimeTimezone(store)) },
    { key: "status", header: "校验", render: (record) => <StatusBadge status={record.status || "completed"} /> },
    { key: "actions", header: "操作", render: (record) => <ActionButtons onInspect={InspectorAction({ openInspector, record, eyebrow: "报告导入", title: record.fileName || record.name, fields: [["报告类型", reportTypeLabel(record.reportType)], ["日期区间", `${record.periodStart} 至 ${record.periodEnd}`], ["导入时间", formatTime(record.importedAt, runtimeTimezone(store))], ["校验状态", statusLabel(record.status || "completed")]], note: record.note || `数据仅写入 ${storeIdOf(store)}。` })} onDelete={() => setConfirm({ kind: "import", record })} /> },
  ];

  return (
    <div className="workspace collection-workspace">
      <WorkspaceHeader
        eyebrow="数据采集"
        title="数据采集与报告导入"
        description="所有采集通过当前店铺隔离会话运行；失败、重试与本地导入都有可见状态。"
        actions={(
          <>
            {monitorCandidate ? <Button variant="secondary" leadingIcon={MonitorPlay} onClick={() => setMonitorJobId(monitorCandidate.id)}>打开可见采集</Button> : null}
            <Button variant="secondary" leadingIcon={FileArrowUp} onClick={() => setImportOpen(true)}>导入报告</Button>
            <Button variant="primary" leadingIcon={Plus} onClick={() => setJobEditor({ record: null })}>新增采集任务</Button>
          </>
        )}
      />
      <StoreIsolationNotice store={store}>采集会话、报告文件与导入记录按店铺隔离，切换店铺不会复用当前队列。</StoreIsolationNotice>
      <div className="summary-strip collection-summary-strip" aria-label="采集状态摘要">
        <div><small>采集任务</small><strong>{jobs.length} 个</strong></div>
        <div><small>正在运行</small><strong>{runningCount} 个</strong></div>
        <div><small>需要处理</small><strong>{failedCount} 个失败</strong></div>
        <div><small>本地导入</small><strong>{reportImports.length} 份</strong></div>
      </div>
      <Panel className="collection-directory-panel">
        <div className="toolbar collection-toolbar">
          <div className="tabs" role="tablist" aria-label="采集内容类型">
            <button id="collection-tab-jobs" aria-controls="collection-panel-jobs" tabIndex={tab === "jobs" ? 0 : -1} type="button" role="tab" aria-selected={tab === "jobs"} className={tab === "jobs" ? "active" : ""} onKeyDown={(event) => selectTabFromKeyboard(event, ["jobs", "imports"], tab, setTab)} onClick={() => setTab("jobs")}>采集任务 <Badge>{jobs.length}</Badge></button>
            <button id="collection-tab-imports" aria-controls="collection-panel-imports" tabIndex={tab === "imports" ? 0 : -1} type="button" role="tab" aria-selected={tab === "imports"} className={tab === "imports" ? "active" : ""} onKeyDown={(event) => selectTabFromKeyboard(event, ["jobs", "imports"], tab, setTab)} onClick={() => setTab("imports")}>报告导入 <Badge>{reportImports.length}</Badge></button>
          </div>
          <span className="spacer" />
          <SearchControl value={query} onChange={setQuery} placeholder="搜索任务、来源或文件" />
          <label className="filter-select"><Funnel size={15} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="按状态筛选"><option value="all">全部状态</option><option value="running">运行中</option><option value="completed">已完成</option><option value="failed">失败</option><option value="paused">已暂停</option><option value="archived">已归档</option></select></label>
        </div>
        <div id={`collection-panel-${tab}`} role="tabpanel" aria-labelledby={`collection-tab-${tab}`}>
          <DataTable
            caption={tab === "jobs" ? "数据采集任务" : "报告导入记录"}
            columns={tab === "jobs" ? jobColumns : importColumns}
            rows={tab === "jobs" ? visibleJobs : visibleImports}
            emptyTitle={query || statusFilter !== "all" ? "筛选条件下没有记录" : tab === "jobs" ? "尚未配置采集任务" : "尚未导入报告"}
            emptyDescription={query || statusFilter !== "all" ? "调整搜索或状态筛选。" : tab === "jobs" ? "创建任务后，Mission 会读取可追溯的数据新鲜度。" : "导入本地报告，为当前店铺补齐历史数据。"}
            emptyAction={tab === "jobs" ? <Button variant="primary" leadingIcon={Plus} onClick={() => setJobEditor({ record: null })}>创建任务</Button> : <Button variant="primary" leadingIcon={FileArrowUp} onClick={() => setImportOpen(true)}>导入报告</Button>}
          />
        </div>
      </Panel>
      <CollectionJobEditor open={Boolean(jobEditor)} record={jobEditor?.record} store={store} onClose={() => setJobEditor(null)} onSave={saveJob} />
      <ReportImportModal open={importOpen} store={store} onClose={() => setImportOpen(false)} onSave={importReport} />
      <CollectionMonitorModal open={Boolean(monitorJobId)} jobId={monitorJobId} store={store} onClose={() => setMonitorJobId(null)} onRun={runJob} onOpenSessionCenter={onOpenSessionCenter} notify={notify} />
      <ConfirmDialog open={Boolean(confirm)} onClose={() => setConfirm(null)} onConfirm={performDelete} title={confirm?.kind === "job" ? "删除采集任务？" : "删除报告导入记录？"} description={confirm?.kind === "job" ? "任务配置会被移除，已有采集历史仍保留在因果审计中。" : "导入记录及其演示数据会从当前店铺移除。"} confirmLabel="确认删除"><p className="confirm-object-name">{confirm?.record?.name || confirm?.record?.fileName}</p></ConfirmDialog>
    </div>
  );
}

function firstPolicyRule(policy) {
  if (Array.isArray(policy?.rules)) return policy.rules[0] || {};
  return policy?.rules || policy?.rule || {};
}

function policyInitial(record) {
  const rule = firstPolicyRule(record);
  const legacyMetric = rule.maxAutoBidDecreasePct !== undefined
    ? "bidChangePct"
    : rule.maxDailyBudgetChangePct !== undefined
      ? "budgetChangePct"
    : rule.minDataFreshnessMinutes !== undefined || rule.requireFreshDataMinutes !== undefined
      ? "dataFreshnessMinutes"
      : record?.scope === "data" ? "dataFreshnessMinutes" : "bidChangePct";
  const metric = rule.metric || rule.field || record?.metric || legacyMetric;
  const legacyOutcome = legacyMetric === "dataFreshnessMinutes" ? "block" : "require_approval";
  return {
    name: record?.name || "",
    scope: typeof record?.scope === "string" ? record.scope : "store",
    status: ["active", "paused"].includes(record?.status) ? record.status : "active",
    priority: record?.priority ?? 50,
    metric,
    operator: rule.operator || record?.operator || ">",
    threshold: rule.threshold ?? rule.value ?? rule.minDataFreshnessMinutes ?? rule.requireFreshDataMinutes ?? rule.maxAutoBidDecreasePct ?? record?.threshold ?? 35,
    outcome: metric === "dataFreshnessMinutes" ? "block" : rule.action || rule.outcome || record?.action || legacyOutcome,
    maxChangePct: rule.maxChangePct ?? rule.maxAutoBidDecreasePct ?? rule.maxDailyBudgetChangePct ?? record?.maxChangePct ?? 15,
    riskBudget: record?.riskBudget ?? rule.riskBudget ?? 50,
    requireHumanApproval: Boolean(rule.requireHumanApproval),
  };
}

function PolicyEditor({ open, record, store, onClose, onSave }) {
  const [form, setForm] = useState(() => policyInitial(record));
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (open) {
      setForm(policyInitial(record));
      setErrors({});
    }
  }, [open, record]);
  const eligibleAdObjects = asList(store?.adObjects).filter((object) => {
    if (object.archived || ["archived", "deleted", "disabled", "paused"].includes(object.status)) return false;
    return form.metric === "budgetChangePct"
      ? object.type === "campaign"
      : ["keyword", "target"].includes(object.type);
  });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.name.trim()) nextErrors.name = "请填写策略名称。";
    if (asList(store?.policies).some((policy) => policy.id !== record?.id && policy.name.trim().toLowerCase() === form.name.trim().toLowerCase())) nextErrors.name = "当前店铺已存在同名策略。";
    if (!(Number(form.priority) >= 1 && Number(form.priority) <= 100)) nextErrors.priority = "优先级应在 1–100 之间。";
    if (form.metric === "dataFreshnessMinutes" && !(Number(form.threshold) > 0)) nextErrors.threshold = "数据延迟阈值必须大于 0。";
    if (form.metric === "bidChangePct" && !(Number(form.maxChangePct) > 0 && Number(form.maxChangePct) <= 15)) nextErrors.maxChangePct = "竞价自动调整上限应在 0–15% 之间。";
    if (form.metric === "budgetChangePct" && !(Number(form.maxChangePct) > 0 && Number(form.maxChangePct) <= 20)) nextErrors.maxChangePct = "预算自动调整上限应在 0–20% 之间。";
    if (form.scope.startsWith("adObject:") && !eligibleAdObjects.some((object) => `adObject:${object.id}` === form.scope)) nextErrors.scope = form.metric === "budgetChangePct" ? "日预算策略只能选择已启用的广告活动。" : "竞价策略只能选择已启用的关键词或商品投放对象。";
    if (!(Number(form.riskBudget) >= 0)) nextErrors.riskBudget = "审批参考额度不能小于 0。";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const rules = { ...firstPolicyRule(record), metric: form.metric, field: form.metric, action: form.metric === "dataFreshnessMinutes" ? "block" : form.outcome };
    if (form.metric === "bidChangePct") {
      delete rules.maxDailyBudgetChangePct;
      delete rules.minDataFreshnessMinutes;
      delete rules.requireFreshDataMinutes;
      rules.operator = "<=";
      rules.threshold = Number(form.maxChangePct);
      rules.value = Number(form.maxChangePct);
      rules.maxChangePct = Number(form.maxChangePct);
      rules.maxAutoBidDecreasePct = Number(form.maxChangePct);
      rules.maxAutoBidIncreasePct = Math.min(Number(form.maxChangePct), 10);
      rules.minBid = Number(firstPolicyRule(record).minBid ?? 0);
      rules.maxBid = Number(firstPolicyRule(record).maxBid ?? 999);
      rules.requireHumanApproval = Boolean(form.requireHumanApproval);
    }
    if (form.metric === "budgetChangePct") {
      delete rules.maxAutoBidDecreasePct;
      delete rules.maxAutoBidIncreasePct;
      delete rules.minBid;
      delete rules.maxBid;
      delete rules.minDataFreshnessMinutes;
      delete rules.requireFreshDataMinutes;
      rules.operator = "<=";
      rules.threshold = Number(form.maxChangePct);
      rules.value = Number(form.maxChangePct);
      rules.maxChangePct = Number(form.maxChangePct);
      rules.maxDailyBudgetChangePct = Number(form.maxChangePct);
      rules.requireHumanApproval = Boolean(form.requireHumanApproval);
    }
    if (form.metric === "dataFreshnessMinutes") {
      delete rules.maxAutoBidDecreasePct;
      delete rules.maxAutoBidIncreasePct;
      delete rules.maxDailyBudgetChangePct;
      delete rules.minBid;
      delete rules.maxBid;
      delete rules.requireHumanApproval;
      rules.operator = "<=";
      rules.threshold = Number(form.threshold);
      rules.value = Number(form.threshold);
      rules.minDataFreshnessMinutes = Number(form.threshold);
    }
    onSave({
      name: form.name.trim(),
      scope: form.scope,
      status: form.status,
      priority: Number(form.priority),
      riskBudget: Number(form.riskBudget),
      rules,
    });
  };
  return (
    <Modal open={open} onClose={onClose} title={record ? "编辑策略边界" : "新增策略边界"} description="策略决定 AI 可以在策略内自动执行、必须审批或应被阻断的范围。" size="large">
      <form className="form-grid policy-editor-form" onSubmit={submit} noValidate>
        <Field label="策略名称" error={errors.name} required className="span-2"><input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：高 ACOS 降价需人工审批" autoFocus /></Field>
        <Field label="作用范围" error={errors.scope} hint={form.metric === "dataFreshnessMinutes" ? "新鲜度门对当前店铺全部执行生效。" : "店铺、全部同类对象、产品或同类广告对象。"} required>
          <select value={form.scope} onChange={(event) => update("scope", event.target.value)}>
            {form.metric === "dataFreshnessMinutes" ? <option value="data">数据质量门</option> : null}
            {form.metric !== "dataFreshnessMinutes" ? <option value="store">整个店铺</option> : null}
            {form.metric !== "dataFreshnessMinutes" ? <option value={form.metric === "budgetChangePct" ? "budget" : "bid"}>{form.metric === "budgetChangePct" ? "全部预算对象" : "全部竞价对象"}</option> : null}
            {form.metric !== "dataFreshnessMinutes" ? asList(store?.products).filter((product) => !product.archived && product.status !== "archived").map((product) => <option value={`product:${product.id}`} key={product.id}>产品 · {product.sku || product.name}</option>) : null}
            {form.metric !== "dataFreshnessMinutes" ? eligibleAdObjects.map((object) => <option value={`adObject:${object.id}`} key={object.id}>广告对象 · {object.name}</option>) : null}
          </select>
        </Field>
        <Field label="状态" required><select value={form.status} onChange={(event) => update("status", event.target.value)}><option value="active">启用</option><option value="paused">暂停</option></select></Field>
        <Field label="优先级" error={errors.priority} hint="数字越小越先判定。" required><input type="number" min="1" max="100" value={form.priority} onChange={(event) => update("priority", event.target.value)} /></Field>
        <Field label="审批参考额度" error={errors.riskBudget} hint={`仅进入审批上下文，不参与策略内自动门控；单位为 ${runtimeCurrency(store)}。`} required><input type="number" min="0" step="1" value={form.riskBudget} onChange={(event) => update("riskBudget", event.target.value)} /></Field>
        <Field label="判断指标" required>
          <select value={form.metric} onChange={(event) => setForm((current) => {
            const metric = event.target.value;
            const selectedObject = current.scope.startsWith("adObject:") ? asList(store?.adObjects).find((object) => `adObject:${object.id}` === current.scope) : null;
            const objectCompatible = selectedObject && !selectedObject.archived && !["archived", "deleted", "disabled", "paused"].includes(selectedObject.status) && (metric === "budgetChangePct" ? selectedObject.type === "campaign" : ["keyword", "target"].includes(selectedObject.type));
            const scope = metric === "dataFreshnessMinutes"
              ? "data"
              : ["data", "bid", "budget"].includes(current.scope) || current.scope.startsWith("adObject:") && !objectCompatible
                ? metric === "budgetChangePct" ? "budget" : "bid"
                : current.scope;
            return { ...current, metric, scope, outcome: metric === "dataFreshnessMinutes" ? "block" : current.outcome, requireHumanApproval: metric === "dataFreshnessMinutes" ? false : current.requireHumanApproval };
          })}>
            <option value="bidChangePct">竞价自动调整幅度 (%)</option>
            <option value="budgetChangePct">日预算自动调整幅度 (%)</option>
            <option value="dataFreshnessMinutes">数据延迟（分钟）</option>
          </select>
        </Field>
        {form.metric === "dataFreshnessMinutes" ? <Field label="最大允许数据延迟（分钟）" error={errors.threshold} hint="超过该值即硬阻断；人工审批也不能绕过过期数据门。" required><input type="number" min="1" step="1" value={form.threshold} onChange={(event) => update("threshold", event.target.value)} /></Field> : null}
        {form.metric === "bidChangePct" ? <Field label="单次自动竞价降幅上限 (%)" error={errors.maxChangePct} hint="系统硬上限为 15%，不可放宽。" required><input type="number" min="0.1" max="15" step="0.1" value={form.maxChangePct} onChange={(event) => update("maxChangePct", event.target.value)} /></Field> : null}
        {form.metric === "budgetChangePct" ? <Field label="单次自动预算变更上限 (%)" error={errors.maxChangePct} hint="系统硬上限为 20%，不可放宽。" required><input type="number" min="0.1" max="20" step="0.1" value={form.maxChangePct} onChange={(event) => update("maxChangePct", event.target.value)} /></Field> : null}
        <Field label="越界后动作" hint={form.metric === "dataFreshnessMinutes" ? "数据新鲜度是执行硬门，不允许审批绕过。" : form.metric === "budgetChangePct" ? "日预算越界可转人工审批或直接阻断。" : "竞价越界可转人工审批或直接阻断。"} required>
          <select value={form.metric === "dataFreshnessMinutes" ? "block" : form.outcome} disabled={form.metric === "dataFreshnessMinutes"} onChange={(event) => update("outcome", event.target.value)}>
            {form.metric !== "dataFreshnessMinutes" ? <option value="require_approval">转人工审批</option> : null}
            <option value="block">直接阻断</option>
          </select>
        </Field>
        {form.metric !== "dataFreshnessMinutes" ? <label className="settings-toggle span-2"><span><ShieldCheck size={19} /><span><strong>策略内动作也必须逐项人工审批</strong><small>开启后，策略内自动只生成队列，不会直接应用匹配动作。</small></span></span><input type="checkbox" checked={form.requireHumanApproval} onChange={(event) => update("requireHumanApproval", event.target.checked)} /></label> : null}
        <div className="policy-simulation-note span-2" role="note"><ShieldCheck size={18} weight="fill" /><div><strong>原型始终模拟执行</strong><p>策略可完整改变审批、阻断与队列状态，但不会向 Amazon Ads 发出真实写入。</p></div></div>
        <div className="dialog-actions span-2"><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" type="submit">{record ? "保存策略" : "创建策略"}</Button></div>
      </form>
    </Modal>
  );
}

function policyScopeLabel(scope, store) {
  if (!scope || scope === "store") return "整个店铺";
  if (scope === "bid") return "全部竞价对象";
  if (scope === "budget") return "全部预算对象";
  if (scope === "data") return "数据质量门";
  if (scope.startsWith("product:")) {
    const productId = scope.slice("product:".length);
    return `产品 · ${asList(store?.products).find((product) => product.id === productId)?.sku || productId}`;
  }
  if (scope.startsWith("adObject:")) {
    const objectId = scope.slice("adObject:".length);
    return `广告对象 · ${asList(store?.adObjects).find((object) => object.id === objectId)?.name || objectId}`;
  }
  return scope;
}

function policyRuleText(policy) {
  const rule = firstPolicyRule(policy);
  const actionCopy = { require_approval: "转人工审批", block: "阻断", auto_execute: "允许策略内自动执行", notify: "通知" };
  if (rule.maxAutoBidDecreasePct !== undefined || rule.metric === "bidChangePct") {
    return `自动降幅 ≤ ${rule.maxAutoBidDecreasePct ?? rule.maxChangePct ?? rule.threshold}% · 增幅 ≤ ${rule.maxAutoBidIncreasePct ?? Math.min(Number(rule.maxChangePct ?? rule.threshold ?? 0), 10)}% · 越界${actionCopy[rule.action] || "转人工审批"}${rule.requireHumanApproval ? " · 全部动作需人工审批" : ""}`;
  }
  if (rule.maxDailyBudgetChangePct !== undefined || rule.metric === "budgetChangePct") {
    return `日预算变更 ≤ ${rule.maxDailyBudgetChangePct ?? rule.maxChangePct ?? rule.threshold}% · 越界${actionCopy[rule.action] || "转人工审批"}${rule.requireHumanApproval ? " · 全部动作需人工审批" : ""}`;
  }
  if (rule.metric === "dataFreshnessMinutes" || rule.minDataFreshnessMinutes !== undefined || rule.requireFreshDataMinutes !== undefined) {
    return `数据延迟 ≤ ${rule.minDataFreshnessMinutes ?? rule.requireFreshDataMinutes ?? rule.threshold} 分钟 · 越界${actionCopy[rule.action] || "阻断"}`;
  }
  return `${String(rule.metric || rule.field || "指标").toUpperCase()} ${rule.operator || ">"} ${rule.threshold ?? rule.value ?? "—"} → ${actionCopy[rule.action || rule.outcome] || rule.action || "待定义"}`;
}

export function PolicyWorkspace({ store, dispatch, onNavigate: _onNavigate, openInspector, notify, focusTarget }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editor, setEditor] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const policies = asList(store?.policies);
  const normalizedQuery = query.trim().toLowerCase();
  const visiblePolicies = policies.filter((policy) => {
    const matchesQuery = !normalizedQuery || `${policy.name || ""} ${policyScopeLabel(policy.scope, store)} ${policyRuleText(policy)}`.toLowerCase().includes(normalizedQuery);
    const matchesStatus = statusFilter === "all" || statusOf(policy, "active") === statusFilter;
    return matchesQuery && matchesStatus;
  }).sort((a, b) => Number(a.priority ?? 50) - Number(b.priority ?? 50));
  const enabledCount = policies.filter((policy) => statusOf(policy, "active") === "active").length;
  const approvalRules = policies.filter((policy) => {
    const rule = firstPolicyRule(policy);
    return rule.action === "require_approval" || rule.maxAutoBidDecreasePct !== undefined;
  }).length;
  const blockRules = policies.filter((policy) => {
    const rule = firstPolicyRule(policy);
    return rule.action === "block" || rule.minDataFreshnessMinutes !== undefined || rule.requireFreshDataMinutes !== undefined;
  }).length;

  useEffect(() => {
    setQuery("");
    setStatusFilter("all");
    setEditor(null);
    setConfirm(null);
  }, [storeIdOf(store)]);

  useEffect(() => {
    if (focusTarget?.kind !== "policy") return;
    const target = policies.find((policy) => policy.id === focusTarget.id);
    if (!target) return;
    setStatusFilter("all");
    setQuery(target.name || "");
    openInspector?.({ eyebrow: "策略版本", title: target.name, subtitle: `v${target.version || 1} · ${policyScopeLabel(target.scope, store)}`, fields: [["当前版本", `v${target.version || 1}`], ["历史版本", `${asList(target.versionHistory).length} 个`], ["状态", statusLabel(statusOf(target, "active"))], ["规则", policyRuleText(target)]], note: "已进入决策或执行链的版本快照保持不可变；修改策略会让活动决策重新审批。" });
  }, [focusTarget?.nonce, storeIdOf(store)]);

  const savePolicy = (values) => {
    let validation;
    if (editor?.record) {
      const policy = { ...editor.record, ...values, updatedAt: new Date().toISOString() };
      const affected = asList(store?.decisions).filter((decision) => decision.policyId === policy.id && !["rejected", "executed", "completed", "verified", "archived"].includes(decision.status)).length;
      validation = dispatchAction(dispatch, "UPDATE_POLICY", { policyId: policy.id, id: policy.id, updates: values, policy });
      if (validation?.ok === false) return notify?.(validation.message || "策略未能更新", "danger");
      notify?.(validation?.message?.includes("无语义变化") ? validation.message : affected ? `策略 ${policy.name} 已更新；${affected} 个关联决策已转为重新审批` : `策略 ${policy.name} 已更新`);
    } else {
      const policy = { ...values, id: makeId("policy"), storeId: storeIdOf(store), archived: false, createdAt: new Date().toISOString() };
      validation = dispatchAction(dispatch, "CREATE_POLICY", { policy });
      if (validation?.ok === false) return notify?.(validation.message || "策略未能创建", "danger");
      notify?.(`策略 ${policy.name} 已创建`);
    }
    setEditor(null);
  };

  const deletePolicy = () => {
    if (!confirm) return;
    const referenced = asList(store?.decisions).some((decision) => decision.policyId === confirm.id || decision.approval?.policyId === confirm.id)
      || asList(store?.executionQueue).some((execution) => execution.policyId === confirm.id)
      || asList(store?.causalLedger).some((entry) => (entry.policyId === confirm.id || asList(entry.links).includes(confirm.id))
        && !(entry.type === "entity_mutation" && entry.entityType === "policy" && entry.entityId === confirm.id && entry.intervention === "create"));
    if (referenced) {
      notify?.("策略已进入历史决策、执行或因果链，必须保留以便审计", "danger");
      return;
    }
    const validation = dispatchAction(dispatch, "DELETE_POLICY", { policyId: confirm.id, id: confirm.id });
    notify?.(validation?.ok === false ? validation.message : `策略 ${confirm.name} 已删除`, validation?.ok === false ? "danger" : "info");
    if (validation?.ok !== false) setConfirm(null);
  };

  const columns = [
    { key: "priority", header: "优先级", render: (policy) => <Badge tone="neutral">P{policy.priority ?? 50}</Badge> },
    { key: "policy", header: "策略", render: (policy) => <div className="table-primary-cell"><strong>{policy.name} <Badge tone="info">v{policy.version || 1}</Badge></strong><small>{policyRuleText(policy)}</small></div> },
    { key: "scope", header: "作用范围", render: (policy) => policyScopeLabel(policy.scope, store) },
    { key: "risk", header: "审批参考额度", render: (policy) => numberText(policy.riskBudget, ` ${runtimeCurrency(store)}`) },
    { key: "status", header: "状态", render: (policy) => <StatusBadge status={statusOf(policy, "active")} /> },
    { key: "actions", header: "操作", render: (policy) => {
      const archived = policy.archived || policy.status === "archived";
      const referenced = asList(store?.decisions).some((decision) => decision.policyId === policy.id && !["rejected", "verified", "archived"].includes(decision.status));
      const historicallyReferenced = asList(store?.decisions).some((decision) => decision.policyId === policy.id || decision.approval?.policyId === policy.id)
        || asList(store?.executionQueue).some((execution) => execution.policyId === policy.id)
        || asList(store?.causalLedger).some((entry) => (entry.policyId === policy.id || asList(entry.links).includes(policy.id))
          && !(entry.type === "entity_mutation" && entry.entityType === "policy" && entry.entityId === policy.id && entry.intervention === "create"));
      return <ActionButtons onInspect={InspectorAction({ openInspector, record: policy, eyebrow: "策略边界", title: policy.name, fields: [["当前版本", `v${policy.version || 1}`], ["历史版本", `${asList(policy.versionHistory).length} 个`], ["优先级", `P${policy.priority ?? 50}`], ["作用范围", policyScopeLabel(policy.scope, store)], ["规则", policyRuleText(policy)], ["审批参考额度", numberText(policy.riskBudget, ` ${runtimeCurrency(store)}`)]], note: `当前执行模式：${store?.mode === "auto" ? "策略内自动（仍受本策略约束）" : "人工审批"}。已进入决策链的历史版本快照不会被覆盖。` })} onEdit={!archived ? () => setEditor({ record: policy }) : undefined} onArchive={!archived && !referenced ? () => { const validation = dispatchAction(dispatch, "ARCHIVE_POLICY", { policyId: policy.id, id: policy.id }); notify?.(validation?.ok === false ? validation.message : `策略 ${policy.name} 已归档`, validation?.ok === false ? "danger" : "info"); } : undefined} archiveBlockedReason={!archived && referenced ? "仍被活动决策引用" : undefined} onRestore={archived ? () => { const validation = dispatchAction(dispatch, "UPDATE_POLICY", { policyId: policy.id, id: policy.id, updates: { archived: false, status: "paused" }, policy: { ...policy, archived: false, status: "paused" } }); notify?.(validation?.ok === false ? validation.message : `策略 ${policy.name} 已恢复`, validation?.ok === false ? "danger" : "success"); } : undefined} onDelete={() => { if (historicallyReferenced) notify?.("策略已进入历史因果链，必须保留以便审计", "danger"); else setConfirm(policy); }} />;
    } },
  ];

  return (
    <div className="workspace policy-workspace">
      <WorkspaceHeader eyebrow="策略与风控" title="自动边界与审批策略" description="策略先于执行判定；策略内自动只在启用范围、阈值、数据新鲜度与单次变更边界内工作。" actions={<Button variant="primary" leadingIcon={Plus} onClick={() => setEditor({ record: null })}>新增策略</Button>} />
      <StoreIsolationNotice store={store}>策略、审批参考额度与执行模式只作用于 {storeNameOf(store)}，不会跨店铺继承。</StoreIsolationNotice>
      <div className="summary-strip policy-summary-strip" aria-label="策略状态摘要">
        <div><small>已启用策略</small><strong>{enabledCount} / {policies.length}</strong></div>
        <div><small>人工审批边界</small><strong>{approvalRules} 条</strong></div>
        <div><small>强制阻断边界</small><strong>{blockRules} 条</strong></div>
        <div><small>当前执行模式</small><strong>{store?.mode === "auto" ? "策略内自动" : "人工审批"}</strong></div>
      </div>
      <div className="risk-banner policy-mode-banner" role="status">
        {store?.mode === "auto" ? <Robot size={17} weight="fill" /> : <ShieldCheck size={17} weight="fill" />}
        <strong>{store?.mode === "auto" ? "策略内自动已开启" : "当前为人工审批"}</strong>
        <span>{store?.mode === "auto" ? "每个建议仍须依次通过范围、阈值、数据新鲜度与变更幅度检查。" : "所有拟执行建议都进入决策工作区等待操作者确认。"}</span>
      </div>
      <Panel className="policy-directory-panel">
        <div className="toolbar policy-toolbar">
          <SearchControl value={query} onChange={setQuery} placeholder="搜索策略、范围或规则" />
          <label className="filter-select"><Funnel size={15} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="按策略状态筛选"><option value="all">全部状态</option><option value="active">已启用</option><option value="paused">已暂停</option><option value="archived">已归档</option></select></label>
          <span className="spacer" />
          <Badge tone="info">按优先级执行</Badge>
        </div>
        <DataTable caption="当前店铺策略边界" columns={columns} rows={visiblePolicies} emptyTitle={query || statusFilter !== "all" ? "没有匹配策略" : "尚未配置策略边界"} emptyDescription={query || statusFilter !== "all" ? "调整搜索或状态筛选。" : "创建策略前，AI 只能生成建议，不能越过审批边界。"} emptyAction={<Button variant="primary" leadingIcon={Plus} onClick={() => setEditor({ record: null })}>创建首个策略</Button>} />
      </Panel>
      <PolicyEditor open={Boolean(editor)} record={editor?.record} store={store} onClose={() => setEditor(null)} onSave={savePolicy} />
      <ConfirmDialog open={Boolean(confirm)} onClose={() => setConfirm(null)} onConfirm={deletePolicy} title="删除策略边界？" description="只有从未进入任何决策、执行或因果记录的策略可以删除；被引用的策略必须归档保留。" confirmLabel="确认删除"><p className="confirm-object-name">{confirm?.name}</p></ConfirmDialog>
    </div>
  );
}

const AI_PROVIDER_OPTIONS = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", models: [["gpt-5", "GPT-5"], ["gpt-5-mini", "GPT-5 mini"]] },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com", models: [["claude-sonnet-4", "Claude Sonnet 4"], ["claude-opus-4", "Claude Opus 4"]] },
  google: { label: "Google AI", baseUrl: "https://generativelanguage.googleapis.com", models: [["gemini-2.5-pro", "Gemini 2.5 Pro"], ["gemini-2.5-flash", "Gemini 2.5 Flash"]] },
  local: { label: "本地 OpenAI 兼容服务", baseUrl: "http://127.0.0.1:11434/v1", models: [["qwen3", "Qwen 3"], ["local-model", "自定义本地模型"]] },
};

function settingsInitial(store) {
  const settings = store?.settings || {};
  const aiProvider = settings.aiProvider || "openai";
  return {
    businessTimezone: businessTimezoneOf(store),
    currency: store?.currency || "USD",
    language: settings.language || "zh-CN",
    aiProvider,
    aiModel: settings.aiModel || settings.model || AI_PROVIDER_OPTIONS[aiProvider]?.models[0]?.[0] || "gpt-5",
    aiBaseUrl: settings.aiBaseUrl || AI_PROVIDER_OPTIONS[aiProvider]?.baseUrl || "",
    approvalTimeoutMinutes: settings.approvalTimeoutMinutes ?? 30,
    dataRetentionDays: settings.dataRetentionDays ?? 365,
    autoRetryLimit: settings.autoRetryLimit ?? 2,
    notificationLevel: settings.notificationLevel || "important",
    requireVisibleBrowser: true,
    localOnly: settings.localOnly !== false,
    simulationOnly: true,
  };
}

export function SettingsWorkspace({ store, stores, activeStoreId, dispatch, onNavigate: _onNavigate, onSwitchStore, onOpenSessionCenter, openInspector, notify, persistenceStatus }) {
  const [form, setForm] = useState(() => settingsInitial(store));
  const [savedSnapshot, setSavedSnapshot] = useState(() => settingsInitial(store));
  const [errors, setErrors] = useState({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [testingAi, setTestingAi] = useState(false);
  const [confirmClearAi, setConfirmClearAi] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(savedSnapshot);
  const credentialStatus = store?.settings?.aiCredentialStatus || { configured: false, provider: form.aiProvider, storage: "main_only_simulated" };
  const credentialReady = credentialStatus.configured === true && credentialStatus.provider === form.aiProvider;
  const providerConfig = AI_PROVIDER_OPTIONS[form.aiProvider] || AI_PROVIDER_OPTIONS.openai;

  useEffect(() => {
    const next = settingsInitial(store);
    setForm(next);
    setSavedSnapshot(next);
    setErrors({});
    setConfirmReset(false);
    setApiKeyDraft("");
    setTestingAi(false);
    setConfirmClearAi(false);
  }, [storeIdOf(store), store?.settings]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const save = (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!(Number(form.approvalTimeoutMinutes) >= 5 && Number(form.approvalTimeoutMinutes) <= 1440)) nextErrors.approvalTimeoutMinutes = "审批超时应在 5–1440 分钟之间。";
    if (!(Number(form.dataRetentionDays) >= 30)) nextErrors.dataRetentionDays = "因果数据至少保留 30 天。";
    if (!(Number(form.autoRetryLimit) >= 0 && Number(form.autoRetryLimit) <= 5)) nextErrors.autoRetryLimit = "自动重试次数应在 0–5 之间。";
    try {
      const endpoint = new URL(form.aiBaseUrl);
      if (!(["https:", "http:"].includes(endpoint.protocol)) || endpoint.protocol === "http:" && !["localhost", "127.0.0.1"].includes(endpoint.hostname)) nextErrors.aiBaseUrl = "远程服务必须使用 HTTPS；HTTP 仅允许 localhost/127.0.0.1。";
    } catch {
      nextErrors.aiBaseUrl = "请输入有效的 AI Base URL。";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const { businessTimezone: _lockedBusinessTimezone, currency: _lockedCurrency, ...mutableForm } = form;
    const settings = {
      ...mutableForm,
      approvalTimeoutMinutes: Number(form.approvalTimeoutMinutes),
      dataRetentionDays: Number(form.dataRetentionDays),
      autoRetryLimit: Number(form.autoRetryLimit),
      simulationOnly: true,
    };
    const validation = dispatchAction(dispatch, "UPDATE_SETTINGS", { settings });
    if (validation?.ok === false) {
      notify?.(validation.message || "设置未能保存", "danger");
      return;
    }
    const nextSnapshot = { ...settings, businessTimezone: businessTimezoneOf(store), currency: store?.currency || US_CURRENCY };
    setSavedSnapshot(nextSnapshot);
    setForm(nextSnapshot);
    notify?.(`${storeIdOf(store)} 设置已保存`);
  };

  const saveAiCredential = () => {
    if (apiKeyDraft.trim().length < 8) {
      notify?.("请输入至少 8 位的临时凭证；原型只记录“已配置”状态，不持久化凭证文本", "danger");
      return;
    }
    try {
      const endpoint = new URL(form.aiBaseUrl);
      if (endpoint.protocol === "http:" && !["localhost", "127.0.0.1"].includes(endpoint.hostname)) throw new Error("remote_http");
    } catch {
      notify?.("Base URL 无效，凭证状态未保存", "danger");
      return;
    }
    const at = new Date().toISOString();
    const validation = dispatchAction(dispatch, "UPDATE_SETTINGS", { settings: { aiProvider: form.aiProvider, aiModel: form.aiModel, aiBaseUrl: form.aiBaseUrl, aiCredentialStatus: { configured: true, provider: form.aiProvider, storage: "main_only_simulated", updatedAt: at, lastTestedAt: null, lastTestStatus: null } } });
    if (validation?.ok === false) return notify?.(validation.message, "danger");
    setApiKeyDraft("");
    notify?.(`${providerConfig.label} 凭证状态已保存到 ${storeIdOf(store)} 的 Main-only 模拟存储`, "success");
  };

  const testAiConnection = () => {
    if (!credentialReady) {
      notify?.("当前 Provider 尚未配置凭证，请先输入临时凭证并保存状态", "danger");
      return;
    }
    try {
      const endpoint = new URL(form.aiBaseUrl);
      if (endpoint.protocol === "http:" && !["localhost", "127.0.0.1"].includes(endpoint.hostname)) throw new Error("remote_http");
    } catch {
      notify?.("Base URL 无效，连接测试已阻断", "danger");
      return;
    }
    setTestingAi(true);
    window.setTimeout(() => {
      const at = new Date().toISOString();
      const validation = dispatchAction(dispatch, "UPDATE_SETTINGS", { settings: { aiProvider: form.aiProvider, aiModel: form.aiModel, aiBaseUrl: form.aiBaseUrl, aiCredentialStatus: { ...credentialStatus, configured: true, provider: form.aiProvider, lastTestedAt: at, lastTestStatus: "success" } } });
      setTestingAi(false);
      notify?.(validation?.ok === false ? validation.message : `已完成 ${providerConfig.label} 本地模拟连接测试（未发起网络请求）`, validation?.ok === false ? "danger" : "info");
    }, 560);
  };

  const clearAiCredential = () => {
    const validation = dispatchAction(dispatch, "UPDATE_SETTINGS", { settings: { aiCredentialStatus: { configured: false, provider: form.aiProvider, storage: "main_only_simulated", updatedAt: new Date().toISOString(), lastTestedAt: null, lastTestStatus: null } } });
    if (validation?.ok === false) return notify?.(validation.message, "danger");
    setConfirmClearAi(false);
    setApiKeyDraft("");
    notify?.(`${storeIdOf(store)} 的 AI 凭证状态已清除`, "info");
  };

  const resetForm = () => {
    setForm(savedSnapshot);
    setErrors({});
    setConfirmReset(false);
    notify?.("未保存修改已撤销", "info");
  };

  return (
    <div className="workspace settings-workspace">
      <WorkspaceHeader eyebrow="系统设置" title="店铺与运行设置" description="先管理互相隔离的店铺数据域，再维护当前店铺的 AI、审批和本地安全配置。站点、币种与业务时区作为数据身份锁定。" actions={<Button variant="primary" leadingIcon={Gear} disabled={!dirty} onClick={save}>保存设置</Button>} />
      <StoreIsolationNotice store={store}>以下配置只改变 {storeNameOf(store)}；切换店铺会立即载入另一套设置。</StoreIsolationNotice>
      <StoreManagement stores={stores} activeStoreId={activeStoreId} dispatch={dispatch} notify={notify} onSwitchStore={onSwitchStore} />
      <form className="settings-layout" onSubmit={save} noValidate>
        <div className="settings-main stack">
          <Panel title="地区与运行时" description="业务时区和币种绑定店铺站点，避免历史金额或业务日期被重新解释；语言与 AI 模型只保存到当前数据域。">
            <div className="form-grid">
              <Field label="IANA 业务时区" hint="第一版美国站固定使用 America/Los_Angeles。"><input value={form.businessTimezone} readOnly /></Field>
              <Field label="结算币种" hint="与 Amazon 站点绑定，不允许即时改写历史金额。"><input value={form.currency} readOnly /></Field>
              <Field label="界面语言" required><select value={form.language} onChange={(event) => update("language", event.target.value)}><option value="zh-CN">简体中文</option><option value="en-US">English</option></select></Field>
              <Field label="配置作用域"><input value={`${storeIdOf(store)} · 店铺级`} readOnly /></Field>
            </div>
          </Panel>
          <Panel title="AI Provider 与连接" description="Provider、模型和 Base URL 按店铺保存。凭证输入只存在于当前表单内；原型持久层仅记录 Main-only 配置状态，不保存或回显密钥。">
            <div className="form-grid ai-settings-grid">
              <Field label="AI Provider" required><select value={form.aiProvider} onChange={(event) => { const aiProvider = event.target.value; const config = AI_PROVIDER_OPTIONS[aiProvider] || AI_PROVIDER_OPTIONS.openai; setForm((current) => ({ ...current, aiProvider, aiModel: config.models[0][0], aiBaseUrl: config.baseUrl })); }}>{Object.entries(AI_PROVIDER_OPTIONS).map(([value, config]) => <option value={value} key={value}>{config.label}</option>)}</select></Field>
              <Field label="AI 模型" required><select value={form.aiModel} onChange={(event) => update("aiModel", event.target.value)}>{providerConfig.models.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
              <Field label="Base URL" error={errors.aiBaseUrl} hint="远程地址只允许 HTTPS；本机服务可使用 localhost。" required className="span-2"><input value={form.aiBaseUrl} onChange={(event) => update("aiBaseUrl", event.target.value)} /></Field>
              <Field label="临时凭证输入" hint="保存后立即清空；不会写入 Renderer 状态、审计明文或 localStorage。" className="span-2"><input type="password" value={apiKeyDraft} autoComplete="off" onChange={(event) => setApiKeyDraft(event.target.value)} placeholder={credentialReady ? "已配置；输入新值可覆盖状态" : "输入用于演示配置的临时值"} /></Field>
            </div>
            <div className="ai-connection-strip">
              <div><Badge tone={credentialReady ? credentialStatus.lastTestStatus === "success" ? "success" : "info" : "warning"}>{credentialReady ? credentialStatus.lastTestStatus === "success" ? "连接测试通过" : "凭证已配置" : credentialStatus.configured ? "Provider 已变化，需重配" : "未配置凭证"}</Badge><span>存储：Main-only 模拟状态 · 作用域：{storeIdOf(store)}</span>{credentialStatus.lastTestedAt ? <small>最近测试 {formatTime(credentialStatus.lastTestedAt, runtimeTimezone(store))}</small> : null}</div>
              <div className="row-action-group"><Button variant="secondary" size="small" disabled={!apiKeyDraft.trim()} onClick={saveAiCredential}>保存凭证状态</Button><Button variant="primary" size="small" loading={testingAi} onClick={testAiConnection}>测试连接</Button>{credentialStatus.configured ? <Button variant="danger" size="small" onClick={() => setConfirmClearAi(true)}>清除凭证状态</Button> : null}</div>
            </div>
          </Panel>
          <Panel title="审批与数据保留" description="保存给生产调度器使用；本地原型不会启动超时任务、自动重试或清理历史数据。">
            <div className="form-grid">
              <Field label="审批超时（分钟）" error={errors.approvalTimeoutMinutes} required><input type="number" min="5" max="1440" value={form.approvalTimeoutMinutes} onChange={(event) => update("approvalTimeoutMinutes", event.target.value)} /></Field>
              <Field label="因果数据保留（天）" error={errors.dataRetentionDays} required><input type="number" min="30" value={form.dataRetentionDays} onChange={(event) => update("dataRetentionDays", event.target.value)} /></Field>
              <Field label="失败自动重试次数" error={errors.autoRetryLimit} required><input type="number" min="0" max="5" value={form.autoRetryLimit} onChange={(event) => update("autoRetryLimit", event.target.value)} /></Field>
              <Field label="通知级别" required><select value={form.notificationLevel} onChange={(event) => update("notificationLevel", event.target.value)}><option value="all">全部活动</option><option value="important">仅重要状态</option><option value="approval">仅审批与阻断</option></select></Field>
            </div>
          </Panel>
          <Panel title="本地安全边界" description="原型固定使用可见浏览器、本地数据域与模拟写入。">
            <div className="settings-toggle-list">
              <label className="settings-toggle settings-toggle-locked"><span><Browser size={19} /><span><strong>必须使用可见浏览器（固定开启）</strong><small>第一版真实执行的安全合同；采集和执行过程中始终允许人工接管。</small></span></span><input type="checkbox" checked disabled aria-label="必须使用可见浏览器，固定开启" /></label>
              <label className="settings-toggle settings-toggle-locked"><span><HardDrives size={19} /><span><strong>业务数据仅保存在本机（固定开启）</strong><small>当前原型没有外部数据通道，店铺数据不会离开本地数据域。</small></span></span><input type="checkbox" checked disabled aria-label="业务数据仅保存在本机，固定开启" /></label>
              <label className="settings-toggle settings-toggle-locked"><span><ShieldCheck size={19} /><span><strong>原型仅模拟 Amazon Ads 写入</strong><small>此安全边界不可关闭；执行队列、证据与回读仍会完整变化。</small></span></span><input type="checkbox" checked disabled aria-label="原型仅模拟执行，固定开启" /></label>
            </div>
          </Panel>
          <div className="settings-save-bar" role="status">
            <span>{dirty ? "有未保存的店铺设置" : "当前设置已保存"}</span>
            <span className="spacer" />
            <Button variant="ghost" disabled={!dirty} onClick={() => setConfirmReset(true)}>撤销修改</Button>
            <Button variant="primary" type="submit" disabled={!dirty}>保存设置</Button>
          </div>
        </div>

        <aside className="settings-context-rail stack" aria-label="当前店铺运行上下文">
          <Panel title="当前数据域">
            <dl className="settings-facts">
              <div><dt>店铺</dt><dd>{storeIdOf(store)}</dd></div>
              <div><dt>站点</dt><dd>{store?.marketplace || "—"}</dd></div>
              <div><dt>执行模式</dt><dd>{store?.mode === "auto" ? "策略内自动" : "人工审批"}</dd></div>
              <div><dt>本地 Profile</dt><dd>{store?.session?.profile || `${storeIdOf(store)}-profile`}</dd></div>
              <div><dt>最近心跳</dt><dd>{store?.session?.lastHeartbeat || "—"}</dd></div>
              <div><dt>本地持久化</dt><dd><Badge tone={persistenceStatus?.status === "error" ? "danger" : "success"}>{persistenceStatus?.status === "error" ? "保存失败" : "已保存"}</Badge></dd></div>
            </dl>
            <div className="row-action-group"><Button variant="ghost" size="small" leadingIcon={Eye} onClick={InspectorAction({ openInspector, record: store?.session || {}, eyebrow: "店铺运行上下文", title: `${storeIdOf(store)} 本地数据域`, fields: [["店铺", storeNameOf(store)], ["站点", store?.marketplace], ["浏览器 Profile", store?.session?.profile || `${storeIdOf(store)}-profile`], ["会话状态", store?.session?.statusLabel || store?.session?.status || "正常"], ["持久化", persistenceStatus?.message || "已保存"]], note: "密钥与 Cookie 不会进入 Renderer 展示。" })}>查看隔离详情</Button><Button variant="ghost" size="small" leadingIcon={Browser} onClick={() => onOpenSessionCenter?.({ source: store?.session?.lingxing?.status === "connected" ? "amazon_ads" : "lingxing" })}>会话中心</Button></div>
          </Panel>
          <Panel title="安全承诺" description="原型状态会真实变化，外部写入保持关闭。">
            <ul className="settings-safety-list">
              <li><CheckCircle size={16} weight="fill" /><span>审批、策略和 Mission 状态按店铺隔离</span></li>
              <li><CheckCircle size={16} weight="fill" /><span>执行模拟生成可见证据与回读状态</span></li>
              <li><CheckCircle size={16} weight="fill" /><span>操作事件作为追加式因果事实保存</span></li>
              <li><CheckCircle size={16} weight="fill" /><span>不会调用真实 Amazon Ads 写 API</span></li>
            </ul>
          </Panel>
        </aside>
      </form>
      <ConfirmDialog open={confirmReset} onClose={() => setConfirmReset(false)} onConfirm={resetForm} title="撤销未保存修改？" description="表单将恢复为当前店铺最近一次保存的设置。" confirmLabel="确认撤销" tone="warning" />
      <ConfirmDialog open={confirmClearAi} onClose={() => setConfirmClearAi(false)} onConfirm={clearAiCredential} title={`清除 ${storeIdOf(store)} 的 AI 凭证状态？`} description="原型不会保存真实密钥；此操作会移除当前店铺的 Main-only“已配置”标记与最近连接测试结果，不影响其他店铺。" confirmLabel="确认清除"><p className="confirm-object-name">{providerConfig.label} · {form.aiModel}</p></ConfirmDialog>
    </div>
  );
}
