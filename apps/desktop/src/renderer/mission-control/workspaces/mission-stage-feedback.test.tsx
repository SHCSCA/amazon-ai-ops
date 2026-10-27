import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CausalEventRecord, MissionCheckpointRecord, MissionRecord } from '@amazon-ai-ops/shared-types';
import { MISSION_PHASE_SEQUENCE, CHECKPOINT_STAGE_FOR_PHASE, missionFlightPlanRows } from './mission-workspace-flight-plan';
import { MissionStageFeedback, missionStageFeedback } from './mission-stage-feedback';

const mission = { id: 'mission-a', storeId: 'store-a' } as MissionRecord;
const now = '2026-10-16T12:00:00.000Z';

describe('persisted Mission stage operator feedback', () => {
  it.each(MISSION_PHASE_SEQUENCE)('renders %s status, real result, scoped blocker and an exact recovery intent', phase => {
    const checkpoint = { id: `result-${phase}`, storeId: mission.storeId, missionId: mission.id,
      stage: CHECKPOINT_STAGE_FOR_PHASE[phase], title: '本阶段已保存可核对结果', status: 'recorded', evidenceCount: 1,
      actorId: 'system-authority', createdAt: now } as MissionCheckpointRecord;
    const event = { id: `blocked-${phase}`, storeId: mission.storeId, missionId: mission.id,
      stage: CHECKPOINT_STAGE_FOR_PHASE[phase], eventType: 'system_blocked', title: '本阶段停止', signal: '当前证据不完整，请核对来源后重试。',
      status: 'blocked', source: 'system-authority', actorId: 'system-authority', sequence: 1, createdAt: now } as CausalEventRecord;
    const row = missionFlightPlanRows(phase, 'blocked', [checkpoint]).find(item => item.phase === phase)!;
    const model = missionStageFeedback(row, mission, [event]);
    expect(model).toMatchObject({ status: '阶段已阻断', result: checkpoint.title, reason: event.signal });
    const onNavigate = vi.fn();
    const tree = MissionStageFeedback({ row, mission, events: [event], onNavigate });
    const markup = renderToStaticMarkup(tree);
    for (const text of ['当前状态', '最近结果', '阻断或等待原因', checkpoint.title, event.signal!]) expect(markup).toContain(text);
    const button = React.Children.toArray(tree.props.children).find(child => React.isValidElement(child) && child.type === 'button') as React.ReactElement<{ onClick(): void }>;
    button.props.onClick();
    expect(onNavigate).toHaveBeenCalledWith(model.recovery.intent);
    expect(model.recovery.intent).toEqual({ fact: { workspace: 'collection', subview: 'import-check' },
      analysis: { workspace: 'missions', subview: 'overview' }, decision: { workspace: 'decisions', subview: 'recommendations' },
      action: { workspace: 'execution', subview: 'live' }, readback: { workspace: 'execution', subview: 'evidence' },
      effect: { workspace: 'experiments', subview: 'ledger' } }[phase]);
  });

  it('does not use manual notes or a foreign store/Mission blocker as a system result or reason', () => {
    const manual = { id: 'manual', stage: 'FACT', actorId: 'desktop-operator', title: '人工写的完成', createdAt: now, evidenceCount: 0 } as MissionCheckpointRecord;
    const row = missionFlightPlanRows('fact', 'blocked', [manual])[0];
    const foreign = { storeId: 'store-b', missionId: mission.id, stage: 'FACT', status: 'blocked', source: 'system', actorId: 'system', sequence: 99, signal: '别家店铺秘密' } as CausalEventRecord;
    const feedback = missionStageFeedback(row, mission, [foreign, { ...foreign, storeId: mission.storeId, missionId: 'another-mission' }]);
    expect(feedback.result).toContain('尚无本阶段系统结果');
    expect(feedback.reason).toContain('尚未收到更具体的阻断说明');
    expect(JSON.stringify(feedback)).not.toMatch(/人工写的完成|别家店铺秘密/);
  });
  it('redacts credentials and absolute paths from persisted feedback before ordinary rendering', () => {
    const checkpoint = { id: 'private-result', stage: 'FACT', actorId: 'system-authority',
      title: 'api_key=isolated-test-value; 本地路径 C:\\Users\\Operator\\private.db', createdAt: now, evidenceCount: 1 } as MissionCheckpointRecord;
    const row = missionFlightPlanRows('fact', 'active', [checkpoint])[0];
    const html = renderToStaticMarkup(<MissionStageFeedback row={row} mission={mission} events={[]} onNavigate={() => undefined} />);
    expect(html).not.toMatch(/isolated-test-value|C:\\Users|private\.db/);
    expect(html).toContain('已脱敏');
    expect(html).toContain('路径已隐藏');
  });
});
