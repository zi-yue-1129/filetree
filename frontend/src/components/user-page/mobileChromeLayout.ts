/**
 * Geometry of the phone (below `lg`) user-page chrome: a floating button row,
 * the user name and the breadcrumb row, overlaid on top of the scroll pane.
 * The scroll content starts with a spacer of {@link MOBILE_CONTENT_TOP_INSET}
 * so that at scroll-top nothing is covered.
 */

/** Floating button row: 6px top padding + 44px buttons (plus the safe area). */
export const MOBILE_TOP_ROW_PX = 50;

/** User name block height. */
export const MOBILE_NAME_PX = 36;

/** Breadcrumb row height (44px controls + 2px padding each side). */
export const MOBILE_BREADCRUMB_PX = 48;

/** Below this scroll offset the breadcrumb row is always shown. */
export const MOBILE_CHROME_TOP_ZONE_PX = MOBILE_NAME_PX;

/** Largest translation of the name block: far enough to leave the screen. */
export const MOBILE_NAME_MAX_SHIFT_PX = MOBILE_TOP_ROW_PX + MOBILE_NAME_PX + 64;

/** Height reserved at the top of the scroll content (CSS length). */
export const MOBILE_CONTENT_TOP_INSET =
  `calc(env(safe-area-inset-top, 0px) + ${MOBILE_TOP_ROW_PX + MOBILE_NAME_PX + MOBILE_BREADCRUMB_PX + 2}px)`;

/** Shared look of a floating round button: its own legible backdrop, 44x44. */
export const FLOATING_BUTTON_CLASS =
  'pointer-events-auto w-11 h-11 shrink-0 rounded-full flex items-center justify-center ' +
  'bg-white/85 dark:bg-gray-900/75 backdrop-blur-md border border-gray-200/80 dark:border-white/10 shadow-md ' +
  'text-gray-700 dark:text-gray-200 active:scale-95 transition-colors';
