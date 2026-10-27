import {
  type StoreCollectionOrchestratorSchedulerProjection,
} from './store-collection-orchestrator';
import {
  type SchedulerRecoverInput,
  type AuthorizedSchedulerRequest,
  type StoreCollectionDurableProofClassification,
  StoreCollectionDurableProofUnknownError,
} from "./collection-scheduler-contracts";
import {
  projection,
  deriveHistoricalCollectionWindow,
} from "./collection-scheduler-job-identity";
import {
  classifyStoreCollectionDurableProof,
} from "./collection-scheduler-durable-proof";

import type { CollectionSchedulerAdapterRuntime } from './collection-scheduler-runtime';

export async function recover(this: CollectionSchedulerAdapterRuntime,
  input: SchedulerRecoverInput): Promise<StoreCollectionOrchestratorSchedulerProjection<'recovery_existing_request_only'>> {
    const base = this.authorizeStructure(input, 'recovery_existing_request_only');
    const claim = this.options.domain.claimSchedulerTransitionAuthority(input, {
      capabilityDomain: 'recovery_existing_request_only',
      context: base.context,
      expectedAuthority: base.expectedAuthority,
      attemptId: input.attemptId,
      requestId: input.requestId,
    });
    this.assertExecutionIdentity(input, claim.executionScope, base.context);
    const durable = this.options.repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      base.context.storeId,
      input.requestId,
    );
    if (!durable) {
      return projection(input, base.expectedAuthority, 'not_found');
    }
    const window = deriveHistoricalCollectionWindow(
      durable.job,
      base.context,
      input.expectedFingerprint,
    );
    const authorized: AuthorizedSchedulerRequest<'recovery_existing_request_only'> = {
      ...base,
      executionScope: claim.executionScope,
      ...window,
    };
    let classification: StoreCollectionDurableProofClassification;
    try {
      classification = classifyStoreCollectionDurableProof(durable, {
        context: authorized.context,
        requestId: input.requestId,
        dateStart: authorized.dateStart,
        dateEnd: authorized.dateEnd,
      });
    } catch (error) {
      if (error instanceof StoreCollectionDurableProofUnknownError) {
        return projection(input, authorized.expectedAuthority, 'unknown');
      }
      throw error;
    }
    const state = classification === 'claimed'
      ? durable.job.state === 'queued' ? 'accepted' : 'waiting'
      : classification;
    return projection(
      input,
      authorized.expectedAuthority,
      state,
    );
  }
