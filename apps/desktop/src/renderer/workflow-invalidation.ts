export const WORKFLOW_INVALIDATED_EVENT = 'amazon-ai-ops:workflow-invalidated';

export type WorkflowInvalidationSource =
  | 'ad-quant-diagnosis'
  | 'recommendations-generated'
  | 'recommendations-refreshed'
  | 'approval-approved'
  | 'approval-rejected'
  | 'readback-created'
  | 'readback-verified'
  | 'delivery-refreshed';

export interface WorkflowInvalidationDetail {
  source: WorkflowInvalidationSource;
}

export interface WorkflowEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  dispatchEvent(event: Event): boolean;
}

function runtimeTarget(target?: WorkflowEventTarget): WorkflowEventTarget {
  if (target) return target;
  return window;
}

function invalidationEvent(source: WorkflowInvalidationSource): Event {
  const event = new Event(WORKFLOW_INVALIDATED_EVENT) as Event & { detail: WorkflowInvalidationDetail };
  Object.defineProperty(event, 'detail', { value: { source }, enumerable: true });
  return event;
}

export function notifyWorkflowInvalidated(source: WorkflowInvalidationSource, target?: WorkflowEventTarget): void {
  runtimeTarget(target).dispatchEvent(invalidationEvent(source));
}

export function subscribeWorkflowInvalidation(
  listener: (detail: WorkflowInvalidationDetail) => void,
  target?: WorkflowEventTarget,
): () => void {
  const resolvedTarget = runtimeTarget(target);
  const handleEvent: EventListener = (event) => {
    listener((event as Event & { detail: WorkflowInvalidationDetail }).detail);
  };
  resolvedTarget.addEventListener(WORKFLOW_INVALIDATED_EVENT, handleEvent);
  return () => resolvedTarget.removeEventListener(WORKFLOW_INVALIDATED_EVENT, handleEvent);
}

export async function runWorkflowInvalidatingMutation<T>(
  source: WorkflowInvalidationSource,
  task: () => Promise<T>,
  target?: WorkflowEventTarget,
): Promise<T> {
  const result = await task();
  notifyWorkflowInvalidated(source, target);
  return result;
}
