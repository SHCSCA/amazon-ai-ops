import { type AdExecutionProgressEvent, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { ExecutionAuthorityServiceContext } from './context';
export function progress(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, batchId: string, jobId: string | undefined, phase: AdExecutionProgressEvent['phase'], status: AdExecutionProgressEvent['status'], message: string): void {
    const event: AdExecutionProgressEvent = {
        storeId: context.storeId,
        batchId,
        ...(jobId ? { jobId } : {}),
        phase,
        status,
        message,
        occurredAt: this.timestamp(),
    };
    try {
        this.emit(event);
    }
    catch (error) {
        this.logger.error('execution.progress_notification_failed', { error });
    }
}
export function timestamp(this: ExecutionAuthorityServiceContext): string {
    return this.now().toISOString();
}
