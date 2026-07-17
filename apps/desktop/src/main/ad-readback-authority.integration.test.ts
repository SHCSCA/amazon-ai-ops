import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { RecommendationRepository } from '@amazon-ai-ops/local-db';
import type {
  ActionRecommendation,
  AdReadbackAuthorityScope,
  ExportAdReadbackEvidenceRequest,
} from '@amazon-ai-ops/shared-types';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertCurrentAdReadbackEvidenceAuthority,
  buildAuthorizedAdReadbackEvidenceInput,
} from './ad-readback-authority';
import { buildAdReadbackEvidence } from './ad-readback-evidence';

interface AuthorityFixture {
  db: Database.Database;
  dir: string;
  evidencePath: string;
  recommendationId: number;
  repo: RecommendationRepository;
  reportPath: string;
  request: ExportAdReadbackEvidenceRequest;
  scope: AdReadbackAuthorityScope;
}

const fixtures: AuthorityFixture[] = [];

afterEach(() => {
  while (fixtures.length) {
    const fixture = fixtures.pop();
    if (!fixture) continue;
    fixture.db.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

function createFixture(): AuthorityFixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-readback-authority-'));
  const db = new Database(path.join(dir, 'authority.sqlite'));
  db.exec(`
    CREATE TABLE action_recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      store_name TEXT,
      marketplace_code TEXT,
      asin TEXT,
      msku TEXT,
      entity_type TEXT,
      entity_id TEXT,
      entity_name TEXT,
      action_type TEXT,
      current_value TEXT,
      recommended_value TEXT,
      reason TEXT,
      evidence_json TEXT,
      confidence REAL DEFAULT 0,
      risk_level TEXT DEFAULT 'APPROVAL',
      status TEXT DEFAULT 'pending',
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const repo = new RecommendationRepository(db);
  const reportPath = path.join(dir, 'keyword.xlsx');
  const approvalPath = path.join(dir, 'approval.png');
  const beforePath = path.join(dir, 'before.png');
  const afterPath = path.join(dir, 'after.png');
  const readbackPath = path.join(dir, 'readback.png');
  for (const filePath of [reportPath, approvalPath, beforePath, afterPath, readbackPath]) {
    fs.writeFileSync(filePath, path.basename(filePath), 'utf8');
  }

  const scope: AdReadbackAuthorityScope = {
    dateFrom: '2026-06-01',
    dateTo: '2026-06-12',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B0TESTASIN',
    batchId: 'batch_integration_1',
  };
  const pending: Omit<ActionRecommendation, 'id' | 'createdAt' | 'updatedAt'> = {
    taskId: 'task_integration_1',
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin || '',
    msku: 'MSKU-INTEGRATION-1',
    entityType: 'target',
    entityId: 'target_integration_1',
    entityName: 'tight match target',
    actionType: 'lower_bid',
    currentValue: '1.20',
    recommendedValue: '1.08',
    reason: '当前批次高 ACOS，执行有边界的降价。',
    evidence: {
      impressions: 1000,
      clicks: 30,
      cost: 40,
      orders: 1,
      sales: 60,
      acos: 0.67,
      cpc: 1.33,
      cvr: 0.03,
      date: '2026-06-12',
      portfolioName: 'D6 Portfolio',
      campaignName: 'SP exact',
      adGroupName: 'Main',
      targeting: 'tight match target',
      batchId: scope.batchId,
      reportType: 'keyword',
      sourceFile: reportPath,
      sourceFiles: [reportPath],
      sourceRow: 12,
      writableTarget: {
        entityType: 'keyword',
        entityId: 'keyword-integration-1',
        entityName: 'tight match target',
        campaignName: 'SP exact',
        adGroupName: 'Main',
        metricDate: '2026-06-12',
        sourceFile: reportPath,
        sourceRow: 12,
        identitySource: 'ads_ui',
        verifiedBy: 'Alice',
        verifiedAt: '2026-06-12T09:55:00.000Z',
        verificationNote: 'Matched the editable keyword row before approval.',
        identityProofPath: approvalPath,
      },
      explanationSource: 'ai',
      aiModel: 'deepseek-chat',
      decisionAgreement: 'aligned',
      decisionSource: 'rule_ai',
      decisionReasons: ['当前批次支持有边界的降价。'],
    },
    confidence: 0.8,
    riskLevel: 'APPROVAL',
    status: 'pending',
    revision: 0,
  };
  const recommendationId = repo.insert(pending);
  const approved = repo.updateStatusWithEvidenceIfCurrent(
    recommendationId,
    'pending',
    0,
    'approved',
    {
      approvalDecision: {
        decision: 'approved',
        approvedBy: 'Alice',
        decidedAt: '2026-06-12T10:00:00.000Z',
        note: '批准一次人工 Ads UI 动作。',
        batchId: scope.batchId,
        sourceBatchId: scope.batchId,
        metricDate: '2026-06-12',
        sourceRow: 12,
        sourceFiles: [reportPath],
        scope: {
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
          asin: scope.asin,
        },
      },
    },
  );
  expect(approved).toBe(true);
  expect(repo.findById(recommendationId)).toMatchObject({ status: 'approved', revision: 1 });

  const request: ExportAdReadbackEvidenceRequest = {
    recommendationId,
    expectedRevision: 1,
    scope,
    operatorEvidence: {
      approval: {
        operatorConfirmed: true,
        realWriteApproved: true,
        approvalArtifactPath: approvalPath,
      },
      risk: { allowedByPolicy: true },
      before: {
        value: '1.20',
        capturedAt: '2026-06-12T10:03:00.000Z',
        screenshotPath: beforePath,
        liveBidSourceNote: 'Ads UI 行已重新加载。',
      },
      after: {
        value: '1.08',
        capturedAt: '2026-06-12T10:06:00.000Z',
        screenshotPath: afterPath,
      },
      readback: {
        verified: true,
        method: 'Ads UI reload',
        readAt: '2026-06-12T10:10:00.000Z',
        actualValue: '1.08',
        evidencePath: readbackPath,
      },
      execution: {
        success: true,
        verified: true,
        executionId: 'manual-integration-001',
        executedAt: '2026-06-12T10:05:00.000Z',
        executedBy: 'QA Operator',
      },
    },
  };
  const fixture: AuthorityFixture = {
    db,
    dir,
    evidencePath: path.join(dir, 'authorized-readback.json'),
    recommendationId,
    repo,
    reportPath,
    request,
    scope,
  };
  fixtures.push(fixture);
  return fixture;
}

function sourceAuthorityFor(fixture: AuthorityFixture) {
  return {
    reportType: 'keyword',
    entityName: 'tight match target',
    campaignName: 'SP exact',
    adGroupName: 'Main',
    metricDate: '2026-06-12',
    sourceFile: fixture.reportPath,
    sourceRow: 12,
  };
}

function exportEvidence(fixture: AuthorityFixture): Record<string, any> {
  const authorizedInput = buildAuthorizedAdReadbackEvidenceInput({
    request: fixture.request,
    recommendation: fixture.repo.findById(fixture.recommendationId),
    resolvedScope: fixture.scope,
    allowedSourceFiles: [fixture.reportPath],
    sourceAuthority: sourceAuthorityFor(fixture),
  });
  const evidence = buildAdReadbackEvidence(authorizedInput);
  fs.writeFileSync(fixture.evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
  return JSON.parse(fs.readFileSync(fixture.evidencePath, 'utf8')) as Record<string, any>;
}

function reverify(fixture: AuthorityFixture, evidence: Record<string, any>): void {
  assertCurrentAdReadbackEvidenceAuthority({
    evidence,
    recommendation: fixture.repo.findById(fixture.recommendationId),
    resolvedScope: fixture.scope,
    allowedSourceFiles: [fixture.reportPath],
    sourceAuthority: sourceAuthorityFor(fixture),
  });
}

describe('ad readback authority SQLite integration', () => {
  it('exports and reverifies the current approved recommendation revision', () => {
    const fixture = createFixture();
    const evidence = exportEvidence(fixture);
    const databaseUpdatedAt = fixture.repo.findById(fixture.recommendationId)?.updatedAt || '';
    const expectedCheckedAt = new Date(`${databaseUpdatedAt.replace(' ', 'T')}Z`).toISOString();

    expect(databaseUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(evidence).toMatchObject({
      status: 'PASS',
      authority: {
        recommendationId: fixture.recommendationId,
        recommendationRevision: 1,
        recommendationStatusAtExport: 'approved',
        batchId: fixture.scope.batchId,
        checkedAt: expectedCheckedAt,
      },
    });
    expect(() => reverify(fixture, evidence)).not.toThrow();
  });

  it('fails closed when the exported revision is stale', () => {
    const fixture = createFixture();
    const evidence = exportEvidence(fixture);

    fixture.repo.updateStatus(fixture.recommendationId, 'approved');

    expect(fixture.repo.findById(fixture.recommendationId)).toMatchObject({ status: 'approved', revision: 2 });
    expect(() => reverify(fixture, evidence)).toThrow(/建议版本已变化/);
  });

  it('fails closed when the approved row changes status', () => {
    const fixture = createFixture();
    const evidence = exportEvidence(fixture);

    fixture.repo.updateStatus(fixture.recommendationId, 'executed');

    expect(() => reverify(fixture, evidence)).toThrow(/当前状态 executed/);
  });

  it.each([
    ['batch', (evidence: Record<string, any>) => { evidence.authority.batchId = 'batch_foreign'; }, /当前运行范围不一致/],
    ['source', (evidence: Record<string, any>) => { evidence.source.sourceFiles = ['C:/foreign/report.xlsx']; }, /权威字段已被修改/],
    ['scope', (evidence: Record<string, any>) => { evidence.authority.storeName = 'OTHER-US'; }, /当前运行范围不一致/],
  ] as const)('fails closed when the exported %s authority no longer matches', (_label, mutate, expected) => {
    const fixture = createFixture();
    const evidence = exportEvidence(fixture);

    mutate(evidence);

    expect(() => reverify(fixture, evidence)).toThrow(expected);
  });
});
