import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ExperimentRecord, MissionControlCapabilityProjection, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createPreviewExperimentMemoryDomainSuite } from './mission-domain-window-api';
import { ExperimentsWorkspace, buildCreateExperimentInput, buildExperimentDraft, buildExperimentSelectorOptions, buildUpdateExperimentInput, preferredExperimentId } from './experiments-workspace';

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

function ordinaryText(markup: string): string {
  return markup
    .replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
    .replace(/<i\b[^>]*hidden=""[^>]*>[\s\S]*?<\/i>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('ExperimentsWorkspace', () => {
  it('uses searchable owned-object selectors and a structured guardrail condition', () => {
    const source = readFileSync(new URL('./experiments-workspace.tsx', import.meta.url), 'utf8');
    expect(source).toContain('SearchableOptionSelect');
    expect(source).toContain('比较符');
    expect(source).toContain('阈值');
    expect(source).toContain('活动 > 广告组 > 关键词/投放');
    expect(source).toContain('listStoreProducts');
    expect(source).toContain('listStoreAdObjects');
  });

  it('gives an actionable next step when the current store has no mission to bind', () => {
    const source = readFileSync(new URL('./experiments-workspace.tsx', import.meta.url), 'utf8');
    expect(source).toContain('当前店铺没有可用运营任务，经营实验必须先绑定运营任务。');
    expect(source).toContain('先创建运营任务');
    expect(source).toContain("{ workspace: 'missions', subview: 'overview' }");
    expect(source).toContain('需要按产品范围经营时，请先添加产品。');
    expect(source).toContain('先添加产品');
    expect(source).toContain("onNavigate('product-management')");
    expect(source).toContain('需要对象级实验时，请先采集并导入广告对象。');
    expect(source).toContain('先采集广告对象');
    expect(source).toContain("onNavigate('data-collection')");
  });

  it('keeps long editor bodies scrollable while their action footers stay reachable', () => {
    const css = readFileSync(new URL('./experiments-workspace.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.experiment-observation-editor\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.experiment-complete-dialog\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.experiment-form\s*\{[^}]*overflow-y:\s*auto;/s);
    expect(css).toMatch(/\.experiment-complete-dialog\s*>\s*label\s*\{[^}]*overflow-y:\s*auto;/s);
  });

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
    expect(markup).toContain('仅开发预览');
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

  it('keeps production ordinary copy operator-facing when the blocker contains internal terms', () => {
    const markup = renderToStaticMarkup(<ExperimentsWorkspace
      blockedReason="Experiment Main Authority 未接入；UNKNOWN revision draft set_keyword_bid"
      capabilities={[capability('experiments.experiment.view', 'BLOCKED')]}
      previewMode={false}
      storeContext={context}
    />);
    const text = ordinaryText(markup);
    expect(text).toContain('经营实验');
    expect(text).not.toMatch(/Mission|Experiment|Decision|Authority|Renderer|Main|UNKNOWN|\brevision\b|\bdraft\b|set_keyword_bid/);
    expect(markup).not.toMatch(/aria-label="[^"]*Experiment/);
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
    expect(() => buildCreateExperimentInput({ ...draft, missionId: '' }, 'EXPERIMENT-003'))
      .toThrow('请绑定运营任务，并填写实验名称与可证伪假设。');
  });

  it('preserves an existing structured guardrail when opening the edit dialog', () => {
    const created = buildCreateExperimentInput({
      missionId: 'MISSION-SHC001-001', name: '核心词竞价实验', hypothesis: '降价会改善 ACOS',
      primaryMetric: 'ACOS', guardrailMetrics: '广告订单', guardrailCriteria: '广告订单 >= 12.5%',
      guardrailComparator: '>=', guardrailThreshold: '12.5', productId: 'B0GTTJFQTM', adEntityId: 'KW-001',
      baselineJson: '{"bidUsd":1.2}', variantJson: '{"bidUsd":1.08}',
      observationStartsOn: '2026-07-22', observationEndsOn: '2026-07-29', conclusion: '',
    }, 'EXPERIMENT-EDIT');
    const record = {
      ...created, storeId: context.storeId, status: 'paused', revision: 4,
      createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
    } as ExperimentRecord;

    const editDraft = buildExperimentDraft(context, record);

    expect(editDraft).toMatchObject({
      guardrailMetrics: '广告订单',
      guardrailCriteria: '广告订单 >= 12.5%',
      guardrailComparator: '>=',
      guardrailThreshold: '12.5',
    });
    expect(buildUpdateExperimentInput(record, editDraft).patch.guardrailCriteria).toEqual(['广告订单 >= 12.5%']);
  });

  it('offers only current-store executable keyword targets with human-readable hierarchy', () => {
    const options = buildExperimentSelectorOptions(
      [
        { id: 'MISSION-CURRENT', title: '降低核心词浪费', status: 'running' },
        { id: 'MISSION-ARCHIVED', title: '旧任务', status: 'archived' },
      ],
      [{ id: 7, asin: 'B0TEST0001', title: '黑色充电器' }],
      [
        { kind: 'campaign', entityId: 'INTERNAL-CAMPAIGN', resolved: true, nonExecutable: false, name: '品牌活动' },
        { kind: 'target', entityId: 'INTERNAL-KEYWORD', resolved: true, nonExecutable: false, name: 'usb c charger', campaignName: '品牌活动', adGroupName: '核心词组' },
        { kind: 'target', entityId: 'UNRESOLVED-KEYWORD', resolved: false, nonExecutable: true, name: '不可执行词', campaignName: '品牌活动', adGroupName: '核心词组' },
      ],
    );

    expect(options.missions).toEqual([{ value: 'MISSION-CURRENT', label: '降低核心词浪费' }]);
    expect(options.products).toEqual([{ value: 'B0TEST0001', label: '黑色充电器 · B0TEST0001' }]);
    expect(options.adObjects).toEqual([{ value: 'INTERNAL-KEYWORD', label: '品牌活动 > 核心词组 > usb c charger' }]);
    expect(options.adObjects.map((option) => option.label).join(' ')).not.toContain('INTERNAL-KEYWORD');
  });
});
