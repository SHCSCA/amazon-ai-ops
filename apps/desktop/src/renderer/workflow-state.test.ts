import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deriveWorkflowEvidence, selectNextSafeAction } from './workflow-state';
import type { WorkflowEvidence } from './workflow-state';
import { normalizeDeliveryReadiness } from '../main/delivery-readiness-view';

const mainDeliveryEvidencePassFixture = JSON.parse(readFileSync(
  new URL('../main/fixtures/delivery-evidence-status-pass.fixture.json', import.meta.url),
  'utf8',
));

const completeEvidence: WorkflowEvidence = {
  productSelected: true,
  scopeReady: true,
  reportsReady: true,
  importState: 'ready',
  diagnosisReady: true,
  recommendationState: 'ready',
  approvalComplete: true,
  readback: { verifiedCount: 1, verificationStatus: 'verified' },
  delivery: {
    appReady: true,
    manifestDriven: true,
    previewOnly: false,
    packageSmoke: 'current',
    packageHash: 'match',
  },
};

describe('selectNextSafeAction', () => {
  it.each([
    {
      name: 'product not selected', evidence: { productSelected: false }, stage: 'product-selection', label: '选择运营产品',
      intent: { workspace: 'product', subview: 'products' },
    },
    {
      name: 'scope missing', evidence: { scopeReady: false }, stage: 'scope-setup', label: '配置工作范围',
      intent: { workspace: 'data-preparation', subview: 'scope' },
    },
    {
      name: 'reports missing', evidence: { reportsReady: false }, stage: 'report-collection', label: '采集真实报表',
      intent: { workspace: 'data-preparation', subview: 'reports' },
    },
    {
      name: 'import pending', evidence: { importState: 'pending' as const }, stage: 'import-validation', label: '检查导入结果',
      intent: { workspace: 'data-preparation', subview: 'import-check' },
    },
    {
      name: 'diagnosis pending', evidence: { diagnosisReady: false }, stage: 'diagnosis', label: '运行广告诊断',
      intent: { workspace: 'diagnosis', subview: 'analysis' },
    },
    {
      name: 'recommendations absent', evidence: { recommendationState: 'absent' as const }, stage: 'recommendations', label: '生成优化建议',
      intent: { workspace: 'decisions', subview: 'recommendations' },
    },
    {
      name: 'recommendations mixed', evidence: { recommendationState: 'mixed' as const }, stage: 'recommendations', label: '复核优化建议',
      intent: { workspace: 'decisions', subview: 'recommendations' },
    },
    {
      name: 'approval pending', evidence: { approvalComplete: false }, stage: 'approval', label: '进入人工审批',
      intent: { workspace: 'decisions', subview: 'approval' },
    },
    {
      name: 'readback evidence missing',
      evidence: { readback: { verifiedCount: 0, verificationStatus: 'missing' as const } },
      stage: 'readback', label: '补齐执行回读', intent: { workspace: 'readback', subview: 'evidence' },
    },
    {
      name: 'delivery pending',
      evidence: { delivery: { ...completeEvidence.delivery, appReady: false } },
      stage: 'delivery', label: '检查交付验收', intent: { workspace: 'system', subview: 'delivery' },
    },
  ])('returns one concrete blocked action when $name', ({ evidence, stage, label, intent }) => {
    const action = selectNextSafeAction({ ...completeEvidence, ...evidence });

    expect(action).toMatchObject({ blocked: true, stage, label, intent });
    expect(action.reason.trim().length).toBeGreaterThan(0);
  });

  it.each([
    ['failed verification with a positive count', { verifiedCount: 1, verificationStatus: 'failed' as const }],
    ['verified status without any evidence rows', { verifiedCount: 0, verificationStatus: 'verified' as const }],
  ])('fails closed for contradictory readback provenance: %s', (_name, readback) => {
    expect(selectNextSafeAction({ ...completeEvidence, readback })).toMatchObject({
      blocked: true,
      stage: 'readback',
      intent: { workspace: 'readback', subview: 'evidence' },
    });
  });

  it.each([
    ['preview-only', { previewOnly: true }],
    ['manifest missing', { manifestDriven: false }],
    ['package smoke missing', { packageSmoke: 'missing' as const }],
    ['package smoke stale', { packageSmoke: 'stale' as const }],
    ['package hash missing', { packageHash: 'missing' as const }],
    ['package hash mismatch', { packageHash: 'mismatch' as const }],
  ])('fails closed for non-authoritative delivery provenance: %s', (_name, deliveryPatch) => {
    const action = selectNextSafeAction({
      ...completeEvidence,
      delivery: { ...completeEvidence.delivery, ...deliveryPatch },
    });

    expect(action).toMatchObject({
      blocked: true,
      stage: 'delivery',
      intent: { workspace: 'system', subview: 'delivery' },
    });
  });

  it('prioritizes the earliest unsafe contradiction instead of trusting downstream ready flags', () => {
    const action = selectNextSafeAction({
      ...completeEvidence,
      diagnosisReady: false,
      recommendationState: 'ready',
      approvalComplete: true,
    });

    expect(action.stage).toBe('diagnosis');
    expect(action.blocked).toBe(true);
  });

  it('returns operational completion only for verified current-package provenance', () => {
    const action = selectNextSafeAction(completeEvidence);

    expect(action).toMatchObject({
      blocked: false,
      stage: 'complete',
      label: '返回今日工作',
      intent: { workspace: 'today', subview: 'overview' },
    });
    expect(action.reason).toContain('正式验收证据');
    expect(action.reason).not.toContain('APP_READY');
  });

  it('does not describe approval as execution or preview as production readiness', () => {
    const branches = [
      { ...completeEvidence, approvalComplete: false },
      { ...completeEvidence, readback: { verifiedCount: 0, verificationStatus: 'missing' as const } },
      { ...completeEvidence, delivery: { ...completeEvidence.delivery, previewOnly: true } },
    ].map(selectNextSafeAction);
    const copy = branches.map((branch) => `${branch.reason} ${branch.label}`).join('\n');

    expect(copy).not.toMatch(/审批.{0,8}(已执行|执行完成)/);
    expect(copy).not.toMatch(/预览.{0,8}APP_READY/);
  });
});

describe('deriveWorkflowEvidence', () => {
  const authoritativeSnapshot = {
    scope: {
      dateFrom: '2026-07-01', dateTo: '2026-07-07', storeName: 'FT-US-US', marketplaceCode: 'US', asin: 'B001',
    },
    pipeline: {
      collection: { status: 'ready', fileAudit: { missingReportLabels: [], realReportFileCount: 8 } },
      quant: { hasImportedMetrics: true, diagnostics: [{ diagnosis: '高 ACOS' }] },
    },
    recommendations: { pending: 0, needsReview: 0, approved: 2 },
    readback: { verifiedCount: 1, latestStatus: 'verified' },
    readiness: {
      appReady: true,
      manifestDriven: true,
      previewOnly: false,
      gates: [
        { id: 'release-package-hash', name: 'Release package hash', ok: true },
        { id: 'package-launch-smoke', name: 'Package launch smoke', ok: true },
      ],
      failures: [],
    },
  };

  it('derives complete evidence only from verified readback and shared evaluator package gates', () => {
    expect(deriveWorkflowEvidence(authoritativeSnapshot)).toEqual(completeEvidence);
  });

  it.each(['PASS', 'pass', 'passed', 'verified', 'ready'])('accepts verified readback status %s when verifiedCount is positive', (latestStatus) => {
    const evidence = deriveWorkflowEvidence({
      ...authoritativeSnapshot,
      readback: { verifiedCount: 1, latestStatus },
    });

    expect(evidence.readback).toEqual({ verifiedCount: 1, verificationStatus: 'verified' });
  });

  it('consumes the real main delivery evidence payload fixture with PASS readback evidence', () => {
    const readiness = normalizeDeliveryReadiness({
      status: 'APP_READY',
      appReady: true,
      manifestDriven: true,
      previewOnly: false,
      gates: [
        { id: 'release-package-hash', name: 'Release package hash', ok: true },
        { id: 'package-launch-smoke', name: 'Package launch smoke', ok: true },
      ],
      failures: [],
    }, 'D:/evidence/final-readiness.json');
    const evidence = deriveWorkflowEvidence({
      ...authoritativeSnapshot,
      readback: mainDeliveryEvidencePassFixture.readback,
      readiness,
    });

    expect(evidence).toEqual(completeEvidence);
    expect(selectNextSafeAction(evidence).stage).toBe('complete');
  });

  it('distinguishes report files waiting for import from missing reports', () => {
    const evidence = deriveWorkflowEvidence({
      ...authoritativeSnapshot,
      pipeline: {
        ...authoritativeSnapshot.pipeline,
        quant: { hasImportedMetrics: false, diagnostics: [] },
      },
    });

    expect(evidence.reportsReady).toBe(true);
    expect(evidence.importState).toBe('pending');
    expect(evidence.diagnosisReady).toBe(false);
  });

  it('keeps preview-only readiness blocked even when preview flags claim the workflow is complete', () => {
    const evidence = deriveWorkflowEvidence({
      ...authoritativeSnapshot,
      readiness: { ...authoritativeSnapshot.readiness, previewOnly: true },
    });

    expect(evidence.delivery.previewOnly).toBe(true);
    expect(selectNextSafeAction(evidence).stage).toBe('delivery');
  });

  it('maps evaluator failure provenance to stale smoke and package mismatch', () => {
    const evidence = deriveWorkflowEvidence({
      ...authoritativeSnapshot,
      readiness: {
        ...authoritativeSnapshot.readiness,
        gates: [
          { id: 'release-package-hash', name: 'Release package hash', ok: true },
          { id: 'package-launch-smoke', name: 'Package launch smoke', ok: false },
        ],
        failures: [
          { gateId: 'package-launch-smoke', code: 'PACKAGE_SMOKE_STALE' },
          { gateId: 'package-launch-smoke', code: 'PACKAGE_SMOKE_PORTABLE_HASH_MISMATCH' },
        ],
      },
    });

    expect(evidence.delivery.packageSmoke).toBe('stale');
    expect(evidence.delivery.packageHash).toBe('mismatch');
    expect(selectNextSafeAction(evidence).stage).toBe('delivery');
  });
});
