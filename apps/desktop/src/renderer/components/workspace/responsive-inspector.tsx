import React, { useEffect, useId, useRef, useState } from 'react';
import {
  captureOverlayFocusTarget,
  handleOverlayEscape,
  isTopOverlayKeyboardLayer,
  makeOverlayBackgroundInert,
  overlayDismissLocked,
  registerOverlayKeyboardLayer,
  resolveOverlayFocusReturnTarget,
  restoreOverlayFocus,
  scheduleOverlayFocusRestore,
  trapOverlayTab,
  type OverlayFocusSurface,
  type OverlayFocusTarget,
  type OverlayInertRoot,
} from './overlay-focus-scope';

export const RESPONSIVE_INSPECTOR_MEDIA_QUERY = '(max-width: 1399px)';

export type ResponsiveInspectorMode = 'inline' | 'drawer';

export type ResponsiveInspectorViewport = {
  innerWidth?: number;
  matchMedia?: (query: string) => { matches: boolean };
};

export type ResponsiveInspectorFocusTarget = OverlayFocusTarget;

export type ResponsiveInspectorProps = {
  open: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  dismissDisabled?: boolean;
  busy?: boolean;
  onClose: () => void;
  resolveFocusReturnTarget?: (
    trigger: ResponsiveInspectorFocusTarget | null,
  ) => ResponsiveInspectorFocusTarget | null;
  children: React.ReactNode;
};

type ResponsiveInspectorFocusScope = OverlayFocusSurface;
type ResponsiveInspectorInertRoot = OverlayInertRoot;

export function resolveResponsiveInspectorMode(
  viewport: ResponsiveInspectorViewport | undefined,
): ResponsiveInspectorMode {
  if (!viewport) return 'inline';

  if (typeof viewport.matchMedia === 'function') {
    try {
      return viewport.matchMedia(RESPONSIVE_INSPECTOR_MEDIA_QUERY).matches ? 'drawer' : 'inline';
    } catch {
      // Fall through to the width check for incomplete browser shims.
    }
  }

  if (typeof viewport.innerWidth === 'number') {
    return viewport.innerWidth < 1400 ? 'drawer' : 'inline';
  }

  return 'inline';
}

export function captureResponsiveInspectorTrigger(
  activeElement: unknown,
): ResponsiveInspectorFocusTarget | null {
  return captureOverlayFocusTarget(activeElement);
}

export function restoreResponsiveInspectorFocus(
  trigger: ResponsiveInspectorFocusTarget | null,
): void {
  restoreOverlayFocus(trigger);
}

export function scheduleResponsiveInspectorFocusRestore(
  trigger: ResponsiveInspectorFocusTarget | null,
  schedule: (callback: () => void) => void,
): void {
  scheduleOverlayFocusRestore(trigger, schedule);
}

export function resolveResponsiveInspectorFocusReturnTarget(
  trigger: ResponsiveInspectorFocusTarget | null,
  resolver?: (
    trigger: ResponsiveInspectorFocusTarget | null,
  ) => ResponsiveInspectorFocusTarget | null,
): ResponsiveInspectorFocusTarget | null {
  return resolveOverlayFocusReturnTarget(trigger, resolver);
}

export function focusResponsiveInspectorEntry(
  mode: ResponsiveInspectorMode,
  closeButton: ResponsiveInspectorFocusTarget | null,
  surface: ResponsiveInspectorFocusTarget | null,
): void {
  if (mode !== 'drawer') return;
  (closeButton ?? surface)?.focus();
}

export function responsiveInspectorDismissLocked(
  dismissDisabled = false,
  busy = false,
): boolean {
  return overlayDismissLocked(dismissDisabled, busy);
}

export function handleResponsiveInspectorEscape(
  event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
  onClose: () => void,
  dismissLocked = false,
): boolean {
  return handleOverlayEscape(event, onClose, dismissLocked);
}

export function trapResponsiveInspectorTab(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>,
  surface: ResponsiveInspectorFocusScope | null,
  activeElement: unknown,
): boolean {
  return trapOverlayTab(event, surface, activeElement);
}

export function makeResponsiveInspectorBackgroundInert(
  root: ResponsiveInspectorInertRoot | null,
): () => void {
  return makeOverlayBackgroundInert(root);
}

function currentViewport(): ResponsiveInspectorViewport | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

function useResponsiveInspectorMode(): ResponsiveInspectorMode {
  const [mode, setMode] = useState<ResponsiveInspectorMode>(() => (
    resolveResponsiveInspectorMode(currentViewport())
  ));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const updateMode = () => setMode(resolveResponsiveInspectorMode(window));
    if (typeof window.matchMedia === 'function') {
      let mediaQuery: MediaQueryList;
      try {
        mediaQuery = window.matchMedia(RESPONSIVE_INSPECTOR_MEDIA_QUERY);
      } catch {
        window.addEventListener('resize', updateMode);
        return () => window.removeEventListener('resize', updateMode);
      }

      const handleChange = () => updateMode();
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
      }

      mediaQuery.addListener?.(handleChange);
      return () => mediaQuery.removeListener?.(handleChange);
    }

    window.addEventListener('resize', updateMode);
    return () => window.removeEventListener('resize', updateMode);
  }, []);

  return mode;
}

export function ResponsiveInspector({
  open,
  title,
  description,
  dismissDisabled = false,
  busy = false,
  onClose,
  resolveFocusReturnTarget,
  children,
}: ResponsiveInspectorProps) {
  const id = useId().replace(/:/g, '');
  const titleId = `responsive-inspector-${id}-title`;
  const descriptionId = description ? `responsive-inspector-${id}-description` : undefined;
  const mode = useResponsiveInspectorMode();
  const surfaceRef = useRef<HTMLElement | null>(null);
  const drawerRootRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<ResponsiveInspectorFocusTarget | null>(null);
  const keyboardLayerRef = useRef(Symbol('responsive-inspector-keyboard-layer'));
  const focusReturnResolverRef = useRef(resolveFocusReturnTarget);
  const dismissLockedRef = useRef(false);
  const modeRef = useRef(mode);
  const onCloseRef = useRef(onClose);
  focusReturnResolverRef.current = resolveFocusReturnTarget;
  const dismissLocked = responsiveInspectorDismissLocked(dismissDisabled, busy);
  dismissLockedRef.current = dismissLocked;
  modeRef.current = mode;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    triggerRef.current = captureResponsiveInspectorTrigger(document.activeElement);

    return () => {
      const trigger = triggerRef.current;
      triggerRef.current = null;
      const returnTarget = resolveResponsiveInspectorFocusReturnTarget(
        trigger,
        focusReturnResolverRef.current,
      );
      scheduleResponsiveInspectorFocusRestore(returnTarget, (callback) => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(callback);
          return;
        }
        queueMicrotask(callback);
      });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    focusResponsiveInspectorEntry(
      mode,
      dismissLocked ? null : closeButtonRef.current,
      surfaceRef.current,
    );
  }, [dismissLocked, mode, open]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const keyboardLayer = keyboardLayerRef.current;
    const unregisterKeyboardLayer = registerOverlayKeyboardLayer(keyboardLayer);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopOverlayKeyboardLayer(keyboardLayer)) return;
      if (modeRef.current === 'drawer' && trapResponsiveInspectorTab(
        event,
        surfaceRef.current,
        document.activeElement,
      )) {
        return;
      }
      handleResponsiveInspectorEscape(event, () => onCloseRef.current(), dismissLockedRef.current);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      unregisterKeyboardLayer();
    };
  }, [open]);

  useEffect(() => {
    if (!open || mode !== 'drawer') return undefined;
    return makeResponsiveInspectorBackgroundInert(drawerRootRef.current);
  }, [mode, open]);

  if (!open) return null;

  const content = (
    <>
      <header className="responsive-inspector__header">
        <div className="responsive-inspector__heading">
          <h2 id={titleId}>{title}</h2>
          {description && (
            <p className="responsive-inspector__description" id={descriptionId}>{description}</p>
          )}
        </div>
        <button
          aria-disabled={dismissLocked || undefined}
          aria-label="关闭详情检查器"
          className="responsive-inspector__close"
          disabled={dismissLocked}
          onClick={dismissLocked ? undefined : onClose}
          ref={closeButtonRef}
          type="button"
        >
          关闭
        </button>
      </header>
      <div className="responsive-inspector__body">{children}</div>
    </>
  );

  if (mode === 'drawer') {
    return (
      <div
        className="responsive-inspector__backdrop"
        data-inspector-mode="drawer"
        ref={drawerRootRef}
      >
        <section
          aria-busy={busy || undefined}
          aria-describedby={descriptionId}
          aria-labelledby={titleId}
          aria-modal="true"
          className="responsive-inspector responsive-inspector--drawer"
          data-dismiss-locked={dismissLocked ? 'true' : undefined}
          data-inspector-mode="drawer"
          ref={surfaceRef}
          role="dialog"
          tabIndex={-1}
        >
          {content}
        </section>
      </div>
    );
  }

  return (
    <aside
      aria-busy={busy || undefined}
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="responsive-inspector responsive-inspector--inline"
      data-dismiss-locked={dismissLocked ? 'true' : undefined}
      data-inspector-mode="inline"
      ref={surfaceRef}
      role="complementary"
      tabIndex={-1}
    >
      {content}
    </aside>
  );
}
