import React from 'react';

export type TagMetricTone = 'ready' | 'warning' | 'blocked' | 'neutral';

export interface TagMetricItem {
  key?: string;
  label: string;
  value?: string | number;
  detail?: string;
  tone?: TagMetricTone;
  disabled?: boolean;
}

export function TagMetricGroup({
  items,
  activeKey,
  ariaLabel,
  onSelect,
}: {
  items: TagMetricItem[];
  activeKey?: string;
  ariaLabel?: string;
  onSelect?: (item: TagMetricItem) => void;
}) {
  return (
    <div aria-label={ariaLabel} className="tag-metric-group">
      {items.map((item) => {
        const metricKey = item.key || '';
        const interactive = Boolean(metricKey && onSelect);
        const className = [
          'tag-metric',
          `tag-metric-${item.tone || 'neutral'}`,
          interactive ? 'tag-metric-action' : '',
          activeKey && metricKey === activeKey ? 'tag-metric-active' : '',
        ].filter(Boolean).join(' ');
        const content = (
          <>
            <span>{item.label}</span>
            {item.value !== undefined && <strong>{item.value}</strong>}
          </>
        );
        if (interactive) {
          return (
            <button
              aria-pressed={metricKey === activeKey}
              className={className}
              disabled={item.disabled}
              key={`${item.label}-${item.value ?? ''}-${metricKey}`}
              onClick={() => onSelect?.(item)}
              title={item.detail}
              type="button"
            >
              {content}
            </button>
          );
        }
        return (
          <span className={className} key={`${item.label}-${item.value ?? ''}-${metricKey}`} title={item.detail}>
            {content}
          </span>
        );
      })}
    </div>
  );
}
