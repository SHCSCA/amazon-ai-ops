import React from 'react';
import { useDataCollectionPage } from './collection-controller';
import { DataCollectionPageView } from './collection-view';

export function DataCollectionPage() {
  return <DataCollectionPageView {...useDataCollectionPage()} />;
}

export { type CollectionActionGuide, type LastActionResult, type CollectionMonitorState, type CollectionProgressPresentation, type CollectionJobWorkspaceAction, type CollectionImportPresentation, type CollectionJobWorkspaceRow, type CollectionJobLineagePresentation, type DataCollectionTaskState } from './collection-contracts';
export { createLingxingCollectionRequestId, buildAuthoritativeCollectionDateRange, resolveAuthoritativeCollectionCapture } from './collection-capture';
export { productionReportFileHasImportReceipt, dataCollectionFirstViewportReportFolder, collectionActionButtonLabel, collectionActionButtonDetail, collectionActionButtonBusyDetail, collectionActionButtonView, collectionFeedbackActionButtonView, collectionArtifactActionKey, collectionOpenArtifactButtonView, collectionReportSelectionState, buildDataCollectionTaskState, collectionActionGuide } from './collection-presentation';
export { buildCollectionJobLineagePresentation, buildCollectionImportPresentation, collectionJobBelongsToAuthority, collectionJobBelongsToStore, collectionActionFeedbackBelongsToAuthority, retainCollectionActionFeedback, upsertCollectionJobSnapshot, buildCollectionJobWorkspaceRow } from './collection-jobs';
export { collectionProgressBelongsToAuthority, buildCollectionProgressPresentation, buildCollectionMonitorState, buildActionProgressSteps } from './collection-progress';
export { CollectionMonitorDrawer } from './collection-monitor';
export { collectionActionError, shouldOfferDownloadCenterVerification, runCollectionDownloadAction } from './collection-download';
export { collectionActionNextStep, buildLastActionResult, collectionCompletionNotice, collectionActionResultStatusLabel } from './collection-results';
export { CollectionJobWorkspace } from './collection-queue';
