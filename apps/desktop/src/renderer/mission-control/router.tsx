import React from 'react';
import type {
  MissionControlCapabilityProjection,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { AdQuantPage } from '../pages/ad-quant-page';
import { DashboardPage } from '../pages/dashboard-page';
import { DataCollectionPage } from '../pages/data-collection-page';
import { DataImportValidationPage } from '../pages/data-import-validation-page';
import { DecisionsPage } from '../pages/decisions-page';
import { DeliveryPage } from '../pages/delivery-page';
import { KeywordOpportunitiesPage } from '../pages/keyword-opportunities-page';
import { ListingOptimizationPage } from '../pages/listing-optimization-page';
import { OperationEventsPage } from '../pages/operation-events-page';
import { OperationScopePage } from '../pages/operation-scope-page';
import { ProductConfigPage } from '../pages/product-config-page';
import { ProductManagementPage } from '../pages/product-management-page';
import { ReadbackPage } from '../pages/readback-page';
import { SchedulerPage } from '../pages/scheduler-page';
import { SettingsPage } from '../pages/settings-page';
import type { NavigationIntent } from '../navigation';
import type { NextSafeAction } from '../workflow-state';
import type { AppRoute } from '../types';
import type { ReadbackAuthority } from '../pages/readback-workspace-model';
import { LegacyAdapterBoundary } from './legacy-boundary';

export interface LegacyAdapterRouterProps {
  route: AppRoute;
  intent: NavigationIntent;
  storeContext: StoreContextEnvelope;
  capabilities: readonly MissionControlCapabilityProjection[];
  nextSafeAction: NextSafeAction;
  readbackAuthority: ReadbackAuthority;
  previewMode: boolean;
  previewScenarioId?: string;
}

export function resolveLegacyCapability(
  capabilities: readonly MissionControlCapabilityProjection[],
  route: AppRoute,
  intent: NavigationIntent,
): MissionControlCapabilityProjection | undefined {
  const view = `${intent.workspace}/${intent.subview}`;
  return capabilities.find((capability) => (
    capability.workspace === intent.workspace
      && capability.view === view
      && capability.action === 'view'
      && capability.legacyRoute === route
  ));
}

function LegacyRoutePage({
  route,
  intent,
  nextSafeAction,
  readbackAuthority,
  previewScenarioId,
}: Pick<LegacyAdapterRouterProps, 'route' | 'intent' | 'nextSafeAction' | 'readbackAuthority' | 'previewScenarioId'>) {
  switch (route) {
    case 'dashboard':
      return <DashboardPage nextSafeAction={nextSafeAction} />;
    case 'product-management':
      return <ProductManagementPage />;
    case 'product-config':
      return <ProductConfigPage />;
    case 'operation-events':
      return <OperationEventsPage />;
    case 'operation-scope':
      return <OperationScopePage />;
    case 'data-collection':
      return <DataCollectionPage />;
    case 'data-import-validation':
      return <DataImportValidationPage />;
    case 'ad-quant':
      return <AdQuantPage />;
    case 'recommendations':
    case 'approval':
      if (intent.workspace !== 'decisions') return null;
      return <DecisionsPage activeSubview={intent.subview} />;
    case 'readback':
      return <ReadbackPage authority={readbackAuthority} previewScenarioId={previewScenarioId} />;
    case 'keyword-opportunities':
      return <KeywordOpportunitiesPage />;
    case 'listing-optimization':
      return <ListingOptimizationPage />;
    case 'settings':
      return <SettingsPage />;
    case 'scheduler':
      return <SchedulerPage />;
    case 'delivery':
      return <DeliveryPage />;
    default: {
      const exhaustive: never = route;
      return exhaustive;
    }
  }
}

export function LegacyAdapterRouter(props: LegacyAdapterRouterProps) {
  const capability = resolveLegacyCapability(props.capabilities, props.route, props.intent);
  return (
    <LegacyAdapterBoundary
      capability={capability}
      intent={props.intent}
      previewMode={props.previewMode}
      route={props.route}
      storeContext={props.storeContext}
    >
      <LegacyRoutePage
        intent={props.intent}
        nextSafeAction={props.nextSafeAction}
        previewScenarioId={props.previewScenarioId}
        readbackAuthority={props.readbackAuthority}
        route={props.route}
      />
    </LegacyAdapterBoundary>
  );
}
