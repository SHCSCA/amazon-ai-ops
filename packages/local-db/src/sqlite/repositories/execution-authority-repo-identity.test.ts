import { describe, expect, it } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { registerIdentity } from './execution-authority-repo.test-jobs';
import  {
  NOW,
  PAGE_HASH,
  PROOF_HASH,
  createHarness,
} from './execution-authority-repo.test-harness';
describe("ExecutionAuthorityRepository", () => {
it('promotes only the latest Stage 5 keyword authority into an exact canonical revision', () => {
    const harness = createHarness();
    const identity = harness.repository.registerCanonicalKeywordIdentity(harness.context, {
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
    });

    expect(identity).toMatchObject({
      storeId: harness.context.storeId,
      marketplace: 'US',
      currency: 'USD',
      adsAccountId: 'ads-account-1',
      campaignId: 'campaign-1',
      adGroupId: 'ad-group-1',
      keywordId: 'keyword-1',
      objectRevision: 1,
      adEntityId: 'opaque-keyword-1',
      entityRevision: 1,
      sourceAuthorityId: 'stage5-authority-1',
      sourceAuthorityProofSha256: PROOF_HASH,
      resolutionProofSha256: '8'.repeat(64),
    });
    expect(harness.repository.resolveCanonicalKeyword(harness.context, {
      adsAccountId: 'ads-account-1',
      campaignId: 'campaign-1',
      adGroupId: 'ad-group-1',
      keywordId: 'keyword-1',
      expectedObjectRevision: 1,
    })).toEqual(identity);
  });

it('appends a fresh identity object revision after reconnect while rejecting identity drift', () => {
    const harness = createHarness();
    const first = registerIdentity(harness);
    harness.database.prepare(`
      UPDATE app_settings SET value = '5', updated_at = ?
      WHERE key = 'store_session_generation:store-one'
    `).run(NOW);
    harness.database.prepare(`
      UPDATE store_session_metadata SET session_generation = 5, updated_at = ?
      WHERE store_id = 'store-one' AND provider = 'amazon_ads'
    `).run(NOW);
    const reconnected = normalizeStoreContextEnvelope({ ...harness.context, sessionGeneration: 5 });

    const second = registerIdentity(harness, {}, reconnected);
    expect(second).toMatchObject({
      canonicalKeywordId: first.canonicalKeywordId,
      objectRevision: 2,
      resolvedSessionGeneration: 5,
      resolutionProofSha256: '8'.repeat(64),
    });
    const third = registerIdentity(harness, { resolutionProofSha256: '7'.repeat(64) }, reconnected);
    expect(third.objectRevision).toBe(3);
    const fourth = registerIdentity(harness, {
      resolutionProofSha256: '7'.repeat(64),
      observedBidCents: 148,
    }, reconnected);
    expect(fourth.objectRevision).toBe(4);
    expect(registerIdentity(harness, {
      resolutionProofSha256: '7'.repeat(64),
      observedBidCents: 148,
    }, reconnected)).toEqual(fourth);
    expect(harness.repository.listCanonicalKeywordIdentities(reconnected)).toEqual([fourth]);
    expect(() => registerIdentity(harness, {
      pageIdentityHash: '6'.repeat(64),
      resolutionProofSha256: '5'.repeat(64),
    }, reconnected)).toThrow(/drifted/i);
  });
});
