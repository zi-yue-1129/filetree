import React from 'react';
import { BatteryLow, Gauge, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';
import { useEffects } from '../hooks/useEffects';
import type { EffectsPreference } from '../lib/effects';

/** Click order of the preference cycle. */
const NEXT_PREFERENCE: Record<EffectsPreference, EffectsPreference> = {
  auto: 'low',
  low: 'full',
  full: 'auto',
};

const PREFERENCE_LABEL: Record<EffectsPreference, string> = {
  auto: '視覺效果：自動',
  low: '視覺效果：省電模式',
  full: '視覺效果：完整',
};

/**
 * Sidebar button that cycles the visual-effects preference
 * (自動 → 省電模式 → 完整), persisted in localStorage.
 */
export const EffectsToggle: React.FC = () => {
  const { preference, level, setPreference } = useEffects();
  const Icon = preference === 'auto' ? Gauge : preference === 'low' ? BatteryLow : Sparkles;
  const detail = preference === 'auto' ? (level === 'low' ? '目前為省電模式' : '目前為完整效果') : null;

  return (
    <button
      type="button"
      onClick={() => setPreference(NEXT_PREFERENCE[preference])}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors cursor-pointer group',
        'text-left text-xs font-medium tracking-wide',
        'text-gray-600 dark:text-white/40 hover:text-gray-900 dark:hover:text-white/70 hover:bg-gray-100 dark:hover:bg-white/5 border border-transparent',
      )}
      aria-label={`${PREFERENCE_LABEL[preference]}，點擊切換`}
      title="切換視覺效果：自動 / 省電模式 / 完整"
    >
      <Icon className={cn('w-4 h-4 shrink-0', level === 'low' ? 'text-emerald-500' : 'text-cyan-500')} />
      <span className="flex flex-col">
        <span>{PREFERENCE_LABEL[preference]}</span>
        {detail && <span className="text-[0.625rem] text-gray-400 dark:text-white/25">{detail}</span>}
      </span>
    </button>
  );
};
