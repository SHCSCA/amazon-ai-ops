import { describe, expect, it } from 'vitest';
import {
  createHarness,
  insertAdMetric,
  testHash,
  insertProductionLineage,
  insertVerifiedAdEntityAuthority,
  insertKeywordIdentityVersion,
} from './store-ad-listing.test-fixtures';

describe('StoreScopedAdListingService', () => {
  it.each(['different-id', 'uncovered-row', 'reused-proof', 'old-session', 'latest-outside-lineage', 'wrong-report-hash'] as const)(
    'refuses %s instead of inferring stable identity from one row per date', (variant) => {
      const harness = createHarness();
      const batchId = `coverage-${variant}`;
      insertProductionLineage(harness, { storeId: harness.firstStoreId, batchId, createdAt: '2026-07-22T01:00:00.000Z' });
      for (const [index, date] of ['2026-07-20', '2026-07-21'].entries()) {
        const sourceRow = variant === 'reused-proof' ? 1701 : 1701 + index;
        insertAdMetric(harness, harness.firstStoreId, {
          batchId, reportType: 'keyword', campaign: 'Coverage Campaign', adGroup: 'Coverage Group',
          targeting: 'covered keyword', searchTerm: '', matchType: 'exact', spend: 10, sales: 100,
          date, sourceRow, sourceFile: `C:/reports/${batchId}/keyword.xlsx`,
        });
        if (index === 1 && (variant === 'uncovered-row' || variant === 'reused-proof')) continue;
        insertVerifiedAdEntityAuthority(harness, {
          storeId: harness.firstStoreId, batchId, authorityId: `coverage-proof-${index}`,
          adEntityId: variant === 'different-id' ? `entity-${index}` : 'coverage-entity',
          entityRevision: index + 1, entityType: 'keyword', entityName: 'covered keyword',
          campaignName: 'Coverage Campaign', adGroupName: 'Coverage Group', sourceRow,
          ...(variant === 'old-session' ? { evidenceSessionGeneration: 0 } : {}),
          ...(variant === 'wrong-report-hash' && index === 1 ? { sourceFileHash: 'F'.repeat(64) } : {}),
        });
      }
      if (variant === 'latest-outside-lineage') insertVerifiedAdEntityAuthority(harness, {
        storeId: harness.firstStoreId, batchId, authorityId: 'latest-proof-without-selected-source-row',
        adEntityId: 'coverage-entity', entityRevision: 3, entityType: 'keyword', entityName: 'covered keyword',
        campaignName: 'Coverage Campaign', adGroupName: 'Coverage Group', sourceRow: 9999,
      });
      const [target] = harness.service.listAdObjects(harness.switchFirst(), { kind: 'target' });
      expect(target).toMatchObject({ sourceRowCount: 2, resolved: false, nonExecutable: true, resolutionReason: 'STABLE_ENTITY_ID_UNAVAILABLE' });
      expect(target).not.toHaveProperty('entityId');
      expect(target).not.toHaveProperty('entityRevision');
    },
  );
it('projects canonical Ads hierarchy only from the exact current keyword identity version', () => {
    const harness = createHarness();
    const batchId = 'production-canonical-keyword-authority';
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId,
      createdAt: '2026-07-22T01:00:00.000Z',
    });
    insertAdMetric(harness, harness.firstStoreId, {
      batchId,
      reportType: 'keyword',
      campaign: 'Named Campaign',
      adGroup: 'Named Group',
      targeting: 'canonical keyword',
      searchTerm: '',
      matchType: 'exact',
      spend: 12,
      sales: 120,
      sourceRow: 1501,
      sourceFile: `C:/reports/${batchId}/keyword.xlsx`,
    });
    insertVerifiedAdEntityAuthority(harness, {
      storeId: harness.firstStoreId,
      batchId,
      authorityId: 'canonical-authority-1501',
      adEntityId: 'opaque-keyword-1501',
      entityRevision: 3,
      entityType: 'keyword',
      entityName: 'canonical keyword',
      campaignName: 'Named Campaign',
      adGroupName: 'Named Group',
      sourceRow: 1501,
    });
    const currentContext = harness.switchFirst();
    insertKeywordIdentityVersion(harness, {
      storeId: harness.firstStoreId,
      identityVersionId: 'identity-version-1501',
      canonicalKeywordId: 'canonical-keyword-1501',
      adEntityId: 'opaque-keyword-1501',
      entityRevision: 3,
      adsAccountId: 'ads/account 1',
      campaignId: 'campaign/id 1',
      adGroupId: 'group/id 1',
      keywordId: 'keyword/id 1',
      objectRevision: 4,
      sourceAuthorityId: 'canonical-authority-1501',
      resolvedSessionGeneration: currentContext.sessionGeneration,
    });

    const [target] = harness.service.listAdObjects(currentContext, { kind: 'target' });

    expect(target).toMatchObject({
      entityId: 'opaque-keyword-1501',
      entityRevision: 3,
      resolved: true,
      nonExecutable: false,
      adsAccountId: 'ads/account 1',
      campaignId: 'campaign/id 1',
      adGroupId: 'group/id 1',
      keywordId: 'keyword/id 1',
      objectRevision: 4,
    });
  });

it('does not project stale canonical hierarchy when a newer object revision belongs to another authority', () => {
    const harness = createHarness();
    const batchId = 'production-stale-canonical-authority';
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId,
      createdAt: '2026-07-22T01:00:00.000Z',
    });
    for (const [sourceRow, targetName] of [[1511, 'selected keyword'], [1512, 'other keyword']] as const) {
      insertAdMetric(harness, harness.firstStoreId, {
        batchId,
        reportType: 'keyword',
        campaign: targetName === 'selected keyword' ? 'Selected Campaign' : 'Other Campaign',
        adGroup: targetName === 'selected keyword' ? 'Selected Group' : 'Other Group',
        targeting: targetName,
        searchTerm: '',
        matchType: 'exact',
        spend: 10,
        sales: 100,
        sourceRow,
        sourceFile: `C:/reports/${batchId}/keyword.xlsx`,
      });
    }
    insertVerifiedAdEntityAuthority(harness, {
      storeId: harness.firstStoreId,
      batchId,
      authorityId: 'selected-authority-1511',
      adEntityId: 'opaque-keyword-1511',
      entityRevision: 1,
      entityType: 'keyword',
      entityName: 'selected keyword',
      campaignName: 'Selected Campaign',
      adGroupName: 'Selected Group',
      sourceRow: 1511,
    });
    insertVerifiedAdEntityAuthority(harness, {
      storeId: harness.firstStoreId,
      batchId,
      authorityId: 'other-authority-1512',
      adEntityId: 'opaque-keyword-1512',
      entityRevision: 1,
      entityType: 'keyword',
      entityName: 'other keyword',
      campaignName: 'Other Campaign',
      adGroupName: 'Other Group',
      sourceRow: 1512,
    });
    const currentContext = harness.switchFirst();
    insertKeywordIdentityVersion(harness, {
      storeId: harness.firstStoreId,
      identityVersionId: 'identity-version-1511',
      canonicalKeywordId: 'shared-canonical-keyword',
      adEntityId: 'opaque-keyword-1511',
      entityRevision: 1,
      adsAccountId: 'stale-account',
      campaignId: 'stale-campaign',
      adGroupId: 'stale-group',
      keywordId: 'stale-keyword',
      objectRevision: 1,
      sourceAuthorityId: 'selected-authority-1511',
      resolvedSessionGeneration: currentContext.sessionGeneration,
    });
    insertKeywordIdentityVersion(harness, {
      storeId: harness.firstStoreId,
      identityVersionId: 'identity-version-1512',
      canonicalKeywordId: 'shared-canonical-keyword',
      adEntityId: 'opaque-keyword-1512',
      entityRevision: 1,
      adsAccountId: 'current-account',
      campaignId: 'current-campaign',
      adGroupId: 'current-group',
      keywordId: 'current-keyword',
      objectRevision: 2,
      sourceAuthorityId: 'other-authority-1512',
      resolvedSessionGeneration: currentContext.sessionGeneration,
    });

    const selected = harness.service.listAdObjects(currentContext, { kind: 'target' })
      .find((target) => target.name.startsWith('selected keyword'));

    expect(selected).toMatchObject({
      entityId: 'opaque-keyword-1511',
      resolved: true,
      nonExecutable: false,
    });
    expect(selected).not.toHaveProperty('adsAccountId');
    expect(selected).not.toHaveProperty('campaignId');
    expect(selected).not.toHaveProperty('adGroupId');
    expect(selected).not.toHaveProperty('keywordId');
    expect(selected).not.toHaveProperty('objectRevision');
  });

it('does not project canonical hierarchy resolved in an older store session generation', () => {
    const harness = createHarness();
    const batchId = 'production-stale-session-canonical-authority';
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId,
      createdAt: '2026-07-22T01:00:00.000Z',
    });
    insertAdMetric(harness, harness.firstStoreId, {
      batchId,
      reportType: 'keyword',
      campaign: 'Stale Session Campaign',
      adGroup: 'Stale Session Group',
      targeting: 'stale session keyword',
      searchTerm: '',
      matchType: 'exact',
      spend: 12,
      sales: 120,
      sourceRow: 1531,
      sourceFile: `C:/reports/${batchId}/keyword.xlsx`,
    });
    insertVerifiedAdEntityAuthority(harness, {
      storeId: harness.firstStoreId,
      batchId,
      authorityId: 'stale-session-authority-1531',
      adEntityId: 'opaque-keyword-1531',
      entityRevision: 1,
      entityType: 'keyword',
      entityName: 'stale session keyword',
      campaignName: 'Stale Session Campaign',
      adGroupName: 'Stale Session Group',
      sourceRow: 1531,
    });
    const currentContext = harness.switchFirst();
    insertKeywordIdentityVersion(harness, {
      storeId: harness.firstStoreId,
      identityVersionId: 'identity-version-1531',
      canonicalKeywordId: 'canonical-keyword-1531',
      adEntityId: 'opaque-keyword-1531',
      entityRevision: 1,
      adsAccountId: 'stale-session-account',
      campaignId: 'stale-session-campaign',
      adGroupId: 'stale-session-group',
      keywordId: 'stale-session-keyword',
      objectRevision: 1,
      sourceAuthorityId: 'stale-session-authority-1531',
      resolvedSessionGeneration: currentContext.sessionGeneration - 1,
    });

    const [target] = harness.service.listAdObjects(currentContext, { kind: 'target' });

    expect(target).toMatchObject({
      entityId: 'opaque-keyword-1531',
      resolved: true,
      nonExecutable: false,
    });
    expect(target).not.toHaveProperty('adsAccountId');
    expect(target).not.toHaveProperty('campaignId');
    expect(target).not.toHaveProperty('adGroupId');
    expect(target).not.toHaveProperty('keywordId');
    expect(target).not.toHaveProperty('objectRevision');
  });

it('does not project canonical hierarchy when the identity authority proof hash differs', () => {
    const harness = createHarness();
    const batchId = 'production-mismatched-proof-canonical-authority';
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId,
      createdAt: '2026-07-22T01:00:00.000Z',
    });
    insertAdMetric(harness, harness.firstStoreId, {
      batchId,
      reportType: 'keyword',
      campaign: 'Proof Campaign',
      adGroup: 'Proof Group',
      targeting: 'proof keyword',
      searchTerm: '',
      matchType: 'exact',
      spend: 12,
      sales: 120,
      sourceRow: 1541,
      sourceFile: `C:/reports/${batchId}/keyword.xlsx`,
    });
    insertVerifiedAdEntityAuthority(harness, {
      storeId: harness.firstStoreId,
      batchId,
      authorityId: 'proof-authority-1541',
      adEntityId: 'opaque-keyword-1541',
      entityRevision: 1,
      entityType: 'keyword',
      entityName: 'proof keyword',
      campaignName: 'Proof Campaign',
      adGroupName: 'Proof Group',
      sourceRow: 1541,
    });
    const currentContext = harness.switchFirst();
    insertKeywordIdentityVersion(harness, {
      storeId: harness.firstStoreId,
      identityVersionId: 'identity-version-1541',
      canonicalKeywordId: 'canonical-keyword-1541',
      adEntityId: 'opaque-keyword-1541',
      entityRevision: 1,
      adsAccountId: 'proof-account',
      campaignId: 'proof-campaign',
      adGroupId: 'proof-group',
      keywordId: 'proof-keyword',
      objectRevision: 1,
      sourceAuthorityId: 'proof-authority-1541',
      resolvedSessionGeneration: currentContext.sessionGeneration,
      sourceAuthorityProofSha256: testHash('wrong-authority-proof'),
    });

    const [target] = harness.service.listAdObjects(currentContext, { kind: 'target' });

    expect(target).toMatchObject({
      entityId: 'opaque-keyword-1541',
      resolved: true,
      nonExecutable: false,
    });
    expect(target).not.toHaveProperty('adsAccountId');
    expect(target).not.toHaveProperty('campaignId');
    expect(target).not.toHaveProperty('adGroupId');
    expect(target).not.toHaveProperty('keywordId');
    expect(target).not.toHaveProperty('objectRevision');
  });

it('fails closed when two rows on two dates can still represent different same-named objects', () => {
    const harness = createHarness();
    const batchId = 'production-cross-date-ambiguous-authority';
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId,
      createdAt: '2026-07-22T01:00:00.000Z',
    });
    for (const [sourceRow, date] of [[1521, '2026-07-20'], [1522, '2026-07-21']] as const) {
      insertAdMetric(harness, harness.firstStoreId, {
        batchId,
        reportType: 'keyword',
        campaign: 'Same Named Campaign',
        adGroup: 'Same Named Group',
        targeting: 'same named keyword',
        searchTerm: '',
        matchType: 'exact',
        spend: 10,
        sales: 100,
        sourceRow,
        date,
        sourceFile: `C:/reports/${batchId}/keyword.xlsx`,
      });
    }
    insertVerifiedAdEntityAuthority(harness, {
      storeId: harness.firstStoreId,
      batchId,
      authorityId: 'cross-date-authority-1521',
      adEntityId: 'opaque-keyword-1521',
      entityRevision: 1,
      entityType: 'keyword',
      entityName: 'same named keyword',
      campaignName: 'Same Named Campaign',
      adGroupName: 'Same Named Group',
      sourceRow: 1521,
    });

    const [target] = harness.service.listAdObjects(harness.switchFirst(), { kind: 'target' });

    expect(target).toMatchObject({
      sourceRowCount: 2,
      resolved: false,
      nonExecutable: true,
      resolutionReason: 'STABLE_ENTITY_ID_UNAVAILABLE',
    });
    expect(target).not.toHaveProperty('entityId');
  });

it('keeps same-named exact and broad keyword targets disjoint when only exact has stable authority', () => {
    const harness = createHarness();
    const batchId = 'production-match-type-authority';
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId,
      createdAt: '2026-07-22T01:00:00.000Z',
    });
    for (const [sourceRow, matchType] of [[1301, 'exact'], [1302, 'broad']] as const) {
      insertAdMetric(harness, harness.firstStoreId, {
        batchId,
        reportType: 'keyword',
        campaign: 'Same Campaign',
        adGroup: 'Same Ad Group',
        targeting: 'same keyword',
        searchTerm: '',
        matchType,
        spend: 10,
        sales: 100,
        sourceRow,
        sourceFile: `C:/reports/${batchId}/keyword.xlsx`,
      });
    }
    insertVerifiedAdEntityAuthority(harness, {
      storeId: harness.firstStoreId,
      batchId,
      authorityId: 'exact-match-authority',
      adEntityId: 'opaque-exact-keyword',
      entityRevision: 2,
      entityType: 'keyword',
      entityName: 'same keyword',
      campaignName: 'Same Campaign',
      adGroupName: 'Same Ad Group',
      sourceRow: 1301,
    });

    const targets = harness.service.listAdObjects(harness.switchFirst(), { kind: 'target' });

    expect(targets).toHaveLength(2);
    expect(new Set(targets.map((target) => target.objectKey)).size).toBe(2);
    expect(targets.find((target) => target.matchType === 'exact')).toMatchObject({
      name: 'same keyword（精准匹配）',
      entityId: 'opaque-exact-keyword',
      entityRevision: 2,
      resolved: true,
      nonExecutable: false,
    });
    expect(targets.find((target) => target.matchType === 'broad')).toMatchObject({
      name: 'same keyword（广泛匹配）',
      resolved: false,
      nonExecutable: true,
      resolutionReason: 'STABLE_ENTITY_ID_UNAVAILABLE',
    });
  });

it('fails closed when duplicate same-named keyword targets share every observable identity dimension', () => {
    const harness = createHarness();
    const batchId = 'production-duplicate-name-authority';
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId,
      createdAt: '2026-07-22T01:00:00.000Z',
    });
    for (const sourceRow of [1401, 1402]) {
      insertAdMetric(harness, harness.firstStoreId, {
        batchId,
        reportType: 'keyword',
        campaign: 'Duplicate Campaign',
        adGroup: 'Duplicate Ad Group',
        targeting: 'duplicate keyword',
        searchTerm: '',
        matchType: 'exact',
        spend: 10,
        sales: 100,
        sourceRow,
        sourceFile: `C:/reports/${batchId}/keyword.xlsx`,
      });
    }
    insertVerifiedAdEntityAuthority(harness, {
      storeId: harness.firstStoreId,
      batchId,
      authorityId: 'single-duplicate-authority',
      adEntityId: 'opaque-duplicate-keyword',
      entityRevision: 1,
      entityType: 'keyword',
      entityName: 'duplicate keyword',
      campaignName: 'Duplicate Campaign',
      adGroupName: 'Duplicate Ad Group',
      sourceRow: 1401,
    });

    const [target] = harness.service.listAdObjects(harness.switchFirst(), { kind: 'target' });

    expect(target).toMatchObject({
      matchType: 'exact',
      resolved: false,
      nonExecutable: true,
      resolutionReason: 'STABLE_ENTITY_ID_UNAVAILABLE',
    });
    expect(target).not.toHaveProperty('entityId');
    expect(target).not.toHaveProperty('entityRevision');
  });

it('projects one current store stable Ads keyword across dates but rejects duplicate daily rows', () => {
    const harness = createHarness();
    const batchId = 'production-stable-authority';
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId,
      createdAt: '2026-07-22T01:00:00.000Z',
    });
    insertAdMetric(harness, harness.firstStoreId, {
      batchId,
      reportType: 'keyword',
      campaign: 'Stable Campaign',
      adGroup: 'Stable Ad Group',
      targeting: 'stable keyword',
      searchTerm: '',
      matchType: 'exact',
      spend: 25,
      sales: 100,
      sourceRow: 401,
      sourceFile: `C:/reports/${batchId}/keyword.xlsx`,
    });
    insertVerifiedAdEntityAuthority(harness, {
      storeId: harness.firstStoreId,
      batchId,
      authorityId: 'stable-authority-1',
      adEntityId: 'opaque-keyword-401',
      entityRevision: 3,
      entityType: 'keyword',
      entityName: 'stable keyword',
      campaignName: 'Stable Campaign',
      adGroupName: 'Stable Ad Group',
      sourceRow: 401,
    });

    const [target] = harness.service.listAdObjects(harness.switchFirst(), { kind: 'target' });

    expect(target).toMatchObject({
      kind: 'target',
      name: 'stable keyword（精准匹配）',
      matchType: 'exact',
      campaignName: 'Stable Campaign',
      adGroupName: 'Stable Ad Group',
      entityId: 'opaque-keyword-401',
      entityRevision: 3,
      resolved: true,
      nonExecutable: false,
    });
    expect(target).not.toHaveProperty('resolutionReason');
    const dailyMetric = {
      batchId, reportType: 'keyword' as const,
      campaign: 'Stable Campaign', adGroup: 'Stable Ad Group',
      targeting: 'stable keyword', searchTerm: '', matchType: 'exact',
      spend: 25, sales: 100, sourceRow: 402, date: '2026-07-20',
      sourceFile: `C:/reports/${batchId}/keyword.xlsx`,
    };
    insertAdMetric(harness, harness.firstStoreId, dailyMetric);
    insertVerifiedAdEntityAuthority(harness, {
      storeId: harness.firstStoreId, batchId, authorityId: 'stable-authority-second-date',
      adEntityId: 'opaque-keyword-401', entityRevision: 4, entityType: 'keyword',
      entityName: 'stable keyword', campaignName: 'Stable Campaign', adGroupName: 'Stable Ad Group', sourceRow: 402,
    });
    expect(harness.service.listAdObjects(harness.switchFirst(), { kind: 'target' })[0])
      .toMatchObject({ entityId: 'opaque-keyword-401', resolved: true, nonExecutable: false, sourceRowCount: 2 });
    insertAdMetric(harness, harness.firstStoreId, { ...dailyMetric, sourceRow: 403 });
    expect(harness.service.listAdObjects(harness.switchFirst(), { kind: 'target' })[0])
      .toMatchObject({ resolved: false, nonExecutable: true, sourceRowCount: 3 });
  });

it.each(['auto_targeting', 'product_targeting'] as const)(
    'keeps a stable %s identity resolved but outside the V1 keyword execution allowlist',
    (reportType) => {
      const harness = createHarness();
      const batchId = `production-${reportType}-authority`;
      insertProductionLineage(harness, {
        storeId: harness.firstStoreId,
        batchId,
        createdAt: '2026-07-22T01:00:00.000Z',
      });
      insertAdMetric(harness, harness.firstStoreId, {
        batchId,
        reportType,
        campaign: 'Stable Campaign',
        adGroup: 'Stable Ad Group',
        targeting: 'stable non-keyword target',
        searchTerm: '',
        spend: 25,
        sales: 100,
        sourceRow: 402,
        sourceFile: `C:/reports/${batchId}/${reportType}.xlsx`,
      });
      insertVerifiedAdEntityAuthority(harness, {
        storeId: harness.firstStoreId,
        batchId,
        authorityId: `stable-${reportType}-authority`,
        adEntityId: `opaque-${reportType}-402`,
        entityRevision: 1,
        entityType: reportType,
        entityName: 'stable non-keyword target',
        campaignName: 'Stable Campaign',
        adGroupName: 'Stable Ad Group',
        sourceRow: 402,
      });

      const [target] = harness.service.listAdObjects(harness.switchFirst(), { kind: 'target' });

      expect(target).toMatchObject({
        entityId: `opaque-${reportType}-402`,
        entityRevision: 1,
        resolved: true,
        nonExecutable: true,
      });
    },
  );

it('keeps a target non-executable when its current path matches multiple stable Ads identities', () => {
    const harness = createHarness();
    const batchId = 'production-ambiguous-authority';
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId,
      createdAt: '2026-07-22T01:00:00.000Z',
    });
    for (const sourceRow of [501, 502]) {
      insertAdMetric(harness, harness.firstStoreId, {
        batchId,
        reportType: 'keyword',
        campaign: 'Ambiguous Campaign',
        adGroup: 'Ambiguous Ad Group',
        targeting: 'ambiguous keyword',
        searchTerm: '',
        spend: 10,
        sales: 100,
        sourceRow,
        sourceFile: `C:/reports/${batchId}/keyword.xlsx`,
      });
      insertVerifiedAdEntityAuthority(harness, {
        storeId: harness.firstStoreId,
        batchId,
        authorityId: `ambiguous-authority-${sourceRow}`,
        adEntityId: `opaque-keyword-${sourceRow}`,
        entityRevision: 1,
        entityType: 'keyword',
        entityName: 'ambiguous keyword',
        campaignName: 'Ambiguous Campaign',
        adGroupName: 'Ambiguous Ad Group',
        sourceRow,
      });
    }

    const [target] = harness.service.listAdObjects(harness.switchFirst(), { kind: 'target' });

    expect(target).toMatchObject({
      name: 'ambiguous keyword',
      resolved: false,
      nonExecutable: true,
      resolutionReason: 'STABLE_ENTITY_ID_UNAVAILABLE',
    });
    expect(target).not.toHaveProperty('entityId');
    expect(target).not.toHaveProperty('entityRevision');
  });

it('keeps a stable Ads identity non-executable after its imported identity path drifts', () => {
    const harness = createHarness();
    const batchId = 'production-drifted-authority';
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId,
      createdAt: '2026-07-22T01:00:00.000Z',
    });
    const metricId = insertAdMetric(harness, harness.firstStoreId, {
      batchId,
      reportType: 'keyword',
      campaign: 'Before Drift Campaign',
      adGroup: 'Before Drift Ad Group',
      targeting: 'before drift keyword',
      searchTerm: '',
      spend: 10,
      sales: 100,
      sourceRow: 601,
      sourceFile: `C:/reports/${batchId}/keyword.xlsx`,
    });
    insertVerifiedAdEntityAuthority(harness, {
      storeId: harness.firstStoreId,
      batchId,
      authorityId: 'drifted-authority-1',
      adEntityId: 'opaque-keyword-601',
      entityRevision: 4,
      entityType: 'keyword',
      entityName: 'before drift keyword',
      campaignName: 'Before Drift Campaign',
      adGroupName: 'Before Drift Ad Group',
      sourceRow: 601,
    });
    harness.db.prepare(`
      UPDATE ad_daily_metrics
      SET targeting = 'after drift keyword'
      WHERE id = ? AND store_id = ?
    `).run(metricId, harness.firstStoreId);

    const [target] = harness.service.listAdObjects(harness.switchFirst(), { kind: 'target' });

    expect(target).toMatchObject({
      name: 'after drift keyword',
      resolved: false,
      nonExecutable: true,
      resolutionReason: 'STABLE_ENTITY_ID_UNAVAILABLE',
    });
    expect(target).not.toHaveProperty('entityId');
    expect(target).not.toHaveProperty('entityRevision');
  });

it('never overlays a same-named stable Ads identity owned by another store', () => {
    const harness = createHarness();
    const firstBatchId = 'production-first-store-unresolved';
    const secondBatchId = 'production-second-store-authority';
    insertProductionLineage(harness, {
      storeId: harness.firstStoreId,
      batchId: firstBatchId,
      createdAt: '2026-07-22T01:00:00.000Z',
    });
    insertProductionLineage(harness, {
      storeId: harness.secondStoreId,
      batchId: secondBatchId,
      createdAt: '2026-07-22T01:00:00.000Z',
    });
    insertAdMetric(harness, harness.firstStoreId, {
      batchId: firstBatchId,
      reportType: 'keyword',
      campaign: 'Same Campaign',
      adGroup: 'Same Ad Group',
      targeting: 'same keyword',
      searchTerm: '',
      spend: 10,
      sales: 100,
      sourceRow: 701,
      sourceFile: `C:/reports/${firstBatchId}/keyword.xlsx`,
    });
    insertAdMetric(harness, harness.secondStoreId, {
      batchId: secondBatchId,
      reportType: 'keyword',
      campaign: 'Same Campaign',
      adGroup: 'Same Ad Group',
      targeting: 'same keyword',
      searchTerm: '',
      spend: 10,
      sales: 100,
      sourceRow: 702,
      sourceFile: `C:/reports/${secondBatchId}/keyword.xlsx`,
    });
    insertVerifiedAdEntityAuthority(harness, {
      storeId: harness.secondStoreId,
      batchId: secondBatchId,
      authorityId: 'second-store-authority-1',
      adEntityId: 'opaque-second-store-keyword',
      entityRevision: 2,
      entityType: 'keyword',
      entityName: 'same keyword',
      campaignName: 'Same Campaign',
      adGroupName: 'Same Ad Group',
      sourceRow: 702,
    });

    const [target] = harness.service.listAdObjects(harness.switchFirst(), { kind: 'target' });

    expect(target).toMatchObject({
      storeId: harness.firstStoreId,
      name: 'same keyword',
      resolved: false,
      nonExecutable: true,
      resolutionReason: 'STABLE_ENTITY_ID_UNAVAILABLE',
    });
    expect(target).not.toHaveProperty('entityId');
    expect(target).not.toHaveProperty('entityRevision');
  });
});
