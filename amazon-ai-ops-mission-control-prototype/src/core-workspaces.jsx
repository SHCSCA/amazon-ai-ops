import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowClockwise,
  ArrowRight,
  CaretRight,
  ChartLineUp,
  Check,
  CheckCircle,
  Circle,
  Clock,
  Database,
  DotsThree,
  Eye,
  FileText,
  Flask,
  FunnelSimple,
  Hourglass,
  Lightning,
  LinkSimple,
  ListChecks,
  LockKey,
  MagnifyingGlass,
  Monitor,
  Pause,
  PencilSimple,
  Play,
  Plus,
  Robot,
  ShieldCheck,
  SkipForward,
  Target,
  Trash,
  UserFocus,
  Warning,
  X,
  XCircle,
} from "@phosphor-icons/react";
import { ConfirmDialog, Field, Modal } from "./primitives.jsx";
import { resolveProductId as sharedResolveProductId } from "./model.js";
import { US_BUSINESS_TIMEZONE, businessTimezoneOf } from "./us-market.js";

const LEDGER_STAGES = ["FACT", "ANALYSIS", "DECISION", "ACTION", "READBACK", "EFFECT"];

const LEDGER_META = {
  FACT: { label: "事实", tone: "blue", icon: Database },
  ANALYSIS: { label: "推断", tone: "purple", icon: ChartLineUp },
  DECISION: { label: "决策", tone: "amber", icon: Target },
  ACTION: { label: "执行", tone: "blue", icon: Lightning },
  READBACK: { label: "回读", tone: "cyan", icon: ArrowClockwise },
  EFFECT: { label: "效果", tone: "green", icon: CheckCircle },
};

const STATUS_LABELS = {
  active: "进行中",
  enabled: "已启用",
  disabled: "已停用",
  connected: "已连接",
  disconnected: "未连接",
  running: "进行中",
  pending: "待处理",
  needs_approval: "待审批",
  awaiting_approval: "待审批",
  approved: "已批准",
  executed: "已执行",
  rejected: "已拒绝",
  paused: "已暂停",
  completed: "已完成",
  done: "已完成",
  verified: "已验证",
  applied: "已应用",
  executing: "执行中",
  queued: "队列中",
  ready: "可执行",
  proposed: "待确认",
  draft: "草稿",
  needs_data: "等待新数据",
  recorded: "已记录",
  waiting: "等待",
  verification_failed: "回读异常",
  escalated: "已转审批",
  blocked: "已阻断",
  skipped: "已跳过",
  archived: "已归档",
  observed: "观察中",
  closed: "已关闭",
};

const LEDGER_SOURCE_LABELS = {
  CREATE_EXPERIMENT: "实验创建记录",
  EDIT_EXPERIMENT: "实验编辑记录",
  UPDATE_EXPERIMENT: "实验编辑记录",
  ARCHIVE_EXPERIMENT: "实验归档记录",
  DELETE_EXPERIMENT: "实验删除记录",
  PAUSE_EXPERIMENT: "实验暂停记录",
  RESUME_EXPERIMENT: "实验恢复记录",
  prototype_simulator: "原型执行器",
  prototype_readback: "原型回读器",
  "policy-engine": "策略引擎",
  operator: "人工记录",
};

function ledgerSourceLabel(value) {
  return LEDGER_SOURCE_LABELS[value] || value || "本地记录";
}

function ledgerDetailLabel(value) {
  return ({ create: "创建实验", update: "更新实验", archive: "归档实验", delete: "删除实验" })[value] || value;
}

function firstArray(...values) {
  const arrays = values.filter((value) => Array.isArray(value));
  return arrays.find((value) => value.length) || arrays[0] || [];
}

function valueOf(object, keys, fallback = "—") {
  if (!object) return fallback;
  for (const key of keys) {
    const value = object[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function idOf(item, fallback = "item") {
  return String(valueOf(item, ["id", "recordId", "decisionId", "missionId", "experimentId", "executionId"], fallback));
}

function statusOf(item, fallback = "pending") {
  return String(valueOf(item, ["status", "state", "phaseStatus"], fallback)).toLowerCase();
}

function statusLabel(status) {
  return STATUS_LABELS[String(status || "").toLowerCase()] || status || "待处理";
}

function executionModeLabel(mode, fallback = "人工执行") {
  return ({ policy_auto: "策略内自动", human_only: "人工执行", auto: "策略内自动", approval: "人工审批" })[mode] || mode || fallback;
}

function actionTypeLabel(value, fallback = "广告动作") {
  return ({ set_keyword_bid: "关键词出价调整", set_campaign_budget: "广告活动日预算调整", add_negative_keyword: "添加否定关键词", pause_target: "暂停投放对象" })[value] || value || fallback;
}

function matchTypeLabel(value, fallback = "竞价") {
  return ({ exact: "精准匹配", phrase: "词组匹配", broad: "广泛匹配" })[value] || value || fallback;
}

function metricSnapshotLabel(value) {
  if (value && typeof value === "object") return Object.keys(value).length ? JSON.stringify(value, null, 2) : "待建立";
  return value ?? "待建立";
}

function statusTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (["completed", "done", "approved", "verified", "applied", "success", "healthy"].includes(normalized)) return "green";
  if (["rejected", "failed", "blocked", "danger"].includes(normalized)) return "red";
  if (["pending", "needs_approval", "awaiting_approval", "needs_data", "paused", "escalated", "warning"].includes(normalized)) return "amber";
  return "blue";
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

function selectListItemFromKeyboard(event, values, current, onSelect) {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || !values.length) return;
  event.preventDefault();
  const currentIndex = Math.max(0, values.indexOf(current));
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? values.length - 1
      : event.key === "ArrowDown"
        ? (currentIndex + 1) % values.length
        : (currentIndex - 1 + values.length) % values.length;
  onSelect(values[nextIndex]);
  const options = event.currentTarget.closest('[role="listbox"]')?.querySelectorAll('[role="option"]');
  window.requestAnimationFrame(() => options?.[nextIndex]?.focus());
}

function riskTone(risk) {
  const normalized = String(risk || "").toLowerCase();
  if (["high", "critical", "高", "高风险"].includes(normalized)) return "red";
  if (["medium", "moderate", "中", "中风险"].includes(normalized)) return "amber";
  return "green";
}

function riskLabel(risk) {
  const normalized = String(risk || "").toLowerCase();
  if (["high", "critical", "高", "高风险"].includes(normalized)) return "高风险";
  if (["medium", "moderate", "中", "中风险"].includes(normalized)) return "中风险";
  return "低风险";
}

function toPercent(value, fallback = "—") {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string" && value.includes("%")) return value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `${numeric > 0 ? "+" : ""}${numeric}%`;
}

function runtimeTimezone(store) {
  return businessTimezoneOf(store);
}

function runtimeCurrency(store) {
  return store?.currency || "USD";
}

function money(value, fallback = "—", currency = "USD") {
  if (value === undefined || value === null || value === "") return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);
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

function textList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function rawTimestampOf(item) {
  return valueOf(item, ["timestamp", "time", "at", "observedAt", "appliedAt", "verifiedAt", "createdAt", "occurredAt", "updatedAt"], "—");
}

function timestampOf(item, timeZone = US_BUSINESS_TIMEZONE) {
  const value = rawTimestampOf(item);
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
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

function decisionRisk(decision) {
  return valueOf(decision, ["risk", "riskLevel"], decision?.policyBound === false || decision?.approval?.required ? "high" : "low");
}

function send(dispatch, action) {
  if (typeof dispatch === "function") return dispatch(action);
  return null;
}

function announce(notify, message, tone = "success") {
  if (typeof notify === "function") notify(message, tone);
}

function newEntityId(prefix) {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix}-${suffix}`;
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function Badge({ tone = "blue", children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function WorkspaceHeader({ eyebrow, title, description, actions, status }) {
  return (
    <header className="workspace-header">
      <div className="workspace-title">
        <span className="eyebrow">{eyebrow}</span>
        <div className="title-with-status">
          <h1>{title}</h1>
          {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
        </div>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="workspace-actions">{actions}</div> : null}
    </header>
  );
}

function EmptyWorkspace({ icon: Icon = ListChecks, title, description, action }) {
  return (
    <section className="panel empty-state">
      <div>
        <Icon size={32} />
        <h3>{title}</h3>
        <p>{description}</p>
        {action}
      </div>
    </section>
  );
}

function buildAlternativePreset(decision, option) {
  const recommendation = String(option || "").trim();
  const originalKind = decision?.decisionKind || (decision?.beforeBudget !== undefined ? "budget" : decision?.beforeBid !== undefined ? "bid" : "generic");
  const beforeValue = Number(originalKind === "budget" ? decision?.beforeBudget ?? decision?.beforeValue : decision?.beforeBid ?? decision?.beforeValue);
  const decreaseMatch = recommendation.match(/(?:下调|降低|减少)\s*(\d+(?:\.\d+)?)\s*%/);
  const increaseMatch = recommendation.match(/(?:上调|提高|增加)\s*(\d+(?:\.\d+)?)\s*%/);
  if (Number.isFinite(beforeValue) && (decreaseMatch || increaseMatch)) {
    const pct = Number((decreaseMatch || increaseMatch)[1]);
    const direction = decreaseMatch ? -1 : 1;
    return { recommendation, decisionKind: originalKind, beforeValue, proposedValue: Number((beforeValue * (1 + direction * pct / 100)).toFixed(2)) };
  }
  if (Number.isFinite(beforeValue) && /维持|不变|保持/.test(recommendation)) {
    return { recommendation, decisionKind: originalKind, beforeValue, proposedValue: beforeValue };
  }
  return { recommendation, decisionKind: "generic", beforeValue: null, proposedValue: null };
}

function DecisionEditor({ decision, dispatch, store, notify, onClose, alternativePreset = null }) {
  const [title, setTitle] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [reason, setReason] = useState("");
  const [beforeBid, setBeforeBid] = useState("");
  const [proposedBid, setProposedBid] = useState("");
  const decisionKind = alternativePreset?.decisionKind || decision?.decisionKind || (decision?.beforeBudget !== undefined || decision?.proposedBudget !== undefined ? "budget" : decision?.beforeBid !== undefined || decision?.proposedBid !== undefined ? "bid" : "generic");
  const currency = runtimeCurrency(store);

  useEffect(() => {
    const presetRecommendation = alternativePreset?.recommendation || "";
    setTitle(String(alternativePreset?.decisionKind === "generic" && presetRecommendation ? presetRecommendation : valueOf(decision, ["title", "question", "name"], "")));
    setRecommendation(String(presetRecommendation || valueOf(decision, ["recommendation", "proposedAction", "action"], valueOf(decision, ["title", "question"], ""))));
    setReason(String(valueOf(decision, ["reason", "rationale", "analysis"], "")));
    setBeforeBid(String(alternativePreset?.beforeValue ?? (decisionKind === "budget" ? valueOf(decision, ["beforeBudget", "beforeValue"], "") : valueOf(decision, ["beforeBid", "beforeValue"], ""))));
    setProposedBid(String(alternativePreset?.proposedValue ?? (decisionKind === "budget" ? valueOf(decision, ["proposedBudget", "targetValue"], "") : valueOf(decision, ["proposedBid", "targetValue"], ""))));
  }, [decision, decisionKind, alternativePreset]);

  if (!decision) return null;

  const save = (event) => {
    event.preventDefault();
    const parsedBeforeBid = Number(beforeBid);
    const parsedProposedBid = Number(proposedBid);
    if (decisionKind !== "generic" && (!Number.isFinite(parsedBeforeBid) || parsedBeforeBid <= 0 || !Number.isFinite(parsedProposedBid) || parsedProposedBid <= 0)) {
      announce(notify, `${decisionKind === "budget" ? "日预算" : "竞价"}必须是正数`, "danger");
      return;
    }
    const numericPatch = decisionKind === "bid"
      ? {
          beforeBid: parsedBeforeBid,
          proposedBid: parsedProposedBid,
        }
      : decisionKind === "budget"
        ? {
            beforeBudget: parsedBeforeBid,
            proposedBudget: parsedProposedBid,
          }
        : {
            beforeBid: null,
            proposedBid: null,
            beforeBudget: null,
            proposedBudget: null,
            beforeValue: null,
            targetValue: null,
          };
    const patch = {
      title,
      question: title,
      recommendation,
      proposedAction: recommendation,
      reason,
      rationale: reason,
      decisionKind,
      ...numericPatch,
    };
    const validation = send(dispatch, {
      type: "EDIT_DECISION",
      storeId: store?.id,
      decisionId: idOf(decision),
      patch,
      updates: patch,
      payload: patch,
      decision: patch,
    });
    if (validation?.ok === false) {
      announce(notify, validation.message || "Crux 建议未能更新", "danger");
      return;
    }
    announce(notify, "Crux 建议已更新，等待重新确认", "info");
    onClose?.();
  };

  return (
    <form className="decision-editor" onSubmit={save}>
      <div className="form-grid">
        <label className="field span-2">
          <span>决策问题</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label className="field span-2">
          <span>推荐动作</span>
          <input value={recommendation} onChange={(event) => setRecommendation(event.target.value)} required />
        </label>
        {decisionKind !== "generic" ? <label className="field">
          <span>{decisionKind === "budget" ? "当前日预算" : "当前出价"} ({currency})</span>
          <input type="number" min="0.01" step="0.01" value={beforeBid} onChange={(event) => setBeforeBid(event.target.value)} required />
        </label> : null}
        {decisionKind !== "generic" ? <label className="field">
          <span>{decisionKind === "budget" ? "建议日预算" : "建议出价"} ({currency})</span>
          <input type="number" min="0.01" step="0.01" value={proposedBid} onChange={(event) => setProposedBid(event.target.value)} required />
        </label> : null}
        <label className="field span-2">
          <span>修改理由</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="说明约束、证据或希望调整的范围" />
        </label>
      </div>
      <div className="inline-actions editor-actions">
        <button className="button ghost" type="button" onClick={onClose}>取消</button>
        <button className="button primary" type="submit"><Check size={15} />保存修改</button>
      </div>
    </form>
  );
}

function DecisionActions({ decision, dispatch, store, notify, onEdit, compact = false, disabled = false }) {
  const [rejectConfirm, setRejectConfirm] = useState(false);
  if (!decision) return null;
  const status = statusOf(decision);
  const decisionMission = firstArray(store?.missions).find((mission) => idOf(mission) === String(valueOf(decision, ["missionId"], "")));
  const missionLocked = !decisionMission || ["archived", "completed"].includes(statusOf(decisionMission)) || Boolean(decisionMission?.archived);
  const controlsDisabled = disabled || missionLocked;
  const decisionFinal = ["approved", "executed", "verified", "completed"].includes(status);
  const hasExecutableValue = decision.beforeBid !== undefined || decision.proposedBid !== undefined || decision.beforeBudget !== undefined || decision.proposedBudget !== undefined;
  const targetBlocker = hasExecutableValue ? executionTargetBlocker(store, decision) : null;
  const approvalDisabled = controlsDisabled || Boolean(targetBlocker) || decisionFinal || ["blocked", "needs_data"].includes(status);
  const rejectionDisabled = disabled || decisionFinal || ["blocked", "rejected"].includes(status);
  const approve = () => {
    if (targetBlocker) {
      announce(notify, targetBlocker, "danger");
      return;
    }
    const liveBlocker = hasExecutableValue ? automaticActionBlocker(store, {
      beforeValue: decision.decisionKind === "budget" ? decision.beforeBudget : decision.beforeBid,
      targetValue: decision.decisionKind === "budget" ? decision.proposedBudget : decision.proposedBid,
      decisionKind: decision.decisionKind,
      productId: decision.productId,
      adObjectId: decision.adObjectId,
    }, decision, false, true) : null;
    if (liveBlocker) {
      announce(notify, liveBlocker, "danger");
      return;
    }
    const validation = send(dispatch, { type: "APPROVE_DECISION", storeId: store?.id, decisionId: idOf(decision), actor: "human", principal: store?.session?.operator || "local-operator" });
    announce(notify, validation?.ok === false ? validation.message : hasExecutableValue ? "已批准，动作已进入受控执行队列" : "已批准并记录；该决策没有数值写入动作", validation?.ok === false ? "danger" : "success");
  };
  const reject = () => {
    const validation = send(dispatch, { type: "REJECT_DECISION", storeId: store?.id, decisionId: idOf(decision), actor: "human" });
    announce(notify, validation?.ok === false ? validation.message : "已拒绝，该动作不会写入领星；可通过编辑建议创建修订", validation?.ok === false ? "danger" : "info");
    if (validation?.ok !== false) setRejectConfirm(false);
  };

  return (
    <div className={`decision-actions ${compact ? "compact-actions" : ""}`}>
      <button className={`button primary ${compact ? "compact" : ""}`} type="button" disabled={approvalDisabled} title={targetBlocker || undefined} onClick={approve}>
        <CheckCircle size={16} />{targetBlocker ? "目标不可执行" : status === "blocked" ? "策略已阻断" : status === "needs_data" ? "等待新数据" : "批准进入执行"}
      </button>
      <button className={`button ${compact ? "compact" : ""}`} type="button" disabled={controlsDisabled || Boolean(targetBlocker) || decisionFinal || status === "needs_data"} title={controlsDisabled ? "当前 Mission 已封存或不存在" : targetBlocker || (status === "needs_data" ? "等待新数据后才能修订建议" : undefined)} onClick={onEdit}>
        <PencilSimple size={15} />编辑建议
      </button>
      <button className={`button danger ${compact ? "compact" : ""}`} type="button" disabled={rejectionDisabled} onClick={() => setRejectConfirm(true)}>
        <XCircle size={16} />拒绝
      </button>
      <ConfirmDialog open={rejectConfirm} onClose={() => setRejectConfirm(false)} onConfirm={reject} title="确认拒绝这条决策？" description="拒绝后不会进入执行队列；如需重新评估，可编辑建议生成一条修订状态。" confirmLabel="确认拒绝"><p className="confirm-object-name">{valueOf(decision, ["title", "recommendation"], idOf(decision))}</p></ConfirmDialog>
    </div>
  );
}

function MissionCheckpoint({ checkpoint, index, selected, onSelect }) {
  const status = statusOf(checkpoint);
  const complete = ["completed", "done", "success", "verified"].includes(status);
  const current = ["active", "running", "current", "pending_approval", "needs_approval"].includes(status) || selected;
  const Icon = complete ? CheckCircle : current ? Hourglass : Circle;
  return (
    <button
      className={`mission-checkpoint ${selected ? "selected" : ""} ${complete ? "complete" : current ? "current" : "waiting"}`}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="checkpoint-rail"><Icon size={18} weight={complete ? "fill" : "regular"} /></span>
      <time>{valueOf(checkpoint, ["time", "startedAt", "scheduledAt"], index === 0 ? "现在" : "—")}</time>
      <span className="checkpoint-copy">
        <strong>{valueOf(checkpoint, ["title", "name", "label"], `检查点 ${index + 1}`)}</strong>
        <small>{valueOf(checkpoint, ["skill", "owner", "detail", "description"], "等待前置证据")}</small>
      </span>
      <span className="checkpoint-evidence">
        {valueOf(checkpoint, ["evidenceCount", "evidence", "result"], complete ? "已确认" : statusLabel(status))}
      </span>
      <CaretRight size={15} />
    </button>
  );
}

function deriveMissionCheckpoints(store, mission) {
  const missionId = idOf(mission, "");
  const sourceRecords = [
    ...firstArray(store?.causalLedger),
    ...firstArray(store?.audit),
  ].filter((record) => !missionId || String(valueOf(record, ["missionId"], "")) === missionId);
  const executionItems = firstArray(store?.executionQueue, store?.executions)
    .filter((item) => !missionId || String(valueOf(item, ["missionId"], "")) === missionId);
  const rawPhase = String(valueOf(mission, ["phase", "currentPhase"], "decide")).toLowerCase();
  const phase = rawPhase === "execution" ? "act" : rawPhase === "readback" ? "verify" : rawPhase === "complete" ? "effect" : rawPhase;
  const phaseOrder = ["observe", "analyze", "decide", "act", "verify", "effect"];
  const stagePhase = { FACT: "observe", ANALYSIS: "analyze", DECISION: "decide", ACTION: "act", READBACK: "verify", EFFECT: "effect" };
  const stageTitle = {
    FACT: "领星报表已采集",
    ANALYSIS: "数据口径已校验",
    DECISION: "等待 Crux 决策",
    ACTION: "执行与回读",
    READBACK: "Reload 结果校验",
    EFFECT: "观察窗口效果",
  };
  const phaseIndex = Math.max(0, phaseOrder.indexOf(phase));

  return LEDGER_STAGES.map((stage) => {
    const records = sourceRecords.filter((record) => stageOf(record) === stage);
    if (stage === "ACTION") {
      executionItems.forEach((item) => {
        if (!records.some((record) => idOf(record) === idOf(item))) records.push(item);
      });
    }
    if (stage === "READBACK") {
      executionItems.filter((item) => item.verification).forEach((item) => records.push({ ...item.verification, id: `${idOf(item)}-verification`, source: item.verification?.source || "Reload 回读" }));
    }
    const currentIndex = phaseOrder.indexOf(stagePhase[stage]);
    const completed = records.some((record) => ["completed", "done", "approved", "applied", "verified", "success"].includes(statusOf(record))) || currentIndex < phaseIndex;
    const current = currentIndex === phaseIndex;
    const latest = [...records].sort((a, b) => {
      const right = new Date(valueOf(b, ["at", "timestamp", "updatedAt", "createdAt", "capturedAt"], 0)).getTime();
      const left = new Date(valueOf(a, ["at", "timestamp", "updatedAt", "createdAt", "capturedAt"], 0)).getTime();
      return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
    })[0];
    return {
      id: `${missionId}-${stage}`,
      stage,
      title: stageTitle[stage],
      status: completed ? "completed" : current ? "active" : "pending",
      time: latest ? timestampOf(latest, runtimeTimezone(store)) : "—",
      skill: valueOf(latest, ["source", "actor", "owner"], LEDGER_META[stage].label),
      evidenceCount: records.length ? `${records.length} 条证据` : completed ? "阶段已完成" : "等待前置证据",
      records,
    };
  });
}

function MissionForm({ mission, store, dispatch, notify, onClose, onSaved }) {
  const activeProducts = firstArray(store?.products).filter((product) => !product.archived && statusOf(product, "active") !== "archived");
  const productLocked = Boolean(mission && (
    firstArray(store?.decisions).some((item) => String(valueOf(item, ["missionId"], "")) === idOf(mission))
    || firstArray(store?.executionQueue).some((item) => String(valueOf(item, ["missionId"], "")) === idOf(mission))
    || firstArray(store?.experiments).some((item) => String(valueOf(item, ["missionId"], "")) === idOf(mission))
  ));
  const savedPriority = String(valueOf(mission, ["priority"], "P2"));
  const normalizedPriority = ({ high: "P1", medium: "P2", low: "P3" })[savedPriority] || (['P1', 'P2', 'P3'].includes(savedPriority) ? savedPriority : "P2");
  const [form, setForm] = useState(() => ({
    title: String(valueOf(mission, ["title", "name"], "")),
    objective: String(valueOf(mission, ["objective"], "")),
    productId: mission ? String(mission.productId || "") : String(store?.selectedProductId || activeProducts[0]?.id || ""),
    priority: normalizedPriority,
    observationWindow: String(valueOf(mission, ["observationWindow", "window"], "7 天")),
    successCriteria: textList(valueOf(mission, ["successCriteria"], [])).join("；"),
    status: statusOf(mission, "paused") === "active" ? "active" : "paused",
  }));
  const [errors, setErrors] = useState({});

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };

  const submit = (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.title.trim()) nextErrors.title = "请输入 Mission 标题";
    if (firstArray(store?.missions).some((item) => idOf(item) !== idOf(mission, "") && String(item.title || "").trim().toLowerCase() === form.title.trim().toLowerCase())) nextErrors.title = "当前店铺已存在同名 Mission";
    if (!form.objective.trim()) nextErrors.objective = "请输入可衡量的经营目标";
    if (form.productId && !activeProducts.some((product) => idOf(product) === form.productId)) nextErrors.productId = "请选择仍在经营的产品";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      announce(notify, "请先补齐 Mission 必填项", "danger");
      return;
    }
    const id = mission ? idOf(mission) : newEntityId("mission");
    const payload = {
      ...(mission || {}),
      id,
      title: form.title.trim(),
      objective: form.objective.trim(),
      productId: form.productId || null,
      productLabel: activeProducts.find((product) => idOf(product) === form.productId)?.name || "店铺级",
      priority: form.priority,
      observationWindow: form.observationWindow.trim() || "7 天",
      window: form.observationWindow.trim() || "7 天",
      successCriteria: form.successCriteria.split(/[；;]/).map((item) => item.trim()).filter(Boolean),
      status: form.status,
    };
    const validation = send(dispatch, mission ? {
      type: "UPDATE_MISSION",
      storeId: store?.id,
      missionId: id,
      mission: payload,
    } : {
      type: "CREATE_MISSION",
      storeId: store?.id,
      mission: payload,
    });
    if (validation?.ok === false) {
      announce(notify, validation.message || "Mission 未能保存", "danger");
      return;
    }
    announce(notify, mission ? "Mission 定义已更新" : "Mission 已创建并写入当前店铺", "info");
    onSaved?.(id);
    onClose?.();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mission ? "编辑 Mission" : "新建 Mission"}
      description="Mission 只属于当前店铺；Agent 会按目标、观察窗和审批边界推进。"
      size="large"
      className="mission-form-modal"
    >
      <form className="form-grid" onSubmit={submit}>
        <Field label="Mission 标题" error={errors.title} required className="span-2"><input autoFocus value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="例如：控制核心词浪费并稳定订单" /></Field>
        <Field label="经营目标" error={errors.objective} required className="span-2"><textarea value={form.objective} onChange={(event) => update("objective", event.target.value)} placeholder="写明希望改善的指标、范围和结果" /></Field>
        <Field label="关联产品" error={errors.productId} hint={productLocked ? "已有关联决策、实验或执行记录，产品范围已锁定。" : "留空表示店铺级 Mission"}><select value={form.productId} disabled={productLocked} onChange={(event) => update("productId", event.target.value)}><option value="">店铺级</option>{activeProducts.map((product) => <option key={idOf(product)} value={idOf(product)}>{product.name} · {product.asin}</option>)}</select></Field>
        <Field label="优先级"><select value={form.priority} onChange={(event) => update("priority", event.target.value)}><option value="P1">P1 · 高</option><option value="P2">P2 · 中</option><option value="P3">P3 · 低</option></select></Field>
        <Field label="观察窗口" required><input value={form.observationWindow} onChange={(event) => update("observationWindow", event.target.value)} placeholder="7 天" /></Field>
        <Field label="启动状态" hint={mission ? "运行状态请使用 Mission 页面的启动、暂停或恢复动作。" : undefined}><select value={form.status} disabled={Boolean(mission)} onChange={(event) => update("status", event.target.value)}><option value="paused">先保存为暂停</option><option value="active">立即启动 Agent</option></select></Field>
        <Field label="成功标准" hint="多条标准用分号分隔" className="span-2"><input value={form.successCriteria} onChange={(event) => update("successCriteria", event.target.value)} placeholder="浪费降低 ≥ 15%；订单不下降" /></Field>
        <div className="inline-actions editor-actions span-2"><button className="button ghost" type="button" onClick={onClose}>取消</button><button className="button primary" type="submit"><Check size={15} />保存 Mission</button></div>
      </form>
    </Modal>
  );
}

export function MissionWorkspace({ store, dispatch, onNavigate, openInspector, notify, focusTarget }) {
  const missions = useMemo(() => firstArray(store?.missions).filter((item) => matchesSelectedProduct(store, item) || (focusTarget?.kind === "mission" && idOf(item) === focusTarget.id)), [store?.missions, store?.selectedProductId, focusTarget?.nonce]);
  const [selectedMissionId, setSelectedMissionId] = useState("");
  const [missionFormMode, setMissionFormMode] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const mission = missions.find((item) => idOf(item) === selectedMissionId)
    || missions.find((item) => statusOf(item) === "active")
    || missions[0];
  const explicitCheckpoints = firstArray(mission?.checkpoints, mission?.flightPlan, mission?.steps);
  const checkpoints = explicitCheckpoints.length ? explicitCheckpoints : mission ? deriveMissionCheckpoints(store, mission) : [];
  const decisions = firstArray(store?.decisions);
  const missionDecisions = decisions.filter((item) => String(valueOf(item, ["missionId"], "")) === idOf(mission, ""));
  const linkedDecision = decisions.find((item) => idOf(item) === String(valueOf(mission, ["cruxDecisionId", "decisionId"], "")))
    || missionDecisions.find((item) => ["pending", "needs_approval", "awaiting_approval", "proposed"].includes(statusOf(item)))
    || missionDecisions[0]
    || null;
  const relatedExperiment = firstArray(store?.experiments).find((item) => String(valueOf(item, ["missionId"], "")) === idOf(mission, ""));
  const [selectedCheckpointId, setSelectedCheckpointId] = useState("");
  const [editingDecision, setEditingDecision] = useState(false);
  const [alternativeDraft, setAlternativeDraft] = useState(null);

  useEffect(() => {
    if (!missions.some((item) => idOf(item) === selectedMissionId)) {
      const fallback = missions.find((item) => statusOf(item) === "active") || missions[0];
      setSelectedMissionId(fallback ? idOf(fallback) : "");
    }
  }, [store?.id, missions, selectedMissionId]);

  useEffect(() => {
    if (focusTarget?.storeId === store?.id && focusTarget.kind === "mission" && missions.some((item) => idOf(item) === focusTarget.id)) {
      setSelectedMissionId(focusTarget.id);
    }
  }, [focusTarget?.nonce, store?.id, missions]);

  useEffect(() => {
    const current = checkpoints.find((item) => ["active", "running", "current", "needs_approval"].includes(statusOf(item))) || checkpoints[0];
    setSelectedCheckpointId(current ? idOf(current) : "");
    setEditingDecision(false);
    setAlternativeDraft(null);
  }, [store?.id, mission && idOf(mission)]);

  if (!mission) {
    return (
      <div className="workspace mission-workspace">
        <WorkspaceHeader eyebrow="MISSION CONTROL" title="任务中心" description="把事实、决策、执行和回读串成一条可审计路径。" actions={<button className="button primary" type="button" onClick={() => setMissionFormMode("create")}><Plus size={16} />新建 Mission</button>} />
        <EmptyWorkspace icon={Target} title="当前店铺没有 Mission" description="新建 Mission 后，Agent 会先采集事实，再在策略边界内推进。" action={<button className="button primary" type="button" onClick={() => setMissionFormMode("create")}>新建 Mission</button>} />
        {missionFormMode ? <MissionForm store={store} dispatch={dispatch} notify={notify} onClose={() => setMissionFormMode(null)} onSaved={setSelectedMissionId} /> : null}
      </div>
    );
  }

  const missionStatus = statusOf(mission, "active");
  const paused = missionStatus === "paused";
  const completed = missionStatus === "completed";
  const archived = missionStatus === "archived" || Boolean(mission.archived);
  const productAvailable = !mission.productId || firstArray(store?.products).some((product) => idOf(product) === String(mission.productId) && !product.archived && statusOf(product, "active") !== "archived");
  const dependencies = [
    ...firstArray(store?.decisions).filter((item) => item.missionId === idOf(mission)),
    ...firstArray(store?.executionQueue).filter((item) => item.missionId === idOf(mission)),
    ...firstArray(store?.experiments).filter((item) => item.missionId === idOf(mission)),
  ];
  const selectedCheckpoint = checkpoints.find((item) => idOf(item) === selectedCheckpointId) || checkpoints[0];
  const rawPhase = String(valueOf(mission, ["phase", "currentPhase"], "decide")).toLowerCase();
  const phase = rawPhase === "execution" ? "act" : rawPhase === "readback" ? "verify" : rawPhase === "complete" ? "verify" : rawPhase;
  const phases = ["observe", "analyze", "decide", "act", "verify"];
  const phaseIndex = Math.max(0, phases.indexOf(phase));
  const linkedCausal = firstArray(store?.causalLedger).filter((record) => String(valueOf(record, ["entityId"], "")) === idOf(linkedDecision, "") || String(valueOf(record, ["missionId"], "")) === idOf(mission, ""));
  const missionFacts = textList(valueOf(linkedDecision, ["facts", "observations", "evidenceSummary"], linkedCausal.map((record) => valueOf(record, ["signal"], "")).filter(Boolean)));
  const alternatives = textList(valueOf(linkedDecision, ["alternatives", "options"], []));
  const guardrails = textList(valueOf(linkedDecision, ["guardrails", "constraints"], valueOf(mission, ["guardrails"], [])));

  const inspectCheckpoint = (checkpoint) => {
    setSelectedCheckpointId(idOf(checkpoint));
    openInspector?.({
      eyebrow: "Mission 检查点",
      title: valueOf(checkpoint, ["title", "name"], "检查点详情"),
      subtitle: valueOf(checkpoint, ["description", "detail"], "当前任务链路证据"),
      fields: [
        ["状态", statusLabel(statusOf(checkpoint))],
        ["时间", timestampOf(checkpoint, runtimeTimezone(store))],
        ["执行 Skill", valueOf(checkpoint, ["skill", "owner"])],
        ["证据", valueOf(checkpoint, ["evidenceCount", "evidence", "result"])],
      ],
      note: "只有检查点证据完成并通过来源校验后，Agent 才会进入下一阶段。",
    });
  };

  return (
    <div className="workspace mission-workspace">
      <WorkspaceHeader
        eyebrow={`MISSION ${valueOf(mission, ["id", "missionId"], "")}`}
        title={valueOf(mission, ["title", "name", "objective"], "当前 Mission")}
        description={`${valueOf(mission, ["storeLabel", "scope"], store?.id || "当前店铺")} · ${valueOf(mission, ["productLabel", "productId", "asin"], "当前产品")} · ${valueOf(mission, ["window", "observationWindow"], "按当前观察窗")}`}
        status={{ tone: statusTone(missionStatus), label: statusLabel(missionStatus) }}
        actions={(
          <>
            <button className="button primary" type="button" onClick={() => setMissionFormMode("create")}><Plus size={15} />新建 Mission</button>
            {missions.length > 1 ? <label className="compact-select"><span className="sr-only">选择 Mission</span><select value={idOf(mission)} onChange={(event) => setSelectedMissionId(event.target.value)}>{missions.map((item) => <option key={idOf(item)} value={idOf(item)}>{statusOf(item) === "archived" ? "[已归档] " : ""}{valueOf(item, ["title", "name"], idOf(item))}</option>)}</select></label> : null}
            {!archived ? <button className="button" type="button" disabled={completed} onClick={() => setMissionFormMode("edit")}><PencilSimple size={15} />编辑</button> : null}
            {!archived ? (
              <button
                className="button"
                type="button"
                disabled={completed}
                onClick={() => {
                  const validation = send(dispatch, { type: paused ? "RESUME_MISSION" : "PAUSE_MISSION", storeId: store?.id, missionId: idOf(mission), actor: "human" });
                  announce(notify, validation?.ok === false ? validation.message : paused ? "Mission 已恢复" : "Mission 已暂停，未完成动作保持锁定", validation?.ok === false ? "danger" : "info");
                }}
              >
                {completed ? <CheckCircle size={16} /> : paused ? <Play size={16} /> : <Pause size={16} />}{completed ? "Mission 已完成" : paused ? "恢复 Agent" : "暂停 Agent"}
              </button>
            ) : null}
            {!archived ? <button className="button ghost" type="button" onClick={() => { const validation = send(dispatch, { type: "ARCHIVE_MISSION", storeId: store?.id, missionId: idOf(mission), actor: "human" }); announce(notify, validation?.ok === false ? validation.message : "Mission 已归档；其历史证据继续保留", validation?.ok === false ? "danger" : "info"); }}><Archive size={15} />归档</button> : null}
            {archived && productAvailable ? <button className="button" type="button" onClick={() => { const validation = send(dispatch, { type: "RESTORE_MISSION", storeId: store?.id, missionId: idOf(mission) }); announce(notify, validation?.ok === false ? validation.message : "Mission 已恢复为暂停状态", validation?.ok === false ? "danger" : "success"); }}><ArrowClockwise size={15} />恢复</button> : null}
            {archived && !productAvailable ? <button className="button" type="button" disabled title="关联产品已归档或删除"><Warning size={15} />产品不可用</button> : null}
            {archived ? <button className="button danger" type="button" disabled={dependencies.length > 0} title={dependencies.length ? "仍有关联决策、实验或执行记录，只能保留归档" : undefined} onClick={() => setDeleteConfirm(true)}><Trash size={15} />删除</button> : null}
            <button className="button ghost" type="button" aria-label="Mission 更多操作" onClick={() => openInspector?.({ eyebrow: "Mission", title: valueOf(mission, ["title", "name"]), fields: [["Mission ID", idOf(mission)], ["状态", statusLabel(missionStatus)], ["边界", valueOf(mission, ["boundary", "mode"], store?.mode === "auto" ? "策略内自动（受限）" : "人工审批")], ["负责人", valueOf(mission, ["owner"], "运营智能体")]] })}>
              <DotsThree size={18} />更多
            </button>
          </>
        )}
      />

      <section className="contract-strip mission-contract" aria-label="Mission 执行合同">
        <div><small>观察窗口</small><strong>{valueOf(mission, ["window", "observationWindow", "dateRange"], "—")}</strong></div>
        <div><small>自动化边界</small><strong>{valueOf(mission, ["boundaryLabel", "approvalMode"], store?.mode === "auto" ? "策略内自动" : "人工审批")}</strong></div>
        <div><small>今日可自动调整</small><strong>{valueOf(mission, ["dailyBudget", "automationBudget", "budget"], "—")}</strong></div>
        <div><small>任务进度</small><strong>{valueOf(mission, ["progressLabel"], `${checkpoints.filter((item) => ["completed", "done", "verified"].includes(statusOf(item))).length} / ${checkpoints.length}`)}</strong></div>
      </section>

      <div className="mission-layout">
        <section className="panel mission-flight-plan" aria-label="Mission 飞行计划">
          <div className="panel-header">
            <div><h2>飞行计划</h2><p>每一步都绑定来源、Skill 与执行证据</p></div>
            <Badge tone={archived ? "neutral" : completed ? "green" : paused ? "amber" : "green"}>{archived ? "已归档" : completed ? "已完成" : paused ? "已暂停" : "Agent 运行中"}</Badge>
          </div>
          <div className="mission-checkpoints">
            {checkpoints.slice(0, 4).map((checkpoint, index) => (
              <MissionCheckpoint
                key={idOf(checkpoint, `checkpoint-${index}`)}
                checkpoint={checkpoint}
                index={index}
                selected={idOf(checkpoint) === selectedCheckpointId}
                onSelect={() => inspectCheckpoint(checkpoint)}
              />
            ))}
          </div>

          {linkedDecision ? (
            <article className="crux-card" aria-label="当前 Crux 决策">
              <header>
                <div>
                  <span className="eyebrow">CRUX DECISION</span>
                  <h3>{valueOf(linkedDecision, ["title", "question", "name"], "等待关键决策")}</h3>
                </div>
                <Badge tone={riskTone(decisionRisk(linkedDecision))}>{riskLabel(decisionRisk(linkedDecision))}</Badge>
              </header>

              {editingDecision ? (
                <DecisionEditor decision={linkedDecision} dispatch={dispatch} store={store} notify={notify} alternativePreset={alternativeDraft} onClose={() => { setEditingDecision(false); setAlternativeDraft(null); }} />
              ) : (
                <>
                  <div className="crux-evidence-grid">
                    <section>
                      <h4>观测到的事实</h4>
                      {missionFacts.length ? <ul>{missionFacts.map((fact, index) => <li key={`${index}-${String(fact)}`}>{String(fact)}</li>)}</ul> : <p className="muted">证据摘要将在事实校验完成后显示。</p>}
                    </section>
                    <section>
                      <h4>AI 推断</h4>
                      <p>{valueOf(linkedDecision, ["analysis", "rationale", "reason"], "Agent 已将事实、策略边界与历史因果记录合并评估。")}</p>
                    </section>
                  </div>
                  <div className="decision-impact-strip">
                    <div><small>预期影响</small><strong>{valueOf(linkedDecision, ["expectedImpact", "expectedEffect", "impact"], "—")}</strong></div>
                    <div><small>守护栏</small><strong>{guardrails.join(" · ") || "策略边界内"}</strong></div>
                    <div><small>生效与过期</small><strong>{valueOf(linkedDecision, ["validity", "expiresAt", "effectiveWindow"], "批准后生效")}</strong></div>
                    <div><small>推荐动作</small><strong>{valueOf(linkedDecision, ["recommendation", "proposedAction", "action"], "—")}</strong></div>
                  </div>
                  {alternatives.length ? (
                    <div className="decision-alternatives" aria-label="备选方案">
                      <span>备选方案</span>
                      {alternatives.map((option, index) => <button className="chip" type="button" key={`${index}-${String(option)}`} onClick={() => { setAlternativeDraft(buildAlternativePreset(linkedDecision, option)); setEditingDecision(true); }}>{String(option)}</button>)}
                    </div>
                  ) : null}
                  <footer>
                    <DecisionActions decision={linkedDecision} dispatch={dispatch} store={store} notify={notify} disabled={archived || completed} onEdit={() => setEditingDecision(true)} />
                    <button
                      className="link-button"
                      type="button"
                      onClick={() => onNavigate?.("decisions", {
                        kind: "decision",
                        id: idOf(linkedDecision),
                        productId: resolvedProductId(store, linkedDecision) || null,
                      })}
                    >
                      查看完整证据 <ArrowRight size={14} />
                    </button>
                  </footer>
                </>
              )}
            </article>
          ) : null}

          {checkpoints.length > 4 ? (
            <div className="mission-checkpoints mission-checkpoints-tail">
              {checkpoints.slice(4).map((checkpoint, offset) => {
                const index = offset + 4;
                return (
                  <MissionCheckpoint
                    key={idOf(checkpoint, `checkpoint-${index}`)}
                    checkpoint={checkpoint}
                    index={index}
                    selected={idOf(checkpoint) === selectedCheckpointId}
                    onSelect={() => inspectCheckpoint(checkpoint)}
                  />
                );
              })}
            </div>
          ) : null}

          {selectedCheckpoint && !linkedDecision ? (
            <div className="info-banner"><Hourglass size={16} />当前检查点：{valueOf(selectedCheckpoint, ["title", "name"], "等待前置任务")}<span className="spacer" /><button className="link-button" type="button" onClick={() => inspectCheckpoint(selectedCheckpoint)}>查看证据</button></div>
          ) : null}
        </section>

        <aside className="panel mission-agent-state" aria-label="Agent 当前状态">
          <div className="panel-header"><div><h2>Agent 当前状态</h2><p>观察、决策与回读互相隔离</p></div><Robot size={20} /></div>
          <div className="agent-stage-list">
            {phases.map((stage, index) => {
              const done = index < phaseIndex;
              const current = index === phaseIndex;
              const labels = { observe: "Observe", analyze: "Analyze", decide: "Decide", act: "Act", verify: "Verify" };
              return (
                <div className={`agent-stage ${done ? "done" : current ? "current" : "waiting"}`} key={stage}>
                  {done ? <CheckCircle size={17} weight="fill" /> : current ? <Hourglass size={17} /> : <Circle size={17} />}
                  <strong>{labels[stage]}</strong>
                  <Badge tone={done ? "green" : current ? "blue" : "amber"}>{done ? "完成" : current ? "当前" : "待开始"}</Badge>
                </div>
              );
            })}
          </div>
          <section className="agent-side-section">
            <h3>当前执行计划</h3>
            <strong>{valueOf(mission, ["engine", "currentSkill"], "Crux 决策引擎")}</strong>
            <p>{valueOf(mission, ["pauseReason", "currentReason"], linkedDecision ? "高影响变更需人工批准，Agent 已在写入前停驻。" : "正在等待当前检查点的完整证据。")}</p>
          </section>
          <section className="agent-side-section">
            <h3>领星会话</h3>
            <dl className="compact-facts">
              <div><dt>会话 ID</dt><dd className="mono">{valueOf(store?.session, ["id", "sessionId"], "—")}</dd></div>
              <div><dt>登录状态</dt><dd className="positive">{valueOf(store?.session, ["statusLabel", "status"], "正常")}</dd></div>
              <div><dt>最近心跳</dt><dd>{valueOf(store?.session, ["lastHeartbeat", "heartbeat"], "—")}</dd></div>
            </dl>
          </section>
          <section className="agent-side-section">
            <h3>最近执行证据</h3>
            <dl className="compact-facts">
              <div><dt>截图</dt><dd>{valueOf(mission, ["screenshotCount"], "—")}</dd></div>
              <div><dt>Reload</dt><dd>{valueOf(mission, ["reloadId", "lastReloadId"], "—")}</dd></div>
              <div><dt>证据链</dt><dd>{valueOf(mission, ["evidenceProgress"], "—")}</dd></div>
            </dl>
            <button className="button" type="button" onClick={() => onNavigate?.("execution", { kind: "mission", id: idOf(mission), productId: mission.productId || null })}><Monitor size={16} />打开可见执行</button>
          </section>
        </aside>
      </div>

      {relatedExperiment ? (
        <section className="panel linked-experiment-strip">
          <div><span className="eyebrow">关联经营实验</span><strong>{valueOf(relatedExperiment, ["title", "name", "hypothesis"], "当前经营实验")}</strong></div>
          <div><small>基线</small><strong>{valueOf(relatedExperiment, ["baseline", "baselineMetric"], "—")}</strong></div>
          <div><small>守护栏</small><strong>{textList(valueOf(relatedExperiment, ["guardrails"], [])).join(" · ") || "—"}</strong></div>
          <div><small>实验窗口</small><strong>{valueOf(relatedExperiment, ["window", "observationWindow"], "—")}</strong></div>
          <button
            className="link-button"
            type="button"
            onClick={() => onNavigate?.("experiments", {
              kind: "experiment",
              id: idOf(relatedExperiment),
              productId: resolvedProductId(store, relatedExperiment) || null,
            })}
          >
            查看详情 <ArrowRight size={14} />
          </button>
        </section>
      ) : null}
      {missionFormMode ? <MissionForm mission={missionFormMode === "edit" ? mission : undefined} store={store} dispatch={dispatch} notify={notify} onClose={() => setMissionFormMode(null)} onSaved={setSelectedMissionId} /> : null}
      <ConfirmDialog open={deleteConfirm} onClose={() => setDeleteConfirm(false)} onConfirm={() => { const validation = send(dispatch, { type: "DELETE_MISSION", storeId: store?.id, missionId: idOf(mission), actor: "human" }); announce(notify, validation?.ok === false ? validation.message : "已删除无关联记录的归档 Mission", validation?.ok === false ? "danger" : "info"); if (validation?.ok !== false) setDeleteConfirm(false); }} title="删除归档 Mission？" description="只有没有关联决策、实验或执行记录的已归档 Mission 才能删除；历史审计仍会保留。" confirmLabel="确认删除"><p className="confirm-object-name">{valueOf(mission, ["title", "name"], idOf(mission))}</p></ConfirmDialog>
    </div>
  );
}

export function DecisionsWorkspace({ store, dispatch, onNavigate, openInspector, notify, focusTarget, onModeChange }) {
  const decisions = useMemo(() => firstArray(store?.decisions).filter((item) => matchesSelectedProduct(store, item) || (focusTarget?.kind === "decision" && idOf(item) === focusTarget.id)), [store?.decisions, store?.missions, store?.adObjects, store?.selectedProductId, focusTarget?.nonce]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [riskFilter, setRiskFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [editing, setEditing] = useState(false);
  const [alternativeDraft, setAlternativeDraft] = useState(null);

  useEffect(() => {
    setQuery("");
    setStatusFilter("open");
    setRiskFilter("all");
    setSelectedId("");
    setEditing(false);
    setAlternativeDraft(null);
  }, [store?.id]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return decisions.filter((decision) => {
      const status = statusOf(decision);
      const risk = String(decisionRisk(decision)).toLowerCase();
      const statusMatch = statusFilter === "all"
        || (statusFilter === "open" && ["pending", "needs_approval", "awaiting_approval", "proposed", "draft", "needs_data", "escalated", "blocked"].includes(status))
        || status === statusFilter;
      const riskMatch = riskFilter === "all" || risk.includes(riskFilter);
      const queryMatch = !normalized || JSON.stringify(decision).toLowerCase().includes(normalized);
      return statusMatch && riskMatch && queryMatch;
    });
  }, [decisions, query, statusFilter, riskFilter]);

  useEffect(() => {
    if (!filtered.some((decision) => idOf(decision) === selectedId)) setSelectedId(filtered[0] ? idOf(filtered[0]) : "");
  }, [store?.id, filtered, selectedId]);

  useEffect(() => {
    if (focusTarget?.storeId === store?.id && focusTarget.kind === "decision" && decisions.some((decision) => idOf(decision) === focusTarget.id)) {
      setQuery("");
      setStatusFilter("all");
      setRiskFilter("all");
      setSelectedId(focusTarget.id);
      setEditing(false);
      setAlternativeDraft(null);
    }
  }, [focusTarget?.nonce, store?.id, decisions]);

  const selected = filtered.find((decision) => idOf(decision) === selectedId) || filtered[0];
  const pendingCount = decisions.filter((decision) => ["pending", "needs_approval", "awaiting_approval", "proposed", "draft", "needs_data", "escalated", "blocked"].includes(statusOf(decision))).length;
  const facts = textList(valueOf(selected, ["facts", "observations", "evidenceSummary"], []));
  const alternatives = textList(valueOf(selected, ["alternatives", "options"], []));
  const evidence = textList(valueOf(selected, ["evidence", "evidenceRefs", "sources"], []));
  const selectedMission = selected
    ? firstArray(store?.missions).find((mission) => idOf(mission) === String(valueOf(selected, ["missionId"], "")))
    : null;
  const allExperiments = firstArray(store?.experiments);
  const explicitExperimentId = String(valueOf(selected, ["experimentId"], ""));
  const missionExperimentIds = new Set(textList(valueOf(selectedMission, ["experimentIds"], [])).map(String));
  const missionExperiments = selected
    ? allExperiments.filter((experiment) => (
        String(valueOf(experiment, ["missionId"], "")) === String(valueOf(selected, ["missionId"], ""))
        || missionExperimentIds.has(idOf(experiment))
      ))
    : [];
  const adObjectExperiments = missionExperiments.filter((experiment) => (
    String(valueOf(experiment, ["adObjectId"], "")) === String(valueOf(selected, ["adObjectId"], ""))
  ));
  const relatedExperiment = allExperiments.find((experiment) => idOf(experiment) === explicitExperimentId)
    || (adObjectExperiments.length === 1 ? adObjectExperiments[0] : null)
    || (missionExperiments.length === 1 ? missionExperiments[0] : null);
  const experimentUnavailableReason = missionExperiments.length > 1
    ? "当前决策关联的 Mission 含多个实验，缺少唯一实验 ID，无法精确定位"
    : "当前决策没有关联经营实验";

  return (
    <div className="workspace decisions-workspace">
      <WorkspaceHeader
        eyebrow="CRUX DECISIONS"
        title="决策与审批"
        description={`${pendingCount} 个对象等待边界确认；批准只进入执行队列，不代表已经写入。`}
        actions={(
          <div className="segmented-control" aria-label="执行模式">
            <button aria-pressed={store?.mode === "approval"} className={store?.mode === "approval" ? "active" : ""} type="button" onClick={() => onModeChange?.("approval")}>人工审批</button>
            <button aria-pressed={store?.mode === "auto"} className={store?.mode === "auto" ? "active" : ""} type="button" onClick={() => onModeChange?.("auto")}>策略内自动</button>
          </div>
        )}
      />

      <div className="decision-layout">
        <section className="panel decision-list-panel">
          <div className="toolbar decision-filterbar">
            <label className="search-control">
              <MagnifyingGlass size={16} />
              <span className="sr-only">搜索决策</span>
              <input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索决策、ASIN 或证据" />
            </label>
            <label className="filter-control">
              <FunnelSimple size={15} />
              <span className="sr-only">状态筛选</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="open">待处理</option>
                <option value="all">全部状态</option>
                <option value="approved">已批准</option>
                <option value="rejected">已拒绝</option>
              </select>
            </label>
            <label className="filter-control">
              <span className="sr-only">风险筛选</span>
              <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}>
                <option value="all">全部风险</option>
                <option value="high">高风险</option>
                <option value="medium">中风险</option>
                <option value="low">低风险</option>
              </select>
            </label>
          </div>
          <div className="decision-list" role="listbox" aria-label="决策列表">
            {filtered.map((decision) => {
              const id = idOf(decision);
              const selectedRow = id === selectedId;
              const risk = decisionRisk(decision);
              return (
                <button className={`decision-list-item ${selectedRow ? "selected" : ""}`} role="option" aria-selected={selectedRow} tabIndex={selectedRow ? 0 : -1} type="button" key={id} onKeyDown={(event) => selectListItemFromKeyboard(event, filtered.map(idOf), selectedId, (nextId) => { setSelectedId(nextId); setEditing(false); setAlternativeDraft(null); })} onClick={() => { setSelectedId(id); setEditing(false); setAlternativeDraft(null); }}>
                  <span className="decision-list-topline"><Badge tone={statusTone(statusOf(decision))}>{statusLabel(statusOf(decision))}</Badge><time>{timestampOf(decision, runtimeTimezone(store))}</time></span>
                  <strong>{valueOf(decision, ["title", "question", "name"], "未命名决策")}</strong>
                  <small>{valueOf(decision, ["scope", "productLabel", "asin"], "当前店铺范围")}</small>
                  <span className="decision-list-meta"><Badge tone={riskTone(risk)}>{riskLabel(risk)}</Badge><span>{valueOf(decision, ["expectedImpact", "expectedEffect", "impact"], "等待影响评估")}</span></span>
                </button>
              );
            })}
            {!filtered.length ? <div className="empty-state compact-empty"><FileText size={28} /><h3>没有匹配的决策</h3><p>调整状态、风险或搜索词后重试。</p></div> : null}
          </div>
        </section>

        <section className="panel decision-detail-panel">
          {selected ? (
            <>
              <header className="decision-detail-header">
                <div>
                  <span className="eyebrow">DECISION {idOf(selected)}</span>
                  <h2>{valueOf(selected, ["title", "question", "name"], "Crux 决策")}</h2>
                  <p>{valueOf(selected, ["scope", "productLabel", "asin"], "当前店铺范围")} · {timestampOf(selected, runtimeTimezone(store))}</p>
                </div>
                <div className="inline-actions"><Badge tone={riskTone(decisionRisk(selected))}>{riskLabel(decisionRisk(selected))}</Badge><Badge tone={statusTone(statusOf(selected))}>{statusLabel(statusOf(selected))}</Badge></div>
              </header>

              {editing ? (
                <div className="decision-detail-body"><DecisionEditor decision={selected} dispatch={dispatch} store={store} notify={notify} alternativePreset={alternativeDraft} onClose={() => { setEditing(false); setAlternativeDraft(null); }} /></div>
              ) : (
                <div className="decision-detail-body">
                  <section className="decision-section">
                    <h3>推荐动作</h3>
                    <div className="recommendation-callout">
                      <Lightning size={20} weight="fill" />
                      <div><strong>{valueOf(selected, ["recommendation", "proposedAction", "action"], "等待 Agent 生成推荐动作")}</strong><p>{valueOf(selected, ["reason", "rationale", "analysis"], "基于当前事实、因果记忆与策略边界生成。")}</p></div>
                    </div>
                  </section>

                  <section className="decision-section">
                    <div className="section-heading"><h3>可核验事实</h3><button className="link-button" type="button" onClick={() => openInspector?.({ eyebrow: "决策证据", title: valueOf(selected, ["title", "question"]), fields: [["Decision ID", idOf(selected)], ["证据数量", evidence.length || valueOf(selected, ["evidenceCount"], "—")], ["来源状态", valueOf(selected, ["evidenceStatus"], "已校验")], ["置信度", valueOf(selected, ["confidence"], "—")]], note: "批准不会绕过执行截图、Reload 回读和效果验证。" })}>打开证据检查器 <Eye size={14} /></button></div>
                    {facts.length ? <ul className="fact-list">{facts.map((fact, index) => <li key={`${index}-${String(fact)}`}><CheckCircle size={15} weight="fill" /><span>{String(fact)}</span></li>)}</ul> : <p className="muted">当前记录未提供事实摘要。</p>}
                  </section>

                  <section className="decision-section decision-contract-grid">
                    <div><small>预期影响</small><strong>{valueOf(selected, ["expectedImpact", "expectedEffect", "impact"], "—")}</strong></div>
                    <div><small>变更边界</small><strong>{selected?.changePct !== undefined ? `${Math.abs(Number(selected.changePct))}% 变更 / ${selected?.decisionKind === "budget" ? "20%" : "15%/10%"} 系统硬上限` : "非数值决策 · 必须人工审批"}</strong></div>
                    <div><small>守护栏</small><strong>{textList(valueOf(selected, ["guardrails", "constraints"], [])).join(" · ") || (selected?.policyBound === false ? "超出策略边界 · 必须人工审批" : "策略边界内")}</strong></div>
                    <div><small>过期时间</small><strong>{valueOf(selected, ["expiresAt", "validUntil", "validity"], "批准后按实验窗生效")}</strong></div>
                  </section>

                  {alternatives.length ? (
                    <section className="decision-section">
                      <h3>备选方案</h3>
                      <div className="alternative-list">{alternatives.map((alternative, index) => <button className="alternative-row" type="button" key={`${index}-${String(alternative)}`} onClick={() => { setAlternativeDraft(buildAlternativePreset(selected, alternative)); setEditing(true); }}><span>{String(alternative)}</span><PencilSimple size={14} /></button>)}</div>
                    </section>
                  ) : null}

                  <section className="decision-section evidence-chain-section">
                    <h3>证据链与执行边界</h3>
                    <div className="evidence-chain">
                      <span><Database size={16} />事实</span><ArrowRight size={13} /><span><Target size={16} />审批</span><ArrowRight size={13} /><span><Monitor size={16} />可见执行</span><ArrowRight size={13} /><span><ArrowClockwise size={16} />Reload 回读</span>
                    </div>
                  </section>
                </div>
              )}

              {!editing ? (
                <footer className="decision-detail-footer">
                  <DecisionActions decision={selected} dispatch={dispatch} store={store} notify={notify} onEdit={() => setEditing(true)} />
                  <button
                    className="button ghost"
                    type="button"
                    disabled={!relatedExperiment}
                    title={relatedExperiment ? undefined : experimentUnavailableReason}
                    onClick={() => relatedExperiment && onNavigate?.("experiments", {
                      kind: "experiment",
                      id: idOf(relatedExperiment),
                      productId: resolvedProductId(store, relatedExperiment) || null,
                    })}
                  >
                    <Flask size={16} />{relatedExperiment ? "查看关联实验" : "未关联唯一实验"}
                  </button>
                </footer>
              ) : null}
            </>
          ) : <div className="empty-state"><Target size={30} /><h3>选择一个 Crux 决策</h3><p>查看事实、边界、备选方案并决定是否进入执行队列。</p></div>}
        </section>
      </div>
    </div>
  );
}

function stageOf(record) {
  const raw = String(valueOf(record, ["type", "stage", "kind", "eventType"], "FACT")).toUpperCase();
  if (raw === "INFERENCE") return "ANALYSIS";
  if (raw === "EXECUTION") return "ACTION";
  if (raw === "VERIFY" || raw === "VERIFICATION") return "READBACK";
  return LEDGER_STAGES.includes(raw) ? raw : "FACT";
}

function ExperimentForm({ experiment, store, dispatch, notify, onClose, onSaved }) {
  const activeProducts = firstArray(store?.products).filter((product) => !product.archived && statusOf(product, "active") !== "archived");
  const activeMissions = firstArray(store?.missions).filter((mission) => !mission.archived && statusOf(mission) !== "archived");
  const relationLocked = Boolean(experiment && (
    firstArray(experiment.records, experiment.ledger, experiment.events).length
    || firstArray(store?.causalLedger).some((record) => (
      String(valueOf(record, ["experimentId", "entityId"], "")) === idOf(experiment)
      || firstArray(record.links).map(String).includes(idOf(experiment))
    ) && !(record.type === "entity_mutation" && record.entityType === "experiment" && record.entityId === idOf(experiment)))
  ));
  const initialProductId = experiment ? String(experiment.productId || "") : String(store?.selectedProductId || activeProducts[0]?.id || "");
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [primaryMetric, setPrimaryMetric] = useState("");
  const [guardrail, setGuardrail] = useState("");
  const [productId, setProductId] = useState(initialProductId);
  const [adObjectId, setAdObjectId] = useState("");
  const [missionId, setMissionId] = useState("");
  const [observationWindow, setObservationWindow] = useState("7 天");
  const [errors, setErrors] = useState({});
  const availableAdObjects = firstArray(store?.adObjects).filter((adObject) => !adObject.archived && !["archived", "deleted"].includes(statusOf(adObject, "enabled")) && (!productId || adObject.productId === productId));
  const availableMissions = activeMissions.filter((missionOption) => !missionOption.productId || missionOption.productId === productId);

  useEffect(() => {
    setName(String(valueOf(experiment, ["name", "title"], "")));
    setHypothesis(String(valueOf(experiment, ["hypothesis"], "")));
    setPrimaryMetric(String(valueOf(experiment, ["primaryMetric", "metric"], "")));
    setGuardrail(textList(valueOf(experiment, ["guardrailMetrics", "guardrails"], [])).join("；"));
    const nextProductId = experiment ? String(experiment.productId || "") : String(store?.selectedProductId || activeProducts[0]?.id || "");
    setProductId(nextProductId);
    const matchingAds = firstArray(store?.adObjects).filter((adObject) => !adObject.archived && !["archived", "deleted"].includes(statusOf(adObject, "enabled")) && (!nextProductId || adObject.productId === nextProductId));
    const matchingMissions = activeMissions.filter((missionOption) => !missionOption.productId || missionOption.productId === nextProductId);
    setAdObjectId(experiment ? String(experiment.adObjectId || "") : String(matchingAds[0]?.id || ""));
    const savedMissionId = experiment ? String(experiment.missionId || "") : "";
    setMissionId(experiment ? savedMissionId : matchingMissions.find((missionOption) => statusOf(missionOption) === "active")?.id || matchingMissions[0]?.id || "");
    setObservationWindow(String(valueOf(experiment, ["observationWindow", "window"], "7 天")));
    setErrors({});
  }, [experiment, store?.id]);

  const changeProduct = (nextProductId) => {
    setProductId(nextProductId);
    const matchingAds = firstArray(store?.adObjects).filter((adObject) => !adObject.archived && !["archived", "deleted"].includes(statusOf(adObject, "enabled")) && (!nextProductId || adObject.productId === nextProductId));
    const matchingMissions = activeMissions.filter((missionOption) => !missionOption.productId || missionOption.productId === nextProductId);
    setAdObjectId(matchingAds[0]?.id || "");
    setMissionId((current) => matchingMissions.some((missionOption) => idOf(missionOption) === current) ? current : matchingMissions.find((missionOption) => statusOf(missionOption) === "active")?.id || matchingMissions[0]?.id || "");
    setErrors((current) => ({ ...current, productId: "", adObjectId: "" }));
  };

  const submit = (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!name.trim()) nextErrors.name = "请输入实验名称";
    if (!hypothesis.trim()) nextErrors.hypothesis = "请输入可证伪的实验假设";
    if (!primaryMetric.trim()) nextErrors.primaryMetric = "请输入主指标";
    if (!productId || !activeProducts.some((product) => idOf(product) === productId)) nextErrors.productId = "请选择有效产品";
    if (!adObjectId || !availableAdObjects.some((adObject) => idOf(adObject) === adObjectId)) nextErrors.adObjectId = "请选择属于该产品的广告对象";
    if (missionId && !availableMissions.some((mission) => idOf(mission) === missionId)) nextErrors.missionId = "请选择属于该产品的 Mission";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      announce(notify, "请先补齐实验合同必填项", "danger");
      return;
    }
    const id = experiment ? idOf(experiment) : newEntityId("experiment");
    const payload = {
      ...(experiment || {}),
      id,
      name: name.trim(),
      title: name.trim(),
      hypothesis: hypothesis.trim(),
      primaryMetric: primaryMetric.trim(),
      productId,
      productLabel: activeProducts.find((product) => idOf(product) === productId)?.name || productId,
      adObjectId,
      adObjectLabel: availableAdObjects.find((adObject) => idOf(adObject) === adObjectId)?.name || adObjectId,
      missionId: missionId || null,
      observationWindow: observationWindow.trim() || "7 天",
      window: observationWindow.trim() || "7 天",
      guardrailMetrics: guardrail.split(/[；;]/).map((item) => item.trim()).filter(Boolean),
    };
    const validation = send(dispatch, experiment ? {
      type: "EDIT_EXPERIMENT",
      storeId: store?.id,
      experimentId: idOf(experiment),
      payload,
      experiment: payload,
    } : {
      type: "CREATE_EXPERIMENT",
      storeId: store?.id,
      payload,
      experiment: payload,
    });
    if (validation?.ok === false) {
      announce(notify, validation.message || "实验未能保存", "danger");
      return;
    }
    announce(notify, experiment ? "实验定义已更新" : "经营实验已创建", "info");
    onSaved?.(id);
    onClose?.();
  };

  return (
    <Modal open onClose={onClose} title={experiment ? "编辑经营实验" : "新建经营实验"} description="将实验绑定到当前店铺中的产品、广告对象与 Mission。" size="large" className="experiment-form-modal">
      <form className="form-grid" onSubmit={submit}>
        <Field label="实验名称" error={errors.name} required className="span-2"><input autoFocus value={name} onChange={(event) => { setName(event.target.value); setErrors((current) => ({ ...current, name: "" })); }} placeholder="例如：降低高花费无转化浪费" /></Field>
        <Field label="假设" error={errors.hypothesis} required className="span-2"><textarea value={hypothesis} onChange={(event) => { setHypothesis(event.target.value); setErrors((current) => ({ ...current, hypothesis: "" })); }} placeholder="写明变量、预期方向和不应破坏的业务结果" /></Field>
        <Field label="关联产品" error={errors.productId} hint={relationLocked ? "因果链已有记录，经营范围已锁定；换范围请新建实验。" : undefined} required><select value={productId} disabled={relationLocked} onChange={(event) => changeProduct(event.target.value)}><option value="">请选择产品</option>{activeProducts.map((product) => <option key={idOf(product)} value={idOf(product)}>{product.name} · {product.asin}</option>)}</select></Field>
        <Field label="广告对象" error={errors.adObjectId} required><select value={adObjectId} disabled={relationLocked} onChange={(event) => { setAdObjectId(event.target.value); setErrors((current) => ({ ...current, adObjectId: "" })); }}><option value="">请选择广告对象</option>{availableAdObjects.map((adObject) => <option key={idOf(adObject)} value={idOf(adObject)}>{adObject.name} · {adObject.type}</option>)}</select></Field>
        <Field label="关联 Mission" error={errors.missionId} hint={relationLocked ? "因果链已有记录，Mission 关系已锁定。" : "只显示店铺级或属于所选产品的 Mission"}><select value={missionId} disabled={relationLocked} onChange={(event) => { setMissionId(event.target.value); setErrors((current) => ({ ...current, missionId: "" })); }}><option value="">不关联 Mission</option>{availableMissions.map((missionOption) => <option key={idOf(missionOption)} value={idOf(missionOption)}>{missionOption.title}</option>)}</select></Field>
        <Field label="观察窗口" required><input value={observationWindow} onChange={(event) => setObservationWindow(event.target.value)} /></Field>
        <Field label="主指标" error={errors.primaryMetric} required><input value={primaryMetric} onChange={(event) => { setPrimaryMetric(event.target.value); setErrors((current) => ({ ...current, primaryMetric: "" })); }} placeholder="浪费降低 ≥ 15%" /></Field>
        <Field label="守护栏" hint="多条用分号分隔"><input value={guardrail} onChange={(event) => setGuardrail(event.target.value)} placeholder="销售额下降 ≤ 5%；ACOS ≤ 12%" /></Field>
        <div className="inline-actions editor-actions span-2"><button className="button ghost" type="button" onClick={onClose}>取消</button><button className="button primary" type="submit"><Check size={15} />保存实验</button></div>
      </form>
    </Modal>
  );
}

function ExperimentRecordForm({ experiment, record, store, dispatch, notify, onClose }) {
  const [stage, setStage] = useState("FACT");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [evidence, setEvidence] = useState("");
  const [errors, setErrors] = useState({});

  useEffect(() => {
    setStage(stageOf(record));
    setTitle(String(valueOf(record, ["title", "name"], "")));
    setDetail(String(valueOf(record, ["detail", "signal", "intervention", "observedEffect", "description"], "")));
    setEvidence(textList(valueOf(record, ["evidence", "links"], [])).join("；"));
    setErrors({});
  }, [record]);

  const submit = (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!title.trim()) nextErrors.title = "请输入记录标题";
    if (!detail.trim()) nextErrors.detail = "请输入可追溯的记录内容";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      announce(notify, "请先补齐因果记录必填项", "danger");
      return;
    }
    const payload = {
      type: stage,
      stage,
      title: title.trim(),
      detail: detail.trim(),
      signal: stage === "FACT" || stage === "ANALYSIS" ? detail.trim() : undefined,
      intervention: stage === "DECISION" || stage === "ACTION" ? detail.trim() : undefined,
      observedEffect: stage === "READBACK" || stage === "EFFECT" ? detail.trim() : undefined,
      links: evidence.split(/[；;]/).map((item) => item.trim()).filter(Boolean),
    };
    const validation = send(dispatch, record ? {
      type: "EDIT_EXPERIMENT_RECORD",
      storeId: store?.id,
      experimentId: idOf(experiment),
      recordId: idOf(record),
      payload,
      record: payload,
    } : {
      type: "CREATE_EXPERIMENT_RECORD",
      storeId: store?.id,
      experimentId: idOf(experiment),
      payload,
      record: payload,
    });
    if (validation?.ok === false) {
      announce(notify, validation.message || "实验记录未能保存", "danger");
      return;
    }
    announce(notify, record ? "实验记录已更新" : `${LEDGER_META[stage].label}记录已加入因果链`, "info");
    onClose?.();
  };

  return (
    <Modal open onClose={onClose} title={record ? "编辑实验记录" : "添加因果记录"} description="记录会写入当前实验的追加式因果链，并保留来源引用。" size="large" className="experiment-record-modal">
      <form className="form-grid" onSubmit={submit}>
        <Field label="记录类型" required><select value={stage} onChange={(event) => setStage(event.target.value)}>{LEDGER_STAGES.map((item) => <option key={item} value={item}>{LEDGER_META[item].label}（{item}）</option>)}</select></Field>
        <Field label="标题" error={errors.title} required><input autoFocus value={title} onChange={(event) => { setTitle(event.target.value); setErrors((current) => ({ ...current, title: "" })); }} /></Field>
        <Field label="内容" error={errors.detail} required className="span-2"><textarea value={detail} onChange={(event) => { setDetail(event.target.value); setErrors((current) => ({ ...current, detail: "" })); }} /></Field>
        <Field label="证据链接或记录 ID" hint="多个引用用分号分隔" className="span-2"><input value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="例如：report-20260721；screenshot-001" /></Field>
        <div className="inline-actions editor-actions span-2"><button className="button ghost" type="button" onClick={onClose}>取消</button><button className="button primary" type="submit">{record ? <Check size={15} /> : <Plus size={15} />}{record ? "保存记录" : "写入因果链"}</button></div>
      </form>
    </Modal>
  );
}

function ExperimentLedgerRow({ record, selected, onSelect, onEdit, onArchive, onRestore, onDelete, mutable = true, timeZone }) {
  const stage = stageOf(record);
  const meta = LEDGER_META[stage];
  const Icon = meta.icon;
  const detail = ledgerDetailLabel(valueOf(record, ["detail", "observation", "signal", "intervention", "expectedEffect", "observedEffect", "description"], "—"));
  const links = textList(valueOf(record, ["evidence", "links", "evidenceRefs"], []));
  const archived = statusOf(record) === "archived" || Boolean(record.archived);
  return (
    <article className={`ledger-record ledger-${stage.toLowerCase()} ${selected ? "selected" : ""}`}>
      <button className="ledger-record-main" type="button" onClick={onSelect} aria-expanded={selected}>
        <time>{timestampOf(record, timeZone)}</time>
        <span className={`ledger-kind ${meta.tone}`}><Icon size={17} weight="fill" /><span><strong>{meta.label}</strong><small>{stage}</small></span></span>
        <span className="ledger-copy"><strong>{valueOf(record, ["title", "name"], `${meta.label}记录`)}</strong><small>{String(detail)}</small></span>
        <span className="ledger-evidence">{links.length ? `${links.length} 个证据引用` : ledgerSourceLabel(valueOf(record, ["source", "actor"], "本地记录"))}</span>
        <span className="ledger-confidence">{valueOf(record, ["confidence"], "—")}</span>
        <Badge tone={statusTone(statusOf(record, stage === "EFFECT" ? "observed" : "completed"))}>{statusLabel(statusOf(record, stage === "EFFECT" ? "observed" : "completed"))}</Badge>
        <CaretRight size={15} />
      </button>
      {selected ? (
        <div className="ledger-record-expanded">
          <dl className="ledger-expanded-facts">
            <div><dt>信号</dt><dd>{valueOf(record, ["signal", "fact"], "—")}</dd></div>
            <div><dt>干预</dt><dd>{valueOf(record, ["intervention", "action"], "—")}</dd></div>
            <div><dt>预期效果</dt><dd>{valueOf(record, ["expectedEffect", "hypothesis"], "—")}</dd></div>
            <div><dt>观测效果</dt><dd>{valueOf(record, ["observedEffect", "effect"], "—")}</dd></div>
          </dl>
          {mutable ? archived ? (
            <div className="inline-actions ledger-row-actions">
              <button className="button compact" type="button" onClick={onRestore}><ArrowClockwise size={14} />恢复</button>
              <button className="button compact danger" type="button" onClick={onDelete}><Trash size={14} />删除</button>
            </div>
          ) : (
            <div className="inline-actions ledger-row-actions">
              <button className="button compact" type="button" onClick={onEdit}><PencilSimple size={14} />编辑</button>
              <button className="button compact" type="button" onClick={onArchive}><Archive size={14} />归档</button>
              <button className="button compact danger" type="button" onClick={onDelete}><Trash size={14} />删除</button>
            </div>
          ) : <div className="inline-actions ledger-row-actions"><Badge tone="blue">系统证据 · 只读</Badge></div>}
        </div>
      ) : null}
    </article>
  );
}

export function ExperimentWorkspace({ store, dispatch, onNavigate, openInspector, notify, focusTarget }) {
  const experiments = useMemo(() => firstArray(store?.experiments).filter((item) => matchesSelectedProduct(store, item) || (focusTarget?.kind === "experiment" && idOf(item) === focusTarget.id)), [store?.experiments, store?.missions, store?.adObjects, store?.selectedProductId, focusTarget?.nonce]);
  const [selectedExperimentId, setSelectedExperimentId] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [stageFilter, setStageFilter] = useState("ALL");
  const [essentialOnly, setEssentialOnly] = useState(false);
  const [experimentFormMode, setExperimentFormMode] = useState(null);
  const [recordForm, setRecordForm] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    const active = experiments.find((item) => ["running", "active", "paused"].includes(statusOf(item))) || experiments[0];
    setSelectedExperimentId(active ? idOf(active) : "");
    setSelectedRecordId("");
    setStageFilter("ALL");
    setEssentialOnly(false);
    setExperimentFormMode(null);
    setRecordForm(null);
    setDeleteConfirm(false);
  }, [store?.id]);

  useEffect(() => {
    if (focusTarget?.storeId === store?.id && focusTarget.kind === "experiment" && experiments.some((item) => idOf(item) === focusTarget.id)) {
      setSelectedExperimentId(focusTarget.id);
      setSelectedRecordId("");
      setStageFilter("ALL");
      setEssentialOnly(false);
    }
  }, [focusTarget?.nonce, store?.id, experiments]);

  const experiment = experiments.find((item) => idOf(item) === selectedExperimentId)
    || experiments.find((item) => ["running", "active", "paused"].includes(statusOf(item)))
    || experiments[0];
  const experimentId = idOf(experiment, "");
  const nestedRecords = firstArray(experiment?.records, experiment?.ledger, experiment?.events);
  const nestedRecordIds = new Set(nestedRecords.map((record) => idOf(record)));
  const missionId = String(valueOf(experiment, ["missionId"], ""));
  const causalRecords = firstArray(store?.causalLedger).filter((record) => (
    String(valueOf(record, ["experimentId", "entityId"], "")) === experimentId
    || firstArray(record.links).map(String).includes(experimentId)
    || (missionId && String(valueOf(record, ["missionId"], "")) === missionId)
  ));
  const recordMap = new Map();
  [...nestedRecords, ...causalRecords].forEach((record, index) => recordMap.set(idOf(record, `record-${index}`), record));
  const records = [...recordMap.values()].sort((left, right) => {
    const leftTime = Date.parse(rawTimestampOf(left));
    const rightTime = Date.parse(rawTimestampOf(right));
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
    return LEDGER_STAGES.indexOf(stageOf(left)) - LEDGER_STAGES.indexOf(stageOf(right));
  });
  const visibleRecords = records.filter((record) => (stageFilter === "ALL" || stageOf(record) === stageFilter) && (!essentialOnly || valueOf(record, ["essential", "critical"], false) === true));
  const selectedRecord = records.find((record) => idOf(record) === selectedRecordId);
  const status = statusOf(experiment, "running");
  const archived = status === "archived" || Boolean(experiment?.archived);
  const completed = status === "completed";
  const readOnlyExperiment = archived || completed;
  const experimentDeleteDependencyCount = firstArray(store?.missions).filter((mission) => (
    idOf(mission) === String(experiment?.missionId || "") || textList(mission.experimentIds).map(String).includes(experimentId)
  )).length
    + firstArray(store?.decisions).filter((decision) => String(decision.experimentId || "") === experimentId || textList(decision.links).map(String).includes(experimentId)).length
    + firstArray(store?.executionQueue).filter((execution) => String(execution.experimentId || "") === experimentId || textList(execution.links).map(String).includes(experimentId)).length
    + firstArray(store?.causalLedger).filter((entry) => (
      String(entry.experimentId || "") === experimentId || textList(entry.links).map(String).includes(experimentId)
    ) && !(entry.type === "entity_mutation" && entry.entityType === "experiment" && entry.entityId === experimentId)).length;
  const parentProductAvailable = !experiment?.productId || firstArray(store?.products).some((product) => idOf(product) === String(experiment.productId) && !product.archived && statusOf(product) !== "archived");
  const adObjectAvailable = !experiment?.adObjectId || firstArray(store?.adObjects).some((adObject) => idOf(adObject) === String(experiment.adObjectId) && !adObject.archived && !["archived", "deleted"].includes(statusOf(adObject, "enabled")));
  const missionAvailable = !experiment?.missionId || firstArray(store?.missions).some((missionOption) => idOf(missionOption) === String(experiment.missionId) && !missionOption.archived && !["archived", "completed", "paused"].includes(statusOf(missionOption)));
  const experimentDependenciesAvailable = parentProductAvailable && adObjectAvailable && missionAvailable;
  const draft = status === "draft";
  const paused = status === "paused";
  const stopped = draft || paused;
  const guardrails = textList(valueOf(experiment, ["guardrailMetrics", "guardrails"], []));
  const progress = Number(valueOf(experiment, ["sampleProgress", "progress"], 0));
  const currentMetrics = valueOf(experiment, ["current", "currentMetrics", "variant"], {});
  const baseline = valueOf(experiment, ["baseline", "baselineMetrics"], {});

  if (!experiment) {
    return (
      <div className="workspace experiment-workspace">
        <WorkspaceHeader eyebrow="OPERATION EXPERIMENT" title="经营实验" description="把每次经营干预记录成可复用的因果链。" actions={<button className="button primary" type="button" onClick={() => setExperimentFormMode("create")}><Plus size={16} />新建实验</button>} />
        <EmptyWorkspace icon={Flask} title="当前店铺没有经营实验" description="从一个可证伪假设开始，先写明指标和守护栏。" action={<button className="button primary" type="button" onClick={() => setExperimentFormMode("create")}>新建实验</button>} />
        {experimentFormMode === "create" ? <ExperimentForm store={store} dispatch={dispatch} notify={notify} onClose={() => setExperimentFormMode(null)} onSaved={setSelectedExperimentId} /> : null}
      </div>
    );
  }

  const archiveRecord = (record) => {
    if (readOnlyExperiment || !nestedRecordIds.has(idOf(record))) {
      announce(notify, readOnlyExperiment ? completed ? "已完成实验为只读" : "已归档实验为只读" : "系统证据只读，请在因果记忆中查看来源", "info");
      return;
    }
    const validation = send(dispatch, { type: "ARCHIVE_EXPERIMENT_RECORD", storeId: store?.id, experimentId, recordId: idOf(record), actor: "human" });
    announce(notify, validation?.ok === false ? validation.message : "记录已归档", validation?.ok === false ? "danger" : "info");
  };
  const deleteRecord = (record) => {
    if (readOnlyExperiment || !nestedRecordIds.has(idOf(record))) {
      announce(notify, readOnlyExperiment ? completed ? "已完成实验为只读" : "已归档实验为只读" : "系统证据只读，不能从实验记录中删除", "info");
      return;
    }
    const validation = send(dispatch, { type: "DELETE_EXPERIMENT_RECORD", storeId: store?.id, experimentId, recordId: idOf(record), actor: "human" });
    announce(notify, validation?.ok === false ? validation.message : "记录已从当前实验移除", validation?.ok === false ? "danger" : "info");
  };
  const restoreRecord = (record) => {
    if (readOnlyExperiment || !nestedRecordIds.has(idOf(record))) {
      announce(notify, readOnlyExperiment ? completed ? "已完成实验为只读" : "请先恢复实验，再恢复记录" : "系统证据只读", "info");
      return;
    }
    const validation = send(dispatch, { type: "UPDATE_EXPERIMENT_RECORD", storeId: store?.id, experimentId, recordId: idOf(record), record: { ...record, status: "recorded", archived: false, archivedAt: null }, actor: "human" });
    announce(notify, validation?.ok === false ? validation.message : "实验记录已恢复", validation?.ok === false ? "danger" : "success");
  };

  return (
    <div className="workspace experiment-workspace">
      <WorkspaceHeader
        eyebrow={`EXPERIMENT ${experimentId}`}
        title={valueOf(experiment, ["name", "title"], "经营实验")}
        description={`${valueOf(experiment, ["productLabel", "productId"], "当前产品")} · ${valueOf(experiment, ["adObjectLabel", "adObjectId"], "当前广告对象")}`}
        status={{ tone: statusTone(status), label: statusLabel(status) }}
        actions={(
          <>
            <button className="button primary" type="button" onClick={() => setExperimentFormMode("create")}><Plus size={15} />新建实验</button>
            <label className="compact-select"><span className="sr-only">选择实验</span><select value={experimentId} onChange={(event) => { setSelectedExperimentId(event.target.value); setSelectedRecordId(""); }}>{experiments.map((item) => <option key={idOf(item)} value={idOf(item)}>{statusOf(item) === "archived" ? "[已归档] " : ""}{valueOf(item, ["name", "title"], idOf(item))}</option>)}</select></label>
            {archived && experimentDependenciesAvailable ? <button className="button primary" type="button" onClick={() => { const validation = send(dispatch, { type: "RESTORE_EXPERIMENT", storeId: store?.id, experimentId, id: experimentId }); announce(notify, validation?.ok === false ? validation.message : "实验已恢复为暂停状态", validation?.ok === false ? "danger" : "success"); }}><ArrowClockwise size={15} />恢复实验</button> : null}
            {archived && !experimentDependenciesAvailable ? <button className="button" type="button" disabled title="关联产品、广告对象或 Mission 已封存，实验不可恢复"><Warning size={15} />经营范围已封存</button> : null}
            {completed ? <button className="button success" type="button" disabled title="关联 Mission 已完成，实验已同步收口"><CheckCircle size={15} />Mission 已完成</button> : null}
            {!readOnlyExperiment ? <button className="button" type="button" disabled={!experimentDependenciesAvailable} title={experimentDependenciesAvailable ? undefined : "关联经营对象不可用"} onClick={() => setExperimentFormMode("edit")}><PencilSimple size={15} />编辑实验</button> : null}
            {!readOnlyExperiment ? <button className="button" type="button" disabled={!experimentDependenciesAvailable} title={experimentDependenciesAvailable ? undefined : "关联经营对象不可用"} onClick={() => { const validation = send(dispatch, { type: stopped ? "RESUME_EXPERIMENT" : "PAUSE_EXPERIMENT", storeId: store?.id, experimentId, actor: "human" }); announce(notify, validation?.ok === false ? validation.message : draft ? "实验已启动" : paused ? "实验已恢复" : "实验已暂停，观察窗口保持不变", validation?.ok === false ? "danger" : "info"); }}>{stopped ? <Play size={16} /> : <Pause size={16} />}{draft ? "启动实验" : paused ? "恢复实验" : "暂停实验"}</button> : null}
            {!archived ? <button className="button ghost" type="button" onClick={() => { const validation = send(dispatch, { type: "ARCHIVE_EXPERIMENT", storeId: store?.id, experimentId, actor: "human" }); announce(notify, validation?.ok === false ? validation.message : "实验已归档；可从实验选择器恢复", validation?.ok === false ? "danger" : "info"); }}><Archive size={16} />归档</button> : null}
            {archived ? <button className="button danger" type="button" disabled={experimentDeleteDependencyCount > 0} title={experimentDeleteDependencyCount > 0 ? `仍有 ${experimentDeleteDependencyCount} 条 Mission、决策、执行或因果引用，只能保留归档` : undefined} onClick={() => setDeleteConfirm(true)}><Trash size={15} />{experimentDeleteDependencyCount > 0 ? "历史引用中" : "删除"}</button> : null}
          </>
        )}
      />

      <section className="experiment-contract summary-strip" aria-label="实验合同">
        <div><small>假设 H1</small><strong>{valueOf(experiment, ["hypothesis"], "—")}</strong></div>
        <div><small>基线</small><strong>{metricSnapshotLabel(baseline)}</strong></div>
        <div><small>操作变量</small><strong>{metricSnapshotLabel(valueOf(experiment, ["variant", "intervention"], null))}</strong></div>
        <div><small>守护栏</small><strong>{guardrails.join(" · ") || "—"}</strong></div>
        <div><small>观察窗</small><strong>{valueOf(experiment, ["window", "observationWindow", "dateRange"], "—")}</strong></div>
        <div><small>成功标准</small><strong>{valueOf(experiment, ["successCriteria", "primaryMetric"], "—")}</strong></div>
      </section>

      <div className="experiment-layout">
        <section className="panel experiment-ledger-panel">
          <div className="toolbar ledger-toolbar">
            <label className="filter-control"><FunnelSimple size={15} /><span className="sr-only">记录类型</span><select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="ALL">全部事件类型</option>{LEDGER_STAGES.map((stage) => <option value={stage} key={stage}>{LEDGER_META[stage].label}</option>)}</select></label>
            <label className="toggle-control"><input type="checkbox" checked={essentialOnly} onChange={(event) => setEssentialOnly(event.target.checked)} /><span>仅关键事件</span></label>
            <div className="ledger-stage-rail" aria-label="因果链完整度">{LEDGER_STAGES.map((stage) => <span className={records.some((record) => stageOf(record) === stage) ? "complete" : "pending"} key={stage}>{LEDGER_META[stage].label}</span>)}</div>
            <span className="spacer" />
            <button className="button compact" type="button" disabled={readOnlyExperiment || !experimentDependenciesAvailable} onClick={() => setRecordForm({ mode: "create" })}><Plus size={14} />{readOnlyExperiment ? completed ? "完成只读" : "归档只读" : !experimentDependenciesAvailable ? "对象不可用" : "添加记录"}</button>
            <button className="button compact ghost" type="button" onClick={() => { downloadJson(`${store?.id || "store"}-${experimentId}-causal-ledger.json`, { exportedAt: new Date().toISOString(), storeId: store?.id, experiment, records }); announce(notify, "实验与因果链已导出为 JSON"); }}>导出 JSON</button>
          </div>
          <div className="ledger-column-head" aria-hidden="true"><span>时间</span><span>类型</span><span>内容与证据</span><span>来源</span><span>置信度</span><span>状态</span><span /></div>
          <div className="experiment-ledger">
            {visibleRecords.map((record) => (
              <ExperimentLedgerRow
                key={idOf(record)}
                record={record}
                selected={idOf(record) === selectedRecordId}
                onSelect={() => setSelectedRecordId((current) => current === idOf(record) ? "" : idOf(record))}
                onEdit={() => setRecordForm({ mode: "edit", record })}
                onArchive={() => archiveRecord(record)}
                onRestore={() => restoreRecord(record)}
                onDelete={() => deleteRecord(record)}
                mutable={!readOnlyExperiment && experimentDependenciesAvailable && nestedRecordIds.has(idOf(record))}
                timeZone={runtimeTimezone(store)}
              />
            ))}
            {!visibleRecords.length ? <div className="empty-state compact-empty"><Database size={28} /><h3>该筛选下没有因果记录</h3><p>添加事实或取消筛选，补齐 FACT → EFFECT 链路。</p></div> : null}
          </div>
        </section>

        <aside className="panel experiment-inspector" aria-label="实验检查器">
          <div className="panel-header"><div><h2>实验检查器</h2><p>{experimentId}</p></div><Flask size={20} /></div>
          <section className="agent-side-section experiment-health">
            <h3>实验健康度</h3>
            <dl className="compact-facts">
              <div><dt>整体状态</dt><dd><Badge tone={statusTone(status)}>{statusLabel(status)}</Badge></dd></div>
              <div><dt>运行时长</dt><dd>{valueOf(experiment, ["duration", "runningTime"], "—")}</dd></div>
              <div><dt>观察进度</dt><dd>{Number.isFinite(progress) ? `${progress}%` : String(progress)}</dd></div>
            </dl>
            <progress max="100" value={Number.isFinite(progress) ? progress : 0}>{progress}%</progress>
            <small>下次观察点：{valueOf(experiment, ["nextObservationAt", "nextCheckpoint"], "—")}</small>
          </section>
          <section className="agent-side-section">
            <h3>守护栏配置与观测</h3>
            <div className="guardrail-list">{guardrails.length ? guardrails.map((guardrail, index) => {
              const result = experiment?.guardrailResults?.[String(guardrail)] || experiment?.guardrailResults?.[index];
              const label = result?.label || (result?.passed === true ? "通过" : result?.passed === false ? "触发" : "待观测");
              const tone = result?.passed === true ? "green" : result?.passed === false ? "red" : "neutral";
              return <div key={`${index}-${String(guardrail)}`}><span>{String(guardrail)}</span><Badge tone={tone}>{label}</Badge></div>;
            }) : <p className="muted">当前实验未配置守护栏。</p>}</div>
          </section>
          <section className="agent-side-section">
            <h3>影响范围</h3>
            <dl className="compact-facts">
              <div><dt>店铺</dt><dd>{store?.id || "—"}</dd></div>
              <div><dt>产品</dt><dd>{valueOf(experiment, ["productLabel", "productId"], "—")}</dd></div>
              <div><dt>广告对象</dt><dd>{valueOf(experiment, ["adObjectLabel", "adObjectId"], "—")}</dd></div>
              <div><dt>预算范围</dt><dd>{valueOf(experiment, ["budget", "budgetScope"], "—")}</dd></div>
            </dl>
          </section>
          <section className="agent-side-section baseline-current">
            <h3>基线 vs 当前</h3>
            <div className="mini-compare"><pre>{metricSnapshotLabel(baseline)}</pre><ArrowRight size={14} /><pre>{metricSnapshotLabel(currentMetrics)}</pre></div>
          </section>
          <section className="agent-side-section">
            <h3>证据链状态</h3>
            <div className="evidence-completeness">{LEDGER_STAGES.map((stage) => <div key={stage}><span>{LEDGER_META[stage].label}</span><Badge tone={records.some((record) => stageOf(record) === stage) ? "green" : "amber"}>{records.some((record) => stageOf(record) === stage) ? "已记录" : "待补齐"}</Badge></div>)}</div>
          </section>
        </aside>
      </div>

      {experimentFormMode ? <ExperimentForm experiment={experimentFormMode === "edit" ? experiment : undefined} store={store} dispatch={dispatch} notify={notify} onClose={() => setExperimentFormMode(null)} onSaved={setSelectedExperimentId} /> : null}
      {recordForm && !readOnlyExperiment ? <ExperimentRecordForm experiment={experiment} record={recordForm.record} store={store} dispatch={dispatch} notify={notify} onClose={() => setRecordForm(null)} /> : null}
      <ConfirmDialog open={deleteConfirm} onClose={() => setDeleteConfirm(false)} onConfirm={() => { const validation = send(dispatch, { type: "DELETE_EXPERIMENT", storeId: store?.id, experimentId, id: experimentId, actor: "human" }); announce(notify, validation?.ok === false ? validation.message : "已删除归档实验；审计记录仍保留", validation?.ok === false ? "danger" : "info"); if (validation?.ok !== false) setDeleteConfirm(false); }} title="删除归档实验？" description="实验本体与其内嵌记录会从当前店铺移除，历史追加式审计仍保留。" confirmLabel="确认删除"><p className="confirm-object-name">{valueOf(experiment, ["name", "title"], experimentId)}</p></ConfirmDialog>
    </div>
  );
}

function executionDelta(item) {
  const explicit = Number(valueOf(item, ["deltaPct", "changePct", "changePctExact"], Number.NaN));
  if (Number.isFinite(explicit)) return explicit;
  const before = Number(valueOf(item, ["beforeValue", "beforeBid", "currentBid"], Number.NaN));
  const target = Number(valueOf(item, ["targetValue", "proposedBid", "recommendedBid"], Number.NaN));
  return Number.isFinite(before) && Number.isFinite(target) && before !== 0 ? ((target - before) / before) * 100 : 0;
}

function executionNeedsApproval(item) {
  const status = statusOf(item);
  const delta = executionDelta(item);
  const budgetAction = item?.decisionKind === "budget" || String(item?.actionType || "").includes("预算");
  return ["needs_approval", "awaiting_approval", "escalated", "blocked"].includes(status)
    || delta < (budgetAction ? -20 : -15)
    || delta > (budgetAction ? 20 : 10)
    || item?.autoEligible === false
    || Boolean(item?.blockedReason);
}

function executionFreshnessBlocker(store) {
  const policy = firstArray(store?.policies)
    .filter((candidate) => {
      const rule = Array.isArray(candidate?.rules) ? candidate.rules[0] || {} : candidate?.rules || {};
      return statusOf(candidate, "active") === "active" && !candidate.archived && (
        candidate.scope === "data" ||
        rule.metric === "dataFreshnessMinutes" ||
        rule.minDataFreshnessMinutes !== undefined
      );
    })
    .sort((a, b) => Number(a.priority ?? 50) - Number(b.priority ?? 50))[0];
  if (!policy) return null;
  const rule = Array.isArray(policy.rules) ? policy.rules[0] || {} : policy.rules || {};
  if (rule.requireLingxingSession === true && store?.session?.lingxing?.status !== "connected") return "数据策略要求有效领星会话";
  if (rule.requireAdsSession === true && store?.session?.amazonAds?.status !== "connected") return "数据策略要求有效 Amazon Ads 会话";
  const limit = Number(rule.minDataFreshnessMinutes ?? rule.requireFreshDataMinutes ?? rule.threshold);
  const freshness = Number(store?.session?.lingxing?.freshnessMinutes);
  if (!Number.isFinite(limit) || limit <= 0) return "数据新鲜度策略缺少有效阈值，执行已阻断";
  if (!Number.isFinite(freshness) || freshness < 0) return "当前数据新鲜度未知，执行已阻断";
  return freshness > limit ? `数据已延迟 ${freshness} 分钟，超过 ${limit} 分钟执行门` : null;
}

function executionSessionBlocker(store) {
  if (store?.session?.status !== "connected") return "可见领星会话未连接";
  if (store?.session?.lingxing?.status !== "connected") return "领星会话未连接";
  if (store?.session?.amazonAds?.status !== "connected") return "Amazon Ads 会话未连接";
  if (store?.session?.amazonAds?.scope !== "read_write_simulated") return "Amazon Ads 当前为只读授权";
  if (store?.settings?.requireVisibleBrowser !== true) return "可见浏览器安全边界未启用";
  if (store?.settings?.simulationOnly !== true) return "原型模拟执行边界无效";
  return null;
}

function executionMissionBlocker(store, item) {
  const missionId = String(valueOf(item, ["missionId"], ""));
  if (!missionId) return "执行项缺少 Mission 绑定";
  const mission = firstArray(store?.missions).find((candidate) => idOf(candidate) === missionId);
  if (!mission) return "执行项关联的 Mission 不存在";
  if (statusOf(mission) === "archived" || mission.archived) return "Mission 已归档，关联执行已封存";
  if (statusOf(mission) === "completed") return "Mission 已完成，不能继续写入";
  if (statusOf(mission) === "paused") return "Mission 已暂停，关联执行项保持锁定";
  return null;
}

function executionTargetBlocker(store, item) {
  const adObjectId = String(valueOf(item, ["adObjectId"], ""));
  if (!adObjectId) return "执行项缺少目标广告对象";
  const adObject = firstArray(store?.adObjects).find((candidate) => idOf(candidate) === adObjectId);
  if (!adObject) return "目标广告对象不存在";
  const actionKind = item?.decisionKind === "budget" || String(item?.actionType || "").toLowerCase().includes("budget") || String(item?.actionType || "").includes("预算") ? "budget" : "bid";
  if (actionKind === "budget" && adObject.type !== "campaign") return "日预算动作只能绑定广告活动";
  if (actionKind === "bid" && !["keyword", "target"].includes(adObject.type)) return "竞价动作只能绑定关键词或商品投放对象";
  if (adObject.archived || ["archived", "deleted", "disabled", "paused"].includes(statusOf(adObject, "enabled"))) return "目标广告对象未处于可执行状态";
  const productId = String(adObject.productId || "");
  if (!productId) return "目标广告对象缺少产品归属";
  if (String(item?.productId || "") !== productId) return "决策产品与目标广告对象不一致";
  const mission = firstArray(store?.missions).find((candidate) => idOf(candidate) === String(item?.missionId || ""));
  if (!mission || String(mission.productId || "") !== productId) return "Mission 产品范围与目标广告对象不一致";
  const product = firstArray(store?.products).find((candidate) => idOf(candidate) === productId);
  if (!product) return "目标广告对象的所属产品不存在";
  if (product.archived || ["archived", "deleted", "disabled", "paused"].includes(statusOf(product, "active"))) return "目标广告对象的所属产品未处于可执行状态";
  const visited = new Set([adObject.id]);
  let child = adObject;
  while (child.parentId) {
    const parent = firstArray(store?.adObjects).find((candidate) => idOf(candidate) === String(child.parentId));
    if (!parent) return "目标广告对象的父级不存在";
    const expectedType = child.type === "ad_group" ? "campaign" : ["keyword", "target"].includes(child.type) ? "ad_group" : null;
    if (!expectedType || parent.type !== expectedType) return "目标广告对象的父子层级类型无效";
    if (visited.has(parent.id)) return "目标广告对象层级存在循环";
    if (String(parent.productId || "") !== productId) return "目标广告对象与父级产品不一致";
    if (parent.archived || ["archived", "deleted", "disabled", "paused"].includes(statusOf(parent, "enabled"))) return "目标广告对象的父级未处于可执行状态";
    visited.add(parent.id);
    child = parent;
  }
  if (adObject.type !== "campaign" && child.type !== "campaign") return "目标广告对象未连接到有效广告活动";
  return null;
}

function automaticActionBlocker(store, item, decision, allowApprovedOverride = false, approvalIntent = false) {
  if (!decision) return "策略内自动执行缺少关联决策，已阻断";
  const policies = firstArray(store?.policies);
  const kind = decision.decisionKind === "budget" || decision.beforeBudget !== undefined || item?.decisionKind === "budget" ? "budget" : "bid";
  const decisionAdObjectId = String(decision.adObjectId || item.adObjectId || "");
  const decisionAdObject = firstArray(store?.adObjects).find((candidate) => idOf(candidate) === decisionAdObjectId);
  const decisionProductId = String(decision.productId || item.productId || decisionAdObject?.productId || "");
  const applies = (candidate) => {
    const rule = Array.isArray(candidate?.rules) ? candidate.rules[0] || {} : candidate?.rules || {};
    const metricMatches = kind === "budget" ? rule.maxDailyBudgetChangePct !== undefined : rule.maxAutoBidDecreasePct !== undefined;
    if (statusOf(candidate, "active") !== "active" || candidate.archived || !metricMatches) return false;
    if (["store", kind, ""].includes(candidate.scope || "store")) return true;
    if (candidate.scope?.startsWith("product:")) return candidate.scope.slice("product:".length) === decisionProductId;
    if (candidate.scope?.startsWith("adObject:")) return candidate.scope.slice("adObject:".length) === decisionAdObjectId;
    return false;
  };
  const candidates = policies.filter(applies).sort((a, b) => Number(a.priority ?? 50) - Number(b.priority ?? 50));
  const policy = candidates.find((candidate) => candidate.id === decision.policyId) || candidates[0];
  if (!policy) return `没有启用的${kind === "budget" ? "预算" : "竞价"}策略，执行已阻断`;
  const approvedBy = String(decision?.approval?.approvedBy || "").toLowerCase();
  const humanApprovalValid = allowApprovedOverride
    && decision?.approval?.status === "approved"
    && Boolean(approvedBy)
    && !["policy-engine", "agent", "system", "auto"].includes(approvedBy)
    && decision?.approval?.policyId === policy.id;
  const rule = Array.isArray(policy.rules) ? policy.rules[0] || {} : policy.rules || {};
  const before = Number(valueOf(item, ["beforeValue", "beforeBid", "currentBid"], Number.NaN));
  const target = Number(valueOf(item, ["targetValue", "proposedBid", "recommendedBid"], Number.NaN));
  if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(target) || target <= 0) return `${kind === "budget" ? "预算" : "竞价"}值无效，策略内自动执行已阻断`;
  const exactChange = ((target - before) / before) * 100;
  const decrease = Math.max(0, -exactChange);
  const increase = Math.max(0, exactChange);
  const configuredDecrease = kind === "budget" ? rule.maxDailyBudgetChangePct : rule.maxAutoBidDecreasePct;
  const configuredIncrease = kind === "budget" ? rule.maxDailyBudgetChangePct : rule.maxAutoBidIncreasePct;
  const maxDecrease = Math.min(Number(configuredDecrease ?? 0), kind === "budget" ? 20 : 15);
  const maxIncrease = Math.min(Number(configuredIncrease ?? 0), kind === "budget" ? 20 : 10);
  const minValue = Number(kind === "budget" ? rule.minDailyBudget ?? 0 : rule.minBid ?? 0);
  const maxValue = Number(kind === "budget" ? rule.maxDailyBudget ?? Number.POSITIVE_INFINITY : rule.maxBid ?? Number.POSITIVE_INFINITY);
  const within = decrease <= maxDecrease && increase <= maxIncrease && target >= minValue && target <= maxValue;
  if (within) return rule.requireHumanApproval && !humanApprovalValid && !approvalIntent ? "当前策略要求运营者基于当前策略重新审批" : null;
  if (rule.action === "block") return "当前策略已变化并要求强制阻断，人工审批不能绕过";
  return humanApprovalValid || approvalIntent ? null : "当前策略已变化，请基于当前策略重新完成人工审批";
}

function ExecutionFlightStep({ step, selected, onSelect, timeZone }) {
  const status = statusOf(step);
  const completed = ["completed", "done", "verified", "success"].includes(status);
  const active = ["active", "running", "executing"].includes(status);
  return (
    <button className={`execution-step ${selected ? "selected" : ""} ${completed ? "complete" : active ? "active" : "pending"}`} type="button" onClick={onSelect} aria-pressed={selected}>
      <span className="execution-step-marker">{completed ? <CheckCircle size={18} weight="fill" /> : active ? <Hourglass size={18} /> : <Circle size={18} />}</span>
      <time>{timestampOf(step, timeZone)}</time>
      <span><strong>{valueOf(step, ["title", "name"], "执行步骤")}</strong><small>{valueOf(step, ["detail", "summary"], statusLabel(status))}</small></span>
      <Badge tone={completed ? "green" : active ? "blue" : "amber"}>{completed ? "完成" : active ? "进行中" : "等待"}</Badge>
    </button>
  );
}

function executionPlan(store, mission, items) {
  const missionId = idOf(mission, "");
  const records = firstArray(store?.causalLedger, store?.audit).filter((record) => !missionId || String(valueOf(record, ["missionId"], "")) === missionId);
  const hasStage = (stage) => records.some((record) => stageOf(record) === stage);
  const appliedCount = items.filter((item) => ["applied", "verified", "completed", "skipped"].includes(statusOf(item))).length;
  const verifiedCount = items.filter((item) => statusOf(item) === "verified" || item.verification?.matched).length;
  const skippedCount = items.filter((item) => statusOf(item) === "skipped").length;
  const resolvedCount = verifiedCount + skippedCount;
  const allResolved = items.length > 0 && resolvedCount === items.length;
  const budgetOnly = items.length > 0 && items.every((item) => item?.decisionKind === "budget" || String(item?.actionType || "").includes("预算"));
  const activeIndex = appliedCount < items.length ? 5 : resolvedCount < items.length ? 6 : 6;
  const definitions = [
    ["scope", "身份与店铺范围确认", statusLabel(valueOf(store?.session, ["statusLabel", "status"], "会话已隔离"))],
    ["collect", "广告报表下载完成", `${records.filter((record) => stageOf(record) === "FACT").length} 条事实记录`],
    ["import", "数据导入并校验", hasStage("ANALYSIS") ? "口径已确认" : "等待口径校验"],
    ["diagnose", "AI 完成量化诊断", hasStage("ANALYSIS") ? "诊断证据已绑定" : "等待诊断"],
    ["plan", `生成 ${items.length} 个调整动作`, `${items.filter((item) => executionNeedsApproval(item)).length} 个需审批`],
    ["act", budgetOnly ? "Act · 调整广告日预算" : "Act · 调整广告出价", `${appliedCount} / ${items.length} 已处理`],
    ["verify", "验证与回读", skippedCount ? `${verifiedCount} 已验证 · ${skippedCount} 已跳过` : `${verifiedCount} / ${items.length} 已验证`],
  ];
  return definitions.map(([id, title, detail], index) => ({
    id,
    title,
    detail,
    status: allResolved || index < activeIndex ? "completed" : index === activeIndex ? "active" : "pending",
    time: valueOf(records[index], ["at", "time", "timestamp"], allResolved ? "已完成" : index === activeIndex ? "现在" : "—"),
  }));
}

export function ExecutionWorkspace({ store, dispatch, onNavigate, openInspector, notify, focusTarget, onExecutionScopeChange }) {
  const missions = useMemo(() => firstArray(store?.missions).filter((item) => matchesSelectedProduct(store, item)), [store?.missions, store?.selectedProductId]);
  const [selectedMissionId, setSelectedMissionId] = useState("");
  const [skipConfirm, setSkipConfirm] = useState(false);
  const defaultMission = missions.find((item) => ["active", "paused", "running"].includes(statusOf(item)) && firstArray(store?.executionQueue).some((execution) => String(execution.missionId || "") === idOf(item)))
    || missions.find((item) => firstArray(store?.executionQueue).some((execution) => String(execution.missionId || "") === idOf(item)))
    || missions.find((item) => ["active", "paused", "running"].includes(statusOf(item)))
    || missions[0];
  const focusedExecution = focusTarget?.storeId === store?.id && focusTarget?.kind === "execution"
    ? firstArray(store?.executionQueue, store?.executions, store?.executionItems).find((item) => idOf(item) === focusTarget.id)
    : null;
  const focusedMission = focusTarget?.storeId === store?.id && ["mission", "execution"].includes(focusTarget?.kind)
    ? missions.find((item) => idOf(item) === (focusTarget.kind === "mission" ? focusTarget.id : String(focusedExecution?.missionId || "")))
    : null;
  const mission = missions.find((item) => idOf(item) === selectedMissionId) || focusedMission || defaultMission;
  const adObjects = firstArray(store?.adObjects);
  const decisions = firstArray(store?.decisions);
  const allItems = firstArray(store?.executionQueue, store?.executions, store?.executionItems).filter((item) => matchesSelectedProduct(store, item)).map((item) => {
    const adObject = adObjects.find((object) => idOf(object) === String(valueOf(item, ["adObjectId"], "")));
    const parent = adObjects.find((object) => idOf(object) === String(valueOf(adObject, ["parentId"], "")));
    const decision = decisions.find((candidate) => idOf(candidate) === String(valueOf(item, ["decisionId"], "")));
    return {
      keyword: valueOf(adObject, ["name"], undefined),
      matchType: valueOf(adObject, ["matchType"], undefined),
      objectStatus: valueOf(adObject, ["status"], undefined),
      spend: valueOf(adObject, ["spend7d"], valueOf(parent, ["spend7d"], undefined)),
      sales: valueOf(adObject, ["sales7d"], valueOf(parent, ["sales7d"], undefined)),
      acos: valueOf(adObject, ["acos7d"], valueOf(parent, ["acos7d"], undefined)),
      adGroup: valueOf(parent, ["name"], undefined),
      rationale: valueOf(decision, ["rationale"], undefined),
      expectedEffect: valueOf(decision, ["expectedEffect"], undefined),
      decisionStatus: valueOf(decision, ["status"], undefined),
      ...item,
    };
  });
  const items = mission
    ? allItems.filter((item) => String(valueOf(item, ["missionId"], "")) === idOf(mission))
    : allItems;
  const [selectedId, setSelectedId] = useState("");
  const [selectedStepId, setSelectedStepId] = useState("act");
  const [detailTab, setDetailTab] = useState("action");
  const [browserQuery, setBrowserQuery] = useState("");
  const [browserScope, setBrowserScope] = useState("all");
  const [browserTab, setBrowserTab] = useState("ads");
  const [browserSection, setBrowserSection] = useState("关键词");
  const [browserRefreshAt, setBrowserRefreshAt] = useState(null);
  const browserTabValues = browserTab === "new" ? ["home", "ads", "search-report", "new"] : ["home", "ads", "search-report"];
  const detailTabValues = ["action", "compare", "readback", "evidence", "experiment"];

  useEffect(() => {
    setSelectedMissionId((current) => {
      if (focusedMission) return idOf(focusedMission);
      if (missions.some((item) => idOf(item) === current)) return current;
      return defaultMission ? idOf(defaultMission) : "";
    });
  }, [store?.id, focusTarget?.nonce, focusedMission, defaultMission, missions]);

  useEffect(() => {
    onExecutionScopeChange?.({
      storeId: store?.id || null,
      productId: mission?.productId || store?.selectedProductId || null,
      missionId: mission ? idOf(mission) : null,
    });
  }, [store?.id, store?.selectedProductId, mission && idOf(mission), onExecutionScopeChange]);

  useEffect(() => {
    const focusedItem = focusTarget?.storeId === store?.id && focusTarget?.kind === "execution"
      ? items.find((item) => idOf(item) === focusTarget.id)
      : null;
    const current = focusedItem || items.find((item) => ["executing", "running", "queued", "needs_approval"].includes(statusOf(item))) || items[0];
    setSelectedId(current ? idOf(current) : "");
  }, [store?.id, mission && idOf(mission), focusTarget?.nonce]);

  useEffect(() => {
    setSelectedStepId("act");
    setDetailTab("action");
    setBrowserQuery("");
    setBrowserScope("all");
    setBrowserTab("ads");
    setBrowserSection("关键词");
    setBrowserRefreshAt(null);
  }, [store?.id]);

  const selected = items.find((item) => idOf(item) === selectedId) || items[0];
  const plan = executionPlan(store, mission, items);
  const visibleItems = items.filter((item) => {
    const queryMatch = !browserQuery.trim() || JSON.stringify(item).toLowerCase().includes(browserQuery.trim().toLowerCase());
    const scopeMatch = browserScope === "all" || (browserScope === "approval" ? executionNeedsApproval(item) : !executionNeedsApproval(item));
    return queryMatch && scopeMatch;
  });
  const selectedStatus = statusOf(selected, "queued");
  const currency = runtimeCurrency(store);
  const formatMoney = (value, fallback = "—") => money(value, fallback, currency);
  const takeoverEnabled = ["ready", "running", "paused", "awaiting_approval"].includes(selectedStatus);
  const skipEnabled = ["ready", "running", "paused", "awaiting_approval", "queued"].includes(selectedStatus);
  const paused = selectedStatus === "paused" || statusOf(mission) === "paused";
  const missionCompleted = statusOf(mission) === "completed";
  const missionLocked = !mission || ["archived", "completed"].includes(statusOf(mission)) || Boolean(mission?.archived);
  const isApproved = (item) => ["approved", "executed", "verified"].includes(String(valueOf(item, ["decisionStatus"], "")).toLowerCase());
  const escalationCount = items.filter((item) => executionNeedsApproval(item) && !isApproved(item)).length;
  const current = Number(valueOf(selected, ["beforeValue", "beforeBid", "currentBid"], 0));
  const target = Number(valueOf(selected, ["targetValue", "proposedBid", "recommendedBid"], 0));
  const delta = executionDelta(selected);
  const selectedBudgetAction = selected?.decisionKind === "budget" || String(selected?.actionType || "").includes("预算");
  const selectedHardLimit = selectedBudgetAction ? 20 : delta > 0 ? 10 : 15;
  const selectedExceedsHardLimit = selectedBudgetAction ? Math.abs(delta) > 20 : delta < -15 || delta > 10;
  const selectedNeedsApproval = executionNeedsApproval(selected);
  const selectedApprovalComplete = isApproved(selected);
  const selectedAwaitingApproval = selectedNeedsApproval && !selectedApprovalComplete;
  const selectedDecision = decisions.find((candidate) => idOf(candidate) === String(valueOf(selected, ["decisionId"], "")));
  const missionDecisions = mission
    ? decisions.filter((candidate) => String(valueOf(candidate, ["missionId"], "")) === idOf(mission))
    : [];
  const missionDecision = missionDecisions.length === 1 ? missionDecisions[0] : null;
  const firstEscalatedItem = items.find((item) => executionNeedsApproval(item) && !isApproved(item));
  const firstEscalatedDecision = firstEscalatedItem
    ? decisions.find((candidate) => idOf(candidate) === String(valueOf(firstEscalatedItem, ["decisionId"], "")))
    : null;
  const selectedPolicyRuntimeBlocker = selectedAwaitingApproval ? null : automaticActionBlocker(store, selected, selectedDecision, true);
  const selectedTargetBlocker = executionTargetBlocker(store, selected);
  const selectedSessionBlocker = executionSessionBlocker(store);
  const selectedRuntimeBlocker = executionMissionBlocker(store, selected) || selectedTargetBlocker || selectedSessionBlocker || executionFreshnessBlocker(store) || selectedPolicyRuntimeBlocker;
  const selectedActionDisabled = Boolean(selectedRuntimeBlocker) || ["applied", "verified", "completed", "rejected", "blocked", "skipped"].includes(selectedStatus);
  const selectedStateCopy = valueOf(selected, ["blockedReason"],
    selectedRuntimeBlocker || (selectedStatus === "applied" ? "已模拟应用，等待 Reload 回读"
      : selectedStatus === "verified" ? "Reload 回读一致，证据已归档"
        : selectedStatus === "skipped" ? "运营者已跳过，未发生写入"
          : selectedAwaitingApproval ? "等待人工审批"
            : selectedNeedsApproval ? "审批已完成，可人工应用"
              : "可执行"));
  const selectedActionLabel = ["applied", "verified", "completed"].includes(selectedStatus)
    ? selectedNeedsApproval ? "已人工应用" : "已安全应用"
    : selectedRuntimeBlocker ? "执行条件未满足"
      : selectedAwaitingApproval ? "转入审批"
      : selectedNeedsApproval ? `${formatMoney(current)} → ${formatMoney(target)} 人工应用`
        : `${formatMoney(current)} → ${formatMoney(target)} 安全应用`;
  const relatedExperiment = firstArray(store?.experiments).find((experiment) => String(valueOf(experiment, ["missionId"], "")) === idOf(mission, ""));
  const browserAddress = browserTab === "home"
    ? "https://www.lingxing.com/dashboard"
    : browserTab === "new"
      ? "about:blank"
      : `https://ads.lingxing.com/console/amazon/${browserSection === "搜索词报告" || browserTab === "search-report" ? "search-term-report" : browserSection === "广告活动" ? "campaigns" : browserSection === "广告组" ? "ad-groups" : browserSection === "概览" ? "overview" : browserSection === "商品投放" ? "product-targeting" : browserSection === "否定关键词" ? "negative-keywords" : browserSection === "广告设置" ? "settings" : "keyword-manager"}`;

  const selectBrowserTab = (nextTab) => {
    setBrowserTab(nextTab);
    if (nextTab === "search-report") setBrowserSection("搜索词报告");
    if (nextTab === "ads" && browserSection === "搜索词报告") setBrowserSection(selectedBudgetAction ? "广告活动" : "关键词");
  };

  const navigateToDecision = (item) => {
    const decisionId = String(valueOf(item, ["decisionId"], ""));
    const adObject = firstArray(store?.adObjects).find((candidate) => idOf(candidate) === String(valueOf(item, ["adObjectId"], "")));
    const decision = decisions.find((candidate) => idOf(candidate) === decisionId);
    if (!decision) {
      announce(notify, "当前执行项缺少可定位的关联决策，未打开泛化决策页", "danger");
      return false;
    }
    onNavigate?.("decisions", {
      id: decisionId,
      kind: "decision",
      productId: resolvedProductId(store, decision) || valueOf(item, ["productId"], adObject?.productId) || null,
    });
    return true;
  };

  useEffect(() => {
    setBrowserTab("ads");
    setBrowserSection(selectedBudgetAction ? "广告活动" : "关键词");
  }, [selected && idOf(selected), selectedBudgetAction]);

  const applyItem = (item) => {
    const itemStatus = statusOf(item, "queued");
    if (itemStatus === "blocked") {
      announce(notify, "该动作已被策略阻断，请先编辑建议或策略", "danger");
      navigateToDecision(item);
      return;
    }
    const missionBlocker = executionMissionBlocker(store, item);
    if (missionBlocker) {
      announce(notify, `${missionBlocker}，执行已阻断`, "danger");
      return;
    }
    const targetBlocker = executionTargetBlocker(store, item);
    if (targetBlocker) {
      announce(notify, `${targetBlocker}，执行已阻断`, "danger");
      return;
    }
    const sessionBlocker = executionSessionBlocker(store);
    if (sessionBlocker) {
      announce(notify, `${sessionBlocker}，执行已阻断`, "danger");
      return;
    }
    const freshnessBlocker = executionFreshnessBlocker(store);
    if (freshnessBlocker) {
      announce(notify, freshnessBlocker, "danger");
      return;
    }
    const decision = decisions.find((candidate) => idOf(candidate) === String(valueOf(item, ["decisionId"], "")));
    const needsApproval = executionNeedsApproval(item);
    const approvalComplete = isApproved(item) || ["approved", "executed", "verified"].includes(statusOf(decision, ""));
    if ((needsApproval || decision?.approval?.required || store?.mode !== "auto") && !approvalComplete) {
      announce(notify, `${toPercent(executionDelta(item))} 超出自动边界，请先完成人工审批`, "info");
      navigateToDecision(item);
      return;
    }
    const requiresHumanActor = needsApproval || item?.autoEligible === false || item?.owner === "operator" || item?.executionMode === "human_only";
    const actor = requiresHumanActor || store?.mode !== "auto" ? "human" : "agent";
    if (statusOf(mission) === "paused") {
      announce(notify, "Mission 已暂停，关联执行项保持锁定；请先恢复 Mission", "info");
      return;
    }
    const policyBlocker = automaticActionBlocker(store, item, decision, actor === "human" && approvalComplete);
    if (policyBlocker) {
      announce(notify, policyBlocker, "danger");
      return;
    }
    const validation = send(dispatch, { type: "APPLY_EXECUTION_ITEM", storeId: store?.id, executionId: idOf(item), itemId: idOf(item), actor });
    announce(notify, validation?.ok === false ? validation.message : `${formatMoney(valueOf(item, ["beforeValue", "beforeBid"]))} → ${formatMoney(valueOf(item, ["targetValue", "proposedBid"]))} 已模拟写入，等待 Reload 回读`, validation?.ok === false ? "danger" : "success");
  };

  const verifyItem = (item) => {
    if (statusOf(item) !== "applied" || !item.evidence) {
      announce(notify, "只有已应用并生成证据的动作可以执行 Reload 回读", "danger");
      return;
    }
    const validation = send(dispatch, { type: "VERIFY_EXECUTION_ITEM", storeId: store?.id, executionId: idOf(item), itemId: idOf(item), verification: { requestedAt: new Date().toISOString() } });
    announce(notify, validation?.ok === false ? validation.message : "Reload 回读已完成，页面值与目标值一致", validation?.ok === false ? "danger" : "success");
  };

  if (!selected) {
    return (
      <div className="workspace execution-workspace">
        <WorkspaceHeader eyebrow="VISIBLE EXECUTION" title="实时执行" description="所有动作都在可见领星会话内完成，并绑定 Reload 回读。" actions={missions.length > 1 ? <label className="compact-select"><span className="sr-only">选择 Mission</span><select value={idOf(mission)} onChange={(event) => setSelectedMissionId(event.target.value)}>{missions.map((item) => <option key={idOf(item)} value={idOf(item)}>{valueOf(item, ["title", "name"], idOf(item))}</option>)}</select></label> : null} />
        <EmptyWorkspace
          icon={Monitor}
          title="当前 Mission 暂无执行项"
          description="可切换 Mission，或批准一个 Crux 决策生成受控执行项。"
          action={(
            <button
              className="button primary"
              type="button"
              disabled={!missionDecision}
              title={missionDecision ? undefined : missionDecisions.length > 1 ? "当前 Mission 有多个决策，无法唯一定位" : "当前 Mission 没有可定位的关联决策"}
              onClick={() => missionDecision && onNavigate?.("decisions", {
                kind: "decision",
                id: idOf(missionDecision),
                productId: resolvedProductId(store, missionDecision) || null,
              })}
            >
              {missionDecision ? "打开关联决策" : "没有唯一关联决策"}
            </button>
          )}
        />
      </div>
    );
  }

  return (
    <div className="workspace execution-workspace">
      <WorkspaceHeader
        eyebrow={`EXECUTION ${idOf(selected)}`}
        title={valueOf(mission, ["title", "name", "objective"], valueOf(selected, ["title", "name"], "实时执行"))}
        description={`${actionTypeLabel(valueOf(selected, ["actionType"], ""), selectedBudgetAction ? "广告活动日预算调整" : "关键词出价调整")} · ${valueOf(selected, ["adObjectLabel", "adObjectId"], "当前广告对象")}`}
        actions={(
          <>
            {missions.length > 1 ? <label className="compact-select"><span className="sr-only">选择 Mission</span><select value={idOf(mission)} onChange={(event) => setSelectedMissionId(event.target.value)}>{missions.map((item) => <option key={idOf(item)} value={idOf(item)}>{valueOf(item, ["title", "name"], idOf(item))}</option>)}</select></label> : null}
            <button className="button" type="button" disabled={missionLocked} title={missionLocked ? executionMissionBlocker(store, selected) || undefined : undefined} onClick={() => {
              if (paused) {
                const validation = statusOf(mission) === "paused"
                  ? send(dispatch, { type: "RESUME_MISSION", storeId: store?.id, missionId: idOf(mission), reason: "execution_operator_resume", actor: "human" })
                  : send(dispatch, { type: "RESUME_EXECUTION", storeId: store?.id, executionId: idOf(selected), itemId: idOf(selected), actor: "human" });
                announce(notify, validation?.ok === false ? validation.message : "Agent 与当前执行项已恢复", validation?.ok === false ? "danger" : "info");
              } else {
                const executionValidation = ["running", "executing"].includes(selectedStatus) ? send(dispatch, { type: "PAUSE_EXECUTION", storeId: store?.id, executionId: idOf(selected), itemId: idOf(selected), reason: "execution_operator_pause", actor: "human" }) : { ok: true };
                if (executionValidation?.ok === false) {
                  announce(notify, executionValidation.message, "danger");
                  return;
                }
                const missionValidation = send(dispatch, { type: "PAUSE_MISSION", storeId: store?.id, missionId: idOf(mission), reason: "execution_operator_pause", actor: "human" });
                announce(notify, missionValidation?.ok === false ? missionValidation.message : "Agent 已暂停，尚未保存的动作保持未写入", missionValidation?.ok === false ? "danger" : "info");
              }
            }}>{missionLocked ? <CheckCircle size={16} /> : paused ? <Play size={16} /> : <Pause size={16} />}{missionCompleted ? "Mission 已完成" : missionLocked ? "Mission 已归档" : paused ? "恢复 Agent" : "暂停 Agent"}</button>
            <button className="button" type="button" disabled={!takeoverEnabled || missionLocked || statusOf(mission) === "paused"} onClick={() => { const validation = send(dispatch, { type: "TAKEOVER_EXECUTION", storeId: store?.id, executionId: idOf(selected), itemId: idOf(selected), actor: "human" }); announce(notify, validation?.ok === false ? validation.message : "已切换为人工接管，Agent 停在当前可见页面", validation?.ok === false ? "danger" : "info"); }}><UserFocus size={16} />接管浏览器</button>
            <button className="button" type="button" disabled={!skipEnabled || missionLocked || statusOf(mission) === "paused"} onClick={() => setSkipConfirm(true)}><SkipForward size={16} />跳过此对象</button>
            <button className="button ghost" type="button" onClick={() => openInspector?.({ eyebrow: "执行合同", title: valueOf(selected, ["title", "name"]), fields: [["Execution ID", idOf(selected)], ["执行模式", valueOf(selected, ["executionMode"], store?.mode === "auto" ? "策略内自动（受限）" : "人工审批")], ["策略边界", selected.policyBound === false ? "未通过" : "已通过"], ["Owner", valueOf(selected, ["owner"], "AI Agent")]], note: "模拟写入仅用于原型交互；已批准、已应用与已回读是三个独立状态。" })}><DotsThree size={18} />更多</button>
          </>
        )}
      />

      <section className="contract-strip execution-contract" aria-label="执行合同">
        <div><small>任务 ID</small><strong className="mono">{idOf(selected)}</strong></div>
        <div><small>执行模式</small><strong>{executionModeLabel(valueOf(selected, ["executionMode"], ""), store?.mode === "auto" ? "策略内自动（限内）" : "人工审批")}</strong></div>
        <div><small>风险等级</small><strong className={riskTone(valueOf(selected, ["risk", "riskLevel"], executionNeedsApproval(selected) ? "high" : "low")) === "red" ? "negative" : riskTone(valueOf(selected, ["risk", "riskLevel"], executionNeedsApproval(selected) ? "high" : "low")) === "green" ? "positive" : "warning-text"}>{riskLabel(valueOf(selected, ["risk", "riskLevel"], executionNeedsApproval(selected) ? "high" : "low"))}</strong></div>
        <div><small>安全状态</small><strong className={selected.policyBound === false ? "negative" : "positive"}><ShieldCheck size={15} weight="fill" /> 策略边界 {selected.policyBound === false ? "未通过" : "已通过"}</strong></div>
      </section>

      {escalationCount ? (
        <div className="risk-banner execution-escalation"><Warning size={17} weight="fill" /><strong>{escalationCount} 个对象超出策略内自动边界，转人工审批</strong><span className="spacer" /><button className="link-button" type="button" disabled={!firstEscalatedDecision} title={firstEscalatedDecision ? undefined : "待审批执行项缺少可定位的关联决策"} onClick={() => firstEscalatedDecision && onNavigate?.("decisions", { kind: "decision", id: idOf(firstEscalatedDecision), productId: resolvedProductId(store, firstEscalatedDecision) || null })}>{firstEscalatedDecision ? `查看首个待审批决策 (${escalationCount})` : "关联决策不可定位"} <ArrowRight size={14} /></button></div>
      ) : null}

      <div className="execution-layout">
        <aside className="panel execution-flight-panel" aria-label="执行计划">
          <div className="panel-header"><div><h2>执行计划（{plan.filter((step) => statusOf(step) === "completed").length} / {plan.length}）</h2><p>每一步都可以暂停与人工接管</p></div></div>
          <div className="execution-plan-list">{plan.map((step) => <ExecutionFlightStep key={step.id} step={step} selected={step.id === selectedStepId} onSelect={() => setSelectedStepId(step.id)} timeZone={runtimeTimezone(store)} />)}</div>
          <section className="execution-current-object">
            <span className="eyebrow">当前对象 {items.findIndex((item) => idOf(item) === idOf(selected)) + 1} / {items.length}</span>
            <strong>{valueOf(selected, ["title", "keyword", "searchTerm", "name"], "当前广告对象")}</strong>
            <small>{valueOf(selected, ["adGroup", "campaign", "adObjectId"], "—")}</small>
            <dl className="compact-facts"><div><dt>已处理</dt><dd>{items.filter((item) => ["applied", "verified", "completed", "skipped"].includes(statusOf(item))).length}</dd></div><div><dt>成功</dt><dd>{items.filter((item) => ["applied", "verified", "completed"].includes(statusOf(item))).length}</dd></div><div><dt>等待</dt><dd>{items.filter((item) => ["queued", "pending"].includes(statusOf(item))).length}</dd></div></dl>
          </section>
        </aside>

        <section className="execution-browser-stack">
          <section className="panel lingxing-browser" aria-label="领星浏览器交互模拟">
            <header className="browser-chrome">
              <div><Monitor size={17} /><strong>领星浏览器模拟 · {browserTab === "home" ? "首页" : browserTab === "new" ? "新标签" : browserSection}</strong></div>
              <span>仅原型模拟 · 不连接领星 · {selectedBudgetAction ? "日预算" : "出价"}任务 · {browserRefreshAt ? `刷新 ${timestampOf({ timestamp: browserRefreshAt }, runtimeTimezone(store))}` : "尚未刷新"}</span>
              <button className="icon-button" type="button" onClick={() => { const at = new Date().toISOString(); setBrowserRefreshAt(at); announce(notify, `模拟页面已刷新：${browserTab === "home" ? "首页" : browserTab === "new" ? "空白标签" : browserSection}`, "info"); }} aria-label="刷新模拟页面"><ArrowClockwise size={16} /></button>
            </header>
            <div className="browser-tabs">
              <div className="browser-tab-set" role="tablist" aria-label="领星页面标签">
                <button id="browser-tab-home" aria-controls="browser-panel-home" tabIndex={browserTab === "home" ? 0 : -1} type="button" role="tab" aria-selected={browserTab === "home"} className={browserTab === "home" ? "active" : ""} onKeyDown={(event) => selectTabFromKeyboard(event, browserTabValues, browserTab, selectBrowserTab)} onClick={() => { selectBrowserTab("home"); announce(notify, "已切换到模拟首页", "info"); }}>首页</button>
                <button id="browser-tab-ads" aria-controls="browser-panel-ads" tabIndex={browserTab === "ads" ? 0 : -1} type="button" role="tab" aria-selected={browserTab === "ads"} className={browserTab === "ads" ? "active" : ""} onKeyDown={(event) => selectTabFromKeyboard(event, browserTabValues, browserTab, selectBrowserTab)} onClick={() => selectBrowserTab("ads")}>广告管理</button>
                <button id="browser-tab-search-report" aria-controls="browser-panel-search-report" tabIndex={browserTab === "search-report" ? 0 : -1} type="button" role="tab" aria-selected={browserTab === "search-report"} className={browserTab === "search-report" ? "active" : ""} onKeyDown={(event) => selectTabFromKeyboard(event, browserTabValues, browserTab, selectBrowserTab)} onClick={() => selectBrowserTab("search-report")}>搜索词报告</button>
                {browserTab === "new" ? <button id="browser-tab-new" aria-controls="browser-panel-new" tabIndex={0} type="button" role="tab" aria-selected="true" className="active" onKeyDown={(event) => selectTabFromKeyboard(event, browserTabValues, browserTab, selectBrowserTab)} onClick={() => selectBrowserTab("new")}>新标签</button> : null}
              </div>
              <div className="browser-tab-tools" aria-label="标签操作">
                <button type="button" aria-label="新建领星标签" disabled={browserTab === "new"} onClick={() => { setBrowserTab("new"); window.requestAnimationFrame(() => document.getElementById("browser-tab-new")?.focus()); announce(notify, "已新建模拟空白标签", "info"); }}><Plus size={14} /></button>
                {browserTab === "new" ? <button type="button" aria-label="关闭模拟新标签" onClick={() => { selectBrowserTab("ads"); window.requestAnimationFrame(() => document.getElementById("browser-tab-ads")?.focus()); announce(notify, "模拟标签已关闭", "info"); }}><X size={12} /></button> : null}
              </div>
            </div>
            <div id={`browser-panel-${browserTab}`} role="tabpanel" aria-labelledby={`browser-tab-${browserTab}`}>
            <div className="browser-address"><LockKey size={14} weight="fill" /><span>{browserAddress}</span><ArrowClockwise size={14} /></div>
            {browserTab === "home" ? (
              <div className="browser-state-page">
                <Monitor size={32} />
                <h3>领星首页 · 模拟视图</h3>
                <p>当前只展示受控原型状态，不会连接、下载或写入真实领星账户。</p>
                <div className="summary-strip"><div><small>店铺</small><strong>{store?.id}</strong></div><div><small>会话</small><strong>{valueOf(store?.session, ["statusLabel", "status"], "—")}</strong></div><div><small>待执行</small><strong>{items.length}</strong></div></div>
                <button className="button primary" type="button" onClick={() => { setBrowserTab("ads"); setBrowserSection("关键词"); }}>打开广告管理模拟页</button>
              </div>
            ) : browserTab === "new" ? (
              <div className="browser-state-page">
                <Plus size={32} />
                <h3>模拟空白标签</h3>
                <p>选择一个允许的业务页面继续；原型不会导航到外部网址。</p>
                <div className="inline-actions"><button className="button primary" type="button" onClick={() => { setBrowserTab("ads"); setBrowserSection("关键词"); }}>广告管理</button><button className="button" type="button" onClick={() => { setBrowserTab("search-report"); setBrowserSection("搜索词报告"); }}>搜索词报告</button></div>
              </div>
            ) : <div className="browser-app-shell">
              <nav aria-label="领星广告管理导航">{["概览", "广告活动", "广告组", "关键词", "搜索词报告", "商品投放", "否定关键词", "广告设置"].map((section) => <button className={browserSection === section ? "active" : ""} type="button" key={section} onClick={() => { setBrowserSection(section); if (section === "搜索词报告") setBrowserTab("search-report"); else setBrowserTab("ads"); announce(notify, `领星模拟页已切换到${section}`, "info"); }}>{section}</button>)}</nav>
              <div className="browser-table-area">
                <div className="browser-section-context"><strong>{browserSection}</strong><span>当前表格为本店铺受控动作投影，供原型交互与审批演示。</span></div>
                <div className="browser-toolbar">
                  <label><span className="sr-only">队列筛选</span><select value={browserScope} onChange={(event) => setBrowserScope(event.target.value)}><option value="all">全部调整对象</option><option value="safe">策略内动作</option><option value="approval">需人工审批</option></select></label>
                  <label className="browser-search"><MagnifyingGlass size={15} /><span className="sr-only">搜索调整对象</span><input value={browserQuery} onChange={(event) => setBrowserQuery(event.target.value)} placeholder={selectedBudgetAction ? "搜索广告活动" : "搜索关键词或广告对象"} /></label>
                  <button className="button compact" type="button" onClick={() => announce(notify, `已按${browserScope === "all" ? "全部对象" : browserScope === "approval" ? "需人工审批" : "策略内动作"}筛选`, "info")}><FunnelSimple size={14} />应用筛选</button>
                  <span className="spacer" /><small>更新时间 {valueOf(store, ["lastUpdatedAt", "updatedAt"], "刚刚")}</small>
                </div>
                <div className="table-wrap">
                  <table className="browser-table execution-keyword-table">
                    <thead><tr><th><span className="sr-only">当前对象</span></th><th>{selectedBudgetAction ? "广告活动 / 对象" : "对象 / 搜索词"}</th><th>动作维度</th><th>状态</th><th>花费 ({currency})</th><th>销售额 ({currency})</th><th>ACOS</th><th>{selectedBudgetAction ? "当前日预算" : "当前出价"} ({currency})</th><th>{selectedBudgetAction ? "建议日预算" : "建议出价"} ({currency})</th><th>变更幅度</th><th>操作</th></tr></thead>
                    <tbody>{visibleItems.map((item) => {
                      const itemId = idOf(item);
                      const rowSelected = itemId === idOf(selected);
                      const itemStatus = statusOf(item, "queued");
                      const needsApproval = executionNeedsApproval(item);
                      const approvalComplete = isApproved(item);
                      const done = ["applied", "verified", "completed"].includes(itemStatus);
                      const itemBudgetAction = item?.decisionKind === "budget" || String(item?.actionType || "").includes("预算");
                      const itemDecision = decisions.find((candidate) => idOf(candidate) === String(valueOf(item, ["decisionId"], "")));
                      const policyBlocker = needsApproval && !approvalComplete ? null : automaticActionBlocker(store, item, itemDecision, true);
                      const targetBlocker = executionMissionBlocker(store, item) || executionTargetBlocker(store, item) || executionSessionBlocker(store) || executionFreshnessBlocker(store) || policyBlocker;
                      return (
                        <tr className={`${rowSelected ? "selected" : ""} ${needsApproval ? "approval-boundary" : "safe-boundary"}`} key={itemId} onClick={() => setSelectedId(itemId)}>
                          <td><input type="radio" name="execution-object" checked={rowSelected} onChange={() => setSelectedId(itemId)} aria-label={`选择 ${valueOf(item, ["keyword", "searchTerm", "title"], itemId)}`} /></td>
                          <td><strong>{valueOf(item, ["keyword", "searchTerm", "title", "name"], itemId)}</strong></td>
                          <td>{itemBudgetAction ? "日预算" : matchTypeLabel(valueOf(item, ["matchType"], ""))}</td>
                          <td>{statusLabel(valueOf(item, ["enabledLabel", "objectStatus"], "enabled"))}</td>
                          <td>{formatMoney(valueOf(item, ["spend"], "—"))}</td>
                          <td>{formatMoney(valueOf(item, ["sales", "revenue"], "—"))}</td>
                          <td>{toPercent(valueOf(item, ["acos"], "—"))}</td>
                          <td><input className="table-input bid-input" type="number" step="0.01" value={valueOf(item, ["beforeValue", "beforeBudget", "beforeBid", "currentBid"], "")} readOnly aria-label={itemBudgetAction ? "当前日预算" : "当前出价"} /></td>
                          <td><input className="table-input bid-input" type="number" step="0.01" value={valueOf(item, ["targetValue", "proposedBudget", "proposedBid", "recommendedBid"], "")} readOnly aria-label={itemBudgetAction ? "建议日预算" : "建议出价"} /></td>
                          <td><span className={needsApproval ? "warning-text" : "positive"}>{toPercent(executionDelta(item))}</span></td>
                          <td><button className={`button compact ${needsApproval && !approvalComplete ? "warning" : done ? "success" : "primary"}`} type="button" title={targetBlocker || undefined} disabled={Boolean(targetBlocker) || done || ["rejected", "blocked", "skipped"].includes(itemStatus)} onClick={(event) => { event.stopPropagation(); applyItem(item); }}>{targetBlocker ? "执行条件未满足" : done ? "已保存" : itemStatus === "blocked" ? "策略阻断" : needsApproval && !approvalComplete ? "转审批" : needsApproval ? "人工应用" : `应用 ${formatMoney(valueOf(item, ["targetValue", "proposedBid"]))}`}</button></td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                  {!visibleItems.length ? <div className="empty-state compact-empty"><MagnifyingGlass size={26} /><h3>没有匹配的调整对象</h3><p>清除搜索或切换边界筛选。</p></div> : null}
                </div>
                <footer className="browser-pagination"><span>共 {visibleItems.length} 条</span><span className="spacer" /><button type="button" disabled>上一页</button><button className="active" type="button">1</button><button type="button" disabled>下一页</button></footer>
              </div>
            </div>}
            </div>
          </section>

          <section className="panel execution-detail-panel">
            <div className="tabs execution-detail-tabs" role="tablist" aria-label="执行详情">
              {[{ id: "action", label: "动作详情" }, { id: "compare", label: "前后对比" }, { id: "readback", label: "回读验证" }, { id: "evidence", label: "证据与归档" }, { id: "experiment", label: "关联实验" }].map((tab) => <button id={`execution-detail-tab-${tab.id}`} aria-controls={`execution-detail-panel-${tab.id}`} tabIndex={detailTab === tab.id ? 0 : -1} className={detailTab === tab.id ? "active" : ""} type="button" role="tab" aria-selected={detailTab === tab.id} key={tab.id} onKeyDown={(event) => selectTabFromKeyboard(event, detailTabValues, detailTab, setDetailTab)} onClick={() => setDetailTab(tab.id)}>{tab.label}</button>)}
            </div>
            <div id={`execution-detail-panel-${detailTab}`} className="execution-detail-body" role="tabpanel" aria-labelledby={`execution-detail-tab-${detailTab}`}>
              {detailTab === "action" ? (
                <div className="action-detail-grid">
                  <dl className="compact-facts"><div><dt>目标对象</dt><dd>{valueOf(selected, ["keyword", "searchTerm", "title"], idOf(selected))}</dd></div><div><dt>{selectedBudgetAction ? "所属广告活动" : "所属广告组"}</dt><dd>{valueOf(selected, ["campaign", "adGroup", "adObjectId"], "—")}</dd></div><div><dt>动作类型</dt><dd>{actionTypeLabel(valueOf(selected, ["actionType"], ""), selectedBudgetAction ? "广告日预算调整" : "关键词出价调整")}</dd></div><div><dt>当前状态</dt><dd>{statusLabel(selectedStatus)}</dd></div><div><dt>{selectedBudgetAction ? "当前日预算" : "当前出价"}</dt><dd>{formatMoney(current)}</dd></div><div><dt>{selectedBudgetAction ? "建议日预算" : "建议出价"}</dt><dd>{formatMoney(target)}</dd></div><div><dt>变更幅度</dt><dd className={executionNeedsApproval(selected) ? "warning-text" : "positive"}>{toPercent(delta)}</dd></div></dl>
                  <section><h3>调整原因</h3><p>{valueOf(selected, ["rationale", "reason", "expectedEffect"], "该动作由已批准决策生成，并受当前策略边界约束。")}</p><h3>风险校验</h3><p className={selectedNeedsApproval ? "warning-text" : "positive"}>{selectedExceedsHardLimit ? selectedApprovalComplete ? `变更 ${toPercent(delta)} 超出 ${selectedHardLimit}% 自动硬上限；审批已完成，将由运营者人工应用。` : `变更 ${toPercent(delta)} 超出 ${selectedHardLimit}% 自动硬上限，必须人工审批后再执行。` : selectedNeedsApproval ? selectedApprovalComplete ? "当前策略或执行模式要求人工审批；审批已完成，将由运营者应用。" : "当前策略或执行模式要求人工审批，尚不能应用。" : "通过低风险边界，可在当前策略内执行。"}</p></section>
                  <section className="execution-evidence-card"><h3>浏览器执行证据</h3><dl className="compact-facts"><div><dt>证据 ID</dt><dd className="mono">{valueOf(selected?.evidence, ["id"], "待生成")}</dd></div><div><dt>捕获时间</dt><dd>{valueOf(selected?.evidence, ["capturedAt"], "—")}</dd></div><div><dt>写入值</dt><dd>{formatMoney(valueOf(selected?.evidence, ["appliedValue"], target || "—"))}</dd></div><div><dt>会话</dt><dd>{valueOf(store?.session, ["id", "sessionId"], "—")}</dd></div></dl></section>
                  <section className="execution-live-state"><h3>动作状态</h3><div><Badge tone={statusTone(selectedStatus)}>{statusLabel(selectedStatus)}</Badge><span>{selectedStateCopy}</span></div><div className="inline-actions"><button className={`button ${selectedAwaitingApproval ? "warning" : "primary"}`} type="button" disabled={selectedActionDisabled} onClick={() => applyItem(selected)}>{selectedActionLabel}</button><button className="button success" type="button" disabled={selectedStatus !== "applied" || !selected.evidence || selectedStatus === "verified"} onClick={() => verifyItem(selected)}>Reload 并验证</button></div></section>
                </div>
              ) : null}
              {detailTab === "compare" ? <div className="compare-detail"><div><small>执行前</small><strong>{formatMoney(current)}</strong></div><ArrowRight size={22} /><div><small>目标值</small><strong>{formatMoney(target)}</strong></div><div><small>变更幅度</small><strong className={executionNeedsApproval(selected) ? "warning-text" : "positive"}>{toPercent(delta)}</strong></div></div> : null}
              {detailTab === "readback" ? <div className="readback-detail"><ArrowClockwise size={24} /><div><h3>{selected.verification?.matched ? "Reload 回读一致" : "等待 Reload 回读"}</h3><p>{selected.verification?.matched ? `页面值 ${formatMoney(selected.verification.readbackValue)} 与目标值一致。` : "应用后重新加载领星页面，读取同一对象的最终值。"}</p></div><button className="button primary" type="button" disabled={!selected.evidence || selected.verification?.matched} onClick={() => verifyItem(selected)}>执行回读</button></div> : null}
              {detailTab === "evidence" ? <div className="evidence-detail"><pre>{JSON.stringify({ evidence: selected.evidence || null, verification: selected.verification || null }, null, 2)}</pre><button className="button" type="button" onClick={() => openInspector?.({ eyebrow: "执行证据", title: idOf(selected), fields: [["证据来源", valueOf(selected?.evidence, ["source"], "—")], ["模拟标记", selected?.evidence?.simulation ? "是" : "否"], ["回读匹配", selected?.verification?.matched ? "一致" : "待验证"], ["捕获时间", valueOf(selected?.verification, ["capturedAt"], "—")]] })}>打开证据检查器</button></div> : null}
              {detailTab === "experiment" ? <div className="linked-experiment-detail"><Flask size={24} /><div><h3>{valueOf(relatedExperiment, ["name", "title"], "未关联经营实验")}</h3><p>{valueOf(relatedExperiment, ["hypothesis"], "当前执行项没有可精确定位的关联实验；请先在 Mission 中建立实验关系。")}</p></div><button className="button" type="button" disabled={!relatedExperiment} title={relatedExperiment ? undefined : "当前 Mission 未关联经营实验"} onClick={() => relatedExperiment && onNavigate?.("experiments", { kind: "experiment", id: idOf(relatedExperiment), productId: resolvedProductId(store, relatedExperiment) || null })}>{relatedExperiment ? "打开关联实验" : "未关联实验"}</button></div> : null}
            </div>
          </section>
        </section>
      </div>

      {relatedExperiment ? (
        <footer className="panel execution-related-footer"><div><span className="eyebrow">关联实验</span><strong>{valueOf(relatedExperiment, ["name", "title"], idOf(relatedExperiment))}</strong></div><div><small>假设</small><span>{valueOf(relatedExperiment, ["hypothesis"], "—")}</span></div><div><small>观察窗口</small><span>{valueOf(relatedExperiment, ["window", "observationWindow"], "—")}</span></div><button className="link-button" type="button" onClick={() => onNavigate?.("experiments", { kind: "experiment", id: idOf(relatedExperiment), productId: resolvedProductId(store, relatedExperiment) || null })}>实验详情 <ArrowRight size={14} /></button></footer>
      ) : null}
      <ConfirmDialog open={skipConfirm} onClose={() => setSkipConfirm(false)} onConfirm={() => {
        const validation = send(dispatch, { type: "SKIP_EXECUTION_ITEM", storeId: store?.id, executionId: idOf(selected), itemId: idOf(selected), reason: "operator_skip", actor: "human" });
        announce(notify, validation?.ok === false ? validation.message : "当前对象已跳过，未执行写入；操作已写入审计记录", validation?.ok === false ? "danger" : "info");
        if (validation?.ok !== false) setSkipConfirm(false);
      }} title="确认跳过当前执行对象？" description="跳过后该对象会作为已处理写入 Mission 进度，且不会自动恢复；如需重新执行，应创建新的修订决策。" confirmLabel="确认跳过"><p className="confirm-object-name">{valueOf(selected, ["title", "keyword", "name"], idOf(selected))}</p></ConfirmDialog>
    </div>
  );
}

function memoryType(record) {
  return stageOf(record);
}

function confidenceLabel(value) {
  if (value === undefined || value === null || value === "") return "未评分";
  const numeric = Number(String(value).replace("%", ""));
  if (!Number.isFinite(numeric)) return String(value);
  const normalized = numeric <= 1 ? numeric * 100 : numeric;
  return `${normalized.toFixed(0)}%`;
}

export function MemoryWorkspace({ store, dispatch: _dispatch, onNavigate, openInspector, notify, focusTarget }) {
  const records = useMemo(() => firstArray(store?.causalLedger, store?.memories, store?.memoryRecords).filter((item) => matchesSelectedProduct(store, item) || (focusTarget?.kind === "memory" && idOf(item) === focusTarget.id)), [store?.causalLedger, store?.memories, store?.memoryRecords, store?.missions, store?.adObjects, store?.selectedProductId, focusTarget?.nonce]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [indexRefreshedAt, setIndexRefreshedAt] = useState(null);

  useEffect(() => {
    setQuery("");
    setTypeFilter("ALL");
    setStatusFilter("all");
    setSourceFilter("all");
    setSelectedId("");
    setIndexRefreshedAt(null);
  }, [store?.id]);

  const sources = useMemo(() => [...new Set(records.map((record) => String(valueOf(record, ["source", "actor"], "本地"))))], [records]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return records.filter((record) => {
      const queryMatch = !normalized || JSON.stringify(record).toLowerCase().includes(normalized);
      const typeMatch = typeFilter === "ALL" || memoryType(record) === typeFilter;
      const status = statusOf(record);
      const statusMatch = statusFilter === "all" || status === statusFilter;
      const sourceMatch = sourceFilter === "all" || String(valueOf(record, ["source", "actor"], "本地")) === sourceFilter;
      return queryMatch && typeMatch && statusMatch && sourceMatch;
    });
  }, [records, query, typeFilter, statusFilter, sourceFilter]);

  useEffect(() => {
    if (!filtered.some((record) => idOf(record) === selectedId)) setSelectedId(filtered[0] ? idOf(filtered[0]) : "");
  }, [store?.id, filtered, selectedId]);

  useEffect(() => {
    if (focusTarget?.storeId === store?.id && focusTarget.kind === "memory" && records.some((record) => idOf(record) === focusTarget.id)) {
      setQuery("");
      setTypeFilter("ALL");
      setStatusFilter("all");
      setSourceFilter("all");
      setSelectedId(focusTarget.id);
    }
  }, [focusTarget?.nonce, store?.id, records]);

  const selected = filtered.find((record) => idOf(record) === selectedId) || filtered[0];
  const verifiedCount = records.filter((record) => ["verified", "completed", "done"].includes(statusOf(record)) || valueOf(record, ["observedEffect"], "") !== "").length;
  const reusableCount = records.filter((record) => Number(valueOf(record, ["confidence"], 0)) >= 0.7 || Number(valueOf(record, ["reuseCount"], 0)) > 0).length;
  const links = textList(valueOf(selected, ["links", "evidence", "evidenceRefs"], []));
  const linkIds = new Set(links.map((link) => String(link && typeof link === "object" ? valueOf(link, ["id", "entityId"], "") : link)).filter(Boolean));
  const entityType = String(valueOf(selected, ["entityType"], "")).toLowerCase();
  const entityId = String(valueOf(selected, ["entityId"], ""));
  const allDecisions = firstArray(store?.decisions);
  const allExperiments = firstArray(store?.experiments);
  const linkedExecution = entityType === "execution"
    ? firstArray(store?.executionQueue, store?.executions, store?.executionItems).find((item) => idOf(item) === entityId)
    : null;
  const directDecisionId = String(valueOf(selected, ["decisionId"], entityType === "decision" ? entityId : valueOf(linkedExecution, ["decisionId"], "")));
  const directDecision = allDecisions.find((decision) => idOf(decision) === directDecisionId)
    || allDecisions.find((decision) => linkIds.has(idOf(decision)));
  const relationMissionId = String(valueOf(selected, ["missionId"], valueOf(directDecision, ["missionId"], valueOf(linkedExecution, ["missionId"], ""))));
  const relationAdObjectId = String(valueOf(selected, ["adObjectId"], valueOf(directDecision, ["adObjectId"], valueOf(linkedExecution, ["adObjectId"], ""))));
  const missionDecisionCandidates = relationMissionId
    ? allDecisions.filter((decision) => String(valueOf(decision, ["missionId"], "")) === relationMissionId)
    : [];
  const adObjectDecisionCandidates = relationAdObjectId
    ? missionDecisionCandidates.filter((decision) => String(valueOf(decision, ["adObjectId"], "")) === relationAdObjectId)
    : [];
  const relatedDecision = directDecision
    || (adObjectDecisionCandidates.length === 1 ? adObjectDecisionCandidates[0] : null)
    || (missionDecisionCandidates.length === 1 ? missionDecisionCandidates[0] : null);
  const directExperimentId = String(valueOf(selected, ["experimentId"], entityType === "experiment" ? entityId : ""));
  const directExperiment = allExperiments.find((experiment) => idOf(experiment) === directExperimentId)
    || allExperiments.find((experiment) => linkIds.has(idOf(experiment)));
  const missionExperimentCandidates = relationMissionId
    ? allExperiments.filter((experiment) => String(valueOf(experiment, ["missionId"], "")) === relationMissionId)
    : [];
  const adObjectExperimentCandidates = relationAdObjectId
    ? missionExperimentCandidates.filter((experiment) => String(valueOf(experiment, ["adObjectId"], "")) === relationAdObjectId)
    : [];
  const relatedExperiment = directExperiment
    || (adObjectExperimentCandidates.length === 1 ? adObjectExperimentCandidates[0] : null)
    || (missionExperimentCandidates.length === 1 ? missionExperimentCandidates[0] : null);
  const decisionUnavailableReason = missionDecisionCandidates.length > 1
    ? "当前记录所在 Mission 含多个决策，缺少唯一决策 ID，无法精确定位"
    : "当前记录没有可定位的关联决策";
  const experimentUnavailableReason = missionExperimentCandidates.length > 1
    ? "当前记录所在 Mission 含多个实验，缺少唯一实验 ID，无法精确定位"
    : "当前记录没有可定位的关联实验";

  return (
    <div className="workspace memory-workspace">
      <WorkspaceHeader
        eyebrow="CAUSAL MEMORY"
        title="因果记忆"
        description="保留事实、干预、回读与效果之间的关系，让下一次决策知道什么在何种边界下有效。"
        actions={<button className="button" type="button" onClick={() => { const at = new Date().toISOString(); setIndexRefreshedAt(at); setSelectedId(filtered[0] ? idOf(filtered[0]) : ""); announce(notify, `本地视图索引已重建，共 ${filtered.length} 条`, "info"); }}><ArrowClockwise size={16} />{indexRefreshedAt ? `已刷新 ${timestampOf({ timestamp: indexRefreshedAt }, runtimeTimezone(store))}` : "重建本地索引"}</button>}
      />

      <section className="summary-strip memory-summary" aria-label="因果记忆摘要">
        <div><small>记忆记录</small><strong>{records.length}</strong></div>
        <div><small>已回读验证</small><strong>{verifiedCount}</strong></div>
        <div><small>可复用因果</small><strong>{reusableCount}</strong></div>
        <div><small>当前店铺</small><strong>{store?.id || "—"}</strong></div>
      </section>

      <section className="panel memory-toolbar-panel">
        <div className="toolbar memory-toolbar">
          <label className="search-control"><MagnifyingGlass size={16} /><span className="sr-only">搜索因果记忆</span><input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索信号、动作、效果、ASIN 或证据 ID" /></label>
          <label className="filter-control"><FunnelSimple size={15} /><span className="sr-only">类型</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="ALL">全部类型</option>{LEDGER_STAGES.map((stage) => <option key={stage} value={stage}>{LEDGER_META[stage].label}</option>)}</select></label>
          <label className="filter-control"><span className="sr-only">状态</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">全部状态</option><option value="verified">已验证</option><option value="completed">已完成</option><option value="observed">观察中</option><option value="archived">已归档</option></select></label>
          <label className="filter-control"><span className="sr-only">来源</span><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="all">全部来源</option>{sources.map((source) => <option key={source} value={source}>{source}</option>)}</select></label>
          <span className="spacer" /><Badge tone="blue">{filtered.length} 条匹配</Badge>
        </div>
      </section>

      <div className="memory-layout">
        <section className="panel memory-list-panel">
          <div className="memory-list-header"><span>时间 / 类型</span><span>因果记录</span><span>置信度</span><span>状态</span></div>
          <div className="memory-list" role="listbox" aria-label="因果记录列表">
            {filtered.map((record) => {
              const id = idOf(record);
              const stage = memoryType(record);
              const meta = LEDGER_META[stage];
              const Icon = meta.icon;
              const selectedRow = id === selectedId;
              return (
                <button className={`memory-list-item ${selectedRow ? "selected" : ""}`} role="option" aria-selected={selectedRow} tabIndex={selectedRow ? 0 : -1} type="button" key={id} onKeyDown={(event) => selectListItemFromKeyboard(event, filtered.map(idOf), selectedId, setSelectedId)} onClick={() => setSelectedId(id)}>
                  <span className="memory-time-kind"><time>{timestampOf(record, runtimeTimezone(store))}</time><Badge tone={meta.tone}><Icon size={13} weight="fill" />{meta.label}</Badge></span>
                  <span className="memory-record-copy"><strong>{valueOf(record, ["title", "name"], `${meta.label}记录`)}</strong><small>{valueOf(record, ["signal", "intervention", "observedEffect", "detail"], "—")}</small><em>{valueOf(record, ["entityId", "missionId"], "当前店铺")}</em></span>
                  <strong>{confidenceLabel(valueOf(record, ["confidence"], ""))}</strong>
                  <Badge tone={statusTone(statusOf(record, "completed"))}>{statusLabel(statusOf(record, "completed"))}</Badge>
                </button>
              );
            })}
            {!filtered.length ? <div className="empty-state"><Database size={30} /><h3>没有匹配的因果记录</h3><p>尝试搜索动作、效果或证据 ID，或清除筛选。</p></div> : null}
          </div>
        </section>

        <aside className="panel memory-detail-panel" aria-label="因果记录详情">
          {selected ? (
            <>
              <header className="memory-detail-header">
                <div><span className="eyebrow">MEMORY {idOf(selected)}</span><h2>{valueOf(selected, ["title", "name"], "因果记录")}</h2><p>{timestampOf(selected, runtimeTimezone(store))} · {valueOf(selected, ["source", "actor"], "本地记录")}</p></div>
                <Badge tone={statusTone(statusOf(selected, "completed"))}>{statusLabel(statusOf(selected, "completed"))}</Badge>
              </header>
              <div className="memory-detail-body">
                <section className="causal-chain" aria-label="因果链">
                  <div><span><Database size={17} /></span><small>信号 / 事实</small><strong>{valueOf(selected, ["signal", "fact"], "—")}</strong></div>
                  <ArrowRight size={16} />
                  <div><span><Target size={17} /></span><small>决策 / 干预</small><strong>{valueOf(selected, ["intervention", "decision", "action"], "—")}</strong></div>
                  <ArrowRight size={16} />
                  <div><span><ArrowClockwise size={17} /></span><small>回读 / 效果</small><strong>{valueOf(selected, ["observedEffect", "effect", "readback"], "—")}</strong></div>
                </section>
                <section className="memory-detail-section">
                  <h3>因果判断</h3>
                  <p>{valueOf(selected, ["summary", "rationale", "expectedEffect"], "该记录保留了当前边界内的经营信号、干预与观测效果。")}</p>
                  <dl className="compact-facts"><div><dt>置信度</dt><dd>{confidenceLabel(valueOf(selected, ["confidence"], ""))}</dd></div><div><dt>实体类型</dt><dd>{valueOf(selected, ["entityType"], "—")}</dd></div><div><dt>实体 ID</dt><dd className="mono">{valueOf(selected, ["entityId"], "—")}</dd></div><div><dt>Mission</dt><dd className="mono">{valueOf(selected, ["missionId"], "—")}</dd></div></dl>
                </section>
                <section className="memory-detail-section">
                  <div className="section-heading"><h3>证据与关联</h3><button className="link-button" type="button" onClick={() => openInspector?.({ eyebrow: "记忆证据", title: valueOf(selected, ["title", "name"]), fields: [["Memory ID", idOf(selected)], ["来源", valueOf(selected, ["source", "actor"])], ["引用数量", links.length], ["置信度", confidenceLabel(valueOf(selected, ["confidence"], ""))]], note: "因果记忆只在同店铺隔离范围内参与后续建议，且不能替代当次真实回读。" })}>证据检查器 <Eye size={14} /></button></div>
                  <div className="memory-link-list">{links.length ? links.map((link, index) => <button type="button" key={`${index}-${String(link)}`} onClick={() => openInspector?.({ eyebrow: "证据引用", title: String(link), fields: [["关联记忆", idOf(selected)], ["来源", valueOf(selected, ["source"], "—")], ["店铺", store?.id || "—"]] })}><LinkSimple size={15} /><span>{String(link)}</span><CaretRight size={14} /></button>) : <p className="muted">当前记录没有外部证据引用。</p>}</div>
                </section>
                <section className="memory-detail-section reuse-guidance">
                  <h3>复用边界</h3>
                  <p>{valueOf(selected, ["reuseGuidance", "constraints"], "只在相同店铺、对象类型与策略版本下作为先验；执行前仍需核验当次事实。")}</p>
                  <div className="inline-actions">
                    <button
                      className="button"
                      type="button"
                      disabled={!relatedDecision}
                      title={relatedDecision ? undefined : decisionUnavailableReason}
                      onClick={() => relatedDecision && onNavigate?.("decisions", { kind: "decision", id: idOf(relatedDecision), productId: resolvedProductId(store, relatedDecision) || null })}
                    >
                      <Target size={15} />{relatedDecision ? "查看相关决策" : "没有唯一关联决策"}
                    </button>
                    <button
                      className="button"
                      type="button"
                      disabled={!relatedExperiment}
                      title={relatedExperiment ? undefined : experimentUnavailableReason}
                      onClick={() => relatedExperiment && onNavigate?.("experiments", { kind: "experiment", id: idOf(relatedExperiment), productId: resolvedProductId(store, relatedExperiment) || null })}
                    >
                      <Flask size={15} />{relatedExperiment ? "查看相关实验" : "没有唯一关联实验"}
                    </button>
                  </div>
                </section>
              </div>
            </>
          ) : <div className="empty-state"><Database size={30} /><h3>选择一条因果记录</h3><p>查看信号、干预、回读效果和复用边界。</p></div>}
        </aside>
      </div>
    </div>
  );
}
