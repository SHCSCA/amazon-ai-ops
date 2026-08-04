import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type {
  AdExecutionEvidenceInput,
  AdExecutionEvidenceSlot,
} from '@amazon-ai-ops/shared-types';
import {
  assertOpaqueExecutionArtifactRef,
} from '@amazon-ai-ops/shared-types';
import type { StoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import { resolveStoreCapsulePath } from '@amazon-ai-ops/browser-worker';

export function executionEvidenceArtifactRef(
  storeId: string,
  batchId: string,
  jobId: string,
  slot: AdExecutionEvidenceSlot,
): string {
  const digest = sha256(stableJson({
    storeId: requiredText(storeId, 'storeId'),
    batchId: requiredText(batchId, 'batchId'),
    jobId: requiredText(jobId, 'jobId'),
    slot,
  }));
  return assertOpaqueExecutionArtifactRef(`artifact:execution:v1:${digest}`);
}

/** Main-only deterministic location; no Renderer request contributes a path segment. */
export function executionEvidencePath(
  capsule: StoreCapsulePaths,
  batchId: string,
  jobId: string,
  slot: AdExecutionEvidenceSlot,
): string {
  const batchDirectory = `batch-${sha256(requiredText(batchId, 'batchId')).slice(0, 24)}`;
  const jobDirectory = `job-${sha256(requiredText(jobId, 'jobId')).slice(0, 24)}`;
  return resolveStoreCapsulePath(
    capsule,
    'evidence',
    'ad-execution',
    batchDirectory,
    jobDirectory,
    `${slot}.png`,
  );
}

/** Main-only identity-resolution proof location, derived without raw Ads ids. */
export function executionIdentityResolutionProofPath(
  capsule: StoreCapsulePaths,
  adEntityId: string,
  entityRevision: number,
  sessionGeneration: number,
  resolutionKey: string,
): string {
  const identityDirectory = `entity-${sha256(stableJson({
    adEntityId: requiredText(adEntityId, 'adEntityId'),
    entityRevision: positiveInteger(entityRevision, 'entityRevision'),
  })).slice(0, 24)}`;
  const proofName = `session-${nonNegativeInteger(sessionGeneration, 'sessionGeneration')}`
    + `-proof-${sha256(requiredText(resolutionKey, 'resolutionKey')).slice(0, 24)}.png`;
  return resolveStoreCapsulePath(
    capsule,
    'evidence',
    'ad-execution-identities',
    identityDirectory,
    proofName,
  );
}

export function buildExecutionEvidenceInput(input: {
  storeId: string;
  batchId: string;
  jobId: string;
  slot: AdExecutionEvidenceSlot;
  absolutePath: string;
  /** Canonical observed page/object hash sealed by the exact browser adapter. */
  pageIdentityHash: string;
  canonicalKeywordId: string;
  objectRevision: number;
  observedBidCents: number;
  capturedAt: string;
}): AdExecutionEvidenceInput {
  if (!fs.statSync(input.absolutePath).isFile()) {
    throw new Error('执行证据不是可读取文件。');
  }
  return {
    artifactRef: executionEvidenceArtifactRef(
      input.storeId,
      input.batchId,
      input.jobId,
      input.slot,
    ),
    contentSha256: createHash('sha256').update(fs.readFileSync(input.absolutePath)).digest('hex'),
    pageIdentityHash: sha256Value(input.pageIdentityHash, 'pageIdentityHash'),
    canonicalKeywordId: requiredText(input.canonicalKeywordId, 'canonicalKeywordId'),
    objectRevision: positiveInteger(input.objectRevision, 'objectRevision'),
    observedBidCents: positiveInteger(input.observedBidCents, 'observedBidCents'),
    capturedAt: validTimestamp(input.capturedAt),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Value(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${field} must be a SHA-256 value`);
  }
  return normalized;
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => (
    left.localeCompare(right)
  ))));
}

function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || /[\u0000-\u001f]/.test(normalized)) {
    throw new TypeError(`${field} is required`);
  }
  return normalized;
}

function positiveInteger(value: unknown, field: string): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return normalized;
}

function nonNegativeInteger(value: unknown, field: string): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
  return normalized;
}

function validTimestamp(value: unknown): string {
  const normalized = requiredText(value, 'capturedAt');
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError('capturedAt is invalid');
  return normalized;
}
