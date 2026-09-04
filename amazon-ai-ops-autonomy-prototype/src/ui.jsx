import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bell,
  BookOpenText,
  Brain,
  Browser,
  CaretDown,
  CaretRight,
  ChartLineUp,
  Check,
  CheckCircle,
  CircleNotch,
  Command,
  Compass,
  Cube,
  Database,
  FileText,
  Gear,
  ListChecks,
  LockKey,
  MagnifyingGlass,
  Package,
  Pause,
  Play,
  Question,
  Robot,
  ShieldCheck,
  Sparkle,
  Storefront,
  Target,
  UserCircle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

export const WORKSPACE_ICONS = {
  today: Compass,
  product: Cube,
  "data-preparation": Database,
  diagnosis: ChartLineUp,
  decisions: ListChecks,
  readback: Browser,
  growth: Target,
  system: Gear,
};

function storeArray(stores) {
  return Array.isArray(stores) ? stores : Object.values(stores || {});
}

export function Topbar({
  stores,
  store,
  product,
  mode,
  busy = false,
  onStoreChange,
  onModeChange,
  onOpenCommand,
  onOpenLedger,
  onHelp,
}) {
  const availableStores = storeArray(stores);
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    if (!open) return undefined;
    const selectedIndex = Math.max(0, availableStores.findIndex((item) => item.id === store.id));
    requestAnimationFrame(() => itemRefs.current[selectedIndex]?.focus());
    const onPointer = (event) => {
      if (!menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [open, availableStores, store.id]);

  const onMenuKeyDown = (event, index) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    const last = availableStores.length - 1;
    const target = event.key === "ArrowDown" ? Math.min(last, index + 1)
      : event.key === "ArrowUp" ? Math.max(0, index - 1)
        : event.key === "Home" ? 0
          : event.key === "End" ? last
            : -1;
    if (target >= 0) {
      event.preventDefault();
      itemRefs.current[target]?.focus();
    }
  };

  return (
    <header className="topbar">
      <div className="brand-lockup" aria-label="运营巡航台">
        <span className="brand-mark"><Compass size={20} weight="fill" /></span>
        <strong>运营巡航台</strong>
        <span className="prototype-chip">完整原型</span>
      </div>

      <div className="topbar-context">
        <div className="store-switcher-wrap">
          <button
            ref={triggerRef}
            aria-expanded={open}
            aria-haspopup="listbox"
            className="context-button store-switcher"
            disabled={busy}
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            <span><b>{store.id}</b> · {store.marketplace}</span>
            <CaretDown size={15} />
          </button>
          {open && (
            <div ref={menuRef} className="store-menu" role="listbox" aria-label="切换店铺">
              {availableStores.map((item, index) => (
                <button
                  ref={(node) => { itemRefs.current[index] = node; }}
                  aria-selected={item.id === store.id}
                  key={item.id}
                  onClick={() => {
                    onStoreChange(item.id);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  onKeyDown={(event) => onMenuKeyDown(event, index)}
                  role="option"
                  type="button"
                >
                  <span className="store-menu-icon"><Storefront size={17} /></span>
                  <span className="store-menu-copy"><b>{item.id} · {item.name}</b><small>{item.marketplace} · {item.browserProfileId}</small></span>
                  {item.id === store.id && <Check size={16} weight="bold" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="context-button product-context" title={product ? `${product.sku} / ${product.asin}` : "全部产品"}>
          <Cube size={16} />
          <span>{product ? `${product.sku} / ${product.asin}` : "全部产品"}</span>
        </div>
        <span className={`session-status ${store.sessionTone || "success"}`}>
          {store.sessionTone === "warning" ? <WarningCircle size={17} weight="fill" /> : <CheckCircle size={17} weight="fill" />}
          {store.session}
        </span>
      </div>

      <div className="topbar-actions">
        <div className="mode-toggle" aria-label="执行模式" role="group">
          <button className={mode === "review" ? "selected" : ""} disabled={busy} onClick={() => onModeChange("review")} type="button">
            <UserCircle size={16} />人工审批
          </button>
          <button className={mode === "auto" ? "selected" : ""} disabled={busy} onClick={() => onModeChange("auto")} type="button">
            <Robot size={16} />AI 全自动
          </button>
        </div>
        <button aria-label="搜索与命令" className="icon-button" onClick={onOpenCommand} title="搜索与命令（Ctrl K）" type="button"><MagnifyingGlass size={21} /></button>
        <button aria-label="打开运营账本" className="icon-button notification-button" onClick={onOpenLedger} title="运营账本" type="button"><Bell size={20} /><span>2</span></button>
        <button aria-label="原型说明" className="icon-button" onClick={onHelp} title="原型说明" type="button"><Question size={20} /></button>
        <span className="avatar-button" aria-label="当前操作员张伟">张</span>
      </div>
    </header>
  );
}

export function Sidebar({ workspaces, activeWorkspace, badges = {}, store, onNavigate }) {
  const daily = workspaces.filter((item) => item.section !== "system");
  const system = workspaces.filter((item) => item.section === "system");
  const renderGroup = (items, label) => (
    <section className="nav-section" aria-label={label}>
      <span className="nav-section-label">{label}</span>
      <div className="primary-nav" role="list">
        {items.map((item) => {
          const Icon = WORKSPACE_ICONS[item.id] || FileText;
          const active = activeWorkspace === item.id;
          const badge = badges[item.id];
          return (
            <button
              aria-current={active ? "page" : undefined}
              className={active ? "active" : ""}
              key={item.id}
              onClick={() => onNavigate(item.defaultIntent || { workspace: item.id, subview: item.subviews?.[0]?.id })}
              role="listitem"
              title={item.description}
              type="button"
            >
              <Icon size={20} weight={active ? "fill" : "regular"} />
              <span>{item.label}</span>
              {badge ? <em className="nav-count">{badge}</em> : null}
            </button>
          );
        })}
      </div>
    </section>
  );

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav" aria-label="主业务导航">
        {renderGroup(daily, "运营工作台")}
        {renderGroup(system, "系统")}
      </nav>
      <div className="sidebar-bottom">
        <div className="capsule-card" aria-label={`${store.id} 店铺隔离状态`}>
          <span className="capsule-icon"><Storefront size={17} /></span>
          <span><b>{store.id} · 独立舱</b><small>{store.marketplace} · 本地库隔离</small></span>
          <LockKey size={14} />
        </div>
        <div className="isolation-status"><LockKey size={13} weight="fill" />店铺数据与浏览器 Profile 已隔离</div>
      </div>
    </aside>
  );
}

export function SubviewTabs({ items = [], active, onChange }) {
  if (items.length <= 1) return null;
  return (
    <div className="subview-tabs" role="tablist" aria-label="工作区子视图">
      {items.map((item) => (
        <button
          aria-selected={active === item.id}
          className={active === item.id ? "active" : ""}
          key={item.id}
          onClick={() => onChange(item.id)}
          role="tab"
          type="button"
        >
          <b>{item.label}</b>
          <small>{item.description}</small>
          {item.extension && <em>目标扩展</em>}
        </button>
      ))}
    </div>
  );
}

export function PageFrame({ eyebrow, title, description, task, actions, children }) {
  return (
    <div className="page-frame">
      <header className="workspace-heading">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </header>
      {task}
      {children}
    </div>
  );
}

export function TaskBanner({ tone = "default", title, detail, actions }) {
  const Icon = tone === "success" ? CheckCircle : tone === "warning" || tone === "blocked" ? WarningCircle : Sparkle;
  return (
    <section className={`task-banner tone-${tone}`} aria-label="当前主任务">
      <span className="task-banner-icon"><Icon size={21} weight="fill" /></span>
      <span className="task-banner-copy"><small>当前主任务</small><b>{title}</b><em>{detail}</em></span>
      {actions && <div className="task-banner-actions">{actions}</div>}
    </section>
  );
}

export function SummaryStrip({ items = [] }) {
  return (
    <dl className="summary-strip">
      {items.map((item) => (
        <div key={item.label} className={item.tone ? `tone-${item.tone}` : ""}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          {item.detail && <small>{item.detail}</small>}
        </div>
      ))}
    </dl>
  );
}

export function WorkbenchPanel({ title, meta, tone = "default", actions, children, className = "" }) {
  const titleId = useId();
  return (
    <section className={`workbench-panel tone-${tone} ${className}`.trim()} aria-labelledby={titleId}>
      <header className="workbench-panel-header">
        <div><h2 id={titleId}>{title}</h2>{meta && <p>{meta}</p>}</div>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      <div className="workbench-panel-body">{children}</div>
    </section>
  );
}

export function StatusPill({ tone = "neutral", children }) {
  return <span className={`status-pill tone-${tone}`}>{children}</span>;
}

export function FieldRow({ label, hint, children, required = false }) {
  return (
    <label className="field-row">
      <span className="field-label"><b>{label}{required && <em> *</em>}</b>{hint && <small>{hint}</small>}</span>
      <span className="field-control">{children}</span>
    </label>
  );
}

function cellValue(row, column) {
  const value = typeof column.accessor === "function"
    ? column.accessor(row)
    : row[column.key || column.accessor || column.id];
  if (column.render) return column.render(value, row);
  return value;
}

export function DataTable({ columns = [], rows = [], rowKey = "id", onRowClick, selectedId, empty = "当前范围没有记录" }) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead><tr>{columns.map((column) => <th key={column.key || column.id || column.accessor || column.label} style={{ width: column.width }}>{column.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => {
            const id = typeof rowKey === "function" ? rowKey(row) : row[rowKey];
            return (
              <tr
                aria-selected={selectedId === id}
                className={selectedId === id ? "selected" : ""}
                key={id || index}
                onClick={() => onRowClick?.(row)}
                onKeyDown={(event) => {
                  if (!onRowClick || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  onRowClick(row);
                }}
                tabIndex={onRowClick ? 0 : undefined}
              >
                {columns.map((column) => <td key={column.key || column.id || column.accessor || column.label}>{cellValue(row, column)}</td>)}
              </tr>
            );
          })}
          {!rows.length && <tr><td className="table-empty" colSpan={Math.max(1, columns.length)}>{empty}</td></tr>}
        </tbody>
      </table>
      <div className="table-status" role="status">显示 {rows.length} 行 / {columns.length} 列 · 当前店铺隔离数据</div>
    </div>
  );
}

export function EmptyState({ title, detail, action }) {
  return (
    <div className="empty-state">
      <Database size={28} />
      <b>{title}</b>
      <span>{detail}</span>
      {action}
    </div>
  );
}

export function ProgressRail({ steps = [], activeId }) {
  return (
    <ol className="progress-rail" aria-label="流程步骤">
      {steps.map((step, index) => {
        const active = step.id === activeId;
        const done = step.status === "done";
        return (
          <li className={`${active ? "active" : ""} ${done ? "done" : ""}`.trim()} key={step.id}>
            <span>{done ? <Check size={12} weight="bold" /> : index + 1}</span>
            <div><b>{step.label}</b>{step.detail && <small>{step.detail}</small>}</div>
          </li>
        );
      })}
    </ol>
  );
}

export function Inspector({ record, onClose, onAction, busyAction }) {
  if (!record) return null;
  const actionItems = record.actions || [];
  return (
    <aside className="inspector" aria-label="对象检查器">
      <div className="inspector-header">
        <div><span className="eyebrow">OBJECT INSPECTOR</span><h2>{record.title || record.object || "对象详情"}</h2></div>
        <button aria-label="关闭检查器" className="icon-button" onClick={onClose} type="button"><X size={19} /></button>
      </div>
      <div className="inspector-meta">
        <StatusPill tone={record.tone || "neutral"}>{record.status || record.kind || "已载入"}</StatusPill>
        <code>{record.id}</code>
      </div>
      {(record.before || record.after) && (
        <section className="change-block">
          <span className="inspector-label">变更内容</span>
          <div className="change-diff"><span><small>当前</small>{record.before || "—"}</span><ArrowRight size={23} /><span className="after"><small>建议</small>{record.after || "—"}</span></div>
          {record.object && <p>{record.object}</p>}
        </section>
      )}
      {record.reason && <section className="inspector-section"><span className="inspector-label">判断原因</span><p>{record.reason}</p></section>}
      {record.evidence?.length > 0 && (
        <section className="inspector-section evidence-section">
          <span className="inspector-label">证据（{record.evidence.length} 条）</span>
          <ul>{record.evidence.map((item) => <li key={item}><ChartLineUp size={15} /><span>{item}</span></li>)}</ul>
        </section>
      )}
      <section className="inspector-section">
        <span className="inspector-label">范围与权威</span>
        <dl className="inspector-facts">
          <div><dt>店铺</dt><dd>{record.storeId || "当前店铺"}</dd></div>
          <div><dt>产品</dt><dd>{record.asin || "当前范围"}</dd></div>
          <div><dt>批次</dt><dd>{record.batchId || "已绑定"}</dd></div>
          <div><dt>版本</dt><dd>{record.revision || record.policyVersion || "v1"}</dd></div>
        </dl>
      </section>
      {actionItems.length > 0 && (
        <div className="inspector-actions">
          {actionItems.map((action, index) => (
            <button
              className={index === 0 ? "primary-button wide" : "secondary-button wide"}
              disabled={Boolean(busyAction) || action.disabled}
              key={action.id}
              onClick={() => onAction?.(action.id, record)}
              type="button"
            >
              {busyAction === action.id && <CircleNotch className="spin" size={17} />}
              {busyAction === action.id ? action.busyLabel || "处理中..." : action.label}
            </button>
          ))}
        </div>
      )}
      <div className="chain-integrity"><LockKey size={13} weight="fill" />范围快照与不可变版本已绑定</div>
    </aside>
  );
}

export function Modal({ title, description, children, footer, onClose, size = "medium" }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    requestAnimationFrame(() => dialogRef.current?.querySelector("button, input, select, textarea")?.focus());
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
      if (event.key !== "Tab") return;
      const nodes = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }} role="presentation">
      <section ref={dialogRef} aria-modal="true" className={`modal modal-${size}`} role="dialog" aria-label={title}>
        <header><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button aria-label="关闭" className="icon-button" onClick={onClose} type="button"><X size={19} /></button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  );
}

export function CommandPalette({ workspaces, store, onNavigate, onClose }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  const commands = useMemo(() => [
    ...workspaces.map((item) => ({ id: item.id, label: `打开${item.label}`, meta: item.description, icon: WORKSPACE_ICONS[item.id] || FileText, intent: item.defaultIntent })),
    { id: "ledger", label: "查看本店运营账本", meta: `${store.id} · 事实、决策、执行与结果`, icon: BookOpenText, intent: { modal: "ledger" } },
  ].filter((item) => `${item.label}${item.meta}`.toLowerCase().includes(query.toLowerCase())), [query, store.id, workspaces]);
  useEffect(() => { requestAnimationFrame(() => inputRef.current?.focus()); }, []);
  return (
    <Modal title="搜索与命令" description={`当前范围 ${store.id} · 输入页面或任务名称`} onClose={onClose}>
      <div className="command-input"><MagnifyingGlass size={19} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：报表采集、待审批、执行队列" /><kbd>ESC</kbd></div>
      <div className="command-results">
        {commands.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => { onNavigate(item.intent); onClose(); }} type="button"><Icon size={18} /><span><b>{item.label}</b><small>{item.meta}</small></span><CaretRight size={15} /></button>; })}
      </div>
    </Modal>
  );
}

export function PrototypeNotice() {
  return (
    <div className="prototype-notice" role="note">
      <ShieldCheck size={15} weight="fill" />
      <span><b>交互原型</b> · 使用模拟数据，不连接领星或 Amazon Ads，不产生真实广告写入。</span>
    </div>
  );
}

export function Toast({ message }) {
  if (!message) return null;
  return <div className="toast" role="status"><CheckCircle size={17} weight="fill" />{message}</div>;
}

export function BrowserRunModal({ store, run, onPause, onTakeover, onClose }) {
  const steps = run?.steps || [];
  const activeIndex = Math.max(0, steps.findIndex((step) => step.status === "active"));
  return (
    <Modal
      title="可见浏览器执行现场"
      description={`${store.id} · ${store.marketplace} · Profile ${store.browserProfileId}`}
      onClose={onClose}
      size="large"
      footer={<div className="modal-footer-actions"><button className="secondary-button" onClick={onPause} type="button"><Pause size={16} />暂停队列</button><button className="primary-button" onClick={onTakeover} type="button"><UserCircle size={16} />人工接管</button></div>}
    >
      <div className="browser-run-layout">
        <section className="browser-status-surface">
          <div className="browser-status-bar"><Browser size={18} /><b>{run?.surfaceLabel || "Amazon Ads 可见窗口"}</b><StatusPill tone="warning">原型模拟</StatusPill></div>
          <div className="browser-status-main">
            <span className="browser-live-icon"><CircleNotch className="spin" size={30} /></span>
            <h3>{run?.title || "正在等待已授权动作"}</h3>
            <p>{run?.detail || "执行器会在可见窗口中核对账户、对象、前值、写入结果和刷新回读。"}</p>
            <dl><div><dt>对象锁</dt><dd>{run?.entityId || "待绑定"}</dd></div><div><dt>前 → 后</dt><dd>{run?.change || "—"}</dd></div><div><dt>当前步骤</dt><dd>{activeIndex + 1}/{Math.max(1, steps.length)}</dd></div></dl>
          </div>
        </section>
        <ProgressRail steps={steps} activeId={steps[activeIndex]?.id} />
      </div>
    </Modal>
  );
}

export function ActionButton({ children, busy, icon: Icon, kind = "secondary", className = "", ...props }) {
  const variantClass = kind === "primary"
    ? "primary-button"
    : kind === "danger"
      ? "danger-button"
      : kind === "text"
        ? "text-button"
        : "secondary-button";
  return (
    <button className={`${variantClass} ${className}`.trim()} {...props}>
      {busy ? <CircleNotch className="spin" size={16} /> : Icon ? <Icon size={16} /> : null}
      {children}
    </button>
  );
}

export { Brain, Browser, CheckCircle, CircleNotch, Command, Database, FileText, LockKey, Package, Pause, Play, Robot, ShieldCheck, Sparkle, Storefront, Target, WarningCircle };
