import React from 'react';
import { Menu, Users } from 'lucide-react';
import { cn } from '../../lib/utils';
import { FLOATING_BUTTON_CLASS } from './mobileChromeLayout';

interface MobileTopRowProps {
  /** Opens/closes the left navigation drawer. */
  onToggleSidebar: () => void;
  /** Opens/closes the right public directory drawer. */
  onToggleDirectory: () => void;
  /** Page actions shown after the menu button (lock and settings on a user page). */
  actions?: React.ReactNode;
  /** Extra classes (positioning) of the row. */
  className?: string;
}

/**
 * Phone dashboard top row: floating buttons only, no bar background and no
 * brand text. Menu on the left, page actions next to it, directory on the
 * right. The row itself ignores taps (content scrolls underneath); only the
 * buttons are hit-testable.
 *
 * @param props - Component props.
 * @returns The button row.
 */
export const MobileTopRow: React.FC<MobileTopRowProps> = ({ onToggleSidebar, onToggleDirectory, actions, className }) => (
  <header
    data-testid="mobile-top-row"
    className={cn(
      'pointer-events-none flex items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top,0px)+6px)] lg:hidden',
      className,
    )}
  >
    <button type="button" onClick={onToggleSidebar} className={FLOATING_BUTTON_CLASS} aria-label="功能選單">
      <Menu className="w-5 h-5" />
    </button>
    {actions && <div className="flex items-center gap-2 ml-2">{actions}</div>}
    <div className="flex-1" />
    <button
      type="button"
      onClick={onToggleDirectory}
      className={cn(FLOATING_BUTTON_CLASS, 'text-violet-600 dark:text-neural-violet')}
      aria-label="目錄"
    >
      <Users className="w-5 h-5" />
    </button>
  </header>
);
