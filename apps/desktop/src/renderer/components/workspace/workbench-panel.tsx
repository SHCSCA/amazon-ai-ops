import React from 'react';

export type WorkbenchPanelProps = {
  title: string;
  description?: React.ReactNode;
  toolbar?: React.ReactNode;
  status?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
};

function workbenchIdSeed(value: string): string {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash.toString(36);
}

export function WorkbenchPanel({
  title,
  description,
  toolbar,
  status,
  children,
  footer,
  className,
}: WorkbenchPanelProps) {
  const seed = workbenchIdSeed(title);
  const titleId = `workbench-${seed}-title`;
  const descriptionId = description ? `workbench-${seed}-description` : undefined;

  return (
    <section
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={`workbench-panel${className ? ` ${className}` : ''}`}
    >
      <header className="workbench-panel__header">
        <div className="workbench-panel__heading">
          <div className="workbench-panel__title-line">
            <h2 id={titleId}>{title}</h2>
            {status && <span className="workbench-panel__status" role="status" aria-live="polite">{status}</span>}
          </div>
          {description && <div className="workbench-panel__description" id={descriptionId}>{description}</div>}
        </div>
        {toolbar && <div aria-label={`${title}工具栏`} className="workbench-panel__toolbar" role="toolbar">{toolbar}</div>}
      </header>
      <div className="workbench-panel__body">{children}</div>
      {footer && <footer className="workbench-panel__footer">{footer}</footer>}
    </section>
  );
}
