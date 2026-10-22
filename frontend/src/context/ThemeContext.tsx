import React, { useCallback, useLayoutEffect, useState } from 'react';
import { applyTheme, nextTheme, readTheme, type Theme } from '../utils/theme';
import { ThemeContext } from './appThemeContext';

/** GST001.5: light/dark preference. Persisted in localStorage and applied via a
 * `dark` class on <html> so Tailwind dark: variants and CSS variables follow. */

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(() => readTheme(localStorage));
  useLayoutEffect(() => {
    applyTheme(theme, document.documentElement, localStorage);
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      theme === 'dark' ? '#020617' : '#F5F4EC',
    );
  }, [theme]);
  const toggle = useCallback(() => setTheme((value) => nextTheme(value)), []);
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
};
