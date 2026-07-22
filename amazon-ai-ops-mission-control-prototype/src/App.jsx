import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Brain,
  CaretDown,
  ChartLineUp,
  CheckCircle,
  ClipboardText,
  Command,
  Crosshair,
  Database,
  Flask,
  Gear,
  GitBranch,
  ListChecks,
  MagnifyingGlass,
  MonitorPlay,
  Notebook,
  Pause,
  Path,
  PlugsConnected,
  Question,
  Robot,
  RocketLaunch,
  ShieldCheck,
  SidebarSimple,
  Sparkle,
  Stack,
  Storefront,
  Sun,
  Target,
  Warning,
  X,
} from "@phosphor-icons/react";
import { NAV_GROUPS, STORE_CATALOG, resolveProductId, usePrototypeModel } from "./model.js";
import {
  DecisionsWorkspace,
  ExecutionWorkspace,
  ExperimentWorkspace,
  MemoryWorkspace,
  MissionWorkspace,
} from "./core-workspaces.jsx";
import {
  CollectionWorkspace,
  ObjectsWorkspace,
  PolicyWorkspace,
  SettingsWorkspace,
  TodayWorkspace,
} from "./business-workspaces.jsx";
import { ConfirmDialog, Modal } from "./primitives.jsx";

const ICONS = {
  today: ChartLineUp,
  missions: ListChecks,
  decisions: ClipboardText,
  experiments: Flask,
  execution: MonitorPlay,
  memory: Notebook,
  objects: Storefront,
  collection: Database,
  policy: ShieldCheck,
  settings: Gear,
  brain: Brain,
  target: Target,
  sun: Sun,
  crosshair: Crosshair,
  "git-branch": GitBranch,
  flask: Flask,
  "rocket-launch": RocketLaunch,
  path: Path,
  stack: Stack,
  database: Database,
  "shield-check": ShieldCheck,
  gear: Gear,
};

const FALLBACK_NAV = [
  { group: "智能体工作台", items: [
    { id: "today", label: "今日任务", iconKey: "today" },
    { id: "missions", label: "任务中心", iconKey: "missions" },
    { id: "decisions", label: "决策与审批", iconKey: "decisions" },
    { id: "experiments", label: "经营实验", iconKey: "experiments" },
    { id: "execution", label: "实时执行", iconKey: "execution" },
    { id: "memory", label: "因果记忆", iconKey: "memory" },
  ] },
  { group: "业务对象", items: [
    { id: "objects", label: "店铺与广告对象", iconKey: "objects" },
    { id: "collection", label: "数据采集", iconKey: "collection" },
    { id: "policy", label: "策略与风控", iconKey: "policy" },
    { id: "settings", label: "系统设置", iconKey: "settings" },
  ] },
];

const WORKSPACE_COMPONENTS = {
  today: TodayWorkspace,
  missions: MissionWorkspace,
  decisions: DecisionsWorkspace,
  experiments: ExperimentWorkspace,
  execution: ExecutionWorkspace,
  memory: MemoryWorkspace,
  objects: ObjectsWorkspace,
  collection: CollectionWorkspace,
  policy: PolicyWorkspace,
  settings: SettingsWorkspace,
};

const DISPLAY_STATUS_LABELS = {
  active: "进行中",
  running: "运行中",
  pending: "待处理",
  proposed: "待确认",
  draft: "草稿",
  needs_approval: "待审批",
  awaiting_approval: "待审批",
  approved: "已批准",
  verified: "已验证",
  completed: "已完成",
  paused: "已暂停",
  blocked: "已阻断",
  rejected: "已拒绝",
  archived: "已归档",
};

function displayStatus(value) {
  return DISPLAY_STATUS_LABELS[value] || value || "待处理";
}

function normalizeNavGroups(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return FALLBACK_NAV;
  if (groups[0]?.items) return groups;
  return groups.reduce((result, item) => {
    const groupName = item.group || "智能体工作台";
    let group = result.find((candidate) => candidate.group === groupName);
    if (!group) {
      group = { group: groupName, items: [] };
      result.push(group);
    }
    group.items.push(item);
    return result;
  }, []);
}

function Toasts({ items, onDismiss }) {
  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {items.map((toast) => (
        <div className={`toast toast-${toast.tone || "info"}`} key={toast.id}>
          <CheckCircle size={18} weight="fill" />
          <span>{toast.message}</span>
          <button type="button" aria-label="关闭提示" onClick={() => onDismiss(toast.id)}>
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Inspector({ item, onClose }) {
  if (!item) return null;
  const fields = item.fields || [];
  return (
    <aside className="global-inspector" aria-label="对象检查器">
      <header>
        <div>
          <span className="eyebrow">{item.eyebrow || "对象检查器"}</span>
          <h2>{item.title || "详情"}</h2>
          {item.subtitle ? <p>{item.subtitle}</p> : null}
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭检查器">
          <X size={18} />
        </button>
      </header>
      <div className="inspector-body">
        {item.content || (
          <>
            <section className="inspector-section">
              <h3>当前信息</h3>
              <dl className="inspector-facts">
                {fields.map(([label, value]) => (
                  <div key={`${label}:${value}`}>
                    <dt>{label}</dt>
                    <dd>{value ?? "—"}</dd>
                  </div>
                ))}
              </dl>
            </section>
            {item.note ? (
              <section className="inspector-section inspector-note">
                <h3>说明</h3>
                <p>{item.note}</p>
              </section>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}

function CommandPalette({ open, navGroups, store, onClose, onNavigate }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);
  if (!open) return null;
  const routeItems = navGroups.flatMap((group) => group.items).map((item) => ({ ...item, route: item.id, subtitle: "打开工作区", searchText: item.label }));
  const productFor = (item) => {
    return resolveProductId(store, item) || null;
  };
  const entityItems = [
    ...(store?.missions || []).map((item) => ({ id: `mission:${item.id}`, entityId: item.id, entityKind: "mission", targetProductId: productFor(item), route: "missions", iconKey: "missions", label: item.title || item.name || item.id, subtitle: `Mission · ${item.id}`, searchText: JSON.stringify(item) })),
    ...(store?.decisions || []).map((item) => ({ id: `decision:${item.id}`, entityId: item.id, entityKind: "decision", targetProductId: productFor(item), route: "decisions", iconKey: "decisions", label: item.title || item.question || item.id, subtitle: `Crux 决策 · ${displayStatus(item.status)}`, searchText: JSON.stringify(item) })),
    ...(store?.experiments || []).map((item) => ({ id: `experiment:${item.id}`, entityId: item.id, entityKind: "experiment", targetProductId: productFor(item), route: "experiments", iconKey: "experiments", label: item.name || item.title || item.id, subtitle: `经营实验 · ${displayStatus(item.status)}`, searchText: JSON.stringify(item) })),
    ...(store?.products || []).map((item) => ({ id: `product:${item.id}`, entityId: item.id, entityKind: "product", targetProductId: item.id, route: "objects", iconKey: "objects", label: item.name || item.sku || item.id, subtitle: `产品 · ${item.sku || item.asin || item.id}`, searchText: JSON.stringify(item) })),
    ...(store?.adObjects || []).map((item) => ({ id: `ad:${item.id}`, entityId: item.id, entityKind: "adObject", targetProductId: productFor(item), route: "objects", iconKey: "objects", label: item.name || item.id, subtitle: `广告对象 · ${item.externalId || item.id}`, searchText: JSON.stringify(item) })),
    ...(store?.executionQueue || []).map((item) => ({ id: `execution:${item.id}`, entityId: item.id, entityKind: "execution", targetProductId: productFor(item), route: "execution", iconKey: "execution", label: item.title || item.id, subtitle: `执行动作 · ${displayStatus(item.status)}`, searchText: JSON.stringify(item) })),
    ...(store?.operationEvents || []).map((item) => ({ id: `event:${item.id}`, entityId: item.id, entityKind: "operationEvent", targetProductId: productFor(item), route: "today", iconKey: "today", label: item.title || item.id, subtitle: `运营事件 · ${item.type || "事实"}`, searchText: JSON.stringify(item) })),
    ...(store?.policies || []).map((item) => ({ id: `policy:${item.id}`, entityId: item.id, entityKind: "policy", targetProductId: productFor(item), route: "policy", iconKey: "policy", label: item.name || item.id, subtitle: `策略 v${item.version || 1} · ${displayStatus(item.status)}`, searchText: JSON.stringify(item) })),
    ...(store?.collectionRuns || []).map((item) => ({ id: `collection:${item.id}`, entityId: item.id, entityKind: "collectionJob", targetProductId: productFor(item), route: "collection", iconKey: "collection", label: item.name || item.id, subtitle: `采集任务 · ${displayStatus(item.status)}`, searchText: JSON.stringify(item) })),
    ...(store?.reportImports || []).map((item) => ({ id: `report:${item.id}`, entityId: item.id, entityKind: "reportImport", targetProductId: productFor(item), route: "collection", iconKey: "collection", label: item.fileName || item.name || item.id, subtitle: `报表导入 · ${item.rowCount || 0} 行`, searchText: JSON.stringify(item) })),
    ...(store?.causalLedger || []).map((item) => ({ id: `memory:${item.id}`, entityId: item.id, entityKind: "memory", targetProductId: productFor(item), route: "memory", iconKey: "memory", label: item.title || item.summary || item.id, subtitle: `因果记忆 · ${item.type || item.stage || "记录"}`, searchText: JSON.stringify(item) })),
  ];
  const allItems = [...routeItems, ...entityItems];
  const normalized = query.trim().toLowerCase();
  const results = allItems.filter((item) => !normalized || `${item.label} ${item.subtitle || ""} ${item.searchText || ""}`.toLowerCase().includes(normalized)).slice(0, 20);
  const boundedActiveIndex = results.length ? Math.min(activeIndex, results.length - 1) : -1;
  const focusResult = (index) => {
    if (!results.length) return;
    const next = (index + results.length) % results.length;
    setActiveIndex(next);
    window.requestAnimationFrame(() => document.getElementById(`command-result-${next}`)?.focus());
  };
  return (
    <Modal open={open} onClose={onClose} title="快速导航" description="搜索当前店铺的工作区、事实、决策和业务对象。" className="command-palette" size="large">
        <div className="command-search">
          <MagnifyingGlass size={18} />
          <input autoFocus aria-label="搜索工作区与业务对象" aria-controls="command-results" aria-activedescendant={boundedActiveIndex >= 0 ? `command-result-${boundedActiveIndex}` : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); focusResult(0); } else if (event.key === "ArrowUp") { event.preventDefault(); focusResult(results.length - 1); } else if (event.key === "Enter" && results[boundedActiveIndex]) { event.preventDefault(); const item = results[boundedActiveIndex]; onNavigate(item.route || item.id, item.entityId ? { id: item.entityId, kind: item.entityKind, productId: item.targetProductId } : null); onClose(); } }} placeholder="搜索事实、决策、ASIN、广告对象或工作区" />
          <kbd>Esc</kbd>
        </div>
        <div className="command-results" id="command-results" role="listbox" aria-label="快速导航结果">
          {results.map((item, index) => {
            const Icon = ICONS[item.iconKey || item.id] || Sparkle;
            return (
              <button id={`command-result-${index}`} key={item.id} type="button" role="option" aria-selected={boundedActiveIndex === index} tabIndex={boundedActiveIndex === index ? 0 : -1} onFocus={() => setActiveIndex(index)} onKeyDown={(event) => { if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); focusResult(event.key === "Home" ? 0 : event.key === "End" ? results.length - 1 : index + (event.key === "ArrowDown" ? 1 : -1)); } }} onClick={() => { onNavigate(item.route || item.id, item.entityId ? { id: item.entityId, kind: item.entityKind, productId: item.targetProductId } : null); onClose(); }}>
                <Icon size={18} />
                <span>{item.label}</span>
                <small>{item.subtitle || "打开工作区"}</small>
              </button>
            );
          })}
          {!results.length ? <p className="command-empty">当前店铺没有匹配的事实、决策或对象。</p> : null}
        </div>
    </Modal>
  );
}

function SessionCenter({ open, requestedSource, store, dispatch, onClose, notify, onSessionInvalidated }) {
  const [busyAction, setBusyAction] = useState(null);
  const [source, setSource] = useState(requestedSource === "amazon_ads" ? "amazon_ads" : "lingxing");
  useEffect(() => {
    if (open) setSource(requestedSource === "amazon_ads" ? "amazon_ads" : "lingxing");
  }, [open, requestedSource, store?.id]);
  const sourceLabel = source === "amazon_ads" ? "Amazon Ads" : "领星";
  const sourceSession = source === "amazon_ads" ? store?.session?.amazonAds : store?.session?.lingxing;
  const sourceLoggedIn = sourceSession?.status === "connected";
  const connected = source === "amazon_ads"
    ? sourceLoggedIn && sourceSession?.scope === "read_write_simulated"
    : sourceLoggedIn;
  const profile = store?.browserProfileId || store?.session?.profile || `${String(store?.id || "store").toLowerCase()}-profile`;
  const moveSourceTab = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const values = ["lingxing", "amazon_ads"];
    const currentIndex = values.indexOf(source);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? 1 : event.key === "ArrowRight" ? (currentIndex + 1) % 2 : (currentIndex + 1) % 2;
    setSource(values[nextIndex]);
    window.requestAnimationFrame(() => document.getElementById(`session-source-tab-${values[nextIndex]}`)?.focus());
  };
  const perform = (type) => {
    if (!store || busyAction) return;
    setBusyAction(type);
    const targetStoreId = store.id;
    const targetSource = source;
    window.setTimeout(() => {
      const validation = dispatch({ type, storeId: targetStoreId, source: targetSource, actor: "human" });
      if (type === "DISCONNECT_SESSION") onSessionInvalidated?.();
      const targetLabel = targetSource === "amazon_ads" ? "Amazon Ads" : "领星";
      const success = {
        CONNECT_SESSION: `已在独立 Profile 中模拟确认 ${targetStoreId} 的 ${targetLabel} 登录`,
        REFRESH_SESSION: `${targetStoreId} 的 ${targetLabel} 会话心跳已刷新`,
        DISCONNECT_SESSION: `${targetStoreId} 的 ${targetLabel} 会话已断开，对应安全门已关闭`,
      };
      notify?.(validation?.ok === false ? validation.message : success[type], validation?.ok === false ? "danger" : "info");
      setBusyAction(null);
    }, 420);
  };
  return (
    <Modal
      open={open}
      onClose={busyAction ? undefined : onClose}
      title={`${store?.id || "店铺"} · 会话与可见浏览器`}
      description="第一版的采集与广告动作都依赖长期可见浏览器；每个店铺使用完全独立的 Profile、Cookie 与下载目录。"
      size="large"
      className="session-center-modal"
    >
      <div className="prototype-simulation-notice" role="note"><ShieldCheck size={17} weight="fill" /><span><strong>交互原型模拟</strong>：不会提交真实密码，也不会连接领星或 Amazon Ads；状态变化只写入当前店铺的本地演示数据。</span></div>
      {store?.profileConflict ? <div className="persistence-alert" role="alert"><Warning size={17} weight="fill" /><span><strong>Profile 冲突：</strong>该 Profile 同时属于 {store.profileConflictWith?.join("、") || "其他店铺"}。会话已断开，请先到系统设置修改为唯一 Profile。</span></div> : null}
      <div className="session-source-tabs" role="tablist" aria-label="选择会话来源">
        <button id="session-source-tab-lingxing" aria-controls="session-source-panel" type="button" role="tab" tabIndex={source === "lingxing" ? 0 : -1} aria-selected={source === "lingxing"} className={source === "lingxing" ? "active" : ""} onKeyDown={moveSourceTab} onClick={() => setSource("lingxing")}>领星登录</button>
        <button id="session-source-tab-amazon_ads" aria-controls="session-source-panel" type="button" role="tab" tabIndex={source === "amazon_ads" ? 0 : -1} aria-selected={source === "amazon_ads"} className={source === "amazon_ads" ? "active" : ""} onKeyDown={moveSourceTab} onClick={() => setSource("amazon_ads")}>Amazon Ads 授权</button>
      </div>
      <div className="session-center-grid">
        <section id="session-source-panel" className="visible-browser-card" role="tabpanel" aria-labelledby={`session-source-tab-${source}`} aria-label="可见浏览器预览">
          <header className="browser-frame-toolbar">
            <span className="browser-window-dots" aria-hidden="true"><i /><i /><i /></span>
            <span className="browser-address"><PlugsConnected size={14} />{source === "amazon_ads" ? connected ? "https://advertising.amazon.com/cm/campaigns" : "https://advertising.amazon.com/login" : connected ? "https://erp.lingxing.com/dashboard" : "https://erp.lingxing.com/login"}</span>
            <BadgeLike tone={connected ? "success" : "warning"}>{connected ? `${sourceLabel} 会话可用` : source === "amazon_ads" && sourceLoggedIn ? "已登录 · 待写入授权" : `等待${sourceLabel}确认`}</BadgeLike>
          </header>
          <div className="browser-frame-body">
            <div className={`browser-login-illustration ${connected ? "connected" : ""}`}><MonitorPlay size={34} weight="duotone" /><strong>{connected ? `${sourceLabel} 工作台已就绪` : `请在可见窗口完成${sourceLabel === "领星" ? "登录" : "授权确认"}`}</strong><p>{connected ? source === "lingxing" ? "下载中心和经营报表可由运营者随时接管。" : "广告活动页面已通过模拟读写权限校验，可由运营者随时接管。" : source === "lingxing" ? "系统不会读取或回显保存的密码；登录完成后仅记录非敏感会话状态。" : "Ads 权限独立于领星登录；必须单独确认，不会由领星状态推导。"}</p></div>
          </div>
          <footer><span>Profile <strong className="mono">{profile}</strong></span><span>{source === "lingxing" ? "下载目录" : "权限范围"} <strong className="mono">{source === "lingxing" ? `downloads/${store?.id}` : store?.session?.amazonAds?.scope || "none"}</strong></span></footer>
        </section>
        <section className="session-fact-card">
          <h3>会话安全门</h3>
          <dl className="session-facts">
            <div><dt>领星</dt><dd><BadgeLike tone={store?.session?.lingxing?.status === "connected" ? "success" : "warning"}>{store?.session?.lingxing?.status === "connected" ? "已连接" : store?.session?.lingxing?.status === "expired" ? "已过期" : "未连接"}</BadgeLike></dd></div>
            <div><dt>Amazon Ads</dt><dd><BadgeLike tone={store?.session?.amazonAds?.status === "connected" ? "success" : "warning"}>{store?.session?.amazonAds?.status === "connected" ? "已连接" : "未连接"}</BadgeLike></dd></div>
            <div><dt>Ads 权限</dt><dd className="mono">{store?.session?.amazonAds?.scope || "none"}</dd></div>
            <div><dt>数据新鲜度</dt><dd>{Number.isFinite(Number(store?.session?.lingxing?.freshnessMinutes)) ? `${store.session.lingxing.freshnessMinutes} 分钟` : "—"}</dd></div>
            <div><dt>最近确认</dt><dd>{store?.session?.lastVerifiedAt || "—"}</dd></div>
            <div><dt>领星账号映射</dt><dd>{store?.lingxingAccount || store?.session?.lingxing?.account || store?.id}</dd></div>
          </dl>
          <div className="session-actions">
            {!connected ? <button className="button primary" type="button" aria-busy={busyAction === "CONNECT_SESSION" || undefined} disabled={Boolean(busyAction) || Boolean(store?.profileConflict)} onClick={() => perform("CONNECT_SESSION")}>{store?.profileConflict ? "先修复 Profile 冲突" : busyAction === "CONNECT_SESSION" ? "正在打开可见浏览器…" : source === "lingxing" ? "模拟登录并确认领星" : sourceLoggedIn ? "补齐并验证 Ads 写入授权" : "模拟授权并验证 Ads"}</button> : <button className="button primary" type="button" aria-busy={busyAction === "REFRESH_SESSION" || undefined} disabled={Boolean(busyAction) || Boolean(store?.profileConflict)} onClick={() => perform("REFRESH_SESSION")}>{store?.profileConflict ? "先修复 Profile 冲突" : busyAction === "REFRESH_SESSION" ? "正在刷新…" : `刷新${sourceLabel}心跳`}</button>}
            <button className="button ghost" type="button" disabled={Boolean(busyAction)} onClick={() => notify?.(`${sourceLabel} 可见浏览器已置于前台；原型不启动真实外部窗口`, "info")}>接管可见窗口</button>
            {connected ? <button className="button danger" type="button" aria-busy={busyAction === "DISCONNECT_SESSION" || undefined} disabled={Boolean(busyAction)} onClick={() => perform("DISCONNECT_SESSION")}>{busyAction === "DISCONNECT_SESSION" ? "正在断开…" : `断开${sourceLabel}会话`}</button> : null}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function BadgeLike({ children, tone = "neutral" }) {
  return <span className={`badge badge-${tone} ${tone}`}>{children}</span>;
}

export function App() {
  const { state, activeStore, dispatch, resetDemo, persistenceStatus } = usePrototypeModel();
  const navGroups = useMemo(() => normalizeNavGroups(NAV_GROUPS), []);
  const [routeByStore, setRouteByStore] = useState(() => Object.fromEntries(STORE_CATALOG.map((store) => [store.id, "today"])));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspector, setInspector] = useState(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sessionCenterRequest, setSessionCenterRequest] = useState(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [autoModeConfirm, setAutoModeConfirm] = useState(false);
  const [autoModeMissionId, setAutoModeMissionId] = useState(null);
  const [autoModeArmedStoreId, setAutoModeArmedStoreId] = useState(null);
  const [executionScope, setExecutionScope] = useState(null);
  const executionScopeRef = useRef(null);
  const [toasts, setToasts] = useState([]);
  const [focusTarget, setFocusTarget] = useState(null);
  const [autoRunTick, setAutoRunTick] = useState(0);
  const autoRunAttemptsRef = useRef(new Set());
  const autoRunPendingRef = useRef(null);

  const activeStoreId = state.activeStoreId;
  const allStores = Object.values(state.stores || {});
  const switchableStores = allStores.filter((store) => !store.archived && store.status !== "archived");
  const route = routeByStore[activeStoreId] || "today";
  const Workspace = WORKSPACE_COMPONENTS[route] || TodayWorkspace;
  const activeMission = activeStore?.missions?.find((mission) => mission.status === "active") || activeStore?.missions?.[0];
  const activeProducts = (activeStore?.products || []).filter((product) => !product.archived && product.status !== "archived");
  const selectedProduct = activeProducts.find((product) => product.id === activeStore.selectedProductId) || activeProducts[0] || null;
  const sessionConnected = !activeStore?.profileConflict
    && activeStore?.session?.status === "connected"
    && activeStore?.session?.lingxing?.status === "connected"
    && activeStore?.session?.amazonAds?.status === "connected"
    && activeStore?.session?.amazonAds?.scope === "read_write_simulated";
  const sessionLabel = activeStore?.profileConflict
    ? "浏览器 Profile 冲突"
    : sessionConnected
    ? "领星与 Ads 会话正常"
    : activeStore?.session?.lingxing?.status !== "connected"
      ? "领星会话待确认"
      : activeStore?.session?.amazonAds?.status !== "connected"
        ? "Ads 会话待确认"
        : "Ads 写入授权待确认";
  const openDecisionStatuses = ["pending", "needs_approval", "awaiting_approval", "proposed", "draft", "needs_data", "escalated", "blocked"];
  const interventionDecisions = (activeStore?.decisions || []).filter((decision) => openDecisionStatuses.includes(decision.status));
  const failedCollections = (activeStore?.collectionRuns || []).filter((run) => run.status === "failed");
  const notificationCount = interventionDecisions.length + failedCollections.length;
  const autoMissionCandidates = (activeStore?.missions || []).filter((mission) => ["active", "running"].includes(mission.status) && mission.productId === selectedProduct?.id);
  const scopedMission = route === "execution" && executionScope?.storeId === activeStoreId && executionScope?.productId === selectedProduct?.id
    ? autoMissionCandidates.find((mission) => mission.id === executionScope.missionId)
    : null;
  const confirmationMission = (autoModeConfirm ? autoMissionCandidates.find((mission) => mission.id === autoModeMissionId) : null)
    || scopedMission
    || autoMissionCandidates.find((mission) => mission.id === autoModeMissionId)
    || autoMissionCandidates[0]
    || null;
  const autoEligibleCount = (activeStore?.executionQueue || []).filter((item) => ["ready", "queued", "applied"].includes(item.status) && item.autoEligible && item.executionMode !== "human_only" && item.productId === selectedProduct?.id && item.missionId === confirmationMission?.id).length;

  const notify = (message, tone = "success") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current.slice(-3), { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3200);
  };

  const switchStore = (nextStoreId) => {
    const nextStore = state.stores?.[nextStoreId];
    if (!nextStore || nextStore.archived || nextStore.status === "archived") {
      notify("目标店铺不存在或已归档，无法切换", "danger");
      return;
    }
    if (nextStoreId === activeStoreId) return;
    if (activeStore?.mode === "auto" && autoModeArmedStoreId === activeStoreId) {
      dispatch({ type: "SET_MODE", storeId: activeStoreId, mode: "approval", actor: "human" });
    }
    setAutoModeArmedStoreId(null);
    setAutoModeMissionId(null);
    setAutoModeConfirm(false);
    executionScopeRef.current = null;
    setExecutionScope(null);
    const validation = dispatch({ type: "SWITCH_STORE", storeId: nextStoreId, actor: "human" });
    if (validation?.ok === false) {
      notify(validation.message, "danger");
      return;
    }
    setFocusTarget(null);
    setInspector(null);
    setSessionCenterRequest(null);
    notify(`已切换到 ${nextStoreId}，原策略内自动范围已停止，数据与策略保持隔离`, "info");
  };

  const navigate = (nextRoute, target = null) => {
    if (activeStore?.mode === "auto" && autoModeArmedStoreId === activeStoreId && nextRoute !== "execution") {
      dispatch({ type: "SET_MODE", storeId: activeStoreId, mode: "approval", actor: "human" });
      setAutoModeArmedStoreId(null);
      notify("已离开实时执行页，系统自动切回人工审批", "info");
    }
    if (target?.productId && activeProducts.some((product) => product.id === target.productId)) {
      dispatch({ type: "SELECT_PRODUCT", productId: target.productId });
    }
    setRouteByStore((current) => ({ ...current, [activeStoreId]: nextRoute }));
    const nextExecutionScope = nextRoute === "execution" ? {
      storeId: activeStoreId,
      productId: target?.productId || selectedProduct?.id || null,
      missionId: target?.kind === "mission" ? target.id : null,
    } : null;
    executionScopeRef.current = nextExecutionScope;
    setExecutionScope(nextExecutionScope);
    setFocusTarget(target ? { ...target, storeId: activeStoreId, nonce: Date.now() } : null);
    setInspector(null);
  };

  const requestModeChange = (mode) => {
    if (mode === "auto" && (activeStore?.mode !== "auto" || autoModeArmedStoreId !== activeStoreId)) {
      const preferredMission = scopedMission || autoMissionCandidates[0] || null;
      if (!preferredMission) {
        notify("当前产品没有可运行的 active Mission，请先在任务中心创建或恢复 Mission", "danger");
        navigate("missions");
        return;
      }
      setAutoModeMissionId(preferredMission.id);
      setAutoModeConfirm(true);
      return;
    }
    const validation = dispatch({ type: "SET_MODE", storeId: activeStoreId, mode, actor: "human" });
    if (mode === "approval" && validation?.ok !== false) setAutoModeArmedStoreId(null);
    notify(validation?.ok === false ? validation.message : mode === "auto" ? "策略内自动已开启" : "已切换为人工审批", validation?.ok === false ? "danger" : "info");
  };

  const updateExecutionScope = useCallback((nextScope) => {
    const currentScope = executionScopeRef.current;
    if (currentScope?.storeId === nextScope?.storeId && currentScope?.productId === nextScope?.productId && currentScope?.missionId === nextScope?.missionId) return;
    const scopeChanged = currentScope?.storeId === nextScope?.storeId
      && (currentScope?.productId !== nextScope?.productId || currentScope?.missionId !== nextScope?.missionId);
    if (scopeChanged && activeStore?.mode === "auto" && autoModeArmedStoreId === activeStoreId) {
      dispatch({ type: "SET_MODE", storeId: activeStoreId, mode: "approval", actor: "human" });
      setAutoModeArmedStoreId(null);
      notify("执行范围已变化，系统已切回人工审批；请重新确认策略内自动范围", "info");
    }
    executionScopeRef.current = nextScope;
    setExecutionScope(nextScope);
  }, [activeStore?.mode, activeStoreId, autoModeArmedStoreId, dispatch]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setNotificationsOpen(false);
        setHelpOpen(false);
        setInspector(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const canvas = document.getElementById("main-content");
    if (canvas) canvas.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [route, activeStoreId]);

  useEffect(() => {
    if (!activeStore || activeStore.mode !== "auto" || route !== "execution" || autoModeArmedStoreId !== activeStoreId) {
      autoRunAttemptsRef.current.clear();
      autoRunPendingRef.current = null;
      return undefined;
    }
    if (autoRunPendingRef.current) return undefined;
    if (executionScope?.storeId !== activeStoreId || !executionScope.productId || !executionScope.missionId) return undefined;
    const queue = (activeStore.executionQueue || []).filter((candidate) => candidate.productId === executionScope.productId && candidate.missionId === executionScope.missionId);
    const attemptDescriptor = (candidate) => {
      const verb = candidate.status === "applied" ? "VERIFY_EXECUTION_ITEM" : "APPLY_EXECUTION_ITEM";
      const mission = (activeStore.missions || []).find((record) => record.id === candidate.missionId);
      const adObject = (activeStore.adObjects || []).find((record) => record.id === candidate.adObjectId);
      const product = (activeStore.products || []).find((record) => record.id === (candidate.productId || adObject?.productId));
      const decision = (activeStore.decisions || []).find((record) => record.id === candidate.decisionId);
      const context = [mission?.status, mission?.updatedAt, adObject?.status, adObject?.updatedAt, product?.status, product?.updatedAt, activeStore.session?.status, activeStore.session?.amazonAds?.status, activeStore.session?.amazonAds?.scope, activeStore.session?.lingxing?.freshnessMinutes, decision?.status, decision?.updatedAt, ...(activeStore.policies || []).map((policy) => `${policy.id}:${policy.status}:${policy.updatedAt}`)].join("|");
      return { candidate, verb, attemptKey: `${activeStoreId}:${candidate.id}:${verb}:${candidate.updatedAt || candidate.status}:${context}` };
    };
    const candidates = [
      ...queue.filter((candidate) => candidate.status === "applied" && candidate.autoEligible && candidate.evidence),
      ...queue.filter((candidate) => ["ready", "queued"].includes(candidate.status) && candidate.autoEligible && candidate.executionMode !== "human_only"),
    ].map(attemptDescriptor);
    const nextAttempt = candidates.find((candidate) => !autoRunAttemptsRef.current.has(candidate.attemptKey));
    const item = nextAttempt?.candidate;
    if (!item) return undefined;
    const { verb, attemptKey } = nextAttempt;
    autoRunAttemptsRef.current.add(attemptKey);
    let fired = false;
    const timer = window.setTimeout(() => {
      fired = true;
      autoRunPendingRef.current = { storeId: activeStoreId, id: item.id, title: item.title, verb, attemptKey };
      dispatch({ type: verb, storeId: activeStoreId, executionId: item.id, itemId: item.id, actor: "agent" });
    }, verb === "APPLY_EXECUTION_ITEM" ? 900 : 1200);
    return () => {
      window.clearTimeout(timer);
      if (!fired) autoRunAttemptsRef.current.delete(attemptKey);
    };
  }, [route, activeStoreId, autoModeArmedStoreId, executionScope, activeStore?.mode, activeStore?.executionQueue, activeStore?.missions, activeStore?.adObjects, activeStore?.products, activeStore?.decisions, activeStore?.policies, activeStore?.session, autoRunTick]);

  useEffect(() => {
    const pending = autoRunPendingRef.current;
    if (!pending) return;
    const pendingStore = state.stores[pending.storeId];
    if (!pendingStore) {
      autoRunPendingRef.current = null;
      setAutoRunTick((value) => value + 1);
      return;
    }
    const item = (pendingStore.executionQueue || []).find((candidate) => candidate.id === pending.id);
    const expectedStatus = pending.verb === "APPLY_EXECUTION_ITEM" ? "applied" : "verified";
    if (item?.status === expectedStatus) {
      autoRunPendingRef.current = null;
      notify(pending.verb === "APPLY_EXECUTION_ITEM" ? `Agent 已在可见浏览器中模拟应用：${pending.title}` : `Agent 已 Reload 并完成回读：${pending.title}`, "info");
      setAutoRunTick((value) => value + 1);
      return;
    }
    const latestAudit = (pendingStore.audit || []).find((record) => record.action === pending.verb && record.entityId === pending.id);
    if (latestAudit?.outcome === "blocked") {
      autoRunPendingRef.current = null;
      notify(`Agent 未执行：${latestAudit.summary}`, "danger");
      setAutoRunTick((value) => value + 1);
    }
  }, [state.stores]);

  useEffect(() => {
    if (autoModeArmedStoreId !== activeStoreId || activeStore?.mode !== "auto" || !executionScope?.missionId) return;
    const scoped = (activeStore.missions || []).find((mission) => mission.id === executionScope.missionId);
    if (scoped && ["active", "running"].includes(scoped.status)) return;
    const validation = dispatch({ type: "SET_MODE", storeId: activeStoreId, mode: "approval", actor: "human" });
    setAutoModeArmedStoreId(null);
    autoRunPendingRef.current = null;
    notify(validation?.ok === false ? validation.message : "当前策略内自动范围的 Mission 已暂停或结束，系统已切回人工审批；恢复后需重新确认", validation?.ok === false ? "danger" : "info");
  }, [activeStoreId, activeStore?.mode, activeStore?.missions, autoModeArmedStoreId, executionScope?.missionId, dispatch]);

  const sharedProps = {
    store: activeStore,
    stores: allStores,
    activeStoreId,
    dispatch,
    onNavigate: navigate,
    onSwitchStore: switchStore,
    onOpenSessionCenter: (context = {}) => setSessionCenterRequest(context),
    openInspector: setInspector,
    notify,
    persistenceStatus,
    focusTarget,
    onModeChange: requestModeChange,
    onExecutionScopeChange: updateExecutionScope,
  };

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${inspector ? "inspector-visible" : ""}`}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><Robot size={21} weight="fill" /></span>
          <strong>运营智能体</strong>
          <small>完整原型</small>
        </div>

        <label className="topbar-select store-select">
          <span className="sr-only">选择店铺</span>
          <select value={activeStoreId} onChange={(event) => switchStore(event.target.value)}>
            {switchableStores.map((store) => <option value={store.id} key={store.id}>{store.id} · {store.shortName || store.name}</option>)}
          </select>
          <CaretDown size={14} />
        </label>

        <label className="topbar-select product-select">
          <Target size={17} />
          <span className="sr-only">选择产品范围</span>
          <select
            value={selectedProduct?.id || ""}
            disabled={!activeProducts.length}
            onChange={(event) => {
              if (activeStore?.mode === "auto" && autoModeArmedStoreId === activeStoreId) {
                dispatch({ type: "SET_MODE", storeId: activeStoreId, mode: "approval", actor: "human" });
                setAutoModeArmedStoreId(null);
                notify("产品范围已变化，系统已切回人工审批；请重新确认策略内自动范围", "info");
              }
              executionScopeRef.current = null;
              setExecutionScope(null);
              dispatch({ type: "SELECT_PRODUCT", productId: event.target.value });
              setFocusTarget(null);
              setInspector(null);
            }}
          >
            {!activeProducts.length ? <option value="">暂无在售产品</option> : null}
            {activeProducts.map((product) => (
              <option value={product.id} key={product.id}>{product.sku} / {product.asin}</option>
            ))}
          </select>
          <CaretDown size={14} />
        </label>

        <button className={`session-health ${sessionConnected ? "" : "warning"}`} type="button" onClick={() => setSessionCenterRequest({ source: activeStore?.session?.lingxing?.status !== "connected" ? "lingxing" : "amazon_ads" })}>
          {sessionConnected ? <CheckCircle size={17} weight="fill" /> : <Warning size={17} weight="fill" />}
          <span>{sessionLabel}</span>
        </button>

        <div className="mode-switch" aria-label="执行模式">
          <button aria-pressed={activeStore?.mode === "approval"} className={activeStore?.mode === "approval" ? "active" : ""} type="button" onClick={() => requestModeChange("approval")}>人工审批</button>
          <button aria-pressed={activeStore?.mode === "auto"} className={activeStore?.mode === "auto" ? "active" : ""} type="button" onClick={() => requestModeChange("auto")}><Sparkle size={15} weight="fill" />策略内自动</button>
        </div>

        <button className="global-search" type="button" aria-label="打开全局搜索" onClick={() => setCommandOpen(true)}>
          <MagnifyingGlass size={17} />
          <span>搜索事实、决策、对象</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="topbar-actions">
          <div className="popover-anchor">
            <button className="icon-button" type="button" aria-label={`通知，${notificationCount} 项需处理`} onClick={() => setNotificationsOpen((value) => !value)}>
              <Bell size={19} />
              {notificationCount ? <span className="notification-dot">{notificationCount}</span> : null}
            </button>
            {notificationsOpen ? (
              <div className="small-popover notifications-popover">
                <strong>需要你介入</strong>
                {interventionDecisions.length ? <button type="button" onClick={() => { navigate("decisions"); setNotificationsOpen(false); }}>{interventionDecisions.length} 个决策等待处理</button> : null}
                {failedCollections.length ? <button type="button" onClick={() => { navigate("collection"); setNotificationsOpen(false); }}>{failedCollections.length} 个采集任务等待重试</button> : null}
                {!notificationCount ? <span className="popover-empty">当前没有需要介入的事项</span> : null}
              </div>
            ) : null}
          </div>
          <button className="icon-button" type="button" aria-label="帮助" onClick={() => setHelpOpen(true)}><Question size={19} /></button>
          <button className="avatar-button" type="button" aria-label="查看当前操作者张伟" onClick={() => setInspector({ eyebrow: "当前操作者", title: "张伟", subtitle: "运营主管", fields: [["授权角色", "策略审批人"], ["当前店铺", activeStoreId], ["当前待处理", `${interventionDecisions.length} 项`], ["Agent 模式", activeStore?.mode === "auto" ? "策略内自动" : "人工审批"]] })}>张</button>
        </div>
      </header>

      {persistenceStatus?.status === "error" ? (
        <div className="persistence-alert" role="alert">
          <Warning size={17} weight="fill" />
          <span><strong>本地保存失败</strong>{persistenceStatus.message}</span>
          <button type="button" onClick={() => navigate("settings")}>检查系统设置</button>
        </div>
      ) : null}

      <aside className="sidebar" aria-label="主业务导航">
        <nav>
          {navGroups.map((group) => (
            <section className="nav-group" key={group.group}>
              <h2>{group.group}</h2>
              <div className="nav-list">
                {group.items.map((item) => {
                  const Icon = ICONS[item.iconKey || item.id] || Sparkle;
                  const pendingCount = item.id === "decisions" ? interventionDecisions.length : item.id === "missions" ? (activeStore?.missions || []).filter((mission) => mission.status === "active").length : item.id === "collection" ? failedCollections.length : 0;
                  return (
                    <button type="button" key={item.id} className={route === item.id ? "active" : ""} onClick={() => navigate(item.id)} aria-label={item.label} aria-current={route === item.id ? "page" : undefined}>
                      <Icon size={19} weight={route === item.id ? "fill" : "regular"} />
                      <span>{item.label}</span>
                      {pendingCount ? <b aria-hidden="true">{pendingCount}</b> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="collapse-button" aria-label={sidebarCollapsed ? "展开主导航" : "收起主导航"} onClick={() => setSidebarCollapsed((value) => !value)}>
            <SidebarSimple size={18} />
            <span>{sidebarCollapsed ? "展开" : "收起"}</span>
          </button>
          <button type="button" className="store-card" aria-label={`打开 ${activeStoreId} 的店铺与广告对象`} onClick={() => navigate("objects")}>
            <Storefront size={18} />
            <span><strong>{activeStoreId} · {activeStore?.name || "店铺"}</strong><small>{activeStore?.marketplace || "美国站"} · 本地库隔离</small></span>
          </button>
        </div>
      </aside>

      <main className="main-canvas" id="main-content">
        <Workspace {...sharedProps} />
      </main>

      <Inspector item={inspector} onClose={() => setInspector(null)} />
      <Toasts items={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
      <CommandPalette open={commandOpen} navGroups={navGroups} store={activeStore} onClose={() => setCommandOpen(false)} onNavigate={navigate} />
      <SessionCenter open={Boolean(sessionCenterRequest)} requestedSource={sessionCenterRequest?.source} store={activeStore} dispatch={dispatch} onClose={() => setSessionCenterRequest(null)} notify={notify} onSessionInvalidated={() => { setAutoModeArmedStoreId(null); setAutoModeMissionId(null); executionScopeRef.current = null; setExecutionScope(null); }} />

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="这不是传统数据后台" description="原型说明" className="help-dialog">
        <p>主链路是 Mission → Crux 决策 → 经营实验 → 领星可见执行 → Reload 回读 → 因果记忆。CRUD 负责维护业务对象，但不会抢占主任务。</p>
        <div className="help-flow">
          <span>任务</span><span>决策</span><span>执行</span><span>回读</span><span>记忆</span>
        </div>
        <div className="dialog-actions">
          <button className="button danger" type="button" onClick={() => { setHelpOpen(false); setResetConfirm(true); }}>重置全部演示数据</button>
          <button className="button primary" type="button" onClick={() => setHelpOpen(false)}>开始查看</button>
        </div>
      </Modal>
      <ConfirmDialog open={resetConfirm} onClose={() => setResetConfirm(false)} onConfirm={() => { const validation = resetDemo(); setResetConfirm(false); notify(validation?.ok === false ? validation.message : "所有可配置店铺的演示修改已清除，并恢复三个初始店铺", validation?.ok === false ? "danger" : "info"); }} title="重置全部店铺的演示数据？" description="这会清除所有本地 CRUD 修改（包括新建店铺）、审批、实验和执行记录，并恢复三个初始演示店铺。此操作不可撤销。" confirmLabel="确认重置全部数据"><p className="confirm-object-name">当前共 {allStores.length} 个店铺数据域</p></ConfirmDialog>
      <ConfirmDialog open={autoModeConfirm} onClose={() => { setAutoModeConfirm(false); setAutoModeMissionId(null); }} onConfirm={() => { if (!confirmationMission) { notify("请选择一个可运行的 Mission", "danger"); return; } const validation = dispatch({ type: "SET_MODE", storeId: activeStoreId, mode: "auto", actor: "human" }); notify(validation?.ok === false ? validation.message : `已为 ${activeStoreId} / ${confirmationMission.title} 开启策略内自动`, validation?.ok === false ? "danger" : "info"); if (validation?.ok !== false) { setAutoModeArmedStoreId(activeStoreId); setAutoModeConfirm(false); navigate("execution", { kind: "mission", id: confirmationMission.id, productId: confirmationMission.productId || null }); } }} title={`为 ${activeStoreId} 开启策略内自动？`} description={`执行范围锁定为当前店铺、产品和明确选定的 Mission；目前有 ${autoEligibleCount} 个通过当前策略预检的动作可能开始。确认后系统会进入“实时执行”，只有该可见监控页保持打开时 Agent 才会推进。每个动作仍需通过会话、数据新鲜度、对象层级、策略硬上限和 Reload 回读门；任何越界或未知结果都会停止并转人工。当前原型只模拟 Ads 写入，不连接真实 Amazon Ads。`} confirmLabel="确认并进入可见执行" confirmDisabled={!confirmationMission}>
        <label className="auto-mission-picker"><span>本次策略内自动范围</span><select value={confirmationMission?.id || ""} onChange={(event) => setAutoModeMissionId(event.target.value)}>{autoMissionCandidates.map((mission) => <option key={mission.id} value={mission.id}>{mission.title}</option>)}</select><small>{selectedProduct ? `${selectedProduct.sku} / ${selectedProduct.asin}` : "未选择产品"} · {autoEligibleCount} 个策略内动作</small></label>
        <p className="confirm-object-name">停止方式：切回“人工审批”、离开实时执行页，切换店铺/产品/Mission，或暂停 Mission</p>
      </ConfirmDialog>
    </div>
  );
}
