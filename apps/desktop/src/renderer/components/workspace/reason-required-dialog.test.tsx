import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReasonRequiredDialog } from './reason-required-dialog';

/**
 * The renderer test environment does not include @testing-library, so we use
 * renderToStaticMarkup to verify markup and assert against the rendered HTML.
 * Interactive behaviour (focus, escape handling, controlled inputs) is verified
 * by reading the markup contract (disabled attributes, button labels, etc).
 */

function render(props: Partial<React.ComponentProps<typeof ReasonRequiredDialog>>) {
  return renderToStaticMarkup(
    <ReasonRequiredDialog
      title="确认操作"
      description="需要填理由"
      confirmLabel="确认"
      onConfirm={() => {}}
      onClose={() => {}}
      {...props}
    />,
  );
}

describe('ReasonRequiredDialog', () => {
  it('renders nothing when closed', () => {
    const markup = render({ open: false });
    expect(markup).toBe('');
  });

  it('renders the alert dialog scaffold when open', () => {
    const markup = render({ open: true });
    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain('mission-control-dialog-backdrop');
    expect(markup).toContain('mission-control-dialog--confirm');
  });

  it('disables the confirm button by default when reason is empty', () => {
    const markup = render({ open: true, reasonMinLength: 3 });
    expect(markup).toMatch(/<button[^>]*>\s*确认\s*<\/button>/);
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('复核原因 *');
    expect(markup).toContain('aria-required="true"');
  });

  it('locks both buttons while busy', () => {
    const markup = render({ open: true, busy: true, confirmLabel: '解除' });
    expect(markup).toContain('解除中…');
    expect(markup).toContain('disabled=""');
  });

  it('renders the eyebrow and title above the description', () => {
    const markup = render({ open: true, eyebrow: '紧急停止' });
    expect(markup).toContain('紧急停止');
    expect(markup).toContain('确认操作');
    expect(markup).toContain('需要填理由');
  });

  it('uses danger tone for destructive confirmations', () => {
    const markup = render({ open: true, tone: 'danger', confirmLabel: '解除急停' });
    expect(markup).toMatch(/class="workspace-button workspace-button--danger"/);
  });

  it('renders diagnostic details block when provided', () => {
    const markup = render({
      open: true,
      diagnosticDetails: <code>batch=ABC-123</code>,
    });
    expect(markup).toContain('诊断详情');
    expect(markup).toContain('reason-required-dialog__diagnostics');
    expect(markup).toContain('batch=ABC-123');
  });

  it('uses a stable title id bound through aria-labelledby', () => {
    const markup = render({ open: true, title: '确认解除店铺级紧急停止' });
    expect(markup).toMatch(/id="reason-dialog-title-[\u4e00-\u9fff0-9-]+"/);
    expect(markup).toContain('aria-labelledby="reason-dialog-title-');
    expect(markup).toContain('aria-describedby=');
  });

  it('renders a textarea with the configured label and placeholder', () => {
    const markup = render({
      open: true,
      reasonLabel: '解除原因 *',
      reasonPlaceholder: '请说明解除的业务依据',
    });
    expect(markup).toContain('解除原因 *');
    expect(markup).toContain('请说明解除的业务依据');
  });

  it('hides the hint when reason is empty', () => {
    const markup = render({ open: true, reasonMinLength: 3 });
    // Initial render has no reason text, so the helper hint stays hidden.
    expect(markup).not.toContain('至少输入');
  });

  it('uses warning tone for soft confirmations', () => {
    const markup = render({ open: true, tone: 'warning', confirmLabel: '停用版本' });
    expect(markup).toMatch(/class="workspace-button workspace-button--warning"/);
  });
});
