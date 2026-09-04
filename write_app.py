content = r"""
/*
 * Amazon AI Ops - Autonomy Prototype (minimal rebuild)
 */
import os

src = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'

# Read the current file from the Write tool call I just did - but that's broken in the chat. Let me use inline.

# I'll create the file by writing chunk by chunk using only ASCII comments.
# This avoids any encoding issues.

chunks = []

# CHUNK 1: imports and constants
chunks.append('''/*
 * Amazon AI Ops - Autonomy Prototype (minimal rebuild)
 * All user-facing strings are plain English to avoid encoding issues.
 */
import React, { useState, useCallback, useMemo, useRef, useEffect, createContext, useContext } from "react";
import {
  Database, Brain, ShieldCheck, Play, ChartLineUp, Flask, Eye,
  CloudArrowUp, CheckCircle, X, CircleNotch, Lightning, Robot,
  UserCircle, Cube, Package, Lightbulb, Gear, Compass, FileText,
  ListChecks, ChartBar, Stack, ClipboardText, Pulse, Target,
  MagnifyingGlass, Tag, TrendUp, DownloadSimple, UploadSimple,
  WarningOctagon, CheckFat, Clock, CloudCheck, RocketLaunch,
  CalendarBlank, ArrowRight, Sparkle, CaretRight, DotsThree,
  SidebarSimple, ChartLine, Bell, Tray, Warning, List,
  Storefront, Wrench, Graph, ArrowUp, ArrowDown, Check,
  HandWaving, HandPalm, Shield, Prohibit, ListBullets, ArrowsClockwise,
  Question, ClockClockwise, PencilSimpleLine, CheckSquare,
} from "@phosphor-icons/react";

import {
  createInitialAppState, selectStore, updateStoreState,
  transitionRecommendation, recordReadback, setExecutionMode,
  selectProduct, appendOperationEvent, getSubviewData,
  buildTimeline, buildLedger, getRecommendationCounts,
  getExecutionCounts, getReadbackCounts, getWorkspaceBadgeCounts,
  getDecisionViews, getReportCoverage, formatMoney, formatPercent,
} from "./model.js";

const AI_MODES = [
  { id: "manual", label: "Manual Review", short: "Manual", icon: UserCircle, color: "#64748b" },
  { id: "semi", label: "Semi-Auto", short: "Semi", icon: Lightning, color: "#c8790a" },
  { id: "auto", label: "Policy-Bounded Auto", short: "Auto", icon: Robot, color: "#14965e" },
];

const AppContext = createContext(null);
export function useAppStore() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppStore must be inside Provider");
  return ctx;
}

const WORKSPACES = [
  { id: "today", label: "Today", icon: Compass, section: "daily",
    subviews: [{ id: "overview", label: "Overview" }],
    description: "Mission status and outstanding work" },
  { id: "product", label: "Products", icon: Cube, section: "daily",
    subviews: [{ id: "products", label: "Products" }, { id: "targets", label: "Targets" }, { id: "events", label: "Events" }],
    description: "Manage products and target metrics" },
  { id: "data-prep", label: "Data Prep", icon: Database, section: "daily",
    subviews: [{ id: "scope", label: "Scope" }, { id: "reports", label: "Reports" }, { id: "import-check", label: "Import Check" }],
    description: "Collect and validate raw reports" },
  { id: "diagnosis", label: "Diagnosis", icon: Brain, section: "daily",
    subviews: [{ id: "analysis", label: "Analysis" }],
    description: "Quantify and diagnose ad objects" },
  { id: "decisions", label: "Decisions", icon: ShieldCheck, section: "daily",
    subviews: [{ id: "recommendations", label: "Recommendations" }, { id: "approval", label: "Approval" }, { id: "decided", label: "Decided" }],
    description: "AI suggestions and human approvals" },
  { id: "readback", label: "Readback", icon: Play, section: "daily",
    subviews: [{ id: "evidence", label: "Evidence" }],
    description: "Execute approved actions and verify" },
  { id: "growth", label: "Growth", icon: TrendUp, section: "daily",
    subviews: [{ id: "keywords", label: "Keywords" }, { id: "listing", label: "Listing" }],
    description: "Keyword opportunities and listing drafts" },
  { id: "stores", label: "Stores", icon: Storefront, section: "system",
    subviews: [{ id: "list", label: "List" }],
    description: "Manage store configuration" },
  { id: "system", label: "System", icon: Gear, section: "system",
    subviews: [{ id: "settings", label: "Settings" }, { id: "scheduler", label: "Scheduler" }, { id: "delivery", label: "Delivery" }],
    description: "Configuration, scheduling, and final delivery" },
];
''')

# CHUNK 2: MISSION_PHASES, advanceMission, buildInitialMission, formatTime
chunks.append('''
const MISSION_PHASES = [
  { id: "collect", label: "Collect", icon: CloudArrowUp, parallel: false, humanCheckpoint: false, desc: "Pull reports from Lingxing" },
  { id: "import", label: "Import", icon: Database, parallel: false, humanCheckpoint: false, desc: "Validate and store raw rows" },
  { id: "diagnose", label: "Diagnose", icon: Brain, parallel: false, humanCheckpoint: false, desc: "Quantify ad objects" },
  { id: "recommend", label: "Recommend", icon: Sparkle, parallel: false, humanCheckpoint: false, desc: "Generate optimization suggestions" },
  { id: "approve", label: "Approve", icon: ShieldCheck, parallel: false, humanCheckpoint: true, desc: "Operator reviews and approves" },
  { id: "execute", label: "Execute", icon: Play, parallel: false, humanCheckpoint: false, desc: "Apply approved changes" },
  { id: "readback", label: "Readback", icon: Eye, parallel: false, humanCheckpoint: true, desc: "Capture screenshots and verify" },
  { id: "audit", label: "Audit", icon: FileText, parallel: true, humanCheckpoint: false, desc: "Append ledger entries" },
  { id: "deliver", label: "Deliver", icon: RocketLaunch, parallel: false, humanCheckpoint: false, desc: "Export final evidence" },
  { id: "archive", label: "Archive", icon: Package, parallel: true, humanCheckpoint: false, desc: "Cleanup transient artifacts" },
  { id: "notify", label: "Notify", icon: Bell, parallel: true, humanCheckpoint: false, desc: "Send summary to operator" },
  { id: "wait", label: "Wait Next Cycle", icon: ClockClockwise, parallel: false, humanCheckpoint: false, desc: "Idle until next scheduled run" },
];

function fmtTime(d) {
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function buildInitialMission() {
  const phases = {};
  MISSION_PHASES.forEach(p => {
    phases[p.id] = { status: p.id === "collect" ? "active" : "pending" };
  });
  return { currentPhaseId: "collect", phases };
}

function advanceMission(prev, phaseId, result) {
  const phases = Object.assign({}, prev.phases);
  const wasActive = phases[phaseId] && phases[phaseId].status === "active";
  phases[phaseId] = {
    status: "done",
    startedAt: (phases[phaseId] && phases[phaseId].startedAt) || fmtTime(new Date(Date.now() - 2000)),
    endedAt: fmtTime(new Date()),
    durationMs: wasActive ? 1800 + Math.floor(Math.random() * 400) : null,
    result: result || {},
  };
  const order = MISSION_PHASES.map(p => p.id);
  const idx = order.indexOf(phaseId);
  let nextId = phaseId;
  for (let i = idx + 1; i < order.length; i++) {
    const pid = order[i];
    if (!(phases[pid] && phases[pid].status === "done")) { nextId = pid; break; }
  }
  if (nextId !== phaseId) {
    const phaseDef = MISSION_PHASES.find(p => p.id === nextId);
    phases[nextId] = {
      status: phaseDef && phaseDef.humanCheckpoint ? "waiting" : "active",
      startedAt: fmtTime(new Date()),
    };
  }
  return { currentPhaseId: nextId, phases };
}
''')

# CHUNK 3: UI primitives
chunks.append('''
function Spill({ tone, children }) {
  return <span className={"sp sp-" + (tone || "n")}>{children}</span>;
}

function Btn({ small, primary, ghost, danger, onClick, children, type, title, disabled }) {
  let cls = "btn";
  if (small) cls += " sm";
  if (primary) cls += " p";
  else if (ghost) cls += " g";
  else if (danger) cls += " d";
  return (
    <button className={cls} onClick={onClick} type={type || "button"} title={title} disabled={disabled}>
      {children}
    </button>
  );
}

function BtnRow({ children }) { return <div className="btn-r">{children}</div>; }

function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="pg-hd">
      <div className="pg-hd-l">
        <h1 className="pg-t">{title}</h1>
        {subtitle && <span className="pg-st">{subtitle}</span>}
      </div>
      {actions && <div className="pg-hd-r">{actions}</div>}
    </div>
  );
}

function Block({ title, children, actions }) {
  return (
    <div className="blk">
      {title && (
        <div className="blk-hd">
          <span className="blk-t">{title}</span>
          {actions && <div className="blk-actions">{actions}</div>}
        </div>
      )}
      <div className="blk-body">{children}</div>
    </div>
  );
}

function KpiGrid({ children }) { return <div className="kpi-g">{children}</div>; }

function KpiCard({ label, value, delta, good }) {
  let tone = "";
  if (good === true) tone = " g";
  else if (good === false) tone = " w";
  return (
    <div className={"kpi-c" + tone}>
      <span className="kpi-l">{label}</span>
      <span className="kpi-v">{value}</span>
      {delta && <span className={"kpi-d" + tone}>{delta}</span>}
    </div>
  );
}

function DataTable({ columns, rows, onRowClick }) {
  return (
    <div className="dtbl-scroll">
      <table className="dtbl-t">
        <thead>
          <tr>{columns.map((c, i) => <th key={i} style={{ width: c.width }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={onRowClick ? "cp" : ""} onClick={() => onRowClick && onRowClick(row)}>
              {columns.map((c, ci) => <td key={ci}>{c.render ? c.render(row[c.key], row) : row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Filters({ active, onChange, options }) {
  return (
    <div className="filt-r">
      {options.map(o => (
        <button key={o.value}
          className={"filt-b " + (active === o.value ? "a" : "") + (o.warn ? " warn" : "")}
          onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}
''')

# CHUNK 4: App and PageRouter
chunks.append('''
export default function App() {
  const [appState, setAppState] = useState(function () { return createInitialAppState("SHC001"); });
  const [mission, setMission] = useState(buildInitialMission);
  const [toasts, setToasts] = useState([]);
  const [showPanel, setShowPanel] = useState(true);
  const [detail, setDetail] = useState(null);
  const [activeWorkspace, setActiveWorkspace] = useState("today");
  const [activeSubview, setActiveSubview] = useState("overview");
  const toastIdRef = useRef(0);

  const activeStoreId = appState.activeStoreId || "SHC001";
  const store = appState.stores[activeStoreId];

  useEffect(function () {
    const apply = function () {
      const raw = window.location.hash.replace("#", "");
      if (!raw) return;
      const parts = raw.split("/");
      const ws = parts[0];
      const sv = parts[1];
      const wsObj = WORKSPACES.find(function (w) { return w.id === ws; });
      if (wsObj) {
        setActiveWorkspace(ws);
        setActiveSubview(sv || wsObj.subviews[0].id);
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return function () { window.removeEventListener("hashchange", apply); };
  }, []);

  useEffect(function () {
    const target = "#" + activeWorkspace + "/" + activeSubview;
    if (window.location.hash !== target) {
      window.history.replaceState(null, "", target);
    }
  }, [activeWorkspace, activeSubview]);

  const pushToast = useCallback(function (message, opts) {
    const id = ++toastIdRef.current;
    opts = opts || {};
    setToasts(function (prev) { return prev.concat([{ id: id, message: message, tone: opts.tone || "info" }]); });
    setTimeout(function () {
      setToasts(function (prev) { return prev.filter(function (t) { return t.id !== id; }); });
    }, opts.ttl || 3500);
    return id;
  }, []);

  const navigate = useCallback(function (ws, sv) {
    const wsObj = WORKSPACES.find(function (w) { return w.id === ws; });
    if (!wsObj) return;
    setActiveWorkspace(ws);
    setActiveSubview(sv || wsObj.subviews[0].id);
  }, []);

  const advancePhase = useCallback(function (phaseId, result) {
    setMission(function (prev) { return advanceMission(prev, phaseId, result); });
  }, []);

  const simulateProgress = useCallback(function () {
    setMission(function (prev) {
      const current = prev.phases[prev.currentPhaseId];
      if (!current || current.status !== "active") return prev;
      const phase = MISSION_PHASES.find(function (p) { return p.id === prev.currentPhaseId; });
      if (!phase || phase.humanCheckpoint) return prev;
      return advanceMission(prev, prev.currentPhaseId, { simulatedAt: Date.now() });
    });
  }, []);

  const ctx = useMemo(function () {
    return {
      appState: appState, setAppState: setAppState,
      activeStoreId: activeStoreId, store: store,
      workspace: activeWorkspace, subview: activeSubview,
      mission: mission, navigate: navigate,
      advancePhase: advancePhase, simulateProgress: simulateProgress,
      pushToast: pushToast, openDetail: setDetail,
      aiMode: (store && store.mode) || "semi",
    };
  }, [appState, activeStoreId, store, activeWorkspace, activeSubview, mission, navigate, advancePhase, simulateProgress, pushToast]);

  const pageKey = activeWorkspace + ":" + activeSubview;

  return (
    <AppContext.Provider value={ctx}>
      <div className={"app " + (showPanel ? "panel-open" : "")}>
        <MissionTimeline mission={mission} onAdvance={advancePhase} onSimulate={simulateProgress} />
        <div className="app-body">
          <Sidebar activeWorkspace={activeWorkspace} activeSubview={activeSubview}
            navigate={navigate} showPanel={showPanel} setShowPanel={setShowPanel}
            store={store} />
          <main className="main">
            <Topbar activeWorkspace={activeWorkspace} activeSubview={activeSubview} />
            <div className="content">
              <PageRouter pageKey={pageKey} ctx={ctx} />
            </div>
          </main>
          <ContextPanel ctx={ctx} />
        </div>
        {detail && <DetailDrawer detail={detail} onClose={function () { setDetail(null); }} ctx={ctx} />}
        <ToastStack toasts={toasts} />
      </div>
    </AppContext.Provider>
  );
}

function Sidebar({ activeWorkspace, activeSubview, navigate, showPanel, setShowPanel, store }) {
  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {WORKSPACES.filter(function (w) { return w.section === "daily"; }).map(function (ws) {
          return (
            <div key={ws.id} className="nav-ws">
              <button className={"nav-ws-hd " + (activeWorkspace === ws.id ? "a" : "")}
                onClick={function () { navigate(ws.id); }} type="button">
                <ws.icon size={16} weight={activeWorkspace === ws.id ? "fill" : "regular"} />
                <span className="nav-ws-lbl">{ws.label}</span>
                <CaretRight size={11} className={"nav-ws-arr " + (activeWorkspace === ws.id ? "open" : "")} />
              </button>
              {ws.subviews.length > 1 && (
                <div className={"nav-sv-list " + (activeWorkspace === ws.id ? "open" : "")}>
                  {ws.subviews.map(function (sv) { return (
                    <button key={sv.id}
                      className={"nav-sv-btn " + (activeWorkspace === ws.id && activeSubview === sv.id ? "a" : "")}
                      onClick={function () { navigate(ws.id, sv.id); }} type="button">
                      <span className="nav-sv-dot" />
                      <span className="nav-sv-lbl">{sv.label}</span>
                    </button>
                  ); })}
                </div>
              )}
            </div>
          );
        })}
        <div className="nav-divider" />
        {WORKSPACES.filter(function (w) { return w.section === "system"; }).map(function (ws) {
          return (
            <div key={ws.id} className="nav-ws">
              <button className={"nav-ws-hd " + (activeWorkspace === ws.id ? "a" : "")}
                onClick={function () { navigate(ws.id); }} type="button">
                <ws.icon size={16} weight={activeWorkspace === ws.id ? "fill" : "regular"} />
                <span className="nav-ws-lbl">{ws.label}</span>
                <CaretRight size={11} className={"nav-ws-arr " + (activeWorkspace === ws.id ? "open" : "")}
                  style={ws.subviews.length <= 1 ? { visibility: "hidden" } : {}} />
              </button>
              {ws.subviews.length > 1 && (
                <div className={"nav-sv-list " + (activeWorkspace === ws.id ? "open" : "")}>
                  {ws.subviews.map(function (sv) { return (
                    <button key={sv.id}
                      className={"nav-sv-btn " + (activeWorkspace === ws.id && activeSubview === sv.id ? "a" : "")}
                      onClick={function () { navigate(ws.id, sv.id); }} type="button">
                      <span className="nav-sv-dot" />
                      <span className="nav-sv-lbl">{sv.label}</span>
                    </button>
                  ); })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <button className="store-indicator" onClick={function () { navigate("stores", "list"); }} type="button">
          <Storefront size={14} weight="fill" />
          <div className="store-indicator-info">
            <span className="store-indicator-name">{(store && store.name) || "Store"}</span>
            <span className="store-indicator-meta">{(store && store.marketplaceCode) || "-"} . {(store && store.marketplace) || "-"}</span>
          </div>
          <CaretRight size={11} className="store-indicator-arr" />
        </button>
        <button className={"nav-btn panel-toggle " + (showPanel ? "a" : "")}
          onClick={function () { setShowPanel(function (p) { return !p; }); }} type="button">
          <Stack size={16} weight={showPanel ? "fill" : "regular"} />
        </button>
      </div>
    </aside>
  );
}

function Topbar({ activeWorkspace, activeSubview }) {
  const ws = WORKSPACES.find(function (w) { return w.id === activeWorkspace; });
  const sv = ws && ws.subviews.find(function (s) { return s.id === activeSubview; });
  return (
    <div className="topbar">
      <div className="topbar-breadcrumb">
        <span className="topbar-ws">{(ws && ws.label) || ""}</span>
        <CaretRight size={11} />
        <span className="topbar-sv">{(sv && sv.label) || ""}</span>
      </div>
      <div className="topbar-r">
        <span className="topbar-hint">{(ws && ws.description) || ""}</span>
      </div>
    </div>
  );
}

function PageRouter({ pageKey, ctx }) {
  const PAGE_MAP = {
    "today:overview": TodayPage,
    "product:products": ProductsPage,
    "product:targets": TargetsPage,
    "product:events": EventsPage,
    "data-prep:scope": ScopePage,
    "data-prep:reports": ReportsPage,
    "data-prep:import-check": ImportCheckPage,
    "diagnosis:analysis": DiagnosisPage,
    "decisions:recommendations": RecommendationsPage,
    "decisions:approval": ApprovalPage,
    "decisions:decided": DecidedPage,
    "readback:evidence": ReadbackPage,
    "growth:keywords": KeywordsPage,
    "growth:listing": ListingPage,
    "stores:list": StoresPage,
    "system:settings": SettingsPage,
    "system:scheduler": SchedulerPage,
    "system:delivery": DeliveryPage,
  };
  const Component = PAGE_MAP[pageKey] || NotFoundPage;
  return <Component ctx={ctx} />;
}

function NotFoundPage() {
  return (
    <div className="pg">
      <PageHeader title="Not Found" subtitle="This view is not implemented yet" />
    </div>
  );
}
''')

# CHUNK 5: MissionTimeline + TodayPage
chunks.append('''
function MissionTimeline({ mission, onAdvance, onSimulate }) {
  const [expanded, setExpanded] = useState(false);
  const currentPhase = MISSION_PHASES.find(function (p) { return p.id === mission.currentPhaseId; });
  const doneCount = Object.values(mission.phases).filter(function (p) { return p.status === "done"; }).length;
  const total = MISSION_PHASES.length;
  return (
    <div className={"mbar " + (expanded ? "ex" : "")}>
      <div className="mbar-l">
        <RocketLaunch size={14} weight="fill" className="mbar-icon" />
        <span className="mbar-title">Mission</span>
        <div className="mbar-steps">
          {MISSION_PHASES.slice(0, 8).map(function (p) {
            const data = mission.phases[p.id];
            const status = (data && data.status) || "pending";
            const Icon = p.icon;
            return (
              <div key={p.id} className={"mbar-step " + status}>
                <span className="mbar-dot">
                  {status === "done" ? <Check size={9} weight="bold" />
                    : status === "active" ? <CircleNotch size={9} className="spin" />
                    : <Icon size={9} />}
                </span>
                <span className="mbar-lbl">{p.label}</span>
              </div>
            );
          })}
        </div>
        <span className="mbar-prog">{doneCount}/{total}</span>
      </div>
      <div className="mbar-r">
        {currentPhase && (
          <span className="mbar-cur">
            <span className="mbar-cur-lbl">Now</span>
            <span className="mbar-cur-val">{currentPhase.label}</span>
            {currentPhase.humanCheckpoint && <HandWaving size={11} weight="fill" />}
          </span>
        )}
        <button className="mbar-sim" onClick={onSimulate} title="Simulate one step">
          <CircleNotch size={11} />
        </button>
        <button className="mbar-toggle" onClick={function () { setExpanded(function (e) { return !e; }); }} title="Expand details">
          <CaretRight size={11} className={expanded ? "open" : ""} />
        </button>
      </div>
      {expanded && (
        <div className="mbar-ex">
          {MISSION_PHASES.map(function (p) {
            const data = mission.phases[p.id];
            const status = (data && data.status) || "pending";
            const Icon = p.icon;
            return (
              <div key={p.id} className={"mbe-phase " + status}>
                <div className="mbe-dot">{status === "done" ? <Check size={9} weight="bold" /> : <Icon size={9} />}</div>
                <div className="mbe-info">
                  <div className="mbe-hd">
                    <span className="mbe-name">{p.label}</span>
                    <span className={"mbe-status " + status}>{status === "done" ? "Done" : status === "active" ? "Active" : status === "waiting" ? "Waiting" : "Pending"}</span>
                  </div>
                  <span className="mbe-desc">{p.desc}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TodayPage({ ctx }) {
  const store = ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Today" }));
  const m = store.metrics || {};
  const recCounts = getRecommendationCounts(store);
  const execCounts = getExecutionCounts(store);
  const readbackCounts = getReadbackCounts(store);
  const timeline = buildTimeline(store);
  const acosGood = m.acos != null && m.targetAcos != null && m.acos <= m.targetAcos;
  const tacosGood = m.tacos != null && m.targetTacos != null && m.tacos <= m.targetTacos;
  const kpis = [
    { label: "ACOS", value: formatPercent(m.acos), delta: m.salesDelta != null ? formatPercent(m.salesDelta, { signed: true }) : null, good: acosGood },
    { label: "TACOS", value: formatPercent(m.tacos), delta: null, good: tacosGood },
    { label: "Ad Spend", value: formatMoney(m.adSpend, store), delta: null, good: null },
    { label: "Orders", value: m.orders != null ? String(m.orders) : "-", delta: null, good: null },
  ];
  const tasks = [];
  if (recCounts.pendingApproval > 0) tasks.push({ icon: WarningOctagon, tone: "warn", text: recCounts.pendingApproval + " recommendations pending approval", ws: "decisions", sv: "approval" });
  if (recCounts.pendingReview > 0) tasks.push({ icon: Eye, tone: "warn", text: recCounts.pendingReview + " recommendations need review", ws: "decisions", sv: "recommendations" });
  if (execCounts.pending > 0) tasks.push({ icon: RocketLaunch, tone: "info", text: execCounts.pending + " execution actions queued", ws: "readback", sv: "evidence" });
  if (readbackCounts.waiting > 0) tasks.push({ icon: Clock, tone: "warn", text: readbackCounts.waiting + " readbacks waiting for reload", ws: "readback", sv: "evidence" });
  return (
    <div className="pg">
      <PageHeader title="Today" subtitle={store.name + " . " + (store.scope && store.scope.dateTo || "-")} />
      <KpiGrid>{kpis.map(function (k) { return <KpiCard key={k.label} {...k} />; })}</KpiGrid>
      {tasks.length > 0 && (
        <Block title={"Outstanding Work (" + tasks.length + ")"}>
          {tasks.map(function (t, i) {
            const Icon = t.icon;
            return (
              <div key={i} className={"todo-i tone-" + t.tone + " lnk"} onClick={function () { ctx.navigate(t.ws, t.sv); }}>
                <Icon size={14} />
                <span>{t.text}</span>
                <CaretRight size={12} className="todo-arr" />
              </div>
            );
          })}
        </Block>
      )}
      {timeline && timeline.length > 0 && (
        <Block title="Today Timeline">
          {timeline.map(function (entry) {
            const tone = entry.state === "done" ? "s" : entry.state === "warning" ? "w" : "n";
            return (
              <div key={entry.id} className={"tl-i " + tone}>
                <span className="tl-t">{entry.time}</span>
                <span className="tl-n">{entry.title}</span>
                <span className="tl-m">{entry.meta}</span>
              </div>
            );
          })}
        </Block>
      )}
    </div>
  );
}
''')

# CHUNK 6: Product/Data pages
chunks.append('''
function ProductsPage({ ctx }) {
  const store = ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Products" }));
  const products = store.products || [];
  const cols = [
    { key: "asin", label: "ASIN", width: "auto" },
    { key: "name", label: "Name", width: "auto" },
    { key: "price", label: "Price", width: "70px" },
    { key: "acos", label: "ACOS", width: "70px" },
    { key: "spend", label: "Spend", width: "70px" },
    { key: "stage", label: "Stage", width: "auto" },
    { key: "health", label: "Health", width: "auto" },
  ];
  const rows = products.map(function (p) {
    return Object.assign({}, p, {
      price: formatMoney(p.price, store),
      acos: p.acos != null ? formatPercent(p.acos) : "-",
      spend: p.spend != null ? formatMoney(p.spend, store) : "-",
      stage: React.createElement(Spill, { tone: "n" }, p.stage),
      health: React.createElement(Spill, { tone: p.health === "normal" ? "s" : p.health === "review" ? "w" : "d" }, p.health || "-"),
    });
  });
  return (
    <div className="pg">
      <PageHeader title="Products" subtitle={products.length + " products in current scope"} />
      <Block><DataTable columns={cols} rows={rows} /></Block>
    </div>
  );
}

function TargetsPage({ ctx }) {
  const store = ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Targets" }));
  const products = store.products || [];
  const targetAcos = (store.metrics && store.metrics.targetAcos) || 0.3;
  return (
    <div className="pg">
      <PageHeader title="Targets" subtitle="Per-product target metrics" />
      <Block>
        {products.map(function (p) {
          const overTarget = p.acos > (p.targetAcos || targetAcos);
          return (
            <div key={p.id} className="target-row">
              <span className="tr-asin">{p.asin}</span>
              <span className="tr-name">{p.name}</span>
              <span className="tr-target">Target ACOS {formatPercent(p.targetAcos || targetAcos, { signed: false })}</span>
              <Spill tone={overTarget ? "w" : "s"}>Current {formatPercent(p.acos)}</Spill>
            </div>
          );
        })}
      </Block>
    </div>
  );
}

function EventsPage({ ctx }) {
  const store = ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Events" }));
  const events = store.operationEvents || [];
  return (
    <div className="pg">
      <PageHeader title="Operation Events" subtitle={events.length + " annotated events"} />
      <Block>
        {events.length === 0 && <div className="empty">No events yet</div>}
        {events.map(function (e, i) {
          return (
            <div key={i} className="event-row">
              <span className="ev-time">{e.at}</span>
              <span className="ev-title">{e.title}</span>
              <Spill tone="n">{e.scope || "store"}</Spill>
            </div>
          );
        })}
      </Block>
    </div>
  );
}

function ScopePage({ ctx }) {
  const store = ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Scope" }));
  const s = store.scope || {};
  return (
    <div className="pg">
      <PageHeader title="Operation Scope" subtitle={"Store " + store.id + " . " + store.marketplaceCode} />
      <Block>
        <div className="scope-grid">
          <div className="scope-field"><span className="sf-l">Date From</span><span className="sf-v">{s.dateFrom || "-"}</span></div>
          <div className="scope-field"><span className="sf-l">Date To</span><span className="sf-v">{s.dateTo || "-"}</span></div>
          <div className="scope-field"><span className="sf-l">Marketplace</span><span className="sf-v">{store.marketplace}</span></div>
          <div className="scope-field"><span className="sf-l">ASIN Count</span><span className="sf-v">{(store.products && store.products.length) || 0}</span></div>
          <div className="scope-field"><span className="sf-l">Source Files</span><span className="sf-v">{(store.importRun && store.importRun.sourceFiles) || 0}</span></div>
          <div className="scope-field"><span className="sf-l">Import Status</span><span className="sf-v">{(store.importRun && store.importRun.reconciliation) || "-"}</span></div>
        </div>
      </Block>
    </div>
  );
}

function ReportsPage({ ctx }) {
  const store = ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Reports" }));
  const coverage = getReportCoverage(store);
  const cols = [
    { key: "label", label: "Report Type", width: "auto" },
    { key: "grain", label: "Grain", width: "80px" },
    { key: "importedRows", label: "Rows", width: "80px" },
    { key: "checksum", label: "SHA-256", width: "160px" },
    { key: "status", label: "Status", width: "80px" },
  ];
  const rows = (store.reports || []).map(function (r) {
    return Object.assign({}, r, {
      importedRows: r.importedRows != null ? String(r.importedRows) : "-",
      checksum: r.checksum ? React.createElement("code", { style: { fontSize: "11px" } }, r.checksum.slice(0, 24) + "...") : "-",
      status: React.createElement(Spill, { tone: r.status === "imported" ? "s" : r.status === "missing" ? "d" : "n" }, r.status),
    });
  });
  return (
    <div className="pg">
      <PageHeader title="Report Collection" subtitle={coverage.available + "/" + coverage.expected + " types . " + coverage.importLabel} />
      <Block>
        <div className="coverage-bar">
          <div className="cb-fill" style={{ width: ((coverage.available / coverage.expected) * 100) + "%" }} />
          <span className="cb-lbl">{coverage.available}/{coverage.expected}</span>
        </div>
        <DataTable columns={cols} rows={rows} />
      </Block>
      <div className="sim-notice">Simulated data only. Production pulls from Lingxing download center.</div>
    </div>
  );
}

function ImportCheckPage({ ctx }) {
  const store = ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Import Check" }));
  const ir = store.importRun || {};
  const reports = store.reports || [];
  const totalImported = reports.reduce(function (s, r) { return s + (r.importedRows || 0); }, 0);
  const totalRejected = reports.reduce(function (s, r) { return s + (r.rejectedRows || 0); }, 0);
  return (
    <div className="pg">
      <PageHeader title="Import Check" subtitle={(ir.reportTypesImported || 0) + " types . " + totalImported.toLocaleString() + " rows . " + totalRejected + " rejected"} />
      <Block>
        <div className="import-summary">
          <div className="is-item"><span className="is-n">{ir.reportTypesImported || "-"}</span><span className="is-l">Types Imported</span></div>
          <div className="is-item"><span className="is-n">{totalImported.toLocaleString()}</span><span className="is-l">Rows Imported</span></div>
          <div className="is-item"><span className="is-n">{totalRejected}</span><span className="is-l">Rows Rejected</span></div>
          <div className="is-item"><span className="is-n">{ir.duplicateRows || "-"}</span><span className="is-l">Duplicates</span></div>
          <div className="is-item"><span className="is-n">{ir.reconciliation || "-"}</span><span className="is-l">Reconciliation</span></div>
        </div>
      </Block>
    </div>
  );
}
''')

# CHUNK 7: Diagnosis, Decisions, Readback
chunks.append('''
function DiagnosisPage({ ctx }) {
  const store = ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Diagnosis" }));
  const diag = store.diagnostics || [];
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? diag
    : filter === "high" ? diag.filter(function (d) { return d.severity === "high" || d.severity === "critical"; })
    : filter === "scale" ? diag.filter(function (d) { return d.quantStatus === "opportunity" || d.quantStatus === "scale"; })
    : diag.filter(function (d) { return d.quantStatus === "watch" || d.severity === "medium"; });
  const cols = [
    { key: "objectName", label: "Object", width: "auto" },
    { key: "objectType", label: "Type", width: "70px" },
    { key: "campaignName", label: "Campaign", width: "auto" },
    { key: "acos", label: "ACOS", width: "70px" },
    { key: "spend", label: "Spend", width: "70px" },
    { key: "orders", label: "Orders", width: "60px" },
    { key: "severity", label: "Risk", width: "70px" },
  ];
  const targetAcos = (store.metrics && store.metrics.targetAcos) || 0.3;
  const rows = filtered.map(function (d) {
    const acos = d.acos;
    const color = acos > targetAcos * 1.2 ? "#d84b50" : acos <= targetAcos ? "#14965e" : "#c8790a";
    return Object.assign({}, d, {
      acos: React.createElement("span", { style: { fontWeight: 700, color: color } }, formatPercent(acos)),
      spend: formatMoney(d.spend, store),
      severity: React.createElement(Spill, { tone: d.severity === "high" || d.severity === "critical" ? "d" : d.severity === "medium" ? "w" : "s" }, d.severity),
    });
  });
  return (
    <div className="pg">
      <PageHeader title="Ad Diagnosis" subtitle={diag.length + " objects . " + diag.filter(function (d) { return d.severity === "high"; }).length + " high risk . " + diag.filter(function (d) { return d.quantStatus === "opportunity"; }).length + " opportunities"} />
      <Filters active={filter} onChange={setFilter} options={[
        { value: "all", label: "All (" + diag.length + ")" },
        { value: "high", label: "High Risk", warn: true },
        { value: "scale", label: "Opportunity" },
        { value: "review", label: "Review" },
      ]} />
      <Block><DataTable columns={cols} rows={rows} /></Block>
    </div>
  );
}

function RecommendationsPage({ ctx }) { return <DecisionsBase ctx={ctx} view="recommendations" />; }
function ApprovalPage({ ctx }) { return <DecisionsBase ctx={ctx} view="approval" />; }
function DecidedPage({ ctx }) { return <DecisionsBase ctx={ctx} view="decided" />; }

function DecisionsBase({ ctx, view }) {
  const store = ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Decisions" }));
  const data = getDecisionViews(store);
  const viewData = data[view] || [];
  const counts = data.counts || {};
  const TABS = [
    { id: "recommendations", label: "Recommendations", count: counts.recommendations || 0, sv: "recommendations" },
    { id: "approval", label: "Awaiting Approval", count: counts.approval || 0, sv: "approval" },
    { id: "decided", label: "Decided", count: counts.decided || 0, sv: "decided" },
  ];
  const cols = [
    { key: "objectName", label: "Object", width: "auto" },
    { key: "action", label: "Action", width: "auto" },
    { key: "delta", label: "Delta", width: "70px" },
    { key: "evidence", label: "Evidence", width: "auto" },
    { key: "risk", label: "Risk", width: "70px" },
  ];
  const rows = viewData.map(function (d) {
    return Object.assign({}, d, {
      delta: d.delta != null ? React.createElement("span", { style: { fontWeight: 700, color: d.delta > 0 ? "#14965e" : "#d84b50" } }, (d.delta > 0 ? "+" : "") + formatPercent(d.delta, { signed: false })) : "-",
      risk: React.createElement(Spill, { tone: d.risk === "high" ? "d" : d.risk === "medium" ? "w" : "s" }, d.risk || "low"),
    });
  });
  const title = TABS.find(function (t) { return t.id === view; });
  return (
    <div className="pg">
      <PageHeader title={(title && title.label) || "Decisions"} subtitle={viewData.length + " items"} />
      <div className="dec-tabs">
        {TABS.map(function (t) {
          return (
            <button key={t.id} className={"dec-tab " + (view === t.id ? "a" : "")}
              onClick={function () { ctx.navigate("decisions", t.sv); }} type="button">
              <span>{t.label}</span>
              <Spill tone={view === t.id ? "p" : "n"}>{t.count}</Spill>
            </button>
          );
        })}
      </div>
      <Block><DataTable columns={cols} rows={rows} /></Block>
    </div>
  );
}

function ReadbackPage({ ctx }) {
  const store = ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Readback" }));
  const execCounts = getExecutionCounts(store);
  const readbackCounts = getReadbackCounts(store);
  const queue = store.executionQueue || [];
  const readbacks = store.readbacks || [];
  const STEPS = [
    { id: "permission", label: "Permission" },
    { id: "queued", label: "Queued" },
    { id: "running", label: "Running" },
    { id: "awaiting_readback", label: "Awaiting Readback" },
    { id: "verified", label: "Verified" },
  ];
  return (
    <div className="pg">
      <PageHeader title="Readback & Execution" subtitle={execCounts.pending + " queued . " + execCounts.verified + " verified . " + readbackCounts.waiting + " waiting"} />
      <Block title="Execution Pipeline">
        <div className="rb-pipeline">
          {STEPS.map(function (s, i) {
            return (
              <React.Fragment key={s.id}>
                <div className={"rb-step " + (i === 0 ? "active" : i < 3 ? "done" : "pending")}>
                  <div className="rb-num">{i + 1}</div>
                  <span className="rb-lbl">{s.label}</span>
                </div>
                {i < STEPS.length - 1 && <div className="rb-arrow"><CaretRight size={11} /></div>}
              </React.Fragment>
            );
          })}
        </div>
      </Block>
      <Block title={"Execution Queue (" + queue.length + ")"}>
        {queue.length === 0 && <div className="empty">No actions queued</div>}
        {queue.slice(0, 20).map(function (item) {
          return (
            <div key={item.id} className={"rb-row " + (item.status || "pending")}>
              <span className="rb-target">{item.targetName || item.id}</span>
              <span className="rb-action">{item.action || "-"}</span>
              <Spill tone={item.status === "verified" ? "s" : item.status === "failed" ? "d" : item.status === "waiting_readback" ? "w" : "n"}>{item.status || "pending"}</Spill>
              <span className="rb-time">{item.queuedAt || "-"}</span>
            </div>
          );
        })}
      </Block>
      <Block title={"Recent Readbacks (" + readbacks.length + ")"}>
        {readbacks.length === 0 && <div className="empty">No readback records</div>}
        {readbacks.slice(0, 10).map(function (rb) {
          return (
            <div key={rb.id} className={"rb-row " + (rb.verified ? "verified" : "pending")}>
              <span className="rb-target">{rb.targetName || rb.id}</span>
              <span className="rb-action">{rb.action || "-"}</span>
              <Spill tone={rb.verified ? "s" : "w"}>{rb.verified ? "Verified" : "Pending"}</Spill>
            </div>
          );
        })}
      </Block>
    </div>
  );
}
''')

# CHUNK 8: Growth, stores, system pages
chunks.append('''
function KeywordsPage({ ctx }) {
  const store = ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Keywords" }));
  const keywords = store.keywords || [];
  const cols = [
    { key: "term", label: "Search Term", width: "auto" },
    { key: "matchType", label: "Match", width: "70px" },
    { key: "clicks", label: "Clicks", width: "60px" },
    { key: "orders", label: "Orders", width: "60px" },
    { key: "acos", label: "ACOS", width: "70px" },
    { key: "opportunity", label: "Opportunity", width: "auto" },
  ];
  const rows = keywords.slice(0, 30).map(function (k) {
    return Object.assign({}, k, {
      acos: k.acos != null ? formatPercent(k.acos) : "-",
      opportunity: React.createElement(Spill, { tone: k.opportunity === "high" ? "s" : k.opportunity === "medium" ? "w" : "n" }, k.opportunity || "low"),
    });
  });
  return (
    <div className="pg">
      <PageHeader title="Keyword Opportunities" subtitle={keywords.length + " terms derived from imported metrics"} />
      <Block><DataTable columns={cols} rows={rows} /></Block>
    </div>
  );
}

function ListingPage({ ctx }) {
  const store = ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Listing" }));
  const listing = store.listing || {};
  return (
    <div className="pg">
      <PageHeader title="Listing Drafts" subtitle={listing.productName || ((store.products && store.products[0] && store.products[0].name) || "-")} />
      <Block title="Title Draft">
        <div className="listing-draft">{listing.title || "-"}</div>
      </Block>
      <Block title="Bullet Points">
        {(listing.bullets || []).map(function (b, i) {
          return <div key={i} className="listing-bullet">{b}</div>;
        })}
      </Block>
      <Block title="Backend Keywords">
        <div className="listing-keywords">{listing.backend || "-"}</div>
      </Block>
    </div>
  );
}

function StoresPage({ ctx }) {
  const stores = ctx.appState.stores;
  const activeStoreId = ctx.activeStoreId;
  if (!stores) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Stores" }));
  const cols = [
    { key: "name", label: "Name", width: "auto" },
    { key: "marketplaceCode", label: "Region", width: "70px" },
    { key: "marketplace", label: "Marketplace", width: "auto" },
    { key: "sessionStatus", label: "Session", width: "80px" },
    { key: "productCount", label: "Products", width: "70px" },
    { key: "lastCollection", label: "Last Pull", width: "auto" },
    { key: "actions", label: "", width: "70px" },
  ];
  const rows = Object.values(stores).map(function (s) {
    return Object.assign({}, s, {
      sessionStatus: React.createElement(Spill, { tone: s.sessionStatus === "active" ? "s" : s.sessionStatus === "warning" ? "w" : "n" }, s.sessionStatus),
      productCount: (s.products && s.products.length) || 0,
      actions: React.createElement("button", {
        className: "btn sm p",
        onClick: function () { ctx.setAppState(function (prev) { return selectStore(prev, s.id); }); },
        type: "button"
      }, s.id === activeStoreId ? "Current" : "Activate"),
    });
  });
  return (
    <div className="pg">
      <PageHeader title="Store Management" subtitle={Object.keys(stores).length + " stores configured"} />
      <Block><DataTable columns={cols} rows={rows} /></Block>
    </div>
  );
}

function SettingsPage({ ctx }) {
  const store = ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Settings" }));
  return (
    <div className="pg">
      <PageHeader title="Settings" subtitle="Local configuration and AI provider" />
      <Block title="AI Provider">
        <div className="setting-row"><span className="sr-l">Provider</span><span className="sr-v">{(store.aiProvider && store.aiProvider.provider) || "-"}</span></div>
        <div className="setting-row"><span className="sr-l">Model</span><span className="sr-v">{(store.aiProvider && store.aiProvider.model) || "-"}</span></div>
      </Block>
      <Block title="Execution Mode">
        <div className="mode-row">
          {AI_MODES.map(function (m) {
            const Icon = m.icon;
            return (
              <button key={m.id} className={"mode-card " + (ctx.aiMode === m.id ? "a" : "")}
                style={{ "--mc": m.color }}
                onClick={function () { ctx.pushToast("Mode change to " + m.label + " simulated", { tone: "info" }); }}
                type="button">
                <Icon size={14} weight="fill" />
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
      </Block>
    </div>
  );
}

function SchedulerPage({ ctx }) {
  const store = ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Scheduler" }));
  const tasks = store.scheduler || [];
  return (
    <div className="pg">
      <PageHeader title="Scheduler" subtitle={tasks.length + " local tasks"} />
      <Block>
        {tasks.length === 0 && <div className="empty">No scheduled tasks</div>}
        {tasks.map(function (t) {
          return (
            <div key={t.id} className="sched-row">
              <span className="sched-name">{t.name}</span>
              <span className="sched-cron">{t.cron || "-"}</span>
              <Spill tone={t.enabled ? "s" : "n"}>{t.enabled ? "Enabled" : "Disabled"}</Spill>
              <span className="sched-last">{t.lastRun || "-"}</span>
            </div>
          );
        })}
      </Block>
    </div>
  );
}

function DeliveryPage({ ctx }) {
  const store = ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Delivery" }));
  const gates = store.deliveryGates || [];
  const overall = gates.length > 0 && gates.every(function (g) { return g.passed; }) ? "ready" : "blocked";
  return (
    <div className="pg">
      <PageHeader title="Delivery Readiness" subtitle={"Status: " + overall} />
      <Block>
        <div className="gate-list">
          {gates.map(function (g) {
            return (
              <div key={g.id} className={"gate-row " + (g.passed ? "passed" : "blocked")}>
                <span className="gate-name">{g.label || g.id}</span>
                <Spill tone={g.passed ? "s" : "d"}>{g.passed ? "Passed" : "Blocked"}</Spill>
                <span className="gate-meta">{g.meta || "-"}</span>
              </div>
            );
          })}
        </div>
      </Block>
      <div className="sim-notice">Simulated delivery state. Production needs real evidence + verify run.</div>
    </div>
  );
}
''')

# CHUNK 9: Context Panel, Drawer, Toast
chunks.append('''
function ContextPanel({ ctx }) {
  const [tab, setTab] = useState("chain");
  return (
    <div className="ctx-panel">
      <div className="ctx-tabs">
        <button className={"ctx-tab " + (tab === "chain" ? "a" : "")} onClick={function () { setTab("chain"); }} type="button">Main Chain</button>
        <button className={"ctx-tab " + (tab === "data" ? "a" : "")} onClick={function () { setTab("data"); }} type="button">Data Instances</button>
        <button className={"ctx-tab " + (tab === "logs" ? "a" : "")} onClick={function () { setTab("logs"); }} type="button">Logs</button>
      </div>
      <div className="ctx-body">
        {tab === "chain" && <ChainTab ctx={ctx} />}
        {tab === "data" && <DataTab ctx={ctx} />}
        {tab === "logs" && <LogsTab ctx={ctx} />}
      </div>
    </div>
  );
}

function ChainTab({ ctx }) {
  const doneCount = Object.values(ctx.mission.phases).filter(function (p) { return p.status === "done"; }).length;
  const current = MISSION_PHASES.find(function (p) { return p.id === ctx.mission.currentPhaseId; });
  return (
    <div className="chain-tab">
      <div className="chain-summary">
        <span className="cs-label">Phase Progress</span>
        <span className="cs-val">{doneCount}/{MISSION_PHASES.length}</span>
      </div>
      <div className="chain-list">
        {MISSION_PHASES.map(function (p) {
          const status = (ctx.mission.phases[p.id] && ctx.mission.phases[p.id].status) || "pending";
          const Icon = p.icon;
          return (
            <div key={p.id} className={"chain-item " + status}>
              <span className="ci-dot">{status === "done" ? <Check size={9} weight="bold" /> : <Icon size={9} />}</span>
              <span className="ci-lbl">{p.label}</span>
              {p.humanCheckpoint && <HandWaving size={9} weight="fill" />}
            </div>
          );
        })}
      </div>
      {current && (
        <div className="chain-current">
          <span className="cc-lbl">Now</span>
          <span className="cc-name">{current.label}</span>
          <p className="cc-desc">{current.desc}</p>
        </div>
      )}
    </div>
  );
}

function DataTab({ ctx }) {
  const store = ctx.store;
  if (!store) return React.createElement("div", { className: "empty" }, "No data");
  const items = [
    { label: "Products", count: (store.products && store.products.length) || 0 },
    { label: "Reports Imported", count: (store.reports || []).filter(function (r) { return r.status === "imported"; }).length },
    { label: "Diagnostics", count: (store.diagnostics && store.diagnostics.length) || 0 },
    { label: "Recommendations", count: (store.recommendations && store.recommendations.length) || 0 },
    { label: "Execution Queue", count: (store.executionQueue && store.executionQueue.length) || 0 },
    { label: "Readbacks", count: (store.readbacks && store.readbacks.length) || 0 },
    { label: "Ledger Entries", count: (store.ledger && store.ledger.length) || 0 },
  ];
  return (
    <div className="data-tab">
      {items.map(function (i) {
        return (
          <div key={i.label} className="dt-row">
            <span className="dt-lbl">{i.label}</span>
            <Spill tone="n">{i.count}</Spill>
          </div>
        );
      })}
    </div>
  );
}

function LogsTab({ ctx }) {
  const donePhases = Object.entries(ctx.mission.phases)
    .filter(function (kv) { return kv[1].status === "done"; })
    .slice(-5);
  return (
    <div className="logs-tab">
      {donePhases.length === 0 && <div className="empty">No logs yet</div>}
      {donePhases.map(function (kv) {
        return (
          <div key={kv[0]} className="log-row">
            <span className="log-time">{kv[1].endedAt}</span>
            <span className="log-msg">Phase {kv[0]} completed ({kv[1].durationMs}ms)</span>
          </div>
        );
      })}
    </div>
  );
}

function DetailDrawer({ detail, onClose }) {
  if (!detail) return null;
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={function (e) { e.stopPropagation(); }}>
        <div className="drawer-hd">
          <h3>{detail.title || "Detail"}</h3>
          <button className="drawer-close" onClick={onClose} type="button"><X size={14} /></button>
        </div>
        <div className="drawer-body">
          <pre>{JSON.stringify(detail, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}

function ToastStack({ toasts }) {
  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {toasts.map(function (t) {
        return (
          <div key={t.id} className={"toast tone-" + t.tone}>
            <Sparkle size={12} />
            <span>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
''')

# Concatenate and write
final = "".join(chunks)
with open(src, "w", encoding="utf-8") as f:
    f.write(final)
print("Written:", len(final), "chars")
print("First 200:", final[:200])
