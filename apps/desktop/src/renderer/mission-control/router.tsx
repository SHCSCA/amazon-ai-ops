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

const EXACT_ROUTE_REQUIREMENTS: Partial<Record<AppRoute, ReadonlyArray<{
  capabilityId: string;
  action: MissionControlCapabilityProjection['action'];
}>>> = {
  'operation-scope': [
    { capabilityId: 'collection.scope.view', action: 'view' },
    { capabilityId: 'collection.scope.update', action: 'update' },
  ],
  'data-collection': [
    { capabilityId: 'collection.reports.view', action: 'view' },
    { capabilityId: 'collection.reports.start', action: 'start' },
    { capabilityId: 'collection.reports.resume', action: 'resume' },
    { capabilityId: 'collection.reports.cancel', action: 'pause' },
    { capabilityId: 'collection.reports.import', action: 'import' },
    { capabilityId: 'collection.reports.open-artifact', action: 'view' },
  ],
  'data-import-validation': [
    { capabilityId: 'collection.import-check.view', action: 'view' },
    { capabilityId: 'collection.import-check.import', action: 'import' },
    { capabilityId: 'collection.import-check.export', action: 'export' },
    { capabilityId: 'collection.import-check.open-artifact', action: 'view' },
  ],
  'scheduler': [
    { capabilityId: 'settings.scheduler.view', action: 'view' },
    { capabilityId: 'settings.scheduler.run-now', action: 'start' },
    { capabilityId: 'settings.scheduler.retention-preview', action: 'view' },
  ],
};

/**
 * A legacy route may contain real mutations even though its navigation entry
 * is a view. Production mounts it only when every exact action is projected
 * for the same canonical view; DEV prototype routes keep their isolated
 * in-memory boundary.
 */
export function resolveLegacyRouteCapability(
  capabilities: readonly MissionControlCapabilityProjection[],
  route: AppRoute,
  intent: NavigationIntent,
  previewMode = false,
): MissionControlCapabilityProjection | undefined {
  const viewCapability = resolveLegacyCapability(capabilities, route, intent);
  if (!viewCapability || previewMode || viewCapability.state !== 'LEGACY_ADAPTER') return viewCapability;
  const requirements = EXACT_ROUTE_REQUIREMENTS[route];
  if (!requirements?.length) return viewCapability;
  const view = `${intent.workspace}/${intent.subview}`;
  const missing = requirements.filter((requirement) => !capabilities.some((capability) => (
    capability.capabilityId === requirement.capabilityId
    && capability.view === view
    && capability.action === requirement.action
    && (
      (capability.state === 'LEGACY_ADAPTER' && capability.legacyRoute === route)
      || capability.state === 'PRODUCTION_NATIVE'
    )
  )));
  if (missing.length === 0) return viewCapability;
  return {
    ...viewCapability,
    state: 'BLOCKED',
    blockerCode: 'EXACT_LEGACY_ACTION_CAPABILITIES_MISSING',
    detail: `该页面含真实写操作，缺少精确动作授权：${missing.map((item) => item.capabilityId).join('、')}。`,
  };
}

function LegacyRoutePage({
  route,
  intent,
  nextSafeAction,
  readbackAuthority,
  previewScenarioId,
  storeContext,
  capabilities,
  previewMode,
}: Pick<
  LegacyAdapterRouterProps,
  | 'route'
  | 'intent'
  | 'nextSafeAction'
  | 'readbackAuthority'
  | 'previewScenarioId'
  | 'storeContext'
  | 'capabilities'
  | 'previewMode'
>) {
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
      return <OperationScopePage storeContext={storeContext} />;
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
      return <SettingsPage embedded />;
    case 'scheduler':
      return (
        <SchedulerPage
          capabilities={capabilities}
          previewMode={previewMode}
          storeContext={storeContext}
        />
      );
    case 'delivery':
      return <DeliveryPage />;
    default: {
      const exhaustive: never = route;
      return exhaustive;
    }
  }
}

export function LegacyAdapterRouter(props: LegacyAdapterRouterProps) {
  const capability = resolveLegacyRouteCapability(
    props.capabilities,
    props.route,
    props.intent,
    props.previewMode,
  );
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
        capabilities={props.capabilities}
        nextSafeAction={props.nextSafeAction}
        previewMode={props.previewMode}
        previewScenarioId={props.previewScenarioId}
        readbackAuthority={props.readbackAuthority}
        route={props.route}
        storeContext={props.storeContext}
      />
    </LegacyAdapterBoundary>
  );
}
