import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

export type ActionMenuItem = {
  id: string;
  label: string;
  description?: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
};

export type ActionMenuProps = {
  label: string;
  items: ActionMenuItem[];
  align?: 'start' | 'end';
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type ActionMenuKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End' | 'Escape' | string;

function firstEnabledIndex(enabled: boolean[]): number {
  return enabled.findIndex(Boolean);
}

function lastEnabledIndex(enabled: boolean[]): number {
  for (let index = enabled.length - 1; index >= 0; index -= 1) {
    if (enabled[index]) return index;
  }
  return -1;
}

export function actionMenuKeyboardTarget(
  key: ActionMenuKey,
  currentIndex: number,
  enabled: boolean[],
): number | null {
  if (key === 'Escape') return null;
  const first = firstEnabledIndex(enabled);
  if (first < 0) return -1;
  if (key === 'Home') return first;
  if (key === 'End') return lastEnabledIndex(enabled);
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return currentIndex;

  const direction = key === 'ArrowDown' ? 1 : -1;
  let candidate = currentIndex;
  for (let checked = 0; checked < enabled.length; checked += 1) {
    candidate = (candidate + direction + enabled.length) % enabled.length;
    if (enabled[candidate]) return candidate;
  }
  return first;
}

export function restoreActionMenuFocus(trigger: Pick<HTMLButtonElement, 'focus'> | null): void {
  trigger?.focus();
}

export function ActionMenu({
  label,
  items,
  align = 'end',
  disabled = false,
  onOpenChange,
}: ActionMenuProps) {
  const id = useId().replace(/:/g, '');
  const triggerId = `action-menu-${id}-trigger`;
  const menuId = `action-menu-${id}-menu`;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const enabled = items.map((item) => !item.disabled);

  const setOpenState = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [onOpenChange]);

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setOpenState(false);
    setActiveIndex(-1);
    if (restoreFocus) restoreActionMenuFocus(triggerRef.current);
  }, [setOpenState]);

  const openMenu = useCallback((placement: 'first' | 'last' = 'first') => {
    const nextIndex = placement === 'last' ? lastEnabledIndex(enabled) : firstEnabledIndex(enabled);
    setActiveIndex(nextIndex);
    setOpenState(true);
  }, [enabled, setOpenState]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) closeMenu(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [closeMenu, open]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Tab') {
      closeMenu(false);
      return;
    }
    const target = actionMenuKeyboardTarget(event.key, index, enabled);
    if (target === null) {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (target !== index) {
      event.preventDefault();
      setActiveIndex(target);
    }
  };

  return (
    <div
      className="action-menu"
      data-menu-align={align}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) closeMenu(false);
      }}
      ref={containerRef}
    >
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        className="action-menu__trigger"
        disabled={disabled || items.length === 0}
        id={triggerId}
        onClick={() => (open ? closeMenu(false) : openMenu('first'))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openMenu('first');
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu('last');
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            closeMenu(true);
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <span>{label}</span>
        <span aria-hidden="true" className="action-menu__chevron">⋯</span>
      </button>
      {open && (
        <div
          aria-label={label}
          aria-labelledby={triggerId}
          className="action-menu__popover"
          id={menuId}
          role="menu"
        >
          {items.map((item, index) => (
            <button
              aria-disabled={item.disabled || undefined}
              className={`action-menu__item action-menu__item--${item.tone ?? 'default'}`}
              disabled={item.disabled}
              key={item.id}
              onClick={() => {
                if (item.disabled) return;
                closeMenu(true);
                item.onSelect();
              }}
              onKeyDown={(event) => handleMenuKeyDown(event, index)}
              onMouseEnter={() => {
                if (!item.disabled) setActiveIndex(index);
              }}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              role="menuitem"
              tabIndex={activeIndex === index ? 0 : -1}
              type="button"
            >
              <span>{item.label}</span>
              {item.description && <small>{item.description}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
