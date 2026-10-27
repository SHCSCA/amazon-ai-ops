import React, { useId } from 'react';

export function WorkspaceActionButton({ disabled, disabledReason, busy, busyLabel = '处理中…', children, className, ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { disabledReason: string; busy?: boolean; busyLabel?: string }) {
  const reasonId = useId();
  const unavailable = Boolean(disabled || busy);
  return <span className="task-banner__action-shell">
    <button {...props} aria-busy={busy || props['aria-busy'] || undefined} aria-describedby={unavailable ? reasonId : props['aria-describedby']}
      className={[className, busy ? 'button-loading' : undefined].filter(Boolean).join(' ') || undefined}
      disabled={unavailable} type={props.type ?? 'button'}>{busy && <span aria-hidden="true" className="button-spinner" />}{busy ? busyLabel : children}</button>
    {unavailable && <span className="task-banner__disabled-reason" id={reasonId}>{disabledReason}</span>}
  </span>;
}

export function createWorkspaceActionAdmission() {
  let authorityKey = '';
  let generation = 0;
  let active: number | undefined;
  return {
    update(next: string) {
      if (next !== authorityKey) { authorityKey = next; generation += 1; active = undefined; }
    },
    tryEnter(): (() => void) | undefined {
      if (active !== undefined) return undefined;
      const token = ++generation;
      active = token;
      return () => { if (active === token) active = undefined; };
    },
  };
}
