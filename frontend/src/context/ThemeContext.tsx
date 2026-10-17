import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/** GST001.5: light/dark preference. Persisted in localStorage and applied via a
 * `dark` class on <html> so Tailwind dark: variants and CSS variables follow. */
type Theme = 'light' | 'dark';
const STORAGE_KEY = 'cot-attendance-theme';

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch { /* storage may be restricted */ }
  return 'light';
}

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} });

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* storage may be restricted */ }
  }, [theme]);
  const toggle = useCallback(() => setTheme((value) => (value === 'dark' ? 'light' : 'dark')), []);
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
