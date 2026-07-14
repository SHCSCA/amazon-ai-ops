import React from 'react';

export type PageFrameProps = {
  title: string;
  description?: React.ReactNode;
  task?: React.ReactNode;
  summary?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  pageId?: string;
};

function pageFrameIdSeed(value: string): string {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash.toString(36);
}

export function PageFrame({
  title,
  description,
  task,
  summary,
  children,
  className,
  pageId,
}: PageFrameProps) {
  const idSeed = pageId ?? pageFrameIdSeed(title);
  const titleId = `workspace-page-${idSeed}-title`;
  const descriptionId = description ? `workspace-page-${idSeed}-description` : undefined;

  return (
    <section
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={`workspace-page-frame${className ? ` ${className}` : ''}`}
      data-workspace-page={pageId || undefined}
    >
      <header className="workspace-page-frame__header">
        <h1 id={titleId}>{title}</h1>
        {description && <div className="workspace-page-frame__description" id={descriptionId}>{description}</div>}
      </header>
      {task && <div className="workspace-page-frame__task">{task}</div>}
      {summary && <div className="workspace-page-frame__summary">{summary}</div>}
      <div className="workspace-page-frame__content">{children}</div>
    </section>
  );
}
