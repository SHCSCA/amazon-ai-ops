import React from 'react';
import type {
  MissionControlCapabilityProjection,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type { NavigationIntent } from '../navigation';
import type { AppRoute } from '../types';

export interface LegacyAdapterBoundaryProps {
  route: AppRoute;
  intent: NavigationIntent;
  capability?: MissionControlCapabilityProjection;
  storeContext: StoreContextEnvelope;
  previewMode?: boolean;
  children: React.ReactNode;
}

function blockedDetail(
  capability: MissionControlCapabilityProjection | undefined,
): string {
  if (!capability) return '该页尚未获得 Main 授权的店铺级能力投影，旧接口不会被直接打开。';
  return capability.detail || '该能力当前不可用。';
}

/**
 * The only legal entry point for the 16 legacy Renderer pages.
 *
 * A route name is compatibility metadata, never authority. Main's current,
 * store-bound capability projection decides whether the legacy page may mount.
 */
export function LegacyAdapterBoundary({
  route,
  intent,
  capability,
  storeContext,
  previewMode = false,
  children,
}: LegacyAdapterBoundaryProps) {
  const viewId = `${intent.workspace}/${intent.subview}`;
  const projectionMatches = Boolean(
    capability
      && capability.workspace === intent.workspace
      && capability.view === viewId
      && capability.legacyRoute === route,
  );
  const legacyEnabled = projectionMatches && capability?.state === 'LEGACY_ADAPTER';
  const prototypeEnabled = projectionMatches && capability?.state === 'PROTOTYPE_ONLY' && previewMode;

  if (!legacyEnabled && !prototypeEnabled) {
    return (
      <section
        aria-label="旧页面能力边界"
        className="legacy-adapter-boundary legacy-adapter-boundary-blocked"
        data-capability-state={capability?.state || 'MISSING'}
        data-legacy-route={route}
        data-store-id={storeContext.storeId}
        role="status"
      >
        <strong>当前功能未放行</strong>
        <p>{blockedDetail(capability)}</p>
        <small>
          店铺 {storeContext.storeId} · US · USD · 会话代次 {storeContext.sessionGeneration}
        </small>
      </section>
    );
  }

  return (
    <section
      aria-label="旧页面兼容适配器"
      className="legacy-adapter-boundary"
      data-capability-state={capability?.state}
      data-legacy-route={route}
      data-store-id={storeContext.storeId}
    >
      {prototypeEnabled && (
        <div className="legacy-adapter-preview-notice" role="note">
          仅开发预览：该旧页面不具备生产店铺级授权，不形成执行或验收证据。
        </div>
      )}
      {children}
    </section>
  );
}
