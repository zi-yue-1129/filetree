import { createContext } from 'react';
import type { EffectsLevel, EffectsPreference, LowPowerReason } from '../lib/effects';

/** Value exposed by `useEffects()`. */
export interface EffectsContextValue {
  /** Stored user preference. */
  preference: EffectsPreference;
  /** Effective level after heuristics. */
  level: EffectsLevel;
  /** Why `auto` picked `low` (null otherwise). */
  reason: LowPowerReason;
  /** Change and persist the preference. */
  setPreference: (preference: EffectsPreference) => void;
}

/** React context carrying the visual-effects level. */
export const EffectsContext = createContext<EffectsContextValue | undefined>(undefined);
