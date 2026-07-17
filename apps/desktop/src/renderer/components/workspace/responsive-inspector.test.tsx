import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ResponsiveInspector,
  captureResponsiveInspectorTrigger,
  focusResponsiveInspectorEntry,
  handleResponsiveInspectorEscape,
  makeResponsiveInspectorBackgroundInert,
  resolveResponsiveInspectorMode,
  resolveResponsiveInspectorFocusReturnTarget,
  responsiveInspectorDismissLocked,
  restoreResponsiveInspectorFocus,
  scheduleResponsiveInspectorFocusRestore,
  trapResponsiveInspectorTab,
} from './responsive-inspector';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveResponsiveInspectorMode', () => {
  it('uses matchMedia as the authoritative <1400 breakpoint signal', () => {
    const matchMedia = vi.fn(() => ({ matches: true }));

    expect(resolveResponsiveInspectorMode({ innerWidth: 1400, matchMedia })).toBe('drawer');
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 1399px)');
  });

  it.each([
    [1199, 'drawer'],
    [1200, 'drawer'],
    [1399, 'drawer'],
    [1400, 'inline'],
  ] as const)('maps a %dpx fallback viewport to %s mode', (innerWidth, expected) => {
    expect(resolveResponsiveInspectorMode({ innerWidth })).toBe(expected);
  });

  it('falls back safely to inline mode without viewport information', () => {
    expect(resolveResponsiveInspectorMode({})).toBe('inline');
    expect(resolveResponsiveInspectorMode(undefined)).toBe('inline');
  });
});

describe('ResponsiveInspector', () => {
  it('registers one topmost keyboard layer while open', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./responsive-inspector.tsx', import.meta.url), 'utf8');

    expect(source).toContain('registerOverlayKeyboardLayer');
    expect(source).toContain('isTopOverlayKeyboardLayer');
    expect(source).toContain('unregisterKeyboardLayer()');
    expect(source).toContain("modeRef.current === 'drawer'");
    expect(source).toContain('dismissLockedRef.current');
    expect(source).toContain('onCloseRef.current()');
  });

  it('does not expose an inspector surface while closed', () => {
    const markup = renderToStaticMarkup(createElement(ResponsiveInspector, {
      open: false,
      title: '建议详情',
      description: '查看证据并做出判断。',
      onClose: vi.fn(),
      children: createElement('p', null, '详情内容'),
    }));

    expect(markup).toBe('');
  });

  it('renders a labelled inline complementary inspector on wide desktops', () => {
    vi.stubGlobal('window', {
      innerWidth: 1400,
      matchMedia: vi.fn(() => ({ matches: false })),
    });

    const markup = renderToStaticMarkup(createElement(ResponsiveInspector, {
      open: true,
      title: '建议详情',
      description: '查看证据并做出判断。',
      onClose: vi.fn(),
      children: createElement('p', null, '详情内容'),
    }));

    const labelledBy = markup.match(/aria-labelledby="([^"]+)"/)?.[1];
    const describedBy = markup.match(/aria-describedby="([^"]+)"/)?.[1];

    expect(markup).toContain('<aside');
    expect(markup).toContain('role="complementary"');
    expect(markup).toContain('data-inspector-mode="inline"');
    expect(markup).not.toContain('aria-modal="true"');
    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();
    expect(markup).toContain(`id="${labelledBy}"`);
    expect(markup).toContain(`id="${describedBy}"`);
    expect(markup).toContain('aria-label="关闭详情检查器"');
    expect(markup).toContain('详情内容');
  });

  it('renders a labelled modal dialog drawer at 1200px', () => {
    vi.stubGlobal('window', {
      innerWidth: 1200,
      matchMedia: vi.fn(() => ({ matches: true })),
    });

    const markup = renderToStaticMarkup(createElement(ResponsiveInspector, {
      open: true,
      title: '审批详情',
      description: '批准不等于执行。',
      onClose: vi.fn(),
      children: createElement('p', null, '证据链'),
    }));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('data-inspector-mode="drawer"');
    expect(markup).not.toContain('role="complementary"');
    expect(markup).toContain('审批详情');
    expect(markup).toContain('批准不等于执行。');
    expect(markup).toContain('证据链');
  });

  it.each([
    { dismissDisabled: true, busy: false },
    { dismissDisabled: false, busy: true },
  ])('locks its close button when dismissal is disabled: %o', ({ dismissDisabled, busy }) => {
    vi.stubGlobal('window', {
      innerWidth: 1200,
      matchMedia: vi.fn(() => ({ matches: true })),
    });

    const markup = renderToStaticMarkup(createElement(ResponsiveInspector, {
      open: true,
      title: '提交中',
      dismissDisabled,
      busy,
      onClose: vi.fn(),
      children: '正在保存审批决定',
    }));

    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('data-dismiss-locked="true"');
    if (busy) expect(markup).toContain('aria-busy="true"');
  });

  it('is safe to render without window or matchMedia', () => {
    vi.stubGlobal('window', {});

    expect(() => renderToStaticMarkup(createElement(ResponsiveInspector, {
      open: true,
      title: '详情',
      onClose: vi.fn(),
      children: '内容',
    }))).not.toThrow();
  });
});

describe('ResponsiveInspector keyboard and focus helpers', () => {
  it('closes only for Escape and prevents its default action', () => {
    const onClose = vi.fn();
    const preventDefault = vi.fn();

    expect(handleResponsiveInspectorEscape({ key: 'Enter', preventDefault }, onClose)).toBe(false);
    expect(handleResponsiveInspectorEscape({ key: 'Escape', preventDefault }, onClose)).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape while dismissal is locked', () => {
    const onClose = vi.fn();
    const preventDefault = vi.fn();

    expect(handleResponsiveInspectorEscape(
      { key: 'Escape', preventDefault },
      onClose,
      true,
    )).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(responsiveInspectorDismissLocked(true, false)).toBe(true);
    expect(responsiveInspectorDismissLocked(false, true)).toBe(true);
    expect(responsiveInspectorDismissLocked(false, false)).toBe(false);
  });

  it('captures a focusable trigger and restores it after close', () => {
    const focus = vi.fn();
    const trigger = { focus };

    const captured = captureResponsiveInspectorTrigger(trigger);
    restoreResponsiveInspectorFocus(captured);

    expect(captured).toBe(trigger);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(captureResponsiveInspectorTrigger({})).toBeNull();
    expect(() => restoreResponsiveInspectorFocus(null)).not.toThrow();
  });

  it('defers trigger focus until modal background isolation cleanup has completed', () => {
    const focus = vi.fn();
    const schedule = vi.fn<[callback: () => void], void>();

    scheduleResponsiveInspectorFocusRestore({ focus }, schedule);

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(focus).not.toHaveBeenCalled();
    schedule.mock.calls[0]?.[0]();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('restores the same connected trigger after its owner reveals it during close', () => {
    let hidden = true;
    const focus = vi.fn(() => {
      if (hidden) throw new Error('trigger is still hidden');
    });
    const trigger = { focus, isConnected: true };
    const callbacks: Array<() => void> = [];

    scheduleResponsiveInspectorFocusRestore(trigger, (callback) => callbacks.push(callback));
    hidden = false;
    callbacks[0]?.();

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('lets the owning page override the removed row with one connected focus target', () => {
    const trigger = { focus: vi.fn(), isConnected: false };
    const fallback = { focus: vi.fn(), isConnected: true };
    const resolver = vi.fn(() => fallback);

    expect(resolveResponsiveInspectorFocusReturnTarget(trigger, resolver)).toBe(fallback);
    expect(resolver).toHaveBeenCalledWith(trigger);
  });

  it('does not focus a target that disconnected before deferred cleanup ran', () => {
    const focus = vi.fn();
    const trigger = { focus, isConnected: true };
    const callbacks: Array<() => void> = [];

    scheduleResponsiveInspectorFocusRestore(trigger, (callback) => callbacks.push(callback));
    trigger.isConnected = false;
    callbacks[0]?.();

    expect(focus).not.toHaveBeenCalled();
  });

  it('moves focus into a drawer but leaves an inline inspector non-modal', () => {
    const closeFocus = vi.fn();
    const surfaceFocus = vi.fn();

    focusResponsiveInspectorEntry('inline', { focus: closeFocus }, { focus: surfaceFocus });
    expect(closeFocus).not.toHaveBeenCalled();
    expect(surfaceFocus).not.toHaveBeenCalled();

    focusResponsiveInspectorEntry('drawer', { focus: closeFocus }, { focus: surfaceFocus });
    expect(closeFocus).toHaveBeenCalledTimes(1);

    focusResponsiveInspectorEntry('drawer', null, { focus: surfaceFocus });
    expect(surfaceFocus).toHaveBeenCalledTimes(1);
  });

  it('wraps Tab from the last drawer control to the first', () => {
    const first = { focus: vi.fn() };
    const last = { focus: vi.fn() };
    const preventDefault = vi.fn();
    const surface = {
      focus: vi.fn(),
      querySelectorAll: vi.fn(() => [first, last]),
    };

    expect(trapResponsiveInspectorTab(
      { key: 'Tab', shiftKey: false, preventDefault },
      surface,
      last,
    )).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(first.focus).toHaveBeenCalledTimes(1);
  });

  it('wraps Shift+Tab from the first drawer control to the last', () => {
    const first = { focus: vi.fn() };
    const last = { focus: vi.fn() };
    const preventDefault = vi.fn();
    const surface = {
      focus: vi.fn(),
      querySelectorAll: vi.fn(() => [first, last]),
    };

    expect(trapResponsiveInspectorTab(
      { key: 'Tab', shiftKey: true, preventDefault },
      surface,
      first,
    )).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(last.focus).toHaveBeenCalledTimes(1);
  });

  it('wraps Shift+Tab to a visible details summary and skips controls hidden by collapsed details', () => {
    const first = { focus: vi.fn(), getClientRects: () => [{ width: 1 }] };
    const summary = { focus: vi.fn(), getClientRects: () => [{ width: 1 }] };
    const collapsedDetailsControl = { focus: vi.fn(), getClientRects: () => [] };
    const preventDefault = vi.fn();
    const surface = {
      focus: vi.fn(),
      querySelectorAll: vi.fn(() => [first, summary, collapsedDetailsControl]),
    };

    expect(trapResponsiveInspectorTab(
      { key: 'Tab', shiftKey: true, preventDefault },
      surface,
      first,
    )).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(summary.focus).toHaveBeenCalledTimes(1);
    expect(collapsedDetailsControl.focus).not.toHaveBeenCalled();
  });

  it('keeps focus on the drawer surface when no controls are available', () => {
    const preventDefault = vi.fn();
    const surface = {
      focus: vi.fn(),
      querySelectorAll: vi.fn(() => []),
    };

    expect(trapResponsiveInspectorTab(
      { key: 'Tab', shiftKey: false, preventDefault },
      surface,
      null,
    )).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(surface.focus).toHaveBeenCalledTimes(1);
  });
});

describe('ResponsiveInspector background isolation', () => {
  function inertElement(initiallyInert = false) {
    const attributes = new Set<string>(initiallyInert ? ['inert'] : []);
    return {
      inert: initiallyInert,
      hasAttribute: (name: string) => attributes.has(name),
      setAttribute: (name: string) => attributes.add(name),
      removeAttribute: (name: string) => attributes.delete(name),
    };
  }

  it('makes same-parent background siblings inert and restores their prior state', () => {
    const background = inertElement(false);
    const alreadyInert = inertElement(true);
    const root = inertElement(false) as ReturnType<typeof inertElement> & {
      parentElement?: { children: Array<ReturnType<typeof inertElement>> };
    };
    root.parentElement = { children: [background, root, alreadyInert] };

    const restore = makeResponsiveInspectorBackgroundInert(root);

    expect(background.inert).toBe(true);
    expect(background.hasAttribute('inert')).toBe(true);
    expect(alreadyInert.inert).toBe(true);
    expect(root.inert).toBe(false);

    restore();
    expect(background.inert).toBe(false);
    expect(background.hasAttribute('inert')).toBe(false);
    expect(alreadyInert.inert).toBe(true);
    expect(alreadyInert.hasAttribute('inert')).toBe(true);
  });

  it('isolates background siblings at every mounted ancestor without inverting the drawer path', () => {
    const workbench = inertElement(false);
    const pageHeader = inertElement(false);
    const sidebar = inertElement(false);
    const root = inertElement(false) as ReturnType<typeof inertElement> & {
      parentElement?: any;
    };
    const workbenchLayout = {
      ...inertElement(false),
      children: [workbench, root],
      parentElement: undefined as any,
    };
    const page = {
      ...inertElement(false),
      children: [pageHeader, workbenchLayout],
      parentElement: undefined as any,
    };
    const app = {
      ...inertElement(false),
      children: [sidebar, page],
      parentElement: null,
    };
    root.parentElement = workbenchLayout;
    workbenchLayout.parentElement = page;
    page.parentElement = app;

    const restore = makeResponsiveInspectorBackgroundInert(root);

    expect(workbench.inert).toBe(true);
    expect(pageHeader.inert).toBe(true);
    expect(sidebar.inert).toBe(true);
    expect(root.inert).toBe(false);
    expect(workbenchLayout.inert).toBe(false);
    expect(page.inert).toBe(false);

    restore();
    expect(workbench.inert).toBe(false);
    expect(pageHeader.inert).toBe(false);
    expect(sidebar.inert).toBe(false);
  });

  it('is a safe no-op without a mounted parent', () => {
    const restore = makeResponsiveInspectorBackgroundInert(null);
    expect(() => restore()).not.toThrow();
  });
});
