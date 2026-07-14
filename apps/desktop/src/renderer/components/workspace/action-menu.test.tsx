import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionMenu,
  actionMenuKeyboardTarget,
  restoreActionMenuFocus,
} from './action-menu';

describe('ActionMenu', () => {
  it('renders a visible menu trigger with the closed accessibility contract', () => {
    const markup = renderToStaticMarkup(createElement(ActionMenu, {
      label: '更多动作',
      items: [{ id: 'evidence', label: '查看证据', onSelect: vi.fn() }],
    }));

    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('更多动作');
    expect(markup).not.toContain('role="menu"');
  });

  it('moves across enabled items and supports Home and End', () => {
    const enabled = [true, false, true, true];

    expect(actionMenuKeyboardTarget('ArrowDown', 0, enabled)).toBe(2);
    expect(actionMenuKeyboardTarget('ArrowDown', 3, enabled)).toBe(0);
    expect(actionMenuKeyboardTarget('ArrowUp', 0, enabled)).toBe(3);
    expect(actionMenuKeyboardTarget('Home', 3, enabled)).toBe(0);
    expect(actionMenuKeyboardTarget('End', 0, enabled)).toBe(3);
    expect(actionMenuKeyboardTarget('Escape', 2, enabled)).toBeNull();
  });

  it('does not invent a focus target when every item is disabled', () => {
    expect(actionMenuKeyboardTarget('ArrowDown', -1, [false, false])).toBe(-1);
    expect(actionMenuKeyboardTarget('Home', -1, [])).toBe(-1);
  });

  it('restores focus to the trigger when the menu closes', () => {
    const focus = vi.fn();
    restoreActionMenuFocus({ focus } as unknown as HTMLButtonElement);
    restoreActionMenuFocus(null);
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
