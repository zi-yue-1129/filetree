import { createContext } from 'react';

/** Supported color themes. */
export type Theme = 'light' | 'dark';

/** Value exposed by `useTheme()`. */
export interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

/** React context carrying the active color theme. */
export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
