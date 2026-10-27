import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface ListingReadEvidence {
  pageUrl?: string;
  screenshotPath?: string;
  scope?: {
    storeName?: string;
    marketplaceCode?: string;
  };
  partialReady?: boolean;
  fullContentReady?: boolean;
  completeness?: {
    asin?: boolean;
    title?: boolean;
    bullets?: boolean;
    backendTerms?: boolean;
  };
  detailProbe?: {
    asinMatched?: boolean;
    status?: string;
    finalUrl?: string;
  };
}

export interface ListingAiStatus {
  label: string;
  detail: string;
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
}

export interface ListingDraftWorkspaceCopyInput {
  quantReady: boolean;
  keywordCount: number;
  draftCount: number;
  aiDraftCount: number;
  ruleDraftCount: number;
  aiStatusLabel: string;
  aiStatusDetail: string;
  loadingDraft?: boolean;
}

export interface ListingDraftWorkspaceCopy {
  keywordPlaceholder: string;
  keywordStatusLabel: string;
  dataGateLabel: string;
  dataGateDetail: string;
  dataGateTone: 'ready' | 'blocked';
  draftUseLabel: string;
  draftUseDetail: string;
  sourceLabel: string;
  sourceDetail: string;
  primaryActionLabel: string;
}

export type ListingTaskIntent =
  | 'edit-keywords'
  | 'keyword-opportunities'
  | 'edit-listing'
  | 'read-lingxing'
  | 'generate-draft'
  | 'export-draft';

export interface ListingTaskModel {
  tone: 'neutral' | 'attention' | 'blocked' | 'confirmed';
  title: string;
  description: string;
  statusLabel: string;
  primaryIntent: ListingTaskIntent;
  primaryLabel: string;
  primaryBusy: boolean;
  secondaryIntents: ListingTaskIntent[];
  publishBoundary: '仅本地，不提交 Amazon，不改写 Lingxing。';
}

export interface ListingHeatmapSection {
  key: string;
  label: string;
  currentText: string;
  draftText: string;
  currentHits: string[];
  draftHits: string[];
  charLimit?: number;
}

export interface ListingHeatmapKeyword {
  keyword: string;
  score: number;
  level: 'ready' | 'warning' | 'pending';
  levelLabel: string;
  hitSections: string[];
  recommendedSection: string;
  evidence: string;
}

export interface ListingHeatmapModel {
  keywords: ListingHeatmapKeyword[];
  sections: ListingHeatmapSection[];
  summary: {
    keywordCount: number;
    coveredCount: number;
    draftGainCount: number;
    missingCount: number;
  };
}

export interface ListingTextSegment {
  text: string;
  matchedKeyword?: string;
  active: boolean;
}

export interface ListingTextDiffSegment {
  text: string;
  kind: 'same' | 'removed' | 'added';
}

export interface ListingTextDiff {
  currentSegments: ListingTextDiffSegment[];
  draftSegments: ListingTextDiffSegment[];
}

export interface ListingLocalActionButtonInput {
  active: boolean;
  baseClassName: string;
  label: string;
  busyLabel: string;
  disabled?: boolean;
  groupBusy?: boolean;
}

export interface ListingLocalActionButtonView {
  ariaBusy?: true;
  className: string;
  disabled: boolean;
  label: string;
  showSpinner: boolean;
}

export interface ListingManualField {
  key: string;
  label: string;
  status: '必填' | '建议填写' | '可选';
}

export interface ListingManualFieldGroup {
  title: string;
  fields: ListingManualField[];
}
