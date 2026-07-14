import React, { useEffect, useId, useRef, useState } from 'react';

export const RESPONSIVE_INSPECTOR_MEDIA_QUERY = '(max-width: 1399px)';

const RESPONSIVE_INSPECTOR_FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export type ResponsiveInspectorMode = 'inline' | 'drawer';

export type ResponsiveInspectorViewport = {
  innerWidth?: number;
  matchMedia?: (query: string) => { matches: boolean };
};

export type ResponsiveInspectorFocusTarget = {
  focus: () => void;
  isConnected?: boolean;
};

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

type ResponsiveInspectorFocusScope = ResponsiveInspectorFocusTarget & {
  querySelectorAll: (selector: string) => ArrayLike<unknown>;
};

type ResponsiveInspectorInertTarget = {
  inert: boolean;
  hasAttribute: (name: string) => boolean;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
};

type ResponsiveInspectorInertParent = {
  children: ArrayLike<unknown>;
  parentElement?: ResponsiveInspectorInertParent | null;
};

type ResponsiveInspectorInertRoot = ResponsiveInspectorInertTarget & {
  parentElement?: ResponsiveInspectorInertParent | null;
};

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
  if (!activeElement || typeof (activeElement as { focus?: unknown }).focus !== 'function') {
    return null;
  }
  return activeElement as ResponsiveInspectorFocusTarget;
}

export function restoreResponsiveInspectorFocus(
  trigger: ResponsiveInspectorFocusTarget | null,
): void {
  trigger?.focus();
}

export function scheduleResponsiveInspectorFocusRestore(
  trigger: ResponsiveInspectorFocusTarget | null,
  schedule: (callback: () => void) => void,
): void {
  if (!trigger) return;
  schedule(() => {
    if (trigger.isConnected === false) return;
    restoreResponsiveInspectorFocus(trigger);
  });
}

export function resolveResponsiveInspectorFocusReturnTarget(
  trigger: ResponsiveInspectorFocusTarget | null,
  resolver?: (
    trigger: ResponsiveInspectorFocusTarget | null,
  ) => ResponsiveInspectorFocusTarget | null,
): ResponsiveInspectorFocusTarget | null {
  return resolver ? resolver(trigger) : trigger;
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
  return dismissDisabled || busy;
}

export function handleResponsiveInspectorEscape(
  event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
  onClose: () => void,
  dismissLocked = false,
): boolean {
  if (event.key !== 'Escape' || dismissLocked) return false;
  event.preventDefault();
  onClose();
  return true;
}

export function trapResponsiveInspectorTab(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>,
  surface: ResponsiveInspectorFocusScope | null,
  activeElement: unknown,
): boolean {
  if (event.key !== 'Tab' || !surface) return false;

  const focusable = Array.from(surface.querySelectorAll(RESPONSIVE_INSPECTOR_FOCUSABLE_SELECTOR))
    .map((element) => captureResponsiveInspectorTrigger(element))
    .filter((element): element is ResponsiveInspectorFocusTarget => element !== null);

  if (focusable.length === 0) {
    event.preventDefault();
    surface.focus();
    return true;
  }

  const current = captureResponsiveInspectorTrigger(activeElement);
  const currentIndex = current ? focusable.indexOf(current) : -1;
  const shouldWrapBackward = event.shiftKey && currentIndex <= 0;
  const shouldWrapForward = !event.shiftKey
    && (currentIndex < 0 || currentIndex === focusable.length - 1);

  if (!shouldWrapBackward && !shouldWrapForward) return false;

  event.preventDefault();
  focusable[shouldWrapBackward ? focusable.length - 1 : 0]?.focus();
  return true;
}

function asResponsiveInspectorInertTarget(value: unknown): ResponsiveInspectorInertTarget | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ResponsiveInspectorInertTarget>;
  if (
    typeof candidate.hasAttribute !== 'function'
    || typeof candidate.setAttribute !== 'function'
    || typeof candidate.removeAttribute !== 'function'
  ) {
    return null;
  }
  return candidate as ResponsiveInspectorInertTarget;
}

export function makeResponsiveInspectorBackgroundInert(
  root: ResponsiveInspectorInertRoot | null,
): () => void {
  if (!root?.parentElement) return () => undefined;

  const snapshots: Array<{
    element: ResponsiveInspectorInertTarget;
    inert: boolean;
    hadAttribute: boolean;
  }> = [];
  const captured = new Set<ResponsiveInspectorInertTarget>();
  let activePathNode: unknown = root;
  let parent: ResponsiveInspectorInertParent | null | undefined = root.parentElement;

  while (parent) {
    for (const sibling of Array.from(parent.children)) {
      if (sibling === activePathNode) continue;
      const element = asResponsiveInspectorInertTarget(sibling);
      if (!element || captured.has(element)) continue;
      captured.add(element);
      snapshots.push({
        element,
        inert: Boolean(element.inert),
        hadAttribute: element.hasAttribute('inert'),
      });
    }
    activePathNode = parent;
    parent = parent.parentElement;
  }

  for (const { element } of snapshots) {
    element.inert = true;
    element.setAttribute('inert', '');
  }

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const snapshot of snapshots) {
      snapshot.element.inert = snapshot.inert;
      if (snapshot.hadAttribute) snapshot.element.setAttribute('inert', '');
      else snapshot.element.removeAttribute('inert');
    }
  };
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
  const focusReturnResolverRef = useRef(resolveFocusReturnTarget);
  focusReturnResolverRef.current = resolveFocusReturnTarget;
  const dismissLocked = responsiveInspectorDismissLocked(dismissDisabled, busy);

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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (mode === 'drawer' && trapResponsiveInspectorTab(
        event,
        surfaceRef.current,
        document.activeElement,
      )) {
        return;
      }
      handleResponsiveInspectorEscape(event, onClose, dismissLocked);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dismissLocked, mode, onClose, open]);

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
