#!/usr/bin/env python
# -*- coding: utf-8 -*-
import json

src = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'

# Helper: build React.createElement call properly
def e(tag, props=None, *children):
    """Generate React.createElement(...) call string"""
    if children:
        # Multiple children passed as varargs
        child_strs = [_c(c) for c in children]
        if props:
            props_str = ", ".join(k + ": " + v for k, v in props.items())
            return "React.createElement(" + _t(tag) + ", {" + props_str + "}, " + ", ".join(child_strs) + ")"
        else:
            return "React.createElement(" + _t(tag) + ", null, " + ", ".join(child_strs) + ")"
    elif props:
        props_str = ", ".join(_t(k) + ": " + v for k, v in props.items())
        return "React.createElement(" + _t(tag) + ", {" + props_str + "})"
    else:
        return "React.createElement(" + _t(tag) + ")"

def _t(x):
    if x is None: return "null"
    if isinstance(x, bool): return "true" if x else "false"
    if isinstance(x, (int, float)): return str(x)
    if isinstance(x, str):
        if x.startswith("function") or "(" in x: return x
        return json.dumps(x)
    return json.dumps(str(x))

def _c(x):
    if isinstance(x, str): return _t(x)
    return x

def el(tag, props=None, *children):
    """Compact createElement with children as array"""
    args = [_t(tag)]
    if props:
        props_str = ", ".join(_t(k) + ": " + (v if isinstance(v, str) and (v.startswith("function") or "(" in v) else _t(v)) for k, v in props.items())
        args.append("{" + props_str + "}")
    else:
        args.append("null")
    if children:
        child_strs = [_c(c) for c in children]
        args.extend(child_strs)
    return "React.createElement(" + ", ".join(args) + ")"

# Write to file
OUT = []

def write(s):
    OUT.append(s)

# ====== Part 1: Imports + Constants ======
write(r'''/*
 * Amazon AI Ops - Autonomy Prototype (minimal rebuild)
 * English UI labels; connects to model.js for fixture data.
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
  MISSION_PHASES.forEach(function (p) {
    phases[p.id] = { status: p.id === "collect" ? "active" : "pending" };
  });
  return { currentPhaseId: "collect", phases: phases };
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
  const order = MISSION_PHASES.map(function (p) { return p.id; });
  const idx = order.indexOf(phaseId);
  let nextId = phaseId;
  for (let i = idx + 1; i < order.length; i++) {
    const pid = order[i];
    if (!(phases[pid] && phases[pid].status === "done")) { nextId = pid; break; }
  }
  if (nextId !== phaseId) {
    const phaseDef = MISSION_PHASES.find(function (p) { return p.id === nextId; });
    phases[nextId] = {
      status: phaseDef && phaseDef.humanCheckpoint ? "waiting" : "active",
      startedAt: fmtTime(new Date()),
    };
  }
  return { currentPhaseId: nextId, phases: phases };
}
''')

# ====== Part 2: UI Primitives ======
write(r'''
function Spill(props) {
  const tone = props.tone || "n";
  return React.createElement("span", { className: "sp sp-" + tone }, props.children);
}

function Btn(props) {
  let cls = "btn";
  if (props.small) cls += " sm";
  if (props.primary) cls += " p";
  else if (props.ghost) cls += " g";
  else if (props.danger) cls += " d";
  return React.createElement("button", {
    className: cls,
    onClick: props.onClick,
    type: props.type || "button",
    title: props.title,
    disabled: props.disabled
  }, props.children);
}

function BtnRow(props) { return React.createElement("div", { className: "btn-r" }, props.children); }

function PageHeader(props) {
  return React.createElement("div", { className: "pg-hd" },
    React.createElement("div", { className: "pg-hd-l" },
      React.createElement("h1", { className: "pg-t" }, props.title),
      props.subtitle && React.createElement("span", { className: "pg-st" }, props.subtitle)
    ),
    props.actions && React.createElement("div", { className: "pg-hd-r" }, props.actions)
  );
}

function Block(props) {
  return React.createElement("div", { className: "blk" },
    props.title && React.createElement("div", { className: "blk-hd" },
      React.createElement("span", { className: "blk-t" }, props.title),
      props.actions && React.createElement("div", { className: "blk-actions" }, props.actions)
    ),
    React.createElement("div", { className: "blk-body" }, props.children)
  );
}

function KpiGrid(props) { return React.createElement("div", { className: "kpi-g" }, props.children); }

function KpiCard(props) {
  let tone = "";
  if (props.good === true) tone = " g";
  else if (props.good === false) tone = " w";
  return React.createElement("div", { className: "kpi-c" + tone },
    React.createElement("span", { className: "kpi-l" }, props.label),
    React.createElement("span", { className: "kpi-v" }, props.value),
    props.delta && React.createElement("span", { className: "kpi-d" + tone }, props.delta)
  );
}

function DataTable(props) {
  return React.createElement("div", { className: "dtbl-scroll" },
    React.createElement("table", { className: "dtbl-t" },
      React.createElement("thead", null,
        React.createElement("tr", null, props.columns.map(function (c, i) {
          return React.createElement("th", { key: i, style: { width: c.width } }, c.label);
        }))
      ),
      React.createElement("tbody", null, props.rows.map(function (row, ri) {
        return React.createElement("tr", {
          key: ri,
          className: props.onRowClick ? "cp" : "",
          onClick: function () { if (props.onRowClick) props.onRowClick(row); }
        }, props.columns.map(function (c, ci) {
          return React.createElement("td", { key: ci }, c.render ? c.render(row[c.key], row) : row[c.key]);
        }));
      }))
    )
  );
}

function Filters(props) {
  return React.createElement("div", { className: "filt-r" },
    props.options.map(function (o) {
      return React.createElement("button", {
        key: o.value,
        className: "filt-b " + (props.active === o.value ? "a" : "") + (o.warn ? " warn" : ""),
        onClick: function () { props.onChange(o.value); },
        type: "button"
      }, o.label);
    })
  );
}
''')

# ====== Part 3: App Component ======
write(r'''
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
      if (wsObj) { setActiveWorkspace(ws); setActiveSubview(sv || wsObj.subviews[0].id); }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return function () { window.removeEventListener("hashchange", apply); };
  }, []);

  useEffect(function () {
    const target = "#" + activeWorkspace + "/" + activeSubview;
    if (window.location.hash !== target) { window.history.replaceState(null, "", target); }
  }, [activeWorkspace, activeSubview]);

  const pushToast = useCallback(function (message, opts) {
    const id = ++toastIdRef.current;
    opts = opts || {};
    setToasts(function (prev) { return prev.concat([{ id: id, message: message, tone: opts.tone || "info" }]); });
    setTimeout(function () { setToasts(function (prev) { return prev.filter(function (t) { return t.id !== id; }); }); }, opts.ttl || 3500);
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

  return React.createElement(AppContext.Provider, { value: ctx },
    React.createElement("div", { className: "app " + (showPanel ? "panel-open" : "") },
      React.createElement(MissionTimeline, { mission: mission, onSimulate: simulateProgress }),
      React.createElement("div", { className: "app-body" },
        React.createElement(Sidebar, {
          activeWorkspace: activeWorkspace, activeSubview: activeSubview,
          navigate: navigate, showPanel: showPanel, setShowPanel: setShowPanel,
          store: store
        }),
        React.createElement("main", { className: "main" },
          React.createElement(Topbar, { activeWorkspace: activeWorkspace, activeSubview: activeSubview }),
          React.createElement("div", { className: "content" },
            React.createElement(PageRouter, { pageKey: pageKey, ctx: ctx })
          )
        ),
        React.createElement(ContextPanel, { ctx: ctx })
      ),
      detail && React.createElement(DetailDrawer, { detail: detail, onClose: function () { setDetail(null); } }),
      React.createElement(ToastStack, { toasts: toasts })
    )
  );
}
''')

# ====== Part 4: Sidebar, Topbar, PageRouter ======
write(r'''
function Sidebar(props) {
  function navItem(ws) {
    const isActive = props.activeWorkspace === ws.id;
    const svItems = ws.subviews.length > 1 ? ws.subviews.map(function (sv) {
      return React.createElement("button", {
        key: sv.id,
        className: "nav-sv-btn " + (props.activeWorkspace === ws.id && props.activeSubview === sv.id ? "a" : ""),
        onClick: function () { props.navigate(ws.id, sv.id); },
        type: "button"
      },
        React.createElement("span", { className: "nav-sv-dot" }),
        React.createElement("span", { className: "nav-sv-lbl" }, sv.label)
      );
    }) : null;
    return React.createElement("div", { key: ws.id, className: "nav-ws" },
      React.createElement("button", {
        className: "nav-ws-hd " + (isActive ? "a" : ""),
        onClick: function () { props.navigate(ws.id); },
        type: "button"
      },
        React.createElement(ws.icon, { size: 16, weight: isActive ? "fill" : "regular" }),
        React.createElement("span", { className: "nav-ws-lbl" }, ws.label),
        React.createElement(CaretRight, {
          size: 11,
          className: "nav-ws-arr " + (isActive ? "open" : ""),
          style: ws.subviews.length <= 1 ? { visibility: "hidden" } : {}
        })
      ),
      svItems && React.createElement("div", {
        className: "nav-sv-list " + (isActive ? "open" : "")
      }, svItems)
    );
  }

  return React.createElement("aside", { className: "sidebar" },
    React.createElement("nav", { className: "sidebar-nav" },
      WORKSPACES.filter(function (w) { return w.section === "daily"; }).map(navItem),
      React.createElement("div", { className: "nav-divider" }),
      WORKSPACES.filter(function (w) { return w.section === "system"; }).map(navItem)
    ),
    React.createElement("div", { className: "sidebar-foot" },
      React.createElement("button", {
        className: "store-indicator",
        onClick: function () { props.navigate("stores", "list"); },
        type: "button"
      },
        React.createElement(Storefront, { size: 14, weight: "fill" }),
        React.createElement("div", { className: "store-indicator-info" },
          React.createElement("span", { className: "store-indicator-name" }, (props.store && props.store.name) || "Store"),
          React.createElement("span", { className: "store-indicator-meta" },
            ((props.store && props.store.marketplaceCode) || "-") + " / " + ((props.store && props.store.marketplace) || "-")
          )
        ),
        React.createElement(CaretRight, { size: 11, className: "store-indicator-arr" })
      ),
      React.createElement("button", {
        className: "nav-btn panel-toggle " + (props.showPanel ? "a" : ""),
        onClick: function () { props.setShowPanel(function (p) { return !p; }); },
        type: "button",
        title: "Toggle right panel"
      }, React.createElement(Stack, { size: 16, weight: props.showPanel ? "fill" : "regular" }))
    )
  );
}

function Topbar(props) {
  const ws = WORKSPACES.find(function (w) { return w.id === props.activeWorkspace; });
  const sv = ws && ws.subviews.find(function (s) { return s.id === props.activeSubview; });
  return React.createElement("div", { className: "topbar" },
    React.createElement("div", { className: "topbar-breadcrumb" },
      React.createElement("span", { className: "topbar-ws" }, (ws && ws.label) || ""),
      React.createElement(CaretRight, { size: 11 }),
      React.createElement("span", { className: "topbar-sv" }, (sv && sv.label) || "")
    ),
    React.createElement("div", { className: "topbar-r" },
      React.createElement("span", { className: "topbar-hint" }, (ws && ws.description) || "")
    )
  );
}

function PageRouter(props) {
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
  const Component = PAGE_MAP[props.pageKey] || NotFoundPage;
  return React.createElement(Component, { ctx: props.ctx });
}

function NotFoundPage() {
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, { title: "Not Found", subtitle: "This view is not yet implemented" })
  );
}
''')

# ====== Part 5: MissionTimeline ======
write(r'''
function MissionTimeline(props) {
  const [expanded, setExpanded] = useState(false);
  const currentPhase = MISSION_PHASES.find(function (p) { return p.id === props.mission.currentPhaseId; });
  const doneCount = Object.values(props.mission.phases).filter(function (p) { return p.status === "done"; }).length;
  const total = MISSION_PHASES.length;

  const stepEls = MISSION_PHASES.slice(0, 8).map(function (p) {
    const data = props.mission.phases[p.id];
    const status = (data && data.status) || "pending";
    const Icon = p.icon;
    const dot = status === "done" ? React.createElement(Check, { size: 9, weight: "bold" })
      : status === "active" ? React.createElement(CircleNotch, { size: 9, className: "spin" })
      : React.createElement(Icon, { size: 9 });
    return React.createElement("div", { key: p.id, className: "mbar-step " + status },
      React.createElement("span", { className: "mbar-dot" }, dot),
      React.createElement("span", { className: "mbar-lbl" }, p.label)
    );
  });

  const expandRows = MISSION_PHASES.map(function (p) {
    const data = props.mission.phases[p.id];
    const status = (data && data.status) || "pending";
    const Icon = p.icon;
    const statusLabel = status === "done" ? "Done" : status === "active" ? "Active" : status === "waiting" ? "Waiting" : "Pending";
    const dot = status === "done" ? React.createElement(Check, { size: 9, weight: "bold" }) : React.createElement(Icon, { size: 9 });
    return React.createElement("div", { key: p.id, className: "mbe-phase " + status },
      React.createElement("div", { className: "mbe-dot" }, dot),
      React.createElement("div", { className: "mbe-info" },
        React.createElement("div", { className: "mbe-hd" },
          React.createElement("span", { className: "mbe-name" }, p.label),
          React.createElement("span", { className: "mbe-status " + status }, statusLabel)
        ),
        React.createElement("span", { className: "mbe-desc" }, p.desc)
      )
    );
  });

  const curBadge = currentPhase && React.createElement("span", { className: "mbar-cur" },
    React.createElement("span", { className: "mbar-cur-lbl" }, "Now"),
    React.createElement("span", { className: "mbar-cur-val" }, currentPhase.label),
    currentPhase.humanCheckpoint && React.createElement(HandWaving, { size: 11, weight: "fill" })
  );

  return React.createElement("div", { className: "mbar " + (expanded ? "ex" : "") },
    React.createElement("div", { className: "mbar-l" },
      React.createElement(RocketLaunch, { size: 14, weight: "fill", className: "mbar-icon" }),
      React.createElement("span", { className: "mbar-title" }, "Mission"),
      React.createElement("div", { className: "mbar-steps" }, stepEls),
      React.createElement("span", { className: "mbar-prog" }, doneCount + "/" + total)
    ),
    React.createElement("div", { className: "mbar-r" },
      curBadge,
      React.createElement("button", {
        className: "mbar-sim", onClick: props.onSimulate, title: "Simulate one step", type: "button"
      }, React.createElement(CircleNotch, { size: 11 })),
      React.createElement("button", {
        className: "mbar-toggle", onClick: function () { setExpanded(function (e) { return !e; }); },
        title: "Expand details", type: "button"
      }, React.createElement(CaretRight, { size: 11, className: expanded ? "open" : "" }))
    ),
    expanded && React.createElement("div", { className: "mbar-ex" }, expandRows)
  );
}
''')

# ====== Part 6: TodayPage, ProductsPage, TargetsPage, EventsPage ======
write(r'''
function TodayPage(props) {
  const store = props.ctx.store;
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

  const taskEls = tasks.map(function (t, i) {
    return React.createElement("div", {
      key: i, className: "todo-i tone-" + t.tone + " lnk",
      onClick: function () { props.ctx.navigate(t.ws, t.sv); }
    },
      React.createElement(t.icon, { size: 14 }),
      React.createElement("span", null, t.text),
      React.createElement(CaretRight, { size: 12, className: "todo-arr" })
    );
  });

  const timelineEls = timeline && timeline.map(function (entry) {
    const tone = entry.state === "done" ? "s" : entry.state === "warning" ? "w" : "n";
    return React.createElement("div", { key: entry.id, className: "tl-i " + tone },
      React.createElement("span", { className: "tl-t" }, entry.time),
      React.createElement("span", { className: "tl-n" }, entry.title),
      React.createElement("span", { className: "tl-m" }, entry.meta)
    );
  });

  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, {
      title: "Today",
      subtitle: (store.name || "Store") + " / " + ((store.scope && store.scope.dateTo) || "-")
    }),
    React.createElement(KpiGrid, null, kpis.map(function (k) {
      return React.createElement(KpiCard, Object.assign({ key: k.label }, k));
    })),
    tasks.length > 0 && React.createElement(Block, { title: "Outstanding Work (" + tasks.length + ")" }, taskEls),
    timelineEls && timelineEls.length > 0 && React.createElement(Block, { title: "Today Timeline" }, timelineEls)
  );
}

function ProductsPage(props) {
  const store = props.ctx.store;
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
    return {
      asin: p.asin, name: p.name,
      price: formatMoney(p.price, store),
      acos: p.acos != null ? formatPercent(p.acos) : "-",
      spend: p.spend != null ? formatMoney(p.spend, store) : "-",
      stage: React.createElement(Spill, { tone: "n" }, p.stage || "-"),
      health: React.createElement(Spill, { tone: p.health === "normal" ? "s" : p.health === "review" ? "w" : "d" }, p.health || "-"),
    };
  });
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, { title: "Products", subtitle: products.length + " products in scope" }),
    React.createElement(Block, null, React.createElement(DataTable, { columns: cols, rows: rows }))
  );
}

function TargetsPage(props) {
  const store = props.ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Targets" }));
  const products = store.products || [];
  const targetAcos = (store.metrics && store.metrics.targetAcos) || 0.3;
  const rows = products.map(function (p) {
    const over = p.acos > (p.targetAcos || targetAcos);
    return React.createElement("div", { key: p.id, className: "target-row" },
      React.createElement("span", { className: "tr-asin" }, p.asin),
      React.createElement("span", { className: "tr-name" }, p.name),
      React.createElement("span", { className: "tr-target" }, "Target " + formatPercent(p.targetAcos || targetAcos, { signed: false })),
      React.createElement(Spill, { tone: over ? "w" : "s" }, "Current " + formatPercent(p.acos))
    );
  });
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, { title: "Targets", subtitle: "Per-product ACOS targets" }),
    React.createElement(Block, null, rows.length > 0 ? rows : React.createElement("div", { className: "empty" }, "No products"))
  );
}

function EventsPage(props) {
  const store = props.ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Events" }));
  const events = store.operationEvents || [];
  const rows = events.map(function (e, i) {
    return React.createElement("div", { key: i, className: "event-row" },
      React.createElement("span", { className: "ev-time" }, e.at || "-"),
      React.createElement("span", { className: "ev-title" }, e.title || "-"),
      React.createElement(Spill, { tone: "n" }, e.scope || "store")
    );
  });
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, { title: "Operation Events", subtitle: events.length + " annotated events" }),
    React.createElement(Block, null, rows.length > 0 ? rows : React.createElement("div", { className: "empty" }, "No events"))
  );
}
''')

# ====== Part 7: DataPrep pages ======
write(r'''
function ScopePage(props) {
  const store = props.ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Scope" }));
  const s = store.scope || {};
  const rows = [
    ["Date From", s.dateFrom || "-"],
    ["Date To", s.dateTo || "-"],
    ["Marketplace", store.marketplace || "-"],
    ["Products", (store.products && store.products.length) || 0],
    ["Source Files", (store.importRun && store.importRun.sourceFiles) || 0],
    ["Import Status", (store.importRun && store.importRun.reconciliation) || "-"],
  ].map(function (pair, i) {
    return React.createElement("div", { key: i, className: "scope-field" },
      React.createElement("span", { className: "sf-l" }, pair[0]),
      React.createElement("span", { className: "sf-v" }, String(pair[1]))
    );
  });
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, { title: "Operation Scope", subtitle: "Store " + (store.id || "-") + " / " + (store.marketplaceCode || "-") }),
    React.createElement(Block, null,
      React.createElement("div", { className: "scope-grid" }, rows)
    )
  );
}

function ReportsPage(props) {
  const store = props.ctx.store;
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
    const tone = r.status === "imported" ? "s" : r.status === "missing" ? "d" : "n";
    return {
      label: r.label || r.grain || r.id || "-",
      grain: r.grain || "-",
      importedRows: r.importedRows != null ? String(r.importedRows) : "-",
      checksum: r.checksum ? React.createElement("code", { style: { fontSize: "11px" } }, String(r.checksum).slice(0, 24) + "...") : "-",
      status: React.createElement(Spill, { tone: tone }, r.status || "-"),
    };
  });
  const pct = Math.round((coverage.available / coverage.expected) * 100);
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, {
      title: "Report Collection",
      subtitle: coverage.available + "/" + coverage.expected + " types  " + coverage.importLabel
    }),
    React.createElement(Block, null,
      React.createElement("div", { className: "coverage-bar" },
        React.createElement("div", { className: "cb-fill", style: { width: pct + "%" } }),
        React.createElement("span", { className: "cb-lbl" }, coverage.available + "/" + coverage.expected)
      ),
      React.createElement(DataTable, { columns: cols, rows: rows })
    ),
    React.createElement("div", { className: "sim-notice" },
      "Simulated data only. Production pulls from Lingxing download center."
    )
  );
}

function ImportCheckPage(props) {
  const store = props.ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Import Check" }));
  const ir = store.importRun || {};
  const reports = store.reports || [];
  const totalImported = reports.reduce(function (s, r) { return s + (r.importedRows || 0); }, 0);
  const totalRejected = reports.reduce(function (s, r) { return s + (r.rejectedRows || 0); }, 0);
  const items = [
    ["Types Imported", ir.reportTypesImported || "-"],
    ["Rows Imported", totalImported.toLocaleString()],
    ["Rows Rejected", totalRejected],
    ["Duplicates", ir.duplicateRows || "-"],
    ["Reconciliation", ir.reconciliation || "-"],
  ].map(function (pair, i) {
    return React.createElement("div", { key: i, className: "is-item" },
      React.createElement("span", { className: "is-n" }, String(pair[1])),
      React.createElement("span", { className: "is-l" }, pair[0])
    );
  });
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, {
      title: "Import Check",
      subtitle: (ir.reportTypesImported || 0) + " types  " + totalImported.toLocaleString() + " rows  " + totalRejected + " rejected"
    }),
    React.createElement(Block, null,
      React.createElement("div", { className: "import-summary" }, items)
    )
  );
}
''')

# ====== Part 8: DiagnosisPage ======
write(r'''
function DiagnosisPage(props) {
  const store = props.ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Diagnosis" }));
  const diag = store.diagnostics || [];
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? diag
    : filter === "high" ? diag.filter(function (d) { return d.severity === "high" || d.severity === "critical"; })
    : filter === "scale" ? diag.filter(function (d) { return d.quantStatus === "opportunity" || d.quantStatus === "scale"; })
    : diag.filter(function (d) { return d.quantStatus === "watch" || d.severity === "medium"; });
  const targetAcos = (store.metrics && store.metrics.targetAcos) || 0.3;
  const cols = [
    { key: "objectName", label: "Object", width: "auto" },
    { key: "objectType", label: "Type", width: "70px" },
    { key: "campaignName", label: "Campaign", width: "auto" },
    { key: "acos", label: "ACOS", width: "70px" },
    { key: "spend", label: "Spend", width: "70px" },
    { key: "orders", label: "Orders", width: "60px" },
    { key: "severity", label: "Risk", width: "70px" },
  ];
  const rows = filtered.map(function (d) {
    const acos = d.acos;
    const color = acos > targetAcos * 1.2 ? "#d84b50" : acos <= targetAcos ? "#14965e" : "#c8790a";
    const sevTone = d.severity === "high" || d.severity === "critical" ? "d" : d.severity === "medium" ? "w" : "s";
    return {
      objectName: d.objectName || d.id || "-",
      objectType: d.objectType || "-",
      campaignName: d.campaignName || "-",
      acos: React.createElement("span", { style: { fontWeight: 700, color: color } }, formatPercent(acos)),
      spend: formatMoney(d.spend, store),
      orders: d.orders != null ? String(d.orders) : "-",
      severity: React.createElement(Spill, { tone: sevTone }, d.severity || "-"),
    };
  });
  const hiRisk = diag.filter(function (d) { return d.severity === "high"; }).length;
  const opps = diag.filter(function (d) { return d.quantStatus === "opportunity"; }).length;
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, {
      title: "Ad Diagnosis",
      subtitle: diag.length + " objects  " + hiRisk + " high risk  " + opps + " opportunities"
    }),
    React.createElement(Filters, {
      active: filter, onChange: setFilter,
      options: [
        { value: "all", label: "All (" + diag.length + ")" },
        { value: "high", label: "High Risk", warn: true },
        { value: "scale", label: "Opportunity" },
        { value: "review", label: "Review" },
      ]
    }),
    React.createElement(Block, null, React.createElement(DataTable, { columns: cols, rows: rows }))
  );
}
''')

# ====== Part 9: Decisions pages ======
write(r'''
function RecommendationsPage(props) { return React.createElement(DecisionsBase, { ctx: props.ctx, view: "recommendations" }); }
function ApprovalPage(props) { return React.createElement(DecisionsBase, { ctx: props.ctx, view: "approval" }); }
function DecidedPage(props) { return React.createElement(DecisionsBase, { ctx: props.ctx, view: "decided" }); }

function DecisionsBase(props) {
  const store = props.ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Decisions" }));
  const data = getDecisionViews(store);
  const viewData = data[props.view] || [];
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
    const deltaColor = d.delta > 0 ? "#14965e" : "#d84b50";
    const riskTone = d.risk === "high" ? "d" : d.risk === "medium" ? "w" : "s";
    return {
      objectName: d.objectName || d.id || "-",
      action: d.action || "-",
      delta: d.delta != null ? React.createElement("span", { style: { fontWeight: 700, color: deltaColor } },
        (d.delta > 0 ? "+" : "") + formatPercent(d.delta, { signed: false })) : "-",
      evidence: d.evidenceSummary || d.evidence || "-",
      risk: React.createElement(Spill, { tone: riskTone }, d.risk || "low"),
    };
  });
  const activeTab = TABS.find(function (t) { return t.id === props.view; });
  const tabEls = TABS.map(function (t) {
    return React.createElement("button", {
      key: t.id,
      className: "dec-tab " + (props.view === t.id ? "a" : ""),
      onClick: function () { props.ctx.navigate("decisions", t.sv); },
      type: "button"
    },
      React.createElement("span", null, t.label),
      React.createElement(Spill, { tone: props.view === t.id ? "p" : "n" }, t.count)
    );
  });
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, {
      title: (activeTab && activeTab.label) || "Decisions",
      subtitle: viewData.length + " items"
    }),
    React.createElement("div", { className: "dec-tabs" }, tabEls),
    React.createElement(Block, null,
      rows.length > 0
        ? React.createElement(DataTable, { columns: cols, rows: rows })
        : React.createElement("div", { className: "empty" }, "No items in this view")
    )
  );
}
''')

# ====== Part 10: Readback page ======
write(r'''
function ReadbackPage(props) {
  const store = props.ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Readback" }));
  const execCounts = getExecutionCounts(store);
  const readbackCounts = getReadbackCounts(store);
  const queue = store.executionQueue || [];
  const readbacks = store.readbacks || [];
  const STEPS = [
    { label: "Permission" }, { label: "Queued" }, { label: "Running" },
    { label: "Awaiting Readback" }, { label: "Verified" },
  ];
  const pipelineEls = STEPS.map(function (s, i) {
    const stepClass = i === 0 ? "active" : i < 3 ? "done" : "pending";
    return React.createElement(React.Fragment, { key: s.label },
      React.createElement("div", { className: "rb-step " + stepClass },
        React.createElement("div", { className: "rb-num" }, i + 1),
        React.createElement("span", { className: "rb-lbl" }, s.label)
      ),
      i < STEPS.length - 1 && React.createElement("div", { className: "rb-arrow" },
        React.createElement(CaretRight, { size: 11 })
      )
    );
  });
  const queueEls = queue.length > 0
    ? queue.slice(0, 20).map(function (item) {
        const tone = item.status === "verified" ? "s" : item.status === "failed" ? "d" : item.status === "waiting_readback" ? "w" : "n";
        return React.createElement("div", { key: item.id, className: "rb-row " + (item.status || "pending") },
          React.createElement("span", { className: "rb-target" }, item.targetName || item.id || "-"),
          React.createElement("span", { className: "rb-action" }, item.action || "-"),
          React.createElement(Spill, { tone: tone }, item.status || "pending"),
          React.createElement("span", { className: "rb-time" }, item.queuedAt || "-")
        );
      })
    : React.createElement("div", { className: "empty" }, "No actions queued");
  const rbEls = readbacks.length > 0
    ? readbacks.slice(0, 10).map(function (rb) {
        return React.createElement("div", { key: rb.id, className: "rb-row " + (rb.verified ? "verified" : "pending") },
          React.createElement("span", { className: "rb-target" }, rb.targetName || rb.id || "-"),
          React.createElement("span", { className: "rb-action" }, rb.action || "-"),
          React.createElement(Spill, { tone: rb.verified ? "s" : "w" }, rb.verified ? "Verified" : "Pending")
        );
      })
    : React.createElement("div", { className: "empty" }, "No readback records");
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, {
      title: "Readback & Execution",
      subtitle: execCounts.pending + " queued  " + execCounts.verified + " verified  " + readbackCounts.waiting + " waiting"
    }),
    React.createElement(Block, { title: "Execution Pipeline" },
      React.createElement("div", { className: "rb-pipeline" }, pipelineEls)
    ),
    React.createElement(Block, { title: "Execution Queue (" + queue.length + ")" }, queueEls),
    React.createElement(Block, { title: "Recent Readbacks (" + readbacks.length + ")" }, rbEls)
  );
}
''')

# ====== Part 11: Growth pages ======
write(r'''
function KeywordsPage(props) {
  const store = props.ctx.store;
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
    const oppTone = k.opportunity === "high" ? "s" : k.opportunity === "medium" ? "w" : "n";
    return {
      term: k.term || k.keyword || "-",
      matchType: k.matchType || "-",
      clicks: k.clicks != null ? String(k.clicks) : "-",
      orders: k.orders != null ? String(k.orders) : "-",
      acos: k.acos != null ? formatPercent(k.acos) : "-",
      opportunity: React.createElement(Spill, { tone: oppTone }, k.opportunity || "low"),
    };
  });
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, {
      title: "Keyword Opportunities",
      subtitle: keywords.length + " terms derived from imported metrics"
    }),
    React.createElement(Block, null, React.createElement(DataTable, { columns: cols, rows: rows }))
  );
}

function ListingPage(props) {
  const store = props.ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Listing" }));
  const listing = store.listing || {};
  const productName = listing.productName || ((store.products && store.products[0] && store.products[0].name) || "-");
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, { title: "Listing Drafts", subtitle: productName }),
    React.createElement(Block, { title: "Title Draft" },
      React.createElement("div", { className: "listing-draft" }, listing.title || "-")
    ),
    React.createElement(Block, { title: "Bullet Points" },
      (listing.bullets || []).map(function (b, i) {
        return React.createElement("div", { key: i, className: "listing-bullet" }, b || "-");
      })
    ),
    React.createElement(Block, { title: "Backend Keywords" },
      React.createElement("div", { className: "listing-keywords" }, listing.backend || "-")
    )
  );
}
''')

# ====== Part 12: Stores, System pages ======
write(r'''
function StoresPage(props) {
  const stores = props.ctx.appState.stores;
  const activeStoreId = props.ctx.activeStoreId;
  if (!stores) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Stores" }));
  const cols = [
    { key: "name", label: "Name", width: "auto" },
    { key: "marketplaceCode", label: "Region", width: "70px" },
    { key: "marketplace", label: "Marketplace", width: "auto" },
    { key: "sessionStatus", label: "Session", width: "80px" },
    { key: "productCount", label: "Products", width: "70px" },
    { key: "lastCollection", label: "Last Pull", width: "auto" },
    { key: "actions", label: "", width: "80px" },
  ];
  const rows = Object.values(stores).map(function (s) {
    const sessionTone = s.sessionStatus === "active" ? "s" : s.sessionStatus === "warning" ? "w" : "n";
    const isActive = s.id === activeStoreId;
    return {
      name: s.name || "-",
      marketplaceCode: s.marketplaceCode || "-",
      marketplace: s.marketplace || "-",
      sessionStatus: React.createElement(Spill, { tone: sessionTone }, s.sessionStatus || "-"),
      productCount: (s.products && s.products.length) || 0,
      lastCollection: s.lastCollection || s.lastPullAt || "-",
      actions: React.createElement("button", {
        className: "btn sm " + (isActive ? "p" : "g"),
        onClick: function () { props.ctx.setAppState(function (prev) { return selectStore(prev, s.id); }); },
        type: "button"
      }, isActive ? "Current" : "Activate"),
    };
  });
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, { title: "Store Management", subtitle: Object.keys(stores).length + " stores configured" }),
    React.createElement(Block, null, React.createElement(DataTable, { columns: cols, rows: rows }))
  );
}

function SettingsPage(props) {
  const store = props.ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Settings" }));
  const aiProvider = store.aiProvider || {};
  const modeEls = AI_MODES.map(function (m) {
    const Icon = m.icon;
    const isActive = props.ctx.aiMode === m.id;
    return React.createElement("button", {
      key: m.id,
      className: "mode-card " + (isActive ? "a" : ""),
      style: { "--mc": m.color },
      onClick: function () { props.ctx.pushToast("Mode change to " + m.label + " simulated", { tone: "info" }); },
      type: "button"
    },
      React.createElement(Icon, { size: 14, weight: "fill" }),
      React.createElement("span", null, m.label)
    );
  });
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, { title: "Settings", subtitle: "Local configuration and AI provider" }),
    React.createElement(Block, { title: "AI Provider" },
      React.createElement("div", { className: "setting-row" },
        React.createElement("span", { className: "sr-l" }, "Provider"),
        React.createElement("span", { className: "sr-v" }, aiProvider.provider || "-")
      ),
      React.createElement("div", { className: "setting-row" },
        React.createElement("span", { className: "sr-l" }, "Model"),
        React.createElement("span", { className: "sr-v" }, aiProvider.model || "-")
      )
    ),
    React.createElement(Block, { title: "Execution Mode" },
      React.createElement("div", { className: "mode-row" }, modeEls)
    )
  );
}

function SchedulerPage(props) {
  const store = props.ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Scheduler" }));
  const tasks = store.scheduler || [];
  const rows = tasks.map(function (t) {
    return React.createElement("div", { key: t.id, className: "sched-row" },
      React.createElement("span", { className: "sched-name" }, t.name || t.id || "-"),
      React.createElement("span", { className: "sched-cron" }, t.cron || "-"),
      React.createElement(Spill, { tone: t.enabled ? "s" : "n" }, t.enabled ? "Enabled" : "Disabled"),
      React.createElement("span", { className: "sched-last" }, t.lastRun || "-")
    );
  });
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, { title: "Scheduler", subtitle: tasks.length + " local tasks" }),
    React.createElement(Block, null, rows.length > 0 ? rows : React.createElement("div", { className: "empty" }, "No scheduled tasks"))
  );
}

function DeliveryPage(props) {
  const store = props.ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Delivery" }));
  const gates = store.deliveryGates || [];
  const allPassed = gates.length > 0 && gates.every(function (g) { return g.passed; });
  const status = allPassed ? "ready" : "blocked";
  const gateEls = gates.map(function (g) {
    return React.createElement("div", { key: g.id, className: "gate-row " + (g.passed ? "passed" : "blocked") },
      React.createElement("span", { className: "gate-name" }, g.label || g.id || "-"),
      React.createElement(Spill, { tone: g.passed ? "s" : "d" }, g.passed ? "Passed" : "Blocked"),
      React.createElement("span", { className: "gate-meta" }, g.meta || "-")
    );
  });
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, { title: "Delivery Readiness", subtitle: "Status: " + status }),
    React.createElement(Block, null,
      gateEls.length > 0 ? gateEls : React.createElement("div", { className: "empty" }, "No delivery gates")
    ),
    React.createElement("div", { className: "sim-notice" },
      "Simulated delivery state. Production needs real evidence and verify run."
    )
  );
}
''')

# ====== Part 13: Context Panel ======
write(r'''
function ContextPanel(props) {
  const [tab, setTab] = useState("chain");
  return React.createElement("div", { className: "ctx-panel" },
    React.createElement("div", { className: "ctx-tabs" },
      React.createElement("button", { className: "ctx-tab " + (tab === "chain" ? "a" : ""),
        onClick: function () { setTab("chain"); }, type: "button" }, "Main Chain"),
      React.createElement("button", { className: "ctx-tab " + (tab === "data" ? "a" : ""),
        onClick: function () { setTab("data"); }, type: "button" }, "Data Instances"),
      React.createElement("button", { className: "ctx-tab " + (tab === "logs" ? "a" : ""),
        onClick: function () { setTab("logs"); }, type: "button" }, "Logs")
    ),
    React.createElement("div", { className: "ctx-body" },
      tab === "chain" && React.createElement(ChainTab, { ctx: props.ctx }),
      tab === "data" && React.createElement(DataTab, { ctx: props.ctx }),
      tab === "logs" && React.createElement(LogsTab, { ctx: props.ctx })
    )
  );
}

function ChainTab(props) {
  const doneCount = Object.values(props.ctx.mission.phases).filter(function (p) { return p.status === "done"; }).length;
  const current = MISSION_PHASES.find(function (p) { return p.id === props.ctx.mission.currentPhaseId; });
  const rows = MISSION_PHASES.map(function (p) {
    const status = (props.ctx.mission.phases[p.id] && props.ctx.mission.phases[p.id].status) || "pending";
    const Icon = p.icon;
    return React.createElement("div", { key: p.id, className: "chain-item " + status },
      React.createElement("span", { className: "ci-dot" },
        status === "done" ? React.createElement(Check, { size: 9, weight: "bold" }) : React.createElement(Icon, { size: 9 })
      ),
      React.createElement("span", { className: "ci-lbl" }, p.label),
      p.humanCheckpoint && React.createElement(HandWaving, { size: 9, weight: "fill" })
    );
  });
  return React.createElement("div", { className: "chain-tab" },
    React.createElement("div", { className: "chain-summary" },
      React.createElement("span", { className: "cs-label" }, "Phase Progress"),
      React.createElement("span", { className: "cs-val" }, doneCount + "/" + MISSION_PHASES.length)
    ),
    React.createElement("div", { className: "chain-list" }, rows),
    current && React.createElement("div", { className: "chain-current" },
      React.createElement("span", { className: "cc-lbl" }, "Now"),
      React.createElement("span", { className: "cc-name" }, current.label),
      React.createElement("p", { className: "cc-desc" }, current.desc)
    )
  );
}

function DataTab(props) {
  const store = props.ctx.store;
  if (!store) return React.createElement("div", { className: "empty" }, "No data");
  const items = [
    ["Products", (store.products && store.products.length) || 0],
    ["Reports Imported", (store.reports || []).filter(function (r) { return r.status === "imported"; }).length],
    ["Diagnostics", (store.diagnostics && store.diagnostics.length) || 0],
    ["Recommendations", (store.recommendations && store.recommendations.length) || 0],
    ["Execution Queue", (store.executionQueue && store.executionQueue.length) || 0],
    ["Readbacks", (store.readbacks && store.readbacks.length) || 0],
    ["Ledger Entries", (store.ledger && store.ledger.length) || 0],
  ].map(function (pair) {
    return React.createElement("div", { key: pair[0], className: "dt-row" },
      React.createElement("span", { className: "dt-lbl" }, pair[0]),
      React.createElement(Spill, { tone: "n" }, pair[1])
    );
  });
  return React.createElement("div", { className: "data-tab" }, items);
}

function LogsTab(props) {
  const donePhases = Object.entries(props.ctx.mission.phases)
    .filter(function (kv) { return kv[1].status === "done"; })
    .slice(-5);
  const rows = donePhases.length > 0
    ? donePhases.map(function (kv) {
        return React.createElement("div", { key: kv[0], className: "log-row" },
          React.createElement("span", { className: "log-time" }, kv[1].endedAt || "-"),
          React.createElement("span", { className: "log-msg" }, "Phase " + kv[0] + " completed (" + (kv[1].durationMs || 0) + "ms)")
        );
      })
    : React.createElement("div", { className: "empty" }, "No logs yet");
  return React.createElement("div", { className: "logs-tab" }, rows);
}
''')

# ====== Part 14: DetailDrawer, ToastStack ======
write(r'''
function DetailDrawer(props) {
  if (!props.detail) return null;
  return React.createElement("div", { className: "drawer-overlay", onClick: props.onClose },
    React.createElement("div", { className: "drawer", onClick: function (e) { e.stopPropagation(); } },
      React.createElement("div", { className: "drawer-hd" },
        React.createElement("h3", null, props.detail.title || "Detail"),
        React.createElement("button", {
          className: "drawer-close", onClick: props.onClose, type: "button"
        }, React.createElement(X, { size: 14 }))
      ),
      React.createElement("div", { className: "drawer-body" },
        React.createElement("pre", null, JSON.stringify(props.detail, null, 2))
      )
    )
  );
}

function ToastStack(props) {
  return React.createElement("div", { className: "toast-stack", role: "region", "aria-label": "Notifications" },
    props.toasts.map(function (t) {
      return React.createElement("div", { key: t.id, className: "toast tone-" + t.tone },
        React.createElement(Sparkle, { size: 12 }),
        React.createElement("span", null, t.message)
      );
    })
  );
}
''')

# ====== WRITE TO FILE ======
final = "".join(OUT)
with open(src, "w", encoding="utf-8") as f:
    f.write(final)
print("Written:", len(final), "chars")
