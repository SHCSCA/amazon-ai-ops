#!/usr/bin/env python
# -*- coding: utf-8 -*-
import sys
src = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'

# Build the full content using a list of small parts.
# Each part is a regular string. We carefully escape single/double quotes.

P = []

# ============ HEADER ============
P.append("""/*
 * Amazon AI Ops - Autonomy Prototype (minimal rebuild)
 * English labels only to avoid encoding issues.
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
""")

# ============ CONSTANTS ============
P.append("""
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
""")

# ============ WORKSPACES ============
P.append("""
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
""")

# ============ UI PRIMITIVES ============
P.append(r"""
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
          onClick: function () { props.onRowClick && props.onRowClick(row); }
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
""")

# Write first 4 chunks so we can iterate
final = "".join(P)
with open(src, "w", encoding="utf-8") as f:
    f.write(final)
print("Parts 1-4 written, size:", len(final))
