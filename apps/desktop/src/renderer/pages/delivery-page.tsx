import React from 'react';
import { useDeliveryPage } from './delivery-controller';
import { DeliveryPageView } from './delivery-view';

export function DeliveryPage() {
  return <DeliveryPageView {...useDeliveryPage()} />;
}

export { deliveryPreviewState, DeliveryPreviewNotice, deliverySummaryStatusLabel, deliveryTextForDisplay, packageEvidenceSummary, canExportDeliveryBundle, buildEvidenceGovernanceFacts, buildDeliveryOverviewFacts, readinessBlockerTexts, buildManifestActions } from './delivery-presentation';
export { deliveryReadbackVerifierPassed, runDeliveryWorkflowMutation, deliveryActionButtonView, deliveryOpenPathButtonView, deliveryCopySummaryActionView } from './delivery-actions';
export { type DeliveryPreviewState, type DeliveryActionKey, type DeliveryActionButtonView } from './delivery-contracts';
export { readbackSessionStatusCopy, findReadbackBlockerGate, readbackBlockerSummary, buildDeliveryReadbackRepairIntent } from './delivery-readback';
export { buildDeliveryItems } from './delivery-evidence';
