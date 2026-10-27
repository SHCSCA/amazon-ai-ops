// 历史预览纯夹具测试保留原有启用限制与完整断言。

import { createElement } from 'react';

import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { MISSION_CONTROL_LEGACY_ROUTE_IDS, type ActionRecommendation, type MissionControlLegacyRouteId, type MissionControlViewId, } from '@amazon-ai-ops/shared-types';

import { getRecommendationApprovalBlockers } from '../main/recommendation-approval-policy';

import * as PreviewModule from './dev-preview-api';

import { LegacyAdapterBoundary } from './mission-control/legacy-boundary';

import { resolveLegacyCapability } from './mission-control/router';

import type { NavigationIntent } from './navigation';

import * as DeliveryPageModule from './pages/delivery-page';
export { createElement, renderToStaticMarkup, describe, expect, it, MISSION_CONTROL_LEGACY_ROUTE_IDS, type ActionRecommendation, type MissionControlLegacyRouteId, type MissionControlViewId, getRecommendationApprovalBlockers, PreviewModule, LegacyAdapterBoundary, resolveLegacyCapability, type NavigationIntent, DeliveryPageModule };
