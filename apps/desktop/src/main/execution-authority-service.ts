import { type PolicyGrantDispatchTrigger } from '@amazon-ai-ops/local-db';
import  {
  type AdExecutionBatchProjection,
  type AdExecutionStartupRecoveryResult,
  type AdExecutionUnknownReconciliationResult,
  type AdKeywordIdentityVersionRecord,
  type CreateAdExecutionBatchRequest,
  type CreateAdExecutionBatchResult,
  type CancelAdExecutionBatchRequest,
  type MissionGrantRecord,
  type ResolveAdExecutionIdentityRequest,
  type ReconcileUnknownAdExecutionBatchRequest,
  type StartAdExecutionBatchRequest,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { createExecutionAuthorityServiceContext } from './execution-authority/composition';
import type { ExecutionAuthorityServiceContext } from './execution-authority/context';
import type { ExecutionBrowserRuntime, ExecutionAuthorityServiceOptions } from './execution-authority/contracts';
export type { ExecutionBrowserRuntime, ExecutionAuthorityServiceOptions } from './execution-authority/contracts';
export { ExecutionAuthorityShutdownError } from './execution-authority/errors';
export class ExecutionAuthorityService {
    private readonly context: ExecutionAuthorityServiceContext;
    constructor(options: ExecutionAuthorityServiceOptions) {
        this.context = createExecutionAuthorityServiceContext(options);
    }
    listBatches(contextInput: StoreContextEnvelope): readonly AdExecutionBatchProjection[] {
        return this.context.listBatches(contextInput);
    }
    async withAdmittedBrowserOperation<Result>(label: string, work: () => Promise<Result> | Result): Promise<Result> {
        return this.context.withAdmittedBrowserOperation(label, work);
    }
    resolveIdentity(request: ResolveAdExecutionIdentityRequest): Promise<AdKeywordIdentityVersionRecord> {
        return this.context.resolveIdentity(request);
    }
    createBatch(request: CreateAdExecutionBatchRequest): CreateAdExecutionBatchResult {
        return this.context.createBatch(request);
    }
    startBatch(request: StartAdExecutionBatchRequest): Promise<AdExecutionBatchProjection> {
        return this.context.startBatch(request);
    }
    enqueuePolicyGrant(contextInput: StoreContextEnvelope, grant: MissionGrantRecord): Promise<void> {
        return this.context.enqueuePolicyGrant(contextInput, grant);
    }
    resumePolicyGrantDispatches(contextInput: StoreContextEnvelope, trigger: Extract<PolicyGrantDispatchTrigger, 'store_activated' | 'session_ready'>): Promise<void> {
        return this.context.resumePolicyGrantDispatches(contextInput, trigger);
    }
    cancelBatch(request: CancelAdExecutionBatchRequest): AdExecutionBatchProjection {
        return this.context.cancelBatch(request);
    }
    reconcileUnknownBatch(request: ReconcileUnknownAdExecutionBatchRequest): Promise<AdExecutionUnknownReconciliationResult> {
        return this.context.reconcileUnknownBatch(request);
    }
    takeOverVisibleBrowser(request: StartAdExecutionBatchRequest): Promise<{
        status: 'VISIBLE';
        batchId: string;
    }> {
        return this.context.takeOverVisibleBrowser(request);
    }
    recoverStartup(): AdExecutionStartupRecoveryResult {
        return this.context.recoverStartup();
    }
    reconcileActiveStore(contextInput: StoreContextEnvelope): void {
        return this.context.reconcileActiveStore(contextInput);
    }
    assertStoreMutationAllowed(contextInput: StoreContextEnvelope): void {
        return this.context.assertStoreMutationAllowed(contextInput);
    }
    async prepareForShutdown(timeoutMs = 60000): Promise<void> {
        return this.context.prepareForShutdown(timeoutMs);
    }
}
