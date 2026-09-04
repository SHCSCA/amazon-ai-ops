import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  ArrowRight,
  Browser,
  ChartLineUp,
  Check,
  CheckCircle,
  CircleNotch,
  Database,
  Flask,
  Gear,
  ListChecks,
  LockKey,
  MagnifyingGlass,
  Pause,
  Play,
  Plus,
  Robot,
  ShieldCheck,
  Sparkle,
  Storefront,
  Target,
  WarningCircle,
} from "@phosphor-icons/react";
import { getConnectionState, resolveCurrentRun } from "./prototype-domain.js";
import {
  adObjectTableRow,
  businessGroupPath,
  businessGroupTransitions,
  recommendationTableRow,
} from "./prototype-presenters.js";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("zh-CN");
const READBACK_MISMATCH_STATUSES = new Set(["mismatch", "readback_mismatch", "readback_failed", "blocked_readback"]);

function money(value) {
  return Number.isFinite(Number(value)) ? usd.format(Number(value)) : "—";
}

function percent(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return `${(Math.abs(numeric) <= 1 ? numeric * 100 : numeric).toFixed(digits).replace(/\.0$/, "")}%`;
}

function storeLabel(store) {
  return store?.storeName || store?.name || "当前店铺";
}

function productLabel(store) {
  const selected = store?.products?.find((item) => item.id === (store.selectedProductId || store.scope?.selectedProductId));
  return selected ? `${selected.sku} · ${selected.title}` : "全部产品";
}

function selectedProduct(store) {
  const selectedId = store?.selectedProductId || store?.scope?.selectedProductId;
  return store?.products?.find((item) => item.id === selectedId) || null;
}

function diagnosticBelongsToProduct(item, product) {
  if (!item || !product) return false;
  const productId = String(product.id || "").trim().toLowerCase();
  const productAsin = String(product.asin || "").trim().toLowerCase();
  const itemProductId = String(item.productId || "").trim().toLowerCase();
  const itemProductAsin = String(item.productAsin || item.asin || "").trim().toLowerCase();
  if (productId && itemProductId && productId === itemProductId) return true;
  if (productAsin && itemProductAsin && productAsin === itemProductAsin) return true;
  return productAsin
    ? String(item.objectKey || "")
        .split("|")
        .some((token) => token.trim().toLowerCase() === productAsin)
    : false;
}

function diagnosticsForSelectedProduct(store) {
  const product = selectedProduct(store);
  return product ? (store?.diagnostics || []).filter((item) => diagnosticBelongsToProduct(item, product)) : [];
}

function adObjectSelection(runtime) {
  const selectedKey = runtime?.selectedAdObjectKey
    || runtime?.selectedObjectKey
    || runtime?.adObjectSelection?.objectKey
    || null;
  const verifiedKeys = new Set([
    ...(runtime?.verifiedAdObjectKeys || []),
    ...(runtime?.verifiedObjectKeys || []),
    runtime?.verifiedAdObjectKey,
    runtime?.adObjectSelection?.verifiedObjectKey,
    runtime?.adObjectSelection?.verified ? selectedKey : null,
  ].filter(Boolean));
  return { selectedKey, verifiedKeys };
}

function displayTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function displayDataWindow(run) {
  if (!run?.dataWindow) return "数据窗口未记录";
  if (typeof run.dataWindow === "string") return run.dataWindow;
  const from = run.dataWindow.dateFrom || run.dataWindow.from || run.dataWindow.start;
  const to = run.dataWindow.dateTo || run.dataWindow.to || run.dataWindow.end;
  return from && to ? `${from} 至 ${to}` : "数据窗口未记录";
}

function runScopeLabel(run) {
  return [run?.storeLabel || "店铺快照未记录", run?.productLabel || "产品快照未记录", displayDataWindow(run)].join(" · ");
}

function connectionView(store) {
  const truth = getConnectionState(store);
  return {
    ...truth,
    ready: truth.erpReady && truth.adsReady && truth.storeIdentityReady,
    label: truth.erpReady
      ? truth.adsReady && truth.storeIdentityReady
        ? "ERP 与 Ads 已连接，当前店铺已确认"
        : "ERP 已连接，Ads 尚待识别或确认"
      : "ERP 与 Ads 当前连接尚未建立",
  };
}

function safeLedgerText(value, store) {
  const storeName = storeLabel(store);
  return String(value || "—")
    .replace(/batch_[A-Za-z0-9_-]+/gi, "当前数据批次")
    .replace(/\b(?:SHC001|LMX002|NOC003)\b/g, storeName)
    .replace(/\b(?:REC|ACT|POL)-[A-Za-z0-9_-]+\b/gi, "当前业务记录")
    .replace(/\brev(?:ision)?\s*\d+\b/gi, "历史版本")
    .replace(/(?:profile-)[A-Za-z0-9_-]+/gi, "当前店铺浏览器");
}

function Tone({ tone = "neutral", children }) {
  return <span className={`ops-pill is-${tone}`}>{children}</span>;
}

function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="ops-page-header">
      <div>
        <span className="ops-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="ops-page-actions">{actions}</div>}
    </header>
  );
}

function Button({ primary = false, danger = false, icon: Icon, busy = false, children, ...props }) {
  return (
    <button aria-busy={busy || undefined} className={`ops-button ${primary ? "is-primary" : ""} ${danger ? "is-danger" : ""}`.trim()} type="button" {...props}>
      {busy ? <CircleNotch className="ops-spin" size={16} /> : Icon ? <Icon size={16} /> : null}
      <span>{children}</span>
    </button>
  );
}

function Panel({ title, meta, actions, children, tone = "default", className = "" }) {
  return (
    <section className={`ops-panel is-${tone} ${className}`.trim()}>
      <header>
        <div><h2>{title}</h2>{meta && <p>{meta}</p>}</div>
        {actions && <div className="ops-panel-actions">{actions}</div>}
      </header>
      <div className="ops-panel-body">{children}</div>
    </section>
  );
}

function Metrics({ items }) {
  return (
    <dl className="ops-metrics">
      {items.map((item) => (
        <div key={item.label} className={item.tone ? `is-${item.tone}` : ""}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          {item.detail && <small>{item.detail}</small>}
        </div>
      ))}
    </dl>
  );
}

function Table({ columns, rows, rowKey = "id", onSelect, selectedId, empty = "当前范围没有记录", className = "", groupBy }) {
  return (
    <div className="ops-table-wrap">
      <table className={`ops-table ${className}`.trim()}>
        <thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
        <tbody>
          {businessGroupTransitions(rows, groupBy || (() => [])).flatMap(({ row, groups }, index) => {
            const key = row[rowKey] || index;
            const dataRow = (
              <tr
                aria-selected={selectedId === key}
                className={selectedId === key ? "is-selected" : ""}
                key={key}
                onClick={() => onSelect?.(row)}
                onKeyDown={(event) => {
                  if (!onSelect || !["Enter", " "].includes(event.key)) return;
                  event.preventDefault();
                  onSelect(row);
                }}
                tabIndex={onSelect ? 0 : undefined}
              >
                {columns.map((column) => <td key={column.key}>{column.render ? column.render(row[column.key], row) : row[column.key]}</td>)}
              </tr>
            );
            return [
              ...groups.map((group) => (
                <tr className={`ops-table-group is-${group.level}`} key={`${key}-group-${group.key}`}>
                  <th colSpan={columns.length} scope="rowgroup">{group.label}</th>
                </tr>
              )),
              dataRow,
            ];
          })}
          {!rows.length && <tr><td className="ops-empty-cell" colSpan={columns.length}>{empty}</td></tr>}
        </tbody>
      </table>
      <div className="ops-table-status" role="status">显示 {rows.length} 条当前店铺记录</div>
    </div>
  );
}

function BusinessObjectCell({ row }) {
  const detail = [row.level, row.targetingType !== "不适用" ? row.targetingType : null].filter(Boolean).join(" · ");
  return <span className="ops-business-object"><b>{row.object}</b>{detail && <small>{detail}</small>}</span>;
}

function EmptyState({ title, detail, action }) {
  return <div className="ops-empty"><Database size={28} /><b>{title}</b><span>{detail}</span>{action}</div>;
}

function RunBadge({ run }) {
  if (!run) return <Tone tone="warning">尚未分析</Tone>;
  if (run.status === "running") return <Tone tone="info"><CircleNotch className="ops-spin" size={13} /> 分析中</Tone>;
  if (run.status === "blocked") return <Tone tone="danger">分析已阻断</Tone>;
  if (run.status === "superseded") return <Tone>已被新分析替代</Tone>;
  return <Tone tone="success">分析完成</Tone>;
}

function Today({ store, runtime, coverage, gate, actions }) {
  const run = resolveCurrentRun(runtime);
  const recommendations = runtime.activeRecommendations || [];
  const pending = recommendations.filter((item) => ["waiting_approval", "pending_review", "pending_approval"].includes(item.status));
  const runCompleted = run?.status === "completed";
  const runBlocked = run?.status === "blocked";
  const readback = runtime.executionRecords?.filter((item) => item.status === "awaiting_readback") || [];
  const failedReadbacks = runtime.executionRecords?.filter((item) => READBACK_MISMATCH_STATUSES.has(item.status)) || [];
  const verifiedReadbacks = runtime.executionRecords?.filter((item) => item.status === "verified") || [];
  const connection = connectionView(store);
  const currentStep = !coverage.importComplete ? "补齐数据" : !connection.ready ? "修复连接" : run?.status === "running" ? "等待分析完成" : pending.length ? "处理建议" : gate.allowed ? "执行已授权动作" : failedReadbacks.length ? "处理回读不一致" : readback.length ? "完成回读" : verifiedReadbacks.length ? "建立经营实验" : "运行新分析";
  const nextRoute = gate.allowed
    ? { workspace: "execution", subview: "live" }
    : readback.length || failedReadbacks.length
      ? { workspace: "execution", subview: "live" }
      : verifiedReadbacks.length
        ? { workspace: "execution", subview: "experiments" }
      : gate.nextRoute || (pending.length ? { workspace: "decisions", subview: "recommendations" } : { workspace: "assets", subview: "collection" });
  const phases = [
    { label: "店铺与连接", detail: connection.label, done: connection.ready, active: !connection.ready },
    { label: "8 类数据采集", detail: `${coverage.imported}/${coverage.expected} 类已入库`, done: coverage.importComplete },
    { label: "本次分析", detail: run ? `第 ${run.ordinal || runtime.analysisRuns.length} 次 · ${run.status === "running" ? "正在运行" : runBlocked ? "已阻断" : runCompleted ? "已完成" : "等待处理"}` : "尚未运行", done: runCompleted, active: run?.status === "running" || runBlocked },
    { label: "建议与审批", detail: !runCompleted ? "等待分析成功" : pending.length ? `${pending.length} 条待处理` : recommendations.length ? "已处理" : "本次无建议", done: runCompleted && pending.length === 0, active: runCompleted && pending.length > 0 },
    { label: "实时执行与回读", detail: failedReadbacks.length ? "刷新值与保存值不一致，已阻断" : readback.length ? "等待刷新回读" : verifiedReadbacks.length ? "本次回读已验证" : gate.allowed ? "已具备执行条件" : gate.reasons?.[0] || "等待许可", done: verifiedReadbacks.length > 0 && readback.length === 0 && failedReadbacks.length === 0, active: gate.allowed || readback.length > 0 || failedReadbacks.length > 0 },
    { label: "经营实验与因果记忆", detail: `${runtime.experiments?.length || 0} 个实验 · ${runtime.causalMemories?.length || 0} 条记忆`, done: Boolean(runtime.experiments?.some((item) => item.status === "completed")) },
  ];

  return (
    <>
      <PageHeader
        eyebrow={`${storeLabel(store)} · Amazon 美国站 / USD`}
        title="今日任务"
        description="一眼看清现在做到哪一步、为什么停住，以及下一步该做什么。"
        actions={<Button primary icon={ArrowRight} onClick={() => actions.navigate(nextRoute.workspace, nextRoute.subview)}>继续：{currentStep}</Button>}
      />

      <section className="ops-focus-card">
        <div className="ops-focus-icon"><Sparkle size={22} weight="fill" /></div>
        <div className="ops-focus-copy">
          <span>当前主任务</span>
          <h2>{run?.status === "running" ? "正在生成本次分析结果" : runBlocked ? `第 ${run.ordinal || runtime.analysisRuns.length} 次分析被阻断` : runCompleted ? `第 ${run.ordinal || runtime.analysisRuns.length} 次分析已完成` : "先运行一次可追溯分析"}</h2>
          <p>{run?.status === "running" ? `当前阶段：${run.currentPhaseLabel || "量化并生成建议"}` : runBlocked ? run.blockedReason || run.summary || "本次输入未满足分析条件，系统没有发布建议。" : run?.summary || "系统会把数据范围、策略版本、模型版本和建议结果绑定为一次独立运行。"}</p>
        </div>
        <div className="ops-focus-meta">
          <RunBadge run={run} />
          <small>{run?.completedAt ? `${runBlocked ? "阻断于" : "完成于"} ${displayTime(run.completedAt)}` : `数据窗口 ${store.scope?.dateFrom} 至 ${store.scope?.dateTo}`}</small>
        </div>
      </section>

      <Metrics items={[
        { label: "ACOS / 目标", value: `${percent(store.metrics?.acos)} / ${percent(store.metrics?.targetAcos)}`, detail: store.metrics?.acos > store.metrics?.targetAcos ? "高于目标，需要处理" : "在目标内", tone: store.metrics?.acos > store.metrics?.targetAcos ? "warning" : "success" },
        { label: "事实就绪", value: `${coverage.imported}/${coverage.expected}`, detail: `${number.format(coverage.importedRows || 0)} 行`, tone: coverage.importComplete ? "success" : "warning" },
        { label: "待处理建议", value: `${pending.length} 条`, detail: runCompleted ? "只显示本次分析有效版本" : "分析未成功，不发布建议", tone: runCompleted ? pending.length ? "info" : "success" : "warning" },
        { label: "执行与回读", value: gate.allowed ? "可执行" : "安全阻断", detail: gate.allowed ? "许可与对象均已核验" : gate.reasons?.[0] || "等待前置条件", tone: gate.allowed ? "success" : "warning" },
      ]} />

      <div className="ops-grid ops-grid-main">
        <Panel title="今日闭环" meta="每一步都有来源、结果和下一步" tone="primary">
          <ol className="ops-phase-list">
            {phases.map((phase, index) => (
              <li className={`${phase.done ? "is-done" : ""} ${phase.active ? "is-active" : ""}`.trim()} key={phase.label}>
                <span className="ops-phase-index">{phase.done ? <Check size={13} /> : index + 1}</span>
                <div><b>{phase.label}</b><small>{phase.detail}</small></div>
                <Tone tone={phase.done ? "success" : phase.active ? "info" : "neutral"}>{phase.done ? "完成" : phase.active ? "当前" : "等待"}</Tone>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="需要你介入" meta="只列会阻断结果的事项">
          <div className="ops-action-list">
            {!coverage.importComplete && <button type="button" onClick={() => actions.navigate("assets", "collection")}><WarningCircle size={18} /><span><b>报表尚未完整</b><small>{coverage.missing.length} 类缺失；分析与执行保持阻断</small></span><ArrowRight size={16} /></button>}
            {pending.slice(0, 2).map((item) => <button type="button" key={item.id} onClick={() => actions.navigate("decisions", item.status === "pending_approval" ? "approval" : "recommendations")}><ShieldCheck size={18} /><span><b>{item.title}</b><small>{item.status === "pending_approval" ? "等待人工签发许可" : "等待判断"}</small></span><ArrowRight size={16} /></button>)}
            {readback.slice(0, 1).map((item) => <button type="button" key={item.id} onClick={() => actions.navigate("execution", "live")}><Browser size={18} /><span><b>执行结果等待刷新回读</b><small>核对页面值后才能写入因果记忆</small></span><ArrowRight size={16} /></button>)}
            {failedReadbacks.slice(0, 1).map((item) => <button type="button" key={item.id} onClick={() => actions.navigate("execution", "live")}><WarningCircle size={18} /><span><b>回读不一致，执行已停止</b><small>查看保存值与刷新值差异，并重新核验广告对象</small></span><ArrowRight size={16} /></button>)}
            {gate.allowed && !readback.length && <EmptyState title="已取得执行许可" detail="当前关键词竞价动作已通过全部安全门，等待进入可见执行。" action={<Button icon={Play} onClick={() => actions.navigate("execution", "live")}>前往实时执行</Button>} />}
            {!gate.allowed && coverage.importComplete && !pending.length && !readback.length && !failedReadbacks.length && verifiedReadbacks.length > 0 && <EmptyState title="本次执行与回读已闭合" detail="可以新建经营实验，继续验证业务效果。" action={<Button icon={Flask} onClick={() => actions.navigate("execution", "experiments")}>新建经营实验</Button>} />}
            {!gate.allowed && coverage.importComplete && !pending.length && !readback.length && !failedReadbacks.length && verifiedReadbacks.length === 0 && <EmptyState title="当前没有可执行动作" detail="尚未形成执行与回读结果；请运行新分析或处理本次建议。" action={<Button icon={Sparkle} onClick={() => actions.navigate("decisions", "runs")}>运行新分析</Button>} />}
          </div>
        </Panel>
      </div>
    </>
  );
}

function Products({ store, actions }) {
  const selectedId = store.selectedProductId || store.scope?.selectedProductId;
  const rows = (store.products || []).map((item) => ({
    ...item,
    price: money(item.target?.currentPrice),
    acos: percent(item.target?.targetAcos),
    tacos: percent(item.target?.targetTacos),
    statusLabel: item.status === "active" ? "在售" : "观察",
  }));
  return (
    <>
      <PageHeader eyebrow="运营资产" title="产品范围" description="锁定当前店铺中的产品，后续数据、建议、实验和执行都会跟随这个范围。" />
      <Metrics items={[
        { label: "当前店铺", value: storeLabel(store), detail: "美国站 / USD", tone: "success" },
        { label: "当前产品", value: productLabel(store).split(" · ")[0], detail: productLabel(store).split(" · ")[1] || "全部产品", tone: "info" },
        { label: "在售产品", value: `${rows.filter((item) => item.status === "active").length} 个`, detail: `共 ${rows.length} 个产品` },
      ]} />
      <Panel title="当前店铺产品" meta="点击一行切换运营范围" tone="primary">
        <Table
          columns={[
            { key: "sku", label: "SKU" },
            { key: "asin", label: "ASIN" },
            { key: "title", label: "产品" },
            { key: "price", label: "当前售价" },
            { key: "acos", label: "目标 ACOS" },
            { key: "tacos", label: "目标 TACOS" },
            { key: "statusLabel", label: "状态", render: (value) => <Tone tone={value === "在售" ? "success" : "warning"}>{value}</Tone> },
          ]}
          rows={rows}
          selectedId={selectedId}
          onSelect={(row) => actions.selectProduct(row.id)}
        />
      </Panel>
    </>
  );
}

function AdObjects({ store, runtime, actions }) {
  const [query, setQuery] = useState("");
  const product = selectedProduct(store);
  const { selectedKey, verifiedKeys } = adObjectSelection(runtime);
  const productRows = useMemo(() => diagnosticsForSelectedProduct(store)
    .map((item) => {
      const row = adObjectTableRow(item);
      const targetingSuffix = row.targetingType === "不适用" ? "" : ` · ${row.targetingType}`;
      return {
        ...row,
        objectKey: item.objectKey || item.id,
        path: `${row.campaign} > ${row.adGroup} > ${row.level}：${row.object}${targetingSuffix}`,
      };
    })
    .sort((left, right) => `${left.campaign}|${left.adGroup}|${left.level}|${left.object}`.localeCompare(`${right.campaign}|${right.adGroup}|${right.level}|${right.object}`, "zh-CN")), [store.diagnostics, store.products, store.selectedProductId, store.scope?.selectedProductId]);
  const rows = useMemo(() => productRows.filter((item) => `${item.campaign} ${item.adGroup} ${item.object} ${item.targetingType}`.toLowerCase().includes(query.trim().toLowerCase())), [productRows, query]);
  const selectedObject = productRows.find((item) => item.objectKey === selectedKey) || null;
  const selectedVerified = Boolean(selectedObject && verifiedKeys.has(selectedObject.objectKey));
  return (
    <>
      <PageHeader eyebrow="运营资产" title="广告对象" description={`按广告活动、广告组和对象层级拆分 ${product ? `${product.sku} · ${product.title}` : "当前所选产品"} 的投放结构；英文匹配类型已转换为中文。`} />
      <div className="ops-search"><MagnifyingGlass size={17} /><input aria-label="搜索广告对象" placeholder="搜索广告活动、广告组、关键词或投放方式" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      {selectedObject && <section className="ops-source-line"><Target size={17} /><span>已选择 <b>{selectedObject.path}</b></span><Tone tone={selectedVerified ? "success" : "warning"}>{selectedVerified ? "当前页面已核验" : "等待页面核验"}</Tone><Button primary={!selectedVerified} icon={ShieldCheck} disabled={selectedVerified} onClick={() => actions.verifyAdObject?.(selectedObject.objectKey)}>{selectedVerified ? "已核验" : "核验当前对象"}</Button></section>}
      <Panel title="当前产品的广告对象" meta={`${productRows.length} 个归属于所选产品`} tone="primary">
        {productRows.length ? <Table columns={[
          { key: "object", label: "广告对象", render: (_value, row) => <BusinessObjectCell row={row} /> },
          { key: "spendLabel", label: "花费" },
          { key: "acosLabel", label: "ACOS" },
          { key: "health", label: "业务状态", render: (value) => <Tone tone={value === "高风险" ? "danger" : value === "需观察" ? "warning" : value === "正常" ? "success" : "neutral"}>{value}</Tone> },
          { key: "verification", label: "对象核验", render: (_value, row) => <Tone tone={verifiedKeys.has(row.objectKey) ? "success" : row.objectKey === selectedKey ? "warning" : "neutral"}>{verifiedKeys.has(row.objectKey) ? "已核验" : row.objectKey === selectedKey ? "已选择" : "待选择"}</Tone> },
        ]} rows={rows} rowKey="objectKey" selectedId={selectedKey} onSelect={(row) => actions.selectAdObject?.(row.objectKey)} empty="没有符合当前搜索条件的广告对象" className="is-business-grid" groupBy={businessGroupPath} /> : <EmptyState title="当前产品没有可核验广告对象" detail="没有找到明确归属于所选产品的广告对象；系统不会借用其他产品的数据。请先重新采集广告报表，再返回选择与核验。" action={<Button icon={ArrowRight} onClick={() => actions.navigate("assets", "collection")}>前往数据采集</Button>} />}
      </Panel>
    </>
  );
}

function Collection({ store, coverage, actions }) {
  const rows = (store.reports || []).map((item) => ({
    ...item,
    range: `${store.scope?.dateFrom} 至 ${store.scope?.dateTo}`,
    rowsLabel: item.importedRows ? number.format(item.importedRows) : "—",
    statusLabel: item.status === "imported" ? "已入库" : item.status === "missing" ? "等待下载" : "处理中",
    next: item.status === "missing" ? item.error || "重新打开下载中心并重试" : "已完成日期、店铺与文件校验",
  }));
  return (
    <>
      <PageHeader
        eyebrow="运营资产"
        title="数据采集"
        description="8 类报表逐类显示启动、下载、导入和失败原因；不完整时后续分析与执行保持阻断。"
        actions={<Button primary icon={ArrowClockwise} busy={actions.collectionBusy} disabled={actions.collectionBusy} onClick={actions.collectReports}>{coverage.importComplete ? "重新采集" : "继续采集"}</Button>}
      />
      <section className={`ops-gate-banner ${coverage.importComplete ? "is-ready" : "is-blocked"}`}>
        {coverage.importComplete ? <CheckCircle size={20} weight="fill" /> : <WarningCircle size={20} weight="fill" />}
        <div><b>{coverage.importComplete ? "8 类真实报表已完成并入库" : `还缺 ${coverage.missing.length} 类报表`}</b><span>{coverage.importComplete ? `共 ${number.format(coverage.importedRows)} 行，可开始新的分析运行。` : "缺失数据不会被自动跳过，也不会生成看似完整的建议。"}</span></div>
      </section>
      <Metrics items={[
        { label: "采集", value: `${coverage.available}/${coverage.expected}`, detail: "真实文件", tone: coverage.filesComplete ? "success" : "warning" },
        { label: "导入", value: `${coverage.imported}/${coverage.expected}`, detail: `${number.format(coverage.importedRows)} 行`, tone: coverage.importComplete ? "success" : "warning" },
        { label: "范围", value: `${store.scope?.dateFrom?.slice(5)} 至 ${store.scope?.dateTo?.slice(5)}`, detail: `${storeLabel(store)} · ${productLabel(store).split(" · ")[0]}` },
      ]} />
      <Panel title="8 类报表进度" meta="每类失败都给出原因和下一步" tone="primary">
        <Table columns={[
          { key: "label", label: "报表" },
          { key: "range", label: "数据范围" },
          { key: "rowsLabel", label: "入库行数" },
          { key: "statusLabel", label: "状态", render: (value) => <Tone tone={value === "已入库" ? "success" : "warning"}>{value}</Tone> },
          { key: "next", label: "结果 / 下一步" },
        ]} rows={rows} />
      </Panel>
    </>
  );
}

function Runs({ store, runtime, coverage, actions }) {
  const run = resolveCurrentRun(runtime);
  const runs = runtime.analysisRuns || [];
  const phases = run?.phases || [];
  return (
    <>
      <PageHeader
        eyebrow="决策中心"
        title="分析运行"
        description="每次分析都是独立、可追溯的一次运行；相同输入重跑会保留历史，但只让最新建议进入待办。"
        actions={<Button primary icon={Sparkle} busy={run?.status === "running"} disabled={!coverage.importComplete || run?.status === "running"} onClick={actions.runAnalysis}>{run?.status === "running" ? "分析运行中" : "运行新分析"}</Button>}
      />
      {!coverage.importComplete && <section className="ops-gate-banner is-blocked"><WarningCircle size={20} weight="fill" /><div><b>数据尚未完整，不能运行分析</b><span>请先在数据采集补齐 8 类报表。</span></div><Button onClick={() => actions.navigate("assets", "collection")}>去补齐数据</Button></section>}
      {run ? (
        <>
          <Panel title={`第 ${run.ordinal || runs.length} 次分析`} meta={runScopeLabel(run)} actions={<RunBadge run={run} />} tone="primary">
            <div className="ops-run-summary">
              <div><span>本次结果</span><b>{run.summary || (run.status === "running" ? "正在量化广告对象并生成建议" : "分析已完成")}</b></div>
              <div><span>建议去向</span><b>{run.recommendationCount ?? run.recommendationIds?.length ?? 0} 条有效建议</b></div>
              <div><span>完成时间</span><b>{run.completedAt ? displayTime(run.completedAt) : "运行中"}</b></div>
              <div><span>重复处理</span><b>旧版本自动标记为“已替代”</b></div>
            </div>
            <ol className="ops-run-phases">
              {(phases.length ? phases : [
                { label: "核验 8 类事实", status: "done" },
                { label: "量化产品与广告对象", status: run.status === "running" ? "active" : "done" },
                { label: "生成证据与停止条件", status: run.status === "running" ? "pending" : "done" },
                { label: "去重并发布本次建议", status: run.status === "running" ? "pending" : "done" },
              ]).map((phase, index) => <li key={`${phase.label}-${index}`} className={`is-${phase.status || "pending"}`}><span>{phase.status === "done" ? <Check size={12} /> : index + 1}</span><b>{phase.label}</b><small>{phase.status === "done" ? "完成" : phase.status === "active" ? "进行中" : "等待"}</small></li>)}
            </ol>
          </Panel>
          <Panel title="分析历史" meta="历史保留用于复盘，不叠加为新的待办">
            <Table columns={[
              { key: "displayName", label: "运行" },
              { key: "sourceScope", label: "店铺 / 产品" },
              { key: "dataWindow", label: "数据范围" },
              { key: "completedLabel", label: "完成时间" },
              { key: "recommendationCount", label: "建议" },
              { key: "statusLabel", label: "状态", render: (value, row) => <Tone tone={row.status === "completed" ? "success" : row.status === "running" ? "info" : "neutral"}>{value}</Tone> },
            ]} rows={runs.map((item, index) => ({ ...item, displayName: `第 ${item.ordinal || runs.length - index} 次分析`, sourceScope: `${item.storeLabel || "店铺快照未记录"} · ${item.productLabel || "产品快照未记录"}`, dataWindow: displayDataWindow(item), completedLabel: item.completedAt ? displayTime(item.completedAt) : "—", recommendationCount: `${item.recommendationCount ?? item.recommendationIds?.length ?? 0} 条`, statusLabel: item.status === "completed" ? item.id === run?.id ? "当前有效" : "历史完成" : item.status === "running" ? "运行中" : item.status === "blocked" ? "已阻断" : "已被新分析替代" }))} />
          </Panel>
        </>
      ) : <EmptyState title="还没有分析记录" detail="8 类数据完整后，运行一次分析即可看到进度、结果和本次建议。" />}
    </>
  );
}

function recommendationRows(store, runtime) {
  const current = runtime.activeRecommendations || [];
  return current
    .map((item) => ({
      ...recommendationTableRow(item),
      risk: item.risk || "low",
    }))
    .sort((left, right) => `${left.campaign}|${left.adGroup}|${left.level}|${left.object}`.localeCompare(`${right.campaign}|${right.adGroup}|${right.level}|${right.object}`, "zh-CN"));
}

function Recommendations({ store, runtime, actions }) {
  const run = resolveCurrentRun(runtime);
  const rows = recommendationRows(store, runtime);
  return (
    <>
      <PageHeader eyebrow="决策中心" title="本次建议" description="按活动、广告组、对象、动作和前后值规范展示；这里只保留当前有效分析，历史建议不会叠加。" actions={<Button icon={ArrowClockwise} onClick={actions.runAnalysis}>重新分析</Button>} />
      {run && <section className="ops-source-line"><Sparkle size={16} /><span>来自 <b>第 {run.ordinal || runtime.analysisRuns.length} 次分析</b> · {runScopeLabel(run)} · {run.completedAt ? displayTime(run.completedAt) : "运行中"}</span><Button onClick={() => actions.navigate("decisions", "runs")}>查看来源</Button></section>}
      <Panel title="当前有效建议" meta={`${rows.length} 条 · 先看改哪里，再看为什么`} tone="primary">
        <Table columns={[
          { key: "object", label: "调整对象", render: (_value, row) => <BusinessObjectCell row={row} /> },
          { key: "action", label: "建议动作" },
          { key: "beforeLabel", label: "当前值" },
          { key: "afterLabel", label: "建议值" },
          { key: "basis", label: "主要依据" },
          { key: "statusLabel", label: "状态", render: (value, row) => <Tone tone={row.status === "approved" || row.status === "executed" ? "success" : row.status === "rejected" ? "danger" : "warning"}>{value}</Tone> },
          { key: "operation", label: "操作", render: (_value, row) => ["waiting_approval", "pending_review"].includes(row.status)
            ? <Button primary onClick={() => actions.sendToApproval(row.id)}>提交审批</Button>
            : row.status === "pending_approval"
              ? <Button primary onClick={() => actions.navigate("decisions", "approval")}>去审批</Button>
              : <span className="ops-table-muted">{row.status === "approved" ? "等待执行" : row.status === "executed" ? "已完成动作" : "无需操作"}</span> },
        ]} rows={rows} empty="本次分析没有可行动建议；历史建议不会重复进入当前待办。" className="is-business-grid is-recommendation-grid" groupBy={businessGroupPath} />
      </Panel>
    </>
  );
}

function Approval({ store, runtime, actions }) {
  const rows = recommendationRows(store, runtime).filter((item) => item.status === "pending_approval");
  return (
    <>
      <PageHeader eyebrow="决策中心" title="人工审批" description="审批只签发当前店铺、当前对象和当前建议版本的执行许可，不代表已经修改 Amazon Ads。" />
      {rows.length ? <div className="ops-card-list">{rows.map((item) => (
        <article className="ops-approval-card" key={item.id}>
          <div><Tone tone="warning">等待人工</Tone><h2>{item.title}</h2><p>{item.path}</p></div>
          <div className="ops-approval-facts"><span><small>将修改</small><b>{item.currentLabel} → {item.nextLabel}</b></span><span><small>自动边界</small><b>{item.policy?.boundary || "不在自动边界内"}</b></span><span><small>停止条件</small><b>身份变化、对象漂移或回读不一致立即停止</b></span></div>
          <p>{item.reason}</p>
          <footer><Button danger onClick={() => actions.rejectRecommendation(item.id)}>拒绝</Button><Button primary icon={ShieldCheck} onClick={() => actions.approveRecommendation(item.id)}>批准并签发许可</Button></footer>
        </article>
      ))}</div> : <EmptyState title="没有待审批建议" detail="你可以返回本次建议，将需要人工确认的动作提交审批。" action={<Button onClick={() => actions.navigate("decisions", "recommendations")}>查看本次建议</Button>} />}
    </>
  );
}

function LiveExecution({ store, runtime, gate, actions }) {
  const executionRecords = runtime.executionRecords || [];
  const currentConnection = connectionView(store);
  const eligible = (runtime.activeRecommendations || [])
    .filter((item) => item.entityType === "keyword" && ["approved", "executed"].includes(item.status))
    .map((item) => {
      const record = executionRecords.find((entry) => entry.recommendationId === item.id);
      return {
        ...recommendationTableRow(item),
        beforeValue: record?.beforeValue ?? item.currentValue,
        intendedValue: record?.intendedValue ?? item.recommendedValue,
        permission: "human",
        status: record?.status || "queued",
      };
    });
  const waitingReadback = executionRecords.filter((item) => item.status === "awaiting_readback");
  const verifiedReadbacks = executionRecords.filter((item) => item.status === "verified");
  const mismatchedReadbacks = executionRecords.filter((item) => READBACK_MISMATCH_STATUSES.has(item.status));
  const hasReadbackLock = waitingReadback.length > 0 || mismatchedReadbacks.length > 0;
  const executionComplete = verifiedReadbacks.length > 0
    && !hasReadbackLock
    && eligible.length > 0
    && eligible.every((item) => item.status === "verified");
  const blockerReason = gate.reasons?.[0] || "当前没有可执行的已批准动作";
  const bannerReady = gate.allowed || executionComplete;
  return (
    <>
      <PageHeader eyebrow="执行与实验" title="实时执行与回读" description="仅处理 V1 允许的关键词竞价动作；批准、执行、刷新回读和结果记录是四个独立状态。" actions={<Button primary icon={Play} disabled={!gate.allowed || actions.executionBusy} busy={actions.executionBusy} onClick={actions.startExecution}>启动可见执行</Button>} />
      <section className={`ops-gate-banner ${bannerReady ? "is-ready" : "is-blocked"}`}>
        {bannerReady ? (executionComplete ? <CheckCircle size={21} weight="fill" /> : <ShieldCheck size={21} weight="fill" />) : <LockKey size={21} weight="fill" />}
        <div>
          <b>{mismatchedReadbacks.length ? "刷新回读不一致，本次执行已阻断" : waitingReadback.length ? "已保存的动作等待刷新回读，后续执行暂缓" : executionComplete ? "本次执行与刷新回读已完成" : gate.allowed ? "执行安全门已通过" : "真实广告执行保持阻断"}</b>
          <span>{mismatchedReadbacks.length ? "页面刷新值与保存值不一致，系统不会把本次结果写成成功。请重新核验当前 Ads 对象与页面前值，再运行新分析。" : waitingReadback.length ? "必须确认页面保存值与刷新值一致，才能形成可信结果并解除本次回读锁。" : executionComplete ? "页面保存值与刷新值一致；动作证据已记录，业务效果仍需通过经营实验观察。" : gate.allowed ? "当前店铺身份、启用策略、产品、规范广告对象、页面前值与本店许可均已核验。" : blockerReason}</span>
        </div>
        {mismatchedReadbacks.length
          ? <Button icon={Target} onClick={() => actions.navigate("assets", "ad-objects")}>重新核验对象</Button>
          : waitingReadback.length
          ? <div className="ops-panel-actions"><Button primary icon={CheckCircle} onClick={() => actions.completeReadback("verified")}>模拟一致回读</Button><Button danger icon={WarningCircle} onClick={() => actions.completeReadback("mismatch")}>模拟不一致</Button></div>
          : executionComplete
            ? <Button onClick={() => actions.navigate("execution", "experiments")}>创建经营实验</Button>
            : !gate.allowed && gate.nextRoute && <Button onClick={() => actions.navigate(gate.nextRoute.workspace, gate.nextRoute.subview)}>{gate.nextAction || "处理阻断项"}</Button>}
      </section>
      <Metrics items={[
        { label: "执行模式", value: runtime.modeLabel || "半自动", detail: "当前店铺独立设置", tone: "info" },
        { label: "V1 待执行动作", value: `${eligible.filter((item) => item.status === "queued").length} 条`, detail: "只允许关键词竞价" },
        { label: "回读状态", value: mismatchedReadbacks.length ? `${mismatchedReadbacks.length} 条不一致` : `${waitingReadback.length} 条等待`, detail: mismatchedReadbacks.length ? "已停止，需重新核验" : "刷新页面后确认", tone: mismatchedReadbacks.length ? "danger" : waitingReadback.length ? "warning" : "success" },
        { label: "本次已回读", value: `${verifiedReadbacks.length} 条`, detail: "保存值与刷新值一致", tone: verifiedReadbacks.length ? "success" : "neutral" },
      ]} />
      <div className="ops-grid ops-grid-main">
        <Panel title="执行队列" meta="许可与对象同时绑定" tone="primary">
          {eligible.length ? <Table columns={[
            { key: "object", label: "执行对象", render: (_value, row) => <BusinessObjectCell row={row} /> },
            { key: "action", label: "执行动作" },
            { key: "change", label: "变更", render: (_value, row) => `${money(row.beforeValue)} → ${money(row.intendedValue)}` },
            { key: "permissionLabel", label: "许可", render: (_value, row) => <Tone tone={row.permission ? "success" : "warning"}>{row.permission ? "本店许可已签发" : "缺少许可"}</Tone> },
            { key: "statusLabel", label: "状态", render: (_value, row) => <Tone tone={row.status === "verified" ? "success" : row.status === "blocked_session" || READBACK_MISMATCH_STATUSES.has(row.status) ? "danger" : "warning"}>{row.status === "waiting_permission" ? "等待审批" : row.status === "awaiting_readback" ? "等待回读" : row.status === "verified" ? "已回读" : READBACK_MISMATCH_STATUSES.has(row.status) ? "回读不一致" : "等待执行"}</Tone> },
          ]} rows={eligible} className="is-business-grid" groupBy={businessGroupPath} /> : <EmptyState title="没有符合 V1 的执行动作" detail={gate.allowed ? "请先批准一个关键词竞价建议；预算、暂停和否定词不会进入 V1 队列。" : `${blockerReason}；请先${gate.nextAction || "处理阻断项"}。`} />}
        </Panel>
        <Panel title="可见浏览器现场" meta="原型模拟，不产生真实写入">
          <div className="ops-browser-surface">
            <div><Browser size={20} /><b>Amazon Ads · {storeLabel(store)}</b><Tone tone="warning">原型模拟</Tone></div>
            <section><Robot size={34} /><h3>{actions.executionBusy ? "正在核验身份与前值" : mismatchedReadbacks.length ? "回读不一致，已停止后续动作" : waitingReadback.length ? "已保存，等待刷新回读" : executionComplete ? "本次动作已完成回读" : !currentConnection.ready ? "等待当前店铺 Ads 确认" : "等待已授权动作"}</h3><p>{mismatchedReadbacks.length ? "系统保留保存值与刷新值的差异，并要求重新核验对象；不会把失败冒充成功。" : "系统会在可见页面中核对店铺、广告对象、当前值、保存结果与刷新后的值。"}</p></section>
            <ol><li className={currentConnection.ready ? "is-done" : "is-active"}>{currentConnection.ready && <Check />}核验店铺与规范广告对象</li><li className={actions.executionBusy ? "is-active" : eligible.length ? "is-done" : ""}>读取页面前值</li><li className={waitingReadback.length || verifiedReadbacks.length || mismatchedReadbacks.length ? "is-done" : ""}>保存已授权竞价</li><li className={mismatchedReadbacks.length ? "is-active" : waitingReadback.length ? "is-active" : verifiedReadbacks.length ? "is-done" : ""}>刷新并回读</li></ol>
          </div>
        </Panel>
      </div>
      {(executionRecords.length > 0) && <Panel title="本次执行回读" meta="前值、保存值与刷新值分开记录" tone="primary">
        <Table columns={[
          { key: "objectLabel", label: "广告对象" },
          { key: "beforeLabel", label: "调整前" },
          { key: "savedLabel", label: "页面保存" },
          { key: "reloadLabel", label: "刷新回读" },
          { key: "statusLabel", label: "结果", render: (value, row) => <Tone tone={row.status === "verified" ? "success" : READBACK_MISMATCH_STATUSES.has(row.status) ? "danger" : "warning"}>{value}</Tone> },
        ]} rows={executionRecords.map((item) => ({
          ...item,
          beforeLabel: money(item.beforeValue),
          savedLabel: money(item.savedValue),
          reloadLabel: item.reloadValue === null ? "等待刷新" : money(item.reloadValue),
          statusLabel: item.status === "verified" ? "回读一致" : READBACK_MISMATCH_STATUSES.has(item.status) ? "回读不一致（已阻断）" : "等待回读",
        }))} />
      </Panel>}
    </>
  );
}

function Experiments({ store, runtime, actions }) {
  const objectOptions = diagnosticsForSelectedProduct(store).map((item) => ({
    value: item.objectKey || item.id,
    label: [item.campaignName, item.adGroupName, `${item.objectName}${item.matchType ? ` · ${item.matchType}` : ""}`].filter(Boolean).join(" > "),
  }));
  const [draft, setDraft] = useState({
    name: "",
    hypothesis: "降低无效点击成本，同时保持订单稳定",
    metric: "ACOS",
    target: "改善 10%",
    guardMetric: "广告订单",
    guardOperator: "下降不超过",
    guardThreshold: "15%",
    duration: "7 天",
    adObjectKey: objectOptions[0]?.value || "",
  });
  const run = resolveCurrentRun(runtime);
  const experimentReady = run?.status === "completed" && objectOptions.length > 0;
  const create = () => {
    if (!draft.name.trim()) return;
    const selectedObject = objectOptions.find((item) => item.value === draft.adObjectKey);
    actions.createExperiment({
      ...draft,
      adObjectLabel: selectedObject?.label || "",
      guardrail: `${draft.guardMetric} ${draft.guardOperator} ${draft.guardThreshold}`,
    });
    setDraft((current) => ({ ...current, name: "" }));
  };
  return (
    <>
      <PageHeader eyebrow="执行与实验" title="经营实验" description="把一个运营假设绑定到产品、广告对象、主指标、守护指标和观察窗口；结果会进入因果记忆。" />
      {!experimentReady && <section className="ops-gate-banner is-blocked"><LockKey size={20} weight="fill" /><div><b>实验创建暂不可用</b><span>请先完成当前产品范围分析，并确保存在可核验广告对象。</span></div><Button onClick={() => actions.navigate("decisions", "runs")}>前往分析</Button></section>}
      <div className="ops-grid ops-grid-form">
        <Panel title="新建经营实验" meta={`${storeLabel(store)} · ${productLabel(store)}`} tone="primary">
          <div className="ops-form-grid">
            <label><span>实验名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：核心精准词小幅降价" /></label>
            <label><span>运营假设</span><input value={draft.hypothesis} onChange={(event) => setDraft({ ...draft, hypothesis: event.target.value })} /></label>
            <label><span>主指标</span><select value={draft.metric} onChange={(event) => setDraft({ ...draft, metric: event.target.value })}><option>ACOS</option><option>订单量</option><option>广告销售额</option><option>转化率</option></select></label>
            <label><span>预期目标</span><input value={draft.target} onChange={(event) => setDraft({ ...draft, target: event.target.value })} /></label>
            <label><span>广告对象</span><select value={draft.adObjectKey} onChange={(event) => setDraft({ ...draft, adObjectKey: event.target.value })}>{objectOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label><span>守护指标</span><div className="ops-inline-fields"><select aria-label="守护指标" value={draft.guardMetric} onChange={(event) => setDraft({ ...draft, guardMetric: event.target.value })}><option>广告订单</option><option>转化率</option><option>广告花费</option></select><select aria-label="比较符" value={draft.guardOperator} onChange={(event) => setDraft({ ...draft, guardOperator: event.target.value })}><option>下降不超过</option><option>上升不超过</option><option>不低于</option></select><input aria-label="阈值" value={draft.guardThreshold} onChange={(event) => setDraft({ ...draft, guardThreshold: event.target.value })} /></div></label>
            <label><span>观察窗口</span><select value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: event.target.value })}><option>3 天</option><option>7 天</option><option>14 天</option></select></label>
          </div>
          <div className="ops-form-actions"><Button primary icon={Plus} disabled={!draft.name.trim() || !experimentReady} onClick={create}>创建实验</Button></div>
        </Panel>
        <Panel title="实验规则" meta="先定义成功与停止条件">
          <ul className="ops-check-list"><li><CheckCircle />只使用当前店铺、产品和已核验广告对象</li><li><CheckCircle />主指标与守护指标都必须可回读</li><li><CheckCircle />身份变化、库存风险或守护指标触发时自动停止</li><li><CheckCircle />相同对象同一时间只允许一个运行中实验</li></ul>
        </Panel>
      </div>
      <Panel title="实验列表" meta={`${runtime.experiments?.length || 0} 个`} tone="primary">
        {(runtime.experiments || []).length ? <div className="ops-experiment-grid">{runtime.experiments.map((item) => {
          const statusView = item.status === "running"
            ? { tone: "info", label: `第 ${item.observationRound || 1} 轮观察中` }
            : item.status === "completed"
              ? { tone: "success", label: `第 ${item.observationRound || 1} 轮已完成` }
              : item.status === "stopped"
                ? { tone: "danger", label: "守护停止" }
                : { tone: "warning", label: "草稿" };
          return <article key={item.id}><header><Flask size={18} /><div><h3>{item.name}</h3><p>{item.productLabel || productLabel(store)}</p></div><Tone tone={statusView.tone}>{statusView.label}</Tone></header><dl><div><dt>主指标</dt><dd>{item.primaryMetric}</dd></div><div><dt>目标</dt><dd>{item.target}</dd></div><div><dt>守护指标</dt><dd>{item.guardrails?.[0] || "未设置"}</dd></div><div><dt>窗口</dt><dd>{item.observationWindow}</dd></div></dl>{item.result && <p className="ops-reason">{item.result}</p>}<footer><Button icon={item.status === "running" ? CheckCircle : Play} onClick={() => actions.toggleExperiment(item.id)}>{item.status === "running" ? "记录观察结果" : ["completed", "stopped"].includes(item.status) ? "开始新观察轮次" : "开始观察"}</Button></footer></article>;
        })}</div> : <EmptyState title="还没有经营实验" detail="先写清假设、指标和停止条件，再开始观察。" />}
      </Panel>
    </>
  );
}

function CausalMemory({ store, runtime, memories }) {
  return (
    <>
      <PageHeader eyebrow="经营记忆" title="因果记忆" description="把运营事件、分析、决策、执行、回读和结果串成可复用经验，不把相关性冒充因果。" />
      <section className="ops-memory-note"><ShieldCheck size={19} weight="fill" /><div><b>记忆只在证据链闭合后升级</b><span>没有执行回读或实验对照的记录，只标记为“待验证关联”，不会直接指导自动执行。</span></div></section>
      <div className="ops-memory-list">
        {(memories || []).map((memory) => {
          const steps = memory.steps || [
            { label: "来源", detail: memory.sourceLabel || "执行回读" },
            { label: "调整前", detail: memory.evidence?.[0] || "已记录" },
            { label: "调整后", detail: memory.evidence?.[1] || "已记录" },
            { label: "观察", detail: memory.observation || "等待结果" },
            { label: "结论", detail: memory.causalClaim || "待更多样本" },
          ];
          const confirmed = memory.confidence === "confirmed" || memory.confidence === "较高";
          return (
          <article key={memory.id} className="ops-memory-card">
            <header><div><span>{[memory.storeLabel, memory.productLabel].filter(Boolean).join(" · ") || "来源范围未记录"}</span><h2>{memory.title}</h2></div><Tone tone={confirmed ? "success" : "warning"}>{confirmed ? "已验证因果" : "待验证关联"}</Tone></header>
            <ol>{steps.map((step, index) => <li key={`${step.label}-${index}`}><span>{index + 1}</span><div><b>{step.label}</b><p>{step.detail}</p></div></li>)}</ol>
            <footer><span>{confirmed ? "可复用结论" : "当前判断"}</span><b>{memory.learning || memory.causalClaim || "需要更多样本后再复用"}</b></footer>
          </article>
          );
        })}
        {!(memories || []).length && <EmptyState title="尚未形成因果记忆" detail="完成一次执行回读或经营实验后，系统会生成第一条证据链。" />}
      </div>
    </>
  );
}

function Ledger({ ledger, store }) {
  const visible = (ledger || []).map((item, index) => ({
    ...item,
    displayOrder: index + 1,
    typeLabel: item.kind === "fact" ? "事实" : item.kind === "analysis" ? "分析" : item.kind === "action" ? "动作" : "结果",
    title: item.kind === "outcome" && /执行回读/.test(item.title || "") ? "关键词竞价执行回读" : safeLedgerText(item.title, store),
    detail: safeLedgerText(item.detail, store),
    status: safeLedgerText(item.status, store),
  }));
  return (
    <>
      <PageHeader eyebrow="经营记忆" title="运营账本" description="按时间保存事实、分析、人工决定、执行和结果；普通界面只显示业务含义。" />
      <Panel title="当前店铺账本" meta={`${visible.length} 条不可变记录`} tone="primary">
        <Table columns={[
          { key: "time", label: "时间" },
          { key: "typeLabel", label: "类型", render: (value) => <Tone tone={value === "结果" ? "success" : value === "动作" ? "warning" : "info"}>{value}</Tone> },
          { key: "title", label: "记录" },
          { key: "detail", label: "范围 / 证据" },
          { key: "status", label: "状态" },
        ]} rows={visible} />
      </Panel>
    </>
  );
}

function Stores({ store, stores, actions }) {
  return (
    <>
      <PageHeader eyebrow="系统设置" title="店铺与隔离" description="当前只支持 Amazon 美国站 / USD；不同店铺分别保存数据、分析、模式、审批和执行历史。" />
      <Panel title="美国站店铺" meta={`${stores.length} 个独立店铺舱`} tone="primary">
        <div className="ops-store-grid">{stores.map((item) => {
          const connection = connectionView(item);
          const status = connection.ready
            ? { tone: "success", label: "ERP / Ads 已确认" }
            : connection.erpReady
              ? { tone: "warning", label: "ERP 可用 · Ads 待处理" }
              : { tone: "danger", label: "连接未建立" };
          return <button type="button" className={item.id === store.id ? "is-active" : ""} key={item.id} onClick={() => actions.switchStore(item.id)}><Storefront size={20} /><span><b>{item.storeName || item.name}</b><small>Amazon US · USD</small></span><Tone tone={status.tone}>{status.label}</Tone>{item.id === store.id && <Check size={16} />}</button>;
        })}</div>
      </Panel>
      <section className="ops-memory-note"><LockKey size={18} weight="fill" /><div><b>严格店铺隔离</b><span>切换店铺只替换当前作用域；不会复用其他店铺的产品、批次、建议、许可、浏览器身份或因果记忆。</span></div></section>
    </>
  );
}

function Connections({ store, actions }) {
  const connection = connectionView(store);
  return (
    <>
      <PageHeader eyebrow="系统设置" title="连接与身份" description="ERP 与 Ads 分阶段显示；Ads 失败不抹掉已验证 ERP，但真实写入继续阻断。" actions={<Button primary icon={ArrowClockwise} onClick={actions.retryConnection}>重新识别 Ads</Button>} />
      <div className="ops-connection-grid">
        <article><span className="ops-step-number">1</span><div><h2>领星 ERP</h2><p>读取报表与当前店铺范围</p></div><Tone tone={connection.erpReady ? "success" : "warning"}>{connection.erpReady ? "已连接" : "需重试"}</Tone><small>{connection.erpReady ? "只读采集会话可用" : "请重新建立领星 ERP 会话"}</small></article>
        <article><span className="ops-step-number">2</span><div><h2>Amazon Ads</h2><p>从可见 Ads 页面识别广告账户与店铺</p></div><Tone tone={connection.adsReady && connection.storeIdentityReady ? "success" : "warning"}>{connection.adsReady ? connection.storeIdentityReady ? "已确认" : "待确认店铺" : "待识别"}</Tone><small>{connection.adsReady && connection.storeIdentityReady ? `已匹配 ${storeLabel(store)}` : "ERP 可继续只读采集；广告写入保持阻断"}</small></article>
        <article><span className="ops-step-number">3</span><div><h2>执行身份</h2><p>每次写入前再次核验店铺与广告对象</p></div><Tone tone="success">安全门已启用</Tone><small>身份变化会立即停止执行</small></article>
      </div>
      <section className="ops-memory-note"><Browser size={18} weight="fill" /><div><b>为什么仍需绑定</b><span>“页面已打开”只说明浏览器可见；绑定用于证明当前 Ads 账户、店铺和待改对象属于同一作用域，避免跨店写入。</span></div></section>
    </>
  );
}

function Policies({ runtime, settings, actions }) {
  const policy = settings?.policy || { status: "missing", rules: [] };
  const statusView = policy.status === "enabled"
    ? { tone: "success", title: "当前策略版本已启用", detail: policy.versionLabel || "已启用关键词竞价策略" }
    : policy.status === "checked"
      ? { tone: "info", title: "策略草稿检查通过", detail: "启用后旧分析会退出当前待办，需要基于新版本重新分析。" }
      : policy.status === "draft"
        ? { tone: "warning", title: "策略草稿等待检查", detail: "完成四步检查后才能启用，真实执行继续阻断。" }
        : { tone: "danger", title: "当前店铺没有已启用策略", detail: "请创建草稿、检查并启用。" };
  const primaryAction = policy.status === "draft"
    ? <Button primary icon={CheckCircle} onClick={actions.checkPolicyDraft}>检查策略草稿</Button>
    : policy.status === "checked"
      ? <Button primary icon={ShieldCheck} onClick={actions.enablePolicyDraft}>启用已检查版本</Button>
      : <Button primary icon={Plus} onClick={actions.createPolicyDraft}>{policy.status === "enabled" ? "创建新草稿版本" : "创建策略草稿"}</Button>;
  return (
    <>
      <PageHeader eyebrow="系统设置" title="策略与安全边界" description="V1 只允许调整关键词竞价；数字越小越先匹配，所有其他动作都继续要求人工处理。" actions={primaryAction} />
      <section className={`ops-gate-banner ${policy.status === "enabled" ? "is-ready" : "is-blocked"}`}><ShieldCheck size={20} weight="fill" /><div><b>{statusView.title}</b><span>{statusView.detail}</span></div><Tone tone={statusView.tone}>{policy.status === "enabled" ? runtime.modeLabel || "半自动" : policy.status === "checked" ? "待启用" : policy.status === "draft" ? "草稿" : "未配置"}</Tone></section>
      <Panel title="策略工作流" meta="对象范围 → 允许动作 → 限制 → 证据与停止条件" tone="primary">
        <ol className="ops-policy-steps"><li><span>1</span><div><b>对象范围</b><p>当前店铺 → 所选产品 → 广告活动 → 广告组 → 关键词</p></div></li><li><span>2</span><div><b>允许动作</b><p>只允许“调整关键词竞价”</p></div></li><li><span>3</span><div><b>变更限制</b><p>单次不超过 10%；每日最多 3 次；冷却 24 小时</p></div></li><li><span>4</span><div><b>证据与停止条件</b><p>至少 7 天事实；身份漂移、回读不一致、库存风险立即停止</p></div></li></ol>
      </Panel>
      <Panel title="策略优先级" meta="数字越小越先匹配">
        <Table columns={[
          { key: "priority", label: "优先级" },
          { key: "scope", label: "匹配范围" },
          { key: "action", label: "允许动作" },
          { key: "limit", label: "竞价限制" },
          { key: "approval", label: "审批方式" },
        ]} rows={(policy.rules || []).map((rule) => ({
          id: rule.id,
          priority: rule.priority,
          scope: rule.scope,
          action: rule.actionLabel,
          limit: `单次 ±${rule.changeLimitPct}% · 每日 ${rule.dailyLimit} 次 · 冷却 ${rule.cooldownHours}h`,
          approval: rule.approvalMode,
        }))} empty="当前没有策略规则；请先创建草稿版本。" />
      </Panel>
    </>
  );
}

function Automation({ store, runtime, settings, capabilities, actions }) {
  const schedules = settings?.automationTasks || store.scheduler || [];
  const [configDraft, setConfigDraft] = useState(() => ({ ...(settings?.config || {}) }));
  useEffect(() => setConfigDraft({ ...(settings?.config || {}) }), [settings?.storeKey, settings?.revision]);
  const connection = connectionView(store);
  const capabilityReady = (capability) => {
    if (/execution|readback|ads\./.test(capability.id)) return connection.ready;
    if (/connection|reports\./.test(capability.id)) return connection.erpReady;
    return true;
  };
  return (
    <>
      <PageHeader eyebrow="系统设置" title="自动任务与能力诊断" description="自动任务按店铺串行运行；失败会给出原因和重试入口，不把部分结果标成成功。" />
      <Panel title="当前店铺运行配置" meta={`设置版本 ${settings?.revision || 1} · 只作用于 ${storeLabel(store)}`} tone="primary">
        <div className="ops-form-grid">
          <label><span>每日采集时间</span><input type="time" value={configDraft.collectionTime || "08:30"} onChange={(event) => setConfigDraft({ ...configDraft, collectionTime: event.target.value })} /></label>
          <label><span>数据回看天数</span><input min="1" type="number" value={configDraft.lookbackDays || 14} onChange={(event) => setConfigDraft({ ...configDraft, lookbackDays: Number(event.target.value) })} /></label>
          <label><span>最低建议置信度</span><input max="100" min="0" type="number" value={configDraft.minConfidencePct || 85} onChange={(event) => setConfigDraft({ ...configDraft, minConfidencePct: Number(event.target.value) })} /></label>
          <label className="ops-checkbox-field"><span>立即阻断全部广告执行</span><input checked={configDraft.killSwitch === true} type="checkbox" onChange={(event) => setConfigDraft({ ...configDraft, killSwitch: event.target.checked })} /><b>{configDraft.killSwitch ? "已阻断" : "未阻断；仍须逐项通过安全门"}</b></label>
        </div>
        <div className="ops-form-actions"><Button primary icon={ShieldCheck} onClick={() => actions.saveSystemConfig({ expectedRevision: settings.revision, patch: configDraft })}>保存当前店铺配置</Button></div>
      </Panel>
      <Panel title="自动任务" meta={`${schedules.filter((item) => item.enabled).length} 个已启用`} tone="primary">
        <Table columns={[
          { key: "name", label: "任务" },
          { key: "cron", label: "触发规则" },
          { key: "nextRun", label: "下次运行" },
          { key: "enabledLabel", label: "状态", render: (_value, row) => <Tone tone={row.enabled ? "success" : "neutral"}>{row.enabled ? "已启用" : "已停用"}</Tone> },
          { key: "lastLabel", label: "最近结果", render: (_value, row) => <div><Tone tone={row.lastStatus === "success" ? "success" : row.lastStatus === "failed" ? "danger" : "warning"}>{row.lastStatus === "success" ? "成功" : row.lastStatus === "waiting" ? "等待" : "失败"}</Tone>{row.lastReason && <small className="ops-inline-reason">{row.lastReason} · {row.nextAction}</small>}</div> },
          { key: "operations", label: "操作", render: (_value, row) => <div className="ops-table-actions"><Button onClick={() => actions.toggleAutomation(row.id)}>{row.enabled ? "停用" : "启用"}</Button><Button primary={row.lastStatus === "failed"} onClick={() => actions.runAutomation(row.id)}>{row.lastStatus === "failed" ? "重试" : "立即运行"}</Button></div> },
        ]} rows={schedules} />
      </Panel>
      <details className="ops-diagnostics">
        <summary><Gear size={17} />能力诊断（技术详情）<span>仅用于维护，不是日常操作入口</span></summary>
        <div className="ops-capability-grid">{(capabilities || []).map((item) => {
          const ready = capabilityReady(item);
          return <article key={item.id}><div><b>{item.label}</b><Tone tone={ready ? "success" : "danger"}>{ready ? "可用" : "受连接阻断"}</Tone></div><p>由“{item.ownerPhase === "facts" ? "事实核验" : item.ownerPhase === "analysis" ? "分析" : item.ownerPhase === "recommend" ? "建议与审批" : "执行与学习"}”阶段自动调用。</p><small>{ready ? "仅在诊断详情中展示，不作为用户操作入口" : "请先修复当前店铺 Ads 连接与身份"}</small></article>;
        })}</div>
      </details>
    </>
  );
}

export default function PrototypeWorkspace({ route, store, stores, runtime, settings, coverage, gate, ledger, memories, capabilities, actions }) {
  const props = { store, stores, runtime, settings, coverage, gate, ledger, memories, capabilities, actions };
  const key = `${route.workspace}:${route.subview}`;
  const views = {
    "today:overview": Today,
    "assets:products": Products,
    "assets:ad-objects": AdObjects,
    "assets:collection": Collection,
    "decisions:runs": Runs,
    "decisions:recommendations": Recommendations,
    "decisions:approval": Approval,
    "execution:live": LiveExecution,
    "execution:experiments": Experiments,
    "memory:causal": CausalMemory,
    "memory:ledger": Ledger,
    "settings:stores": Stores,
    "settings:connections": Connections,
    "settings:policies": Policies,
    "settings:automation": Automation,
  };
  const View = views[key] || Today;
  return <View key={`${store.id}:${key}`} {...props} />;
}
