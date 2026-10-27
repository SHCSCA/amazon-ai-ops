import { createLegacyDeliveryBundleExporter } from './delivery-legacy-bundle-export';
import type { DeliveryBundleExportOptions as LegacyOptions } from './delivery-legacy-bundle-export';
import type { DeliveryReadinessView } from './delivery-readiness-view';
export type { DeliveryDataReconciliation } from './delivery-legacy-bundle-export';

export interface DeliveryBundleExportOptions extends Omit<LegacyOptions, 'getReadiness' | 'exportV16Bundle'> {
  readonly getReadiness: () => DeliveryReadinessView | Promise<DeliveryReadinessView>;
  readonly exportV16Bundle?: (input?: unknown) => Promise<{ success: boolean; status: string; bundleDir?: string; manifestPath?: string; message?: string }>;
}

export function createDeliveryBundleExporter(options: DeliveryBundleExportOptions) {
  if (options.exportV16Bundle) return options.exportV16Bundle;
  return createLegacyDeliveryBundleExporter({
    ...options,
    getReadiness: () => {
      const readiness = options.getReadiness();
      if (readiness instanceof Promise) throw new Error('LEGACY_DELIVERY_REQUIRES_SYNCHRONOUS_READINESS');
      return readiness;
    },
  });
}
