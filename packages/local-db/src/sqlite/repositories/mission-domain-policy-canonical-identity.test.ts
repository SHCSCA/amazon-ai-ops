import { describe, expect, it } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { NOW, policyRules, seedCanonicalPolicyIdentity } from './mission-domain-repo.test-data';
import { seedProductScopeAuthorityWithOnlyUnrelatedMetric, seedAdditionalPolicyScopeAuthority, seedExactPolicyAuthorityMetric } from './mission-domain-repo.test-authority';
import { createHarness, expectRepositoryError } from './mission-domain-repo.test-harness';
describe("MissionDomainRepository policy and context authority", () => {
it('fails closed when campaign or ad-group scope has no current canonical identity', () => {
    const { database, repository, contextOne } = createHarness();
    const adsAccountId = `ads-account-${contextOne.storeId}`;
    const campaignId = 'campaign-A-id';
    const adGroupId = 'ad-group-A-id';
    const authority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne, {
      
      
      campaignName: adsAccountId,
      adGroupName: campaignId,
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: authority.exactFile,
      sourceRow: authority.sourceRow,
      entityName: 'exact keyword',
      campaignName: adsAccountId,
      adGroupName: campaignId,
    });
    const rules = { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] };
    const campaignPolicy = repository.createPolicy(contextOne, {
      id: 'policy-campaign-without-canonical',
      name: 'Campaign without canonical identity',
      scope: `campaign:${encodeURIComponent(adsAccountId)}/${encodeURIComponent(campaignId)}`,
      priority: 5,
      actorId: 'operator',
    });
    const adGroupPolicy = repository.createPolicy(contextOne, {
      id: 'policy-ad-group-without-canonical',
      name: 'Ad group without canonical identity',
      scope: `ad_group:${encodeURIComponent(adsAccountId)}/${encodeURIComponent(campaignId)}/${encodeURIComponent(adGroupId)}`,
      priority: 6,
      actorId: 'operator',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-campaign-without-canonical-v1',
      policyId: campaignPolicy.id,
      version: 1,
      rules,
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-ad-group-without-canonical-v1',
      policyId: adGroupPolicy.id,
      version: 1,
      rules,
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
  });

it('matches campaign and ad-group scopes by canonical Ads account and object IDs only', () => {
    const { database, repository, contextOne } = createHarness();
    const adsAccountId = `ads-account-${contextOne.storeId}`;
    const campaignId = 'campaign-A/id';
    const adGroupId = 'ad-group-A/id';
    const authority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne, {
      campaignName: 'Visible Campaign Name',
      adGroupName: 'Visible Ad Group Name',
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: authority.exactFile,
      sourceRow: authority.sourceRow,
      entityName: 'exact keyword',
      campaignName: 'Visible Campaign Name',
      adGroupName: 'Visible Ad Group Name',
    });
    seedCanonicalPolicyIdentity(database, contextOne, authority, {
      adsAccountId,
      campaignId,
      adGroupId,
    });
    const rules = { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] };
    const createVersion = (id: string, scope: string) => {
      const policy = repository.createPolicy(contextOne, {
        id,
        name: id,
        scope,
        priority: 5,
        actorId: 'operator',
      });
      return repository.createPolicyVersion(contextOne, {
        id: `${id}-v1`,
        policyId: policy.id,
        version: 1,
        rules,
        actorId: 'operator',
      });
    };
    const rejectVersion = (id: string, scope: string) => {
      const policy = repository.createPolicy(contextOne, {
        id,
        name: id,
        scope,
        priority: 6,
        actorId: 'operator',
      });
      expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
        id: `${id}-v1`,
        policyId: policy.id,
        version: 1,
        rules,
        actorId: 'operator',
      }), 'REFERENCE_CONFLICT');
    };

    expect(createVersion(
      'policy-canonical-campaign',
      `campaign:${encodeURIComponent(adsAccountId)}/${encodeURIComponent(campaignId)}`,
    ).rules.allowedAdEntityIds).toEqual([authority.entityId]);
    expect(createVersion(
      'policy-canonical-ad-group',
      `ad_group:${encodeURIComponent(adsAccountId)}/${encodeURIComponent(campaignId)}/${encodeURIComponent(adGroupId)}`,
    ).rules.allowedAdEntityIds).toEqual([authority.entityId]);

    rejectVersion(
      'policy-wrong-ads-account',
      `campaign:${encodeURIComponent('ads-account-other')}/${encodeURIComponent(campaignId)}`,
    );
    rejectVersion(
      'policy-wrong-campaign-id',
      `campaign:${encodeURIComponent(adsAccountId)}/${encodeURIComponent('campaign-B-id')}`,
    );
    rejectVersion(
      'policy-wrong-ad-group-id',
      `ad_group:${encodeURIComponent(adsAccountId)}/${encodeURIComponent(campaignId)}/${encodeURIComponent('ad-group-B-id')}`,
    );
    rejectVersion(
      'policy-legacy-campaign-name',
      `campaign:${encodeURIComponent('Visible Campaign Name')}`,
    );
    rejectVersion(
      'policy-legacy-ad-group-names',
      `ad_group:${encodeURIComponent('Visible Campaign Name')}/${encodeURIComponent('Visible Ad Group Name')}`,
    );
  });

it('does not let another store canonical identity authorize this store scope', () => {
    const { database, repository, contextOne, contextTwo } = createHarness();
    const otherAccountId = `ads-account-${contextTwo.storeId}`;
    const otherCampaignId = 'campaign-other-store';
    const localAuthority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne, {
      campaignName: otherAccountId,
      adGroupName: otherCampaignId,
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: localAuthority.exactFile,
      sourceRow: localAuthority.sourceRow,
      entityName: 'exact keyword',
      campaignName: otherAccountId,
      adGroupName: otherCampaignId,
    });
    const otherAuthority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextTwo, {
      entityId: localAuthority.entityId,
      campaignName: otherAccountId,
      adGroupName: otherCampaignId,
    });
    seedExactPolicyAuthorityMetric(database, contextTwo, {
      sourceFile: otherAuthority.exactFile,
      sourceRow: otherAuthority.sourceRow,
      entityName: 'exact keyword',
      campaignName: otherAccountId,
      adGroupName: otherCampaignId,
    });
    seedCanonicalPolicyIdentity(database, contextTwo, otherAuthority, {
      adsAccountId: otherAccountId,
      campaignId: otherCampaignId,
      adGroupId: 'ad-group-other-store',
    });
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-cross-store-canonical',
      name: 'Cross-store canonical identity must not authorize',
      scope: `campaign:${encodeURIComponent(otherAccountId)}/${encodeURIComponent(otherCampaignId)}`,
      priority: 5,
      actorId: 'operator',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-cross-store-canonical-v1',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [localAuthority.entityId] },
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
  });

it('does not let keyword B enter keyword A canonical campaign scope', () => {
    const { database, repository, contextOne } = createHarness();
    const adsAccountId = `ads-account-${contextOne.storeId}`;
    const authorityA = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne);
    const authorityB = seedAdditionalPolicyScopeAuthority(database, contextOne, authorityA, {
      entityId: `${contextOne.storeId}-keyword-B-scope`,
      entityName: 'keyword B',
      campaignName: adsAccountId,
      adGroupName: 'campaign-A-id',
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: authorityA.exactFile,
      sourceRow: authorityA.sourceRow,
      entityName: 'exact keyword',
      campaignName: 'Exact Campaign',
      adGroupName: 'Exact Ad Group',
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: authorityA.exactFile,
      sourceRow: authorityA.sourceRow,
      entityName: 'keyword B',
      campaignName: adsAccountId,
      adGroupName: 'campaign-A-id',
    });
    seedCanonicalPolicyIdentity(database, contextOne, authorityA, {
      campaignId: 'campaign-A-id',
      adGroupId: 'ad-group-A-id',
      canonicalKeywordId: 'canonical-keyword-A',
    });
    seedCanonicalPolicyIdentity(database, contextOne, authorityB, {
      campaignId: 'campaign-B-id',
      adGroupId: 'ad-group-B-id',
      canonicalKeywordId: 'canonical-keyword-B',
    });
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-keyword-A-campaign',
      name: 'Keyword A campaign only',
      scope: `campaign:${encodeURIComponent(adsAccountId)}/${encodeURIComponent('campaign-A-id')}`,
      priority: 5,
      actorId: 'operator',
    });

    expectRepositoryError(() => repository.createPolicyVersion(contextOne, {
      id: 'policy-keyword-B-in-A-v1',
      policyId: policy.id,
      version: 1,
      rules: { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authorityB.entityId] },
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
  });

it('revalidates the current canonical object revision on draft update and enable', () => {
    const { database, repository, contextOne } = createHarness();
    const adsAccountId = `ads-account-${contextOne.storeId}`;
    const campaignId = 'campaign-A-id';
    const authority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne, {
      campaignName: adsAccountId,
      adGroupName: campaignId,
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: authority.exactFile,
      sourceRow: authority.sourceRow,
      entityName: 'exact keyword',
      campaignName: adsAccountId,
      adGroupName: campaignId,
    });
    seedCanonicalPolicyIdentity(database, contextOne, authority, {
      adsAccountId,
      campaignId,
      adGroupId: 'ad-group-A-id',
      canonicalKeywordId: 'canonical-current-revision',
    });
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-current-canonical-revision',
      name: 'Current canonical revision only',
      scope: `campaign:${encodeURIComponent(adsAccountId)}/${encodeURIComponent(campaignId)}`,
      priority: 5,
      actorId: 'operator',
    });
    const rules = { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] };
    const draft = repository.createPolicyVersion(contextOne, {
      id: 'policy-current-canonical-revision-v1',
      policyId: policy.id,
      version: 1,
      rules,
      actorId: 'operator',
    });
    seedCanonicalPolicyIdentity(database, contextOne, authority, {
      adsAccountId,
      campaignId: 'campaign-B-id',
      adGroupId: 'ad-group-B-id',
      canonicalKeywordId: 'canonical-current-revision',
      objectRevision: 2,
    });

    expectRepositoryError(() => repository.updateDraftPolicyVersion(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      rules: { ...rules, cooldownMinutes: 30 },
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
    expectRepositoryError(() => repository.enablePolicyVersion(contextOne, {
      policyId: policy.id,
      versionId: draft.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draft.revision,
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
    expect(repository.getPolicyVersion(contextOne, draft.id)?.status).toBe('draft');
  });

it('rejects canonical scope authority resolved in an older Ads session generation on every boundary', () => {
    const { database, repository, contextOne } = createHarness();
    const adsAccountId = `ads-account-${contextOne.storeId}`;
    const campaignId = 'campaign-session-bound';
    const authority = seedProductScopeAuthorityWithOnlyUnrelatedMetric(database, contextOne, {
      campaignName: 'Session-bound Campaign',
      adGroupName: 'Session-bound Ad Group',
    });
    seedExactPolicyAuthorityMetric(database, contextOne, {
      sourceFile: authority.exactFile,
      sourceRow: authority.sourceRow,
      entityName: 'exact keyword',
      campaignName: 'Session-bound Campaign',
      adGroupName: 'Session-bound Ad Group',
    });
    seedCanonicalPolicyIdentity(database, contextOne, authority, {
      adsAccountId,
      campaignId,
      adGroupId: 'ad-group-session-bound',
      canonicalKeywordId: 'canonical-session-bound',
    });
    const scope = `campaign:${encodeURIComponent(adsAccountId)}/${encodeURIComponent(campaignId)}`;
    const rules = { ...policyRules(contextOne.storeId), allowedAdEntityIds: [authority.entityId] };
    const policy = repository.createPolicy(contextOne, {
      id: 'policy-canonical-session-bound',
      name: 'Canonical session bound',
      scope,
      priority: 5,
      actorId: 'operator',
    });
    const draft = repository.createPolicyVersion(contextOne, {
      id: 'policy-canonical-session-bound-v1',
      policyId: policy.id,
      version: 1,
      rules,
      actorId: 'operator',
    });
    const nextContext = normalizeStoreContextEnvelope({ ...contextOne, sessionGeneration: 5 });
    database.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, '5', ?)
      ON CONFLICT(key) DO UPDATE SET value = '5', updated_at = excluded.updated_at
    `).run(`store_session_generation:${contextOne.storeId}`, NOW);

    const createPolicy = repository.createPolicy(nextContext, {
      id: 'policy-old-canonical-session-create',
      name: 'Old canonical session create',
      scope,
      priority: 6,
      actorId: 'operator',
    });
    expectRepositoryError(() => repository.createPolicyVersion(nextContext, {
      id: 'policy-old-canonical-session-create-v1',
      policyId: createPolicy.id,
      version: 1,
      rules,
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
    expectRepositoryError(() => repository.updateDraftPolicyVersion(nextContext, {
      id: draft.id,
      expectedRevision: draft.revision,
      rules: { ...rules, cooldownMinutes: 30 },
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
    expectRepositoryError(() => repository.enablePolicyVersion(nextContext, {
      policyId: policy.id,
      versionId: draft.id,
      expectedPolicyRevision: policy.revision,
      expectedVersionRevision: draft.revision,
      actorId: 'operator',
    }), 'REFERENCE_CONFLICT');
    expect(repository.getPolicyVersion(nextContext, draft.id)?.status).toBe('draft');
  });
});
