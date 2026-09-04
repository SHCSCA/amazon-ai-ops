#!/usr/bin/env python
# -*- coding: utf-8 -*-
src = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'
with open(src, "r", encoding="utf-8") as f: _ = f.read()
P = []

# ============ DECISIONS ============
P.append(r'''
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
  return React.createElement("div", { className: "pg" },
    React.createElement(PageHeader, { title: (activeTab && activeTab.label) || "Decisions", subtitle: viewData.length + " items" }),
    React.createElement("div", { className: "dec-tabs" },
      TABS.map(function (t) {
        return React.createElement("button", {
          key: t.id,
          className: "dec-tab " + (props.view === t.id ? "a" : ""),
          onClick: function () { props.ctx.navigate("decisions", t.sv); },
          type: "button"
        },
          React.createElement("span", null, t.label),
          React.createElement(Spill, { tone: props.view === t.id ? "p" : "n" }, t.count)
        );
      })
    ),
    React.createElement(Block, null,
      rows.length > 0
        ? React.createElement(DataTable, { columns: cols, rows: rows })
        : React.createElement("div", { className: "empty" }, "No items in this view")
    )
  );
}
''')

# ============ READBACK ============
P.append(r'''
function ReadbackPage(props) {
  const store = props.ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Readback" }));
  const execCounts = getExecutionCounts(store);
  const readbackCounts = getReadbackCounts(store);
  const queue = store.executionQueue || [];
  const readbacks = store.readbacks || [];
  const STEPS = [
    { label: "Permission" }, { label: "Queued" }, { label: "Running" }, { label: "Awaiting Readback" }, { label: "Verified" },
  ];

  const pipelineEls = STEPS.map(function (s, i) {
    const stepClass = i === 0 ? "active" : i < 3 ? "done" : "pending";
    return React.createElement(React.Fragment, { key: s.label },
      React.createElement("div", { className: "rb-step " + stepClass },
        React.createElement("div", { className: "rb-num" }, i + 1),
        React.createElement("span", { className: "rb-lbl" }, s.label)
      ),
      i < STEPS.length - 1 && React.createElement("div", { className: "rb-arrow" }, React.createElement(CaretRight, { size: 11 }))
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
      subtitle: execCounts.pending + " queued . " + execCounts.verified + " verified . " + readbackCounts.waiting + " waiting"
    }),
    React.createElement(Block, { title: "Execution Pipeline" },
      React.createElement("div", { className: "rb-pipeline" }, pipelineEls)
    ),
    React.createElement(Block, { title: "Execution Queue (" + queue.length + ")" }, queueEls),
    React.createElement(Block, { title: "Recent Readbacks (" + readbacks.length + ")" }, rbEls)
  );
}
''')

# ============ GROWTH ============
P.append(r'''
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
    React.createElement(PageHeader, { title: "Keyword Opportunities", subtitle: keywords.length + " terms derived from imported metrics" }),
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

# ============ STORES ============
P.append(r'''
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
''')

# ============ SYSTEM ============
P.append(r'''
function SettingsPage(props) {
  const store = props.ctx.store;
  if (!store) return React.createElement("div", { className: "pg" }, React.createElement(PageHeader, { title: "Settings" }));
  const aiProvider = store.aiProvider || {};
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
      React.createElement("div", { className: "mode-row" },
        AI_MODES.map(function (m) {
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
        })
      )
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
      "Simulated delivery state. Production needs real evidence + verify run."
    )
  );
}
''')

final = "".join(P)
with open(src, "a", encoding="utf-8") as f:
    f.write(final)
print("Part 3 appended, size:", len(final))
