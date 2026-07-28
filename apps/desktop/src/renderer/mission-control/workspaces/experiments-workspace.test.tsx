import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ExperimentRecord, MissionControlCapabilityProjection, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createPreviewExperimentMemoryDomainSuite } from './mission-domain-window-api';
import { ExperimentsWorkspace, buildCreateExperimentInput, buildUpdateExperimentInput, preferredExperimentId } from './experiments-workspace';

const context = {
  storeId: 'preview-store-shc001', browserProfileId: 'preview-profile-shc001',
  marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22', sessionGeneration: 1,
} as StoreContextEnvelope;

function capability(capabilityId: string, state: MissionControlCapabilityProjection['state'] = 'PROTOTYPE_ONLY'): MissionControlCapabilityProjection {
  const action = capabilityId.endsWith('.view') ? 'view'
    : capabilityId.endsWith('.start') ? 'start'
      : capabilityId.endsWith('.complete') ? 'complete'
        : capabilityId.split('.').at(-1) as MissionControlCapabilityProjection['action'];
  return { capabilityId, workspace: 'experiments', view: 'experiments/ledger', action, state, detail: `${capabilityId} ${state}` };
}

const previewCapabilities = [
  'experiments.experiment.view', 'experiments.experiment.create', 'experiments.experiment.update',
  'experiments.experiment.start', 'experiments.experiment.pause', 'experiments.experiment.resume',
  'experiments.experiment.complete', 'experiments.experiment.archive', 'experiments.experiment.restore',
  'experiments.observation.create',
].map((id) => capability(id));

describe('ExperimentsWorkspace', () => {
  it('renders the complete US/USD experiment control surface', () => {
    const suite = createPreviewExperimentMemoryDomainSuite();
    const markup = renderToStaticMarkup(<ExperimentsWorkspace
      apiOverride={suite.experiments}
      blockedReason="仅开发预览"
      capabilities={previewCapabilities}
      previewMode
      storeContext={context}
    />);
    expect(markup).toContain('data-canonical-surface="experiments"');
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toContain('<h1 id="workspace-page-experiments-ledger-title">经营实验</h1>');
    expect(markup).toContain('经营实验');
    expect(markup).toContain('Amazon US / USD');
    expect(markup).toContain('新建 Experiment');
    expect(markup).toContain('显式开发预览');
    expect(markup).toContain('data-task-density="compact"');
    expect(markup).not.toContain('删除 Experiment');
  });

  it('prefers an active running experiment without reordering the durable ledger', () => {
    const records = [
      { id: 'ARCHIVED-FIRST', status: 'archived' },
      { id: 'PAUSED-SECOND', status: 'paused' },
      { id: 'RUNNING-THIRD', status: 'running' },
    ] as const;
    expect(preferredExperimentId(records)).toBe('RUNNING-THIRD');
    expect(records.map((record) => record.id)).toEqual(['ARCHIVED-FIRST', 'PAUSED-SECOND', 'RUNNING-THIRD']);
    expect(preferredExperimentId(records.filter((record) => record.status !== 'running'))).toBe('PAUSED-SECOND');
  });

  it('fails closed without a production experiment API or view capability', () => {
    const markup = renderToStaticMarkup(<ExperimentsWorkspace
      blockedReason="Experiment Main Authority 未接入"
      capabilities={[capability('experiments.experiment.view', 'BLOCKED')]}
      previewMode={false}
      storeContext={context}
    />);
    expect(markup).toContain('data-capability-state="BLOCKED"');
    expect(markup).toContain('已阻断');
    expect(markup).not.toContain('显式内存 adapter');
  });

  it('builds structured create payloads and revision-bound updates', () => {
    const draft = {
      missionId: 'MISSION-SHC001-001', name: '核心词竞价实验', hypothesis: '降价 10% 会改善 ACOS',
      primaryMetric: 'ACOS', guardrailMetrics: '广告订单；CVR', guardrailCriteria: '订单下降 < 15%；CVR 不低于基线 90%',
      productId: 'B0GTTJFQTM', adEntityId: 'KW-001', baselineJson: '{"bidUsd":1.2}',
      variantJson: '{"bidUsd":1.08}', observationStartsOn: '2026-07-22', observationEndsOn: '2026-07-29',
      conclusion: '',
    };
    const created = buildCreateExperimentInput(draft, 'EXPERIMENT-001');
    expect(created).toMatchObject({
      baseline: { bidUsd: 1.2 }, variant: { bidUsd: 1.08 },
      guardrailMetrics: ['广告订单', 'CVR'], observationStartsAt: '2026-07-22T07:00:00.000Z',
    });
    const record = {
      ...created, storeId: context.storeId, status: 'paused', revision: 4,
      createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
    } as ExperimentRecord;
    expect(buildUpdateExperimentInput(record, { ...draft, conclusion: 'ACOS 改善 12%' }))
      .toMatchObject({ expectedRevision: 4, patch: { conclusion: 'ACOS 改善 12%' } });
    expect(() => buildCreateExperimentInput({ ...draft, baselineJson: '{invalid' }, 'EXPERIMENT-002')).toThrow(/合法 JSON/);
  });
});
