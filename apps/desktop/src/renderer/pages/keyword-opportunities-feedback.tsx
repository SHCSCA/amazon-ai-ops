import React from 'react';
import type { AppRoute } from '../types';
import { toUserFacingError } from '../user-facing-error';
import {
  type KeywordOpportunitySortState,
  type KeywordOpportunityActionButtonInput,
  type KeywordOpportunityActionButtonView,
} from "./keyword-opportunities-contracts";

export function errorMessage(caught: unknown, fallback: string): string {
  return `${fallback}: ${toUserFacingError(caught, fallback)}`;
}

export function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

export function buildKeywordOpportunityFilterFeedback(input: {
  activeFilterCount: number;
  sortDirection: KeywordOpportunitySortState['direction'];
  sortLabel: string;
  totalCount: number;
  visibleCount: number;
}): string {
  const filterText = input.activeFilterCount > 0
    ? `已应用 ${input.activeFilterCount} 个筛选条件`
    : '未设置筛选条件';
  const directionText = input.sortDirection === 'asc' ? '升序' : '降序';
  return `${filterText}，按${input.sortLabel}${directionText}展示 ${input.visibleCount}/${input.totalCount} 个机会。`;
}

export function keywordOpportunityTableFeedbackClass(refreshing: boolean): string {
  return refreshing
    ? 'keyword-opportunity-table-shell keyword-opportunity-table-refreshing'
    : 'keyword-opportunity-table-shell';
}

export function KeywordOpportunityFilterCell({
  children,
  hint,
  label,
}: {
  children: React.ReactNode;
  hint: string;
  label: string;
}) {
  return (
    <label className="keyword-filter-cell">
      <span className="keyword-filter-cell-label">{label}</span>
      <span className="keyword-filter-cell-control">{children}</span>
      <span className="keyword-filter-cell-hint">{hint}</span>
    </label>
  );
}

export function keywordOpportunityActionButtonView({
  active,
  baseClassName,
  label,
  busyLabel,
  disabled = false,
  groupBusy = false,
}: KeywordOpportunityActionButtonInput): KeywordOpportunityActionButtonView {
  return {
    ariaBusy: active ? true : undefined,
    className: [baseClassName, active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(disabled || active || groupBusy),
    label: active ? busyLabel : label,
    showSpinner: active,
  };
}
