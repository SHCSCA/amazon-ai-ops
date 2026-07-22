import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
} from "react";
import {
  CircleNotch,
  Tray,
  X,
} from "@phosphor-icons/react";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export function Button({
  children,
  className,
  variant = "secondary",
  size = "medium",
  loading = false,
  leadingIcon: LeadingIcon,
  trailingIcon: TrailingIcon,
  disabled,
  type = "button",
  ...props
}) {
  return (
    <button
      {...props}
      type={type}
      className={joinClassNames("button", variant, `button-${variant}`, size === "small" && "compact", `button-${size}`, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <CircleNotch className="button-progress-icon" size={16} weight="bold" aria-hidden="true" />
      ) : LeadingIcon ? (
        <LeadingIcon className="button-leading-icon" size={16} aria-hidden="true" />
      ) : null}
      <span className="button-label">{children}</span>
      {!loading && TrailingIcon ? (
        <TrailingIcon className="button-trailing-icon" size={16} aria-hidden="true" />
      ) : null}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  children,
  className,
  variant = "ghost",
  size = "medium",
  loading = false,
  disabled,
  type = "button",
  ...props
}) {
  const accessibleLabel = label || props["aria-label"];
  return (
    <button
      {...props}
      type={type}
      className={joinClassNames("icon-button", `icon-button-${variant}`, `icon-button-${size}`, className)}
      aria-label={accessibleLabel}
      title={props.title || accessibleLabel}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <CircleNotch className="icon-button-progress" size={18} weight="bold" aria-hidden="true" />
      ) : Icon ? (
        <Icon size={18} aria-hidden="true" />
      ) : (
        children
      )}
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
  icon: Icon,
  role,
  ...props
}) {
  return (
    <span
      {...props}
      className={joinClassNames("badge", tone, `badge-${tone}`, className)}
      data-tone={tone}
      role={role}
    >
      {Icon ? <Icon size={13} weight="fill" aria-hidden="true" /> : null}
      <span>{children}</span>
    </span>
  );
}

export function Panel({
  as: Component = "section",
  eyebrow,
  title,
  description,
  actions,
  footer,
  children,
  className,
  ...props
}) {
  const titleId = useId();
  const descriptionId = useId();
  const labelledBy = title ? titleId : props["aria-labelledby"];
  const describedBy = description ? descriptionId : props["aria-describedby"];

  return (
    <Component
      {...props}
      className={joinClassNames("panel", className)}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      {eyebrow || title || description || actions ? (
        <header className="panel-header">
          <div className="panel-heading">
            {eyebrow ? <span className="panel-eyebrow">{eyebrow}</span> : null}
            {title ? <h2 id={titleId}>{title}</h2> : null}
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="panel-body">{children}</div>
      {footer ? <footer className="panel-footer">{footer}</footer> : null}
    </Component>
  );
}

export function Field({
  label,
  hint,
  error,
  required = false,
  children,
  className,
  htmlFor,
}) {
  const generatedId = useId();
  const hintId = useId();
  const errorId = useId();
  const child = Children.count(children) === 1 ? Children.only(children) : children;
  const controlId = htmlFor || (isValidElement(child) && child.props.id) || generatedId;
  const describedBy = [
    isValidElement(child) ? child.props["aria-describedby"] : null,
    hint ? hintId : null,
    error ? errorId : null,
  ].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(child)
    ? cloneElement(child, {
        id: controlId,
        required: required || child.props.required || undefined,
        "aria-required": required || child.props["aria-required"] || undefined,
        "aria-invalid": error ? true : child.props["aria-invalid"],
        "aria-describedby": describedBy,
      })
    : child;

  return (
    <div className={joinClassNames("field", error && "field-invalid", className)}>
      <label className="field-label" htmlFor={controlId}>
        <span>{label}</span>
        {required ? <span className="field-required" aria-hidden="true">必填</span> : null}
      </label>
      <div className="field-control">{control}</div>
      {hint ? <p className="field-hint" id={hintId}>{hint}</p> : null}
      {error ? <p className="field-error" id={errorId} role="alert">{error}</p> : null}
    </div>
  );
}

function useDismissOnEscape(open, onClose) {
  useEffect(() => {
    if (!open || !onClose) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "medium",
  className,
  closeLabel = "关闭对话框",
}) {
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef(null);
  const modalRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef(null);
  const lastFocusRef = useRef(null);
  const wasOpenRef = useRef(false);

  if (open && !wasOpenRef.current && typeof document !== "undefined") {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    const modal = modalRef.current;
    if (!modal) return undefined;

    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled]):not([type='hidden'])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const getFocusable = () =>
      Array.from(modal.querySelectorAll(focusableSelector)).filter(
        (element) =>
          !element.closest("[hidden], [aria-hidden='true']") &&
          element.getClientRects().length > 0,
      );

    const focusInitialControl = () => {
      const focused = document.activeElement;
      const focusable = getFocusable();
      const target =
        (focused instanceof HTMLElement && modal.contains(focused) && focused) ||
        modal.querySelector("[autofocus]") ||
        focusable[0] ||
        closeRef.current ||
        modal;
      target.focus({ preventScroll: true });
      lastFocusRef.current = target;
    };

    const frame = window.requestAnimationFrame(focusInitialControl);

    const handleKeyDown = (event) => {
      const openDialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'));
      if (openDialogs[openDialogs.length - 1] !== modal) return;
      if (event.key === "Escape") {
        if (onCloseRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onCloseRef.current();
        }
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        modal.focus({ preventScroll: true });
        lastFocusRef.current = modal;
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !modal.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !modal.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    const handleFocusIn = (event) => {
      const openDialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'));
      if (openDialogs[openDialogs.length - 1] !== modal) return;
      if (modal.contains(event.target)) {
        lastFocusRef.current = event.target;
        return;
      }
      const fallback =
        (lastFocusRef.current && modal.contains(lastFocusRef.current)
          ? lastFocusRef.current
          : getFocusable()[0]) || modal;
      fallback.focus({ preventScroll: true });
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn, true);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      const returnTarget = returnFocusRef.current;
      if (returnTarget?.isConnected) {
        returnTarget.focus({ preventScroll: true });
      }
      lastFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={modalRef}
        className={joinClassNames("modal", `modal-${size}`, className)}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div className="modal-heading">
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <IconButton ref={closeRef} icon={X} label={closeLabel} onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = "right",
  className,
}) {
  const titleId = useId();
  const descriptionId = useId();
  useDismissOnEscape(open, onClose);
  if (!open) return null;

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className={joinClassNames("drawer", `drawer-${side}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          <div className="drawer-heading">
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <IconButton icon={X} label="关闭抽屉" onClick={onClose} />
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <footer className="drawer-footer">{footer}</footer> : null}
      </aside>
    </div>
  );
}

export function EmptyState({
  icon: Icon = Tray,
  title = "暂无数据",
  description,
  action,
  className,
}) {
  return (
    <div className={joinClassNames("empty-state", className)}>
      <span className="empty-state-icon"><Icon size={28} aria-hidden="true" /></span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}

function readCellValue(row, column) {
  if (column.render) return column.render(row);
  if (typeof column.accessor === "function") return column.accessor(row);
  return row?.[column.accessor || column.key];
}

export function DataTable({
  columns = [],
  rows = [],
  rowKey = "id",
  caption,
  emptyTitle = "暂无记录",
  emptyDescription,
  emptyAction,
  loading = false,
  onRowClick,
  getRowClassName,
  className,
}) {
  if (!loading && rows.length === 0) {
    return (
      <EmptyState
        className={joinClassNames("data-table-empty", className)}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return (
    <div className={joinClassNames("data-table-wrap", "data-table-shell", className)}>
      <table className="data-table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key || column.accessor}
                scope="col"
                className={column.className}
                style={column.width ? { width: column.width } : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 4 }, (_, index) => (
                <tr className="data-table-loading-row" key={`loading-${index}`} aria-hidden="true">
                  {columns.map((column) => <td key={column.key || column.accessor}><span className="data-table-loading-cell" /></td>)}
                </tr>
              ))
            : rows.map((row, index) => {
                const key = typeof rowKey === "function" ? rowKey(row, index) : row[rowKey] ?? index;
                const interactive = Boolean(onRowClick);
                return (
                  <tr
                    key={key}
                    className={joinClassNames(interactive && "data-table-row-interactive", getRowClassName?.(row, index))}
                    tabIndex={interactive ? 0 : undefined}
                    onClick={interactive ? () => onRowClick(row) : undefined}
                    onKeyDown={interactive ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    } : undefined}
                  >
                    {columns.map((column) => (
                      <td key={column.key || column.accessor} className={column.cellClassName}>
                        {readCellValue(row, column) ?? "—"}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
      </table>
      {!loading ? <p className="data-table-count" role="status">共 {rows.length} 条记录</p> : null}
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = "确认操作",
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  tone = "danger",
  loading = false,
  confirmDisabled = false,
  children,
}) {
  return (
    <Modal
      open={open}
      onClose={loading ? undefined : onClose}
      title={title}
      description={description}
      size="small"
      className={joinClassNames("confirm-dialog", `confirm-dialog-${tone}`)}
      footer={(
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose} disabled={loading}>{cancelLabel}</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading} disabled={loading || confirmDisabled}>{confirmLabel}</Button>
        </div>
      )}
    >
      {children}
    </Modal>
  );
}
