import { useEffect, useRef } from 'react';

export const OVERLAY_FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'summary',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export type OverlayFocusTarget = {
  focus: () => void;
  getClientRects?: () => ArrayLike<unknown>;
  hidden?: boolean;
  isConnected?: boolean;
  matches?: (selector: string) => boolean;
};

export type OverlayFocusSurface = OverlayFocusTarget & {
  querySelector?: (selector: string) => unknown;
  querySelectorAll?: (selector: string) => ArrayLike<unknown>;
};

export type OverlayInertTarget = {
  inert: boolean;
  hasAttribute: (name: string) => boolean;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
};

type OverlayInertParent = {
  children: ArrayLike<unknown>;
  parentElement?: OverlayInertParent | null;
};

export type OverlayInertRoot = OverlayInertTarget & {
  parentElement?: OverlayInertParent | null;
};

export type OverlayFocusPolicyInput = {
  modal: boolean;
  autoFocus?: boolean;
  dismissOnEscape?: boolean;
  inertBackground?: boolean;
  restoreFocus?: boolean;
  trapFocus?: boolean;
};

export type OverlayFocusPolicy = {
  autoFocus: boolean;
  dismissOnEscape: boolean;
  inertBackground: boolean;
  restoreFocus: boolean;
  trapFocus: boolean;
};

export type UseOverlayFocusScopeOptions = {
  open: boolean;
  onDismiss: () => void;
  dismissDisabled?: boolean;
  modal?: boolean;
  autoFocus?: boolean;
  dismissOnEscape?: boolean;
  inertBackground?: boolean;
  restoreFocus?: boolean;
  trapFocus?: boolean;
  resolveFocusReturnTarget?: (
    trigger: OverlayFocusTarget | null,
  ) => OverlayFocusTarget | null;
};

export function resolveOverlayFocusPolicy(input: OverlayFocusPolicyInput): OverlayFocusPolicy {
  return {
    autoFocus: input.autoFocus ?? input.modal,
    dismissOnEscape: input.dismissOnEscape ?? input.modal,
    inertBackground: input.inertBackground ?? input.modal,
    restoreFocus: input.restoreFocus ?? input.modal,
    trapFocus: input.trapFocus ?? input.modal,
  };
}

const overlayKeyboardLayerStack: symbol[] = [];

export function registerOverlayKeyboardLayer(layer: symbol): () => void {
  overlayKeyboardLayerStack.push(layer);
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    const index = overlayKeyboardLayerStack.lastIndexOf(layer);
    if (index >= 0) overlayKeyboardLayerStack.splice(index, 1);
  };
}

export function isTopOverlayKeyboardLayer(layer: symbol): boolean {
  return overlayKeyboardLayerStack.at(-1) === layer;
}

export function captureOverlayFocusTarget(activeElement: unknown): OverlayFocusTarget | null {
  if (!activeElement || typeof (activeElement as { focus?: unknown }).focus !== 'function') {
    return null;
  }
  return activeElement as OverlayFocusTarget;
}

export function restoreOverlayFocus(trigger: OverlayFocusTarget | null): void {
  trigger?.focus();
}

export function scheduleOverlayFocusRestore(
  trigger: OverlayFocusTarget | null,
  schedule: (callback: () => void) => void,
): void {
  if (!trigger) return;
  schedule(() => {
    if (trigger.isConnected === false) return;
    restoreOverlayFocus(trigger);
  });
}

export function resolveOverlayFocusReturnTarget(
  trigger: OverlayFocusTarget | null,
  resolver?: (trigger: OverlayFocusTarget | null) => OverlayFocusTarget | null,
): OverlayFocusTarget | null {
  return resolver ? resolver(trigger) : trigger;
}

export function focusOverlayEntry(
  autoFocus: boolean,
  surface: OverlayFocusSurface | null,
  preferredTarget?: OverlayFocusTarget | null,
): boolean {
  if (!autoFocus || !surface) return false;
  if (preferredTarget) {
    preferredTarget.focus();
    return true;
  }
  const declaredTarget = captureOverlayFocusTarget(
    surface.querySelector?.('[data-overlay-initial-focus]'),
  );
  const firstFocusable = Array.from(surface.querySelectorAll?.(OVERLAY_FOCUSABLE_SELECTOR) || [])
    .map((element) => captureOverlayFocusTarget(element))
    .find((element): element is OverlayFocusTarget => element !== null && isOverlayFocusTargetVisible(element));
  (preferredTarget ?? declaredTarget ?? firstFocusable ?? surface).focus();
  return true;
}

export function isOverlayFocusTargetVisible(target: OverlayFocusTarget): boolean {
  if (target.isConnected === false || target.hidden === true) return false;
  if (target.matches?.(':disabled, [aria-hidden="true"], [inert]')) return false;
  if (typeof target.getClientRects === 'function' && target.getClientRects().length === 0) return false;
  return true;
}

export function overlayDismissLocked(dismissDisabled = false, busy = false): boolean {
  return dismissDisabled || busy;
}

export function handleOverlayEscape(
  event: Pick<KeyboardEvent, 'key' | 'preventDefault'> & { defaultPrevented?: boolean },
  onDismiss: () => void,
  dismissLocked = false,
): boolean {
  if (event.defaultPrevented || event.key !== 'Escape' || dismissLocked) return false;
  event.preventDefault();
  onDismiss();
  return true;
}

export function trapOverlayTab(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>,
  surface: OverlayFocusSurface | null,
  activeElement: unknown,
): boolean {
  if (event.key !== 'Tab' || !surface?.querySelectorAll) return false;

  const focusable = Array.from(surface.querySelectorAll(OVERLAY_FOCUSABLE_SELECTOR))
    .map((element) => captureOverlayFocusTarget(element))
    .filter((element): element is OverlayFocusTarget => element !== null && isOverlayFocusTargetVisible(element));

  if (focusable.length === 0) {
    event.preventDefault();
    surface.focus();
    return true;
  }

  const current = captureOverlayFocusTarget(activeElement);
  const currentIndex = current ? focusable.indexOf(current) : -1;
  const shouldWrapBackward = event.shiftKey && currentIndex <= 0;
  const shouldWrapForward = !event.shiftKey
    && (currentIndex < 0 || currentIndex === focusable.length - 1);

  if (!shouldWrapBackward && !shouldWrapForward) return false;

  event.preventDefault();
  focusable[shouldWrapBackward ? focusable.length - 1 : 0]?.focus();
  return true;
}

function asOverlayInertTarget(value: unknown): OverlayInertTarget | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<OverlayInertTarget>;
  if (
    typeof candidate.hasAttribute !== 'function'
    || typeof candidate.setAttribute !== 'function'
    || typeof candidate.removeAttribute !== 'function'
  ) {
    return null;
  }
  return candidate as OverlayInertTarget;
}

export function makeOverlayBackgroundInert(root: OverlayInertRoot | null): () => void {
  if (!root?.parentElement) return () => undefined;

  const snapshots: Array<{
    element: OverlayInertTarget;
    inert: boolean;
    hadAttribute: boolean;
  }> = [];
  const captured = new Set<OverlayInertTarget>();
  let activePathNode: unknown = root;
  let parent: OverlayInertParent | null | undefined = root.parentElement;

  while (parent) {
    for (const sibling of Array.from(parent.children)) {
      if (sibling === activePathNode) continue;
      const element = asOverlayInertTarget(sibling);
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

function scheduleAfterOverlayCleanup(callback: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(callback);
    return;
  }
  queueMicrotask(callback);
}

export function useOverlayFocusScope<
  TRoot extends HTMLElement = HTMLElement,
  TSurface extends HTMLElement = HTMLElement,
>({
  open,
  onDismiss,
  dismissDisabled = false,
  modal = true,
  autoFocus,
  dismissOnEscape,
  inertBackground,
  restoreFocus,
  trapFocus,
  resolveFocusReturnTarget,
}: UseOverlayFocusScopeOptions) {
  const overlayRootRef = useRef<TRoot | null>(null);
  const surfaceRef = useRef<TSurface | null>(null);
  const triggerRef = useRef<OverlayFocusTarget | null>(null);
  const keyboardLayerRef = useRef(Symbol('overlay-keyboard-layer'));
  const onDismissRef = useRef(onDismiss);
  const focusReturnResolverRef = useRef(resolveFocusReturnTarget);
  const dismissDisabledRef = useRef(dismissDisabled);
  onDismissRef.current = onDismiss;
  focusReturnResolverRef.current = resolveFocusReturnTarget;
  dismissDisabledRef.current = dismissDisabled;
  const policy = resolveOverlayFocusPolicy({
    modal,
    autoFocus,
    dismissOnEscape,
    inertBackground,
    restoreFocus,
    trapFocus,
  });
  const keyboardEnabled = policy.trapFocus || policy.dismissOnEscape;
  const keyboardPolicyRef = useRef({
    dismissOnEscape: policy.dismissOnEscape,
    trapFocus: policy.trapFocus,
  });
  keyboardPolicyRef.current = {
    dismissOnEscape: policy.dismissOnEscape,
    trapFocus: policy.trapFocus,
  };

  useEffect(() => {
    if (!open || !policy.restoreFocus || typeof document === 'undefined') return undefined;
    triggerRef.current = captureOverlayFocusTarget(document.activeElement);
    return () => {
      const returnTarget = resolveOverlayFocusReturnTarget(
        triggerRef.current,
        focusReturnResolverRef.current,
      );
      triggerRef.current = null;
      scheduleOverlayFocusRestore(returnTarget, scheduleAfterOverlayCleanup);
    };
  }, [open, policy.restoreFocus]);

  useEffect(() => {
    if (!open) return;
    focusOverlayEntry(policy.autoFocus, surfaceRef.current as OverlayFocusSurface | null);
  }, [open, policy.autoFocus]);

  useEffect(() => {
    if (
      !open
      || typeof document === 'undefined'
      || !keyboardEnabled
    ) return undefined;
    const keyboardLayer = keyboardLayerRef.current;
    const unregisterKeyboardLayer = registerOverlayKeyboardLayer(keyboardLayer);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopOverlayKeyboardLayer(keyboardLayer)) return;
      if (keyboardPolicyRef.current.trapFocus && trapOverlayTab(
        event,
        surfaceRef.current as OverlayFocusSurface | null,
        document.activeElement,
      )) {
        return;
      }
      if (keyboardPolicyRef.current.dismissOnEscape) {
        handleOverlayEscape(event, () => onDismissRef.current(), dismissDisabledRef.current);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      unregisterKeyboardLayer();
    };
  }, [keyboardEnabled, open]);

  useEffect(() => {
    if (!open || !policy.inertBackground) return undefined;
    return makeOverlayBackgroundInert(overlayRootRef.current as OverlayInertRoot | null);
  }, [open, policy.inertBackground]);

  return {
    overlayRootRef,
    surfaceRef,
  };
}
