import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReadbackGateIndicator } from './execution-workspace-gate-indicator';

function render(props: React.ComponentProps<typeof ReadbackGateIndicator>) {
  return renderToStaticMarkup(<ReadbackGateIndicator {...props} />);
}

describe('ReadbackGateIndicator', () => {
  it('renders a green pass strip when there are no blockers', () => {
    const markup = render({ blockers: [] });
    expect(markup).toContain('全部回读安全门已通过');
    expect(markup).toContain('data-gate-open="true"');
    expect(markup).not.toContain('data-gate-blocked');
  });

  it('renders a red blocked strip when there is one blocker', () => {
    const markup = render({ blockers: ['缺少执行授权绑定'] });
    expect(markup).toContain('执行回读仍被阻断');
    expect(markup).toContain('缺少执行授权绑定');
    expect(markup).toContain('data-gate-blocked="true"');
    expect(markup).not.toContain('data-gate-open');
  });

  it('lists every blocker in order when there are multiple blockers', () => {
    const blockers = [
      '缺少执行授权绑定',
      '广告对象身份尚未全部核验',
      '缺少变更前证据',
    ];
    const markup = render({ blockers });
    expect(markup).toContain('aria-label="阻断清单"');
    for (const blocker of blockers) {
      expect(markup).toContain(blocker);
    }
    // Order must be preserved — first blocker appears before the second.
    const first = markup.indexOf('缺少执行授权绑定');
    const second = markup.indexOf('广告对象身份尚未全部核验');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it('renders a compact single-line strip when compact=true', () => {
    const markup = render({ blockers: ['缺少执行授权绑定'], compact: true });
    expect(markup).toContain('缺少执行授权绑定');
    expect(markup).toContain('data-gate-blocked="true"');
    // Compact mode hides the "still blocked" header and the full list.
    expect(markup).not.toContain('执行回读仍被阻断');
    expect(markup).not.toContain('aria-label="阻断清单"');
  });

  it('renders a compact green pass strip when compact=true and 0 blockers', () => {
    const markup = render({ blockers: [], compact: true });
    expect(markup).toContain('全部回读安全门已通过');
    expect(markup).toContain('data-gate-open="true"');
    expect(markup).not.toContain('执行回读仍被阻断');
  });

  it('appends a counter when compact and more than one blocker exists', () => {
    const markup = render({
      blockers: ['缺少执行授权绑定', '缺少变更前证据'],
      compact: true,
    });
    expect(markup).toContain('缺少执行授权绑定');
    expect(markup).toContain('(+1 项)');
  });

  it('exposes role=status and aria-live=polite for assistive tech', () => {
    const markup = render({ blockers: [] });
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain('aria-label="回读安全门状态"');
  });
});
