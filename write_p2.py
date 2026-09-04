#!/usr/bin/env python
# -*- coding: utf-8 -*-
# Append Part 2 to App.jsx

src = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'

with open(src, "r", encoding="utf-8") as f:
    current = f.read()

P = []

# ============ PAGE ROUTER ============
P.append(r'''
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

# ============ MISSION TIMELINE ============
P.append(r'''
function MissionTimeline(props) {
  const [expanded, setExpanded] = useState(false);
  const currentPhase = MISSION_PHASES.find(function (p) { return p.id === props.mission.currentPhaseId; });
  const doneCount = Object.values(props.mission.phases).filter(function (p) { return p.status === "done"; }).length;
  const total = MISSION_PHASES.length;

  const stepEls = MISSION_PHASES.slice(0, 8).map(function (p) {
    const data = props.mission.phases[p.id];
    const status = (data && data.status) || "pending";
    const Icon = p.icon;
    return React.createElement("div", { key: p.id, className: "mbar-step " + status },
      React.createElement("span", { className: "mbar-dot" },
        status === "done" ? React.createElement(Check, { size: 9, weight: "bold" })
          : status === "active" ? React.createElement(CircleNotch, { size: 9, className: "spin" })
          : React.createElement(Icon, { size: 9 })
      ),
      React.createElement("span", { className: "mbar-lbl" }, p.label)
    );
  });

  const expandRows = MISSION_PHASES.map(function (p) {
    const data = props.mission.phases[p.id];
    const status = (data && data.status) || "pending";
    const Icon = p.icon;
    const statusLabel = status === "done" ? "Done" : status === "active" ? "Active" : status === "waiting" ? "Waiting" : "Pending";
    return React.createElement("div", { key: p.id, className: "mbe-phase " + status },
      React.createElement("div", { className: "mbe-dot" },
        status === "done" ? React.createElement(Check, { size: 9, weight: "bold" })
          : React.createElement(Icon, { size: 9 })
      ),
      React.createElement("div", { className: "mbe-info" },
        React.createElement("div", { className: "mbe-hd" },
          React.createElement("span", { className: "mbe-name" }, p.label),
          React.createElement("span", { className: "mbe-status " + status }, statusLabel)
        ),
        React.createElement("span", { className: "mbe-desc" }, p.desc)
      )
    );
  });

  return React.createElement("div", { className: "mbar " + (expanded ? "ex" : "") },
    React.createElement("div", { className: "mbar-l" },
      React.createElement(RocketLaunch, { size: 14, weight: "fill", className: "mbar-icon" }),
      React.createElement("span", { className: "mbar-title" }, "Mission"),
      React.createElement("div", { className: "mbar-steps" }, stepEls),
      React.createElement("span", { className: "mbar-prog" }, doneCount + "/" + total)
    ),
    React.createElement("div", { className: "mbar-r" },
      currentPhase && React.createElement("span", { className: "mbar-cur" },
        React.createElement("span", { className: "mbar-cur-lbl" }, "Now"),
        React.createElement("span", { className: "mbar-cur-val" }, currentPhase.label),
        currentPhase.humanCheckpoint && React.createElement(HandWaving, { size: 11, weight: "fill" })
      ),
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

# ============ TODAY PAGE ============
P.append(r'''
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
    const Icon = t.icon;
    return React.createElement("div", {
      key: i,
      className: "todo-i tone-" + t.tone + " lnk",
      onClick: function () { props.ctx.navigate(t.ws, t.sv); }
    },
      React.createElement(Icon, { size: 14 }),
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
      subtitle: (store.name || "Store") + " . " + (store.scope && store.scope.dateTo || "-")
    }),
    React.createElement(KpiGrid, null, kpis.map(function (k) { return React.createElement(KpiCard, Object.assign({ key: k.label }, k)); })),
    tasks.length > 0 && React.createElement(Block, { title: "Outstanding Work (" + tasks.length + ")" }, taskEls),
    timelineEls && timelineEls.length > 0 && React.createElement(Block, { title: "Today Timeline" }, timelineEls)
  );
}
''')

# ============ PRODUCT PAGES ============
P.append(r'''
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
      stage: React.createElement(Spill, { tone: "n" }, p.stage),
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
      React.createElement("span", { className: "ev-time" }, e.at),
      React.createElement("span", { className: "ev-title" }, e.title),
      React.createElement(Spill, { tone: "n" }, e.scope || "store")
    );
  });
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, { title: "Operation Events", subtitle: events.length + " annotated events" }),
    React.createElement(Block, null, rows.length > 0 ? rows : React.createElement("div", { className: "empty" }, "No events"))
  );
}
''')

# ============ DATA PREP PAGES ============
P.append(r'''
function ScopePage(props) {
  const store = props.ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Scope" }));
  const s = store.scope || {};
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, { title: "Operation Scope", subtitle: "Store " + (store.id || "-") + " / " + (store.marketplaceCode || "-") }),
    React.createElement(Block, null,
      React.createElement("div", { className: "scope-grid" },
        ["Date From", "dateFrom"].map(function (pair, i) {
          const label = typeof pair === "string" ? pair : pair[0];
          const key = typeof pair === "string" ? pair.toLowerCase().replace(" ", "") : pair[1];
          return React.createElement("div", { key: i, className: "scope-field" },
            React.createElement("span", { className: "sf-l" }, label),
            React.createElement("span", { className: "sf-v" }, s[key] || "-")
          );
        }),
        React.createElement("div", { className: "scope-field" },
          React.createElement("span", { className: "sf-l" }, "Date To"),
          React.createElement("span", { className: "sf-v" }, s.dateTo || "-")
        ),
        React.createElement("div", { className: "scope-field" },
          React.createElement("span", { className: "sf-l" }, "Marketplace"),
          React.createElement("span", { className: "sf-v" }, store.marketplace || "-")
        ),
        React.createElement("div", { className: "scope-field" },
          React.createElement("span", { className: "sf-l" }, "Products"),
          React.createElement("span", { className: "sf-v" }, (store.products && store.products.length) || 0)
        ),
        React.createElement("div", { className: "scope-field" },
          React.createElement("span", { className: "sf-l" }, "Source Files"),
          React.createElement("span", { className: "sf-v" }, (store.importRun && store.importRun.sourceFiles) || 0)
        ),
        React.createElement("div", { className: "scope-field" },
          React.createElement("span", { className: "sf-l" }, "Import Status"),
          React.createElement("span", { className: "sf-v" }, (store.importRun && store.importRun.reconciliation) || "-")
        )
      )
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
    return {
      label: r.label || r.grain || r.id || "-",
      grain: r.grain || "-",
      importedRows: r.importedRows != null ? String(r.importedRows) : "-",
      checksum: r.checksum ? React.createElement("code", { style: { fontSize: "11px" } }, String(r.checksum).slice(0, 24) + "...") : "-",
      status: React.createElement(Spill, { tone: r.status === "imported" ? "s" : r.status === "missing" ? "d" : "n" }, r.status || "-"),
    };
  });
  const pct = Math.round((coverage.available / coverage.expected) * 100);
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, { title: "Report Collection", subtitle: coverage.available + "/" + coverage.expected + " types . " + coverage.importLabel }),
    React.createElement(Block, null,
      React.createElement("div", { className: "coverage-bar" },
        React.createElement("div", { className: "cb-fill", style: { width: pct + "%" } }),
        React.createElement("span", { className: "cb-lbl" }, coverage.available + "/" + coverage.expected)
      ),
      React.createElement(DataTable, { columns: cols, rows: rows })
    ),
    React.createElement("div", { className: "sim-notice" }, "Simulated data only. Production pulls from Lingxing download center.")
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
    { n: ir.reportTypesImported || "-", l: "Types Imported" },
    { n: totalImported.toLocaleString(), l: "Rows Imported" },
    { n: totalRejected, l: "Rows Rejected" },
    { n: ir.duplicateRows || "-", l: "Duplicates" },
    { n: ir.reconciliation || "-", l: "Reconciliation" },
  ];
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, {
      title: "Import Check",
      subtitle: (ir.reportTypesImported || 0) + " types . " + totalImported.toLocaleString() + " rows . " + totalRejected + " rejected"
    }),
    React.createElement(Block, null,
      React.createElement("div", { className: "import-summary" },
        items.map(function (item, i) {
          return React.createElement("div", { key: i, className: "is-item" },
            React.createElement("span", { className: "is-n" }, item.n),
            React.createElement("span", { className: "is-l" }, item.l)
          );
        })
      )
    )
  );
}
''')

# ============ DIAGNOSIS PAGE ============
P.append(r'''
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
  const filterOpts = [
    { value: "all", label: "All (" + diag.length + ")" },
    { value: "high", label: "High Risk", warn: true },
    { value: "scale", label: "Opportunity" },
    { value: "review", label: "Review" },
  ];
  const hiRisk = diag.filter(function (d) { return d.severity === "high"; }).length;
  const opps = diag.filter(function (d) { return d.quantStatus === "opportunity"; }).length;
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, {
      title: "Ad Diagnosis",
      subtitle: diag.length + " objects . " + hiRisk + " high risk . " + opps + " opportunities"
    }),
    React.createElement(Filters, { active: filter, onChange: setFilter, options: filterOpts }),
    React.createElement(Block, null, React.createElement(DataTable, { columns: cols, rows: rows }))
  );
}
''')

final = "".join(P)
with open(src, "a", encoding="utf-8") as f:
    f.write(final)
print("Part 2 appended, new size:", len(final))
