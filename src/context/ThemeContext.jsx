import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEYS = ['theme', 'qc-theme'];
const ThemeContext = createContext(null);

function getPreferredTheme() {
  try {
    for (const key of STORAGE_KEYS) {
      const stored = localStorage.getItem(key);
      if (stored === 'light' || stored === 'dark' || stored === 'eyecare') return stored;
    }
  } catch {
    // localStorage may be unavailable
  }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  document.body.classList.remove('theme-light', 'theme-dark', 'theme-eyecare');
  document.body.classList.add(`theme-${theme}`);
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    if (typeof document !== 'undefined') {
      const existing = document.documentElement.getAttribute('data-theme');
      if (existing === 'light' || existing === 'dark' || existing === 'eyecare') return existing;
    }
    return getPreferredTheme();
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      STORAGE_KEYS.forEach(key => localStorage.setItem(key, theme));
    } catch {
      // ignore quota / private mode errors
    }
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (next === 'light' || next === 'dark' || next === 'eyecare') {
      setThemeState(next);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      if (prev === 'dark') return 'light';
      if (prev === 'light') return 'eyecare';
      return 'dark';
    });
  }, []);

  const value = useMemo(
    () => ({
      theme,
      isDark: theme === 'dark' || theme === 'eyecare',
      setTheme,
      toggleTheme,
    }),
    [theme, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
