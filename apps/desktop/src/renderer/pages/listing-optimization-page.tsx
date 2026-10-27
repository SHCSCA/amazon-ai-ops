import React from 'react';
import { useListingOptimizationPage } from './listing-controller';
import { ListingOptimizationPageView } from './listing-view';

export function ListingOptimizationPage() { return <ListingOptimizationPageView {...useListingOptimizationPage()} />; }

export { type ListingDraftWorkspaceCopy, type ListingTaskIntent, type ListingTaskModel, type ListingTextSegment, type ListingTextDiffSegment, type ListingTextDiff, type ListingLocalActionButtonView, type ListingManualField, type ListingManualFieldGroup } from './listing-contracts';
export { buildListingTaskModel } from './listing-task-model';
export { listingLocalActionButtonView, listingHistoryRefreshButtonView } from './listing-actions';
export { listingDraftPanelClass, listingCharacterLimitClass, listingHeatmapKeywordButtonClass, listingHeatmapSectionClass, listingHeatmapTokenClass, listingDraftGenerationMessage, listingDraftWorkspaceCopy } from './listing-presentation';
export { buildListingHeatmapModel, highlightListingTextSegments, buildListingHeatmapFocusAnnouncement } from './listing-heatmap';
export { buildListingTextDiffSegments } from './listing-text-diff';
export { listingManualFieldGroups } from './listing-content';
