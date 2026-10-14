import React from 'react';
import { Lock, Unlock, Settings } from 'lucide-react';
import { cn } from '../../lib/utils';
import { MobileTopRow } from './MobileTopRow';
import {
  FLOATING_BUTTON_CLASS,
  MOBILE_BREADCRUMB_PX,
  MOBILE_NAME_MAX_SHIFT_PX,
  MOBILE_NAME_PX,
  MOBILE_TOP_ROW_PX,
} from './mobileChromeLayout';

interface MobileUserChromeProps {
  /** Receives the scroll custom properties written by `useHideOnScroll`. */
  chromeRef: React.RefObject<HTMLDivElement | null>;
  /** Owner of the page. */
  username: string;
  /** The viewer unlocked the page. */
  isAuthenticated: boolean;
  /** Lock button: log out when unlocked, ask for the password otherwise. */
  onLockClick: () => void;
  /** Open the user settings dialog. */
  onShowSettings: () => void;
  /** Toggle the left navigation drawer. */
  onToggleSidebar: () => void;
  /** Toggle the right directory drawer. */
  onToggleDirectory: () => void;
  /** Breadcrumb row content (folder drawer button, path, selection controls). */
  breadcrumbs: React.ReactNode;
  /** Hide the breadcrumb row (scrolling down). */
  breadcrumbHidden: boolean;
  /** Animate hide/show (false in low-power and plain modes). */
  animate: boolean;
}

/** Transition used when hiding/showing is animated (compositor-only properties). */
const ANIMATED = 'transition-[transform,opacity,visibility] duration-200 ease-out motion-reduce:transition-none';

/**
 * Phone user-page chrome overlaid on the scroll pane:
 * - floating button row (menu, lock, settings, directory), always at the top;
 * - user name, which leaves with the content (scroll-linked transform);
 * - breadcrumb row, following the name up to the button row, hidden while
 *   scrolling down and shown again when scrolling up.
 *
 * Positions use `transform`/`opacity` only, driven by the CSS custom
 * properties `--dash-scroll-y` and `--dash-scroll-progress`.
 *
 * @param props - Component props.
 * @returns The overlay.
 */
export const MobileUserChrome: React.FC<MobileUserChromeProps> = ({
  chromeRef,
  username,
  isAuthenticated,
  onLockClick,
  onShowSettings,
  onToggleSidebar,
  onToggleDirectory,
  breadcrumbs,
  breadcrumbHidden,
  animate,
}) => {
  const nameStyle: React.CSSProperties = {
    top: `calc(env(safe-area-inset-top, 0px) + ${MOBILE_TOP_ROW_PX}px)`,
    height: MOBILE_NAME_PX,
    transform: `translateY(calc(-1 * min(var(--dash-scroll-y, 0px), ${MOBILE_NAME_MAX_SHIFT_PX}px)))`,
    opacity: 'calc(1 - var(--dash-scroll-progress, 0))',
  };
  const breadcrumbStyle: React.CSSProperties = {
    top: `calc(env(safe-area-inset-top, 0px) + ${MOBILE_TOP_ROW_PX + MOBILE_NAME_PX}px)`,
    height: MOBILE_BREADCRUMB_PX,
    // Follows the name up until it docks right under the button row.
    transform: `translateY(calc(-1 * min(var(--dash-scroll-y, 0px), ${MOBILE_NAME_PX}px)))`,
  };

  return (
    <div ref={chromeRef} className="lg:hidden absolute inset-x-0 top-0 z-20 pointer-events-none">
      <div className="absolute inset-x-0 top-0">
        <MobileTopRow
          onToggleSidebar={onToggleSidebar}
          onToggleDirectory={onToggleDirectory}
          actions={
            <>
              <button
                type="button"
                onClick={onLockClick}
                aria-label={isAuthenticated ? '鎖定頁面' : '解鎖頁面'}
                className={cn(FLOATING_BUTTON_CLASS, isAuthenticated && 'text-cyan-600 dark:text-cyan-400 border-cyan-500/30')}
              >
                {isAuthenticated ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              </button>
              <button type="button" onClick={onShowSettings} aria-label="使用者設定" className={FLOATING_BUTTON_CLASS}>
                <Settings className="w-4 h-4" />
              </button>
            </>
          }
        />
      </div>

      {/* Below the button row in the paint order: it slides under the buttons. */}
      <div
        data-testid="mobile-user-name"
        className="absolute left-0 right-0 -z-10 flex items-center gap-2 px-4 will-change-transform"
        style={nameStyle}
      >
        <div className="p-1 bg-white/80 dark:bg-white/5 rounded-lg border border-gray-200/80 dark:border-white/20 shadow-sm">
          <div className="text-cyan-600 dark:text-quantum-cyan font-black text-xs">FN</div>
        </div>
        <h1 className="text-lg font-black tracking-tighter text-gray-900 dark:text-white truncate">{username}</h1>
      </div>

      <div className="absolute left-0 right-0 -z-10 px-2 will-change-transform" style={breadcrumbStyle}>
        <div
          data-testid="mobile-breadcrumbs"
          inert={breadcrumbHidden}
          aria-hidden={breadcrumbHidden || undefined}
          className={cn(
            'h-full flex items-center px-1 rounded-2xl pointer-events-auto',
            'bg-white/85 dark:bg-gray-900/75 backdrop-blur-md border border-gray-200/70 dark:border-white/10 shadow-md',
            animate && ANIMATED,
            breadcrumbHidden && '-translate-y-[calc(100%+24px)] opacity-0 invisible pointer-events-none',
          )}
        >
          {breadcrumbs}
        </div>
      </div>
    </div>
  );
};
