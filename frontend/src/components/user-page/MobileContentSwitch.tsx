import React from 'react';
import { Cpu, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';

/** Content type of the user dashboard. */
export type DashboardTab = 'files' | 'urls';

interface MobileContentSwitchProps {
  /** Selected tab. */
  activeTab: DashboardTab;
  /** Select a tab. */
  onTabChange: (tab: DashboardTab) => void;
}

/** One segment of the switch. */
interface SwitchSegment {
  tab: DashboardTab;
  label: string;
  icon: React.ReactNode;
  activeClass: string;
}

const SEGMENTS: SwitchSegment[] = [
  { tab: 'files', label: '檔案', icon: <Cpu className="w-4 h-4" />, activeClass: 'bg-cyan-500 text-white shadow-md shadow-cyan-500/30' },
  { tab: 'urls', label: '筆記', icon: <Zap className="w-4 h-4" />, activeClass: 'bg-violet-500 text-white shadow-md shadow-violet-500/30' },
];

/**
 * Phone: floating files/notes segmented control at the bottom centre
 * (replaces the 檔案列表 / 筆記·連結 tabs at the top). A WAI-ARIA tablist;
 * the arrow keys move between the two tabs.
 *
 * @param props - Component props.
 * @returns The floating switch.
 */
export const MobileContentSwitch: React.FC<MobileContentSwitchProps> = ({ activeTab, onTabChange }) => {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next: DashboardTab = activeTab === 'files' ? 'urls' : 'files';
    onTabChange(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="內容切換"
      onKeyDown={handleKeyDown}
      className={cn(
        'fixed left-1/2 -translate-x-1/2 bottom-[calc(env(safe-area-inset-bottom,0px)+12px)] z-20 lg:hidden',
        'flex items-center gap-1 p-1 rounded-full',
        'bg-white/90 dark:bg-gray-900/85 backdrop-blur-md border border-gray-200/80 dark:border-white/10 shadow-lg',
      )}
    >
      {SEGMENTS.map((segment) => {
        const selected = segment.tab === activeTab;
        return (
          <button
            key={segment.tab}
            type="button"
            role="tab"
            data-tab={segment.tab}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onTabChange(segment.tab)}
            className={cn(
              'min-h-11 min-w-24 px-4 rounded-full flex items-center justify-center gap-1.5 text-xs font-black transition-colors',
              selected ? segment.activeClass : 'text-gray-600 dark:text-gray-300',
            )}
          >
            {segment.icon}
            {segment.label}
          </button>
        );
      })}
    </div>
  );
};
