import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMissionActionAdmission, MissionActionButton } from './mission-action-feedback';

describe('Mission action immediate feedback and admission', () => {
  it('locks a second call synchronously before the first React pending render', () => {
    const gate = createMissionActionAdmission();
    gate.update('store-a|profile-a|4');
    const release = gate.tryEnter();
    expect(release).toBeTypeOf('function');
    expect(gate.tryEnter()).toBeUndefined();
    release!();
    expect(gate.tryEnter()).toBeTypeOf('function');
  });
  it('does not let a late A completion release the new A action across A to B to A', () => {
    const gate = createMissionActionAdmission();
    gate.update('A'); const releaseOld = gate.tryEnter()!;
    gate.update('B'); gate.update('A'); const releaseCurrent = gate.tryEnter()!;
    releaseOld();
    expect(gate.tryEnter()).toBeUndefined();
    releaseCurrent();
    expect(gate.tryEnter()).toBeTypeOf('function');
  });
  it('renders the concrete disabled reason as a visible described message and gives only the active operation busy feedback', () => {
    const disabled = renderToStaticMarkup(<MissionActionButton disabled disabledReason="任务已归档，请先恢复任务。">编辑</MissionActionButton>);
    expect(disabled).toContain('disabled=""');
    expect(disabled).toContain('aria-describedby=');
    expect(disabled).toContain('任务已归档，请先恢复任务。');
    expect(disabled).not.toContain('aria-busy');
    const busy = renderToStaticMarkup(<MissionActionButton disabledReason="分析正在处理，请等待结果。" busy busyLabel="分析中…">运行分析</MissionActionButton>);
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('分析中…');
    expect(busy).toContain('分析正在处理，请等待结果。');
  });
  it('omits the old disabled reason when the real action is available', () => {
    const html = renderToStaticMarkup(<MissionActionButton disabledReason="当前不可用">恢复</MissionActionButton>);
    expect(html).not.toContain('当前不可用');
    expect(html).not.toContain('aria-describedby=');
    expect(html).not.toContain('disabled=""');
  });
});
