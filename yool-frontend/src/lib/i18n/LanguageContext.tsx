'use client';
/**
 * LanguageContext — lightweight i18n for EN / FR / AR.
 *
 * - Persists locale to localStorage (key: 'yool_locale')
 * - Defaults to 'fr'
 * - Sets <html lang="..." dir="..."> on every locale change
 * - Exposes useT() for dot-notation string access: t('session.outline')
 * - Exposes useLocale() for reading/setting the current locale
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import dict, { type Locale, defaultLocale, locales } from './translations';

// ── Dot-notation accessor ──────────────────────────────────────────────────────
function getNestedValue(obj: Record<string, any>, path: string): string {
  const keys = path.split('.');
  let cur: any = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return path; // fallback: return key
    cur = cur[k];
  }
  return typeof cur === 'string' ? cur : path;
}

// ── Context types ──────────────────────────────────────────────────────────────
interface LanguageContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
  isRTL: boolean;
}

const LanguageContext = createContext<LanguageContextValue>({
  locale:    defaultLocale,
  setLocale: () => {},
  t:         (k) => k,
  isRTL:     false,
});

// ── Provider ───────────────────────────────────────────────────────────────────
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  // Read saved locale from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('yool_locale') as Locale | null;
      if (saved && locales.includes(saved)) {
        setLocaleState(saved);
      }
    } catch {
      // localStorage unavailable (SSR or private mode)
    }
  }, []);

  // Apply locale to <html> element on every change
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('lang', locale);
    html.setAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem('yool_locale', l); } catch { /* ignore */ }
  }, []);

  const t = useCallback(
    (key: string) => getNestedValue(dict[locale] as Record<string, any>, key),
    [locale],
  );

  const isRTL = locale === 'ar';

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t, isRTL }}>
      {children}
    </LanguageContext.Provider>
  );
}

// ── Hooks ──────────────────────────────────────────────────────────────────────
/** Returns the translation function `t('dot.notation.key')` */
export function useT() {
  return useContext(LanguageContext).t;
}

/** Returns { locale, setLocale, isRTL } */
export function useLocale() {
  const { locale, setLocale, isRTL } = useContext(LanguageContext);
  return { locale, setLocale, isRTL };
}

export { locales };
export type { Locale };
