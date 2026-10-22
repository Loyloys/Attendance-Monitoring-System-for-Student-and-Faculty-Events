export type Theme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'cot-attendance-theme';

export interface ThemeRoot {
  classList: { toggle: (name: string, force?: boolean) => void };
  style: { colorScheme: string };
}

export function readTheme(storage: Pick<Storage, 'getItem'>): Theme {
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch { /* storage may be restricted */ }
  return 'light';
}

export function applyTheme(
  theme: Theme,
  root: ThemeRoot,
  storage: Pick<Storage, 'setItem'>,
): void {
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  try { storage.setItem(THEME_STORAGE_KEY, theme); } catch { /* storage may be restricted */ }
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
