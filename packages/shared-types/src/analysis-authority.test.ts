import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_REQUIRED_REPORT_TYPES,
  validateAnalysisEvidencePackage,
  validateAnalysisProposalSnapshot,
  validateVerifiedAdEntityAuthority,
  type AnalysisEvidencePackageRecord,
  type AnalysisProposalSnapshotRecord,
  type VerifiedAdEntityAuthorityRecord,
} from './analysis-authority';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function evidencePackage(): AnalysisEvidencePackageRecord {
  return {
    id: 'evidence-1',
    storeId: 'store-one' as AnalysisEvidencePackageRecord['storeId'],
    marketplace: 'US',
    currency: 'USD',
    missionId: 'mission-1',
    dataBatchId: 'batch-1',
    importRunId: 'run-1',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-22',
    asin: 'B0TEST',
    reportTypes: ANALYSIS_REQUIRED_REPORT_TYPES,
    sources: ANALYSIS_REQUIRED_REPORT_TYPES.map((reportType, index) => ({
      reportType,
      fileHash: index % 2 === 0 ? HASH_A : HASH_B,
      fileSizeBytes: 100 + index,
      importedRows: 10,
      metricRows: 10,
      firstSourceRow: 2,
      lastSourceRow: 11,
    })),
    metricRowCount: 80,
    reconciliationHash: HASH_B,
    ruleRevision: HASH_C,
    modelRevision: 'gpt-5.6:ad_strategy_diagnosis_v1',
    packageHash: HASH_A,
    importedAt: '2026-07-22T01:00:00.000Z',
    freshUntil: '2026-07-24T01:00:00.000Z',
    sealedAt: '2026-07-22T02:00:00.000Z',
    createdSessionGeneration: 4,
  };
}

function authority(): VerifiedAdEntityAuthorityRecord {
  return {
    authorityId: 'authority-1',
    storeId: 'store-one' as VerifiedAdEntityAuthorityRecord['storeId'],
    adEntityId: 'opaque-amazon-keyword-id',
    entityRevision: 1,
    entityType: 'keyword',
    entityName: 'door lock',
    campaignName: 'Campaign A',
    adGroupName: 'Ad Group A',
    evidencePackageId: 'evidence-1',
    sourceReportType: 'keyword',
    sourceFileHash: HASH_A,
    sourceRow: 17,
    identitySource: 'ads_ui',
    proofSha256: HASH_B,
    verifiedBy: 'operator',
    verifiedAt: '2026-07-22T02:05:00.000Z',
    createdAt: '2026-07-22T02:05:00.000Z',
  };
}

function proposal(): AnalysisProposalSnapshotRecord {
  return {
    id: 'proposal-1',
    storeId: 'store-one' as AnalysisProposalSnapshotRecord['storeId'],
    marketplace: 'US',
    currency: 'USD',
    missionId: 'mission-1',
    missionRevision: 3,
    evidencePackageId: 'evidence-1',
    evidencePackageHash: HASH_A,
    dataBatchId: 'batch-1',
    policyVersionId: 'policy-version-1',
    policyRevision: 2,
    ruleRevision: HASH_C,
    modelRevision: 'gpt-5.6:ad_strategy_diagnosis_v1',
    actionBatchId: 'analysis-batch-1',
    actionRevision: 1,
    legacyRecommendationId: 31,
    actionType: 'set_keyword_bid',
    entityType: 'keyword',
    entityName: 'door lock',
    campaignName: 'Campaign A',
    adGroupName: 'Ad Group A',
    adEntityAuthorityId: 'authority-1',
    adEntityId: 'opaque-amazon-keyword-id',
    adEntityRevision: 1,
    currentBidCents: 149,
    proposedBidCents: 129,
    changePct: -13.42,
    confidence: 0.88,
    source: 'rule_ai',
    explanation: 'High ACOS with aligned rule and AI evidence.',
    authorization: {
      human: { eligible: true, blockers: [] },
      policy: { eligible: true, blockers: [] },
    },
    validUntil: '2026-07-23T02:00:00.000Z',
    createdAt: '2026-07-22T02:00:00.000Z',
    createdSessionGeneration: 4,
  };
}

describe('Stage 5 analysis authority contracts', () => {
  it('accepts exactly eight path-free report source proofs', () => {
    const value = evidencePackage();
    expect(() => validateAnalysisEvidencePackage(value)).not.toThrow();
    expect(JSON.stringify(value)).not.toMatch(/[A-Z]:[\\/]|sourceFile|filePath/i);
  });

  it('rejects incomplete report coverage and non-US currency', () => {
    const missing = evidencePackage();
    missing.reportTypes = missing.reportTypes.slice(1);
    expect(() => validateAnalysisEvidencePackage(missing)).toThrow(/eight required/i);

    const wrongCurrency = { ...evidencePackage(), currency: 'CNY' } as unknown as AnalysisEvidencePackageRecord;
    expect(() => validateAnalysisEvidencePackage(wrongCurrency)).toThrow(/US marketplace and USD/i);
  });

  it('accepts hashed Ads identity authority and rejects report/entity drift', () => {
    expect(() => validateVerifiedAdEntityAuthority(authority())).not.toThrow();
    expect(() => validateVerifiedAdEntityAuthority({
      ...authority(),
      sourceReportType: 'auto_targeting',
    })).toThrow(/source report must match/i);
  });

  it('binds grant eligibility to a complete stable identity tuple', () => {
    expect(() => validateAnalysisProposalSnapshot(proposal())).not.toThrow();
    expect(() => validateAnalysisProposalSnapshot({
      ...proposal(),
      adEntityRevision: undefined,
    })).toThrow(/adEntityRevision/i);
    expect(() => validateAnalysisProposalSnapshot({
      ...proposal(),
      entityType: 'product_targeting',
    } as unknown as AnalysisProposalSnapshotRecord)).toThrow(/keyword bid changes only/i);
  });

  it('requires eligibility booleans to match their blocker sets', () => {
    expect(() => validateAnalysisProposalSnapshot({
      ...proposal(),
      source: 'rule_fallback',
      authorization: {
        human: { eligible: true, blockers: ['RULE_FALLBACK_NOT_AUTHORIZABLE'] },
        policy: { eligible: false, blockers: ['RULE_FALLBACK_NOT_AUTHORIZABLE'] },
      },
    })).toThrow(/eligible must match/i);
  });
});
