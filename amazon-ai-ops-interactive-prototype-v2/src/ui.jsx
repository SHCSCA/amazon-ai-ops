import React, {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  Bell,
  BookOpenText,
  CaretDown,
  CheckCircle,
  CircleNotch,
  Info,
  MagnifyingGlass,
  Robot,
  ShieldCheck,
  Storefront,
  UserCircle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

const cx = (...values) => values.filter(Boolean).join(" ");

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (
    typeof window === "undefined" ? false : window.matchMedia(query).matches
  ));

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);

  return matches;
}

function focusableNodes(surface) {
  if (!surface) return [];
  return [...surface.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((node) => !node.hasAttribute("hidden") && node.getAttribute("aria-hidden") !== "true");
}

function useDialogKeyboard({ open, surfaceRef, onClose, dismissDisabled = false }) {
  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const previous = document.activeElement;
    const focusTimer = window.requestAnimationFrame(() => {
      const nodes = focusableNodes(surfaceRef.current);
      (nodes[0] || surfaceRef.current)?.focus?.();
    });

    const onKeyDown = (event) => {
      if (event.key === "Escape" && !dismissDisabled) {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusableNodes(surfaceRef.current);
      if (!nodes.length) {
        event.preventDefault();
        surfaceRef.current?.focus?.();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [dismissDisabled, onClose, open, surfaceRef]);
}

export function AppShell({
  topbar,
  sidebar,
  inspector,
  inspectorOpen = false,
  children,
  className = "",
}) {
  return (
    <div className={cx("app-shell", className)}>
      {topbar}
      <div className="app-body">
        {sidebar}
        <div className="app-workspace" data-inspector-open={inspectorOpen ? "true" : undefined}>
          <main className="app-content" id="main-content">{children}</main>
          {inspector}
        </div>
      </div>
    </div>
  );
}

export function Topbar({
  stores = [],
  activeStoreId,
  onStoreChange,
  store,
  mode = "review",
  onModeChange,
  onOpenInspector,
  onOpenLedger,
  onSearch,
  brand = "Amazon AI Ops",
  version = "V2 原型",
  status = "交互模拟",
}) {
  const currentStore = store || stores.find((item) => item.id === activeStoreId) || stores[0] || {};
  const scope = currentStore.scope || {};
  const scopeRange = scope.range || currentStore.range || "当前运营周期";
  const scopeObject = scope.object || currentStore.product || currentStore.asin || "未锁定产品";
  const reportStatus = currentStore.reportStatus || currentStore.reports || "报表状态待确认";
  const sessionLabel = currentStore.sessionLabel || currentStore.session || "会话待确认";

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__brand-mark" aria-hidden="true"><ShieldCheck size={18} weight="fill" /></span>
        <span className="topbar__brand-copy"><strong>{brand}</strong><small>{version}</small></span>
        <StatusPill tone="warning">{status}</StatusPill>
      </div>

      <div className="topbar__scope" aria-label="当前运营范围">
        <span className="topbar__scope-label">范围</span>
        <strong>{scopeRange}</strong>
        <span className="topbar__scope-divider" aria-hidden="true" />
        <span className="topbar__scope-object">{currentStore.marketplace || "站点待确认"} / {scopeObject}</span>
        <span className="topbar__scope-fact">{reportStatus}</span>
      </div>

      <div className="topbar__actions">
        <label className="topbar__store-select">
          <Storefront size={15} aria-hidden="true" />
          <span className="visually-hidden">切换店铺</span>
          <select
            aria-label="切换店铺"
            value={activeStoreId || currentStore.id || ""}
            onChange={(event) => onStoreChange?.(event.target.value)}
          >
            {stores.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}
          </select>
          <CaretDown size={12} aria-hidden="true" />
        </label>
        <span className="topbar__session" title={sessionLabel}>{sessionLabel}</span>
        <div className="topbar__mode" role="group" aria-label="执行模式">
          <button className={mode === "review" ? "is-active" : ""} onClick={() => onModeChange?.("review")} type="button">
            <UserCircle size={16} /><span>人工审批</span>
          </button>
          <button className={mode === "auto" ? "is-active" : ""} onClick={() => onModeChange?.("auto")} type="button">
            <Robot size={16} /><span>AI 全自动</span>
          </button>
        </div>
        {onSearch && <button aria-label="搜索" className="icon-button" onClick={onSearch} type="button"><MagnifyingGlass size={18} /></button>}
        {onOpenLedger && <button aria-label="运营账本" className="icon-button" onClick={onOpenLedger} type="button"><Bell size={18} /></button>}
        {onOpenInspector && <button aria-label="打开对象检查器" className="icon-button" onClick={onOpenInspector} type="button"><BookOpenText size={18} /></button>}
      </div>
    </header>
  );
}

export function Sidebar({ workspaces = [], route, badges = {}, onNavigate, footer }) {
  const activeWorkspace = typeof route === "string" ? route : route?.workspace;
  const groups = useMemo(() => {
    const result = [];
    workspaces.forEach((workspace) => {
      const label = workspace.group || "工作区";
      let group = result.find((item) => item.label === label);
      if (!group) {
        group = { label, items: [] };
        result.push(group);
      }
      group.items.push(workspace);
    });
    return result;
  }, [workspaces]);

  return (
    <aside className="app-sidebar">
      <nav className="sidebar-nav" aria-label="主业务导航">
        {groups.map((group) => (
          <section className="nav-group" key={group.label} aria-label={group.label}>
            <h2 className="nav-group-label">{group.label}</h2>
            <div className="nav-item-list" role="list">
              {group.items.map((workspace) => {
                const active = workspace.id === activeWorkspace;
                const badge = badges[workspace.id];
                return (
                  <div className="nav-item-shell" key={workspace.id} role="listitem">
                    <button
                      aria-current={active ? "page" : undefined}
                      className="nav-item"
                      onClick={() => onNavigate?.({
                        workspace: workspace.id,
                        subview: workspace.subviews?.[0]?.id,
                      })}
                      title={workspace.description || workspace.label}
                      type="button"
                    >
                      <span className="nav-item-label">{workspace.label}</span>
                      {badge !== undefined && badge !== null && badge !== 0 && <span className="nav-item-feedback">{badge}</span>}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </nav>
      {footer && <div className="sidebar-footer">{footer}</div>}
    </aside>
  );
}

export function WorkspacePageFrame({
  eyebrow,
  title,
  description,
  actions,
  task,
  children,
  className = "",
}) {
  const headingId = useId();
  return (
    <section className={cx("workspace-page-frame", className)} aria-labelledby={headingId}>
      {(eyebrow || title || description || actions) && (
        <header className="workspace-page-frame__header">
          <div className="workspace-page-frame__copy">
            {eyebrow && <span className="workspace-page-frame__eyebrow">{eyebrow}</span>}
            {title && <h1 id={headingId}>{title}</h1>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="workspace-page-frame__actions">{actions}</div>}
        </header>
      )}
      {task}
      <div className="workspace-page-frame__content">{children}</div>
    </section>
  );
}

export function WorkspaceTabs({ items = [], active, onChange, label = "工作区子视图" }) {
  if (items.length <= 1) return null;
  return (
    <div className="workspace-tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          aria-selected={item.id === active}
          className={item.id === active ? "is-active" : ""}
          key={item.id}
          onClick={() => onChange?.(item.id)}
          role="tab"
          type="button"
        >
          <span>{item.label}</span>
          {item.description && <small>{item.description}</small>}
        </button>
      ))}
    </div>
  );
}

export function TaskBanner({
  tone = "default",
  eyebrow = "当前主任务",
  title,
  description,
  detail,
  status,
  meta,
  actions,
  compact = false,
}) {
  return (
    <section className={cx("task-banner", `task-banner--${tone}`, compact && "task-banner--compact")} aria-label={eyebrow}>
      <div className="task-banner__copy">
        <span className="task-banner__eyebrow">{eyebrow}</span>
        <div className="task-banner__title-line">
          <h2>{title}</h2>
          {status && <StatusPill tone={tone}>{status}</StatusPill>}
        </div>
        {(description || detail) && <p>{description || detail}</p>}
        {meta && <small className="task-banner__meta">{meta}</small>}
      </div>
      {actions && <div className="task-banner__actions">{actions}</div>}
    </section>
  );
}

export function SummaryStrip({ items = [], ariaLabel = "关键指标" }) {
  return (
    <dl className="summary-strip" aria-label={ariaLabel}>
      {items.map((item, index) => (
        <div className="summary-strip__item" data-tone={item.tone || "default"} key={item.id || item.label || index}>
          <dt>{item.label}</dt>
          <dd><strong>{item.value ?? "—"}</strong>{item.suffix && <span>{item.suffix}</span>}</dd>
          {(item.detail || item.meta) && <small>{item.detail || item.meta}</small>}
        </div>
      ))}
    </dl>
  );
}

export function Panel({
  title,
  description,
  meta,
  status,
  actions,
  footer,
  children,
  tone = "default",
  flush = false,
  className = "",
}) {
  const titleId = useId();
  return (
    <section className={cx("workbench-panel", `workbench-panel--${tone}`, flush && "workbench-panel--flush", className)} aria-labelledby={title ? titleId : undefined}>
      {(title || description || status || actions) && (
        <header className="workbench-panel__header">
          <div className="workbench-panel__heading">
            <div className="workbench-panel__title-line">
              {title && <h2 id={titleId}>{title}</h2>}
              {status && (isValidElement(status) ? status : <StatusPill>{status}</StatusPill>)}
            </div>
            {(description || meta) && <p>{description || meta}</p>}
          </div>
          {actions && <div className="workbench-panel__toolbar">{actions}</div>}
        </header>
      )}
      <div className="workbench-panel__body">{children}</div>
      {footer && <footer className="workbench-panel__footer">{footer}</footer>}
    </section>
  );
}

export function Toolbar({ start, end, children, className = "", ariaLabel = "页面工具栏" }) {
  return (
    <div className={cx("workspace-toolbar", className)} role="toolbar" aria-label={ariaLabel}>
      <div className="workspace-toolbar__start">{start || children}</div>
      {end && <div className="workspace-toolbar__end">{end}</div>}
    </div>
  );
}

export function Button({
  variant = "secondary",
  icon: Icon,
  busy = false,
  busyLabel = "处理中…",
  children,
  className = "",
  type = "button",
  ...props
}) {
  return (
    <button
      {...props}
      aria-busy={busy || undefined}
      className={cx("workspace-button", `workspace-button--${variant}`, busy && "is-busy", className)}
      disabled={busy || props.disabled}
      type={type}
    >
      {busy ? <CircleNotch className="spin" size={16} /> : Icon ? <Icon size={16} /> : null}
      <span>{busy ? busyLabel : children}</span>
    </button>
  );
}

export function StatusPill({ tone = "neutral", children, className = "", ...props }) {
  return <span {...props} className={cx("status-pill", `status-pill--${tone}`, className)}>{children}</span>;
}

export function DataTable({
  columns = [],
  rows = [],
  rowKey = "id",
  selectedId,
  onRowClick,
  renderRowActions,
  empty = "暂无数据",
  loading = false,
  caption,
  minWidth = 720,
  status,
  className = "",
}) {
  const getKey = (row, index) => (typeof rowKey === "function" ? rowKey(row, index) : row?.[rowKey] ?? index);
  const colSpan = columns.length + (renderRowActions ? 1 : 0);
  return (
    <div className={cx("data-table-shell", className)}>
      <div className="data-table-scroll">
        <table className="data-table" style={{ "--table-min-width": `${minWidth}px` }}>
          {caption && <caption className="visually-hidden">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((column) => <th key={column.key} scope="col" style={column.width ? { width: column.width } : undefined}>{column.label}</th>)}
              {renderRowActions && <th className="data-table__actions" scope="col">操作</th>}
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 4 }).map((_, index) => (
              <tr className="data-table__skeleton" key={`loading-${index}`}><td colSpan={colSpan}><span /></td></tr>
            ))}
            {!loading && rows.map((row, index) => {
              const key = getKey(row, index);
              const selected = key === selectedId;
              return (
                <tr
                  aria-selected={selected || undefined}
                  className={cx(onRowClick && "is-interactive", selected && "is-selected")}
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onRowClick(row);
                    }
                  } : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                >
                  {columns.map((column) => {
                    const value = row?.[column.key];
                    return (
                      <td className={column.className} data-label={column.label} key={column.key}>
                        {column.render ? column.render(value, row, index) : value ?? "—"}
                      </td>
                    );
                  })}
                  {renderRowActions && <td className="data-table__actions" onClick={(event) => event.stopPropagation()}>{renderRowActions(row, index)}</td>}
                </tr>
              );
            })}
            {!loading && rows.length === 0 && <tr><td className="data-table__empty" colSpan={colSpan}>{empty}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="data-table__status" role="status" aria-live="polite">
        {status || (loading ? "正在加载数据…" : `显示 ${rows.length} 条记录`)}
      </div>
    </div>
  );
}

function withFieldProps(children, props) {
  if (!isValidElement(children)) return children;
  return cloneElement(children, {
    id: children.props.id || props.id,
    "aria-describedby": children.props["aria-describedby"] || props["aria-describedby"],
    "aria-invalid": children.props["aria-invalid"] || props["aria-invalid"],
    required: children.props.required ?? props.required,
  });
}

export function Field({
  label,
  hint,
  error,
  required = false,
  children,
  className = "",
  ...inputProps
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;
  const control = children
    ? withFieldProps(Children.only(children), { id, required, "aria-describedby": describedBy, "aria-invalid": Boolean(error) || undefined })
    : <input {...inputProps} aria-describedby={describedBy} aria-invalid={Boolean(error) || undefined} id={id} required={required} />;

  return (
    <label className={cx("field", error && "field--error", className)} htmlFor={id}>
      <span className="field__label"><strong>{label}{required && <em aria-hidden="true"> *</em>}</strong>{hint && <small id={hintId}>{hint}</small>}</span>
      <span className="field__control">{control}{error && <small className="field__error" id={errorId}>{error}</small>}</span>
    </label>
  );
}

export function SelectField({ label, hint, error, required, options = [], className = "", ...props }) {
  return (
    <Field className={className} error={error} hint={hint} label={label} required={required}>
      <select {...props}>
        {options.map((option) => {
          const item = typeof option === "string" ? { value: option, label: option } : option;
          return <option disabled={item.disabled} key={item.value} value={item.value}>{item.label}</option>;
        })}
      </select>
    </Field>
  );
}

export function TextAreaField({ label, hint, error, required, className = "", rows = 4, ...props }) {
  return (
    <Field className={className} error={error} hint={hint} label={label} required={required}>
      <textarea {...props} rows={rows} />
    </Field>
  );
}

export function Modal({
  title,
  description,
  open,
  onClose,
  footer,
  actions,
  children,
  size = "medium",
  dismissDisabled = false,
  className = "",
}) {
  const titleId = useId();
  const descriptionId = useId();
  const surfaceRef = useRef(null);
  useDialogKeyboard({ open, surfaceRef, onClose, dismissDisabled });
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !dismissDisabled) onClose?.();
      }}
    >
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={cx("modal", `modal--${size}`, className)}
        ref={surfaceRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="modal__header">
          <div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
          <button aria-label="关闭" className="icon-button" disabled={dismissDisabled} onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="modal__body">{children}</div>
        {(footer || actions) && <footer className="modal__footer">{footer || <div className="modal__footer-actions">{actions}</div>}</footer>}
      </section>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title = "确认操作",
  description,
  children,
  onClose,
  onConfirm,
  confirmLabel = "确认",
  cancelLabel = "取消",
  tone = "danger",
  busy = false,
}) {
  return (
    <Modal
      description={description}
      dismissDisabled={busy}
      footer={(
        <div className="modal__footer-actions">
          <Button disabled={busy} onClick={onClose}>{cancelLabel}</Button>
          <Button busy={busy} onClick={onConfirm} variant={tone === "danger" ? "danger" : "primary"}>{confirmLabel}</Button>
        </div>
      )}
      onClose={onClose}
      open={open}
      size="small"
      title={title}
    >
      <div className={cx("confirm-copy", `confirm-copy--${tone}`)}>
        {tone === "danger" ? <WarningCircle size={22} weight="fill" /> : <Info size={22} weight="fill" />}
        <div>{children || <p>此操作会更新当前对象，请确认后继续。</p>}</div>
      </div>
    </Modal>
  );
}

function InspectorSurface({ item = {}, onClose, children, drawer, dismissDisabled, surfaceRef }) {
  const titleId = useId();
  const title = item.title || item.name || item.object || "对象详情";
  const description = item.description || item.subtitle;
  const actions = item.actions || [];
  return (
    <aside
      aria-labelledby={titleId}
      aria-modal={drawer || undefined}
      className={cx("responsive-inspector", drawer ? "responsive-inspector--drawer" : "responsive-inspector--inline")}
      ref={surfaceRef}
      role={drawer ? "dialog" : "complementary"}
      tabIndex={-1}
    >
      <header className="responsive-inspector__header">
        <div className="responsive-inspector__heading">
          <span>对象检查器</span>
          <h2 id={titleId}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button aria-label="关闭检查器" className="icon-button" disabled={dismissDisabled} onClick={onClose} type="button"><X size={18} /></button>
      </header>
      <div className="responsive-inspector__body">
        {(item.status || item.id) && (
          <div className="inspector-meta">
            {item.status && <StatusPill tone={item.tone || "neutral"}>{item.status}</StatusPill>}
            {item.id && <code>{item.id}</code>}
          </div>
        )}
        {(item.before !== undefined || item.after !== undefined) && (
          <section className="inspector-change">
            <h3>变更内容</h3>
            <div><span><small>当前</small><strong>{item.before ?? "—"}</strong></span><span aria-hidden="true">→</span><span data-after="true"><small>建议</small><strong>{item.after ?? "—"}</strong></span></div>
          </section>
        )}
        {item.reason && <section className="inspector-section"><h3>判断原因</h3><p>{item.reason}</p></section>}
        {item.fields?.length > 0 && (
          <section className="inspector-section">
            <h3>{item.fieldsTitle || "对象事实"}</h3>
            <dl className="inspector-fields">
              {item.fields.map((field, index) => {
                const [label, value] = Array.isArray(field)
                  ? field
                  : [field.label || field.name, field.value ?? field.content];
                return <div key={field.id || label || index}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>;
              })}
            </dl>
          </section>
        )}
        {item.evidence?.length > 0 && (
          <section className="inspector-section">
            <h3>证据（{item.evidence.length}）</h3>
            <ul>{item.evidence.map((evidence, index) => <li key={evidence.id || evidence.label || index}><CheckCircle size={15} /><span>{evidence.label || evidence}</span></li>)}</ul>
          </section>
        )}
        {item.sections?.map((section, index) => (
          <section className="inspector-section" key={section.id || section.title || index}>
            {section.title && <h3>{section.title}</h3>}
            {section.content || section.children}
          </section>
        ))}
        {children}
      </div>
      {actions.length > 0 && (
        <footer className="responsive-inspector__footer">
          {actions.map((action, index) => (
            <Button
              busy={action.busy}
              disabled={action.disabled}
              key={action.id || action.label}
              onClick={action.onClick}
              variant={action.variant || (index === 0 ? "primary" : "secondary")}
            >{action.label}</Button>
          ))}
        </footer>
      )}
    </aside>
  );
}

export function Inspector({
  open,
  item,
  onClose,
  inline,
  children,
  dismissDisabled = false,
}) {
  const narrow = useMediaQuery("(max-width: 1399px)");
  const drawer = inline === undefined ? narrow : !inline;
  const surfaceRef = useRef(null);
  const previousContextRef = useRef(item?.contextKey ?? item?.workspaceId ?? item?.workspace);
  const contextKey = item?.contextKey ?? item?.workspaceId ?? item?.workspace;
  useDialogKeyboard({ open: open && drawer, surfaceRef, onClose, dismissDisabled });

  useEffect(() => {
    const previous = previousContextRef.current;
    if (open && previous !== undefined && contextKey !== undefined && previous !== contextKey) onClose?.();
    previousContextRef.current = contextKey;
  }, [contextKey, onClose, open]);

  if (!open || !item) return null;
  const surface = (
    <InspectorSurface
      dismissDisabled={dismissDisabled}
      drawer={drawer}
      item={item}
      onClose={onClose}
      surfaceRef={surfaceRef}
    >{children}</InspectorSurface>
  );

  if (!drawer || typeof document === "undefined") return surface;
  return createPortal(
    <div
      className="responsive-inspector__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !dismissDisabled) onClose?.();
      }}
    >{surface}</div>,
    document.body,
  );
}

export function EmptyState({
  icon: Icon = Archive,
  title = "暂无内容",
  description,
  detail,
  action,
  children,
}) {
  return (
    <div className="empty-state">
      <Icon size={28} />
      <strong>{title}</strong>
      {(description || detail) && <p>{description || detail}</p>}
      {action}
      {children}
    </div>
  );
}

export function SectionEmpty({ title = "暂无记录", description, detail, action }) {
  return (
    <div className="section-empty">
      <span><strong>{title}</strong>{(description || detail) && <small>{description || detail}</small>}</span>
      {action}
    </div>
  );
}

export function InlineFeedback({ tone = "info", title, children, className = "" }) {
  const Icon = tone === "success" ? CheckCircle : tone === "warning" || tone === "danger" ? WarningCircle : Info;
  return (
    <div className={cx("inline-feedback", `inline-feedback--${tone}`, className)} role={tone === "danger" ? "alert" : "status"}>
      <Icon size={17} weight="fill" />
      <span>{title && <strong>{title}</strong>}{children && <small>{children}</small>}</span>
    </div>
  );
}

export function ToastViewport({ toasts = [], onDismiss }) {
  return (
    <div className="toast-viewport" aria-label="通知" aria-live="polite">
      {toasts.map((toast) => (
        <div className={cx("toast", `toast--${toast.tone || "info"}`)} key={toast.id || toast.message} role="status">
          <span>{toast.title && <strong>{toast.title}</strong>}<small>{toast.message || toast.description}</small></span>
          {onDismiss && <button aria-label="关闭通知" onClick={() => onDismiss(toast.id)} type="button"><X size={15} /></button>}
        </div>
      ))}
    </div>
  );
}

export function SimulationNotice({ children = "交互原型：所有执行与回读均为模拟，不会写入真实 Amazon Ads。" }) {
  return <InlineFeedback className="simulation-notice" title="模拟环境" tone="warning">{children}</InlineFeedback>;
}
