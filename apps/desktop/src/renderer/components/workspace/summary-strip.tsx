import React from 'react';
import type { WorkspaceTone } from './types';

export type SummaryStripItem = {
  id: string;
  label: React.ReactNode;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: WorkspaceTone;
};

export type SummaryStripProps = {
  items: SummaryStripItem[];
  ariaLabel?: string;
};

export function SummaryStrip({ items, ariaLabel = '当前工作摘要' }: SummaryStripProps) {
  return (
    <dl aria-label={ariaLabel} className="summary-strip">
      {items.slice(0, 4).map((item) => (
        <div
          className="summary-strip__item"
          data-summary-item="true"
          data-tone={item.tone ?? 'neutral'}
          key={item.id}
        >
          <dt>{item.label}</dt>
          <dd>
            <strong>{item.value}</strong>
            {item.detail && <small>{item.detail}</small>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
