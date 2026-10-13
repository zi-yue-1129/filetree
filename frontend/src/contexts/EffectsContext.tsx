import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MotionConfig, MotionGlobalConfig } from 'framer-motion';
import {
  applyEffectsLevel,
  probeSlowFrames,
  readEffectsPreference,
  resolveStaticLevel,
  writeEffectsPreference,
  type EffectsLevel,
  type EffectsPreference,
  type LowPowerReason,
} from '../lib/effects';
import { EffectsContext } from './effectsContextValue';

/**
 * Make every framer-motion animation jump to its end state in plain mode.
 *
 * `reducedMotion` alone still runs opacity fades and staggered list
 * entrances; `instantAnimations` skips them while keeping final styles.
 *
 * @param level - Effective effects level.
 */
function applyMotionLevel(level: EffectsLevel): void {
  MotionGlobalConfig.instantAnimations = level === 'plain';
}

/**
 * Read the stored preference and apply the motion setting before the first
 * render, because child components start their mount animations before the
 * provider's own effects run.
 *
 * @returns Stored preference.
 */
function readInitialPreference(): EffectsPreference {
  const preference = readEffectsPreference();
  applyMotionLevel(resolveStaticLevel(preference).level);
  return preference;
}

/**
 * Provides the visual-effects level, mirrors it on `<html data-effects>` and
 * limits framer-motion to opacity animations in low-power mode.
 *
 * Args:
 *   children: Application tree.
 */
export const EffectsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreferenceState] = useState<EffectsPreference>(readInitialPreference);
  const [slowFrames, setSlowFrames] = useState(false);

  const { level, reason } = useMemo((): { level: EffectsLevel; reason: LowPowerReason } => {
    const resolved = resolveStaticLevel(preference);
    if (preference === 'auto' && resolved.level === 'full' && slowFrames) {
      return { level: 'low', reason: 'slow-frames' };
    }
    return resolved;
  }, [preference, slowFrames]);

  useEffect(() => {
    applyEffectsLevel(level);
    applyMotionLevel(level);
  }, [level]);

  // Measure startup frames once on devices that passed the static checks.
  useEffect(() => {
    if (preference !== 'auto' || resolveStaticLevel('auto').level === 'low') return;
    let cancelled = false;
    probeSlowFrames().then((slow) => {
      if (!cancelled && slow) setSlowFrames(true);
    });
    return () => {
      cancelled = true;
    };
  }, [preference]);

  const setPreference = useCallback((next: EffectsPreference) => {
    writeEffectsPreference(next);
    setPreferenceState(next);
  }, []);

  const value = useMemo(
    () => ({ preference, level, reason, setPreference }),
    [preference, level, reason, setPreference],
  );

  return (
    <EffectsContext.Provider value={value}>
      <MotionConfig reducedMotion={level === 'full' ? 'user' : 'always'}>{children}</MotionConfig>
    </EffectsContext.Provider>
  );
};
