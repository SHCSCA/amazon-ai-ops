import React from 'react';

export type TagMetricTone = 'ready' | 'warning' | 'blocked' | 'neutral';

export interface TagMetricItem {
  label: string;
  value?: string | number;
  detail?: string;
  tone?: TagMetricTone;
}

export function TagMetricGroup({ items }: { items: TagMetricItem[] }) {
  return (
    <div className="tag-metric-group">
      {items.map((item) => (
        <span className={`tag-metric tag-metric-${item.tone || 'neutral'}`} key={`${item.label}-${item.value ?? ''}`} title={item.detail}>
          <span>{item.label}</span>
          {item.value !== undefined && <strong>{item.value}</strong>}
        </span>
      ))}
    </div>
  );
}
