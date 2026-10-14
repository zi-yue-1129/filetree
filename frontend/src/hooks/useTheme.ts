import { useContext } from 'react';
import { ThemeContext, type ThemeContextType } from '../contexts/themeContextValue';

/**
 * Hook to access the theme context.
 *
 * Returns:
 *   Theme context value with theme state and control functions.
 *
 * Raises:
 *   Error if used outside of ThemeProvider.
 */
export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
