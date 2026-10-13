import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LazyMotion, MotionConfig, type FeatureBundle } from 'framer-motion';
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
 * Load the framer-motion feature bundle as a separate chunk.
 *
 * A failed load (e.g. a stale deploy removed the chunk) is logged and
 * re-thrown so it surfaces instead of silently leaving animations dead.
 *
 * Returns:
 *   The feature bundle to register with `LazyMotion`.
 */
function loadMotionFeatures(): Promise<FeatureBundle> {
  return import('../lib/motionFeatures').then(
    (module) => module.default,
    (error: unknown) => {
      console.error('Failed to load animation features', error);
      throw error;
    },
  );
}

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
      {/* `strict` makes any leftover eager `motion.*` component throw, which
          would silently pull the full animation engine back into the entry. */}
      <LazyMotion features={loadMotionFeatures} strict>
        <MotionConfig reducedMotion={level === 'low' ? 'always' : 'user'}>{children}</MotionConfig>
      </LazyMotion>
    </EffectsContext.Provider>
  );
};
