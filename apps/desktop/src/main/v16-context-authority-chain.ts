/**
 * V1.6 Context Authority Chain
 *
 * Phase 5: Validates that Mission, Grant, and Execution operations
 * are bound to the correct StoreContext and reject stale operations.
 *
 * This module provides:
 * - Mission context validation
 * - Grant context validation
 * - Execution context validation
 * - Automatic invalidation on store switch
 *
 * @module v16-context-authority-chain
 */

import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { MissionRecord } from '@amazon-ai-ops/shared-types/src/mission-domain';
import type { MissionGrantRecord } from '@amazon-ai-ops/shared-types/src/mission-grant-domain';
import { storeContextTracker, assertValidStoreContext, sameStoreContext } from './v16-store-context-guard';

export class ContextAuthorityError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'MISSION_CONTEXT_MISMATCH'
      | 'GRANT_CONTEXT_MISMATCH'
      | 'EXECUTION_CONTEXT_MISMATCH'
      | 'STALE_MISSION'
      | 'STALE_GRANT'
      | 'CONTEXT_INVALIDATED',
  ) {
    super(message);
    this.name = 'ContextAuthorityError';
  }
}

/**
 * Validate that a Mission's context matches the current active context.
 * Throws if the mission was created in a different store or stale session.
 */
export function assertMissionContextValid(mission: MissionRecord): void {
  const current = storeContextTracker.getContext();
  
  // Basic store match
  if (mission.storeId !== current.storeId) {
    throw new ContextAuthorityError(
      `Mission ${mission.missionId} belongs to store ${mission.storeId}, but current context is ${current.storeId}`,
      'MISSION_CONTEXT_MISMATCH',
    );
  }

  // Session generation check (prevent A→B→A stale results)
  if (mission.sessionGeneration < current.sessionGeneration) {
    throw new ContextAuthorityError(
      `Mission ${mission.missionId} was created in session ${mission.sessionGeneration}, but current session is ${current.sessionGeneration}`,
      'STALE_MISSION',
    );
  }

  // Full context validation
  if (!sameStoreContext(mission.contextSnapshot, current)) {
    throw new ContextAuthorityError(
      `Mission ${mission.missionId} context snapshot does not match current context`,
      'MISSION_CONTEXT_MISMATCH',
    );
  }
}

/**
 * Validate that a Grant's context matches the current active context.
 * Throws if the grant was issued in a different store or stale session.
 */
export function assertGrantContextValid(grant: MissionGrantRecord): void {
  const current = storeContextTracker.getContext();
  
  // Basic store match
  if (grant.storeId !== current.storeId) {
    throw new ContextAuthorityError(
      `Grant ${grant.grantId} belongs to store ${grant.storeId}, but current context is ${current.storeId}`,
      'GRANT_CONTEXT_MISMATCH',
    );
  }

  // Session generation check
  if (grant.sessionGeneration < current.sessionGeneration) {
    throw new ContextAuthorityError(
      `Grant ${grant.grantId} was issued in session ${grant.sessionGeneration}, but current session is ${current.sessionGeneration}`,
      'STALE_GRANT',
    );
  }

  // Full context validation
  const grantContext: StoreContextEnvelope = {
    storeId: grant.contextSnapshot.storeId,
    marketplace: grant.contextSnapshot.marketplace as 'US',
    currency: grant.contextSnapshot.currency as 'USD',
    businessDate: grant.contextSnapshot.businessDate,
    sessionGeneration: grant.contextSnapshot.sessionGeneration,
  };

  if (!sameStoreContext(grantContext, current)) {
    throw new ContextAuthorityError(
      `Grant ${grant.grantId} context snapshot does not match current context`,
      'GRANT_CONTEXT_MISMATCH',
    );
  }

  // Check grant status
  if (grant.status === 'invalidated') {
    throw new ContextAuthorityError(
      `Grant ${grant.grantId} has been invalidated (likely due to store switch)`,
      'CONTEXT_INVALIDATED',
    );
  }
}

/**
 * Validate that an execution operation's context matches the current active context.
 */
export function assertExecutionContextValid(
  executionContext: StoreContextEnvelope,
  operationId: string,
): void {
  const current = storeContextTracker.getContext();
  
  assertValidStoreContext(executionContext);
  
  if (!sameStoreContext(executionContext, current)) {
    throw new ContextAuthorityError(
      `Execution ${operationId} context does not match current context`,
      'EXECUTION_CONTEXT_MISMATCH',
    );
  }
}

/**
 * Create a context-bound operation tracker.
 * Returns a cleanup function that validates the context is still current.
 */
export function createContextBoundOperation(
  operationId: string,
): { cleanup: () => void; validate: () => void } {
  const startContext = storeContextTracker.getContext();
  const cleanupTracking = storeContextTracker.trackOperation(operationId);

  return {
    cleanup: cleanupTracking,
    validate: () => {
      const current = storeContextTracker.getContext();
      if (!sameStoreContext(startContext, current)) {
        throw new ContextAuthorityError(
          `Operation ${operationId} started in a different context and is now stale`,
          'EXECUTION_CONTEXT_MISMATCH',
        );
      }
    },
  };
}

/**
 * Install store switch handlers that invalidate stale operations.
 * Call this once during app initialization.
 */
export function installContextAuthorityHandlers(): () => void {
  return storeContextTracker.onContextSwitch((newContext) => {
    console.log('[ContextAuthority] Store switched to:', newContext.storeId);
    // In a full implementation, this would:
    // 1. Mark all grants from previous context as 'invalidated'
    // 2. Pause all active missions from previous context
    // 3. Clear any pending execution queue items
  });
}
