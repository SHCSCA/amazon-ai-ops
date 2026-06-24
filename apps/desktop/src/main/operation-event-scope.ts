import type { OperationEvent } from '@amazon-ai-ops/shared-types';

export function filterBusinessPipelineOperationEvents(input: {
  scopeAsin?: string;
  events: OperationEvent[];
}): OperationEvent[] {
  const scopeAsin = normalizeAsin(input.scopeAsin);
  if (!scopeAsin) return input.events || [];
  return (input.events || []).filter((event) =>
    operationEventIsGlobal(event) || operationEventMatchesProduct(event, scopeAsin)
  );
}

export function operationEventIsGlobal(event: Pick<OperationEvent, 'asin' | 'campaignName' | 'adGroupName'>): boolean {
  return !normalizeAsin(event.asin) && !clean(event.campaignName) && !clean(event.adGroupName);
}

export function operationEventMatchesProduct(event: Pick<OperationEvent, 'asin'>, asin?: string): boolean {
  const eventAsin = normalizeAsin(event.asin);
  const scopeAsin = normalizeAsin(asin);
  return Boolean(eventAsin && scopeAsin && eventAsin === scopeAsin);
}

function normalizeAsin(value?: string): string {
  return String(value || '').trim().toUpperCase();
}

function clean(value?: string): string {
  return String(value || '').trim();
}
