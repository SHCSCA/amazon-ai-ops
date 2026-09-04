import React from 'react';
import { CheckCircle, Warning } from '@phosphor-icons/react';

/**
 * ReadbackGateIndicator — renders a single `role="status"` strip showing whether
 * all 7 execution gates are open, or listing every blocker.
 *
 * Placement: inside the `execution-live-stage` section, above the detail tab list,
 * so the operator always sees the gate status regardless of which tab is active.
 *
 * Visual contract:
 * - 0 blockers  → green strip, "全部回读安全门已通过"
 * - ≥1 blockers → red strip, each blocker as a separate line item
 * - aria-live="polite" so screen readers announce the update without interrupting
 */

export interface ReadbackGateIndicatorProps {
  blockers: readonly string[];
  /** Pass true to show a compact single-line version. */
  compact?: boolean;
}

export function ReadbackGateIndicator({
  blockers,
  compact = false,
}: ReadbackGateIndicatorProps) {
  const open = blockers.length === 0;

  if (compact) {
    return (
      <div
        className="execution-gate-indicator"
        data-gate-open={open ? 'true' : undefined}
        data-gate-blocked={open ? undefined : 'true'}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label="回读安全门状态"
      >
        {open ? (
          <span className="execution-gate-indicator__pass">
            <CheckCircle size={14} weight="fill" aria-hidden="true" />
            全部回读安全门已通过
          </span>
        ) : (
          <span className="execution-gate-indicator__fail">
            <Warning size={14} weight="fill" aria-hidden="true" />
            {blockers[0]}
            {blockers.length > 1 && ` (+${blockers.length - 1} 项)`}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="execution-gate-indicator"
      data-gate-open={open ? 'true' : undefined}
      data-gate-blocked={open ? undefined : 'true'}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="回读安全门状态"
    >
      {open ? (
        <div className="execution-gate-indicator__header">
          <CheckCircle size={16} weight="fill" aria-hidden="true" />
          <strong>全部回读安全门已通过</strong>
          <span>执行回读条件满足，可进行交付验收。</span>
        </div>
      ) : (
        <>
          <div className="execution-gate-indicator__header">
            <Warning size={16} weight="fill" aria-hidden="true" />
            <strong>执行回读仍被阻断</strong>
            <span>补齐以下条件后再进行交付验收：</span>
          </div>
          <ul className="execution-gate-indicator__list" aria-label="阻断清单">
            {blockers.map((blocker, index) => (
              <li key={index}>{blocker}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
