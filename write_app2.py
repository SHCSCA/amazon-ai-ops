src = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'

# I'll read the current file (which has the broken write from earlier),
# find chunks[], and replace with clean concatenated content.
# But actually the previous Write tool created a partial file from the JSX string.
# Let me just build chunks as plain strings without using triple quotes within triple quotes.

chunks = []

# CHUNK 1
chunks.append('/*\n')
chunks.append(' * Amazon AI Ops - Autonomy Prototype (minimal rebuild)\n')
chunks.append(' * All user-facing strings are English to avoid encoding issues.\n')
chunks.append(' */\n')
chunks.append('import React, { useState, useCallback, useMemo, useRef, useEffect, createContext, useContext } from "react";\n')
chunks.append('import {\n')
chunks.append('  Database, Brain, ShieldCheck, Play, ChartLineUp, Flask, Eye,\n')
chunks.append('  CloudArrowUp, CheckCircle, X, CircleNotch, Lightning, Robot,\n')
chunks.append('  UserCircle, Cube, Package, Lightbulb, Gear, Compass, FileText,\n')
chunks.append('  ListChecks, ChartBar, Stack, ClipboardText, Pulse, Target,\n')
chunks.append('  MagnifyingGlass, Tag, TrendUp, DownloadSimple, UploadSimple,\n')
chunks.append('  WarningOctagon, CheckFat, Clock, CloudCheck, RocketLaunch,\n')
chunks.append('  CalendarBlank, ArrowRight, Sparkle, CaretRight, DotsThree,\n')
chunks.append('  SidebarSimple, ChartLine, Bell, Tray, Warning, List,\n')
chunks.append('  Storefront, Wrench, Graph, ArrowUp, ArrowDown, Check,\n')
chunks.append('  HandWaving, HandPalm, Shield, Prohibit, ListBullets, ArrowsClockwise,\n')
chunks.append('  Question, ClockClockwise, PencilSimpleLine, CheckSquare,\n')
chunks.append('} from "@phosphor-icons/react";\n\n')

chunks.append('import {\n')
chunks.append('  createInitialAppState, selectStore, updateStoreState,\n')
chunks.append('  transitionRecommendation, recordReadback, setExecutionMode,\n')
chunks.append('  selectProduct, appendOperationEvent, getSubviewData,\n')
chunks.append('  buildTimeline, buildLedger, getRecommendationCounts,\n')
chunks.append('  getExecutionCounts, getReadbackCounts, getWorkspaceBadgeCounts,\n')
chunks.append('  getDecisionViews, getReportCoverage, formatMoney, formatPercent,\n')
chunks.append('} from "./model.js";\n\n')

chunks.append('const AI_MODES = [\n')
chunks.append('  { id: "manual", label: "Manual Review", short: "Manual", icon: UserCircle, color: "#64748b" },\n')
chunks.append('  { id: "semi", label: "Semi-Auto", short: "Semi", icon: Lightning, color: "#c8790a" },\n')
chunks.append('  { id: "auto", label: "Policy-Bounded Auto", short: "Auto", icon: Robot, color: "#14965e" },\n')
chunks.append('];\n\n')

chunks.append('const AppContext = createContext(null);\n')
chunks.append('export function useAppStore() {\n')
chunks.append('  const ctx = useContext(AppContext);\n')
chunks.append('  if (!ctx) throw new Error("useAppStore must be inside Provider");\n')
chunks.append('  return ctx;\n')
chunks.append('}\n\n')

# Note: WORKSPACES labels are English
chunks.append('const WORKSPACES = [\n')
chunks.append('  { id: "today", label: "Today", icon: Compass, section: "daily",\n')
chunks.append('    subviews: [{ id: "overview", label: "Overview" }],\n')
chunks.append('    description: "Mission status and outstanding work" },\n')
chunks.append('  { id: "product", label: "Products", icon: Cube, section: "daily",\n')
chunks.append('    subviews: [{ id: "products", label: "Products" }, { id: "targets", label: "Targets" }, { id: "events", label: "Events" }],\n')
chunks.append('    description: "Manage products and target metrics" },\n')
chunks.append('  { id: "data-prep", label: "Data Prep", icon: Database, section: "daily",\n')
chunks.append('    subviews: [{ id: "scope", label: "Scope" }, { id: "reports", label: "Reports" }, { id: "import-check", label: "Import Check" }],\n')
chunks.append('    description: "Collect and validate raw reports" },\n')
chunks.append('  { id: "diagnosis", label: "Diagnosis", icon: Brain, section: "daily",\n')
chunks.append('    subviews: [{ id: "analysis", label: "Analysis" }],\n')
chunks.append('    description: "Quantify and diagnose ad objects" },\n')
chunks.append('  { id: "decisions", label: "Decisions", icon: ShieldCheck, section: "daily",\n')
chunks.append('    subviews: [{ id: "recommendations", label: "Recommendations" }, { id: "approval", label: "Approval" }, { id: "decided", label: "Decided" }],\n')
chunks.append('    description: "AI suggestions and human approvals" },\n')
chunks.append('  { id: "readback", label: "Readback", icon: Play, section: "daily",\n')
chunks.append('    subviews: [{ id: "evidence", label: "Evidence" }],\n')
chunks.append('    description: "Execute approved actions and verify" },\n')
chunks.append('  { id: "growth", label: "Growth", icon: TrendUp, section: "daily",\n')
chunks.append('    subviews: [{ id: "keywords", label: "Keywords" }, { id: "listing", label: "Listing" }],\n')
chunks.append('    description: "Keyword opportunities and listing drafts" },\n')
chunks.append('  { id: "stores", label: "Stores", icon: Storefront, section: "system",\n')
chunks.append('    subviews: [{ id: "list", label: "List" }],\n')
chunks.append('    description: "Manage store configuration" },\n')
chunks.append('  { id: "system", label: "System", icon: Gear, section: "system",\n')
chunks.append('    subviews: [{ id: "settings", label: "Settings" }, { id: "scheduler", label: "Scheduler" }, { id: "delivery", label: "Delivery" }],\n')
chunks.append('    description: "Configuration, scheduling, and final delivery" },\n')
chunks.append('];\n')

final = ''.join(chunks)
with open(src, 'w', encoding='utf-8') as f:
    f.write(final)
print('Part 1 written, size:', len(final))
