import { useContext } from 'react';
import { ThemeContext } from './appThemeContext';

export const useTheme = () => useContext(ThemeContext);
