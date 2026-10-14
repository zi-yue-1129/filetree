/**
 * Touch target audit: measures every visible interactive element of a page
 * (size, effective hit area, hit-testability at its centre, visibility and
 * spacing to its nearest neighbouring target).
 *
 * The effective hit area is measured by hit testing (`elementFromPoint`)
 * outwards from the element centre along both axes, so invisible expanded hit
 * areas (`::before` with negative insets) count, and overlapping elements that
 * steal taps shrink it.
 */
import type { Page } from 'playwright';

/** Minimum touch target edge in CSS px (WCAG 2.5.5 AAA, Apple HIG). */
export const MIN_TARGET_PX = 44;

/** Minimum gap to the nearest neighbouring target in CSS px. */
export const MIN_SPACING_PX = 8;

/** One measured interactive element. */
export interface TapTarget {
  /** Human readable description (tag, label, icon, context). */
  label: string;
  /** Short CSS-like path for locating the element. */
  path: string;
  /** Visual bounding box in CSS px (viewport coordinates when measured). */
  box: { x: number; y: number; width: number; height: number };
  /** Hit-testable width through the centre in CSS px (capped at {@link SCAN_LIMIT_PX} * 2 + 1). */
  hitWidth: number;
  /** Hit-testable height through the centre in CSS px (capped likewise). */
  hitHeight: number;
  /** Whether a tap at the centre reaches the element (or a descendant). */
  centreHit: boolean;
  /** What a tap at the centre reaches instead, when it does not reach the element. */
  coveredBy: string | null;
  /** Product of the opacities of the element and its ancestors. */
  effectiveOpacity: number;
  /** Whether the element is revealed by a `group-hover` class (no hover on touch). */
  hoverRevealed: boolean;
  /** Gap to the nearest other visible target in CSS px (null when alone). */
  nearestGap: number | null;
  /** Description of that nearest target. */
  nearestLabel: string | null;
  /** Inline text link inside running text (WCAG 2.5.5 "inline" exception). */
  inlineTextLink: boolean;
}

/** Scan limit per direction for the hit-area measurement, in CSS px. */
export const SCAN_LIMIT_PX = 32;

/** Interactive element selector shared by the audit and the regression check. */
const TARGET_SELECTOR = [
  'button',
  'a[href]',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="switch"]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
].join(', ');

/**
 * In-page measurement (serialised into the page by Playwright).
 *
 * @param args - Selector of the interactive elements, optional scope
 *   selector, the scan limit and the minimum target edge (all CSS px).
 * @returns Measured targets.
 */
function measureInPage(args: { selector: string; scope: string | null; scanLimit: number; minTarget: number }): TapTarget[] {
  const scopeRoot: ParentNode | null = args.scope ? document.querySelector(args.scope) : document;
  if (!scopeRoot) throw new Error(`tap audit scope ${args.scope} not found`);
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const describe = (element: Element): string => {
    const tag = element.tagName.toLowerCase();
    const aria = element.getAttribute('aria-label');
    const title = element.getAttribute('title');
    const placeholder = element.getAttribute('placeholder');
    const type = element instanceof HTMLInputElement ? `[type=${element.type}]` : '';
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
    const icon = element.querySelector('svg[class*="lucide-"]');
    const iconName = icon ? Array.from(icon.classList).find((name) => name.startsWith('lucide-') && name !== 'lucide') : undefined;
    const card = element.closest('[data-id]');
    const context = card && card !== element ? ` in ${card.getAttribute('data-id')?.split(':')[0]}-card` : '';
    const name = aria ?? title ?? placeholder ?? (text || iconName || '?');
    return `${tag}${type} "${name}"${iconName && name !== iconName ? ` (${iconName})` : ''}${context}`;
  };

  const shortPath = (element: Element): string => {
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current !== document.body && parts.length < 4) {
      const classes = Array.from(current.classList).filter((name) => /^[a-z][\w-]*$/.test(name)).slice(0, 2);
      parts.unshift(`${current.tagName.toLowerCase()}${classes.length ? `.${classes.join('.')}` : ''}`);
      current = current.parentElement;
    }
    return parts.join(' > ');
  };

  const isVisible = (element: Element): boolean => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    // Not tappable at all (e.g. a hidden hover overlay): not a touch target.
    if (style.pointerEvents === 'none') return false;
    if (element instanceof HTMLInputElement && element.type === 'file') return false;
    // Entirely outside the viewport horizontally: a closed off-canvas drawer.
    if (rect.right <= 0 || rect.left >= viewportWidth) return false;
    return true;
  };

  const effectiveOpacity = (element: Element): number => {
    let opacity = 1;
    for (let current: Element | null = element; current; current = current.parentElement) {
      opacity *= Number(getComputedStyle(current).opacity);
    }
    return opacity;
  };

  const hoverRevealed = (element: Element): boolean => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      const className = current.getAttribute('class') ?? '';
      if (/group-hover[^ ]*:opacity-100/.test(className) && Number(getComputedStyle(current).opacity) < 1) return true;
    }
    return false;
  };

  const hits = (element: Element, x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= viewportWidth || y >= viewportHeight) return false;
    const hit = document.elementFromPoint(x, y);
    if (hit === null) return false;
    if (hit === element || element.contains(hit)) return true;
    // A tap on the label of a form control activates the control.
    const labels = element instanceof HTMLInputElement ? Array.from(element.labels ?? []) : [];
    return labels.some((label) => label === hit || label.contains(hit));
  };

  const scanExtent = (element: Element, x: number, y: number, dx: number, dy: number): number => {
    let distance = 0;
    while (distance < args.scanLimit && hits(element, x + dx * (distance + 1), y + dy * (distance + 1))) distance += 1;
    return distance;
  };

  // Scroll the element's user-scrollable ancestors (outer to inner) so its
  // centre is visible, as a user would. Unlike scrollIntoView this never
  // scrolls `overflow: hidden` containers, which would distort the layout.
  const bringIntoView = (element: Element): void => {
    const scrollers: Element[] = [];
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const overflowY = getComputedStyle(ancestor).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && ancestor.scrollHeight > ancestor.clientHeight) scrollers.unshift(ancestor);
    }
    for (const ancestor of scrollers) {
      const rect = element.getBoundingClientRect();
      const ancestorRect = ancestor.getBoundingClientRect();
      const centreY = rect.top + rect.height / 2;
      const visibleTop = Math.max(ancestorRect.top, 0);
      const visibleBottom = Math.min(ancestorRect.bottom, viewportHeight);
      // Centre it unless it already sits in the middle half: near an edge the
      // scan would be cut by the edge or by fixed overlays there (e.g. the
      // phone batch action bar), which a user would scroll away from.
      const margin = Math.max(args.minTarget / 2, (visibleBottom - visibleTop) / 4);
      if (centreY < visibleTop + margin || centreY > visibleBottom - margin) {
        ancestor.scrollTop += centreY - (visibleTop + visibleBottom) / 2;
      }
    }
  };

  const candidates = Array.from(scopeRoot.querySelectorAll(args.selector)).filter(isVisible);
  // Skip targets nested inside another target (e.g. a button inside a
  // role=button wrapper): the outer one is what the finger hits.
  const outermost = candidates.filter((element) => !candidates.some((other) => other !== element && other.contains(element)));
  const results: TapTarget[] = [];
  for (const element of outermost) {
    bringIntoView(element);
    const rect = element.getBoundingClientRect();
    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    // Still off-screen after scrolling every scrollable ancestor: unreachable
    // (e.g. a fixed menu that opened below the bottom edge of the screen).
    const offScreen = centreY < 0 || centreY > viewportHeight || centreX < 0 || centreX > viewportWidth;
    const centreHit = !offScreen && hits(element, centreX, centreY);
    const hitAtCentre = offScreen ? null : document.elementFromPoint(centreX, centreY);
    const hitWidth = centreHit ? scanExtent(element, centreX, centreY, -1, 0) + scanExtent(element, centreX, centreY, 1, 0) + 1 : 0;
    const hitHeight = centreHit ? scanExtent(element, centreX, centreY, 0, -1) + scanExtent(element, centreX, centreY, 0, 1) + 1 : 0;
    let nearestGap: number | null = null;
    let nearestLabel: string | null = null;
    for (const other of outermost) {
      if (other === element || other.contains(element) || element.contains(other)) continue;
      const otherRect = other.getBoundingClientRect();
      const otherCentreY = otherRect.top + otherRect.height / 2;
      if (otherCentreY < 0 || otherCentreY > viewportHeight || otherRect.right <= 0 || otherRect.left >= viewportWidth) continue;
      if (effectiveOpacity(other) < 0.05) continue;
      const gapX = Math.max(0, otherRect.left - rect.right, rect.left - otherRect.right);
      const gapY = Math.max(0, otherRect.top - rect.bottom, rect.top - otherRect.bottom);
      const gap = Math.max(gapX, gapY);
      if (nearestGap === null || gap < nearestGap) {
        nearestGap = gap;
        nearestLabel = describe(other);
      }
    }
    const paragraph = element.closest('p, li');
    results.push({
      label: describe(element),
      path: shortPath(element),
      box: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
      hitWidth,
      hitHeight,
      centreHit,
      coveredBy: offScreen ? 'the screen edge: off-screen and cannot be scrolled into view' : centreHit || !hitAtCentre ? null : describe(hitAtCentre),
      effectiveOpacity: Math.round(effectiveOpacity(element) * 100) / 100,
      hoverRevealed: hoverRevealed(element),
      nearestGap: nearestGap === null ? null : Math.round(nearestGap),
      nearestLabel,
      inlineTextLink: element.tagName === 'A' && paragraph !== null && (paragraph.textContent ?? '').trim().length > (element.textContent ?? '').trim().length,
    });
  }
  return results;
}

/**
 * Measure every visible interactive element of the page.
 *
 * @param page - Page to audit.
 * @param scope - Optional selector limiting the audit to one subtree (e.g. an
 *   open drawer or dialog, whose backdrop covers everything else).
 * @returns Measured targets.
 */
export async function measureTapTargets(page: Page, scope: string | null = null): Promise<TapTarget[]> {
  return page.evaluate(measureInPage, { selector: TARGET_SELECTOR, scope, scanLimit: SCAN_LIMIT_PX, minTarget: MIN_TARGET_PX });
}

/**
 * Problems of one target on a touch screen.
 *
 * @param target - Measured target.
 * @returns Problem descriptions (empty when the target is fine).
 */
export function tapTargetProblems(target: TapTarget): string[] {
  const problems: string[] = [];
  if (!target.centreHit) {
    problems.push(`centre not tappable (covered by ${target.coveredBy ?? 'nothing'})`);
  } else if (target.hitWidth < MIN_TARGET_PX || target.hitHeight < MIN_TARGET_PX) {
    problems.push(`hit area ${target.hitWidth}x${target.hitHeight} < ${MIN_TARGET_PX}x${MIN_TARGET_PX}`);
  }
  if (target.centreHit && target.effectiveOpacity < 0.3) {
    problems.push(`tappable but invisible (opacity ${target.effectiveOpacity}${target.hoverRevealed ? ', hover-revealed' : ''})`);
  }
  return problems;
}

/**
 * Format one target as a table row.
 *
 * @param screen - Screen name.
 * @param target - Measured target.
 * @returns Single line.
 */
export function formatTapTarget(screen: string, target: TapTarget): string {
  const gap = target.nearestGap === null ? '-' : `${target.nearestGap}px`;
  const problems = tapTargetProblems(target);
  const spacing = target.nearestGap !== null && target.nearestGap < MIN_SPACING_PX ? ` | gap ${gap} to ${target.nearestLabel}` : '';
  return `${screen} | ${target.label} | box ${target.box.width}x${target.box.height} | hit ${target.hitWidth}x${target.hitHeight} | opacity ${target.effectiveOpacity}${spacing}${problems.length ? ` | ${problems.join('; ')}` : ''}`;
}
