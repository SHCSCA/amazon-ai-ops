import { describe, expect, it, vi } from 'vitest';
import {
  captureOverlayFocusTarget,
  focusOverlayEntry,
  handleOverlayEscape,
  isTopOverlayKeyboardLayer,
  makeOverlayBackgroundInert,
  OVERLAY_FOCUSABLE_SELECTOR,
  registerOverlayKeyboardLayer,
  resolveOverlayFocusPolicy,
  restoreOverlayFocus,
  scheduleOverlayFocusRestore,
  trapOverlayTab,
} from './overlay-focus-scope';

describe('overlay focus policy', () => {
  it('keeps keyboard layer registration stable while busy state changes', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./overlay-focus-scope.ts', import.meta.url), 'utf8');

    expect(source).toContain('dismissDisabledRef.current = dismissDisabled');
    expect(source).toContain('keyboardPolicyRef.current.trapFocus');
    expect(source).toContain('}, [keyboardEnabled, open]);');
  });

  it('makes modal overlays focus-contained and background-isolated by default', () => {
    expect(resolveOverlayFocusPolicy({ modal: true })).toEqual({
      autoFocus: true,
      dismissOnEscape: true,
      inertBackground: true,
      restoreFocus: true,
      trapFocus: true,
    });
  });

  it('keeps non-modal drawers from stealing or trapping focus', () => {
    expect(resolveOverlayFocusPolicy({ modal: false })).toEqual({
      autoFocus: false,
      dismissOnEscape: false,
      inertBackground: false,
      restoreFocus: false,
      trapFocus: false,
    });
  });
});

describe('overlay keyboard behavior', () => {
  it('moves initial focus into a modal surface', () => {
    const initial = { focus: vi.fn() };
    const surface = {
      focus: vi.fn(),
      querySelector: vi.fn(() => initial),
      querySelectorAll: vi.fn(() => [initial]),
    };

    expect(focusOverlayEntry(true, surface)).toBe(true);
    expect(initial.focus).toHaveBeenCalledTimes(1);
    expect(surface.focus).not.toHaveBeenCalled();
  });

  it('does not move focus for a non-modal drawer', () => {
    const initial = { focus: vi.fn() };
    const surface = {
      focus: vi.fn(),
      querySelector: vi.fn(() => initial),
      querySelectorAll: vi.fn(() => [initial]),
    };

    expect(focusOverlayEntry(false, surface)).toBe(false);
    expect(initial.focus).not.toHaveBeenCalled();
    expect(surface.focus).not.toHaveBeenCalled();
  });

  it('wraps Tab and Shift+Tab inside a modal surface', () => {
    const first = { focus: vi.fn() };
    const last = { focus: vi.fn() };
    const surface = {
      focus: vi.fn(),
      querySelector: vi.fn(() => first),
      querySelectorAll: vi.fn(() => [first, last]),
    };
    const forwardPreventDefault = vi.fn();
    const backwardPreventDefault = vi.fn();

    expect(trapOverlayTab(
      { key: 'Tab', shiftKey: false, preventDefault: forwardPreventDefault },
      surface,
      last,
    )).toBe(true);
    expect(first.focus).toHaveBeenCalledTimes(1);

    expect(trapOverlayTab(
      { key: 'Tab', shiftKey: true, preventDefault: backwardPreventDefault },
      surface,
      first,
    )).toBe(true);
    expect(last.focus).toHaveBeenCalledTimes(1);
  });

  it('keeps native details summaries in the browser tab order', () => {
    expect(OVERLAY_FOCUSABLE_SELECTOR).toContain('summary');
    const first = { focus: vi.fn() };
    const summary = { focus: vi.fn() };
    const last = { focus: vi.fn() };
    const surface = {
      focus: vi.fn(),
      querySelectorAll: vi.fn(() => [first, summary, last]),
    };
    const preventDefault = vi.fn();

    expect(trapOverlayTab(
      { key: 'Tab', shiftKey: false, preventDefault },
      surface,
      summary,
    )).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('ignores hidden controls when deciding where focus wraps', () => {
    const first = { focus: vi.fn(), getClientRects: () => [{ width: 1 }] };
    const lastVisible = { focus: vi.fn(), getClientRects: () => [{ width: 1 }] };
    const hidden = { focus: vi.fn(), getClientRects: () => [] };
    const surface = {
      focus: vi.fn(),
      querySelectorAll: vi.fn(() => [first, lastVisible, hidden]),
    };
    const preventDefault = vi.fn();

    expect(trapOverlayTab(
      { key: 'Tab', shiftKey: false, preventDefault },
      surface,
      lastVisible,
    )).toBe(true);
    expect(first.focus).toHaveBeenCalledTimes(1);
    expect(hidden.focus).not.toHaveBeenCalled();
  });

  it('closes on Escape unless dismissal is disabled', () => {
    const onDismiss = vi.fn();
    const preventDefault = vi.fn();

    expect(handleOverlayEscape({ key: 'Escape', preventDefault }, onDismiss, false)).toBe(true);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);

    expect(handleOverlayEscape({ key: 'Escape', preventDefault }, onDismiss, true)).toBe(false);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('lets only the top keyboard layer own Escape', () => {
    const lower = Symbol('lower');
    const upper = Symbol('upper');
    const unregisterLower = registerOverlayKeyboardLayer(lower);
    const unregisterUpper = registerOverlayKeyboardLayer(upper);

    expect(isTopOverlayKeyboardLayer(lower)).toBe(false);
    expect(isTopOverlayKeyboardLayer(upper)).toBe(true);
    unregisterUpper();
    expect(isTopOverlayKeyboardLayer(lower)).toBe(true);
    unregisterLower();
    expect(isTopOverlayKeyboardLayer(lower)).toBe(false);
  });

  it('does not dismiss a second overlay after Escape was already handled', () => {
    const onDismiss = vi.fn();
    const preventDefault = vi.fn();

    expect(handleOverlayEscape({
      defaultPrevented: true,
      key: 'Escape',
      preventDefault,
    }, onDismiss, false)).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe('overlay focus restoration and modal isolation', () => {
  function inertElement(initiallyInert = false) {
    const attributes = new Set<string>(initiallyInert ? ['inert'] : []);
    return {
      inert: initiallyInert,
      hasAttribute: (name: string) => attributes.has(name),
      setAttribute: (name: string) => attributes.add(name),
      removeAttribute: (name: string) => attributes.delete(name),
    };
  }

  it('captures and restores the opener after the overlay closes', () => {
    const focus = vi.fn();
    const opener = { focus, isConnected: true };
    const captured = captureOverlayFocusTarget(opener);
    const callbacks: Array<() => void> = [];

    scheduleOverlayFocusRestore(captured, (callback) => callbacks.push(callback));
    expect(focus).not.toHaveBeenCalled();
    callbacks[0]?.();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(() => restoreOverlayFocus(null)).not.toThrow();
  });

  it('makes modal background siblings inert and restores prior state', () => {
    const background = inertElement(false);
    const alreadyInert = inertElement(true);
    const root = inertElement(false) as ReturnType<typeof inertElement> & {
      parentElement?: { children: Array<ReturnType<typeof inertElement>> };
    };
    root.parentElement = { children: [background, root, alreadyInert] };

    const restore = makeOverlayBackgroundInert(root);
    expect(background.inert).toBe(true);
    expect(alreadyInert.inert).toBe(true);

    restore();
    expect(background.inert).toBe(false);
    expect(alreadyInert.inert).toBe(true);
  });
});
