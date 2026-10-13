import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MotionConfig } from 'framer-motion';
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
 * Provides the visual-effects level, mirrors it on `<html data-effects>` and
 * limits framer-motion to opacity animations in low-power mode.
 *
 * Args:
 *   children: Application tree.
 */
export const EffectsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreferenceState] = useState<EffectsPreference>(readEffectsPreference);
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
      <MotionConfig reducedMotion={level === 'low' ? 'always' : 'user'}>{children}</MotionConfig>
    </EffectsContext.Provider>
  );
};
