import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveStoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import {
  buildExecutionEvidenceInput,
  executionEvidenceArtifactRef,
  executionEvidencePath,
  executionIdentityResolutionProofPath,
} from './execution-artifacts';

const temporaryRoots: string[] = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('execution artifacts', () => {
  it('derives deterministic opaque refs and store-contained evidence paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-artifacts-'));
    temporaryRoots.push(root);
    const capsule = deriveStoreCapsulePaths(root, 'store-one', 'profile-one');

    const evidencePath = executionEvidencePath(capsule, 'batch:unsafe/path', 'job:unsafe/path', 'before');
    const relative = path.relative(capsule.storeRoot, evidencePath);

    expect(relative).not.toMatch(/^\.\./);
    expect(relative).toMatch(/^evidence[\\/]ad-execution[\\/]batch-[a-f0-9]{24}/);
    expect(evidencePath).toMatch(/[\\/]before\.png$/);
    expect(executionEvidenceArtifactRef('store-one', 'batch-1', 'job-1', 'before'))
      .toMatch(/^artifact:execution:v1:[a-f0-9]{64}$/);

    const resolutionPath = executionIdentityResolutionProofPath(
      capsule,
      'opaque/entity:id',
      2,
      0,
      'page-hash:120:2026-07-23T00:00:00.000Z',
    );
    expect(path.relative(capsule.storeRoot, resolutionPath)).toMatch(
      /^evidence[\\/]ad-execution-identities[\\/]entity-[a-f0-9]{24}[\\/]session-0-proof-[a-f0-9]{24}\.png$/,
    );
    expect(resolutionPath).not.toContain('opaque');
  });

  it('builds path-free evidence metadata from the captured file and stable page identity', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-artifacts-'));
    temporaryRoots.push(root);
    const screenshot = path.join(root, 'before.png');
    fs.writeFileSync(screenshot, 'before-image');
    const observedPageIdentityHash = 'd'.repeat(64);

    const evidence = buildExecutionEvidenceInput({
      storeId: 'store-one',
      batchId: 'batch-1',
      jobId: 'job-1',
      slot: 'before',
      absolutePath: screenshot,
      pageIdentityHash: observedPageIdentityHash,
      canonicalKeywordId: 'canonical-keyword-1',
      objectRevision: 2,
      observedBidCents: 100,
      capturedAt: '2026-07-23T04:00:00.000Z',
    });

    expect(evidence.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.pageIdentityHash).toBe(observedPageIdentityHash);
    expect(JSON.stringify(evidence)).not.toContain(root);
  });

  it('refuses evidence metadata without the adapter-observed canonical identity hash', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-artifacts-'));
    temporaryRoots.push(root);
    const screenshot = path.join(root, 'before.png');
    fs.writeFileSync(screenshot, 'before-image');

    expect(() => buildExecutionEvidenceInput({
      storeId: 'store-one',
      batchId: 'batch-1',
      jobId: 'job-1',
      slot: 'before',
      absolutePath: screenshot,
      pageIdentityHash: '',
      canonicalKeywordId: 'canonical-keyword-1',
      objectRevision: 2,
      observedBidCents: 100,
      capturedAt: '2026-07-23T04:00:00.000Z',
    })).toThrow(/pageIdentityHash/);
  });
});
