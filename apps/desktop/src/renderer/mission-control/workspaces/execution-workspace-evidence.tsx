import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AD_EXECUTION_RECONCILIATION_COPY,
  missionControlContextKey,
  type AdExecutionBatchProjection,
  type AdExecutionEvidenceSlot,
  type AdExecutionProgressEvent,
  type AdExecutionStatus,
  type AnalysisProposalSnapshotRecord,
  type DecisionRecord,
  type MissionAnalysisProjection,
  type MissionGrantEventRecord,
  type MissionGrantRecord,
  type MissionRecord,
  type MissionControlCapabilityProjection,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';

export function hasCanonicalIdentity(projection: AdExecutionBatchProjection): boolean {
  return projection.jobs.length > 0 && projection.jobs.every((job) => (
    Boolean(job.canonicalKeywordId)
    && Boolean(job.identity.adsAccountId)
    && Boolean(job.identity.campaignId)
    && Boolean(job.identity.adGroupId)
    && Boolean(job.identity.keywordId)
  ));
}

export function stepState(
  projection: AdExecutionBatchProjection,
  index: number,
  jobId: string,
): 'pending' | 'active' | 'done' | 'error' {
  const job = projection.jobs.find((candidate) => candidate.id === jobId);
  if (!job) return 'pending';
  if (job.status === 'unknown' || job.status === 'blocked') {
    const evidenceCount = new Set(job.evidence.map((item) => item.slot)).size;
    const stoppedAt = job.status === 'unknown' ? Math.max(3, 3 + evidenceCount) : Math.max(1, 2 + evidenceCount);
    return index < stoppedAt ? 'done' : index === stoppedAt ? 'error' : 'pending';
  }
  if (job.status === 'cancelled') return index === 0 ? 'error' : 'pending';
  if (job.status === 'succeeded') return 'done';
  const rank: Record<Exclude<AdExecutionStatus, 'succeeded' | 'blocked' | 'unknown' | 'cancelled'>, number> = {
    queued: 0,
    preflight: 1,
    intent_written: 2,
    submitted: 3,
    verifying: job.evidence.some((item) => item.slot === 'after') ? 5 : 4,
  };
  const active = rank[job.status];
  return index < active ? 'done' : index === active ? 'active' : 'pending';
}

export function evidenceForExecutionJob(
  projection: AdExecutionBatchProjection,
  jobId: string,
  slot: AdExecutionEvidenceSlot,
) {
  const job = projection.jobs.find((candidate) => candidate.id === jobId);
  return job?.evidence.find((evidence) => (
    evidence.batchId === projection.batch.id
    && evidence.jobId === job.id
    && evidence.slot === slot
  ));
}
