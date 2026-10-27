import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AppRoute, ListingContentVersionView, ListingContentView, ListingDraftView, ListingHandoffPayload, ListingSection, ListingSuggestionView } from '../types';
import { toUserFacingError } from '../user-facing-error';
import { type ListingLocalActionButtonInput, type ListingLocalActionButtonView } from './listing-contracts';

export function listingLocalActionButtonView({
  active,
  baseClassName,
  label,
  busyLabel,
  disabled = false,
  groupBusy = false,
}: ListingLocalActionButtonInput): ListingLocalActionButtonView {
  return {
    ariaBusy: active ? true : undefined,
    className: [baseClassName, active ? 'button-loading' : ''].filter(Boolean).join(' '),
    disabled: Boolean(disabled || active || groupBusy),
    label: active ? busyLabel : label,
    showSpinner: active,
  };
}

export function listingHistoryRefreshButtonView(input: {
  active: boolean;
  canRefresh: boolean;
  groupBusy?: boolean;
}): ListingLocalActionButtonView {
  return listingLocalActionButtonView({
    active: input.active,
    baseClassName: 'secondary-button',
    busyLabel: '刷新中...',
    disabled: !input.canRefresh,
    groupBusy: input.groupBusy,
    label: '刷新版本历史',
  });
}

export function errorMessage(caught: unknown, fallback: string): string {
  return `${fallback}: ${toUserFacingError(caught, fallback)}`;
}

export function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}
