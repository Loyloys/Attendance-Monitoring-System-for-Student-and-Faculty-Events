import { createContext } from 'react';
import type { Theme } from '../utils/theme';

export const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'light',
  toggle: () => {},
});
