import { useEffect, useState, type RefObject } from 'react';

/** Attribute that marks the dashboard's scroll containers (Virtuoso scrollers, folder lists). */
export const DASHBOARD_SCROLLER_ATTRIBUTE = 'data-dashboard-scroller';

/** CSS custom property with the current scroll offset (px, clamped). */
export const SCROLL_OFFSET_PROPERTY = '--dash-scroll-y';

/** CSS custom property with the scroll progress through the fade zone (0..1). */
export const SCROLL_PROGRESS_PROPERTY = '--dash-scroll-progress';

/** Options for {@link useHideOnScroll}. */
export interface HideOnScrollOptions {
  /** Listen at all (false on desktop, where nothing hides). */
  enabled: boolean;
  /** Changing this value resets to the scroll-top state (tab or folder change). */
  resetKey: string;
  /** Below this offset (px) the chrome is always shown. */
  topZonePx: number;
  /** Offset (px) over which {@link SCROLL_PROGRESS_PROPERTY} goes from 0 to 1. */
  fadeDistancePx: number;
  /** Upper clamp of {@link SCROLL_OFFSET_PROPERTY} (px). */
  maxOffsetPx: number;
  /** Distance (px) the scroll must travel against the current direction before toggling. */
  hysteresisPx?: number;
}

/**
 * Hide-on-scroll-down / show-on-scroll-up state for the phone dashboard chrome.
 *
 * The dashboard scrolls inner panes (Virtuoso scrollers), not the window, and
 * those panes are re-created on tab and folder changes. Scroll events do not
 * bubble, so one passive capture-phase listener on `rootRef` sees the scroll
 * of any descendant marked with {@link DASHBOARD_SCROLLER_ATTRIBUTE}. Work is
 * throttled to one update per animation frame.
 *
 * Besides the returned boolean (React state, changes rarely), the hook writes
 * the clamped scroll offset and fade progress as CSS custom properties on
 * `chromeRef`, so scroll-linked transforms update without React re-renders.
 *
 * @param rootRef - Element containing the scroll containers.
 * @param chromeRef - Element receiving the CSS custom properties.
 * @param options - Behaviour options.
 * @returns True while the hideable chrome should be hidden.
 */
export function useHideOnScroll(
  rootRef: RefObject<HTMLElement | null>,
  chromeRef: RefObject<HTMLElement | null>,
  options: HideOnScrollOptions,
): boolean {
  const { enabled, resetKey, topZonePx, fadeDistancePx, maxOffsetPx, hysteresisPx = 8 } = options;
  const [hidden, setHidden] = useState(false);
  // A new tab or folder starts at the top with the chrome shown: reset during
  // render when the key changes (no extra effect pass).
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setHidden(false);
  }

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;

    let frameId: number | null = null;
    let pendingScroller: HTMLElement | null = null;
    let lastScroller: HTMLElement | null = null;
    // Extreme offset since the last direction change (max while shown, min while hidden).
    let anchorOffset = 0;
    let isHidden = false;

    const writeOffset = (offset: number): void => {
      const chrome = chromeRef.current;
      if (!chrome) return;
      chrome.style.setProperty(SCROLL_OFFSET_PROPERTY, `${Math.min(offset, maxOffsetPx)}px`);
      chrome.style.setProperty(SCROLL_PROGRESS_PROPERTY, String(Math.min(offset / fadeDistancePx, 1)));
    };

    const applyHidden = (next: boolean): void => {
      if (next === isHidden) return;
      isHidden = next;
      setHidden(next);
    };

    writeOffset(0);

    const update = (): void => {
      frameId = null;
      const scroller = pendingScroller;
      if (!scroller) return;
      const offset = Math.max(0, scroller.scrollTop);
      writeOffset(offset);
      if (scroller !== lastScroller) {
        lastScroller = scroller;
        anchorOffset = offset;
      }
      if (offset <= topZonePx) {
        anchorOffset = offset;
        applyHidden(false);
      } else if (!isHidden) {
        if (offset < anchorOffset) anchorOffset = offset;
        else if (offset - anchorOffset > hysteresisPx) {
          anchorOffset = offset;
          applyHidden(true);
        }
      } else if (offset > anchorOffset) {
        anchorOffset = offset;
      } else if (anchorOffset - offset > hysteresisPx) {
        anchorOffset = offset;
        applyHidden(false);
      }
    };

    const onScroll = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.hasAttribute(DASHBOARD_SCROLLER_ATTRIBUTE)) return;
      pendingScroller = target;
      if (frameId === null) frameId = requestAnimationFrame(update);
    };

    root.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll, { capture: true });
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [rootRef, chromeRef, enabled, resetKey, topZonePx, fadeDistancePx, maxOffsetPx, hysteresisPx]);

  return enabled && hidden;
}
