import { useContext } from 'react';
import { EffectsContext, type EffectsContextValue } from '../contexts/effectsContextValue';

/**
 * Access the visual-effects (low-power mode) context.
 *
 * Returns:
 *   Current preference, effective level, reason and setter.
 *
 * Raises:
 *   Error if used outside of EffectsProvider.
 */
export function useEffects(): EffectsContextValue {
  const context = useContext(EffectsContext);
  if (context === undefined) {
    throw new Error('useEffects must be used within an EffectsProvider');
  }
  return context;
}
