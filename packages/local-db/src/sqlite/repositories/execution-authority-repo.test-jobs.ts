import { type RegisterAdKeywordIdentityInput, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import  {
  NOW,
  PAGE_HASH,
  COMMAND_HASH,
  Harness,
} from './execution-authority-repo.test-harness';
export function driveSingleJobToSuccess(harness: Harness) {
  const identity = registerIdentity(harness);
  const created = harness.repository.createExactExecutionBatch(harness.context, 'grant-1');
  const job = created.projection.jobs[0]!;
  const started = harness.repository.startJob(harness.context, {
    jobId: job.id,
    expectedRevision: job.revision,
  });
  const preflight = harness.repository.recordPreflight(harness.context, {
    jobId: job.id,
    expectedRevision: started.job.revision,
    observedBidCents: 149,
    pageIdentityHash: PAGE_HASH,
    canonicalKeywordId: identity.canonicalKeywordId,
    objectRevision: identity.objectRevision,
  });
  const intent = harness.repository.recordSubmitIntent(harness.context, {
    jobId: job.id,
    expectedRevision: preflight.job.revision,
    submitIntentId: 'submit-intent-success-helper',
    commandFingerprint: COMMAND_HASH,
    before: evidence(identity.canonicalKeywordId, 149, 'before-proof'),
  });
  const submitted = harness.repository.recordSubmitted(harness.context, {
    jobId: job.id,
    expectedRevision: intent.job.revision,
  });
  const after = harness.repository.recordAfterEvidence(harness.context, {
    jobId: job.id,
    expectedRevision: submitted.job.revision,
    evidence: evidence(identity.canonicalKeywordId, 139, 'after-proof'),
  });
  return harness.repository.recordReloadVerified(harness.context, {
    jobId: job.id,
    expectedRevision: after.job.revision,
    evidence: evidence(identity.canonicalKeywordId, 139, 'reload-proof'),
  });
}

export function driveFirstJobToSuccessInBatch(harness: Harness, batchId: string): void {
  const job = harness.repository.getExecutionBatch(harness.context, batchId)!.jobs[0]!;
  const started = harness.repository.startJob(harness.context, {
    jobId: job.id,
    expectedRevision: job.revision,
  });
  const preflight = harness.repository.recordPreflight(harness.context, {
    jobId: job.id,
    expectedRevision: started.job.revision,
    observedBidCents: job.expectedBidCents,
    pageIdentityHash: job.pageIdentityHash,
    canonicalKeywordId: job.canonicalKeywordId,
    objectRevision: job.identity.objectRevision,
  });
  const intent = harness.repository.recordSubmitIntent(harness.context, {
    jobId: job.id,
    expectedRevision: preflight.job.revision,
    submitIntentId: 'submit-intent-partial-recovery',
    commandFingerprint: COMMAND_HASH,
    before: evidence(job.canonicalKeywordId, job.expectedBidCents, 'partial-before-proof'),
  });
  const submitted = harness.repository.recordSubmitted(harness.context, {
    jobId: job.id,
    expectedRevision: intent.job.revision,
  });
  const after = harness.repository.recordAfterEvidence(harness.context, {
    jobId: job.id,
    expectedRevision: submitted.job.revision,
    evidence: evidence(job.canonicalKeywordId, job.targetBidCents, 'partial-after-proof'),
  });
  harness.repository.recordReloadVerified(harness.context, {
    jobId: job.id,
    expectedRevision: after.job.revision,
    evidence: evidence(job.canonicalKeywordId, job.targetBidCents, 'partial-reload-proof'),
  });
}

export function registerIdentity(
  harness: Harness,
  overrides: Partial<RegisterAdKeywordIdentityInput> = {},
  context: StoreContextEnvelope = harness.context,
) {
  return harness.repository.registerCanonicalKeywordIdentity(context, {
    adEntityId: 'opaque-keyword-1',
    entityRevision: 1,
    adsAccountId: 'ads-account-1',
    campaignId: 'campaign-1',
    adGroupId: 'ad-group-1',
    keywordId: 'keyword-1',
    observedBidCents: 149,
    pageIdentityHash: PAGE_HASH,
    resolutionProofSha256: '8'.repeat(64),
    resolvedAt: NOW,
    resolvedBy: 'operator',
    ...overrides,
  });
}

export function evidence(canonicalKeywordId: string, observedBidCents: number, artifactRef: string) {
  return {
    artifactRef,
    contentSha256: '9'.repeat(64),
    pageIdentityHash: PAGE_HASH,
    canonicalKeywordId,
    objectRevision: 1,
    observedBidCents,
    capturedAt: NOW,
  };
}
